@echo off
cd /d "C:\Users\123\Desktop\scarping_for_fiesta"
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
if exist ".next" rmdir /s /q ".next"
start "Fiesta Dashboard" cmd /k "npm run dev"
