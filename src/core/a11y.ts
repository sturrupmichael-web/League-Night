/**
 * The game draws to a canvas, so screen readers can't see it. Important moments (a throw's
 * result, the hole score) are also written to a hidden live region that gets read out.
 */
let region: HTMLElement | null = null;
let last = '';

export function announce(text: string) {
  if (!text || text === last || typeof document === 'undefined') return;
  last = text;
  if (!region) {
    region = document.createElement('div');
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('role', 'status');
    region.className = 'sr-only';
    document.body.appendChild(region);
  }
  region.textContent = text.toLowerCase();
}
