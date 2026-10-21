import { expect, it } from "vitest";
import { initialTeam } from "../src/shared/contracts";
import {
  currentTeamStyle,
  parseTeamStyle,
  teamStyles,
} from "../src/shared/team-styles";

it("offers three complete working styles for the fixed team", () => {
  expect(teamStyles.map(({ id }) => id)).toEqual([
    "balanced",
    "test-first",
    "risk-review",
  ]);
  for (const style of teamStyles) {
    expect(Object.keys(style.profiles).sort()).toEqual(
      initialTeam.map(({ id }) => id).sort(),
    );
    for (const profile of Object.values(style.profiles)) {
      expect(profile.role.trim()).not.toBe("");
      expect(profile.bio.trim()).not.toBe("");
      expect(profile.instructions.trim()).not.toBe("");
    }
  }
  expect(currentTeamStyle(initialTeam)).toBe("balanced");
  expect(
    currentTeamStyle(
      initialTeam.map((person) =>
        person.id === "maya" ? { ...person, role: "Custom builder" } : person,
      ),
    ),
  ).toBeNull();
  expect(
    currentTeamStyle([
      ...initialTeam,
      { ...initialTeam[0], id: "unexpected", runRole: "reserve" },
    ]),
  ).toBe("balanced");
});

it("rejects unknown or forged style choices", () => {
  expect(() => parseTeamStyle("unknown")).toThrow("Unknown team style");
  expect(() => parseTeamStyle({ id: "balanced" })).toThrow(
    "Unknown team style",
  );
});
