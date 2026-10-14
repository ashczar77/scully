import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { Run } from "../shared/runs";
import {
  validUsageStart,
  validUsageFinish,
  type UsageStart,
  type UsageSnapshot,
} from "../shared/usage";
import {
  defaultUsageAlertPolicy,
  emptyUsageAlertState,
  parseUsageAlertPolicy,
  recordUsageAlerts,
  usagePauseReason,
  type UsageAlertPolicy,
  type UsageAlertSnapshot,
  type UsageAlertState,
} from "../shared/usage-alerts";
import {
  costBudgetReason,
  costExposureNanoUsd,
  emptyCostSettings,
  emptyCostTotals,
  measuredCostNanoUsd,
  parseCostSettings,
  projectedCostNanoUsd,
  resolveModelRate,
  type CostSettings,
  type CostSnapshot,
  type CostTotals,
  type ModelRate,
} from "../shared/model-cost";
import { interruptAudits } from "../shared/audits";
import { summarizeTeamActivity } from "../shared/team-activity";
import type { SavedTeam } from "../shared/teams";
import {
  parseFixedRoster,
  parseSaveFixedTeam,
  rosterMembers,
  starterRoster,
} from "../shared/fixed-teams";
import { inspectFixedCastMigration } from "./fixed-cast-migration";
import { emitMetric, noopSink, type MetricSink } from "../shared/telemetry";
import type { TeamMessage, TeamReply } from "../shared/messages";
import {
  initialTeam,
  parseTask,
  parseTeammate,
  type Task,
  type Workspace,
  type Teammate,
} from "../shared/contracts";
type LibraryTeamRow = {
  id: string;
  familyId: string;
  name: string;
  version: number;
  createdAt: string;
  memberIds: string;
  activeBuilderId: string;
  activeAuditorId: string;
  activeTesterId: string | null;
  deletedAt: string | null;
};
export class Store {
  private db: DatabaseSync;
  constructor(
    path: string,
    private now: () => Date = () => new Date(),
    private migrationSink: MetricSink = noopSink,
    private migrationClock: () => number = () => performance.now(),
  ) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;");
    const version = (
      this.db.prepare("PRAGMA user_version").get() as { user_version: number }
    ).user_version;
    if (version > 11) {
      this.db.close();
      throw new Error("Workspace database is newer than this application");
    }
    this.db.exec(
      "BEGIN; CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, mode TEXT NOT NULL, createdAt TEXT NOT NULL); CREATE TABLE IF NOT EXISTS teammates (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, bio TEXT NOT NULL, instructions TEXT NOT NULL); CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, taskId TEXT NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS usage_requests (id TEXT PRIMARY KEY, runId TEXT NOT NULL, stage TEXT NOT NULL, model TEXT NOT NULL, maxOutputTokens INTEGER NOT NULL, status TEXT NOT NULL, inputTokens INTEGER, outputTokens INTEGER, startedAt TEXT NOT NULL, finishedAt TEXT); CREATE INDEX IF NOT EXISTS usage_run ON usage_requests(runId); CREATE TABLE IF NOT EXISTS usage_totals (runId TEXT PRIMARY KEY, requests INTEGER NOT NULL DEFAULT 0, measured INTEGER NOT NULL DEFAULT 0, unknown INTEGER NOT NULL DEFAULT 0, pending INTEGER NOT NULL DEFAULT 0, inputTokens INTEGER NOT NULL DEFAULT 0, outputTokens INTEGER NOT NULL DEFAULT 0, pendingMaxOutputTokens INTEGER NOT NULL DEFAULT 0); COMMIT;",
    );
    if (version < 4) {
      this.db.exec("BEGIN");
      try {
        const columns = this.db
          .prepare("PRAGMA table_info(usage_totals)")
          .all() as { name: string }[];
        if (!columns.some((column) => column.name === "coreRequests"))
          this.db.exec(
            "ALTER TABLE usage_totals ADD COLUMN coreRequests INTEGER NOT NULL DEFAULT 0",
          );
        this.db.exec(
          "UPDATE usage_totals SET coreRequests=(SELECT COUNT(*) FROM usage_requests WHERE usage_requests.runId=usage_totals.runId AND stage NOT IN ('answer_question','specialist_audit','consult_specialist'))",
        );
        this.db.exec("PRAGMA user_version=4; COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    if (version < 5) {
      this.db.exec("BEGIN");
      try {
        this.db.exec(
          "CREATE TABLE IF NOT EXISTS usage_alerts (runId TEXT PRIMARY KEY, policy TEXT NOT NULL, state TEXT NOT NULL); ALTER TABLE usage_requests ADD COLUMN reservationTokens INTEGER NOT NULL DEFAULT 8192; ALTER TABLE usage_totals ADD COLUMN reservedTokens INTEGER NOT NULL DEFAULT 0; UPDATE usage_totals SET reservedTokens=pending*8192; PRAGMA user_version=5; COMMIT",
        );
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    if (version < 6) {
      this.db.exec("BEGIN");
      try {
        this.db.exec(
          "CREATE TABLE IF NOT EXISTS usage_cost_settings (runId TEXT PRIMARY KEY, budgetCents INTEGER, manualRate TEXT); CREATE TABLE IF NOT EXISTS usage_cost_totals (runId TEXT PRIMARY KEY, verifiedNanoUsd INTEGER NOT NULL DEFAULT 0, estimatedNanoUsd INTEGER NOT NULL DEFAULT 0, unpricedMeasured INTEGER NOT NULL DEFAULT 0, unknownUsage INTEGER NOT NULL DEFAULT 0, pendingProjectedNanoUsd INTEGER NOT NULL DEFAULT 0, unpricedPending INTEGER NOT NULL DEFAULT 0); ALTER TABLE usage_requests ADD COLUMN costRate TEXT; ALTER TABLE usage_requests ADD COLUMN reservedCostNanoUsd INTEGER; INSERT OR IGNORE INTO usage_cost_totals (runId,unpricedMeasured,unknownUsage,unpricedPending) SELECT runId,measured,unknown,pending FROM usage_totals; PRAGMA user_version=6; COMMIT",
        );
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    if (version < 7) {
      this.db.exec("BEGIN");
      try {
        this.db.exec(
          "ALTER TABLE teammates ADD COLUMN portraitId TEXT NOT NULL DEFAULT 'portrait-01'; UPDATE teammates SET portraitId='portrait-02' WHERE id='ellis'; UPDATE teammates SET portraitId='portrait-03' WHERE id='jun'; PRAGMA user_version=7; COMMIT",
        );
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    if (version < 8) {
      this.db.exec("BEGIN");
      try {
        this.db.exec(
          "CREATE TABLE saved_teams (id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL, createdAt TEXT NOT NULL, members TEXT NOT NULL); CREATE UNIQUE INDEX saved_team_name_version ON saved_teams(name,version); CREATE TABLE team_default (singleton INTEGER PRIMARY KEY CHECK(singleton=1), teamId TEXT NOT NULL); CREATE TABLE task_teams (taskId TEXT PRIMARY KEY, teamId TEXT NOT NULL)",
        );
        const existing = this.db
          .prepare("SELECT * FROM teammates ORDER BY rowid")
          .all() as Teammate[];
        const members = [
          ...existing,
          ...initialTeam.filter(
            (member) => !existing.some((saved) => saved.id === member.id),
          ),
        ];
        const id = randomUUID();
        this.db
          .prepare("INSERT INTO saved_teams VALUES (?,?,?,?,?)")
          .run(
            id,
            "Scully team",
            1,
            this.now().toISOString(),
            JSON.stringify(members),
          );
        this.db.prepare("INSERT INTO team_default VALUES (1,?)").run(id);
        this.db
          .prepare("INSERT INTO task_teams SELECT id,? FROM tasks")
          .run(id);
        this.db.exec("PRAGMA user_version=8; COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    if (version < 9) {
      this.db.exec("BEGIN");
      try {
        this.db.exec(
          "ALTER TABLE saved_teams ADD COLUMN familyId TEXT; UPDATE saved_teams SET familyId=(SELECT first.id FROM saved_teams AS first WHERE first.name=saved_teams.name ORDER BY first.rowid LIMIT 1); CREATE INDEX saved_team_family ON saved_teams(familyId); PRAGMA user_version=9; COMMIT",
        );
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    if (version < 10) {
      this.db.exec("BEGIN");
      try {
        this.db.exec(
          "CREATE TABLE team_library (id TEXT PRIMARY KEY, familyId TEXT NOT NULL UNIQUE, name TEXT NOT NULL, version INTEGER NOT NULL, createdAt TEXT NOT NULL, members TEXT NOT NULL, deletedAt TEXT); CREATE INDEX team_library_available ON team_library(deletedAt); DROP INDEX IF EXISTS saved_team_name_version; PRAGMA user_version=10",
        );
        const rows = this.db
          .prepare("SELECT * FROM saved_teams ORDER BY rowid DESC")
          .all() as {
          id: string;
          familyId: string;
          name: string;
          version: number;
          createdAt: string;
          members: string;
        }[];
        const oldDefault = this.db
          .prepare("SELECT teamId FROM team_default WHERE singleton=1")
          .get() as { teamId: string };
        const selected = rows.find((row) => row.id === oldDefault.teamId);
        if (!selected) throw new Error("Default team is missing");
        const families = new Map<string, (typeof rows)[number]>();
        for (const row of rows)
          if (!families.has(row.familyId)) families.set(row.familyId, row);
        families.set(selected.familyId, selected);
        let currentId = "";
        const insert = this.db.prepare(
          "INSERT INTO team_library VALUES (?,?,?,?,?,?,NULL)",
        );
        for (const row of families.values()) {
          const id = randomUUID();
          insert.run(
            id,
            row.familyId,
            row.name,
            row.version,
            row.createdAt,
            row.members,
          );
          if (row.familyId === selected.familyId) currentId = id;
        }
        this.db
          .prepare("UPDATE team_default SET teamId=? WHERE singleton=1")
          .run(currentId);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    if (version < 11) {
      let started = 0;
      try {
        started = this.migrationClock();
      } catch {
        /* optional diagnostics */
      }
      let outcome: "returned" | "threw" = "threw";
      this.db.exec("BEGIN");
      try {
        inspectFixedCastMigration(this.db);
        this.db.exec(
          "CREATE TABLE team_library_fixed (id TEXT PRIMARY KEY, familyId TEXT NOT NULL UNIQUE, name TEXT NOT NULL, version INTEGER NOT NULL, createdAt TEXT NOT NULL, memberIds TEXT NOT NULL, activeBuilderId TEXT NOT NULL, activeAuditorId TEXT NOT NULL, activeTesterId TEXT, deletedAt TEXT);",
        );
        const id = randomUUID();
        this.db
          .prepare(
            "INSERT INTO team_library_fixed VALUES (?,?,?,?,?,?,?,?,?,NULL)",
          )
          .run(
            id,
            randomUUID(),
            "Scully team",
            1,
            this.now().toISOString(),
            JSON.stringify(starterRoster.memberIds),
            starterRoster.activeBuilderId,
            starterRoster.activeAuditorId,
            starterRoster.activeTesterId,
          );
        this.db.exec(
          "DROP TABLE team_library; ALTER TABLE team_library_fixed RENAME TO team_library; CREATE INDEX team_library_available ON team_library(deletedAt)",
        );
        this.db
          .prepare("UPDATE team_default SET teamId=? WHERE singleton=1")
          .run(id);
        this.db.exec("PRAGMA user_version=11; COMMIT");
        outcome = "returned";
      } catch (error) {
        this.db.exec("ROLLBACK");
        this.db.close();
        throw error;
      } finally {
        try {
          emitMetric(this.migrationSink, {
            version: 1,
            operation: "team:migrate",
            outcome,
            durationMs: Math.max(0, this.migrationClock() - started),
          });
        } catch {
          /* optional diagnostics */
        }
      }
    }
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO teammates (id,name,role,bio,instructions,portraitId) VALUES (?, ?, ?, ?, ?, ?)",
    );
    initialTeam.forEach((t) =>
      insert.run(t.id, t.name, t.role, t.bio, t.instructions, t.portraitId),
    );
  }
  load(): Workspace {
    const defaultTeam = this.defaultTeam();
    return {
      tasks: this.db
        .prepare(
          "SELECT tasks.*, task_teams.teamId AS teamConfigId FROM tasks LEFT JOIN task_teams ON task_teams.taskId=tasks.id ORDER BY tasks.createdAt DESC, tasks.rowid DESC",
        )
        .all() as Task[],
      teammates: defaultTeam.members,
      savedTeams: this.savedTeams(),
      defaultTeamId: defaultTeam.id,
      activity: summarizeTeamActivity(
        this.db
          .prepare(
            "SELECT CASE WHEN length(CAST(data AS BLOB)) <= 2000000 THEN data ELSE NULL END AS data FROM runs ORDER BY rowid DESC LIMIT 2001",
          )
          .iterate() as Iterable<{ data: string | null }>,
      ),
    };
  }
  createTask(value: unknown): Task {
    const input = parseTask(value);
    const team = this.defaultTeam();
    const task = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      teamConfigId: randomUUID(),
    };
    this.db.exec("BEGIN");
    try {
      this.insertTaskSnapshot(task.teamConfigId, team);
      this.db
        .prepare("INSERT INTO tasks VALUES (?, ?, ?, ?, ?)")
        .run(task.id, task.title, task.description, task.mode, task.createdAt);
      this.db
        .prepare("INSERT INTO task_teams VALUES (?,?)")
        .run(task.id, task.teamConfigId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return task;
  }
  updateTask(id: unknown, value: unknown): Task {
    if (typeof id !== "string" || id.length > 100)
      throw new Error("Invalid task ID");
    const input = parseTask(value);
    const current = this.db
      .prepare("SELECT * FROM tasks WHERE id=?")
      .get(id) as Task | undefined;
    if (!current) throw new Error("Task not found");
    const runs = this.runs(id);
    if (runs.some((run) => this.runIsInFlight(run)))
      throw new Error("Stop in-flight work before editing this task");
    if (runs.length && input.mode !== current.mode)
      throw new Error("The start mode is locked after preparing a run");
    this.db.exec("BEGIN");
    try {
      const saveSnapshot = this.db.prepare("UPDATE runs SET data=? WHERE id=?");
      for (const run of runs)
        if (!run.taskSnapshot) {
          run.taskSnapshot = {
            title: current.title,
            description: current.description,
            mode: current.mode,
          };
          saveSnapshot.run(JSON.stringify(run), run.id);
        }
      this.db
        .prepare("UPDATE tasks SET title=?, description=?, mode=? WHERE id=?")
        .run(input.title, input.description, input.mode, id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { ...current, ...input, teamConfigId: this.teamForTask(id).id };
  }
  private runIsInFlight(run: Run): boolean {
    return (
      ["planning", "building", "auditing"].includes(run.status) ||
      !!run.replies?.some((reply) => reply.status === "answering") ||
      !!run.consultations?.some((consult) => consult.status === "consulting") ||
      !!run.executions?.some((execution) => execution.status === "running") ||
      !!run.cloudExecutions?.some((execution) =>
        ["uploading", "submission_unknown", "submitted"].includes(
          execution.status,
        ),
      ) ||
      !!this.db
        .prepare(
          "SELECT 1 FROM usage_requests WHERE runId=? AND status='pending' LIMIT 1",
        )
        .get(run.id)
    );
  }
  deleteTask(id: unknown): { deletedRuns: number } {
    if (typeof id !== "string" || id.length > 100)
      throw new Error("Invalid task ID");
    if (!this.db.prepare("SELECT 1 FROM tasks WHERE id=?").get(id))
      throw new Error("Task not found");
    const runs = this.runs(id);
    if (runs.some((run) => this.runIsInFlight(run)))
      throw new Error("Stop in-flight work before deleting this task");
    if (
      runs.some(
        (run) =>
          run.status !== "prepared" ||
          run.calls !== 0 ||
          this.usageForRun(run.id).requests !== 0,
      )
    )
      throw new Error(
        "This task has saved work. Keep its run and recovery records until archive support is available.",
      );
    this.db.exec("BEGIN");
    try {
      for (const run of runs) {
        for (const table of [
          "usage_requests",
          "usage_totals",
          "usage_alerts",
          "usage_cost_settings",
          "usage_cost_totals",
        ])
          this.db.prepare(`DELETE FROM ${table} WHERE runId=?`).run(run.id);
      }
      this.db.prepare("DELETE FROM runs WHERE taskId=?").run(id);
      this.db.prepare("DELETE FROM task_teams WHERE taskId=?").run(id);
      this.db.prepare("DELETE FROM tasks WHERE id=?").run(id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { deletedRuns: runs.length };
  }
  updateTeammate(value: unknown): Teammate {
    void value;
    throw new Error("Built-in character profiles cannot be edited");
  }
  applyTeamStyle(value: unknown): Teammate[] {
    void value;
    throw new Error("Built-in character profiles cannot be edited");
  }
  savedTeams(): SavedTeam[] {
    const library = (
      this.db
        .prepare("SELECT * FROM team_library ORDER BY rowid DESC")
        .all() as LibraryTeamRow[]
    ).map((row) => this.libraryTeam(row));
    const snapshots = (
      this.db
        .prepare("SELECT * FROM saved_teams ORDER BY rowid DESC")
        .all() as {
        id: string;
        name: string;
        version: number;
        createdAt: string;
        members: string;
        familyId: string;
      }[]
    ).map((row) => ({
      ...row,
      kind: "snapshot" as const,
      members: this.snapshotMembers(row.members),
    }));
    return [...library, ...snapshots];
  }
  private snapshotMembers(json: string): Teammate[] {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value) || value.length < 2 || value.length > 16)
      throw new Error("Saved team snapshot is invalid");
    const members = value.map(parseTeammate);
    if (new Set(members.map(({ id }) => id)).size !== members.length)
      throw new Error("Saved team snapshot has duplicate members");
    return members;
  }
  private libraryTeam(row: LibraryTeamRow): SavedTeam {
    const roster = parseFixedRoster({
      memberIds: JSON.parse(row.memberIds),
      activeBuilderId: row.activeBuilderId,
      activeAuditorId: row.activeAuditorId,
      activeTesterId: row.activeTesterId,
    });
    return {
      id: row.id,
      familyId: row.familyId,
      kind: "library",
      deletedAt: row.deletedAt,
      name: row.name,
      version: row.version,
      createdAt: row.createdAt,
      roster,
      members: rosterMembers(roster),
    };
  }
  private insertTaskSnapshot(id: string, team: SavedTeam) {
    this.db
      .prepare(
        "INSERT INTO saved_teams (id,name,version,createdAt,members,familyId) VALUES (?,?,?,?,?,?)",
      )
      .run(
        id,
        team.name,
        team.version,
        team.createdAt,
        JSON.stringify(team.members),
        team.familyId || team.id,
      );
  }
  private getLibraryTeam(id: string): SavedTeam {
    const row = this.db
      .prepare("SELECT * FROM team_library WHERE id=?")
      .get(id) as LibraryTeamRow | undefined;
    if (!row) throw new Error("Saved team not found");
    return this.libraryTeam(row);
  }
  private getTeam(id: string): SavedTeam {
    const row = this.db
      .prepare("SELECT * FROM saved_teams WHERE id=?")
      .get(id) as
      | {
          id: string;
          name: string;
          version: number;
          createdAt: string;
          members: string;
          familyId: string;
        }
      | undefined;
    if (!row) throw new Error("Saved team not found");
    return {
      ...row,
      members: this.snapshotMembers(row.members),
    };
  }
  defaultTeam(): SavedTeam {
    const row = this.db
      .prepare("SELECT teamId FROM team_default WHERE singleton=1")
      .get() as { teamId: string } | undefined;
    if (!row) throw new Error("Default team is missing");
    const team = this.getLibraryTeam(row.teamId);
    if (team.deletedAt) throw new Error("Default team is deleted");
    return team;
  }
  teamForTask(taskId: string): SavedTeam {
    const row = this.db
      .prepare("SELECT teamId FROM task_teams WHERE taskId=?")
      .get(taskId) as { teamId: string } | undefined;
    if (!row) throw new Error("Task team is missing");
    return this.getTeam(row.teamId);
  }
  saveTeam(value: unknown): SavedTeam {
    const input = parseSaveFixedTeam(value);
    const current = this.defaultTeam();
    const mode =
      input.saveMode ||
      (input.name.toLowerCase() === current.name.toLowerCase()
        ? "overwrite"
        : "new");
    if (
      input.expectedDefaultTeamId &&
      input.expectedDefaultTeamId !== current.id
    )
      throw new Error("The current team changed. Review it before saving.");
    this.db.exec("BEGIN");
    try {
      if (
        this.db
          .prepare(
            "SELECT 1 FROM team_library WHERE deletedAt IS NULL AND lower(name)=lower(?) AND id<>?",
          )
          .get(input.name, mode === "overwrite" ? current.id : "")
      )
        throw new Error(
          mode === "new"
            ? "Use a different name for a new team"
            : "A saved team already uses that name",
        );
      let next: SavedTeam;
      if (mode === "new") {
        const count = (
          this.db
            .prepare(
              "SELECT COUNT(*) AS count FROM team_library WHERE deletedAt IS NULL",
            )
            .get() as { count: number }
        ).count;
        if (count >= 20)
          throw new Error(
            "You can have up to 20 available teams. Delete a team before creating another.",
          );
        next = {
          id: randomUUID(),
          familyId: randomUUID(),
          kind: "library",
          deletedAt: null,
          name: input.name,
          version: 1,
          createdAt: this.now().toISOString(),
          roster: {
            memberIds: input.memberIds,
            activeBuilderId: input.activeBuilderId,
            activeAuditorId: input.activeAuditorId,
            activeTesterId: input.activeTesterId,
          },
          members: rosterMembers(input),
        };
        this.db
          .prepare("INSERT INTO team_library VALUES (?,?,?,?,?,?,?,?,?,NULL)")
          .run(
            next.id,
            next.familyId || next.id,
            next.name,
            next.version,
            next.createdAt,
            JSON.stringify(input.memberIds),
            input.activeBuilderId,
            input.activeAuditorId,
            input.activeTesterId,
          );
      } else {
        next = {
          ...current,
          name: input.name,
          roster: {
            memberIds: input.memberIds,
            activeBuilderId: input.activeBuilderId,
            activeAuditorId: input.activeAuditorId,
            activeTesterId: input.activeTesterId,
          },
          members: rosterMembers(input),
          version: current.version + 1,
        };
        this.db
          .prepare(
            "UPDATE team_library SET name=?, version=?, memberIds=?, activeBuilderId=?, activeAuditorId=?, activeTesterId=? WHERE id=? AND deletedAt IS NULL",
          )
          .run(
            next.name,
            next.version,
            JSON.stringify(input.memberIds),
            input.activeBuilderId,
            input.activeAuditorId,
            input.activeTesterId,
            next.id,
          );
      }
      this.applyDefaultTeam(next);
      this.db.exec("COMMIT");
      return next;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  setDefaultTeam(id: unknown): SavedTeam {
    if (typeof id !== "string" || id.length > 100)
      throw new Error("Invalid team ID");
    const team = this.getLibraryTeam(id);
    if (team.deletedAt) throw new Error("Deleted team cannot be selected");
    this.db.exec("BEGIN");
    try {
      this.applyDefaultTeam(team);
      this.db.exec("COMMIT");
      return team;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  deleteTeam(id: unknown): SavedTeam {
    if (typeof id !== "string" || !id || id.length > 100)
      throw new Error("Invalid team ID");
    this.db.exec("BEGIN");
    try {
      const team = this.getLibraryTeam(id);
      if (team.deletedAt) throw new Error("Team is already deleted");
      if (this.defaultTeam().id === id)
        throw new Error(
          "Choose another team for new tasks before deleting this one",
        );
      const deletedAt = this.now().toISOString();
      this.db
        .prepare("UPDATE team_library SET deletedAt=? WHERE id=?")
        .run(deletedAt, id);
      this.db.exec("COMMIT");
      return { ...team, deletedAt };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  restoreTeam(id: unknown): SavedTeam {
    if (typeof id !== "string" || !id || id.length > 100)
      throw new Error("Invalid team ID");
    this.db.exec("BEGIN");
    try {
      const team = this.getLibraryTeam(id);
      if (!team.deletedAt) throw new Error("Team is already available");
      const count = (
        this.db
          .prepare(
            "SELECT COUNT(*) AS count FROM team_library WHERE deletedAt IS NULL",
          )
          .get() as { count: number }
      ).count;
      if (count >= 20)
        throw new Error(
          "You can have up to 20 available teams. Delete one before restoring another.",
        );
      if (
        this.db
          .prepare(
            "SELECT 1 FROM team_library WHERE deletedAt IS NULL AND lower(name)=lower(?)",
          )
          .get(team.name)
      )
        throw new Error("An available team already uses that name");
      this.db
        .prepare("UPDATE team_library SET deletedAt=NULL WHERE id=?")
        .run(id);
      this.db.exec("COMMIT");
      return { ...team, deletedAt: null };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private applyDefaultTeam(team: SavedTeam) {
    this.db
      .prepare("UPDATE team_default SET teamId=? WHERE singleton=1")
      .run(team.id);
  }
  close() {
    this.db.close();
  }
  private alertRow(runId: string): UsageAlertSnapshot {
    const row = this.db
      .prepare("SELECT policy,state FROM usage_alerts WHERE runId=?")
      .get(runId) as { policy: string; state: string } | undefined;
    if (row)
      return {
        policy: JSON.parse(row.policy) as UsageAlertPolicy,
        state: JSON.parse(row.state) as UsageAlertState,
      };
    const snapshot = {
      policy: defaultUsageAlertPolicy,
      state: emptyUsageAlertState(),
    };
    this.db
      .prepare("INSERT OR IGNORE INTO usage_alerts VALUES (?,?,?)")
      .run(
        runId,
        JSON.stringify(snapshot.policy),
        JSON.stringify(snapshot.state),
      );
    return snapshot;
  }
  private writeAlertRow(runId: string, value: UsageAlertSnapshot) {
    this.db
      .prepare("UPDATE usage_alerts SET policy=?,state=? WHERE runId=?")
      .run(JSON.stringify(value.policy), JSON.stringify(value.state), runId);
  }
  alertsForRun(id: unknown): UsageAlertSnapshot {
    const run = this.getRun(id);
    return {
      ...this.alertRow(run.id),
      reservedTokens: this.reservedForRun(run.id),
    };
  }
  configureUsageAlerts(id: unknown, value: unknown) {
    const run = this.getRun(id);
    const policy = parseUsageAlertPolicy(value);
    if (
      policy.requestAllowanceTokens <
      (run.usagePolicy?.outputTokens || run.outputTokens || 2048)
    )
      throw new Error("Request allowance must cover maximum output tokens");
    const current = this.alertRow(run.id);
    this.writeAlertRow(run.id, { policy, state: current.state });
    return this.alertsForRun(run.id);
  }
  private reservedForRun(runId: string) {
    const row = this.db
      .prepare("SELECT reservedTokens FROM usage_totals WHERE runId=?")
      .get(runId) as { reservedTokens: number } | undefined;
    return row?.reservedTokens || 0;
  }
  private costSettingsRow(runId: string): CostSettings {
    const row = this.db
      .prepare(
        "SELECT budgetCents,manualRate FROM usage_cost_settings WHERE runId=?",
      )
      .get(runId) as
      { budgetCents: number | null; manualRate: string | null } | undefined;
    if (!row) return emptyCostSettings;
    return {
      budgetCents: row.budgetCents,
      manualRate: row.manualRate
        ? (JSON.parse(row.manualRate) as ModelRate)
        : null,
    };
  }
  private costTotalsRow(runId: string): CostTotals {
    return (
      (this.db
        .prepare(
          "SELECT verifiedNanoUsd,estimatedNanoUsd,unpricedMeasured,unknownUsage,pendingProjectedNanoUsd,unpricedPending FROM usage_cost_totals WHERE runId=?",
        )
        .get(runId) as CostTotals | undefined) || emptyCostTotals
    );
  }
  costForRun(id: unknown, model: string): CostSnapshot {
    const run = this.getRun(id);
    const settings = this.costSettingsRow(run.id);
    const totals = this.costTotalsRow(run.id);
    const active = resolveModelRate(model, settings, this.now());
    const allowance = Math.max(
      this.alertRow(run.id).policy.requestAllowanceTokens,
      run.usagePolicy?.outputTokens || run.outputTokens || 2048,
    );
    const nextProjectedNanoUsd = active.rate
      ? projectedCostNanoUsd(allowance, active.rate)
      : null;
    return {
      model,
      settings,
      totals,
      ...active,
      nextProjectedNanoUsd,
      budgetExposureNanoUsd: costExposureNanoUsd(
        totals,
        nextProjectedNanoUsd || 0,
      ),
    };
  }
  configureCost(id: unknown, model: string, value: unknown) {
    const run = this.getRun(id);
    const settings = parseCostSettings(value, model);
    const manual = settings.manualRate;
    if (manual) {
      const fresh = resolveModelRate(model, settings, this.now());
      if (fresh.rateStatus === "stale")
        throw new Error("Rate checked date must be within the last 30 days");
    }
    const previous = this.costSettingsRow(run.id);
    this.db
      .prepare(
        "INSERT INTO usage_cost_settings (runId,budgetCents,manualRate) VALUES (?,?,?) ON CONFLICT(runId) DO UPDATE SET budgetCents=excluded.budgetCents,manualRate=excluded.manualRate",
      )
      .run(
        run.id,
        settings.budgetCents,
        manual ? JSON.stringify(manual) : null,
      );
    if (JSON.stringify(previous) !== JSON.stringify(settings)) {
      const alerts = this.alertRow(run.id);
      alerts.state.costUnknownWarned = false;
      alerts.state.costBudgetWarned = false;
      this.writeAlertRow(run.id, alerts);
    }
    return this.costForRun(run.id, model);
  }
  private insertUsage(
    runId: string,
    value: UsageStart,
    reservationTokens = value.maxOutputTokens,
    rate: ModelRate | null = null,
  ) {
    const totals = this.usageForRun(runId);
    if (totals.requests >= 64 || totals.pending >= 16) return false;
    const inserted = this.db
      .prepare(
        "INSERT OR IGNORE INTO usage_requests (id,runId,stage,model,maxOutputTokens,reservationTokens,costRate,reservedCostNanoUsd,status,startedAt) VALUES (?,?,?,?,?,?,?,?,'pending',?)",
      )
      .run(
        value.id,
        runId,
        value.stage,
        value.model,
        value.maxOutputTokens,
        reservationTokens,
        rate ? JSON.stringify(rate) : null,
        rate ? projectedCostNanoUsd(reservationTokens, rate) : null,
        new Date().toISOString(),
      );
    if (inserted.changes) {
      this.db
        .prepare(
          "INSERT INTO usage_totals (runId,requests,pending,pendingMaxOutputTokens,coreRequests,reservedTokens) VALUES (?,1,1,?,?,?) ON CONFLICT(runId) DO UPDATE SET requests=requests+1,pending=pending+1,pendingMaxOutputTokens=pendingMaxOutputTokens+excluded.pendingMaxOutputTokens,coreRequests=coreRequests+excluded.coreRequests,reservedTokens=reservedTokens+excluded.reservedTokens",
        )
        .run(
          runId,
          value.maxOutputTokens,
          value.stage === "answer_question" ||
            value.stage === "specialist_audit" ||
            value.stage === "consult_specialist"
            ? 0
            : 1,
          reservationTokens,
        );
      this.db
        .prepare(
          "INSERT INTO usage_cost_totals (runId,pendingProjectedNanoUsd,unpricedPending) VALUES (?,?,?) ON CONFLICT(runId) DO UPDATE SET pendingProjectedNanoUsd=pendingProjectedNanoUsd+excluded.pendingProjectedNanoUsd,unpricedPending=unpricedPending+excluded.unpricedPending",
        )
        .run(
          runId,
          rate ? projectedCostNanoUsd(reservationTokens, rate) : 0,
          rate ? 0 : 1,
        );
    }
    return inserted.changes > 0;
  }
  startUsage(runId: string, value: unknown) {
    this.getRun(runId);
    if (!validUsageStart(value)) return false;
    this.db.exec("BEGIN");
    try {
      const inserted = this.insertUsage(runId, value);
      this.db.exec("COMMIT");
      return inserted;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  reserveUsage(
    runId: string,
    value: unknown,
    pauseId?: unknown,
  ): "allowed" | "paused" | "rejected" {
    this.getRun(runId);
    if (!validUsageStart(value)) return "rejected";
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const alerts = this.alertRow(runId);
      if (
        pauseId !== undefined &&
        (typeof pauseId !== "string" ||
          !alerts.state.pauseId ||
          alerts.state.pauseId !== pauseId)
      ) {
        this.db.exec("COMMIT");
        return "rejected";
      }
      const usage = this.usageForRun(runId);
      const reserved = this.reservedForRun(runId);
      const allowance = Math.max(
        alerts.policy.requestAllowanceTokens,
        value.maxOutputTokens,
      );
      const costSettings = this.costSettingsRow(runId);
      const rate = resolveModelRate(value.model, costSettings, this.now()).rate;
      const costReason = costBudgetReason(
        costSettings.budgetCents,
        this.costTotalsRow(runId),
        rate ? projectedCostNanoUsd(allowance, rate) : null,
      );
      if (costReason) {
        const field =
          costReason === "cost_unknown"
            ? "costUnknownWarned"
            : "costBudgetWarned";
        if (!alerts.state[field]) {
          alerts.state[field] = true;
          alerts.state.sequence++;
          alerts.state.latest = {
            kind: costReason,
            text:
              (costReason === "cost_unknown"
                ? "Model cost cannot be estimated completely before the next request."
                : "Projected model cost reaches the run's USD warning budget before the next request.") +
              (alerts.policy.mode === "warn"
                ? " Warning-only mode permits it."
                : ""),
            at: this.now().toISOString(),
            sequence: alerts.state.sequence,
          };
          alerts.state.recent = [
            ...alerts.state.recent,
            alerts.state.latest,
          ].slice(-10);
        }
      }
      const tokenReason = usagePauseReason(
        alerts.policy,
        usage,
        reserved,
        allowance,
      );
      const reason =
        tokenReason || (alerts.policy.mode === "pause" ? costReason : null);
      if (reason && pauseId === undefined) {
        if (!alerts.state.pauseId) alerts.state.pauseId = randomUUID();
        alerts.state.pauseReason = reason;
        const field =
          reason === "unknown"
            ? "unknownWarned"
            : reason === "budget"
              ? "budgetWarned"
              : reason === "cost_unknown"
                ? "costUnknownWarned"
                : "costBudgetWarned";
        if (!alerts.state[field]) {
          alerts.state[field] = true;
          alerts.state.sequence++;
          alerts.state.latest = {
            kind: reason,
            text:
              reason === "unknown"
                ? "Earlier request usage is unknown. Review before another request."
                : reason === "budget"
                  ? "The next request allowance reaches the run token budget."
                  : reason === "cost_unknown"
                    ? "Model cost cannot be estimated completely before the next request."
                    : "Projected model cost reaches the run's USD warning budget before the next request.",
            at: new Date().toISOString(),
            sequence: alerts.state.sequence,
          };
          alerts.state.recent = [
            ...alerts.state.recent,
            alerts.state.latest,
          ].slice(-10);
        }
        this.writeAlertRow(runId, alerts);
        this.db.exec("COMMIT");
        return "paused";
      }
      if (alerts.policy.mode === "warn") {
        const projected =
          usage.inputTokens + usage.outputTokens + reserved + allowance;
        const reason =
          usage.unknown > 0 && !alerts.state.unknownWarned
            ? "unknown"
            : projected >= alerts.policy.budgetTokens &&
                !alerts.state.budgetWarned
              ? "budget"
              : null;
        if (reason) {
          alerts.state[
            reason === "unknown" ? "unknownWarned" : "budgetWarned"
          ] = true;
          alerts.state.sequence++;
          alerts.state.latest = {
            kind: reason,
            text:
              reason === "unknown"
                ? "Earlier request usage is unknown. Warning-only mode permits the next request."
                : "The next request allowance reaches the run token budget. Warning-only mode permits it.",
            at: new Date().toISOString(),
            sequence: alerts.state.sequence,
          };
          alerts.state.recent = [
            ...alerts.state.recent,
            alerts.state.latest,
          ].slice(-10);
        }
      }
      if (!this.insertUsage(runId, value, allowance, rate)) {
        this.db.exec("COMMIT");
        return "rejected";
      }
      alerts.state.pauseId = null;
      alerts.state.pauseReason = null;
      alerts.state = recordUsageAlerts(
        alerts.policy,
        alerts.state,
        this.usageForRun(runId),
        new Date().toISOString(),
        undefined,
        this.reservedForRun(runId),
      );
      this.writeAlertRow(runId, alerts);
      this.db.exec("COMMIT");
      return "allowed";
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  finishUsage(
    runId: string,
    value: unknown,
    scope?: "reply" | "consult" | "coordinator",
  ) {
    if (!validUsageFinish(value)) return false;
    this.db.exec("BEGIN");
    try {
      const row = this.db
        .prepare(
          "SELECT model,maxOutputTokens,reservationTokens,stage,costRate,reservedCostNanoUsd FROM usage_requests WHERE id=? AND runId=? AND status='pending'",
        )
        .get(value.id, runId) as
        | {
            model: string;
            maxOutputTokens: number;
            reservationTokens: number;
            stage: string;
            costRate: string | null;
            reservedCostNanoUsd: number | null;
          }
        | undefined;
      if (
        row &&
        ((scope === "reply" && row.stage !== "answer_question") ||
          (scope === "consult" && row.stage !== "consult_specialist") ||
          (scope === "coordinator" &&
            ["answer_question", "consult_specialist"].includes(row.stage)))
      ) {
        this.db.exec("COMMIT");
        return false;
      }
      if (!row) {
        this.db.exec("COMMIT");
        return false;
      }
      const usage = value.usage;
      this.db
        .prepare(
          "UPDATE usage_requests SET status=?,inputTokens=?,outputTokens=?,finishedAt=? WHERE id=? AND runId=?",
        )
        .run(
          usage ? "measured" : "unknown",
          usage?.inputTokens ?? null,
          usage?.outputTokens ?? null,
          new Date().toISOString(),
          value.id,
          runId,
        );
      this.db
        .prepare(
          "UPDATE usage_totals SET pending=pending-1,pendingMaxOutputTokens=pendingMaxOutputTokens-?,reservedTokens=reservedTokens-?,measured=measured+?,unknown=unknown+?,inputTokens=inputTokens+?,outputTokens=outputTokens+? WHERE runId=?",
        )
        .run(
          row.maxOutputTokens,
          row.reservationTokens,
          usage ? 1 : 0,
          usage ? 0 : 1,
          usage?.inputTokens ?? 0,
          usage?.outputTokens ?? 0,
          runId,
        );
      let rate: ModelRate | null = null;
      try {
        rate = row.costRate ? (JSON.parse(row.costRate) as ModelRate) : null;
      } catch {
        rate = null;
      }
      if (
        rate &&
        (rate.model !== row.model ||
          !["nebius_listing", "user_supplied"].includes(rate.source))
      )
        rate = null;
      const cost = usage && rate ? measuredCostNanoUsd(usage, rate) : null;
      this.db
        .prepare(
          "UPDATE usage_cost_totals SET pendingProjectedNanoUsd=pendingProjectedNanoUsd-?,unpricedPending=unpricedPending-?,verifiedNanoUsd=verifiedNanoUsd+?,estimatedNanoUsd=estimatedNanoUsd+?,unpricedMeasured=unpricedMeasured+?,unknownUsage=unknownUsage+? WHERE runId=?",
        )
        .run(
          row.reservedCostNanoUsd || 0,
          row.reservedCostNanoUsd === null ? 1 : 0,
          cost !== null && rate?.source === "nebius_listing" ? cost : 0,
          cost !== null && rate?.source === "user_supplied" ? cost : 0,
          usage && cost === null ? 1 : 0,
          usage ? 0 : 1,
          runId,
        );
      const alerts = this.alertRow(runId);
      alerts.state = recordUsageAlerts(
        alerts.policy,
        alerts.state,
        this.usageForRun(runId),
        new Date().toISOString(),
        usage ? usage.inputTokens + usage.outputTokens : undefined,
        this.reservedForRun(runId),
      );
      this.writeAlertRow(runId, alerts);
      this.db
        .prepare(
          "DELETE FROM usage_requests WHERE id IN (SELECT id FROM usage_requests WHERE status!='pending' ORDER BY rowid DESC LIMIT -1 OFFSET 10000)",
        )
        .run();
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  usageForRun(id: unknown): UsageSnapshot {
    const run = this.getRun(id);
    return (
      (this.db
        .prepare(
          "SELECT requests,measured,unknown,pending,inputTokens,outputTokens,pendingMaxOutputTokens FROM usage_totals WHERE runId=?",
        )
        .get(run.id) as UsageSnapshot | undefined) || {
        requests: 0,
        measured: 0,
        unknown: 0,
        pending: 0,
        inputTokens: 0,
        outputTokens: 0,
        pendingMaxOutputTokens: 0,
      }
    );
  }
  coreUsageRequests(id: unknown) {
    const run = this.getRun(id);
    const row = this.db
      .prepare("SELECT coreRequests FROM usage_totals WHERE runId=?")
      .get(run.id) as { coreRequests: number } | undefined;
    return row?.coreRequests || 0;
  }
  interruptUsage(runId?: string, scope?: "reply" | "consult" | "coordinator") {
    const rows = this.db
      .prepare(
        "SELECT id,runId FROM usage_requests WHERE status='pending'" +
          (runId ? " AND runId=?" : "") +
          (scope === "reply"
            ? " AND stage='answer_question'"
            : scope === "consult"
              ? " AND stage='consult_specialist'"
              : scope === "coordinator"
                ? " AND stage NOT IN ('answer_question','consult_specialist')"
                : ""),
      )
      .all(...(runId ? [runId] : [])) as { id: string; runId: string }[];
    for (const row of rows)
      this.finishUsage(row.runId, { id: row.id, usage: null });
  }
  saveRun(run: Run) {
    const saved = this.db
      .prepare("SELECT data FROM runs WHERE id=?")
      .get(run.id) as { data: string } | undefined;
    if (saved) {
      const existing = JSON.parse(saved.data) as Run;
      run.messages = existing.messages;
      run.replies = existing.replies;
      run.consultations = existing.consultations;
      run.approvedAdvice = existing.approvedAdvice;
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
  updateConsultation(
    id: string,
    consultation: import("../shared/consultation").SpecialistConsultation,
  ) {
    const run = this.getRun(id);
    run.consultations = [
      ...(run.consultations || []).filter(
        (item) => item.id !== consultation.id,
      ),
      consultation,
    ];
    this.db
      .prepare("UPDATE runs SET data=? WHERE id=?")
      .run(JSON.stringify(run), id);
    return run;
  }
  updateApprovedAdvice(
    id: string,
    approvals: import("../engine/advice-handoff").AdviceApproval[],
  ) {
    const run = this.getRun(id);
    run.approvedAdvice = approvals;
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
  runIds(requestedLimit = 2_000) {
    const limit =
      Number.isSafeInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 2_000)
        : 2_000;
    const rows = this.db
      .prepare("SELECT id FROM runs ORDER BY rowid LIMIT ?")
      .all(limit + 1) as { id: string }[];
    return {
      ids: rows.slice(0, limit).map((row) => row.id),
      complete: rows.length <= limit,
    };
  }
  recoverRuns() {
    this.interruptUsage();
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
      for (const consult of run.consultations || [])
        if (consult.status === "consulting") {
          consult.status = "failed";
          consult.advice =
            "Application exited during consultation; remote completion unconfirmed.";
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
        run.inFlightRequests = [];
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
