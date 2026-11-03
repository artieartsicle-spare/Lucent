import './tauri-bridge';
import './lockdown';
import { LiquidGlass } from './vendor/liquidglass/index.js';
import { loadUserWidgets, onUserWidgetsChanged } from './user-widgets';
import { WIDGETS, FAMILIES, SUGGESTED, widgetById, sizesInGroup, familyIcon, type WidgetDef, type WidgetSize, type WidgetCfg } from './widgets';
import { createConfigPanel } from './widget-config';
import { initDesktopIcons } from './desktop-icons';
import { createMenu, type MenuItem } from './context-menu';

type WallpaperInfo = { data: Uint8Array | null; style: number; tile: boolean; color: number[] };

declare global {
  interface Window {
    overlayAPI?: {
      setInteractive: (on: boolean) => void;
      setEditing: (on: boolean, light?: boolean) => void;
      openSettings?: (page: string) => void;
      openAppSettings?: () => void;
      setSetting?: (key: string, value: unknown) => void;
      desktopNewFolder?: () => Promise<{ ok: boolean; id?: string }>;
      desktopSetSize?: (px: number) => void;
      desktopRefresh?: () => void;
      desktopPaste?: () => void;
      desktopNativeMenu?: (x: number, y: number) => void;
      copyText: (t: string) => void;
      getWallpaper: () => Promise<WallpaperInfo | null>;
      onWallpaper: (cb: (info: WallpaperInfo) => void) => void;
      setTyping: (on: boolean) => void;
      onSystem: (cb: (s: any) => void) => void;
      getBatteries?: () => Promise<unknown>;
      bottomInset?: () => Promise<number>;
    };
    __toggleEdit?: () => void;
    __calibrate?: () => void;
    __setDeskMenu?: (on: boolean) => void;
    __iconCmd?: (cmd: string, arg?: string) => void;
    __setAppearance?: (mode: string) => void;
    __setWidgetStyle?: (id: string) => void;
    __setDockClear?: (px: number) => void;
    __setHighlight?: (pct: number) => void;
    __restyleAll?: (id: string) => void;
  }
}

const LOOK = {
  corner: 27,
  shadow: 0.2,
  springRate: 22,
  stretch: 0.2,
};
document.documentElement.style.setProperty('--shadow', String(LOOK.shadow));
const cornerOf = (p: { kind: string; corner: number }) => (p.kind === 'gallery' ? p.corner : LOOK.corner);

{
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  let mode = 'light';
  try {
    mode = localStorage.getItem('lucent-appearance') || 'light';
  } catch {
  }
  const apply = () => {
    document.documentElement.dataset.theme = mode === 'dark' || (mode === 'auto' && mq.matches) ? 'dark' : 'light';
  };
  mq.addEventListener('change', apply);
  window.__setAppearance = (m: string) => {
    mode = m === 'dark' || m === 'auto' ? m : 'light';
    try {
      localStorage.setItem('lucent-appearance', mode);
    } catch {
    }
    apply();
  };
  apply();
}

type Size = WidgetSize;
const CELL = 158;
const GAP = 22;
const span = (n: number) => n * CELL + (n - 1) * GAP;
const SIZES: Record<Size, { cw: number; ch: number; label: string; px: { w: number; h: number } }> = {
  S: { cw: 1, ch: 1, label: 'Small', px: { w: span(1), h: span(1) } },
  M: { cw: 2, ch: 1, label: 'Medium', px: { w: span(2), h: span(1) } },
  L: { cw: 2, ch: 2, label: 'Large', px: { w: span(2), h: span(2) } },
  XL: { cw: 4, ch: 2, label: 'Extra Large', px: { w: span(4), h: span(2) } },
  XXL: { cw: 4, ch: 4, label: '4 × 4', px: { w: span(4), h: span(4) } },
};
const PITCH = CELL + GAP;
type Margins = { left: number; right: number; top: number; bottom: number };
const LAYOUT_KEY = 'lucent-layout';
const W_DEF: Margins = { left: 24, right: 24, top: 40, bottom: 80 };
const I_DEF: Margins = { left: 14, right: 14, top: 14, bottom: 80 };
const LAY: Margins = { ...W_DEF };
const ILAY: Margins = { ...I_DEF };
const MIN_GAP = 12;
try {
  const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}');
  if (raw.w) Object.assign(LAY, raw.w);
  else if (typeof raw.side === 'number') Object.assign(LAY, { left: raw.side, right: raw.side, top: raw.top ?? LAY.top, bottom: raw.bottom ?? LAY.bottom });
  if (raw.i) Object.assign(ILAY, raw.i);
} catch {
}
const saveLayout = () => {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ w: LAY, i: ILAY }));
  } catch {
  }
};
const CORNER = 27;

type GlassStyle = { id: string; name: string; blur: number; bright: number; lib: boolean };
const STYLES: GlassStyle[] = [
  { id: 'regular', name: 'Dark', blur: 0, bright: 0, lib: true },
  { id: 'light', name: 'Light', blur: 0, bright: 0, lib: true },
  { id: 'frosted', name: 'Clear Light', blur: 0.5, bright: 0, lib: true },
  { id: 'dark', name: 'Clear Dark', blur: 0.4, bright: -0.3, lib: true },
];
const styleOf = (id: string) => STYLES.find((x) => x.id === id) ?? STYLES[0];
const LIB = { refraction: 0.69, zRadius: 40, chromAberration: 0.05, edgeHighlight: 0.05, specular: 0, fresnel: 1, saturation: 0, shadow: 0.3 };

type Kind = 'widget' | 'ghost' | 'gallery';
type Panel = {
  id: number;
  kind: Kind;
  app: string;
  size: Size;
  col: number;
  row: number;
  x: number; y: number; w: number; h: number;
  corner: number;
  style: string;
  cfg: WidgetCfg;
};
type Anim = { x: number; y: number; w: number; h: number; vx: number; vy: number };

const KEY = 'lucent-widgets-v2';

let W = window.innerWidth;
let H = window.innerHeight;
const POOL_SIZE = 24;
const uiLayer = document.getElementById('ui')!;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

let panels: Panel[] = [];
let nextId = 1;
const anims = new Map<number, Anim>();
const els = new Map<number, HTMLDivElement>();
let selectedId: number | null = null;
let editing = false;

let cols = 1;
let rows = 1;
let gx0 = 0;
let gy0 = 0;
let gapX = GAP;
let gapY = GAP;
function gridFor(m: Margins, w: number, h: number) {
  const fit = (avail: number) => {
    let n = Math.max(1, Math.round((avail + GAP) / PITCH));
    while (n > 1 && (avail - n * CELL) / (n - 1) < MIN_GAP) n--;
    return { n, gap: n > 1 ? (avail - n * CELL) / (n - 1) : 0 };
  };
  const a = fit(w - m.left - m.right);
  const b = fit(h - m.top - m.bottom);
  return { cols: a.n, rows: b.n, gapX: a.gap, gapY: b.gap, x0: m.left, y0: m.top };
}
function computeGrid() {
  const g = gridFor(LAY, W, H);
  cols = g.cols;
  rows = g.rows;
  gapX = g.gapX;
  gapY = g.gapY;
  gx0 = g.x0;
  gy0 = g.y0;
}
const cellX = (c: number) => gx0 + c * (CELL + gapX);
const cellY = (r: number) => gy0 + r * (CELL + gapY);
function cellPx(s: Size) {
  const d = SIZES[s];
  return { w: d.cw * CELL + (d.cw - 1) * gapX, h: d.ch * CELL + (d.ch - 1) * gapY };
}
function sizePx(s: Size) {
  return SIZES[s].px;
}
function place(p: Panel) {
  const { w, h } = cellPx(p.size);
  p.x = cellX(p.col);
  p.y = cellY(p.row);
  p.w = w;
  p.h = h;
}
const widgetsOnly = () => panels.filter((p) => p.kind === 'widget');
const fits = (s: Size) => SIZES[s].cw <= cols && SIZES[s].ch <= rows;

function findSlot(self: { id: number; size: Size }, fx: number, fy: number): { col: number; row: number } | null {
  const d = SIZES[self.size];
  const others = widgetsOnly().filter((p) => p.id !== self.id);
  let best: { col: number; row: number } | null = null;
  let bestDist = Infinity;
  for (let r = 0; r + d.ch <= rows; r++) {
    for (let c = 0; c + d.cw <= cols; c++) {
      const clash = others.some((o) => {
        const od = SIZES[o.size];
        return c < o.col + od.cw && c + d.cw > o.col && r < o.row + od.ch && r + d.ch > o.row;
      });
      if (clash) continue;
      const dist = (c - fx) ** 2 + (r - fy) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        best = { col: c, row: r };
      }
    }
  }
  return best;
}

function save() {
  try {
    const widgets = widgetsOnly().map((p) => ({ id: p.id, col: p.col, row: p.row, app: p.app, style: p.style, cfg: p.cfg }));
    localStorage.setItem(KEY, JSON.stringify({ widgets, nextId }));
  } catch {
  }
}
function load(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (!Array.isArray(d.widgets)) return false;
    panels = [];
    for (const s of d.widgets) {
      const def = s && widgetById(s.app);
      if (!def) continue;
      const p: Panel = {
        id: s.id, kind: 'widget', app: def.id, size: def.size, col: s.col | 0, row: s.row | 0,
        x: 0, y: 0, w: 0, h: 0, corner: CORNER, style: styleOf(s.style).id,
        cfg: s.cfg && typeof s.cfg === 'object' ? s.cfg : {},
      };
      const slot = findSlot(p, p.col, p.row);
      if (!slot) continue;
      p.col = slot.col;
      p.row = slot.row;
      place(p);
      panels.push(p);
    }
    nextId = Math.max(Number(d.nextId) || 1, ...panels.map((p) => p.id + 1), 1);
    return true;
  } catch {
    return false;
  }
}

let interactive = false;
let overUI = false;
let dragging = 0;
let deskCatch = true;
function refreshInteractive() {
  const want = dragging > 0 || overUI || deskCatch;
  if (want !== interactive) {
    interactive = want;
    window.overlayAPI?.setInteractive(want);
  }
}
document.addEventListener(
  'mousemove',
  (e) => {
    const t = e.target as HTMLElement | null;
    overUI = !!t?.closest?.('.widget, .badge, #gallery, #pop, .dicon, #ctx, .cmenu, #iprops, #calib, #wcfg, #wca') || !!widgetAt(e.clientX, e.clientY);
    refreshInteractive();
  },
  true
);

const panelsLayer = document.getElementById('panels')!;
const slotEl = document.getElementById('slot') as HTMLDivElement;
const galleryEl = document.getElementById('gallery') as HTMLDivElement;
const gsearch = document.getElementById('gsearch') as HTMLInputElement;
const gcats = document.getElementById('gcats')!;
const gtiles = document.getElementById('gtiles')!;
const doneBtn = document.getElementById('done') as HTMLButtonElement;
const popEl = document.getElementById('pop') as HTMLDivElement;

function updateSlot(p: Panel) {
  const s = findSlot(p, (p.x - gx0) / (CELL + gapX), (p.y - gy0) / (CELL + gapY));
  if (!s) {
    slotEl.style.display = 'none';
    return;
  }
  const { w, h } = cellPx(p.size);
  slotEl.style.display = 'block';
  slotEl.style.borderRadius = `${cornerOf(p)}px`;
  slotEl.style.left = `${cellX(s.col)}px`;
  slotEl.style.top = `${cellY(s.row)}px`;
  slotEl.style.width = `${w}px`;
  slotEl.style.height = `${h}px`;
}
const hideSlot = () => {
  slotEl.style.display = 'none';
};

function selected(): Panel | undefined {
  return panels.find((p) => p.id === selectedId && p.kind === 'widget');
}
function select(id: number | null) {
  selectedId = id;
  els.forEach((el, pid) => el.classList.toggle('selected', pid === id));
  showPop();
}
function removePanel(id: number) {
  const p = panels.find((q) => q.id === id);
  panels = panels.filter((q) => q.id !== id);
  releaseEl(id);
  anims.delete(id);
  applied.delete(id);
  if (selectedId === id) select(null);
  if (p?.kind === 'widget') save();
  overUI = false;
  refreshInteractive();
}

const cleanups = new WeakMap<HTMLElement, () => void>();
function undecorate(el: HTMLElement) {
  cleanups.get(el)?.();
  cleanups.delete(el);
  el.querySelector('.wmount')?.remove();
  el.querySelector('.wglint')?.remove();
}
const GLINT_STYLES = ['frosted', 'dark'];
function applyGlint(p: Panel, el: HTMLElement) {
  el.querySelector('.wglint')?.remove();
  el.classList.remove('glint-go');
  if (!GLINT_STYLES.includes(p.style)) return;
  const g = document.createElement('div');
  g.className = 'wglint';
  g.appendChild(document.createElement('i'));
  el.appendChild(g);
  void el.offsetWidth;
  el.classList.add('glint-go');
  window.setTimeout(() => el.classList.remove('glint-go'), 1400);
}
function decorate(p: Panel, el: HTMLElement) {
  undecorate(el);
  el.dataset.wstyle = p.style;
  const def = widgetById(p.app);
  if (!def) return;
  const c = document.createElement('div');
  c.className = 'wmount';
  el.appendChild(c);
  applyGlint(p, el);
  cleanups.set(el, def.mount(c, p.cfg));
}

const badgeEls = new Map<number, HTMLDivElement>();
const poolEls: HTMLDivElement[] = [];
const freeEls: HTMLDivElement[] = [];
function parkEl(el: HTMLDivElement) {
  el.style.left = '-400px';
  el.style.top = '-400px';
  el.style.width = '8px';
  el.style.height = '8px';
  el.classList.remove('selected', 'ghost', 'live');
  undecorate(el);
  delete el.dataset.pid;
  delete el.dataset.cfg;
}
function createPool() {
  for (let i = 0; i < POOL_SIZE; i++) {
    const el = document.createElement('div');
    el.className = 'widget';
    el.dataset.config = JSON.stringify({ cornerRadius: 8, zRadius: 4, shadowOpacity: 0 });
    el.addEventListener('pointerdown', (e) => {
      const pid = Number(el.dataset.pid);
      const pp = panels.find((q) => q.id === pid);
      if (pp) startWidgetDrag(pp, el, e);
    });
    parkEl(el);
    panelsLayer.appendChild(el);
    poolEls.push(el);
    freeEls.push(el);
  }
}

function makeWidgetEl(p: Panel) {
  const el = freeEls.pop() ?? document.createElement('div');
  if (!el.parentElement) {
    el.className = 'widget';
    el.addEventListener('pointerdown', (e) => startWidgetDrag(p, el, e));
    panelsLayer.appendChild(el);
  }
  el.dataset.pid = String(p.id);
  el.classList.toggle('ghost', p.kind !== 'widget');
  el.classList.add('live');
  decorate(p, el);
  els.set(p.id, el);
  return el;
}
function releaseEl(id: number) {
  const el = els.get(id);
  if (el) {
    parkEl(el);
    if (poolEls.includes(el)) freeEls.push(el);
    else el.remove();
  }
  els.delete(id);
  badgeEls.get(id)?.remove();
  badgeEls.delete(id);
}

function startWidgetDrag(p: Panel, el: HTMLElement, e: PointerEvent) {
  if (e.button !== 0 || !editing || p.kind !== 'widget') return;
  select(p.id);
  const a = anims.get(p.id)!;
  const offX = e.clientX - a.x;
  const offY = e.clientY - a.y;
  const sx = e.clientX;
  const sy = e.clientY;
  const orig = { col: p.col, row: p.row };
  let moved = false;
  el.setPointerCapture(e.pointerId);
  dragging++;
  refreshInteractive();

  const move = (ev: PointerEvent) => {
    if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
    if (!moved) {
      moved = true;
      hidePop();
    }
    p.x = clamp(ev.clientX - offX, -p.w + 60, W - 60);
    p.y = clamp(ev.clientY - offY, 0, H - 60);
    updateSlot(p);
  };
  const up = () => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    dragging = Math.max(0, dragging - 1);
    if (moved) {
      const s = findSlot(p, (p.x - gx0) / (CELL + gapX), (p.y - gy0) / (CELL + gapY));
      if (s) {
        p.col = s.col;
        p.row = s.row;
      } else {
        p.col = orig.col;
        p.row = orig.row;
      }
      place(p);
      hideSlot();
      save();
    }
    showPop();
    refreshInteractive();
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  e.preventDefault();
}

let lastStyle = 'regular';
function addWidget(app: string, col: number, row: number) {
  const def = widgetById(app);
  if (!def) return null;
  const p: Panel = {
    id: nextId++, kind: 'widget', app: def.id, size: def.size, col, row, x: 0, y: 0, w: 0, h: 0, corner: CORNER, style: lastStyle, cfg: {},
  };
  const slot = findSlot(p, col, row);
  if (!slot) return null;
  p.col = slot.col;
  p.row = slot.row;
  place(p);
  panels.push(p);
  makeWidgetEl(p);
  anims.set(p.id, { x: p.x, y: p.y, w: p.w, h: p.h, vx: 0, vy: 0 });
  return p;
}

let cat: string = 'all';
let query = '';

let dockAuto = 0;
let dockMin = 0;
let dockInset = 0;
const GALLERY_BLEED = 30;
function galleryGeom() {
  const gap = dockInset > 0 ? 10 : 0;
  const w = Math.round(Math.min(Math.max(W * 0.68, 780), 1240, W - 32));
  const h = Math.round(Math.min(Math.max(H * 0.56, 440), 680, H - 120 - dockInset - gap));
  return { x: Math.round((W - w) / 2), y: H - h - dockInset - gap, w, h };
}
function applyDockInset() {
  const n = Math.max(dockAuto, dockMin);
  if (n !== dockInset) {
    dockInset = n;
    if (editing) placeGalleryDom();
  }
}
let HL = 1;
window.__setHighlight = (pct: number) => {
  const p = Math.max(0, Math.min(150, Math.round(pct)));
  HL = Number.isFinite(p) ? p / 100 : 1;
  document.documentElement.style.setProperty('--hl', String(HL));
};
window.__setDockClear = (px: number) => {
  dockMin = Math.max(0, Math.min(300, Math.round(px) || 0));
  applyDockInset();
};
async function refreshDockInset() {
  try {
    dockAuto = Math.round((await window.overlayAPI?.bottomInset?.()) ?? 0);
    applyDockInset();
  } catch {
  }
}
function placeGalleryDom() {
  const g = galleryGeom();
  galleryEl.style.left = `${g.x}px`;
  galleryEl.style.top = `${g.y}px`;
  galleryEl.style.width = `${g.w}px`;
  galleryEl.style.height = `${g.h + (dockInset > 0 ? 0 : GALLERY_BLEED)}px`;
  galleryEl.style.setProperty('--gpx', `${-g.x}px`);
  galleryEl.style.setProperty('--gpy', `${-g.y}px`);
  galleryEl.style.setProperty('--gw', `${W}px`);
  galleryEl.style.setProperty('--gh', `${H}px`);
}

function renderCats() {
  gcats.innerHTML = '';
  const items = [{ id: 'all', label: 'All Widgets' }, ...FAMILIES.map((f) => ({ id: f, label: f }))];
  for (const it of items) {
    const d = document.createElement('div');
    d.className = 'cat' + (cat === it.id && !query ? ' active' : '');
    d.innerHTML = `<span class="ci">${familyIcon(it.id, 22)}</span><span>${it.label}</span>`;
    d.addEventListener('click', () => {
      cat = it.id;
      query = '';
      gsearch.value = '';
      renderCats();
      renderTiles();
      gtiles.scrollTop = 0;
    });
    gcats.appendChild(d);
  }
}

const previewStops: (() => void)[] = [];
const PV = 0.5;
function makeTile(def: WidgetDef, labelled: boolean): HTMLElement {
  const px = sizePx(def.size);
  const pw = Math.round(px.w * PV);
  const ph = Math.round(px.h * PV);
  const ok = fits(def.size);
  const tile = document.createElement('div');
  tile.className = 'tile' + (ok ? '' : ' nofit');
  tile.style.width = `${Math.max(pw, 150)}px`;
  tile.title = ok ? '' : "Doesn't fit on this screen";
  const wrap = document.createElement('div');
  wrap.className = 'pvwrap';
  const pv = document.createElement('div');
  pv.className = 'pv';
  pv.style.width = `${pw}px`;
  pv.style.height = `${ph}px`;
  pv.style.borderRadius = `${Math.round(CORNER * PV)}px`;
  const inner = document.createElement('div');
  inner.style.cssText = `position:absolute;left:0;top:0;width:${px.w}px;height:${px.h}px;transform:scale(${PV});transform-origin:0 0;`;
  const mount = document.createElement('div');
  mount.className = 'wmount';
  inner.appendChild(mount);
  pv.appendChild(inner);
  wrap.appendChild(pv);
  tile.appendChild(wrap);
  previewStops.push(def.mount(mount));
  if (labelled) {
    const tt = document.createElement('div');
    tt.className = 'tt';
    tt.textContent = def.name;
    tile.append(tt);
  }
  if (ok) tile.addEventListener('pointerdown', (e) => startTileDrag(def, pv, tile, e));
  return tile;
}
function section(title: string | null, defs: WidgetDef[], labelled: boolean) {
  const sec = document.createElement('div');
  sec.className = 'gsec';
  if (title) {
    const h = document.createElement('div');
    h.className = 'gsec-h';
    h.textContent = title;
    sec.appendChild(h);
  }
  const row = document.createElement('div');
  row.className = 'gsec-tiles';
  defs.forEach((d) => row.appendChild(makeTile(d, labelled)));
  sec.appendChild(row);
  gtiles.appendChild(sec);
}
function renderTiles() {
  previewStops.splice(0).forEach((f) => f());
  gtiles.innerHTML = '';
  const bySize = (a: WidgetDef, b: WidgetDef) => ['S', 'M', 'L', 'XL', 'XXL'].indexOf(a.size) - ['S', 'M', 'L', 'XL', 'XXL'].indexOf(b.size);
  if (query) {
    const hits = WIDGETS.filter((d) => `${d.name} ${d.desc} ${d.family}`.toLowerCase().includes(query));
    if (!hits.length) {
      gtiles.innerHTML = '<div class="gnone">No widgets found</div>';
      return;
    }
    section(null, hits, true);
  } else if (cat === 'all') {
    section('Suggestions', SUGGESTED.map((id) => widgetById(id)!).filter(Boolean), false);
    for (const f of FAMILIES) section(f, WIDGETS.filter((d) => d.family === f).sort(bySize), true);
  } else {
    section(null, WIDGETS.filter((d) => d.family === cat).sort(bySize), true);
  }
}

function startTileDrag(def: WidgetDef, pv: HTMLElement, tile: HTMLElement, e: PointerEvent) {
  if (e.button !== 0 || !editing) return;
  const r = pv.getBoundingClientRect();
  const size = def.size;
  const { w, h } = sizePx(size);
  const p: Panel = {
    id: nextId++, kind: 'ghost', app: def.id, size, col: 0, row: 0,
    x: e.clientX - w / 2, y: e.clientY - h / 2, w, h, corner: CORNER, style: lastStyle, cfg: {},
  };
  panels.push(p);
  makeWidgetEl(p);
  anims.set(p.id, { x: r.left, y: r.top, w: r.width, h: r.height, vx: 0, vy: 0 });
  tile.setPointerCapture(e.pointerId);
  dragging++;
  refreshInteractive();
  select(null);

  const move = (ev: PointerEvent) => {
    p.x = ev.clientX - w / 2;
    p.y = ev.clientY - h / 2;
    updateSlot(p);
  };
  const up = (ev: PointerEvent) => {
    tile.removeEventListener('pointermove', move);
    tile.removeEventListener('pointerup', up);
    tile.removeEventListener('pointercancel', up);
    dragging = Math.max(0, dragging - 1);
    const gr = galleryEl.getBoundingClientRect();
    const overGallery = ev.clientX >= gr.left && ev.clientX <= gr.right && ev.clientY >= gr.top && ev.clientY <= gr.bottom;
    const s = overGallery ? null : findSlot(p, (p.x - gx0) / (CELL + gapX), (p.y - gy0) / (CELL + gapY));
    if (s) {
      p.kind = 'widget';
      p.col = s.col;
      p.row = s.row;
      place(p);
      els.get(p.id)?.classList.remove('ghost');
      save();
      select(p.id);
    } else {
      removePanel(p.id);
    }
    hideSlot();
    refreshInteractive();
  };
  tile.addEventListener('pointermove', move);
  tile.addEventListener('pointerup', up);
  tile.addEventListener('pointercancel', up);
  e.preventDefault();
}

gsearch.addEventListener('input', () => {
  query = gsearch.value.trim().toLowerCase();
  renderCats();
  renderTiles();
  gtiles.scrollTop = 0;
});

function resizeTo(p: Panel, def: WidgetDef) {
  if (def.id === p.app) return;
  const slot = findSlot({ id: p.id, size: def.size }, p.col, p.row);
  if (!slot) return;
  p.app = def.id;
  p.size = def.size;
  p.col = slot.col;
  p.row = slot.row;
  place(p);
  const el = els.get(p.id);
  if (el) decorate(p, el);
  save();
  showPop();
}
function setStyle(p: Panel, id: string) {
  p.style = id;
  const wel = els.get(p.id);
  if (wel) {
    wel.dataset.wstyle = id;
    applyGlint(p, wel);
  }
  save();
}
const cfgPanel = createConfigPanel(uiLayer, (on) => window.overlayAPI?.setTyping(on));
function openConfig(p: Panel) {
  const def = widgetById(p.app);
  if (!def) return;
  cfgPanel.open({
    def, cfg: p.cfg, style: p.style, styles: STYLES.map((x) => ({ id: x.id, name: x.name })),
    onCfg: (cfg) => {
      p.cfg = cfg;
      save();
      const wel = els.get(p.id);
      if (wel) decorate(p, wel);
    },
    onStyle: (id) => setStyle(p, id),
  });
}
function syncPop() {
  const p = selected();
  if (!p) return;
  popEl.innerHTML = '';
  const row = (label: string, o: { on?: boolean; off?: boolean; hd?: boolean } = {}, fn?: () => void) => {
    const d = document.createElement('div');
    d.className = 'ci' + (o.hd ? ' hd' : '') + (o.on ? ' on' : '') + (o.off ? ' off' : '');
    d.textContent = label;
    if (fn && !o.off && !o.hd) d.addEventListener('click', fn);
    popEl.appendChild(d);
  };
  const sep = () => {
    const d = document.createElement('div');
    d.className = 'cs';
    popEl.appendChild(d);
  };
  const def = widgetById(p.app);
  const opts = def ? sizesInGroup(def.group) : [];
  row('Edit Widget\u2026', {}, () => openConfig(p));
  sep();
  if (opts.length > 1) {
    row('Size', { hd: true });
    for (const o of opts) {
      const can = o.id === p.app || !!findSlot({ id: p.id, size: o.size }, p.col, p.row);
      row(SIZES[o.size].label, { on: o.id === p.app, off: !can }, () => resizeTo(p, o));
    }
    sep();
  }
  row('Style', { hd: true });
  STYLES.forEach((st) =>
    row(st.name, { on: p.style === st.id }, () => {
      setStyle(p, st.id);
      syncPop();
    })
  );
  sep();
  row('Remove Widget', {}, () => {
    removePanel(p.id);
    hidePop();
  });
}
function showPop() {
  const p = selected();
  if (!p || !editing) {
    hidePop();
    return;
  }
  syncPop();
  popEl.classList.add('show');
  const pw = popEl.offsetWidth;
  const ph = popEl.offsetHeight;
  const left = clamp(p.x + p.w / 2 - pw / 2, 8, W - pw - 8);
  let top = p.y + p.h + 8;
  if (top + ph > H - 8) top = p.y - ph - 8;
  popEl.style.left = `${left}px`;
  popEl.style.top = `${Math.max(8, top)}px`;
}
function hidePop() {
  popEl.classList.remove('show');
}

const menu = createMenu(uiLayer);
const widgetAt = (x: number, y: number) =>
  [...widgetsOnly()].reverse().find((p) => x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h);

function showWidgetMenu(p: Panel, x: number, y: number) {
  const def = widgetById(p.app);
  const opts = def ? sizesInGroup(def.group) : [];
  const items: MenuItem[] = [
    { label: 'Edit Widget\u2026', fn: () => openConfig(p) },
    { label: 'Edit Widgets\u2026', fn: () => enterEdit() },
    { sep: true },
  ];
  if (opts.length > 1) {
    for (const o of opts) {
      const can = o.id === p.app || !!findSlot({ id: p.id, size: o.size }, p.col, p.row);
      items.push({ label: SIZES[o.size].label, checked: o.id === p.app, disabled: !can, fn: () => resizeTo(p, o) });
    }
    items.push({ sep: true });
  }
  items.push({ label: 'Style', sub: STYLES.map((st) => ({ label: st.name, checked: p.style === st.id, fn: () => setStyle(p, st.id) })) });
  items.push({ sep: true }, { label: 'Remove Widget', fn: () => removePanel(p.id) });
  menu.show(items, x, y);
}

function showDesktopMenu(x: number, y: number) {
  const api = window.overlayAPI;
  const cur = desktopIcons.sortMode();
  const modes: [string, 'name' | 'kind' | 'date'][] = [['Name', 'name'], ['Kind', 'kind'], ['Date Modified', 'date']];
  const sizes: [string, number][] = [['Small', 48], ['Medium', 64], ['Large', 80], ['Huge', 96]];
  const newFolder = async () => {
    const r = await api?.desktopNewFolder?.();
    if (r?.ok && r.id) desktopIcons.cmd('rename', r.id);
  };
  menu.show(
    [
      { label: 'New Folder', fn: () => void newFolder() },
      { label: 'Paste', fn: () => api?.desktopPaste?.() },
      { sep: true },
      { label: 'Change Wallpaper\u2026', fn: () => api?.openSettings?.('personalization-background') },
      { label: 'Edit Widgets\u2026', fn: () => enterEdit() },
      { sep: true },
      { label: 'Sort By', sub: modes.map(([label, m]) => ({ label, checked: cur === m, fn: () => desktopIcons.cmd('sort', m) })) },
      { label: 'Clean Up', fn: () => desktopIcons.cmd('snap') },
      { label: 'Clean Up By', sub: modes.map(([label, m]) => ({ label, fn: () => desktopIcons.cmd('cleanup', m) })) },
      {
        label: 'Show View Options',
        sub: [
          { label: 'Icon Size', hd: true },
          ...sizes.map(([label, px]): MenuItem => ({ label, checked: desktopIcons.size() === px, fn: () => api?.desktopSetSize?.(px) })),
          { sep: true },
          { label: 'Calibrate Layout\u2026', fn: () => window.__calibrate?.() },
        ],
      },
      { sep: true },
      { label: 'Refresh', fn: () => api?.desktopRefresh?.() },
      { label: 'Display Settings\u2026', fn: () => api?.openSettings?.('display') },
      { label: 'Lucent Settings\u2026', fn: () => api?.openAppSettings?.() },
      { label: 'Show Windows Desktop Icons', fn: () => api?.setSetting?.('desktopIcons', false) },
      { sep: true },
      { label: 'Show More Options (Windows Menu)', fn: () => api?.desktopNativeMenu?.(x, y) },
    ],
    x,
    y
  );
}

document.addEventListener('contextmenu', (e) => {
  const t = e.target as HTMLElement | null;
  if (t?.closest?.('.dicon, .cmenu, #iprops, #calib, #wcfg, #wca, #gallery, #pop, input, textarea, [contenteditable]')) return;
  e.preventDefault();
  if (editing || document.body.classList.contains('calibrating')) return;
  const w = widgetAt(e.clientX, e.clientY);
  if (w) showWidgetMenu(w, e.clientX, e.clientY);
  else showDesktopMenu(e.clientX, e.clientY);
});
document.addEventListener('pointerdown', (e) => {
  const t = e.target as HTMLElement | null;
  if (e.button === 0 && !t?.closest?.('.dicon, .cmenu, #iprops, #calib, #wcfg, #wca, #gallery, #pop, .widget, .badge')) desktopIcons.cmd('deselect');
});
const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
for (const ev of ['dragenter', 'dragover'] as const)
  document.addEventListener(ev, (e) => {
    e.preventDefault();
    if (hasFiles(e)) {
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      document.body.classList.add('dropping');
    }
  });
document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) document.body.classList.remove('dropping');
});
for (const ev of ['drop', 'dragend'] as const)
  document.addEventListener(ev, (e) => {
    e.preventDefault();
    document.body.classList.remove('dropping');
  });
window.__setDeskMenu = (on: boolean) => {
  deskCatch = !!on;
  refreshInteractive();
};

function enterEdit() {
  if (editing) return;
  editing = true;
  document.body.classList.add('editing');
  window.overlayAPI?.setEditing(true);
  void refreshDockInset();
  placeGalleryDom();
  renderCats();
  renderTiles();
}
function exitEdit() {
  if (!editing) return;
  editing = false;
  select(null);
  hidePop();
  hideSlot();
  document.body.classList.remove('editing');
  window.overlayAPI?.setEditing(false);
  overUI = false;
  refreshInteractive();
  save();
}
doneBtn.addEventListener('click', exitEdit);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') exitEdit();
});
window.__toggleEdit = () => (editing ? exitEdit() : enterEdit());

{
  const css = document.createElement('style');
  css.textContent = `
#calgrid{position:fixed;inset:0;pointer-events:none;z-index:4;opacity:0;transition:opacity .15s}
#calgrid.show{opacity:1}
#calgrid .ca{position:absolute;box-sizing:border-box;border:2px solid rgba(10,132,255,.9);background:rgba(10,132,255,.07);border-radius:6px}
#calgrid i{position:absolute;box-sizing:border-box;border:1.5px dashed rgba(255,255,255,.7);background:rgba(255,255,255,.07);border-radius:14px}
#calib{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:330px;box-sizing:border-box;padding:0 18px 16px;border-radius:16px;z-index:80;
  background:var(--fp-bg);color:var(--fp-fg);
  font:13px/1.3 "Inter",system-ui,sans-serif;box-shadow:0 0 0 .5px var(--fp-ring),var(--fp-sh);opacity:0;pointer-events:none;transition:opacity .15s}
#calib.show{opacity:1;pointer-events:auto}
#calib .cb-h{padding:14px 0 10px;font-weight:600;font-size:15px;cursor:move;user-select:none}
#calib .cb-s{font-size:12px;color:var(--fp-sub);margin:8px 0 2px}
#calib .cb-seg{display:flex;border-radius:7px;overflow:hidden;box-shadow:0 0 0 .5px var(--fp-ring)}
#calib .cb-seg button{flex:1;border:0;padding:5px 0;background:var(--fp-card);font:500 13px "Inter",system-ui,sans-serif;color:var(--fp-fg);cursor:default}
#calib .cb-seg button+button{border-left:.5px solid var(--fp-line)}
#calib .cb-seg button.on{background:#0a7cff;color:#fff}
#calib .cb-r{display:flex;align-items:center;gap:10px;margin-top:10px}
#calib .cb-r label{width:50px;flex:none}
#calib .cb-r output{width:46px;text-align:right;color:var(--fp-sub);font-variant-numeric:tabular-nums}
#calib input[type=range]{flex:1;min-width:0;accent-color:#0a7cff}
#calib .cb-b{display:flex;gap:8px;margin-top:16px}
#calib .cb-b span{flex:1}
#calib .cb-b button{font:500 13px "Inter",system-ui,sans-serif;padding:5px 12px;border-radius:7px;border:0;background:var(--fp-card);color:var(--fp-fg);box-shadow:0 0 0 .5px var(--fp-btn-bd),0 1px 1px rgba(0,0,0,.08);cursor:default}
#calib .cb-b button.pri{background:#0a7cff;color:#fff;box-shadow:none}
`;
  document.head.appendChild(css);
  const guide = document.createElement('div');
  guide.id = 'calgrid';
  uiLayer.appendChild(guide);
  const box = document.createElement('div');
  box.id = 'calib';
  uiLayer.appendChild(box);

  type Tab = 'w' | 'i';
  let tab: Tab = 'w';
  let raised = false;
  let draft: Margins = { ...LAY };
  const KEYS: [keyof Margins, string][] = [['left', 'Left'], ['right', 'Right'], ['top', 'Top'], ['bottom', 'Bottom']];
  const live = () => (tab === 'w' ? LAY : ILAY);
  const defaults = () => (tab === 'w' ? W_DEF : I_DEF);

  let raf = 0;
  const drawGuide = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const m = draft;
      let h = `<div class="ca" style="left:${m.left}px;top:${m.top}px;width:${Math.max(0, W - m.left - m.right)}px;height:${Math.max(0, H - m.top - m.bottom)}px"></div>`;
      if (tab === 'w') {
        const g = gridFor(m, W, H);
        for (let r = 0; r < g.rows; r++)
          for (let c = 0; c < g.cols; c++)
            h += `<i style="left:${g.x0 + c * (CELL + g.gapX)}px;top:${g.y0 + r * (CELL + g.gapY)}px;width:${CELL}px;height:${CELL}px"></i>`;
      } else {
        const cl = desktopIcons.cell();
        const nc = Math.max(1, Math.floor((W - m.left - m.right) / cl.w));
        const nr = Math.max(1, Math.floor((H - m.top - m.bottom) / cl.h));
        for (let c = 0; c < nc; c++)
          for (let r = 0; r < nr; r++)
            h += `<i style="left:${W - m.right - (c + 1) * cl.w}px;top:${m.top + r * cl.h}px;width:${cl.w}px;height:${cl.h}px;border-radius:8px"></i>`;
      }
      guide.innerHTML = h;
    });
  };

  const commit = () => {
    Object.assign(live(), draft);
    saveLayout();
    if (tab === 'w') {
      computeGrid();
      for (const p of widgetsOnly()) {
        const s = findSlot(p, p.col, p.row);
        if (s) {
          p.col = s.col;
          p.row = s.row;
        }
        place(p);
        const a = anims.get(p.id);
        if (a) Object.assign(a, { x: p.x, y: p.y, w: p.w, h: p.h, vx: 0, vy: 0 });
      }
      save();
      if (editing) placeGalleryDom();
    } else {
      desktopIcons.relayout();
    }
  };

  const render = () => {
    const row = ([k, label]: [keyof Margins, string]) => {
      const max = Math.round((k === 'left' || k === 'right' ? W : H) * 0.45);
      return `<div class="cb-r"><label>${label}</label><input type="range" min="0" max="${max}" step="1" data-k="${k}" value="${draft[k]}"><output>${draft[k]}px</output></div>`;
    };
    box.innerHTML = `<div class="cb-h">Calibrate layout</div>
      <div class="cb-seg"><button data-t="w" class="${tab === 'w' ? 'on' : ''}">Widgets</button><button data-t="i" class="${tab === 'i' ? 'on' : ''}">Desktop icons</button></div>
      <div class="cb-s">Each edge is independent. The blue box is the area ${tab === 'w' ? 'widgets' : 'icons'} may use.</div>
      ${KEYS.map(row).join('')}
      <div class="cb-b"><button data-x="reset">Reset</button><span></span><button class="pri" data-x="done">Done</button></div>`;
    box.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((inp) => {
      const k = inp.dataset.k as keyof Margins;
      inp.addEventListener('input', () => {
        const horiz = k === 'left' || k === 'right';
        const other = horiz ? (k === 'left' ? draft.right : draft.left) : k === 'top' ? draft.bottom : draft.top;
        const v = Math.min(Number(inp.value), (horiz ? W : H) - (horiz ? CELL : 120) - other);
        draft[k] = Math.max(0, v);
        inp.value = String(draft[k]);
        (inp.nextElementSibling as HTMLElement).textContent = `${draft[k]}px`;
        drawGuide();
      });
      inp.addEventListener('change', commit);
    });
    box.querySelectorAll<HTMLButtonElement>('[data-t]').forEach((b) =>
      b.addEventListener('click', () => {
        tab = b.dataset.t as Tab;
        draft = { ...live() };
        render();
        drawGuide();
      })
    );
    box.querySelector('[data-x=reset]')!.addEventListener('click', () => {
      draft = { ...defaults() };
      commit();
      render();
      drawGuide();
    });
    box.querySelector('[data-x=done]')!.addEventListener('click', () => closeCalib());
    const head = box.querySelector('.cb-h') as HTMLElement;
    head.addEventListener('pointerdown', (e) => {
      const r = box.getBoundingClientRect();
      const ox = e.clientX - r.left;
      const oy = e.clientY - r.top;
      head.setPointerCapture(e.pointerId);
      const mv = (m: PointerEvent) => {
        box.style.transform = 'none';
        box.style.left = `${clamp(m.clientX - ox, 0, W - r.width)}px`;
        box.style.top = `${clamp(m.clientY - oy, 0, H - r.height)}px`;
      };
      const up = () => {
        head.removeEventListener('pointermove', mv);
        head.removeEventListener('pointerup', up);
      };
      head.addEventListener('pointermove', mv);
      head.addEventListener('pointerup', up);
    });
  };

  function closeCalib() {
    box.classList.remove('show');
    guide.classList.remove('show');
    document.body.classList.remove('calibrating');
    bg.setAttribute('data-dynamic', '');
    glass?.markChanged();
    if (raised) {
      raised = false;
      if (!editing) window.overlayAPI?.setEditing(false);
    }
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && box.classList.contains('show')) closeCalib();
  });
  window.__calibrate = () => {
    if (!editing && !raised) {
      raised = true;
      window.overlayAPI?.setEditing(true, true);
    }
    document.body.classList.add('calibrating');
    bg.removeAttribute('data-dynamic');
    menu.close();
    tab = 'w';
    draft = { ...LAY };
    render();
    drawGuide();
    guide.classList.add('show');
    box.classList.add('show');
  };
}

window.addEventListener('resize', () => {
  W = window.innerWidth;
  H = window.innerHeight;
  computeGrid();
  widgetsOnly().forEach(place);
  if (editing) placeGalleryDom();
  desktopIcons.relayout();
});
computeGrid();
createPool();

const desktopIcons = initDesktopIcons({
  layer: document.getElementById('icons')!,
  ui: uiLayer,
  size: () => ({ w: W, h: H }),
  menu,
  margins: () => ILAY,
  beginDrag: () => {
    dragging++;
    refreshInteractive();
  },
  endDrag: () => {
    dragging = Math.max(0, dragging - 1);
    refreshInteractive();
  },
});
window.__iconCmd = (cmd: string, arg?: string) => desktopIcons.cmd(cmd, arg);
window.__setWidgetStyle = (id: string) => {
  lastStyle = styleOf(id).id;
};
window.__restyleAll = (id: string) => {
  const sid = styleOf(id).id;
  for (const p of widgetsOnly()) setStyle(p, sid);
};

await loadUserWidgets();
onUserWidgetsChanged(() => {
  for (const p of panels) {
    if (!p.app.startsWith('user:')) continue;
    const el = els.get(p.id);
    if (el) decorate(p, el);
  }
  renderCats();
  renderTiles();
});

if (!load()) {
  panels = [];
  nextId = 1;
  addWidget('cal-day', 0, 0);
  addWidget('wx-s', 1, 0);
  addWidget('clock', 0, 1);
  addWidget('battery', 1, 1);
  save();
  enterEdit();
} else {
  panels.forEach((p) => {
    makeWidgetEl(p);
    anims.set(p.id, { x: p.x, y: p.y, w: p.w, h: p.h, vx: 0, vy: 0 });
  });
}

const hiddenFill = { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', opacity: '0', pointerEvents: 'none' };
const bg = document.createElement('canvas');
bg.id = 'bgcanvas';
bg.setAttribute('data-dynamic', '');
Object.assign(bg.style, hiddenFill);
panelsLayer.insertBefore(bg, panelsLayer.firstChild);

const video = document.createElement('video');
video.muted = true;
video.playsInline = true;
video.id = 'bgvideo';
panelsLayer.insertBefore(video, bg.nextSibling);

let wpImage: ImageBitmap | null = null;
let wpInfo: WallpaperInfo | null = null;

let galleryBgUrl = '';
let galleryBgTimer = 0;
function buildGalleryBackdrop() {
  const sw = Math.max(1, Math.round(bg.width / 4));
  const sh = Math.max(1, Math.round(bg.height / 4));
  const m = 28;
  const tile = document.createElement('canvas');
  tile.width = sw + 2 * m;
  tile.height = sh + 2 * m;
  const t = tile.getContext('2d');
  const out = document.createElement('canvas');
  out.width = sw;
  out.height = sh;
  const o = out.getContext('2d');
  if (!t || !o) return;
  t.imageSmoothingQuality = 'high';
  for (let ix = -1; ix <= 1; ix++) {
    for (let iy = -1; iy <= 1; iy++) {
      const fx = ix !== 0;
      const fy = iy !== 0;
      t.save();
      t.translate(m + ix * sw + (fx ? sw : 0), m + iy * sh + (fy ? sh : 0));
      t.scale(fx ? -1 : 1, fy ? -1 : 1);
      t.drawImage(bg, 0, 0, sw, sh);
      t.restore();
    }
  }
  o.filter = 'blur(14px) saturate(1.25) brightness(0.8)';
  o.drawImage(tile, -m, -m);
  out.toBlob(
    (blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      galleryEl.style.setProperty('--gwp', `url("${url}")`);
      document.documentElement.style.setProperty('--gwp', `url("${url}")`);
      if (galleryBgUrl) URL.revokeObjectURL(galleryBgUrl);
      galleryBgUrl = url;
    },
    'image/jpeg',
    0.88
  );
}

function drawWallpaper() {
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(1, Math.round(window.innerWidth * dpr));
  const H = Math.max(1, Math.round(window.innerHeight * dpr));
  if (bg.width !== W) bg.width = W;
  if (bg.height !== H) bg.height = H;
  const ctx = bg.getContext('2d');
  if (!ctx) return;
  const c = wpInfo?.color ?? [0, 0, 0];
  ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
  ctx.fillRect(0, 0, W, H);
  if (!wpImage || !wpInfo) return;
  const iw = wpImage.width;
  const ih = wpImage.height;
  ctx.imageSmoothingQuality = 'high';
  const { style, tile } = wpInfo;
  if (style === 0 && tile) {
    for (let y = 0; y < H; y += ih) for (let x = 0; x < W; x += iw) ctx.drawImage(wpImage, x, y);
  } else if (style === 0) {
    ctx.drawImage(wpImage, Math.round((W - iw) / 2), Math.round((H - ih) / 2));
  } else if (style === 2) {
    ctx.drawImage(wpImage, 0, 0, W, H);
  } else if (style === 6) {
    const k = Math.min(W / iw, H / ih);
    ctx.drawImage(wpImage, (W - iw * k) / 2, (H - ih * k) / 2, iw * k, ih * k);
  } else {
    const k = Math.max(W / iw, H / ih);
    ctx.drawImage(wpImage, (W - iw * k) / 2, (H - ih * k) / 2, iw * k, ih * k);
  }
}

const scheduleGalleryBackdrop = () => {
  clearTimeout(galleryBgTimer);
  galleryBgTimer = window.setTimeout(buildGalleryBackdrop, 250);
};

async function applyWallpaper(info: WallpaperInfo | null) {
  if (!info) return;
  wpInfo = info;
  let next: ImageBitmap | null = null;
  if (info.data && info.data.byteLength > 0) {
    try {
      next = await createImageBitmap(new Blob([info.data as BlobPart]));
    } catch (err) {
      console.error('Wallpaper decode failed:', err);
    }
  }
  wpImage?.close();
  wpImage = next;
  drawWallpaper();
  scheduleGalleryBackdrop();
}

drawWallpaper();
scheduleGalleryBackdrop();
window.addEventListener('resize', () => {
  drawWallpaper();
  scheduleGalleryBackdrop();
});
window.overlayAPI?.onWallpaper((info) => void applyWallpaper(info));
void window.overlayAPI?.getWallpaper().then((info) => applyWallpaper(info));

let glass: LiquidGlass | null = null;
LiquidGlass.init({ root: panelsLayer, glassElements: poolEls })
  .then((g) => {
    glass = g;
    (window as any).__glass = g;
  })
  .catch((err) => console.error('LiquidGlass init failed:', err));

const applied = new Map<number, string>();
let last = performance.now();

function glassConfig(p: Panel, corner: number) {
  const st = styleOf(p.style);
  const g = LIB;
  return JSON.stringify({
    floating: false,
    cornerRadius: corner,
    zRadius: g.zRadius,
    refraction: g.refraction,
    chromAberration: g.chromAberration,
    edgeHighlight: g.edgeHighlight * HL,
    specular: g.specular,
    fresnel: g.fresnel,
    saturation: g.saturation,
    blurAmount: st.blur,
    brightness: st.bright,
    shadowOpacity: g.shadow,
  });
}

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(Math.max((now - last) / 1000, 0.001), 0.05);
  last = now;

  const k = 1 - Math.exp(-dt * LOOK.springRate);
  for (const p of panels) {
    const a = anims.get(p.id);
    if (!a) continue;
    const ox = a.x;
    const oy = a.y;
    a.x += (p.x - a.x) * k;
    a.y += (p.y - a.y) * k;
    a.w += (p.w - a.w) * k;
    a.h += (p.h - a.h) * k;
    a.vx = (a.x - ox) / dt;
    a.vy = (a.y - oy) / dt;

    const el = els.get(p.id);
    if (!el) continue;
    const sf = Math.min(1, 420 / Math.max(a.w, a.h));
    const sx = 1 + Math.min(Math.abs(a.vx) / 1800, 1) * LOOK.stretch * sf;
    const sy = 1 + Math.min(Math.abs(a.vy) / 1800, 1) * LOOK.stretch * sf;
    const w = a.w * sx;
    const h = a.h * sy;
    const x = a.x + a.w / 2 - w / 2;
    const y = a.y + a.h / 2 - h / 2;
    const corner = Math.min(cornerOf(p), Math.min(w, h) / 2);
    const cfg = glassConfig(p, corner);
    const css = `${x.toFixed(2)}|${y.toFixed(2)}|${w.toFixed(2)}|${h.toFixed(2)}`;
    if (applied.get(p.id) !== css) {
      applied.set(p.id, css);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      el.style.borderRadius = `${corner}px`;
    }
    if (el.dataset.cfg !== cfg) {
      el.dataset.cfg = cfg;
      el.dataset.config = cfg;
    }
    el.style.borderRadius = `${corner}px`;

    let b = badgeEls.get(p.id);
    if (p.kind === 'widget' && editing) {
      if (!b) {
        b = document.createElement('div');
        b.className = 'badge';
        b.addEventListener('pointerdown', (e) => e.stopPropagation());
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          removePanel(p.id);
        });
        uiLayer.appendChild(b);
        badgeEls.set(p.id, b);
      }
      b.style.left = `${a.x - 9}px`;
      b.style.top = `${a.y - 9}px`;
      b.style.display = 'flex';
    } else if (b) {
      b.style.display = 'none';
    }
  }
}
requestAnimationFrame(frame);
void glass;
