import { _electron as electron } from "playwright";
import { listPackage } from "@electron/asar";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdir, readFile } from "node:fs/promises";
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
assert.equal(
  entries.filter((p) => /\/team-portraits(?:-[234])?-[^/]+\.png$/.test(p))
    .length,
  4,
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
const app = await electron.launch({
  executablePath: `${bundle}/Contents/MacOS/scully`,
  args: [],
  timeout: 30000,
});
try {
  const page = await app.firstWindow();
  await page.getByRole("heading", { name: "Team room." }).waitFor();
  await page.getByRole("heading", { name: "Start your first task." }).waitFor();
  assert.equal(
    await page
      .locator(".brand-logo")
      .evaluate((image) => image.naturalWidth > 0),
    true,
  );
  assert.equal(
    await page.getByRole("button", { name: "Send message" }).count(),
    0,
  );
  await page.screenshot({
    path: "test-results/packaged-room.png",
    fullPage: true,
  });
  console.log(
    "PASS: unsigned macOS ARM64 package launches; archive excludes credentials, local notes and node_modules.",
  );
} finally {
  await app.close();
}
