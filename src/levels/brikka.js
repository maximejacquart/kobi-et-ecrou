// Planète 1 — Brikka : le Canyon des Casseurs (désert de ferraille au soleil couchant).
import * as THREE from 'three';
import { lights } from '../engine/lightpool.js';
import { sandTexture, rockTexture } from '../engine/textures.js';
import { fbm2, distToPolyline, smooth, clamp, lerp, rng, dampAngle, damp } from '../engine/util.js';
import { rock, container, barrel, lamp, windmill, bunting, kobiShip, propMats } from '../models/environment/props.js';
import { mesa, scrapPile, cactus, tireStack, shack, carcass, voraxVacuum, plankBridge, palm, reeds, lilyPads, stringLights, fireBarrel, floodlight, beacon, waterTower, leakPipe, tireAt, dock, railBarrier, garlandPost, lintel } from '../models/environment/canyon.js';
import { createWater, createWaterfall } from '../engine/water/water.js';
import { mtx } from '../models/geo.js';
import { CylinderCollider } from '../engine/physics.js';
import { Arena } from '../game/arena.js';
import { shipExit } from './common.js';
import { boxUV } from './level.js';
import { grassField, motes } from '../models/nature.js';
import { createEcrou } from '../models/hero.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const PATH = [[0, -40], [0, 30], [12, 70], [8, 110], [-6, 150], [-4, 186], [8, 240], [20, 300], [18, 340], [12, 380], [10, 420], [10, 480]];
// la Casse aux épaves : cul-de-sac derrière une barricade à verrou magnétique
const CASSE = [[-1, 95], [-16, 97], [-30, 105], [-38, 116]];

function halfWidth(z) {
  const k = [[-40, 13], [100, 13], [125, 20], [185, 20], [200, 26], [300, 28], [380, 26], [395, 30], [480, 30]];
  for (let i = 0; i < k.length - 1; i++) {
    if (z <= k[i + 1][0]) {
      const t = clamp((z - k[i][0]) / (k[i + 1][0] - k[i][0]), 0, 1);
      return lerp(k[i][1], k[i + 1][1], smooth(t));
    }
  }
  return 30;
}
function floorAt(x, z) {
  let f = 0;
  if (z > 112) f = lerp(0, 3, smooth(clamp((z - 112) / 14, 0, 1)));
  // gouffre des rails et des mesas
  const chasm = smooth(clamp((z - 189) / 4, 0, 1)) * (1 - smooth(clamp((z - 383) / 4, 0, 1)));
  f = lerp(f, -55, chasm);
  if (z > 385) f = lerp(f, 2, smooth(clamp((z - 383) / 4, 0, 1)));
  return f;
}
function dunes(x, z) {
  let amp = 1.4;
  // zones aplanies
  if (z > 120 && z < 190) amp = 0.25;
  if (z > 386) amp = 0.3;
  if (z < 8 && z > -25 && Math.abs(x) < 14) amp = 0.3;
  // sol aplani devant et derrière la barricade de la Casse
  amp = lerp(amp, 0.25, smooth(clamp(-x / 6, 0, 1)) * smooth(clamp((z - 78) / 6, 0, 1)) * (1 - smooth(clamp((z - 120) / 6, 0, 1))));
  return (fbm2(x * 0.045, z * 0.045, 3, 7) - 0.5) * 2 * amp + Math.sin(x * 0.18 + z * 0.05) * 0.25 * amp;
}
// Oasis du château d'eau : alcôve creusée au pied de la falaise est, bassin peu profond (rive en pente douce).
// y : niveau de l'eau ; r : rayon de la rive (le long de x, étiré de sz le long de z)
const OASIS = { x: 17.5, z: 45, y: -0.65, r: 5.6, sz: 1.3 };
const oasisR = (a) => OASIS.r * (1 + 0.1 * Math.sin(2 * a + 0.7) + 0.07 * Math.sin(3 * a + 2.1) + 0.04 * Math.sin(5 * a + 1));
// flaque du trop-plein, reliée au bassin par une traînée de sable mouillé
const FLAQUE = { x: 10, z: 56, y: -0.86, r: 1.7 };
const TRAINEE = [[14.6, 50.2], [12.4, 52.6], [11.4, 54.6], [10.2, 55.6]];
// distance relative à la rive (1 : bord de l'eau)
function oasisRho(x, z) {
  const u = x - OASIS.x, v = (z - OASIS.z) / OASIS.sz;
  return Math.hypot(u, v) / oasisR(Math.atan2(v, u));
}
function height(x, z, oasis = true) {
  const { d } = distToPolyline(x, z, PATH);
  const hw = halfWidth(z);
  const base = floorAt(x, z) + dunes(x, z);
  let wall = 30 + fbm2(x * 0.02, z * 0.02, 4, 3) * 22;
  const step = 6;
  wall = Math.floor(wall / step) * step + Math.pow((wall / step) % 1, 4) * step;
  const rho = oasis ? oasisRho(x, z) : 9;
  // la falaise recule autour de l'oasis
  const tMain = smooth(clamp((d - hw) / 9, 0, 1)) * (1 - smooth(clamp((2.6 - rho) / 0.9, 0, 1)));
  const t = Math.min(tMain, smooth(clamp((distToPolyline(x, z, CASSE).d - 8) / 6, 0, 1)));
  // petits éboulis au pied des falaises
  const scree = smooth(clamp((d - hw + 3) / 3, 0, 1)) * (1 - tMain) * 1.5;
  let h = lerp(base + scree, wall, t);
  if (rho < 2) {
    // berge aplanie juste au-dessus de l'eau, puis cuvette (0,7 m au plus profond)
    h = lerp(h, OASIS.y + 0.28 + dunes(x, z) * 0.06, smooth(clamp((1.9 - rho) / 0.6, 0, 1)));
    h -= smooth(clamp((1.25 - rho) / 0.8, 0, 1)) * 1.0;
  }
  // flaque au bout de la traînée humide (trop-plein du bassin), sur le chemin
  const pd = oasis ? Math.hypot(x - FLAQUE.x, z - FLAQUE.z) : 9;
  if (pd < 4.5) {
    h = lerp(h, FLAQUE.y + 0.1 + dunes(x, z) * 0.02, smooth(clamp((4.5 - pd) / 2, 0, 1)));
    h -= smooth(clamp((FLAQUE.r * 1.25 - pd) / (FLAQUE.r * 0.9), 0, 1)) * 0.36;
  }
  return h;
}

// Terrain fin sous l'oasis : les cellules de la grille du terrain (o : réglages de L.terrain) comprises dans
// [x0, x1] × [z0, z1] sont retirées et remplacées par une grille k fois plus fine, même matériau. La bordure suit
// exactement les arêtes de la grille grossière (pas de fente), l'intérieur rejoint la vraie hauteur en 1,5 m.
function terrainPatch(L, o, x0, z0, x1, z1, k) {
  const tm = L.terrainMesh, geo = tm.geometry;
  const n = o.res + 1, step = o.size / o.res;
  const i0 = Math.round((x0 - o.x0) / step), i1 = Math.round((x1 - o.x0) / step);
  const j0 = Math.round((z0 - o.z0) / step), j1 = Math.round((z1 - o.z0) / step);
  const idx = geo.index.array, keep = [];
  for (let q = 0; q < idx.length; q += 6) {
    const a = idx[q], i = a % n, j = (a - i) / n;
    if (i >= i0 && i < i1 && j >= j0 && j < j1) continue;
    for (let r = 0; r < 6; r++) keep.push(idx[q + r]);
  }
  geo.setIndex(keep);
  const cp = geo.attributes.position.array, cn = geo.attributes.normal.array;
  // hauteur et normale bilinéaires de la grille grossière
  const coarse = (x, z, out) => {
    const fi = (x - o.x0) / step, fj = (z - o.z0) / step;
    const i = Math.min(n - 2, Math.floor(fi)), j = Math.min(n - 2, Math.floor(fj)), u = fi - i, v = fj - j;
    const w = [(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v], id = [j * n + i, j * n + i + 1, (j + 1) * n + i, (j + 1) * n + i + 1];
    out.set(0, 0, 0);
    let h = 0;
    for (let c = 0; c < 4; c++) {
      h += cp[id[c] * 3 + 1] * w[c];
      out.x += cn[id[c] * 3] * w[c]; out.y += cn[id[c] * 3 + 1] * w[c]; out.z += cn[id[c] * 3 + 2] * w[c];
    }
    return h;
  };
  const X0 = o.x0 + i0 * step, Z0 = o.z0 + j0 * step, nx = (i1 - i0) * k, nz = (j1 - j0) * k, s = step / k;
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3), wts = new Float32Array((nx + 1) * (nz + 1));
  const cnrm = [], tmp = new THREE.Vector3();
  for (let jj = 0; jj <= nz; jj++) {
    for (let ii = 0; ii <= nx; ii++) {
      const q = jj * (nx + 1) + ii, x = X0 + ii * s, z = Z0 + jj * s;
      const w = smooth(clamp(Math.min(ii, nx - ii, jj, nz - jj) * s / 1.5, 0, 1));
      const hc = coarse(x, z, tmp);
      cnrm.push(tmp.clone().normalize());
      pos[q * 3] = x; pos[q * 3 + 1] = lerp(hc, o.height(x, z), w); pos[q * 3 + 2] = z;
      wts[q] = w;
    }
  }
  const ind = [];
  for (let jj = 0; jj < nz; jj++) {
    for (let ii = 0; ii < nx; ii++) {
      const a = jj * (nx + 1) + ii, b = a + 1, c = a + nx + 1, d = c + 1;
      ind.push(a, c, b, b, c, d);
    }
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  pg.setIndex(ind);
  pg.computeVertexNormals();
  const pn = pg.attributes.normal, col = new Float32Array(pos.length);
  for (let q = 0; q < wts.length; q++) {
    tmp.fromBufferAttribute(pn, q).lerp(cnrm[q], 1 - wts[q]).normalize();
    pn.setXYZ(q, tmp.x, tmp.y, tmp.z);
    const cc = o.color(pos[q * 3], pos[q * 3 + 2], pos[q * 3 + 1], tmp.y);
    col[q * 3] = cc[0]; col[q * 3 + 1] = cc[1]; col[q * 3 + 2] = cc[2];
  }
  pg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(pg, tm.material);
  m.receiveShadow = m.castShadow = true;
  L.root.add(m);
  return m;
}

// Oasis au pied du château d'eau : la cuve fuit, un filet d'eau tombe dans un bassin turquoise peu profond
// (praticable : 0,7 m au plus profond), roseaux, herbe grasse, palmiers, nénuphars, guirlande pour le soir.
function buildOasis(L, g, W, top) {
  const H = (x, z) => height(x, z);
  const Y = OASIS.y;
  // point du contour à l'angle a, k fois le rayon de la rive
  const rim = (a, k) => { const r = oasisR(a) * k; return [OASIS.x + Math.cos(a) * r, OASIS.z + Math.sin(a) * r * OASIS.sz]; };
  const R = rng(4242);
  // la fuite, côté bassin
  const dir = Math.atan2(OASIS.x - W.x, OASIS.z - W.z), dx = Math.sin(dir), dz = Math.cos(dir);
  const leak = V(W.x + dx * 2.08, top - 1.55, W.z + dz * 2.08);
  const speed = 1.3, T = Math.sqrt((2 * (leak.y - Y)) / 9.8);
  const foot = [leak.x + dx * speed * T, leak.z + dz * speed * T];
  // contour de l'eau un peu au-delà de la rive (la berge cache le reste)
  const shape = [];
  for (let i = 0; i < 56; i++) shape.push(rim((i / 56) * Math.PI * 2, 1.1));
  const pool = createWater(L, {
    shape, y: Y, preset: 'oasis',
    shallow: '#62f2d8', deep: '#0e9ca6', absorb: [0.6, 0.11, 0.075], turbidity: 0.24, shore: 0.12,
    // le filet d'eau pousse l'écume vers le large
    flowFn: (x, z) => {
      const ux = x - foot[0], uz = z - foot[1], d = Math.hypot(ux, uz) + 0.4, k = (0.45 * Math.exp(-d / 3.5)) / d;
      return [ux * k, uz * k];
    },
  });
  createWaterfall(L, { from: [leak.x, leak.y, leak.z], to: Y, width: 0.65, dir, speed, pool, tint: '#c8f6ee', spray: 0.6 });
  // flaque du trop-plein (sur le chemin : Kobi y éclabousse)
  const fl = [];
  for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2; fl.push([FLAQUE.x + Math.cos(a) * FLAQUE.r * 1.15, FLAQUE.z + Math.sin(a) * FLAQUE.r * 1.15]); }
  createWater(L, { shape: fl, y: FLAQUE.y, preset: 'oasis', shallow: '#62f2d8', deep: '#0e9ca6', absorb: [0.6, 0.11, 0.075], turbidity: 0.2, shore: 0.06, waves: [[0.5, 0.008, 3], [2.2, 0.006, 1.8]] });
  // tuyau crevé et sa vanne
  leakPipe(L, leak, dir, W, H);
  const nearFoot = (x, z, r) => Math.hypot(x - foot[0], z - foot[1]) < r;
  const nearLegs = (x, z, r) => Math.hypot(x - W.x, z - W.z) < r;

  // roseaux et massettes le long de la rive (en partie dans l'eau)
  const reedPts = [];
  for (let i = 0; i < 60; i++) {
    const a = R() * Math.PI * 2;
    const [x, z] = rim(a, 0.88 + R() * 0.26);
    if (nearFoot(x, z, 2.6) || nearLegs(x, z, 2.4)) continue;
    // côté chemin (ouest) : la vue reste dégagée
    if (Math.cos(a) < -0.2 && R() < 0.85) continue;
    for (let k = 0; k < 3 + Math.floor(R() * 4); k++) {
      const xx = x + (R() - 0.5) * 0.9, zz = z + (R() - 0.5) * 0.9;
      reedPts.push({ x: xx, y: H(xx, zz), z: zz });
    }
  }
  reeds(L, reedPts, { seed: 31 });
  // herbe grasse sur la berge humide
  const lush = [];
  for (let i = 0; i < 2600 && lush.length < 1300; i++) {
    const a = R() * Math.PI * 2, k = 0.97 + Math.pow(R(), 2.2) * 0.75;
    const [x, z] = rim(a, k);
    if (nearLegs(x, z, 1.8) || H(x, z) < Y + 0.04 || H(x, z) > Y + 1.2) continue;
    lush.push({ x, y: H(x, z), z });
  }
  grassField(L, lush, { base: '#2f7a34', tip: '#b8e070', height: [0.3, 0.6], seed: 13, sway: 0.7, blades: 7 });
  // palmiers penchés sur l'eau, reliés au château d'eau par une guirlande
  const palms = [[0.12, 1.32, 6.2, [-2.2, -0.5], 3], [1.55, 1.28, 5.2, [-0.7, -1.9], 7], [-1.0, 1.36, 4.4, [-1.3, 1.4], 11]];
  palms.forEach(([a, k, h, lean, s]) => { const [x, z] = rim(a, k); palm(L, V(x, H(x, z), z), h, lean, s); });
  // point de l'axe du stipe du palmier i, dy sous son sommet (le stipe penché s'écarte de la verticale du sommet)
  const trunk = (i, dy) => {
    const [a, k, h, lean] = palms[i], [x, z] = rim(a, k), t = 1 - dy / h;
    return V(x + lean[0] * t * t, H(x, z) + h * t, z + lean[1] * t * t);
  };
  // la guirlande part du cerclage bas de la cuve et s'attache aux stipes
  const bulbs = [
    ...stringLights(L, V(W.x + 1.457, top - 2.17, W.z + 1.457), trunk(1, 1.3), { sag: 1.0, intensity: 10, range: 7 }),
    ...stringLights(L, trunk(1, 1.2), trunk(0, 1.2), { sag: 0.9, light: false }),
  ];
  for (let i = 0; i < bulbs.length; i += 2) pool.addLamp(bulbs[i], '#ffc46a', 0.35);
  // cactus fleuris et rochers sur la berge, quelques galets dans l'eau
  for (const [a, k, s, sc] of [[0.75, 1.55, 4, 1.1], [-0.4, 1.5, 9, 0.9], [1.15, 1.6, 15, 0.75]]) {
    const [x, z] = rim(a, k);
    cactus(L, V(x, H(x, z), z), s, sc);
  }
  for (const [a, k, s] of [[0.45, 1.22, 1.3], [-0.6, 1.2, 1.1], [1.95, 1.08, 0.7], [-1.45, 1.05, 0.6], [0.95, 0.98, 0.55], [-0.15, 1.0, 0.5], [2.6, 1.12, 0.45]]) {
    const [x, z] = rim(a, k);
    rock(L, V(x, H(x, z) - s * 0.2, z), s, { seed: Math.floor(R() * 99), sy: s * 0.55 });
  }
  // épave : vieux bidons et pneu à moitié enfouis
  { const [x, z] = rim(-0.78, 1.35); barrel(L, V(x, H(x, z) - 0.25, z), { tip: true, collide: false }); }
  { const [x, z] = rim(-0.6, 1.45); barrel(L, V(x, H(x, z) - 0.1, z), { color: '#3a8ac0' }); }
  { const [x, z] = rim(0.35, 0.95); tireAt(L, mtx([x, Y - 0.05, z], [Math.PI / 2 - 0.35, 0, 0.6]).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))); }
  // nénuphars
  const pads = [];
  for (let i = 0; i < 40 && pads.length < 9; i++) {
    const a = R() * Math.PI * 2, [x, z] = rim(a, 0.45 + R() * 0.42);
    if (nearFoot(x, z, 2.2) || pads.some(([px, pz]) => Math.hypot(px - x, pz - z) < 1.1)) continue;
    pads.push([x, z, 0.32 + R() * 0.22, R() < 0.4]);
  }
  lilyPads(L, pads, Y);
}

export default {
  id: 'brikka',
  name: 'Brikka',
  subtitle: 'Le Canyon des Casseurs',
  orb: 'radial-gradient(circle at 35% 30%, #ffd9a0, #e07a32 45%, #7a2c18 90%)',
  mapPos: [14, 62],
  music: 'brikka',
  build(L, g) {
    const props = g.props;
    const R = rng(1234);
    // fin d'après-midi : soleil bas au bout du canyon (Kobi marche vers lui), dans l'axe : le sol du canyon et l'oasis
    // restent au soleil ; ombres longues tournées vers la caméra, rayons dans la poussière, ombres violettes ; la planète
    // à anneaux à l'écart du soleil, la lune dans le ciel du soir derrière Kobi
    L.environment({
      skyTop: '#3552ac', skyHorizon: '#ffb47a', skyBottom: '#d0703a', sunDir: [0.12, 0.53, 0.85], sunColor: '#ffc48a',
      clouds: 0.55, cloudColor: '#ffe2c8', planetDir: [-0.18, 0.42, 0.89], planetSize: 0.16, planetA: '#e8a070', planetB: '#ffe0b0', ring: 1, ringColor: '#ffe6c0',
      moonDir: [-0.55, 0.38, -0.74], moonSize: 0.035, moonColor: '#e0d8ff',
      fogColor: '#e89a80', fogNear: 70, fogFar: 520, fogBase: -8, fogFall: 0.09, fogHeight: 0.3, fogSun: 0.2, sunHalo: 0.42, skyGlow: 0.85,
      hemiSky: '#7f8cff', hemiGround: '#a8604a', hemiIntensity: 0.85, fillColor: '#d8dcff', fill: 0.4,
      sunIntensity: 3.8, envIntensity: 0.55, rays: 0.7, rimColor: '#ffcf9a', rimStrength: 0.6, dust: '#e8c49a', bloom: 0.5, exposure: 1.05,
      // Kobi marche vers le soleil : appoint plus franc côté caméra pour qu'il ne devienne pas une silhouette sombre
      charLight: 0.45,
      grade: { shadows: '#3c38c8', highlights: '#ffb060', amount: 0.32, contrast: 0.22 },
      // brume du canyon : rayons dorés, air violet à l'ombre ; diffusion peu dirigée (pas de voile face au soleil)
      volumetric: { density: 0.007, floor: 0.25, sun: 1.2, anisotropy: 0.35, ambient: '#a08ac8', ambientAmount: 0.12 },
    });
    // lumières locales : le soleil baisse, lampes, fenêtres et projecteurs commencent à compter
    lights.gain = 0.7;
    L.killY = -18;
    L.ambient = 'wind';
    const sand = sandTexture();
    const rockT = rockTexture('red');
    const terrain = {
      x0: -310, z0: -130, size: 640, res: 320, height, surface: 'sand',
      mapA: sand.map, mapB: rockT.map, normalA: sand.normalMap, normalB: rockT.normalMap, scaleA: 0.12, scaleB: 0.06, slopeLo: 0.6, slopeHi: 0.8,
      color: (x, z, h) => {
        const n = fbm2(x * 0.08, z * 0.08, 2, 99);
        let k = 0.9 + n * 0.2;
        if (h < -20) k *= 0.5 + clamp((h + 55) / 70, 0, 0.5);
        const top = clamp((h - 10) / 30, 0, 1);
        let c = [k * (1 + top * 0.1), k * (0.96 + top * 0.05), k * (0.92 + top * 0.08)];
        const rho = oasisRho(x, z);
        const trail = Math.min(distToPolyline(x, z, TRAINEE).d / 0.9, Math.hypot(x - FLAQUE.x, z - FLAQUE.z) / (FLAQUE.r * 1.6));
        if ((rho < 2.2 || trail < 1.5) && h < 4) {
          // oasis : terre humide (sombre, un peu verte) autour du bassin, sable lavé et clair au fond
          const wet = Math.max(smooth(clamp((1.8 - rho) / 0.7, 0, 1)) * (0.55 + 0.45 * smooth(clamp((OASIS.y + 0.3 - h) / 0.25, 0, 1))), smooth(clamp(1.4 - trail, 0, 1)));
          const under = Math.min(1, smooth(clamp((OASIS.y - 0.02 - h) / 0.3, 0, 1)) * smooth(clamp((1.2 - rho) / 0.15, 0, 1))
            + smooth(clamp((FLAQUE.y - 0.02 - h) / 0.15, 0, 1)) * smooth(clamp((FLAQUE.r * 1.15 - Math.hypot(x - FLAQUE.x, z - FLAQUE.z)) / 0.3, 0, 1)));
          c = c.map((v, i) => v * lerp(1, [0.62, 0.66, 0.56][i], wet));
          c = c.map((v, i) => lerp(v, [1.02, 1.16, 1.24][i] * (0.92 + n * 0.16), under));
        }
        return c;
      },
    };
    L.terrain(terrain);
    terrainPatch(L, terrain, 6, 30, 30, 60, 4);
    const H = (x, z) => height(x, z);
    // sol tel qu'il est dessiné : grille fine sous l'oasis, sinon grille de 2 m (au pied des falaises, la vraie hauteur
    // passe au-dessus des facettes et les objets y flottaient)
    const GY = (x, z) => (x > 6 && x < 30 && z > 30 && z < 60 ? H(x, z) : L.heightfield.height(x, z));

    // ------------------------------------------------ A. Aire d'atterrissage
    L.checkpoint = { pos: V(0, H(0, -4) + 0.2, -4), yaw: 0 };
    const ship = kobiShip(L.root, { ground: (x, z) => L.heightfield.height(x, z) });
    ship.position.set(-8, H(-8, -12), -13);
    ship.rotation.y = 0.5;
    L.box(V(-8, H(-8, -13) + 1.6, -13), V(2.6, 3, 6), null, { ry: 0.5, surface: 'metal' });
    L.titleShot = () => {
      // Kobi au sommet des conteneurs, le canyon et la planète à anneaux derrière lui
      const K = V(1.2, H(-1, 26) + 3.4, 25.6);
      g.player.spawn(K, Math.PI - 0.35);
      // Écrou quitte le dos de Kobi et vole à ses côtés, rotor déployé (rendu à Kobi quand on quitte l'écran titre)
      const back = g.player.rig.ecrou.root;
      g.player.rig.root.updateMatrixWorld(true);
      const E = createEcrou();
      E.root.scale.setScalar(back.getWorldScale(V(0, 0, 0)).x);
      E.mast.scale.setScalar(1);
      L.root.add(E.root);
      back.visible = false;
      L.onDispose(() => { back.visible = true; });
      let t = 0, ey = null, wv = 0;
      L.every((dt) => {
        if (g.state !== 'title') return;
        t += dt;
        const C = V(K.x + 1.7 + Math.sin(t * 0.12) * 0.5, K.y + 1.45 + Math.sin(t * 0.17) * 0.1, K.z - 4.6);
        const T = V(K.x + 3.1, K.y + 1.55, K.z + 6);
        g.camera.setScript(C, T, t < 0.1 ? 0 : 3);
        g.player.yaw = Math.PI - 0.35;
        const cheer = (t % 7) > 5.2;
        g.player.victory = cheer;
        // vol stationnaire à hauteur d'épaule, entre Kobi et la caméra ; il saute de joie avec Kobi
        const hop = cheer ? Math.abs(Math.sin((t % 7 - 5.2) * 5.2)) * 0.25 : 0;
        // pendant le coucou (wv), il s'écarte un peu de Kobi : à l'écran, il reste à côté de sa tête sans frôler son visage
        wv = damp(wv, cheer ? 1 : 0, 9, dt);
        const P = V(K.x + 0.98 + wv * 0.32 + Math.sin(t * 0.7) * 0.05, K.y + 1.12 + Math.sin(t * 1.6) * 0.06 + hop, K.z - 0.75);
        E.root.position.copy(P);
        // il fait face à la caméra (son avant est -z), un regard vers Kobi de temps en temps
        const look = Math.atan2(-(C.x - P.x), -(C.z - P.z)) + (Math.sin(t * 0.5) > 0.6 ? 0.85 : -0.1);
        ey = ey === null ? look : dampAngle(ey, look, 3, dt);
        E.root.rotation.set(Math.sin(t * 1.3) * 0.06, ey, Math.sin(t * 1.1) * 0.09);
        E.rotor.rotation.y += dt * 32;
        E.headJ.rotation.x = Math.sin(t * 1.4) * 0.08;
        E.headJ.rotation.y = Math.sin(t * 0.9) * 0.15;
        E.eye.scale.y = Math.sin(t * 0.9) > 0.97 ? 0.15 : 1;
        E.tip.scale.setScalar(Math.sin(t * 6) > 0.6 ? 1.3 : 0.8);
        E.legsE.forEach((l, i) => { l.rotation.x = 0.35 + Math.sin(t * 2.1 + i * Math.PI) * 0.12; });
        // bras : coucou pendant que Kobi fête (main levée à côté de la tête, qui se balance de gauche à droite),
        // sinon ils se balancent ; wv fond la levée et la descente du bras
        E.armsE.forEach((a, i) => {
          const rest = -0.9 + Math.sin(t * 2.2 + i) * 0.12;
          const w = i === 0 ? wv : 0;
          a.rotation.x = lerp(rest, -3.6, w);
          a.rotation.z = w * (0.8 + Math.sin(t * 9) * 0.4);
        });
      });
    };
    // caisses du tutoriel
    props.crate(V(4, H(4, 9), 9), 'bolt');
    props.crate(V(5.3, H(5.3, 9.6), 9.6), 'bolt');
    props.crate(V(4.6, H(4.6, 9.3) + 1, 9.3), 'bolt');
    props.crate(V(-5, H(-5, 12), 12), 'bolt');
    props.sign(V(-4, H(-4, 3), 3), 0.3, 'ROUILLE-VILLE\n→ 150 m', 2.4, 1.2, { bg: '#5a3a22', fg: '#ffe6b0', border: '#3a2416' });
    tireStack(L, V(6, H(6, -6), -6), 4);
    barrel(L, V(-3, H(-3, -10), -10));
    barrel(L, V(-2.2, H(-2.2, -11), -11), { color: '#3a8ac0' });
    lamp(L, V(3, H(3, -12), -12));
    // marches de conteneurs (double saut)
    container(L, V(0, H(0, 22), 22), 0, '#c8452f', { w: 9, h: 1.6, d: 3 });
    container(L, V(-1, H(-1, 26) + 0, 26), 0.05, '#2f7ac8', { w: 9, h: 3.4, d: 3 });
    props.crate(V(1, H(0, 26) + 3.4, 26), 'bolt');
    container(L, V(10, H(10, 24), 24), 1.4, '#e0a020', { w: 6, h: 2.6, d: 2.5 });
    container(L, V(-10, H(-10, 22), 22), 1.7, '#4a9a50', { w: 6, h: 2.6, d: 2.5 });

    // ------------------------------------------------ B. Le chemin des ferrailleurs
    const scatter = (z0, z1, n) => {
      for (let i = 0; i < n; i++) {
        const z = lerp(z0, z1, R());
        const { d } = distToPolyline(0, z, PATH);
        void d;
        // position latérale près des parois
        let best = null;
        for (let k = 0; k < 8 && !best; k++) {
          const x = lerp(-40, 45, R());
          const dd = distToPolyline(x, z, PATH).d;
          const hw = halfWidth(z);
          if (dd > hw - 6 && dd < hw + 1) best = x;
        }
        if (best === null) continue;
        if (Math.hypot(best + 6, z - 96) < 9) continue; // devant la barricade de la Casse
        const y = GY(best, z);
        const t = R();
        // l'oasis a sa propre berge (tirages conservés : le reste du décor ne bouge pas)
        const P = oasisRho(best, z) < 1.7 ? { add() {}, game: { world: { add() {} } }, root: L.root } : L;
        if (t < 0.45) rock(P, V(best, y, z), 1 + R() * 2.5, { seed: Math.floor(R() * 99) });
        else if (t < 0.7) cactus(P, V(best, y, z), Math.floor(R() * 99), 0.8 + R() * 0.7);
        else if (t < 0.9) scrapPile(P, V(best, y, z), 1.5 + R() * 1.5, Math.floor(R() * 99));
        else barrel(P, V(best, y, z), { color: R() < 0.5 ? '#3a8ac0' : undefined });
      }
    };
    scatter(-30, 112, 70);
    scatter(395, 478, 30);
    // gros rochers et tas qui structurent le chemin
    scrapPile(L, V(-6, H(-6, 44), 44), 3, 5);
    scrapPile(L, V(10, H(10, 50), 50), 2.6, 8);
    rock(L, V(4, H(4, 60), 60), 2.2, { seed: 3 });
    // carcasse au pied de la falaise, posée sur le sol plat (plus loin, l'éboulis la surélève hors de portée)
    const carc = V(22.5, H(20, 86) - 1, 86);
    carcass(L, carc, -1.3, 1.1);
    container(L, V(17, H(17, 79), 79), 1.2, '#7a5ac8', { w: 6, h: 2.6, d: 2.5 });
    container(L, V(19.5, H(19.5, 82) + 2.6, 82), 0.4, '#c8452f', { w: 5, h: 2.4, d: 2.5 });
    props.goldBolt(V(carc.x + 0.5, carc.y + 7.2, carc.z + 1), 0);
    props.crate(V(-4, H(-4, 52), 52), 'boom');
    props.crate(V(6, H(6, 47), 47), 'bolt');
    props.crate(V(7.2, H(7.2, 47), 47.5), 'bolt');
    props.crate(V(14, H(14, 66), 66), 'ammo');
    props.crate(V(15, H(15, 68), 68), 'bolt');
    props.crate(V(2, H(2, 92), 92), 'boom');
    props.crate(V(12, H(12, 98), 98), 'big');
    props.crate(V(-2, H(-2, 103), 103), 'health');
    cactus(L, V(3, H(3, 34), 34), 4, 1.3);
    cactus(L, V(-7, H(-7, 64), 64), 8, 1.1);
    for (let i = 0; i < 6; i++) g.pickups.placeBolt(V(lerp(2, 11, i / 5), H(lerp(2, 11, i / 5), 30 + i * 6) + 1, 30 + i * 6), 5);

    // château d'eau : cristal d'Orbium sur la cuve (Propulseur)
    {
      // (la cuve et son cristal ne bougent pas, les pieds descendent jusqu'au fond)
      const W = V(13, height(13, 40, false), 40), top = W.y + 5.4;
      // cuve peinte en turquoise : on la repère de loin, au-dessus de l'oasis
      waterTower(L, W, top, H);
      g.world.add(new CylinderCollider(W.x, W.z, top - 2.2, top + 0.05, 2, { surface: 'metal' }));
      props.orbium(V(W.x + 0.6, top + 0.15, W.z), 2);
      buildOasis(L, g, W, top);
      L.trigger({
        sphere: [[W.x, W.y, W.z], 6],
        fn: () => g.hud.say([['ecrou', g.hasGadget('propulseur')
          ? 'Le château d’eau ! Double saut, puis le Propulseur : le cristal est à nous.'
          : 'Un cristal d’Orbium sur le château d’eau… Bien trop haut pour un double saut. On reviendra mieux équipés !']]),
      });
    }

    // la Casse aux épaves (Magnéto-clé)
    {
      const BX = -8, BZ = 96, by = (z) => H(BX, z);
      props.magDoor(V(BX, by(BZ), BZ), Math.PI / 2, 5, 4.4);
      L.box(V(BX, by(BZ) + 6.2, BZ), V(2.5, 3.6, 6.6), null, { surface: 'metal' });
      lintel(L, V(BX, by(BZ) + 6.2, BZ), 2.5, 3.6, 6.6);
      const cols = ['#c8452f', '#2f7ac8', '#e0a020', '#4a9a50', '#7a5ac8', '#c8452f'];
      let ci = 0;
      for (const zc of [102.1, 108.1, 89.9, 83.9]) {
        const y0 = Math.min(by(zc - 2.5), by(zc), by(zc + 2.5)) - 0.2;
        for (let k = 0; k < 3; k++) container(L, V(BX, y0 + k * 2.6, zc), Math.PI / 2 + (k % 2 ? 0.03 : -0.02), cols[ci++ % cols.length]);
      }
      const CY = H(-20, 102);
      scrapPile(L, V(-15, H(-15, 92), 92), 2.6, 31);
      scrapPile(L, V(-30, H(-30, 112), 112), 3.2, 33);
      scrapPile(L, V(-34, H(-34, 104), 104), 2.4, 35);
      carcass(L, V(-24, H(-24, 112) - 0.8, 112), 2.2, 0.9);
      tireStack(L, V(-13, H(-13, 100), 100), 4);
      barrel(L, V(-18, H(-18, 94), 94), { color: '#3a8ac0' });
      barrel(L, V(-17.2, H(-17.2, 93), 93), {});
      props.crate(V(-14, H(-14, 97), 97), 'big');
      props.crate(V(-28, H(-28, 99), 99), 'big');
      props.crate(V(-27, H(-27, 99.5), 100.5), 'bolt');
      props.crate(V(-32, H(-32, 110), 110), 'big');
      props.orbium(V(-19, H(-19, 92), 92), 0);
      // le bloc aimanté monte au pied d'une pile de conteneurs ; cristal au sommet
      for (let k = 0; k < 3; k++) container(L, V(-26.5, CY - 0.2 + k * 2.6, 104.5), 0.6 + (k % 2) * 0.05, cols[(k + 2) % cols.length], { w: 5 });
      props.magBlock(V(-22, CY + 0.4, 102), V(-22, CY + 4.2, 102));
      props.orbium(V(-26.5, CY - 0.2 + 7.8, 104.5), 1);
      L.trigger({
        sphere: [[-3, H(-3, 96), 96], 6],
        fn: () => g.hud.say([['ecrou', g.hasGadget('magneto')
          ? 'Une barricade à verrou magnétique ! Un coup de Magnéto-clé et la Casse aux épaves est ouverte.'
          : 'Une barricade avec un verrou magnétique… Derrière, ça ressemble à une casse. Il faudra revenir avec le bon outil.']]),
      });
      L.trigger({
        sphere: [[-16, CY, 99], 6],
        fn: () => g.hud.say([['ecrou', 'La Casse aux épaves ! Et ce bloc violet est aimanté : un coup de clé, et il servira de marchepied.']]),
      });
    }

    // rencontres
    const spawnGroup = (list) => list.forEach(([type, x, z, o]) => g.enemies.spawn(type, V(x, H(x, z), z), o || {}));
    L.trigger({
      box: [[-30, -10, 34], [40, 30, 38]],
      fn: () => {
        spawnGroup([['grignoteur', -4, 50], ['grignoteur', 2, 54], ['grignoteur', 8, 52], ['grignoteur', -1, 58]]);
        g.hud.say([['ecrou', 'Des Grignoteurs ! Ça mange la ferraille… et les mollets. ' + g.input.actionLabel('fire') + ' pour tirer avec la Riveteuse !']], true);
      },
    });
    L.trigger({
      box: [[-30, -10, 72], [40, 30, 76]],
      fn: () => {
        spawnGroup([['larbin', 6, 96], ['larbin', 14, 92], ['grignoteur', 4, 88], ['grignoteur', 10, 86], ['grignoteur', 0, 90]]);
        g.hud.say([['ecrou', 'Des Larbins du Baron ! Maintiens ' + g.input.actionLabel('aim') + ' pour viser en te déplaçant de côté, et ' + g.input.actionLabel('dash') + ' pour esquiver leurs tirs.']], true);
      },
    });

    // ------------------------------------------------ C. Rouille-Ville
    const RY = 3;
    props.checkpoint(V(-2, H(-2, 132), 132), 0);
    shack(L, V(-18, H(-18, 140), 140), Math.PI / 2, 6, 4, 3.2, { color: '#4d77a8' });
    shack(L, V(14, H(14, 136), 136), -Math.PI / 2 - 0.2, 5, 4, 3, { color: '#c8452f', window: '#7ff3ff' });
    shack(L, V(12, H(12, 162), 162), -Math.PI / 2, 6, 5, 3.5, { color: '#e0a020' });
    shack(L, V(-19, H(-19, 166), 166), Math.PI / 2 + 0.15, 5, 4, 3, { color: '#4a9a50' });
    // éolienne sur le sol plat au pied de la paroi est (en (18, 150), elle était plantée dans la falaise : pieds
    // flottants ou enterrés de plusieurs mètres), à l'écart des barils
    windmill(L, V(11.5, H(11.5, 148), 148), -1.2);
    lamp(L, V(-8, H(-8, 128), 128));
    lamp(L, V(6, H(6, 172), 172));
    lamp(L, V(-12, H(-12, 176), 176));
    bunting(L, V(-17, RY + 4, 146), V(13, RY + 4, 140));
    bunting(L, V(-17, RY + 4, 160), V(11, RY + 4.2, 158), ['#ffd23a', '#7a5ac8', '#ff8a3a']);
    // le soir : ampoules entre les fanions (le fil porte enfin les fanions), mâts, brasero, enseigne au néon
    const BULBS = ['#ffcf7a', '#ff8a5a', '#7ff3ff', '#ffd23a'];
    for (const [a, b] of [[V(-17, RY + 4, 146), V(13, RY + 4, 140)], [V(-17, RY + 4, 160), V(11, RY + 4.2, 158)]]) {
      stringLights(L, a, b, { sag: 1.0, n: Math.ceil(a.distanceTo(b) / 0.9), phase: 0.5, colors: BULBS, intensity: 16, range: 9, color: '#ffc87a' });
      for (const [p, o] of [[a, b], [b, a]]) {
        L.cylinder(V(p.x, H(p.x, p.z) - 0.2, p.z), 0.09, p.y - H(p.x, p.z) + 0.35, null, { surface: 'wood' });
        garlandPost(L, p, o, H(p.x, p.z));
      }
    }
    fireBarrel(L, V(4, H(4, 156), 156));
    lights.add({ pos: V(-6, H(-6, 124) + 2.2, 124.7), color: '#ff4f6d', intensity: 10, range: 6, priority: 1 });
    props.vendor(V(-13, H(-13, 152), 152), Math.PI / 2);
    props.sign(V(-6, H(-6, 124), 124), 0.15, 'ROUILLE-VILLE\nPOP. 12 ½', 3.2, 1.3, { bg: '#2f2a44', fg: '#ffd23a', border: '#ff4f6d' });
    props.crate(V(6, H(6, 145), 145), 'ammo');
    props.crate(V(7, H(7, 145), 146.2), 'bolt');
    props.crate(V(-8, H(-8, 170), 170), 'bolt');
    props.crate(V(-9, H(-9, 171), 171.3), 'health');
    barrel(L, V(9, H(9, 150), 150), { color: '#3a8ac0' });
    barrel(L, V(9.8, H(9.8, 151), 151), {});
    tireStack(L, V(-10, H(-10, 135), 135), 3);
    L.trigger({
      sphere: [[-6, RY, 146], 12],
      fn: () => g.hud.say([
        ['ecrou', 'Rouille-Ville ! Et regarde : le Bazar Pétarade. Avec assez de boulons, on pourra s’offrir de quoi cabosser le Baron.'],
        ['gigi', 'Approchez, approchez ! Touche ' + g.input.actionLabel('interact') + ' pour voir la marchandise. Ça pétarade, ça détonne, ça fait des remises !'],
      ]),
    });

    // ------------------------------------------------ D. Les rails du gouffre
    // quai de départ
    L.box(V(-4, RY - 0.4, 190), V(10, 0.8, 6), null, { surface: 'wood' });
    dock(L, V(-4, RY, 190), 10, 6, RY, H);
    props.sign(V(-8, RY, 188), 0, 'LIGNE DU GOUFFRE\nSAUTEZ SUR LE RAIL', 3.4, 1.2, { bg: '#5a3a22', fg: '#ffe6b0', border: '#ffd23a', height: 1.4 });
    L.trigger({
      box: [[-15, -5, 182], [8, 20, 188]],
      fn: () => g.hud.say([['ecrou', 'Un rail ! Saute dessus pour glisser. Saut + gauche/droite pour changer de rail. Et évite les barrières électriques !']], true),
    });
    const rA = props.rail([[-4, RY + 0.7, 193], [-3, RY - 1, 205], [0, RY - 3, 222], [4, RY - 5, 238], [9, RY - 4, 256], [13, RY - 2, 272], [16, RY + 3.3, 287], [18, 6.95, 292], [19, 6.75, 295.5]], { speed: 15, bolts: 2.5 });
    const rB = props.rail([[3, RY - 3.5, 220], [7.5, RY - 5.5, 238], [12.5, RY - 4.5, 256], [16.5, RY - 2.5, 272], [20, RY + 0.2, 285]], { speed: 15, color: '#3ef2ff', bolts: 3 });
    // barrières électriques sur les rails
    const barriers = [];
    const barrier = (rail, s) => {
      const p = rail.point(s, V(0, 0, 0));
      const t = rail.tangent(s, V(0, 0, 0));
      const grp = new THREE.Group();
      grp.position.copy(p);
      grp.rotation.y = Math.atan2(t.x, t.z);
      L.root.add(grp);
      railBarrier(L, p, grp.rotation.y);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.08), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3a6a').multiplyScalar(3) }));
      beam.position.y = 1.1;
      grp.add(beam);
      const beam2 = beam.clone();
      beam2.position.y = 0.5;
      grp.add(beam2);
      barriers.push({ rail, s, grp, beam, beam2 });
    };
    barrier(rA, 62);
    barrier(rB, 40);
    barrier(rA, 88);
    L.every((dt, t) => {
      const p = g.player;
      for (const b of barriers) {
        b.beam.scale.y = b.beam2.scale.y = 1 + Math.sin(t * 30) * 0.5;
        if (p.state === 'grind' && p.rail === b.rail && Math.abs(p.railS - b.s) < 0.8) {
          p.hurt(15, null, 0);
          if (p.state !== 'grind') continue;
          g.fx.sparks(b.grp.position.clone().setY(b.grp.position.y + 1), null, 20, '#ff3a6a', 8);
          g.audio.play('zapHit', { pitch: 0.6 });
          p.railS += p.railDir * 1.2;
          p._leaveRail(p.rail.tangent(p.railS, V(0, 0, 0)).multiplyScalar(p.railDir), 9);
        }
      }
    });

    // ------------------------------------------------ E. Les mesas
    mesa(L, V(20, 0, 300), 7.5, 6, { bottom: -56 });
    props.checkpoint(V(20, 6, 302), 0);
    props.crate(V(16, 6, 304), 'ammo');
    props.crate(V(23, 6, 305), 'bolt');
    mesa(L, V(13, 0, 316), 3.2, 7, { bottom: -56 });
    mesa(L, V(21, 0, 327), 2.8, 8.5, { bottom: -56 });
    props.crate(V(21, 8.5, 327), 'bolt');
    props.platform([[21, 9.2, 335], [21, 9.2, 351]], { speed: 3.2, wait: 1.2, size: V(4, 0.6, 4) });
    mesa(L, V(16, 0, 360), 4.2, 9, { bottom: -56 });
    props.jumpPad(V(16, 9, 360), V(6, 4.5, 372), 4);
    mesa(L, V(6, 0, 373), 6, 4.5, { bottom: -56 });
    props.crate(V(4, 4.5, 375), 'health');
    // boulon d'or : petit piton isolé
    mesa(L, V(30.5, 0, 343), 1.7, 12.2, { bottom: -56, pebbles: false });
    props.goldBolt(V(30.5, 13.3, 343), 1);
    // drones en patrouille au-dessus des mesas
    L.trigger({
      sphere: [[20, 6, 304], 9],
      fn: () => {
        spawnGroup([['bourdon', 18, 340], ['bourdon', 10, 350]]);
        g.hud.say([['ecrou', 'Des Bourdons ! Ils volent, ils piquent… et ils lâchent plein de boulons.']]);
      },
    });
    L.trigger({ sphere: [[16, 9, 360], 8], fn: () => spawnGroup([['bourdon', 8, 380], ['bourdon', 2, 368]]) });
    // pont vers le chantier
    plankBridge(L, V(6, 4.5, 378.5), V(8, 2.2, 392));

    // ------------------------------------------------ F. Le chantier Vorax
    const AY = 2;
    const vac = voraxVacuum(L, V(10, H(10, 462), 462), 1);
    void vac;
    container(L, V(-14, H(-14, 420), 420), 0.2, '#6a2bd0', { w: 7, h: 2.8, d: 3 });
    container(L, V(-13, H(-13, 420) + 2.8, 420.5), 0.1, '#ffcc33', { w: 6, h: 2.8, d: 3 });
    container(L, V(30, H(30, 440), 440), -0.3, '#6a2bd0', { w: 7, h: 2.8, d: 3 });
    container(L, V(-18, H(-18, 452), 452), 1.2, '#c8452f');
    container(L, V(24, H(24, 412), 412), 1.5, '#ffcc33');
    container(L, V(32, H(32, 470), 470), 0.6, '#6a2bd0');
    container(L, V(31, H(32, 470) + 2.6, 469), 0.4, '#ffcc33', { w: 5 });
    container(L, V(29, H(29, 474) + 5.2, 471.5), 0.9, '#c8452f', { w: 4.5 });
    props.goldBolt(V(28.8, H(29, 474) + 9, 471.5), 2);
    props.crate(V(-12, H(-12, 425) + 0, 426), 'bolt');
    props.crate(V(26, H(26, 418), 418), 'ammo');
    props.crate(V(-6, H(-6, 440), 440), 'boom');
    props.crate(V(22, H(22, 430), 430), 'boom');
    props.crate(V(0, H(0, 446), 446), 'health');
    barrel(L, V(-8, H(-8, 410), 410), { color: '#6a2bd0' });
    barrel(L, V(28, H(28, 450), 450), { color: '#6a2bd0' });
    lamp(L, V(-20, H(-20, 430), 430), { glow: propMats().pinkGlow });
    lamp(L, V(36, H(36, 430), 430), { glow: propMats().pinkGlow });
    props.sign(V(21, H(21, 393), 393), -0.35, 'CHANTIER VORAX\nACCÈS INTERDIT', 3.6, 1.4, { bg: '#3a1470', fg: '#ffcc33', border: '#ffcc33' });
    // projecteurs braqués sur l'arène, gyrophares sur les conteneurs, la tour et le panneau
    floodlight(L, V(-17, H(-17, 401), 401), V(0, H(0, 425), 425));
    floodlight(L, V(36, H(36, 401), 401), V(22, H(22, 425), 425));
    floodlight(L, V(-18, H(-18, 466), 466), V(2, H(2, 448), 448), { color: '#fff0d8' });
    beacon(L, V(-13, H(-13, 420) + 5.6, 420.5));
    beacon(L, V(30, H(30, 440) + 2.8, 440), { speed: 4.3 });
    beacon(L, V(10, H(10, 462) + 3, 458.4), { speed: 6, intensity: 30, range: 10 });
    beacon(L, V(21, H(21, 393) + 2.35, 393), { speed: 5.5, intensity: 14, range: 6 });
    props.checkpoint(V(10, H(10, 394), 394), 0);
    // comptoir avancé du Bazar : à Rouille-Ville, Kobi n'a pas encore de quoi s'offrir une arme ; ici, avec les boulons
    // du gouffre, la Bombe-Ressort est à sa portée avant d'affronter Grosbras
    props.vendor(V(-5, H(-5, 391), 391), Math.PI / 2);
    L.trigger({
      sphere: [[2, AY, 391], 10],
      fn: () => g.hud.say([
        ['gigi', 'Surprise ! Comptoir avancé du Bazar Pétarade. Avant le chantier, un petit achat ? Touche ' + g.input.actionLabel('interact') + ' !'],
        ['ecrou', 'Bonne idée : contre le chef du chantier, une deuxième arme ne serait pas de trop.'],
      ]),
    });
    // barrière sur toute la largeur du canyon (trois pans posés chacun à hauteur du sol)
    const gates = [-8.5, 12, 31.5].map((x) => props.forceField(V(x, H(x, 399), 399), 21.5, 6, 0, { on: false }));
    const gateOut = props.forceField(V(10, H(10, 482), 476), 16, 6, 0, { on: true, color: '#ffcc33' });
    const arena = new Arena(g, {
      fields: gates,
      title: 'Le chantier se défend !',
      ammo: [[-2, 424], [22, 438], [4, 452]].map(([x, z]) => V(x, H(x, z), z)),
      waves: [
        { list: [['grignoteur', 2, 430], ['grignoteur', 16, 432], ['grignoteur', 8, 438], ['grignoteur', 20, 426], ['larbin', 0, 446], ['larbin', 18, 448]], say: [['ecrou', 'C’est un piège ! Ils nous attendaient !']] },
        { list: [['bourdon', -2, 440], ['bourdon', 22, 442], ['larbin', 10, 450, { elite: true }], ['boumboule', -6, 432], ['boumboule', 26, 434], ['boumboule', 10, 444]], say: [['ecrou', 'Attention aux Boum-Boules : elles roulent et elles explosent. Tire-leur dessus de loin !']] },
        { list: [['grosbras', 10, 448]], after: 2.5, say: [['baron', 'GROSBRAS ! Écrase-moi ce rongeur à oreilles ! Et ne casse pas l’aspirateur, il n’est pas payé !']] },
      ],
      reward: 600,
      rewardPos: V(10, AY + 4, 430),
      onDone: () => {
        g.hud.say([
          ['ecrou', 'On a réussi ! Et regarde : les coordonnées du Baron dans la tête de Grosbras. Il file vers Nimbara !'],
          ['ecrou', 'La Bricole arrive. Monte à bord quand tu veux.'],
        ]);
        g.props.setField(gateOut, false);
        exitShip.land();
      },
    });
    L.trigger({ box: [[-10, -5, 409], [30, 30, 418]], once: false, fn: () => { if (!arena.active && !arena.done) arena.start(); } });
    L.arena = arena;
    L.onPlayerRespawn = () => { if (arena.active) { arena.reset(); g.playMusic('brikka'); } };
    // atterrissage du vaisseau à la fin
    const exitShip = shipExit(L, g, V(10, H(10, 428), 428), 'Décoller vers Nimbara');
    // touffes d'herbes sèches sur le sol du canyon
    const tufts = [];
    const RG = rng(77);
    for (let i = 0; i < 12000 && tufts.length < 4500; i++) {
      const z = -30 + RG() * 510, x = -40 + RG() * 90;
      const { d } = distToPolyline(x, z, PATH);
      const hw = halfWidth(z);
      if (d < 4 || d > hw + 2) continue;
      if (z > 189 && z < 386) continue;
      if (z > 125 && z < 180 && d < 12) continue;
      if (Math.hypot(x + 5, z - 391) < 3.5) continue;
      if (oasisRho(x, z) < 1.75) continue;
      const y = H(x, z);
      if (y > 5 || y < -2) continue;
      const n = 3 + Math.floor(RG() * 5);
      for (let k = 0; k < n; k++) {
        const xx = x + (RG() - 0.5) * 1.6, zz = z + (RG() - 0.5) * 1.6;
        tufts.push({ x: xx, y: H(xx, zz), z: zz });
      }
    }
    grassField(L, tufts, { base: '#a07a3e', tip: '#f4dcaa', height: [0.22, 0.48], seed: 9, sway: 0.8, blades: 8 });
    motes(L, { count: 380, colorA: '#ffe0b0', colorB: '#fff4dc', size: 0.07, drift: [1.6, 0.1, 0.6], glow: 1.1 });
    void boxUV;
  },
  onStart(L, g, opts) {
    g.hud.titleCard('Brikka', 'Le Canyon des Casseurs');
    g.hud.objective('Suivre la piste des débris jusqu’à Rouille-Ville');
    L.after(1.8, () => g.hud.say(g.defi ? [
      ['ecrou', 'Les robots du Baron sont revenus, et ils ont pris du blindage ! Enchaîne-les sans te faire toucher : plus le multiplicateur grimpe, plus les boulons pleuvent.'],
    ] : [
      ['ecrou', opts && opts.intro ? 'Kobi ! Le Baron a aspiré notre garage ! Suivons la piste des débris.' : 'Retour sur Brikka. Il reste sûrement des boulons à ramasser !'],
      ['ecrou', 'N’oublie pas ta clé à molette (' + g.input.actionLabel('melee') + ') : elle casse les caisses, pleines de boulons… et les robots, sans dépenser une seule munition !'],
    ]));
    L.trigger({ box: [[-30, -5, 108], [30, 30, 112]], fn: () => g.hud.objective('Trouver le Bazar Pétarade à Rouille-Ville') });
    L.trigger({ box: [[-30, -5, 180], [30, 30, 184]], fn: () => g.hud.objective('Traverser le gouffre en glissant sur les rails') });
    L.trigger({ box: [[-30, -5, 380], [40, 30, 386]], fn: () => g.hud.objective('Fouiller le chantier Vorax') });
  },
};
