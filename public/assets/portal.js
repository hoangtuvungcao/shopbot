import { applyColors, paintMark, setFavicon } from './brand.js';
import { API_DOCS, API_NOTES, curl } from './apidocs.js';

// ================================================================ tiện ích
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => `${Math.round(Number(n) || 0).toLocaleString('vi-VN')}đ`;
const num = (n) => (Number(n) || 0).toLocaleString('vi-VN');
const price = (p) => `${Number(p || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}đ`;
const fmtTime = (t) => new Date(t * 1000).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const PER1K = ['quantity', 'days', 'minutes'];
const PACKAGE = ['fixed', 'verify'];
const svcPrice = (s) => (PER1K.includes(s.input_type) ? `${money(s.price * 1000)}` : PACKAGE.includes(s.input_type) ? money(s.price) : price(s.price));
const svcUnit = (s) => ({ quantity: '/ 1.000', days: '/ 1.000 / ngày', minutes: '/ 1.000 / phút', comment: '/ bình luận', fixed: 'trọn gói', verify: 'trọn gói' })[s.input_type] || '';
const REACT = { like: 'Like', love: 'Love', care: 'Thương thương', haha: 'Haha', wow: 'Wow', sad: 'Buồn', angry: 'Phẫn nộ' };
const STATUS = {
  manual: ['Chờ xử lý', 'warn'], review: ['Đang xác nhận', 'warn'], processing: ['Đang chạy', 'info'], done: ['Hoàn thành', 'good'],
  refunded: ['Đã hoàn tiền', ''], canceled: ['Đã hủy', 'bad'], failed: ['Lỗi - đã hoàn', 'bad'],
};
const LOG = { topup: 'Nạp tiền', order: 'Đặt đơn', refund: 'Hoàn tiền', buy_acc: 'Mua acc', admin: 'Điều chỉnh', commission: 'Hoa hồng', withdraw: 'Rút tiền', gift: 'Mã quà tặng' };
const badge = (s) => `<span class="badge ${STATUS[s]?.[1] || ''}">${STATUS[s]?.[0] || esc(s)}</span>`;

async function api(path, { method = 'GET', body } = {}) {
  const opt = { method, headers: {} };
  if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers['content-type'] = 'application/json'; }
  let res;
  try { res = await fetch(`/api${path}`, opt); } catch { throw new Error('Mất kết nối mạng, thử lại nhé'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path.startsWith('/me/') && !path.startsWith('/me/login')) { me = null; render(); }
  if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
  return data;
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `ptoast ${kind}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'bad' ? 5000 : 3000);
}

async function run(btn, fn) {
  if (btn?.disabled) return;
  if (btn) { btn.disabled = true; btn.classList.add('busy'); }
  try { return await fn(); } catch (e) { toast(e.message, 'bad'); } finally { if (btn) { btn.disabled = false; btn.classList.remove('busy'); } }
}

function copy(text, label = 'Đã sao chép') {
  navigator.clipboard?.writeText(String(text)).then(() => toast(label, 'good')).catch(() => toast('Không sao chép được', 'bad'));
}

function modal(html, { wide = false } = {}) {
  const bg = document.createElement('div');
  bg.className = 'pmodal-bg';
  bg.innerHTML = `<div class="pmodal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><button class="x" aria-label="Đóng">✕</button>${html}</div>`;
  const close = () => { bg.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', key); };
  const key = (e) => e.key === 'Escape' && close();
  bg.addEventListener('mousedown', (e) => e.target === bg && close());
  $('.x', bg).onclick = close;
  document.addEventListener('keydown', key);
  document.body.style.overflow = 'hidden';
  $('#modalRoot').append(bg);
  return { el: bg, close };
}

const nonce = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-x`);

// ================================================================ giao diện sáng/tối
function setTheme(t) { document.documentElement.dataset.theme = t; }
let saved = null;
try { saved = localStorage.getItem('theme'); } catch { /* bỏ qua */ }
setTheme(saved || 'dark');
$('#themeBtn').onclick = () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  setTheme(next);
  try { localStorage.setItem('theme', next); } catch { /* bỏ qua */ }
};

// ================================================================ trạng thái
let me = null;
let shop = null;

async function loadMe() {
  const r = await api('/me').catch(() => ({ authed: false }));
  me = r.authed ? r : null;
  paintHeader();
  return me;
}

function paintHeader() {
  const on = !!me;
  $('#balChip').classList.toggle('hidden', !on);
  $('#meBtn').classList.toggle('hidden', !on);
  $('#topNav').classList.toggle('hidden', !on);
  $('#ptab').classList.toggle('hidden', !on);
  if (!on) return;
  const u = me.user;
  $('#balVal').textContent = money(u.balance);
  $('#meInitial').textContent = (u.first_name || u.username || 'U').trim()[0].toUpperCase();
  $('#meName').textContent = u.first_name || u.username || 'Khách';
  $('#meId').textContent = `Mã khách ${u.id}${u.username ? ` · @${u.username}` : ''}`;
}

function setBalance(b) {
  if (!me) return;
  me.user.balance = b;
  $('#balVal').textContent = money(b);
}

$('#meBtn').onclick = (e) => { e.stopPropagation(); $('#meMenu').classList.toggle('hidden'); };
document.addEventListener('click', (e) => { if (!$('#meMenu').contains(e.target)) $('#meMenu').classList.add('hidden'); });
$('#logoutBtn').onclick = async () => {
  await api('/me/logout', { method: 'POST' }).catch(() => {});
  me = null;
  $('#meMenu').classList.add('hidden');
  paintHeader();
  render();
};

// ================================================================ router
const routes = { '': pageHome, services: pageServices, accs: pageAccs, topup: pageTopup, orders: pageOrders, 'my-accs': pageMyAccs, api: pageApi, logs: pageLogs };
let timer = null;

async function render() {
  clearInterval(timer);
  const [key, arg] = location.hash.replace(/^#\/?/, '').split('/');
  $$('[data-r]').forEach((a) => a.classList.toggle('on', a.dataset.r === (routes[key] ? key : '')));
  const view = $('#view');
  if (!me) return pageLogin(view);
  view.innerHTML = '<div class="p-skel"></div>';
  try {
    await (routes[key] || pageHome)(view, arg);
  } catch (e) {
    view.innerHTML = `<div class="pcard">${esc(e.message)}</div>`;
  }
  window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', render);

// ================================================================ đăng nhập
function pageLogin(view) {
  view.innerHTML = `<div class="login-wrap">
    ${shop?.hero_art ? `<img class="login-art" src="${esc(shop.hero_art)}" alt="Logo ${esc(shop.shop_name || '')}">` : '<div class="gmark" id="loginMark"></div>'}
    <h1>Đăng nhập ${esc(shop?.shop_name || '')}</h1>
    <p>Dùng chung tài khoản và số dư với bot Telegram. Không cần mật khẩu.</p>
    <a class="tg-btn is-loading" id="tgLogin" href="#" rel="noopener"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M9.8 15.3 9.6 19c.4 0 .6-.2.8-.4l2-1.9 4.1 3c.8.4 1.3.2 1.5-.7l2.7-12.7c.3-1.1-.4-1.6-1.2-1.3L3.7 10.1c-1.1.4-1.1 1.1-.2 1.4l4.1 1.3 9.6-6c.5-.3.9-.1.5.2z"/></svg>Đăng nhập bằng Telegram</a>
    <p class="small muted" style="margin:10px 0 0">Không mở được app? <a id="tgAlt" href="#" target="_blank" rel="noopener">Mở bằng t.me</a></p>
    <div id="loginState"></div>
    <ol class="login-steps"><li>Bấm nút trên, app Telegram mở bot của shop.</li><li>Bấm <b>Start</b> (hoặc Bắt đầu) rồi bấm <b>Xác nhận đăng nhập</b>.</li><li>Quay lại trình duyệt này, web tự đăng nhập.</li></ol>
    <p class="small muted" style="margin-top:20px"><a href="/">← Về trang shop</a></p>
  </div>`;
  if ($('#loginMark', view)) paintMark($('#loginMark', view), { logo: shop?.logo, style: shop?.logo_style, name: shop?.shop_name });

  // Lấy mã đăng nhập TRƯỚC khi khách bấm: nút là liên kết thật nên điện thoại cho mở app Telegram ngay
  // (mở sau một lần chờ máy chủ thì Safari/Chrome mobile coi là cửa sổ bật lên và chặn).
  const btn = $('#tgLogin', view);
  const alt = $('#tgAlt', view);
  const st = $('#loginState', view);
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
  let token = null;
  let issued = 0;
  let waiting = false;

  async function issue() {
    const r = await api('/me/login/start', { method: 'POST' });
    token = r.token;
    issued = Date.now();
    const bot = (r.link.match(/t\.me\/([\w]+)/) || [])[1] || shop?.bot_username;
    btn.href = mobile ? `tg://resolve?domain=${bot}&start=login_${token}` : r.link;
    btn.target = mobile ? '' : '_blank';
    alt.href = r.link;
    btn.classList.remove('is-loading');
  }

  async function poll() {
    if (!token || !btn.isConnected) return;
    const p = await api(`/me/login/poll?token=${token}`).catch(() => ({}));
    if (p.status === 'ok') {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      await loadMe();
      toast('Đăng nhập thành công', 'good');
      render();
    } else if (p.status === 'denied') {
      waiting = false;
      st.innerHTML = '<p class="muted">Bạn đã bấm "Không phải tôi". Bấm đăng nhập lại nếu cần.</p>';
      issue().catch(() => {});
    }
  }

  const startWaiting = () => {
    waiting = true;
    st.innerHTML = '<div class="waiting" style="justify-content:center"><i></i>Đang chờ bạn bấm Xác nhận trong Telegram…</div>';
  };
  btn.addEventListener('click', (e) => { if (!token) { e.preventDefault(); return; } startWaiting(); });
  alt.addEventListener('click', (e) => { if (!token) { e.preventDefault(); return; } startWaiting(); });

  // Quay lại từ app Telegram: kiểm tra ngay, không đợi lượt hỏi tiếp theo
  const onVisible = () => { if (!btn.isConnected) document.removeEventListener('visibilitychange', onVisible); else if (document.visibilityState === 'visible' && waiting) poll(); };
  document.addEventListener('visibilitychange', onVisible);

  clearInterval(timer);
  timer = setInterval(() => {
    if (!btn.isConnected) return clearInterval(timer);
    // Mã sống 5 phút: làm mới trước khi hết hạn
    if (token && Date.now() - issued > 240000) {
      if (waiting) st.innerHTML = '<p class="muted">Mã đăng nhập đã được làm mới. Bấm lại nút đăng nhập nhé.</p>';
      waiting = false;
      issue().catch(() => {});
      return;
    }
    if (waiting) poll();
  }, 2000);

  issue().catch((e) => {
    btn.classList.add('is-loading');
    st.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  });
}

// ================================================================ tổng quan
async function pageHome(view) {
  await loadMe();
  const u = me.user;
  const s = me.stats || {};
  view.innerHTML = `
    <div class="ptitle"><div><h1>Xin chào, ${esc(u.first_name || u.username || 'bạn')}</h1><p>Mã khách <b>${u.id}</b> · dùng mã này khi cần hỗ trợ</p></div></div>
    <div class="pgrid two">
      <div class="wallet"><div class="meta">Đã nạp ${money(u.total_topup)}<br>Đã dùng ${money(u.total_spent)}</div>
        <div class="lbl">Số dư khả dụng</div><div class="amt">${money(u.balance)}</div>
        <div class="acts"><a href="#/topup">Nạp tiền</a><a href="#/services">Đặt dịch vụ</a><a href="#/accs">Mua acc</a></div></div>
      <div class="kpis" style="grid-template-columns:1fr 1fr">
        <div><b>${num(s.orders)}</b><span>Tổng đơn</span></div>
        <div><b>${num(s.running)}</b><span>Đang chạy</span></div>
        <div style="grid-column:1/-1"><a href="#/my-accs"><b>Acc đã mua</b><span>Xem lại thông tin đăng nhập</span></a></div>
      </div>
    </div>
    <div class="qa" style="margin-top:16px">
      ${qa('#/services', 'Dịch vụ MXH', 'Like, follow, view, tim…', '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>')}
      ${qa('#/accs', 'Acc game', 'Nhận acc ngay sau khi mua', '<path d="M6 11h4M8 9v4M15 12h.01M18 10h.01M17.3 5H6.7a4 4 0 0 0-4 3.6l-.9 8A3 3 0 0 0 4.8 20c1 0 1.9-.6 2.3-1.5L8 17h8l.9 1.5c.4.9 1.3 1.5 2.3 1.5a3 3 0 0 0 3-3.4l-.9-8A4 4 0 0 0 17.3 5z"/>')}
      ${qa('#/topup', 'Nạp tiền', 'QR tự động 1–3 phút', '<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v3m0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5M21 12h-4a2 2 0 0 0 0 4h4z"/>')}
      ${qa('#/api', 'API đại lý', 'Kết nối panel của bạn', '<path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/>')}
    </div>
    <div class="pcard" style="margin-top:16px"><h3>Đơn gần đây</h3>${me.recent.length ? `<div class="list">${me.recent.map(orderRow).join('')}</div>
      <p style="margin:12px 0 0"><a href="#/orders">Xem tất cả đơn →</a></p>` : '<p class="muted">Chưa có đơn nào. <a href="#/services">Đặt đơn đầu tiên</a></p>'}</div>`;
}

const qa = (href, t, s, path) => `<a href="${href}"><span class="ic"><svg viewBox="0 0 24 24">${path}</svg></span><b>${t}</b><span>${s}</span></a>`;

function orderRow(o) {
  return `<div class="row"><div class="grow"><div class="t">#${o.id} · ${esc(o.service_name)}</div><div class="s">${fmtTime(o.created_at)}</div></div>
    ${badge(o.status)}<div class="r">${money(o.price_total - (o.refunded || 0))}</div></div>`;
}

// ================================================================ dịch vụ
async function pageServices(view, preselect) {
  const cats = shop.categories;
  let cat = 0;
  let q = '';
  view.innerHTML = `<div class="ptitle"><div><h1>Dịch vụ</h1><p>Chọn gói, nhập link và số lượng. Đơn chạy tự động, theo dõi ở mục Đơn hàng.</p></div>
      <div class="filters"><input type="search" id="q" placeholder="Tìm: like, follow, tim, view…"></div></div>
    <div class="chipset" id="cats" style="margin-bottom:16px"></div><div class="svc-cards" id="cards"></div>`;
  const draw = () => {
    $('#cats', view).innerHTML = [[0, 'Tất cả'], ...cats.map((c) => [c.id, c.name])]
      .map(([id, n]) => `<button class="${id === cat ? 'on' : ''}" data-c="${id}">${esc(n)}</button>`).join('');
    $$('[data-c]', view).forEach((b) => b.onclick = () => { cat = Number(b.dataset.c); draw(); });
    const list = cats.filter((c) => !cat || c.id === cat).flatMap((c) => c.services.map((s) => ({ ...s, cat: c.name })))
      .filter((s) => !q || `${s.name} ${s.cat} ${s.description || ''}`.toLowerCase().includes(q));
    $('#cards', view).innerHTML = list.length ? list.map((s) => `<button class="svc-card" data-s="${s.id}">
        <span class="cat">${esc(s.cat)}</span><span class="nm">${esc(s.name)}</span>
        <span class="pr"><b>${svcPrice(s)}</b><span>${svcUnit(s)}</span></span></button>`).join('')
      : '<div class="pcard muted">Không có gói phù hợp.</div>';
    $$('[data-s]', view).forEach((b) => b.onclick = () => orderModal(findSvc(Number(b.dataset.s))));
  };
  $('#q', view).oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
  draw();
  if (preselect) { const s = findSvc(Number(preselect)); if (s) orderModal(s); }
}

const findSvc = (id) => {
  for (const c of shop.categories) { const s = c.services.find((x) => x.id === id); if (s) return { ...s, cat: c.name }; }
  return null;
};

function orderModal(s) {
  const t = s.input_type;
  const pkg = PACKAGE.includes(t);
  const linkLabel = t === 'verify' ? 'Link Facebook cần lên tích xanh' : pkg ? 'Link / thông tin tài khoản' : 'Link hoặc ID cần tăng';
  const m = modal(`<h2>${esc(s.name)}</h2><p class="muted small" style="margin:0 0 16px">${esc(s.cat || '')} · ${svcPrice(s)} ${svcUnit(s)}</p>
    ${s.description ? `<p class="small" style="white-space:pre-line;color:var(--text-2)">${esc(s.description)}</p>` : ''}
    <form class="pf" id="of">
      <label><span>${linkLabel}</span><input name="link" required placeholder="https://..." autocomplete="off"></label>
      ${t === 'comment' ? `<label><span>Nội dung bình luận (mỗi dòng một bình luận)</span><textarea name="comments" required></textarea><small class="hint" id="cmtN">0 bình luận · cần ${s.min_qty}–${num(s.max_qty)}</small></label>` : ''}
      ${!pkg && t !== 'comment' ? `<label><span>Số lượng</span><input name="qty" type="number" inputmode="numeric" required min="${s.min_qty}" max="${s.max_qty}" value="${Math.max(s.min_qty, Math.min(1000, s.max_qty))}">
        <small class="hint">Tối thiểu ${num(s.min_qty)} · tối đa ${num(s.max_qty)}</small>
        <div class="quick">${[s.min_qty, 500, 1000, 5000, 10000, s.max_qty].filter((v, i, a) => v >= s.min_qty && v <= s.max_qty && a.indexOf(v) === i).map((v) => `<button type="button" data-q="${v}">${num(v)}</button>`).join('')}</div></label>` : ''}
      ${t === 'days' || t === 'minutes' ? `<label><span>${t === 'days' ? 'Số ngày' : 'Số phút'}</span><input name="extra" type="number" inputmode="numeric" required min="${s.extra_min}" max="${s.extra_max}" value="${s.extra_min}"><small class="hint">Từ ${s.extra_min} đến ${s.extra_max}</small></label>` : ''}
      ${s.reactions?.length ? `<div><span class="small" style="font-weight:600;color:var(--text-2)">Cảm xúc</span><div class="chipset" id="rx" style="margin-top:6px">${s.reactions.map((r, i) => `<button type="button" data-rx="${r}" class="${i ? '' : 'on'}">${REACT[r] || r}</button>`).join('')}</div></div>` : ''}
      ${t === 'verify' ? `<label><span>Số điện thoại / Zalo liên hệ</span><input name="contact" required inputmode="tel" placeholder="0385673834"></label>
        <label><span>Ghi chú cho admin (không bắt buộc)</span><textarea name="note" style="min-height:80px" placeholder="Tên trên giấy tờ, thời gian tiện liên hệ…"></textarea></label>` : ''}
      <div class="total"><div><span class="small muted">Thành tiền</span><br><b id="tot">0đ</b></div><div class="after" id="after"></div></div>
      <button class="btn primary lg block" id="go">Xác nhận đặt đơn</button>
    </form>`);
  const f = $('#of', m.el);
  let reaction = s.reactions?.[0];
  const calc = () => {
    const qty = pkg ? 1 : t === 'comment' ? f.comments.value.split('\n').filter((x) => x.trim()).length : Number(f.qty.value) || 0;
    const mult = f.extra ? Number(f.extra.value) || 0 : 1;
    const total = Math.ceil(s.price * qty * mult);
    if (f.comments) $('#cmtN', m.el).textContent = `${qty} bình luận · cần ${s.min_qty}–${num(s.max_qty)}`;
    $('#tot', m.el).textContent = money(total);
    const left = me.user.balance - total;
    $('#after', m.el).innerHTML = left >= 0 ? `Số dư sau<br><b style="font-size:14px">${money(left)}</b>` : `<span style="color:#ef4444">Thiếu ${money(-left)}</span>`;
    const go = $('#go', m.el);
    go.textContent = left >= 0 ? `Xác nhận đặt đơn · ${money(total)}` : 'Nạp thêm tiền';
    go.dataset.short = left < 0 ? '1' : '';
    return { qty, total };
  };
  f.addEventListener('input', calc);
  $$('[data-q]', m.el).forEach((b) => b.onclick = () => { f.qty.value = b.dataset.q; calc(); });
  $$('[data-rx]', m.el).forEach((b) => b.onclick = () => { reaction = b.dataset.rx; $$('[data-rx]', m.el).forEach((x) => x.classList.toggle('on', x === b)); });
  calc();
  const id = nonce();
  f.onsubmit = (e) => {
    e.preventDefault();
    const go = $('#go', m.el);
    if (go.dataset.short) { m.close(); location.hash = '#/topup'; return; }
    if (!f.reportValidity()) return;
    run(go, async () => {
      const r = await api('/me/order', { method: 'POST', body: {
        nonce: id, service_id: s.id, link: f.link.value, qty: f.qty?.value, extra: f.extra?.value, comments: f.comments?.value,
        reaction, contact: f.contact?.value, note: f.note?.value,
      } });
      setBalance(r.balance);
      m.el.querySelector('.pmodal').innerHTML = `<div style="text-align:center;padding:10px 0">
        <div class="gmark" style="width:64px;height:64px;margin:0 auto 14px;font-size:30px"><span class="mono">✓</span></div>
        <h2 style="margin:0 0 6px">Đặt đơn thành công #${r.order.id}</h2>
        <p class="muted">${r.order.status === 'manual' ? (t === 'verify' ? 'Admin sẽ liên hệ qua SĐT/Zalo bạn cung cấp.' : 'Đơn đã vào hàng chờ xử lý.') : 'Đơn đang được chạy tự động.'}</p>
        <p>Thanh toán <b>${money(r.order.price_total)}</b> · Số dư còn <b>${money(r.balance)}</b></p>
        <div style="display:flex;gap:10px;margin-top:16px"><a class="btn block" href="#/orders">Xem đơn</a><button class="btn primary block" id="again">Đặt tiếp</button></div></div>`;
      $('#again', m.el).onclick = () => { m.close(); orderModal(s); };
      $$('a', m.el).forEach((a) => a.addEventListener('click', m.close));
    });
  };
}

// ================================================================ acc game
async function pageAccs(view, preselect) {
  let game = 0;
  const all = shop.games.flatMap((g) => g.accounts.map((a) => ({ ...a, game: g.name, game_id: g.id })));
  view.innerHTML = `<div class="ptitle"><div><h1>Acc game</h1><p>Thanh toán bằng số dư, acc giao tự động hiện thông tin ngay.</p></div></div>
    <div class="chipset" id="games" style="margin-bottom:16px"></div><div class="acc-grid" id="grid"></div>`;
  const draw = () => {
    $('#games', view).innerHTML = shop.games.length > 1 ? [[0, 'Tất cả'], ...shop.games.map((g) => [g.id, g.name])]
      .map(([id, n]) => `<button class="${id === game ? 'on' : ''}" data-g="${id}">${esc(n)}</button>`).join('') : '';
    $$('[data-g]', view).forEach((b) => b.onclick = () => { game = Number(b.dataset.g); draw(); });
    const list = all.filter((a) => !game || a.game_id === game);
    $('#grid', view).innerHTML = list.length ? list.map((a) => `<button class="acc" data-a="${a.id}">
        <div class="cover-wrap"><div class="cover" style="${a.images[0] ? `background-image:url('${esc(a.images[0])}')` : ''}"></div><span class="tag">#${a.id} · ${esc(a.game)}</span>${a.is_new ? '<span class="new">MỚI</span>' : ''}</div>
        <div class="body"><div class="title">${esc(a.title || 'Acc')}</div><div class="info">${esc(a.info)}</div>
        <div class="row" style="border:0;padding:8px 0 0"><span class="price">${money(a.price)}</span><span class="go">Xem chi tiết</span></div></div></button>`).join('')
      : '<div class="empty">Hiện đã hết acc, quay lại sau nhé.</div>';
    $$('[data-a]', view).forEach((b) => b.onclick = () => accModal(all.find((x) => x.id === Number(b.dataset.a))));
  };
  draw();
  if (preselect) { const a = all.find((x) => x.id === Number(preselect)); if (a) accModal(a); }
}

function accModal(a) {
  const m = modal(`<div class="modal" style="display:grid;grid-template-columns:1.3fr 1fr;max-height:none;border-radius:22px;overflow:hidden">
    <div class="gallery"><div class="slides">${a.images.length ? a.images.map((u) => `<img src="${esc(u)}" alt="Ảnh acc #${a.id}">`).join('') : '<div style="flex:0 0 100%;display:grid;place-items:center;color:#888">Chưa có ảnh</div>'}</div>
      ${a.images.length > 1 ? `<div class="thumbs">${a.images.map((u, i) => `<button data-i="${i}" class="${i ? '' : 'on'}" style="background-image:url('${esc(u)}')"></button>`).join('')}</div>` : ''}</div>
    <div class="detail" id="det"><div class="code">${esc(a.game)} · Mã acc #${a.id}</div><h3>${esc(a.title || 'Acc game')}</h3>
      ${a.info ? `<div class="info">${esc(a.info)}</div>` : ''}${a.description ? `<div class="desc">${esc(a.description)}</div>` : ''}
      <div class="price">${money(a.price)}</div>
      <div class="small muted">${a.delivery === 'manual' ? 'Acc giao thủ công: admin gửi thông tin qua bot sau khi thanh toán.' : 'Giao tự động: hiện tài khoản ngay sau khi thanh toán.'}</div>
      <button class="btn primary lg block" id="buy">${me.user.balance >= a.price ? `Mua ngay · ${money(a.price)}` : `Nạp thêm ${money(a.price - me.user.balance)}`}</button></div></div>`, { wide: true });
  const slides = $('.slides', m.el);
  $$('.thumbs button', m.el).forEach((t) => t.onclick = () => slides.scrollTo({ left: Number(t.dataset.i) * slides.clientWidth, behavior: 'smooth' }));
  slides?.addEventListener('scroll', () => {
    const i = Math.round(slides.scrollLeft / Math.max(1, slides.clientWidth));
    $$('.thumbs button', m.el).forEach((t, k) => t.classList.toggle('on', k === i));
  }, { passive: true });
  if (matchMedia('(max-width: 760px)').matches) $('.modal', m.el).style.gridTemplateColumns = '1fr';
  $('#buy', m.el).onclick = (e) => {
    if (me.user.balance < a.price) { m.close(); location.hash = '#/topup'; return; }
    const btn = e.currentTarget;
    if (btn.dataset.confirm !== '1') { btn.dataset.confirm = '1'; btn.textContent = `Bấm lần nữa để xác nhận · ${money(a.price)}`; return; }
    run(btn, async () => {
      const r = await api('/me/buy-acc', { method: 'POST', body: { id: a.id } });
      setBalance(r.balance);
      shop.games.forEach((g) => { g.accounts = g.accounts.filter((x) => x.id !== a.id); });
      $('#det', m.el).innerHTML = `<h3>Mua thành công acc #${r.id}</h3>
        ${r.pending ? '<p>Acc giao thủ công. Admin sẽ gửi thông tin đăng nhập qua bot Telegram và trong mục <b>Acc đã mua</b>.</p>'
          : `<div class="secret">${esc(r.secret || '')}</div><button class="btn block" id="cp" style="margin-top:8px">Sao chép thông tin</button>
             <p class="small muted">Thông tin cũng đã gửi vào Telegram của bạn. Hãy đổi mật khẩu ngay sau khi đăng nhập.</p>`}
        <p>Số dư còn <b>${money(r.balance)}</b></p><a class="btn primary block" href="#/my-accs">Acc đã mua</a>`;
      $('#cp', m.el)?.addEventListener('click', () => copy(r.secret));
      $('a', $('#det', m.el)).addEventListener('click', m.close);
    });
  };
}

// ================================================================ nạp tiền
async function pageTopup(view) {
  const t = await api('/me/topup');
  if (!t.ready) { view.innerHTML = '<div class="pcard">Chức năng nạp tiền đang bảo trì, vui lòng quay lại sau.</div>'; return; }
  let amount = t.amounts[1] || t.amounts[0] || t.min;
  view.innerHTML = `<div class="ptitle"><div><h1>Nạp tiền</h1><p>Quét mã QR bằng app ngân hàng. Tiền vào tự động sau 1–3 phút.${t.bonus ? ` Đang khuyến mãi <b>+${t.bonus}%</b>.` : ''}</p></div></div>
    <div class="pgrid two">
      <div class="pcard"><h3>1. Chọn số tiền</h3><div class="chipset" id="amts"></div>
        <form class="pf" id="cf" style="margin-top:12px"><label><span>Hoặc nhập số khác</span><input name="v" type="number" inputmode="numeric" min="${t.min}" placeholder="Tối thiểu ${num(t.min)}"></label></form>
        <h3 style="margin-top:20px">2. Quét mã hoặc chuyển khoản</h3>
        <div class="qr-box"><img id="qr" alt="Mã QR nạp tiền"><div class="bank">
          <div class="ln"><span>Ngân hàng</span><b>${esc(t.bank)}</b></div>
          <div class="ln"><span>Số tài khoản</span><b>${esc(t.account)}</b><button class="copy-btn" data-copy="${esc(t.account)}">Sao chép</button></div>
          <div class="ln"><span>Chủ tài khoản</span><b>${esc(t.owner)}</b></div>
          <div class="ln"><span>Số tiền</span><b id="amtTxt"></b><button class="copy-btn" id="cpAmt">Sao chép</button></div>
          <div class="ln hl"><span>Nội dung (bắt buộc)</span><b class="mono">${esc(t.code)}</b><button class="copy-btn" data-copy="${esc(t.code)}">Sao chép</button></div>
        </div></div>
        <div class="waiting"><i></i>Đang chờ tiền về… trang tự cập nhật số dư.</div></div>
      <div><div class="pcard"><h3>Mã quà tặng</h3><form class="pf" id="gf"><input name="code" placeholder="Nhập mã" autocomplete="off" style="text-transform:uppercase" required>
          <button class="btn primary block">Nhận quà</button></form></div>
        <div class="pcard"><h3>Lưu ý</h3><ul class="small" style="color:var(--text-2);padding-left:18px;margin:0;line-height:1.8">
          <li>Ghi <b>đúng nội dung</b> <span class="mono">${esc(t.code)}</span> để được cộng tự động.</li>
          <li>Chuyển sai nội dung: liên hệ hỗ trợ kèm mã khách <b>${me.user.id}</b>.</li>
          <li>Bot Telegram sẽ báo ngay khi tiền vào.</li></ul></div></div>
    </div>`;
  const draw = () => {
    $('#amts', view).innerHTML = t.amounts.map((v) => `<button class="${v === amount ? 'on' : ''}" data-v="${v}">${money(v)}</button>`).join('');
    $$('[data-v]', view).forEach((b) => b.onclick = () => { amount = Number(b.dataset.v); $('#cf', view).v.value = ''; draw(); });
    $('#qr', view).src = `${t.qr}&amount=${amount}`;
    $('#amtTxt', view).textContent = money(amount);
  };
  draw();
  $('#cf', view).v.oninput = (e) => { const v = Number(e.target.value); if (v >= t.min) { amount = v; draw(); } };
  $('#cf', view).onsubmit = (e) => e.preventDefault();
  $('#cpAmt', view).onclick = () => copy(amount);
  $$('[data-copy]', view).forEach((b) => b.onclick = () => copy(b.dataset.copy));
  $('#gf', view).onsubmit = (e) => {
    e.preventDefault();
    run($('button', e.target), async () => {
      const r = await api('/me/gift', { method: 'POST', body: { code: e.target.code.value } });
      setBalance(r.balance);
      e.target.reset();
      toast(`Nhận quà +${money(r.amount)}`, 'good');
    });
  };
  // Theo dõi số dư để báo ngay khi tiền vào
  const start = me.user.balance;
  timer = setInterval(async () => {
    const r = await api('/me').catch(() => null);
    if (r?.authed && r.user.balance > start) {
      clearInterval(timer);
      me = r;
      setBalance(r.user.balance);
      toast(`Đã nhận ${money(r.user.balance - start)}. Số dư: ${money(r.user.balance)}`, 'good');
    }
  }, 8000);
}

// ================================================================ đơn hàng
async function pageOrders(view) {
  let page = 0;
  view.innerHTML = `<div class="ptitle"><div><h1>Đơn hàng</h1><p>Trạng thái cập nhật tự động; bấm làm mới để kiểm tra ngay.</p></div></div><div class="pcard"><div class="list" id="ol"></div><div id="more"></div></div>`;
  const load = async () => {
    const r = await api(`/me/orders?page=${page}`);
    $('#ol', view).insertAdjacentHTML('beforeend', r.items.map((o) => {
      const pct = o.quantity && o.delivered ? Math.min(100, Math.round((o.delivered / o.quantity) * 100)) : 0;
      return `<div class="row" data-o="${o.id}"><div class="grow"><div class="t">#${o.id} · ${esc(o.service_name)}</div>
        <div class="s">${esc(o.link)}</div><div class="s">${fmtTime(o.created_at)}${o.mode === 'api' ? ` · SL ${num(o.quantity)}${o.delivered ? ` · đã chạy ${num(o.delivered)}` : ''}` : ''}${o.admin_note && ['done', 'refunded', 'canceled'].includes(o.status) ? ` · ${esc(o.admin_note)}` : ''}</div>
        ${pct ? `<div class="progress"><i style="width:${pct}%"></i></div>` : ''}</div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">${badge(o.status)}<div class="r">${money(o.price_total - o.refunded)}</div>
        ${o.status === 'processing' && o.mode === 'api' ? `<button class="copy-btn" data-rf="${o.id}">Làm mới</button>` : ''}</div></div>`;
    }).join('') || (page ? '' : '<p class="muted">Chưa có đơn nào. <a href="#/services">Đặt đơn ngay</a></p>'));
    $('#more', view).innerHTML = r.more ? '<button class="btn block" id="mb" style="margin-top:12px">Xem thêm</button>' : '';
    $('#mb', view)?.addEventListener('click', () => { page++; load(); });
    $$('[data-rf]', view).forEach((b) => b.onclick = () => run(b, async () => {
      const x = await api(`/me/orders/${b.dataset.rf}/refresh`, { method: 'POST' });
      b.closest('.row').querySelector('.badge').outerHTML = badge(x.status);
      toast('Đã cập nhật trạng thái');
    }));
  };
  await load();
}

// ================================================================ acc đã mua
async function pageMyAccs(view) {
  const list = await api('/me/accs');
  view.innerHTML = `<div class="ptitle"><div><h1>Acc đã mua</h1><p>Bấm vào ô thông tin để hiện. Không chia sẻ cho người khác.</p></div></div>
    <div class="pgrid three">${list.map((a) => `<div class="pcard"><div class="small muted">${esc(a.game || '')} · #${a.id} · ${fmtTime(a.sold_at)}</div>
      <h3 style="margin:6px 0">${esc(a.title || 'Acc')}</h3><div class="small">Giá ${money(a.sold_price)}</div>
      ${a.delivered_at ? `<div class="secret blur" data-s>${esc(a.secret)}</div><button class="btn block" data-cp="${a.id}" style="margin-top:8px">Sao chép</button>`
        : '<p><span class="badge warn">Chờ admin giao</span></p><p class="small muted">Bạn sẽ nhận tin nhắn Telegram khi acc được giao.</p>'}</div>`).join('')
      || '<div class="pcard muted">Bạn chưa mua acc nào. <a href="#/accs">Xem acc đang bán</a></div>'}</div>`;
  $$('[data-s]', view).forEach((el) => el.onclick = () => el.classList.toggle('blur'));
  $$('[data-cp]', view).forEach((b) => b.onclick = () => copy(list.find((a) => a.id === Number(b.dataset.cp)).secret));
}

// ================================================================ API
async function pageApi(view) {
  await loadMe();
  const prices = await api('/me/api-prices').catch(() => []);
  const url = `${location.origin}/api/v2`;
  const key = me.user.api_key;
  view.innerHTML = `<div class="ptitle"><div><h1>API cho đại lý</h1><p>Chuẩn SMM panel v2 + acc game — đủ để bạn tự làm web con bán lại dịch vụ và acc. Tiền trừ vào số dư tài khoản này.</p></div></div>
    <div class="pgrid two"><div>
      <div class="pcard"><h3>API key</h3>${key ? `<div class="keybox"><code id="kv">${esc(key.slice(0, 7))}••••••••••••••••</code>
          <button class="btn" id="show">Hiện</button><button class="btn" id="cpk">Sao chép</button></div>` : '<p class="muted">Bạn chưa có API key.</p>'}
        <button class="btn ${key ? '' : 'primary'}" id="gen" style="margin-top:12px">${key ? 'Tạo key mới (key cũ ngừng hoạt động)' : 'Tạo API key'}</button></div>
      <div class="pcard"><h3>Kết nối</h3><div class="bank">
        <div class="ln"><span>Endpoint</span><b class="mono" style="font-size:12.5px">${esc(url)}</b><button class="copy-btn" data-copy="${esc(url)}">Sao chép</button></div>
        <div class="ln"><span>Phương thức</span><b>POST · JSON hoặc form</b></div><div class="ln"><span>Tiền tệ</span><b>VND · rate tính trên 1.000</b></div></div>
        <div class="chipset" id="tabs" style="margin:14px 0 8px">${API_DOCS.map(([x], i) => `<button class="${i ? '' : 'on'}" data-t="${x}">${x}</button>`).join('')}</div>
        <pre class="code" id="code"></pre>
        <ul class="small" style="color:var(--text-2);padding-left:18px;margin:12px 0 0;line-height:1.7">${API_NOTES.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div></div>
      <div class="pcard"><h3>Bảng giá API (${prices.length} gói)</h3><div class="scroll-x" style="max-height:620px;overflow-y:auto"><table class="pt">
        <thead><tr><th>ID</th><th>Gói</th><th style="text-align:right">Rate</th><th>Min–Max</th></tr></thead>
        <tbody>${prices.map((p) => `<tr><td class="mono">${p.id}</td><td>${esc(p.name)}<div class="small muted">${esc(p.category || '')}</div></td>
          <td class="r">${money(p.rate)}</td><td class="small">${num(p.min)}–${num(p.max)}</td></tr>`).join('')}</tbody></table></div></div></div>`;
  const draw = (t) => {
    const [, desc, rq, rs] = API_DOCS.find((d) => d[0] === t);
    $('#code', view).textContent = `// ${desc}\n${curl(url, rq)}\n\n// Phản hồi\n${rs}`;
    $$('[data-t]', view).forEach((b) => b.classList.toggle('on', b.dataset.t === t));
  };
  $$('[data-t]', view).forEach((b) => b.onclick = () => draw(b.dataset.t));
  draw('services');
  $$('[data-copy]', view).forEach((b) => b.onclick = () => copy(b.dataset.copy));
  $('#show', view)?.addEventListener('click', () => { $('#kv', view).textContent = key; });
  $('#cpk', view)?.addEventListener('click', () => copy(key, 'Đã sao chép API key'));
  $('#gen', view).onclick = (e) => {
    const b = e.currentTarget;
    if (key && b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Bấm lần nữa để xác nhận đổi key'; return; }
    run(b, async () => { await api('/me/api-key', { method: 'POST' }); toast('Đã tạo API key mới', 'good'); pageApi(view); });
  };
}

// ================================================================ lịch sử số dư
async function pageLogs(view) {
  const logs = await api('/me/logs');
  view.innerHTML = `<div class="ptitle"><div><h1>Lịch sử số dư</h1><p>50 biến động gần nhất.</p></div></div><div class="pcard"><div class="list">
    ${logs.map((l) => `<div class="row"><div class="grow"><div class="t">${LOG[l.type] || esc(l.type)}${l.ref ? ` <span class="muted small">${esc(l.ref)}</span>` : ''}</div>
      <div class="s">${fmtTime(l.created_at)}${l.note ? ` · ${esc(l.note)}` : ''}</div></div>
      <div class="r" style="color:${l.amount > 0 ? '#22c55e' : 'var(--text)'}">${l.amount > 0 ? '+' : ''}${money(l.amount)}<div class="small muted" style="font-weight:500">còn ${money(l.balance_after)}</div></div></div>`).join('')
    || '<p class="muted">Chưa có giao dịch.</p>'}</div></div>`;
}

// ================================================================ khởi động
(async function boot() {
  shop = await fetch('/api/public/shop').then((r) => r.json()).catch(() => ({ categories: [], games: [] }));
  const name = shop.shop_name || 'Shop';
  document.title = `Tài khoản · ${name}`;
  $('#shopName').textContent = name;
  paintMark($('#logoMark'), { logo: shop.logo, style: shop.logo_style, name });
  applyColors(shop.accent, shop.accent2);
  setFavicon({ logo: shop.logo, style: shop.logo_style, accent: shop.accent, accent2: shop.accent2, name });
  await loadMe();
  render();
})();
