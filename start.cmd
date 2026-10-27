@echo off
cd /d "%~dp0"
set "NODE_EXE=node.exe"
where node.exe >nul 2>nul
if errorlevel 1 goto bundled_node
goto launch
:bundled_node
set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE_EXE%" (
  echo Node.js 20 or newer is required. Install Node.js, then run start.cmd again.
  pause
  exit /b 1
)
:launch
"%NODE_EXE%" server.js
if errorlevel 1 pause
