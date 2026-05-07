# HƯỚNG DẪN KIỂM TRA PM2

## Cách kiểm tra nhanh nhất

### 1. Mở CMD hoặc PowerShell, gõ:
```bash
pm2 status
```

**Xem gì:**
- `status: online` = ✅ Đang chạy OK
- `status: stopped` = ❌ Đã dừng
- `status: errored` = ❌ Bị lỗi
- `uptime` = Thời gian chạy liên tục (ví dụ: 2h = chạy được 2 giờ)
- `↺` (restarts) = Số lần tự động khởi động lại

### 2. Xem log (để biết có lỗi không):
```bash
pm2 logs --lines 50
```

Nhấn `Ctrl+C` để thoát.

---

## Các lệnh thường dùng

### Xem trạng thái:
```bash
pm2 list              # Danh sách tất cả process
pm2 status            # Giống pm2 list
pm2 describe server   # Chi tiết process server
```

### Xem log:
```bash
pm2 logs                    # Xem log tất cả (real-time)
pm2 logs server             # Chỉ xem log server
pm2 logs auto-scrape        # Chỉ xem log auto-scrape
pm2 logs --lines 100        # Xem 100 dòng cuối
pm2 logs --nostream         # Xem log rồi thoát (không real-time)
```

### Khởi động lại:
```bash
pm2 restart server          # Khởi động lại server
pm2 restart auto-scrape     # Khởi động lại auto-scrape
pm2 restart all             # Khởi động lại tất cả
```

### Dừng/Chạy:
```bash
pm2 stop server             # Dừng server
pm2 start server            # Chạy server
pm2 delete server           # Xóa process (cẩn thận!)
```

### Monitor real-time:
```bash
pm2 monit                   # Xem CPU, RAM real-time
```

---

## File .bat đã tạo sẵn

### 1. `pm2_quick_check.bat`
- Double-click để xem trạng thái nhanh
- Có giải thích từng cột

### 2. `check_pm2.bat`
- Kiểm tra chi tiết hơn
- Xem cả log 20 dòng cuối

---

## Trạng thái hiện tại (2026-05-03)

```
┌────┬────────────────┬─────────┬──────────┬────────┬───────────┐
│ id │ name           │ pid     │ uptime   │ ↺      │ status    │
├────┼────────────────┼─────────┼──────────┼────────┼───────────┤
│ 0  │ server         │ 13652   │ 2s       │ 182+   │ online    │
│ 1  │ auto-scrape    │ 408     │ 90s      │ 0      │ online    │
└────┴────────────────┴─────────┴──────────┴────────┴───────────┘
```

**Giải thích:**
- ✅ `server` đang chạy (port 3000)
- ✅ `auto-scrape` đang chạy (cào dữ liệu mỗi 10 phút)
- Server có 182+ restarts (bình thường, do đã chạy lâu)
- Auto-scrape có 0 restarts (vừa mới start)

---

## Khi nào cần lo lắng?

### ❌ BAD - Cần xử lý ngay:
```
│ status    │ errored   │  ← Bị lỗi, cần xem log
│ status    │ stopped   │  ← Đã dừng, cần start lại
│ ↺         │ 999+      │  ← Restart quá nhiều, có vấn đề
│ uptime    │ 0s        │  ← Vừa crash, đang restart liên tục
```

### ✅ GOOD - Không sao:
```
│ status    │ online    │  ← Đang chạy OK
│ uptime    │ 2h        │  ← Chạy ổn định 2 giờ
│ ↺         │ 0-10      │  ← Restart ít, bình thường
```

---

## Xử lý khi có vấn đề

### 1. Process bị stopped:
```bash
pm2 start server
```

### 2. Process bị errored:
```bash
pm2 logs server --lines 50    # Xem lỗi gì
pm2 restart server             # Thử restart
```

### 3. Restart liên tục (>100 lần trong vài phút):
```bash
pm2 logs server --lines 100   # Xem lỗi
pm2 stop server                # Dừng lại đã
# Fix lỗi trong code
pm2 start server               # Chạy lại
```

### 4. Không biết làm gì:
```bash
pm2 logs --lines 200 > pm2_logs.txt
```
Gửi file `pm2_logs.txt` cho dev để check.

---

## Tips

1. **Mở CMD/PowerShell ở đúng folder:**
   ```bash
   cd C:\Users\Administrator\Desktop\crap_dev
   ```

2. **Xem log liên tục (real-time):**
   ```bash
   pm2 logs
   ```
   Nhấn `Ctrl+C` để thoát.

3. **Xem log rồi thoát ngay:**
   ```bash
   pm2 logs --lines 50 --nostream
   ```

4. **Lưu log ra file:**
   ```bash
   pm2 logs --lines 500 --nostream > logs.txt
   ```

---

*Cập nhật: 2026-05-03*
