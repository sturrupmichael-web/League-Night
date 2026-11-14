# League Night

An original retro pixel-art disc golf game for phones and desktop browsers. You're a regular at
the course's weekly league night: warm up on the practice field, play your card, chase a season title.

Built with Vite + TypeScript, rendered to a single 180×320 canvas, integer-scaled.

## Run it

```bash
npm install
npm run dev -- --host     # prints a LAN URL you can open on your phone
npm test                  # Vitest: flight, ground, putting, rules, hole loader
npm run build             # type-check, then static build into dist/
npm run build:single      # also writes dist/league-night-single.html (one self-contained file)
```

**On a phone without a laptop:** the latest build is published as a private test page in the project
thread. It opens on a small test menu (holes, practice field, tuning sliders).

Add `?dev=1` to the URL for the tuning panel (tap **DEV** top-left). Slider changes apply to the
next throw and persist in that browser; **Copy changes** gives you JSON to paste back into
`src/config.ts`.

## Playing

Opening the game shows a small test menu. Until the title screen arrives in Phase 3, URL options skip it
(where only a hash can be passed, use `#practice`, `#hole2`, `#dev`):

| URL option | What it does |
| --- | --- |
| `?practice` | Practice field (no score, distance markers, wind toggle) |
| `?hole=2` | Start on hole 2 |
| `?seed=123` | Fix the round's random seed (wind, redline wobble) |
| `?dev=1` | Tuning panel |

**Throwing:** put your finger (or mouse) on the disc, pull **back**, let go. Pull length is power;
past the red line is the **redline** (more distance, less control). Drag back onto the disc to cancel.
A faint orange line shows the start of the flight. Tap during a flight to skip ahead.

**Looking around:** drag anywhere away from the disc to scout, pinch (or mouse wheel) to zoom,
tap the minimap or **VIEW** for the whole hole, **FIND DISC** to snap back.

**Putting:** inside 70 ft with a putter in hand (you're handed one automatically) the view drops
behind the disc. Swipe up at the chains: swipe length is power, a fast flick at the end adds a bit,
a slow push takes some away, and a curved swipe bends the putt. Stop your thumb before letting go,
or pull it back down, and nothing happens. Inside 8 ft, just tap the disc.

**Rules:** penalties (water, out of bounds) add a stroke and drop you where the disc went out.
A hole stops at par + 5.

## Hole format

Courses live in `src/content/courses/*.json`. Units are feet; `y` points from tee toward the basket.

```jsonc
{
  "id": 1, "name": "SIGN-IN SHEET", "par": 3, "lengthFt": 250,
  "tee": [0, 0], "basket": [25, 250],
  "bounds": [[-120, -40], [130, -40], [130, 330], [-120, 330]],   // outside = out of bounds
  "fairway": [[...polygon...]], "green": [...], "rough": [...],    // lists of polygons
  "sand": [...], "water": [...], "ob": [...],                     // later layers win
  "trees": [{ "x": 70, "y": 140, "r": 9 }],                       // optional "h" (default 28 ft)
  "heightmap": { "cellFt": 20, "w": 14, "h": 20, "originX": -120, "originY": -40, "data": [...] },
  "windRange": [0, 10], "note": "POND GUARDS THE LEFT"
}
```

Everything outside the listed polygons is rough. `src/game/hole.ts` validates a hole when it loads
and throws a message naming the bad field.

## Layout

```
src/
  main.ts            boot, fixed 60 Hz loop, scene wiring
  config.ts          every tunable number + dev-panel slider ranges
  core/              screen scaling, pointer input, loop, scene interface
  sim/               pure, deterministic physics (no rendering here)
    flight.ts        disc flight: flight numbers, release angle, style, hand, wind, redline, trees, basket
    ground.ts        sit / skate / roller / water skip / splash / out of bounds / sand / slopes
    putt.ts          swipe reading + putt outcome (chains, spit out, over, cage, short, wide)
    throw.ts         flight + ground from (inputs, seed) — what replays and online play will re-run
    terrain.ts       heightmap sampling, surface polygons, trees
    wind.ts rng.ts   wind model, seeded random
  game/              hole loader + validation, rules and scoring
  content/           discs.json, courses/*.json, practice field
  render/            palette, 3×5 pixel font, field rasteriser, placeholder sprites
  scenes/HoleScene.ts one hole: top-down throwing, putting view, gimmes, scoring (also runs the practice field)
  core/camera.ts     follow / drag / pinch / overview camera
  render/puttView.ts behind-the-disc putting view
  ui/                pixel buttons
  dev/panel.ts       ?dev=1 sliders
```

## Status

Phases 1 (core throw) and 2 (a playable hole) are in. See the project thread for the phase plan.
