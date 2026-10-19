import * as THREE from 'three';
import { G, part, joint, mtx } from '../geo.js';
import { mat, glow } from '../../engine/materials.js';
import { paintedMetalTexture, treadPlateTexture, hazardTexture } from '../../engine/textures.js';
import { mergeParts, rivet } from '../environment/props.js';
import { OL, C, VORAX_PAL, rig } from './common.js';

// ===================================================================== Tourelle
// Tourelle Vorax fixe : socle en tôle larmée boulonné au sol (pattes d'ancrage, bande de danger), fût à trappe,
// couronne d'orientation dentée ; carter rivé tournant (os « head ») à capteur vert sous visière, double canon
// à manchons de refroidissement (joint « guns », bouches à (±0,35 ; -0,1 ; 1,3) dans le repère de la tête),
// chargeur et bande de munitions, câbles, voyants, antenne.

// palette du corps sculpté : celle des robots du Baron, plus crasse et métal mis à nu
const PAL = {
  ...VORAX_PAL,
  grime: { color: '#2a1f30', rough: 0.85, metal: 0.15 },
  chip: { color: '#b9bfd0', rough: 0.35, metal: 0.9 },
};

// matières des pièces rigides (en cache via mat())
function mats() {
  const pv = paintedMetalTexture('#6a2bd0', 'tourelle-v', { chip: 0.3, edge: 0.75, rust: 0.05, bare: '#b9bfd0' });
  const pd = paintedMetalTexture('#3a3348', 'tourelle-d', { chip: 0.35, edge: 0.8, rust: 0.18, bare: '#a9afbf' });
  const tr = treadPlateTexture('#8c88a4', 'tourelle');
  const hz = hazardTexture();
  return {
    paintV: mat('#ffffff', { map: pv.map, normalMap: pv.normalMap, rough: 0.42, metal: 0.4, coat: 0.6 }),
    paintD: mat('#ffffff', { map: pd.map, normalMap: pd.normalMap, rough: 0.5, metal: 0.5 }),
    tread: mat('#ffffff', { map: tr.map, normalMap: tr.normalMap, rough: 0.5, metal: 0.65 }),
    hazard: mat('#ffffff', { map: hz.map, normalMap: hz.normalMap, rough: 0.5, metal: 0.25, coat: 0.4 }),
    steel: mat(C.metal, { rough: 0.3, metal: 0.85 }),
    dark: mat(C.dark, { rough: 0.4, metal: 0.6 }),
    gold: mat(C.gold, { rough: 0.28, metal: 0.85, coat: 0.4 }),
    rubber: mat('#1d1924', { rough: 0.75, metal: 0.05 }),
  };
}

// --------------------------------------------------------------- aides géométriques (non indexées, à fusionner)
const ni = (g) => (g.index ? g.toNonIndexed() : g.clone());
const at = (g, p, r = [0, 0, 0], s = 1) => ni(g).applyMatrix4(mtx(p, r, s));
// UV mises à l'échelle (bande de danger, tôle larmée en mètres)
function uvScale(g, su, sv) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return g;
}
// tête de boulon : six pans + rondelle, tournée vers +Y, posée en p
const BOLT = () => G.cyl(0.03, 0.03, 0.025, 6);
const WASHER = () => G.cyl(0.04, 0.04, 0.008, 10);
function bolt(list, p, r = [0, 0, 0], s = 1) {
  const m = mtx(p, r, s);
  list.push(ni(BOLT()).translate(0, 0.0165, 0).applyMatrix4(m), ni(WASHER()).translate(0, 0.004, 0).applyMatrix4(m));
}
// rivet bombé orienté selon n
const _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _n = new THREE.Vector3();
function riv(list, p, n, r = 0.022) {
  _q.setFromUnitVectors(_up, _n.set(n[0], n[1], n[2]).normalize());
  list.push(rivet(r).applyQuaternion(_q).translate(p[0], p[1], p[2]));
}
// tube (câble, durite) le long d'une courbe
function tube(pts, r, seg = 24, rad = 6) {
  const c = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  return ni(new THREE.TubeGeometry(c, seg, r, rad, false));
}
// gousset d'ancrage : profil [r, y] extrudé (épaisseur e) dans le plan radial ; UV 0..1 sur les flancs, l'épaisseur
// sur v le long des tranches (usure de la peinture aux arêtes)
function gusset(pts, e) {
  const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: e, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 1 }).translate(0, 0, -e / 2);
  g.computeBoundingBox();
  const { min, max } = g.boundingBox, p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const u = (p.getX(i) - min.x) / (max.x - min.x), v = (p.getY(i) - min.y) / (max.y - min.y);
    if (Math.abs(n.getZ(i)) > 0.7) uv.setXY(i, u, v);
    else uv.setXY(i, Math.abs(n.getX(i)) > Math.abs(n.getY(i)) ? v : u, (p.getZ(i) - min.z) / (max.z - min.z));
  }
  return g;
}
// couronne dentée d'axe Y : jante + dents
function gearRing(list, R, h, n, tooth, y) {
  list.push(at(G.cyl(R, R, h, 40), [0, y, 0]));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    list.push(at(G.box(tooth[0], tooth[1], tooth[2]), [Math.cos(a) * (R + tooth[0] * 0.4), y, Math.sin(a) * (R + tooth[0] * 0.4)], [0, -a, 0]));
  }
}

// géométries fusionnées par os et par matière (calculées une fois)
let GEO = null;
function geos() {
  if (GEO) return GEO;
  const T = Math.PI * 2;
  // ---------------- socle (os base, repère du sol)
  const b = { tread: [], hazard: [], paintV: [], paintD: [], steel: [], dark: [], gold: [], rubber: [] };
  // platine octogonale : dessus en tôle larmée (UV en mètres × 2), tranche à bandes de danger
  const top = new THREE.CircleGeometry(0.97, 8).rotateX(-Math.PI / 2).rotateY(Math.PI / 8).translate(0, 0.12, 0);
  const tp = top.attributes.position, tuv = top.attributes.uv;
  for (let i = 0; i < tp.count; i++) tuv.setXY(i, tp.getX(i) * 2, tp.getZ(i) * 2);
  b.tread.push(ni(top));
  b.hazard.push(uvScale(ni(new THREE.CylinderGeometry(0.97, 1.0, 0.12, 8, 1, true)).rotateY(Math.PI / 8).translate(0, 0.06, 0), 12, 0.25));
  // liseré d'acier au bord du plateau
  b.dark.push(at(new THREE.TorusGeometry(0.965, 0.014, 4, 8), [0, 0.12, 0], [Math.PI / 2, 0, Math.PI / 8]));
  // pattes d'ancrage (diagonales) : gousset du fût au sol, qui enjambe le bord du plateau, semelle boulonnée
  const gus = gusset([[0.45, 0.12], [0.92, 0.12], [0.92, 0.07], [1.16, 0.07], [1.16, 0.13], [0.62, 0.6], [0.45, 0.6]], 0.05);
  for (let k = 0; k < 4; k++) {
    const f = Math.PI / 4 + k * Math.PI / 2, c = Math.cos(f), s = Math.sin(f);
    const P = (r, y, t = 0) => [c * r - s * t, y, s * r + c * t];
    b.paintV.push(at(G.rbox(0.3, 0.07, 0.3, 0.02), P(1.04, 0.035), [0, -f, 0]));
    b.paintV.push(at(gus, [0, 0, 0], [0, -f, 0]));
    for (const t of [-0.09, 0.09]) bolt(b.steel, P(1.1, 0.07, t));
  }
  gus.dispose();
  // boulons du plateau (coins) et de la bride du fût
  for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + k * Math.PI / 4; bolt(b.steel, [Math.cos(a) * 0.82, 0.12, Math.sin(a) * 0.82]); }
  for (let k = 0; k < 12; k++) { const a = (k / 12) * T; bolt(b.steel, [Math.cos(a) * 0.66, 0.12, Math.sin(a) * 0.66], [0, 0, 0], 0.85); }
  // couronne d'orientation dentée sous le carter
  gearRing(b.steel, 0.42, 0.08, 36, [0.06, 0.07, 0.045], 1.16);
  b.dark.push(at(G.cyl(0.45, 0.45, 0.02, 32), [0, 1.11, 0]));
  // boîte de jonction à l'arrière, deux câbles qui montent le long du fût, colliers
  b.paintD.push(at(G.rbox(0.32, 0.14, 0.17, 0.025), [0, 0.19, -0.72]));
  b.hazard.push(uvScale(at(G.box(0.26, 0.04, 0.004), [0, 0.2, -0.808]), 1, 0.2));
  for (const x of [-0.07, 0.07]) {
    b.rubber.push(tube([[x, 0.26, -0.69], [x, 0.38, -0.65], [x, 0.6, -0.5], [x, 0.9, -0.45], [x, 1.02, -0.45], [x, 1.08, -0.39]], 0.028));
    b.dark.push(at(G.cyl(0.04, 0.04, 0.05, 10), [x, 0.275, -0.685], [0.3, 0, 0]));
  }
  for (const [y, z] of [[0.62, -0.5], [0.86, -0.46]]) b.dark.push(at(G.rbox(0.26, 0.05, 0.07, 0.015), [0, y, z]));
  // poignée et rivets de la trappe du fût
  b.steel.push(at(G.torus(0.05, 0.011, 6, 12, Math.PI), [0, 0.63, 0.48], [Math.PI / 2 - 0.165, 0, 0]));
  for (const [x, y] of [[-0.11, 0.53], [0.11, 0.53], [-0.1, 0.81], [0.1, 0.81]]) riv(b.gold, [x, y, 0.493 - (y - 0.53) * 0.167], [0, 0.167, 1], 0.016);
  // ---------------- carter (os head, centré sur l'axe de rotation)
  const h = { paintD: [], steel: [], dark: [], gold: [], rubber: [], hazard: [] };
  // roulement et moteur d'orientation (son pignon engrène la couronne)
  h.dark.push(at(G.cyl(0.4, 0.42, 0.14, 28), [0, -0.41, 0]));
  const pa = -2.3, pc = Math.cos(pa), ps = Math.sin(pa);
  h.paintD.push(at(G.rbox(0.15, 0.17, 0.16, 0.03), [pc * 0.55, -0.42, ps * 0.55], [0, -pa, 0]));
  const pin = [];
  gearRing(pin, 0.045, 0.06, 10, [0.03, 0.05, 0.022], -0.54);
  for (const q of pin) h.steel.push(q.translate(pc * 0.53, 0, ps * 0.53));
  // capteur sous la visière : bague sombre
  h.dark.push(at(G.torus(0.105, 0.024, 8, 24), [0, 0.14, 0.5]));
  // aération arrière : lames inclinées dans le renfoncement
  for (let i = 0; i < 5; i++) h.dark.push(at(G.box(0.46, 0.022, 0.06), [0, -0.1 + i * 0.04, -0.66], [0.6, 0, 0]));
  // poignée de la trappe du dessus
  h.steel.push(at(G.torus(0.07, 0.014, 6, 12, Math.PI), [0, 0.5, -0.06]));
  // antenne (embase)
  h.dark.push(at(G.cyl(0.045, 0.055, 0.06, 10), [0.3, 0.36, -0.4], [-0.25, 0, -0.2]));
  // voyants : bagues sur le panneau droit
  for (const z of [-0.12, -0.04, 0.04]) h.dark.push(at(G.cyl(0.032, 0.032, 0.016, 10), [0.722, 0.07, z], [0, 0, Math.PI / 2]));
  // rivets : trappe, masque des canons, panneau droit, aération
  for (let k = 0; k < 8; k++) { const a = (k / 8) * T + 0.2; riv(h.gold, [Math.cos(a) * 0.345, 0.5, -0.06 + Math.sin(a) * 0.345], [0, 1, 0], 0.02); }
  for (const x of [-0.52, -0.1, 0.1, 0.52]) for (const y of [-0.07, -0.19]) riv(h.gold, [x, y, 0.705], [0, 0, 1]);
  for (const y of [-0.2, 0.08]) for (const z of [-0.27, 0.17]) riv(h.gold, [0.722, y, z], [1, 0, 0]);
  for (const x of [-0.27, 0.27]) for (const y of [-0.12, 0.08]) riv(h.gold, [x, y, -0.695], [0, 0, -1]);
  // câble du flanc droit vers le canon droit
  h.rubber.push(tube([[0.62, 0.0, 0.3], [0.71, -0.06, 0.5], [0.6, -0.12, 0.68], [0.47, -0.1, 0.76]], 0.024, 20));
  h.dark.push(at(G.cyl(0.036, 0.036, 0.05, 10), [0.62, 0.0, 0.29], [Math.PI / 2, 0, 0]));
  // ---------------- chargeur (joint « ammo », flanc gauche) : caisse, couvercle, bande de danger, bande de munitions
  const a = { paintD: [], steel: [], dark: [], gold: [], rubber: [], hazard: [] };
  a.paintD.push(at(G.rbox(0.24, 0.28, 0.42, 0.03), [0, 0, 0]));
  a.paintD.push(at(G.rbox(0.26, 0.04, 0.44, 0.015), [0, 0.15, 0]));
  a.hazard.push(uvScale(at(G.box(0.004, 0.06, 0.38), [-0.122, -0.06, 0]), 1, 0.16));
  a.steel.push(at(G.box(0.02, 0.06, 0.04), [-0.13, 0.11, 0]));
  a.steel.push(at(G.torus(0.06, 0.012, 6, 10, Math.PI), [-0.125, -0.0, -0.12], [0, Math.PI / 2, Math.PI / 2]));
  a.dark.push(at(G.box(0.16, 0.06, 0.22), [0.15, -0.06, 0]));
  for (const z of [-0.18, 0.18]) for (const y of [-0.11, 0.11]) riv(a.gold, [-0.122, y, z], [-1, 0, 0], 0.016);
  // bande : cartouches couchées perpendiculaires au trajet, maillons sombres
  const belt = new THREE.CatmullRomCurve3([[0.0, 0.17, 0.12], [0.05, 0.24, 0.3], [0.24, 0.17, 0.48], [0.39, 0.05, 0.56]].map((p) => new THREE.Vector3(...p)));
  const tg = new THREE.Vector3(), ax = new THREE.Vector3(), bx = new THREE.Vector3(), m4 = new THREE.Matrix4(), pt = new THREE.Vector3();
  a.rubber.push(ni(new THREE.TubeGeometry(belt, 20, 0.014, 5, false)));
  for (let i = 0; i < 14; i++) {
    const u = (i + 0.5) / 14;
    belt.getPointAt(u, pt); belt.getTangentAt(u, tg);
    ax.crossVectors(_up, tg).normalize();
    bx.crossVectors(ax, tg).normalize();
    m4.makeBasis(bx, ax, tg).setPosition(pt);
    a.gold.push(ni(G.cyl(0.021, 0.021, 0.09, 8)).applyMatrix4(m4));
    a.gold.push(ni(G.cone(0.021, 0.045, 8)).translate(0, 0.067, 0).applyMatrix4(m4));
    a.rubber.push(ni(G.box(0.03, 0.05, 0.035)).applyMatrix4(m4));
  }
  // ---------------- canons (joint « guns ») : capots peints, fûts, manchons à ailettes, bouches lumineuses
  const g = { paintV: [], steel: [], dark: [], gold: [], hazard: [], glow: [], rubber: [] };
  const muzzle = G.lathe('tourelleMuzzle', [[0.042, 0], [0.074, 0], [0.078, 0.02], [0.078, 0.07], [0.072, 0.09], [0.042, 0.09], [0.042, 0]], 16);
  for (const s of [-1, 1]) {
    const x = s * 0.35;
    g.paintV.push(at(G.rbox(0.22, 0.19, 0.36, 0.05), [x, 0, 0.78]));
    g.hazard.push(uvScale(at(G.box(0.12, 0.006, 0.07), [x, 0.097, 0.84]), 1, 0.58));
    g.gold.push(at(G.torus(0.1, 0.022, 8, 20), [x, 0, 0.955]));
    g.steel.push(at(G.cyl(0.05, 0.056, 0.3, 14), [x, 0, 1.07], [Math.PI / 2, 0, 0]));
    g.dark.push(at(G.cyl(0.074, 0.074, 0.2, 14), [x, 0, 1.07], [Math.PI / 2, 0, 0]));
    for (let i = 0; i < 5; i++) g.dark.push(at(G.cyl(0.096, 0.096, 0.018, 14), [x, 0, 0.99 + i * 0.04], [Math.PI / 2, 0, 0]));
    g.dark.push(at(muzzle, [x, 0, 1.21], [Math.PI / 2, 0, 0]));
    // amortisseur de recul sous le fût
    g.steel.push(at(G.cyl(0.017, 0.017, 0.24, 8), [x, -0.115, 1.05], [Math.PI / 2, 0, 0]));
    g.dark.push(at(G.box(0.05, 0.06, 0.03), [x, -0.09, 1.17]));
    // âme lumineuse et lèvre de la bouche
    g.glow.push(at(G.cyl(0.043, 0.043, 0.01, 14), [x, 0, 1.25], [Math.PI / 2, 0, 0]));
    // flexible d'alimentation du capot vers le carter
    g.rubber.push(tube([[x + s * 0.05, 0.09, 0.66], [x + s * 0.06, 0.16, 0.6], [x + s * 0.1, 0.15, 0.5]], 0.018, 10));
  }
  const merge = (o) => Object.fromEntries(Object.entries(o).filter(([, l]) => l.length).map(([k, l]) => [k, mergeParts(l)]));
  GEO = { base: merge(b), head: merge(h), ammo: merge(a), guns: merge(g) };
  return GEO;
}

export function tourelleV() {
  const { S, root, B, skin } = rig(PAL);
  const M = mats();
  const GG = geos();
  // ---------------- socle : tambour, fût conique, chapeau sous la couronne (sculptés)
  const base = B(root, [0, 0, 0], 'base');
  S.add(base, { t: 'cyl', r: 0.58, h: 0.16, round: 0.06, p: [0, 0.28, 0], col: 'voraxD', k: 0.03 });
  S.add(base, { t: 'cone', a: [0, 0.4, 0], b: [0, 1.0, 0], r1: 0.48, r2: 0.38, col: 'vorax', k: 0.07 });
  S.sub(base, { t: 'box', s: [0.9, 0.3, 0.9], p: [0, -0.18, 0], k: 0.01, col: 'dark' });
  S.sub(base, { t: 'box', s: [0.9, 0.3, 0.9], p: [0, 1.38, 0], k: 0.02, col: 'dark' });
  S.add(base, { t: 'cyl', r: 0.42, h: 0.04, round: 0.02, p: [0, 1.08, 0], col: 'dark', k: 0.03 });
  // joints creusés et bande dorée du fût
  S.sub(base, { t: 'torus', R: 0.467, r: 0.018, p: [0, 0.48, 0], col: 'voraxD', k: 0.008 });
  S.add(base, { t: 'torus', R: 0.39, r: 0.042, p: [0, 0.95, 0], col: 'gold', k: 0.015 });
  // trappe de visite en relief (avant)
  S.add(base, { t: 'box', s: [0.13, 0.17, 0.03], round: 0.025, p: [0, 0.67, 0.44], rot: [-0.165, 0, 0], col: 'voraxD', k: 0.012 });
  // emblème Vorax peint sur les flancs du fût
  for (const s of [-1, 1]) {
    S.paint(base, { t: 'cyl', r: 0.085, h: 0.06, p: [s * 0.43, 0.72, 0], rot: [0, 0, Math.PI / 2], col: 'gold', feather: 0.006 });
    S.paint(base, { t: 'cyl', r: 0.05, h: 0.07, p: [s * 0.43, 0.72, 0], rot: [0, 0, Math.PI / 2], col: 'voraxD', feather: 0.006 });
    S.paint(base, { t: 'sph', r: 0.022, p: [s * 0.44, 0.72, 0], col: 'gold', feather: 0.005 });
  }
  // nervures du tambour (entre les jambes de force)
  for (let k = 0; k < 4; k++) {
    const f = k * Math.PI / 2;
    S.add(base, { t: 'box', s: [0.05, 0.13, 0.035], round: 0.02, p: [Math.sin(f) * 0.6, 0.3, Math.cos(f) * 0.6], rot: [0, f, 0], col: 'vorax', k: 0.02 });
  }
  // crasse au pied, éclats de peinture
  S.paint(base, { t: 'cyl', r: 0.62, h: 0.1, p: [0, 0.12, 0], col: 'grime', feather: 0.1, fuzz: [0.04, 9] });
  for (const [x, y, z, r] of [[0.38, 0.42, 0.3, 0.05], [-0.45, 0.4, -0.2, 0.04], [0.1, 1.0, 0.36, 0.03], [-0.3, 0.75, 0.26, 0.03]]) {
    S.paint(base, { t: 'sph', r, p: [x, y, z], col: 'chip', feather: 0.006, fuzz: [0.015, 40] });
  }
  // ---------------- carter tournant : dôme + jupe, trappe blanche, visière, masque des canons, panneaux
  const head = B(base, [0, 1.7, 0], 'head');
  S.add(head, { t: 'ell', r: [0.72, 0.5, 0.68], col: 'vorax', k: 0.04 });
  S.add(head, { t: 'cyl', r: 0.64, h: 0.1, round: 0.08, p: [0, -0.24, 0], col: 'vorax', k: 0.06 });
  // joints de panneaux : méridiens latéraux et ceinture haute
  for (const s of [-1, 1]) S.sub(head, { t: 'torus', R: 0.5, r: 0.017, p: [s * 0.46, 0, 0], rot: [0, 0, Math.PI / 2], sc: [0.77, 1, 1.046], col: 'voraxD', k: 0.008 });
  S.sub(head, { t: 'torus', R: 0.66, r: 0.017, p: [0, 0.2, 0], sc: [1, 1, 0.944], col: 'voraxD', k: 0.008 });
  // jupe : bande dorée et lèvre sombre
  S.add(head, { t: 'torus', R: 0.64, r: 0.036, p: [0, -0.24, 0], col: 'gold', k: 0.015 });
  S.add(head, { t: 'cyl', r: 0.5, h: 0.03, round: 0.02, p: [0, -0.35, 0], col: 'dark', k: 0.03 });
  // trappe blanche du dessus, avec sa rainure
  S.add(head, { t: 'cyl', r: 0.4, h: 0.05, round: 0.04, p: [0, 0.45, -0.06], col: 'white', k: 0.04 });
  S.sub(head, { t: 'torus', R: 0.29, r: 0.016, p: [0, 0.5, -0.06], col: 'voraxD', k: 0.006 });
  // visière et joues du capteur
  S.add(head, { t: 'box', s: [0.35, 0.035, 0.12], round: 0.03, p: [0, 0.3, 0.6], rot: [0.3, 0, 0], col: 'dark', k: 0.05 });
  for (const s of [-1, 1]) S.add(head, { t: 'box', s: [0.035, 0.11, 0.08], round: 0.025, p: [s * 0.32, 0.15, 0.6], col: 'dark', k: 0.04 });
  // masque des canons
  S.add(head, { t: 'box', s: [0.58, 0.12, 0.07], round: 0.05, p: [0, -0.13, 0.63], col: 'dark', k: 0.05 });
  // panneau droit (voyants, chevrons peints) et aération arrière
  S.add(head, { t: 'box', s: [0.03, 0.17, 0.26], round: 0.025, p: [0.69, -0.06, -0.05], col: 'voraxD', k: 0.02 });
  S.add(head, { t: 'box', s: [0.3, 0.15, 0.08], round: 0.04, p: [0, -0.02, -0.62], col: 'voraxD', k: 0.05 });
  S.sub(head, { t: 'box', s: [0.24, 0.1, 0.1], round: 0.01, p: [0, -0.02, -0.7], col: 'black', k: 0.01 });
  // logement du capteur
  S.sub(head, { t: 'ell', r: [0.28, 0.13, 0.2], p: [0, 0.14, 0.64], col: 'black', k: 0.03 });
  // marquages : chevrons dorés sur le panneau droit ; éclats de peinture aux arêtes
  for (const z of [-0.17, -0.07, 0.03]) S.paint(head, { t: 'box', s: [0.06, 0.022, 0.07], p: [0.72, -0.07, z], rot: [Math.PI / 4, 0, 0], col: 'gold', feather: 0.004 });
  for (const [x, y, z, r] of [[0.3, 0.33, 0.66, 0.03], [-0.34, 0.12, 0.66, 0.025], [0.5, -0.16, 0.6, 0.035], [-0.2, 0.46, 0.3, 0.03], [-0.62, 0.1, -0.3, 0.035], [0.4, -0.3, -0.45, 0.03]]) {
    S.paint(head, { t: 'sph', r, p: [x, y, z], col: 'chip', feather: 0.006, fuzz: [0.014, 40] });
  }
  skin('tourelle', { mesh: { cell: 0.024, skinSoft: 0.04 }, mat: { enemyRim: true }, outline: OL });

  // ---------------- pièces rigides
  const put = (parent, set, o = {}) => {
    for (const [k, geo] of Object.entries(set)) {
      if (k === 'glow') continue;
      part(parent, geo, M[k], { shadow: k !== 'gold' && k !== 'hazard', outline: o.outline && o.outline.includes(k) ? OL : false });
    }
  };
  put(base, GG.base, { outline: ['paintV'] });
  put(head, GG.head);
  part(base, G.sphere(0.022, 8, 6), glow('#7dff4a', 2.2), { p: [0.11, 0.24, -0.81], shadow: false });
  // capteur-œil : lentille verte, iris, reflet ; témoins latéraux
  const eye = joint(head, [0, 0.14, 0.5]);
  part(eye, G.sphere(0.09, 18, 12), glow('#9dff3a', 2.2), { s: [1, 1, 0.55], shadow: false });
  part(eye, G.torus(0.05, 0.012, 6, 18), glow('#3fae1a', 1.6), { p: [0, 0, 0.045], shadow: false });
  part(eye, G.sphere(0.022, 8, 6), mat('#10200a', { rough: 0.2 }), { p: [0, 0, 0.048], s: [1, 1, 0.5], shadow: false });
  part(eye, G.sphere(0.016, 8, 6), glow('#ffffff', 1.6), { p: [0.03, 0.035, 0.05], shadow: false });
  for (const s of [-1, 1]) part(head, G.sphere(0.022, 8, 6), glow('#7dff4a', 1.4), { p: [s * 0.2, 0.14, 0.515], shadow: false });
  // voyants rouge, ambre, vert
  [['#ff3a3a', -0.12], ['#ffb030', -0.04], ['#7dff4a', 0.04]].forEach(([c, z]) => part(head, G.sphere(0.022, 8, 6), glow(c, 2.2), { p: [0.73, 0.07, z], s: [0.6, 1, 1], shadow: false }));
  // antenne arrière à feu clignotant
  const ant = joint(head, [0.3, 0.36, -0.4]);
  ant.rotation.set(-0.25, 0, -0.2);
  part(ant, G.cyl(0.011, 0.016, 0.38, 6), M.steel, { p: [0, 0.2, 0] });
  part(ant, G.sphere(0.03, 10, 8), glow('#ff3a5a', 2.6), { p: [0, 0.41, 0], shadow: false });
  // chargeur
  const ammo = joint(head, [-0.86, -0.15, 0.18]);
  put(ammo, GG.ammo, { outline: ['paintD'] });
  // canons
  const guns = joint(head, [0, -0.1, 0]);
  put(guns, GG.guns, { outline: ['paintV'] });
  part(guns, GG.guns.glow, glow('#ff3a8a', 3), { shadow: false });
  for (const s of [-1, 1]) part(guns, G.torus(0.06, 0.012, 6, 16), glow('#ff3a8a', 2.2), { p: [s * 0.35, 0, 1.302], shadow: false });
  return { root, debrisColor: C.vorax, head, eye, chunks: [guns, ammo, ant] };
}
