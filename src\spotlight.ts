import './lockdown';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { LiquidGlass } from './vendor/liquidglass/index.js';
import './fonts.css';
import './spotlight.css';

type Mode = 'apps' | 'files' | 'actions' | 'clip';
type Hit = { name: string; path: string; dir: boolean; mtime: number; kind: 'app' | 'file' };
type Clip = { text: string; at: number };
type Item = {
  kind: 'app' | 'file' | 'action' | 'clip' | 'calc' | 'web' | 'filter';
  title: string;
  sub?: string;
  right?: string;
  path?: string;
  key?: string;
  glyph?: string;
  color?: string;
  sec?: string;
  run: () => void;
  alt?: () => void;
};

const call = <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  const hook = (window as unknown as { __spotCall?: (c: string, a?: Record<string, unknown>) => Promise<unknown> }).__spotCall;
  return (hook ? hook(cmd, args) : invoke(cmd, args)) as Promise<T>;
};

const svg = (inner: string, s = 22, sw = 1.7) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const G = {
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  sleep: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  display: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8 20h8M12 16.5V20"/>',
  wifi: '<path d="M3.5 9.5a12 12 0 0 1 17 0M6.5 12.8a8 8 0 0 1 11 0M9.4 16a4 4 0 0 1 5.2 0"/><circle cx="12" cy="19" r="1"/>',
  bluetooth: '<path d="M7 7l10 10-5 4V3l5 4L7 17"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/>',
  cpu: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/><path d="M9.5 3.5v3M14.5 3.5v3M9.5 17.5v3M14.5 17.5v3M3.5 9.5h3M3.5 14.5h3M17.5 9.5h3M17.5 14.5h3"/>',
  calc: '<rect x="5" y="3.5" width="14" height="17" rx="2.5"/><path d="M8.5 8h7M8.5 12h1.5M12 12h1.5M8.5 16h1.5M12 16h1.5"/>',
  snip: '<path d="M6 3.5v14.5h14.5M3.5 6H18v14.5"/>',
  terminal: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="m7.5 10 3 2.5-3 2.5M12.5 15.5h4"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12.5h9.4L17.5 7"/>',
  widgets: '<rect x="4" y="4" width="7" height="7" rx="1.8"/><rect x="13" y="4" width="7" height="7" rx="1.8"/><rect x="4" y="13" width="7" height="7" rx="1.8"/><rect x="13" y="13" width="7" height="7" rx="1.8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2H10l2 2.5h6.5a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z"/>',
  power: '<path d="M12 3.5v8M7 6.5a7.5 7.5 0 1 0 10 0"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.4"/><path d="m15.4 15.4 5 5"/>',
  appstore: '<path d="M12 4 5 19M12 4l7 15M8 14.5h8"/>',
  layers: '<path d="m12 4 8.5 4.5L12 13 3.5 8.5Z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5"/>',
  clip: '<rect x="6" y="5" width="12" height="15.5" rx="2.5"/><path d="M9.5 5V4h5v1M9.5 10h5M9.5 13.5h5"/>',
  doc: '<path d="M7 3.5h6.5L18 8v12.5H7Z"/><path d="M13.5 3.5V8H18"/>',
};

const MODES: { id: Mode; name: string; glyph: string; key: string; color: string }[] = [
  { id: 'apps', name: 'Applications', glyph: G.appstore, key: '1', color: '#0a84ff' },
  { id: 'files', name: 'Files', glyph: G.folder, key: '2', color: '#4aa3ff' },
  { id: 'actions', name: 'Actions', glyph: G.layers, key: '3', color: '#7d5cf0' },
  { id: 'clip', name: 'Clipboard', glyph: G.clip, key: '4', color: '#8e8e93' },
];

type Action = { id: string; name: string; words: string; glyph: string; color: string };
const ACTIONS: Action[] = [
  { id: 'lock', name: 'Lock Screen', words: 'lock screen sign out', glyph: G.lock, color: '#636366' },
  { id: 'sleep', name: 'Sleep', words: 'sleep suspend standby', glyph: G.sleep, color: '#5e5ce6' },
  { id: 'app-settings', name: 'Lucent Settings', words: 'lucent settings preferences appearance widgets icons accent', glyph: G.gear, color: '#8e8e93' },
  { id: 'settings', name: 'Open Settings', words: 'settings preferences control panel', glyph: G.gear, color: '#8e8e93' },
  { id: 'display', name: 'Display Settings', words: 'display screen resolution brightness monitor', glyph: G.display, color: '#0a84ff' },
  { id: 'wifi', name: 'Wi-Fi Settings', words: 'wifi wi-fi network internet wireless', glyph: G.wifi, color: '#0a84ff' },
  { id: 'bluetooth', name: 'Bluetooth Settings', words: 'bluetooth devices pair', glyph: G.bluetooth, color: '#0a84ff' },
  { id: 'sound', name: 'Sound Settings', words: 'sound audio volume speaker', glyph: G.sound, color: '#ff453a' },
  { id: 'wallpaper', name: 'Change Wallpaper', words: 'wallpaper background desktop personalization', glyph: G.image, color: '#30b0c7' },
  { id: 'taskmgr', name: 'Task Manager', words: 'task manager processes performance activity monitor', glyph: G.cpu, color: '#30d158' },
  { id: 'calc', name: 'Calculator', words: 'calculator calc math', glyph: G.calc, color: '#ff9f0a' },
  { id: 'snip', name: 'Screenshot', words: 'screenshot snip capture screen clip', glyph: G.snip, color: '#bf5af2' },
  { id: 'terminal', name: 'Open Terminal', words: 'terminal command prompt shell powershell', glyph: G.terminal, color: '#1c1c1e' },
  { id: 'recycle', name: 'Empty Recycle Bin', words: 'empty recycle bin trash delete', glyph: G.trash, color: '#8e8e93' },
  { id: 'edit-widgets', name: 'Edit Widgets', words: 'edit widgets add widget desktop', glyph: G.widgets, color: '#34c759' },
  { id: 'new-widget', name: 'New Widget from Template', words: 'new widget create template', glyph: G.plus, color: '#34c759' },
  { id: 'widgets-folder', name: 'Open My Widgets Folder', words: 'widgets folder open my', glyph: G.folder, color: '#34c759' },
  { id: 'quit', name: 'Quit Lucent', words: 'quit exit close lucent widgets', glyph: G.power, color: '#ff453a' },
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $('stage');
const box = $('box');
const input = $<HTMLInputElement>('q');
const chip = $('chip');
const body = $('body');
const content = $('content');
const indexbar = $('indexbar');
const idxlbl = $('idxlbl');

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
    }
  },
};
const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, '');
const extOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.toUpperCase() : '');
const ago = (t: number) => {
  const s = Math.max(0, Date.now() / 1000 - t);
  return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
};
const hue = (s: string) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
};

function calc(src: string): number | null {
  const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/,/g, '').toLowerCase().trim();
  if (!/^[0-9a-z+\-*/^().%\s]+$/.test(s) || !/[0-9]/.test(s)) return null;
  if (!/[+\-*/^%]|\b(sqrt|sin|cos|tan|log|ln|abs|round|floor|ceil)\b/.test(s.replace(/^-/, ''))) return null;
  let i = 0;
  const peek = () => {
    while (s[i] === ' ') i++;
    return s[i];
  };
  const FN: Record<string, (x: number) => number> = {
    sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log10, ln: Math.log, abs: Math.abs,
    round: Math.round, floor: Math.floor, ceil: Math.ceil,
  };
  const expr = (): number => {
    let v = term();
    for (;;) {
      const c = peek();
      if (c === '+') (i++, (v += term()));
      else if (c === '-') (i++, (v -= term()));
      else return v;
    }
  };
  const term = (): number => {
    let v = pow();
    for (;;) {
      const c = peek();
      if (c === '*') (i++, (v *= pow()));
      else if (c === '/') (i++, (v /= pow()));
      else if (c === '%') (i++, (v %= pow()));
      else return v;
    }
  };
  const pow = (): number => {
    const b = unary();
    if (peek() === '^') {
      i++;
      return Math.pow(b, pow());
    }
    return b;
  };
  const unary = (): number => {
    const c = peek();
    if (c === '-') return i++, -unary();
    if (c === '+') return i++, unary();
    return prim();
  };
  const prim = (): number => {
    const c = peek();
    if (c === '(') {
      i++;
      const v = expr();
      if (peek() !== ')') throw new Error('paren');
      i++;
      return v;
    }
    const num = /^\d*\.?\d+(e[+-]?\d+)?/.exec(s.slice(i));
    if (num) return (i += num[0].length), parseFloat(num[0]);
    const id = /^[a-z]+/.exec(s.slice(i));
    if (id) {
      i += id[0].length;
      if (id[0] === 'pi') return Math.PI;
      if (id[0] === 'e') return Math.E;
      const f = FN[id[0]];
      if (f && peek() === '(') {
        i++;
        const v = expr();
        if (peek() !== ')') throw new Error('paren');
        i++;
        return f(v);
      }
    }
    throw new Error('syntax');
  };
  try {
    const v = expr();
    peek();
    return i >= s.length && isFinite(v) ? v : null;
  } catch {
    return null;
  }
}
const fmtNum = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-US') : String(parseFloat(n.toPrecision(12))));

let filter: Mode | null = null;
let items: Item[] = [];
let sel = 0;
let cols = 1;
let seq = 0;
let indexing = false;
let indexCount = 0;
let introOn = false;
let history: string[] = [];
let histPos = -1;
try {
  history = JSON.parse(store.get('lg-spot-hist') || '[]');
} catch {
  history = [];
}
const remember = (q: string) => {
  q = q.trim();
  if (!q) return;
  history = [q, ...history.filter((h) => h !== q)].slice(0, 30);
  store.set('lg-spot-hist', JSON.stringify(history));
};

const iconCache = new Map<string, string>();
const queue = new Set<string>();
let flushTimer = 0;
const paintIcons = () => {
  content.querySelectorAll<HTMLElement>('.ic[data-p]').forEach((el) => {
    const u = custom.get(el.dataset.p!) ?? iconCache.get(el.dataset.p!);
    const img = el.querySelector('img');
    if (u && !img) el.innerHTML = `<img src="${u}" alt="" draggable="false">`;
    else if (u && img && img.getAttribute('src') !== u) img.setAttribute('src', u);
  });
};
const flush = async () => {
  flushTimer = 0;
  const paths = [...queue].slice(0, 40);
  paths.forEach((p) => queue.delete(p));
  if (!paths.length) return;
  try {
    const got = await call<Record<string, string>>('spotlight_icons', { paths });
    Object.entries(got).forEach(([p, u]) => iconCache.set(p, u));
    paintIcons();
  } catch {
  }
  if (queue.size) flushTimer = window.setTimeout(flush, 30);
};
const want = (p: string) => {
  if (iconCache.has(p)) return;
  queue.add(p);
  if (!flushTimer) flushTimer = window.setTimeout(flush, 60);
};
const seen = new IntersectionObserver(
  (es) => es.forEach((e) => e.isIntersecting && e.target instanceof HTMLElement && e.target.dataset.p && want(e.target.dataset.p)),
  { root: content, rootMargin: '120px' }
);

const custom = new Map<string, string>();
async function loadCustom() {
  try {
    const got = await call<Record<string, string>>('spotlight_custom_icons');
    custom.clear();
    Object.entries(got).forEach(([k, u]) => custom.set(k, u));
  } catch {
  }
  render();
  paintIcons();
}

const tile = (glyph: string, color: string) => `<div class="tile" style="background:${color}">${svg(glyph, 18, 1.8)}</div>`;
const letterTile = (name: string) => {
  const color = `hsl(${hue(name)} 55% 52%)`, ch = (name[0] || '?').toUpperCase();
  return `<div class="tile" style="background:${color}">${esc(ch)}</div>`;
};
const fileTile = (dir: boolean) => tile(dir ? G.folder : G.doc, dir ? '#4aa3ff' : '#8e9aae');

const fromHit = (h: Hit, sec: string): Item => ({
  kind: h.kind,
  title: h.name,
  sub: h.kind === 'app' ? '' : dirOf(h.path),
  right: h.kind === 'app' ? 'Application' : h.dir ? 'Folder' : extOf(h.name) || 'File',
  path: h.path,
  key: h.path,
  sec,
  run: () => void call('spotlight_open', { path: h.path, reveal: false }),
  alt: h.kind === 'file' || h.path.indexOf('shell:') !== 0 ? () => void call('spotlight_open', { path: h.path, reveal: true }) : undefined,
});
const fromAction = (a: Action, sec: string): Item => ({
  kind: 'action', title: a.name, right: 'Action', glyph: a.glyph, color: a.color, key: `action:${a.id}`, sec, run: () => void call('spotlight_action', { id: a.id }),
});
const fromClip = (c: Clip, sec: string): Item => ({
  kind: 'clip', title: c.text.trim(), right: ago(c.at), glyph: G.clip, color: '#8e8e93', sec, run: () => void call('spotlight_copy', { text: c.text }),
});

const iconHtml = (it: Item) => {
  const mine = it.key ? custom.get(it.key) : undefined;
  if (it.path) {
    const c = mine ?? iconCache.get(it.path);
    const fb = it.kind === 'app' ? letterTile(it.title) : fileTile(it.right === 'Folder');
    return `<div class="ic" data-p="${esc(it.path)}">${c ? `<img src="${c}" alt="" draggable="false">` : fb}</div>`;
  }
  if (mine) return `<div class="ic"><div class="tile styled"><img src="${mine}" alt="" draggable="false"></div></div>`;
  return `<div class="ic">${tile(it.glyph || G.search, it.color || '#8e8e93')}</div>`;
};

function render() {
  const q = input.value;
  const open = introOn || !!filter || q.length > 0;
  stage.classList.toggle('open', open);
  body.hidden = !open;
  indexbar.hidden = !(introOn || (open && indexing && items.length === 0 && q.length > 0));
  idxlbl.textContent = indexing ? (indexCount ? `Indexing… ${indexCount.toLocaleString('en-US')}` : 'Indexing…') : 'Index ready';
  if (filter) {
    const m = MODES.find((x) => x.id === filter)!;
    chip.hidden = false;
    chip.innerHTML = `${svg(m.glyph, 15, 1.9)}${m.name}`;
  } else chip.hidden = true;
  input.placeholder = filter ? `Search ${MODES.find((x) => x.id === filter)!.name}` : 'Spotlight Search';

  observerReset();
  if (introOn && !q && !filter) {
    content.innerHTML = tipsHtml();
    cols = 1;
    return;
  }
  const grid = filter === 'apps' && !q;
  cols = grid ? 6 : 1;
  if (!items.length) {
    content.innerHTML = q || filter ? `<div class="empty">${filter === 'clip' && !q ? 'Nothing copied yet' : `No results${q ? ` for “${esc(q)}”` : ''}`}</div>` : '';
    return;
  }
  if (sel >= items.length) sel = items.length - 1;
  let html = '';
  let last = '';
  if (grid) html += '<div class="grid">';
  items.forEach((it, i) => {
    if (!grid && it.sec && it.sec !== last) html += `<div class="sec">${esc(it.sec)}</div>`;
    last = it.sec || last;
    if (grid) {
      html += `<div class="cell${i === sel ? ' sel' : ''}" data-i="${i}">${iconHtml(it)}<div class="t">${esc(it.title)}</div></div>`;
    } else {
      html += `<div class="item ${it.kind}${i === sel ? ' sel' : ''}" data-i="${i}">${iconHtml(it)}<div class="tx"><div class="t">${esc(it.title)}</div>${it.sub ? `<div class="s">${esc(it.sub)}</div>` : ''}</div>${it.right ? `<div class="r">${esc(it.right)}</div>` : ''}</div>`;
    }
  });
  if (grid) html += '</div>';
  if (indexing && !grid) html += `<div class="foot">Still indexing… more results may appear</div>`;
  if (filter === 'clip' && items.length) html += `<div class="foot"><button id="clearclip">Clear clipboard history</button></div>`;
  content.innerHTML = html;
  content.querySelectorAll<HTMLElement>('.ic[data-p]').forEach((el) => seen.observe(el));
  const cur = content.querySelector<HTMLElement>('.sel');
  cur?.scrollIntoView({ block: 'nearest' });
}
function observerReset() {
  seen.disconnect();
}

function tipsHtml() {
  const kb = (a: string, b: string) => `<span><kbd>Ctrl</kbd><kbd>${a}</kbd> ${b}</span>`;
  return `<div class="tips">
    <div class="tip"><div class="ti" style="background:#0a84ff;color:#fff">${svg(G.search, 26, 1.9)}</div><div>
      <h4>Search History and Filtering</h4>
      <div class="kb"><span><kbd>↑</kbd> for search history</span><span><kbd>/</kbd> to filter your search</span></div></div></div>
    <div class="tip"><div class="ti" style="background:#fff;color:#0a84ff">${svg(G.widgets, 26, 1.7)}</div><div>
      <h4>Browse Modes</h4>
      <div class="kb">${kb('1', 'for Applications')}${kb('2', 'for Files')}${kb('3', 'for Actions')}${kb('4', 'for Clipboard')}</div></div></div>
    <div class="tip"><div class="ti" style="background:#5e5ce6;color:#fff">${svg(G.layers, 26, 1.7)}</div><div>
      <h4>Actions and Quick Math</h4><p>Lock, sleep, open Settings, or type a sum like 18 × 42.</p></div></div>
    </div>
    <div class="privacy">Spotlight indexes your Start menu and personal folders on this PC. Nothing leaves it except web searches you choose to run.</div>`;
}

const ACTION_CAP = 3;
const matchActions = (q: string) => {
  const t = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!t.length) return ACTIONS;
  return ACTIONS.filter((a) => t.every((w) => a.name.toLowerCase().includes(w) || a.words.includes(w)));
};

async function update() {
  const my = ++seq;
  const q = input.value;
  const trimmed = q.trim();
  let out: Item[] = [];
  try {
    if (q.startsWith('/') && !filter) {
      const t = q.slice(1).toLowerCase();
      out = MODES.filter((m) => m.name.toLowerCase().startsWith(t) || m.id.startsWith(t)).map((m) => ({
        kind: 'filter', title: m.name, right: `Ctrl+${m.key}`, glyph: m.glyph, color: m.color, sec: 'Filter by',
        run: () => setFilter(m.id),
      }));
    } else if (filter === 'actions') {
      out = matchActions(trimmed).map((a) => fromAction(a, ''));
    } else if (filter === 'clip') {
      const list = await call<Clip[]>('spotlight_clip_list');
      const t = trimmed.toLowerCase();
      out = list.filter((c) => !t || c.text.toLowerCase().includes(t)).map((c) => fromClip(c, ''));
    } else if (filter === 'apps' || filter === 'files') {
      const hits = trimmed
        ? (await call<{ apps: Hit[]; files: Hit[] }>('spotlight_search', { query: trimmed, filter }))[filter]
        : await call<Hit[]>('spotlight_browse', { mode: filter });
      out = hits.map((h) => fromHit(h, ''));
    } else if (trimmed) {
      const r = await call<{ apps: Hit[]; files: Hit[] }>('spotlight_search', { query: trimmed, filter: null });
      const v = calc(trimmed);
      if (v !== null) {
        const txt = fmtNum(v);
        out.push({ kind: 'calc', title: txt, sub: `${trimmed} =`, right: 'Calculator', glyph: G.calc, color: '#ff9f0a', sec: 'Calculator', run: () => void call('spotlight_copy', { text: String(v) }) });
      }
      out.push(...r.apps.map((h, i) => fromHit(h, i === 0 ? 'Applications' : '')));
      const acts = matchActions(trimmed).slice(0, ACTION_CAP);
      out.push(...acts.map((a, i) => fromAction(a, i === 0 ? 'Actions' : '')));
      out.push(...r.files.map((h, i) => fromHit(h, i === 0 ? 'Files' : '')));
      out.push({
        kind: 'web', title: `Search the web for “${trimmed}”`, right: 'Web', glyph: G.search, color: '#0a84ff', sec: 'Web',
        run: () => void call('open_url', { url: `https://www.google.com/search?q=${encodeURIComponent(trimmed)}` }).then(() => call('spotlight_hide')),
      });
    }
  } catch (e) {
    console.warn('[spotlight] search failed', e);
  }
  if (my !== seq) return;
  items = out;
  sel = 0;
  render();
  out.slice(0, 24).forEach((it) => it.path && want(it.path));
}

function setFilter(m: Mode | null) {
  filter = filter === m ? null : m;
  input.value = '';
  introOn = false;
  histPos = -1;
  void update();
  render();
  input.focus();
}

input.addEventListener('input', () => {
  introOn = false;
  histPos = -1;
  void update();
  render();
});

function move(d: number) {
  if (!items.length) return;
  sel = Math.max(0, Math.min(items.length - 1, sel + d));
  content.querySelectorAll('.sel').forEach((e) => e.classList.remove('sel'));
  const el = content.querySelector<HTMLElement>(`[data-i="${sel}"]`);
  el?.classList.add('sel');
  el?.scrollIntoView({ block: 'nearest' });
}
function activate(i: number, alt = false) {
  const it = items[i];
  if (!it) return;
  if (it.kind === 'app' || it.kind === 'file' || it.kind === 'web') remember(input.value);
  (alt && it.alt ? it.alt : it.run)();
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    if (menuEl) { closeMenu(); return; }
    if (input.value) {
      input.value = '';
      void update();
      render();
    } else if (filter) setFilter(null);
    else if (introOn) {
      introOn = false;
      render();
    } else void call('spotlight_hide');
    return;
  }
  if (e.ctrlKey && /^[1-4]$/.test(e.key)) {
    e.preventDefault();
    setFilter(MODES[Number(e.key) - 1].id);
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    move(cols);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (!input.value && !filter && history.length && !items.length) {
      histPos = Math.min(history.length - 1, histPos + 1);
      input.value = history[histPos];
      introOn = false;
      void update();
      render();
      return;
    }
    if (histPos >= 0 && sel === 0 && input.value === history[histPos]) {
      histPos = Math.min(history.length - 1, histPos + 1);
      input.value = history[histPos];
      void update();
      render();
      return;
    }
    move(-cols);
  } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && cols > 1 && !input.value) {
    e.preventDefault();
    move(e.key === 'ArrowRight' ? 1 : -1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    activate(sel, e.ctrlKey);
  } else if (e.key === 'Backspace' && !input.value && filter) {
    e.preventDefault();
    setFilter(null);
  }
});

content.addEventListener('mousemove', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
  if (!el) return;
  const i = Number(el.dataset.i);
  if (i !== sel) {
    sel = i;
    content.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel'));
    el.classList.add('sel');
  }
});
content.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('#clearclip')) {
    void call('spotlight_clip_clear').then(() => update());
    return;
  }
  const el = t.closest<HTMLElement>('[data-i]');
  if (el) activate(Number(el.dataset.i));
});
document.querySelectorAll<HTMLButtonElement>('.circ').forEach((b, i) => {
  b.innerHTML = svg(MODES[i].glyph, 25, 1.6);
  b.addEventListener('click', () => setFilter(b.dataset.mode as Mode));
});
let menuEl: HTMLDivElement | null = null;
const closeMenu = () => { menuEl?.remove(); menuEl = null; };
function openMenu(x: number, y: number, it: Item) {
  closeMenu();
  const key = it.key!;
  const m = document.createElement('div');
  m.className = 'ctx';
  const row = (label: string, fn: () => void) => {
    const r = document.createElement('div');
    r.className = 'ci';
    r.textContent = label;
    r.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); fn(); });
    m.appendChild(r);
  };
  row('Choose Icon…', () => void call('spotlight_pick_icon', { key }));
  if (custom.has(key)) row('Reset Icon', () => void call('spotlight_reset_icon', { key }));
  m.addEventListener('mousedown', (e) => e.stopPropagation());
  m.addEventListener('contextmenu', (e) => e.preventDefault());
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  m.style.left = `${Math.max(6, Math.min(x, window.innerWidth - r.width - 6))}px`;
  m.style.top = `${Math.max(6, Math.min(y, window.innerHeight - r.height - 6))}px`;
  menuEl = m;
}
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
  const it = el ? items[Number(el.dataset.i)] : undefined;
  if (it?.key) openMenu(e.clientX, e.clientY, it);
  else closeMenu();
});
window.addEventListener('mousedown', () => closeMenu());
window.addEventListener('blur', closeMenu);

stage.addEventListener('mousedown', (e) => {
  const t = e.target as HTMLElement;
  if (t === stage || t.id === 'row') void call('spotlight_hide');
});

const circs = Array.from(document.querySelectorAll<HTMLButtonElement>('.circ'));
const bgc = document.createElement('canvas');
Object.assign(bgc.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', opacity: '0', pointerEvents: 'none' });
stage.insertBefore(bgc, stage.firstChild);
const glassCfg = (dark: boolean) =>
  JSON.stringify({
    floating: false, cornerRadius: 28, zRadius: 12, refraction: 0.16, chromAberration: 0.02, edgeHighlight: dark ? 0.1 : 0.14,
    specular: 0.16, fresnel: 0.9, saturation: dark ? 0.1 : 0.25, blurAmount: 0.95, brightness: dark ? -0.38 : 0.12, shadowOpacity: dark ? 0.4 : 0.22,
  });
const setGlassTheme = (dark: boolean) => [box, ...circs].forEach((el) => (el.dataset.config = glassCfg(dark)));
setGlassTheme(document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches));

const BOX_W = 500, BOX_OPEN = 760, CIRC = 56, GAP = 12, CG = 10;
function layout() {
  const open = stage.classList.contains('open');
  const W = window.innerWidth;
  const total = BOX_W + GAP + 4 * CIRC + 3 * CG;
  const top = stage.classList.contains('native') ? 40 : Math.round(window.innerHeight * 0.27);
  box.style.top = `${top}px`;
  box.style.left = `${Math.round((W - (open ? BOX_OPEN : total)) / 2)}px`;
  circs.forEach((c, i) => {
    c.style.top = `${top}px`;
    c.style.left = `${Math.round((W - total) / 2) + BOX_W + GAP + i * (CIRC + CG)}px`;
  });
}
new MutationObserver(layout).observe(stage, { attributes: true, attributeFilter: ['class'] });
window.addEventListener('resize', layout);
layout();

let glass: LiquidGlass | null = null;
const initLiquid = () => {
  void call('spotlight_set_native', { on: false }).catch(() => undefined);
  return LiquidGlass.init({ root: stage, glassElements: [box, ...circs] })
    .then((g) => {
      glass = g;
      stage.classList.add('lg-on');
    })
    .catch((err) => console.error('LiquidGlass init failed (falling back to CSS glass):', err));
};

let native = false;
let shown = false;
const shapes = (): number[][] => {
  const d = window.devicePixelRatio || 1;
  const els: HTMLElement[] = stage.classList.contains('open') ? [box] : [box, ...circs];
  return els.map((el) => {
    const b = el.getBoundingClientRect();
    const r = el === box ? 28 : b.width / 2;
    return [b.left * d + 1, b.top * d + 1, Math.max(1, b.width * d - 2), Math.max(1, b.height * d - 2), Math.max(1, r * d - 1)];
  });
};
const pushShape = () => call<boolean>('spotlight_blur', { rects: shapes() }).catch(() => false);
let shapeRaf = 0;
const queueShape = () => {
  if (!native || !shown) return;
  cancelAnimationFrame(shapeRaf);
  shapeRaf = requestAnimationFrame(() => void pushShape());
};
new ResizeObserver(queueShape).observe(box);
new MutationObserver(queueShape).observe(stage, { attributes: true, attributeFilter: ['class'] });
window.addEventListener('resize', queueShape);
let liveBlur: boolean | null = null;
if ('__TAURI_INTERNALS__' in window) {
  void invoke<{ spotlightLiveBlur?: boolean }>('settings_get')
    .catch(() => ({}) as { spotlightLiveBlur?: boolean })
    .then((cfg) => {
      liveBlur = !!cfg.spotlightLiveBlur;
      if (!liveBlur) return void initLiquid();
      void pushShape().then((ok) => {
        if (ok) {
          native = true;
          stage.classList.add('native');
          void call<boolean>('spotlight_blur', { rects: [] });
        } else void initLiquid();
      });
    });
} else void initLiquid();

let frostUrl = '';
function setFrostBackdrop(src: HTMLCanvasElement) {
  try {
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = src.height;
    const ctx = out.getContext('2d')!;
    ctx.filter = 'blur(7px) saturate(1.6) brightness(1.04)';
    ctx.drawImage(src, -12, -12, src.width + 24, src.height + 24);
    out.toBlob((blob) => {
      if (!blob) return;
      if (frostUrl) URL.revokeObjectURL(frostUrl);
      frostUrl = URL.createObjectURL(blob);
      document.documentElement.style.setProperty('--bd', `url(${frostUrl})`);
    }, 'image/jpeg', 0.85);
  } catch {
  }
}
async function drawGlassBackdrop() {
  try {
    const buf = await call<ArrayBuffer>('spotlight_backdrop');
    if (!buf || buf.byteLength <= 8) return false;
    const dv = new DataView(buf);
    const w = dv.getUint32(0, true);
    const h = dv.getUint32(4, true);
    const px = new Uint8ClampedArray(buf, 8, w * h * 4);
    if (bgc.width !== w || bgc.height !== h) {
      bgc.width = w;
      bgc.height = h;
    }
    bgc.getContext('2d')!.putImageData(new ImageData(px, w, h), 0, 0);
    setFrostBackdrop(bgc);
    glass?.markChanged();
    return true;
  } catch {
    return false;
  }
}

let bdUrl = '';
const BLUR_BACKDROP = true;
async function applyBackdrop() {
  if (native) return true;
  if (glass) return drawGlassBackdrop();
  if (!BLUR_BACKDROP) return false;
  try {
    const buf = await call<ArrayBuffer>('spotlight_backdrop');
    if (!buf || buf.byteLength <= 8) return false;
    const dv = new DataView(buf);
    const w = dv.getUint32(0, true);
    const h = dv.getUint32(4, true);
    const src = document.createElement('canvas');
    src.width = w;
    src.height = h;
    src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(buf, 8, w * h * 4), w, h), 0, 0);
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d')!;
    ctx.filter = 'blur(7px) saturate(1.7) brightness(1.04)';
    ctx.drawImage(src, -12, -12, w + 24, h + 24);
    const blob: Blob | null = await new Promise((r) => out.toBlob(r, 'image/jpeg', 0.85));
    if (!blob) return false;
    if (bdUrl) URL.revokeObjectURL(bdUrl);
    bdUrl = URL.createObjectURL(blob);
    document.documentElement.style.setProperty('--bd', `url(${bdUrl})`);
    return true;
  } catch {
    return false;
  }
}

async function onShow() {
  input.value = '';
  filter = null;
  items = [];
  sel = 0;
  histPos = -1;
  stage.classList.remove('on');
  void loadCustom();
  const n = Number(store.get('lg-spot-intro') || 0);
  introOn = n < 2;
  if (introOn) store.set('lg-spot-intro', String(n + 1));
  try {
    const s = await call<{ indexing: boolean; count: number }>('spotlight_index_status');
    indexing = s.indexing;
    indexCount = s.count;
  } catch {
  }
  render();
  await applyBackdrop();
  shown = true;
  layout();
  if (native) await pushShape();
  stage.classList.add('on');
  input.focus();
}
function onHide() {
  closeMenu();
  shown = false;
  if (native) void call<boolean>('spotlight_blur', { rects: [] });
  stage.classList.remove('on', 'open');
  if (frostUrl) {
    document.documentElement.style.removeProperty('--bd');
    URL.revokeObjectURL(frostUrl);
    frostUrl = '';
  }
  if (bdUrl) {
    document.documentElement.style.removeProperty('--bd');
    URL.revokeObjectURL(bdUrl);
    bdUrl = '';
  }
}

if ('__TAURI_INTERNALS__' in window) {
  type Look = { accent?: string; font?: string; appearance?: string; spotlightLiveBlur?: boolean };
  const dm = matchMedia('(prefers-color-scheme: dark)');
  let mode = 'auto';
  const theme = () => {
    const dark = mode === 'dark' || (mode === 'auto' && dm.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    setGlassTheme(dark);
  };
  dm.addEventListener('change', theme);
  const paint = (s: Look) => {
    if (s.appearance) { mode = s.appearance; theme(); }
    if (liveBlur !== null && s.spotlightLiveBlur !== undefined && s.spotlightLiveBlur !== liveBlur) location.reload();
    if (s.accent) document.documentElement.style.setProperty('--accent', s.accent);
    if (s.font) document.documentElement.style.setProperty('--font', s.font);
  };
  void invoke<Look>('settings_get').then(paint, () => {});
  void listen<Look>('settings:changed', (e) => paint(e.payload));
  void listen('spotlight:icons-changed', () => void loadCustom());
  void listen('spotlight:show', () => void onShow());
  void listen('spotlight:hide', onHide);
  void listen<{ indexing: boolean; count: number }>('spotlight:index', (e) => {
    const was = indexing;
    indexing = e.payload.indexing;
    indexCount = e.payload.count;
    idxlbl.textContent = indexing ? `Indexing… ${indexCount.toLocaleString('en-US')}` : 'Index ready';
    if (was && !indexing && (input.value || filter)) void update();
    else if (was && !indexing && introOn) render();
  });
}
document.documentElement.dataset.theme ||= matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
(window as unknown as { __spot: unknown }).__spot = { show: onShow, hide: onHide };
