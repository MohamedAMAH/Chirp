// Run on an interactive Windows desktop. The test helper verifies the recipient HWND.
const { app, BrowserWindow, clipboard } = require("electron");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
app.setAppPath(root);
app.setPath("userData", path.join(root, "build/paste-smoke-profile"));
for (const key of [
  "use-fake-device-for-media-stream",
  "use-fake-ui-for-media-stream",
])
  app.commandLine.appendSwitch(key);
app.commandLine.appendSwitch(
  "use-file-for-fake-audio-capture",
  path.join(root, "models/parakeet/test_wavs/en.wav"),
);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let helper, timeout;
function finish(code, reason) {
  console.log(reason);
  clearTimeout(timeout);
  helper?.stdin.end("quit\n");
  app.exit(code);
}
app
  .whenReady()
  .then(async () => {
    timeout = setTimeout(
      () => finish(1, "Timed out waiting for paste."),
      60000,
    );
    const editor = new BrowserWindow({
      width: 480,
      height: 160,
      title: "Chirp paste verification",
    });
    await editor.loadURL(
      "data:text/html,<title>Chirp paste verification</title><textarea autofocus></textarea>",
    );
    const { Shell } = require("../out/main/shell");
    const shell = new Shell();
    await shell.load();
    helper = spawn(path.join(root, "build/chirp-input-test.exe"), [], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
    });
    const lines = createInterface({ input: helper.stdout });
    const armed = new Promise((resolve) =>
      lines.on("line", (line) => {
        if (line.startsWith("test-")) console.log(line);
        if (line === "armed") resolve();
        if (line === "test-focus-error")
          finish(1, "Test editor did not have focus.");
      }),
    );
    require("../out/main/dictation").startDictation(shell, helper);
    await armed;
    editor.show();
    editor.focus();
    await editor.webContents.executeJavaScript(
      'document.querySelector("textarea").focus()',
    );
    await wait(200);
    const prior = await clipboard.readText();
    const hwnd = editor.getNativeWindowHandle().readBigUInt64LE();
    helper.stdin.write("test-hold " + hwnd + "\n");
    await wait(6500);
    if (process.env.CHIRP_ASR_MODEL === "parakeet-streaming") {
      const listening = await shell.overlay.webContents.executeJavaScript(
        'document.querySelector("main").dataset.state === "listening" && document.querySelector("output").textContent === "Listening"',
      );
      const untouched = await editor.webContents.executeJavaScript(
        'document.querySelector("textarea").value === ""',
      );
      if (!listening || !untouched)
        throw Error(
          "Expected the listening indicator and an empty target before release.",
        );
      console.log("Only the listening indicator appeared before release.");
    }
    const edge = performance.now();
    helper.stdin.write("test-release\n");
    let text = "";
    while (!text) {
      await wait(30);
      text = await editor.webContents.executeJavaScript(
        'document.querySelector("textarea").value',
      );
    }
    const latency = Math.round(performance.now() - edge);
    await wait(550);
    if ((await clipboard.readText()) !== prior)
      throw Error("The previous clipboard text was not restored.");
    function reply(command, expected) {
      return new Promise((resolve, reject) => {
        const listener = (value) => {
          if (value !== expected && !value.startsWith("test-")) return;
          lines.off("line", listener);
          if (value === expected) resolve();
          else reject(Error(value));
        };
        lines.on("line", listener);
        if (command) helper.stdin.write(command + "\n");
      });
    }
    await reply("test-backup", "backup");
    const other = new BrowserWindow({ show: false, width: 260, height: 120 });
    try {
      helper.stdin.write("test-hold " + hwnd + "\n");
      await wait(2500);
      other.show();
      other.focus();
      await wait(200);
      editor.focus();
      await wait(200);
      await reply("test-release", "copied");
      if (!(await clipboard.readText()).trim())
        throw Error("Fallback transcript is empty.");
      await reply("test-private", "private");
      if (
        (await editor.webContents.executeJavaScript(
          'document.querySelector("textarea").value',
        )) !== text
      )
        throw Error("Focus-switch transcript was pasted.");
    } finally {
      await reply("test-restore", "restored");
      other.destroy();
    }
    console.log(
      "Focus-away-and-back fallback and clipboard privacy marker passed.",
    );
    finish(
      0,
      "Paste into the browser editor and clipboard restoration passed. Release to paste: " +
        latency +
        " ms.",
    );
  })
  .catch((error) => finish(1, error.message));
