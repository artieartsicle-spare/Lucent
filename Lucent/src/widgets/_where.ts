import type { Place } from './_api';

export const WHERE_KEY = 'lucent-wxloc-v1';

export type Fix = { lat: number; lon: number; city: string; cc: string };

export function savedPlace(): Place | undefined {
  try {
    const p = JSON.parse(localStorage.getItem(WHERE_KEY) || 'null')?.place;
    if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) return p as Place;
  } catch {
  }
  return undefined;
}

export function savePlace(p?: Place) {
  try {
    if (p) localStorage.setItem(WHERE_KEY, JSON.stringify({ place: p }));
    else localStorage.removeItem(WHERE_KEY);
  } catch {
  }
}

export function onWhere(cb: () => void): () => void {
  const f = (e: StorageEvent) => {
    if (e.key === WHERE_KEY || e.key === null) cb();
  };
  window.addEventListener('storage', f);
  return () => window.removeEventListener('storage', f);
}

type Api = { httpGet?: (u: string) => Promise<string> };
async function getJson(url: string): Promise<any> {
  const api = (window as unknown as { overlayAPI?: Api }).overlayAPI;
  if (api?.httpGet) {
    try {
      return JSON.parse(await api.httpGet(url));
    } catch {
    }
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    return await (await fetch(url, { signal: ctl.signal })).json();
  } finally {
    clearTimeout(t);
  }
}

const PROVIDERS: [string, (j: any) => Fix | null][] = [
  ['https://ipwho.is/', (j) => (j && j.success !== false && Number.isFinite(+j.latitude) ? { lat: +j.latitude, lon: +j.longitude, city: j.city || '', cc: j.country_code || '' } : null)],
  ['https://get.geojs.io/v1/ip/geo.json', (j) => (j && Number.isFinite(parseFloat(j.latitude)) ? { lat: parseFloat(j.latitude), lon: parseFloat(j.longitude), city: j.city || '', cc: j.country_code || '' } : null)],
  ['https://ipapi.co/json/', (j) => (j && !j.error && Number.isFinite(+j.latitude) ? { lat: +j.latitude, lon: +j.longitude, city: j.city || '', cc: j.country_code || '' } : null)],
];

export async function locateByIp(): Promise<Fix> {
  for (const [url, read] of PROVIDERS) {
    try {
      const f = read(await getJson(url));
      if (f) return f;
    } catch {
    }
  }
  throw new Error('no location');
}

export async function searchPlaces(q: string): Promise<Place[]> {
  const j = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=7&language=en&format=json`);
  return (j.results ?? []).map((x: any) => ({
    name: x.name as string,
    region: [x.admin1, x.country].filter(Boolean).join(', '),
    lat: x.latitude as number,
    lon: x.longitude as number,
    tz: x.timezone as string | undefined,
    cc: x.country_code as string | undefined,
  }));
}

export function parseCoords(s: string): Place | null {
  const m = s.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = +m[1];
  const lon = +m[2];
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { name: `${lat.toFixed(2)}, ${lon.toFixed(2)}`, lat, lon };
}
