import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAPI } from "../shared/contracts";
const api: DesktopAPI = {
  inspectLocalArtifacts: () => ipcRenderer.invoke("storage:inspect"),
  cloudImages: (tagPrefix) => ipcRenderer.invoke("cloud:images", tagPrefix),
  resolveCloudExecutable: (id, commandId, image, parentExecutionId) =>
    ipcRenderer.invoke(
      "cloud:resolve",
      id,
      commandId,
      image,
      parentExecutionId,
    ),
  cloudSession: () => ipcRenderer.invoke("cloud:session"),
  configureCloud: (value) => ipcRenderer.invoke("cloud:configure", value),
  reviewCloud: (id, commandId, image, executable, options) =>
    ipcRenderer.invoke(
      "cloud:review",
      id,
      commandId,
      image,
      executable,
      options,
    ),
  submitCloud: (token, approved) =>
    ipcRenderer.invoke("cloud:submit", token, approved),
  refreshCloud: (runId, executionId) =>
    ipcRenderer.invoke("cloud:refresh", runId, executionId),
  sendTeamMessage: (id, value) => ipcRenderer.invoke("message:send", id, value),
  stopReply: (id) => ipcRenderer.invoke("reply:stop", id),
  reviewSuggestion: (id, suggestionId) =>
    ipcRenderer.invoke("suggestion:review", id, suggestionId),
  reviewReply: (id, messageId, recipientId) =>
    ipcRenderer.invoke("reply:review", id, messageId, recipientId),
  answerMessage: (token, approved) =>
    ipcRenderer.invoke("reply:start", token, approved),
  metrics: () => ipcRenderer.invoke("metrics:read"),
  prepareCorrection: (id, auditIndex, findingIndex, revision, key) =>
    ipcRenderer.invoke(
      "correction:prepare",
      id,
      auditIndex,
      findingIndex,
      revision,
      key,
    ),
  decideFinding: (id, decision) =>
    ipcRenderer.invoke("finding:decide", id, decision),
  startAudit: (id, kind, revision, approved) =>
    ipcRenderer.invoke("audit:start", id, kind, revision, approved),
  load: () => ipcRenderer.invoke("workspace:load"),
  createTask: (input) => ipcRenderer.invoke("task:create", input),
  updateTask: (id, input) => ipcRenderer.invoke("task:update", id, input),
  deleteTask: (id) => ipcRenderer.invoke("task:delete", id),
  updateTeammate: (input) => ipcRenderer.invoke("teammate:update", input),
  applyTeamStyle: (style) => ipcRenderer.invoke("teammate:style", style),
  saveTeam: (input) => ipcRenderer.invoke("team:save", input),
  setDefaultTeam: (id) => ipcRenderer.invoke("team:default", id),
  deleteTeam: (id) => ipcRenderer.invoke("team:delete", id),
  restoreTeam: (id) => ipcRenderer.invoke("team:restore", id),
  selectSource: () => ipcRenderer.invoke("source:select"),
  prepareRun: (taskId, sourceId, paths) =>
    ipcRenderer.invoke("run:prepare", taskId, sourceId, paths),
  runs: (taskId) => ipcRenderer.invoke("run:list", taskId),
  usageForRun: (id) => ipcRenderer.invoke("usage:run", id),
  usageAlertsForRun: (id) => ipcRenderer.invoke("usage:alerts", id),
  costForRun: (id) => ipcRenderer.invoke("usage:cost", id),
  configureCost: (id, value) =>
    ipcRenderer.invoke("usage:cost:configure", id, value),
  configureUsageAlerts: (id, value) =>
    ipcRenderer.invoke("usage:alerts:configure", id, value),
  continueUsage: (id, pauseId) =>
    ipcRenderer.invoke("usage:continue", id, pauseId),
  saveTokensForRemaining: (id) => ipcRenderer.invoke("usage:save", id),
  session: () => ipcRenderer.invoke("session:info"),
  configureCoordination: (id, settings) =>
    ipcRenderer.invoke("coordination:configure", id, settings),
  configureSession: (value) => ipcRenderer.invoke("session:configure", value),
  reviewUsagePolicy: (id, choice) =>
    ipcRenderer.invoke("usage:review", id, choice),
  configureUsagePolicy: (id, choice, reviewToken) =>
    ipcRenderer.invoke("usage:configure", id, choice, reviewToken),
  startRun: (id, approved) => ipcRenderer.invoke("run:start", id, approved),
  stopRun: (id) => ipcRenderer.invoke("run:stop", id),
  reviewApply: (id) => ipcRenderer.invoke("apply:review", id),
  applyDraft: (token, approved) =>
    ipcRenderer.invoke("apply:write", token, approved),
  inspectApplyRecovery: (runId, applicationId) =>
    ipcRenderer.invoke("apply:inspect", runId, applicationId),
  reviewExecution: (id, commandId) =>
    ipcRenderer.invoke("execution:review", id, commandId),
  executeCommand: (token, approved) =>
    ipcRenderer.invoke("execution:start", token, approved),
  stopExecution: (id) => ipcRenderer.invoke("execution:stop", id),
  decideCommand: (id, commandId, revision, decision) =>
    ipcRenderer.invoke("command:decide", id, commandId, revision, decision),
  onRun: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      run: import("../shared/runs").Run,
    ) => callback(run);
    ipcRenderer.on("run:update", listener);
    return () => ipcRenderer.removeListener("run:update", listener);
  },
};
contextBridge.exposeInMainWorld("scully", api);
