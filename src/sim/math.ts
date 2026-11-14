export interface Vec2 { x: number; y: number }
export interface PathPoint { x: number; y: number; z: number; t: number }

export const DEG = Math.PI / 180;
export const G = 32.174; // ft/s²
export const MPH_TO_FTPS = 5280 / 3600;

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

/** Unit vector for an aim angle. Angle 0 points down-range (+y); positive angles turn toward +x. */
export const dirFromAngle = (a: number): Vec2 => ({ x: Math.sin(a), y: Math.cos(a) });
export const angleFromDir = (x: number, y: number) => Math.atan2(x, y);

/** Signed lateral offset of p from the line through o with direction angle a (+ = right of the line). */
export function lateralOffset(o: Vec2, a: number, p: Vec2): number {
  const d = dirFromAngle(a);
  const dx = p.x - o.x;
  const dy = p.y - o.y;
  return dx * d.y - dy * d.x;
}

/** Distance along the line through o with direction angle a. */
export function alongOffset(o: Vec2, a: number, p: Vec2): number {
  const d = dirFromAngle(a);
  return (p.x - o.x) * d.x + (p.y - o.y) * d.y;
}
