import { $ } from './_shared';

export type Quote = {
  sym: string;
  name: string;
  price: number;
  prev: number;
  open: number;
  high: number;
  low: number;
  vol: number;
  hi52: number;
  lo52: number;
  series: number[];
  times: number[];
  tz: number;
  currency: string;
};
export type News = { title: string; publisher: string; link: string; thumb?: string; big?: string; at: number; domain?: string; tag?: string };

export const DEFAULT_SYMBOLS = ['AAPL', 'MSFT', 'GOOG', 'AMD', 'NVDA', 'TSLA'];
export const DEFAULT_COINS = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'DOGE-USD', 'ADA-USD'];
export const isCoin = (s: string) => /^[A-Z0-9.]{1,12}-[A-Z]{3,4}$/.test(s);
export const coinsOf = (cfg: { symbols?: string[] } | undefined, n: number) => {
  const own = (cfg?.symbols ?? []).map((s) => s.trim().toUpperCase());
  return Array.from({ length: n }, (_, i) => (isCoin(own[i] ?? '') ? own[i] : DEFAULT_COINS[i % DEFAULT_COINS.length]));
};
export const fit = (text: string, width: number, max: number) => Math.max(14, Math.min(max, Math.floor(width / (Math.max(text.length, 1) * 0.6))));
export const symbolsOf = (cfg: { symbols?: string[] } | undefined, n: number) => {
  const own = (cfg?.symbols ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(own[i] || DEFAULT_SYMBOLS[i % DEFAULT_SYMBOLS.length]);
  return out;
};

type Api = { httpGet?: (url: string) => Promise<string>; openUrl?: (url: string) => void };
const api = () => (window as unknown as { overlayAPI?: Api }).overlayAPI;
const fetchText = async (url: string): Promise<string> => {
  const hook = (window as unknown as { __stocksFetch?: (u: string) => Promise<string> }).__stocksFetch;
  if (hook) return hook(url);
  const a = api();
  if (a?.httpGet) return a.httpGet(url);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
};
export const openLink = (url: string) => {
  if (/^https:\/\//.test(url)) api()?.openUrl?.(url);
};

const HOST = 'https://query1.finance.yahoo.com';
const num = (v: unknown, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);

export function parseChart(text: string, sym: string): Quote {
  const j = JSON.parse(text);
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error(j?.chart?.error?.description || 'no data');
  const m = r.meta ?? {};
  const q = r.indicators?.quote?.[0] ?? {};
  const ts: number[] = r.timestamp ?? [];
  const closes: (number | null)[] = q.close ?? [];
  const opens: (number | null)[] = q.open ?? [];
  const series: number[] = [];
  const times: number[] = [];
  closes.forEach((c, i) => {
    if (typeof c === 'number' && isFinite(c)) {
      series.push(c);
      times.push(ts[i]);
    }
  });
  const price = num(m.regularMarketPrice, series[series.length - 1] ?? 0);
  const prev = num(m.chartPreviousClose, num(m.previousClose, series[0] ?? price));
  const firstOpen = opens.find((o): o is number => typeof o === 'number');
  return {
    sym: String(m.symbol || sym).toUpperCase(),
    name: m.longName || m.shortName || sym,
    price,
    prev,
    open: num(firstOpen, price),
    high: num(m.regularMarketDayHigh, series.length ? Math.max(...series) : price),
    low: num(m.regularMarketDayLow, series.length ? Math.min(...series) : price),
    vol: num(m.regularMarketVolume),
    hi52: num(m.fiftyTwoWeekHigh, price),
    lo52: num(m.fiftyTwoWeekLow, price),
    series: series.length > 1 ? series : [prev, price],
    times: times.length > 1 ? times : [0, 1],
    tz: num(m.gmtoffset),
    currency: m.currency || 'USD',
  };
}

export function parseNews(text: string): News[] {
  const j = JSON.parse(text);
  return ((j?.news ?? []) as any[])
    .filter((n) => n?.title && n?.link)
    .map((n) => {
      const res = (n.thumbnail?.resolutions ?? []) as { url: string; width: number }[];
      const pick = res.filter((x) => x.width >= 100).sort((a, b) => a.width - b.width)[0] ?? res[res.length - 1];
      return {
        title: String(n.title),
        publisher: String(n.publisher || ''),
        link: String(n.link),
        thumb: pick?.url,
        big: [...res].sort((a, b) => b.width - a.width)[0]?.url,
        at: num(n.providerPublishTime),
      };
    });
}

const TTL = 60_000;
const quotes = new Map<string, { at: number; p: Promise<Quote> }>();
const newsC = new Map<string, { at: number; p: Promise<News[]> }>();
const KEY = 'lucent-stocks-v1';
const store = (k: string, v: unknown) => {
  try {
    localStorage.setItem(`${KEY}:${k}`, JSON.stringify(v));
  } catch {
  }
};
const restore = <T>(k: string): T | null => {
  try {
    return JSON.parse(localStorage.getItem(`${KEY}:${k}`) || 'null') as T | null;
  } catch {
    return null;
  }
};

export const lastQuote = (sym: string) => restore<Quote>(`q:${sym}`);
export function getQuote(sym: string): Promise<Quote> {
  const c = quotes.get(sym);
  if (c && Date.now() - c.at < TTL) return c.p;
  const p = fetchText(`${HOST}/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=5m&includePrePost=false`)
    .then((t) => parseChart(t, sym))
    .then((q) => (store(`q:${sym}`, q), q))
    .catch((e) => {
      quotes.delete(sym);
      throw e;
    });
  quotes.set(sym, { at: Date.now(), p });
  return p;
}
export function getNews(sym: string, count = 4, ttlMin = 10): Promise<News[]> {
  const key = `${sym}:${count}`;
  const c = newsC.get(key);
  if (c && Date.now() - c.at < ttlMin * 60_000) return c.p;
  const p = fetchText(`${HOST}/v1/finance/search?q=${encodeURIComponent(sym)}&quotesCount=0&newsCount=${count + 2}&enableFuzzyQuery=false`)
    .then((t) => parseNews(t).slice(0, count))
    .then((n) => (store(`n:${sym}`, n), n))
    .catch((e) => {
      newsC.delete(key);
      throw e;
    });
  newsC.set(key, { at: Date.now(), p });
  return p;
}
export const lastNews = (sym: string) => restore<News[]>(`n:${sym}`);

export type NewsCfgLike = { topic?: string; query?: string; local?: string; region?: string; publisher?: string; every?: number; feeds?: string };
export const feedUrls = (raw?: string) => (raw ?? '').split(/[\s,;]+/).filter((u) => /^https:\/\/[^\s/]+/i.test(u)).slice(0, 8);
export type NewsSrc = { kind: 'top' | 'section' | 'search' | 'geo' | 'feed'; arg: string; tag?: string };
const F = (...urls: string[]): NewsSrc[] => urls.map((arg) => ({ kind: 'feed' as const, arg }));
export const NEWS_TOPICS: { id: string; label: string; src: NewsSrc; more?: NewsSrc[] }[] = [
  { id: 'top', label: 'Top Stories', src: { kind: 'top', arg: '' } },
  { id: 'world', label: 'World', src: { kind: 'section', arg: 'WORLD' } },
  { id: 'nation', label: 'Nation', src: { kind: 'section', arg: 'NATION' } },
  { id: 'business', label: 'Business', src: { kind: 'section', arg: 'BUSINESS' } },
  { id: 'markets', label: 'Markets', src: { kind: 'search', arg: 'stock market OR earnings OR "Federal Reserve"' } },
  { id: 'tech', label: 'Technology', src: { kind: 'section', arg: 'TECHNOLOGY' } },
  { id: 'crypto', label: 'Crypto', src: { kind: 'search', arg: 'bitcoin OR ethereum OR crypto' } },
  { id: 'sports', label: 'Sports', src: { kind: 'section', arg: 'SPORTS' } },
  { id: 'science', label: 'Science', src: { kind: 'section', arg: 'SCIENCE' } },
  { id: 'entertainment', label: 'Entertainment', src: { kind: 'section', arg: 'ENTERTAINMENT' } },
  { id: 'health', label: 'Health', src: { kind: 'section', arg: 'HEALTH' } },
  { id: 'g-hard', label: 'Hard News', src: F('https://feeds.bbci.co.uk/news/rss.xml', 'https://feeds.npr.org/1001/rss.xml', 'https://www.theguardian.com/world/rss', 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml')[0], more: F('https://feeds.bbci.co.uk/news/rss.xml', 'https://feeds.npr.org/1001/rss.xml', 'https://www.theguardian.com/world/rss', 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml').slice(1) },
  { id: 'g-invest', label: 'Investigative', src: F('https://feeds.propublica.org/propublica/main', 'https://www.themarshallproject.org/rss/recent.rss', 'https://www.bellingcat.com/feed/', 'https://www.icij.org/feed/')[0], more: F('https://feeds.propublica.org/propublica/main', 'https://www.themarshallproject.org/rss/recent.rss', 'https://www.bellingcat.com/feed/', 'https://www.icij.org/feed/').slice(1) },
  { id: 'g-feature', label: 'Features & Long Reads', src: F('https://www.theguardian.com/news/series/the-long-read/rss', 'https://www.theatlantic.com/feed/all/', 'https://www.newyorker.com/feed/everything', 'https://www.wired.com/feed/rss')[0], more: F('https://www.theguardian.com/news/series/the-long-read/rss', 'https://www.theatlantic.com/feed/all/', 'https://www.newyorker.com/feed/everything', 'https://www.wired.com/feed/rss').slice(1) },
  { id: 'g-politics', label: 'Politics & Government', src: F('https://feeds.bbci.co.uk/news/politics/rss.xml', 'https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml', 'https://www.theguardian.com/politics/rss', 'https://feeds.npr.org/1014/rss.xml')[0], more: F('https://feeds.bbci.co.uk/news/politics/rss.xml', 'https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml', 'https://www.theguardian.com/politics/rss', 'https://feeds.npr.org/1014/rss.xml').slice(1) },
  { id: 'g-arts', label: 'Arts & Culture', src: F('https://rss.nytimes.com/services/xml/rss/nyt/Arts.xml', 'https://www.theguardian.com/culture/rss', 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml', 'https://feeds.npr.org/1008/rss.xml')[0], more: F('https://rss.nytimes.com/services/xml/rss/nyt/Arts.xml', 'https://www.theguardian.com/culture/rss', 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml', 'https://feeds.npr.org/1008/rss.xml').slice(1) },
  { id: 'g-music', label: 'Music & Hip-Hop', src: F('https://pitchfork.com/feed/feed-news/rss', 'https://www.stereogum.com/feed/', 'https://www.xxlmag.com/feed/', 'https://www.theguardian.com/music/rss', 'https://feeds.npr.org/1039/rss.xml')[0], more: F('https://pitchfork.com/feed/feed-news/rss', 'https://www.stereogum.com/feed/', 'https://www.xxlmag.com/feed/', 'https://www.theguardian.com/music/rss', 'https://feeds.npr.org/1039/rss.xml').slice(1) },
  { id: 'g-film', label: 'Film & TV', src: F('https://variety.com/feed/', 'https://deadline.com/feed/', 'https://www.theguardian.com/film/rss', 'https://www.theguardian.com/tv-and-radio/rss', 'https://rss.nytimes.com/services/xml/rss/nyt/Movies.xml')[0], more: F('https://variety.com/feed/', 'https://deadline.com/feed/', 'https://www.theguardian.com/film/rss', 'https://www.theguardian.com/tv-and-radio/rss', 'https://rss.nytimes.com/services/xml/rss/nyt/Movies.xml').slice(1) },
  { id: 'g-celeb', label: 'Celebrity & Pop Culture', src: F('https://people.com/feed/', 'https://pagesix.com/feed/', 'https://www.tmz.com/rss.xml', 'https://www.eonline.com/syndication/feeds/rssfeeds/topstories.xml')[0], more: F('https://people.com/feed/', 'https://pagesix.com/feed/', 'https://www.tmz.com/rss.xml', 'https://www.eonline.com/syndication/feeds/rssfeeds/topstories.xml').slice(1) },
  { id: 'g-business', label: 'Business & Finance', src: F('https://rss.nytimes.com/services/xml/rss/nyt/Business.xml', 'https://feeds.bbci.co.uk/news/business/rss.xml', 'https://www.theguardian.com/business/rss', 'https://www.cnbc.com/id/100003114/device/rss/rss.html')[0], more: F('https://rss.nytimes.com/services/xml/rss/nyt/Business.xml', 'https://feeds.bbci.co.uk/news/business/rss.xml', 'https://www.theguardian.com/business/rss', 'https://www.cnbc.com/id/100003114/device/rss/rss.html').slice(1) },
  { id: 'g-science', label: 'Science, Health & Environment', src: F('https://rss.nytimes.com/services/xml/rss/nyt/Science.xml', 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', 'https://feeds.bbci.co.uk/news/health/rss.xml', 'https://www.theguardian.com/environment/rss', 'https://feeds.npr.org/1007/rss.xml')[0], more: F('https://rss.nytimes.com/services/xml/rss/nyt/Science.xml', 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', 'https://feeds.bbci.co.uk/news/health/rss.xml', 'https://www.theguardian.com/environment/rss', 'https://feeds.npr.org/1007/rss.xml').slice(1) },
  { id: 'g-tech', label: 'Tech & Digital Culture', src: F('https://www.theverge.com/rss/index.xml', 'https://feeds.arstechnica.com/arstechnica/index', 'https://techcrunch.com/feed/', 'https://www.wired.com/feed/rss')[0], more: F('https://www.theverge.com/rss/index.xml', 'https://feeds.arstechnica.com/arstechnica/index', 'https://techcrunch.com/feed/', 'https://www.wired.com/feed/rss').slice(1) },
  { id: 'g-sports', label: 'Sports (Publishers)', src: F('https://www.espn.com/espn/rss/news', 'https://feeds.bbci.co.uk/sport/rss.xml', 'https://www.theguardian.com/sport/rss', 'https://rss.nytimes.com/services/xml/rss/nyt/Sports.xml')[0], more: F('https://www.espn.com/espn/rss/news', 'https://feeds.bbci.co.uk/sport/rss.xml', 'https://www.theguardian.com/sport/rss', 'https://rss.nytimes.com/services/xml/rss/nyt/Sports.xml').slice(1) },
  { id: 'g-crime', label: 'Crime & Justice', src: F('https://www.theguardian.com/law/rss', 'https://www.themarshallproject.org/rss/recent.rss', 'https://www.theguardian.com/uk/ukcrime/rss', 'https://www.theguardian.com/us-news/us-crime/rss')[0], more: F('https://www.theguardian.com/law/rss', 'https://www.themarshallproject.org/rss/recent.rss', 'https://www.theguardian.com/uk/ukcrime/rss', 'https://www.theguardian.com/us-news/us-crime/rss').slice(1) },
  { id: 'g-life', label: 'Lifestyle: Fashion, Food, Travel', src: F('https://rss.nytimes.com/services/xml/rss/nyt/FashionandStyle.xml', 'https://rss.nytimes.com/services/xml/rss/nyt/Travel.xml', 'https://rss.nytimes.com/services/xml/rss/nyt/DiningandWine.xml', 'https://www.theguardian.com/lifeandstyle/rss', 'https://www.eater.com/rss/index.xml')[0], more: F('https://rss.nytimes.com/services/xml/rss/nyt/FashionandStyle.xml', 'https://rss.nytimes.com/services/xml/rss/nyt/Travel.xml', 'https://rss.nytimes.com/services/xml/rss/nyt/DiningandWine.xml', 'https://www.theguardian.com/lifeandstyle/rss', 'https://www.eater.com/rss/index.xml').slice(1) },
  { id: 'g-opinion', label: 'Opinion & Editorials', src: F('https://rss.nytimes.com/services/xml/rss/nyt/Opinion.xml', 'https://www.theguardian.com/commentisfree/rss', 'https://www.theatlantic.com/feed/channel/ideas/')[0], more: F('https://rss.nytimes.com/services/xml/rss/nyt/Opinion.xml', 'https://www.theguardian.com/commentisfree/rss', 'https://www.theatlantic.com/feed/channel/ideas/').slice(1) },
  { id: 'g-reviews', label: 'Reviews & Criticism', src: F('https://pitchfork.com/feed/feed-album-reviews/rss', 'https://rss.nytimes.com/services/xml/rss/nyt/Movies.xml', 'https://rss.nytimes.com/services/xml/rss/nyt/Books.xml', 'https://www.theguardian.com/books/rss')[0], more: F('https://pitchfork.com/feed/feed-album-reviews/rss', 'https://rss.nytimes.com/services/xml/rss/nyt/Movies.xml', 'https://rss.nytimes.com/services/xml/rss/nyt/Books.xml', 'https://www.theguardian.com/books/rss').slice(1) },
  { id: 'g-data', label: 'Data Journalism', src: F('https://rss.nytimes.com/services/xml/rss/nyt/Upshot.xml', 'https://ourworldindata.org/atom.xml', 'https://www.pewresearch.org/feed/', 'https://flowingdata.com/feed')[0], more: F('https://rss.nytimes.com/services/xml/rss/nyt/Upshot.xml', 'https://ourworldindata.org/atom.xml', 'https://www.pewresearch.org/feed/', 'https://flowingdata.com/feed').slice(1) },
];
export const NEWS_REGIONS: [string, string][] = [['auto', 'Auto'], ['US', 'US'], ['GB', 'UK'], ['CA', 'CA'], ['AU', 'AU'], ['IN', 'IN']];
export const NEWS_EVERY: [number, string][] = [[5, '5 min'], [15, '15 min'], [30, '30 min'], [60, '1 hr'], [180, '3 hr']];
export function newsPlan(cfg?: NewsCfgLike) {
  const interests = (cfg?.query ?? '').split(/[,;\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 5);
  const local = (cfg?.local ?? '').trim();
  const topic = NEWS_TOPICS.find((x) => x.id === cfg?.topic) ?? NEWS_TOPICS[0];
  const publisher = (cfg?.publisher ?? '').trim().toLowerCase();
  const every = Math.max(1, Math.min(1440, Number(cfg?.every) || 10));
  const region = (cfg?.region ?? 'auto').trim() || 'auto';
  const feeds = feedUrls(cfg?.feeds);
  const personal = interests.length > 0 || !!local;
  const srcs: NewsSrc[] = [];
  if (feeds.length) feeds.forEach((u) => srcs.push({ kind: 'feed', arg: u }));
  else {
    interests.forEach((k) => srcs.push({ kind: 'search', arg: k, tag: k }));
    if (local) srcs.push({ kind: 'geo', arg: local, tag: local });
    if (!personal || (cfg?.topic && cfg.topic !== 'top')) srcs.push(topic.src, ...(topic.more ?? []));
  }
  const label = feeds.length ? 'My Feeds' : personal ? 'For You' : topic.label;
  return { key: `${srcs.map((s) => `${s.kind}:${s.arg}`).join('|')}@${region}#${publisher}`, label, srcs, publisher, every, feeds, region, personal };
}

export async function searchSymbols(q: string, only?: 'crypto'): Promise<{ sym: string; name: string; exch: string }[]> {
  const t = await fetchText(`${HOST}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=${only ? 12 : 8}&newsCount=0&enableFuzzyQuery=false`);
  return ((JSON.parse(t)?.quotes ?? []) as any[])
    .filter((x) => (only === 'crypto' ? x?.symbol && x.quoteType === 'CRYPTOCURRENCY' && isCoin(String(x.symbol)) : true))
    .filter((x) => x?.symbol && (x.quoteType === 'EQUITY' || x.quoteType === 'ETF' || x.quoteType === 'INDEX' || x.quoteType === 'CRYPTOCURRENCY' || x.quoteType === 'CURRENCY' || x.quoteType === 'MUTUALFUND'))
    .map((x) => ({ sym: String(x.symbol), name: String(x.shortname || x.longname || x.symbol), exch: String(x.exchDisp || x.exchange || '') }));
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const signed = (n: number) => (n >= 0 ? '+' : '−') + fmt(Math.abs(n));
export const pctStr = (n: number) => (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(2) + '%';
export const compact = (n: number) =>
  n >= 1e12 ? (n / 1e12).toFixed(2) + 'T' : n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n));
export const chg = (q: Quote) => q.price - q.prev;
export const chgPct = (q: Quote) => (q.prev ? ((q.price - q.prev) / q.prev) * 100 : 0);
export const UP = '#30d158';
export const DOWN = '#ff453a';
export const tone = (q: Quote) => (chg(q) >= 0 ? UP : DOWN);
export const arrow = (q: Quote) => `<i class="st-ar" style="color:${tone(q)}">${chg(q) >= 0 ? '▲' : '▼'}</i>`;

let gid = 0;
export function spark(q: Quote, w: number, h: number, opts: { axis?: boolean; ref?: boolean } = {}): string {
  const id = `sg${++gid}`;
  const col = tone(q);
  const s = q.series;
  const padR = opts.axis ? 42 : 0;
  const padB = opts.axis ? 16 : 0;
  const cw = w - padR;
  const ch = h - padB;
  let lo = Math.min(...s, opts.ref || opts.axis ? q.prev : Infinity);
  let hi = Math.max(...s, opts.ref || opts.axis ? q.prev : -Infinity);
  if (hi - lo < 1e-9) {
    hi += 1;
    lo -= 1;
  }
  const m = (hi - lo) * 0.08;
  lo -= m;
  hi += m;
  const X = (i: number) => (i / (s.length - 1)) * cw;
  const Y = (v: number) => 1.5 + (1 - (v - lo) / (hi - lo)) * (ch - 3);
  const pts = s.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`);
  const line = 'M' + pts.join('L');
  let g = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".34"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>`;
  if (opts.axis) {
    for (let k = 0; k < 3; k++) {
      const v = hi - ((hi - lo) * (k + 0.5)) / 3;
      const y = Y(v);
      g += `<line x1="0" x2="${cw}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" style="stroke:var(--w-grid,rgba(255,255,255,.16))" stroke-dasharray="1.5 3"/>`;
      g += `<text x="${cw + 5}" y="${(y + 3.5).toFixed(1)}" class="st-ax">${v.toFixed(2)}</text>`;
    }
    const t0 = q.times[0];
    const t1 = q.times[q.times.length - 1];
    if (t0 && t1 > t0) {
      for (const f of [0.1, 0.5, 0.9]) {
        const t = t0 + (t1 - t0) * f;
        const d = new Date((t + q.tz) * 1000);
        const hr = d.getUTCHours();
        g += `<text x="${(cw * f).toFixed(1)}" y="${h - 3}" text-anchor="middle" class="st-ax">${hr % 12 || 12} ${hr < 12 ? 'AM' : 'PM'}</text>`;
      }
    }
  }
  if (opts.ref) {
    g += `<line x1="0" x2="${cw}" y1="${Y(q.prev).toFixed(1)}" y2="${Y(q.prev).toFixed(1)}" style="stroke:var(--w-grid2,rgba(255,255,255,.22))" stroke-dasharray="1.5 3"/>`;
  }
  g += `<path d="${line}L${cw},${ch}L0,${ch}Z" fill="url(#${id})"/>`;
  g += `<path d="${line}" fill="none" stroke="${col}" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>`;
  return `<svg class="st-sp" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${g}</svg>`;
}

const css = document.createElement('style');
css.textContent = `
.st{position:absolute;inset:0;box-sizing:border-box;padding:14px 16px;color:var(--w-ink,#fff);font-family:"Inter",sans-serif;background:linear-gradient(160deg,#2e2e31 0%,#1f1f21 60%,#161618 100%);overflow:hidden;display:flex;flex-direction:column}
.st *{box-sizing:border-box}
.widget:is([data-wstyle=\"frosted\"],[data-wstyle=\"dark\"]) .st{background:none}
.widget:is([data-wstyle=\"frosted\"],[data-wstyle=\"dark\"]) .wmount:has(.st){filter:none}
.st-bg{position:absolute;left:0;bottom:30px;pointer-events:none}
.st-top,.st-px-bot{position:relative;z-index:1}
.st-ar{font-style:normal;font-size:.62em;margin-right:5px;position:relative;top:-.12em}
.st-sym{font:700 14px/1.1 "Inter",sans-serif;letter-spacing:-.005em;white-space:nowrap}
.st-nm{font:500 12px/1.2 "Inter",sans-serif;color:var(--w-ink2,rgba(255,255,255,.55));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.st-px{font:600 14px/1.1 "Inter",sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap}
.st-ch{font:500 12px/1.2 "Inter",sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap}
.st-big{font:300 36px/1 "Inter",sans-serif;letter-spacing:-.03em;font-variant-numeric:tabular-nums;white-space:nowrap}
.st-big.sm{font-size:32px}
.st-row{display:flex;align-items:center;gap:10px;flex:1;min-height:0;border-top:1px solid var(--w-line,rgba(255,255,255,.14))}
.st-row:first-child{border-top:0}
.st-row .l{flex:1;min-width:0}
.st-row .r{text-align:right}
.st-row .st-sp{flex:none}
.st-r2{display:flex;align-items:baseline;justify-content:space-between;gap:6px;padding:0;flex:1;border-top:1px solid var(--w-line,rgba(255,255,255,.14));min-height:0;align-items:center}
.st-r2:first-child{border-top:0}
.st-r2 .st-px{font-weight:500;color:var(--w-ink,rgba(255,255,255,.92))}
.st-cols{display:grid;grid-template-columns:1fr 1fr;column-gap:14px;flex:none}
.st-cols .st-r2{height:27px;flex:none;border-top:0}
.st-stat{display:flex;justify-content:space-between;gap:8px;font:500 11.5px/1 "Inter",sans-serif;color:var(--w-ink2,rgba(255,255,255,.5));height:17px;align-items:center;border-top:1px solid var(--w-line,rgba(255,255,255,.1))}
.st-stat:first-child{border-top:0}
.st-stat b{font-weight:500;color:var(--w-ink,rgba(255,255,255,.88));font-variant-numeric:tabular-nums}
.st-ax{font:500 9.5px "Inter",sans-serif;fill:var(--w-ink2,rgba(255,255,255,.5))}
.st-news{display:flex;gap:10px;align-items:center;min-width:0;min-height:0}
.st-news .tx{flex:1;min-width:0}
.st-news .pub{font:600 9.5px/1 "Inter",sans-serif;letter-spacing:.03em;text-transform:uppercase;color:var(--w-ink2,rgba(255,255,255,.55));margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:5px}
.st-news .pub s{display:inline-flex;width:11px;height:11px;border-radius:3px;background:var(--w-ink,#fff);color:var(--w-bg,#000);font:800 8px/11px "Inter",sans-serif;text-decoration:none;justify-content:center;flex:none}
.st-news .hd{font:600 12.5px/1.22 "Inter",sans-serif;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:var(--ln,2);overflow:hidden;color:var(--w-ink,#fff)}
.st-news img{width:var(--th,56px);height:var(--th,56px);border-radius:9px;object-fit:cover;flex:none;background:var(--w-ink-soft,rgba(255,255,255,.1))}
.st-news.row{flex:1;border-top:1px solid var(--w-line,rgba(255,255,255,.14))}
.st-news.row:first-child{border-top:0}
.st-sep{height:1px;background:var(--w-line,rgba(255,255,255,.14));margin:0;flex:none}
.st-msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:500 12px/1.3 "Inter",sans-serif;color:var(--w-ink2,rgba(255,255,255,.5));text-align:center;padding:16px}
`;
document.head.appendChild(css);

export const newsItem = (n: News | undefined, o: { thumb?: boolean; lines?: number; row?: boolean } = {}) => {
  if (!n) return `<div class="st-news${o.row ? ' row' : ''}"><div class="tx"><div class="hd" style="color:var(--w-ink3,rgba(255,255,255,.4))">No news right now</div></div></div>`;
  const init = esc((n.publisher[0] || 'N').toUpperCase());
  return `<div class="st-news ix${o.row ? ' row' : ''}" data-link="${esc(n.link)}" style="--ln:${o.lines ?? 2}">
    <div class="tx"><div class="pub"><s>${init}</s>${esc(n.publisher)}</div><div class="hd">${esc(n.title)}</div></div>
    ${o.thumb && n.thumb ? `<img src="${esc(n.thumb)}" alt="" referrerpolicy="no-referrer">` : ''}</div>`;
};

export const wireLinks = (root: HTMLElement) => {
  const h = (e: Event) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-link]');
    if (el?.dataset.link) openLink(el.dataset.link);
  };
  root.addEventListener('click', h);
  return () => root.removeEventListener('click', h);
};

export const card = (inner: string) => $(`<div class="st dk">${inner}</div>`);
export const msg = (text: string) => `<div class="st dk"><div class="st-msg">${esc(text)}</div></div>`;

export const stocksIcon = (s: number) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><rect width="24" height="24" rx="5.6" fill="#111"/><path d="M4.4 16.4l4.1-4.6 3.1 2.6 4.2-5.2 3.8 2.7" fill="none" stroke="#30d158" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.4 19.6h15.2" stroke="rgba(255,255,255,.35)" stroke-width="1.2" stroke-linecap="round"/></svg>`;
