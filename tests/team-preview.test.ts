import { expect, it } from "vitest";
import { initialTeam } from "../src/shared/contracts";
import { previewTeamRun } from "../src/shared/team-preview";
import { rosterMembers, starterRoster } from "../src/shared/fixed-teams";

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

it("shows Pearl as the fixed-cast planner without adding a request", () => {
  const team = rosterMembers(starterRoster);
  expect(previewTeamRun(team, "plan", session, now)).toMatchObject({
    planner: "Pearl",
    idleCoordinator: null,
    builder: "Maya",
    reserves: [],
    requiredRequests: 4,
    requestCeiling: 4,
    phases: [
      { id: "planning", member: "Pearl", requiredRequests: 1 },
      { id: "building", member: "Maya", requiredRequests: 1 },
      { id: "testing", member: "Jun", requiredRequests: 1 },
      { id: "auditing", member: "Ellis", requiredRequests: 1 },
    ],
  });
  expect(previewTeamRun(team, "work", session, now)).toMatchObject({
    planner: null,
    idleCoordinator: "Pearl",
    reserves: [],
    phases: [
      { id: "building", member: "Maya", requiredRequests: 1 },
      { id: "testing", member: "Jun", requiredRequests: 1 },
      { id: "auditing", member: "Ellis", requiredRequests: 1 },
    ],
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
    phases: [
      { id: "building", member: "Maya", requiredRequests: 1 },
      { id: "auditing", member: "Ellis", requiredRequests: 1 },
    ],
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
