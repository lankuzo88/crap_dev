@echo off
setlocal

:: Kiem tra quyen Admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [LOI] Can chay voi quyen Administrator!
    echo Click phai vao file -> Run as administrator
    pause
    exit /b 1
)

echo.
echo =============================================
echo   SETUP VIRTUAL DISPLAY + VNC SERVER
echo =============================================
echo.

:: ── 1. KIEM TRA USBMMIDD ──────────────────────
if not exist "C:\usbmmidd\deviceinstaller64.exe" (
    echo [LOI] Khong tim thay C:\usbmmidd\deviceinstaller64.exe
    echo.
    echo Vui long download usbmmidd truoc:
    echo   https://www.amyuni.com/forum/viewtopic.php?t=3030
    echo   Giai nen vao C:\usbmmidd\
    echo.
    pause
    exit /b 1
)

:: ── 2. KIEM TRA TIGHTVNC INSTALLER ───────────
set "VNC_MSI="
for %%f in ("C:\Downloads\tightvnc-*-gpl-setup-64bit.msi") do set "VNC_MSI=%%f"
if not defined VNC_MSI (
    echo [LOI] Khong tim thay TightVNC installer trong C:\Downloads\
    echo.
    echo Vui long download TightVNC 64-bit truoc:
    echo   https://www.tightvnc.com/download.php
    echo   Luu vao C:\Downloads\
    echo.
    pause
    exit /b 1
)

:: ── 3. DAT MAT KHAU VNC ──────────────────────
set /p VNC_PASS="Nhap mat khau VNC (de ket noi sau nay): "
if "%VNC_PASS%"=="" (
    echo [LOI] Mat khau khong duoc de trong!
    pause
    exit /b 1
)

echo.
echo [1/5] Cai dat driver usbmmidd...
cd /d C:\usbmmidd
deviceinstaller64 install usbmmidd.inf usbmmidd
if %errorlevel% neq 0 (
    echo [CANH BAO] Lenh install co the da tung chay - bo qua loi nay.
)

echo [2/5] Kich hoat man hinh ao...
deviceinstaller64 enableidd 1
if %errorlevel% neq 0 (
    echo [LOI] Khong the kich hoat virtual display!
    pause
    exit /b 1
)
echo   -> Man hinh ao da san sang.

echo [3/5] Cai dat TightVNC Server...
msiexec /i "%VNC_MSI%" /quiet /norestart ^
    ADDLOCAL=Server ^
    SERVER_REGISTER_AS_SERVICE=1 ^
    SERVER_ADD_FIREWALL_EXCEPTION=1 ^
    SET_USEVNCAUTHENTICATION=1 ^
    VALUE_OF_USEVNCAUTHENTICATION=1 ^
    SET_PASSWORD=1 ^
    VALUE_OF_PASSWORD=%VNC_PASS%
if %errorlevel% neq 0 (
    echo [LOI] Cai dat TightVNC that bai (code: %errorlevel%)
    pause
    exit /b 1
)
echo   -> TightVNC da cai xong.

echo [4/5] Cau hinh RDP giu session sau khi ngat ket noi...
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services" /v MaxDisconnectionTime /t REG_DWORD /d 0 /f >nul
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services" /v MaxIdleTime /t REG_DWORD /d 0 /f >nul
echo   -> RDP session persistence: OK

echo [5/5] Them virtual display vao Windows Startup...
schtasks /create /tn "VirtualDisplay_AutoStart" ^
    /tr "C:\usbmmidd\deviceinstaller64.exe enableidd 1" ^
    /sc onstart /ru SYSTEM /rl HIGHEST /f >nul
echo   -> Task Scheduler: OK

echo.
echo =============================================
echo   SETUP HOAN TAT!
echo =============================================
echo.
echo Ket noi lai bang VNC Viewer:
echo   Host : [IP cua VPS]:5900
echo   Pass : [mat khau ban vua nhap]
echo.
echo Cach thoat RDP ma khong mat session:
echo   Nhan X (dong cua so RDP) - KHONG bam Sign Out
echo   Hoac nhan Windows+D -> bat cua so RDP -> dong X
echo.
echo Kiem tra man hinh ao:
echo   wmic path Win32_VideoController get Name
echo   (Phai thay "USB Mobile Monitor")
echo.
pause
