import './_styles';
import { defineWidgets, type Place, type WidgetCfg } from './_api';
import { $, I } from './_shared';
import { esc } from './_native';
import { locateByIp, onWhere, savedPlace } from './_where';

function wmo(code: number, day: boolean): { label: string; icon: (s?: number) => string } {
  if (code === 0) return { label: day ? 'Sunny' : 'Clear', icon: (s = 20) => (day ? I.sun(s) : I.moon(s)) };
  if (code === 1 || code === 2) return { label: day ? 'Partly Cloudy' : 'Partly Cloudy', icon: (s = 20) => I.partly(s, day) };
  if (code === 3) return { label: 'Cloudy', icon: I.cloud };
  if (code === 45 || code === 48) return { label: 'Foggy', icon: I.fog };
  if (code >= 51 && code <= 67) return { label: 'Rain', icon: I.rain };
  if (code >= 71 && code <= 77) return { label: 'Snow', icon: I.snow };
  if (code >= 80 && code <= 82) return { label: 'Showers', icon: I.rain };
  if (code >= 85 && code <= 86) return { label: 'Snow', icon: I.snow };
  if (code >= 95) return { label: 'Thunderstorms', icon: I.bolt };
  return { label: 'Cloudy', icon: I.cloud };
}

type Wx = {
  city: string;
  unit: 'F' | 'C';
  temp: number;
  code: number;
  day: boolean;
  hi: number;
  lo: number;
  hours: { label: string; temp: number; code: number; day: boolean }[];
  days: { label: string; hi: number; lo: number; code: number }[];
};
const WX_KEY = 'lucent-weather-v2';
async function getJson(url: string): Promise<any> {
  const api = (window as unknown as { overlayAPI?: { httpGet?: (u: string) => Promise<string> } }).overlayAPI;
  if (api?.httpGet) {
    try {
      return JSON.parse(await api.httpGet(url));
    } catch {
    }
  }
  return (await fetch(url)).json();
}
async function loadWx(given?: Place, pref: 'auto' | 'F' | 'C' = 'auto'): Promise<Wx> {
  const place = given ?? savedPlace();
  const here = !place && pref === 'auto';
  if (here) {
    try {
      const raw = localStorage.getItem(WX_KEY);
      if (raw) {
        const c = JSON.parse(raw);
        if (Date.now() - c.at < 15 * 60 * 1000) return c.data as Wx;
      }
    } catch {
    }
  }
  const loc = place
    ? { latitude: place.lat, longitude: place.lon, city: place.name, country_code: place.cc }
    : await locateByIp().then((f) => ({ latitude: f.lat, longitude: f.lon, city: f.city, country_code: f.cc }));
  const unit: 'F' | 'C' = pref === 'auto' ? (loc.country_code === 'US' ? 'F' : 'C') : pref;
  const q =
    `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}` +
    `&current=temperature_2m,weather_code,is_day&hourly=temperature_2m,weather_code,is_day` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=7&timezone=auto` +
    (unit === 'F' ? '&temperature_unit=fahrenheit' : '');
  const j = await getJson(q);
  const nowIso: string = j.current.time;
  const idx = Math.max(0, j.hourly.time.findIndex((t: string) => t >= nowIso.slice(0, 13)));
  const hours = [];
  for (let i = idx; i < idx + 10 && i < j.hourly.time.length; i++) {
    const hh = Number(j.hourly.time[i].slice(11, 13));
    hours.push({
      label: i === idx ? 'Now' : `${hh % 12 || 12}${hh < 12 ? 'AM' : 'PM'}`,
      temp: Math.round(j.hourly.temperature_2m[i]),
      code: j.hourly.weather_code[i],
      day: !!j.hourly.is_day[i],
    });
  }
  const days = (j.daily.time as string[]).map((t, i) => ({
    label: i === 0 ? 'Today' : new Date(`${t}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' }),
    hi: Math.round(j.daily.temperature_2m_max[i]),
    lo: Math.round(j.daily.temperature_2m_min[i]),
    code: j.daily.weather_code[i] as number,
  }));
  const data: Wx = {
    city: loc.city || 'Weather',
    unit,
    temp: Math.round(j.current.temperature_2m),
    code: j.current.weather_code,
    day: !!j.current.is_day,
    hi: days[0].hi,
    lo: days[0].lo,
    hours,
    days,
  };
  if (here) {
    try {
      localStorage.setItem(WX_KEY, JSON.stringify({ at: Date.now(), data }));
    } catch {
    }
  }
  return data;
}
const wxCache = new Map<string, { at: number; p: Promise<Wx> }>();
function getWx(given?: Place, pref: 'auto' | 'F' | 'C' = 'auto'): Promise<Wx> {
  const place = given ?? savedPlace();
  const key = `${place ? `${place.lat.toFixed(2)},${place.lon.toFixed(2)}` : 'here'}|${pref}`;
  const c = wxCache.get(key);
  if (c && Date.now() - c.at < 10 * 60 * 1000) return c.p;
  const p = loadWx(place, pref).catch((e) => {
    wxCache.delete(key);
    throw e;
  });
  wxCache.set(key, { at: Date.now(), p });
  return p;
}

function dayRows(w: Wx, n: number, rh: number) {
  const days = w.days.slice(0, n);
  const lo = Math.min(...days.map((d) => d.lo));
  const hi = Math.max(...days.map((d) => d.hi));
  const span = Math.max(1, hi - lo);
  return days
    .map(
      (d) => `<div class="n-day" style="--rh:${rh}px"><span class="d">${d.label}</span><span class="i">${wmo(d.code, true).icon(20)}</span>
      <span class="lo">${d.lo}°</span><span class="bar"><i style="left:${((d.lo - lo) / span) * 100}%;width:${Math.max(8, ((d.hi - d.lo) / span) * 100)}%"></i></span><span class="hi">${d.hi}°</span></div>`
    )
    .join('');
}
const hourCols = (w: Wx, n: number) =>
  w.hours
    .slice(0, n)
    .map((h) => `<div class="wx-h"><span>${h.label}</span>${wmo(h.code, h.day).icon(22)}<b>${h.temp}°</b></div>`)
    .join('');

function wxSky(code: number, day: boolean) {
  const g = (a: string, b: string) => `linear-gradient(180deg,${a} 0%,${b} 100%)`;
  if (code >= 95) return g('#454d63', '#6a7389');
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return day ? g('#56677f', '#7d8ea3') : g('#1f2638', '#3a4560');
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return day ? g('#8197b3', '#b3c3d6') : g('#2a3550', '#4a5a78');
  if (code === 45 || code === 48) return day ? g('#8b97a6', '#b2bbc6') : g('#2c3445', '#4a5467');
  if (code === 3) return day ? g('#6f8298', '#98a9bb') : g('#222b40', '#3b4660');
  if (code === 1 || code === 2) return day ? g('#4a8fdc', '#86b8ec') : g('#16224a', '#2e4678');
  return day ? g('#3b86e6', '#6db4f4') : g('#0f1a3e', '#27407a');
}
function weather(size: 'S' | 'M' | 'L' | 'XL') {
  return (root: HTMLElement, cfg?: WidgetCfg) => {
    const load = () => getWx(cfg?.place, cfg?.unit);
    let alive = true;
    let wxLast: Wx | null = null;
    root.innerHTML = $(`<div class="wc wx dk wx-${size === 'S' ? 'S' : 'M'}" style="background:${wxSky(0, true)}"><div class="wx-city">Weather</div><div class="wx-temp">--°</div></div>`);
    const sky = () => {
      const el = root.firstElementChild as HTMLElement | null;
      if (el && wxLast) el.style.background = wxSky(wxLast.code, wxLast.day);
    };
    const draw = (w: Wx) => {
      if (!alive) return;
      wxLast = w;
      const c = wmo(w.code, w.day);
      const hl = `H:${w.hi}° L:${w.lo}°`;
      const city = `<div class="wx-city">${esc(w.city)} ${I.arrow(11)}</div>`;
      if (size === 'S') {
        root.innerHTML = $(`<div class="wc wx dk wx-S">
          <div>${city}<div class="wx-temp">${w.temp}°</div></div>
          <div><div class="wx-ico">${c.icon(18)}</div><div class="wx-cond">${c.label}</div><div class="wx-hl">${hl}</div></div></div>`);
      } else if (size === 'M') {
        root.innerHTML = $(`<div class="wc wx dk wx-M">
          <div class="wx-top"><div>${city}<div class="wx-temp">${w.temp}°</div></div>
          <div class="wx-right"><div class="wx-ico">${c.icon(20)}</div><div class="wx-cond">${c.label}</div><div class="wx-hl">${hl}</div></div></div>
          <div class="wx-hours">${hourCols(w, 6)}</div></div>`);
      } else if (size === 'L') {
        root.innerHTML = $(`<div class="wc dk n-fill">
          <div class="wx-M" style="display:flex;justify-content:space-between"><div>${city}<div class="wx-temp" style="font-size:42px">${w.temp}°</div></div>
          <div class="wx-right"><div class="wx-ico">${c.icon(20)}</div><div class="wx-cond">${c.label}</div><div class="wx-hl">${hl}</div></div></div>
          <div class="wx-hours">${hourCols(w, 6)}</div>
          <div class="n-days">${dayRows(w, 5, 30)}</div></div>`);
      } else {
        root.innerHTML = $(`<div class="wc dk" style="display:flex;gap:26px;padding:20px 24px">
          <div class="n-fill" style="width:190px;flex:none">
            <div>${city}<div class="wx-temp" style="font-size:72px;margin-top:6px">${w.temp}°</div></div>
            <div><div class="wx-ico" style="height:24px">${c.icon(24)}</div><div class="wx-cond" style="font-size:16px">${c.label}</div><div class="wx-hl" style="font-size:15px">${hl}</div></div></div>
          <div class="n-fill" style="flex:1;min-width:0"><div class="wx-hours">${hourCols(w, 8)}</div><div class="n-days">${dayRows(w, 5, 34)}</div></div></div>`);
      }
      sky();
    };
    let retry = 0;
    const fail = () => {
      if (!alive) return;
      const c = root.querySelector('.wx-city');
      if (c) c.textContent = 'Weather unavailable';
      retry = window.setTimeout(() => load().then(draw).catch(fail), 30000);
    };
    load().then(draw).catch(fail);
    const t = setInterval(() => load().then(draw).catch(() => {}), 15 * 60 * 1000);
    const off = onWhere(() => load().then(draw).catch(fail));
    return () => {
      off();
      alive = false;
      clearTimeout(retry);
      clearInterval(t);
    };
  };
}

export default defineWidgets([
  {
    id: 'wx-s', family: 'Weather', group: 'weather', size: 'S',
    name: 'Weather',
    desc: 'The current temperature and conditions for your location, or any city.',
    fields: ['place', 'unit'],
    mount: weather('S'),
  },
  {
    id: 'wx-m', family: 'Weather', group: 'weather', size: 'M',
    name: 'Weather',
    desc: 'Current conditions plus the next few hours.',
    fields: ['place', 'unit'],
    mount: weather('M'),
  },
  {
    id: 'wx-l', family: 'Weather', group: 'weather', size: 'L',
    name: 'Weather',
    desc: 'An hour-by-hour forecast plus the days ahead.',
    fields: ['place', 'unit'],
    mount: weather('L'),
  },
]);
