import { expect, it } from "vitest";
import {
  liveRequestLimit,
  liveStallTracker,
  remainingLiveRequests,
} from "../scripts/live-test-budget.mjs";

it("honors an explicit development budget large enough for implementation and repair", () => {
  expect(liveRequestLimit()).toBe(200);
  expect(liveRequestLimit("not-a-number")).toBe(200);
  expect(liveRequestLimit("0")).toBe(200);
  expect(liveRequestLimit("1000")).toBe(1000);
  expect(liveRequestLimit("12")).toBe(12);
});

it("carries the paid request cap across an app restart", () => {
  expect(remainingLiveRequests(18, 11)).toBe(7);
  expect(remainingLiveRequests(18, 18)).toBe(0);
  expect(remainingLiveRequests(18, 19)).toBe(0);
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
