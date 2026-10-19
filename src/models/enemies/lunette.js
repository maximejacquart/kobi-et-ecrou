import * as THREE from 'three';
import { G, part, joint, mtx, mergeGeometries } from '../geo.js';
import { mat, glow } from '../../engine/materials.js';
import { paintedMetalTexture } from '../../engine/textures.js';
import { OL, C, VORAX_PAL, rig } from './common.js';

const HP = Math.PI / 2;

// ------------------------------------------------------------------ aides : pièces rigides fusionnées
// Géométries fusionnées une fois (clé) puis partagées par toutes les instances
const CACHE = new Map();
function merged(key, make) {
  let g = CACHE.get(key);
  if (!g) {
    const list = [];
    make(list);
    g = mergeGeometries(list);
    g.userData.shared = true;
    for (const x of list) x.dispose();
    CACHE.set(key, g);
  }
  return g;
}
// copie non indexée d'une géométrie, placée (position, rotation, échelle)
// boîte arrondie légère (1 segment d'arrondi ; 2 pour les grandes plaques)
const rb = (w, h, d, r, seg = 1) => G.rbox(w, h, d, r, seg);
const at = (geo, p, r = [0, 0, 0], s = 1) => (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(mtx(p, r, s));
// rivet bombé tourné vers +Y
const RIVET = new THREE.SphereGeometry(1, 7, 3, 0, Math.PI * 2, 0, HP).scale(1, 0.55, 1);
// coupole d'épaulière (axe Y), coque fermée d'un centimètre
const DOME = () => G.lathe('lunDome', [[0.001, 0.05], [0.05, 0.045], [0.085, 0.028], [0.106, 0.0], [0.112, -0.022], [0.102, -0.022], [0.096, 0.0], [0.076, 0.022], [0.045, 0.035], [0.001, 0.04]], 14);
// canon cannelé d'axe Y : n cannelures creusées dans un tube
function fluted(r, len, n = 6, depth = 0.22) {
  const g = new THREE.CylinderGeometry(r, r, len, n * 6, 1, true);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 - depth * Math.pow(Math.max(0, Math.cos(a * n)), 3);
    p.setXYZ(i, x * k, p.getY(i), z * k);
  }
  g.computeVertexNormals();
  return g;
}

// Matériaux des pièces rigides (en cache par mat())
function mats() {
  const pv = paintedMetalTexture('#7a2ba0', 'lunette-vorax', { chip: 0.3, edge: 0.75, rust: 0.04, bare: '#cfc6de' });
  const pw = paintedMetalTexture('#eceaf6', 'lunette-blanc', { chip: 0.22, edge: 0.7, rust: 0.03, bare: '#9aa0b4' });
  return {
    plate: mat('#ffffff', { map: pv.map, normalMap: pv.normalMap, rough: 0.38, metal: 0.35, coat: 0.6 }),
    white: mat('#ffffff', { map: pw.map, normalMap: pw.normalMap, rough: 0.34, metal: 0.15, coat: 0.7 }),
    gun: mat('#35303f', { rough: 0.32, metal: 0.85 }),
    steel: mat(C.metal, { rough: 0.26, metal: 0.9 }),
    gold: mat(C.gold, { rough: 0.25, metal: 0.85, coat: 0.4 }),
    rubber: mat('#1d1924', { rough: 0.85 }),
    glass: mat('#1a0b14', { rough: 0.05, metal: 0.6, coat: 1 }),
    eye: glow('#ff3a3a', 2.6),
    hot: glow('#ff3a3a', 3),
    amber: glow('#ffb43a', 1.5),
  };
}

// ------------------------------------------------------------------ main gauche sur le garde-main
// IK analytique à deux os : bras (0,28 m) puis avant-bras (0,29 m jusqu'au centre du gant), chacun allongé
// selon son -Y ; le coude plie en charnière autour du X local du bras, l'avant-bras partant vers son +Z.
// Coude orienté vers le bas et l'extérieur (repère du torse). Appelé après chaque orientation du fusil.
const UP_LEN = 0.28, FORE_LEN = 0.29;
const GRIP = new THREE.Vector3(-0.012, -0.012, 0.24); // sous l'avant du garde-main, repère « arme » (= repère de visée)
const POLE = new THREE.Vector3(-0.7, -1, 0.1);
// pose de liaison du bras gauche : celle que leftGrip donne au repos (fusil droit devant)
const UPL = [-1.28, 0.785, 0.4], FOREL = [-0.51, 0, 0];
const _S = new THREE.Vector3(), _T = new THREE.Vector3(), _E = new THREE.Vector3(), _P = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _mb = new THREE.Matrix4();
function leftGrip(torso, arm, rifleAim) {
  const { up, fore } = arm;
  rifleAim.updateWorldMatrix(true, false);
  up.updateWorldMatrix(true, false);
  _S.setFromMatrixPosition(up.matrixWorld);
  _T.copy(GRIP).applyMatrix4(rifleAim.matrixWorld);
  // les longueurs suivent l'échelle du modèle (élites)
  const k = _x.setFromMatrixColumn(up.matrixWorld, 0).length();
  const a = UP_LEN * k, b = FORE_LEN * k;
  _y.subVectors(_T, _S);
  const d = THREE.MathUtils.clamp(_y.length(), Math.abs(a - b) + 1e-3, (a + b) * 0.999);
  _y.normalize();
  _P.copy(POLE).transformDirection(torso.matrixWorld);
  _P.addScaledVector(_y, -_P.dot(_y)).normalize();
  const cosA = (a * a + d * d - b * b) / (2 * a * d);
  _E.copy(_S).addScaledVector(_y, a * cosA).addScaledVector(_P, a * Math.sqrt(Math.max(0, 1 - cosA * cosA)));
  _T.copy(_S).addScaledVector(_y, d); // cible ramenée à portée
  // repère monde du bras : +Y vers l'épaule, +Z vers le côté où part l'avant-bras, X = charnière du coude
  _y.subVectors(_S, _E).normalize();
  _z.subVectors(_T, _E);
  const bend = Math.acos(THREE.MathUtils.clamp(-_z.dot(_y) / _z.length(), -1, 1));
  _z.addScaledVector(_y, -_z.dot(_y)).normalize();
  _x.crossVectors(_y, _z);
  _q.setFromRotationMatrix(_mb.makeBasis(_x, _y, _z));
  up.parent.matrixWorld.decompose(_P, _qp, _E);
  up.quaternion.copy(_qp.invert().multiply(_q));
  fore.rotation.set(-bend, 0, 0);
}

// ===================================================================== Lunette (tireur d'élite)
// Échassier élancé en tenue de camouflage : cape-filet sur les épaules, harnais et sacoches, plaques Vorax.
// Tête-lunette (bagues, réticule, turrets, monocle d'appoint, antenne de visée), long fusil de précision
// tenu de la main droite et soutenu de la gauche (canon cannelé, lunette, bipied replié, crosse squelette).
export function lunette() {
  const { S, root, B, skin } = rig({
    ...VORAX_PAL,
    vorax: { color: '#7a2ba0', rough: 0.35, metal: 0.5, sheen: 0.2, coat: 0.85 },
    // toile de camouflage (sheen + micro-relief de fibres), filet, cuir du harnais, sacoches
    cape: { color: '#4d3f6e', rough: 0.85, sheen: 0.45, fur: 0.18 },
    capeL: { color: '#7a68a6', rough: 0.85, sheen: 0.45, fur: 0.18 },
    capeD: { color: '#2c2443', rough: 0.88, sheen: 0.4, fur: 0.18 },
    net: { color: '#1b1529', rough: 0.9, sheen: 0.5, fur: 0.1 },
    strap: { color: '#3a2a30', rough: 0.6, sheen: 0.5, coat: 0.2 },
    pouch: { color: '#4a4258', rough: 0.8, sheen: 0.4, fur: 0.08 },
    sole: { color: '#1d1924', rough: 0.9 },
  });
  const M = mats();
  const hips = B(root, [0, 1.15, 0], 'hips');
  // buste tourné en position de tir (épaule gauche en avant), la tête compense
  const torso = B(hips, [0, 0.1, 0], 'torso', [0, 0.24, 0]);
  // ---------------- cape-filet : coque de toile qui enveloppe le dos et les flancs jusqu'aux cuisses, ourlet en
  // dents. Sculptée en premier : ses soustractions (intérieur, ouverture avant, entailles) ne creusent pas le corps.
  const capeO = { a: [0, 0.5, 0], b: [0, -0.42, 0], sc: [1, 1, 0.78], rot: [0.1, 0, 0] };
  S.add(torso, { t: 'cone', ...capeO, r1: 0.2, r2: 0.3, p: [0, 0, -0.06], col: 'cape', k: 0.02, fuzz: [0.007, 13] });
  S.sub(torso, { t: 'cone', ...capeO, r1: 0.158, r2: 0.255, p: [0, 0, -0.045], col: 'capeD', k: 0.01 });
  S.sub(torso, { t: 'box', s: [0.45, 0.8, 0.2], round: 0.05, p: [0, 0.1, 0.165], col: 'capeD', k: 0.03 });
  S.sub(torso, { t: 'box', s: [0.5, 0.2, 0.5], round: 0.02, p: [0, -0.6, -0.1], rot: [0.1, 0, 0], col: 'capeD', k: 0.02 });
  for (const [x, z] of [[-0.27, -0.1], [-0.17, -0.27], [-0.05, -0.33], [0.07, -0.33], [0.18, -0.26], [0.28, -0.08]]) {
    S.sub(torso, { t: 'ell', r: [0.035, 0.075, 0.12], p: [x, -0.4, z - 0.04], rot: [0.1, Math.atan2(x, -z), 0], col: 'capeD', k: 0.015 });
  }
  // ---------------- bassin : ceinture, sacoches, gourde
  S.add(hips, { t: 'ell', r: [0.19, 0.13, 0.16], col: 'dark', k: 0.04 });
  S.add(hips, { t: 'torus', R: 0.17, r: 0.034, p: [0, 0.06, 0], sc: [1.1, 1, 1.02], col: 'strap', k: 0.012 });
  S.add(hips, { t: 'box', s: [0.07, 0.06, 0.03], round: 0.025, p: [0, -0.05, 0.14], rot: [-0.25, 0, 0], col: 'voraxD', k: 0.02 });
  // deux sacoches à gauche (devant, côté), gourde à droite derrière
  S.add(hips, { t: 'box', s: [0.055, 0.06, 0.035], round: 0.02, p: [-0.15, 0.0, 0.12], rot: [0, -0.7, 0], col: 'pouch', k: 0.012 });
  S.add(hips, { t: 'box', s: [0.06, 0.022, 0.04], round: 0.012, p: [-0.152, 0.055, 0.123], rot: [0.15, -0.7, 0], col: 'capeD', k: 0.008 });
  S.add(hips, { t: 'box', s: [0.035, 0.07, 0.06], round: 0.02, p: [-0.205, -0.01, -0.03], col: 'pouch', k: 0.012 });
  S.add(hips, { t: 'box', s: [0.04, 0.022, 0.065], round: 0.012, p: [-0.208, 0.055, -0.03], col: 'capeD', k: 0.008 });
  S.add(hips, { t: 'cyl', r: 0.05, h: 0.065, round: 0.025, p: [0.15, -0.02, -0.12], col: 'pouch', k: 0.012 });
  S.paint(hips, { t: 'cyl', r: 0.06, h: 0.012, p: [0.15, 0.0, -0.12], col: 'strap', feather: 0.004 });

  // ---------------- torse : ventre annelé, poitrine Vorax, plastron blanc, harnais, cape-filet
  S.add(torso, { t: 'cone', a: [0, -0.02, 0], b: [0, 0.3, 0.015], r1: 0.135, r2: 0.165, col: 'voraxD', k: 0.05 });
  for (const y of [0.08, 0.16]) S.sub(torso, { t: 'torus', R: 0.15, r: 0.016, p: [0, y, 0.005], col: 'dark', k: 0.012 });
  S.add(torso, { t: 'box', s: [0.1, 0.04, 0.04], round: 0.03, p: [0, 0.12, 0.115], rot: [-0.1, 0, 0], col: 'vorax', k: 0.02 });
  S.add(torso, { t: 'ell', r: [0.25, 0.18, 0.19], p: [0, 0.46, 0.01], col: 'vorax', k: 0.07 });
  S.add(torso, { t: 'box', s: [0.12, 0.1, 0.05], round: 0.045, p: [0, 0.42, 0.158], rot: [-0.15, 0, 0], col: 'white', k: 0.025 });
  S.sub(torso, { t: 'box', s: [0.006, 0.085, 0.04], round: 0.003, p: [0, 0.42, 0.213], rot: [-0.15, 0, 0], col: 'dark', k: 0.004 });
  S.paint(torso, { t: 'box', s: [0.13, 0.008, 0.06], round: 0.003, p: [0, 0.345, 0.2], col: 'gold', feather: 0.004 });
  // harnais (peint sur l'avant : il suit le torse) : bretelles de part et d'autre du plastron, sangle sous la poitrine
  for (const s of [-1, 1]) S.paint(torso, { t: 'box', s: [0.026, 0.2, 0.14], round: 0.006, p: [s * 0.165, 0.42, 0.1], rot: [0, 0, s * 0.12], col: 'strap', feather: 0.004 });
  S.paint(torso, { t: 'box', s: [0.3, 0.022, 0.15], round: 0.006, p: [0, 0.29, 0.09], col: 'strap', feather: 0.004 });
  // cou et col
  S.add(torso, { t: 'cyl', r: 0.07, h: 0.06, p: [0, 0.63, 0.01], col: 'dark', k: 0.02 });
  // châle de camouflage autour des épaules (relevé derrière la tête), cape-filet drapée dans le dos
  S.add(torso, { t: 'torus', R: 0.15, r: 0.075, p: [0, 0.6, -0.035], rot: [0.05, 0, 0], sc: [1.22, 0.75, 1.0], col: 'cape', k: 0.035, fuzz: [0.01, 15] });
  // filet : mailles sombres en losanges sur la cape, taches de camouflage
  for (let i = -5; i <= 5; i++) {
    for (const a of [-0.7, 0.7]) S.paint(torso, { t: 'box', s: [0.006, 0.8, 0.2], round: 0.003, p: [i * 0.08, 0.13, -0.24], rot: [0.12, 0, a], col: 'net', feather: 0.004 });
  }
  for (const [x, y, z, r, c] of [[-0.12, 0.42, -0.3, 0.08, 'capeL'], [0.13, 0.25, -0.31, 0.09, 'capeD'], [-0.06, 0.02, -0.32, 0.08, 'capeL'], [0.17, -0.12, -0.3, 0.07, 'capeL'],
    [-0.19, 0.18, -0.27, 0.07, 'capeD'], [0.05, 0.5, -0.27, 0.06, 'capeD'], [-0.1, -0.28, -0.31, 0.08, 'capeD'], [0.28, 0.1, -0.1, 0.08, 'capeL'], [-0.28, -0.05, -0.12, 0.08, 'capeL'],
    [0.27, -0.25, -0.18, 0.07, 'capeD'], [0.22, 0.6, 0.0, 0.06, 'capeL'], [-0.24, 0.6, -0.05, 0.06, 'capeD'], [-0.08, 0.58, 0.13, 0.05, 'capeL']]) {
    S.paint(torso, { t: 'sph', r, p: [x, y, z], col: c, feather: 0.02 });
  }

  // ---------------- tête-lunette : tube blanc couché, bande Vorax, culot sombre, embase de turret
  const head = B(torso, [0, 0.66, 0.02], 'head', [0, -0.24, 0]);
  S.add(head, { t: 'cyl', r: 0.145, h: 0.12, round: 0.05, rot: [HP, 0, 0], col: 'white', k: 0.03 });
  S.paint(head, { t: 'cyl', r: 0.17, h: 0.028, p: [0, 0, -0.035], rot: [HP, 0, 0], col: 'vorax', feather: 0.004 });
  S.paint(head, { t: 'cyl', r: 0.17, h: 0.004, p: [0, 0, 0.045], rot: [HP, 0, 0], col: 'dark', feather: 0.003 });
  S.add(head, { t: 'cyl', r: 0.11, h: 0.03, round: 0.012, p: [0, 0, -0.13], rot: [HP, 0, 0], col: 'dark', k: 0.015 });
  S.add(head, { t: 'cyl', r: 0.045, h: 0.03, round: 0.012, p: [0, 0.14, -0.01], col: 'white', k: 0.02 });
  S.add(head, { t: 'box', s: [0.07, 0.03, 0.06], round: 0.02, p: [0, -0.14, 0.03], col: 'voraxD', k: 0.02 });
  S.sub(head, { t: 'cyl', r: 0.103, h: 0.05, round: 0.01, p: [0, 0, 0.13], rot: [HP, 0, 0], col: 'black', k: 0.01 });

  // ---------------- bras : manches de toile, avant-bras Vorax, gants blancs. Le droit tient le fusil épaulé par la
  // poignée, le gauche le soutient sous le garde-main (posé par leftGrip ; pose de liaison voisine).
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = B(torso, [s * 0.27, 0.5, 0], s < 0 ? 'shL' : 'shR');
    S.add(sh, { t: 'sph', r: 0.085, col: 'dark', k: 0.03 });
    const up = B(sh, [0, 0, 0], s < 0 ? 'upL' : 'upR', s < 0 ? UPL : [-0.175, -1.1, 0.3]);
    S.add(up, { t: 'cone', a: [0, 0, 0], b: [0, -0.25, 0], r1: 0.062, r2: 0.052, col: 'capeD', k: 0.02, skinSoft: 0.01 });
    S.add(up, { t: 'torus', R: 0.052, r: 0.014, p: [0, -0.24, 0], col: 'strap', k: 0.01, skinSoft: 0.01 });
    const fore = B(up, [0, -0.28, 0], s < 0 ? 'foreL' : 'foreR', s < 0 ? FOREL : [-1.71, 0, 0]);
    S.add(fore, { t: 'sph', r: 0.058, col: 'dark', k: 0.02, skinSoft: 0.01 });
    S.add(fore, { t: 'cone', a: [0, -0.02, 0], b: [0, -0.22, 0], r1: 0.056, r2: 0.05, col: 'vorax', k: 0.02, skinSoft: 0.01 });
    S.add(fore, { t: 'cyl', r: 0.058, h: 0.02, round: 0.01, p: [0, -0.22, 0], col: 'white', k: 0.015, skinSoft: 0.01 });
    S.add(fore, { t: 'ell', r: [0.055, 0.068, 0.06], p: [0, -0.29, 0], col: 'white', k: 0.02, skinSoft: 0.01 });
    S.add(fore, { t: 'ell', r: [0.022, 0.04, 0.024], p: [-s * 0.045, -0.27, 0.035], rot: [0.3, 0, -s * 0.4], col: 'white', k: 0.012, skinSoft: 0.01 });
    arms.push({ sh, up, fore });
  }

  // ---------------- jambes d'échassier : cuisses en combinaison sombre, tibias Vorax, bottes blanches
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = B(hips, [s * 0.12, -0.05, 0], s < 0 ? 'hipL' : 'hipR', [-0.35, 0, 0]);
    S.add(hip, { t: 'cone', a: [0, 0, 0], b: [0, -0.55, 0], r1: 0.09, r2: 0.06, col: 'dark', k: 0.03, skinSoft: 0.01 });
    if (s > 0) {
      S.add(hip, { t: 'box', s: [0.035, 0.08, 0.06], round: 0.02, p: [0.085, -0.2, 0.0], col: 'pouch', k: 0.015, skinSoft: 0.01 });
      S.add(hip, { t: 'box', s: [0.04, 0.025, 0.065], round: 0.012, p: [0.088, -0.13, 0.0], col: 'capeD', k: 0.008, skinSoft: 0.01 });
    }
    S.paint(hip, { t: 'box', s: [0.12, 0.014, 0.12], round: 0.004, p: [0, -0.12, 0], rot: [0.1, 0, 0], col: 'strap', feather: 0.004 });
    const knee = B(hip, [0, -0.58, 0], s < 0 ? 'kneeL' : 'kneeR', [0.9, 0, 0]);
    S.add(knee, { t: 'sph', r: 0.062, col: 'dark', k: 0.02, skinSoft: 0.01 });
    S.add(knee, { t: 'cone', a: [0, -0.03, 0], b: [0, -0.56, 0], r1: 0.062, r2: 0.045, col: 'vorax', k: 0.025, skinSoft: 0.01 });
    const foot = B(knee, [0, -0.6, 0], s < 0 ? 'footL' : 'footR', [-0.55, 0, 0]);
    S.add(foot, { t: 'cyl', r: 0.058, h: 0.045, round: 0.02, p: [0, 0.03, -0.005], col: 'dark', k: 0.02, skinSoft: 0.01 });
    S.add(foot, { t: 'box', s: [0.07, 0.05, 0.14], round: 0.045, p: [0, -0.005, 0.06], col: 'white', k: 0.025, skinSoft: 0.01 });
    S.add(foot, { t: 'box', s: [0.078, 0.016, 0.15], round: 0.012, p: [0, -0.048, 0.062], col: 'sole', k: 0.012, skinSoft: 0.01 });
    S.paint(foot, { t: 'box', s: [0.1, 0.012, 0.2], round: 0.004, p: [0, 0.012, 0.06], col: 'vorax', feather: 0.004 });
    legs.push({ hip, knee, foot });
  }
  skin('lunette', { mesh: { cell: 0.021, skinSoft: 0.022 }, mat: { enemyRim: true } });

  // ======================================================== pièces rigides
  // ceinture : boucle, cartouches (côté droit), boucles des sacoches
  part(hips, merged('lun-hipsG', (L) => {
    L.push(at(rb(0.07, 0.055, 0.02, 0.008), [0, 0.06, 0.19]));
    L.push(at(rb(0.025, 0.018, 0.012, 0.005), [-0.14, 0.05, 0.16], [0, -0.7, 0]));
    L.push(at(rb(0.012, 0.018, 0.025, 0.005), [-0.245, 0.05, -0.03]));
    for (let i = 0; i < 6; i++) {
      const a = 0.28 + i * 0.085;
      L.push(at(G.cyl(0.011, 0.011, 0.06, 8), [Math.sin(a) * 0.218, 0.07, Math.cos(a) * 0.205]));
    }
  }), M.gold);
  part(hips, merged('lun-hipsS', (L) => {
    for (let i = 0; i < 6; i++) {
      const a = 0.28 + i * 0.085;
      L.push(at(G.cone(0.011, 0.025, 8), [Math.sin(a) * 0.218, 0.112, Math.cos(a) * 0.205]));
    }
  }), M.steel, { shadow: false });
  // plastron : médaillon doré où se croisent les sangles, rivets
  part(torso, merged('lun-torsoG', (L) => {
    L.push(at(G.cyl(0.03, 0.03, 0.014, 16), [0, 0.29, 0.19], [HP, 0, 0]));
    for (const s of [-1, 1]) L.push(at(rb(0.026, 0.03, 0.012, 0.005), [s * 0.165, 0.4, 0.15], [0, s * 0.6, 0]));
    for (const [x, y] of [[-0.09, 0.48], [0.09, 0.48], [-0.09, 0.36], [0.09, 0.36]]) L.push(at(RIVET, [x, y, 0.21 - (y - 0.42) * 0.15], [HP - 0.15, 0, 0], 0.011));
  }), M.gold, { shadow: false });

  // épaulières : deux plaques Vorax écaillées superposées, rivets dorés
  for (const [i, s] of [[0, -1], [1, 1]]) {
    const sh = arms[i].sh;
    part(sh, merged('lun-pauld' + s, (L) => {
      L.push(at(DOME(), [s * 0.04, 0.05, 0], [0, 0, -s * 0.75], [1, 1, 1.15]));
      L.push(at(DOME(), [s * 0.1, -0.02, 0], [0, 0, -s * 1.15], [0.85, 0.85, 1.05]));
    }), M.plate, { outline: OL * 0.6 });
    part(sh, merged('lun-pauldG' + s, (L) => {
      for (const z of [-0.08, 0.08]) L.push(at(RIVET, [s * 0.11, 0.1, z], [0, 0, -s * 0.75], 0.012));
      L.push(at(G.sphere(0.022, 10, 6), [s * 0.085, 0.085, 0], [0, 0, -s * 0.75], [1, 0.5, 1]));
    }), M.gold, { shadow: false });
  }
  // avant-bras : canons de protection blancs côté extérieur
  for (const [i, s] of [[0, -1], [1, 1]]) {
    part(arms[i].fore, merged('lun-vamb' + s, (L) => {
      L.push(at(rb(0.028, 0.16, 0.07, 0.012, 2), [s * 0.05, -0.12, 0]));
    }), M.plate);
    part(arms[i].fore, merged('lun-vambG' + s, (L) => {
      for (const y of [-0.06, -0.18]) L.push(at(RIVET, [s * 0.065, y, 0], [0, 0, -s * HP], 0.01));
    }), M.gold, { shadow: false });
  }
  // jambes : cuissards Vorax, genouillères et jambières blanches, vérin au mollet, sangle de botte
  for (const [i] of [[0, -1], [1, 1]]) {
    const { hip, knee, foot } = legs[i];
    part(hip, merged('lun-thigh', (L) => {
      L.push(at(rb(0.12, 0.2, 0.03, 0.012, 2), [0, -0.24, 0.075], [-0.04, 0, 0]));
    }), M.plate);
    part(hip, merged('lun-thighG', (L) => {
      for (const x of [-0.04, 0.04]) L.push(at(RIVET, [x, -0.16, 0.091], [HP - 0.04, 0, 0], 0.01));
    }), M.gold, { shadow: false });
    part(knee, merged('lun-shin', (L) => {
      L.push(at(rb(0.105, 0.09, 0.045, 0.02), [0, 0.0, 0.062], [0.15, 0, 0]));
      L.push(at(rb(0.075, 0.3, 0.028, 0.012, 2), [0, -0.27, 0.048], [0.06, 0, 0]));
    }), M.white);
    part(knee, merged('lun-shinM', (L) => {
      L.push(at(G.cyl(0.017, 0.017, 0.16, 8), [0, -0.14, -0.072]));
      L.push(at(G.cyl(0.024, 0.024, 0.03, 8), [0, -0.05, -0.07]));
    }), M.gun);
    part(knee, merged('lun-shinS', (L) => {
      L.push(at(G.cyl(0.009, 0.009, 0.2, 6), [0, -0.3, -0.07]));
      L.push(at(G.torus(0.068, 0.01, 4, 12), [0, -0.005, 0.0], [HP, 0, 0]));
    }), M.steel, { shadow: false });
    part(foot, merged('lun-boot', (L) => {
      L.push(at(G.torus(0.064, 0.012, 4, 12), [0, 0.035, -0.005], [HP, 0, 0]));
    }), M.gun, { shadow: false });
    part(foot, merged('lun-bootG', (L) => {
      L.push(at(rb(0.012, 0.03, 0.035, 0.005), [0.068, 0.035, 0]));
      L.push(at(rb(0.012, 0.03, 0.035, 0.005), [-0.068, 0.035, 0]));
      L.push(at(rb(0.09, 0.03, 0.04, 0.012), [0, -0.02, 0.19]));
    }), M.gold, { shadow: false });
  }

  // ---------------- tête : bagues de l'objectif, réticule, turret, monocle d'appoint, antenne et télémètre
  part(head, merged('lun-ring', (L) => {
    L.push(at(G.lathe('lunRing', [[0.098, 0], [0.128, 0], [0.133, 0.008], [0.133, 0.042], [0.124, 0.05], [0.098, 0.05], [0.098, 0]], 28), [0, 0, 0.105], [HP, 0, 0]));
    L.push(at(G.cyl(0.04, 0.04, 0.022, 18), [0, 0.168, -0.01]));
    L.push(at(rb(0.035, 0.05, 0.075, 0.012), [0.155, 0.04, -0.05]));
    L.push(at(rb(0.045, 0.045, 0.085, 0.014), [0.16, -0.06, 0.05]));
    L.push(at(rb(0.03, 0.022, 0.12, 0.008), [-0.16, 0.06, 0.1], [0, -0.25, 0]));
  }), M.gun, { outline: OL * 0.5 });
  part(head, merged('lun-headG', (L) => {
    L.push(at(G.torus(0.13, 0.012, 5, 22), [0, 0, 0.11]));
    L.push(at(G.torus(0.107, 0.008, 4, 22), [0, 0, 0.152]));
    L.push(at(G.cyl(0.032, 0.035, 0.03, 16), [0, 0.193, -0.01]));
    L.push(at(G.cyl(0.02, 0.02, 0.03, 12), [-0.155, 0.06, 0.04], [0, 0, HP]));
    L.push(at(G.torus(0.042, 0.009, 5, 14), [-0.18, 0.065, 0.165], [0, -0.25, 0]));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      L.push(at(RIVET, [Math.cos(a) * 0.075, Math.sin(a) * 0.075, -0.16], [-HP, 0, 0], 0.011));
    }
  }), M.gold, { shadow: false });
  part(head, G.cyl(0.036, 0.036, 0.006, 18), M.amber, { p: [-0.18, 0.065, 0.165], r: [HP, -0.25, 0], order: 'YXZ', shadow: false });
  part(head, G.cyl(0.013, 0.013, 0.01, 10), M.hot, { p: [0.16, -0.06, 0.094], r: [HP, 0, 0], shadow: false });
  // antenne de visée (vers l'arrière, côté droit), pointe rouge
  const ant = joint(head, [0.16, 0.07, -0.06]);
  ant.rotation.set(-0.3, 0, -0.12);
  part(ant, merged('lun-ant', (L) => {
    L.push(at(G.cyl(0.005, 0.009, 0.4, 6), [0, 0.2, 0]));
    for (const [y, w] of [[0.22, 0.06], [0.3, 0.045]]) L.push(at(G.box(w, 0.008, 0.008), [0, y, 0]));
  }), M.steel, { shadow: false });
  part(ant, G.sphere(0.018, 10, 8), M.hot, { p: [0, 0.41, 0], shadow: false });
  // œil : lentille rouge, réticule sombre et reflet (pulse pendant la visée)
  const eye = joint(head, [0, 0, 0.11]);
  part(eye, G.cyl(0.098, 0.098, 0.012, 28), M.eye, { r: [HP, 0, 0], shadow: false });
  part(eye, merged('lun-reticle', (L) => {
    L.push(at(G.box(0.17, 0.006, 0.004), [0, 0, 0.009]));
    L.push(at(G.box(0.006, 0.17, 0.004), [0, 0, 0.009]));
    L.push(at(G.torus(0.04, 0.0035, 4, 24), [0, 0, 0.009]));
  }), M.gun, { shadow: false });
  part(eye, G.sphere(0.018, 8, 6), glow('#ffffff', 1.6), { p: [0.04, 0.045, 0.012], s: [1, 0.6, 0.3], shadow: false });

  // ---------------- fusil de précision. Repère « arme » : X dehors, Y haut, Z vers la cible ; origine = poignée
  // (dans la main droite) ; axe du canon à 7,5 cm au-dessus.
  const rifleAim = joint(arms[1].fore, [0, -0.3, 0.02]);
  const rifle = joint(rifleAim, [0, 0, 0]);
  rifle.rotation.x = Math.PI / 2; // le canon (axe Y) pointe vers l'avant de l'articulation de visée
  const gun = joint(rifle, [0, 0, 0]);
  gun.rotation.x = -Math.PI / 2; // repère « arme » : Z vers l'avant
  // carcasse, garde-main, crosse : métal peint Vorax écaillé
  part(gun, merged('lun-gunP', (L) => {
    L.push(at(rb(0.07, 0.085, 0.34, 0.02, 2), [0, 0.08, 0.06]));
    L.push(at(G.cyl(0.042, 0.042, 0.38, 8), [0, 0.075, 0.42], [HP, 0, 0]));
    L.push(at(rb(0.042, 0.042, 0.3, 0.015, 2), [0, 0.085, -0.25]));
    L.push(at(rb(0.035, 0.03, 0.3, 0.012), [0, -0.035, -0.25], [-0.06, 0, 0]));
    L.push(at(rb(0.046, 0.17, 0.045, 0.015, 2), [0, 0.03, -0.41]));
  }), M.plate, { outline: OL * 0.6 });
  part(gun, merged('lun-gunW', (L) => {
    L.push(at(rb(0.046, 0.026, 0.15, 0.01), [0, 0.115, -0.25]));
    L.push(at(rb(0.072, 0.03, 0.12, 0.012), [0, 0.06, 0.1]));
  }), M.white);
  // métal sombre : canon cannelé, frein de bouche, lunette, chargeur, poignée, rail, bipied replié
  part(gun, merged('lun-gunD', (L) => {
    L.push(at(fluted(0.022, 0.84), [0, 0.075, 0.6], [HP, 0, 0]));
    L.push(at(rb(0.052, 0.046, 0.1, 0.012), [0, 0.075, 1.03]));
    L.push(at(G.cyl(0.026, 0.026, 0.3, 16), [0, 0.18, 0.13], [HP, 0, 0]));
    L.push(at(G.lathe('lunObj', [[0.026, 0], [0.04, 0.05], [0.042, 0.09], [0.036, 0.095]], 16), [0, 0.18, 0.28], [HP, 0, 0]));
    L.push(at(G.lathe('lunOcu', [[0.034, 0], [0.034, 0.05], [0.026, 0.07]], 16), [0, 0.18, -0.08], [HP, 0, 0]));
    L.push(at(rb(0.05, 0.12, 0.075, 0.015), [0, -0.005, 0.14], [0.14, 0, 0]));
    L.push(at(rb(0.036, 0.12, 0.055, 0.015), [0, 0.0, -0.025], [0.35, 0, 0]));
    L.push(at(G.box(0.03, 0.012, 0.32), [0, 0.128, 0.06]));
    for (const z of [0.03, 0.22]) L.push(at(G.box(0.024, 0.045, 0.025), [0, 0.15, z]));
    L.push(at(rb(0.048, 0.026, 0.045, 0.01), [0, 0.03, 0.58]));
    L.push(at(G.torus(0.032, 0.006, 5, 12, Math.PI), [0, 0.045, 0.05], [0, HP, Math.PI]));
    L.push(at(G.box(0.008, 0.032, 0.085), [0.037, 0.095, 0.1]));
    for (const z of [1.005, 1.045]) for (const s of [-1, 1]) L.push(at(G.box(0.008, 0.03, 0.016), [s * 0.026, 0.075, z]));
  }), M.gun, { outline: OL * 0.6 });
  part(gun, merged('lun-gunS', (L) => {
    for (const s of [-1, 1]) L.push(at(G.cyl(0.007, 0.007, 0.28, 6), [s * 0.019, 0.022, 0.43], [HP, 0, 0]));
    L.push(at(G.cyl(0.008, 0.008, 0.07, 8), [0.07, 0.1, -0.02], [0, 0, HP]));
  }), M.steel);
  part(gun, merged('lun-gunG', (L) => {
    for (const z of [0.25, 0.6]) L.push(at(G.torus(0.043, 0.006, 4, 12), [0, 0.075, z]));
    L.push(at(G.torus(0.024, 0.005, 4, 10), [0, 0.075, 0.97]));
    for (const z of [0.03, 0.22]) L.push(at(G.torus(0.03, 0.007, 4, 12), [0, 0.18, z]));
    L.push(at(G.cyl(0.016, 0.016, 0.03, 12), [0, 0.215, 0.12]));
    L.push(at(G.cyl(0.016, 0.016, 0.03, 12), [0.04, 0.18, 0.12], [0, 0, HP]));
    L.push(at(G.sphere(0.017, 8, 6), [0.105, 0.1, -0.02]));
    L.push(at(G.box(0.052, 0.012, 0.077), [0, -0.05, 0.147], [0.14, 0, 0]));
  }), M.gold, { shadow: false });
  part(gun, merged('lun-gunR', (L) => {
    L.push(at(rb(0.05, 0.175, 0.024, 0.01), [0, 0.03, -0.44]));
    for (const s of [-1, 1]) L.push(at(G.box(0.016, 0.014, 0.03), [s * 0.019, 0.022, 0.29]));
  }), M.rubber);
  // lentilles de la lunette : rouge devant, verre teinté côté œil
  part(gun, G.cyl(0.036, 0.036, 0.004, 16), M.eye, { p: [0, 0.18, 0.372], r: [HP, 0, 0], shadow: false });
  part(gun, G.cyl(0.03, 0.03, 0.004, 16), M.glass, { p: [0, 0.18, -0.08], r: [HP, 0, 0], shadow: false });
  // bouche du canon (repère du fusil : Y vers l'avant, -Z vers le haut) : le laser de visée et les tirs en partent
  const muzzle = joint(rifle, [0, 1.085, -0.075]);
  part(muzzle, G.torus(0.024, 0.008, 5, 12), M.hot, { r: [Math.PI / 2, 0, 0], shadow: false });
  // pose de repos (bestiaire) : fusil pointé droit devant ; le comportement le réoriente à chaque image
  root.updateMatrixWorld(true);
  rifleAim.lookAt(new THREE.Vector3(0.1, 1.55, 8));
  const grip = () => leftGrip(torso, arms[0], rifleAim);
  grip();
  return { root, debrisColor: '#7a2ba0', hips, torso, head, arms, legs, eye, rifle, rifleAim, muzzle, grip, chunks: [rifleAim, eye] };
}
