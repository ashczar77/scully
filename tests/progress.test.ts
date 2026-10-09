// @vitest-environment node
import { expect, it } from "vitest";
import { whileRequest } from "../src/engine/progress";
import type { Run } from "../src/shared/runs";

function run() {
  return {
    id: "run",
    status: "building",
    inFlightRequests: [],
  } as unknown as Run;
}

it("publishes a real in-flight request before completion and clears it afterward", async () => {
  const state = run();
  const snapshots: Run[] = [];
  let finish!: (value: string) => void;
  const pending = whileRequest(
    state,
    "maya",
    "propose_files",
    () => new Promise<string>((resolve) => (finish = resolve)),
    (snapshot) => snapshots.push(snapshot),
  );
  expect(snapshots[0].inFlightRequests).toMatchObject([
    { actor: "maya", name: "propose_files" },
  ]);
  expect(snapshots[0].inFlightRequests?.[0].startedAt).toBeTruthy();
  finish("draft");
  expect(await pending).toBe("draft");
  expect(snapshots.at(-1)?.inFlightRequests).toEqual([]);
});

it("keeps concurrent teammate requests separate and clears a failed request", async () => {
  const state = run();
  const snapshots: Run[] = [];
  let finishMaya!: () => void;
  let failJun!: (error: Error) => void;
  const maya = whileRequest(
    state,
    "maya",
    "propose_files",
    () => new Promise<void>((resolve) => (finishMaya = resolve)),
    (snapshot) => snapshots.push(snapshot),
  );
  const jun = whileRequest(
    state,
    "jun",
    "propose_files",
    () => new Promise<void>((_resolve, reject) => (failJun = reject)),
    (snapshot) => snapshots.push(snapshot),
  );
  expect(snapshots.at(-1)?.inFlightRequests?.map((item) => item.actor)).toEqual(
    ["maya", "jun"],
  );
  finishMaya();
  await maya;
  expect(state.inFlightRequests?.map((item) => item.actor)).toEqual(["jun"]);
  failJun(new Error("Provider failed"));
  await expect(jun).rejects.toThrow("Provider failed");
  expect(state.inFlightRequests).toEqual([]);
});
