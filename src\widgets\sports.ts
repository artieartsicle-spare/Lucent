import { defineWidgets, type WidgetCfg, type WidgetSize } from './_api';
import { sportOf } from './_choices';
import { esc, native } from './_native';
import { wireLinks } from './_stocks';

const KEY = 'lucent-sports-v1:';
const GREEN = '#30d158';

type Team = { abbr: string; name: string; logo?: string; score: string; winner: boolean };
type Game = { id: string; at: number; state: 'pre' | 'in' | 'post'; status: string; away: Team; home: Team; link?: string };
type Status = 'loading' | 'ok' | 'failed';
type Feed = { games: Game[]; status: Status; pending: Promise<void> | null; fetched: number };
const feeds = new Map<string, Feed>();

function feedOf(id: string): Feed {
  let f = feeds.get(id);
  if (!f) {
    let games: Game[] = [];
    try {
      const d = JSON.parse(localStorage.getItem(KEY + id) || '[]');
      if (Array.isArray(d)) games = d as Game[];
    } catch {
    }
    f = { games, status: games.length ? 'ok' : 'loading', pending: null, fetched: 0 };
    feeds.set(id, f);
  }
  return f;
}

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/';
const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const getText = async (url: string) => {
  const a = native();
  if (a.httpGet) return a.httpGet(url);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
};

const clock = (ms: number) => {
  const d = new Date(ms);
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return t;
  const tomorrow = new Date(now.getTime() + 86_400_000);
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${t}`;
  return `${d.toLocaleDateString([], { weekday: 'short' })} ${t}`;
};

export function parseBoard(text: string): Game[] {
  const j = JSON.parse(text);
  const out: Game[] = [];
  for (const ev of (j?.events ?? []) as any[]) {
    const comp = ev?.competitions?.[0];
    const cs = (comp?.competitors ?? []) as any[];
    const home = cs.find((c) => c.homeAway === 'home');
    const away = cs.find((c) => c.homeAway === 'away');
    if (!home || !away) continue;
    const t = ev?.status?.type ?? comp?.status?.type ?? {};
    const state: Game['state'] = t.state === 'in' ? 'in' : t.state === 'post' ? 'post' : 'pre';
    const at = Date.parse(ev.date) || 0;
    const team = (c: any): Team => ({
      abbr: String(c.team?.abbreviation || c.team?.shortDisplayName || '?').slice(0, 5),
      name: String(c.team?.shortDisplayName || c.team?.displayName || c.team?.abbreviation || ''),
      logo: typeof c.team?.logo === 'string' && c.team.logo.startsWith('https://') ? c.team.logo : undefined,
      score: c.score === undefined || c.score === null || c.score === '' ? '' : String(c.score?.displayValue ?? c.score),
      winner: !!c.winner,
    });
    const link = (ev.links as any[] | undefined)?.find((l) => Array.isArray(l.rel) && l.rel.includes('summary'))?.href ?? ev.links?.[0]?.href;
    out.push({
      id: String(ev.id ?? `${at}`),
      at,
      state,
      status: state === 'pre' ? clock(at) : String(t.shortDetail || t.detail || (state === 'post' ? 'Final' : 'Live')),
      away: team(away),
      home: team(home),
      link: typeof link === 'string' && link.startsWith('https://') ? link : undefined,
    });
  }
  const rank = { in: 0, pre: 1, post: 2 } as const;
  return out.sort((a, b) => rank[a.state] - rank[b.state] || (a.state === 'post' ? b.at - a.at : a.at - b.at));
}

function refresh(id: string): Promise<void> {
  const f = feedOf(id);
  if (f.pending) return f.pending;
  const url = `${BASE}${sportOf(id).path}/scoreboard`;
  f.pending = (async () => {
    try {
      let games = parseBoard(await getText(url));
      if (!games.length) {
        const to = new Date(Date.now() + 14 * 86_400_000);
        games = parseBoard(await getText(`${url}?dates=${ymd(new Date())}-${ymd(to)}`)).filter((g) => g.state !== 'post');
      }
      f.games = games.slice(0, 12);
      f.status = 'ok';
      try {
        localStorage.setItem(KEY + id, JSON.stringify(f.games));
      } catch {
      }
    } catch {
      f.status = f.games.length ? 'ok' : 'failed';
    } finally {
      f.fetched = Date.now();
      f.pending = null;
    }
  })();
  return f.pending;
}

const MSG: Record<Status, string> = { loading: 'Loading scores…', ok: 'No games scheduled', failed: 'Scores aren’t available right now' };

const logo = (t: Team, s: number) =>
  `<span class="sp-lg" style="width:${s}px;height:${s}px">${t.logo ? `<img src="${esc(t.logo)}" alt="" referrerpolicy="no-referrer" draggable="false" onerror="this.remove()">` : ''}<i>${esc(t.abbr[0] ?? '?')}</i></span>`;
const head = (label: string) => `<div class="sp-h"><span>${esc(label)}</span>${ball(15)}</div>`;
const link = (g: Game) => (g.link ? ` ix" data-link="${esc(g.link)}"` : '"');

const half = (t: Team, g: Game, s: number, right: boolean) => {
  const lost = g.state === 'post' && !t.winner;
  const sc = g.state === 'pre' ? '' : `<span class="sc">${esc(t.score)}</span>`;
  return `<div class="sp-b ${right ? 'r' : 'l'}${lost ? ' lost' : ''}"><div class="sp-lr">${right ? sc + logo(t, s) : logo(t, s) + sc}</div><b>${esc(t.abbr)}</b></div>`;
};
const stat = (g: Game) => `<div class="sp-st${g.state === 'in' ? ' live' : ''}">${g.state === 'in' ? '<s></s>' : ''}<span>${esc(g.status)}</span></div>`;
const game = (g: Game, s: number, under = false) =>
  `<div class="sp-g${link(g)}>${half(g.away, g, s, false)}${under && g.state !== 'pre' ? '<div></div>' : stat(g)}${half(g.home, g, s, true)}${under && g.state !== 'pre' ? `<div class="sp-under">${stat(g)}</div>` : ''}</div>`;

const LAYOUT: Record<'S' | 'M' | 'L', (g: Game[], label: string) => string> = {
  S: (games, label) => `${head(label)}<div class="sp-one">${game(games[0], 28, true)}</div>`,
  M: (games, label) => `${head(label)}<div class="sp-list">${games.slice(0, 2).map((g) => game(g, 28)).join('')}</div>`,
  L: (games, label) => `${head(label)}<div class="sp-list">${games.slice(0, 5).map((g) => game(g, 28)).join('')}</div>`,
};

function sports(size: WidgetSize) {
  return (root: HTMLElement, cfg?: WidgetCfg) => {
    const id = sportOf(cfg?.sport).id;
    const label = sportOf(id).short;
    const feed = feedOf(id);
    const wc = document.createElement('div');
    wc.className = `wc solid lt sp sp-${size.toLowerCase()}`;
    root.appendChild(wc);
    const draw = () => {
      wc.innerHTML = feed.games.length ? LAYOUT[size as 'S' | 'M' | 'L'](feed.games, label) : `<div class="sp-msg">${esc(MSG[feed.status])}</div>`;
    };
    draw();
    const go = () => void refresh(id).then(draw);
    go();
    const t = setInterval(() => {
      const live = feed.games.some((g) => g.state === 'in');
      const wait = !feed.games.length && feed.status !== 'ok' ? 2 * 60_000 : live ? 60_000 : 5 * 60_000;
      if (Date.now() - feed.fetched > wait) go();
    }, 15_000);
    const off = wireLinks(wc);
    return () => {
      clearInterval(t);
      off();
      wc.remove();
    };
  };
}

const css = document.createElement('style');
css.textContent = `
.sp{display:flex;flex-direction:column;padding:13px 16px 8px;font-family:"Inter",sans-serif;color:var(--w-ink,#fff)}
.sp-s{padding:13px 12px 10px}
.sp-h{flex:none;display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;font:700 12px/1 "Inter",sans-serif;letter-spacing:.04em;text-transform:uppercase;color:var(--w-ink2,rgba(255,255,255,.62));white-space:nowrap}
.sp-h span{overflow:hidden;text-overflow:ellipsis}
.sp-list{flex:1;min-height:0;display:flex;flex-direction:column}
.sp-one{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center}
.sp-g{flex:1;min-height:0;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;column-gap:6px;border-top:1px solid var(--w-line,rgba(255,255,255,.14))}
.sp-g:first-child{border-top:0}
.sp-s .sp-g{flex:none;row-gap:7px;border:0}
.sp-b{min-width:0;display:flex;flex-direction:column;gap:3px}
.sp-b.l{align-items:flex-start}.sp-b.r{align-items:flex-end}
.sp-lr{display:flex;align-items:center;gap:7px}
.sp-b b{font:600 11px/1 "Inter",sans-serif;letter-spacing:.01em;color:var(--w-ink-hi,rgba(255,255,255,.7))}
.sp-b .sc{font:700 24px/1 "Inter",sans-serif;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.sp-s .sp-b .sc{font-size:22px}.sp-s .sp-lr{gap:5px}
.sp-b.lost .sc,.sp-b.lost b{color:var(--w-ink3,rgba(255,255,255,.45))}
.sp-lg{position:relative;flex:none;display:inline-flex;align-items:center;justify-content:center}
.sp-lg i{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;border-radius:50%;background:var(--w-ink-soft,rgba(255,255,255,.12));font:700 11px/1 "Inter",sans-serif;font-style:normal;color:var(--w-ink-hi,rgba(255,255,255,.75))}
.sp-lg img{position:relative;z-index:1;width:100%;height:100%;object-fit:contain;background:none}
.sp-st{display:flex;align-items:center;justify-content:center;gap:5px;text-align:center;font:600 12.5px/1.15 "Inter",sans-serif;color:var(--w-ink,#fff);max-width:96px}
.sp-st.live s{flex:none}
.sp-under{grid-column:1/-1;display:flex;justify-content:center}
.sp-st s{width:6px;height:6px;border-radius:50%;background:var(--w-ok,${GREEN});box-shadow:0 0 0 0 rgba(48,209,88,.6);animation:sp-pulse 1.6s infinite}
@keyframes sp-pulse{70%{box-shadow:0 0 0 6px rgba(48,209,88,0)}100%{box-shadow:0 0 0 0 rgba(48,209,88,0)}}
.sp-msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;text-align:center;font:500 12.5px/1.3 "Inter",sans-serif;color:var(--w-ink2,rgba(255,255,255,.5))}
.widget:is([data-wstyle="frosted"],[data-wstyle="dark"]) .sp-lg img{filter:grayscale(1) brightness(1.4)}
`;
document.head.appendChild(css);

function ball(s: number) {
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3.4 9.2c4.4.8 7.6 3.6 8.6 8.8M20.6 9.2c-4.4.8-7.6 3.6-8.6 8.8M12 3v18"/></svg>`;
}
const icon = (s: number) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><defs><linearGradient id="spg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3a3f"/><stop offset="1" stop-color="#0c0c0d"/></linearGradient></defs><rect width="24" height="24" rx="5.6" fill="url(#spg)"/><g fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="6.4"/><path d="M5.9 10.4c2.6.5 4.7 2.1 5.4 5.4M18.1 10.4c-2.6.5-4.7 2.1-5.4 5.4M12 5.6v12.8"/></g></svg>`;

export default defineWidgets([
  { id: 'sports-s', family: 'Sports', group: 'sports', size: 'S', name: 'Sports', desc: 'The live score of a game in the league you choose.', icon, fields: ['sport'], mount: sports('S') },
  { id: 'sports-m', family: 'Sports', group: 'sports', size: 'M', name: 'Sports', desc: 'Two games with live scores from your league.', fields: ['sport'], mount: sports('M') },
  { id: 'sports-l', family: 'Sports', group: 'sports', size: 'L', name: 'Sports', desc: 'Scores and start times for your league’s games.', fields: ['sport'], mount: sports('L') },
]);
