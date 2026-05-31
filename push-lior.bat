@echo off
cd /d "%~dp0"
echo Pushing Lior Perez (DJ) to Fiesta...
node scripts/push-lior.mjs > push-lior-result.txt 2>&1
type push-lior-result.txt
echo.
if exist bulk-push-report.json type bulk-push-report.json
pause
