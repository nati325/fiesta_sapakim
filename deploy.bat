@echo off
setlocal

echo === Deleting duplicate copy folder ===
if exist "C:\Users\123\Desktop\tium_fiesta\scarping_for_fiesta - עותק" (
  rd /s /q "C:\Users\123\Desktop\tium_fiesta\scarping_for_fiesta - עותק"
  echo Deleted.
) else (
  echo Copy folder not found.
)

echo.
echo === Fixing vendor images in Fiesta MongoDB ===
cd /d "C:\Users\123\Desktop\scarping_for_fiesta"
call node scripts\fix-pushed-vendors.mjs
if errorlevel 1 (
  echo fix-pushed-vendors failed
  pause
  exit /b 1
)

echo.
echo === Pushing scraping dashboard ===
git add -A
git commit -m "Fix suppliers dashboard, push-to-fiesta, and image fallbacks"
git push origin main

echo.
echo === Pushing Fiesta site ===
cd /d "C:\Users\123\Desktop\tium_fiesta\Fiesta\fiesta-nextjs"
git add -A
git commit -m "Resolve vendor images from external URLs and scraped paths"
git push origin main

echo.
echo === Done ===
pause
