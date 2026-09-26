/**
 * A card as a 3D object.
 *
 * Geometry is a thin box: BoxGeometry gives each of the six faces its own
 * 0..1 UV square and its own material slot, which is exactly what a two-sided
 * card needs. The rounded-corner silhouette is painted into the texture rather
 * than modelled - at 2mm thickness the square edge is invisible at table
 * angles, and it saves carrying custom UV remapping for an extruded shape.
 */

import {
  BoxGeometry,
  Mesh,
  MeshStandardMaterial,
  type Texture,
} from 'three';
import type { Card } from '@mercy/engine';
import { backFaceTexture, faceTexture } from './cardArt.js';

/** World units. The table is ~10 across, so a card is ~1.0 x 1.5. */
export const CARD_W = 1.0;
export const CARD_H = 1.5;
export const CARD_T = 0.02;

const geometry = new BoxGeometry(CARD_W, CARD_H, CARD_T);

/** The paper edge. Shared by every card - it never varies. */
const edgeMaterial = new MeshStandardMaterial({
  color: '#efeae0',
  roughness: 0.85,
  metalness: 0,
});

const backMaterialCache = new WeakMap<Texture, MeshStandardMaterial>();
const faceMaterialCache = new WeakMap<Texture, MeshStandardMaterial>();

function faceMaterial(tex: Texture): MeshStandardMaterial {
  const hit = faceMaterialCache.get(tex);
  if (hit) return hit;
  const mat = new MeshStandardMaterial({
    map: tex,
    // Cards are printed stock: mostly matte with a faint sheen, no metal.
    roughness: 0.62,
    metalness: 0.02,
  });
  faceMaterialCache.set(tex, mat);
  return mat;
}

function backMaterial(): MeshStandardMaterial {
  const tex = backFaceTexture();
  const hit = backMaterialCache.get(tex);
  if (hit) return hit;
  const mat = new MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0.02 });
  backMaterialCache.set(tex, mat);
  return mat;
}

export interface CardObject extends Mesh {
  userData: {
    cardId: string;
    /** Set when this mesh represents a known card rather than a face-down one. */
    card?: Card;
    /** Index within whatever pile or hand currently owns it. */
    slot?: number;
    /** Set while the card is the player's hover/selection target. */
    hovered?: boolean;
  };
}

/**
 * Build a card mesh.
 *
 * BoxGeometry material order is [+x, -x, +y, -y, +z, -z], so slot 4 is the
 * front face and slot 5 the back.
 */
export function makeCard(card: Card | null, id: string): CardObject {
  const front = card ? faceMaterial(faceTexture(card)) : backMaterial();
  // Mesh.userData starts as an untyped record, so the narrowing cast has to
  // pass through unknown; the very next line gives it the required shape.
  const mesh = new Mesh(geometry, [
    edgeMaterial,
    edgeMaterial,
    edgeMaterial,
    edgeMaterial,
    front,
    backMaterial(),
  ]) as unknown as CardObject;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { cardId: id, ...(card ? { card } : {}) };
  return mesh;
}

/**
 * Put a card in the light, or leave it in shadow.
 *
 * This is the Back Room direction's one rule made literal: a card you can
 * play catches the lamp, a card you cannot sits in the dark. It replaces the
 * usual grey-overlay dimming, and it is better than one because it does not
 * need explaining - you already know what a lit object means.
 *
 * Face materials are shared per texture so the deck only rasterises each face
 * once, which means tinting one card would tint every copy of it. The first
 * call therefore clones this mesh its own front material. Only cards in the
 * viewer's hand are ever lit or shadowed, so that is at most a couple of
 * dozen extra materials, not a deck's worth.
 */
export function setCardLit(mesh: CardObject, lit: boolean): void {
  const mats = mesh.material as MeshStandardMaterial[];
  const front = mats[4]!;
  let own = front;
  if (!front.userData.ownedBy) {
    own = front.clone();
    own.userData.ownedBy = mesh.userData.cardId;
    mats[4] = own;
  }
  /*
   * A multiplier on the map, not an opacity: a shadowed card is still opaque
   * card stock, so it keeps its own shadow and its own edge.
   *
   * The number was arrived at by looking rather than by taste. Anything
   * above about 0.4 survives tone mapping as "a slightly duller red" instead
   * of "in shadow", which is not a signal you can act on at a glance; much
   * below 0.2 and a card you cannot play becomes a card you cannot READ,
   * which costs you the information you need to plan the turn after this
   * one. 0.26 is dark enough to sort the hand in one look and light enough
   * to still say which card it is.
   */
  own.color.setScalar(lit ? 1 : 0.26);
  /*
   * No emissive on the lit ones.
   *
   * A warm glow was the obvious way to say "this card is in the light", and
   * it turned every red in the hand salmon: emissive ADDS, and adding warm
   * light to #d7263d walks it straight toward pink. Under this lamp the deck
   * only has to stay its own colour, which the multiplier alone manages.
   */
  own.emissive.setHex(0x000000);
}

/** Drop a per-mesh material clone, if this mesh was given one. */
export function releaseCardMaterial(mesh: CardObject): void {
  const mats = mesh.material as MeshStandardMaterial[];
  const front = mats[4];
  if (front?.userData.ownedBy) front.dispose();
}

/** Swap a face-down card to a known face, for when a card is revealed. */
export function revealCard(mesh: CardObject, card: Card): void {
  const mats = mesh.material as MeshStandardMaterial[];
  mats[4] = faceMaterial(faceTexture(card));
  mesh.userData.card = card;
}
