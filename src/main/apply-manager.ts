import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Store } from "./store";
import { parseDraft, type Run } from "../shared/runs";
import type { ApplyReview, ApplyResult } from "../shared/apply";
import { commandRevision } from "../engine/revision";
import { snapshotFiles } from "./local-workspace";
import { snapshotRevision } from "../engine/integration";

function revision(run: Run) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        draft: commandRevision(run),
        findings: run.findings,
        specialistAudits: run.specialistAudits || [],
        findingDecisions: run.findingDecisions || [],
        checks: run.checks,
        executions: run.executions || [],
      }),
    )
    .digest("hex");
}
function eligible(run: Run) {
  if (
    run.coordination &&
    (run.coordination.auditedRevision !==
      snapshotRevision(run.files, run.drafts) ||
      run.coordination.integratedRevision !== run.coordination.auditedRevision)
  )
    throw new Error("Combined draft has no current revision-bound audit");
  if (
    run.status !== "complete" ||
    !run.drafts.length ||
    run.executions?.some((e) => e.status === "running")
  )
    throw new Error("A completed draft with no running checks is required");
  if (run.applications?.length)
    throw new Error(
      "This draft already has an application record. Review it before preparing a new run.",
    );
  parseDraft({ summary: "Apply", files: run.drafts });
  snapshotFiles(run);
  for (const f of run.drafts)
    if (
      f.before !== (run.files.find((s) => s.path === f.path)?.content ?? null)
    )
      throw new Error("Draft baseline is inconsistent");
}
// Check only selected paths. Unrelated user files are never traversed or changed.
function inspect(root: string, path: string): string | null {
  let current = root;
  const parts = path.split("/");
  for (let i = 0; i < parts.length; i++) {
    const siblings = readdirSync(current);
    if (
      siblings.some(
        (s) => s !== parts[i] && s.toLowerCase() === parts[i].toLowerCase(),
      )
    )
      throw new Error(`Case-conflicting destination: ${path}`);
    if (!siblings.includes(parts[i])) return null;
    current = join(current, parts[i]);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink())
      throw new Error(`Symlink destination blocked: ${path}`);
    if (i < parts.length - 1) {
      if (!stat.isDirectory())
        throw new Error(`Parent is not a directory: ${path}`);
    } else {
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 80_000)
        throw new Error(`Unsupported destination file: ${path}`);
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        readFileSync(current),
      );
    }
  }
  return null;
}
function validateDestination(root: string, run: Run) {
  if (realpathSync(root) !== root || !lstatSync(root).isDirectory())
    throw new Error("Destination moved or changed");
  const expected = new Map(
    run.files.map((f) => [f.path, f.content as string | null]),
  );
  for (const f of run.drafts) expected.set(f.path, f.before);
  for (const [path, before] of expected)
    if (inspect(root, path) !== before)
      throw new Error(
        `Conflict at ${path}. Destination does not match the reviewed baseline; nothing was applied.`,
      );
}
export class ApplyManager {
  private ticket: { review: ApplyReview; dev: number; ino: number } | null =
    null;
  constructor(
    private store: Store,
    private dataRoot: string,
    private publish: (run: Run) => void,
    private beforeWrite: (path: string) => void = () => {},
  ) {}
  review(id: unknown, directory: string): ApplyReview {
    this.ticket = null;
    const run = this.store.getRun(id);
    eligible(run);
    if (lstatSync(directory).isSymbolicLink())
      throw new Error("Choose a real directory, not a symlink");
    const destination = realpathSync(directory);
    const privateRoot = realpathSync(this.dataRoot);
    if (
      destination === privateRoot ||
      destination.startsWith(privateRoot + sep)
    )
      throw new Error("Application data cannot be an apply destination");
    validateDestination(destination, run);
    const stat = lstatSync(destination);
    const review: ApplyReview = {
      token: randomUUID(),
      runId: run.id,
      destination,
      revision: revision(run),
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      files: structuredClone(run.drafts),
    };
    this.ticket = { review, dev: stat.dev, ino: stat.ino };
    return review;
  }
  apply(token: unknown, approved: unknown): Run {
    const ticket = this.ticket;
    if (!ticket || token !== ticket.review.token)
      throw new Error("Choose a destination and review again");
    this.ticket = null;
    if (approved !== true)
      throw new Error("Explicit permission to write these files is required");
    const review = ticket.review;
    const run = this.store.getRun(review.runId);
    eligible(run);
    if (
      Date.now() >= Date.parse(review.expiresAt) ||
      revision(run) !== review.revision
    )
      throw new Error("Apply review expired or changed. Review again.");
    const root = review.destination;
    const stat = lstatSync(root);
    if (stat.dev !== ticket.dev || stat.ino !== ticket.ino)
      throw new Error("Destination replaced. Review again.");
    validateDestination(root, run);
    const id = randomUUID();
    const backupDirectory = resolve(
      realpathSync(this.dataRoot),
      "applications",
      id,
    );
    mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
    if (realpathSync(backupDirectory) !== backupDirectory)
      throw new Error("Backup path must not contain symlinks");
    // Save every original before any destination writes. Backups are retained for manual recovery.
    for (const f of run.drafts)
      if (f.before !== null) {
        const backup = join(backupDirectory, "originals", f.path);
        mkdirSync(dirname(backup), { recursive: true, mode: 0o700 });
        writeFileSync(backup, f.before, { flag: "wx", mode: 0o600 });
      }
    const result: ApplyResult = {
      id,
      destination: root,
      revision: review.revision,
      backupDirectory,
      status: "applying",
      written: [],
      pendingPath: "",
      error: "",
      startedAt: new Date().toISOString(),
    };
    run.applications = [result];
    const save = () => {
      writeFileSync(
        join(backupDirectory, "manifest.json"),
        JSON.stringify(
          {
            ...result,
            files: run.drafts.map((f) => ({
              path: f.path,
              added: f.before === null,
            })),
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
      this.store.saveRun(run);
      this.publish(structuredClone(run));
    };
    save();
    try {
      for (const f of run.drafts) {
        this.beforeWrite(f.path);
        if (
          realpathSync(root) !== root ||
          lstatSync(root).ino !== ticket.ino ||
          inspect(root, f.path) !== f.before
        )
          throw new Error(`Destination changed before writing ${f.path}`);
        result.pendingPath = f.path;
        save();
        const target = join(root, f.path);
        mkdirSync(dirname(target), { recursive: true });
        const fd = openSync(
          target,
          f.before === null
            ? constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
            : constants.O_RDWR | constants.O_NOFOLLOW,
          0o600,
        );
        try {
          const stat = fstatSync(fd);
          if (!stat.isFile() || stat.nlink !== 1)
            throw new Error(`Unsupported file: ${f.path}`);
          if (
            f.before !== null &&
            !readFileSync(fd).equals(Buffer.from(f.before))
          )
            throw new Error(`File changed: ${f.path}`);
          // readFileSync advances the descriptor; explicit-position writes are required below.
          const bytes = Buffer.from(f.content);
          let offset = 0;
          while (offset < bytes.length)
            offset += writeSyncAt(fd, bytes, offset);
          ftruncateSync(fd, bytes.length);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        result.written.push(f.path);
        result.pendingPath = "";
        save();
      }
      result.status = "applied";
    } catch (error) {
      result.status = "failed";
      result.error = `${error instanceof Error ? error.message : "Apply failed"}. Earlier files may already be written. No automatic rollback; inspect the retained backup and manifest.`;
    }
    result.finishedAt = new Date().toISOString();
    save();
    return run;
  }
}
function writeSyncAt(fd: number, bytes: Buffer, offset: number) {
  const count = writeSync(fd, bytes, offset, bytes.length - offset, offset);
  if (!count) throw new Error("File write made no progress");
  return count;
}
