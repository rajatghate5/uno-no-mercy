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

/**
 * Safari shipped Web Audio behind a vendor prefix for years and still exposes
 * the prefixed constructor. Resolve it once rather than at every call site.
 */
function audioContextCtor(): typeof AudioContext | undefined {
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext;
}

export class Sound {
  private ctx: AudioContext | null = null;

  constructor(public enabled = true) {}

  /**
   * Create the context if we can.
   *
   * Separated from resume() because WebKit is strict about WHERE this happens:
   * a context constructed outside a user gesture starts suspended and stays
   * that way, so the first construction has to ride on a real tap.
   */
  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = audioContextCtor();
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
    } catch {
      return null;
    }
    return this.ctx;
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    if (this.enabled) this.resume();
    return this.enabled;
  }

  /**
   * Call from a click/keydown handler so the context is allowed to start.
   *
   * On iOS this must run INSIDE the gesture - a resume() scheduled from a
   * promise or a timeout is ignored, which is how a build ends up silent on
   * iPhone while working everywhere else.
   */
  resume(): void {
    const ctx = this.ensure();
    if (!ctx) return; // No Web Audio: the game is perfectly playable silent.
    if (ctx.state === 'suspended') void ctx.resume();
  }

  play(cue: Cue): void {
    if (!this.enabled) return;
    try {
      const ctx = this.ensure();
      if (!ctx) return;
      if (ctx.state === 'suspended') {
        // Ask once more - Safari sometimes suspends again after a tab switch -
        // but drop this cue rather than queue it.
        void ctx.resume();
        return;
      }
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
