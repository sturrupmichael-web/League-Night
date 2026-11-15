/**
 * Every tunable number in the game lives here. The sim takes a Config argument instead of
 * reading globals, so tests use DEFAULT_CONFIG and the dev panel (?dev=1) can edit `config` live.
 */
export const DEFAULT_CONFIG = {
  // ---- Flight: launch ----
  /** Launch speed in ft/s at power 1.0 (before style multipliers). */
  armSpeed: 98,
  /** Highest power the slingshot allows. Anything above 1.0 is the redline. */
  maxPower: 1.15,
  /** Launch height above the ground, ft. */
  releaseHeight: 5,
  launchPitchBackhandDeg: 7,
  launchPitchForehandDeg: 6,
  launchPitchHammerDeg: 50,
  forehandPowerMul: 0.92,
  hammerPowerMul: 0.72,
  /** Bank angle (deg) for a full hyzer or anhyzer release. */
  releaseBankDeg: 20,
  /** Max launch-speed bonus for matching release angle to the disc's natural line. */
  matchBonus: 0.05,

  // ---- Flight: aerodynamics ----
  /** Airspeed (ft/s) a speed-1 disc "wants"; each speed point adds ratedSpeedPerSpeed. */
  ratedSpeedBase: 60,
  ratedSpeedPerSpeed: 2.2,
  /** Quadratic drag coefficient. */
  drag: 0.0035,
  /** How much less drag a speed-14 disc has than a speed-1 disc (0..1). */
  dragSpeedRelief: 0.75,
  /** Lift coefficient. */
  lift: 0.0062,
  glideBase: 0.55,
  glidePer: 0.09,
  /** Lift lost per point of disc speed (faster molds need more arm). */
  liftSpeedPenalty: 0.05,
  /** How hard lift drops when the disc is slower than its rated speed. */
  underpowerLiftExp: 0.5,
  /** Turn: bank change (rad/s) per point of turn per unit of overspeed. */
  turnRate: 1.5,
  /** Fraction of rated speed above which the disc turns. */
  turnThreshold: 1.08,
  /** Caps how much extra turn very high overspeed adds. */
  turnCap: 0.35,
  /** Fade: bank change (rad/s) per point of fade per unit of underspeed. */
  fadeRate: 2.5,
  /** Fraction of rated speed below which the disc fades. */
  fadeThreshold: 0.95,
  /** Fade every disc has, even fade-0 molds, as it dies. */
  baseStability: 0.25,
  /** Sideways force scale from bank. */
  lateralK: 1.2,
  maxBankDeg: 75,
  hammerLift: 0.06,
  hammerRollDeg: 40,
  maxFlightTime: 14,

  // ---- Flight: redline gamble ----
  redlineAimWobbleDeg: 5,
  redlineBankWobbleDeg: 14,
  redlineExtraTurn: 1.5,

  // ---- Wind ----
  windScale: 1,
  /** 0 = wind only drifts the disc, 1 = wind fully changes lift and turn. */
  windLiftFactor: 0.2,
  gustAmp: 0.35,

  // ---- Obstacles ----
  treeHeight: 28,
  treeRestitution: 0.3,
  treeLiftKill: 0.15,
  basketRadius: 1.1,
  basketCatchLow: 2.2,
  basketCatchHigh: 4.6,

  // ---- Ground ----
  frictionFairway: 0.55,
  frictionGreen: 0.5,
  frictionRough: 1.1,
  /** Slide speed kept (fraction of landing speed) for a putter/mid that just sits. */
  sitSlide: 0.06,
  /** Extra slide kept by a full skater. */
  skateKeep: 0.42,
  /** Disc speed where skating starts / reaches full strength. */
  skateMinSpeed: 5,
  skateFullSpeed: 12,
  /** Skates hook toward the fade side (rad/s). */
  skateCurve: 0.5,
  slopeK: 1,
  rollerMinSpeed: 6,
  rollerMinBankDeg: 30,
  rollerMaxDescentDeg: 30,
  rollerChance: 0.6,
  rollerSpeedKeep: 0.65,
  rollFriction: 0.16,
  rollerCurve: 1.1,
  skipMinSpeed: 40,
  skipMaxDescentDeg: 16,
  skipMaxBankDeg: 25,
  skipChance: 0.8,
  skipSpeedKeep: 0.7,
  skipBounceDeg: 15,
  hammerTumbleChance: 0.5,
  hammerTumbleMax: 16,

  // ---- Putting ----
  /** Lie distance (ft) at which a putter switches to the putting view. */
  puttRangeFt: 70,
  /** Lie distance (ft) for a tap-to-drop gimme. */
  gimmeFt: 8,
  /** Swipe length (view px) for full putt power. */
  puttFullSwipePx: 150,
  puttMinSwipePx: 10,
  /** Finger speed (px/s) at release that counts as parked: cancels the putt. */
  puttParkSpeed: 25,
  /** Release speed (px/s) of a "normal" swipe. Faster snaps add power, slower pushes lose it. */
  puttSnapRef: 450,
  puttSnapGain: 0.15,
  /** How much the swipe's sideways angle steers the putt (0..1). */
  puttAimGain: 0.3,
  /** How much a curved swipe bends the putt. */
  puttBendGain: 4,
  /** Sideways acceleration (ft/s²) of a full bend. */
  puttBendAccel: 6,
  /** Launch speed (ft/s) at full power. Power maps to speed by square root, so distance is roughly linear in swipe. */
  puttSpeedFull: 75,
  puttLaunchDeg: 12,
  puttReleaseHeight: 3,
  puttWindDrift: 0.12,
  /** Putts from beyond this distance pick up a random release wobble... */
  puttWobbleFromFt: 20,
  /** ...of up to this many degrees of aim per 30 ft past it... */
  puttWobbleDeg: 1.6,
  /** ...and up to this fraction of power per 30 ft past it. */
  puttPowerWobble: 0.06,
  /** How many feet of the putt's line the aiming guide shows while swiping (0 = no guide). Capped at 60% of the putt. */
  puttGuideFt: 6,
  /** Taps this soon after the putt view opens are ignored (s): they were meant to skip the flight. */
  puttTapGuardS: 0.25,
  /** Basket geometry, relative to basket ground (ft). */
  chainHalfWidth: 0.85,
  centerHalfWidth: 0.35,
  cageHalfWidth: 1.15,
  cageBottom: 0.8,
  /** Arrival speed, as a multiple of a perfectly weighted putt's, where off-centre putts start to spit out / always blow through. */
  spitRatio: 1.04,
  blowThroughRatio: 1.25,

  // ---- Rules ----
  /** Max strokes on a hole = par + this. */
  maxOverPar: 5,

  // ---- Camera ----
  minZoom: 0.2,
  maxZoom: 1.6,

  // ---- Input ----
  maxPullPx: 64,
  grabRadiusPx: 22,
  cancelPullPx: 8,
  /** Fraction of the flight time shown as the faint preview line. */
  previewFraction: 0.3,
};

export type Config = typeof DEFAULT_CONFIG;
export type ConfigKey = keyof Config;

export interface ConfigMeta { key: ConfigKey; min: number; max: number; step: number; group: string }

const m = (group: string, key: ConfigKey, min: number, max: number, step: number): ConfigMeta => ({ key, min, max, step, group });

/** Sliders shown in the ?dev=1 panel. */
export const CONFIG_META: ConfigMeta[] = [
  m('Launch', 'armSpeed', 50, 130, 1),
  m('Launch', 'releaseBankDeg', 5, 45, 1),
  m('Launch', 'launchPitchBackhandDeg', 0, 20, 0.5),
  m('Launch', 'forehandPowerMul', 0.6, 1.1, 0.01),
  m('Launch', 'hammerPowerMul', 0.4, 1, 0.01),
  m('Launch', 'matchBonus', 0, 0.2, 0.005),
  m('Aero', 'ratedSpeedBase', 20, 80, 1),
  m('Aero', 'ratedSpeedPerSpeed', 1, 8, 0.1),
  m('Aero', 'drag', 0.0005, 0.008, 0.0001),
  m('Aero', 'dragSpeedRelief', 0, 0.9, 0.01),
  m('Aero', 'lift', 0.001, 0.008, 0.0001),
  m('Aero', 'glidePer', 0, 0.2, 0.005),
  m('Aero', 'underpowerLiftExp', 0, 4, 0.1),
  m('Aero', 'turnRate', 0, 6, 0.1),
  m('Aero', 'turnThreshold', 0.5, 1.1, 0.01),
  m('Aero', 'fadeRate', 0, 8, 0.1),
  m('Aero', 'fadeThreshold', 0.4, 1.1, 0.01),
  m('Aero', 'baseStability', 0, 2, 0.05),
  m('Aero', 'lateralK', 0, 2, 0.05),
  m('Redline', 'redlineAimWobbleDeg', 0, 20, 0.5),
  m('Redline', 'redlineBankWobbleDeg', 0, 40, 1),
  m('Redline', 'redlineExtraTurn', 0, 5, 0.1),
  m('Wind', 'windScale', 0, 3, 0.05),
  m('Wind', 'gustAmp', 0, 1, 0.05),
  m('Wind', 'windLiftFactor', 0, 1, 0.05),
  m('Ground', 'frictionFairway', 0.1, 2, 0.05),
  m('Ground', 'frictionRough', 0.1, 3, 0.05),
  m('Ground', 'skateKeep', 0, 1, 0.01),
  m('Ground', 'rollerChance', 0, 1, 0.05),
  m('Ground', 'skipChance', 0, 1, 0.05),
  m('Ground', 'skipMinSpeed', 10, 90, 1),
  m('Putting', 'puttFullSwipePx', 60, 260, 1),
  m('Putting', 'puttSpeedFull', 40, 110, 1),
  m('Putting', 'puttLaunchDeg', 4, 25, 0.5),
  m('Putting', 'puttSnapRef', 100, 1200, 10),
  m('Putting', 'puttSnapGain', 0, 0.5, 0.01),
  m('Putting', 'puttAimGain', 0, 1, 0.01),
  m('Putting', 'puttBendGain', 0, 12, 0.1),
  m('Putting', 'puttBendAccel', 0, 20, 0.5),
  m('Putting', 'puttWobbleFromFt', 0, 70, 1),
  m('Putting', 'puttWobbleDeg', 0, 6, 0.1),
  m('Putting', 'puttPowerWobble', 0, 0.3, 0.01),
  m('Putting', 'puttGuideFt', 0, 70, 1),
  m('Putting', 'puttTapGuardS', 0, 1, 0.05),
  m('Putting', 'chainHalfWidth', 0.3, 1.5, 0.05),
  m('Putting', 'spitRatio', 1, 1.5, 0.01),
  m('Putting', 'blowThroughRatio', 1, 2, 0.01),
  m('Putting', 'gimmeFt', 0, 20, 1),
  m('Input', 'maxPullPx', 30, 120, 1),
  m('Input', 'previewFraction', 0, 1, 0.05),
];

/** Live config. Mutated by the dev panel; everything else should treat it as read-only. */
export const config: Config = { ...DEFAULT_CONFIG };
