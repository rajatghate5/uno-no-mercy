/**
 * The reconciler: turns RedactedState into what is on the table.
 *
 * This is the only place that knows both about game state and about Three
 * objects. Everything it does is a diff: given the state the server (or the
 * local game) says is true, move what exists, spawn what is new, retire what
 * is gone - and animate the difference rather than snapping to it.
 *
 * Meshes are keyed so they survive across updates. That is what lets a card
 * the player is holding become the card on the discard pile, instead of one
 * vanishing and an unrelated one appearing.
 */

import { Group, Raycaster, Vector2, Vector3, type Scene } from 'three';
import type { Card, GameEvent, RedactedState } from '@uno/engine';
import { Animator, ease } from './anim.js';
import { makeCard, revealCard, type CardObject } from './card3d.js';
import {
  discardTransform,
  drawTransform,
  opponentHandLayout,
  ownHandLayout,
  seatAngle,
  seatSpawn,
  type Transform,
} from './layout.js';

const DEAL_MS = 380;
const MOVE_MS = 300;
const PLAY_MS = 460;

/** How many face-down cards to actually render for a pile. */
const MAX_PILE_MESHES = 14;
const MAX_DISCARD_MESHES = 8;

interface Held {
  mesh: CardObject;
  /** Where it is meant to be, so we do not re-tween to the same place. */
  target?: Transform;
}

export class TableView {
  readonly root = new Group();
  readonly animator = new Animator();

  private held = new Map<string, Held>();
  private raycaster = new Raycaster();
  private pointer = new Vector2();

  /** Index into the viewer's hand that is currently raised. */
  selected = -1;
  private lastHandIds: string[] = [];
  private seatCount = 0;
  private viewerIndex = 0;
  private dealt = false;

  constructor(private readonly scene: Scene) {
    scene.add(this.root);
  }

  dispose(): void {
    for (const { mesh } of this.held.values()) this.root.remove(mesh);
    this.held.clear();
    this.scene.remove(this.root);
  }

  /** Reset between games so the next deal starts from an empty table. */
  reset(): void {
    this.animator.clear();
    for (const { mesh } of this.held.values()) this.root.remove(mesh);
    this.held.clear();
    this.lastHandIds = [];
    this.selected = -1;
    this.dealt = false;
  }

  // --- helpers -------------------------------------------------------------

  private place(mesh: CardObject, t: Transform): void {
    mesh.position.set(t.pos[0], t.pos[1], t.pos[2]);
    mesh.rotation.set(t.rot[0], t.rot[1], t.rot[2]);
  }

  private moveTo(
    key: string,
    mesh: CardObject,
    to: Transform,
    opts: { duration?: number; delay?: number; arc?: number; easing?: typeof ease.outCubic } = {},
  ): void {
    const from = {
      pos: [mesh.position.x, mesh.position.y, mesh.position.z] as [number, number, number],
      rot: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z] as [number, number, number],
    };
    const arc = opts.arc ?? 0;

    this.animator.tween({
      key,
      duration: opts.duration ?? MOVE_MS,
      delay: opts.delay ?? 0,
      easing: opts.easing ?? ease.outCubic,
      onUpdate: (t) => {
        mesh.position.set(
          from.pos[0] + (to.pos[0] - from.pos[0]) * t,
          // A card thrown across the table rises and falls; a straight lerp
          // reads as sliding, which is what a physical card never does.
          from.pos[1] + (to.pos[1] - from.pos[1]) * t + Math.sin(t * Math.PI) * arc,
          from.pos[2] + (to.pos[2] - from.pos[2]) * t,
        );
        mesh.rotation.set(
          from.rot[0] + shortestAngle(from.rot[0], to.rot[0]) * t,
          from.rot[1] + shortestAngle(from.rot[1], to.rot[1]) * t,
          from.rot[2] + shortestAngle(from.rot[2], to.rot[2]) * t,
        );
      },
    });
  }

  private ensure(key: string, card: Card | null): Held {
    const hit = this.held.get(key);
    if (hit) {
      // A card we were showing face-down is now known: swap its face rather
      // than replacing the mesh, so it can keep animating uninterrupted.
      if (card && !hit.mesh.userData.card) revealCard(hit.mesh, card);
      return hit;
    }
    const mesh = makeCard(card, key);
    this.root.add(mesh);
    const held: Held = { mesh };
    this.held.set(key, held);
    return held;
  }

  private retire(key: string): void {
    const held = this.held.get(key);
    if (!held) return;
    this.held.delete(key);
    this.animator.cancel(key);
    const mesh = held.mesh;
    // Fade out by sinking into the felt, then remove.
    this.animator.tween({
      duration: 220,
      onUpdate: (t) => {
        mesh.position.y -= t * 0.02;
        mesh.scale.setScalar(1 - t * 0.35);
      },
      onComplete: () => this.root.remove(mesh),
    });
  }

  // --- the update ----------------------------------------------------------

  update(state: RedactedState, events: GameEvent[], aspect: number): void {
    this.seatCount = state.players.length;
    this.viewerIndex = state.players.findIndex((p) => p.id === state.viewer);
    if (this.viewerIndex < 0) this.viewerIndex = 0;

    const live = new Set<string>();

    // A card played this tick should fly from its owner's seat, so spawn it
    // there BEFORE the discard layout puts it in the middle.
    for (const e of events) {
      if (e.type !== 'cardPlayed') continue;
      const idx = state.players.findIndex((p) => p.id === e.player);
      if (idx < 0) continue;
      const key = `discard-${e.card.id}`;
      if (this.held.has(key)) continue;
      const held = this.ensure(key, e.card);
      const angle = seatAngle(idx, this.viewerIndex, this.seatCount);
      this.place(held.mesh, seatSpawn(angle, e.player === state.viewer));
    }

    this.layoutOwnHand(state, aspect, live);
    this.layoutOpponents(state, live);
    this.layoutDiscard(state, live);
    this.layoutDrawPile(state, live);

    for (const key of [...this.held.keys()]) {
      if (!live.has(key)) this.retire(key);
    }

    this.dealt = true;
  }

  private layoutOwnHand(state: RedactedState, aspect: number, live: Set<string>): void {
    const me = state.players.find((p) => p.id === state.viewer);
    const hand = me?.hand ?? [];

    // A spectator has no hand; nothing to lay out.
    if (hand.length === 0) {
      this.lastHandIds = [];
      return;
    }

    if (this.selected >= hand.length) this.selected = hand.length - 1;
    const targets = ownHandLayout(hand.length, this.selected, aspect);
    const isFirstDeal = !this.dealt;

    hand.forEach((card, i) => {
      const key = `hand-${card.id}`;
      live.add(key);
      const isNew = !this.held.has(key);
      const held = this.ensure(key, card);
      const target = targets[i]!;

      if (isNew) {
        // New cards arrive from the draw pile, face-down, and flip as they come.
        const from = drawTransform(6);
        this.place(held.mesh, { pos: [from.pos[0], from.pos[1] + 0.2, from.pos[2]], rot: from.rot });
        this.moveTo(key, held.mesh, target, {
          duration: isFirstDeal ? DEAL_MS : MOVE_MS + 80,
          // Stagger only the opening deal; a mid-game draw should feel instant.
          delay: isFirstDeal ? i * 85 : 0,
          arc: 0.75,
          easing: ease.outQuint,
        });
      } else {
        this.moveTo(key, held.mesh, target, { duration: 190 });
      }
    });

    this.lastHandIds = hand.map((c) => c.id);
  }

  private layoutOpponents(state: RedactedState, live: Set<string>): void {
    state.players.forEach((p, idx) => {
      if (p.id === state.viewer) return;
      const angle = seatAngle(idx, this.viewerIndex, this.seatCount);
      // Cap the rendered fan: nobody can read 25 overlapping cards anyway,
      // and the count is shown numerically in the HUD.
      const shown = Math.min(p.handCount, 12);
      const targets = opponentHandLayout(shown, angle);

      for (let i = 0; i < shown; i++) {
        const key = `opp-${p.id}-${i}`;
        live.add(key);
        const isNew = !this.held.has(key);
        const held = this.ensure(key, null);
        const target = targets[i]!;
        if (isNew) {
          const from = drawTransform(6);
          this.place(held.mesh, from);
          this.moveTo(key, held.mesh, target, { duration: DEAL_MS, delay: i * 40, arc: 0.6 });
        } else {
          this.moveTo(key, held.mesh, target, { duration: 200 });
        }
      }
    });
  }

  private layoutDiscard(state: RedactedState, live: Set<string>): void {
    const top = state.discardTop;
    if (!top) return;
    const key = `discard-${top.id}`;
    live.add(key);
    const held = this.ensure(key, top);
    const depth = Math.min(state.discardCount, MAX_DISCARD_MESHES);
    this.moveTo(key, held.mesh, discardTransform(depth, hashId(top.id)), {
      duration: PLAY_MS,
      arc: 0.9,
      easing: ease.outQuint,
    });

    // Keep a few older cards underneath so the pile has visible depth.
    for (let i = 1; i < Math.min(MAX_DISCARD_MESHES, state.discardCount); i++) {
      const stackKey = `pile-${i}`;
      live.add(stackKey);
      const stack = this.ensure(stackKey, null);
      this.place(stack.mesh, discardTransform(depth - i, i * 7.3));
    }
  }

  private layoutDrawPile(state: RedactedState, live: Set<string>): void {
    const n = Math.min(state.drawPileCount, MAX_PILE_MESHES);
    for (let i = 0; i < n; i++) {
      const key = `draw-${i}`;
      live.add(key);
      const held = this.ensure(key, null);
      this.place(held.mesh, drawTransform(i));
    }
  }

  // --- interaction ---------------------------------------------------------

  /** Which hand index is under the pointer, or -1. */
  pick(clientX: number, clientY: number, camera: THREE_Camera): number {
    this.pointer.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, camera);

    const meshes = this.lastHandIds
      .map((id) => this.held.get(`hand-${id}`)?.mesh)
      .filter((m): m is CardObject => !!m);

    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) return -1;
    const id = (hits[0]!.object as CardObject).userData.cardId.replace(/^hand-/, '');
    return this.lastHandIds.indexOf(id);
  }

  /** World position of a hand card, for anchoring HTML labels to it. */
  handCardPosition(index: number): Vector3 | null {
    const id = this.lastHandIds[index];
    if (!id) return null;
    const mesh = this.held.get(`hand-${id}`)?.mesh;
    return mesh ? mesh.position.clone() : null;
  }
}

/** Three's Camera type, imported structurally to avoid a value import here. */
type THREE_Camera = Parameters<Raycaster['setFromCamera']>[1];

/** Deterministic 0..1 from a card id, so a pile's jitter never re-rolls. */
function hashId(id: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** Rotate the short way round, so a card never spins 350 degrees to reach -10. */
function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
