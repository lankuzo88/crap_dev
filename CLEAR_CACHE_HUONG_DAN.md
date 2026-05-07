# HƯỚNG DẪN: Clear Cache để thấy tên KTV

## ✅ Code đã được fix và deploy

Tên KTV (👤 Tuấn, 👤 Văn Huyến, etc.) đã được thêm vào mobile dashboard.

**Vấn đề:** Browser đang cache file cũ, nên không thấy tên KTV.

---

## 🔧 Cách fix (chọn 1 trong 3):

### **Cách 1: Hard Refresh (Nhanh nhất)**

**Trên Chrome/Edge:**
- Nhấn `Ctrl + Shift + R` (Windows)
- Hoặc `Ctrl + F5`

**Trên Firefox:**
- Nhấn `Ctrl + Shift + R`

**Trên Safari:**
- Nhấn `Cmd + Shift + R` (Mac)

---

### **Cách 2: Clear Cache trong Settings**

**Chrome/Edge:**
1. Nhấn `F12` để mở DevTools
2. Click chuột phải vào nút Refresh (↻)
3. Chọn **"Empty Cache and Hard Reload"**

**Hoặc:**
1. Vào Settings (⋮) → More tools → Clear browsing data
2. Chọn **"Cached images and files"**
3. Time range: **Last hour**
4. Click **Clear data**

---

### **Cách 3: Incognito/Private Mode**

1. Mở cửa sổ Incognito (Ctrl + Shift + N)
2. Vào http://localhost:3000/mobile
3. Đăng nhập lại
4. Sẽ thấy tên KTV ngay

---

## ✅ Sau khi clear cache, bạn sẽ thấy:

```
┌─────────────────────────────┐
│ 262704030                   │
│ LA-Nk BS Thuy               │
│ Trần T Ngon        SL: 3    │
│ Răng sứ Zirconia...         │
│ 👤 Tuấn              ← Tên KTV
│ ●●●○○                       │
└─────────────────────────────┘
```

---

## 🔍 Kiểm tra xem đã fix chưa:

1. Sau khi clear cache, reload trang
2. Mở F12 → Console
3. Gõ: `document.body.innerHTML.includes('currentKtv')`
4. Nếu trả về `true` → đã load file mới ✅
5. Nếu trả về `false` → vẫn cache cũ, thử lại

---

## 📝 Technical Details:

**File đã sửa:** `dashboard_mobile_terracotta.html`
**Commit:** `3e4e28b` - fix: add KTV name display to mobile dashboard cards
**Server:** Đã restart và thêm no-cache headers
**Verified:** File có 2 lần xuất hiện "currentKtv" ✅

---

*Updated: 2026-05-03 16:45*
