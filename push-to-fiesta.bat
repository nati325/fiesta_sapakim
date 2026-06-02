@echo off

cd /d "%~dp0"

echo === Bulk push to Fiesta ===

echo Edit data\fiesta-push-queue.json with 9 supplier phones, then run again.

echo Or run: npm run bulk-push-contract

echo.

node scripts/bulk-push-to-fiesta.mjs --file data/fiesta-push-queue.json

echo.

pause

