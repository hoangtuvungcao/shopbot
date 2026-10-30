// Client cho API V1 của trumsubviet.com (form-data, apikey trong body).
// Kết quả luôn có dạng { ok, data, msg, network } — network=true nghĩa là không chắc
// server đã nhận đơn hay chưa (timeout, mất kết nối), cần kiểm tra tay.
export function createUpstream(settings) {
  const base = (settings.api_base || 'https://trumsubviet.com').replace(/\/+$/, '');
  const key = settings.api_key;

  async function post(path, fields, timeoutMs = 20000) {
    if (!key) return { ok: false, msg: 'Chưa cấu hình API key', network: false };
    const form = new FormData();
    form.append('apikey', key);
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined && v !== null && v !== '') form.append(k, String(v));
    }
    let res;
    try {
      res = await fetch(base + path, { method: 'POST', body: form, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      return { ok: false, msg: `Không kết nối được API: ${e.message}`, network: true };
    }
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, msg: `API trả về dữ liệu lạ (HTTP ${res.status})`, network: res.status >= 500 };
    }
    if (body.status === 'success') return { ok: true, data: body.data, msg: body.msg || '' };
    return { ok: false, msg: body.msg || 'API báo lỗi', network: false };
  }

  return {
    services: () => post('/api/service/list', {}),
    profile: () => post('/api/profile', {}),
    create: (fields) => post('/api/create/service', fields, 25000),
    view: (code) => post('/api/service/view_order', { code_order: code }),
    cancel: (code) => post('/api/update/service', { action: 'refund', code_order: code }),
  };
}

// Trạng thái từ API -> trạng thái nội bộ
export function mapUpstreamStatus(s) {
  switch (String(s || '').toLowerCase()) {
    case 'done':
      return 'done';
    case 'refund':
      return 'refund';
    case 'cancel':
      return 'canceled';
    default:
      return 'processing'; // pending, waitrefund, ...
  }
}
