export type MenuItem =
  | { sep: true }
  | {
      label: string;
      fn?: () => void;
      sub?: MenuItem[];
      checked?: boolean;
      disabled?: boolean;
      hd?: boolean;
    };

export function createMenu(ui: HTMLElement) {
  let root: HTMLDivElement | null = null;
  let subEl: HTMLDivElement | null = null;
  let subOwner: HTMLElement | null = null;
  let subTimer = 0;

  const build = (items: MenuItem[], isSub: boolean): HTMLDivElement => {
    const el = document.createElement('div');
    el.className = 'cmenu' + (isSub ? ' sub' : '');
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    for (const it of items) {
      if ('sep' in it) {
        const s = document.createElement('div');
        s.className = 'cs';
        el.appendChild(s);
        continue;
      }
      const row = document.createElement('div');
      row.className = 'ci' + (it.hd ? ' hd' : '') + (it.checked ? ' on' : '') + (it.disabled ? ' off' : '') + (it.sub ? ' has-sub' : '');
      row.textContent = it.label;
      if (it.sub) {
        const chev = document.createElement('span');
        chev.className = 'chev';
        chev.textContent = '\u203A';
        row.appendChild(chev);
      }
      if (!it.hd && !it.disabled) {
        if (it.sub) {
          const sub = it.sub;
          row.addEventListener('mouseenter', () => {
            clearTimeout(subTimer);
            openSub(row, sub);
          });
        } else {
          row.addEventListener('mouseenter', () => {
            if (!isSub) {
              clearTimeout(subTimer);
              subTimer = window.setTimeout(closeSub, 180);
            }
          });
          row.addEventListener('click', (e) => {
            e.stopPropagation();
            close();
            it.fn?.();
          });
        }
      }
      el.appendChild(row);
    }
    return el;
  };

  const place = (el: HTMLElement, x: number, y: number) => {
    el.classList.add('show');
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    el.style.left = `${Math.max(6, Math.min(x, window.innerWidth - w - 6))}px`;
    el.style.top = `${Math.max(6, Math.min(y, window.innerHeight - h - 6))}px`;
  };

  function closeSub() {
    subEl?.remove();
    subEl = null;
    subOwner?.classList.remove('open');
    subOwner = null;
  }
  function openSub(row: HTMLElement, items: MenuItem[]) {
    if (subOwner === row) return;
    closeSub();
    subOwner = row;
    row.classList.add('open');
    subEl = build(items, true);
    subEl.addEventListener('mouseenter', () => clearTimeout(subTimer));
    ui.appendChild(subEl);
    const r = row.getBoundingClientRect();
    const pr = (row.parentElement as HTMLElement).getBoundingClientRect();
    const w = subEl.offsetWidth || 190;
    const x = pr.right + 2 + w > window.innerWidth - 6 ? pr.left - w - 2 : pr.right + 2;
    place(subEl, x, r.top - 6);
  }

  function close() {
    clearTimeout(subTimer);
    closeSub();
    root?.remove();
    root = null;
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', close);
  }
  const onOutside = (e: PointerEvent) => {
    if ((e.target as HTMLElement | null)?.closest?.('.cmenu')) return;
    close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };

  function show(items: MenuItem[], x: number, y: number) {
    close();
    root = build(items, false);
    ui.appendChild(root);
    place(root, x, y);
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', close);
  }

  return { show, close, isOpen: () => !!root };
}

export type ContextMenu = ReturnType<typeof createMenu>;
