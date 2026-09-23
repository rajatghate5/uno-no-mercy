/**
 * A tiny tween system.
 *
 * Three has no animation scheduler of its own for ad-hoc object motion, and a
 * full library is overkill for "move this card there and flip it". Tweens are
 * driven from the render loop, so they stay in lockstep with the frame rate
 * and pause automatically when the tab is backgrounded.
 */

export type Easing = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outElastic: (t: number) => {
    if (t === 0 || t === 1) return t;
    const c4 = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  outQuint: (t: number) => 1 - Math.pow(1 - t, 5),
} satisfies Record<string, Easing>;

interface Tween {
  elapsed: number;
  duration: number;
  delay: number;
  easing: Easing;
  onUpdate: (t: number) => void;
  onComplete?: (() => void) | undefined;
  /** Tweens sharing a key replace each other, so a re-layout never fights itself. */
  key?: string | undefined;
  done: boolean;
}

export class Animator {
  private tweens: Tween[] = [];

  tween(opts: {
    duration: number;
    onUpdate: (t: number) => void;
    delay?: number;
    easing?: Easing;
    onComplete?: () => void;
    key?: string;
  }): void {
    // Replacing by key prevents two layouts animating the same card at once,
    // which otherwise reads as a card jittering between two destinations.
    if (opts.key) this.tweens = this.tweens.filter((t) => t.key !== opts.key);
    this.tweens.push({
      elapsed: 0,
      duration: Math.max(1, opts.duration),
      delay: opts.delay ?? 0,
      easing: opts.easing ?? ease.outCubic,
      onUpdate: opts.onUpdate,
      onComplete: opts.onComplete,
      key: opts.key,
      done: false,
    });
  }

  /** True while anything is still moving; used to keep the log in step. */
  get busy(): boolean {
    return this.tweens.length > 0;
  }

  cancel(key: string): void {
    this.tweens = this.tweens.filter((t) => t.key !== key);
  }

  clear(): void {
    this.tweens = [];
  }

  update(dtMs: number): void {
    if (this.tweens.length === 0) return;
    for (const t of this.tweens) {
      if (t.delay > 0) {
        t.delay -= dtMs;
        if (t.delay > 0) continue;
      }
      t.elapsed += dtMs;
      const raw = Math.min(1, t.elapsed / t.duration);
      t.onUpdate(t.easing(raw));
      if (raw >= 1) {
        t.done = true;
        t.onComplete?.();
      }
    }
    this.tweens = this.tweens.filter((t) => !t.done);
  }
}
