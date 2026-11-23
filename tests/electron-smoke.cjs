// Invoke with Electron. Use Chromium's fake microphone and an explicit test WAV.
const { app, ipcMain, utilityProcess } = require("electron");
const path = require("node:path");
const { once } = require("node:events");
const root = path.resolve(__dirname, "..");
const wave = path.join(root, "models/parakeet/test_wavs/en.wav");
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch("use-file-for-fake-audio-capture", wave);
app.setPath("userData", path.join(root, "build/smoke-profile"));
app.setAppPath(root);
let worker;
let deadline = setTimeout(() => end(1, "Smoke test timed out."), 70000);
function end(code, message) {
  clearTimeout(deadline);
  console.log(message);
  worker?.kill();
  app.exit(code);
}
app
  .whenReady()
  .then(async () => {
    const { Shell } = require("../out/main/shell");
    const shell = new Shell();
    await shell.load();
    const session = shell.overlay.webContents.session;
    session.setPermissionRequestHandler((_contents, permission, callback) =>
      callback(permission === "media"),
    );
    if (shell.overlay.isFocusable()) throw Error("Overlay can steal focus.");
    for (const [label, symbol] of [
      ["Transcribing", ".dots"],
      ["Copied", ".check"],
      ["Microphone unavailable", ".notice"],
      ["Listening", ".wave"],
    ]) {
      shell.show(label);
      const shown = await shell.overlay.webContents.executeJavaScript(`(() => {
        const text = document.querySelector("output");
        const bounds = text.getBoundingClientRect();
        return text.textContent === ${JSON.stringify(label)}
          && bounds.right <= innerWidth && bounds.left >= 0
          && document.querySelector(${JSON.stringify(symbol)}).getBoundingClientRect().width > 0;
      })()`);
      if (!shown) throw Error("Indicator state failed: " + label);
    }
    worker = utilityProcess.fork(path.join(root, "out/speech/worker.js"));
    const ready = once(worker, "message");
    worker.postMessage({
      init: true,
      model: "qwen",
      root: path.join(root, "models"),
    });
    if (!(await ready)[0].ready) throw Error("Model unavailable.");
    const unexpectedMicError = () => end(1, "Microphone pipeline failed.");
    ipcMain.once("mic-error", unexpectedMicError);
    const audio = once(ipcMain, "audio");
    shell.overlay.webContents.send("capture-start", 1);
    await new Promise((r) => setTimeout(r, 6500));
    if (
      !(await shell.overlay.webContents.executeJavaScript(
        '[...document.querySelectorAll(".wave i")].every(bar => bar.style.getPropertyValue("--level") !== "")',
      ))
    )
      throw Error("The microphone did not drive the listening meter.");
    const released = performance.now();
    shell.overlay.webContents.send("capture-stop", 1);
    const [, id, samples] = await audio;
    if (
      id !== 1 ||
      samples.length < 16000 ||
      !samples.some((x) => Math.abs(x) > 0.01)
    )
      throw Error("Missing microphone samples.");
    const result = once(worker, "message");
    worker.postMessage({ init: false, id, samples });
    const [reply] = await result;
    if (!reply.text) throw Error("Empty transcript.");
    const elapsed = Math.round(performance.now() - released);
    ipcMain.removeListener("mic-error", unexpectedMicError);
    session.setPermissionCheckHandler(() => false);
    session.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    const denial = once(ipcMain, "mic-error");
    shell.overlay.webContents.send("capture-start", 2);
    if ((await denial)[1] !== 2) throw Error("Missing microphone denial.");
    end(
      0,
      "Capture, offline recognition and denied microphone access passed. " +
        elapsed +
        " ms from release to recognition.",
    );
  })
  .catch((error) => end(1, error.message));
