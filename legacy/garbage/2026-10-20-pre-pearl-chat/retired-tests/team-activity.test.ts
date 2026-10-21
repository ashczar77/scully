import { expect, it } from "vitest";
import { summarizeTeamActivity } from "../src/shared/team-activity";

const event = (actor: string) => ({
  actor,
  text: "Saved message",
  at: "2026-10-12T00:00:00Z",
});
const row = (...events: unknown[]) => ({ data: JSON.stringify({ events }) });

it("counts recorded teammate events and distinct runs without treating system events as work", () => {
  expect(
    summarizeTeamActivity([
      row(event("maya"), event("maya"), event("system")),
      row(event("maya"), event("ellis")),
    ]),
  ).toEqual({
    byTeammate: {
      maya: { recordedEvents: 3, runsWithEvents: 2 },
      ellis: { recordedEvents: 1, runsWithEvents: 1 },
      jun: { recordedEvents: 0, runsWithEvents: 0 },
    },
    scannedRuns: 2,
    partial: false,
  });
});

it("marks malformed and oversized records partial, counting only valid bounded events", () => {
  const result = summarizeTeamActivity([
    row(event("jun"), { actor: "jun" }, event("unknown")),
    { data: "not json" },
    { data: null },
    row(...Array.from({ length: 2001 }, () => event("maya"))),
  ]);
  expect(result.partial).toBe(true);
  expect(result.scannedRuns).toBe(4);
  expect(result.byTeammate.jun).toEqual({
    recordedEvents: 1,
    runsWithEvents: 1,
  });
  expect(result.byTeammate.maya).toEqual({
    recordedEvents: 2000,
    runsWithEvents: 1,
  });
});

it("limits the scan to 2,000 recent runs", () => {
  const result = summarizeTeamActivity(
    Array.from({ length: 2001 }, () => row(event("maya"))),
  );
  expect(result).toMatchObject({
    scannedRuns: 2000,
    partial: true,
    byTeammate: { maya: { recordedEvents: 2000, runsWithEvents: 2000 } },
  });
});

it("counts a custom member only when the saved run team includes that ID", () => {
  const withMember = {
    data: JSON.stringify({
      teamSnapshot: { members: [{ id: "member-rin" }] },
      events: [event("member-rin")],
    }),
  };
  const withoutMember = {
    data: JSON.stringify({
      teamSnapshot: { members: [{ id: "member-sol" }] },
      events: [event("member-rin")],
    }),
  };
  const result = summarizeTeamActivity([withMember, withoutMember]);
  expect(result.byTeammate["member-rin"]).toEqual({
    recordedEvents: 1,
    runsWithEvents: 1,
  });
  expect(result.partial).toBe(true);
});
