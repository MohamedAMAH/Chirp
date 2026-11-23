$ErrorActionPreference = 'Stop'
$root = (Resolve-Path "$PSScriptRoot\..").Path
$installer = Join-Path $root 'dist\Chirp Setup.exe'
$target = Join-Path $root ('build\install-smoke-' + [Guid]::NewGuid().ToString('N'))
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$registered = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
                'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*') |
    ForEach-Object { Get-ItemProperty $_ -ErrorAction SilentlyContinue } |
    Where-Object DisplayName -eq 'Chirp'
if ($registered -or (Get-ItemProperty $runKey).Chirp) { throw 'Use a Windows profile without an existing Chirp installation.' }
$setup = Start-Process -FilePath $installer -ArgumentList @('/S',"/D=$target") -WindowStyle Hidden -PassThru -Wait
if ($setup.ExitCode) { throw "Setup returned $($setup.ExitCode)." }
$exe = Join-Path $target 'Chirp.exe'
if (!(Test-Path -LiteralPath $exe)) { throw 'The test install path was not honored.' }
try {
    if ((Get-ItemProperty $runKey).Chirp -ne ('"' + $exe + '"')) { throw 'Wrong sign-in entry.' }
    $installedTerms = Get-FileHash -LiteralPath (Join-Path $target 'Chirp Terms.txt')
    $setupTerms = Get-FileHash -LiteralPath (Join-Path $root 'native\windows\terms.txt')
    if ($installedTerms.Hash -ne $setupTerms.Hash) { throw 'Installed terms differ from the setup terms.' }
    foreach ($name in @('qwen\encoder.int8.onnx','parakeet\encoder.int8.onnx')) {
        if ((Get-FileHash "$target\resources\models\$name").Hash -ne (Get-FileHash "$root\models\$name").Hash) {
            throw "Installed model differs: $name"
        }
    }
    $profile = Join-Path $target 'smoke-profile'
    $p = Start-Process -FilePath $exe -ArgumentList ('--user-data-dir="' + $profile + '"') -WindowStyle Hidden -PassThru
    Start-Sleep -Seconds 6
    $helper = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($p.Id)" | Where-Object Name -eq 'chirp-input.exe'
    if ($p.HasExited -or !$helper) { throw 'Installed app did not start its Windows helper.' }
    Write-Output 'Installed model files and sign-in launch target verified.'
} finally {
    if ($p -and !$p.HasExited -and $p.Path -eq $exe) { Stop-Process -Id $p.Id; $p.WaitForExit() }
    $uninstaller = Join-Path $target 'Uninstall Chirp.exe'
    if (Test-Path -LiteralPath $uninstaller) {
        $u = Start-Process -FilePath $uninstaller -ArgumentList @('/S',"_?=$target") -WindowStyle Hidden -Wait -PassThru
        if ($u.ExitCode) { throw "Uninstall returned $($u.ExitCode)." }
    }
}
if ((Get-ItemProperty $runKey).Chirp -or (Test-Path -LiteralPath $exe)) { throw 'Uninstall did not remove Chirp.' }
Write-Output 'Silent install and uninstall passed.'
