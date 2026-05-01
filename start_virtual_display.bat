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

:: ── 1. KIEM TRA PARSEC-VDD ───────────────────
echo [1/2] Kiem tra Parsec Virtual Display...
wmic path Win32_VideoController get Name 2>nul | find /i "Parsec" >nul
if %errorlevel% equ 0 (
    echo   -^> Parsec Virtual Display: ACTIVE
) else (
    echo   [CANH BAO] Parsec VDD chua active.
    echo   Chay setup_virtual_display.bat truoc!
)

:: ── 2. KHOI DONG TIGHTVNC ────────────────────
echo [2/2] Kiem tra TightVNC Service...
sc query "tvnserver" | find "RUNNING" >nul 2>&1
if %errorlevel% neq 0 (
    net start tvnserver >nul 2>&1
    if %errorlevel% equ 0 (
        echo   -^> TightVNC: Started
    ) else (
        echo   [CANH BAO] TightVNC chua duoc cai. Chay setup truoc.
    )
) else (
    echo   -^> TightVNC: Already running
)

:: ── HIEN THI IP KET NOI ──────────────────────
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| find "IPv4"') do (
    set "RAW_IP=%%a"
    set "IP=!RAW_IP: =!"
    goto :show
)
:show
echo ===========================
echo   READY
echo ===========================
echo   VNC: %IP%:5900
echo.
echo Nho dong RDP bang nut X (Disconnect)
echo KHONG bam Sign Out / Log Off
echo.
