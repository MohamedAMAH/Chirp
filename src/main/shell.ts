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
    height: 48,
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
  private noticeId = 0;
  private activeNotice?: number;
  private indicator?: string;
  constructor() {
    this.overlay.setIgnoreMouseEvents(true);
    this.overlay.webContents.ipc.on("notice-finished", (_event, id: number) => {
      if (id !== this.activeNotice) return;
      this.activeNotice = undefined;
      if (this.indicator) this.display(this.indicator);
      else this.overlay.hide();
    });
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
    const point =
      process.platform === "win32"
        ? screen.screenToDipPoint({ x, y })
        : { x, y };
    const area = screen.getDisplayNearestPoint(point).workArea;
    const [width] = this.overlay.getSize();
    this.overlay.setPosition(
      Math.round(area.x + (area.width - width) / 2),
      area.y + 24,
    );
  }
  show(text: string, brief = false) {
    clearTimeout(this.hideTimer);
    this.indicator = text;
    if (this.activeNotice === undefined) this.display(text);
    if (brief) this.hideTimer = setTimeout(() => this.hide(), 1600);
  }
  notify(text: string, x: number, y: number) {
    this.position(x, y);
    this.activeNotice = ++this.noticeId;
    this.display(text, this.activeNotice);
  }
  private display(text: string, noticeId?: number) {
    this.overlay.webContents.send("indicator", text, noticeId);
    this.overlay.showInactive();
  }
  hide() {
    clearTimeout(this.hideTimer);
    this.indicator = undefined;
    if (this.activeNotice === undefined) this.overlay.hide();
  }
}
