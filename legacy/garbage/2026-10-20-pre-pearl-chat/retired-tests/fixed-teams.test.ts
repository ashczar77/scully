import { expect, it } from "vitest";
import {
  parseFixedRoster,
  parseSaveFixedTeam,
  rosterMembers,
  starterRoster,
} from "../src/shared/fixed-teams";

it("requires Pearl and validates optional historical role defaults", () => {
  expect(
    rosterMembers(starterRoster).map(({ id, runRole }) => [id, runRole]),
  ).toEqual([
    ["pearl", "reserve"],
    ["maya", "builder"],
    ["ellis", "auditor"],
    ["jun", "tester"],
  ]);
  for (const invalid of [
    { ...starterRoster, memberIds: ["maya", "ellis", "jun"] },
    { ...starterRoster, memberIds: ["pearl", "maya", "ellis", "unknown"] },
    { ...starterRoster, memberIds: ["pearl", "maya", "ellis", "maya"] },
    { ...starterRoster, activeBuilderId: "ellis" },
    { ...starterRoster, activeAuditorId: "jun" },
    { ...starterRoster, activeTesterId: "malik" },
    {
      ...starterRoster,
      memberIds: ["pearl", "maya", "ellis", "jun", ...Array(13).fill("maya")],
    },
  ])
    expect(() => parseFixedRoster(invalid)).toThrow();
});
it("accepts a candidate team without a preassigned builder, tester or auditor", () => {
  const roster = parseFixedRoster({
    memberIds: ["pearl", "sloane", "kiran"],
    activeBuilderId: null,
    activeTesterId: null,
    activeAuditorId: null,
  });
  expect(rosterMembers(roster).map((item) => [item.id, item.runRole])).toEqual([
    ["pearl", "reserve"],
    ["sloane", "reserve"],
    ["kiran", "reserve"],
  ]);
});

it("keeps extra builders and specialists available without assigning them a request", () => {
  const members = rosterMembers({
    memberIds: [
      "pearl",
      "maya",
      "tessa",
      "ellis",
      "meryl",
      "jun",
      "sloane",
      "nico",
    ],
    activeBuilderId: "tessa",
    activeAuditorId: "meryl",
    activeTesterId: null,
  });
  expect(members.find(({ id }) => id === "tessa")?.runRole).toBe("builder");
  expect(members.find(({ id }) => id === "meryl")?.runRole).toBe("auditor");
  expect(members.find(({ id }) => id === "maya")?.runRole).toBe("reserve");
  expect(members.find(({ id }) => id === "sloane")?.runRole).toBe("reserve");
  expect(members.find(({ id }) => id === "nico")?.portraitId).toBe(
    "portrait-15",
  );
});

it("rejects forged save fields and does not accept editable profile details", () => {
  expect(parseSaveFixedTeam({ ...starterRoster, name: " Team " }).name).toBe(
    "Team",
  );
  for (const invalid of [
    { ...starterRoster, name: "" },
    { ...starterRoster, name: "Unsafe\nteam" },
    { ...starterRoster, name: "x".repeat(81) },
    { ...starterRoster, name: "Team", saveMode: "new" },
    {
      ...starterRoster,
      name: "Team",
      members: [{ id: "maya", name: "Forged" }],
    },
  ])
    expect(() => parseSaveFixedTeam(invalid)).toThrow();
});
