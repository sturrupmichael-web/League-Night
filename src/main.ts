import { App } from './app';
import { config } from './config';
import { Game } from './core/game';
import { Input } from './core/input';
import { startLoop } from './core/loop';
import { createScreen } from './core/screen';
import { loadDevOverrides, mountDevPanel } from './dev/panel';
import { loadDraft, mountEditor } from './dev/editor';
import { parseHole } from './game/hole';
import './style.css';

const params = new URLSearchParams(location.search);
for (const w of location.hash.slice(1).split(/[-+,]/).filter(Boolean)) {
  const m = /^hole(\d+)$/.exec(w);
  if (m) params.set('hole', m[1]);
  else if (w === 'dev') params.set('dev', '1');
  else params.set(w, '');
}

if (params.has('editor')) {
  // Dev-only hole editor replaces the game page.
  document.getElementById('stage')!.style.display = 'none';
  mountEditor(document.body.appendChild(document.createElement('div')));
} else boot();

function boot() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const screen = createScreen(canvas);
  const input = new Input(screen);
  const game = new Game();
  input.handler = game;


  let panel: ReturnType<typeof mountDevPanel> | null = null;
  function enableDev() {
    if (panel) return;
    loadDevOverrides(config);
    panel = mountDevPanel(config);
  }
  if (params.get('dev') === '1') enableDev();

  const app = new App(game, { onThrow: (r) => panel?.report(r), enableDev, devOn: () => !!panel });

  const draft = params.has('testhole') ? loadDraft() : null;
  if (draft) {
    app.startCustomHole(parseHole(draft));
    const back = document.createElement('a');
    back.href = `${location.pathname}?editor`;
    back.textContent = 'BACK TO EDITOR';
    back.style.cssText = 'position:fixed;top:4px;right:4px;z-index:30;font:700 11px ui-monospace,monospace;background:#352b45;color:#f2b544;border:1px solid #5b4a6e;padding:4px 6px;text-decoration:none';
    document.body.appendChild(back);
  } else if (params.has('practice')) app.practice();
  else if (params.get('join')) app.friends.join(params.get('join')!.slice(0, 6));
  else if (params.has('hole')) {
    const n = Math.min(app.course.holes.length, Math.max(1, Number(params.get('hole')) || 1));
    app.startSingleHole(n - 1, Number(params.get('seed')) || 5);
  } else app.title();

  startLoop(
    (dt) => game.update(dt),
    (alpha) => game.render(screen.ctx, alpha),
  );

  // Exposed for the smoke test and for debugging in the console.
  (window as unknown as { leagueNight: unknown }).leagueNight = {
    get scene() {
      return game.top;
    },
    app,
    config,
  };
}

// Offline play: register the service worker on real deployments only (not the dev server,
// not the single-file test page, which has no sw.js beside it).
if (import.meta.env.PROD && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !document.documentElement.dataset.singleFile) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline play just isn't available here */
    });
  });
}
