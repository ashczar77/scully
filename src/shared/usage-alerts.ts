import type { UsageSnapshot } from "./usage";

export type UsageAlertPolicy = {
  budgetTokens: number;
  requestAllowanceTokens: number;
  warnings: [number, number];
  spikeTokens: number;
  repeatEveryRequests: number;
  cooldownMinutes: number;
  mode: "pause" | "warn";
  delivery: "in_app" | "desktop";
};
export type UsageAlert = {
  kind:
    | "threshold"
    | "spike"
    | "unknown"
    | "budget"
    | "cost_unknown"
    | "cost_budget";
  text: string;
  at: string;
  sequence: number;
};
export type UsageAlertState = {
  warned: number[];
  lastSpikeAt: string | null;
  lastRepeatAt: string | null;
  lastRepeatRequest: number;
  sequence: number;
  latest: UsageAlert | null;
  recent: UsageAlert[];
  unknownWarned: boolean;
  budgetWarned: boolean;
  costUnknownWarned: boolean;
  costBudgetWarned: boolean;
  pauseId: string | null;
  pauseReason: "unknown" | "budget" | "cost_unknown" | "cost_budget" | null;
};
export type UsageAlertSnapshot = {
  policy: UsageAlertPolicy;
  state: UsageAlertState;
  reservedTokens?: number;
  waiting?: boolean;
};

export const defaultUsageAlertPolicy: UsageAlertPolicy = {
  budgetTokens: 100000,
  requestAllowanceTokens: 8192,
  warnings: [50, 80],
  spikeTokens: 8192,
  repeatEveryRequests: 0,
  cooldownMinutes: 5,
  mode: "pause",
  delivery: "in_app",
};

export function parseUsageAlertPolicy(value: unknown): UsageAlertPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid usage alert settings");
  const p = value as Record<string, unknown>;
  const integer = (n: unknown, min: number, max: number) =>
    Number.isSafeInteger(n) && (n as number) >= min && (n as number) <= max;
  if (
    !integer(p.budgetTokens, 1000, 1000000) ||
    !integer(p.requestAllowanceTokens, 512, 200000) ||
    !Array.isArray(p.warnings) ||
    p.warnings.length !== 2 ||
    !integer(p.warnings[0], 1, 98) ||
    !integer(p.warnings[1], 2, 99) ||
    p.warnings[0] >= p.warnings[1] ||
    !integer(p.spikeTokens, 1, 200000) ||
    !integer(p.repeatEveryRequests, 0, 64) ||
    !integer(p.cooldownMinutes, 0, 1440) ||
    !["pause", "warn"].includes(p.mode as string) ||
    !["in_app", "desktop"].includes(p.delivery as string)
  )
    throw new Error("Invalid usage alert settings");
  return {
    budgetTokens: p.budgetTokens as number,
    requestAllowanceTokens: p.requestAllowanceTokens as number,
    warnings: [p.warnings[0], p.warnings[1]],
    spikeTokens: p.spikeTokens as number,
    repeatEveryRequests: p.repeatEveryRequests as number,
    cooldownMinutes: p.cooldownMinutes as number,
    mode: p.mode as UsageAlertPolicy["mode"],
    delivery: p.delivery as UsageAlertPolicy["delivery"],
  };
}

export function emptyUsageAlertState(): UsageAlertState {
  return {
    warned: [],
    lastSpikeAt: null,
    lastRepeatAt: null,
    lastRepeatRequest: 0,
    sequence: 0,
    latest: null,
    recent: [],
    unknownWarned: false,
    budgetWarned: false,
    costUnknownWarned: false,
    costBudgetWarned: false,
    pauseId: null,
    pauseReason: null,
  };
}

function alert(
  state: UsageAlertState,
  kind: UsageAlert["kind"],
  text: string,
  now: string,
) {
  state.sequence++;
  state.latest = { kind, text, at: now, sequence: state.sequence };
  state.recent = [...state.recent, state.latest].slice(-10);
}

function due(last: string | null, minutes: number, now: string) {
  return !last || Date.parse(now) - Date.parse(last) >= minutes * 60000;
}

export function recordUsageAlerts(
  policy: UsageAlertPolicy,
  state: UsageAlertState,
  usage: UsageSnapshot,
  now: string,
  latestRequestTokens?: number,
  reservedTokens = usage.pending * policy.requestAllowanceTokens,
): UsageAlertState {
  const next = structuredClone(state);
  const measured = usage.inputTokens + usage.outputTokens;
  const projected = measured + reservedTokens;
  for (const threshold of policy.warnings) {
    if (
      projected * 100 >= policy.budgetTokens * threshold &&
      !next.warned.includes(threshold)
    ) {
      next.warned.push(threshold);
      next.lastRepeatRequest = usage.requests;
      next.lastRepeatAt = now;
      alert(
        next,
        "threshold",
        `${threshold}% of the run token budget is reached or reserved.`,
        now,
      );
    }
  }
  if (
    latestRequestTokens !== undefined &&
    latestRequestTokens >= policy.spikeTokens &&
    due(next.lastSpikeAt, policy.cooldownMinutes, now)
  ) {
    next.lastSpikeAt = now;
    alert(next, "spike", "One request reported a token spike.", now);
  }
  if (
    policy.repeatEveryRequests > 0 &&
    next.warned.length > 0 &&
    usage.requests - next.lastRepeatRequest >= policy.repeatEveryRequests &&
    due(next.lastRepeatAt, policy.cooldownMinutes, now)
  ) {
    next.lastRepeatAt = now;
    next.lastRepeatRequest = usage.requests;
    alert(
      next,
      "threshold",
      "The run remains above a token warning threshold.",
      now,
    );
  }
  return next;
}

export function usagePauseReason(
  policy: UsageAlertPolicy,
  usage: UsageSnapshot,
  reservedTokens = usage.pending * policy.requestAllowanceTokens,
  nextAllowanceTokens = policy.requestAllowanceTokens,
): "unknown" | "budget" | null {
  if (policy.mode === "warn") return null;
  if (usage.unknown > 0) return "unknown";
  const projected =
    usage.inputTokens +
    usage.outputTokens +
    reservedTokens +
    nextAllowanceTokens;
  return projected >= policy.budgetTokens ? "budget" : null;
}
