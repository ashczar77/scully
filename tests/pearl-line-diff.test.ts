import { expect, it } from "vitest";
import { lineChanges } from "../src/renderer/pearl-line-diff";

it("marks a single inserted line without marking the shifted lines", () => {
  const changes = lineChanges("one\ntwo\nthree", "one\nnew\ntwo\nthree");
  expect([...changes.removed]).toEqual([]);
  expect([...changes.added]).toEqual([2]);
});

it("marks removals and independent edits on both sides", () => {
  const changes = lineChanges(
    "one\nold\nthree\ngone\nfive",
    "one\nnew\nthree\nfive",
  );
  expect([...changes.removed].sort()).toEqual([2, 4]);
  expect([...changes.added]).toEqual([2]);
});

it("handles added and deleted files", () => {
  expect([...lineChanges("", "first\nsecond").added]).toEqual([1, 2]);
  expect([...lineChanges("first\nsecond", "").removed]).toEqual([1, 2]);
});
