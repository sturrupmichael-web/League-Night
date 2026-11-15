/**
 * ?dev=1 tuning panel: sliders for every entry in CONFIG_META, live-editing `config`.
 * Values persist in localStorage so you can tune on a phone across reloads.
 */
import { CONFIG_META, type Config, DEFAULT_CONFIG } from '../config';
import type { ThrowResult } from '../sim/throw';

export const KEY = 'leaguenight.dev.config.v1';

export function loadDevOverrides(cfg: Config) {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Partial<Config>;
    for (const m of CONFIG_META) if (typeof saved[m.key] === 'number') (cfg[m.key] as number) = saved[m.key] as number;
  } catch {
    /* storage unavailable: run with defaults */
  }
}

function save(cfg: Config) {
  try {
    const out: Record<string, number> = {};
    for (const m of CONFIG_META) if (cfg[m.key] !== DEFAULT_CONFIG[m.key]) out[m.key] = cfg[m.key] as number;
    localStorage.setItem(KEY, JSON.stringify(out));
  } catch {
    /* ignore */
  }
}

export function mountDevPanel(cfg: Config): { report(r: ThrowResult): void } {
  const css = document.createElement('style');
  css.textContent = `
  #dev-toggle{position:fixed;top:calc(env(safe-area-inset-top) + 4px);left:4px;z-index:20;font:700 11px ui-monospace,monospace;background:#352b45;color:#f2b544;border:1px solid #5b4a6e;padding:4px 6px;border-radius:3px}
  #dev{position:fixed;top:0;left:0;bottom:0;width:min(320px,92vw);z-index:19;overflow:auto;background:rgba(13,11,19,.94);color:#f4e9cd;font:11px/1.3 ui-monospace,monospace;padding:34px 10px 20px;display:none}
  #dev.open{display:block}
  #dev h3{margin:12px 0 4px;color:#f2b544;font-size:11px;letter-spacing:.1em}
  #dev label{display:grid;grid-template-columns:1fr 56px;gap:2px 6px;margin:5px 0}
  #dev input[type=range]{grid-column:1/3;width:100%}
  #dev .v{text-align:right;color:#8d7aa0}
  #dev button{font:inherit;margin:8px 6px 0 0;background:#352b45;color:#f4e9cd;border:1px solid #5b4a6e;padding:4px 8px}
  #dev pre{white-space:pre-wrap;color:#b9ad94;margin:6px 0 0}`;
  document.head.appendChild(css);

  const toggle = document.createElement('button');
  toggle.id = 'dev-toggle';
  toggle.textContent = 'DEV';
  const root = document.createElement('div');
  root.id = 'dev';
  toggle.onclick = () => root.classList.toggle('open');
  document.body.append(root, toggle);

  const stats = document.createElement('pre');
  stats.textContent = 'Throw something.';
  root.append(stats);

  const inputs = new Map<string, { range: HTMLInputElement; v: HTMLSpanElement }>();
  let group = '';
  for (const m of CONFIG_META) {
    if (m.group !== group) {
      group = m.group;
      const h = document.createElement('h3');
      h.textContent = group.toUpperCase();
      root.append(h);
    }
    const label = document.createElement('label');
    const name = document.createElement('span');
    name.textContent = m.key;
    const v = document.createElement('span');
    v.className = 'v';
    const range = document.createElement('input');
    range.type = 'range';
    range.min = String(m.min);
    range.max = String(m.max);
    range.step = String(m.step);
    range.value = String(cfg[m.key]);
    v.textContent = String(cfg[m.key]);
    range.oninput = () => {
      (cfg[m.key] as number) = Number(range.value);
      v.textContent = range.value;
      save(cfg);
    };
    label.append(name, v, range);
    root.append(label);
    inputs.set(m.key, { range, v });
  }

  const reset = document.createElement('button');
  reset.textContent = 'Reset all';
  reset.onclick = () => {
    for (const m of CONFIG_META) {
      (cfg[m.key] as number) = DEFAULT_CONFIG[m.key] as number;
      const el = inputs.get(m.key)!;
      el.range.value = String(cfg[m.key]);
      el.v.textContent = String(cfg[m.key]);
    }
    save(cfg);
  };
  const copy = document.createElement('button');
  copy.textContent = 'Copy changes';
  copy.onclick = async () => {
    const out: Record<string, number> = {};
    for (const m of CONFIG_META) if (cfg[m.key] !== DEFAULT_CONFIG[m.key]) out[m.key] = cfg[m.key] as number;
    const text = JSON.stringify(out, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = 'Copied!';
    } catch {
      stats.textContent = text;
    }
    setTimeout(() => (copy.textContent = 'Copy changes'), 1500);
  };
  root.append(reset, copy);

  return {
    report(r) {
      const L = r.flight.landing;
      stats.textContent = [
        `disc ${r.discId}  power ${r.input.power.toFixed(2)}  seed ${r.seed}`,
        `launch ${r.flight.launchSpeed.toFixed(1)} ft/s  bank0 ${((r.flight.launchBank * 180) / Math.PI).toFixed(1)}°`,
        `carry ${r.carry.toFixed(1)} ft  total ${r.total.toFixed(1)} ft`,
        `peak ${r.maxHeight.toFixed(1)} ft  air ${L.t.toFixed(2)} s`,
        `land bank ${((L.bank * 180) / Math.PI).toFixed(1)}°  descent ${((L.descent * 180) / Math.PI).toFixed(1)}°`,
        `rest ${r.ground.kind}  ${r.ground.surface}  pen ${r.ground.penalty}  trees ${r.flight.treeHits}`,
      ].join('\n');
    },
  };
}
