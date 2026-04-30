; AutoHotkey Script - Tự động xuất Excel từ KeyLab
; File: AutoExportKeyLab.ahk

#NoEnv
#SingleInstance Force
SetWorkingDir %A_ScriptDir%

; Cấu hình
ExportFolder := "C:\Users\Administrator\Desktop\crap_dev\Excel"
LogFile := ExportFolder . "\autohotkey_log.txt"

; Tạo thư mục nếu chưa có
FileCreateDir, %ExportFolder%

; Hàm ghi log
WriteLog(message) {
    global LogFile
    FormatTime, timestamp, , yyyy-MM-dd HH:mm:ss
    FileAppend, [%timestamp%] %message%`n, %LogFile%
}

; Hàm tìm và activate cửa sổ KeyLab
ActivateKeyLab() {
    WriteLog("Đang tìm cửa sổ KeyLab...")

    ; Tìm cửa sổ KeyLab theo title
    WinGet, id, ID, LAB ASIA - KEYLAB VERSION 2022

    if (id) {
        WriteLog("Tìm thấy KeyLab (ID: " . id . ")")
        WinActivate, ahk_id %id%
        WinWaitActive, ahk_id %id%, , 3
        Sleep, 500
        return true
    } else {
        WriteLog("Không tìm thấy cửa sổ KeyLab!")
        return false
    }
}

; Hàm click nút Excel bằng tọa độ
ClickExcelButton() {
    WriteLog("Đang click nút Excel...")

    ; Tọa độ nút Excel (cần điều chỉnh theo màn hình)
    ; Dựa vào screenshot: nút Excel ở góc trên bên phải
    ExcelButtonX := 809
    ExcelButtonY := 247

    ; Click vào nút Excel
    Click, %ExcelButtonX%, %ExcelButtonY%
    WriteLog("Đã click tại (" . ExcelButtonX . ", " . ExcelButtonY . ")")

    Sleep, 2000
}

; Hàm lưu file Excel
SaveExcelFile() {
    global ExportFolder

    WriteLog("Đang lưu file Excel...")

    ; Tạo tên file với timestamp
    FormatTime, timestamp, , yyyyMMdd_HHmmss
    filename := "DonHang_" . timestamp . ".xlsx"
    filepath := ExportFolder . "\" . filename

    ; Gửi đường dẫn file
    SendInput, %filepath%
    Sleep, 500

    ; Nhấn Enter để lưu
    SendInput, {Enter}
    Sleep, 2000

    WriteLog("Đã lưu file: " . filepath)

    ; Kiểm tra file có tồn tại không
    if FileExist(filepath) {
        FileGetSize, filesize, %filepath%
        WriteLog("SUCCESS! File size: " . filesize . " bytes")
        return filepath
    } else {
        WriteLog("WARNING: Chưa thấy file được tạo")
        return ""
    }
}

; Hàm chính - Xuất Excel
ExportExcel() {
    WriteLog("========================================")
    WriteLog("Bắt đầu Auto Export KeyLab")
    WriteLog("========================================")

    ; Activate KeyLab
    if (!ActivateKeyLab()) {
        WriteLog("Lỗi: Không tìm thấy KeyLab")
        return false
    }

    ; Click nút Excel
    ClickExcelButton()

    ; Lưu file
    result := SaveExcelFile()

    if (result != "") {
        WriteLog("Hoàn thành thành công!")
        return true
    } else {
        WriteLog("Thất bại!")
        return false
    }
}

; Chạy ngay khi script khởi động
ExportExcel()

; Thoát script
ExitApp
