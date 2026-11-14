/** Fixed low-res canvas, integer-scaled to fit the window in device pixels. */
export const VIEW_W = 180;
export const VIEW_H = 320;

export interface Screen {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Convert a client (CSS px) position to internal canvas pixels. */
  toView(clientX: number, clientY: number): { x: number; y: number };
}

export function createScreen(canvas: HTMLCanvasElement): Screen {
  canvas.width = VIEW_W;
  canvas.height = VIEW_H;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  ctx.imageSmoothingEnabled = false;

  const fit = () => {
    const stage = canvas.parentElement!;
    const cs = getComputedStyle(stage);
    const availW = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const dpr = window.devicePixelRatio || 1;
    // Largest whole number of device pixels per game pixel that fits.
    let scale = Math.floor(Math.min((availW * dpr) / VIEW_W, (availH * dpr) / VIEW_H));
    if (scale < 1) scale = Math.min((availW * dpr) / VIEW_W, (availH * dpr) / VIEW_H);
    canvas.style.width = `${(VIEW_W * scale) / dpr}px`;
    canvas.style.height = `${(VIEW_H * scale) / dpr}px`;
  };
  fit();
  window.addEventListener('resize', fit);
  window.visualViewport?.addEventListener('resize', fit);

  return {
    canvas,
    ctx,
    toView(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      return { x: ((clientX - r.left) / r.width) * VIEW_W, y: ((clientY - r.top) / r.height) * VIEW_H };
    },
  };
}
