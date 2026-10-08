import { describe, it, expect } from "vitest";
import { parseTask, parseTeammate, initialTeam } from "../src/shared/contracts";
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
});
