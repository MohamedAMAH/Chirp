import { app } from "electron";
import { spawn } from "node:child_process";
import path from "node:path";
import { isSway, openSwayHelper } from "./sway";

export function desktopUnavailable() {
  if (process.platform === "win32") return;
  if (process.platform !== "linux")
    return "Chirp supports Windows, Linux X11, and Sway.";
  if (isSway()) return;
  if (process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === "wayland")
    return "This Wayland build supports Sway.";
  if (!process.env.DISPLAY) return "Chirp could not find an X11 display.";
}

export function openDesktopHelper() {
  if (isSway()) return openSwayHelper();
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
