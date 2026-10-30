// Cổng khách hàng trên web: dùng chung tài khoản, số dư và đơn hàng với bot gốc.
import { esc, HttpError, json, now, randomToken, toInt } from './util.js';
import { isPackage, placeOrder, syncOrder } from './orders.js';
import { buyAccount } from './accounts.js';
import { redeemGift } from './gift.js';
import { servicePricing, resellerPrice, notifyUser } from './shop.js';
import { openSecret } from './crypto.js';
import { sessionUserId, userCookie, userLogoutCookie } from './auth.js';
import { qrUrl, topupCode } from './sepay.js';

const PAGE = 20;

async function body(request) {
  try {
    return (await request.json()) || {};
  } catch {
    throw new HttpError(400, 'Dữ liệu gửi lên không hợp lệ');
  }
}

const browserId = (request) => (request.headers.get('cookie') || '').match(/(?:^|;\s*)lb=([a-f0-9]{32})/)?.[1] || null;

export async function handleMe(request, app, parts, url) {
  const { db, env, settings } = app;
  const m = request.method;
  const [res, id, sub] = parts;
  app.channel = 'web';

  // ---------------------------------------------------------- đăng nhập qua bot Telegram
  if (res === 'login' && id === 'start' && m === 'POST') {
    if (!settings.bot_username) throw new HttpError(400, 'Shop chưa kết nối bot Telegram');
    const token = randomToken(20);
    const browser = browserId(request) || randomToken(16);
    await db.prepare('INSERT INTO login_tokens (token, browser, status, ip, ua, created_at) VALUES (?,?,?,?,?,?)')
      .bind(token, browser, 'pending', request.headers.get('cf-connecting-ip') || 'local', (request.headers.get('user-agent') || '').slice(0, 200), now())
      .run();
    return json({ token, link: `https://t.me/${settings.bot_username}?start=login_${token}` }, 200,
      { 'set-cookie': `lb=${browser}; Path=/api/me; HttpOnly; Secure; SameSite=Strict; Max-Age=900` });
  }
  if (res === 'login' && id === 'poll' && m === 'GET') {
    const token = url.searchParams.get('token') || '';
    const t = await db.prepare('SELECT * FROM login_tokens WHERE token = ?').bind(token).first();
    // Chỉ chính trình duyệt đã bấm đăng nhập mới nhận được phiên
    if (!t || t.browser !== browserId(request) || t.created_at < now() - 300) return json({ status: 'expired' });
    if (t.status !== 'confirmed') return json({ status: t.status });
    const used = await db.prepare(`UPDATE login_tokens SET status = 'used' WHERE token = ? AND status = 'confirmed'`).bind(token).run();
    if (!used.meta.changes) return json({ status: 'expired' });
    return json({ status: 'ok' }, 200, { 'set-cookie': await userCookie(env, t.user_id) });
  }
  if (res === 'logout' && m === 'POST') return json({ ok: true }, 200, { 'set-cookie': userLogoutCookie() });

  const uid = await sessionUserId(request, env);
  const user = uid ? await db.prepare('SELECT * FROM users WHERE id = ? AND bot_id = 0').bind(uid).first() : null;
  if (!user) {
    if (!res && m === 'GET') return json({ authed: false });
    throw new HttpError(401, 'Vui lòng đăng nhập');
  }
  if (user.banned) throw new HttpError(403, 'Tài khoản đã bị khóa');
  if (m !== 'GET') {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) throw new HttpError(403, 'Yêu cầu không hợp lệ');
  }

  // ---------------------------------------------------------- hồ sơ
  if (!res && m === 'GET') {
    const [stats, recent] = await db.batch([
      db.prepare(`SELECT COUNT(*) AS orders, SUM(CASE WHEN status IN ('manual','processing','review') THEN 1 ELSE 0 END) AS running
                  FROM orders WHERE user_id = ? AND status != 'pending_pay'`).bind(user.id),
      db.prepare(`SELECT id, service_name, status, price_total, refunded, created_at FROM orders WHERE user_id = ? AND status != 'pending_pay'
                  ORDER BY id DESC LIMIT 5`).bind(user.id),
    ]);
    return json({
      authed: true,
      user: {
        id: user.id, tg_id: user.tg_id, username: user.username, first_name: user.first_name, balance: user.balance,
        total_topup: user.total_topup, total_spent: user.total_spent, commission_total: user.commission_total, api_key: user.api_key,
      },
      stats: stats.results[0],
      recent: recent.results,
    });
  }

  // ---------------------------------------------------------- đặt dịch vụ
  if (res === 'order' && m === 'POST') {
    const b = await body(request);
    const nonce = String(b.nonce || '');
    if (!/^[a-z0-9-]{16,64}$/i.test(nonce)) throw new HttpError(400, 'Thiếu mã chống trùng');
    const n = await db.prepare('INSERT OR IGNORE INTO request_nonces (nonce, user_id, created_at) VALUES (?,?,?)').bind(nonce, user.id, now()).run();
    if (!n.meta.changes) throw new HttpError(409, 'Đơn này đã được gửi');
    const s = await db.prepare(`SELECT s.* FROM services s LEFT JOIN categories c ON c.id = s.category_id
                                WHERE s.id = ? AND s.active = 1 AND (c.active = 1 OR c.id IS NULL)`).bind(toInt(b.service_id)).first();
    if (!s) throw new HttpError(400, 'Dịch vụ không còn hoạt động');
    const comments = s.input_type === 'comment' ? String(b.comments || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean) : [];
    const reactions = String(s.reactions || '').split(',').filter(Boolean);
    const draft = {
      link: String(b.link || '').trim(),
      qty: s.input_type === 'comment' ? comments.length : toInt(b.qty),
      extra: ['days', 'minutes'].includes(s.input_type) ? toInt(b.extra) : undefined,
      comments: comments.join('\n') || undefined,
      reaction: reactions.length ? (reactions.includes(b.reaction) ? b.reaction : reactions[0]) : undefined,
      contact: s.input_type === 'verify' ? String(b.contact || '').trim().slice(0, 20) : undefined,
      note: b.note ? String(b.note).trim().slice(0, 300) : undefined,
    };
    if (draft.link.length < 3) throw new HttpError(400, 'Nhập link hoặc ID');
    const r = await placeOrder(app, user.id, s, draft, servicePricing(app, s), 'web');
    if (!r.ok) throw new HttpError(400, r.msg);
    return json({ ok: true, order: { id: r.order.id, status: r.order.status, price_total: r.order.price_total }, balance: r.balance });
  }

  if (res === 'orders' && m === 'GET' && !id) {
    const page = Math.max(0, toInt(url.searchParams.get('page')));
    const { results } = await db.prepare(`SELECT id, service_name, category_name, link, quantity, extra, price_total, refunded, status,
        start_count, delivered, admin_note, mode, created_at, updated_at FROM orders WHERE user_id = ? AND status != 'pending_pay'
        ORDER BY id DESC LIMIT ? OFFSET ?`).bind(user.id, PAGE + 1, page * PAGE).all();
    return json({ items: results.slice(0, PAGE), more: results.length > PAGE, page });
  }
  if (res === 'orders' && id && sub === 'refresh' && m === 'POST') {
    const o = await db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').bind(toInt(id), user.id).first();
    if (!o) throw new HttpError(404, 'Không tìm thấy đơn');
    if (o.status === 'processing' && o.mode === 'api' && now() - (o.updated_at || 0) >= 30) await syncOrder(app, o);
    const fresh = await db.prepare('SELECT id, status, start_count, delivered, refunded FROM orders WHERE id = ?').bind(o.id).first();
    return json(fresh);
  }

  // ---------------------------------------------------------- acc game
  if (res === 'buy-acc' && m === 'POST') {
    const b = await body(request);
    const r = await buyAccount(app, user, toInt(b.id));
    if (!r.ok) throw new HttpError(400, r.msg);
    // Gửi kèm qua Telegram để khách luôn có bản lưu
    if (!r.pending) {
      notifyUser(app, user.id, `<b>Mua thành công acc #${r.acc.id}</b> (trên web)\n──────────────\n${esc(r.secret || '')}`).catch(() => {});
    }
    return json({ ok: true, id: r.acc.id, price: r.price, balance: r.balance, pending: r.pending, secret: r.secret || null });
  }
  if (res === 'accs' && m === 'GET') {
    const { results } = await db.prepare(`SELECT a.id, a.title, a.sold_price, a.sold_at, a.delivered_at, a.secret, g.name AS game
        FROM accounts a LEFT JOIN games g ON g.id = a.game_id WHERE a.buyer_id = ? AND a.status = 'sold' ORDER BY a.sold_at DESC LIMIT 50`)
      .bind(user.id).all();
    for (const a of results) a.secret = a.delivered_at ? await openSecret(env, a.secret) : null;
    return json(results);
  }

  // ---------------------------------------------------------- số dư, nạp tiền, quà
  if (res === 'logs' && m === 'GET') {
    const { results } = await db.prepare('SELECT amount, balance_after, type, ref, note, created_at FROM balance_logs WHERE user_id = ? ORDER BY id DESC LIMIT 50')
      .bind(user.id).all();
    return json(results);
  }
  if (res === 'topup' && m === 'GET') {
    const ready = !!(settings.bank_account && settings.bank_code);
    return json({
      ready,
      bank: settings.bank_code, account: settings.bank_account, owner: settings.bank_owner,
      code: topupCode(settings, user.id), min: toInt(settings.topup_min, 10000), bonus: Number(settings.topup_bonus_percent) || 0,
      amounts: String(settings.topup_amounts).split(',').map((x) => toInt(x)).filter((x) => x > 0),
      qr: ready ? qrUrl(settings, 0, user.id) : null,
    });
  }
  if (res === 'gift' && m === 'POST') {
    const b = await body(request);
    const r = await redeemGift(db, user, b.code);
    if (!r.ok) throw new HttpError(400, r.msg);
    return json(r);
  }

  // ---------------------------------------------------------- API key
  if (res === 'api-key' && m === 'POST') {
    if (settings.api_enabled !== '1') throw new HttpError(400, 'API đang tạm tắt');
    const key = `sk_${randomToken(20)}`;
    await db.prepare('UPDATE users SET api_key = ? WHERE id = ?').bind(key, user.id).run();
    notifyUser(app, user.id, 'API key của bạn vừa được tạo mới trên web. Key cũ (nếu có) đã ngừng hoạt động.').catch(() => {});
    return json({ api_key: key });
  }
  if (res === 'api-prices' && m === 'GET') {
    const { results } = await db.prepare(`SELECT s.id, s.name, s.input_type, s.min_qty, s.max_qty, s.price, s.api_price, c.name AS category
        FROM services s LEFT JOIN categories c ON c.id = s.category_id WHERE s.active = 1 ORDER BY c.sort, s.sort, s.id`).all();
    return json(results.map((s) => ({
      id: s.id, name: s.name, category: s.category, type: s.input_type, min: s.min_qty, max: s.max_qty,
      rate: Math.round(resellerPrice(settings, s) * (isPackage(s) ? 1 : 1000) * 100) / 100,
    })));
  }

  throw new HttpError(404, 'Không tìm thấy');
}

