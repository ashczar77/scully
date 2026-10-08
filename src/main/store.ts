import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
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
    if (version > 1) {
      this.db.close();
      throw new Error("Workspace database is newer than this application");
    }
    this.db.exec(
      "BEGIN; CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, mode TEXT NOT NULL, createdAt TEXT NOT NULL); CREATE TABLE IF NOT EXISTS teammates (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, bio TEXT NOT NULL, instructions TEXT NOT NULL); PRAGMA user_version=1; COMMIT;",
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
}
