# The Munger Dashboard — ASIA LAB

> "Show me the incentive and I'll show you the outcome." — Charlie Munger

---

## 📖 Câu chuyện

Vào một ngày tháng 5 năm 2026, quản lý của ASIA LAB đang ngồi nhìn dashboard hiện tại — 23 KTV, 2,650 đơn hàng từ tháng 3, dữ liệu đang chảy vào database đều đặn qua hệ thống auto-scrape 24/7.

Nhưng anh không hài lòng.

Anh đặt một câu hỏi: **"Nếu 5 tháng nữa doanh số là 10,000 đơn/tháng, tôi phải quản lý thế nào?"**

Không phải "làm sao để đạt 10,000 đơn?" mà là **"làm sao để KHÔNG BỊ SẬP khi scale lên 10,000 đơn?"**

Câu hỏi này gợi nhớ đến **Charlie Munger** — trợ lý đắc lực của Warren Buffett, người nổi tiếng với tư duy đảo ngược (inversion) và các mental models. Munger không hỏi "làm sao để thành công?" mà hỏi "làm sao để thất bại?" rồi tránh những điều đó.

Áp dụng vào ASIA LAB:
- ❌ Không track real-time → mất kiểm soát
- ❌ Không dự đoán bottleneck → nghẽn đột ngột
- ❌ Không train KTV mới kịp → quality giảm
- ❌ Không có backup plan → đứng máy khi nghỉ
- ❌ Không tự động hóa → overwhelmed bởi data

→ **Analytics Dashboard cần giải quyết TẤT CẢ những điểm này.**

---

## 🎯 10 Nguyên tắc Munger áp dụng cho ASIA LAB

### **1. Inversion (Tư duy đảo ngược)** 🔄

> "Invert, always invert."

**Thay vì hỏi:** "Làm sao để tăng sản lượng lên 10,000 đơn/tháng?"

**Munger hỏi:** "Làm sao để THẤT BẠI khi scale lên 10,000 đơn?"

| Cách thất bại | → Dashboard cần |
|---|---|
| Không track real-time | Real-time monitoring |
| Không dự đoán bottleneck | Predictive alerts |
| Không biết điểm nghẽn | Bottleneck detection |
| Không có backup plan | Capacity planning |
| Manual reporting | Automated reports |

**Metrics:**
```
✅ Real-time order status
✅ Bottleneck alerts (công đoạn >85% capacity)
✅ Auto-report cuối ngày/tuần/tháng
✅ Predictive forecast (7-14 ngày tới)
```

---

### **2. Circle of Competence (Vòng tròn năng lực)** 🎯

> "Know what you know, and know what you don't know."

**Áp dụng cho KTV:**

Mỗi KTV có **skill profile** riêng — biết ai giỏi gì, không giỏi gì → assign đúng người đúng việc.

**KTV Skill Matrix:**
```javascript
{
  "Toàn": {
    "CBM":  { skill: 95, speed: "fast", specialty: "all" },
    "SÁP":  { skill: 70, speed: "medium", specialty: "kim_loai" },
    "SƯỜN": { skill: 60, speed: "slow" }
  },
  "Văn Huyến": {
    "CBM":  { skill: 90, speed: "fast", specialty: "zirconia" },
    "SÁP":  { skill: 85, speed: "fast", specialty: "zirconia" },
    "SƯỜN": { skill: 88, speed: "fast", specialty: "zirconia" }
  }
}
```

**Smart Assignment:**
- Đơn Zirconia → auto assign Văn Huyến
- Đơn Kim loại CBM → auto assign Toàn
- Đơn phức tạp → KTV skill cao
- Đơn đơn giản → KTV mới (training)

**Metrics:**
```
✅ Skill score (0-100) cho mỗi KTV × công đoạn × loại răng
✅ Learning curve (cải thiện theo thời gian)
✅ Comfort zone (làm gì thoải mái nhất)
✅ Cross-training status (ai làm được nhiều công đoạn)
```

---

### **3. Margin of Safety (Biên độ an toàn)** 🛡️

> "The three most important words in investing are: margin of safety."

**Với 10,000 đơn/tháng:**

```
Hiện tại: 23 KTV → ~3,000 đơn/tháng (100% utilization)
Để làm 10,000 đơn cần: ~77 KTV

Nhưng KHÔNG nên chạy 100% capacity!

Margin of Safety = 20-30%
→ Cần: ~100 KTV (để chạy ở 70-80% capacity)
```

**Dashboard Alerts:**
```
🟢 Green:  60-75% utilization (healthy)
🟡 Yellow: 75-85% utilization (caution)
🔴 Red:    >85% utilization (danger — sắp có vấn đề)
```

**Metrics:**
```
✅ Daily capacity (bao nhiêu đơn/ngày an toàn)
✅ Buffer remaining (còn dư bao nhiêu capacity)
✅ Overload risk (% nguy cơ quá tải)
✅ Staffing gap (cần thuê thêm bao nhiêu)
```

---

### **4. Checklists (Danh sách kiểm tra)** ✅

> "Pilots use checklists. Surgeons use checklists. Why don't you?"

**Daily Manager Checklist (tự động):**

```
📋 MORNING (7:00 AM):
□ Có đơn nào trễ hạn hôm nay?
□ KTV nào nghỉ hôm nay?
□ Công đoạn nào đang nghẽn?
□ Có đơn gấp mới không?
□ Nguyên liệu có đủ không?

📋 MIDDAY (12:00 PM):
□ Progress hôm nay đạt bao nhiêu %? (vs target)
□ Có vấn đề quality nào không?
□ KTV nào đang overload?

📋 EVENING (6:00 PM):
□ Hoàn thành mục tiêu hôm nay chưa?
□ Chuẩn bị gì cho ngày mai?
□ Có incident nào cần review không?
```

**Dashboard tự động:**
- ✅ Tích xanh: OK
- ⚠️ Cảnh báo vàng: Cần chú ý
- 🚨 Đỏ: Cần hành động NGAY

---

### **5. Incentives (Động lực)** 💰

> "Show me the incentive and I'll show you the outcome."

**Vấn đề với 10,000 đơn:**
- KTV sẽ rush → quality giảm
- KTV chỉ làm đơn dễ → đơn khó bị bỏ lại
- KTV giỏi bị overload → burnout

**Balanced Scorecard:**
```javascript
KTV Performance Score = {
  quantity:  30%,  // Số lượng
  quality:   40%,  // Chất lượng (quan trọng nhất!)
  speed:     20%,  // Tốc độ
  difficulty: 10%  // Bonus cho đơn khó
}
```

**Gamification:**
```
🏆 Monthly Awards:
- Quality Champion (highest first-pass rate)
- Speed King (fastest without sacrificing quality)
- Versatility Master (làm tốt nhiều loại nhất)
- Team Player (giúp đỡ đồng nghiệp nhiều)
- Improvement Star (cải thiện nhiều nhất)

💰 Bonus Structure:
- Base: theo số lượng
- Multiplier: theo quality score
- Bonus: cho đơn khó, rush orders
```

**Metrics:**
```
✅ First-pass yield rate (tỷ lệ làm đúng ngay lần đầu)
✅ Rework rate (tỷ lệ làm lại)
✅ KTV satisfaction score
✅ Bonus distribution (có công bằng không?)
```

---

### **6. Compound Interest (Lãi kép)** 📈

> "Understanding compound interest is the key to wealth."

**Áp dụng vào KTV training:**

```
Nếu mỗi KTV cải thiện 1% mỗi tuần:
- Sau 1 tháng:  +4.3%
- Sau 3 tháng:  +13.5%
- Sau 6 tháng:  +28.6%
- Sau 1 năm:    +67.8%

→ Với 100 KTV, nếu mỗi người cải thiện 1%/tuần
→ Sau 6 tháng: capacity tăng 28.6% (KHÔNG cần thuê thêm!)
```

**Dashboard:**
```
📊 Learning Curve Tracking:
- KTV mới: Improvement rate (should be steep)
- KTV experienced: Consistency rate (should be stable)
- Training ROI: Cost vs improvement

🎯 Continuous Improvement:
- Weekly improvement target: +1%
- Monthly review: Ai đang improve, ai đang stagnant
- Intervention: Training cho người stagnant
```

---

### **7. Multidisciplinary Thinking (Tư duy đa ngành)** 🧩

> "You need a latticework of mental models."

**Kết hợp nhiều góc nhìn:**

| Góc nhìn | Ứng dụng |
|---|---|
| **Psychology** | Leaderboard, real-time feedback, visual progress |
| **Physics (ToC)** | Tối ưu bottleneck = tối ưu toàn bộ |
| **Biology** | KTV ecosystem: diversity, balance, adaptation |
| **Economics** | Supply-demand balance, opportunity cost |
| **Statistics** | Predictive modeling, anomaly detection |

**Dashboard tích hợp:**
```
🧠 Multi-dimensional View:
- Bottleneck lens (Theory of Constraints)
- People lens (Psychology)
- Flow lens (Lean Manufacturing)
- Financial lens (ROI, Cost)
- Risk lens (Probability)
```

---

### **8. Second-Order Thinking (Tư duy bậc 2)** 🎲

> "Think about consequences of consequences."

**Ví dụ:**

**Quyết định:** Tăng bonus cho KTV làm nhanh

| Order | Effect |
|---|---|
| 1st | KTV làm nhanh hơn → sản lượng tăng ✅ |
| 2nd | Quality giảm (vì rush) → rework tăng ❌ |
| 3rd | Customer complaints tăng → reputation giảm ❌ |
| 4th | Mất khách hàng lâu dài → revenue giảm ❌ |

**→ Net result: NEGATIVE!**

**Dashboard cần "What-If Simulator":**
```javascript
simulate({
  action: "increase_speed_bonus",
  amount: 0.2,
  predict: {
    speed:     +15%,     // first-order ✅
    quality:   -8%,      // second-order ❌
    rework:    +12%,     // second-order ❌
    csat:      -5%,      // third-order ❌
    revenue:   -3%       // final result ❌
  }
})
→ Recommendation: DON'T DO IT
```

---

### **9. Probabilistic Thinking (Tư duy xác suất)** 🎲

> "Think in probabilities, not certainties."

**Risk Assessment cho 10,000 đơn/tháng:**

| Scenario | Probability | Impact | Mitigation |
|---|---|---|---|
| Bottleneck ở SƯỜN | 70% | High (delay 500+ đơn) | Train thêm 5 KTV SƯỜN |
| KTV key nghỉ đột ngột | 30% | Medium (delay 50-100) | Cross-training |
| Spike đơn gấp | 20% | High (overwhelm system) | Buffer capacity 20% |
| Material shortage | 15% | Medium | Safety stock |
| System downtime | 10% | High | Backup servers |

**Dashboard Risk View:**
```
🎲 Top 5 Risks (by probability × impact)
✅ Mitigation status
⚠️ Early warning indicators
📊 Expected value impact
```

---

### **10. Focus on What Matters (Tập trung vào điều quan trọng)** 🎯

> "A lot of success in life comes from knowing what you want to avoid."

**Với 10,000 đơn, chỉ track 5-7 metrics QUAN TRỌNG:**

```
🎯 THE VITAL FEW (not the trivial many):

1. On-Time Delivery Rate    (>95%)  → Khách hàng quan tâm nhất
2. First-Pass Yield         (>90%)  → Quality indicator
3. Bottleneck Utilization   (70-80%)→ System health
4. Customer Satisfaction    (>4.5/5)→ Long-term success
5. KTV Turnover Rate        (<10%/yr)→ Stability
6. Revenue per Order        (↑trend)→ Profitability
7. Training Time to Prof.   (<90d)  → Efficiency
```

**Dashboard: Single Page View**
```
┌─────────────────────────────────────┐
│  🎯 THE 7 VITAL METRICS             │
├─────────────────────────────────────┤
│  On-Time:     96.5% ✅              │
│  Quality:     92.3% ✅              │
│  Bottleneck:  78%   ✅              │
│  CSAT:        4.6/5 ✅              │
│  Turnover:    8%    ✅              │
│  Revenue:     ↑12%  ✅              │
│  Training:    85d   ⚠️              │
└─────────────────────────────────────┘

→ Action: Improve training (85d → 75d)
```

---

## 🚀 Implementation Roadmap

### **Phase 1: Foundation (Month 1-2)**
- [ ] Real-time monitoring dashboard
- [ ] Bottleneck detection system
- [ ] KTV skill matrix
- [ ] Automated daily/weekly reports
- [ ] The 7 Vital Metrics view

### **Phase 2: Predictive (Month 3-4)**
- [ ] Demand forecasting (7-14 days)
- [ ] Capacity planning tool
- [ ] Risk assessment dashboard
- [ ] Early warning system
- [ ] What-if scenario simulator

### **Phase 3: Optimization (Month 5-6)**
- [ ] Smart assignment algorithm
- [ ] Balanced scorecard for KTV
- [ ] Gamification leaderboard
- [ ] Learning curve tracker
- [ ] Cross-training planner

### **Phase 4: Intelligence (Month 7+)**
- [ ] AI insights engine
- [ ] Anomaly detection
- [ ] Natural language queries
- [ ] Automated recommendations
- [ ] Multi-dimensional analysis

---

## 📊 Data Requirements

### **Current Data (Available):**
- ✅ 14,289 historical records (tien_do_history)
- ✅ 2,650 unique orders
- ✅ 23 KTV
- ✅ 88 nha khoa
- ✅ Stage completion times
- ✅ Order types (làm mới, sửa, làm lại)
- ✅ Prosthetic types (zirc, kl, vnr, hon)

### **Data Needed (Future):**
- 🔲 Customer satisfaction scores
- 🔲 Revenue/cost data per order
- 🔲 KTV training records
- 🔲 Material usage tracking
- 🔲 Incident/defect logs
- 🔲 Attendance records

---

---

## 🔧 Technical Implementation

### **API Endpoint**

```
GET /api/munger/metrics?days=30
```

**Authentication:** Requires admin role

**Query Parameters:**
- `days` (optional): 7, 30 (default), or 60
  - `30` uses billing period logic (26-25 cycle)
  - `7` and `60` use rolling window

**Response Structure:**
```json
{
  "ok": true,
  "updated_at": "2026-05-02T16:16:22.336Z",
  "days": 30,
  "billing_period": {
    "curr": { "start": "2026-04-26", "end": "2026-05-25", "label": "Tháng 5" },
    "prev": { "start": "2026-03-26", "end": "2026-04-25", "label": "Tháng 4" }
  },
  "data": {
    "bus_factor": {
      "worst_stage": "CBM",
      "worst_pct": 45,
      "stages": [...]
    },
    "wip_ratio": {
      "head": 120,
      "tail": 95,
      "ratio": 0.79,
      "status": "green"
    },
    "first_pass_yield": {
      "value": 92,
      "total": 650,
      "rework": 52,
      "target": 90,
      "status": "green"
    },
    "on_time_rate": {
      "value": 88,
      "on_time": 572,
      "total": 650,
      "target": 90,
      "status": "yellow"
    },
    "customer_concentration": {
      "top5_pct": 42,
      "total_rang": 2650,
      "top5_rang": 1113,
      "top5": [...],
      "status": "yellow"
    },
    "demand_trend": {
      "curr_rang": 1250,
      "prev_rang": 1180,
      "change_pct": 6,
      "prev_full": 2650,
      "trend_label": "Tháng 5 — 7 ngày đầu kỳ",
      "prev_label": "Tháng 4 (7 ngày đầu)",
      "sparkline": [...],
      "status": "green"
    },
    "scale_countdown": {
      "target": 10000,
      "current_rate": 1250,
      "pct_of_target": 13,
      "days_until": 120,
      "status": "green"
    }
  }
}
```

### **Database Queries**

**Key Tables:**
- `don_hang` — Orders with nhap_luc (entry date), yc_hoan_thanh (deadline), sl (quantity)
- `tien_do` — Progress tracking with cong_doan (stage), ten_ktv (technician), xac_nhan (confirmed)

**Billing Period Logic:**
```javascript
// Kỳ tháng: 26 tháng trước → 25 tháng này
// Ví dụ: 26/3 → 25/4 = Tháng 4
function getBillingPeriods() {
  const today = new Date();
  const currMonth = today.getDate() >= 26 ? today.getMonth() + 1 : today.getMonth();
  // ... calculate curr.start, curr.end, prev.start, prev.end
}
```

**Fair Comparison:**
- Kỳ hiện tại: N ngày đầu kỳ (từ ngày 26 đến hôm nay)
- Kỳ trước: N ngày đầu kỳ trước (cùng số ngày)
- Tránh so sánh kỳ chưa xong với kỳ đã xong (unfair)

### **Frontend Components**

**File:** `munger.html`

**Key Features:**
- Color-coded cards (green/yellow/red) based on thresholds
- Responsive grid: 4 cols → 2 cols → 1 col
- Real-time data refresh (manual button)
- Time window selector (7/30/60 days)
- Sparkline charts using inline SVG
- Progress bars with animated fills
- Detailed sub-metrics and tooltips

**Color Thresholds:**
```javascript
// Bus Factor
green: <40%, yellow: 40-60%, red: >60%

// WIP Ratio
green: <0.9, yellow: 0.9-1.1, red: >1.1

// First-pass Yield
green: ≥90%, yellow: 85-90%, red: <85%

// On-time Rate
green: ≥90%, yellow: 80-90%, red: <80%

// Customer Concentration
green: <35%, yellow: 35-50%, red: >50%

// Demand Trend
green: positive growth, yellow: flat, red: negative

// Scale Countdown
green: >90 days, yellow: 30-90 days, red: <30 days or no path
```

### **Access Control**

**Route Protection:**
```javascript
app.get('/munger', requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'munger.html'));
});
```

**Sidebar Integration:**
```html
<!-- Only shown for admin role -->
<% if (user.role === 'admin') { %>
  <a href="/munger" class="nav-link">
    <span class="icon">📊</span>
    <span class="label">Munger</span>
  </a>
<% } %>
```

---

## 📊 Current Data Snapshot (2026-05-02)

### **System Overview:**
- **Total Orders:** 2,650 (Tháng 3-4)
- **Total Teeth:** ~14,000 răng
- **Active Technicians:** 23 KTV
- **Dental Clinics:** 88 nha khoa
- **Database Records:** 14,000+ rows

### **Current Metrics (Estimated):**
- **Bus Factor:** ~45% (CBM stage, 1 KTV dominant)
- **WIP Ratio:** ~0.79 (healthy pipeline flow)
- **First-pass Yield:** ~92% (excellent quality)
- **On-time Rate:** ~88% (needs improvement)
- **Customer Concentration:** ~42% (moderate risk)
- **Demand Trend:** +6% growth (month-over-month)
- **Scale Progress:** 13% of 10K target (~120 days to goal)

### **Key Insights:**
1. ✅ Quality is excellent (92% FPY)
2. ⚠️ On-time delivery needs work (88% vs 90% target)
3. ⚠️ Customer concentration moderate (42% from top 5)
4. ✅ Positive growth trend (+6% MoM)
5. ⚠️ Bus factor risk in CBM stage (45% from 1 person)
6. ✅ Pipeline balanced (WIP ratio 0.79)

---

## 💡 Implementation Status

### ✅ Phase 1: Core Metrics (COMPLETED 2026-05-02)

1. **The 7 Vital Metrics** — ✅ Single page view cho quản lý
   - Bus Factor per stage
   - WIP Ratio (pipeline balance)
   - First-pass Yield (quality)
   - On-time Rate (delivery)
   - Customer Concentration (risk)
   - Demand Trend (growth)
   - Scale Countdown (progress to 10K)

### 🔲 Phase 2: Alerts & Automation (TODO)

2. **Bottleneck Alert** — Red flag khi công đoạn >85% capacity
3. **Daily Auto-Report** — Email lúc 6PM với summary ngày
4. **Push Notifications** — Real-time alerts cho critical metrics

### 🔲 Phase 3: Advanced Analytics (TODO)

5. **KTV Leaderboard** — Top 10 KTV theo balanced score
6. **Stage Heatmap** — Giờ nào bận nhất, công đoạn nào nghẽn
7. **Predictive Forecasting** — ML model dự đoán demand 14 ngày tới
8. **Capacity Planning** — Simulation tool cho hiring decisions

---

## 🎓 Quotes from Charlie Munger

> "Invert, always invert."

> "It is remarkable how much long-term advantage people like us have gotten by trying to be consistently not stupid, instead of trying to be very intelligent."

> "The big money is not in the buying and selling, but in the waiting."

> "Spend each day trying to be a little wiser than you were when you woke up."

> "Knowing what you don't know is more useful than being brilliant."

> "The first rule of compounding: Never interrupt it unnecessarily."

> "A great business at a fair price is better than a fair business at a great price."

> "The best thing a human being can do is to help another human being know more."

---

## 📖 Usage Guide

### **For Management (Daily Routine)**

**Morning Check (8:00 AM):**
1. Open `/munger` dashboard
2. Check color status of all 7 metrics
3. Focus on RED metrics first
4. Review trends and take action

**Weekly Review (Monday):**
- Switch to 7-day view
- Compare week-over-week
- Identify bottlenecks and patterns

**Monthly Planning (Day 26):**
- Switch to 30-day view (billing period)
- Review full month vs previous month
- Update hiring/capacity plans

### **When to Act Immediately**

🔴 **Bus Factor >60%** → Cross-train within 1 week
🔴 **WIP Ratio >1.1** → Fix bottleneck within 2 days
🔴 **FPY <85%** → Quality review within 1 day
🔴 **On-time <80%** → Expedite delayed orders now
🔴 **Customer Concentration >50%** → Diversify within 30 days
🔴 **Demand Trend negative** → Sales intervention now
🔴 **Scale Countdown <30 days** → Emergency hiring now

### **Metric Interpretation**

**Bus Factor:** Work distribution risk
- Good: <40% (distributed)
- Bad: >60% (one person critical)

**WIP Ratio:** Pipeline balance (tail/head)
- Good: 0.7-0.9 (smooth flow)
- Bad: >1.1 (bottleneck at end)

**First-pass Yield:** Quality (% done right first time)
- Good: >90% (world-class)
- Bad: <85% (quality issues)

**On-time Rate:** Delivery reliability
- Good: >90% (reliable)
- Bad: <80% (unreliable)

**Customer Concentration:** Revenue risk
- Good: <35% (diversified)
- Bad: >50% (risky)

**Demand Trend:** Growth trajectory
- Good: Positive (growing)
- Bad: Negative (shrinking)

**Scale Countdown:** Time to 10K răng/month
- Good: On track with positive trend
- Bad: No path or >120 days

---

## 🎯 Quick Action Playbooks

### **Playbook 1: Reduce Bus Factor (>60%)**

**Immediate (1 week):**
- Pair junior with senior on next 5 orders
- Document process while working
- Reduce senior's load by 20%

**Short-term (1 month):**
- Formal training (2 hours/week)
- Rotate assignments
- Track skill matrix progress

### **Playbook 2: Fix Pipeline Bottleneck (WIP >1.1)**

**Immediate (2 days):**
- Overtime for ĐẮP/MÀI stages
- Slow down CBM/SÁP intake
- Expedite stuck orders

**Short-term (2 weeks):**
- Reassign 1-2 KTVs to bottleneck
- Cross-train to help downstream
- Improve handoff process

### **Playbook 3: Improve Quality (FPY <85%)**

**Immediate (1 day):**
- Root cause analysis of last 20 reworks
- Identify common failure patterns
- Communicate to all KTVs

**Short-term (2 weeks):**
- Quality checklist at each stage
- Better customer spec clarification
- Fix equipment/material issues

### **Playbook 4: Scale to 10K Răng/Month**

**Phase 1 (Month 1-2): 2,650 → 4,000 (+50%)**
- Hire +12 KTVs (total 35)
- Optimize current processes
- Maintain FPY >90%

**Phase 2 (Month 3-4): 4,000 → 6,500 (+60%)**
- Hire +20 KTVs (total 55)
- Scale infrastructure
- Bus Factor <50%, WIP <1.0

**Phase 3 (Month 5-6): 6,500 → 10,000 (+55%)**
- Hire +35 KTVs (total 90)
- Systemize everything
- All metrics in green zone

**Critical Success Factors:**
- Hiring: 3-4 KTVs/week for 6 months
- Training: 2-week onboarding + 4-week mentorship
- Infrastructure: Expand workspace, equipment
- Management: Add 2-3 team leads
- Quality: Don't sacrifice for speed

---

## 📝 Notes & Iterations

### **2026-05-02 (Day 1):**
- Ý tưởng ban đầu: Scale lên 10,000 đơn/tháng trong 5 tháng
- Áp dụng Munger mental models → 10 nguyên tắc
- Current state: 2,650 đơn, 23 KTV, 14K records trong DB
- Gap: Cần ~100 KTV cho 10K đơn (với 20% buffer)
- Next: Discuss với team để prioritize phase nào

### **2026-05-02 (Implementation Complete):**
✅ **Đã hoàn thành Munger Dashboard v1.0**

**Backend API (`GET /api/munger/metrics`):**
- 7 metrics đã được implement đầy đủ
- Logic kỳ tháng 26-25 (ví dụ: 26/3–25/4 = Tháng 4)
- So sánh công bằng: N ngày đầu kỳ hiện tại vs N ngày đầu kỳ trước
- Hỗ trợ 3 time windows: 7 ngày, 30 ngày (kỳ), 60 ngày
- Admin-only access với session authentication

**7 Metrics Implemented:**

1. **Bus Factor** — Phát hiện dependency risk
   - Track top 3 KTV mỗi công đoạn (CBM, SÁP/Cadcam, SƯỜN, ĐẮP, MÀI)
   - Hiển thị % công việc của KTV top 1
   - 🟢 Green: <40% | 🟡 Yellow: 40-60% | 🔴 Red: >60%

2. **WIP Ratio** — Cân bằng pipeline
   - Tỷ lệ WIP cuối pipeline (ĐẮP+MÀI) / đầu pipeline (CBM+SÁP)
   - 🟢 Green: <0.9 | 🟡 Yellow: 0.9-1.1 | 🔴 Red: >1.1

3. **First-pass Yield** — Chất lượng sản xuất
   - % đơn không phải Sửa/Làm lại/Bảo hành
   - Target: 90%
   - 🟢 Green: ≥90% | 🟡 Yellow: 85-90% | 🔴 Red: <85%

4. **On-time Rate** — Đúng deadline
   - % đơn hoàn thành MÀI trước yc_hoan_thanh
   - Target: 90%
   - 🟢 Green: ≥90% | 🟡 Yellow: 80-90% | 🔴 Red: <80%

5. **Customer Concentration** — Rủi ro khách hàng
   - % răng từ top 5 nha khoa
   - 🟢 Green: <35% | 🟡 Yellow: 35-50% | 🔴 Red: >50%

6. **Demand Trend** — Xu hướng tăng trưởng
   - So sánh kỳ hiện tại vs kỳ trước (cùng số ngày)
   - Sparkline chart theo ngày
   - 🟢 Green: tăng | 🟡 Yellow: flat | 🔴 Red: giảm

7. **Scale Countdown** — Tiến độ đến 10K răng/kỳ
   - Dự báo số ngày/kỳ để đạt target
   - Progress bar hiển thị % hoàn thành
   - 🟢 Green: >90 ngày | 🟡 Yellow: 30-90 ngày | 🔴 Red: <30 ngày hoặc không đạt

**Frontend (`munger.html`):**
- Dark theme với color-coded metrics (green/yellow/red)
- Responsive grid layout (4 cols → 2 cols → 1 col)
- Real-time refresh button
- Time window selector (7/30/60 ngày)
- Sparkline charts cho demand trend
- Progress bars cho scale countdown
- Detailed tooltips và sub-metrics

**Integration:**
- Link "Munger" thêm vào sidebar (desktop + mobile)
- Chỉ hiển thị cho Admin role
- Route: `/munger` (admin-only)

**Data Quality:**
- Xử lý edge cases: null values, empty strings, division by zero
- Fallback values khi không có dữ liệu
- Consistent date formatting (YYYY-MM-DD)

**Performance:**
- Single API call load tất cả 7 metrics
- Optimized SQL queries với proper indexing
- Client-side caching với manual refresh

---

*Last updated: 2026-05-02 by Claude Opus 4.6*
*Inspired by: Charlie Munger's mental models*
*For: ASIA LAB — Dental Lab Management System*
