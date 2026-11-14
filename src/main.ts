import { App } from './app';
import { config } from './config';
import { Game } from './core/game';
import { Input } from './core/input';
import { startLoop } from './core/loop';
import { createScreen } from './core/screen';
import { loadDevOverrides, mountDevPanel } from './dev/panel';
import './style.css';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const screen = createScreen(canvas);
const input = new Input(screen);
const game = new Game();
input.handler = game;

// Options come from the query string (?practice&hole=2&dev=1) or, where only a hash can be
// passed (hosted previews), from words in the hash: #practice, #hole2, #dev.
const params = new URLSearchParams(location.search);
for (const w of location.hash.slice(1).split(/[-+,]/).filter(Boolean)) {
  const m = /^hole(\d+)$/.exec(w);
  if (m) params.set('hole', m[1]);
  else if (w === 'dev') params.set('dev', '1');
  else params.set(w, '');
}

let panel: ReturnType<typeof mountDevPanel> | null = null;
function enableDev() {
  if (panel) return;
  loadDevOverrides(config);
  panel = mountDevPanel(config);
}
if (params.get('dev') === '1') enableDev();

const app = new App(game, { onThrow: (r) => panel?.report(r), enableDev, devOn: () => !!panel });

if (params.has('practice')) app.practice();
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
