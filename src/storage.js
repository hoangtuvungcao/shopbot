// Quản lý dung lượng R2 để không vượt gói miễn phí (10GB).
// Dung lượng đếm qua bảng r2_files (không liệt kê bucket mỗi lần, vì liệt kê cũng tính phí).
import { now, safeJson } from './util.js';
import { notifyAdmins } from './shop.js';

export const FREE_TIER_MB = 10 * 1024;
const MB = 1024 * 1024;

export async function recordUpload(db, key, size, kind) {
  await db.prepare('INSERT OR REPLACE INTO r2_files (key, size, kind, created_at) VALUES (?,?,?,?)').bind(key, size, kind, now()).run();
}

export async function deleteFiles(app, keys) {
  const own = [...new Set(keys)].filter((k) => typeof k === 'string' && /^(acc|brand)\//.test(k));
  if (!own.length || !app.env.BUCKET) return 0;
  for (let i = 0; i < own.length; i += 500) {
    const part = own.slice(i, i + 500);
    await app.env.BUCKET.delete(part).catch(() => {});
    await app.db.prepare(`DELETE FROM r2_files WHERE key IN (${part.map(() => '?').join(',')})`).bind(...part).run();
  }
  return own.length;
}

export async function usage(db) {
  const { results } = await db.prepare('SELECT kind, COUNT(*) AS files, COALESCE(SUM(size),0) AS bytes FROM r2_files GROUP BY kind').all();
  const by = Object.fromEntries(results.map((r) => [r.kind, r]));
  const bytes = results.reduce((s, r) => s + r.bytes, 0);
  return { bytes, files: results.reduce((s, r) => s + r.files, 0), acc: by.acc || { files: 0, bytes: 0 }, brand: by.brand || { files: 0, bytes: 0 } };
}

export const limitBytes = (settings) => Math.max(50, Number(settings.r2_limit_mb) || 9000) * MB;

/** Kiểm tra trước khi tải ảnh lên: không cho vượt giới hạn admin đặt. */
export async function canStore(app, incoming) {
  const u = await usage(app.db);
  const limit = limitBytes(app.settings);
  if (u.bytes + incoming <= limit) return { ok: true };
  if (app.settings.r2_alerted !== '1') {
    await app.db.prepare(`INSERT INTO settings (key, value) VALUES ('r2_alerted','1') ON CONFLICT(key) DO UPDATE SET value='1'`).run();
    notifyAdmins(app, `<b>Bộ nhớ ảnh R2 sắp đầy</b>\nĐã dùng ${(u.bytes / MB).toFixed(0)}MB / giới hạn ${(limit / MB).toFixed(0)}MB.\nVào admin → Lưu trữ ảnh để dọn.`).catch(() => {});
  }
  return { ok: false, used: u.bytes, limit };
}

/** Các key ảnh đang được dùng (acc chưa bị dọn + logo/banner). */
async function referencedKeys(app) {
  const keys = new Set();
  const { results } = await app.db.prepare('SELECT images FROM accounts').all();
  for (const r of results) for (const k of safeJson(r.images, [])) keys.add(k);
  for (const k of ['logo', 'hero_art', 'hero_image']) if (app.settings[k]) keys.add(app.settings[k]);
  return keys;
}

/**
 * Dọn bộ nhớ:
 *  - ảnh rác: đã tải lên nhưng không gắn vào đâu, cũ hơn 24 giờ
 *  - ảnh của acc đã bán lâu hơn r2_sold_days ngày (0 = giữ mãi)
 * dryRun = true chỉ đếm, không xóa.
 */
export async function cleanup(app, { dryRun = false } = {}) {
  const { db, settings } = app;
  const refs = await referencedKeys(app);
  const { results: files } = await db.prepare('SELECT key, size, created_at FROM r2_files').all();
  const orphans = files.filter((f) => !refs.has(f.key) && f.created_at < now() - 86400);

  const days = Math.max(0, Number(settings.r2_sold_days) || 0);
  let sold = [];
  if (days > 0) {
    ({ results: sold } = await db.prepare(`SELECT id, images FROM accounts WHERE status = 'sold' AND delivered_at IS NOT NULL
        AND sold_at < ? AND images IS NOT NULL AND images != '[]'`).bind(now() - days * 86400).all());
  }
  const soldKeys = sold.flatMap((a) => safeJson(a.images, []).filter((k) => /^acc\//.test(k)));
  const size = new Map(files.map((f) => [f.key, f.size]));
  const result = {
    orphan_files: orphans.length,
    orphan_bytes: orphans.reduce((s, f) => s + f.size, 0),
    sold_accounts: sold.length,
    sold_files: soldKeys.length,
    sold_bytes: soldKeys.reduce((s, k) => s + (size.get(k) || 0), 0),
  };
  if (dryRun) return result;

  await deleteFiles(app, [...orphans.map((f) => f.key), ...soldKeys]);
  // Acc đã bán chỉ giữ link ảnh ngoài (nếu có); ảnh R2 đã xóa
  const stmts = sold.map((a) => db.prepare('UPDATE accounts SET images = ?, tg_file_ids = NULL WHERE id = ?')
    .bind(JSON.stringify(safeJson(a.images, []).filter((k) => !/^acc\//.test(k))), a.id));
  for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
  await db.prepare(`INSERT INTO settings (key, value) VALUES ('r2_cleaned_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .bind(String(now())).run();
  const u = await usage(db);
  if (u.bytes < limitBytes(settings) * 0.9) {
    await db.prepare(`INSERT INTO settings (key, value) VALUES ('r2_alerted','0') ON CONFLICT(key) DO UPDATE SET value='0'`).run();
  }
  return result;
}

/** Đối chiếu bảng r2_files với bucket thật (dùng khi cần, tốn lượt "list" của R2). */
export async function reconcile(app) {
  const seen = new Map();
  let cursor;
  let pages = 0;
  do {
    const r = await app.env.BUCKET.list({ cursor, limit: 1000 });
    for (const o of r.objects) seen.set(o.key, o);
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor && ++pages < 50);
  const { results } = await app.db.prepare('SELECT key FROM r2_files').all();
  const known = new Set(results.map((r) => r.key));
  const stmts = [];
  for (const [key, o] of seen) {
    if (!known.has(key)) {
      const kind = key.startsWith('brand/') ? 'brand' : 'acc';
      stmts.push(app.db.prepare('INSERT OR REPLACE INTO r2_files (key, size, kind, created_at) VALUES (?,?,?,?)')
        .bind(key, o.size, kind, Math.floor(new Date(o.uploaded).getTime() / 1000) || now()));
    }
  }
  for (const key of known) if (!seen.has(key)) stmts.push(app.db.prepare('DELETE FROM r2_files WHERE key = ?').bind(key));
  for (let i = 0; i < stmts.length; i += 80) await app.db.batch(stmts.slice(i, i + 80));
  return { objects: seen.size, fixed: stmts.length };
}
