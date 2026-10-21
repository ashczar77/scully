// @vitest-environment node
import { expect, it } from "vitest";
import { applyTextPatch } from "../src/main/pearl-patch";

it("applies multiple nonoverlapping edits against one file snapshot", () => {
  const result = applyTextPatch("alpha\nbeta\ngamma\n", [
    { oldText: "alpha", newText: "first" },
    { oldText: "gamma", newText: "last" },
  ]);
  expect(result.content).toBe("first\nbeta\nlast\n");
  expect(result.hunks).toEqual([
    { line: 1, removed: "alpha", added: "first" },
    { line: 3, removed: "gamma", added: "last" },
  ]);
});

it("rejects ambiguous, overlapping, empty and no-op edits before writing", () => {
  expect(() =>
    applyTextPatch("same\nsame\n", [{ oldText: "same", newText: "other" }]),
  ).toThrow("exactly one");
  expect(() =>
    applyTextPatch("abcdef", [
      { oldText: "abc", newText: "one" },
      { oldText: "bcd", newText: "two" },
    ]),
  ).toThrow("overlap");
  expect(() => applyTextPatch("abc", [])).toThrow("edit count");
  expect(() =>
    applyTextPatch("abc", [{ oldText: "abc", newText: "abc" }]),
  ).toThrow("no change");
});
