export type FileItem = { name: string; path: string; mtime: number; size: number };
type Api = {
  filesList?: (kind: string, limit?: number) => Promise<FileItem[]>;
  photosList?: (kind: string) => Promise<FileItem[]>;
  photoThumb?: (path: string, maxEdge?: number) => Promise<string>;
  pathOpen?: (path: string, reveal?: boolean) => void;
  fileIcons?: (paths: string[]) => Promise<Record<string, string>>;
  rssGet?: (url: string) => Promise<string>;
  pageImage?: (url: string) => Promise<string>;
  netStatus?: () => Promise<NetStatus>;
  netPing?: () => Promise<number | null>;
  onSystem?: (cb: (s: unknown) => void) => void;
  httpGet?: (url: string) => Promise<string>;
  openUrl?: (url: string) => void;
};
export type NetStatus = {
  adapters: { name: string; desc: string; status: string; speed: string; media: string; ip: string; gw: string; dns: string; profile?: string }[];
  wifi: { available: boolean; connected: boolean; ssid: string; signal: number | null };
} | null;
export const native = (): Api => ((window as unknown as { overlayAPI?: Api }).overlayAPI ?? {}) as Api;

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function ago(unixSec: number, now = Date.now()): string {
  const d = new Date(unixSec * 1000);
  const diff = now - d.getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const y = new Date(now - 86_400_000);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(d.getFullYear() !== today.getFullYear() ? { year: '2-digit' } : {}) });
}

export const fmtSize = (b: number) =>
  b < 1024 ? `${b} B` : b < 1024 ** 2 ? `${Math.round(b / 1024)} KB` : b < 1024 ** 3 ? `${(b / 1024 ** 2).toFixed(b < 10 * 1024 ** 2 ? 1 : 0)} MB` : `${(b / 1024 ** 3).toFixed(1)} GB`;
