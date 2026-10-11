// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { Store } from "../src/main/store";
import { DatabaseSync } from "node:sqlite";
import type { Run } from "../src/shared/runs";
import { defaultUsageAlertPolicy } from "../src/shared/usage-alerts";
import { emptyCostSettings } from "../src/shared/model-cost";

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
it("persists real SQLite tasks and profiles across reopen without duplicating defaults", () => {
  const dir = mkdtempSync(join(tmpdir(), "scully-store-"));
  let db: Store | undefined;
  try {
    db = new Store(join(dir, "test.sqlite"));
    expect(db.load().teammates).toHaveLength(3);
    const task = db.createTask({
      title: "Build it",
      description: "Test persistence",
      mode: "plan",
    });
    db.updateTeammate({ ...db.load().teammates[0], name: "Maya Edited" });
    db.close();
    db = undefined;
    db = new Store(join(dir, "test.sqlite"));
    expect(db.load().tasks).toEqual([task]);
    expect(db.load().teammates).toHaveLength(3);
    expect(db.load().teammates[0].name).toBe("Maya Edited");
    expect(() =>
      db!.createTask({ title: " ", mode: "plan", description: "" }),
    ).toThrow();
    expect(db.load().tasks).toHaveLength(1);
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
