# Hướng dẫn đưa SHOPBOT lên Cloudflare Pages

Làm lần lượt từ trên xuống. Tổng thời gian khoảng 20–30 phút.

## 0. Chuẩn bị

| Cần có | Ghi chú |
|---|---|
| Tài khoản Cloudflare (miễn phí) | dash.cloudflare.com |
| Node.js 18+ | máy đã có Node 20 |
| Bot Telegram | tạo bằng @BotFather → `/newbot` → lấy token |
| ID Telegram của bạn | nhắn @userinfobot để lấy số ID |
| Tài khoản SePay | my.sepay.vn, đã liên kết tài khoản ngân hàng nhận tiền |
| API key trumsubviet.com | trong trang tài khoản trumsubviet |

> **R2 (lưu ảnh acc)** cần bật trong Cloudflare (R2 có gói miễn phí nhưng Cloudflare yêu cầu thêm thẻ thanh toán). Không muốn bật R2: xóa khối `[[r2_buckets]]` trong `wrangler.toml`, khi đăng acc dùng **dán link ảnh** thay cho tải ảnh lên. Logo SHOPBOT mặc định không cần R2.

## 1. Tạo database và nơi lưu ảnh

Mở terminal trong thư mục dự án:

```bash
npm install
npx wrangler login                          # mở trình duyệt để đăng nhập Cloudflare
npx wrangler d1 create shopbot              # in ra database_id
npx wrangler r2 bucket create shopbot-images   # bỏ qua nếu không dùng R2
```

Mở `wrangler.toml`, thay `REPLACE_WITH_D1_ID` bằng `database_id` vừa in ra. Bảng dữ liệu tự tạo khi chạy lần đầu, không cần chạy SQL.

## 2. Tạo project và deploy

```bash
npx wrangler pages project create shopbot --production-branch main
npx wrangler pages deploy public --project-name shopbot
```

Lệnh deploy in ra địa chỉ dạng `https://shopbot-xxx.pages.dev`. Địa chỉ chính thức là `https://shopbot.pages.dev` (hoặc tên bạn đặt).

## 3. Đặt mật khẩu và khóa bảo mật (bắt buộc)

Mỗi lệnh sẽ hỏi bạn nhập giá trị:

```bash
npx wrangler pages secret put ADMIN_PASSWORD --project-name shopbot   # mật khẩu đăng nhập admin, ≥ 12 ký tự
npx wrangler pages secret put SESSION_SECRET --project-name shopbot   # chuỗi ngẫu nhiên dài bất kỳ
npx wrangler pages secret put DATA_KEY       --project-name shopbot   # khóa mã hóa thông tin acc
```

Tạo chuỗi ngẫu nhiên: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`

> **Giữ kỹ `DATA_KEY`** (ghi ra chỗ an toàn). Mất hoặc đổi thì không đọc lại được tài khoản/mật khẩu của các acc đã lưu.

Deploy lại để secret có hiệu lực:

```bash
npx wrangler pages deploy public --project-name shopbot
```

## 4. (Nên làm) Gắn tên miền riêng

Cloudflare Dashboard → Workers & Pages → shopbot → **Custom domains** → thêm tên miền (vd `shopbot.vn`).
Làm bước này **trước** khi kết nối bot và SePay, vì webhook gắn với địa chỉ web. Đổi tên miền sau này thì phải kết nối lại bot/SePay, và các bot con đã tạo phải tạo lại.

## 5. Kết nối bot Telegram

1. Mở `https://<tên-miền>/admin/` → đăng nhập bằng `ADMIN_PASSWORD`.
2. **Cài đặt → Bot Telegram**: dán **Bot token**, nhập **ID Telegram của admin** (nhiều ID cách nhau dấu phẩy).
3. Bấm **Lưu & kết nối bot** → dòng trạng thái phải hiện chấm xanh **"Đang hoạt động · @tenbot"**.
4. Mở bot trên Telegram, gửi `/start` → bot chào bằng ảnh logo SHOPBOT và hiện menu.
5. Trong @BotFather: `/setuserpic` → gửi ảnh logo SHOPBOT để làm ảnh đại diện bot.

## 6. Kết nối SePay (nạp tiền tự động)

**Trong admin → Cài đặt → Nạp tiền tự động (SePay):**
1. Nhập **Ngân hàng** (tên viết tắt: MBBank, Vietcombank, ACB, TPBank, Techcombank…), **Số tài khoản**, **Chủ tài khoản** đúng như tài khoản đã liên kết trên SePay.
2. Bấm **Tạo key** ở ô "SePay API key" → **Lưu cài đặt**. Sao chép key này.
3. Kiểm tra ảnh **xem trước mã QR** hiện đúng ngân hàng/số tài khoản.

**Trên my.sepay.vn → Tích hợp WebHooks → Thêm WebHooks:**

| Mục | Điền |
|---|---|
| Sự kiện | Có tiền vào |
| Tài khoản ngân hàng | tài khoản nhận tiền của shop |
| URL nhận webhook | `https://<tên-miền>/api/sepay/webhook` (nút Sao chép trong admin) |
| Kiểu xác thực | **API Key** → dán key ở bước 2 |
| Request content type | application/json |
| Bỏ qua nếu nội dung không có mã thanh toán | **Không** (hệ thống tự đọc mã `NAP...`) |

**Thử:** trong bot bấm Nạp tiền → chuyển 10.000đ đúng nội dung `NAP<mã khách>` → sau 1–3 phút bot báo "Nạp tiền thành công" và admin → **Nạp tiền SePay** có dòng "Đã cộng".
Chuyển sai nội dung: giao dịch hiện "Chưa khớp" → bấm **Cộng cho khách** và nhập mã khách.

## 7. Kết nối nhà cung cấp dịch vụ (trumsubviet.com)

1. **Cài đặt → Nhà cung cấp**: dán **API key** → **Kiểm tra kết nối** → phải hiện số dư.
2. **Dịch vụ & giá → Quy tắc giá bán**: chọn "Cộng thêm số tiền cho mỗi 1.000 lượt" (vd 5000) hoặc "% trên giá vốn" → **Lưu & đồng bộ toàn bộ dịch vụ**.
3. Rà danh sách: ẩn gói không muốn bán, sửa tên/mô tả cho dễ hiểu.

> **Nếu bị lỗi kết nối / bị chặn**: trumsubviet yêu cầu mở IP server, mà Cloudflare không có IP cố định. Nhắn admin trumsubviet nhờ bỏ chặn IP cho API key của bạn; hoặc dựng proxy trên VPS có IP cố định rồi điền địa chỉ proxy vào ô "Địa chỉ API".

## 8. Thiết lập bán hàng

- **Tích xanh FB**: Dịch vụ & giá → **Tạo nhanh Tích xanh FB** → nhập giá.
- **Acc game**: Acc game → **Quản lý game** (thêm Liên Quân, Free Fire…) → **Đăng acc** (ảnh, thông tin, giá, tài khoản/mật khẩu; acc giá cao chọn "Giao thủ công").
- **Thương hiệu**: Cài đặt → Thương hiệu (tên, khẩu hiệu, logo, banner, màu).
- **Đại lý**: Cài đặt → Đại lý, API và bot con (tỷ lệ giá đại lý, % lãi tối thiểu/tối đa của bot con, mức rút tối thiểu).
- **Mã quà khai trương**: Mã quà tặng → Tạo mã.

## 9. Kiểm tra cuối trước khi mở bán

- [ ] `/start` bot ra ảnh logo + menu
- [ ] Nạp 10.000đ thật → tự cộng, bot báo
- [ ] Đặt 1 đơn dịch vụ rẻ nhất → admin thấy đơn "Đang chạy", vài phút sau "Hoàn thành"
- [ ] Đăng 1 acc thử giá 1.000đ → mua bằng bot → nhận tài khoản/mật khẩu → xóa acc thử
- [ ] Web `https://<tên-miền>/app/` → Đăng nhập bằng Telegram → thấy đúng số dư
- [ ] Tạo bot con bằng một bot thử (bot → Đại lý & API → Tạo bot con) → giá trong bot con cao hơn bot gốc
- [ ] Tổng quan admin có số liệu, biểu đồ

## Cập nhật code về sau

```bash
npx wrangler pages deploy public --project-name shopbot
```

Dữ liệu (D1, R2) giữ nguyên khi deploy lại. Database tự thêm cột mới nếu bản cập nhật cần.

## Sao lưu dữ liệu

```bash
npx wrangler d1 export shopbot --remote --output backup-$(date +%F).sql
```

Nên chạy mỗi tuần, lưu file ra chỗ khác.

## Chạy thử trên máy

```bash
cp .dev.vars.example .dev.vars    # sửa mật khẩu trong file
npm run dev                       # http://127.0.0.1:8788 (admin: /admin/, khách: /app/)
```

Trên máy chỉ xem được giao diện, admin và dữ liệu; **bot Telegram và SePay chỉ hoạt động sau khi deploy** (Telegram và SePay chỉ gửi webhook tới địa chỉ HTTPS công khai).
