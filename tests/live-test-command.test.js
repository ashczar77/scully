import { expect, it } from "vitest";
import { safeTestCommand } from "../scripts/live-test-command.mjs";

it("accepts only bounded test commands in the disposable project", () => {
  for (const args of [
    ["--test"],
    ["--test", "test/"],
    ["--test", "test/api.test.js"],
    ["--test", "tests.js"],
    ["--test", "test/store.test.js", "test/integration.test.js"],
    ["test.js"],
  ]) {
    expect(safeTestCommand({ command: "node", args })).toBe(true);
  }
  for (const args of [
    ["-e", "process.exit(0)"],
    ["--test", "../secret.js"],
    ["--test", "test/../../secret.js"],
    ["--test", "test/", "--eval", "process.exit(0)"],
    ["--test", "src/server.js"],
    ["--test", "test/store.test.js", "../secret.js"],
    ["--test", ...Array.from({ length: 9 }, () => "test/store.test.js")],
  ]) {
    expect(safeTestCommand({ command: "node", args })).toBe(false);
  }
  expect(safeTestCommand({ command: "bash", args: ["-c", "true"] })).toBe(
    false,
  );
  expect(
    safeTestCommand({
      command: "go",
      args: ["test", "-v", "-count=1", "./..."],
    }),
  ).toBe(true);
  expect(safeTestCommand({ command: "go", args: ["test", "../../..."] })).toBe(
    false,
  );
});
