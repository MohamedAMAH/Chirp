import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  Tray,
} from "electron";
import path from "node:path";
import { isSway, moveSwayIndicator } from "./sway";
import { ChirpState } from "./preferences";

// tray.png has @1.25x, @1.5x, @2x and @3x companions that Electron picks for
// high-DPI displays. All of them are rendered from assets/chirp.svg.
function icon(name = "tray.png") {
  return nativeImage.createFromPath(
    path.join(app.getAppPath(), "assets", name),
  );
}
export class Shell {
  readonly state = new ChirpState();
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
  // Ctrl+Q quits from any window. On Sway the compositor binds it instead.
  readonly shortcut =
    isSway() || globalShortcut.register("Control+Q", () => app.quit());
  private swayPosition?: { x: number; y: number };
  private hideTimer?: NodeJS.Timeout;
  private noticeId = 0;
  private activeNotice?: number;
  private indicator?: string;
  private dashboard?: BrowserWindow;
  private quitting = false;
  constructor() {
    app.once("before-quit", () => (this.quitting = true));
    this.tray.on("click", () => this.showDashboard());
    this.state.onChange(() => {
      const window = this.dashboard;
      if (window && !window.isDestroyed())
        window.webContents.send("dashboard-change", this.state.snapshot);
    });
    ipcMain.on("dashboard-window", (event, action: string) => {
      const window = this.dashboard;
      if (
        !window ||
        window.isDestroyed() ||
        event.sender !== window.webContents
      )
        return;
      if (action === "minimize") window.minimize();
      else if (action === "toggleMaximize")
        window.isMaximized() ? window.unmaximize() : window.maximize();
      else if (action === "close") window.close();
    });
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
    this.state.setStatus(message);
    const { status, model, preferences } = this.state.snapshot;
    const summary =
      status === "Ready"
        ? `Ready · ${model} · ${preferences.streaming ? "Streaming" : "Whole recording"}`
        : status;
    this.tray.setToolTip("Chirp · " + summary);
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Show", click: () => this.showDashboard() },
        { type: "separator" },
        { label: summary, enabled: false },
        { type: "separator" },
        { label: "Quit", click: () => app.quit() },
      ]),
    );
  }
  showDashboard() {
    const existing = this.dashboard;
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return;
    }
    // A landscape window at 60% of the screen, never smaller than the
    // dashboard needs to show everything without scrolling.
    const area = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint(),
    ).workArea;
    const minWidth = Math.min(960, area.width);
    const minHeight = Math.min(560, area.height);
    const window = new BrowserWindow({
      width: Math.max(minWidth, Math.round(area.width * 0.6)),
      height: Math.max(minHeight, Math.round(area.height * 0.6)),
      minWidth,
      minHeight,
      center: true,
      title: "Chirp",
      icon: icon("icon.png"),
      show: false,
      frame: false,
      autoHideMenuBar: true,
      backgroundColor: "#ebebd8",
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        preload: path.join(__dirname, "../preload/dashboard.js"),
      },
    });
    this.dashboard = window;
    window.webContents.ipc.handle("dashboard-read", () => this.state.snapshot);
    window.webContents.ipc.handle("dashboard-set", (_event, key, value) => {
      if (key === "model" && this.state.snapshot.modelOverride)
        throw new Error("The environment variable selects the current model.");
      this.state.set(key, value);
    });
    window.setMenu(null);
    const reportMaximized = () =>
      window.webContents.send("dashboard-maximized", window.isMaximized());
    window.on("maximize", reportMaximized);
    window.on("unmaximize", reportMaximized);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.once("ready-to-show", () => window.show());
    window.on("close", (event) => {
      if (this.quitting) return;
      event.preventDefault();
      window.hide();
    });
    void window.loadFile(
      path.join(app.getAppPath(), "src/renderer/dashboard.html"),
    );
  }
  position(x: number, y: number) {
    const point =
      process.platform === "win32"
        ? screen.screenToDipPoint({ x, y })
        : { x, y };
    const area = screen.getDisplayNearestPoint(point).workArea;
    const [width] = this.overlay.getSize();
    const left = Math.round(area.x + (area.width - width) / 2);
    const top = area.y + 24;
    if (isSway()) {
      this.swayPosition = { x: left, y: top };
      if (this.overlay.isVisible()) this.positionSwayIndicator();
    } else this.overlay.setPosition(left, top);
  }
  positionSwayIndicator() {
    const point = this.swayPosition;
    if (point) void moveSwayIndicator(point.x, point.y).catch(() => {});
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
    if (isSway()) {
      if (!this.overlay.isVisible()) this.overlay.show();
    } else this.overlay.showInactive();
  }
  hide() {
    clearTimeout(this.hideTimer);
    this.indicator = undefined;
    if (this.activeNotice === undefined) this.overlay.hide();
  }
}
