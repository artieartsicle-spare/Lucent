import { defineWidgets, type WidgetCfg, type WidgetSize } from './_api';
import { folderOf } from './_choices';
import { esc, native, type FileItem } from './_native';

const EDGE: Record<WidgetSize, number> = { S: 360, M: 720, L: 800, XL: 1400, XXL: 1400 };
const everyMs = (cfg?: WidgetCfg) => Math.min(3600, Math.max(3, cfg?.slide ?? 20)) * 1000;

const shuffle = <T,>(a: T[]) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const when = (sec: number) => new Date(sec * 1000).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });

const petals = (s: number) => {
  const cols = ['#ff453a', '#ff9f0a', '#ffd60a', '#30d158', '#64d2ff', '#0a84ff', '#bf5af2', '#ff375f'];
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><g style="mix-blend-mode:multiply">${cols
    .map((c, i) => `<ellipse cx="12" cy="7.3" rx="2.9" ry="4.4" fill="${c}" opacity=".85" transform="rotate(${i * 45} 12 12)"/>`)
    .join('')}</g></svg>`;
};

const photosIcon = (s: number) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><rect width="24" height="24" rx="5.6" fill="#fff"/><g transform="translate(3.6 3.6) scale(.7)">${petals(24).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g></svg>`;

function photos(size: WidgetSize) {
  return (root: HTMLElement, cfg?: WidgetCfg) => {
    const api = native();
    const album = folderOf('Photos', cfg?.folder);
    const wc = document.createElement('div');
    wc.className = `wc ph ix`;
    wc.style.cssText = 'padding:0;background:#1c1c1e;overflow:hidden;cursor:default';
    wc.innerHTML = `<img class="ph-i a" alt="" draggable="false"><img class="ph-i b" alt="" draggable="false"><div class="ph-shade"></div><div class="ph-cap"></div><div class="ph-msg"></div>`;
    root.appendChild(wc);
    const [A, B] = [wc.querySelector<HTMLImageElement>('.a')!, wc.querySelector<HTMLImageElement>('.b')!];
    const cap = wc.querySelector<HTMLElement>('.ph-cap')!;
    const msg = wc.querySelector<HTMLElement>('.ph-msg')!;
    const note = (t: string) => {
      msg.innerHTML = t ? `<div>${petals(36)}</div><div>${esc(t)}</div>` : '';
      msg.style.display = t ? 'flex' : 'none';
    };
    note('Loading photos…');

    let alive = true;
    let queue: FileItem[] = [];
    let at = -1;
    let front = A;
    let current: FileItem | null = null;
    const thumbs = new Map<string, string>();

    const thumb = async (f: FileItem) => {
      const hit = thumbs.get(f.path);
      if (hit) return hit;
      const u = await api.photoThumb!(f.path, EDGE[size]);
      thumbs.set(f.path, u);
      if (thumbs.size > 4) thumbs.delete(thumbs.keys().next().value as string);
      return u;
    };
    const next = async () => {
      if (!alive || !queue.length) return;
      for (let tries = 0; tries < 6 && alive; tries++) {
        at = (at + 1) % queue.length;
        const f = queue[at];
        try {
          const u = await thumb(f);
          if (!alive) return;
          const back = front === A ? B : A;
          back.src = u;
          await back.decode().catch(() => undefined);
          back.classList.add('on');
          front.classList.remove('on');
          front = back;
          current = f;
          cap.textContent = size === 'S' ? '' : when(f.mtime);
          note('');
          return;
        } catch {
          queue.splice(at, 1);
          at--;
          if (!queue.length) {
            note(`No pictures in ${album.label}`);
            return;
          }
        }
      }
    };

    const load = async () => {
      if (!api.photosList || !api.photoThumb) return note('Photos needs the desktop app');
      try {
        queue = shuffle((await api.photosList(album.id)).slice(0, 300));
      } catch {
        queue = [];
      }
      if (!alive) return;
      if (!queue.length) return note(`No pictures in ${album.label}`);
      await next();
    };
    void load();
    const t = setInterval(() => void next(), everyMs(cfg));
    const click = () => current && api.pathOpen?.(current.path);
    wc.addEventListener('click', click);
    return () => {
      alive = false;
      clearInterval(t);
      wc.removeEventListener('click', click);
      wc.remove();
    };
  };
}

const css = document.createElement('style');
css.textContent = `
.ph-i{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 1.2s ease;background:none}
.ph-i.on{opacity:1}
.ph-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 62%,rgba(0,0,0,.45) 100%);pointer-events:none}
.ph-cap{position:absolute;left:14px;bottom:11px;font:600 12.5px/1 "Inter",sans-serif;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,.5);pointer-events:none}
.ph-msg{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:14px;text-align:center;font:500 12.5px/1.3 "Inter",sans-serif;color:rgba(255,255,255,.62);background:linear-gradient(160deg,#2e2e31,#1a1a1c)}
`;
document.head.appendChild(css);

export default defineWidgets([
  { id: 'photos-s', family: 'Photos', group: 'photos', size: 'S', name: 'Photos', desc: 'A slideshow of pictures from a folder you choose, fading gently from one to the next.', icon: photosIcon, fields: ['folder', 'slide'], mount: photos('S') },
  { id: 'photos-m', family: 'Photos', group: 'photos', size: 'M', name: 'Photos', desc: 'A wider slideshow of pictures from a folder you choose, fading gently between them.', fields: ['folder', 'slide'], mount: photos('M') },
  { id: 'photos-l', family: 'Photos', group: 'photos', size: 'L', name: 'Photos', desc: 'A large slideshow of pictures from a folder you choose, fading gently between them.', fields: ['folder', 'slide'], mount: photos('L') },
]);
