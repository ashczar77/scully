// @vitest-environment node
import { expect, it, vi } from "vitest";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  installedBrowsers,
  openInBrowser,
} from "../src/main/pearl-browser-launch";

it("offers installed macOS browsers without listing missing ones", () => {
  const browsers = installedBrowsers(
    "darwin",
    {},
    (path) =>
      path === "/System/Applications/Safari.app/Contents/MacOS/Safari" ||
      path === "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  );
  expect(browsers.map((browser) => browser.id)).toEqual(["safari", "chrome"]);
});

it("finds known Windows browser executables from platform locations", () => {
  const browsers = installedBrowsers(
    "win32",
    { PROGRAMFILES: "C:\\Program Files" },
    (path) =>
      path.endsWith("Microsoft/Edge/Application/msedge.exe") ||
      path.endsWith("Microsoft\\Edge\\Application\\msedge.exe"),
  );
  expect(browsers.map((browser) => browser.id)).toEqual(["edge"]);
});

it.skipIf(process.platform === "win32")(
  "launches a selected browser directly with the reviewed URL",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "scully-browser-launch-"));
    const executable = join(root, "browser.sh");
    const output = join(root, "url.txt");
    try {
      writeFileSync(executable, `#!/bin/sh\nprintf '%s' "$1" > '${output}'\n`);
      chmodSync(executable, 0o700);
      await openInBrowser(
        { id: "test", label: "Test browser", executable },
        "https://example.com/project",
      );
      await vi.waitFor(() =>
        expect(readFileSync(output, "utf8")).toBe(
          "https://example.com/project",
        ),
      );
      await expect(
        openInBrowser(
          { id: "test", label: "Test browser", executable },
          "javascript:alert(1)",
        ),
      ).rejects.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
