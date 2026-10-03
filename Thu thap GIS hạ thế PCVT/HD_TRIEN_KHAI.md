# HƯỚNG DẪN TRIỂN KHAI & VẬN HÀNH ỨNG DỤNG THU THẬP GIS HẠ THẾ PCVT

Ứng dụng web chuyên biệt dành cho cán bộ hiện trường của **Công ty Điện lực Vũng Tàu (PCVT)** thực hiện công tác cập nhật khối lượng thực tế từng trạm và theo dõi tiến độ theo thời gian thực trên cả máy tính và điện thoại thông minh.

Dữ liệu được lưu trữ và đồng bộ 2 chiều với Google Sheet:
[Google Sheet Thu Thập GIS Hạ Thế PCVT](https://docs.google.com/spreadsheets/d/1uXozLAoqevpVxiqbHnfaM6BsSHASoSatp3aDwpo9_e4/edit?gid=0#gid=0)

---

## 📁 CẤU TRÚC THƯ MỤC BÀN GIAO
```text
Thu thap GIS hạ thế PCVT/
├── Code.gs             # Mã nguồn Google Apps Script (Backend xử lý dữ liệu, khóa dòng & nhật ký)
├── index.html          # Web App giao diện đơn (HTML + CSS + JS tối ưu ngoài trời cho điện thoại)
└── HD_TRIEN_KHAI.md    # Tài liệu hướng dẫn thiết lập và triển khai chi tiết này
```

---

## BƯỚC 1: CẤU HÌNH VÀ TRIỂN KHAI GOOGLE APPS SCRIPT (BACKEND)

### 1.1. Dán mã nguồn vào Google Sheet
1. Mở file Google Sheet dữ liệu theo đường link trên.
2. Trên thanh menu, chọn: **Tiện ích mở rộng** (Extensions) ➔ **Apps Script**.
3. Tại trình soạn thảo code, xóa toàn bộ code mặc định (`myFunction`) và dán toàn bộ nội dung từ tệp [`Code.gs`](file:///e:/Antigraviti_PCVT/Thu%20thap%20GIS%20h%E1%BA%A1%20th%E1%BA%BF%20PCVT/Code.gs).
4. Bấm biểu tượng 💾 **Lưu dự án** (Ctrl + S) và đổi tên dự án thành: `API_Thu_Thap_GIS_PCVT`.

### 1.2. Cấu hình Mã PIN Quản lý trong Script Properties
*(Mã PIN dùng khi cán bộ hiện trường muốn mở khóa sửa lại dòng đã lưu)*
1. Tại màn hình Apps Script, bấm vào biểu tượng ⚙️ **Cài đặt dự án** (Project Settings) ở thanh công cụ góc trái.
2. Cuộn chuột xuống phần **Thuộc tính tập lệnh** (Script Properties).
3. Bấm nút **Thêm thuộc tính tập lệnh** (Add script property):
   - **Thuộc tính** (Property): `PIN_CODE`
   - **Giá trị** (Value): `1111` *(hoặc mã PIN tùy ý bạn quy định, ví dụ: 2468)*
4. Bấm **Lưu thuộc tính tập lệnh** (Save script properties).
> *Lưu ý: Nếu không cấu hình, hệ thống sẽ tự động dùng mã PIN mặc định là `1111`.*

### 1.3. Triển khai Web App (Deploy)
1. Ở góc trên bên phải màn hình Apps Script, bấm nút xanh **Triển khai** (Deploy) ➔ Chọn **Tùy chọn triển khai mới** (New deployment).
2. Bấm vào biểu tượng bánh răng bên cạnh dòng *Chọn loại*, chọn **Ứng dụng web** (Web app).
3. Cấu hình chính xác các mục như sau:
   - **Mô tả** (Description): `v1.0 Thu thap GIS PCVT`
   - **Thực thi dưới dạng** (Execute as): **Tôi** (*Địa chỉ email Google của bạn*)
   - **Người có quyền truy cập** (Who has access): **Bất kỳ ai** (*Anyone*) ⚠️ *(Rất quan trọng: phải chọn Anyone để điện thoại hiện trường gửi dữ liệu vào Sheet được)*.
4. Bấm nút **Triển khai** (Deploy).
5. Google sẽ hiện hộp thoại yêu cầu cấp quyền:
   - Bấm **Ủy quyền truy cập** (Authorize Access) ➔ Chọn tài khoản Google của bạn.
   - Bấm **Nâng cao** (Advanced) ➔ Bấm **Đi tới API_Thu_Thap_GIS_PCVT (không an toàn)**.
   - Bấm **Cho phép** (Allow).
6. Sao chép lại đường link tại mục **Ứng dụng web URL** (Web app URL), đường link có định dạng:
   `https://script.google.com/macros/s/AKfycb.../exec`

---

## BƯỚC 2: CẤU HÌNH LIÊN KẾT TRÊN `index.html`

1. Mở file [`index.html`](file:///e:/Antigraviti_PCVT/Thu%20thap%20GIS%20h%E1%BA%A1%20th%E1%BA%BF%20PCVT/index.html) bằng trình soạn thảo (VS Code, Notepad...).
2. Bấm phím **Ctrl + F** và tìm từ khóa: `APPS_SCRIPT_URL` (nằm ở dòng **1333**):
   ```javascript
   const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbz_YOUR_SCRIPT_ID_HERE/exec";
   ```
3. Thay thế chuỗi URL mẫu bằng **đường link Web app URL** bạn vừa sao chép ở Bước 1.3.
4. Bấm **Lưu file** (Ctrl + S).

---

## BƯỚC 3: ĐƯA LÊN MẠNG ĐỂ CÁC ANH MỞ BẰNG ĐIỆN THOẠI

Bạn có thể chọn 1 trong các cách cực kỳ đơn giản sau:

### Cách 1: Đưa lên Netlify Drop (Nhanh nhất - 30 giây là có link HTTPS)
1. Mở trình duyệt truy cập: [app.netlify.com/drop](https://app.netlify.com/drop)
2. Kéo thả trực tiếp thư mục `Thu thap GIS hạ thế PCVT` vào khung tải lên của Netlify.
3. Netlify sẽ tạo ngay 1 đường link công khai dạng: `https://gis-pcvt-vungtau.netlify.app`.
4. Gửi đường link này vào nhóm Zalo để các anh hiện trường lưu vào màn hình chính điện thoại và sử dụng.

### Cách 2: Triển khai bằng GitHub Pages (Miễn phí vĩnh viễn)
1. Đẩy thư mục này lên kho GitHub của bạn hoặc của đơn vị.
2. Vào phần **Settings** của Repository ➔ Chọn tab **Pages** ở cột trái.
3. Tại mục **Branch**, chọn nhánh `main` (hoặc `master`), thư mục chọn `/ (root)` hoặc `/Thu thap GIS hạ thế PCVT` rồi bấm **Save**.
4. GitHub sẽ cấp link dạng: `https://<ten-user>.github.io/<ten-repo>/`.

### Cách 3: Chạy trực tiếp trong mạng nội bộ công ty (Localhost/LAN)
- Mở PowerShell tại thư mục này và gõ:
  ```powershell
  python -m http.server 8080
  ```
- Điện thoại kết nối chung Wi-Fi có thể truy cập qua IP máy tính: `http://192.168.x.x:8080`.

---

## 🔒 CƠ CHẾ HOẠT ĐỘNG & BẢO VỆ DỮ LIỆU ĐẶC BIỆT

1. **Khóa dòng tự động sau khi Lưu**:
   - Khi người dùng chọn trạm, nhập số liệu và bấm **💾 LƯU SỐ LIỆU VÀO GOOGLE SHEET**, dòng đó sẽ được ghi nhận và **tự động KHÓA** ngay lập tức.
   - Ở phía frontend: các ô nhập bị vô hiệu hóa, biểu tượng ổ khóa đỏ 🔒 bật sáng.
   - Ở phía backend: Apps Script kiểm tra trạng thái khóa ở phía server và **từ chối mọi yêu cầu ghi đè** nếu chưa được mở khóa hợp lệ.
   - Các cột phụ được tự động tạo và cập nhật ở cuối Sheet: `Khóa` (`TRUE`/`FALSE`), `Người nhập`, `Thời gian nhập`.

2. **Quy trình Mở khóa bằng mã PIN (Yêu cầu sửa)**:
   - Khi muốn sửa trạm đã khóa, nhân viên bấm vào nút: **🔒 DÒNG ĐÃ KHÓA — BẤM VÀO ĐÂY ĐỂ YÊU CẦU SỬA (MÃ PIN)**.
   - Nhân viên nhập mã PIN do quản lý cấp (mặc định: `1111`).
   - **Cơ chế chống sửa đè trên dữ liệu cũ**: Script sẽ đối chiếu số liệu đang hiển thị trên điện thoại với số liệu thực tế trong Google Sheet.
     - Nếu có người khác đã sửa hoặc số liệu không khớp ➔ Từ chối và thông báo nhân viên tải lại dữ liệu mới nhất.
     - Nếu số liệu trùng khớp và PIN đúng ➔ Mở khóa cho phép sửa **MỘT LẦN**.
   - Sau khi sửa xong và bấm **LƯU**, hệ thống tự động khóa dòng lại ngay lập tức.

3. **Ghi nhật ký đầy đủ (Sheet "Nhật ký")**:
   - Apps Script tự động tạo sheet **"Nhật ký"** (nếu chưa có).
   - Mỗi lần bấm *Lưu*, *Yêu cầu sửa*, *Mở khóa*, hệ thống đều ghi lại:
     - `Thời gian`: ngày giờ chi tiết.
     - `Mã trạm`: mã trạm tác động.
     - `Hành động`: Lưu / Mở khóa / Sửa.
     - `Giá trị cũ` & `Giá trị mới`: chi tiết số lượng hoàn thành, xóa, trạng thái, ngày hoàn thành.
     - `Người thực hiện`: lấy theo tên nhân viên nhập ở ô "Người nhập".

4. **Chống trùng lặp Mã trạm (`MA_TRAM`)**:
   - Nếu trong Sheet có từ 2 dòng trở lên trùng cùng một `MA_TRAM`, hệ thống sẽ phát hiện, hiển thị cảnh báo và **từ chối cập nhật** để tránh ghi đè sai trạm.

5. **Bộ nhớ tạm cho nhân viên**:
   - Ô "Người nhập" tự động ghi nhớ tên cán bộ thực hiện vào bộ nhớ điện thoại (`localStorage`), không cần gõ lại mỗi lần mở app.
