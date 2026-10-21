import { expect, it } from "vitest";
import { boundedClipboardText } from "../src/main/clipboard-text";

it("copies bounded text without changing its Markdown", () => {
  expect(boundedClipboardText("## Plan\nBuild it.")).toBe("## Plan\nBuild it.");
});

it("rejects malformed or excessive renderer clipboard input", () => {
  expect(() => boundedClipboardText({ text: "secret" })).toThrow();
  expect(() => boundedClipboardText("x".repeat(200_001))).toThrow();
});
