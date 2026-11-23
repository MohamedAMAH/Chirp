import { segments, type SpeechAdapter, type SpeechStream } from "./recognizer";

const rate = 16000;
const updateInterval = 2 * rate;
const maxSeconds = 10;

// Only the current phrase is revisable. Close it at a pause, or at the
// quietest available boundary in a long stretch of continuous speech.
export class BufferedDictation implements SpeechStream {
  private readonly buffer = new Float32Array(maxSeconds * rate + 1);
  private length = 0;
  private quiet = 0;
  private decodedLength = 0;
  private draft = "";
  private readonly phrases: string[] = [];

  constructor(private readonly adapter: SpeechAdapter) {}

  private commit(count: number) {
    const text =
      count === this.decodedLength
        ? this.draft
        : this.adapter.transcribe(this.buffer.subarray(0, count), rate);
    if (text) this.phrases.push(text);
    this.buffer.copyWithin(0, count, this.length);
    this.length -= count;
    this.quiet = Math.min(this.quiet, this.length);
    this.decodedLength = 0;
    this.draft = "";
  }

  accept(samples: Float32Array) {
    for (const sample of samples) {
      this.buffer[this.length++] = sample;
      this.quiet = Math.abs(sample) < 0.004 ? this.quiet + 1 : 0;
      if (this.length === this.buffer.length) {
        const [first] = segments(this.buffer, rate, maxSeconds);
        this.commit(first.length);
      } else if (this.length >= updateInterval && this.quiet >= rate * 0.4) {
        this.commit(this.length);
      }
    }
    if (this.length - this.decodedLength >= updateInterval) {
      this.draft = this.adapter.transcribe(
        this.buffer.subarray(0, this.length),
        rate,
      );
      this.decodedLength = this.length;
    }
  }

  finish() {
    if (this.length) this.commit(this.length);
    return this.phrases.join(" ");
  }
}
