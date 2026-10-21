import assert from "node:assert/strict";
import { _electron as electron } from "playwright";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { safeTestCommand } from "./live-test-command.mjs";
import { checkDisposableReadingList } from "./disposable-browser-check.mjs";

if (
  process.env.SCULLY_LIVE_TEST !== "1" ||
  !process.env.NEBIUS_API_KEY ||
  !process.env.SCULLY_REPAIR_SOURCE
)
  throw new Error(
    "Set SCULLY_LIVE_TEST=1, NEBIUS_API_KEY and SCULLY_REPAIR_SOURCE",
  );

const root = await mkdtemp(join(tmpdir(), "scully-pearl-repair-"));
const project = join(root, "project");
const state = join(root, "state");
await cp(resolve(process.env.SCULLY_REPAIR_SOURCE), project, {
  recursive: true,
});
await mkdir(state, { recursive: true });
await mkdir("test-results", { recursive: true });
const snapshot = join("test-results", `live-pearl-repair-${Date.now()}`);
const transcript = { status: "unavailable", decisions: [], messages: [] };
let providerRetries = 0;
let budgetContinues = 0;
let app;
let page;
let chatId;

try {
  app = await electron.launch({
    args: ["."],
    env: { ...process.env, SCULLY_TEST_DATA: state },
    timeout: 30_000,
  });
  page = await app.firstWindow();
  await page
    .getByRole("heading", { name: "What can I help you with?" })
    .waitFor();
  await page.evaluate(
    async ({ key, model }) =>
      window.scully.configureSession({ key, model, outputTokens: 16384 }),
    {
      key: process.env.NEBIUS_API_KEY,
      model:
        process.env.SCULLY_REPAIR_MODEL || "deepseek-ai/DeepSeek-V4-Pro-0813",
    },
  );
  await page.getByRole("button", { name: "New chat" }).click();
  chatId = (
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
    .fill(
      "In this web app, pressing Enter in either add-book input does not add a book. Inspect the project, fix that behavior without breaking other shortcuts, create or update a meaningful regression test, run relevant checks with approval, and report only observed results.",
    );
  await page.getByRole("button", { name: "Send message" }).click();
  const deadline = Date.now() + 600_000;
  while (Date.now() < deadline) {
    const chat = await page.evaluate(
      async (id) => window.scully.getPearlChat(id),
      chatId,
    );
    if (chat.status === "awaiting_approval") {
      const requested = JSON.parse(chat.pendingTool.arguments);
      const approved = safeTestCommand(requested);
      transcript.decisions.push({
        command: requested.command,
        args: requested.args,
        approved,
      });
      await page
        .getByRole("button", { name: approved ? "Run once" : "Deny" })
        .click();
      continue;
    }
    if (
      chat.status === "failed" &&
      providerRetries < 2 &&
      (chat.error?.startsWith("Provider response was incomplete") ||
        chat.error === "Provider reply was empty" ||
        chat.error === "Provider reported an internal failure")
    ) {
      providerRetries++;
      await page.getByRole("button", { name: "Continue" }).click();
      continue;
    }
    if (
      chat.status === "failed" &&
      budgetContinues < 2 &&
      chat.error?.startsWith("Action budget reached")
    ) {
      budgetContinues++;
      await page.getByRole("button", { name: "Continue" }).click();
      continue;
    }
    if (chat.status !== "running") {
      transcript.status = chat.status;
      transcript.error = chat.error || null;
      transcript.questions = chat.questions;
      transcript.messages = chat.messages;
      break;
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  assert.notEqual(transcript.status, "unavailable", "Repair turn timed out");
  transcript.providerRetries = providerRetries;
  transcript.budgetContinues = budgetContinues;
  assert.equal(transcript.status, "idle", "Repair turn did not finish");
  assert(
    transcript.messages.some((message) => {
      if (message.role !== "tool" || message.toolName !== "run_command")
        return false;
      try {
        return JSON.parse(message.text).exitCode === 0;
      } catch {
        return false;
      }
    }),
    "Pearl did not complete an approved check",
  );
  try {
    transcript.browserCheck = await checkDisposableReadingList(
      app,
      project,
      "test-results/live-pearl-repair-browser.png",
    );
  } catch (error) {
    transcript.browserCheck = {
      passed: false,
      error: error instanceof Error ? error.message : "Unknown browser error",
    };
    throw error;
  }
  process.stdout.write(
    `repair: ${transcript.status}, ${transcript.decisions.length} command reviews, ${transcript.messages.length} messages, browser passed\n`,
  );
} finally {
  await cp(project, snapshot, { recursive: true });
  await writeFile(
    "test-results/live-pearl-repair.json",
    JSON.stringify({ ...transcript, snapshot }, null, 2),
    { mode: 0o600 },
  );
  if (app) await app.close();
  await rm(root, { recursive: true, force: true });
}
