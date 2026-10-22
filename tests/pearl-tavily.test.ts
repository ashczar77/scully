// @vitest-environment node
import { expect, it, vi } from "vitest";
import { PearlWebConnection } from "../src/main/pearl-web";
import { TavilyWebProvider } from "../src/main/pearl-tavily";

it("keeps the search key in memory and never returns it in connection status", () => {
  const connection = new PearlWebConnection();
  expect(connection.info()).toEqual({ configured: false });
  expect(() => connection.configure("invalid")).toThrow();
  expect(connection.configure("tvly-fixture-secret")).toEqual({
    configured: true,
  });
  expect(JSON.stringify(connection.info())).not.toContain("fixture-secret");
  connection.close();
  expect(connection.current()).toBeNull();
});

it("sends bounded search and extract requests only to fixed provider endpoints", async () => {
  const fetcher = vi.fn(async (url: string, options: RequestInit) => {
    if (url.endsWith("/search"))
      return Response.json({
        results: [
          {
            title: "Reference",
            url: "https://example.org/docs",
            content: "A useful excerpt",
          },
        ],
      });
    return Response.json({
      results: [{ url: "https://example.org/docs", raw_content: "Full text" }],
    });
  });
  const provider = new TavilyWebProvider(
    () => "tvly-fixture-secret",
    fetcher as unknown as typeof fetch,
  );
  expect(await provider.search("  release notes  ")).toEqual([
    {
      title: "Reference",
      url: "https://example.org/docs",
      excerpt: "A useful excerpt",
    },
  ]);
  expect(await provider.read("https://example.org/docs", "release notes")).toBe(
    "Full text",
  );
  const [searchUrl, searchOptions] = fetcher.mock.calls[0];
  expect(searchUrl).toBe("https://api.tavily.com/search");
  expect(searchOptions.redirect).toBe("error");
  expect(JSON.parse(searchOptions.body as string)).toMatchObject({
    query: "release notes",
    max_results: 5,
    search_depth: "basic",
    include_raw_content: false,
    include_answer: false,
  });
  expect(fetcher.mock.calls[1][0]).toBe("https://api.tavily.com/extract");
  expect(JSON.parse(fetcher.mock.calls[1][1].body as string).urls).toBe(
    "https://example.org/docs",
  );
  expect(JSON.parse(fetcher.mock.calls[1][1].body as string).query).toBe(
    "release notes",
  );
});

it("rejects private extraction targets and hides provider error bodies", async () => {
  const fetcher = vi.fn(
    async () => new Response("token: secret", { status: 429 }),
  );
  const provider = new TavilyWebProvider(
    () => "tvly-fixture-secret",
    fetcher as unknown as typeof fetch,
  );
  await expect(
    provider.read("http://127.0.0.1/private", "query"),
  ).rejects.toThrow("Invalid web result URL");
  expect(fetcher).not.toHaveBeenCalled();
  await expect(provider.search("public query")).rejects.toThrow(
    /rate limited or out of credits/,
  );
});

it("rejects oversized or malformed provider output", async () => {
  const tooLarge = new TavilyWebProvider(
    () => "tvly-fixture-secret",
    vi.fn(
      async () => new Response("x".repeat(600_000)),
    ) as unknown as typeof fetch,
  );
  await expect(tooLarge.search("public query")).rejects.toThrow(/size limit/);
  const malformed = new TavilyWebProvider(
    () => "tvly-fixture-secret",
    vi.fn(async () =>
      Response.json({ results: null }),
    ) as unknown as typeof fetch,
  );
  await expect(malformed.search("public query")).rejects.toThrow(
    /invalid results/,
  );
});
