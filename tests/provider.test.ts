// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { nebiusModel } from "../src/engine/provider";
const request = {
  system: "Role",
  input: "Task",
  name: "result",
  schema: { type: "object" },
};
const config = {
  key: "test-key-not-real",
  model: "test/model",
  outputTokens: 1024,
};
const response = (args = '{"ok":true}') => ({
  choices: [
    {
      finish_reason: "tool_calls",
      message: {
        tool_calls: [{ function: { name: "result", arguments: args } }],
      },
    },
  ],
});
it("uses fixed HTTPS endpoint, bounded output, no storage and an explicit tool response", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(response())));
  expect(await nebiusModel(config, fetcher).complete(request)).toEqual({
    ok: true,
  });
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe("https://api.tokenfactory.nebius.com/v1/chat/completions");
  expect(options.redirect).toBe("error");
  expect(options.signal).toBeInstanceOf(AbortSignal);
  const body = JSON.parse(options.body);
  expect(body.store).toBe(false);
  expect(body.max_tokens).toBe(1024);
  expect(options.body).not.toContain(config.key);
});
it.each([401, 429, 500])(
  "does not retry HTTP %s or disclose raw response",
  async (status) => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response("sensitive raw provider error", { status }),
      );
    await expect(
      nebiusModel(config, fetcher).complete(request),
    ).rejects.toThrow(`HTTP ${status}`);
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
it.each([
  { choices: [] },
  { choices: [{ finish_reason: "length", message: { content: "partial" } }] },
  response("not json"),
])("rejects incomplete or malformed output", async (body) => {
  await expect(
    nebiusModel(
      config,
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body))),
    ).complete(request),
  ).rejects.toThrow();
});
it("bounds provider response size", async () => {
  await expect(
    nebiusModel(
      config,
      vi.fn().mockResolvedValue(new Response("x".repeat(200001))),
    ).complete(request),
  ).rejects.toThrow("limit");
});
it("exercises the adapter through a real loopback HTTP boundary without contacting Nebius", async () => {
  let captured: any;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      captured = {
        method: req.method,
        body: JSON.parse(Buffer.concat(chunks).toString()),
      };
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(response()));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address() as { port: number };
    const transport: typeof fetch = (_url, options) =>
      fetch(`http://127.0.0.1:${address.port}`, options);
    expect(await nebiusModel(config, transport).complete(request)).toEqual({
      ok: true,
    });
    expect(captured.method).toBe("POST");
    expect(captured.body.model).toBe("test/model");
    expect(captured.body.tool_choice.function.name).toBe("result");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
