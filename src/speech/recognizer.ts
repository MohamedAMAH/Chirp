export interface SpeechAdapter {
  transcribe(samples: Float32Array, sampleRate: number): string;
  startStream?(): SpeechStream;
}
export interface SpeechStream {
  accept(samples: Float32Array): void;
  finish(): string;
}
interface Stream {
  acceptWaveform(audio: { samples: Float32Array; sampleRate: number }): void;
}
interface Engine {
  createStream(): Stream;
  decode(stream: Stream): void;
  getResult(stream: Stream): { text: string };
}
export function localRecognizer(
  config: Record<string, unknown>,
  featureDim = 80,
): SpeechAdapter {
  const sherpa = require("sherpa-onnx-node");
  const engine: Engine = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim },
    modelConfig: { numThreads: 4, provider: "cpu", debug: 0, ...config },
  });
  return {
    transcribe(samples, rate) {
      const parts: string[] = [];
      for (const segment of segments(samples, rate)) {
        if (!segment.some((v) => Math.abs(v) > 0.002)) continue;
        const stream = engine.createStream();
        stream.acceptWaveform({ samples: segment, sampleRate: rate });
        engine.decode(stream);
        parts.push(engine.getResult(stream).text.trim());
      }
      return parts.filter(Boolean).join(" ");
    },
  };
}
export function* segments(
  samples: Float32Array,
  rate: number,
  maxSeconds = 18,
) {
  let offset = 0;
  while (samples.length - offset > maxSeconds * rate) {
    let best = Infinity,
      end = offset + maxSeconds * rate;
    const step = Math.max(1, Math.floor(rate / 20));
    for (
      let i = offset + (maxSeconds - 4) * rate;
      i + step <= offset + maxSeconds * rate;
      i += step
    ) {
      let energy = 0;
      for (let j = i; j < i + step; j++) energy += samples[j] ** 2;
      if (energy <= best) {
        best = energy;
        end = i + Math.floor(step / 2);
      }
    }
    yield samples.subarray(offset, end);
    offset = end;
  }
  if (offset < samples.length) yield samples.subarray(offset);
}
