@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   TRIGGER NEW VERCEL DEPLOY (latest main)
echo ============================================
echo.
echo Current commit on your PC:
git log -1 --oneline
echo.
echo Pushing empty commit to force Vercel rebuild...
echo Vercel MUST show: Commit 70949a3 or newer
echo NOT: 0712d3b
echo.

git commit --allow-empty -m "Trigger Vercel deploy with build fix"
git push origin main

if errorlevel 1 (
  echo.
  echo PUSH FAILED - run manually in terminal
  pause
  exit /b 1
)

echo.
echo DONE. Open Vercel - Deployments - wait for NEW row.
echo Check first line of build log says Commit: 70949a3 or newer
echo.
pause
