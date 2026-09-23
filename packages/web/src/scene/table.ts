/**
 * The table: geometry, lighting and camera.
 *
 * Lighting is the whole reason this reads as "real cards" rather than
 * "textured rectangles": one warm key light casting genuine shadows, a cool
 * fill so the shadow side is not dead, and a broad ambient so card faces stay
 * legible no matter which way they are turned.
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

  ctx.fillStyle = '#0f4d33';
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

export function createStage(canvas: HTMLCanvasElement): Stage {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  // PCFSoftShadowMap was removed in three 0.186; PCFShadowMap is the
  // supported soft-ish filter now.
  renderer.shadowMap.type = PCFShadowMap;
  // Filmic tone mapping keeps the saturated card colours from clipping to
  // flat blocks under the key light.
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = SRGBColorSpace;

  const scene = new Scene();
  scene.background = new Color('#0a0a10');
  // Fog hides the table edge without needing walls or a room.
  scene.fog = new Fog('#0a0a10', 16, 34);

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
    new MeshStandardMaterial({ color: '#3a2318', roughness: 0.75, metalness: 0.05 }),
  );
  rim.position.y = -0.21;
  rim.receiveShadow = true;
  scene.add(rim);

  const underside = new Mesh(
    new CircleGeometry(TABLE_RADIUS + 0.42, 96),
    new MeshStandardMaterial({ color: '#241510', roughness: 0.9 }),
  );
  underside.rotation.x = Math.PI / 2;
  underside.position.y = -0.42;
  scene.add(underside);

  // --- lighting ------------------------------------------------------------
  scene.add(new AmbientLight('#8993b5', 0.5));
  scene.add(new HemisphereLight('#cfe3ff', '#20301f', 0.45));

  // Key light: warm, high, slightly off-axis so shadows fall across the table
  // rather than straight back from the camera.
  const key = new DirectionalLight('#fff0d6', 2.15);
  key.position.set(-5.5, 12, 4.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 32;
  key.shadow.camera.left = -11;
  key.shadow.camera.right = 11;
  key.shadow.camera.top = 11;
  key.shadow.camera.bottom = -11;
  // Without a bias, cards self-shadow into dark bands at this thickness.
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  // Cool fill from the opposite side, so shadowed faces stay readable.
  const fill = new DirectionalLight('#9fc4ff', 0.55);
  fill.position.set(6.5, 7, -5);
  scene.add(fill);

  // A soft pool over the discard pile, to draw the eye to where play happens.
  const centre = new PointLight('#ffdca8', 26, 14, 2.2);
  centre.position.set(0, 4.2, 0);
  scene.add(centre);

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const portrait = w / h < 1;

    renderer.setSize(w, h, false);
    // Cap the pixel ratio harder on phones: a 3x device renders nine times the
    // pixels, which is the difference between 60fps and a slideshow.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, portrait ? 2 : 2));
    // Soft shadows are the most expensive thing on the table; a phone gets a
    // smaller map rather than none, so cards still sit on the felt.
    if (key.shadow.mapSize.width !== (portrait ? 1024 : 2048)) {
      key.shadow.mapSize.set(portrait ? 1024 : 2048, portrait ? 1024 : 2048);
      // Dispose the old render target; three allocates a new one at the new
      // size on the next frame.
      key.shadow.map?.dispose();
      key.shadow.map = null as unknown as typeof key.shadow.map;
    }

    camera.aspect = w / h;
    // A narrow screen needs a wider lens, and the camera pulled in, or the
    // frame is mostly empty felt with the table stranded in the middle.
    camera.fov = portrait ? 56 : 42;
    camera.position.set(0, portrait ? 8.0 : 8.9, portrait ? 6.6 : 7.9);
    camera.lookAt(0, 0, portrait ? -0.2 : -0.75);
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  return {
    renderer,
    scene,
    camera,
    resize,
    dispose() {
      window.removeEventListener('resize', resize);
      renderer.dispose();
    },
  };
}
