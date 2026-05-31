@echo off
cd /d "%~dp0"
echo ================================================
echo  מוריד תמונות לכל הספקים מ-engaged.co.il
echo  ושומר אותן ב-suppliers_complete.json
echo ================================================
echo.
echo זה ייקח בערך 10-15 דקות (900+ ספקים)
echo.
node scripts/fetch-all-supplier-images.mjs
echo.
pause
