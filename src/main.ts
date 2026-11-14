import { config } from './config';
import { Input } from './core/input';
import { startLoop } from './core/loop';
import type { Scene } from './core/scene';
import { createScreen } from './core/screen';
import { loadDevOverrides, mountDevPanel } from './dev/panel';
import { PracticeScene } from './scenes/Practice';
import './style.css';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const screen = createScreen(canvas);
const input = new Input(screen);

const dev = new URLSearchParams(location.search).get('dev') === '1';
let panel: ReturnType<typeof mountDevPanel> | null = null;
if (dev) {
  loadDevOverrides(config);
  panel = mountDevPanel(config);
}

let scene: Scene = new PracticeScene(config, (r) => panel?.report(r));
input.handler = scene;

startLoop(
  (dt) => scene.update(dt),
  (alpha) => scene.render(screen.ctx, alpha),
);

// Exposed for smoke tests and debugging in the console.
(window as unknown as { leagueNight: unknown }).leagueNight = { get scene() { return scene; }, config };
