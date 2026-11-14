// Generates the PWA icons as pixel art PNGs (no dependencies: zlib + a tiny PNG writer).
// Run: node scripts/make-icons.cjs
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const C = {
  '.': [20, 17, 28], // night1
  n: [13, 11, 19],
  d: [53, 43, 69],
  a: [242, 181, 68],
  o: [201, 138, 44],
  s: [168, 179, 189],
  i: [185, 173, 148],
  g: [44, 82, 57],
  w: [244, 233, 205],
  r: [224, 83, 63],
};

// 32x32 art: lantern string, basket with lit band, a disc flying in.
const ART = [
  '................................',
  '................................',
  'dd..........................dd..',
  '..dd......................dd....',
  '....ddd..a.........a...ddd......',
  '.......dda.........add..........',
  '.........r....a....r............',
  '..............a.................',
  '................................',
  '...........nnnnnnnnnn...........',
  '...........naaaaaaaan...........',
  '...........noooooooon...........',
  '............i.i.s.i.i...........',
  '............i.i.s.i.i...........',
  '.............i.is.i.i...........',
  '.............i.is.ii............',
  '..........nnnnnnsnnnnnn.........',
  '..........ssssssssssssn.....ww..',
  '...........iiiiiiiiiiin...wwaaw.',
  '................s........naaaan.',
  '................s.........nnnn..',
  '................s...............',
  '................s...............',
  '................s...............',
  '................s...............',
  '................s...............',
  '..............nnsnn.............',
  'gggggggggggggggggggggggggggggggg',
  'gggggggggggggggggggggggggggggggg',
  'gggggggggggggggggggggggggggggggg',
  'gggggggggggggggggggggggggggggggg',
  'gggggggggggggggggggggggggggggggg',
];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pad) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const inner = size - pad * 2;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let col = C['.'];
      const u = Math.floor(((x - pad) / inner) * 32);
      const v = Math.floor(((y - pad) / inner) * 32);
      if (u >= 0 && v >= 0 && u < 32 && v < 32) col = C[ART[v][u]] ?? C['.'];
      else if (v >= 27) col = C.g; // grass continues to the edge on maskable icons
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = col[0];
      raw[o + 1] = col[1];
      raw[o + 2] = col[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const out = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon-192.png'), png(192, 0));
fs.writeFileSync(path.join(out, 'icon-512.png'), png(512, 0));
fs.writeFileSync(path.join(out, 'maskable-512.png'), png(512, 56));
fs.writeFileSync(path.join(out, 'apple-touch-icon.png'), png(180, 0));
console.log('icons written to', out);
