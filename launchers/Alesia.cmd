@echo off
rem Alesia launcher - Windows.
rem
rem Double-clickable, and 1 KB. Alesia.exe (see build.sh) does exactly the same
rem thing in 112 MB; the only thing it buys is that Windows lets you pin an .exe
rem straight to the taskbar, which it refuses to do for a .cmd.

setlocal
title Alesia

for %%I in ("%~dp0..") do set "REPO=%%~fI"

if not exist "%REPO%\package.json" (
  echo Alesia not found at %REPO% - is this launcher still inside the repository?
  pause
  exit /b 1
)

cd /d "%REPO%" || (
  echo Cannot enter %REPO%
  pause
  exit /b 1
)

where bun >nul 2>&1 || (
  echo bun is not installed. Install it with:
  echo   powershell -c "irm bun.sh/install.ps1^|iex"
  pause
  exit /b 1
)

if not exist "%REPO%\node_modules" (
  echo First run: installing dependencies...
  call bun install || (
    echo bun install failed.
    pause
    exit /b 1
  )
)

rem The agent needs a model provider key; the backtest studies do not.
if not exist "%REPO%\.env" (
  echo No .env found. Copy env.example to .env and add an API key,
  echo or press a key to continue anyway ^(the backtests need no key^).
  pause
)

echo Alesia - %REPO%
echo.
call bun start

rem Keep the window open if it exited badly, so the error is readable.
if errorlevel 1 pause
endlocal
