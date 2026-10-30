import { applyColors, paintMark, setFavicon } from './brand.js';
import { API_DOCS, curl } from './apidocs.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => `${Math.round(Number(n) || 0).toLocaleString('vi-VN')}đ`;
const price = (p) => `${Number(p || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}đ`;
const num = (n) => (Number(n) || 0).toLocaleString('vi-VN');

// Gói buff hiển thị theo 1.000 lượt; gói trọn gói hiển thị giá cả gói
const PER1K = new Set(['quantity', 'days', 'minutes']);
const UNIT = { quantity: '/ 1.000', days: '/ 1.000 / ngày', minutes: '/ 1.000 / phút', comment: '/ bình luận', fixed: 'trọn gói', verify: 'trọn gói' };
const svcPrice = (s) => (PER1K.has(s.input_type) ? money(s.price * 1000) : price(s.price));

let shop = null;
let game = 0;
let cat = 0;
let query = '';
let sort = 'new';
let priceBand = 0;
let svcQuery = '';

const PRICE_BANDS = [
  [0, 'Mọi mức giá', 0, Infinity],
  [1, 'Dưới 500K', 0, 500000],
  [2, '500K – 2 triệu', 500000, 2000000],
  [3, 'Trên 2 triệu', 2000000, Infinity],
];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Giao diện sáng/tối, nhớ lựa chọn trên máy khách
function setTheme(t) {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
// Trang shop mặc định nền tối kiểu web game; khách đổi sang sáng thì nhớ lựa chọn
let savedTheme = null;
try { savedTheme = localStorage.getItem('theme'); } catch { /* bỏ qua */ }
setTheme(savedTheme || 'dark');
$('#themeBtn').addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  setTheme(next);
  try { localStorage.setItem('theme', next); } catch { /* bỏ qua */ }
});

function applyBrand() {
  const name = shop.shop_name || 'Shop';
  document.title = `${name} · ${shop.tagline || 'Acc game & dịch vụ'}`;
  ['#shopName', '#footName'].forEach((x) => ($(x).textContent = name));
  if (shop.tagline) $('#tagline').textContent = shop.tagline;
  if (shop.hero_title) $('#heroTitle').textContent = shop.hero_title;
  if (shop.hero_subtitle) $('#heroSub').textContent = shop.hero_subtitle;
  if (shop.footer_text) $('#footText').textContent = ` · ${shop.footer_text}`;
  document.querySelector('meta[property="og:title"]')?.setAttribute('content', name);
  document.querySelector('meta[name=description]')?.setAttribute('content', shop.tagline || '');
  paintMark($('#logoMark'), { logo: shop.logo, style: shop.logo_style, name });
  applyColors(shop.accent, shop.accent2);
  setFavicon({ logo: shop.logo, style: shop.logo_style, accent: shop.accent, accent2: shop.accent2, name });
}

function countUp() {
  $$('[data-count]').forEach((el) => {
    const target = Number(el.dataset.count);
    if (reduceMotion || !target) return;
    const start = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - start) / 900);
      el.textContent = Math.round(target * (1 - (1 - p) ** 3)).toLocaleString('vi-VN');
      if (p < 1) requestAnimationFrame(step);
    };
    el.textContent = '0';
    requestAnimationFrame(step);
  });
}

function reveal() {
  const els = $$('.reveal');
  if (reduceMotion || !('IntersectionObserver' in window)) return els.forEach((e) => e.classList.add('in'));
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { rootMargin: '0px 0px -60px 0px' });
  els.forEach((e) => io.observe(e));
  // Dự phòng: trình duyệt trong app (Zalo, Facebook) đôi khi không báo cuộn, vẫn phải hiện nội dung
  setTimeout(() => els.forEach((e) => e.classList.add('in')), 1500);
}

const botLink = (start = '') => (shop?.bot_username ? `https://t.me/${shop.bot_username}${start ? `?start=${start}` : ''}` : '#');

async function init() {
  $('#year').textContent = new Date().getFullYear();
  try {
    const res = await fetch('/api/public/shop');
    if (!res.ok) throw new Error();
    shop = await res.json();
  } catch {
    $('#accGrid').innerHTML = '<div class="empty">Không tải được dữ liệu. Vui lòng tải lại trang.</div>';
    return;
  }
  applyBrand();
  // Đã đăng nhập cổng khách hàng thì hiện số dư thay cho nút Đăng nhập
  fetch('/api/me').then((r) => r.json()).then((m) => {
    if (m.authed) $('#accountBtn').innerHTML = `<span class="acc-lbl">Tài khoản · </span>${money(m.user.balance)}`;
  }).catch(() => {});
  // Banner đã chứa hình thương hiệu: không hiện thêm logo lớn để tránh chồng hình
  if (shop.hero_art && !shop.hero_image) {
    $('#heroArt').src = shop.hero_art;
    $('#heroArt').alt = `Logo ${shop.shop_name || ''}`;
    $('#heroArtBox').classList.remove('hidden');
  }
  if (shop.hero_image) {
    const h = document.querySelector('.hero');
    h.classList.add('has-banner');
    h.style.setProperty('--banner', `url("${shop.hero_image}")`);
  }
  $('#botBtn').href = botLink();
  $('#heroBot').href = botLink();
  if (!shop.bot_username) ['#botBtn', '#heroBot'].forEach((s) => $(s).classList.add('hidden'));

  if (shop.notice) {
    $('#notice').textContent = shop.notice;
    $('#notice').classList.remove('hidden');
  }
  const zalo = String(shop.support_zalo || '').replace(/\D/g, '');
  const contacts = [];
  if (zalo) {
    $('#zaloFab').href = `https://zalo.me/${zalo}`;
    $('#zaloFab').classList.remove('hidden');
    contacts.push(`Zalo: <a href="https://zalo.me/${zalo}" target="_blank" rel="noopener">${esc(shop.support_zalo)}</a>`);
  }
  if (shop.support_url) contacts.push(`<a href="${esc(shop.support_url)}" target="_blank" rel="noopener">Telegram hỗ trợ</a>`);
  $('#footContact').innerHTML = contacts.join(' · ');

  const accCount = shop.games.reduce((n, g) => n + g.accounts.length, 0);
  const svcCount = shop.categories.reduce((n, c) => n + c.services.length, 0);
  $('#stats').innerHTML = [
    [`<span data-count="${accCount}">${num(accCount)}</span>`, 'acc đang bán'],
    [`<span data-count="${svcCount}">${num(svcCount)}</span>`, 'gói dịch vụ'],
    ['1–3 phút', 'nạp tiền tự động'],
    ...(shop.bonus ? [[`+${shop.bonus}%`, 'khuyến mãi nạp']] : []),
  ].map(([b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join('');

  if (!shop.games.length) $('#accs').classList.add('hidden');
  if (!shop.categories.length) $('#services').classList.add('hidden');
  renderGames();
  renderCats();
  renderApi();
  countUp();
  reveal();

  $('#accSearch').addEventListener('input', (e) => { query = e.target.value.trim().toLowerCase(); renderAccs(); });
  $('#accSort').addEventListener('change', (e) => { sort = e.target.value; renderAccs(); });
  $('#svcSearch').addEventListener('input', (e) => { svcQuery = e.target.value.trim().toLowerCase(); renderCats(); });
  $('#priceChips').innerHTML = PRICE_BANDS.map(([id, label]) => `<button class="chip ${id === priceBand ? 'on' : ''}" data-p="${id}">${label}</button>`).join('');
  $$('[data-p]').forEach((b) => b.addEventListener('click', () => {
    priceBand = Number(b.dataset.p);
    $$('[data-p]').forEach((x) => x.classList.toggle('on', x === b));
    renderAccs();
  }));

  // Mở thẳng acc khi có #acc-12 trên URL
  const m = location.hash.match(/^#acc-(\d+)$/);
  if (m) openAcc(Number(m[1]));
}

function renderGames() {
  const total = shop.games.reduce((n, g) => n + g.accounts.length, 0);
  const chips = [[0, 'Tất cả', total], ...shop.games.map((g) => [g.id, g.name, g.accounts.length])];
  $('#gameChips').innerHTML = shop.games.length > 1
    ? chips.map(([id, n, c]) => `<button class="chip ${id === game ? 'on' : ''}" data-g="${id}">${esc(n)}<span class="n">${c}</span></button>`).join('')
    : '';
  $$('[data-g]').forEach((b) => b.addEventListener('click', () => { game = Number(b.dataset.g); renderGames(); }));
  renderAccs();
}

function allAccs() {
  return shop.games.flatMap((g) => g.accounts.map((a) => ({ ...a, game: g.name, game_id: g.id })));
}

function renderAccs() {
  const [, , lo, hi] = PRICE_BANDS[priceBand];
  const list = allAccs().filter((a) => (!game || a.game_id === game)
    && a.price >= lo && a.price < hi
    && (!query || `#${a.id} ${a.title} ${a.info} ${a.description}`.toLowerCase().includes(query)));
  if (sort === 'asc') list.sort((x, y) => x.price - y.price);
  else if (sort === 'desc') list.sort((x, y) => y.price - x.price);
  else list.sort((x, y) => y.id - x.id);
  $('#accGrid').innerHTML = list.length
    ? list.map((a, i) => `<button class="acc" data-acc="${a.id}" style="animation-delay:${Math.min(i, 12) * 40}ms">
        <div class="cover-wrap"><div class="cover" style="${a.images[0] ? `background-image:url('${esc(a.images[0])}')` : ''}"></div>
          <span class="tag">#${a.id} · ${esc(a.game)}</span>${a.is_new ? '<span class="new">MỚI</span>' : ''}
          ${a.images.length > 1 ? `<span class="cnt">${a.images.length} ảnh</span>` : ''}</div>
        <div class="body"><div class="title">${esc(a.title || 'Acc')}</div><div class="info">${esc(a.info)}</div>
          <div class="row"><span class="price">${money(a.price)}</span><span class="go">Xem chi tiết</span></div></div>
      </button>`).join('')
    : `<div class="empty">${query || priceBand ? 'Không tìm thấy acc phù hợp.' : 'Hiện đã hết acc, quay lại sau nhé.'}</div>`;
  $$('[data-acc]').forEach((b) => b.addEventListener('click', () => openAcc(Number(b.dataset.acc))));
}

function renderCats() {
  const cats = shop.categories;
  $('#catChips').innerHTML = cats.length > 1
    ? [[0, 'Tất cả'], ...cats.map((c) => [c.id, c.name])].map(([id, n]) => `<button class="chip ${id === cat ? 'on' : ''}" data-c="${id}">${esc(n)}</button>`).join('')
    : '';
  $$('[data-c]').forEach((b) => b.addEventListener('click', () => { cat = Number(b.dataset.c); renderCats(); }));
  const match = (x) => !svcQuery || `${x.name} ${x.description || ''}`.toLowerCase().includes(svcQuery);
  const shown = cats.filter((c) => !cat || c.id === cat).map((c) => ({ ...c, services: c.services.filter(match) })).filter((c) => c.services.length);
  if (!shown.length) {
    $('#svcList').innerHTML = '<div class="empty">Không tìm thấy dịch vụ phù hợp.</div>';
    return;
  }
  $('#svcList').innerHTML = shown.map((c) => `
    <div class="svc-group"><h3>${esc(c.name)}</h3><div class="svc-list">
      ${c.services.map((s) => `<div class="svc">
        <div><div class="name">${esc(s.name)}</div>${s.description ? `<div class="desc">${esc(s.description)}</div>` : ''}</div>
        <div class="p">${svcPrice(s)}<small>${UNIT[s.input_type] || ''}${!['fixed', 'verify'].includes(s.input_type) ? ` · tối thiểu ${num(s.min_qty)}` : ''}</small></div>
        <a class="btn primary" href="/app/#/services/${s.id}">Đặt ngay</a>
      </div>`).join('')}
    </div></div>`).join('');
}

function renderApi() {
  if (!shop.api_enabled && !shop.child_enabled) {
    $('#navApi').classList.add('hidden');
    return;
  }
  $('#api').classList.remove('hidden');
  if (!shop.child_enabled) $('#childCard').classList.add('hidden');
  if (!shop.api_enabled) $('#apiCard').classList.add('hidden');
  $('#childBtn').href = botLink();
  const url = `${location.origin}/api/v2`;
  $('#apiUrl').textContent = url;
  $('#apiTabs').innerHTML = API_DOCS.map(([x], i) => `<button class="${i ? '' : 'on'}" data-t="${x}">${x}</button>`).join('');
  const draw = (t) => {
    const [, desc, rq, rs] = API_DOCS.find((d) => d[0] === t);
    $('#apiCode').textContent = `// ${desc}\n${curl(url, rq)}\n\n// Phản hồi\n${rs}`;
    $$('#apiTabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
  };
  $$('#apiTabs button').forEach((b) => b.addEventListener('click', () => draw(b.dataset.t)));
  draw('services');
}

function openAcc(id) {
  const a = allAccs().find((x) => x.id === id);
  if (!a) return;
  history.replaceState(null, '', `#acc-${id}`);
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Acc #${a.id}">
    <button class="close" aria-label="Đóng">✕</button>
    <div class="gallery">
      <div class="slides">${a.images.length ? a.images.map((u, i) => `<img src="${esc(u)}" alt="Ảnh ${i + 1} của acc #${a.id}" loading="${i ? 'lazy' : 'eager'}">`).join('') : '<div style="flex:0 0 100%;display:grid;place-items:center;color:#888">Chưa có ảnh</div>'}</div>
      ${a.images.length > 1 ? `<div class="thumbs">${a.images.map((u, i) => `<button data-i="${i}" class="${i ? '' : 'on'}" style="background-image:url('${esc(u)}')" aria-label="Ảnh ${i + 1}"></button>`).join('')}</div>` : ''}
    </div>
    <div class="detail">
      <div class="code">${esc(a.game)} · Mã acc #${a.id}</div>
      <h3>${esc(a.title || 'Acc game')}</h3>
      ${a.info ? `<div class="info">${esc(a.info)}</div>` : ''}
      ${a.description ? `<div class="desc">${esc(a.description)}</div>` : ''}
      <div class="price">${money(a.price)}</div>
      <a class="btn primary lg block" href="/app/#/accs/${a.id}">Mua ngay trên web</a>
      ${shop.bot_username ? `<a class="btn lg block" href="${botLink(`acc_${a.id}`)}" target="_blank" rel="noopener">Mua qua bot Telegram</a>` : ''}
      <div class="hint">Thanh toán bằng số dư, acc giao tự động hiện thông tin ngay.</div>
    </div></div>`;
  const close = () => {
    bg.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    history.replaceState(null, '', location.pathname + location.search);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const sl = $('.slides', bg);
      sl.scrollBy({ left: (e.key === 'ArrowRight' ? 1 : -1) * sl.clientWidth, behavior: 'smooth' });
    }
  };
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  $('.close', bg).addEventListener('click', close);
  document.addEventListener('keydown', onKey);

  const slides = $('.slides', bg);
  $$('.thumbs button', bg).forEach((t) => t.addEventListener('click', () => {
    slides.scrollTo({ left: Number(t.dataset.i) * slides.clientWidth, behavior: 'smooth' });
  }));
  slides.addEventListener('scroll', () => {
    const i = Math.round(slides.scrollLeft / Math.max(1, slides.clientWidth));
    $$('.thumbs button', bg).forEach((t, k) => t.classList.toggle('on', k === i));
  }, { passive: true });

  document.body.style.overflow = 'hidden';
  $('#modalRoot').append(bg);
}

init();
