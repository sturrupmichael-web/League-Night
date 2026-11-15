/**
 * Low-res canvas, integer-scaled to fit the window in device pixels. The width is always
 * 180 game pixels; the height is 320 on a 9:16 screen and grows on taller phones (up to
 * config.maxViewH) so the game fills the screen instead of leaving empty bands. It is
 * picked once when the game loads, so every layout can treat it as a constant.
 */
import { DEFAULT_CONFIG } from '../config';
import { KEY as DEV_KEY } from '../dev/panel';

export const VIEW_W = 180;
export const BASE_VIEW_H = 320;
export const VIEW_H = pickViewHeight();
/** Rows gained over the classic 320: bottom-anchored layouts add this. */
export const EXTRA_H = VIEW_H - BASE_VIEW_H;

function pickViewHeight(): number {
  if (typeof window === 'undefined' || typeof document === 'undefined') return BASE_VIEW_H;
  const params = new URLSearchParams(location.search);
  const forced = Number(params.get('viewh'));
  if (forced) return Math.round(Math.min(480, Math.max(BASE_VIEW_H, forced)));
  let max = DEFAULT_CONFIG.maxViewH;
  if (params.get('dev') === '1') {
    try {
      const saved = JSON.parse(localStorage.getItem(DEV_KEY) ?? '{}') as { maxViewH?: number };
      if (typeof saved.maxViewH === 'number') max = saved.maxViewH;
    } catch {
      /* no storage: default */
    }
  }
  // The window less the phone's safe areas (the stage pads by these). Measured with a probe,
  // because the stylesheet may not be applied yet when this runs.
  let w = window.innerWidth;
  let h = window.innerHeight;
  if (document.body) {
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    w -= (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    h -= (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    probe.remove();
  }
  if (!w || !h) return BASE_VIEW_H;
  const dpr = window.devicePixelRatio || 1;
  // The whole-number scale the classic 180x320 would get, then as many rows as fit at that scale.
  const scale = Math.max(1, Math.floor(Math.min((w * dpr) / VIEW_W, (h * dpr) / BASE_VIEW_H)));
  const rows = Math.floor((h * dpr) / scale);
  return Math.max(BASE_VIEW_H, Math.min(Math.round(max), rows));
}

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
    canvas.style.visibility = 'visible'; // hidden until sized, so the page never jumps
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
