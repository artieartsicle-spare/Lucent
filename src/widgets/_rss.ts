import type { News } from './_stocks';
import { native } from './_native';

const secure = (u?: string | null): string | undefined => {
  const t = (u ?? '').trim();
  if (/^https:\/\//i.test(t)) return t;
  if (/^http:\/\//i.test(t)) return 'https://' + t.slice(7);
  return undefined;
};
const decode = (s: string) => new DOMParser().parseFromString(s, 'text/html').documentElement.textContent ?? s;
const clean = (s: string) => decode(s).replace(/\s+/g, ' ').trim();
const first = (el: Element, name: string) => el.getElementsByTagNameNS('*', name)[0] as Element | undefined;
const txt = (el: Element, name: string) => first(el, name)?.textContent?.trim() ?? '';
const imgIn = (html: string) => /<img[^>]+src=["']([^"']+)["']/i.exec(html)?.[1];

function pictureOf(item: Element): string | undefined {
  const t = first(item, 'thumbnail')?.getAttribute('url');
  if (t) return secure(t);
  for (const m of Array.from(item.getElementsByTagNameNS('*', 'content'))) {
    const url = m.getAttribute('url');
    const kind = (m.getAttribute('type') || '') + (m.getAttribute('medium') || '');
    if (url && (/image/i.test(kind) || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url))) return secure(url);
  }
  for (const e of Array.from(item.getElementsByTagName('enclosure'))) {
    if (/^image\//i.test(e.getAttribute('type') || '')) return secure(e.getAttribute('url'));
  }
  const body = txt(item, 'encoded') || txt(item, 'description') || txt(item, 'content') || txt(item, 'summary');
  return secure(imgIn(body));
}

export type Feed = { title: string; items: News[] };

export function parseFeed(xml: string, fallbackName: string): Feed {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('not a feed');
  const root = doc.documentElement;
  const atom = root.localName === 'feed';
  const channel = atom ? root : (root.getElementsByTagName('channel')[0] ?? root);
  const title = clean(Array.from(channel.children).find((c) => c.localName === 'title')?.textContent ?? '') || fallbackName;
  const out: News[] = [];
  const entries = Array.from(doc.getElementsByTagName(atom ? 'entry' : 'item'));
  for (const it of entries.slice(0, 30)) {
    let link: string | undefined;
    if (atom) {
      const ls = Array.from(it.getElementsByTagName('link'));
      const l = ls.find((x) => (x.getAttribute('rel') || 'alternate') === 'alternate') ?? ls[0];
      link = secure(l?.getAttribute('href'));
    } else {
      link = secure(txt(it, 'link')) ?? secure(txt(it, 'guid'));
    }
    const t = clean(txt(it, 'title'));
    if (!t || !link) continue;
    const when = Date.parse(txt(it, 'pubDate') || txt(it, 'published') || txt(it, 'updated') || txt(it, 'date'));
    const pic = pictureOf(it);
    out.push({ title: t, publisher: title, link, thumb: pic, big: pic, at: isFinite(when) ? Math.floor(when / 1000) : 0 });
  }
  return { title, items: out };
}

export async function loadFeed(url: string): Promise<Feed> {
  const a = native();
  if (!a.rssGet) throw new Error('feeds need the desktop app');
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
  }
  return parseFeed(await a.rssGet(url), host);
}
