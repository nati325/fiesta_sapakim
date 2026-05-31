@echo off
setlocal
cd /d "%~dp0"

echo === Test Push to Fiesta (Lior Perez DJ) ===
echo Requires FIESTA_MONGODB_URI in .env.local
echo.

node scripts\push-lior.mjs
if errorlevel 1 (
  echo.
  echo FAILED - check .env.local and MongoDB connection
  pause
  exit /b 1
)

echo.
echo Done. Check bulk-push-report.json for image URLs.
echo Verify on: https://fiesta-7v55.vercel.app/category/dj
pause
