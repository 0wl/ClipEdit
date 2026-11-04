@echo off
REM Builds the ClipEdit Explorer menu: COM DLL + stub exe -> signed MSIX.
REM Output: ..\resources\shell\ClipEditMenu.msix + ClipEditMenu.cer
REM Adapted from the earlier ClaudeContextMenu build.cmd.
setlocal enabledelayedexpansion

set ROOT=%~dp0
set BUILD=%ROOT%build
set SRC=%ROOT%src
set PKG=%ROOT%package
set STAGE=%BUILD%\stage
set OUTDIR=%ROOT%..\resources\shell
set PFX=%BUILD%\ClipEdit.pfx

if not exist "%BUILD%" mkdir "%BUILD%"
if not exist "%OUTDIR%" mkdir "%OUTDIR%"

if not exist "%PFX%" (
    echo === Creating signing certificate ===
    powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%make-cert.ps1"
    if errorlevel 1 ( echo Certificate creation failed & exit /b 1 )
)

set "VCVARS=C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
if exist "%VCVARS%" goto :have_vcvars
REM Kept outside a parenthesised block: "%ProgramFiles(x86)%" would close the block early.
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
for /f "usebackq delims=" %%I in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VCVARS=%%I\VC\Auxiliary\Build\vcvars64.bat"
:have_vcvars
call "%VCVARS%" >nul 2>&1
if errorlevel 1 ( echo vcvars failed & exit /b 1 )

echo === Building ClipEditMenu.dll ===
cl /nologo /W3 /EHsc /MT /std:c++17 /DUNICODE /D_UNICODE /O2 ^
   /Fo"%BUILD%\\" /Fe"%BUILD%\ClipEditMenu.dll" ^
   /LD "%SRC%\ClipEditMenu.cpp" ^
   /link /DEF:"%SRC%\ClipEditMenu.def" /SUBSYSTEM:WINDOWS ^
   shlwapi.lib ole32.lib oleaut32.lib user32.lib shell32.lib advapi32.lib runtimeobject.lib
if errorlevel 1 ( echo DLL build failed & exit /b 1 )

echo === Building ClipEditStub.exe ===
cl /nologo /W3 /EHsc /MT /DUNICODE /D_UNICODE /O2 ^
   /Fo"%BUILD%\\" /Fe"%BUILD%\ClipEditStub.exe" ^
   "%SRC%\Stub.cpp" /link /SUBSYSTEM:CONSOLE
if errorlevel 1 ( echo Stub build failed & exit /b 1 )

REM Locate Windows SDK tools (MakeAppx + SignTool): newest SDK that has both.
set "SDKBIN="
set "SDKROOT=C:\Program Files (x86)\Windows Kits\10\bin"
if not exist "%SDKROOT%" set "SDKROOT=C:\Program Files\Windows Kits\10\bin"
for /f "delims=" %%V in ('dir /b /ad /o-n "%SDKROOT%\10.*" 2^>nul') do call :try_sdk "%SDKROOT%\%%V\x64"
if not defined SDKBIN ( echo MakeAppx.exe / SignTool.exe not found under "%SDKROOT%" & exit /b 1 )
echo Using SDK bin: %SDKBIN%

echo === Staging ===
if exist "%STAGE%" rmdir /s /q "%STAGE%"
mkdir "%STAGE%\Assets"
copy /y "%PKG%\AppxManifest.xml"     "%STAGE%\AppxManifest.xml" >nul
copy /y "%PKG%\Assets\*.png"         "%STAGE%\Assets\"          >nul
copy /y "%BUILD%\ClipEditMenu.dll"   "%STAGE%\ClipEditMenu.dll" >nul
copy /y "%BUILD%\ClipEditStub.exe"   "%STAGE%\ClipEditStub.exe" >nul

echo === Packing ===
"%SDKBIN%\MakeAppx.exe" pack /d "%STAGE%" /p "%OUTDIR%\ClipEditMenu.msix" /o
if errorlevel 1 ( echo MakeAppx pack failed & exit /b 1 )

echo === Signing ===
"%SDKBIN%\SignTool.exe" sign /fd SHA256 /f "%PFX%" /p clipedit "%OUTDIR%\ClipEditMenu.msix"
if errorlevel 1 ( echo SignTool failed & exit /b 1 )

copy /y "%BUILD%\ClipEditMenu.cer" "%OUTDIR%\ClipEditMenu.cer" >nul
copy /y "%ROOT%uninstall-menu.ps1" "%OUTDIR%\uninstall-menu.ps1" >nul
echo === Done: %OUTDIR%\ClipEditMenu.msix ===
endlocal
goto :eof

:try_sdk
if defined SDKBIN exit /b 0
if exist "%~1\MakeAppx.exe" if exist "%~1\SignTool.exe" set "SDKBIN=%~1"
exit /b 0
