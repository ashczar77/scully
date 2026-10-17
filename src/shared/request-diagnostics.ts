export type RequestDiagnostic = {
  version: 1;
  at: string;
  stage: string;
  model: string;
  maxOutputTokens: number;
  durationMs: number;
  httpStatus: number | null;
  finishReason:
    "tool_calls" | "stop" | "length" | "content_filter" | "other" | "missing";
  choiceCount: number | null;
  toolCallCount: number | null;
  usage: { inputTokens: number; outputTokens: number } | null;
  outcome:
    | "ok"
    | "http_error"
    | "network_error"
    | "empty_response"
    | "response_too_large"
    | "invalid_json"
    | "incomplete"
    | "invalid_arguments";
};

export function validRequestDiagnostic(
  value: unknown,
): value is RequestDiagnostic {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<RequestDiagnostic>;
  return (
    item.version === 1 &&
    typeof item.at === "string" &&
    Number.isFinite(Date.parse(item.at)) &&
    typeof item.stage === "string" &&
    /^[a-z_]{1,40}$/.test(item.stage) &&
    typeof item.model === "string" &&
    /^[\w./:-]{1,160}$/.test(item.model) &&
    !item.model.startsWith("/") &&
    Number.isSafeInteger(item.maxOutputTokens) &&
    Number.isSafeInteger(item.durationMs) &&
    (item.httpStatus === null ||
      (Number.isSafeInteger(item.httpStatus) &&
        item.httpStatus! >= 100 &&
        item.httpStatus! <= 599)) &&
    [
      "tool_calls",
      "stop",
      "length",
      "content_filter",
      "other",
      "missing",
    ].includes(item.finishReason || "") &&
    (item.choiceCount === null ||
      (Number.isSafeInteger(item.choiceCount) &&
        item.choiceCount! >= 0 &&
        item.choiceCount! <= 16)) &&
    (item.toolCallCount === null ||
      (Number.isSafeInteger(item.toolCallCount) &&
        item.toolCallCount! >= 0 &&
        item.toolCallCount! <= 16)) &&
    (item.usage === null ||
      (!!item.usage &&
        Number.isSafeInteger(item.usage.inputTokens) &&
        item.usage.inputTokens >= 0 &&
        Number.isSafeInteger(item.usage.outputTokens) &&
        item.usage.outputTokens >= 0)) &&
    [
      "ok",
      "http_error",
      "network_error",
      "empty_response",
      "response_too_large",
      "invalid_json",
      "incomplete",
      "invalid_arguments",
    ].includes(item.outcome || "")
  );
}

export function sanitizeRequestDiagnostic(
  value: unknown,
): RequestDiagnostic | null {
  if (!validRequestDiagnostic(value)) return null;
  return {
    version: 1,
    at: value.at,
    stage: value.stage,
    model: value.model,
    maxOutputTokens: value.maxOutputTokens,
    durationMs: value.durationMs,
    httpStatus: value.httpStatus,
    finishReason: value.finishReason,
    choiceCount: value.choiceCount,
    toolCallCount: value.toolCallCount,
    usage: value.usage
      ? {
          inputTokens: value.usage.inputTokens,
          outputTokens: value.usage.outputTokens,
        }
      : null,
    outcome: value.outcome,
  };
}
