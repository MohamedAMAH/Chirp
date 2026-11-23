import { app, ipcMain, utilityProcess } from "electron";
import path from "node:path";
import { createInterface } from "node:readline";
import { Shell } from "./shell";
import { openDesktopHelper } from "./desktop";

export function startDictation(shell: Shell, helper = openDesktopHelper()) {
  const model = process.env.CHIRP_ASR_MODEL ?? "qwen";
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath();
  const worker = utilityProcess.fork(
    path.join(__dirname, "../speech/worker.js"),
    [],
    { stdio: "ignore" },
  );
  let connected = false,
    streaming = model === "parakeet-streaming",
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
  function clearSession() {
    if (active !== undefined && captureStreaming && loaded)
      worker.postMessage({ init: false, id: active, action: "cancel" });
    active = undefined;
    starting = undefined;
    paste = undefined;
    if (!closing) shell.overlay.webContents.send("capture-cancel");
  }
  function reset(message?: string) {
    clearSession();
    if (!connected || !loaded || closing) return;
    send("arm");
    updateReadyStatus();
    if (message) shell.show(message, true);
    else shell.hide();
  }
  function updateReadyStatus() {
    shell.status(
      "Ready · " +
        model.replace(/-streaming$/, "") +
        " · " +
        (streaming ? "Streaming" : "Whole recording"),
    );
  }
  function fail(message: string) {
    clearSession();
    if (closing) return;
    shell.hide();
    shell.status(message);
  }
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
      case "toggle-mode":
        streaming = !streaming;
        shell.notify(
          streaming ? "Mode · Streaming" : "Mode · Whole recording",
          Number(n),
          Number(x),
        );
        if (loaded && connected) updateReadyStatus();
        break;
      case "auto-enter":
        shell.notify("Auto-Enter " + n, Number(x), Number(y));
        break;
      case "shortcut-unavailable":
        shell.notify(n + " unavailable", Number(x), Number(y));
        break;
      case "connected":
        connected = true;
        reset();
        break;
      case "down":
        active = Number(n);
        starting = active;
        captureStreaming = streaming;
        if (captureStreaming)
          worker.postMessage({ init: false, id: active, action: "start" });
        shell.overlay.webContents.send(
          "capture-start",
          active,
          captureStreaming,
        );
        shell.position(Number(x), Number(y));
        shell.show("Starting");
        break;
      case "up":
        if (active === Number(n)) {
          starting = undefined;
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
        worker.postMessage(
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
      worker.postMessage({ init: false, id, samples });
    },
  );
  ipcMain.on("mic-error", (event, id: number) => {
    if (event.sender === shell.overlay.webContents && id === active)
      reset("Microphone unavailable");
  });
  worker.on("message", (result) => {
    if (closing) return;
    if (result.ready) {
      loaded = true;
      reset();
      return;
    }
    if (result.failure && result.id === undefined) {
      fail(result.failure);
      return;
    }
    if (result.id !== active || !connected) return;
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
  });
  worker.on("exit", () => {
    loaded = false;
    fail("Speech engine stopped");
  });
  worker.postMessage({ init: true, model, root: path.join(base, "models") });
  app.once("before-quit", () => {
    closing = true;
    helper.stdin.end("quit\n");
    worker.kill();
  });
}
