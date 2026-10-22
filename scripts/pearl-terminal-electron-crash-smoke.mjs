import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron } from "playwright";

if (process.platform !== "darwin") {
  process.stdout.write("SKIP: macOS Electron crash smoke is unavailable.\n");
  process.exit(0);
}

const root = await mkdtemp(join(tmpdir(), "scully-electron-crash-"));
const state = join(root, "state");
const project = join(root, "project");
const marker = join(project, "terminal.pid");
await mkdir(state);
await mkdir(project);
const command = `require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000)`;
const replies = [
  {
    content: "I will start the project process.",
    tool_calls: [
      {
        index: 0,
        id: "crash-terminal-call",
        type: "function",
        function: {
          name: "start_terminal",
          arguments: JSON.stringify({ command: "node", args: ["-e", command] }),
        },
      },
    ],
  },
  { content: "The project process is running." },
];
let responseIndex = 0;
const server = createServer(async (request, response) => {
  for await (const _chunk of request) {
    // The fixture reply does not depend on prompt content.
  }
  const reply = replies[responseIndex++];
  if (!reply) {
    response.writeHead(500).end();
    return;
  }
  const choice = {
    delta: reply,
    finish_reason: reply.tool_calls ? "tool_calls" : "stop",
  };
  response.setHeader("Content-Type", "text/event-stream");
  response.write(`data: ${JSON.stringify({ choices: [choice] })}\n\n`);
  response.end("data: [DONE]\n\n");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/v1/chat/completions`;
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
const until = async (predicate, label, timeout = 10_000) => {
  const deadline = Date.now() + timeout;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};
const isRunning = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

let app;
let commandPid;
try {
  app = await launch();
  let page = await app.firstWindow();
  await page.evaluate(async () =>
    window.scully.configureSession({
      key: "fixture-key",
      model: "fixture-model",
      outputTokens: 8192,
    }),
  );
  await page.getByRole("button", { name: "New chat" }).click();
  const chatId = (
    await page.evaluate(async () => (await window.scully.listPearlChats())[0])
  ).id;
  await app.evaluate(
    ({ dialog }, filePaths) => {
      dialog.showOpenDialog = () =>
        Promise.resolve({ canceled: false, filePaths });
    },
    [project],
  );
  await page.getByRole("button", { name: "Choose project" }).click();
  await page.getByRole("button", { name: "Allow project access" }).click();
  await page
    .getByRole("textbox", { name: "Message Pearl" })
    .fill("Run the project process.");
  await page.getByRole("button", { name: "Send message" }).click();
  const current = () =>
    page.evaluate((id) => window.scully.getPearlChat(id), chatId);
  await until(
    async () => (await current()).status === "awaiting_approval",
    "terminal approval",
  );
  await page.getByRole("button", { name: "Run once" }).click();
  await until(async () => {
    try {
      commandPid = Number(await readFile(marker, "utf8"));
      return Number.isSafeInteger(commandPid) && commandPid > 0;
    } catch {
      return false;
    }
  }, "terminal command to start");
  assert.equal(isRunning(commandPid), true);
  await until(
    async () => (await current()).terminals?.[0]?.status === "running",
    "Room terminal state",
  );

  app.process().kill("SIGKILL");
  app = undefined;
  await until(
    () => !isRunning(commandPid),
    "command to stop after Electron crash",
  );
  await until(
    async () =>
      (await readdir(project)).every(
        (name) => !name.startsWith(".scully-command-"),
      ),
    "terminal scratch to be removed",
  );

  app = await launch();
  page = await app.firstWindow();
  const restored = await page.evaluate(
    (id) => window.scully.getPearlChat(id),
    chatId,
  );
  assert.equal(restored.terminals[0].status, "interrupted");
  process.stdout.write(
    "PASS: forced Electron exit stops its terminal, cleans scratch, and restores interrupted state.\n",
  );
} finally {
  if (app) await app.close();
  if (commandPid && isRunning(commandPid)) process.kill(commandPid, "SIGKILL");
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
