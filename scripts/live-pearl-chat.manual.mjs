import { _electron as electron } from "playwright";
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { safeTestCommand, safePreviewCommand } from "./live-test-command.mjs";
import {
  liveRequestLimit,
  liveStallTracker,
  remainingLiveRequests,
} from "./live-test-budget.mjs";
import { inspectLiveWebApp } from "./live-preview-inspection.mjs";
import { inspectStaticWebApp } from "./live-browser-sanity.mjs";

if (process.env.SCULLY_LIVE_TEST !== "1" || !process.env.NEBIUS_API_KEY)
  throw new Error(
    "Set SCULLY_LIVE_TEST=1 and NEBIUS_API_KEY to run the opt-in connected journey",
  );

const root = await mkdtemp(join(tmpdir(), "scully-live-pearl-"));
const state = join(root, "state");
const project = join(root, "project");
const scenario =
  process.env.SCULLY_LIVE_SCENARIO === "budget"
    ? {
        name: "budget",
        initial:
          "Help me build a keyboard-usable household expense tracker with persistent entries, categories, and tests. Discuss important product choices before coding.",
        change:
          "Now include sign-in from separate devices, a shared household budget, and inviting another household member in the first release. Please revise your recommendation.",
        browser:
          "Check the generated page in Pearl's browser. Try adding an expense with Enter and inspect its initial state. Fix any behavior or display problem you observe, then check the repair and report what remains unfinished.",
      }
    : process.env.SCULLY_LIVE_SCENARIO === "inventory"
      ? {
          name: "inventory",
          initial:
            "Help me build a keyboard-usable stock room tracker with persistent item quantities and tests. Ask me whether quantities represent whole units or weights before choosing the data model.",
          change:
            "Change the first release to support fractional weights in kilograms with three decimal places, a low-stock threshold per item, and a visible history of stock adjustments. Negative resulting quantities must be rejected.",
          browser:
            "Verify the stock tracker in the browser. Add an item with Enter, make a fractional stock adjustment, check its history and low-stock state, and reload to verify persistence. Repair any problems and report observed results.",
        }
      : {
          name: "reading-list",
          initial:
            "Help me build a keyboard-usable reading list with persistent books, read status, and tests. Discuss important product choices before coding.",
          change:
            "Now include sign-in from separate devices, viewing friends' lists, and sharing in the first release. Please revise your recommendation.",
          browser:
            "Check the generated page in Pearl's browser. Try adding a book with Enter and inspect its initial state. Fix any behavior or display problem you observe, then check the repair and report what remains unfinished.",
        };
await mkdir(state, { mode: 0o700 });
await mkdir(project, { mode: 0o700 });
await writeFile(
  join(project, "README.md"),
  `Disposable ${scenario.name} project for a connected Pearl check.\n`,
);
await mkdir("test-results", { recursive: true });
const transcript = [];
const structuralFailures = [];
const startedAt = Date.now();
const projectSnapshot = join("test-results", `live-pearl-project-${startedAt}`);
const stateSnapshot = join(
  "test-results",
  `live-pearl-state-${startedAt}.sqlite`,
);
const gitHead = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const dirty = Boolean(
  execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(),
);
const model = process.env.SCULLY_TEST_MODEL || "zai-org/GLM-5.3-Flash";
const codingModel = model;
const outputTokens = 16384;
const maxRequests = liveRequestLimit(process.env.SCULLY_LIVE_MAX_REQUESTS);
let priorProcessRequests = 0;
let app;
let page;
let chatId;
const launch = () =>
  electron.launch({
    args: ["."],
    env: {
      ...process.env,
      SCULLY_TEST_DATA: state,
      SCULLY_LIVE_MAX_REQUESTS: String(
        remainingLiveRequests(maxRequests, priorProcessRequests),
      ),
    },
    timeout: 30000,
  });

async function configure(selectedModel = model) {
  await page.evaluate(
    async ({ key, selectedModel, outputTokens }) => {
      await window.scully.configureSession({
        key,
        model: selectedModel,
        outputTokens,
      });
    },
    { key: process.env.NEBIUS_API_KEY, selectedModel, outputTokens },
  );
}
async function current() {
  return page.evaluate(async (id) => window.scully.getPearlChat(id), chatId);
}
async function requestCount() {
  return (
    priorProcessRequests +
    (await page.evaluate(
      async () =>
        (await window.scully.metrics()).events.filter(
          (entry) => entry.operation === "model.request",
        ).length,
    ))
  );
}
function toolObservation(message) {
  if (message.role !== "tool") return null;
  try {
    return JSON.parse(message.text);
  } catch {
    return null;
  }
}
async function waitTurn(label) {
  const turnStartedAt = Date.now();
  const deadline =
    Date.now() +
    (label === "coding" || label === "browser repair" ? 1_800_000 : 240_000);
  let budgetContinues = 0;
  let reportedCount = -1;
  const stalled = liveStallTracker();
  while (Date.now() < deadline) {
    let chat = await current();
    if (chat.messages.length !== reportedCount) {
      reportedCount = chat.messages.length;
      await writeFile(
        "test-results/live-pearl-progress.json",
        JSON.stringify(
          {
            project,
            state,
            chat,
            model,
            label,
            requests: await requestCount(),
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
      process.stdout.write(
        `${label}: ${chat.status}, ${chat.messages.at(-1)?.toolName || chat.messages.at(-1)?.role}, ${await requestCount()} requests\n`,
      );
    }
    if (stalled(chat.status, chat.messages.length)) {
      await page.evaluate(
        async (id) => window.scully.stopPearlChat(id),
        chatId,
      );
      throw new Error(`Live turn stalled without a saved action at ${label}`);
    }
    if (chat.status === "awaiting_approval") {
      const call = chat.pendingTool;
      const proposed = JSON.parse(call.arguments);
      process.stdout.write(
        `review ${call.name}: ${proposed.command} ${JSON.stringify(proposed.args)}\n`,
      );
      const safeCheck =
        call.name === "preview_app"
          ? safePreviewCommand(proposed)
          : safeTestCommand(proposed) || safePreviewCommand(proposed);
      await page
        .getByRole("button", { name: safeCheck ? "Run once" : "Deny" })
        .click();
      continue;
    }
    if (
      chat.status === "paused" &&
      !["repeated_action", "no_progress"].includes(chat.pauseKind) &&
      budgetContinues < 2
    ) {
      budgetContinues++;
      transcript.push({
        label: `${label} budget continuation ${budgetContinues}`,
        status: chat.status,
        error: chat.error,
        pauseKind: chat.pauseKind,
        requests: await requestCount(),
        elapsedMs: Date.now() - turnStartedAt,
      });
      await page.getByRole("button", { name: "Continue" }).click();
      continue;
    }
    if (chat.status !== "running") {
      transcript.push({
        label,
        status: chat.status,
        error: chat.error || null,
        messages: chat.messages.map(
          ({
            role,
            text,
            toolName,
            questionId,
            arguments: toolArguments,
            toolCalls,
            evidence,
            completion,
          }) => ({
            role,
            text,
            toolName,
            questionId,
            toolArguments,
            toolCalls,
            evidence,
            completion,
          }),
        ),
        questions: chat.questions,
        roomText: (
          await page
            .getByRole("log", { name: "Pearl conversation" })
            .innerText()
        ).slice(-20000),
        requests: await requestCount(),
      });
      process.stdout.write(
        `${label}: ${chat.status}, ${chat.questions.filter((item) => item.status === "pending").length} pending, ${await requestCount()} requests\n`,
      );
      if (chat.status === "failed")
        throw new Error(`Pearl failed at ${label}: ${chat.error}`);
      return chat;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Pearl timed out at ${label}`);
}
async function send(label, text) {
  if ((await requestCount()) >= maxRequests)
    throw new Error("Live request cap reached before the next turn");
  const previous = (await current()).messages.length;
  await page.getByRole("textbox", { name: "Message Pearl" }).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
  const acceptedBy = Date.now() + 10_000;
  while (
    (await current()).messages.length <= previous &&
    Date.now() < acceptedBy
  )
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert(
    (await current()).messages.length > previous,
    `Message was not saved at ${label}`,
  );
  return waitTurn(label);
}
async function answerIfPending(label) {
  const chat = await current();
  const question = chat.questions.find((item) => item.status === "pending");
  if (!question) return;
  await page
    .getByRole("textbox", { name: "Answer Pearl" })
    .fill(question.options[0] || "Use your recommendation and explain it");
  await page.getByRole("button", { name: "Answer", exact: true }).click();
  const acceptedBy = Date.now() + 10_000;
  while (
    (await current()).questions.find((item) => item.id === question.id)
      ?.status === "pending" &&
    Date.now() < acceptedBy
  )
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(
    (await current()).questions.find((item) => item.id === question.id)?.status,
    "answered",
  );
  await waitTurn(label);
}

try {
  app = await launch();
  page = await app.firstWindow();
  await configure();
  await page.getByRole("button", { name: "New chat" }).click();
  chatId = (
    await page.evaluate(async () => (await window.scully.listPearlChats())[0])
  ).id;
  const initial = await send(
    "initial",
    scenario.initial +
      " Use a browser interface and Node built-in modules, with no external packages. Keep those technical constraints throughout planning and implementation. The server must read PORT and HOST from its environment for local preview. This disposable test controller approves Node test commands and a single project-local JavaScript entry point; shell commands are not automatically approved. Use isolated test data and preserve existing project data.",
  );
  const firstQuestion = initial.questions.find(
    (item) => item.status === "pending",
  );
  if (!firstQuestion)
    structuralFailures.push("No linked product question in the initial turn");
  for (const [index, prompt] of [
    process.env.SCULLY_LIVE_DIGRESSION || "What is a pineapple?",
    process.env.SCULLY_LIVE_EXTRA_DIGRESSION,
  ]
    .filter(Boolean)
    .entries()) {
    const digression = await send(
      index ? "additional digression" : "digression",
      prompt,
    );
    if (
      firstQuestion &&
      digression.questions.find((item) => item.id === firstQuestion.id)
        ?.status !== "pending"
    )
      structuralFailures.push("Pending question changed during the digression");
  }
  await answerIfPending("linked answer");
  await send("changed requirement", scenario.change);
  await answerIfPending("changed requirement answer");
  await send(
    "alternatives",
    "What are other storage options, and what tradeoffs matter here?",
  );
  const planned = await send(
    "plan",
    "Give me a concrete plan for the requirements we agreed on, including user behavior and verification.",
  );
  const planReply = [...planned.messages]
    .reverse()
    .find((message) => message.role === "assistant" && !message.toolName);
  if (!planReply || planReply.text.length < 500)
    structuralFailures.push("No substantive visible plan in the plan turn");
  await answerIfPending("plan answer");
  if (process.env.SCULLY_LIVE_PLAN_ONLY !== "1") {
    await app.evaluate(
      ({ dialog }, filePaths) => {
        dialog.showOpenDialog = () =>
          Promise.resolve({ canceled: false, filePaths });
      },
      [project],
    );
    await page.getByRole("button", { name: "Choose project" }).click();
    await page.getByRole("button", { name: "Allow project access" }).click();
    await configure(codingModel);
    await send(
      "coding",
      "Start the implementation in this disposable project. Follow the current plan and all first-release requirements we discussed. Inspect what exists, implement in small increments, run tests that exercise production code, repair failures, and verify the running application in the browser. Continue until the requested app works or explain a specific blocker. Request command approvals through the tools.",
    );
    await answerIfPending("coding answer");
    const implemented = await current();
    const implementationCompletion = [...implemented.messages]
      .reverse()
      .find(
        (message) => message.role === "assistant" && message.completion,
      )?.completion;
    assert.equal(
      implementationCompletion?.status,
      "done",
      "Coding stopped before the requested app was completed and checked",
    );
    await send("browser repair", scenario.browser);
    await answerIfPending("browser repair answer");
    const coded = await current();
    const codingStart = coded.messages.findIndex(
      (message) =>
        message.role === "user" &&
        message.text.startsWith(
          "Start the implementation in this disposable project.",
        ),
    );
    const codingMessages = coded.messages.slice(codingStart);
    if (
      !codingMessages.some(
        (message) =>
          message.role === "tool" &&
          [
            "create_file",
            "write_file",
            "replace_in_file",
            "apply_patch",
          ].includes(message.toolName) &&
          toolObservation(message)?.written === true,
      )
    )
      structuralFailures.push("No completed file write in the coding turn");
    if (
      !codingMessages.some(
        (message) =>
          message.role === "tool" &&
          message.toolName === "run_command" &&
          toolObservation(message)?.exitCode === 0,
      )
    )
      structuralFailures.push("No completed command check in the coding turn");
    const completion = [...codingMessages]
      .reverse()
      .find(
        (message) => message.role === "assistant" && message.completion,
      )?.completion;
    if (!completion)
      structuralFailures.push(
        "No evidence-backed coding completion in the Room",
      );
    if (
      !codingMessages.some(
        (message) =>
          message.role === "tool" &&
          ["browser_check", "preview_app"].includes(message.toolName) &&
          typeof toolObservation(message)?.visibleText === "string",
      )
    )
      structuralFailures.push("No successful Room browser observation");
    if (completion?.status === "done" && completion.remaining)
      structuralFailures.push("Done completion listed unfinished requirements");
    try {
      const livePreview = [...coded.messages]
        .reverse()
        .find(
          (message) =>
            message.role === "tool" &&
            message.toolName === "preview_app" &&
            toolObservation(message)?.visibleText,
        );
      const previewCall =
        livePreview &&
        coded.messages.find(
          (message) =>
            message.role === "assistant" &&
            message.toolCallId === livePreview.toolCallId,
        );
      const previewArgs =
        previewCall?.arguments && JSON.parse(previewCall.arguments);
      const browser =
        previewArgs && safePreviewCommand(previewArgs)
          ? await inspectLiveWebApp(
              app,
              project,
              previewArgs.args[0],
              "test-results/live-pearl-browser.png",
            )
          : await inspectStaticWebApp(
              app,
              project,
              "test-results/live-pearl-browser.png",
            );
      transcript.push({ label: "browser sanity", ...browser });
      if (!browser.passed)
        structuralFailures.push("Generated web app failed browser sanity");
    } catch (error) {
      transcript.push({
        label: "browser sanity",
        error: error instanceof Error ? error.message : "Unknown browser error",
      });
      structuralFailures.push(
        "Generated web app could not load in the browser",
      );
    }
    priorProcessRequests = await requestCount();
    if (remainingLiveRequests(maxRequests, priorProcessRequests) === 0)
      throw new Error("Live request cap reached before restart recovery");
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await configure(codingModel);
    await page.getByRole("button", { name: (await current()).title }).click();
    const restored = await current();
    assert(restored.messages.length > 0 && restored.project?.approved);
    transcript.push({
      label: "restart",
      status: restored.status,
      messageCount: restored.messages.length,
      projectApproved: restored.project.approved,
      files: await readdir(project),
    });
    process.stdout.write(
      `restart: ${restored.messages.length} messages, ${transcript.at(-1).files.length} project entries\n`,
    );
    await page.evaluate(
      async ({ selectedModel, outputTokens }) => {
        await window.scully.configureSession({
          key: "invalid-key-for-recovery-test",
          model: selectedModel,
          outputTokens,
        });
      },
      { selectedModel: codingModel, outputTokens },
    );
    const recoveryPrompt =
      "What changed in the project, and what checks have actually run?";
    try {
      await send("provider failure", recoveryPrompt);
      structuralFailures.push("Invalid provider key did not fail the turn");
    } catch {
      const failed = await current();
      assert.equal(failed.status, "failed");
      assert.equal(
        failed.messages.filter(
          (message) =>
            message.role === "user" && message.text === recoveryPrompt,
        ).length,
        1,
      );
    }
    await configure(codingModel);
    await page.getByRole("button", { name: "Continue" }).click();
    const recovered = await waitTurn("provider recovery");
    if (
      recovered.messages.filter(
        (message) => message.role === "user" && message.text === recoveryPrompt,
      ).length !== 1
    )
      structuralFailures.push("Recovery duplicated the saved user message");
  }
  if (structuralFailures.length)
    throw new Error(
      `Structural acceptance failures: ${structuralFailures.join("; ")}`,
    );
} finally {
  if (page && chatId) {
    try {
      const last = await current();
      transcript.push({
        label: "final state",
        status: last.status,
        error: last.error || null,
        messages: last.messages.map(
          ({
            role,
            text,
            toolName,
            questionId,
            arguments: toolArguments,
            toolCalls,
            evidence,
            completion,
          }) => ({
            role,
            text,
            toolName,
            questionId,
            toolArguments,
            toolCalls,
            evidence,
            completion,
          }),
        ),
        questions: last.questions,
        requests: await requestCount(),
      });
    } catch {
      transcript.push({ label: "final state", status: "unavailable" });
    }
  }
  await writeFile(
    "test-results/live-pearl-chat.json",
    JSON.stringify(
      {
        model,
        codingModel,
        scenario: scenario.name,
        maxRequests,
        outputTokens,
        gitHead,
        dirty,
        elapsedMs: Date.now() - startedAt,
        projectSnapshot,
        stateSnapshot,
        transcript,
        structuralFailures,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  await cp(
    "test-results/live-pearl-chat.json",
    `test-results/live-pearl-chat-${startedAt}.json`,
  );
  if (page)
    await page
      .screenshot({ path: "test-results/live-pearl-room.png" })
      .catch(() => {});
  if (app) await app.close().catch(() => {});
  await cp(project, projectSnapshot, { recursive: true });
  await cp(join(state, "workspace.sqlite"), stateSnapshot);
  await rm(root, { recursive: true, force: true });
}
