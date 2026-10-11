import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { commandRevision } from "../engine/revision";
import { snapshotRevision } from "../engine/integration";
import { findingCheckCurrent } from "../shared/audits";
import type {
  ExecutionReview,
  ExecutionResult,
  ExecutionStatus,
} from "../shared/execution";
import type { Run } from "../shared/runs";
import { Store } from "./store";
import {
  createWorkspace,
  fileHash,
  resolveExecutable,
  runtimePath,
  snapshotFiles,
  verifyWorkspace,
} from "./local-workspace";

type Ticket = {
  review: ExecutionReview;
  root: string;
  files: Map<string, string>;
  path: string;
};
export class ExecutionManager {
  private ticket: Ticket | null = null;
  private busy = false;
  private closed = false;
  private active: {
    runId: string;
    result: ExecutionResult;
    child: ChildProcess;
    finish: (status: ExecutionStatus, error?: string) => void;
  } | null = null;
  constructor(
    private store: Store,
    private root: string,
    private publish: (run: Run) => void,
  ) {}
  private command(id: unknown, commandId: unknown) {
    const run = this.store.getRun(id);
    if (
      run.coordination &&
      (run.coordination.auditedRevision !==
        snapshotRevision(run.files, run.drafts) ||
        run.coordination.integratedRevision !==
          run.coordination.auditedRevision)
    )
      throw new Error("Combined draft has no current revision-bound audit");
    const command = run.commands?.find((c) => c.id === commandId);
    if (run.status !== "complete" || !command || command.decision === "denied")
      throw new Error("Only a completed, non-denied proposal can run");
    if (command.revision !== commandRevision(run))
      throw new Error("Draft or command changed. Prepare a new proposal.");
    if (command.findingLink && !findingCheckCurrent(run, command))
      throw new Error("Finding or audit changed. This check is stale.");
    return { run, command };
  }
  async review(id: unknown, commandId: unknown): Promise<ExecutionReview> {
    if (this.busy || this.active || this.closed)
      throw new Error("Local runner is busy or closed");
    this.busy = true;
    this.ticket = null;
    try {
      const { run, command } = this.command(id, commandId);
      if ((run.executions?.length || 0) >= 20)
        throw new Error(
          "This run reached its 20-check limit. Prepare a new run.",
        );
      const path = runtimePath();
      const executable = await resolveExecutable(command.executable, path);
      const executableHash = await fileHash(executable);
      const files = snapshotFiles(run);
      const root = await createWorkspace(this.root, files, run.id);
      const cwd = await verifyWorkspace(root, files, command.cwd);
      const review: ExecutionReview = {
        token: randomUUID(),
        runId: run.id,
        commandId: command.id,
        revision: command.revision,
        executable,
        executableHash,
        args: [...command.args],
        cwd,
        timeoutSeconds: command.timeoutSeconds,
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
      };
      if (this.closed) throw new Error("Runner closed");
      this.ticket = { review, root, files, path };
      return review;
    } finally {
      this.busy = false;
    }
  }
  async execute(token: unknown, approved: unknown) {
    if (this.busy || this.active || this.closed)
      throw new Error("Local runner is busy or closed");
    const ticket = this.ticket;
    if (!ticket || ticket.review.token !== token)
      throw new Error("Prepare a fresh execution review");
    this.ticket = null; // Every attempt consumes this permission challenge, including denial.
    if (approved !== true)
      throw new Error("Fresh explicit local execution permission is required");
    this.busy = true;
    try {
      const r = ticket.review;
      const { run, command } = this.command(r.runId, r.commandId);
      if (
        Date.now() >= Date.parse(r.expiresAt) ||
        command.revision !== r.revision
      )
        throw new Error("Execution review expired or changed");
      await verifyWorkspace(ticket.root, ticket.files, command.cwd);
      if ((await fileHash(r.executable)) !== r.executableHash)
        throw new Error("Executable changed. Review again.");
      // Recheck after async preflight; neither UI decisions nor stale callbacks grant permission.
      if (this.command(r.runId, r.commandId).command.revision !== r.revision)
        throw new Error("Draft changed during preflight");
      if (this.closed || Date.now() >= Date.parse(r.expiresAt))
        throw new Error("Execution review expired or runner closed");
      const { token: _token, expiresAt: _expiry, ...details } = r;
      const result: ExecutionResult = {
        ...details,
        id: randomUUID(),
        status: "running",
        startedAt: new Date().toISOString(),
        exitCode: null,
        signal: null,
        output: "",
        error: "",
      };
      run.executions = [...(run.executions || []), result];
      this.store.saveRun(run); // Persist intent before process creation. Never replay on restart.
      this.publish(run);
      let child: ChildProcess;
      try {
        child = spawn(r.executable, r.args, {
          cwd: r.cwd,
          shell: false,
          detached: process.platform !== "win32",
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            PATH: ticket.path,
            HOME: ticket.root,
            TMPDIR: ticket.root,
            TMP: ticket.root,
            TEMP: ticket.root,
            LANG: "C.UTF-8",
            ...(process.platform === "win32"
              ? { SystemRoot: process.env.SystemRoot }
              : {}),
          },
        });
      } catch {
        result.status = "failed";
        result.error = "Could not launch executable";
        result.finishedAt = new Date().toISOString();
        this.save(r.runId, result);
        return this.store.getRun(r.runId);
      }
      let done = false;
      let bytes = 0;
      const kill = () => {
        if (!child.pid) return;
        try {
          if (process.platform === "win32") child.kill("SIGKILL");
          else process.kill(-child.pid, "SIGKILL");
        } catch {
          /* Already exited or unavailable. Do not claim tree termination. */
        }
      };
      const flush = () => {
        if (!this.closed) this.save(r.runId, result);
      };
      const finish = (status: ExecutionStatus, error = "") => {
        if (done) return;
        done = true;
        clearTimeout(deadline);
        clearInterval(progress);
        kill();
        result.status = status;
        result.error = error;
        result.finishedAt = new Date().toISOString();
        this.active = null;
        flush();
      };
      const deadline = setTimeout(
        () =>
          finish(
            "timed_out",
            "Deadline reached. Termination requested; detached descendants may survive.",
          ),
        r.timeoutSeconds * 1000,
      );
      const progress = setInterval(flush, 200);
      this.active = { runId: r.runId, result, child, finish };
      const output = (chunk: Buffer) => {
        if (done) return;
        const remaining = 65_536 - bytes;
        result.output += chunk
          .subarray(0, remaining)
          .toString("utf8")
          .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
          .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
        bytes += chunk.length;
        // Invalid UTF-8 can expand into replacement characters. Bound stored bytes too.
        const encoded = Buffer.from(result.output);
        if (encoded.length > 65_536)
          result.output = new StringDecoder("utf8").write(
            encoded.subarray(0, 65_536),
          );
        if (bytes > 65_536)
          finish(
            "output_limit",
            "Output exceeded 64 KiB. Termination requested.",
          );
      };
      child.stdout?.on("data", output);
      child.stderr?.on("data", output);
      child.on("error", () =>
        finish(
          "failed",
          "Executable could not start. Check runtime availability and permissions.",
        ),
      );
      child.on("exit", (code, signal) => {
        result.exitCode = code;
        result.signal = signal;
        kill();
      });
      child.on("close", () => finish("exited"));
      return this.store.getRun(r.runId);
    } finally {
      this.busy = false;
    }
  }
  stop(id: unknown) {
    if (!this.active || this.active.result.id !== id)
      throw new Error("Execution is not active");
    const runId = this.active.runId;
    this.active.finish(
      "stopped",
      "Local termination requested. Detached descendants may survive; Windows stops the direct process only.",
    );
    return this.store.getRun(runId);
  }
  close() {
    this.ticket = null;
    this.active?.finish(
      "interrupted",
      "Application closed. Termination requested; process-tree termination is not guaranteed.",
    );
    this.closed = true;
  }
  private save(id: string, result: ExecutionResult) {
    const run = this.store.getRun(id);
    run.executions = (run.executions || []).map((e) =>
      e.id === result.id ? structuredClone(result) : e,
    );
    this.store.saveRun(run);
    this.publish(run);
  }
}
