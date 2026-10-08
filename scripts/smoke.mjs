import { _electron as electron } from "playwright";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const state = await mkdtemp(join(tmpdir(), "scully-shell-test-"));
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
  assert.deepEqual(isolation.bridge.sort(), [
    "createTask",
    "load",
    "updateTeammate",
  ]);
  await page.screenshot({ path: "test-results/room.png", fullPage: true });
  await page.getByRole("button", { name: "New task", exact: false }).click();
  await page.getByLabel("Task title").fill("Persistence smoke test");
  await page
    .getByLabel("What should the team know?")
    .fill("Keep existing work intact.");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await page.getByText("Your task has a home.").waitFor();
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
    .waitFor();
  await page.getByText("Ellis Test", { exact: true }).first().waitFor();
  await page
    .getByRole("button", { name: "Persistence smoke test", exact: true })
    .click();
  await page.getByText("Your task has a home.").waitFor();
  console.log(
    "PASS: desktop launch, renderer isolation, input rejection, task/profile persistence, navigation, screenshots.",
  );
} finally {
  if (app) await app.close();
  await rm(state, { recursive: true, force: true });
}
