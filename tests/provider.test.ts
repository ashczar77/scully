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
it("sends the selected teammate model for a request", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(response())));
  await nebiusModel(config, fetcher).complete({
    ...request,
    model: "nvidia/nemotron-3-super-120b-a12b",
  });
  expect(JSON.parse(fetcher.mock.calls[0][1].body).model).toBe(
    "nvidia/nemotron-3-super-120b-a12b",
  );
});
it("uses the request's captured output limit and rejects invalid overrides", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(response())));
  const model = nebiusModel(config, fetcher);
  await model.complete({ ...request, maxOutputTokens: 512 });
  expect(JSON.parse(fetcher.mock.calls[0][1].body).max_tokens).toBe(512);
  await expect(
    model.complete({ ...request, maxOutputTokens: 999999 }),
  ).rejects.toThrow("Invalid output token limit");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("uses a lower sampling temperature for planning so fresh drafts vary less", async () => {
  const fetcher = vi.fn().mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                tool_calls: [
                  {
                    function: {
                      name: "propose_plan",
                      arguments: '{"plan":"Draft"}',
                    },
                  },
                ],
              },
            },
          ],
        }),
      ),
  );
  await nebiusModel(config, fetcher).complete({
    ...request,
    name: "propose_plan",
  });
  expect(JSON.parse(fetcher.mock.calls[0][1].body).temperature).toBe(0.2);
  fetcher.mockClear();
  await nebiusModel({ ...config, planningTemperature: 0.4 }, fetcher).complete({
    ...request,
    name: "propose_plan",
  });
  expect(JSON.parse(fetcher.mock.calls[0][1].body).temperature).toBe(0.4);
  await expect(
    nebiusModel({ ...config, planningTemperature: 2 }, fetcher).complete({
      ...request,
      name: "propose_plan",
    }),
  ).rejects.toThrow("Invalid planning temperature");
});
it("reserves Nemotron 3.5 Lightning output for a concise structured answer", async () => {
  const fetcher = vi
    .fn()
    .mockImplementation(async () => new Response(JSON.stringify(response())));
  await nebiusModel(
    { ...config, model: "nvidia/Nemotron-3_5-Lightning" },
    fetcher,
  ).complete(request);
  expect(
    JSON.parse(fetcher.mock.calls[0][1].body).chat_template_kwargs,
  ).toEqual({ enable_thinking: false });
  await nebiusModel(config, fetcher).complete(request);
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).not.toHaveProperty(
    "chat_template_kwargs",
  );
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
it("reports valid provider usage even when the structured result is invalid", async () => {
  const onUsage = vi.fn();
  await expect(
    nebiusModel(
      config,
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...response("not json"),
            usage: { prompt_tokens: 15, completion_tokens: 4 },
          }),
        ),
      ),
    ).complete({ ...request, onUsage }),
  ).rejects.toThrow();
  expect(onUsage).toHaveBeenCalledWith({ inputTokens: 15, outputTokens: 4 });
});
it("explains output truncation, records safe diagnostics, and makes no automatic retry", async () => {
  const onDiagnostic = vi.fn();
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "length",
            message: { content: "private partial text" },
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 1024 },
      }),
    ),
  );
  await expect(
    nebiusModel(config, fetcher).complete({ ...request, onDiagnostic }),
  ).rejects.toThrow("1024-token output limit");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(onDiagnostic).toHaveBeenCalledWith(
    expect.objectContaining({
      stage: "result",
      httpStatus: 200,
      finishReason: "length",
      outcome: "incomplete",
      usage: { inputTokens: 20, outputTokens: 1024 },
    }),
  );
  expect(JSON.stringify(onDiagnostic.mock.calls)).not.toContain(
    "private partial text",
  );
});
it("accepts a complete JSON content result when a provider ignores the forced tool format", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [
          { finish_reason: "stop", message: { content: '{"ok":true}' } },
        ],
      }),
    ),
  );
  expect(await nebiusModel(config, fetcher).complete(request)).toEqual({
    ok: true,
  });
});
it("captures only when explicitly supplied a local callback and never includes credentials in the body", async () => {
  const capture = vi.fn();
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(response())));
  await nebiusModel(config, fetcher, capture).complete(request);
  expect(capture).toHaveBeenCalledTimes(1);
  expect(capture.mock.calls[0][0].request).toContain("Task");
  expect(capture.mock.calls[0][0].request).not.toContain(config.key);
});
it.each([
  undefined,
  { prompt_tokens: -1, completion_tokens: 2 },
  { prompt_tokens: 1.5, completion_tokens: 2 },
])("marks absent or invalid provider usage unknown", async (usage) => {
  const onUsage = vi.fn();
  await nebiusModel(
    config,
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ...response(), usage })),
      ),
  ).complete({ ...request, onUsage });
  expect(onUsage).toHaveBeenCalledWith(null);
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
