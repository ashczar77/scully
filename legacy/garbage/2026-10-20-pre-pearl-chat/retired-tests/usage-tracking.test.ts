// @vitest-environment node
import { expect, it, vi } from "vitest";
import { trackedModel } from "../src/engine/usage-tracking";
import type { Completion } from "../src/engine/provider";

const request = {
  system: "role",
  input: "task",
  name: "propose_plan",
  schema: {},
};

it("waits for a durable usage acknowledgment before dispatching a model request", async () => {
  const complete = vi.fn(async (value) => {
    value.onUsage?.({ inputTokens: 12, outputTokens: 5 });
    return { plan: "done" };
  });
  const emit = vi.fn();
  let acknowledge!: () => void;
  const waitForAck = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        acknowledge = resolve;
      }),
  );
  const model = trackedModel(
    { complete },
    { model: "model", outputTokens: 512 },
    emit,
    waitForAck,
    vi.fn(),
  );
  const result = model.complete(request);
  expect(complete).not.toHaveBeenCalled();
  const id = (emit.mock.calls[0][0] as { usageStart: { id: string } })
    .usageStart.id;
  expect(waitForAck).toHaveBeenCalledWith(id);
  acknowledge();
  await expect(result).resolves.toEqual({ plan: "done" });
  expect(emit).toHaveBeenLastCalledWith({
    usageFinish: { id, usage: { inputTokens: 12, outputTokens: 5 } },
  });
});
it("reserves usage for the selected actor and model before dispatch", async () => {
  const complete = vi.fn(async () => ({ ok: true }));
  const emit = vi.fn();
  const model = trackedModel(
    { complete },
    { model: "fallback", outputTokens: 512 },
    emit,
    async () => {},
    vi.fn(),
  );
  await model.complete({ ...request, actor: "maya", model: "model-builder" });
  expect(emit.mock.calls[0][0].usageStart).toEqual(
    expect.objectContaining({ actor: "maya", model: "model-builder" }),
  );
  expect(complete).toHaveBeenCalledWith(
    expect.objectContaining({ actor: "maya", model: "model-builder" }),
  );
});

it("does not dispatch without an acknowledgment and marks provider failure unknown", async () => {
  const complete = vi
    .fn()
    .mockRejectedValue(new Error("offline fixture failure"));
  const emit = vi.fn();
  const refused = trackedModel(
    { complete },
    { model: "model", outputTokens: 512 },
    emit,
    async () => {
      throw new Error("not recorded");
    },
    vi.fn(),
  );
  await expect(refused.complete(request)).rejects.toThrow("not recorded");
  expect(complete).not.toHaveBeenCalled();
  expect(emit).toHaveBeenCalledTimes(1);
  const accepted = trackedModel(
    { complete },
    { model: "model", outputTokens: 512 },
    emit,
    async () => {},
    vi.fn(),
  );
  await expect(accepted.complete(request)).rejects.toThrow(
    "offline fixture failure",
  );
  const id = (emit.mock.calls[1][0] as { usageStart: { id: string } })
    .usageStart.id;
  expect(emit).toHaveBeenLastCalledWith({ usageFinish: { id, usage: null } });
});

it("keeps an already waiting request's output limit when later requests are lowered", async () => {
  const config = { model: "model", outputTokens: 2048 };
  const complete = vi.fn(async (_request: Completion) => ({ ok: true }));
  const emit = vi.fn();
  const releases: (() => void)[] = [];
  const model = trackedModel(
    { complete },
    config,
    emit,
    () =>
      new Promise<void>((resolve) => {
        releases.push(resolve);
      }),
    vi.fn(),
  );
  const first = model.complete(request);
  expect(emit.mock.calls[0][0].usageStart.maxOutputTokens).toBe(2048);
  config.outputTokens = 1024;
  releases.shift()!();
  await first;
  expect(complete.mock.calls[0][0].maxOutputTokens).toBe(2048);
  const second = model.complete(request);
  expect(emit.mock.calls[2][0].usageStart.maxOutputTokens).toBe(1024);
  releases.shift()!();
  await second;
  expect(complete.mock.calls[1][0].maxOutputTokens).toBe(1024);
});

it("respects a request output allowance and forwards diagnostics to its caller", async () => {
  const onUsage = vi.fn();
  const onDiagnostic = vi.fn();
  const diagnostic = { outcome: "incomplete", finishReason: "length" };
  const complete = vi.fn(async (value: Completion) => {
    value.onUsage?.({ inputTokens: 10, outputTokens: 2048 });
    value.onDiagnostic?.(
      diagnostic as Parameters<NonNullable<Completion["onDiagnostic"]>>[0],
    );
    return { ok: true };
  });
  const emit = vi.fn();
  const model = trackedModel(
    { complete },
    { model: "model", outputTokens: 2048 },
    emit,
    async () => {},
    vi.fn(),
  );
  await model.complete({
    ...request,
    maxOutputTokens: 8192,
    onUsage,
    onDiagnostic,
  });
  expect(emit.mock.calls[0][0].usageStart.maxOutputTokens).toBe(8192);
  expect(complete.mock.calls[0][0].maxOutputTokens).toBe(8192);
  expect(onUsage).toHaveBeenCalledWith({ inputTokens: 10, outputTokens: 2048 });
  expect(onDiagnostic).toHaveBeenCalledWith(diagnostic);
  expect(emit).toHaveBeenCalledWith({ requestDiagnostic: diagnostic });
});
