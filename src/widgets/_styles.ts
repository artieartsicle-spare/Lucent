import { hair } from './_shared';

const css = document.createElement('style');
css.textContent = `
.n-lbl{font:600 11px/1 "Inter",sans-serif;letter-spacing:.06em;text-transform:uppercase;color:rgba(255,255,255,.62)}
.n-sub{font:500 12px/1.3 "Inter",sans-serif;color:rgba(255,255,255,.7)}
.n-fill{display:flex;flex-direction:column;justify-content:space-between;height:100%}
.n-wr{display:flex;align-items:center;justify-content:space-between;flex:1;border-bottom:1px solid rgba(255,255,255,.12);min-height:0}
.n-wr:last-child{border-bottom:0}
.n-wlist{display:flex;flex-direction:column;height:100%}
.n-wg{display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(2,1fr);gap:0 18px;height:100%}
.n-wg>div{display:flex;flex-direction:column;justify-content:center;border-bottom:1px solid rgba(255,255,255,.12)}
.n-wg>div:nth-last-child(-n+4){border-bottom:0}
.n-days{display:flex;flex-direction:column}
.n-day{display:flex;align-items:center;gap:8px;font:500 13px/1 "Inter",sans-serif;height:var(--rh,28px);border-top:1px solid rgba(255,255,255,.12)}
.n-day .d{width:44px;font-weight:600}
.n-day .i{width:22px;display:flex;justify-content:center}
.n-day .lo{width:28px;text-align:right;color:rgba(255,255,255,.6)}
.n-day .hi{width:28px}
.n-day .bar{flex:1;height:5px;border-radius:3px;background:rgba(255,255,255,.2);position:relative}
.n-day .bar i{position:absolute;top:0;bottom:0;border-radius:3px;background:linear-gradient(90deg,#64d2ff,#ffd60a)}
`;
document.head.appendChild(css);
const css2 = document.createElement('style');
css2.textContent = `
.wmount{border-radius:inherit;overflow:hidden}
.opq{overflow:hidden;padding:0}
.n-mr{display:flex;align-items:center;gap:7px;flex:1;min-height:0;border-top:1px solid ${hair};font:500 12.5px/1 "Inter",sans-serif}
.n-mr:first-child{border-top:0}
.n-mr .l{flex:1;color:rgba(255,255,255,.8)}
.n-mr b{font-weight:600}
.n-mr .ic{width:16px;display:flex;justify-content:center}
.f-u{font-weight:700;text-transform:uppercase;margin-left:1px}
.f-sec{flex:1;min-height:0;display:flex;flex-direction:column;gap:4px;border-top:1px solid ${hair};padding-top:6px}
.f-sec:first-child{border-top:0;padding-top:0}
.f-lbl{font:700 11px/1 "Inter",sans-serif;letter-spacing:.09em;text-transform:uppercase}
`;
document.head.appendChild(css2);

const css3 = document.createElement('style');
css3.textContent = `
.nv{position:absolute;inset:0;color:var(--w-ink,#fff);font-family:"Inter",sans-serif}
.nv-h{display:flex;align-items:center;gap:7px;font:600 12.5px/1 "Inter",sans-serif;letter-spacing:.045em;text-transform:uppercase;color:var(--w-ink2,rgba(255,255,255,.62));white-space:nowrap}
.nv-rows{display:flex;flex-direction:column}
.nv-r{display:flex;align-items:center;justify-content:space-between;flex:1;min-height:0;border-top:1px solid var(--w-line,rgba(255,255,255,.2));font:600 15px/1 "Inter",sans-serif;white-space:nowrap}
.nv-r:first-child{border-top:0}
.nv-r b{font-weight:600;color:var(--w-ink2,rgba(255,255,255,.62))}
.nv-r small,.nv-big small{font-size:.7em;font-weight:600;text-transform:uppercase;margin-left:3px;letter-spacing:.02em}
.nv-big{font:300 30px/1 "Inter",sans-serif;letter-spacing:-.02em}
`;
document.head.appendChild(css3);