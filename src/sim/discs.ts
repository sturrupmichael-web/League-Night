export type DiscType = 'putter' | 'midrange' | 'fairway' | 'distance';

/** Flight numbers follow the usual convention: speed 1–14, glide 1–7, turn +1..-5, fade 0–5. */
export interface FlightNumbers { speed: number; glide: number; turn: number; fade: number }

export interface Disc extends FlightNumbers {
  id: string;
  name: string;
  type: DiscType;
  color: string;
  blurb?: string;
}

/** Overall stability: higher fades harder, lower turns more. */
export const stability = (d: FlightNumbers) => d.fade + d.turn;

/** True when the disc should skate after landing rather than sit. */
export const isSkater = (d: FlightNumbers) => d.speed >= 6;
