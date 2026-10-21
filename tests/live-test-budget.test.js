import { expect, it } from "vitest";
import {
  liveRequestLimit,
  liveStallTracker,
} from "../scripts/live-test-budget.mjs";

it("bounds invalid and excessive paid request limits", () => {
  expect(liveRequestLimit()).toBe(18);
  expect(liveRequestLimit("not-a-number")).toBe(18);
  expect(liveRequestLimit("0")).toBe(18);
  expect(liveRequestLimit("1000")).toBe(24);
  expect(liveRequestLimit("12")).toBe(12);
});

it("stops a running live turn after no saved progress and resets on action", () => {
  let now = 0;
  const stalled = liveStallTracker(() => now, 120_000);
  expect(stalled("running", 2)).toBe(false);
  now = 120_001;
  expect(stalled("running", 2)).toBe(true);
  expect(stalled("idle", 2)).toBe(false);
  expect(stalled("running", 3)).toBe(false);
  now += 119_999;
  expect(stalled("running", 3)).toBe(false);
  now += 2;
  expect(stalled("running", 3)).toBe(true);
});
