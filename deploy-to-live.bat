@echo off
cd /d "%~dp0"
echo ================================================
echo  Deploy דשבורד ספקים ל-GitHub + Vercel
echo ================================================
echo.

echo --- Git status ---
git status --short
echo.

echo --- Staging files ---
git add data/suppliers_complete.json
git add app/page.js
git add app/api/suppliers/route.js
git add app/api/fetch-supplier-image/route.js
git add lib/fiestaImages.js
git add lib/fiestaPushCore.js
git add lib/cloudinaryUpload.js
git add package.json
git add package-lock.json
git add scripts/fetch-all-supplier-images.mjs
git add scripts/count-suppliers.mjs
git add scripts/upload-to-cloudinary.mjs
git add scripts/fix-dj-images.mjs
git add fetch-all-images.bat
git add setup-cloudinary.bat
git add fix-dj-images.bat
git add deploy-to-live.bat
echo.

echo --- Commit ---
git commit -m "Add supplier image fetching and persist https URLs for live dashboard"
if %errorlevel% neq 0 (
  echo No new changes to commit, or commit failed.
  goto push
)

:push
echo.
echo --- Push to GitHub ---
git push origin main
if %errorlevel% neq 0 (
  echo.
  echo PUSH FAILED - check GitHub login / token
  pause
  exit /b 1
)

echo.
echo ================================================
echo  SUCCESS! Now redeploy on Vercel:
echo  1. https://vercel.com/dashboard
echo  2. Project: fiesta-sapakim
echo  3. Deployments -^> Redeploy
echo.
echo  Also add Environment Variables if missing:
echo    CLOUDINARY_CLOUD_NAME=dek0tfcbr
echo    CLOUDINARY_API_KEY=678917124175759
echo    CLOUDINARY_API_SECRET=(your secret)
echo    FIESTA_MONGODB_URI=(fiesta cluster)
echo    MONGODB_URI=(crm cluster)
echo ================================================
echo.
pause
