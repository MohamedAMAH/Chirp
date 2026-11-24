import { app, clipboard, ipcMain, utilityProcess } from "electron";
import path from "node:path";
import { createInterface } from "node:readline";
import { Shell } from "./shell";
import { openDesktopHelper } from "./desktop";

const tapMs = 220;

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
  let capturedSamples = 0;
  let heldSince = 0;
  let latched = false;
  let stopping = false;
  let timeLimit: ReturnType<typeof setTimeout> | undefined;
  let silenceLimit = 0;
  let recentCopy: ((ok: boolean) => void) | undefined;
  let recentCopyId = 0;
  const send = (command: string) => {
    if (!closing && helper.stdin.writable) helper.stdin.write(command + "\n");
  };
  shell.copyRecentText = async (text) => {
    if (!connected || closing || active !== undefined || recentCopy)
      throw new Error("Wait until Chirp has finished the current dictation.");
    if (process.platform !== "win32") {
      clipboard.writeText(text);
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const id = ++recentCopyId;
      const timeout = setTimeout(() => recentCopy?.(false), 2000);
      recentCopy = (ok) => {
        clearTimeout(timeout);
        recentCopy = undefined;
        if (ok) resolve();
        else reject(new Error("Could not copy the transcript."));
      };
      send(`copy-recent ${id} ${Buffer.from(text, "utf8").toString("hex")}`);
    });
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
    clearTimeout(timeLimit);
    if (active !== undefined && latched) send("finish " + active);
    latched = false;
    stopping = false;
    if (active !== undefined && captureStreaming && loaded)
      worker?.postMessage({ init: false, id: active, action: "cancel" });
    active = undefined;
    starting = undefined;
    paste = undefined;
    if (!closing) shell.overlay.webContents.send("capture-cancel");
  }
  function listening() {
    const status = latched ? "Listening · tap to stop" : "Listening";
    shell.status(status);
    shell.show(status);
  }
  function finish(id: number) {
    if (id !== active || stopping) return;
    stopping = true;
    if (latched) send("finish " + id);
    latched = false;
    clearTimeout(timeLimit);
    starting = undefined;
    shell.status("Transcribing");
    shell.show("Transcribing");
    shell.overlay.webContents.send("capture-stop", id);
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
    recentCopy?.(false);
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
        capturedSamples = 0;
        heldSince = performance.now();
        starting = active;
        captureStreaming = state.snapshot.preferences.streaming;
        if (captureStreaming)
          worker?.postMessage({ init: false, id: active, action: "start" });
        shell.overlay.webContents.send(
          "capture-start",
          active,
          captureStreaming,
          state.snapshot.preferences.microphone,
          state.snapshot.preferences.sounds,
        );
        shell.position(Number(x), Number(y));
        shell.status("Starting microphone");
        shell.show("Starting");
        break;
      case "up":
        if (active === Number(n) && !latched && !stopping) {
          if (performance.now() - heldSince <= tapMs) {
            latched = true;
            const id = active;
            const preferences = state.snapshot.preferences;
            silenceLimit = preferences.stopOnSilence
              ? preferences.silenceSeconds
              : 0;
            send("latch " + id);
            timeLimit = setTimeout(
              () => finish(id),
              preferences.timeLimitMinutes * 60000,
            );
            if (starting === undefined) listening();
          } else finish(active);
        }
        break;
      case "stop":
        if (latched) finish(Number(n));
        break;
      case "cancel":
        if (active === Number(n)) reset();
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
      case "recent-copied":
      case "recent-copy-failed":
        if (Number(n) === recentCopyId) recentCopy?.(event === "recent-copied");
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
      listening();
    }
  });
  ipcMain.on("capture-silence", (event, id: number, seconds: number) => {
    if (
      !closing &&
      latched &&
      silenceLimit > 0 &&
      seconds >= silenceLimit &&
      event.sender === shell.overlay.webContents
    )
      finish(id);
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
      capturedSamples += samples.length;
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
    state.recordDictation(result.text, capturedSamples);
  }
  loadModel();
  app.once("before-quit", () => {
    closing = true;
    clearTimeout(timeLimit);
    recentCopy?.(false);
    unsubscribe();
    helper.stdin.end("quit\n");
    worker?.kill();
  });
}
