import { newsMark, NEWS_WHITE } from './_brand';
import { defineWidgets, type WidgetCfg, type WidgetSize } from './_api';
import { esc, newsPlan, wireLinks, type News } from './_stocks';
import { loadFeed } from './_rss';
import { loadGoogle } from './_gnews';
import { loadBing } from './_bnews';
import { native } from './_native';

const PINK = '#ff375f';
const KEY = 'lucent-news-v5:';
const KEEP = 14;

type Plan = ReturnType<typeof newsPlan>;
type Status = 'loading' | 'ok' | 'empty' | 'failed';
type Feed = { stories: News[]; status: Status; pending: Promise<void> | null; fetched: number; label?: string; redraw: Set<() => void> };
const feeds = new Map<string, Feed>();


const PIC_KEY = 'lucent-news-pics-v1';
const PIC_TRY = 12;
const PIC_RETRY = 6 * 3600_000;
type PicMemo = Record<string, { u: string; t: number }>;
let pics: PicMemo | null = null;
const picMemo = (): PicMemo => {
  if (!pics) {
    try {
      pics = JSON.parse(localStorage.getItem(PIC_KEY) || '{}') as PicMemo;
    } catch {
      pics = {};
    }
  }
  return pics;
};
const savePics = () => {
  const m = picMemo();
  const keep = Object.entries(m).sort((a, b) => b[1].t - a[1].t).slice(0, 160);
  pics = Object.fromEntries(keep);
  try {
    localStorage.setItem(PIC_KEY, JSON.stringify(pics));
  } catch {
  }
};
const lookable = (n: News) => !n.thumb && /^https:\/\//i.test(n.link) && !/(^|\.)(news\.google|bing)\.com\//i.test(n.link.replace(/^https:\/\//i, ''));
function applyPics(list: News[]): boolean {
  let changed = false;
  for (const n of list) {
    const m = picMemo()[n.link];
    if (!n.thumb && m?.u) {
      n.thumb = n.big = m.u;
      changed = true;
    }
  }
  return changed;
}
async function fillPics(f: Feed, key: string) {
  const a = native();
  if (!a.pageImage) return;
  const todo = f.stories.slice(0, PIC_TRY).filter((n) => lookable(n) && !(picMemo()[n.link] && (picMemo()[n.link].u || Date.now() - picMemo()[n.link].t < PIC_RETRY)));
  let found = false;
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const n = todo[next++];
      let u = '';
      try {
        u = (await a.pageImage!(n.link)) || '';
      } catch {
      }
      picMemo()[n.link] = { u, t: Date.now() };
      if (u) {
        n.thumb = n.big = u;
        found = true;
        f.redraw.forEach((fn) => fn());
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  savePics();
  if (found) {
    try {
      localStorage.setItem(KEY + key, JSON.stringify(f.stories));
    } catch {
    }
  }
}

function feedOf(key: string): Feed {
  let f = feeds.get(key);
  if (!f) {
    let stories: News[] = [];
    try {
      const d = JSON.parse(localStorage.getItem(KEY + key) || '[]');
      if (Array.isArray(d)) stories = d as News[];
    } catch {
    }
    f = { stories, status: stories.length ? 'ok' : 'loading', pending: null, fetched: 0, redraw: new Set() };
    feeds.set(key, f);
  }
  return f;
}

function mix(all: News[]): News[] {
  const left = [...all];
  const out: News[] = [];
  while (left.length) {
    const last = out[out.length - 1]?.publisher;
    const i = left.findIndex((n) => n.publisher !== last);
    out.push(...left.splice(i < 0 ? 0 : i, 1));
  }
  return out;
}

const sig = (t: string) => t.toLowerCase().replace(/[^a-z0-9\u00c0-\uffff]+/g, ' ').trim().slice(0, 48);

type Got = { items: News[]; title?: string };
async function fetchSrc(plan: Plan, s: Plan['srcs'][number]): Promise<Got> {
  if (s.kind === 'feed') {
    const x = await loadFeed(s.arg);
    return { items: x.items.slice(0, 10), title: x.title };
  }
  let items: News[];
  try {
    items = await loadBing(s, plan.region, plan.every);
  } catch {
    items = await loadGoogle(s, plan.region, plan.every);
  }
  return { items: s.kind === 'search' || s.kind === 'geo' ? [...items].sort((a, b) => b.at - a.at) : items };
}

function refresh(plan: Plan): Promise<void> {
  const f = feedOf(plan.key);
  if (f.pending) return f.pending;
  f.pending = Promise.allSettled(plan.srcs.map((s) => fetchSrc(plan, s)))
    .then((res) => {
      const ok = res.filter((r): r is PromiseFulfilledResult<Got> => r.status === 'fulfilled').map((r) => r.value);
      f.fetched = Date.now();
      if (!ok.length) {
        f.status = f.stories.length ? 'ok' : 'failed';
        return;
      }
      const per = Math.ceil(KEEP / ok.length) + 2;
      const lists = ok.map((g) => g.items.filter((n) => !plan.publisher || n.publisher.toLowerCase().includes(plan.publisher)).slice(0, plan.publisher ? 40 : per));
      let all: News[] = [];
      for (let i = 0; i < Math.max(...lists.map((l) => l.length)); i++) lists.forEach((l) => l[i] && all.push(l[i]));
      if (plan.srcs.every((s) => s.kind === 'feed') && plan.srcs.length > 1) all.sort((a, b) => b.at - a.at);
      const seen = new Set<string>();
      all = all.filter((n) => {
        const k = sig(n.title);
        if (seen.has(n.link) || seen.has(k)) return false;
        seen.add(n.link);
        seen.add(k);
        return true;
      });
      f.label = plan.feeds.length === 1 ? ok[0]?.title : undefined;
      if (!all.length) {
        f.stories = [];
        f.status = 'empty';
        return;
      }
      f.stories = mix(all).slice(0, KEEP);
      applyPics(f.stories);
      f.status = 'ok';
      void fillPics(f, plan.key);
      try {
        localStorage.setItem(KEY + plan.key, JSON.stringify(f.stories));
      } catch {
      }
    })
    .finally(() => {
      f.pending = null;
    });
  return f.pending;
}

function age(at: number): string {
  if (!at) return '';
  const s = Math.max(0, Date.now() / 1000 - at);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

const fav = (n: News) =>
  `<span class="nw-fav"><b>${esc((n.publisher[0] || 'N').toUpperCase())}</b>${
    n.domain ? `<img src="https://www.google.com/s2/favicons?domain=${esc(n.domain)}&sz=64" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''
  }</span>`;
const meta = (n: News, tag: boolean, time = true) =>
  `<div class="nw-meta">${fav(n)}<span class="nw-pub">${esc(n.publisher || 'News')}</span>${time && n.at ? `<span class="nw-ago">${age(n.at)}</span>` : ''}${
    tag && n.tag ? `<span class="nw-tag">${esc(n.tag)}</span>` : ''
  }</div>`;
const pic = (n: News) => (n.thumb ? `<img class="nw-pic" src="${esc(n.thumb)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : '');
const row = (tag: boolean) => (n: News) =>
  `<div class="nw-r ix" data-link="${esc(n.link)}"><div class="nw-tx">${meta(n, tag)}<div class="nw-hd">${esc(n.title)}</div></div>${pic(n)}</div>`;
const head = (label: string) => `<div class="nw-sec"><div class="nw-h">${esc(label)}</div><div class="nw-logo">${newsMark(false)}</div></div>`;
const withPics = (list: News[]) => [...list].sort((a, b) => Number(!!b.thumb) - Number(!!a.thumb));

type Layout = (list: News[], label: string, tag: boolean) => string;
const LAYOUT: Record<'S' | 'M', Layout> = {
  S: (list, _l, tag) => {
    const n = list.find((x) => x.big || x.thumb) ?? list[0];
    if (!n) return '';
    const photo = n.big || n.thumb;
    const h = hue(n.publisher);
    const bg = photo ? `background:#2a2a2e url('${esc(photo)}') center/cover no-repeat` : `background:linear-gradient(155deg,hsl(${h} 34% 30%),hsl(${(h + 24) % 360} 38% 13%))`;
    return `<div class="nw-hero ix${photo ? '' : ' nw-nopic'}" data-link="${esc(n.link)}" style="${bg}">
      ${photo ? '<div class="nw-shade"></div>' : ''}
      <div class="nw-logo abs">${newsMark(true)}</div>
      <div class="nw-top">${meta(n, false, false)}</div>
      <div class="nw-cap"><div class="nw-hd">${esc(n.title)}</div><div class="nw-foot">${[age(n.at), tag ? n.tag : ''].filter((x): x is string => !!x).map(esc).join(' · ')}</div></div></div>`;
  },
  M: (list, label, tag) => (list.length ? `${head(label)}<div class="nw-rows">${withPics(list).slice(0, 2).map(row(tag)).join('')}</div>` : ''),
};

const MSG = (plan: Plan): Record<Status, string> => ({
  loading: 'Loading news…',
  ok: 'Loading news…',
  empty: plan.personal ? 'No recent stories for your interests' : 'No stories match these settings',
  failed: 'News isn’t available right now',
});

function news(size: 'S' | 'M') {
  return (root: HTMLElement, cfg?: WidgetCfg) => {
    const plan = newsPlan(cfg?.news);
    const feed = feedOf(plan.key);
    const wc = document.createElement('div');
    wc.className = `wc solid nw nw-${size.toLowerCase()}`;
    root.appendChild(wc);
    const draw = () => {
      const html = LAYOUT[size](feed.stories, feed.label || plan.label, plan.personal);
      wc.innerHTML = html || `<div class="nw-msg">${MSG(plan)[feed.status]}</div>`;
    };
    draw();
    feed.redraw.add(draw);
    const go = () => void refresh(plan).then(draw);
    go();
    const t = setInterval(() => Date.now() - feed.fetched > (feed.stories.length ? plan.every * 60_000 : 2 * 60_000) && go(), 30_000);
    const tick = setInterval(draw, 60_000);
    const off = wireLinks(wc);
    return () => {
      clearInterval(t);
      clearInterval(tick);
      feed.redraw.delete(draw);
      off();
      wc.remove();
    };
  };
}

const css = document.createElement('style');
css.textContent = `
.nw{display:flex;flex-direction:column;padding:14px 14px 10px;font-family:"Inter",sans-serif;color:#fff}
.nw-s{padding:0;overflow:hidden}
.nw-sec{flex:none;display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;font:700 15px/1 "Inter",sans-serif;color:${PINK}}
.nw-logo{display:flex}
.nw-logo.abs{position:absolute;right:15px;top:14px;z-index:2;filter:drop-shadow(0 1px 3px rgba(0,0,0,.35))}
.nw-rows{flex:1;display:flex;flex-direction:column;min-height:0}
.nw-r{flex:1;min-height:0;display:flex;align-items:center;cursor:pointer}
.nw-r+.nw-r{border-top:1px solid rgba(255,255,255,.12)}
.nw-tx{flex:1;min-width:0}
.nw-meta{display:flex;align-items:center;gap:5px;margin-bottom:4px;min-width:0;font:600 10px/1 "Inter",sans-serif;color:rgba(255,255,255,.62);white-space:nowrap}
.nw-pub{min-width:0;overflow:hidden;text-overflow:ellipsis;font:700 10px/1 Georgia,"Times New Roman",serif;letter-spacing:.05em;text-transform:uppercase}
.nw-ago{flex:none;opacity:.85}
.nw-ago::before{content:"· ";opacity:.7}
.nw-tag{flex:none;margin-left:auto;max-width:44%;overflow:hidden;text-overflow:ellipsis;padding:2px 6px;border-radius:99px;background:rgba(255,255,255,.14);font:600 9px/1.25 "Inter",sans-serif;letter-spacing:.01em;color:rgba(255,255,255,.85)}
.nw-fav{position:relative;flex:none;width:12px;height:12px;border-radius:3px;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;background:rgba(255,255,255,.22);font:800 8px/1 "Inter",sans-serif;color:#fff}
.nw-fav img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#fff}
.nw-hd{font:600 13.5px/1.22 "Inter",sans-serif;letter-spacing:-.005em;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
.nw-hero{position:absolute;inset:0;cursor:pointer;background:#3a3a3e}
.nw-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.42) 0%,rgba(0,0,0,.12) 32%,rgba(0,0,0,.62) 62%,rgba(0,0,0,.9) 100%)}
.nw-pic{flex:none;width:52px;height:52px;margin-left:12px;border-radius:9px;object-fit:cover;background:rgba(255,255,255,.1)}
.nw-top{position:absolute;left:14px;right:42px;top:15px;z-index:1}
.nw-top .nw-meta{margin:0}
.nw-cap{position:absolute;left:14px;right:14px;bottom:13px;z-index:1;text-align:left}
.nw-cap .nw-hd{font-size:15px;font-weight:700;line-height:1.2;-webkit-line-clamp:5;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.5)}
.nw-foot{margin-top:6px;font:600 10px/1 "Inter",sans-serif;color:rgba(255,255,255,.68)}
.widget:is([data-wstyle="frosted"],[data-wstyle="dark"]) .nw-hero.nw-nopic{background:none !important}
.widget:is([data-wstyle="frosted"],[data-wstyle="dark"]) .wmount:has(.nw){filter:none}
.widget:is([data-wstyle="frosted"],[data-wstyle="dark"]) .nw-sec{color:rgba(255,255,255,.82)}
.widget:is([data-wstyle="frosted"],[data-wstyle="dark"]) .nw-pub{color:rgba(255,255,255,.75)}
.widget:is([data-wstyle="frosted"],[data-wstyle="dark"]) .nw .brand{filter:brightness(0) invert(1);opacity:1}
.widget[data-wstyle="frosted"] :is(.nw-sec,.nw-meta,.nw-hd,.nw-foot){text-shadow:0 1px 3px rgba(0,0,0,.32)}
.widget[data-wstyle="frosted"] .nw .brand{filter:brightness(0) invert(1) drop-shadow(0 1px 2px rgba(0,0,0,.35))}
.widget[data-wstyle="light"] .wmount .wc.solid.nw:not(.nw-s){background:#fff !important;filter:none;color:#1c1c1e}
.widget[data-wstyle="light"] .nw:not(.nw-s) .nw-sec{color:${PINK}}
.widget[data-wstyle="light"] .nw:not(.nw-s) .nw-meta{color:rgba(60,60,67,.62)}
.widget[data-wstyle="light"] .nw:not(.nw-s) .nw-pub{color:rgba(60,60,67,.72)}
.widget[data-wstyle="light"] .nw:not(.nw-s) .nw-hd{color:#1c1c1e}
.widget[data-wstyle="light"] .nw:not(.nw-s) .nw-r+.nw-r{border-top-color:rgba(60,60,67,.14)}
.widget[data-wstyle="light"] .nw:not(.nw-s) .nw-tag{background:rgba(60,60,67,.09);color:rgba(60,60,67,.8)}
.widget[data-wstyle="light"] .nw:not(.nw-s) .nw-fav{background:rgba(60,60,67,.14);color:rgba(60,60,67,.8)}
.widget[data-wstyle="light"] .nw:not(.nw-s) .nw-pic{background:rgba(60,60,67,.08)}
.widget[data-wstyle="light"] .nw:not(.nw-s) .nw-msg{color:rgba(60,60,67,.6)}
.nw-msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;text-align:center;font:500 12.5px/1.3 "Inter",sans-serif;color:rgba(255,255,255,.5)}
`;
document.head.appendChild(css);

const icon = (s: number) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><defs><linearGradient id="ng" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff5d77"/><stop offset="1" stop-color="${PINK}"/></linearGradient></defs><rect width="24" height="24" rx="5.6" fill="url(#ng)"/><image href="${NEWS_WHITE}" x="5.2" y="5.2" width="13.6" height="13.6"/></svg>`;

const def = (size: WidgetSize, desc: string, withIcon = false) => ({
  id: `news-${size.toLowerCase()}`,
  family: 'News',
  group: 'news',
  size,
  name: 'News',
  desc,
  ...(withIcon ? { icon } : {}),
  fields: ['news' as const],
  mount: news(size as 'S' | 'M'),
});

export default defineWidgets([
  def('S', 'The top headline for your interests.', true),
  def('M', 'Two headlines picked from your interests, a topic or your city.', false),
]);
