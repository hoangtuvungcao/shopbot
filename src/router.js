import { ensureSchema } from './schema.js';
import { HttpError, json, loadSettings, now, safeJson, saveSettings } from './util.js';
import { createTg } from './telegram.js';
import { createUpstream } from './upstream.js';
import { handleUpdate } from './bot.js';
import { handleSepayWebhook } from './sepay.js';
import { handleAdmin } from './admin.js';
import { CORS, handleApiV2 } from './api.js';
import { handleMe } from './me.js';
import { isAuthed, login, logoutCookie } from './auth.js';
import { syncPending } from './orders.js';
import { syncCatalog } from './catalog.js';
import { cleanup as cleanStorage } from './storage.js';
import { ROOT, servicePricing } from './shop.js';

const SYNC_EVERY = 120; // giây
const LOGIN_WINDOW = 15 * 60;
const LOGIN_MAX_FAILS = 6;

export async function handle(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);

  try {
    if (!env.DB) throw new HttpError(500, 'Chưa gắn D1 database (binding DB)');

    // Ảnh acc: phục vụ trực tiếp từ R2, không cần DB
    if (parts[0] === 'img' && request.method === 'GET') return serveImage(context, parts.slice(1).join('/'));

    await ensureSchema(env.DB);
    const settings = await loadSettings(env.DB);
    const rootTg = createTg(settings.bot_token);
    const app = {
      db: env.DB,
      env,
      settings,
      rootTg,
      tg: rootTg,
      shop: ROOT,
      up: createUpstream(settings),
      baseUrl: url.origin,
    };

    // Không có cron trên Pages, nên tận dụng request đến để đồng bộ trạng thái đơn ở nền
    if (Number(settings.last_sync_at) < now() - SYNC_EVERY && parts[0] !== 'auth') {
      settings.last_sync_at = String(now());
      context.waitUntil(
        saveSettings(env.DB, { last_sync_at: settings.last_sync_at })
          .then(() => syncPending(app, 10))
          // Cập nhật danh sách gói và giá từ nhà cung cấp mỗi 6 giờ
          .then(() => (settings.api_key && Number(settings.catalog_sync_at) < now() - 6 * 3600 ? syncCatalog(app) : null))
          // Dọn ảnh rác / ảnh acc đã bán lâu ngày trên R2 mỗi 6 giờ
          .then(() => (env.BUCKET && Number(settings.r2_cleaned_at) < now() - 6 * 3600 ? cleanStorage(app) : null))
          .then(() => env.DB.batch([
            env.DB.prepare('DELETE FROM processed_updates WHERE created_at < ?').bind(now() - 3 * 86400),
            env.DB.prepare('DELETE FROM login_attempts WHERE at < ?').bind(now() - LOGIN_WINDOW),
            env.DB.prepare('DELETE FROM login_tokens WHERE created_at < ?').bind(now() - 86400),
            env.DB.prepare('DELETE FROM request_nonces WHERE created_at < ?').bind(now() - 86400),
          ]))
          .catch((e) => console.error('[sync]', e))
      );
    }

    const route = `${request.method} ${parts.slice(0, 2).join('/')}`;

    if (route === 'POST telegram/webhook') {
      const secret = request.headers.get('x-telegram-bot-api-secret-token') || '';
      const botId = parts[2] ? Number(parts[2]) : 0;
      if (botId) {
        const bot = await env.DB.prepare('SELECT * FROM bots WHERE id = ?').bind(botId).first();
        if (!bot || !secret || secret !== bot.secret) return json({ ok: false }, 401);
        app.shop = { ...bot, active: bot.active && settings.child_enabled === '1' };
        app.tg = createTg(bot.token);
      } else if (!settings.webhook_secret || secret !== settings.webhook_secret) {
        return json({ ok: false }, 401);
      }
      const update = await request.json().catch(() => null);
      // Luôn trả 200 để Telegram không gửi lại liên tục khi có lỗi
      if (update) await handleUpdate(update, app).catch((e) => console.error('[update]', e.stack || e));
      return json({ ok: true });
    }

    if (route === 'POST sepay/webhook') return await handleSepayWebhook(request, app);
    if (route === 'POST v2') return await handleApiV2(request, app);
    if (route === 'OPTIONS v2') return new Response(null, { status: 204, headers: CORS });

    if (route === 'POST auth/login') {
      const ip = request.headers.get('cf-connecting-ip') || 'local';
      const fails = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND at > ?')
        .bind(ip, now() - LOGIN_WINDOW).first();
      if (fails.n >= LOGIN_MAX_FAILS) throw new HttpError(429, 'Sai mật khẩu quá nhiều lần, thử lại sau 15 phút');
      const b = await request.json().catch(() => ({}));
      try {
        const cookie = await login(env, b.password);
        await env.DB.batch([
          env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip),
          env.DB.prepare('INSERT INTO audit_logs (action, target, detail, ip, created_at) VALUES (?,?,?,?,?)').bind('login', '', '', ip, now()),
        ]);
        return json({ ok: true }, 200, { 'set-cookie': cookie });
      } catch (e) {
        if (e.status === 401) await env.DB.prepare('INSERT INTO login_attempts (ip, at) VALUES (?, ?)').bind(ip, now()).run();
        throw e;
      }
    }
    if (route === 'POST auth/logout') return json({ ok: true }, 200, { 'set-cookie': logoutCookie() });
    if (route === 'GET auth/me') {
      return json({ authed: await isAuthed(request, env), shop: settings.shop_name, logo: logoUrl(settings.logo), hero_art: logoUrl(settings.hero_art), logo_style: settings.logo_style, accent: settings.accent_color, accent2: settings.accent_color2 });
    }

    if (parts[0] === 'me') return await handleMe(request, app, parts.slice(1), url);

    if (parts[0] === 'admin') {
      if (!(await isAuthed(request, env))) throw new HttpError(401, 'Phiên đăng nhập đã hết hạn');
      if (request.method !== 'GET' && !sameOrigin(request, url)) throw new HttpError(403, 'Yêu cầu không hợp lệ');
      const copy = request.method === 'GET' ? null : request.clone();
      const res = await handleAdmin(request, app, parts.slice(1), url);
      if (copy && res.ok) context.waitUntil(audit(env.DB, request, copy, parts.slice(1)).catch(() => {}));
      return res;
    }

    if (route === 'GET public/shop') return json(await publicShop(app), 200, { 'cache-control': 'public, max-age=30' });
    if (route === 'GET health') return json({ ok: true });
    throw new HttpError(404, 'Không tìm thấy');
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error('[api]', e.stack || e);
    return json({ error: 'Lỗi máy chủ, vui lòng thử lại' }, 500);
  }
}

function sameOrigin(request, url) {
  const origin = request.headers.get('origin');
  return !origin || origin === url.origin;
}

// Ảnh lưu vào cache của Cloudflare: khách xem nhiều lần không tốn lượt đọc R2
async function serveImage(context, key) {
  const { env, request } = context;
  if (!env.BUCKET || !/^(acc|brand)\/[\w.-]+$/.test(key)) return new Response('Not found', { status: 404 });
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const hit = cache && (await cache.match(request).catch(() => null));
  if (hit) return hit;
  const obj = await env.BUCKET.get(key);
  if (!obj) return new Response('Not found', { status: 404, headers: { 'cache-control': 'public, max-age=300' } });
  const res = new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType || 'image/jpeg',
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
  if (cache) context.waitUntil(cache.put(request, res.clone()).catch(() => {}));
  return res;
}

// Dữ liệu cho trang shop công khai: không bao giờ trả về secret, giá vốn hay thông tin khách
async function publicShop(app) {
  const { db, settings: s } = app;
  const [cats, svcs, games, accs] = await db.batch([
    db.prepare('SELECT id, name FROM categories WHERE active = 1 ORDER BY sort, id'),
    db.prepare('SELECT * FROM services WHERE active = 1 ORDER BY sort, id'),
    db.prepare('SELECT id, name FROM games WHERE active = 1 ORDER BY sort, id'),
    db.prepare(`SELECT id, game_id, title, info, description, price, images, created_at, delivery FROM accounts WHERE status = 'available' ORDER BY id DESC LIMIT 120`),
  ]);
  const img = (x) => (x.startsWith('http') ? x : `/api/img/${x}`);
  return {
    shop_name: s.shop_name,
    logo: logoUrl(s.logo),
    hero_art: logoUrl(s.hero_art),
    logo_style: s.logo_style,
    tagline: s.tagline,
    hero_title: s.hero_title,
    hero_subtitle: s.hero_subtitle,
    accent: s.accent_color,
    accent2: s.accent_color2,
    footer_text: s.footer_text,
    bot_username: s.bot_username,
    support_zalo: s.support_zalo,
    support_url: s.support_url,
    notice: s.site_notice,
    hero_image: logoUrl(s.hero_image),
    bonus: Number(s.topup_bonus_percent) || 0,
    api_enabled: s.api_enabled === '1',
    child_enabled: s.child_enabled === '1',
    reseller_rate: Number(s.reseller_rate) || 100,
    child_min_markup: Number(s.child_min_markup) || 0,
    categories: cats.results
      .map((c) => ({
        ...c,
        services: svcs.results.filter((x) => x.category_id === c.id).map((x) => ({
          id: x.id, name: x.name, description: x.description, input_type: x.input_type,
          price: servicePricing(app, x).unit, min_qty: x.min_qty, max_qty: x.max_qty,
          extra_min: x.extra_min, extra_max: x.extra_max, reactions: x.reactions ? x.reactions.split(',') : [],
        })),
      }))
      .filter((c) => c.services.length),
    games: games.results.map((g) => ({
      ...g,
      accounts: accs.results
        .filter((a) => a.game_id === g.id)
        .map(({ images, game_id, ...a }) => ({ ...a, images: safeJson(images, []).map(img), is_new: now() - a.created_at < 3 * 86400 })),
    })),
  };
}

const logoUrl = (x) => (!x ? '' : x.startsWith('http') || x.startsWith('/') ? x : `/api/img/${x}`);

// Nhật ký thao tác admin. Ẩn các trường nhạy cảm trước khi lưu.
const SENSITIVE = /token|key|secret|password/i;
async function audit(db, request, copy, parts) {
  let detail = '';
  if ((request.headers.get('content-type') || '').includes('application/json')) {
    const b = await copy.json().catch(() => null);
    if (b && typeof b === 'object') {
      for (const k of Object.keys(b)) if (SENSITIVE.test(k) && b[k]) b[k] = '***';
      detail = JSON.stringify(b).slice(0, 800);
    }
  }
  await db
    .prepare('INSERT INTO audit_logs (action, target, detail, ip, created_at) VALUES (?,?,?,?,?)')
    .bind(`${request.method} ${parts[0] || ''}${parts[2] ? `/${parts[2]}` : ''}`, parts[1] || '', detail,
      request.headers.get('cf-connecting-ip') || 'local', now())
    .run();
}
