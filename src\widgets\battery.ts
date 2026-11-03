import { defineWidgets } from './_api';
import './_styles';
import { $, hair, I, ring } from './_shared';
import { esc } from './_native';

function battery(root: HTMLElement) {
  let alive = true;
  let bat: any = null;
  const draw = () => {
    if (!alive) return;
    const pct = bat ? Math.round(bat.level * 100) : 100;
    const color = bat && bat.charging ? '#30d158' : pct <= 20 ? '#ff453a' : 'var(--w-arc,#fff)';
    root.innerHTML = $(`<div class="wc bat1 solid lt">
      <div class="b1-ring">${ring(pct, 8, 26, 66, color)}<div class="b1-ico">${I.laptop(30)}</div></div>
      <div class="b1-pct">${pct}%</div></div>`);
  };
  draw();
  (navigator as any).getBattery?.().then((b: any) => {
    bat = b;
    b.addEventListener('levelchange', draw);
    b.addEventListener('chargingchange', draw);
    draw();
  });
  return () => {
    alive = false;
  };
}

type Dev = { name: string; kind: string; pct: number; charging: boolean };
const BAT_GREEN = 'var(--w-ok,#67d36f)';
const BAT_RED = 'var(--w-bad,#ff6a55)';
const devKind = (n: string) =>
  /airpods|headphone|headset|buds|earbud|wh-|wf-|beats|jabra|bose|sony.*(xm|wh|wf)/i.test(n) ? 'headphones'
  : /watch|band|fit/i.test(n) ? 'watch'
  : /keyboard|keys/i.test(n) ? 'keyboard'
  : /mouse|mx |trackpad|trackball|pebble/i.test(n) ? 'mouse'
  : /controller|gamepad|xbox|dualsense|dualshock|joy-?con|pro controller/i.test(n) ? 'controller'
  : /ipad|tablet|tab /i.test(n) ? 'tablet'
  : /iphone|phone|pixel|galaxy|android/i.test(n) ? 'phone'
  : 'other';
const devIcon = (k: string, s: number) => {
  const st = 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
  const g: Record<string, string> = {
    laptop: `<rect x="5" y="5.5" width="14" height="9.5" rx="1.6" ${st}/><path d="M2.6 18.6h18.8" ${st}/>`,
    phone: `<rect x="7.2" y="2.6" width="9.6" height="18.8" rx="2.4" ${st}/><path d="M10.4 5.2h3.2" ${st}/>`,
    tablet: `<rect x="5" y="2.8" width="14" height="18.4" rx="2.2" ${st}/><path d="M10.5 18.4h3" ${st}/>`,
    watch: `<rect x="7" y="6.2" width="10" height="11.6" rx="3" fill="currentColor"/><path d="M9 6.2 9.6 2.8h4.8L15 6.2M9 17.8l.6 3.4h4.8l.6-3.4" ${st}/>`,
    headphones: `<path d="M4.8 15v-3a7.2 7.2 0 0 1 14.4 0v3" ${st} stroke-width="1.9"/><rect x="3.6" y="13.4" width="4.4" height="6.6" rx="2" fill="currentColor"/><rect x="16" y="13.4" width="4.4" height="6.6" rx="2" fill="currentColor"/>`,
    keyboard: `<rect x="2.4" y="6.4" width="19.2" height="11.2" rx="2.2" fill="currentColor"/><g fill="#000" fill-opacity=".45"><rect x="5" y="9" width="2" height="1.8" rx=".4"/><rect x="8.4" y="9" width="2" height="1.8" rx=".4"/><rect x="11.8" y="9" width="2" height="1.8" rx=".4"/><rect x="15.2" y="9" width="2" height="1.8" rx=".4"/><rect x="5" y="12.2" width="14" height="1.8" rx=".4"/></g>`,
    mouse: `<rect x="6.6" y="2.8" width="10.8" height="18.4" rx="5.4" ${st}/><path d="M12 3v6" ${st}/>`,
    controller: `<path d="M7.4 7h9.2a4.6 4.6 0 0 1 4.5 3.7l.8 4.4a2.5 2.5 0 0 1-4.3 2l-1.7-2.3H8.1l-1.7 2.3a2.5 2.5 0 0 1-4.3-2l.8-4.4A4.6 4.6 0 0 1 7.4 7Z" fill="currentColor"/>`,
    other: `<circle cx="12" cy="12" r="7" ${st}/><circle cx="12" cy="12" r="2.2" fill="currentColor"/>`,
  };
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" style="color:var(--w-ink,rgba(255,255,255,.93))">${g[k] ?? g.other}</svg>`;
};
const bolt = (s: number, c = 'var(--w-bolt,#fff)') => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><path d="M13.6 2 5.6 13.4h5.2L9.6 22l8.8-12h-5.4Z" fill="${c}"/></svg>`;

const batSubs = new Set<(d: Dev[]) => void>();
let batLast: Dev[] = [];
let batTimer: ReturnType<typeof setInterval> | null = null;
async function batPoll() {
  const list: Dev[] = [];
  let host = 'This PC';
  const api = (window as any).overlayAPI;
  try {
    const r = await api?.getBatteries?.();
    if (r?.host) host = r.host;
    (r?.devices ?? []).forEach((d: any) => list.push({ name: d.name, kind: devKind(d.name), pct: d.pct, charging: !!d.charging }));
  } catch {
  }
  try {
    const b: any = await (navigator as any).getBattery?.();
    list.unshift({ name: host, kind: 'laptop', pct: b ? Math.round(b.level * 100) : 100, charging: b ? !!b.charging : true });
  } catch {
    list.unshift({ name: host, kind: 'laptop', pct: 100, charging: true });
  }
  batLast = list;
  batSubs.forEach((f) => f(list));
}
function batSubscribe(cb: (d: Dev[]) => void) {
  batSubs.add(cb);
  if (batLast.length) cb(batLast);
  if (!batTimer) {
    batTimer = setInterval(batPoll, 30000);
  }
  void batPoll();
  return () => {
    batSubs.delete(cb);
    if (!batSubs.size && batTimer) {
      clearInterval(batTimer);
      batTimer = null;
    }
  };
}
const batCol = (d: Dev) => (d.pct <= 20 && !d.charging ? BAT_RED : BAT_GREEN);
function batRing(d: Dev | undefined, size: number, w: number) {
  const c = size / 2;
  const r = (size - w) / 2;
  const track = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" style="stroke:var(--w-track,rgba(255,255,255,.2))" stroke-width="${w}"/>`;
  const arc = d && d.pct > 0
    ? `<circle cx="${c}" cy="${c}" r="${r}" fill="none" style="stroke:${batCol(d)}" stroke-width="${w}" stroke-linecap="round" pathLength="100" stroke-dasharray="${d.pct} ${100 - d.pct + 0.001}" transform="rotate(-90 ${c} ${c})"/>`
    : '';
  return `<div style="position:relative;width:${size}px;height:${size}px;flex:none"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="position:absolute;left:0;top:0">${track}${arc}</svg>
    ${d ? `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">${devIcon(d.kind, Math.round(size * 0.42))}</div>` : ''}
    ${d && d.charging ? `<div style="position:absolute;left:50%;top:${-Math.round(size * 0.04)}px;transform:translateX(-50%);background:var(--w-bolt-bg,rgba(40,44,60,.55));border-radius:6px;padding:1px 0 0;line-height:0">${bolt(Math.round(size * 0.2))}</div>` : ''}</div>`;
}
const pctTxt = (d: Dev) => `${d.pct} %`;
const hintTxt = (_devs: Dev[]) => '';

function batGrid(root: HTMLElement) {
  return batSubscribe((devs) => {
    const cell = (d?: Dev) => `<div style="display:flex;align-items:center;justify-content:center">${batRing(d, 62, 7.5)}</div>`;
    root.innerHTML = $(`<div class="wc solid lt" style="display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;padding:10px">${[0, 1, 2, 3].map((i) => cell(devs[i])).join('')}</div>`);
  });
}
function batteryM(root: HTMLElement) {
  return batSubscribe((devs) => {
    const col = (d?: Dev) =>
      `<div style="display:flex;flex-direction:column;align-items:center;gap:12px;width:72px">${batRing(d, 66, 8)}<div style="font:400 17px/1 Inter;letter-spacing:-.01em;height:17px">${d ? pctTxt(d) : ''}</div></div>`;
    root.innerHTML = $(`<div class="wc solid lt" style="display:flex;align-items:center;justify-content:space-around;padding:12px 8px 8px">${[0, 1, 2, 3].map((i) => col(devs[i])).join('')}</div>${devs.length < 2 ? hintTxt(devs).replace('bottom:14px', 'bottom:8px') : ''}`);
  });
}
const batGlyph = (d: Dev) => {
  const col = d.pct <= 20 && !d.charging ? BAT_RED : 'var(--w-ink,rgba(255,255,255,.88))';
  return `<svg width="36" height="17" viewBox="0 0 36 17"><rect x=".75" y=".75" width="30.5" height="15.5" rx="4.4" fill="none" style="stroke:var(--w-ink3,rgba(255,255,255,.5))" stroke-width="1.5"/>
    <rect x="2.7" y="2.7" width="${Math.max(2, 26.6 * (d.pct / 100)).toFixed(1)}" height="11.6" rx="2.7" style="fill:${col}" ${d.charging ? 'fill-opacity=".55"' : ''}/>
    <path d="M33 5.6v5.8c1.1-.3 1.9-1.4 1.9-2.9s-.8-2.6-1.9-2.9Z" style="fill:var(--w-ink3,rgba(255,255,255,.5))"/>
    ${d.charging ? `<path d="M17.6 3.4 11 9.4h4.2l-1 4.3 6.6-6.4h-4.2Z" style="fill:var(--w-bolt,#fff)" stroke="rgba(30,34,50,.55)" stroke-width=".6"/>` : ''}</svg>`;
};
function batteryL(root: HTMLElement) {
  return batSubscribe((devs) => {
    const rows = devs.slice(0, 6).map(
      (d) => `<div style="display:flex;align-items:center;gap:12px;height:59px;padding:0 18px;border-top:1px solid ${hair};font:500 14.5px/1 Inter">
        <span style="width:24px;display:flex;justify-content:center">${devIcon(d.kind, 22)}</span>
        <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(d.name)}</span>
        <span style="color:var(--w-ink2,rgba(255,255,255,.85))">${pctTxt(d)}</span>${batGlyph(d)}</div>`
    );
    root.innerHTML = $(`<div class="wc solid lt" style="padding:0"><div style="display:flex;flex-direction:column;height:100%">${rows.join('').replace(/border-top:1px solid [^;]+;/, '')}</div>${hintTxt(devs)}</div>`);
  });
}

export default defineWidgets([
  {
    id: 'battery', family: 'Batteries', group: 'battery', size: 'S',
    name: 'Battery',
    desc: 'Your PC’s battery level at a glance, and whether it is charging.',
    mount: battery,
  },
  {
    id: 'battery-m', family: 'Batteries', group: 'battery', size: 'M',
    name: 'Batteries',
    desc: 'Your PC and paired Bluetooth devices, each with its own battery ring.',
    mount: batteryM,
  },
  {
    id: 'battery-l', family: 'Batteries', group: 'battery', size: 'L',
    name: 'Batteries',
    desc: 'Your PC and paired Bluetooth devices in a list, with their charge levels.',
    mount: batteryL,
  },
  {
    id: 'battery-s2', family: 'Batteries', group: 'battery-grid', size: 'S',
    name: 'Batteries',
    desc: 'A compact grid of battery rings for up to four devices.',
    mount: batGrid,
  },
]);
