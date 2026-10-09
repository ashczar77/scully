// @vitest-environment node
import { expect, it } from "vitest";
import { parseCommands } from "../src/shared/commands";

const spec = {
  executable: "node",
  args: ["--test", "test.js"],
  cwd: ".",
  reason: "Run unit tests",
  timeoutSeconds: 30,
};
it("accepts bounded direct commands and older drafts without proposals", () => {
  expect(parseCommands([spec])).toEqual([spec]);
  expect(parseCommands(undefined)).toEqual([]);
});
it.each([
  { executable: "node && rm" },
  { executable: "/bin/sh" },
  { args: ["line\nbreak"] },
  { args: [null] },
  { args: "--test" },
  { args: Array(33).fill("x") },
  { cwd: "../source" },
  { cwd: "/tmp" },
  { cwd: ".git" },
  { timeoutSeconds: 0 },
  { timeoutSeconds: 121 },
  { timeoutSeconds: 1.5 },
  { reason: "" },
  { args: ["sk-123456789012345678901234"] },
])("rejects invalid or private proposal %j", (patch) => {
  expect(() => parseCommands([{ ...spec, ...patch }])).toThrow();
});
it("caps proposal count and total size", () => {
  expect(() => parseCommands(Array(7).fill(spec))).toThrow();
  expect(() =>
    parseCommands([{ ...spec, args: Array(10).fill("x".repeat(1000)) }]),
  ).toThrow();
});
it("keeps arguments literal, without claiming project scripts are safe", () => {
  expect(
    parseCommands([
      { ...spec, args: ["-e", "process.exit(1)", "$(example)"] },
    ])[0].args,
  ).toEqual(["-e", "process.exit(1)", "$(example)"]);
});
