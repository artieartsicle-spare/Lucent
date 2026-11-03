import { effectiveZones, type WidgetCfg, type WidgetDef, type Place } from './widgets';
import { SPORTS, FOLDERS, CUSTOM, sportOf, folderOf } from './widgets/_choices';
import { searchSymbols, symbolsOf, coinsOf, newsPlan, NEWS_TOPICS, NEWS_EVERY, NEWS_REGIONS } from './widgets/_stocks';

export type ConfigHost = {
  def: WidgetDef;
  cfg: WidgetCfg;
  style: string;
  styles: { id: string; name: string }[];
  onCfg: (cfg: WidgetCfg) => void;
  onStyle: (id: string) => void;
};

type View =
  | { kind: 'main' }
  | { kind: 'search'; title: string; here: boolean; pick: (p: Place | null) => void }
  | { kind: 'ticker'; index: number }
  | { kind: 'list'; spec: () => ListSpec; st?: string; drawn?: boolean };

type ListSpec = {
  title: string;
  rows: ({ sec: string } | { id: string; label: string })[];
  cur: string;
  apply: (k: string) => void;
  foot?: string;
  extra?: { html: string; run: () => void | Promise<void> };
};

const SLIDES: [number, string][] = [[5, '5 seconds'], [10, '10 seconds'], [20, '20 seconds'], [30, '30 seconds'], [60, '1 minute'], [300, '5 minutes']];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

async function geocode(q: string): Promise<Place[]> {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=7&language=en&format=json`);
  const j = await r.json();
  return (j.results ?? []).map((x: any) => ({
    name: x.name as string,
    region: [x.admin1, x.country].filter(Boolean).join(', '),
    lat: x.latitude as number,
    lon: x.longitude as number,
    tz: x.timezone as string | undefined,
    cc: x.country_code as string | undefined,
  }));
}

export function createConfigPanel(ui: HTMLElement, typing: (on: boolean) => void) {
  const css = document.createElement('style');
  css.textContent = `
#wcfg{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%) scale(.97);width:360px;max-height:min(640px,88vh);overflow-y:auto;box-sizing:border-box;padding:18px 18px 14px;border-radius:22px;z-index:70;
  background:var(--fp-bg);color:var(--fp-fg);font:13.5px/1.3 "Inter",system-ui,sans-serif;box-shadow:0 0 0 .5px var(--fp-ring),var(--fp-sh);
  opacity:0;pointer-events:none;transition:opacity .14s,transform .14s;-webkit-font-smoothing:antialiased;user-select:none}
#wcfg.show{opacity:1;pointer-events:auto;transform:translate(-50%,-50%) scale(1)}
#wcfg .w-h{display:flex;flex-direction:column;gap:3px;padding:0 4px}
#wcfg .w-h.back{flex-direction:row;align-items:center;gap:6px;padding:0}
#wcfg .w-t{font-weight:700;font-size:18px;letter-spacing:-.01em}
#wcfg .w-f{color:var(--fp-sub);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.07em}
#wcfg .bk{border:0;background:rgba(120,120,128,.2);color:var(--fp-fg);width:28px;height:28px;border-radius:50%;font:600 17px/1 "Inter",system-ui,sans-serif;cursor:default;display:grid;place-items:center;padding:0 0 2px}
#wcfg .bk:hover{background:rgba(120,120,128,.32)}
#wcfg .w-d{color:var(--fp-sub);margin:8px 4px 14px;font-size:13px}
#wcfg .w-g{background:var(--fp-card);border-radius:14px;overflow:hidden;margin-top:10px}
#wcfg .w-g.pick{max-height:min(380px,52vh);overflow-y:auto}
#wcfg .w-sec{padding:12px 14px 5px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--fp-sub)}
#wcfg .ck{display:inline-block;width:18px;color:#0a7cff;font-weight:700}
#wcfg .w-r{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 14px;min-height:44px}
#wcfg .w-r+.w-r{border-top:.5px solid var(--fp-line)}
#wcfg .w-r .l{color:var(--fp-fg)}
#wcfg .w-r .v{color:#0a7cff;display:flex;align-items:center;gap:6px;cursor:default;min-width:0;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#wcfg .w-r .v.mute{color:var(--fp-sub)}
#wcfg .w-gh{margin:18px 4px -4px;font-size:12px;color:var(--fp-sub);text-transform:uppercase;letter-spacing:.04em}
#wcfg .seg{display:flex;border-radius:8px;overflow:hidden;background:var(--fp-seg);padding:2px;gap:2px}
#wcfg .seg button{flex:1;border:0;border-radius:6px;padding:5px 0;background:transparent;font:500 12.5px "Inter",system-ui,sans-serif;color:var(--fp-fg);cursor:default}
#wcfg .seg button.on{background:var(--fp-segon);box-shadow:0 1px 3px rgba(0,0,0,.18)}
#wcfg .tg{width:42px;height:25px;border-radius:13px;background:rgba(120,120,128,.32);position:relative;transition:background .15s;flex:none}
#wcfg .tg::after{content:"";position:absolute;left:2px;top:2px;width:21px;height:21px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:left .15s}
#wcfg .tg.on{background:#30d158}
#wcfg .tg.on::after{left:19px}
#wcfg .w-b{display:flex;justify-content:flex-end;margin-top:14px}
#wcfg button.pri{font:600 13px "Inter",system-ui,sans-serif;padding:6px 18px;border-radius:8px;border:0;background:#0a7cff;color:#fff;cursor:default}
#wcfg input.q{width:100%;box-sizing:border-box;font:14px "Inter",system-ui,sans-serif;padding:8px 12px;border-radius:10px;border:0;outline:2px solid #0a7cff;background:var(--fp-card);color:var(--fp-fg);user-select:text;-webkit-user-select:text}
#wcfg .res{padding:11px 14px 11px 22px;cursor:default}
#wcfg .res:hover,#wcfg .res.on{background:var(--fp-sel,rgba(0,0,0,.08))}
#wcfg .res small{display:block;color:var(--fp-sub);margin-top:2px}
#wcfg input.w-in{flex:1;min-width:0;max-width:200px;box-sizing:border-box;text-align:right;border:0;outline:0;background:transparent;color:#0a7cff;font:inherit;padding:0;user-select:text;-webkit-user-select:text;cursor:text}
#wcfg input.w-in::placeholder{color:var(--fp-sub)}
#wcfg .none{padding:12px 14px;color:var(--fp-sub)}
#wcfg ::-webkit-scrollbar{width:11px;height:11px}
#wcfg ::-webkit-scrollbar-track{background:transparent;margin:8px 0}
#wcfg ::-webkit-scrollbar-thumb{background:rgba(120,120,128,.5);border-radius:8px;border:3px solid transparent;background-clip:padding-box}
#wcfg ::-webkit-scrollbar-thumb:hover{background:rgba(120,120,128,.75);background-clip:padding-box}
#wcfg .w-btns{display:flex;gap:10px;margin-top:14px}
#wcfg .gb,#wca .gb{flex:1;height:36px;border:0;border-radius:18px;background:var(--fp-cancel);color:var(--fp-fg);font:600 14px \"Inter\",system-ui,sans-serif;cursor:default}
#wcfg .gb:hover,#wca .gb:hover{filter:brightness(.96)}
#wcfg .gb.ok{background:#0a84ff;color:#fff}
#wca .gb.red{color:#ff453a}
#wca .gb.strong{font-weight:700}
#wcfg .bk{display:grid;place-items:center;width:32px;height:32px;padding:0;border-radius:50%;background:var(--fp-bk);box-shadow:0 1px 5px rgba(0,0,0,.16),inset 0 0 0 .5px rgba(255,255,255,.5)}
#wcfg,#wca .al{--fp-card:rgba(118,118,128,.16);--fp-sel:rgba(0,0,0,.09);--fp-cancel:rgba(118,118,128,.22);--fp-seg:rgba(118,118,128,.18);--fp-segon:rgba(255,255,255,.92);--fp-line:rgba(0,0,0,.1);--fp-bk:rgba(255,255,255,.8);
  --gl-tint:linear-gradient(rgba(255,255,255,.6),rgba(255,255,255,.46));--gl-base:#dcdce2;--gl-hi:rgba(255,255,255,.95);--gl-ring:rgba(255,255,255,.6);--gl-lo:rgba(255,255,255,.6)}
html[data-theme="dark"] #wcfg,html[data-theme="dark"] #wca .al{--fp-card:rgba(255,255,255,.09);--fp-sel:rgba(255,255,255,.15);--fp-cancel:rgba(255,255,255,.15);--fp-seg:rgba(255,255,255,.1);--fp-segon:rgba(255,255,255,.22);--fp-line:rgba(255,255,255,.12);--fp-bk:rgba(255,255,255,.16);
  --gl-tint:linear-gradient(rgba(44,44,52,.5),rgba(30,30,38,.58));--gl-base:#26262c;--gl-hi:rgba(255,255,255,.32);--gl-ring:rgba(255,255,255,.14);--gl-lo:rgba(255,255,255,.1)}
#wcfg,#wca .al{background:var(--gl-tint),var(--gwp,none) var(--cpx,0px) var(--cpy,0px)/100vw 100vh no-repeat,var(--gl-base);
  box-shadow:inset 0 0 0 1px var(--gl-ring),inset 0 1px 0 var(--gl-hi),inset 0 -12px 24px -16px var(--gl-lo),0 28px 70px rgba(0,0,0,.34),0 3px 12px rgba(0,0,0,.14)}
#wca{position:fixed;inset:0;z-index:75;display:none;place-items:center;font:13.5px/1.3 \"Inter\",system-ui,sans-serif;-webkit-font-smoothing:antialiased;user-select:none;color:var(--fp-fg)}
#wca.show{display:grid}
#wca .al{pointer-events:auto}
#wca .al{width:272px;box-sizing:border-box;padding:18px 16px 14px;border-radius:28px;color:var(--fp-fg)}
#wca .al-t{font:600 17px/1.25 \"Inter\",system-ui,sans-serif;padding:0 4px 14px}
#wca .gb{display:block;width:100%;margin-top:8px;height:40px;border-radius:20px}
`;
  document.head.appendChild(css);
  const el = document.createElement('div');
  el.id = 'wcfg';
  ui.appendChild(el);

  let host: ConfigHost | null = null;
  let view: View = { kind: 'main' };
  let searchSeq = 0;

  const commit = (cfg: WidgetCfg) => {
    if (!host) return;
    host.cfg = cfg;
    host.onCfg(cfg);
  };

  function openSearch(title: string, here: boolean, pick: (p: Place | null) => void) {
    view = { kind: 'search', title, here, pick };
    render();
  }

  function renderSearch(v: Extract<View, { kind: 'search' }>) {
    el.innerHTML = `<div class="w-h"><div class="w-t">${esc(v.title)}</div></div>
      <div style="margin-top:12px"><input class="q" placeholder="Search for a city" spellcheck="false"></div>
      <div class="w-g" id="wres" style="display:${v.here ? 'block' : 'none'}">${v.here ? '<div class="res" data-here="1">My Location<small>Use this PC’s location</small></div>' : ''}</div>
      <div class="w-b"><button class="pri" data-x="back" style="background:var(--fp-cancel);color:var(--fp-fg)">Cancel</button></div>`;
    const input = el.querySelector('input.q') as HTMLInputElement;
    const res = el.querySelector('#wres') as HTMLElement;
    let timer = 0;
    let list: Place[] = [];
    const paint = (msg?: string) => {
      const head = v.here ? '<div class="res" data-here="1">My Location<small>Use this PC’s location</small></div>' : '';
      res.style.display = 'block';
      res.innerHTML =
        head +
        (msg
          ? `<div class="none">${esc(msg)}</div>`
          : list.map((p, i) => `<div class="res" data-i="${i}">${esc(p.name)}<small>${esc(p.region ?? '')}</small></div>`).join(''));
    };
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) {
        list = [];
        res.style.display = v.here ? 'block' : 'none';
        res.innerHTML = v.here ? '<div class="res" data-here="1">My Location<small>Use this PC’s location</small></div>' : '';
        return;
      }
      timer = window.setTimeout(async () => {
        const seq = ++searchSeq;
        try {
          const r = await geocode(q);
          if (seq !== searchSeq) return;
          list = r;
          paint(r.length ? undefined : 'No results');
        } catch {
          if (seq === searchSeq) paint('Search needs an internet connection');
        }
      }, 250);
    });
    res.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('.res') as HTMLElement | null;
      if (!t) return;
      if (t.dataset.here) v.pick(null);
      else v.pick(list[Number(t.dataset.i)]);
      view = { kind: 'main' };
      typing(false);
      render();
    });
    el.querySelector('[data-x=back]')!.addEventListener('click', () => {
      view = { kind: 'main' };
      typing(false);
      render();
    });
    typing(true);
    setTimeout(() => input.focus(), 80);
  }

  function renderTicker(v: Extract<View, { kind: 'ticker' }>) {
    const coin = host?.def.family === 'Money';
    el.innerHTML = `<div class="w-h"><div class="w-t">${coin ? 'Coin' : 'Stock'} ${v.index + 1}</div></div>
      <div style="margin-top:12px"><input class="q" placeholder="${coin ? 'Search a coin, e.g. Bitcoin' : 'Search a company or ticker'}" spellcheck="false" autocapitalize="off"></div>
      <div class="w-g" id="wres" style="display:none"></div>
      <div class="w-b"><button class="pri" data-x="back" style="background:var(--fp-cancel);color:var(--fp-fg)">Cancel</button></div>`;
    const input = el.querySelector('input.q') as HTMLInputElement;
    const res = el.querySelector('#wres') as HTMLElement;
    let timer = 0;
    let list: { sym: string; name: string; exch: string }[] = [];
    const paint = (msg?: string) => {
      res.style.display = 'block';
      res.innerHTML = msg
        ? `<div class="none">${esc(msg)}</div>`
        : list.map((p, i) => `<div class="res" data-i="${i}"><b>${esc(p.sym)}</b> ${esc(p.name)}<small>${esc(p.exch)}</small></div>`).join('');
    };
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 1) {
        res.style.display = 'none';
        return;
      }
      timer = window.setTimeout(async () => {
        const seq = ++searchSeq;
        try {
          const r = await searchSymbols(q, coin ? 'crypto' : undefined);
          if (seq !== searchSeq) return;
          list = r;
          paint(r.length ? undefined : 'No results');
        } catch {
          if (seq === searchSeq) paint('Search needs an internet connection');
        }
      }, 250);
    });
    res.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('.res') as HTMLElement | null;
      if (!t || !host) return;
      const slots = Math.max(host.def.slots ?? 1, v.index + 1);
      const syms = (coin ? coinsOf : symbolsOf)(host.cfg, slots);
      syms[v.index] = list[Number(t.dataset.i)].sym;
      commit({ ...host.cfg, symbols: syms });
      view = { kind: 'main' };
      typing(false);
      render();
    });
    el.querySelector('[data-x=back]')!.addEventListener('click', () => {
      view = { kind: 'main' };
      typing(false);
      render();
    });
    typing(true);
    setTimeout(() => input.focus(), 80);
  }

  const ARROW = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 5l-7 7 7 7"/></svg>';

  function openList(spec: () => ListSpec) {
    view = { kind: 'list', spec };
    render();
  }
  const toMain = () => {
    view = { kind: 'main' };
    typing(false);
    render();
  };

  function renderList(v: Extract<View, { kind: 'list' }>) {
    if (!host) return;
    const sp = v.spec();
    const cur = v.st ?? sp.cur;
    const rows = sp.rows
      .map((r) => ('sec' in r ? `<div class="w-sec">${esc(r.sec)}</div>` : `<div class="res${r.id === cur ? ' on' : ''}" data-k="${esc(r.id)}">${esc(r.label)}</div>`))
      .join('');
    el.innerHTML = `<div class="w-h back"><button class="bk" data-x="back" aria-label="Back">${ARROW}</button><div class="w-t">${esc(sp.title)}</div></div>
      <div class="w-g pick">${rows}${sp.extra?.html ?? ''}</div>
      ${sp.foot ? `<div class="w-d" style="margin:10px 4px 0;font-size:12px">${sp.foot}</div>` : ''}
      <div class="w-btns"><button class="gb" data-x="cancel">Cancel</button><button class="gb ok" data-x="ok">OK</button></div>`;
    const list = el.querySelector<HTMLElement>('.w-g.pick')!;
    if (!v.drawn) {
      v.drawn = true;
      el.querySelector<HTMLElement>('.res.on')?.scrollIntoView({ block: 'center' });
    }
    list.querySelectorAll<HTMLElement>('.res[data-k]').forEach((n) =>
      n.addEventListener('click', () => {
        v.st = n.dataset.k!;
        list.querySelectorAll('.res.on').forEach((x) => x.classList.remove('on'));
        n.classList.add('on');
      })
    );
    list.querySelector<HTMLElement>('[data-extra]')?.addEventListener('click', async () => {
      await sp.extra?.run();
      v.st = undefined;
      renderList(v);
    });
    el.querySelector('[data-x=back]')!.addEventListener('click', () => listBack(v));
    el.querySelector('[data-x=cancel]')!.addEventListener('click', toMain);
    el.querySelector('[data-x=ok]')!.addEventListener('click', () => {
      if (v.st !== undefined && v.st !== sp.cur) sp.apply(v.st);
      toMain();
    });
  }
  function listBack(v: Extract<View, { kind: 'list' }>) {
    const sp = v.spec();
    if (v.st === undefined || v.st === sp.cur) return toMain();
    showAlert('Would you like to save changes?', [
      { label: 'Discard', red: true, run: toMain },
      {
        label: 'OK',
        run: () => {
          sp.apply(v.st!);
          toMain();
        },
      },
    ]);
  }

  const topicSpec = (): ListSpec => {
    const rows: ListSpec['rows'] = [{ sec: 'Google News' }];
    NEWS_TOPICS.forEach((x, i) => {
      if (x.id.startsWith('g-') && !NEWS_TOPICS[i - 1].id.startsWith('g-')) rows.push({ sec: 'By genre · publisher feeds with pictures' });
      rows.push({ id: x.id, label: x.label });
    });
    const personal = host ? newsPlan(host.cfg.news).personal : false;
    return {
      title: 'Topic',
      rows,
      cur: host?.cfg.news?.topic ?? 'top',
      apply: (k) => host && commit({ ...host.cfg, news: { ...host.cfg.news, topic: k } }),
      foot: personal ? 'You have interests or a city set, so they come first; a topic you pick here is added to them.' : 'Or type your own interests on the previous screen.',
    };
  };

  const choiceSpec = (field: 'sport' | 'folder'): ListSpec => {
    const fam = host?.def.family === 'Photos' ? 'Photos' : 'Files';
    const picked = host && field === 'folder' && host.cfg.folder?.startsWith(CUSTOM) ? [folderOf(fam, host.cfg.folder)] : [];
    const opts = field === 'sport' ? SPORTS.map((x) => ({ id: x.id, label: x.label })) : [...picked, ...FOLDERS[fam]];
    return {
      title: field === 'sport' ? 'League' : fam === 'Photos' ? 'Album' : 'Folder',
      rows: opts.map((x) => ({ id: x.id, label: x.label })),
      cur: host ? (field === 'sport' ? sportOf(host.cfg.sport).id : folderOf(fam, host.cfg.folder).id) : '',
      apply: (k) => host && commit({ ...host.cfg, [field]: k }),
      extra:
        field === 'folder' && fam === 'Photos'
          ? {
              html: '<div class="res" data-extra="1" style="color:#0a84ff">Choose another folder…</div>',
              run: async () => {
                const api = (window as unknown as { overlayAPI?: { pickFolder?: () => Promise<string | null> } }).overlayAPI;
                const dir = await api?.pickFolder?.().catch(() => null);
                if (dir && host) commit({ ...host.cfg, folder: CUSTOM + dir });
              },
            }
          : undefined,
    };
  };

  const al = document.createElement('div');
  al.id = 'wca';
  ui.appendChild(al);
  function showAlert(text: string, btns: { label: string; red?: boolean; run: () => void }[]) {
    al.innerHTML = `<div class="al"><div class="al-t">${esc(text)}</div>${btns.map((b, i) => `<button class="gb${b.red ? ' red' : ''}${i === btns.length - 1 ? ' strong' : ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>`;
    al.classList.add('show');
    align();
    al.querySelectorAll<HTMLElement>('[data-i]').forEach((n) =>
      n.addEventListener('click', () => {
        hideAlert();
        btns[Number(n.dataset.i)].run();
      })
    );
  }
  const hideAlert = () => al.classList.remove('show');

  function align() {
    const set = (c: HTMLElement) => {
      c.style.setProperty('--cpx', `${-Math.round((window.innerWidth - c.offsetWidth) / 2)}px`);
      c.style.setProperty('--cpy', `${-Math.round((window.innerHeight - c.offsetHeight) / 2)}px`);
    };
    set(el);
    const card = al.querySelector<HTMLElement>('.al');
    if (card) set(card);
  }
  new ResizeObserver(align).observe(el);
  window.addEventListener('resize', align);

  function render() {
    if (!host) return;
    if (view.kind === 'search') return renderSearch(view);
    if (view.kind === 'ticker') return renderTicker(view);
    if (view.kind === 'list') return renderList(view);
    const { def, cfg } = host;
    const fields = def.fields ?? [];
    const clock = def.family === 'Clock';
    let h = `<div class="w-h"><div class="w-t">${esc(def.name)}</div>${def.family && def.family !== def.name ? `<div class="w-f">${esc(def.family)}</div>` : ''}</div>
      <div class="w-d">${esc(def.desc)}</div>`;

    let g = '';
    if (fields.includes('place')) {
      g += `<div class="w-r" data-a="place"><span class="l">${clock ? 'City' : 'Location'}</span><span class="v ${cfg.place ? '' : 'mute'}">${cfg.place ? esc(cfg.place.name) : clock ? 'My Time Zone' : 'My Location'} ›</span></div>`;
    }
    if (fields.includes('zones')) {
      effectiveZones(def.slots ?? 3, cfg).forEach((z, i) => {
        g += `<div class="w-r" data-a="zone" data-i="${i}"><span class="l">City ${i + 1}</span><span class="v">${esc(z.name)} ›</span></div>`;
      });
    }
    if (fields.includes('symbols')) {
      const coin = def.family === 'Money';
      (coin ? coinsOf : symbolsOf)(cfg, def.slots ?? 1).forEach((sym, i) => {
        g += `<div class="w-r" data-a="ticker" data-i="${i}"><span class="l">${coin ? 'Coin' : 'Stock'} ${i + 1}</span><span class="v">${esc(sym)} ›</span></div>`;
      });
    }
    if (fields.includes('news')) {
      const n = cfg.news ?? {};
      const every = newsPlan(n).every;
      const tname = NEWS_TOPICS.find((x) => x.id === (n.topic ?? 'top'))?.label ?? 'Top Stories';
      g += `<div class="w-r" data-a="topic"><span class="l">Topic</span><span class="v">${esc(tname)} ›</span></div>`;
      g += `<div class="w-r"><span class="l">Interests</span><input class="w-in" data-in="query" value="${esc(n.query ?? '')}" placeholder="e.g. Tesla, Lakers, Rust" spellcheck="false"></div>`;
      g += `<div class="w-r"><span class="l">Local news</span><input class="w-in" data-in="local" value="${esc(n.local ?? '')}" placeholder="Your city, e.g. Austin, TX" spellcheck="false"></div>`;
      g += `<div class="w-r" data-a="pick-region"><span class="l">Region</span><span class="v">${esc(NEWS_REGIONS.find(([k]) => k === (n.region ?? 'auto'))?.[1] ?? 'Auto')} ›</span></div>`;
      g += `<div class="w-r"><span class="l">Publisher</span><input class="w-in" data-in="publisher" value="${esc(n.publisher ?? '')}" placeholder="Any" spellcheck="false"></div>`;
      g += `<div class="w-r"><span class="l">RSS feeds</span><input class="w-in" data-in="feeds" value="${esc(n.feeds ?? '')}" placeholder="Optional · https://…" spellcheck="false"></div>`;
      g += `<div class="w-r" data-a="pick-every"><span class="l">Update every</span><span class="v">${esc(NEWS_EVERY.find(([m]) => m === every)?.[1] ?? `${every} min`)} ›</span></div>`;
    }
    if (fields.includes('currency')) {
      const f = cfg.fx ?? {};
      g += `<div class="w-r"><span class="l">Amount</span><input class="w-in" data-grp="fx" data-in="amount" value="${f.amount ?? 1}" placeholder="1" spellcheck="false"></div>`;
      g += `<div class="w-r"><span class="l">From</span><input class="w-in" data-grp="fx" data-in="from" value="${esc(f.from ?? 'USD')}" placeholder="USD" spellcheck="false"></div>`;
      g += `<div class="w-r"><span class="l">To</span><input class="w-in" data-grp="fx" data-in="to" value="${esc(f.to ?? 'EUR, GBP, JPY')}" placeholder="EUR, GBP, JPY" spellcheck="false"></div>`;
    }
    if (fields.includes('sport')) {
      g += `<div class="w-r" data-a="choice" data-f="sport"><span class="l">League</span><span class="v">${esc(sportOf(cfg.sport).label)} ›</span></div>`;
    }
    if (fields.includes('folder')) {
      const fam = def.family === 'Photos' ? 'Photos' : 'Files';
      g += `<div class="w-r" data-a="choice" data-f="folder"><span class="l">${fam === 'Photos' ? 'Album' : 'Folder'}</span><span class="v">${esc(folderOf(fam, cfg.folder).label)} ›</span></div>`;
    }
    if (fields.includes('slide')) {
      const s = cfg.slide ?? 20;
      g += `<div class="w-r" data-a="pick-slide"><span class="l">Change every</span><span class="v">${esc(SLIDES.find(([k]) => k === s)?.[1] ?? `${s}s`)} ›</span></div>`;
    }
    if (fields.includes('unit')) {
      const u = cfg.unit ?? 'auto';
      g += `<div class="w-r"><span class="l">Units</span><div class="seg" style="width:190px">${[['auto', 'Auto'], ['F', '°F'], ['C', '°C']]
        .map(([k, l]) => `<button data-a="unit" data-k="${k}" class="${u === k ? 'on' : ''}">${l}</button>`)
        .join('')}</div></div>`;
    }
    if (fields.includes('h24')) {
      g += `<div class="w-r" data-a="h24"><span class="l">24-Hour Time</span><span class="tg ${cfg.h24 ? 'on' : ''}"></span></div>`;
    }
    if (g) h += `<div class="w-g">${g}</div>`;
    if (fields.includes('news')) h += `<div class="w-d" style="margin:8px 4px 0;font-size:12px">News comes from Google News. Type the things you follow, separated by commas (people, teams, companies, hobbies), and add your city for local headlines. RSS feeds, if you paste any, replace all of this.</div>`;
    if (fields.includes('currency')) h += `<div class="w-d" style="margin:8px 4px 0;font-size:12px">Use currency codes such as USD, EUR, GBP, JPY. Small widgets show the first one in To.</div>`;

    const styleName = host.styles.find((x) => x.id === host!.style)?.name ?? '';
    h += `<div class="w-gh">Appearance</div><div class="w-g"><div class="w-r" data-a="pick-style"><span class="l">Style</span><span class="v">${esc(styleName)} ›</span></div></div>`;
    h += `<div class="w-b"><button class="pri" data-a="done">Done</button></div>`;
    el.innerHTML = h;

    el.querySelectorAll<HTMLElement>('[data-a]').forEach((n) => {
      const a = n.dataset.a!;
      n.addEventListener('click', () => {
        if (!host) return;
        if (a === 'done') return close();
        if (a === 'place') {
          openSearch(clock ? 'City' : 'Location', true, (p) => commit({ ...host!.cfg, place: p ?? undefined }));
        } else if (a === 'zone') {
          const i = Number(n.dataset.i);
          openSearch(`City ${i + 1}`, false, (p) => {
            if (!p?.tz) return;
            const zs = effectiveZones(host!.def.slots ?? 3, host!.cfg).map((z) => ({ ...z }));
            zs[i] = { name: p.name, tz: p.tz };
            commit({ ...host!.cfg, zones: zs });
          });
        } else if (a === 'ticker') {
          view = { kind: 'ticker', index: Number(n.dataset.i) };
          render();
        } else if (a === 'topic') {
          openList(topicSpec);
        } else if (a === 'choice') {
          openList(() => choiceSpec(n.dataset.f as 'sport' | 'folder'));
        } else if (a === 'pick-region') {
          openList(() => ({ title: 'Region', rows: NEWS_REGIONS.map(([id, label]) => ({ id, label })), cur: host?.cfg.news?.region ?? 'auto', apply: (k) => host && commit({ ...host.cfg, news: { ...host.cfg.news, region: k } }) }));
        } else if (a === 'pick-every') {
          openList(() => ({ title: 'Update every', rows: NEWS_EVERY.map(([m, label]) => ({ id: String(m), label })), cur: host ? String(newsPlan(host.cfg.news).every) : '', apply: (k) => host && commit({ ...host.cfg, news: { ...host.cfg.news, every: Number(k) } }) }));
        } else if (a === 'pick-slide') {
          openList(() => ({ title: 'Change every', rows: SLIDES.map(([k, label]) => ({ id: String(k), label })), cur: String(host?.cfg.slide ?? 20), apply: (k) => host && commit({ ...host.cfg, slide: Number(k) }) }));
        } else if (a === 'pick-style') {
          openList(() => ({ title: 'Appearance', rows: (host?.styles ?? []).map((x) => ({ id: x.id, label: x.name })), cur: host?.style ?? '', apply: (k) => { if (host) { host.style = k; host.onStyle(k); } } }));
        } else if (a === 'region') {
          commit({ ...host.cfg, news: { ...host.cfg.news, region: n.dataset.k } });
          render();
        } else if (a === 'every') {
          commit({ ...host.cfg, news: { ...host.cfg.news, every: Number(n.dataset.k) } });
          render();
        } else if (a === 'slide') {
          commit({ ...host.cfg, slide: Number(n.dataset.k) });
          render();
        } else if (a === 'unit') {
          commit({ ...host.cfg, unit: n.dataset.k as WidgetCfg['unit'] });
          render();
        } else if (a === 'h24') {
          commit({ ...host.cfg, h24: !host.cfg.h24 });
          render();
        } else if (a === 'style') {
          host.style = n.dataset.k!;
          host.onStyle(host.style);
          render();
        }
      });
    });
    el.querySelectorAll<HTMLInputElement>('input[data-in]').forEach((inp) => {
      inp.addEventListener('focus', () => typing(true));
      inp.addEventListener('keydown', (e) => e.key === 'Enter' && inp.blur());
      inp.addEventListener('blur', () => typing(false));
      inp.addEventListener('change', () => {
        if (!host) return;
        if (inp.dataset.grp === 'fx') {
          const fx = { ...host.cfg.fx };
          const k = inp.dataset.in as 'amount' | 'from' | 'to';
          if (k === 'amount') fx.amount = Math.max(0, Number(inp.value.replace(/,/g, ''))) || undefined;
          else fx[k] = inp.value.toUpperCase().replace(/[^A-Z, ]/g, '').trim();
          commit({ ...host.cfg, fx });
        } else {
          const k = inp.dataset.in as 'query' | 'local' | 'publisher' | 'feeds';
          commit({ ...host.cfg, news: { ...host.cfg.news, [k]: inp.value.trim() } });
        }
        render();
      });
    });
  }

  function close() {
    hideAlert();
    typing(false);
    host = null;
    view = { kind: 'main' };
    el.classList.remove('show');
  }
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !el.classList.contains('show')) return;
    if (al.classList.contains('show')) return hideAlert();
    if (view.kind === 'list') return listBack(view);
    if (view.kind !== 'main') {
      view = { kind: 'main' };
      typing(false);
      render();
    } else close();
  });

  return {
    open(h: ConfigHost) {
      host = h;
      view = { kind: 'main' };
      render();
      el.classList.add('show');
    },
    close,
    isOpen: () => el.classList.contains('show'),
  };
}
