// Mua acc: dùng chung cho bot và cổng khách hàng trên web.
import { changeBalance, esc, money, now } from './util.js';
import { payAccCommission } from './orders.js';
import { accPrice, accResellerPrice, notifyAdmins } from './shop.js';
import { openSecret } from './crypto.js';

/**
 * Giữ acc trước (chỉ một người giữ được, và chỉ khi giá chưa đổi), rồi mới trừ tiền.
 * Trả về { ok, acc, price, balance, pending, secret } hoặc { ok: false, msg }.
 */
export async function buyAccount(app, user, id, { api = false } = {}) {
  const { db } = app;
  const cur = await db.prepare(`SELECT price, delivery, status FROM accounts WHERE id = ?`).bind(id).first();
  if (!cur || cur.status === 'hidden') return { ok: false, msg: 'Acc không tồn tại hoặc đã ngừng bán.' };
  const p = api ? accResellerPrice(app.settings, cur) : accPrice(app, cur);
  // Hoa hồng chỉ có khi bán qua bot con (giá bot con cao hơn giá gốc)
  const commission = app.shop.id ? Math.max(0, p - cur.price) : 0;
  const auto = cur.delivery !== 'manual';
  const a = await db
    .prepare(`UPDATE accounts SET status = 'sold', buyer_id = ?1, sold_price = ?2, sold_at = ?3, bot_id = ?4, commission = ?5,
                commission_paid = 0, delivered_at = ?8
              WHERE id = ?6 AND status = 'available' AND price = ?7 RETURNING *`)
    .bind(user.id, p, now(), app.shop.id, commission, id, cur.price, auto ? now() : null)
    .first();
  if (!a) return { ok: false, msg: 'Acc này vừa được người khác mua hoặc vừa đổi giá.' };

  const bal = await changeBalance(db, user.id, -p, { type: 'buy_acc', ref: `acc:${a.id}`, note: a.title || '' });
  if (bal === null) {
    await db.prepare(`UPDATE accounts SET status = 'available', buyer_id = NULL, sold_price = NULL, sold_at = NULL, bot_id = 0,
                      commission = 0, delivered_at = NULL WHERE id = ? AND buyer_id = ?`).bind(a.id, user.id).run();
    return { ok: false, msg: 'Số dư không đủ.' };
  }

  const via = app.shop.id ? ` qua @${esc(app.shop.username)}` : api ? ' qua API' : app.channel === 'web' ? ' trên web' : '';
  const buyer = `${esc(user.first_name || '')}${user.username ? ` @${esc(user.username)}` : ''} · mã khách <code>${user.id}</code>`;
  if (!auto) {
    notifyAdmins(app, `<b>CẦN GIAO ACC #${a.id}</b> ${money(p)}${via}\nKhách: ${buyer}\nVào web admin > Acc game để giao.`).catch(() => {});
    return { ok: true, acc: a, price: p, balance: bal, pending: true };
  }
  await payAccCommission(app, a.id);
  notifyAdmins(app, `<b>Bán acc #${a.id}</b> ${money(p)}${via}\nKhách: ${buyer}`).catch(() => {});
  return { ok: true, acc: a, price: p, balance: bal, pending: false, secret: await openSecret(app.env, a.secret) };
}
