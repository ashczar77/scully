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
  assert.equal(
    await page.getByRole("button", { name: "Send message" }).isDisabled(),
    true,
  );
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
      "load",
      "updateTeammate",
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
  await page.screenshot({ path: "test-results/room.png", fullPage: true });
  await page.getByRole("button", { name: "New task", exact: false }).click();
  await page.getByLabel("Task title").fill("Persistence smoke test");
  await page
    .getByLabel("What should the team know?")
    .fill("Keep existing work intact.");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await page.getByText("Your task has a home.").waitFor();
  await page.getByRole("button", { name: "Prepare private workspace" }).click();
  await page.getByRole("button", { name: "Request plan" }).waitFor();
  await page.getByText(/0 input \+ 0 output tokens reported/).waitFor();
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
      team: [],
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
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Ellis Test");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await page.getByRole("button", { name: "Open full profile" }).click();
  await page.getByText("Working instructions", { exact: true }).waitFor();
  await page.screenshot({ path: "test-results/profile.png", fullPage: true });
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
    .getByRole("button", { name: "Persistence smoke test", exact: true })
    .click();
  await page.getByText(/Budget: 12,000 tokens/).waitFor();
  await page
    .getByRole("region", { name: "Model cost estimates" })
    .getByText(/USD warning budget: \$2.50/)
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
  await page.getByText("Ellis Test", { exact: true }).first().waitFor();
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
  await page.getByLabel("Jun · Test engineer", { exact: true }).check();
  await page
    .getByRole("button", { name: "Review reply upload", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Approve one read-only reply" })
    .waitFor();
  await page
    .getByText("Reply from: Jun · Test engineer", { exact: true })
    .waitFor();
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
  await page.getByRole("button", { name: "Room", exact: true }).click();
  await page
    .getByRole("heading", { name: "Revised plan context", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Apply Save tokens" }).click();
  await page.getByText(/Current: Save tokens/).waitFor();
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
  await page.getByText(/Current: Save tokens/).waitFor();
  await page
    .getByText("Use a command line interface instead", { exact: true })
    .waitFor();
  console.log(
    "PASS: desktop launch, renderer isolation, both project intakes, usage preset and cost budget persistence, upload approval, source preservation, offline coordinator, command review/stale rejection/restart expiry, local fixture execution with fresh permission and persisted results, task/profile persistence. No live provider request.",
  );
} finally {
  if (app) await app.close();
  await rm(state, { recursive: true, force: true });
  await rm(sourceRoot, { recursive: true, force: true });
}
