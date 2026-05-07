# Test User Access - Checklist

## Vấn đề cần xác định:

**User:** `minhtuan` (role: `user`)

### Câu hỏi:
1. User `minhtuan` có đăng nhập được không?
2. Sau khi đăng nhập, user thấy gì?
   - [ ] Trang trống
   - [ ] Dashboard nhưng không có dữ liệu
   - [ ] Dashboard có dữ liệu nhưng không thấy tên KTV
   - [ ] Bị redirect về login
   - [ ] Lỗi khác

3. Nếu vào `/mobile`, user thấy gì?

4. Nếu mở browser console (F12), có lỗi gì không?

---

## Đã fix:

✅ **Commit 3e4e28b:** Thêm hiển thị tên KTV trên mobile dashboard cards
- Tên KTV hiện với icon 👤
- Lấy từ stage hiện tại (stagesData)

---

## Cần test:

1. Đăng nhập với `minhtuan / 123456789`
2. Vào http://localhost:3000/mobile
3. Kiểm tra xem có thấy:
   - Danh sách đơn hàng
   - Tên KTV trên mỗi card (👤 Tuấn, 👤 Văn Huyến, etc.)

---

## Debug steps:

### 1. Check session:
```bash
# Xem sessions hiện tại
node -e "const s=require('./sessions.json'); Object.values(s).forEach(x=>console.log(x.user, x.role))"
```

### 2. Check data API:
```bash
# Test với admin session
curl -H "Cookie: sid=YOUR_ADMIN_TOKEN" http://localhost:3000/data.json | head -100
```

### 3. Check browser console:
- Mở F12 → Console
- Xem có lỗi fetch /data.json không
- Xem có lỗi JavaScript không

---

*Created: 2026-05-03 16:40*
