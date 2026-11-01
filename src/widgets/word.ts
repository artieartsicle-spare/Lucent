import { defineWidgets, type WidgetSize } from './_api';
import './_cardStyles';
import { $ } from './_cardShared';
import { esc, native } from './_native';
import { wireLinks } from './_stocks';
import { wordOf } from './_words';

type Entry = { word: string; phonetic: string; pos: string; def: string; example: string; more: { pos: string; def: string }[] };
const KEY = 'lucent-wotd-v1:';

export function parseEntry(text: string, word: string): Entry {
  const j = JSON.parse(text);
  const e = Array.isArray(j) ? j[0] : null;
  if (!e) throw new Error('no entry');
  const meanings = (e.meanings ?? []) as { partOfSpeech?: string; definitions?: { definition?: string; example?: string }[] }[];
  const m0 = meanings[0];
  const d0 = m0?.definitions?.[0];
  const ex = (m0?.definitions ?? []).find((d) => d.example)?.example ?? meanings.flatMap((m) => m.definitions ?? []).find((d) => d.example)?.example ?? '';
  const phon = (e.phonetic as string) || ((e.phonetics ?? []) as { text?: string }[]).find((p) => p.text)?.text || '';
  return {
    word,
    phonetic: phon,
    pos: m0?.partOfSpeech ?? '',
    def: d0?.definition ?? '',
    example: ex,
    more: meanings.slice(1, 3).flatMap((m) => (m.definitions?.[0]?.definition ? [{ pos: m.partOfSpeech ?? '', def: m.definitions[0].definition as string }] : [])),
  };
}

const plain = (html: string) => (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '').replace(/\s+/g, ' ').trim();
export function parseWiktionary(text: string, word: string): Entry {
  const j = JSON.parse(text) as { en?: { partOfSpeech?: string; definitions?: { definition?: string; examples?: string[] }[] }[] };
  const senses = (j.en ?? []).filter((s) => (s.definitions ?? []).some((d) => d.definition && plain(d.definition)));
  if (!senses.length) throw new Error('no entry');
  const first = (s: (typeof senses)[number]) => (s.definitions ?? []).find((d) => d.definition && plain(d.definition))!;
  const s0 = senses[0];
  const ex = senses.flatMap((s) => s.definitions ?? []).flatMap((d) => d.examples ?? []).map(plain).find(Boolean) ?? '';
  return {
    word,
    phonetic: '',
    pos: (s0.partOfSpeech ?? '').toLowerCase(),
    def: plain(first(s0).definition!),
    example: ex,
    more: senses.slice(1, 3).map((s) => ({ pos: (s.partOfSpeech ?? '').toLowerCase(), def: plain(first(s).definition!) })),
  };
}

const memo = new Map<string, Promise<Entry>>();
const saved = (w: string): Entry | null => {
  try {
    return JSON.parse(localStorage.getItem(KEY + w) || 'null');
  } catch {
    return null;
  }
};
function getEntry(w: string): Promise<Entry> {
  let p = memo.get(w);
  if (!p) {
    const a = native();
    const get = (url: string) => (a.httpGet ? a.httpGet(url) : fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))));
    const first = get(`https://api.dictionaryapi.dev/v2/entries/en/${encodeURIComponent(w)}`).then((t) => parseEntry(t, w));
    p = first
      .catch(() => get(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(w)}`).then((t) => parseWiktionary(t, w)))
      .then((e) => {
        try {
          localStorage.setItem(KEY + w, JSON.stringify(e));
        } catch {
        }
        return e;
      })
      .catch((e) => {
        memo.delete(w);
        throw e;
      });
    memo.set(w, p);
  }
  return p;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const today = () => new Date().toLocaleDateString([], { month: 'short', day: 'numeric' });
const hd = (right = '') => `<div class="wd-h"><span>Word of the Day</span><span class="d">${right}</span></div>`;

function view(size: 'S' | 'M' | 'L', e: Entry, loading: boolean): string {
  const word = `<div class="wd-w ix" data-link="https://en.wiktionary.org/wiki/${encodeURIComponent(e.word)}">${esc(e.word)}</div>`;
  const pos = e.pos ? `<span class="wd-p">${esc(e.pos)}</span>` : '';
  const def = e.def ? esc(cap(e.def)) : loading ? 'Looking up the meaning…' : 'Couldn’t load the meaning. Trying again…';
  if (size === 'S') return `${hd()}${word}<div class="wd-line">${pos}</div><div class="wd-d s">${def}</div>`;
  const ph = e.phonetic ? `<span class="wd-ph">${esc(e.phonetic)}</span>` : '';
  if (size === 'M') return `${hd(today())}<div class="wd-top">${word}${ph}</div><div class="wd-line">${pos}</div><div class="wd-d m"><b>1</b>${def}</div>`;
  const ex = e.example ? `<div class="wd-ex">“${esc(cap(e.example))}”</div>` : '';
  const more = e.more.map((m, i) => `<div class="wd-d m2"><b>${i + 2}</b><i>${esc(m.pos)}</i> ${esc(cap(m.def))}</div>`).join('');
  return `${hd(today())}<div class="wd-top">${word}${ph}</div><div class="wd-line">${pos}</div><div class="wd-d l"><b>1</b>${def}</div>${ex}<div class="wd-more">${more}</div>`;
}

function wotd(size: 'S' | 'M' | 'L') {
  return (root: HTMLElement) => {
    let alive = true;
    let word = wordOf();
    let entry: Entry = saved(word) ?? { word, phonetic: '', pos: '', def: '', example: '', more: [] };
    const wc = document.createElement('div');
    wc.className = `wc card wd wd-${size.toLowerCase()}`;
    root.appendChild(wc);
    let failed = false;
    let fetching = false;
    const draw = () => alive && (wc.innerHTML = $(view(size, entry, !failed)));
    const load = () => {
      const w = wordOf();
      if (w !== word) {
        word = w;
        entry = saved(w) ?? { word: w, phonetic: '', pos: '', def: '', example: '', more: [] };
        draw();
      }
      if (entry.def || fetching) return;
      fetching = true;
      getEntry(w)
        .then((e) => {
          entry = e;
          failed = false;
          draw();
        })
        .catch(() => {
          failed = true;
          draw();
        })
        .finally(() => (fetching = false));
    };
    draw();
    load();
    const t = setInterval(load, 45_000);
    const off = wireLinks(wc);
    return () => {
      alive = false;
      clearInterval(t);
      off();
      wc.remove();
    };
  };
}

const css = document.createElement('style');
css.textContent = `
.wd{display:flex;flex-direction:column;padding:13px 16px 12px;text-align:left;font-family:"Inter",sans-serif}
.wd-h{flex:none;display:flex;justify-content:space-between;align-items:baseline;margin-bottom:7px;font:700 10.5px/1 "Inter",sans-serif;letter-spacing:.1em;text-transform:uppercase;color:var(--red)}
.wd-h .d{color:var(--sub);letter-spacing:.04em}
.wd-w{font:700 26px/1.05 Georgia,"Times New Roman",serif;letter-spacing:-.01em;color:var(--fg);overflow-wrap:anywhere}
.wd-s .wd-w{font-size:23px}
.wd-l .wd-w{font-size:34px}
.wd-top{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.wd-ph{font:400 13.5px/1 Georgia,serif;color:var(--sub)}
.wd-line{margin:5px 0 6px;min-height:14px}
.wd-p{font:italic 400 13px/1 Georgia,"Times New Roman",serif;color:var(--sub)}
.wd-d{font:400 13.5px/1.32 Georgia,"Times New Roman",serif;color:var(--fg);display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden}
.wd-d.s{-webkit-line-clamp:4;font-size:12.5px}
.wd-d.m{-webkit-line-clamp:3}
.wd-d.l{-webkit-line-clamp:4;font-size:14.5px}
.wd-d b{font:700 11px/1 "Inter",sans-serif;color:var(--red);margin-right:7px}
.wd-d i{font-style:italic;color:var(--sub)}
.wd-ex{margin-top:10px;padding-left:10px;border-left:2px solid var(--hair);font:italic 400 13.5px/1.35 Georgia,serif;color:var(--sub);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}
.wd-more{margin-top:auto;border-top:1px solid var(--hair);padding-top:9px;display:flex;flex-direction:column;gap:7px}
.wd-d.m2{-webkit-line-clamp:2;font-size:13px}
.widget:is([data-wstyle="frosted"],[data-wstyle="dark"]) .wd-h,.widget:is([data-wstyle="frosted"],[data-wstyle="dark"]) .wd-d b{color:rgba(255,255,255,.75)}
`;
document.head.appendChild(css);

const icon = (s: number) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><rect width="24" height="24" rx="5.6" fill="#fff"/><text x="12" y="17.4" text-anchor="middle" font-family="Georgia,serif" font-size="14.5" font-weight="700" fill="#b3261e">Aa</text></svg>`;
const d = (size: 'S' | 'M' | 'L', desc: string, withIcon = false) => ({
  id: `wotd-${size.toLowerCase()}`, family: 'Dictionary', group: 'wotd', size: size as WidgetSize, name: 'Word of the Day', desc, icon: withIcon ? icon : undefined, mount: wotd(size),
});
export default defineWidgets([
  d('S', 'Today’s word with a short definition.', true),
  d('M', 'Today’s word with its pronunciation and definition.'),
  d('L', 'Today’s word with its definitions and an example sentence.'),
]);
