import { musicMark, MUSIC_WHITE } from './_brand';
import { defineWidgets, type WidgetSize } from './_api';

type Media = { session: boolean; playing: boolean; title: string; artist: string; album: string; app: string; art: string; generic?: boolean };
type Track = { key: string; title: string; artist: string; thumb: string; count: number; at: number };
type Pal = { a: string; b: string; bg?: string };
type State = { now: Media | null; art: string; pal: Pal | null; hist: Track[] };

type Api = { getMedia?: () => Promise<Media>; mediaControl?: (a: 'toggle' | 'next' | 'prev') => void };
const api = () => (window as unknown as { overlayAPI?: Api }).overlayAPI;
const hook = () => (window as unknown as { __mediaFetch?: () => Promise<Media> }).__mediaFetch;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const HIST_KEY = 'lucent-music-v1';
const RED = '#fa2d48';

const GENERIC = /\bis playing (media|audio|video|music)\b/i;
function appName(m: Media): string {
  const fromTitle = /^(.+?) is playing\b/i.exec(m.title)?.[1] ?? '';
  const raw = (m.app || '').replace(/\.exe$/i, '');
  const opaque = !raw || /^[0-9a-f]{10,}$/i.test(raw) || raw.includes('!');
  const name = opaque ? fromTitle : raw.split(/[.\\/]/).pop() || raw;
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : 'your browser';
}
const tidy = (m: Media): Media => (GENERIC.test(m.title) ? { ...m, title: `Playing in ${appName(m)}`, artist: m.artist || 'No song info', generic: true } : m);

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('image'));
    i.src = src;
  });
}
async function shrink(src: string, px: number): Promise<string> {
  try {
    const i = await loadImg(src);
    const side = Math.min(i.naturalWidth, i.naturalHeight);
    const c = document.createElement('canvas');
    c.width = c.height = Math.min(px, side);
    c.getContext('2d')!.drawImage(i, (i.naturalWidth - side) / 2, (i.naturalHeight - side) / 2, side, side, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  } catch {
    return '';
  }
}

const rgb2hsl = (r: number, g: number, b: number): [number, number, number] => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
};
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));


function lumOf(h: number, s: number, l: number): number {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(0) + 0.7152 * f(8) + 0.0722 * f(4);
}
function gradientOf(h: number, sat: number): Pal {
  const s = clamp(sat * 0.95, 0.1, 0.85);
  const vivid = clamp(s / 0.45, 0, 1);
  let la = 0.3 + 0.28 * vivid;
  while (la > 0.26 && lumOf(h, s, la) > 0.3) la -= 0.02;
  const lb = Math.max(0.14, la - 0.16);
  return { a: `hsl(${h.toFixed(0)},${(s * 100).toFixed(0)}%,${(la * 100).toFixed(0)}%)`, b: `hsl(${((h + 10) % 360).toFixed(0)},${(Math.min(1, s * 1.05) * 100).toFixed(0)}%,${(lb * 100).toFixed(0)}%)` };
}

type Blob = { h: number; s: number; l: number; x: number; y: number; w: number; dark?: boolean };
function meshOf(blobs: Blob[], base: [number, number, number], img?: CanvasImageSource): string {
  const N = 192;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  g.fillStyle = `hsl(${base[0].toFixed(0)},${base[1].toFixed(0)}%,${Math.max(base[2], 16)}%)`;
  g.fillRect(0, 0, N, N);
  if (img) {
    g.save();
    g.globalAlpha = 0.4;
    g.translate(N / 2, N / 2);
    g.rotate(-0.5);
    g.drawImage(img, -N * 0.9, -N * 0.9, N * 1.8, N * 1.8);
    g.restore();
  }
  const spots: [number, number][] = [[0.1, 0.1], [0.92, 0.18], [0.12, 0.88], [0.9, 0.9], [0.5, 0.5], [0.5, 0.02]];
  const list = [...blobs].sort((p, q) => q.w - p.w);
  let n = 0;
  list.forEach((b, i) => {
    let l = b.l;
    if (!b.dark) while (l > 0.27 && lumOf(b.h, b.s, l) > 0.34) l -= 0.02;
    const k = 0.4 + 0.6 * b.w;
    const col = (a: number) => `hsla(${b.h.toFixed(0)},${(b.s * 100).toFixed(0)}%,${(l * 100).toFixed(0)}%,${(a * k).toFixed(3)})`;
    const [sx, sy] = b.dark ? [0.82, 0.95] : spots[n++ % spots.length];
    const r = N * (0.5 + 0.42 * b.w);
    g.save();
    g.translate(sx * N, sy * N);
    g.rotate(-0.62 + (i % 2) * 0.35);
    g.scale(1.7, 0.85);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
    gr.addColorStop(0, col(1));
    gr.addColorStop(0.55, col(0.8));
    gr.addColorStop(1, col(0));
    g.fillStyle = gr;
    g.fillRect(-N * 2, -N * 2, N * 4, N * 4);
    g.restore();
  });
  const t = document.createElement('canvas');
  t.width = t.height = N;
  const tg = t.getContext('2d')!;
  try {
    tg.filter = 'blur(14px) saturate(1.25)';
  } catch {
  }
  tg.drawImage(c, -16, -16, N + 32, N + 32);
  return t.toDataURL('image/jpeg', 0.88);
}

export function paletteOf(img: CanvasImageSource & { width?: number }): Pal {
  const N = 32;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, N, N);
  const d = g.getImageData(0, 0, N, N).data;
  const hue = new Array(12).fill(0);
  const area = new Array(12).fill(0);
  const sum = Array.from({ length: 12 }, () => [0, 0, 0, 0, 0, 0]);
  let tr = 0, tg = 0, tb = 0, dark = 0;
  for (let i = 0; i < d.length; i += 4) {
    const [h, s, l] = rgb2hsl(d[i], d[i + 1], d[i + 2]);
    tr += d[i]; tg += d[i + 1]; tb += d[i + 2];
    if (l < 0.2) dark++;
    if (l < 0.16 || l > 0.9 || s < 0.14) continue;
    const w = s * (1 - Math.abs(2 * l - 1)) ** 1.5;
    if (w < 0.04) continue;
    const k = Math.floor(h / 30) % 12;
    const p = i / 4;
    hue[k] += w;
    area[k]++;
    sum[k][0] += d[i] * w; sum[k][1] += d[i + 1] * w; sum[k][2] += d[i + 2] * w; sum[k][3] += w;
    sum[k][4] += ((p % N) / N) * w; sum[k][5] += (Math.floor(p / N) / N) * w;
  }
  const px = d.length / 4;
  const soft = hue.map((v, k) => v + 0.5 * (hue[(k + 11) % 12] + hue[(k + 1) % 12]));
  let best = 0;
  for (let k = 1; k < 12; k++) if (soft[k] > soft[best]) best = k;
  let [h, s] = rgb2hsl(tr / px, tg / px, tb / px);
  if (sum[best][3] > 0.6) {
    const w = sum[best][3];
    const [hh, ss] = rgb2hsl(sum[best][0] / w, sum[best][1] / w, sum[best][2] / w);
    const mix = clamp(hue[best] / (px * 0.25), 0, 1);
    h = hh;
    s = s + (ss - s) * mix;
  }
  const blobs: Blob[] = [];
  const order = [...hue.keys()].sort((p, q) => hue[q] - hue[p]);
  const top = hue[order[0]] || 1;
  for (const k of order) {
    if (blobs.length >= 4 || sum[k][3] < 0.5) break;
    if (blobs.length && (hue[k] < top * 0.3 || area[k] < px * 0.05)) continue;
    if (blobs.some((b) => Math.abs(((b.h - (k * 30 + 15) + 540) % 360) - 180) < 30)) continue;
    const w = sum[k][3];
    const [bh, bs, bl] = rgb2hsl(sum[k][0] / w, sum[k][1] / w, sum[k][2] / w);
    blobs.push({
      h: bh,
      s: clamp(bs * 1.15 + 0.12, 0.5, 0.95),
      l: clamp(bl + 0.05, 0.4, 0.56),
      x: clamp(0.5 + (sum[k][4] / w - 0.5) * 2, 0.04, 0.96),
      y: clamp(0.5 + (sum[k][5] / w - 0.5) * 2, 0.04, 0.96),
      w: clamp(hue[k] / top, 0.3, 1),
    });
  }
  const lead = blobs[0];
  if (lead && lead.s > 0.35) {
    if (blobs.length < 2) blobs.push({ h: (lead.h + (lead.h > 200 && lead.h < 300 ? -24 : 24) + 360) % 360, s: lead.s * 0.9, l: Math.max(0.36, lead.l - 0.1), x: 0.5, y: 0.5, w: 0.7 });
    const df = dark / px;
    if (df >= 0.1) blobs.push({ h: lead.h, s: clamp(lead.s * 0.8, 0.35, 0.8), l: 0.16, x: 0.8, y: 0.95, w: clamp(df * 2, 0.45, 0.9), dark: true });
  } else if (blobs.length < 2) {
    const sat = clamp(s * 0.9, 0.06, 0.4);
    blobs.push({ h, s: sat, l: 0.34, x: 0.15, y: 0.1, w: 1 }, { h: (h + 18) % 360, s: sat, l: 0.26, x: 0.9, y: 0.95, w: 1 });
  }
  const grad = gradientOf(h, s);
  const base: [number, number, number] = lead && lead.s > 0.35 ? [lead.h, clamp(lead.s * 100 * 0.7, 25, 65), 18] : [blobs[0]?.h ?? h, clamp(s * 100 * 0.9, 8, 55), 17];
  return { ...grad, bg: meshOf(blobs, base, img) };
}
async function palette(art: string): Promise<Pal | null> {
  try {
    return paletteOf(await loadImg(art));
  } catch {
    return null;
  }
}

const state: State = { now: null, art: '', pal: null, hist: [] };
try {
  state.hist = (JSON.parse(localStorage.getItem(HIST_KEY) || '[]') as Track[]).filter((t) => !GENERIC.test(t.title) && !/^Playing in /.test(t.title));
} catch {
}
const saveHist = () => {
  try {
    localStorage.setItem(HIST_KEY, JSON.stringify(state.hist.slice(0, 30)));
  } catch {
  }
};
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let lastKey = '';
let busy = false;
let sig = '';
const emit = () => {
  const s = [state.now?.title, state.now?.artist, state.now?.playing, state.art.length, state.hist.map((t) => t.key + t.count).join()].join('|');
  if (s === sig) return;
  sig = s;
  subs.forEach((f) => f());
};

async function apply(raw: Media | null) {
  const m = raw && raw.title ? tidy(raw) : null;
  if (!m) {
    state.now = null;
    state.art = '';
    state.pal = null;
    return emit();
  }
  const key = `${m.title}\u0001${m.artist}`;
  const changed = key !== lastKey;
  state.now = m;
  if (changed || (m.art && !state.art)) {
    if (changed) lastKey = key;
    state.art = m.art ? await shrink(m.art, 256) : '';
    state.pal = state.art ? await palette(state.art) : null;
    if (!m.generic) {
      const thumb = m.art ? await shrink(m.art, 96) : '';
      const i = state.hist.findIndex((t) => t.key === key);
      const t: Track = i >= 0 ? state.hist[i] : { key, title: m.title, artist: m.artist, thumb, count: 0, at: 0 };
      if (i >= 0) state.hist.splice(i, 1);
      if (changed) t.count++;
      if (thumb) t.thumb = thumb;
      t.at = Date.now();
      state.hist.unshift(t);
      saveHist();
    }
  }
  emit();
}
async function poll() {
  if (busy) return;
  busy = true;
  try {
    const f = hook() ?? api()?.getMedia;
    await apply(f ? await f() : null);
  } catch {
  } finally {
    busy = false;
  }
}
function subscribe(f: () => void) {
  subs.add(f);
  if (subs.size === 1) {
    void poll();
    timer = setInterval(poll, 2000);
  }
  return () => {
    subs.delete(f);
    if (!subs.size && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

const noteSvg = (s: number, color: string) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="${color}"><path d="M17.5 2.6 9.2 4.3c-.5.1-.8.5-.8 1v10.3A3.6 3.6 0 0 0 7 15.3c-1.9 0-3.5 1.3-3.5 3s1.6 3 3.5 3 3.5-1.3 3.5-3V9l5.6-1.2v5A3.6 3.6 0 0 0 14.6 12c-1.9 0-3.5 1.3-3.5 3s1.6 3 3.5 3 3.5-1.3 3.5-3V3.6c0-.7-.4-1.1-.6-1Z" transform="translate(.6 0)"/></svg>`;
const playSvg = '<svg width="11" height="12" viewBox="0 0 11 12"><path d="M1.5 1.1v9.8c0 .6.6.9 1.1.6l8-4.9c.4-.3.4-.9 0-1.2l-8-4.9c-.5-.3-1.1 0-1.1.6Z" fill="currentColor"/></svg>';
const pauseSvg = '<svg width="11" height="12" viewBox="0 0 11 12"><rect x="1.2" y="1" width="3" height="10" rx="1" fill="currentColor"/><rect x="6.8" y="1" width="3" height="10" rx="1" fill="currentColor"/></svg>';

type Cur = { title: string; artist: string; art: string; playing: boolean; live: boolean; pal: Pal | null; seed: string };
function current(): Cur | null {
  const n = state.now;
  if (n?.title) {
    const seed = `${n.title}${n.artist}`;
    return { title: n.title, artist: n.artist, art: state.art, playing: n.playing, live: true, pal: n.playing ? state.pal ?? fallbackPal(seed) : null, seed };
  }
  const t = state.hist[0];
  return t ? { title: t.title, artist: t.artist, art: t.thumb, playing: false, live: false, pal: null, seed: `${t.title}${t.artist}` } : null;
}

const seedHue = (s: string) => {
  let h = 7;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
};
const fallbackPal = (seed: string): Pal => {
  const h = seedHue(seed);
  const grad = gradientOf(h, 0.4);
  return { ...grad, bg: meshOf([{ h, s: 0.5, l: 0.42, x: 0.15, y: 0.15, w: 1 }, { h: (h + 50) % 360, s: 0.5, l: 0.38, x: 0.85, y: 0.35, w: 0.9 }, { h: (h + 300) % 360, s: 0.45, l: 0.34, x: 0.5, y: 0.95, w: 0.9 }], [h, 30, 12]) };
};
const art = (src: string, px: number, seed: string) => {
  const size = px ? `width:${px}px;height:${px}px;` : '';
  if (src) return `<div class="mu-art" style="${size}background-image:url(${src})"></div>`;
  const h = seedHue(seed);
  return `<div class="mu-art" style="${size}background:linear-gradient(150deg,hsl(${h},64%,66%),hsl(${(h + 42) % 360},62%,44%))">${noteSvg(Math.round((px || 64) * 0.46), 'rgba(255,255,255,.92)')}</div>`;
};

const pill = (playing: boolean, live = true) => `<button class="mu-pill ix${live ? '' : ' off'}" data-act="toggle" aria-label="${playing ? 'Pause' : 'Play'}">${playing ? pauseSvg : playSvg}<span>${playing ? 'Pause' : 'Play'}</span></button>`;
const label = (playing: boolean) => `<div class="mu-lbl${playing ? '' : ' red'}">${playing ? 'Now Playing' : 'Recently Played'}</div>`;
const empty = (hint = 'Play something in your music app') => `<div class="mu-empty">${noteSvg(22, 'rgba(255,255,255,.4)')}<div>${hint}</div></div>`;
const titles = (c: { title: string; artist: string }) => `<div class="mu-txt"><div class="mu-t">${esc(c.title)}</div><div class="mu-a">${esc(c.artist)}</div></div>`;

const nowS = (c: Cur) => `<div class="mu-top">${art(c.art, 56, c.seed)}<div class="mu-ic">${musicMark(c.playing)}</div></div>
  <div class="mu-bot">${titles(c)}${pill(c.playing, c.live)}</div>`;
const nowM = (c: Cur) => `<div class="mu-row">${art(c.art, 118, c.seed)}<div class="mu-col"><div class="mu-hd">${label(c.playing)}<div class="mu-ic">${musicMark(c.playing)}</div></div>
  <div class="mu-txt big"><div class="mu-t">${esc(c.title)}</div><div class="mu-a">${esc(c.artist)}</div></div>${pill(c.playing, c.live)}</div></div>`;

const listRows = (ts: Track[], px: number) =>
  ts.map((t) => `<div class="mu-li">${art(t.thumb, px, t.title + t.artist)}${titles(t)}</div>`).join('');
const head = (title: string) => `<div class="mu-h"><span>${title}</span>${musicMark(false)}</div>`;
const recentView = (n: number, px: number) => (): string => {
  const ts = state.hist.slice(0, n);
  return head('Recently Played') + (ts.length ? `<div class="mu-list">${listRows(ts, px)}</div>` : empty());
};
const topView = (n: number, cols: number) => (): string => {
  const ts = [...state.hist].sort((a, b) => b.count - a.count || b.at - a.at).slice(0, n);
  return (
    head('Most Played') +
    (ts.length
      ? `<div class="mu-grid" style="grid-template-columns:repeat(${cols},1fr)">${ts.map((t) => `<div class="mu-tile">${art(t.thumb, 0, t.title + t.artist)}<div class="mu-cap">${esc(t.title)}</div></div>`).join('')}</div>`
      : empty())
  );
};

function music(kind: 'now' | 'recent' | 'top', size: WidgetSize, view?: () => string) {
  return (root: HTMLElement) => {
    const wc = document.createElement('div');
    root.appendChild(wc);
    const draw = () => {
      if (kind === 'now') {
        const c = current();
        wc.className = `wc solid mu mu-${size.toLowerCase()}${c?.pal ? ' mu-tint' : ''}`;
        wc.setAttribute('style', c?.pal ? `background:${c.pal.bg ? `linear-gradient(rgba(0,0,0,.02),rgba(0,0,0,.22)),url(${c.pal.bg}) center/cover no-repeat,` : ''}linear-gradient(165deg,${c.pal.a},${c.pal.b})` : '');
        wc.innerHTML = c ? (size === 'S' ? nowS(c) : nowM(c)) : empty();
      } else {
        wc.className = 'wc solid mu mu-list-w';
        wc.removeAttribute('style');
        wc.innerHTML = view!();
      }
    };
    const click = (e: Event) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!b || !state.now) return;
      const act = b.dataset.act as 'toggle' | 'next' | 'prev';
      api()?.mediaControl?.(act);
      if (act === 'toggle') {
        state.now = { ...state.now, playing: !state.now.playing };
        draw();
      }
      setTimeout(poll, act === 'toggle' ? 600 : 900);
    };
    wc.addEventListener('click', click);
    draw();
    const off = subscribe(draw);
    return () => {
      off();
      wc.removeEventListener('click', click);
      wc.remove();
    };
  };
}

const css = document.createElement('style');
css.textContent = `
.mu{display:flex;flex-direction:column;padding:14px;font-family:"Inter",sans-serif;color:#fff;transition:background .5s}
.mu-art{flex:none;border-radius:10px;background:rgba(255,255,255,.1) center/cover no-repeat;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.3)}
.mu-top,.mu-hd{display:flex;justify-content:space-between;align-items:flex-start}
.mu-ic{flex:none;display:flex}
.mu-txt{min-width:0}
.mu-t{font:600 12.5px/1.25 "Inter",sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mu-a{font:500 12.5px/1.25 "Inter",sans-serif;color:rgba(255,255,255,.58);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mu-txt.big .mu-t{font-size:17px;font-weight:700;letter-spacing:-.01em}
.mu-txt.big .mu-a{font-size:15px}
.mu-s .mu-bot{margin-top:auto;display:flex;flex-direction:column;align-items:flex-start;gap:7px}
.mu-s .mu-bot .mu-txt{width:100%}
.mu-pill{all:unset;box-sizing:border-box;flex:none;display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 12px 0 10px;border-radius:13px;background:rgba(255,255,255,.2);color:#fff;font:600 12.5px/1 \"Inter\",sans-serif;cursor:default}
.mu-pill:hover{background:rgba(255,255,255,.3)}
.mu-pill:active{filter:brightness(1.2)}
.mu-pill.off{opacity:.55}
.mu-pill svg{width:10px;height:11px;flex:none}
.mu-col .mu-pill{align-self:flex-start}
.mu-lbl{font:700 11px/1 "Inter",sans-serif;letter-spacing:.04em;text-transform:uppercase;color:rgba(255,255,255,.62);margin-top:3px}
.mu-lbl.red{color:${RED}}
.mu-tint .mu-lbl.red{color:rgba(255,255,255,.62)}
.mu-row{display:flex;gap:14px;height:100%;align-items:stretch}
.mu-col{flex:1;min-width:0;display:flex;flex-direction:column}
.mu-col .mu-txt{margin:auto 0 9px}
.mu-li{display:flex;align-items:center;gap:11px;min-width:0}
.mu-li .mu-t{font-size:13px}
.mu-list{display:flex;flex-direction:column;flex:1;min-height:0;justify-content:flex-start;gap:12px}
.mu-empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:16px;font:500 12.5px/1.3 "Inter",sans-serif;color:rgba(255,255,255,.45);text-align:center}
.mu-h{flex:none;display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;font:700 15px/1 "Inter",sans-serif;color:${RED}}
.mu-grid{flex:1;min-height:0;display:grid;align-content:space-between;gap:8px 9px}
.mu-tile{min-width:0;display:flex;flex-direction:column;gap:5px;align-items:stretch}
.mu-tile .mu-art{width:100%;height:auto;aspect-ratio:1;border-radius:9px}
.mu-cap{flex:none;font:500 11px/1.15 "Inter",sans-serif;text-align:center;color:rgba(255,255,255,.85);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mu-list-w{padding:14px 14px 12px}
.widget[data-wstyle="light"] .wmount .wc.solid.mu{filter:none;color:#fff}
.widget[data-wstyle="light"] .wmount .wc.solid.mu:not(.mu-tint){background:linear-gradient(165deg,#ff5a6f 0%,#f92b4b 100%) !important}
.widget[data-wstyle="light"] .mu :is(.mu-h,.mu-t,.mu-cap){color:#fff}
.widget[data-wstyle="light"] .mu :is(.mu-a,.mu-lbl,.mu-lbl.red){color:rgba(255,255,255,.78)}
.widget[data-wstyle="light"] .wc.solid.mu .brand{filter:brightness(0) invert(1) !important;opacity:1}
.widget[data-wstyle="light"] .mu-pill{background:rgba(255,255,255,.26)}
.widget[data-wstyle="light"] .mu-pill:hover{background:rgba(255,255,255,.36)}
.widget[data-wstyle="light"] .mu-art{box-shadow:0 2px 8px rgba(120,0,20,.28)}
.widget[data-wstyle="light"] .mu-empty{color:rgba(255,255,255,.75)}
.widget:is([data-wstyle="frosted"],[data-wstyle="dark"]) .mu-h,.widget:is([data-wstyle="frosted"],[data-wstyle="dark"]) .mu-lbl.red{color:rgba(255,255,255,.82)}
.widget:is([data-wstyle="frosted"],[data-wstyle="dark"]) .mu-a{color:rgba(255,255,255,.72)}
.widget:is([data-wstyle="frosted"],[data-wstyle="dark"]) .mu-cap{color:#fff}
.widget:is([data-wstyle="frosted"],[data-wstyle="dark"]) .mu .brand{filter:brightness(0) invert(1);opacity:1}
.widget[data-wstyle="frosted"] .mu-t,.widget[data-wstyle="frosted"] .mu-a,.widget[data-wstyle="frosted"] .mu-cap,.widget[data-wstyle="frosted"] .mu-h,.widget[data-wstyle="frosted"] .mu-lbl{text-shadow:0 1px 3px rgba(0,0,0,.32)}
.widget[data-wstyle="frosted"] .mu .brand{filter:brightness(0) invert(1) drop-shadow(0 1px 2px rgba(0,0,0,.35))}
.widget:is([data-wstyle="frosted"],[data-wstyle="dark"]) .wmount:has(.mu){filter:none}
`;
document.head.appendChild(css);

const icon = (s: number) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><defs><linearGradient id="mg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fb5c74"/><stop offset="1" stop-color="${RED}"/></linearGradient></defs><rect width="24" height="24" rx="5.6" fill="url(#mg)"/><image href="${MUSIC_WHITE}" x="6" y="4.4" width="12" height="15.2"/></svg>`;

export default defineWidgets([
  { id: 'music-s', family: 'Music', group: 'music-now', size: 'S', name: 'Now Playing', desc: 'What’s playing on your PC, with a play/pause button. Its colors follow the album cover.', icon, mount: music('now', 'S') },
  { id: 'music-m', family: 'Music', group: 'music-now', size: 'M', name: 'Now Playing', desc: 'What’s playing on your PC, with album art and play, pause and skip controls. The card takes its colors from the cover.', mount: music('now', 'M') },
  { id: 'music-recent-m', family: 'Music', group: 'music-recent', size: 'M', name: 'Recently Played', desc: 'The last two songs you listened to.', mount: music('recent', 'M', recentView(2, 40)) },
  { id: 'music-top-m', family: 'Music', group: 'music-top', size: 'M', name: 'Most Played', desc: 'The four songs you play the most, shown as album covers.', mount: music('top', 'M', topView(4, 4)) },
]);
