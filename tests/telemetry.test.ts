import { expect, it, vi } from "vitest";
import {
  LocalMetrics,
  measured,
  sanitizeMetric,
} from "../src/shared/telemetry";
const metric = {
  version: 1,
  operation: "run:start",
  outcome: "returned",
  durationMs: 12,
} as const;
it("drops unknown fields and rejects unbounded labels and numbers", () => {
  expect(
    sanitizeMetric({
      ...metric,
      prompt: "secret",
      path: "/private",
      error: "private",
    }),
  ).toEqual(metric);
  for (const value of [
    { ...metric, operation: "secret" },
    { ...metric, outcome: "secret" },
    { ...metric, version: 2 },
    { ...metric, durationMs: Infinity },
    { ...metric, durationMs: -1 },
    { ...metric, durationMs: 86400001 },
    null,
  ])
    expect(sanitizeMetric(value)).toBeNull();
});
it("records recovery inspection only as a bounded operation outcome", () => {
  expect(
    sanitizeMetric({
      version: 1,
      operation: "apply:inspect",
      outcome: "returned",
      durationMs: 9,
      destination: "/private/project",
      backup: "original source content",
    }),
  ).toEqual({
    version: 1,
    operation: "apply:inspect",
    outcome: "returned",
    durationMs: 9,
  });
});
it("caps retained events, expires old entries and returns defensive copies", () => {
  let now = 1;
  const store = new LocalMetrics(() => now);
  for (let i = 0; i < 1200; i++) store.record(metric);
  expect(store.snapshot().events).toHaveLength(1000);
  const copy = store.snapshot();
  copy.events[0].operation = "model.request";
  expect(store.snapshot().events[0].operation).toBe("run:start");
  now += 86400000;
  expect(store.snapshot().events).toEqual([]);
  expect(new LocalMetrics().snapshot().events).toEqual([]);
});
it("records duration and preserves return values and original failures without retries", async () => {
  const sink = vi.fn();
  let now = 10;
  const action = vi.fn(() => {
    now = 35;
    return 42;
  });
  expect(await measured("run:start", action, sink, () => now)).toBe(42);
  expect(sink).toHaveBeenCalledWith({ ...metric, durationMs: 25 });
  expect(action).toHaveBeenCalledTimes(1);
  const error = new Error("private");
  await expect(
    measured(
      "run:start",
      () => {
        throw error;
      },
      sink,
    ),
  ).rejects.toBe(error);
  expect(sink.mock.calls.at(-1)![0].outcome).toBe("threw");
  expect(JSON.stringify(sink.mock.calls)).not.toContain("private");
});
it("isolates throwing, rejecting and stalled sinks and failing clocks", async () => {
  for (const sink of [
    () => {
      throw new Error("disk");
    },
    () => Promise.reject(new Error("offline")),
    () => new Promise<void>(() => {}),
  ])
    expect(await measured("run:start", () => 7, sink)).toBe(7);
  expect(
    await measured(
      "run:start",
      () => 8,
      () => {},
      () => {
        throw new Error("clock");
      },
    ),
  ).toBe(8);
});
