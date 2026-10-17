import type { ModelOption } from "../shared/runs";

export function parseModelCatalog(value: unknown): ModelOption[] {
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray((value as { data?: unknown }).data)
  )
    throw new Error("Nebius returned an invalid model list");
  const names = new Set<string>();
  for (const row of (value as { data: unknown[] }).data.slice(0, 500)) {
    if (!row || typeof row !== "object") continue;
    const id = (row as { id?: unknown }).id;
    if (typeof id === "string" && /^[\w./:-]{1,160}$/.test(id)) names.add(id);
  }
  if (!names.size) throw new Error("Nebius returned no selectable models");
  return [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({
      id,
      name: id.split("/").at(-1) || id,
    }));
}

export async function fetchModelCatalog(
  key: string,
  request: typeof fetch = fetch,
): Promise<ModelOption[]> {
  const response = await request(
    "https://api.tokenfactory.nebius.com/v1/models",
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
      if (size > 524288)
        throw new Error("Nebius model list exceeds the size limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return parseModelCatalog(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}
