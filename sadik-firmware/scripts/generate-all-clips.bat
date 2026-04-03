@echo off
setlocal

echo ============================================================
echo  SADIK — Clip Header Generator
echo  Converts JSON animations to C++ PROGMEM headers for ESP32
echo ============================================================
echo.

set "JSON_BASE=..\..\sadik-app\public\animations"
set "OUT=..\include\clips"
set "CONV=json-to-clip-header.js"

:: Verify Node.js is available
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js not found in PATH. Please install Node.js and try again.
    pause
    exit /b 1
)

:: Verify the converter script exists
if not exist "%CONV%" (
    echo [ERROR] Cannot find %CONV%. Run this script from the scripts\ directory.
    pause
    exit /b 1
)

echo Generating clip headers...
echo.

:: ── Idle variations ──────────────────────────────────────────────────────────

node "%CONV%" "%JSON_BASE%\idle_variations\idle.json"                  "%OUT%\idle_clip.h"                idle
node "%CONV%" "%JSON_BASE%\idle_variations\blink.json"                 "%OUT%\blink_clip.h"               blink
node "%CONV%" "%JSON_BASE%\idle_variations\idle_alt_look_left.json"   "%OUT%\idle_alt_look_left_clip.h"  idle_alt_look_left
node "%CONV%" "%JSON_BASE%\idle_variations\idle_alt_look_right.json"  "%OUT%\idle_alt_look_right_clip.h" idle_alt_look_right

:: ── Core character animations ────────────────────────────────────────────────

node "%CONV%" "%JSON_BASE%\core_character\waking.json"        "%OUT%\waking_clip.h"        waking
node "%CONV%" "%JSON_BASE%\core_character\listening.json"     "%OUT%\listening_clip.h"     listening
node "%CONV%" "%JSON_BASE%\core_character\thinking.json"      "%OUT%\thinking_clip.h"      thinking
node "%CONV%" "%JSON_BASE%\core_character\talking.json"       "%OUT%\talking_clip.h"       talking
node "%CONV%" "%JSON_BASE%\core_character\confirming.json"    "%OUT%\confirming_clip.h"    confirming
node "%CONV%" "%JSON_BASE%\core_character\understanding.json" "%OUT%\understanding_clip.h" understanding
node "%CONV%" "%JSON_BASE%\core_character\confused.json"      "%OUT%\confused_clip.h"      confused
node "%CONV%" "%JSON_BASE%\core_character\didnt_hear.json"    "%OUT%\didnt_hear_clip.h"    didnt_hear
node "%CONV%" "%JSON_BASE%\core_character\error_soft.json"    "%OUT%\error_soft_clip.h"    error_soft
node "%CONV%" "%JSON_BASE%\core_character\goodbye_to_idle.json" "%OUT%\goodbye_to_idle_clip.h" goodbye_to_idle

echo.
echo ============================================================
echo  Done! Headers written to %OUT%
echo  Re-build the firmware in PlatformIO to apply changes.
echo ============================================================
echo.
pause
endlocal
