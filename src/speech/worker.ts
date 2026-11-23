import { parakeet } from "./parakeet";
import { parakeetStreaming } from "./parakeet-streaming";
import { qwen } from "./qwen";
import type { SpeechAdapter, SpeechStream } from "./recognizer";
const adapters = new Map<string, (root: string) => SpeechAdapter>([
  ["qwen", qwen],
  ["parakeet", parakeet],
  ["parakeet-streaming", parakeetStreaming],
]);
type Job =
  | { init: true; model: string; root: string }
  | { init: false; id: number; action: "start" | "finish" | "cancel" }
  | { init: false; id: number; action: "chunk"; samples: Float32Array }
  | { init: false; id: number; samples: Float32Array };
let adapter: SpeechAdapter;
let current: { id: number; stream: SpeechStream } | undefined;
process.parentPort.on("message", ({ data }: { data: Job }) => {
  try {
    if (data.init) {
      const create = adapters.get(data.model);
      if (!create) throw Error("Unknown model");
      adapter = create(data.root);
      process.parentPort.postMessage({
        ready: true,
        streaming: !!adapter.startStream,
      });
    } else if ("action" in data) {
      if (data.action === "start") {
        if (!adapter.startStream) throw Error("Streaming unavailable");
        current = { id: data.id, stream: adapter.startStream() };
      } else if (current && data.id === current.id) {
        if (data.action === "chunk") {
          const preview = current.stream.accept(data.samples);
          if (preview) process.parentPort.postMessage({ id: data.id, preview });
        } else {
          const session = current;
          current = undefined;
          if (data.action === "finish")
            process.parentPort.postMessage({
              id: data.id,
              text: session.stream.finish(),
            });
        }
      }
    } else {
      process.parentPort.postMessage({
        id: data.id,
        text: adapter.transcribe(data.samples, 16000),
      });
    }
  } catch {
    current = undefined;
    process.parentPort.postMessage(
      data.init
        ? { failure: "Model unavailable" }
        : { id: data.id, failure: "Transcription failed" },
    );
  }
});
