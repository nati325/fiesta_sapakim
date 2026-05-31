@echo off
setlocal
cd /d "%~dp0"

echo === Deploy Push-to-Fiesta fix ===
git add -A
git commit -m "Fix push-to-fiesta: include /media images and resolve URLs for Fiesta"
git push origin main

if errorlevel 1 (
  echo.
  echo Git push failed - run manually or check git status
  pause
  exit /b 1
)

echo.
echo Pushed. Vercel will redeploy automatically.
echo.
echo IMPORTANT: Add these env vars on Vercel if missing:
echo   FIESTA_MONGODB_URI
echo   SCRAPING_PUBLIC_URL=https://fiesta-sapakim.vercel.app
echo   CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET (optional)
pause
