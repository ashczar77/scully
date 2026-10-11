import { expect, it } from "vitest";
import {
  defaultUsageAlertPolicy,
  emptyUsageAlertState,
  parseUsageAlertPolicy,
  recordUsageAlerts,
  usagePauseReason,
} from "../src/shared/usage-alerts";
import type { UsageSnapshot } from "../src/shared/usage";

const usage = (requests = 0, inputTokens = 0, pending = 0): UsageSnapshot => ({
  requests,
  measured: requests - pending,
  unknown: 0,
  pending,
  inputTokens,
  outputTokens: 0,
  pendingMaxOutputTokens: pending * 512,
});

it("validates bounded alert settings and keeps the safe default", () => {
  expect(defaultUsageAlertPolicy).toMatchObject({
    warnings: [50, 80],
    mode: "pause",
    delivery: "in_app",
  });
  expect(() =>
    parseUsageAlertPolicy({ ...defaultUsageAlertPolicy, warnings: [80, 50] }),
  ).toThrow();
  expect(() =>
    parseUsageAlertPolicy({
      ...defaultUsageAlertPolicy,
      budgetTokens: Infinity,
    }),
  ).toThrow();
  expect(() =>
    parseUsageAlertPolicy({ ...defaultUsageAlertPolicy, delivery: "email" }),
  ).toThrow();
  expect(() =>
    parseUsageAlertPolicy({ ...defaultUsageAlertPolicy, mode: "auto-approve" }),
  ).toThrow();
});

it("warns at configured crossings once and applies spike cooldown and repeat cadence", () => {
  const policy = {
    ...defaultUsageAlertPolicy,
    budgetTokens: 10000,
    requestAllowanceTokens: 1000,
    spikeTokens: 3000,
    repeatEveryRequests: 3,
    cooldownMinutes: 5,
  };
  let state = emptyUsageAlertState();
  const at = "2026-10-11T00:00:00.000Z";
  state = recordUsageAlerts(policy, state, usage(1, 4999), at, 4000);
  expect(state.recent).toHaveLength(1);
  expect(state.recent[0].kind).toBe("spike");
  state = recordUsageAlerts(policy, state, usage(2, 5000), at);
  expect(state.warned).toEqual([50]);
  state = recordUsageAlerts(policy, state, usage(3, 8000), at);
  expect(state.warned).toEqual([50, 80]);
  const count = state.sequence;
  state = recordUsageAlerts(policy, state, usage(4, 9000), at, 4000);
  expect(state.sequence).toBe(count);
  state = recordUsageAlerts(
    policy,
    state,
    usage(6, 9000),
    "2026-10-11T00:06:00.000Z",
    4000,
  );
  expect(state.recent.at(-1)?.kind).toBe("threshold");
  expect(state.recent).toHaveLength(5);
});

it("pauses on reserved allowance or unknown usage while warning-only never pauses", () => {
  const policy = {
    ...defaultUsageAlertPolicy,
    budgetTokens: 10000,
    requestAllowanceTokens: 5000,
  };
  expect(usagePauseReason(policy, usage(0, 0, 1))).toBe("budget");
  expect(usagePauseReason(policy, usage(0, 0, 0))).toBeNull();
  expect(usagePauseReason(policy, { ...usage(), unknown: 1 })).toBe("unknown");
  expect(
    usagePauseReason({ ...policy, mode: "warn" }, { ...usage(), unknown: 1 }),
  ).toBeNull();
});
