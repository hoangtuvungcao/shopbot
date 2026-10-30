// Đồng bộ toàn bộ dịch vụ từ nhà cung cấp lên web/bot và tự tính giá bán theo quy tắc chênh lệch.
//   markup_type = 'per1k'   : giá bán = giá vốn + markup_value / 1000   (cộng X đ cho mỗi 1.000 lượt)
//   markup_type = 'percent' : giá bán = giá vốn × (1 + markup_value%)
// Dịch vụ có auto_price = 1 luôn đi theo quy tắc; admin tự đặt giá thì auto_price = 0 và không bị ghi đè.
import { now } from './util.js';

const round2 = (n) => Math.ceil(n * 100 - 1e-6) / 100;

export function ruledPrice(settings, cost) {
  const c = Number(cost) || 0;
  const v = Math.max(0, Number(settings.markup_value) || 0);
  return settings.markup_type === 'percent' ? round2(c * (1 + v / 100)) : round2(c + v / 1000);
}

const SOCIAL = {
  facebook: 'Facebook', tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube', shopee: 'Shopee',
  telegram: 'Telegram', twitter: 'Twitter', threads: 'Threads', google: 'Google', zalo: 'Zalo',
};

// Đổi slug của nhà cung cấp thành tên tiếng Việt dễ đọc; slug lạ thì viết hoa chữ đầu
const SERVICE_WORDS = [
  [/theo-doi|follow|sub/, 'Theo dõi'], [/like-page|like-fanpage|page-like/, 'Like fanpage'], [/cam-xuc|reaction/, 'Cảm xúc'],
  [/like|tim|heart/, 'Like / tim'], [/binh-luan|comment|cmt/, 'Bình luận'], [/chia-se|share/, 'Chia sẻ'],
  [/mat-?live|livestream|mat/, 'Mắt livestream'], [/view|luot-xem|xem/, 'Lượt xem'], [/vip/, 'VIP theo ngày'],
  [/thanh-vien|member|nhom|group/, 'Thành viên nhóm'], [/danh-gia|review|rate/, 'Đánh giá'], [/save|luu/, 'Lượt lưu'],
];

function serviceLabel(slug) {
  const s = String(slug || '').toLowerCase();
  for (const [re, label] of SERVICE_WORDS) if (re.test(s)) return label;
  const t = s.replace(/^tang-/, '').replace(/[-_]+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : 'Khác';
}

function categoryOf(x) {
  const social = SOCIAL[String(x.social || '').toLowerCase()] || (x.social ? String(x.social)[0].toUpperCase() + String(x.social).slice(1) : 'Khác');
  return { key: `${x.social || ''}|${x.service || ''}`, name: `${social} · ${serviceLabel(x.service)}` };
}

function inputTypeOf(x) {
  const s = `${x.service || ''} ${x.name || ''}`.toLowerCase();
  if (/binh-luan|comment|bình luận/.test(s)) return 'comment';
  if (/mat-?live|livestream|mắt/.test(s)) return 'minutes';
  if (/vip/.test(s)) return 'days';
  return 'quantity';
}

export const cleanDetail = (d) =>
  String(d || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1500);

async function batchRun(db, stmts) {
  for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
}

/**
 * Lấy danh sách gói từ nhà cung cấp, thêm gói mới (nếu bật), cập nhật giá vốn/min/max,
 * tính lại giá cho gói "giá tự động", tắt gói nhà cung cấp đã ngừng.
 */
export async function syncCatalog(app, { addNew = app.settings.auto_add_services === '1' } = {}) {
  const { db, settings } = app;
  const r = await app.up.services();
  if (!r.ok) return { ok: false, msg: r.msg };
  const list = (Array.isArray(r.data) ? r.data : []).filter((x) => x && x.server_order);

  const [svcRows, catRows] = await db.batch([
    db.prepare(`SELECT id, server_order, auto_price FROM services WHERE mode = 'api'`),
    db.prepare('SELECT id, source_key, sort FROM categories'),
  ]);
  const existing = new Map(svcRows.results.map((s) => [s.server_order, s]));
  const cats = new Map(catRows.results.filter((c) => c.source_key).map((c) => [c.source_key, c.id]));
  let sort = catRows.results.reduce((m, c) => Math.max(m, c.sort || 0), 0);

  const stmts = [];
  let added = 0;
  let updated = 0;
  const seen = new Set();
  for (const x of list) {
    seen.add(x.server_order);
    const cost = Number(x.prices) || 0;
    const min = Math.max(1, parseInt(x.min_order, 10) || 1);
    const max = Math.max(min, parseInt(x.max_order, 10) || min);
    const on = String(x.status || 'on') === 'on';
    const old = existing.get(x.server_order);
    if (old) {
      updated++;
      stmts.push(old.auto_price
        ? db.prepare(`UPDATE services SET cost = ?, price = ?, min_qty = ?, max_qty = ?, active = CASE WHEN ? THEN active ELSE 0 END WHERE id = ?`)
          .bind(cost, ruledPrice(settings, cost), min, max, on ? 1 : 0, old.id)
        : db.prepare(`UPDATE services SET cost = ?, min_qty = ?, max_qty = ?, active = CASE WHEN ? THEN active ELSE 0 END WHERE id = ?`)
          .bind(cost, min, max, on ? 1 : 0, old.id));
      continue;
    }
    if (!addNew || !on || cost <= 0) continue;
    const c = categoryOf(x);
    let catId = cats.get(c.key);
    if (!catId) {
      const row = await db.prepare('INSERT INTO categories (name, sort, active, source_key) VALUES (?,?,1,?) RETURNING id')
        .bind(c.name, ++sort, c.key).first();
      catId = row.id;
      cats.set(c.key, catId);
    }
    const reactions = x.reaction && x.reaction !== 'no' ? 'like,love,care,haha,wow,sad,angry' : '';
    const type = inputTypeOf(x);
    stmts.push(db.prepare(`INSERT INTO services (category_id, name, description, mode, input_type, server_order, price, cost,
        min_qty, max_qty, extra_min, extra_max, reactions, auto_price, active, sort, created_at)
        VALUES (?,?,?,'api',?,?,?,?,?,?,?,?,?,1,1,0,?)`)
      .bind(catId, String(x.name || x.server_order).slice(0, 150), cleanDetail(x.detail), type, x.server_order,
        ruledPrice(settings, cost), cost, min, max, type === 'minutes' ? 30 : 1, type === 'minutes' ? 240 : 30, reactions, now()));
    added++;
  }
  // Gói nhà cung cấp đã gỡ khỏi danh sách: tạm ẩn để khách không đặt được
  let disabled = 0;
  for (const [so, s] of existing) {
    if (!seen.has(so)) {
      disabled++;
      stmts.push(db.prepare('UPDATE services SET active = 0 WHERE id = ?').bind(s.id));
    }
  }
  await batchRun(db, stmts);
  await db.prepare(`INSERT INTO settings (key, value) VALUES ('catalog_sync_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .bind(String(now())).run();
  return { ok: true, total: list.length, added, updated, disabled };
}
