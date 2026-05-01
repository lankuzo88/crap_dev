-- Feedback System Tables for ASIA LAB
-- Created: 2026-05-01

-- Bảng loại lỗi (admin tạo)
CREATE TABLE IF NOT EXISTS feedback_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL, -- 'hinh_the', 'mau_sac', 'don_hang', 'nha_khoa', 'khac'
  description TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- Bảng phản ánh
CREATE TABLE IF NOT EXISTS feedbacks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ma_dh TEXT NOT NULL,
  feedback_type_id INTEGER NOT NULL,
  description TEXT NOT NULL,
  severity TEXT DEFAULT 'medium', -- 'low', 'medium', 'high'
  status TEXT DEFAULT 'open', -- 'open', 'in_progress', 'resolved', 'closed'
  reported_by TEXT NOT NULL,
  assigned_to TEXT,
  resolved_at TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (feedback_type_id) REFERENCES feedback_types(id)
);

-- Index
CREATE INDEX IF NOT EXISTS idx_feedback_madh ON feedbacks(ma_dh);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedbacks(status);
CREATE INDEX IF NOT EXISTS idx_feedback_type ON feedbacks(feedback_type_id);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedbacks(created_at);

-- Seed data: Default feedback types
INSERT OR IGNORE INTO feedback_types (name, category, description) VALUES
  ('Màu sắc không đúng', 'mau_sac', 'Màu răng không khớp với mẫu yêu cầu'),
  ('Hình thể không chuẩn', 'hinh_the', 'Hình dạng răng không đúng theo yêu cầu'),
  ('Kích thước sai', 'hinh_the', 'Kích thước răng không phù hợp'),
  ('Bề mặt không mịn', 'hinh_the', 'Bề mặt răng không đạt độ mịn yêu cầu'),
  ('Thông tin đơn hàng sai', 'don_hang', 'Thông tin trên đơn hàng không chính xác'),
  ('Giao hàng trễ', 'don_hang', 'Đơn hàng giao không đúng thời gian cam kết'),
  ('Thiếu phụ kiện', 'don_hang', 'Thiếu các phụ kiện đi kèm'),
  ('Yêu cầu khác', 'khac', 'Các yêu cầu khác không thuộc danh mục trên');
