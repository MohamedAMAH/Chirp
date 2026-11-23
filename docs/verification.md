# Chirp verification

## Model comparison

Both adapters ran locally on the same Intel Core Ultra 9 275HX, using four CPU threads. Each adapter warmed up before timing. The table gives recognition time after the audio was available, followed by word edits against the supplied reference. One substitution, insertion, or deletion counts as one edit. The comparison ignores case and punctuation.

| Shared recording | Reference words | Qwen time | Qwen edits | Parakeet time | Parakeet edits |
| --- | ---: | ---: | ---: | ---: | ---: |
| Noisy English, 88.19 s | 418 | 23.80 s | 99 | 3.06 s | 145 |
| German, 6.72 s | 14 | 1.08 s | 0 | 0.24 s | 2 |
| Arabic, 5.25 s | 11 | 1.23 s | 2 | 0.23 s | 12 |

Qwen matched the German reference and produced Arabic text. Parakeet wrote a phonetic rendering of the Arabic in Latin characters. Qwen is the default for testing all three languages. Parakeet was faster on every clip.

On two synthetic English coding prompts (3.11 s and 15.25 s), both adapters captured the instructions. Qwen spelled the app name “chirp” or “Chirp”. Parakeet wrote “Cherp” both times. The comparison uses one voice for these prompts and one recording per language above. Your voice and microphone can give different results.

In a separate browser test, a 6.5-second hold fed prerecorded speech through the microphone pipeline. Time from release to visible text was **1.56 s for Qwen** and **0.39 s for Parakeet** in one run. This includes the final audio transfer, recognition, and Windows paste. The recognition-only times in the table exclude microphone capture and paste.

### Timestamps and streaming

Both Chirp adapters run on the CPU after you release Right Alt. They return plain text for pasting. On the same German recording, the bundled sherpa-onnx runtime returned 38 token timestamps for Parakeet and zero for Qwen. A token can be part of a word.

| Capability | Parakeet TDT 0.6B v3 | Qwen3-ASR 0.6B |
| --- | --- | --- |
| Timestamps in the publisher’s toolkit | NeMo can return character, word, and segment timings when requested. | Offline word or character timing uses a separate forced-alignment model. Chirp ships only the recognizer. |
| Transcribing while someone is speaking | NVIDIA documents buffered inference with overlapping chunks. Its example uses two seconds of future context. | Qwen offers streaming through vLLM. Its streaming API handles one recording at a time and returns text without timestamps. |
| Languages | 25 European languages, including English and German. Arabic is outside its supported set. | 30 languages, including English, German, and Arabic, plus 22 Chinese dialects. Supports language identification. |

The publishers describe the available modes and their runtime requirements in the [NVIDIA Parakeet model card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) and the [Qwen inference guide](https://github.com/QwenLM/Qwen3-ASR#streaming-inference).

### Local streaming benchmark

The publisher runtimes ran on an RTX 5070 Ti Laptop GPU with 12 GB of VRAM under Docker Desktop and WSL 2. The five recordings were a 15.25-second English coding instruction, a 7.83-second synthetic English hesitation test, a 19.02-second English radio exchange, and the German and Arabic samples above. Every configuration received the same mono audio at 16 kHz with automatic language selection. Arabic is included to show what happens outside Parakeet's supported languages.

Each time below is the median across the five recordings. First text measures from the start of the recording to the first nonempty output. That output can change. The release column measures how much longer recognition takes once all the audio has arrived. The timings exclude loading the model, starting the microphone, and pasting into Windows.

| GPU configuration | First text | Remaining after release |
| --- | ---: | ---: |
| Qwen, 1 s chunks | 1.21 s | 0.15 s |
| Qwen, 2 s chunks | 2.27 s | 0.24 s |
| Qwen, 4 s chunks | 4.36 s | 0.52 s |
| Parakeet, 0.16 s chunks + 0.16 s lookahead | 0.37 s | 0.03 s |
| Parakeet, 0.16 s chunks + 3.84 s lookahead | 4.18 s | 0.04 s |
| Parakeet, 2 s chunks + 2 s lookahead | 4.03 s | 0.04 s |
| Parakeet, same 2 + 2 setting with four beam-search candidates | 4.05 s | 0.07 s |
| Parakeet, 10 s chunks + 5 s lookahead | 7.87 s | 0.05 s |
| Qwen, whole recording on release | After release | 0.81 s |
| Parakeet, whole recording on release | After release | 0.06 s |

**Qwen.** The single-stream test replayed each clip in real time using `qwen-asr` 0.0.6 and vLLM 0.14.0 with eager execution. The three chunk sizes above used half-second audio deliveries. With the 2 s chunk size, the four delivery intervals from Qwen's example (0.5, 1, 2 and 4 s) produced the same final text on each clip. Their median first-text times were 2.27, 2.29, 2.28 and 4.57 s respectively. Changing the model's chunk size changed some German and Arabic words. On the filler clip the 1 s setting initially displayed “嗯。” and revised it to English as the speaker continued. The separate batch API transcribed all five completed recordings in 2.20 s. [Qwen streaming example](https://github.com/QwenLM/Qwen3-ASR/blob/main/examples/example_qwen3_asr_vllm_streaming.py)

**Parakeet.** NeMo 3.0.0 processed overlapping chunks with 10 s of left context. The reference example replays files without waiting between chunks. Its timing here models real-time arrivals using the audio available at each step and the measured, GPU-synchronized decoding time. Each configuration ran twice over the clips, with timings taken on the second pass. At 0.16 s of lookahead the 15-second coding prompt became “Insurbe.” At 2 s chunks plus 2 s lookahead the complete prompt came through. With 10 s chunks plus 5 s lookahead, the three shortest clips finished before any preview appeared. A two-stream batch at the 2 + 2 setting matched the single-stream final text on all four supported-language clips. NeMo's simulated decoding test, which waits until the end to decode the chunks together, matched the five single-stream final transcripts. [NVIDIA model card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3#streaming-with-parakeet-models) · [NeMo reference implementation](https://github.com/NVIDIA-NeMo/NeMo/blob/v3.0.0/examples/asr/asr_chunked_inference/rnnt/speech_to_text_streaming_infer_rnnt.py)

**Hesitations.** On the radio recording the speaker says “I, uh, yeah.” Chirp's CPU Qwen adapter omitted “uh” and its Parakeet adapter kept it. Both publisher runtimes kept it at their 2 s streaming settings. On the synthetic clip both Chirp adapters kept the more clearly pronounced hesitations. Neither model consistently removed filler words in these tests.

The GPU tests used the original Qwen checkpoint at revision `5eb144179a02acc5e5ba31e748d22b0cf3e303b0` and the NVIDIA checkpoint at `541d1f99c6b0c3cd0b11a95167540bb8edefd82b`. Both streamed using the recognizer alone. Chirp's installed Windows app uses the quantized sherpa-onnx adapters. On the same 15.25-second coding clip, their warmed whole-recording decoding times were 3.77 s for Qwen and 0.98 s for Parakeet. These are single-machine measurements.

### Repeat the comparison

After `npm ci` and `npm run models`, run the following from the repository root in PowerShell. The comparison prints one JSON record per model and clip, including the transcript and elapsed milliseconds. The reference text for the language samples is in `models/qwen/test_wavs/transcript.txt`.

```powershell
npm run compare
pwsh -File tests/coding-prompts.ps1
npm run compare -- build/speech-fixtures/short.wav build/speech-fixtures/coding.wav
```

## Windows checks

| Check | Observed result |
| --- | --- |
| Release to paste | Recorded speech passed through Electron, each adapter, and the Windows helper into a focused browser text field. |
| Window switch | Switching away and back left the transcript on the clipboard and kept the original field unchanged. |
| Clipboard | The previous text and bitmap could be restored. A newer clipboard copy survived restoration. Fallback text carried the Windows clipboard-history exclusion marker. |
| Desktop applications | Text insertion was verified in Notepad and Windows Terminal. The Codex CLI opened at a trust prompt. Claude Code read the clipboard, but its editor contents could not be verified through Windows UI Automation. |
| Packaged application | Both bundled models loaded, returned an empty result for silence, and the global Ctrl+Q shortcut exited Chirp. |
| Installer | A temporary per-user installation contained the expected model encoders, registered the installed executable for sign-in, and launched its input helper. Uninstall removed the executable and sign-in registration. |
| Fresh checkout | The lockfile installed successfully, the speech tests passed, and the Windows helper compiled. |

The desktop tests use a recorded microphone input and a test driver for the Right Alt gesture. A physical microphone, the laptop’s Right Alt and AltGr behavior, and launch after an actual Windows restart still need a hands-on check.

### Repeat the Windows checks

Exit any running copy of Chirp so the test app can register Ctrl+Q. Run the interactive checks one at a time on an unlocked Windows desktop. The paste test opens its own target windows and moves keyboard focus between them.

```powershell
npm run test:capture
$env:CHIRP_ASR_MODEL = 'qwen'
npm run test:paste
$env:CHIRP_ASR_MODEL = 'parakeet'
npm run test:paste
.\scripts\native.cmd clipboard
pwsh -File tests/desktop-targets.ps1
npm run dist
.\scripts\native.cmd test
node tests/packaged.cjs
pwsh -File tests/installer.ps1
```

The installer test uses a Windows account with no existing Chirp installation. It installs into a disposable directory and uninstalls the test copy. The package test opens a disposable instance with a local debugger connection and sends Ctrl+Q only while its own test window has focus.
