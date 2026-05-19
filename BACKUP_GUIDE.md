# Hướng dẫn Sao lưu Dữ liệu — ASIA LAB

## Tại sao cần sao lưu?

GitHub chỉ lưu **source code**. Những thứ quan trọng nhất không có trên GitHub:

| File | Nội dung | Nếu mất |
|---|---|---|
| `labo_data.db` | Toàn bộ đơn hàng, lịch sử, stats KTV | Mất hết dữ liệu vĩnh viễn |
| `.env` | Credentials R2, tài khoản Labo scraper | Server không chạy được |
| `users.json` | Tài khoản & phân quyền | Mất thông tin user |
| `labo_config.json` | Trạng thái scraper | Scraper chạy lại từ đầu |
| `keylab_state.json` | Counter file export | Đặt tên file export bị reset |
| Excel mới nhất | File Keylab export gốc | Cần export lại |

---

## Cách sử dụng tính năng Sao lưu

### Yêu cầu

- **Trình duyệt**: Chrome hoặc Edge (phiên bản mới). Firefox và Safari không hỗ trợ.
- **Máy tính cá nhân**: Thực hiện trên máy của bạn, không phải trên server.
- Đăng nhập bằng tài khoản **admin**.

### Lần đầu cài đặt

1. Mở `https://asiakanban.com` trên máy cá nhân (Chrome/Edge).
2. Đăng nhập bằng tài khoản admin.
3. Vào **Admin Dashboard** → tab **💾 Sao lưu**.
4. Bấm **"Chọn thư mục"** → chọn thư mục trên máy bạn.

   > **Mẹo:** Chọn thẳng vào thư mục trong OneDrive/Google Drive Desktop/Dropbox
   > nếu bạn đã cài — file sẽ tự lên cloud luôn sau khi sync.

5. Bấm **"Đồng bộ ngay"** — trình duyệt sẽ tải từng file từ server về máy bạn.
6. Xong. Trình duyệt nhớ thư mục đã chọn cho lần sau.

### Sử dụng hàng ngày

- Mỗi lần làm việc, vào tab **💾 Sao lưu** → bấm **"Đồng bộ ngay"**.
- Cột **Trạng thái** cho biết file nào có bản mới chưa được sao lưu.
- Không cần chọn lại thư mục — trình duyệt đã nhớ.

> Nên sync ít nhất **1 lần/ngày** sau khi có đơn hàng mới.

---

## Phục hồi khi server sập

Kịch bản: VPS hỏng, cần dựng lại trên server mới.

### Bước 1 — Chuẩn bị server mới

```powershell
# Cài Node.js 18+, Python 3.x, Git, PM2
npm install -g pm2
```

### Bước 2 — Lấy source code

```powershell
git clone https://github.com/lankuzo88/crap_dev.git
cd crap_dev
npm install
pip install -r requirements.txt
```

### Bước 3 — Restore dữ liệu từ backup

Copy các file sau từ thư mục backup vào thư mục project:

```
labo_data.db        → crap_dev/labo_data.db
.env                → crap_dev/.env
users.json          → crap_dev/users.json
labo_config.json    → crap_dev/labo_config.json
keylab_state.json   → crap_dev/keylab_state.json
*.xlsx (Excel)      → crap_dev/Excel/
```

### Bước 4 — Khởi động

```powershell
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### Bước 5 — Verify

Truy cập `http://localhost:3000/status` kiểm tra server đã nhận dữ liệu.

---

## Lưu ý kỹ thuật

- **DB backup an toàn**: Server dùng `better-sqlite3 db.backup()` tạo hot backup trước khi stream — không bao giờ copy file DB đang bị ghi.
- **Thư mục được nhớ trong IndexedDB** của trình duyệt — xóa browser data sẽ mất liên kết, cần chọn lại thư mục (file backup cũ vẫn còn nguyên).
- **Sao lưu chỉ chạy khi bạn mở tab** — không phải background sync tự động. Cần thao tác thủ công mỗi lần.
- File `.env` chứa credentials nhạy cảm — đảm bảo thư mục backup được bảo vệ (không share public).

---

## Files KHÔNG cần backup (có thể tự tạo lại)

| File/Thư mục | Cách tạo lại |
|---|---|
| `node_modules/` | `npm install` |
| `Data/`, `File_sach/` | Chạy lại scraper |
| `Data_thang/` | Reconstruct từ `labo_data.db` |
| `uploads/error-images/` | Ảnh đã lưu trên Cloudflare R2 |
| Source code | `git clone` từ GitHub |
