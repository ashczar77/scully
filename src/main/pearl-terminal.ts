import { fork, type ChildProcess, type ForkOptions } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { isolatedCommand } from "./pearl-command-sandbox";
import type { PearlTerminalState } from "../shared/pearl-chat";

const outputLimit = 32_000;
const updateIntervalMs = 100;
type SupervisorLauncher = (
  modulePath: string,
  args: readonly string[],
  options: ForkOptions,
) => ChildProcess;

export class ManagedTerminal {
  private child: ChildProcess;
  private scratch: string;
  private ended = false;
  private updateTimer?: NodeJS.Timeout;
  private commandPid: number | null = null;
  private reportedExitCode: number | null | undefined;
  private stopTimer?: NodeJS.Timeout;

  constructor(
    readonly state: PearlTerminalState,
    executable: string,
    project: string,
    private changed: () => void,
    supervisorPath = join(__dirname, "pearl-terminal-supervisor.cjs"),
    supervisorLauncher: SupervisorLauncher = fork,
  ) {
    this.scratch = mkdtempSync(join(project, ".scully-command-"));
    let launch: ReturnType<typeof isolatedCommand>;
    try {
      launch = isolatedCommand(executable, state.args, project, this.scratch);
      this.child = supervisorLauncher(supervisorPath, [], {
        execPath: process.execPath,
        execArgv: [],
        cwd: project,
        env: { ELECTRON_RUN_AS_NODE: "1" },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
    } catch (error) {
      rmSync(this.scratch, { recursive: true, force: true });
      throw error;
    }
    const stdout = new StringDecoder("utf8");
    const stderr = new StringDecoder("utf8");
    const append = (chunk: string) => {
      if (!chunk) return;
      const next = this.state.output + chunk;
      let removed = Math.max(0, next.length - outputLimit);
      if (
        removed > 0 &&
        next.charCodeAt(removed) >= 0xdc00 &&
        next.charCodeAt(removed) <= 0xdfff
      )
        removed++;
      this.state.outputStart = (this.state.outputStart || 0) + removed;
      this.state.truncated ||= removed > 0;
      this.state.output = next.slice(removed);
      this.state.revision++;
      this.scheduleUpdate();
    };
    this.child.stdout?.on("data", (chunk: Buffer) =>
      append(stdout.write(chunk)),
    );
    this.child.stderr?.on("data", (chunk: Buffer) =>
      append(stderr.write(chunk)),
    );
    this.child.on("error", (error) => {
      append(`\nTerminal supervisor error: ${error.message}\n`);
    });
    this.child.on("message", (message: unknown) => {
      if (!message || typeof message !== "object") return;
      const event = message as {
        type?: string;
        pid?: number;
        code?: number | null;
        message?: string;
      };
      if (event.type === "started" && Number.isSafeInteger(event.pid)) {
        this.commandPid = event.pid! > 0 ? event.pid! : null;
      } else if (event.type === "exit") {
        this.reportedExitCode =
          typeof event.code === "number" ? event.code : null;
      } else if (event.type === "error" && event.message) {
        append(`\nProcess error: ${event.message}\n`);
      }
    });
    this.child.on("exit", () => {
      // If the supervisor itself fails, stop its command group from the app.
      if (this.reportedExitCode === undefined) this.killCommandGroup();
    });
    this.child.on("close", (code) => {
      append(stdout.end());
      append(stderr.end());
      this.finish(
        this.reportedExitCode === undefined ? code : this.reportedExitCode,
      );
    });
    this.child.send(
      { type: "start", launch, project, scratch: this.scratch },
      (error) => {
        if (error) {
          append(`\nTerminal start failed: ${error.message}\n`);
          this.stop();
        }
      },
    );
  }

  private killCommandGroup() {
    if (!this.commandPid) return;
    try {
      process.kill(-this.commandPid, "SIGKILL");
    } catch {
      // The command group has already exited.
    }
  }

  private scheduleUpdate() {
    if (this.updateTimer) return;
    this.updateTimer = setTimeout(() => this.flush(), updateIntervalMs);
    this.updateTimer.unref();
  }

  flush() {
    if (this.updateTimer) clearTimeout(this.updateTimer);
    this.updateTimer = undefined;
    this.changed();
  }

  private finish(code: number | null) {
    if (this.ended) return;
    this.ended = true;
    if (this.stopTimer) clearTimeout(this.stopTimer);
    if (this.state.status === "running") this.state.status = "exited";
    this.state.exitCode = code;
    this.state.endedAt = new Date().toISOString();
    this.state.revision++;
    rmSync(this.scratch, { recursive: true, force: true });
    this.flush();
  }

  input(value: string) {
    if (this.ended || this.state.status !== "running")
      throw new Error("Terminal session has ended");
    if (
      typeof value !== "string" ||
      !value ||
      Buffer.byteLength(value, "utf8") > 4096
    )
      throw new Error("Invalid terminal input");
    this.child.send({ type: "input", value });
  }

  resize(cols: number, rows: number) {
    if (this.ended || this.state.status !== "running")
      throw new Error("Terminal session has ended");
    if (
      !Number.isSafeInteger(cols) ||
      !Number.isSafeInteger(rows) ||
      cols < 20 ||
      cols > 300 ||
      rows < 5 ||
      rows > 120
    )
      throw new Error("Invalid terminal size");
    this.child.send({ type: "resize", cols, rows });
  }

  stop() {
    if (this.ended) return;
    this.state.status = "stopped";
    this.state.revision++;
    if (this.child.connected) this.child.send({ type: "stop" });
    this.stopTimer = setTimeout(() => {
      if (this.ended) return;
      this.killCommandGroup();
      this.child.kill("SIGKILL");
    }, 3000);
    this.stopTimer.unref();
    this.flush();
  }

  async close(): Promise<void> {
    if (this.ended) return;
    this.stop();
    await new Promise<void>((resolve) => {
      if (this.ended) return resolve();
      this.child.once("close", () => resolve());
      setTimeout(resolve, 2000).unref();
    });
  }
}
