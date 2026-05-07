@echo off
cls
echo ========================================
echo    KIEM TRA NHANH PM2
echo ========================================
echo.

pm2 status

echo.
echo [Giai thich]
echo - status: online = dang chay OK
echo - status: stopped = da dung
echo - status: errored = loi
echo - uptime: thoi gian chay lien tuc
echo - restarts: so lan tu dong khoi dong lai
echo.

echo [Lenh huu ich]
echo - pm2 list          : Xem danh sach process
echo - pm2 logs          : Xem log tat ca
echo - pm2 logs server   : Xem log server
echo - pm2 logs auto-scrape : Xem log auto-scrape
echo - pm2 restart server   : Khoi dong lai server
echo - pm2 stop server      : Dung server
echo - pm2 start server     : Chay server
echo - pm2 monit            : Monitor real-time
echo.
pause
