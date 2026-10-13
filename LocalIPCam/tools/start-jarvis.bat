@echo off
setlocal
title Jarvis
cd /d "%~dp0"

rem ================= SETTINGS (edit these) =================
set "JARVIS_PHONE=http://10.0.0.78:8080"
set "JARVIS_USER=cam"
set "JARVIS_PASS=changeme"
set "JARVIS_MODEL=qwen3.5:4b"
set "VOICE=Microsoft David Desktop"
set "SPEED=0"
rem ==========================================================
rem Run "start-jarvis.bat tenant" for the horror personality.
rem Run "start-jarvis.bat console" for the old type-only version in this window.

echo.
echo  ==== JARVIS ====
echo.

rem --- 1. files that must sit next to this .bat
if not exist "jarvis.py"        ( echo  [x] jarvis.py is missing from %~dp0 & goto :fail )
if not exist "say-helper.ps1"   ( echo  [x] say-helper.ps1 is missing from %~dp0 & goto :fail )
if not exist "jarvis_app.py"    ( echo  [x] jarvis_app.py is missing from %~dp0 & goto :fail )
if not exist "stt.py"           ( echo  [x] stt.py is missing from %~dp0 & goto :fail )

rem --- 2. Python + packages
where py >nul 2>nul && (set "PY=py") || (set "PY=python")
%PY% --version >nul 2>nul || ( echo  [x] Python not found. Install it from python.org and tick "Add to PATH". & goto :fail )
%PY% -c "import requests, PIL" >nul 2>nul || (
    echo  [..] installing requests + pillow
    %PY% -m pip install --quiet requests pillow || goto :fail
)
%PY% -c "import faster_whisper, sounddevice, numpy" >nul 2>nul || (
    echo  [..] installing voice input: faster-whisper + sounddevice
    %PY% -m pip install --quiet faster-whisper sounddevice numpy || echo  [!] voice input did not install. Typing still works.
)
echo  [ok] python

rem --- 3. Ollama running?
curl -s -o nul http://localhost:11434/api/tags
if errorlevel 1 (
    echo  [..] starting Ollama
    if exist "%LOCALAPPDATA%\Programs\Ollama\ollama app.exe" (
        start "" "%LOCALAPPDATA%\Programs\Ollama\ollama app.exe"
    ) else (
        start "Ollama" /min ollama serve
    )
    timeout /t 5 /nobreak >nul
)
curl -s -o nul http://localhost:11434/api/tags || ( echo  [x] Ollama won't start. Is it installed? & goto :fail )
echo  [ok] ollama

rem --- 4. model downloaded?
ollama list | findstr /i /c:"%JARVIS_MODEL%" >nul || (
    echo  [..] downloading %JARVIS_MODEL% ^(one time, a few GB^)
    ollama pull %JARVIS_MODEL% || goto :fail
)
echo  [ok] model %JARVIS_MODEL%

rem --- 5. phone reachable?
curl -s -o nul -w "%%{http_code}" -u "%JARVIS_USER%:%JARVIS_PASS%" "%JARVIS_PHONE%/status" > "%TEMP%\jarvis_code.txt"
set /p CODE=<"%TEMP%\jarvis_code.txt"
if "%CODE%"=="401" ( echo  [x] phone says wrong password. Fix JARVIS_PASS at the top of this file. & goto :fail )
if not "%CODE%"=="200" ( echo  [x] can't reach the phone at %JARVIS_PHONE%. Is the stream started? & goto :fail )
echo  [ok] phone

rem --- 6. the voice, in its own window
start "Jarvis voice" powershell -NoExit -ExecutionPolicy Bypass -File "%~dp0say-helper.ps1" -Phone "%JARVIS_PHONE%" -User "%JARVIS_USER%" -Pass "%JARVIS_PASS%" -PollMs 200 -Voice "%VOICE%" -Speed %SPEED%
echo  [ok] voice window

rem --- 7. live camera in the browser (it will ask for the camera login)
start "" "%JARVIS_PHONE%/"
echo  [ok] live view in browser

rem --- 8. the brain: the Jarvis app window (or the old console chat with "console")
echo.
set "ARGS="
if /i "%~1"=="tenant" set "ARGS=--tenant"
if /i "%~2"=="tenant" set "ARGS=--tenant"
if /i "%~1"=="console" ( %PY% jarvis.py %ARGS% ) else ( %PY% jarvis_app.py %ARGS% )
goto :eof

:fail
echo.
echo  Something's not set up yet. Fix the [x] line above and run this again.
pause
exit /b 1
