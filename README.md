# League Night

An original retro pixel-art disc golf game for phones and desktop browsers. You're a regular at
the course's weekly league night: warm up on the practice field, play your card, chase a season title.

Built with Vite + TypeScript, rendered to a single 180×320 canvas, integer-scaled.

## Run it

```bash
npm install
npm run dev -- --host     # prints a LAN URL you can open on your phone
npm test                  # Vitest: flight + ground physics
npm run build             # type-check, then static build into dist/
```

Add `?dev=1` to the URL for the tuning panel (tap **DEV** top-left). Slider changes apply to the
next throw and persist in that browser; **Copy changes** gives you JSON to paste back into
`src/config.ts`.

## How to throw (practice field)

- Put your finger (or mouse) on the disc, pull **back**, let go. Pull length is power.
- Pulling past the red line on the power meter is the **redline**: more distance, less control.
- Drag back onto the disc and release to cancel.
- A faint orange line shows the first part of the flight. The rest is up to you.
- Buttons: **DISC** cycles the bag (flight numbers shown), **ANGLE** hyzer / flat / anhyzer,
  **STYLE** backhand / forehand / hammer, **HAND** righty / lefty, **WIND** calm / breezy / gusty
  (each press rolls a new wind), **BACK TO TEE**. Tap during a flight to skip to where it stops.

## Layout

```
src/
  main.ts            boot, fixed 60 Hz loop, scene wiring
  config.ts          every tunable number + dev-panel slider ranges
  core/              screen scaling, pointer input, loop, scene interface
  sim/               pure, deterministic physics (no rendering here)
    flight.ts        disc flight: flight numbers, release angle, style, hand, wind, redline, trees, basket
    ground.ts        sit / skate / roller / water skip / splash / out of bounds / sand / slopes
    throw.ts         flight + ground from (inputs, seed) — what replays and online play will re-run
    terrain.ts       heightmap sampling, surface polygons, trees
    wind.ts rng.ts   wind model, seeded random
  content/           discs.json, practice field
  render/            palette, 3×5 pixel font, field rasteriser, placeholder sprites
  scenes/Practice.ts the practice field
  ui/                pixel buttons
  dev/panel.ts       ?dev=1 sliders
```

## Status

Phase 1 (core throw) is in. See the project thread for the phase plan.
