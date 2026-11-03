import { defineWidgets } from './_api';
import './_cardStyles';
import { $, store, typing } from './_cardShared';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

type Todo = { t: string; d: boolean };
const TODO_KEY = 'lucent-todo';
const loadTodos = () => store.get<Todo[]>(TODO_KEY, [{ t: 'Try the new widgets', d: false }, { t: 'Arrange the desktop', d: false }]).filter((x) => !x.d);
const listGlyph = (px: number) =>
  `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round"><path d="M10 7h9M10 12h9M10 17h9"/><circle cx="5.2" cy="7" r=".5"/><circle cx="5.2" cy="12" r=".5"/><circle cx="5.2" cy="17" r=".5"/></svg>`;
export const reminders = (size: 'S' | 'M' | 'L') => (root: HTMLElement) => {
  let items = loadTodos();
  const rowH = size === 'L' ? 36 : 31;
  const cap = size === 'L' ? 7 : size === 'M' ? 4 : 0;
  const wireChecks = (shown: Todo[]) =>
    root.querySelectorAll<HTMLElement>('.rm-row[data-i]').forEach((row) => {
      const cb = row.querySelector('.rm-cb') as HTMLElement;
      cb.addEventListener('click', () => {
        row.classList.add('done');
        const it = shown[Number(row.dataset.i)];
        setTimeout(() => {
          items = items.filter((x) => x !== it);
          store.set(TODO_KEY, items.map((x) => ({ t: x.t, d: false })));
          draw();
        }, 380);
      });
    });
  const draw = () => {
    const n = items.length;
    const left =
      size === 'L'
        ? `<div style="display:flex;justify-content:space-between;align-items:flex-start"><div class="rm-ico">${listGlyph(18)}</div><div class="rm-n" style="font-size:36px">${n}</div></div><div class="rm-name" style="margin:10px 0 8px;font-size:16px">Reminders</div>`
        : `<div class="rm-left"><div class="rm-ico">${listGlyph(18)}</div><div><div class="rm-n">${n}</div><div class="rm-name">Reminders</div></div></div>`;
    if (size === 'S') {
      const first = items.slice(0, 3);
      const srows = first.map((it, i) => `<div class="rm-row" data-i="${i}"><span class="ix rm-cb"></span><span class="rm-t">${esc(it.t)}</span></div>`).join('');
      root.innerHTML = $(`<div class="wc card rm-s"><div class="rm-hd"><div class="rm-name">Reminders</div><div class="rm-n">${n}</div></div><div class="rm-rows" style="--rh:30px">${srows || '<div class="rm-empty">All Reminders Completed</div>'}</div></div>`);
      wireChecks(first);
      return;
    }
    const shown = items.slice(0, cap - 1);
    const rows = shown.map((it, i) => `<div class="rm-row" data-i="${i}"><span class="ix rm-cb"></span><span class="rm-t">${esc(it.t)}</span></div>`).join('');
    const empty = n ? '' : '<div class="rm-empty">All Reminders Completed</div>';
    const add = `<div class="rm-row"><span class="rm-cb" style="opacity:.45"></span><input class="ix rm-in" type="text" maxlength="80" placeholder="New Reminder" spellcheck="false" /></div>`;
    const list = `<div class="rm-rows" style="--rh:${rowH}px;${n ? '' : 'flex:1;'}">${rows}${empty}${add}</div>`;
    root.innerHTML =
      size === 'M'
        ? $(`<div class="wc card" style="display:flex;gap:18px;padding:14px 16px"><div style="width:84px;flex:none">${left}</div><div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:${n ? 'flex-start' : 'stretch'}">${list}</div></div>`)
        : $(`<div class="wc card" style="padding:16px 18px;display:flex;flex-direction:column">${left}${list}</div>`);
    wireChecks(shown);
    const inp = root.querySelector('.rm-in') as HTMLInputElement | null;
    if (inp) {
      inp.addEventListener('focus', () => typing(true));
      inp.addEventListener('blur', () => typing(false));
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && inp.value.trim()) {
          items.push({ t: inp.value.trim(), d: false });
          store.set(TODO_KEY, items);
          draw();
          (root.querySelector('.rm-in') as HTMLInputElement | null)?.focus();
        }
      });
    }
  };
  draw();
  return () => typing(false);
};

export default defineWidgets([
  {
    id: 'todo-s', family: 'Reminders', group: 'todo', size: 'S',
    name: 'Reminders',
    desc: 'The number of reminders you still have open.',
    mount: reminders('S'),
  },
  {
    id: 'todo-m', family: 'Reminders', group: 'todo', size: 'M',
    name: 'Reminders',
    desc: 'Add reminders and tick them off right on your desktop.',
    mount: reminders('M'),
  },
  {
    id: 'todo-l', family: 'Reminders', group: 'todo', size: 'L',
    name: 'Reminders',
    desc: 'A longer reminders list, with room for more to-dos.',
    mount: reminders('L'),
  },
]);
