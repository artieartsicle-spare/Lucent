import { registerUserWidgets, SIZE_ORDER, type CfgField, type WidgetCfg, type WidgetDef, type WidgetSize } from './widgets';

type FileInfo = { file: string; source: string };
type Api = {
  userWidgetsList?: () => Promise<FileInfo[]>;
  onUserWidgets?: (cb: (list: FileInfo[]) => void) => void;
  onSystem?: (cb: (s: unknown) => void) => void;
  getBatteries?: () => Promise<unknown>;
  setTyping?: (on: boolean) => void;
  copyText?: (t: string) => void;
};
const api = (): Api => ((window as unknown as { overlayAPI?: Api }).overlayAPI ?? {}) as Api;

const FIELDS: CfgField[] = ['place', 'unit', 'h24', 'zones'];
const VARS = ['--card', '--fg', '--sub', '--sub2', '--hair', '--red', '--blue', '--note-body', '--note-dot'];
const MAX_STORE = 64 * 1024;

function parse(f: FileInfo): WidgetDef[] {
  const doc = new DOMParser().parseFromString(f.source, 'text/html');
  const meta = (n: string) => doc.querySelector(`meta[name="widget-${n}"]`)?.getAttribute('content')?.trim() || '';
  const base = f.file.replace(/\.widget\.html$/i, '');
  const name = meta('name') || base.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const family = meta('family') || 'My Widgets';
  const desc = meta('description') || 'A custom widget.';
  const interactive = /^(true|yes|1)$/i.test(meta('interactive'));
  const fields = meta('fields').split(/[\s,]+/).filter((x): x is CfgField => (FIELDS as string[]).includes(x));
  let sizes = meta('size').split(/[\s,]+/).map((s) => s.toUpperCase()).filter((s): s is WidgetSize => (SIZE_ORDER as string[]).includes(s));
  if (!sizes.length) sizes = ['S'];
  return [...new Set(sizes)].map((size) => ({
    id: `user:${f.file}:${size}`,
    family,
    group: `user:${f.file}`,
    name,
    desc,
    size,
    fields: fields.length ? fields : undefined,
    mount: (root, cfg) => mountSandbox(f, size, interactive, root, cfg),
  }));
}

const SDK = `(function(){
var cbs={},ready=[],inited=false,pend={},nid=1;
function post(m){parent.postMessage(Object.assign({lg:1},m),'*');}
function call(t,p){return new Promise(function(res){var id=nid++;pend[id]=res;post(Object.assign({t:t,id:id},p));});}
function emit(ev,d){(cbs[ev]||[]).slice().forEach(function(f){try{f(d);}catch(e){console.error(e);}});}
function theme(m){var r=document.documentElement;for(var k in m.vars||{})r.style.setProperty(k,m.vars[k]);r.dataset.theme=m.dark?'dark':'light';g.dark=!!m.dark;}
var g=window.glass={size:'S',cfg:{},dark:false,system:null,width:innerWidth,height:innerHeight,
 on:function(ev,cb){(cbs[ev]=cbs[ev]||[]).push(cb);if(ev==='system'&&g.system)cb(g.system);return g;},
 ready:function(cb){inited?cb(g):ready.push(cb);},
 storage:{get:function(k,d){return call('store-get',{key:String(k)}).then(function(v){return v===undefined||v===null?d:v;});},
          set:function(k,v){post({t:'store-set',key:String(k),value:v});}},
 typing:function(on){post({t:'typing',on:!!on});},
 batteries:function(){return call('batteries');},
 copy:function(t){post({t:'copy',text:String(t)});}};
addEventListener('resize',function(){g.width=innerWidth;g.height=innerHeight;emit('resize',g);});
addEventListener('message',function(e){
 if(e.source!==parent)return;var m=e.data;if(!m||m.lg!==1)return;
 if(m.t==='init'){g.size=m.size;g.cfg=m.cfg||{};theme(m);inited=true;ready.splice(0).forEach(function(f){try{f(g);}catch(x){console.error(x);}});}
 else if(m.t==='theme'){theme(m);emit('theme',g);}
 else if(m.t==='system'){g.system=m.data;emit('system',m.data);}
 else if(m.t==='reply'&&pend[m.id]){pend[m.id](m.value);delete pend[m.id];}
});
post({t:'ready'});
})();`;

const BASE_CSS = `html,body{margin:0;height:100%;background:transparent;overflow:hidden;color-scheme:normal}
html{font:13px/1.3 Inter,"Segoe UI",system-ui,sans-serif;color:var(--fg,#fff);-webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none}
body{box-sizing:border-box;padding:16px}
input,textarea,button{font:inherit;color:inherit}input,textarea{user-select:text;-webkit-user-select:text}`;

const CSP = `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: https:; font-src data: https:; media-src data: https:; connect-src https:`;

function buildDoc(source: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><style>${BASE_CSS}</style><script>${SDK}</script><script>addEventListener('contextmenu',function(e){e.preventDefault()},true)</script></head><body>${source}</body></html>`;
}

type Inst = { win: Window; file: string; size: WidgetSize; cfg: WidgetCfg | undefined; root: HTMLElement; frame: HTMLIFrameElement };
const insts = new Map<Window, Inst>();
let lastSystem: unknown = null;
let wired = false;

function themeMsg(i: Inst) {
  const cs = getComputedStyle(i.root);
  const vars: Record<string, string> = {};
  for (const v of VARS) vars[v] = cs.getPropertyValue(v).trim();
  const st = i.root.parentElement?.dataset.wstyle;
  const dark = st === 'regular' ? true : st === 'light' ? false : document.documentElement.dataset.theme === 'dark';
  return { lg: 1, t: 'theme', vars, dark };
}

const storeKey = (file: string, key: string) => `lucent-uw:${file}:${key}`;

function wire() {
  if (wired) return;
  wired = true;
  window.addEventListener('message', async (e) => {
    const inst = e.source ? insts.get(e.source as Window) : undefined;
    const m = e.data;
    if (!inst || !m || m.lg !== 1) return;
    const reply = (value: unknown) => inst.win.postMessage({ lg: 1, t: 'reply', id: m.id, value }, '*');
    switch (m.t) {
      case 'ready':
        inst.win.postMessage({ ...themeMsg(inst), t: 'init', size: inst.size, cfg: inst.cfg ?? {} }, '*');
        if (lastSystem) inst.win.postMessage({ lg: 1, t: 'system', data: lastSystem }, '*');
        break;
      case 'store-get':
        try {
          const raw = localStorage.getItem(storeKey(inst.file, String(m.key)));
          reply(raw === null ? null : JSON.parse(raw));
        } catch {
          reply(null);
        }
        break;
      case 'store-set':
        try {
          const s = JSON.stringify(m.value);
          if (s !== undefined && s.length <= MAX_STORE) localStorage.setItem(storeKey(inst.file, String(m.key)), s);
        } catch {
        }
        break;
      case 'typing':
        api().setTyping?.(!!m.on);
        break;
      case 'batteries':
        reply(await api().getBatteries?.().catch(() => null));
        break;
      case 'copy':
        if (typeof m.text === 'string') api().copyText?.(m.text.slice(0, 10000));
        break;
    }
  });
  api().onSystem?.((s) => {
    lastSystem = s;
    for (const i of insts.values()) i.win.postMessage({ lg: 1, t: 'system', data: s }, '*');
  });
}

function mountSandbox(f: FileInfo, size: WidgetSize, interactive: boolean, root: HTMLElement, cfg?: WidgetCfg): () => void {
  wire();
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent';
  if (interactive) frame.className = 'ix';
  frame.srcdoc = buildDoc(f.source);
  root.appendChild(frame);
  const win = frame.contentWindow!;
  const inst: Inst = { win, file: f.file, size, cfg, root, frame };
  insts.set(win, inst);

  const push = () => win.postMessage(themeMsg(inst), '*');
  const mo = new MutationObserver(push);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const host = root.parentElement;
  if (host) mo.observe(host, { attributes: true, attributeFilter: ['data-wstyle'] });

  return () => {
    mo.disconnect();
    insts.delete(win);
    frame.remove();
  };
}

const listeners: Array<() => void> = [];
export const onUserWidgetsChanged = (cb: () => void) => void listeners.push(cb);

function apply(list: FileInfo[]) {
  const defs: WidgetDef[] = [];
  for (const f of list) {
    try {
      defs.push(...parse(f));
    } catch (e) {
      console.warn('[user-widgets] could not read', f.file, e);
    }
  }
  registerUserWidgets(defs);
}

export async function loadUserWidgets(): Promise<void> {
  const a = api();
  if (!a.userWidgetsList) return;
  try {
    const list = await Promise.race([a.userWidgetsList(), new Promise<FileInfo[]>((r) => setTimeout(() => r([]), 2000))]);
    apply(list);
  } catch (e) {
    console.warn('[user-widgets] list failed', e);
  }
  a.onUserWidgets?.((list) => {
    apply(list);
    listeners.forEach((cb) => cb());
  });
}
