// @vitest-environment node
import { expect, it, vi } from "vitest";
import {
  RemoteMcpConnection,
  publicAddress,
  publicDnsAnswer,
  validateRemoteMcpEndpoint,
} from "../src/main/pearl-mcp";

it("rejects private and special DNS resolutions while allowing public addresses", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.1.1",
    "192.168.1.1",
    "::1",
    "fe80::1",
    "fc00::1",
    "::ffff:127.0.0.1",
  ])
    expect(publicAddress(address)).toBe(false);
  expect(publicAddress("8.8.8.8")).toBe(true);
  expect(publicAddress("2606:4700:4700::1111")).toBe(true);
});

it("preserves the address array when the HTTP transport requests all DNS answers", () => {
  const addresses = [
    { address: "172.67.75.119", family: 4 },
    { address: "104.26.4.119", family: 4 },
  ];
  expect(publicDnsAnswer(addresses, true)).toEqual(addresses);
  expect(publicDnsAnswer(addresses, false)).toBe(addresses[0].address);
  expect(() =>
    publicDnsAnswer([{ address: "127.0.0.1", family: 4 }], true),
  ).toThrow("non-public");
});

it.each([
  "http://example.com/mcp",
  "https://localhost/mcp",
  "https://127.0.0.1/mcp",
  "https://example.com:8443/mcp",
  "https://user:secret@example.com/mcp",
  "https://example.com/mcp?token=secret",
  "https://example.com/mcp#fragment",
])("rejects unsafe remote endpoint %s", (endpoint) => {
  expect(() => validateRemoteMcpEndpoint(endpoint)).toThrow();
});

function fixtureFetch() {
  const requests: { method: string; params?: Record<string, unknown> }[] = [];
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "GET") return new Response(null, { status: 405 });
    const request = JSON.parse(String(init?.body)) as {
      id?: number;
      method: string;
      params?: Record<string, unknown>;
    };
    requests.push(request);
    if (request.method === "notifications/initialized")
      return new Response(null, { status: 202 });
    const result =
      request.method === "server/discover"
        ? undefined
        : request.method === "initialize"
          ? {
              protocolVersion: "2025-06-18",
              capabilities: { tools: {} },
              serverInfo: { name: "fixture", version: "1.0.0" },
            }
          : request.method === "tools/list"
            ? {
                tools: [
                  {
                    name: "sample_lookup",
                    description: "Look up a sample",
                    inputSchema: {
                      type: "object",
                      properties: { term: { type: "string" } },
                    },
                  },
                ],
              }
            : request.method === "tools/call"
              ? { content: [{ type: "text", text: "found" }] }
              : {};
    return new Response(
      JSON.stringify(
        request.method === "server/discover"
          ? {
              jsonrpc: "2.0",
              id: request.id,
              error: { code: -32601, message: "Method not found" },
            }
          : { jsonrpc: "2.0", id: request.id, result },
      ),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  return { fetcher, requests };
}

it("discovers tools and requires the current connection revision for a call", async () => {
  const { fetcher, requests } = fixtureFetch();
  const connection = new RemoteMcpConnection(fetcher as never);
  const connected = await connection.connect(
    "https://example.com/mcp",
    "test-token",
  );
  expect(connected.tools.map((tool) => tool.name)).toEqual(["sample_lookup"]);
  const approved = connection.validateCall("sample_lookup", { term: "hello" });
  expect(await connection.call(approved)).toContain("found");
  expect(requests.some((request) => request.method === "tools/call")).toBe(
    true,
  );
  await connection.disconnect();
  await expect(connection.call(approved)).rejects.toThrow("connection changed");
  expect(connection.info().connected).toBe(false);
});

it("rejects unlisted tools and oversized arguments before network transfer", async () => {
  const { fetcher, requests } = fixtureFetch();
  const connection = new RemoteMcpConnection(fetcher as never);
  await connection.connect("https://example.com/mcp", "");
  expect(() => connection.validateCall("delete_all", {})).toThrow(
    "no longer available",
  );
  expect(() =>
    connection.validateCall("sample_lookup", { term: "x".repeat(17_000) }),
  ).toThrow("too large");
  expect(requests.some((request) => request.method === "tools/call")).toBe(
    false,
  );
  await connection.disconnect();
});

it("rejects an oversized remote response before it reaches Pearl", async () => {
  const { fetcher } = fixtureFetch();
  const oversized = vi.fn(async (url: string, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as {
      method: string;
      id?: number;
    };
    if (request.method === "tools/call")
      return new Response("x".repeat(1_000_001), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    return fetcher(url, init);
  });
  const connection = new RemoteMcpConnection(oversized as never);
  await connection.connect("https://example.com/mcp", "");
  const approved = connection.validateCall("sample_lookup", { term: "sample" });
  await expect(connection.call(approved)).rejects.toThrow();
  await connection.disconnect();
});
