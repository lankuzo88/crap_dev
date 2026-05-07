# ASIA LAB — Quy tắc cho Claude

## PM2
- Chỉ dùng `pm2 restart <tên>` — **KHÔNG BAO GIỜ** dùng `pm2 start` thêm process mới
- Hai process duy nhất: `asia-lab-server` (server Node.js) và `auto-scrape` (scraper Python)
- Kiểm tra trạng thái: `pm2 list` hoặc `pm2 status`

## Worktree & Deployment
- Sau khi merge vào `main`, git post-merge hook tự động `pm2 restart asia-lab-server` — không cần restart tay
- Làm việc trên feature branch, merge vào `main` khi hoàn chỉnh
- Hook nằm tại `.git/hooks/post-merge` (không track bởi git)

## Production
- Server đang chạy live — mọi thay đổi phải thận trọng
- Không sửa trực tiếp trên `main` — dùng worktree hoặc branch riêng
- Kiểm tra log trước/sau khi deploy: `pm2 logs asia-lab-server --lines 50`

## Database
- SQLite với WAL mode — file: `labo_data.db`, WAL: `labo_data.db-wal`, SHM: `labo_data.db-shm`
- Checkpoint tự động mỗi 30 phút — **không xóa file WAL hoặc SHM thủ công**
- Backup trước khi chạy migration hay thay đổi schema

## Git
- Branch chính: `main`
- Feature branch: tạo từ `main`, merge lại khi xong
- Worktree Claude nằm tại `.claude/worktrees/` — không cần dọn tay
