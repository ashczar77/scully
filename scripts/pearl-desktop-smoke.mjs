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
  await page.waitForFunction(() =>
    [
      ...document.querySelectorAll(".pearl-brand img, .pearl-welcome-mark"),
    ].every((image) => image.complete && image.naturalWidth > 0),
  );
  const branding = await page.evaluate(async () => {
    await document.fonts.load('21px "Chelsea Market"');
    const logo = document.querySelector(".pearl-brand img");
    const portrait = document.querySelector(".pearl-welcome-mark");
    return {
      logoLoaded: logo?.complete && logo.naturalWidth > 0,
      portraitLoaded: portrait?.complete && portrait.naturalWidth > 0,
      headerHasPortrait: Boolean(
        document.querySelector('.pearl-header img[src*="team-portrait"]'),
      ),
      wordmarkFont: getComputedStyle(
        document.querySelector(".pearl-brand strong"),
      ).fontFamily,
      brandFontLoaded: document.fonts.check('21px "Chelsea Market"'),
      newChatColor: getComputedStyle(document.querySelector(".pearl-new"))
        .backgroundColor,
    };
  });
  assert.equal(branding.logoLoaded, true);
  assert.equal(branding.portraitLoaded, true);
  assert.equal(branding.headerHasPortrait, false);
  assert.match(branding.wordmarkFont, /Chelsea Market/);
  assert.equal(branding.brandFontLoaded, true);
  assert.equal(branding.newChatColor, "rgba(0, 0, 0, 0)");
  const layout = await page.evaluate(() => {
    const rect = (selector) =>
      document.querySelector(selector).getBoundingClientRect();
    const shell = rect(".pearl-shell");
    const header = rect(".pearl-header");
    const rail = rect(".pearl-rail");
    const panel = rect(".pearl-sidebar");
    return {
      fullWidth:
        Math.abs(header.left - shell.left) < 1 &&
        Math.abs(header.right - shell.right) < 1,
      contentBelowHeader:
        Math.abs(rail.top - header.bottom) < 1 &&
        Math.abs(panel.top - header.bottom) < 1,
      brandInHeader: Boolean(
        document.querySelector(".pearl-header .pearl-brand"),
      ),
    };
  });
  assert.equal(layout.fullWidth, true);
  assert.equal(layout.contentBelowHeader, true);
  assert.equal(layout.brandInHeader, true);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("complementary", { name: "Settings panel" }).waitFor();
  assert.equal(
    await page.getByRole("complementary", { name: "Chats panel" }).count(),
    0,
  );
  await page.getByRole("button", { name: "Chats", exact: true }).click();
  await page.getByRole("complementary", { name: "Chats panel" }).waitFor();
  const exposed = await page.evaluate(() => Object.keys(window.scully).sort());
  assert.deepEqual(exposed, [
    "answerPearlQuestion",
    "approvePearlProject",
    "archivePearlChat",
    "choosePearlProject",
    "configureSession",
    "createPearlChat",
    "decidePearlTool",
    "deletePearlChatPermanently",
    "getPearlChat",
    "listPearlChats",
    "metrics",
    "onPearlChatUpdate",
    "restorePearlChat",
    "retryPearlChat",
    "sendPearlMessage",
    "session",
    "stopPearlChat",
    "trashPearlChat",
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
  for (let i = 0; i < 3; i++) await page.locator(".pearl-new").click();
  assert.equal(
    await page.evaluate(
      async () => (await window.scully.listPearlChats()).length,
    ),
    1,
  );
  assert.equal(
    await page
      .getByRole("navigation", { name: "Chats" })
      .getByRole("button", { name: "New chat", exact: true })
      .count(),
    1,
  );
  const composer = page.getByRole("textbox", { name: "Message Pearl" });
  const initialHeight = await composer.evaluate(
    (input) => input.getBoundingClientRect().height,
  );
  await composer.fill("One\nTwo\nThree\nFour");
  assert(
    (await composer.evaluate((input) => input.getBoundingClientRect().height)) >
      initialHeight,
    "Composer should grow with a multiline draft",
  );
  assert.equal(
    await composer.evaluate((input) => getComputedStyle(input).resize),
    "none",
  );
  await composer.fill(
    Array.from({ length: 24 }, (_, index) => `Draft line ${index + 1}`).join(
      "\n",
    ),
  );
  const overflow = await composer.evaluate((input) => {
    input.scrollTop = input.scrollHeight;
    return {
      scrollHeight: input.scrollHeight,
      clientHeight: input.clientHeight,
      scrollTop: input.scrollTop,
      scrollbarWidth: getComputedStyle(input).scrollbarWidth,
    };
  });
  assert(overflow.scrollHeight > overflow.clientHeight);
  assert(overflow.scrollTop > 0, "A long draft must remain scrollable");
  assert.equal(overflow.scrollbarWidth, "none");
  await composer.evaluate((input) => {
    input.scrollTop = 0;
  });
  await page.screenshot({ path: "test-results/pearl-composer-overflow.png" });
  await composer.fill(
    "Help me build a keyboard-usable household expense tracker",
  );
  await page.getByRole("button", { name: "Send message" }).click();
  await page
    .getByRole("log", { name: "Pearl conversation" })
    .getByText("Help me build a keyboard-usable household expense tracker")
    .waitFor();
  const userMessage = page.locator(".pearl-message.user").last();
  assert.equal(await userMessage.locator(".pearl-message-bubble").count(), 1);
  assert.equal(await userMessage.locator("time[datetime]").count(), 1);
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
  assert.equal(
    chat.title,
    "Help me build a keyboard-usable household expense tracker",
  );
  const titleLayout = await page
    .getByRole("button", { name: chat.title, exact: true })
    .evaluate((button) => {
      const range = document.createRange();
      range.setStart(button.firstElementChild.firstChild, 0);
      range.setEnd(button.firstElementChild.firstChild, 1);
      return {
        first: range.getBoundingClientRect().left,
        left: button.getBoundingClientRect().left,
      };
    });
  assert(
    titleLayout.first >= titleLayout.left,
    `Long chat titles must preserve their visible beginning: ${JSON.stringify(titleLayout)}`,
  );
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
  await page
    .getByRole("button", {
      name: "Help me build a keyboard-usable household expense tracker",
      exact: true,
    })
    .click();
  await page
    .getByRole("log", { name: "Pearl conversation" })
    .getByText("Help me build a keyboard-usable household expense tracker")
    .waitFor();
  await page.getByText("Turn interrupted").waitFor();
  const restored = await page.evaluate(
    async (id) => window.scully.getPearlChat(id),
    chat.id,
  );
  assert.equal(restored.project.approved, true);
  await page.getByRole("button", { name: `Options for ${chat.title}` }).click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await page.getByRole("button", { name: chat.title, exact: true }).click();
  await page.getByText("Archived chat").waitFor();
  assert.equal(
    await page.getByRole("textbox", { name: "Message Pearl" }).isDisabled(),
    true,
  );
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await page.getByRole("button", { name: `Options for ${chat.title}` }).click();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await page.getByRole("button", { name: `Options for ${chat.title}` }).click();
  await page.getByRole("button", { name: "Move to Trash" }).click();
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await page.getByRole("button", { name: `Options for ${chat.title}` }).click();
  await page.getByRole("button", { name: "Delete permanently" }).click();
  assert.equal(
    (await page.evaluate(async () => window.scully.listPearlChats("trash")))
      .length,
    1,
  );
  await page.getByRole("button", { name: "Confirm deletion" }).click();
  await page.getByText("Trash is empty").waitFor();
  await assert.rejects(
    page.evaluate(async (id) => window.scully.getPearlChat(id), chat.id),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Pearl Room, one empty chat, archive, Trash, permanent delete, restart and forged-action rejection.",
  );
} finally {
  if (app) await app.close();
  await rm(state, { recursive: true, force: true });
  await rm(project, { recursive: true, force: true });
}
