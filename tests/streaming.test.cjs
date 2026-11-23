const { test } = require("node:test");
const assert = require("node:assert/strict");
const { BufferedDictation } = require("../out/speech/parakeet-streaming");

test("recognition starts during capture and only returns text on release", () => {
  const lengths = [];
  const stream = new BufferedDictation({
    transcribe(audio) {
      lengths.push(audio.length);
      return String(audio.length);
    },
  });
  assert.equal(stream.accept(new Float32Array(32000).fill(1)), undefined);
  assert.deepEqual(lengths, [32000]);
  assert.equal(stream.accept(Float32Array.of(1)), undefined);
  assert.equal(stream.finish(), "32001");
});

test("pauses and long continuous speech preserve every sample in the final phrases", () => {
  const stream = new BufferedDictation({
    transcribe: (audio) => String(audio.length),
  });
  const audio = new Float32Array(16000 * 24 + 17).fill(1);
  audio.fill(0, 47000, 55000);
  for (let i = 0; i < audio.length; i += 2048)
    stream.accept(audio.subarray(i, i + 2048));
  const phrases = stream.finish().split(" ").map(Number);
  assert.ok(phrases.length > 2);
  assert.ok(phrases.every((n) => n <= 10 * 16000));
  assert.equal(
    phrases.reduce((a, b) => a + b, 0),
    audio.length,
  );
});
