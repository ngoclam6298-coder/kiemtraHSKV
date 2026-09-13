# CÔNG TY ĐIỆN LỰC VŨNG TÀU - TỔNG CÔNG TY ĐIỆN LỰC TP. HỒ CHÍ MINH (EVNHCMC)
## HỆ THỐNG KIỆN TOÀN HỆ THỐNG ĐO ĐẾM - PC VŨNG TÀU

Ứng dụng Web Đơn (Single Page Application - SPA) chuyên biệt cho cán bộ kỹ thuật và nhân viên kiểm tra hiện trường của **Công ty Điện lực Vũng Tàu (EVNHCMC)** để thực hiện công tác kiểm tra, kiện toàn hệ thống đo đếm (HTĐĐ) của các khách hàng trong trạm biến áp, kết nối trực tiếp với **Google Sheets**, lưu trữ an toàn, chụp ảnh hiện trường và sẵn sàng triển khai trên **Vercel**.

---

### 🌟 CÁC TÍNH NĂNG NỔI BẬT

1. **Trang Web Đơn (SPA) Chuẩn Vercel**:
   - Thao tác lọc, tìm kiếm, tích chọn hoàn thành, tải ảnh, nhập ghi chú **hoàn toàn trên 1 trang duy nhất, tuyệt đối không thay đổi đường link URL**.
   - Cấu hình sẵn tệp `vercel.json` để triển khai chỉ với 1 cú click lên Vercel.

2. **Dữ liệu Google Sheet Chuẩn 6 Cột**:
   - Kết nối trực tiếp đường link Google Sheet: `https://docs.google.com/spreadsheets/d/1mcdRAreNWC4x8KIA_c89O_6Tjh8I5Ox-La0G1aSBEDs/edit?gid=0#gid=0`
   - Cột A: **STT**
   - Cột B: **ID trạm**
   - Cột C: **Mã Khách Hàng**
   - Cột D: **Tên khách hàng**
   - Cột E: **Địa chỉ công tơ**
   - Cột F: **Khu vực**
   - Không sử dụng cơ sở dữ liệu bên ngoài, chỉ làm việc trên ứng dụng, Google Sheets và Google.

3. **Bảng Thống Kê Tổng Quan & Tiến Độ Trực Quan**:
   - Thống kê tỷ lệ và số lượng khách hàng **ĐÃ KIỂM TRA** (Hoàn thành) và **CHƯA KIỂM TRA** (Cần làm).
   - Thanh tiến độ (Progress bar) % hoàn thành kiện toàn theo thời gian thực.
   - Thống kê số lượng trạm biến áp đang quản lý.

4. **Tìm Kiếm & Lọc Nhanh Thông Minh**:
   - **Tìm kiếm ID trạm hoặc Tên trạm**: Có gợi ý thông minh (Auto-complete), khi chọn trạm sẽ hiển thị Banner trạm và toàn bộ danh sách khách hàng thuộc trạm đó để phục vụ đi kiểm tra.
   - **Lọc theo Khu vực (Cột F)**: Dropdown tự động nhận diện tất cả khu vực có trong dữ liệu.
   - **Lọc theo Trạng thái**: *Tất cả*, *Chưa kiểm tra*, *Đã kiểm tra*.
   - **Tìm nhanh đa năng**: Nhập Mã KH, Tên KH, Địa chỉ công tơ.

5. **Nghiệp Vụ Kiểm Tra & Kiện Toàn Hiện Trường**:
   - **Dạng Checkbox**: Tích chọn checkbox để chuyển trạng thái sang **"Đã hoàn thành"** (Đã kiểm tra) với màu xanh đặc trưng của ngành điện, tự động lưu thời gian kiểm tra.
   - **Chụp & Tải Ảnh Hiện Trường**: Cho phép tải ảnh chụp công tơ, niêm chì, hòm hộp từ máy tính hoặc chụp trực tiếp từ camera điện thoại; hỗ trợ thu nhỏ tự động và click phóng to xem chi tiết sắc nét.
   - **Ghi Chú Hiện Trạng**: Ô nhập ghi chú tình trạng đo đếm kèm các nút tag chọn nhanh (*Đo đếm tốt, niêm chì nguyên vẹn*, *Đứt chì hòm công tơ*, *Mặt kính mờ/vỡ*, *Sai tỷ số TI/TU*, *Đã thay chì mới*, *Đã thay công tơ*...).
   - **Nút "Kiểm tra tất cả KH trong trạm này"**: Phê duyệt nhanh toàn trạm khi kiểm tra đạt chuẩn.

6. **Lưu Trữ & Xuất Báo Cáo**:
   - Toàn bộ kết quả kiểm tra, ghi chú và hình ảnh được tự động lưu vào **LocalStorage** của trình duyệt (không bị mất khi tải lại trang hoặc mất mạng).
   - Hỗ trợ nút **"Xuất Báo Cáo"** ra file CSV/Excel (chuẩn font tiếng Việt có dấu UTF-8 BOM) để nộp báo cáo hoặc cập nhật ngược lại Google Sheet.

---

### 🚀 HƯỚNG DẪN TRIỂN KHAI LÊN VERCEL

1. Tải toàn bộ mã nguồn lên GitHub của bạn (hoặc thư mục này).
2. Truy cập [vercel.com](https://vercel.com) và đăng nhập.
3. Chọn **Add New...** ➔ **Project** ➔ Chọn kho lưu trữ GitHub của bạn.
4. Bấm **Deploy**. Vercel sẽ tự động nhận diện cấu hình `vercel.json` và cấp đường link công khai dạng:
   `https://kienthoan-htdd-pcvt.vercel.app` để cán bộ công nhân viên PC Vũng Tàu truy cập sử dụng trên cả máy tính lẫn điện thoại thông minh!

---

### 💻 HƯỚNG DẪN CHẠY TRỰC TIẾP TRÊN MÁY TÍNH

- **Cách 1**: Mở thư mục này và nhấp đúp trực tiếp vào tệp `index.html` bằng Google Chrome hoặc Microsoft Edge.
- **Cách 2**: Mở terminal/PowerShell tại thư mục và chạy:
  ```bash
  python -m http.server 8080
  ```
  Sau đó mở trình duyệt truy cập: `http://localhost:8080`
