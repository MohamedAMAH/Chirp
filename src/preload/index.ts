import { ipcRenderer } from "electron";
interface Recording {
  id: number;
  chunks: Float32Array[];
  streaming: boolean;
  sounds: boolean;
  quietSamples: number;
  stream?: MediaStream;
  source?: MediaStreamAudioSourceNode;
  input?: AudioWorkletNode;
  closing?: ReturnType<typeof setTimeout>;
}
let recording: Recording | undefined;
let audioContext: Promise<AudioContext> | undefined;
let standby:
  | Promise<{ ctx: AudioContext; input: AudioWorkletNode }>
  | undefined;
let meterBars: NodeListOf<HTMLElement>;
let preview:
  | {
      stream?: MediaStream;
      timer?: ReturnType<typeof setInterval>;
      source?: MediaStreamAudioSourceNode;
    }
  | undefined;
let deviceRequest = 0;

async function publishDevices() {
  const request = ++deviceRequest;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    if (request !== deviceRequest) return;
    const microphones = devices
      .filter(
        ({ kind, deviceId }) =>
          kind === "audioinput" && deviceId && deviceId !== "default",
      )
      .map(({ deviceId, label }, index) => ({
        id: deviceId,
        label: label || `Microphone ${index + 1}`,
      }));
    ipcRenderer.send("mic-devices", microphones);
  } catch {
    if (request === deviceRequest) ipcRenderer.send("mic-devices", []);
  }
}

async function openMicrophone(microphone: string, fallback: boolean) {
  const audio: MediaTrackConstraints = { channelCount: 1 };
  if (microphone !== "default") audio.deviceId = { exact: microphone };
  try {
    return await navigator.mediaDevices.getUserMedia({ audio, video: false });
  } catch (error) {
    if (
      !fallback ||
      !audio.deviceId ||
      !(error instanceof DOMException) ||
      !["NotFoundError", "OverconstrainedError"].includes(error.name)
    )
      throw error;
    return navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1 },
      video: false,
    });
  }
}

function sendLevel(level: number, testing: boolean, error?: string) {
  ipcRenderer.send("mic-level", { level, testing, error });
}

function stopPreview() {
  if (!preview) return;
  clearInterval(preview.timer);
  preview.source?.disconnect();
  preview.stream?.getTracks().forEach((track) => track.stop());
  preview = undefined;
  sendLevel(0, false);
}

ipcRenderer.on("mic-refresh", () => void publishDevices());
ipcRenderer.on(
  "mic-test",
  async (_event, enabled: boolean, device = "default") => {
    stopPreview();
    if (!enabled) return;
    if (recording) {
      sendLevel(0, false, "Finish dictating before testing the microphone.");
      return;
    }
    const check: NonNullable<typeof preview> = {};
    preview = check;
    sendLevel(0, true);
    try {
      const stream = await openMicrophone(device, false);
      if (preview !== check) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      check.stream = stream;
      const context = await prepareAudio();
      if (context.state === "suspended") await context.resume();
      if (preview !== check) return;
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      check.source = context.createMediaStreamSource(stream);
      check.source.connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);
      check.timer = setInterval(() => {
        analyser.getFloatTimeDomainData(buffer);
        sendLevel(levelOf(buffer), true);
      }, 80);
      setTimeout(() => {
        if (preview === check) stopPreview();
      }, 10000);
      void publishDevices();
    } catch {
      if (preview !== check) return;
      stopPreview();
      sendLevel(0, false, "This microphone could not be opened.");
    }
  },
);

function levelOf(samples: Float32Array) {
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  return Math.min(1, Math.sqrt(energy / Math.max(1, samples.length)) * 6);
}
function prepareAudio() {
  if (!audioContext) {
    const context = new AudioContext({
      sampleRate: 16000,
      latencyHint: "interactive",
    });
    audioContext = context.audioWorklet
      .addModule("../../out/renderer/processor.js")
      .then(() => context)
      .catch((error) => {
        audioContext = undefined;
        void context.close();
        throw error;
      });
  }
  return audioContext;
}
function prepareInput() {
  if (!standby) {
    const pending = prepareAudio().then((ctx) => ({
      ctx,
      input: new AudioWorkletNode(ctx, "chirp-capture", { numberOfOutputs: 0 }),
    }));
    standby = pending;
    void pending.catch(() => {
      if (standby === pending) standby = undefined;
    });
  }
  return standby;
}
async function playCue(frequency: number) {
  try {
    const ctx = await prepareAudio();
    if (ctx.state === "suspended") await ctx.resume();
    const tone = ctx.createOscillator();
    const volume = ctx.createGain();
    const start = ctx.currentTime;
    tone.frequency.value = frequency;
    volume.gain.setValueAtTime(0, start);
    volume.gain.linearRampToValueAtTime(0.055, start + 0.005);
    volume.gain.exponentialRampToValueAtTime(0.001, start + 0.045);
    tone.connect(volume).connect(ctx.destination);
    tone.onended = () => volume.disconnect();
    tone.start(start);
    tone.stop(start + 0.05);
  } catch {
    // Capturing dictation does not depend on audio output.
  }
}

function updateMeter(samples: Float32Array) {
  // Each bar shows a successive slice of the most recent microphone buffer.
  const width = samples.length / meterBars.length;
  meterBars.forEach((bar, index) => {
    const start = Math.floor(index * width);
    const end = Math.floor((index + 1) * width);
    let energy = 0;
    for (let i = start; i < end; i++) energy += samples[i] * samples[i];
    const rms = Math.sqrt(energy / Math.max(1, end - start));
    bar.style.setProperty(
      "--level",
      String(Math.min(1, 0.32 + 4 * Math.sqrt(rms))),
    );
  });
}
function close(r: Recording) {
  clearTimeout(r.closing);
  r.stream?.getTracks().forEach((track) => track.stop());
  r.source?.disconnect();
  r.input?.port.postMessage("cancel");
  r.input?.disconnect();
  r.input?.port.close();
  if (recording === r) recording = undefined;
  sendLevel(0, false);
  prepareInput();
}
function finish(r: Recording) {
  if (recording !== r) return;
  const audio = new Float32Array(r.chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of r.chunks) {
    audio.set(chunk, offset);
    offset += chunk.length;
  }
  close(r);
  ipcRenderer.send("audio", r.id, audio);
}
ipcRenderer.on(
  "capture-start",
  async (
    _event,
    id: number,
    streaming = false,
    microphone = "default",
    sounds = false,
  ) => {
    stopPreview();
    if (recording) close(recording);
    const r: Recording = { id, chunks: [], streaming, sounds, quietSamples: 0 };
    recording = r;
    if (sounds) void playCue(640);
    try {
      const device = openMicrophone(microphone, true).then((stream) => {
        if (recording !== r) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        r.stream = stream;
        void publishDevices();
        return stream;
      });
      const prepared = prepareInput();
      standby = undefined;
      const graph = prepared.then(async ({ ctx, input }) => {
        if (recording !== r) {
          input.port.postMessage("cancel");
          input.port.close();
          input.disconnect();
          return ctx;
        }
        r.input = input;
        if (ctx.state === "suspended") await ctx.resume();
        return ctx;
      });
      const [stream, ctx] = await Promise.all([device, graph]);
      if (!stream || recording !== r || !r.input) return;
      const input = r.input;
      input.port.onmessage = ({ data }) => {
        if (recording !== r) return;
        if (data === "started") ipcRenderer.send("mic-ready", id);
        else if (data === "end") finish(r);
        else {
          if (r.streaming) ipcRenderer.send("audio", r.id, data, true);
          else r.chunks.push(data);
          updateMeter(data);
          const level = levelOf(data);
          sendLevel(level, false);
          r.quietSamples = level < 0.06 ? r.quietSamples + data.length : 0;
          if (r.quietSamples >= 16000)
            ipcRenderer.send("capture-silence", r.id, r.quietSamples / 16000);
        }
      };
      r.source = ctx.createMediaStreamSource(stream);
      r.source.connect(input);
    } catch {
      if (recording === r) {
        close(r);
        ipcRenderer.send("mic-error", id);
      }
    }
  },
);
ipcRenderer.on("capture-stop", (_event, id: number) => {
  const r = recording;
  if (!r || r.id !== id) return;
  if (!r.source || !r.input) {
    finish(r);
    return;
  }
  r.input.port.postMessage("end");
  r.stream?.getTracks().forEach((track) => track.stop());
  if (r.sounds) void playCue(480);
  r.closing = setTimeout(() => finish(r), 300);
});
ipcRenderer.on("capture-cancel", () => {
  if (recording) close(recording);
});
window.addEventListener("DOMContentLoaded", () => {
  // Prepare the audio graph without requesting a microphone. A failed warmup
  // can be retried on the next press.
  prepareInput();
  void publishDevices();
  navigator.mediaDevices?.addEventListener(
    "devicechange",
    () => void publishDevices(),
  );
  const indicator = document.querySelector("main")!;
  const output = document.querySelector("output")!;
  meterBars = document.querySelectorAll(".wave i");
  let motion: Animation | undefined;
  ipcRenderer.on("indicator", (_event, text: string, noticeId?: number) => {
    const inProgress = motion?.playState === "running";
    const style = getComputedStyle(indicator);
    const offset = matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "none"
      : "translateY(8px)";
    const from = {
      opacity: inProgress ? style.opacity : "0",
      transform: inProgress ? style.transform : offset,
    };
    motion?.cancel();
    motion = undefined;
    const state = text.startsWith("Listening") ? "Listening" : text;
    indicator.dataset.state = [
      "Starting",
      "Listening",
      "Transcribing",
      "Copied",
    ].includes(state)
      ? state.toLowerCase()
      : "notice";
    if (state === "Listening") {
      meterBars.forEach((bar) => bar.style.removeProperty("--level"));
    }
    output.textContent = text;
    if (noticeId !== undefined) {
      const visible = { opacity: 1, transform: "translateY(0)" };
      motion = indicator.animate(
        [
          { ...from, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
          { ...visible, offset: 0.14 },
          { ...visible, offset: 0.87, easing: "ease-in" },
          { opacity: 0, transform: offset },
        ],
        { duration: 1550, fill: "both" },
      );
      motion.onfinish = () => ipcRenderer.send("notice-finished", noticeId);
    }
  });
});
