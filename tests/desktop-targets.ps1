# Run on the interactive desktop. Every paste is scoped to a newly named test window.
param([ValidateSet('Notepad','Terminal','Codex','Claude')][string[]]$Targets=@('Notepad','Terminal','Codex','Claude'))
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class ChirpDesktopTest {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
}
'@
function Read-Editor($window) {
    $element=[System.Windows.Automation.AutomationElement]::FromHandle($window)
    $condition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::IsTextPatternAvailableProperty,$true)
    $nodes=$element.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition)
    foreach($node in $nodes) {
        $pattern=$node.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
        $pattern.DocumentRange.GetText(-1)
    }
}
$root=(Resolve-Path "$PSScriptRoot\..").Path
foreach($kind in $Targets){
    $title='Chirp-QA-'+[Guid]::NewGuid().ToString('N')
    $expected='Chirp can paste this sentence.'
    $file=Join-Path $root "build\$title.txt"
    $win=$null
    $bridge=$null
    try {
        if($kind -eq 'Notepad'){
            if(Get-Process Notepad -ErrorAction SilentlyContinue){throw 'An existing Notepad session is open.'}
            [IO.File]::WriteAllText($file,'')
            Start-Process notepad.exe -ArgumentList ('"'+$file+'"')
        }else{
            $argsList=@('-w','new','new-tab','--title',$title,'--suppressApplicationTitle','-d',$root)
            $program=switch($kind){
                Terminal {@('powershell.exe','-NoProfile','-Command','Read-Host')}
                Codex {@('codex.exe','--no-alt-screen')}
                Claude {@('claude.exe')}
            }
            & wt.exe @argsList @program
        }
        for($i=0;$i -lt 40 -and !$win;$i++){
            Start-Sleep -Milliseconds 250
            $win=Get-Process | Where-Object { $_.MainWindowTitle -like "*$title*" -and $_.ProcessName -in @('Notepad','WindowsTerminal') } | Select-Object -First 1
        }
        if(!$win){throw 'The dedicated test window did not open.'}
        $hwnd=$win.MainWindowHandle
        if($kind -in @('Codex','Claude')){
            Start-Sleep -Seconds 3
            $initial=(Read-Editor $hwnd) -join ' '
            if(!$initial.Trim()){throw 'The client did not expose its input surface to Windows UI Automation.'}
            if($initial -match 'trust|sign in|sign-in|log in|login|safety check|choose.*theme'){throw "The client displayed an interactive setup prompt ($($Matches[0]))." }
        }
        [void][ChirpDesktopTest]::SetForegroundWindow($hwnd)
        Start-Sleep -Milliseconds 250
        if([ChirpDesktopTest]::GetForegroundWindow() -ne $hwnd){throw 'The dedicated window could not acquire focus.'}
        $info=[Diagnostics.ProcessStartInfo]::new("$root\build\chirp-input-test.exe")
        $info.UseShellExecute=$false;$info.CreateNoWindow=$true
        $info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true
        $bridge=[Diagnostics.Process]::Start($info)
        $null=$bridge.StandardOutput.ReadLine()
        $bridge.StandardInput.WriteLine('arm')
        $null=$bridge.StandardOutput.ReadLine()
        $bridge.StandardInput.WriteLine("test-hold $hwnd")
        if($bridge.StandardOutput.ReadLine() -notmatch '^down (\d+) '){throw 'Target changed before the test.'}
        $id=$Matches[1]
        $bridge.StandardInput.WriteLine('test-release')
        $null=$bridge.StandardOutput.ReadLine()
        $hex=[Convert]::ToHexString([Text.Encoding]::UTF8.GetBytes($expected))
        $bridge.StandardInput.WriteLine("paste $id $hex")
        $delivery=$bridge.StandardOutput.ReadLine()
        Start-Sleep -Milliseconds 500
        $surface=(((Read-Editor $hwnd) -join ' ') -replace '\s+',' ')
        if($delivery -ne 'pasted' -or $surface -notlike "*$expected*"){throw "The helper reported $delivery. UI Automation could not verify the text in the editor."}
        Write-Output "$kind passed."
    } catch { Write-Output "$kind unverified. $($_.Exception.Message)" }
    finally {
        if($bridge -and !$bridge.HasExited){$bridge.StandardInput.WriteLine('quit');[void]$bridge.WaitForExit(3000);$bridge.Dispose()}
        if($win){
            $win.Refresh()
            if($win.MainWindowTitle -like "*$title*"){
                if($kind -eq 'Notepad'){
                    # Save only the explicitly created QA document, before closing its window.
                    if([ChirpDesktopTest]::GetForegroundWindow() -eq $win.MainWindowHandle){
                        Add-Type -AssemblyName System.Windows.Forms
                        [Windows.Forms.SendKeys]::SendWait('^s')
                        Start-Sleep -Milliseconds 250
                    }
                }
                [void][ChirpDesktopTest]::PostMessage($win.MainWindowHandle,0x10,[IntPtr]::Zero,[IntPtr]::Zero)
            }
        }
    }
}
