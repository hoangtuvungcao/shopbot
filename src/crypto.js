// Mã hóa thông tin đăng nhập acc (AES-GCM) bằng secret DATA_KEY.
// Lộ database cũng không đọc được tài khoản/mật khẩu nếu không có DATA_KEY.
// Chưa đặt DATA_KEY thì lưu dạng thường (trang Cài đặt sẽ cảnh báo).
const PREFIX = 'enc:v1:';
const enc = new TextEncoder();
const dec = new TextDecoder();
let cached = null;

async function keyOf(env) {
  if (!env.DATA_KEY) return null;
  if (cached?.raw === env.DATA_KEY) return cached.key;
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(`shopbot|${env.DATA_KEY}`));
  const key = await crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
  cached = { raw: env.DATA_KEY, key };
  return key;
}

const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function sealSecret(env, text) {
  if (!text) return '';
  const key = await keyOf(env);
  if (!key) return text;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return PREFIX + b64(out);
}

export async function openSecret(env, stored) {
  if (!stored || !String(stored).startsWith(PREFIX)) return stored || '';
  const key = await keyOf(env);
  if (!key) return '[Không giải mã được: thiếu DATA_KEY]';
  try {
    const raw = unb64(stored.slice(PREFIX.length));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12));
    return dec.decode(pt);
  } catch {
    return '[Không giải mã được: DATA_KEY đã thay đổi]';
  }
}
