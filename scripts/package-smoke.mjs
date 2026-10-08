import { _electron as electron } from "playwright";
import { listPackage } from "@electron/asar";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
await mkdir("test-results", { recursive: true });
const bundle = resolve("out/Scully-darwin-arm64/Scully.app");
const entries = listPackage(`${bundle}/Contents/Resources/app.asar`);
assert(entries.some((p) => p.endsWith("/main.cjs")));
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
  await app.close();
}
