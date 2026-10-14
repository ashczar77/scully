import { describe, it, expect } from "vitest";
import { parseTask, parseTeammate, initialTeam } from "../src/shared/contracts";
import {
  portraitOptions,
  parsePortraitId,
} from "../src/shared/portrait-library";
describe("validated desktop inputs", () => {
  it("trims task fields", () =>
    expect(
      parseTask({ title: " Fix bug ", description: "", mode: "plan" }).title,
    ).toBe("Fix bug"));
  it.each([
    null,
    {},
    { title: "", description: "", mode: "work" },
    { title: "x", description: "", mode: "shell" },
    { title: "x".repeat(121), description: "", mode: "work" },
  ])("rejects malformed task %j", (v) => expect(() => parseTask(v)).toThrow());
  it("rejects unknown teammate IDs", () =>
    expect(() => parseTeammate({ ...initialTeam[0], id: "other" })).toThrow());
  it("validates profile limits", () =>
    expect(() =>
      parseTeammate({ ...initialTeam[0], instructions: "x".repeat(2001) }),
    ).toThrow());
  it("offers 16 portrait IDs for fixed and historical teammates and rejects arbitrary image paths", () => {
    expect(portraitOptions).toHaveLength(16);
    expect(new Set(portraitOptions.map(({ id }) => id)).size).toBe(16);
    for (const person of initialTeam)
      expect(
        parseTeammate({ ...person, portraitId: "portrait-12" }).portraitId,
      ).toBe("portrait-12");
    for (const value of [
      "file:///private/secret",
      "../../asset.png",
      "url(javascript:alert(1))",
      "portrait-17",
      null,
    ]) {
      expect(() => parsePortraitId(value)).toThrow("Unknown portrait");
      expect(() =>
        parseTeammate({ ...initialTeam[0], portraitId: value }),
      ).toThrow("Unknown portrait");
    }
  });
});
