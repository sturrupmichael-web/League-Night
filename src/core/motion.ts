/**
 * Reduced motion: no screen shake, calmer particles, no drifting fireflies. Follows the
 * system setting unless the player picks ON or OFF in Settings.
 */
export type MotionPref = 'auto' | 'on' | 'off';

let pref: MotionPref = 'auto';

const systemReduced = () => {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

export const motion = {
  set(p: MotionPref) {
    pref = p;
  },
  get pref() {
    return pref;
  },
  /** True when motion should be kept to a minimum. */
  get reduced() {
    return pref === 'on' || (pref === 'auto' && systemReduced());
  },
};
