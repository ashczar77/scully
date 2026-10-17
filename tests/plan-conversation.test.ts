import { expect, it } from "vitest";
import {
  planQuestions,
  planSummary,
  planningTurnContext,
  samePlanText,
  visiblePlan,
  repeatsAnsweredQuestion,
  echoesConsultationQuestion,
  userAuthorizedSpecialistConsultation,
  asksForResolvedChoices,
  roomQuestion,
  cleanPlanningText,
  coordinatorReply,
} from "../src/shared/plan-conversation";

it("uses a complete conversational summary rather than cutting an overview", () => {
  expect(
    planSummary(
      "## Overview\nBuild a local reading list with saved books. Tests should cover keyboard navigation.",
    ),
  ).toBe("I'd build a local reading list with saved books.");
  expect(
    planSummary(
      "## Conversation Summary\nI'll keep the reading list on this computer and check keyboard access.\n\n## Overview\nMore detail.",
    ),
  ).toBe(
    "I'll keep the reading list on this computer and check keyboard access.",
  );
  expect(
    planSummary("## Conversation Summary\nThe user wants to add accounts."),
  ).toBe("You'd like to add accounts.");
});

it("finds unresolved choices without treating a resolved plan as blocked", () => {
  expect(
    planQuestions(
      "## User Decisions Required\n1. Which framework?\n2. Which theme?",
    ),
  ).toEqual(["Which framework?", "Which theme?"]);
  expect(planQuestions("## User Decisions Required\n- None.")).toEqual([]);
  expect(
    planQuestions(
      "## User Decisions Required\n1. Storage: localStorage (chosen).\n2. Which framework have you chosen?",
    ),
  ).toEqual(["Which framework have you chosen?"]);
});

it("phrases a draft choice as a direct Room question", () => {
  expect(
    roomQuestion(
      'Default book display – Show "Read" badge vs. gray out unread titles? (Default: badge)',
    ),
  ).toBe(
    'For default book display, which would you prefer: Show "Read" badge vs. gray out unread titles? (Default: badge)',
  );
  expect(roomQuestion("Storage – Which browser store should we use?")).toBe(
    "Which browser store should we use?",
  );
});

it("spots a question repeated after a numbered answer", () => {
  const before =
    "## User Decisions Required\n1. Which storage?\n2. Which tests?";
  const after = "## User Decisions Required\n1. Which tests?";
  expect(repeatsAnsweredQuestion(after, before, "1. localStorage")).toBe(false);
  expect(repeatsAnsweredQuestion(before, before, "1. localStorage")).toBe(true);
  expect(repeatsAnsweredQuestion(before, before, "Use localStorage")).toBe(
    false,
  );
  expect(
    repeatsAnsweredQuestion(
      "## User Decisions Required\n1. Which framework?",
      "## User Decisions Required\n1. Which framework?",
      "React works for me",
    ),
  ).toBe(true);
  expect(
    repeatsAnsweredQuestion(
      "## User Decisions Required\n1. Which framework?",
      "## User Decisions Required\n1. Which framework?",
      "Why would we use React?",
    ),
  ).toBe(false);
});

it("keeps only visible model text and keeps Pearl in the coordinator role", () => {
  expect(cleanPlanningText("hidden reasoning</think>React makes sense.")).toBe(
    "React makes sense.",
  );
  expect(cleanPlanningText("<think>hidden</think>Use React.")).toBe(
    "Use React.",
  );
  const handoff = coordinatorReply(
    "I'll now proceed with the Building phase. Let me know before I start coding.",
    true,
  );
  expect(handoff).toMatch(/hand .* to the team/);
  expect(handoff).not.toMatch(/start coding|Building phase/);
  expect(coordinatorReply("Maya can take the implementation.", true)).toBe(
    "Maya can take the implementation.",
  );
});

it("passes actual Pearl and user turns to planning even without numbered replies", () => {
  expect(
    planningTurnContext({
      redirection: {
        parentId: "parent",
        instructions: ["React works for me"],
        previousPlan: "## User Decisions Required\n1. Which framework?",
        previousDrafts: [],
        conversation: [
          { from: "user", text: "Build a reading list" },
          { from: "Pearl", text: "Which framework would you like?" },
          { from: "user", text: "React works for me" },
        ],
      },
    }).conversation,
  ).toEqual([
    { from: "user", text: "Build a reading list" },
    { from: "Pearl", text: "Which framework would you like?" },
    { from: "user", text: "React works for me" },
  ]);
});

it("rejects a draft that asks for choices it labels as already chosen", () => {
  expect(
    asksForResolvedChoices(
      "## Conversation Summary\nBefore I finalise, could you help me with these choices?\n\n## User Decisions Required\n1. Storage: localStorage (chosen).",
    ),
  ).toBe(true);
  expect(
    asksForResolvedChoices(
      "## Conversation Summary\nI'll use localStorage.\n\n## Confirmed Choices\nStorage: localStorage.",
    ),
  ).toBe(false);
});

it("rejects a teammate response that only repeats Pearl's assignment", () => {
  const question = "Review the planned keyboard navigation and ARIA labels.";
  expect(echoesConsultationQuestion(question, question)).toBe(true);
  expect(
    echoesConsultationQuestion(
      "Use native buttons and check focus order.",
      question,
    ),
  ).toBe(false);
});

it("requires an explicit user direction or reply to Pearl's named request for a specialist", () => {
  expect(
    userAuthorizedSpecialistConsultation(
      "yes",
      "May I ask Nadine about keyboard access?",
      "Nadine",
    ),
  ).toBe(true);
  expect(
    userAuthorizedSpecialistConsultation(
      "yes",
      "Which storage do you prefer?",
      "Nadine",
    ),
  ).toBe(false);
  expect(
    userAuthorizedSpecialistConsultation(
      "ask Nadine to review focus order",
      "",
      "Nadine",
    ),
  ).toBe(true);
});

it("passes revised user answers as a conversation instead of an empty revision", () => {
  expect(
    planningTurnContext({
      redirection: {
        parentId: "parent",
        instructions: ["1. React\n2. default", "Shall we continue?"],
        previousPlan:
          "## User Decisions Required\n1. Which framework?\n2. Which storage key?",
        previousDrafts: [],
      },
    }),
  ).toEqual({
    conversation: [
      { from: "user", text: "1. React\n2. default" },
      { from: "user", text: "Shall we continue?" },
    ],
    latestUserMessage: "Shall we continue?",
    previousQuestions: ["Which framework?", "Which storage key?"],
    answeredChoices: [],
  });
});

it("pairs numbered answers with Pearl's latest questions for the next turn", () => {
  expect(
    planningTurnContext({
      redirection: {
        parentId: "first",
        instructions: ["1. React\n2. Keep existing books"],
        previousPlan:
          "## User Decisions Required\n1. Which framework?\n2. Keep or clear existing books?",
        previousDrafts: [],
      },
    }).answeredChoices,
  ).toEqual([
    { question: "Which framework?", answer: "React" },
    {
      question: "Keep or clear existing books?",
      answer: "Keep existing books",
    },
  ]);
});

it("hides team decisions from unfinished draft analysis", () => {
  const draft =
    "## Overview\nBuild a list.\n\n## Active Lineup\nMaya builds.\n\n## User Decisions Required\n1. Which framework?";
  expect(visiblePlan(draft, true)).toContain("Which framework?");
  expect(visiblePlan(draft, true)).not.toContain("Maya builds");
  expect(visiblePlan(draft, false)).toContain("Maya builds");
  expect(samePlanText("same\n plan", "same plan")).toBe(true);
});
