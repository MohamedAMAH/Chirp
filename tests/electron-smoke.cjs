// Invoke with Electron. Use Chromium's fake microphone and an explicit test WAV.
const { app, ipcMain, utilityProcess } = require("electron");
const path = require("node:path");
const { once } = require("node:events");
const root = path.resolve(__dirname, "..");
const wave = path.join(root, "models/parakeet/test_wavs/en.wav");
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
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
    if (shell.overlay.isFocusable()) throw Error("Overlay can steal focus.");
    shell.show("Listening");
    if (
      (await shell.overlay.webContents.executeJavaScript(
        'document.querySelector("output").textContent',
      )) !== "Listening"
    )
      throw Error("Indicator failed.");
    worker = utilityProcess.fork(path.join(root, "out/speech/worker.js"));
    const ready = once(worker, "message");
    worker.postMessage({
      init: true,
      model: "qwen",
      root: path.join(root, "models"),
    });
    if (!(await ready)[0].ready) throw Error("Model unavailable.");
    ipcMain.once("mic-error", () => end(1, "Microphone pipeline failed."));
    const audio = once(ipcMain, "audio");
    shell.overlay.webContents.send("capture-start", 1);
    await new Promise((r) => setTimeout(r, 6500));
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
    end(
      0,
      "Capture, release and offline recognition passed in " +
        Math.round(performance.now() - released) +
        " ms after release.",
    );
  })
  .catch((error) => end(1, error.message));
