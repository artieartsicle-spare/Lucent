import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './lockdown';
import './fonts.css';
import './settings.css';
import appIcon from '../assets/icon.png';
import type { Place } from './widgets/_api';
import { parseCoords, savedPlace, savePlace, searchPlaces } from './widgets/_where';

type S = {
  appearance: 'light' | 'dark' | 'auto'; widgetStyle: string; accent: string;
  desktopIcons: boolean; desktopMenu: boolean; showDrives: boolean; uiFont: string; iconSize: number; galleryAboveDock: boolean; dockClearance: number; glassHighlight: number; spotlightLiveBlur: boolean; spotlightEnabled: boolean; launchAtLogin: boolean; checkUpdates: boolean; version: string; dataDir: string;
};
const TAURI = '__TAURI_INTERNALS__' in window;
const demo: S = {
  appearance: 'light', widgetStyle: 'regular', accent: '#0a84ff', uiFont: 'auto', desktopIcons: false,
  desktopMenu: true, showDrives: true, iconSize: 64, galleryAboveDock: false, dockClearance: 70, glassHighlight: 100, spotlightLiveBlur: false, spotlightEnabled: true, launchAtLogin: false, checkUpdates: true, version: '0.1.1', dataDir: 'C:\\Users\\you\\AppData\\Roaming\\com.lucent.app',
};
const DEMO: Record<string, unknown> = {
  net_status: { wifi: { available: true, connected: true, ssid: 'Home Wi-Fi', signal: 82 }, adapters: [
    { name: 'Wi-Fi', desc: 'Intel(R) Wi-Fi 6 AX201', status: 'Up', speed: '866.7 Mbps', media: 'Native 802.11', ip: '192.168.1.24', gw: '192.168.1.1', dns: '1.1.1.1, 8.8.8.8' },
    { name: 'Ethernet', desc: 'Realtek PCIe GbE', status: 'Disconnected', speed: '', media: '802.3', ip: '', gw: '', dns: '' } ] },
  update_check: { status: 'latest', current: '0.1.1' },
  radios_get: { WiFi: true, Bluetooth: true },
  bt_devices: [{ name: 'AirPods Pro', connected: true }, { name: 'MX Master 3', connected: true }, { name: 'Magic Keyboard', connected: false }],
  power_status: { hasBattery: true, percent: 47, ac: false, charging: false, secondsLeft: 9300, saver: false },
  bat_get: { host: 'DESKTOP', devices: [{ name: 'AirPods Pro', pct: 78, charging: false }, { name: 'MX Master 3', pct: 41, charging: false }] },
};
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (TAURI) return invoke<T>(cmd, args);
  if (cmd === 'radio_set') { const r = DEMO.radios_get as Record<string, boolean>; r[args?.kind as string] = !!args?.on; return { ...r } as unknown as T; }
  if (cmd in DEMO) return DEMO[cmd] as T;
  if (cmd === 'settings_set') (demo as Record<string, unknown>)[args?.key as string] = args?.value;
  return demo as unknown as T;
}

let st: S = demo;
const set = (key: keyof S, value: unknown) => {
  (st as Record<string, unknown>)[key] = value;
  syncAll();
  void call<S>('settings_set', { key, value }).then((s) => { st = s; syncAll(); });
};

type Ctl =
  | { t: 'toggle'; key: 'desktopIcons' | 'desktopMenu' | 'showDrives' | 'launchAtLogin' | 'checkUpdates' | 'galleryAboveDock' | 'spotlightLiveBlur' | 'spotlightEnabled' }
  | { t: 'dockheight' }
  | { t: 'highlight' }
  | { t: 'radio'; kind: 'WiFi' | 'Bluetooth' }
  | { t: 'wxloc' } | { t: 'slider' } | { t: 'modes' } | { t: 'swatches' } | { t: 'wstyle' } | { t: 'font' }
  | { t: 'popup'; opts: [string, string][] }
  | { t: 'button'; label: string; id: string; danger?: boolean; confirm?: string; then?: 'minimize' }
  | { t: 'keys'; keys: string[][] } | { t: 'value'; get: () => string };
type Row = { id: string; title: string; desc?: string; words?: string; ctl: Ctl[] };
type Sec = { title?: string; rows: Row[]; note?: string; dyn?: () => Sec[] };
type Pane = { id: string; title: string; color: string; glyph: string; secs: Sec[]; load?: () => Promise<void> };

const G = {
  general: '<path d="M4 8h9M17 8h3M4 16h3M11 16h9"/><circle cx="15" cy="8" r="2"/><circle cx="9" cy="16" r="2"/>',
  appearance: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="#fff"/>',
  desktop: '<rect x="3.5" y="5" width="17" height="11" rx="2"/><path d="M9 20h6M12 16v4"/>',
  widgets: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
  spotlight: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15.2 15.2 5 5"/>',
  keyboard: '<rect x="3" y="7" width="18" height="11" rx="2.5"/><path d="M7 11h.01M11 11h.01M15 11h.01M7.5 15h9"/>',
  wifi: '<path d="M3 9.5a14 14 0 0 1 18 0M6 13a9 9 0 0 1 12 0M9 16.5a4.5 4.5 0 0 1 6 0"/><circle cx="12" cy="19.6" r="0.6" fill="#fff"/>',
  bluetooth: '<path d="m7 7.5 10 9-5 4.5V3l5 4.5-10 9"/>',
  network: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c3.2 3.4 3.2 13.6 0 17M12 3.5c-3.2 3.4-3.2 13.6 0 17"/>',
  battery: '<rect x="3" y="8" width="16" height="8.5" rx="2.2"/><path d="M21.2 11v3"/><rect x="5.2" y="10.2" width="7" height="4.1" rx="0.8" fill="#fff" stroke="none"/>',
  wallpaper: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.5"/><path d="m4 17 5-4.5 3.5 3L15 13l5 4.5"/>',
  about: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
};
const SIZES: [number, string][] = [[48, 'Small'], [64, 'Medium'], [80, 'Large'], [96, 'Huge']];
const ACCENTS: [string, string][] = [['#0a84ff', 'Blue'], ['#bf5af2', 'Purple'], ['#ff375f', 'Pink'], ['#ff453a', 'Red'], ['#ff9f0a', 'Orange'], ['#ffd60a', 'Yellow'], ['#30d158', 'Green'], ['#8e8e93', 'Graphite']];
let cleanBy = 'name';
const btn = (label: string, id: string, extra: Partial<Extract<Ctl, { t: 'button' }>> = {}): Ctl => ({ t: 'button', label, id, ...extra });

type Adapter = { name: string; desc: string; status: string; speed: string; media: string; ip: string; gw: string; dns: string };
type Live = {
  net?: { wifi: { available: boolean; connected: boolean; ssid: string; signal: number | null }; adapters: Adapter[] };
  radios?: Record<string, boolean>;
  bt?: { name: string; connected: boolean }[];
  power?: { hasBattery: boolean; percent: number | null; ac: boolean; charging: boolean; secondsLeft: number | null; saver: boolean };
  bats?: { host: string; devices: { name: string; pct: number }[] };
};
const live: Live = {};

const PANES: Pane[] = [
  { id: 'general', title: 'General', color: '#8e8e93', glyph: G.general, secs: [
    { title: 'Startup', rows: [
      { id: 'login', title: 'Open at login', desc: 'Start Lucent when you sign in to Windows.', words: 'startup autostart boot', ctl: [{ t: 'toggle', key: 'launchAtLogin' }] },
    ] },
    { title: 'About', rows: [
      { id: 'ver', title: 'Version', words: 'about', ctl: [{ t: 'value', get: () => st.version }] },
      { id: 'upd', title: 'Check for updates', desc: 'Looks for a newer Lucent release on GitHub.', words: 'update upgrade release new version download', ctl: [btn('Check Now', 'check-update')] },
      { id: 'autoupd', title: 'Check for updates automatically', desc: 'Checks GitHub once each time Lucent starts. Nothing is downloaded or installed.', words: 'update startup automatic', ctl: [{ t: 'toggle', key: 'checkUpdates' }] },
      { id: 'data', title: 'Settings and custom icons', desc: 'Stored in your app data folder.', words: 'folder files appdata', ctl: [btn('Show in Explorer', 'open-data')] },
    ] },
    { title: 'App', rows: [
      { id: 'reset', title: 'Reset all settings', desc: 'Back to defaults. Icons you picked yourself are kept.', words: 'defaults restore', ctl: [btn('Reset…', 'reset', { danger: true, confirm: 'Click again to reset' })] },
      { id: 'quit', title: 'Quit Lucent', desc: 'Windows’ own desktop icons come back when it quits.', words: 'exit close', ctl: [btn('Quit', 'quit', { danger: true })] },
    ] },
  ] },
  { id: 'appearance', title: 'Appearance', color: '#1c1c1e', glyph: G.appearance, secs: [
    { rows: [{ id: 'mode', title: 'Appearance', desc: 'Applies to widgets, Spotlight and this window.', words: 'light dark auto theme mode', ctl: [{ t: 'modes' }] }] },
    { title: 'Widgets', rows: [
      { id: 'highlight', title: 'Glass highlights', desc: 'How bright the thin light edge on widgets is. 100% is the default look; lower it if the edges look too strong on your display.', words: 'glass edge rim shine specular border transparency intensity liquid', ctl: [{ t: 'highlight' }] },
      { id: 'wstyle', title: 'Widget style', desc: 'The glass style new widgets start with. You can still change any widget on its own in Edit Widgets.', words: 'default glass regular light dark clear style', ctl: [{ t: 'wstyle' }] },
      { id: 'wrestyle', title: 'Apply to widgets on the desktop', desc: 'Restyle every widget you have placed so far.', words: 'all existing', ctl: [btn('Apply', 'restyle-widgets')] },
    ] },
    { title: 'Theme', rows: [
      { id: 'accent', title: 'Colour', words: 'accent colour color blue purple pink red orange yellow green graphite', ctl: [{ t: 'swatches' }] },
    ] },
    { title: 'Font', rows: [
      { id: 'font', title: 'Interface font', desc: 'Used by Settings and Spotlight. If the font is not installed, Inter is used.', words: 'typeface sf pro inter segoe text', ctl: [{ t: 'font' }] },
    ] },
  ] },
  { id: 'desktop', title: 'Desktop', color: '#0a84ff', glyph: G.desktop, secs: [
    { title: 'Icons', rows: [
      { id: 'icons', title: 'macOS-style desktop icons', desc: 'Off: Windows’ own icons stay (drag files onto the desktop as usual). On: hides them and draws glass ones.', words: 'desktop icons hide show', ctl: [{ t: 'toggle', key: 'desktopIcons' }] },
      { id: 'size', title: 'Icon size', words: 'small medium large huge', ctl: [{ t: 'slider' }] },
      { id: 'drives', title: 'Show drives on the desktop', desc: 'Your disks (C:, D:, USB sticks) appear as icons. Double-click to open.', words: 'drives disks usb hard disk volumes', ctl: [{ t: 'toggle', key: 'showDrives' }] },
      { id: 'menu', title: 'Right-click menu on desktop', desc: 'Sort, clean up and view options when you right-click the desktop.', words: 'context menu', ctl: [{ t: 'toggle', key: 'desktopMenu' }] },
    ] },
    { title: 'Arrange', rows: [
      { id: 'cleanup', title: 'Clean up icons', words: 'sort arrange name kind date', ctl: [
        { t: 'popup', opts: [['name', 'By name'], ['kind', 'By kind'], ['date', 'By date']] }, btn('Clean up', 'cleanup') ] },
      { id: 'refresh-icons', title: 'Refresh desktop icons', desc: 'Reads the Desktop folder again.', words: 'reload', ctl: [btn('Refresh', 'refresh-icons')] },
    ] },
    { title: 'Widgets', rows: [
      { id: 'edit', title: 'Edit widgets', desc: 'Add, move and resize widgets on the desktop.', words: 'add gallery widgets', ctl: [btn('Edit Widgets', 'edit-widgets', { then: 'minimize' })] },
      { id: 'abovedock', title: 'Keep Edit Widgets above the dock', desc: 'Lifts the widget gallery and its Done button clear of a floating dock such as MyDockFinder. The desktop layer is not raised, so screenshots still work.', words: 'dock mydockfinder done button gallery taskbar covered hidden overlap above', ctl: [{ t: 'toggle', key: 'galleryAboveDock' }] },
      { id: 'dockheight', title: 'Dock height', desc: 'How far the gallery stays above the bottom of the screen. Start at 70 px and raise it until the Done button clears your dock. Used when the setting above is on.', words: 'dock clearance height size mydockfinder', ctl: [{ t: 'dockheight' }] },
      { id: 'calibrate', title: 'Calibrate layout', desc: 'Set the margins so widgets clear your taskbar and screen edges.', words: 'margins grid taskbar', ctl: [btn('Calibrate…', 'calibrate', { then: 'minimize' })] },
    ] },
    { title: 'Weather', rows: [
      { id: 'wxloc', title: 'Weather location', words: 'weather location city my location automatic coordinates sun moon air quality uv', ctl: [{ t: 'wxloc' }] },
    ] },
    { title: 'My widgets', rows: [
      { id: 'wnew', title: 'New widget from template', desc: 'Creates a .widget.html file you can edit in any editor.', words: 'create custom widgets', ctl: [btn('New…', 'widgets-new')] },
      { id: 'wfolder', title: 'Widgets folder', words: 'open files widgets', ctl: [btn('Open Folder', 'widgets-folder')] },
    ] },
  ] },
  { id: 'wallpaper', title: 'Wallpaper', color: '#32ade6', glyph: G.wallpaper, secs: [
    { rows: [
      { id: 'wallpaper', title: 'Wallpaper', desc: 'Widgets draw their glass from your wallpaper.', words: 'background picture image', ctl: [btn('Refresh', 'refresh-wallpaper'), btn('Change…', 'win:personalization-background')] },
    ] },
  ] },
  { id: 'spotlight', title: 'Spotlight', color: '#636366', glyph: G.spotlight, secs: [
    { rows: [
      { id: 'senable', title: 'Enable Spotlight', desc: 'Off: the Alt+Space shortcut is released, Spotlight stops indexing your files and apps, and clipboard history is cleared and no longer recorded.', words: 'spotlight disable turn off on search launcher hotkey shortcut alt space', ctl: [{ t: 'toggle', key: 'spotlightEnabled' }] },
    ] },
    { title: 'Icons', rows: [
      { id: 'sicons', title: 'Custom icons', desc: 'Right-click an app, file or action in Spotlight and choose Choose Icon… to use your own image.', words: 'icon image reset cache', ctl: [btn('Reset All', 'reset-spotlight-icons', { danger: true, confirm: 'Click again to reset' })] },
    ] },
    { title: 'Search', rows: [
      { id: 'sblur', title: 'Live blur instead of liquid glass', desc: 'Off: Spotlight is drawn as liquid glass that bends the screen behind it. On: Windows blurs what is behind it live (video keeps moving), without the glass effect. Applies the next time Spotlight opens.', words: 'spotlight glass blur refraction live acrylic', ctl: [{ t: 'toggle', key: 'spotlightLiveBlur' }] },
      { id: 'sopen', title: 'Open Spotlight', desc: 'Apps, files, actions, calculator and clipboard history.', words: 'search launcher', ctl: [{ t: 'keys', keys: [['Alt', 'Space']] }, btn('Open', 'spotlight')] },
      { id: 'sclip', title: 'Clipboard history', desc: 'The last 50 text items, kept in memory only.', words: 'clear privacy', ctl: [btn('Clear History', 'clear-clipboard')] },
    ] },
  ] },
  { id: 'keyboard', title: 'Keyboard', color: '#8e8e93', glyph: G.keyboard, secs: [
    { title: 'Shortcuts', rows: [
      { id: 'k-edit', title: 'Edit widgets', words: 'hotkey shortcut', ctl: [{ t: 'keys', keys: [['Ctrl', 'Shift', 'H'], ['Ctrl', 'Alt', 'W']] }] },
      { id: 'k-spot', title: 'Spotlight Search', words: 'hotkey shortcut', ctl: [{ t: 'keys', keys: [['Alt', 'Space'], ['Ctrl', 'Alt', 'Space']] }] },
      { id: 'k-quit', title: 'Quit', words: 'hotkey shortcut exit', ctl: [{ t: 'keys', keys: [['Ctrl', 'Shift', 'Q']] }] },
    ], note: 'If another app already uses a shortcut, the second one in each pair is the fallback.' },
  ] },
];
const GROUPS = [['general', 'appearance', 'desktop', 'wallpaper'], ['spotlight', 'keyboard']];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const tile = (p: Pane) => `<span class="tile" style="background-color:${p.color}"><svg viewBox="0 0 24 24">${p.glyph}</svg></span>`;
const CHEV = '<svg class="chev" viewBox="0 0 8 14"><path d="m1.5 1.5 5.5 5.5-5.5 5.5"/></svg>';
const BACK = '<svg viewBox="0 0 13 22"><path d="M11 2 2.5 11 11 20"/></svg>';
const UPDOWN = '<svg viewBox="0 0 9 15"><path d="m1.5 5.5 3-3.5 3 3.5M1.5 9.5l3 3.5 3-3.5"/></svg>';
const CHECK = '<svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m2 7.5 3.5 3.5L12 3.5"/></svg>';
const RADIO = '<i class="rad"><svg viewBox="0 0 12 12"><path d="m2.5 6.5 2.5 2.5 4.5-5.5"/></svg></i>';
let syncs: (() => void)[] = [];
const syncAll = () => { applyLook(); stack.forEach((p) => p.syncs.forEach((f) => f())); };

let wpAt = 0;
let wpUrl = '';
async function loadWallpaper() {
  if (!TAURI || Date.now() - wpAt < 4000) return;
  wpAt = Date.now();
  try {
    const buf = await call<ArrayBuffer>('wallpaper_bytes');
    if (!buf || buf.byteLength < 200) return;
    const bmp = await createImageBitmap(new Blob([buf]));
    const W = 336, H = 224;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const k = Math.max(W / bmp.width, H / bmp.height);
    c.getContext('2d')!.drawImage(bmp, (W - bmp.width * k) / 2, (H - bmp.height * k) / 2, bmp.width * k, bmp.height * k);
    bmp.close();
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    document.documentElement.style.setProperty('--wp', `url("${url}")`);
    if (wpUrl) URL.revokeObjectURL(wpUrl);
    wpUrl = url;
  } catch {
  }
}

let menuEl: HTMLElement | null = null;
const closeMenu = () => { menuEl?.remove(); menuEl = null; };
type Opt = [string, string, string?];
function popup(anchor: HTMLElement, opts: Opt[], cur: string, pick: (v: string) => void) {
  closeMenu();
  const m = (menuEl = el('div', 'menu'));
  for (const [v, label, hint] of opts) {
    if (v === '-') { m.append(el('div', 'mi sep')); continue; }
    const b = el('button', 'mi', `<i>${v === cur ? CHECK : ''}</i>${label}${hint ? `<small>${hint}</small>` : ''}`);
    b.onclick = () => { closeMenu(); pick(v); };
    m.append(b);
  }
  const scr = $('screen');
  scr.append(m);
  const S = scr.getBoundingClientRect(), r = anchor.getBoundingClientRect();
  m.style.maxHeight = `${S.height - 150}px`;
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = `${Math.max(12, Math.min(r.right - S.left - w, S.width - w - 12))}px`;
  const rb = r.bottom - S.top, rt = r.top - S.top;
  const roomBelow = S.height - 44 - rb, roomAbove = rt - 60;
  m.style.top = `${h <= roomBelow ? rb + 6 : h <= roomAbove ? rt - h - 6 : Math.max(60, Math.min(rb + 6, S.height - 44 - h))}px`;
}

const FONTS: [string, string][] = [['SF Pro Text', 'SF Pro'], ['Inter', 'Inter'], ['Segoe UI Variable Text', 'Segoe UI Variable'], ['Segoe UI', 'Segoe UI'], ['Arial', 'Arial']];
const probe = document.createElement('canvas').getContext('2d')!;
function installed(name: string): boolean {
  if (name === 'Inter') return true;
  const w = (f: string) => { probe.font = `40px ${f}`; return probe.measureText('mmmmmmmmmmlliWQ@#').width; };
  return w(`"${name}", monospace`) !== w('monospace') || w(`"${name}", serif`) !== w('serif');
}
const cleanFont = (v: string) => v.replace(/[^\w .\-]/g, '').trim().slice(0, 60);
const fontStack = (v: string) => {
  const n = cleanFont(v || 'auto');
  const head = !n || n === 'auto' ? `'SF Pro Text', 'SF Pro Display', 'SF Pro', -apple-system` : `'${n}'`;
  return `${head}, 'Inter', 'Segoe UI Variable Text', system-ui, sans-serif`;
};
const fontLabel = (v: string) => (!v || v === 'auto' ? 'Automatic' : FONTS.find(([f]) => f === v)?.[1] ?? v);

function makeCtl(c: Ctl): HTMLElement {
  switch (c.t) {
    case 'toggle': {
      const b = el('button', 'sw');
      b.setAttribute('role', 'switch');
      b.onclick = () => set(c.key, !st[c.key]);
      syncs.push(() => b.setAttribute('aria-checked', String(!!st[c.key])));
      return b;
    }
    case 'radio': {
      const b = el('button', 'sw');
      b.setAttribute('role', 'switch');
      b.onclick = () => {
        const now = live.radios?.[c.kind];
        if (now === undefined) return;
        live.radios![c.kind] = !now;
        renderPane(undefined, true);
        void call<Live['radios']>('radio_set', { kind: c.kind, on: !now }).then((r) => { if (r) live.radios = r; if (cur().id === 'wifi' || cur().id === 'bluetooth') renderPane(undefined, true); if (cur().id === 'wifi') void refreshLive(); });
      };
      syncs.push(() => { const v = live.radios?.[c.kind]; b.setAttribute('aria-checked', String(!!v)); b.disabled = v === undefined; b.style.opacity = v === undefined ? '0.4' : ''; });
      return b;
    }
    case 'slider': {
      const w = el('div', 'slider', `<span>Small</span><input type="range" min="0" max="3" step="1" aria-label="Icon size"><span>Huge</span>`);
      const r = w.querySelector('input') as HTMLInputElement;
      r.oninput = () => set('iconSize', SIZES[+r.value][0]);
      syncs.push(() => { const i = Math.max(0, SIZES.findIndex(([px]) => px === st.iconSize)); r.value = String(i); r.style.setProperty('--p', `${(i / 3) * 100}%`); });
      return w;
    }
    case 'modes': {
      const w = el('div', 'modes');
      const mini = (cls: string) => `<div class="mini ${cls}"></div>`;
      const defs: [S['appearance'], string, string][] = [
        ['auto', 'Auto', `${mini('l')}<div class="half">${mini('d')}</div>`], ['light', 'Light', mini('l')], ['dark', 'Dark', mini('d')],
      ];
      for (const [v, label, inner] of defs) {
        const b = el('button', 'mode', `<div class="ring"><div class="thumb">${inner}</div></div><span>${label}</span>${RADIO}`);
        b.onclick = () => set('appearance', v);
        syncs.push(() => b.setAttribute('aria-pressed', String(st.appearance === v)));
        w.append(b);
      }
      return w;
    }
    case 'wstyle': {
      const w = el('div', 'modes four');
      const defs: [string, string][] = [['regular', 'Dark'], ['light', 'Light'], ['frosted', 'Clear Light'], ['dark', 'Clear Dark']];
      for (const [v, label] of defs) {
        const b = el('button', 'mode', `<div class="ring"><div class="thumb"><div class="wg ${v}"></div></div></div><span>${label}</span>${RADIO}`);
        b.onclick = () => set('widgetStyle', v);
        syncs.push(() => b.setAttribute('aria-pressed', String(st.widgetStyle === v)));
        w.append(b);
      }
      return w;
    }
    case 'swatches': {
      const w = el('div'), row = el('div', 'sw-row'), cap = el('div', 'cap');
      for (const [hex, name] of ACCENTS) {
        const b = el('button', 'dot');
        b.style.background = hex; b.title = name; b.setAttribute('aria-label', name);
        b.onclick = () => set('accent', hex);
        syncs.push(() => { const on = st.accent.toLowerCase() === hex; b.setAttribute('aria-pressed', String(on)); if (on) cap.textContent = name; });
        row.append(b);
      }
      w.append(row, cap);
      return w;
    }
    case 'popup': {
      const b = el('button', 'pop', `<span></span>${UPDOWN}`);
      b.onclick = () => popup(b, c.opts, cleanBy, (v) => { cleanBy = v; syncAll(); });
      syncs.push(() => { (b.firstElementChild as HTMLElement).textContent = c.opts.find(([v]) => v === cleanBy)?.[1] ?? ''; });
      return b;
    }
    case 'button': {
      const b = el('button', `btn${c.danger ? ' danger' : ''}`, c.label);
      let armed = 0;
      b.onclick = () => {
        if (c.confirm && !armed) {
          b.textContent = c.confirm; b.classList.add('armed');
          armed = window.setTimeout(() => { armed = 0; b.textContent = c.label; b.classList.remove('armed'); }, 3000);
          return;
        }
        window.clearTimeout(armed); armed = 0; b.textContent = c.label; b.classList.remove('armed');
        if (c.id === 'check-update') { void checkUpdate(b); return; }
        run(c.id === 'cleanup' ? `cleanup:${cleanBy}` : c.id);
        if (c.then === 'minimize') void call('settings_window', { action: 'minimize' });
      };
      return b;
    }
    case 'highlight': {
      const opts: Opt[] = [0, 25, 50, 75, 100, 125, 150].map((v): Opt => [String(v), v === 0 ? 'Off' : v === 100 ? '100% (default)' : `${v}%`]);
      const b = el('button', 'pop', `<span></span>${UPDOWN}`);
      b.onclick = () => popup(b, opts, String(st.glassHighlight), (v) => set('glassHighlight', Number(v)));
      syncs.push(() => { (b.firstElementChild as HTMLElement).textContent = opts.find(([v]) => v === String(st.glassHighlight))?.[1] ?? `${st.glassHighlight}%`; });
      return b;
    }
    case 'dockheight': {
      const opts: Opt[] = [40, 50, 60, 70, 80, 90, 100, 120, 140, 160, 200].map((v): Opt => [String(v), `${v} px`]);
      const b = el('button', 'pop', `<span></span>${UPDOWN}`);
      b.onclick = () => popup(b, opts, String(st.dockClearance), (v) => set('dockClearance', Number(v)));
      syncs.push(() => { (b.firstElementChild as HTMLElement).textContent = opts.find(([v]) => v === String(st.dockClearance))?.[1] ?? `${st.dockClearance} px`; b.disabled = !st.galleryAboveDock; b.style.opacity = st.galleryAboveDock ? '' : '0.4'; });
      return b;
    }
    case 'font': {
      const holder = el('div', 'c');
      const b = el('button', 'pop', `<span></span>${UPDOWN}`);
      const custom = () => {
        const f = el('input', 'field') as HTMLInputElement;
        f.placeholder = 'Font family name'; f.value = FONTS.some(([v]) => v === st.uiFont) || st.uiFont === 'auto' ? '' : st.uiFont;
        const done = (apply: boolean) => { const v = cleanFont(f.value); if (apply && v) set('uiFont', v); holder.replaceChildren(b); };
        f.onkeydown = (e) => { if (e.key === 'Enter') done(true); else if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
        f.onblur = () => done(false);
        holder.replaceChildren(f); f.focus();
      };
      b.onclick = () => popup(b, [
        ['auto', 'Automatic', 'SF Pro, then Inter'], ['-', ''],
        ...FONTS.map(([v, l]): Opt => [v, l, installed(v) ? '' : 'not installed']), ['-', ''], ['__custom', 'Other…'],
      ], st.uiFont || 'auto', (v) => (v === '__custom' ? custom() : set('uiFont', v)));
      syncs.push(() => { (b.firstElementChild as HTMLElement).textContent = fontLabel(st.uiFont); });
      holder.append(b);
      return holder;
    }
    case 'wxloc': {
      const holder = el('div', 'c');
      const b = el('button', 'pop', `<span></span>${UPDOWN}`);
      const label = () => { const p = savedPlace(); return p ? [p.name, p.cc].filter(Boolean).join(', ') : 'Automatic'; };
      const save = (p?: Place) => { savePlace(p); holder.replaceChildren(b); syncAll(); };
      const ask = (hint: string, run: (v: string, f: HTMLInputElement) => Promise<void> | void) => {
        const f = el('input', 'field') as HTMLInputElement;
        f.placeholder = hint;
        let busy = false;
        const close = () => { if (!busy) holder.replaceChildren(b); };
        f.onkeydown = async (e) => {
          if (e.key === 'Escape') { e.stopPropagation(); busy = false; close(); }
          else if (e.key === 'Enter' && f.value.trim()) { busy = true; try { await run(f.value, f); } finally { busy = false; } }
        };
        f.onblur = () => window.setTimeout(close, 200);
        holder.replaceChildren(f); f.focus();
      };
      const city = () => ask('City name', async (v, f) => {
        let found: Place[] = [];
        try { found = await searchPlaces(v.trim()); } catch { found = []; }
        if (!found.length) { f.value = ''; f.placeholder = 'No match, try again'; return; }
        popup(f, found.map((p, i): Opt => [String(i), p.name, p.region || '']), '', (i) => save(found[+i]));
      });
      const coords = () => ask('Latitude, longitude', (v, f) => {
        const p = parseCoords(v);
        if (!p) { f.value = ''; f.placeholder = 'e.g. 40.71, -74.01'; return; }
        save(p);
      });
      b.onclick = () => {
        const p = savedPlace();
        popup(b, [
          ['auto', 'Automatic', 'from this PC’s IP address'],
          ...(p ? [['__saved', label()] as Opt] : []),
          ['-', ''],
          ['__city', 'Search for a city…'],
          ['__coords', 'Enter coordinates…'],
        ], p ? '__saved' : 'auto', (v) => { if (v === 'auto') save(); else if (v === '__city') city(); else if (v === '__coords') coords(); });
      };
      syncs.push(() => { (b.firstElementChild as HTMLElement).textContent = label(); });
      holder.append(b);
      return holder;
    }
    case 'keys': {
      const w = el('div', 'keys');
      for (const combo of c.keys) w.append(el('span', '', combo.map((k) => `<kbd>${k}</kbd>`).join('')));
      return w;
    }
    case 'value': {
      const s = el('span', 'val');
      syncs.push(() => { s.textContent = c.get(); });
      return s;
    }
  }
}
function run(id: string) {
  if (id.startsWith('win:')) void call('sys_open_settings', { page: id.slice(4) });
  else void call('settings_action', { id });
}

const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
const dark = matchMedia('(prefers-color-scheme: dark)');
dark.addEventListener('change', () => applyLook());
function applyLook() {
  const root = document.documentElement;
  root.dataset.theme = st.appearance === 'auto' ? (dark.matches ? 'dark' : 'light') : st.appearance;
  root.style.setProperty('--accent', st.accent);
  root.style.setProperty('--accent-fg', lum(st.accent) > 0.68 ? '#1d1d1f' : '#fff');
  root.style.setProperty('--font', fontStack(st.uiFont));
}

/* ---------- status bar clock ---------- */
const clockFmt = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });
function tick() {
  const parts = clockFmt.formatToParts(new Date());
  const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  $('clock').textContent = `${pick('hour')}:${pick('minute')}`;
}

/* ---------- pages ---------- */
type Page = { el: HTMLElement; scroll: HTMLElement; syncs: (() => void)[]; paneId?: string };
const stack: Page[] = [];
const top = () => stack[stack.length - 1];
const cur = () => PANES.find((p) => p.id === top()?.paneId) ?? PANES[0];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
let q!: HTMLInputElement;

function makePage(title: string, back?: string): Page {
  const page = el('div', 'page');
  page.innerHTML =
    `<div class="nav"><div class="bar" data-drag>${back ? `<button class="back" aria-label="Back">${BACK}<span>${back}</span></button>` : ''}<div class="nav-title">${esc(title)}</div></div></div><div class="scroll"></div><div class="dim"></div>`;
  const scroll = page.querySelector<HTMLElement>('.scroll')!;
  scroll.addEventListener('scroll', () => page.classList.toggle('scrolled', scroll.scrollTop > 42));
  page.querySelector('.back')?.addEventListener('click', () => pop());
  return { el: page, scroll, syncs: [] };
}

/* Home: app card, search, one card per group of panes. */
function buildRoot(): Page {
  const pg = makePage('Settings');
  syncs = pg.syncs;
  const sc = pg.scroll;
  sc.append(el('h1', 'large', 'Settings'));

  const sr = el('div', 'searchrow',
    `<label id="search"><svg class="mag" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.4"/><path d="m15.4 15.4 5 5"/></svg>` +
    `<input id="q" type="text" placeholder="Search" spellcheck="false" autocomplete="off" />` +
    `<button id="clear" type="button" aria-label="Clear"><svg viewBox="0 0 8 8"><path d="m1 1 6 6m0-6-6 6"/></svg></button></label>` +
    `<button id="cancel" type="button">Cancel</button>`);
  sc.append(sr);
  q = sr.querySelector<HTMLInputElement>('#q')!;

  const home = el('div');
  const results = el('div', 'sec');
  results.hidden = true;

  const app = el('button', 'card appcard', `<img src="${appIcon}" alt="" draggable="false"><span class="tx"><span class="n">Lucent</span><span class="s"></span></span>${CHEV}`);
  const sub = app.querySelector<HTMLElement>('.s')!;
  syncs.push(() => { sub.textContent = `Version ${st.version}`; });
  app.onclick = () => push('general');
  const appSec = el('div', 'sec'); appSec.append(app); home.append(appSec);

  for (const ids of GROUPS) {
    const sec = el('div', 'sec'), card = el('div', 'card');
    for (const id of ids) {
      const p = PANES.find((x) => x.id === id)!;
      const b = el('button', 'row ic', `<span class="l">${tile(p)}<span class="tx"><span class="t">${p.title}</span></span></span>${CHEV}`);
      b.onclick = () => push(id);
      card.append(b);
    }
    sec.append(card); home.append(sec);
  }
  sc.append(home, results);

  const sync = () => {
    sr.classList.toggle('on', document.activeElement === q || !!q.value);
    sr.querySelector('#search')!.classList.toggle('has', !!q.value);
  };
  q.addEventListener('focus', sync);
  q.addEventListener('blur', sync);
  q.addEventListener('input', () => {
    const terms = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    home.hidden = terms.length > 0; results.hidden = !terms.length;
    sync();
    results.textContent = '';
    if (!terms.length) return;
    const card = el('div', 'card');
    for (const p of PANES) for (const sec of p.secs) for (const r of sec.rows) {
      const hay = `${r.title} ${r.words ?? ''} ${p.title}`.toLowerCase();
      if (!terms.every((t) => hay.includes(t))) continue;
      const b = el('button', 'hit', `${tile(p)}<span>${r.title}<small>${p.title}</small></span>`);
      b.onclick = () => { q.blur(); push(p.id, r.id); };
      card.append(b);
    }
    if (card.children.length) results.append(card); else results.append(el('div', 'empty'));
    if (!card.children.length) results.firstElementChild!.textContent = `No results for “${q.value.trim()}”`;
  });
  sr.querySelector<HTMLElement>('#clear')!.onclick = () => { clearSearch(); q.focus(); };
  sr.querySelector<HTMLElement>('#cancel')!.onclick = () => { clearSearch(); q.blur(); };
  return pg;
}
function clearSearch() {
  if (!q?.value) return false;
  q.value = ''; q.dispatchEvent(new Event('input'));
  return true;
}

/* Detail page for one pane. Rows become iOS cells; descriptions become cell subtitles, or the group footer when a group has a single row. */
const SHOW_DESCRIPTIONS = false;
function fillDetail(pg: Page, p: Pane) {
  closeMenu();
  pg.syncs.length = 0; syncs = pg.syncs;
  const sc = pg.scroll; sc.textContent = '';
  sc.append(el('h1', 'large', p.title));
  for (const sec of p.secs.flatMap((x) => (x.dyn ? x.dyn() : [x]))) {
    if (!sec.rows.length) continue;
    const wrap = el('div', 'sec'), card = el('div', 'card');
    const single = sec.rows.length === 1;
    const foot: string[] = [];
    for (const r of sec.rows) {
      const kind = r.ctl[0].t;
      const wide = kind === 'modes' || kind === 'wstyle' || kind === 'swatches' || kind === 'slider';
      const asFoot = SHOW_DESCRIPTIONS && single && !!r.desc;
      if (asFoot) foot.push(r.desc!);
      const sub = SHOW_DESCRIPTIONS && !!r.desc && !asFoot;
      const row = el('div', `row${wide ? ' wide' : ''}${sub ? ' hasdesc' : ''}`);
      row.dataset.row = r.id;
      const left = el('div', 'tx', `<div class="t">${r.title}</div>${sub ? `<div class="d">${r.desc}</div>` : ''}`);
      const right = el('div', 'c');
      r.ctl.forEach((c) => right.append(makeCtl(c)));
      if (wide) { if (kind !== 'modes') row.append(left); row.append(right); } else row.append(left, right);
      card.append(row);
    }
    if (sec.note) foot.push(sec.note);
    if (sec.title) wrap.append(el('div', 'sec-head', sec.title));
    wrap.append(card);
    if (foot.length) wrap.append(el('div', 'sec-foot', foot.join(' ')));
    sc.append(wrap);
  }
  syncAll();
}
function renderPane(_flash?: string, keepScroll = false) {
  const pg = top();
  if (!pg?.paneId) return;
  const y = pg.scroll.scrollTop;
  fillDetail(pg, cur());
  pg.scroll.scrollTop = keepScroll ? y : 0;
}
let loading = '';
async function refreshLive() {
  const p = cur();
  if (!top()?.paneId || !p.load || loading === p.id) return;
  loading = p.id;
  try { await p.load(); } catch { }
  loading = '';
  if (cur().id === p.id) renderPane(undefined, true);
}

/* Push / pop with the iOS slide: the new page comes in from the right while the old one drifts left and dims.
   The back button and title fly in with it. Runs regardless of the Windows "animation effects" switch. */
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
const DUR = 400;
let busy = false;
function slide(entering: HTMLElement, leaving: HTMLElement, forward: boolean, done: () => void) {
  busy = true;
  const o = { duration: DUR, easing: EASE, fill: 'both' as const };
  const [inFrom, outTo] = forward ? ['100%', '-30%'] : ['-30%', '100%'];
  const enterDim = entering.querySelector<HTMLElement>('.dim'), leaveDim = leaving.querySelector<HTMLElement>('.dim');
  entering.animate([{ transform: `translateX(${inFrom})` }, { transform: 'translateX(0)' }], o);
  const a = leaving.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${outTo})` }], o);
  // the page underneath darkens as it is covered, and brightens again as it is uncovered
  (forward ? leaveDim : enterDim)?.animate(forward ? [{ opacity: 0 }, { opacity: 0.14 }] : [{ opacity: 0.14 }, { opacity: 0 }], o);
  if (forward) {
    entering.querySelector('.back')?.animate([{ opacity: 0, transform: 'translateX(56px)' }, { opacity: 1, transform: 'translateX(0)' }], o);
    entering.querySelector('.large')?.animate([{ opacity: 0.2, transform: 'translateX(48px)' }, { opacity: 1, transform: 'translateX(0)' }], o);
    leaving.querySelector('.large')?.animate([{ opacity: 1 }, { opacity: 0 }], { ...o, duration: DUR * 0.6 });
  } else {
    leaving.querySelector('.back')?.animate([{ opacity: 1 }, { opacity: 0 }], { ...o, duration: DUR * 0.5 });
    leaving.querySelector('.large')?.animate([{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0.2, transform: 'translateX(48px)' }], o);
    entering.querySelector('.large')?.animate([{ opacity: 0.4 }, { opacity: 1 }], o);
  }
  a.onfinish = () => { busy = false; done(); };
}
const settle = (...els: HTMLElement[]) => els.forEach((e) => e.getAnimations({ subtree: true }).forEach((a) => a.cancel()));
function push(id: string, flashRow?: string) {
  const p = PANES.find((x) => x.id === id);
  if (busy || !p || top()?.paneId === id) return;
  closeMenu();
  const from = top(), pg = makePage(p.title, 'Settings');
  pg.paneId = id;
  fillDetail(pg, p);
  stack.push(pg);
  syncAll();
  pg.el.style.transform = 'translateX(100%)'; // off-screen until the animation takes over, so it never flashes in place
  $('pages').append(pg.el);
  pg.el.classList.add('top');
  slide(pg.el, from.el, true, () => { pg.el.style.transform = ''; settle(pg.el, from.el); pg.el.classList.remove('top'); });
  if (flashRow) {
    const row = pg.scroll.querySelector<HTMLElement>(`[data-row="${flashRow}"]`);
    row?.scrollIntoView({ block: 'center' }); row?.classList.add('flash');
  }
  void refreshLive();
}
function pop() {
  if (busy || stack.length < 2) return false;
  closeMenu();
  const leaving = stack.pop()!, to = top();
  leaving.el.classList.add('top');
  slide(to.el, leaving.el, false, () => { leaving.el.remove(); settle(to.el); });
  return true;
}

/* ---------- iOS 18 alert, inside the phone ---------- */
type AlertBtn = { label: string; bold?: boolean; danger?: boolean; run?: () => void };
let alertEl: { close: (btn?: AlertBtn) => void; cancel: AlertBtn | undefined; main: AlertBtn | undefined } | null = null;
function showAlert(title: string, message: string, buttons: AlertBtn[]) {
  alertEl?.close();
  closeMenu();
  const scrim = el('div', 'scrim'), box = el('div', 'alert');
  box.setAttribute('role', 'alertdialog');
  box.innerHTML = `<div class="body"><h2>${esc(title)}</h2><p>${esc(message)}</p></div>`;
  const acts = el('div', `acts${buttons.length > 2 ? ' col' : ''}`);
  const close = (btn?: AlertBtn) => {
    if (!alertEl || alertEl.close !== close) return;
    alertEl = null;
    scrim.classList.add('out');
    window.setTimeout(() => scrim.remove(), 200);
    btn?.run?.();
  };
  for (const b of buttons) {
    const n = el('button', `act${b.bold ? ' bold' : ''}${b.danger ? ' danger' : ''}`, esc(b.label));
    n.onclick = () => close(b);
    acts.append(n);
  }
  box.append(acts);
  scrim.append(box);
  $('alerts').append(scrim);
  alertEl = { close, cancel: buttons.find((b) => !b.bold) ?? buttons[0], main: buttons.find((b) => b.bold) ?? buttons[0] };
}

type UpdateResult = { status: 'latest' | 'available' | 'error'; current?: string; version?: string; message?: string };
async function checkUpdate(b: HTMLElement) {
  if (b.dataset.busy) return;
  b.dataset.busy = '1'; b.textContent = 'Checking…'; b.classList.add('busy');
  const t0 = Date.now();
  let r: UpdateResult;
  try { r = (await call<UpdateResult>('update_check')) ?? { status: 'error' }; } catch (e) { r = { status: 'error', message: String(e) }; }
  const wait = 600 - (Date.now() - t0);
  if (wait > 0) await new Promise((res) => window.setTimeout(res, wait));
  b.textContent = 'Check Now'; b.classList.remove('busy'); delete b.dataset.busy;
  if (r.status === 'latest') showAlert('You’re Up to Date', `Lucent ${r.current ?? st.version} is the latest version.`, [{ label: 'OK', bold: true }]);
  else if (r.status === 'available') {
    showAlert(`Lucent ${r.version} Is Available`, `You have ${r.current ?? st.version}. Nothing is installed automatically; the download page opens in your browser.`, [
      { label: 'Later' }, { label: 'Download', bold: true, run: () => void call('update_open') },
    ]);
  } else showAlert('Couldn’t Check for Updates', r.message || 'Check your internet connection and try again.', [{ label: 'OK', bold: true }]);
}

/* ---------- window + input ---------- */
const win = (action: string) => void call('settings_window', { action });

/* Dynamic Island: press and hold -> it shrinks, then opens with Minimise / Exit. A press that moves drags the window instead. */
const isl = $('island');
const HOLD = 420;
let holdTimer = 0, pressing = false, sx = 0, sy = 0;
const islOpen = () => isl.classList.contains('open');
const islClose = () => { window.clearTimeout(holdTimer); pressing = false; isl.classList.remove('pressed', 'open'); };
isl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || islOpen()) return;
  pressing = true; sx = e.clientX; sy = e.clientY;
  isl.classList.add('pressed');
  isl.setPointerCapture(e.pointerId);
  holdTimer = window.setTimeout(() => { if (pressing) { isl.classList.remove('pressed'); isl.classList.add('open'); } }, HOLD);
});
isl.addEventListener('pointermove', (e) => {
  if (!pressing || islOpen() || Math.hypot(e.clientX - sx, e.clientY - sy) < 5) return;
  window.clearTimeout(holdTimer); pressing = false;
  isl.classList.remove('pressed');
  isl.releasePointerCapture(e.pointerId);
  win('drag');
});
const islUp = () => { if (!pressing) return; window.clearTimeout(holdTimer); pressing = false; if (!islOpen()) isl.classList.remove('pressed'); };
isl.addEventListener('pointerup', islUp);
isl.addEventListener('pointercancel', islUp);
$('isl-min').onclick = () => { islClose(); win('minimize'); };
$('isl-exit').onclick = () => win('close');

/* Resize from the bottom-left corner: Rust follows the cursor while the button is down; double-click for the default size. */
const grip = $('grip');
grip.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  grip.setPointerCapture(e.pointerId);
  void call('settings_resize', { phase: 'start' });
});
const gripEnd = () => void call('settings_resize', { phase: 'end' });
grip.addEventListener('pointerup', gripEnd);
grip.addEventListener('pointercancel', gripEnd);
grip.addEventListener('lostpointercapture', gripEnd);
grip.addEventListener('dblclick', () => void call('settings_resize', { phase: 'reset' }));
document.addEventListener('mousedown', (e) => {
  const t = e.target as HTMLElement;
  if (e.button === 0 && t.hasAttribute?.('data-drag')) win('drag');
  if (menuEl && !menuEl.contains(t)) closeMenu();
  if (islOpen() && !isl.contains(t)) islClose();
});
$('home').onclick = () => { pop(); };
window.addEventListener('wheel', (e) => {
  if (e.ctrlKey) e.preventDefault();
  else if (menuEl && !menuEl.contains(e.target as Node)) closeMenu();
}, { passive: false });
window.addEventListener('blur', () => { document.body.classList.add('inactive'); closeMenu(); islClose(); });
window.addEventListener('focus', () => { document.body.classList.remove('inactive'); void refreshLive(); });
document.addEventListener('keydown', (e) => {
  if (alertEl && (e.key === 'Escape' || e.key === 'Enter')) {
    e.preventDefault();
    const a = alertEl;
    a.close(e.key === 'Enter' ? a.main : a.cancel);
    return;
  }
  if (e.key === 'Escape') {
    if (islOpen()) islClose(); else if (menuEl) closeMenu(); else if (clearSearch()) q.blur(); else if (!pop()) win('close');
  } else if (e.ctrlKey && e.key.toLowerCase() === 'w') win('close');
  else if (e.ctrlKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    const wait = pop() ? 400 : 0;
    window.setTimeout(() => { q.focus(); q.select(); }, wait);
  } else if (e.altKey && e.key === 'ArrowLeft') pop();
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

void (async () => {
  try { st = await call<S>('settings_get'); } catch { }
  const root = buildRoot();
  stack.push(root);
  $('pages').append(root.el);
  syncAll();
  tick(); window.setInterval(tick, 5000);
  void refreshLive();
  if (TAURI) {
    void listen<S>('settings:changed', (e) => { st = e.payload; syncAll(); });
    void listen('wallpaper:changed', () => { wpAt = 0; window.setTimeout(() => void loadWallpaper(), 400); });
  }
  requestAnimationFrame(() => {
    document.body.classList.add('ready');
    void loadWallpaper(); window.addEventListener('focus', () => void loadWallpaper());
    if (TAURI) void call<boolean>('settings_ready');
  });
})();
