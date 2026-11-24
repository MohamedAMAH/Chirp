import { app, ipcMain, utilityProcess } from "electron";
import path from "node:path";
import { createInterface } from "node:readline";
import { Shell } from "./shell";
import { openDesktopHelper } from "./desktop";

export function startDictation(shell: Shell, helper = openDesktopHelper()) {
  const state = shell.state;
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath();
  let worker: Electron.UtilityProcess | undefined;
  let workerModel: "qwen" | "parakeet" | undefined;
  let retiring = false;
  let connected = false,
    captureStreaming = false,
    loaded = false,
    closing = false;
  let active: number | undefined,
    starting: number | undefined,
    paste: string | undefined,
    attempts = 0;
  const send = (command: string) => {
    if (!closing && helper.stdin.writable) helper.stdin.write(command + "\n");
  };
  function configureDelivery() {
    const { preferences, canAutoEnter } = state.snapshot;
    const copy = preferences.delivery === "copy";
    const submit = canAutoEnter && preferences.autoEnter && !copy;
    send(
      `delivery ${Number(copy)} ${Number(submit)} ${preferences.autoEnterDelay} ${Number(preferences.clipboardHistory)}`,
    );
  }
  function clearSession() {
    if (active !== undefined && captureStreaming && loaded)
      worker?.postMessage({ init: false, id: active, action: "cancel" });
    active = undefined;
    starting = undefined;
    paste = undefined;
    if (!closing) shell.overlay.webContents.send("capture-cancel");
  }
  function reset(message?: string) {
    clearSession();
    if (workerModel !== state.snapshot.model) {
      shell.hide();
      loadModel();
      return;
    }
    if (!connected || !loaded || closing) return;
    send("arm");
    shell.status("Ready");
    if (message) shell.show(message, true);
    else shell.hide();
  }
  function fail(message: string) {
    clearSession();
    if (closing) return;
    shell.hide();
    shell.status(message);
  }
  function loadModel() {
    if (closing || active !== undefined || retiring) return;
    const { model } = state.snapshot;
    if (worker && workerModel === model) return;
    loaded = false;
    send("disarm");
    shell.status("Loading model…");
    if (worker) {
      retiring = true;
      worker.kill();
      return;
    }
    const current = utilityProcess.fork(
      path.join(__dirname, "../speech/worker.js"),
      [],
      { stdio: "ignore" },
    );
    worker = current;
    workerModel = model;
    current.on("message", handleResult);
    current.on("exit", () => {
      worker = undefined;
      loaded = false;
      if (closing) return;
      if (retiring) {
        retiring = false;
        loadModel();
      } else {
        send("disarm");
        fail("Speech engine stopped");
        if (workerModel !== state.snapshot.model) loadModel();
      }
    });
    current.postMessage({ init: true, model, root: path.join(base, "models") });
  }
  const unsubscribe = state.onChange((key) => {
    if (key === "model") loadModel();
    if (key === "streaming" && loaded && connected && active === undefined)
      shell.status("Ready");
    if (
      key === "delivery" ||
      key === "autoEnter" ||
      key === "autoEnterDelay" ||
      key === "clipboardHistory"
    )
      configureDelivery();
  });
  helper.stdin.on("error", () => {});
  helper.on("error", () => {
    connected = false;
    fail("Input helper unavailable");
  });
  helper.on("exit", () => {
    connected = false;
    fail("Input helper stopped");
  });
  createInterface({ input: helper.stdout }).on("line", (line) => {
    if (closing) return;
    const [event, n, x, y] = line.split(" ");
    switch (event) {
      case "quit":
        app.quit();
        break;
      case "indicator-mapped":
        shell.positionSwayIndicator();
        break;
      case "toggle-mode": {
        const streaming = !state.snapshot.preferences.streaming;
        try {
          state.set("streaming", streaming);
        } catch {
          shell.notify("Could not save mode", Number(n), Number(x));
          break;
        }
        shell.notify(
          streaming ? "Mode · Streaming" : "Mode · Whole recording",
          Number(n),
          Number(x),
        );
        break;
      }
      case "toggle-auto-enter": {
        const { preferences, canAutoEnter } = state.snapshot;
        const on = !preferences.autoEnter;
        let notice = "Auto-Enter unavailable";
        if (canAutoEnter && preferences.delivery === "paste") {
          try {
            state.set("autoEnter", on);
            notice = "Auto-Enter " + (on ? "on" : "off");
          } catch {
            notice = "Could not save Auto-Enter";
          }
        }
        shell.notify(notice, Number(n), Number(x));
        break;
      }
      case "shortcut-unavailable":
        shell.notify(n + " unavailable", Number(x), Number(y));
        break;
      case "connected":
        connected = true;
        configureDelivery();
        reset();
        break;
      case "down":
        if (!loaded || !connected || active !== undefined) break;
        active = Number(n);
        starting = active;
        captureStreaming = state.snapshot.preferences.streaming;
        if (captureStreaming)
          worker?.postMessage({ init: false, id: active, action: "start" });
        shell.overlay.webContents.send(
          "capture-start",
          active,
          captureStreaming,
        );
        shell.position(Number(x), Number(y));
        shell.status("Starting microphone");
        shell.show("Starting");
        break;
      case "up":
        if (active === Number(n)) {
          starting = undefined;
          shell.status("Transcribing");
          shell.show("Transcribing");
          shell.overlay.webContents.send("capture-stop", active);
        }
        break;
      case "cancel":
        reset();
        break;
      case "busy": {
        const retry = paste;
        if (retry && attempts++ < 20)
          setTimeout(() => {
            if (retry === paste) send(retry);
          }, 50);
        else reset("Clipboard unavailable");
        break;
      }
      case "copied":
        reset("Copied");
        break;
      case "pasted":
        reset();
        break;
      case "enter-skipped":
        reset("Pasted · Enter skipped");
        break;
      case "clipboard-changed":
        reset("Clipboard changed");
        break;
      case "paste-error":
        reset("Paste failed");
        break;
    }
  });
  ipcMain.on("mic-ready", (event, id: number) => {
    if (
      !closing &&
      event.sender === shell.overlay.webContents &&
      id === starting
    ) {
      starting = undefined;
      shell.status("Listening");
      shell.show("Listening");
    }
  });
  ipcMain.on(
    "audio",
    (event, id: number, samples: Float32Array, chunk = false) => {
      if (
        closing ||
        event.sender !== shell.overlay.webContents ||
        id !== active
      )
        return;
      if (captureStreaming) {
        worker?.postMessage(
          chunk
            ? { init: false, action: "chunk", id, samples }
            : { init: false, action: "finish", id },
        );
        return;
      }
      if (!samples.length) {
        reset("No speech");
        return;
      }
      worker?.postMessage({ init: false, id, samples });
    },
  );
  ipcMain.on("mic-error", (event, id: number) => {
    if (event.sender === shell.overlay.webContents && id === active)
      reset("Microphone unavailable");
  });
  function handleResult(result: {
    ready?: boolean;
    id?: number;
    text?: string;
    failure?: string;
  }) {
    if (closing || retiring) return;
    if (result.ready) {
      loaded = true;
      reset();
      return;
    }
    if (result.failure && result.id === undefined) {
      fail(result.failure);
      return;
    }
    if (result.id === undefined || result.id !== active || !connected) return;
    if (!result.text) {
      reset(result.failure || "No speech");
      return;
    }
    paste =
      "paste " +
      active +
      " " +
      Buffer.from(result.text, "utf8").toString("hex");
    attempts = 0;
    send(paste);
  }
  loadModel();
  app.once("before-quit", () => {
    closing = true;
    unsubscribe();
    helper.stdin.end("quit\n");
    worker?.kill();
  });
}
