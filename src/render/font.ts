import { BARLOW_CONDENSED_600 } from './fonts/barlowCondensed600';

/** Game text. The 3x5 pixel glyphs below are the fallback until the real typeface loads. */
const GLYPHS: Record<string, string> = {
  'A': '.#.#.#####.##.#',
  'B': '##.#.###.#.###.',
  'C': '.###..#..#...##',
  'D': '##.#.##.##.###.',
  'E': '####..##.#..###',
  'F': '####..##.#..#..',
  'G': '.###..#.##.#.##',
  'H': '#.##.#####.##.#',
  'I': '###.#..#..#.###',
  'J': '..#..#..##.#.#.',
  'K': '#.##.###.#.##.#',
  'L': '#..#..#..#..###',
  'M': '#.########.##.#',
  'N': '##.#.##.##.##.#',
  'O': '.#.#.##.##.#.#.',
  'P': '##.#.###.#..#..',
  'Q': '.#.#.##.###..##',
  'R': '##.#.###.#.##.#',
  'S': '.###...#...###.',
  'T': '###.#..#..#..#.',
  'U': '#.##.##.##.####',
  'V': '#.##.##.##.#.#.',
  'W': '#.##.########.#',
  'X': '#.##.#.#.#.##.#',
  'Y': '#.##.#.#..#..#.',
  'Z': '###..#.#.#..###',
  '0': '####.##.##.####',
  '1': '.#.##..#..#.###',
  '2': '##...#.#.#..###',
  '3': '##...#.#...###.',
  '4': '#.##.####..#..#',
  '5': '####..##...###.',
  '6': '.###..####.####',
  '7': '###..#.#..#..#.',
  '8': '####.#####.####',
  '9': '####.####..###.',
  '.': '.............#.',
  ',': '..........#.#..',
  ':': '....#.....#....',
  '-': '......###......',
  '+': '....#.###.#....',
  '/': '..#..#.#.#..#..',
  '!': '.#..#..#.....#.',
  '?': '##...#.#.....#.',
  "'": '.#..#..........',
  '%': '#.#..#.#.#..#.#',
  '(': '.#.#..#..#...#.',
  ')': '.#...#..#..#.#.',
  '<': '..#.#.#...#...#',
  '>': '#...#...#.#.#..',
  '*': '...#.#.#.#.#...',
  '·': '.......#.......',
  '#': '#.#####.#####.#',
  '=': '...###...###...',
  '^': '.#.#.#.........',
};

/**
 * Game text is drawn with a real condensed typeface (Barlow Condensed SemiBold) at the screen's
 * full resolution, instead of the old blocky 3x5 pixel glyphs, so it reads cleanly on phones.
 * Callers still lay text out in game pixels: a line starts at `y` and is about 5 rows tall,
 * and each character takes about 4 columns. The old glyph table above is kept as the fallback
 * for places with no canvas text (tests) and as the source of truth for the width budget.
 */
export const GLYPH_W = 3;
export const GLYPH_H = 5;
export const ADVANCE = 4;

const FAMILY = 'LN Barlow Condensed';
/** Font size in game pixels; cap height is 0.7 of it. */
export const FONT_PX = 9;
const CAP = FONT_PX * 0.7;
/** Baseline below the top of the old 5-row line, so the taller caps stay centred on it. */
const BASELINE = (GLYPH_H + CAP) / 2;
/** Real text may be this much wider than the old pixel text before it is squeezed to fit. */
const STRETCH = 1.15;
const FONT = `600 ${FONT_PX}px "${FAMILY}", "Arial Narrow", "Roboto Condensed", sans-serif`;

let ready = false;
let measurer: CanvasRenderingContext2D | null = null;
const widths = new Map<string, number>();

/** Load the bundled typeface. Resolves (never rejects) once it is usable or has failed. */
export async function loadFont(): Promise<void> {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return;
  try {
    const bin = atob(BARLOW_CONDENSED_600);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const face = new FontFace(FAMILY, bytes, { weight: '600' });
    await face.load();
    document.fonts.add(face);
  } catch {
    /* fall back to the system condensed / sans font */
  }
  ready = true;
  widths.clear();
}

function pixelWidth(s: string): number {
  return s.length === 0 ? 0 : s.length * ADVANCE - 1;
}

function measure(s: string): number {
  if (!ready) return pixelWidth(s);
  let w = widths.get(s);
  if (w === undefined) {
    if (!measurer) {
      measurer = document.createElement('canvas').getContext('2d')!;
      measurer.font = FONT;
    }
    w = Math.min(measurer.measureText(s).width, pixelWidth(s) * STRETCH);
    if (widths.size > 4000) widths.clear();
    widths.set(s, w);
  }
  return w;
}

/** Width in game pixels the string takes when drawn (upper-cased, like drawText). */
export function textWidth(s: string): number {
  return measure(s.toUpperCase());
}

/** `maxWidth` (game px) squeezes the text narrower if it would not otherwise fit. */
export function drawText(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, align: 'left' | 'center' | 'right' = 'left', maxWidth = Infinity) {
  const str = s.toUpperCase();
  if (!str) return;
  const w = Math.min(measure(str), maxWidth);
  const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  ctx.fillStyle = color;
  if (!ready) {
    drawPixelText(ctx, str, Math.round(left), Math.round(y));
    return;
  }
  ctx.font = FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(str, left, Math.round(y) + BASELINE, Math.max(w, 1));
}

/** The old pixel glyphs: only used before the typeface has loaded, so nothing is ever blank. */
function drawPixelText(ctx: CanvasRenderingContext2D, str: string, cx: number, cy: number) {
  for (const ch of str) {
    const bits = BITS[ch];
    if (bits) {
      for (let i = 0; i < 15; i++) if (bits[i]) ctx.fillRect(cx + (i % 3), cy + Math.floor(i / 3), 1, 1);
    }
    cx += ADVANCE;
  }
}

const BITS: Record<string, boolean[]> = {};
for (const [ch, pat] of Object.entries(GLYPHS)) BITS[ch] = [...pat].map((c) => c === '#');

/** Text with a 1px dark drop shadow, for legibility over the field. */
export function drawTextShadow(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, shadow: string, align: 'left' | 'center' | 'right' = 'left') {
  drawText(ctx, s, x + 1, y + 1, shadow, align);
  drawText(ctx, s, x, y, color, align);
}

/** Greedy word wrap to a pixel width. */
export function wrapText(s: string, maxWidth: number): string[] {
  const words = s.toUpperCase().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (textWidth(next) > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
