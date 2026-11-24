import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createConnection } from "node:net";
import { promisify } from "node:util";
import { swayAppId, swayIndicatorTitle, swayTarget } from "./sway";

const run = promisify(execFile);
const subscriptions = Buffer.from(
  '["binding","window","workspace","shutdown"]',
);
const header = Buffer.alloc(14);
header.write("i3-ipc");
header.writeUInt32LE(subscriptions.length, 6);
header.writeUInt32LE(2, 10);
const subscription = createConnection(process.env.SWAYSOCK!);
subscription.on("connect", () =>
  subscription.write(Buffer.concat([header, subscriptions])),
);

function emit(message: string) {
  process.stdout.write(message + "\n");
}

let armed = false;
let session = 0;
let focusRevision = 0;
let capture:
  | {
      id: number;
      revision: number;
      target: Awaited<ReturnType<typeof swayTarget>>;
    }
  | undefined;
let held = false;
let latched = false;
let copyOnly = false;
let closed = false;
let pending = Promise.resolve();

function enqueue(operation: () => Promise<void>) {
  pending = pending
    .then(async () => {
      if (!closed) await operation();
    })
    .catch(() => {
      if (!closed) emit("paste-error");
    });
}

function close(code = 0) {
  closed = true;
  subscription.destroy();
  process.exit(code);
}

function copy(text: Buffer) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("wl-copy", ["--type", "text/plain;charset=utf-8"], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    const timeout = setTimeout(() => child.kill(), 1500);
    child.stdin.on("error", reject);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error("Wayland clipboard unavailable"));
    });
    child.stdin.end(text);
  });
}

async function binding(command: string, revision: number) {
  if (command === "nop chirp:quit") {
    emit("quit");
    return;
  }
  if (command === "nop chirp:up") {
    if (held && capture) emit("up " + capture.id);
    held = false;
    return;
  }
  if (command === "nop chirp:down" && latched && capture) {
    latched = false;
    emit("stop " + capture.id);
    return;
  }
  const target = await swayTarget();
  const rect = target?.rect;
  const point = rect
    ? `${Math.round(rect.x + rect.width / 2)} ${Math.round(rect.y + rect.height / 2)}`
    : "0 0";
  if (command === "nop chirp:mode") {
    emit("toggle-mode " + point);
  } else if (command === "nop chirp:auto-enter") {
    emit("toggle-auto-enter " + point);
  } else if (command === "nop chirp:down" && armed && !held) {
    armed = false;
    held = true;
    capture = { id: ++session, revision, target };
    emit(`down ${session} ${point}`);
  }
}

async function paste(id: number, hex: string) {
  const recording = capture;
  if (
    !recording ||
    recording.id !== id ||
    held ||
    !/^(?:[0-9a-f]{2})+$/i.test(hex)
  ) {
    emit("paste-error");
    return;
  }
  capture = undefined;
  const text = Buffer.from(hex, "hex");
  await copy(text);
  const original = recording.target;
  if (
    copyOnly ||
    !original ||
    original.app_id === swayAppId ||
    /[\r\n]/.test(text.toString("utf8")) ||
    (await swayTarget())?.id !== original.id ||
    focusRevision !== recording.revision
  ) {
    emit("copied");
    return;
  }
  const application =
    original.app_id ?? original.window_properties?.class ?? "";
  const terminal = /terminal|xterm|konsole|kitty|alacritty|wezterm|foot/i.test(
    application,
  );
  const keys = terminal
    ? ["-M", "ctrl", "-M", "shift", "-k", "v", "-m", "shift", "-m", "ctrl"]
    : ["-M", "ctrl", "-k", "v", "-m", "ctrl"];
  try {
    await run("wtype", keys, { timeout: 1500 });
    emit("pasted");
  } catch {
    emit("copied");
  }
}

let received = Buffer.alloc(0);
subscription.on("data", (chunk) => {
  try {
    received = Buffer.concat([received, chunk]);
    while (received.length >= 14) {
      const length = received.readUInt32LE(6);
      if (
        length > 4 * 1024 * 1024 ||
        received.toString("ascii", 0, 6) !== "i3-ipc"
      )
        throw new Error("Invalid Sway IPC message");
      if (received.length < length + 14) return;
      const kind = received.readUInt32LE(10);
      const event = JSON.parse(received.toString("utf8", 14, length + 14));
      received = received.subarray(length + 14);
      if (kind === 2) {
        if (event.success !== true)
          throw new Error("Sway subscription rejected");
        emit("connected");
      } else if (
        event.change === "focus" ||
        (event.change === "close" &&
          event.container?.id === capture?.target?.id)
      ) {
        focusRevision++;
      } else if (
        event.change === "new" &&
        event.container?.app_id === swayAppId &&
        event.container?.name === swayIndicatorTitle
      ) {
        emit("indicator-mapped");
      } else if (event.binding?.command?.startsWith("nop chirp:")) {
        const revision = focusRevision;
        enqueue(() => binding(event.binding.command, revision));
      }
    }
  } catch {
    close(1);
  }
});
subscription.on("error", () => close(1));
subscription.on("end", () => close(1));
const commands = createInterface({ input: process.stdin });
commands.on("line", (line) => {
  const [command, id, hex] = line.split(" ");
  if (command === "quit") close();
  else if (command === "arm") armed = true;
  else if (command === "disarm") armed = false;
  else if (
    (command === "latch" || command === "finish") &&
    capture?.id === Number(id)
  )
    latched = command === "latch" && !held;
  else if (command === "delivery") copyOnly = id === "1";
  else if (command === "paste") enqueue(() => paste(Number(id), hex));
});
commands.on("close", () => close());
