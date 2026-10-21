import assert from "node:assert/strict";
import { createServer } from "node:http";
import { lstat, readFile, realpath } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

export async function checkDisposableReadingList(app, project, screenshot) {
  const root = await realpath(project);
  const server = createServer(async (request, response) => {
    let path;
    try {
      const pathname = decodeURIComponent(
        new URL(request.url, "http://localhost").pathname,
      );
      if (
        request.method !== "GET" ||
        pathname.split("/").some((part) => part.startsWith("."))
      )
        throw new Error("Unavailable path");
      path = resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
      if (!path.startsWith(root + sep)) throw new Error("Unavailable path");
      const resolved = await realpath(path);
      const stat = await lstat(path);
      if (
        !resolved.startsWith(root + sep) ||
        resolved
          .slice(root.length + 1)
          .split(sep)
          .some((part) => part.startsWith(".") || part === "node_modules") ||
        stat.isSymbolicLink() ||
        stat.size > 1_000_000
      )
        throw new Error("Unavailable path");
      const content = await readFile(path);
      response.writeHead(200, {
        "content-type": mime[extname(path)] || "text/plain; charset=utf-8",
      });
      response.end(content);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    await app.evaluate(
      async ({ BrowserWindow, session }, target) => {
        const partition = `pearl-browser-check-${Date.now()}`;
        const isolated = session.fromPartition(partition);
        isolated.webRequest.onBeforeRequest((details, callback) => {
          callback({ cancel: !details.url.startsWith(target.origin + "/") });
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
        await win.loadURL(target.origin + "/");
      },
      { origin },
    );
    const page = (await app.windows()).find((item) =>
      item.url().startsWith(origin + "/"),
    );
    assert(page, "Disposable browser window did not open");
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const openAddForm = async () => {
      if (!(await page.locator("#title-input").isVisible())) {
        await page.keyboard.press("n");
        await page.locator("#title-input").waitFor({ state: "visible" });
      }
    };
    await openAddForm();
    await page.locator("#title-input").fill("Dune");
    await page.locator("#title-input").press("Enter");
    assert.match(await page.locator("#book-list").innerText(), /Dune/);
    await openAddForm();
    await page.locator("#title-input").fill("Foundation");
    await page.locator("#author-input").fill("Isaac Asimov");
    await page.locator("#author-input").press("Enter");
    const before = await page.locator("#book-list").innerText();
    assert.match(before, /Foundation/);
    await page.reload();
    const after = await page.locator("#book-list").innerText();
    assert.match(after, /Dune/);
    assert.match(after, /Foundation/);
    if (await page.locator("#book-list .book").count()) {
      await page.keyboard.press("j");
      assert.equal(await page.locator("#book-list .book.selected").count(), 1);
      const status = await page.locator(".book.selected .status").innerText();
      await page.keyboard.press("Space");
      assert.notEqual(
        await page.locator(".book.selected .status").innerText(),
        status,
      );
      await page.keyboard.press("/");
      await page.locator("#search-input").fill("Dune");
      assert.equal(await page.locator("#book-list .book").count(), 1);
      await page.locator("#search-input").press("Escape");
      assert.equal(await page.locator("#book-list .book").count(), 2);
      await page.keyboard.press("?");
      assert.equal(await page.locator("#help").isVisible(), true);
      await page.keyboard.press("?");
      assert.equal(await page.locator("#help").isVisible(), false);
    }
    assert.deepEqual(errors, []);
    if (screenshot) await page.screenshot({ path: screenshot, fullPage: true });
    await page.close();
    return { passed: true, booksPersisted: 2, pageErrors: 0 };
  } finally {
    await new Promise((done) => server.close(done));
  }
}
