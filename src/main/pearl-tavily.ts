import {
  publicWebUrl,
  validateWebQuery,
  type PearlWebProvider,
  type PearlWebResult,
} from "./pearl-web";

const responseLimit = 512_000;
const requestTimeoutMs = 12_000;

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Web provider returned no data");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > responseLimit)
        throw new Error("Web provider response exceeded the size limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Web provider returned invalid data");
  }
}

export class TavilyWebProvider implements PearlWebProvider {
  constructor(
    private key: () => string | null,
    private fetcher: typeof fetch = fetch,
  ) {}

  private async request(
    endpoint: "search" | "extract",
    body: object,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const key = this.key();
    if (!key) throw new Error("Web search is not connected in Settings");
    const timeout = AbortSignal.timeout(requestTimeoutMs);
    const response = await this.fetcher(`https://api.tavily.com/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403)
        throw new Error("Web search key was rejected");
      if (response.status === 429)
        throw new Error("Web search is rate limited or out of credits");
      throw new Error("Web search provider is unavailable");
    }
    const parsed = await boundedJson(response);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("Web provider returned invalid data");
    return parsed as Record<string, unknown>;
  }

  async search(query: string, signal?: AbortSignal): Promise<PearlWebResult[]> {
    const data = await this.request(
      "search",
      {
        query: validateWebQuery(query),
        search_depth: "basic",
        max_results: 5,
        include_answer: false,
        include_raw_content: false,
        include_images: false,
        auto_parameters: false,
        safe_search: true,
      },
      signal,
    );
    if (!Array.isArray(data.results))
      throw new Error("Web provider returned invalid results");
    return data.results.slice(0, 5).flatMap((value): PearlWebResult[] => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return [];
      const item = value as Record<string, unknown>;
      if (
        typeof item.title !== "string" ||
        typeof item.url !== "string" ||
        typeof item.content !== "string"
      )
        return [];
      return [{ title: item.title, url: item.url, excerpt: item.content }];
    });
  }

  async read(
    url: string,
    query: string,
    signal?: AbortSignal,
  ): Promise<string> {
    if (!publicWebUrl(url)) throw new Error("Invalid web result URL");
    const data = await this.request(
      "extract",
      {
        urls: url,
        query: validateWebQuery(query),
        chunks_per_source: 3,
        extract_depth: "basic",
        include_images: false,
        format: "markdown",
      },
      signal,
    );
    if (!Array.isArray(data.results))
      throw new Error("Web provider returned invalid page data");
    const result = data.results.find((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
      return (value as Record<string, unknown>).url === url;
    }) as Record<string, unknown> | undefined;
    if (!result || typeof result.raw_content !== "string")
      throw new Error("Web provider could not read that result");
    return result.raw_content;
  }
}
