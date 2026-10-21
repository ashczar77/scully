// @vitest-environment node
import { expect, it } from "vitest";
import { updateWorkState } from "../src/main/pearl-work-state";
import type { PearlChat } from "../src/shared/pearl-chat";
const chat = (): PearlChat => ({
  id: "chat",
  title: "Plan",
  createdAt: "now",
  updatedAt: "now",
  status: "running",
  activeUserMessageId: "user-2",
  questions: [],
  messages: [
    {
      id: "user-1",
      role: "user",
      text: "Keep keyboard support and persistence.",
      at: "now",
    },
    {
      id: "assistant-1",
      role: "assistant",
      text: "I recommend a hosted database.",
      at: "now",
    },
    {
      id: "user-2",
      role: "user",
      text: "Use a local server. No hosted database.",
      at: "now",
    },
  ],
});
const input = {
  expectedRevision: 0,
  objective: "Build a shared app",
  approach: "Use a local server",
  requirements: [
    "Keep keyboard support and persistence.",
    "No hosted database.",
  ],
  steps: [
    { text: "Implement persistence", status: "in_progress" },
    { text: "Verify keyboard use", status: "pending" },
  ],
};
it("keeps user quote provenance separate from the proposed approach", () => {
  const value = chat();
  value.work = updateWorkState(value, input);
  expect(value.work.requirements.map((r) => r.sourceUserMessageId)).toEqual([
    "user-1",
    "user-2",
  ]);
  expect(value.work.sourceUserMessageId).toBe("user-2");
  expect(value.work.revision).toBe(1);
  expect(value.project).toBeUndefined();
  expect(value.questions).toEqual([]);
});
it("refuses to promote a model recommendation or invented text into a user requirement", () => {
  for (const quote of [
    "I recommend a hosted database.",
    "The user approved a database.",
  ])
    expect(() =>
      updateWorkState(chat(), { ...input, requirements: [quote] }),
    ).toThrow("verbatim");
});
it("rejects stale updates and invalid or unbounded state", () => {
  const value = chat();
  value.work = updateWorkState(value, input);
  expect(() => updateWorkState(value, input)).toThrow("changed");
  expect(() => updateWorkState(chat(), { ...input, steps: [] })).toThrow();
  expect(() =>
    updateWorkState(chat(), { ...input, objective: "x".repeat(1501) }),
  ).toThrow();
  expect(() =>
    updateWorkState(chat(), {
      ...input,
      steps: [{ text: "one", status: "approved" }],
    }),
  ).toThrow();
});

it("reports the actual revision so stale clients can correct an update", () => {
  const value = chat();
  expect(() =>
    updateWorkState(value, { ...input, expectedRevision: 1 }),
  ).toThrow("current revision is 0");
  value.work = updateWorkState(value, input);
  expect(() => updateWorkState(value, input)).toThrow("current revision is 1");
});

it("updates only changed plan fields while preserving user provenance", () => {
  const value = chat();
  value.work = updateWorkState(value, input);
  const previous = value.work;
  const updated = updateWorkState(value, {
    expectedRevision: 1,
    steps: previous.steps.map((step) => ({ ...step, status: "completed" })),
  });
  expect(updated.requirements).toEqual(previous.requirements);
  expect(updated.objective).toBe(previous.objective);
  expect(updated.approach).toBe(previous.approach);
  expect(updated.steps.every((step) => step.status === "completed")).toBe(true);
  expect(updated.revision).toBe(2);
  expect(() =>
    updateWorkState(chat(), { expectedRevision: 0, steps: input.steps }),
  ).toThrow();
  expect(() =>
    updateWorkState(value, {
      expectedRevision: 1,
      requirements: ["The model approved deployment."],
    }),
  ).toThrow("verbatim");
});
