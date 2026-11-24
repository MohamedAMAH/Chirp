import { contextBridge, ipcRenderer } from "electron";
import type { DashboardBridge, DashboardState } from "../shared/dashboard";

const dashboard: DashboardBridge = {
  minimize: () => ipcRenderer.send("dashboard-window", "minimize"),
  toggleMaximize: () => ipcRenderer.send("dashboard-window", "toggleMaximize"),
  close: () => ipcRenderer.send("dashboard-window", "close"),
  onMaximizedChange: (listener: (maximized: boolean) => void) => {
    ipcRenderer.on("dashboard-maximized", (_event, maximized: boolean) =>
      listener(maximized),
    );
  },
  read: () => ipcRenderer.invoke("dashboard-read"),
  onChange: (listener) => {
    ipcRenderer.on("dashboard-change", (_event, state: DashboardState) =>
      listener(state),
    );
  },
  set: (key, value) => ipcRenderer.invoke("dashboard-set", key, value),
};
contextBridge.exposeInMainWorld("chirpWindow", dashboard);
