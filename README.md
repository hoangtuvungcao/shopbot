# SHOPBOT — Shop bot Telegram + web bán hàng + web quản trị (Cloudflare Pages)

> **Bắt đầu cài đặt: xem [SETUP.md](SETUP.md)** (deploy Cloudflare, kết nối bot, SePay, nhà cung cấp).

Một dự án duy nhất chạy trên **Cloudflare Pages**, gồm:

| Đường dẫn | Chức năng |
|---|---|
| `/` | Trang shop công khai: acc game kèm ảnh, bảng giá dịch vụ, tài liệu API đại lý, nút Zalo |
| `/app/` | Cổng khách hàng: đăng nhập bằng Telegram, đặt dịch vụ, mua acc, nạp tiền, đơn hàng, API key |
| `/admin/` | Web quản trị (cài được như app trên Android/iPhone) |
| `/api/telegram/webhook` | Webhook bot gốc |
| `/api/telegram/webhook/<id>` | Webhook từng bot con |
| `/api/sepay/webhook` | Nhận giao dịch SePay, cộng tiền tự động |
| `/api/v2` | API đại lý chuẩn SMM panel v2 |

Dữ liệu nằm ở **D1** (SQLite), ảnh acc ở **R2**. Bảng tự tạo ở lần chạy đầu, không cần chạy migration.

## Chức năng

**Bot Telegram (khách)**
- Dịch vụ: buff like/follow/view, time (theo ngày/phút), bình luận, gói cố định (tích xanh...). Dịch vụ API tự gửi sang trumsubviet.com; dịch vụ thủ công vào hàng chờ admin. Luôn trừ tiền trước khi tạo đơn.
- Mua acc game: album ảnh + thông tin như ảnh mẫu, nút Mua ngay. Acc **giao tự động** (gửi ngay thông tin đăng nhập) hoặc **giao thủ công** cho acc giá trị cao (trừ tiền trước, admin giao sau qua web, bot gửi cho khách).
- Nạp tiền: mã QR SePay, nội dung `NAP<mã khách>`, cộng tự động, có khuyến mãi %.
- Tài khoản, lịch sử số dư, đơn hàng (tự cập nhật trạng thái, tự hoàn tiền phần chưa chạy).
- Hỗ trợ: nút Zalo (mặc định 0385673834, sửa trong Cài đặt) và Telegram.
- Đại lý & API: tạo API key, tạo **bot con** (giá cao hơn bot gốc, chủ bot ăn chênh lệch), rút hoa hồng.

**Cổng khách hàng trên web (`/app/`)**
- Đăng nhập bằng Telegram: bấm nút → bot hỏi xác nhận → web tự đăng nhập. Dùng chung số dư, đơn, acc với bot.
- Đặt dịch vụ (tính tiền trực tiếp, chống gửi trùng), mua acc (hiện thông tin ngay), nạp tiền QR (tự báo khi tiền vào), mã quà.
- Lịch sử đơn có tiến độ, acc đã mua, lịch sử số dư, tự tạo API key và xem bảng giá API.

**Đồng bộ dịch vụ & giá**
- Dịch vụ & giá → nhập quy tắc chênh lệch: **cộng X đ cho mỗi 1.000 lượt** hoặc **% trên giá vốn** → "Lưu & đồng bộ toàn bộ dịch vụ".
- Tự tạo danh mục (Facebook · Like / tim, TikTok · Theo dõi…), tự nhận dạng gói bình luận / mắt live / VIP / cảm xúc.
- Tự cập nhật giá vốn mỗi 6 giờ, tự thêm gói mới, tự ẩn gói nhà cung cấp ngừng bán. Gói bạn tự sửa giá thì giữ nguyên.

**Tích xanh Facebook (khách thuê làm)**
- Dịch vụ & giá → "Tạo nhanh Tích xanh FB" (gói cá nhân / Fanpage).
- Khách gửi link + SĐT/Zalo + ghi chú → trừ tiền → đơn vào hàng chờ. Admin bấm Nhận xử lý → Hoàn thành hoặc Hoàn tiền.

**Web admin**
- Tổng quan: KPI + biểu đồ dòng tiền, doanh thu theo nguồn, dịch vụ bán chạy, người dùng mới (7/30/90 ngày).
- Đơn dịch vụ: lọc trạng thái, hoàn thành / hoàn tiền một phần / hủy / đồng bộ / nhập mã API.
- Dịch vụ & giá: danh mục, nhập gói từ API kèm % lãi, giá đại lý riêng từng gói, cập nhật giá vốn.
- Acc game: đăng acc kèm nhiều ảnh (kéo thả/dán), giao acc, hoàn tiền acc chưa giao.
- Nạp tiền SePay: lịch sử, cộng tay giao dịch sai nội dung.
- Người dùng: số dư, cộng/trừ tiền, nhắn tin, khóa, thu hồi API key.
- Đại lý & bot con: danh sách bot con, doanh số, hoa hồng, duyệt lệnh rút.
- Mã quà tặng: tạo mã, giới hạn lượt, hạn dùng; mỗi tài khoản Telegram dùng 1 lần (kể cả qua bot con).
- Nhật ký thao tác admin (ẩn token/mật khẩu), xuất Excel (CSV) đơn hàng, nạp tiền, người dùng, acc.
- Gửi thông báo hàng loạt, Cài đặt (thương hiệu, bot, SePay, nhà cung cấp, đại lý, bảo trì).

**Thương hiệu & giao diện**
- Upload logo, đổi tên shop, khẩu hiệu, tiêu đề trang chủ, màu chủ đạo, chân trang ngay trong Cài đặt → áp dụng cho trang shop, admin, favicon và mô tả bot Telegram.
- Giao diện sáng/tối (nút ở góc trên), hiệu ứng chuyển động nhẹ, tự tắt khi máy bật "giảm chuyển động".
- Trang shop: lọc acc theo game, mức giá, sắp xếp giá, tìm dịch vụ, nhãn "MỚI" cho acc đăng trong 3 ngày.
- Trong bot gõ `#12` để mở nhanh acc số 12, `/code` để nhập mã quà tặng.

## Logo và banner bằng AI

Bản này có sẵn logo dựng sẵn (chữ cái, tay cầm, khiên, tia sét) và 6 bộ màu. Muốn dùng ảnh AI: tạo ảnh bằng công cụ AI rồi vào **Cài đặt → Thương hiệu** → "Tải logo lên" / "Ảnh banner trang chủ" → Lưu.

- Logo (vuông 1024×1024, PNG): *"Esports gaming logo icon for a shop named [TÊN SHOP], bold stylized letter [CHỮ CÁI] with a game controller element, neon violet and cyan gradient, glossy 3D, centered on plain dark background, no text other than the letter, app icon style"*
- Banner (ngang 1920×800, JPG): *"Wide cinematic gaming banner, futuristic neon arena with violet and cyan lights, glowing game controller and floating game items, dark left side empty for text, high detail, no text, no logos"*

## Mô hình giá đại lý

```
giá bot gốc  = giá bán của gói
giá đại lý   = "Giá đại lý" của gói, hoặc giá bán × tỷ lệ đại lý %   ← API và nền bot con
giá bot con  = giá đại lý × (1 + % lãi chủ bot tự đặt)               ← luôn ≥ % tối thiểu admin cho phép
hoa hồng     = giá bot con − giá đại lý → cộng cho chủ bot khi đơn kết thúc / acc được giao
```

Khách bot con nạp tiền vào tài khoản ngân hàng của bạn (qua SePay). Chủ bot con rút hoa hồng, admin duyệt và chuyển khoản tay.

## Triển khai

1. Cài Node 18+, rồi trong thư mục dự án: `npm install`, `npx wrangler login`.
2. Tạo database và bucket:
   ```bash
   npx wrangler d1 create shopbot           # copy database_id vào wrangler.toml
   npx wrangler r2 bucket create shopbot-images
   ```
3. Tạo project Pages và deploy:
   ```bash
   npx wrangler pages project create shopbot --production-branch main
   npx wrangler pages deploy public --project-name shopbot
   ```
4. Đặt secret (bắt buộc), mỗi lệnh sẽ hỏi giá trị:
   ```bash
   npx wrangler pages secret put ADMIN_PASSWORD --project-name shopbot   # mật khẩu admin, dài và khó đoán
   npx wrangler pages secret put SESSION_SECRET --project-name shopbot   # chuỗi ngẫu nhiên dài
   npx wrangler pages secret put DATA_KEY       --project-name shopbot   # khóa mã hóa thông tin acc, KHÔNG được đổi/mất
   ```
   Deploy lại một lần để secret có hiệu lực.
5. Mở `https://<project>.pages.dev/admin/`, đăng nhập, vào **Cài đặt**:
   - Dán Bot token (từ @BotFather), ID Telegram admin → **Lưu & kết nối bot**.
   - Nhập ngân hàng, số TK, chủ TK, bấm **Tạo key** cho SePay → Lưu.
   - Trên my.sepay.vn → WebHooks: URL `https://<domain>/api/sepay/webhook`, xác thực **API Key** (dán key vừa tạo), chỉ nhận tiền vào.
   - Nhập API key trumsubviet.com → **Kiểm tra kết nối**.
6. Vào **Dịch vụ & giá** → tạo danh mục → **Nhập từ API**. Vào **Acc game** → **Quản lý game** → **Đăng acc**.

> Nếu gắn tên miền riêng, bấm lại **Lưu & kết nối bot** sau khi mở admin bằng tên miền đó để webhook trỏ đúng. Bot con đã tạo vẫn giữ URL cũ, nên hãy chọn tên miền cố định trước khi mở cho đại lý.

## Lưu ý quan trọng

- **IP nhà cung cấp**: trumsubviet.com yêu cầu whitelist IP. Cloudflare không có IP cố định, nên cần (a) nhờ bên đó bỏ chặn IP cho key của bạn, hoặc (b) dựng proxy nhỏ trên VPS có IP cố định và điền địa chỉ proxy vào ô "Địa chỉ API".
- **DATA_KEY**: mất hoặc đổi key thì không đọc lại được thông tin đăng nhập acc đã lưu.
- Pages không có cron, nên trạng thái đơn được đồng bộ ở nền mỗi ~2 phút khi có người dùng bot/web, và khi bấm "Đồng bộ trạng thái" trong admin.

## Chống lỗi & bảo mật đã có

- Trừ tiền nguyên tử (`balance + x >= 0`), không thể âm số dư dù bấm nhiều lần cùng lúc.
- Xác nhận đơn, mua acc, rút tiền: chống bấm trùng (đã kiểm thử bấm 3 lần song song chỉ tạo 1 đơn).
- Webhook Telegram có secret riêng từng bot, chống xử lý lặp update; webhook SePay kiểm tra API key, chống cộng trùng giao dịch.
- Hoàn tiền / trả hoa hồng / giao acc chỉ chạy được một lần cho mỗi đơn.
- API lỗi rõ ràng → hoàn tiền ngay; mất kết nối → giữ đơn ở "Cần kiểm tra" để admin xử lý, không mất tiền oan.
- Admin: cookie HttpOnly + SameSite, chặn ghi từ domain khác, khóa 15 phút sau 6 lần sai mật khẩu.
- Thông tin đăng nhập acc mã hóa AES-GCM; trang công khai không bao giờ trả về thông tin nhạy cảm.

## Chạy thử ở máy

```bash
cp .dev.vars.example .dev.vars   # sửa mật khẩu
npm run dev                      # http://127.0.0.1:8788  (admin: /admin/)
```
