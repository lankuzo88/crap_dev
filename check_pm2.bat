@echo off
echo ========================================
echo    PM2 STATUS CHECK
echo ========================================
echo.

echo [1] Danh sach process:
pm2 list
echo.

echo [2] Chi tiet server:
pm2 describe server
echo.

echo [3] Chi tiet auto-scrape:
pm2 describe auto-scrape
echo.

echo [4] Log server (20 dong cuoi):
pm2 logs server --lines 20 --nostream
echo.

echo [5] Log auto-scrape (20 dong cuoi):
pm2 logs auto-scrape --lines 20 --nostream
echo.

echo ========================================
echo    KIEM TRA XONG
echo ========================================
pause
