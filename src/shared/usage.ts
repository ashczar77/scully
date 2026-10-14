export const usageStages = [
  "propose_plan",
  "propose_files",
  "audit_chunk",
  "audit_files",
  "specialist_audit",
  "respond_to_audit",
  "answer_question",
  "consult_specialist",
] as const;

export type UsageStage = (typeof usageStages)[number];
export type ReportedUsage = { inputTokens: number; outputTokens: number };
export type UsageSnapshot = {
  requests: number;
  measured: number;
  unknown: number;
  pending: number;
  inputTokens: number;
  outputTokens: number;
  pendingMaxOutputTokens: number;
};
export type UsageStart = {
  id: string;
  stage: UsageStage;
  model: string;
  maxOutputTokens: number;
};
const requestId =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function validUsageStart(value: unknown): value is UsageStart {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    requestId.test(row.id) &&
    usageStages.includes(row.stage as UsageStage) &&
    typeof row.model === "string" &&
    row.model.length > 0 &&
    row.model.length <= 160 &&
    Number.isSafeInteger(row.maxOutputTokens) &&
    (row.maxOutputTokens as number) >= 1 &&
    (row.maxOutputTokens as number) <= 4096
  );
}

export function validUsageFinish(
  value: unknown,
): value is { id: string; usage: ReportedUsage | null } {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    requestId.test(row.id) &&
    (row.usage === null ||
      (typeof row.usage === "object" &&
        row.usage !== null &&
        Number.isSafeInteger((row.usage as ReportedUsage).inputTokens) &&
        (row.usage as ReportedUsage).inputTokens >= 0 &&
        Number.isSafeInteger((row.usage as ReportedUsage).outputTokens) &&
        (row.usage as ReportedUsage).outputTokens >= 0))
  );
}

export function reportedUsage(value: unknown): ReportedUsage | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const valid = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;
  if (!valid(row.prompt_tokens) || !valid(row.completion_tokens)) return null;
  return {
    inputTokens: row.prompt_tokens as number,
    outputTokens: row.completion_tokens as number,
  };
}
