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
