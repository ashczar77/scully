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
  } as Run;
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
