import * as THREE from 'three';
import { G, part, joint, mergeGeometries } from '../geo.js';
import { mat, glow } from '../../engine/materials.js';
import { paintedMetalTexture } from '../../engine/textures.js';
import { rig } from './common.js';

// ===================================================================== Bourdon
// Drone-abeille : abdomen en anneaux de tôle télescopiques rayés jaune/noir (peinture écaillée), thorax mécanique
// (carter des moteurs, grilles, plastron), tête casquée rivetée au gros œil rouge, rotors carénés, dard-canon sous
// la taille, pattes articulées repliées. Avant = +z ; le corps sculpté porte thorax et tête, le reste en pièces.

const TAU = Math.PI * 2;
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _s = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0);

// Copie posée d'une géométrie (non indexée, attributs position/normal/uv seulement) : p, r (Euler), s (échelle)
function at(g, p = [0, 0, 0], r = [0, 0, 0], s = 1) {
  const c = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(c.attributes)) if (!['position', 'normal', 'uv'].includes(k)) c.deleteAttribute(k);
  _q.setFromEuler(_e.set(r[0], r[1], r[2]));
  if (typeof s === 'number') _s.setScalar(s); else _s.set(s[0], s[1], s[2]);
  return c.applyMatrix4(_m4.compose(_a.set(p[0], p[1], p[2]), _q, _s));
}
// Tube conique de a (rayon r0) à b (rayon r1)
function tube(a, b, r0, r1 = r0, seg = 8) {
  _a.set(a[0], a[1], a[2]); _b.set(b[0], b[1], b[2]);
  const d = _b.clone().sub(_a), l = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, l, seg, 1).toNonIndexed();
  _q.setFromUnitVectors(_y, d.normalize());
  return g.applyMatrix4(_m4.compose(_a.add(_b).multiplyScalar(0.5), _q, _s.setScalar(1)));
}
// Profil de révolution autour de l'axe z : pts [[r, z]…] de l'avant (+z) vers l'arrière ; uRep : panneaux sur le tour
function latheZ(pts, segs = 32, uRep = 1) {
  const g = new THREE.LatheGeometry(pts.slice().reverse().map(([r, z]) => new THREE.Vector2(r, z)), segs);
  g.rotateX(Math.PI / 2); // y du profil → z, couture en dessous
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * uRep);
  return g.toNonIndexed();
}
function merged(list) {
  const g = mergeGeometries(list);
  for (const p of list) p.dispose();
  g.userData.shared = true;
  return g;
}
// Rivet bombé tourné vers n, posé en p
const RIVET = new THREE.SphereGeometry(1, 7, 3, 0, TAU, 0, Math.PI / 2);
function rivet(p, n, r = 0.012) {
  const g = RIVET.clone().scale(r, r * 0.55, r).toNonIndexed();
  _q.setFromUnitVectors(_y, _b.set(n[0], n[1], n[2]).normalize());
  return g.applyMatrix4(_m4.compose(_a.set(p[0], p[1], p[2]), _q, _s.setScalar(1)));
}

// ---- abdomen : profil de l'œuf (t : 0 à la taille → 1 à la pointe), z = -t × ABD_L dans le repère de l'abdomen
const ABD_L = 0.84;
const egg = (t) => {
  const c = 0.36, w = t < c ? 0.52 : 0.7;
  return 0.37 * Math.sqrt(Math.max(0.015, 1 - ((t - c) / w) ** 2));
};
const ROT = [0.4, 0.24]; // centre du rotor dans le repère du bras
const DR = 0.245; // rayon extérieur du carénage
const BANDS = [-0.02, 0.19, 0.37, 0.54, 0.7, 0.84]; // limites des anneaux (jaune, noir, jaune, noir, jaune)
const scaleOf = (i) => 1 + 0.032 * (BANDS.length - 2 - i); // chaque anneau coiffe le suivant

let GEO = null;
function geos() {
  if (GEO) return GEO;
  GEO = {};
  const Z = (t) => -t * ABD_L;
  // anneaux de tôle télescopiques : bord avant glissé sous l'anneau précédent, bourrelet roulé à l'arrière
  const yel = [], blk = [], riv = [];
  for (let i = 0; i < BANDS.length - 1; i++) {
    const a = BANDS[i], b = BANDS[i + 1], s = scaleOf(i), sn = i < BANDS.length - 2 ? scaleOf(i + 1) : 0.97;
    const P = [];
    if (i === 0) for (const [r, t] of [[0.03, -0.1], [0.12, -0.092], [0.19, -0.07], [0.24, -0.035]]) P.push([r, Z(t)]);
    else P.push([egg(a - 0.06) * s - 0.012, Z(a - 0.06)]);
    for (let k = 0; k <= 8; k++) {
      const t = a + (b - a) * (k / 8);
      // nervure en relief juste derrière le bord avant
      const rib = Math.exp(-(((t - a - 0.03) / 0.012) ** 2)) * 0.007;
      P.push([egg(t) * s + rib, Z(t)]);
    }
    const rb = egg(b) * s;
    P.push([rb + 0.009, Z(b + 0.006)], [rb + 0.008, Z(b + 0.02)], [rb - 0.004, Z(b + 0.028)]);
    P.push([egg(b + 0.02) * sn + 0.004, Z(b + 0.02)], [egg(b - 0.03) * sn + 0.003, Z(b - 0.03)]);
    (i % 2 ? blk : yel).push(latheZ(P, 36, 4));
    // rivets le long de la nervure avant (pas sur le dessous, caché)
    const rr = egg(a + 0.045) * s, n = 14;
    for (let k = 0; k < n; k++) {
      const ph = ((k + 0.5) / n) * TAU;
      const nx = Math.sin(ph), ny = -Math.cos(ph);
      if (ny < -0.75) continue;
      riv.push(rivet([nx * rr, ny * rr, Z(a + 0.045)], [nx, ny, 0.25]));
    }
  }
  // pointe : cône noir puis aiguillon chromé
  const tip = [];
  const t0 = BANDS[BANDS.length - 1];
  for (let k = 0; k <= 8; k++) { const t = t0 - 0.05 + (1.04 - t0 + 0.05) * (k / 8); tip.push([egg(t) * 0.97, Z(t)]); }
  tip.push([0.035, Z(1.055)], [0.0, Z(1.06)]);
  blk.push(latheZ(tip, 36, 4));
  GEO.ringsY = merged(yel);
  GEO.ringsB = merged(blk);
  GEO.ringRivets = merged(riv);
  GEO.stinger = merged([at(G.cone(0.028, 0.11, 10), [0, 0, Z(1.06) - 0.045], [-Math.PI / 2, 0, 0]), at(G.torus(0.045, 0.011, 6, 16), [0, 0, Z(1.045)])]);

  // durites : de sous le thorax jusqu'au premier anneau (repère du corps)
  const hoses = [];
  for (const s of [-1, 1]) {
    const c = new THREE.CatmullRomCurve3([[s * 0.13, -0.17, 0.08], [s * 0.19, -0.22, -0.04], [s * 0.2, -0.17, -0.16], [s * 0.18, -0.08, -0.22]].map((p) => new THREE.Vector3(...p)));
    hoses.push(new THREE.TubeGeometry(c, 14, 0.018, 6).toNonIndexed());
    for (let k = 1; k < 6; k++) {
      const p = c.getPointAt(k / 6), tg = c.getTangentAt(k / 6);
      _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tg);
      hoses.push(G.torus(0.02, 0.006, 4, 10).toNonIndexed().applyMatrix4(_m4.compose(p, _q, _s.setScalar(1))));
    }
  }
  GEO.hoses = merged(hoses.map((g) => { g.deleteAttribute('uv'); return g; }));

  // carter des moteurs sur le dos : bloc peint, grille à ailettes, deux sorties d'air
  GEO.carter = merged([at(G.rbox(0.22, 0.08, 0.24, 0.03, 2), [0, 0, 0])]);
  GEO.carterDark = merged([
    at(G.box(0.15, 0.02, 0.17), [0, 0.033, 0]),
    ...[-1, 1].map((s) => at(G.cyl(0.03, 0.035, 0.05, 10, true), [s * 0.075, 0.0, -0.13], [Math.PI / 2, 0, 0])),
  ]);
  const louv = [];
  for (let k = 0; k < 6; k++) louv.push(at(G.rbox(0.16, 0.012, 0.024, 0.005, 1), [0, 0.045, -0.07 + k * 0.028], [-0.5, 0, 0]));
  for (const s of [-1, 1]) for (const z of [-0.09, 0.09]) louv.push(at(G.bolt(0.012), [s * 0.093, 0.04, z]));
  GEO.carterSteel = merged(louv);

  // pattes repliées : trois paires sous le thorax (repère du corps)
  const legs = [], knuck = [];
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const z = 0.33 - k * 0.1, sp = 1 + k * 0.08;
      const hip = [s * 0.1, -0.2, z], knee = [s * 0.21 * sp, -0.3, z + 0.03 - k * 0.03], foot = [s * 0.13 * sp, -0.39, z - 0.1 - k * 0.02];
      const claw = [foot[0] + s * 0.015, foot[1] - 0.045, foot[2] + 0.035];
      legs.push(tube(hip, knee, 0.024, 0.019, 7), tube(knee, foot, 0.017, 0.011, 7), tube(foot, claw, 0.011, 0.002, 5));
      // vérin le long du fémur
      legs.push(tube([hip[0] * 0.9, hip[1] + 0.03, hip[2]], [knee[0] * 0.8, knee[1] + 0.04, knee[2]], 0.009, 0.009, 5));
      knuck.push(at(G.sphere(0.03, 8, 6), hip), at(G.sphere(0.024, 8, 6), knee), at(G.sphere(0.015, 6, 4), foot));
    }
  }
  GEO.legs = merged(legs);
  GEO.knuck = merged(knuck);

  // bras de rotor (repère du bras, axe x vers l'extérieur ; côté gauche, miroir par l'échelle -1 en x) : tube coudé
  // vers le haut jusqu'au moteur, centre du rotor en ROT
  const [rx, ry] = ROT, el = [0.2, 0.05, 0];
  GEO.arm = merged([
    tube([0, 0, 0], el, 0.04, 0.036, 10), tube(el, [rx - 0.04, ry - 0.06, 0], 0.036, 0.03, 10),
    at(G.sphere(0.042, 10, 8), el),
    tube([0.02, -0.06, 0], [rx - 0.06, ry - 0.1, 0], 0.012, 0.01, 6), // jambe de force
    at(G.cyl(0.056, 0.05, 0.1, 14), [rx, ry - 0.06, 0]), // moteur et ses ailettes
    ...[0, 1, 2].map((k) => at(G.torus(0.058, 0.008, 5, 14), [rx, ry - 0.09 + k * 0.025, 0], [Math.PI / 2, 0, 0])),
    // trois bras de carénage
    ...[0, 1, 2].map((k) => { const a = (k / 3) * TAU + Math.PI / 6; return at(G.box(0.17, 0.014, 0.02), [rx + Math.cos(a) * 0.13, ry - 0.03, Math.sin(a) * 0.13], [0, -a, 0]); }),
  ]);
  GEO.armSteel = merged([
    tube([0.01, 0, 0], [0.05, 0.01, 0], 0.048, 0.048, 12), tube([0.27, 0.11, 0], [0.31, 0.135, 0], 0.044, 0.044, 12), // colliers
    tube([0.02, 0.04, 0.02], [0.2, 0.09, 0.02], 0.008, 0.008, 5), tube([0.2, 0.09, 0.02], [rx - 0.06, ry - 0.02, 0.02], 0.008, 0.008, 5), // câble
  ]);
  // carénage : anneau au profil d'aile
  GEO.duct = latheZ([[0.272, 0.04], [0.296, 0.05], [0.316, 0.038], [0.322, 0.0], [0.316, -0.03], [0.296, -0.04], [0.278, -0.028], [0.272, 0.0], [0.272, 0.04]].map(([r, z]) => [r * DR / 0.322, z * 0.9]), 40, 6);
  GEO.duct.rotateX(-Math.PI / 2); // l'axe du profil (z) devient y : anneau horizontal
  GEO.duct.userData.shared = true;
  GEO.ductRivets = merged(Array.from({ length: 12 }, (_, k) => { const a = (k / 12) * TAU; return rivet([Math.cos(a) * DR * 0.95, 0.041, Math.sin(a) * DR * 0.95], [Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5], 0.009); }));
  // pales profilées : effilées et vrillées
  const BL = DR * 0.85 - 0.04;
  const bl = new THREE.BoxGeometry(BL, 0.01, 0.07, 6, 1, 1);
  const p = bl.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / BL + 0.5, w = 1 - 0.45 * u * u, tw = 0.5 - 0.32 * u;
    const y = p.getY(i), z = p.getZ(i) * w + 0.012 * u;
    p.setXYZ(i, p.getX(i) + 0.04 + BL / 2, y * Math.cos(tw) - z * Math.sin(tw), y * Math.sin(tw) + z * Math.cos(tw));
  }
  bl.computeVertexNormals();
  GEO.blades = merged([0, 1, 2, 3].map((k) => at(bl, [0, 0, 0], [0, (k / 4) * TAU, 0])));
  bl.dispose();
  GEO.hub = merged([at(G.lathe('bourdonHub', [[0, -0.015], [0.045, -0.015], [0.045, 0.0], [0.035, 0.035], [0.02, 0.055], [0, 0.06]], 14))]);
  return GEO;
}

let MAT = null;
function mats() {
  if (MAT) return MAT;
  const y = paintedMetalTexture('#ffd23c', null, { chip: 0.5, edge: 0.8, rust: 0.08, bare: '#c9ccd6', tile: 2 });
  const k = paintedMetalTexture('#2a2438', null, { chip: 0.45, edge: 0.9, rust: 0.08, bare: '#a8aec0', tile: 2 });
  const d = paintedMetalTexture('#3d3a52', null, { chip: 0.25, edge: 0.8, bare: '#b8bfd0' });
  MAT = {
    yellow: mat('#ffffff', { map: y.map, normalMap: y.normalMap, rough: 0.38, metal: 0.35, coat: 0.7, side: THREE.DoubleSide }),
    black: mat('#ffffff', { map: k.map, normalMap: k.normalMap, rough: 0.42, metal: 0.5, coat: 0.45, side: THREE.DoubleSide }),
    blackS: mat('#ffffff', { map: k.map, normalMap: k.normalMap, rough: 0.42, metal: 0.5, coat: 0.45 }),
    yellowS: mat('#ffffff', { map: y.map, normalMap: y.normalMap, rough: 0.38, metal: 0.35, coat: 0.7 }),
    carter: mat('#ffffff', { map: d.map, normalMap: d.normalMap, rough: 0.4, metal: 0.6, coat: 0.3 }),
    dark: mat('#2a2438', { rough: 0.4, metal: 0.55, coat: 0.5 }),
    gun: mat('#4d5068', { rough: 0.32, metal: 0.8 }),
    steel: mat('#c3cad8', { rough: 0.25, metal: 0.9 }),
    slot: mat('#0d0a12', { rough: 0.8 }),
    rubber: mat('#1c1922', { rough: 0.75, metal: 0.1 }),
    blade: mat('#dfe5f0', { rough: 0.28, metal: 0.75 }),
    blur: mat('#e6eeff', { rough: 0.3, transparent: true, opacity: 0.16, side: THREE.DoubleSide }),
    eye: glow('#ff1c14', 1.4),
    eyeCore: glow('#ffb8a0', 2.2),
    shine: glow('#fff0f0', 2),
    muzzle: glow('#ff6a3a', 2),
    nav: glow('#ff4a3a', 2.4),
  };
  return MAT;
}

export function bourdon() {
  const { S, root, B, skin } = rig({
    yellow: { color: '#ffc22e', rough: 0.35, metal: 0.3, sheen: 0.25, coat: 0.85 },
    black: { color: '#2a2438', rough: 0.4, metal: 0.55, coat: 0.45 },
    gun: { color: '#565b74', rough: 0.3, metal: 0.8, coat: 0.25 },
    slot: { color: '#0e0b14', rough: 0.75, metal: 0.2 },
  });
  const M = mats(), Q = geos();
  const body = B(root, [0, 0, 0], 'body');
  // thorax : coque sombre, plastron jaune vers la tête, plaque ventrale, épaulières des bras de rotor
  S.add(body, { t: 'ell', r: [0.27, 0.25, 0.27], p: [0, 0.03, 0.15], col: 'black', k: 0.05 });
  S.add(body, { t: 'ell', r: [0.25, 0.23, 0.1], p: [0, 0.05, 0.35], col: 'yellow', k: 0.06 });
  S.paint(body, { t: 'box', s: [0.3, 0.3, 0.012], p: [0, 0.05, 0.3], col: 'slot', feather: 0.006 });
  S.add(body, { t: 'ell', r: [0.17, 0.08, 0.21], p: [0, -0.19, 0.16], col: 'gun', k: 0.04 });
  for (const s of [-1, 1]) {
    S.add(body, { t: 'ell', r: [0.1, 0.07, 0.15], p: [s * 0.19, 0.17, 0.13], rot: [0, 0, s * 0.7], col: 'gun', k: 0.03 });
    S.add(body, { t: 'cyl', r: 0.065, h: 0.04, round: 0.012, p: [s * 0.28, 0.2, 0.13], rot: [0, 0, Math.PI / 2], col: 'gun', k: 0.015 });
    // grilles d'aération sur les flancs
    for (let j = 0; j < 3; j++) S.sub(body, { t: 'box', s: [0.06, 0.012, 0.07], round: 0.008, p: [s * 0.29, -0.03 - j * 0.05, 0.12], col: 'slot', k: 0.008 });
  }
  // tête casquée : casque jaune à crête sombre, oreillettes boulonnées, orbite de l'œil, visière
  const head = B(body, [0, 0.08, 0.5], 'head');
  S.add(head, { t: 'sph', r: 0.2, col: 'black', k: 0.05 });
  S.add(head, { t: 'ell', r: [0.228, 0.19, 0.235], p: [0, 0.055, -0.02], col: 'yellow', k: 0.02 });
  S.add(head, { t: 'ell', r: [0.032, 0.05, 0.2], p: [0, 0.205, -0.04], col: 'black', k: 0.012 });
  S.sub(head, { t: 'ell', r: [0.19, 0.11, 0.14], p: [0, -0.03, 0.18], col: 'black', k: 0.025 });
  S.sub(head, { t: 'sph', r: 0.15, p: [0, 0, 0.2], col: 'slot', k: 0.015 });
  for (const s of [-1, 1]) S.add(head, { t: 'cyl', r: 0.07, h: 0.025, round: 0.01, p: [s * 0.215, 0.01, -0.02], rot: [0, 0, Math.PI / 2], col: 'gun', k: 0.015 });
  skin('bourdon', { mesh: { cell: 0.015, skinSoft: 0.03 }, mat: { enemyRim: true } });

  // œil : lentille rouge, iris sombre, cœur clair, reflet ; cerclage chromé dans l'orbite
  const eye = joint(head, [0, 0.0, 0.16]);
  part(eye, G.sphere(0.12, 18, 12), M.eye, { shadow: false });
  part(eye, G.torus(0.064, 0.007, 5, 20), M.slot, { p: [0, 0, 0.1], shadow: false });
  part(eye, G.sphere(0.032, 10, 8), M.eyeCore, { p: [0, 0, 0.098], shadow: false });
  part(eye, G.sphere(0.028, 8, 6), M.shine, { p: [0.045, 0.055, 0.095], shadow: false });
  part(head, G.torus(0.14, 0.02, 8, 28), M.steel, { p: [0, 0, 0.142] });
  // rivets du casque (bord et crête), antennes, mandibules
  const hr = [], ant = [], ab = [];
  for (let k = 0; k < 11; k++) {
    const a = Math.PI * (0.16 + 0.68 * (k / 10)) + Math.PI / 2; // de flanc à flanc par l'arrière
    const x = Math.cos(a) * 0.225, z = Math.sin(a) * 0.232 - 0.02;
    hr.push(rivet([x, 0.05, z], [x, 0.15, z + 0.02], 0.013));
  }
  for (const s of [-1, 1]) {
    for (const t of [-0.15, -0.05, 0.05, 0.15]) hr.push(rivet([s * 0.03, 0.235 - Math.abs(t) * 0.3, t - 0.04], [s, 0.6, 0], 0.01));
    const p0 = [s * 0.08, 0.215, 0.07], p1 = [s * 0.14, 0.33, 0.14], p2 = [s * 0.2, 0.37, 0.27];
    ant.push(tube(p0, p1, 0.013, 0.011, 6), tube(p1, p2, 0.011, 0.008, 6));
    ab.push(at(G.sphere(0.026, 10, 8), p2), at(G.sphere(0.017, 8, 6), p1), at(G.cyl(0.025, 0.03, 0.03, 10), p0));
    // mandibules en pince
    ant.push(at(G.cone(0.026, 0.13, 6), [s * 0.065, -0.17, 0.17], [2.5, 0, s * 0.35], [1, 1, 0.55]));
  }
  part(head, merged(hr), M.steel, { shadow: false });
  part(head, merged(ant), M.dark, {});
  part(head, merged(ab), M.yellowS, {});

  // abdomen télescopique, légèrement tombant ; durites et carter
  const abd = joint(body, [0, 0.04, -0.1]);
  abd.rotation.x = -0.18;
  part(abd, Q.ringsY, M.yellow, { outline: 0.016 });
  part(abd, Q.ringsB, M.black, { outline: 0.016 });
  part(abd, Q.ringRivets, M.steel, { shadow: false });
  part(abd, Q.stinger, M.steel, {});
  part(body, Q.hoses, M.rubber, {});
  const carter = joint(body, [0, 0.27, 0.12]);
  carter.rotation.x = -0.12;
  part(carter, Q.carter, M.carter, { outline: 0.012 });
  part(carter, Q.carterDark, M.slot, { shadow: false });
  part(carter, Q.carterSteel, M.steel, {});
  part(body, Q.legs, M.dark, {});
  part(body, Q.knuck, M.steel, {});

  // dard-canon sous la taille : rotule, canon effilé à bagues, bouche lumineuse
  const sting = joint(body, [0, -0.27, -0.2]);
  sting.rotation.x = -0.75;
  part(sting, G.sphere(0.08, 14, 10), M.gun, {});
  part(sting, G.cyl(0.056, 0.022, 0.32, 12), M.blackS, { p: [0, -0.18, 0], outline: 0.01 });
  part(sting, G.torus(0.056, 0.014, 6, 16), M.yellowS, { p: [0, -0.08, 0], r: [Math.PI / 2, 0, 0] });
  part(sting, G.torus(0.04, 0.01, 6, 14), M.steel, { p: [0, -0.22, 0], r: [Math.PI / 2, 0, 0] });
  part(sting, G.torus(0.025, 0.009, 6, 14), M.muzzle, { p: [0, -0.34, 0], r: [Math.PI / 2, 0, 0], shadow: false });
  part(sting, G.sphere(0.018, 8, 6), M.muzzle, { p: [0, -0.342, 0], shadow: false });

  // rotors carénés sur bras inclinés (le bras se détache en morceau à la mort)
  const rotors = [];
  for (const s of [-1, 1]) {
    const arm = joint(body, [s * 0.29, 0.2, 0.13]);
    const side = joint(arm, [0, 0, 0]);
    side.scale.x = s;
    part(side, Q.arm, M.gun, {});
    part(side, Q.armSteel, M.steel, {});
    const [rx, ry] = ROT;
    part(side, Q.duct, M.blackS, { p: [rx, ry, 0], outline: 0.012 });
    part(side, G.torus(DR, 0.008, 5, 48), M.yellowS, { p: [rx, ry, 0], r: [Math.PI / 2, 0, 0] });
    part(side, Q.ductRivets, M.steel, { p: [rx, ry, 0], shadow: false });
    part(side, G.sphere(0.02, 8, 6), M.nav, { p: [rx + DR + 0.004, ry, 0], shadow: false });
    part(side, G.cyl(DR * 0.84, DR * 0.84, 0.004, 32), M.blur, { p: [rx, ry + 0.02, 0], shadow: false });
    const rot = joint(arm, [s * rx, ry + 0.01, 0]);
    part(rot, Q.blades, M.blade, { shadow: false });
    part(rot, Q.hub, M.steel, {});
    rotors.push(rot);
  }
  return { root, debrisColor: '#ffcc33', body, head, eye, rotors, chunks: [sting, rotors[0].parent, rotors[1].parent] };
}
