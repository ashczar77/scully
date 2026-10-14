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
  approvedAt: string;
};

export type AdviceReview = {
  token: string;
  runId: string;
  consultationId: string;
  planRevision: string;
  adviceRevision: string;
  handoff: string;
  inputBytes: number;
  writerRequests: number;
  expiresAt: number;
};

export function adviceForHandoff(
  run: Run,
  task: Pick<Task, "title" | "description">,
  consultationId: string,
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
      item.id === consultation?.specialistId && item.phase === "planning",
  );
  if (
    !consultation ||
    !selected ||
    consultation.status !== "answered" ||
    consultation.phase !== "planning" ||
    consultation.planRevision !== run.lineupProposal.planRevision ||
    consultation.purpose !== selected.purpose
  )
    throw new Error("Choose answered advice from the approved planning lineup");
  const response = parseConsultationResult(consultation);
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
  };
  return { consultation, adviceRevision, handoff };
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
    const { consultation, adviceRevision, handoff } = adviceForHandoff(
      run,
      task,
      approval.consultationId,
    );
    if (
      approval.specialistId !== consultation.specialistId ||
      approval.planRevision !== consultation.planRevision ||
      approval.adviceRevision !== adviceRevision
    )
      throw new Error("Specialist advice changed. Review the handoff again");
    return handoff;
  });
}
