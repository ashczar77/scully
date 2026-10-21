import { expect, it } from "vitest";
import { appendPlanningTrace } from "../src/shared/planning-trace";
import { initialPlanningState } from "../src/shared/planning-state";

it("bounds a local planning trace and excludes question and answer content", () => {
  const state = initialPlanningState();
  state.questions.push({
    id: "private-question-id",
    text: "private question text",
    recommendation: "private recommendation",
    status: "answered",
    askedAt: "2026-10-20T00:00:00.000Z",
    answer: "private user answer",
  });
  let trace = appendPlanningTrace(
    undefined,
    "initial_turn",
    state,
    "2026-10-20T00:00:00.000Z",
  );
  for (let index = 0; index < 40; index++)
    trace = appendPlanningTrace(
      trace,
      "reply",
      state,
      "2026-10-20T00:00:00.000Z",
    );

  expect(trace).toHaveLength(32);
  expect(trace.at(-1)).toEqual({
    version: 1,
    at: "2026-10-20T00:00:00.000Z",
    code: "reply",
    pendingQuestions: 0,
    answeredQuestions: 1,
    planApproved: false,
    requestOutcome: null,
  });
  expect(JSON.stringify(trace)).not.toMatch(
    /private question|private recommendation|private user answer|private-question-id/,
  );
});
