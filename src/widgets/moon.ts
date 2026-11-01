import { defineWidgets } from './_api';
import './_styles';
import { $, ampm, decl, every, getLoc, type Loc, nid, OBL, RAD, toDays } from './_shared';
import { onWhere } from './_where';

const rightAsc = (l: number, b: number) => Math.atan2(Math.sin(l) * Math.cos(OBL) - Math.tan(b) * Math.sin(OBL), Math.cos(l));
const sidereal = (d: number, lw: number) => RAD * (280.16 + 360.9856235 * d) - lw;
function moonAlt(date: Date, lat: number, lon: number) {
  const d = toDays(date);
  const L = RAD * (218.316 + 13.176396 * d);
  const M = RAD * (134.963 + 13.064993 * d);
  const F = RAD * (93.272 + 13.22935 * d);
  const l = L + RAD * 6.289 * Math.sin(M);
  const b = RAD * 5.128 * Math.sin(F);
  const dec = decl(l, b);
  const H = sidereal(d, RAD * -lon) - rightAsc(l, b);
  const phi = RAD * lat;
  const h = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const hh = Math.max(h, 0);
  return h + 0.0002967 / Math.tan(hh + 0.00312536 / (hh + 0.08901179));
}
function moonTimes(day: Date, lat: number, lon: number): { rise?: Date; set?: Date } {
  const at = (h: number) => new Date(day.getTime() + h * 3600000);
  const hc = 0.133 * RAD;
  let h0 = moonAlt(at(0), lat, lon) - hc;
  let rise = 0;
  let set = 0;
  for (let i = 1; i <= 24; i += 2) {
    const h1 = moonAlt(at(i), lat, lon) - hc;
    const h2 = moonAlt(at(i + 1), lat, lon) - hc;
    const a = (h0 + h2) / 2 - h1;
    const b = (h2 - h0) / 2;
    const xe = -b / (2 * a);
    const ye = (a * xe + b) * xe + h1;
    const dd = b * b - 4 * a * h1;
    let roots = 0;
    let x1 = 0;
    let x2 = 0;
    if (dd >= 0) {
      const dx = Math.sqrt(dd) / (Math.abs(a) * 2);
      x1 = xe - dx;
      x2 = xe + dx;
      if (Math.abs(x1) <= 1) roots++;
      if (Math.abs(x2) <= 1) roots++;
      if (x1 < -1) x1 = x2;
    }
    if (roots === 1) {
      if (h0 < 0) rise = i + x1;
      else set = i + x1;
    } else if (roots === 2) {
      rise = i + (ye < 0 ? x2 : x1);
      set = i + (ye < 0 ? x1 : x2);
    }
    if (rise && set) break;
    h0 = h2;
  }
  return { rise: rise ? at(rise) : undefined, set: set ? at(set) : undefined };
}

const SYN = 29.530588853;
const moonAge = (d: Date) => ((((d.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000) % SYN) + SYN) % SYN;
const PHASES = ['New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous', 'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'];
const phaseName = (f: number) => PHASES[Math.floor(((f + 1 / 16) % 1) * 8)];
const daysUntil = (target: number, f: number) => {
  let x = (target - f + 1) % 1;
  if (x < 0.002) x += 1;
  return x * SYN;
};
function moonSvg(f: number, s: number, shade = '#0b0824', shadeOp: number | string = 0.94) {
  const id = nid();
  const R = s / 2 - 0.5;
  const c = s / 2;
  const u = R / 50;
  const X = (v: number) => (c + v * u).toFixed(2);
  const L = (v: number) => (v * u).toFixed(2);
  const mare = (x: number, y: number, rx: number, ry: number, rot = 0, o = 0.55) =>
    `<ellipse cx="${X(x)}" cy="${X(y)}" rx="${L(rx)}" ry="${L(ry)}" transform="rotate(${rot} ${X(x)} ${X(y)})" fill="#5a5a68" fill-opacity="${o}"/>`;
  const crater = (x: number, y: number, r: number, bright = false) =>
    `<circle cx="${X(x)}" cy="${X(y)}" r="${L(r)}" fill="${bright ? '#fff' : '#000'}" fill-opacity="${bright ? 0.5 : 0.13}" stroke="#fff" stroke-opacity="${bright ? 0.5 : 0.16}" stroke-width="${(0.35 * u).toFixed(2)}"/>`;
  const waning = f > 0.5;
  const cs = Math.cos(2 * Math.PI * (waning ? 1 - f : f));
  const rx = (Math.abs(cs) * R).toFixed(2);
  const lit = `M ${c} ${c - R} A ${R} ${R} 0 0 1 ${c} ${c + R} A ${rx} ${R} 0 0 ${cs > 0 ? 0 : 1} ${c} ${c - R} Z`;
  return `<svg class="disc" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" style="display:block;flex:none"><defs>
    <clipPath id="${id}c"><circle cx="${c}" cy="${c}" r="${R}"/></clipPath>
    <radialGradient id="${id}g" cx=".4" cy=".36" r=".75"><stop offset="0" stop-color="#f1f0ee"/><stop offset=".55" stop-color="#cfcdd0"/><stop offset="1" stop-color="#8f8e9a"/></radialGradient>
    <radialGradient id="${id}l" cx=".5" cy=".5" r=".5"><stop offset=".72" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".38"/></radialGradient>
    <filter id="${id}b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${(1.6 * u).toFixed(2)}"/></filter>
    <filter id="${id}s" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="${(0.045 * s).toFixed(2)}"/></filter>
    <filter id="${id}n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${(2.2 / Math.max(s, 60)).toFixed(4)}" numOctaves="3" seed="5"/><feColorMatrix values="0 0 0 0 .45  0 0 0 0 .45  0 0 0 0 .5  0 0 0 .9 -.25"/></filter>
    <mask id="${id}m"><rect width="${s}" height="${s}" fill="#fff"/><path d="${lit}" fill="#000"${waning ? ` transform="translate(${s} 0) scale(-1 1)"` : ''} filter="url(#${id}s)"/></mask></defs>
    <g clip-path="url(#${id}c)">
      <rect width="${s}" height="${s}" fill="url(#${id}g)"/>
      <g filter="url(#${id}b)">${mare(-30, -3, 15, 24, -10)}${mare(-14, -24, 17, 12, 8, 0.6)}${mare(9, -21, 10, 9)}${mare(21, -4, 14, 10, 10, 0.6)}${mare(38, -13, 7, 5, -20, 0.55)}${mare(31, 13, 9, 7, 20)}${mare(10, 4, 6, 5, 0, 0.4)}${mare(-12, 23, 13, 8, 10, 0.5)}${mare(-31, 22, 6, 6)}${mare(2, -40, 20, 4, 5, 0.4)}</g>
      ${crater(-8, 38, 5, true)}${crater(-19, -5, 3.6, true)}${crater(-31, -9, 2.8)}${crater(15, 26, 4)}${crater(-36, 8, 3)}${crater(28, 32, 3.2)}${crater(40, 6, 2.6)}${crater(-2, -28, 2.8)}${crater(0, 17, 2.4)}${crater(-22, 30, 3.4)}${crater(-42, -20, 2.6)}${crater(18, -34, 3)}${crater(6, 42, 3.4)}
      <rect width="${s}" height="${s}" filter="url(#${id}n)" opacity=".32" style="mix-blend-mode:multiply"/>
      <circle cx="${c}" cy="${c}" r="${R}" fill="url(#${id}l)"/>
      <circle cx="${c}" cy="${c}" r="${R + 2}" style="fill:${shade};fill-opacity:${shadeOp}" mask="url(#${id}m)"/>
    </g></svg>`;
}
const dayWord = (n: number) => (n <= 0 ? 'Today' : n === 1 ? '1<small>day</small>' : `${n}<small>days</small>`);
const moonGlyph = `<svg width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2.5a9.5 9.5 0 0 1 0 19Z" fill="currentColor"/></svg>`;

function moon(size: 'S' | 'M') {
  return (root: HTMLElement) => {
    let loc: Loc | null = null;
    const draw = () => {
      const now = new Date();
      const f = moonAge(now) / SYN;
      const ill = Math.round(((1 - Math.cos(2 * Math.PI * f)) / 2) * 100);
      const name = phaseName(f);
      const img = (px: number) => moonSvg(f, px, 'var(--w-shade,#161a2c)', 'var(--w-shade-op,0.8)');
      if (size === 'S') {
        root.innerHTML = $(`<div class="wc solid lt"><div class="nv">
          <div class="nv-h" style="position:absolute;left:14px;top:14px;right:10px">${moonGlyph}<span style="overflow:hidden;text-overflow:ellipsis">${name}</span></div>
          <div style="position:absolute;left:35px;top:44px">${img(88)}</div></div></div>`);
        return;
      }
      let rise = '--';
      if (loc) {
        for (let k = 0; k < 3; k++) {
          const t = moonTimes(new Date(now.getFullYear(), now.getMonth(), now.getDate() + k), loc.lat, loc.lon);
          if (t.rise && t.rise > now) { rise = ampm(t.rise); break; }
        }
      }
      const toFull = Math.round(daysUntil(0.5, f));
      root.innerHTML = $(`<div class="wc solid lt"><div class="nv">
        <div class="nv-h" style="position:absolute;left:18px;top:15px">${moonGlyph}<span>${name}</span></div>
        <div class="nv-rows" style="position:absolute;left:18px;right:150px;top:40px;bottom:10px">
          <div class="nv-r"><span>Illumination</span><b>${ill}%</b></div>
          <div class="nv-r"><span>Moonrise</span><b>${rise}</b></div>
          <div class="nv-r"><span>Next Full Moon</span><b>${dayWord(toFull)}</b></div></div>
        <div style="position:absolute;right:16px;top:17px">${img(124)}</div></div></div>`);
    };
    const stop = every(draw, 30000);
    const load = () => getLoc().then((l) => { loc = l; draw(); }).catch(() => undefined);
    load();
    const off = onWhere(load);
    return () => {
      off();
      stop();
    };
  };
}

export default defineWidgets([
  {
    id: 'moon-s', family: 'Moon', group: 'moon', size: 'S',
    name: 'Moon',
    desc: 'Tonight’s moon phase and what time it rises.',
    mount: moon('S'),
  },
  {
    id: 'moon-m', family: 'Moon', group: 'moon', size: 'M',
    name: 'Moon',
    desc: 'Moon phase, how much of it is lit, moonrise time and the date of the next full moon.',
    mount: moon('M'),
  },
]);
