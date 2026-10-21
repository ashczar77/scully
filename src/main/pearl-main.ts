import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  session,
} from "electron";
import { mkdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { nebiusPearlModel } from "../engine/pearl-model";
import { LocalMetrics, measured, type Operation } from "../shared/telemetry";
import { PearlChatManager } from "./pearl-chat-manager";
import { IsolatedPearlBrowser } from "./pearl-browser";
import { PearlChatStore } from "./pearl-chat-store";
import { roomChat, roomResult } from "./pearl-chat-view";
import { PearlSession } from "./pearl-session";
import { cappedPearlModel, liveModelRequestLimit } from "./pearl-test-model";

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
const appIcon = join(__dirname, "branding", "scully.png");
const testingPath = process.env.SCULLY_TEST_DATA;
if (testingPath && !app.isPackaged) app.setPath("userData", testingPath);
const ownsWorkspace = app.requestSingleInstanceLock();
if (!ownsWorkspace) app.quit();

let win: BrowserWindow | null = null;
let chats: PearlChatStore | null = null;
let pearl: PearlChatManager | null = null;

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
    );

    ipcMain.handle("pearl:list", (event) => {
      trusted(event);
      return pearl!.list();
    });
    handle("pearl:create", () => pearl!.create());
    ipcMain.handle("pearl:get", (event, id) => {
      trusted(event);
      return roomChat(pearl!.get(id));
    });
    handle("pearl:send", (_event, id, text) => pearl!.send(id, text));
    handle("pearl:project:choose", async (_event, id) => {
      const result = await dialog.showOpenDialog(win!, {
        title: "Choose a project for Pearl",
        properties: ["openDirectory", "createDirectory"],
      });
      return result.canceled
        ? null
        : pearl!.chooseProject(id, result.filePaths[0]);
    });
    handle("pearl:project:approve", (_event, id, approved) =>
      pearl!.approveProject(id, approved),
    );
    handle("pearl:tool:decide", (_event, id, callId, approved) =>
      pearl!.decideTool(id, callId, approved),
    );
    handle("pearl:question:answer", (_event, id, questionId, answer) =>
      pearl!.answerQuestion(id, questionId, answer),
    );
    handle("pearl:retry", (_event, id) => pearl!.retry(id));
    handle("pearl:stop", (_event, id) => pearl!.stop(id));
    ipcMain.handle("session:info", (event) => {
      trusted(event);
      return settings.info();
    });
    handle("session:configure", (_event, value) => settings.configure(value));
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
  void pearl.closePreviews().finally(() => app.quit());
});
app.on("will-quit", () => {
  settings.close();
  chats?.close();
});
