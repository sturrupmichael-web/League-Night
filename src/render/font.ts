/** A tiny original 3×5 pixel font, drawn with fillRect so it stays crisp at any scale. */
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

const BITS: Record<string, boolean[]> = {};
for (const [ch, pat] of Object.entries(GLYPHS)) BITS[ch] = [...pat].map((c) => c === '#');

export const GLYPH_W = 3;
export const GLYPH_H = 5;
export const ADVANCE = 4;

export function textWidth(s: string): number {
  return s.length === 0 ? 0 : s.length * ADVANCE - 1;
}

export function drawText(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, align: 'left' | 'center' | 'right' = 'left') {
  const str = s.toUpperCase();
  let cx = Math.round(align === 'center' ? x - textWidth(str) / 2 : align === 'right' ? x - textWidth(str) : x);
  const cy = Math.round(y);
  ctx.fillStyle = color;
  for (const ch of str) {
    const bits = BITS[ch];
    if (bits) {
      for (let i = 0; i < 15; i++) if (bits[i]) ctx.fillRect(cx + (i % 3), cy + Math.floor(i / 3), 1, 1);
    }
    cx += ADVANCE;
  }
}

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
