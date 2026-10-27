import { _electron as electron } from "playwright";
import { createServer } from "node:http";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const root = await mkdtemp(join(tmpdir(), "scully-pearl-connected-"));
const state = join(root, "state");
const project = join(root, "project");
let pendingQuestionId;
await mkdir(state);
await mkdir(project);
await writeFile(join(project, "README.md"), "Disposable project\n");
const responses = [
  {
    content: "I can help with that. Who should be able to see the list?",
    tool: [
      "ask_user",
      {
        topic: "visibility",
        question: "Who can see the list?",
        options: ["Only me", "Friends"],
      },
    ],
  },
  { content: "A pineapple is a tropical fruit." },
  {
    content: "I linked your answer to the open visibility question.",
    tool: ["answer_question", () => ({ questionId: pendingQuestionId })],
  },
  {
    content:
      "I recorded Friends as your choice. I can plan sharing around that.",
  },
  {
    content:
      "Separate-device sign-in changes the storage and account design. I will keep it in scope.",
  },
  {
    content: "I will inspect the project:",
    tool: ["list_files", { path: "" }],
  },
  {
    content: "I found the project files. I will read the README.",
    tool: ["read_file", { path: "README.md" }],
  },
  {
    content: "I will add a small page without replacing existing work.",
    tool: [
      "create_file",
      {
        path: "index.html",
        content:
          "<!doctype html><title>Reading list</title><h1>Reading list</h1><form id=entry hidden style='display:block'><input id=title></form><p id=result>Waiting</p><button id=mark>Mark</button><button id=covered style='position:absolute;left:20px;top:250px;width:100px;height:30px'>Covered</button><div style='position:absolute;left:20px;top:250px;width:100px;height:30px;background:black'></div><script>document.querySelector('#title').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();document.querySelector('#entry').hidden=false;document.querySelector('#result').textContent=event.target.value}});document.querySelector('#mark').addEventListener('click',()=>document.querySelector('#result').textContent+=' clicked')</script><script src=https://example.com/blocked.js></script>\n",
      },
    ],
  },
  { content: "I created index.html. I have not run tests yet." },
  { content: "The page edit is still waiting for a check." },
  { content: "The rendered page has not been checked either." },
  {
    content: "I will record the result and its verification status.",
    tool: [
      "complete_work",
      {
        status: "unverified",
        summary: "I created index.html. I could not verify it with a command.",
      },
    ],
  },
  {
    content: "I will check the rendered page and its keyboard input.",
    tool: [
      "browser_check",
      {
        path: "index.html",
        steps: [
          { action: "fill", selector: "#title", value: "Dune" },
          { action: "press", selector: "#title", key: "Enter" },
          { action: "click", selector: "#mark" },
        ],
      },
    ],
  },
  {
    content:
      "The browser displayed Dune after Enter, but verification found defects.",
    tool: [
      "complete_work",
      {
        status: "unverified",
        summary:
          "Enter and clicking worked, but hidden-state and external-request checks failed.",
      },
    ],
  },
  {
    content: "I will check whether the covered control is reachable.",
    tool: [
      "browser_check",
      {
        path: "index.html",
        steps: [{ action: "click", selector: "#covered" }],
      },
    ],
  },
  {
    content: "The covered control could not be clicked.",
    tool: [
      "complete_work",
      {
        status: "unverified",
        summary: "The covered control could not be clicked.",
      },
    ],
  },
  {
    content: "I will inspect the page after its script changed.",
    tool: ["browser_check", { path: "index.html" }],
  },
  {
    content: "The browser reported a page error.",
    tool: [
      "complete_work",
      { status: "unverified", summary: "The browser reported a page error." },
    ],
  },
  {
    content: "I will check the linked file.",
    tool: ["browser_check", { path: "linked.html" }],
  },
  { content: "The linked file is unavailable to the browser." },
  {
    content: "I will locate the README text first.",
    tool: ["search_text", { path: "", query: "Disposable project" }],
  },
  {
    content: "I found the README line and will read the file before editing.",
    tool: ["read_file", { path: "README.md" }],
  },
  {
    content: "I will change only that line.",
    tool: [
      "apply_patch",
      {
        path: "README.md",
        expectedSha256: createHash("sha256")
          .update("Disposable project\n")
          .digest("hex"),
        edits: [{ oldText: "Disposable project", newText: "Pearl project" }],
      },
    ],
  },
  { content: "I changed the README line and preserved the rest." },
  {
    content: "I will record the result and its verification status.",
    tool: [
      "complete_work",
      {
        status: "unverified",
        summary: "The README edit is still unverified by a command check.",
      },
    ],
  },
  {
    content: "I can check the runtime version.",
    tool: ["run_command", { command: "node", args: ["--version"] }],
  },
  { content: "The command was denied, so I did not run it." },
  {
    content: "I can run the requested runtime check now.",
    tool: ["run_command", { command: "node", args: ["--version"] }],
  },
  { content: "The approved runtime check completed." },
  ...(process.platform === "darwin"
    ? [
        {
          content: "I will start an interactive project process.",
          tool: [
            "start_terminal",
            {
              command: "node",
              args: [
                "-e",
                "process.stdin.setRawMode(true);let line='';process.stdout.write('\\x1b[?1049h\\x1b[HINTERACTIVE VIEW\\nREADY:'+process.stdin.isTTY+','+process.stdout.isTTY+'\\n');process.stdin.on('data',x=>{const s=x.toString();if(s==='\\x1b[A')process.stdout.write('ARROW-UP\\n');else if(s==='\\r'){process.stdout.write('ECHO:'+line+'\\n');line=''}else line+=s});process.on('SIGWINCH',()=>process.stdout.write('SIZE:'+process.stdout.columns+'x'+process.stdout.rows+'\\n'))",
              ],
            },
          ],
        },
        { content: "The terminal is available in this chat." },
      ]
    : []),
  {
    content: "I will read the current README before proposing both changes.",
    tool: ["read_file", { path: "README.md" }],
  },
  { transportFailure: true },
  {
    content: "I have prepared a two-file change for review.",
    tool: [
      "edit_files",
      {
        files: [
          {
            path: "README.md",
            operation: "patch",
            expectedSha256: createHash("sha256")
              .update("Pearl project\n")
              .digest("hex"),
            edits: [{ oldText: "Pearl project", newText: "Reviewed project" }],
          },
          {
            path: "notes.txt",
            operation: "create",
            content: "Both files reviewed.\n",
          },
        ],
      },
    ],
  },
  {
    content: "I will record that the two-file change is not command-verified.",
    tool: [
      "complete_work",
      {
        status: "unverified",
        summary:
          "Both reviewed files were changed; command verification remains open.",
      },
    ],
  },
  { content: "The chat and project are still available after restart." },
];
const requests = [];
let nextResponse = 0;
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  requests.push(body);
  const fixture = responses[nextResponse++];
  if (!fixture) {
    response.writeHead(500).end();
    return;
  }
  if (fixture.transportFailure) {
    response.destroy();
    return;
  }
  const toolCall = fixture.tool && {
    index: 0,
    id: `call-${nextResponse}`,
    type: "function",
    function: {
      name: fixture.tool[0],
      arguments: JSON.stringify(
        typeof fixture.tool[1] === "function"
          ? fixture.tool[1]()
          : fixture.tool[1],
      ),
    },
  };
  if (body.stream) {
    response.setHeader("Content-Type", "text/event-stream");
    response.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content: fixture.content, ...(toolCall ? { tool_calls: [toolCall] } : {}) }, finish_reason: fixture.tool ? "tool_calls" : "stop" }] })}\n\n`,
    );
    response.end("data: [DONE]\n\n");
  } else {
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: fixture.tool ? "tool_calls" : "stop",
            message: {
              content: fixture.content,
              ...(toolCall ? { tool_calls: [toolCall] } : {}),
            },
          },
        ],
      }),
    );
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const endpoint = `http://127.0.0.1:${address.port}/v1/chat/completions`;
let app;
let page;
let chatId;
const launch = () =>
  electron.launch({
    args: ["."],
    env: {
      ...process.env,
      SCULLY_TEST_DATA: state,
      SCULLY_PEARL_TEST_ENDPOINT: endpoint,
    },
    timeout: 30000,
  });
const current = () =>
  page.evaluate(async (id) => window.scully.getPearlChat(id), chatId);
async function waitUntil(predicate, label) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const chat = await current();
    if (predicate(chat)) return chat;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
async function send(text) {
  const before = (await current()).messages.length;
  await page.getByRole("textbox", { name: "Message Pearl" }).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
  await waitUntil((chat) => chat.messages.length > before, "saved user turn");
  return waitUntil((chat) => chat.status !== "running", "Pearl turn");
}

try {
  app = await launch();
  page = await app.firstWindow();
  await page
    .getByRole("heading", { name: "What can I help you with?" })
    .waitFor();
  await page.evaluate(async () =>
    window.scully.configureSession({
      key: "fixture-key",
      model: "fixture-model",
      outputTokens: 8192,
    }),
  );
  await page.getByRole("button", { name: "New chat" }).click();
  chatId = (
    await page.evaluate(async () => (await window.scully.listPearlChats())[0])
  ).id;
  let chat = await send("Help me plan a small reading list.");
  assert.equal(chat.questions[0].status, "pending");
  pendingQuestionId = chat.questions[0].id;
  await page.getByRole("region", { name: "Pearl question" }).waitFor();
  assert.equal(
    await page.getByRole("region", { name: "Pearl question" }).count(),
    1,
  );
  chat = await send("What is a pineapple?");
  assert.equal(chat.questions[0].status, "pending");
  assert.equal(chat.messages.at(-1).text, "A pineapple is a tropical fruit.");
  const pineappleReply = page
    .locator(".pearl-message.assistant")
    .filter({ hasText: "A pineapple is a tropical fruit." });
  await pineappleReply.locator(".pearl-message-bubble").waitFor();
  assert.equal(
    await pineappleReply.locator(".pearl-message-avatar").count(),
    1,
  );
  assert.equal(await pineappleReply.locator("time[datetime]").count(), 1);
  const colors = await pineappleReply.evaluate((reply) => {
    const user = document.querySelector(".pearl-message.user");
    return {
      pearlBubble: getComputedStyle(
        reply.querySelector(".pearl-message-bubble"),
      ).backgroundColor,
      userBubble: getComputedStyle(user.querySelector(".pearl-message-bubble"))
        .backgroundColor,
      pearlOutline: getComputedStyle(
        reply.querySelector(".pearl-message-avatar"),
      ).borderTopColor,
      userOutline: getComputedStyle(user.querySelector(".pearl-message-bubble"))
        .borderTopColor,
    };
  });
  assert.notEqual(colors.pearlBubble, colors.userBubble);
  assert.notEqual(colors.pearlOutline, colors.userOutline);
  chat = await send("Friends should see it.");
  assert.equal(chat.questions[0].status, "answered");
  assert.equal(chat.questions[0].answer, "Friends should see it.");
  chat = await send(
    "Now add sign-in on separate devices and sharing in the first release.",
  );
  assert.equal(chat.status, "idle");
  await app.evaluate(
    ({ dialog }, filePaths) => {
      dialog.showOpenDialog = () =>
        Promise.resolve({ canceled: false, filePaths });
    },
    [project],
  );
  await page.getByRole("button", { name: "Choose project" }).click();
  await page.getByRole("button", { name: "Allow project access" }).click();
  chat = await send(
    "Inspect this project and create the first page without overwriting my README.",
  );
  assert.equal(chat.status, "idle");
  assert.equal(chat.messages.at(-1).completion.status, "unverified");
  assert(
    requests.some(
      (request) =>
        request.tool_choice?.function?.name === "complete_work" &&
        request.tools?.length === 1 &&
        request.tools[0]?.function?.name === "complete_work",
    ),
    `The desktop must require a completion action after a plain reply following a file edit: ${JSON.stringify(requests.slice(-5).map((request) => ({ toolChoice: request.tool_choice, tools: request.tools?.map((tool) => tool.function?.name) })))}`,
  );
  await page.getByText(/Work status: not checked/).waitFor();
  assert.equal(
    await page
      .locator(".pearl-message.assistant")
      .filter({ hasText: "I will inspect the project:" })
      .count(),
    0,
  );
  const codingActivity = page.locator(".pearl-activity").last();
  await codingActivity.locator(":scope > summary").click();
  await codingActivity.getByText("I will inspect the project:").waitFor();
  assert.equal(
    (await codingActivity.locator(".pearl-activity-action").count()) >= 3,
    true,
  );
  await page
    .getByText(/No command checks completed for these changes/)
    .waitFor();
  assert.match(
    await readFile(join(project, "index.html"), "utf8"),
    /Reading list/,
  );
  assert.equal(
    await readFile(join(project, "README.md"), "utf8"),
    "Disposable project\n",
  );
  chat = await send("Check the page in the browser using the keyboard.");
  assert.equal(chat.status, "idle");
  assert.equal(chat.messages.at(-1).completion.status, "unverified");
  const browserObservation = [...chat.messages]
    .reverse()
    .find(
      (message) =>
        message.role === "tool" && message.toolName === "browser_check",
    );
  assert(browserObservation);
  assert.match(JSON.parse(browserObservation.text).visibleText, /Dune clicked/);
  assert.equal(JSON.parse(browserObservation.text).completedSteps, 3);
  assert.deepEqual(JSON.parse(browserObservation.text).hiddenViolations, [
    { tag: "form", id: "entry" },
  ]);
  assert(JSON.parse(browserObservation.text).blockedExternalRequests > 0);
  chat = await send("Check whether the covered control is reachable.");
  assert.equal(chat.messages.at(-1).completion.status, "unverified");
  const coveredObservation = [...chat.messages]
    .reverse()
    .find(
      (message) =>
        message.role === "tool" && message.toolName === "browser_check",
    );
  assert(coveredObservation);
  assert.match(
    coveredObservation.text,
    /Step 1 failed: Browser target is covered/,
  );
  await writeFile(
    join(project, "index.html"),
    `${await readFile(join(project, "index.html"), "utf8")}<script>throw new Error('broken page')</script>`,
  );
  chat = await send("Check the page for script errors.");
  assert.equal(chat.messages.at(-1).completion.status, "unverified");
  const errorObservation = [...chat.messages]
    .reverse()
    .find(
      (message) =>
        message.role === "tool" && message.toolName === "browser_check",
    );
  assert(errorObservation);
  assert.match(
    JSON.parse(errorObservation.text).errors.join(" "),
    /broken page/,
  );
  await writeFile(join(root, "outside.html"), "<p>Private outside page</p>");
  await symlink(join(root, "outside.html"), join(project, "linked.html"));
  chat = await send("Check the linked HTML file.");
  const linkedObservation = [...chat.messages]
    .reverse()
    .find(
      (message) =>
        message.role === "tool" && message.toolName === "browser_check",
    );
  assert(linkedObservation);
  assert.match(linkedObservation.text, /Symlink in project path/);
  chat = await send("Change only the README heading to Pearl project.");
  assert.equal(chat.status, "idle");
  assert.equal(
    await readFile(join(project, "README.md"), "utf8"),
    "Pearl project\n",
  );
  const activity = page.locator("details.pearl-activity").last();
  await activity.locator("summary").first().click();
  const patchAction = activity
    .locator("details.pearl-activity-action")
    .filter({ hasText: "Apply patch" })
    .last();
  await patchAction.locator("summary").first().click();
  await patchAction.getByText("Result", { exact: true }).click();
  assert.match(
    await patchAction
      .locator("details.pearl-activity-detail[open] pre")
      .last()
      .textContent(),
    /-Disposable project[\s\S]*\+Pearl project/,
  );
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/pearl-activity.png" });
  const beforeCommand = (await current()).messages.length;
  await page
    .getByRole("textbox", { name: "Message Pearl" })
    .fill("Check the runtime version.");
  await page.getByRole("button", { name: "Send message" }).click();
  await waitUntil(
    (item) =>
      item.messages.length > beforeCommand &&
      item.status === "awaiting_approval",
    "command review",
  );
  await page.getByRole("button", { name: "Deny" }).click();
  chat = await waitUntil(
    (item) => item.status === "idle",
    "denied command reply",
  );
  assert(
    chat.messages.some(
      (message) => message.role === "tool" && message.text.includes("denied"),
    ),
  );
  const beforeApprovedCommand = chat.messages.length;
  await page
    .getByRole("textbox", { name: "Message Pearl" })
    .fill("Please run the runtime version check now.");
  await page.getByRole("button", { name: "Send message" }).click();
  await waitUntil(
    (item) =>
      item.messages.length > beforeApprovedCommand &&
      item.status === "awaiting_approval",
    "approved command review",
  );
  await page.getByRole("button", { name: "Run once" }).click();
  chat = await waitUntil(
    (item) => item.status === "idle",
    "approved command reply",
  );
  assert(
    chat.messages.some((message) => {
      if (message.role !== "tool" || message.toolName !== "run_command")
        return false;
      try {
        const result = JSON.parse(message.text);
        return result.exitCode === 0 && /^v\d+/.test(result.stdout);
      } catch {
        return false;
      }
    }),
  );
  assert(
    requests.some((request) =>
      request.messages.some(
        (message) => message.role === "tool" && message.tool_call_id,
      ),
    ),
  );
  assert(
    requests.some((request) =>
      request.messages.some(
        (message) =>
          typeof message.content === "string" &&
          message.content.includes("Answer to question"),
      ),
    ),
  );
  if (process.platform === "darwin") {
    const beforeTerminal = chat.messages.length;
    await page
      .getByRole("textbox", { name: "Message Pearl" })
      .fill("Start an interactive project process.");
    await page.getByRole("button", { name: "Send message" }).click();
    await waitUntil(
      (item) =>
        item.messages.length > beforeTerminal &&
        item.status === "awaiting_approval",
      "terminal review",
    );
    await page.getByRole("button", { name: "Run once" }).click();
    chat = await waitUntil(
      (item) =>
        item.status === "idle" && item.terminals?.[0]?.output.includes("READY"),
      "terminal output",
    );
    const terminal = chat.terminals[0];
    const input = page.locator(".pearl-terminal-screen .xterm-helper-textarea");
    await input.waitFor();
    assert(chat.terminals[0].output.includes("READY:true,true"));
    assert.equal(
      await page
        .locator(".pearl-terminal-screen .xterm-viewport")
        .evaluate((element) => getComputedStyle(element).scrollbarWidth),
      "none",
    );
    await page.screenshot({ path: "test-results/pearl-terminal.png" });
    await page.locator(".pearl-terminal-screen").click();
    await page.keyboard.press("ArrowUp");
    await waitUntil(
      (item) => item.terminals?.[0]?.output.includes("ARROW-UP"),
      "terminal arrow key",
    );
    await page.keyboard.type("hello");
    await page.keyboard.press("Enter");
    await waitUntil(
      (item) => item.terminals?.[0]?.output.includes("ECHO:hello"),
      "terminal input",
    );
    const priorSizes = (
      (await current()).terminals[0].output.match(/SIZE:/g) || []
    ).length;
    await page
      .locator(".pearl-terminal-screen")
      .evaluate((element) => (element.style.height = "450px"));
    await waitUntil(
      (item) =>
        (item.terminals?.[0]?.output.match(/SIZE:/g) || []).length > priorSizes,
      "terminal resize",
    );
    const terminalCard = page.locator("details.pearl-terminal");
    await terminalCard.locator("summary").click();
    assert.equal(await terminalCard.evaluate((element) => element.open), false);
    await page.evaluate(
      async ([id, terminalId]) => {
        await window.scully.sendPearlTerminalInput(id, terminalId, "more");
        await window.scully.sendPearlTerminalInput(id, terminalId, "\r");
      },
      [chatId, terminal.id],
    );
    await waitUntil(
      (item) => item.terminals?.[0]?.output.includes("ECHO:more"),
      "collapsed terminal output",
    );
    assert.equal(await terminalCard.evaluate((element) => element.open), false);
    await terminalCard.locator("summary").click();
    await page.getByRole("button", { name: "Stop terminal" }).click();
    await waitUntil(
      (item) => item.terminals?.[0]?.status === "stopped",
      "terminal stop",
    );
    assert.equal((await current()).terminals[0].id, terminal.id);
  }
  const beforeBatch = (await current()).messages.length;
  await page
    .getByRole("textbox", { name: "Message Pearl" })
    .fill("Update the README and add a notes file together.");
  await page.getByRole("button", { name: "Send message" }).click();
  chat = await waitUntil(
    (item) => item.status === "failed",
    "interrupted provider request",
  );
  assert.match(chat.error, /Nebius connection failed/);
  assert.equal(
    chat.messages
      .slice(beforeBatch)
      .filter(
        (message) =>
          message.role === "tool" && message.toolName === "read_file",
      ).length,
    1,
  );
  await page.getByRole("button", { name: "Continue" }).click();
  chat = await waitUntil(
    (item) =>
      item.messages.length > beforeBatch && item.status === "awaiting_approval",
    "file transaction review",
  );
  const review = page.getByRole("region", { name: "File transaction review" });
  await review.getByText(/Review 2 file changes/).waitFor();
  assert.match(
    await review.locator("pre").textContent(),
    /-Pearl project[\s\S]*\+Reviewed project[\s\S]*\+Both files reviewed/,
  );
  assert.equal(
    await readFile(join(project, "README.md"), "utf8"),
    "Pearl project\n",
  );
  await assert.rejects(readFile(join(project, "notes.txt"), "utf8"));
  await review.getByRole("button", { name: "Apply changes" }).click();
  chat = await waitUntil(
    (item) => item.status === "idle",
    "file transaction result",
  );
  assert.equal(
    await readFile(join(project, "README.md"), "utf8"),
    "Reviewed project\n",
  );
  assert.equal(
    await readFile(join(project, "notes.txt"), "utf8"),
    "Both files reviewed.\n",
  );
  assert.equal(chat.messages.at(-1).evidence.filesWritten, 2);
  assert.equal(
    chat.messages
      .slice(beforeBatch)
      .filter(
        (message) =>
          message.role === "tool" && message.toolName === "read_file",
      ).length,
    1,
  );
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.evaluate(async () =>
    window.scully.configureSession({
      key: "fixture-key",
      model: "fixture-model",
      outputTokens: 8192,
    }),
  );
  await page
    .getByRole("button", {
      name: "Help me plan a small reading list.",
      exact: true,
    })
    .click();
  assert((await current()).project.approved);
  assert.equal(
    await readFile(join(project, "notes.txt"), "utf8"),
    "Both files reviewed.\n",
  );
  if (process.platform === "darwin") {
    assert.equal((await current()).terminals[0].status, "stopped");
    assert.match((await current()).terminals[0].output, /ECHO:hello/);
  }
  const restoredActivity = page
    .locator("details.pearl-activity")
    .filter({ hasText: "Apply patch" })
    .last();
  await restoredActivity.waitFor();
  assert.equal(await restoredActivity.count(), 1);
  assert.equal(
    await restoredActivity.evaluate((element) => element.open),
    false,
  );
  chat = await send("Are we still in the same project?");
  assert.equal(chat.status, "idle");
  assert.equal(requests.length, responses.length);
  console.log(
    "PASS: connected desktop fixture covers digression, linked answer, changed scope, browser input, visible patch, provider disconnect and Continue, reviewed file transaction, command denial, isolated approval and restart.",
  );
} finally {
  if (app) await app.close();
  server.close();
  await rm(root, { recursive: true, force: true });
}
