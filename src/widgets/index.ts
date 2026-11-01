import { SIZE_ORDER, type WidgetDef, type WidgetSize } from './_api';
import { customFamilyIcons } from './_familyIcon';

export * from './_api';
export { familyIcon } from './_familyIcon';
export { effectiveZones } from './clock';

const found = import.meta.glob<{ default: WidgetDef[] }>(['./*.ts', '!./index.ts', '!./_*.ts'], { eager: true });

export const WIDGETS: WidgetDef[] = Object.keys(found)
  .sort()
  .flatMap((k) => found[k].default ?? []);
for (const d of WIDGETS) if (d.icon) customFamilyIcons.set(d.family, d.icon);

export const FAMILIES: string[] = [];
const rebuildFamilies = () => FAMILIES.splice(0, FAMILIES.length, ...Array.from(new Set(WIDGETS.map((x) => x.family))).sort());
rebuildFamilies();

export function registerUserWidgets(defs: WidgetDef[]) {
  for (let i = WIDGETS.length - 1; i >= 0; i--) if (WIDGETS[i].id.startsWith('user:')) WIDGETS.splice(i, 1);
  WIDGETS.push(...defs);
  rebuildFamilies();
}

const missing = (id: string): WidgetDef => {
  const file = id.split(':').slice(1, -1).join(':');
  return {
    id, family: 'My Widgets', group: `user:${file}`, name: file, desc: 'This widget’s file was deleted or renamed, so it can’t be shown.', size: (id.split(':').pop() as WidgetSize) || 'S',
    mount: (root) => {
      const d = document.createElement('div');
      d.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:16px;font:500 12px/1.35 Inter,system-ui,sans-serif;color:rgba(255,255,255,.7)';
      d.textContent = `Widget file not found: ${file}`;
      root.appendChild(d);
      return () => d.remove();
    },
  };
};

export const SUGGESTED = ['clock', 'cal-day', 'wx-s', 'wx-m', 'battery', 'todo-m', 'notes-s', 'moon-s', 'cpu-s', 'clock-d-time'];

const LEGACY: Record<string, string> = {
  'sys-cpu': 'cpu-s', 'sys-mem': 'mem-s', 'sys-s': 'cpu-s', 'sys-m': 'cpu-s', 'sys-l': 'cpu-s', 'sys-xl': 'cpu-s', 'sys-xxl': 'cpu-s',
  'clock-digital': 'clock-d-time', 'clock-xl': 'clock', 'clock-d-xl': 'clock-d-time',
  'clock-d-s': 'clock-d-time', 'clock-d-m': 'clock-d-time', 'clock-l': 'clock',
  'cal-xl': 'cal-month-l', 'cal-month-xl': 'cal-month-l', 'cal-year': 'cal-month-l', 'cal-week': 'cal-date-m', 'cal-date-l': 'cal-month-l',
  'clock-world-m': 'world-m', 'clock-world-l': 'world-l', 'world-xl': 'world-l', 'wx-xl': 'wx-l', 'wx-feels': 'wx-s',
  'news-l': 'news-m', 'news-xl': 'news-m', 'music-l': 'music-m', 'music-recent-l': 'music-recent-m', 'music-top-l': 'music-top-m',
  'moon-l': 'moon-m', 'sun-l': 'sun-m', notes: 'notes-m', todo: 'todo-l',
};
export const widgetById = (id: string) =>
  WIDGETS.find((x) => x.id === (LEGACY[id] ?? id)) ?? (id.startsWith('user:') ? missing(id) : undefined);
export const sizesInGroup = (group: string) =>
  WIDGETS.filter((x) => x.group === group).sort((a, b) => SIZE_ORDER.indexOf(a.size) - SIZE_ORDER.indexOf(b.size));
