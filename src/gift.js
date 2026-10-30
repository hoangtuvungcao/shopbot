// Nhập mã quà tặng: dùng chung cho bot và web.
import { changeBalance, now } from './util.js';

/** Trả về { ok, amount, balance } hoặc { ok: false, msg }. Mỗi tài khoản Telegram dùng một mã một lần. */
export async function redeemGift(db, user, rawCode) {
  const code = String(rawCode || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (!code) return { ok: false, msg: 'Nhập mã quà tặng.' };
  const g = await db.prepare('SELECT * FROM giftcodes WHERE code = ?').bind(code).first();
  if (!g || !g.active || (g.expires_at && g.expires_at < now())) return { ok: false, msg: 'Mã không tồn tại hoặc đã hết hạn.' };
  // Ghi lượt dùng trước (khóa chính code + tg_id), rồi mới tăng bộ đếm có điều kiện còn lượt
  const use = await db.prepare('INSERT OR IGNORE INTO giftcode_uses (code_id, tg_id, user_id, created_at) VALUES (?,?,?,?)')
    .bind(g.id, user.tg_id, user.id, now()).run();
  if (!use.meta.changes) return { ok: false, msg: 'Bạn đã sử dụng mã này rồi.' };
  const inc = await db.prepare('UPDATE giftcodes SET used = used + 1 WHERE id = ? AND used < max_uses AND active = 1').bind(g.id).run();
  if (!inc.meta.changes) {
    await db.prepare('DELETE FROM giftcode_uses WHERE code_id = ? AND tg_id = ?').bind(g.id, user.tg_id).run();
    return { ok: false, msg: 'Mã đã hết lượt sử dụng.' };
  }
  const balance = await changeBalance(db, user.id, g.amount, { type: 'gift', ref: g.code, note: g.note || '' });
  return { ok: true, amount: g.amount, balance };
}
