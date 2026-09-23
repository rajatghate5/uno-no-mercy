/**
 * Sound, synthesised with Web Audio.
 *
 * No audio files: every cue is a short synthesised envelope, which keeps the
 * build asset-free and means a cue can never be missing or slow to load.
 *
 * Browsers refuse to start an AudioContext before a user gesture, so the
 * context is created lazily on the first cue AFTER the first interaction and
 * every call is a no-op until then.
 */

export type Cue = 'deal' | 'play' | 'draw' | 'bigHit' | 'eliminate' | 'win' | 'lose' | 'turn';

export class Sound {
  private ctx: AudioContext | null = null;

  constructor(public enabled = true) {}

  toggle(): boolean {
    this.enabled = !this.enabled;
    if (this.enabled) this.resume();
    return this.enabled;
  }

  /** Call from a click/keydown handler so the context is allowed to start. */
  resume(): void {
    try {
      this.ctx ??= new AudioContext();
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      // No Web Audio: the game is perfectly playable silent.
    }
  }

  play(cue: Cue): void {
    if (!this.enabled) return;
    try {
      this.ctx ??= new AudioContext();
      if (this.ctx.state === 'suspended') return; // still awaiting a gesture
      switch (cue) {
        case 'deal':
          return this.noise(0.05, 1400, 0.1);
        case 'draw':
          return this.noise(0.07, 1000, 0.14);
        case 'play':
          // A card hitting felt: a short filtered click, not a tone.
          return this.noise(0.09, 700, 0.2);
        case 'turn':
          return this.tone(660, 0.1, 'sine', 0.1);
        case 'bigHit':
          this.tone(150, 0.26, 'sawtooth', 0.16);
          return this.noise(0.22, 400, 0.2);
        case 'eliminate':
          this.tone(210, 0.16, 'square', 0.12);
          window.setTimeout(() => this.tone(140, 0.34, 'square', 0.13), 110);
          return;
        case 'win':
          [523, 659, 784, 1047].forEach((f, i) =>
            window.setTimeout(() => this.tone(f, 0.24, 'triangle', 0.13), i * 95),
          );
          return;
        case 'lose':
          [392, 330, 262].forEach((f, i) =>
            window.setTimeout(() => this.tone(f, 0.3, 'triangle', 0.12), i * 130),
          );
          return;
      }
    } catch {
      // Audio is decoration; never let it interrupt a game.
    }
  }

  private tone(freq: number, seconds: number, type: OscillatorType, gain: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(0.0001, ctx.currentTime);
    amp.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + seconds);
    osc.connect(amp).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + seconds + 0.02);
  }

  /** Filtered white noise - the basis of every card/paper sound here. */
  private noise(seconds: number, cutoff: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const frames = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      // Decay the noise across the buffer so it reads as a hit, not a hiss.
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const amp = ctx.createGain();
    amp.gain.value = gain;
    src.connect(filter).connect(amp).connect(ctx.destination);
    src.start();
  }
}
