import { characterById } from "./character-catalog";

// Only our protocol validators create this error. Its message contains a
// fixed validation reason, never submitted conversation or project content.
export class PlanningStateError extends Error {}

export type PlanningQuestion = {
  id: string;
  text: string;
  recommendation: string;
  options?: string[];
  status: "pending" | "answered" | "withdrawn" | "superseded";
  askedAt: string;
  answer?: string;
  resolvedAt?: string;
  supersededAt?: string;
};

export type PlanningQuestionAnswer = {
  questionId: string;
  askedAt: string;
  optionIndex?: number;
  customAnswer?: string;
  note?: string;
};

export type PlanningQuestionAnswerSet = {
  answers: PlanningQuestionAnswer[];
  note?: string;
};

export type PlanningConsultation = {
  id: string;
  memberId: string;
  question: string;
  advice: string;
  at: string;
};

export type WorkAssignment = {
  memberId: string;
  role: "builder" | "tester" | "auditor" | "specialist";
  objective: string;
  evidence: string;
  permissions: import("./collaboration").CollaborationPermission[];
  dependsOn: string[];
  environment: {
    tools: string[];
    reason: string;
    checks: { command: string; args: string[]; purpose: string }[];
  };
};

export type StaffingProposal = {
  planRevision: string;
  assignments: WorkAssignment[];
  rationale: string;
};

export type PlanningState = {
  version: 1 | 2;
  questions: PlanningQuestion[];
  consultations: PlanningConsultation[];
  planReview?: { revision: string; approvedAt?: string };
  proposal?: StaffingProposal;
  approved?: {
    planRevision: string;
    assignments: WorkAssignment[];
    approvedAt: string;
  };
};

export function initialPlanningState(): PlanningState {
  return { version: 2, questions: [], consultations: [] };
}

export function submitPlanForReview(
  state: PlanningState,
  revision: string,
): PlanningState {
  if (pendingPlanningQuestions(state).length || !revision)
    throw new PlanningStateError(
      "Resolve open questions before reviewing the plan",
    );
  const next = structuredClone(state);
  next.planReview = { revision };
  next.proposal = undefined;
  next.approved = undefined;
  return next;
}

export function approvePlan(
  state: PlanningState,
  revision: string,
  now: () => Date = () => new Date(),
): PlanningState {
  if (
    state.version !== 2 ||
    !state.planReview ||
    state.planReview.revision !== revision ||
    pendingPlanningQuestions(state).length
  )
    throw new PlanningStateError("Review the current plan before approving it");
  const next = structuredClone(state);
  next.planReview!.approvedAt = now().toISOString();
  return next;
}

export function pendingPlanningQuestions(
  state: PlanningState,
): PlanningQuestion[] {
  return state.questions.filter((question) => question.status === "pending");
}

function shortText(value: unknown, label: string, max = 600): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x08\x0b-\x1f\x7f]/.test(value)
  )
    throw new PlanningStateError(`Invalid ${label}`);
  return value.trim();
}

export function recordPlanningTurn(
  state: PlanningState,
  input: {
    resolvedQuestionIds?: unknown;
    resolvedAnswers?: { questionId: string; answer: string }[];
    withdrawnQuestionIds?: unknown;
    supersededQuestionIds?: unknown;
    questions?: unknown;
    answer?: string;
  },
  now: () => Date = () => new Date(),
): PlanningState {
  const next = structuredClone(state);
  const resolved = input.resolvedQuestionIds ?? [];
  const resolvedAnswers = input.resolvedAnswers ?? [];
  const withdrawn = input.withdrawnQuestionIds ?? [];
  const superseded = input.supersededQuestionIds ?? [];
  const asked = input.questions ?? [];
  if (
    !Array.isArray(resolved) ||
    !Array.isArray(resolvedAnswers) ||
    !Array.isArray(withdrawn) ||
    !Array.isArray(superseded) ||
    !Array.isArray(asked) ||
    asked.length > 2
  )
    throw new PlanningStateError("Invalid planning question update");
  if (
    new Set([
      ...resolved,
      ...resolvedAnswers.map((item) => item.questionId),
      ...withdrawn,
      ...superseded,
    ]).size !==
    resolved.length +
      resolvedAnswers.length +
      withdrawn.length +
      superseded.length
  )
    throw new PlanningStateError("Duplicate question resolution");
  for (const id of [
    ...resolved,
    ...resolvedAnswers.map((item) => item.questionId),
  ]) {
    const question = next.questions.find((item) => item.id === id);
    const answer =
      resolvedAnswers.find((item) => item.questionId === id)?.answer ||
      input.answer;
    if (!question || question.status !== "pending" || !answer?.trim())
      throw new PlanningStateError(
        "Planning question resolution lacks a current user answer",
      );
    question.status = "answered";
    question.answer = answer;
    question.resolvedAt = now().toISOString();
  }
  for (const id of withdrawn) {
    const question = next.questions.find((item) => item.id === id);
    if (!question || question.status !== "pending")
      throw new PlanningStateError("Planning question is no longer pending");
    question.status = "withdrawn";
    question.resolvedAt = now().toISOString();
  }
  for (const id of superseded) {
    const question = next.questions.find((item) => item.id === id);
    if (!question || question.status !== "answered")
      throw new PlanningStateError(
        "Only an answered question can be superseded",
      );
    question.status = "superseded";
    question.supersededAt = now().toISOString();
  }
  if (pendingPlanningQuestions(next).length && asked.length)
    throw new PlanningStateError(
      "Resolve or keep the earlier pending questions before asking new ones",
    );
  for (const entry of asked) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new PlanningStateError("Invalid planning question");
    const value = entry as Record<string, unknown>;
    const text = shortText(value.text, "planning question");
    const recommendation = shortText(value.recommendation, "recommendation");
    const options = value.options;
    if (
      options !== undefined &&
      (!Array.isArray(options) || options.length < 2 || options.length > 5)
    )
      throw new PlanningStateError("Invalid planning options");
    next.questions.push({
      id: globalThis.crypto.randomUUID(),
      text,
      recommendation,
      ...(options !== undefined && {
        options: options.map((option) =>
          shortText(option, "planning option", 300),
        ),
      }),
      status: "pending",
      askedAt: now().toISOString(),
    });
  }
  if (pendingPlanningQuestions(next).length > 2)
    throw new PlanningStateError("Ask at most two related questions at once");
  next.proposal = undefined;
  next.approved = undefined;
  next.planReview = undefined;
  return next;
}

export function parseWorkAssignments(
  value: unknown,
  candidateIds: readonly string[],
): WorkAssignment[] {
  if (!Array.isArray(value) || !value.length || value.length > 32)
    throw new PlanningStateError("Propose a practical set of work assignments");
  const seen = new Set<string>();
  const assignments = value.map((entry): WorkAssignment => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new PlanningStateError("Invalid work assignment");
    const item = entry as Record<string, unknown>;
    const memberId = shortText(item.memberId, "teammate ID", 100);
    const profile = characterById(memberId);
    if (!profile || !candidateIds.includes(memberId) || seen.has(memberId))
      throw new PlanningStateError(
        "Assignment must name a unique available teammate",
      );
    if (profile.role === "coordinator" || item.role !== profile.role)
      throw new PlanningStateError(
        "Assignment role does not match the teammate",
      );
    seen.add(memberId);
    if (
      !Array.isArray(item.dependsOn) ||
      item.dependsOn.some((v) => typeof v !== "string")
    )
      throw new PlanningStateError("Invalid assignment dependencies");
    if (
      !Array.isArray(item.permissions) ||
      !item.permissions.includes("read") ||
      item.permissions.some(
        (permission) =>
          !["read", "edit", "check", "audit"].includes(permission),
      ) ||
      new Set(item.permissions).size !== item.permissions.length ||
      (profile.role === "auditor" && item.permissions.includes("edit"))
    )
      throw new PlanningStateError("Invalid assignment permissions");
    const env = item.environment;
    if (!env || typeof env !== "object" || Array.isArray(env))
      throw new PlanningStateError("Describe the work environment");
    const environment = env as Record<string, unknown>;
    if (
      !Array.isArray(environment.tools) ||
      environment.tools.length > 12 ||
      environment.tools.some(
        (tool) => typeof tool !== "string" || !tool.trim() || tool.length > 80,
      )
    )
      throw new PlanningStateError("Invalid environment tools");
    if (!Array.isArray(environment.checks) || environment.checks.length > 12)
      throw new PlanningStateError("Invalid assignment checks");
    const tools = environment.tools as string[];
    const checks = environment.checks.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new PlanningStateError("Invalid assignment check");
      const row = value as Record<string, unknown>;
      const command = shortText(row.command, "check command", 80);
      if (
        !tools.includes(command) ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,79}$/.test(command) ||
        !Array.isArray(row.args) ||
        row.args.length > 32 ||
        row.args.some(
          (arg) =>
            typeof arg !== "string" ||
            arg.length > 300 ||
            /[\x00-\x1f\x7f]/.test(arg),
        )
      )
        throw new PlanningStateError(
          "Check must use a required executable and bounded arguments",
        );
      return {
        command,
        args: row.args as string[],
        purpose: shortText(row.purpose, "check purpose", 300),
      };
    });
    return {
      memberId,
      role: profile.role,
      objective: shortText(item.objective, "assignment objective", 1000),
      evidence: shortText(item.evidence, "assignment evidence", 1000),
      permissions: item.permissions,
      dependsOn: item.dependsOn,
      environment: {
        tools,
        reason: shortText(environment.reason, "environment reason", 600),
        checks,
      },
    };
  });
  for (const assignment of assignments)
    if (
      assignment.dependsOn.some(
        (id) => id === assignment.memberId || !seen.has(id),
      )
    )
      throw new PlanningStateError(
        "Assignment dependency is unavailable or circular",
      );
  const byId = new Map(assignments.map((item) => [item.memberId, item]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id))
      throw new PlanningStateError("Assignment dependency is circular");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)!.dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const assignment of assignments) visit(assignment.memberId);
  if (
    !assignments.some((item) => item.role === "builder") ||
    !assignments.some((item) => item.role === "auditor")
  )
    throw new PlanningStateError(
      "A build proposal needs a builder and independent auditor",
    );
  return assignments;
}

export function proposeStaffing(
  state: PlanningState,
  value: unknown,
  candidateIds: readonly string[],
  planRevision: string,
): PlanningState {
  if (pendingPlanningQuestions(state).length)
    throw new PlanningStateError(
      "Resolve planning questions before proposing the team",
    );
  if (
    state.version === 2 &&
    (state.planReview?.revision !== planRevision ||
      !state.planReview.approvedAt)
  )
    throw new PlanningStateError(
      "Approve the current plan before proposing the team",
    );
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PlanningStateError("Missing staffing proposal");
  const item = value as Record<string, unknown>;
  const next = structuredClone(state);
  next.proposal = {
    planRevision,
    assignments: parseWorkAssignments(item.assignments, candidateIds),
    rationale: shortText(item.rationale, "staffing rationale", 1200),
  };
  return next;
}

export function approveStaffing(
  state: PlanningState,
  revision: string,
  assignments: unknown,
  candidateIds: readonly string[],
  now: () => Date = () => new Date(),
): PlanningState {
  if (
    !state.proposal ||
    state.proposal.planRevision !== revision ||
    (state.version === 2 &&
      (state.planReview?.revision !== revision ||
        !state.planReview.approvedAt)) ||
    pendingPlanningQuestions(state).length
  )
    throw new PlanningStateError(
      "Review the current plan and resolve its questions first",
    );
  const selected = parseWorkAssignments(assignments, candidateIds);
  const next = structuredClone(state);
  next.approved = {
    planRevision: revision,
    assignments: selected,
    approvedAt: now().toISOString(),
  };
  return next;
}
