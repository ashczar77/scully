import { contextBridge, ipcRenderer } from "electron";
import type { PearlChat, PearlChatAPI } from "../shared/pearl-chat";
import type { SessionConfig, SessionInfo } from "../shared/runs";
import type { MetricSnapshot } from "../shared/telemetry";

type PearlDesktopAPI = PearlChatAPI & {
  session: () => Promise<SessionInfo>;
  configureSession: (value: SessionConfig) => Promise<SessionInfo>;
  metrics: () => Promise<MetricSnapshot>;
};

const api: PearlDesktopAPI = {
  pearlSandboxConnection: () => ipcRenderer.invoke("pearl:sandbox:connection"),
  configurePearlSandbox: (key, projectId) =>
    ipcRenderer.invoke("pearl:sandbox:configure", key, projectId),
  pearlSandboxImages: () => ipcRenderer.invoke("pearl:sandbox:images"),
  preparePearlSandbox: (id, imageId) =>
    ipcRenderer.invoke("pearl:sandbox:prepare", id, imageId),
  startPearlSandbox: (id) => ipcRenderer.invoke("pearl:sandbox:start", id),
  reconcilePearlSandbox: (id) =>
    ipcRenderer.invoke("pearl:sandbox:reconcile", id),
  forkPearlSandbox: (id, name) =>
    ipcRenderer.invoke("pearl:sandbox:fork", id, name),
  switchPearlSandboxBranch: (id, branchId) =>
    ipcRenderer.invoke("pearl:sandbox:switch", id, branchId),
  leavePearlSandbox: (id) => ipcRenderer.invoke("pearl:sandbox:leave", id),
  reviewPearlSandboxSync: (id) =>
    ipcRenderer.invoke("pearl:sandbox:review-sync", id),
  approvePearlSandboxSync: (id, token) =>
    ipcRenderer.invoke("pearl:sandbox:approve-sync", id, token),
  reviewPearlSandboxFile: (id, path) =>
    ipcRenderer.invoke("pearl:sandbox:file", id, path),
  pearlSandboxSnapshot: (id) =>
    ipcRenderer.invoke("pearl:sandbox:snapshot", id),
  inspectPearlSandboxFile: (id, path) =>
    ipcRenderer.invoke("pearl:sandbox:inspect-file", id, path),
  remoteMcpInfo: () => ipcRenderer.invoke("pearl:mcp:info"),
  connectRemoteMcp: (endpoint, bearerToken) =>
    ipcRenderer.invoke("pearl:mcp:connect", endpoint, bearerToken),
  disconnectRemoteMcp: () => ipcRenderer.invoke("pearl:mcp:disconnect"),
  listPearlModels: () => ipcRenderer.invoke("session:pearl-models"),
  selectPearlModels: (value) =>
    ipcRenderer.invoke("session:pearl-model-choice", value),
  webSearchInfo: () => ipcRenderer.invoke("pearl:web:info"),
  configureWebSearch: (key) => ipcRenderer.invoke("pearl:web:configure", key),
  disconnectWebSearch: () => ipcRenderer.invoke("pearl:web:disconnect"),
  listPearlChats: (scope) => ipcRenderer.invoke("pearl:list", scope),
  createPearlChat: () => ipcRenderer.invoke("pearl:create"),
  getPearlChat: (id) => ipcRenderer.invoke("pearl:get", id),
  archivePearlChat: (id) => ipcRenderer.invoke("pearl:archive", id),
  restorePearlChat: (id) => ipcRenderer.invoke("pearl:restore", id),
  deletePearlChatPermanently: (id) =>
    ipcRenderer.invoke("pearl:permanent-delete", id),
  sendPearlMessage: (id, text) => ipcRenderer.invoke("pearl:send", id, text),
  renamePearlChat: (id, title) => ipcRenderer.invoke("pearl:rename", id, title),
  listPearlProjectFiles: (id, directory, offset) =>
    ipcRenderer.invoke("pearl:workspace:list", id, directory, offset),
  readPearlProjectFile: (id, path) =>
    ipcRenderer.invoke("pearl:workspace:read", id, path),
  pearlGitView: (id) => ipcRenderer.invoke("pearl:git:view", id),
  pearlGitDiff: (id, path, commit) =>
    ipcRenderer.invoke("pearl:git:diff", id, path, commit),
  pearlGitCommitFiles: (id, commit) =>
    ipcRenderer.invoke("pearl:git:commit-files", id, commit),
  reviewPearlTaskFile: (id, turnId, path) =>
    ipcRenderer.invoke("pearl:task:file", id, turnId, path),
  undoPearlTask: (id, turnId) =>
    ipcRenderer.invoke("pearl:task:undo", id, turnId),
  choosePearlProject: (id) => ipcRenderer.invoke("pearl:project:choose", id),
  approvePearlProject: (id, approved) =>
    ipcRenderer.invoke("pearl:project:approve", id, approved),
  decidePearlTool: (id, toolCallId, approved) =>
    ipcRenderer.invoke("pearl:tool:decide", id, toolCallId, approved),
  answerPearlQuestion: (id, questionId, answer) =>
    ipcRenderer.invoke("pearl:question:answer", id, questionId, answer),
  retryPearlChat: (id) => ipcRenderer.invoke("pearl:retry", id),
  stopPearlChat: (id) => ipcRenderer.invoke("pearl:stop", id),
  sendPearlTerminalInput: (id, terminalId, value) =>
    ipcRenderer.invoke("pearl:terminal:input", id, terminalId, value),
  resizePearlTerminal: (id, terminalId, cols, rows) =>
    ipcRenderer.invoke("pearl:terminal:resize", id, terminalId, cols, rows),
  stopPearlTerminal: (id, terminalId) =>
    ipcRenderer.invoke("pearl:terminal:stop", id, terminalId),
  onPearlChatUpdate: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, chat: PearlChat) =>
      listener(chat);
    ipcRenderer.on("pearl:update", handler);
    return () => ipcRenderer.removeListener("pearl:update", handler);
  },
  session: () => ipcRenderer.invoke("session:info"),
  configureSession: (value) => ipcRenderer.invoke("session:configure", value),
  metrics: () => ipcRenderer.invoke("metrics:read"),
};

contextBridge.exposeInMainWorld("scully", api);
