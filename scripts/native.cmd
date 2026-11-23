@echo off
setlocal
set "chirpVC="
for /f "usebackq delims=" %%V in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find VC\Auxiliary\Build\vcvars64.bat`) do set "chirpVC=%%V"
if not defined chirpVC exit /b 1
call "%chirpVC%" || exit /b 1
cd /d "%~dp0.." || exit /b 1
if not exist build mkdir build
cd build || exit /b 1
if "%~1"=="clipboard" (
    cl /nologo /std:c++17 /EHsc /MT /DUNICODE /D_UNICODE /Feclipboard-test.exe "..\tests\clipboard.cpp" user32.lib ole32.lib gdi32.lib && clipboard-test.exe
    goto :eof
)
set "chirpOutput=/Fechirp-input.exe"
if "%~1"=="test" set "chirpOutput=/DCHIRP_TEST_INPUT /Fechirp-input-test.exe"
cl /nologo /std:c++17 /utf-8 /EHsc /MT /O2 /DUNICODE /D_UNICODE %chirpOutput% "..\native\windows\input.cpp" user32.lib ole32.lib gdi32.lib
exit /b %errorlevel%
