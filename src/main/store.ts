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
  constructor(
    path: string,
    private now: () => Date = () => new Date(),
  ) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;");
    const version = (
      this.db.prepare("PRAGMA user_version").get() as { user_version: number }
    ).user_version;
    if (version > 6) {
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
          "UPDATE usage_totals SET coreRequests=(SELECT COUNT(*) FROM usage_requests WHERE usage_requests.runId=usage_totals.runId AND stage NOT IN ('answer_question','specialist_audit'))",
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
            value.stage === "specialist_audit"
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
  finishUsage(runId: string, value: unknown, scope?: "reply" | "coordinator") {
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
          (scope === "coordinator" && row.stage === "answer_question"))
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
  interruptUsage(runId?: string, scope?: "reply" | "coordinator") {
    const rows = this.db
      .prepare(
        "SELECT id,runId FROM usage_requests WHERE status='pending'" +
          (runId ? " AND runId=?" : "") +
          (scope === "reply"
            ? " AND stage='answer_question'"
            : scope === "coordinator"
              ? " AND stage!='answer_question'"
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
