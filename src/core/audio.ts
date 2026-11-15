/**
 * Chiptune sound effects synthesised with Web Audio. No sound files, so nothing to credit.
 * The context starts on the first tap (browsers block audio before that).
 */
export type SfxName = 'tap' | 'throw' | 'land' | 'tree' | 'chains' | 'clank' | 'splash' | 'skip' | 'putt' | 'good' | 'bad' | 'ob';

export class Sfx {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;
  /** Called once the audio context exists (music starts from here). */
  onUnlock: (() => void) | null = null;

  /** The shared audio context, once a tap has started it. */
  get context(): AudioContext | null {
    return this.ctx;
  }
  get noiseBuffer(): AudioBuffer | null {
    return this.noise;
  }

  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      this.onUnlock?.();
    } catch {
      this.ctx = null;
    }
  }

  play(name: SfxName) {
    const c = this.ctx;
    if (!this.enabled || !c || c.state !== 'running') return;
    const t = c.currentTime + 0.005;
    switch (name) {
      case 'tap':
        this.tone('square', 660, 660, t, 0.04, 0.08);
        break;
      case 'throw':
        this.hiss(t, 0.28, 1400, 300, 'bandpass', 0.35);
        break;
      case 'putt':
        this.hiss(t, 0.18, 1800, 600, 'bandpass', 0.25);
        break;
      case 'land':
        this.tone('sine', 110, 60, t, 0.12, 0.35);
        this.hiss(t, 0.08, 600, 200, 'lowpass', 0.2);
        break;
      case 'tree':
        this.tone('square', 180, 90, t, 0.07, 0.18);
        this.hiss(t, 0.1, 2500, 800, 'bandpass', 0.25);
        break;
      case 'chains':
        for (let i = 0; i < 12; i++) {
          const at = t + i * 0.028 + Math.random() * 0.012;
          this.tone('triangle', 2200 + Math.random() * 2600, 1800 + Math.random() * 1500, at, 0.07, 0.07);
        }
        this.hiss(t, 0.4, 6000, 3000, 'highpass', 0.08);
        break;
      case 'clank':
        // Metal tray or pole: a short ring with a dull knock under it.
        this.tone('square', 520, 470, t, 0.05, 0.12);
        this.tone('triangle', 1650, 1500, t, 0.18, 0.08);
        this.tone('sine', 140, 80, t, 0.08, 0.25);
        break;
      case 'splash':
        this.hiss(t, 0.45, 1600, 250, 'lowpass', 0.45);
        this.tone('sine', 300, 120, t, 0.2, 0.1);
        break;
      case 'skip':
        this.tone('sine', 900, 1400, t, 0.06, 0.2);
        this.hiss(t, 0.12, 2000, 900, 'bandpass', 0.15);
        break;
      case 'ob':
        this.tone('square', 220, 220, t, 0.1, 0.1);
        this.tone('square', 165, 165, t + 0.12, 0.16, 0.1);
        break;
      case 'good':
        [523, 659, 784, 1047].forEach((f, i) => this.tone('square', f, f, t + i * 0.08, 0.09, 0.09));
        break;
      case 'bad':
        this.tone('square', 330, 300, t, 0.12, 0.08);
        this.tone('square', 247, 220, t + 0.14, 0.2, 0.08);
        break;
    }
  }

  private tone(type: OscillatorType, f0: number, f1: number, t: number, dur: number, vol: number) {
    const c = this.ctx!;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private hiss(t: number, dur: number, f0: number, f1: number, type: BiquadFilterType, vol: number) {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(c.destination);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }
}

export const sfx = new Sfx();
