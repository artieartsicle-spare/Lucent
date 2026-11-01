import { defineWidgets } from './_api';

const hello = (root: HTMLElement) => {
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;inset:0;padding:16px;display:flex;align-items:flex-end;font:600 28px/1 Inter,system-ui,sans-serif';
  root.appendChild(el);
  const tick = () => (el.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  tick();
  const t = setInterval(tick, 1000);
  return () => {
    clearInterval(t);
    el.remove();
  };
};

export default defineWidgets([
  {
    id: 'hello-s',
    family: 'Hello',
    group: 'hello',
    size: 'S',
    name: 'Hello',
    desc: 'A minimal example widget.',
    mount: hello,
  },
]);
