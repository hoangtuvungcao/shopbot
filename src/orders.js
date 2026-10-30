import { changeBalance, esc, money, now, num, safeJson } from './util.js';
import { mapUpstreamStatus } from './upstream.js';
import { notifyAdmins, notifyUser } from './shop.js';

export { notifyAdmins };

export const ORDER_STATUS = {
  processing: 'Đang chạy',
  manual: 'Chờ xử lý',
  review: 'Cần kiểm tra',
  done: 'Hoàn thành',
  refunded: 'Đã hoàn tiền',
  canceled: 'Đã hủy',
  failed: 'Lỗi - đã hoàn tiền',
};

export const REACTION_LABEL = {
  like: 'Like', love: 'Love', care: 'Thương thương', haha: 'Haha', wow: 'Wow', sad: 'Buồn', angry: 'Phẫn nộ',
};

/** Gói trọn gói (giá cố định, tích xanh): luôn số lượng 1. */
export const isPackage = (s) => s.input_type === 'fixed' || s.input_type === 'verify';

/** Tính tiền từ đơn giá đã định (không tin giá lưu trong state của khách). */
export function quote(service, draft, unit, base = unit) {
  const qty = isPackage(service) ? 1 : Number(draft.qty) || 0;
  const mult = service.input_type === 'days' || service.input_type === 'minutes' ? Number(draft.extra) || 0 : 1;
  const total = Math.ceil(unit * qty * mult);
  const baseTotal = Math.min(total, Math.ceil(base * qty * mult));
  const cost = Math.ceil(service.cost * qty * mult);
  return { qty, mult, total, baseTotal, cost };
}

/** Kiểm tra dữ liệu đơn; trả về chuỗi lỗi hoặc null. */
export function validateDraft(service, draft) {
  if (!draft.link || String(draft.link).length > 500) return 'Link/ID không hợp lệ.';
  if (service.input_type === 'verify' && String(draft.contact || '').trim().length < 6) return 'Thiếu số điện thoại/Zalo liên hệ.';
  if (!isPackage(service)) {
    const q = Number(draft.qty);
    if (!Number.isInteger(q) || q < service.min_qty || q > service.max_qty)
      return `Số lượng phải từ ${num(service.min_qty)} đến ${num(service.max_qty)}.`;
  }
  if (service.input_type === 'days' || service.input_type === 'minutes') {
    const x = Number(draft.extra);
    if (!Number.isInteger(x) || x < service.extra_min || x > service.extra_max)
      return `Giá trị phải từ ${service.extra_min} đến ${service.extra_max}.`;
  }
  return null;
}

/**
 * Tạo đơn: trừ tiền trước, rồi gửi API (hoặc đưa vào hàng chờ admin nếu là dịch vụ thủ công).
 * API báo lỗi rõ ràng -> hoàn tiền ngay. Mất kết nối -> giữ tiền, đánh dấu "Cần kiểm tra".
 * pricing = { unit, base } lấy từ servicePricing(); source = 'bot' | 'api'.
 */
export async function placeOrder(app, userId, service, draft, pricing, source = 'bot') {
  const { db } = app;
  const err = validateDraft(service, draft);
  if (err) return { ok: false, msg: err };
  const { qty, total, baseTotal, cost } = quote(service, draft, pricing.unit, pricing.base);
  if (total <= 0) return { ok: false, msg: 'Dịch vụ chưa được cấu hình giá.' };

  const t = now();
  const botId = source === 'api' ? 0 : app.shop.id;
  const cat = await db.prepare('SELECT name FROM categories WHERE id = ?').bind(service.category_id).first();
  const extra = {
    reaction: draft.reaction || undefined,
    extra: draft.extra || undefined,
    comments: draft.comments || undefined,
    contact: draft.contact || undefined,
    note: draft.note || undefined,
  };
  const order = await db
    .prepare(
      `INSERT INTO orders (user_id, bot_id, source, service_id, service_name, category_name, mode, link, quantity, extra,
        price_total, base_total, cost_total, commission, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`
    )
    .bind(userId, botId, source, service.id, service.name, cat?.name || '', service.mode, String(draft.link), qty,
      JSON.stringify(extra), total, baseTotal, cost, total - baseTotal, 'pending_pay', t, t)
    .first();

  const bal = await changeBalance(db, userId, -total, { type: 'order', ref: order.id, note: service.name });
  if (bal === null) {
    await db.prepare('DELETE FROM orders WHERE id = ?').bind(order.id).run();
    return { ok: false, msg: 'Số dư không đủ. Vui lòng nạp thêm tiền.' };
  }

  if (service.mode === 'manual') {
    await setStatus(db, order.id, 'manual');
    notifyAdmins(app,
      `<b>${service.input_type === 'verify' ? 'Đơn TÍCH XANH' : 'Đơn thủ công'} mới #${order.id}</b>\n${esc(service.name)}\nLink: ${esc(draft.link)}\n` +
      (draft.contact ? `Liên hệ: <code>${esc(draft.contact)}</code>\n` : '') +
      (draft.note ? `Ghi chú: ${esc(draft.note)}\n` : '') +
      `Khách: <code>${userId}</code> · ${money(total)}`).catch(() => {});
    return { ok: true, order: { ...order, status: 'manual' }, balance: bal };
  }

  const fields = { server_order: service.server_order, account: draft.link, amount: qty, note: `#${order.id}` };
  if (draft.reaction) fields.reaction = draft.reaction;
  if (service.input_type === 'days') fields.days = draft.extra;
  if (service.input_type === 'minutes') fields.minutes = draft.extra;
  if (service.input_type === 'comment') fields.comment = draft.comments;

  const r = await app.up.create(fields);
  if (r.ok) {
    await db
      .prepare('UPDATE orders SET status = ?, upstream_code = ?, upstream_status = ?, updated_at = ? WHERE id = ?')
      .bind('processing', String(r.data?.code_order || ''), 'pending', now(), order.id)
      .run();
    return { ok: true, order: { ...order, status: 'processing' }, balance: bal };
  }

  if (r.network) {
    await db
      .prepare('UPDATE orders SET status = ?, admin_note = ?, updated_at = ? WHERE id = ?')
      .bind('review', r.msg, now(), order.id)
      .run();
    notifyAdmins(app, `<b>Đơn #${order.id} cần kiểm tra</b>\n${esc(r.msg)}`).catch(() => {});
    return { ok: true, order: { ...order, status: 'review' }, balance: bal };
  }

  await refundOrder(app, order.id, total, `API từ chối: ${r.msg}`, 'failed', false);
  return { ok: false, msg: `Không tạo được đơn: ${r.msg}. Tiền đã được hoàn lại.` };
}

function setStatus(db, id, status) {
  return db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').bind(status, now(), id).run();
}

const quiet = (o) => o.source === 'api'; // khách dùng API tự kiểm tra trạng thái, không nhắn tin

/**
 * Trả hoa hồng cho chủ bot con khi đơn kết thúc, theo phần khách thực trả (trừ phần hoàn).
 * commission_paid đảm bảo chỉ trả một lần.
 */
async function payCommission(app, orderId) {
  const o = await app.db
    .prepare(`UPDATE orders SET commission_paid = 1 WHERE id = ? AND commission_paid = 0 AND commission > 0 AND bot_id > 0 RETURNING *`)
    .bind(orderId)
    .first();
  if (!o) return;
  const amount = Math.floor((o.commission * (o.price_total - o.refunded)) / Math.max(1, o.price_total));
  if (amount <= 0) return;
  const bot = await app.db.prepare('SELECT owner_id, username FROM bots WHERE id = ?').bind(o.bot_id).first();
  if (!bot) return;
  const bal = await changeBalance(app.db, bot.owner_id, amount, { type: 'commission', ref: o.id, note: `@${bot.username || ''}` });
  if (bal !== null) {
    notifyUser(app, bot.owner_id, `Hoa hồng từ bot @${esc(bot.username)}: <b>+${money(amount)}</b> (đơn #${o.id})`).catch(() => {});
  }
}

/** Hoa hồng bán acc qua bot con: trả khi acc đã giao xong, chỉ một lần. */
export async function payAccCommission(app, accId) {
  const a = await app.db
    .prepare(`UPDATE accounts SET commission_paid = 1 WHERE id = ? AND commission_paid = 0 AND commission > 0 AND bot_id > 0
              AND status = 'sold' AND delivered_at IS NOT NULL RETURNING *`)
    .bind(accId)
    .first();
  if (!a) return;
  const bot = await app.db.prepare('SELECT owner_id, username FROM bots WHERE id = ?').bind(a.bot_id).first();
  if (!bot) return;
  const bal = await changeBalance(app.db, bot.owner_id, a.commission, { type: 'commission', ref: `acc:${a.id}`, note: `@${bot.username || ''}` });
  if (bal !== null) {
    notifyUser(app, bot.owner_id, `Hoa hồng bán acc #${a.id} qua @${esc(bot.username)}: <b>+${money(a.commission)}</b>`).catch(() => {});
  }
}

/**
 * Hoàn tiền cho đơn. Chỉ chạy được một lần mỗi đơn (điều kiện trên status),
 * nên bấm trùng hay đồng bộ lặp cũng không hoàn hai lần.
 */
export async function refundOrder(app, orderId, amount, note, finalStatus = 'refunded', notify = true) {
  const { db } = app;
  const o = await db
    .prepare(
      `UPDATE orders SET status = ?1, refunded = ?2, admin_note = ?3, updated_at = ?4
       WHERE id = ?5 AND status NOT IN ('refunded','failed','canceled') AND ?2 <= price_total RETURNING *`
    )
    .bind(finalStatus, Math.max(0, Math.round(amount)), note || '', now(), orderId)
    .first();
  if (!o) return { ok: false, msg: 'Đơn đã được hoàn/hủy trước đó hoặc số tiền không hợp lệ.' };
  if (o.refunded > 0) await changeBalance(db, o.user_id, o.refunded, { type: 'refund', ref: o.id, note: note || '' });
  await payCommission(app, o.id);
  if (notify && !quiet(o)) {
    notifyUser(app, o.user_id,
      `Đơn <b>#${o.id}</b> (${esc(o.service_name)}) đã được hoàn <b>${money(o.refunded)}</b> vào số dư.` +
      (note ? `\nLý do: ${esc(note)}` : '')).catch(() => {});
  }
  return { ok: true, order: o };
}

/** Admin nhận xử lý đơn thủ công (vd tích xanh): báo khách là đơn đang được làm. */
export async function acceptOrder(app, orderId, note = '') {
  const o = await app.db
    .prepare(`UPDATE orders SET status = 'processing', admin_note = COALESCE(NULLIF(?1,''), admin_note), updated_at = ?2
              WHERE id = ?3 AND status = 'manual' AND mode = 'manual' RETURNING *`)
    .bind(note, now(), orderId)
    .first();
  if (!o) return { ok: false, msg: 'Chỉ nhận được đơn thủ công đang chờ xử lý.' };
  if (!quiet(o)) {
    notifyUser(app, o.user_id, `Đơn <b>#${o.id}</b> (${esc(o.service_name)}) đã được tiếp nhận và đang xử lý.` +
      (note ? `\nGhi chú: ${esc(note)}` : '')).catch(() => {});
  }
  return { ok: true, order: o };
}

export async function completeOrder(app, orderId, note = '') {
  const o = await app.db
    .prepare(
      `UPDATE orders SET status = 'done', admin_note = COALESCE(NULLIF(?1,''), admin_note), updated_at = ?2
       WHERE id = ?3 AND status IN ('manual','processing','review') RETURNING *`
    )
    .bind(note, now(), orderId)
    .first();
  if (!o) return { ok: false, msg: 'Đơn không ở trạng thái có thể hoàn thành.' };
  await payCommission(app, o.id);
  if (!quiet(o)) {
    notifyUser(app, o.user_id,
      `Đơn <b>#${o.id}</b> (${esc(o.service_name)}) đã hoàn thành.` + (note ? `\nGhi chú: ${esc(note)}` : '')).catch(() => {});
  }
  return { ok: true, order: o };
}

export async function cancelOrderNoRefund(app, orderId, note = '') {
  const o = await app.db
    .prepare(
      `UPDATE orders SET status = 'canceled', admin_note = ?1, updated_at = ?2
       WHERE id = ?3 AND status IN ('manual','processing','review') RETURNING *`
    )
    .bind(note, now(), orderId)
    .first();
  if (!o) return { ok: false, msg: 'Không thể hủy đơn này.' };
  await payCommission(app, o.id);
  if (!quiet(o)) {
    notifyUser(app, o.user_id, `Đơn <b>#${o.id}</b> đã bị hủy.` + (note ? `\nLý do: ${esc(note)}` : '')).catch(() => {});
  }
  return { ok: true, order: o };
}

/** Lấy trạng thái mới nhất từ API cho một đơn và xử lý hoàn tiền nếu cần. */
export async function syncOrder(app, order) {
  if (order.mode !== 'api' || !order.upstream_code || order.status !== 'processing') return { ok: false };
  const r = await app.up.view(order.upstream_code);
  if (!r.ok) return { ok: false, msg: r.msg };
  const row = Array.isArray(r.data) ? r.data[0] : r.data;
  if (!row) return { ok: false, msg: 'Không thấy đơn trên API' };

  const st = mapUpstreamStatus(row.status);
  const delivered = parseInt(row.buff, 10) || 0;
  const start = parseInt(row.start, 10) || 0;
  await app.db
    .prepare('UPDATE orders SET upstream_status = ?, delivered = ?, start_count = ?, updated_at = ? WHERE id = ?')
    .bind(String(row.status || ''), delivered, start, now(), order.id)
    .run();

  if (st === 'done') return completeOrder(app, order.id);
  if (st === 'canceled') return cancelOrderNoRefund(app, order.id, 'Đơn bị hủy từ hệ thống (link sai hoặc không hợp lệ).');
  if (st === 'refund') {
    const qty = order.quantity || 1;
    const remain = Math.max(0, qty - delivered);
    const amount = Math.floor((order.price_total * remain) / qty);
    return refundOrder(app, order.id, amount, `Hoàn phần chưa chạy (${num(remain)}/${num(qty)})`);
  }
  return { ok: true, status: st };
}

/** Đồng bộ hàng loạt các đơn đang chạy (giới hạn để không vượt quota subrequest). */
export async function syncPending(app, limit = 15) {
  const { results } = await app.db
    .prepare(`SELECT * FROM orders WHERE status = 'processing' AND mode = 'api' ORDER BY updated_at ASC LIMIT ?`)
    .bind(limit)
    .all();
  let changed = 0;
  for (const o of results) {
    const r = await syncOrder(app, o);
    if (r.ok && r.order) changed++;
  }
  return { checked: results.length, changed };
}

export function orderExtraText(o) {
  const x = safeJson(o.extra, {});
  const parts = [];
  if (x.reaction) parts.push(`Cảm xúc: ${REACTION_LABEL[x.reaction] || x.reaction}`);
  if (x.extra) parts.push(`Thời gian: ${x.extra}`);
  if (x.contact) parts.push(`Liên hệ: ${x.contact}`);
  if (x.note) parts.push(`Ghi chú: ${x.note}`);
  return parts.join('\n');
}
