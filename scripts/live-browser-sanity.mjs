import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

export async function inspectStaticWebApp(app, project, screenshot) {
  const root = await realpath(project);
  const token = randomBytes(24).toString("hex");
  const deniedRequests = [];
  const server = createServer(async (request, response) => {
    try {
      const requested = decodeURIComponent(
        new URL(request.url, "http://localhost").pathname,
      );
      if (!requested.startsWith(`/${token}/`))
        throw new Error("Unavailable path");
      const pathname = requested.slice(token.length + 1);
      const parts = pathname.split("/");
      if (
        request.method !== "GET" ||
        parts.some(
          (part) =>
            part.startsWith(".") ||
            part === "node_modules" ||
            part === "AGENTS.md" ||
            part === ".env",
        )
      )
        throw new Error("Unavailable path");
      const path = resolve(
        root,
        "." + (pathname === "/" ? "/index.html" : pathname),
      );
      if (!path.startsWith(root + sep)) throw new Error("Unavailable path");
      const resolved = await realpath(path);
      const stat = await lstat(path);
      if (
        !resolved.startsWith(root + sep) ||
        resolved !== path ||
        resolved
          .slice(root.length + 1)
          .split(sep)
          .some((part) => part.startsWith(".") || part === "node_modules") ||
        stat.isSymbolicLink() ||
        stat.size > 1_000_000
      )
        throw new Error("Unavailable path");
      response.writeHead(200, {
        "content-type": mime[extname(path)] || "text/plain; charset=utf-8",
      });
      response.end(await readFile(path));
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  let page;
  let origin;
  try {
    origin = `http://127.0.0.1:${server.address().port}/${token}`;
    await app.firstWindow();
    const opened = app.waitForEvent("window", { timeout: 10_000 });
    opened.catch(() => {});
    await app.evaluate(async ({ BrowserWindow, session }, target) => {
      const partition = `pearl-static-check-${target.split("/").at(-1)}`;
      const isolated = session.fromPartition(partition);
      isolated.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );
      isolated.webRequest.onBeforeRequest((details, callback) => {
        callback({ cancel: !details.url.startsWith(target + "/") });
      });
      const win = new BrowserWindow({
        show: false,
        webPreferences: {
          partition,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      globalThis.scullyStaticSanityWindows ||= new Map();
      globalThis.scullyStaticSanityWindows.set(target, win);
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", (event, url) => {
        if (!url.startsWith(target + "/")) event.preventDefault();
      });
      await win.loadURL(target + "/");
    }, origin);
    page = await opened;
    await page.waitForURL(origin + "/");
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message.slice(0, 300)));
    page.on("requestfailed", (request) => {
      if (!request.url().startsWith(origin + "/"))
        deniedRequests.push(request.url().slice(0, 300));
    });
    await page.reload();
    const state = await page.evaluate(() => ({
      title: document.title.slice(0, 200),
      visibleText: (document.body?.innerText || "").slice(0, 5_000),
      hiddenViolations: [...document.querySelectorAll("[hidden]")]
        .filter((element) => getComputedStyle(element).display !== "none")
        .slice(0, 20)
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          id: element.id.slice(0, 100),
        })),
    }));
    if (screenshot) await page.screenshot({ path: screenshot });
    return {
      ...state,
      pageErrors: errors,
      deniedExternalRequests: deniedRequests.length,
      passed:
        state.visibleText.length > 0 &&
        state.hiddenViolations.length === 0 &&
        errors.length === 0,
    };
  } finally {
    await page?.close().catch(() => {});
    if (origin) {
      await app
        .evaluate((_electron, target) => {
          globalThis.scullyStaticSanityWindows?.get(target)?.destroy();
          globalThis.scullyStaticSanityWindows?.delete(target);
        }, origin)
        .catch(() => {});
    }
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
}
