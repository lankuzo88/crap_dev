@echo off
REM Start PM2 processes on Windows boot
cd /d C:\Users\Administrator\Desktop\crap_dev
pm2 resurrect
pm2 logs asia-lab-server --lines 0
