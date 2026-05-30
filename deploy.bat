@echo off
setlocal

echo === Deleting duplicate copy folder ===
if exist "C:\Users\123\Desktop\tium_fiesta\scarping_for_fiesta - עותק" (
  rd /s /q "C:\Users\123\Desktop\tium_fiesta\scarping_for_fiesta - עותק"
  echo Deleted.
) else (
  echo Copy folder not found - OK.
)

echo.
echo === Fixing vendor images in Fiesta MongoDB ===
cd /d "C:\Users\123\Desktop\scarping_for_fiesta"
call node scripts\fix-pushed-vendors.mjs
if errorlevel 1 (
  echo fix-pushed-vendors failed - continuing anyway...
)

echo.
echo === Pushing scraping dashboard ===
git add -A
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "Fix suppliers dashboard, push-to-fiesta, and image fallbacks"
)
git pull origin main --rebase
if errorlevel 1 (
  echo git pull failed for scraping repo
  pause
  exit /b 1
)
git push origin main
if errorlevel 1 (
  echo git push failed for scraping repo
  pause
  exit /b 1
)

echo.
echo === Pushing Fiesta site ===
cd /d "C:\Users\123\Desktop\tium_fiesta\Fiesta\fiesta-nextjs"
git add -A
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "Resolve vendor images from external URLs and scraped paths"
)
git pull origin main --rebase
if errorlevel 1 (
  echo git pull failed for Fiesta repo
  pause
  exit /b 1
)
git push origin main
if errorlevel 1 (
  echo git push failed for Fiesta repo
  pause
  exit /b 1
)

echo.
echo === All done successfully ===
pause
