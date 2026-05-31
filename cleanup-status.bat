@echo off
cd /d "%~dp0"
echo ================================================
echo  FIESTA — ניקוי + סטטוס DB
echo ================================================
echo.
node scripts/cleanup-and-status.mjs
echo.
pause
