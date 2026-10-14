import { expect, it } from "vitest";
import { initialTeam } from "../src/shared/contracts";
import { parseSaveTeam } from "../src/shared/teams";

it("accepts a two-to-six member roster with one builder and one independent auditor", () => {
  const extra = {
    ...initialTeam[2],
    id: "member-01",
    name: "Rin",
    runRole: "reserve",
  };
  expect(
    parseSaveTeam({ name: "Lean", members: initialTeam.slice(0, 2) }).members,
  ).toHaveLength(2);
  expect(
    parseSaveTeam({ name: "Expanded", members: [...initialTeam, extra] })
      .members,
  ).toHaveLength(4);
  expect(() =>
    parseSaveTeam({
      name: "No auditor",
      members: [initialTeam[0], initialTeam[2]],
    }),
  ).toThrow(/auditor/i);
  expect(() =>
    parseSaveTeam({
      name: "Duplicate auditor",
      members: [...initialTeam, { ...extra, runRole: "auditor" }],
    }),
  ).toThrow(/auditor/i);
  expect(() =>
    parseSaveTeam({
      name: "Too large",
      members: [
        ...initialTeam,
        ...Array.from({ length: 4 }, (_, i) => ({
          ...extra,
          id: `member-${i}`,
        })),
      ],
    }),
  ).toThrow(/six/i);
  expect(() =>
    parseSaveTeam({
      name: "Unsafe ID",
      members: [...initialTeam, { ...extra, id: "../escape" }],
    }),
  ).toThrow();
});

it("requires a named team with safe, unique members and required assignments", () => {
  expect(
    parseSaveTeam({ name: " Review team ", members: initialTeam }).name,
  ).toBe("Review team");
  for (const invalid of [
    { name: "", members: initialTeam },
    { name: "Bad\nname", members: initialTeam },
    { name: "x".repeat(81), members: initialTeam },
    { name: "Choice", members: initialTeam, saveMode: "new" },
    {
      name: "Choice",
      members: initialTeam,
      expectedDefaultTeamId: "one",
      saveMode: "invalid",
    },
    { name: "Short", members: initialTeam.slice(0, 1) },
    {
      name: "Duplicate",
      members: [initialTeam[0], initialTeam[0], initialTeam[2]],
    },
    {
      name: "Missing assignment",
      members: [
        initialTeam[0],
        initialTeam[1],
        { ...initialTeam[2], id: "outsider" },
      ],
    },
    {
      name: "Bad portrait",
      members: [
        initialTeam[0],
        initialTeam[1],
        { ...initialTeam[2], portraitId: "http://example.com/image" },
      ],
    },
  ])
    expect(() => parseSaveTeam(invalid)).toThrow();
});
