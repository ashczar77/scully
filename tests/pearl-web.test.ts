// @vitest-environment node
import { expect, it, vi } from "vitest";
import {
  PearlWebAccess,
  validateWebQuery,
  type PearlWebProvider,
} from "../src/main/pearl-web";
import type { PearlMessage } from "../src/shared/pearl-chat";

const result = {
  title: "Example reference",
  url: "https://example.org/reference",
  excerpt: "A short reference excerpt.",
};

it("accepts concise public searches and rejects likely private or unbounded queries", () => {
  expect(validateWebQuery("TypeScript release notes")).toBe(
    "TypeScript release notes",
  );
  for (const value of [
    "",
    "x".repeat(201),
    "line one\nline two",
    "look up /Users/example/private/project",
    "find .env API_KEY=secret",
    "search sk-example-secret-token",
  ]) {
    expect(() => validateWebQuery(value)).toThrow();
  }
});

it("returns bounded, attributed results and only reads a result from the current turn", async () => {
  const provider: PearlWebProvider = {
    search: vi.fn(async () => [result]),
    read: vi.fn(async () => "Reference body"),
  };
  const access = new PearlWebAccess(provider);
  const searched = await access.search(
    "chat-a",
    "message-a",
    "TypeScript release notes",
  );
  expect(searched.results).toEqual([{ id: "1", ...result }]);
  expect(await access.read("chat-a", "message-a", "1")).toEqual({
    title: result.title,
    url: result.url,
    content: "Reference body",
    truncated: false,
  });
  await expect(access.read("chat-a", "message-b", "1")).rejects.toThrow(
    /current turn/i,
  );
  expect(provider.read).toHaveBeenCalledTimes(1);
});

it("limits provider calls and rejects forged result identities", async () => {
  const provider: PearlWebProvider = {
    search: vi.fn(async () => [result]),
    read: vi.fn(async () => "Reference body"),
  };
  const access = new PearlWebAccess(provider);
  await access.search("chat", "message", "first query");
  await expect(access.read("chat", "message", "2")).rejects.toThrow();
  for (let i = 0; i < 20; i++) await access.read("chat", "message", "1");
  await expect(access.read("chat", "message", "1")).rejects.toThrow(/limit/i);
  for (let i = 2; i <= 12; i++)
    await access.search("chat", "message", `query number ${i}`);
  await expect(
    access.search("chat", "message", "query number 13"),
  ).rejects.toThrow(/limit/i);
  expect(provider.search).toHaveBeenCalledTimes(12);
  expect(provider.read).toHaveBeenCalledTimes(20);
  await expect(
    access.search("chat", "next message", "new turn query"),
  ).resolves.toMatchObject({ query: "new turn query" });
});

it("reuses an identical successful query without another provider call or search slot", async () => {
  const provider: PearlWebProvider = {
    search: vi.fn(async () => [result]),
    read: vi.fn(async () => "Reference body"),
  };
  const access = new PearlWebAccess(provider);
  await access.search("chat", "message", "  first query  ");
  for (let i = 2; i <= 12; i++)
    await access.search("chat", "message", `query number ${i}`);
  expect(await access.search("chat", "message", "first query")).toMatchObject({
    query: "first query",
    results: [{ id: "1", url: result.url }],
  });
  expect(provider.search).toHaveBeenCalledTimes(12);
  expect(await access.read("chat", "message", "1")).toMatchObject({
    url: result.url,
  });
  expect(provider.read).toHaveBeenCalledWith(
    result.url,
    "first query",
    undefined,
  );
});

it("restores per-turn limits and result identity from saved observations", async () => {
  const provider: PearlWebProvider = {
    search: vi.fn(async () => [result]),
    read: vi.fn(async () => "Reference body"),
  };
  const saved = new PearlWebAccess(provider);
  const observation = await saved.search("chat", "message", "release notes");
  const messages: PearlMessage[] = [
    ...Array.from({ length: 12 }, (_, index) => ({
      id: `search-${index}`,
      role: "tool" as const,
      toolName: "search_web",
      text: JSON.stringify({
        ...observation,
        query: `query number ${index + 1}`,
      }),
      at: "2026-10-22T00:00:00.000Z",
    })),
    {
      id: "repeated-search",
      role: "tool",
      toolName: "search_web",
      text: JSON.stringify({ ...observation, query: "query number 1" }),
      at: "2026-10-22T00:00:00.000Z",
    },
    {
      id: "read-1",
      role: "tool",
      toolName: "read_web_result",
      text: "Action failed: temporary outage",
      at: "2026-10-22T00:00:00.000Z",
    },
  ];
  const restored = new PearlWebAccess(provider);
  restored.restore("chat", "message", messages);
  await expect(
    restored.search("chat", "message", "another query"),
  ).rejects.toThrow(/limit/i);
  expect(
    await restored.search("chat", "message", "query number 1"),
  ).toMatchObject({
    query: "query number 1",
    results: [{ id: "1", url: result.url }],
  });
  expect(await restored.read("chat", "message", "1")).toMatchObject({
    url: result.url,
  });
  expect(provider.read).toHaveBeenCalledWith(
    result.url,
    "query number 1",
    undefined,
  );
});

it("restores the read cap without granting another page fetch", async () => {
  const provider: PearlWebProvider = {
    search: vi.fn(async () => [result]),
    read: vi.fn(async () => "Reference body"),
  };
  const access = new PearlWebAccess(provider);
  access.restore("chat", "message", [
    {
      id: "search",
      role: "tool",
      toolName: "search_web",
      text: JSON.stringify({
        query: "public reference",
        results: [{ id: "1", ...result }],
      }),
      at: "2026-10-22T00:00:00.000Z",
    },
    ...Array.from({ length: 20 }, (_, index) => ({
      id: `read-${index}`,
      role: "tool" as const,
      toolName: "read_web_result",
      text: "Reference body",
      at: "2026-10-22T00:00:00.000Z",
    })),
  ]);
  await expect(access.read("chat", "message", "1")).rejects.toThrow(/limit/i);
  expect(provider.read).not.toHaveBeenCalled();
});

it("counts failed searches after restore so retries cannot bypass the safety budget", async () => {
  const provider: PearlWebProvider = {
    search: vi.fn(async () => [result]),
    read: vi.fn(async () => "Reference body"),
  };
  const access = new PearlWebAccess(provider);
  access.restore(
    "chat",
    "message",
    Array.from({ length: 12 }, (_, index) => ({
      id: `failed-${index}`,
      role: "tool" as const,
      toolName: "search_web",
      text: "Action failed: temporary outage",
      at: "2026-10-22T00:00:00.000Z",
    })),
  );
  await expect(
    access.search("chat", "message", "another query"),
  ).rejects.toThrow(/limit/i);
  expect(provider.search).not.toHaveBeenCalled();
});

it("discards malformed links, overlong content, and control characters from web output", async () => {
  const provider: PearlWebProvider = {
    search: vi.fn(async () => [
      { title: "Bad", url: "file:///private/data", excerpt: "private" },
      {
        title: "Valid\u0000 title",
        url: "https://example.org/page",
        excerpt: "z".repeat(20_000),
      },
    ]),
    read: vi.fn(async () => "y".repeat(100_000)),
  };
  const access = new PearlWebAccess(provider);
  const searched = await access.search("chat", "message", "query");
  expect(searched.results).toHaveLength(1);
  expect(searched.results[0].title).toBe("Valid title");
  expect(searched.results[0].excerpt.length).toBeLessThanOrEqual(1200);
  const read = await access.read("chat", "message", "1");
  expect(read.content.length).toBeLessThanOrEqual(8_000);
  expect(read.truncated).toBe(true);
});
