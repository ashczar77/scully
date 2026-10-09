export type Completion = {
  system: string;
  input: string;
  name: string;
  schema: object;
};
export type Model = { complete: (request: Completion) => Promise<unknown> };
export function nebiusModel(
  config: { key: string; model: string; outputTokens: number },
  fetcher: typeof fetch = fetch,
): Model {
  return {
    async complete(request) {
      const body = JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.input },
        ],
        store: false,
        stream: false,
        max_tokens: config.outputTokens,
        temperature: 0.6,
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
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(
          `Nebius returned HTTP ${response.status}. Check model access, credits and credentials. No retry was made.`,
        );
      }
      if (!response.body) throw new Error("Empty provider response");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 200000)
            throw new Error("Provider response exceeds the limit");
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const choice = value.choices?.[0];
      const calls = choice?.message?.tool_calls;
      if (
        value.choices?.length !== 1 ||
        choice.finish_reason !== "tool_calls" ||
        calls?.length !== 1 ||
        calls[0].function?.name !== request.name ||
        typeof calls[0].function.arguments !== "string"
      )
        throw new Error("Provider did not return a complete structured result");
      return JSON.parse(calls[0].function.arguments);
    },
  };
}
