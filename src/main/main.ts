import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  net,
  session,
  dialog,
  Notification,
  clipboard,
  shell,
} from "electron";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdirSync } from "node:fs";
import { Store } from "./store";
import { RunManager } from "./run-manager";
import { readSource } from "./source";
import { ExecutionManager } from "./execution-manager";
import { ApplyManager } from "./apply-manager";
import { inspectLocalArtifacts, planTaskArtifactRemoval } from "./artifacts";
import { CloudManager } from "./cloud-manager";
import { boundedClipboardText } from "./clipboard-text";
import { verifyProjectRoot } from "./project-workspace";
import { initializeGit, readGitHistory } from "./git-history";
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
// Scully loads its packaged UI from a local protocol. Avoid Chromium's disk
// HTTP cache for this process; workspace data is stored separately in SQLite.
app.commandLine.appendSwitch("disable-http-cache");
let store: Store;
let runs: RunManager;
let executions: ExecutionManager;
let applications: ApplyManager;
let cloud: CloudManager;
let win: BrowserWindow | null = null;
const appIcon = join(__dirname, "branding", "scully.png");
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
    icon: appIcon,
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
      (_wc, _permission, callback) => callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    mkdirSync(app.getPath("userData"), { recursive: true });
    store = new Store(
      join(app.getPath("userData"), "workspace.sqlite"),
      undefined,
      metrics.record,
    );
    runs = new RunManager(
      store,
      app.getPath("userData"),
      (run) => win?.webContents.send("run:update", run),
      metrics.record,
      () => {
        if (Notification.isSupported())
          new Notification({
            title: "Scully usage alert",
            body: "Open Scully to review this run's usage.",
          }).show();
      },
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
    metricHandle("clipboard:write", (event, value: unknown) => {
      trusted(event);
      clipboard.writeText(boundedClipboardText(value));
    });
    ipcMain.handle("workspace:load", (event) => {
      trusted(event);
      return store.load();
    });
    ipcMain.handle("task:activity", (event, id: unknown) => {
      trusted(event);
      return store.activityForTask(id);
    });
    ipcMain.handle("metrics:read", (event) => {
      trusted(event);
      return metrics.snapshot();
    });
    metricHandle("storage:inspect", (event) => {
      trusted(event);
      const savedRuns = store.runIds();
      return inspectLocalArtifacts(
        app.getPath("userData"),
        2_000,
        savedRuns.ids,
        savedRuns.complete,
      );
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
    metricHandle("reply:route-review", (event, id, messageId) => {
      trusted(event);
      return runs.reviewRoutedReply(id, messageId);
    });
    ipcMain.handle("reply:settings", (event) => {
      trusted(event);
      return store.messageRoutingSettings();
    });
    ipcMain.handle("planning:settings", (event) => {
      trusted(event);
      return store.planningSettings();
    });
    metricHandle("planning:settings:set", (event, value) => {
      trusted(event);
      return store.setPlanningSettings(value);
    });
    metricHandle("reply:settings:set", (event, value) => {
      trusted(event);
      return store.setMessageRoutingSettings(value);
    });
    metricHandle("reply:start", (event, token, approved) => {
      trusted(event);
      return runs.answerMessage(token, approved);
    });
    metricHandle("reply:stop", (event, id) => {
      trusted(event);
      return runs.stopReply(id);
    });
    metricHandle("consult:review", (event, id, specialistId) => {
      trusted(event);
      return runs.reviewConsultation(id, specialistId);
    });
    metricHandle("consult:start", (event, token, approved) => {
      trusted(event);
      return runs.startConsultation(token, approved);
    });
    metricHandle("consult:stop", (event, id) => {
      trusted(event);
      return runs.stopConsultation(id);
    });
    metricHandle("advice:review", (event, id, consultationId, answers) => {
      trusted(event);
      return runs.reviewAdvice(id, consultationId, answers);
    });
    metricHandle("advice:approve", (event, token, approved) => {
      trusted(event);
      return runs.approveAdvice(token, approved);
    });
    metricHandle("advice:remove", (event, id, consultationId) => {
      trusted(event);
      return runs.removeAdvice(id, consultationId);
    });
    metricHandle("task:create", (event, value: unknown) => {
      trusted(event);
      return store.createTask(value);
    });
    ipcMain.handle("conversation:allowance", (event, id) => {
      trusted(event);
      return runs.conversationAllowance(id);
    });
    ipcMain.handle("conversation:review", (event, id) => {
      trusted(event);
      return runs.reviewConversation(id);
    });
    ipcMain.handle("capture:status", (event) => {
      trusted(event);
      return runs.rawCaptureStatus();
    });
    metricHandle("capture:arm", (event) => {
      trusted(event);
      return runs.armRawCapture();
    });
    ipcMain.handle("capture:read", (event) => {
      trusted(event);
      return runs.readRawCapture();
    });
    metricHandle("capture:clear", (event) => {
      trusted(event);
      return runs.clearRawCapture();
    });
    metricHandle("conversation:approve", (event, id, token, approved) => {
      trusted(event);
      return runs.approveConversation(id, token, approved);
    });
    metricHandle(
      "conversation:auto-answer",
      (event, id, messageId, recipientId) => {
        trusted(event);
        return runs.autoAnswerMessage(id, messageId, recipientId);
      },
    );
    metricHandle("task:update", (event, id: unknown, value: unknown) => {
      trusted(event);
      return store.updateTask(id, value);
    });
    metricHandle("task:delete", (event, id: unknown) => {
      trusted(event);
      return store.deleteTask(id);
    });
    ipcMain.handle("task:disposition", (event, id: unknown) => {
      trusted(event);
      return store.taskDisposition(id);
    });
    metricHandle("task:archive", (event, id: unknown) => {
      trusted(event);
      return store.archiveTask(id);
    });
    metricHandle("task:restore", (event, id: unknown) => {
      trusted(event);
      return store.restoreTask(id);
    });
    metricHandle(
      "task:permanent-delete",
      (event, id: unknown, title: unknown) => {
        trusted(event);
        // Validate the task and confirmation before inspecting private files.
        const disposition = store.taskDisposition(id);
        const archived = store.archivedTasks().find((task) => task.id === id);
        if (
          disposition.reason !== "archived" ||
          !archived ||
          title !== archived.title
        )
          throw new Error("Archived task title confirmation does not match");
        const cleanup = planTaskArtifactRemoval(
          app.getPath("userData"),
          store.runs(id),
        );
        const result = store.permanentlyDeleteArchivedTask(id, title);
        return { ...result, privateArtifacts: cleanup() };
      },
    );
    metricHandle("teammate:update", (event, value: unknown) => {
      trusted(event);
      return store.updateTeammate(value);
    });
    metricHandle("teammate:style", (event, style: unknown) => {
      trusted(event);
      return store.applyTeamStyle(style);
    });
    metricHandle("team:save", (event, value: unknown) => {
      trusted(event);
      return store.saveTeam(value);
    });
    metricHandle("team:default", (event, id: unknown) => {
      trusted(event);
      return store.setDefaultTeam(id);
    });
    metricHandle("team:delete", (event, id: unknown) => {
      trusted(event);
      return store.deleteTeam(id);
    });
    metricHandle("team:restore", (event, id: unknown) => {
      trusted(event);
      return store.restoreTeam(id);
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
    metricHandle("run:prepare", (event, taskId, sourceId, paths, mode) => {
      trusted(event);
      return runs.prepare(taskId, sourceId, paths, mode);
    });
    metricHandle("project:choose", async (event, id) => {
      trusted(event);
      const result = await dialog.showOpenDialog(win!, {
        title: "Choose or create the project folder",
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled) return null;
      return runs.chooseProjectWorkspace(id, result.filePaths[0]);
    });
    metricHandle("project:open", async (event, id) => {
      trusted(event);
      const binding = store.getRun(id).projectWorkspace;
      if (!binding) throw new Error("Choose a project folder first");
      verifyProjectRoot(binding);
      const failure = await shell.openPath(binding.path);
      if (failure) throw new Error("Could not open the project folder");
    });
    metricHandle("git:history", (event, id) => {
      trusted(event);
      const binding = store.getRun(id).projectWorkspace;
      if (!binding) return { state: "no-project" };
      verifyProjectRoot(binding);
      return readGitHistory(binding.path);
    });
    metricHandle("git:init", (event, id) => {
      trusted(event);
      const binding = store.getRun(id).projectWorkspace;
      if (!binding) throw new Error("Choose a project folder first");
      verifyProjectRoot(binding);
      return initializeGit(binding.path);
    });
    ipcMain.handle("run:list", (event, taskId) => {
      trusted(event);
      return store.runs(taskId);
    });
    ipcMain.handle("usage:run", (event, id) => {
      trusted(event);
      return store.usageForRun(id);
    });
    ipcMain.handle("usage:alerts", (event, id) => {
      trusted(event);
      return runs.usageAlertsForRun(id);
    });
    ipcMain.handle("usage:cost", (event, id) => {
      trusted(event);
      return runs.costForRun(id);
    });
    metricHandle("usage:cost:configure", (event, id, value) => {
      trusted(event);
      return runs.configureCost(id, value);
    });
    metricHandle("usage:alerts:configure", (event, id, value) => {
      trusted(event);
      return runs.configureUsageAlerts(id, value);
    });
    metricHandle("usage:continue", (event, id, pauseId) => {
      trusted(event);
      return runs.continueUsage(id, pauseId);
    });
    metricHandle("usage:save", (event, id) => {
      trusted(event);
      return runs.saveTokensForRemaining(id);
    });
    metricHandle("usage:review", (event, id, choice) => {
      trusted(event);
      return runs.reviewUsagePolicy(id, choice);
    });
    metricHandle("usage:configure", (event, id, choice, reviewToken) => {
      trusted(event);
      return runs.configureUsagePolicy(id, choice, reviewToken);
    });
    ipcMain.handle("session:info", (event) => {
      trusted(event);
      return runs.session();
    });
    metricHandle("models:roles", (event) => {
      trusted(event);
      return runs.roleModelSettings();
    });
    metricHandle("models:roles:set", (event, value) => {
      trusted(event);
      return runs.setRoleModelSettings(value);
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
    metricHandle("session:models", (event) => {
      trusted(event);
      return runs.listModels();
    });
    metricHandle("run:model", (event, id, model) => {
      trusted(event);
      return runs.selectRunModel(id, model);
    });
    metricHandle("session:model", (event, model) => {
      trusted(event);
      return runs.selectDefaultModel(model);
    });
    metricHandle("room:planning-message", (event, id, text) => {
      trusted(event);
      return runs.sendPlanningMessage(id, text);
    });
    metricHandle("room:planning-retry", (event, id) => {
      trusted(event);
      return runs.retryPlanning(id);
    });
    metricHandle(
      "room:conversation-message",
      (event, id, text, recipientId) => {
        trusted(event);
        return runs.sendConversationMessage(id, text, recipientId);
      },
    );
    metricHandle(
      "room:conversation-answer",
      (event, id, messageId, recipientId) => {
        trusted(event);
        return runs.answerConversationMessage(id, messageId, recipientId);
      },
    );
    metricHandle("run:start", (event, id, approved) => {
      trusted(event);
      return runs.start(id, approved);
    });
    metricHandle("room:build-answer", (event, id, questionId, answer) => {
      trusted(event);
      return runs.answerBuildQuestion(id, questionId, answer);
    });
    metricHandle(
      "lineup:approve",
      (event, id, revision, entries, approved, core) => {
        trusted(event);
        return runs.approveLineup(id, revision, entries, approved, core);
      },
    );
    metricHandle("run:stop", (event, id) => {
      trusted(event);
      return runs.stop(id);
    });
    metricHandle("run:pause", (event, id) => {
      trusted(event);
      return runs.requestRunPause(id);
    });
    metricHandle("run:resume-pause", (event, id, pauseId) => {
      trusted(event);
      return runs.resumeRunPause(id, pauseId);
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
