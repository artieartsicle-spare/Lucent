import type { ContextMenu, MenuItem } from './context-menu';

export type DItem = { id: string; name: string; kind: 'folder' | 'app' | 'file' | 'virtual'; icon: string | null; mtime: number; custom?: boolean };
type Info = { name: string; type: string; where: string; size: number | null; created: number | null; modified: number | null; target: string | null };
type Payload = { enabled: boolean; size: number; items: DItem[]; binFull?: boolean };
type Api = {
  desktopGet?: () => Promise<Payload>;
  onDesktop?: (cb: (p: Payload) => void) => void;
  desktopOpen?: (id: string) => void;
  desktopReveal?: (id: string) => void;
  desktopTrash?: (id: string) => Promise<boolean>;
  desktopDragOut?: (ids: string[]) => Promise<boolean>;
  desktopEmptyBin?: () => void;
  desktopRename?: (id: string, name: string) => Promise<{ ok: boolean; id?: string; error?: string }>;
  desktopInfo?: (id: string) => Promise<Info | null>;
  desktopPickIcon?: (id: string) => Promise<{ ok: boolean; canceled?: boolean; error?: string }>;
  desktopResetIcon?: (id: string) => Promise<boolean>;
  setTyping?: (on: boolean) => void;
  desktopOpenWith?: (id: string) => void;
  desktopCompress?: (ids: string[]) => void;
  desktopDuplicate?: (ids: string[]) => void;
  desktopAlias?: (ids: string[]) => void;
  desktopCopy?: (ids: string[]) => void;
  desktopCopyPath?: (id: string) => void;
};
const api = () => (window as any).overlayAPI as Api | undefined;

type Hooks = {
  layer: HTMLElement;
  ui: HTMLElement;
  menu: ContextMenu;
  size: () => { w: number; h: number };
  margins: () => { left: number; right: number; top: number; bottom: number };
  beginDrag: () => void;
  endDrag: () => void;
};

const POS_KEY = 'lucent-icons-v1';
const SELECT_TIMEOUT = 8000;

const FOLDER_SVG = (s: number) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 64 64"><defs>
    <linearGradient id="lgf-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f9ff2"/><stop offset="1" stop-color="#2a82e6"/></linearGradient>
    <linearGradient id="lgf-f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fd2fe"/><stop offset="1" stop-color="#3fb0fb"/></linearGradient></defs>
    <path d="M5 13.5a4.5 4.5 0 0 1 4.5-4.5h12.6a4.5 4.5 0 0 1 3.2 1.3l2.6 2.6a4.5 4.5 0 0 0 3.2 1.3H54.5a4.5 4.5 0 0 1 4.5 4.5V49a4.5 4.5 0 0 1-4.5 4.5h-45A4.5 4.5 0 0 1 5 49Z" fill="url(#lgf-b)"/>
    <path d="M5 21.5a4.5 4.5 0 0 1 4.5-4.5h45a4.5 4.5 0 0 1 4.5 4.5V49a4.5 4.5 0 0 1-4.5 4.5h-45A4.5 4.5 0 0 1 5 49Z" fill="url(#lgf-f)"/>
    <path d="M9.5 17.4h45a4.1 4.1 0 0 1 4.1 3.6" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1"/></svg>`;
const ARCHIVE_SVG = (s: number) => {
  let teeth = '';
  for (let i = 0; i < 8; i++) teeth += `<rect x="${i % 2 ? 32.3 : 29.2}" y="${6.5 + i * 3.7}" width="2.6" height="2.4" rx=".5" fill="#6f7380"/>`;
  return `<svg width="${s}" height="${s}" viewBox="0 0 64 64"><defs>
    <linearGradient id="lga-p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbfbfc"/><stop offset="1" stop-color="#d3d6dd"/></linearGradient></defs>
    <rect x="12" y="4.5" width="40" height="55" rx="5" fill="url(#lga-p)" stroke="#000" stroke-opacity=".12"/>
    <rect x="29" y="5" width="6" height="30" fill="#e6e8ec"/>${teeth}
    <rect x="28.4" y="33" width="7.2" height="11" rx="2.6" fill="#4c4f5a"/><circle cx="32" cy="39.5" r="1.9" fill="#dfe1e6"/></svg>`;
};
const TRASH_SVG = (s: number, full = false) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 64 64"><defs>
    <linearGradient id="lgt-b" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b3bac6"/><stop offset=".35" stop-color="#e6e9ef"/><stop offset=".7" stop-color="#d4d8e0"/><stop offset="1" stop-color="#a5adba"/></linearGradient>
    <linearGradient id="lgt-l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3f4f7"/><stop offset="1" stop-color="#c3c8d2"/></linearGradient></defs>
    ${full ? '<path d="M17 15l6-9 7 5 5-8 7 7 7-3 1 10Z" fill="#fbfbfc" stroke="#000" stroke-opacity=".18" stroke-linejoin="round"/><path d="M24 14l5-4M37 13l5-5" stroke="#aab0bc" stroke-width="1.4" stroke-linecap="round"/>' : ''}
    <rect x="25" y="5.5" width="14" height="6" rx="3" fill="#c3c8d2" stroke="#000" stroke-opacity=".1" ${full ? 'opacity="0"' : ''}/>
    <path d="M12.5 20.5h39l-3.2 34.3a4.2 4.2 0 0 1-4.2 3.7H19.9a4.2 4.2 0 0 1-4.2-3.7Z" fill="url(#lgt-b)" stroke="#000" stroke-opacity=".12"/>
    <g stroke="#7d8594" stroke-opacity=".55" stroke-width="2.2" stroke-linecap="round"><path d="M23.5 26.5l.9 26M32 26.5v26M40.5 26.5l-.9 26"/></g>
    <rect x="9.5" y="12.5" width="45" height="8.6" rx="4.3" fill="url(#lgt-l)" stroke="#000" stroke-opacity=".12"/></svg>`;
const DRIVE_SVG = (s: number) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 64 64"><defs>
    <linearGradient id="lgd-t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f5f8"/><stop offset="1" stop-color="#c9ced8"/></linearGradient>
    <linearGradient id="lgd-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8f97a6"/><stop offset="1" stop-color="#6d7584"/></linearGradient></defs>
    <path d="M8 36l5.5-17.5A5 5 0 0 1 18.3 15h27.4a5 5 0 0 1 4.8 3.5L56 36Z" fill="url(#lgd-t)" stroke="#000" stroke-opacity=".14"/>
    <path d="M8 36h48v11a5 5 0 0 1-5 5H13a5 5 0 0 1-5-5Z" fill="url(#lgd-b)" stroke="#000" stroke-opacity=".18"/>
    <rect x="14" y="42" width="22" height="3" rx="1.5" fill="#fff" fill-opacity=".35"/><circle cx="47.5" cy="43.5" r="2.3" fill="#34c759"/>
    <path d="M10 36.4h44" stroke="#fff" stroke-opacity=".55"/></svg>`;
const ARCHIVE_RE = /\.(zip|rar|7z|tar|gz|tgz|bz2|xz|zipx)$/i;
const FILE_SVG = (s: number) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 64 64"><path d="M14 6h25l13 13v35a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4V10a4 4 0 0 1 4-4Z" fill="#f2f3f6"/>
    <path d="M39 6v10a3 3 0 0 0 3 3h10Z" fill="#c9ccd6"/></svg>`;
const kindOrder = { virtual: 0, folder: 1, app: 2, file: 3 };

export function initDesktopIcons(hooks: Hooks) {
  let size = 64;
  let items: DItem[] = [];
  let enabled = false;
  let binFull = false;
  let sortMode: 'name' | 'kind' | 'date' = 'name';
  const pos = new Map<string, { c: number; r: number }>();
  const els = new Map<string, HTMLDivElement>();
  const selected = new Set<string>();
  let renaming: string | null = null;
  let selTimer = 0;

  try {
    const raw = JSON.parse(localStorage.getItem(POS_KEY) || '{}');
    for (const [k, v] of Object.entries(raw.pos || {})) pos.set(k, v as { c: number; r: number });
  } catch {
  }
  const savePos = () => {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({ pos: Object.fromEntries(pos) }));
    } catch {
    }
  };

  const cellW = () => size + 40;
  const cellH = () => size + 50;
  const rowsN = () => {
    const m = hooks.margins();
    return Math.max(1, Math.floor((hooks.size().h - m.top - m.bottom) / cellH()));
  };
  const colsN = () => {
    const m = hooks.margins();
    return Math.max(1, Math.floor((hooks.size().w - m.left - m.right) / cellW()));
  };
  const cellXY = (c: number, r: number) => {
    const m = hooks.margins();
    return { x: hooks.size().w - m.right - (c + 1) * cellW(), y: m.top + r * cellH() };
  };
  const key = (c: number, r: number) => `${c},${r}`;

  const compare = (a: DItem, b: DItem) => {
    if (sortMode === 'date') return b.mtime - a.mtime || a.name.localeCompare(b.name);
    if (sortMode === 'kind') return kindOrder[a.kind] - kindOrder[b.kind] || a.name.localeCompare(b.name, undefined, { numeric: true });
    return kindOrder[a.kind] === 0 || kindOrder[b.kind] === 0
      ? kindOrder[a.kind] - kindOrder[b.kind] || 0
      : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  };

  function assign() {
    const rows = rowsN();
    const cols = colsN();
    const taken = new Set<string>();
    const ids = new Set(items.map((i) => i.id));
    for (const k of [...pos.keys()]) if (!ids.has(k)) pos.delete(k);
    for (const it of items) {
      const p = pos.get(it.id);
      if (p && p.c < cols && p.r < rows && !taken.has(key(p.c, p.r))) taken.add(key(p.c, p.r));
      else pos.delete(it.id);
    }
    const loose = items.filter((i) => !pos.has(i.id)).sort(compare);
    let c = 0;
    let r = 0;
    for (const it of loose) {
      while (taken.has(key(c, r))) {
        r++;
        if (r >= rows) {
          r = 0;
          c++;
        }
      }
      pos.set(it.id, { c, r });
      taken.add(key(c, r));
    }
  }

  function iconHtml(it: DItem) {
    if (it.custom && it.icon) return `<img src="${it.icon}" width="${size}" height="${size}" draggable="false" style="object-fit:contain" />`;
    if (it.kind === 'folder') return FOLDER_SVG(size);
    if (it.id === 'virtual:recycle') return TRASH_SVG(size, binFull);
    if (it.id.startsWith('drive:')) return DRIVE_SVG(size);
    if (it.kind === 'file' && ARCHIVE_RE.test(it.name)) return ARCHIVE_SVG(size);
    if (it.icon) return `<img src="${it.icon}" width="${size}" height="${size}" draggable="false" />`;
    return FILE_SVG(size);
  }
  const clean = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

  function build(it: DItem) {
    const el = document.createElement('div');
    el.className = 'dicon';
    el.dataset.id = it.id;
    el.addEventListener('pointerdown', (e) => onDown(it.id, el, e));
    el.addEventListener('dblclick', () => {
      if (renaming) return;
      api()?.desktopOpen?.(it.id);
      clearSelection();
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!selected.has(it.id)) select([it.id]);
      showMenu(it, e.clientX, e.clientY);
    });
    hooks.layer.appendChild(el);
    els.set(it.id, el);
    return el;
  }
  function paint(it: DItem, el: HTMLDivElement) {
    const sig = `${it.name}|${it.icon ? it.icon.length + it.icon.slice(160, 200) : 0}|${it.kind}|${it.custom ? 1 : 0}|${size}|${it.id === 'virtual:recycle' ? binFull : ''}`;
    if (el.dataset.sig !== sig && renaming !== it.id) {
      el.dataset.sig = sig;
      el.style.width = `${cellW()}px`;
      el.innerHTML = `<div class="di-img">${iconHtml(it)}</div><div class="di-name"><span>${clean(it.name)}</span></div>`;
    }
    el.classList.toggle('sel', selected.has(it.id));
  }
  function layout() {
    if (!enabled) return;
    assign();
    for (const it of items) {
      const el = els.get(it.id) ?? build(it);
      paint(it, el);
      const p = pos.get(it.id)!;
      const xy = cellXY(p.c, p.r);
      el.style.left = `${xy.x}px`;
      el.style.top = `${xy.y}px`;
      el.style.width = `${cellW()}px`;
    }
    for (const [id, el] of els) {
      if (!items.some((i) => i.id === id)) {
        el.remove();
        els.delete(id);
        selected.delete(id);
      }
    }
  }
  function apply(p: Payload) {
    enabled = !!p.enabled;
    binFull = !!p.binFull;
    const sizeChanged = p.size !== size;
    size = p.size || 64;
    items = enabled ? p.items : [];
    if (sizeChanged) for (const el of els.values()) delete el.dataset.sig;
    if (!enabled) {
      els.forEach((el) => el.remove());
      els.clear();
      selected.clear();
    }
    layout();
    savePos();
    if (propsId) renderProps();
  }

  function touch() {
    clearTimeout(selTimer);
    selTimer = window.setTimeout(() => {
      if (!renaming && !dragState) clearSelection();
    }, SELECT_TIMEOUT);
  }
  function select(ids: string[]) {
    selected.clear();
    ids.forEach((i) => selected.add(i));
    els.forEach((el, id) => el.classList.toggle('sel', selected.has(id)));
    touch();
  }
  function clearSelection() {
    selected.clear();
    els.forEach((el) => el.classList.remove('sel'));
    closeMenu();
  }

  let dragState: { ids: string[]; base: Map<string, { x: number; y: number }> } | null = null;
  function onDown(id: string, el: HTMLDivElement, e: PointerEvent) {
    if (e.button !== 0 || renaming) return;
    closeMenu();
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    const wasSelected = selected.has(id);
    if (additive) {
      if (wasSelected) selected.delete(id);
      else selected.add(id);
      els.forEach((x, k) => x.classList.toggle('sel', selected.has(k)));
      touch();
      if (!selected.has(id)) return;
    } else if (!wasSelected) {
      select([id]);
    }
    const ids = [...selected];
    const base = new Map<string, { x: number; y: number }>();
    for (const k of ids) {
      const x = els.get(k);
      if (x) base.set(k, { x: parseFloat(x.style.left), y: parseFloat(x.style.top) });
    }
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    el.setPointerCapture(e.pointerId);
    hooks.beginDrag();
    const realIds = ids.filter((k) => !k.startsWith('virtual:') && !k.startsWith('drive:'));
    let probing = false;
    let lastProbe = 0;
    let handedOff = false;
    const handOff = () => {
      handedOff = true;
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      try { el.releasePointerCapture(e.pointerId); } catch { }
      hooks.endDrag();
      binEl()?.classList.remove('drop-target');
      for (const k of ids) {
        const b = base.get(k);
        const x = els.get(k);
        if (b && x) { x.style.left = `${b.x}px`; x.style.top = `${b.y}px`; x.classList.remove('dragging'); }
      }
      dragState = null;
      touch();
    };
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      if (!moved) {
        moved = true;
        dragState = { ids, base };
        ids.forEach((k) => els.get(k)?.classList.add('dragging'));
      }
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      for (const k of ids) {
        const b = base.get(k)!;
        const x = els.get(k)!;
        x.style.left = `${b.x + dx}px`;
        x.style.top = `${b.y + dy}px`;
      }
      binEl()?.classList.toggle('drop-target', overBin(ev.clientX, ev.clientY, ids));
      const now = performance.now();
      if (!probing && !handedOff && realIds.length && now - lastProbe > 70) {
        lastProbe = now;
        probing = true;
        void Promise.resolve(api()?.desktopDragOut?.(realIds))
          .then((started) => { probing = false; if (started && !handedOff) handOff(); })
          .catch(() => { probing = false; });
      }
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      hooks.endDrag();
      binEl()?.classList.remove('drop-target');
      if (moved && overBin(ev.clientX, ev.clientY, ids)) {
        const real = ids.filter((k) => !k.startsWith('virtual:') && !k.startsWith('drive:'));
        const rest = ids.filter((k) => !real.includes(k) && k !== 'virtual:recycle');
        const bin = ids.includes('virtual:recycle') ? ['virtual:recycle'] : [];
        real.forEach((k) => void api()?.desktopTrash?.(k));
        ids.forEach((k) => els.get(k)?.classList.remove('dragging'));
        drop([...rest, ...bin], base, 0, 0);
        dragState = null;
        clearSelection();
      } else if (moved) {
        const dx = ev.clientX - sx;
        const dy = ev.clientY - sy;
        drop(ids, base, dx, dy);
        ids.forEach((k) => els.get(k)?.classList.remove('dragging'));
        dragState = null;
        touch();
      } else if (!additive && selected.size > 1) {
        select([id]);
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    e.preventDefault();
  }

  const binEl = () => els.get('virtual:recycle');
  function overBin(x: number, y: number, ids: string[]) {
    const el = binEl();
    if (!el || ids.includes('virtual:recycle')) return false;
    if (!ids.some((k) => !k.startsWith('virtual:') && !k.startsWith('drive:'))) return false;
    const r = el.getBoundingClientRect();
    const pad = 8;
    return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  }

  function drop(ids: string[], base: Map<string, { x: number; y: number }>, dx: number, dy: number) {
    const rows = rowsN();
    const cols = colsN();
    const moving = new Set(ids);
    const taken = new Set<string>();
    for (const [k, p] of pos) if (!moving.has(k)) taken.add(key(p.c, p.r));
    const W = hooks.size().w;
    for (const k of ids) {
      const b = base.get(k)!;
      const x = b.x + dx;
      const y = b.y + dy;
      const mg = hooks.margins();
      const fc = (W - mg.right - cellW() - x) / cellW();
      const fr = (y - mg.top) / cellH();
      let best: { c: number; r: number } | null = null;
      let bestD = Infinity;
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          if (taken.has(key(c, r))) continue;
          const d = (c - fc) ** 2 + (r - fr) ** 2;
          if (d < bestD) {
            bestD = d;
            best = { c, r };
          }
        }
      }
      if (best) {
        pos.set(k, best);
        taken.add(key(best.c, best.r));
      }
    }
    savePos();
    layout();
  }

  function closeMenu() {
    hooks.menu.close();
  }
  const shortName = (n: string) => (n.length > 26 ? n.slice(0, 25) + '\u2026' : n);
  function showMenu(it: DItem, x: number, y: number) {
    const A = api();
    const ids = [...selected];
    const n = ids.length;
    const many = n > 1;
    const real = it.kind !== 'virtual';
    const items: MenuItem[] = [{ label: many ? `Open ${n} Items` : 'Open', fn: () => ids.forEach((id) => A?.desktopOpen?.(id)) }];
    if (real) {
      items.push(
        { label: 'Open With\u2026', disabled: many || it.kind === 'folder', fn: () => A?.desktopOpenWith?.(it.id) },
        { sep: true },
        {
          label: many ? `Move ${n} Items to Recycle Bin` : 'Move to Recycle Bin',
          fn: () => {
            ids.forEach((id) => void A?.desktopTrash?.(id));
            clearSelection();
          },
        },
        { sep: true },
        { label: 'Get Info', disabled: many, fn: () => void openProps(it.id) },
        { label: 'Rename', disabled: many, fn: () => startRename(it.id) },
        { label: many ? `Compress ${n} Items` : `Compress \u201c${shortName(it.name)}\u201d`, fn: () => A?.desktopCompress?.(ids) },
        { label: 'Duplicate', fn: () => A?.desktopDuplicate?.(ids) },
        { label: 'Make Alias', fn: () => A?.desktopAlias?.(ids) },
        { sep: true },
        { label: 'Copy', fn: () => A?.desktopCopy?.(ids) },
        { label: 'Copy Path', disabled: many, fn: () => A?.desktopCopyPath?.(it.id) },
        { label: 'Show in File Explorer', disabled: many, fn: () => A?.desktopReveal?.(it.id) }
      );
    } else if (it.id === 'virtual:recycle') {
      items.push({ sep: true }, { label: 'Empty Recycle Bin', disabled: !binFull, fn: () => A?.desktopEmptyBin?.() });
    } else if (!it.id.startsWith('drive:')) {
      items.push({ sep: true }, { label: 'Get Info', disabled: many, fn: () => void openProps(it.id) });
    }
    hooks.menu.show(items, x, y);
  }

  const dcss = document.createElement('style');
  dcss.textContent = '.dicon.drop-target .di-img{transform:scale(1.14);filter:brightness(1.12) drop-shadow(0 0 10px rgba(255,255,255,.55))}.dicon .di-img{transition:transform .12s,filter .12s}';
  document.head.appendChild(dcss);
  const pcss = document.createElement('style');
  pcss.textContent = `
#iprops{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(.97);width:318px;box-sizing:border-box;padding:18px 18px 14px;border-radius:14px;
  background:var(--fly-bg);backdrop-filter:blur(30px) saturate(1.6);-webkit-backdrop-filter:blur(30px) saturate(1.6);color:var(--fly-fg);
  font:13px/1.3 "Inter",system-ui,sans-serif;box-shadow:0 0 0 .5px var(--fp-ring),var(--fp-sh);opacity:0;pointer-events:none;transition:opacity .14s,transform .14s;z-index:60}
#iprops.show{opacity:1;pointer-events:auto;transform:translate(-50%,-50%) scale(1)}
#iprops .pp-h{display:flex;gap:14px;align-items:center;padding-bottom:14px;border-bottom:1px solid var(--fp-line)}
#iprops .pp-i{width:64px;height:64px;flex:none;display:flex;align-items:center;justify-content:center}
#iprops .pp-i img,#iprops .pp-i svg{max-width:64px;max-height:64px;width:64px;height:64px;object-fit:contain}
#iprops .pp-n{font-weight:600;font-size:15px;word-break:break-word}
#iprops .pp-t{color:var(--fp-sub);margin-top:2px}
#iprops .pp-r{display:flex;gap:10px;padding:9px 0 0}
#iprops .pp-r span:first-child{width:76px;flex:none;color:var(--fp-sub);text-align:right}
#iprops .pp-r span:last-child{flex:1;min-width:0;word-break:break-all}
#iprops .pp-b{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}
#iprops button{font:500 13px "Inter",system-ui,sans-serif;padding:5px 12px;border-radius:7px;border:0;background:var(--fp-card);color:var(--fp-fg);box-shadow:0 0 0 .5px var(--fp-btn-bd),0 1px 1px rgba(0,0,0,.08);cursor:default}
#iprops button:hover{background:var(--fp-hover)}
#iprops button.pri{background:#0a7cff;color:#fff;box-shadow:none}
#iprops button.pri:hover{background:#2f8dff}
#iprops button:disabled{opacity:.4;pointer-events:none}
#iprops .pp-sp{flex:1}
`;
  document.head.appendChild(pcss);
  const props = document.createElement('div');
  props.id = 'iprops';
  hooks.ui.appendChild(props);
  let propsId: string | null = null;
  let propsInfo: Info | null = null;
  const fmtSize = (n: number | null) => {
    if (n === null) return '—';
    if (n < 1024) return `${n} bytes`;
    const u = ['KB', 'MB', 'GB', 'TB'];
    let v = n / 1024;
    let i = 0;
    while (v >= 1024 && i < u.length - 1) {
      v /= 1024;
      i++;
    }
    return `${v.toFixed(v < 10 ? 2 : 1)} ${u[i]}`;
  };
  const fmtDate = (t: number | null) => (t ? new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  function closeProps() {
    propsId = null;
    props.classList.remove('show');
  }
  function renderProps() {
    const it = items.find((i) => i.id === propsId);
    if (!it || !propsInfo) return closeProps();
    const i = propsInfo;
    const row = (k: string, v: string) => `<div class="pp-r"><span>${k}</span><span>${clean(v)}</span></div>`;
    props.innerHTML = `<div class="pp-h"><div class="pp-i">${iconHtml(it).replace(/width="\d+" height="\d+"/, '')}</div>
      <div><div class="pp-n">${clean(i.name)}</div><div class="pp-t">${clean(i.type)}</div></div></div>
      ${row('Where', i.where)}${i.target ? row('Target', i.target) : ''}${row('Size', fmtSize(i.size))}${row('Created', fmtDate(i.created))}${row('Modified', fmtDate(i.modified))}
      <div class="pp-b"><button data-a="pick" class="pri">Change Icon…</button><button data-a="reset" ${it.custom ? '' : 'disabled'}>Reset Icon</button><span class="pp-sp"></span><button data-a="close">Done</button></div>`;
    props.querySelector('[data-a=close]')!.addEventListener('click', closeProps);
    props.querySelector('[data-a=reset]')!.addEventListener('click', () => void api()?.desktopResetIcon?.(it.id));
    props.querySelector('[data-a=pick]')!.addEventListener('click', () => void api()?.desktopPickIcon?.(it.id));
  }
  async function openProps(id: string) {
    const info = await api()?.desktopInfo?.(id);
    if (!info) return;
    propsId = id;
    propsInfo = info;
    renderProps();
    props.classList.add('show');
  }

  function startRename(id: string) {
    const it = items.find((i) => i.id === id);
    const el = els.get(id);
    if (!it || !el || renaming) return;
    renaming = id;
    clearTimeout(selTimer);
    const input = document.createElement('input');
    input.className = 'di-edit';
    input.value = it.name;
    input.spellcheck = false;
    const holder = el.querySelector('.di-name') as HTMLElement;
    holder.replaceChildren(input);
    api()?.setTyping?.(true);
    setTimeout(() => {
      input.focus();
      input.select();
    }, 60);
    let done = false;
    const finish = async (commit: boolean) => {
      if (done) return;
      done = true;
      renaming = null;
      api()?.setTyping?.(false);
      const v = input.value.trim();
      if (commit && v && v !== it.name) {
        const r = await api()?.desktopRename?.(id, v);
        if (r?.ok && r.id) {
          const p = pos.get(id);
          if (p) pos.set(r.id, p);
          pos.delete(id);
          savePos();
        }
      }
      delete el.dataset.sig;
      layout();
      touch();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void finish(true);
      else if (e.key === 'Escape') void finish(false);
      e.stopPropagation();
    });
    input.addEventListener('blur', () => void finish(true));
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      clearSelection();
      closeProps();
    }
  });
  api()?.onDesktop?.(apply);
  void api()
    ?.desktopGet?.()
    .then(apply);

  return {
    relayout: layout,
    cell: () => ({ w: cellW(), h: cellH() }),
    sortMode: () => sortMode,
    size: () => size,
    cmd(name: string, arg?: string) {
      if (name === 'cleanup' && !arg) name = 'snap';
      if (name === 'cleanup' || name === 'sort') {
        const prev = sortMode;
        sortMode = (arg as typeof sortMode) || 'name';
        pos.clear();
        savePos();
        layout();
        if (name === 'cleanup') sortMode = prev;
      } else if (name === 'snap') {
        const order = [...items].sort((a, b) => {
          const pa = pos.get(a.id);
          const pb = pos.get(b.id);
          return (pa ? pa.c : 1e6) - (pb ? pb.c : 1e6) || (pa ? pa.r : 1e6) - (pb ? pb.r : 1e6);
        });
        const keep = new Map(order.map((it, i) => [it.id, i]));
        pos.clear();
        const rows = rowsN();
        order.forEach((it) => {
          const i = keep.get(it.id)!;
          pos.set(it.id, { c: Math.floor(i / rows), r: i % rows });
        });
        savePos();
        layout();
      } else if (name === 'deselect') {
        if (!renaming && selected.size) clearSelection();
      } else if (name === 'rename' && arg) {
        let tries = 0;
        const go = () => {
          if (items.some((i) => i.id === arg)) {
            select([arg]);
            startRename(arg);
          } else if (tries++ < 30) setTimeout(go, 80);
        };
        go();
      }
    },
  };
}
