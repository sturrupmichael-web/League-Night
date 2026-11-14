/**
 * Background music: three short original chiptune loops sequenced live with Web Audio
 * (square lead, triangle bass, noise hats). No audio files.
 *   menu   — the clubhouse at dusk, warm and a little wistful
 *   course — sparse and calm, so it never fights the throw
 *   turn   — quick and bouncy for the 30-second turn games
 */
import { sfx } from './audio';

export type Track = 'menu' | 'course' | 'turn';

interface Song {
  bpm: number;
  /** One entry per eighth note: a note name like 'A4', or '.' for a rest. '-' holds the last note. */
  lead: string;
  /** Chord roots, one per bar (8 eighths). */
  bass: string;
  /** Bass pattern per bar: r = root, o = octave up, f = fifth, . = rest. */
  bassPat: string;
  hats: boolean;
  kick: boolean;
  leadVol: number;
}

export const SONGS: Record<Track, Song> = {
  menu: {
    bpm: 92,
    lead:
      'A4 . C5 . E5 . D5 C5 D5 - - . A4 . G4 . A4 . C5 . E5 . G5 E5 D5 . C5 . A4 - - . ' +
      'F5 . E5 . D5 . C5 . E5 - - . C5 . A4 . G4 . A4 . C5 . D5 . E5 . D5 . A4 - - .',
    bass: 'A2 F2 C3 G2 F2 C3 G2 A2',
    bassPat: 'r . o . f . o .',
    hats: true,
    kick: true,
    leadVol: 0.05,
  },
  course: {
    bpm: 76,
    lead:
      'D5 . . . A4 . . . C5 . . . G4 . . . F4 . A4 . C5 . . . E5 - - - D5 . . . ' +
      'D5 . . . F5 . . . E5 . . . C5 . . . A4 . G4 . A4 . . . D5 - - - . . . .',
    bass: 'D2 A2 A#2 C3 D2 F2 C3 D2',
    bassPat: 'r . . . f . . .',
    hats: false,
    kick: false,
    leadVol: 0.035,
  },
  turn: {
    bpm: 132,
    lead:
      'C5 E5 G5 E5 C5 . G4 . A4 C5 F5 C5 A4 . F4 . G4 B4 D5 G5 F5 E5 D5 . E5 G5 C6 G5 E5 . C5 .',
    bass: 'C3 F2 G2 C3',
    bassPat: 'r o r o f o r o',
    hats: true,
    kick: true,
    leadVol: 0.04,
  },
};

const NOTE: Record<string, number> = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
export function noteFreq(name: string): number {
  const m = /^([A-G]#?)(\d)$/.exec(name);
  if (!m) return 0;
  const midi = 12 * (Number(m[2]) + 1) + NOTE[m[1]];
  return 440 * 2 ** ((midi - 69) / 12);
}

class Music {
  enabled = true;
  private want: Track | null = null;
  private playing: Track | null = null;
  private bus: GainNode | null = null;
  private step = 0;
  private nextT = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Ask for a track. It starts once audio is unlocked by a tap. */
  play(t: Track) {
    this.want = t;
    this.sync();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.sync();
  }

  /** Start, switch or stop to match what is wanted. */
  sync() {
    const c = sfx.context;
    const target = this.enabled && c ? this.want : null;
    if (target === this.playing) return;
    this.fadeOut();
    this.playing = target;
    if (!target || !c) return;
    this.bus = c.createGain();
    this.bus.gain.setValueAtTime(0.0001, c.currentTime);
    this.bus.gain.exponentialRampToValueAtTime(1, c.currentTime + 0.8);
    this.bus.connect(c.destination);
    this.step = 0;
    this.nextT = c.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 50);
  }

  private fadeOut() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const c = sfx.context;
    if (this.bus && c) {
      const b = this.bus;
      b.gain.cancelScheduledValues(c.currentTime);
      b.gain.setValueAtTime(b.gain.value || 0.0001, c.currentTime);
      b.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.4);
      setTimeout(() => b.disconnect(), 600);
    }
    this.bus = null;
  }

  private schedule() {
    const c = sfx.context;
    if (!c || !this.bus || !this.playing || c.state !== 'running') return;
    const song = SONGS[this.playing];
    const lead = song.lead.trim().split(/\s+/);
    const bass = song.bass.split(' ');
    const pat = song.bassPat.split(' ');
    const dt = 60 / song.bpm / 2;
    // Fell far behind (tab was hidden)? Skip ahead instead of playing a burst.
    if (this.nextT < c.currentTime - 0.2) this.nextT = c.currentTime + 0.05;
    while (this.nextT < c.currentTime + 0.25) {
      const i = this.step % lead.length;
      const t = this.nextT;
      const n = lead[i];
      if (n !== '.' && n !== '-') {
        let len = 1;
        while (lead[(i + len) % lead.length] === '-' && len < 8) len++;
        this.voice('square', noteFreq(n), t, dt * len * 0.9, song.leadVol);
      }
      const bar = Math.floor(this.step / 8) % bass.length;
      const p = pat[this.step % 8];
      if (p && p !== '.') {
        const root = noteFreq(bass[bar]);
        const f = p === 'o' ? root * 2 : p === 'f' ? root * 1.5 : root;
        this.voice('triangle', f, t, dt * 1.6, 0.09);
      }
      if (song.hats && this.step % 2 === 1) this.hat(t, 0.025);
      if (song.kick && this.step % 4 === 0) this.voice('sine', 90, t, 0.12, 0.12, 45);
      this.step++;
      this.nextT += dt;
    }
  }

  private voice(type: OscillatorType, f: number, t: number, dur: number, vol: number, fEnd?: number) {
    const c = sfx.context!;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (fEnd) o.frequency.exponentialRampToValueAtTime(fEnd, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.bus!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private hat(t: number, vol: number) {
    const c = sfx.context!;
    const buf = sfx.noiseBuffer;
    if (!buf) return;
    const s = c.createBufferSource();
    s.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    s.connect(f).connect(g).connect(this.bus!);
    s.start(t, Math.random() * 0.5);
    s.stop(t + 0.06);
  }
}

export const music = new Music();
sfx.onUnlock = () => music.sync();
