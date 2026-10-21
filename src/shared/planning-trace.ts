import type { PlanningState } from "./planning-state";
import type { RequestDiagnostic } from "./request-diagnostics";

export type PlanningTraceCode =
  | "initial_turn"
  | "linked_answers"
  | "route_project"
  | "route_conversation"
  | "route_invalid"
  | "route_request_failed"
  | "structured_action"
  | "invalid_action"
  | "format_fallback"
  | "consultation"
  | "review_accepted"
  | "review_rejected"
  | "reply_invalid"
  | "reply_request_failed"
  | "reply"
  | "questions_presented"
  | "plan_submitted"
  | "staffing_proposed";

export type PlanningTraceEvent = {
  version: 1;
  at: string;
  code: PlanningTraceCode;
  pendingQuestions: number;
  answeredQuestions: number;
  planApproved: boolean;
  requestOutcome: RequestDiagnostic["outcome"] | null;
};

export function appendPlanningTrace(
  trace: PlanningTraceEvent[] | undefined,
  code: PlanningTraceCode,
  state: PlanningState,
  at = new Date().toISOString(),
  requestOutcome: RequestDiagnostic["outcome"] | null = null,
): PlanningTraceEvent[] {
  const event: PlanningTraceEvent = {
    version: 1,
    at,
    code,
    pendingQuestions: state.questions.filter(
      (item) => item.status === "pending",
    ).length,
    answeredQuestions: state.questions.filter(
      (item) => item.status === "answered",
    ).length,
    planApproved: !!state.planReview?.approvedAt,
    requestOutcome,
  };
  return [...(trace || []).slice(-31), event];
}
