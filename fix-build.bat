@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   FIX VERCEL BUILD + PUSH
echo ============================================
echo.
echo Fixes:
echo  1. Remove duplicate GET in bulk-push route
echo  2. Fix next.config for Next.js 14
echo.

git add app/api/bulk-push-to-fiesta/route.js next.config.mjs lib/fiestaImages.js lib/cloudinaryUpload.js app/page.js lib/fiestaCategoryMap.js app/api/push-to-fiesta/route.js fix-build.bat run-build.bat

git status -sb
echo.

git commit -m "Fix Vercel build: remove duplicate GET export and next.config"
if errorlevel 1 (
  echo.
  echo Nothing new to commit OR commit failed.
  echo If already committed, try: git push origin main
  pause
  exit /b 1
)

git push origin main
if errorlevel 1 (
  echo.
  echo git push FAILED - check internet / GitHub login
  pause
  exit /b 1
)

echo.
echo ============================================
echo   SUCCESS - wait 1-2 min for Vercel rebuild
echo   Status should become Ready (green)
echo ============================================
pause
