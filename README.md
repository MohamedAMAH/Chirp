# Chirp

Chirp is a small Windows x64 dictation app. Hold **Right Alt**, speak, and release it to paste your words into the window where you started. Both speech models run on your laptop. Chirp keeps recordings and transcripts in memory and has no history.

## Install and dictate

1. Open `dist\Chirp Setup.exe` and review the terms. Choose **I Agree** to install Chirp and both models for your Windows account. Chirp opens when setup finishes and every time you sign in to Windows. You can read the terms again in `Chirp Terms.txt` next to `Chirp.exe`. The installer is unsigned.
2. Find the Chirp icon in the system tray, near the clock. Its tooltip shows when the model is ready. Chirp uses the default Windows microphone.
3. Click a text field, hold **Right Alt**, and speak. A small indicator appears at the top center of that screen. Release the key and keep the same window focused. Chirp pastes the result and leaves you in control of sending it.
4. If you switch windows, Chirp leaves the words on the clipboard. Paste them wherever you want. This also applies if you switch away and then return before transcription finishes.

After a successful automatic paste, Chirp restores the previous clipboard contents when possible. The **Copied** indicator means the transcript is available for manual paste. Using Right Alt in a key combination cancels that recording.

Press **Ctrl+B** to toggle **Auto-Enter**. The top indicator briefly shows the setting. Auto-Enter starts off each time Chirp opens. When enabled before dictation, Chirp presses Enter after the original window reads the pasted text. Switching windows leaves the transcript on the clipboard for manual paste.

Press **Ctrl+N** to switch the next dictation between **Streaming** (process phrases while you speak) and **Whole recording** (process the audio on release). Both modes use the currently loaded speech model and paste once on release. The top indicator displays the selected mode. Both shortcuts are global while Chirp runs.

Chirp prepares its audio processing at startup and opens the microphone when you press Right Alt. **Starting** means the microphone is opening. **Listening** appears as soon as audio begins arriving. If your microphone takes a moment to wake up, use **Listening** as your cue to speak.

The shortcut uses normal Windows keyboard events. For example, if you dictate into Notepad, Windows sees Right Alt and Chirp sends the usual paste shortcut to Notepad.

**Ctrl+Q** quits Chirp from any window. You can also right-click the tray icon and choose **Quit Chirp**. To remove Chirp, use **Settings → Apps → Installed apps**. Uninstalling removes its sign-in entry.

## Switch speech models

Chirp defaults to **Qwen3-ASR 0.6B** (`qwen`). **Parakeet TDT 0.6B v3** (`parakeet`) is also installed. Chirp loads the selected model when it starts and transcribes on release. The two adapters share the same microphone and paste code. The [model comparison](docs/verification.md) covers English, German, and Arabic.

To switch an installed copy, exit Chirp with **Ctrl+Q**, then run this in PowerShell. Set the first line to `'qwen'` to switch back.

```powershell
$model = 'parakeet'
[Environment]::SetEnvironmentVariable('CHIRP_ASR_MODEL', $model, 'User')
$env:CHIRP_ASR_MODEL = $model
$chirp = (Get-ItemPropertyValue 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' 'Chirp').Trim('"')
& $chirp
```

### Try Parakeet streaming

From a source checkout, quit the running copy and start Chirp with this setting
in PowerShell. It applies to this shell.

```powershell
$env:CHIRP_ASR_MODEL = 'parakeet-streaming'
npm start
```

This optional adapter uses the bundled Windows CPU engine. Hold Right Alt to
transcribe in the background. The indicator shows the microphone level while you
speak. Release the key to paste the completed text once. A pause ends
a phrase. During continuous speech the adapter splits the audio near a quiet
point to bound the work left at release. Choose `parakeet` or `qwen` for the
original whole-recording adapters.

## Build from source

Use Windows x64, Node.js 24 or newer, and Visual Studio Build Tools with the **Desktop development with C++** workload and Windows SDK. Run these commands from the repository root.

```powershell
npm ci
npm run models
npm start
```

`npm run models` downloads the pinned sherpa-onnx conversions, checks both archive hashes, and extracts the models into `models\`. It reuses verified archives in `build\downloads\`. Downloads are needed to prepare a fresh build. Installed dictation works locally on the CPU.

Run `npm run dist` to produce `dist\Chirp Setup.exe`. It includes the Electron app, the Windows input helper, both models, and their license notices. Git tracks the source, packaging configuration, and dependency lockfile. Build outputs and model weights stay local.

## Repository guide

| Directory | Responsibility |
| --- | --- |
| `src/main` | Tray icon, overlay window, shortcut, and dictation lifecycle |
| `src/preload` and `src/renderer` | Microphone capture, audio worklet, and overlay UI |
| `src/speech` | Speech worker, shared recognition interface, and model adapters |
| `native/windows` | Keyboard and foreground-window events, clipboard delivery, and sign-in registration |
| `scripts` | Model setup, Windows helper build, and model comparison |
| `tests` | Recognition, clipboard, desktop, and installer checks |

Run `npm test`, `npm run lint`, and `npm run check:format` for the basic checks. See [verification and test commands](docs/verification.md) for the interactive Windows checks.
