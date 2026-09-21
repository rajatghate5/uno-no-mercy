/**
 * Animation helpers.
 *
 * Lives inside the render boundary because it touches OpenTUI's timeline
 * engine (via ./runtime.js). The timeline is driven by the renderer's own
 * frame callback rather than a setInterval, so animations stay synced to
 * actual frames and never queue up faster than the terminal can draw.
 *
 * Every hook degrades to a finished value when animations are disabled, so
 * `ANIMATE=0` (or a narrow terminal) renders the same UI, just instantly.
 */

import { useEffect, useRef, useState } from 'react';
import { useTimeline } from './runtime.js';

export type Ease =
  | 'linear'
  | 'outQuad'
  | 'inOutQuad'
  | 'outExpo'
  | 'outBounce'
  | 'outBack'
  | 'outCirc'
  | 'outElastic';

/**
 * Global off-switch, for tests, CI, and anyone who finds motion distracting.
 *
 * Read lazily rather than captured at module load, so a test (or a runtime
 * toggle) can change it after the module has been imported.
 */
export function animationsEnabled(): boolean {
  return process.env.UNO_NO_ANIMATION !== '1';
}

/**
 * A 0 -> 1 progress value that replays whenever `trigger` changes.
 *
 * The animation is added to the timeline ONCE and replayed with restart();
 * re-adding on every trigger would pile up items on the same timeline.
 */
export function useTween(trigger: unknown, durationMs: number, ease: Ease = 'outQuad'): number {
  const timeline = useTimeline({ duration: durationMs, autoplay: false });
  const enabled = animationsEnabled();
  const holder = useRef({ t: enabled ? 0 : 1 });
  const [value, setValue] = useState(enabled ? 0 : 1);
  const added = useRef(false);

  useEffect(() => {
    if (!animationsEnabled()) return;
    if (!added.current) {
      added.current = true;
      timeline.add(holder.current, {
        t: 1,
        duration: durationMs,
        ease,
        onUpdate: () => setValue(holder.current.t),
        onComplete: () => setValue(1),
      });
    }
    holder.current.t = 0;
    setValue(0);
    timeline.restart();
    // `trigger` is the whole point: a new value replays the animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, timeline, durationMs, ease]);

  return enabled ? value : 1;
}

/**
 * A 0 -> 1 -> 0 oscillation while `active`, for drawing attention to a live
 * threat (an accumulating draw stack) without redrawing the whole table.
 */
export function usePulse(active: boolean, periodMs = 900): number {
  const timeline = useTimeline({ duration: periodMs, autoplay: false });
  const holder = useRef({ t: 0 });
  const [value, setValue] = useState(0);
  const added = useRef(false);

  useEffect(() => {
    if (!animationsEnabled() || !active) {
      setValue(0);
      return;
    }
    if (!added.current) {
      added.current = true;
      timeline.add(holder.current, {
        t: 1,
        duration: periodMs,
        ease: 'inOutQuad',
        loop: true,
        alternate: true,
        onUpdate: () => setValue(holder.current.t),
      });
    }
    timeline.restart();
    return () => {
      timeline.pause();
    };
  }, [active, timeline, periodMs]);

  return active && animationsEnabled() ? value : 0;
}

/**
 * Stagger: given a progress value and an item index, how far along is THIS
 * item? Used to deal cards in left-to-right rather than all at once.
 */
export function stagger(progress: number, index: number, count: number, overlap = 0.3): number {
  if (count <= 1) return progress;
  // Each item's window starts later but they overlap, so the deal flows.
  const step = (1 - overlap) / Math.max(1, count - 1);
  const start = index * step;
  const span = Math.max(0.0001, 1 - start);
  return clamp01((progress - start) / span);
}

export const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

export const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp01(t);

/** Interpolate two #rrggbb colours. Used for flashes and fades. */
export function lerpColor(from: string, to: string, t: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  if (!a || !b) return to;
  const k = clamp01(t);
  const mix = (i: number) => Math.round(a[i]! + (b[i]! - a[i]!) * k);
  return `#${[mix(0), mix(1), mix(2)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Flash: 0 -> 1 -> 0 over one tween, for a hit or an elimination.
 * Peaks early so the emphasis lands immediately and then decays.
 */
export function flashCurve(progress: number): number {
  const p = clamp01(progress);
  return p < 0.25 ? p / 0.25 : 1 - (p - 0.25) / 0.75;
}
