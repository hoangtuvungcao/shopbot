// Logo dựng sẵn (glyph trắng trên nền gradient neon), dùng chung cho trang shop và admin.
// Các lỗ khoét (evenodd) để lộ nền gradient bên dưới.
export const MARKS = {
  controller:
    'M7.4 5.5h9.2c2.4 0 4.4 1.8 4.8 4.2l.95 6c.32 2.1-1.3 4-3.4 4-1.15 0-2.2-.6-2.8-1.6l-1-1.6H8.85l-1 1.6c-.6 1-1.65 1.6-2.8 1.6-2.1 0-3.72-1.9-3.4-4l.95-6C3 7.3 5 5.5 7.4 5.5z' +
    'M6.6 9.3h1.6v1.7h1.7v1.6H8.2v1.7H6.6v-1.7H4.9V11h1.7z' +
    'M16.2 8.9a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2z' +
    'M18.5 11.3a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2z',
  shield:
    'M12 2.2 4.2 5v6.1c0 4.9 3.3 9.2 7.8 10.7 4.5-1.5 7.8-5.8 7.8-10.7V5z' +
    'M13.1 6.6 8.9 12.9h2.7l-.8 4.6 4.3-6.4h-2.7z',
  bolt:
    'M13.2 2.5 5.6 13.1c-.4.6 0 1.4.8 1.4h4.4l-1.3 6.6c-.2.9 1 1.4 1.5.6l7.6-10.6c.4-.6 0-1.4-.8-1.4h-4.4l1.3-6.6c.2-.9-1-1.4-1.5-.6z',
};

export const MARK_NAMES = { monogram: 'Chữ cái', controller: 'Tay cầm game', shield: 'Khiên esports', bolt: 'Tia sét' };

// Bộ màu dựng sẵn: màu chính + màu phụ tạo gradient
export const PRESETS = {
  pinkshop: ['Hồng SHOPBOT', '#ec4899', '#8b5cf6'],
  candy: ['Hồng kẹo', '#f43f5e', '#f472b6'],
  neon: ['Neon tím', '#8b5cf6', '#22d3ee'],
  fire: ['Lửa esports', '#ef4444', '#f59e0b'],
  ocean: ['Đại dương', '#2563eb', '#06b6d4'],
  toxic: ['Xanh độc', '#16a34a', '#a3e635'],
  gold: ['Hoàng kim', '#d97706', '#facc15'],
};

const hex = (x, d) => (/^#[0-9a-f]{6}$/i.test(x || '') ? x : d);

/** Áp màu thương hiệu vào biến CSS của trang. */
export function applyColors(accent, accent2) {
  const a = hex(accent, '#ec4899');
  const b = hex(accent2, '#8b5cf6');
  const r = document.documentElement.style;
  r.setProperty('--accent', a);
  r.setProperty('--accent-2', b);
  r.setProperty('--accent-soft', `color-mix(in srgb, ${a} 16%, var(--surface))`);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', a);
}

const pathOf = (style) => MARKS[style] || MARKS.controller;

export function markSvg(style) {
  return `<svg class="mark-glyph" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="${pathOf(style)}"/></svg>`;
}

/** Đổ logo vào phần tử .gmark: ảnh tải lên nếu có, ngược lại là glyph dựng sẵn. */
const initial = (name) => (String(name || 'S').trim().match(/[\p{L}\p{N}]/u)?.[0] || 'S').toUpperCase();

export function paintMark(el, { logo, style, name } = {}) {
  if (!el) return;
  el.classList.toggle('has-img', !!logo);
  el.style.backgroundImage = logo ? `url("${logo}")` : '';
  el.innerHTML = logo ? '' : style === 'monogram' ? `<span class="mono">${initial(name)}</span>` : markSvg(style);
}

/** Favicon SVG cùng kiểu logo và màu chủ đạo. */
export function iconDataUrl(style, accent, accent2, name) {
  const glyph = style === 'monogram'
    ? `<text x="32" y="44" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="34" fill="#fff">${initial(name)}</text>`
    : `<path transform="translate(11 11) scale(1.75)" fill="#fff" fill-rule="evenodd" d="${pathOf(style)}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${hex(accent, '#ec4899')}"/><stop offset="1" stop-color="${hex(accent2, '#8b5cf6')}"/></linearGradient></defs>
<rect width="64" height="64" rx="16" fill="url(#g)"/>${glyph}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function setFavicon({ logo, style, accent, accent2, name }) {
  const href = logo || iconDataUrl(style, accent, accent2, name);
  document.querySelectorAll('link[rel=icon], link[rel=apple-touch-icon]').forEach((l) => { l.href = href; });
}
