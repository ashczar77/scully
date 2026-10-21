import { expect, it } from "vitest";
import {
  cleanPlanningText,
  planQuestions,
  planSummary,
  planningTurnContext,
  roomQuestion,
  visiblePlan,
} from "../src/shared/plan-conversation";

it("preserves authored plan wording and Markdown without semantic substitution", () => {
  const plan =
    "## Conversation Summary\nThe user wants **accounts**.\n\n## Overview\nBuild accounts.";
  expect(planSummary(plan)).toBe("The user wants **accounts**.");
  expect(roomQuestion("Storage - local or remote? (suggested: local)")).toBe(
    "Storage - local or remote? (suggested: local)",
  );
  expect(
    cleanPlanningText("<think>hidden</think>**Use React.**\n\n- Keep books"),
  ).toBe("**Use React.**\n\n- Keep books");
});

it("extracts plan questions by document structure without guessing which choices were answered", () => {
  expect(
    planQuestions(
      "## User Decisions Required\n1. Which framework?\n- Keep or clear books?",
    ),
  ).toEqual(["Which framework?", "Keep or clear books?"]);
  expect(planQuestions("## Confirmed Choices\n- React")).toEqual([]);
});

it("passes unnumbered and changed decisions through the original conversation", () => {
  const context = planningTurnContext({
    redirection: {
      parentId: "old",
      instructions: ["React works", "Actually use Vue"],
      previousPlan: "## User Decisions Required\n- Which framework?",
      previousDrafts: [],
      conversation: [
        { from: "user", text: "React works" },
        { from: "user", text: "Actually use Vue" },
      ],
    },
  });
  expect(context.conversation).toEqual([
    { from: "user", text: "React works" },
    { from: "user", text: "Actually use Vue" },
  ]);
  expect(context.latestUserMessage).toBe("Actually use Vue");
  expect(context.previousQuestions).toEqual(["Which framework?"]);
  expect(context).not.toHaveProperty("answeredChoices");
});

it("keeps team details out of an unfinished draft without changing the finished artifact", () => {
  const plan =
    "## Overview\nBuild a list.\n\n## Active Lineup\nMaya builds.\n\n## User Decisions Required\n- Which framework?";
  expect(visiblePlan(plan, true)).not.toContain("Maya builds");
  expect(visiblePlan(plan, true)).toContain("Which framework?");
  expect(visiblePlan(plan, false)).toBe(plan);
});
