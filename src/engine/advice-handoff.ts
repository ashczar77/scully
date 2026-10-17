import { createHash } from "node:crypto";
import type { Run } from "../shared/runs";
import type { Task } from "../shared/contracts";
import { parseSpecialistLineup } from "../shared/lineup-proposal";
import { parseConsultationResult } from "../shared/consultation";
import { lineupPlanRevision } from "./revision";

export type AdviceApproval = {
  consultationId: string;
  specialistId: string;
  planRevision: string;
  adviceRevision: string;
  answers?: string[];
  handoffRevision?: string;
  approvedAt: string;
};

export type AdviceReview = {
  token: string;
  runId: string;
  consultationId: string;
  planRevision: string;
  adviceRevision: string;
  answers: string[];
  handoffRevision: string;
  handoff: string;
  inputBytes: number;
  writerRequests: number;
  expiresAt: number;
};

export function adviceForHandoff(
  run: Run,
  task: Pick<Task, "title" | "description">,
  consultationId: string,
  answers?: unknown,
) {
  if (
    !run.lineupProposal ||
    !run.approvedLineup ||
    run.lineupProposal.planRevision !== lineupPlanRevision(run, task) ||
    run.approvedLineup.planRevision !== run.lineupProposal.planRevision
  )
    throw new Error("Plan or specialist lineup changed. Review it again");
  const consultation = run.consultations?.find(
    (item) => item.id === consultationId,
  );
  const selected = parseSpecialistLineup(run.approvedLineup.entries).find(
    (item) =>
      item.id === consultation?.specialistId &&
      item.phase === consultation?.phase &&
      (item.phase === "planning" || item.phase === "building"),
  );
  if (
    !consultation ||
    !selected ||
    consultation.status !== "answered" ||
    (consultation.phase !== "planning" && consultation.phase !== "building") ||
    consultation.planRevision !== run.lineupProposal.planRevision ||
    consultation.purpose !== selected.purpose
  )
    throw new Error(
      "Choose answered advice from the approved pre-build lineup",
    );
  const response = parseConsultationResult(consultation);
  let questionAnswers: string[] | undefined;
  if (answers !== undefined) {
    if (
      !Array.isArray(answers) ||
      answers.length !== response.questions.length ||
      answers.some(
        (answer) =>
          typeof answer !== "string" ||
          answer.length > 1000 ||
          /[\x00-\x08\x0b-\x1f\x7f]/.test(answer),
      )
    )
      throw new Error("Invalid answers to specialist questions");
    questionAnswers = answers.map((answer: string) => answer.trim());
  }
  const adviceRevision = createHash("sha256")
    .update(
      JSON.stringify({
        id: consultation.id,
        specialistId: consultation.specialistId,
        planRevision: consultation.planRevision,
        contextRevision: consultation.contextRevision,
        purpose: consultation.purpose,
        advice: response.advice,
        questions: response.questions,
      }),
    )
    .digest("hex");
  const handoff = {
    specialistId: consultation.specialistId,
    purpose: consultation.purpose,
    advice: response.advice,
    questions: response.questions,
    ...(questionAnswers
      ? {
          questionDecisions: response.questions.map((question, index) => ({
            question,
            answer: questionAnswers[index] || null,
          })),
        }
      : {}),
  };
  const handoffRevision = createHash("sha256")
    .update(JSON.stringify(handoff))
    .digest("hex");
  return {
    consultation,
    adviceRevision,
    handoff,
    handoffRevision,
    questionAnswers,
  };
}

export function approvedAdviceForBuild(
  run: Run,
  task: Pick<Task, "title" | "description">,
) {
  const approvals = run.approvedAdvice || [];
  if (!Array.isArray(approvals) || approvals.length > 3)
    throw new Error("Invalid specialist handoff selection");
  const seen = new Set<string>();
  return approvals.map((approval) => {
    if (
      !approval ||
      typeof approval.consultationId !== "string" ||
      seen.has(approval.consultationId)
    )
      throw new Error("Invalid specialist handoff selection");
    seen.add(approval.consultationId);
    const { consultation, adviceRevision, handoff, handoffRevision } =
      adviceForHandoff(run, task, approval.consultationId, approval.answers);
    if (
      approval.specialistId !== consultation.specialistId ||
      approval.planRevision !== consultation.planRevision ||
      approval.adviceRevision !== adviceRevision ||
      (approval.answers !== undefined &&
        approval.handoffRevision !== handoffRevision) ||
      (approval.answers === undefined && approval.handoffRevision !== undefined)
    )
      throw new Error("Specialist advice changed. Review the handoff again");
    return handoff;
  });
}
