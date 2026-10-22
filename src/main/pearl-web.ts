import type { PearlMessage } from "../shared/pearl-chat";
import {
  PEARL_WEB_READS_PER_TURN,
  PEARL_WEB_SEARCHES_PER_TURN,
} from "../shared/pearl-web-limits";

export type PearlWebResult = {
  title: string;
  url: string;
  excerpt: string;
};

export type PearlWebProvider = {
  search(query: string, signal?: AbortSignal): Promise<PearlWebResult[]>;
  read(url: string, query: string, signal?: AbortSignal): Promise<string>;
};

type TurnResults = {
  messageId: string;
  searches: number;
  reads: number;
  query: string;
  results: PearlWebResult[];
  cached: Map<string, PearlWebResult[]>;
};

const privateQuery =
  /(?:\b(?:api[_-]?key|secret|password|token)\s*[:=]|\b(?:sk-|nvapi-|tvly-)[\w-]{8,}|(?:^|\s)(?:\.env\b|[~/](?:Users|home|private|Volumes)\/))/i;

export function validateWebQuery(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length < 2 ||
    value.length > 200 ||
    /[\x00-\x1f\x7f]/.test(value) ||
    privateQuery.test(value)
  )
    throw new Error(
      "Invalid web search query. Use a short public query without paths or secrets.",
    );
  return value.trim();
}

export function publicWebUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_000) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.hostname.includes(".") &&
      !url.hostname.endsWith(".local") &&
      !url.hostname.endsWith(".localhost") &&
      !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(url.hostname) &&
      !url.hostname.includes(":")
    );
  } catch {
    return false;
  }
}

function clean(value: unknown, limit: number): string {
  return typeof value === "string"
    ? value
        .replace(/[\x00-\x1f\x7f]/g, " ")
        .replace(/ {2,}/g, " ")
        .trim()
        .slice(0, limit)
    : "";
}

/** Search results confer read access only to their own public URLs in this turn. */
export class PearlWebAccess {
  private turns = new Map<string, TurnResults>();
  constructor(private provider: PearlWebProvider) {}

  clear(chatId: string): void {
    this.turns.delete(chatId);
  }

  restore(chatId: string, messageId: string, messages: PearlMessage[]): void {
    const state: TurnResults = {
      messageId,
      searches: 0,
      reads: 0,
      query: "",
      results: [],
      cached: new Map(),
    };
    for (const message of messages) {
      if (message.role !== "tool") continue;
      if (message.toolName === "read_web_result") state.reads++;
      if (message.toolName !== "search_web") continue;
      state.results = [];
      try {
        const value = JSON.parse(message.text) as {
          query?: unknown;
          results?: unknown;
        };
        if (typeof value.query !== "string" || !Array.isArray(value.results))
          throw new Error("Search result is unavailable");
        state.query = validateWebQuery(value.query);
        state.results = value.results
          .filter(
            (item): item is PearlWebResult & { id: string } =>
              item &&
              typeof item === "object" &&
              typeof item.title === "string" &&
              publicWebUrl(item.url) &&
              typeof item.excerpt === "string",
          )
          .slice(0, 5)
          .map((item) => ({
            title: clean(item.title, 200),
            url: item.url,
            excerpt: clean(item.excerpt, 1_200),
          }));
        if (!state.cached.has(state.query)) {
          state.cached.set(state.query, state.results);
          state.searches++;
        }
      } catch {
        /* A failed search still consumed one request. */
        state.searches++;
      }
    }
    this.turns.set(chatId, state);
  }

  private turn(chatId: string, messageId: string): TurnResults {
    let state = this.turns.get(chatId);
    if (!state || state.messageId !== messageId) {
      state = {
        messageId,
        searches: 0,
        reads: 0,
        query: "",
        results: [],
        cached: new Map(),
      };
      this.turns.set(chatId, state);
    }
    return state;
  }

  async search(
    chatId: string,
    messageId: string,
    query: unknown,
    signal?: AbortSignal,
  ): Promise<{ query: string; results: (PearlWebResult & { id: string })[] }> {
    const safeQuery = validateWebQuery(query);
    const state = this.turn(chatId, messageId);
    const cached = state.cached.get(safeQuery);
    if (cached) {
      state.query = safeQuery;
      state.results = cached;
      return {
        query: safeQuery,
        results: cached.map((item, index) => ({
          id: String(index + 1),
          ...item,
        })),
      };
    }
    if (state.searches >= PEARL_WEB_SEARCHES_PER_TURN)
      throw new Error("Web search limit reached for this turn");
    state.searches++;
    state.query = safeQuery;
    state.results = [];
    const raw = await this.provider.search(safeQuery, signal);
    state.results = raw
      .filter((item) => publicWebUrl(item.url))
      .slice(0, 5)
      .map((item) => ({
        title: clean(item.title, 200),
        url: item.url,
        excerpt: clean(item.excerpt, 1_200),
      }));
    state.cached.set(safeQuery, state.results);
    return {
      query: safeQuery,
      results: state.results.map((item, index) => ({
        id: String(index + 1),
        ...item,
      })),
    };
  }

  async read(
    chatId: string,
    messageId: string,
    resultId: unknown,
    signal?: AbortSignal,
  ): Promise<{
    title: string;
    url: string;
    content: string;
    truncated: boolean;
  }> {
    const state = this.turns.get(chatId);
    if (!state || state.messageId !== messageId)
      throw new Error("Web result is not from the current turn");
    if (state.reads >= PEARL_WEB_READS_PER_TURN)
      throw new Error("Web reading limit reached for this turn");
    if (typeof resultId !== "string" || !/^[1-5]$/.test(resultId))
      throw new Error("Unknown web result");
    const result = state.results[Number(resultId) - 1];
    if (!result) throw new Error("Unknown web result");
    state.reads++;
    const raw = await this.provider.read(result.url, state.query, signal);
    const content = clean(raw, 8_000);
    return {
      title: result.title,
      url: result.url,
      content,
      truncated: raw.length > 8_000,
    };
  }
}

export class PearlWebConnection {
  private key: string | null = null;

  info(): { configured: boolean } {
    return { configured: this.key !== null };
  }

  current(): string | null {
    return this.key;
  }

  configure(value: unknown): { configured: boolean } {
    if (typeof value !== "string" || !/^tvly-[A-Za-z0-9_-]{8,480}$/.test(value))
      throw new Error("Enter a valid Tavily API key");
    this.key = value;
    return this.info();
  }

  close(): void {
    this.key = null;
  }
}
