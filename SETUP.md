# Cài đặt SHOPBOT trên Cloudflare Pages

Làm lần lượt từ trên xuống. Bản hiện tại đã deploy ở project **`shopbot-vn`** → https://shopbot-vn.pages.dev. Nếu chỉ cần cập nhật code, xem mục [Cập nhật code](#cập-nhật-code).

## 0. Chuẩn bị

| Cần có | Ghi chú |
|---|---|
| Tài khoản Cloudflare | dash.cloudflare.com (gói miễn phí) |
| Node.js 20+ | `node -v` để kiểm tra |
| Bot Telegram | @BotFather → `/newbot` → lấy token |
| ID Telegram của admin | nhắn @userinfobot để lấy số ID |
| Tài khoản SePay | my.sepay.vn, đã liên kết tài khoản ngân hàng nhận tiền |
| API key trumsubviet.com | trang tài khoản trên trumsubviet |

## 1. Tạo database và nơi lưu ảnh

```bash
npm install
npx wrangler login
npx wrangler d1 create shopbot
```

Dán `database_id` vừa in ra vào `wrangler.toml` (mục `[[d1_databases]]`).

Lưu ảnh (R2): vào Cloudflare Dashboard → **R2 Object Storage** → bật R2 (gói miễn phí 10GB, Cloudflare yêu cầu thêm thẻ thanh toán), rồi:

```bash
npx wrangler r2 bucket create shopbot-images
```

Giữ nguyên `binding = "BUCKET"` trong `wrangler.toml` (wrangler có thể gợi ý tên khác — bỏ qua).
Không muốn dùng R2: thêm `#` trước 3 dòng `[[r2_buckets]]` trong `wrangler.toml`; khi đăng acc dùng link ảnh https.

## 2. Tạo project và deploy

```bash
npx wrangler pages project create shopbot-vn --production-branch main
npm run deploy
```

Địa chỉ web: `https://shopbot-vn.pages.dev` (đổi tên project thì sửa cả trong `package.json` và `wrangler.toml`).

## 3. Đặt 3 secret

Tên secret giữ **nguyên** như dưới; **giá trị nhập khi wrangler hỏi** `Enter a secret value:` (gõ không hiện chữ là bình thường), không gõ giá trị vào lệnh.

```bash
npx wrangler pages secret put ADMIN_PASSWORD --project-name shopbot-vn   # mật khẩu đăng nhập admin, dài và khó đoán
npx wrangler pages secret put SESSION_SECRET --project-name shopbot-vn   # chuỗi ngẫu nhiên
npx wrangler pages secret put DATA_KEY       --project-name shopbot-vn   # chuỗi ngẫu nhiên — LƯU LẠI
```

Tạo chuỗi ngẫu nhiên: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

Hoặc tạo `DATA_KEY` thẳng vào file riêng (không hiện ra màn hình) rồi nạp:

```bash
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" > ~/shopbot-DATA_KEY.txt && chmod 600 ~/shopbot-DATA_KEY.txt
npx wrangler pages secret put DATA_KEY --project-name shopbot-vn < ~/shopbot-DATA_KEY.txt
```

> **Giữ kỹ `DATA_KEY`** (sao lưu ra chỗ an toàn). Mất hoặc đổi thì không đọc lại được tài khoản/mật khẩu của các acc đã lưu.

Kiểm tra đủ 3 secret rồi deploy lại:

```bash
npx wrangler pages secret list --project-name shopbot-vn
npm run deploy
```

## 4. (Tùy chọn) Tên miền riêng

Dashboard → Workers & Pages → shopbot-vn → **Custom domains**. Làm **trước** bước 5–6: đổi tên miền sau này phải kết nối lại bot/SePay và tạo lại bot con.

## 5. Kết nối bot Telegram

1. Mở `https://shopbot-vn.pages.dev/admin/` → đăng nhập bằng `ADMIN_PASSWORD`.
2. **Cài đặt → Bot Telegram**: dán Bot token, nhập ID Telegram admin (nhiều ID cách nhau dấu phẩy) → **Lưu & kết nối bot**.
3. Thấy chấm xanh **"Đang hoạt động · @tenbot"** là xong. Gửi `/start` cho bot → bot chào bằng ảnh logo + menu.
4. Ảnh đại diện bot: @BotFather → `/setuserpic` → gửi logo SHOPBOT.

## 6. Kết nối SePay (nạp tiền tự động)

**Trong admin → Cài đặt → Nạp tiền tự động (SePay):**
1. Nhập **Ngân hàng** (viết tắt: MBBank, Vietcombank, ACB, TPBank, Techcombank…), **Số tài khoản**, **Chủ tài khoản** đúng như trên SePay.
2. Bấm **Tạo key** → **Lưu cài đặt** → sao chép key.
3. Ảnh **xem trước mã QR** phải hiện đúng ngân hàng/số tài khoản.

**Trên my.sepay.vn → Tích hợp WebHooks → Thêm WebHooks:**

| Mục | Điền |
|---|---|
| Sự kiện | Có tiền vào |
| Tài khoản ngân hàng | tài khoản nhận tiền của shop |
| URL nhận webhook | `https://shopbot-vn.pages.dev/api/sepay/webhook` |
| Kiểu xác thực | **API Key** → dán key ở bước 2 |
| Request content type | application/json |
| Bỏ qua nếu không có mã thanh toán | **Không** |

Thử: trong bot bấm **Nạp tiền** → chuyển 10.000đ đúng nội dung `NAP<mã khách>` → 1–3 phút sau bot báo đã nhận, admin → **Nạp tiền SePay** có dòng "Đã cộng".

## 7. Kết nối nhà cung cấp dịch vụ (trumsubviet.com)

1. **Cài đặt → Nhà cung cấp**: dán API key → **Kiểm tra kết nối** (phải hiện số dư).
2. **Dịch vụ & giá → Quy tắc giá bán**: chọn "Cộng thêm số tiền cho mỗi 1.000 lượt" (vd 5000) hoặc "% trên giá vốn" → **Lưu & đồng bộ toàn bộ dịch vụ**.
3. Ẩn gói không muốn bán, sửa tên/mô tả cho dễ hiểu.

## 8. Thiết lập bán hàng

- **Tích xanh FB**: Dịch vụ & giá → **Tạo nhanh Tích xanh FB** → nhập giá.
- **Acc game**: Acc game → **Quản lý game** → **Đăng acc**.
- **Thương hiệu**: Cài đặt → Thương hiệu (tên, khẩu hiệu, logo, banner, bộ màu).
- **Đại lý**: Cài đặt → Đại lý, API và bot con.
- **Mã quà khai trương**: Mã quà tặng → Tạo mã.
- **Lưu trữ ảnh**: kiểm tra giới hạn dung lượng R2 (mặc định 9.000MB) và số ngày giữ ảnh acc đã bán.

Chi tiết từng trang: [docs/ADMIN.md](docs/ADMIN.md).

## 9. Kiểm tra trước khi mở bán

- [ ] Cài đặt → Hệ thống: **DATA_KEY đang bật**, **R2 đã kết nối**
- [ ] `/start` bot ra ảnh logo + menu
- [ ] Nạp 10.000đ thật → tự cộng, bot báo
- [ ] Đặt 1 đơn dịch vụ rẻ nhất → "Đang chạy" → vài phút sau "Hoàn thành"
- [ ] Đăng acc thử giá 1.000đ → mua qua bot → nhận tài khoản → xóa acc thử
- [ ] `https://shopbot-vn.pages.dev/app/` → Đăng nhập bằng Telegram → đúng số dư
- [ ] Gửi thông báo thử cho chính mình
- [ ] (Nếu dùng) tạo bot con bằng một bot thử → giá bot con cao hơn bot gốc

## Cập nhật code

```bash
git pull            # nếu sửa code ở máy khác
npm run deploy
```

Dữ liệu D1/R2 giữ nguyên; bảng mới / cột mới tự được thêm.

## Sao lưu dữ liệu

```bash
npx wrangler d1 export shopbot --remote --output backup-$(date +%F).sql
```

Nên chạy hằng tuần, cất file ra chỗ khác cùng với `DATA_KEY`.

## Xử lý sự cố

| Hiện tượng | Nguyên nhân / cách xử lý |
|---|---|
| "An HTTPS URL must be provided for webhook" / "Telegram chỉ nhận webhook HTTPS" | Đang mở admin bằng `http://127.0.0.1`. Mở admin bằng địa chỉ `https://…pages.dev` rồi bấm lại. |
| Cài đặt báo "Chưa đặt secret DATA_KEY" | Chạy lệnh đặt `DATA_KEY` ở bước 3, kiểm tra `secret list`, rồi `npm run deploy`. |
| Đăng nhập admin báo "Chưa đặt biến ADMIN_PASSWORD" | Tương tự: đặt secret rồi deploy lại. |
| `Please enable R2 through the Cloudflare Dashboard [10042]` | Chưa bật R2 trong Dashboard (bước 1). |
| Bot không trả lời | Cài đặt → Bot: xem dòng trạng thái webhook và "lỗi gần nhất"; bấm lại **Lưu & kết nối bot**. Kiểm tra bot không bật **Bảo trì**. |
| Chuyển khoản không được cộng | Nội dung phải có `NAP<mã khách>`; xem admin → Nạp tiền SePay (dòng "Chưa khớp" → **Cộng cho khách**). Kiểm tra API key webhook trên SePay trùng với admin. |
| Kiểm tra kết nối nhà cung cấp lỗi / bị chặn | trumsubviet yêu cầu mở IP; Cloudflare không có IP cố định → nhờ trumsubviet bỏ chặn IP cho key, hoặc dùng proxy có IP cố định và điền vào "Địa chỉ API". |
| Tải ảnh báo "Bộ nhớ ảnh đã gần đầy" | Admin → Lưu trữ ảnh → **Dọn ngay**, hoặc tăng giới hạn (không vượt 10.240MB nếu muốn miễn phí). |
| `Wrangler requires at least Node.js v22` | Dự án ghim wrangler 4.86.0 cho Node 20; chạy `npm install` lại (không chạy `npm audit fix --force`). |
