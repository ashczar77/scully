import { _electron as electron } from "playwright";
import { extractFile, listPackage } from "@electron/asar";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdir, readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
await mkdir("test-results", { recursive: true });
const bundle = resolve("out/Scully-darwin-arm64/Scully.app");
assert.deepEqual(
  await readFile(`${bundle}/Contents/Resources/electron.icns`),
  await readFile("assets/branding/scully.icns"),
);
const entries = listPackage(`${bundle}/Contents/Resources/app.asar`);
assert(entries.some((p) => p.endsWith("/main.cjs")));
const mainBundle = extractFile(
  `${bundle}/Contents/Resources/app.asar`,
  "dist/main.cjs",
).toString();
assert(!mainBundle.includes("Live test request budget"));
assert(!mainBundle.includes("SCULLY_LIVE_MAX_REQUESTS"));
assert(!entries.some((p) => p.endsWith("/worker.cjs")));
assert(entries.some((p) => p.endsWith("/branding/scully.png")));
assert(entries.some((p) => p.endsWith("/fonts/ChelseaMarket-OFL.txt")));
assert(entries.some((p) => /\/index-[^/]+\.js$/.test(p)));
assert(
  !entries.some((p) =>
    /\/(\.env|AGENTS\.md|.*\.local\.md|node_modules)(\/|$)/.test(p),
  ),
);
const state = await mkdtemp(join(tmpdir(), "scully-package-test-"));
let app;
try {
  app = await electron.launch({
    executablePath: `${bundle}/Contents/MacOS/scully`,
    args: [`--user-data-dir=${state}`],
    timeout: 30000,
  });
  const page = await app.firstWindow();
  await page
    .getByRole("heading", { name: "What can I help you with?" })
    .waitFor();
  await page.getByRole("textbox", { name: "Message Pearl" }).waitFor();
  assert.equal(
    await page.evaluate(
      async () => (await window.scully.listPearlChats()).length,
    ),
    0,
  );
  assert.equal(await page.getByRole("button", { name: "New chat" }).count(), 1);
  for (let i = 0; i < 3; i++) await page.locator(".pearl-new").click();
  assert.equal(
    await page.evaluate(
      async () => (await window.scully.listPearlChats()).length,
    ),
    1,
  );
  assert.equal(
    await page.evaluate(() => {
      const shell = document
        .querySelector(".pearl-shell")
        .getBoundingClientRect();
      const header = document
        .querySelector(".pearl-header")
        .getBoundingClientRect();
      const rail = document
        .querySelector(".pearl-rail")
        .getBoundingClientRect();
      return (
        Math.abs(header.left - shell.left) < 1 &&
        Math.abs(header.right - shell.right) < 1 &&
        Math.abs(rail.top - header.bottom) < 1
      );
    }),
    true,
  );
  await page.waitForFunction(() =>
    [
      ...document.querySelectorAll(".pearl-brand img, .pearl-welcome-mark"),
    ].every((image) => image.complete && image.naturalWidth > 0),
  );
  assert.equal(
    await page.evaluate(async () => {
      await document.fonts.load('21px "Chelsea Market"');
      return document.fonts.check('21px "Chelsea Market"');
    }),
    true,
  );
  assert.equal(
    await page.getByRole("button", { name: "Task", exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: "Send message" }).isDisabled(),
    true,
  );
  await page.screenshot({
    path: "test-results/packaged-room.png",
    fullPage: true,
  });
  console.log(
    "PASS: unsigned macOS ARM64 package launches; archive excludes credentials, local notes and node_modules.",
  );
} finally {
  if (app) await app.close();
  await rm(state, { recursive: true, force: true });
}
