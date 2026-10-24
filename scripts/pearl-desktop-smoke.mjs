import { _electron as electron } from "playwright";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
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
  const roomTheme = await page.evaluate(() => {
    const style = (selector) =>
      getComputedStyle(document.querySelector(selector));
    return {
      font: style(".pearl-shell").fontFamily,
      brandFont: style(".pearl-brand strong").fontFamily,
      corners: [
        ".pearl-rail button",
        ".pearl-new",
        ".pearl-welcome-mark",
        ".pearl-project-button",
        ".pearl-composer",
      ].map((selector) => style(selector).borderRadius),
      palette: style(".pearl-shell").getPropertyValue("--pearl-teal").trim(),
    };
  });
  assert.match(roomTheme.font, /monospace/i);
  assert.match(roomTheme.brandFont, /Chelsea Market/);
  assert.deepEqual(roomTheme.corners, ["0px", "0px", "0px", "0px", "0px"]);
  assert.equal(roomTheme.palette, "#46dfcc");
  const composerAndRail = await page.evaluate(() => {
    const railButton = document.querySelector(".pearl-rail button.active");
    const input = document.querySelector(".pearl-composer textarea");
    const toolbar = document.querySelector(".pearl-composer-toolbar");
    const send = toolbar.querySelector(".pearl-composer-send");
    const railStyle = getComputedStyle(railButton);
    return {
      railBackground: railStyle.backgroundColor,
      railShadow: railStyle.boxShadow,
      toolbarBelowInput:
        toolbar.getBoundingClientRect().top >=
        input.getBoundingClientRect().bottom,
      sendWidth: send.getBoundingClientRect().width,
      addFilesDisabled: toolbar.querySelector(
        '[aria-label="Add files (coming soon)"]',
      ).disabled,
      permissionsDisabled: toolbar.querySelector(
        '[aria-label="Permissions (coming soon)"]',
      ).disabled,
    };
  });
  assert.equal(composerAndRail.railBackground, "rgba(0, 0, 0, 0)");
  assert.match(composerAndRail.railShadow, /1px 0px 0px 0px inset/);
  assert.equal(composerAndRail.toolbarBelowInput, true);
  assert.equal(composerAndRail.sendWidth, 30);
  assert.equal(composerAndRail.addFilesDisabled, true);
  assert.equal(composerAndRail.permissionsDisabled, true);
  await page.screenshot({ path: "test-results/pearl-terminal-welcome.png" });
  const desktopViewport = page.viewportSize();
  await page.setViewportSize({ width: 760, height: 720 });
  const narrow = await page.evaluate(() => {
    const shell = document.querySelector(".pearl-shell");
    const composer = document.querySelector(".pearl-composer");
    const rect = composer.getBoundingClientRect();
    return {
      horizontalOverflow: shell.scrollWidth > shell.clientWidth,
      composerVisible: rect.width > 300 && rect.left >= 0 && rect.right <= 760,
    };
  });
  assert.equal(narrow.horizontalOverflow, false);
  assert.equal(narrow.composerVisible, true);
  await page.screenshot({ path: "test-results/pearl-terminal-narrow.png" });
  if (desktopViewport) await page.setViewportSize(desktopViewport);
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
  const selectedTab = await page.evaluate(() => {
    const active = document.querySelector(".pearl-settings-tabs button.active");
    const style = getComputedStyle(active);
    return { shadow: style.boxShadow, bottomBorder: style.borderBottomColor };
  });
  assert.equal(selectedTab.shadow, "none");
  assert.equal(selectedTab.bottomBorder, "rgba(0, 0, 0, 0)");
  await page.getByRole("heading", { level: 1, name: "Settings" }).waitFor();
  await page.getByRole("heading", { name: "Pearl’s model" }).waitFor();
  assert.equal(
    await page
      .locator(".pearl-settings-card")
      .first()
      .evaluate((element) => getComputedStyle(element).borderRadius),
    "0px",
  );
  await page.screenshot({ path: "test-results/pearl-terminal-settings.png" });
  assert.equal(
    await page.getByRole("complementary", { name: "Chats panel" }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("textbox", { name: "Message Pearl" }).count(),
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
    "configureWebSearch",
    "connectRemoteMcp",
    "createPearlChat",
    "decidePearlTool",
    "deletePearlChatPermanently",
    "disconnectRemoteMcp",
    "disconnectWebSearch",
    "getPearlChat",
    "listPearlChats",
    "listPearlModels",
    "listPearlProjectFiles",
    "metrics",
    "onPearlChatUpdate",
    "pearlGitCommitFiles",
    "pearlGitDiff",
    "pearlGitView",
    "readPearlProjectFile",
    "remoteMcpInfo",
    "renamePearlChat",
    "resizePearlTerminal",
    "restorePearlChat",
    "retryPearlChat",
    "reviewPearlTaskFile",
    "selectPearlModels",
    "sendPearlMessage",
    "sendPearlTerminalInput",
    "session",
    "stopPearlChat",
    "stopPearlTerminal",
    "undoPearlTask",
    "webSearchInfo",
  ]);
  const channels = await app.evaluate(({ ipcMain }) => [
    ...ipcMain._invokeHandlers.keys(),
  ]);
  assert(channels.includes("pearl:send"));
  assert(channels.includes("pearl:web:configure"));
  assert(channels.includes("pearl:mcp:connect"));
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
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await page.getByRole("complementary", { name: "Files" }).waitFor();
  await page
    .locator(".pearl-inspector")
    .evaluate((element) =>
      Promise.all(
        element
          .getAnimations()
          .map((animation) => animation.finished.catch(() => {})),
      ),
    );
  const inspectorBeforeResize = await page
    .locator(".pearl-inspector")
    .evaluate((element) => element.getBoundingClientRect().width);
  const grip = await page
    .getByRole("separator", { name: "Resize panel" })
    .boundingBox();
  assert(grip);
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 80);
  await page.mouse.down();
  await page.mouse.move(grip.x + 80, grip.y + 80);
  await page.mouse.up();
  const inspectorAfterResize = await page
    .locator(".pearl-inspector")
    .evaluate((element) => element.getBoundingClientRect().width);
  assert(
    inspectorAfterResize < inspectorBeforeResize,
    `Inspector should resize by dragging its edge (${inspectorBeforeResize} -> ${inspectorAfterResize})`,
  );
  await page.getByRole("button", { name: "README.md" }).click();
  const fileSelection = await page
    .getByRole("button", { name: "README.md" })
    .evaluate((element) => ({
      outline: getComputedStyle(element).outlineStyle,
      shadow: getComputedStyle(element).boxShadow,
      icon: Boolean(element.querySelector(".pearl-file-icon svg")),
    }));
  assert.equal(fileSelection.outline, "none");
  assert.match(fileSelection.shadow, /inset/);
  assert.equal(fileSelection.icon, true);
  await page
    .getByRole("region", { name: "File preview" })
    .getByText("Project fixture")
    .waitFor();
  assert.equal(
    await page.getByRole("region", { name: "Code preview" }).count(),
    1,
  );
  await page.screenshot({ path: "test-results/pearl-files.png" });
  await page.getByRole("button", { name: "Refresh panel" }).click();
  await page.getByRole("button", { name: "Close panel" }).click();
  await page.locator(".pearl-inspector.is-closing").waitFor();
  await page.locator(".pearl-inspector").waitFor({ state: "detached" });
  execFileSync("git", ["init", "-q", project]);
  execFileSync("git", ["-C", project, "add", "README.md"]);
  execFileSync("git", [
    "-C",
    project,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "Initial project",
  ]);
  await writeFile(join(project, "README.md"), "Project fixture\nUpdated\n");
  await page.getByRole("button", { name: "Git changes" }).click();
  await page.getByRole("complementary", { name: "Git history" }).waitFor();
  await page.getByText("Initial project").waitFor();
  await page.getByText("Current branch").waitFor();
  assert.equal(await page.getByText("Working changes").count(), 1);
  await page.screenshot({ path: "test-results/pearl-git.png" });
  await page.getByRole("button", { name: "Close panel" }).click();
  if (desktopViewport) await page.setViewportSize(desktopViewport);
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
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page.getByRole("button", { name: "Options for New chat" }).click();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  const neighborGap = await page
    .locator(".pearl-chat-rename")
    .evaluate((form) => {
      const next = form.closest(".pearl-chat-row")?.nextElementSibling;
      return next
        ? next.getBoundingClientRect().top - form.getBoundingClientRect().bottom
        : null;
    });
  assert.ok(
    neighborGap !== null && neighborGap >= 4,
    `Renaming must leave space before the next chat (${neighborGap})`,
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: chat.title, exact: true }).click();
  const chatOptions = page.getByRole("button", {
    name: `Options for ${chat.title}`,
  });
  await chatOptions.click();
  const chatMenuLayout = await page.evaluate(() => {
    const row = document.querySelector(".pearl-chat-row:has(.pearl-chat-menu)");
    const title = row.querySelector(".pearl-chat-title");
    const options = row.querySelector(".pearl-chat-options");
    const menu = row.querySelector(".pearl-chat-menu");
    return {
      iconGap:
        options.getBoundingClientRect().left -
        title.getBoundingClientRect().right,
      menuGap:
        menu.getBoundingClientRect().top - title.getBoundingClientRect().bottom,
      iconBackground: getComputedStyle(options).backgroundColor,
      iconOutline: getComputedStyle(options).outlineStyle,
      selectedShadow: getComputedStyle(title).boxShadow,
    };
  });
  assert.ok(chatMenuLayout.iconGap >= 6);
  assert.ok(chatMenuLayout.menuGap >= 6);
  assert.equal(chatMenuLayout.iconBackground, "rgba(0, 0, 0, 0)");
  assert.equal(chatMenuLayout.iconOutline, "none");
  assert.match(chatMenuLayout.selectedShadow, /inset/);
  await page.keyboard.press("Shift+Tab");
  const focusedChat = await page.evaluate(() => {
    const title = document.querySelector(
      ".pearl-chat-row:has(.pearl-chat-menu) .pearl-chat-title",
    );
    return {
      focused: document.activeElement === title,
      outline: getComputedStyle(title).outlineStyle,
      shadow: getComputedStyle(title).boxShadow,
    };
  });
  assert.equal(focusedChat.focused, true);
  assert.equal(focusedChat.outline, "none");
  assert.match(focusedChat.shadow, /inset/);
  await page.screenshot({ path: "test-results/pearl-chat-menu.png" });
  await page.getByRole("heading", { name: chat.title }).click();
  assert.equal(
    await page.getByRole("button", { name: "Archive", exact: true }).count(),
    0,
  );
  await chatOptions.click();
  await page.keyboard.press("Escape");
  assert.equal(
    await page.getByRole("button", { name: "Archive", exact: true }).count(),
    0,
  );
  await chatOptions.click();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  const renameLayout = await page
    .locator(".pearl-chat-rename")
    .evaluate((form) => {
      const row = form.closest(".pearl-chat-row");
      const next = row?.nextElementSibling;
      return {
        gap: next
          ? next.getBoundingClientRect().top -
            form.getBoundingClientRect().bottom
          : null,
        rowMargin: Number.parseFloat(getComputedStyle(row).marginBottom),
        outline: getComputedStyle(form.querySelector("textarea")).outlineStyle,
        border: getComputedStyle(form.querySelector("textarea")).borderTopStyle,
        titleFits:
          form.querySelector("textarea").scrollHeight <=
          form.querySelector("textarea").clientHeight,
      };
    });
  assert.ok(renameLayout.rowMargin >= 4);
  if (renameLayout.gap !== null) assert.ok(renameLayout.gap >= 4);
  assert.equal(renameLayout.outline, "none");
  assert.equal(renameLayout.border, "none");
  assert.equal(renameLayout.titleFits, true);
  await page.screenshot({ path: "test-results/pearl-rename.png" });
  await page
    .getByRole("textbox", { name: "Chat title" })
    .fill("Renamed desktop chat");
  await page.getByRole("button", { name: "Save" }).click();
  await page
    .getByRole("button", { name: "Renamed desktop chat", exact: true })
    .waitFor();
  assert.equal(
    (await page.evaluate(async (id) => window.scully.getPearlChat(id), chat.id))
      .title,
    "Renamed desktop chat",
  );
  await page
    .getByRole("button", { name: "Options for Renamed desktop chat" })
    .click();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByRole("textbox", { name: "Chat title" }).fill(chat.title);
  await page.getByRole("button", { name: "Save" }).click();
  await chatOptions.waitFor();
  await chatOptions.click();
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
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await page.getByRole("button", { name: `Options for ${chat.title}` }).click();
  await page.getByRole("button", { name: "Delete permanently" }).click();
  assert.equal(
    (await page.evaluate(async () => window.scully.listPearlChats("archived")))
      .length,
    1,
  );
  await page.getByRole("button", { name: "Confirm deletion" }).click();
  await page.getByText("No archived chats").waitFor();
  await assert.rejects(
    page.evaluate(async (id) => window.scully.getPearlChat(id), chat.id),
  );
  await page.getByRole("button", { name: "Settings" }).click();
  const fallbackChoice = page.getByRole("checkbox", {
    name: "Use a fallback if the selected model does not respond",
  });
  assert.equal(await fallbackChoice.isChecked(), false);
  await fallbackChoice.check();
  await page
    .getByRole("button", { name: "Fallback model: Choose a model" })
    .click();
  await page.getByRole("option", { name: "Nemotron 3 Super" }).click();
  await page.getByRole("button", { name: "App & connection" }).click();
  await page.getByLabel("Nebius API key").fill("desktop-test-key");
  await page.getByRole("button", { name: "Connect Nebius" }).click();
  const connected = await page.evaluate(() => window.scully.session());
  assert.equal(connected.model, "Qwen/Qwen3-235B-A22B-Instruct-2507");
  assert.equal(connected.fallbackModel, "nvidia/nemotron-3-super-120b-a12b");
  assert.equal(JSON.stringify(connected).includes("desktop-test-key"), false);
  await page.getByRole("button", { name: "Models", exact: true }).click();
  await page
    .getByRole("button", { name: "Primary model: Qwen3 235B Instruct" })
    .click();
  await page.getByRole("option", { name: "GLM 5.3 Flash" }).click();
  await page.getByRole("button", { name: "Save model choice" }).click();
  assert.equal(
    (await page.evaluate(() => window.scully.session())).model,
    "zai-org/GLM-5.3-Flash",
  );
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.getByRole("button", { name: "Settings" }).click();
  assert.equal(
    await page
      .getByRole("checkbox", {
        name: "Use a fallback if the selected model does not respond",
      })
      .isChecked(),
    false,
  );
  assert.equal(
    (await page.evaluate(() => window.scully.session())).configured,
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Pearl Room, one empty chat, archive, permanent delete, restart and forged-action rejection.",
  );
} finally {
  if (app) await app.close();
  await rm(state, { recursive: true, force: true });
  await rm(project, { recursive: true, force: true });
}
