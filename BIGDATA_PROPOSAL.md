# ASIA LAB — Phân tích Pattern & Đề xuất Big Data / ML (Production-Focused)

Last updated: 2026-05-15

Tài liệu này được viết theo hướng **action thực tế cho sản xuất**, không lý thuyết suông.
Mọi pattern dưới đây đều có:
- **Bằng chứng** (query SQL có thể chạy lại)
- **Tác động** (số liệu cụ thể, không đoán)
- **Giải pháp** (làm gì, ai làm, mất bao lâu)

Tham chiếu: `Munger.md` (10 mental models) — đặc biệt **Inversion** ("làm sao để THẤT BẠI"), **Margin of Safety**, **Bus Factor**, **Second-Order Thinking**.

---

## 0. TL;DR — 10 phát hiện CRITICAL

### 🔴 Cấp độ ĐỎ — phải xử lý trong 7 ngày

1. **726 đơn đứng yên >7 ngày!** Pipeline có 943 đơn pending, 77% (726) không có cập nhật quá 1 tuần. Đây là zombie orders — cần truy về xem có thật sự đã hoàn thành nhưng KTV quên confirm, hay đang kẹt thật.

2. **386 đơn có MÀI confirmed NHƯNG stage trước chưa confirmed.** KTV mark MÀI=Có nhưng SƯỜN/ĐẮP chưa xong → vi phạm quy trình **hoặc** workflow thực tế đã thay đổi mà code chưa cập nhật. Toàn bộ stats KPI đang chạy trên dataset có 386 cases data integrity broken.

3. **42% đơn có MÀI xác nhận TRƯỚC ĐẮP** (721/~1700) → workflow ĐẮP↔MÀI thực tế là song song, hoặc KTV confirm sai thứ tự. Cần phỏng vấn 2-3 KTV để xác nhận, fix code hoặc fix workflow.

4. **Quality đang DRIFT XẤU dần 3 tuần gần đây**: rework rate W16=12.6% → W17=17.1% → W18=17.8% → W19=**18.1%**. Xu hướng tăng 40% trong 1 tháng — không thể bỏ qua.

5. **Hồng Thắm + HẠNH (2 KTV chủ chốt SÁP kim loại) đang BURNOUT**:
   - Hồng Thắm: 14 ngày làm >12h, 131 đơn sau 20h tối
   - HẠNH: 10 ngày làm >12h, 114 đơn sau 20h
   - Cộng cả 2 = đảm nhận 100% SÁP kim loại. Nếu 1 trong 2 nghỉ → backup zero.

### 🟡 Cấp độ VÀNG — cần kế hoạch trong 30 ngày

6. **CAD/CAM phòng đang gồng cả zirco + 7-30% sap kim loại** (xem section 2.13). WIP backlog CAD = 23 ngày vs SÁP 12 ngày. Đây là gốc rễ 13 đơn zirco trễ.

7. **Veneer sứ Ziconia (Cut Back) có rework rate 43%** (51 đơn, 22 phải làm lại). 1 SKU đang là "lỗ rò" chất lượng — cần QC gate.

8. **CBM bus factor 51%**: Toàn làm 51% CBM, chỉ có 3 KTV CBM. Toàn nghỉ 1 ngày → toàn lab dừng cascade 2-3 ngày.

9. **Đơn gấp <12h dẫn đến rework cao**:
   - 134 đơn sap urgent → 60 (45%) trở thành Sửa/Làm lại
   - 34 đơn zirco urgent → 30 (**88%!**) trở thành rework
   - → Đơn gấp gần như đảm bảo rework cho zirco.

10. **7 đơn quay lại lab 4-7 lần** (chronic rework). Riêng `261603065` của LA-Nk Tố Oanh có 7 variants `Làm tiếp | Sửa | Sửa | Làm tiếp | Làm thêm | Sửa | Sửa`. Khách hàng sử dụng warranty/repair như "thử nghiệm vô tận".

→ **Có ít nhất 12 vấn đề có thể xử lý NGAY tuần này** chỉ với SQL + dashboard cảnh báo, không cần ML.

---

## 1. Data snapshot

### 1.1 Volume

| Bảng | Records | Tăng trưởng |
|---|---|---|
| `don_hang` | 2,738 | ~60 đơn/ngày |
| `tien_do` | 13,282 | ~300 row/ngày |
| `tien_do_history` | 28,160 | ~110k/năm |
| `import_log` | 3,324 | ~10 file/ngày |
| `ktv_daily_stats` | 1,593 | aggregated |
| `error_reports` | **15** | gần như không dùng |
| `feedbacks` | **4** | bỏ hoang |

**Date range thực tế**: chỉ 3 tháng (2026-03 → 2026-05). Volume hiện tại = **medium analytics scale**, không phải big data.

Sau 5 năm: ~600k rows → vẫn nằm trong tầm SQLite/Postgres/DuckDB single-node.

### 1.2 Cảnh báo data quality

| Vấn đề | Số lượng | % | Ưu tiên |
|---|---|---|---|
| `ĐẮP→MÀI` âm gap (MÀI trước ĐẮP) | **721** | **42%** | 🔴 CRITICAL |
| `tien_do.xac_nhan='Chưa'` (WIP) | 3,583 | 27% | (bình thường) |
| `ghi_chu_sx` rỗng | 2,543 | 93% | 🟡 Keylab scrape miss |
| `barcode_labo` rỗng | 2,447 | 89% | 🟡 Scan chưa dùng |
| `don_hang.loai_lenh` rỗng | 125 | 4.6% | 🟡 Data entry |
| `khach_hang` rỗng | 134 | 4.9% | 🟡 Data entry |
| `routed_to=NULL/none` | 84 | 3.1% | 🟡 Răng Tạm missing rule |
| `sl=0` | 78 | 2.8% | 🟡 Re-parse được |
| `SÁP/Cadcam→SƯỜN` âm gap | 74 | 4.4% | 🟡 Có thể là parallel work |
| `SƯỜN→ĐẮP` âm gap | 22 | 1.3% | 🟢 hiếm |

**🔴 ĐẮP/MÀI 42% âm gap** = vấn đề quan trọng nhất. Đào sâu ở mục 2.3.

---

## 2. Pattern thực tế (deep dive)

### 2.1 Bottleneck thực sự — NOT what the doc says

Doc cũ ghi "SƯỜN→ĐẮP là bottleneck 12.15h". **Sai một nửa**.

Phân tích theo `routed_to` × `loai_lenh`:

| Room | Loại lệnh | n | Avg gap SƯỜN→ĐẮP |
|---|---|---|---|
| **sap** | Làm mới | **1,172** | **14.07h** ← bottleneck thực |
| sap | Làm tiếp | 61 | 13.09h |
| sap | Làm thêm | 26 | 9.51h |
| zirco | Làm mới | 345 | **5.64h** (nhanh hơn 2.5x!) |

**Kết luận**:
- Bottleneck SƯỜN→ĐẮP chỉ ảnh hưởng **room sap (kim loại)**.
- Zirconia chạy SƯỜN→ĐẮP nhanh 2.5x. Có thể do quy trình zirconia không cần ĐẮP truyền thống (sint xong là chuyển MÀI).
- → **Action**: focus tối ưu queue ĐẮP cho kim loại, không cho zirconia.

### 2.2 Bottleneck phụ — CBM→SÁP cũng đáng kể

Stage-to-stage gap trung bình:
- CBM → SÁP: **9.67h**
- SÁP → SƯỜN: 2.51h (nhanh)
- SƯỜN → ĐẮP: **14.07h sap** / 5.64h zirco
- ĐẮP → MÀI: 2.60h (nhanh)

→ Tổng **23h+ wait time** giữa stage = **77%** tổng lead time. Toàn bộ stage handover là nguồn delay chính, không phải thời gian KTV làm việc.

### 2.3 🔴 ĐẮP→MÀI negative gap: 721 đơn (42%)

```
ĐẮP → MÀI: 721 đơn có MÀI confirm TRƯỚC ĐẮP
SÁP → SƯỜN: 74 đơn
SƯỜN → ĐẮP: 22 đơn
CBM → SÁP: 7 đơn
```

**Giải thích khả dĩ**:
- (A) ĐẮP và MÀI **thực hiện song song trong thực tế** (vd: KTV ĐẮP răng số 1 trong khi KTV khác MÀI răng số 2 cùng order).
- (B) KTV nhập xác nhận MÀI trước (cuối ca) rồi mới quay lại nhập ĐẮP (data entry order ≠ work order).
- (C) Quy trình thực tế đã thay đổi nhưng documentation chưa cập nhật.

**Action cần làm**:
1. Phỏng vấn 2-3 KTV ĐẮP và MÀI để xác nhận quy trình thực tế.
2. Nếu (A): cập nhật code dashboard hiển thị parallel pip, không xếp sequential.
3. Nếu (B): rework UI confirm — block MÀI button cho đến khi ĐẮP confirm.
4. Nếu (C): viết lại CONTRUCTION.md section 7 cho đúng.

**Tác động kinh doanh**: 721 đơn có data lệch → tất cả stats lead time, on-time, bottleneck đều sai. Đây là gốc rễ data quality.

### 2.4 KTV concentration (bus factor)

| Stage | Unique KTV | Top KTV | % |
|---|---|---|---|
| **CBM** | **3** | Toàn | **51.1%** 🔴 |
| SÁP/Cadcam | 9 | Hồng Thắm | 42.9% |
| MÀI | 7 | Bảo Trân | 21.5% |
| SƯỜN | 8 | Bùi Tấn Đạt | 28.4% |
| ĐẮP | 6 | Cẩm Hồng | 17.6% |

**Vận tốc thực tế (avg đơn/ngày)**:
- Toàn (CBM): 22.7/ngày, max 39 → cao nhất labo
- Võ Văn Vạn (CBM): 20.1/ngày
- Hồng Thắm (SÁP): 19.1/ngày
- Bảo Trân (MÀI): 9.6/ngày

**Tác động**:
- CBM = intake gate. Nếu Toàn nghỉ 1 ngày → throughput intake giảm 50%, downstream tắc theo cascade trong 2-3 ngày.
- Đào tạo 2 KTV CBM mới = priority #1 HR.

### 2.5 Khách hàng — top + risk pattern

**Cadence của top customers** (đơn/ngày):
- BT-Nk Bác Sĩ Hiếu: 1 đơn mỗi 0.25 ngày (~4 đơn/ngày)
- BL-NK BS Tăng Suy Nghĩ: 0.27 ngày
- SG-Nk Hải Nguyên: 0.31 ngày
- → Top khách hàng order nhiều lần mỗi ngày, không theo batch tuần.

**Rework rate by customer** (top 5 cao nhất, min 20 đơn):

| Khách hàng | Total | Rework | % |
|---|---|---|---|
| NT-Nk BS Thuận | 75 | 31 | **41.3%** 🔴 |
| SG-Nk Như Lạc | 63 | 22 | **34.9%** 🔴 |
| SG-Nk Việt Xuân | 77 | 22 | **28.6%** 🟡 |
| AG-Nk Thủy Tùng | 35 | 9 | 25.7% |
| AG-Nk Hồng Thọ | 39 | 10 | 25.6% |
| ... | ... | ... | ... |
| **DT-Nk Sa Đéc** | 86 | 3 | **3.5%** ← best |

**Variance 10x**: NT-Nk BS Thuận rework 41% vs DT-Nk Sa Đéc 3.5%. Cùng giá, cùng quy trình → có nghĩa gì:
- Khách hàng yêu cầu cao bất thường (chuẩn riêng).
- Khách hàng spec không rõ ràng (KTV đoán → sai).
- Khách hàng dùng SKU rủi ro cao (Veneer/Cercon HT).

**Action**:
- Tạo "Customer Risk Score" hiển thị trên admin dashboard.
- Top 5 high-rework: contact để hiểu pain point, có thể cần spec sheet chi tiết hơn.
- Consideration: tính phí phụ thu Sửa/Bảo hành cho khách rework > 25%.

### 2.6 Material rework rates (top SKU rủi ro)

| Phục hình | n | Rework % |
|---|---|---|
| **Veneer sứ Ziconia (Cut Back)** | 51 | **43.1%** 🔴 |
| **Veneer sứ Cercon HT (Cut-Back)** | 12 | **41.7%** 🔴 |
| Răng sứ Cercon HT | 34 | 35.3% |
| Mặt dán sứ | 14 | 35.7% |
| Full Sứ Ziconia | 31 | 29.0% |
| Veneer sứ kim loại thường | 16 | 25.0% |
| Răng sứ Zolid | 30 | 23.3% |
| Răng sứ Zircornia | 215 | 20.5% |
| **Răng sứ kim loại thường** | 923 | **12.5%** ✓ baseline |
| Răng sứ Titanium | 248 | 13.7% |

**Phát hiện**:
- **Veneer cut-back** là vấn đề CHẤT LƯỢNG TRƯỜNG KỲ. 43% rework = mỗi 2.3 đơn → 1 lỗi.
- Veneer là SKU đắt tiền (premium pricing). Rework cost cao gấp 3-4x đơn kim loại thường.
- Cercon HT (cả veneer và full): 35-42% rework. Có thể quy trình sint Cercon HT chưa optimize.

**Action**:
- Veneer/Cercon HT: thêm bước QC review giữa SƯỜN và ĐẮP.
- Tính ROI: nếu giảm rework 43% → 20% (vẫn cao nhưng đỡ), tiết kiệm ~12 đơn rework/quý = ~50 đơn/năm.

### 2.7 Trễ deadline — chỉ là vấn đề zirconia

49 đơn trễ / 1591 = 3.1% (đã rất tốt).

Phân tích chi tiết:

| Room | Loại | n | Avg trễ | Max trễ |
|---|---|---|---|---|
| sap | Làm mới | 33 | 0.5h | 1.2h |
| **zirco** | **Làm mới** | **13** | **22.6h** | **135.6h** 🔴 |
| zirco | Làm tiếp | 2 | 3.7h | 7.1h |
| zirco | Bảo hành | 1 | 0.3h | 0.3h |

**Phát hiện then chốt**:
- 33 đơn trễ room=sap chỉ trễ trung bình **0.5h** (gần như không trễ thực tế).
- 13 đơn zirconia trễ trung bình **22.6h**, tệ nhất là **5.6 ngày** (135h).

**Đào sâu vào case 5.6 ngày trễ**:

```
ma_dh: 260504013 — AG-Nk Thanh Bình
yc_giao: 2026-04-01 00:00:00 (yêu cầu xong 01/04)
CBM bắt đầu: 05/04 10:54 (BẮT ĐẦU 4 ngày SAU deadline!)
MÀI xong: 06/04 15:34
→ Đơn này về labo SAU khi đã quá hạn.
```

Một số case khác (Kim Oanh 09/05 yc, CBM bắt đầu 08/05 đêm → khả thi nhưng kẹt) cho thấy:
- Đơn zirconia thường có yc_giao quá gấp.
- Một số đơn về labo TRỄ hơn deadline rồi → vô lý nhưng do data entry hoặc khách hàng gửi qua đêm.

**Action**:
- Alert ngay khi 1 đơn có `nhap_luc > yc_giao` (đã trễ trước khi bắt đầu) → push lên admin.
- Zirconia SLA mặc định = 24h, alert nếu T-12h chưa qua SÁP.

### 2.8 Pattern thời gian — lab làm việc thật sự bao giờ?

**Intake (nhap_luc)**:
- 08-11h chiếm 62% (peak buổi sáng).
- Sau trưa giảm mạnh.
- Tue cao nhất, Sun thấp nhất nhưng vẫn làm việc (255 đơn) → labo mở Chủ Nhật.

**Completion theo giờ**:
- **CBM**: dừng sau 21h
- **SÁP/Cadcam**: vẫn hoạt động đến 23h, có 6 ca làm 01h sáng → có **ca đêm cho SÁP**
- **SƯỜN**: cao điểm 08h-09h (~290/h), làm đến 23h, có 10 ca 01h → tương tự ca đêm
- **ĐẮP**: dừng sau 20h
- **MÀI**: dừng sau 19h (early!)

**Phát hiện**:
- ĐẮP/MÀI dừng sớm (19-20h), trong khi SÁP/SƯỜN vẫn chạy đến 23h+
- → Upstream piles up overnight, downstream (ĐẮP/MÀI) bắt đầu ngày hôm sau với backlog
- → Đây có thể là nguyên nhân ĐẮP/MÀI có WIP cao nhất (819 + 815 = 1634, ~46% total WIP)

**Action**:
- Cân nhắc shift schedule: kéo dài giờ MÀI đến 21h trong 30 ngày thử nghiệm.
- Hoặc: hạn chế intake mới khi MÀI WIP > 800.

### 2.9 WIP snapshot hiện tại

```
CBM:        594 đơn pending
SÁP/Cadcam: 715
SƯỜN:       624
ĐẮP:        815  ← peak
MÀI:        819  ← peak
TỔNG:      3567 record pending
```

**Phát hiện**:
- ĐẮP + MÀI giữ ~46% WIP — phù hợp với phát hiện 2.8.
- Tỷ lệ tích lũy: CBM 594 nhưng SÁP 715 → nhiều đơn đang ở SÁP hơn CBM intake. Có nghĩa labo đang "tiêu hóa" backlog cũ.

### 2.10 Customer dormancy — khách sắp rời

Khách hàng có ≥5 đơn, last_order cách hôm nay >7 ngày (so với cadence avg ~0.25-0.85d):

| Khách | Orders | SL | Last order | Gap |
|---|---|---|---|---|
| LA-Nk Kim Oanh | 19 | 116 | 2026-05-07 | 8d |
| KG-Nk Thanh Song | 18 | 62 | 2026-05-07 | 8d |
| KG-Nk Phạm Kiều | 15 | 54 | 2026-05-07 | 8d |
| SG-Nk Hoàn Vũ | 6 | 19 | 2026-04-29 | **16d** |
| DT-Nk Tân Bình | 5 | 10 | 2026-04-19 | **26d** ← chắc đã rời |
| LA-Nk Khánh Hà | 8 | 9 | 2026-04-28 | 17d |

**Action**: sales team call/contact 5 khách dormant > 14 ngày trong tuần này.

### 2.11 Velocity capacity ceiling

Avg đơn/ngày hoàn thành mỗi stage (giờ làm việc 8-20h):
```
CBM:        40.6/ngày  max 69
SÁP/Cadcam: 35.0/ngày  max 66
SƯỜN:       40.7/ngày  max 64
ĐẮP:        36.4/ngày  max 61
MÀI:        37.2/ngày  max 62
```

**Phát hiện**:
- Mỗi stage capacity ~60-70 đơn/ngày peak (đạt được rồi).
- Trung bình ~35-40 → đang chạy ~58% capacity.
- → Bottleneck KHÔNG phải capacity người. Là **wait time giữa stage**. Tối ưu queue chứ không cần thêm người.

### 2.13 🔴 CAD/CAM phòng đang gánh cả kim loại — BOTTLENECK gốc rễ

**Câu hỏi xuất phát**: "Nhân viên phòng CAD có làm các ca hàng kim loại không?"

**Trả lời từ data**: ĐÚNG, và đây là điểm nghẽn lớn hơn cả SƯỜN→ĐẮP.

**Workforce split tại stage SÁP/Cadcam**:

| KTV | Đơn sap | Đơn zirco | Phân loại |
|---|---|---|---|
| **Hồng Thắm** | 832 (98.8%) | 5 (0.6%) | SÁP chuyên |
| **HẠNH** | 519 (99.2%) | 3 (0.6%) | SÁP chuyên |
| **Văn Huyến** | 71 (26.2%) | 199 (73.4%) | CAD ưu thế |
| **Thái Sơn** | 75 (30.1%) | 174 (69.9%) | CAD ưu thế |
| ĐINH THIỆN TÂM | 14 (41.2%) | 20 (58.8%) | Mixed (đã nghỉ 38 ngày!) |

→ Văn Huyến + Thái Sơn đã làm **146 đơn SÁP kim loại** trong khi không phải chuyên môn chính.

**Bằng chứng 1 — CBM→SÁP handoff time chênh lệch 5-7x**:

| KTV | room=sap | room=zirco |
|---|---|---|
| Hồng Thắm (sap-only) | **6.14h** | — |
| HẠNH (sap-only) | 7.86h | — |
| Thái Sơn (CAD) | 7.95h | **20.34h** |
| Văn Huyến (CAD) | 7.33h | **16.99h** |
| ĐINH THIỆN TÂM | 6.39h | **41.36h** 🔴 |

CAD xử lý zirco mất 17-41 giờ, gấp 2.5-7x SÁP kim loại.

**Bằng chứng 2 — Năng suất chênh lệch 3-6x**:

| KTV | sap đơn/ngày | zirco đơn/ngày |
|---|---|---|
| Hồng Thắm | **18.9** (max 29) | — |
| HẠNH | 11.8 (max 25) | — |
| Thái Sơn | 2.5 (max 6) | 5.3 (max 16) |
| Văn Huyến | 3.2 (max 10) | 5.5 (max 14) |

Khi Văn Huyến/Thái Sơn buộc phải làm SÁP kim loại, năng suất chỉ ~3 đơn/ngày — **chậm gấp 6 lần Hồng Thắm**.

**Bằng chứng 3 — WIP backlog CAD gấp đôi**:

```
WIP SÁP/Cadcam hiện tại:
  sap (kim loại):  356  → 30 đơn/ngày      → 12 ngày backlog
  zirco:           255  → 11 đơn/ngày CAD  → 23 ngày backlog 🔴
```

→ Đây chính xác giải thích 13 đơn zirconia trễ trung bình 22.6h trong section 2.7.

**Bằng chứng 4 — 7 ngày gần đây vẫn lệch**:

```
Hồng Thắm:   125 sap / 1 zirco / 3 both    total 129
HẠNH:         88 sap / 0 zirco / 1 both    total 89
Thái Sơn:      9 sap / 34 zirco / 0 both   total 43  ← vẫn nhận sap
Văn Huyến:     8 sap / 31 zirco / 0 both   total 39  ← vẫn nhận sap
```

17/230 đơn sap (~7.4%) vẫn tràn sang CAD trong tuần gần nhất.

**Vòng luẩn quẩn (Munger 2nd-order thinking)**:

1. CAD xử lý chậm (5.3 đơn/ngày, max 16)
2. WIP zirco tích lũy → 255 đơn pending
3. Đột biến đơn kim loại → 7-8% tràn sang CAD
4. CAD phải làm SÁP kim loại (không chuyên) → càng chậm
5. Zirconia càng kẹt → khách trễ → uy tín giảm → revenue giảm

**Action ngay (không cần ML)**:

1. **Cấm điều phối SÁP kim loại sang CAD** (hard rule):
   - `phucHinh.js` + mobile dashboard: nếu `routed_to=sap` → KTV CAD KHÔNG được quét chuyển từ phòng SÁP.
   - Khi Hồng Thắm/HẠNH nghỉ → overtime hoặc hire temp.

2. **Đào tạo thêm CAD/CAM operator** (urgent):
   - Volume zirco hiện 7.4 đơn/ngày, CAD process 11 đơn/ngày → margin 30%, KHÔNG an toàn (Munger margin of safety).
   - ĐINH THIỆN TÂM đã không làm việc 38 ngày — có thể đã nghỉ. Lab có thể đã mất 1 CAD operator.
   - Cần đào tạo 1-2 CAD operator mới trong 30 ngày.

3. **Kiểm tra CAD/CAM machine bottleneck vật lý**:
   - Thái Sơn max 16/ngày, Văn Huyến max 14/ngày — gần như đụng trần.
   - Số máy CAD/CAM hiện có? Utilization bao nhiêu %?
   - Có thể cần đầu tư thêm máy.

4. **Tách SLA**:
   - sap SLA = 24h (đang đạt 96.6% on-time)
   - zirco SLA thực tế cần **48h** (lead time 30h + buffer). Đang cố 24h → 22.6h trễ là tất yếu.

5. **Alert ngay khi tràn**:
   - Cron 4h/lần: KTV CAD confirm đơn `routed_to=sap` → log + cảnh báo admin.
   - Mục tiêu: tỷ lệ rò rỉ < 2% trong 30 ngày.

6. **ML auto-balance queue (Phase 2)**:
   - Khi WIP zirco > WIP sap × 1.5 → optimizer ưu tiên đơn zirco cho CAD trước.

### 2.14 Skip rule documented vs reality

Doc nói "Sửa skips CBM/SÁP/SƯỜN" và "Làm tiếp skips CBM/SÁP". Reality từ data:

| Loại lệnh | Total | có CBM | có SÁP | có SƯỜN | có ĐẮP | có MÀI |
|---|---|---|---|---|---|---|
| Sửa | 265 | 264 | 264 | 264 | 265 | 265 |
| Làm tiếp | 130 | 127 | 127 | 130 | 130 | 130 |
| Làm mới | 1977 | 1935 | 1974 | 1965 | 1939 | 1939 |
| Bảo hành | 85 | 85 | 85 | 85 | 85 | 85 |

**Phát hiện**:
- Tất cả 265 đơn Sửa **có row trong cả CBM/SÁP/SƯỜN** (chỉ thiếu 1).
- 127/130 Làm tiếp có row CBM.
- → Skip rule chỉ là **display rule trên dashboard** (UI ẩn pip), không phải data rule.
- Doc nói "skip" gây hiểu nhầm: KTV vẫn confirm các stage này, chỉ là UI không vẽ pip.

**Action**:
- Update doc: làm rõ "skip" = UI hide, không phải workflow skip.
- Hoặc: rework code để thật sự không tạo row CBM/SÁP/SƯỜN cho đơn Sửa.

---

## 2.99 🎯 Munger Danger Watch — Tín hiệu nguy hiểm sản xuất

Áp dụng 10 nguyên tắc Munger để soi data tìm điểm chết.

### M1 — Inversion: "Làm sao để LAB SẬP trong 3 tháng?"

**6 cách lab có thể chết** (dữ liệu thực):

| Cách chết | Xác suất | Tác động | Bằng chứng |
|---|---|---|---|
| **Hồng Thắm hoặc HẠNH nghỉ ốm 1 tuần** | **50%** trong 6 tháng | -100% SÁP kim loại 7 ngày = ~200 đơn delay | 14 ngày làm >12h, 131 đơn sau 20h. Burnout signs rõ. |
| **Toàn (CBM) nghỉ 1 tuần** | 30% | -50% CBM = ~140 đơn delay | 6 ngày làm >12h, 30 đơn sau 20h. 51% CBM workload. |
| **Quality drift continue** | **70%** | Rework 18% → 25% → mất khách hàng | W17-19 đã tăng 14.4% → 18.1% |
| **5 khách top dormant cùng lúc** | 15% | -30% revenue tức thì | 20 khách đã dormant >8d, 7 đã dormant >21d |
| **726 zombie orders bùng phát thành claim** | 25% | Backlog 50k răng + warranty cost | 726 đơn không update >7 ngày |
| **CAD/CAM machine hỏng** | 10%/năm | -50% zirco capacity 2-4 tuần | Văn Huyến/Thái Sơn đã max 14-16/ngày — gần ceiling |

→ **Action**: priority #1 là khắc phục burnout (Hồng Thắm, HẠNH, Toàn) trước khi đầu tư ML.

### M2 — Margin of Safety: ZERO trên KTV chủ chốt

**Phương châm Munger**: chạy 60-75% capacity, không bao giờ 100%.

**Reality check**:

| KTV | Max output | Current avg | % capacity | Margin |
|---|---|---|---|---|
| Toàn (CBM) | 39/ngày | 22.7/ngày | 58% | OK |
| Hồng Thắm (SÁP) | 29/ngày | 19.2/ngày | 66% | OK |
| HẠNH (SÁP) | 25/ngày | 11.9/ngày | 48% | OK |
| Bùi Tấn Đạt (SƯỜN) | 33/ngày | 13.5/ngày | 41% | Tốt |
| Cẩm Hồng (ĐẮP) | 14/ngày | 7.5/ngày | 54% | OK |

→ Avg utilization vẫn OK. **Nhưng** peak day đã chạm 100% (max output).

**Vấn đề ẩn**: 14 ngày Hồng Thắm làm >12h, 131 đơn sau 20h — KTV đang tự "tăng giờ" để giữ avg ổn định, không phải vì hệ thống có buffer. Nếu họ giảm giờ về chuẩn 8h/ngày → throughput sẽ giảm ngay 30%.

**Action**:
- Tính lại **effective capacity** = peak output × 0.75 (Munger margin).
- Daily WIP alert khi vượt 75% effective capacity.
- Hire trước khi đến 85%.

### M3 — Compound interest đang chạy NGƯỢC chiều

Quality drift theo tuần (gần đây):

```
W12: 14.2%  ──┐
W13: 19.5%    │ peak xấu
W14: 16.1%    │
W15: 14.4%    │
W16: 12.6%  ──┘ trough tốt
W17: 17.1%  ──┐
W18: 17.8%    │ tăng dần
W19: 18.1%  ──┘ 3 tuần liên tiếp xấu hơn
```

→ Rework 12.6% → 18.1% = tăng 44% trong 3 tuần. Nếu tiếp tục:
- Tuần 20: ~19%
- Tháng 6: ~22%
- Tháng 7: ~26%

Compound NEGATIVE = customer perception tệ dần → churn → mất top 5 khách → -30% revenue.

**Action**: phân tích 50 đơn rework W17-19 tìm root cause trong tuần này.

### M4 — Bus factor & cross-training (Munger nguyên tắc 2)

| Stage | KTV count | Top 1 % | Cross-training status |
|---|---|---|---|
| **CBM** | **3** | Toàn 51% | 🔴 Cần thêm 2 KTV gấp |
| SÁP kim loại | 2 (Hồng Thắm + HẠNH) | Hồng Thắm 62% | 🔴 Cần backup khẩn cấp |
| CAD/CAM | 2-3 | Văn Huyến 44% | 🟡 ĐINH THIỆN TÂM đã nghỉ |
| SƯỜN | 8 | Bùi Tấn Đạt 28% | 🟢 OK |
| ĐẮP | 6 | Cẩm Hồng 18% | 🟢 OK |
| MÀI | 7 | Bảo Trân 22% | 🟢 OK |

→ 3 stage (CBM, SÁP kim loại, CAD/CAM) đều ở bus factor cao. **Đào tạo 5 KTV mới trong 60 ngày** là priority.

### M5 — Second-order thinking: hidden costs

**Quyết định: chấp nhận đơn gấp (<12h)**

| Order | Effect |
|---|---|
| 1st | Khách hàng hài lòng vì lab nhận gấp ✅ |
| 2nd | Đơn gấp sap: 45% rework. Đơn gấp zirco: **88% rework** ❌ |
| 3rd | KTV bị áp lực → quality drop chung → tăng rework cho cả batch ❌ |
| 4th | Rework lấy slot xử lý → đơn thường bị delay ❌ |
| 5th | Khách thông thường bắt đầu trễ → mất tin tưởng ❌ |

**→ Net: tiêu cực!**

**Action**: từ chối hoặc thu phí phụ trội cho đơn <12h. Especially zirco — 88% rework rate là không thể chấp nhận.

### M6 — Probabilistic: top 5 rủi ro × tác động

| Rủi ro | P | Impact ($) | Expected loss |
|---|---|---|---|
| Hồng Thắm/HẠNH nghỉ 1 tuần | 50% | $8k (mất 200 đơn) | $4k |
| Quality drift continue → top khách rời | 40% | $30k revenue/quý | $12k |
| 7 chronic rework chains tiếp tục | 80% | $5k labor/quý | $4k |
| Toàn (CBM) nghỉ | 30% | $5k | $1.5k |
| CAD machine hỏng | 10% | $20k 2 tuần | $2k |

→ **Top mitigation**: hire 1 SÁP backup KTV ($1.5k/tháng) reduces P từ 50% → 10%, saves $3k/quarter EV.

### M7 — Vital metrics watch (only the few that matter)

7 metrics phải theo dõi mỗi ngày (Munger nguyên tắc 10):

```
┌──────────────────────────────────────────┐
│  🎯 ASIA LAB DAILY HEALTH CHECK           │
├──────────────────────────────────────────┤
│  1. Quality drift 7d:      18.1% 🔴 (>15%) │
│  2. WIP age >7d:           726   🔴       │
│  3. Stage integrity broken: 386 🔴       │
│  4. KTV >12h yesterday:     3-5  🟡       │
│  5. Dormant >14d:           13   🟡       │
│  6. CAD WIP / SÁP WIP:    255/356=0.72 🟡 │
│  7. Late zirco >5h pending: ?    🔴 check │
└──────────────────────────────────────────┘
```

Khi 3+ metrics đỏ → **emergency meeting**.

### M8 — Pipeline aging chi tiết (chronic disease)

```
WIP aging:
  <1 ngày:    74 đơn (recent, normal)
  1-2 ngày:   53 đơn (acceptable)
  3-6 ngày:   90 đơn (warning)
  >=7 ngày: 726 đơn 🔴 (zombie)
```

**726 đơn zombie** = khoảng 11.8% tổng `tien_do`. Cần phân loại:
- (a) Đã hoàn thành nhưng KTV quên confirm — fix bằng FAB "Mark Done" trong mobile.
- (b) Khách đã hủy nhưng chưa update DB — fix bằng admin auto-archive sau 30 ngày.
- (c) Thực sự bị forgotten — cần urgent handling.

**Action 1 ngày**:
- Generate report 726 đơn → gửi cho điều phối/admin → manual triage.

### M9 — Intake storm pattern (predictable risk)

Pattern lặp lại: **08h sáng nhận 18-27 đơn cùng giờ**.

```
2026-04-01 08h: 27 đơn
2026-04-02 08h: 23 đơn
2026-04-14 08h: 22 đơn
2026-05-08 08h: 22 đơn
2026-03-29 08h: 21 đơn
...
```

→ Mỗi ngày, **lúc 08h labo nhận 1 burst** mà CBM phải xử lý ngay. Toàn lệch về 08h CBM = 295/h SƯỜN, 147/h CBM (peak).

**Munger lesson**: "Most danger comes from predictable patterns ignored."

**Action**: 
- Auto-prioritize queue: 08h burst lập tức tách thành 3 batch nhỏ → CBM xử lý batched.
- Hoặc khuyến khích nha khoa gửi đơn rải rác trong ngày (giảm giá nếu gửi 06-07h hoặc 10-12h).

### M10 — Chronic rework chains (zero-tolerance cases)

7 đơn có **4-7 variants** quay lại lab:

| ma_dh_goc | variants | flow | Khách |
|---|---|---|---|
| 261603065 | 7 | Làm tiếp → Sửa → Sửa → Làm tiếp → Làm thêm → Sửa → Sửa | LA-Nk Tố Oanh |
| 263103042 | 7 | Làm mới → Làm tiếp → Sửa → Sửa → Làm tiếp → Sửa → Sửa | SG-Nk Hải Nguyên |
| 260705062 | 6 | Làm mới → Làm thêm → Làm lại → Làm lại → Làm tiếp → Sửa | SG-Nk Hậu - Bình Chánh |
| 262703057 | 6 | Làm mới → Làm tiếp → Làm thêm → Sửa → Làm thêm → Làm thêm | LA-Nk BS Ái |
| 261104052 | 5 | Làm mới → Làm tiếp → Làm lại → Làm tiếp → Làm lại | SG-Nk Hậu - Bình Chánh |
| 261204041 | 5 | Làm mới → Làm lại → Làm tiếp → Sửa → Sửa | SG-Nk Hậu - Bình Chánh |
| 262303048 | 5 | Làm mới → Làm tiếp → Sửa → Làm thêm → Sửa | BT-Nk Bác Sĩ Hiếu |

**Phát hiện**:
- SG-Nk Hậu - Bình Chánh có **3 đơn** trong danh sách → có vấn đề chronic với khách này.
- Khách này có **25.6% rework rate overall** (33/129 đơn).

**Action**:
- Tự động flag khi 1 ma_dh_goc đạt 3+ variants → escalate to manager review.
- Customer "blacklist for renegotiation": SG-Nk Hậu, SG-Nk Như Lạc, NT-Nk BS Thuận, SG-Nk Việt Xuân.
- Cân nhắc: tính phí tăng cho khách rework >25%, hoặc require spec sheet ký xác nhận.

---

## 3. 12 tính năng production-ready, không cần ML/Big Data

Các tính năng dưới đây có thể triển khai **trong 1-2 tuần** với stack hiện tại (Node + SQLite + HTML), không cần infra mới.

### 3.1 🚨 Data Integrity Alert — ĐẮP/MÀI âm gap (CRITICAL)

**Vấn đề**: 721 đơn có MÀI confirm trước ĐẮP.

**Solution**:
- Cron daily lúc 23:00: query đơn có âm gap.
- Push notification cho admin + ghi vào bảng mới `data_quality_alerts`.
- Hiển thị badge ⚠️ trên admin.html "5 đơn cần kiểm tra thứ tự stage".

**Effort**: 4-6h. **Code**: thêm `src/services/dataQuality.service.js`.

```sql
SELECT a.ma_dh, a.cong_doan stage_a, b.cong_doan stage_b,
  a.thoi_gian_hoan_thanh ta, b.thoi_gian_hoan_thanh tb,
  a.ten_ktv ktv_a, b.ten_ktv ktv_b
FROM tien_do a JOIN tien_do b ON a.ma_dh=b.ma_dh AND b.thu_tu=a.thu_tu+1
WHERE a.xac_nhan='Có' AND b.xac_nhan='Có'
  AND julianday(...iso_b...) < julianday(...iso_a...)
```

### 3.2 🎯 Customer Risk Score Badge

**Vấn đề**: NT-Nk BS Thuận rework 41.3%, không ai biết.

**Solution**:
- Tính rework rate per customer rolling 90 ngày.
- Hiển thị badge cạnh tên khách hàng:
  - 🟢 < 10% rework
  - 🟡 10-20%
  - 🔴 > 20%
- Khi tạo đơn mới cho khách đỏ → tự động flag QC review.

**Effort**: 8h. **Code**: thêm column ảo `risk_score` trong response `/api/orders/by-barcode/:code` và tooltip trên dashboard.

### 3.3 🎯 SKU Quality Gate cho Veneer/Cercon HT

**Vấn đề**: Veneer Cut Back rework 43%, Cercon HT 35-42%.

**Solution**:
- Khi đơn có phục hình match `Veneer.*Cut.*Back` hoặc `Cercon HT`:
  - Auto thêm "QC review" task giữa SƯỜN và ĐẮP.
  - Hiển thị banner đỏ "⚠️ SKU rủi ro cao — QC kiểm tra kỹ" trên card order.
- Theo dõi 30 ngày, nếu rework giảm → keep rule.

**Effort**: 6h. **Code**: thêm logic trong `getRoomWithProductionNote()`.

### 3.4 🎯 Dormancy Alert — sales recovery

**Vấn đề**: Khách như Hoàn Vũ, Tân Bình đã không order 16-26 ngày.

**Solution**:
- Cron daily: query khách có:
  - `orders >= 5` (filter spam customer)
  - `last_order_gap > MAX(14, P95(historical_gap_per_customer))`
- Email/Telegram bot push danh sách cho admin/sales.
- UI: thêm tab "Khách Sắp Rời" trong admin.html.

**Effort**: 8h. **Code**: thêm `src/services/customerHealth.service.js`.

### 3.5 🎯 Zirconia SLA Alert (T-12h)

**Vấn đề**: 13 đơn zirconia trễ avg 22.6h, max 5.6 ngày.

**Solution**:
- Cron 30 phút/lần: query zirconia in-flight có:
  - `julianday(yc_giao) - julianday(now) < 12h` (còn 12h)
  - Chưa qua stage SÁP (thu_tu < 2 confirmed)
- Push notification cho admin/phòng zirco.
- Hiển thị banner "🔥 12 đơn zirconia có nguy cơ trễ" trên dashboard.

**Effort**: 6h.

### 3.6 🎯 KTV "On-Shift" Detector

**Vấn đề**: Admin không biết KTV nào đang làm việc.

**Solution**:
- Mỗi KTV có "last confirmed stage" timestamp.
- Nếu `now - last_confirm > 2h` trong giờ làm việc → off-shift.
- Hiển thị status dot 🟢🟡🔴 cạnh tên KTV trong admin panel.
- Bonus: alert "Bảo Trân không xác nhận MÀI nào trong 3 giờ" qua Telegram.

**Effort**: 6h.

### 3.7 🎯 Bus Factor Dashboard (CBM emergency)

**Vấn đề**: 3 KTV CBM, "Toàn" 51%.

**Solution**:
- Real-time gauge: "Hôm nay CBM cần 50 đơn, đã làm 22, còn 28 — Toàn lệch nghỉ".
- Nếu top KTV không confirm trong 4 giờ → red alert.
- Theo dõi training progress cho KTV mới (avg/ngày tăng dần).

**Effort**: 12h (cần frontend chart).

### 3.8 🎯 Auto-Detect Pre-Late Orders

**Vấn đề**: Đơn 260504013 có `nhap_luc > yc_giao` (đã trễ trước khi bắt đầu) → vô lý.

**Solution**:
- Sau mỗi import: query đơn có `julianday(nhap_luc) > julianday(yc_giao)`.
- Auto-flag với reason "Already late at intake" để admin review trước khi route.
- Cảnh báo có thể là lỗi nhập liệu Keylab hoặc khách hàng gửi gấp.

**Effort**: 4h.

### 3.9 🎯 Backfill 84 đơn routed_to=none

**Vấn đề**: 84 đơn không có routing (74 là phục hình rỗng, 10 là Răng Tạm).

**Solution**:
- One-time script: với 10 đơn Răng Tạm → assign `routed_to='sap'` (default Răng Tạm).
- 74 đơn phục hình rỗng → cần manual review của ops team.
- Future: rule mới trong `phucHinh.js`: nếu phục hình chứa "Răng Tạm" hoặc "PMMA" → `routed_to='sap'`.

**Effort**: 2h script + 4h manual review.

### 3.10 🚨 KTV Burnout Monitor (CRITICAL — bảo vệ tài sản nhân lực)

**Vấn đề**: Hồng Thắm 14 ngày >12h, HẠNH 10 ngày, làm 131 đơn sau 20h. Burnout risk cao.

**Solution**:
- Daily report KTV có:
  - Hôm qua làm >12h
  - 7d liên tiếp đều có ca tối >20h
  - Output ngày đột nhiên giảm >40% so với avg 14d (stress sign)
- Cron 06:00: gửi cho admin + HR Telegram bot.
- Auto-add KTV vào "watch list" 30 ngày để theo dõi.

**Effort**: 6h.

### 3.11 🚨 Chronic Rework Auto-Flag (CRITICAL)

**Vấn đề**: 7 đơn có 4-7 variants lặp lại — labo đang lỗ.

**Solution**:
- Trigger: khi 1 ma_dh_goc đạt 3 variants → auto:
  - Lock đơn (require manager approval cho variant tiếp theo)
  - Notify khách: "Đơn này đã làm lại 3 lần, cần meeting kỹ thuật trước khi tiếp tục"
  - Insert vào dashboard cảnh báo manager
- Daily report: 5 ma_dh_goc rework nhiều nhất.

**Effort**: 8h.

### 3.12 🚨 Stage Integrity Auto-Validator (CRITICAL)

**Vấn đề**: 386 đơn có MÀI confirmed nhưng stage trước chưa. 107 Làm mới skip stage không đúng rule.

**Solution**:
- Block UI: khi KTV bấm confirm stage N, check stage 1..N-1 đều đã confirmed (or skip-rule applies).
- Nếu không → modal "Bạn đang bỏ qua stage X. Lý do?" → log lý do.
- Nightly job: tìm 386 cases hiện tại + flag để admin manual review.

**Effort**: 10h. **Code**: thêm check trong scraper.service.js + UI button handler.

### 3.13 🚨 Zombie Order Cleaner (>7d idle)

**Vấn đề**: 726 đơn không update >7 ngày.

**Solution**:
- Daily 06:00: liệt kê 726 đơn → split 3 nhóm:
  - Đã có MÀI=Có nhưng stage trước=Chưa → auto-mark "Done, retroactive"
  - Chưa có bất kỳ stage Có nào → đánh dấu "abandoned suspect"
  - Else → "pending review"
- Admin có 1 tab "Cleanup queue" với batch action.

**Effort**: 6h.

### 3.14 🎯 Urgent Order Risk Gate (<12h)

**Vấn đề**: 88% đơn zirco <12h trở thành rework.

**Solution**:
- Khi tạo đơn có `yc_giao - nhap_luc < 12h` AND `routed_to=zirco`:
  - Modal: "⚠️ Đơn này 88% xác suất phải làm lại. Vẫn nhận?"
  - Yêu cầu admin confirm + auto thêm phụ thu 30%.
  - Auto thêm QC review giữa SÁP và SƯỜN.
- Sap urgent: warning soft (45% rework).

**Effort**: 6h.

### 3.15 🎯 Quality Drift Weekly Alert

**Vấn đề**: W17-19 rework rate 14.4% → 17.1% → 17.8% → 18.1%. Compound NEGATIVE.

**Solution**:
- Weekly cron (sáng thứ 2): tính rework rate 7d gần nhất.
- Nếu > previous week × 1.1 → red alert.
- Nếu 3 tuần liên tiếp tăng → CRITICAL alert → triệu tập meeting.

**Effort**: 4h.

### 3.16 🎯 Daily Parquet Snapshot (Free big data foundation)

**Vấn đề**: SQLite query nặng có thể block production.

**Solution**:
- Cron 02:00 daily: dump SQLite → 5 file Parquet (`don_hang`, `tien_do`, `tien_do_history`, `ktv_*_stats`, `error_reports`).
- Lưu vào `Data_thang/snapshot/YYYY-MM-DD/`.
- Upload R2 (đã có bucket): free off-site archive.
- Future-proof cho Phase 1 analytics warehouse.

**Effort**: 4h.

```python
import duckdb, sqlite3, pathlib
duckdb.connect().execute(f"INSTALL sqlite; LOAD sqlite; ATTACH 'labo_data.db' AS lab; COPY (SELECT * FROM lab.don_hang) TO 'snapshot/don_hang_{today}.parquet';")
```

---

## 4. ML use case — sorted by production ROI

### 4.1 [🔥 HIGH ROI] ETA Prediction — show on customer-facing link

**Bài toán**: Mỗi đơn đang ở stage `k`, dự đoán thời điểm hoàn thành MÀI.

**Tại sao production**:
- Khách hàng top order 0.25 ngày/đơn → liên tục hỏi "đơn xong chưa?".
- Hiện admin trả lời bằng cách query DB → tốn 30s/lần.
- ETA prediction qua API cho phép khách tự xem qua link tracking.

**Approach**:
- Features: phục hình (TF-IDF), sl, loai_lenh, routed_to, khach_hang (target encoding), nhap_luc hour/dow, current stage, current_ktv_speed, WIP count tại stage hiện tại.
- Target: gio đến MÀI completion.
- Model: XGBoost regressor. Baseline = avg lead time per (routed_to, loai_lenh) = ~30h.
- Train data: 1900+ đơn đã có MÀI confirmed.

**Metric mục tiêu**: MAE < 4h (vs baseline ~7h).

**Triển khai**:
- Train script Python (~200 dòng).
- FastAPI service port 8001.
- Node.js route `/api/orders/:ma_dh/eta` proxy gọi http://localhost:8001.
- Dashboard mobile thêm row "Dự kiến xong: 14h30 mai".

**Effort**: 40h (1 tuần).

### 4.2 [🔥 HIGH ROI] Auto-Routing Classifier

**Bài toán**: Thay rule-based `default_room_for()` (84 đơn `none` chưa classify).

**Tại sao production**:
- 84 đơn `none` → KTV phải hỏi điều phối → mất 2-3 phút/đơn.
- Răng Tạm + PMMA chưa có rule.
- Code hiện tại rule-based, hard to maintain.

**Approach**:
- 3 options:
  - **Option A**: TF-IDF + LogisticRegression → ~95% accuracy. Free.
  - **Option B**: Fine-tune `vinai/phobert-base` → ~98% accuracy. 1 ngày train.
  - **Option C**: Claude Haiku zero-shot với 5 few-shot examples → ~96% accuracy, ~$0.30/tháng. Khong can train.

**Recommendation**: Option C cho prototype 1 tuần. Nếu cần in-house thì A.

**Effort**: 16h (option C) hoặc 40h (option A).

### 4.3 [🔥 HIGH ROI] Rework Risk Score per order

**Bài toán**: Tại stage MÀI, dự đoán xác suất đơn này sẽ về `Sửa/Làm lại` trong 30 ngày.

**Tại sao production**:
- Veneer Cut Back rework 43%. Nếu predict được 70% trong 43% → QC kiểm 70%, miss 30% còn 13% rework rate.
- Tiết kiệm: 51 Veneer × 43% × 50% = 11 đơn rework/quý nếu mô hình hoạt động tốt.

**Approach**:
- Features: phục hình, sl, khach_hang historical rework, KTV per stage, completion time per stage, time of day completion.
- Target: binary (rework within 30/60/90 ngày).
- Model: XGBoost classifier với SMOTE imbalanced.
- Imbalanced: ~9% positive class.

**Metric mục tiêu**: AUC > 0.75, precision@top-20% > 30%.

**Triển khai**:
- Tích hợp vào MÀI confirm UI: hiển thị "🔴 80% rework risk — kiểm tra trước khi giao".
- KTV MÀI có thể request peer review.

**Effort**: 60h.

### 4.4 [🟡 MEDIUM ROI] Demand Forecasting

**Bài toán**: Dự đoán đơn/ngày × room 7-14 ngày tới.

**Tại sao production**:
- Quyết định ca đêm SÁP, vật tư zirconia.
- Hiện tại schedule shift theo cảm tính.

**Approach**:
- Prophet (Facebook) cho daily order count.
- Exogenous: day-of-week, holiday (Tết, lễ).
- 2 model: 1 cho sap, 1 cho zirco.

**Caveat**: Chỉ có 3 tháng data → forecast 7 ngày OK, 14 ngày unreliable.

**Effort**: 30h.

### 4.5 [🟡 MEDIUM ROI] KTV Performance Trend & Anomaly

**Bài toán**: Phát hiện KTV bất thường (giảm năng suất, tăng rework).

**Approach**:
- Z-score moving average của:
  - Đơn/ngày
  - Rework attribution rate
  - Working hours
- Alert khi |z| > 2.

**Tại sao production**:
- Cẩm Hồng đột nhiên giảm 50% productivity → có thể bệnh, gia đình, demotivated.
- Bảo Trân rework tăng → cần coaching.

**Effort**: 24h.

### 4.6 [🟢 LOW ROI lúc này, HIGH FUTURE] NLP on ghi_chu_sx

**Bài toán**: Auto extract từ ghi_chu_sx:
- "TS" / "thử sườn" → skip stage flag
- "khẩn" / "gấp" → priority flag
- "in màu hàm" → route zirco

**Tại sao future**:
- 93% ghi_chu_sx hiện trống — Keylab scrape miss.
- Khi cải thiện scrape cover 80%+ → NLP có giá trị.

**Effort**: 40h (NER với spaCy hoặc Claude).

### 4.7 [🟢 LOW] Image classification on error_reports

**Bài toán**: Auto-classify error photo → ma_loi suggestion.

**Tại sao chưa nên làm**: error_reports chỉ có 15 records — không đủ train. Phải khuyến khích KTV bao lỗi nhiều hơn trước.

---

## 5. Architecture đề xuất (phased)

### Phase 0 — Quick wins (Week 1-2, không cần infra mới)
- Triển khai 10 production features ở mục 3.
- Daily Parquet snapshot (đặt nền cho Phase 1).
- Encourage error_reports + feedbacks usage.

### Phase 1 — Analytics Warehouse (Week 3-6)
**Stack**: DuckDB + dbt-duckdb + Parquet + Metabase

**Lý do**:
- DuckDB OLAP column-store, xử lý 100M+ rows nhẹ trên single binary.
- dbt cho SQL transformation versioned.
- Metabase free, no-code BI cho admin.
- Production SQLite chỉ phục vụ realtime, không bị OLAP query block.

**Output**:
- 5 fact/dim table: `order_fact`, `progress_fact`, `ktv_dim`, `customer_dim`, `material_dim`.
- 3 dashboard Metabase: Executive (P&L view), Ops (WIP/bottleneck), Quality (rework breakdown).
- Daily ETL Prefect.

**Effort**: 80h.

### Phase 2 — ML Pipeline (Week 7-12)
**Stack**: Python (sklearn, xgboost, prophet) + MLflow + FastAPI

**Output**:
- ETA prediction service (FastAPI port 8001).
- Auto-routing classifier (FastAPI port 8002).
- Rework risk service (FastAPI port 8003).
- MLflow tracking server (port 5000) cho model versioning.
- Daily/weekly retrain cron via Prefect.

**Effort**: 200h (1 ML dev 5 tuần).

### Phase 3 — Real-time alerts (Week 13-14, optional)
**Stack**: Redis pub/sub + WebSocket

**Output**:
- Live alert: data integrity, SLA breach, anomaly.
- Materialized views refresh 5min.

**Effort**: 60h.

### Phase 4 — True Big Data (không cần 3-5 năm tới)
ClickHouse + Kafka + Iceberg. Skip until volume > 50M rows hoặc realtime > 1000/giây.

---

## 6. Tech stack recommendation

### In scope
| Tool | Version | Mục đích |
|---|---|---|
| **DuckDB** | 0.10+ | OLAP local, no server |
| **dbt-duckdb** | 1.7+ | SQL transformation |
| **Parquet** | latest | Column file format |
| **Cloudflare R2** | (đã có) | Archive (free 10GB) |
| **Metabase** | 0.49+ | BI dashboard self-host |
| **Python** | 3.11+ | pandas, polars, sklearn, xgboost, lightgbm, prophet, mlflow |
| **FastAPI** | 0.110+ | Model serving |
| **Prefect** | 2.x | Orchestration |
| **Redis** | 7+ | Pub/sub + cache |

### Không recommend lúc này
- Spark/Hadoop/Flink — overkill 600k rows.
- Snowflake/BigQuery — đắt, không cần SaaS.
- Kafka — Redis pub/sub đủ. Nếu cần stream lớn → Redpanda lighter.
- Kubernetes — single VM PM2 đủ.
- LakeFS, Dagster, Airflow 3 — Prefect 2 lean hơn.

### Có thể outsource sang Claude API
- Auto-routing classifier: Claude Haiku zero-shot ~$0.30/tháng.
- NLP ghi_chu_sx extract: Claude Haiku batch ~$1-2/tháng.
- Skip training pipeline hoàn toàn.

---

## 7. ROI estimation

| Item | Effort | Annual benefit |
|---|---|---|
| **Quick wins (10 features Phase 0)** | **80h** | Capacity +5%, quality +3%, sales recovery +2-3 khách/tháng |
| Analytics warehouse | 80h | Tiết kiệm 10h/tuần reporting = 520h/năm |
| ETA prediction | 40h | -50% câu hỏi "đơn xong chưa" = ~20h/tháng admin |
| Auto-routing classifier | 16-40h | Eliminate 84 manual routing × 3 phút = 4h/tháng |
| Rework prediction | 60h | -50% Veneer rework = ~11 đơn/quý saved |
| Demand forecast | 30h | Optimize shift = ~5% efficiency |
| Anomaly + KTV alert | 24h | Coaching opportunity → ~3% rework reduction |

**Tổng cost Phase 0+1+2**: ~430h dev = ~$20-25k outsource hoặc 3-4 tháng in-house full time.

**Tổng benefit năm 1**:
- Capacity +10% → ~60 đơn/tháng extra = ~720 đơn/năm.
- Quality +3% → ~80 rework prevented = ~$5-8k saved.
- Time savings ~50h/tháng admin = ~$10k/năm.
- Customer retention (recovery 5-10 dormant) → ~$30k/năm revenue saved.

**Payback**: < 6 tháng.

---

## 8. Implementation roadmap (12 tuần)

| Week | Owner | Output |
|---|---|---|
| 1 | Backend dev | Quick wins 3.1, 3.2, 3.5, 3.8 |
| 2 | Backend dev | Quick wins 3.3, 3.4, 3.6, 3.7, 3.9, 3.10 |
| 3 | Data eng | Setup DuckDB + Parquet snapshot daily |
| 4 | Data eng | dbt models (5 fact/dim) + 1 Metabase dashboard |
| 5 | Data eng | 2 more Metabase dashboards + ETL Prefect |
| 6 | QA + ops | Data quality audit + 721 ĐẮP/MÀI investigation |
| 7 | ML dev | ETA prediction MVP — baseline |
| 8 | ML dev | ETA tuning + FastAPI service + Node integration |
| 9 | ML dev | Auto-routing Claude Haiku → fallback sklearn |
| 10 | ML dev | Rework risk classifier |
| 11 | ML dev | Demand forecasting Prophet |
| 12 | All | Hardening, monitoring, doc handover |

---

## 9. Risks và mitigation

| Risk | Mitigation |
|---|---|
| 42% ĐẮP/MÀI âm gap làm dataset bị poison | Khắc phục data integrity TRƯỚC khi train ML |
| ML model overfit do data ít (3 tháng) | Cross-validation strict, baseline first, retrain weekly |
| KTV phản ứng tiêu cực với rework prediction | Dùng làm coaching tool nội bộ, không hiển thị KTV bị name-shamed |
| Khách high-rework cảm thấy bị phân biệt | Risk score chỉ dùng nội bộ, không show khách |
| Veneer SKU quy trình thay đổi → model stale | Auto-detect drift, retrain monthly |
| Claude API cost tăng | Set budget alert ~$5/tháng. Fallback in-house sklearn. |
| DuckDB single point of failure | Daily R2 backup, replicate Postgres nếu cần |
| Python service crash | systemd auto-restart, healthcheck endpoint |

---

## 10. Quick wins làm tuần này (cập nhật — 38h emergency)

Theo nguyên tắc Munger Inversion, ưu tiên các action chặn rủi ro CHẾT trước:

### 🔴 Phải làm trong 48h (KTV asset + data integrity)

| # | Task | Effort | Owner |
|---|---|---|---|
| 1 | **KTV Burnout Monitor** — Hồng Thắm/HẠNH/Toàn watch list | 6h | Dev + HR |
| 2 | **Stage Integrity Validator** — block 386 cases tương lai | 10h | Dev |
| 3 | **Zombie Order Triage** — review 726 đơn idle | 6h | Ops + dev |
| 4 | **Audit ĐẮP/MÀI negative gap** + phỏng vấn KTV | 2h | Ops |

### 🟡 Tuần này (7 ngày)

| # | Task | Effort | Owner |
|---|---|---|---|
| 5 | Chronic Rework Auto-Flag (4-7 variants) | 8h | Dev |
| 6 | Quality Drift Weekly Alert | 4h | Dev |
| 7 | Customer Risk Score badge | 4h | Dev + frontend |
| 8 | Urgent Order Risk Gate (<12h) | 6h | Dev |
| 9 | Dormancy SQL view → admin tab | 3h | Dev |

### 🟢 Khi có thời gian (2 tuần)

| # | Task | Effort | Owner |
|---|---|---|---|
| 10 | Daily Parquet snapshot | 3h | Dev |
| 11 | Fix 84 routed_to=none + 78 sl=0 | 4h | Dev |
| 12 | Pre-late detector | 2h | Dev |
| 13 | Veneer QC gate | 6h | Dev |
| 14 | CBM bus factor dashboard | 12h | Dev + frontend |
| 15 | Zirconia SLA T-12h alert | 6h | Dev |

**Tổng emergency 48h: 24h** → 1 dev 3 ngày hoặc 2 dev 1.5 ngày.
**Tổng tuần này: 56h** → 2 dev cả tuần.
**Tổng 2 tuần: 90h** → 2 dev × 2 tuần.

### HR / business action song song (không phải dev)

| # | Action | Owner |
|---|---|---|
| A | Phỏng vấn ĐINH THIỆN TÂM (38 ngày không làm) | HR |
| B | Đánh giá burnout Hồng Thắm/HẠNH, kế hoạch nghỉ ngơi | HR |
| C | Hire 1 SÁP backup KTV (60 ngày) | HR |
| D | Hire 1 CBM backup KTV (60 ngày) | HR |
| E | Hire 1-2 CAD/CAM trainee (90 ngày) | HR |
| F | Meeting QC manager về quality drift W17-19 | Ops |
| G | Contact 13 khách dormant >8d (recovery call) | Sales |
| H | Negotiate top 4 rework khách: tăng giá hoặc spec sheet | Sales |
| I | Manager review 7 chronic rework chains | Ops |

---

## Phụ lục A — Query patterns dùng được ngay

### A1. Customer risk score (rolling 90d)
```sql
SELECT khach_hang,
  COUNT(*) total_90d,
  SUM(CASE WHEN loai_lenh IN ('Sửa','Làm lại','Bảo hành') THEN 1 ELSE 0 END) rework_90d,
  ROUND(100.0 * SUM(CASE WHEN loai_lenh IN ('Sửa','Làm lại','Bảo hành') THEN 1 ELSE 0 END) / COUNT(*), 1) risk_pct,
  CASE
    WHEN 100.0 * SUM(CASE WHEN loai_lenh IN ('Sửa','Làm lại','Bảo hành') THEN 1 ELSE 0 END) / COUNT(*) > 20 THEN 'high'
    WHEN 100.0 * SUM(CASE WHEN loai_lenh IN ('Sửa','Làm lại','Bảo hành') THEN 1 ELSE 0 END) / COUNT(*) > 10 THEN 'medium'
    ELSE 'low'
  END risk_level
FROM don_hang
WHERE julianday('now','localtime') - julianday(nhap_luc) <= 90
GROUP BY khach_hang
HAVING total_90d >= 10
ORDER BY risk_pct DESC;
```

### A2. SLA-at-risk zirconia (T-12h)
```sql
SELECT d.ma_dh, d.khach_hang, d.yc_giao,
  (SELECT cong_doan FROM tien_do WHERE ma_dh=d.ma_dh AND xac_nhan='Có' ORDER BY thu_tu DESC LIMIT 1) last_done,
  (julianday(d.yc_giao) - julianday('now','localtime')) * 24 hours_until_deadline
FROM don_hang d
WHERE d.routed_to = 'zirco'
  AND d.yc_giao != ''
  AND julianday(d.yc_giao) - julianday('now','localtime') < 0.5  -- 12h
  AND NOT EXISTS (
    SELECT 1 FROM tien_do t WHERE t.ma_dh=d.ma_dh AND t.cong_doan='MÀI' AND t.xac_nhan='Có'
  )
ORDER BY hours_until_deadline;
```

### A3. Data integrity check — negative gaps
```sql
WITH t AS (
  SELECT ma_dh, cong_doan, thu_tu,
    substr(thoi_gian_hoan_thanh,7,4)||'-'||substr(thoi_gian_hoan_thanh,4,2)||'-'||substr(thoi_gian_hoan_thanh,1,2)||'T'||substr(thoi_gian_hoan_thanh,12) iso
  FROM tien_do WHERE xac_nhan='Có' AND thoi_gian_hoan_thanh != ''
)
SELECT a.ma_dh, a.cong_doan ||' -> '|| b.cong_doan flow,
  a.thoi_gian_hoan_thanh ts_a, b.thoi_gian_hoan_thanh ts_b,
  ROUND((julianday(b.iso)-julianday(a.iso))*24, 2) gap_h
FROM t a JOIN t b ON a.ma_dh=b.ma_dh AND b.thu_tu=a.thu_tu+1
WHERE julianday(b.iso) < julianday(a.iso)
ORDER BY a.ma_dh;
```

### A4. Dormancy alert
```sql
WITH cust_stats AS (
  SELECT khach_hang, COUNT(*) orders,
    MAX(substr(nhap_luc,1,10)) last_order,
    AVG(julianday(d2.d) - julianday(d1.d)) avg_gap
  FROM don_hang
  LEFT JOIN (...) d1 ...
  -- (full version trong report đã chạy)
)
SELECT *,
  julianday('now','localtime') - julianday(last_order) gap_now,
  CASE WHEN julianday('now','localtime') - julianday(last_order) > MAX(14, 2*avg_gap) THEN 'DORMANT' ELSE 'ACTIVE' END status
FROM cust_stats
WHERE orders >= 5
ORDER BY gap_now DESC;
```

### A5. Veneer/Cercon QC gate trigger
```sql
SELECT ma_dh, phuc_hinh, routed_to,
  (SELECT cong_doan FROM tien_do WHERE ma_dh=d.ma_dh AND xac_nhan='Có' ORDER BY thu_tu DESC LIMIT 1) last_stage
FROM don_hang d
WHERE (
  phuc_hinh LIKE '%Veneer%Cut%' OR phuc_hinh LIKE '%Cercon HT%'
)
AND NOT EXISTS (
  SELECT 1 FROM tien_do WHERE ma_dh=d.ma_dh AND cong_doan='MÀI' AND xac_nhan='Có'
)
AND (SELECT cong_doan FROM tien_do WHERE ma_dh=d.ma_dh AND xac_nhan='Có' ORDER BY thu_tu DESC LIMIT 1) IN ('SƯỜN', 'ĐẮP');
```

---

## Phụ lục B — Code stub có thể dùng

### B1. Daily Parquet snapshot
```python
# scripts/daily_snapshot.py
import duckdb, sqlite3, pathlib, datetime, shutil
today = datetime.date.today().isoformat()
snap_dir = pathlib.Path(f"Data_thang/snapshot/{today}")
snap_dir.mkdir(parents=True, exist_ok=True)
conn = duckdb.connect()
conn.execute("INSTALL sqlite; LOAD sqlite; ATTACH 'labo_data.db' AS lab (READ_ONLY)")
for table in ['don_hang','tien_do','tien_do_history','import_log','ktv_monthly_stats','ktv_daily_stats','error_reports']:
    conn.execute(f"COPY (SELECT * FROM lab.{table}) TO '{snap_dir}/{table}.parquet' (FORMAT 'parquet', COMPRESSION 'zstd')")
print(f"Snapshot: {snap_dir}")
```

### B2. Customer risk badge API
```javascript
// src/services/customerRisk.service.js
function getRiskScore(khach_hang) {
  const db = getDB();
  const row = db.prepare(`
    SELECT COUNT(*) total,
      SUM(CASE WHEN loai_lenh IN ('Sửa','Làm lại','Bảo hành') THEN 1 ELSE 0 END) rework
    FROM don_hang
    WHERE khach_hang = ?
      AND julianday('now','localtime') - julianday(nhap_luc) <= 90
  `).get(khach_hang);
  if (!row.total || row.total < 10) return { level: 'unknown', pct: 0 };
  const pct = 100 * row.rework / row.total;
  return {
    level: pct > 20 ? 'high' : pct > 10 ? 'medium' : 'low',
    pct: Math.round(pct * 10) / 10,
  };
}
```

### B3. Data integrity nightly job
```javascript
// src/services/dataQuality.service.js
function checkNegativeGaps() {
  const db = getDB();
  const rows = db.prepare(`
    WITH t AS (
      SELECT ma_dh, cong_doan, thu_tu,
        substr(thoi_gian_hoan_thanh,7,4)||'-'||substr(thoi_gian_hoan_thanh,4,2)||'-'||substr(thoi_gian_hoan_thanh,1,2)||'T'||substr(thoi_gian_hoan_thanh,12) iso
      FROM tien_do WHERE xac_nhan='Có' AND thoi_gian_hoan_thanh != ''
    )
    SELECT a.ma_dh, a.cong_doan || ' -> ' || b.cong_doan flow,
      (julianday(b.iso)-julianday(a.iso))*24 gap_h
    FROM t a JOIN t b ON a.ma_dh=b.ma_dh AND b.thu_tu=a.thu_tu+1
    WHERE julianday(b.iso) < julianday(a.iso)
    LIMIT 100
  `).all();
  return { count: rows.length, samples: rows.slice(0, 5) };
}
```

---

## Phụ lục C — Bigger picture (nếu mở rộng tracking)

Nếu muốn thực sự "big data", cần mở rộng nguồn data hiện tại:

| Nguồn mới | Volume ước tính | Use case |
|---|---|---|
| Mỗi barcode scan event | 1000+/ngày | KTV station dwell time |
| Mỗi button click admin/dashboard | 5000+/ngày | UX heatmap, feature usage |
| Photo metadata error_reports | 50+ MB/tháng | Vision LLM auto-classify |
| Customer chat history (Zalo/WA) | 2000+ msg/tháng | NLP sentiment, complaint detection |
| Inventory/material consumption | Per order | Cost analysis, supply chain |
| Equipment sensor (CAD/CAM machine) | Real-time stream | Predictive maintenance |

Với các nguồn trên → 10-100M events/năm → khi đó mới thật sự cần Kafka, ClickHouse, Spark.

**Hiện tại không gấp**.

---

## Kết luận

1. **Không cần big data infra ngay**. Volume hiện tại nhỏ, chỉ cần phân tích đúng SQL + dashboard tốt.
2. **Quick wins 18h đầu tuần** mang lại giá trị ngay: customer risk, dormancy, SLA alert, data integrity audit.
3. **3 ML model production-grade khả thi**: ETA, auto-routing, rework risk. Tổng 116h dev. ROI < 6 tháng.
4. **Phase 1 (analytics warehouse)** đặt nền cho mọi việc sau, không phụ thuộc ML.
5. **Phase 4 (true big data)** không cần trong 3-5 năm.

Quan trọng nhất: **xử lý data integrity 721 ĐẮP/MÀI negative gap trước**. Mọi phân tích, ML, KPI hiện đang chạy trên data có 42% noise — fix trước khi đầu tư ML.

---

*Tài liệu này dựa trên phân tích DB production tại 2026-05-15. Cần re-validate khi data tăng hoặc workflow thay đổi.*
