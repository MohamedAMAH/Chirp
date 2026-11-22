@echo off
setlocal
set "chirpVC="
for /f "usebackq delims=" %%V in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find VC\Auxiliary\Build\vcvars64.bat`) do set "chirpVC=%%V"
if not defined chirpVC exit /b 1
call "%chirpVC%" || exit /b 1
cd /d "%~dp0.." || exit /b 1
if not exist build mkdir build
cd build || exit /b 1
cl /nologo /std:c++17 /utf-8 /EHsc /MT /O2 /DUNICODE /D_UNICODE /Fechirp-input.exe "..\native\windows\input.cpp" user32.lib ole32.lib gdi32.lib
exit /b %errorlevel%
