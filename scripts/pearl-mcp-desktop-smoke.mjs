import { _electron as electron } from "playwright";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const root = await mkdtemp(join(tmpdir(), "scully-pearl-mcp-"));
const state = join(root, "state");
await mkdir(state);
const modelReplies = [
  { tool: ["mcp_list_tools", {}] },
  {
    tool: [
      "mcp_call_tool",
      { name: "sample_lookup", arguments: { term: "sample" } },
    ],
  },
  { content: "The remote server found the sample." },
];
let modelIndex = 0;
const remoteCalls = [];
const server = createServer(async (request, response) => {
  if (request.method === "GET") {
    response.writeHead(405).end();
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (request.url === "/mcp") {
    if (body.method === "notifications/initialized") {
      response.writeHead(202).end();
      return;
    }
    let result;
    if (body.method === "initialize")
      result = {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "fixture", version: "1.0.0" },
      };
    else if (body.method === "tools/list")
      result = {
        tools: [
          {
            name: "sample_lookup",
            description: "Find a sample",
            inputSchema: {
              type: "object",
              properties: { term: { type: "string" } },
            },
          },
        ],
      };
    else if (body.method === "tools/call") {
      remoteCalls.push(body.params);
      result = { content: [{ type: "text", text: "found" }] };
    }
    const output =
      body.method === "server/discover"
        ? {
            jsonrpc: "2.0",
            id: body.id,
            error: { code: -32601, message: "Method not found" },
          }
        : { jsonrpc: "2.0", id: body.id, result };
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify(output));
    return;
  }
  const fixture = modelReplies[modelIndex++];
  if (!fixture) {
    response.writeHead(500).end();
    return;
  }
  const toolCall = fixture.tool && {
    index: 0,
    id: `mcp-call-${modelIndex}`,
    type: "function",
    function: {
      name: fixture.tool[0],
      arguments: JSON.stringify(fixture.tool[1]),
    },
  };
  const content = fixture.content || "";
  response.writeHead(200, {
    "content-type": body.stream ? "text/event-stream" : "application/json",
  });
  if (body.stream) {
    response.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content, ...(toolCall ? { tool_calls: [toolCall] } : {}) }, finish_reason: fixture.tool ? "tool_calls" : "stop" }] })}\n\n`,
    );
    response.end("data: [DONE]\n\n");
  } else {
    response.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: fixture.tool ? "tool_calls" : "stop",
            message: {
              content,
              ...(toolCall ? { tool_calls: [toolCall] } : {}),
            },
          },
        ],
      }),
    );
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const endpoint = `http://127.0.0.1:${server.address().port}`;
let app;
try {
  app = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      SCULLY_TEST_DATA: state,
      SCULLY_PEARL_TEST_ENDPOINT: `${endpoint}/v1/chat/completions`,
      SCULLY_PEARL_MCP_TEST_ENDPOINT: endpoint,
    },
    timeout: 30_000,
  });
  const page = await app.firstWindow();
  await page
    .getByRole("heading", { name: "What can I help you with?" })
    .waitFor();
  await page.evaluate(() =>
    window.scully.configureSession({
      key: "fixture-key",
      model: "fixture-model",
      outputTokens: 8192,
    }),
  );
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "App & connection" }).click();
  await page.getByLabel("Server endpoint").fill("https://example.com/mcp");
  await page.getByLabel("Bearer token (optional)").fill("fixture-token");
  await page.getByRole("button", { name: "Connect remote server" }).click();
  await page.getByText("Remote MCP connected with 1 tools.").waitFor();
  await page.getByText("Available tools (1)").click();
  await page.getByText("sample_lookup").waitFor();
  await page.getByRole("button", { name: "Chats" }).click();
  await page.getByRole("button", { name: "New chat" }).click();
  const chatId = (await page.evaluate(() => window.scully.listPearlChats()))[0]
    .id;
  await page
    .getByRole("textbox", { name: "Message Pearl" })
    .fill("Look up the sample with the remote server");
  await page.getByRole("button", { name: "Send message" }).click();
  await page
    .getByRole("region", { name: "Remote MCP tool approval" })
    .waitFor();
  assert.equal(remoteCalls.length, 0);
  await page.getByRole("button", { name: "Call once" }).click();
  await page.getByText("The remote server found the sample.").waitFor();
  assert.deepEqual(remoteCalls, [
    { name: "sample_lookup", arguments: { term: "sample" } },
  ]);
  const chat = await page.evaluate(
    (id) => window.scully.getPearlChat(id),
    chatId,
  );
  assert.equal(chat.status, "idle");
  assert.equal(
    chat.messages.at(-1).text,
    "The remote server found the sample.",
  );
  console.log("Pearl remote MCP desktop smoke passed");
} finally {
  await app?.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
