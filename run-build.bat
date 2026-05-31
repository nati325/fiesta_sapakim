@echo off
setlocal
cd /d "%~dp0"

echo Running npm run build...
echo Output saved to build-log.txt
echo.

npm run build > build-log.txt 2>&1
set CODE=%ERRORLEVEL%

echo EXIT_CODE=%CODE%>> build-log.txt
echo.
echo EXIT_CODE=%CODE%
echo.
echo --- Last 40 lines ---
powershell -Command "Get-Content build-log.txt -Tail 40"

pause
exit /b %CODE%
