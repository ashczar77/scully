import type { ReportedUsage } from "./usage";

export type ModelRate = {
  model: string;
  inputMilliUsdPerMillion: number;
  outputMilliUsdPerMillion: number;
  checkedAt: string;
  source: "nebius_listing" | "user_supplied";
  sourceUrl: string | null;
};
export type CostSettings = {
  budgetCents: number | null;
  manualRate: ModelRate | null;
};
export type CostTotals = {
  verifiedNanoUsd: number;
  estimatedNanoUsd: number;
  unpricedMeasured: number;
  unknownUsage: number;
  pendingProjectedNanoUsd: number;
  unpricedPending: number;
};
export type CostSnapshot = {
  model: string;
  settings: CostSettings;
  rate: ModelRate | null;
  referenceRate: ModelRate | null;
  rateStatus: "verified" | "user_estimate" | "stale" | "unknown";
  totals: CostTotals;
  nextProjectedNanoUsd: number | null;
  budgetExposureNanoUsd: number | null;
};

export const emptyCostSettings: CostSettings = {
  budgetCents: null,
  manualRate: null,
};
export const emptyCostTotals: CostTotals = {
  verifiedNanoUsd: 0,
  estimatedNanoUsd: 0,
  unpricedMeasured: 0,
  unknownUsage: 0,
  pendingProjectedNanoUsd: 0,
  unpricedPending: 0,
};

// Exact public endpoint IDs only. Bundled listings expire after 30 days.
// Nebius model pages checked 2026-10-11; no network request is made at runtime.
const listedRates: readonly ModelRate[] = [
  {
    model: "zai-org/GLM-5.3",
    inputMilliUsdPerMillion: 1400,
    outputMilliUsdPerMillion: 4400,
    checkedAt: "2026-10-11",
    source: "nebius_listing",
    sourceUrl:
      "https://nebius.com/services/token-factory/models/glm-models-inference",
  },
  {
    model: "nvidia/Nemotron-3_5-Lightning",
    inputMilliUsdPerMillion: 60,
    outputMilliUsdPerMillion: 240,
    checkedAt: "2026-10-11",
    source: "nebius_listing",
    sourceUrl:
      "https://nebius.com/services/token-factory/models/nvidia-nemotron-models-inference",
  },
];

export function parseCostSettings(value: unknown, model: string): CostSettings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid model cost settings");
  const row = value as Record<string, unknown>;
  if (!("budgetCents" in row) || !("manualRate" in row))
    throw new Error("Invalid model cost settings");
  const budget = row.budgetCents;
  if (
    budget !== null &&
    (!Number.isSafeInteger(budget) ||
      (budget as number) < 1 ||
      (budget as number) > 10000000)
  )
    throw new Error("Invalid USD warning budget");
  const manual = row.manualRate;
  if (manual === null)
    return { budgetCents: budget as number | null, manualRate: null };
  if (!manual || typeof manual !== "object" || Array.isArray(manual) || !model)
    throw new Error("Configure a model before entering its rate");
  const rate = manual as Record<string, unknown>;
  const validPrice = (n: unknown) =>
    Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= 1000000;
  const date = rate.checkedAt;
  if (
    rate.model !== model ||
    !validPrice(rate.inputMilliUsdPerMillion) ||
    !validPrice(rate.outputMilliUsdPerMillion) ||
    ((rate.inputMilliUsdPerMillion as number) === 0 &&
      (rate.outputMilliUsdPerMillion as number) === 0) ||
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
  )
    throw new Error("Invalid model-specific rate");
  return {
    budgetCents: budget as number | null,
    manualRate: {
      model,
      inputMilliUsdPerMillion: rate.inputMilliUsdPerMillion as number,
      outputMilliUsdPerMillion: rate.outputMilliUsdPerMillion as number,
      checkedAt: date,
      source: "user_supplied",
      sourceUrl: null,
    },
  };
}

export function resolveModelRate(
  model: string,
  settings: CostSettings,
  now: Date,
): Pick<CostSnapshot, "rate" | "referenceRate" | "rateStatus"> {
  const candidate =
    settings.manualRate || listedRates.find((rate) => rate.model === model);
  if (!candidate || candidate.model !== model)
    return { rate: null, referenceRate: null, rateStatus: "unknown" };
  const age = now.getTime() - Date.parse(`${candidate.checkedAt}T00:00:00Z`);
  if (!Number.isFinite(age) || age < 0 || age > 30 * 86400000)
    return { rate: null, referenceRate: candidate, rateStatus: "stale" };
  return {
    rate: candidate,
    referenceRate: candidate,
    rateStatus:
      candidate.source === "nebius_listing" ? "verified" : "user_estimate",
  };
}

// One token at $1 per million costs 1000 nanodollars. Prices are stored in
// thousandths of USD per million, so the integer product is nanodollars.
export function measuredCostNanoUsd(
  usage: ReportedUsage,
  rate: ModelRate,
): number | null {
  if (
    !Number.isSafeInteger(usage.inputTokens) ||
    !Number.isSafeInteger(usage.outputTokens) ||
    usage.inputTokens < 0 ||
    usage.outputTokens < 0 ||
    usage.inputTokens > 1000000000 ||
    usage.outputTokens > 1000000000 ||
    !Number.isSafeInteger(rate.inputMilliUsdPerMillion) ||
    !Number.isSafeInteger(rate.outputMilliUsdPerMillion) ||
    rate.inputMilliUsdPerMillion < 0 ||
    rate.outputMilliUsdPerMillion < 0
  )
    return null;
  const amount =
    BigInt(usage.inputTokens) * BigInt(rate.inputMilliUsdPerMillion) +
    BigInt(usage.outputTokens) * BigInt(rate.outputMilliUsdPerMillion);
  return amount <= 100000000000000n ? Number(amount) : null;
}

export function projectedCostNanoUsd(
  allowanceTokens: number,
  rate: ModelRate,
): number {
  return (
    allowanceTokens *
    Math.max(rate.inputMilliUsdPerMillion, rate.outputMilliUsdPerMillion)
  );
}

export function costExposureNanoUsd(
  totals: CostTotals,
  next = 0,
): number | null {
  const sum =
    BigInt(totals.verifiedNanoUsd) +
    BigInt(totals.estimatedNanoUsd) +
    BigInt(totals.pendingProjectedNanoUsd) +
    BigInt(next);
  return sum <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(sum) : null;
}

export function costBudgetReason(
  budgetCents: number | null,
  totals: CostTotals,
  nextProjectedNanoUsd: number | null,
): "cost_unknown" | "cost_budget" | null {
  if (budgetCents === null) return null;
  if (
    nextProjectedNanoUsd === null ||
    totals.unpricedMeasured > 0 ||
    totals.unknownUsage > 0 ||
    totals.unpricedPending > 0
  )
    return "cost_unknown";
  const exposure = costExposureNanoUsd(totals, nextProjectedNanoUsd);
  if (exposure === null) return "cost_unknown";
  return exposure >= budgetCents * 10000000 ? "cost_budget" : null;
}
