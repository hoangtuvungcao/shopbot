// Định giá nhiều tầng và gửi tin qua đúng bot của từng khách.
//
//   giá bot gốc   = service.price
//   giá đại lý    = service.api_price, hoặc service.price × reseller_rate%   (dùng cho API và làm giá nền bot con)
//   giá bot con   = giá đại lý × (1 + markup% của chủ bot con)
//   hoa hồng      = giá bot con − giá đại lý, cộng cho chủ bot con khi đơn kết thúc
import { createTg } from './telegram.js';

export const ROOT = { id: 0, markup: 0 };

const round2 = (n) => Math.ceil(n * 100) / 100;

export function resellerPrice(settings, s) {
  if (s.api_price > 0) return s.api_price;
  const rate = Number(settings.reseller_rate) || 100;
  return round2((s.price * rate) / 100);
}

/** Đơn giá khách trả và đơn giá nền (phần hệ thống thu) theo shop đang phục vụ. */
export function servicePricing(app, s, { api = false } = {}) {
  if (api) {
    const p = resellerPrice(app.settings, s);
    return { unit: p, base: p };
  }
  if (!app.shop.id) return { unit: s.price, base: s.price };
  const base = resellerPrice(app.settings, s);
  return { unit: round2(base * (1 + app.shop.markup / 100)), base };
}

/** Giá acc cho đại lý qua API: giá niêm yết × tỷ lệ đại lý, làm tròn lên hàng nghìn. */
export function accResellerPrice(settings, a) {
  const rate = Number(settings.reseller_rate) || 100;
  return Math.ceil((a.price * rate) / 100 / 1000) * 1000;
}

/** Giá acc trên bot con, làm tròn lên hàng nghìn cho đẹp. */
export function accPrice(app, a) {
  if (!app.shop.id) return a.price;
  return Math.ceil((a.price * (1 + app.shop.markup / 100)) / 1000) * 1000;
}

export async function tgFor(app, botId) {
  if (!botId) return app.rootTg;
  app.tgCache ??= {};
  if (!app.tgCache[botId]) {
    const b = await app.db.prepare('SELECT token FROM bots WHERE id = ?').bind(botId).first();
    app.tgCache[botId] = createTg(b?.token);
  }
  return app.tgCache[botId];
}

/** Gửi tin cho khách theo id nội bộ, qua bot mà khách đang dùng. */
export async function notifyUser(app, userId, text, extra) {
  const u = await app.db.prepare('SELECT tg_id, bot_id FROM users WHERE id = ?').bind(userId).first();
  if (!u) return { ok: false, description: 'user not found' };
  return (await tgFor(app, u.bot_id)).send(u.tg_id, text, extra);
}

export function notifyAdmins(app, text) {
  const ids = String(app.settings.admin_chat_ids || '').split(/[,\s]+/).filter(Boolean);
  return Promise.all(ids.map((id) => app.rootTg.send(id, text)));
}
