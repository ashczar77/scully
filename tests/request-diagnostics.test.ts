import { expect, it } from "vitest";
import { sanitizeRequestDiagnostic } from "../src/shared/request-diagnostics";

const diagnostic = {
  version: 1,
  at: "2026-10-15T00:00:00.000Z",
  stage: "plan_result",
  model: "nvidia/Nemotron-3_5-Lightning",
  maxOutputTokens: 2048,
  durationMs: 1023,
  httpStatus: 200,
  finishReason: "length",
  choiceCount: 1,
  toolCallCount: 0,
  usage: { inputTokens: 1213, outputTokens: 2048 },
  outcome: "incomplete",
} as const;

it("keeps only allowlisted request metadata even if a worker adds private content", () => {
  const sanitized = sanitizeRequestDiagnostic({
    ...diagnostic,
    prompt: "private prompt",
    usage: { ...diagnostic.usage, response: "private response" },
  });
  expect(sanitized).toEqual(diagnostic);
  expect(JSON.stringify(sanitized)).not.toContain("private");
});

it("rejects unsafe or invalid diagnostic dimensions", () => {
  expect(
    sanitizeRequestDiagnostic({
      ...diagnostic,
      model: "/Users/example/private-key",
    }),
  ).toBeNull();
  expect(
    sanitizeRequestDiagnostic({
      ...diagnostic,
      stage: "plan response content",
    }),
  ).toBeNull();
  expect(
    sanitizeRequestDiagnostic({ ...diagnostic, httpStatus: 900 }),
  ).toBeNull();
});
