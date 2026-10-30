import { btn, createTg, kb, urlBtn } from './telegram.js';
import { changeBalance, esc, money, now, num, randomToken, safeJson, toInt } from './util.js';
import { isPackage, ORDER_STATUS, orderExtraText, placeOrder, quote, REACTION_LABEL, syncOrder, validateDraft } from './orders.js';
import { openSecret } from './crypto.js';
import { buyAccount } from './accounts.js';
import { redeemGift } from './gift.js';
import { accPrice, notifyAdmins, servicePricing } from './shop.js';
import { qrUrl, topupCode } from './sepay.js';

const M = {
  services: 'Dịch vụ',
  accs: 'Mua acc game',
  topup: 'Nạp tiền',
  me: 'Tài khoản',
  orders: 'Đơn hàng',
  support: 'Hỗ trợ',
  reseller: 'Đại lý & API',
};

function menu(app) {
  const rows = [
    [{ text: M.services }, { text: M.accs }],
    [{ text: M.topup }, { text: M.me }],
    [{ text: M.orders }, { text: M.support }],
  ];
  if (!app.shop.id && (app.settings.api_enabled === '1' || app.settings.child_enabled === '1')) rows.push([{ text: M.reseller }]);
  return { reply_markup: { keyboard: rows, resize_keyboard: true, is_persistent: true } };
}

const PAGE = 8;
const LINE = '──────────────';

const fmtPrice = (p) => `${Number(p).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}đ`;
const short = (n) => (n >= 1e6 ? `${n / 1e6}M` : n >= 1e3 ? `${n / 1e3}K` : String(n));

// Gói buff hiển thị theo 1.000 lượt cho dễ so sánh; gói trọn gói hiển thị giá cả gói
function priceLabel(s, unit) {
  const k = money(unit * 1000);
  return {
    quantity: `${k} / 1.000`,
    days: `${k} / 1.000 / ngày`,
    minutes: `${k} / 1.000 / phút`,
    comment: `${fmtPrice(unit)} / bình luận`,
    fixed: money(unit),
    verify: `${money(unit)} trọn gói`,
  }[s.input_type] || fmtPrice(unit);
}

export const BOT_COMMANDS = [
  { command: 'start', description: 'Mở menu chính' },
  { command: 'naptien', description: 'Nạp tiền' },
  { command: 'taikhoan', description: 'Thông tin tài khoản' },
  { command: 'huy', description: 'Hủy thao tác đang làm' },
];

// ===================================================================

export async function handleUpdate(update, app) {
  const { db } = app;
  if (update.update_id !== undefined) {
    const r = await db
      .prepare('INSERT OR IGNORE INTO processed_updates (bot_id, update_id, created_at) VALUES (?, ?, ?)')
      .bind(app.shop.id, update.update_id, now())
      .run();
    if (!r.meta.changes) return; // Telegram gửi lại update đã xử lý
  }

  const msg = update.message;
  const cb = update.callback_query;
  const from = msg?.from || cb?.from;
  if (!from || from.is_bot) return;
  const chat = msg?.chat || cb?.message?.chat;
  if (chat && chat.type !== 'private') return;

  const reply = (text) => (cb ? app.tg.answer(cb.id, text, true) : app.tg.send(from.id, text));
  if (app.shop.id && !app.shop.active) return reply('Bot đang tạm dừng hoạt động.');

  const user = await db
    .prepare(
      `INSERT INTO users (tg_id, bot_id, username, first_name, created_at, last_seen) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT(bot_id, tg_id) DO UPDATE SET username = ?3, first_name = ?4, last_seen = ?5 RETURNING *`
    )
    .bind(from.id, app.shop.id, from.username || '', from.first_name || '', now())
    .first();

  const ctx = { app, tg: app.tg, db, user, chatId: from.id, cb, shop: app.shop };

  if (user.banned) return reply('Tài khoản của bạn đã bị khóa. Liên hệ hỗ trợ nếu có nhầm lẫn.');
  if (app.settings.maintenance === '1' && !isAdmin(app, from.id)) return reply('Hệ thống đang bảo trì, vui lòng quay lại sau ít phút.');

  try {
    if (cb) await onCallback(ctx, cb);
    else if (msg?.text) await onText(ctx, msg.text.trim());
    else if (msg) await app.tg.send(ctx.chatId, 'Vui lòng chọn chức năng ở menu bên dưới.', menu(app));
  } catch (e) {
    console.error('[bot]', e.stack || e);
    await reply('Có lỗi xảy ra, vui lòng thử lại.');
  }
}

function isAdmin(app, tgId) {
  return !app.shop.id && String(app.settings.admin_chat_ids || '').split(/[,\s]+/).includes(String(tgId));
}

async function show(ctx, text, rows) {
  const extra = rows ? kb(rows) : {};
  const m = ctx.cb?.message;
  if (m && typeof m.text === 'string') {
    const r = await ctx.tg.edit(ctx.chatId, m.message_id, text, extra);
    if (r.ok || /not modified/.test(r.description || '')) return r;
  }
  return ctx.tg.send(ctx.chatId, text, extra);
}

async function setState(ctx, state, data = null) {
  const sd = data ? JSON.stringify(data) : null;
  await ctx.db.prepare('UPDATE users SET state = ?, state_data = ? WHERE id = ?').bind(state, sd, ctx.user.id).run();
  ctx.user.state = state;
  ctx.user.state_data = sd;
}

const clearState = (ctx) => setState(ctx, null, null);

/**
 * Lấy dữ liệu của state và xóa state trong cùng một bước (compare-and-swap).
 * Hai request song song (bấm "Xác nhận" liên tục) thì chỉ một request nhận được dữ liệu.
 */
async function takeState(ctx, state) {
  const cur = await ctx.db.prepare('SELECT state, state_data FROM users WHERE id = ?').bind(ctx.user.id).first();
  if (!cur || cur.state !== state) return null;
  const r = await ctx.db
    .prepare('UPDATE users SET state = NULL, state_data = NULL WHERE id = ? AND state = ? AND state_data IS ?')
    .bind(ctx.user.id, state, cur.state_data)
    .run();
  if (!r.meta.changes) return null;
  ctx.user.state = null;
  ctx.user.state_data = null;
  return cur.state_data ?? '';
}

const brandUrl = (app, x) => (x.startsWith('http') ? x : x.startsWith('/') ? `${app.baseUrl}${x}` : `${app.baseUrl}/api/img/${x}`);

const shopName = (ctx) => (ctx.shop.id ? ctx.shop.name : ctx.app.settings.shop_name);

// ===================================================================
// Text messages

async function onText(ctx, text) {
  const { app } = ctx;
  if (text.startsWith('/start')) {
    await clearState(ctx);
    await clearAlbum(ctx);
    const welcome = (ctx.shop.id && ctx.shop.welcome_text) || app.settings.welcome_text;
    const hello = `Xin chào <b>${esc(ctx.user.first_name || 'bạn')}</b>, chào mừng đến với <b>${esc(shopName(ctx))}</b>.\n\n${esc(welcome)}\n\n` +
      `Số dư: <b>${money(ctx.user.balance)}</b>`;
    // Bot gốc chào bằng ảnh logo thương hiệu; lỗi tải ảnh thì gửi chữ
    const art = !ctx.shop.id && app.settings.hero_art ? brandUrl(app, app.settings.hero_art) : '';
    const sent = art ? await ctx.tg.photo(ctx.chatId, art, hello, menu(app)) : { ok: false };
    if (!sent.ok) await ctx.tg.send(ctx.chatId, hello, menu(app));
    // Deep link từ trang web: t.me/<bot>?start=acc_12 | svc_3 | nap
    const arg = text.split(/\s+/)[1] || '';
    if (/^acc_\d+$/.test(arg)) await accDetail(ctx, toInt(arg.slice(4)));
    else if (/^svc_\d+$/.test(arg)) await serviceView(ctx, toInt(arg.slice(4)));
    else if (arg === 'nap') await topupHome(ctx);
    else if (/^login_[a-f0-9]{32,64}$/.test(arg) && !ctx.shop.id) await webLoginAsk(ctx, arg.slice(6));
    return;
  }

  const routes = {
    [M.services]: servicesHome,
    [M.accs]: accHome,
    [M.topup]: topupHome,
    [M.me]: meView,
    [M.orders]: (c) => ordersList(c, 0),
    [M.support]: supportView,
    [M.reseller]: resellerHome,
    '/menu': servicesHome,
    '/naptien': topupHome,
    '/taikhoan': meView,
    '/daily': resellerHome,
    '/code': giftAsk,
  };
  if (routes[text]) {
    await clearState(ctx);
    return routes[text](ctx);
  }
  if (text === '/huy' || text === '/cancel') {
    await clearState(ctx);
    return ctx.tg.send(ctx.chatId, 'Đã hủy thao tác.', menu(app));
  }

  const st = ctx.user.state;
  if (st?.startsWith('o_')) return orderInput(ctx, st, text);
  if (st === 'tp_amount') return topupCustom(ctx, text);
  if (st === 'gift_code') return giftRedeem(ctx, text);
  // Gõ #12 để mở nhanh acc số 12
  if (!st && /^#\d{1,7}$/.test(text)) return accDetail(ctx, toInt(text.slice(1)));
  if (!ctx.shop.id && (st?.startsWith('cb_') || st?.startsWith('wd_'))) return resellerInput(ctx, st, text);

  return ctx.tg.send(ctx.chatId, 'Vui lòng chọn chức năng ở menu bên dưới.', menu(app));
}

// ===================================================================
// Callback buttons

async function onCallback(ctx, cb) {
  const [a, b, c, d] = String(cb.data || '').split(':');
  let answered = false;
  ctx.answer = (t, alert = false) => {
    answered = true;
    return ctx.tg.answer(cb.id, t, alert);
  };

  switch (a) {
    case 'sv':
      if (b === 'home') await servicesHome(ctx);
      else if (b === 'c') await categoryView(ctx, toInt(c));
      else if (b === 's') await serviceView(ctx, toInt(c));
      break;
    case 'o':
      if (b === 'new') await orderStart(ctx, toInt(c));
      else if (b === 'r') await orderReaction(ctx, c);
      else if (b === 'skip') await orderSkipNote(ctx);
      else if (b === 'ok') await orderConfirm(ctx);
      else if (b === 'x') {
        await clearState(ctx);
        await show(ctx, 'Đã hủy đơn.', [[btn('Về danh sách dịch vụ', 'sv:home')]]);
      }
      break;
    case 'ac':
      if (b === 'home') await accHome(ctx);
      else if (b === 'l') await accList(ctx, toInt(c), toInt(d));
      else if (b === 'd') await accDetail(ctx, toInt(c));
      else if (b === 'v') {
        const [text, rows] = await accDetailMsg(ctx, toInt(c));
        await show(ctx, text, rows);
      } else if (b === 'b') await accBuyAsk(ctx, toInt(c));
      else if (b === 'y') await accBuy(ctx, toInt(c));
      else if (b === 'back') await accBack(ctx, toInt(c));
      else if (b === 'mine') await myAccs(ctx);
      else if (b === 'sec') await mySecret(ctx, toInt(c));
      break;
    case 'tp':
      if (b === 'x') await topupAskCustom(ctx);
      else if (b === 'home') await topupHome(ctx);
      else await sendQr(ctx, toInt(b));
      break;
    case 'od':
      if (b === 'p') await ordersList(ctx, toInt(c));
      else if (b === 'v') await orderView(ctx, toInt(c));
      else if (b === 's') await orderRefresh(ctx, toInt(c));
      break;
    case 'lg':
      if (!ctx.shop.id) await webLoginConfirm(ctx, b, c === 'y');
      break;
    case 'gift':
      await giftAsk(ctx);
      break;
    case 'me':
      if (ctx.user.state === 'gift_code') await clearState(ctx);
      if (b === 'logs') await balanceLogs(ctx);
      else await meView(ctx);
      break;
    case 'rs':
      if (!ctx.shop.id) await resellerAction(ctx, b, c);
      break;
  }
  if (!answered) await ctx.tg.answer(cb.id);
}

// ===================================================================
// Dịch vụ

const unitPrice = (ctx, s) => servicePricing(ctx.app, s).unit;

async function servicesHome(ctx) {
  const { results } = await ctx.db
    .prepare(
      `SELECT c.id, c.name, COUNT(s.id) AS n FROM categories c
       JOIN services s ON s.category_id = c.id AND s.active = 1
       WHERE c.active = 1 GROUP BY c.id ORDER BY c.sort, c.id`
    )
    .all();
  if (!results.length) return show(ctx, 'Hiện chưa có dịch vụ nào đang mở bán.');
  const rows = [];
  for (let i = 0; i < results.length; i += 2) {
    rows.push(results.slice(i, i + 2).map((c) => btn(c.name, `sv:c:${c.id}`)));
  }
  return show(ctx, `<b>Dịch vụ</b>\nChọn danh mục bạn cần:`, rows);
}

async function categoryView(ctx, catId) {
  const cat = await ctx.db.prepare('SELECT * FROM categories WHERE id = ? AND active = 1').bind(catId).first();
  if (!cat) return servicesHome(ctx);
  const { results } = await ctx.db
    .prepare('SELECT * FROM services WHERE category_id = ? AND active = 1 ORDER BY sort, id')
    .bind(catId)
    .all();
  const rows = results.map((s) => [btn(`${s.name} — ${priceLabel(s, unitPrice(ctx, s))}`, `sv:s:${s.id}`)]);
  rows.push([btn('« Quay lại', 'sv:home')]);
  return show(ctx, `<b>${esc(cat.name)}</b>\nChọn gói dịch vụ:`, rows);
}

function serviceText(ctx, s) {
  const u = unitPrice(ctx, s);
  const lines = [`<b>${esc(s.name)}</b>`, LINE, `Giá: <b>${priceLabel(s, u)}</b>`];
  if (!isPackage(s) && s.input_type !== 'comment') lines.push(`(${fmtPrice(u)} mỗi lượt)`);
  if (!isPackage(s)) lines.push(`Tối thiểu: ${num(s.min_qty)} · Tối đa: ${num(s.max_qty)}`);
  if (s.input_type === 'verify') {
    lines.push('', 'Quy trình: gửi link + SĐT/Zalo → thanh toán → admin liên hệ và xử lý → bot báo khi hoàn thành.',
      'Nếu không làm được, bạn được hoàn tiền vào số dư.');
  }
  if (s.description) lines.push('', esc(s.description));
  return lines.join('\n');
}

async function serviceView(ctx, id) {
  const s = await getService(ctx, id);
  if (!s) return show(ctx, 'Dịch vụ không còn hoạt động.', [[btn('« Quay lại', 'sv:home')]]);
  return show(ctx, serviceText(ctx, s), [
    [btn('Đặt đơn', `o:new:${s.id}`)],
    [btn('« Quay lại', `sv:c:${s.category_id}`)],
  ]);
}

const getService = (ctx, id) =>
  ctx.db.prepare('SELECT * FROM services WHERE id = ? AND active = 1').bind(id).first();

// ---- quy trình đặt đơn: hỏi lần lượt những gì còn thiếu ----

async function orderStart(ctx, id) {
  const s = await getService(ctx, id);
  if (!s) return show(ctx, 'Dịch vụ không còn hoạt động.');
  return orderNext(ctx, s, { sid: s.id });
}

async function orderNext(ctx, s, data) {
  const cancel = [[btn('Hủy', 'o:x')]];
  const t = s.input_type;
  if (!data.link) {
    await setState(ctx, 'o_link', data);
    const ask = t === 'verify' ? 'Gửi link Facebook cần lên tích xanh (trang cá nhân hoặc Fanpage):'
      : t === 'fixed' ? 'Gửi link hoặc thông tin tài khoản cần xử lý:' : 'Gửi link hoặc ID cần tăng:';
    return show(ctx, `<b>${esc(s.name)}</b>\n\n${ask}`, cancel);
  }
  if (t === 'verify' && !data.contact) {
    await setState(ctx, 'o_contact', data);
    return ctx.tg.send(ctx.chatId, 'Nhập <b>số điện thoại hoặc Zalo</b> để admin liên hệ khi xử lý:', kb(cancel));
  }
  if (t === 'verify' && data.note === undefined) {
    await setState(ctx, 'o_note', data);
    return ctx.tg.send(ctx.chatId, 'Ghi chú thêm cho admin (tên trên giấy tờ, thời gian liên hệ...), hoặc bấm Bỏ qua:',
      kb([[btn('Bỏ qua', 'o:skip')], ...cancel]));
  }
  if (t === 'comment' && !data.comments) {
    await setState(ctx, 'o_comment', data);
    return ctx.tg.send(ctx.chatId,
      `Gửi nội dung bình luận, <b>mỗi dòng một bình luận</b> (${num(s.min_qty)} - ${num(s.max_qty)} dòng):`, kb(cancel));
  }
  if (!isPackage(s) && t !== 'comment' && !data.qty) {
    await setState(ctx, 'o_qty', data);
    return ctx.tg.send(ctx.chatId, `Nhập số lượng (${num(s.min_qty)} - ${num(s.max_qty)}):`, kb(cancel));
  }
  if ((t === 'days' || t === 'minutes') && !data.extra) {
    await setState(ctx, 'o_extra', data);
    const unit = t === 'days' ? 'số ngày' : 'số phút';
    return ctx.tg.send(ctx.chatId, `Nhập ${unit} (${s.extra_min} - ${s.extra_max}):`, kb(cancel));
  }
  const reactions = String(s.reactions || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (reactions.length && !data.reaction) {
    await setState(ctx, 'o_react', data);
    const rows = [];
    for (let i = 0; i < reactions.length; i += 4) {
      rows.push(reactions.slice(i, i + 4).map((r) => btn(REACTION_LABEL[r] || r, `o:r:${r}`)));
    }
    rows.push(...cancel);
    return ctx.tg.send(ctx.chatId, 'Chọn loại cảm xúc:', kb(rows));
  }
  return orderSummary(ctx, s, data);
}

async function orderSummary(ctx, s, data) {
  const err = validateDraft(s, data);
  if (err) {
    await clearState(ctx);
    return ctx.tg.send(ctx.chatId, err);
  }
  const p = servicePricing(ctx.app, s);
  const q = quote(s, data, p.unit, p.base);
  await setState(ctx, 'o_confirm', data);
  const lines = [
    '<b>Xác nhận đơn hàng</b>',
    LINE,
    `Dịch vụ: ${esc(s.name)}`,
    `Link/ID: <code>${esc(data.link)}</code>`,
  ];
  if (!isPackage(s)) lines.push(`Số lượng: ${num(q.qty)}`);
  if (data.contact) lines.push(`Liên hệ: <code>${esc(data.contact)}</code>`);
  if (data.note) lines.push(`Ghi chú: ${esc(data.note)}`);
  if (s.input_type === 'days') lines.push(`Số ngày: ${data.extra}`);
  if (s.input_type === 'minutes') lines.push(`Số phút: ${data.extra}`);
  if (data.reaction) lines.push(`Cảm xúc: ${REACTION_LABEL[data.reaction] || data.reaction}`);
  lines.push(LINE, `Thành tiền: <b>${money(q.total)}</b>`, `Số dư hiện tại: ${money(ctx.user.balance)}`);
  const enough = ctx.user.balance >= q.total;
  if (!enough) lines.push('', `Bạn cần nạp thêm <b>${money(q.total - ctx.user.balance)}</b> để đặt đơn này.`);
  const rows = enough
    ? [[btn(`Xác nhận — ${money(q.total)}`, 'o:ok')], [btn('Hủy', 'o:x')]]
    : [[btn('Nạp tiền', 'tp:home')], [btn('Hủy', 'o:x')]];
  return ctx.cb ? show(ctx, lines.join('\n'), rows) : ctx.tg.send(ctx.chatId, lines.join('\n'), kb(rows));
}

async function orderInput(ctx, st, text) {
  const data = safeJson(ctx.user.state_data, {});
  const s = await getService(ctx, data.sid);
  if (!s) {
    await clearState(ctx);
    return ctx.tg.send(ctx.chatId, 'Dịch vụ không còn hoạt động.', menu(ctx.app));
  }
  if (st === 'o_link') {
    if (text.length > 500 || text.length < 3) return ctx.tg.send(ctx.chatId, 'Link/ID không hợp lệ, vui lòng gửi lại.');
    data.link = text;
  } else if (st === 'o_qty') {
    const q = toInt(text, NaN);
    if (!Number.isInteger(q) || q < s.min_qty || q > s.max_qty)
      return ctx.tg.send(ctx.chatId, `Số lượng phải là số từ ${num(s.min_qty)} đến ${num(s.max_qty)}. Nhập lại:`);
    data.qty = q;
  } else if (st === 'o_extra') {
    const x = toInt(text, NaN);
    if (!Number.isInteger(x) || x < s.extra_min || x > s.extra_max)
      return ctx.tg.send(ctx.chatId, `Giá trị phải từ ${s.extra_min} đến ${s.extra_max}. Nhập lại:`);
    data.extra = x;
  } else if (st === 'o_contact') {
    const c = text.replace(/[^\d+ ]/g, '').trim();
    if (c.replace(/\D/g, '').length < 9 || c.length > 20) return ctx.tg.send(ctx.chatId, 'Số điện thoại/Zalo chưa đúng, nhập lại (vd 0385673834):');
    data.contact = c;
  } else if (st === 'o_note') {
    data.note = text.slice(0, 300);
  } else if (st === 'o_comment') {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < s.min_qty || lines.length > s.max_qty)
      return ctx.tg.send(ctx.chatId, `Cần từ ${num(s.min_qty)} đến ${num(s.max_qty)} dòng (bạn gửi ${lines.length}). Gửi lại:`);
    data.comments = lines.join('\n');
    data.qty = lines.length;
  } else {
    return ctx.tg.send(ctx.chatId, 'Vui lòng dùng các nút bên trên để tiếp tục, hoặc gõ /huy để hủy.');
  }
  return orderNext(ctx, s, data);
}

async function orderSkipNote(ctx) {
  if (ctx.user.state !== 'o_note') return ctx.answer('Phiên đặt đơn đã hết hạn.');
  const data = safeJson(ctx.user.state_data, {});
  const s = await getService(ctx, data.sid);
  if (!s) return ctx.answer('Dịch vụ không còn hoạt động.');
  data.note = '';
  return orderNext(ctx, s, data);
}

async function orderReaction(ctx, reaction) {
  if (ctx.user.state !== 'o_react') return ctx.answer('Phiên đặt đơn đã hết hạn.');
  const data = safeJson(ctx.user.state_data, {});
  const s = await getService(ctx, data.sid);
  const allowed = String(s?.reactions || '').split(',').map((x) => x.trim());
  if (!s || !allowed.includes(reaction)) return ctx.answer('Lựa chọn không hợp lệ.');
  data.reaction = reaction;
  return orderSummary(ctx, s, data);
}

async function orderConfirm(ctx) {
  const raw = await takeState(ctx, 'o_confirm');
  if (raw === null) return ctx.answer('Đơn này đã được xử lý hoặc hết hạn.');
  const data = safeJson(raw, {});
  const s = await getService(ctx, data.sid);
  if (!s) return show(ctx, 'Dịch vụ vừa tạm ngưng, đơn chưa được tạo.');

  await ctx.answer('Đang tạo đơn...');
  const r = await placeOrder(ctx.app, ctx.user.id, s, data, servicePricing(ctx.app, s));
  if (!r.ok) return show(ctx, r.msg, [[btn('Nạp tiền', 'tp:home'), btn('Dịch vụ', 'sv:home')]]);

  const o = r.order;
  const note = {
    manual: s.input_type === 'verify'
      ? 'Đơn tích xanh đã vào hàng chờ. Admin sẽ liên hệ qua SĐT/Zalo bạn cung cấp.'
      : 'Đơn đã vào hàng chờ, admin sẽ xử lý sớm nhất.',
    review: 'Hệ thống đang xác nhận đơn với nhà cung cấp, bạn sẽ được báo khi có kết quả.',
    processing: 'Đơn đang được chạy.',
  }[o.status] || '';
  return show(ctx,
    `<b>Đặt đơn thành công #${o.id}</b>\n${LINE}\n${esc(s.name)}\nThanh toán: ${money(o.price_total)}\n` +
    `Số dư còn: <b>${money(r.balance)}</b>\n\n${note}`,
    [[btn('Xem đơn', `od:v:${o.id}`), btn('Đặt tiếp', `sv:c:${s.category_id}`)]]);
}

// ===================================================================
// Đơn hàng

async function ordersList(ctx, page) {
  page = Math.max(0, page);
  const { results } = await ctx.db
    .prepare(`SELECT id, service_name, status, price_total FROM orders WHERE user_id = ? AND status != 'pending_pay'
              ORDER BY id DESC LIMIT ? OFFSET ?`)
    .bind(ctx.user.id, PAGE + 1, page * PAGE)
    .all();
  if (!results.length && page === 0) return show(ctx, 'Bạn chưa có đơn hàng nào.', [[btn('Xem dịch vụ', 'sv:home')]]);
  const rows = results.slice(0, PAGE).map((o) => [btn(`#${o.id} · ${o.service_name} · ${ORDER_STATUS[o.status] || o.status}`, `od:v:${o.id}`)]);
  const nav = [];
  if (page > 0) nav.push(btn('« Trước', `od:p:${page - 1}`));
  if (results.length > PAGE) nav.push(btn('Sau »', `od:p:${page + 1}`));
  if (nav.length) rows.push(nav);
  return show(ctx, `<b>Đơn hàng của bạn</b>${page ? ` · trang ${page + 1}` : ''}`, rows);
}

async function orderView(ctx, id) {
  const o = await ctx.db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').bind(id, ctx.user.id).first();
  if (!o) return ctx.answer('Không tìm thấy đơn.');
  const lines = [
    `<b>Đơn #${o.id}</b>`, LINE,
    `Dịch vụ: ${esc(o.service_name)}`,
    `Link/ID: <code>${esc(o.link)}</code>`,
  ];
  if (o.mode === 'api') lines.push(`Số lượng: ${num(o.quantity)}`);
  if (o.mode === 'manual' && o.status === 'processing') lines.push('Admin đang xử lý đơn của bạn.');
  const ex = orderExtraText(o);
  if (ex) lines.push(esc(ex));
  if (o.start_count) lines.push(`Ban đầu: ${num(o.start_count)}`);
  if (o.delivered) lines.push(`Đã chạy: ${num(o.delivered)}`);
  lines.push(`Thanh toán: ${money(o.price_total)}`);
  if (o.refunded) lines.push(`Đã hoàn: ${money(o.refunded)}`);
  lines.push(`Trạng thái: <b>${ORDER_STATUS[o.status] || o.status}</b>`);
  if (o.admin_note && o.status !== 'review') lines.push(`Ghi chú: ${esc(o.admin_note)}`);
  lines.push(`Thời gian: ${fmtTime(o.created_at)}`);
  const rows = [];
  if (o.status === 'processing' && o.mode === 'api') rows.push([btn('Cập nhật trạng thái', `od:s:${o.id}`)]);
  rows.push([btn('« Danh sách đơn', 'od:p:0')]);
  return show(ctx, lines.join('\n'), rows);
}

async function orderRefresh(ctx, id) {
  const o = await ctx.db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').bind(id, ctx.user.id).first();
  if (!o) return ctx.answer('Không tìm thấy đơn.');
  if (now() - (o.updated_at || 0) < 30) {
    await ctx.answer('Vừa cập nhật, thử lại sau ít giây.');
  } else {
    await syncOrder(ctx.app, o);
    await ctx.answer('Đã cập nhật.');
  }
  return orderView(ctx, id);
}

function fmtTime(t) {
  return new Date((t + 7 * 3600) * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

// ===================================================================
// Acc game

async function clearAlbum(ctx) {
  const ids = safeJson(ctx.user.album, []);
  if (!ids.length) return;
  await ctx.db.prepare('UPDATE users SET album = NULL WHERE id = ?').bind(ctx.user.id).run();
  ctx.user.album = null;
  await Promise.all(ids.map((mid) => ctx.tg.del(ctx.chatId, mid)));
}

async function accHome(ctx) {
  await clearAlbum(ctx);
  const { results } = await ctx.db
    .prepare(
      `SELECT g.id, g.name, COUNT(a.id) AS n FROM games g
       LEFT JOIN accounts a ON a.game_id = g.id AND a.status = 'available'
       WHERE g.active = 1 GROUP BY g.id ORDER BY g.sort, g.id`
    )
    .all();
  if (!results.length) return show(ctx, 'Hiện chưa có acc nào đang bán.');
  if (results.length === 1) return accList(ctx, results[0].id, 0);
  const rows = results.map((g) => [btn(`${g.name} (${g.n})`, `ac:l:${g.id}:0`)]);
  rows.push([btn('Acc đã mua', 'ac:mine')]);
  return show(ctx, '<b>Mua acc game</b>\nChọn game:', rows);
}

async function accList(ctx, gameId, page) {
  await clearAlbum(ctx);
  page = Math.max(0, page);
  const game = await ctx.db.prepare('SELECT * FROM games WHERE id = ? AND active = 1').bind(gameId).first();
  if (!game) return accHome(ctx);
  const { results } = await ctx.db
    .prepare(`SELECT id, title, price FROM accounts WHERE game_id = ? AND status = 'available'
              ORDER BY id DESC LIMIT ? OFFSET ?`)
    .bind(gameId, PAGE + 1, page * PAGE)
    .all();
  const rows = results.slice(0, PAGE).map((a) => [btn(`#${a.id} · ${a.title || 'Acc'} · ${money(accPrice(ctx.app, a))}`, `ac:d:${a.id}`)]);
  const nav = [];
  if (page > 0) nav.push(btn('« Trước', `ac:l:${gameId}:${page - 1}`));
  if (results.length > PAGE) nav.push(btn('Sau »', `ac:l:${gameId}:${page + 1}`));
  if (nav.length) rows.push(nav);
  rows.push([btn('« Chọn game khác', 'ac:home'), btn('Acc đã mua', 'ac:mine')]);
  const text = results.length
    ? `<b>${esc(game.name)}</b>\nChọn acc để xem ảnh và thông tin chi tiết:`
    : `<b>${esc(game.name)}</b>\nHiện đã hết acc, vui lòng quay lại sau.`;
  // Tin chi tiết acc nằm dưới album ảnh, nên gửi danh sách thành tin mới cho gọn
  if (ctx.fromDetail) {
    if (ctx.cb?.message) await ctx.tg.del(ctx.chatId, ctx.cb.message.message_id);
    return ctx.tg.send(ctx.chatId, text, kb(rows));
  }
  return show(ctx, text, rows);
}

function imageUrls(app, a) {
  return safeJson(a.images, []).slice(0, 10).map((x) => (x.startsWith('http') ? x : `${app.baseUrl}/api/img/${x}`));
}

async function accDetailMsg(ctx, id) {
  const a = await ctx.db
    .prepare('SELECT a.*, g.name AS game FROM accounts a LEFT JOIN games g ON g.id = a.game_id WHERE a.id = ?')
    .bind(id)
    .first();
  if (!a || a.status === 'hidden') return ['Acc không tồn tại hoặc đã ngừng bán.', [[btn('« Quay lại', 'ac:home')]]];
  const sold = a.status !== 'available';
  const p = accPrice(ctx.app, a);
  const lines = [
    `<b>${esc(a.game || 'Acc game')}</b>`,
    `Mã acc: <b>#${a.id}</b> · ${sold ? 'ĐÃ BÁN' : 'CÒN HÀNG'}`,
  ];
  if (a.title) lines.push(esc(a.title));
  if (a.info) lines.push(LINE, esc(a.info));
  lines.push(LINE, `Giá: <b>${money(p)}</b>`);
  if (a.description) lines.push('', `<i>${esc(a.description)}</i>`);
  const rows = [];
  if (!sold) rows.push([btn(`Mua ngay — ${money(p)}`, `ac:b:${a.id}`)]);
  rows.push([btn('« Quay lại danh sách', `ac:back:${a.game_id}`)]);
  return [lines.join('\n'), rows, a];
}

async function accDetail(ctx, id) {
  const [text, rows, a] = await accDetailMsg(ctx, id);
  if (!a) return show(ctx, text, rows);
  await clearAlbum(ctx);
  if (ctx.cb?.message) await ctx.tg.del(ctx.chatId, ctx.cb.message.message_id);

  const urls = imageUrls(ctx.app, a);
  // file_id của Telegram chỉ dùng được với bot đã gửi ảnh, nên cache theo từng bot
  const cacheAll = safeJson(a.tg_file_ids, {});
  const cache = Array.isArray(cacheAll) ? [] : cacheAll[ctx.shop.id] || [];
  const albumIds = [];
  if (urls.length) {
    const useCache = cache.length === urls.length;
    let r = await ctx.tg.album(ctx.chatId, urls.map((u, i) => ({ type: 'photo', media: useCache ? cache[i] : u })));
    if (!r.ok && useCache) r = await ctx.tg.album(ctx.chatId, urls.map((u) => ({ type: 'photo', media: u })));
    if (r.ok) {
      albumIds.push(...r.result.map((m) => m.message_id));
      const ids = r.result.map((m) => m.photo?.[m.photo.length - 1]?.file_id).filter(Boolean);
      if (!useCache && ids.length === urls.length) {
        const next = Array.isArray(cacheAll) ? {} : cacheAll;
        next[ctx.shop.id] = ids;
        await ctx.db.prepare('UPDATE accounts SET tg_file_ids = ? WHERE id = ?').bind(JSON.stringify(next), a.id).run();
      }
    }
  }
  const sent = await ctx.tg.send(ctx.chatId, text, kb(rows));
  if (albumIds.length) {
    await ctx.db.prepare('UPDATE users SET album = ? WHERE id = ?').bind(JSON.stringify(albumIds), ctx.user.id).run();
  }
  return sent;
}

async function accBack(ctx, gameId) {
  ctx.fromDetail = true;
  return accList(ctx, gameId, 0);
}

async function accBuyAsk(ctx, id) {
  const a = await ctx.db.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first();
  if (!a || a.status !== 'available') return ctx.answer('Acc này đã được bán.', true);
  const p = accPrice(ctx.app, a);
  const bal = ctx.user.balance;
  if (bal < p) {
    return show(ctx,
      `Số dư không đủ để mua acc <b>#${a.id}</b>.\nGiá: ${money(p)}\nSố dư: ${money(bal)}\nCần nạp thêm: <b>${money(p - bal)}</b>`,
      [[btn('Nạp tiền', 'tp:home')], [btn('« Quay lại', `ac:v:${a.id}`)]]);
  }
  return show(ctx,
    `Xác nhận mua acc <b>#${a.id}</b> với giá <b>${money(p)}</b>?\nSố dư sau khi mua: ${money(bal - p)}`,
    [[btn('Xác nhận mua', `ac:y:${a.id}`)], [btn('« Quay lại', `ac:v:${a.id}`)]]);
}

async function accBuy(ctx, id) {
  const { app } = ctx;
  const r = await buyAccount(app, ctx.user, id);
  if (!r.ok) return ctx.answer(r.msg, true);
  await ctx.answer('Thanh toán thành công');
  const a = r.acc;
  if (r.pending) {
    const zaloRaw = (ctx.shop.id && ctx.shop.support_zalo) || app.settings.support_zalo;
    const zalo = String(zaloRaw || '').replace(/\D/g, '');
    const rows = [];
    if (zalo) rows.push([urlBtn(`Nhắn Zalo ${zaloRaw}`, `https://zalo.me/${zalo}`)]);
    rows.push([btn('Acc đã mua', 'ac:mine')]);
    return show(ctx,
      `<b>Đã thanh toán acc #${a.id}</b>\n${LINE}\nSố tiền: ${money(r.price)}\nSố dư còn: ${money(r.balance)}\n\n` +
      `Acc này được giao thủ công để đảm bảo an toàn. Admin sẽ gửi thông tin đăng nhập qua bot trong thời gian sớm nhất.\n` +
      `Cần nhanh hơn, nhắn hỗ trợ kèm <b>mã acc #${a.id}</b> và <b>mã khách ${ctx.user.id}</b>.`,
      rows);
  }
  return show(ctx,
    `<b>Mua thành công acc #${a.id}</b>\n${LINE}\n${esc(r.secret || 'Admin sẽ gửi thông tin đăng nhập cho bạn.')}\n${LINE}\n` +
    `Số dư còn: ${money(r.balance)}\n\nHãy đổi mật khẩu và thông tin bảo mật ngay sau khi đăng nhập.`,
    [[btn('Acc đã mua', 'ac:mine')]]);
}

async function myAccs(ctx) {
  await clearAlbum(ctx);
  const { results } = await ctx.db
    .prepare(`SELECT id, title, sold_price, delivered_at FROM accounts WHERE buyer_id = ? AND status = 'sold' ORDER BY sold_at DESC LIMIT 30`)
    .bind(ctx.user.id)
    .all();
  if (!results.length) return show(ctx, 'Bạn chưa mua acc nào.', [[btn('Xem acc đang bán', 'ac:home')]]);
  return show(ctx, '<b>Acc đã mua</b>', results.map((a) =>
    [btn(`#${a.id} · ${a.title || 'Acc'} · ${a.delivered_at ? money(a.sold_price) : 'chờ giao'}`, `ac:sec:${a.id}`)]));
}

async function mySecret(ctx, id) {
  const a = await ctx.db.prepare(`SELECT * FROM accounts WHERE id = ? AND buyer_id = ? AND status = 'sold'`).bind(id, ctx.user.id).first();
  if (!a) return ctx.answer('Không tìm thấy acc.');
  if (!a.delivered_at) {
    return show(ctx, `<b>Acc #${a.id}</b> đang chờ admin giao.\nBạn sẽ nhận được tin nhắn ngay khi acc được giao.`, [[btn('« Acc đã mua', 'ac:mine')]]);
  }
  const secret = await openSecret(ctx.app.env, a.secret);
  return show(ctx, `<b>Acc #${a.id}</b>\n${LINE}\n${esc(secret || 'Chưa có thông tin, liên hệ hỗ trợ.')}`,
    [[btn('« Acc đã mua', 'ac:mine')]]);
}

// ===================================================================
// Nạp tiền

const bankReady = (s) => s.bank_account && s.bank_code;

async function topupHome(ctx) {
  const s = ctx.app.settings;
  if (!bankReady(s)) return show(ctx, 'Chức năng nạp tiền đang bảo trì, vui lòng quay lại sau.');
  const amounts = String(s.topup_amounts).split(',').map((x) => toInt(x)).filter((x) => x > 0);
  const rows = [];
  for (let i = 0; i < amounts.length; i += 3) {
    rows.push(amounts.slice(i, i + 3).map((v) => btn(short(v), `tp:${v}`)));
  }
  rows.push([btn('Nhập số khác', 'tp:x'), btn('Mã quà tặng', 'gift')]);
  const bonus = Number(s.topup_bonus_percent) || 0;
  return show(ctx,
    `<b>Nạp tiền</b>\n${LINE}\nNgân hàng: ${esc(s.bank_code)}\nSố TK: <code>${esc(s.bank_account)}</code>\n` +
    `Chủ TK: ${esc(s.bank_owner)}\nNội dung: <code>${topupCode(s, ctx.user.id)}</code>\n${LINE}\n` +
    `Chuyển khoản đúng nội dung, tiền vào tự động sau 1-3 phút.` +
    (bonus ? `\nĐang khuyến mãi <b>+${bonus}%</b> mỗi lần nạp.` : '') +
    `\n\nChọn số tiền để lấy mã QR:`,
    rows);
}

async function topupAskCustom(ctx) {
  await setState(ctx, 'tp_amount');
  return show(ctx, `Nhập số tiền muốn nạp (tối thiểu ${money(ctx.app.settings.topup_min)}):`, [[btn('Hủy', 'tp:home')]]);
}

async function topupCustom(ctx, text) {
  const v = toInt(text.replace(/k$/i, '000'), NaN);
  const min = toInt(ctx.app.settings.topup_min, 10000);
  if (!Number.isInteger(v) || v < min || v > 500000000)
    return ctx.tg.send(ctx.chatId, `Số tiền không hợp lệ. Tối thiểu ${money(min)}. Nhập lại:`);
  await clearState(ctx);
  return sendQr(ctx, v);
}

async function sendQr(ctx, amount) {
  const s = ctx.app.settings;
  if (!bankReady(s) || amount <= 0) return;
  const code = topupCode(s, ctx.user.id);
  const caption =
    `<b>Quét mã để nạp ${money(amount)}</b>\n${LINE}\nNgân hàng: ${esc(s.bank_code)}\nSố TK: <code>${esc(s.bank_account)}</code>\n` +
    `Chủ TK: ${esc(s.bank_owner)}\nSố tiền: <code>${amount}</code>\nNội dung: <code>${code}</code>\n${LINE}\n` +
    `Giữ nguyên nội dung chuyển khoản. Bot sẽ báo ngay khi nhận được tiền.`;
  const r = await ctx.tg.photo(ctx.chatId, qrUrl(s, amount, ctx.user.id), caption);
  if (!r.ok) await ctx.tg.send(ctx.chatId, caption);
}

// ===================================================================
// Tài khoản & hỗ trợ

async function meView(ctx) {
  const u = ctx.user;
  const c = await ctx.db
    .prepare(`SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND status != 'pending_pay'`)
    .bind(u.id)
    .first();
  return show(ctx,
    `<b>Tài khoản</b>\n${LINE}\nMã khách: <code>${u.id}</code>\nTên: ${esc(u.first_name)}${u.username ? ` (@${esc(u.username)})` : ''}\n` +
    `Số dư: <b>${money(u.balance)}</b>\nĐã nạp: ${money(u.total_topup)}\nĐã dùng: ${money(u.total_spent)}\nSố đơn: ${num(c?.n)}`,
    [[btn('Nạp tiền', 'tp:home'), btn('Lịch sử số dư', 'me:logs')], [btn('Acc đã mua', 'ac:mine'), btn('Đơn hàng', 'od:p:0')],
      [btn('Nhập mã quà tặng', 'gift')]]);
}

const LOG_TYPE = {
  topup: 'Nạp tiền', order: 'Đặt đơn', refund: 'Hoàn tiền', buy_acc: 'Mua acc', admin: 'Điều chỉnh', commission: 'Hoa hồng', withdraw: 'Rút tiền',
  gift: 'Mã quà tặng',
};

// ===================================================================
// Đăng nhập cổng khách hàng trên web (chỉ bot gốc)

async function webLoginAsk(ctx, token) {
  const t = await ctx.db.prepare(`SELECT * FROM login_tokens WHERE token = ? AND status = 'pending' AND created_at > ?`)
    .bind(token, now() - 300).first();
  if (!t) return ctx.tg.send(ctx.chatId, 'Yêu cầu đăng nhập đã hết hạn. Hãy bấm lại "Đăng nhập bằng Telegram" trên web.');
  return ctx.tg.send(ctx.chatId,
    `<b>Xác nhận đăng nhập web</b>\n${LINE}\nTrình duyệt: ${esc(String(t.ua || '').slice(0, 80))}\nIP: <code>${esc(t.ip)}</code>\n\n` +
    `Chỉ bấm xác nhận nếu <b>chính bạn</b> vừa bấm đăng nhập trên web. Không xác nhận nếu ai đó gửi link này cho bạn.`,
    kb([[btn('Xác nhận đăng nhập', `lg:${token}:y`)], [btn('Không phải tôi', `lg:${token}:n`)]]));
}

async function webLoginConfirm(ctx, token, yes) {
  const r = await ctx.db
    .prepare(`UPDATE login_tokens SET status = ?, user_id = ? WHERE token = ? AND status = 'pending' AND created_at > ?`)
    .bind(yes ? 'confirmed' : 'denied', ctx.user.id, token, now() - 300)
    .run();
  if (!r.meta.changes) return show(ctx, 'Yêu cầu đăng nhập đã hết hạn hoặc đã được xử lý.');
  return show(ctx, yes ? 'Đã xác nhận. Quay lại trình duyệt, web sẽ tự đăng nhập.' : 'Đã từ chối yêu cầu đăng nhập.');
}

// ===================================================================
// Mã quà tặng

async function giftAsk(ctx) {
  await setState(ctx, 'gift_code');
  return show(ctx, 'Nhập mã quà tặng của bạn:', [[btn('Hủy', 'me')]]);
}

async function giftRedeem(ctx, text) {
  await clearState(ctx);
  const r = await redeemGift(ctx.db, ctx.user, text);
  if (!r.ok) return ctx.tg.send(ctx.chatId, r.msg, kb([[btn('Nhập mã khác', 'gift'), btn('Tài khoản', 'me')]]));
  return ctx.tg.send(ctx.chatId, `<b>Nhận quà thành công</b>\n+${money(r.amount)} vào số dư.\nSố dư hiện tại: <b>${money(r.balance)}</b>`,
    kb([[btn('Xem dịch vụ', 'sv:home'), btn('Mua acc', 'ac:home')]]));
}

async function balanceLogs(ctx) {
  const { results } = await ctx.db
    .prepare('SELECT * FROM balance_logs WHERE user_id = ? ORDER BY id DESC LIMIT 15')
    .bind(ctx.user.id)
    .all();
  const lines = results.map((l) =>
    `${fmtTime(l.created_at).slice(5)}  ${l.amount > 0 ? '+' : ''}${money(l.amount)}  ${LOG_TYPE[l.type] || l.type}${l.ref && l.type === 'order' ? ` #${l.ref}` : ''}`);
  return show(ctx, `<b>Lịch sử số dư</b> (15 gần nhất)\n<pre>${esc(lines.join('\n') || 'Chưa có giao dịch.')}</pre>`,
    [[btn('« Tài khoản', 'me')]]);
}

async function supportView(ctx) {
  const s = ctx.app.settings;
  const zaloRaw = (ctx.shop.id && ctx.shop.support_zalo) || s.support_zalo;
  const zalo = String(zaloRaw || '').replace(/\D/g, '');
  const rows = [];
  if (zalo) rows.push([urlBtn(`Nhắn Zalo ${zaloRaw}`, `https://zalo.me/${zalo}`)]);
  if (!ctx.shop.id && s.support_url) rows.push([urlBtn('Nhắn Telegram', s.support_url)]);
  return show(ctx,
    `<b>Hỗ trợ</b>\n${esc(ctx.shop.id ? 'Liên hệ chủ shop để được hỗ trợ.' : s.support_text)}` +
    (zalo ? `\n\nZalo: <code>${esc(zaloRaw)}</code>` : '') +
    `\nMã khách của bạn: <code>${ctx.user.id}</code>\n\nKhi cần hỗ trợ, gửi kèm mã khách và mã đơn để được xử lý nhanh.`,
    rows.length ? rows : undefined);
}

// ===================================================================
// Đại lý: API key, bot con, rút hoa hồng (chỉ trên bot gốc)

const withdrawable = (u) => Math.max(0, Math.min(u.balance, u.commission_total - u.withdrawn_total));

const myBot = (ctx) => ctx.db.prepare('SELECT * FROM bots WHERE owner_id = ? ORDER BY id LIMIT 1').bind(ctx.user.id).first();

async function resellerHome(ctx) {
  if (ctx.shop.id) return;
  const s = ctx.app.settings;
  const u = ctx.user;
  const bot = await myBot(ctx);
  const rate = Number(s.reseller_rate) || 100;
  const lines = ['<b>Đại lý & API</b>', LINE];
  if (s.api_enabled === '1') {
    lines.push('<b>API</b> — đặt đơn tự động từ web/panel của bạn.',
      `Giá API: ${rate === 100 ? 'bằng giá niêm yết' : `${rate}% giá niêm yết`} (một số gói có giá riêng).`,
      u.api_key ? `API key: <code>${esc(u.api_key)}</code>` : 'Bạn chưa có API key.',
      `Tài liệu: ${ctx.app.baseUrl}/#api`, '');
  }
  if (s.child_enabled === '1') {
    lines.push('<b>Bot con</b> — tạo bot bán hàng riêng, tự đặt giá cao hơn và nhận phần chênh lệch.');
    if (bot) lines.push(`Bot: @${esc(bot.username)} · ${bot.active ? 'đang chạy' : 'tạm dừng'}`, `Lãi trên giá đại lý: <b>${bot.markup}%</b>`);
    else lines.push(`Lãi cho phép: ${s.child_min_markup}% đến ${s.child_max_markup}% trên giá đại lý.`);
    lines.push('');
  }
  lines.push(`Hoa hồng đã nhận: ${money(u.commission_total)}`, `Đã rút: ${money(u.withdrawn_total)}`, `Có thể rút: <b>${money(withdrawable(u))}</b>`);

  const rows = [];
  if (s.api_enabled === '1') rows.push([btn(u.api_key ? 'Đổi API key' : 'Tạo API key', 'rs:key')]);
  if (s.child_enabled === '1') {
    if (bot) {
      rows.push([btn('Đổi % lãi', 'rs:markup'), btn('Zalo hỗ trợ', 'rs:zalo')]);
      rows.push([btn('Lời chào', 'rs:welcome'), btn(bot.active ? 'Tạm dừng bot' : 'Bật lại bot', 'rs:toggle')]);
      rows.push([btn('Thống kê bot con', 'rs:stats')]);
    } else rows.push([btn('Tạo bot con', 'rs:new')]);
  }
  rows.push([btn('Rút hoa hồng', 'rs:wd')]);
  return show(ctx, lines.join('\n'), rows);
}

async function resellerAction(ctx, action, arg) {
  const s = ctx.app.settings;
  const back = [[btn('« Quay lại', 'rs:home')]];
  const bot = await myBot(ctx);
  switch (action) {
    case 'home':
      await clearState(ctx);
      return resellerHome(ctx);
    case 'key': {
      if (s.api_enabled !== '1') return ctx.answer('API đang tắt.', true);
      if (ctx.user.api_key && arg !== 'y') {
        return show(ctx, 'Đổi API key sẽ làm key cũ ngừng hoạt động ngay. Tiếp tục?', [[btn('Đổi key', 'rs:key:y')], ...back]);
      }
      const key = `sk_${randomToken(20)}`;
      await ctx.db.prepare('UPDATE users SET api_key = ? WHERE id = ?').bind(key, ctx.user.id).run();
      ctx.user.api_key = key;
      await ctx.answer('Đã tạo API key mới');
      return resellerHome(ctx);
    }
    case 'new':
      if (s.child_enabled !== '1') return ctx.answer('Chức năng bot con đang tắt.', true);
      if (bot) return resellerHome(ctx);
      await setState(ctx, 'cb_token');
      return show(ctx,
        '<b>Tạo bot con</b>\n1. Mở @BotFather, gửi /newbot và làm theo hướng dẫn.\n2. Copy token BotFather gửi cho bạn và dán vào đây.\n\n' +
        'Token có dạng <code>123456789:AAH...</code>', back);
    case 'markup':
      if (!bot) return resellerHome(ctx);
      await setState(ctx, 'cb_markup');
      return show(ctx, `Nhập % lãi trên giá đại lý (từ ${s.child_min_markup} đến ${s.child_max_markup}).\nHiện tại: ${bot.markup}%`, back);
    case 'zalo':
      if (!bot) return resellerHome(ctx);
      await setState(ctx, 'cb_zalo');
      return show(ctx, 'Nhập số Zalo để khách của bot con liên hệ (gửi <code>-</code> để dùng mặc định):', back);
    case 'welcome':
      if (!bot) return resellerHome(ctx);
      await setState(ctx, 'cb_welcome');
      return show(ctx, 'Nhập lời chào hiển thị khi khách bấm /start (gửi <code>-</code> để dùng mặc định):', back);
    case 'toggle':
      if (!bot) return resellerHome(ctx);
      await ctx.db.prepare('UPDATE bots SET active = 1 - active WHERE id = ?').bind(bot.id).run();
      await ctx.answer(bot.active ? 'Đã tạm dừng bot con' : 'Đã bật bot con');
      return resellerHome(ctx);
    case 'stats': {
      if (!bot) return resellerHome(ctx);
      const r = await ctx.db.prepare(`SELECT
          (SELECT COUNT(*) FROM users WHERE bot_id = ?1) AS users,
          (SELECT COUNT(*) FROM orders WHERE bot_id = ?1 AND status NOT IN ('pending_pay','failed')) AS orders,
          (SELECT COALESCE(SUM(price_total - refunded),0) FROM orders WHERE bot_id = ?1 AND status NOT IN ('pending_pay','failed')) AS revenue,
          (SELECT COUNT(*) FROM accounts WHERE bot_id = ?1 AND status = 'sold') AS accs,
          (SELECT COALESCE(SUM(t.amount),0) FROM topups t JOIN users u ON u.id = t.user_id WHERE t.status = 'credited' AND u.bot_id = ?1) AS topup`)
        .bind(bot.id).first();
      return show(ctx,
        `<b>Thống kê @${esc(bot.username)}</b>\n${LINE}\nKhách: ${num(r.users)}\nĐơn dịch vụ: ${num(r.orders)} · ${money(r.revenue)}\n` +
        `Acc đã bán: ${num(r.accs)}\nKhách đã nạp: ${money(r.topup)}\nHoa hồng của bạn: <b>${money(ctx.user.commission_total)}</b>`, back);
    }
    case 'wd': {
      const w = withdrawable(ctx.user);
      const min = toInt(s.withdraw_min, 50000);
      if (w < min) return show(ctx, `Hoa hồng có thể rút: ${money(w)}.\nCần tối thiểu ${money(min)} để tạo lệnh rút.`, back);
      await setState(ctx, 'wd_amount');
      return show(ctx, `Có thể rút: <b>${money(w)}</b>\nNhập số tiền muốn rút (tối thiểu ${money(min)}):`, back);
    }
  }
}

async function resellerInput(ctx, st, text) {
  const s = ctx.app.settings;
  const back = kb([[btn('« Đại lý & API', 'rs:home')]]);
  const bot = await myBot(ctx);

  if (st === 'cb_token') {
    if (!/^\d{6,}:[\w-]{30,}$/.test(text)) return ctx.tg.send(ctx.chatId, 'Token không đúng định dạng. Dán lại token từ @BotFather:');
    if (bot) {
      await clearState(ctx);
      return resellerHome(ctx);
    }
    if (text === s.bot_token) return ctx.tg.send(ctx.chatId, 'Không thể dùng token của bot này.');
    const child = createTg(text);
    const me = await child.call('getMe');
    if (!me.ok) return ctx.tg.send(ctx.chatId, 'Token không hợp lệ hoặc đã bị thu hồi. Kiểm tra lại và gửi lại:');
    const dup = await ctx.db.prepare('SELECT id FROM bots WHERE username = ?').bind(me.result.username).first();
    if (dup) return ctx.tg.send(ctx.chatId, 'Bot này đã được đăng ký trên hệ thống.');
    const markup = Math.min(Number(s.child_max_markup) || 300, Math.max(Number(s.child_min_markup) || 0, 20));
    const secret = randomToken(16);
    const b = await ctx.db
      .prepare(`INSERT INTO bots (owner_id, token, username, name, secret, markup, active, created_at) VALUES (?,?,?,?,?,?,1,?) RETURNING id`)
      .bind(ctx.user.id, text, me.result.username, me.result.first_name || me.result.username, secret, markup, now())
      .first();
    const wh = await child.call('setWebhook', {
      url: `${ctx.app.baseUrl}/api/telegram/webhook/${b.id}`,
      secret_token: secret,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: true,
    });
    if (!wh.ok) {
      await ctx.db.prepare('DELETE FROM bots WHERE id = ?').bind(b.id).run();
      return ctx.tg.send(ctx.chatId, `Không kết nối được bot: ${esc(wh.description)}`);
    }
    await child.call('setMyCommands', { commands: BOT_COMMANDS });
    await clearState(ctx);
    notifyAdmins(ctx.app, `Bot con mới: @${esc(me.result.username)} của khách <code>${ctx.user.id}</code>`).catch(() => {});
    return ctx.tg.send(ctx.chatId,
      `<b>Đã tạo bot con @${esc(me.result.username)}</b>\nLãi mặc định: ${markup}% trên giá đại lý.\n` +
      `Mỗi đơn khách mua qua bot con, phần chênh lệch được cộng vào số dư của bạn tại đây.`,
      kb([[urlBtn('Mở bot con', `https://t.me/${me.result.username}`)], [btn('« Đại lý & API', 'rs:home')]]));
  }

  if (st === 'cb_markup' && bot) {
    const v = Number(text.replace(',', '.').replace('%', ''));
    const min = Number(s.child_min_markup) || 0;
    const max = Number(s.child_max_markup) || 300;
    if (!Number.isFinite(v) || v < min || v > max) return ctx.tg.send(ctx.chatId, `Nhập số từ ${min} đến ${max}:`);
    await ctx.db.prepare('UPDATE bots SET markup = ? WHERE id = ?').bind(Math.round(v * 100) / 100, bot.id).run();
    await clearState(ctx);
    return ctx.tg.send(ctx.chatId, `Đã đổi lãi bot con thành <b>${v}%</b>.`, back);
  }

  if (st === 'cb_zalo' && bot) {
    const v = text === '-' ? '' : text.replace(/[^\d+]/g, '').slice(0, 15);
    if (text !== '-' && v.length < 9) return ctx.tg.send(ctx.chatId, 'Số Zalo không hợp lệ. Nhập lại:');
    await ctx.db.prepare('UPDATE bots SET support_zalo = ? WHERE id = ?').bind(v, bot.id).run();
    await clearState(ctx);
    return ctx.tg.send(ctx.chatId, 'Đã cập nhật Zalo hỗ trợ.', back);
  }

  if (st === 'cb_welcome' && bot) {
    await ctx.db.prepare('UPDATE bots SET welcome_text = ? WHERE id = ?').bind(text === '-' ? '' : text.slice(0, 800), bot.id).run();
    await clearState(ctx);
    return ctx.tg.send(ctx.chatId, 'Đã cập nhật lời chào.', back);
  }

  if (st === 'wd_amount') {
    const v = toInt(text.replace(/k$/i, '000'), NaN);
    const min = toInt(s.withdraw_min, 50000);
    const w = withdrawable(ctx.user);
    if (!Number.isInteger(v) || v < min || v > w) return ctx.tg.send(ctx.chatId, `Nhập số tiền từ ${money(min)} đến ${money(w)}:`);
    await setState(ctx, 'wd_bank', { amount: v });
    return ctx.tg.send(ctx.chatId, 'Gửi thông tin nhận tiền trong một tin nhắn:\n<code>Ngân hàng - Số tài khoản - Tên chủ TK</code>');
  }

  if (st === 'wd_bank') {
    if (text.length < 8) return ctx.tg.send(ctx.chatId, 'Thông tin chưa đủ, gửi lại theo mẫu: Ngân hàng - STK - Tên.');
    // Xóa state nguyên tử để gửi trùng tin cũng chỉ tạo một lệnh rút
    const raw = await takeState(ctx, 'wd_bank');
    if (raw === null) return;
    const amount = toInt(safeJson(raw, {}).amount);
    const fresh = await ctx.db.prepare('SELECT * FROM users WHERE id = ?').bind(ctx.user.id).first();
    if (amount <= 0 || amount > withdrawable(fresh)) return ctx.tg.send(ctx.chatId, 'Số dư hoa hồng không đủ.', back);
    const bal = await changeBalance(ctx.db, ctx.user.id, -amount, { type: 'withdraw', note: 'Yêu cầu rút hoa hồng' });
    if (bal === null) return ctx.tg.send(ctx.chatId, 'Số dư không đủ.', back);
    const w = await ctx.db
      .prepare('INSERT INTO withdrawals (user_id, amount, bank_info, status, created_at, updated_at) VALUES (?,?,?,?,?,?) RETURNING id')
      .bind(ctx.user.id, amount, text.slice(0, 300), 'pending', now(), now()).first();
    notifyAdmins(ctx.app, `<b>Yêu cầu rút #${w.id}</b> ${money(amount)}\nKhách <code>${ctx.user.id}</code>\n${esc(text)}`).catch(() => {});
    return ctx.tg.send(ctx.chatId, `Đã tạo lệnh rút <b>#${w.id}</b> ${money(amount)}. Admin sẽ chuyển khoản sớm nhất.`, back);
  }

  await clearState(ctx);
  return resellerHome(ctx);
}
