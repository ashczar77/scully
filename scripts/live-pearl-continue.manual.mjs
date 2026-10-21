import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { safePreviewCommand, safeTestCommand } from "./live-test-command.mjs";
import { liveRequestLimit } from "./live-test-budget.mjs";
if (process.env.SCULLY_LIVE_TEST !== "1" || !process.env.NEBIUS_API_KEY)
  throw new Error("Live test opt-in and key required");
const record = JSON.parse(
  await readFile(
    process.env.SCULLY_LIVE_RECORD || "test-results/live-pearl-chat.json",
    "utf8",
  ),
);
const sourceProject = resolve(record.projectSnapshot);
if (!sourceProject.startsWith(resolve("test-results") + "/live-pearl-project-"))
  throw new Error("Only a saved disposable live project can be resumed");
const root = await mkdtemp(join(tmpdir(), "scully-live-continue-"));
const state = join(root, "state"),
  project = join(root, "project");
await mkdir(state);
await cp(record.stateSnapshot, join(state, "workspace.sqlite"));
await cp(sourceProject, project, { recursive: true });
const model = "zai-org/GLM-5.3-Flash";
let priorRequests = 0;
const launch = () =>
  electron.launch({
    args: ["."],
    env: {
      ...process.env,
      SCULLY_TEST_DATA: state,
      SCULLY_LIVE_MAX_REQUESTS: String(
        Math.max(
          0,
          liveRequestLimit(process.env.SCULLY_LIVE_MAX_REQUESTS) -
            priorRequests,
        ),
      ),
    },
  });
let app = await launch();
let page = await app.firstWindow();
const recovery = {};
let chatId;
const started = Date.now();
try {
  await page.evaluate(
    async ({ key, model }) =>
      window.scully.configureSession({ key, model, outputTokens: 16384 }),
    { key: process.env.NEBIUS_API_KEY, model },
  );
  const summary = await page.evaluate(
    async () => (await window.scully.listPearlChats())[0],
  );
  chatId = summary.id;
  await page.getByRole("button", { name: summary.title }).click();
  const current = () =>
    page.evaluate(async (id) => window.scully.getPearlChat(id), chatId);
  const old = await current();
  if (old.status === "awaiting_approval")
    await page.getByRole("button", { name: "Deny", exact: true }).click();
  await app.evaluate(
    ({ dialog }, filePaths) => {
      dialog.showOpenDialog = () =>
        Promise.resolve({ canceled: false, filePaths });
    },
    [project],
  );
  await page
    .getByRole("button", {
      name: old.project ? old.project.path.split("/").at(-1) : "Choose project",
    })
    .click();
  await page.getByRole("button", { name: "Allow project access" }).click();
  const prompt =
    process.env.SCULLY_LIVE_PROMPT ||
    "Continue the implementation against every current first-release requirement in our conversation. Inspect the preserved files and test results, repair remaining defects, run the complete tests and verify the actual app in the browser. Keep working until the requested behavior is implemented and checked, or explain a specific blocker. Preserve the chosen stack. Do not call unverified or unfinished work done.";
  const previous = (await current()).messages.length;
  await page.getByRole("textbox", { name: "Message Pearl" }).fill(prompt);
  await page.getByRole("button", { name: "Send message" }).click();
  let count = previous,
    continues = 0;
  while (Date.now() - started < 3_600_000) {
    const chat = await current();
    if (chat.messages.length !== count) {
      count = chat.messages.length;
      await writeFile(
        "test-results/live-pearl-progress.json",
        JSON.stringify(
          { project, state, chat, model, label: "continuation" },
          null,
          2,
        ),
        { mode: 0o600 },
      );
      process.stdout.write(
        `${chat.status}: ${chat.messages.at(-1)?.toolName || chat.messages.at(-1)?.role}, ${count} messages\n`,
      );
    }
    if (chat.status === "awaiting_approval") {
      const call = chat.pendingTool,
        args = JSON.parse(call.arguments);
      const allowed =
        call.name === "preview_app"
          ? safePreviewCommand(args)
          : safeTestCommand(args) || safePreviewCommand(args);
      process.stdout.write(`review ${call.name} ${JSON.stringify(args)}\n`);
      await page
        .getByRole("button", {
          name: allowed ? "Run once" : "Deny",
          exact: true,
        })
        .click();
    } else if (
      chat.status === "paused" &&
      !["repeated_action", "no_progress"].includes(chat.pauseKind) &&
      continues++ < 8
    ) {
      await page.getByRole("button", { name: "Continue", exact: true }).click();
    } else if (chat.status !== "running" && chat.messages.length > previous) {
      if (chat.status !== "idle") throw new Error(chat.error || chat.status);
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const finished = await current();
  assert.equal(
    finished.status,
    "idle",
    "Continuation did not finish within its time budget",
  );
  const completion = finished.messages
    .slice(previous)
    .filter((message) => message.role === "assistant" && message.completion)
    .at(-1)?.completion;
  assert.equal(
    completion?.status,
    "done",
    "Continuation did not finish the requested repair and checks",
  );
  const countRequests = async () =>
    (
      await page.evaluate(async () => (await window.scully.metrics()).events)
    ).filter((event) => event.operation === "model.request").length;
  priorRequests = await countRequests();
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  const restored = await current();
  assert.equal(restored.status, "idle");
  assert.equal(restored.messages.length, finished.messages.length);
  assert.equal(restored.project?.approved, true);
  recovery.restart = true;
  await page.getByRole("button", { name: restored.title }).click();
  await page.evaluate(
    async ({ model }) =>
      window.scully.configureSession({
        key: "invalid-key-for-recovery-test",
        model,
        outputTokens: 16384,
      }),
    { model },
  );
  const recoveryPrompt =
    "Summarize the changes and checks actually observed in this chat. Do not run any tools or make further changes.";
  const priorRecoveryIds = new Set(
    restored.messages
      .filter(
        (message) => message.role === "user" && message.text === recoveryPrompt,
      )
      .map((message) => message.id),
  );
  await page
    .getByRole("textbox", { name: "Message Pearl" })
    .fill(recoveryPrompt);
  await page.getByRole("button", { name: "Send message" }).click();
  async function awaitStatus(expected) {
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) {
      const chat = await current();
      if (chat.status !== "running") {
        assert.equal(chat.status, expected);
        return chat;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("Recovery stage timed out");
  }
  const failed = await awaitStatus("failed");
  const newRecoveryMessages = failed.messages.filter(
    (message) =>
      message.role === "user" &&
      message.text === recoveryPrompt &&
      !priorRecoveryIds.has(message.id),
  );
  assert.equal(newRecoveryMessages.length, 1);
  const recoveryMessageId = newRecoveryMessages[0].id;
  assert.equal(failed.activeUserMessageId, recoveryMessageId);
  recovery.providerFailure = true;
  await page.evaluate(
    async ({ key, model }) =>
      window.scully.configureSession({ key, model, outputTokens: 16384 }),
    { key: process.env.NEBIUS_API_KEY, model },
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const recovered = await awaitStatus("idle");
  assert.equal(
    recovered.messages.filter(
      (message) => message.role === "user" && message.text === recoveryPrompt,
    ).length,
    priorRecoveryIds.size + 1,
  );
  assert.equal(recovered.activeUserMessageId, recoveryMessageId);
  assert.equal(
    recovered.messages.filter((message) => message.id === recoveryMessageId)
      .length,
    1,
  );
  assert.ok(recovered.messages.at(-1)?.text.length > 0);
  recovery.providerRetry = true;
  await page.screenshot({
    path: "test-results/live-pearl-continued-room.png",
    fullPage: true,
  });
  console.log(
    "PASS: saved chat continuation, restart and provider failure/retry without a duplicated user message",
  );
} finally {
  const chat = chatId
    ? await page.evaluate(async (id) => window.scully.getPearlChat(id), chatId)
    : undefined;
  const requests =
    priorRequests +
    (
      await page.evaluate(async () => (await window.scully.metrics()).events)
    ).filter((event) => event.operation === "model.request").length;
  await app.close();
  const projectSnapshot = `test-results/live-pearl-project-${started}`,
    stateSnapshot = `test-results/live-pearl-state-${started}.sqlite`;
  await cp(project, projectSnapshot, { recursive: true });
  await cp(join(state, "workspace.sqlite"), stateSnapshot);
  await writeFile(
    `test-results/live-pearl-continuation-${started}.json`,
    JSON.stringify(
      {
        model,
        projectSnapshot,
        stateSnapshot,
        elapsedMs: Date.now() - started,
        requests,
        recovery,
        chat,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  process.stdout.write(
    `Saved test-results/live-pearl-continuation-${started}.json\n`,
  );
}
