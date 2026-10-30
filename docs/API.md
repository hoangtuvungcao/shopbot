# API đại lý SHOPBOT

Dùng để bán lại dịch vụ MXH và acc game trên **web con / panel** của bạn. Tương thích chuẩn SMM panel v2 (`services`, `add`, `status`, `balance`) và có thêm API acc game.

- **Endpoint:** `POST https://shopbot-vn.pages.dev/api/v2`
- **Định dạng:** JSON (`Content-Type: application/json`) hoặc form (`application/x-www-form-urlencoded`, `multipart/form-data`)
- **Xác thực:** trường `key` trong body. Lấy key tại `https://shopbot-vn.pages.dev/app/#/api` (đăng nhập bằng Telegram) hoặc trong bot: **Đại lý & API → Tạo API key**. Tạo key mới thì key cũ ngừng hoạt động.
- **Tiền tệ:** VND. Tiền trừ vào số dư của tài khoản sở hữu key (nạp như khách thường).
- **Giá:** giá đại lý (giá niêm yết × tỷ lệ đại lý admin đặt, hoặc giá đại lý riêng của gói). Bạn tự cộng thêm khi bán lại.
- **CORS:** đã bật (gọi được từ trình duyệt), nhưng **nên gọi từ máy chủ** để không lộ key.
- **Lỗi:** `{ "error": "mô tả lỗi" }` (HTTP 200, key sai trả 401).

## Ví dụ gọi

```bash
curl -X POST https://shopbot-vn.pages.dev/api/v2 \
  -H "Content-Type: application/json" \
  -d '{"key":"sk_...","action":"balance"}'
```

```js
// Node.js / máy chủ của web con
const r = await fetch('https://shopbot-vn.pages.dev/api/v2', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ key: process.env.SHOPBOT_KEY, action: 'services' }),
});
const services = await r.json();
```

```php
// PHP
$ch = curl_init('https://shopbot-vn.pages.dev/api/v2');
curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true,
  CURLOPT_POSTFIELDS => ['key' => 'sk_...', 'action' => 'add', 'service' => 12, 'link' => 'https://...', 'quantity' => 1000]]);
$order = json_decode(curl_exec($ch), true);
```

## Dịch vụ MXH

### `services` — danh sách gói
```json
{ "key": "sk_...", "action": "services" }
```
```json
[{ "service": 12, "name": "Like bài viết Việt", "type": "Default", "category": "Facebook · Like / tim", "category_id": 3,
   "input_type": "quantity", "rate": "6700", "min": "100", "max": "20000", "refill": false, "cancel": false,
   "reactions": ["like","love","haha"], "description": "..." }]
```
- `rate`: giá cho **1.000 lượt** (gói trọn gói/tích xanh: giá cả gói).
- `input_type`: `quantity` (link + số lượng), `days` (VIP theo ngày, có `extra_min`/`extra_max`), `minutes` (mắt live theo phút), `comment` (danh sách bình luận), `fixed` (trọn gói), `verify` (tích xanh).
- Thành tiền = `rate / 1000 × quantity × (days hoặc minutes nếu có)`.

### `categories` — danh mục
```json
{ "key": "sk_...", "action": "categories" }
→ [{ "id": 3, "name": "Facebook · Like / tim", "services": 4 }]
```

### `add` — tạo đơn
```json
{ "key": "sk_...", "action": "add", "service": 12, "link": "https://facebook.com/...", "quantity": 1000, "reaction": "love" }
→ { "order": 123 }
```
Trường theo loại gói:

| Loại | Trường thêm |
|---|---|
| có cảm xúc | `reaction` (một trong `reactions` của gói; bỏ trống = cái đầu tiên) |
| `days` | `days` |
| `minutes` | `minutes` |
| `comment` | `comments` — mỗi dòng một bình luận (số dòng = số lượng) |
| `verify` | `contact` (SĐT/Zalo), `note` |

### `status` — trạng thái đơn
```json
{ "key": "sk_...", "action": "status", "order": 123 }
→ { "charge": "6700", "start_count": "350", "status": "In progress", "remains": "400", "currency": "VND" }
```
Nhiều đơn (tối đa 100): `"orders": "1,2,3"` → `{ "1": {...}, "2": {...}, "3": { "error": "Incorrect order ID" } }`

`status`: `Pending` (chờ xử lý) · `In progress` · `Completed` · `Partial` (hoàn một phần, `charge` là số tiền thực trừ) · `Canceled`.

## Acc game

### `accounts` — acc đang bán
```json
{ "key": "sk_...", "action": "accounts", "game": 1 }
```
```json
[{ "account": 45, "game_id": 1, "game": "Liên Quân", "title": "VIP 5 · 3 SSS", "info": "Cấp VIP: VIP 5\n...",
   "description": "...", "price": "2340000", "delivery": "instant",
   "images": ["https://shopbot-vn.pages.dev/api/img/acc/....webp"], "created_at": 1793339041 }]
```
`game` không bắt buộc. `delivery`: `instant` (giao ngay) hoặc `manual` (admin giao sau). Không bao giờ chứa thông tin đăng nhập.

### `buy_account` — mua acc
```json
{ "key": "sk_...", "action": "buy_account", "account": 45 }
→ { "account": 45, "charge": "2340000", "balance": "660000", "status": "Delivered", "login": "tk: ... / mk: ..." }
```
Acc giao thủ công: `"status": "Pending"`, `"login": null` → gọi `my_accounts` sau. Acc đã bán / không đủ tiền → `{ "error": ... }` và không trừ tiền.

### `my_accounts` — acc đã mua
```json
{ "key": "sk_...", "action": "my_accounts" }
→ [{ "account": 45, "title": "VIP 5", "charge": "2340000", "status": "Delivered", "login": "...", "bought_at": 1793339041 }]
```

## Tài khoản

```json
{ "key": "sk_...", "action": "balance" }  → { "balance": "250000", "currency": "VND" }
{ "key": "sk_...", "action": "profile" }  → { "user_id": 1, "username": "shopcuaban", "balance": "250000", "currency": "VND" }
```

## Gợi ý làm web con

1. Máy chủ web con lưu key, định kỳ gọi `services` + `accounts` để hiển thị (cache 5–10 phút).
2. Khách web con thanh toán cho bạn; bạn gọi `add` / `buy_account` để mua từ SHOPBOT bằng số dư của mình.
3. Gọi `status` (theo lô `orders`) mỗi vài phút để cập nhật đơn cho khách.
4. Giữ số dư SHOPBOT đủ dùng (kiểm tra `balance`).

Không muốn tự làm web? Dùng **bot con**: bot → **Đại lý & API → Tạo bot con**, tự đặt % lãi, hệ thống lo thanh toán và giao hàng, hoa hồng cộng vào số dư của bạn.
