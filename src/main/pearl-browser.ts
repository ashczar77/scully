import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { BrowserWindow, session } from "electron";
import type { ProjectWorkspace } from "../shared/runs";
import { safePath } from "../shared/runs";
import { inspectProjectFile, verifyProjectRoot } from "./project-workspace";
import { blockedProjectPart } from "./pearl-project-map";
import { boundedBrowserWork, type BrowserStep } from "./pearl-browser-steps";

export type BrowserCheckResult = {
  title: string;
  initialVisibleText: string;
  visibleText: string;
  controls: { tag: string; id: string; label: string; type: string }[];
  hiddenViolations: { tag: string; id: string }[];
  errors: string[];
  blockedExternalRequests: number;
  completedSteps: number;
};

export type PearlBrowser = {
  check: (
    project: ProjectWorkspace,
    entryPath: string,
    steps: BrowserStep[],
    signal?: AbortSignal,
  ) => Promise<BrowserCheckResult>;
};

const mime: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
};

function projectRelative(value: string): string {
  safePath(value);
  if (value.split("/").some(blockedProjectPart))
    throw new Error("Browser path is private or unavailable");
  return value;
}

async function snapshot(
  win: BrowserWindow,
): Promise<
  Pick<
    BrowserCheckResult,
    "title" | "visibleText" | "controls" | "hiddenViolations"
  >
> {
  return win.webContents.executeJavaScript(`(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    };
    return {
      title: document.title.slice(0, 200),
      visibleText: (document.body?.innerText || "").slice(0, 10000),
      controls: [...document.querySelectorAll("input, textarea, select, button, a")]
        .filter(visible).slice(0, 60).map((element) => ({
          tag: element.tagName.toLowerCase(),
          id: element.id.slice(0, 100),
          label: (element.getAttribute("aria-label") || element.textContent || "").trim().slice(0, 100),
          type: (element.getAttribute("type") || "").slice(0, 40),
        })),
      hiddenViolations: [...document.querySelectorAll("[hidden]")]
        .filter(visible).slice(0, 20).map((element) => ({
          tag: element.tagName.toLowerCase(),
          id: element.id.slice(0, 100),
        })),
    };
  })()`);
}

async function perform(win: BrowserWindow, step: BrowserStep, url: string) {
  if (step.action === "reload") {
    await win.loadURL(url);
    return;
  }
  if (step.selector) {
    const target = await win.webContents.executeJavaScript(`(() => {
      const element = document.querySelector(${JSON.stringify(step.selector)});
      if (!element) return "missing";
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || !element.getClientRects().length) return "hidden";
      element.scrollIntoView({ block: "center", inline: "center" });
      const rect = element.getBoundingClientRect();
      const x = Math.round(rect.left + rect.width / 2);
      const y = Math.round(rect.top + rect.height / 2);
      if (${JSON.stringify(step.action)} === "click") {
        const hit = document.elementFromPoint(x, y);
        if (hit !== element && !element.contains(hit)) return "covered";
        return { x, y };
      }
      element.focus();
      if (${JSON.stringify(step.action)} === "fill") {
        if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return "unsupported";
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
        setter?.call(element, ${JSON.stringify(step.value || "")});
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return "ok";
    })()`);
    if (step.action === "click" && typeof target === "object" && target) {
      const [width, height] = win.getContentSize();
      if (
        !Number.isFinite(target.x) ||
        !Number.isFinite(target.y) ||
        target.x < 0 ||
        target.y < 0 ||
        target.x >= width ||
        target.y >= height
      )
        throw new Error("Browser target is outside the page");
      win.webContents.sendInputEvent({
        type: "mouseMove",
        x: target.x,
        y: target.y,
      });
      win.webContents.sendInputEvent({
        type: "mouseDown",
        x: target.x,
        y: target.y,
        button: "left",
        clickCount: 1,
      });
      win.webContents.sendInputEvent({
        type: "mouseUp",
        x: target.x,
        y: target.y,
        button: "left",
        clickCount: 1,
      });
    } else if (target !== "ok") throw new Error(`Browser target is ${target}`);
  }
  if (step.action === "press") {
    win.webContents.sendInputEvent({
      type: "keyDown",
      keyCode: step.key === "Space" ? " " : step.key!,
    });
    win.webContents.sendInputEvent({
      type: "keyUp",
      keyCode: step.key === "Space" ? " " : step.key!,
    });
  }
  await new Promise((done) => setTimeout(done, 80));
}

export class IsolatedPearlBrowser implements PearlBrowser {
  async check(
    project: ProjectWorkspace,
    entryPath: string,
    steps: BrowserStep[],
    signal?: AbortSignal,
  ): Promise<BrowserCheckResult> {
    if (signal?.aborted) throw new Error("Browser check stopped");
    verifyProjectRoot(project);
    projectRelative(entryPath);
    if (!entryPath.endsWith(".html"))
      throw new Error("Choose an HTML entry file for browser check");
    if (inspectProjectFile(project, entryPath) === null)
      throw new Error("Browser entry file does not exist");
    const token = randomBytes(24).toString("hex");
    let blockedExternalRequests = 0;
    const server = createServer((request, response) => {
      try {
        if (request.method !== "GET") throw new Error("Unavailable request");
        const pathname = decodeURIComponent(
          new URL(request.url || "/", "http://localhost").pathname,
        );
        if (!pathname.startsWith(`/${token}/`))
          throw new Error("Unavailable request");
        const path = projectRelative(pathname.slice(token.length + 2));
        const content = inspectProjectFile(project, path);
        if (content === null || content.length > 1_000_000)
          throw new Error("Unavailable file");
        response.writeHead(200, {
          "content-type":
            mime[path.split(".").at(-1) || ""] || "text/plain; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        response.end(content);
      } catch {
        response.writeHead(404);
        response.end();
      }
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    let win: BrowserWindow | undefined;
    try {
      const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}/${token}`;
      const url = `${origin}/${entryPath}`;
      const isolated = session.fromPartition(`pearl-browser-${token}`);
      isolated.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );
      isolated.setPermissionCheckHandler(() => false);
      isolated.webRequest.onBeforeRequest((details, callback) => {
        const allowed = details.url.startsWith(origin + "/");
        if (!allowed) blockedExternalRequests++;
        callback({ cancel: !allowed });
      });
      win = new BrowserWindow({
        show: false,
        webPreferences: {
          partition: `pearl-browser-${token}`,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", (event, target) => {
        if (!target.startsWith(origin + "/")) event.preventDefault();
      });
      const errors: string[] = [];
      win.webContents.on("console-message", (details) => {
        if (details.level === "error" && errors.length < 10)
          errors.push(details.message.slice(0, 300));
      });
      win.webContents.on("did-fail-load", (_event, code, description) => {
        if (errors.length < 10)
          errors.push(`${code}: ${description}`.slice(0, 300));
      });
      await boundedBrowserWork(win.loadURL(url), 15_000, signal);
      const initial = await boundedBrowserWork(snapshot(win), 5_000, signal);
      const hiddenViolations = new Map<string, { tag: string; id: string }>();
      const rememberViolations = (
        state: Awaited<ReturnType<typeof snapshot>>,
      ) => {
        for (const violation of state.hiddenViolations)
          hiddenViolations.set(`${violation.tag}:${violation.id}`, violation);
      };
      rememberViolations(initial);
      let completedSteps = 0;
      let final = initial;
      for (const step of steps) {
        await boundedBrowserWork(perform(win, step, url), 5_000, signal);
        completedSteps++;
        final = await boundedBrowserWork(snapshot(win), 5_000, signal);
        rememberViolations(final);
      }
      return {
        ...final,
        initialVisibleText: initial.visibleText.slice(0, 3000),
        hiddenViolations: [...hiddenViolations.values()].slice(0, 20),
        errors: errors.slice(0, 10),
        blockedExternalRequests,
        completedSteps,
      };
    } finally {
      if (win && !win.isDestroyed()) win.destroy();
      await new Promise<void>((done) => server.close(() => done()));
    }
  }
}
