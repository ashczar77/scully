import { _electron as electron } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

if (process.env.SCULLY_LIVE_TEST !== "1" || !process.env.NEBIUS_API_KEY)
  throw new Error("Set SCULLY_LIVE_TEST=1 and provide NEBIUS_API_KEY");

const state = await mkdtemp(join(tmpdir(), "scully-live-room-"));
let app;
try {
  app = await electron.launch({
    args: ["."],
    env: { ...process.env, SCULLY_TEST_DATA: state },
  });
  const page = await app.firstWindow();
  await page
    .getByRole("heading", { name: "What would you like to build?" })
    .waitFor();
  const task = await page.evaluate(async (key) => {
    await window.scully.configureSession({
      key,
      model: "nvidia/nemotron-3-super-120b-a12b",
      outputTokens: 8192,
    });
    const task = await window.scully.createTask({
      title: "Reading list live check",
      description:
        "Build a small local reading list. Add books, mark them as read, persist after restarting, support keyboard access, and include tests. Ask about important product choices before building.",
      mode: "plan",
    });
    const run = await window.scully.prepareRun(task.id, null, [], "direct");
    await window.scully.sendPlanningMessage(run.id, task.description);
    return task;
  }, process.env.NEBIUS_API_KEY);
  await page.reload();
  await page.locator(".task-item", { hasText: task.title }).click();
  async function waitForPlan(afterId = "") {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const { latest, calls } = await page.evaluate(async (taskId) => {
        const runs = await window.scully.runs(taskId);
        return {
          latest: runs[0],
          calls: runs.reduce((total, run) => total + run.calls, 0),
        };
      }, task.id);
      if (calls > 8) {
        await page.evaluate(async (id) => window.scully.stopRun(id), latest.id);
        throw new Error("Live conversation request cap reached");
      }
      if (latest.id !== afterId && latest.status === "planned") return latest;
      if (latest.status === "failed")
        throw new Error("Live planning turn failed");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("Live planning turn timed out");
  }
  const first = await waitForPlan();
  const questions = first.planning?.questions.filter(
    (item) => item.status === "pending",
  );
  assert(questions?.length, "Pearl should ask a selectable question");
  for (const question of questions) {
    assert(question.options?.length, "A question needs answer choices");
    const card = page.getByRole("region", { name: question.text });
    await card.waitFor();
    await card.getByLabel(question.options[0]).click();
  }
  await page
    .getByLabel("Additional message")
    .fill(
      "Could people on separate devices sign in, view other users' lists, and share lists?",
    );
  await page.getByRole("button", { name: "Send answers" }).click();
  const second = await waitForPlan(first.id);
  for (const question of questions) {
    assert.equal(
      second.planning?.questions.find((item) => item.id === question.id)
        ?.status,
      "answered",
    );
    assert.equal(
      second.planning?.questions.find((item) => item.id === question.id)
        ?.answer,
      question.options[0],
    );
    assert.equal(
      await page.getByRole("region", { name: question.text }).count(),
      1,
    );
  }
  assert(
    second.planReply?.length > 20,
    "Pearl should respond to the new requirement",
  );
  process.stdout.write(
    `PASS: desktop linked question set, one visible card per question, recorded answers, subsequent Pearl reply. Model requests: ${first.calls + second.calls}.\n`,
  );
} finally {
  await app?.close();
  await rm(state, { recursive: true, force: true });
}
