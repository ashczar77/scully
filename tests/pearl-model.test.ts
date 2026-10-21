// @vitest-environment node
import { expect, it, vi } from "vitest";
import { nebiusPearlModel } from "../src/engine/pearl-model";

const input = {
  key: "secret-test-key",
  model: "nvidia/nemotron-3-super-120b-a12b",
  system: "You are Pearl.",
  messages: [
    { id: "u1", role: "user" as const, text: "Read the file", at: "now" },
    {
      id: "a1",
      role: "assistant" as const,
      text: "",
      at: "now",
      toolCallId: "call-1",
      toolName: "read_file",
      arguments: '{"path":"a.txt"}',
    },
    {
      id: "t1",
      role: "tool" as const,
      text: "file content",
      at: "now",
      toolCallId: "call-1",
      toolName: "read_file",
    },
  ],
};

it("sends native roles and lets Nebius choose a reply or tool", async () => {
  const fetcher = vi.fn(async (_url: string, request: RequestInit) => {
    const body = JSON.parse(String(request.body));
    expect(body.tool_choice).toBe("auto");
    expect(body.temperature).toBe(0.2);
    expect(body.store).toBe(false);
    expect(body.messages.map((item: { role: string }) => item.role)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
    ]);
    expect(body.messages[2].tool_calls[0].id).toBe("call-1");
    expect(body.messages[3].tool_call_id).toBe("call-1");
    expect(JSON.stringify(body)).not.toContain("secret-test-key");
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: { content: "Here is what I found." },
          },
        ],
      }),
      { status: 200 },
    );
  });
  const model = nebiusPearlModel(fetcher as typeof fetch);
  expect(await model.complete(input)).toEqual({
    kind: "reply",
    text: "Here is what I found.",
  });
  expect(fetcher).toHaveBeenCalledOnce();
});

it("replays a structured action batch as one assistant message followed by its observations", async () => {
  const fetcher = vi.fn(async (_url: string, request: RequestInit) => {
    const body = JSON.parse(String(request.body));
    const history = body.messages.slice(1);
    expect(history.map((item: { role: string }) => item.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "tool",
    ]);
    expect(
      history[1].tool_calls.map((call: { id: string }) => call.id),
    ).toEqual(["read-1", "map-1"]);
    expect(history[2].tool_call_id).toBe("read-1");
    expect(history[3].tool_call_id).toBe("map-1");
    return new Response(
      JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: "Done." } }],
      }),
      { status: 200 },
    );
  });
  await nebiusPearlModel(fetcher as typeof fetch).complete({
    ...input,
    messages: [
      input.messages[0],
      {
        id: "batch",
        role: "assistant",
        text: "",
        at: "now",
        toolCalls: [
          { id: "read-1", name: "read_file", arguments: '{"path":"a.txt"}' },
          { id: "map-1", name: "project_map", arguments: "{}" },
        ],
      },
      {
        id: "read-result",
        role: "tool",
        text: "file content",
        at: "now",
        toolCallId: "read-1",
        toolName: "read_file",
      },
      {
        id: "map-result",
        role: "tool",
        text: "map",
        at: "now",
        toolCallId: "map-1",
        toolName: "project_map",
      },
    ],
  });
});

it("uses the configured output limit for a large coding action", async () => {
  const fetcher = vi.fn(async (_url: string, request: RequestInit) => {
    expect(JSON.parse(String(request.body)).max_tokens).toBe(16384);
    return new Response(
      JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: "Ready." } }],
      }),
      { status: 200 },
    );
  });
  await nebiusPearlModel(fetcher as typeof fetch).complete({
    ...input,
    outputTokens: 16384,
  });
});

it("rejects incomplete provider output without claiming a reply", async () => {
  const model = nebiusPearlModel(
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            { finish_reason: "length", message: { content: "partial" } },
          ],
        }),
        { status: 200 },
      ),
  );
  await expect(model.complete(input)).rejects.toThrow("incomplete (length)");
});

it("treats a provider agent failure embedded in a successful HTTP reply as failure", async () => {
  const model = nebiusPearlModel(
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content:
                  "[ERROR: Agent failed (Function process_single_item_agent timed out after 90.0 seconds), API failed (API request returned None after all retries)]",
              },
            },
          ],
        }),
        { status: 200 },
      ),
  );
  await expect(model.complete(input)).rejects.toThrow(
    "Provider reported an internal failure",
  );
});

it("does not present serialized action markup as a completed assistant reply", async () => {
  const model = nebiusPearlModel(
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content:
                  'I will run the check. <｜DSML｜tool_calls><｜DSML｜invoke name="run_command"><｜DSML｜parameter name="command">node</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜tool_calls>',
              },
            },
          ],
        }),
        { status: 200 },
      ),
  );
  await expect(model.complete(input)).rejects.toThrow(
    "Provider emitted action markup as text",
  );
  await expect(model.complete({ ...input, allowedTools: [] })).rejects.toThrow(
    "Provider emitted action markup as text",
  );
});

it("classifies a provider context rejection without exposing its error body", async () => {
  const model = nebiusPearlModel(
    async () =>
      new Response(
        JSON.stringify({
          error: {
            message: "Maximum context length exceeded in private prompt text",
          },
        }),
        { status: 400 },
      ),
  );
  await expect(model.complete(input)).rejects.toThrow(
    "Provider request failed (400; context)",
  );
  await expect(model.complete(input)).rejects.not.toThrow("private prompt");
});

it("reads a single proposed tool call", async () => {
  const model = nebiusPearlModel(
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "next",
                    function: { name: "list_files", arguments: '{"path":""}' },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
  );
  expect(await model.complete(input)).toEqual({
    kind: "tool",
    text: "",
    call: { id: "next", name: "list_files", arguments: '{"path":""}' },
  });
});

it("preserves every structured action so the runtime can review each one", async () => {
  const model = nebiusPearlModel(
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "first",
                    function: {
                      name: "read_file",
                      arguments: '{"path":"a.txt"}',
                    },
                  },
                  {
                    id: "second",
                    function: {
                      name: "run_command",
                      arguments: '{"command":"node","args":["--version"]}',
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
  );
  await expect(model.complete(input)).resolves.toEqual({
    kind: "actions",
    text: "",
    calls: [
      { id: "first", name: "read_file", arguments: '{"path":"a.txt"}' },
      {
        id: "second",
        name: "run_command",
        arguments: '{"command":"node","args":["--version"]}',
      },
    ],
  });
});

it("offers only tools allowed by the current chat state", async () => {
  const fetcher = vi.fn(async (_url: string, request: RequestInit) => {
    const body = JSON.parse(String(request.body));
    expect(body.tool_choice).toBe("none");
    expect(body.tools).toBeUndefined();
    return new Response(
      JSON.stringify({
        choices: [
          { finish_reason: "stop", message: { content: "Progress saved." } },
        ],
      }),
      { status: 200 },
    );
  });
  const model = nebiusPearlModel(fetcher as typeof fetch);
  expect(await model.complete({ ...input, allowedTools: [] })).toEqual({
    kind: "reply",
    text: "Progress saved.",
  });
});

it("streams reply text without accepting a cut-off provider response", async () => {
  const seen: string[] = [];
  const fetcher = vi.fn(async (_url: string, request: RequestInit) => {
    expect(JSON.parse(String(request.body)).stream).toBe(true);
    return new Response(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode(
              'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
            ),
          );
          controller.enqueue(
            encoder.encode(
              'data: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
            ),
          );
          controller.close();
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
  });
  const model = nebiusPearlModel(fetcher as typeof fetch);
  await expect(
    model.complete({ ...input, onDelta: (part) => seen.push(part) }),
  ).resolves.toEqual({ kind: "reply", text: "Hello world" });
  expect(seen).toEqual(["Hello", " world"]);

  const cutOff = nebiusPearlModel(
    async () =>
      new Response(
        'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":null}]}\n\n',
        { status: 200 },
      ),
  );
  await expect(
    cutOff.complete({ ...input, onDelta: () => {} }),
  ).rejects.toThrow("incomplete");
});

it("reassembles streamed tool arguments and preserves parallel actions", async () => {
  const chunks = [
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"next","function":{"name":"read_file","arguments":"{\\\"path\\\":"}}]},"finish_reason":null}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\\"a.txt\\\"}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n',
  ];
  const model = nebiusPearlModel(
    async () => new Response(chunks.join(""), { status: 200 }),
  );
  await expect(
    model.complete({ ...input, onDelta: () => {} }),
  ).resolves.toEqual({
    kind: "tool",
    text: "",
    call: { id: "next", name: "read_file", arguments: '{"path":"a.txt"}' },
  });

  const parallel = nebiusPearlModel(
    async () =>
      new Response(
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"one","function":{"name":"read_file","arguments":"{}"}},{"index":1,"id":"two","function":{"name":"run_command","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n',
        { status: 200 },
      ),
  );
  await expect(
    parallel.complete({ ...input, onDelta: () => {} }),
  ).resolves.toEqual({
    kind: "actions",
    text: "",
    calls: [
      { id: "one", name: "read_file", arguments: "{}" },
      { id: "two", name: "run_command", arguments: "{}" },
    ],
  });
});
