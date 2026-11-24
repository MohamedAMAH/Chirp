import { contextBridge, ipcRenderer } from "electron";
import type {
  DashboardBridge,
  DashboardState,
  MicrophoneLevel,
} from "../shared/dashboard";

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
  testMicrophone: (enabled) =>
    ipcRenderer.invoke("dashboard-mic-test", enabled),
  setStartAtSignIn: (enabled) =>
    ipcRenderer.invoke("dashboard-startup", enabled),
  copyTranscript: (id) => ipcRenderer.invoke("dashboard-copy-transcript", id),
  onMicrophoneLevel: (listener) => {
    ipcRenderer.on("dashboard-mic-level", (_event, level: MicrophoneLevel) =>
      listener(level),
    );
  },
};
contextBridge.exposeInMainWorld("chirpWindow", dashboard);
