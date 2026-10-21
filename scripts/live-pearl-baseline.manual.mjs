import { _electron as electron } from "playwright";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.env.SCULLY_LIVE_TEST !== "1" || !process.env.NEBIUS_API_KEY)
  throw new Error("Set SCULLY_LIVE_TEST=1 and provide NEBIUS_API_KEY");

const root = await mkdtemp(join(tmpdir(), "scully-pearl-baseline-"));
const state = join(root, "app-state");
await mkdir(state, { mode: 0o700 });
const capturePath = join(root, "transcript.json");
const transcript = [];
let app;
let task;
let failure = null;
const requestCap = 18;
const model =
  process.env.SCULLY_TEST_MODEL || "nvidia/nemotron-3-super-120b-a12b";
const thinking = process.env.SCULLY_TEST_THINKING === "on" ? "on" : "off";
const temperature = Number(process.env.SCULLY_TEST_TEMPERATURE || "0.2");

try {
  app = await electron.launch({
    args: ["."],
    env: { ...process.env, SCULLY_TEST_DATA: state },
  });
  const page = await app.firstWindow();
  await page
    .getByRole("heading", { name: "What would you like to build?" })
    .waitFor();
  task = await page.evaluate(
    async ({ key, model, thinking, temperature }) => {
      await window.scully.configureSession({
        key,
        model,
        outputTokens: 8192,
      });
      const roles = await window.scully.roleModelSettings();
      await window.scully.setRoleModelSettings({
        ...roles,
        thinking: { ...roles.thinking, pearl: thinking },
      });
      await window.scully.setPlanningSettings({ temperature });
      return window.scully.createTask({
        title: "Pearl connected baseline",
        description:
          "Build a small local reading list. I want to add books, mark them as read, and keep the list after restarting. Make it usable with a keyboard and include tests. Ask me about any important product choices before building.",
        mode: "plan",
      });
    },
    { key: process.env.NEBIUS_API_KEY, model, thinking, temperature },
  );

  await page.evaluate(async () => window.scully.armRawCapture());
  const initial = await page.evaluate(async (taskId) => {
    const run = await window.scully.prepareRun(taskId, null, [], "direct");
    return window.scully.sendPlanningMessage(
      run.id,
      run.taskSnapshot.description,
    );
  }, task.id);

  async function waitForTurn(expectedId) {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const runs = await page.evaluate(
        async (taskId) => window.scully.runs(taskId),
        task.id,
      );
      const latest = runs[0];
      const calls = runs.reduce((total, run) => total + run.calls, 0);
      if (calls > requestCap) {
        await page.evaluate(async (id) => window.scully.stopRun(id), latest.id);
        throw new Error(`Request cap exceeded (${calls}/${requestCap})`);
      }
      if (latest.id === expectedId && latest.status === "planned")
        return latest;
      if (latest.id === expectedId && latest.status === "failed") return latest;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("Pearl turn timed out");
  }

  function record(label, run) {
    const entry = {
      label,
      status: run.status,
      reply: run.planReply || null,
      questions: (run.planning?.questions || []).map((question) => ({
        text: question.text,
        recommendation: question.recommendation,
        options: question.options || [],
        status: question.status,
        answer: question.answer || null,
      })),
      plan: run.plan || null,
      planReview: run.planning?.planReview || null,
      staffingProposed: !!run.planning?.proposal,
      trace: run.planningTrace || [],
      requestOutcomes: (run.diagnostics || []).map((item) => ({
        outcome: item.outcome,
        finishReason: item.finishReason,
        durationMs: item.durationMs,
      })),
      calls: run.calls,
      error: run.error || null,
    };
    transcript.push(entry);
    process.stdout.write(
      `${label}: ${entry.status}, ${entry.questions.filter((q) => q.status === "pending").length} pending, ${entry.calls} requests, trace ${entry.trace.map((item) => item.code).join(",")}\n`,
    );
    return entry;
  }

  let current = await waitForTurn(initial.id);
  record("initial", current);
  const initialRaw = await page.evaluate(async () =>
    window.scully.readRawCapture(),
  );
  if (initialRaw)
    await writeFile(
      join(root, "request-initial.json"),
      JSON.stringify(initialRaw, null, 2),
      { mode: 0o600 },
    );
  await page.evaluate(async () => window.scully.clearRawCapture());
  if (current.status !== "planned") throw new Error("Initial turn failed");
  const pending = current.planning?.questions.filter(
    (item) => item.status === "pending",
  );
  if (!pending?.length)
    throw new Error("Initial turn did not present a linked product question");

  await page.evaluate(async () => window.scully.armRawCapture());
  const answer = await page.evaluate(
    async ({ id, questions }) =>
      window.scully.answerPlanningQuestions(id, {
        answers: questions.map((question) => ({
          questionId: question.id,
          askedAt: question.askedAt,
          customAnswer: question.recommendation,
        })),
        note: "I also want people on separate devices to sign in, view other users' lists, and share lists. Please discuss how that changes the design.",
      }),
    { id: current.id, questions: pending },
  );
  current = await waitForTurn(answer.id);
  record("linked answers plus new scope", current);
  const linkedRaw = await page.evaluate(async () =>
    window.scully.readRawCapture(),
  );
  if (linkedRaw)
    await writeFile(
      join(root, "request-linked-answer.json"),
      JSON.stringify(linkedRaw, null, 2),
      { mode: 0o600 },
    );
  await page.evaluate(async () => window.scully.clearRawCapture());
  if (current.status !== "planned")
    throw new Error("Linked-answer turn failed");

  const followUps = [
    "Tell me about pineapples.",
    "Back to the reading list: what are the other storage options now that users can sign in from separate devices and share lists?",
    "Let's sketch the main features together before we agree on a plan. What do you recommend?",
  ];
  for (const [index, message] of followUps.entries()) {
    await page.evaluate(async () => window.scully.armRawCapture());
    const started = await page.evaluate(
      async ({ id, text }) => window.scully.sendPlanningMessage(id, text),
      { id: current.id, text: message },
    );
    current = await waitForTurn(started.id);
    record(message, current);
    const raw = await page.evaluate(async () => window.scully.readRawCapture());
    if (raw)
      await writeFile(
        join(root, `request-${index + 1}.json`),
        JSON.stringify(raw, null, 2),
        { mode: 0o600 },
      );
    await page.evaluate(async () => window.scully.clearRawCapture());
    if (current.status !== "planned") {
      failure = current.error || "Pearl turn failed";
      break;
    }
  }
  if (current.status === "planned") {
    for (let round = 0; round < 2; round++) {
      const open = current.planning?.questions.filter(
        (question) => question.status === "pending",
      );
      if (!open?.length) break;
      const answered = await page.evaluate(
        async ({ id, questions }) =>
          window.scully.answerPlanningQuestions(id, {
            answers: questions.map((question) => ({
              questionId: question.id,
              askedAt: question.askedAt,
              customAnswer: question.options?.[0] || question.recommendation,
            })),
            note: "Keep sign-in from separate devices, viewing other users' lists, and sharing in the first release. I have not agreed to defer them. Keep other decisions open and show a complete plan for review when ready.",
          }),
        { id: current.id, questions: open },
      );
      current = await waitForTurn(answered.id);
      record(`answer remaining choices ${round + 1}`, current);
      if (current.status !== "planned") {
        failure = current.error || "Pearl turn failed";
        break;
      }
    }
  }
  if (
    current.status === "planned" &&
    !current.plan &&
    !current.planning?.questions.some(
      (question) => question.status === "pending",
    )
  ) {
    const requested = await page.evaluate(
      async ({ id }) =>
        window.scully.sendPlanningMessage(
          id,
          "Please show me the full plan for review. Separate my confirmed choices from your recommendations and unresolved assumptions. Explain the user flows, alternatives, and how we will verify the result. Do not form a team yet.",
        ),
      { id: current.id },
    );
    current = await waitForTurn(requested.id);
    record("request full plan", current);
    if (current.status !== "planned")
      failure = current.error || "Pearl turn failed";
  }
  if (!failure && current.planning?.proposal)
    failure = "A team was proposed before the user approved the plan";
  if (!failure && (!current.plan || !current.planning?.planReview))
    failure = "The journey ended without a reviewable full plan";
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Baseline stopped: ${failure}\n`);
} finally {
  await writeFile(
    capturePath,
    JSON.stringify(
      {
        version: 1,
        model,
        modelSettings: { thinking, temperature },
        requestCap,
        task: task?.title || null,
        failure,
        turns: transcript,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  await app?.close();
  await rm(state, { recursive: true, force: true });
  process.stdout.write(`Local synthetic transcript: ${capturePath}\n`);
}
if (failure) process.exitCode = 1;
