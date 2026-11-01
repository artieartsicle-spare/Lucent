import { defineWidgets } from './_api';
import './_styles';
import { $, ampm, DAY, decl, every, getLoc, J1970, J2000, type Loc, nid, RAD, toDays } from './_shared';
import { onWhere } from './_where';

const fromJulian = (j: number) => new Date((j + 0.5 - J1970) * DAY);
const solarM = (d: number) => RAD * (357.5291 + 0.98560028 * d);
const eclLong = (M: number) => {
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + RAD * 102.9372 + Math.PI;
};
function sunAt(date: Date, lat: number, lon: number, deg: number) {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const n = Math.round(toDays(date) - 0.0009 - lw / (2 * Math.PI));
  const ds = 0.0009 + lw / (2 * Math.PI) + n;
  const M = solarM(ds);
  const L = eclLong(M);
  const dec = decl(L, 0);
  const transit = (x: number) => J2000 + x + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const w = Math.acos((Math.sin(deg * RAD) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
  if (isNaN(w)) return null;
  const noon = transit(ds);
  const set = transit(0.0009 + (w + lw) / (2 * Math.PI) + n);
  return { rise: fromJulian(noon - (set - noon)), set: fromJulian(set) };
}

const inText = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60000));
  const h = Math.floor(m / 60);
  return h ? `${h} hr, ${m % 60} min` : `${m} min`;
};
export const dayDiff = (d: Date, now: Date) =>
  Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / DAY);
const sunGlyph = `<svg width="15" height="15" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.6" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></g></svg>`;

type SunDay = { mBlue: Date; mGold: Date; rise: Date; mGoldEnd: Date; eGold: Date; set: Date; eGoldEnd: Date; eBlueEnd: Date };
function sunDays(now: Date, lat: number, lon: number): SunDay[] {
  const out: SunDay[] = [];
  for (let k = -1; k <= 2; k++) {
    const noon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + k, 12);
    const a = sunAt(noon, lat, lon, -0.833);
    const g6 = sunAt(noon, lat, lon, 6);
    const g4 = sunAt(noon, lat, lon, -4);
    const b8 = sunAt(noon, lat, lon, -8);
    if (a && g6 && g4 && b8) out.push({ mBlue: b8.rise, mGold: g4.rise, rise: a.rise, mGoldEnd: g6.rise, eGold: g6.set, set: a.set, eGoldEnd: g4.set, eBlueEnd: b8.set });
  }
  return out;
}
const sunDisc = (px: number) => {
  const id = nid();
  return `<svg class="disc" width="${px}" height="${px}" viewBox="0 0 100 100" style="display:block"><defs>
    <radialGradient id="${id}a" cx=".5" cy=".5" r=".5"><stop offset=".3" stop-color="#ffd24a" stop-opacity=".55"/><stop offset="1" stop-color="#ffb02e" stop-opacity="0"/></radialGradient>
    <radialGradient id="${id}b" cx=".4" cy=".36" r=".72"><stop offset="0" stop-color="#fff3b8"/><stop offset=".5" stop-color="#ffd24a"/><stop offset="1" stop-color="#ff9f1c"/></radialGradient></defs>
    <circle cx="50" cy="50" r="50" fill="url(#${id}a)"/><circle cx="50" cy="50" r="31" fill="url(#${id}b)"/></svg>`;
};
function sun(size: 'S' | 'M') {
  return (root: HTMLElement) => {
    let loc: Loc | null = null;
    const draw = () => {
      const now = new Date();
      const days = loc ? sunDays(now, loc.lat, loc.lon) : [];
      const today = days.find((d) => dayDiff(d.set, now) === 0) ?? days[1];
      const ev = days.flatMap((d) => [{ n: 'Sunrise', at: d.rise }, { n: 'Sunset', at: d.set }]).filter((e) => e.at > now).sort((a, b) => a.at.getTime() - b.at.getTime())[0];
      const head = ev ? `${ev.n}` : 'Sun';
      if (size === 'S') {
        root.innerHTML = $(`<div class="wc solid lt"><div class="nv">
          <div class="nv-h" style="position:absolute;left:14px;top:14px">${sunGlyph}<span>${head}</span></div>
          <div style="position:absolute;right:-6px;top:30px">${sunDisc(92)}</div>
          <div class="nv-big" style="position:absolute;left:14px;bottom:14px">${ev ? ampm(ev.at) : '--'}</div></div></div>`);
        return;
      }
      const t = (d?: Date) => (d ? ampm(d) : '--');
      root.innerHTML = $(`<div class="wc solid lt"><div class="nv">
        <div class="nv-h" style="position:absolute;left:18px;top:15px">${sunGlyph}<span>${ev ? `${ev.n} in ${inText(ev.at.getTime() - now.getTime())}` : 'Sun'}</span></div>
        <div class="nv-rows" style="position:absolute;left:18px;right:150px;top:40px;bottom:10px">
          <div class="nv-r"><span>Sunrise</span><b>${t(today?.rise)}</b></div>
          <div class="nv-r"><span>Sunset</span><b>${t(today?.set)}</b></div>
          <div class="nv-r"><span>Golden Hour</span><b>${t(today?.eGold)}</b></div></div>
        <div style="position:absolute;right:6px;top:8px">${sunDisc(142)}</div></div></div>`);
    };
    const stop = every(draw, 20000);
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
    id: 'sun-s', family: 'Sun', group: 'sun', size: 'S',
    name: 'Sun',
    desc: 'When the sun next rises or sets.',
    mount: sun('S'),
  },
  {
    id: 'sun-m', family: 'Sun', group: 'sun', size: 'M',
    name: 'Sun',
    desc: 'Sunrise, sunset and golden hour times for your location.',
    mount: sun('M'),
  },
]);
