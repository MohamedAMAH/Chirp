# Generate explicit test fixtures using the default Windows desktop speech voice.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$dir = Join-Path $PSScriptRoot '..\build\speech-fixtures'
[void](New-Item -ItemType Directory -Path $dir -Force)
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000,
    [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
    [System.Speech.AudioFormat.AudioChannel]::Mono)
$prompts = [ordered]@{
    short = 'Open Chirp and add a retry to the upload.'
    coding = 'In Chirp, update the upload handler so that a network timeout retries twice. Keep the existing error message if both attempts fail. Add a test that checks the retry count, then run the tests and summarize what changed.'
}
try {
    foreach ($name in $prompts.Keys) {
        $voice.SetOutputToWaveFile((Join-Path $dir "$name.wav"),$format)
        $voice.Speak($prompts[$name])
        $voice.SetOutputToNull()
    }
} finally { $voice.Dispose() }
