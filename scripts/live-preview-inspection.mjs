import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Independent inspection of a generated disposable app. This helper receives
// the selected Node entry from the test driver, not from the model at runtime.
export async function inspectLiveWebApp(
  app,
  project,
  entry,
  screenshot,
  exercise,
) {
  const temporary = await mkdtemp(join(tmpdir(), "pearl-inspection-"));
  let page;
  try {
    const modulePath = join(temporary, "preview.mjs");
    await build({
      entryPoints: ["src/main/pearl-preview.ts"],
      outfile: modulePath,
      bundle: true,
      platform: "node",
      format: "esm",
    });
    const { withProjectPreview } = await import(pathToFileURL(modulePath).href);
    return await withProjectPreview(
      process.execPath,
      [entry],
      project,
      async (origin) => {
        const opened = app.waitForEvent("window", { timeout: 10_000 });
        opened.catch(() => {});
        await app.evaluate(({ BrowserWindow, session }, target) => {
          const partition = `independent-preview-${Date.now()}`;
          const isolated = session.fromPartition(partition);
          isolated.setPermissionRequestHandler(
            (_contents, _permission, callback) => callback(false),
          );
          isolated.setPermissionCheckHandler(() => false);
          isolated.webRequest.onBeforeRequest((details, callback) =>
            callback({ cancel: !details.url.startsWith(target + "/") }),
          );
          const win = new BrowserWindow({
            show: false,
            webPreferences: {
              partition,
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: true,
            },
          });
          win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
          win.webContents.on("will-navigate", (event, url) => {
            if (!url.startsWith(target + "/")) event.preventDefault();
          });
          void win.loadURL(target + "/");
        }, origin);
        page = await opened;
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.waitForURL(origin + "/**");
        await page.waitForLoadState("domcontentloaded");
        const interactions = exercise
          ? await exercise(page, origin)
          : undefined;
        const state = await page.evaluate(() => ({
          title: document.title,
          visibleText: document.body.innerText.slice(0, 10000),
          hiddenViolations: [...document.querySelectorAll("[hidden]")]
            .filter((e) => getComputedStyle(e).display !== "none")
            .map((e) => ({ tag: e.tagName, id: e.id })),
        }));
        if (screenshot)
          await page.screenshot({ path: screenshot, fullPage: true });
        await page.close();
        page = undefined;
        return {
          ...state,
          interactions,
          pageErrors: errors,
          passed:
            Boolean(state.visibleText.trim()) &&
            !state.hiddenViolations.length &&
            !errors.length,
        };
      },
    );
  } finally {
    await page?.close().catch(() => {});
    await rm(temporary, { recursive: true, force: true });
  }
}
