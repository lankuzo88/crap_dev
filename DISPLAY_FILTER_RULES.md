# Quy tắc hiển thị và lọc đơn hàng

Tài liệu này ghi lại các quy tắc nghiệp vụ đang dùng trong dashboard/admin/mobile để sau này tham khảo khi sửa code.

## 1. Công đoạn user

User được gán một công đoạn trong tab User của admin.

Giá trị chuẩn đang dùng:

- `CBM`
- `sáp`
- `CAD/CAM`
- `sườn`
- `đắp`
- `mài`

Khi cần so với dữ liệu tiến độ trong DB/Excel, các giá trị user được map sang tên công đoạn DB:

- `CBM` -> `CBM`
- `sáp` -> `SÁP/Cadcam`
- `CAD/CAM` -> `SÁP/Cadcam`
- `sườn` -> `SƯỜN`
- `đắp` -> `ĐẮP`
- `mài` -> `MÀI`

Lưu ý: `sáp` và `CAD/CAM` hiện cùng đọc công đoạn DB `SÁP/Cadcam`.

## 2. Đơn user nhìn thấy

Mobile user lấy đơn qua API `/api/user/pending-orders`.

Một user chỉ thấy đơn nếu:

- User có `cong_doan`.
- Đơn còn nằm trong danh sách mã đơn active từ file Excel mới nhất.
- Dòng tiến độ của công đoạn user đang là chưa xác nhận.
- Công đoạn đó không bị bỏ qua bởi logic loại lệnh/ghi chú.

User không thấy đơn mà công đoạn của họ đã xác nhận xong.

Hiện chưa lọc theo tên KTV. Các user cùng công đoạn nhìn chung một danh sách pending của công đoạn đó.

## 3. Loại lệnh và công đoạn bỏ qua

Thứ tự công đoạn chuẩn:

1. `CBM`
2. `SÁP/Cadcam`
3. `SƯỜN`
4. `ĐẮP`
5. `MÀI`

Quy tắc bỏ qua công đoạn:

- `Sửa`: bỏ `CBM`, `SÁP/Cadcam`, `SƯỜN`; bắt đầu từ `ĐẮP`, rồi `MÀI`.
- `Làm tiếp`: bỏ `CBM`, `SÁP/Cadcam`; bắt đầu từ `SƯỜN`, rồi `ĐẮP`, `MÀI`.
- `Làm mới`: đi đủ quy trình chuẩn.
- `Làm lại`: đi như `Làm mới`.
- `Bảo hành`: đi như `Làm mới`.
- `Làm thêm`: đi như `Làm mới`, trừ khi ghi chú có rule đặc biệt như thử sườn.

Rule này dùng cho hiển thị stage/pip và cho lọc user pending.

## 4. Thử sườn

Thử sườn được nhận diện từ cột `Ghi chú điều phối`, lưu trong DB là `don_hang.ghi_chu`.

Các dấu hiệu hiện đang dùng:

- Có `TS` trong ghi chú.
- Có chữ `thử sườn` trong ghi chú.

Quy tắc thử sườn:

- Chỉ tính đến `CBM`, `SÁP/Cadcam`, `SƯỜN`.
- Bỏ `ĐẮP` và `MÀI`.
- User `ĐẮP` và `MÀI` không thấy các đơn thử sườn trong mobile pending.
- User `SƯỜN` vẫn thấy đơn thử sườn nếu công đoạn `SƯỜN` chưa xác nhận.

Lưu ý: code hiện nhận `TS` khá rộng, nên các ghi chú như `LTTS`, `LLTS`, `BHTS` cũng được xem là thử sườn.

## 5. Thử thô

Chưa có logic chính thức cho thử thô.

Theo nghiệp vụ, thử thô có thể được ghi trong cột `Ghi chú điều phối` bằng:

- `Thử thô`
- `TT`
- hoặc biến thể gần giống.

Hiện chưa áp dụng rule lọc/skip nào cho thử thô. Nếu sau này thêm, nên nhận diện `TT` theo token riêng để tránh bắt nhầm chữ trong chuỗi dài.

## 6. Filter chips mobile

Mobile có các filter chips theo loại phục hình:

- `Tất cả`
- `Zirconia`
- `Kim loại`
- `Mặt dán`

Filter này lọc dựa trên `phuc_hinh`.

Thống kê dưới chips hiện tổng hợp theo `yc_ht` (`yc_hoan_thanh`) và chỉ theo chip đang chọn, không phụ thuộc ô search.

Mỗi ngày hiển thị:

- Số đơn.
- Tổng `sl` răng.

## 7. Quyền xem thống kê chips

Trong admin tab User có cột `TK chips`.

Field lưu trong `users.json` là `can_view_stats`.

Quy tắc:

- Admin luôn thấy thống kê chips.
- User chỉ thấy thống kê chips nếu `can_view_stats = true`.
- User vẫn dùng được filter chips để lọc đơn dù `can_view_stats = false`; chỉ phần tổng số lượng theo ngày bị ẩn.

## 8. Modal mobile

Modal chi tiết đơn hiển thị tiến độ từng công đoạn.

Với mỗi công đoạn đã xác nhận, modal ưu tiên hiển thị thời gian hoàn thành công đoạn lấy từ dữ liệu scraper/DB (`thoi_gian_hoan_thanh`).

Các công đoạn bị skip sẽ không được tính là công đoạn đang chờ.

## 9. Ghi chú về dữ liệu

Cột Excel `Ghi chú điều phối` đang được import vào DB field `don_hang.ghi_chu`.

Nếu file Excel có nhiều cột chứa chữ `Ghi chú`, importer hiện lấy cột đầu tiên match `Ghi chú`.

Khi thêm rule mới dựa vào ghi chú, nên kiểm tra dữ liệu thực tế trong DB và file Excel mới nhất trước khi sửa logic.
