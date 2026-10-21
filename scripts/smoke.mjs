import { _electron as electron } from "playwright";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const state = await mkdtemp(join(tmpdir(), "scully-shell-test-"));
const sourceRoot = await mkdtemp(join(tmpdir(), "scully-apply-fixture-"));
await mkdir("test-results", { recursive: true });
async function assertPanelScrolls(page, selector, label) {
  const dimensions = await page.locator(selector).evaluate((panel) => {
    panel.scrollTop = panel.scrollHeight;
    return {
      scrollHeight: panel.scrollHeight,
      clientHeight: panel.clientHeight,
      scrollTop: panel.scrollTop,
    };
  });
  assert(
    dimensions.scrollHeight > dimensions.clientHeight + 2,
    `${label} content should overflow its own panel: ${JSON.stringify(dimensions)}`,
  );
  assert(dimensions.scrollTop > 2, `${label} panel should scroll`);
}
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
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  await page
    .getByRole("heading", { name: "What would you like to build?" })
    .waitFor();
  const roomHeading = await page.locator(".room-chat-header").boundingBox();
  const composer = await page.locator(".room-composer").boundingBox();
  assert(
    roomHeading && composer && composer.y > roomHeading.y + roomHeading.height,
  );
  assert.equal(
    await page.locator(".brand span").evaluate(async (wordmark) => {
      await document.fonts.ready;
      return (
        getComputedStyle(wordmark).fontFamily.includes("Chelsea Market") &&
        document.fonts.check('27px "Chelsea Market"')
      );
    }),
    true,
  );
  await page.getByRole("textbox", { name: "Start a task" }).waitFor();
  assert.equal(await page.getByText("Build password reset").count(), 0);
  assert.equal(
    await page
      .locator(".brand-logo")
      .evaluate((image) => image.naturalWidth > 0),
    true,
  );
  assert(
    ((await page.locator(".brand-logo").boundingBox())?.width ?? 0) >= 40,
    "Scully's top-bar logo should be legible beside the wordmark",
  );
  const logoBounds = await page.locator(".brand-logo").boundingBox();
  const wordBounds = await page.locator(".brand span").boundingBox();
  assert(logoBounds && wordBounds);
  assert(
    wordBounds.x - (logoBounds.x + logoBounds.width) <= 3,
    "The wordmark should sit close to the alien head",
  );
  assert.equal(
    await page
      .locator(".project-mark img")
      .evaluate((image) => image.naturalWidth > 0),
    true,
  );
  assert.equal(await page.locator(".team-sidebar .edit-profile").count(), 0);
  await page.getByRole("button", { name: "Manage team" }).waitFor();
  const panelLayout = await page.evaluate(() => {
    const left = document.querySelector(".project-sidebar");
    const center = document.querySelector(".main-panel");
    const right = document.querySelector(".team-sidebar");
    const rightContent = document.querySelector(".team-sidebar-content");
    const footer = document.querySelector(".sidebar-footer");
    return {
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      leftHeight: left.clientHeight,
      centerHeight: center.clientHeight,
      rightHeight: right.clientHeight,
      leftBottom: left.getBoundingClientRect().bottom,
      footerBottom: footer.getBoundingClientRect().bottom,
      rightScrollable: rightContent.scrollHeight > rightContent.clientHeight,
      rightScrollbar: getComputedStyle(rightContent).scrollbarWidth,
    };
  });
  assert(panelLayout.documentHeight <= panelLayout.viewportHeight + 1);
  assert.equal(panelLayout.leftHeight, panelLayout.centerHeight);
  assert.equal(panelLayout.centerHeight, panelLayout.rightHeight);
  assert(panelLayout.footerBottom <= panelLayout.leftBottom);
  assert(panelLayout.leftBottom - panelLayout.footerBottom < 2);
  assert.equal(panelLayout.rightScrollable, true);
  assert.equal(panelLayout.rightScrollbar, "none");
  await page.locator(".team-sidebar-content").evaluate((panel) => {
    panel.scrollTop = panel.scrollHeight;
  });
  assert.equal(
    await page.locator(".main-panel").evaluate((panel) => panel.scrollTop),
    0,
  );
  assert.equal(
    await page
      .locator(".project-sidebar-content")
      .evaluate((panel) => panel.scrollTop),
    0,
  );
  await page.getByRole("button", { name: "Changes", exact: true }).click();
  const changesEmpty = await page.locator(".empty-page").boundingBox();
  assert(changesEmpty && changesEmpty.y < panelLayout.viewportHeight);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const previewEmpty = await page.locator(".empty-page").boundingBox();
  assert(previewEmpty && previewEmpty.y < panelLayout.viewportHeight);
  await page.getByRole("button", { name: "Room", exact: true }).click();
  assert.equal(
    await page.getByRole("button", { name: "Send message" }).count(),
    0,
  );
  const startingViewport = page.viewportSize();
  await page.setViewportSize({ width: 1400, height: 1900 });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Run usage" }).click();
  const emptySettingsHeading = await page
    .getByRole("heading", { name: "Settings", exact: true })
    .boundingBox();
  const emptySettingsSwitch = await page
    .getByRole("button", { name: "Run usage", exact: true })
    .boundingBox();
  assert(emptySettingsHeading && emptySettingsSwitch);
  assert(
    emptySettingsSwitch.y <
      emptySettingsHeading.y + emptySettingsHeading.height + 120,
    "Run usage switcher should stay directly below the heading without a selected task",
  );
  await page.getByRole("heading", { name: "Choose a task" }).waitFor();
  const indicator = page.locator(".settings-section-indicator");
  assert.notEqual(
    await indicator.evaluate(
      (element) => getComputedStyle(element).transitionDuration,
    ),
    "0s",
  );
  await page.waitForTimeout(300);
  const indicatorBounds = await indicator.boundingBox();
  assert(indicatorBounds);
  assert(
    Math.abs(
      indicatorBounds.x +
        indicatorBounds.width / 2 -
        (emptySettingsSwitch.x + emptySettingsSwitch.width / 2),
    ) < 6,
    "The sliding selection should settle under Run usage",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await indicator.evaluate(
      (element) => getComputedStyle(element).transitionDuration,
    ),
    "0s",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.screenshot({
    path: "test-results/run-usage-empty.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Room", exact: true }).click();
  if (startingViewport) await page.setViewportSize(startingViewport);
  const isolation = await page.evaluate(() => ({
    node: typeof window.require,
    bridge: Object.keys(window.scully),
  }));
  assert.equal(isolation.node, "undefined");
  assert.deepEqual(
    isolation.bridge.sort(),
    [
      "cloudImages",
      "resolveCloudExecutable",
      "cloudSession",
      "configureCloud",
      "reviewCloud",
      "submitCloud",
      "refreshCloud",
      "createTask",
      "copyText",
      "conversationAllowance",
      "reviewConversation",
      "approveConversation",
      "reviewCollaboration",
      "approveCollaboration",
      "sendCollaborationMessage",
      "continueTeammate",
      "recommendEnvironments",
      "reviewLocalFallback",
      "approveLocalFallback",
      "reviewDispatchProposal",
      "reconcileCollaboration",
      "reviewSpecialistDispatch",
      "approveSpecialistDispatch",
      "reviewCollaborationSync",
      "approveCollaborationSync",
      "autoAnswerMessage",
      "rawCaptureStatus",
      "armRawCapture",
      "readRawCapture",
      "clearRawCapture",
      "updateTask",
      "deleteTask",
      "taskDisposition",
      "archiveTask",
      "restoreTask",
      "permanentlyDeleteArchivedTask",
      "taskActivity",
      "load",
      "updateTeammate",
      "applyTeamStyle",
      "saveTeam",
      "setDefaultTeam",
      "deleteTeam",
      "restoreTeam",
      "selectSource",
      "prepareRun",
      "chooseProjectWorkspace",
      "openProjectWorkspace",
      "gitHistory",
      "initializeGit",
      "runs",
      "usageForRun",
      "usageAlertsForRun",
      "costForRun",
      "configureCost",
      "configureUsageAlerts",
      "continueUsage",
      "saveTokensForRemaining",
      "session",
      "configureSession",
      "listModels",
      "selectRunModel",
      "selectDefaultModel",
      "sendPlanningMessage",
      "answerPlanningQuestion",
      "answerPlanningQuestions",
      "approvePlanningPlan",
      "retryPlanning",
      "sendConversationMessage",
      "answerConversationMessage",
      "answerBuildQuestion",
      "configureUsagePolicy",
      "reviewUsagePolicy",
      "startRun",
      "approveLineup",
      "stopRun",
      "requestRunPause",
      "resumeRunPause",
      "configureCoordination",
      "startAudit",
      "decideFinding",
      "prepareCorrection",
      "sendTeamMessage",
      "stopReply",
      "reviewSuggestion",
      "reviewReply",
      "reviewRoutedReply",
      "messageRoutingSettings",
      "setMessageRoutingSettings",
      "planningSettings",
      "setPlanningSettings",
      "roleModelSettings",
      "setRoleModelSettings",
      "answerMessage",
      "reviewConsultation",
      "startConsultation",
      "stopConsultation",
      "reviewAdvice",
      "approveAdvice",
      "removeAdvice",
      "metrics",
      "inspectLocalArtifacts",
      "reviewApply",
      "applyDraft",
      "inspectApplyRecovery",
      "decideCommand",
      "reviewExecution",
      "executeCommand",
      "stopExecution",
      "onRun",
    ].sort(),
  );
  const taskDivider = page.getByRole("separator", {
    name: "Resize task panel",
  });
  const teamDivider = page.getByRole("separator", {
    name: "Resize team panel",
  });
  await page.getByRole("button", { name: "Collapse task list" }).click();
  await page.getByRole("button", { name: "Collapse team panel" }).click();
  assert.equal(
    await page.locator(".project-sidebar.panel-collapsed").count(),
    1,
  );
  assert.equal(await page.locator(".team-sidebar.panel-collapsed").count(), 1);
  await page.getByRole("button", { name: "Expand task list" }).click();
  await page.getByRole("button", { name: "Expand team panel" }).click();
  await page.waitForTimeout(300);
  await page.evaluate(() => window.scully.copyText("desktop clipboard test"));
  assert.equal(
    await app.evaluate(({ clipboard }) => clipboard.readText()),
    "desktop clipboard test",
  );
  const taskBefore = Number(await taskDivider.getAttribute("aria-valuenow"));
  const dividerBounds = await taskDivider.boundingBox();
  assert(dividerBounds);
  await page.mouse.move(
    dividerBounds.x + dividerBounds.width / 2,
    dividerBounds.y + 80,
  );
  await page.mouse.down();
  await page.mouse.move(
    dividerBounds.x + dividerBounds.width / 2 + 20,
    dividerBounds.y + 80,
    { steps: 5 },
  );
  await page.mouse.up();
  assert(
    Number(await taskDivider.getAttribute("aria-valuenow")) > taskBefore,
    "Dragging should widen the task panel",
  );
  await teamDivider.focus();
  const teamBefore = Number(await teamDivider.getAttribute("aria-valuenow"));
  await page.keyboard.press("ArrowRight");
  assert.equal(
    Number(await teamDivider.getAttribute("aria-valuenow")),
    teamBefore - 20,
    "Keyboard resizing should narrow the team panel",
  );
  for (let index = 0; index < 20; index++)
    await teamDivider.press("ArrowRight");
  assert.equal(await teamDivider.getAttribute("aria-valuenow"), "240");
  assert.equal(
    await page
      .locator(".team-cards")
      .evaluate(
        (cards) =>
          getComputedStyle(cards).gridTemplateColumns.split(" ").length,
      ),
    1,
    "Narrow team panels should show readable member rows",
  );
  const narrowArt = await page
    .locator(".team-sidebar .profile-art")
    .boundingBox();
  assert(narrowArt);
  assert(Math.abs(narrowArt.width / narrowArt.height - 1.14) < 0.1);
  await page.screenshot({
    path: "test-results/team-panel-narrow.png",
    fullPage: true,
  });
  for (let index = 0; index < 20; index++) await teamDivider.press("ArrowLeft");
  assert(Number(await teamDivider.getAttribute("aria-valuenow")) >= 400);
  await page.waitForTimeout(300);
  assert.equal(
    await page
      .locator(".team-cards")
      .evaluate(
        (cards) =>
          getComputedStyle(cards).gridTemplateColumns.split(" ").length,
      ),
    3,
  );
  const wideArt = await page
    .locator(".team-sidebar .profile-art")
    .boundingBox();
  assert(wideArt);
  assert(Math.abs(wideArt.width / wideArt.height - 1.14) < 0.1);
  const memberPortrait = await page
    .locator(".team-card .portrait")
    .first()
    .boundingBox();
  assert(memberPortrait);
  assert(Math.abs(memberPortrait.width / memberPortrait.height - 0.75) < 0.1);
  await teamDivider.evaluate((divider) => divider.blur());
  assert.equal(
    await teamDivider.evaluate(
      (divider) => getComputedStyle(divider, "::after").width,
    ),
    "1px",
    "The visible divider should be one pixel wide",
  );
  await page.screenshot({
    path: "test-results/team-panel-wide.png",
    fullPage: true,
  });
  await teamDivider.press("Home");
  const savedPanelLayout = await page.evaluate(() =>
    localStorage.getItem("scully-panel-layout-v1"),
  );
  assert(savedPanelLayout);
  await page.screenshot({ path: "test-results/room.png", fullPage: true });
  await page.getByRole("button", { name: "New task", exact: false }).click();
  await page
    .getByRole("textbox", { name: "Start a task" })
    .fill("Persistence smoke test. Keep existing work intact.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page
    .getByRole("alert")
    .getByText("Connect Nebius to talk with Pearl.")
    .waitFor();
  assert.equal(
    (await page.evaluate(async () => (await window.scully.load()).tasks))
      .length,
    0,
  );
  await page.evaluate(async () => {
    const created = await window.scully.createTask({
      title: "Persistence smoke test",
      description: "Persistence smoke test. Keep existing work intact.",
      mode: "plan",
    });
    await window.scully.prepareRun(created.id, null, []);
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Persistence smoke test", exact: true })
    .click();
  await page
    .getByRole("region", { name: "Task conversation" })
    .getByRole("heading", { name: "Persistence smoke test" })
    .waitFor();
  const roomPanel = await page.locator(".main-panel").boundingBox();
  const taskComposer = await page.locator(".room-composer").boundingBox();
  assert(roomPanel && taskComposer);
  assert(
    roomPanel.y + roomPanel.height - (taskComposer.y + taskComposer.height) <
      40,
    "A short Room conversation should keep its composer at the bottom of the center panel",
  );
  await page.screenshot({
    path: "test-results/first-task-room.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Task", exact: true }).click();
  await page.getByRole("button", { name: "Edit task" }).click();
  await page
    .getByRole("dialog", { name: "Edit task" })
    .getByLabel("What should the team know?")
    .fill("Keep existing work intact and review it.");
  await page.getByRole("button", { name: "Save changes" }).click();
  assert.equal(
    (await page.evaluate(async () => (await window.scully.load()).tasks[0]))
      .description,
    "Keep existing work intact and review it.",
  );
  await page.evaluate(async () => {
    await window.scully.createTask({
      title: "Disposable smoke task",
      description: "Disposable smoke task",
      mode: "plan",
    });
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Disposable smoke task", exact: true })
    .click();
  await page.getByRole("button", { name: "Task", exact: true }).click();
  const disposableId = await page.evaluate(
    async () => (await window.scully.load()).tasks[0].id,
  );
  await page.getByRole("button", { name: "Remove task" }).click();
  const deleteDialog = page.getByRole("dialog", { name: "Delete task?" });
  await deleteDialog.getByRole("button", { name: "Delete task" }).click();
  await page
    .getByRole("heading", { name: "What would you like to build?" })
    .waitFor();
  assert.equal(
    await page.evaluate(
      async (id) => (await window.scully.runs(id)).length,
      disposableId,
    ),
    0,
  );
  await page
    .getByRole("button", { name: "Persistence smoke test", exact: true })
    .click();
  await page.getByRole("button", { name: "Task", exact: true }).click();
  await page.getByRole("button", { name: "Request plan" }).waitFor();
  await page.getByRole("button", { name: "Change project source" }).click();
  await page.getByRole("radio", { name: "New project" }).waitFor();
  await page.getByRole("button", { name: "Prepare project plan" }).click();
  await page.getByRole("button", { name: "Request plan" }).waitFor();
  await page.getByRole("heading", { name: "Start with a plan" }).waitFor();
  assert.equal(
    await page.getByRole("region", { name: "Team conversation" }).count(),
    0,
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "App & connection" }).click();
  await page.getByRole("region", { name: "Planning settings" }).waitFor();
  await page.getByRole("region", { name: "Teammate models" }).waitFor();
  await page
    .getByRole("button", { name: "Pearl model: Nemotron 3 Super" })
    .waitFor();
  await page
    .getByRole("button", { name: "Builders model: Nemotron 3.5 Lightning" })
    .waitFor();
  assert.equal(
    (await page.evaluate(() => window.scully.roleModelSettings())).pearl,
    "nvidia/nemotron-3-super-120b-a12b",
  );
  const planningTemperature = page.getByRole("slider", {
    name: /Planning temperature/,
  });
  await planningTemperature.focus();
  await planningTemperature.press("ArrowRight");
  await planningTemperature.press("ArrowRight");
  await page.getByRole("button", { name: "Save planning temperature" }).click();
  assert.deepEqual(
    await page.evaluate(() => window.scully.planningSettings()),
    {
      temperature: 0.4,
    },
  );
  await page.getByText("Planning temperature saved.").waitFor();
  await page
    .locator(".settings-save-banner")
    .screenshot({ path: "test-results/planning-temperature-saved.png" });
  await page
    .getByText("Planning temperature saved.")
    .waitFor({ state: "hidden", timeout: 5000 });
  await page.getByRole("button", { name: "Messages", exact: true }).click();
  await page.getByRole("region", { name: "Message settings" }).waitFor();
  await page.getByRole("button", { name: /Let me choose/ }).click();
  assert.deepEqual(
    await page.evaluate(() => window.scully.messageRoutingSettings()),
    { unclear: "ask", specialistConsultation: "automatic" },
  );
  await page.getByRole("button", { name: /Ask me first/ }).click();
  assert.deepEqual(
    await page.evaluate(() => window.scully.messageRoutingSettings()),
    { unclear: "ask", specialistConsultation: "ask" },
  );
  await page.getByRole("button", { name: /Let Pearl consult/ }).click();
  await page.getByRole("button", { name: /Ask Pearl/ }).click();
  await page.getByRole("button", { name: "Room", exact: true }).click();
  await page.getByRole("textbox", { name: "Message your team" }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: /Task model:/ }).count(),
    0,
  );
  assert.equal(
    await page.getByText(/0 input \+ 0 output tokens reported/).count(),
    0,
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Run usage", exact: true }).click();
  const settingsHeadingBounds = await page
    .getByRole("heading", { name: "Settings", exact: true })
    .boundingBox();
  const settingsSwitchBounds = await page
    .getByRole("button", { name: "Run usage", exact: true })
    .boundingBox();
  assert(settingsHeadingBounds && settingsSwitchBounds);
  assert(
    settingsSwitchBounds.y <
      settingsHeadingBounds.y + settingsHeadingBounds.height + 120,
    "Run usage switcher should stay directly below the settings heading",
  );
  await page.getByRole("region", { name: "Run usage policy" }).waitFor();
  await page.getByRole("region", { name: "Usage alerts and pauses" }).waitFor();
  await page.getByText("Configure usage alerts", { exact: true }).click();
  await page.getByLabel("Run token budget").fill("12000");
  await page.getByRole("button", { name: "Save alert settings" }).click();
  await page.getByText(/Budget: 12,000 tokens/).waitFor();
  const costPanel = page.getByRole("region", { name: "Model cost estimates" });
  await costPanel.getByText(/No USD warning budget set/).waitFor();
  await costPanel.getByLabel("USD warning budget").fill("2.50");
  await costPanel.getByRole("button", { name: "Save cost settings" }).click();
  await costPanel.getByText(/USD warning budget: \$2.50/).waitFor();
  await costPanel.getByText(/Nebius Sandboxes: 0 check attempts/).waitFor();
  await costPanel.getByText(/Tavily: not connected in this build/).waitFor();
  await page.getByRole("button", { name: "Task", exact: true }).click();
  await page.getByRole("button", { name: /12,000 token budget/ }).waitFor();
  await page
    .getByRole("button", { name: /\$2\.50 USD warning budget/ })
    .waitFor();
  assert.equal(
    await page.getByRole("region", { name: "Work assignments" }).count(),
    0,
  );
  await page.getByRole("button", { name: "Room", exact: true }).click();
  await page.getByRole("textbox", { name: "Message your team" }).waitFor();
  await assert.rejects(
    page.evaluate(async () => {
      const task = (await window.scully.load()).tasks.find(
        (item) => item.title === "Persistence smoke test",
      );
      if (!task) throw new Error("Missing smoke task");
      const run = (await window.scully.runs(task.id))[0];
      await window.scully.configureCoordination(run.id, {
        ownership: "jun checks/",
        chunkReviews: true,
      });
    }),
  );
  const prepared = await page.evaluate(async () => {
    const w = await window.scully.load();
    return (await window.scully.runs(w.tasks[0].id))[0];
  });
  assert.equal(prepared.planning?.version, 2);
  await assert.rejects(
    page.evaluate((id) => window.scully.startRun(id, false), prepared.id),
  );
  await page.screenshot({
    path: "test-results/run-consent.png",
    fullPage: true,
  });

  const source = join(sourceRoot, "source-fixture");
  await mkdir(source);
  await writeFile(join(source, "main.py"), 'print("original")');
  await writeFile(join(source, ".env"), "private fixture");
  await app.evaluate(({ dialog }, source) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [source],
    });
  }, source);
  await page.evaluate(async () => {
    const created = await window.scully.createTask({
      title: "Existing project smoke test",
      description: "Existing project smoke test",
      mode: "plan",
    });
    await window.scully.prepareRun(created.id, null, []);
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Existing project smoke test", exact: true })
    .click();
  await page.getByRole("button", { name: "Task", exact: true }).click();
  await page.getByRole("button", { name: "Change project source" }).click();
  await page.getByLabel("Existing project", { exact: true }).check();
  const sourceButton = await page
    .getByRole("button", { name: "Choose source folder" })
    .boundingBox();
  const prepareButton = await page
    .getByRole("button", { name: "Prepare project plan" })
    .boundingBox();
  assert(sourceButton && prepareButton);
  assert(
    prepareButton.y >= sourceButton.y + sourceButton.height + 12,
    "Source selection and preparation should be on separate rows",
  );
  await page.getByRole("button", { name: "Choose source folder" }).click();
  await page.getByRole("checkbox", { name: "main.py" }).check();
  await page.getByRole("button", { name: "Prepare project plan" }).click();
  await page.getByRole("button", { name: "Request plan" }).waitFor();
  const snapshot = await page.evaluate(async () => {
    const w = await window.scully.load();
    return (await window.scully.runs(w.tasks[0].id))[0];
  });
  assert.deepEqual(snapshot.files, [
    { path: "main.py", content: 'print("original")' },
  ]);
  await page.getByRole("button", { name: "Changes", exact: true }).click();
  await page
    .getByRole("heading", { name: "Set up Git for this project" })
    .waitFor();
  await page.screenshot({ path: "test-results/git-setup.png", fullPage: true });
  await page.getByRole("button", { name: "Initialize Git here" }).click();
  await page.getByText(/No commits yet/).waitFor();
  assert.equal(
    (await page.evaluate((id) => window.scully.gitHistory(id), snapshot.id))
      .state,
    "ready",
  );
  await page.screenshot({
    path: "test-results/git-history-empty.png",
    fullPage: true,
  });
  execFileSync("git", ["-C", source, "config", "user.name", "Fixture User"]);
  execFileSync("git", [
    "-C",
    source,
    "config",
    "user.email",
    "fixture@example.invalid",
  ]);
  execFileSync("git", ["-C", source, "add", "main.py"]);
  execFileSync("git", [
    "-C",
    source,
    "commit",
    "--quiet",
    "-m",
    "Initial project snapshot",
  ]);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page
    .getByRole("heading", { name: "Initial project snapshot" })
    .waitFor();
  await page.getByRole("button", { name: "Collapse task list" }).click();
  await page.getByRole("button", { name: "Collapse team panel" }).click();
  await page.waitForTimeout(400);
  await page.screenshot({
    path: "test-results/git-history-graph.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Expand task list" }).click();
  await page.getByRole("button", { name: "Expand team panel" }).click();
  await page.getByRole("button", { name: "Task", exact: true }).click();
  await page.getByRole("tab", { name: "Files", exact: true }).click();
  const projectFiles = page.getByRole("region", { name: "Project files" });
  await projectFiles.getByText("main.py").waitFor();
  assert.equal(
    await projectFiles.getByText('print("original")').isVisible(),
    false,
  );
  await page.getByRole("tab", { name: "Team", exact: true }).click();
  assert.equal(
    await readFile(join(source, "main.py"), "utf8"),
    'print("original")',
  );

  const workerResult = await app.evaluate(
    async ({ utilityProcess, app }, input) =>
      new Promise((resolve, reject) => {
        const worker = utilityProcess.fork(
          app.getAppPath() + "/dist/worker.cjs",
          [],
          { env: {}, stdio: "ignore" },
        );
        const timeout = setTimeout(() => {
          worker.kill();
          reject(new Error("Worker smoke timeout"));
        }, 10000);
        worker.on("message", (message) => {
          if (message.done || message.failed) {
            clearTimeout(timeout);
            worker.kill();
            resolve(message);
          }
        });
        worker.postMessage(input);
      }),
    {
      run: {
        ...snapshot,
        planning: undefined,
        collaboration: undefined,
        workspaceMode: undefined,
        projectWorkspace: undefined,
        usagePolicy: { ...snapshot.usagePolicy, requestCeiling: 4 },
        calls: 4,
      },
      task: {
        id: snapshot.taskId,
        title: "Test",
        description: "",
        mode: "work",
      },
      team: snapshot.teamSnapshot.members,
      config: {
        key: "not-a-real-key",
        model: "not-a-real-model",
        outputTokens: 512,
      },
      outputRoot: join(state, "unused-draft"),
    },
  );
  assert.equal(workerResult.run.status, "failed");
  assert.equal(workerResult.run.error, "Run call limit reached");
  // Seed a synthetic completed draft. Only this known local assertion will execute.
  const commandFixture = (() => {
    const spec = {
      executable: "node",
      args: ["--test", "test.js"],
      cwd: ".",
      reason: "Synthetic approval smoke check",
      timeoutSeconds: 30,
    };
    const run = {
      ...snapshot,
      planning: undefined,
      collaboration: undefined,
      workspaceMode: undefined,
      projectWorkspace: undefined,
      coordination: {
        ...snapshot.coordination,
        assignments: [
          {
            owner: "maya",
            scope: "Implementation",
            status: "ready",
            summary: "",
            files: [],
          },
          {
            owner: "jun",
            scope: "Tests",
            status: "ready",
            summary: "",
            files: [],
          },
        ],
        integrator: "maya",
        auditor: "ellis",
        conflicts: [],
        metrics: { writerWallMs: 0, integrationMs: 0, writerTotalMs: 0 },
      },
      status: "complete",
      drafts: [
        {
          path: "test.js",
          content:
            'require("node:assert/strict").equal(2 + 2, 4); console.log("offline fixture verified");',
          before: null,
        },
      ],
    };
    const merged = new Map(run.files.map((f) => [f.path, f.content]));
    for (const f of run.drafts) merged.set(f.path, f.content);
    const snapshotHash = createHash("sha256")
      .update(
        JSON.stringify([...merged].sort(([a], [b]) => a.localeCompare(b))),
      )
      .digest("hex");
    run.coordination.integratedRevision = snapshotHash;
    run.coordination.auditedRevision = snapshotHash;
    run.suggestions = [
      {
        id: "smoke-suggestion",
        text: "Consider a usage guide later",
        actor: "ellis",
        revision: snapshotHash,
      },
    ];
    const finding = {
      path: "test.js",
      severity: "warning",
      detail: "Check the arithmetic assertion",
    };
    const findingLink = {
      auditIndex: 0,
      findingIndex: 0,
      revision: snapshotHash,
      ...finding,
      expected: "Assertion exits zero",
    };
    run.specialistAudits = [
      {
        kind: "testing",
        revision: snapshotHash,
        status: "needs-review",
        calls: 2,
        summary: "Synthetic finding",
        findings: [finding],
        response: "Run the fixture",
      },
    ];
    const revision = createHash("sha256")
      .update(
        JSON.stringify({
          id: run.id,
          taskId: run.taskId,
          files: run.files,
          drafts: run.drafts,
          plan: run.plan,
          commands: [spec],
          findingLinks: [findingLink],
        }),
      )
      .digest("hex");
    run.commands = [
      {
        ...spec,
        id: "smoke-command",
        revision,
        decision: "pending",
        findingLink,
      },
    ];
    const db = new DatabaseSync(join(state, "workspace.sqlite"));
    db.prepare("UPDATE runs SET data=? WHERE id=?").run(
      JSON.stringify(run),
      run.id,
    );
    db.close();
    return run;
  })();
  await page.reload();
  await page
    .getByRole("button", { name: "Persistence smoke test", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Existing project smoke test", exact: true })
    .click();
  await page.getByRole("button", { name: "Task", exact: true }).click();
  await page
    .getByText("Consider a usage guide later", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Mark reviewed", exact: true })
    .click();
  await page.getByText("Reviewed, not scheduled", { exact: true }).waitFor();
  assert.deepEqual(
    await page.evaluate(
      async (id) => (await window.scully.runs(id))[0].reviewedSuggestionIds,
      commandFixture.taskId,
    ),
    ["smoke-suggestion"],
  );
  await page
    .getByRole("button", { name: "Audit testing", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "Dispatch testing auditor", exact: true })
      .isEnabled(),
    false,
  );
  await page
    .getByLabel("I approve this specialist upload and up to two requests.")
    .check();
  await page
    .getByRole("button", { name: "Audit security", exact: true })
    .click();
  assert.equal(
    await page
      .getByLabel("I approve this specialist upload and up to two requests.")
      .isChecked(),
    false,
  );
  await assert.rejects(
    page.evaluate(
      (id) => window.scully.startAudit(id, "security", "stale", false),
      commandFixture.id,
    ),
  );
  await page
    .getByRole("region", { name: "Specialist audits" })
    .screenshot({ path: "test-results/specialist-audits.png" });
  await page
    .getByRole("button", { name: "Record approval for check 1" })
    .click();
  await page.getByText(/Decision: approved/).waitFor();
  await assert.rejects(
    page.evaluate(
      (id) =>
        window.scully.decideCommand(id, "smoke-command", "stale", "denied"),
      commandFixture.id,
    ),
  );
  await page.screenshot({
    path: "test-results/command-review.png",
    fullPage: true,
  });
  const challenge = await page.evaluate(
    (id) => window.scully.reviewExecution(id, "smoke-command"),
    commandFixture.id,
  );
  await assert.rejects(
    page.evaluate(
      (token) => window.scully.executeCommand(token, false),
      challenge.token,
    ),
  );
  await page.getByRole("button", { name: /Review local execution/ }).click();
  const executeButton = page.getByRole("button", {
    name: "Approve and run locally",
  });
  await executeButton.waitFor();
  assert.equal(await executeButton.isDisabled(), true);
  await page
    .getByRole("checkbox", { name: /I permit this exact command/ })
    .check();
  await executeButton.click();
  await page.getByText(/Process exited successfully/).waitFor();
  await page
    .getByRole("region", { name: "Specialist audits" })
    .getByText(/Matches reviewed proposal/)
    .waitFor();
  await page
    .getByRole("region", { name: "Specialist audits" })
    .getByText(/Execution does not resolve/)
    .waitFor();
  await page
    .getByRole("region", { name: "Specialist audits" })
    .screenshot({ path: "test-results/focused-check-result.png" });
  const decisionPanel = page.getByRole("region", {
    name: "Finding 1 decision",
  });
  await decisionPanel
    .getByText("Review evidence and record a decision")
    .click();
  await decisionPanel
    .getByLabel("Decision reason")
    .fill("Reviewed the known fixture assertion and its output.");
  await decisionPanel.getByLabel("resolved", { exact: true }).check();
  assert.equal(
    await decisionPanel
      .getByRole("button", { name: "Record finding decision" })
      .isEnabled(),
    false,
  );
  await decisionPanel.getByRole("checkbox").check();
  await decisionPanel
    .getByRole("button", { name: "Record finding decision" })
    .click();
  await decisionPanel.getByText(/Decision: resolved/).waitFor();
  await decisionPanel.screenshot({ path: "test-results/finding-decision.png" });
  assert(
    (await page.getByLabel("Command output").textContent()).includes(
      "offline fixture verified",
    ),
  );
  assert.equal(
    await readFile(join(source, "main.py"), "utf8"),
    'print("original")',
  );
  await page
    .getByRole("region", { name: "Local execution" })
    .screenshot({ path: "test-results/local-execution.png" });
  const cloudPanel = page.getByRole("region", { name: "Cloud execution" });
  await cloudPanel.getByLabel("Sandbox project ID").fill("aiproject-fixture");
  await cloudPanel.getByLabel("Sandbox API key").fill("fixture-only-key");
  await cloudPanel
    .getByRole("button", { name: "Use for this app session" })
    .click();
  await cloudPanel
    .getByRole("button", { name: "Find sandbox images" })
    .waitFor();
  assert.equal(
    await cloudPanel
      .getByRole("button", { name: /Review cloud check/ })
      .isDisabled(),
    true,
  );
  const saveEnvironment = cloudPanel.getByRole("checkbox", {
    name: "Save this environment for another experiment",
  });
  assert.equal(await saveEnvironment.isChecked(), false);
  await saveEnvironment.check();
  await cloudPanel.getByText(/does not yet provide remote deletion/).waitFor();
  await saveEnvironment.uncheck();
  await assert.rejects(
    page.evaluate(
      (id) =>
        window.scully.reviewCloud(
          id,
          "smoke-command",
          "12345678-9abc-baba-deda-0123456789ab",
          "/bin/echo",
          { saveChanges: "yes" },
        ),
      commandFixture.id,
    ),
    /Invalid cloud review options/,
  );
  await assert.rejects(
    page.evaluate(
      (id) =>
        window.scully.resolveCloudExecutable(
          id,
          "smoke-command",
          "12345678-9abc-baba-deda-0123456789ab",
          "missing-parent",
        ),
      commandFixture.id,
    ),
    /Saved environment/,
  );
  await cloudPanel.screenshot({ path: "test-results/cloud-image-picker.png" });
  await page
    .getByRole("button", { name: "Choose destination and review" })
    .click();
  const applyButton = page.getByRole("button", {
    name: "Apply reviewed files",
  });
  await applyButton.waitFor();
  assert.equal(await applyButton.isDisabled(), true);
  await assert.rejects(readFile(join(source, "test.js")));
  await page
    .getByRole("checkbox", { name: /I approve writing these exact files/ })
    .check();
  await applyButton.click();
  await page.getByRole("heading", { name: "Application: applied" }).waitFor();
  await page.getByRole("button", { name: "Inspect recovery state" }).click();
  await page
    .getByRole("region", { name: "Recovery inspection" })
    .getByText("Manifest matches the saved application record.")
    .waitFor();
  await page
    .getByRole("region", { name: "Recovery inspection" })
    .getByText(/Added file; no original backup required/)
    .waitFor();
  await assert.rejects(
    page.evaluate(
      (id) => window.scully.inspectApplyRecovery(id, "../escape"),
      commandFixture.id,
    ),
  );
  assert.equal(
    await readFile(join(source, "test.js"), "utf8"),
    commandFixture.drafts[0].content,
  );
  assert.equal(
    await readFile(join(source, "main.py"), "utf8"),
    'print("original")',
  );
  assert.equal(await readFile(join(source, ".env"), "utf8"), "private fixture");
  await page
    .getByRole("region", { name: "Review and apply" })
    .screenshot({ path: "test-results/apply-result.png" });
  await page.getByRole("button", { name: "Manage team" }).click();
  await page
    .getByRole("region", { name: "Team settings" })
    .screenshot({ path: "test-results/team-settings.png" });
  await page.getByRole("button", { name: "Open full profile" }).click();
  await page.getByText("Working instructions", { exact: true }).waitFor();
  const profileViewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  await page.setViewportSize({ width: profileViewport.width, height: 750 });
  await assertPanelScrolls(page, ".main-panel", "Full profile");
  await page.screenshot({ path: "test-results/profile-scroll.png" });
  await page.setViewportSize(profileViewport);
  const fullArt = await page
    .locator(".full-profile .profile-art")
    .boundingBox();
  const fullPortrait = await page
    .locator(".full-profile .profile-art .portrait")
    .boundingBox();
  assert(fullArt && fullPortrait);
  assert(Math.abs(fullArt.width - fullPortrait.width) < 2);
  assert(Math.abs(fullArt.height - fullPortrait.height) < 2);
  let activityBeforeRestart = await page.evaluate(
    async () => (await window.scully.load()).activity,
  );
  assert(activityBeforeRestart.scannedRuns > 0);
  assert.equal(
    await page
      .locator(".full-profile .profile-stats strong")
      .first()
      .textContent(),
    String(activityBeforeRestart.byTeammate.ellis.recordedEvents),
  );
  await page
    .locator(".full-profile")
    .getByRole("button", { name: "Refresh activity" })
    .click();
  await page.screenshot({ path: "test-results/profile.png", fullPage: true });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const savedTeamsPanel = page.getByRole("region", { name: "Team settings" });
  const teamCostPreview = savedTeamsPanel.getByRole("region", {
    name: "Team and cost preview",
  });
  await teamCostPreview.getByText(/4 required model requests/).waitFor();
  await savedTeamsPanel
    .getByRole("button", { name: "Choose team members" })
    .click();
  const rosterDialog = page.getByRole("dialog", {
    name: "Choose team members",
  });
  assert.equal(
    await rosterDialog.locator(".fixed-character-choice").count(),
    16,
  );
  assert.equal(await rosterDialog.getByRole("checkbox").count(), 0);
  const coordinatorCard = await rosterDialog
    .getByRole("button", { name: "Pearl, Coordinator" })
    .boundingBox();
  assert(coordinatorCard && coordinatorCard.width > 250);
  await rosterDialog.getByRole("button", { name: /Sloane/ }).click();
  await rosterDialog.getByRole("button", { name: /Tessa/ }).click();
  await rosterDialog.getByLabel("Legacy default builder").selectOption("tessa");
  await rosterDialog.locator(".roster-scroll").evaluate((scroll) => {
    scroll.scrollTop = 0;
  });
  await rosterDialog.screenshot({
    path: "test-results/fixed-character-roster.png",
  });
  await rosterDialog.getByRole("button", { name: "Save team roster" }).click();
  await savedTeamsPanel
    .getByRole("heading", { name: "Team members (6/16)" })
    .waitFor();
  await teamCostPreview.getByText(/4 required model requests/).waitFor();
  const teamAfterRoster = await page.evaluate(
    async () => (await window.scully.load()).teammates,
  );
  assert.equal(
    teamAfterRoster.find((person) => person.id === "sloane").runRole,
    "reserve",
  );
  assert.equal(
    teamAfterRoster.find((person) => person.id === "tessa").runRole,
    "builder",
  );
  assert.equal(
    teamAfterRoster.find((person) => person.id === "maya").runRole,
    "reserve",
  );
  await savedTeamsPanel.getByRole("button", { name: "Create team" }).click();
  await page
    .getByRole("dialog", { name: "Create team" })
    .getByRole("textbox", { name: "Team name" })
    .fill("Desktop smoke team");
  await page
    .getByRole("dialog", { name: "Create team" })
    .getByRole("button", { name: "Create team" })
    .click();
  await savedTeamsPanel
    .getByRole("heading", { name: "Desktop smoke team" })
    .waitFor();
  await savedTeamsPanel.screenshot({ path: "test-results/team-library.png" });
  const teamJourney = await page.evaluate(async () => {
    const before = await window.scully.load();
    const task = await window.scully.createTask({
      title: "Saved team snapshot check",
      description: "",
      mode: "work",
    });
    const run = await window.scully.prepareRun(task.id, null, []);
    const current = before.savedTeams.find(
      (saved) => saved.id === before.defaultTeamId,
    );
    const edited = await window.scully.saveTeam({
      name: "Edited desktop team",
      ...current.roster,
      expectedDefaultTeamId: current.id,
      saveMode: "overwrite",
    });
    const previous = before.savedTeams.find(
      (saved) => saved.kind === "library" && saved.name === "Scully team",
    );
    await window.scully.setDefaultTeam(previous.id);
    await window.scully.deleteTeam(edited.id);
    const deleted = await window.scully.load();
    await window.scully.restoreTeam(edited.id);
    const after = await window.scully.load();
    return { task, run, before, after, edited, deleted };
  });
  assert.notEqual(
    teamJourney.task.teamConfigId,
    teamJourney.before.defaultTeamId,
  );
  assert.equal(teamJourney.run.teamSnapshot.id, teamJourney.task.teamConfigId);
  assert.equal(teamJourney.edited.id, teamJourney.before.defaultTeamId);
  assert.equal(teamJourney.run.teamSnapshot.name, "Desktop smoke team");
  assert.ok(
    teamJourney.deleted.savedTeams.find(
      (saved) => saved.id === teamJourney.edited.id,
    ).deletedAt,
  );
  assert.equal(
    teamJourney.after.savedTeams.find(
      (saved) => saved.id === teamJourney.edited.id,
    ).deletedAt,
    null,
  );
  assert.notEqual(
    teamJourney.after.defaultTeamId,
    teamJourney.task.teamConfigId,
  );
  assert.equal(
    teamJourney.after.tasks.find((task) => task.id === teamJourney.task.id)
      .teamConfigId,
    teamJourney.task.teamConfigId,
  );
  const archivedJourney = await page.evaluate(async (id) => {
    const before = await window.scully.taskDisposition(id);
    await window.scully.archiveTask(id);
    const archived = await window.scully.load();
    await window.scully.restoreTask(id);
    const restored = await window.scully.load();
    return {
      before,
      hidden: !archived.tasks.some((task) => task.id === id),
      listed: archived.archivedTasks.some((task) => task.id === id),
      restored: restored.tasks.some((task) => task.id === id),
      runCount: (await window.scully.runs(id)).length,
    };
  }, teamJourney.task.id);
  assert.equal(archivedJourney.before.canArchive, true);
  assert.equal(archivedJourney.hidden, true);
  assert.equal(archivedJourney.listed, true);
  assert.equal(archivedJourney.restored, true);
  assert.equal(archivedJourney.runCount, 1);
  activityBeforeRestart = teamJourney.after.activity;
  await assert.rejects(
    page.evaluate(() =>
      window.scully.createTask({ title: "", description: "", mode: "work" }),
    ),
  );
  await assert.rejects(
    page.evaluate(() =>
      window.scully.updateTeammate({
        id: "invalid",
        name: "x",
        role: "x",
        bio: "x",
        instructions: "x",
      }),
    ),
  );
  assert.deepEqual(errors, []);
  await app.close();
  app = null;
  app = await launch();
  page = await app.firstWindow();
  await page
    .getByRole("heading", { name: "What would you like to build?" })
    .waitFor();
  assert.equal(
    await page.evaluate(() => localStorage.getItem("scully-panel-layout-v1")),
    savedPanelLayout,
    "Panel widths should persist after restart",
  );
  assert.deepEqual(
    await page.evaluate(async () => (await window.scully.load()).activity),
    activityBeforeRestart,
  );
  assert.deepEqual(
    await page.evaluate(async () => (await window.scully.load()).teammates),
    teamAfterRoster,
  );
  await page
    .getByRole("img", { name: /Ellis portrait: Brown curls and glasses/ })
    .first()
    .waitFor();
  await page
    .getByRole("button", { name: "Persistence smoke test", exact: true })
    .click();
  await page.getByRole("button", { name: "Task", exact: true }).click();
  await page.getByRole("button", { name: /12,000 token budget/ }).waitFor();
  await page
    .getByRole("button", { name: /\$2\.50 USD warning budget/ })
    .waitFor();
  await page
    .getByRole("button", { name: "Existing project smoke test", exact: true })
    .click();
  await page.getByRole("button", { name: "Task", exact: true }).click();
  await page.getByText(/Decision: expired/).waitFor();
  await page.getByRole("heading", { name: "Application: applied" }).waitFor();
  await page.getByRole("button", { name: "Inspect recovery state" }).click();
  await page
    .getByRole("region", { name: "Recovery inspection" })
    .getByText("Manifest matches the saved application record.")
    .waitFor();
  await page.getByText(/Process exited successfully/).waitFor();
  await page
    .getByRole("button", { name: "Persistence smoke test", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Prepare corrective draft", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Corrective attempt", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Build and audit", exact: true })
      .isEnabled(),
    false,
  );
  const correctionRuns = await page.evaluate(
    (id) => window.scully.runs(id),
    snapshot.taskId,
  );
  const correction = correctionRuns.find(
    (r) => r.correction?.parentId === commandFixture.id,
  );
  assert(correction);
  assert.equal(correction.calls, 0);
  assert.equal(correction.status, "prepared");
  assert.equal(correction.executions, undefined);
  assert.equal(
    correctionRuns.find((r) => r.id === commandFixture.id).applications[0]
      .status,
    "applied",
  );
  await page.screenshot({
    path: "test-results/corrective-attempt.png",
    fullPage: true,
  });
  await page.getByText("Saved for this task", { exact: true }).waitFor();
  await page
    .locator(".team-sidebar")
    .getByRole("heading", { name: "Scully team" })
    .waitFor();
  await page
    .getByRole("button", { name: "Persistence smoke test", exact: true })
    .click();
  await page.getByRole("button", { name: "Task", exact: true }).click();
  await page.getByRole("button", { name: /No lifetime request cap/ }).waitFor();
  const localMetrics = await page.evaluate(() => window.scully.metrics());
  assert(
    localMetrics.events.some(
      (e) => e.operation === "correction:prepare" && e.outcome === "returned",
    ),
  );
  assert(localMetrics.events.length <= 1000);
  for (const event of localMetrics.events)
    assert.deepEqual(Object.keys(event).sort(), [
      "at",
      "durationMs",
      "operation",
      "outcome",
      "version",
    ]);
  assert(!JSON.stringify(localMetrics).includes("source-fixture"));
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "App & connection" }).click();
  await page
    .getByRole("button", { name: "Refresh local metrics", exact: true })
    .click();
  await page.getByText(/retained events/).waitFor();
  await page
    .getByRole("region", { name: "Local metrics" })
    .screenshot({ path: "test-results/local-metrics.png" });
  await page.getByRole("button", { name: "Refresh storage inventory" }).click();
  await page
    .getByRole("region", { name: "Local storage" })
    .getByText(/Application backups.*items, .*files, .*bytes/)
    .waitFor();
  await page
    .getByRole("region", { name: "Local storage" })
    .getByText(/Check copy names:.*match saved runs/)
    .waitFor();
  // Advance a saved run with a local fixture so messaging can be exercised
  // after planning starts without contacting a provider.
  const messageFixture = await page.evaluate(async () => {
    const task = (await window.scully.load()).tasks.find(
      (item) => item.title === "Persistence smoke test",
    );
    if (!task) throw new Error("Missing message fixture task");
    return (await window.scully.runs(task.id))[0];
  });
  messageFixture.status = "planned";
  messageFixture.plan = "Review the task before implementation";
  messageFixture.calls = 1;
  const messageDb = new DatabaseSync(join(state, "workspace.sqlite"));
  messageDb
    .prepare("UPDATE runs SET data=? WHERE id=?")
    .run(JSON.stringify(messageFixture), messageFixture.id);
  messageDb.close();
  await page.evaluate(async () => {
    const task = (await window.scully.load()).tasks.find(
      (item) => item.title === "Persistence smoke test",
    );
    const run = (await window.scully.runs(task.id))[0];
    await window.scully.sendTeamMessage(run.id, {
      text: "@Maya what should we build first?",
      intent: "continue",
    });
    await window.scully.sendTeamMessage(run.id, {
      text: "@Jun keep accessibility in mind",
      intent: "continue",
    });
  });
  await page.getByRole("button", { name: "Room", exact: true }).click();
  const conversation = page.getByRole("region", { name: "Task conversation" });
  await conversation
    .getByRole("heading", { name: "Persistence smoke test" })
    .waitFor();
  await conversation
    .locator(".room-chat-timeline")
    .getByText("@Maya what should we build first?")
    .first()
    .waitFor();
  const roomViewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  await page.setViewportSize({ width: roomViewport.width, height: 620 });
  await assertPanelScrolls(page, ".room-chat-timeline", "Task conversation");
  assert.equal(
    await page.locator(".main-panel").evaluate((panel) => panel.scrollTop),
    0,
  );
  const timelineBounds = await page
    .locator(".room-chat-timeline")
    .boundingBox();
  const composerBounds = await page.locator(".room-composer").boundingBox();
  assert(
    timelineBounds &&
      composerBounds &&
      timelineBounds.y + timelineBounds.height <= composerBounds.y,
  );
  await page.screenshot({ path: "test-results/room-scroll.png" });
  await page.setViewportSize(roomViewport);
  await page
    .getByRole("button", { name: "Existing project smoke test", exact: true })
    .click();
  await page
    .getByRole("region", { name: "Task conversation" })
    .getByRole("heading", { name: "Existing project smoke test" })
    .waitFor();
  assert.equal(
    await page.locator(".main-panel").evaluate((panel) => panel.scrollTop),
    0,
  );
  assert.equal(
    await page.getByText("@Maya what should we build first?").count(),
    0,
  );
  await page
    .getByRole("button", { name: "Persistence smoke test", exact: true })
    .click();
  await conversation
    .getByRole("heading", { name: "Persistence smoke test" })
    .waitFor();
  assert.equal(
    await page.evaluate(async () => {
      const task = (await window.scully.load()).tasks.find(
        (item) => item.title === "Persistence smoke test",
      );
      return (await window.scully.runs(task.id))[0].replies?.length || 0;
    }),
    0,
  );
  await conversation.getByText("@Jun keep accessibility in mind").waitFor();
  await page.evaluate(() =>
    window.scully.configureSession({
      key: "fixture-only-key",
      model: "fixture-model",
      outputTokens: 1024,
    }),
  );
  const routedReview = await page.evaluate(async () => {
    const task = (await window.scully.load()).tasks.find(
      (item) => item.title === "Persistence smoke test",
    );
    const run = (await window.scully.runs(task.id))[0];
    const message = run.messages.find(
      (item) => item.text === "@Jun keep accessibility in mind",
    );
    return window.scully.reviewRoutedReply(run.id, message.id);
  });
  assert.equal(routedReview.routing.recipientId, "jun");
  assert.equal(routedReview.review.recipient.id, "jun");
  assert.match(routedReview.review.context, /@Jun keep accessibility in mind/);
  await assert.rejects(
    page.evaluate(async () => {
      const task = (await window.scully.load()).tasks.find(
        (item) => item.title === "Persistence smoke test",
      );
      const run = (await window.scully.runs(task.id))[0];
      return window.scully.autoAnswerMessage(run.id, run.messages.at(-1).id);
    }),
  );
  await page.evaluate(async () => {
    const task = (await window.scully.load()).tasks.find(
      (item) => item.title === "Persistence smoke test",
    );
    const run = (await window.scully.runs(task.id))[0];
    await window.scully.sendTeamMessage(run.id, {
      text: "Use a command line interface instead",
      intent: "replan",
    });
  });
  await page.getByRole("button", { name: "Task", exact: true }).click();
  assert.equal(
    await page.getByRole("heading", { name: "Revised plan context" }).count(),
    0,
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Run usage" }).click();
  await page.getByLabel("Optional request cap").fill("24");
  await page.getByRole("button", { name: "Save usage limit" }).click();
  await page.getByText(/User-set cap: 24 model requests/).waitFor();
  await page.getByRole("button", { name: "Room", exact: true }).click();
  await page
    .getByText("Use a command line interface instead", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Task", exact: true }).click();
  assert.equal(
    await page.getByRole("heading", { name: "Revised plan context" }).count(),
    0,
  );
  await page.getByRole("button", { name: /24 request cap/ }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Request plan", exact: true })
      .isEnabled(),
    false,
  );
  await page.screenshot({
    path: "test-results/revised-plan.png",
    fullPage: true,
  });
  await app.close();
  app = null;
  app = await launch();
  page = await app.firstWindow();
  await page
    .getByRole("button", { name: "Persistence smoke test", exact: true })
    .click();
  await page.getByRole("button", { name: "Task", exact: true }).click();
  assert.equal(
    await page.getByRole("heading", { name: "Revised plan context" }).count(),
    0,
  );
  await page.getByRole("button", { name: /24 request cap/ }).waitFor();
  await page.getByRole("button", { name: "Room", exact: true }).click();
  await page
    .getByText("Use a command line interface instead", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Task", exact: true }).click();
  // Exercise the planned-run review with a saved local fixture. No model call is made.
  const lineupFixture = await page.evaluate(async () => {
    const workspace = await window.scully.load();
    const task = workspace.tasks.find(
      (item) => item.title === "Persistence smoke test",
    );
    if (!task) throw new Error("Missing lineup fixture task");
    return { task, run: await window.scully.prepareRun(task.id, null, []) };
  });
  lineupFixture.run.status = "planned";
  lineupFixture.run.planning = undefined;
  lineupFixture.run.collaboration = undefined;
  lineupFixture.run.plan =
    "## Overview\nReview **account recovery** before implementation.";
  lineupFixture.run.calls = 1;
  const planRevision = createHash("sha256")
    .update(
      JSON.stringify({
        plan: lineupFixture.run.plan,
        files: lineupFixture.run.files,
        task: {
          title: lineupFixture.task.title,
          description: lineupFixture.task.description,
        },
        roster: lineupFixture.run.teamSnapshot.roster,
      }),
    )
    .digest("hex");
  lineupFixture.run.lineupProposal = {
    planRevision,
    discardedInvalid: false,
    core: {
      builderId: "maya",
      auditorId: "ellis",
      testerId: "jun",
      reason: "Maya builds, Jun tests, and Ellis independently reviews.",
      fallback: false,
    },
    suggestions: [
      {
        id: "kiran",
        phase: "verification",
        reason: "Review account recovery boundaries",
      },
    ],
  };
  const lineupDb = new DatabaseSync(join(state, "workspace.sqlite"));
  lineupDb
    .prepare("UPDATE runs SET data=? WHERE id=?")
    .run(JSON.stringify(lineupFixture.run), lineupFixture.run.id);
  lineupDb.close();
  await page
    .getByRole("button", { name: "Existing project smoke test", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Persistence smoke test", exact: true })
    .click();
  await page.getByRole("button", { name: "Task", exact: true }).click();
  assert.equal(
    await page.getByRole("region", { name: "Draft analysis" }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("region", { name: "Full plan" }).count(),
    0,
  );
  await page.getByRole("button", { name: "Room", exact: true }).click();
  await page.locator(".chat-team-role").first().waitFor();
  assert.equal(await page.locator(".chat-team-role").count(), 3);
  await page.screenshot({ path: "test-results/room-team-proposal.png" });
  await page.getByRole("button", { name: "Task", exact: true }).click();
  const lineupPanel = page.getByRole("region", {
    name: "Team lineup",
  });
  await lineupPanel.getByText("Review account recovery boundaries").waitFor();
  await lineupPanel.getByText(/Maya builds, Jun tests/).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Build and audit" }).isDisabled(),
    true,
  );
  await assert.rejects(
    page.evaluate(
      (id) => window.scully.approveLineup(id, "stale", [], true),
      lineupFixture.run.id,
    ),
  );
  await lineupPanel
    .getByRole("button", { name: "Approve team for this plan" })
    .click();
  await page.getByRole("button", { name: "Room", exact: true }).click();
  await page.getByRole("button", { name: "Task", exact: true }).click();
  const fullPlan = page.getByRole("region", { name: "Full plan" });
  await fullPlan.getByRole("button", { name: "Copy Markdown" }).click();
  assert.equal(
    await app.evaluate(({ clipboard }) => clipboard.readText()),
    lineupFixture.run.plan,
  );
  await fullPlan.getByRole("button", { name: "Copy text" }).click();
  assert.equal(
    await app.evaluate(({ clipboard }) => clipboard.readText()),
    "Overview\nReview account recovery before implementation.",
  );
  const collaborativePanel = page.getByRole("region", {
    name: "Collaborative build",
  });
  await collaborativePanel
    .getByRole("button", { name: "Review project scope" })
    .waitFor();
  assert.equal(
    await collaborativePanel
      .getByRole("button", { name: "Review project scope" })
      .isDisabled(),
    true,
  );
  assert.deepEqual(
    (
      await page.evaluate((id) => window.scully.runs(id), lineupFixture.task.id)
    )[0].approvedLineup.entries,
    [
      {
        id: "kiran",
        phase: "verification",
        purpose: "Review account recovery boundaries",
      },
    ],
  );
  await collaborativePanel.screenshot({
    path: "test-results/collaborative-scope.png",
  });
  const permanentDeleteJourney = await page.evaluate(async () => {
    const task = await window.scully.createTask({
      title: "Disposable archive check",
      description: "Only for the desktop smoke test",
      mode: "plan",
    });
    const run = await window.scully.prepareRun(task.id, null, []);
    const other = await window.scully.createTask({
      title: "Separate task check",
      description: "",
      mode: "plan",
    });
    await window.scully.archiveTask(task.id);
    let rejected = false;
    try {
      await window.scully.permanentlyDeleteArchivedTask(task.id, "Wrong title");
    } catch {
      rejected = true;
    }
    const deleted = await window.scully.permanentlyDeleteArchivedTask(
      task.id,
      task.title,
    );
    const workspace = await window.scully.load();
    return {
      rejected,
      deletedRuns: deleted.deletedRuns,
      removedFromArchive: !workspace.archivedTasks.some(
        (item) => item.id === task.id,
      ),
      otherRetained: workspace.tasks.some((item) => item.id === other.id),
      runsRemoved: (await window.scully.runs(task.id)).length === 0,
      otherActivity: (await window.scully.taskActivity(other.id)).scannedRuns,
      runId: run.id,
    };
  });
  assert.equal(permanentDeleteJourney.rejected, true);
  assert.equal(permanentDeleteJourney.deletedRuns, 1);
  assert.equal(permanentDeleteJourney.removedFromArchive, true);
  assert.equal(permanentDeleteJourney.otherRetained, true);
  assert.equal(permanentDeleteJourney.runsRemoved, true);
  assert.equal(permanentDeleteJourney.otherActivity, 0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "App & connection" }).click();
  const sandboxSettings = page.getByRole("region", {
    name: "Sandbox connection",
  });
  await sandboxSettings.waitFor();
  if (!(await sandboxSettings.getByText("Sandbox connection saved").count())) {
    await sandboxSettings
      .getByLabel("Sandbox project ID")
      .fill("aiproject-fixture");
    await sandboxSettings
      .getByLabel("Sandbox API key")
      .fill("fixture-only-key");
    await sandboxSettings
      .getByRole("button", { name: "Use for this app session" })
      .click();
  }
  await sandboxSettings.getByText("Sandbox connection saved").waitFor();
  const sandboxBannerGap = await sandboxSettings.evaluate((section) => {
    const banner = section.querySelector(".settings-save-banner");
    const form = section.querySelector(".sandbox-connection-form");
    if (!banner || !form) return -1;
    return (
      form.getBoundingClientRect().top - banner.getBoundingClientRect().bottom
    );
  });
  assert(
    sandboxBannerGap >= 12,
    "Sandbox saved banner needs space before the form",
  );
  await sandboxSettings.screenshot({
    path: "test-results/sandbox-connection-saved.png",
  });
  console.log(
    "PASS: desktop launch, renderer isolation, both project intakes, usage and cost settings, upload review, source preservation, offline planning, lineup approval, collaborative scope controls, command review and restart expiry, local fixture execution with fresh permission and persisted results, roster, activity, archive deletion and team persistence. No live provider or Sandbox request.",
  );
} finally {
  if (app) await app.close();
  await rm(state, { recursive: true, force: true });
  await rm(sourceRoot, { recursive: true, force: true });
}
