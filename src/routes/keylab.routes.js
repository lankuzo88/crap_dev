'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { BASE_DIR } = require('../config/paths');

const router = express.Router();
const CONFIG_PATH = path.join(BASE_DIR, 'labo_config.json');
const LOCK_PATH = path.join(BASE_DIR, 'scrape_pipeline.lock');

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function getKeylabStatus() {
  const config = readJson(CONFIG_PATH);
  const lock = readJson(LOCK_PATH);
  return {
    enabled: true,
    running: Boolean(lock.startedAt),
    currentFile: lock.file || null,
    lastExportAt: config.last_keylab_sql_export_at || null,
    lastExportFile: config.last_keylab_sql_export_file || null,
    lastRunFile: config.last_run_file || null,
    nextRun: 'KeyLab SQL export và tiến độ mỗi 5 phút',
    mode: 'keylab_sql_only',
  };
}

router.get('/api/keylab-sync/status', requireAuth, (req, res) => {
  res.json(getKeylabStatus());
});

// Backward-compatible status path used by older admin clients.
router.get('/api/auto-scrape/status', requireAuth, (req, res) => {
  res.json(getKeylabStatus());
});

router.get('/keylab-health', requireAuth, (req, res) => {
  const requiredFiles = [
    'keylab_sql_exporter.ps1',
    'keylab_sql_progress_exporter.ps1',
    'keylab_sql_notes_scraper.ps1',
    'run_keylab_sync.py',
  ];
  const missing = requiredFiles.filter(file => !fs.existsSync(path.join(BASE_DIR, file)));
  res.status(missing.length ? 503 : 200).json({
    ok: missing.length === 0,
    mode: 'keylab_sql_only',
    intervalMinutes: 5,
    missing,
  });
});

router.post('/keylab-export-now', requirePermission('admin.keylab_export'), (req, res) => {
  res.status(410).json({
    ok: false,
    message: 'Manual KeyLab refresh is disabled. SQL sync runs automatically every 5 minutes.',
  });
});

module.exports = router;
