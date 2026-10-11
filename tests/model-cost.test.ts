import { expect, it } from "vitest";
import {
  costBudgetReason,
  emptyCostSettings,
  emptyCostTotals,
  measuredCostNanoUsd,
  parseCostSettings,
  resolveModelRate,
} from "../src/shared/model-cost";

const now = new Date("2026-10-11T12:00:00Z");
it("uses only current exact Nebius model listings and expires them", () => {
  const published = resolveModelRate("zai-org/GLM-5.3", emptyCostSettings, now);
  expect(published).toMatchObject({
    rateStatus: "verified",
    rate: {
      inputMilliUsdPerMillion: 1400,
      outputMilliUsdPerMillion: 4400,
      checkedAt: "2026-10-11",
      source: "nebius_listing",
    },
  });
  expect(resolveModelRate("GLM-5.3", emptyCostSettings, now).rateStatus).toBe(
    "unknown",
  );
  expect(
    resolveModelRate(
      "zai-org/GLM-5.3",
      emptyCostSettings,
      new Date("2026-11-11T12:00:00Z"),
    ).rateStatus,
  ).toBe("stale");
  expect(
    measuredCostNanoUsd(
      { inputTokens: 1000, outputTokens: 500 },
      published.rate!,
    ),
  ).toBe(3_600_000);
});

it("rejects invalid and mismatched user supplied rates, including future and stale dates", () => {
  const model = "custom/model";
  const rate = {
    model,
    inputMilliUsdPerMillion: 1000,
    outputMilliUsdPerMillion: 2000,
    checkedAt: "2026-10-11",
    source: "nebius_listing",
    sourceUrl: "https://wrong.example",
  };
  const settings = parseCostSettings(
    { budgetCents: 100, manualRate: rate },
    model,
  );
  expect(settings.manualRate).toMatchObject({
    source: "user_supplied",
    sourceUrl: null,
  });
  expect(resolveModelRate(model, settings, now).rateStatus).toBe(
    "user_estimate",
  );
  expect(
    resolveModelRate(model, settings, new Date("2026-11-11T12:00:00Z"))
      .rateStatus,
  ).toBe("stale");
  for (const changed of [
    { ...rate, model: "other" },
    { ...rate, checkedAt: "2026-10-12" },
    { ...rate, checkedAt: "2026-02-30" },
    { ...rate, inputMilliUsdPerMillion: -1 },
    { ...rate, inputMilliUsdPerMillion: 0, outputMilliUsdPerMillion: 0 },
  ]) {
    const parsed = () =>
      parseCostSettings({ budgetCents: 100, manualRate: changed }, model);
    if (changed.checkedAt === "2026-10-12") {
      expect(resolveModelRate(model, parsed(), now).rateStatus).toBe("stale");
    } else expect(parsed).toThrow();
  }
  expect(() =>
    parseCostSettings({ budgetCents: 0, manualRate: null }, model),
  ).toThrow();
});

it("treats missing usage, price and partial totals as unknown, not zero spend", () => {
  expect(costBudgetReason(1, emptyCostTotals, null)).toBe("cost_unknown");
  expect(costBudgetReason(1, { ...emptyCostTotals, unknownUsage: 1 }, 0)).toBe(
    "cost_unknown",
  );
  expect(costBudgetReason(1, emptyCostTotals, 10_000_000)).toBe("cost_budget");
  expect(costBudgetReason(null, emptyCostTotals, null)).toBeNull();
});
