// @vitest-environment node
import { expect, it } from "vitest";
import {
  chooseUsagePolicy,
  defaultUsagePolicy,
  expandsUsage,
} from "../src/shared/usage-policy";
import { makeCoordination } from "../src/shared/coordination";
import { initialTeam } from "../src/shared/contracts";

it("uses the assigned writer count when calculating consent ceilings", () => {
  const lean = { coordination: makeCoordination(initialTeam.slice(0, 2)) };
  expect(
    defaultUsagePolicy(lean as any, "work", "model", 2048).requestCeiling,
  ).toBe(2);
  expect(
    defaultUsagePolicy(lean as any, "plan", "model", 2048).requestCeiling,
  ).toBe(3);
  expect(
    chooseUsagePolicy(lean, "work", "model", { preset: "thorough" })
      .requestCeiling,
  ).toBe(3);
  expect(() =>
    chooseUsagePolicy(lean, "work", "model", {
      preset: "custom",
      outputTokens: 1024,
      requestCeiling: 2,
      earlyReviews: true,
    }),
  ).toThrow();
});

it("shows exact preset ceilings for work, planning and correction journeys", () => {
  const work = {};
  const plan = {
    redirection: {
      parentId: "old",
      instructions: [],
      previousPlan: "",
      previousDrafts: [],
    },
  } as any;
  const correction = { correction: {} } as any;
  expect(
    chooseUsagePolicy(work, "work", "model", { preset: "save" }),
  ).toMatchObject({
    outputTokens: 1024,
    requestCeiling: 3,
    earlyReviews: false,
  });
  expect(
    chooseUsagePolicy(plan, "work", "model", { preset: "save" }).requestCeiling,
  ).toBe(4);
  expect(
    chooseUsagePolicy(work, "plan", "model", { preset: "thorough" }),
  ).toMatchObject({
    outputTokens: 4096,
    requestCeiling: 6,
    earlyReviews: true,
  });
  expect(
    chooseUsagePolicy(work, "work", "model", { preset: "thorough" })
      .requestCeiling,
  ).toBe(5);
  expect(
    chooseUsagePolicy(correction, "work", "model", { preset: "thorough" }),
  ).toMatchObject({ requestCeiling: 2, earlyReviews: false });
  expect(
    chooseUsagePolicy(correction, "work", "model", { preset: "balanced" })
      .requestCeiling,
  ).toBe(2);
  expect(
    defaultUsagePolicy(correction, "work", "model", 2048).requestCeiling,
  ).toBe(2);
});

it("rejects custom ceilings below required work and invalid output settings", () => {
  for (const input of [
    {
      preset: "custom",
      outputTokens: 1024,
      requestCeiling: 2,
      earlyReviews: false,
    },
    {
      preset: "custom",
      outputTokens: 1024,
      requestCeiling: 4,
      earlyReviews: true,
    },
    {
      preset: "custom",
      outputTokens: 511,
      requestCeiling: 3,
      earlyReviews: false,
    },
    {
      preset: "custom",
      outputTokens: 1024,
      requestCeiling: 7,
      earlyReviews: false,
    },
    {
      preset: "custom",
      outputTokens: NaN,
      requestCeiling: 3,
      earlyReviews: false,
    },
    { preset: "unknown" },
  ])
    expect(() => chooseUsagePolicy({}, "work", "model", input)).toThrow();
  expect(() =>
    chooseUsagePolicy({ correction: {} } as any, "work", "model", {
      preset: "custom",
      outputTokens: 1024,
      requestCeiling: 2,
      earlyReviews: true,
    }),
  ).toThrow();
});

it("detects expanded allowance while preserving the legacy default", () => {
  const old = defaultUsagePolicy({}, "work", "model", 2048);
  expect(old.requestCeiling).toBe(4);
  expect(old.preset).toBe("balanced");
  expect(
    expandsUsage(
      old,
      chooseUsagePolicy({}, "work", "model", { preset: "save" }),
    ),
  ).toBe(false);
  expect(
    expandsUsage(
      old,
      chooseUsagePolicy({}, "work", "model", { preset: "thorough" }),
    ),
  ).toBe(true);
});
