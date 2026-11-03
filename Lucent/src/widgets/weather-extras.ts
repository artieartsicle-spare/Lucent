import { defineWidgets, type WidgetCfg } from './_api';
import { esc, native } from './_native';
import { getLoc } from './_shared';
import { onWhere, savedPlace } from './_where';

type Ex = {
  city: string;
  imperial: boolean;
  temp: number;
  feels: number;
  hum: number;
  dew: number;
  wind: number;
  gust: number;
  dir: number;
  press: number;
  pressTrend: 'Rising' | 'Falling' | 'Steady';
  vis: number | null;
  uvNow: number;
  uvMax: number;
  uvDay: number[];
  precipPast: number;
  precipNext: number;
  rain: { label: string; pop: number; mm: number }[];
  aqi: number | null;
  pm25: number | null;
  pm10: number | null;
  o3: number | null;
};

const text = async (url: string) => {
  const a = native();
  if (a.httpGet) return a.httpGet(url);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
};
const json = async (url: string) => JSON.parse(await text(url));
const num = (v: unknown, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
const sum = (a: unknown[], from: number, to: number) => {
  let t = 0;
  for (let i = Math.max(0, from); i <= to && i < a.length; i++) t += num(a[i]);
  return t;
};

async function loadEx(cfg?: WidgetCfg): Promise<Ex> {
  const place = cfg?.place ?? savedPlace();
  const loc = place ? { lat: place.lat, lon: place.lon, city: place.name } : await getLoc();
  const imperial = cfg?.unit === 'F' || (!cfg?.unit || cfg.unit === 'auto' ? /-US$/i.test(navigator.language) : false);
  const units = imperial ? '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch' : '';
  const q = `latitude=${loc.lat}&longitude=${loc.lon}`;
  const [j, aq] = await Promise.all([
    json(
      `https://api.open-meteo.com/v1/forecast?${q}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl` +
        `&hourly=precipitation,precipitation_probability,uv_index,visibility,pressure_msl,dew_point_2m&daily=uv_index_max&past_days=1&forecast_days=2&timezone=auto${units}`
    ),
    json(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}&current=us_aqi,pm2_5,pm10,ozone&timezone=auto`).catch(() => null),
  ]);
  const c = j.current;
  const h = j.hourly;
  const nowIso: string = c.time;
  const idx = Math.max(0, (h.time as string[]).findIndex((t) => t >= nowIso.slice(0, 13)));
  const hourOfDay = Number(nowIso.slice(11, 13)) || 0;
  const dayStart = idx - hourOfDay;
  const uvDay: number[] = [];
  for (let hh = 6; hh <= 20; hh++) uvDay.push(num(h.uv_index?.[dayStart + hh]));
  const rain = [];
  for (let i = idx + 1; i <= idx + 12 && i < h.time.length; i++) {
    const hr = Number((h.time[i] as string).slice(11, 13));
    rain.push({ label: `${hr % 12 || 12}${hr < 12 ? 'A' : 'P'}`, pop: num(h.precipitation_probability?.[i]), mm: num(h.precipitation?.[i]) });
  }
  const visM = num(h.visibility?.[idx], -1);
  const p0 = num(h.pressure_msl?.[idx - 3], num(c.pressure_msl));
  const dP = num(c.pressure_msl) - p0;
  const k = imperial ? 0.02953 : 1;
  const ac = aq?.current;
  const av = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : null);
  return {
    city: loc.city || 'Weather',
    imperial,
    temp: Math.round(num(c.temperature_2m)),
    feels: Math.round(num(c.apparent_temperature, num(c.temperature_2m))),
    hum: Math.round(num(c.relative_humidity_2m)),
    dew: Math.round(num(h.dew_point_2m?.[idx])),
    wind: Math.round(num(c.wind_speed_10m)),
    gust: Math.round(num(c.wind_gusts_10m)),
    dir: num(c.wind_direction_10m),
    press: imperial ? Math.round(num(c.pressure_msl) * k * 100) / 100 : Math.round(num(c.pressure_msl)),
    pressTrend: dP > 1 ? 'Rising' : dP < -1 ? 'Falling' : 'Steady',
    vis: visM < 0 ? null : imperial ? visM / 1609.34 : visM / 1000,
    uvNow: num(h.uv_index?.[idx]),
    uvMax: num(j.daily?.uv_index_max?.[1] ?? j.daily?.uv_index_max?.[0]),
    uvDay,
    precipPast: sum(h.precipitation ?? [], idx - 23, idx),
    precipNext: sum(h.precipitation ?? [], idx + 1, idx + 24),
    rain,
    aqi: av(ac?.us_aqi),
    pm25: av(ac?.pm2_5),
    pm10: av(ac?.pm10),
    o3: av(ac?.ozone),
  };
}

const cache = new Map<string, { at: number; p: Promise<Ex> }>();
function getEx(cfg?: WidgetCfg): Promise<Ex> {
  const pl = cfg?.place ?? savedPlace();
  const key = `${pl ? `${pl.lat.toFixed(2)},${pl.lon.toFixed(2)}` : 'here'}|${cfg?.unit ?? 'auto'}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 15 * 60_000) return hit.p;
  const p = loadEx(cfg).catch((e) => {
    cache.delete(key);
    throw e;
  });
  cache.set(key, { at: Date.now(), p });
  return p;
}

const AQI: { max: number; label: string; tip: string }[] = [
  { max: 50, label: 'Good', tip: 'Air quality is satisfactory.' },
  { max: 100, label: 'Moderate', tip: 'Acceptable for most people.' },
  { max: 150, label: 'Unhealthy for Sensitive Groups', tip: 'Sensitive people should limit time outside.' },
  { max: 200, label: 'Unhealthy', tip: 'Everyone should reduce outdoor exertion.' },
  { max: 300, label: 'Very Unhealthy', tip: 'Avoid outdoor activity if you can.' },
  { max: Infinity, label: 'Hazardous', tip: 'Stay indoors with clean air.' },
];
const aqiOf = (v: number) => AQI.find((x) => v <= x.max)!;
const UV = (v: number) => (v < 3 ? 'Low' : v < 6 ? 'Moderate' : v < 8 ? 'High' : v < 11 ? 'Very High' : 'Extreme');
const uvColor = (v: number) => (v < 3 ? '#30d158' : v < 6 ? '#ffd60a' : v < 8 ? '#ff9f0a' : v < 11 ? '#ff453a' : '#bf5af2');
const compass = (deg: number) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(deg / 22.5) % 16];

const AQI_GRADIENT = 'linear-gradient(90deg,#30d158 0%,#ffd60a 17%,#ff9f0a 33%,#ff453a 50%,#bf5af2 67%,#8e1f4a 100%)';
const UV_GRADIENT = 'linear-gradient(90deg,#30d158 0%,#ffd60a 33%,#ff9f0a 58%,#ff453a 80%,#bf5af2 100%)';
const gauge = (frac: number, grad: string) =>
  `<div class="xe-g" style="background:${grad}"><i style="left:${Math.max(0, Math.min(1, frac)) * 100}%"></i></div>`;

const mm = (v: number, imperial: boolean) => (imperial ? `${v < 0.005 ? '0' : v.toFixed(2)}″` : v < 0.05 ? '0 mm' : v < 10 ? `${v.toFixed(1)} mm` : `${Math.round(v)} mm`);
const spd = (v: number, imperial: boolean) => `${v}<small>${imperial ? 'mph' : 'km/h'}</small>`;

const gl = (d: string) => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const G = {
  aqi: gl('<path d="M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>'),
  uv: gl('<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>'),
  rain: gl('<path d="M12 3.5s6 6.2 6 10.4a6 6 0 0 1-12 0c0-4.2 6-10.4 6-10.4Z"/>'),
  feels: gl('<path d="M10 14.2V5a2 2 0 1 1 4 0v9.2a4 4 0 1 1-4 0Z"/>'),
  wind: gl('<path d="M3 9h11a3 3 0 1 0-3-3M3 14h16a3 3 0 1 1-3 3M3 19h6"/>'),
  eye: gl('<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  gauge: gl('<path d="M4.5 18a8.5 8.5 0 1 1 15 0"/><path d="m12 13 4-4"/>'),
};

type Card = { label: string; icon: string; body: (d: Ex) => string; cls?: string };
const CARDS: Record<string, Card> = {
  'aqi-s': {
    label: 'Air Quality',
    icon: G.aqi,
    body: (d) => {
      if (d.aqi === null) return `<div class="xe-big">—</div><div class="xe-cap">No air quality data for this location.</div>`;
      const a = aqiOf(d.aqi);
      return `<div class="xe-big">${Math.round(d.aqi)}</div><div class="xe-lv">${a.label}</div><div class="xe-sp"></div>${gauge(d.aqi / 300, AQI_GRADIENT)}`;
    },
  },
  'aqi-m': {
    label: 'Air Quality',
    icon: G.aqi,
    body: (d) => {
      if (d.aqi === null) return `<div class="xe-big">—</div><div class="xe-cap">No air quality data for this location.</div>`;
      const a = aqiOf(d.aqi);
      const f = (n: number | null) => (n === null ? '—' : `${Math.round(n)}`);
      return `<div class="xe-row"><div><div class="xe-big">${Math.round(d.aqi)}</div><div class="xe-lv">${a.label}</div></div>
        <div class="xe-stats"><div><span>PM2.5</span><b>${f(d.pm25)}</b></div><div><span>PM10</span><b>${f(d.pm10)}</b></div><div><span>Ozone</span><b>${f(d.o3)}</b></div></div></div>
        <div class="xe-sp"></div>${gauge(d.aqi / 300, AQI_GRADIENT)}<div class="xe-cap" style="margin-top:7px">${a.tip}</div>`;
    },
  },
  'uv-s': {
    label: 'UV Index',
    icon: G.uv,
    body: (d) => {
      const v = Math.round(d.uvNow);
      const tip = d.uvMax >= 3 ? 'Use sun protection 10 AM–4 PM.' : 'Low for the rest of the day.';
      return `<div class="xe-big">${v}</div><div class="xe-lv">${UV(v)}</div><div class="xe-sp"></div>${gauge(d.uvNow / 11, UV_GRADIENT)}<div class="xe-cap" style="margin-top:6px">${tip}</div>`;
    },
  },
  'uv-m': {
    label: 'UV Index',
    icon: G.uv,
    body: (d) => {
      const v = Math.round(d.uvNow);
      const nowH = new Date().getHours();
      const bars = d.uvDay
        .map((u, i) => `<i class="${i + 6 === nowH ? 'now' : ''}" style="height:${Math.max(3, Math.min(1, u / 11) * 100)}%;background:${uvColor(u)}"></i>`)
        .join('');
      const tip = d.uvMax >= 3 ? `Peaks at ${Math.round(d.uvMax)} (${UV(d.uvMax)}). Use sun protection 10 AM–4 PM.` : 'Low for the rest of the day.';
      return `<div class="xe-row" style="flex:1;min-height:0"><div style="width:86px;flex:none"><div class="xe-big">${v}</div><div class="xe-lv">${UV(v)}</div></div>
        <div class="xe-bars">${bars}</div></div>
        <div class="xe-ax"><span>6 AM</span><span>12 PM</span><span>6 PM</span></div><div class="xe-cap" style="margin-top:5px">${tip}</div>`;
    },
  },
  'precip-s': {
    label: 'Precipitation',
    icon: G.rain,
    body: (d) =>
      `<div class="xe-big" style="font-size:30px">${mm(d.precipPast, d.imperial)}</div><div class="xe-lv">in the last 24 hours</div><div class="xe-sp"></div>
       <div class="xe-cap">${d.precipNext < (d.imperial ? 0.005 : 0.05) ? 'None expected in the next 24 hours.' : `${mm(d.precipNext, d.imperial)} expected in the next 24 hours.`}</div>`,
  },
  'precip-m': {
    label: 'Precipitation',
    icon: G.rain,
    body: (d) => {
      const bars = d.rain.map((r) => `<i style="height:${Math.max(3, r.pop)}%;background:#64d2ff"></i>`).join('');
      const ax = d.rain.map((r, i) => (i % 3 === 0 ? `<span>${r.label}</span>` : '')).join('');
      const next = d.precipNext < (d.imperial ? 0.005 : 0.05) ? 'None expected next 24 h' : `${mm(d.precipNext, d.imperial)} expected next 24 h`;
      return `<div class="xe-row" style="flex:1;min-height:0"><div style="width:96px;flex:none"><div class="xe-big" style="font-size:28px">${mm(d.precipPast, d.imperial)}</div><div class="xe-lv">last 24 hours</div></div>
        <div class="xe-bars" title="Chance of precipitation">${bars}</div></div>
        <div class="xe-ax" style="padding-left:106px">${ax}</div><div class="xe-cap" style="margin-top:5px">${next}. Bars show the chance of rain each hour.</div>`;
    },
  },
  'feels-s': {
    label: 'Feels Like',
    icon: G.feels,
    body: (d) => {
      const diff = d.feels - d.temp;
      const why =
        Math.abs(diff) < 2 ? 'Similar to the actual temperature.' : diff < 0 ? (d.wind >= (d.imperial ? 9 : 15) ? 'Wind is making it feel colder.' : 'It feels colder than the actual temperature.') : d.hum >= 60 ? 'Humidity is making it feel warmer.' : 'It feels warmer than the actual temperature.';
      return `<div class="xe-big">${d.feels}°</div><div class="xe-sp"></div><div class="xe-cap">${why}</div><div class="xe-cap" style="margin-top:3px;opacity:.7">Actual: ${d.temp}°</div>`;
    },
  },
  'wind-s': {
    label: 'Wind',
    icon: G.wind,
    body: (d) => {
      const tick = (a: number) => `<line x1="30" y1="4" x2="30" y2="${a % 90 === 0 ? 9 : 7}" stroke="rgba(255,255,255,.35)" stroke-width="1.5" transform="rotate(${a} 30 30)"/>`;
      const ring = `<svg width="62" height="62" viewBox="0 0 60 60" style="position:absolute;right:12px;bottom:12px">${[...Array(12)].map((_, i) => tick(i * 30)).join('')}
        <text x="30" y="17.5" text-anchor="middle" font-size="7.5" font-weight="700" fill="rgba(255,255,255,.7)" font-family="Inter,sans-serif">N</text>
        <g transform="rotate(${d.dir + 180} 30 30)"><path d="M30 14v32" stroke="#fff" stroke-width="2" stroke-linecap="round"/><path d="m25 41 5 6 5-6" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;
      return `<div class="xe-big" style="font-size:32px">${spd(d.wind, d.imperial)}</div><div class="xe-lv">from ${compass(d.dir)}</div><div class="xe-sp"></div><div class="xe-cap" style="max-width:62px">Gusts ${d.gust}</div>${ring}`;
    },
  },
  'humid-s': {
    label: 'Humidity',
    icon: G.rain,
    body: (d) => `<div class="xe-big">${d.hum}<small style="font-size:.5em">%</small></div><div class="xe-sp"></div><div class="xe-cap">The dew point is ${d.dew}° right now.</div>`,
  },
  'vis-s': {
    label: 'Visibility',
    icon: G.eye,
    body: (d) => {
      if (d.vis === null) return `<div class="xe-big">—</div><div class="xe-cap">No visibility data.</div>`;
      const km = d.imperial ? d.vis * 1.60934 : d.vis;
      const word = km >= 10 ? 'It’s perfectly clear right now.' : km >= 5 ? 'Clear, with a little haze.' : km >= 1 ? 'Hazy or foggy right now.' : 'Very poor visibility.';
      const shown = d.vis >= 10 ? Math.round(d.vis) : d.vis.toFixed(1);
      return `<div class="xe-big" style="font-size:32px">${shown}<small>${d.imperial ? 'mi' : 'km'}</small></div><div class="xe-sp"></div><div class="xe-cap">${word}</div>`;
    },
  },
  'press-s': {
    label: 'Pressure',
    icon: G.gauge,
    body: (d) =>
      `<div class="xe-big" style="font-size:30px">${d.imperial ? d.press.toFixed(2) : d.press}<small>${d.imperial ? 'inHg' : 'hPa'}</small></div><div class="xe-lv">${d.pressTrend}</div><div class="xe-sp"></div>
       <div class="xe-cap">${d.pressTrend === 'Falling' ? 'Falling pressure often brings clouds or rain.' : d.pressTrend === 'Rising' ? 'Rising pressure usually means clearing weather.' : 'Pressure is holding steady.'}</div>`,
  },
};

function card(id: string) {
  const c = CARDS[id];
  const size = id.endsWith('-m') ? 'm' : 's';
  return (root: HTMLElement, cfg?: WidgetCfg) => {
    const wc = document.createElement('div');
    wc.className = `wc solid dk xe xe-${size}`;
    root.appendChild(wc);
    let alive = true;
    let retry = 0;
    const shell = (inner: string) => (wc.innerHTML = `<div class="xe-h">${c.icon}<span>${esc(c.label)}</span></div>${inner}`);
    shell('<div class="xe-big">—</div>');
    const run = () =>
      getEx(cfg)
        .then((d) => alive && shell(c.body(d)))
        .catch(() => {
          if (!alive) return;
          if (!wc.querySelector('.xe-cap')) shell('<div class="xe-cap" style="margin-top:auto">Weather isn’t available right now.</div>');
          retry = window.setTimeout(run, 30_000);
        });
    void run();
    const t = setInterval(() => void run(), 15 * 60_000);
    const off = onWhere(() => void run());
    return () => {
      off();
      alive = false;
      clearTimeout(retry);
      clearInterval(t);
      wc.remove();
    };
  };
}

const css = document.createElement('style');
css.textContent = `
.xe{display:flex;flex-direction:column;padding:13px 14px 12px;font-family:"Inter",sans-serif;color:#fff}
.xe-h{flex:none;display:flex;align-items:center;gap:6px;margin-bottom:6px;font:700 11.5px/1 "Inter",sans-serif;letter-spacing:.05em;text-transform:uppercase;color:rgba(255,255,255,.62);white-space:nowrap}
.xe-big{font:300 40px/1 "Inter",sans-serif;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.xe-big small{font:600 13px/1 "Inter",sans-serif;margin-left:4px;letter-spacing:0;color:rgba(255,255,255,.7)}
.xe-lv{font:600 14px/1.15 "Inter",sans-serif;margin-top:4px}
.xe-cap{font:500 12px/1.25 "Inter",sans-serif;color:rgba(255,255,255,.72)}
.xe-sp{flex:1;min-height:4px}
.xe-g{position:relative;flex:none;height:6px;border-radius:3px}
.xe-g i{position:absolute;top:50%;width:8px;height:8px;border-radius:50%;background:#fff;box-shadow:0 0 0 1.5px rgba(0,0,0,.45);transform:translate(-50%,-50%)}
.xe-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.xe-stats{display:flex;flex-direction:column;gap:5px;min-width:96px;padding-top:2px}
.xe-stats div{display:flex;justify-content:space-between;gap:14px;font:500 12.5px/1 "Inter",sans-serif;border-bottom:1px solid rgba(255,255,255,.14);padding-bottom:5px}
.xe-stats div:last-child{border:0;padding:0}
.xe-stats span{color:rgba(255,255,255,.62)}.xe-stats b{font-weight:650}
.xe-bars{flex:1;min-width:0;align-self:stretch;display:flex;align-items:flex-end;gap:3px}
.xe-bars i{flex:1;border-radius:2px 2px 1px 1px;opacity:.85}
.xe-bars i.now{opacity:1;box-shadow:0 0 0 1.5px #fff}
.xe-ax{flex:none;display:flex;justify-content:space-between;margin-top:3px;font:500 10.5px/1 "Inter",sans-serif;color:rgba(255,255,255,.55)}
.xe-m .xe-big{font-size:42px}
`;
document.head.appendChild(css);

const d = (id: string, group: string, size: 'S' | 'M', name: string, desc: string) => ({
  id, family: 'Weather', group, size, name, desc, fields: ['place', 'unit'] as ('place' | 'unit')[], mount: card(id),
});
export default defineWidgets([
  d('aqi-s', 'wx-aqi', 'S', 'Air Quality', 'The current air quality index and what it means.'),
  d('aqi-m', 'wx-aqi', 'M', 'Air Quality', 'Air quality index with particle and ozone readings, plus advice for being outdoors.'),
  d('uv-s', 'wx-uv', 'S', 'UV Index', 'The current UV index and when to use sun protection.'),
  d('uv-m', 'wx-uv', 'M', 'UV Index', 'How the UV index changes through the day.'),
  d('precip-s', 'wx-precip', 'S', 'Precipitation', 'Rain over the last 24 hours and what is expected next.'),
  d('precip-m', 'wx-precip', 'M', 'Precipitation', 'The chance of rain, hour by hour.'),
  d('feels-s', 'wx-feels', 'S', 'Feels Like', 'What the temperature actually feels like, and what is making the difference.'),
  d('wind-s', 'wx-wind', 'S', 'Wind', 'Wind speed, direction and gusts.'),
  d('humid-s', 'wx-humid', 'S', 'Humidity', 'Current humidity and the dew point.'),
  d('vis-s', 'wx-vis', 'S', 'Visibility', 'How far you can see right now.'),
  d('press-s', 'wx-press', 'S', 'Pressure', 'Air pressure, and whether it is rising or falling.'),
]);
