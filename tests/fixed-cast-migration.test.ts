// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { Store } from "../src/main/store";
import { initialTeam } from "../src/shared/contracts";
import { inspectFixedCastMigration } from "../src/main/fixed-cast-migration";
import type { Metric } from "../src/shared/telemetry";

function versionTenFixture(
  run: (db: DatabaseSync, taskId: string, path: string) => void,
) {
  const dir = mkdtempSync(join(tmpdir(), "scully-fixed-cast-preflight-"));
  const path = join(dir, "workspace.sqlite");
  const db = new DatabaseSync(path);
  try {
    db.exec(
      "CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, mode TEXT NOT NULL, createdAt TEXT NOT NULL); CREATE TABLE teammates (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, bio TEXT NOT NULL, instructions TEXT NOT NULL, portraitId TEXT NOT NULL); CREATE TABLE runs (id TEXT PRIMARY KEY, taskId TEXT NOT NULL, data TEXT NOT NULL); CREATE TABLE saved_teams (id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL, createdAt TEXT NOT NULL, members TEXT NOT NULL, familyId TEXT); CREATE TABLE task_teams (taskId TEXT PRIMARY KEY, teamId TEXT NOT NULL); CREATE TABLE team_default (singleton INTEGER PRIMARY KEY, teamId TEXT NOT NULL); CREATE TABLE team_library (id TEXT PRIMARY KEY, familyId TEXT NOT NULL UNIQUE, name TEXT NOT NULL, version INTEGER NOT NULL, createdAt TEXT NOT NULL, members TEXT NOT NULL, deletedAt TEXT); PRAGMA user_version=10",
    );
    db.prepare("INSERT INTO tasks VALUES (?,?,?,?,?)").run(
      "prior-task",
      "Existing work",
      "",
      "plan",
      "2026-10-13T00:00:00Z",
    );
    db.prepare("INSERT INTO saved_teams VALUES (?,?,?,?,?,?)").run(
      "snapshot",
      "Old team",
      1,
      "2026-10-13T00:00:00Z",
      JSON.stringify(initialTeam),
      "family",
    );
    db.prepare("INSERT INTO task_teams VALUES (?,?)").run(
      "prior-task",
      "snapshot",
    );
    db.prepare("INSERT INTO team_library VALUES (?,?,?,?,?,?,NULL)").run(
      "old-library",
      "family",
      "Old team",
      1,
      "2026-10-13T00:00:00Z",
      JSON.stringify(initialTeam),
    );
    db.prepare("INSERT INTO team_default VALUES (1,?)").run("old-library");
    run(db, "prior-task", path);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

it("preflights a version 10 workspace without altering old tasks, runs or team snapshots", () => {
  versionTenFixture((db, taskId) => {
    db.prepare("INSERT INTO runs (id,taskId,data) VALUES (?,?,?)").run(
      "prior-run",
      taskId,
      JSON.stringify({ id: "prior-run", taskId, status: "planned" }),
    );
    const before = {
      tasks: db.prepare("SELECT * FROM tasks").all(),
      runs: db.prepare("SELECT * FROM runs").all(),
      snapshots: db.prepare("SELECT * FROM saved_teams").all(),
      bindings: db.prepare("SELECT * FROM task_teams").all(),
      library: db.prepare("SELECT * FROM team_library").all(),
      version: db.prepare("PRAGMA user_version").get(),
    };
    const plan = inspectFixedCastMigration(db);
    expect(plan).toMatchObject({
      fromVersion: 10,
      starterTeamName: "Scully team",
      starterMemberIds: ["pearl", "maya", "ellis", "jun"],
      preservedTaskCount: 1,
      preservedRunCount: 1,
      preservedSnapshotCount: 1,
    });
    expect(plan.retiredLibraryIds).toEqual(before.library.map((row) => row.id));
    expect(db.prepare("SELECT * FROM tasks").all()).toEqual(before.tasks);
    expect(db.prepare("SELECT * FROM runs").all()).toEqual(before.runs);
    expect(db.prepare("SELECT * FROM saved_teams").all()).toEqual(
      before.snapshots,
    );
    expect(db.prepare("SELECT * FROM task_teams").all()).toEqual(
      before.bindings,
    );
    expect(db.prepare("SELECT * FROM team_library").all()).toEqual(
      before.library,
    );
    expect(db.prepare("PRAGMA user_version").get()).toEqual(before.version);
  });
});

it("migrates only the team library and keeps historical task and run rows across restart", () => {
  versionTenFixture((db, taskId, path) => {
    db.prepare("INSERT INTO runs (id,taskId,data) VALUES (?,?,?)").run(
      "prior-run",
      taskId,
      JSON.stringify({ id: "prior-run", taskId, status: "planned" }),
    );
    const before = {
      tasks: db.prepare("SELECT * FROM tasks").all(),
      runs: db.prepare("SELECT * FROM runs").all(),
      snapshots: db.prepare("SELECT * FROM saved_teams").all(),
      bindings: db.prepare("SELECT * FROM task_teams").all(),
    };
    const metrics: Metric[] = [];
    let tick = 0;
    let store = new Store(
      path,
      undefined,
      (metric) => {
        metrics.push(metric);
        throw new Error("sink offline");
      },
      () => (tick += 5),
    );
    expect(metrics).toEqual([
      {
        version: 1,
        operation: "team:migrate",
        outcome: "returned",
        durationMs: 5,
      },
    ]);
    expect(store.defaultTeam().members.map(({ id }) => id)).toEqual([
      "pearl",
      "maya",
      "ellis",
      "jun",
    ]);
    expect(store.teamForTask(taskId).members).toEqual(initialTeam);
    store.close();
    store = new Store(path);
    expect(store.defaultTeam().roster?.memberIds).toEqual([
      "pearl",
      "maya",
      "ellis",
      "jun",
    ]);
    expect(store.teamForTask(taskId).members).toEqual(initialTeam);
    store.close();
    expect(db.prepare("SELECT * FROM tasks").all()).toEqual(before.tasks);
    expect(db.prepare("SELECT * FROM runs").all()).toEqual(before.runs);
    expect(db.prepare("SELECT * FROM saved_teams").all()).toEqual(
      before.snapshots,
    );
    expect(db.prepare("SELECT * FROM task_teams").all()).toEqual(
      before.bindings,
    );
    expect(
      (db.prepare("PRAGMA user_version").get() as { user_version: number })
        .user_version,
    ).toBe(11);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM team_library").get(),
    ).toMatchObject({ count: 1 });
  });
});

it("stops before migration when a task snapshot is missing", () => {
  versionTenFixture((db) => {
    db.exec("DELETE FROM saved_teams");
    expect(() => inspectFixedCastMigration(db)).toThrow(
      /no readable team snapshot/i,
    );
    expect(
      (db.prepare("PRAGMA user_version").get() as { user_version: number })
        .user_version,
    ).toBe(10);
  });
});

it("rolls back the schema switch when a historical snapshot is unreadable", () => {
  versionTenFixture((db, _taskId, path) => {
    db.prepare("UPDATE saved_teams SET members=? WHERE id=?").run(
      "{broken",
      "snapshot",
    );
    expect(() => new Store(path)).toThrow(/snapshot is unreadable/i);
    expect(
      (db.prepare("PRAGMA user_version").get() as { user_version: number })
        .user_version,
    ).toBe(10);
    expect(db.prepare("SELECT id FROM team_library").all()).toEqual([
      { id: "old-library" },
    ]);
    expect(db.prepare("SELECT teamId FROM team_default").get()).toMatchObject({
      teamId: "old-library",
    });
  });
});

it("stops before migration when the current team is missing or a binding is orphaned", () => {
  versionTenFixture((db) => {
    db.exec("DELETE FROM team_library");
    expect(() => inspectFixedCastMigration(db)).toThrow(/current saved team/i);
  });
  versionTenFixture((db) => {
    const snapshot = db.prepare("SELECT id FROM saved_teams LIMIT 1").get() as {
      id: string;
    };
    db.prepare("INSERT INTO task_teams (taskId,teamId) VALUES (?,?)").run(
      "unknown-task",
      snapshot.id,
    );
    expect(() => inspectFixedCastMigration(db)).toThrow(/binding has no task/i);
  });
});

it("refuses a non-version-10 database", () => {
  versionTenFixture((db) => {
    db.exec("PRAGMA user_version=9");
    expect(() => inspectFixedCastMigration(db)).toThrow(/version 10/i);
  });
});
