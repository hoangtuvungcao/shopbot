export const now = () => Math.floor(Date.now() / 1000);

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const money = (n) => `${Math.round(Number(n) || 0).toLocaleString('vi-VN')}đ`;
export const num = (n) => (Number(n) || 0).toLocaleString('vi-VN');

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function randomToken(bytes = 24) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function safeJson(s, fallback = null) {
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

export const toInt = (v, d = 0) => {
  const n = parseInt(String(v ?? '').replace(/[.,\s]/g, ''), 10);
  return Number.isFinite(n) ? n : d;
};

// ---------- settings ----------

export const DEFAULT_SETTINGS = {
  shop_name: 'SHOPBOT',
  logo: '/assets/brand/shopbot-icon.webp',
  hero_art: '/assets/brand/shopbot-logo.jpg',
  hero_image: '',
  logo_style: 'monogram',
  tagline: 'Acc game và dịch vụ tăng tương tác tự động 24/7',
  hero_title: 'Acc game và dịch vụ tăng tương tác, mua trong vài giây.',
  hero_subtitle: 'Chọn món ở đây, thanh toán và nhận hàng tự động qua bot Telegram. Nạp tiền bằng chuyển khoản, số dư cộng sau 1–3 phút.',
  accent_color: '#ec4899',
  accent_color2: '#8b5cf6',
  footer_text: '',
  bot_token: '',
  bot_username: '',
  webhook_secret: '',
  admin_chat_ids: '',
  welcome_text: 'Chào mừng bạn đến với shop. Chọn chức năng ở menu bên dưới.',
  support_text: 'Liên hệ admin để được hỗ trợ.',
  support_url: '',
  support_zalo: '0385673834',
  site_notice: '',
  api_base: 'https://trumsubviet.com',
  api_key: '',
  bank_code: '',
  bank_account: '',
  bank_owner: '',
  sepay_api_key: '',
  topup_prefix: 'NAP',
  topup_min: '10000',
  topup_amounts: '20000,50000,100000,200000,500000,1000000',
  topup_bonus_percent: '0',
  maintenance: '0',
  markup_type: 'per1k',
  markup_value: '5000',
  auto_add_services: '1',
  catalog_sync_at: '0',
  api_enabled: '1',
  child_enabled: '1',
  reseller_rate: '100',
  child_min_markup: '10',
  child_max_markup: '300',
  withdraw_min: '50000',
  last_sync_at: '0',
};

export async function loadSettings(db) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all();
  const s = { ...DEFAULT_SETTINGS };
  for (const r of results) s[r.key] = r.value ?? '';
  return s;
}

export async function saveSettings(db, patch) {
  const stmts = Object.entries(patch)
    .filter(([k]) => k in DEFAULT_SETTINGS)
    .map(([k, v]) =>
      db
        .prepare('INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2')
        .bind(k, String(v ?? ''))
    );
  if (stmts.length) await db.batch(stmts);
}

// ---------- balance ----------

/**
 * Cộng/trừ số dư một cách nguyên tử. Trừ tiền chỉ thành công khi đủ số dư,
 * nên hai yêu cầu song song không thể làm số dư âm.
 * Trả về số dư mới, hoặc null nếu không đủ tiền / không có user.
 */
export async function changeBalance(db, userId, delta, { type, ref = '', note = '' } = {}) {
  delta = Math.round(delta);
  const spend = ['order', 'buy_acc', 'refund'].includes(type) ? -delta : 0;
  const topup = type === 'topup' ? delta : 0;
  const commission = type === 'commission' ? delta : 0;
  const withdrawn = type === 'withdraw' ? -delta : 0;
  const row = await db
    .prepare(
      `UPDATE users SET balance = balance + ?1, total_spent = total_spent + ?2, total_topup = total_topup + ?3,
         commission_total = commission_total + ?4, withdrawn_total = withdrawn_total + ?5
       WHERE id = ?6 AND balance + ?1 >= 0 RETURNING balance`
    )
    .bind(delta, spend, topup, commission, withdrawn, userId)
    .first();
  if (!row) return null;
  await db
    .prepare(
      'INSERT INTO balance_logs (user_id, amount, balance_after, type, ref, note, created_at) VALUES (?,?,?,?,?,?,?)'
    )
    .bind(userId, delta, row.balance, type || '', String(ref), note, now())
    .run();
  return row.balance;
}
