import { expect, it } from "vitest";
import { rosterMembers, starterRoster } from "../src/shared/fixed-teams";
import {
  applyCoreLineup,
  parseCoreLineup,
  parseCoreProposal,
} from "../src/shared/core-lineup";

const team = rosterMembers({
  ...starterRoster,
  memberIds: [...starterRoster.memberIds, "adrian", "meryl"],
});

it("accepts a task-specific lineup only from saved members in their catalog roles", () => {
  const proposal = parseCoreProposal(
    {
      builderId: "adrian",
      auditorId: "meryl",
      testerId: null,
      reason: "One builder can handle this small task; Meryl will review it.",
    },
    team,
  );
  expect(proposal.fallback).toBe(false);
  expect(
    applyCoreLineup(team, proposal).find((m) => m.id === "adrian")?.runRole,
  ).toBe("builder");
  expect(
    applyCoreLineup(team, proposal).find((m) => m.id === "maya")?.runRole,
  ).toBe("reserve");
  expect(proposal.testerId).toBeNull();
});

it("falls back safely when a model proposes an outsider or wrong role", () => {
  expect(
    parseCoreProposal(
      {
        builderId: "kiran",
        auditorId: "ellis",
        testerId: "jun",
        reason: "Use the security specialist as builder.",
      },
      team,
    ),
  ).toMatchObject({ builderId: "maya", fallback: true });
  expect(() =>
    parseCoreLineup(
      { builderId: "adrian", auditorId: "adrian", testerId: "jun" },
      team,
    ),
  ).toThrow("matching roles");
  expect(() =>
    parseCoreLineup(
      { builderId: "adrian", auditorId: "meryl", testerId: null, extra: 1 },
      team,
    ),
  ).toThrow("fields");
});
