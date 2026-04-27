@echo off
echo [%date% %time%] Starting sync to Google Drive...
set SRC=C:\Users\Administrator\Desktop\crap_dev
set GD=G:\My Drive\ASIA LAB Data

echo Syncing Data...
xcopy /E /I /Y "%SRC%\Data\*" "%GD%\Data\" >nul 2>&1

echo Syncing Data_thang...
xcopy /E /I /Y "%SRC%\Data_thang\*" "%GD%\Data_thang\" >nul 2>&1

echo Syncing File_sach...
xcopy /E /I /Y "%SRC%\File_sach\*" "%GD%\File_sach\" >nul 2>&1

echo Syncing Excel...
xcopy /E /I /Y "%SRC%\Excel\*" "%GD%\Excel\" >nul 2>&1

echo [%date% %time%] Sync completed!
