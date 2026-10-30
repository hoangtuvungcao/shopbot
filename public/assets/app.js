import { applyColors, MARK_NAMES, paintMark, PRESETS, setFavicon } from './brand.js';

// ================================================================ helpers
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => `${Math.round(Number(n) || 0).toLocaleString('vi-VN')}đ`;
const num = (n) => (Number(n) || 0).toLocaleString('vi-VN');
const price = (p) => `${Number(p || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}đ`;
const fmtTime = (t) => (t ? new Date(t * 1000).toLocaleString('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', hour12: false, day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
}) : '—');
const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const imgSrc = (x) => (x.startsWith('http') || x.startsWith('/') ? x : `/api/img/${x}`);
const userLabel = (o) => (o.username ? `@${o.username}` : o.first_name || `Khách ${o.user_id || o.id}`);
const botTag = (o) => (o.bot_id ? `<span class="badge info">@${esc(o.bot_username || `bot ${o.bot_id}`)}</span>` : '');
const userCell = (o, id = o.user_id) => (id
  ? `${esc(userLabel(o))} ${botTag(o)}<div class="sub mono">mã ${id}${o.tg_id ? ` · tg ${o.tg_id}` : ''}</div>`
  : '<span class="muted">—</span>');

async function api(path, { method = 'GET', body, form } = {}) {
  const opt = { method, headers: {} };
  if (form) opt.body = form;
  else if (body !== undefined) {
    opt.body = JSON.stringify(body);
    opt.headers['content-type'] = 'application/json';
  }
  let res;
  try {
    res = await fetch(`/api${path}`, opt);
  } catch {
    throw new Error('Mất kết nối mạng');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth')) {
    showLogin();
    throw new Error(data.error || 'Phiên đăng nhập đã hết hạn');
  }
  if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
  return data;
}

function toast(msg, bad = false) {
  const el = document.createElement('div');
  el.className = `toast${bad ? ' bad' : ''}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), bad ? 5000 : 2800);
}

// Chạy một thao tác có khóa nút để tránh bấm hai lần
async function run(btn, fn, okMsg) {
  if (btn?.disabled) return;
  if (btn) { btn.disabled = true; btn.classList.add('busy'); }
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    toast(e.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove('busy'); }
  }
}

// Nén ảnh trong trình duyệt trước khi tải lên (giảm dung lượng R2 5–10 lần)
async function compressImage(file, maxSide = 1600) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || typeof createImageBitmap !== 'function') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    let blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.82));
    if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, blob.type === 'image/webp' ? '.webp' : '.jpg'), { type: blob.type });
  } catch {
    return file;
  }
}

async function uploadImages(files, kind = 'acc') {
  const fd = new FormData();
  for (const f of files) fd.append('file', await compressImage(f, kind === 'brand' ? 1920 : 1600));
  return api(`/admin/upload${kind === 'brand' ? '?kind=brand' : ''}`, { method: 'POST', form: fd });
}

// ================================================================ modal
function openModal({ title, body, wide = false, foot = '' }) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true">
    <div class="modal-head"><h3>${esc(title)}</h3><button class="btn ghost icon-only" data-close aria-label="Đóng">✕</button></div>
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
  const close = () => {
    bg.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  bg.addEventListener('mousedown', (e) => e.target === bg && close());
  $$('[data-close]', bg).forEach((b) => b.addEventListener('click', close));
  $('#modalRoot').append(bg);
  setTimeout(() => $('input:not([type=checkbox]),textarea,select', bg)?.focus(), 30);
  return { el: bg, close };
}

function fieldHtml(f, v) {
  const val = v ?? f.default ?? '';
  const attrs = `name="${f.name}" ${f.required ? 'required' : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}`;
  let input;
  if (f.type === 'textarea') input = `<textarea ${attrs} rows="${f.rows || 4}">${esc(val)}</textarea>`;
  else if (f.type === 'select') {
    input = `<select ${attrs}>${f.options.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  } else if (f.type === 'checkbox') {
    return `<label class="check ${f.full ? 'full' : ''}"><input type="checkbox" name="${f.name}" ${val === true || val === 1 || val === '1' ? 'checked' : ''}> ${esc(f.label)}</label>`;
  } else {
    input = `<input type="${f.type || 'text'}" ${attrs} value="${esc(val)}" ${f.step ? `step="${f.step}"` : ''} ${f.type === 'number' ? 'inputmode="decimal"' : ''}>`;
  }
  return `<label class="field ${f.full ? 'full' : ''}" data-field="${f.name}"><span>${esc(f.label)}</span>${input}${f.hint ? `<small class="hint">${f.hint}</small>` : ''}</label>`;
}

function readForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    out[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return out;
}

/** Form modal chung. onSubmit trả về true/không throw là đóng modal. */
function formModal({ title, fields, values = {}, submit = 'Lưu', wide, extra = '', onMount, onSubmit }) {
  const m = openModal({
    title,
    wide,
    body: `<form class="form-grid" id="mform">${fields.map((f) => fieldHtml(f, values[f.name])).join('')}${extra}</form>`,
    foot: `<button class="btn" data-close>Hủy</button><button class="btn primary" id="msubmit">${esc(submit)}</button>`,
  });
  const form = $('#mform', m.el);
  const btn = $('#msubmit', m.el);
  const go = async (e) => {
    e?.preventDefault();
    if (!form.reportValidity()) return;
    const ok = await run(btn, () => onSubmit(readForm(form), m));
    if (ok !== undefined) m.close();
  };
  form.addEventListener('submit', go);
  btn.addEventListener('click', go);
  onMount?.(m.el, form);
  return m;
}

function confirmModal(title, text, { danger = false, ok = 'Xác nhận' } = {}) {
  return new Promise((resolve) => {
    const m = openModal({
      title,
      body: `<p style="margin:0">${text}</p>`,
      foot: `<button class="btn" data-close>Hủy</button><button class="btn ${danger ? 'danger solid' : 'primary'}" id="mok">${esc(ok)}</button>`,
    });
    let done = false;
    $('#mok', m.el).onclick = () => { done = true; m.close(); resolve(true); };
    const obs = new MutationObserver(() => { if (!m.el.isConnected) { obs.disconnect(); if (!done) resolve(false); } });
    obs.observe($('#modalRoot'), { childList: true });
  });
}

function pager(data, onPage) {
  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  const el = document.createElement('div');
  el.className = 'pager';
  el.innerHTML = `<span>${num(data.total)} mục · trang ${data.page + 1}/${pages}</span>
    <div class="btns"><button class="btn sm" ${data.page <= 0 ? 'disabled' : ''} data-p="-1">Trước</button>
    <button class="btn sm" ${data.page + 1 >= pages ? 'disabled' : ''} data-p="1">Sau</button></div>`;
  $$('[data-p]', el).forEach((b) => b.addEventListener('click', () => onPage(data.page + Number(b.dataset.p))));
  return el;
}

function table(cols, rows, empty = 'Chưa có dữ liệu') {
  if (!rows.length) return `<div class="empty">${empty}</div>`;
  return `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th class="${c.cls || ''}">${c.label}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr ${r.__attrs || ''}>${cols.map((c) => `<td class="${c.cls || ''}" data-label="${c.label}"><div class="cv">${c.render(r)}</div></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

// ================================================================ constants
const ORDER_STATUS = {
  manual: ['Chờ xử lý', 'warn'],
  review: ['Cần kiểm tra', 'bad'],
  processing: ['Đang chạy', 'info'],
  done: ['Hoàn thành', 'good'],
  refunded: ['Đã hoàn tiền', ''],
  canceled: ['Đã hủy', ''],
  failed: ['Lỗi - đã hoàn', 'bad'],
};
const TOPUP_STATUS = { credited: ['Đã cộng', 'good'], unmatched: ['Chưa khớp', 'warn'], ignored: ['Bỏ qua', ''] };
const ACC_STATUS = { available: ['Còn hàng', 'good'], hidden: ['Đang ẩn', ''], sold: ['Đã bán', 'info'], pending: ['Chờ giao', 'warn'] };
const accState = (a) => (a.status === 'sold' && !a.delivered_at ? 'pending' : a.status);
const WD_STATUS = { pending: ['Chờ chuyển', 'warn'], paid: ['Đã chuyển', 'good'], rejected: ['Từ chối', ''] };
const INPUT_TYPES = [
  ['quantity', 'Link + số lượng (like, follow, view...)'],
  ['days', 'Link + số lượng + số ngày (VIP theo ngày)'],
  ['minutes', 'Link + số lượng + số phút (mắt live, time)'],
  ['comment', 'Link + nội dung bình luận'],
  ['fixed', 'Giá cố định 1 lần (dịch vụ trọn gói)'],
  ['verify', 'Tích xanh: link + SĐT/Zalo + ghi chú, admin xử lý'],
];
const LOG_TYPE = { topup: 'Nạp tiền', order: 'Đặt đơn', refund: 'Hoàn tiền', buy_acc: 'Mua acc', admin: 'Admin điều chỉnh', commission: 'Hoa hồng', withdraw: 'Rút tiền', gift: 'Mã quà tặng' };
const badge = (map, s) => `<span class="badge ${map[s]?.[1] || ''}">${esc(map[s]?.[0] || s)}</span>`;

// ================================================================ router
const routes = {
  '': ['Tổng quan', pageDashboard],
  orders: ['Đơn dịch vụ', pageOrders],
  services: ['Dịch vụ & giá', pageServices],
  accounts: ['Acc game', pageAccounts],
  topups: ['Nạp tiền SePay', pageTopups],
  users: ['Người dùng', pageUsers],
  resellers: ['Đại lý & bot con', pageResellers],
  giftcodes: ['Mã quà tặng', pageGiftcodes],
  broadcast: ['Gửi thông báo', pageBroadcast],
  audit: ['Nhật ký thao tác', pageAudit],
  storage: ['Lưu trữ ảnh', pageStorage],
  settings: ['Cài đặt', pageSettings],
};
let charts = [];
let routeToken = 0;

async function render() {
  const key = location.hash.replace(/^#\/?/, '').split('?')[0];
  const [title, fn] = routes[key] || routes[''];
  charts.forEach((c) => c.destroy());
  charts = [];
  $('#pageTitle').textContent = title;
  $('#topbarRight').innerHTML = '';
  $$('#nav a, #tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.route === key));
  $('#sidebar').classList.remove('open');
  const view = $('#view');
  view.innerHTML = key ? '<div class="sk sk-block" style="margin-top:0;height:56px"></div><div class="sk sk-block"></div>'
    : '<div class="sk-grid">' + '<div class="sk"></div>'.repeat(8) + '</div><div class="sk sk-block"></div>';
  const token = ++routeToken;
  try {
    await fn(view, () => token !== routeToken);
  } catch (e) {
    if (token === routeToken) view.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
  refreshBadges();
}

async function refreshBadges() {
  try {
    const s = await api('/admin/stats?days=7');
    const q = s.kpi.manual_queue + s.kpi.review_queue;
    $('#navManual').textContent = q || '';
    $('#tabManual').textContent = q || '';
    $('#navUnmatched').textContent = s.kpi.topup_unmatched || '';
    $('#navWithdraw').textContent = s.kpi.withdraw_pending || '';
    $('#navAccPending').textContent = s.kpi.acc_pending || '';
    return s;
  } catch { /* bỏ qua */ }
}

// ================================================================ auth
function showLogin() {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
}

function applyBrand(b) {
  if (b.shop) {
    $('#shopName').textContent = b.shop;
    $('#loginTitle').textContent = `Quản trị ${b.shop}`;
    document.title = `Quản trị · ${b.shop}`;
  }
  for (const el of [$('#sideLogo'), $('#loginLogo')]) paintMark(el, { logo: b.logo, style: b.logo_style, name: b.shop });
  if (b.hero_art) {
    $('#loginArt').src = b.hero_art;
    $('#loginArt').classList.remove('hidden');
    $('#loginLogo').classList.add('hidden');
  }
  applyColors(b.accent, b.accent2);
  setFavicon({ logo: b.logo, style: b.logo_style, accent: b.accent, accent2: b.accent2, name: b.shop });
}

// Giao diện sáng/tối: mặc định theo hệ điều hành, bấm nút để chọn và nhớ lại trên máy này
function setTheme(t) {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const dark = t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  $('#themeIcon')?.setAttribute('href', dark ? '#i-sun' : '#i-moon');
}
try { setTheme(localStorage.getItem('theme')); } catch { /* bỏ qua */ }
$('#themeBtn').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  setTheme(next);
  try { localStorage.setItem('theme', next); } catch { /* bỏ qua */ }
  render();
});

// Số đếm tăng dần cho các ô KPI
function countUp(root) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  $$('[data-count]', root).forEach((el) => {
    const target = Number(el.dataset.count);
    const isMoney = el.dataset.money === '1';
    if (!target) return;
    const start = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - start) / 700);
      const v = Math.round(target * (1 - (1 - p) ** 3));
      el.textContent = isMoney ? money(v) : num(v);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

async function boot() {
  const me = await api('/auth/me').catch(() => ({ authed: false }));
  applyBrand(me);
  if (!me.authed) return showLogin();
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  render();
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('button', e.target);
  $('#loginError').textContent = '';
  btn.disabled = true;
  try {
    await api('/auth/login', { method: 'POST', body: { password: e.target.password.value } });
    e.target.reset();
    boot();
  } catch (err) {
    $('#loginError').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});
$('#logoutBtn').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  showLogin();
});
$('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
$('#tabMore').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); $('#sidebar').classList.toggle('open'); });
document.addEventListener('click', (e) => {
  const sb = $('#sidebar');
  if (sb.classList.contains('open') && !sb.contains(e.target) && !$('#menuBtn').contains(e.target)) sb.classList.remove('open');
});
window.addEventListener('hashchange', render);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!location.hash.replace(/^#\/?/, '')) render(); });

// ================================================================ dashboard
function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function chartDefaults() {
  const text = css('--text-2');
  const grid = css('--grid');
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: css('--surface'), titleColor: css('--text'), bodyColor: css('--text-2'),
        borderColor: css('--border'), borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true,
        callbacks: { label: (c) => ` ${c.dataset.label}: ${c.dataset.unit === 'count' ? num(c.parsed.y ?? c.parsed.x) : money(c.parsed.y ?? c.parsed.x)}` },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: text, maxRotation: 0, autoSkipPadding: 14, font: { size: 11 } }, border: { color: grid } },
      y: {
        beginAtZero: true, grid: { color: grid }, border: { display: false },
        ticks: { color: text, font: { size: 11 }, callback: (v) => (Math.abs(v) >= 1e6 ? `${v / 1e6}tr` : Math.abs(v) >= 1e3 ? `${v / 1e3}k` : v) },
      },
    },
  };
}

const legendHtml = (items) => `<div class="legend">${items.map(([c, l]) => `<span><i style="background:${c}"></i>${esc(l)}</span>`).join('')}</div>`;
const sum = (a) => a.reduce((x, y) => x + y, 0);

async function pageDashboard(view, stale) {
  let days = Number(sessionStorage.getItem('dashDays')) || 30;
  const s = await api(`/admin/stats?days=${days}`);
  if (stale()) return;
  const k = s.kpi;
  const queue = k.manual_queue + k.review_queue;
  view.innerHTML = `
    <div class="grid kpis">
      ${kpi('Nạp hôm nay', { n: k.topup_today, money: 1 }, `Tháng này ${money(k.topup_month)}`)}
      ${kpi('Doanh thu hôm nay', { n: k.order_today + k.acc_today, money: 1 }, `Dịch vụ ${money(k.order_today)} · Acc ${money(k.acc_today)} (đã trừ hoa hồng)`)}
      ${kpi('Số dư khách đang giữ', { n: k.user_balance, money: 1 }, 'Tổng số dư chưa dùng')}
      ${kpi('Người dùng', { n: k.users }, `+${num(k.users_today)} hôm nay`)}
      ${kpi('Đơn cần xử lý', { n: queue }, `${k.manual_queue} chờ · ${k.review_queue} kiểm tra · ${k.processing} đang chạy`, queue ? '#/orders?status=manual' : '', queue > 0)}
      ${kpi('Acc còn hàng', { n: k.acc_available }, k.acc_pending ? `${k.acc_pending} acc chờ giao` : 'Không có acc chờ giao', '#/accounts', k.acc_pending > 0)}
      ${kpi('Bot con đang chạy', num(k.bots_active), `Hoa hồng tháng này ${money(k.commission_month)}`, '#/resellers')}
      ${kpi('Lệnh rút chờ duyệt', num(k.withdraw_pending), '', k.withdraw_pending ? '#/resellers' : '', k.withdraw_pending > 0)}
      ${kpi('Giao dịch chưa khớp', num(k.topup_unmatched), 'Chuyển khoản sai nội dung', k.topup_unmatched ? '#/topups' : '', k.topup_unmatched > 0)}
      <div class="card kpi" id="upBal"><div class="label">Số dư nhà cung cấp</div><div class="value">…</div><div class="sub">trumsubviet.com</div></div>
    </div>
    <div class="toolbar"><div class="seg" id="range">${[7, 30, 90].map((d) => `<button data-d="${d}" class="${d === days ? 'on' : ''}">${d} ngày</button>`).join('')}</div>
      <span class="muted small" id="rangeSum"></span></div>
    <div class="grid two">
      <div class="card"><div class="card-head"><h3>Dòng tiền theo ngày</h3><div id="lg1"></div></div><div class="card-body"><div class="chart-box"><canvas id="c1"></canvas></div></div></div>
      <div class="card"><div class="card-head"><h3>Doanh thu theo nguồn</h3><div id="lg2"></div></div><div class="card-body"><div class="chart-box"><canvas id="c2"></canvas></div></div></div>
    </div>
    <div class="grid two">
      <div class="card"><div class="card-head"><h3>Dịch vụ bán chạy</h3><span class="muted small">theo doanh thu</span></div><div class="card-body"><div class="chart-box short"><canvas id="c3"></canvas></div></div></div>
      <div class="card"><div class="card-head"><h3>Người dùng mới</h3><span class="muted small" id="nuSum"></span></div><div class="card-body"><div class="chart-box short"><canvas id="c4"></canvas></div></div></div>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h3>Hoạt động gần đây</h3><a class="small" href="#/orders">Xem tất cả đơn</a></div>
      <div class="card-body" style="padding:12px 0 4px">${feed(s.recent || [])}</div></div>`;
  countUp(view);

  api('/admin/upstream/profile').then((p) => {
    if (p?.configured === false) {
      $('#upBal .value', view).textContent = '—';
      $('#upBal .sub', view).innerHTML = '<a href="#/settings">Nhập API key nhà cung cấp</a>';
      return;
    }
    $('#upBal .value', view).textContent = money(p?.balance ?? p?.cash ?? 0);
  }).catch((e) => {
    const el = $('#upBal', view);
    if (el) { $('.value', el).textContent = '—'; $('.sub', el).textContent = e.message; }
  });

  const draw = (st) => {
    charts.forEach((c) => c.destroy());
    charts = [];
    const lab = st.labels.map((d) => d.slice(8, 10) + '/' + d.slice(5, 7));
    const S = st.series;
    const revenue = S.order_revenue.map((v, i) => v + S.acc_revenue[i]);
    const c1 = css('--series-1'), c2 = css('--series-2'), c3 = css('--series-3'), surf = css('--surface');
    $('#rangeSum', view).textContent = `Tổng ${st.days} ngày: nạp ${money(sum(S.topup))} · doanh thu ${money(sum(revenue))} · lợi nhuận ước tính ${money(sum(S.profit))}`;
    $('#lg1', view).innerHTML = legendHtml([[c1, 'Nạp tiền'], [c2, 'Doanh thu'], [c3, 'Lợi nhuận']]);
    $('#lg2', view).innerHTML = legendHtml([[c1, 'Dịch vụ'], [c2, 'Acc game']]);
    $('#nuSum', view).textContent = `${num(sum(S.new_users))} trong ${st.days} ngày`;
    const line = (label, data, color) => ({
      label, data, borderColor: color, backgroundColor: color, borderWidth: 2, tension: 0.3,
      pointRadius: 0, pointHoverRadius: 5, pointHoverBorderWidth: 2, pointHoverBorderColor: surf,
    });
    const base = chartDefaults();
    charts.push(new Chart($('#c1', view), {
      type: 'line',
      data: { labels: lab, datasets: [line('Nạp tiền', S.topup, c1), line('Doanh thu', revenue, c2), line('Lợi nhuận', S.profit, c3)] },
      options: base,
    }));
    const bar = (label, data, color, extra = {}) => ({
      label, data, backgroundColor: color, borderColor: surf, borderWidth: { top: 2 }, borderRadius: 4, borderSkipped: 'bottom',
      maxBarThickness: 28, ...extra,
    });
    charts.push(new Chart($('#c2', view), {
      type: 'bar',
      data: { labels: lab, datasets: [bar('Dịch vụ', S.order_revenue, c1, { borderRadius: 0 }), bar('Acc game', S.acc_revenue, c2)] },
      options: { ...base, scales: { x: { ...base.scales.x, stacked: true }, y: { ...base.scales.y, stacked: true } } },
    }));
    const top = st.top_services;
    charts.push(new Chart($('#c3', view), {
      type: 'bar',
      data: { labels: top.map((t) => (t.name.length > 28 ? `${t.name.slice(0, 27)}…` : t.name)), datasets: [bar('Doanh thu', top.map((t) => t.revenue), c1, { borderSkipped: 'left', maxBarThickness: 20 })] },
      options: {
        ...base, indexAxis: 'y', interaction: { mode: 'nearest', axis: 'y', intersect: false },
        scales: { x: { ...base.scales.y, grid: { color: css('--grid') } }, y: { ...base.scales.x, ticks: { ...base.scales.x.ticks, autoSkip: false } } },
      },
    }));
    charts.push(new Chart($('#c4', view), {
      type: 'bar',
      data: { labels: lab, datasets: [bar('Người dùng mới', S.new_users, c1, { unit: 'count' })] },
      options: { ...base, scales: { ...base.scales, y: { ...base.scales.y, ticks: { ...base.scales.y.ticks, precision: 0, callback: (v) => v } } } },
    }));
    if (!top.length) $('#c3', view).parentElement.innerHTML = '<div class="empty">Chưa có đơn trong khoảng này</div>';
  };
  if (window.Chart) draw(s);
  else view.insertAdjacentHTML('beforeend', '<p class="muted">Không tải được thư viện biểu đồ.</p>');

  $$('#range button', view).forEach((b) => b.addEventListener('click', async () => {
    days = Number(b.dataset.d);
    sessionStorage.setItem('dashDays', days);
    $$('#range button', view).forEach((x) => x.classList.toggle('on', x === b));
    const st = await api(`/admin/stats?days=${days}`).catch((e) => toast(e.message, true));
    if (st && !stale() && window.Chart) draw(st);
  }));
}

function feed(items) {
  if (!items.length) return '<div class="empty">Chưa có hoạt động nào</div>';
  const meta = {
    order: ['ĐƠN', 'order', (x) => `Đơn #${x.id} · ${x.label}`, (x) => ORDER_STATUS[x.status]?.[0] || x.status],
    topup: ['NẠP', 'topup', (x) => `Nạp tiền${x.status === 'unmatched' ? ' (chưa khớp)' : ''}`, (x) => x.label],
    acc: ['ACC', 'acc', (x) => `Bán acc #${x.id} · ${x.label || ''}`, (x) => (x.status === 'pending' ? 'Chờ giao' : 'Đã giao')],
  };
  return `<ul class="feed">${items.map((x) => {
    const [tag, cls, title, sub] = meta[x.kind];
    const who = x.username ? `@${x.username}` : x.first_name || '';
    return `<li><span class="dot ${cls}">${tag}</span><div class="main"><b>${esc(title(x))}</b>
      <span>${esc([who, sub(x), fmtTime(x.t)].filter(Boolean).join(' · '))}</span></div><span class="amt">${money(x.amount)}</span></li>`;
  }).join('')}</ul>`;
}

function exportBtn(type) {
  const b = document.createElement('button');
  b.className = 'btn';
  b.textContent = 'Xuất Excel';
  b.onclick = () => formModal({
    title: 'Xuất dữ liệu ra file CSV (mở bằng Excel)',
    fields: [{ name: 'days', label: 'Khoảng thời gian', type: 'select', full: true, options: [['7', '7 ngày'], ['30', '30 ngày'], ['90', '90 ngày'], ['365', '1 năm'], ['3650', 'Toàn bộ']] }],
    values: { days: '30' },
    submit: 'Tải xuống',
    onSubmit: async (v) => { location.href = `/api/admin/export/${type}?days=${v.days}`; return true; },
  });
  $('#topbarRight').prepend(b);
}

function kpi(label, value, sub = '', href = '', alert = false) {
  const raw = typeof value === 'object' ? value : null;
  const shown = raw ? (raw.money ? money(raw.n) : num(raw.n)) : value;
  const attrs = raw ? ` data-count="${raw.n}" data-money="${raw.money ? 1 : 0}"` : '';
  const inner = `<div class="label">${esc(label)}</div><div class="value"${attrs}>${shown}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}`;
  return `<div class="card kpi ${alert ? 'alert' : ''}">${href ? `<a href="${href}">${inner}</a>` : inner}</div>`;
}

// ================================================================ orders
function hashParams() {
  return new URLSearchParams(location.hash.split('?')[1] || '');
}

async function pageOrders(view, stale) {
  const st = { status: hashParams().get('status') || '', type: hashParams().get('type') || '', q: '', page: 0 };
  $('#topbarRight').innerHTML = '<button class="btn" id="syncBtn">Đồng bộ trạng thái</button>';
  exportBtn('orders');
  $('#syncBtn').onclick = (e) => run(e.currentTarget, async () => {
    const r = await api('/admin/orders/sync', { method: 'POST' });
    toast(`Đã kiểm tra ${r.checked} đơn, ${r.changed} đơn thay đổi`);
    load();
  });
  view.innerHTML = `<div class="toolbar">
      <div class="seg" id="tabs">${[['', 'Tất cả'], ...Object.entries(ORDER_STATUS).map(([k, v]) => [k, v[0]])]
        .map(([k, l]) => `<button data-s="${k}" class="${k === st.status ? 'on' : ''}">${l}</button>`).join('')}</div>
      <select id="typeF"><option value="">Mọi loại dịch vụ</option><option value="verify">Chỉ đơn tích xanh</option></select>
      <div class="grow"></div><input type="search" id="q" placeholder="Mã đơn, ID khách, link…"></div>
    <div class="card" id="list"></div>`;
  $('#typeF', view).value = st.type;
  $('#typeF', view).onchange = (e) => { st.type = e.target.value; st.page = 0; load(); };
  $$('#tabs button', view).forEach((b) => b.onclick = () => {
    st.status = b.dataset.s; st.page = 0;
    $$('#tabs button', view).forEach((x) => x.classList.toggle('on', x === b));
    load();
  });
  $('#q', view).oninput = debounce((e) => { st.q = e.target.value; st.page = 0; load(); });

  async function load() {
    const p = new URLSearchParams({ status: st.status, q: st.q, page: st.page });
    const data = await api(`/admin/orders?${p}`).catch((e) => (toast(e.message, true), null));
    if (!data || stale()) return;
    const list = $('#list', view);
    list.innerHTML = table([
      { label: 'Mã', render: (o) => `<b>#${o.id}</b>` },
      { label: 'Khách', render: (o) => userCell(o) },
      { label: 'Dịch vụ', render: (o) => `${esc(o.service_name)}<div class="sub">${esc(o.category_name || '')}${o.mode === 'manual' ? ' · thủ công' : ''}${o.source === 'api' ? ' · API' : o.source === 'web' ? ' · Web' : ''}</div>` },
      { label: 'Link/ID', cls: 'link-cell', render: (o) => `<span title="${esc(o.link)}">${esc(o.link)}</span>` },
      { label: 'SL', cls: 'right num', render: (o) => num(o.quantity) },
      { label: 'Tiền', cls: 'right num', render: (o) => `${money(o.price_total)}${o.refunded ? `<div class="sub">hoàn ${money(o.refunded)}</div>` : ''}` },
      { label: 'Trạng thái', render: (o) => badge(ORDER_STATUS, o.status) },
      { label: 'Thời gian', cls: 'nowrap', render: (o) => fmtTime(o.created_at) },
      { label: '', cls: 'actions', render: (o) => `<button class="btn sm" data-id="${o.id}">Chi tiết</button>` },
    ], data.items, 'Không có đơn nào');
    if (data.total > data.page_size) list.append(pager(data, (p) => { st.page = p; load(); }));
    $$('[data-id]', list).forEach((b) => b.onclick = () => orderModal(data.items.find((o) => o.id == b.dataset.id), load));
  }
  await load();
}

function orderModal(o, reload) {
  const extra = (() => { try { return JSON.parse(o.extra || '{}'); } catch { return {}; } })();
  const open = ['manual', 'processing', 'review'].includes(o.status);
  const btns = [];
  if (o.status === 'manual' && o.mode === 'manual') btns.push(['accept', 'Nhận xử lý', '']);
  if (open) btns.push(['done', 'Đánh dấu hoàn thành', 'primary']);
  if (!['refunded', 'failed', 'canceled'].includes(o.status)) btns.push(['refund', 'Hoàn tiền', '']);
  if (open) btns.push(['cancel', 'Hủy không hoàn', 'danger']);
  if (o.status === 'processing' && o.mode === 'api') btns.push(['sync', 'Đồng bộ', ''], ['upstream_cancel', 'Yêu cầu hủy trên API', '']);
  if (o.status === 'review') btns.push(['set_code', 'Nhập mã đơn API', '']);

  const m = openModal({
    title: `Đơn #${o.id}`,
    body: `<dl class="kv">
      <dt>Trạng thái</dt><dd>${badge(ORDER_STATUS, o.status)}</dd>
      <dt>Khách</dt><dd>${userCell(o)}</dd>
      <dt>Nguồn</dt><dd>${o.source === 'api' ? 'API đại lý' : o.source === 'web' ? 'Web khách hàng' : o.bot_id ? `Bot con @${esc(o.bot_username || o.bot_id)}` : 'Bot gốc'}</dd>
      <dt>Dịch vụ</dt><dd>${esc(o.service_name)} <span class="muted">(${o.mode === 'manual' ? 'thủ công' : 'API'})</span></dd>
      <dt>Link/ID</dt><dd class="mono">${esc(o.link)}</dd>
      <dt>Số lượng</dt><dd>${num(o.quantity)}${extra.extra ? ` · thời gian ${esc(extra.extra)}` : ''}${extra.reaction ? ` · ${esc(extra.reaction)}` : ''}</dd>
      ${extra.contact ? `<dt>SĐT/Zalo</dt><dd><b class="mono">${esc(extra.contact)}</b> <a href="https://zalo.me/${esc(extra.contact.replace(/\D/g, ''))}" target="_blank" rel="noopener">Mở Zalo</a></dd>` : ''}
      ${extra.note ? `<dt>Ghi chú khách</dt><dd>${esc(extra.note)}</dd>` : ''}
      ${extra.comments ? `<dt>Bình luận</dt><dd><pre class="box">${esc(extra.comments)}</pre></dd>` : ''}
      <dt>Thanh toán</dt><dd>${money(o.price_total)} <span class="muted">· giá vốn ${money(o.cost_total)}${o.commission ? ` · hoa hồng bot con ${money(o.commission)}${o.commission_paid ? ' (đã trả)' : ''}` : ''}</span></dd>
      ${o.refunded ? `<dt>Đã hoàn</dt><dd>${money(o.refunded)}</dd>` : ''}
      ${o.upstream_code ? `<dt>Mã API</dt><dd class="mono">${esc(o.upstream_code)} · ${esc(o.upstream_status || '')}</dd>` : ''}
      ${o.start_count || o.delivered ? `<dt>Tiến độ</dt><dd>Ban đầu ${num(o.start_count)} · đã chạy ${num(o.delivered)}</dd>` : ''}
      ${o.admin_note ? `<dt>Ghi chú</dt><dd>${esc(o.admin_note)}</dd>` : ''}
      <dt>Tạo lúc</dt><dd>${fmtTime(o.created_at)}</dd>
      <dt>Cập nhật</dt><dd>${fmtTime(o.updated_at)}</dd></dl>`,
    foot: `<button class="btn ghost" data-a="msg" style="margin-right:auto">Nhắn khách</button>` +
      (btns.length ? btns.map(([a, l, c]) => `<button class="btn ${c}" data-a="${a}">${l}</button>`).join('') : '<button class="btn" data-close>Đóng</button>'),
  });
  $$('[data-a]', m.el).forEach((b) => b.onclick = async () => {
    const a = b.dataset.a;
    if (a === 'refund') {
      m.close();
      return formModal({
        title: `Hoàn tiền đơn #${o.id}`,
        fields: [
          { name: 'amount', label: 'Số tiền hoàn (đ)', type: 'number', required: true, hint: `Tối đa ${money(o.price_total)}` },
          { name: 'note', label: 'Lý do (gửi cho khách)', full: true },
        ],
        values: { amount: o.price_total },
        submit: 'Hoàn tiền',
        onSubmit: async (v) => { await api(`/admin/orders/${o.id}`, { method: 'POST', body: { action: 'refund', ...v } }); toast('Đã hoàn tiền'); reload(); return true; },
      });
    }
    if (a === 'set_code') {
      m.close();
      return formModal({
        title: 'Nhập mã đơn trên API',
        fields: [{ name: 'code', label: 'code_order', required: true, hint: 'Kiểm tra trên trang nhà cung cấp xem đơn đã được tạo chưa. Nếu chưa, hãy dùng "Hoàn tiền".' }],
        onSubmit: async (v) => { await api(`/admin/orders/${o.id}`, { method: 'POST', body: { action: 'set_code', ...v } }); reload(); return true; },
      });
    }
    if (a === 'msg') {
      m.close();
      return formModal({
        title: `Nhắn khách về đơn #${o.id}`,
        fields: [{ name: 'text', label: 'Nội dung gửi qua bot', type: 'textarea', rows: 4, full: true, required: true }],
        values: { text: `Đơn #${o.id} (${o.service_name}): ` },
        submit: 'Gửi',
        onSubmit: async (v) => { await api(`/admin/users/${o.user_id}/message`, { method: 'POST', body: v }); toast('Đã gửi'); return true; },
      });
    }
    if (a === 'accept') {
      m.close();
      return formModal({
        title: `Nhận xử lý đơn #${o.id}`,
        fields: [{ name: 'note', label: 'Lời nhắn cho khách (không bắt buộc)', type: 'textarea', rows: 3, full: true, placeholder: 'Vd: Admin sẽ gọi Zalo cho bạn trong hôm nay' }],
        submit: 'Nhận xử lý',
        onSubmit: async (v) => { await api(`/admin/orders/${o.id}`, { method: 'POST', body: { action: 'accept', ...v } }); toast('Đã nhận đơn và báo khách'); reload(); return true; },
      });
    }
    if (a === 'done' || a === 'cancel') {
      m.close();
      return formModal({
        title: a === 'done' ? `Hoàn thành đơn #${o.id}` : `Hủy đơn #${o.id} (không hoàn tiền)`,
        fields: [{ name: 'note', label: 'Ghi chú gửi khách (không bắt buộc)', type: 'textarea', rows: 3, full: true }],
        submit: a === 'done' ? 'Hoàn thành' : 'Hủy đơn',
        onSubmit: async (v) => { await api(`/admin/orders/${o.id}`, { method: 'POST', body: { action: a, ...v } }); toast('Đã cập nhật'); reload(); return true; },
      });
    }
    await run(b, async () => {
      const r = await api(`/admin/orders/${o.id}`, { method: 'POST', body: { action: a } });
      toast(r.msg || 'Đã cập nhật');
      m.close();
      reload();
    });
  });
}

// ================================================================ services
async function pageServices(view, stale) {
  $('#topbarRight').innerHTML = `<button class="btn" id="tplVerify">Tạo nhanh Tích xanh FB</button>
    <button class="btn" id="importBtn">Chọn gói từ API</button><button class="btn primary" id="addSvc">Thêm dịch vụ</button>`;
  let cats = [];
  let svcs = [];
  let settings = {};
  let resellerRate = 100;
  const filter = { cat: '', q: '', off: false };
  const picked = new Set();
  const PER1K = ['quantity', 'days', 'minutes'];
  const sell = (s, p = s.price) => (PER1K.includes(s.input_type) ? `${money(p * 1000)}<div class="sub">/1.000 · ${price(p)}/lượt</div>` : price(p));
  const ruled = (cost, type, v) => (type === 'percent' ? cost * (1 + v / 100) : cost + v / 1000);

  async function load() {
    let st;
    [cats, svcs, st] = await Promise.all([api('/admin/categories'), api('/admin/services'), api('/admin/settings')]);
    settings = st.settings;
    resellerRate = Number(settings.reseller_rate) || 100;
    if (stale()) return;
    const lastSync = Number(settings.catalog_sync_at) || 0;
    view.innerHTML = `
      <div class="card"><div class="card-head"><h3>Quy tắc giá bán & đồng bộ nhà cung cấp</h3>
          <span class="muted small">${lastSync ? `Đồng bộ lần cuối ${fmtTime(lastSync)}` : 'Chưa đồng bộ'}</span></div>
        <div class="card-body"><form class="form-grid" id="ruleForm">
          ${fieldHtml({ name: 'markup_type', label: 'Cách tính chênh lệch', type: 'select', options: [['per1k', 'Cộng thêm số tiền cho mỗi 1.000 lượt'], ['percent', 'Cộng thêm % trên giá vốn']] }, settings.markup_type)}
          ${fieldHtml({ name: 'markup_value', label: settings.markup_type === 'percent' ? 'Phần trăm lãi (%)' : 'Số tiền cộng thêm mỗi 1.000 lượt (đ)', type: 'number', step: 'any', required: true }, settings.markup_value)}
          ${fieldHtml({ name: 'auto_add_services', label: 'Tự thêm gói mới khi nhà cung cấp mở thêm', type: 'checkbox', full: true }, settings.auto_add_services === '1')}
          <div class="callout full" id="ruleEx"></div>
          <div class="full" style="display:flex;gap:10px;flex-wrap:wrap">
            <button type="button" class="btn primary" id="syncAll">Lưu & đồng bộ toàn bộ dịch vụ</button>
            <button type="button" class="btn" id="reprice">Chỉ áp lại giá</button>
          </div>
        </form></div></div>
      <div class="card" style="margin-top:16px"><div class="card-head"><h3>Danh mục (${cats.length})</h3><button class="btn sm" id="addCat">Thêm danh mục</button></div>
        <div class="card-body" style="padding-top:12px">${cats.length ? `<div class="toolbar" style="margin:0">${cats.map((c) =>
          `<button class="btn sm" data-cat="${c.id}">${esc(c.name)} ${c.active ? '' : '<span class="muted">(ẩn)</span>'}</button>`).join('')}</div>`
          : '<p class="muted" style="margin:0">Bấm "Lưu & đồng bộ toàn bộ dịch vụ" để tự tạo danh mục và gói từ nhà cung cấp.</p>'}</div></div>
      <div class="toolbar" style="margin-top:16px">
        <select id="catF"><option value="">Tất cả danh mục</option>${cats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
        <label class="check"><input type="checkbox" id="offF"> Chỉ gói đang ẩn</label>
        <div class="grow"></div><input type="search" id="svcQ" placeholder="Tìm gói…">
      </div>
      <div class="toolbar hidden" id="bulkBar"><b id="bulkN"></b>
        <button class="btn sm" data-bulk="on">Mở bán</button><button class="btn sm" data-bulk="off">Ẩn</button>
        <button class="btn sm" data-bulk="auto">Chuyển sang giá tự động</button><button class="btn sm danger" data-bulk="delete">Xóa</button>
        <button class="btn sm ghost" id="bulkClear">Bỏ chọn</button></div>
      <div class="card" id="svcTable"></div>`;

    const rf = $('#ruleForm', view);
    const example = () => {
      const v = Number(rf.markup_value.value) || 0;
      const cost = 2;
      const p = ruled(cost, rf.markup_type.value, v);
      $('[data-field=markup_value] > span', view).textContent = rf.markup_type.value === 'percent' ? 'Phần trăm lãi (%)' : 'Số tiền cộng thêm mỗi 1.000 lượt (đ)';
      $('#ruleEx', view).innerHTML = `Ví dụ gói giá vốn <b>${money(cost * 1000)}/1.000</b> lượt → bán <b>${money(p * 1000)}/1.000</b>, lãi ${money((p - cost) * 1000)} mỗi 1.000 lượt.
        Áp dụng cho các gói có nhãn <span class="badge info">Tự động</span>; gói bạn tự sửa giá sẽ giữ nguyên.`;
    };
    rf.markup_type.onchange = example;
    rf.markup_value.oninput = example;
    example();
    const saveRule = () => api('/admin/settings', { method: 'PUT', body: {
      markup_type: rf.markup_type.value, markup_value: rf.markup_value.value, auto_add_services: rf.auto_add_services.checked ? '1' : '0',
    } });
    $('#syncAll', view).onclick = (e) => run(e.currentTarget, async () => {
      if (!rf.reportValidity()) return;
      await saveRule();
      const r = await api('/admin/services/sync-all', { method: 'POST', body: {} });
      toast(`Đồng bộ ${r.total} gói: thêm mới ${r.added}, cập nhật ${r.updated}${r.disabled ? `, ẩn ${r.disabled} gói đã ngừng` : ''}`);
      load();
    });
    $('#reprice', view).onclick = (e) => run(e.currentTarget, async () => {
      if (!rf.reportValidity()) return;
      await saveRule();
      const r = await api('/admin/services/reprice', { method: 'POST', body: {} });
      toast(`Đã áp giá mới cho ${r.count} gói tự động`);
      load();
    });

    $('#catF', view).value = filter.cat;
    $('#offF', view).checked = filter.off;
    $('#svcQ', view).value = filter.q;
    $('#catF', view).onchange = (e) => { filter.cat = e.target.value; drawTable(); };
    $('#offF', view).onchange = (e) => { filter.off = e.target.checked; drawTable(); };
    $('#svcQ', view).oninput = debounce((e) => { filter.q = e.target.value.toLowerCase(); drawTable(); }, 150);
    $('#addCat', view).onclick = () => catModal();
    $$('[data-cat]', view).forEach((b) => b.onclick = () => catModal(cats.find((c) => c.id == b.dataset.cat)));
    $$('[data-bulk]', view).forEach((b) => b.onclick = async () => {
      if (b.dataset.bulk === 'delete' && !(await confirmModal('Xóa dịch vụ', `Xóa ${picked.size} gói đã chọn?`, { danger: true, ok: 'Xóa' }))) return;
      await run(b, async () => {
        await api('/admin/services/bulk', { method: 'POST', body: { ids: [...picked], action: b.dataset.bulk } });
        picked.clear();
        load();
      }, 'Đã cập nhật');
    });
    $('#bulkClear', view).onclick = () => { picked.clear(); drawTable(); };
    drawTable();
  }

  function drawTable() {
    const rows = svcs.filter((s) => (!filter.cat || String(s.category_id) === filter.cat) && (!filter.off || !s.active)
      && (!filter.q || `${s.name} ${s.server_order} ${s.category_name}`.toLowerCase().includes(filter.q)));
    const box = $('#svcTable', view);
    box.innerHTML = table([
      { label: `<input type="checkbox" id="pickAll" aria-label="Chọn tất cả">`, render: (s) => `<input type="checkbox" data-pick="${s.id}" ${picked.has(s.id) ? 'checked' : ''} aria-label="Chọn">` },
      { label: 'Dịch vụ', render: (s) => `<b>${esc(s.name)}</b><div class="sub">${esc(s.category_name || 'Chưa có danh mục')} · ${s.mode === 'manual' ? 'Thủ công' : `API: ${esc(s.server_order)}`}</div>` },
      { label: 'Giá bán', cls: 'right num', render: (s) => `${sell(s)}${s.auto_price ? '<span class="badge info">Tự động</span>' : ''}` },
      { label: 'Giá vốn', cls: 'right num', render: (s) => (PER1K.includes(s.input_type) ? money(s.cost * 1000) : price(s.cost)) },
      { label: 'Lãi', cls: 'right num', render: (s) => (s.cost > 0 ? `<span class="${s.price < s.cost ? 'amount-neg' : ''}">${Math.round(((s.price - s.cost) / s.cost) * 100)}%</span>` : '—') },
      { label: 'Giá đại lý', cls: 'right num', render: (s) => (s.api_price > 0 ? sell(s, s.api_price) : `<span class="muted">${resellerRate}%</span>`) },
      { label: 'Min / Max', cls: 'num nowrap', render: (s) => (['fixed', 'verify'].includes(s.input_type) ? '—' : `${num(s.min_qty)} / ${num(s.max_qty)}`) },
      { label: 'Đơn', cls: 'right num', render: (s) => num(s.orders) },
      { label: 'Bán', render: (s) => (s.active ? '<span class="badge good">Đang bán</span>' : '<span class="badge">Tạm ẩn</span>') },
      { label: '', cls: 'actions', render: (s) => `<button class="btn sm" data-edit="${s.id}">Sửa</button>` },
    ], rows, svcs.length ? 'Không có gói phù hợp bộ lọc' : 'Chưa có dịch vụ. Nhập API key nhà cung cấp trong Cài đặt rồi bấm "Lưu & đồng bộ toàn bộ dịch vụ".');
    const bar = () => {
      $('#bulkBar', view).classList.toggle('hidden', !picked.size);
      $('#bulkN', view).textContent = `Đã chọn ${picked.size} gói`;
    };
    $$('[data-pick]', box).forEach((c) => c.onchange = () => { c.checked ? picked.add(Number(c.dataset.pick)) : picked.delete(Number(c.dataset.pick)); bar(); });
    const all = $('#pickAll', box);
    if (all) all.onchange = () => { rows.forEach((s) => (all.checked ? picked.add(s.id) : picked.delete(s.id))); drawTable(); };
    $$('[data-edit]', box).forEach((b) => b.onclick = () => svcModal(svcs.find((s) => s.id == b.dataset.edit)));
    bar();
  }

  function catModal(c) {
    const m = formModal({
      title: c ? 'Sửa danh mục' : 'Thêm danh mục',
      fields: [
        { name: 'name', label: 'Tên danh mục', required: true, full: true, placeholder: 'Buff like Facebook' },
        { name: 'sort', label: 'Thứ tự hiển thị', type: 'number' },
        { name: 'active', label: 'Hiển thị trên bot', type: 'checkbox' },
      ],
      values: c || { active: true, sort: cats.length },
      onSubmit: async (v) => {
        await api(c ? `/admin/categories/${c.id}` : '/admin/categories', { method: c ? 'PUT' : 'POST', body: v });
        load();
        return true;
      },
    });
    if (c) {
      const del = document.createElement('button');
      del.className = 'btn danger';
      del.textContent = 'Xóa';
      del.style.marginRight = 'auto';
      del.onclick = () => run(del, async () => { await api(`/admin/categories/${c.id}`, { method: 'DELETE' }); m.close(); load(); }, 'Đã xóa');
      $('.modal-foot', m.el).prepend(del);
    }
  }

  function svcModal(s) {
    const catOpts = [['', '— Chọn danh mục —'], ...cats.map((c) => [c.id, c.name])];
    formModal({
      title: s ? 'Sửa dịch vụ' : 'Thêm dịch vụ',
      wide: true,
      fields: [
        { name: 'name', label: 'Tên hiển thị', required: true, full: true },
        { name: 'category_id', label: 'Danh mục', type: 'select', options: catOpts, required: true },
        { name: 'mode', label: 'Cách xử lý', type: 'select', options: [['api', 'Tự động qua API'], ['manual', 'Thủ công (vào hàng chờ admin)']] },
        { name: 'input_type', label: 'Khách cần nhập', type: 'select', options: INPUT_TYPES, full: true },
        { name: 'server_order', label: 'Mã server API (server_order)', placeholder: 'vd: sub1', hint: 'Chỉ cần cho dịch vụ API' },
        { name: 'reactions', label: 'Cảm xúc cho khách chọn', placeholder: 'like,love,haha,wow,sad,angry', hint: 'Để trống nếu không cần' },
        { name: 'auto_price', label: 'Giá tự động theo quy tắc chênh lệch (bỏ chọn để tự đặt giá)', type: 'checkbox', full: true },
        { name: 'price', label: 'Giá bán (đ / 1 lượt)', type: 'number', step: 'any', required: true, hint: 'Gói trọn gói/tích xanh: nhập giá cả gói' },
        { name: 'cost', label: 'Giá vốn (đ / đơn vị)', type: 'number', step: 'any', hint: 'Dùng để tính lợi nhuận' },
        { name: 'api_price', label: 'Giá đại lý (API & nền bot con)', type: 'number', step: 'any', hint: 'Để trống hoặc 0 = giá bán × tỷ lệ đại lý trong Cài đặt' },
        { name: 'min_qty', label: 'Số lượng tối thiểu', type: 'number' },
        { name: 'max_qty', label: 'Số lượng tối đa', type: 'number' },
        { name: 'extra_min', label: 'Ngày/phút tối thiểu', type: 'number', hint: 'Cho kiểu theo ngày/phút' },
        { name: 'extra_max', label: 'Ngày/phút tối đa', type: 'number' },
        { name: 'description', label: 'Mô tả cho khách', type: 'textarea', full: true, rows: 4 },
        { name: 'sort', label: 'Thứ tự', type: 'number' },
        { name: 'active', label: 'Đang mở bán', type: 'checkbox' },
      ],
      values: s || { active: true, mode: 'api', input_type: 'quantity', min_qty: 100, max_qty: 10000, extra_min: 1, extra_max: 30, category_id: cats[0]?.id },
      onMount: (el, form) => {
        const sync = () => {
          const api_ = form.mode.value === 'api';
          const t = form.input_type.value;
          $('[data-field=server_order]', el).classList.toggle('hidden', !api_);
          ['min_qty', 'max_qty'].forEach((n) => $(`[data-field=${n}]`, el).classList.toggle('hidden', t === 'fixed' || t === 'verify'));
          if (t === 'verify' && form.mode.value !== 'manual') form.mode.value = 'manual';
          ['extra_min', 'extra_max'].forEach((n) => $(`[data-field=${n}]`, el).classList.toggle('hidden', !['days', 'minutes'].includes(t)));
        };
        form.mode.onchange = sync;
        form.input_type.onchange = sync;
        const autoSync = () => { form.price.readOnly = form.auto_price.checked; form.price.required = !form.auto_price.checked; };
        form.auto_price.onchange = autoSync;
        autoSync();
        sync();
      },
      onSubmit: async (v) => {
        await api(s ? `/admin/services/${s.id}` : '/admin/services', { method: s ? 'PUT' : 'POST', body: v });
        toast('Đã lưu');
        load();
        return true;
      },
    });
  }

  async function importModal(btn) {
    const list = await run(btn, () => api('/admin/upstream/services'));
    if (!list) return;
    const existing = new Set(svcs.map((s) => s.server_order));
    const m = openModal({
      title: 'Nhập dịch vụ từ nhà cung cấp',
      wide: true,
      body: `<div class="form-grid" style="margin-bottom:14px">
          ${fieldHtml({ name: 'category_id', label: 'Đưa vào danh mục', type: 'select', options: [['', '— Chọn —'], ...cats.map((c) => [c.id, c.name])] })}
          ${fieldHtml({ name: 'markup', label: 'Lãi so với giá vốn (%)', type: 'number', hint: 'Giá bán = giá vốn × (1 + %)' }, 30)}
          <input type="search" class="full" id="flt" placeholder="Lọc theo tên, mạng xã hội…"></div>
        <div class="card" style="max-height:52vh;overflow:auto" id="upl"></div>`,
      foot: '<span class="muted small" id="pickCount" style="margin-right:auto"></span><button class="btn" data-close>Hủy</button><button class="btn primary" id="doImport">Nhập dịch vụ đã chọn</button>',
    });
    const picked = new Set();
    const draw = (q = '') => {
      const rows = list.filter((x) => `${x.name} ${x.social} ${x.service} ${x.server_order}`.toLowerCase().includes(q.toLowerCase()));
      $('#upl', m.el).innerHTML = table([
        { label: '', render: (x) => `<input type="checkbox" data-so="${esc(x.server_order)}" ${picked.has(x.server_order) ? 'checked' : ''}>` },
        { label: 'Gói', render: (x) => `${esc(x.name)}${existing.has(x.server_order) ? ' <span class="badge info">đã có</span>' : ''}<div class="sub">${esc(x.social)} · ${esc(x.service)} · ${esc(x.server_order)}</div>` },
        { label: 'Giá vốn', cls: 'right num', render: (x) => price(x.prices) },
        { label: 'Min/Max', cls: 'num nowrap', render: (x) => `${num(x.min_order)} / ${num(x.max_order)}` },
      ], rows, 'Không có gói nào');
      $$('[data-so]', m.el).forEach((c) => c.onchange = () => {
        c.checked ? picked.add(c.dataset.so) : picked.delete(c.dataset.so);
        $('#pickCount', m.el).textContent = `Đã chọn ${picked.size}`;
      });
    };
    draw();
    $('#flt', m.el).oninput = debounce((e) => draw(e.target.value), 150);
    $('#doImport', m.el).onclick = (e) => run(e.currentTarget, async () => {
      if (!picked.size) throw new Error('Chưa chọn gói nào');
      const r = await api('/admin/services/import', {
        method: 'POST',
        body: { server_orders: [...picked], category_id: $('[name=category_id]', m.el).value, markup: $('[name=markup]', m.el).value },
      });
      toast(`Đã nhập ${r.count} dịch vụ. Kiểm tra lại kiểu nhập và mô tả nhé.`);
      m.close();
      load();
    });
  }

  $('#addSvc').onclick = () => (cats.length ? svcModal() : toast('Tạo danh mục trước', true));
  $('#importBtn').onclick = (e) => importModal(e.currentTarget);
  $('#tplVerify').onclick = () => formModal({
    title: 'Tạo nhanh dịch vụ Tích xanh Facebook',
    fields: [
      { name: 'price_personal', label: 'Giá tích xanh FB cá nhân (đ)', type: 'number', hint: 'Để trống nếu không bán gói này' },
      { name: 'price_page', label: 'Giá tích xanh Fanpage (đ)', type: 'number' },
      { name: 'cost', label: 'Giá vốn mỗi đơn (đ, không bắt buộc)', type: 'number', full: true },
    ],
    extra: `<div class="callout full">Khách gửi link FB + SĐT/Zalo trong bot → bị trừ tiền → đơn vào tab <b>Đơn dịch vụ</b> (lọc "Chỉ đơn tích xanh").
      Bạn bấm <b>Nhận xử lý</b>, làm xong bấm <b>Hoàn thành</b>; không làm được thì <b>Hoàn tiền</b>.</div>`,
    submit: 'Tạo dịch vụ',
    onSubmit: async (v) => { const r = await api('/admin/services/template-verify', { method: 'POST', body: v }); toast(`Đã tạo ${r.count} gói tích xanh`); load(); return true; },
  });

  await load();
}

// ================================================================ accounts
async function pageAccounts(view, stale) {
  $('#topbarRight').innerHTML = '<button class="btn" id="gamesBtn">Quản lý game</button><button class="btn primary" id="addAcc">Đăng acc</button>';
  exportBtn('accounts');
  const st = { game: '', status: '', q: '', page: 0 };
  let games = await api('/admin/games');
  if (stale()) return;

  view.innerHTML = `<div class="toolbar">
      <div class="seg" id="stTabs">${[['', 'Tất cả'], ...Object.entries(ACC_STATUS).map(([k, v]) => [k, v[0]])]
        .map(([k, l]) => `<button data-s="${k}" class="${k === st.status ? 'on' : ''}">${l}</button>`).join('')}</div>
      <select id="gameF"><option value="">Tất cả game</option>${games.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select>
      <div class="grow"></div><input type="search" id="q" placeholder="Mã acc, tiêu đề…"></div><div id="accList"></div>`;
  $$('#stTabs button', view).forEach((b) => b.onclick = () => {
    st.status = b.dataset.s; st.page = 0;
    $$('#stTabs button', view).forEach((x) => x.classList.toggle('on', x === b));
    load();
  });
  $('#gameF', view).onchange = (e) => { st.game = e.target.value; st.page = 0; load(); };
  $('#q', view).oninput = debounce((e) => { st.q = e.target.value; st.page = 0; load(); });

  async function load() {
    const data = await api(`/admin/accounts?${new URLSearchParams(st)}`).catch((e) => (toast(e.message, true), null));
    if (!data || stale()) return;
    const box = $('#accList', view);
    if (!data.items.length) {
      box.innerHTML = `<div class="card empty">${games.length ? 'Chưa có acc nào. Bấm "Đăng acc" để thêm.' : 'Tạo game trước (vd: Liên Quân, Free Fire) bằng nút "Quản lý game".'}</div>`;
      return;
    }
    box.innerHTML = `<div class="acc-grid">${data.items.map((a) => {
      const imgs = JSON.parse(a.images || '[]');
      return `<div class="card acc">
        <div class="thumb" style="${imgs[0] ? `background-image:url('${esc(imgSrc(imgs[0]))}')` : ''}">${badge(ACC_STATUS, accState(a))}${imgs.length > 1 ? `<span class="count">${imgs.length} ảnh</span>` : ''}</div>
        <div class="body"><div class="muted small">#${a.id} · ${esc(a.game || '')} · ${a.delivery === 'manual' ? 'giao thủ công' : 'giao tự động'}</div><div class="title">${esc(a.title || 'Acc')}</div><div class="info">${esc(a.info)}</div></div>
        <div class="foot"><span class="price">${money(a.price)}</span>
          <span><button class="btn sm" data-edit="${a.id}">${a.status === 'sold' ? 'Xem' : 'Sửa'}</button><button class="btn sm danger" data-del="${a.id}">Xóa</button></span></div>
        ${a.status === 'sold' ? `<div class="foot small" style="display:block">${userCell(a, a.buyer_id)}<div class="muted">${money(a.sold_price)} · ${fmtTime(a.sold_at)}</div></div>` : ''}
        ${accState(a) === 'pending' ? `<div class="foot"><button class="btn sm primary" data-deliver="${a.id}">Giao acc</button><button class="btn sm" data-refund="${a.id}">Hoàn tiền</button></div>` : ''}
      </div>`;
    }).join('')}</div>`;
    if (data.total > data.page_size) {
      const c = document.createElement('div');
      c.className = 'card';
      c.style.marginTop = '16px';
      c.append(pager(data, (p) => { st.page = p; load(); }));
      box.append(c);
    }
    $$('[data-edit]', box).forEach((b) => b.onclick = () => accModal(data.items.find((a) => a.id == b.dataset.edit)));
    $$('[data-deliver]', box).forEach((b) => b.onclick = () => {
      const a = data.items.find((x) => x.id == b.dataset.deliver);
      formModal({
        title: `Giao acc #${a.id} cho ${userLabel(a)}`,
        fields: [
          { name: 'secret', label: 'Thông tin đăng nhập gửi cho khách', type: 'textarea', rows: 4, full: true, required: true },
          { name: 'note', label: 'Ghi chú thêm (không bắt buộc)', full: true },
        ],
        values: { secret: a.secret },
        submit: 'Giao qua bot',
        onSubmit: async (v) => {
          const r = await api(`/admin/accounts/${a.id}/deliver`, { method: 'POST', body: v });
          toast(r.sent ? 'Đã giao acc và gửi tin cho khách' : 'Đã giao, nhưng không gửi được tin (khách có thể đã chặn bot)', !r.sent);
          load();
          return true;
        },
      });
    });
    $$('[data-refund]', box).forEach((b) => b.onclick = async () => {
      const a = data.items.find((x) => x.id == b.dataset.refund);
      formModal({
        title: `Hoàn ${money(a.sold_price)} cho khách`,
        fields: [{ name: 'note', label: 'Lý do (gửi cho khách)', full: true }],
        submit: 'Hoàn tiền',
        onSubmit: async (v) => {
          await api(`/admin/accounts/${a.id}/refund`, { method: 'POST', body: v });
          toast('Đã hoàn tiền, acc chuyển sang trạng thái ẩn');
          load();
          return true;
        },
      });
    });
    $$('[data-del]', box).forEach((b) => b.onclick = async () => {
      if (await confirmModal('Xóa acc', `Xóa acc #${b.dataset.del} và ảnh của nó?`, { danger: true, ok: 'Xóa' })) {
        await run(null, () => api(`/admin/accounts/${b.dataset.del}`, { method: 'DELETE' }), 'Đã xóa');
        load();
      }
    });
  }

  function accModal(a) {
    if (!games.length) return toast('Tạo game trước', true);
    let images = a ? JSON.parse(a.images || '[]') : [];
    const sold = a?.status === 'sold';
    formModal({
      title: a ? `Acc #${a.id}` : 'Đăng acc mới',
      wide: true,
      submit: sold ? 'Lưu thay đổi' : 'Lưu',
      fields: [
        { name: 'game_id', label: 'Game', type: 'select', options: games.map((g) => [g.id, g.name]), required: true },
        { name: 'title', label: 'Tiêu đề ngắn', placeholder: 'VIP 5 · 120 tướng · 3 SSS', required: true },
        { name: 'price', label: 'Giá bán (đ)', type: 'number', required: true },
        { name: 'cost', label: 'Giá nhập (đ)', type: 'number', hint: 'Không hiển thị cho khách, dùng tính lãi' },
        { name: 'info', label: 'Thông tin hiển thị', type: 'textarea', full: true, rows: 4, placeholder: 'Cấp VIP: VIP 5\nRank: Cao Thủ\n3 SSS, nhiều skin SS' },
        { name: 'description', label: 'Mô tả thêm', full: true, placeholder: 'Log GRN FB (hỗ trợ tách)' },
        ...(sold ? [] : [
          { name: 'delivery', label: 'Cách giao acc', type: 'select', options: [['auto', 'Tự động — gửi ngay sau khi thanh toán'], ['manual', 'Thủ công — admin giao sau (acc giá trị cao)']] },
          { name: 'status', label: 'Trạng thái', type: 'select', options: [['available', 'Còn hàng (hiển thị)'], ['hidden', 'Ẩn']] },
        ]),
        { name: 'secret', label: 'Thông tin đăng nhập (chỉ gửi cho người mua, được mã hóa)', type: 'textarea', full: true, rows: 3, placeholder: 'Tài khoản: ...\nMật khẩu: ...', hint: 'Bắt buộc với acc giao tự động. Acc giao thủ công có thể để trống và nhập khi giao.' },
      ],
      values: a || { game_id: st.game || games[0].id, status: 'available', delivery: 'auto' },
      extra: `<div class="full"><label class="field"><span>Ảnh acc (tối đa 10, ảnh đầu là ảnh bìa)</span></label>
        <div class="img-list" id="imgs"></div>
        <label class="dropzone" id="drop" for="accFile" style="margin-top:8px"><b>Bấm để chọn ảnh</b> hoặc kéo thả ảnh vào đây</label>
        <input type="file" id="accFile" class="file-input" accept="image/png,image/jpeg,image/webp,image/gif" multiple>
        <div class="copy" style="margin-top:8px"><input id="imgUrl" placeholder="Hoặc dán link ảnh https://…"><button type="button" class="btn" id="addUrl">Thêm</button></div></div>`,
      onMount: (el, form) => {
        if (sold) form.price.readOnly = true;
        const draw = () => {
          $('#imgs', el).innerHTML = images.map((x, i) => `<div class="img" style="background-image:url('${esc(imgSrc(x))}')"><button type="button" data-rm="${i}" aria-label="Xóa ảnh">×</button></div>`).join('');
          $$('[data-rm]', el).forEach((b) => b.onclick = () => { images.splice(Number(b.dataset.rm), 1); draw(); });
        };
        draw();
        const upload = async (files) => {
          files = [...files].filter((f) => f.type.startsWith('image/')).slice(0, 10 - images.length);
          if (!files.length) return;
          $('#drop', el).textContent = `Đang nén và tải ${files.length} ảnh…`;
          try {
            const r = await uploadImages(files, 'acc');
            images.push(...r.keys);
            draw();
          } catch (e) {
            toast(e.message, true);
          }
          $('#drop', el).innerHTML = '<b>Bấm để chọn ảnh</b> hoặc kéo thả ảnh vào đây';
        };
        // <label for> mở hộp chọn file trực tiếp, chạy được trên mọi trình duyệt kể cả điện thoại
        const input = $('#accFile', el);
        input.onchange = () => { const files = [...input.files]; input.value = ''; upload(files); };
        const drop = $('#drop', el);
        drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('drag'); };
        drop.ondragleave = () => drop.classList.remove('drag');
        drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('drag'); upload(e.dataTransfer.files); };
        el.addEventListener('paste', (e) => {
          const files = [...(e.clipboardData?.files || [])];
          if (files.length) { e.preventDefault(); upload(files); }
        });
        $('#addUrl', el).onclick = () => {
          const u = $('#imgUrl', el).value.trim();
          if (!/^https:\/\/\S+$/.test(u)) return toast('Link ảnh phải bắt đầu bằng https://', true);
          if (images.length >= 10) return toast('Tối đa 10 ảnh', true);
          images.push(u);
          $('#imgUrl', el).value = '';
          draw();
        };
      },
      onSubmit: async (v) => {
        const body = { ...v, images };
        await api(a ? `/admin/accounts/${a.id}` : '/admin/accounts', { method: a ? 'PUT' : 'POST', body });
        toast(a ? 'Đã lưu' : 'Đã đăng acc');
        load();
        return true;
      },
    });
  }

  function gamesModal() {
    const m = openModal({
      title: 'Quản lý game',
      body: `<div id="glist"></div><form class="copy" id="gadd" style="margin-top:14px"><input name="name" placeholder="Tên game mới, vd: Liên Quân" required><button class="btn primary">Thêm</button></form>`,
    });
    const draw = () => {
      $('#glist', m.el).innerHTML = `<div class="card">${table([
        { label: 'Game', render: (g) => `<input value="${esc(g.name)}" data-name="${g.id}">` },
        { label: 'Còn / Đã bán', cls: 'nowrap num', render: (g) => `${g.available} / ${g.sold}` },
        { label: 'Hiện', render: (g) => `<input type="checkbox" data-active="${g.id}" ${g.active ? 'checked' : ''}>` },
        { label: '', cls: 'actions', render: (g) => `<button class="btn sm" data-save="${g.id}">Lưu</button><button class="btn sm danger" data-gdel="${g.id}">Xóa</button>` },
      ], games, 'Chưa có game')}</div>`;
      $$('[data-save]', m.el).forEach((b) => b.onclick = () => run(b, async () => {
        const id = b.dataset.save;
        await api(`/admin/games/${id}`, { method: 'PUT', body: { name: $(`[data-name="${id}"]`, m.el).value, active: $(`[data-active="${id}"]`, m.el).checked } });
        await reloadGames();
      }, 'Đã lưu'));
      $$('[data-gdel]', m.el).forEach((b) => b.onclick = () => run(b, async () => {
        await api(`/admin/games/${b.dataset.gdel}`, { method: 'DELETE' });
        await reloadGames();
      }, 'Đã xóa'));
    };
    const reloadGames = async () => {
      games = await api('/admin/games');
      draw();
      $('#gameF', view).innerHTML = `<option value="">Tất cả game</option>${games.map((g) => `<option value="${g.id}" ${String(g.id) === st.game ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}`;
    };
    draw();
    $('#gadd', m.el).onsubmit = (e) => {
      e.preventDefault();
      run($('button', e.target), async () => {
        await api('/admin/games', { method: 'POST', body: { name: e.target.name.value, sort: games.length } });
        e.target.reset();
        await reloadGames();
      });
    };
  }

  $('#addAcc').onclick = () => accModal();
  $('#gamesBtn').onclick = gamesModal;
  await load();
}

// ================================================================ topups
async function pageTopups(view, stale) {
  const st = { status: '', q: '', page: 0 };
  exportBtn('topups');
  view.innerHTML = `<div class="toolbar">
      <div class="seg" id="tabs">${[['', 'Tất cả'], ...Object.entries(TOPUP_STATUS).map(([k, v]) => [k, v[0]])]
        .map(([k, l]) => `<button data-s="${k}" class="${k === st.status ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="grow"></div><input type="search" id="q" placeholder="ID khách, nội dung, mã GD…"></div><div class="card" id="list"></div>`;
  $$('#tabs button', view).forEach((b) => b.onclick = () => {
    st.status = b.dataset.s; st.page = 0;
    $$('#tabs button', view).forEach((x) => x.classList.toggle('on', x === b));
    load();
  });
  $('#q', view).oninput = debounce((e) => { st.q = e.target.value; st.page = 0; load(); });

  async function load() {
    const data = await api(`/admin/topups?${new URLSearchParams(st)}`).catch((e) => (toast(e.message, true), null));
    if (!data || stale()) return;
    const list = $('#list', view);
    list.innerHTML = table([
      { label: 'Thời gian', cls: 'nowrap', render: (t) => fmtTime(t.created_at) },
      { label: 'Số tiền', cls: 'right num', render: (t) => `<b>${money(t.amount)}</b>${t.bonus ? `<div class="sub">+${money(t.bonus)} KM</div>` : ''}` },
      { label: 'Nội dung', cls: 'link-cell', render: (t) => `<span title="${esc(t.content)}">${esc(t.content)}</span><div class="sub">${esc(t.gateway)} · ${esc(t.reference)}</div>` },
      { label: 'Khách', render: (t) => userCell(t) },
      { label: 'Trạng thái', render: (t) => badge(TOPUP_STATUS, t.status) },
      { label: '', cls: 'actions', render: (t) => (t.status === 'unmatched' ? `<button class="btn sm primary" data-assign="${t.id}">Cộng cho khách</button><button class="btn sm" data-ignore="${t.id}">Bỏ qua</button>` : '') },
    ], data.items, 'Chưa có giao dịch nào. Kiểm tra cấu hình webhook SePay trong Cài đặt.');
    if (data.total > data.page_size) list.append(pager(data, (p) => { st.page = p; load(); }));
    $$('[data-assign]', list).forEach((b) => b.onclick = () => {
      const t = data.items.find((x) => x.id == b.dataset.assign);
      formModal({
        title: `Cộng ${money(t.amount)} cho khách`,
        fields: [{ name: 'user_id', label: 'Mã khách', required: true, type: 'number', hint: `Mã khách xem trong bot (mục Tài khoản) hoặc trang Người dùng. Nội dung CK: ${esc(t.content)}` }],
        submit: 'Cộng tiền',
        onSubmit: async (v) => { await api(`/admin/topups/${t.id}/assign`, { method: 'POST', body: v }); toast('Đã cộng tiền và báo cho khách'); load(); return true; },
      });
    });
    $$('[data-ignore]', list).forEach((b) => b.onclick = () => run(b, async () => {
      await api(`/admin/topups/${b.dataset.ignore}/ignore`, { method: 'POST' });
      load();
    }));
  }
  await load();
}

// ================================================================ users
async function pageUsers(view, stale) {
  const st = { q: '', sort: '', bot: hashParams().get('bot') || '', page: 0 };
  exportBtn('users');
  const bots = await api('/admin/bots').catch(() => []);
  if (stale()) return;
  view.innerHTML = `<div class="toolbar"><input type="search" id="q" placeholder="Mã khách, ID Telegram, @username…">
      <select id="bot"><option value="">Tất cả bot</option><option value="0">Bot gốc</option>${bots.map((b) => `<option value="${b.id}">@${esc(b.username)}</option>`).join('')}</select>
      <select id="sort"><option value="">Hoạt động gần đây</option><option value="balance">Số dư cao nhất</option>
      <option value="topup">Nạp nhiều nhất</option><option value="spent">Chi tiêu nhiều nhất</option><option value="commission">Hoa hồng nhiều nhất</option></select></div>
    <div class="card" id="list"></div>`;
  $('#bot', view).value = st.bot;
  $('#q', view).oninput = debounce((e) => { st.q = e.target.value; st.page = 0; load(); });
  $('#sort', view).onchange = (e) => { st.sort = e.target.value; st.page = 0; load(); };
  $('#bot', view).onchange = (e) => { st.bot = e.target.value; st.page = 0; load(); };

  async function load() {
    const data = await api(`/admin/users?${new URLSearchParams(st)}`).catch((e) => (toast(e.message, true), null));
    if (!data || stale()) return;
    const list = $('#list', view);
    list.innerHTML = table([
      { label: 'Khách', render: (u) => `<b>${esc(u.first_name || '—')}</b> ${botTag(u)}${u.banned ? ' <span class="badge bad">Khóa</span>' : ''}${u.has_api ? ' <span class="badge">API</span>' : ''}
          <div class="sub">${u.username ? `@${esc(u.username)} · ` : ''}<span class="mono">mã ${u.id} · tg ${u.tg_id}</span></div>` },
      { label: 'Số dư', cls: 'right num', render: (u) => `<b>${money(u.balance)}</b>` },
      { label: 'Đã nạp', cls: 'right num', render: (u) => money(u.total_topup) },
      { label: 'Đã dùng', cls: 'right num', render: (u) => money(u.total_spent) },
      { label: 'Hoa hồng', cls: 'right num', render: (u) => (u.commission_total ? money(u.commission_total) : '<span class="muted">—</span>') },
      { label: 'Hoạt động', cls: 'nowrap', render: (u) => fmtTime(u.last_seen) },
      { label: '', cls: 'actions', render: (u) => `<button class="btn sm" data-id="${u.id}">Chi tiết</button>` },
    ], data.items, 'Chưa có người dùng. Người dùng được tạo khi bấm /start trên bot.');
    if (data.total > data.page_size) list.append(pager(data, (p) => { st.page = p; load(); }));
    $$('[data-id]', list).forEach((b) => b.onclick = () => userModal(b.dataset.id, load));
  }
  await load();
}

async function userModal(id, reload) {
  const d = await api(`/admin/users/${id}`).catch((e) => toast(e.message, true));
  if (!d) return;
  const u = d.user;
  const m = openModal({
    title: u.first_name || `Khách ${u.id}`,
    wide: true,
    body: `<dl class="kv">
        <dt>Mã khách</dt><dd class="mono">${u.id} · Telegram ${u.tg_id}</dd>
        <dt>Thuộc bot</dt><dd>${u.bot_id ? `Bot con @${esc(u.bot_username)}` : 'Bot gốc'}</dd>
        <dt>Username</dt><dd>${u.username ? `<a href="https://t.me/${esc(u.username)}" target="_blank" rel="noopener">@${esc(u.username)}</a>` : '—'}</dd>
        <dt>Số dư</dt><dd><b>${money(u.balance)}</b></dd>
        <dt>Đã nạp / đã dùng</dt><dd>${money(u.total_topup)} / ${money(u.total_spent)}</dd>
        ${u.commission_total ? `<dt>Hoa hồng</dt><dd>${money(u.commission_total)} · đã rút ${money(u.withdrawn_total)}</dd>` : ''}
        ${d.bots.length ? `<dt>Bot con sở hữu</dt><dd>${d.bots.map((b) => `@${esc(b.username)} (${b.markup}%${b.active ? '' : ', tạm dừng'})`).join(', ')}</dd>` : ''}
        <dt>API key</dt><dd>${u.api_key ? `<span class="mono">${esc(u.api_key)}</span> <button class="btn sm danger" id="revoke">Thu hồi</button>` : '—'}</dd>
        <dt>Tham gia</dt><dd>${fmtTime(u.created_at)} · hoạt động ${fmtTime(u.last_seen)}</dd>
        <dt>Trạng thái</dt><dd>${u.banned ? '<span class="badge bad">Đang khóa</span>' : '<span class="badge good">Bình thường</span>'}</dd></dl>
      <div class="seg" id="utabs" style="margin-top:18px"><button data-t="logs" class="on">Biến động số dư</button><button data-t="orders">Đơn hàng (${d.orders.length})</button><button data-t="accs">Acc đã mua (${d.accounts.length})</button></div>
      <div class="card" style="margin-top:12px;max-height:40vh;overflow:auto" id="utab"></div>`,
    foot: `<button class="btn ${u.banned ? '' : 'danger'}" id="ban" style="margin-right:auto">${u.banned ? 'Mở khóa' : 'Khóa tài khoản'}</button>
      <button class="btn" id="msg">Nhắn tin</button><button class="btn primary" id="bal">Cộng / trừ tiền</button>`,
  });
  const tabs = {
    logs: () => table([
      { label: 'Thời gian', cls: 'nowrap', render: (l) => fmtTime(l.created_at) },
      { label: 'Loại', render: (l) => esc(LOG_TYPE[l.type] || l.type) + (l.ref ? ` <span class="muted">${esc(l.ref)}</span>` : '') },
      { label: 'Số tiền', cls: 'right num', render: (l) => `<span class="${l.amount > 0 ? 'amount-pos' : 'amount-neg'}">${l.amount > 0 ? '+' : ''}${money(l.amount)}</span>` },
      { label: 'Số dư sau', cls: 'right num', render: (l) => money(l.balance_after) },
      { label: 'Ghi chú', render: (l) => esc(l.note) },
    ], d.logs),
    orders: () => table([
      { label: 'Mã', render: (o) => `#${o.id}` },
      { label: 'Dịch vụ', render: (o) => esc(o.service_name) },
      { label: 'Tiền', cls: 'right num', render: (o) => money(o.price_total) },
      { label: 'Trạng thái', render: (o) => badge(ORDER_STATUS, o.status) },
      { label: 'Thời gian', cls: 'nowrap', render: (o) => fmtTime(o.created_at) },
    ], d.orders),
    accs: () => table([
      { label: 'Acc', render: (a) => `#${a.id} ${esc(a.title)}` },
      { label: 'Giá', cls: 'right num', render: (a) => money(a.sold_price) },
      { label: 'Giao', render: (a) => (a.delivered_at ? '<span class="badge good">Đã giao</span>' : '<span class="badge warn">Chờ giao</span>') },
      { label: 'Ngày mua', cls: 'nowrap', render: (a) => fmtTime(a.sold_at) },
    ], d.accounts),
  };
  const show = (t) => { $('#utab', m.el).innerHTML = tabs[t](); $$('#utabs button', m.el).forEach((b) => b.classList.toggle('on', b.dataset.t === t)); };
  show('logs');
  $$('#utabs button', m.el).forEach((b) => b.onclick = () => show(b.dataset.t));
  $('#revoke', m.el)?.addEventListener('click', (e) => run(e.currentTarget, async () => {
    await api(`/admin/users/${u.id}/revoke-api`, { method: 'POST' });
    m.close();
    reload();
  }, 'Đã thu hồi API key'));
  $('#bal', m.el).onclick = () => {
    m.close();
    formModal({
      title: `Điều chỉnh số dư · mã ${u.id}`,
      fields: [
        { name: 'amount', label: 'Số tiền (đ)', type: 'number', required: true, hint: 'Số dương để cộng, số âm để trừ. Vd: 50000 hoặc -20000' },
        { name: 'note', label: 'Lý do', full: true },
        { name: 'notify', label: 'Gửi thông báo cho khách qua bot', type: 'checkbox', full: true },
      ],
      values: { notify: true },
      submit: 'Xác nhận',
      onSubmit: async (v) => { const r = await api(`/admin/users/${u.id}/balance`, { method: 'POST', body: v }); toast(`Số dư mới: ${money(r.balance)}`); reload(); return true; },
    });
  };
  $('#msg', m.el).onclick = () => {
    m.close();
    formModal({
      title: `Nhắn tin cho ${u.first_name || u.id}`,
      fields: [{ name: 'text', label: 'Nội dung (hỗ trợ <b>, <i>, <code>)', type: 'textarea', required: true, full: true }],
      submit: 'Gửi',
      onSubmit: async (v) => { await api(`/admin/users/${u.id}/message`, { method: 'POST', body: v }); toast('Đã gửi'); return true; },
    });
  };
  $('#ban', m.el).onclick = (e) => run(e.currentTarget, async () => {
    await api(`/admin/users/${u.id}/ban`, { method: 'POST', body: { banned: !u.banned } });
    m.close();
    reload();
  }, u.banned ? 'Đã mở khóa' : 'Đã khóa');
}

// ================================================================ resellers
async function pageResellers(view, stale) {
  const [bots, wds] = await Promise.all([api('/admin/bots'), api('/admin/withdrawals')]);
  if (stale()) return;
  view.innerHTML = `
    <div class="callout" style="margin-bottom:16px">Khách tạo bot con và lấy API key trong mục <b>Đại lý &amp; API</b> của bot gốc.
      Giá bot con = giá đại lý × (1 + % lãi của chủ bot). Hoa hồng được cộng vào số dư chủ bot khi đơn kết thúc hoặc acc được giao.
      Chỉnh tỷ lệ đại lý và khoảng % lãi trong <a href="#/settings">Cài đặt</a>.</div>
    <div class="card"><div class="card-head"><h3>Lệnh rút hoa hồng</h3></div><div class="card-body" style="padding:12px 0 0" id="wd"></div></div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h3>Bot con (${bots.length})</h3></div><div class="card-body" style="padding:12px 0 0" id="bots"></div></div>`;

  const drawWd = (data) => {
    $('#wd', view).innerHTML = table([
      { label: 'Mã', render: (w) => `#${w.id}` },
      { label: 'Khách', render: (w) => userCell(w) },
      { label: 'Số tiền', cls: 'right num', render: (w) => `<b>${money(w.amount)}</b>` },
      { label: 'Nhận tiền', render: (w) => `<span class="mono">${esc(w.bank_info)}</span>${w.note ? `<div class="sub">${esc(w.note)}</div>` : ''}` },
      { label: 'Trạng thái', render: (w) => badge(WD_STATUS, w.status) },
      { label: 'Thời gian', cls: 'nowrap', render: (w) => fmtTime(w.created_at) },
      { label: '', cls: 'actions', render: (w) => (w.status === 'pending' ? `<button class="btn sm primary" data-ok="${w.id}">Đã chuyển</button><button class="btn sm" data-no="${w.id}">Từ chối</button>` : '') },
    ], data.items, 'Chưa có lệnh rút nào');
    const act = (wid, kind) => formModal({
      title: kind === 'approve' ? `Xác nhận đã chuyển lệnh #${wid}` : `Từ chối lệnh #${wid} (hoàn tiền vào số dư)`,
      fields: [{ name: 'note', label: kind === 'approve' ? 'Ghi chú (vd mã giao dịch)' : 'Lý do', full: true }],
      submit: kind === 'approve' ? 'Xác nhận' : 'Từ chối',
      onSubmit: async (v) => {
        await api(`/admin/withdrawals/${wid}/${kind}`, { method: 'POST', body: v });
        toast('Đã cập nhật');
        drawWd(await api('/admin/withdrawals'));
        refreshBadges();
        return true;
      },
    });
    $$('[data-ok]', view).forEach((b) => b.onclick = () => act(b.dataset.ok, 'approve'));
    $$('[data-no]', view).forEach((b) => b.onclick = () => act(b.dataset.no, 'reject'));
  };
  drawWd(wds);

  const drawBots = (list) => {
    $('#bots', view).innerHTML = table([
      { label: 'Bot', render: (b) => `<a href="https://t.me/${esc(b.username)}" target="_blank" rel="noopener"><b>@${esc(b.username)}</b></a><div class="sub">${esc(b.name || '')}</div>` },
      { label: 'Chủ bot', render: (b) => `${esc(b.owner_username ? `@${b.owner_username}` : b.owner_name || '')}<div class="sub mono">mã ${b.owner_id} · tg ${b.owner_tg}</div>` },
      { label: '% lãi', cls: 'right num', render: (b) => `${b.markup}%` },
      { label: 'Khách', cls: 'right num', render: (b) => `<a href="#/users?bot=${b.id}">${num(b.users)}</a>` },
      { label: 'Doanh số', cls: 'right num', render: (b) => money(b.revenue) },
      { label: 'Hoa hồng đã trả', cls: 'right num', render: (b) => money(b.commission) },
      { label: 'Số dư khách', cls: 'right num', render: (b) => money(b.user_balance) },
      { label: 'Trạng thái', render: (b) => (b.active ? '<span class="badge good">Đang chạy</span>' : '<span class="badge">Tạm dừng</span>') },
      { label: '', cls: 'actions', render: (b) => `<button class="btn sm" data-edit="${b.id}">Sửa</button><button class="btn sm danger" data-del="${b.id}">Xóa</button>` },
    ], list, 'Chưa có bot con nào');
    $$('[data-edit]', view).forEach((x) => x.onclick = () => {
      const b = list.find((y) => y.id == x.dataset.edit);
      formModal({
        title: `Bot @${b.username}`,
        fields: [
          { name: 'markup', label: '% lãi trên giá đại lý', type: 'number', step: 'any', required: true },
          { name: 'active', label: 'Đang hoạt động', type: 'checkbox' },
        ],
        values: b,
        onSubmit: async (v) => { await api(`/admin/bots/${b.id}`, { method: 'PUT', body: v }); drawBots(await api('/admin/bots')); return true; },
      });
    });
    $$('[data-del]', view).forEach((x) => x.onclick = async () => {
      const b = list.find((y) => y.id == x.dataset.del);
      if (!(await confirmModal('Xóa bot con', `Xóa @${esc(b.username)} khỏi hệ thống? Bot sẽ ngừng nhận tin nhắn.`, { danger: true, ok: 'Xóa' }))) return;
      await run(null, async () => { await api(`/admin/bots/${b.id}`, { method: 'DELETE' }); drawBots(await api('/admin/bots')); }, 'Đã xóa');
    });
  };
  drawBots(bots);
}

// ================================================================ giftcodes
async function pageGiftcodes(view, stale) {
  $('#topbarRight').innerHTML = '<button class="btn primary" id="addGift">Tạo mã</button>';
  const load = async () => {
    const list = await api('/admin/giftcodes');
    if (stale()) return;
    const t = Math.floor(Date.now() / 1000);
    view.innerHTML = `<div class="callout" style="margin-bottom:16px">Khách nhập mã trong bot: <b>Tài khoản → Nhập mã quà tặng</b> hoặc gõ <b>/code</b>.
        Mỗi tài khoản Telegram chỉ dùng một mã một lần (kể cả qua bot con).</div><div class="card">${table([
      { label: 'Mã', render: (g) => `<span class="code-chip" data-copy="${esc(g.code)}" title="Bấm để sao chép">${esc(g.code)}</span>${g.note ? `<div class="sub">${esc(g.note)}</div>` : ''}` },
      { label: 'Giá trị', cls: 'right num', render: (g) => `<b>${money(g.amount)}</b>` },
      { label: 'Đã dùng', cls: 'right num', render: (g) => `${num(g.used)} / ${num(g.max_uses)}` },
      { label: 'Hết hạn', cls: 'nowrap', render: (g) => (g.expires_at ? fmtTime(g.expires_at) : '<span class="muted">Không</span>') },
      { label: 'Trạng thái', render: (g) => (!g.active ? '<span class="badge">Đã tắt</span>'
        : g.expires_at && g.expires_at < t ? '<span class="badge">Hết hạn</span>'
        : g.used >= g.max_uses ? '<span class="badge info">Hết lượt</span>' : '<span class="badge good">Đang mở</span>') },
      { label: '', cls: 'actions', render: (g) => `<button class="btn sm" data-tg="${g.id}" data-on="${g.active ? 0 : 1}">${g.active ? 'Tắt' : 'Bật'}</button><button class="btn sm danger" data-del="${g.id}">Xóa</button>` },
    ], list, 'Chưa có mã quà tặng nào')}</div>`;
    $$('[data-copy]', view).forEach((c) => c.onclick = () => navigator.clipboard.writeText(c.dataset.copy).then(() => toast('Đã sao chép mã')));
    $$('[data-tg]', view).forEach((b) => b.onclick = () => run(b, async () => {
      await api(`/admin/giftcodes/${b.dataset.tg}`, { method: 'PUT', body: { active: b.dataset.on === '1' } });
      load();
    }));
    $$('[data-del]', view).forEach((b) => b.onclick = async () => {
      if (await confirmModal('Xóa mã', 'Xóa mã quà tặng này? Lượt đã dùng vẫn giữ trong lịch sử số dư của khách.', { danger: true, ok: 'Xóa' })) {
        await run(null, () => api(`/admin/giftcodes/${b.dataset.del}`, { method: 'DELETE' }), 'Đã xóa');
        load();
      }
    });
  };
  $('#addGift').onclick = () => formModal({
    title: 'Tạo mã quà tặng',
    fields: [
      { name: 'code', label: 'Mã (để trống để tạo ngẫu nhiên)', placeholder: 'KHAITRUONG' },
      { name: 'amount', label: 'Giá trị (đ)', type: 'number', required: true },
      { name: 'max_uses', label: 'Số lượt dùng tối đa', type: 'number', required: true },
      { name: 'expires_at', label: 'Hết hạn (không bắt buộc)', type: 'date' },
      { name: 'note', label: 'Ghi chú', full: true },
    ],
    values: { max_uses: 100 },
    submit: 'Tạo mã',
    onSubmit: async (v) => {
      const g = await api('/admin/giftcodes', { method: 'POST', body: v });
      toast(`Đã tạo mã ${g.code}`);
      load();
      return true;
    },
  });
  await load();
}

// ================================================================ audit
const AUDIT_LABEL = {
  login: 'Đăng nhập', 'PUT settings': 'Lưu cài đặt', 'POST telegram/setup': 'Kết nối bot',
  'POST orders': 'Xử lý đơn', 'POST accounts': 'Đăng acc', 'PUT accounts': 'Sửa acc', 'DELETE accounts': 'Xóa acc',
  'POST accounts/deliver': 'Giao acc', 'POST accounts/refund': 'Hoàn tiền acc', 'POST services': 'Thêm dịch vụ',
  'PUT services': 'Sửa dịch vụ', 'DELETE services': 'Xóa dịch vụ', 'POST users/balance': 'Điều chỉnh số dư',
  'POST users/ban': 'Khóa/mở khóa', 'POST users/message': 'Nhắn tin khách', 'POST users/revoke-api': 'Thu hồi API key',
  'POST topups/assign': 'Cộng tiền giao dịch', 'POST topups/ignore': 'Bỏ qua giao dịch', 'POST withdrawals/approve': 'Duyệt rút tiền',
  'POST withdrawals/reject': 'Từ chối rút tiền', 'PUT bots': 'Sửa bot con', 'DELETE bots': 'Xóa bot con', 'POST broadcast': 'Gửi thông báo',
  'POST giftcodes': 'Tạo mã quà', 'PUT giftcodes': 'Bật/tắt mã quà', 'DELETE giftcodes': 'Xóa mã quà', 'POST upload': 'Tải ảnh',
};

async function pageAudit(view, stale) {
  const st = { q: '', page: 0 };
  view.innerHTML = `<div class="toolbar"><input type="search" id="q" placeholder="Tìm theo thao tác, mã, nội dung…"></div><div class="card" id="list"></div>`;
  $('#q', view).oninput = debounce((e) => { st.q = e.target.value; st.page = 0; load(); });
  async function load() {
    const data = await api(`/admin/audit?${new URLSearchParams(st)}`).catch((e) => (toast(e.message, true), null));
    if (!data || stale()) return;
    const list = $('#list', view);
    list.innerHTML = table([
      { label: 'Thời gian', cls: 'nowrap', render: (a) => fmtTime(a.created_at) },
      { label: 'Thao tác', render: (a) => `<b>${esc(AUDIT_LABEL[a.action] || a.action)}</b>${a.target ? ` <span class="muted">#${esc(a.target)}</span>` : ''}` },
      { label: 'Chi tiết', cls: 'link-cell', render: (a) => `<span class="mono" title="${esc(a.detail)}">${esc(a.detail || '')}</span>` },
      { label: 'IP', render: (a) => `<span class="mono">${esc(a.ip)}</span>` },
    ], data.items, 'Chưa có thao tác nào');
    if (data.total > data.page_size) list.append(pager(data, (p) => { st.page = p; load(); }));
  }
  await load();
}

// ================================================================ bộ nhớ ảnh R2
const mb = (b) => `${(b / 1048576).toLocaleString('vi-VN', { maximumFractionDigits: b < 10485760 ? 2 : 0 })} MB`;

async function pageStorage(view, stale) {
  const [st, s] = await Promise.all([api('/admin/storage'), api('/admin/settings')]);
  if (stale()) return;
  if (!st.enabled) {
    view.innerHTML = `<div class="card" style="max-width:760px"><div class="card-body">
      <h3 style="margin-bottom:8px">Chưa bật R2</h3>
      <p class="muted">Hệ thống đang chạy không có R2: đăng acc bằng <b>link ảnh https</b>, logo SHOPBOT có sẵn. Muốn tải ảnh trực tiếp:</p>
      <ol class="muted" style="line-height:1.8"><li>Cloudflare Dashboard → R2 Object Storage → bật (gói miễn phí 10GB).</li>
      <li>Chạy <code>npx wrangler r2 bucket create shopbot-images</code>.</li>
      <li>Bỏ dấu # ở khối <code>[[r2_buckets]]</code> trong <code>wrangler.toml</code> rồi deploy lại.</li></ol></div></div>`;
    return;
  }
  const u = st.usage;
  const pct = Math.min(100, (u.bytes / st.limit) * 100);
  const freePct = Math.min(100, (u.bytes / st.free) * 100);
  const color = pct > 90 ? 'var(--bad)' : pct > 70 ? 'var(--warn)' : 'var(--accent)';
  const p = st.plan;
  view.innerHTML = `<div class="stack" style="max-width:980px">
    <div class="grid kpis">
      ${kpi('Đang dùng', mb(u.bytes), `${num(u.files)} ảnh · ${freePct.toFixed(1)}% gói miễn phí 10GB`, '', pct > 90)}
      ${kpi('Ảnh acc', mb(u.acc.bytes), `${num(u.acc.files)} ảnh`)}
      ${kpi('Ảnh thương hiệu', mb(u.brand.bytes), `${num(u.brand.files)} ảnh (logo, banner)`)}
      ${kpi('Có thể dọn', mb(p.orphan_bytes + p.sold_bytes), `${num(p.orphan_files + p.sold_files)} ảnh`, '', p.orphan_files + p.sold_files > 0)}
    </div>
    <div class="card"><div class="card-head"><h3>Dung lượng so với giới hạn</h3><span class="muted small">${mb(u.bytes)} / ${mb(st.limit)}</span></div>
      <div class="card-body"><div style="height:12px;border-radius:99px;background:var(--surface-2);overflow:hidden"><div style="height:100%;width:${pct}%;background:${color};border-radius:99px;transition:width .6s"></div></div>
        <p class="muted small" style="margin:10px 0 0">Khi chạm giới hạn, hệ thống tự chặn tải ảnh mới và báo admin qua Telegram, nên không bị tính phí vượt gói. Ảnh được nén tự động trước khi tải lên và được cache ở Cloudflare để không tốn lượt đọc R2.</p></div></div>
    <div class="card"><div class="card-head"><h3>Dọn dẹp</h3><span class="muted small">${st.cleaned_at ? `Tự dọn lần cuối ${fmtTime(st.cleaned_at)} · mỗi 6 giờ` : 'Tự dọn mỗi 6 giờ'}</span></div>
      <div class="card-body">
        <div class="kv" style="margin-bottom:14px">
          <dt>Ảnh rác</dt><dd>${num(p.orphan_files)} ảnh · ${mb(p.orphan_bytes)} <span class="muted">(tải lên nhưng không gắn vào acc nào, quá 24 giờ)</span></dd>
          <dt>Ảnh acc đã bán</dt><dd>${st.sold_days ? `${num(p.sold_files)} ảnh của ${num(p.sold_accounts)} acc · ${mb(p.sold_bytes)} <span class="muted">(bán quá ${st.sold_days} ngày)</span>` : '<span class="muted">Đang giữ mãi (0 ngày)</span>'}</dd>
        </div>
        <form class="form-grid" id="stForm">
          ${fieldHtml({ name: 'r2_limit_mb', label: 'Giới hạn dung lượng (MB)', type: 'number', hint: 'Gói miễn phí 10.240MB. Nên để ~9.000MB để còn khoảng an toàn.' }, s.settings.r2_limit_mb)}
          ${fieldHtml({ name: 'r2_sold_days', label: 'Giữ ảnh acc đã bán (ngày)', type: 'number', hint: 'Sau số ngày này, ảnh của acc đã bán và đã giao được xóa. 0 = giữ mãi.' }, s.settings.r2_sold_days)}
          <div class="full" style="display:flex;gap:10px;flex-wrap:wrap">
            <button type="button" class="btn" id="stSave">Lưu thiết lập</button>
            <button type="button" class="btn primary" id="stClean">Dọn ngay</button>
            <button type="button" class="btn ghost" id="stScan">Quét lại bucket</button>
          </div>
        </form></div></div>
    <div class="card"><div class="card-head"><h3>Ảnh lớn nhất</h3></div>${table([
      { label: 'Ảnh', render: (f) => `<a href="/api/img/${esc(f.key)}" target="_blank" rel="noopener" class="mono">${esc(f.key)}</a>` },
      { label: 'Loại', render: (f) => (f.kind === 'brand' ? 'Thương hiệu' : 'Acc') },
      { label: 'Dung lượng', cls: 'right num', render: (f) => mb(f.size) },
      { label: 'Tải lên', cls: 'nowrap', render: (f) => fmtTime(f.created_at) },
    ], st.biggest, 'Chưa có ảnh nào trên R2')}</div></div>`;
  const form = $('#stForm', view);
  const save = () => api('/admin/settings', { method: 'PUT', body: { r2_limit_mb: form.r2_limit_mb.value, r2_sold_days: form.r2_sold_days.value } });
  $('#stSave', view).onclick = (e) => run(e.currentTarget, async () => { await save(); render(); }, 'Đã lưu');
  $('#stClean', view).onclick = (e) => run(e.currentTarget, async () => {
    await save();
    const r = await api('/admin/storage/clean', { method: 'POST' });
    toast(`Đã xóa ${num(r.orphan_files + r.sold_files)} ảnh, giải phóng ${mb(r.orphan_bytes + r.sold_bytes)}`);
    render();
  });
  $('#stScan', view).onclick = (e) => run(e.currentTarget, async () => {
    const r = await api('/admin/storage/reconcile', { method: 'POST' });
    toast(`Bucket có ${num(r.objects)} file, đã đồng bộ ${num(r.fixed)} mục`);
    render();
  });
}

// ================================================================ broadcast
async function pageBroadcast(view) {
  view.innerHTML = `<div class="card" style="max-width:720px"><div class="card-body">
    <form class="form-grid" id="bform">
      ${fieldHtml({ name: 'text', label: 'Nội dung thông báo', type: 'textarea', rows: 7, full: true, required: true,
        hint: 'Hỗ trợ định dạng Telegram: &lt;b&gt;đậm&lt;/b&gt;, &lt;i&gt;nghiêng&lt;/i&gt;, &lt;a href="..."&gt;link&lt;/a&gt;. Nếu kèm ảnh, nội dung tối đa 1024 ký tự.' })}
      ${fieldHtml({ name: 'photo', label: 'Link ảnh (không bắt buộc)', full: true, placeholder: 'https://…' })}
      ${fieldHtml({ name: 'scope', label: 'Gửi tới', type: 'select', full: true, options: [['root', 'Khách của bot gốc'], ['all', 'Khách của bot gốc và tất cả bot con']] })}
      <div class="full" style="display:flex;gap:12px;align-items:center"><button class="btn primary" id="bsend">Gửi cho tất cả</button><span class="muted" id="bprog"></span></div>
    </form></div></div>`;
  let running = false;
  $('#bform', view).onsubmit = async (e) => {
    e.preventDefault();
    if (running) return;
    const v = readForm(e.target);
    if (!(await confirmModal('Gửi thông báo', 'Gửi thông báo này tới toàn bộ người dùng chưa bị khóa?'))) return;
    running = true;
    $('#bsend', view).disabled = true;
    let offset = 0, sent = 0, failed = 0;
    try {
      // Gửi theo đợt 25 người để không vượt giới hạn thời gian của mỗi request
      while (offset !== null) {
        const r = await api('/admin/broadcast', { method: 'POST', body: { ...v, offset } });
        sent += r.sent; failed += r.failed; offset = r.next;
        if ($('#bprog')) $('#bprog').textContent = `Đã gửi ${num(sent)}/${num(r.total)} · lỗi ${failed}`;
      }
      toast(`Hoàn tất: ${num(sent)} thành công, ${failed} lỗi (thường do khách đã chặn bot)`);
    } catch (err) {
      toast(`Dừng giữa chừng: ${err.message}`, true);
    } finally {
      running = false;
      if ($('#bsend')) $('#bsend').disabled = false;
    }
  };
}

// ================================================================ settings
async function pageSettings(view, stale) {
  const { settings: s, base_url, has_bucket, has_data_key } = await api('/admin/settings');
  if (stale()) return;
  const wh = `${base_url}/api/sepay/webhook`;
  const card = (title, body, extra = '') => `<div class="card"><div class="card-head"><h3>${title}</h3>${extra}</div><div class="card-body"><div class="form-grid">${body}</div></div></div>`;
  const F = (f) => fieldHtml(f, s[f.name]);
  view.innerHTML = `<form id="sform" class="stack" style="max-width:900px">
    ${card('Thương hiệu', `
      <div class="field full"><span class="muted small">Logo (ảnh vuông, PNG/JPG/WEBP)</span>
        <div class="logo-edit" style="margin-top:8px"><div class="preview gmark" id="logoPreview"></div>
          <input type="hidden" name="logo" value="${esc(s.logo)}">
          <label class="btn" id="logoUp" for="logoFile">Tải logo lên</label><button type="button" class="btn ghost" id="logoRm">Gỡ logo</button>
          <input type="file" id="logoFile" class="file-input" accept="image/png,image/jpeg,image/webp"></div></div>
      <div class="field full"><span class="muted small">Kiểu logo dựng sẵn (dùng khi chưa tải logo riêng)</span>
        <input type="hidden" name="logo_style" value="${esc(s.logo_style || 'monogram')}">
        <div class="style-pick" id="stylePick" style="margin-top:8px">${Object.entries(MARK_NAMES).map(([k, n]) =>
          `<button type="button" data-style="${k}" class="${(s.logo_style || 'monogram') === k ? 'on' : ''}"><span class="gmark" data-mark="${k}"></span>${n}</button>`).join('')}</div></div>
      <div class="field full"><span class="muted small">Bộ màu (bấm để xem trước ngay, nhớ Lưu cài đặt)</span>
        <div class="style-pick" id="presetPick" style="margin-top:8px">${Object.entries(PRESETS).map(([k, [n, a, b]]) =>
          `<button type="button" data-a="${a}" data-b="${b}" class="${s.accent_color === a && s.accent_color2 === b ? 'on' : ''}"><span class="swatch" style="background:linear-gradient(135deg,${a},${b})"></span>${n}</button>`).join('')}</div></div>
      ${F({ name: 'shop_name', label: 'Tên shop', required: true })}
      <div class="field full"><span class="muted small">Logo lớn (trang chủ, trang đăng nhập, ảnh chào trong bot) — ảnh vuông</span>
        <div class="logo-edit" style="margin-top:8px"><div class="preview" id="artPreview" style="border-radius:12px;background:var(--surface-2) center/contain no-repeat"></div>
          <input type="hidden" name="hero_art" value="${esc(s.hero_art)}">
          <label class="btn" id="artUp" for="artFile">Tải ảnh lên</label><button type="button" class="btn ghost" id="artRm">Gỡ ảnh</button>
          <input type="file" id="artFile" class="file-input" accept="image/png,image/jpeg,image/webp"></div></div>
      <div class="field full"><span class="muted small">Ảnh banner trang chủ (ngang, nên ≥ 1600×700, vd ảnh tạo bằng AI)</span>
        <div class="logo-edit" style="margin-top:8px"><div class="preview" id="heroPreview" style="width:160px;border-radius:12px;background:var(--surface-2) center/cover"></div>
          <input type="hidden" name="hero_image" value="${esc(s.hero_image)}">
          <label class="btn" id="heroUp" for="heroFile">Tải ảnh lên</label><button type="button" class="btn ghost" id="heroRm">Gỡ ảnh</button>
          <input type="file" id="heroFile" class="file-input" accept="image/png,image/jpeg,image/webp"></div></div>
      <label class="field"><span>Màu chính / màu phụ (tự chọn)</span><div class="copy"><input type="color" id="accentPick" value="${esc(s.accent_color || '#ec4899')}"><input name="accent_color" value="${esc(s.accent_color || '#ec4899')}" maxlength="7">
        <input type="color" id="accentPick2" value="${esc(s.accent_color2 || '#8b5cf6')}"><input name="accent_color2" value="${esc(s.accent_color2 || '#8b5cf6')}" maxlength="7"></div></label>
      ${F({ name: 'tagline', label: 'Khẩu hiệu ngắn', full: true, hint: 'Hiện trên trang chủ, mô tả bot và khi chia sẻ link' })}
      ${F({ name: 'hero_title', label: 'Tiêu đề lớn trang chủ', full: true })}
      ${F({ name: 'hero_subtitle', label: 'Mô tả dưới tiêu đề', type: 'textarea', rows: 2, full: true })}
      ${F({ name: 'footer_text', label: 'Chân trang', full: true, placeholder: 'Vd: Hoạt động 8h–24h hằng ngày' })}
    `)}
    ${card('Bot Telegram', `
      ${F({ name: 'bot_token', label: 'Bot token', full: true, placeholder: '123456:ABC…', hint: 'Lấy từ @BotFather. Sau khi lưu, bấm "Kết nối bot" để đặt webhook.' })}
      ${F({ name: 'admin_chat_ids', label: 'ID Telegram của admin', hint: 'Nhận thông báo đơn mới, nạp tiền. Nhiều ID cách nhau bằng dấu phẩy.' })}
      ${F({ name: 'welcome_text', label: 'Lời chào khi /start', type: 'textarea', rows: 3, full: true })}
      ${F({ name: 'support_text', label: 'Nội dung mục Hỗ trợ', type: 'textarea', rows: 2 })}
      ${F({ name: 'support_zalo', label: 'Số Zalo hỗ trợ', placeholder: '0385673834', hint: 'Hiện nút "Nhắn Zalo" trên bot và trang web. Để trống để ẩn.' })}
      ${F({ name: 'support_url', label: 'Link Telegram hỗ trợ', placeholder: 'https://t.me/username' })}
      ${F({ name: 'site_notice', label: 'Thông báo trên trang web', full: true, placeholder: 'Vd: Khuyến mãi nạp +10% đến hết tháng', hint: 'Hiện ở đầu trang chủ. Để trống để ẩn.' })}
      <div class="full" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button type="button" class="btn primary" id="connect">Lưu &amp; kết nối bot</button><span id="botStatus" class="muted small">Đang kiểm tra…</span></div>
    `)}
    ${card('Nạp tiền tự động (SePay)', `
      <div class="callout full">Trên <a href="https://my.sepay.vn" target="_blank" rel="noopener">my.sepay.vn</a> → Tích hợp WebHooks → Thêm webhook:
        URL nhận <b>${esc(wh)}</b>, kiểu xác thực <b>API Key</b>, dán đúng key bên dưới. Chọn "Chỉ nhận tiền vào".</div>
      <label class="field full"><span>Webhook URL</span><div class="copy"><input readonly value="${esc(wh)}"><button type="button" class="btn" data-copy="${esc(wh)}">Sao chép</button></div></label>
      <label class="field full"><span>SePay API key (xác thực webhook)</span><div class="copy"><input name="sepay_api_key" value="${esc(s.sepay_api_key)}" placeholder="Bấm Tạo key"><button type="button" class="btn" id="genKey">Tạo key</button></div></label>
      ${F({ name: 'bank_code', label: 'Ngân hàng', placeholder: 'MBBank, Vietcombank, ACB, TPBank…', hint: 'Tên viết tắt theo danh sách của SePay/VietQR' })}
      ${F({ name: 'bank_account', label: 'Số tài khoản' })}
      ${F({ name: 'bank_owner', label: 'Chủ tài khoản', placeholder: 'NGUYEN VAN A' })}
      ${F({ name: 'topup_prefix', label: 'Tiền tố nội dung CK', hint: 'Nội dung sẽ là tiền tố + ID Telegram, vd NAP123456789' })}
      ${F({ name: 'topup_min', label: 'Nạp tối thiểu (đ)', type: 'number' })}
      ${F({ name: 'topup_bonus_percent', label: 'Khuyến mãi nạp (%)', type: 'number', step: 'any', hint: '0 để tắt' })}
      ${F({ name: 'topup_amounts', label: 'Các mệnh giá gợi ý', full: true, hint: 'Cách nhau bằng dấu phẩy' })}
      ${F({ name: 'sepay_ignore_nocode', label: 'Giao dịch không có mã NAP', type: 'select', full: true, options: [['0', 'Ghi "Chưa khớp" và báo admin (tài khoản chỉ dùng cho shop)'], ['1', 'Bỏ qua im lặng (tài khoản dùng chung với hệ thống khác, vd ThuêTab)']], hint: 'Giao dịch có mã NAP nhưng sai mã khách vẫn luôn được ghi "Chưa khớp".' })}
      <div class="full"><span class="muted small">Xem trước mã QR (khách có ID 123456789, 50.000đ):</span><br><img id="qrPreview" alt="" style="width:160px;margin-top:8px;border-radius:8px;border:1px solid var(--border);background:#fff"></div>
    `)}
    ${card('Nhà cung cấp dịch vụ (trumsubviet.com)', `
      ${F({ name: 'api_key', label: 'API key', full: true, hint: 'Lấy trong trang tài khoản trên trumsubviet.com' })}
      ${F({ name: 'api_base', label: 'Địa chỉ API', full: true, hint: 'Mặc định https://trumsubviet.com. Nếu nhà cung cấp yêu cầu IP cố định, trỏ qua proxy của bạn.' })}
      <div class="full" style="display:flex;gap:10px;align-items:center"><button type="button" class="btn" id="testApi">Kiểm tra kết nối</button><span id="apiStatus" class="muted small"></span></div>
    `)}
    ${card('Đại lý, API và bot con', `
      ${F({ name: 'api_enabled', label: 'API cho đại lý', type: 'select', options: [['1', 'Bật'], ['0', 'Tắt']] })}
      ${F({ name: 'child_enabled', label: 'Cho phép tạo bot con', type: 'select', options: [['1', 'Bật'], ['0', 'Tắt — mọi bot con tạm dừng']] })}
      ${F({ name: 'reseller_rate', label: 'Giá đại lý (% giá bán bot gốc)', type: 'number', step: 'any', hint: '100 = bằng giá bot gốc; 90 = giảm 10% cho đại lý. Gói có "Giá đại lý" riêng sẽ dùng giá đó.' })}
      ${F({ name: 'withdraw_min', label: 'Rút hoa hồng tối thiểu (đ)', type: 'number' })}
      ${F({ name: 'child_min_markup', label: 'Bot con: % lãi tối thiểu', type: 'number', step: 'any', hint: 'Đảm bảo giá bot con luôn cao hơn giá đại lý' })}
      ${F({ name: 'child_max_markup', label: 'Bot con: % lãi tối đa', type: 'number', step: 'any' })}
      <div class="callout full">Ví dụ: gói giá 10đ, tỷ lệ đại lý 100%, bot con đặt lãi 30% → khách bot con trả 13đ, hệ thống thu 10đ, chủ bot con nhận 3đ hoa hồng.
        Khách bot con nạp tiền qua tài khoản ngân hàng của bạn ở trên.</div>
    `)}
    ${card('Hệ thống', `
      ${F({ name: 'maintenance', label: 'Bảo trì bot', type: 'select', options: [['0', 'Tắt — bot hoạt động bình thường'], ['1', 'Bật — chỉ admin dùng được']] })}
      <div class="field"><span class="muted small">Mã hóa thông tin acc (DATA_KEY)</span><div style="margin-top:8px"><span class="status-dot ${has_data_key ? 'on' : 'off'}"></span>${has_data_key ? 'Đang bật' : 'Chưa đặt secret DATA_KEY — thông tin đăng nhập acc đang lưu dạng thường'}</div></div>
      <div class="field"><span class="muted small">Lưu trữ ảnh R2</span><div style="margin-top:8px"><span class="status-dot ${has_bucket ? 'on' : 'off'}"></span>${has_bucket ? 'Đã kết nối' : 'Chưa gắn binding BUCKET — chỉ dùng được link ảnh'}</div></div>
    `)}
    <div style="position:sticky;bottom:0;padding:12px 0;background:var(--bg)"><button class="btn primary" id="saveAll">Lưu cài đặt</button></div>
  </form>`;

  const form = $('#sform', view);
  const save = async () => {
    await api('/admin/settings', { method: 'PUT', body: readForm(form) });
    applyBrand({ shop: form.shop_name.value, logo: imgOrEmpty(form.logo.value), hero_art: imgOrEmpty(form.hero_art.value), logo_style: form.logo_style.value,
      accent: form.accent_color.value, accent2: form.accent_color2.value });
  };
  const imgOrEmpty = (x) => (x ? imgSrc(x) : '');
  const drawLogo = () => {
    paintMark($('#logoPreview', view), { logo: form.logo.value ? imgSrc(form.logo.value) : '', style: form.logo_style.value, name: form.shop_name.value });
    $$('[data-mark]', view).forEach((el) => paintMark(el, { style: el.dataset.mark, name: form.shop_name.value }));
  };
  const preview = () => applyColors(form.accent_color.value, form.accent_color2.value);
  $$('#presetPick button', view).forEach((b) => b.onclick = () => {
    form.accent_color.value = b.dataset.a;
    form.accent_color2.value = b.dataset.b;
    $('#accentPick', view).value = b.dataset.a;
    $('#accentPick2', view).value = b.dataset.b;
    $$('#presetPick button', view).forEach((x) => x.classList.toggle('on', x === b));
    preview();
  });
  form.shop_name.addEventListener('input', drawLogo);
  $$('#stylePick button', view).forEach((b) => b.onclick = () => {
    form.logo_style.value = b.dataset.style;
    $$('#stylePick button', view).forEach((x) => x.classList.toggle('on', x === b));
    drawLogo();
  });
  drawLogo();
  const drawArt = () => { $('#artPreview', view).style.backgroundImage = form.hero_art.value ? `url("${imgSrc(form.hero_art.value)}")` : ''; };
  drawArt();
  $('#artRm', view).onclick = () => { form.hero_art.value = ''; drawArt(); };
  $('#artFile', view).onchange = (e) => run($('#artUp', view), async () => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const r = await uploadImages([f], 'brand');
    form.hero_art.value = r.keys[0];
    drawArt();
    toast('Đã tải ảnh — bấm Lưu cài đặt để áp dụng');
  });
  const drawHero = () => { $('#heroPreview', view).style.backgroundImage = form.hero_image.value ? `url("${imgSrc(form.hero_image.value)}")` : ''; };
  drawHero();
  $('#heroRm', view).onclick = () => { form.hero_image.value = ''; drawHero(); };
  $('#heroFile', view).onchange = (e) => run($('#heroUp', view), async () => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const r = await uploadImages([f], 'brand');
    form.hero_image.value = r.keys[0];
    drawHero();
    toast('Đã tải ảnh — bấm Lưu cài đặt để áp dụng');
  });
  $('#logoRm', view).onclick = () => { form.logo.value = ''; drawLogo(); };
  $('#logoFile', view).onchange = (e) => run($('#logoUp', view), async () => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const r = await uploadImages([f], 'brand');
    form.logo.value = r.keys[0];
    drawLogo();
    toast('Đã tải logo — bấm Lưu cài đặt để áp dụng');
  });
  $('#accentPick', view).oninput = (e) => { form.accent_color.value = e.target.value; preview(); };
  $('#accentPick2', view).oninput = (e) => { form.accent_color2.value = e.target.value; preview(); };
  form.accent_color.oninput = (e) => { if (/^#[0-9a-f]{6}$/i.test(e.target.value)) { $('#accentPick', view).value = e.target.value; preview(); } };
  form.accent_color2.oninput = (e) => { if (/^#[0-9a-f]{6}$/i.test(e.target.value)) { $('#accentPick2', view).value = e.target.value; preview(); } };
  form.onsubmit = (e) => { e.preventDefault(); run($('#saveAll', view), save, 'Đã lưu cài đặt'); };

  const qr = () => {
    const v = readForm(form);
    if (!v.bank_account || !v.bank_code) { $('#qrPreview', view).removeAttribute('src'); return; }
    $('#qrPreview', view).src = `https://qr.sepay.vn/img?${new URLSearchParams({ acc: v.bank_account, bank: v.bank_code, amount: 50000, des: `${(v.topup_prefix || 'NAP').toUpperCase()}123456789` })}`;
  };
  qr();
  ['bank_account', 'bank_code', 'topup_prefix'].forEach((n) => form[n].addEventListener('input', debounce(qr, 500)));

  $$('[data-copy]', view).forEach((b) => b.onclick = () => navigator.clipboard.writeText(b.dataset.copy).then(() => toast('Đã sao chép')));
  $('#genKey', view).onclick = () => {
    const a = crypto.getRandomValues(new Uint8Array(20));
    form.sepay_api_key.value = [...a].map((x) => x.toString(16).padStart(2, '0')).join('');
    toast('Đã tạo key mới — nhớ lưu và cập nhật trên SePay');
  };

  const botStatus = async () => {
    const i = await api('/admin/telegram/info').catch((e) => ({ error: e.message }));
    const el = $('#botStatus', view);
    if (!el) return;
    if (i.error) el.textContent = i.error;
    else if (!i.configured) el.innerHTML = '<span class="status-dot off"></span>Chưa cấu hình bot';
    else {
      const ok = i.webhook?.url?.startsWith(base_url);
      el.innerHTML = `<span class="status-dot ${ok ? 'on' : 'off'}"></span>${ok ? `Đang hoạt động · @${esc(i.username)}` : 'Webhook chưa trỏ về website này'}` +
        (i.webhook?.last_error_message ? ` · lỗi gần nhất: ${esc(i.webhook.last_error_message)}` : '') +
        (i.webhook?.pending_update_count ? ` · ${i.webhook.pending_update_count} tin chờ` : '');
    }
  };
  botStatus();
  $('#connect', view).onclick = (e) => run(e.currentTarget, async () => {
    await save();
    const r = await api('/admin/telegram/setup', { method: 'POST' });
    toast(`Đã kết nối @${r.username}`);
    botStatus();
  });
  $('#testApi', view).onclick = (e) => run(e.currentTarget, async () => {
    await save();
    $('#apiStatus', view).textContent = 'Đang kiểm tra…';
    try {
      const p = await api('/admin/upstream/profile');
      $('#apiStatus', view).innerHTML = `<span class="status-dot on"></span>Kết nối tốt · ${esc(p.username || '')} · số dư ${money(p.balance ?? p.cash)}`;
    } catch (err) {
      $('#apiStatus', view).innerHTML = `<span class="status-dot off"></span>${esc(err.message)}`;
    }
  });
}

boot();
