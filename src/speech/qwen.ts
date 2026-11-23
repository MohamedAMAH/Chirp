import path from "node:path";
import { localRecognizer } from "./recognizer";
export function qwen(root: string) {
  const file = (name: string) => path.join(root, "qwen", name);
  return localRecognizer({
    qwen3Asr: {
      convFrontend: file("conv_frontend.onnx"),
      encoder: file("encoder.int8.onnx"),
      decoder: file("decoder.int8.onnx"),
      tokenizer: file("tokenizer"),
    },
  });
}
