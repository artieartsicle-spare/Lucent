import { locateByIp, onWhere, savedPlace } from './_where';

export const every = (fn: () => void, ms: number) => {
  fn();
  const t = setInterval(fn, ms);
  return () => clearInterval(t);
};

export const $ = (html: string) => html.replace(/\s*\n\s*/g, '');
export const pad2 = (n: number) => String(n).padStart(2, '0');

const SVG = (inner: string, s = 20, vb = 24) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 ${vb} ${vb}" fill="none" stroke="none">${inner}</svg>`;
export const I = {
  sun: (s = 20) =>
    SVG(
      `<circle cx="12" cy="12" r="4.6" fill="#ffd60a"/><g stroke="#ffd60a" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.6v2.4M12 19v2.4M2.6 12H5M19 12h2.4M5.4 5.4l1.7 1.7M16.9 16.9l1.7 1.7M5.4 18.6l1.7-1.7M16.9 7.1l1.7-1.7"/></g>`,
      s
    ),
  moon: (s = 20) =>
    SVG(`<path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1Z" fill="#e8e8f0"/><path d="M17.6 3.2l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5Z" fill="#e8e8f0"/>`, s),
  cloud: (s = 20) => SVG(`<path d="M7.2 18.5a4.2 4.2 0 0 1-.6-8.4 5.6 5.6 0 0 1 10.9 1.2 3.7 3.7 0 0 1-.3 7.2Z" fill="#e9edf5"/>`, s),
  partly: (s = 20, day = true) =>
    SVG(
      `${day ? `<circle cx="9" cy="9" r="3.6" fill="#ffd60a"/>` : `<path d="M13 6.4A4.6 4.6 0 1 1 6.4 13 5 5 0 0 0 13 6.4Z" fill="#e8e8f0"/>`}<path d="M9 20a3.6 3.6 0 0 1-.4-7.2 4.8 4.8 0 0 1 9.3 1 3.1 3.1 0 0 1-.3 6.2Z" fill="#e9edf5"/>`,
      s
    ),
  rain: (s = 20) =>
    SVG(
      `<path d="M7.2 15.4a4 4 0 0 1-.5-8 5.4 5.4 0 0 1 10.4 1.1 3.5 3.5 0 0 1-.3 6.9Z" fill="#cfd6e4"/><g stroke="#5ac8fa" stroke-width="1.8" stroke-linecap="round"><path d="M8.4 18l-.8 2.6M12.4 18l-.8 2.6M16.4 18l-.8 2.6"/></g>`,
      s
    ),
  snow: (s = 20) =>
    SVG(
      `<path d="M7.2 15.4a4 4 0 0 1-.5-8 5.4 5.4 0 0 1 10.4 1.1 3.5 3.5 0 0 1-.3 6.9Z" fill="#dfe5f0"/><g fill="#fff"><circle cx="8.4" cy="19" r="1.2"/><circle cx="12.4" cy="20.2" r="1.2"/><circle cx="16.4" cy="19" r="1.2"/></g>`,
      s
    ),
  bolt: (s = 20) =>
    SVG(
      `<path d="M7.2 14.6a4 4 0 0 1-.5-8 5.4 5.4 0 0 1 10.4 1.1 3.5 3.5 0 0 1-.3 6.9Z" fill="#aeb6c6"/><path d="M12.8 12.2l-3 5h2.4l-1 4 3.8-5.4h-2.4Z" fill="#ffd60a"/>`,
      s
    ),
  fog: (s = 20) =>
    SVG(`<path d="M7.2 13.4a4 4 0 0 1-.5-8 5.4 5.4 0 0 1 10.4 1.1 3.5 3.5 0 0 1-.3 6.9Z" fill="#cfd6e4"/><g stroke="#e9edf5" stroke-width="1.8" stroke-linecap="round"><path d="M5 17h14M7 20.4h10"/></g>`, s),
  arrow: (s = 12) => SVG(`<path d="M20.5 3.5 3.8 10.7l6.3 2.2 2.2 6.3Z" fill="#fff"/>`, s),
  laptop: (s = 30) =>
    SVG(
      `<rect x="5.2" y="6" width="21.6" height="14" rx="2.2" style="fill:var(--w-ink-soft,rgba(255,255,255,.55));stroke:var(--w-ink-hi,rgba(255,255,255,.9))" stroke-width="1.4"/><path d="M2.6 22.4h26.8c-.4 1.4-1.4 2.2-2.8 2.2H5.4c-1.4 0-2.4-.8-2.8-2.2Z" style="fill:var(--w-ink-hi,rgba(255,255,255,.9))"/>`,
      s,
      32
    ),
};
let uidN = 0;
export const nid = () => `w${++uidN}`;
export const hair = 'rgba(255,255,255,.14)';

export type Loc = { lat: number; lon: number; city: string };
const LOC_KEY = 'lucent-loc-v1';
let locPromise: Promise<Loc> | null = null;
onWhere(() => {
  locPromise = null;
});
export function getLoc(): Promise<Loc> {
  return (locPromise ??= (async () => {
    const sp = savedPlace();
    if (sp) return { lat: sp.lat, lon: sp.lon, city: sp.name };
    try {
      const c = JSON.parse(localStorage.getItem(LOC_KEY) || 'null');
      if (c && Date.now() - c.at < 86400000) return c.data as Loc;
    } catch {
    }
    const f = await locateByIp();
    const data: Loc = { lat: f.lat, lon: f.lon, city: f.city };
    try {
      localStorage.setItem(LOC_KEY, JSON.stringify({ at: Date.now(), data }));
    } catch {
    }
    return data;
  })().catch((e) => {
    locPromise = null;
    throw e;
  }));
}

export const RAD = Math.PI / 180;
export const DAY = 86400000;
export const J1970 = 2440588;
export const J2000 = 2451545;
export const OBL = RAD * 23.4397;
export const toDays = (d: Date) => d.valueOf() / DAY - 0.5 + J1970 - J2000;
export const decl = (l: number, b: number) => Math.asin(Math.sin(b) * Math.cos(OBL) + Math.cos(b) * Math.sin(OBL) * Math.sin(l));

const RING_R = 27;
export function ring(pct: number, w = 6, r = RING_R, size = 60, color = '#30d158') {
  const c = size / 2;
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" style="stroke:var(--w-track,rgba(255,255,255,.22))" stroke-width="${w}"/>
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" style="stroke:${color}" stroke-width="${w}" stroke-linecap="round" pathLength="100"
      stroke-dasharray="${pct} ${100 - pct + 0.001}" transform="rotate(-90 ${c} ${c})"/></svg>`;
}
export const ampm = (d: Date) => `${d.getHours() % 12 || 12}:${pad2(d.getMinutes())}<small>${d.getHours() < 12 ? 'am' : 'pm'}</small>`;