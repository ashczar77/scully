import { _electron as electron } from "playwright";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
const state = await mkdtemp(join(tmpdir(), "scully-shell-test-"));
const sourceRoot = await mkdtemp(join(tmpdir(), "scully-apply-fixture-"));
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
  await page.getByRole("heading", { name: "Team room." }).waitFor();
  await page.getByRole("heading", { name: "Start your first task." }).waitFor();
  const roomHeading = await page.locator(".room-heading").boundingBox();
  const welcome = await page.locator(".room-empty").boundingBox();
  assert(roomHeading && welcome);
  assert(
    welcome.y >= roomHeading.y + roomHeading.height &&
      welcome.y <= roomHeading.y + roomHeading.height + 90,
    "The welcome card should sit close below the room heading",
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
  const emptyMark = await page.locator(".room-empty-icon").boundingBox();
  const emptyLabel = await page.locator(".room-empty .eyebrow").boundingBox();
  assert(emptyMark && emptyLabel);
  assert(emptyMark.y + emptyMark.height <= emptyLabel.y);
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
      "updateTask",
      "deleteTask",
      "load",
      "updateTeammate",
      "applyTeamStyle",
      "saveTeam",
      "setDefaultTeam",
      "deleteTeam",
      "restoreTeam",
      "selectSource",
      "prepareRun",
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
      "configureUsagePolicy",
      "reviewUsagePolicy",
      "startRun",
      "approveLineup",
      "stopRun",
      "configureCoordination",
      "startAudit",
      "decideFinding",
      "prepareCorrection",
      "sendTeamMessage",
      "stopReply",
      "reviewSuggestion",
      "reviewReply",
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
  const newTaskDialog = page.getByRole("dialog", {
    name: "What shall we build?",
  });
  assert.equal(
    await newTaskDialog.evaluate(
      (dialog) => getComputedStyle(dialog).overflowY,
    ),
    "hidden",
  );
  assert.equal(
    await newTaskDialog
      .locator(".new-task-scroll")
      .evaluate((scroll) => getComputedStyle(scroll).scrollbarWidth),
    "none",
  );
  const planningLineup = newTaskDialog.getByRole("list", {
    name: "Current automatic lineup",
  });
  assert.equal(await planningLineup.getByRole("listitem").count(), 4);
  assert.match(
    await planningLineup.innerText(),
    /Pearl[\s\S]*Maya[\s\S]*Jun[\s\S]*Ellis/,
  );
  await newTaskDialog.screenshot({ path: "test-results/new-task-dialog.png" });
  await page.getByLabel("Task title").fill("Persistence smoke test");
  await page
    .getByLabel("What should the team know?")
    .fill("Keep existing work intact.");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await page.getByText("Your task has a home.").waitFor();
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
  await page.getByRole("button", { name: "New task", exact: false }).click();
  await page.getByLabel("Task title").fill("Disposable smoke task");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  const disposableId = await page.evaluate(
    async () => (await window.scully.load()).tasks[0].id,
  );
  await page.getByRole("button", { name: "Prepare private workspace" }).click();
  await page.getByRole("button", { name: "Delete task" }).click();
  const deleteDialog = page.getByRole("dialog", { name: "Delete task?" });
  await deleteDialog.getByRole("button", { name: "Delete task" }).click();
  await page.getByRole("heading", { name: "Choose a saved task." }).waitFor();
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
  await page.getByRole("button", { name: "Prepare private workspace" }).click();
  await page.getByRole("button", { name: "Request plan" }).waitFor();
  await page.getByRole("button", { name: "Change project source" }).click();
  await page.getByRole("radio", { name: "New project" }).waitFor();
  await page.getByRole("button", { name: "Prepare private workspace" }).click();
  await page.getByRole("button", { name: "Request plan" }).waitFor();
  assert.equal(
    await page
      .getByRole("checkbox", { name: /I approve this upload/ })
      .isChecked(),
    false,
  );
  assert.equal(
    await page.getByText(/0 input \+ 0 output tokens reported/).count(),
    0,
  );
  await page.getByRole("button", { name: /Run usage/ }).click();
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
  await page.getByRole("button", { name: "Room", exact: true }).click();
  await page.getByRole("button", { name: /12,000 token budget/ }).waitFor();
  await page
    .getByRole("button", { name: /\$2\.50 USD warning budget/ })
    .waitFor();
  await page.getByRole("region", { name: "Team ownership" }).waitFor();
  assert(
    (
      await page.getByRole("region", { name: "Team ownership" }).textContent()
    ).includes("Jun"),
  );
  await page
    .getByRole("region", { name: "Team ownership" })
    .screenshot({ path: "test-results/team-ownership.png" });
  assert.equal(
    await page.getByRole("button", { name: "Request plan" }).isDisabled(),
    true,
  );
  await page.getByRole("checkbox", { name: /I approve this upload/ }).check();
  await page
    .getByText("Configure ownership and early reviews", { exact: true })
    .click();
  await page.getByLabel("Ownership overrides").fill("jun checks/");
  await page
    .getByRole("checkbox", {
      name: "Review each completed writer chunk while other work continues",
    })
    .check();
  await page
    .getByRole("button", { name: "Save coordination settings" })
    .click();
  await page.getByText(/Saved early reviews: enabled/).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Request plan" }).isDisabled(),
    true,
  );
  assert.equal(
    await page
      .getByRole("checkbox", { name: /I approve this upload/ })
      .isChecked(),
    false,
  );
  await page
    .getByRole("region", { name: "Team ownership" })
    .screenshot({ path: "test-results/coordination-settings.png" });
  const prepared = await page.evaluate(async () => {
    const w = await window.scully.load();
    return (await window.scully.runs(w.tasks[0].id))[0];
  });
  assert.equal(prepared.coordination.settings.chunkReviews, true);
  assert.equal(prepared.coordination.rules[0].path, "checks");
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
  await page.getByRole("button", { name: "New task", exact: false }).click();
  await page.getByLabel("Task title").fill("Existing project smoke test");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await page.getByLabel("Existing project", { exact: true }).check();
  const sourceButton = await page
    .getByRole("button", { name: "Choose source folder" })
    .boundingBox();
  const prepareButton = await page
    .getByRole("button", { name: "Prepare private workspace" })
    .boundingBox();
  assert(sourceButton && prepareButton);
  assert(
    prepareButton.y >= sourceButton.y + sourceButton.height + 12,
    "Source selection and preparation should be on separate rows",
  );
  await page.getByRole("button", { name: "Choose source folder" }).click();
  await page.getByRole("checkbox", { name: "main.py" }).check();
  await page.getByRole("button", { name: "Prepare private workspace" }).click();
  await page.getByRole("button", { name: "Request plan" }).waitFor();
  const snapshot = await page.evaluate(async () => {
    const w = await window.scully.load();
    return (await window.scully.runs(w.tasks[0].id))[0];
  });
  assert.deepEqual(snapshot.files, [
    { path: "main.py", content: 'print("original")' },
  ]);
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
      run: { ...snapshot, calls: 4 },
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
      coordination: { ...snapshot.coordination },
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
  await page
    .getByRole("button", { name: "Persistence smoke test", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Existing project smoke test", exact: true })
    .click();
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
  await rosterDialog
    .getByLabel("Builder for current runs")
    .selectOption("tessa");
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
  await page.getByRole("heading", { name: "Team room." }).waitFor();
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
  await page.getByRole("button", { name: /12,000 token budget/ }).waitFor();
  await page
    .getByRole("button", { name: /\$2\.50 USD warning budget/ })
    .waitFor();
  await page
    .getByRole("button", { name: "Existing project smoke test", exact: true })
    .click();
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
  await page.getByText("Your task has a home.").waitFor();
  await page.getByText(/Saved early reviews: enabled/).waitFor();
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
  await page.getByRole("button", { name: "Room", exact: true }).click();
  await page
    .getByLabel("Team message", { exact: true })
    .fill("Keep accessibility in mind");
  await page
    .getByRole("button", { name: "Save team note", exact: true })
    .click();
  await page.getByText("Keep accessibility in mind", { exact: true }).waitFor();
  await page.evaluate(() =>
    window.scully.configureSession({
      key: "fixture-only-key",
      model: "fixture-model",
      outputTokens: 1024,
    }),
  );
  await page.getByLabel("Jun · Tester", { exact: true }).check();
  await page
    .getByRole("button", { name: "Review reply upload", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Approve one read-only reply" })
    .waitFor();
  await page.getByText("Reply from: Jun · Tester", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Request read-only reply", exact: true })
      .isEnabled(),
    false,
  );
  await page.getByText("Exact upload snapshot", { exact: true }).click();
  await page
    .getByRole("region", { name: "Reply upload review" })
    .screenshot({ path: "test-results/reply-upload-review.png" });
  await page
    .getByRole("button", { name: "Cancel reply review", exact: true })
    .click();
  await page
    .getByLabel("Team message", { exact: true })
    .fill("Use a command line interface instead");
  await page
    .getByLabel("Stop local coordination and prepare a revised plan")
    .check();
  await page
    .getByRole("button", { name: "Prepare revised plan", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Revised plan context", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Run usage" }).click();
  await page.getByRole("button", { name: "Apply Save tokens" }).click();
  await page.getByText(/Current: Save tokens/).waitFor();
  await page.getByRole("button", { name: "Room", exact: true }).click();
  await page
    .getByRole("heading", { name: "Revised plan context", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: /1,024 output tokens per request/ })
    .waitFor();
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
  await page
    .getByRole("heading", { name: "Revised plan context", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: /1,024 output tokens per request/ })
    .waitFor();
  await page
    .getByText("Use a command line interface instead", { exact: true })
    .waitFor();
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
  lineupFixture.run.plan = "Review account recovery before implementation";
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
  const lineupPanel = page.getByRole("region", {
    name: "Suggested specialists",
  });
  await lineupPanel.getByText("Review account recovery boundaries").waitFor();
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
    .getByRole("button", { name: "Approve specialist selection" })
    .click();
  await lineupPanel.getByText("Approved selection").waitFor();
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
  await lineupPanel.screenshot({ path: "test-results/lineup-review.png" });
  await page.evaluate(
    async ({ id, revision }) => {
      await window.scully.approveLineup(
        id,
        revision,
        [
          {
            id: "sloane",
            phase: "planning",
            purpose: "Review first-run usability",
          },
        ],
        true,
      );
      await window.scully.configureSession({
        key: "fixture-only-key",
        model: "fixture-model",
        outputTokens: 1024,
      });
    },
    { id: lineupFixture.run.id, revision: planRevision },
  );
  const consultation = page.getByRole("region", {
    name: "Planning consultations",
  });
  await consultation.getByText("Review first-run usability").waitFor();
  await consultation
    .getByRole("button", { name: "Review consultation" })
    .click();
  await consultation
    .getByRole("heading", { name: "Approve one read-only consultation" })
    .waitFor();
  assert.equal(
    await consultation
      .getByRole("button", { name: "Request consultation" })
      .isEnabled(),
    false,
  );
  await consultation.screenshot({
    path: "test-results/consultation-review.png",
  });
  await consultation.getByRole("button", { name: "Cancel review" }).click();
  const handoffFixture = await page.evaluate(
    async ({ taskId, runId }) =>
      (await window.scully.runs(taskId)).find((run) => run.id === runId),
    { taskId: lineupFixture.task.id, runId: lineupFixture.run.id },
  );
  handoffFixture.consultations = [
    {
      id: "offline-planning-advice",
      specialistId: "sloane",
      phase: "planning",
      purpose: "Review first-run usability",
      planRevision,
      contextRevision: "offline-context",
      status: "answered",
      advice: "Show a clear recovery path for keyboard users.",
      questions: ["Which recovery policy should apply?"],
      at: new Date().toISOString(),
    },
  ];
  const handoffDb = new DatabaseSync(join(state, "workspace.sqlite"));
  handoffDb
    .prepare("UPDATE runs SET data=? WHERE id=?")
    .run(JSON.stringify(handoffFixture), handoffFixture.id);
  handoffDb.close();
  await page.reload();
  await page
    .getByRole("button", { name: "Persistence smoke test", exact: true })
    .click();
  const handoffPanel = page.getByRole("region", {
    name: "Specialist advice handoff",
  });
  await handoffPanel
    .getByRole("button", { name: "Review builder handoff" })
    .click();
  await handoffPanel
    .getByText("Show a clear recovery path for keyboard users.", {
      exact: false,
    })
    .waitFor();
  assert.equal(
    await handoffPanel
      .getByRole("button", { name: "Attach advice" })
      .isEnabled(),
    false,
  );
  await handoffPanel.screenshot({
    path: "test-results/advice-handoff-review.png",
  });
  await handoffPanel
    .getByRole("checkbox", {
      name: "I approve sharing this advice with the builders.",
    })
    .check();
  await handoffPanel.getByRole("button", { name: "Attach advice" }).click();
  await handoffPanel
    .getByText("Included in the next builder requests.")
    .waitFor();
  assert.equal(
    (
      await page.evaluate(
        async ({ taskId, runId }) =>
          (await window.scully.runs(taskId)).find((run) => run.id === runId),
        { taskId: lineupFixture.task.id, runId: handoffFixture.id },
      )
    ).approvedAdvice.length,
    1,
  );
  await handoffPanel.getByRole("button", { name: "Remove from build" }).click();
  await handoffPanel
    .getByRole("button", { name: "Review builder handoff" })
    .waitFor();
  const verificationFixture = await page.evaluate(
    async (taskId) => window.scully.prepareRun(taskId, null, []),
    lineupFixture.task.id,
  );
  verificationFixture.status = "complete";
  verificationFixture.plan = "Build and review account recovery";
  verificationFixture.drafts = [
    { path: "app.ts", content: "export const ready = true;", before: null },
  ];
  const draftRevision = createHash("sha256")
    .update(JSON.stringify([["app.ts", "export const ready = true;"]]))
    .digest("hex");
  verificationFixture.coordination.integratedRevision = draftRevision;
  verificationFixture.coordination.auditedRevision = draftRevision;
  const verificationPlanRevision = createHash("sha256")
    .update(
      JSON.stringify({
        plan: verificationFixture.plan,
        files: verificationFixture.files,
        task: {
          title: lineupFixture.task.title,
          description: lineupFixture.task.description,
        },
        roster: verificationFixture.teamSnapshot.roster,
      }),
    )
    .digest("hex");
  verificationFixture.lineupProposal = {
    planRevision: verificationPlanRevision,
    suggestions: [],
    discardedInvalid: false,
  };
  verificationFixture.approvedLineup = {
    planRevision: verificationPlanRevision,
    entries: [
      {
        id: "kiran",
        phase: "verification",
        purpose: "Review account recovery boundaries",
      },
    ],
    approvedAt: new Date().toISOString(),
  };
  const verificationDb = new DatabaseSync(join(state, "workspace.sqlite"));
  verificationDb
    .prepare("UPDATE runs SET data=? WHERE id=?")
    .run(JSON.stringify(verificationFixture), verificationFixture.id);
  verificationDb.close();
  await page.reload();
  await page
    .getByRole("button", { name: "Persistence smoke test", exact: true })
    .click();
  const verificationPanel = page.getByRole("region", {
    name: "Draft verification consultations",
  });
  await verificationPanel
    .getByText("Review account recovery boundaries")
    .waitFor();
  await verificationPanel
    .getByRole("button", { name: "Review consultation" })
    .click();
  await verificationPanel
    .getByText("export const ready = true;", { exact: false })
    .waitFor();
  assert.equal(
    await verificationPanel
      .getByRole("button", { name: "Request consultation" })
      .isEnabled(),
    false,
  );
  await verificationPanel.screenshot({
    path: "test-results/verification-consultation-review.png",
  });
  await verificationPanel
    .getByRole("button", { name: "Cancel review" })
    .click();
  console.log(
    "PASS: desktop launch, renderer isolation, both project intakes, usage preset and cost budget persistence, upload approval, source preservation, offline coordinator, specialist lineup, planning/draft consultation and advice handoff review, command review/stale rejection/restart expiry, local fixture execution with fresh permission and persisted results, fixed roster, activity and team persistence. No live provider request.",
  );
} finally {
  if (app) await app.close();
  await rm(state, { recursive: true, force: true });
  await rm(sourceRoot, { recursive: true, force: true });
}
