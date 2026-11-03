
const css = document.createElement('style');
css.textContent = `
.card,.nt{text-align:left}
.card{background:var(--card);color:var(--fg)}
.cn-dow{font:600 12.5px/1 "Inter",sans-serif;letter-spacing:.03em;color:var(--red);text-transform:uppercase}
.cn-num{font:300 46px/1 "Inter",sans-serif;letter-spacing:-.02em;margin-top:5px}
.cn-none{font:500 13px/1.25 "Inter",sans-serif;color:var(--sub)}
.cn-day{display:flex;flex-direction:column;justify-content:space-between}
.cn-grid{display:grid;grid-template-columns:repeat(7,1fr);grid-auto-rows:var(--cell);align-items:center;justify-items:center;text-align:center;font:500 var(--fs) "Inter",sans-serif;color:var(--fg)}
.cn-grid .h{font-weight:600;color:var(--sub)}
.cn-grid .we{color:var(--sub)}
.cn-grid b{display:inline-flex;align-items:center;justify-content:center;width:var(--cell);height:var(--cell);border-radius:50%;font-weight:inherit}
.cn-grid .td b{background:var(--red);color:#fff;font-weight:700}
.rm-ico{width:34px;height:34px;border-radius:50%;background:var(--blue);display:flex;align-items:center;justify-content:center;flex:none}
.rm-n{font:600 32px/1 "Inter",sans-serif;letter-spacing:-.02em}
.rm-name{font:600 15px/1.1 "Inter",sans-serif;color:var(--blue);margin-top:3px}
.rm-left{display:flex;flex-direction:column;justify-content:space-between;height:100%}
.rm-rows{display:flex;flex-direction:column;min-width:0}
.rm-row{display:flex;align-items:center;gap:10px;height:var(--rh);border-bottom:1px solid var(--hair);font:500 14px/1.1 "Inter",sans-serif;flex:none}
.rm-row:last-child{border-bottom:0}
.rm-cb{width:17px;height:17px;flex:none;border-radius:50%;border:1.4px solid var(--sub2);box-sizing:border-box;cursor:pointer;display:flex;align-items:center;justify-content:center}
.rm-row.done .rm-cb{background:var(--blue);border-color:var(--blue)}
.rm-row.done .rm-cb::after{content:"";width:8px;height:4px;border-left:1.8px solid #fff;border-bottom:1.8px solid #fff;transform:rotate(-45deg) translate(1px,-1px)}
.rm-row.done .rm-t{color:var(--sub2)}
.rm-t{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rm-in{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--fg);font:500 14px/1.1 "Inter",sans-serif;padding:0;user-select:text;-webkit-user-select:text;cursor:text}
.rm-in::placeholder{color:var(--sub2)}
.rm-empty{flex:1;display:flex;align-items:center;justify-content:center;font:500 14.5px/1.2 "Inter",sans-serif;color:var(--sub);text-align:center}
.rm-s{padding:14px 14px 8px;display:flex;flex-direction:column}
.rm-hd{display:flex;align-items:center;justify-content:space-between;flex:none}
.rm-hd .rm-name{margin:0;font-size:15.5px;font-weight:700}
.rm-hd .rm-n{font-size:30px;font-weight:700;letter-spacing:-.01em}
.rm-s .rm-rows{flex:1;margin-top:7px;justify-content:space-between}
.rm-s .rm-row{border-bottom:0;font-size:13.5px;gap:9px}
.rm-s .rm-cb{width:18px;height:18px}
.nt{padding:0!important;display:flex;flex-direction:column;background:var(--note-body);color:var(--fg)}
.nt-band{flex:none;background:linear-gradient(180deg,#ffd60a 0%,#ffb90d 100%);display:flex;align-items:center;gap:9px;padding:0 16px;color:#fff;font:600 19px/1 "Inter",sans-serif}
.nt-body{flex:1;min-height:0;display:flex;flex-direction:column;padding:13px 16px 12px;border-top:2px dotted var(--note-dot);margin-top:-2px;position:relative}
.nt-t{flex:1;min-height:0;resize:none;border:0;outline:0;background:transparent;color:var(--fg);font:500 16px/1.22 "Inter",sans-serif;padding:0;user-select:text;-webkit-user-select:text;cursor:text;overflow:hidden}
.nt-t::placeholder{color:var(--sub2)}
.nt-date{flex:none;font:500 13px/1 "Inter",sans-serif;color:var(--sub);margin-top:6px}
`;
document.head.appendChild(css);