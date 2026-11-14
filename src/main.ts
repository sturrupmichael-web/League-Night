import { config } from './config';
import courseJson from './content/courses/lantern-park.json';
import { PRACTICE_HOLE } from './content/practiceField';
import { Input } from './core/input';
import { startLoop } from './core/loop';
import type { Scene } from './core/scene';
import { createScreen } from './core/screen';
import { loadDevOverrides, mountDevPanel } from './dev/panel';
import { type CourseJson, parseCourse } from './game/hole';
import { HoleScene } from './scenes/HoleScene';
import { LauncherScene } from './scenes/Launcher';
import './style.css';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const screen = createScreen(canvas);
const input = new Input(screen);

// Options come from the query string (?practice&hole=2&dev=1) or, where only a hash can be
// passed (hosted previews), from words in the hash: #practice, #hole2, #dev.
const params = new URLSearchParams(location.search);
const hashWords = location.hash.slice(1).split(/[-+,]/).filter(Boolean);
for (const w of hashWords) {
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

const course = parseCourse(courseJson as CourseJson);
const seed = Number(params.get('seed')) || (Date.now() >>> 0);

// Until the title screen arrives (Phase 3): ?practice opens the practice field, otherwise
// you play the course hole by hole. ?hole=N starts on hole N.
let scene: Scene;
let roundToPar = 0;

function playHole(index: number) {
  const hole = course.holes[index];
  scene = new HoleScene(config, {
    hole,
    practice: false,
    seed,
    holeNumber: index + 1,
    holeCount: course.holes.length,
    roundToPar,
    onThrow: (r) => panel?.report(r),
    onFinish: (s, action) => {
      if (action === 'replay') return playHole(index);
      roundToPar += s.strokes - s.par;
      if (index + 1 >= course.holes.length) {
        roundToPar = 0;
        playHole(0);
      } else playHole(index + 1);
    },
  });
  input.handler = scene;
}

function practice() {
  scene = new HoleScene(config, { hole: PRACTICE_HOLE, practice: true, seed, holeNumber: 0, holeCount: 0, roundToPar: 0, onThrow: (r) => panel?.report(r) });
  input.handler = scene;
}

function launcher() {
  scene = new LauncherScene(
    [
      ...course.holes.map((h, i) => ({ caption: `${course.name} · PAR ${h.par}`, value: `HOLE ${i + 1}: ${h.name}`, onTap: () => playHole(i) })),
      { caption: 'NO SCORE', value: 'PRACTICE FIELD', onTap: practice },
      { caption: 'TUNING SLIDERS', value: panel ? 'DEV PANEL ON' : 'TURN DEV PANEL ON', onTap: () => { enableDev(); launcher(); } },
    ],
    () => (panel ? 'TAP DEV (TOP LEFT) FOR SLIDERS' : 'RELOAD TO COME BACK HERE'),
  );
  input.handler = scene;
}

if (params.has('practice')) practice();
else if (params.has('hole')) playHole(Math.min(course.holes.length, Math.max(1, Number(params.get('hole')) || 1)) - 1);
else launcher();

startLoop(
  (dt) => scene.update(dt),
  (alpha) => scene.render(screen.ctx, alpha),
);

// Exposed for smoke tests and debugging in the console.
(window as unknown as { leagueNight: unknown }).leagueNight = {
  get scene() {
    return scene;
  },
  config,
};
