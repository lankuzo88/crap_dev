/**
 * ASIA LAB — Dashboard Server v2
 * Đọc: File_sach/ (Excel sạch mới nhất) + Data/ (JSON tiến độ)
 *
 * Cách chạy:
 *   cd C:\Users\...\Desktop\crap
 *   npm install express xlsx
 *   node server.js
 *
 * Mở browser: http://localhost:3000
 */

const express = require('express');
const XLSX    = require('xlsx');
const path    = require('path');
const fs      = require('fs');
const https   = require('https');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── ANTHROPIC AI ──────────────────────────────────────
const AI_API_KEY  = 'sk-7df540121d72d9bbe64730c4c96f4db488492620644269c88ca817225496839a';
const AI_BASE_URL = 'http://pro-x.io.vn';
const AI_MODEL    = 'claude-sonnet-4-6';
const AI_MAX_TOKENS = 1024;

async function anthropicChat(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:       AI_MODEL,
      max_tokens:  AI_MAX_TOKENS,
      messages:    [{ role: 'user', content: prompt }],
    });
    const url = new URL(`${AI_BASE_URL}/v1/messages`);
    const opts = {
      hostname: url.hostname,
      port:     url.port || 443,
      path:     url.pathname,
      method:   'POST',
      headers:  {
        'Content-Type':        'application/json',
        'x-api-key':           AI_API_KEY,
        'anthropic-version':   '2023-06-01',
        'Content-Length':      Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          // Sonnet 4: content = [{type:"text",text:"..."}] hoặc [{type:"thinking",...}, {type:"text",text:"..."}]
          const textBlock = parsed.content?.find(b => b.type === 'text');
          const answer = textBlock?.text || parsed.content?.[0]?.text || parsed.content?.[0]?.content || 'Không có phản hồi từ AI';
          resolve(answer);
        } catch (e) {
          reject(new Error(`Parse error: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const SYSTEM_PROMPT = `Bạn là một Giám đốc Sản xuất / Nhà Phân tích Sản xuất
chuyên nghiệp trong ngành Labo Nha khoa. Bạn có kiến thức sâu về:

- 5 công đoạn: CBM → SÁP → SƯỜN → ĐẮP → MÀI
- Đơn Sửa/Làm tiếp: skip 3 công đoạn đầu (CBM, SÁP, SƯỜN)
- Đơn Thử sườn (TS): skip 2 công đoạn cuối (ĐẮP, MÀI)
- Thời gian chuẩn: răng sứ ~2-5 ngày, zirconia ~3-7 ngày
- Deadline trong 'gc' = giờ phải xong để gửi gia công ngoài
- Mỗi KTV có năng lực khác nhau, cần theo dõi để phân công tối ưu

KHI PHÂN TÍCH:
1. Nhận diện đơn có deadline nguy hiển (gc sớm hơn bình thường)
2. Phát hiện đơn đang chờ quá lâu ở 1 công đoạn
3. Cảnh báo đơn có nguy cơ trễ deadline
4. Gợi ý ưu tiên sản xuất hợp lý

KHI HỎI NGƯỜI DÙNG:
- Đặt câu hỏi cụ thể về bất thường bạn nhận thấy
- Ví dụ: "Đơn X có deadline 15H hôm nay nhưng vẫn đang ở công đoạn ĐẮP — bạn có biết tình trạng không?"
- Không hỏi chung chung, luôn đi kèm dữ liệu cụ thể

TRẢ LỜI NGẮN GỌN, DỄ ĐỌC, DÙNG TIẾNG VIỆT CÓ DẤU.`;

// ── CẤU HÌNH ĐƯỜNG DẪN ───────────────────────────────
// server.js đặt trong thư mục crap/
// → tự động tìm File_sach/ và Data/ cùng cấp
const BASE_DIR      = __dirname;
const FILE_SACH_DIR = path.join(BASE_DIR, 'File_sach');
const DATA_DIR      = path.join(BASE_DIR, 'Data');
const DASHBOARD     = path.join(BASE_DIR, 'dashboard.html');

const STAGE_NAMES = ['CBM', 'SÁP/Cadcam', 'SƯỜN', 'ĐẮP', 'MÀI'];

// Công đoạn bị bỏ qua theo loại đơn (0-indexed)
// - "Sửa" / "Làm tiếp" → bỏ CBM(0), SÁP(1), SƯỜN(2) → chỉ còn ĐẮP(3), MÀI(4) = 2 stage
// - "TS" / "Thử sườn" trong ghi chú → bỏ ĐẮP(3), MÀI(4) → chỉ còn CBM(0), SÁP(1), SƯỜN(2) = 3 stage
const SKIP_STAGES = {
  sua_laitiep: [0, 1, 2],  // CBM, SÁP, SƯỜN
  thusuon:     [3, 4],     // ĐẮP, MÀI
};

function getSkipStages(lk, gc) {
  const lkLower = (lk || '').toLowerCase();
  const gcLower = (gc || '').toLowerCase();
  if (lkLower.includes('sửa') || lkLower.includes('làm tiếp')) {
    return SKIP_STAGES.sua_laitiep;
  }
  if (gcLower.includes('ts') || gcLower.includes('thử sườn')) {
    return SKIP_STAGES.thusuon;
  }
  return [];
}

// ── CACHE ─────────────────────────────────────────────
let cache     = null;
let cacheKey  = '';
let cacheTime = 0;
const TTL     = 60_000; // 1 phút

// ── UTILS ─────────────────────────────────────────────
const str   = v => (v != null) ? String(v).trim() : '';
const log   = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

function parseDate(val) {
  if (!val) return '';
  if (val instanceof Date && !isNaN(val)) {
    const p = n => String(n).padStart(2, '0');
    return `${val.getFullYear()}-${p(val.getMonth()+1)}-${p(val.getDate())} ${p(val.getHours())}:${p(val.getMinutes())}:${p(val.getSeconds())}`;
  }
  if (typeof val === 'number') {
    try {
      const d = XLSX.SSF.parse_date_code(val);
      if (d) {
        const p = n => String(n).padStart(2, '0');
        return `${d.y}-${p(d.m)}-${p(d.d)} ${p(d.H)}:${p(d.M)}:${p(d.S)}`;
      }
    } catch {}
  }
  return String(val);
}

// ── TÌM FILE MỚI NHẤT ─────────────────────────────────
function findLatest(dir, exts) {
  try {
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir)
      .filter(f => exts.some(ext => f.toLowerCase().endsWith(ext)))
      .map(f => ({ name: f, path: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    return files.length ? files[0] : null;
  } catch (e) {
    log(`Lỗi đọc thư mục ${dir}: ${e.message}`);
    return null;
  }
}

// ── ĐỌC FILE EXCEL (File_sach) ─────────────────────────
function readExcel(filePath) {
  log(`Đọc Excel: ${path.basename(filePath)}`);
  const wb = XLSX.readFile(filePath, { cellDates: true, dateNF: 'yyyy-mm-dd hh:mm:ss' });

  // Tìm sheet theo từ khóa
  const getSheet = (...keys) => {
    const name = wb.SheetNames.find(n => keys.some(k => n.toLowerCase().includes(k.toLowerCase())));
    return name ? XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }) : null;
  };

  // ── Sheet "Đơn hàng" ──────────────────────────────
  const raw1 = getSheet('Đơn hàng', 'Don hang', 'don_hang', 'order');
  if (!raw1) throw new Error('Không tìm thấy sheet "Đơn hàng"');

  const h1  = raw1[0].map(h => str(h));
  const c1  = keyword => h1.findIndex(h => h.includes(keyword));

  const i = {
    ma:   c1('Mã ĐH'),
    nhan: c1('Nhận'),
    ht:   c1('hoàn thành'),
    giao: c1('giao'),
    kh:   c1('Khách'),
    bn:   c1('ệnh nhân'),
    ph:   c1('Phục hình'),
    sl:   c1('SL'),
    gc:   c1('Ghi chú'),
  };

  const orders = {};
  for (let r = 1; r < raw1.length; r++) {
    const row = raw1[r];
    const ma  = str(row[i.ma]);
    if (!ma || ma.includes('TỔNG') || ma === 'Mã ĐH') continue;
    const sl = parseInt(row[i.sl]) || 0;
    orders[ma] = {
      ma_dh:    ma,
      nhan:     parseDate(row[i.nhan]),
      yc_ht:    parseDate(row[i.ht]),
      yc_giao:  parseDate(row[i.giao]),
      kh:       str(row[i.kh]),
      bn:       str(row[i.bn]),
      ph:       str(row[i.ph]).replace(/\r\n/g, ' | '),
      sl:       sl,
      gc:       str(row[i.gc]),
    };
  }

  // ── Sheet "Tiến độ" ───────────────────────────────
  const raw2 = getSheet('Tiến độ', 'Tien do', 'tien_do', 'progress');
  const stageMap = {};

  if (raw2) {
    const h2 = raw2[0].map(h => str(h));
    const c2 = keyword => h2.findIndex(h => h.includes(keyword));
    const j = {
      ma:  c2('Mã ĐH'),
      cd:  c2('Công đoạn'),
      ktv: c2('KTV'),
      xn:  c2('Xác nhận'),
      tg:  c2('Thời gian'),
      lk:  c2('Loại lệnh'),
      tk:  c2('Tài khoản'),
    };

    for (let r = 1; r < raw2.length; r++) {
      const row = raw2[r];
      const ma  = str(row[j.ma]);
      if (!ma || ma === 'Mã ĐH') continue;
      const cd  = str(row[j.cd]);
      const ktv = str(row[j.ktv]).replace(/^-$/, '');
      const xn  = str(row[j.xn]) === 'Có';
      const tg  = parseDate(row[j.tg]).replace(/^-$/, '');
      const lk  = str(row[j.lk]);
      const tk  = str(row[j.tk]);
      if (!stageMap[ma]) stageMap[ma] = { lk: '', tk: '', stages: {} };
      if (lk) stageMap[ma].lk = lk;
      if (tk) stageMap[ma].tk = tk;
      stageMap[ma].stages[cd] = { ktv, xn, tg };
    }
  }

  return { orders, stageMap };
}

// ── ĐỌC JSON SCRAPER (Data/) ──────────────────────────
function readJsonScraper(filePath) {
  log(`Đọc JSON: ${path.basename(filePath)}`);
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const rows = Array.isArray(raw) ? raw : (raw.rows || raw.data || []);

  const stageMap = {};
  for (const row of rows) {
    const ma  = str(row.ma_dh);
    if (!ma) continue;
    const cd  = str(row.cong_doan);
    const ktv = str(row.ten_ktv);
    const xn  = str(row.xac_nhan) === 'Có';
    const tg  = str(row.thoi_gian_hoan_thanh).replace(/^-$/, '');
    const lk  = str(row.loai_lenh || row.raw_row_text?.split(',').pop()?.trim() || '');
    const tk  = str(row.tai_khoan_cao || row.tai_khoan || '');

    if (!stageMap[ma]) stageMap[ma] = { lk: '', tk: '', stages: {}, ph: '', sl: 0 };
    if (tk) stageMap[ma].tk = tk;

    // Parse ph và sl từ raw_row_text nếu có
    if (row.raw_row_text && !stageMap[ma].ph) {
      const txt = str(row.raw_row_text);
      const slM = txt.match(/SL:(\d+)/);
      const slIdx = txt.indexOf(' SL:');
      stageMap[ma].ph  = slIdx > 0 ? txt.substring(0, slIdx).trim() : '';
      stageMap[ma].sl  = slM ? parseInt(slM[1]) : 0;
      // Detect loai_lenh từ cuối string
      const lkM = txt.match(/,\s*(\S[^,]*)$/);
      if (lkM) stageMap[ma].lk = lkM[1].trim();
    }

    stageMap[ma].stages[cd] = { ktv, xn, tg };
  }
  return stageMap;
}

// ── MERGE & BUILD ORDERS ──────────────────────────────
function buildOrders(excelOrders, excelStageMap, jsonStageMap) {
  const result = [];

  // Tập hợp tất cả ma_dh
  const allIds = new Set([
    ...Object.keys(excelOrders),
    ...Object.keys(excelStageMap),
    ...Object.keys(jsonStageMap),
  ]);

  for (const ma of allIds) {
    const order  = excelOrders[ma] || {};
    // Ưu tiên JSON scraper (realtime) > Excel stage
    const sm     = jsonStageMap[ma]   || excelStageMap[ma] || { lk: '', tk: '', stages: {} };

    const gc      = order.gc || '';
    const skip    = getSkipStages(sm.lk, gc);
    const stages  = STAGE_NAMES.map((n, i) => {
      const sd = sm.stages[n] || { ktv: '', xn: false, tg: '' };
      return { n, k: sd.ktv, x: sd.xn, t: sd.tg, sk: skip.includes(i) };
    });

    const activeStages = stages.filter(s => !s.sk);
    const done   = activeStages.filter(s => s.x).length;
    const totalStages = activeStages.length;
    const pct   = totalStages > 0 ? Math.round(done / totalStages * 100) : 0;

    let curKtv   = '';
    for (let i = stages.indexOf(activeStages[activeStages.length - 1]); i >= 0; i--) {
      if (!stages[i].sk && stages[i].k) { curKtv = stages[i].k; break; }
    }
    let lastTg = '';
    stages.forEach(s => { if (s.t) lastTg = s.t; });

    result.push({
      ma_dh:    ma,
      nhan:     order.nhan     || '',
      yc_ht:    order.yc_ht   || '',
      yc_giao:  order.yc_giao || '',
      kh:       order.kh      || '',
      bn:       order.bn      || '',
      ph:       order.ph      || sm.ph || '',
      sl:       order.sl      || sm.sl || 0,
      gc:       order.gc      || '',
      lk:       sm.lk         || '',
      tk:       sm.tk         || 'lanhn',
      stages,
      done,
      total:    totalStages,
      pct:      totalStages > 0 ? Math.round(done / totalStages * 100) : 0,
      curKtv,
      lastTg,
    });
  }

  // Sắp xếp: có yc_giao trước, sau đó theo thời gian giao
  result.sort((a, b) => {
    if (a.yc_giao && !b.yc_giao) return -1;
    if (!a.yc_giao && b.yc_giao) return 1;
    return (a.yc_giao || '').localeCompare(b.yc_giao || '');
  });

  return result;
}

// ── LẤY DATA (cache) ──────────────────────────────────
function getData(forceReload = false) {
  const excelFile = findLatest(FILE_SACH_DIR, ['.xlsx', '.xls', '.xlsm']);
  const jsonFile  = findLatest(DATA_DIR, ['.json']);

  const key = `${excelFile?.mtime || 0}_${jsonFile?.mtime || 0}`;
  const age = Date.now() - cacheTime;

  if (!forceReload && cache && key === cacheKey && age < TTL) {
    return cache;
  }

  let excelOrders   = {};
  let excelStageMap = {};
  let jsonStageMap  = {};
  let srcExcel      = null;
  let srcJson       = null;

  if (excelFile) {
    try {
      const r = readExcel(excelFile.path);
      excelOrders   = r.orders;
      excelStageMap = r.stageMap;
      srcExcel      = excelFile.name;
    } catch (e) { log(`⚠ Excel: ${e.message}`); }
  }

  if (jsonFile) {
    try {
      jsonStageMap = readJsonScraper(jsonFile.path);
      srcJson      = jsonFile.name;
    } catch (e) { log(`⚠ JSON: ${e.message}`); }
  }

  const orders = buildOrders(excelOrders, excelStageMap, jsonStageMap);

  cache     = { source: { excel: srcExcel, json: srcJson }, orders };
  cacheKey  = key;
  cacheTime = Date.now();

  log(`✓ ${orders.length} đơn | Excel: ${srcExcel || '—'} | JSON: ${srcJson || '—'}`);
  return cache;
}

// ── ROUTES ────────────────────────────────────────────
app.get('/', (req, res) => {
  if (fs.existsSync(DASHBOARD)) {
    res.sendFile(DASHBOARD);
  } else {
    res.status(404).send(`<h2>Không tìm thấy dashboard.html</h2><p>Đặt file <b>dashboard.html</b> trong thư mục <b>crap/</b></p>`);
  }
});

app.get('/data.json', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');
  try {
    const data = getData();
    if (!data.orders.length && !data.source.excel && !data.source.json) {
      return res.status(404).json({
        error: 'Không tìm thấy dữ liệu',
        hint: `Kiểm tra thư mục File_sach/ (${FILE_SACH_DIR}) và Data/ (${DATA_DIR})`,
      });
    }
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/reload', (req, res) => {
  cache = null; cacheKey = ''; cacheTime = 0;
  try {
    const data = getData(true);
    res.json({ ok: true, orders: data.orders.length, source: data.source });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/status', (req, res) => {
  const excelFile = findLatest(FILE_SACH_DIR, ['.xlsx', '.xls', '.xlsm']);
  const jsonFile  = findLatest(DATA_DIR, ['.json']);
  res.json({
    status:         'online',
    time:           new Date().toLocaleString('vi-VN'),
    file_sach_dir:  FILE_SACH_DIR,
    data_dir:       DATA_DIR,
    latest_excel:   excelFile?.name || null,
    latest_json:    jsonFile?.name  || null,
    cached_orders:  cache?.orders?.length || 0,
    cache_age_s:    cacheTime ? Math.round((Date.now()-cacheTime)/1000) : null,
  });
});

// ── AI ANALYST ─────────────────────────────────────────

// Helper buildSummary — dùng chung cho cả insights lẫn chat
function buildSummary(orders) {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const urgent  = orders.filter(o => {
    if (!o.yc_giao) return false;
    const d = o.yc_giao.substring(0,10);
    const t = o.yc_giao.includes(':') ? o.yc_giao : '';
    if (d !== today) return false;
    if (!t) return false;
    const h = parseInt(t.split(':')[1]);
    return !isNaN(h) && h <= 12;
  });
  const done       = orders.filter(o => o.pct === 100);
  const inProgress = orders.filter(o => o.pct > 0 && o.pct < 100);
  // Theo công đoạn
  const byStage = STAGE_NAMES.map((name, i) => ({
    name,
    count: orders.filter(o => !o.stages[i].sk && !o.stages[i].x).length,
  }));
  // Đơn có gc hôm nay
  const gcToday = orders.filter(o => {
    if (!o.gc) return false;
    const tm = o.gc.match(/(\d{1,2})H/i);
    return tm && parseInt(tm[1]) > 0;
  }).map(o => ({
    ma_dh: o.ma_dh, gc: o.gc, bn: o.bn, kh: o.kh, pct: o.pct,
    stage: o.stages.find(s => !s.sk && !s.x)?.n || 'xong',
  }));
  return {
    total:        orders.length,
    done:         done.length,
    inProgress:   inProgress.length,
    urgentCount:  urgent.length,
    byStage,
    gcToday,
    now: new Date().toLocaleString('vi-VN'),
  };
}

// GET /ai/insights — tự động phân tích khi load dashboard
app.get('/ai/insights', async (req, res) => {
  try {
    const data = getData();
    const summary = buildSummary(data.orders);
    const prompt = `${SYSTEM_PROMPT}

DỮ LIỆU HIỆN TẠI (${summary.now}):
${JSON.stringify(summary, null, 2)}

YÊU CẦU:
1. Đưa ra 3-5 insights nổi bật nhất (cảnh báo / gợi ý / câu hỏi)
2. Mỗi insight ngắn gọn, đi kèm mã đơn cụ thể nếu có
3. Đánh dấu mức độ: 🔴 Nguy hiểm / 🟡 Cần chú ý / 🟢 Bình thường
4. Nếu không có gì đặc biệt → trả lời: "✅ Mọi thứ bình thường. Không có bất thường cần lưu ý."`;

    const insights = await anthropicChat(prompt);
    res.json({ insights });
  } catch (e) {
    res.status(200).json({ insights: `⚠ Lỗi AI: ${e.message}` });
  }
});

// POST /ai/ask — chat với AI
app.use(express.json());
app.post('/ai/ask', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: 'Cần nhập câu hỏi' });
    const data = getData();
    const summary = buildSummary(data.orders);
    const prompt = `${SYSTEM_PROMPT}

DỮ LIỆU HIỆN TẠI:
${JSON.stringify(summary, null, 2)}

CÂU HỎI CỦA NGƯỜI DÙNG: ${question}

TRẢ LỜI ngắn gọn, đi thẳng vào vấn đề, dùng tiếng Việt có dấu.`;

    const answer = await anthropicChat(prompt);
    res.json({ answer });
  } catch (e) {
    res.status(200).json({ answer: `⚠ Lỗi AI: ${e.message}` });
  }
});

app.use(express.static(BASE_DIR));

// ── START ──────────────────────────────────────────────
app.listen(PORT, () => {
  const excelFile = findLatest(FILE_SACH_DIR, ['.xlsx', '.xls', '.xlsm']);
  const jsonFile  = findLatest(DATA_DIR, ['.json']);

  console.log('');
  console.log('  🦷  ASIA LAB Dashboard Server');
  console.log('  ──────────────────────────────────────');
  console.log(`  URL      : http://localhost:${PORT}`);
  console.log(`  File_sach: ${FILE_SACH_DIR}`);
  console.log(`  Excel mới: ${excelFile?.name || '⚠ Chưa có file'}`);
  console.log(`  Data/JSON: ${jsonFile?.name  || '⚠ Chưa có file'}`);
  console.log(`  Reload   : http://localhost:${PORT}/reload`);
  console.log(`  Status   : http://localhost:${PORT}/status`);
  console.log('');
  console.log('  Nhấn Ctrl+C để dừng');
  console.log('');

  // Pre-load ngay lúc khởi động
  try { getData(); } catch (e) { log(`⚠ Pre-load: ${e.message}`); }
});
