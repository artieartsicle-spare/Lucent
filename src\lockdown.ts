const BLOCKED_KEYS = new Set(['F5', 'F12']);
const BLOCKED_CTRL = new Set(['r', 'p', 's', 'u', 'g']);
const BLOCKED_CTRL_SHIFT = new Set(['i', 'j', 'c']);

window.addEventListener('contextmenu', (e) => e.preventDefault(), true);

window.addEventListener(
  'keydown',
  (e) => {
    const k = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    if (BLOCKED_KEYS.has(e.key) || (ctrl && !e.shiftKey && BLOCKED_CTRL.has(k)) || (ctrl && e.shiftKey && BLOCKED_CTRL_SHIFT.has(k))) {
      e.preventDefault();
    }
  },
  true
);
