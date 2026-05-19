'use strict';
const fsNode  = require('fs');
const { spawn } = require('child_process');
const pathMod = require('path');
const { BASE_DIR, EXCEL_DIR } = require('../config/paths');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

// Python executable
const PYTHON = (() => {
  const candidates = [
    'C:\\Users\\Administrator\\AppData\\Local\\Python\\bin\\python.exe',
    'C:\\Python312\\python.exe',
    'C:\\Python311\\python.exe',
    'python',
  ];
  return candidates.find(p => p === 'python' || fsNode.existsSync(p)) || 'python';
})();

// Scrape state
let scrapeJob = { running: false, file: null, log: [], exitCode: null, startedAt: null };
const scrapeQueue = [];

// Keylab export state
let keylabExportJob = { running: false, startedAt: null, exitCode: null, savedFile: null };

// Track files uploaded via web UI (so watcher/scraper doesn't double-process)
const webUploadFiles    = new Set();
const manualKeyLabExports = new Set();

const KEYLAB_FILE_RE = /^\d{8}_\d+\.(xls|xlsx|xlsm)$/i;
const KEYLAB_STATE_FILE = pathMod.join(BASE_DIR, 'keylab_state.json');

// Cache reset callback — injected by orders.repo to break circular dep
let _resetCache  = () => {};
let _closeDB     = () => {};
let _autoClose   = () => {};

function setResetCallback(fn)     { _resetCache = fn; }
function setCloseDBCallback(fn)   { _closeDB = fn; }
function setAutoCloseCallback(fn) { _autoClose = fn; }

function getScrapeJob()     { return scrapeJob; }
function getKeylabJob()     { return keylabExportJob; }
function getScrapeQueue()   { return scrapeQueue; }
function getWebUploadFiles(){ return webUploadFiles; }

function findLatestExcel() {
  try {
    if (!fsNode.existsSync(EXCEL_DIR)) return null;
    const exts = ['.xls', '.xlsx', '.xlsm'];
    const files = fsNode.readdirSync(EXCEL_DIR)
      .filter(f => exts.some(e => f.toLowerCase().endsWith(e)))
      .map(f => ({ name: f, path: pathMod.join(EXCEL_DIR, f), mtime: fsNode.statSync(pathMod.join(EXCEL_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    return files.length ? files[0] : null;
  } catch { return null; }
}

function finishScraper(code) {
  scrapeJob.running = false;
  scrapeJob.exitCode = code;
  _resetCache();
  _autoClose();
  _closeDB();
  log(`🏁 Scraper pipeline done: ${scrapeJob.file}, exit=${code}`);
  if (scrapeQueue.length > 0) {
    const next = scrapeQueue.shift();
    log(`📋 Xử lý tiếp từ hàng chờ: ${pathMod.basename(next)} (còn lại: ${scrapeQueue.length})`);
    setTimeout(() => spawnScraper(next), 1000);
  }
}

function spawnScraper(filePath) {
  scrapeJob = {
    running: true,
    file: pathMod.basename(filePath),
    log: [],
    exitCode: null,
    startedAt: new Date().toISOString(),
    progress: { done: 0, failed: 0, total: 0 },
  };
  log(`🚀 Bắt đầu cào: ${scrapeJob.file}`);

  const proc = spawn(PYTHON, ['run_scrape.py', filePath], {
    cwd: BASE_DIR,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PLAYWRIGHT_BROWSERS_PATH: 'C:\\Users\\Administrator\\AppData\\Local\\ms-playwright',
    },
    windowsHide: true,
  });

  const pushLog = (chunk) => {
    const lines = chunk.toString('utf-8').split('\n').filter(l => l.trim());
    lines.forEach(l => {
      if (l.includes('OK') && l.includes(':'))        scrapeJob.progress.done++;
      else if (l.includes('FAIL') && l.includes(':')) scrapeJob.progress.failed++;
      else if (l.match(/Tổng \d+ đơn hàng/)) {
        const m = l.match(/Tổng (\d+) đơn/);
        if (m) scrapeJob.progress.total = parseInt(m[1]);
      }
    });
    scrapeJob.log.push(...lines);
    if (scrapeJob.log.length > 300) scrapeJob.log = scrapeJob.log.slice(-300);
  };

  proc.stdout.on('data', pushLog);
  proc.stderr.on('data', pushLog);
  proc.on('error', err => {
    scrapeJob.running = false;
    scrapeJob.exitCode = -1;
    scrapeJob.log.push(`[spawn error] ${err.message}`);
    log(`❌ Scraper spawn error: ${err.message}`);
  });
  proc.on('close', code => {
    log(`🏁 Scraper done: ${scrapeJob.file}, exit=${code}`);
    finishScraper(code);
  });
}

function queueOrScrape(filePath) {
  const filename = pathMod.basename(filePath);
  if (scrapeJob.running) {
    if (!scrapeQueue.some(f => pathMod.basename(f) === filename)) {
      scrapeQueue.push(filePath);
      log(`📋 Xếp hàng: ${filename} (hàng chờ: ${scrapeQueue.length})`);
    }
  } else {
    spawnScraper(filePath);
  }
}

function autoScrape() {
  if (scrapeJob.running) {
    log(`⏳ Auto-scrape skipped (scraper đang chạy: ${scrapeJob.file})`);
    return;
  }
  const latest = findLatestExcel();
  if (!latest) { log(`⚠ Auto-scrape: không tìm thấy file Excel trong ${EXCEL_DIR}`); return; }
  log(`🔄 Auto-scrape: ${latest.name}`);
  spawnScraper(latest.path);
}

function checkKeylabHealth() {
  const script = pathMod.join(BASE_DIR, 'keylab_sql_exporter.ps1');
  if (!fsNode.existsSync(script)) {
    return Promise.resolve({ ok: false, message: 'Khong tim thay keylab_sql_exporter.ps1' });
  }
  return Promise.resolve({ ok: true, message: 'KeyLab SQL export san sang (khong can mo app KeyLab)' });
}

function loadKeylabExportState() {
  const today = new Date().toLocaleDateString('vi-VN');
  try {
    const state = JSON.parse(fsNode.readFileSync(KEYLAB_STATE_FILE, 'utf8'));
    if (state.date === today && Number.isFinite(Number(state.export_count))) return state;
  } catch {}
  return { date: today, export_count: 1 };
}

function saveKeylabExportState(state) {
  fsNode.writeFileSync(KEYLAB_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function nextKeylabSqlExportPath(state) {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return pathMod.join(EXCEL_DIR, `${dd}${mm}${yyyy}_${state.export_count}.xlsx`);
}

function spawnKeylabExport() {
  keylabExportJob = { running: true, startedAt: new Date().toISOString(), exitCode: null, savedFile: null };
  log('Keylab SQL export triggered manually');

  const state = loadKeylabExportState();
  const outFile = nextKeylabSqlExportPath(state);
  const filename = pathMod.basename(outFile);
  manualKeyLabExports.add(filename);

  const proc = spawn('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    pathMod.join(BASE_DIR, 'keylab_sql_exporter.ps1'),
    '-OutFile',
    outFile,
  ], {
    cwd: BASE_DIR,
    env: { ...process.env },
    windowsHide: true,
  });

  let stdout = '';
  proc.stdout.on('data', d => {
    const chunk = d.toString();
    stdout += chunk;
    chunk.split('\n').filter(Boolean).forEach(l => log(`[keylab] ${l}`));
  });
  proc.stderr.on('data', d => {
    d.toString().split('\n').filter(Boolean).forEach(l => log(`[keylab] ${l}`));
  });
  proc.on('error', err => {
    keylabExportJob.running = false;
    keylabExportJob.exitCode = -1;
    manualKeyLabExports.delete(filename);
    log(`[keylab] spawn error: ${err.message}`);
  });
  proc.on('close', code => {
    keylabExportJob.running = false;
    keylabExportJob.exitCode = code;
    const match = stdout.match(/SAVED:(.+)/);
    if (match) {
      keylabExportJob.savedFile = match[1].trim();
      state.export_count += 1;
      saveKeylabExportState(state);
      log(`[keylab] Marked for scrape: ${filename}`);
    } else {
      manualKeyLabExports.delete(filename);
    }
    log(`[keylab] done (exit=${code})${keylabExportJob.savedFile ? ' → ' + keylabExportJob.savedFile : ''}`);
  });
}

async function waitForFileStable(filePath, filename, timeoutMs = 2000) {
  const startTime = Date.now();
  let lastSize = -1;
  let stableCount = 0;
  const requiredStableChecks = 4;

  while (Date.now() - startTime < timeoutMs + 2000) {
    if (!fsNode.existsSync(filePath)) throw new Error('File disappeared during stability check');
    const stat = fsNode.statSync(filePath);
    const currentSize = stat.size;
    if (currentSize === lastSize && currentSize > 0) {
      stableCount++;
      if (stableCount >= requiredStableChecks) {
        log(`  ✓ File stable: ${filename} (${currentSize} bytes)`);
        return;
      }
    } else {
      stableCount = 0;
      lastSize = currentSize;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timeout waiting for file stability (last size: ${lastSize})`);
}

function startExcelWatcher() {
  if (!fsNode.existsSync(EXCEL_DIR)) return;
  const existing = new Set(fsNode.readdirSync(EXCEL_DIR));
  const pending  = new Map();

  fsNode.watch(EXCEL_DIR, (eventType, filename) => {
    if (!filename) return;
    const ext = pathMod.extname(filename).toLowerCase();
    if (!['.xlsx', '.xls', '.xlsm'].includes(ext)) return;
    if (existing.has(filename)) return;
    existing.add(filename);
    if (webUploadFiles.has(filename)) return;
    const isKeyLabFile = KEYLAB_FILE_RE.test(filename);
    if (isKeyLabFile && !manualKeyLabExports.has(filename)) {
      log(`⏭  Skip auto-export Keylab file: ${filename}`);
      return;
    }
    if (isKeyLabFile && manualKeyLabExports.has(filename)) manualKeyLabExports.delete(filename);

    if (pending.has(filename)) clearTimeout(pending.get(filename));
    pending.set(filename, setTimeout(() => {
      pending.delete(filename);
      const filePath = pathMod.join(EXCEL_DIR, filename);
      waitForFileStable(filePath, filename).then(() => queueOrScrape(filePath)).catch(e => log(`⚠ ${e.message}`));
    }, 3000));
  });
  log(`👀 Watching: ${EXCEL_DIR}`);
}

module.exports = {
  PYTHON,
  scrapeQueue,
  webUploadFiles,
  manualKeyLabExports,
  KEYLAB_FILE_RE,
  getScrapeJob,
  getKeylabJob,
  getScrapeQueue,
  getWebUploadFiles,
  setResetCallback,
  setCloseDBCallback,
  setAutoCloseCallback,
  spawnScraper,
  queueOrScrape,
  autoScrape,
  findLatestExcel,
  checkKeylabHealth,
  spawnKeylabExport,
  waitForFileStable,
  startExcelWatcher,
};
