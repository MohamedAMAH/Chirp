<div align="center">

# Chirp

### Offline push-to-talk dictation for Windows and Linux. Hold a key, speak, release.

[**Install**](#installation) • [**Usage**](#usage) • [**Speech Models**](#speech-models) • [**Build from Source**](#build-from-source) • [**How It Works**](#how-it-works) • [**Performance**](#performance) • [**Contributing**](#contribution-and-support)

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Windows](https://img.shields.io/badge/Windows-x64-0078D4?logo=windows&logoColor=white)
![Linux](https://img.shields.io/badge/Linux-X11%20%7C%20Sway-FCC624?logo=linux&logoColor=black)
![Node](https://img.shields.io/badge/node-%E2%89%A524-339933?logo=node.js&logoColor=white)
![Electron](https://img.shields.io/badge/electron-45.4.1-47848F?logo=electron&logoColor=white)
![TypeScript](https://img.shields.io/badge/typescript-5.9.3-3178C6?logo=typescript&logoColor=white)
![Offline](https://img.shields.io/badge/runs-100%25%20offline-success)

</div>

Chirp is a small tray app for dictation. Hold **Right Alt**, speak, and release. To record hands-free, tap **Right Alt** to start and tap it again to stop. Chirp transcribes on your CPU and tries to paste the text into the window where you started.

- **Offline Recognition**: Both speech models run locally on the CPU through sherpa-onnx. [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)
- **Global Push-to-Talk**: Start a dictation from another app. Automatic paste depends on the target accepting its paste shortcut.
- **Two Speech Models**: Qwen3-ASR 0.6B for 30 languages (default) and Parakeet TDT 0.6B v3 for faster results in 25 European languages.
- **Clipboard Fallback**: If you switch windows, Chirp copies the text for manual paste. With clipboard history off, Windows restores your previous clipboard after a successful paste when possible.
- **Streaming or Batch**: Process phrases while you speak, or process the audio once the recording ends. Switch with `Ctrl+N`.
- **Auto-Enter**: Turn it on in **Delivery** or press `Ctrl+B` on Windows or X11. Chirp waits for the target to read the pasted text before pressing Enter.

Check out the [Shortcuts](#shortcuts) and [Speech Models](#speech-models) for a quick reference.

## Why I built Chirp

I built Chirp to give coding agents better prompts. When I’m working in Codex, Claude Code, or Cursor, it’s easier to talk through a bug, explain what I’ve already tried, and say what I want to happen next. Chirp transcribes what I say and pastes it into the prompt I’m working on.

## Installation

| Platform | Package | Notes |
| --- | --- | --- |
| Windows x64 | `Chirp Setup.exe` | Per-user install, starts at sign-in. Tested on Windows 11. The installer is unsigned. |
| Linux x64, X11 | Portable `tar.gz` | Uses XInput2 and XTEST. |
| Linux x64, Sway (Wayland) | Portable `tar.gz` | Needs `wl-clipboard` and `wtype`. Auto-Enter is unavailable. |

Other Wayland compositors and macOS are not supported.

### Windows

1. Run `Chirp Setup.exe`, review the terms, and choose **I Agree**. Setup installs Chirp and both models for your account, then launches Chirp.
2. Find the Chirp icon in the system tray. Its tooltip shows when the model is ready. Use the **Chirp** desktop shortcut to open it again.
3. Click a text field, hold **Right Alt**, speak, and release.

To remove Chirp, use **Settings → Apps → Installed apps**.

### Linux (X11)

Extract the archive and run `chirp-dictation` in your X11 session.

### Linux (Sway)

Install `wl-clipboard` and `wtype`, then include the bundled configuration in your Sway config:

```text
include "/absolute/path/to/Chirp/resources/chirp-sway.conf"
```

From a source checkout, use `native/linux/chirp-sway.conf`. Run `swaymsg reload`, then launch `chirp-dictation`. The configuration keeps the indicator from taking keyboard focus. Its shortcuts stay active in Sway while the file is included, even after Chirp quits. Adjust the bindings if they conflict with your own.

#### Updating an existing Sway setup

1. Quit Chirp with `Ctrl+Q`.
2. Point your existing `include` at the new package's `resources/chirp-sway.conf`. If you copied the old rules into your own config, replace those rules with the new include. The old rules match every Chirp window and can keep the dashboard from receiving keyboard focus.
3. Run `swaymsg reload`, then launch Chirp again. Open the dashboard from the tray or by launching Chirp a second time.

## Usage

Click a text field, hold **Right Alt**, speak, and release. Chirp tries to paste into the window where you started. Chirp uses the system microphone by default. To choose another, open **Dictation** in the dashboard.

### Shortcuts

| Shortcut | Action |
| --- | --- |
| Hold **Right Alt** | Record. Release to transcribe and paste. |
| Tap **Right Alt** | Start hands-free recording. Tap again to transcribe and paste. |
| `Esc` | Discard the current recording on Windows or X11. |
| Dictation key + another key | Pass the key combination through and discard the recording on Windows or X11. |
| `Ctrl+B` | Toggle **Auto-Enter** on Windows and X11. It is off by default. |
| `Ctrl+N` | Switch between **Streaming** and **Batch**. |
| `Ctrl+Q` | Quit Chirp. The tray menu also has **Quit**. |

Choose **Show** in the tray menu, or click the tray icon, to open the Chirp window.

- **Overview** shows the current speech model, mode, microphone, shortcuts, and local activity. Weekly totals reset on Monday, and lifetime totals are cumulative. Estimated time saved assumes typing at 40 words per minute.
- **Dictation** selects a model, mode, and microphone. **Test mic** opens the microphone for up to 10 seconds.
- **Shortcuts** sets the dictation and cancel keys where supported. A hands-free recording ends after five minutes or three seconds of silence by default. You can change both limits and turn off silence detection.
- **Delivery** chooses automatic paste or clipboard-only output, sets the Auto-Enter delay, and controls Windows clipboard history.
- **Preferences** controls sound cues and sign-in startup in the installed Windows app.

### Indicator

A small indicator at the top center of the screen shows what Chirp is doing.

| State | Meaning |
| --- | --- |
| **Starting** | The microphone is opening. |
| **Listening** | Audio is arriving. Speak now. |
| **Transcribing** | The recording has ended and Chirp is finishing the transcript. |
| **Copied** | The text is on the clipboard for manual paste. |

### Paste behavior

- If you switch windows before Chirp sends the paste shortcut, including switching away and back, Chirp leaves the transcript on the clipboard.
- With Auto-Enter on, Chirp waits for the original window to read the pasted text, then waits the delay set in **Delivery** before pressing Enter. The default is 600 ms. It skips Enter if you changed windows or pressed a key in between.
- **Copy only** leaves the transcript on the clipboard and disables automatic paste and Auto-Enter.
- Chirp uses `Ctrl+Shift+V` for Windows Terminal and recognized Linux terminals. Paste manually from the clipboard if the target does not accept the shortcut Chirp sends.

## Speech Models

Choose a model in the dashboard under **Dictation**. Chirp saves the choice and loads that model at startup. `CHIRP_ASR_MODEL` overrides the saved model when set.

| Setting | Model | Languages | Publisher | License |
| --- | --- | --- | --- | --- |
| `qwen` (default) | Qwen3-ASR 0.6B | 30, including English, German, Arabic | Qwen team | Apache 2.0 |
| `parakeet` | Parakeet TDT 0.6B v3 | 25 European languages | NVIDIA | CC BY 4.0 |
| `parakeet-streaming` | Parakeet TDT 0.6B v3 | 25 European languages | NVIDIA | CC BY 4.0 |

`parakeet-streaming` selects Parakeet and defaults to streaming if you have no saved mode. Streaming transcribes phrases while you speak and uses pauses or quiet points to split the audio. With either model, `Ctrl+N` toggles streaming for the next recording. Chirp tries to paste once when the recording ends.

### Switch models

**Windows (installed copy).** Quit Chirp with `Ctrl+Q`, then run the following. Replace the example path with the path to your installed `Chirp.exe`.

```powershell
$model = 'parakeet'   # or 'qwen' or 'parakeet-streaming'
[Environment]::SetEnvironmentVariable('CHIRP_ASR_MODEL', $model, 'User')
$env:CHIRP_ASR_MODEL = $model
$chirp = 'C:\path\to\Chirp.exe'
& $chirp
```

**Windows (source checkout).**

```powershell
$env:CHIRP_ASR_MODEL = 'parakeet'
npm start
```

**Linux.** Run the command for your copy of Chirp.

```sh
CHIRP_ASR_MODEL=parakeet ./chirp-dictation       # extracted package
CHIRP_ASR_MODEL=parakeet npm run start:linux     # source checkout
```

## Build from Source

### Requirements

| Tool | Version |
| --- | --- |
| Node.js | 24 or newer |
| Electron | 45.4.1 |
| TypeScript | 5.9.3 |
| sherpa-onnx-node | 1.12.36 |

The last three install with `npm ci`.

- **Windows**: x64, Visual Studio Build Tools with the **Desktop development with C++** workload, and the Windows SDK.
- **Linux**: x64, a C++ compiler, and development libraries for X11, XInput2, and XTEST. On Debian and Ubuntu: `build-essential libx11-dev libxi-dev libxtst-dev`.

### Windows

```powershell
npm ci
npm run models   # download and verify both models into models\
npm start        # build and run
npm run dist     # produce dist\Chirp Setup.exe
```

### Linux

```sh
npm ci
npm run models
npm run start:linux
npm run dist:linux   # produce a portable tar.gz in dist/
```

`npm run models` downloads the pinned sherpa-onnx model conversions, checks their SHA-256 hashes, and extracts them into `models/`. Verified archives are reused from `build/downloads/`. Git tracks source, packaging configuration, and the lockfile. Build outputs and model weights stay local.

### Scripts

| Script | Purpose |
| --- | --- |
| `npm start` / `npm run start:linux` | Build and launch from source |
| `npm run build` | Compile TypeScript to `out/` |
| `npm test` | Build and run the unit tests |
| `npm run lint` | Type-check with unused-code checks |
| `npm run check:format` / `npm run format` | Check or apply Prettier formatting |
| `npm run compare` | Benchmark both models on sample recordings |
| `npm run test:capture` / `npm run test:paste` | Interactive Windows checks |
| `npm run dist` / `npm run dist:linux` | Package for Windows or Linux |

## How It Works

1. **At startup**, Electron prepares its audio processing and loads the selected speech model in a separate worker. The microphone stays closed until you press **Right Alt**.
2. **When you start dictating**, a platform-specific helper remembers the focused window and tells Electron to open the microphone. The indicator shows **Listening** when audio starts arriving. In streaming mode, the worker transcribes phrases as you speak.
3. **When the recording ends**, Chirp closes the microphone and completes the transcript. In **Batch** mode, the worker transcribes the full recording at this point.
4. **When the transcript is ready**, the helper copies it to the clipboard. In paste mode, it checks whether focus stayed in the original window before sending the paste shortcut. After switching windows, you can paste the transcript manually.

## Performance

On one Intel Core Ultra 9 275HX laptop with four CPU threads, recognition time after the audio was available:

| Recording | Qwen | Parakeet |
| --- | ---: | ---: |
| Noisy English, 88.19 s | 23.80 s | 3.06 s |
| German, 6.72 s | 1.08 s | 0.24 s |
| Arabic, 5.25 s | 1.23 s | 0.23 s |

Qwen matched the German reference and produced Arabic text, while Parakeet wrote a phonetic Latin rendering of the Arabic. Results vary with your voice, microphone, and hardware. Reproduce them with `npm run compare`. The [verification notes](docs/verification.md) cover the full comparison, streaming benchmarks, and Windows checks.

## Documentation

| Document | Contents |
| --- | --- |
| [docs/verification.md](docs/verification.md) | Model comparison, streaming benchmarks, and how to repeat the Windows checks |
| [`native/windows/terms.txt`](native/windows/terms.txt) | Terms and third-party notices, installed as `Chirp Terms.txt` |

## Repository Layout

| Path | Responsibility |
| --- | --- |
| `src/main` | Tray icon, overlay window, shortcuts, and the dictation lifecycle |
| `src/preload`, `src/renderer` | Microphone capture, audio worklet, and overlay UI |
| `src/speech` | Speech worker, shared recognizer interface, and model adapters |
| `native/windows` | Keyboard and focus hooks, clipboard delivery, and sign-in registration |
| `native/linux` | X11 input helper and Sway configuration |
| `scripts` | Model download, native helper builds, model comparison |
| `tests` | Recognition, clipboard, desktop, and installer checks |
| `docs` | Verification notes and benchmarks |

## Known Limitations

- Windows installers are unsigned, so SmartScreen may warn.
- Only Sway is supported on Wayland. Other compositors are rejected at startup.
- Sway uses the compositor's Right Alt binding. Auto-Enter and a dedicated cancel key are unavailable there.
- X11 supports modifier keys for the dictation shortcut. The cancel key must be available for Chirp to grab during recording.
- Chirp pastes plain text without timestamps. Use Qwen for Arabic dictation.

## Contribution and Support

Issues and pull requests are welcome. Before opening a pull request, run:

```sh
npm test
npm run lint
npm run check:format
```

The interactive Windows checks (capture, paste, clipboard, desktop targets, installer) are listed in [docs/verification.md](docs/verification.md).

## Privacy

- Chirp processes recordings and transcripts in memory. Optional recent transcripts are off by default. Turning the setting off or quitting Chirp clears the in-memory list.
- Chirp saves aggregate activity counts and durations locally. The activity file contains no recordings or transcript text.
- Speech recognition runs on the device without uploading audio or transcripts.
- Dictated text can remain on the system clipboard. On Windows, Chirp excludes it from clipboard history by default. Enabling clipboard history leaves the last transcript on the clipboard and allows it in **Win+V**.

## License

Chirp's terms are in [`native/windows/terms.txt`](native/windows/terms.txt). The bundled models and runtime have their own licenses:

- [NVIDIA Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3): CC BY 4.0, converted to ONNX by [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)
- [Qwen3-ASR 0.6B](https://huggingface.co/Qwen/Qwen3-ASR-0.6B): Apache 2.0
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx): Apache 2.0
