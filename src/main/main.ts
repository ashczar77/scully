import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  net,
  session,
  dialog,
} from "electron";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdirSync } from "node:fs";
import { Store } from "./store";
import { RunManager } from "./run-manager";
import { readSource } from "./source";
import { ExecutionManager } from "./execution-manager";
import { ApplyManager } from "./apply-manager";
import { CloudManager } from "./cloud-manager";
import { LocalMetrics, measured, type Operation } from "../shared/telemetry";
const metrics = new LocalMetrics();
function metricHandle(
  channel: Operation,
  listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown,
) {
  ipcMain.handle(channel, (event, ...args) =>
    measured(channel, () => listener(event, ...args), metrics.record),
  );
}
protocol.registerSchemesAsPrivileged([
  {
    scheme: "scully",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
let store: Store;
let runs: RunManager;
let executions: ExecutionManager;
let applications: ApplyManager;
let cloud: CloudManager;
let win: BrowserWindow | null = null;
const testingPath = process.env.SCULLY_TEST_DATA;
if (testingPath && !app.isPackaged) app.setPath("userData", testingPath);
const ownsWorkspace = app.requestSingleInstanceLock();
if (!ownsWorkspace) app.quit();
app.on("second-instance", () => {
  win?.show();
  win?.focus();
});
function window() {
  win = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1000,
    minHeight: 700,
    title: "Scully",
    backgroundColor: "#11171d",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.on("will-attach-webview", (e) => e.preventDefault());
  win.on("closed", () => {
    win = null;
  });
  void win.loadURL("scully://app/index.html");
}
app
  .whenReady()
  .then(() => {
    if (!ownsWorkspace) return;
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
      (_wc, _permission, callback) => callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    mkdirSync(app.getPath("userData"), { recursive: true });
    store = new Store(join(app.getPath("userData"), "workspace.sqlite"));
    runs = new RunManager(
      store,
      app.getPath("userData"),
      (run) => win?.webContents.send("run:update", run),
      metrics.record,
    );
    executions = new ExecutionManager(store, app.getPath("userData"), (run) =>
      win?.webContents.send("run:update", run),
    );
    applications = new ApplyManager(store, app.getPath("userData"), (run) =>
      win?.webContents.send("run:update", run),
    );
    cloud = new CloudManager(
      store,
      (run) => win?.webContents.send("run:update", run),
      metrics.record,
    );
    const trusted = (event: Electron.IpcMainInvokeEvent) => {
      if (
        !win ||
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame ||
        event.senderFrame.url !== "scully://app/index.html"
      )
        throw new Error("Untrusted request");
    };
    ipcMain.handle("workspace:load", (event) => {
      trusted(event);
      return store.load();
    });
    ipcMain.handle("metrics:read", (event) => {
      trusted(event);
      return metrics.snapshot();
    });
    metricHandle("message:send", (event, id, value) => {
      trusted(event);
      return runs.sendTeamMessage(id, value);
    });
    metricHandle("suggestion:review", (event, id, suggestionId) => {
      trusted(event);
      return runs.reviewSuggestion(id, suggestionId);
    });
    metricHandle("reply:review", (event, id, messageId, recipientId) => {
      trusted(event);
      return runs.reviewReply(id, messageId, recipientId);
    });
    metricHandle("reply:start", (event, token, approved) => {
      trusted(event);
      return runs.answerMessage(token, approved);
    });
    metricHandle("reply:stop", (event, id) => {
      trusted(event);
      return runs.stopReply(id);
    });
    metricHandle("task:create", (event, value: unknown) => {
      trusted(event);
      return store.createTask(value);
    });
    ipcMain.handle("teammate:update", (event, value: unknown) => {
      trusted(event);
      return store.updateTeammate(value);
    });
    metricHandle("source:select", async (event) => {
      trusted(event);
      const result = await dialog.showOpenDialog(win!, {
        title: "Select a source folder to preview",
        properties: ["openDirectory"],
      });
      if (result.canceled) return null;
      return runs.select(await readSource(result.filePaths[0]));
    });
    metricHandle("run:prepare", (event, taskId, sourceId, paths) => {
      trusted(event);
      return runs.prepare(taskId, sourceId, paths);
    });
    ipcMain.handle("run:list", (event, taskId) => {
      trusted(event);
      return store.runs(taskId);
    });
    ipcMain.handle("session:info", (event) => {
      trusted(event);
      return runs.session();
    });
    ipcMain.handle("cloud:session", (event) => {
      trusted(event);
      return cloud.session();
    });
    metricHandle("cloud:images", (event, tagPrefix) => {
      trusted(event);
      return cloud.images(tagPrefix);
    });
    metricHandle(
      "cloud:resolve",
      (event, id, commandId, image, parentExecutionId) => {
        trusted(event);
        return cloud.resolveExecutable(id, commandId, image, parentExecutionId);
      },
    );
    metricHandle("cloud:configure", (event, value) => {
      trusted(event);
      return cloud.configure(value);
    });
    metricHandle(
      "cloud:review",
      (event, id, commandId, image, executable, options) => {
        trusted(event);
        return cloud.review(id, commandId, image, executable, options);
      },
    );
    metricHandle("cloud:submit", (event, token, approved) => {
      trusted(event);
      return cloud.submit(token, approved);
    });
    metricHandle("cloud:refresh", (event, runId, executionId) => {
      trusted(event);
      return cloud.refresh(runId, executionId);
    });
    metricHandle("coordination:configure", (event, id, settings) => {
      trusted(event);
      return runs.configureCoordination(id, settings);
    });
    metricHandle("audit:start", (event, id, kind, revision, approved) => {
      trusted(event);
      return runs.startAudit(id, kind, revision, approved);
    });
    metricHandle("finding:decide", (event, id, decision) => {
      trusted(event);
      return runs.decideFinding(id, decision);
    });
    metricHandle(
      "correction:prepare",
      (event, id, auditIndex, findingIndex, revision, key) => {
        trusted(event);
        return runs.prepareCorrection(
          id,
          auditIndex,
          findingIndex,
          revision,
          key,
        );
      },
    );
    metricHandle("session:configure", (event, value) => {
      trusted(event);
      return runs.configure(value);
    });
    metricHandle("run:start", (event, id, approved) => {
      trusted(event);
      return runs.start(id, approved);
    });
    metricHandle("run:stop", (event, id) => {
      trusted(event);
      return runs.stop(id);
    });
    metricHandle(
      "command:decide",
      (event, id, commandId, revision, decision) => {
        trusted(event);
        return runs.decideCommand(id, commandId, revision, decision);
      },
    );
    metricHandle("execution:review", (event, id, commandId) => {
      trusted(event);
      return executions.review(id, commandId);
    });
    metricHandle("execution:start", (event, token, approved) => {
      trusted(event);
      return executions.execute(token, approved);
    });
    metricHandle("execution:stop", (event, id) => {
      trusted(event);
      return executions.stop(id);
    });
    metricHandle("apply:review", async (event, id) => {
      trusted(event);
      const result = await dialog.showOpenDialog(win!, {
        title: "Choose destination for reviewed files",
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled) return null;
      return applications.review(id, result.filePaths[0]);
    });
    metricHandle("apply:write", (event, token, approved) => {
      trusted(event);
      return applications.apply(token, approved);
    });
    metricHandle("apply:inspect", (event, runId, applicationId) => {
      trusted(event);
      return applications.inspectRecovery(runId, applicationId);
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
app.on("will-quit", () => {
  executions?.close();
  runs?.close();
  store?.close();
});
