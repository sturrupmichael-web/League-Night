/** Fixed 60 Hz simulation, rendering on requestAnimationFrame. */
export const TICK = 1 / 60;

export function startLoop(update: (dt: number) => void, render: (alpha: number) => void): () => void {
  let acc = 0;
  let last = performance.now();
  let raf = 0;
  const frame = (now: number) => {
    // Clamp long pauses (tab switch) so we don't spiral trying to catch up.
    acc += Math.min(0.25, (now - last) / 1000);
    last = now;
    while (acc >= TICK) {
      update(TICK);
      acc -= TICK;
    }
    render(acc / TICK);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
