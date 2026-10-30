import { changeBalance, esc, json, money, now } from './util.js';
import { notifyAdmins, notifyUser } from './shop.js';

export function topupCode(settings, userId) {
  return `${(settings.topup_prefix || 'NAP').toUpperCase()}${userId}`;
}

/** Tìm mã nạp trong nội dung chuyển khoản, chịu được ngân hàng chèn thêm ký tự/khoảng trắng. */
function parseTopupUser(settings, content) {
  const prefix = (settings.topup_prefix || 'NAP').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const text = String(content || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ');
  const m = text.match(new RegExp(`${prefix}\\s?(\\d{1,12})(?!\\d)`));
  return m ? Number(m[1]) : null;
}

export function qrUrl(settings, amount, userId) {
  const p = new URLSearchParams({
    acc: settings.bank_account,
    bank: settings.bank_code,
    des: topupCode(settings, userId),
  });
  if (amount) p.set('amount', String(amount));
  return `https://qr.sepay.vn/img?${p}`;
}

export async function creditTopup(app, topupId, userId) {
  const { db, settings } = app;
  const bonusPct = Math.max(0, Number(settings.topup_bonus_percent) || 0);
  const t = await db
    .prepare(
      `UPDATE topups SET status = 'credited', user_id = ?1, bonus = CAST(amount * ?2 / 100 AS INTEGER)
       WHERE id = ?3 AND status = 'unmatched' RETURNING *`
    )
    .bind(userId, bonusPct, topupId)
    .first();
  if (!t) return { ok: false, msg: 'Giao dịch đã được xử lý trước đó.' };
  const user = await db.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first();
  if (!user) {
    await db.prepare(`UPDATE topups SET status = 'unmatched', user_id = NULL, bonus = 0 WHERE id = ?`).bind(topupId).run();
    return { ok: false, msg: 'Không tìm thấy người dùng.' };
  }
  const total = t.amount + t.bonus;
  const bal = await changeBalance(db, userId, total, { type: 'topup', ref: `topup:${t.id}`, note: t.reference || '' });
  await notifyUser(app, userId,
    `<b>Nạp tiền thành công</b>\nSố tiền: ${money(t.amount)}` +
    (t.bonus ? `\nKhuyến mãi: +${money(t.bonus)}` : '') +
    `\nSố dư hiện tại: <b>${money(bal)}</b>`);
  return { ok: true, topup: t, balance: bal };
}

/**
 * Webhook SePay. Cấu hình trên my.sepay.vn: URL = <site>/api/sepay/webhook,
 * kiểu xác thực "API Key", key trùng với "SePay API key" trong trang Cài đặt.
 */
export async function handleSepayWebhook(request, app) {
  const { db, settings } = app;
  const key = settings.sepay_api_key;
  const auth = request.headers.get('authorization') || '';
  if (!key || auth.replace(/^apikey\s+/i, '').trim() !== key) {
    return json({ success: false, message: 'unauthorized' }, 401);
  }

  let p;
  try {
    p = await request.json();
  } catch {
    return json({ success: false, message: 'bad json' }, 400);
  }
  if (!p || p.id === undefined) return json({ success: false, message: 'missing id' }, 400);

  const amount = Math.round(Number(p.transferAmount) || 0);
  const incoming = p.transferType === 'in' && amount > 0;
  const wrongAccount = settings.bank_account && p.accountNumber && String(p.accountNumber) !== String(settings.bank_account)
    && String(p.subAccount || '') !== String(settings.bank_account);
  const content = p.content || p.description || '';

  // UNIQUE(sepay_id): SePay gửi lại cùng giao dịch sẽ bị bỏ qua
  const ins = await db
    .prepare(
      `INSERT OR IGNORE INTO topups (sepay_id, amount, content, gateway, account_number, reference, status, raw, created_at)
       VALUES (?,?,?,?,?,?,?,?,?) RETURNING id`
    )
    .bind(String(p.id), amount, content, p.gateway || '', String(p.accountNumber || ''), p.referenceCode || '',
      incoming && !wrongAccount ? 'unmatched' : 'ignored', JSON.stringify(p).slice(0, 4000), now())
    .first();
  if (!ins) return json({ success: true, duplicate: true });
  if (!incoming || wrongAccount) return json({ success: true, ignored: true });

  const userId = parseTopupUser(settings, `${p.code || ''} ${content}`);
  const user = userId ? await db.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first() : null;
  if (user) {
    await creditTopup(app, ins.id, user.id);
    notifyAdmins(app, `Nạp tiền: <code>${user.id}</code> +${money(amount)}`).catch(() => {});
  } else if (!userId && settings.sepay_ignore_nocode === '1') {
    // Tài khoản dùng chung với hệ thống khác: tiền không có mã NAP không phải của shop, bỏ qua im lặng
    await db.prepare(`UPDATE topups SET status = 'ignored' WHERE id = ?`).bind(ins.id).run();
  } else {
    notifyAdmins(app, `<b>Giao dịch chưa khớp</b> ${money(amount)}\nNội dung: ${esc(content)}`).catch(() => {});
  }
  return json({ success: true });
}
