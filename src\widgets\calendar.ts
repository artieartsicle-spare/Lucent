import { defineWidgets } from './_api';
import './_cardStyles';
import { $ } from './_cardShared';

const every = (fn: () => void, ms: number) => {
  fn();
  const t = setInterval(fn, ms);
  return () => clearInterval(t);
};

const HEADS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const upper = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString('en-US', o).toUpperCase();
function monthGrid(d: Date, cell: number, fs: number, dimWeekends: boolean) {
  const y = d.getFullYear();
  const m = d.getMonth();
  const lead = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const we = (col: number) => (dimWeekends && (col === 0 || col === 6) ? ' we' : '');
  let h = '';
  for (let i = 0; i < 7; i++) h += `<span class="h${we(i)}">${HEADS[i]}</span>`;
  for (let i = 0; i < lead; i++) h += '<span></span>';
  for (let n = 1; n <= days; n++) {
    const col = (lead + n - 1) % 7;
    h += `<span class="${(we(col) + (n === d.getDate() ? ' td' : '')).trim()}"><b>${n}</b></span>`;
  }
  return `<div class="cn-grid" style="--cell:${cell}px;--fs:${fs}px">${h}</div>`;
}
const noEvents = 'No Events Today';
export const calDay = (root: HTMLElement) =>
  every(() => {
    const d = new Date();
    root.innerHTML = $(`<div class="wc card cn-day"><div><div class="cn-dow">${upper(d, { weekday: 'long' })}</div><div class="cn-num">${d.getDate()}</div></div>
      <div class="cn-none">${noEvents}</div></div>`);
  }, 60000);
export const calMonth = (root: HTMLElement) =>
  every(() => {
    const d = new Date();
    root.innerHTML = $(`<div class="wc card" style="padding:14px 14px 10px"><div class="cn-dow" style="font-size:12px;margin-bottom:5px">${upper(d, { month: 'long' })}</div>${monthGrid(d, 16.4, 10.5, false)}</div>`);
  }, 60000);
export const calDateMonth = (root: HTMLElement) =>
  every(() => {
    const d = new Date();
    root.innerHTML = $(`<div class="wc card" style="padding:14px 16px;display:flex;gap:22px">
      <div class="cn-day" style="width:116px;flex:none"><div><div class="cn-dow">${upper(d, { weekday: 'long' })}</div><div class="cn-num">${d.getDate()}</div></div><div class="cn-none">${noEvents}</div></div>
      <div style="flex:1;min-width:0"><div class="cn-dow" style="margin-bottom:4px">${upper(d, { month: 'long' })}</div>${monthGrid(d, 16, 11, true)}</div></div>`);
  }, 60000);
export const calMonthL = (root: HTMLElement) =>
  every(() => {
    const d = new Date();
    root.innerHTML = $(`<div class="wc card" style="padding:16px 18px 14px;display:flex;flex-direction:column">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px"><div class="cn-dow" style="font-size:15px">${upper(d, { month: 'long' })}</div><div style="font:600 15px/1 Inter;color:var(--sub)">${d.getFullYear()}</div></div>
      ${monthGrid(d, 37, 15, true)}<div class="cn-none" style="margin-top:auto">${noEvents}</div></div>`);
  }, 60000);

export default defineWidgets([
  {
    id: 'cal-day', family: 'Calendar', group: 'cal-date', size: 'S',
    name: 'Calendar',
    desc: 'Today’s date, big and easy to read.',
    mount: calDay,
  },
  {
    id: 'cal-date-m', family: 'Calendar', group: 'cal-date', size: 'M',
    name: 'Calendar',
    desc: 'Today’s date next to a small calendar of the month.',
    mount: calDateMonth,
  },
  {
    id: 'cal-month-l', family: 'Calendar', group: 'cal-date', size: 'L',
    name: 'Calendar',
    desc: 'A full-size calendar of the current month.',
    mount: calMonthL,
  },
  {
    id: 'cal-month', family: 'Calendar', group: 'cal-month', size: 'S',
    name: 'Calendar',
    desc: 'A compact calendar of the current month.',
    mount: calMonth,
  },
]);
