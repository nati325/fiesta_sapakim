@echo off
cd /d "%~dp0"
echo ================================================
echo  FIESTA — דוחף ליאור פרץ + שרון כהן החסרים
echo ================================================
echo.
node scripts/push-missing-djs.mjs
echo.
pause
