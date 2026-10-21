import { expect, it } from "vitest";
import { conversationTimeline } from "../src/renderer/conversation-timeline";
import type { Task } from "../src/shared/contracts";
import type { Run } from "../src/shared/runs";

it("keeps a prior Pearl plan between the request and its later correction", () => {
  const task = {
    id: "task",
    title: "List",
    description: "Build a list",
    createdAt: "2026-10-15T00:00:00.000Z",
    mode: "plan",
  } as Task;
  const parent = {
    id: "one",
    events: [
      { actor: "pearl", text: "Plan one", at: "2026-10-15T00:01:00.000Z" },
    ],
    plan: "Plan one",
    messages: [
      {
        id: "m1",
        text: "Build a list",
        at: task.createdAt,
        intent: "continue",
      },
      {
        id: "m2",
        text: "Use React",
        at: "2026-10-15T00:02:00.000Z",
        intent: "replan",
      },
    ],
  } as unknown as Run;
  const child = {
    id: "two",
    events: [],
    plan: "",
    redirection: { parentId: "one" },
    messages: [],
  } as unknown as Run;
  expect(
    conversationTimeline([child, parent], task).map((entry) =>
      entry.kind === "user"
        ? entry.text
        : entry.kind === "plan"
          ? entry.plan
          : "other",
    ),
  ).toEqual(["Build a list", "Plan one", "Use React"]);
});

it("shows a conversational Pearl reply even when no plan exists yet", () => {
  const task = {
    id: "task",
    title: "List",
    description: "Build a list",
    createdAt: "2026-10-15T00:00:00.000Z",
    mode: "plan",
  } as Task;
  const run = {
    id: "one",
    plan: "",
    planReply: "SQLite is another option.",
    events: [
      {
        actor: "pearl",
        text: "SQLite is another option.",
        at: "2026-10-15T00:01:00.000Z",
      },
    ],
  } as unknown as Run;
  const entries = conversationTimeline([run], task);
  expect(entries.filter((entry) => entry.kind === "plan")).toHaveLength(1);
  expect(entries.some((entry) => entry.kind === "progress")).toBe(false);
  expect(entries.filter((entry) => entry.kind === "plan")[0].reply).toBe(
    "SQLite is another option.",
  );
});

it("shows a planning question only where Pearl first asked it", () => {
  const task = {
    id: "task",
    title: "List",
    description: "Build a list",
    createdAt: "2026-10-15T00:00:00.000Z",
    mode: "plan",
  } as Task;
  const question = {
    id: "storage",
    text: "Where should books be stored?",
    recommendation: "Local JSON",
    options: ["Local JSON", "SQLite"],
    status: "pending" as const,
    askedAt: "2026-10-15T00:01:00.000Z",
  };
  const first = {
    id: "first",
    plan: "",
    planReply: "Let's choose storage.",
    events: [],
    planning: { version: 1, questions: [question], consultations: [] },
  } as unknown as Run;
  const second = {
    id: "second",
    plan: "",
    planReply: "Pineapples are interesting.",
    events: [],
    redirection: { parentId: "first" },
    planning: { version: 1, questions: [question], consultations: [] },
  } as unknown as Run;
  const plans = conversationTimeline([second, first], task).filter(
    (entry) => entry.kind === "plan",
  );
  expect(plans[0].questionItems).toHaveLength(1);
  expect(plans[1].questionItems).toHaveLength(0);
});
