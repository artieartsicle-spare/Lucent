import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

type WallpaperMeta = { hasData: boolean; style: number; tile: boolean; color: number[]; rev: string };
type WallpaperInfo = { data: Uint8Array | null; style: number; tile: boolean; color: number[] };

const send = (cmd: string, args?: Record<string, unknown>) => {
  invoke(cmd, args).catch((e) => console.warn(`[bridge] ${cmd} failed:`, e));
};

async function wallpaperInfo(m: WallpaperMeta): Promise<WallpaperInfo> {
  let data: Uint8Array | null = null;
  if (m.hasData) {
    try {
      data = new Uint8Array(await invoke<ArrayBuffer>('wallpaper_bytes'));
    } catch (e) {
      console.warn('[bridge] wallpaper_bytes failed:', e);
    }
  }
  return { data, style: m.style, tile: m.tile, color: m.color };
}

function install() {
  const api = {
    setInteractive: (on: boolean) => send('overlay_set_interactive', { on: !!on }),
    bottomInset: () => invoke<number>('overlay_bottom_inset'),
    setEditing: (on: boolean, light?: boolean) => send('overlay_set_editing', { on: !!on, light: !!light }),
    setTyping: (on: boolean) => send('overlay_set_typing', { on: !!on }),
    onSystem: (cb: (s: unknown) => void) => void listen('system:stats', (e) => cb(e.payload)),
    getBatteries: () => invoke('bat_get'),
    getMedia: () => invoke('media_get'),
    mediaControl: (action: 'toggle' | 'next' | 'prev') => send('media_control', { action }),
    rssGet: (url: string) => invoke<string>('rss_get', { url: String(url) }),
    pageImage: (url: string) => invoke<string>('page_image', { url: String(url) }),
    netStatus: () => invoke('net_status'),
    netPing: () => invoke<number | null>('net_ping'),
    httpGet: (url: string) => invoke<string>('http_get', { url: String(url) }),
    openUrl: (url: string) => send('open_url', { url: String(url) }),
    filesList: (kind: string, limit?: number) => invoke('files_list', { kind: String(kind), limit: limit ?? null }),
    photosList: (kind: string) => invoke('photos_list', { kind: String(kind) }),
    pickFolder: () => invoke<string | null>('pick_folder'),
    photoThumb: (path: string, maxEdge?: number) => invoke<string>('photo_thumb', { path: String(path), maxEdge: maxEdge ?? null }),
    pathOpen: (path: string, reveal?: boolean) => send('path_open', { path: String(path), reveal: !!reveal }),
    fileIcons: (paths: string[]) => invoke<Record<string, string>>('spotlight_icons', { paths: paths.map(String) }),
    userWidgetsList: () => invoke<{ file: string; source: string }[]>('userwidgets_list'),
    onUserWidgets: (cb: (l: { file: string; source: string }[]) => void) => void listen('userwidgets:changed', (e) => cb(e.payload as never)),

    desktopGet: () => invoke('desktop_get'),
    onDesktop: (cb: (p: unknown) => void) => void listen('desktop:changed', (e) => cb(e.payload)),
    desktopOpen: (id: string) => send('desktop_open', { id: String(id) }),
    desktopReveal: (id: string) => send('desktop_reveal', { id: String(id) }),
    desktopPaste: () => send('desktop_paste'),
    desktopDragOut: (ids: string[]) => invoke<boolean>('desktop_drag_out', { ids: ids.map(String) }),
    desktopTrash: (id: string) => invoke<boolean>('desktop_trash', { id: String(id) }),
    desktopRename: (id: string, name: string) => invoke('desktop_rename', { id: String(id), name: String(name) }),
    desktopInfo: (id: string) => invoke('desktop_info', { id: String(id) }),
    desktopPickIcon: (id: string) => invoke('desktop_pick_icon', { id: String(id) }),
    desktopResetIcon: (id: string) => invoke<boolean>('desktop_reset_icon', { id: String(id) }),
    desktopOpenWith: (id: string) => send('desktop_open_with', { id: String(id) }),
    desktopCompress: (ids: string[]) => send('desktop_compress', { ids: ids.map(String) }),
    desktopDuplicate: (ids: string[]) => send('desktop_duplicate', { ids: ids.map(String) }),
    desktopAlias: (ids: string[]) => send('desktop_alias', { ids: ids.map(String) }),
    desktopCopy: (ids: string[]) => send('desktop_copy', { ids: ids.map(String) }),
    desktopCopyPath: (id: string) => send('desktop_copy_path', { id: String(id) }),
    desktopNewFolder: () => invoke('desktop_new_folder'),
    desktopSetSize: (px: number) => send('desktop_set_size', { px: Number(px) }),
    desktopRefresh: () => send('desktop_refresh'),
    desktopEmptyBin: () => send('desktop_empty_bin'),
    desktopNativeMenu: (x: number, y: number) => send('desktop_native_menu', { x, y }),
    openAppSettings: () => send('settings_open'),
    setSetting: (key: string, value: unknown) => send('settings_set', { key, value }),
    openSettings: (page: string) => send('sys_open_settings', { page: String(page) }),
    copyText: (t: string) => send('overlay_copy', { text: String(t) }),

    getWallpaper: async () => wallpaperInfo(await invoke<WallpaperMeta>('wallpaper_meta')),
    onWallpaper: (cb: (info: WallpaperInfo) => void) =>
      void listen<WallpaperMeta>('wallpaper:changed', async (e) => cb(await wallpaperInfo(e.payload))),
  };
  (window as unknown as { overlayAPI: typeof api }).overlayAPI = api;

  void listen<{ x: number; y: number }>('overlay:cursor', (e) => {
    const { x, y } = e.payload;
    const target = document.elementFromPoint(x, y) ?? document.body;
    target.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y })
    );
  });

  const dropping = (on: boolean) => document.body.classList.toggle('dropping', on);
  void listen('tauri://drag-enter', () => dropping(true));
  void listen('tauri://drag-leave', () => dropping(false));
  void listen<{ paths: string[] }>('tauri://drag-drop', (e) => {
    dropping(false);
    if (e.payload.paths?.length) send('desktop_drop', { paths: e.payload.paths });
  });

  window.addEventListener('load', () => send('overlay_ready'));
}

if ('__TAURI_INTERNALS__' in window) install();
