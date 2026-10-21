import { _electron as electron } from "playwright";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const state = await mkdtemp(join(tmpdir(), "scully-pearl-desktop-"));
const project = await mkdtemp(join(tmpdir(), "scully-pearl-project-"));
await writeFile(join(project, "README.md"), "Project fixture\n");
await mkdir("test-results", { recursive: true });
let app;
const launch = () =>
  electron.launch({
    args: ["."],
    env: { ...process.env, SCULLY_TEST_DATA: state },
    timeout: 30000,
  });
try {
  app = await launch();
  let page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .getByRole("heading", { name: "What can I help you with?" })
    .waitFor();
  const exposed = await page.evaluate(() => Object.keys(window.scully).sort());
  assert.deepEqual(exposed, [
    "answerPearlQuestion",
    "approvePearlProject",
    "choosePearlProject",
    "configureSession",
    "createPearlChat",
    "decidePearlTool",
    "getPearlChat",
    "listPearlChats",
    "metrics",
    "onPearlChatUpdate",
    "retryPearlChat",
    "sendPearlMessage",
    "session",
    "stopPearlChat",
  ]);
  const channels = await app.evaluate(({ ipcMain }) => [
    ...ipcMain._invokeHandlers.keys(),
  ]);
  assert(channels.includes("pearl:send"));
  assert(
    ![
      "workspace:load",
      "task:create",
      "room:planning-message",
      "collaboration:review",
      "cloud:submit",
      "execution:start",
    ].some((channel) => channels.includes(channel)),
  );
  assert.equal(await page.getByRole("button", { name: "New chat" }).count(), 1);
  assert.equal(
    await page.getByRole("button", { name: "Task", exact: true }).count(),
    0,
  );
  assert.equal(await page.getByText("Manage team").count(), 0);
  await page
    .getByRole("textbox", { name: "Message Pearl" })
    .fill("Help me build a small app");
  await page.getByRole("button", { name: "Send message" }).click();
  await page
    .getByRole("log", { name: "Pearl conversation" })
    .getByText("Help me build a small app")
    .waitFor();
  await page.getByText("Turn interrupted").waitFor();
  assert.match(
    await page
      .getByText("Connect Nebius in Settings to continue")
      .textContent(),
    /Connect Nebius/,
  );
  const chat = await page.evaluate(
    async () => (await window.scully.listPearlChats())[0],
  );
  assert.equal(chat.title, "Help me build a small app");
  await app.evaluate(
    ({ dialog }, filePaths) => {
      dialog.showOpenDialog = () =>
        Promise.resolve({ canceled: false, filePaths });
    },
    [project],
  );
  await page.getByRole("button", { name: "Choose project" }).click();
  await page.getByRole("region", { name: "Project approval" }).waitFor();
  const beforeApproval = await page.evaluate(
    async (id) => window.scully.getPearlChat(id),
    chat.id,
  );
  assert.equal(beforeApproval.project.approved, false);
  await page.getByRole("button", { name: "Allow project access" }).click();
  const afterApproval = await page.evaluate(
    async (id) => window.scully.getPearlChat(id),
    chat.id,
  );
  assert.equal(afterApproval.project.approved, true);
  await assert.rejects(
    page.evaluate(
      async (id) => window.scully.answerPearlQuestion(id, "forged", "yes"),
      chat.id,
    ),
    /no longer current/,
  );
  await assert.rejects(
    page.evaluate(
      async (id) => window.scully.decidePearlTool(id, "forged", true),
      chat.id,
    ),
    /no longer current/,
  );
  await page.screenshot({
    path: "test-results/pearl-room.png",
    fullPage: true,
  });
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.getByRole("button", { name: "Help me build a small app" }).click();
  await page
    .getByRole("log", { name: "Pearl conversation" })
    .getByText("Help me build a small app")
    .waitFor();
  await page.getByText("Turn interrupted").waitFor();
  const restored = await page.evaluate(
    async (id) => window.scully.getPearlChat(id),
    chat.id,
  );
  assert.equal(restored.project.approved, true);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Pearl Room, hidden team UI, persisted chat, restart and forged-action rejection.",
  );
} finally {
  if (app) await app.close();
  await rm(state, { recursive: true, force: true });
  await rm(project, { recursive: true, force: true });
}
