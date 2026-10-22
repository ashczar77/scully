export const operations = [
  "pearl:web:configure",
  "pearl:web:disconnect",
  "web.search",
  "web.read",
  "pearl:create",
  "pearl:archive",
  "pearl:trash",
  "pearl:restore",
  "pearl:permanent-delete",
  "pearl:send",
  "pearl:project:choose",
  "pearl:project:approve",
  "pearl:tool:decide",
  "pearl:question:answer",
  "pearl:retry",
  "pearl:stop",
  "pearl:terminal:input",
  "pearl:terminal:resize",
  "pearl:terminal:stop",
  "terminal.start",
  "terminal.read",
  "terminal.exit",
  "collaboration:review",
  "collaboration:environments",
  "collaboration:local-review",
  "collaboration:local-approve",
  "collaboration:proposal-review",
  "collaboration:approve",
  "collaboration:message",
  "collaboration:continue",
  "collaboration:reconcile",
  "collaboration:dispatch-review",
  "collaboration:dispatch-approve",
  "collaboration:sync-review",
  "collaboration:sync-approve",
  "storage:inspect",
  "sandbox.inspect",
  "cloud:resolve",
  "sandbox.images",
  "cloud:images",
  "sandbox.upload",
  "cloud:configure",
  "cloud:review",
  "cloud:submit",
  "cloud:refresh",
  "sandbox.submit",
  "sandbox.status",
  "message:send",
  "suggestion:review",
  "reply:review",
  "reply:route-review",
  "reply:settings:set",
  "planning:settings:set",
  "models:roles",
  "models:roles:set",
  "reply:start",
  "reply:stop",
  "consult:review",
  "consult:start",
  "consult:stop",
  "advice:review",
  "advice:approve",
  "advice:remove",
  "task:create",
  "conversation:approve",
  "conversation:auto-answer",
  "capture:arm",
  "capture:clear",
  "task:update",
  "task:delete",
  "task:archive",
  "task:restore",
  "task:permanent-delete",
  "teammate:update",
  "teammate:style",
  "team:save",
  "team:migrate",
  "team:default",
  "team:delete",
  "team:restore",
  "source:select",
  "run:prepare",
  "project:choose",
  "project:open",
  "git:history",
  "git:init",
  "run:start",
  "lineup:approve",
  "run:stop",
  "run:pause",
  "run:resume-pause",
  "audit:start",
  "finding:decide",
  "correction:prepare",
  "command:decide",
  "execution:review",
  "execution:start",
  "execution:stop",
  "apply:review",
  "apply:write",
  "apply:inspect",
  "coordination:configure",
  "usage:configure",
  "usage:review",
  "usage:alerts:configure",
  "usage:cost:configure",
  "usage:continue",
  "usage:save",
  "session:configure",
  "session:models",
  "run:model",
  "room:planning-message",
  "room:planning-answer",
  "room:planning-answers",
  "room:planning-approve",
  "room:planning-retry",
  "room:conversation-message",
  "room:conversation-answer",
  "room:build-answer",
  "session:model",
  "clipboard:write",
  "model.request",
  "agent.action_batch",
  "agent.pause.repeated_action",
  "agent.pause.no_progress",
  "agent.pause.time_budget",
  "agent.pause.step_budget",
  "agent.pause.completion_missing",
] as const;
export type Operation = (typeof operations)[number];
export type Metric = {
  version: 1;
  operation: Operation;
  outcome: "returned" | "threw";
  durationMs: number;
};
export type MetricEvent = Metric & { at: number };
export type MetricSnapshot = {
  events: MetricEvent[];
  capacity: number;
  retentionMs: number;
};
export type MetricSink = (metric: Metric) => void | Promise<void>;
export const noopSink: MetricSink = () => {};
export function sanitizeMetric(value: unknown): Metric | null {
  const v = value as Metric;
  if (
    !v ||
    v.version !== 1 ||
    !operations.includes(v.operation) ||
    !["returned", "threw"].includes(v.outcome) ||
    !Number.isFinite(v.durationMs) ||
    v.durationMs < 0 ||
    v.durationMs > 86_400_000
  )
    return null;
  return {
    version: 1,
    operation: v.operation,
    outcome: v.outcome,
    durationMs: Math.round(v.durationMs),
  };
}
export function emitMetric(sink: MetricSink, value: unknown) {
  try {
    const metric = sanitizeMetric(value);
    if (metric) {
      const result = sink(metric);
      if (result) void Promise.resolve(result).catch(() => {});
    }
  } catch {
    /* Diagnostics never alter application outcomes. */
  }
}
export async function measured<T>(
  operation: Operation,
  action: () => T | Promise<T>,
  sink: MetricSink = noopSink,
  clock: () => number = () => performance.now(),
): Promise<T> {
  let start = 0;
  try {
    start = clock();
  } catch {
    /* optional clock */
  }
  let outcome: Metric["outcome"] = "threw";
  try {
    const result = await action();
    outcome = "returned";
    return result;
  } finally {
    try {
      emitMetric(sink, {
        version: 1,
        operation,
        outcome,
        durationMs: Math.max(0, clock() - start),
      });
    } catch {
      /* optional clock */
    }
  }
}
export class LocalMetrics {
  private events: MetricEvent[] = [];
  readonly capacity = 1000;
  readonly retentionMs = 86_400_000;
  constructor(private clock: () => number = Date.now) {}
  private prune(now: number) {
    this.events = this.events.filter(
      (e) => e.at <= now && now - e.at < this.retentionMs,
    );
  }
  record = (value: unknown) => {
    try {
      const metric = sanitizeMetric(value);
      if (!metric) return;
      const at = this.clock();
      if (!Number.isFinite(at)) return;
      this.prune(at);
      this.events.push({ ...metric, at });
      if (this.events.length > this.capacity)
        this.events.splice(0, this.events.length - this.capacity);
    } catch {
      /* optional diagnostics */
    }
  };
  snapshot(): MetricSnapshot {
    try {
      this.prune(this.clock());
    } catch {
      this.events = [];
    }
    return {
      events: this.events.map((e) => ({ ...e })),
      capacity: this.capacity,
      retentionMs: this.retentionMs,
    };
  }
}
