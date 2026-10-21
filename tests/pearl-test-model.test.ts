import { describe, expect, it, vi } from "vitest";
import type { PearlModel } from "../src/engine/pearl-model";
import { cappedPearlModel } from "../src/main/pearl-test-model";

const input: Parameters<PearlModel["complete"]>[0] = {
  key: "test",
  model: "test",
  system: "",
  messages: [],
};

describe("connected test request cap", () => {
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
