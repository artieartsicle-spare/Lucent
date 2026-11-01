import { defineWidgets } from './_api';
import './_cardStyles';
import { $, store, typing } from './_cardShared';

const NOTE_KEY = 'lucent-note';
const NOTE_DATE = 'lucent-note-date';
const folderGlyph = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"><path d="M3.5 7.2a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.4a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z"/></svg>`;
const shortDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
};
export const notes = (size: 'S' | 'M' | 'L') => (root: HTMLElement) => {
  const band = size === 'L' ? 58 : 44;
  root.innerHTML = $(`<div class="wc nt"><div class="nt-band" style="height:${band}px">${size === 'S' ? '' : folderGlyph + 'Notes'}</div>
    <div class="nt-body"><textarea class="ix nt-t" spellcheck="false" placeholder="New Note"></textarea><div class="nt-date"></div></div></div>`);
  const ta = root.querySelector('textarea') as HTMLTextAreaElement;
  const dt = root.querySelector('.nt-date') as HTMLElement;
  const showDate = () => (dt.textContent = shortDate(store.get<number>(NOTE_DATE, Date.now())));
  ta.value = store.get<string>(NOTE_KEY, '');
  showDate();
  ta.addEventListener('focus', () => typing(true));
  ta.addEventListener('blur', () => typing(false));
  ta.addEventListener('input', () => {
    store.set(NOTE_KEY, ta.value);
    store.set(NOTE_DATE, Date.now());
    showDate();
    window.dispatchEvent(new CustomEvent('lucent-note', { detail: ta }));
  });
  const sync = (e: Event) => {
    if ((e as CustomEvent).detail !== ta) {
      ta.value = store.get<string>(NOTE_KEY, '');
      showDate();
    }
  };
  window.addEventListener('lucent-note', sync);
  return () => {
    window.removeEventListener('lucent-note', sync);
    typing(false);
  };
};

export default defineWidgets([
  {
    id: 'notes-s', family: 'Notes', group: 'notes', size: 'S',
    name: 'Notes',
    desc: 'A small sticky note for quick thoughts. Click it and start typing.',
    mount: notes('S'),
  },
  {
    id: 'notes-m', family: 'Notes', group: 'notes', size: 'M',
    name: 'Notes',
    desc: 'A note you can type in right on your desktop. Every Notes widget shows the same note.',
    mount: notes('M'),
  },
  {
    id: 'notes-l', family: 'Notes', group: 'notes', size: 'L',
    name: 'Notes',
    desc: 'A roomy note with a header, for longer thoughts. Every Notes widget shows the same note.',
    mount: notes('L'),
  },
]);
