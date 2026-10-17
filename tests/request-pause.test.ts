import { expect, it, vi } from "vitest";
import { RequestPauseGate } from "../src/engine/request-pause";

it("waits for every current request before holding the next one", async () => {
  const reached = vi.fn();
  const gate = new RequestPauseGate(reached);
  await gate.enter();
  await gate.enter();
  gate.request("pause-1");
  let dispatched = false;
  const next = gate.enter().then(() => {
    dispatched = true;
  });
  gate.leave();
  expect(reached).not.toHaveBeenCalled();
  gate.leave();
  expect(reached).toHaveBeenCalledExactlyOnceWith("pause-1");
  expect(dispatched).toBe(false);
  expect(() => gate.resume("wrong")).toThrow(/pause/i);
  gate.resume("pause-1");
  await next;
  expect(dispatched).toBe(true);
  gate.leave();
});

it("holds a request immediately when no earlier request is active", async () => {
  const reached = vi.fn();
  const gate = new RequestPauseGate(reached);
  gate.request("pause-2");
  const next = gate.enter();
  expect(reached).toHaveBeenCalledExactlyOnceWith("pause-2");
  gate.resume("pause-2");
  await next;
  gate.leave();
});
