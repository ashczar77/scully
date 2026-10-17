import { reportedUsage, type ReportedUsage } from "../shared/usage";
import type { RequestDiagnostic } from "../shared/request-diagnostics";

export type Completion = {
  actor?: string;
  model?: string;
  system: string;
  input: string;
  name: string;
  schema: object;
  onUsage?: (usage: ReportedUsage | null) => void;
  onDiagnostic?: (diagnostic: RequestDiagnostic) => void;
  maxOutputTokens?: number;
};
export type Model = { complete: (request: Completion) => Promise<unknown> };
export function nebiusModel(
  config: {
    key: string;
    model: string;
    outputTokens: number;
    planningTemperature?: number;
  },
  fetcher: typeof fetch = fetch,
  rawCapture?: (value: {
    request: string;
    response: string | null;
    httpStatus: number | null;
  }) => void,
): Model {
  return {
    async complete(request) {
      const selectedModel = request.model || config.model;
      const planningTemperature = config.planningTemperature ?? 0.2;
      if (
        !Number.isFinite(planningTemperature) ||
        planningTemperature < 0 ||
        planningTemperature > 1
      )
        throw new Error("Invalid planning temperature");
      const started = Date.now();
      const maxOutputTokens = request.maxOutputTokens ?? config.outputTokens;
      if (
        !Number.isSafeInteger(maxOutputTokens) ||
        maxOutputTokens < 512 ||
        maxOutputTokens > 4096
      )
        throw new Error("Invalid output token limit");
      const body = JSON.stringify({
        model: selectedModel,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.input },
        ],
        store: false,
        stream: false,
        max_tokens: maxOutputTokens,
        ...(/nemotron[-_]?3[._-]?5[-_]?lightning/i.test(selectedModel)
          ? { chat_template_kwargs: { enable_thinking: false } }
          : {}),
        temperature:
          request.name === "propose_plan" ? planningTemperature : 0.6,
        top_p: 0.95,
        n: 1,
        service_tier: "default",
        tools: [
          {
            type: "function",
            function: {
              name: request.name,
              description: "Return the structured result.",
              parameters: request.schema,
            },
          },
        ],
        tool_choice: { type: "function", function: { name: request.name } },
      });
      if (Buffer.byteLength(body) > 100000)
        throw new Error("Request exceeds the input limit");
      const signal = AbortSignal.timeout(90000);
      let httpStatus: number | null = null;
      let finishReason: RequestDiagnostic["finishReason"] = "missing";
      let choiceCount: number | null = null;
      let toolCallCount: number | null = null;
      let usage: ReportedUsage | null = null;
      let outcome: RequestDiagnostic["outcome"] = "network_error";
      let rawResponse: string | null = null;
      try {
        const response = await fetcher(
          "https://api.tokenfactory.nebius.com/v1/chat/completions",
          {
            method: "POST",
            redirect: "error",
            signal,
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${config.key}`,
            },
            body,
          },
        );
        httpStatus = response.status;
        if (!response.ok) {
          outcome = "http_error";
          await response.body?.cancel();
          throw new Error(
            `Nebius returned HTTP ${response.status}. Check model access, credits and credentials. No retry was made.`,
          );
        }
        if (!response.body) {
          outcome = "empty_response";
          throw new Error("Empty provider response");
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 200000) {
              outcome = "response_too_large";
              throw new Error("Provider response exceeds the limit");
            }
            chunks.push(value);
          }
        } finally {
          await reader.cancel();
        }
        rawResponse = Buffer.concat(chunks).toString("utf8");
        let value: any;
        try {
          value = JSON.parse(rawResponse);
        } catch {
          outcome = "invalid_json";
          throw new Error(
            "Provider response was not valid JSON. No retry was made.",
          );
        }
        usage = reportedUsage(value.usage);
        try {
          request.onUsage?.(usage);
        } catch {
          // Usage recording must not change the result of a model request.
        }
        const choice = value.choices?.[0];
        const calls = choice?.message?.tool_calls;
        choiceCount = Array.isArray(value.choices)
          ? Math.min(value.choices.length, 16)
          : null;
        toolCallCount = Array.isArray(calls)
          ? Math.min(calls.length, 16)
          : null;
        finishReason = [
          "tool_calls",
          "stop",
          "length",
          "content_filter",
        ].includes(choice?.finish_reason)
          ? choice.finish_reason
          : choice?.finish_reason
            ? "other"
            : "missing";
        if (finishReason === "length") {
          outcome = "incomplete";
          throw new Error(
            `Nebius stopped at the ${maxOutputTokens}-token output limit before completing the result. No retry was made. Increase the output limit in Run usage and start a new attempt.`,
          );
        }
        const argumentsText =
          finishReason === "tool_calls" &&
          choiceCount === 1 &&
          toolCallCount === 1 &&
          calls[0].function?.name === request.name
            ? calls[0].function.arguments
            : finishReason === "stop" &&
                choiceCount === 1 &&
                toolCallCount === null
              ? choice.message?.content
              : null;
        if (typeof argumentsText !== "string") {
          outcome = "incomplete";
          throw new Error(
            `Nebius did not complete the expected structured result (finish: ${finishReason}, tool calls: ${toolCallCount ?? "unknown"}). No retry was made.`,
          );
        }
        try {
          const parsed = JSON.parse(argumentsText);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            throw new Error("Invalid result");
          outcome = "ok";
          return parsed;
        } catch {
          outcome = "invalid_arguments";
          throw new Error(
            "Nebius returned invalid structured arguments. No retry was made.",
          );
        }
      } finally {
        const diagnostic: RequestDiagnostic = {
          version: 1,
          at: new Date(started).toISOString(),
          stage: request.name,
          model: selectedModel,
          maxOutputTokens,
          durationMs: Math.max(0, Date.now() - started),
          httpStatus,
          finishReason,
          choiceCount,
          toolCallCount,
          usage,
          outcome,
        };
        try {
          request.onDiagnostic?.(diagnostic);
        } catch {
          /* Diagnostics cannot change the request result. */
        }
        try {
          rawCapture?.({ request: body, response: rawResponse, httpStatus });
        } catch {
          /* Local capture is optional. */
        }
      }
    },
  };
}
