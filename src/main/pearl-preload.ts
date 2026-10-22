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
  listPearlChats: (scope) => ipcRenderer.invoke("pearl:list", scope),
  createPearlChat: () => ipcRenderer.invoke("pearl:create"),
  getPearlChat: (id) => ipcRenderer.invoke("pearl:get", id),
  archivePearlChat: (id) => ipcRenderer.invoke("pearl:archive", id),
  trashPearlChat: (id) => ipcRenderer.invoke("pearl:trash", id),
  restorePearlChat: (id) => ipcRenderer.invoke("pearl:restore", id),
  deletePearlChatPermanently: (id) =>
    ipcRenderer.invoke("pearl:permanent-delete", id),
  sendPearlMessage: (id, text) => ipcRenderer.invoke("pearl:send", id, text),
  choosePearlProject: (id) => ipcRenderer.invoke("pearl:project:choose", id),
  approvePearlProject: (id, approved) =>
    ipcRenderer.invoke("pearl:project:approve", id, approved),
  decidePearlTool: (id, toolCallId, approved) =>
    ipcRenderer.invoke("pearl:tool:decide", id, toolCallId, approved),
  answerPearlQuestion: (id, questionId, answer) =>
    ipcRenderer.invoke("pearl:question:answer", id, questionId, answer),
  retryPearlChat: (id) => ipcRenderer.invoke("pearl:retry", id),
  stopPearlChat: (id) => ipcRenderer.invoke("pearl:stop", id),
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
