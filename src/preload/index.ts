import { ipcRenderer } from "electron";
interface Recording {
  id: number;
  chunks: Float32Array[];
  streaming: boolean;
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
  async (_event, id: number, streaming = false) => {
    if (recording) close(recording);
    const r: Recording = { id, chunks: [], streaming };
    recording = r;
    try {
      const device = navigator.mediaDevices
        .getUserMedia({
          audio: { channelCount: 1 },
          video: false,
        })
        .then((stream) => {
          if (recording !== r) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          r.stream = stream;
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
  r.closing = setTimeout(() => finish(r), 300);
});
ipcRenderer.on("capture-cancel", () => {
  if (recording) close(recording);
});
window.addEventListener("DOMContentLoaded", () => {
  // Prepare the audio graph without requesting a microphone. A failed warmup
  // can be retried on the next press.
  prepareInput();
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
    indicator.dataset.state = [
      "Starting",
      "Listening",
      "Transcribing",
      "Copied",
    ].includes(text)
      ? text.toLowerCase()
      : "notice";
    if (text === "Listening") {
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
