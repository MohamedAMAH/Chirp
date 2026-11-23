declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(
  name: string,
  processor: typeof AudioWorkletProcessor,
): void;
class CaptureProcessor extends AudioWorkletProcessor {
  private block = new Float32Array(2048);
  private count = 0;
  private stopped = false;
  private started = false;
  constructor() {
    super();
    this.port.onmessage = ({ data }) => {
      this.stopped = true;
      if (data !== "end") return;
      if (this.count) this.port.postMessage(this.block.slice(0, this.count));
      this.port.postMessage("end");
    };
  }
  process(inputs: Float32Array[][]) {
    if (this.stopped) return false;
    const audio = inputs[0]?.[0];
    if (audio?.length) {
      if (!this.started) {
        this.started = true;
        this.port.postMessage("started");
      }
      for (const value of audio) {
        this.block[this.count++] = value;
        if (this.count === this.block.length) {
          this.port.postMessage(this.block, [this.block.buffer]);
          this.block = new Float32Array(2048);
          this.count = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("chirp-capture", CaptureProcessor);
