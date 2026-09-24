/**
 * The table: geometry, lighting and camera.
 *
 * Back Room. There is one tungsten lamp hanging over the middle of the table
 * and effectively nothing else, so the lighting here is not a three-point rig
 * dressed warm - it is a spotlight with a hard falloff, and the darkness at
 * the edges is the point rather than a side effect.
 *
 * The one concession is the floor light at the bottom of this file. With a
 * single lamp the far seats go to literal black, and a card you cannot see at
 * all is a bug rather than atmosphere. It is dim enough that the pool of
 * light still reads as the brightest thing by a distance.
 */

import {
  ACESFilmicToneMapping,
  AmbientLight,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PointLight,
  RepeatWrapping,
  Scene,
  SpotLight,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';

export const TABLE_RADIUS = 7.2;

/**
 * Felt, drawn procedurally.
 *
 * A flat colour reads as plastic under a moving light; the noise gives the
 * surface something for the key light to catch so it looks like cloth.
 */
function feltTexture(): CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable - cannot build the felt texture');

  // Worn baize, not a poker-room green. Under a tungsten bulb this reads
  // closer to olive than to emerald, which is the intention.
  ctx.fillStyle = '#16271e';
  ctx.fillRect(0, 0, size, size);

  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    // Fine per-pixel grain, biased dark so the felt does not sparkle.
    const n = (Math.random() - 0.62) * 26;
    d[i] = Math.max(0, Math.min(255, d[i]! + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! + n));
  }
  ctx.putImageData(img, 0, 0);

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(6, 6);
  return tex;
}

export interface Stage {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  resize: () => void;
  dispose: () => void;
}

/**
 * Is WebGL actually available?
 *
 * Not a given. Privacy-hardened browsers disable it, older iOS falls back to
 * software or refuses outright, and a blocklisted GPU takes it away on any
 * platform. Asking first lets the caller say so instead of throwing from the
 * constructor and leaving a black page.
 */
export function webglAvailable(): boolean {
  try {
    const probe = document.createElement('canvas');
    return !!(probe.getContext('webgl2') ?? probe.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * Pixel-ratio cap.
 *
 * A 3x phone asks for NINE times the pixels of a 1x one, and with a shadow map
 * on top that is how an iPhone loses its WebGL context mid-game. Phones are
 * capped harder than desktops on purpose - this used to read `portrait ? 2 : 2`,
 * which is to say it was not capping anything.
 */
function pixelRatioCap(portrait: boolean): number {
  return Math.min(window.devicePixelRatio, portrait ? 1.75 : 2);
}

export function createStage(canvas: HTMLCanvasElement): Stage {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(pixelRatioCap(window.innerWidth < window.innerHeight));
  renderer.shadowMap.enabled = true;
  // PCFSoftShadowMap was removed in three 0.186; PCFShadowMap is the
  // supported soft-ish filter now.
  renderer.shadowMap.type = PCFShadowMap;
  // Filmic tone mapping keeps the saturated card colours from clipping to
  // flat blocks under the key light.
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.outputColorSpace = SRGBColorSpace;

  const scene = new Scene();
  scene.background = new Color('#0a0907');
  /*
   * Fog pulled in much closer than it used to be. It is no longer hiding the
   * table edge - the falloff already does that - it is putting a room around
   * the table by making everything past the lamp's reach go to nothing.
   */
  scene.fog = new Fog('#0a0907', 10, 25);

  const camera = new PerspectiveCamera(42, 1, 0.1, 100);
  // Seated at the table, leaning in: high enough to see every hand, low
  // enough that cards have perspective rather than reading as a flat map.
  camera.position.set(0, 8.9, 7.9);
  camera.lookAt(0, 0, -0.75);

  // --- table ---------------------------------------------------------------
  const felt = new Mesh(
    new CircleGeometry(TABLE_RADIUS, 96),
    new MeshStandardMaterial({ map: feltTexture(), roughness: 0.96, metalness: 0 }),
  );
  felt.rotation.x = -Math.PI / 2;
  felt.receiveShadow = true;
  scene.add(felt);

  // A padded rim, so the felt ends in something instead of a hard edge.
  const rim = new Mesh(
    new CylinderGeometry(TABLE_RADIUS + 0.42, TABLE_RADIUS + 0.42, 0.42, 96, 1, true),
    new MeshStandardMaterial({ color: '#2b1a12', roughness: 0.82, metalness: 0.04 }),
  );
  rim.position.y = -0.21;
  rim.receiveShadow = true;
  scene.add(rim);

  const underside = new Mesh(
    new CircleGeometry(TABLE_RADIUS + 0.42, 96),
    new MeshStandardMaterial({ color: '#180e0a', roughness: 0.92 }),
  );
  underside.rotation.x = Math.PI / 2;
  underside.position.y = -0.42;
  scene.add(underside);

  // --- lighting ------------------------------------------------------------
  /*
   * Ambient is nearly off. Anything above about 0.3 here flattens the pool of
   * light into an evenly-lit table, which is the look this direction exists
   * to get away from.
   */
  scene.add(new AmbientLight('#2e2418', 0.22));
  scene.add(new HemisphereLight('#4a3a22', '#0a0f0b', 0.16));

  /*
   * The lamp. A spotlight rather than a directional, because a directional
   * light has no falloff and so cannot make a pool - it lights the whole
   * table evenly no matter where it is put.
   *
   * The cone has to be NARROWER than the table or there is no pool to see:
   * at 9.4 units up, an angle of 0.56 throws a circle about 12 across on a
   * table 14.4 across, so the felt has a lit middle and a falling-off edge.
   * An earlier 0.66 lit the whole table evenly, which is exactly the look
   * this direction exists to get away from.
   *
   * penumbra softens the edge of the pool so it does not read as a stencil,
   * and decay 1.5 is deliberately gentler than physical 2: at true inverse
   * square the far seats vanish before the fog has a chance to take them.
   *
   * The bulb is only lightly warmed. Pushing it further orange tinted the
   * card faces, and a yellow that reads as mustard is a gameplay bug - you
   * pick cards by colour.
   */
  const lamp = new SpotLight('#ffdfb4', 230, 26, 0.56, 0.82, 1.5);
  lamp.position.set(0, 9.4, 1.1);
  lamp.target.position.set(0, 0, -0.4);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(2048, 2048);
  lamp.shadow.camera.near = 2;
  lamp.shadow.camera.far = 26;
  // Without a bias, cards self-shadow into dark bands at this thickness.
  lamp.shadow.bias = -0.0006;
  lamp.shadow.normalBias = 0.02;
  scene.add(lamp);
  scene.add(lamp.target);

  // The pile the lamp hangs over. Small and close, so the discard is the
  // brightest object on the table and you never hunt for where play is.
  const centre = new PointLight('#ffdca8', 4.5, 8, 2.1);
  centre.position.set(0, 2.4, 0);
  scene.add(centre);

  /*
   * The near edge.
   *
   * Your own hand sits outside the lamp's pool, and lit by the pool alone the
   * outer cards of the fan came out noticeably darker than the middle ones.
   * That directly fights the one signal this direction cannot afford to be
   * ambiguous about - a playable card is a LIT card - because the falloff and
   * the rule were saying the same thing in the same language.
   *
   * So the hand gets its own light: wide, soft, and even across the whole
   * arc, leaving the material tint as the only thing that varies along it.
   */
  const nearEdge = new SpotLight('#ffeedc', 30, 19, 0.74, 0.92, 1.0);
  nearEdge.position.set(0, 6.4, 8.4);
  nearEdge.target.position.set(0, 0, 4.4);
  scene.add(nearEdge);
  scene.add(nearEdge.target);

  /*
   * The floor. Dim, warm, from behind the camera, and the reason a card in
   * shadow is still a card rather than a black rectangle. This is the
   * brightness floor that makes the direction usable on a phone outdoors.
   */
  const floor = new DirectionalLight('#c9b094', 0.30);
  floor.position.set(1.5, 4.5, 10);
  scene.add(floor);

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const portrait = w / h < 1;

    renderer.setSize(w, h, false);
    renderer.setPixelRatio(pixelRatioCap(portrait));
    // Soft shadows are the most expensive thing on the table; a phone gets a
    // smaller map rather than none, so cards still sit on the felt.
    if (lamp.shadow.mapSize.width !== (portrait ? 1024 : 2048)) {
      lamp.shadow.mapSize.set(portrait ? 1024 : 2048, portrait ? 1024 : 2048);
      // Dispose the old render target; three allocates a new one at the new
      // size on the next frame.
      lamp.shadow.map?.dispose();
      lamp.shadow.map = null as unknown as typeof lamp.shadow.map;
    }

    camera.aspect = w / h;
    /*
     * Portrait needs a wider lens AND more distance.
     *
     * Pulling the camera IN, which is what it used to do, made the frame
     * narrower in world terms - and a phone's problem is that the table is
     * too wide for the frame, not too small in it. The side seats ended up
     * outside the frustum with nothing but a floating name label on screen.
     * Backing off and opening up costs some card size and fits the table.
     */
    camera.fov = portrait ? 62 : 42;
    camera.position.set(0, portrait ? 10.5 : 8.9, portrait ? 8.6 : 7.9);
    camera.lookAt(0, 0, portrait ? -0.4 : -0.75);
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  /*
   * A lost context is a black canvas until something asks for it back.
   * preventDefault() is what makes the browser willing to restore one at all;
   * without it the page just stays dark and looks like a crash.
   */
  const onLost = (e: Event) => e.preventDefault();
  const onRestored = () => resize();
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  return {
    renderer,
    scene,
    camera,
    resize,
    dispose() {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      renderer.dispose();
    },
  };
}
