@echo off
cd /d "%~dp0"
echo ================================================
echo  FIESTA — מעדכן תמונות דיגיים (URLs קשוחים, ללא fetching)
echo ================================================
echo.
node scripts/fix-dj-images.mjs
echo.
pause
