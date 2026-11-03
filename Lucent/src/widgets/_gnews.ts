import type { News, NewsSrc } from './_stocks';
import { native } from './_native';

const BASE = 'https://news.google.com/rss';
const EDITIONS: Record<string, [string, string]> = { US: ['en-US', 'en'], GB: ['en-GB', 'en'], CA: ['en-CA', 'en'], AU: ['en-AU', 'en'], IN: ['en-IN', 'en'] };

export function locale(region?: string): { hl: string; gl: string; lang: string } {
  const fixed = region && region !== 'auto' ? EDITIONS[region] : undefined;
  if (fixed) return { hl: fixed[0], gl: region!, lang: fixed[1] };
  let gl = 'US';
  let lang = 'en';
  const m = /^([a-z]{2,3})-([a-z]{2})$/i.exec(navigator.language || '');
  if (m) {
    lang = m[1].toLowerCase();
    gl = m[2].toUpperCase();
  } else {
    lang = (navigator.language || 'en').split('-')[0].toLowerCase() || 'en';
  }
  return { hl: lang === 'en' ? `en-${gl}` : lang, gl, lang };
}
export function edition(region?: string): string {
  const { hl, gl, lang } = locale(region);
  return `hl=${encodeURIComponent(hl)}&gl=${gl}&ceid=${gl}:${lang}`;
}

export function urlFor(src: NewsSrc, region?: string): string {
  const ed = edition(region);
  switch (src.kind) {
    case 'top':
      return `${BASE}?${ed}`;
    case 'section':
      return `${BASE}/headlines/section/topic/${encodeURIComponent(src.arg)}?${ed}`;
    case 'geo':
      return `${BASE}/headlines/section/geo/${encodeURIComponent(src.arg)}?${ed}`;
    case 'search':
      return `${BASE}/search?q=${encodeURIComponent(`${src.arg} when:2d`)}&${ed}`;
    default:
      return src.arg;
  }
}

const decode = (s: string) => new DOMParser().parseFromString(s, 'text/html').documentElement.textContent ?? s;
const clean = (s: string) => decode(s).replace(/\s+/g, ' ').trim();
const child = (el: Element, name: string) => Array.from(el.children).find((c) => c.localName === name);

function headline(raw: string, publisher: string): string {
  let t = clean(raw);
  if (publisher && t.toLowerCase().endsWith(` - ${publisher.toLowerCase()}`)) return t.slice(0, -(publisher.length + 3)).trim();
  const i = t.lastIndexOf(' - ');
  if (i > 12 && t.length - i < 40) t = t.slice(0, i).trim();
  return t;
}

export function parseGoogle(xml: string, tag?: string): News[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('not a feed');
  const out: News[] = [];
  for (const it of Array.from(doc.getElementsByTagName('item')).slice(0, 40)) {
    const src = child(it, 'source');
    const publisher = clean(src?.textContent ?? '') || 'News';
    const title = headline(child(it, 'title')?.textContent ?? '', publisher);
    const link = (child(it, 'link')?.textContent ?? '').trim();
    if (!title || !/^https:\/\//i.test(link)) continue;
    let domain: string | undefined;
    try {
      domain = new URL(src?.getAttribute('url') ?? '').hostname.replace(/^www\./, '') || undefined;
    } catch {
    }
    const when = Date.parse(child(it, 'pubDate')?.textContent ?? '');
    out.push({ title, publisher, link, domain, tag, at: isFinite(when) ? Math.floor(when / 1000) : 0 });
  }
  return out;
}

const cache = new Map<string, { at: number; p: Promise<News[]> }>();
export function loadGoogle(src: NewsSrc, region: string | undefined, ttlMin: number): Promise<News[]> {
  const url = urlFor(src, region);
  const c = cache.get(url);
  if (c && Date.now() - c.at < Math.max(1, ttlMin) * 60_000) return c.p;
  const a = native();
  if (!a.rssGet) return Promise.reject(new Error('news needs the desktop app'));
  const p = a
    .rssGet(url)
    .then((x) => parseGoogle(x, src.tag))
    .catch((e) => {
      cache.delete(url);
      throw e;
    });
  cache.set(url, { at: Date.now(), p });
  return p;
}
