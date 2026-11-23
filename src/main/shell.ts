import {
  app,
  BrowserWindow,
  globalShortcut,
  Menu,
  nativeImage,
  screen,
  Tray,
} from "electron";
import path from "node:path";

function icon() {
  return nativeImage.createFromPath(
    path.join(app.getAppPath(), "assets/tray.png"),
  );
}
export class Shell {
  readonly tray = new Tray(icon());
  readonly overlay = new BrowserWindow({
    width: 220,
    height: 40,
    show: false,
    focusable: false,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
      preload: path.join(__dirname, "../preload/index.js"),
    },
  });
  private readonly shortcut = globalShortcut.register("Control+Q", () =>
    app.quit(),
  );
  private hideTimer?: NodeJS.Timeout;
  constructor() {
    this.overlay.setIgnoreMouseEvents(true);
    this.status("Loading");
    this.overlay.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.overlay.webContents.on("will-navigate", (event) =>
      event.preventDefault(),
    );
  }
  load() {
    return this.overlay.loadFile(
      path.join(app.getAppPath(), "src/renderer/overlay.html"),
    );
  }
  status(message: string) {
    this.tray.setToolTip("Chirp · " + message);
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: message, enabled: false },
        {
          label: this.shortcut
            ? "Hold Right Alt to dictate"
            : "Ctrl+Q is unavailable",
          enabled: false,
        },
        { type: "separator" },
        { label: "Quit Chirp", click: () => app.quit() },
      ]),
    );
  }
  position(x: number, y: number) {
    const area = screen.getDisplayNearestPoint(
      screen.screenToDipPoint({ x, y }),
    ).workArea;
    const [width] = this.overlay.getSize();
    this.overlay.setPosition(
      Math.round(area.x + (area.width - width) / 2),
      area.y + 24,
    );
  }
  show(text: string, brief = false) {
    clearTimeout(this.hideTimer);
    this.overlay.webContents.send("indicator", text);
    this.overlay.showInactive();
    if (brief) this.hideTimer = setTimeout(() => this.hide(), 1600);
  }
  hide() {
    clearTimeout(this.hideTimer);
    this.overlay.hide();
  }
}
