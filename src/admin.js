import { changeBalance, esc, HttpError, json, loadSettings, money, now, randomToken, safeJson, saveSettings, toInt } from './util.js';
import { acceptOrder, cancelOrderNoRefund, completeOrder, payAccCommission, refundOrder, syncOrder, syncPending } from './orders.js';
import { creditTopup } from './sepay.js';
import { createTg } from './telegram.js';
import { notifyUser, tgFor } from './shop.js';
import { openSecret, sealSecret } from './crypto.js';
import { BOT_COMMANDS } from './bot.js';
import { ruledPrice, syncCatalog } from './catalog.js';

const PAGE = 30;
const VN = 7 * 3600;

async function body(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Dữ liệu gửi lên không hợp lệ');
  }
}

const pageOf = (url) => Math.max(0, toInt(url.searchParams.get('page'), 0));
const USER_COLS = 'u.tg_id, u.username, u.first_name, u.bot_id, b.username AS bot_username';
const USER_JOIN = (col) => `LEFT JOIN users u ON u.id = ${col} LEFT JOIN bots b ON b.id = u.bot_id`;

export async function handleAdmin(request, app, parts, url) {
  const { db } = app;
  const m = request.method;
  const [res, id, sub] = parts;

  // ------------------------------------------------------------ dashboard
  if (res === 'stats') return json(await stats(db, Math.min(365, Math.max(7, toInt(url.searchParams.get('days'), 30)))));

  // ------------------------------------------------------------ orders
  if (res === 'orders') {
    if (!id && m === 'GET') {
      const status = url.searchParams.get('status') || '';
      const q = (url.searchParams.get('q') || '').trim();
      const where = [`o.status != 'pending_pay'`];
      const args = [];
      if (status) where.push('o.status = ?'), args.push(status);
      if (url.searchParams.get('type') === 'verify') where.push(`o.service_id IN (SELECT id FROM services WHERE input_type = 'verify')`);
      if (q) {
        where.push('(o.id = ? OR o.user_id = ? OR o.link LIKE ? OR o.upstream_code = ?)');
        args.push(toInt(q, -1), toInt(q, -1), `%${q}%`, q);
      }
      return json(await paged(db,
        `SELECT o.*, ${USER_COLS} FROM orders o ${USER_JOIN('o.user_id')} WHERE ${where.join(' AND ')} ORDER BY o.id DESC`,
        `SELECT COUNT(*) AS n FROM orders o WHERE ${where.join(' AND ')}`, args, pageOf(url)));
    }
    if (id === 'sync' && m === 'POST') return json(await syncPending(app, 30));
    if (id && m === 'POST') {
      const b = await body(request);
      const o = await db.prepare('SELECT * FROM orders WHERE id = ?').bind(toInt(id)).first();
      if (!o) throw new HttpError(404, 'Không tìm thấy đơn');
      let r;
      switch (b.action) {
        case 'accept': r = await acceptOrder(app, o.id, b.note || ''); break;
        case 'done': r = await completeOrder(app, o.id, b.note || ''); break;
        case 'cancel': r = await cancelOrderNoRefund(app, o.id, b.note || ''); break;
        case 'refund': {
          const amount = b.amount === undefined || b.amount === '' ? o.price_total : toInt(b.amount, -1);
          if (amount < 0 || amount > o.price_total) throw new HttpError(400, 'Số tiền hoàn không hợp lệ');
          r = await refundOrder(app, o.id, amount, b.note || 'Admin hoàn tiền');
          break;
        }
        case 'sync':
          r = await syncOrder(app, o);
          if (!r.ok && r.msg) throw new HttpError(400, r.msg);
          r.ok = true;
          break;
        case 'upstream_cancel': {
          if (!o.upstream_code) throw new HttpError(400, 'Đơn chưa có mã trên API');
          const x = await app.up.cancel(o.upstream_code);
          r = { ok: x.ok, msg: x.ok ? 'Đã gửi yêu cầu hủy, trạng thái sẽ cập nhật khi đồng bộ.' : x.msg };
          break;
        }
        case 'set_code': {
          if (o.status !== 'review') throw new HttpError(400, 'Chỉ dùng cho đơn cần kiểm tra');
          const code = String(b.code || '').trim();
          if (!code) throw new HttpError(400, 'Nhập mã đơn trên API');
          await db.prepare(`UPDATE orders SET status = 'processing', upstream_code = ?, updated_at = ? WHERE id = ? AND status = 'review'`)
            .bind(code, now(), o.id).run();
          r = { ok: true };
          break;
        }
        default:
          throw new HttpError(400, 'Thao tác không hợp lệ');
      }
      if (!r.ok) throw new HttpError(400, r.msg || 'Không thực hiện được');
      return json(r);
    }
  }

  // ------------------------------------------------------------ categories & services
  if (res === 'categories') {
    if (m === 'GET') return json((await db.prepare('SELECT * FROM categories ORDER BY sort, id').all()).results);
    const b = m === 'DELETE' ? {} : await body(request);
    if (m === 'POST') {
      if (!String(b.name || '').trim()) throw new HttpError(400, 'Nhập tên danh mục');
      return json(await db.prepare('INSERT INTO categories (name, sort, active) VALUES (?,?,?) RETURNING *')
        .bind(String(b.name).trim(), toInt(b.sort), b.active === false ? 0 : 1).first());
    }
    if (m === 'PUT' && id) {
      if (!String(b.name || '').trim()) throw new HttpError(400, 'Nhập tên danh mục');
      await db.prepare('UPDATE categories SET name = ?, sort = ?, active = ? WHERE id = ?')
        .bind(String(b.name).trim(), toInt(b.sort), b.active ? 1 : 0, toInt(id)).run();
      return json({ ok: true });
    }
    if (m === 'DELETE' && id) {
      const n = await db.prepare('SELECT COUNT(*) AS n FROM services WHERE category_id = ?').bind(toInt(id)).first();
      if (n.n) throw new HttpError(400, 'Danh mục còn dịch vụ, hãy chuyển hoặc xóa dịch vụ trước');
      await db.prepare('DELETE FROM categories WHERE id = ?').bind(toInt(id)).run();
      return json({ ok: true });
    }
  }

  if (res === 'services') {
    if (m === 'GET' && !id) {
      return json((await db.prepare(
        `SELECT s.*, c.name AS category_name,
          (SELECT COUNT(*) FROM orders o WHERE o.service_id = s.id AND o.status NOT IN ('pending_pay','failed')) AS orders
         FROM services s LEFT JOIN categories c ON c.id = s.category_id ORDER BY c.sort, s.category_id, s.sort, s.id`).all()).results);
    }
    if ((id === 'sync-all' || id === 'sync-costs') && m === 'POST') {
      const b = await body(request).catch(() => ({}));
      const r = await syncCatalog(app, { addNew: id === 'sync-all' && b.add_new !== false });
      if (!r.ok) throw new HttpError(400, r.msg);
      return json(r);
    }
    // Áp quy tắc giá cho các gói chọn "giá tự động" (dùng ngay sau khi đổi quy tắc)
    if (id === 'reprice' && m === 'POST') {
      const fresh = await loadSettings(db);
      const { results } = await db.prepare('SELECT id, cost FROM services WHERE auto_price = 1').all();
      const stmts = results.map((x) => db.prepare('UPDATE services SET price = ? WHERE id = ?').bind(ruledPrice(fresh, x.cost), x.id));
      for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
      return json({ ok: true, count: stmts.length });
    }
    if (id === 'bulk' && m === 'POST') {
      const b = await body(request);
      const ids = (Array.isArray(b.ids) ? b.ids : []).map((x) => toInt(x)).filter((x) => x > 0).slice(0, 500);
      if (!ids.length) throw new HttpError(400, 'Chưa chọn dịch vụ');
      const ph = ids.map(() => '?').join(',');
      if (b.action === 'on' || b.action === 'off') {
        await db.prepare(`UPDATE services SET active = ? WHERE id IN (${ph})`).bind(b.action === 'on' ? 1 : 0, ...ids).run();
      } else if (b.action === 'auto') {
        const fresh = await loadSettings(db);
        const { results } = await db.prepare(`SELECT id, cost FROM services WHERE id IN (${ph})`).bind(...ids).all();
        await db.batch(results.map((x) => db.prepare('UPDATE services SET auto_price = 1, price = ? WHERE id = ?').bind(ruledPrice(fresh, x.cost), x.id)));
      } else if (b.action === 'delete') {
        await db.prepare(`DELETE FROM services WHERE id IN (${ph})`).bind(...ids).run();
      } else throw new HttpError(400, 'Thao tác không hợp lệ');
      return json({ ok: true, count: ids.length });
    }
    // Tạo nhanh nhóm dịch vụ tích xanh Facebook (khách thuê làm, admin xử lý tay)
    if (id === 'template-verify' && m === 'POST') {
      const b = await body(request);
      const packs = [
        ['Tích xanh Facebook cá nhân', toInt(b.price_personal), 'Gắn tích xanh cho trang cá nhân Facebook. Gửi link trang cá nhân và SĐT/Zalo, admin sẽ liên hệ hướng dẫn.'],
        ['Tích xanh Fanpage', toInt(b.price_page), 'Gắn tích xanh cho Fanpage Facebook. Gửi link Fanpage và SĐT/Zalo, admin sẽ liên hệ hướng dẫn.'],
      ].filter((p) => p[1] > 0);
      if (!packs.length) throw new HttpError(400, 'Nhập giá cho ít nhất một gói');
      let cat = await db.prepare(`SELECT id FROM categories WHERE name = 'Tích xanh Facebook'`).first();
      if (!cat) cat = await db.prepare(`INSERT INTO categories (name, sort, active) VALUES ('Tích xanh Facebook', 0, 1) RETURNING id`).first();
      await db.batch(packs.map(([name, price, desc], i) =>
        db.prepare(`INSERT INTO services (category_id, name, description, mode, input_type, price, cost, min_qty, max_qty, active, sort, created_at)
                    VALUES (?,?,?,'manual','verify',?,?,1,1,1,?,?)`).bind(cat.id, name, desc, price, toInt(b.cost), i, now())));
      return json({ ok: true, count: packs.length });
    }
    if (id === 'import' && m === 'POST') {
      const b = await body(request);
      const r = await app.up.services();
      if (!r.ok) throw new HttpError(400, r.msg);
      const markup = Number(b.markup) || 0;
      const picked = (r.data || []).filter((x) => (b.server_orders || []).includes(x.server_order));
      if (!picked.length) throw new HttpError(400, 'Chưa chọn dịch vụ nào');
      const stmts = picked.map((x) => {
        const cost = Number(x.prices) || 0;
        const price = Math.ceil(cost * (1 + markup / 100) * 100) / 100;
        return db.prepare(`INSERT INTO services (category_id, name, description, mode, input_type, server_order, price, cost,
            min_qty, max_qty, reactions, active, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?)`)
          .bind(toInt(b.category_id) || null, x.name, cleanDetail(x.detail), 'api', 'quantity', x.server_order, price, cost,
            toInt(x.min_order, 1), toInt(x.max_order, 100000), x.reaction && x.reaction !== 'no' ? 'like,love,care,haha,wow,sad,angry' : '', now());
      });
      await db.batch(stmts);
      return json({ ok: true, count: stmts.length });
    }
    const b = m === 'DELETE' ? {} : await body(request);
    if (m === 'POST' && !id) {
      return json(await db.prepare(`INSERT INTO services (category_id, name, description, mode, input_type, server_order, price, cost, api_price,
          min_qty, max_qty, extra_min, extra_max, reactions, active, sort, auto_price, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`)
        .bind(...serviceFields(b, app.settings), now()).first());
    }
    if (m === 'PUT' && id) {
      await db.prepare(`UPDATE services SET category_id=?, name=?, description=?, mode=?, input_type=?, server_order=?, price=?, cost=?, api_price=?,
          min_qty=?, max_qty=?, extra_min=?, extra_max=?, reactions=?, active=?, sort=?, auto_price=? WHERE id = ?`)
        .bind(...serviceFields(b, app.settings), toInt(id)).run();
      return json({ ok: true });
    }
    if (m === 'DELETE' && id) {
      await db.prepare('DELETE FROM services WHERE id = ?').bind(toInt(id)).run();
      return json({ ok: true });
    }
  }

  if (res === 'upstream') {
    if (!app.settings.api_key) {
      if (id === 'profile') return json({ configured: false });
      throw new HttpError(400, 'Chưa nhập API key nhà cung cấp trong Cài đặt');
    }
    const r = id === 'profile' ? await app.up.profile() : await app.up.services();
    if (!r.ok) throw new HttpError(400, r.msg);
    return json(id === 'profile' ? (Array.isArray(r.data) ? r.data[0] : r.data) : r.data);
  }

  // ------------------------------------------------------------ games & accounts
  if (res === 'games') {
    if (m === 'GET') {
      return json((await db.prepare(`SELECT g.*,
          (SELECT COUNT(*) FROM accounts a WHERE a.game_id = g.id AND a.status = 'available') AS available,
          (SELECT COUNT(*) FROM accounts a WHERE a.game_id = g.id AND a.status = 'sold') AS sold
        FROM games g ORDER BY g.sort, g.id`).all()).results);
    }
    const b = m === 'DELETE' ? {} : await body(request);
    if (m === 'POST') {
      if (!String(b.name || '').trim()) throw new HttpError(400, 'Nhập tên game');
      return json(await db.prepare('INSERT INTO games (name, sort, active) VALUES (?,?,?) RETURNING *')
        .bind(String(b.name).trim(), toInt(b.sort), b.active === false ? 0 : 1).first());
    }
    if (m === 'PUT' && id) {
      if (!String(b.name || '').trim()) throw new HttpError(400, 'Nhập tên game');
      await db.prepare('UPDATE games SET name = ?, active = ? WHERE id = ?').bind(String(b.name).trim(), b.active ? 1 : 0, toInt(id)).run();
      return json({ ok: true });
    }
    if (m === 'DELETE' && id) {
      const n = await db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE game_id = ?').bind(toInt(id)).first();
      if (n.n) throw new HttpError(400, 'Game còn acc, không thể xóa');
      await db.prepare('DELETE FROM games WHERE id = ?').bind(toInt(id)).run();
      return json({ ok: true });
    }
  }

  if (res === 'accounts') {
    if (m === 'GET') {
      const where = ['1=1'];
      const args = [];
      const status = url.searchParams.get('status');
      const game = toInt(url.searchParams.get('game'));
      const q = (url.searchParams.get('q') || '').trim();
      if (status === 'pending') where.push(`a.status = 'sold' AND a.delivered_at IS NULL`);
      else if (status) where.push('a.status = ?'), args.push(status);
      if (game) where.push('a.game_id = ?'), args.push(game);
      if (q) where.push('(a.id = ? OR a.title LIKE ? OR a.info LIKE ?)'), args.push(toInt(q, -1), `%${q}%`, `%${q}%`);
      const data = await paged(db,
        `SELECT a.*, g.name AS game, ${USER_COLS} FROM accounts a LEFT JOIN games g ON g.id = a.game_id ${USER_JOIN('a.buyer_id')}
         WHERE ${where.join(' AND ')} ORDER BY (a.status = 'sold' AND a.delivered_at IS NULL) DESC, a.id DESC`,
        `SELECT COUNT(*) AS n FROM accounts a WHERE ${where.join(' AND ')}`, args, pageOf(url));
      for (const a of data.items) {
        a.secret = await openSecret(app.env, a.secret);
        delete a.tg_file_ids;
      }
      return json(data);
    }

    if (m === 'POST' && id && sub === 'deliver') {
      const b = await body(request);
      const secretText = String(b.secret || '').trim();
      const cur = await db.prepare('SELECT * FROM accounts WHERE id = ?').bind(toInt(id)).first();
      if (!cur || cur.status !== 'sold' || cur.delivered_at) throw new HttpError(400, 'Acc không ở trạng thái chờ giao');
      const finalSecret = secretText || (await openSecret(app.env, cur.secret));
      if (!finalSecret) throw new HttpError(400, 'Nhập thông tin đăng nhập để giao cho khách');
      const a = await db
        .prepare(`UPDATE accounts SET delivered_at = ?, secret = ? WHERE id = ? AND status = 'sold' AND delivered_at IS NULL RETURNING *`)
        .bind(now(), await sealSecret(app.env, finalSecret), cur.id)
        .first();
      if (!a) throw new HttpError(409, 'Acc vừa được giao bởi thao tác khác');
      const r = await notifyUser(app, a.buyer_id,
        `<b>Acc #${a.id} đã được giao</b>\n──────────────\n${esc(finalSecret)}\n──────────────\n` +
        `Hãy đổi mật khẩu và thông tin bảo mật ngay sau khi đăng nhập.` + (b.note ? `\n\nGhi chú: ${esc(b.note)}` : ''));
      await payAccCommission(app, a.id);
      return json({ ok: true, sent: !!r.ok });
    }

    if (m === 'POST' && id && sub === 'refund') {
      const b = await body(request);
      const cur = await db.prepare(`SELECT * FROM accounts WHERE id = ? AND status = 'sold' AND delivered_at IS NULL`).bind(toInt(id)).first();
      if (!cur) throw new HttpError(400, 'Chỉ hoàn được acc đã bán nhưng chưa giao');
      // Điều kiện buyer_id + sold_at đảm bảo chỉ hoàn đúng lần bán này, một lần duy nhất; acc chuyển sang ẩn để admin kiểm tra lại
      const done = await db
        .prepare(`UPDATE accounts SET status = 'hidden', buyer_id = NULL, sold_price = NULL, sold_at = NULL, bot_id = 0,
                    commission = 0, commission_paid = 0, delivered_at = NULL
                  WHERE id = ? AND status = 'sold' AND delivered_at IS NULL AND buyer_id = ? AND sold_at = ?`)
        .bind(cur.id, cur.buyer_id, cur.sold_at)
        .run();
      if (!done.meta.changes) throw new HttpError(409, 'Acc vừa được xử lý bởi thao tác khác');
      await changeBalance(db, cur.buyer_id, cur.sold_price, { type: 'refund', ref: `acc:${cur.id}`, note: b.note || 'Hoàn tiền mua acc' });
      await notifyUser(app, cur.buyer_id,
        `Đơn mua acc <b>#${cur.id}</b> đã được hoàn <b>${money(cur.sold_price)}</b> vào số dư.` + (b.note ? `\nLý do: ${esc(b.note)}` : ''));
      return json({ ok: true });
    }

    const b = m === 'DELETE' ? {} : await body(request);
    const imageList = (Array.isArray(b.images) ? b.images : []).filter((x) => typeof x === 'string' && /^(https:\/\/|acc\/)/.test(x)).slice(0, 10);
    const images = JSON.stringify(imageList);
    const status = b.status === 'hidden' ? 'hidden' : 'available';
    const delivery = b.delivery === 'manual' ? 'manual' : 'auto';
    if (m === 'POST' && !id) {
      if (!toInt(b.game_id)) throw new HttpError(400, 'Chọn game');
      if (toInt(b.price) <= 0) throw new HttpError(400, 'Nhập giá bán');
      if (delivery === 'auto' && !String(b.secret || '').trim()) throw new HttpError(400, 'Acc giao tự động cần có thông tin đăng nhập');
      return json(await db.prepare(`INSERT INTO accounts (game_id, title, info, description, secret, price, cost, images, status, delivery, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING id`)
        .bind(toInt(b.game_id), b.title || '', b.info || '', b.description || '', await sealSecret(app.env, String(b.secret || '').trim()),
          toInt(b.price), toInt(b.cost), images, status, delivery, now()).first());
    }
    if (m === 'PUT' && id) {
      const old = await db.prepare('SELECT * FROM accounts WHERE id = ?').bind(toInt(id)).first();
      if (!old) throw new HttpError(404, 'Không tìm thấy acc');
      const sold = old.status === 'sold';
      if (!sold && delivery === 'auto' && !String(b.secret || '').trim()) throw new HttpError(400, 'Acc giao tự động cần có thông tin đăng nhập');
      // Form hiển thị chuỗi báo lỗi khi không giải mã được: giữ nguyên bản mã hóa cũ thay vì ghi đè
      const keepSecret = String(b.secret || '').startsWith('[Không giải mã được');
      const secret = keepSecret ? old.secret : await sealSecret(app.env, String(b.secret || '').trim());
      // Acc đã bán giữ nguyên trạng thái và giá; đổi ảnh thì xóa cache file_id của Telegram
      const fileIds = old.images === images ? old.tg_file_ids : null;
      await db.prepare(`UPDATE accounts SET game_id=?, title=?, info=?, description=?, secret=?, price=?, cost=?, images=?, tg_file_ids=?,
          status=?, delivery=? WHERE id = ?`)
        .bind(toInt(b.game_id), b.title || '', b.info || '', b.description || '', secret,
          sold ? old.price : toInt(b.price), toInt(b.cost), images, fileIds, sold ? 'sold' : status, sold ? old.delivery : delivery, old.id).run();
      if (app.env.BUCKET) await deleteImages(app, safeJson(old.images, []).filter((k) => !imageList.includes(k)));
      return json({ ok: true });
    }
    if (m === 'DELETE' && id) {
      const old = await db.prepare(`DELETE FROM accounts WHERE id = ? AND NOT (status = 'sold' AND delivered_at IS NULL) RETURNING images`)
        .bind(toInt(id)).first();
      if (!old) throw new HttpError(400, 'Không xóa được: acc đang chờ giao cho khách, hãy giao hoặc hoàn tiền trước');
      if (app.env.BUCKET) await deleteImages(app, safeJson(old.images, []));
      return json({ ok: true });
    }
  }

  if (res === 'upload' && m === 'POST') {
    if (!app.env.BUCKET) throw new HttpError(500, 'Chưa gắn R2 bucket (binding BUCKET). Có thể dán link ảnh thay thế.');
    const form = await request.formData();
    const keys = [];
    for (const f of form.getAll('file').slice(0, 10)) {
      if (typeof f === 'string') continue;
      if (!/^image\/(jpeg|png|webp|gif)$/.test(f.type)) throw new HttpError(400, `${f.name}: chỉ nhận ảnh JPG, PNG, WEBP`);
      if (f.size > 8 * 1024 * 1024) throw new HttpError(400, `${f.name}: ảnh quá 8MB`);
      const ext = f.type.split('/')[1].replace('jpeg', 'jpg');
      const prefix = url.searchParams.get('kind') === 'brand' ? 'brand' : 'acc';
      const key = `${prefix}/${Date.now().toString(36)}-${randomToken(6)}.${ext}`;
      await app.env.BUCKET.put(key, f.stream(), { httpMetadata: { contentType: f.type } });
      keys.push(key);
    }
    return json({ keys });
  }

  // ------------------------------------------------------------ topups
  if (res === 'topups') {
    if (m === 'GET') {
      const status = url.searchParams.get('status') || '';
      const q = (url.searchParams.get('q') || '').trim();
      const where = ['1=1'];
      const args = [];
      if (status) where.push('t.status = ?'), args.push(status);
      if (q) where.push('(t.user_id = ? OR t.content LIKE ? OR t.reference LIKE ?)'), args.push(toInt(q, -1), `%${q}%`, `%${q}%`);
      return json(await paged(db,
        `SELECT t.id, t.sepay_id, t.user_id, t.amount, t.bonus, t.content, t.gateway, t.account_number, t.reference, t.status, t.created_at,
          ${USER_COLS} FROM topups t ${USER_JOIN('t.user_id')} WHERE ${where.join(' AND ')} ORDER BY t.id DESC`,
        `SELECT COUNT(*) AS n FROM topups t WHERE ${where.join(' AND ')}`, args, pageOf(url)));
    }
    if (m === 'POST' && id && sub === 'assign') {
      const b = await body(request);
      const r = await creditTopup(app, toInt(id), toInt(b.user_id));
      if (!r.ok) throw new HttpError(400, r.msg);
      return json(r);
    }
    if (m === 'POST' && id && sub === 'ignore') {
      await db.prepare(`UPDATE topups SET status = 'ignored' WHERE id = ? AND status = 'unmatched'`).bind(toInt(id)).run();
      return json({ ok: true });
    }
  }

  // ------------------------------------------------------------ users
  if (res === 'users') {
    if (m === 'GET' && !id) {
      const q = (url.searchParams.get('q') || '').replace(/^@/, '').trim();
      const bot = url.searchParams.get('bot');
      const sort = { balance: 'u.balance DESC', spent: 'u.total_spent DESC', topup: 'u.total_topup DESC', commission: 'u.commission_total DESC' }[url.searchParams.get('sort')] || 'u.last_seen DESC';
      const where = ['1=1'];
      const args = [];
      if (q) where.push('(u.id = ? OR u.tg_id = ? OR u.username LIKE ? OR u.first_name LIKE ?)'), args.push(toInt(q, -1), toInt(q, -1), `%${q}%`, `%${q}%`);
      if (bot !== null && bot !== '') where.push('u.bot_id = ?'), args.push(toInt(bot));
      return json(await paged(db,
        `SELECT u.id, u.tg_id, u.bot_id, u.username, u.first_name, u.balance, u.total_topup, u.total_spent, u.commission_total,
          u.banned, u.created_at, u.last_seen, (u.api_key IS NOT NULL) AS has_api, b.username AS bot_username
         FROM users u LEFT JOIN bots b ON b.id = u.bot_id WHERE ${where.join(' AND ')} ORDER BY ${sort}`,
        `SELECT COUNT(*) AS n FROM users u WHERE ${where.join(' AND ')}`, args, pageOf(url)));
    }
    if (m === 'GET' && id) {
      const uid = toInt(id);
      const user = await db.prepare('SELECT u.*, b.username AS bot_username FROM users u LEFT JOIN bots b ON b.id = u.bot_id WHERE u.id = ?').bind(uid).first();
      if (!user) throw new HttpError(404, 'Không tìm thấy người dùng');
      delete user.state_data;
      user.api_key = user.api_key ? `${user.api_key.slice(0, 7)}…` : null;
      const [logs, orders, accs, bots] = await db.batch([
        db.prepare('SELECT * FROM balance_logs WHERE user_id = ? ORDER BY id DESC LIMIT 50').bind(uid),
        db.prepare(`SELECT * FROM orders WHERE user_id = ? AND status != 'pending_pay' ORDER BY id DESC LIMIT 30`).bind(uid),
        db.prepare(`SELECT id, title, sold_price, sold_at, delivered_at FROM accounts WHERE buyer_id = ? ORDER BY sold_at DESC LIMIT 30`).bind(uid),
        db.prepare('SELECT id, username, markup, active FROM bots WHERE owner_id = ?').bind(uid),
      ]);
      return json({ user, logs: logs.results, orders: orders.results, accounts: accs.results, bots: bots.results });
    }
    if (m === 'POST' && id && sub === 'balance') {
      const b = await body(request);
      const amount = toInt(b.amount);
      if (!amount) throw new HttpError(400, 'Nhập số tiền');
      const bal = await changeBalance(db, toInt(id), amount, { type: 'admin', note: b.note || 'Admin điều chỉnh' });
      if (bal === null) throw new HttpError(400, 'Số dư không đủ để trừ');
      if (b.notify) {
        await notifyUser(app, toInt(id), `Số dư được điều chỉnh ${amount > 0 ? '+' : ''}${money(amount)}` +
          `${b.note ? `\nLý do: ${esc(b.note)}` : ''}\nSố dư hiện tại: <b>${money(bal)}</b>`);
      }
      return json({ ok: true, balance: bal });
    }
    if (m === 'POST' && id && sub === 'ban') {
      const b = await body(request);
      await db.prepare('UPDATE users SET banned = ? WHERE id = ?').bind(b.banned ? 1 : 0, toInt(id)).run();
      return json({ ok: true });
    }
    if (m === 'POST' && id && sub === 'revoke-api') {
      await db.prepare('UPDATE users SET api_key = NULL WHERE id = ?').bind(toInt(id)).run();
      return json({ ok: true });
    }
    if (m === 'POST' && id && sub === 'message') {
      const b = await body(request);
      const r = await notifyUser(app, toInt(id), String(b.text || ''));
      if (!r.ok) throw new HttpError(400, r.description || 'Gửi thất bại');
      return json({ ok: true });
    }
  }

  // ------------------------------------------------------------ bot con
  if (res === 'bots') {
    if (m === 'GET') {
      return json((await db.prepare(`SELECT b.id, b.owner_id, b.username, b.name, b.markup, b.support_zalo, b.active, b.created_at,
          o.tg_id AS owner_tg, o.username AS owner_username, o.first_name AS owner_name,
          (SELECT COUNT(*) FROM users WHERE bot_id = b.id) AS users,
          (SELECT COALESCE(SUM(balance),0) FROM users WHERE bot_id = b.id) AS user_balance,
          (SELECT COALESCE(SUM(price_total - refunded),0) FROM orders WHERE bot_id = b.id AND status NOT IN ('pending_pay','failed')) AS revenue,
          (SELECT COALESCE(SUM(commission),0) FROM orders WHERE bot_id = b.id AND commission_paid = 1) +
          (SELECT COALESCE(SUM(commission),0) FROM accounts WHERE bot_id = b.id AND commission_paid = 1) AS commission
        FROM bots b LEFT JOIN users o ON o.id = b.owner_id ORDER BY b.id DESC`).all()).results);
    }
    if (m === 'PUT' && id) {
      const b = await body(request);
      const markup = Number(b.markup);
      if (!Number.isFinite(markup) || markup < 0 || markup > 1000) throw new HttpError(400, '% lãi không hợp lệ');
      await db.prepare('UPDATE bots SET markup = ?, active = ? WHERE id = ?').bind(markup, b.active ? 1 : 0, toInt(id)).run();
      return json({ ok: true });
    }
    if (m === 'DELETE' && id) {
      const bot = await db.prepare('SELECT * FROM bots WHERE id = ?').bind(toInt(id)).first();
      if (!bot) throw new HttpError(404, 'Không tìm thấy bot');
      const bal = await db.prepare('SELECT COALESCE(SUM(balance),0) AS s FROM users WHERE bot_id = ?').bind(bot.id).first();
      if (bal.s > 0) throw new HttpError(400, `Khách của bot còn ${money(bal.s)} số dư. Hãy tạm dừng bot thay vì xóa.`);
      await createTg(bot.token).call('deleteWebhook');
      await db.prepare('DELETE FROM bots WHERE id = ?').bind(bot.id).run();
      return json({ ok: true });
    }
  }

  // ------------------------------------------------------------ rút hoa hồng
  if (res === 'withdrawals') {
    if (m === 'GET') {
      const status = url.searchParams.get('status') || '';
      const where = status ? 'w.status = ?' : '1=1';
      return json(await paged(db,
        `SELECT w.*, ${USER_COLS} FROM withdrawals w ${USER_JOIN('w.user_id')} WHERE ${where} ORDER BY (w.status = 'pending') DESC, w.id DESC`,
        `SELECT COUNT(*) AS n FROM withdrawals w WHERE ${where}`, status ? [status] : [], pageOf(url)));
    }
    if (m === 'POST' && id && (sub === 'approve' || sub === 'reject')) {
      const b = await body(request);
      const w = await db
        .prepare(`UPDATE withdrawals SET status = ?, note = ?, updated_at = ? WHERE id = ? AND status = 'pending' RETURNING *`)
        .bind(sub === 'approve' ? 'paid' : 'rejected', b.note || '', now(), toInt(id))
        .first();
      if (!w) throw new HttpError(400, 'Lệnh rút đã được xử lý');
      if (sub === 'reject') {
        await changeBalance(db, w.user_id, w.amount, { type: 'withdraw', ref: `wd:${w.id}`, note: 'Hoàn lệnh rút bị từ chối' });
      }
      await notifyUser(app, w.user_id, sub === 'approve'
        ? `Lệnh rút <b>#${w.id}</b> ${money(w.amount)} đã được chuyển khoản.` + (b.note ? `\nGhi chú: ${esc(b.note)}` : '')
        : `Lệnh rút <b>#${w.id}</b> bị từ chối, ${money(w.amount)} đã hoàn vào số dư.` + (b.note ? `\nLý do: ${esc(b.note)}` : ''));
      return json({ ok: true });
    }
  }

  // ------------------------------------------------------------ broadcast (gửi theo từng đợt từ trình duyệt)
  if (res === 'broadcast' && m === 'POST') {
    const b = await body(request);
    const text = String(b.text || '').trim();
    if (!text) throw new HttpError(400, 'Nhập nội dung');
    const photo = String(b.photo || '').trim();
    if (photo && !/^https:\/\/\S+$/.test(photo)) throw new HttpError(400, 'Link ảnh phải bắt đầu bằng https://');
    const offset = Math.max(0, toInt(b.offset));
    const scope = b.scope === 'all' ? '' : 'AND bot_id = 0';
    const total = (await db.prepare(`SELECT COUNT(*) AS n FROM users WHERE banned = 0 ${scope}`).first()).n;
    const { results } = await db.prepare(`SELECT id, tg_id, bot_id FROM users WHERE banned = 0 ${scope} ORDER BY id LIMIT 25 OFFSET ?`).bind(offset).all();
    let sent = 0;
    let failed = 0;
    for (const u of results) {
      const tg = await tgFor(app, u.bot_id);
      const r = photo ? await tg.photo(u.tg_id, photo, text) : await tg.send(u.tg_id, text);
      r.ok ? sent++ : failed++;
    }
    const next = offset + results.length;
    return json({ sent, failed, next: next < total ? next : null, total });
  }

  // ------------------------------------------------------------ mã quà tặng
  if (res === 'giftcodes') {
    if (m === 'GET') {
      return json((await db.prepare(`SELECT g.*, (SELECT COALESCE(SUM(1),0) FROM giftcode_uses u WHERE u.code_id = g.id) AS uses
        FROM giftcodes g ORDER BY g.id DESC LIMIT 200`).all()).results);
    }
    const b = m === 'DELETE' ? {} : await body(request);
    if (m === 'POST') {
      const code = (String(b.code || '').trim() || randomToken(4)).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
      const amount = toInt(b.amount);
      const maxUses = Math.max(1, toInt(b.max_uses, 1));
      if (code.length < 4) throw new HttpError(400, 'Mã cần ít nhất 4 ký tự (chữ không dấu, số)');
      if (amount <= 0 || amount > 100000000) throw new HttpError(400, 'Số tiền không hợp lệ');
      const exp = b.expires_at ? Math.floor(new Date(`${b.expires_at}T23:59:59+07:00`).getTime() / 1000) : null;
      const dup = await db.prepare('SELECT id FROM giftcodes WHERE code = ?').bind(code).first();
      if (dup) throw new HttpError(400, 'Mã này đã tồn tại');
      return json(await db.prepare('INSERT INTO giftcodes (code, amount, max_uses, expires_at, active, note, created_at) VALUES (?,?,?,?,1,?,?) RETURNING *')
        .bind(code, amount, maxUses, Number.isFinite(exp) ? exp : null, String(b.note || '').slice(0, 200), now()).first());
    }
    if (m === 'PUT' && id) {
      await db.prepare('UPDATE giftcodes SET active = ? WHERE id = ?').bind(b.active ? 1 : 0, toInt(id)).run();
      return json({ ok: true });
    }
    if (m === 'DELETE' && id) {
      await db.batch([
        db.prepare('DELETE FROM giftcodes WHERE id = ?').bind(toInt(id)),
        db.prepare('DELETE FROM giftcode_uses WHERE code_id = ?').bind(toInt(id)),
      ]);
      return json({ ok: true });
    }
  }

  // ------------------------------------------------------------ nhật ký
  if (res === 'audit' && m === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    const where = q ? '(action LIKE ? OR target LIKE ? OR detail LIKE ?)' : '1=1';
    const args = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [];
    return json(await paged(db, `SELECT * FROM audit_logs WHERE ${where} ORDER BY id DESC`,
      `SELECT COUNT(*) AS n FROM audit_logs WHERE ${where}`, args, pageOf(url)));
  }

  // ------------------------------------------------------------ xuất CSV (mở được bằng Excel)
  if (res === 'export' && m === 'GET') {
    const days = Math.min(3650, Math.max(1, toInt(url.searchParams.get('days'), 30)));
    const since = now() - days * 86400;
    const sets = {
      orders: [`SELECT o.id, o.created_at, o.user_id, u.tg_id, u.username, o.bot_id, o.source, o.service_name, o.link, o.quantity,
                o.price_total, o.refunded, o.commission, o.cost_total, o.status, o.upstream_code
                FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.status != 'pending_pay' AND o.created_at >= ? ORDER BY o.id DESC LIMIT 20000`,
        ['Mã đơn', 'Thời gian', 'Mã khách', 'Telegram ID', 'Username', 'Bot', 'Nguồn', 'Dịch vụ', 'Link', 'Số lượng', 'Thanh toán', 'Đã hoàn', 'Hoa hồng', 'Giá vốn', 'Trạng thái', 'Mã API']],
      topups: [`SELECT t.id, t.created_at, t.user_id, u.tg_id, u.username, t.amount, t.bonus, t.content, t.gateway, t.reference, t.status
                FROM topups t LEFT JOIN users u ON u.id = t.user_id WHERE t.created_at >= ? ORDER BY t.id DESC LIMIT 20000`,
        ['Mã', 'Thời gian', 'Mã khách', 'Telegram ID', 'Username', 'Số tiền', 'Khuyến mãi', 'Nội dung', 'Ngân hàng', 'Mã GD', 'Trạng thái']],
      users: [`SELECT id, created_at, tg_id, username, first_name, bot_id, balance, total_topup, total_spent, commission_total, banned
               FROM users WHERE created_at >= ? ORDER BY id DESC LIMIT 20000`,
        ['Mã khách', 'Ngày tham gia', 'Telegram ID', 'Username', 'Tên', 'Bot', 'Số dư', 'Đã nạp', 'Đã dùng', 'Hoa hồng', 'Bị khóa']],
      accounts: [`SELECT a.id, a.created_at, g.name, a.title, a.price, a.cost, a.status, a.delivery, a.buyer_id, a.sold_price, a.sold_at, a.commission
                  FROM accounts a LEFT JOIN games g ON g.id = a.game_id WHERE a.created_at >= ? ORDER BY a.id DESC LIMIT 20000`,
        ['Mã acc', 'Ngày đăng', 'Game', 'Tiêu đề', 'Giá bán', 'Giá nhập', 'Trạng thái', 'Cách giao', 'Người mua', 'Giá đã bán', 'Ngày bán', 'Hoa hồng']],
    };
    const set = sets[id];
    if (!set) throw new HttpError(404, 'Không có loại dữ liệu này');
    const { results } = await db.prepare(set[0]).bind(since).all();
    const cell = (v, k) => {
      if (v === null || v === undefined) return '';
      if (/_at$/.test(k) && typeof v === 'number') v = new Date((v + VN) * 1000).toISOString().slice(0, 16).replace('T', ' ');
      const t = String(v);
      // Chặn công thức Excel độc hại trong dữ liệu do khách nhập
      const safe = /^[=+\-@\t\r]/.test(t) && typeof v !== 'number' ? `'${t}` : t;
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const lines = [set[1].join(','), ...results.map((r) => Object.entries(r).map(([k, v]) => cell(v, k)).join(','))];
    return new Response(`\ufeff${lines.join('\r\n')}`, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${id}-${new Date().toISOString().slice(0, 10)}.csv"`,
        'cache-control': 'no-store',
      },
    });
  }

  // ------------------------------------------------------------ settings & telegram
  if (res === 'settings') {
    if (m === 'GET') {
      return json({ settings: app.settings, base_url: app.baseUrl, has_bucket: !!app.env.BUCKET, has_data_key: !!app.env.DATA_KEY });
    }
    if (m === 'PUT') {
      const b = await body(request);
      delete b.webhook_secret;
      delete b.last_sync_at;
      delete b.bot_username;
      if (b.markup_type !== undefined && !['per1k', 'percent'].includes(b.markup_type)) throw new HttpError(400, 'Kiểu chênh lệch không hợp lệ');
      delete b.catalog_sync_at;
      for (const k of ['reseller_rate', 'child_min_markup', 'child_max_markup', 'topup_bonus_percent', 'markup_value']) {
        if (k in b && !(Number(b[k]) >= 0)) throw new HttpError(400, `Giá trị ${k} không hợp lệ`);
      }
      if (Number(b.child_max_markup) < Number(b.child_min_markup)) throw new HttpError(400, 'Lãi tối đa phải lớn hơn lãi tối thiểu');
      if (b.logo_style !== undefined && !['monogram', 'controller', 'shield', 'bolt'].includes(b.logo_style)) throw new HttpError(400, 'Kiểu logo không hợp lệ');
      for (const k of ['accent_color', 'accent_color2']) {
        if (b[k] !== undefined && !/^#[0-9a-fA-F]{6}$/.test(b[k])) throw new HttpError(400, 'Màu phải dạng #RRGGBB');
      }
      const IMG = /^(https:\/\/\S+|brand\/[\w.-]+|\/assets\/brand\/[\w.-]+)$/;
      if (b.logo !== undefined && b.logo && !IMG.test(b.logo)) throw new HttpError(400, 'Logo không hợp lệ');
      if (b.hero_art !== undefined && b.hero_art && !IMG.test(b.hero_art)) throw new HttpError(400, 'Logo lớn không hợp lệ');
      if (b.hero_image !== undefined && b.hero_image && !/^(https:\/\/\S+|brand\/[\w.-]+)$/.test(b.hero_image)) throw new HttpError(400, 'Ảnh banner không hợp lệ');
      for (const k of ['logo', 'hero_art', 'hero_image']) {
        if (b[k] !== undefined && app.env.BUCKET && app.settings[k]?.startsWith('brand/') && b[k] !== app.settings[k]) {
          await app.env.BUCKET.delete(app.settings[k]).catch(() => {});
        }
      }
      if (b.topup_prefix !== undefined) {
        b.topup_prefix = String(b.topup_prefix).toUpperCase().replace(/[^A-Z]/g, '');
        if (b.topup_prefix.length < 2) throw new HttpError(400, 'Tiền tố nạp tiền cần ít nhất 2 chữ cái (không dấu, không số)');
      }
      await saveSettings(db, b);
      return json({ ok: true });
    }
  }

  if (res === 'telegram') {
    if (id === 'setup' && m === 'POST') {
      const s = await loadSettings(db);
      if (!s.bot_token) throw new HttpError(400, 'Nhập Bot token trước');
      if (!app.baseUrl.startsWith('https://')) {
        throw new HttpError(400, 'Telegram chỉ nhận webhook HTTPS. Bot token đã được lưu — hãy deploy lên Cloudflare Pages rồi mở admin bằng địa chỉ https://… và bấm lại "Lưu & kết nối bot".');
      }
      const tg = createTg(s.bot_token);
      const me = await tg.call('getMe');
      if (!me.ok) throw new HttpError(400, `Token không hợp lệ: ${me.description}`);
      const secret = s.webhook_secret || randomToken(16);
      await saveSettings(db, { bot_username: me.result.username, webhook_secret: secret });
      const wh = await tg.call('setWebhook', {
        url: `${app.baseUrl}/api/telegram/webhook`,
        secret_token: secret,
        allowed_updates: ['message', 'callback_query'],
        max_connections: 40,
      });
      if (!wh.ok) throw new HttpError(400, `Không đặt được webhook: ${wh.description}`);
      await tg.call('setMyCommands', { commands: [...BOT_COMMANDS, { command: 'daily', description: 'Đại lý, API và bot con' }] });
      // Mô tả hiển thị trên trang hồ sơ bot và màn hình trước khi bấm Start
      await tg.call('setMyShortDescription', { short_description: String(s.tagline || s.shop_name).slice(0, 120) });
      await tg.call('setMyDescription', { description: `${s.shop_name}\n\n${s.tagline || ''}\n\nBấm Start để mở menu.`.slice(0, 512) });
      return json({ ok: true, username: me.result.username });
    }
    if (id === 'info') {
      if (!app.settings.bot_token) return json({ configured: false });
      const info = await app.rootTg.call('getWebhookInfo');
      return json({ configured: true, username: app.settings.bot_username, webhook: info.result || null });
    }
  }

  throw new HttpError(404, 'Không tìm thấy');
}

// ====================================================================

function serviceFields(b, settings) {
  const mode = b.mode === 'manual' ? 'manual' : 'api';
  const types = ['quantity', 'days', 'minutes', 'comment', 'fixed', 'verify'];
  const input = types.includes(b.input_type) ? b.input_type : 'quantity';
  if (!String(b.name || '').trim()) throw new HttpError(400, 'Nhập tên dịch vụ');
  if (mode === 'api' && !b.server_order) throw new HttpError(400, 'Dịch vụ API cần mã server (server_order)');
  const auto = b.auto_price === true || b.auto_price === 1 || b.auto_price === '1';
  const cost = Number(b.cost) || 0;
  if (auto && !(cost > 0)) throw new HttpError(400, 'Giá tự động cần có giá vốn');
  const price = auto ? ruledPrice(settings, cost) : Number(b.price);
  if (!(price > 0)) throw new HttpError(400, 'Giá bán phải lớn hơn 0');
  const apiPrice = Number(b.api_price) || 0;
  if (apiPrice < 0) throw new HttpError(400, 'Giá đại lý không hợp lệ');
  const min = Math.max(1, toInt(b.min_qty, 1));
  const max = Math.max(min, toInt(b.max_qty, min));
  const emin = Math.max(1, toInt(b.extra_min, 1));
  const emax = Math.max(emin, toInt(b.extra_max, emin));
  const reactions = String(b.reactions || '').split(',').map((x) => x.trim().toLowerCase()).filter((x) => /^[a-z]{2,10}$/.test(x)).join(',');
  return [toInt(b.category_id) || null, String(b.name).trim(), b.description || '', mode, input, String(b.server_order || '').trim(),
    price, cost, apiPrice, min, max, emin, emax, reactions, b.active === false ? 0 : 1, toInt(b.sort), auto ? 1 : 0];
}

function cleanDetail(d) {
  return String(d || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1500);
}

async function deleteImages(app, keys) {
  const own = keys.filter((k) => typeof k === 'string' && k.startsWith('acc/'));
  if (own.length) await app.env.BUCKET.delete(own).catch(() => {});
}

async function paged(db, sql, countSql, args, page) {
  const [rows, count] = await db.batch([
    db.prepare(`${sql} LIMIT ${PAGE} OFFSET ${page * PAGE}`).bind(...args),
    db.prepare(countSql).bind(...args),
  ]);
  return { items: rows.results, total: count.results[0]?.n || 0, page, page_size: PAGE };
}

async function stats(db, days) {
  const t = now();
  const todayStart = Math.floor((t + VN) / 86400) * 86400 - VN;
  const since = todayStart - (days - 1) * 86400;
  const monthStart = (() => {
    const d = new Date((t + VN) * 1000);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000 - VN;
  })();
  const day = (col) => `date(${col} + ${VN}, 'unixepoch')`;
  // Doanh thu hệ thống = phần khách trả sau hoàn tiền, trừ hoa hồng bot con (tính theo tỷ lệ phần không hoàn)
  const kept = `(price_total - refunded) * 1.0 / MAX(price_total, 1)`;
  const orderRev = `SUM(base_total * ${kept})`;
  const orderCost = `SUM(cost_total * ${kept})`;
  const valid = `status NOT IN ('pending_pay','failed')`;
  const accRev = 'SUM(sold_price - commission)';

  const q = (sql, ...a) => db.prepare(sql).bind(...a);
  const r = await db.batch([
    q(`SELECT ${day('created_at')} AS d, SUM(amount) AS v FROM topups WHERE status = 'credited' AND created_at >= ? GROUP BY d`, since),
    q(`SELECT ${day('created_at')} AS d, ${orderRev} AS v, ${orderCost} AS c, COUNT(*) AS n FROM orders WHERE ${valid} AND created_at >= ? GROUP BY d`, since),
    q(`SELECT ${day('sold_at')} AS d, ${accRev} AS v, SUM(cost) AS c, COUNT(*) AS n FROM accounts WHERE status = 'sold' AND sold_at >= ? GROUP BY d`, since),
    q(`SELECT ${day('created_at')} AS d, COUNT(*) AS v FROM users WHERE created_at >= ? GROUP BY d`, since),
    q(`SELECT service_name AS name, ${orderRev} AS v, COUNT(*) AS n FROM orders WHERE ${valid} AND created_at >= ? GROUP BY service_name ORDER BY v DESC LIMIT 8`, since),
    q(`SELECT * FROM (
        SELECT 'order' AS kind, o.id, o.created_at AS t, o.price_total AS amount, o.service_name AS label, o.status, u.first_name, u.username
          FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.status != 'pending_pay' ORDER BY o.id DESC LIMIT 8)
      UNION ALL SELECT * FROM (
        SELECT 'topup', t.id, t.created_at, t.amount, t.content, t.status, u.first_name, u.username
          FROM topups t LEFT JOIN users u ON u.id = t.user_id WHERE t.status != 'ignored' ORDER BY t.id DESC LIMIT 8)
      UNION ALL SELECT * FROM (
        SELECT 'acc', a.id, a.sold_at, a.sold_price, a.title, CASE WHEN a.delivered_at IS NULL THEN 'pending' ELSE 'sold' END, u.first_name, u.username
          FROM accounts a LEFT JOIN users u ON u.id = a.buyer_id WHERE a.status = 'sold' ORDER BY a.sold_at DESC LIMIT 8)
      ORDER BY t DESC LIMIT 12`),
    q(`SELECT
        (SELECT COALESCE(SUM(amount),0) FROM topups WHERE status='credited' AND created_at >= ?1) AS topup_today,
        (SELECT COALESCE(SUM(amount),0) FROM topups WHERE status='credited' AND created_at >= ?2) AS topup_month,
        (SELECT COALESCE(${orderRev},0) FROM orders WHERE ${valid} AND created_at >= ?1) AS order_today,
        (SELECT COALESCE(${accRev},0) FROM accounts WHERE status='sold' AND sold_at >= ?1) AS acc_today,
        (SELECT COALESCE(SUM(balance),0) FROM users) AS user_balance,
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM users WHERE created_at >= ?1) AS users_today,
        (SELECT COUNT(*) FROM orders WHERE status = 'manual') AS manual_queue,
        (SELECT COUNT(*) FROM orders WHERE status = 'review') AS review_queue,
        (SELECT COUNT(*) FROM orders WHERE status = 'processing') AS processing,
        (SELECT COUNT(*) FROM accounts WHERE status = 'available') AS acc_available,
        (SELECT COUNT(*) FROM accounts WHERE status = 'sold' AND delivered_at IS NULL) AS acc_pending,
        (SELECT COUNT(*) FROM topups WHERE status = 'unmatched') AS topup_unmatched,
        (SELECT COUNT(*) FROM withdrawals WHERE status = 'pending') AS withdraw_pending,
        (SELECT COUNT(*) FROM bots WHERE active = 1) AS bots_active,
        (SELECT COALESCE(SUM(commission),0) FROM orders WHERE commission_paid = 1 AND created_at >= ?2) +
        (SELECT COALESCE(SUM(commission),0) FROM accounts WHERE commission_paid = 1 AND sold_at >= ?2) AS commission_month`, todayStart, monthStart),
  ]);

  const labels = [];
  for (let i = 0; i < days; i++) labels.push(new Date((since + VN + i * 86400) * 1000).toISOString().slice(0, 10));
  const fill = (rows, key = 'v') => {
    const map = Object.fromEntries(rows.map((x) => [x.d, Number(x[key]) || 0]));
    return labels.map((d) => Math.round(map[d] || 0));
  };
  const [tp, od, ac, us, top, recent, kpi] = r.map((x) => x.results);
  const orderRevS = fill(od);
  const accRevS = fill(ac);
  const orderCostS = fill(od, 'c');
  const accCostS = fill(ac, 'c');
  const profit = labels.map((_, i) => orderRevS[i] - orderCostS[i] + accRevS[i] - accCostS[i]);
  const k = kpi[0];
  for (const key of Object.keys(k)) k[key] = Math.round(Number(k[key]) || 0);
  return {
    days,
    labels,
    series: { topup: fill(tp), order_revenue: orderRevS, acc_revenue: accRevS, profit, new_users: fill(us), orders: fill(od, 'n') },
    top_services: top.map((x) => ({ name: x.name, revenue: Math.round(x.v || 0), orders: x.n })),
    kpi: k,
    recent,
  };
}
