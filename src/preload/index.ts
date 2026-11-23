import { ipcRenderer } from "electron";
interface Recording {
  id: number;
  chunks: Float32Array[];
  streaming: boolean;
  stream?: MediaStream;
  context?: AudioContext;
  input?: AudioWorkletNode;
  closing?: ReturnType<typeof setTimeout>;
}
let recording: Recording | undefined;
let meterBars: NodeListOf<HTMLElement>;
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
  r.input?.disconnect();
  if (r.context && r.context.state !== "closed") void r.context.close();
  if (recording === r) recording = undefined;
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
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1 },
        video: false,
      });
      if (recording !== r) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      r.stream = stream;
      const ctx = (r.context = new AudioContext({ sampleRate: 16000 }));
      await ctx.audioWorklet.addModule("../../out/renderer/processor.js");
      if (recording !== r) return;
      const input = (r.input = new AudioWorkletNode(ctx, "chirp-capture", {
        numberOfOutputs: 0,
      }));
      input.port.onmessage = ({ data }) => {
        if (recording !== r) return;
        if (data === "end") finish(r);
        else {
          if (r.streaming) ipcRenderer.send("audio", r.id, data, true);
          else r.chunks.push(data);
          updateMeter(data);
        }
      };
      ctx.createMediaStreamSource(stream).connect(input);
      await ctx.resume();
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
  if (!r.input) {
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
  const indicator = document.querySelector("main")!;
  const output = document.querySelector("output")!;
  meterBars = document.querySelectorAll(".wave i");
  ipcRenderer.on("indicator", (_event, text: string) => {
    indicator.dataset.state = ["Listening", "Transcribing", "Copied"].includes(
      text,
    )
      ? text.toLowerCase()
      : "notice";
    if (text === "Listening") {
      meterBars.forEach((bar) => bar.style.removeProperty("--level"));
    }
    output.textContent = text;
  });
});
