import { defineWidgets, type WidgetSize } from './_api';
import { esc, native, type NetStatus } from './_native';

const BLUE = '#0a84ff';
const GREEN = '#30d158';

type Snap = {
  down: number;
  up: number;
  downH: number[];
  upH: number[];
  name: string;
  kind: 'wifi' | 'wired' | 'none';
  signal: number | null;
  ip: string;
  ping: number | null | undefined;
};
const snap: Snap = { down: 0, up: 0, downH: Array(60).fill(0), upH: Array(60).fill(0), name: '', kind: 'none', signal: null, ip: '', ping: undefined };
const subs = new Set<() => void>();
let started = false;
let listening = false;
let timers: number[] = [];
const emit = () => subs.forEach((f) => f());

function describe(n: NetStatus) {
  if (!n) return;
  const up = n.adapters.filter((a) => a.status === 'Up' && a.ip);
  if (n.wifi?.connected) {
    snap.kind = 'wifi';
    snap.name = n.wifi.ssid;
    snap.signal = n.wifi.signal;
    snap.ip = up.find((a) => /802\.11/.test(a.media))?.ip.split(',')[0].trim() ?? '';
  } else if (up.length) {
    snap.kind = 'wired';
    snap.name = up[0].profile || up[0].name || 'Ethernet';
    snap.signal = null;
    snap.ip = up[0].ip.split(',')[0].trim();
  } else {
    snap.kind = 'none';
    snap.name = 'Not connected';
    snap.signal = null;
    snap.ip = '';
  }
}

function start() {
  if (started) return;
  started = true;
  const a = native();
  if (!listening) {
    listening = true;
    a.onSystem?.((raw) => {
    const s = raw as { netDown?: number; netUp?: number };
    snap.down = s.netDown ?? 0;
    snap.up = s.netUp ?? 0;
    snap.downH.push(snap.down);
    snap.upH.push(snap.up);
    if (snap.downH.length > 60) snap.downH.shift();
    if (snap.upH.length > 60) snap.upH.shift();
    emit();
    });
  }
  const status = () => void a.netStatus?.().then((n) => (describe(n), emit())).catch(() => undefined);
  const ping = () => void a.netPing?.().then((ms) => ((snap.ping = ms), emit())).catch(() => undefined);
  status();
  ping();
  timers = [window.setInterval(status, 30_000), window.setInterval(ping, 10_000)];
}
function stop() {
  if (subs.size) return;
  timers.forEach(clearInterval);
  timers = [];
  started = false;
}

const rate = (b: number) => {
  if (b < 1000) return { v: '0', u: 'KB/s' };
  const k = b / 1024;
  return k < 1000 ? { v: k < 10 ? k.toFixed(1) : String(Math.round(k)), u: 'KB/s' } : { v: (k / 1024).toFixed(k / 1024 < 10 ? 1 : 0), u: 'MB/s' };
};
const wifiGlyph = (sig: number | null, px = 15) => {
  const n = sig === null ? 4 : sig >= 75 ? 4 : sig >= 50 ? 3 : sig >= 25 ? 2 : sig > 0 ? 1 : 0;
  const arc = (r: number, i: number) => `<path d="M${12 - r * 0.92} ${18.5 - r * 0.38}a${r} ${r} 0 0 1 ${r * 1.84} 0" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" opacity="${n > i ? 1 : 0.3}"/>`;
  return `<svg width="${px}" height="${px}" viewBox="0 0 24 24"><circle cx="12" cy="19" r="1.8" fill="currentColor"/>${arc(5, 0)}${arc(9.5, 1)}${arc(14, 2)}</svg>`;
};
const wiredGlyph = (px = 15) => `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="6" width="17" height="10" rx="2"/><path d="M8 16v3M16 16v3M12 16v3M8 10v2M12 10v2M16 10v2"/></svg>`;
const globe = (px = 15) => `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>`;
const glyph = (px = 15) => (snap.kind === 'wired' ? wiredGlyph(px) : snap.kind === 'none' ? globe(px) : wifiGlyph(null, px));
const pingText = () => (snap.ping === undefined ? '…' : snap.ping === null ? 'Offline' : `${snap.ping} ms`);
const pingColor = () => (snap.ping === undefined ? 'var(--w-ink2,rgba(255,255,255,.6))' : snap.ping === null ? '#ff453a' : snap.ping < 60 ? GREEN : snap.ping < 150 ? '#ff9f0a' : '#ff453a');

function graph(w: number, h: number, id: string) {
  const max = Math.max(1024 * 64, ...snap.downH, ...snap.upH) * 1.15;
  const X = (i: number) => (i / 59) * w;
  const Y = (v: number) => h - 2 - (v / max) * (h - 6);
  const smooth = (a: number[]) => {
    const pts = a.map((v, i) => [X(i), Y(v)] as const);
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const mx = ((x0 + x1) / 2).toFixed(1);
      d += `C${mx},${y0.toFixed(1)} ${mx},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
    }
    return d;
  };
  const d = smooth(snap.downH);
  return `<svg class="net-gsvg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BLUE}" stop-opacity=".42"/><stop offset="1" stop-color="${BLUE}" stop-opacity=".02"/></linearGradient></defs>
    <path d="${d}L${w},${h}L0,${h}Z" fill="url(#${id})"/><path d="${d}" fill="none" stroke="${BLUE}" stroke-width="1.8" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    <path d="${smooth(snap.upH)}" fill="none" stroke="${GREEN}" stroke-width="1.4" stroke-linejoin="round" opacity=".85" vector-effect="non-scaling-stroke"/></svg>`;
}


const LAYOUT = {
  S: () => {
    const d = rate(snap.down);
    const u = rate(snap.up);
    return `<div class="net-bg">${graph(158, 70, 'nsg')}</div>
      <div class="net-top"><div class="net-h">${glyph(14)}<span>${esc(snap.name || 'Network')}</span></div>
        <div class="net-sub" style="color:${pingColor()}">${pingText()}</div></div>
      <div style="flex:1"></div>
      <div class="net-bot"><div class="net-big"><i style="color:${BLUE}">↓</i><b>${d.v}</b><small>${d.u}</small></div>
        <div class="net-up"><i style="color:${GREEN}">↑</i><b>${u.v}</b><small>${u.u}</small></div></div>`;
  },
  M: () => {
    const d = rate(snap.down);
    const u = rate(snap.up);
    return `<div class="net-hd"><div class="net-h net-hl">${glyph(17)}<span>${esc(snap.name || 'Network')}</span></div></div>
      <div class="net-spd">
        <div class="net-col"><div class="net-big m"><i style="color:${BLUE}">↓</i><b>${d.v}</b><small>${d.u}</small></div><div class="net-lb">Download</div></div>
        <div class="net-vr"></div>
        <div class="net-col"><div class="net-big m"><i style="color:${GREEN}">↑</i><b>${u.v}</b><small>${u.u}</small></div><div class="net-lb">Upload</div></div></div>
      <div class="net-gr">${graph(338, 40, 'nsm')}</div>
      <div class="net-ft"><div><span>PING</span><b style="color:${pingColor()}">${pingText()}</b></div></div>`;
  },
};

function network(size: 'S' | 'M') {
  return (root: HTMLElement) => {
    const wc = document.createElement('div');
    wc.className = `wc solid lt net net-${size.toLowerCase()}`;
    root.appendChild(wc);
    const draw = () => (wc.innerHTML = LAYOUT[size]());
    subs.add(draw);
    start();
    draw();
    return () => {
      subs.delete(draw);
      stop();
      wc.remove();
    };
  };
}

const css = document.createElement('style');
css.textContent = `
.net{display:flex;flex-direction:column;padding:13px 14px 12px;font-family:"Inter",sans-serif;color:var(--w-ink,#fff);overflow:hidden}
.widget:is([data-wstyle="frosted"],[data-wstyle="dark"]) .wmount:has(.net){filter:none}
.net *{box-sizing:border-box}
.net-h{display:flex;align-items:center;gap:7px;font:700 12.5px/1.1 "Inter",sans-serif;white-space:nowrap;min-width:0}
.net-h span{overflow:hidden;text-overflow:ellipsis}
.net-h svg{flex:none}
.net-big,.net-up{display:flex;align-items:baseline;gap:5px;font-variant-numeric:tabular-nums;white-space:nowrap}
.net-big i,.net-up i{font-style:normal;font-weight:700}
.net-big b{font:300 34px/1 "Inter",sans-serif;letter-spacing:-.03em}
.net-big i{font-size:15px}
.net-big small,.net-up small{font:600 11.5px/1 "Inter",sans-serif;color:var(--w-ink2,rgba(255,255,255,.6))}
.net-up{margin-top:4px}
.net-up i{font-size:12px}
.net-up b{font:500 14px/1 "Inter",sans-serif}
.net-bg{position:absolute;left:0;right:0;bottom:50px;pointer-events:none}
.net-bg .net-gsvg{width:100%;height:70px}
.net-top,.net-bot{position:relative;z-index:1}
.net-top{display:flex;justify-content:space-between;align-items:flex-start;gap:6px}
.net-top .net-h{flex:1}
.net-sub{flex:none;font:600 12px/1.1 "Inter",sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap}
.net-m{padding:12px 14px 0}
.net-hd{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px}
.net-hl{flex:1;font-size:14px}
.net-spd{flex:none;display:flex;align-items:stretch;margin-top:8px}
.net-col{flex:1;min-width:0}
.net-col+.net-vr+.net-col{padding-left:14px}
.net-vr{width:1px;background:var(--w-line,rgba(255,255,255,.16));margin:2px 0}
.net-big.m b{font-size:27px}
.net-big.m i{font-size:15px}
.net-lb{margin-top:3px;font:500 11.5px/1 "Inter",sans-serif;color:var(--w-ink2,rgba(255,255,255,.6))}
.net-gr{flex:1;min-height:0;margin:2px -14px 0;display:flex;align-items:flex-end;overflow:hidden}
.net-gr .net-gsvg{width:100%;height:100%;display:block}
.net-ft{flex:none;display:flex;justify-content:space-between;align-items:baseline;margin:0 0;padding:7px 0 8px;border-top:1px solid var(--w-line,rgba(255,255,255,.14));font:600 10px/1 "Inter",sans-serif;letter-spacing:.04em;color:var(--w-ink2,rgba(255,255,255,.55))}
.net-ft b{display:block;margin-top:3px;font:600 13px/1 "Inter",sans-serif;letter-spacing:0;color:var(--w-ink,#fff);font-variant-numeric:tabular-nums}
`;
document.head.appendChild(css);

const icon = (s: number) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><defs><linearGradient id="nwi" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5ac8fa"/><stop offset="1" stop-color="${BLUE}"/></linearGradient></defs><rect width="24" height="24" rx="5.6" fill="url(#nwi)"/><circle cx="12" cy="12.5" r="6.4" fill="none" stroke="#fff" stroke-width="1.5"/><path d="M5.6 12.5h12.8M12 6.1c2.2 2.4 2.2 9.4 0 12.8M12 6.1c-2.2 2.4-2.2 9.4 0 12.8" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/></svg>`;
const d = (size: 'S' | 'M', desc: string, withIcon = false) => ({
  id: `net-${size.toLowerCase()}`, family: 'Network', group: 'net', size: size as WidgetSize, name: 'Network', desc, icon: withIcon ? icon : undefined, mount: network(size),
});
export default defineWidgets([d('S', 'Your download and upload speed, plus ping.', true), d('M', 'Live download and upload speeds with a 60-second graph, your connection details and ping.')]);
