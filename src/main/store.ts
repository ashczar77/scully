import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { Run } from "../shared/runs";
import { interruptAudits } from "../shared/audits";
import type { TeamMessage, TeamReply } from "../shared/messages";
import {
  initialTeam,
  parseTask,
  parseTeammate,
  type Task,
  type Workspace,
  type Teammate,
} from "../shared/contracts";
export class Store {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;");
    const version = (
      this.db.prepare("PRAGMA user_version").get() as { user_version: number }
    ).user_version;
    if (version > 2) {
      this.db.close();
      throw new Error("Workspace database is newer than this application");
    }
    this.db.exec(
      "BEGIN; CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, mode TEXT NOT NULL, createdAt TEXT NOT NULL); CREATE TABLE IF NOT EXISTS teammates (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, bio TEXT NOT NULL, instructions TEXT NOT NULL); CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, taskId TEXT NOT NULL, data TEXT NOT NULL); PRAGMA user_version=2; COMMIT;",
    );
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO teammates VALUES (?, ?, ?, ?, ?)",
    );
    initialTeam.forEach((t) =>
      insert.run(t.id, t.name, t.role, t.bio, t.instructions),
    );
  }
  load(): Workspace {
    return {
      tasks: this.db
        .prepare("SELECT * FROM tasks ORDER BY createdAt DESC, rowid DESC")
        .all() as Task[],
      teammates: this.db
        .prepare("SELECT * FROM teammates ORDER BY rowid")
        .all() as Teammate[],
    };
  }
  createTask(value: unknown): Task {
    const input = parseTask(value);
    const task = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare("INSERT INTO tasks VALUES (?, ?, ?, ?, ?)")
      .run(task.id, task.title, task.description, task.mode, task.createdAt);
    return task;
  }
  updateTeammate(value: unknown): Teammate {
    const t = parseTeammate(value);
    this.db
      .prepare(
        "UPDATE teammates SET name=?, role=?, bio=?, instructions=? WHERE id=?",
      )
      .run(t.name, t.role, t.bio, t.instructions, t.id);
    return t;
  }
  close() {
    this.db.close();
  }
  saveRun(run: Run) {
    const saved = this.db
      .prepare("SELECT data FROM runs WHERE id=?")
      .get(run.id) as { data: string } | undefined;
    if (saved) {
      const existing = JSON.parse(saved.data) as Run;
      run.messages = existing.messages;
      run.replies = existing.replies;
      run.reviewedSuggestionIds = existing.reviewedSuggestionIds;
      run.cloudExecutions = existing.cloudExecutions;
      if (existing.redirectedTo) {
        run.redirectedTo = existing.redirectedTo;
        run.status = "stopped";
      }
    }
    this.db
      .prepare(
        "INSERT INTO runs VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(run.id, run.taskId, JSON.stringify(run));
  }
  getRun(id: unknown): Run {
    if (typeof id !== "string") throw new Error("Invalid run ID");
    const row = this.db.prepare("SELECT data FROM runs WHERE id=?").get(id) as
      { data: string } | undefined;
    if (!row) throw new Error("Run not found");
    return JSON.parse(row.data);
  }
  appendMessage(id: string, message: TeamMessage) {
    const run = this.getRun(id);
    if ((run.messages?.length || 0) >= 20)
      throw new Error("This run reached its 20-message limit");
    run.messages = [...(run.messages || []), message];
    this.db
      .prepare("UPDATE runs SET data=? WHERE id=?")
      .run(JSON.stringify(run), id);
    return run;
  }
  updateReply(id: string, reply: TeamReply) {
    const run = this.getRun(id);
    run.replies = [
      ...(run.replies || []).filter((r) => r.id !== reply.id),
      reply,
    ];
    this.db
      .prepare("UPDATE runs SET data=? WHERE id=?")
      .run(JSON.stringify(run), id);
    return run;
  }
  updateCloudExecution(
    id: string,
    result: import("../shared/cloud").CloudExecution,
  ) {
    const run = this.getRun(id);
    const executions = run.cloudExecutions || [];
    run.cloudExecutions = executions.some((item) => item.id === result.id)
      ? executions.map((item) => (item.id === result.id ? result : item))
      : [...executions, result];
    this.db
      .prepare("UPDATE runs SET data=? WHERE id=?")
      .run(JSON.stringify(run), id);
    return run;
  }
  markSuggestionReviewed(id: string, suggestionId: string) {
    const run = this.getRun(id);
    run.reviewedSuggestionIds = [
      ...new Set([...(run.reviewedSuggestionIds || []), suggestionId]),
    ];
    this.db
      .prepare("UPDATE runs SET data=? WHERE id=?")
      .run(JSON.stringify(run), id);
    return run;
  }
  redirectRun(parent: Run, child: Run) {
    this.db.exec("BEGIN");
    try {
      this.saveRun(child);
      this.saveRun(parent);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  runs(taskId: unknown): Run[] {
    if (typeof taskId !== "string") throw new Error("Invalid task ID");
    return (
      this.db
        .prepare("SELECT data FROM runs WHERE taskId=? ORDER BY rowid DESC")
        .all(taskId) as { data: string }[]
    ).map((row) => JSON.parse(row.data));
  }
  recoverRuns() {
    for (const row of this.db.prepare("SELECT data FROM runs").all() as {
      data: string;
    }[]) {
      const run: Run = JSON.parse(row.data);
      let changed = false;
      for (const reply of run.replies || [])
        if (reply.status === "answering") {
          reply.status = "failed";
          reply.answer =
            "Application exited during reply; remote completion unconfirmed.";
          changed = true;
        }
      for (const application of run.applications || []) {
        if (application.status === "applying") {
          application.status = "interrupted";
          application.error =
            "Application closed while writing. Destination may be partially updated. Inspect the backup manifest; no automatic retry or rollback was made.";
          changed = true;
        }
      }
      for (const execution of run.executions || []) {
        if (execution.status === "running") {
          execution.status = "interrupted";
          execution.error =
            "Application exited during execution. No retry was made. Process termination is unconfirmed.";
          execution.finishedAt = new Date().toISOString();
          changed = true;
        }
      }
      for (const cloud of run.cloudExecutions || []) {
        if (cloud.status === "uploading") {
          cloud.status = "interrupted";
          cloud.error =
            "Application exited during file upload. Files may remain on the service. No command was submitted by this client after restart.";
          cloud.finishedAt = new Date().toISOString();
          changed = true;
        } else if (cloud.status === "submission_unknown") {
          cloud.error =
            "Submission outcome is unknown. Do not submit again until checking Nebius operation history.";
          changed = true;
        }
      }
      for (const command of run.commands || []) {
        if (command.decision === "approved") {
          command.decision = "expired";
          changed = true;
        }
      }
      if (["planning", "building", "auditing"].includes(run.status)) {
        run.status = "interrupted";
        interruptAudits(run);
        for (const review of run.coordination?.chunkReviews || []) {
          if (review.status === "reviewing") {
            review.status = "failed";
            review.summary =
              "Review interrupted locally; remote completion unconfirmed.";
          }
        }
        for (const assignment of run.coordination?.assignments || []) {
          if (assignment.status === "working") {
            assignment.status = "failed";
            assignment.summary =
              "Local coordination was interrupted. Remote completion is unconfirmed.";
          }
        }
        run.error =
          "The application closed during this run. It will not resume automatically. Remote requests may have continued.";
        changed = true;
      }
      if (changed)
        this.db
          .prepare("UPDATE runs SET data=? WHERE id=?")
          .run(JSON.stringify(run), run.id);
    }
  }
}
