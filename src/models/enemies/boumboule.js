import * as THREE from 'three';
import { G, part, joint, mtx, mergeGeometries } from '../geo.js';
import { mat, glow } from '../../engine/materials.js';
import { paintedMetalTexture } from '../../engine/textures.js';
import { rng } from '../../engine/util.js';
import { Sculpt, bone, sculptSkin } from '../sculpt.js';
import { OL, rig } from './common.js';

// ===================================================================== Boum-Boule
// Bombe roulante : coque cerclée d'orange, masque grimaçant qui ne roule pas, mèche crépitante.
// La coque (os « ball », seul à rouler autour de x) est en fonte : deux hémisphères soudés de part et d'autre d'un
// cerclage orange (bande de roulement) fermé par une boucle boulonnée, pochoir « danger » écaillé sur les flancs,
// éraflures de roulage. Le harnais qui ne roule pas (« face ») porte le masque — casque à crête où se visse le culot
// de la mèche — et suit le gonflement de la coque pendant le compte à rebours.

const R0 = 0.47; // rayon de la coque
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _e = new THREE.Euler(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
// rotation (euler XYZ) qui envoie l'axe local x sur ax et l'axe local y sur ay (orthogonalisés)
function basis(ax, ay) {
  _b.copy(ay).normalize();
  _a.copy(ax).addScaledVector(_b, -ax.dot(_b)).normalize();
  _c.crossVectors(_a, _b);
  _e.setFromRotationMatrix(_m.makeBasis(_a, _b, _c));
  return [_e.x, _e.y, _e.z];
}
// rotation qui oriente l'axe local y (axe des cylindres, hexagones) selon n
const yTo = (n) => basis(Math.abs(n.x) < 0.9 ? X : Y, n);

// pièces fixes fusionnées en une géométrie partagée
function merged(list) {
  const g = mergeGeometries(list.map((x) => (x.index ? x.toNonIndexed() : x)));
  g.userData.shared = true;
  return g;
}

// masque : coquille de rayon RM concentrique à la coque ; front(x, y) = profondeur de la surface (z) en (x, y)
const RM = 0.575;
const front = (x, y, r = RM) => Math.sqrt(Math.max(0, r * r - x * x - y * y));
// repère de la mâchoire (penchée comme la plaque à sa hauteur) : onJaw(x, y, r) = point à la distance r du centre
const JA = Math.atan2(0.165, front(0, -0.165));
const JN = new THREE.Vector3(0, -Math.sin(JA), Math.cos(JA)), JV = new THREE.Vector3(0, Math.cos(JA), Math.sin(JA));
const onJaw = (x, y, r) => JN.clone().multiplyScalar(r).addScaledVector(JV, y).add(new THREE.Vector3(x, 0, 0)).toArray();

const GEO = {};
// dents serrées (pièces rigides, plus nettes que sculptées) : une en or, une manquante
function teethGeo() {
  if (GEO.teeth) return GEO;
  const teeth = [], gold = [];
  for (let i = 0; i < 6; i++) {
    const x = (i - 2.5) * 0.058;
    for (const [y, row] of [[0.03, 0], [-0.031, 1]]) {
      if (row === 1 && i === 4) continue;
      const yy = y + (row ? 0.008 : -0.008) * (Math.abs(x) / 0.145) ** 2;
      const g = G.rbox(0.05, 0.056, 0.03, 0.012, 2).clone().applyMatrix4(mtx(onJaw(x, yy, RM + 0.022 - Math.abs(x) * 0.12), [JA, -x * 1.2, 0]));
      (row === 0 && i === 1 ? gold : teeth).push(g);
    }
  }
  GEO.teeth = merged(teeth);
  GEO.gold = merged(gold);
  return GEO;
}

// paupière : calotte haute d'une sphère, un peu plus grosse que le globe de l'œil
function lidGeo() {
  if (!GEO.lid) {
    GEO.lid = new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, 1.25).scale(0.094, 0.088, 0.062);
    GEO.lid.userData.shared = true;
  }
  return GEO.lid;
}

// ---- mèche tressée : trois brins enroulés autour d'une courbe (une seule géométrie)
function braid(curve) {
  if (GEO.braid) return GEO.braid;
  const parts = [];
  const N = 30, turns = 5, rr = 0.011;
  for (let s = 0; s < 3; s++) {
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, p = curve.getPointAt(t), tg = curve.getTangentAt(t);
      const side = new THREE.Vector3().crossVectors(tg, X).normalize();
      const up = new THREE.Vector3().crossVectors(side, tg).normalize();
      const a = t * turns * Math.PI * 2 + (s * Math.PI * 2) / 3;
      pts.push(p.clone().addScaledVector(side, Math.cos(a) * rr).addScaledVector(up, Math.sin(a) * rr));
    }
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), N * 2, 0.0115, 5, false));
  }
  parts.push(new THREE.TubeGeometry(curve, 16, 0.012, 6, false)); // âme
  GEO.braid = mergeGeometries(parts);
  GEO.braid.userData.shared = true;
  return GEO.braid;
}
// culot fileté : écrou à six pans, col fileté (filets en anneaux), bague de serrage
function culotGeo() {
  if (GEO.culot) return GEO.culot;
  const parts = [new THREE.CylinderGeometry(0.075, 0.08, 0.035, 6).translate(0, 0.0175, 0)];
  parts.push(new THREE.CylinderGeometry(0.046, 0.046, 0.075, 16).translate(0, 0.07, 0));
  for (let i = 0; i < 5; i++) parts.push(new THREE.TorusGeometry(0.047, 0.006, 5, 18).rotateX(Math.PI / 2).translate(0, 0.045 + i * 0.012, 0));
  parts.push(new THREE.CylinderGeometry(0.036, 0.055, 0.025, 16).translate(0, 0.118, 0));
  GEO.culot = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  GEO.culot.userData.shared = true;
  return GEO.culot;
}

export function boumboule() {
  // ------------------------------------------------------------------ coque (roule)
  const { S, root, B, skin } = rig({
    shell: { color: '#3b3552', rough: 0.55, metal: 0.5, coat: 0.1 },
    shellD: { color: '#221d2e', rough: 0.6, metal: 0.5 },
    weld: { color: '#57506a', rough: 0.5, metal: 0.75 },
    orange: { color: '#ff7b2a', rough: 0.4, metal: 0.3, coat: 0.85 },
    orangeD: { color: '#c2501c', rough: 0.55, metal: 0.3, coat: 0.3 },
    bolt: { color: '#c9d2e3', rough: 0.3, metal: 0.9 },
    bare: { color: '#9a97a8', rough: 0.32, metal: 0.85 },
    scuff: { color: '#6f6a86', rough: 0.4, metal: 0.7 },
    hazard: { color: '#ffc22e', rough: 0.55, metal: 0.1, coat: 0.3 },
    ink: { color: '#16121c', rough: 0.65, metal: 0.1 },
    primer: { color: '#8a3c26', rough: 0.75, metal: 0.2 },
  });
  const R = rng(17);
  const ball = B(root, [0, 0.5, 0], 'ball');
  // fonte : léger grain de moulage
  S.add(ball, { t: 'sph', r: R0, col: 'shell', k: 0.02, fuzz: [0.0012, 28] });
  // cerclage central (bande de roulement) avec sa rainure de joint, cordons de soudure de part et d'autre
  S.add(ball, { t: 'cyl', r: 0.5, h: 0.052, round: 0.014, rot: [0, 0, Math.PI / 2], col: 'orange', k: 0.012 });
  S.sub(ball, { t: 'torus', R: 0.503, r: 0.008, rot: [0, 0, Math.PI / 2], col: 'orangeD', k: 0.004 });
  for (const s of [-1, 1]) {
    S.add(ball, { t: 'torus', R: Math.sqrt(R0 * R0 - 0.058 * 0.058) + 0.002, r: 0.009, p: [s * 0.058, 0, 0], rot: [0, 0, Math.PI / 2], col: 'weld', k: 0.006, fuzz: [0.003, 90] });
    // cerclages secondaires, plus fins
    const x = 0.3, rr = Math.sqrt(R0 * R0 - x * x);
    S.add(ball, { t: 'torus', R: rr, r: 0.019, p: [s * x, 0, 0], rot: [0, 0, Math.PI / 2], col: 'orange', k: 0.01 });
  }
  // boulons sur les cerclages fins, rivets le long du cerclage central
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    for (const s of [-1, 1]) {
      const x = 0.3, rr = Math.sqrt(R0 * R0 - x * x) + 0.016;
      const n = new THREE.Vector3(s * x, Math.cos(a) * rr, Math.sin(a) * rr).normalize();
      S.add(ball, { t: 'hex', r: 0.022, h: 0.013, round: 0.004, p: [s * x, Math.cos(a) * rr, Math.sin(a) * rr], rot: yTo(n), col: 'bolt', k: 0.006 });
    }
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    for (const s of [-1, 1]) S.add(ball, { t: 'sph', r: 0.014, p: [s * 0.036, Math.cos(a) * 0.5, Math.sin(a) * 0.5], col: 'bolt', k: 0.005 });
  }
  // boucle de serrage du cerclage : patin et deux boulons (repère de roulage)
  {
    const a = 2.4, n = new THREE.Vector3(0, Math.cos(a), Math.sin(a));
    S.add(ball, { t: 'box', s: [0.064, 0.02, 0.06], round: 0.01, p: n.clone().multiplyScalar(0.502).toArray(), rot: basis(X, n), col: 'orangeD', k: 0.008 });
    for (const o of [-0.03, 0.03]) {
      const t = new THREE.Vector3(0, -Math.sin(a), Math.cos(a));
      const p = n.clone().multiplyScalar(0.515).addScaledVector(t, o);
      S.add(ball, { t: 'hex', r: 0.016, h: 0.008, round: 0.003, p: p.toArray(), rot: yTo(n), col: 'bolt', k: 0.004 });
    }
  }
  // flancs : bouchon de remplissage d'un côté, pochoir « danger » des deux
  {
    const n = new THREE.Vector3(-0.92, 0.3, 0.25).normalize();
    S.add(ball, { t: 'cyl', r: 0.045, h: 0.014, round: 0.006, p: n.clone().multiplyScalar(R0).toArray(), rot: yTo(n), col: 'weld', k: 0.01 });
    S.sub(ball, { t: 'hex', r: 0.018, h: 0.03, round: 0.003, p: n.clone().multiplyScalar(R0 + 0.014).toArray(), rot: yTo(n), col: 'shellD', k: 0.003 });
  }
  for (const s of [-1, 1]) {
    const x = s * 0.46, d = 0.05;
    S.paint(ball, { t: 'box', s: [d, 0.145, 0.145], round: 0.02, p: [x, 0, 0], rot: [Math.PI / 4, 0, 0], col: 'ink', feather: 0.004 });
    S.paint(ball, { t: 'box', s: [d, 0.12, 0.12], round: 0.014, p: [x, 0, 0], rot: [Math.PI / 4, 0, 0], col: 'hazard', feather: 0.004 });
    S.paint(ball, { t: 'cone', a: [x, 0.088, 0], b: [x, 0.0, 0], r1: 0.025, r2: 0.016, col: 'ink', feather: 0.004 });
    S.paint(ball, { t: 'sph', r: 0.021, p: [x, -0.066, 0], col: 'ink', feather: 0.004 });
    // écaillage du pochoir : éclats où la fonte (ou l'apprêt) réapparaît
    for (let i = 0; i < 6; i++) {
      const a = R() * Math.PI * 2, rr = 0.12 + R() * 0.06;
      S.paint(ball, { t: 'sph', r: 0.014 + R() * 0.016, p: [x, Math.cos(a) * rr, Math.sin(a) * rr], col: R() < 0.35 ? 'primer' : 'shell', feather: 0.004, fuzz: [0.008, 55] });
    }
  }
  // éclats de peinture sur les cerclages, éraflures de roulage et coups sur la fonte
  for (let i = 0; i < 16; i++) {
    const a = R() * Math.PI * 2, s = R() < 0.5 ? -1 : 1;
    const onMain = i < 9;
    const x = onMain ? s * (0.04 + R() * 0.02) : s * 0.3;
    const rr = onMain ? 0.5 : Math.sqrt(R0 * R0 - 0.09) + 0.012;
    S.paint(ball, { t: 'sph', r: 0.012 + R() * 0.014, p: [x, Math.cos(a) * rr, Math.sin(a) * rr], col: R() < 0.5 ? 'bare' : 'primer', feather: 0.003, fuzz: [0.007, 60] });
  }
  for (let i = 0; i < 34; i++) {
    let x = (R() * 2 - 1) * 0.4;
    if (Math.abs(x) < 0.075) x += Math.sign(x || 1) * 0.075;
    const a = R() * Math.PI * 2, rr = Math.sqrt(R0 * R0 - x * x);
    const p = new THREE.Vector3(x, Math.cos(a) * rr, Math.sin(a) * rr), n = p.clone().normalize();
    const t = new THREE.Vector3().crossVectors(X, n).normalize().applyAxisAngle(n, (R() - 0.5) * 0.5);
    S.paint(ball, { t: 'box', s: [0.03 + R() * 0.07, 0.03, 0.009 + R() * 0.006], round: 0.005, p: p.toArray(), rot: basis(t, n), col: R() < 0.45 ? 'bare' : 'scuff', feather: 0.006 });
  }
  for (let i = 0; i < 7; i++) {
    let x = (R() * 2 - 1) * 0.38;
    if (Math.abs(x) < 0.08) x += Math.sign(x || 1) * 0.08;
    const a = R() * Math.PI * 2, rr = Math.sqrt(R0 * R0 - x * x) + 0.012;
    S.sub(ball, { t: 'sph', r: 0.02 + R() * 0.012, p: [x, Math.cos(a) * rr, Math.sin(a) * rr], col: 'scuff', k: 0.012 });
  }
  skin('boumboule', { mesh: { cell: 0.017 }, mat: { enemyRim: true } });

  // ------------------------------------------------------------------ harnais (ne roule pas) : masque-casque
  const face = joint(root, [0, 0.5, 0]);
  // le harnais gonfle avec la coque pendant le compte à rebours (la coque passerait sinon à travers le masque)
  face.updateMatrixWorld = function (force) { this.scale.copy(ball.scale); THREE.Object3D.prototype.updateMatrixWorld.call(this, force); };
  // masque sculpté à part (un seul os) : aucun poids de peau partagé avec la coque qui roule
  const M = new Sculpt({
    plate: { color: '#a3a1b6', rough: 0.38, metal: 0.65, coat: 0.35 },
    plateD: { color: '#2a2436', rough: 0.55, metal: 0.4 },
    orange: { color: '#ff7b2a', rough: 0.4, metal: 0.3, coat: 0.85 },
    mouth: { color: '#1c0f1c', rough: 0.8, metal: 0.1 },
    bolt: { color: '#c9d2e3', rough: 0.3, metal: 0.9 },
    scuff: { color: '#b4b0c4', rough: 0.3, metal: 0.85 },
  });
  const mb = bone(face, [0, 0, 0], 'mask');
  // plaque de tôle cintrée (coquille concentrique à la coque), découpée en octogone : front en pointe vers la crête,
  // joues resserrées vers le menton, coins du menton abattus
  M.add(mb, { t: 'sph', r: RM, col: 'plate', k: 0.01 });
  M.sub(mb, { t: 'sph', r: 0.542, k: 0.008 });
  M.sub(mb, { t: 'box', s: [0.8, 0.8, 0.5], p: [0, 0, -0.32], k: 0.01 });
  for (const s of [-1, 1]) {
    M.sub(mb, { t: 'box', s: [0.3, 0.5, 0.5], p: [s * 0.62, 0, 0.3], rot: [0, 0, s * 0.14], k: 0.012 });
    M.sub(mb, { t: 'box', s: [0.4, 0.2, 0.5], p: [s * 0.36, 0.43, 0.3], rot: [0, 0, s * 0.32], k: 0.012 });
    M.sub(mb, { t: 'box', s: [0.2, 0.2, 0.5], p: [s * 0.4, -0.42, 0.3], rot: [0, 0, Math.PI / 4], k: 0.012 });
  }
  M.sub(mb, { t: 'box', s: [0.8, 0.2, 0.5], p: [0, -0.5, 0.3], k: 0.012 });
  // crête : bande cintrée du front au sommet, où se visse la mèche
  {
    const arc = [];
    for (let i = 0; i <= 6; i++) { const e = 0.5 + (i / 6) * 1.25; arc.push([0, Math.sin(e) * (RM + 0.004), Math.cos(e) * (RM + 0.004)]); }
    for (let i = 0; i < 6; i++) M.add(mb, { t: 'cone', a: arc[i], b: arc[i + 1], r1: 0.021, r2: 0.021, sc: [2.2, 1, 1], col: 'plate', k: 0.01 });
    for (const i of [1, 4, 5]) M.add(mb, { t: 'sph', r: 0.012, p: arc[i].map((v) => v * (1 + 0.021 / RM)), col: 'bolt', k: 0.004 });
    M.add(mb, { t: 'cyl', r: 0.068, h: 0.016, p: [0, 0.592, -0.01], col: 'plate', k: 0.02 }); // embase du culot
  }
  // mâchoire en saillie, bouche grimaçante
  M.add(mb, { t: 'box', s: [0.215, 0.092, 0.04], round: 0.035, p: onJaw(0, 0, RM - 0.005), rot: [JA, 0, 0], col: 'plate', k: 0.03 });
  M.sub(mb, { t: 'box', s: [0.185, 0.064, 0.05], round: 0.03, p: onJaw(0, 0, RM + 0.05), rot: [JA, 0, 0], col: 'mouth', k: 0.012 });
  // orbites percées
  for (const s of [-1, 1]) M.sub(mb, { t: 'ell', r: [0.098, 0.085, 0.07], p: [s * 0.135, 0.055, front(0.135, 0.055)], rot: [0, s * 0.24, 0], col: 'plateD', k: 0.014 });
  // joues : peintures de guerre orange, boulons de fixation ; rivets sur le pourtour
  for (const s of [-1, 1]) {
    for (const k of [0, 1]) {
      const x = s * (0.215 + k * 0.045), y = -0.075 - k * 0.012;
      M.paint(mb, { t: 'box', s: [0.013, 0.06, 0.1], round: 0.006, p: [x, y, front(x, y)], rot: [0, s * 0.4, s * 0.3], col: 'orange', feather: 0.004, fuzz: [0.003, 70] });
    }
    const x = s * 0.27, y = -0.2, n = new THREE.Vector3(x, y, front(x, y)).normalize();
    M.add(mb, { t: 'hex', r: 0.021, h: 0.012, round: 0.004, p: n.clone().multiplyScalar(RM + 0.004).toArray(), rot: yTo(n), col: 'bolt', k: 0.006 });
  }
  for (const [x, y] of [[0, 0.21], [0.12, 0.215], [0.255, 0.135], [0.3, 0.04], [0.305, -0.06], [0.215, -0.275], [0.11, -0.3], [0, -0.3]]) {
    for (const s of x ? [-1, 1] : [1]) M.add(mb, { t: 'sph', r: 0.013, p: [s * x, y, front(x, y) + 0.002], col: 'bolt', k: 0.004 });
  }
  for (let i = 0; i < 6; i++) {
    const x = (R() * 2 - 1) * 0.28, y = -0.03 + (R() * 2 - 1) * 0.24;
    M.paint(mb, { t: 'box', s: [0.035 + R() * 0.03, 0.012, 0.04], round: 0.005, p: [x, y, front(x, y)], rot: [0, 0, R() * 3], col: 'scuff', feather: 0.005 });
  }
  sculptSkin('boumbouleMasque', M, root, [mb], { outline: OL, mesh: { cell: 0.014 }, mat: { enemyRim: true, sheenColor: '#d8e0ff' } });

  const tg = teethGeo();
  part(face, tg.teeth, mat('#f3eee4', { rough: 0.25, coat: 0.8 }), { shadow: false });
  part(face, tg.gold, mat('#ffc93a', { rough: 0.22, metal: 0.95 }), { shadow: false });
  // yeux exorbités, iris rouges
  const white = mat('#ffffff', { rough: 0.15, coat: 0.6 });
  const darkM = mat('#140a10', { rough: 0.3 });
  const lidM = mat('#4a4560', { rough: 0.35, metal: 0.7 });
  const eyes = [];
  for (const s of [-1, 1]) {
    const e = joint(face, [s * 0.135, 0.052, front(0.135, 0.052, 0.548)]);
    e.rotation.set(0.05, s * 0.32, 0);
    part(e, G.ellipsoid(0.088, 0.082, 0.055), white, { outline: OL * 0.6 });
    const iris = part(e, G.sphere(0.046, 14, 10), glow('#ff2a12', 1.7), { p: [-s * 0.012, -0.012, 0.037], s: [1, 1, 0.62], shadow: false });
    part(e, G.sphere(0.021, 10, 8), darkM, { p: [-s * 0.013, -0.013, 0.062], s: [1, 1, 0.5], shadow: false });
    part(e, G.sphere(0.01, 6, 4), glow('#ffffff', 1.4), { p: [-s * 0.002, 0.008, 0.068], shadow: false });
    // paupière de tôle qui tombe vers le nez : regard furieux
    part(e, lidGeo(), lidM, { r: [0.3, 0, -s * 0.45], shadow: false });
    eyes.push(iris);
  }
  // sourcils en tôle épaisse, boulonnés, froncés
  const pm = paintedMetalTexture('#3a3348', 'boumSourcil', { chip: 0.5, edge: 1, bare: '#b4b8c8', rust: 0.15 });
  const browM = mat('#ffffff', { map: pm.map, normalMap: pm.normalMap, rough: 0.5, metal: 0.6 });
  const boltM = mat('#c9d2e3', { rough: 0.3, metal: 0.9 });
  const brows = [];
  for (const s of [-1, 1]) {
    const b = joint(face, [s * 0.13, 0.152, front(0.13, 0.152) + 0.024]);
    b.rotation.set(-0.25, s * 0.3, s * 0.5);
    part(b, G.rbox(0.23, 0.06, 0.04, 0.014, 2), browM, { outline: OL * 0.6 });
    for (const x of [-0.075, 0.075]) part(b, G.cyl(0.012, 0.012, 0.012, 6), boltM, { p: [x, 0, 0.022], r: [Math.PI / 2, 0, 0], shadow: false });
    brows.push(b);
  }
  // témoins lumineux sur la crête : clignotent (vite quand la coque gonfle)
  const lampOn = glow('#ff4a2a', 4.5), lampOff = glow('#5a1410', 1);
  const bezelM = mat('#3a3448', { rough: 0.4, metal: 0.8 });
  for (const s of [-1, 1]) {
    const n = new THREE.Vector3(0, Math.sin(0.95), Math.cos(0.95));
    const j = joint(face, [s * 0.025, n.y * 0.6, n.z * 0.6]);
    j.rotation.fromArray(yTo(n));
    part(j, G.cyl(0.019, 0.023, 0.016, 12), bezelM, { shadow: false });
    const lamp = part(j, G.sphere(0.015, 10, 6), lampOff, { p: [0, 0.01, 0], s: [1, 0.7, 1], shadow: false });
    const ph = s > 0 ? 0 : 0.5;
    lamp.onBeforeRender = () => {
      const f = ball.scale.x > 1.001 ? 7 : 1.3;
      lamp.material = ((performance.now() / 1000) * f + ph) % 1 < 0.5 ? lampOn : lampOff;
    };
  }

  // ------------------------------------------------------------------ mèche : culot fileté, mèche tressée, étincelle
  const fuse = joint(face, [0, 0.604, -0.01]);
  part(fuse, culotGeo(), mat('#d9a64a', { rough: 0.3, metal: 0.9 }), { outline: OL * 0.6 });
  const curve = new THREE.CatmullRomCurve3([[0, 0.12, 0], [0, 0.17, 0.005], [0, 0.215, -0.02], [0, 0.245, -0.065]].map((v) => new THREE.Vector3(...v)));
  part(fuse, braid(curve), mat('#b08a5c', { rough: 0.85 }), { outline: OL * 0.5 });
  const tip = curve.getPointAt(1);
  part(fuse, G.sphere(0.016, 8, 6), mat('#1a1214', { rough: 0.9 }), { p: tip.toArray(), shadow: false });
  part(fuse, G.torus(0.014, 0.005, 5, 12), glow('#ff6a1a', 3), { p: tip.toArray(), r: [Math.PI / 2 - 0.9, 0, 0], shadow: false });
  const spark = part(fuse, G.sphere(0.05, 10, 8), glow('#ffd23a', 4), { p: [tip.x, tip.y + 0.03, tip.z - 0.01], shadow: false });
  for (let i = 0; i < 6; i++) {
    const d = new THREE.Vector3(Math.cos(i * 1.05) * 0.9, (i % 2 ? 0.8 : -0.2) + 0.3, Math.sin(i * 1.05) * 0.9).normalize();
    part(spark, G.cone(0.016, 0.085, 5), glow('#ffb03a', 3.5), { p: d.clone().multiplyScalar(0.06).toArray(), r: yTo(d), shadow: false });
  }

  return { root, debrisColor: '#3a3550', ball, face, eyes, fuse, spark, chunks: [fuse, ...brows] };
}
