import * as THREE from 'three';
import { G, part, joint, bake } from '../geo.js';
import { mat, glow } from '../../engine/materials.js';
import { paintedMetalTexture } from '../../engine/textures.js';
import { C, rig } from './common.js';

// ===================================================================== aides (pièces rigides fusionnées)
const TAU = Math.PI * 2;
const GEO = new Map();
// géométrie fixe calculée une fois, partagée par toutes les instances
function once(key, make) {
  let g = GEO.get(key);
  if (!g) { g = make(); g.userData.shared = true; GEO.set(key, g); }
  return g;
}
const V3 = (p) => new THREE.Vector3(p[0], p[1], p[2]);
const _Y = new THREE.Vector3(0, 1, 0);
// matrice : position p, axe Y de la pièce tourné vers n (vecteur), torsion autour de cet axe, échelle s
function place(p, n = [0, 1, 0], s = 1, twist = 0) {
  const q = new THREE.Quaternion().setFromUnitVectors(_Y, V3(n).normalize());
  if (twist) q.multiply(new THREE.Quaternion().setFromAxisAngle(_Y, twist));
  return new THREE.Matrix4().compose(V3(p), q, typeof s === 'number' ? new THREE.Vector3(s, s, s) : V3(s));
}
// copie en couleurs de sommet, dégradé de c0 (y ≤ y0) à c1 (y ≥ y1)
function tint(geo, c0, c1 = c0, y0 = 0, y1 = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const a = new THREE.Color(c0), b = new THREE.Color(c1), c = new THREE.Color();
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    c.copy(a).lerp(b, THREE.MathUtils.clamp((p.getY(i) - y0) / (y1 - y0 || 1), 0, 1));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
// tube le long d'une courbe passant par pts, rayon r0 → r1 ; ribs : annelures (durite)
function tube(pts, r0, r1 = r0, seg = 12, rad = 6, ribs = 0) {
  const curve = new THREE.CatmullRomCurve3(pts.map(V3));
  const g = new THREE.TubeGeometry(curve, seg, 1, rad, false);
  const pos = g.attributes.position, P = new THREE.Vector3(), Q = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    curve.getPointAt(t, P);
    let r = r0 + (r1 - r0) * t;
    if (ribs) r *= 1 + 0.2 * Math.max(0, Math.cos(t * ribs * TAU)) ** 6;
    for (let j = 0; j <= rad; j++) {
      const k = i * (rad + 1) + j;
      Q.fromBufferAttribute(pos, k).sub(P).multiplyScalar(r).add(P);
      pos.setXYZ(k, Q.x, Q.y, Q.z);
    }
  }
  g.computeVertexNormals();
  return g;
}
// tore couché (axe vertical) en p
const flat = (p) => new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(p[0], p[1], p[2]);
// tête de rivet (calotte basse, tournée vers +Y)
const RIVET = (r) => once('rsRivet' + r, () => new THREE.SphereGeometry(r, 8, 3, 0, TAU, 0, Math.PI / 2).scale(1, 0.55, 1));
// bande de tôle peinte (cylindre ouvert d'axe Y) : la texture se répète rep fois sur le tour (une plaque par motif)
function band(R, h, rep, seg = 40) {
  const g = new THREE.CylinderGeometry(R, R * 1.02, h, seg, 1, true);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * rep);
  return g;
}
// matières partagées
let MM = null;
function mats() {
  if (MM) return MM;
  const pm = paintedMetalTexture(C.vorax, 'reineSporeTole', { chip: 0.3, edge: 0.75, rust: 0.12, bare: '#c9c2b4' });
  MM = {
    tole: mat('#ffffff', { map: pm.map, normalMap: pm.normalMap, rough: 0.42, metal: 0.45, coat: 0.55 }),
    gold: mat(C.gold, { rough: 0.25, metal: 0.85, coat: 0.4 }),
    steel: mat(C.metal, { rough: 0.3, metal: 0.85 }),
    dark: mat('#2a2438', { rough: 0.45, metal: 0.55 }),
    hose: mat('#2b2633', { rough: 0.62, metal: 0.1, sheen: 0.4 }),
    organic: mat('#ffffff', { vertexColors: true, rough: 0.5, sheen: 0.6, sheenColor: '#ffe0f0' }),
    pistil: mat('#f3e2b8', { rough: 0.5, sheen: 0.6, sheenColor: '#fff0c0' }),
    white: mat('#fff6fb', { rough: 0.12, coat: 1 }),
    pupil: mat('#140a18', { rough: 0.2 }),
    face: mat('#f2eee0', { rough: 0.4 }),
    iris: glow('#ff4fa0', 2.6),
    vein: glow('#6affd0', 1.7),
    pvein: glow('#ffb4e4', 1.8),
    anther: glow('#ffd23a', 2.4),
    spore: glow('#fff3a0', 2.2),
    fluid: glow('#9aff5a', 2.2),
    red: glow('#ff3a3a', 2.6),
    amber: glow('#ffb03a', 2.6),
    pod: glow('#d8ff6a', 2.2),
  };
  return MM;
}

// ===================================================================== Reine Spore (boss de Luminbois)
// Plante-robot géante enracinée : bulbe-corps à côtes, quatre pétales blindés (liseré doré riveté, revers velouté
// à nervures lumineuses), lianes-fouets noueuses à épines et ventouses, cœur-œil serti d'or (point faible quand les
// pétales s'ouvrent). Greffes du Baron : corset de tôle violette, réservoir d'engrais et ses durites, colliers et vérins.

// creux du pétale (repère de l'os : +z le long du pétale, +y face intérieure, -y revers blindé)
const PET = { blade: [1.35, 0.27, 1.7], bz: 1.95, cup: [1.05, 0.3, 1.55], cz: 2.05, cy: 0.44 };
function petalInnerY(x, z) {
  const b = 1 - (x / PET.blade[0]) ** 2 - ((z - PET.bz) / PET.blade[2]) ** 2;
  let y = 0.05 + PET.blade[1] * Math.sqrt(Math.max(0, b));
  const c = 1 - (x / PET.cup[0]) ** 2 - ((z - PET.cz) / PET.cup[2]) ** 2;
  if (c > 0) y = Math.min(y, PET.cy - PET.cup[1] * Math.sqrt(c));
  return y;
}
function petalOuterY(x, z) {
  const b = 1 - (x / PET.blade[0]) ** 2 - ((z - PET.bz) / PET.blade[2]) ** 2;
  return 0.05 - PET.blade[1] * Math.sqrt(Math.max(0, b));
}

// pièces rigides d'un pétale : rivets du liseré et charnière (or), axe de charnière (acier), nervures (lumière)
function petalParts() {
  const gold = once('rsPetGold', () => {
    const L = [];
    for (let i = 0; i < 13; i++) {
      const f = -1.15 + (i / 12) * 4.3; // tour du limbe sans la base
      const x = 1.27 * Math.cos(f), z = PET.bz + 1.6 * Math.sin(f);
      const y = petalOuterY(x, z) - 0.005;
      L.push([RIVET(0.065), place([x, y, z], [x / 1.82, (y - 0.05) / 0.073, (z - PET.bz) / 2.89])]);
    }
    for (const z of [1.0, 2.9]) L.push([RIVET(0.075), place([0, petalOuterY(0, z) - 0.1, z], [0, -1, 0])]);
    for (const s of [-1, 1]) L.push([G.cyl(0.2, 0.2, 0.1, 14), place([s * 0.4, 0, 0], [1, 0, 0])]);
    return bake(L);
  });
  const steel = once('rsPetSteel', () => bake([[G.cyl(0.16, 0.16, 0.72, 14), place([0, 0, 0], [1, 0, 0])]]));
  const veins = once('rsPetVein', () => {
    const L = [];
    const path = (pts) => tube(pts.map(([x, z]) => [x, petalInnerY(x, z) + 0.012, z]), 0.034, 0.022, 14, 5);
    L.push([path([[0, 0.65], [0, 1.4], [0, 2.2], [0, 3.0], [0, 3.25]]), null]);
    for (const z0 of [0.95, 1.75]) for (const s of [-1, 1]) {
      L.push([path([[0, z0], [s * 0.3, z0 + 0.25], [s * 0.6, z0 + 0.6], [s * 0.82, z0 + 1.0]]), null]);
    }
    return bake(L);
  });
  return { gold, steel, veins };
}

// épines (ivoire à pointe rouge) et ventouses d'un segment de liane, pointe en griffe au dernier
function vineParts(k) {
  return once('rsVine' + k, () => {
    const L = [];
    const r1 = 0.52 - k * 0.1, r2 = 0.44 - k * 0.1;
    const rAt = (z) => r1 + (r2 - r1) * (z / 1.7);
    const thorn = (h, rb) => tint(G.cone(rb, h, 7).clone().translate(0, h / 2, 0), '#e9dcb4', '#c2304e', h * 0.35, h);
    const zs = k < 3 ? [0.45, 1.15] : [0.6];
    zs.forEach((z, zi) => {
      for (const f of [0, 2.1, -2.1]) {
        const ff = f + zi * 0.6 + k * 0.4;
        const n = [Math.sin(ff), Math.cos(ff), 0.38];
        const r = rAt(z) - 0.03;
        L.push([thorn(0.42 - k * 0.06, 0.1 - k * 0.012), place([Math.sin(ff) * r, Math.cos(ff) * r, z], n)]);
      }
      if (k < 3) {
        // ventouse sous la liane
        const s = 0.13 - k * 0.02, r = rAt(z + 0.3) - 0.02;
        L.push([tint(G.torus(s, s * 0.38, 6, 12), '#e292bc'), flat([0, -r, z + 0.3])]);
        L.push([tint(G.sphere(s * 0.8, 10, 6), '#6a2048'), place([0, -r + 0.02, z + 0.3], [0, -1, 0], [1, 0.35, 1])]);
      }
    });
    if (k === 3) {
      // griffe : grand dard et deux crochets
      L.push([thorn(0.95, 0.2), place([0, 0, 2.27], [0, 0, 1])]);
      for (const s of [-1, 1]) L.push([thorn(0.5, 0.11), place([s * 0.22, 0.1, 2.0], [s * 0.8, 0.5, 0.6])]);
    }
    return bake(L, true);
  });
}
// greffes d'une liane : collier de tôle à la racine (segment 0) avec son vérin, bague dorée sous la griffe
function vineMetal(k) {
  if (k === 0) return {
    tole: once('rsVineCol', () => bake([[band(0.5, 0.34, 3, 22), place([0, 0, 0.55], [0, 0, 1])]])),
    gold: once('rsVineColG', () => {
      const L = [];
      for (let i = 0; i < 8; i++) {
        const f = (i / 8) * TAU, n = [Math.sin(f), Math.cos(f), 0];
        for (const z of [0.42, 0.68]) L.push([RIVET(0.045), place([n[0] * 0.505, n[1] * 0.505, z], n)]);
      }
      L.push([G.cyl(0.09, 0.09, 0.16, 10), place([0, 0.52, 0.85], [0, 1, 0])]);
      L.push([G.cyl(0.09, 0.09, 0.16, 10), place([0, 0.47, 1.55], [0, 1, 0])]);
      return bake(L);
    }),
    steel: once('rsVinePis', () => bake([
      [G.cyl(0.075, 0.075, 0.42, 10), place([0, 0.6, 1.02], [0, -0.07, 1])],
      [G.cyl(0.04, 0.04, 0.5, 8), place([0, 0.56, 1.36], [0, -0.07, 1])],
    ])),
  };
  if (k === 3) return { gold: once('rsVineTip', () => bake([[G.cyl(0.215, 0.26, 0.22, 14), place([0, 0, 2.2], [0, 0, 1])], [G.torus(0.25, 0.04, 5, 14), place([0, 0, 2.1])]])) };
  return null;
}

export function reineSpore() {
  const M = mats();
  const { S, root, B, skin } = rig({
    root: { color: '#5e4630', rough: 0.8, sheen: 0.4 },
    soil: { color: '#4a3424', rough: 0.95 },
    bulb: { color: '#3a8a5a', rough: 0.48, sheen: 0.7, metal: 0.05 },
    bulbL: { color: '#86c46a', rough: 0.5, sheen: 0.8 },
    bulbD: { color: '#1b4433', rough: 0.6, sheen: 0.4 },
    lip: { color: '#8a2a6a', rough: 0.5, sheen: 0.9 },
    armor: { color: '#c04a9a', rough: 0.3, metal: 0.25, sheen: 0.2, coat: 0.85 },
    velvet: { color: '#ee7abd', rough: 0.85, sheen: 1 },
    gold: { color: C.gold, rough: 0.25, metal: 0.85, coat: 0.4 },
    vine: { color: '#2a6a4a', rough: 0.62, sheen: 0.5 },
    vineD: { color: '#173f2e', rough: 0.7, sheen: 0.3 },
    vineL: { color: '#7aa86a', rough: 0.6, sheen: 0.6 },
  });
  // ---- souche : motte de terre soulevée, collet de racines qui plongent dans le sol
  const base = B(root, [0, 0, 0], 'base');
  S.add(base, { t: 'ell', r: [3.7, 0.52, 3.7], p: [0, -0.16, 0], col: 'soil', k: 0.3, fuzz: [0.08, 2.2] });
  S.add(base, { t: 'ell', r: [2.35, 0.8, 2.35], p: [0, 0.35, 0], col: 'root', k: 0.45, fuzz: [0.05, 2.5] });
  for (let i = 0; i < 12; i++) {
    const big = i % 3 === 0;
    const a = (i / 12) * TAU + Math.PI / 4 + (big ? 0 : (i % 3 === 1 ? 0.12 : -0.12)) + Math.sin(i * 2.3) * 0.06;
    const m = big ? 1 : 0.68, L = 1 + Math.sin(i * 1.7) * 0.15;
    const d = (r, y) => [Math.sin(a) * r, y, Math.cos(a) * r];
    // racine noueuse : sort du collet, rampe sur la motte puis s'y enfonce
    const P = [d(1.9, 0.7 * m), d(2.7, 0.42 + 0.1 * m), d(2.7 + 0.8 * m * L, 0.18), d(2.9 + 1.2 * m * L, -0.35)];
    const Rr = [0.34 * m, 0.25 * m, 0.16 * m, 0.06];
    for (let q = 0; q < 3; q++) S.add(base, { t: 'cone', a: P[q], b: P[q + 1], r1: Rr[q], r2: Rr[q + 1], col: 'root', k: 0.14, fuzz: [0.03, 4] });
  }
  // ---- bulbe-corps : sphère à côtes (lobes clairs, sillons sombres), lèvre charnue autour de l'œil
  const bulb = B(base, [0, 2.4, 0], 'bulb');
  S.add(bulb, { t: 'ell', r: [2.0, 2.25, 2.0], col: 'bulb', k: 0.3 });
  for (let j = 0; j < 8; j++) {
    const b = (j / 8) * TAU + Math.PI / 8;
    S.add(bulb, { t: 'ell', r: [0.95, 1.75, 0.75], p: [Math.sin(b) * 1.4, -0.2, Math.cos(b) * 1.4], rot: [0, b, 0], col: 'bulb', k: 0.3 });
    S.paint(bulb, { t: 'ell', r: [0.3, 1.4, 0.5], p: [Math.sin(b) * 2.1, -0.1, Math.cos(b) * 2.1], rot: [0, b, 0], col: 'bulbL', feather: 0.22 });
    const c = b + Math.PI / 8;
    S.paint(bulb, { t: 'ell', r: [0.1, 2.0, 0.5], p: [Math.sin(c) * 1.95, -0.1, Math.cos(c) * 1.95], rot: [0, c, 0], col: 'bulbD', feather: 0.09 });
  }
  S.add(bulb, { t: 'torus', R: 0.84, r: 0.24, p: [0, 1.93, 0], col: 'lip', k: 0.2 });
  // ---- pétales blindés
  const petals = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    // liés à mi-course (entre fermé -1,05 et ouvert 0,8) : ni fusion avec le bulbe ni déchirure aux extrêmes
    const pv = B(bulb, [Math.sin(a) * 1.0, 2.0, Math.cos(a) * 1.0], 'petal' + i, [-0.15, a, 0]);
    pv.rotation.order = 'YXZ';
    const ps = { k: 0.12, skinSoft: 0.06 };
    S.add(pv, { t: 'cone', a: [0, 0, -0.1], b: [0, 0.02, 0.9], r1: 0.3, r2: 0.42, col: 'armor', ...ps });
    S.add(pv, { t: 'ell', r: PET.blade, p: [0, 0.05, PET.bz], col: 'gold', ...ps });
    S.add(pv, { t: 'ell', r: [0.78, 0.2, 0.85], p: [0, 0.06, 3.4], rot: [-0.2, 0, 0], col: 'armor', ...ps });
    S.add(pv, { t: 'cone', a: [0, 0.14, 3.7], b: [0, 0.48, 4.45], r1: 0.3, r2: 0.05, col: 'gold', ...ps });
    S.sub(pv, { t: 'ell', r: PET.cup, p: [0, PET.cy, PET.cz], k: 0.14 });
    // plaques de blindage sur le revers, rainure entre elles
    S.add(pv, { t: 'ell', r: [1.0, 0.12, 0.72], p: [0, -0.17, 1.3], col: 'armor', k: 0.05, skinSoft: 0.06 });
    S.add(pv, { t: 'ell', r: [0.92, 0.12, 0.78], p: [0, -0.15, 2.55], col: 'armor', k: 0.05, skinSoft: 0.06 });
    S.sub(pv, { t: 'ell', r: [1.5, 0.07, 0.08], p: [0, -0.27, 1.95], k: 0.03 });
    // laque dessous, velours dessus : il reste un liseré doré
    S.paint(pv, { t: 'ell', r: [1.25, 0.3, 1.6], p: [0, -0.2, PET.bz], col: 'armor', feather: 0.04 });
    S.paint(pv, { t: 'ell', r: [1.23, 0.38, 1.57], p: [0, 0.48, 1.98], col: 'velvet', feather: 0.05 });
    S.paint(pv, { t: 'ell', r: [0.9, 0.2, 0.95], p: [0, 0.26, 3.35], rot: [-0.2, 0, 0], col: 'velvet', feather: 0.05 });
    S.paint(pv, { t: 'box', s: [0.07, 0.15, 1.5], p: [0, -0.3, PET.bz], col: 'gold', feather: 0.03 });
    petals.push(pv);
  }
  // ---- lianes-fouets
  const vines = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    S.add(base, { t: 'ell', r: [0.65, 0.55, 0.95], p: [Math.sin(a) * 2.2, 0.5, Math.cos(a) * 2.2], rot: [0, a, 0], col: 'vine', k: 0.35, fuzz: [0.04, 3] });
    const chain = [];
    let vp = base;
    for (let k = 0; k < 4; k++) {
      const seg = B(vp, k === 0 ? [Math.sin(a) * 2.6, 0.6, Math.cos(a) * 2.6] : [0, 0, 1.6], 'vine' + i + k, k === 0 ? [-0.7, a, 0] : [0.25, 0, 0]);
      seg.rotation.order = 'YXZ';
      const r1 = 0.52 - k * 0.1, r2 = 0.44 - k * 0.1;
      S.add(seg, { t: 'cone', a: [0, 0, 0], b: [0, 0, 1.7], r1, r2, col: 'vine', k: 0.15, skinSoft: 0.15, fuzz: [0.025, 3.5] });
      if (k > 0) S.add(seg, { t: 'ell', r: [r1 + 0.09, r1 + 0.07, 0.26], p: [0, 0, 0.02], col: 'vineD', k: 0.1, skinSoft: 0.12, fuzz: [0.03, 4] });
      S.paint(seg, { t: 'cone', a: [0, -r1, 0], b: [0, -r2, 1.7], r1: r1 * 0.75, r2: r2 * 0.75, col: 'vineL', feather: 0.12 });
      if (k === 3) S.add(seg, { t: 'ell', r: [0.36, 0.34, 0.55], p: [0, 0, 1.75], col: 'vine', k: 0.15, skinSoft: 0.12, fuzz: [0.03, 4] });
      chain.push(seg);
      vp = seg;
    }
    vines.push(chain);
  }
  skin('reineSpore', { mesh: { cell: 0.085, skinSoft: 0.22, aoDist: 0.16 }, mat: { enemyRim: true, sheenColor: '#ffd0f0' }, outline: 0.03 });

  // ---- pièces rigides des pétales et des lianes
  const pp = petalParts();
  for (const pv of petals) {
    pv.rotation.x = 0.7; // pose de repos : ouverte
    part(pv, pp.gold, M.gold, {});
    part(pv, pp.steel, M.steel, {});
    part(pv, pp.veins, M.pvein, { shadow: false });
  }
  vines.forEach((chain) => chain.forEach((seg, k) => {
    part(seg, vineParts(k), M.organic, {});
    const vm = vineMetal(k);
    if (vm) for (const key in vm) part(seg, vm[key], M[key], {});
  }));

  // ---- corset de tôle violette (greffe du Baron) : lèvres dorées, rivets, feux de signalisation
  const BY = -1.0;
  part(bulb, once('rsBand', () => band(2.14, 0.52, 9, 56)), M.tole, { p: [0, BY, 0] });
  part(bulb, once('rsBandG', () => {
    const L = [];
    for (const y of [-0.27, 0.27]) L.push([G.torus(2.15, 0.06, 6, 56), flat([0, BY + y, 0])]);
    for (let i = 0; i < 27; i++) {
      const f = (i / 27) * TAU, n = [Math.sin(f), 0, Math.cos(f)];
      for (const y of [-0.17, 0.17]) L.push([RIVET(0.055), place([n[0] * 2.15, BY + y, n[2] * 2.15], n)]);
    }
    return bake(L);
  }), M.gold, {});
  for (let i = 0; i < 4; i++) {
    const f = (i / 4) * TAU + Math.PI / 4, n = [Math.sin(f), 0, Math.cos(f)];
    const lamp = joint(bulb, [n[0] * 2.2, BY, n[2] * 2.2]);
    lamp.rotation.y = f;
    part(lamp, G.cyl(0.13, 0.15, 0.1, 12), M.dark, { r: [Math.PI / 2, 0, 0] });
    part(lamp, G.sphere(0.09, 10, 6), i % 2 ? M.amber : M.red, { p: [0, 0, 0.07], shadow: false });
  }
  // nervures lumineuses dans les sillons du bulbe (au-dessus et au-dessous du corset)
  part(bulb, once('rsVeins', () => {
    const L = [];
    const rr = (y) => 2.0 * Math.sqrt(Math.max(0, 1 - (y / 2.25) ** 2)) + 0.09;
    for (let j = 0; j < 8; j++) {
      const c = (j / 8) * TAU + Math.PI / 4;
      const at = (y, w = 0) => [Math.sin(c + w) * rr(y), y, Math.cos(c + w) * rr(y)];
      L.push([tube([at(-0.68), at(-0.1, 0.03), at(0.6, -0.02), at(1.25, 0.02), at(1.62)], 0.045, 0.03, 16, 5), null]);
      L.push([tube([at(-1.32), at(-1.6, 0.02), at(-1.85)], 0.04, 0.03, 6, 5), null]);
      // ramification vers le lobe voisin
      L.push([tube([at(0.3, 0), at(0.55, 0.1), at(0.75, 0.2)], 0.03, 0.02, 6, 4), null]);
    }
    return bake(L);
  }), M.vein, { shadow: false });
  // pustules luminescentes sur les lobes
  part(bulb, once('rsSpots', () => {
    const L = [];
    const rl = (y) => 1.4 + 0.75 * Math.sqrt(Math.max(0, 1 - ((y + 0.2) / 1.75) ** 2)) + 0.02;
    for (let j = 0; j < 8; j++) {
      const b = (j / 8) * TAU + Math.PI / 8;
      for (let q = 0; q < 4; q++) {
        const y = -0.4 + ((j * 7 + q * 3) % 5) * 0.28, w = ((q % 3) - 1) * 0.11 + (j % 2) * 0.05;
        const r = rl(y), s = 0.06 + ((j + q) % 3) * 0.025;
        L.push([G.sphere(s, 8, 6), place([Math.sin(b + w) * r, y, Math.cos(b + w) * r])]);
      }
    }
    return bake(L);
  }), M.vein, { shadow: false });

  // ---- réservoir d'engrais dans le dos (côté gauche), durites vers le bulbe et vers le sol
  const TA = Math.PI + 0.6, TR = 2.58, TY = -0.35;
  const tank = joint(bulb, [Math.sin(TA) * TR, TY, Math.cos(TA) * TR]);
  tank.rotation.y = TA;
  part(tank, once('rsTank', () => band(0.42, 1.3, 2, 22)), M.tole, {});
  part(tank, once('rsTankG', () => {
    const cap = new THREE.SphereGeometry(0.43, 18, 5, 0, TAU, 0, Math.PI / 2).scale(1, 0.45, 1);
    const L = [[cap, place([0, 0.64, 0])], [cap, place([0, -0.64, 0], [0, -1, 0])]];
    L.push([G.torus(0.17, 0.03, 5, 16), flat([0, 0.98, 0])]);
    L.push([G.cyl(0.04, 0.05, 0.22, 8), place([0, 0.88, 0])]);
    for (const f of [0, Math.PI / 2]) L.push([G.box(0.3, 0.025, 0.025), place([0, 0.98, 0], [0, 1, 0], 1, f)]);
    return bake(L);
  }), M.gold, {});
  part(tank, once('rsTankD', () => {
    const L = [];
    for (const y of [-0.42, 0.42]) L.push([G.torus(0.44, 0.04, 5, 22), flat([0, y, 0])]);
    L.push([G.rbox(0.26, 0.98, 0.08, 0.03), place([0, 0, 0.41])]);
    L.push([G.cyl(0.13, 0.13, 0.06, 16), place([0.3, 0.3, 0.3], [0.7, 0, 0.7])]);
    // pattes de fixation sur le corset
    for (const s of [-1, 1]) L.push([G.box(0.12, 0.3, 0.5), place([s * 0.25, -0.62, -0.3])]);
    return bake(L);
  }), M.dark, {});
  part(tank, G.box(0.13, 0.82, 0.05), M.fluid, { p: [0, 0, 0.45], shadow: false });
  part(tank, G.cyl(0.1, 0.1, 0.02, 14), M.face, { p: [0.33, 0.3, 0.33], shadow: false }).quaternion.setFromUnitVectors(_Y, V3([0.7, 0, 0.7]).normalize());
  part(bulb, once('rsHoses', () => {
    const T = (r, y, da = 0) => [Math.sin(TA + da) * r, y, Math.cos(TA + da) * r];
    return bake([
      [tube([T(TR, TY + 0.95), T(TR + 0.1, TY + 1.5), T(2.35, 1.35, -0.12), T(1.95, 1.2, -0.28)], 0.11, 0.11, 40, 8, 9), null],
      [tube([T(TR - 0.05, TY + 0.55, 0.16), T(2.75, 0.5, 0.3), T(2.25, 0.55, 0.45)], 0.08, 0.08, 24, 7, 6), null],
      [tube([T(TR, TY - 0.9), T(TR + 0.2, -1.65, 0.05), T(TR + 0.45, -2.25, 0.1), T(TR + 0.55, -2.75, 0.12)], 0.11, 0.11, 30, 8, 7), null],
    ]);
  }), M.hose, {});

  // ---- cœur-œil (point faible) : globe nacré, iris lumineux serti d'une bague dorée, pupille fendue
  const core = joint(bulb, [0, 2.2, 0]);
  part(core, G.sphere(0.95, 24, 16), M.white, {});
  // l'iris (dôme qui dépasse du globe) regarde vers l'avant, un peu levé : lisible depuis le sol
  const el = 0.38, dy = Math.sin(el), dz = Math.cos(el);
  const iris = part(core, G.sphere(0.6, 20, 14), M.iris, { p: [0, dy * 0.57, dz * 0.57], shadow: false });
  // bague dorée sur le cercle où l'iris sort du globe, pupille fendue, reflet
  part(iris, G.torus(0.575, 0.055, 6, 28), M.gold, { p: [0, dy * 0.19, dz * 0.19], r: [-el, 0, 0] });
  part(iris, G.sphere(0.6, 12, 8), M.pupil, { p: [0, dy * 0.57, dz * 0.57], r: [-el, 0, 0], s: [0.17, 0.5, 0.12], shadow: false });
  part(iris, G.sphere(0.075, 8, 6), glow('#ffffff', 2), { p: [0.2, 0.35, 0.45], shadow: false });
  // couronne dorée de la corolle : charnières des pétales
  part(bulb, once('rsCrown', () => {
    const L = [[G.torus(1.02, 0.1, 8, 40), flat([0, 1.96, 0])]];
    for (let i = 0; i < 12; i++) {
      const f = (i / 12) * TAU + Math.PI / 12, n = [Math.sin(f), 0.3, Math.cos(f)];
      L.push([RIVET(0.05), place([n[0] * 1.1, 1.99, n[2] * 1.1], n)]);
    }
    return bake(L);
  }), M.gold, {});
  // pistils (trois bouquets autour de l'œil, pas devant) et pollen lumineux
  const PA = [Math.PI / 2, Math.PI, -Math.PI / 2];
  const pist = [];
  for (const a0 of PA) for (const da of [-0.22, 0, 0.22]) pist.push([a0 + da, da === 0 ? 1 : 0.82]);
  part(bulb, once('rsPistil', () => bake(pist.map(([a, h]) => {
    const d = (r, y) => [Math.sin(a) * r, y, Math.cos(a) * r];
    return [tube([d(1.12, 1.95), d(1.18, 2.5), d(1.35, 3.0 * h + 0.3), d(1.55, 3.4 * h + 0.25)], 0.075, 0.04, 12, 6), null];
  }))), M.pistil, {});
  part(bulb, once('rsAnther', () => {
    const L = pist.map(([a, h]) => [G.sphere(0.14, 10, 8), place([Math.sin(a) * 1.57, 3.4 * h + 0.36, Math.cos(a) * 1.57], [0, 1, 0], [1, 1.35, 1])]);
    return bake(L);
  }), M.anther, { shadow: false });
  part(bulb, once('rsPollen', () => {
    const L = [];
    for (let i = 0; i < 16; i++) {
      const a = PA[i % 3] + ((i * 37) % 11 - 5) * 0.1, r = 1.3 + ((i * 13) % 7) * 0.12, y = 3.0 + ((i * 17) % 9) * 0.13;
      L.push([G.sphere(0.035 + (i % 3) * 0.015, 6, 4), place([Math.sin(a) * r, y, Math.cos(a) * r])]);
    }
    return bake(L);
  }), M.spore, { shadow: false });

  return { root, debrisColor: '#3a8a5a', base, bulb, petals, vines, core, iris, chunks: [tank] };
}

// ===================================================================== Bulbe luminescent
// Point faible satellite de la Reine Spore : même famille (sépales blindés à liseré doré, collier de tôle du Baron),
// une lanterne de lumière au creux de quatre sépales, au bout d'une tige noueuse plantée dans une motte.
export function bulbe() {
  const M = mats();
  const { S, root, B, skin } = rig({
    soil: { color: '#4a3424', rough: 0.95 },
    root: { color: '#5e4630', rough: 0.8, sheen: 0.4 },
    stalk: { color: '#2a6a4a', rough: 0.62, sheen: 0.5 },
    stalkD: { color: '#173f2e', rough: 0.7, sheen: 0.3 },
    lip: { color: '#8a2a6a', rough: 0.5, sheen: 0.9 },
    armor: { color: '#c04a9a', rough: 0.3, metal: 0.25, sheen: 0.2, coat: 0.85 },
    velvet: { color: '#ee7abd', rough: 0.85, sheen: 1 },
    gold: { color: C.gold, rough: 0.25, metal: 0.85, coat: 0.4 },
  });
  // motte et racines (fixes)
  const sole = B(root, [0, 0, 0], 'motte');
  S.add(sole, { t: 'ell', r: [0.8, 0.2, 0.8], p: [0, -0.06, 0], col: 'soil', k: 0.12, fuzz: [0.03, 5] });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + 0.4;
    const d = (r, y) => [Math.sin(a) * r, y, Math.cos(a) * r];
    S.add(sole, { t: 'cone', a: d(0.15, 0.3), b: d(0.55, 0.08), r1: 0.13, r2: 0.08, col: 'root', k: 0.08, fuzz: [0.015, 8] });
    S.add(sole, { t: 'cone', a: d(0.55, 0.08), b: d(0.85, -0.15), r1: 0.08, r2: 0.04, col: 'root', k: 0.05 });
  }
  // tige noueuse (os animé : balancement)
  const st = B(root, [0, 0, 0], 'stalk');
  S.add(st, { t: 'cone', a: [0, 0, 0], b: [0.05, 0.8, 0], r1: 0.27, r2: 0.2, col: 'stalk', k: 0.1, fuzz: [0.012, 7] });
  S.add(st, { t: 'cone', a: [0.05, 0.8, 0], b: [0, 1.5, 0], r1: 0.2, r2: 0.16, col: 'stalk', k: 0.1, fuzz: [0.012, 7] });
  S.add(st, { t: 'ell', r: [0.26, 0.11, 0.26], p: [0.05, 0.55, 0], col: 'stalkD', k: 0.06 });
  S.add(st, { t: 'ell', r: [0.2, 0.09, 0.2], p: [0.02, 1.25, 0], col: 'stalkD', k: 0.06 });
  // feuille
  S.add(st, { t: 'ell', r: [0.08, 0.32, 0.18], p: [0.25, 0.42, 0.1], rot: [0.3, 0, -0.9], col: 'stalk', k: 0.06 });
  // calice charnu sous la lanterne
  S.add(st, { t: 'ell', r: [0.3, 0.18, 0.3], p: [0, 1.58, 0], col: 'lip', k: 0.1 });
  const seps = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    const sp = B(st, [Math.sin(a) * 0.27, 1.55, Math.cos(a) * 0.27], 'sepale' + i, [-0.7, a, 0]);
    sp.rotation.order = 'YXZ';
    // sépale : limbe doré, revers laqué, intérieur velouté (même recette que les pétales de la Reine)
    S.add(sp, { t: 'ell', r: [0.3, 0.085, 0.55], p: [0, 0, 0.5], col: 'gold', k: 0.04 });
    S.add(sp, { t: 'cone', a: [0, 0.03, 0.9], b: [0, 0.14, 1.18], r1: 0.12, r2: 0.02, col: 'gold', k: 0.04 });
    S.paint(sp, { t: 'ell', r: [0.28, 0.1, 0.53], p: [0, -0.06, 0.48], col: 'armor', feather: 0.02 });
    S.paint(sp, { t: 'ell', r: [0.275, 0.1, 0.52], p: [0, 0.08, 0.48], col: 'velvet', feather: 0.02 });
    seps.push(sp);
  }
  skin('bulbe', { mesh: { cell: 0.046, skinSoft: 0.05, aoDist: 0.04 }, mat: { enemyRim: true, sheenColor: '#ffd0f0' } });
  // rivets des sépales
  const rv = once('rsSepRiv', () => bake([0.25, 0.55, 0.82].map((z) => [RIVET(0.035), place([0, -0.085 * Math.sqrt(1 - ((z - 0.5) / 0.55) ** 2) - 0.002, z], [0, -1, 0])])));
  for (const sp of seps) part(sp, rv, M.gold, {});
  // collier de tôle et sa durite qui plonge dans la motte
  part(st, once('rsBulbCol', () => band(0.21, 0.2, 2, 18)), M.tole, { p: [0.04, 0.92, 0] });
  part(st, once('rsBulbColG', () => {
    const L = [];
    for (const y of [-0.1, 0.1]) L.push([G.torus(0.215, 0.025, 5, 18), flat([0.04, 0.92 + y, 0])]);
    for (let i = 0; i < 6; i++) {
      const f = (i / 6) * TAU, n = [Math.sin(f), 0, Math.cos(f)];
      L.push([RIVET(0.03), place([0.04 + n[0] * 0.215, 0.92, n[2] * 0.215], n)]);
    }
    return bake(L);
  }), M.gold, {});
  part(st, once('rsBulbHose', () => tube([[-0.18, 0.9, -0.05], [-0.3, 0.75, -0.08], [-0.4, 0.35, -0.1], [-0.45, -0.1, -0.12]], 0.045, 0.045, 18, 6, 6)), M.hose, {});
  part(st, G.sphere(0.04, 8, 6), M.red, { p: [0.04, 0.92, 0.23], shadow: false });
  // lanterne (point faible) et spores qui en émanent
  const light = part(st, G.sphere(0.45, 22, 16), M.pod, { p: [0, 2.03, 0], shadow: false });
  // nervures lumineuses le long de la tige (comme sur le bulbe de la Reine)
  part(st, once('rsBulbVein', () => bake([0.6, 2.5, 4.4].map((f) => {
    const at = (y, r) => [0.03 + Math.sin(f) * r, y, Math.cos(f) * r];
    return [tube([at(0.12, 0.27), at(0.45, 0.25), at(0.8, 0.225), at(1.15, 0.195), at(1.45, 0.17)], 0.022, 0.016, 12, 4), null];
  }))), M.vein, { shadow: false });
  part(st, once('rsBulbSpores', () => bake([[0.35, 2.6, 0.1, 0.05], [-0.3, 2.75, -0.15, 0.04], [0.05, 2.9, 0.3, 0.035], [-0.15, 2.5, 0.38, 0.03], [0.4, 2.85, -0.25, 0.03]]
    .map(([x, y, z, r]) => [G.sphere(r, 6, 4), place([x, y, z])]))), M.spore, { shadow: false });
  return { root, debrisColor: '#e8ffb0', st, light, chunks: [] };
}
