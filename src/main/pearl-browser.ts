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
  controls: {
    tag: string;
    id: string;
    label: string;
    type: string;
    name?: string;
    selector?: string;
    options?: { value: string; text: string }[];
  }[];
  hiddenViolations: { tag: string; id: string }[];
  errors: string[];
  blockedExternalRequests: number;
  completedSteps: number;
  observations?: { step: number; visibleText: string }[];
};

export type PearlBrowser = {
  openLive?: (
    id: string,
    origin: string,
    path: string,
    steps: BrowserStep[],
    signal?: AbortSignal,
  ) => Promise<BrowserCheckResult>;
  continueLive?: (
    id: string,
    path: string | undefined,
    steps: BrowserStep[],
    signal?: AbortSignal,
  ) => Promise<BrowserCheckResult>;
  closeLive?: (id: string) => void;
  checkLive?: (
    origin: string,
    path: string,
    steps: BrowserStep[],
    signal?: AbortSignal,
  ) => Promise<BrowserCheckResult>;
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
    const selectorFor = (element) => {
      const path = [];
      for (let current = element; current; current = current.parentElement) {
        if (current.id && document.querySelectorAll("#" + CSS.escape(current.id)).length === 1) {
          path.unshift("#" + CSS.escape(current.id));
          break;
        }
        const tag = current.tagName.toLowerCase();
        const siblings = current.parentElement ? [...current.parentElement.children].filter(sibling => sibling.tagName === current.tagName) : [current];
        path.unshift(tag + ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")");
      }
      return path.join(" > ");
    };
    return {
      title: document.title.slice(0, 200),
      visibleText: (document.body?.innerText || "").slice(0, 10000),
      controls: [...document.querySelectorAll("input, textarea, select, button, a")]
        .filter(visible).slice(0, 60).map((element) => ({
          tag: element.tagName.toLowerCase(),
          id: element.id.slice(0, 100),
          name: (element.getAttribute("name") || "").slice(0, 100),
          selector: selectorFor(element),
          label: (element.getAttribute("aria-label") || element.labels?.[0]?.innerText || element.textContent || "").trim().slice(0, 100),
          type: (element.getAttribute("type") || "").slice(0, 40),
          ...(element instanceof HTMLSelectElement ? { options: [...element.options].slice(0, 30).map(option => ({ value: option.value, text: option.text })) } : {}),
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
  if (step.action === "wait_for") {
    const deadline = Date.now() + 4000;
    do {
      const found = await win.webContents.executeJavaScript(
        `(() => { const e = document.querySelector(${JSON.stringify(step.selector)}); return Boolean(e && e.getClientRects().length && getComputedStyle(e).visibility !== "hidden" && (!${JSON.stringify(step.value || "")} || e.textContent.includes(${JSON.stringify(step.value || "")}))); })()`,
      );
      if (found) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    throw new Error("Browser target did not become visible");
  }
  if (step.action === "reload") {
    await win.loadURL(win.webContents.getURL());
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
      if (${JSON.stringify(step.action)} === "select") {
        if (!(element instanceof HTMLSelectElement) || ![...element.options].some(option => option.value === ${JSON.stringify(step.value || "")})) return "unsupported option";
        element.value = ${JSON.stringify(step.value || "")};
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      }
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
    const keyCode =
      step.key === "Space" ? " " : step.key!.replace(/^Arrow/, "");
    win.webContents.sendInputEvent({
      type: "keyDown",
      keyCode,
    });
    if (step.key === "Enter" || step.key === "Space" || step.key?.length === 1)
      win.webContents.sendInputEvent({
        type: "char",
        keyCode:
          step.key === "Enter" ? "\r" : step.key === "Space" ? " " : step.key!,
      });
    win.webContents.sendInputEvent({
      type: "keyUp",
      keyCode,
    });
  }
  await new Promise((done) => setTimeout(done, 150));
  const deadline = Date.now() + 4000;
  while (win.webContents.isLoadingMainFrame() && Date.now() < deadline)
    await new Promise((done) => setTimeout(done, 50));
}

type ObservationSession = {
  win: BrowserWindow;
  origin: string;
  errors: string[];
  blocked: number;
};

export class IsolatedPearlBrowser implements PearlBrowser {
  private live = new Map<string, ObservationSession>();
  closeLive(id: string) {
    const state = this.live.get(id);
    if (state && !state.win.isDestroyed()) state.win.destroy();
    this.live.delete(id);
  }
  async openLive(
    id: string,
    origin: string,
    path: string,
    steps: BrowserStep[],
    signal?: AbortSignal,
  ) {
    if (!/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(origin))
      throw new Error("Invalid preview origin");
    const url = new URL(path, origin);
    if (url.origin !== origin || url.username || url.password)
      throw new Error("Invalid preview path");
    return this.observe(origin, url.href, steps, signal, id);
  }
  async continueLive(
    id: string,
    path: string | undefined,
    steps: BrowserStep[],
    signal?: AbortSignal,
  ) {
    const state = this.live.get(id);
    if (!state || state.win.isDestroyed())
      throw new Error("Preview session ended. Start a new preview.");
    const url = path === undefined ? undefined : new URL(path, state.origin);
    if (url && (url.origin !== state.origin || url.username || url.password))
      throw new Error("Invalid preview path");
    return this.observe(state.origin, url?.href, steps, signal, id);
  }
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
    try {
      const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}/${token}`;
      return await this.observe(
        origin,
        `${origin}/${entryPath}`,
        steps,
        signal,
      );
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  }

  async checkLive(
    origin: string,
    path: string,
    steps: BrowserStep[],
    signal?: AbortSignal,
  ) {
    if (!/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(origin))
      throw new Error("Invalid preview origin");
    const url = new URL(path, origin);
    if (url.origin !== origin || url.username || url.password)
      throw new Error("Invalid preview path");
    return this.observe(origin, url.href, steps, signal);
  }

  private createObservation(origin: string): ObservationSession {
    const token = randomBytes(24).toString("hex");
    const isolated = session.fromPartition(`pearl-browser-${token}`);
    isolated.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    isolated.setPermissionCheckHandler(() => false);
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        partition: `pearl-browser-${token}`,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const state: ObservationSession = { win, origin, errors: [], blocked: 0 };
    isolated.webRequest.onBeforeRequest((details, callback) => {
      const allowed = details.url.startsWith(origin + "/");
      if (!allowed) state.blocked++;
      callback({ cancel: !allowed });
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event, target) => {
      if (!target.startsWith(origin + "/")) event.preventDefault();
    });
    win.webContents.on("console-message", (details) => {
      if (details.level === "error" && state.errors.length < 10)
        state.errors.push(details.message.slice(0, 300));
    });
    win.webContents.on("did-fail-load", (_event, code, description) => {
      if (state.errors.length < 10 && code !== -3)
        state.errors.push(`${code}: ${description}`.slice(0, 300));
    });
    return state;
  }

  private async observe(
    origin: string,
    url: string | undefined,
    steps: BrowserStep[],
    signal?: AbortSignal,
    sessionId?: string,
  ): Promise<BrowserCheckResult> {
    signal?.throwIfAborted();
    const state =
      (sessionId && this.live.get(sessionId)) || this.createObservation(origin);
    if (sessionId) this.live.set(sessionId, state);
    const win = state.win;
    const errors = state.errors;
    errors.length = 0;
    state.blocked = 0;
    try {
      if (url) await boundedBrowserWork(win.loadURL(url), 15_000, signal);
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
      const observations: { step: number; visibleText: string }[] = [];
      let final = initial;
      for (const step of steps) {
        try {
          await boundedBrowserWork(
            perform(win, step, win.webContents.getURL()),
            5_000,
            signal,
          );
          completedSteps++;
          final = await boundedBrowserWork(snapshot(win), 5_000, signal);
          rememberViolations(final);
          observations.push({
            step: completedSteps,
            visibleText: final.visibleText.slice(0, 3000),
          });
        } catch (error) {
          if (signal?.aborted) throw error;
          errors.push(
            `Step ${completedSteps + 1} failed: ${error instanceof Error ? error.message : "Browser interaction failed"}. Earlier steps may have changed application data.`,
          );
          final = await boundedBrowserWork(snapshot(win), 5_000, signal);
          rememberViolations(final);
          break;
        }
      }
      return {
        ...final,
        initialVisibleText: initial.visibleText.slice(0, 3000),
        hiddenViolations: [...hiddenViolations.values()].slice(0, 20),
        errors: errors.slice(0, 10),
        blockedExternalRequests: state.blocked,
        completedSteps,
        observations,
      };
    } finally {
      if (!sessionId && !win.isDestroyed()) win.destroy();
    }
  }
}
