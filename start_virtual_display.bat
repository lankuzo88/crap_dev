@echo off
setlocal

:: Kiem tra quyen Admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [LOI] Can chay voi quyen Administrator!
    pause
    exit /b 1
)

echo.
echo ===========================
echo   START VIRTUAL DISPLAY
echo ===========================
echo.

:: ── 1. KICH HOAT MAN HINH AO ─────────────────
if not exist "C:\usbmmidd\deviceinstaller64.exe" (
    echo [LOI] usbmmidd chua duoc cai dat. Chay setup_virtual_display.bat truoc!
    pause
    exit /b 1
)

echo [1/2] Kich hoat man hinh ao usbmmidd...
cd /d C:\usbmmidd
deviceinstaller64 enableidd 1
if %errorlevel% equ 0 (
    echo   -> Virtual display: OK
) else (
    echo   [CANH BAO] Lenh enableidd tra ve loi - co the man hinh da active san.
)

:: ── 2. KHOI DONG TIGHTVNC SERVICE ────────────
echo [2/2] Kiem tra TightVNC Service...
sc query "tvnserver" | find "RUNNING" >nul 2>&1
if %errorlevel% neq 0 (
    net start tvnserver >nul 2>&1
    if %errorlevel% equ 0 (
        echo   -> TightVNC: Started
    ) else (
        echo   [LOI] Khong the start TightVNC. Kiem tra lai cai dat.
    )
) else (
    echo   -> TightVNC: Already running
)

:: ── HIEN THI THONG TIN KET NOI ───────────────
echo.
echo ===========================
echo   READY
echo ===========================
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| find "IPv4"') do (
    set "IP=%%a"
    goto :show_ip
)
:show_ip
echo   VNC: %IP::=%:5900
echo.
echo Nho dong RDP bang nut X (Disconnect)
echo KHONG bam Sign Out / Log Off
echo.
