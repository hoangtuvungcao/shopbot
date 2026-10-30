# SHOPBOT

Hệ thống bán hàng tự động gồm **bot Telegram**, **web bán hàng**, **cổng khách hàng**, **web quản trị** và **API đại lý**, chạy hoàn toàn trên **Cloudflare Pages** (Pages Functions + D1 + R2). Một lần deploy là cả bot lẫn web cùng hoạt động.

**Bản đang chạy:** https://shopbot-vn.pages.dev · Bot: [@shopbotonline_bot](https://t.me/shopbotonline_bot)

| Tài liệu | Dành cho |
|---|---|
| [SETUP.md](SETUP.md) | Cài đặt, deploy, kết nối bot / SePay / nhà cung cấp, xử lý sự cố |
| [docs/ADMIN.md](docs/ADMIN.md) | Hướng dẫn dùng web quản trị hằng ngày |
| [docs/API.md](docs/API.md) | Tài liệu API cho đại lý làm web con / panel |

## Chức năng

**Bán hàng**
- **Dịch vụ MXH** (like, tim, follow, view, mắt live, bình luận, VIP…): tự đồng bộ toàn bộ gói từ trumsubviet.com, tự tính giá bán theo quy tắc chênh lệch (cộng X đ / 1.000 lượt hoặc %), đơn tự chạy và tự cập nhật trạng thái, tự hoàn tiền phần chưa chạy.
- **Tích xanh Facebook** (khách thuê làm): khách gửi link + SĐT/Zalo, trừ tiền trước, admin nhận xử lý → hoàn thành hoặc hoàn tiền.
- **Acc game**: album ảnh + thông tin, giao **tự động** (hiện tài khoản ngay) hoặc **thủ công** (acc giá trị cao, admin giao sau).
- **Nạp tiền tự động** qua SePay (QR, cộng tiền 1–3 phút, khuyến mãi %), **mã quà tặng**.

**Kênh bán**
- **Bot Telegram** gốc, **bot con** của đại lý (giá cao hơn, chủ bot nhận hoa hồng), **web bán hàng** `/`, **cổng khách hàng** `/app/` (đăng nhập bằng Telegram, dùng chung số dư với bot), **API đại lý** `/api/v2` (dịch vụ + acc game, đủ để làm web con).

**Quản trị** `/admin/`
- Tổng quan & biểu đồ, đơn dịch vụ, dịch vụ & giá, acc game, nạp tiền SePay, người dùng, đại lý & bot con, mã quà tặng, gửi thông báo, lưu trữ ảnh R2, nhật ký thao tác, cài đặt (thương hiệu, bot, SePay, nhà cung cấp, đại lý, bảo trì), xuất Excel.
- Dùng tốt trên điện thoại, cài được như app (PWA), giao diện sáng/tối.

## Kiến trúc

```
Telegram ──webhook──▶ /api/telegram/webhook[/<bot con>] ─┐
SePay ─────webhook──▶ /api/sepay/webhook ────────────────┤
Đại lý ────POST─────▶ /api/v2 ───────────────────────────┤    Pages Functions
Trình duyệt ────────▶ /api/public, /api/me, /api/admin ──┼──▶ (src/*.js) ──▶ D1 (dữ liệu)
                     /, /app/, /admin/ (file tĩnh)        │                └─▶ R2 (ảnh)
                                                          └──▶ trumsubviet.com (đặt đơn dịch vụ)
```

Không có máy chủ riêng, không cần cron: việc định kỳ (đồng bộ đơn ~2 phút, đồng bộ gói dịch vụ và dọn ảnh R2 mỗi 6 giờ) chạy nền khi có request tới.

## Cấu trúc thư mục

```
functions/api/[[path]].js   điểm vào Pages Functions (mọi /api/*)
src/
  router.js      định tuyến, việc chạy nền, phục vụ ảnh
  schema.js      bảng D1 (tự tạo + tự nâng cấp)
  bot.js         bot Telegram (bot gốc và bot con)
  orders.js      đặt đơn, đồng bộ, hoàn tiền, hoa hồng
  accounts.js    mua acc        gift.js     mã quà tặng
  catalog.js     đồng bộ gói & quy tắc giá
  sepay.js       nạp tiền       upstream.js API trumsubviet
  shop.js        giá nhiều tầng, gửi tin đúng bot
  me.js          API cổng khách hàng     api.js  API đại lý v2
  admin.js       API quản trị   storage.js  quản lý R2
  auth.js        phiên đăng nhập admin/khách    crypto.js  mã hóa thông tin acc
  telegram.js, util.js
public/
  index.html     web bán hàng         app/   cổng khách hàng     admin/  web quản trị
  assets/        JS/CSS, logo SHOPBOT (assets/brand)
wrangler.toml    cấu hình D1/R2 (không chứa bí mật)
```

## Bảo mật & chống lỗi

- Trừ tiền nguyên tử, số dư không bao giờ âm; bấm trùng / gửi lại webhook không tạo đơn hay cộng tiền hai lần.
- Hoàn tiền, trả hoa hồng, giao acc, dùng mã quà chỉ thực hiện một lần.
- Webhook Telegram có secret riêng từng bot; webhook SePay kiểm tra API key.
- Admin: cookie HttpOnly, chặn ghi từ domain khác, khóa 15 phút sau 6 lần sai mật khẩu, nhật ký thao tác (ẩn token/mật khẩu).
- Thông tin đăng nhập acc mã hóa AES-GCM bằng `DATA_KEY`; trang công khai và API không trả thông tin nhạy cảm.
- R2 có giới hạn dung lượng tự chặn, tự dọn ảnh rác → không phát sinh phí.

## Phát triển trên máy

Yêu cầu Node.js 20+.

```bash
npm install
cp .dev.vars.example .dev.vars     # đặt mật khẩu admin thử
npm run dev                        # http://127.0.0.1:8788  (/admin/, /app/)
npm run check                      # kiểm tra cú pháp
npm run deploy                     # deploy lên Cloudflare (project shopbot-vn)
```

Trên máy chỉ xem được giao diện và dữ liệu; bot Telegram và SePay chỉ hoạt động trên bản deploy HTTPS.

> `npm audit` có thể báo vài lỗ hổng trong công cụ chạy thử (wrangler) — chúng không nằm trong code chạy trên Cloudflare. Muốn sạch hẳn: dùng Node 22 rồi `npm install --save-dev wrangler@latest && npm audit fix`.
