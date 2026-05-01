-- Analytics Tables for ASIA LAB Dashboard
-- Created: 2026-05-01

-- Bảng tổng hợp theo ngày
CREATE TABLE IF NOT EXISTS analytics_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  total_orders INTEGER DEFAULT 0,
  completed_orders INTEGER DEFAULT 0,
  zirc_count INTEGER DEFAULT 0,
  kl_count INTEGER DEFAULT 0,
  vnr_count INTEGER DEFAULT 0,
  hon_count INTEGER DEFAULT 0,
  avg_completion_time REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- Bảng hiệu suất KTV
CREATE TABLE IF NOT EXISTS ktv_performance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  ktv_name TEXT NOT NULL,
  stage TEXT NOT NULL,
  orders_completed INTEGER DEFAULT 0,
  avg_time_hours REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(date, ktv_name, stage)
);

-- Index cho query nhanh
CREATE INDEX IF NOT EXISTS idx_analytics_date ON analytics_daily(date);
CREATE INDEX IF NOT EXISTS idx_ktv_perf_date ON ktv_performance(date, ktv_name);
CREATE INDEX IF NOT EXISTS idx_ktv_perf_stage ON ktv_performance(stage);
