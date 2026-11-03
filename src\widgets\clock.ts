import './_styles';
import { defineWidgets, type WidgetCfg } from './_api';
import { $, every, pad2 } from './_shared';
import { esc } from './_native';

export const wkday = (d: Date, w: 'long' | 'short' = 'long') => d.toLocaleDateString('en-US', { weekday: w });
const monthName = (d: Date, w: 'long' | 'short' = 'long') => d.toLocaleDateString('en-US', { month: w });
function timeParts(d: Date, tz?: string, h24 = false) {
  const parts = new Intl.DateTimeFormat(undefined, h24
    ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }
    : { hour: 'numeric', minute: '2-digit', timeZone: tz }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { time: `${get('hour')}:${get('minute')}`, ap: get('dayPeriod') };
}

function analog(k: number, left: number, top: number, side = false) {
  return (root: HTMLElement, cfg?: WidgetCfg) => {
    const tz = cfg?.place?.tz;
    let ticks = '';
    for (let i = 0; i < 60; i++) ticks += `<i class="${i % 5 === 0 ? 'big' : ''}" style="transform:rotate(${i * 6}deg)"></i>`;
    let nums = '';
    for (let n = 1; n <= 12; n++) {
      const a = (n * 30 * Math.PI) / 180;
      nums += `<b style="left:${67 + Math.sin(a) * 47}px;top:${67 - Math.cos(a) * 47}px">${n}</b>`;
    }
    const sideHtml = side
      ? `<div class="n-fill" style="position:absolute;left:${left + 134 * k + 30}px;right:28px;top:26px;bottom:26px;justify-content:center;gap:10px"><div class="n-lbl" id="a-dow"></div><div id="a-time" style="font:300 96px/1 'Inter';letter-spacing:-.03em"></div><div class="n-sub" id="a-date" style="font-size:18px"></div></div>`
      : '';
    root.innerHTML = $(`<div class="wc clk dk"><div class="clk-face" style="left:${left}px;top:${top}px;transform:scale(${k});transform-origin:0 0">${ticks}${nums}
      <div class="hand h"></div><div class="hand m"></div><div class="hand s"></div><div class="dot"></div></div>${sideHtml}</div>`);
    const h = root.querySelector('.h') as HTMLElement;
    const m = root.querySelector('.m') as HTMLElement;
    const s = root.querySelector('.s') as HTMLElement;
    const tick = () => {
      const d = zonedNow(tz);
      const sec = d.getSeconds();
      const min = d.getMinutes() + sec / 60;
      const hr = (d.getHours() % 12) + min / 60;
      h.style.transform = `rotate(${hr * 30}deg)`;
      m.style.transform = `rotate(${min * 6}deg)`;
      s.style.transform = `rotate(${sec * 6}deg)`;
      if (side) {
        root.querySelector('#a-dow')!.textContent = wkday(d).toUpperCase();
        root.querySelector('#a-time')!.textContent = timeParts(d).time;
        root.querySelector('#a-date')!.textContent = `${monthName(d)} ${d.getDate()}, ${d.getFullYear()}`;
      }
    };
    return every(tick, 1000);
  };
}

const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const CITIES: [string, string][] = [
  [localTz.split('/').pop()!.replace(/_/g, ' '), localTz],
  ['New York', 'America/New_York'],
  ['London', 'Europe/London'],
  ['Paris', 'Europe/Paris'],
  ['Dubai', 'Asia/Dubai'],
  ['Tokyo', 'Asia/Tokyo'],
  ['Sydney', 'Australia/Sydney'],
  ['Los Angeles', 'America/Los_Angeles'],
];
function wallMs(tz: string, d: Date) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(d)) p[x.type] = x.value;
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}
function zonedNow(tz?: string) {
  const d = new Date();
  if (!tz) return d;
  try {
    const f = new Date(wallMs(tz, d));
    return new Date(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate(), f.getUTCHours(), f.getUTCMinutes(), f.getUTCSeconds());
  } catch {
    return d;
  }
}
export function effectiveZones(count: number, cfg?: WidgetCfg): { name: string; tz: string }[] {
  const out = (cfg?.zones ?? []).filter((z) => z && z.tz).slice(0, count);
  for (const [name, tz] of CITIES) if (out.length < count && !out.some((o) => o.tz === tz)) out.push({ name, tz });
  return out;
}
function cityInfo(tz: string, now: Date, h24 = false) {
  const there = wallMs(tz, now);
  const here = wallMs(localTz, now);
  const dd = Math.floor(there / 86400000) - Math.floor(here / 86400000);
  const hrs = Math.round(((there - here) / 3600000) * 10) / 10;
  const { time, ap } = timeParts(now, tz, h24);
  return {
    time,
    ap,
    day: dd === 0 ? 'Today' : dd > 0 ? 'Tomorrow' : 'Yesterday',
    diff: hrs === 0 ? '+0HRS' : `${hrs > 0 ? '+' : '-'}${Math.abs(hrs)}HRS`,
  };
}
function world(count: number, grid: boolean, fs: number) {
  return (root: HTMLElement, cfg?: WidgetCfg) =>
    every(() => {
      const now = new Date();
      const items = effectiveZones(count, cfg).map(({ name, tz }) => ({ name, ...cityInfo(tz, now, !!cfg?.h24) }));
      if (grid) {
        root.innerHTML = $(`<div class="wc solid dk" style="padding:18px 26px"><div class="n-wg">${items
          .map((c) => `<div><div class="n-sub" style="font-size:12px">${c.day}, ${c.diff}</div><div style="font:600 17px/1.2 'Inter'">${esc(c.name)}</div>
            <div style="font:300 ${fs}px/1.1 'Inter';letter-spacing:-.02em">${c.time}<span style="font:500 14px 'Inter';margin-left:4px;opacity:.7">${c.ap}</span></div></div>`)
          .join('')}</div></div>`);
      } else {
        root.innerHTML = $(`<div class="wc solid dk" style="padding:8px 18px"><div class="n-wlist">${items
          .map((c) => `<div class="n-wr"><div><div class="n-sub" style="font-size:11px">${c.day}, ${c.diff}</div><div style="font:600 15px/1.25 'Inter'">${esc(c.name)}</div></div>
            <div style="font:300 ${fs}px/1 'Inter';letter-spacing:-.02em">${c.time}<span style="font:500 12px 'Inter';margin-left:3px;opacity:.7">${c.ap}</span></div></div>`)
          .join('')}</div></div>`);
      }
    }, 5000);
}

type Pt = [number, number, number, number];
function perimeter(n: number, m: number, a: number, r: number): Pt[] {
  const sl = a - 2 * r, arc = (Math.PI * r) / 2;
  type Seg = { len: number; at: (u: number) => Pt };
  const ang = (cx: number, cy: number, a0: number): Seg['at'] => (u) => {
    const th = ((a0 + 90 * u) * Math.PI) / 180;
    return [cx + r * Math.cos(th), cy + r * Math.sin(th), -Math.cos(th), -Math.sin(th)];
  };
  const segs: Seg[] = [
    { len: sl / 2, at: (u) => [m + a / 2 + u * (sl / 2), m, 0, 1] },
    { len: arc, at: ang(m + a - r, m + r, -90) },
    { len: sl, at: (u) => [m + a, m + r + u * sl, -1, 0] },
    { len: arc, at: ang(m + a - r, m + a - r, 0) },
    { len: sl, at: (u) => [m + a - r - u * sl, m + a, 0, -1] },
    { len: arc, at: ang(m + r, m + a - r, 90) },
    { len: sl, at: (u) => [m, m + a - r - u * sl, 1, 0] },
    { len: arc, at: ang(m + r, m + r, 180) },
    { len: sl / 2, at: (u) => [m + r + u * (sl / 2), m, 0, 1] },
  ];
  const total = segs.reduce((x, g) => x + g.len, 0);
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    let d = (i / n) * total;
    let g = 0;
    while (g < segs.length - 1 && d > segs[g].len) d -= segs[g++].len;
    out.push(segs[g].at(Math.min(1, d / segs[g].len)));
  }
  return out;
}
type RingInk = { on: string; off: string };
const INK_LIGHT: RingInk = { on: '#1c1c1e', off: '#c9c9ce' };
const INK_DARK: RingInk = { on: '#ffffff', off: '#4a4a4d' };
function tickRing(sec: number, ink: RingInk = INK_LIGHT) {
  let out = '';
  perimeter(60, 8, 142, 20).forEach(([x, y, nx, ny], i) => {
    const on = i <= sec;
    const L = on ? 11 : 8;
    out += `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + nx * L).toFixed(1)}" y2="${(y + ny * L).toFixed(1)}" stroke="${on ? ink.on : ink.off}" stroke-width="${on ? 2.6 : 1.7}" stroke-linecap="round"/>`;
  });
  return `<svg style="position:absolute;left:0;top:0" width="158" height="158" viewBox="0 0 158 158">${out}</svg>`;
}
const CODES: Record<string, string> = { 'new york': 'NYC', 'los angeles': 'LA', 'san francisco': 'SF', 'washington': 'DC', 'hong kong': 'HKG', 'mexico city': 'CDMX' };
function cityCode(name?: string) {
  const c = name ?? (localTz.split('/').pop() || '').replace(/_/g, ' ');
  if (CODES[c.toLowerCase()]) return CODES[c.toLowerCase()];
  const w = c.split(' ').filter(Boolean);
  return (w.length > 1 ? w.map((x) => x[0]).join('') : c.slice(0, 3)).toUpperCase() || 'UTC';
}

const NYC = { name: 'New York', tz: 'America/New_York' };
function cityOf(cfg?: WidgetCfg) {
  const p = cfg?.place;
  return p?.tz ? { name: p.name, tz: p.tz } : NYC;
}
function hoursAway(tz: string, now: Date) {
  const h = Math.round(((wallMs(tz, now) - wallMs(localTz, now)) / 3600000) * 10) / 10;
  return h === 0 ? '' : `${h > 0 ? '+' : '−'}${Math.abs(h)}`;
}


const _ink = document.createElement('canvas').getContext('2d')!;
function digitsAt(time: string, px: number, maxW: number, sx = 0.84, W = 158, weight = 800, ls = -0.07) {
  _ink.font = `${weight} ${px}px Inter`;
  (_ink as unknown as { letterSpacing: string }).letterSpacing = `${(ls * px).toFixed(2)}px`;
  const m = _ink.measureText(time);
  let ink = (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) * sx;
  let size = px;
  if (ink > maxW && ink > 0) {
    size = px * (maxW / ink);
    _ink.font = `${weight} ${size}px Inter`;
    (_ink as unknown as { letterSpacing: string }).letterSpacing = `${(ls * size).toFixed(2)}px`;
    const m2 = _ink.measureText(time);
    ink = (m2.actualBoundingBoxLeft + m2.actualBoundingBoxRight) * sx;
    const tx = W / 2 - ((m2.actualBoundingBoxRight - m2.actualBoundingBoxLeft) / 2) * sx;
    return { size, tx };
  }
  return { size, tx: W / 2 - ((m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2) * sx };
}
const digitsHtml = (time: string, base: number, maxW: number) => {
  const { size, tx } = digitsAt(time, base, maxW);
  return `<span style="position:absolute;left:0;top:0;font:800 ${size.toFixed(2)}px/1 Inter;letter-spacing:-.07em;white-space:nowrap;transform-origin:0 0;transform:translateX(${tx.toFixed(2)}px) scaleX(.84)">${time}</span>`;
};

function digitalTicks(dark: boolean, city: boolean) {
  return (root: HTMLElement, cfg?: WidgetCfg) => {
    const c = cityOf(cfg);
    const code = cityCode(c.name);
    const grey = '#8e8e93';
    return every(() => {
      const d = zonedNow(city ? c.tz : cfg?.place?.tz);
      const time = cfg?.h24 ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : `${d.getHours() % 12 || 12}:${pad2(d.getMinutes())}`;
      const off = city ? hoursAway(c.tz, new Date()) : '';
      root.innerHTML = $(`<div class="wc opq" style="background:${dark ? '#000' : '#fff'};color:${dark ? '#fff' : '#1c1c1e'}">${tickRing(d.getSeconds(), dark ? INK_DARK : INK_LIGHT)}
        ${city ? `<div style="position:absolute;left:0;right:0;top:34px;text-align:center;font:700 14px/1 Inter;letter-spacing:.03em;color:${grey}">${code}</div>` : ''}
        <div style="position:absolute;left:0;right:0;top:${city ? 54 : 46}px;height:70px">${digitsHtml(time, time.length > 4 ? 54 : 70, 112)}</div>
        ${city && off ? `<div style="position:absolute;left:0;right:0;top:123px;text-align:center;font:700 14px/1 Inter;letter-spacing:.03em;color:${grey}">${off}</div>` : ''}</div>`);
    }, 1000);
  };
}

type Face = 'classic' | 'bars' | 'square';
function face(kind: Face, city: boolean) {
  return (root: HTMLElement, cfg?: WidgetCfg) => {
    const c = cityOf(cfg);
    const tz = city ? c.tz : cfg?.place?.tz;
    const C = 79;
    const ink = kind === 'bars' ? '#fff' : '#000';
    let marks = '';
    if (kind === 'classic') {
      marks += `<circle cx="${C}" cy="${C}" r="67" fill="#fff"/>`;
      for (let i = 0; i < 60; i++) {
        const big = i % 5 === 0, a = (i * 6 * Math.PI) / 180, r1 = 64, r0 = big ? 57 : 60;
        marks += `<line x1="${C + Math.sin(a) * r0}" y1="${C - Math.cos(a) * r0}" x2="${C + Math.sin(a) * r1}" y2="${C - Math.cos(a) * r1}" stroke="${big ? '#000' : 'rgba(0,0,0,.4)'}" stroke-width="${big ? 1.6 : 1}" stroke-linecap="round"/>`;
      }
      for (let n = 1; n <= 12; n++) {
        const a = (n * 30 * Math.PI) / 180;
        marks += `<text x="${(C + Math.sin(a) * 45).toFixed(1)}" y="${(C - Math.cos(a) * 45 + 5.2).toFixed(1)}" text-anchor="middle" font-family="Inter" font-weight="600" font-size="14.5" fill="#000">${n}</text>`;
      }
    } else if (kind === 'bars') {
      for (let i = 0; i < 12; i++) {
        const a = (i * 30 * Math.PI) / 180;
        marks += `<line x1="${C + Math.sin(a) * 50}" y1="${C - Math.cos(a) * 50}" x2="${C + Math.sin(a) * 64}" y2="${C - Math.cos(a) * 64}" stroke="rgba(255,255,255,.62)" stroke-width="3.6" stroke-linecap="round"/>`;
      }
    } else {
      perimeter(60, 8, 142, 30).forEach(([x, y, nx, ny], i) => {
        const L = i % 5 === 0 ? 8 : 5;
        marks += `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + nx * L).toFixed(1)}" y2="${(y + ny * L).toFixed(1)}" stroke="#1c1c1e" stroke-width="${i % 5 === 0 ? 1.8 : 1}" stroke-linecap="round"/>`;
      });
      for (const [n, x, y] of [[12, 79, 46], [3, 118, 87], [6, 79, 128], [9, 40, 87]] as const) {
        marks += `<text transform="translate(${x} ${y}) scale(.86 1)" text-anchor="middle" font-family="Inter" font-weight="800" font-size="26" fill="#1c1c1e">${n}</text>`;
      }
    }
    const grey = kind === 'bars' ? 'rgba(255,255,255,.6)' : '#8e8e93';
    const label = (t: string, y: number) => (t ? `<text x="${C}" y="${y}" text-anchor="middle" font-family="Inter" font-weight="700" font-size="11.5" letter-spacing=".3" fill="${grey}">${esc(t)}</text>` : '');
    const hand = (id: string, w: number, len: number, tail: number, col: string) =>
      `<g class="${id}"><rect x="${C - w / 2}" y="${C - len}" width="${w}" height="${len + tail}" rx="${w / 2}" fill="${col}"/></g>`;
    const hCol = kind === 'square' ? '#1c1c1e' : ink;
    const body = `${marks}<g class="lbl"></g>${hand('hh', 4.4, kind === 'square' ? 34 : 32, 6, hCol)}${hand('mm', 3.4, kind === 'square' ? 54 : 48, 6, hCol)}
      <circle cx="${C}" cy="${C}" r="4.4" fill="${hCol}"/>${hand('ss', 1.4, kind === 'square' ? 58 : 56, 14, '#ff9f0a')}<circle cx="${C}" cy="${C}" r="2.3" fill="#ff9f0a"/>`;
    const cls = kind === 'square' ? 'wc opq' : 'wc clk dk';
    root.innerHTML = $(`<div class="${cls}"${kind === 'square' ? ' style="background:#fff;color:#1c1c1e"' : ''}><svg style="position:absolute;left:0;top:0" width="158" height="158" viewBox="0 0 158 158">${body}</svg></div>`);
    const q = (k: string) => root.querySelector(`.${k}`) as SVGGElement;
    const [hh, mm, ss, lbl] = [q('hh'), q('mm'), q('ss'), q('lbl')];
    return every(() => {
      const d = zonedNow(tz);
      const sec = d.getSeconds();
      const min = d.getMinutes() + sec / 60;
      const hr = (d.getHours() % 12) + min / 60;
      hh.setAttribute('transform', `rotate(${hr * 30} ${C} ${C})`);
      mm.setAttribute('transform', `rotate(${min * 6} ${C} ${C})`);
      ss.setAttribute('transform', `rotate(${sec * 6} ${C} ${C})`);
      if (city) lbl.innerHTML = label(cityCode(c.name), kind === 'square' ? 66 : 62) + label(hoursAway(c.tz, new Date()), 106);
    }, 1000);
  };
}

export default defineWidgets([
  {
    id: 'clock', family: 'Clock', group: 'clock-analog', size: 'S',
    name: 'Clock',
    desc: 'A classic analog clock for your time zone, or for any city you choose.',
    fields: ['place'],
    mount: analog(1, 12, 12),
  },
  {
    id: 'clock-bars', family: 'Clock', group: 'clock-bars', size: 'S',
    name: 'Clock',
    desc: 'An analog clock with bar markers for the hours instead of numbers.',
    fields: ['place'],
    mount: face('bars', false),
  },
  {
    id: 'clock-sq', family: 'Clock', group: 'clock-square', size: 'S',
    name: 'Clock',
    desc: 'An analog clock set on a square face.',
    fields: ['place'],
    mount: face('square', false),
  },
  {
    id: 'clock-city', family: 'Clock', group: 'clock-city', size: 'S',
    name: 'City Clock',
    desc: 'A classic analog clock for any city, with how many hours ahead or behind it is.',
    fields: ['place'],
    mount: face('classic', true),
  },
  {
    id: 'clock-city-bars', family: 'Clock', group: 'clock-city-bars', size: 'S',
    name: 'City Clock',
    desc: 'The bar-marker analog clock for any city, with the time difference from you.',
    fields: ['place'],
    mount: face('bars', true),
  },
  {
    id: 'clock-city-sq', family: 'Clock', group: 'clock-city-square', size: 'S',
    name: 'City Clock',
    desc: 'The square-face analog clock for any city, with the time difference from you.',
    fields: ['place'],
    mount: face('square', true),
  },
  {
    id: 'clock-d-time', family: 'Clock', group: 'clock-digital-plain', size: 'S',
    name: 'Digital Clock',
    desc: 'A clean digital clock with a ring that counts the seconds. 24-hour time is in settings.',
    fields: ['place', 'h24'],
    mount: digitalTicks(false, false),
  },
  {
    id: 'clock-d-city', family: 'Clock', group: 'clock-digital-city', size: 'S',
    name: 'City Digital Clock',
    desc: 'A digital clock for any city you choose, with the time difference from you.',
    fields: ['place', 'h24'],
    mount: digitalTicks(false, true),
  },
  {
    id: 'clock-d-city-k', family: 'Clock', group: 'clock-digital-city-black', size: 'S',
    name: 'City Digital Clock',
    desc: 'The digital city clock in black, for a bolder, high-contrast look.',
    fields: ['place', 'h24'],
    mount: digitalTicks(true, true),
  },
  {
    id: 'world-m', family: 'Clock', group: 'clock-world', size: 'M',
    name: 'World Clock',
    desc: 'See the time in three cities at once.',
    fields: ['zones', 'h24'],
    slots: 3,
    mount: world(3, false, 26),
  },
  {
    id: 'world-l', family: 'Clock', group: 'clock-world', size: 'L',
    name: 'World Clock',
    desc: 'See the time in six cities at once.',
    fields: ['zones', 'h24'],
    slots: 6,
    mount: world(6, false, 28),
  },
]);
