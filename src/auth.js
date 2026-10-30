import { HttpError } from './util.js';

const COOKIE = 'adm';
const TTL = 7 * 24 * 3600;
const enc = new TextEncoder();

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Đổi ADMIN_PASSWORD sẽ làm mọi phiên cũ hết hiệu lực vì secret thay đổi
const secretOf = (env) => `${env.SESSION_SECRET || ''}|${env.ADMIN_PASSWORD}`;

export async function login(env, password) {
  if (!env.ADMIN_PASSWORD) throw new HttpError(500, 'Chưa đặt biến môi trường ADMIN_PASSWORD');
  const a = await hmac('cmp', String(password || ''));
  const b = await hmac('cmp', env.ADMIN_PASSWORD);
  if (!timingSafeEqual(a, b)) {
    await new Promise((r) => setTimeout(r, 600));
    throw new HttpError(401, 'Sai mật khẩu');
  }
  const exp = Math.floor(Date.now() / 1000) + TTL;
  const token = `${exp}.${await hmac(secretOf(env), String(exp))}`;
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${TTL}`;
}

export const logoutCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export async function isAuthed(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return timingSafeEqual(sig, await hmac(secretOf(env), exp));
}

// ------------------------------------------------------------ phiên đăng nhập của khách trên web
const USER_COOKIE = 'cu';
const USER_TTL = 30 * 24 * 3600;
const userSecret = (env) => `${env.SESSION_SECRET || ''}|${env.ADMIN_PASSWORD || ''}|customer`;

export async function userCookie(env, userId) {
  const exp = Math.floor(Date.now() / 1000) + USER_TTL;
  const payload = `${userId}.${exp}`;
  return `${USER_COOKIE}=${payload}.${await hmac(userSecret(env), payload)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${USER_TTL}`;
}

export const userLogoutCookie = () => `${USER_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

/** Trả về id khách đang đăng nhập hoặc null. */
export async function sessionUserId(request, env) {
  const m = (request.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${USER_COOKIE}=([^;]+)`));
  if (!m) return null;
  const [uid, exp, sig] = m[1].split('.');
  if (!uid || !exp || !sig || Number(exp) < Date.now() / 1000) return null;
  return timingSafeEqual(sig, await hmac(userSecret(env), `${uid}.${exp}`)) ? Number(uid) : null;
}
