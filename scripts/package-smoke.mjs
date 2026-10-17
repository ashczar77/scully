import { _electron as electron } from "playwright";
import { listPackage } from "@electron/asar";
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
assert(entries.some((p) => p.endsWith("/worker.cjs")));
assert(entries.some((p) => p.endsWith("/branding/scully.png")));
assert(entries.some((p) => p.endsWith("/fonts/ChelseaMarket-OFL.txt")));
assert(entries.some((p) => /\/ChelseaMarket-Regular-[^/]+\.ttf$/.test(p)));
for (const name of [
  "adrian",
  "carmen",
  "ellis",
  "jess",
  "jun",
  "kiran",
  "maya",
  "meryl",
  "nadine",
  "rafi",
  "sloane",
  "tessa",
])
  assert(
    entries.some((p) =>
      new RegExp(`/team-portrait-${name}-[^/]+\\.png$`).test(p),
    ),
    `Packaged portrait missing for ${name}`,
  );
assert.equal(
  entries.filter((p) =>
    /\/team-portrait-(?:coordinator|young-1|research|reliability)-v1-[^/]+\.png$/.test(
      p,
    ),
  ).length,
  4,
);
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
    args: [],
    env: { ...process.env, SCULLY_TEST_DATA: state },
    timeout: 30000,
  });
  const page = await app.firstWindow();
  await page
    .getByRole("heading", { name: "What would you like to build?" })
    .waitFor();
  await page.getByRole("textbox", { name: "Start a task" }).waitFor();
  assert.equal(
    await page
      .locator(".brand-logo")
      .evaluate((image) => image.naturalWidth > 0),
    true,
  );
  assert.equal(
    await page.getByRole("button", { name: "Send", exact: true }).isDisabled(),
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
