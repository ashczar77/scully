import type { CharacterId } from "./character-catalog";

export type SpecialistConsultation = {
  id: string;
  specialistId: CharacterId;
  phase: "planning" | "building" | "verification";
  purpose: string;
  planRevision: string;
  artifactRevision?: string;
  contextRevision: string;
  status: "consulting" | "answered" | "failed";
  advice: string;
  questions: string[];
  at: string;
  requestStartedAt?: string;
};

export type ConsultationReview = {
  token: string;
  runId: string;
  specialistId: CharacterId;
  phase: "planning" | "building" | "verification";
  context: string;
  contextRevision: string;
  planRevision: string;
  artifactRevision?: string;
  expiresAt: number;
  model: string;
  outputTokens: number;
  projectedNanoUsd: number | null;
  rateStatus: "verified" | "user_estimate" | "stale" | "unknown";
};

export function parseConsultationResult(value: unknown): {
  advice: string;
  questions: string[];
} {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid specialist response");
  const row = value as Record<string, unknown>;
  if (
    typeof row.advice !== "string" ||
    !row.advice.trim() ||
    row.advice.length > 8000 ||
    /[\x00-\x08\x0b-\x1f\x7f]/.test(row.advice) ||
    !Array.isArray(row.questions) ||
    row.questions.length > 3 ||
    row.questions.some(
      (question) =>
        typeof question !== "string" ||
        !question.trim() ||
        question.length > 500 ||
        /[\x00-\x08\x0b-\x1f\x7f]/.test(question),
    )
  )
    throw new Error("Invalid specialist response");
  return {
    advice: row.advice.trim(),
    questions: row.questions.map((question: string) => question.trim()),
  };
}
