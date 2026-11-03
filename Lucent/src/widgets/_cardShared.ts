export const $ = (html: string) => html.replace(/\s*\n\s*/g, '');
export const typing = (on: boolean) => (window as any).overlayAPI?.setTyping?.(on);
export const store = {
  get<T>(k: string, d: T): T {
    try {
      const r = localStorage.getItem(k);
      return r ? (JSON.parse(r) as T) : d;
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
    }
  },
};