import type { DatabaseSync } from "node:sqlite";
import { fixedCastStarterIds } from "../shared/character-catalog";
import { parseSaveTeam } from "../shared/teams";

export type FixedCastMigrationPlan = {
  readonly fromVersion: 10;
  readonly starterTeamName: "Scully team";
  readonly starterMemberIds: typeof fixedCastStarterIds;
  readonly retiredLibraryIds: readonly string[];
  readonly preservedTaskCount: number;
  readonly preservedRunCount: number;
  readonly preservedSnapshotCount: number;
};

// Read-only preflight for the version 10 to fixed-cast migration. The actual
// SQLite mutation is a later gate, after the schema and fixture are reviewed.
export function inspectFixedCastMigration(
  db: DatabaseSync,
): FixedCastMigrationPlan {
  const version = (
    db.prepare("PRAGMA user_version").get() as { user_version: number }
  ).user_version;
  if (version !== 10)
    throw new Error("Expected a version 10 workspace database");

  const defaultRow = db
    .prepare("SELECT teamId FROM team_default WHERE singleton=1")
    .get() as { teamId: string } | undefined;
  if (
    !defaultRow ||
    !db
      .prepare("SELECT 1 FROM team_library WHERE id=? AND deletedAt IS NULL")
      .get(defaultRow.teamId)
  )
    throw new Error("The current saved team is missing or deleted");

  const missingBindings = db
    .prepare(
      "SELECT tasks.id FROM tasks LEFT JOIN task_teams ON task_teams.taskId=tasks.id LEFT JOIN saved_teams ON saved_teams.id=task_teams.teamId WHERE saved_teams.id IS NULL LIMIT 1",
    )
    .get();
  if (missingBindings) throw new Error("A task has no readable team snapshot");
  const orphanBinding = db
    .prepare(
      "SELECT task_teams.taskId FROM task_teams LEFT JOIN tasks ON tasks.id=task_teams.taskId WHERE tasks.id IS NULL LIMIT 1",
    )
    .get();
  if (orphanBinding) throw new Error("A team snapshot binding has no task");

  const snapshots = db
    .prepare("SELECT name,members FROM saved_teams")
    .all() as {
    name: string;
    members: string;
  }[];
  for (const snapshot of snapshots) {
    try {
      parseSaveTeam({
        name: snapshot.name,
        members: JSON.parse(snapshot.members),
      });
    } catch {
      throw new Error("A saved team snapshot is unreadable");
    }
  }

  const count = (table: "tasks" | "runs" | "saved_teams") =>
    (
      db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
        count: number;
      }
    ).count;
  const retiredLibraryIds = (
    db.prepare("SELECT id FROM team_library ORDER BY rowid").all() as {
      id: string;
    }[]
  ).map(({ id }) => id);
  return {
    fromVersion: 10,
    starterTeamName: "Scully team",
    starterMemberIds: fixedCastStarterIds,
    retiredLibraryIds,
    preservedTaskCount: count("tasks"),
    preservedRunCount: count("runs"),
    preservedSnapshotCount: count("saved_teams"),
  };
}
