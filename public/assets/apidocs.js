// Tài liệu API đại lý (dùng chung cho trang shop và cổng khách hàng)
export const API_DOCS = [
  ['services', 'Danh sách gói dịch vụ', { action: 'services' },
    '[{ "service": 12, "name": "Like bài viết Việt", "category": "Facebook · Like / tim", "category_id": 3,\n   "input_type": "quantity", "rate": "6700", "min": "100", "max": "20000",\n   "reactions": ["like","love","haha"] }]\n\n// rate = giá cho 1.000 lượt (gói trọn gói: giá cả gói)'],
  ['categories', 'Danh mục để dựng menu', { action: 'categories' }, '[{ "id": 3, "name": "Facebook · Like / tim", "services": 4 }]'],
  ['add', 'Tạo đơn dịch vụ', { action: 'add', service: 12, link: 'https://facebook.com/...', quantity: 1000, reaction: 'love' },
    '{ "order": 123 }\n\n// Gói bình luận: "comments" (mỗi dòng một bình luận)\n// Gói VIP/mắt live: "days" / "minutes"\n// Gói tích xanh: "contact" (SĐT/Zalo), "note"'],
  ['status', 'Trạng thái đơn', { action: 'status', order: 123 },
    '{ "charge": "6700", "start_count": "350", "status": "In progress",\n  "remains": "400", "currency": "VND" }\n\n// Nhiều đơn: "orders": "1,2,3" (tối đa 100)\n// status: Pending | In progress | Completed | Partial | Canceled'],
  ['accounts', 'Danh sách acc game đang bán', { action: 'accounts', game: 1 },
    '[{ "account": 45, "game": "Liên Quân", "title": "VIP 5 · 3 SSS", "info": "...",\n   "price": "2340000", "delivery": "instant",\n   "images": ["https://.../api/img/acc/....jpg"] }]\n\n// "game" không bắt buộc; delivery: instant | manual'],
  ['buy_account', 'Mua acc game', { action: 'buy_account', account: 45 },
    '{ "account": 45, "charge": "2340000", "balance": "660000",\n  "status": "Delivered", "login": "tk: ... / mk: ..." }\n\n// Acc giao thủ công: status "Pending", login null → gọi my_accounts sau'],
  ['my_accounts', 'Acc đã mua (kèm thông tin đăng nhập)', { action: 'my_accounts' },
    '[{ "account": 45, "title": "VIP 5", "charge": "2340000", "status": "Delivered", "login": "..." }]'],
  ['balance', 'Số dư', { action: 'balance' }, '{ "balance": "250000", "currency": "VND" }'],
  ['profile', 'Thông tin tài khoản', { action: 'profile' }, '{ "user_id": 1, "username": "shopcuaban", "balance": "250000", "currency": "VND" }'],
];

export function curl(url, body) {
  return `curl -X POST ${url} \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify({ key: 'sk_...', ...body })}'`;
}

export const API_NOTES = [
  'Gọi được từ máy chủ hoặc trực tiếp từ trình duyệt (đã bật CORS). Nên gọi từ máy chủ để không lộ API key.',
  'Lỗi trả về dạng { "error": "..." }. Tiền được trừ vào số dư tài khoản sở hữu key.',
  'Giá acc và gói dịch vụ qua API là giá đại lý — bạn tự cộng thêm khi bán lại trên web của mình.',
];
