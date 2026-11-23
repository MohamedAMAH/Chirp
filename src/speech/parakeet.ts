import path from "node:path";
import { localRecognizer } from "./recognizer";
export function parakeet(root: string) {
  const file = (name: string) => path.join(root, "parakeet", name);
  return localRecognizer(
    {
      modelType: "nemo_transducer",
      tokens: file("tokens.txt"),
      transducer: {
        encoder: file("encoder.int8.onnx"),
        decoder: file("decoder.int8.onnx"),
        joiner: file("joiner.int8.onnx"),
      },
    },
    128,
  );
}
