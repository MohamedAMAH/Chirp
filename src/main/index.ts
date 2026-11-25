import { app, dialog, globalShortcut } from "electron";
import path from "node:path";
import { Shell } from "./shell";
import { startDictation } from "./dictation";
import { desktopUnavailable } from "./desktop";
import { isSway, swayAppId } from "./sway";
let shell: Shell;
// Keep the existing settings and activity after renaming the package.
if (!app.commandLine.hasSwitch("user-data-dir")) {
  app.setPath("userData", path.join(app.getPath("appData"), "chirp-dictation"));
}
if (isSway()) {
  app.setDesktopName(swayAppId + ".desktop");
  app.commandLine.appendSwitch("ozone-platform", "wayland");
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.whenReady().then(async () => {
    const unavailable = desktopUnavailable();
    if (unavailable) {
      dialog.showErrorBox("Chirp", unavailable);
      app.quit();
      return;
    }
    shell = new Shell();
    await shell.load();
    startDictation(shell);
  });
  app.on("second-instance", () => shell?.showDashboard());
  app.on("window-all-closed", () => {});
  app.on("will-quit", () => globalShortcut.unregisterAll());
}
