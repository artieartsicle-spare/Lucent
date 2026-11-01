import { defineWidgets, type FxCfg, type WidgetCfg, type WidgetSize } from './_api';
import {
  arrow, card, chg, chgPct, coinsOf, compact, esc, fit, fmt, getQuote, lastQuote, msg, pctStr, spark, tone, type Quote,
} from './_stocks';

type Sz = 'S' | 'M' | 'L';
const CURRENCIES = ['EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR'];

export const px = (n: number) =>
  n >= 1000 ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : n >= 1 ? n.toFixed(2) : n >= 0.01 ? n.toFixed(4) : n.toFixed(6);
const sgn = (n: number) => (n >= 0 ? '+' : '−') + px(Math.abs(n));
const money = (v: number, code: string) => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code, maximumFractionDigits: v >= 1000 ? 0 : 2 }).format(v);
  } catch {
    return `${fmt(v)} ${code}`;
  }
};
const csym = (q: Quote) => q.sym.replace(/-[A-Z]{3}$/, '');
const cname = (q: Quote) => q.name.replace(/\s+(USD|EUR|GBP)$/, '');
const coinHead = (q: Quote) => `<div style="min-width:0"><div class="st-sym">${arrow(q)}${esc(csym(q))}</div><div class="st-nm">${esc(cname(q))}</div></div>`;
const chgCol = (q: Quote) => `<div style="text-align:right"><div class="st-ch" style="color:${tone(q)}">${sgn(chg(q))}</div><div class="st-ch" style="color:${tone(q)}">${pctStr(chgPct(q))}</div></div>`;
const stat = (l: string, v: string) => `<div class="st-stat"><span>${l}</span><b>${v}</b></div>`;

const coinList = (qs: Quote[], chart: number) =>
  qs
    .map(
      (q) => `<div class="st-row"><div class="l">${coinHead(q)}</div>${chart ? spark(q, chart, 28) : ''}<div class="r"><div class="st-px">${px(q.price)}</div><div class="st-ch" style="color:${tone(q)}">${pctStr(chgPct(q))}</div></div></div>`
    )
    .join('');

const CRYPTO: Record<string, (q: Quote[]) => string> = {
  'quote-S': ([q]) => `<div class="st-bg">${spark(q, 158, 76, { ref: true })}</div>
      <div class="st-top" style="display:flex;justify-content:space-between;gap:6px">${coinHead(q)}${chgCol(q)}</div><div style="flex:1"></div><div class="st-px-bot"><div class="st-big" style="font-size:${fit(px(q.price), 126, 34)}px">${px(q.price)}</div></div>`,
  'quote-M': ([q]) => `<div style="display:flex;gap:14px;flex:1;min-height:0">
        <div style="width:104px;display:flex;flex-direction:column;justify-content:space-between;flex:none">${coinHead(q)}
          <div>${stat('Open', px(q.open))}${stat('High', px(q.high))}${stat('Low', px(q.low))}</div><div class="st-big" style="font-size:${fit(px(q.price), 104, 24)}px">${px(q.price)}</div></div>
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><div style="display:flex;justify-content:flex-end">${chgCol(q)}</div>
          <div style="margin-top:auto">${spark(q, 174, 84, { ref: true })}</div></div></div>`,
  'quote-L': ([q]) => `<div style="display:flex;justify-content:space-between;gap:6px">${coinHead(q)}${chgCol(q)}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;column-gap:18px;margin-top:10px">
        <div>${stat('Open', px(q.open))}${stat('High', px(q.high))}${stat('Low', px(q.low))}</div>
        <div>${stat('Vol', compact(q.vol))}${stat('52W H', px(q.hi52))}${stat('52W L', px(q.lo52))}</div></div>
      <div class="st-big" style="margin-top:10px;font-size:${fit(px(q.price), 306, 36)}px">${px(q.price)}</div>
      <div style="margin-top:auto">${spark(q, 306, 186, { axis: true })}</div>`,
  'list-M': (qs) => coinList(qs, 84),
  'list-L': (qs) => coinList(qs, 96),
};

export function fxPlan(fx: FxCfg | undefined, n: number) {
  const from = /^[A-Z]{3}$/.test((fx?.from ?? '').trim()) ? (fx!.from as string).trim() : 'USD';
  const own = (fx?.to ?? '').split(/[\s,;]+/).filter((c) => /^[A-Z]{3}$/.test(c) && c !== from);
  const to: string[] = [];
  for (const c of [...own, ...CURRENCIES, 'USD']) if (c !== from && !to.includes(c) && to.length < n) to.push(c);
  const amount = fx?.amount && fx.amount > 0 ? fx.amount : 1;
  return { from, to, amount, syms: to.map((c) => `${from}${c}=X`) };
}
const rate = (r: number) => (r >= 100 ? r.toFixed(2) : r >= 1 ? r.toFixed(4) : r.toFixed(5));
const amt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 4 });
const fxRow = (q: Quote, code: string, amount: number, chart: number) =>
  `<div class="st-row"><div class="l"><div class="st-sym">${arrow(q)}${esc(code)}</div><div class="st-nm">${rate(q.price)}</div></div>${chart ? spark(q, chart, 28) : ''}<div class="r"><div class="st-px">${money(amount * q.price, code)}</div><div class="st-ch" style="color:${tone(q)}">${pctStr(chgPct(q))}</div></div></div>`;

type FxView = (qs: Quote[], p: ReturnType<typeof fxPlan>) => string;
const FX: Record<Sz, FxView> = {
  S: ([q], p) => `<div class="st-bg">${spark(q, 158, 76, { ref: true })}</div>
      <div class="st-top" style="display:flex;justify-content:space-between;gap:6px"><div><div class="st-sym">${arrow(q)}${esc(p.from)} → ${esc(p.to[0])}</div><div class="st-nm">${amt(p.amount)} ${esc(p.from)}</div></div>
        <div class="st-ch" style="color:${tone(q)};text-align:right">${pctStr(chgPct(q))}</div></div><div style="flex:1"></div>
      <div class="st-px-bot"><div class="st-big" style="font-size:${fit(money(p.amount * q.price, p.to[0]), 126, 30)}px">${money(p.amount * q.price, p.to[0])}</div><div class="st-nm" style="margin-top:3px">1 ${esc(p.from)} = ${rate(q.price)} ${esc(p.to[0])}</div></div>`,
  M: (qs, p) => `<div class="st-nm" style="margin-bottom:2px;flex:none">${amt(p.amount)} ${esc(p.from)} equals</div><div style="flex:1;min-height:0;display:flex;flex-direction:column">${qs.map((q, i) => fxRow(q, p.to[i], p.amount, 70)).join('')}</div>`,
  L: (qs, p) => `<div class="st-nm" style="margin-bottom:2px;flex:none">${amt(p.amount)} ${esc(p.from)} equals</div><div style="flex:1;min-height:0;display:flex;flex-direction:column">${qs.map((q, i) => fxRow(q, p.to[i], p.amount, 96)).join('')}</div>`,
};

function mount(syms: (cfg?: WidgetCfg) => string[], view: (qs: Quote[], cfg?: WidgetCfg) => string, what: string) {
  return (root: HTMLElement, cfg?: WidgetCfg) => {
    const list = syms(cfg);
    let alive = true;
    let failed = false;
    const qs = new Map<string, Quote>();
    for (const s of list) {
      const c = lastQuote(s);
      if (c) qs.set(s, c);
    }
    const draw = () => {
      if (!alive) return;
      const have = list.map((s) => qs.get(s));
      if (have.some((q) => !q)) root.innerHTML = msg(failed ? `${what} unavailable.\nCheck your connection.` : 'Loading…');
      else root.innerHTML = card(view(have as Quote[], cfg));
    };
    const load = async () => {
      const r = await Promise.allSettled(list.map((s) => getQuote(s).then((q) => void qs.set(s, q))));
      failed = r.some((x) => x.status === 'rejected');
      draw();
    };
    draw();
    void load();
    const t = setInterval(() => void load(), 2 * 60_000);
    return () => {
      alive = false;
      clearInterval(t);
      root.innerHTML = '';
    };
  };
}

const coinSyms = (n: number) => (cfg?: WidgetCfg) => coinsOf(cfg, n);
const crypto = (kind: 'quote' | 'list', size: Sz, n: number) => mount(coinSyms(n), (qs) => CRYPTO[`${kind}-${size}`](qs), 'Crypto');
const currency = (size: Sz, n: number) => mount((cfg) => fxPlan(cfg?.fx, n).syms, (qs, cfg) => FX[size](qs, fxPlan(cfg?.fx, n)), 'Exchange rates');

const moneyIcon = (s: number) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><defs><linearGradient id="mng" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4cd964"/><stop offset="1" stop-color="#1fa84a"/></linearGradient></defs><rect width="24" height="24" rx="5.6" fill="url(#mng)"/><circle cx="12" cy="12" r="6.6" fill="none" stroke="#fff" stroke-width="1.6"/><path d="M13.9 9.6c-.3-.7-1-1.1-1.9-1.1-1.1 0-1.9.6-1.9 1.4 0 2 3.9.9 3.9 3 0 .9-.9 1.5-2 1.5-.9 0-1.7-.4-2-1.2M12 7.2v1.3M12 15.5v1.3" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg>`;

const c = (id: string, group: string, size: Sz, name: string, desc: string, kind: 'quote' | 'list', n: number, icon?: (s: number) => string) => ({
  id, family: 'Money', group, size: size as WidgetSize, name, desc, fields: ['symbols' as const], slots: n, icon, mount: crypto(kind, size, n),
});
const f = (id: string, size: Sz, n: number, desc: string) => ({
  id, family: 'Money', group: 'money-fx', size: size as WidgetSize, name: 'Currency', desc, fields: ['currency' as const], mount: currency(size, n),
});
export default defineWidgets([
  c('crypto-s', 'money-crypto', 'S', 'Crypto', 'Track one coin’s price and how it has moved in the last 24 hours.', 'quote', 1, moneyIcon),
  c('crypto-m', 'money-crypto', 'M', 'Crypto', 'One coin with its price range and a price chart.', 'quote', 1),
  c('crypto-l', 'money-crypto', 'L', 'Crypto', 'One coin in depth: price range, trading volume and a full chart.', 'quote', 1),
  c('crypto-list-m', 'money-crypto-list', 'M', 'Crypto Watchlist', 'Keep an eye on three coins, each with a price chart.', 'list', 3),
  c('crypto-list-l', 'money-crypto-list', 'L', 'Crypto Watchlist', 'Keep an eye on six coins, each with a price chart.', 'list', 6),
  f('fx-s', 'S', 1, 'Convert an amount from one currency to another.'),
  f('fx-m', 'M', 3, 'Convert one amount into three currencies at once.'),
  f('fx-l', 'L', 6, 'Convert one amount into six currencies at once.'),
]);
