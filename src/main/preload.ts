import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAPI } from "../shared/contracts";
const api: DesktopAPI = {
  load: () => ipcRenderer.invoke("workspace:load"),
  createTask: (input) => ipcRenderer.invoke("task:create", input),
  updateTeammate: (input) => ipcRenderer.invoke("teammate:update", input),
};
contextBridge.exposeInMainWorld("scully", api);
