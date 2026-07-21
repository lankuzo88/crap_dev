'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'keylab_sql_progress_exporter.ps1');
const FIXTURE = path.join(__dirname, 'fixtures', 'keylab-progress-rows.json');

function runFixture() {
  const stdout = execFileSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT,
    '-FixturePath', FIXTURE, '-DryRun',
  ], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  return JSON.parse(stdout);
}

test('KeyLab SQL progress exporter maps stage staff and timestamps to the existing JSON contract', () => {
  const payload = runFixture();
  const cbm = payload.rows.find(row => row.cong_doan === 'CBM');
  const mai = payload.rows.find(row => row.cong_doan === 'MÀI');

  assert.equal(payload.source, 'keylab_sql');
  assert.equal(payload.orders, 1);
  assert.deepEqual(cbm, {
    ma_dh: 'DH-KEYLAB-1',
    thu_tu: 1,
    cong_doan: 'CBM',
    ten_ktv: 'Võ Văn Vạn',
    xac_nhan: 'Có',
    thoi_gian_hoan_thanh: '18/07/2026 10:30:52',
    raw_row_text: 'Răng sứ Zircornia SL:3 Rang:45-47, Làm mới',
    tai_khoan_cao: 'keylab_sql',
    barcode_labo: '',
  });
  assert.equal(mai.ten_ktv, '-');
  assert.equal(mai.xac_nhan, 'Chưa');
  assert.equal(mai.thoi_gian_hoan_thanh, '');
});

test('KeyLab SQL progress exporter keeps a completed product stage when another product is still waiting', () => {
  const payload = runFixture();
  const dap = payload.rows.find(row => row.cong_doan === 'ĐẮP');

  assert.equal(dap.ten_ktv, 'Yến Vy');
  assert.equal(dap.xac_nhan, 'Có');
  assert.equal(dap.thoi_gian_hoan_thanh, '19/07/2026 13:06:54');
  assert.match(dap.raw_row_text, /^Răng sứ Zircornia/);
});

test('KeyLab progress integration is parameterized, atomic and SQL-only', () => {
  const exporter = fs.readFileSync(SCRIPT, 'utf8');
  const runner = fs.readFileSync(path.join(ROOT, 'run_keylab_sync.py'), 'utf8');
  const daemon = fs.readFileSync(path.join(ROOT, 'auto_scrape_headless.py'), 'utf8');

  assert.match(exporter, /@TuNgay=@TuNgay/);
  assert.match(exporter, /@idonhang=@idonhang/);
  assert.match(exporter, /WriteAllText\(\$tempPath/);
  assert.match(exporter, /Move-Item -LiteralPath \$tempPath/);
  assert.doesNotMatch(exporter, /Password\s*=/i);
  assert.match(runner, /keylab_sql_progress_exporter\.ps1/);
  assert.match(runner, /import_json\(str\(json_out\)\)/);
  assert.match(daemon, /run_keylab_sync\.py/);
  assert.doesNotMatch(daemon, /PROGRESS_SOURCE|run_scrape\.py|source == ['"]web['"]/);
});

test('KeyLab Excel export and direct progress sync both use a five-minute cycle', () => {
  const daemon = fs.readFileSync(path.join(ROOT, 'auto_scrape_headless.py'), 'utf8');
  const statusRoute = fs.readFileSync(path.join(ROOT, 'src', 'routes', 'keylab.routes.js'), 'utf8');

  assert.match(daemon, /^INTERVAL_MINUTES = 5$/m);
  assert.match(daemon, /^KEYLAB_EXPORT_INTERVAL_MINUTES = 5$/m);
  assert.match(daemon, /cycle_started = time\.monotonic\(\)/);
  assert.match(daemon, /remaining_seconds = max\(0, INTERVAL_MINUTES \* 60 - elapsed_seconds\)/);
  assert.match(daemon, /export_started_at = vietnam_now\(\)/);
  assert.match(daemon, /update_last_keylab_export\(saved_file, export_started_at\)/);
  assert.match(statusRoute, /intervalMinutes: 5/);
  assert.match(statusRoute, /mode: 'keylab_sql_only'/);
  assert.doesNotMatch(statusRoute, /hourly KeyLab SQL export|export 60 phut/);
});

test('KeyLab SQL progress exporter fails closed and preserves the previous output', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keylab-progress-'));
  const orderIds = path.join(tempDir, 'orders.json');
  const output = path.join(tempDir, 'progress.json');
  fs.writeFileSync(orderIds, JSON.stringify(['MISSING-ORDER']), 'utf8');
  fs.writeFileSync(output, 'previous-good-data', 'utf8');

  assert.throws(() => execFileSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT,
    '-FixturePath', FIXTURE, '-OrderIdsFile', orderIds, '-OutFile', output,
  ], { cwd: ROOT, encoding: 'utf8', windowsHide: true, stdio: 'pipe' }));
  assert.equal(fs.readFileSync(output, 'utf8'), 'previous-good-data');
  fs.rmSync(tempDir, { recursive: true, force: true });
});
