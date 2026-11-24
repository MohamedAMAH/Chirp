import { contextBridge, ipcRenderer } from "electron";

// The dashboard can only ask its own window to minimize, maximize or close.
contextBridge.exposeInMainWorld("chirpWindow", {
  minimize: () => ipcRenderer.send("dashboard-window", "minimize"),
  toggleMaximize: () => ipcRenderer.send("dashboard-window", "toggleMaximize"),
  close: () => ipcRenderer.send("dashboard-window", "close"),
  onMaximizedChange: (listener: (maximized: boolean) => void) => {
    ipcRenderer.on("dashboard-maximized", (_event, maximized: boolean) =>
      listener(maximized),
    );
  },
});
