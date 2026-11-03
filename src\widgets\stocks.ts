import { defineWidgets, type WidgetCfg, type WidgetSize } from './_api';
import {
  arrow, card, chg, chgPct, compact, fit, fmt, getNews, getQuote, lastNews, lastQuote, msg, newsItem, pctStr, signed, spark,
  stocksIcon, symbolsOf, tone, wireLinks, esc, type News, type Quote,
} from './_stocks';

type Variant = 'quote' | 'list' | 'chartnews' | 'listnews';
type Sz = 'S' | 'M' | 'L';

const COUNT: Record<Variant, Record<Sz, number>> = {
  quote: { S: 1, M: 1, L: 1 },
  list: { S: 3, M: 3, L: 6 },
  chartnews: { S: 1, M: 1, L: 1 },
  listnews: { S: 3, M: 6, L: 6 },
};
const NEWS: Record<Variant, Record<Sz, number>> = {
  quote: { S: 0, M: 0, L: 0 },
  list: { S: 0, M: 0, L: 0 },
  chartnews: { S: 1, M: 1, L: 3 },
  listnews: { S: 1, M: 1, L: 3 },
};

const head = (q: Quote) => `<div style="min-width:0"><div class="st-sym">${arrow(q)}${esc(q.sym)}</div><div class="st-nm">${esc(q.name)}</div></div>`;
const chgCol = (q: Quote, both = true) =>
  `<div style="text-align:right"><div class="st-ch" style="color:${tone(q)}">${signed(chg(q))}</div>${both ? `<div class="st-ch" style="color:${tone(q)}">${pctStr(chgPct(q))}</div>` : ''}</div>`;
const stat = (l: string, v: string) => `<div class="st-stat"><span>${l}</span><b>${v}</b></div>`;
const bigPx = (q: Quote, small = false) => `<div class="st-big${small ? ' sm' : ''}" style="font-size:${fit(fmt(q.price), 126, small ? 32 : 36)}px">${fmt(q.price)}</div>`;

const row = (q: Quote, chart: number) =>
  `<div class="st-row"><div class="l">${head(q)}</div>${chart ? spark(q, chart, 28) : ''}<div class="r"><div class="st-px">${fmt(q.price)}</div><div class="st-ch" style="color:${tone(q)}">${signed(chg(q))}</div></div></div>`;
const mini = (q: Quote) => `<div class="st-r2"><span class="st-sym">${arrow(q)}${esc(q.sym)}</span><span class="st-px">${fmt(q.price)}</span></div>`;

type L = (q: Quote[], n: News[]) => string;
const LAYOUT: Record<Variant, Record<Sz, L>> = {
  quote: {
    S: ([q]) => `<div class="st-bg">${spark(q, 158, 76, { ref: true })}</div>
      <div class="st-top" style="display:flex;justify-content:space-between;gap:6px">${head(q)}${chgCol(q)}</div><div style="flex:1"></div><div class="st-px-bot">${bigPx(q)}</div>`,
    M: ([q]) => `<div style="display:flex;gap:14px;flex:1;min-height:0">
        <div style="width:104px;display:flex;flex-direction:column;justify-content:space-between;flex:none">${head(q)}
          <div>${stat('Open', fmt(q.open))}${stat('High', fmt(q.high))}${stat('Low', fmt(q.low))}</div><div class="st-big" style="font-size:${fit(fmt(q.price), 104, 27)}px">${fmt(q.price)}</div></div>
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><div style="display:flex;justify-content:flex-end">${chgCol(q)}</div>
          <div style="margin-top:auto">${spark(q, 174, 84, { ref: true })}</div></div></div>`,
    L: ([q]) => `<div style="display:flex;justify-content:space-between;gap:6px">${head(q)}${chgCol(q)}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;column-gap:18px;margin-top:10px">
        <div>${stat('Open', fmt(q.open))}${stat('High', fmt(q.high))}${stat('Low', fmt(q.low))}</div>
        <div>${stat('Vol', compact(q.vol))}${stat('52W H', fmt(q.hi52))}${stat('52W L', fmt(q.lo52))}</div></div>
      <div class="st-big" style="margin-top:10px">${fmt(q.price)}</div>
      <div style="margin-top:auto">${spark(q, 306, 186, { axis: true })}</div>`,
  },
  list: {
    S: (qs) => qs.map((q) => row(q, 0)).join(''),
    M: (qs) => qs.map((q) => row(q, 84)).join(''),
    L: (qs) => qs.map((q) => row(q, 96)).join(''),
  },
  chartnews: {
    S: ([q], [n]) => `<div style="display:flex;justify-content:space-between;align-items:flex-start">${head(q)}<div class="st-px" style="font-size:13px;margin-top:1px">${fmt(q.price)}</div></div>
      <div style="margin-top:6px">${spark(q, 126, 38)}</div><div style="flex:1;min-height:6px"></div>${newsItem(n, { lines: 3 })}`,
    M: ([q], [n]) => `<div style="display:flex;align-items:center;gap:10px"><div style="flex:1;min-width:0">${head(q)}</div>${spark(q, 110, 36)}
        <div style="text-align:right"><div class="st-px">${fmt(q.price)}</div><div class="st-ch" style="color:${tone(q)}">${signed(chg(q))}</div></div></div>
      <div style="flex:1;min-height:6px"></div>${newsItem(n, { lines: 2 })}`,
    L: ([q], ns) => `<div style="display:flex;align-items:center;gap:10px;flex:none;padding-bottom:10px"><div style="flex:1;min-width:0">${head(q)}</div>${spark(q, 110, 36)}
        <div style="text-align:right"><div class="st-px">${fmt(q.price)}</div><div class="st-ch" style="color:${tone(q)}">${signed(chg(q))}</div></div></div>
      <div style="flex:1;min-height:0;display:flex;flex-direction:column">${[0, 1, 2].map((i) => newsItem(ns[i], { thumb: true, row: true, lines: 3 })).join('')}</div>`,
  },
  listnews: {
    S: (qs, [n]) => `<div style="display:flex;flex-direction:column;flex:none">${qs.map((q) => `<div class="st-r2" style="height:21px;flex:none;border:0">${`<span class="st-sym" style="font-size:12px">${arrow(q)}${esc(q.sym)}</span><span class="st-px" style="font-size:12px">${fmt(q.price)}</span>`}</div>`).join('')}</div>
      <div style="flex:1;min-height:4px"></div>${newsItem(n, { lines: 2 })}`,
    M: (qs, [n]) => `<div class="st-cols">${qs.map(mini).join('')}</div><div style="flex:1;min-height:4px"></div>${newsItem(n, { lines: 2 })}`,
    L: (qs, ns) => `<div class="st-cols">${qs.map(mini).join('')}</div><div class="st-sep" style="margin:8px 0 0"></div>
      <div style="flex:1;min-height:0;display:flex;flex-direction:column">${[0, 1, 2].map((i) => newsItem(ns[i], { thumb: true, row: true, lines: 3 })).join('')}</div>`,
  },
};

function stocks(variant: Variant, size: Sz) {
  const nq = COUNT[variant][size];
  const nn = NEWS[variant][size];
  return (root: HTMLElement, cfg?: WidgetCfg) => {
    const syms = symbolsOf(cfg, nq);
    let alive = true;
    const qs = new Map<string, Quote>();
    let news: News[] = [];
    let failed = false;
    for (const s of syms) {
      const c = lastQuote(s);
      if (c) qs.set(s, c);
    }
    if (nn) news = lastNews(syms[0]) ?? [];

    const draw = () => {
      if (!alive) return;
      const have = syms.map((s) => qs.get(s));
      if (have.some((q) => !q)) {
        root.innerHTML = msg(failed ? 'Stocks unavailable.\nCheck your connection.' : 'Loading…');
        return;
      }
      root.innerHTML = card(LAYOUT[variant][size](have as Quote[], news));
    };
    const load = async () => {
      const jobs: Promise<unknown>[] = syms.map((s) => getQuote(s).then((q) => void qs.set(s, q)));
      if (nn) jobs.push(getNews(syms[0], nn).then((n) => void (news = n)).catch(() => {}));
      const r = await Promise.allSettled(jobs);
      failed = r.some((x, i) => x.status === 'rejected' && i < syms.length);
      draw();
    };
    draw();
    void load();
    const t = setInterval(() => void load(), 2 * 60_000);
    const unlink = wireLinks(root);
    return () => {
      alive = false;
      clearInterval(t);
      unlink();
      root.innerHTML = '';
    };
  };
}

const sizes: Sz[] = ['S', 'M', 'L'];
const def = (variant: Variant, group: string, desc: Record<Sz, string>, size: Sz) => ({
  id: `stocks-${variant}-${size.toLowerCase()}`,
  family: 'Stocks',
  group,
  size: size as WidgetSize,
  name: 'Stocks',
  desc: desc[size],
  fields: ['symbols' as const],
  slots: COUNT[variant][size],
  icon: stocksIcon,
  mount: stocks(variant, size),
});

export default defineWidgets([
  ...sizes.map((s) => def('quote', 'stocks-quote', { S: 'One stock’s price and how it has moved today.', M: 'One stock with its price, day range and chart.', L: 'One stock in depth: day range, volume and a full chart.' }, s)),
  ...sizes.map((s) => def('list', 'stocks-list', { S: 'A compact watch list of your stocks and their prices.', M: 'A watch list with a mini chart for each stock.', L: 'Six stocks, each with its own chart.' }, s)),
  ...sizes.map((s) => def('chartnews', 'stocks-chartnews', { S: 'A stock’s chart with the latest headline about it.', M: 'One stock with its chart and a news headline.', L: 'One stock with its chart and three news headlines.' }, s)),
  ...sizes.map((s) => def('listnews', 'stocks-listnews', { S: 'A compact watch list with a top headline.', M: 'Six stocks with a headline from the news.', L: 'Six stocks with three headlines from the news.' }, s)),
]);
