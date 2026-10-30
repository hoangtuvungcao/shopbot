// Schema tự tạo khi chạy lần đầu (CREATE IF NOT EXISTS) nên không cần chạy migration tay.
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,

  // Mỗi bot (gốc = 0, bot con = id trong bảng bots) có tập khách và số dư riêng
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tg_id INTEGER NOT NULL, bot_id INTEGER NOT NULL DEFAULT 0,
    username TEXT, first_name TEXT,
    balance INTEGER NOT NULL DEFAULT 0,
    total_topup INTEGER NOT NULL DEFAULT 0,
    total_spent INTEGER NOT NULL DEFAULT 0,
    commission_total INTEGER NOT NULL DEFAULT 0,
    withdrawn_total INTEGER NOT NULL DEFAULT 0,
    api_key TEXT,
    banned INTEGER NOT NULL DEFAULT 0,
    state TEXT, state_data TEXT, album TEXT,
    created_at INTEGER, last_seen INTEGER,
    UNIQUE (bot_id, tg_id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_api ON users(api_key) WHERE api_key IS NOT NULL`,

  `CREATE TABLE IF NOT EXISTS bots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER NOT NULL, token TEXT NOT NULL, username TEXT, name TEXT,
    secret TEXT NOT NULL, markup REAL NOT NULL DEFAULT 20,
    support_zalo TEXT, welcome_text TEXT,
    active INTEGER NOT NULL DEFAULT 1, created_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_bots_owner ON bots(owner_id)`,

  `CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, amount INTEGER NOT NULL, bank_info TEXT,
    status TEXT NOT NULL DEFAULT 'pending', note TEXT,
    created_at INTEGER, updated_at INTEGER
  )`,

  `CREATE TABLE IF NOT EXISTS balance_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, amount INTEGER NOT NULL, balance_after INTEGER,
    type TEXT, ref TEXT, note TEXT, created_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_logs_user ON balance_logs(user_id, id)`,

  `CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, source_key TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER, name TEXT NOT NULL, description TEXT,
    mode TEXT NOT NULL DEFAULT 'api',
    input_type TEXT NOT NULL DEFAULT 'quantity',
    server_order TEXT,
    price REAL NOT NULL DEFAULT 0, cost REAL NOT NULL DEFAULT 0, api_price REAL NOT NULL DEFAULT 0,
    min_qty INTEGER NOT NULL DEFAULT 1, max_qty INTEGER NOT NULL DEFAULT 100000,
    extra_min INTEGER NOT NULL DEFAULT 1, extra_max INTEGER NOT NULL DEFAULT 30,
    reactions TEXT, auto_price INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER
  )`,

  `CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, bot_id INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'bot',
    service_id INTEGER, service_name TEXT, category_name TEXT,
    mode TEXT, link TEXT, quantity INTEGER, extra TEXT,
    price_total INTEGER NOT NULL, base_total INTEGER NOT NULL DEFAULT 0, cost_total INTEGER NOT NULL DEFAULT 0,
    commission INTEGER NOT NULL DEFAULT 0, commission_paid INTEGER NOT NULL DEFAULT 0,
    refunded INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    upstream_code TEXT, upstream_status TEXT, start_count INTEGER, delivered INTEGER,
    admin_note TEXT, created_at INTEGER, updated_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, id)`,

  `CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
  )`,

  `CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER, title TEXT, info TEXT, description TEXT, secret TEXT,
    price INTEGER NOT NULL DEFAULT 0, cost INTEGER NOT NULL DEFAULT 0,
    images TEXT, tg_file_ids TEXT,
    status TEXT NOT NULL DEFAULT 'available',
    buyer_id INTEGER, sold_price INTEGER, sold_at INTEGER,
    bot_id INTEGER NOT NULL DEFAULT 0, commission INTEGER NOT NULL DEFAULT 0, commission_paid INTEGER NOT NULL DEFAULT 0,
    delivery TEXT NOT NULL DEFAULT 'auto', delivered_at INTEGER,
    created_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_acc_status ON accounts(status, game_id)`,

  `CREATE TABLE IF NOT EXISTS topups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sepay_id TEXT UNIQUE, user_id INTEGER, amount INTEGER NOT NULL, bonus INTEGER NOT NULL DEFAULT 0,
    content TEXT, gateway TEXT, account_number TEXT, reference TEXT,
    status TEXT NOT NULL, raw TEXT, created_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_topups_status ON topups(status)`,

  `CREATE TABLE IF NOT EXISTS giftcodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE, amount INTEGER NOT NULL, max_uses INTEGER NOT NULL DEFAULT 1,
    used INTEGER NOT NULL DEFAULT 0, expires_at INTEGER, active INTEGER NOT NULL DEFAULT 1,
    note TEXT, created_at INTEGER
  )`,
  // Khóa theo tg_id (không theo user_id) để một người không dùng lại mã qua bot con khác
  `CREATE TABLE IF NOT EXISTS giftcode_uses (
    code_id INTEGER NOT NULL, tg_id INTEGER NOT NULL, user_id INTEGER NOT NULL, created_at INTEGER,
    PRIMARY KEY (code_id, tg_id)
  )`,

  `CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL, target TEXT, detail TEXT, ip TEXT, created_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at)`,

  `CREATE TABLE IF NOT EXISTS login_tokens (
    token TEXT PRIMARY KEY, browser TEXT NOT NULL, user_id INTEGER, status TEXT NOT NULL DEFAULT 'pending',
    ip TEXT, ua TEXT, created_at INTEGER
  )`,
  // Chống gửi trùng đơn từ web (bấm 2 lần, mạng chậm gửi lại)
  `CREATE TABLE IF NOT EXISTS request_nonces (nonce TEXT PRIMARY KEY, user_id INTEGER, created_at INTEGER)`,

  // Danh sách file trên R2 để tính dung lượng mà không phải liệt kê bucket
  `CREATE TABLE IF NOT EXISTS r2_files (key TEXT PRIMARY KEY, size INTEGER NOT NULL, kind TEXT NOT NULL, created_at INTEGER)`,

  `CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_login_ip ON login_attempts(ip, at)`,

  `CREATE TABLE IF NOT EXISTS processed_updates (bot_id INTEGER NOT NULL, update_id INTEGER NOT NULL, created_at INTEGER, PRIMARY KEY (bot_id, update_id))`,
];

// Nâng cấp database đã có từ bản cũ: thêm cột mới. Lỗi "duplicate column" nghĩa là đã có, bỏ qua.
const MIGRATIONS = [
  `ALTER TABLE categories ADD COLUMN source_key TEXT`,
  `ALTER TABLE services ADD COLUMN auto_price INTEGER NOT NULL DEFAULT 0`,
];

let ready = false;

export async function ensureSchema(db) {
  if (ready) return;
  await db.batch(STATEMENTS.map((s) => db.prepare(s)));
  for (const m of MIGRATIONS) {
    try {
      await db.prepare(m).run();
    } catch (e) {
      if (!/duplicate column/i.test(String(e.message))) throw e;
    }
  }
  ready = true;
}
