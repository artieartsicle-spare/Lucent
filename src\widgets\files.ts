import { defineWidgets, type WidgetCfg } from './_api';
import { folderOf } from './_choices';
import './_cardStyles';
import { $ } from './_cardShared';
import { esc, native, type FileItem } from './_native';

const BLUE = '#1a8cff';
const docGlyph = (px: number) =>
  `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="var(--sub)" stroke-width="1.6" stroke-linejoin="round"><path d="M6.5 3.5h7l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5Z"/><path d="M13.5 3.5V8H18"/></svg>`;

const COUNT = { S: 4, M: 4, L: 9 } as const;
const NAME_MAX = { S: 12, M: 24, L: 15 } as const;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|avif)$/i;
const iconCache = new Map<string, string>();
const previewCache = new Map<string, string>();

export function midCut(name: string, max: number): string {
  if (name.length <= max) return name;
  const keep = max - 1;
  const tail = Math.min(Math.ceil(keep * 0.45), 8);
  return `${name.slice(0, keep - tail).trimEnd()}…${name.slice(name.length - tail)}`;
}
const shortDate = (unixSec: number) => new Date(unixSec * 1000).toLocaleDateString([], { month: 'numeric', day: 'numeric', year: '2-digit' });

const files = (size: 'S' | 'M' | 'L') => (root: HTMLElement, cfg?: WidgetCfg) => {
  const api = native();
  const folder = folderOf('Files', cfg?.folder);
  let list: FileItem[] = [];
  let loaded = false;
  let alive = true;

  const thumb = (f: FileItem, w: number, h: number) => {
    const pic = previewCache.get(f.path);
    if (pic) return `<span class="fl-th pic" style="width:${w}px;height:${h}px"><img src="${pic}" alt="" draggable="false"></span>`;
    const u = iconCache.get(f.path);
    const ic = Math.round(Math.min(w, h) * 0.62);
    return `<span class="fl-th" style="width:${w}px;height:${h}px">${u ? `<img class="ic" src="${u}" width="${ic}" height="${ic}" alt="" draggable="false">` : docGlyph(ic)}</span>`;
  };
  const cell = (f: FileItem) => {
    const t = size === 'S' ? thumb(f, 36, 44) : size === 'L' ? thumb(f, 62, 76) : thumb(f, 34, 44);
    if (size === 'M') {
      return `<div class="fl-c ix" data-path="${esc(f.path)}" title="${esc(f.name)}">${t}<div class="fl-tx"><div class="fl-n">${esc(midCut(f.name, NAME_MAX.M))}</div><div class="fl-d">${shortDate(f.mtime)}</div></div></div>`;
    }
    return `<div class="fl-c ix" data-path="${esc(f.path)}" title="${esc(f.name)}">${t}<div class="fl-n">${esc(midCut(f.name, NAME_MAX[size]))}</div></div>`;
  };
  const draw = () => {
    if (!alive) return;
    const shown = list.slice(0, COUNT[size]);
    root.innerHTML = $(
      `<div class="wc card fl fl-${size.toLowerCase()}">${shown.length ? `<div class="fl-g">${shown.map(cell).join('')}</div>` : `<div class="fl-empty">${loaded ? 'No files here yet' : 'Loading…'}</div>`}</div>`
    );
  };

  const load = async () => {
    if (!api.filesList) {
      loaded = true;
      draw();
      return;
    }
    try {
      list = await api.filesList(folder.id, 12);
    } catch {
    }
    loaded = true;
    draw();
    const top = list.slice(0, COUNT[size]);
    const need = top.map((f) => f.path).filter((p) => !iconCache.has(p));
    if (need.length && api.fileIcons) {
      try {
        const got = await api.fileIcons(need);
        Object.entries(got).forEach(([p, u]) => iconCache.set(p, u));
        draw();
      } catch {
      }
    }
    const pics = top.filter((f) => IMAGE_EXT.test(f.name) && !previewCache.has(f.path));
    if (pics.length && api.photoThumb) {
      await Promise.all(
        pics.map(async (f) => {
          try {
            previewCache.set(f.path, await api.photoThumb!(f.path, 160));
          } catch {
          }
        })
      );
      draw();
    }
  };
  draw();
  void load();
  const t = setInterval(() => void load(), 60_000);
  const click = (e: Event) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-path]');
    if (el?.dataset.path) api.pathOpen?.(el.dataset.path);
  };
  root.addEventListener('click', click);
  return () => {
    alive = false;
    clearInterval(t);
    root.removeEventListener('click', click);
    root.innerHTML = '';
  };
};

const css = document.createElement('style');
css.textContent = `
.fl{display:flex;flex-direction:column;text-align:left;--tile:color-mix(in srgb,var(--fg) 8%,transparent)}
.fl-s{padding:12px 10px}
.fl-m{padding:10px}
.fl-l{padding:14px 12px 12px}
.fl-g{flex:1;min-height:0;display:grid}
.fl-s .fl-g{grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:4px 6px}
.fl-m .fl-g{grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:8px}
.fl-l .fl-g{grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);gap:6px 4px}
.fl-c{min-width:0;min-height:0;display:flex;align-items:center;justify-content:center}
.fl-s .fl-c,.fl-l .fl-c{flex-direction:column;gap:4px;text-align:center}
.fl-m .fl-c{justify-content:flex-start;gap:9px;padding:0 9px;border-radius:16px;background:var(--tile)}
.fl-th{flex:none;display:flex;align-items:center;justify-content:center;border-radius:6px;overflow:hidden;background:color-mix(in srgb,var(--fg) 9%,transparent)}
.fl-th.pic{background:none;box-shadow:0 1px 4px rgba(0,0,0,.28)}
.fl-th img{display:block;object-fit:contain}
.fl-th.pic img{width:100%;height:100%}
.fl-th.pic img{object-fit:cover}
.fl-tx{flex:1;min-width:0}
.fl-n{font:600 11px/1.15 "Inter",sans-serif;color:var(--sub);white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:clip}
.fl-s .fl-n{font-size:10px}
.fl-m .fl-n{font-size:12px;color:var(--fg);white-space:normal;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.fl-d{font:500 11px/1.2 "Inter",sans-serif;color:var(--sub);margin-top:3px;white-space:nowrap}
.fl-empty{flex:1;display:flex;align-items:center;justify-content:center;font:500 14px/1.2 "Inter",sans-serif;color:var(--sub)}
`;
document.head.appendChild(css);

const icon = (s: number) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><rect width="24" height="24" rx="5.6" fill="#fff"/><path d="M4.6 8.2a1.9 1.9 0 0 1 1.9-1.9h3.3l1.7 1.9h6a1.9 1.9 0 0 1 1.9 1.9v6.2a1.9 1.9 0 0 1-1.9 1.9H6.5a1.9 1.9 0 0 1-1.9-1.9Z" fill="${BLUE}"/></svg>`;

export default defineWidgets([
  { id: 'files-s', family: 'Files', group: 'files', size: 'S', name: 'Files', desc: 'Quick access to the four newest files in a folder you choose.', icon, fields: ['folder'], mount: files('S') },
  { id: 'files-m', family: 'Files', group: 'files', size: 'M', name: 'Files', desc: 'The four newest files in a folder you choose, with the date of each.', fields: ['folder'], mount: files('M') },
  { id: 'files-l', family: 'Files', group: 'files', size: 'L', name: 'Files', desc: 'The nine newest files in a folder you choose.', fields: ['folder'], mount: files('L') },
]);
