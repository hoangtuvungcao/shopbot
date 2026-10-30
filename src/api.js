// API đại lý theo chuẩn SMM panel v2: POST /api/v2 với key + action (JSON hoặc form).
// Tiền tính theo giá đại lý, trừ vào số dư của tài khoản sở hữu API key (khách của bot gốc).
import { json, toInt } from './util.js';
import { isPackage, placeOrder } from './orders.js';
import { accResellerPrice, resellerPrice, servicePricing } from './shop.js';
import { buyAccount } from './accounts.js';
import { openSecret } from './crypto.js';
import { safeJson } from './util.js';

const STATUS = {
  manual: 'Pending', review: 'Pending', processing: 'In progress', done: 'Completed', canceled: 'Canceled', failed: 'Canceled',
};

async function readBody(request) {
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/json')) return (await request.json().catch(() => ({}))) || {};
  if (type.includes('form')) return Object.fromEntries(await request.formData().catch(() => new FormData()));
  return {};
}

// API dùng key trong body (không cookie) nên cho phép gọi từ mọi web của đại lý
export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};
const out = (data, status = 200) => json(data, status, CORS);
const err = (error, status = 200) => out({ error }, status);

export async function handleApiV2(request, app) {
  if (app.settings.api_enabled !== '1') return err('API is disabled', 403);
  const b = await readBody(request);
  const key = String(b.key || '').trim();
  if (!key.startsWith('sk_')) return err('Invalid API key', 401);
  const user = await app.db.prepare('SELECT * FROM users WHERE api_key = ? AND bot_id = 0').bind(key).first();
  if (!user) return err('Invalid API key', 401);
  if (user.banned) return err('Account is banned', 403);

  switch (b.action) {
    case 'balance':
      return out({ balance: String(user.balance), currency: 'VND' });

    case 'services': {
      const { results } = await app.db
        .prepare(`SELECT s.*, c.name AS category FROM services s LEFT JOIN categories c ON c.id = s.category_id
                  WHERE s.active = 1 AND (c.active = 1 OR c.id IS NULL) ORDER BY c.sort, s.sort, s.id`)
        .all();
      return out(results.map((s) => ({
        service: s.id,
        name: s.name,
        type: { quantity: 'Default', days: 'Subscriptions', minutes: 'Custom Time', comment: 'Custom Comments', fixed: 'Package', verify: 'Package' }[s.input_type],
        category: s.category || '',
        rate: String(Math.round(resellerPrice(app.settings, s) * (isPackage(s) ? 1 : 1000) * 100) / 100),
        min: String(isPackage(s) ? 1 : s.min_qty),
        max: String(isPackage(s) ? 1 : s.max_qty),
        refill: false,
        cancel: false,
        reactions: s.reactions ? s.reactions.split(',') : undefined,
        description: s.description || '',
        category_id: s.category_id,
        input_type: s.input_type,
        extra_min: ['days', 'minutes'].includes(s.input_type) ? s.extra_min : undefined,
        extra_max: ['days', 'minutes'].includes(s.input_type) ? s.extra_max : undefined,
      })));
    }

    case 'add': {
      const s = await app.db.prepare('SELECT * FROM services WHERE id = ? AND active = 1').bind(toInt(b.service)).first();
      if (!s) return err('Incorrect service ID');
      const comments = typeof b.comments === 'string' ? b.comments.split(/\r?\n/).map((x) => x.trim()).filter(Boolean) : [];
      const draft = {
        link: String(b.link || '').trim(),
        qty: s.input_type === 'comment' ? comments.length : toInt(b.quantity),
        extra: s.input_type === 'days' ? toInt(b.days) : s.input_type === 'minutes' ? toInt(b.minutes) : undefined,
        comments: comments.join('\n') || undefined,
        reaction: b.reaction && String(s.reactions || '').split(',').includes(b.reaction) ? b.reaction : undefined,
        contact: s.input_type === 'verify' ? String(b.contact || b.phone || '').slice(0, 60) : undefined,
        note: b.note ? String(b.note).slice(0, 300) : undefined,
      };
      if (s.reactions && !draft.reaction) draft.reaction = s.reactions.split(',')[0];
      const r = await placeOrder(app, user.id, s, draft, servicePricing(app, s, { api: true }), 'api');
      if (!r.ok) return err(r.msg);
      return out({ order: r.order.id });
    }

    case 'status': {
      const ids = String(b.orders || b.order || '').split(',').map((x) => toInt(x)).filter((x) => x > 0).slice(0, 100);
      if (!ids.length) return err('Incorrect order ID');
      const { results } = await app.db
        .prepare(`SELECT * FROM orders WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`)
        .bind(user.id, ...ids)
        .all();
      const view = (o) => ({
        charge: String(o.price_total - o.refunded),
        start_count: String(o.start_count || 0),
        status: o.status === 'refunded' ? (o.refunded >= o.price_total ? 'Canceled' : 'Partial') : STATUS[o.status] || 'Pending',
        remains: String(Math.max(0, (o.quantity || 0) - (o.delivered || 0))),
        currency: 'VND',
      });
      if (!b.orders) {
        const o = results[0];
        return o ? out(view(o)) : err('Incorrect order ID');
      }
      const map = {};
      for (const id of ids) {
        const o = results.find((x) => x.id === id);
        map[id] = o ? view(o) : { error: 'Incorrect order ID' };
      }
      return out(map);
    }

    case 'profile':
      return out({ user_id: user.id, username: user.username || '', balance: String(user.balance), currency: 'VND' });

    case 'categories': {
      const { results } = await app.db
        .prepare(`SELECT c.id, c.name, COUNT(s.id) AS services FROM categories c JOIN services s ON s.category_id = c.id AND s.active = 1
                  WHERE c.active = 1 GROUP BY c.id ORDER BY c.sort, c.id`).all();
      return out(results);
    }

    // ---------------- acc game: để đại lý bán acc trên web riêng
    case 'accounts': {
      const game = toInt(b.game);
      const { results } = await app.db
        .prepare(`SELECT a.id, a.game_id, g.name AS game, a.title, a.info, a.description, a.price, a.images, a.delivery, a.created_at
                  FROM accounts a JOIN games g ON g.id = a.game_id AND g.active = 1
                  WHERE a.status = 'available' ${game ? 'AND a.game_id = ?' : ''} ORDER BY a.id DESC LIMIT 200`)
        .bind(...(game ? [game] : [])).all();
      const abs = (x) => (x.startsWith('http') ? x : `${app.baseUrl}/api/img/${x}`);
      return out(results.map((a) => ({
        account: a.id, game_id: a.game_id, game: a.game, title: a.title, info: a.info, description: a.description,
        price: String(accResellerPrice(app.settings, a)), delivery: a.delivery === 'manual' ? 'manual' : 'instant',
        images: safeJson(a.images, []).map(abs), created_at: a.created_at,
      })));
    }

    case 'buy_account': {
      app.channel = 'api';
      const r = await buyAccount(app, user, toInt(b.account), { api: true });
      if (!r.ok) return err(r.msg);
      return out({ account: r.acc.id, charge: String(r.price), balance: String(r.balance),
        status: r.pending ? 'Pending' : 'Delivered', login: r.pending ? null : r.secret });
    }

    case 'my_accounts': {
      const { results } = await app.db
        .prepare(`SELECT id, title, sold_price, sold_at, delivered_at, secret FROM accounts WHERE buyer_id = ? AND status = 'sold' ORDER BY sold_at DESC LIMIT 200`)
        .bind(user.id).all();
      const list = [];
      for (const a of results) {
        list.push({ account: a.id, title: a.title, charge: String(a.sold_price), status: a.delivered_at ? 'Delivered' : 'Pending',
          login: a.delivered_at ? await openSecret(app.env, a.secret) : null, bought_at: a.sold_at });
      }
      return out(list);
    }

    default:
      return err('Incorrect action');
  }
}
