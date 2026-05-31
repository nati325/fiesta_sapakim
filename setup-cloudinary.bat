@echo off
cd /d "%~dp0"
echo ================================================
echo  שלב 1: מתקין Cloudinary SDK...
echo ================================================
call npm install cloudinary
if %errorlevel% neq 0 (
  echo ❌ ההתקנה נכשלה
  pause
  exit /b 1
)
echo.
echo ================================================
echo  שלב 2: מעלה תמונות מקומיות ל-Cloudinary...
echo ================================================
echo.
node scripts/upload-to-cloudinary.mjs
echo.
pause
