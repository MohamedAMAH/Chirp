import { app } from "electron";
import { spawn } from "node:child_process";
import path from "node:path";

export function desktopUnavailable() {
  if (process.platform === "win32") return;
  if (process.platform !== "linux")
    return "Chirp supports Windows and Linux X11.";
  if (process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === "wayland")
    return "This Linux build needs an X11 desktop session.";
  if (!process.env.DISPLAY) return "Chirp could not find an X11 display.";
}

export function openDesktopHelper() {
  const binary =
    process.platform === "win32" ? "chirp-input.exe" : "chirp-input";
  const directory = app.isPackaged
    ? process.resourcesPath
    : path.join(app.getAppPath(), "build");
  return spawn(path.join(directory, binary), [], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "ignore"],
  });
}
