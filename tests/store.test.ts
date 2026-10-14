// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { Store } from "../src/main/store";
import { DatabaseSync } from "node:sqlite";
import type { Run } from "../src/shared/runs";
import { initialTeam } from "../src/shared/contracts";
import { defaultUsageAlertPolicy } from "../src/shared/usage-alerts";
import { emptyCostSettings } from "../src/shared/model-cost";

it("persists fixed-cast membership and keeps each earlier task roster after restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "scully-variable-team-"));
  let db: Store | undefined;
  try {
    const path = join(dir, "test.sqlite");
    db = new Store(path);
    const originalTask = db.createTask({
      title: "Original",
      description: "",
      mode: "work",
    });
    const firstSnapshot = db.teamForTask(originalTask.id);
    const originalTeam = db.defaultTeam();
    const lean = db.saveTeam({
      name: originalTeam.name,
      ...originalTeam.roster!,
      memberIds: ["pearl", "maya", "ellis"],
      activeTesterId: null,
      expectedDefaultTeamId: originalTeam.id,
      saveMode: "overwrite",
    });
    const leanTask = db.createTask({
      title: "Lean",
      description: "",
      mode: "work",
    });
    db.saveTeam({
      name: lean.name,
      ...lean.roster!,
      memberIds: [...lean.roster!.memberIds, "sloane"],
      expectedDefaultTeamId: lean.id,
      saveMode: "overwrite",
    });
    db.close();
    db = new Store(path);
    expect(db.defaultTeam().members).toHaveLength(4);
    expect(db.defaultTeam().members.at(-1)).toMatchObject({
      id: "sloane",
      runRole: "reserve",
    });
    expect(db.teamForTask(originalTask.id)).toEqual(firstSnapshot);
    expect(db.teamForTask(leanTask.id).members).toEqual(lean.members);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("updates one library team while preserving task snapshots, deletion recovery and the team limit", () => {
  const dir = mkdtempSync(join(tmpdir(), "scully-team-library-"));
  let db: Store | undefined;
  try {
    const path = join(dir, "test.sqlite");
    db = new Store(path);
    const original = db.defaultTeam();
    const task = db.createTask({
      title: "Before edit",
      description: "",
      mode: "work",
    });
    const snapshot = db.teamForTask(task.id);
    const revised = db.saveTeam({
      name: "Night watch",
      ...original.roster!,
      memberIds: [...original.roster!.memberIds, "meryl"],
      activeAuditorId: "meryl",
      expectedDefaultTeamId: original.id,
      saveMode: "overwrite",
    });
    expect(revised.id).toBe(original.id);
    expect(db.teamForTask(task.id)).toEqual(snapshot);
    expect(
      db.savedTeams().filter((team) => team.kind === "library"),
    ).toHaveLength(1);
    expect(() => db!.deleteTeam(revised.id)).toThrow(/another team/i);
    const separate = db.saveTeam({
      name: "Release",
      ...revised.roster!,
      expectedDefaultTeamId: revised.id,
      saveMode: "new",
    });
    db.setDefaultTeam(separate.id);
    db.deleteTeam(revised.id);
    expect(
      db.savedTeams().find((team) => team.id === revised.id)?.deletedAt,
    ).toBeTruthy();
    expect(() => db!.setDefaultTeam(revised.id)).toThrow();
    db.restoreTeam(revised.id);
    expect(db.teamForTask(task.id)).toEqual(snapshot);
    db.close();
    db = new Store(path);
    expect(db.defaultTeam().id).toBe(separate.id);
    expect(db.teamForTask(task.id)).toEqual(snapshot);
    expect(
      db.savedTeams().filter((team) => team.kind === "library"),
    ).toHaveLength(2);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("limits available teams to 20 and validates deletion and restoration boundaries", () => {
  const dir = mkdtempSync(join(tmpdir(), "scully-team-limit-"));
  let db: Store | undefined;
  try {
    db = new Store(join(dir, "test.sqlite"));
    const first = db.defaultTeam();
    for (let index = 1; index < 20; index++) {
      const current = db.defaultTeam();
      db.saveTeam({
        name: `Team ${index}`,
        ...current.roster!,
        expectedDefaultTeamId: current.id,
        saveMode: "new",
      });
    }
    const current = db.defaultTeam();
    expect(() =>
      db!.saveTeam({
        name: "Team 20",
        ...current.roster!,
        expectedDefaultTeamId: current.id,
        saveMode: "new",
      }),
    ).toThrow(/up to 20/i);
    expect(() => db!.deleteTeam("unknown")).toThrow(/not found/i);
    expect(() => db!.restoreTeam(first.id)).toThrow(/already available/i);
    db.deleteTeam(first.id);
    expect(() => db!.restoreTeam(first.id)).not.toThrow();
    db.deleteTeam(first.id);
    db.saveTeam({
      name: "Replacement",
      ...current.roster!,
      expectedDefaultTeamId: current.id,
      saveMode: "new",
    });
    expect(() => db!.restoreTeam(first.id)).toThrow(/up to 20/i);
    expect(
      db.savedTeams().find((team) => team.id === first.id)?.deletedAt,
    ).toBeTruthy();
    const available = db.defaultTeam();
    expect(() =>
      db!.saveTeam({
        name: "Team 1",
        ...available.roster!,
        expectedDefaultTeamId: first.id,
        saveMode: "overwrite",
      }),
    ).toThrow(/current team changed/i);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("rejects restore when an available team already uses the deleted name", () => {
  const dir = mkdtempSync(join(tmpdir(), "scully-team-name-"));
  let db: Store | undefined;
  try {
    db = new Store(join(dir, "test.sqlite"));
    const original = db.defaultTeam();
    const other = db.saveTeam({
      name: "Other",
      ...original.roster!,
      expectedDefaultTeamId: original.id,
      saveMode: "new",
    });
    db.deleteTeam(original.id);
    db.saveTeam({
      name: original.name,
      ...other.roster!,
      expectedDefaultTeamId: other.id,
      saveMode: "new",
    });
    expect(() => db!.restoreTeam(original.id)).toThrow(
      /already uses that name/i,
    );
    expect(
      db.savedTeams().find((team) => team.id === original.id)?.deletedAt,
    ).toBeTruthy();
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("migrates old task bindings into snapshots and preserves the selected library team", () => {
  const dir = mkdtempSync(join(tmpdir(), "scully-team-migrate-v9-"));
  let db: Store | undefined;
  try {
    const path = join(dir, "test.sqlite");
    db = new Store(path);
    const task = db.createTask({
      title: "Before migration",
      description: "",
      mode: "plan",
    });
    const snapshot = db.teamForTask(task.id);
    db.close();
    db = undefined;
    const raw = new DatabaseSync(path);
    raw.exec("DROP TABLE team_library; PRAGMA user_version=9");
    raw
      .prepare("UPDATE team_default SET teamId=? WHERE singleton=1")
      .run(snapshot.id);
    raw.close();
    db = new Store(path);
    const current = db.defaultTeam();
    expect(current.id).not.toBe(snapshot.id);
    expect(current.roster?.memberIds).toEqual([
      "pearl",
      "maya",
      "ellis",
      "jun",
    ]);
    db.saveTeam({
      name: "After migration",
      ...current.roster!,
      expectedDefaultTeamId: current.id,
      saveMode: "overwrite",
    });
    expect(db.teamForTask(task.id)).toEqual(snapshot);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("saves immutable named team versions and binds each task to its creation team", () => {
  const dir = mkdtempSync(join(tmpdir(), "scully-saved-teams-"));
  let db: Store | undefined;
  try {
    db = new Store(join(dir, "test.sqlite"));
    const original = db
      .load()
      .savedTeams!.find((team) => team.id === db!.load().defaultTeamId)!;
    const first = db.createTask({
      title: "First",
      description: "",
      mode: "work",
    });
    const firstSnapshot = db.teamForTask(first.id);
    const next = db.saveTeam({
      name: "Security team",
      ...original.roster!,
      memberIds: [...original.roster!.memberIds, "meryl"],
      activeAuditorId: "meryl",
    });
    expect(next).toMatchObject({ name: "Security team", version: 1 });
    expect(() =>
      db!.saveTeam({
        name: "Another team",
        ...next.roster!,
        expectedDefaultTeamId: original.id,
        saveMode: "new",
      }),
    ).toThrow(/current team changed/i);
    expect(() =>
      db!.saveTeam({
        name: "security TEAM",
        ...next.roster!,
        expectedDefaultTeamId: next.id,
        saveMode: "new",
      }),
    ).toThrow(/different name/i);
    const revised = db.saveTeam({
      name: "Security team",
      ...next.roster!,
      memberIds: [...next.roster!.memberIds, "tessa"],
      activeBuilderId: "tessa",
      expectedDefaultTeamId: next.id,
      saveMode: "overwrite",
    });
    expect(revised.version).toBe(2);
    const second = db.createTask({
      title: "Second",
      description: "",
      mode: "work",
    });
    const secondSnapshot = db.teamForTask(second.id);
    expect(db.teamForTask(first.id).members).toEqual(original.members);
    expect(db.teamForTask(second.id).members).toEqual(revised.members);
    db.setDefaultTeam(original.id);
    expect(db.load().teammates).toEqual(original.members);
    expect(db.teamForTask(second.id).members).toEqual(revised.members);
    expect(() => db!.saveTeam({ name: "", ...revised.roster! })).toThrow();
    expect(() =>
      db!.saveTeam({ name: "Broken", ...revised.roster!, memberIds: ["maya"] }),
    ).toThrow();
    expect(() => db!.setDefaultTeam("missing")).toThrow();
    db.close();
    db = new Store(join(dir, "test.sqlite"));
    expect(db.teamForTask(first.id).id).toBe(firstSnapshot.id);
    expect(db.teamForTask(second.id).id).toBe(secondSnapshot.id);
    expect(
      db.load().savedTeams?.filter((team) => team.kind === "library"),
    ).toHaveLength(2);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("keeps an updated team in one family and a new team in another after reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "scully-team-families-"));
  let db: Store | undefined;
  try {
    const path = join(dir, "test.sqlite");
    db = new Store(path);
    const original = db.defaultTeam();
    const firstTask = db.createTask({
      title: "First",
      description: "",
      mode: "plan",
    });
    const firstSnapshot = db.teamForTask(firstTask.id);
    const updated = db.saveTeam({
      name: "Cerberus",
      ...original.roster!,
      expectedDefaultTeamId: original.id,
      saveMode: "overwrite",
    });
    expect(updated.familyId).toBe(original.familyId);
    expect(updated.version).toBe(2);
    const separate = db.saveTeam({
      name: "Release reviewers",
      ...updated.roster!,
      expectedDefaultTeamId: updated.id,
      saveMode: "new",
    });
    expect(separate.familyId).not.toBe(updated.familyId);
    expect(separate.version).toBe(1);
    const nextTask = db.createTask({
      title: "Second",
      description: "",
      mode: "plan",
    });
    const nextSnapshot = db.teamForTask(nextTask.id);
    expect(db.teamForTask(firstTask.id)).toEqual(firstSnapshot);
    expect(nextSnapshot.members).toEqual(separate.members);
    db.close();
    db = new Store(path);
    expect(db.defaultTeam().familyId).toBe(separate.familyId);
    expect(
      db
        .savedTeams()
        .filter(
          (team) =>
            team.kind === "library" && team.familyId === original.familyId,
        ),
    ).toHaveLength(1);
    expect(db.teamForTask(firstTask.id)).toEqual(firstSnapshot);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("groups old same-name team states during the version 8 migration", () => {
  const dir = mkdtempSync(join(tmpdir(), "scully-team-family-migrate-"));
  let db: Store | undefined;
  try {
    const path = join(dir, "test.sqlite");
    const old = new DatabaseSync(path);
    old.exec(
      "CREATE TABLE teammates (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, bio TEXT NOT NULL, instructions TEXT NOT NULL, portraitId TEXT NOT NULL); CREATE TABLE saved_teams (id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL, createdAt TEXT NOT NULL, members TEXT NOT NULL); CREATE TABLE team_default (singleton INTEGER PRIMARY KEY, teamId TEXT NOT NULL); CREATE TABLE task_teams (taskId TEXT PRIMARY KEY, teamId TEXT NOT NULL); PRAGMA user_version=8",
    );
    const insert = old.prepare("INSERT INTO saved_teams VALUES (?,?,?,?,?)");
    insert.run(
      "old-1",
      "Scully team",
      1,
      "2026-10-12T00:00:00Z",
      JSON.stringify(initialTeam),
    );
    insert.run(
      "old-2",
      "Scully team",
      2,
      "2026-10-12T01:00:00Z",
      JSON.stringify(initialTeam),
    );
    insert.run(
      "new-1",
      "Other team",
      1,
      "2026-10-12T02:00:00Z",
      JSON.stringify(initialTeam),
    );
    old.prepare("INSERT INTO team_default VALUES (1,?)").run("old-2");
    old.close();
    db = new Store(path);
    const states = db.savedTeams();
    expect(states.find((team) => team.id === "old-1")!.familyId).toBe(
      states.find((team) => team.id === "old-2")!.familyId,
    );
    expect(states.find((team) => team.id === "new-1")!.familyId).not.toBe(
      states.find((team) => team.id === "old-2")!.familyId,
    );
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("keeps recorded actor identity when profile edits are rejected and after database reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "scully-event-identity-"));
  let db: Store | undefined;
  try {
    db = new Store(join(dir, "test.sqlite"));
    const task = db.createTask({
      title: "History",
      description: "",
      mode: "work",
    });
    const reviewer = initialTeam.find((member) => member.id === "ellis")!;
    db.saveRun({
      id: "identity-run",
      taskId: task.id,
      status: "complete",
      events: [
        {
          actor: "ellis",
          actorName: "Earlier reviewer",
          actorRole: "Auditor",
          actorPortraitId: reviewer.portraitId,
          text: "Reviewed",
          at: "2026-10-12T12:00:00.000Z",
        },
      ],
    } as Run);
    expect(() =>
      db!.updateTeammate({ ...reviewer, name: "New reviewer" }),
    ).toThrow(/cannot be edited/i);
    db.close();
    db = new Store(join(dir, "test.sqlite"));
    expect(
      db.load().teammates.find((member) => member.id === "ellis"),
    ).toMatchObject({ name: "Ellis", role: "Auditor" });
    expect(db.runs(task.id)[0].events[0]).toMatchObject({
      actorName: "Earlier reviewer",
      actorRole: "Auditor",
      actorPortraitId: reviewer.portraitId,
    });
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("edits a saved task, locks its mode after a run exists, and deletes only its own records", () => {
  const dir = mkdtempSync(join(tmpdir(), "scully-task-lifecycle-"));
  let db: Store | undefined;
  try {
    db = new Store(join(dir, "test.sqlite"));
    const first = db.createTask({
      title: " First ",
      description: "",
      mode: "plan",
    });
    const other = db.createTask({
      title: "Keep",
      description: "",
      mode: "work",
    });
    expect(
      db.updateTask(first.id, {
        title: "Changed",
        description: "Detail",
        mode: "work",
      }),
    ).toMatchObject({
      id: first.id,
      title: "Changed",
      description: "Detail",
      mode: "work",
      createdAt: first.createdAt,
    });
    db.saveRun({
      id: "first-run",
      taskId: first.id,
      status: "prepared",
      calls: 0,
    } as Run);
    db.saveRun({
      id: "other-run",
      taskId: other.id,
      status: "complete",
    } as Run);
    db.configureUsageAlerts("first-run", defaultUsageAlertPolicy);
    db.configureCost("first-run", "model", emptyCostSettings);
    db.configureUsageAlerts("other-run", defaultUsageAlertPolicy);
    expect(() =>
      db!.updateTask(first.id, { title: "No", description: "", mode: "plan" }),
    ).toThrow();
    expect(
      db.updateTask(first.id, {
        title: "Renamed",
        description: "Updated",
        mode: "work",
      }).title,
    ).toBe("Renamed");
    expect(() =>
      db!.updateTask("missing", { title: "X", description: "", mode: "work" }),
    ).toThrow();
    expect(() => db!.deleteTask("missing")).toThrow();
    db.deleteTask(first.id);
    expect(db.load().tasks.map((task) => task.id)).toEqual([other.id]);
    expect(db.runs(first.id)).toEqual([]);
    expect(db.runs(other.id)).toHaveLength(1);
    db.close();
    const raw = new DatabaseSync(join(dir, "test.sqlite"));
    for (const table of [
      "runs",
      "usage_requests",
      "usage_totals",
      "usage_alerts",
      "usage_cost_settings",
      "usage_cost_totals",
    ]) {
      const key = table === "runs" ? "id" : "runId";
      expect(
        raw
          .prepare(`SELECT count(*) AS n FROM ${table} WHERE ${key}=?`)
          .get("first-run"),
      ).toMatchObject({ n: 0 });
    }
    expect(
      raw
        .prepare("SELECT count(*) AS n FROM usage_alerts WHERE runId=?")
        .get("other-run"),
    ).toMatchObject({ n: 1 });
    raw.close();
    db = new Store(join(dir, "test.sqlite"));
    expect(db.load().tasks.map((task) => task.id)).toEqual([other.id]);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("refuses to edit or delete a task with in-flight work", () => {
  const dir = mkdtempSync(join(tmpdir(), "scully-task-active-"));
  let db: Store | undefined;
  try {
    db = new Store(join(dir, "test.sqlite"));
    const task = db.createTask({
      title: "Active",
      description: "",
      mode: "work",
    });
    db.saveRun({
      id: "active-run",
      taskId: task.id,
      status: "building",
    } as Run);
    expect(() =>
      db!.updateTask(task.id, {
        title: "Changed",
        description: "",
        mode: "work",
      }),
    ).toThrow();
    expect(() => db!.deleteTask(task.id)).toThrow();
    expect(db.load().tasks).toHaveLength(1);
    expect(db.runs(task.id)).toHaveLength(1);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("keeps completed task and recovery records available", () => {
  const dir = mkdtempSync(join(tmpdir(), "scully-task-recovery-"));
  let db: Store | undefined;
  try {
    db = new Store(join(dir, "test.sqlite"));
    const task = db.createTask({
      title: "Reviewed",
      description: "",
      mode: "work",
    });
    db.saveRun({
      id: "reviewed-run",
      taskId: task.id,
      status: "complete",
      calls: 1,
    } as Run);
    expect(() => db!.deleteTask(task.id)).toThrow("saved work");
    expect(db.load().tasks).toHaveLength(1);
    expect(db.runs(task.id)).toHaveLength(1);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("keeps model cost rates per request through parallel calls, rate changes and restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "scully-cost-"));
  const path = join(dir, "test.sqlite");
  let db: Store | undefined;
  const model = "zai-org/GLM-5.3";
  const first = "11111111-1111-4111-8111-111111111111";
  const second = "22222222-2222-4222-8222-222222222222";
  const request = (id: string) => ({
    id,
    stage: "propose_plan",
    model,
    maxOutputTokens: 512,
  });
  try {
    db = new Store(path, () => new Date("2026-10-11T12:00:00Z"));
    db.saveRun({
      id: "run",
      taskId: "task",
      sourceName: "fixture",
      files: [],
      status: "building",
      events: [],
      plan: "",
      drafts: [],
      findings: [],
      checks: [],
      error: "",
      calls: 0,
      model,
      outputTokens: 512,
    });
    db.configureUsageAlerts("run", {
      ...defaultUsageAlertPolicy,
      requestAllowanceTokens: 512,
    });
    expect(db.reserveUsage("run", request(first))).toBe("allowed");
    expect(db.reserveUsage("run", request(second))).toBe("allowed");
    expect(db.costForRun("run", model).totals.pendingProjectedNanoUsd).toBe(
      2 * 512 * 4400,
    );
    const manual = {
      model,
      inputMilliUsdPerMillion: 2000,
      outputMilliUsdPerMillion: 5000,
      checkedAt: "2026-10-11",
      source: "nebius_listing" as const,
      sourceUrl: "https://forged.example",
    };
    expect(
      db.configureCost("run", model, { budgetCents: null, manualRate: manual })
        .settings.manualRate,
    ).toMatchObject({ source: "user_supplied", sourceUrl: null });
    expect(
      db.finishUsage("run", {
        id: first,
        usage: { inputTokens: 1000, outputTokens: 500 },
      }),
    ).toBe(true);
    expect(db.finishUsage("run", { id: second, usage: null })).toBe(true);
    expect(db.costForRun("run", model).totals).toMatchObject({
      verifiedNanoUsd: 3_600_000,
      estimatedNanoUsd: 0,
      unknownUsage: 1,
      pendingProjectedNanoUsd: 0,
    });
    db.close();
    db = new Store(path, () => new Date("2026-10-11T12:00:00Z"));
    expect(db.costForRun("run", model).totals.verifiedNanoUsd).toBe(3_600_000);
    const third = "33333333-3333-4333-8333-333333333333";
    expect(db.reserveUsage("run", request(third))).toBe("paused");
    const pause = db.alertsForRun("run").state.pauseId!;
    expect(db.reserveUsage("run", request(third), pause)).toBe("allowed");
    expect(
      db.finishUsage("run", {
        id: third,
        usage: { inputTokens: 100, outputTokens: 100 },
      }),
    ).toBe(true);
    expect(db.costForRun("run", model).totals.estimatedNanoUsd).toBe(700_000);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("pauses before unknown cost or projected budget and supports warning-only mode", () => {
  const dir = mkdtempSync(join(tmpdir(), "scully-cost-pause-"));
  let db: Store | undefined;
  try {
    db = new Store(
      join(dir, "test.sqlite"),
      () => new Date("2026-10-11T12:00:00Z"),
    );
    db.saveRun({
      id: "run",
      taskId: "task",
      status: "building",
      outputTokens: 512,
    } as Run);
    db.configureUsageAlerts("run", {
      ...defaultUsageAlertPolicy,
      requestAllowanceTokens: 512,
    });
    db.configureCost("run", "unknown/model", {
      ...emptyCostSettings,
      budgetCents: 1,
    });
    const first = {
      id: "11111111-1111-4111-8111-111111111111",
      stage: "propose_plan",
      model: "unknown/model",
      maxOutputTokens: 512,
    };
    expect(db.reserveUsage("run", first)).toBe("paused");
    expect(db.alertsForRun("run").state.pauseReason).toBe("cost_unknown");
    expect(db.usageForRun("run").requests).toBe(0);
    db.configureUsageAlerts("run", {
      ...defaultUsageAlertPolicy,
      mode: "warn",
      requestAllowanceTokens: 512,
    });
    expect(
      db.reserveUsage("run", first, db.alertsForRun("run").state.pauseId!),
    ).toBe("allowed");
    expect(db.costForRun("run", "unknown/model").totals.unpricedPending).toBe(
      1,
    );
    db.finishUsage("run", {
      id: first.id,
      usage: { inputTokens: 12, outputTokens: 3 },
    });
    expect(db.costForRun("run", "unknown/model").totals.unpricedMeasured).toBe(
      1,
    );
    const second = { ...first, id: "22222222-2222-4222-8222-222222222222" };
    expect(db.reserveUsage("run", second)).toBe("allowed");
    expect(
      db
        .alertsForRun("run")
        .state.recent.some((a) => a.kind === "cost_unknown"),
    ).toBe(true);
    db.saveRun({
      id: "warn",
      taskId: "task",
      status: "building",
      outputTokens: 512,
    } as Run);
    db.configureUsageAlerts("warn", {
      ...defaultUsageAlertPolicy,
      mode: "warn",
      requestAllowanceTokens: 512,
    });
    db.configureCost("warn", "unknown/model", {
      ...emptyCostSettings,
      budgetCents: 1,
    });
    expect(
      db.reserveUsage("warn", {
        ...first,
        id: "33333333-3333-4333-8333-333333333333",
      }),
    ).toBe("allowed");
    expect(db.alertsForRun("warn").state.latest?.text).toContain(
      "Warning-only mode permits it",
    );
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("reserves projected exposure before parallel dispatch and marks interrupted usage unknown", () => {
  const dir = mkdtempSync(join(tmpdir(), "scully-cost-budget-"));
  let db: Store | undefined;
  try {
    db = new Store(
      join(dir, "test.sqlite"),
      () => new Date("2026-10-11T12:00:00Z"),
    );
    const model = "zai-org/GLM-5.3";
    db.saveRun({
      id: "run",
      taskId: "task",
      status: "building",
      model,
      outputTokens: 512,
    } as Run);
    db.configureUsageAlerts("run", {
      ...defaultUsageAlertPolicy,
      requestAllowanceTokens: 512,
    });
    db.configureCost("run", model, { budgetCents: 1, manualRate: null });
    const first = {
      id: "11111111-1111-4111-8111-111111111111",
      stage: "propose_plan",
      model,
      maxOutputTokens: 512,
    };
    const second = { ...first, id: "22222222-2222-4222-8222-222222222222" };
    const third = { ...first, id: "33333333-3333-4333-8333-333333333333" };
    expect(db.reserveUsage("run", first)).toBe("allowed");
    expect(db.reserveUsage("run", second)).toBe("allowed");
    expect(db.reserveUsage("run", third)).toBe("allowed");
    const fourth = { ...first, id: "44444444-4444-4444-8444-444444444444" };
    expect(db.reserveUsage("run", fourth)).toBe("allowed");
    const fifth = { ...first, id: "55555555-5555-4555-8555-555555555555" };
    expect(db.reserveUsage("run", fifth)).toBe("paused");
    expect(db.alertsForRun("run").state.pauseReason).toBe("cost_budget");
    expect(db.usageForRun("run").requests).toBe(4);
    const pauseId = db.alertsForRun("run").state.pauseId!;
    expect(db.reserveUsage("run", fifth, "stale")).toBe("rejected");
    expect(db.reserveUsage("run", fifth, pauseId)).toBe("allowed");
    expect(db.reserveUsage("run", fifth, pauseId)).toBe("rejected");
    expect(db.usageForRun("run").requests).toBe(5);
    db.interruptUsage("run");
    expect(db.costForRun("run", model).totals).toMatchObject({
      pendingProjectedNanoUsd: 0,
      unknownUsage: 5,
    });
    const sixth = { ...first, id: "66666666-6666-4666-8666-666666666666" };
    expect(db.reserveUsage("run", sixth)).toBe("paused");
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("persists real SQLite tasks and fixed roster across reopen without duplicating defaults", () => {
  const dir = mkdtempSync(join(tmpdir(), "scully-store-"));
  let db: Store | undefined;
  try {
    db = new Store(join(dir, "test.sqlite"));
    expect(db.load().teammates).toHaveLength(4);
    const task = db.createTask({
      title: "Build it",
      description: "Test persistence",
      mode: "plan",
    });
    const original = db.defaultTeam();
    db.saveTeam({
      name: original.name,
      ...original.roster!,
      memberIds: [...original.roster!.memberIds, "tessa"],
      expectedDefaultTeamId: original.id,
      saveMode: "overwrite",
    });
    db.close();
    db = undefined;
    db = new Store(join(dir, "test.sqlite"));
    expect(db.load().tasks).toEqual([task]);
    expect(db.load().teammates).toHaveLength(5);
    expect(db.load().teammates.at(-1)?.name).toBe("Tessa");
    expect(() =>
      db!.createTask({ title: " ", mode: "plan", description: "" }),
    ).toThrow();
    expect(db.load().tasks).toHaveLength(1);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("keeps custom v6 profiles in historical snapshots while the new default uses fixed characters", () => {
  const dir = mkdtempSync(join(tmpdir(), "scully-portrait-migration-"));
  const path = join(dir, "test.sqlite");
  let db: Store | undefined;
  try {
    const old = new DatabaseSync(path);
    old.exec(
      "CREATE TABLE teammates (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, bio TEXT NOT NULL, instructions TEXT NOT NULL); PRAGMA user_version=6",
    );
    old
      .prepare("INSERT INTO teammates VALUES (?,?,?,?,?)")
      .run(
        "ellis",
        "Ellis Edited",
        "Custom auditor",
        "Custom bio",
        "Custom instructions",
      );
    old.close();
    db = new Store(path);
    expect(db.defaultTeam().members.map(({ id }) => id)).toEqual([
      "pearl",
      "maya",
      "ellis",
      "jun",
    ]);
    const earlier = db.savedTeams().find((team) => team.kind === "snapshot")!;
    expect(earlier.members.find(({ id }) => id === "ellis")).toMatchObject({
      name: "Ellis Edited",
      role: "Custom auditor",
      bio: "Custom bio",
      instructions: "Custom instructions",
      portraitId: "portrait-02",
    });
    db.close();
    db = new Store(path);
    expect(
      db.savedTeams().find((team) => team.id === earlier.id)?.members,
    ).toEqual(earlier.members);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("keeps fixed portraits and rejects profile or image-path changes across restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "scully-portrait-choice-"));
  const path = join(dir, "test.sqlite");
  let db: Store | undefined;
  try {
    db = new Store(path);
    const ellis = db.load().teammates.find(({ id }) => id === "ellis")!;
    expect(() =>
      db!.updateTeammate({ ...ellis, portraitId: "file:///secret" }),
    ).toThrow(/cannot be edited/i);
    expect(
      db.load().teammates.find(({ id }) => id === "ellis")!.portraitId,
    ).toBe("portrait-02");
    expect(() =>
      db!.updateTeammate({ ...ellis, portraitId: "portrait-10" }),
    ).toThrow(/cannot be edited/i);
    db.close();
    db = new Store(path);
    expect(
      db.load().teammates.find(({ id }) => id === "ellis")!.portraitId,
    ).toBe("portrait-02");
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("rejects old style and profile mutation paths while preserving activity across restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "scully-team-style-"));
  const path = join(dir, "test.sqlite");
  let db: Store | undefined;
  try {
    db = new Store(path);
    db.saveRun({
      id: "run-style",
      taskId: "task",
      events: [{ actor: "maya", text: "Saved", at: "2026-10-12T00:00:00Z" }],
    } as Run);
    expect(() => db!.applyTeamStyle("test-first")).toThrow(/cannot be edited/i);
    expect(() =>
      db!.updateTeammate({ ...db!.load().teammates[1], name: "Changed" }),
    ).toThrow(/cannot be edited/i);
    expect(db.load().activity.byTeammate.maya.recordedEvents).toBe(1);
    db.close();
    db = new Store(path);
    expect(db.load().teammates.map(({ name }) => name)).toEqual([
      "Pearl",
      "Maya",
      "Ellis",
      "Jun",
    ]);
    expect(db.load().activity.byTeammate.maya.recordedEvents).toBe(1);
    expect(() => db!.applyTeamStyle("risk-review")).toThrow(
      /cannot be edited/i,
    );
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("loads measured teammate activity from saved runs after a SQLite restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "scully-activity-"));
  const path = join(dir, "test.sqlite");
  let db: Store | undefined;
  try {
    db = new Store(path);
    db.saveRun({
      id: "run-1",
      taskId: "task",
      events: [
        { actor: "maya", text: "Draft saved", at: "2026-10-12T00:00:00Z" },
        { actor: "maya", text: "Review requested", at: "2026-10-12T00:01:00Z" },
        { actor: "system", text: "Paused", at: "2026-10-12T00:02:00Z" },
      ],
    } as Run);
    db.close();
    db = undefined;
    db = new Store(path);
    expect(db.load().activity).toMatchObject({
      scannedRuns: 1,
      partial: false,
      byTeammate: { maya: { recordedEvents: 2, runsWithEvents: 1 } },
    });
    db.close();
    db = undefined;
    const raw = new DatabaseSync(path);
    raw
      .prepare("INSERT INTO runs VALUES (?, ?, ?)")
      .run("bad", "task", "not json");
    raw
      .prepare("INSERT INTO runs VALUES (?, ?, ?)")
      .run("large", "task", "x".repeat(2000001));
    raw.close();
    db = new Store(path);
    expect(db.load().activity).toMatchObject({
      scannedRuns: 3,
      partial: true,
      byTeammate: { maya: { recordedEvents: 2, runsWithEvents: 1 } },
    });
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("migrates old measured, unknown and pending usage as unpriced", () => {
  const dir = mkdtempSync(join(tmpdir(), "scully-cost-migration-"));
  const path = join(dir, "test.sqlite");
  let db: Store | undefined;
  try {
    const old = new DatabaseSync(path);
    old.exec(`
      CREATE TABLE runs (id TEXT PRIMARY KEY, taskId TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE usage_requests (id TEXT PRIMARY KEY, runId TEXT NOT NULL, stage TEXT NOT NULL,
        model TEXT NOT NULL, maxOutputTokens INTEGER NOT NULL, status TEXT NOT NULL,
        inputTokens INTEGER, outputTokens INTEGER, startedAt TEXT NOT NULL, finishedAt TEXT,
        reservationTokens INTEGER NOT NULL DEFAULT 8192);
      CREATE TABLE usage_totals (runId TEXT PRIMARY KEY, requests INTEGER NOT NULL DEFAULT 0,
        measured INTEGER NOT NULL DEFAULT 0, unknown INTEGER NOT NULL DEFAULT 0,
        pending INTEGER NOT NULL DEFAULT 0, inputTokens INTEGER NOT NULL DEFAULT 0,
        outputTokens INTEGER NOT NULL DEFAULT 0, pendingMaxOutputTokens INTEGER NOT NULL DEFAULT 0,
        coreRequests INTEGER NOT NULL DEFAULT 0, reservedTokens INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE usage_alerts (runId TEXT PRIMARY KEY, policy TEXT NOT NULL, state TEXT NOT NULL);
      PRAGMA user_version=5;
    `);
    old
      .prepare("INSERT INTO runs VALUES (?,?,?)")
      .run(
        "run",
        "task",
        JSON.stringify({ id: "run", taskId: "task", status: "complete" }),
      );
    old
      .prepare(
        "INSERT INTO usage_totals (runId,requests,measured,unknown,pending) VALUES (?,4,2,1,1)",
      )
      .run("run");
    old.close();
    db = new Store(path);
    expect(db.costForRun("run", "zai-org/GLM-5.3").totals).toMatchObject({
      verifiedNanoUsd: 0,
      estimatedNanoUsd: 0,
      unpricedMeasured: 2,
      unknownUsage: 1,
      unpricedPending: 1,
    });
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("keeps model cost separate from an unrelated sandbox execution", () => {
  const dir = mkdtempSync(join(tmpdir(), "scully-mixed-cost-"));
  let db: Store | undefined;
  const model = "nvidia/Nemotron-3_5-Lightning";
  try {
    db = new Store(
      join(dir, "test.sqlite"),
      () => new Date("2026-10-11T12:00:00Z"),
    );
    db.saveRun({
      id: "run",
      taskId: "task",
      sourceName: "fixture",
      files: [],
      status: "building",
      events: [],
      plan: "",
      drafts: [],
      findings: [],
      checks: [],
      error: "",
      calls: 0,
      model,
      outputTokens: 512,
      cloudExecutions: [
        {
          runId: "run",
          commandId: "cloud-check",
          revision: "revision",
          image: "image",
          executable: "/bin/true",
          args: [],
          cwd: "/",
          timeoutSeconds: 20,
          files: [],
          projectId: "project",
          id: "cloud-1",
          status: "complete",
          operationId: "operation",
          remoteStatus: "SUCCESS",
          startedAt: "2026-10-11T10:00:00Z",
          commandPassed: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          error: "",
        },
      ],
    });
    db.configureUsageAlerts("run", {
      ...defaultUsageAlertPolicy,
      requestAllowanceTokens: 512,
    });
    const id = "11111111-1111-4111-8111-111111111111";
    expect(
      db.reserveUsage("run", {
        id,
        stage: "propose_plan",
        model,
        maxOutputTokens: 512,
      }),
    ).toBe("allowed");
    db.finishUsage("run", {
      id,
      usage: { inputTokens: 1000, outputTokens: 500 },
    });
    expect(db.costForRun("run", model).totals).toMatchObject({
      verifiedNanoUsd: 180_000,
      estimatedNanoUsd: 0,
      unpricedMeasured: 0,
      unknownUsage: 0,
    });
    expect(db.getRun("run").cloudExecutions).toHaveLength(1);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("migrates an existing v2 workspace and keeps measured and unknown usage honest across reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "scully-usage-"));
  const path = join(dir, "test.sqlite");
  let db: Store | undefined;
  const first = "11111111-1111-4111-8111-111111111111";
  const second = "22222222-2222-4222-8222-222222222222";
  try {
    const old = new DatabaseSync(path);
    old.exec(
      "CREATE TABLE runs (id TEXT PRIMARY KEY, taskId TEXT NOT NULL, data TEXT NOT NULL); PRAGMA user_version=2",
    );
    old
      .prepare("INSERT INTO runs VALUES (?,?,?)")
      .run(
        "run",
        "task",
        JSON.stringify({ id: "run", taskId: "task", status: "complete" }),
      );
    old.close();
    db = new Store(path);
    expect(db.usageForRun("run")).toMatchObject({
      requests: 0,
      unknown: 0,
      pending: 0,
    });
    const start = (id: string) => ({
      id,
      stage: "propose_plan",
      model: "model",
      maxOutputTokens: 512,
    });
    expect(db.startUsage("run", start(first))).toBe(true);
    expect(db.startUsage("run", start(first))).toBe(false);
    expect(db.startUsage("run", start(second))).toBe(true);
    expect(
      db.startUsage("run", {
        ...start(first),
        id: "bad",
        model: "secret\npath",
      }),
    ).toBe(false);
    expect(
      db.finishUsage("run", {
        id: first,
        usage: { inputTokens: 13, outputTokens: 7 },
      }),
    ).toBe(true);
    expect(
      db.finishUsage("run", {
        id: first,
        usage: { inputTokens: 13, outputTokens: 7 },
      }),
    ).toBe(false);
    expect(db.usageForRun("run")).toEqual({
      requests: 2,
      measured: 1,
      unknown: 0,
      pending: 1,
      inputTokens: 13,
      outputTokens: 7,
      pendingMaxOutputTokens: 512,
    });
    db.close();
    db = new Store(path);
    db.recoverRuns();
    expect(db.usageForRun("run")).toEqual({
      requests: 2,
      measured: 1,
      unknown: 1,
      pending: 0,
      inputTokens: 13,
      outputTokens: 7,
      pendingMaxOutputTokens: 0,
    });
    db.recoverRuns();
    expect(db.usageForRun("run").unknown).toBe(1);
    expect(() => db!.usageForRun("other")).toThrow("Run not found");
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("migrates v3 usage rows into a durable coordinator request count", () => {
  const dir = mkdtempSync(join(tmpdir(), "scully-usage-v3-"));
  const path = join(dir, "test.sqlite");
  let db: Store | undefined;
  try {
    const old = new DatabaseSync(path);
    old.exec(
      "CREATE TABLE runs (id TEXT PRIMARY KEY, taskId TEXT NOT NULL, data TEXT NOT NULL); CREATE TABLE usage_requests (id TEXT PRIMARY KEY, runId TEXT NOT NULL, stage TEXT NOT NULL, model TEXT NOT NULL, maxOutputTokens INTEGER NOT NULL, status TEXT NOT NULL, inputTokens INTEGER, outputTokens INTEGER, startedAt TEXT NOT NULL, finishedAt TEXT); CREATE TABLE usage_totals (runId TEXT PRIMARY KEY, requests INTEGER NOT NULL DEFAULT 0, measured INTEGER NOT NULL DEFAULT 0, unknown INTEGER NOT NULL DEFAULT 0, pending INTEGER NOT NULL DEFAULT 0, inputTokens INTEGER NOT NULL DEFAULT 0, outputTokens INTEGER NOT NULL DEFAULT 0, pendingMaxOutputTokens INTEGER NOT NULL DEFAULT 0); PRAGMA user_version=3",
    );
    old
      .prepare("INSERT INTO runs VALUES (?,?,?)")
      .run(
        "run",
        "task",
        JSON.stringify({ id: "run", taskId: "task", status: "planned" }),
      );
    old
      .prepare("INSERT INTO usage_requests VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(
        "11111111-1111-4111-8111-111111111111",
        "run",
        "propose_plan",
        "model",
        2048,
        "measured",
        10,
        5,
        "now",
        "now",
      );
    old
      .prepare("INSERT INTO usage_totals VALUES (?,?,?,?,?,?,?,?)")
      .run("run", 1, 1, 0, 0, 10, 5, 0);
    old.close();
    db = new Store(path);
    expect(db.coreUsageRequests("run")).toBe(1);
    db.close();
    db = new Store(path);
    expect(db.coreUsageRequests("run")).toBe(1);
    expect(db.usageForRun("run").inputTokens).toBe(10);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("serializes parallel allowance reservations and persists a one-use pause across reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "scully-alerts-"));
  const path = join(dir, "test.sqlite");
  let db: Store | undefined;
  const start = (id: string) => ({
    id,
    stage: "propose_plan",
    model: "model",
    maxOutputTokens: 512,
  });
  const first = "11111111-1111-4111-8111-111111111111";
  const second = "22222222-2222-4222-8222-222222222222";
  const third = "33333333-3333-4333-8333-333333333333";
  try {
    db = new Store(path);
    db.saveRun({
      id: "run",
      taskId: "task",
      status: "building",
      outputTokens: 512,
    } as Run);
    db.configureUsageAlerts("run", {
      ...defaultUsageAlertPolicy,
      budgetTokens: 10000,
      requestAllowanceTokens: 6000,
    });
    expect(db.reserveUsage("run", start(first))).toBe("allowed");
    expect(db.alertsForRun("run").reservedTokens).toBe(6000);
    db.configureUsageAlerts("run", {
      ...defaultUsageAlertPolicy,
      budgetTokens: 6500,
      requestAllowanceTokens: 512,
    });
    expect(db.reserveUsage("run", start(second))).toBe("paused");
    const pauseId = db.alertsForRun("run").state.pauseId!;
    expect(db.reserveUsage("run", start(third))).toBe("paused");
    expect(db.usageForRun("run").requests).toBe(1);
    expect(db.reserveUsage("run", start(second), "stale")).toBe("rejected");
    expect(db.reserveUsage("run", start(second), pauseId)).toBe("allowed");
    expect(db.reserveUsage("run", start(second), pauseId)).toBe("rejected");
    expect(db.usageForRun("run")).toMatchObject({ requests: 2, pending: 2 });
    expect(db.alertsForRun("run").reservedTokens).toBe(6512);
    expect(db.reserveUsage("run", start(third))).toBe("paused");
    const nextPause = db.alertsForRun("run").state.pauseId;
    expect(nextPause).not.toBe(pauseId);
    db.close();
    db = new Store(path);
    db.recoverRuns();
    expect(db.alertsForRun("run").state.pauseId).toBe(nextPause);
    expect(db.usageForRun("run")).toMatchObject({
      requests: 2,
      unknown: 2,
      pending: 0,
    });
    expect(db.alertsForRun("run").state.recent.length).toBeGreaterThan(0);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("warn-only permits the next request after unknown usage without erasing the warning", () => {
  const dir = mkdtempSync(join(tmpdir(), "scully-warn-"));
  let db: Store | undefined;
  try {
    db = new Store(join(dir, "test.sqlite"));
    db.saveRun({
      id: "run",
      taskId: "task",
      status: "building",
      outputTokens: 512,
    } as Run);
    db.configureUsageAlerts("run", {
      ...defaultUsageAlertPolicy,
      mode: "warn",
      budgetTokens: 1000,
      requestAllowanceTokens: 512,
    });
    const id = "11111111-1111-4111-8111-111111111111";
    expect(
      db.reserveUsage("run", {
        id,
        stage: "propose_plan",
        model: "model",
        maxOutputTokens: 512,
      }),
    ).toBe("allowed");
    db.finishUsage("run", { id, usage: null });
    expect(
      db.reserveUsage("run", {
        id: "22222222-2222-4222-8222-222222222222",
        stage: "propose_plan",
        model: "model",
        maxOutputTokens: 512,
      }),
    ).toBe("allowed");
    expect(
      db
        .alertsForRun("run")
        .state.recent.some((alert) => alert.kind === "unknown"),
    ).toBe(true);
    expect(db.alertsForRun("run").state.pauseId).toBeNull();
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("never reserves less than the actual requested output maximum", () => {
  const dir = mkdtempSync(join(tmpdir(), "scully-reserve-"));
  let db: Store | undefined;
  try {
    db = new Store(join(dir, "test.sqlite"));
    db.saveRun({
      id: "run",
      taskId: "task",
      status: "building",
      outputTokens: 512,
    } as Run);
    db.configureUsageAlerts("run", {
      ...defaultUsageAlertPolicy,
      budgetTokens: 2000,
      requestAllowanceTokens: 512,
    });
    expect(
      db.reserveUsage("run", {
        id: "11111111-1111-4111-8111-111111111111",
        stage: "propose_plan",
        model: "model",
        maxOutputTokens: 1024,
      }),
    ).toBe("allowed");
    expect(db.alertsForRun("run").reservedTokens).toBe(1024);
    expect(
      db.reserveUsage("run", {
        id: "22222222-2222-4222-8222-222222222222",
        stage: "propose_plan",
        model: "model",
        maxOutputTokens: 1024,
      }),
    ).toBe("paused");
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("lists saved run IDs across reopen with a bounded completeness signal", () => {
  const dir = mkdtempSync(join(tmpdir(), "scully-store-runs-"));
  let db: Store | undefined;
  try {
    db = new Store(join(dir, "test.sqlite"));
    for (const id of ["run-a", "run-b"])
      db.saveRun({ id, taskId: "task" } as Run);
    db.close();
    db = new Store(join(dir, "test.sqlite"));
    expect(db.runIds()).toEqual({ ids: ["run-a", "run-b"], complete: true });
    expect(db.runIds(1)).toEqual({ ids: ["run-a"], complete: false });
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
