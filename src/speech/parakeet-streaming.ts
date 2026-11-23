import { BufferedDictation } from "./buffered-dictation";
import { parakeet } from "./parakeet";
import type { SpeechAdapter } from "./recognizer";

export { BufferedDictation };

export function parakeetStreaming(root: string): SpeechAdapter {
  const adapter = parakeet(root);
  return { ...adapter, startStream: () => new BufferedDictation(adapter) };
}
