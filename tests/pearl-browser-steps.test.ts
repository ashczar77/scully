// @vitest-environment node
import { expect, it } from "vitest";
import {
  boundedBrowserWork,
  validateBrowserSteps,
} from "../src/main/pearl-browser-steps";

it("accepts bounded browser interactions and an empty observation", () => {
  expect(validateBrowserSteps(undefined)).toEqual([]);
  expect(
    validateBrowserSteps([
      { action: "fill", selector: "#title", value: "Dune" },
      { action: "press", selector: "#title", key: "Enter" },
      { action: "reload" },
    ]),
  ).toHaveLength(3);
});

it("rejects unbounded, incomplete, and script-like browser actions", () => {
  expect(() =>
    validateBrowserSteps(Array(13).fill({ action: "reload" })),
  ).toThrow("at most twelve");
  expect(() =>
    validateBrowserSteps([{ action: "fill", selector: "#title" }]),
  ).toThrow("Incomplete");
  expect(() =>
    validateBrowserSteps([{ action: "press", key: "Control+O" }]),
  ).toThrow("Invalid browser key");
  expect(() =>
    validateBrowserSteps([{ action: "evaluate", value: "alert(1)" }]),
  ).toThrow("Invalid browser action");
  expect(() =>
    validateBrowserSteps([{ action: "click", selector: "x".repeat(201) }]),
  ).toThrow("Invalid browser selector");
  expect(() =>
    validateBrowserSteps([
      { action: "press", key: "Enter", script: "alert(1)" },
    ]),
  ).toThrow("Invalid browser action field");
});

it("bounds a stalled browser operation", async () => {
  await expect(
    boundedBrowserWork(new Promise<never>(() => {}), 5),
  ).rejects.toThrow("Browser check timed out");
});

it("stops a pending browser operation when the user stops the turn", async () => {
  const controller = new AbortController();
  const pending = boundedBrowserWork(
    new Promise<never>(() => {}),
    100,
    controller.signal,
  );
  controller.abort();
  await expect(pending).rejects.toThrow("Browser check stopped");
});
