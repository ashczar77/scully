import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  net,
  protocol,
  session,
  shell,
} from "electron";
import { mkdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { nebiusPearlModel } from "../engine/pearl-model";
import { LocalMetrics, measured, type Operation } from "../shared/telemetry";
import { PearlChatManager } from "./pearl-chat-manager";
import { PearlSandboxService } from "./pearl-sandbox";
import { IsolatedPearlBrowser } from "./pearl-browser";
import { PearlChatStore } from "./pearl-chat-store";
import { roomChat, roomResult } from "./pearl-chat-view";
import { PearlSession } from "./pearl-session";
import { fetchModelCatalog } from "./model-catalog";
import type { ModelOption } from "../shared/runs";
import { PearlWebAccess, PearlWebConnection } from "./pearl-web";
import { RemoteMcpConnection } from "./pearl-mcp";
import { TavilyWebProvider } from "./pearl-tavily";
import { cappedPearlModel, liveModelRequestLimit } from "./pearl-test-model";
import { confirmExternalLink } from "./pearl-external-link";
import { installedBrowsers, openInBrowser } from "./pearl-browser-launch";

declare const __SCULLY_DEV_HARNESS__: boolean;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "scully",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
app.commandLine.appendSwitch("disable-http-cache");

const metrics = new LocalMetrics();
const settings = new PearlSession();
const webConnection = new PearlWebConnection();
const appIcon = join(__dirname, "branding", "scully.png");
const testingPath = process.env.SCULLY_TEST_DATA;
if (testingPath && !app.isPackaged) app.setPath("userData", testingPath);
const mcpTestEndpoint =
  testingPath && !app.isPackaged
    ? process.env.SCULLY_PEARL_MCP_TEST_ENDPOINT
    : undefined;
if (mcpTestEndpoint) {
  const url = new URL(mcpTestEndpoint);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1")
    throw new Error("Invalid local MCP test endpoint");
}
const remoteMcp = new RemoteMcpConnection(
  mcpTestEndpoint
    ? (input, init) =>
        fetch(
          new URL(new URL(String(input)).pathname, mcpTestEndpoint),
          init as RequestInit,
        ) as never
    : undefined,
);
const webTestEndpoint =
  testingPath && !app.isPackaged
    ? process.env.SCULLY_PEARL_WEB_TEST_ENDPOINT
    : undefined;
if (webTestEndpoint) {
  const url = new URL(webTestEndpoint);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1")
    throw new Error("Invalid local web test endpoint");
}
const webFetch: typeof fetch = webTestEndpoint
  ? (input, init) =>
      fetch(new URL(new URL(String(input)).pathname, webTestEndpoint), init)
  : fetch;
const webAccess = new PearlWebAccess(
  new TavilyWebProvider(() => webConnection.current(), webFetch),
);
const ownsWorkspace = app.requestSingleInstanceLock();
if (!ownsWorkspace) app.quit();

let win: BrowserWindow | null = null;
let chats: PearlChatStore | null = null;
let pearl: PearlChatManager | null = null;
let pearlModels: ModelOption[] = [];

function window() {
  win = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1000,
    minHeight: 700,
    title: "Scully",
    backgroundColor: "#11171d",
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());
  win.on("closed", () => {
    win = null;
  });
  void win.loadURL("scully://app/index.html");
}

function trusted(event: Electron.IpcMainInvokeEvent): void {
  if (
    !win ||
    event.sender !== win.webContents ||
    event.senderFrame !== win.webContents.mainFrame ||
    event.senderFrame.url !== "scully://app/index.html"
  )
    throw new Error("Untrusted request");
}

function handle<T extends unknown[]>(
  channel: Operation,
  listener: (event: Electron.IpcMainInvokeEvent, ...args: T) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    trusted(event);
    return measured(
      channel,
      async () => roomResult(await listener(event, ...(args as T))),
      metrics.record,
    );
  });
}

app.on("second-instance", () => {
  win?.show();
  win?.focus();
});
app
  .whenReady()
  .then(async () => {
    if (!ownsWorkspace) return;
    await session.defaultSession.clearCache().catch(() => {});
    if (process.platform === "darwin") app.dock?.setIcon(appIcon);
    const root = resolve(__dirname, "renderer");
    protocol.handle("scully", (request) => {
      const url = new URL(request.url);
      let pathname: string;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        return new Response("Bad path", { status: 400 });
      }
      const file = resolve(root, "." + pathname);
      if (
        url.host !== "app" ||
        request.method !== "GET" ||
        !file.startsWith(root + sep)
      )
        return new Response("Forbidden", { status: 403 });
      return net.fetch(pathToFileURL(file).toString());
    });
    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    mkdirSync(app.getPath("userData"), { recursive: true });
    chats = new PearlChatStore(
      join(app.getPath("userData"), "workspace.sqlite"),
    );
    const fixtureEndpoint =
      !app.isPackaged && testingPath
        ? process.env.SCULLY_PEARL_TEST_ENDPOINT
        : undefined;
    if (fixtureEndpoint) {
      const url = new URL(fixtureEndpoint);
      if (url.protocol !== "http:" || url.hostname !== "127.0.0.1")
        throw new Error("Invalid local Pearl test endpoint");
    }
    const baseModel = nebiusPearlModel(fetch, fixtureEndpoint);
    const model = __SCULLY_DEV_HARNESS__
      ? !app.isPackaged && process.env.SCULLY_LIVE_TEST === "1"
        ? cappedPearlModel(
            baseModel,
            liveModelRequestLimit(process.env.SCULLY_LIVE_MAX_REQUESTS),
          )
        : baseModel
      : baseModel;
    pearl = new PearlChatManager(
      chats,
      app.getPath("userData"),
      () => settings.current(),
      (chat) => win?.webContents.send("pearl:update", roomChat(chat)),
      model,
      metrics.record,
      new IsolatedPearlBrowser(),
      undefined,
      undefined,
      webAccess,
      () => webConnection.info().configured,
      undefined,
      undefined,
      remoteMcp,
      new PearlSandboxService(app.getPath("userData")),
      (model) =>
        pearlModels.some(
          (item) => item.id === model && item.supportsImages === true,
        ),
    );

    ipcMain.handle("pearl:sandbox:connection", (event) => {
      trusted(event);
      return pearl!.sandboxConnection();
    });
    handle("pearl:sandbox:configure", (_event, key, projectId) =>
      pearl!.configureSandbox(key, projectId),
    );
    handle("pearl:sandbox:images", () => pearl!.sandboxImages());
    handle("pearl:sandbox:prepare", (_event, id, imageId) =>
      pearl!.prepareSandbox(id, imageId),
    );
    handle("pearl:sandbox:start", (_event, id) => pearl!.startSandbox(id));
    handle("pearl:sandbox:reconcile", (_event, id) =>
      pearl!.reconcileSandbox(id),
    );
    handle("pearl:sandbox:fork", (_event, id, name) =>
      pearl!.forkSandbox(id, name),
    );
    handle("pearl:sandbox:switch", (_event, id, branchId) =>
      pearl!.switchSandboxBranch(id, branchId),
    );
    handle("pearl:sandbox:leave", (_event, id) => pearl!.leaveSandbox(id));
    handle("pearl:sandbox:review-sync", (_event, id) =>
      pearl!.reviewSandboxSync(id),
    );
    handle("pearl:sandbox:approve-sync", (_event, id, token) =>
      pearl!.approveSandboxSync(id, token),
    );
    handle("pearl:sandbox:file", (_event, id, path) =>
      pearl!.reviewSandboxFile(id, path),
    );
    handle("pearl:sandbox:snapshot", (_event, id) =>
      pearl!.sandboxSnapshot(id),
    );
    handle("pearl:sandbox:inspect-file", (_event, id, path) =>
      pearl!.inspectSandboxFile(id, path),
    );

    ipcMain.handle("pearl:mcp:info", (event) => {
      trusted(event);
      return remoteMcp.info();
    });
    handle("pearl:mcp:connect", async (_event, endpoint, token) => {
      try {
        return await remoteMcp.connect(endpoint, token);
      } finally {
        pearl!.invalidateRemoteMcpApprovals();
      }
    });
    handle("pearl:mcp:disconnect", async () => {
      const info = await remoteMcp.disconnect();
      pearl!.invalidateRemoteMcpApprovals();
      return info;
    });

    ipcMain.handle("pearl:web:info", (event) => {
      trusted(event);
      return webConnection.info();
    });
    handle("pearl:web:configure", (_event, key) =>
      webConnection.configure(key),
    );
    handle("pearl:web:disconnect", () => {
      webConnection.close();
      return webConnection.info();
    });

    ipcMain.handle("pearl:list", (event, scope) => {
      trusted(event);
      return pearl!.list(scope);
    });
    handle("pearl:create", () => pearl!.openNewChat());
    ipcMain.handle("pearl:get", (event, id) => {
      trusted(event);
      return roomChat(pearl!.get(id));
    });
    handle("pearl:archive", (_event, id) => pearl!.archive(id));
    handle("pearl:restore", (_event, id) => pearl!.restore(id));
    handle("pearl:permanent-delete", (_event, id) =>
      pearl!.deletePermanently(id),
    );
    handle("pearl:send", (_event, id, text) => pearl!.send(id, text));
    handle("pearl:attachment:prepare", (_event, id, input) =>
      pearl!.prepareAttachment(id, input),
    );
    handle("pearl:attachment:remove", (_event, id, attachmentId) =>
      pearl!.removeAttachment(id, attachmentId),
    );
    handle("pearl:external-link", (_event, value) => {
      let selectedBrowser:
        ReturnType<typeof installedBrowsers>[number] | undefined;
      return confirmExternalLink(
        value,
        async (url) => {
          const browsers = installedBrowsers();
          const { response } = await dialog.showMessageBox(win!, {
            type: "question",
            buttons: [
              "Cancel",
              "Copy link",
              ...browsers.map((browser) => `Open in ${browser.label}`),
              "Use system default",
            ],
            defaultId: 2,
            cancelId: 0,
            message: "Open external link?",
            detail: url,
          });
          selectedBrowser = browsers[response - 2];
          return response === 1 ? "copy" : response >= 2 ? "open" : "cancel";
        },
        (url) =>
          selectedBrowser
            ? openInBrowser(selectedBrowser, url)
            : shell.openExternal(url),
        (url) => clipboard.writeText(url),
        async (url, canRetry) => {
          const browsers = installedBrowsers();
          const buttons = [
            "Cancel",
            "Copy link",
            ...browsers.map((browser) => `Open in ${browser.label}`),
            ...(canRetry ? ["Use system default"] : []),
          ];
          const { response } = await dialog.showMessageBox(win!, {
            type: "warning",
            buttons,
            defaultId: 1,
            cancelId: 0,
            message: "The browser did not open",
            detail: `Choose another installed browser or copy the link:\n${url}`,
          });
          if (response === 1) return "copy";
          const browser = browsers[response - 2];
          if (browser) {
            try {
              await openInBrowser(browser, url);
              return "open";
            } catch {
              const failure = await dialog.showMessageBox(win!, {
                type: "warning",
                buttons: ["Cancel", "Copy link"],
                defaultId: 1,
                cancelId: 0,
                message: `${browser.label} did not open`,
                detail: url,
              });
              return failure.response === 1 ? "copy" : "cancel";
            }
          }
          if (canRetry && response === buttons.length - 1) {
            selectedBrowser = undefined;
            return "retry";
          }
          return "cancel";
        },
      );
    });
    handle("pearl:rename", (_event, id, title) => pearl!.rename(id, title));
    handle("pearl:workspace:list", (_event, id, directory, offset) =>
      pearl!.projectFiles(
        id,
        directory as string | undefined,
        offset as number | undefined,
      ),
    );
    handle("pearl:workspace:read", (_event, id, path) =>
      pearl!.projectFile(id, path),
    );
    handle("pearl:git:view", (_event, id) => pearl!.gitView(id));
    handle("pearl:git:diff", (_event, id, path, commit) =>
      pearl!.gitDiff(id, path, commit),
    );
    handle("pearl:git:commit-files", (_event, id, commit) =>
      pearl!.gitCommitFiles(id, commit),
    );
    handle("pearl:task:file", (_event, id, turnId, path) =>
      pearl!.taskFileReview(id, turnId, path),
    );
    handle("pearl:task:undo", (_event, id, turnId) =>
      pearl!.undoTask(id, turnId),
    );
    handle("pearl:project:choose", async (_event, id) => {
      const result = await dialog.showOpenDialog(win!, {
        title: "Choose a project for Pearl",
        properties: ["openDirectory", "createDirectory"],
      });
      return result.canceled
        ? null
        : pearl!.chooseProject(
            id == null ? pearl!.openNewChat().id : id,
            result.filePaths[0],
          );
    });
    handle("pearl:project:approve", (_event, id, approved) =>
      pearl!.approveProject(id, approved),
    );
    handle("pearl:permission:update", (_event, id, permission, enabled) =>
      pearl!.updatePermission(id, permission, enabled),
    );
    handle("pearl:tool:decide", (_event, id, callId, approved) =>
      pearl!.decideTool(id, callId, approved),
    );
    handle("pearl:question:answer", (_event, id, questionId, answer) =>
      pearl!.answerQuestion(id, questionId, answer),
    );
    handle("pearl:retry", (_event, id) => pearl!.retry(id));
    handle("pearl:stop", (_event, id) => pearl!.stop(id));
    handle("pearl:terminal:input", (_event, id, terminalId, value) =>
      pearl!.sendTerminalInput(id, terminalId, value),
    );
    handle("pearl:terminal:resize", (_event, id, terminalId, cols, rows) =>
      pearl!.resizeTerminal(id, terminalId, cols, rows),
    );
    handle("pearl:terminal:stop", (_event, id, terminalId) =>
      pearl!.stopTerminal(id, terminalId),
    );
    ipcMain.handle("session:info", (event) => {
      trusted(event);
      return settings.info();
    });
    handle("session:configure", (_event, value) => {
      pearlModels = [];
      return settings.configure(value);
    });
    handle("session:pearl-model-choice", (_event, value) =>
      settings.selectModels(value),
    );
    handle("session:pearl-models", async () => {
      const key = settings.current()?.key;
      if (!key) throw new Error("Connect Nebius before loading models.");
      pearlModels = await fetchModelCatalog(key);
      return pearlModels;
    });
    ipcMain.handle("metrics:read", (event) => {
      trusted(event);
      return metrics.snapshot();
    });

    window();
    app.on("activate", () => {
      if (!win) window();
    });
  })
  .catch((error) => {
    dialog.showErrorBox(
      "Scully could not start",
      error instanceof Error ? error.message : "Unknown startup error",
    );
    app.quit();
  });
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
let previewsClosed = false;
app.on("before-quit", (event) => {
  if (previewsClosed || !pearl) return;
  event.preventDefault();
  previewsClosed = true;
  void Promise.all([pearl.closeTerminals(), pearl.closePreviews()]).finally(
    () => app.quit(),
  );
});
app.on("will-quit", () => {
  settings.close();
  webConnection.close();
  void remoteMcp.disconnect();
  chats?.close();
});
