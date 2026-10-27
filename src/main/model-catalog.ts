import type { ModelOption } from "../shared/runs";

export function parseModelCatalog(value: unknown): ModelOption[] {
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray((value as { data?: unknown }).data)
  )
    throw new Error("Nebius returned an invalid model list");
  const names = new Map<string, ModelOption>();
  for (const row of (value as { data: unknown[] }).data) {
    if (!row || typeof row !== "object") continue;
    const id = (row as { id?: unknown }).id;
    if (typeof id !== "string" || !/^[\w./:-]{1,160}$/.test(id)) continue;
    const item = row as Record<string, unknown>;
    const capabilities =
      item.capabilities && typeof item.capabilities === "object"
        ? (item.capabilities as Record<string, unknown>)
        : {};
    const output =
      typeof item.max_output_tokens === "number" &&
      Number.isSafeInteger(item.max_output_tokens)
        ? item.max_output_tokens
        : undefined;
    const option: ModelOption = { id, name: id.split("/").at(-1) || id };
    const reason =
      item.type && item.type !== "text2text" && item.type !== "chat"
        ? "This model does not support chat completions"
        : /(?:^|[-_/])(embedding|rerank(?:er)?|whisper|text-to-speech|speech-to-text)(?:$|[-_/])/i.test(
              id,
            )
          ? "This model is for a different endpoint and cannot run teammate chat tools"
          : capabilities.tools === false || capabilities.tool_calls === false
            ? "This model does not support tool calls"
            : undefined;
    if (reason) option.disabledReason = reason;
    if (output) option.maxOutputTokens = output;
    if (capabilities.reasoning === true || capabilities.thinking === true)
      option.supportsThinking = true;
    const architecture =
      item.architecture && typeof item.architecture === "object"
        ? (item.architecture as Record<string, unknown>)
        : {};
    const inputModality =
      typeof architecture.modality === "string"
        ? architecture.modality.split("->")[0]
        : "";
    option.supportsImages =
      capabilities.vision === true ||
      capabilities.image_input === true ||
      /image/i.test(inputModality);
    names.set(id, option);
  }
  if (!names.size) throw new Error("Nebius returned no selectable models");
  return [...names.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function fetchModelCatalog(
  key: string,
  request: typeof fetch = fetch,
): Promise<ModelOption[]> {
  const response = await request(
    "https://api.tokenfactory.nebius.com/v1/models?verbose=true",
    {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok)
    throw new Error(`Could not load Nebius models (HTTP ${response.status})`);
  if (!response.body) throw new Error("Nebius returned an empty model list");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8 * 1024 * 1024)
        throw new Error("Nebius model list exceeds the size limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return parseModelCatalog(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}
