import { expect, it } from "vitest";
import { initialTeam } from "../src/shared/contracts";
import { previewTeamRun } from "../src/shared/team-preview";

const now = new Date("2026-10-13T10:00:00Z");
const session = {
  configured: true,
  model: "zai-org/GLM-5.3",
  outputTokens: 2048,
};

it("shows the actual requests for builder, tester and independent auditor", () => {
  const plan = previewTeamRun(initialTeam, "plan", session, now);
  expect(plan).toMatchObject({
    builder: "Maya",
    tester: "Jun",
    auditor: "Ellis",
    reserves: [],
    requiredRequests: 4,
    requestCeiling: 4,
    outputTokensPerRequest: 2048,
    rateStatus: "verified",
  });
  expect(plan.planningEstimateNanoUsd).toBe(4 * 2048 * 4400);
  expect(previewTeamRun(initialTeam, "work", session, now)).toMatchObject({
    requiredRequests: 3,
    requestCeiling: 4,
  });
});

it("does not count a reserve as active work or additional cost", () => {
  const withoutTester = initialTeam.filter((member) => member.id !== "jun");
  const base = previewTeamRun(withoutTester, "work", session, now);
  const reserve = previewTeamRun(
    [...withoutTester, { ...initialTeam[2], runRole: "reserve" }],
    "work",
    session,
    now,
  );
  expect(base).toMatchObject({
    tester: null,
    requiredRequests: 2,
    requestCeiling: 2,
  });
  expect(reserve).toMatchObject({
    reserves: ["Jun"],
    requiredRequests: base.requiredRequests,
    requestCeiling: base.requestCeiling,
    planningEstimateNanoUsd: base.planningEstimateNanoUsd,
  });
});

it("marks missing, stale and invalid pricing as unknown instead of zero", () => {
  expect(previewTeamRun(initialTeam, "work", null, now)).toMatchObject({
    rateStatus: "unknown",
    planningEstimateNanoUsd: null,
  });
  expect(
    previewTeamRun(initialTeam, "work", session, new Date("2026-11-13")),
  ).toMatchObject({
    rateStatus: "stale",
    planningEstimateNanoUsd: null,
  });
  expect(
    previewTeamRun(
      initialTeam,
      "work",
      { ...session, outputTokens: 999999 },
      now,
    ),
  ).toMatchObject({
    outputTokensPerRequest: null,
    planningEstimateNanoUsd: null,
  });
  expect(
    previewTeamRun(initialTeam, "work", { ...session, configured: false }, now),
  ).toMatchObject({ rateStatus: "unknown", planningEstimateNanoUsd: null });
  expect(() => previewTeamRun([], "work", session, now)).toThrow(
    "A builder and independent auditor are required",
  );
});
