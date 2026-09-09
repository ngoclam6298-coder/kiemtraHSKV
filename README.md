# CÔNG TY ĐIỆN LỰC VŨNG TÀU - TỔNG CÔNG TY ĐIỆN LỰC TP. HỒ CHÍ MINH (EVNHCMC)
## HỆ THỐNG KIỂM TRA TRẠM CÓ TỔN THẤT BẤT THƯỜNG & SANG TẢI CHUYỂN LƯỚI

Ứng dụng Web Đơn (Single Page Application - SPA) chuyên biệt cho cán bộ kỹ thuật và điều độ viên Công ty Điện lực Vũng Tàu để theo dõi tổn thất điện năng (TTĐN), phát hiện trạm bất thường (đặc biệt là các trạm có $TTĐN < 0\%$), mô phỏng tính toán bù trừ sang tải khách hàng và quản lý hàng chờ kiểm tra hiện trường kèm tính năng **Rollover chuyển việc qua tháng**.

---

### 🌟 CÁC TÍNH NĂNG NỔI BẬT

1. **Thanh menu bên trái kiểu YouTube (Collapsible Sidebar)**:
   - Có thể thu gọn / mở rộng linh hoạt, giao diện chuẩn nhận diện thương hiệu EVNHCMC.
   - Chuyển tab tức thì, **không reload trang, không đổi đường link URL**.

2. **Thanh tìm kiếm thông minh (Global Smart Search Header)**:
   - Tra cứu nhanh tức thì theo **ID Trạm**, **Tên Trạm**, **Mã Khách Hàng**, **Tên KH**, hoặc **Địa Chỉ**.
   - Xem đầy đủ danh sách khách hàng thuộc trạm (số pha 1P/3P, mã điểm đo ĐĐO, sản lượng điện tiêu thụ $SL\_T08\_2026$, số thiết bị công tơ).

3. **Tổng Quan Dashboard**:
   - Thống kê toàn diện theo từng kỳ kiểm tra (từ **Tháng 1 đến Tháng 9**).
   - Phân loại trực quan: **Trạm TTĐN < 0% (Báo động đỏ)**, **Trạm TTĐN cao (> 2.35%)**, **Trạm mất đầu nguồn (#DIV/0!)**, **Trạm bình thường (0 - 2.35%)**.
   - Tích hợp nguyên lý nghiệp vụ: *TTĐN < 0% do Thương phẩm > Điện năng đầu nguồn (nghi vấn tráo dây công tơ tổng, nhầm ranh trạm hoặc phát sinh điện mặt trời NLMT)*.

4. **Kiểm Tra Định Kỳ Trạm Bất Thường**:
   - Lọc sẵn các trạm cần đi kiểm tra trong kỳ.
   - Nhập ghi chú hiện trạng lưới điện và đề xuất kỹ thuật.
   - Đưa nhanh trạm vào Hàng chờ kiểm tra hiện trường (không chứa dữ liệu mẫu).

5. **Sang Tải Chuyển Lưới & Công Cụ Mô Phỏng Tính Toán Lại TTĐN**:
   - Quản lý các trạm STCL-XDM và trạm bổ sung theo công văn của Đội Quản lý lưới điện.
   - **Mô phỏng Sang Tải (Load Transfer Simulator)**:
     - Chọn Trạm Nguồn (A) và Trạm Đích (B).
     - Chọn danh sách khách hàng cần tách chuyển.
     - Hệ thống tự động tính toán lại Thương phẩm mới và Tỷ lệ TTĐN mới cho cả 2 trạm từ số liệu thực tế.
     - Đánh giá hiệu quả: Xóa bỏ tổn thất âm, đưa tổn thất về dải an toàn, lưu phương án vào hàng chờ.

6. **Quản Lý Hàng Chờ & Tính Năng Rollover Qua Tháng**:
   - Theo dõi tiến độ kiểm tra: *Chưa thực hiện* ➔ *Đang xử lý* ➔ *Đã thực hiện*.
   - **Nút "Chuyển các trạm chưa hoàn thiện sang tháng sau (Rollover)"**: Tự động dồn các trạm chưa xong sang kỳ kiểm tra tiếp theo, gộp chung với các trạm mới đề xuất của tháng sau để không bao giờ bị bỏ sót việc.
   - Hỗ trợ xuất dữ liệu ra file **Excel / CSV** và **In Phiếu Giao Việc Hiện Trường**.

7. **Tra Cứu Khách Hàng & Đồng Bộ Google Sheets**:
   - Tích hợp logo chính thức [avph472lv.png](file:///e:/Antigraviti_PCVT/avph472lv.png) của EVNHCMC.
   - Tích hợp sẵn 2 đường link Google Sheets của Điện lực Vũng Tàu.
   - Đóng gói sẵn hơn **4.900 trạm biến áp** và **25.000+ khách hàng** thực tế để ứng dụng chạy mượt mà ngay cả khi không có mạng (offline-ready).

---

### 🚀 HƯỚNG DẪN CHẠY VÀ TRIỂN KHAI

#### Cách 1: Chạy trực tiếp trên máy tính (Không cần cài đặt)
- Nhấp đúp chuột trực tiếp vào tệp `index.html` để mở trên Google Chrome, Microsoft Edge hoặc Cốc Cốc.
- Hoặc mở PowerShell tại thư mục này và gõ:
  ```bash
  python -m http.server 8080
  ```
  Sau đó mở trình duyệt truy cập: `http://localhost:8080`

#### Cách 2: Deploy lên Vercel (Miễn phí 100%, 1 phút là xong)
1. Đăng tải thư mục này lên GitHub (hoặc kéo thả vào Vercel).
2. Đăng nhập [vercel.com](https://vercel.com) bằng tài khoản GitHub.
3. Bấm **"Add New..."** ➔ **"Project"** ➔ Chọn Repository.
4. Bấm **"Deploy"**. Vercel sẽ tự nhận diện cấu hình `vercel.json` và cấp đường link công khai dạng:
   `https://dienluc-vungtau-ttdn.vercel.app` để toàn thể anh em trong công ty truy cập trên máy tính và điện thoại thông minh!
