import type { News, NewsSrc } from './_stocks';
import { native } from './_native';
import { locale } from './_gnews';

const SECTION: Record<string, string> = {
  WORLD: 'world news',
  NATION: 'national news',
  BUSINESS: 'business news',
  TECHNOLOGY: 'technology news',
  SPORTS: 'sports news',
  SCIENCE: 'science news',
  ENTERTAINMENT: 'entertainment news',
  HEALTH: 'health news',
};

export function bingUrl(src: NewsSrc, region?: string): string | null {
  if (src.kind === 'feed') return null;
  const { hl, gl, lang } = locale(region);
  const q =
    src.kind === 'top' ? 'top stories' : src.kind === 'section' ? (SECTION[src.arg] ?? src.arg.toLowerCase()) : src.kind === 'geo' ? `${src.arg} local news` : src.arg;
  const sort = src.kind === 'search' || src.kind === 'geo' ? '&qft=sortbydate%3d%221%22' : '';
  const mkt = hl.includes('-') ? hl : `${lang}-${gl}`;
  return `https://www.bing.com/news/search?q=${encodeURIComponent(q)}${sort}&format=rss&setmkt=${encodeURIComponent(mkt)}&cc=${gl}`;
}

const decode = (s: string) => new DOMParser().parseFromString(s, 'text/html').documentElement.textContent ?? s;
const clean = (s: string) => decode(s).replace(/\s+/g, ' ').trim();
const kid = (el: Element, name: string) => Array.from(el.children).find((c) => c.localName.toLowerCase() === name.toLowerCase());
const secure = (u?: string | null): string | undefined => {
  let t = (u ?? '').trim();
  if (!t) return undefined;
  if (t.startsWith('//')) t = 'https:' + t;
  else if (/^http:\/\//i.test(t)) t = 'https://' + t.slice(7);
  else if (!/^https:\/\//i.test(t)) t = 'https://' + t;
  try {
    const u2 = new URL(t);
    if (/(^|\.)bing\.com$|\.bing\d*\.com$/i.test(u2.hostname) && u2.pathname === '/th') {
      if (!u2.searchParams.has('w')) {
        u2.searchParams.set('w', '480');
        u2.searchParams.set('h', '320');
        u2.searchParams.set('c', '7');
      }
      return u2.toString();
    }
  } catch {
    return undefined;
  }
  return t;
};

export function parseBing(xml: string, tag?: string): News[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('not a feed');
  const out: News[] = [];
  for (const it of Array.from(doc.getElementsByTagName('item')).slice(0, 40)) {
    const title = clean(kid(it, 'title')?.textContent ?? '');
    let link = (kid(it, 'link')?.textContent ?? '').trim();
    try {
      const real = new URL(link.replace(/^http:\/\//i, 'https://')).searchParams.get('url');
      if (real) link = real;
    } catch {
    }
    link = link.replace(/^http:\/\//i, 'https://');
    if (!title || !/^https:\/\/[^\s/]+/i.test(link)) continue;
    let domain: string | undefined;
    try {
      const h = new URL(link).hostname.replace(/^www\./, '');
      domain = /(^|\.)bing\.com$/i.test(h) ? undefined : h;
    } catch {
    }
    const publisher = clean(kid(it, 'source')?.textContent ?? '') || domain?.replace(/\.[a-z.]+$/i, '') || 'News';
    const pic = secure(kid(it, 'image')?.textContent);
    const when = Date.parse(kid(it, 'pubDate')?.textContent ?? '');
    out.push({ title, publisher, link, domain, tag, thumb: pic, big: pic, at: isFinite(when) ? Math.floor(when / 1000) : 0 });
  }
  return out;
}

const cache = new Map<string, { at: number; p: Promise<News[]> }>();
export function loadBing(src: NewsSrc, region: string | undefined, ttlMin: number): Promise<News[]> {
  const url = bingUrl(src, region);
  if (!url) return Promise.reject(new Error('not a Bing source'));
  const c = cache.get(url);
  if (c && Date.now() - c.at < Math.max(1, ttlMin) * 60_000) return c.p;
  const a = native();
  if (!a.rssGet) return Promise.reject(new Error('news needs the desktop app'));
  const p = a
    .rssGet(url)
    .then((x) => {
      const items = parseBing(x, src.tag);
      if (!items.length) throw new Error('no stories');
      return items;
    })
    .catch((e) => {
      cache.delete(url);
      throw e;
    });
  cache.set(url, { at: Date.now(), p });
  return p;
}
