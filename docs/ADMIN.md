# Hướng dẫn dùng web quản trị

Địa chỉ: `https://shopbot-vn.pages.dev/admin/` · Trên điện thoại: mở bằng Chrome → menu → **Thêm vào màn hình chính** để dùng như app.

Nút mặt trăng/mặt trời góc trên đổi giao diện sáng/tối. Số đỏ cạnh menu = việc cần xử lý.

## Tổng quan
Số liệu hôm nay/tháng (nạp, doanh thu đã trừ hoa hồng bot con, số dư khách đang giữ, đơn cần xử lý, acc chờ giao, lệnh rút, giao dịch chưa khớp, số dư nhà cung cấp), biểu đồ 7/30/90 ngày, hoạt động gần đây. Bấm vào ô có viền vàng để tới việc cần làm.

## Bán hàng

### Đơn dịch vụ
- Lọc theo trạng thái hoặc **Chỉ đơn tích xanh**; tìm theo mã đơn, mã khách, link.
- **Đồng bộ trạng thái**: hỏi lại nhà cung cấp ngay (bình thường tự chạy ~2 phút/lần).
- **Chi tiết** một đơn:
  - *Nhận xử lý* (đơn thủ công, vd tích xanh): báo khách là đang làm.
  - *Đánh dấu hoàn thành* / *Hoàn tiền* (nhập số tiền, có thể hoàn một phần) / *Hủy không hoàn*.
  - *Nhắn khách*, *Mở Zalo* (đơn có SĐT).
  - Đơn **Cần kiểm tra** (mất kết nối lúc gửi API): xem trên trumsubviet; nếu đơn đã tạo → *Nhập mã đơn API*; nếu chưa → *Hoàn tiền*.
- **Xuất Excel**: tải danh sách đơn ra file CSV.

Trạng thái: *Chờ xử lý* (thủ công) → *Đang chạy* → *Hoàn thành* / *Đã hoàn tiền* / *Đã hủy*; *Lỗi - đã hoàn* là API từ chối và tiền đã trả lại khách.

### Dịch vụ & giá
- **Quy tắc giá bán**: cộng X đ cho mỗi 1.000 lượt hoặc % trên giá vốn. **Lưu & đồng bộ toàn bộ dịch vụ** kéo mọi gói từ nhà cung cấp, tạo danh mục, tính giá; **Chỉ áp lại giá** dùng sau khi đổi quy tắc.
- Gói nhãn **Tự động** đi theo quy tắc; tự sửa giá một gói (bỏ "Giá tự động") thì gói đó giữ giá riêng.
- Tự động mỗi 6 giờ: cập nhật giá vốn, thêm gói mới (nếu bật), ẩn gói nhà cung cấp ngừng bán.
- Chọn nhiều gói (ô vuông đầu dòng) → Mở bán / Ẩn / Chuyển sang giá tự động / Xóa.
- **Tạo nhanh Tích xanh FB**: tạo gói tích xanh cá nhân / Fanpage.
- **Chọn gói từ API**: nhập vài gói lẻ với % lãi riêng.
- Sửa gói: tên, mô tả cho khách, kiểu nhập (số lượng / theo ngày / theo phút / bình luận / trọn gói / tích xanh), min-max, cảm xúc, **giá đại lý** riêng.

### Acc game
- **Quản lý game**: thêm/ẩn game (Liên Quân, Free Fire…).
- **Đăng acc**: tiêu đề, thông tin hiển thị, mô tả, giá bán/giá nhập, ảnh (kéo thả / dán / link, tự nén), **cách giao**:
  - *Tự động*: bắt buộc nhập thông tin đăng nhập; khách mua xong nhận ngay.
  - *Thủ công* (acc giá trị cao): khách trả tiền trước, acc vào tab **Chờ giao**; bấm **Giao acc** nhập thông tin → bot gửi cho khách. Không giao được → **Hoàn tiền** (acc chuyển sang Ẩn).
- Thông tin đăng nhập được mã hóa; chỉ admin và người mua xem được.
- **Xuất Excel** danh sách acc.

### Nạp tiền SePay
- Mọi giao dịch SePay gửi về. **Chưa khớp** = chuyển sai nội dung → **Cộng cho khách** (nhập mã khách) hoặc **Bỏ qua**.

## Khách hàng

### Người dùng
- Tìm theo mã khách, ID Telegram, @username; lọc theo bot; sắp xếp theo số dư/nạp/chi tiêu/hoa hồng.
- **Chi tiết**: biến động số dư, đơn, acc đã mua; **Cộng/trừ tiền** (có lý do, báo khách), **Nhắn tin**, **Khóa**, **Thu hồi API key**.
- Mỗi bot có tập khách riêng: cùng một người dùng bot gốc và bot con là 2 tài khoản khác nhau.

### Đại lý & bot con
- **Lệnh rút hoa hồng**: chuyển khoản cho đại lý xong bấm **Đã chuyển**; **Từ chối** sẽ hoàn tiền vào số dư của họ.
- **Bot con**: chủ bot, % lãi, số khách, doanh số, hoa hồng đã trả, số dư khách; **Sửa** (% lãi, tạm dừng) / **Xóa** (chỉ khi khách của bot con hết số dư).
- Cách tính: giá bot con = giá đại lý × (1 + % lãi). Hoa hồng cộng cho chủ bot khi đơn kết thúc / acc được giao.

### Mã quà tặng
Tạo mã (giá trị, số lượt, hạn dùng). Mỗi tài khoản Telegram dùng một mã một lần, kể cả qua bot con hay web.

### Gửi thông báo
Gửi tới khách bot gốc hoặc cả bot con; hỗ trợ `<b>`, `<i>`, `<code>`, `<a href="...">`, kèm ảnh (link https, nội dung ≤ 1024 ký tự). Chỉ gửi được cho người đã bấm Start bot.

## Hệ thống

### Lưu trữ ảnh
Dung lượng R2 đã dùng / giới hạn, ảnh lớn nhất, ảnh có thể dọn. Đặt **giới hạn dung lượng** (mặc định 9.000MB, gói miễn phí 10.240MB) và **số ngày giữ ảnh acc đã bán** (mặc định 30). Tự dọn mỗi 6 giờ; **Dọn ngay** để dọn tức thì; **Quét lại bucket** khi số liệu lệch.

### Nhật ký thao tác
Mọi lần đăng nhập, lưu, xóa, hoàn tiền… của admin kèm IP. Token, mật khẩu được ẩn.

### Cài đặt
- **Thương hiệu**: logo nhỏ, logo lớn (trang chủ, trang đăng nhập, ảnh chào bot), banner, kiểu logo dựng sẵn, bộ màu, tên shop, khẩu hiệu, tiêu đề trang chủ, chân trang. Ảnh nên là link https nếu không dùng R2.
- **Bot Telegram**: token, ID admin nhận thông báo, lời chào, hỗ trợ (Zalo, Telegram), thông báo đầu trang web.
- **SePay**: ngân hàng, STK, chủ TK, API key webhook, tiền tố nội dung (mặc định NAP), nạp tối thiểu, khuyến mãi %, mệnh giá gợi ý.
- **Nhà cung cấp**: API key, địa chỉ API (đổi khi dùng proxy).
- **Đại lý, API và bot con**: bật/tắt API, bật/tắt bot con, tỷ lệ giá đại lý, % lãi tối thiểu/tối đa của bot con, mức rút tối thiểu.
- **Hệ thống**: bảo trì bot (chỉ admin dùng được), trạng thái DATA_KEY và R2.

## Thông báo admin nhận qua Telegram
Đơn thủ công / tích xanh mới, đơn cần kiểm tra, acc cần giao, bán acc, nạp tiền, giao dịch chưa khớp, bot con mới, yêu cầu rút tiền, bộ nhớ ảnh sắp đầy. (Nhập ID Telegram trong Cài đặt → Bot.)
