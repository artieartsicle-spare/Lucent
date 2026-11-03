import { defineWidgets } from './_api';
import './_styles';
import { $, ring } from './_shared';

type Sys = {
  cpu: number;
  hist: number[];
  cores: number;
  model: string;
  memTotal: number;
  memFree: number;
  disk: { total: number; free: number } | null;
  diskLabel: string;
  uptime: number;
  memHist: number[];
};
const sysSubs = new Set<(s: Sys | null) => void>();
let sysLast: Sys | null = null;
const memHist: number[] = [];
type RawSys = {
  cpu: number;
  cores: number[];
  model?: string;
  memTotal: number;
  memUsed: number;
  disks: { name: string; used: number; total: number }[];
  uptime: number;
};
const cpuHist: number[] = [];
let sysStarted = false;
function sysPush(r: RawSys) {
  const mv = (r.memUsed / r.memTotal) * 100;
  if (!sysLast) {
    for (let i = 0; i < 59; i++) {
      cpuHist.push(r.cpu);
      memHist.push(mv);
    }
  }
  cpuHist.push(r.cpu);
  memHist.push(mv);
  if (cpuHist.length > 60) cpuHist.shift();
  if (memHist.length > 60) memHist.shift();
  const d = r.disks.find((x) => /^c:?$/i.test(x.name)) || r.disks[0];
  sysLast = {
    cpu: r.cpu,
    hist: cpuHist.slice(),
    cores: r.cores.length,
    model: r.model || '',
    memTotal: r.memTotal,
    memFree: r.memTotal - r.memUsed,
    disk: d ? { total: d.total, free: d.total - d.used } : null,
    diskLabel: d ? d.name : '',
    uptime: r.uptime,
    memHist: memHist.slice(),
  };
  sysSubs.forEach((f) => f(sysLast));
}
function sysSubscribe(cb: (s: Sys | null) => void) {
  sysSubs.add(cb);
  cb(sysLast);
  if (!sysStarted) {
    sysStarted = true;
    (window as any).overlayAPI?.onSystem?.(sysPush);
  }
  return () => {
    sysSubs.delete(cb);
  };
}
const SYS_ICO = [
  `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="6.5" y="6.5" width="11" height="11" rx="2.2"/><rect x="9.6" y="9.6" width="4.8" height="4.8" rx=".8" fill="currentColor" stroke="none"/><path d="M9.5 3.5v3M14.5 3.5v3M9.5 17.5v3M14.5 17.5v3M3.5 9.5h3M3.5 14.5h3M17.5 9.5h3M17.5 14.5h3"/></svg>`,
  `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.8" y="7" width="18.4" height="8.6" rx="1.8"/><path d="M6.4 10.2v2.4M10 10.2v2.4M13.6 10.2v2.4M17.2 10.2v2.4M6 15.6v2.4M10 15.6v2.4M14 15.6v2.4M18 15.6v2.4"/></svg>`,
  `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.4" y="6.6" width="17.2" height="10.8" rx="2.6"/><path d="M3.8 13.4h16.4"/><circle cx="16.6" cy="15.4" r=".9" fill="currentColor" stroke="none"/></svg>`,
];
const sysColor = (pct: number) => (pct >= 90 ? '#ff453a' : pct >= 75 ? '#ff9f0a' : '#30d158');
function sysRing(which: 0 | 1 | 2) {
  const names = ['CPU', 'Memory', 'Storage'];
  return (root: HTMLElement) =>
    sysSubscribe((s) => {
      let pct = 0;
      if (s) pct = which === 0 ? s.cpu : which === 1 ? ((s.memTotal - s.memFree) / s.memTotal) * 100 : s.disk ? ((s.disk.total - s.disk.free) / s.disk.total) * 100 : 0;
      const p = Math.max(0, Math.min(100, Math.round(pct)));
      root.innerHTML = $(`<div class="wc bat1 solid lt">
        <div class="b1-ring">${ring(p, 8, 26, 66, s ? sysColor(p) : 'var(--w-ink3,rgba(255,255,255,.3))')}<div class="b1-ico" style="color:var(--w-ink,#fff)">${SYS_ICO[which]}</div></div>
        <div style="position:absolute;right:16px;top:17px;font:600 11px/1 Inter;letter-spacing:.06em;text-transform:uppercase;color:var(--w-ink2,rgba(255,255,255,.6))">${names[which]}</div>
        <div class="b1-pct">${s ? p + '%' : '--'}</div></div>`);
    });
}

export default defineWidgets([
  {
    id: 'cpu-s', family: 'System', group: 'cpu', size: 'S',
    name: 'Processor',
    desc: 'How hard your processor is working right now.',
    mount: sysRing(0),
  },
  {
    id: 'mem-s', family: 'System', group: 'mem', size: 'S',
    name: 'Memory',
    desc: 'How much of your memory (RAM) is in use.',
    mount: sysRing(1),
  },
  {
    id: 'disk-s', family: 'System', group: 'disk', size: 'S',
    name: 'Storage',
    desc: 'How full your system drive is.',
    mount: sysRing(2),
  },
]);
