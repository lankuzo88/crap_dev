@echo off
setlocal EnableDelayedExpansion

:: Kiem tra quyen Admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [LOI] Can chay voi quyen Administrator!
    echo Click phai vao file -^> Run as administrator
    pause
    exit /b 1
)

echo.
echo =============================================
echo   SETUP VIRTUAL DISPLAY (parsec-vdd)
echo   + TightVNC Server
echo =============================================
echo.

:: ── 1. DOWNLOAD PARSEC-VDD TU GITHUB ─────────
set "VDD_URL=https://github.com/nomi-san/parsec-vdd/releases/download/v0.45.1/ParsecVDisplay-v0.45-setup.exe"
set "VDD_FILE=%TEMP%\ParsecVDisplay-setup.exe"

if not exist "%VDD_FILE%" (
    echo [1/5] Dang tai parsec-vdd tu GitHub...
    powershell -NoProfile -Command ^
        "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object Net.WebClient).DownloadFile('%VDD_URL%', '%VDD_FILE%')"
    if not exist "%VDD_FILE%" (
        echo [LOI] Tai that bai! Kiem tra ket noi mang.
        pause
        exit /b 1
    )
    echo   -^> Tai xong.
) else (
    echo [1/5] File parsec-vdd da co san, bo qua tai.
)

:: ── 2. CAI PARSEC-VDD (SILENT) ────────────────
echo [2/5] Cai dat Parsec Virtual Display Driver...
"%VDD_FILE%" /S
timeout /t 15 /nobreak >nul
echo   -^> Driver da cai xong. Cho driver load...
timeout /t 5 /nobreak >nul

:: ── 3. DOWNLOAD TIGHTVNC TU TIGHTVNC.COM ─────
set "VNC_URL=https://www.tightvnc.com/download/2.8.84/tightvnc-2.8.84-gpl-setup-64bit.msi"
set "VNC_FILE=%TEMP%\tightvnc-setup-64bit.msi"

if not exist "%VNC_FILE%" (
    echo [3/5] Dang tai TightVNC...
    powershell -NoProfile -Command ^
        "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object Net.WebClient).DownloadFile('%VNC_URL%', '%VNC_FILE%')"
    if not exist "%VNC_FILE%" (
        echo [CANH BAO] Tai TightVNC that bai. Bo qua buoc VNC.
        goto :rdp_config
    )
    echo   -^> Tai xong.
) else (
    echo [3/5] File TightVNC da co san, bo qua tai.
)

:: Nhap mat khau VNC
set /p VNC_PASS="Nhap mat khau VNC (de ket noi sau nay): "
if "!VNC_PASS!"=="" (
    echo [LOI] Mat khau khong duoc de trong!
    pause
    exit /b 1
)

echo     Dang cai TightVNC...
msiexec /i "%VNC_FILE%" /quiet /norestart ^
    ADDLOCAL=Server ^
    SERVER_REGISTER_AS_SERVICE=1 ^
    SERVER_ADD_FIREWALL_EXCEPTION=1 ^
    SET_USEVNCAUTHENTICATION=1 ^
    VALUE_OF_USEVNCAUTHENTICATION=1 ^
    SET_PASSWORD=1 ^
    VALUE_OF_PASSWORD=!VNC_PASS!
echo   -^> TightVNC da cai xong.

:rdp_config
:: ── 4. CAU HINH RDP GIU SESSION ──────────────
echo [4/5] Cau hinh RDP giu session sau khi ngat ket noi...
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services" /v MaxDisconnectionTime /t REG_DWORD /d 0 /f >nul
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services" /v MaxIdleTime /t REG_DWORD /d 0 /f >nul
echo   -^> RDP session persistence: OK

:: ── 5. THEM VAO STARTUP QUA TASK SCHEDULER ───
echo [5/5] Cau hinh auto-start khi Windows khoi dong...
:: Parsec-VDD tu chay nhu service nen khong can them vao startup
:: Chi can dam bao TightVNC service auto-start
sc config tvnserver start= auto >nul 2>&1
echo   -^> TightVNC auto-start: OK

echo.
echo =============================================
echo   SETUP HOAN TAT!
echo =============================================
echo.
echo Ket noi lai bang VNC Viewer:
echo   Host : [IP cua VPS]:5900
echo   Pass : [mat khau ban vua nhap]
echo.
echo Download VNC Viewer (mien phi):
echo   https://www.realvnc.com/en/connect/download/viewer/
echo   hoac: https://tigervnc.org/
echo.
echo Kiem tra man hinh ao:
echo   wmic path Win32_VideoController get Name
echo   (Phai thay "Parsec Virtual Display Adapter")
echo.
echo [QUAN TRONG] Cach thoat RDP ma khong mat session:
echo   Nhan X (dong cua so RDP) - KHONG bam Sign Out
echo.
pause
