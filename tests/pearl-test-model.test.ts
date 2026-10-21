import { describe, expect, it, vi } from "vitest";
import type { PearlModel } from "../src/engine/pearl-model";
import {
  cappedPearlModel,
  liveModelRequestLimit,
} from "../src/main/pearl-test-model";

const input: Parameters<PearlModel["complete"]>[0] = {
  key: "test",
  model: "test",
  system: "",
  messages: [],
};

describe("connected test request cap", () => {
  it("caps configured requests before any paid model call", () => {
    expect(liveModelRequestLimit(undefined)).toBe(200);
    expect(liveModelRequestLimit("7")).toBe(7);
    expect(liveModelRequestLimit("999")).toBe(999);
    expect(liveModelRequestLimit("invalid")).toBe(200);
  });
  it("allows exactly the configured number of calls and leaves the next call unsent", async () => {
    const complete = vi.fn(async () => ({
      kind: "reply" as const,
      text: "ok",
    }));
    const model = cappedPearlModel({ complete }, 2);
    await expect(model.complete(input)).resolves.toEqual({
      kind: "reply",
      text: "ok",
    });
    await expect(model.complete(input)).resolves.toEqual({
      kind: "reply",
      text: "ok",
    });
    expect(() => model.complete(input)).toThrow("budget exhausted");
    expect(complete).toHaveBeenCalledTimes(2);
  });
});
