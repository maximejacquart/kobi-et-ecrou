// Station Goinfre : dalles, néons, cuves et tuyaux ; fonderie (haut-fourneau, poche de coulée, portique),
// entrepôt (rayonnages, chariot élévateur, charpente, pont roulant), pont de commande (consoles, hologramme,
// bannières, porte).
import * as THREE from 'three';
import { G, part, joint, mtx } from '../geo.js';
import { mat, glow } from '../../engine/materials.js';
import { containerTexture, metalTexture, hazardTexture, floorTexture, paintedMetalTexture, plankTexture, sporeFluidTexture } from '../../engine/textures.js';
import { plankBox, plankPanel, boxAt, rboxAt, mergeParts, beam as tube, container, contMats } from './props.js';
import { BoxCollider, CylinderCollider } from '../../engine/physics.js';
import { rng as mkRng } from '../../engine/util.js';
import { boxUV } from '../../levels/level.js';
import { lights } from '../../engine/lightpool.js';
import { createWater } from '../../engine/water/water.js';
import { frameU, LAYERS } from '../../engine/frame.js';
import { noiseTexture } from '../../engine/sky.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const M = {};
function mats() {
  if (M.ready) return M;
  const fl = floorTexture();
  // tôles lustrées : les néons s'y reflètent (reflets écran, sondes)
  M.floor = mat('#b4b4cc', { map: fl.map, normalMap: fl.normalMap, rough: 0.24, metal: 0.35 });
  const mt = metalTexture('#4a4f6a', 'metal-station', { grid: 2, rust: 0.1 });
  M.wallMetal = mat('#ffffff', { map: mt.map, normalMap: mt.normalMap, rough: 0.4, metal: 0.7 });
  const mp = metalTexture('#5a2aa0', 'metal-vorax', { grid: 2, rust: 0.05 });
  M.voraxPanel = mat('#ffffff', { map: mp.map, normalMap: mp.normalMap, rough: 0.35, metal: 0.6 });
  const hz = hazardTexture();
  M.hazard = mat('#ffffff', { map: hz.map, rough: 0.6 });
  M.dark = mat('#20202c', { rough: 0.4, metal: 0.7 });
  M.gold = mat('#ffcc33', { rough: 0.25, metal: 0.85 });
  M.neonPink = glow('#ff4fa0', 2);
  M.neonPinkSoft = glow('#ff4fa0', 1.2);
  M.neonCyan = glow('#3ef2ff', 3);
  M.neonGold = glow('#ffcc33', 2.5);
  M.pipe = mat('#7a8098', { rough: 0.35, metal: 0.85 });
  const soot = metalTexture('#3a3236', 'metal-fonderie', { grid: 3, rust: 0.55 });
  M.soot = mat('#ffffff', { map: soot.map, normalMap: soot.normalMap, rough: 0.7, metal: 0.5 });
  const rackT = metalTexture('#d0701a', 'metal-rack', { grid: 1, rust: 0.2 });
  M.rack = mat('#ffffff', { map: rackT.map, normalMap: rackT.normalMap, rough: 0.5, metal: 0.55 });
  M.beam = mat('#4a4660', { rough: 0.45, metal: 0.75 });
  M.molten = glow('#ff7a1a', 3.2);
  M.moltenHot = glow('#ffd06a', 4);
  M.ember = glow('#ff5a1a', 2.2);
  M.paint = mat('#ffcc33', { rough: 0.6 });
  M.rubber = mat('#1c1a24', { rough: 0.85 });
  M.glass = mat('#9ad8ff', { rough: 0.05, metal: 0.2, transparent: true, opacity: 0.22 });
  M.holo = new THREE.MeshBasicMaterial({ color: new THREE.Color('#3ef2ff').multiplyScalar(1.6), transparent: true, opacity: 0.32, wireframe: true, depthWrite: false, blending: THREE.AdditiveBlending });
  M.holoFill = new THREE.MeshBasicMaterial({ color: new THREE.Color('#3ef2ff'), transparent: true, opacity: 0.08, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  M.holo.userData.shared = M.holoFill.userData.shared = true;
  // sols par zone : même tôle, teintes différentes (fonderie chaude, entrepôt gris, soute verdie, pont bleu lustré)
  M.floorFoundry = mat('#c09c90', { map: fl.map, normalMap: fl.normalMap, rough: 0.28, metal: 0.4 });
  M.floorWare = mat('#b8bab8', { map: fl.map, normalMap: fl.normalMap, rough: 0.32, metal: 0.3 });
  M.floorBridge = mat('#98a8e0', { map: fl.map, normalMap: fl.normalMap, rough: 0.3, metal: 0.5 });
  M.floorHold = mat('#a4b8ac', { map: fl.map, normalMap: fl.normalMap, rough: 0.3, metal: 0.4 });
  // arène : acier bleuté sombre, très lustré (le Goinfrotron violet s'en détache, les néons s'y reflètent)
  M.floorArena = mat('#8a92c0', { map: fl.map, normalMap: fl.normalMap, rough: 0.2, metal: 0.2 });
  M.inlayCyan = glow('#3ef2ff', 1.3);
  M.inlayPink = glow('#ff4fa0', 1.3);
  M.ready = true;
  return M;
}
export function stationMats() { return mats(); }

// Matières des objets (peinture écaillée, bois de caisse) : textures 256 px partagées
const X = {};
function xmats() {
  if (X.ready) return X;
  const y = paintedMetalTexture('#ffcc33', 'st-jaune', { chip: 0.15, edge: 0.55, rust: 0.06 });
  X.yellow = mat('#ffffff', { map: y.map, normalMap: y.normalMap, rough: 0.45, metal: 0.08 });
  const d = paintedMetalTexture('#3a3848', 'st-sombre', { chip: 0.25, edge: 0.8, rust: 0.25, bare: '#a0a8bc' });
  X.darkPaint = mat('#ffffff', { map: d.map, normalMap: d.normalMap, rough: 0.5, metal: 0.45 });
  // bois des palettes et des caisses (mêmes textures que les caisses du jeu et les objets partagés)
  const pl = plankTexture('#a8703f');
  X.pallet = mat('#ffffff', { map: pl.map, normalMap: pl.normalMap, rough: 0.8 });
  const nat = plankTexture('#d2a468', null, { wear: 0.6, seed: 5 });
  // violet tiré vers le magenta : sous l'éclairage rose de la station, un violet pur vire au bleu
  const vio = plankTexture('#9a6a40', null, { paint: '#a63ee0', chip: 0.3, wear: 0.4, seed: 3 });
  const blu = plankTexture('#9a6a40', null, { paint: '#2f7ac8', chip: 0.45, wear: 0.5, seed: 3 });
  X.crate = [
    mat('#ffffff', { map: nat.map, normalMap: nat.normalMap, rough: 0.72 }),
    mat('#ffffff', { map: vio.map, normalMap: vio.normalMap, rough: 0.55 }),
    mat('#ffffff', { map: blu.map, normalMap: blu.normalMap, rough: 0.55 }),
  ];
  // pylônes sous les dalles : tôle sombre un peu plus claire (les jointures se lisent sur le ciel)
  const py = paintedMetalTexture('#4c4a64', 'st-pylone', { chip: 0.3, edge: 0.9, rust: 0.3, bare: '#a0a8bc' });
  X.pylon = mat('#ffffff', { map: py.map, normalMap: py.normalMap, rough: 0.45, metal: 0.5 });
  X.drumVio = mat('#5f2ab8', { rough: 0.38, metal: 0.5 });
  X.ready = true;
  return X;
}

// Barre de section rectangulaire de a à b (largeur w, épaisseur h), non indexée
const _sd = new THREE.Vector3(), _sq = new THREE.Quaternion(), _sz = new THREE.Vector3(0, 0, 1);
function sbar(a, b, w, h = w) {
  _sd.subVectors(b, a);
  const g = new THREE.BoxGeometry(w, h, _sd.length()).toNonIndexed();
  g.applyQuaternion(_sq.setFromUnitVectors(_sz, _sd.normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}
// Cylindre non indexé, axe x (roues, poulies, axes), centré en (x, y, z)
const cylX = (r, len, seg, x, y, z) => new THREE.CylinderGeometry(r, r, len, seg).toNonIndexed().rotateZ(Math.PI / 2).translate(x, y, z);

// Caisse en planches de 1 m (centre à l'origine) : liteaux sur les douze arêtes, plateaux de trois planches sur les
// six faces, écharpe en diagonale sur les côtés, coins de tôle ; cœur sombre. Partagée (mise à l'échelle par matrice).
let plankCrate = null;
function plankCrateGeo() {
  if (plankCrate) return plankCrate;
  const s = 1, h = 0.5, f = 0.1, t = 0.04, rec = 0.015, Lw = s - 2 * f, o = h - f / 2;
  const wood = [], steel = [];
  for (const a of [1, -1]) for (const b of [1, -1]) {
    wood.push(plankBox(s, f, f, 1, a * 0.37 + b * 0.11).translate(0, a * o, b * o));
    wood.push(plankBox(f, f, Lw, 1, a * 0.53 + b * 0.29).translate(a * o, b * o, 0));
    wood.push(plankBox(f, Lw, f, 1, a * 0.71 + b * 0.17).translate(a * o, 0, b * o));
  }
  const faces = [[0, 0, 0], [0, Math.PI, 0], [0, Math.PI / 2, 0], [0, -Math.PI / 2, 0], [-Math.PI / 2, 0, 0], [Math.PI / 2, 0, 0]];
  const e = new THREE.Euler(), mm = new THREE.Matrix4();
  faces.forEach((r, i) => {
    mm.makeRotationFromEuler(e.set(...r));
    const pnl = plankPanel(Lw + 0.03, Lw + 0.03, 3, { thick: t, seed: i * 7 + 1, gap: 0.014 }).translate(0, 0, h - rec - t);
    wood.push(pnl.applyMatrix4(mm));
    if (i < 4) {
      const sg = i % 2 ? 1 : -1;
      wood.push(plankBox(Lw * Math.SQRT2 - 0.06, f * 0.8, t * 0.95, 1, i * 0.3).rotateZ(sg * Math.PI / 4).translate(0, 0, h - rec + t * 0.47).applyMatrix4(mm));
    }
  });
  const c = 0.17, pt = 0.012;
  for (const x of [1, -1]) for (const y of [1, -1]) for (const z of [1, -1]) {
    const k = h - c / 2 + 0.004;
    steel.push(boxAt(G.box(pt, c, c), x * (h + pt / 2), y * k, z * k));
    steel.push(boxAt(G.box(c, pt, c), x * k, y * (h + pt / 2), z * k));
    steel.push(boxAt(G.box(c, c, pt), x * k, y * k, z * (h + pt / 2)));
  }
  plankCrate = { wood: mergeParts(wood), steel: mergeParts(steel), core: boxAt(G.box(s - 0.1, s - 0.1, s - 0.1), 0, 0, 0) };
  plankCrate.core.userData.shared = true;
  return plankCrate;
}
// Pose une caisse en planches (matrice : centre, orientation, taille) ; kind : 0 bois nu, 1 violette, 2 bleue
function woodCrate(L, matrix, kind) {
  const x = xmats(), g = plankCrateGeo();
  L.add(g.wood, x.crate[kind], matrix);
  L.add(g.steel, x.darkPaint, matrix);
  L.add(g.core, mats().dark, matrix);
}

// Fût cerclé (variante du baril partagé, ≈ 0,41 × 1,1 m, centre à l'origine) : profil bombé, deux cercles de
// roulement, rebords sertis ; bondes sur le couvercle
let drumGeo = null;
function drumParts() {
  if (drumGeo) return drumGeo;
  const prof = [[0, -0.53], [0.37, -0.53], [0.385, -0.55], [0.405, -0.55], [0.41, -0.52], [0.395, -0.5], [0.4, -0.2], [0.418, -0.18], [0.418, -0.16], [0.405, -0.14],
    [0.41, 0], [0.405, 0.14], [0.418, 0.16], [0.418, 0.18], [0.4, 0.2], [0.395, 0.5], [0.41, 0.52], [0.405, 0.55], [0.385, 0.55], [0.37, 0.53], [0, 0.53]];
  const body = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 22);
  body.computeVertexNormals();
  body.userData.shared = true;
  const caps = mergeParts([boxAt(G.cyl(0.06, 0.06, 0.03, 10), 0.22, 0.54, 0.05), boxAt(G.cyl(0.04, 0.04, 0.03, 8), -0.2, 0.54, -0.12)]);
  drumGeo = { body, caps };
  return drumGeo;
}

// ------------------------------------------------------------- dalles, néons, cuves, tuyaux
// Plateforme métallique (dalle praticable)
export function deck(L, pos, w, d, o = {}) {
  const m = mats();
  const h = o.h ?? 1;
  L.box(new THREE.Vector3(pos.x, pos.y - h / 2, pos.z), new THREE.Vector3(w, h, d), o.mat || m.floor, { surface: 'metal', uvScale: 0.25, ry: o.ry || 0 });
  // bord jaune et noir
  if (o.trim !== false) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.ry || 0);
    for (const [x, z, sw, sd] of [[0, d / 2, w + 0.3, 0.3], [0, -d / 2, w + 0.3, 0.3], [w / 2, 0, 0.3, d], [-w / 2, 0, 0.3, d]]) {
      const p = new THREE.Vector3(x, 0, z).applyQuaternion(q).add(pos);
      L.add(boxUV(sw, h + 0.06, sd, 0.5), m.hazard, new THREE.Matrix4().compose(new THREE.Vector3(p.x, pos.y - h / 2 + 0.03, p.z), q, new THREE.Vector3(1, 1, 1)));
    }
  }
  // structure sous la dalle
  if (o.under !== false) {
    const H = o.underH ?? 14, g = pylonGeo(w, d, H);
    const mm = new THREE.Matrix4().compose(V(pos.x, pos.y - h, pos.z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), o.ry || 0), V(1, 1, 1));
    L.add(g.body, xmats().pylon, mm);
    L.add(g.steel, m.pipe, mm);
    L.add(g.gold, m.gold, mm);
    L.add(G.sphere(0.6, 10, 8), m.neonPink, mtx([pos.x, pos.y - h - H, pos.z]));
  }
}

// Pylône sous une dalle (sommet à y = 0, pied à -H) : fût conique en tronçons de tôles peintes, assemblés par des
// brides boulonnées et raidis de plats verticaux ; chapiteau, quatre jambes de force vers les coins de la dalle,
// deux conduites cerclées d'or le long du fût, tuyère au pied (le néon rose s'y accroche)
// Allégé (≈ 40 % de sommets en moins) : vu au plus près de 10 à 20 m, depuis les rails et les dalles voisines.
const pylonCache = new Map();
function pylonGeo(w, d, H) {
  const key = w + '|' + d + '|' + H;
  if (pylonCache.has(key)) return pylonCache.get(key);
  const s = Math.min(w, d), rt = s * 0.22, rb = s * 0.09, k = THREE.MathUtils.clamp(s / 16, 0.35, 1.4);
  const rAt = (y) => rt + (rb - rt) * (-y / H);
  const body = [], steel = [], gold = [];
  const n = Math.max(2, Math.round(H / 6)), yEnd = -H + 1.2 * k;
  const flangeR = (y) => rAt(y) * 1.12 + 0.12 * k;
  for (let i = 0; i < n; i++) {
    const ya = (yEnd * i) / n, yb = (yEnd * (i + 1)) / n, ra = rAt(ya), rz = rAt(yb);
    // tronçon : u en tôles (une jointure usée toutes les ≈ 2,4 m), v d'une bride à l'autre
    const seg = new THREE.CylinderGeometry(ra, rz, ya - yb, 14, 1, true).toNonIndexed();
    const uv = seg.attributes.uv, plates = Math.max(4, Math.round((Math.PI * (ra + rz)) / 2.4));
    for (let j = 0; j < uv.count; j++) uv.setX(j, uv.getX(j) * plates);
    body.push(seg.translate(0, (ya + yb) / 2, 0));
    // bride au pied du tronçon et sa couronne de boulons
    const rf = flangeR(yb), tf = 0.22 * k;
    body.push(new THREE.CylinderGeometry(rf, rf, tf, 16).toNonIndexed().translate(0, yb, 0));
    for (let b = 0; b < 5; b++) {
      const a = (b / 5) * Math.PI * 2 + i * 0.31, rr = (rz + rf) / 2 + 0.02 * k;
      steel.push(new THREE.BoxGeometry(0.16 * k, 0.1 * k, 0.16 * k).toNonIndexed().rotateY(-a).translate(Math.cos(a) * rr, yb + tf / 2 + 0.05 * k, Math.sin(a) * rr));
    }
    // raidisseurs : quatre plats radiaux, un tronçon sur deux
    if (i % 2 === 0) for (let f = 0; f < 4; f++) {
      const a = (f / 4) * Math.PI * 2 + Math.PI / 4;
      const fin = sbar(V(ra + 0.12 * k, ya - 0.1 * k, 0), V(rz + 0.12 * k, yb + tf / 2, 0), 0.26 * k, 0.07 * k).rotateY(-a);
      body.push(fin);
    }
  }
  // tuyère au pied
  const re = rAt(yEnd);
  body.push(new THREE.CylinderGeometry(re * 0.85, re * 0.45, 1.0 * k, 12).toNonIndexed().translate(0, yEnd - 0.5 * k, 0));
  // chapiteau et jambes de force (platines sous la dalle)
  body.push(new THREE.CylinderGeometry(rt * 1.25, rt * 1.05, 0.5 * k, 18).toNonIndexed().translate(0, -0.25 * k, 0));
  const ys = -H * 0.3, rs = rAt(ys);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const top = V(sx * w * 0.36, -0.05, sz * d * 0.36), dir = V(sx, 0, sz).normalize();
    body.push(sbar(dir.clone().multiplyScalar(rs).setY(ys), top, 0.35 * k));
    body.push(new THREE.BoxGeometry(1.0 * k, 0.12 * k, 1.0 * k).toNonIndexed().translate(top.x, -0.06 * k, top.z));
  }
  // collier des jambes de force : fermé (ses fonds, cachés dans le fût, bouchent la fente entre collier et fût)
  body.push(new THREE.CylinderGeometry(rs + 0.1 * k, rs + 0.1 * k, 0.5 * k, 14).toNonIndexed().translate(0, ys, 0));
  // deux conduites le long du fût, au ras des brides, cerclées d'or au-dessus de chacune : elles montent jusque sous
  // la dalle (à travers le bord du chapiteau) et sont tenues au fût par une patte au droit de chaque cercle d'or ;
  // la dernière patte sert de coude d'entrée dans le fût
  const yl = (yEnd * (n - 1)) / n + 0.35 * k;
  for (const a of [0.45, 0.45 + Math.PI]) {
    const off = (y) => flangeR(y) + 0.22 * k;
    const ca = Math.cos(a), sa = Math.sin(a);
    steel.push(tube(V(ca * off(0), 0, sa * off(0)), V(ca * off(yl), yl - 0.11 * k, sa * off(yl)), 0.13 * k, 0.13 * k, 6));
    for (let i = 1; i < n; i++) {
      const y = (yEnd * i) / n + 0.35 * k;
      gold.push(new THREE.CylinderGeometry(0.19 * k, 0.19 * k, 0.2 * k, 8).toNonIndexed().translate(ca * off(y), y, sa * off(y)));
      steel.push(tube(V(ca * off(y), y, sa * off(y)), V(ca * rAt(y) * 0.85, y, sa * rAt(y) * 0.85), 0.11 * k, 0.11 * k, 6));
    }
  }
  const res = { body: mergeParts(body), steel: mergeParts(steel), gold: mergeParts(gold) };
  pylonCache.set(key, res);
  return res;
}

// couleurs de lumière des néons
const NEON = { pink: '#ff4fa0', gold: '#ffc233', cyan: '#3ef2ff' };

export function neonStrip(L, a, b, color = 'pink', o = {}) {
  const m = mats();
  // un néon en hauteur éclaire surtout en dessous : la lumière est descendue (pas de point brûlé au plafond)
  if (o.light !== false) lights.add({ line: [a, b], offset: V(0, a.y > 4 ? -1 : 0, 0), color: NEON[color] || NEON.cyan, intensity: o.intensity ?? 34, range: o.range ?? 8.5, priority: 1.5 });
  const d = new THREE.Vector3().subVectors(b, a);
  const c = new THREE.Vector3().lerpVectors(a, b, 0.5);
  L.add(G.box(0.12, 0.12, d.length()), color === 'pink' ? m.neonPink : color === 'gold' ? m.neonGold : m.neonCyan, new THREE.Matrix4().compose(c, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.normalize()), new THREE.Vector3(1, 1, 1)));
}

// Cuve : socle, fût cerclé, dôme à trou d'homme, échelle côté +x, vanne de vidange côté -z. Avec o.fluid (couleur),
// variante vitrée : virole de verre entre deux fûts courts, liquide lumineux qui bouillonne (o.level : remplissage) ;
// sinon jauge lumineuse côté +z.
export function tank(L, pos, r = 2, h = 6, o = {}) {
  const m = mats();
  const at = (x, y, z) => mtx([pos.x + x, pos.y + y, pos.z + z]);
  const vat = !!o.fluid, hb = 1.1, ht = h - 0.8;
  // socle, fût, dôme, cerclages
  L.add(G.cyl(r + 0.18, r + 0.25, 0.35, 24), m.dark, at(0, 0.175, 0));
  if (vat) {
    L.add(G.cyl(r, r, hb, 28), m.voraxPanel, at(0, hb / 2, 0));
    L.add(G.cyl(r, r, h - ht, 28), m.voraxPanel, at(0, (h + ht) / 2, 0));
  } else L.add(G.cyl(r, r, h, 28), m.voraxPanel, at(0, h / 2, 0));
  L.add(new THREE.SphereGeometry(r, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), m.voraxPanel, at(0, h, 0));
  for (const y of vat ? [0.55, h - 0.15] : [0.55, h * 0.5, h - 0.3]) L.add(G.torus(r + 0.04, 0.08, 6, 32), m.gold, mtx([pos.x, pos.y + y, pos.z], [Math.PI / 2, 0, 0]));
  // boulons du cerclage central (de chaque bride sur la cuve vitrée, entre les montants)
  for (const [y, rb] of vat ? [[hb, r + 0.13], [ht, r + 0.13]] : [[h * 0.5, r + 0.12]]) {
    for (let k = 0; k < 16; k++) {
      const a = ((k + (vat ? 0.5 : 0)) / 16) * Math.PI * 2;
      L.add(G.cyl(0.05, 0.05, 0.06, 6), m.dark, mtx([pos.x + Math.cos(a) * rb, pos.y + y, pos.z + Math.sin(a) * rb], [0, -a, Math.PI / 2]));
    }
  }
  // trou d'homme sur le dôme, avec sa poignée
  L.add(G.cyl(r * 0.28, r * 0.3, 0.18, 16), m.dark, at(0, h + r * 0.96, 0));
  L.add(G.torus(r * 0.12, 0.03, 6, 14, Math.PI), m.pipe, mtx([pos.x, pos.y + h + r * 0.96 + 0.09, pos.z], [0, 0, 0]));
  if (vat) vatWindow(L, pos, r, hb, ht, o);
  else {
    // jauge (tube de verre, liquide lumineux) côté +z
    // le tube lumineux est posé sur sa platine, et ses deux brides prennent appui sur le fût (facettes comprises)
    const zf = r + 0.074;
    L.add(G.box(0.3, h * 0.7, 0.06), m.dark, at(0, h / 2, r + 0.02));
    L.add(G.box(0.14, h * 0.62, 0.05), m.neonCyan, at(0, h * 0.46, zf));
    for (const y of [h * 0.14, h * 0.85]) L.add(G.box(0.36, 0.1, 0.22), m.pipe, at(0, y, r + 0.08));
    lights.add({ line: [V(pos.x, pos.y + h * 0.2, pos.z + r + 0.4), V(pos.x, pos.y + h * 0.8, pos.z + r + 0.4)], color: NEON.cyan, intensity: 16, range: 7, priority: 1 });
  }
  // échelle côté +x
  const xl = r + 0.28;
  // montants posés sur la dalle (ils commençaient 20 cm au-dessus)
  for (const dz of [-0.24, 0.24]) L.add(G.cyl(0.035, 0.035, h + 0.5, 6), m.pipe, at(xl, (h + 0.5) / 2, dz));
  for (let y = 0.6; y < h; y += 0.4) L.add(G.cyl(0.025, 0.025, 0.48, 6), m.pipe, mtx([pos.x + xl, pos.y + y, pos.z], [Math.PI / 2, 0, 0]));
  for (const y of [1, h - 0.4]) for (const dz of [-0.24, 0.24]) L.add(G.box(0.3, 0.05, 0.05), m.dark, at(r + 0.12, y, dz));
  // vidange : coude, vanne à volant côté -z
  L.add(G.cyl(0.14, 0.14, 0.5, 10), m.pipe, mtx([pos.x, pos.y + 0.7, pos.z - r - 0.2], [Math.PI / 2, 0, 0]));
  L.add(G.cyl(0.2, 0.2, 0.12, 12), m.dark, mtx([pos.x, pos.y + 0.7, pos.z - r - 0.45], [Math.PI / 2, 0, 0]));
  // tige de manœuvre : le volant tient sur la vanne (il flottait 2 cm devant)
  L.add(G.cyl(0.035, 0.035, 0.1, 8), m.pipe, mtx([pos.x, pos.y + 0.7, pos.z - r - 0.53], [Math.PI / 2, 0, 0]));
  L.add(G.torus(0.22, 0.03, 6, 18), m.gold, mtx([pos.x, pos.y + 0.7, pos.z - r - 0.56]));
  L.add(G.box(0.44, 0.03, 0.03), m.gold, at(0, 0.7, -r - 0.56));
  L.add(G.box(0.03, 0.44, 0.03), m.gold, at(0, 0.7, -r - 0.56));
  L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y, pos.y + h + r * 0.8, r, { surface: 'metal' }));
}

// Virole vitrée d'une cuve, de hb à ht : brides d'acier aux deux bouts, huit montants (aucun côté échelle), vitre
// sans ombre, liquide lumineux (texture qui monte : bulles et spores) et son ménisque, lueur au cœur
const vatFluids = new Map();
const vatLevels = new WeakSet();
function vatWindow(L, pos, r, hb, ht, o) {
  const m = mats();
  const at = (x, y, z, rot) => mtx([pos.x + x, pos.y + y, pos.z + z], rot);
  const H = ht - hb;
  for (const y of [hb, ht]) L.add(G.cyl(r + 0.1, r + 0.1, 0.2, 28), m.dark, at(0, y, 0));
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) / 8) * Math.PI * 2;
    // face intérieure contre la vitre, pieds et têtes dans les brides
    L.add(G.box(0.1, H - 0.2, 0.13), m.dark, at(Math.cos(a) * (r + 0.04), hb + H / 2, Math.sin(a) * (r + 0.04), [0, -a, 0]));
  }
  // liquide : la texture garde des bulles rondes (≈ 1,6 m par tuile) et défile vers le haut
  if (!vatFluids.has(o.fluid)) {
    const tex = sporeFluidTexture(o.fluid).map;
    vatFluids.set(o.fluid, { tex, mat: mat('#ffffff', { map: tex, rough: 0.15, metal: 0, emissive: '#ffffff', emissiveIntensity: 1.1, unique: true }) });
    vatFluids.get(o.fluid).mat.emissiveMap = tex;
  }
  const F = vatFluids.get(o.fluid);
  const lv = H * (o.level ?? 0.8), rf = r - 0.08;
  const fg = new THREE.CylinderGeometry(rf, rf, lv, 28);
  const uv = fg.attributes.uv, ku = Math.max(1, Math.round((Math.PI * 2 * rf) / 1.6)), kv = lv / 1.6;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ku, uv.getY(i) * kv);
  L.add(fg, F.mat, at(0, hb + lv / 2, 0));
  L.add(G.torus(rf - 0.02, 0.035, 6, 32), glow(o.fluid, 2.4), at(0, hb + lv, 0, [Math.PI / 2, 0, 0]));
  if (!vatLevels.has(L)) {
    vatLevels.add(L);
    L.every((dt) => { for (const f of vatFluids.values()) f.tex.offset.y -= dt * 0.12; });
  }
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.01, r - 0.01, H, 32, 1, true), m.glass);
  glass.position.set(pos.x, pos.y + hb + H / 2, pos.z);
  glass.userData.noAO = true;
  L.root.add(glass);
  lights.add({ pos: V(pos.x, pos.y + hb + lv * 0.55, pos.z), color: o.fluid, intensity: o.intensity ?? 22, range: r * 2 + 5, priority: 1.1 });
}

const crateMats = {};
export function crate3(L, pos, color = '#6a2bd0') {
  const m = mats();
  if (!crateMats[color]) {
    const c = new THREE.Color(color);
    crateMats[color] = { body: mat(color, { rough: 0.45, metal: 0.45 }), panel: mat('#' + c.clone().multiplyScalar(0.78).getHexString(), { rough: 0.5, metal: 0.4 }) };
  }
  const cm = crateMats[color];
  const c = new THREE.Vector3(pos.x, pos.y + 1, pos.z);
  const at = (x, y, z, r) => mtx([c.x + x, c.y + y, c.z + z], r || [0, 0, 0]);
  // caisson arrondi, panneaux en creux sur les six faces, arêtes renforcées
  L.add(G.rbox(1.9, 1.9, 1.9, 0.08), cm.body, at(0, 0, 0));
  for (const [ax, sgn] of [[0, 1], [0, -1], [2, 1], [2, -1], [1, 1]]) {
    const p = [0, 0, 0]; p[ax] = sgn * 0.955;
    const sz = [1.45, 1.45, 1.45]; sz[ax] = 0.04;
    L.add(G.rbox(sz[0], sz[1], sz[2], 0.015), cm.panel, at(p[0], p[1], p[2]));
  }
  for (const x of [-1, 1]) for (const z of [-1, 1]) L.add(G.rbox(0.18, 2.02, 0.18, 0.03), m.dark, at(x * 0.93, 0, z * 0.93));
  for (const y of [-1, 1]) {
    for (const z of [-1, 1]) L.add(G.rbox(1.7, 0.16, 0.16, 0.03), m.dark, at(0, y * 0.93, z * 0.93));
    for (const x of [-1, 1]) L.add(G.rbox(0.16, 0.16, 1.7, 0.03), m.dark, at(x * 0.93, y * 0.93, 0));
  }
  // poignées latérales, voyant d'état, bande d'avertissement
  for (const x of [-1, 1]) {
    L.add(G.box(0.05, 0.08, 0.6), m.pipe, at(x * 1.04, 0.45, 0));
    for (const z of [-0.28, 0.28]) L.add(G.box(0.1, 0.08, 0.06), m.dark, at(x * 1.0, 0.45, z));
  }
  L.add(G.box(0.5, 0.07, 0.03), m.neonCyan, at(0.35, 0.62, 0.99));
  L.add(boxUV(1.45, 0.22, 0.02, 0.5), m.hazard, new THREE.Matrix4().compose(new THREE.Vector3(c.x, c.y - 0.55, c.z + 0.985), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)));
  L.box(c, new THREE.Vector3(2, 2, 2), null, { surface: 'metal' });
}

export function vertPipe(L, pos, h, r = 0.6) {
  const m = mats();
  L.add(G.cyl(r, r, h, 14), m.pipe, mtx([pos.x, pos.y + h / 2, pos.z]));
  for (let y = 1; y < h; y += 3) L.add(G.cyl(r * 1.2, r * 1.2, 0.25, 14), m.gold, mtx([pos.x, pos.y + y, pos.z]));
}

// ------------------------------------------------------------- outils
// Poutre entre deux points (section carrée)
function beam(L, a, b, s, material) {
  const d = new THREE.Vector3().subVectors(b, a);
  const c = new THREE.Vector3().lerpVectors(a, b, 0.5);
  L.add(G.box(s, s, d.length()), material, new THREE.Matrix4().compose(c, new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), d.normalize()), V(1, 1, 1)));
}

// Garde-corps le long d'un segment au sol (poteaux, main courante, lisse) ; bloque le passage
export function railing(L, a, b, o = {}) {
  const m = mats();
  const h = o.h ?? 1.1;
  const d = new THREE.Vector3().subVectors(b, a).setY(0);
  const len = d.length();
  const n = Math.max(1, Math.round(len / 2.2));
  for (let i = 0; i <= n; i++) {
    const p = new THREE.Vector3().lerpVectors(a, b, i / n);
    L.add(G.cyl(0.05, 0.05, h, 6), m.pipe, mtx([p.x, p.y + h / 2, p.z]));
  }
  beam(L, V(a.x, a.y + h, a.z), V(b.x, b.y + h, b.z), 0.08, m.gold);
  beam(L, V(a.x, a.y + h * 0.5, a.z), V(b.x, b.y + h * 0.5, b.z), 0.05, m.pipe);
  if (o.collide !== false) {
    const c = new THREE.Vector3().lerpVectors(a, b, 0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), d.clone().normalize());
    L.game.world.add(new BoxCollider(V(c.x, c.y + h / 2, c.z), V(0.08, h / 2, len / 2), q, { surface: 'metal', blocksCamera: false }));
  }
}

// ------------------------------------------------------------- fonderie
// Haut-fourneau : cuve conique cerclée, gueulard incandescent, trou de coulée et rigole vers la position « to »
export function furnace(L, pos, o = {}) {
  const m = mats();
  const g = L.game;
  const H = o.h ?? 15;
  const prof = [[3.2, 0], [3.6, 1.2], [4.2, H * 0.35], [3.6, H * 0.7], [2.4, H * 0.92], [2.0, H]];
  const body = G.lathe('furnace' + H, prof, 28);
  L.add(body, m.soot, mtx([pos.x, pos.y, pos.z]));
  // rayon de la cuve à la hauteur y (profil du tour), pour poser cerclages et tuyères sur la tôle
  const rAt = (y) => {
    for (let i = 1; i < prof.length; i++) if (y <= prof[i][1]) return prof[i - 1][0] + ((prof[i][0] - prof[i - 1][0]) * (y - prof[i - 1][1])) / (prof[i][1] - prof[i - 1][1]);
    return prof[prof.length - 1][0];
  };
  // cerclages serrés sur la cuve (le haut flottait 50 cm à côté, le bas 7 cm)
  for (const k of [0.12, 0.3, 0.5, 0.68, 0.84]) {
    const y = H * k;
    L.add(G.torus(rAt(y) + 0.1, 0.16, 6, 32), m.beam, mtx([pos.x, pos.y + y, pos.z], [Math.PI / 2, 0, 0]));
  }
  // gueulard (bouche du haut, évasé depuis le bord de la cuve) et bain incandescent qui remplit la bouche
  L.add(G.cyl(2.1, 2.0, 0.5, 24, true), m.dark, mtx([pos.x, pos.y + H + 0.25, pos.z]));
  L.add(G.cyl(rAt(H - 0.2) - 0.02, rAt(H - 0.2) - 0.02, 0.1, 24), m.moltenHot, mtx([pos.x, pos.y + H - 0.2, pos.z]));
  // fenêtres de surveillance incandescentes
  const face = o.face ?? 0;
  for (let i = -2; i <= 2; i++) {
    const a = face + i * 0.42;
    const r = 4.12;
    L.add(G.box(0.5, 1.4, 0.2), m.molten, mtx([pos.x + Math.sin(a) * r, pos.y + H * 0.35, pos.z + Math.cos(a) * r], [0, a, 0]));
  }
  // trou de coulée et rigole
  const tap = V(pos.x + Math.sin(face) * 3.7, pos.y + 1.6, pos.z + Math.cos(face) * 3.7);
  // rougeoiement des fenêtres et du trou de coulée
  lights.add({ pos: V(pos.x + Math.sin(face) * 6, pos.y + H * 0.35, pos.z + Math.cos(face) * 6), color: '#ff6a1a', intensity: 90, range: 14, flicker: 0.15, priority: 2.4 });
  lights.add({ pos: V(pos.x + Math.sin(face) * 5, pos.y + 1.8, pos.z + Math.cos(face) * 5), color: '#ff8a2a', intensity: 50, range: 11, flicker: 0.2, priority: 2 });
  L.add(G.box(1.4, 1.2, 0.6), m.moltenHot, mtx([tap.x, tap.y, tap.z], [0, face, 0]));
  if (o.to) {
    const to = o.to;
    const d = new THREE.Vector3().subVectors(to, tap);
    const c = new THREE.Vector3().lerpVectors(tap, to, 0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), d.clone().normalize());
    L.add(G.box(1.3, 0.5, d.length()), m.soot, new THREE.Matrix4().compose(c, q, V(1, 1, 1)));
    L.add(G.box(0.8, 0.12, d.length()), m.molten, new THREE.Matrix4().compose(c.clone().add(V(0, 0.22, 0)), q, V(1, 1, 1)));
  }
  // tuyères : de la conduite circulaire de vent chaud, elles descendent vers la cuve et y entrent
  const yr = H * 0.3, yt = H * 0.2;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3, sa = Math.sin(a), ca = Math.cos(a);
    const rt = rAt(yt) - 0.15;
    L.add(tube(V(pos.x + sa * 5, pos.y + yr, pos.z + ca * 5), V(pos.x + sa * rt, pos.y + yt, pos.z + ca * rt), 0.22, 0.22, 8), m.pipe);
  }
  L.add(G.torus(5, 0.35, 8, 36), m.pipe, mtx([pos.x, pos.y + yr, pos.z], [Math.PI / 2, 0, 0]));
  g.world.add(new CylinderCollider(pos.x, pos.z, pos.y, pos.y + H, 4.2, { surface: 'metal' }));
  // fumée et escarbilles au gueulard
  let t = 0;
  const top = V(pos.x, pos.y + H + 0.4, pos.z);
  L.every((dt) => {
    t -= dt;
    if (t > 0) return;
    t = 0.12;
    if (g.camera.cam.position.distanceTo(top) > 140) return;
    g.fx.smoke(top, 1, '#2a2228', 3, 4);
    if (Math.random() < 0.6) g.fx.sparks(top, V(0, 1, 0), 2, '#ffb03a', 6, 0.16);
  });
  return { tap, top };
}

// Cheminée d'usine avec panache
export function smokestack(L, pos, h = 18, r = 1.2) {
  const m = mats();
  const g = L.game;
  L.add(G.cyl(r * 0.8, r, h, 18), m.soot, mtx([pos.x, pos.y + h / 2, pos.z]));
  for (const k of [0.25, 0.55, 0.85]) L.add(G.torus(r * (1 - k * 0.2) + 0.08, 0.1, 6, 20), m.hazard, mtx([pos.x, pos.y + h * k, pos.z], [Math.PI / 2, 0, 0]));
  // feu de balisage posé sur le couronnement (il flottait 5 cm au-dessus)
  L.add(G.sphere(0.25, 8, 6), glow('#ff3a3a', 3), mtx([pos.x, pos.y + h + 0.22, pos.z]));
  const top = V(pos.x, pos.y + h + 0.2, pos.z);
  let t = Math.random() * 0.2;
  L.every((dt) => {
    t -= dt;
    if (t > 0) return;
    t = 0.18;
    if (g.camera.cam.position.distanceTo(top) > 160) return;
    g.fx.smoke(top, 1, '#3a3038', 2.4, 3.5);
  });
}

// Portique au-dessus d'un bassin : deux pieds de chaque côté, poutre transversale, chariot et poche de coulée
// qui bascule régulièrement pour verser un jet de métal en fusion au point « pour ».
export function ladleGantry(L, x0, x1, z, y, pour, o = {}) {
  const m = mats();
  const g = L.game;
  const foot = o.foot ?? -30;
  for (const x of [x0, x1]) {
    for (const dz of [-1.4, 1.4]) beam(L, V(x, foot, z + dz), V(x, y + 0.6, z + dz), 0.5, m.rack);
    beam(L, V(x, y - 2, z - 1.4), V(x, y - 2, z + 1.4), 0.35, m.rack);
  }
  for (const dz of [-1, 1]) beam(L, V(x0, y + 0.8, z + dz), V(x1, y + 0.8, z + dz), 0.6, m.rack);
  for (let x = x0 + 1; x < x1; x += 2.5) L.add(G.box(0.5, 0.08, 2.4), m.hazard, mtx([x, y + 1.15, z]));
  // chariot + câbles + poche
  const trolley = joint(L.root, [pour.x, y + 0.8, z]);
  part(trolley, G.rbox(1.8, 0.8, 2.6, 0.1), m.dark, {});
  part(trolley, G.sphere(0.12, 8, 6), glow('#ffcc33', 3), { p: [0, 0.5, 1.2] });
  const drop = y - (o.hang ?? 4.5);
  // la poche pend à une anse (deux bras sur les tourillons, traverse au-dessus du bec qui bascule) ; les câbles
  // du chariot descendent jusqu'à la traverse (ils s'arrêtaient en l'air, 5 cm au-dessus de la poche)
  const bailY = 2.2, cab = y + 0.8 - (drop + bailY + 0.1);
  for (const dx of [-0.5, 0.5]) part(trolley, G.cyl(0.04, 0.04, cab, 5), m.pipe, { p: [dx, -cab / 2, 0] });
  const pivot = joint(L.root, [pour.x, drop, z]);
  for (const dx of [-1, 1]) part(pivot, G.box(0.14, bailY - 0.05, 0.22), m.beam, { p: [dx * 1.75, 0.2 + (bailY - 0.25) / 2, 0] });
  part(pivot, G.box(3.64, 0.2, 0.22), m.beam, { p: [0, bailY, 0] });
  part(pivot, G.box(1.3, 0.12, 0.3), m.dark, { p: [0, bailY + 0.14, 0] });
  const ladle = joint(pivot, [0, 0, 0]);
  part(ladle, G.lathe('ladle', [[0.01, -1.6], [1.0, -1.5], [1.35, -0.6], [1.5, 0.6], [1.45, 0.75]], 24), m.soot, {});
  part(ladle, G.cyl(1.3, 1.3, 0.08, 24), m.moltenHot, { p: [0, 0.55, 0] });
  lights.add({ obj: ladle, offset: V(0, 1.6, 0), color: '#ff7a24', intensity: 55, range: 10, flicker: 0.15, priority: 2 });
  part(ladle, G.torus(1.52, 0.12, 6, 28), m.beam, { p: [0, 0.6, 0], r: [Math.PI / 2, 0, 0] });
  for (const dx of [-1, 1]) part(ladle, G.cyl(0.2, 0.2, 0.4, 8), m.beam, { p: [dx * 1.6, 0.2, 0], r: [0, 0, Math.PI / 2] });
  part(ladle, G.box(0.5, 0.25, 0.7), m.soot, { p: [0, 0.65, 1.55] });
  // jet : cylindre lumineux tendu du bec au bassin
  const stream = new THREE.Mesh(G.cyl(0.22, 0.32, 1, 10, true), M.moltenHot);
  stream.visible = false;
  L.root.add(stream);
  const splash = V(pour.x, pour.y, z + 1.6);
  let t = o.phase ?? 0;
  const lip = new THREE.Vector3();
  L.every((dt) => {
    t += dt;
    const c = t % 9;
    // bascule 0 → 1,2 rad entre 5 et 6 s, verse jusqu'à 7,4 s, revient
    const tilt = c < 5 ? 0 : c < 6 ? (c - 5) * 1.05 : c < 7.4 ? 1.05 : c < 8.4 ? 1.05 * (1 - (c - 7.4)) : 0;
    ladle.rotation.x = tilt;
    const pouring = c > 5.8 && c < 7.6;
    stream.visible = pouring;
    if (pouring) {
      lip.set(0, 0.65, 1.6).applyAxisAngle(V(1, 0, 0), tilt).add(pivot.position);
      const len = lip.y - splash.y;
      stream.position.set(lip.x, (lip.y + splash.y) / 2, (lip.z + splash.z) / 2);
      stream.scale.set(1 + Math.sin(t * 30) * 0.1, len, 1);
      if (Math.random() < 0.5 && g.camera.cam.position.distanceTo(splash) < 70) {
        g.fx.sparks(splash, V(0, 1, 0), 3, '#ffb03a', 8, 0.2);
        if (Math.random() < 0.3) g.fx.smoke(splash, 1, '#4a3a3a', 1.6, 2.5);
      }
      if (c - dt <= 5.8) g.audio.play('splash', { pos: splash, pitch: 0.45, vol: 0.6 });
    }
  });
}

// Escarbilles qui montent d'un bassin de métal en fusion
export function embers(L, center, w, d, rate = 0.06) {
  const g = L.game;
  let t = 0;
  L.every((dt) => {
    t -= dt;
    if (t > 0) return;
    t = rate;
    if (g.camera.cam.position.distanceTo(center) > 60) return;
    const p = V(center.x + (Math.random() - 0.5) * w, center.y + 0.1, center.z + (Math.random() - 0.5) * d);
    g.fx.spark(p, V((Math.random() - 0.5) * 0.6, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 0.6), { life: 1.4 + Math.random(), size: 0.14, size1: 0.02, color: new THREE.Color('#ffa03a'), tile: 1, drag: 0.6, gravity: -0.4 });
  });
}

// ------------------------------------------------------------- atmosphère
// Faisceau de projecteur : cône additif (bords adoucis selon l'angle de vue, poussière qui dérive, fondu au contact
// du décor par la profondeur de l'image opaque), sur la couche des effets ; visible dans toutes les qualités.
// o : { r0, r1 (rayons au départ et au bout), color, intensity, sweep: [axe, amplitude, vitesse] (balayage) }
const BEAM_FRAG = /* glsl */ `
uniform sampler2D tSceneDepth, tNoise;
uniform vec2 uRes;
uniform float uCamNear, uCamFar, uTime, uLen;
uniform vec3 uColor, uFrom, uDir;
varying vec3 vWPos, vWNrm;
float kLin(float d) { return (uCamNear * uCamFar) / (uCamFar - (uCamFar - uCamNear) * d); }
void main() {
  vec3 V = normalize(cameraPosition - vWPos);
  float edge = pow(abs(dot(normalize(vWNrm), V)), 1.8);
  float t = clamp(dot(vWPos - uFrom, uDir) / uLen, 0.0, 1.0);
  float along = pow(1.0 - t, 1.4) * smoothstep(0.0, 0.05, t);
  vec2 q = vec2(vWPos.x * 0.06 + vWPos.z * 0.05, vWPos.y * 0.07 - uTime * 0.04);
  float n = texture2D(tNoise, q).r * 0.6 + texture2D(tNoise, q * 2.7 + vec2(uTime * 0.02, 0.37)).a * 0.4;
  float sceneZ = kLin(texture2D(tSceneDepth, gl_FragCoord.xy / uRes).x);
  float fragZ = kLin(gl_FragCoord.z);
  float soft = clamp((sceneZ - fragZ) / 1.5, 0.0, 1.0) * smoothstep(0.6, 3.5, fragZ) * (1.0 - smoothstep(70.0, 160.0, fragZ));
  gl_FragColor = vec4(uColor * edge * along * soft * mix(0.45, 1.3, n), 1.0);
}`;
const _up = V(0, 1, 0);
export function lightBeam(L, from, to, o = {}) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  dir.normalize();
  const u = {
    tSceneDepth: frameU.tSceneDepth, tNoise: { value: noiseTexture() }, uRes: frameU.uRes, uCamNear: frameU.uCamNear, uCamFar: frameU.uCamFar,
    uTime: { value: 0 }, uLen: { value: len }, uColor: { value: new THREE.Color(o.color || '#fff0d0').multiplyScalar(o.intensity ?? 0.35) },
    uFrom: { value: from.clone() }, uDir: { value: dir.clone() },
  };
  const m = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: 'varying vec3 vWPos, vWNrm; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWPos = w.xyz; vWNrm = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: BEAM_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  // cône le long de +y (sommet en haut), retourné vers « to »
  const geo = new THREE.CylinderGeometry(o.r0 ?? 0.3, o.r1 ?? 2.5, len, 28, 1, true).translate(0, -len / 2, 0);
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.copy(from);
  mesh.quaternion.setFromUnitVectors(_up.clone().negate(), dir);
  mesh.layers.set(LAYERS.FX);
  mesh.userData.noAO = true;
  mesh.frustumCulled = true;
  mesh.name = 'faisceau';
  L.root.add(mesh);
  const q0 = mesh.quaternion.clone(), qs = new THREE.Quaternion();
  const sw = o.sweep;
  L.every((dt, t) => {
    u.uTime.value = t;
    if (!sw) return;
    mesh.quaternion.copy(q0).premultiply(qs.setFromAxisAngle(sw[0], Math.sin(t * sw[2] + (sw[3] || 0)) * sw[1]));
    u.uDir.value.set(0, -1, 0).applyQuaternion(mesh.quaternion);
  });
  return mesh;
}

// Rais de soleil par une baie vitrée : volume (boîte, faces arrière) où chaque échantillon du rayon de vue remonte
// vers le soleil jusqu'au plan de la vitre et n'est éclairé que s'il passe entre les montants et la traverse.
// Marche courte (16 pas), arrêtée par le décor ; visible dans toutes les qualités (le brouillard volumétrique
// d'Ultra/Haute ne voit qu'un voile très léger dans un hangar fermé).
// o : { min, max (boîte éclairée), z (plan de la vitre), x0, x1, y0, y1 (vitrage), step, m0 (pas et origine des montants),
//       bar (hauteur de la traverse), color, intensity }
const SHAFT_FRAG = /* glsl */ `
uniform sampler2D tSceneDepth, tNoise;
uniform vec2 uRes;
uniform float uCamNear, uCamFar, uTime, uWinZ, uStep, uBar, uM0;
uniform vec3 uMin, uMax, uSun, uColor;
uniform vec4 uWin;
varying vec3 vWPos;
float kLin(float d) { return (uCamNear * uCamFar) / (uCamFar - (uCamFar - uCamNear) * d); }
float lit(vec3 p) {
  vec3 q = p + uSun * ((uWinZ - p.z) / uSun.z);
  if (q.x < uWin.x || q.x > uWin.y || q.y < uWin.z || q.y > uWin.w) return 0.0;
  // distance au montant le plus proche (montants tous les uStep à partir de uM0), puis à la traverse
  float dm = (0.5 - abs(fract((q.x - uM0) / uStep) - 0.5)) * uStep;
  float m = smoothstep(0.12, 0.32, dm) * smoothstep(0.1, 0.3, abs(q.y - uBar));
  return m * smoothstep(0.0, 0.5, q.y - uWin.z) * smoothstep(0.0, 0.3, uWin.w - q.y);
}
void main() {
  vec3 ro = cameraPosition, rd = normalize(vWPos - ro);
  vec3 inv = 1.0 / rd;
  vec3 ta = (uMin - ro) * inv, tb = (uMax - ro) * inv;
  vec3 tn = min(ta, tb), tx = max(ta, tb);
  float t0 = max(max(max(tn.x, tn.y), tn.z), 0.0);
  float t1 = min(min(tx.x, tx.y), tx.z);
  float vz = kLin(texture2D(tSceneDepth, gl_FragCoord.xy / uRes).x);
  vec3 fw = normalize((viewMatrix * vec4(rd, 0.0)).xyz);
  t1 = min(t1, vz / max(-fw.z, 1e-3));
  if (t1 <= t0) discard;
  float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float dt = (t1 - t0) / 16.0, acc = 0.0;
  for (int i = 0; i < 16; i++) {
    vec3 p = ro + rd * (t0 + (float(i) + j) * dt);
    float n = texture2D(tNoise, p.xz * 0.06 + vec2(p.y * 0.04 + uTime * 0.012, -uTime * 0.008)).r;
    acc += lit(p) * mix(0.35, 1.5, n);
  }
  // de face (vers la baie), le volume entier serait éclairé : voile atténué pour garder l'espace net
  float ph = mix(1.0, 0.2, smoothstep(0.2, 0.85, dot(rd, uSun)));
  gl_FragColor = vec4(uColor * acc * dt * ph, 1.0);
}`;
export function windowShafts(L, sunDir, o) {
  const u = {
    tSceneDepth: frameU.tSceneDepth, tNoise: { value: noiseTexture() }, uRes: frameU.uRes, uCamNear: frameU.uCamNear, uCamFar: frameU.uCamFar,
    uTime: { value: 0 }, uWinZ: { value: o.z }, uStep: { value: o.step }, uBar: { value: o.bar }, uM0: { value: o.m0 ?? o.x0 },
    uMin: { value: o.min.clone() }, uMax: { value: o.max.clone() }, uSun: { value: sunDir.clone().normalize() },
    uColor: { value: new THREE.Color(o.color || '#e8eeff').multiplyScalar(o.intensity ?? 0.05) },
    uWin: { value: new THREE.Vector4(o.x0, o.x1, o.y0, o.y1) },
  };
  const m = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: 'varying vec3 vWPos; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWPos = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: SHAFT_FRAG,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
  });
  const size = new THREE.Vector3().subVectors(o.max, o.min);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), m);
  mesh.position.lerpVectors(o.min, o.max, 0.5);
  mesh.layers.set(LAYERS.FX);
  mesh.userData.noAO = true;
  mesh.name = 'rais-de-baie';
  L.root.add(mesh);
  L.every((dt, t) => { u.uTime.value = t; });
  return mesh;
}

// Bouche de vapeur au sol : grille, puis bouffées blanches qui montent (jet continu ou rafales régulières)
export function steamVent(L, pos, o = {}) {
  const m = mats();
  const g = L.game;
  const s = o.size ?? 1;
  if (o.grate !== false) {
    L.add(G.cyl(0.55 * s, 0.6 * s, 0.08, 16), m.dark, mtx([pos.x, pos.y + 0.04, pos.z]));
    for (let i = -2; i <= 2; i++) L.add(G.box(0.07, 0.04, 0.9 * s), m.pipe, mtx([pos.x + i * 0.18 * s, pos.y + 0.09, pos.z]));
  }
  const color = new THREE.Color(o.color || '#ece6f6');
  const period = o.period ?? 0, burst = o.burst ?? 1.2;
  const v = V(0, 0, 0), p = V(0, 0, 0);
  let t = Math.random() * 3, acc = 0;
  L.every((dt) => {
    t += dt;
    acc -= dt;
    if (acc > 0) return;
    // moins de bouffées en qualité basse (budget des effets) ; aucune trop près de la caméra (surcharge d'écran)
    acc = (o.rate ?? 0.12) / Math.max(0.3, g.fx.budget);
    const dc = g.camera.cam.position.distanceTo(pos);
    if (dc > (o.far ?? 70) || dc < 2.5) return;
    // rafales : la bouche souffle « burst » secondes par période
    const on = !period || (t % period) < burst;
    if (!on) return;
    // vapeur : bouffées claires et diaphanes qui s'élargissent en montant (plus vives en rafale)
    const k = (period ? 1.4 : 1) * (o.puff ?? 1.4) * s;
    p.set(pos.x + (Math.random() - 0.5) * 0.4 * s, pos.y + 0.25, pos.z + (Math.random() - 0.5) * 0.4 * s);
    v.set((Math.random() - 0.5) * 0.6, (o.rise ?? 2.4) * (0.8 + Math.random() * 0.5), (Math.random() - 0.5) * 0.6);
    g.fx.puff(p, v, { life: 1.8 + Math.random() * 0.8, size: 0.7 * k, size1: 3.4 * k, color, alpha: 0.15, drag: 0.9, gravity: -0.25, tile: 2, spin: (Math.random() - 0.5) * 0.8 });
  });
}

// Bac de liquide de refroidissement : fond praticable, rebords, liquide cyan lumineux qui bouillonne (fumerolles
// froides), lueur qui éclaire les environs. Peu profond : Kobi y patauge.
export function coolantPool(L, x0, z0, w, d, y, o = {}) {
  const m = mats();
  const depth = o.depth ?? 0.45, rim = o.rim ?? 0.4, t = 0.35;
  const cx = x0 + w / 2, cz = z0 + d / 2, fy = y - depth;
  // fond sombre (le liquide s'y voit cyan) et rebords cerclés de néon
  L.box(V(cx, fy - 0.18, cz), V(w, 0.4, d), m.dark, { surface: 'metal' });
  for (const [px, pz, sx, sz] of [[cx, z0 - t / 2, w + t * 2, t], [cx, z0 + d + t / 2, w + t * 2, t], [x0 - t / 2, cz, t, d], [x0 + w + t / 2, cz, t, d]]) {
    L.box(V(px, fy + (depth + rim) / 2, pz), V(sx, depth + rim, sz), m.wallMetal, { surface: 'metal', uvScale: 0.4 });
  }
  const top = fy + depth + rim + 0.03;
  for (const [a, b] of [[V(x0 - t, top, z0 - t), V(x0 + w + t, top, z0 - t)], [V(x0 - t, top, z0 + d + t), V(x0 + w + t, top, z0 + d + t)]]) neonStrip(L, a, b, 'cyan', { light: false });
  const body = createWater(L, {
    rect: [x0, z0, w, d], y, type: 'acide',
    shallow: '#36e2f6', deep: '#04384e', absorb: [1.9, 0.22, 0.1], turbidity: 1.2, glow: '#2ee6ff', glowIntensity: o.glow ?? 0.8,
    foamColor: '#e4fdff', foam: 0.15, splash: '#c8fbff', reflect: false, caustics: 0.8, waves: [[0.6, 0.012, 3.5], [2.2, 0.008, 2.2]],
    flow: o.flow || [0.05, 0.02], fumes: 1, roughness: 0.04,
  });
  lights.add({ pos: V(cx, y + 1.4, cz), area: [w, d], color: '#3ee8ff', intensity: o.light ?? 34, range: 11, decay: 1, flicker: 0.04, priority: 1.8 });
  return body;
}

// Tour de refroidissement : fût cerclé, bandes cyan, panache de vapeur au sommet
export function coolingTower(L, pos, h = 12, r = 2.6) {
  const m = mats();
  const g = L.game;
  const body = G.lathe('tour' + h + r, [[r, 0], [r * 0.82, h * 0.55], [r * 0.78, h * 0.7], [r * 0.9, h]], 28);
  L.add(body, m.wallMetal, mtx([pos.x, pos.y, pos.z]));
  // bandes lumineuses serrées sur le fût (elles suivaient un profil droit et flottaient jusqu'à 9 cm de la tôle)
  const rAt = (k) => r * (k < 0.55 ? 1 - (0.18 * k) / 0.55 : k < 0.7 ? 0.82 - (0.04 * (k - 0.55)) / 0.15 : 0.78 + (0.12 * (k - 0.7)) / 0.3);
  for (const k of [0.15, 0.45, 0.75]) L.add(G.torus(rAt(k) + 0.03, 0.09, 6, 28), m.neonCyan, mtx([pos.x, pos.y + h * k, pos.z], [Math.PI / 2, 0, 0]));
  L.add(G.torus(r * 0.9, 0.2, 8, 28), m.beam, mtx([pos.x, pos.y + h, pos.z], [Math.PI / 2, 0, 0]));
  lights.add({ line: [V(pos.x, pos.y + h * 0.15, pos.z), V(pos.x, pos.y + h * 0.75, pos.z)], offset: V(0, 0, 0), color: NEON.cyan, intensity: 24, range: 9, priority: 1.1 });
  g.world.add(new CylinderCollider(pos.x, pos.z, pos.y, pos.y + h, r, { surface: 'metal' }));
  const top = V(pos.x, pos.y + h + 0.3, pos.z);
  let t = 0;
  L.every((dt) => {
    t -= dt;
    if (t > 0) return;
    t = 0.14;
    if (g.camera.cam.position.distanceTo(top) > 150) return;
    g.fx.smoke(top, 1, '#d8e6f0', 3.4, 3);
  });
}

// Balise flottante (le long des rails dans le vide) : flotteur sombre, antenne, feu qui clignote
export function beacon(L, pos, color = '#ff4fa0', phase = 0) {
  const m = mats();
  const grp = joint(L.root, [pos.x, pos.y, pos.z]);
  part(grp, G.sphere(0.45, 12, 8), m.dark, { s: [1, 0.7, 1] });
  part(grp, G.torus(0.5, 0.06, 6, 20), m.gold, { r: [Math.PI / 2, 0, 0] });
  part(grp, G.cyl(0.03, 0.03, 1.2, 5), m.pipe, { p: [0, 0.8, 0] });
  const lamp = part(grp, G.sphere(0.16, 10, 8), glow(color, 4), { p: [0, 1.45, 0], shadow: false });
  // anneau lumineux serré contre la couronne dorée (il en restait séparé de 2,5 cm)
  const ring = part(grp, G.torus(0.58, 0.035, 4, 24), glow(color, 2.2), { r: [Math.PI / 2, 0, 0], shadow: false });
  L.every((dt, t) => {
    const on = ((t * 0.8 + phase) % 1) < 0.18;
    lamp.visible = on;
    ring.visible = !on;
    grp.position.y = pos.y + Math.sin(t * 0.9 + phase * 6) * 0.25;
    grp.rotation.y += dt * 0.3;
  });
}

// Conduite aérienne entre deux points (avec colliers dorés)
export function overheadPipe(L, a, b, r = 0.35) {
  const m = mats();
  const d = new THREE.Vector3().subVectors(b, a);
  const c = new THREE.Vector3().lerpVectors(a, b, 0.5);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.clone().normalize());
  L.add(G.cyl(r, r, d.length(), 12), m.pipe, new THREE.Matrix4().compose(c, q, V(1, 1, 1)));
  const n = Math.floor(d.length() / 3);
  for (let i = 1; i < n; i++) L.add(G.cyl(r * 1.3, r * 1.3, 0.2, 12), m.gold, new THREE.Matrix4().compose(new THREE.Vector3().lerpVectors(a, b, i / n), q, V(1, 1, 1)));
}

// ------------------------------------------------------------- entrepôt
// Rayonnage : montants orange, étagères, caisses et fûts rangés ; « len » le long de l'axe local x
export function rack(L, pos, yaw, len = 8, h = 6, o = {}) {
  const m = mats();
  const R = mkRng(o.seed ?? 7);
  const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), yaw);
  const P = (x, y, z) => V(x, y, z).applyQuaternion(q).add(pos);
  const depth = o.depth ?? 1.6;
  const n = Math.max(1, Math.round(len / 2.7));
  const ups = [];
  for (let i = 0; i <= n; i++) {
    const x = -len / 2 + (i / n) * len;
    ups.push(x);
    for (const z of [-depth / 2, depth / 2]) L.add(G.box(0.16, h, 0.16), m.rack, new THREE.Matrix4().compose(P(x, h / 2, z), q, V(1, 1, 1)));
    for (let y = 1.2; y < h; y += 1.5) L.add(G.box(0.06, 0.06, depth * 1.4), m.rack, new THREE.Matrix4().compose(P(x, y - 0.5, 0), new THREE.Quaternion().multiplyQuaternions(q, new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), 0.8)), V(1, 1, 1)));
  }
  // contenu : caisses en planches (bois nu, violettes, bleues) et paires de fûts cerclés (violet, or) ; un second
  // tirage (Rd) varie un peu l'orientation sans changer le tirage des objets
  const xm = xmats(), dr = drumParts(), Rd = mkRng((o.seed ?? 7) + 101);
  const drumM = [xm.drumVio, m.gold];
  const qq = new THREE.Quaternion(), qy = new THREE.Quaternion();
  const put = (px, py, pz, s, ry) => new THREE.Matrix4().compose(P(px, py, pz), qq.multiplyQuaternions(q, qy.setFromAxisAngle(V(0, 1, 0), ry)), V(s, s, s));
  for (let y = 0; y < h - 0.3; y += 1.5) {
    L.add(G.box(len + 0.2, 0.1, depth + 0.1), m.beam, new THREE.Matrix4().compose(P(0, y + 0.05, 0), q, V(1, 1, 1)));
    for (const z of [-depth / 2, depth / 2]) L.add(G.box(len + 0.2, 0.14, 0.12), m.rack, new THREE.Matrix4().compose(P(0, y + 0.08, z), q, V(1, 1, 1)));
    if (y + 1.5 > h) break;
    // contenu de l'étagère : le tirage suit le curseur d'origine (cx) ; les objets sont rangés par un second curseur (px)
    // qui saute chaque montant (dégagement de 5 cm), un objet qui ne tient plus avant le bout est omis
    let cx = -len / 2 + 0.3, px = cx;
    const place = (w, gap) => {
      let a = px;
      for (const u of ups) if (a < u + 0.13 && a + w > u - 0.13) a = u + 0.13;
      px = a + w + gap;
      return a + w > len / 2 - 0.13 ? null : a;
    };
    while (cx < len / 2 - 0.6) {
      const k = R();
      if (k < 0.45) {
        const s = 0.8 + R() * 0.45;
        const kind = Math.floor(R() * 3);
        const zz = THREE.MathUtils.clamp((R() - 0.5) * 0.2, -(0.7 - s * 0.53), 0.7 - s * 0.53);
        const ry = (Rd() - 0.5) * 0.06, a = place(s * 1.03, 0.09);
        if (a !== null) woodCrate(L, put(a + s * 0.515, y + 0.1 + s / 2, zz, s, ry), kind);
        cx += s + 0.12;
      } else if (k < 0.75) {
        const r0 = Rd(), r1 = Rd(), a = place(1.4, 0.1);
        if (a !== null) for (let b = 0; b < 2; b++) {
          const mm = put(a + 0.35 + b * 0.7, y + 0.1 + 0.44, 0, 0.8, (b ? r1 : r0) * 6.28);
          L.add(dr.body, drumM[b], mm);
          L.add(dr.caps, m.dark, mm);
        }
        cx += 1.5;
      } else { cx += 0.8; px += 0.8; }
    }
  }
  L.add(G.box(len + 0.2, 0.1, depth + 0.1), m.beam, new THREE.Matrix4().compose(P(0, h, 0), q, V(1, 1, 1)));
  if (o.collide !== false) L.game.world.add(new BoxCollider(P(0, h / 2, 0), V(len / 2 + 0.1, h / 2, depth / 2 + 0.05), q, { surface: 'metal' }));
}

// Roue de chariot (axe x, flanc extérieur vers +x) : bandage plein à crampons en chevrons (profil de révolution),
// jante peinte à voile embouti, moyeu et cinq écrous
function forkWheel(r, w) {
  const ri = r * 0.66;
  const prof = [[ri, -w / 2], [r * 0.9, -w / 2], [r * 0.97, -w * 0.44], [r, -w * 0.3], [r, -w * 0.1], [r, w * 0.1], [r, w * 0.3], [r * 0.97, w * 0.44], [r * 0.9, w / 2], [ri, w / 2]];
  const t = new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(a, b)), 56);
  const p = t.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    if (Math.hypot(v.x, v.z) < r * 0.985) continue;
    const a = Math.atan2(v.z, v.x) * 14 / (Math.PI * 2) + (v.y > 0 ? 0.25 : -0.25);
    if (a - Math.floor(a) < 0.4) p.setXYZ(i, v.x * 0.94, v.y, v.z * 0.94);
  }
  t.computeVertexNormals();
  const tire = t.rotateZ(Math.PI / 2).toNonIndexed();
  const fx = w * 0.43;
  const rim = [cylX(ri * 1.01, w * 0.86, 20, 0, 0, 0), cylX(ri * 0.8, 0.03, 18, fx + 0.012, 0, 0)];
  const hub = [cylX(r * 0.26, 0.08, 12, fx + 0.03, 0, 0)];
  for (let k = 0; k < 5; k++) hub.push(cylX(0.02, 0.03, 6, fx + 0.035, Math.cos(k * 1.2566) * r * 0.4, Math.sin(k * 1.2566) * r * 0.4));
  return { tire: [tire], rim, hub };
}

// Chaîne de levage verticale (maillons alternés) de y0 à y1
function liftChain(list, x, z, y0, y1) {
  const n = Math.floor((y1 - y0) / 0.05);
  for (let i = 0; i < n; i++) list.push(boxAt(i % 2 ? G.box(0.036, 0.058, 0.014) : G.box(0.014, 0.058, 0.036), x, y0 + (i + 0.5) * 0.05, z));
}

// Géométrie du chariot élévateur (repère local : fourches vers +z), fusionnée par matière et partagée
let forkGeo = null;
function forkliftGeo() {
  if (forkGeo) return forkGeo;
  const Yl = [], Dk = [], St = [], Rb = [], Wd = [], Hz = [], Gl = [], Rd = [], Lw = [];
  // châssis, carrosserie, capot, tableau de bord, ouïes du moteur
  Dk.push(boxAt(G.box(1.0, 0.32, 2.1), 0, 0.46, 0));
  Yl.push(rboxAt(1.46, 0.56, 1.56, 0.1, 0, 0.9, 0.02));
  Yl.push(rboxAt(1.2, 0.07, 0.95, 0.03, 0, 1.2, -0.22));
  Yl.push(rboxAt(1.3, 0.3, 0.34, 0.08, 0, 1.31, 0.62));
  for (const sx of [1, -1]) for (let i = 0; i < 5; i++) Dk.push(boxAt(G.box(0.02, 0.045, 0.42), sx * 0.73, 0.76 + i * 0.075, -0.3));
  // roues (motrices à l'avant, directrices à l'arrière) sous leurs garde-boue bordés
  for (const [wx, r, w, z] of [[0.68, 0.34, 0.3, 0.75], [0.66, 0.29, 0.24, -0.72]]) {
    const wg = forkWheel(r, w);
    for (const sx of [1, -1]) {
      for (const [list, geos] of [[Rb, wg.tire], [Yl, wg.rim], [St, wg.hub]]) for (const g of geos) {
        const c = g.clone();
        if (sx < 0) c.rotateY(Math.PI);
        list.push(c.translate(sx * wx, r, z));
      }
      Yl.push(new THREE.CylinderGeometry(r + 0.08, r + 0.08, w + 0.06, 16, 1, true, 0, Math.PI).toNonIndexed().rotateZ(Math.PI / 2).translate(sx * wx, r, z));
      Dk.push(new THREE.TorusGeometry(r + 0.08, 0.022, 5, 16, Math.PI).toNonIndexed().rotateY(Math.PI / 2).translate(sx * (wx + w / 2 + 0.03), r, z));
    }
  }
  // contrepoids moulé : bande de danger, feux arrière, attelage, anneau de levage
  Dk.push(rboxAt(1.5, 0.98, 0.7, 0.2, 0, 0.82, -1.1));
  Hz.push(boxAt(boxUV(1.1, 0.14, 0.02, 0.5), 0, 0.6, -1.452));
  for (const sx of [1, -1]) Rd.push(boxAt(G.box(0.16, 0.08, 0.02), sx * 0.5, 1.1, -1.452));
  St.push(boxAt(G.cyl(0.04, 0.04, 0.22, 8), 0, 0.46, -1.49), boxAt(G.box(0.24, 0.05, 0.12), 0, 0.4, -1.49));
  Dk.push(new THREE.TorusGeometry(0.07, 0.018, 6, 12, Math.PI).toNonIndexed().translate(0, 1.31, -1.15));
  // siège, colonne et volant, leviers de commande
  Dk.push(boxAt(G.box(0.42, 0.06, 0.42), 0, 1.265, -0.25));
  Rb.push(rboxAt(0.6, 0.12, 0.52, 0.05, 0, 1.35, -0.25));
  Rb.push(rboxAt(0.6, 0.46, 0.1, 0.05, 0, 0, 0).rotateX(-0.14).translate(0, 1.64, -0.52));
  const c0 = V(0, 1.42, 0.55), c1 = V(0, 1.78, 0.34);
  Dk.push(tube(c0, c1, 0.035, 0.035, 8));
  const qd = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), c1.clone().sub(c0).normalize());
  Rb.push(new THREE.TorusGeometry(0.17, 0.022, 6, 20).toNonIndexed().applyQuaternion(qd).translate(c1.x, c1.y, c1.z));
  Dk.push(new THREE.BoxGeometry(0.32, 0.025, 0.03).toNonIndexed().applyQuaternion(qd).translate(c1.x, c1.y, c1.z));
  for (let i = 0; i < 3; i++) {
    const x = 0.22 + i * 0.09;
    St.push(tube(V(x, 1.45, 0.7), V(x, 1.68, 0.62), 0.012, 0.012, 5));
    Rb.push(boxAt(G.sphere(0.03, 8, 6), x, 1.69, 0.615));
  }
  // toit de protection : quatre montants, cadre et lattes, gyrophare en cage, phares sur les montants avant
  const gy = 3.42, gx = 0.7, gz0 = -0.66, gz1 = 1.0;
  for (const sx of [1, -1]) {
    Dk.push(sbar(V(sx * 0.66, 1.28, -0.82), V(sx * gx, gy, gz0 + 0.04), 0.07));
    Dk.push(sbar(V(sx * 0.66, 1.15, 0.72), V(sx * gx, gy, gz1 - 0.04), 0.07));
    Dk.push(boxAt(G.box(0.08, 0.06, gz1 - gz0 + 0.08), sx * gx, gy, (gz0 + gz1) / 2));
    Dk.push(boxAt(G.box(0.12, 0.12, 0.1), sx * 0.76, 2.3, 0.85));
    Lw.push(cylX(0.045, 0.02, 12, 0, 0, 0).rotateY(Math.PI / 2).translate(sx * 0.76, 2.3, 0.905));
  }
  for (const z of [gz0, gz1]) Dk.push(boxAt(G.box(gx * 2 + 0.08, 0.06, 0.08), 0, gy, z));
  for (let i = -2; i <= 2; i++) Dk.push(boxAt(G.box(0.05, 0.035, gz1 - gz0), i * 0.26, gy + 0.01, (gz0 + gz1) / 2));
  Dk.push(boxAt(G.cyl(0.1, 0.11, 0.07, 12), 0, gy + 0.065, 0.2), boxAt(G.cyl(0.11, 0.1, 0.03, 12), 0, gy + 0.28, 0.2));
  Gl.push(boxAt(G.sphere(0.085, 10, 8), 0, gy + 0.17, 0.2));
  for (let k = 0; k < 4; k++) St.push(boxAt(G.box(0.012, 0.18, 0.012), Math.cos(k * 1.571 + 0.785) * 0.1, gy + 0.18, 0.2 + Math.sin(k * 1.571 + 0.785) * 0.1));
  // mât : montants extérieurs en U, montants intérieurs sortis, traverses, vérin de levée, poulies et chaînes,
  // vérins d'inclinaison
  const mz = 1.02;
  for (const sx of [1, -1]) {
    Dk.push(boxAt(G.box(0.04, 3.05, 0.16), sx * 0.54, 1.625, mz));
    for (const dz of [-0.065, 0.065]) Dk.push(boxAt(G.box(0.11, 3.05, 0.03), sx * 0.495, 1.625, mz + dz));
    Dk.push(boxAt(G.box(0.07, 3.0, 0.09), sx * 0.4, 1.8, mz + 0.03));
    const a = V(sx * 0.6, 0.78, 0.66), b = V(sx * 0.6, 1.12, 0.98), mid = a.clone().lerp(b, 0.55);
    Dk.push(tube(a, mid, 0.05, 0.05, 10));
    St.push(tube(mid, b, 0.025, 0.025, 8));
  }
  Dk.push(boxAt(G.box(1.16, 0.12, 0.05), 0, 3.09, mz + 0.09), boxAt(G.box(1.16, 0.14, 0.16), 0, 0.17, mz), boxAt(G.box(0.86, 0.1, 0.09), 0, 3.25, mz + 0.03));
  Hz.push(boxAt(boxUV(1.0, 0.08, 0.01, 0.5), 0, 3.09, mz + 0.12));
  Dk.push(boxAt(G.cyl(0.065, 0.065, 1.8, 12), 0, 1.1, mz - 0.11), boxAt(G.box(0.4, 0.06, 0.08), 0, 2.02, mz - 0.17));
  St.push(boxAt(G.cyl(0.035, 0.035, 0.95, 10), 0, 2.47, mz - 0.11), boxAt(G.box(0.42, 0.06, 0.1), 0, 2.98, mz - 0.11));
  for (const sx of [1, -1]) {
    St.push(cylX(0.075, 0.05, 14, sx * 0.14, 3.0, mz - 0.11));
    liftChain(St, sx * 0.14, mz - 0.035, 0.99, 3.0);
    liftChain(St, sx * 0.14, mz - 0.185, 2.05, 3.0);
  }
  // tablier, dosseret de charge en grille, attaches des chaînes, fourches (pointes amincies)
  const cz = 1.14;
  for (const y of [0.42, 0.88]) Dk.push(boxAt(G.box(1.04, 0.1, 0.06), 0, y, cz));
  for (const sx of [1, -1]) Dk.push(boxAt(G.box(0.06, 0.56, 0.06), sx * 0.49, 0.65, cz), boxAt(G.box(0.06, 0.08, 0.2), sx * 0.14, 0.95, mz + 0.03));
  for (let i = -2; i <= 2; i++) Dk.push(boxAt(G.box(0.035, 0.74, 0.035), i * 0.235, 1.29, cz));
  Dk.push(boxAt(G.box(1.0, 0.05, 0.05), 0, 1.66, cz), boxAt(G.box(1.0, 0.04, 0.04), 0, 1.3, cz));
  for (const sx of [1, -1]) {
    const fx = sx * 0.27;
    Dk.push(boxAt(G.box(0.1, 0.62, 0.05), fx, 0.66, cz + 0.055), boxAt(G.box(0.12, 0.08, 0.05), fx, 0.9, cz + 0.02));
    const bl = boxAt(G.box(0.1, 0.045, 1.26), fx, 0.3575, cz + 0.08 + 0.63);
    const bp = bl.attributes.position;
    for (let i = 0; i < bp.count; i++) if (bp.getZ(i) > cz + 1.3 && bp.getY(i) > 0.36) bp.setY(i, 0.345);
    bl.computeVertexNormals();
    Dk.push(bl);
  }
  // palette : trois chevrons, cinq planches dessus, trois dessous
  const pz = 1.86;
  for (const x of [-0.58, 0, 0.58]) Wd.push(plankBox(0.1, 0.135, 1.3, 1, x).translate(x, 0.3925, pz));
  for (let i = 0; i < 5; i++) Wd.push(plankBox(1.3, 0.025, 0.2, 1, i * 0.41).translate(0, 0.4725, pz - 0.55 + i * 0.275));
  for (const dz of [-0.55, 0, 0.55]) Wd.push(plankBox(1.3, 0.025, 0.18, 1, dz + 0.2).translate(0, 0.3125, pz + dz));
  const mg = (l) => mergeParts(l);
  forkGeo = { yellow: mg(Yl), dark: mg(Dk), steel: mg(St), rubber: mg(Rb), wood: mg(Wd), hazard: mg(Hz), gyro: mg(Gl), tail: mg(Rd), head: mg(Lw) };
  return forkGeo;
}

// Chariot élévateur (décor solide) : carrosserie jaune écaillée, contrepoids moulé, roues à jantes, toit de protection,
// mât à chaînes ; une palette de planches sur les fourches, chargée d'une caisse violette
export function forklift(L, pos, yaw = 0) {
  const m = mats(), x = xmats(), g = forkliftGeo();
  const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), yaw);
  const P = (px, py, pz) => V(px, py, pz).applyQuaternion(q).add(pos);
  const M0 = new THREE.Matrix4().compose(pos, q, V(1, 1, 1));
  L.add(g.yellow, x.yellow, M0);
  L.add(g.dark, x.darkPaint, M0);
  L.add(g.steel, m.pipe, M0);
  L.add(g.rubber, m.rubber, M0);
  L.add(g.wood, x.pallet, M0);
  L.add(g.hazard, m.hazard, M0);
  L.add(g.gyro, glow('#ff9a3a', 3), M0);
  L.add(g.tail, glow('#ff3a3a', 2.2), M0);
  L.add(g.head, glow('#fff0c8', 2.5), M0);
  woodCrate(L, M0.clone().multiply(new THREE.Matrix4().compose(V(0, 1.035, 1.86), new THREE.Quaternion(), V(1.1, 1.1, 1.1))), 1);
  L.game.world.add(new BoxCollider(P(0, 1.2, 0.3), V(0.95, 1.2, 1.9), q, { surface: 'metal' }));
}

// Charpente métallique au-dessus d'une zone (fermes en treillis) et suspensions lumineuses
// Avec o.floor (hauteur du plancher), chaque ferme repose sur deux poteaux posés sur platines, 40 cm au-delà de ses
// extrémités (la charpente flottait au-dessus de l'entrepôt) ; les membrures sont prolongées jusqu'aux poteaux.
export function trussRoof(L, x0, x1, z0, z1, y, o = {}) {
  const m = mats();
  const step = o.step ?? 6;
  const cols = o.floor !== undefined ? [x0 - 0.4, x1 + 0.4] : null;
  const xa = cols ? cols[0] : x0, xb = cols ? cols[1] : x1;
  // repère pour le pont roulant posé sous cette charpente (consoles sur les poteaux, garde au plafond)
  (L._roofs || (L._roofs = [])).push({ x0, x1, z0, z1, y, step, cols });
  for (let z = z0; z <= z1 + 0.01; z += step) {
    beam(L, V(xa, y, z), V(xb, y, z), 0.35, m.beam);
    beam(L, V(xa, y + 1.6, z), V(xb, y + 1.6, z), 0.25, m.beam);
    if (cols) for (const x of cols) {
      const top = y + 1.725, f = o.floor;
      L.add(G.box(0.3, top - f, 0.3), m.beam, mtx([x, (top + f) / 2, z]));
      L.add(G.box(0.6, 0.06, 0.6), m.dark, mtx([x, f + 0.03, z]));
    }
    const n = Math.round((x1 - x0) / 2);
    for (let i = 0; i < n; i++) {
      const xa = x0 + (i / n) * (x1 - x0), xb = x0 + ((i + 1) / n) * (x1 - x0);
      beam(L, V(xa, i % 2 ? y : y + 1.6, z), V(xb, i % 2 ? y + 1.6 : y, z), 0.12, m.beam);
    }
  }
  for (const x of [x0, (x0 + x1) / 2, x1]) beam(L, V(x, y + 1.6, z0), V(x, y + 1.6, z1), 0.25, m.beam);
  // suspensions
  for (let z = z0 + step / 2; z < z1; z += step) {
    for (const x of o.lamps || [(x0 * 2 + x1) / 3, (x0 + x1 * 2) / 3]) {
      // lierne entre les deux fermes voisines : la suspente y est accrochée (elle montait dans le vide)
      beam(L, V(x, y, z - step / 2), V(x, y, z + step / 2), 0.12, m.beam);
      L.add(G.cyl(0.02, 0.02, 2.4, 4), m.dark, mtx([x, y - 1.2, z]));
      L.add(G.cone(0.6, 0.45, 14), m.dark, mtx([x, y - 2.5, z]));
      L.add(G.cyl(0.42, 0.42, 0.05, 14), glow('#fff0c8', 3), mtx([x, y - 2.73, z]));
      lights.add({ pos: V(x, y - 3.1, z), color: '#ffe6b8', intensity: 50, range: 12, priority: 1.3 });
      if (o.floor !== undefined) lightBeam(L, V(x, y - 2.76, z), V(x, o.floor, z), { r0: 0.4, r1: 3.2, color: '#ffe6b8', intensity: 0.42 });
    }
  }
}

// Tôle bleu vif de la charge du pont roulant : la texture de conteneur (256 px) voilée d'un bleu franc aux deux tiers,
// qui garde les marbrures de peinture et noie la rouille et la crasse ; relief ondulé et normales d'origine
let craneBlueM = null;
function craneBlue() {
  if (craneBlueM) return craneBlueM;
  const t = containerTexture('#2f7ac8');
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.drawImage(t.canvas, 0, 0, 256, 256);
  ctx.globalAlpha = 0.65;
  ctx.fillStyle = '#3a8cf0';
  ctx.fillRect(0, 0, 256, 256);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  map.userData.shared = true;
  craneBlueM = mat('#ffffff', { map, normalMap: t.normalMap, rough: 0.5, metal: 0.35 });
  return craneBlueM;
}

// Pont roulant : poutre qui va et vient le long de z, avec un conteneur suspendu
// Sous une charpente posée sur poteaux (trussRoof avec floor), les rails reposent sur des consoles des poteaux
// (ils flottaient) ; la poutre roulante est posée sur les rails et passe sous les fermes (elle les traversait),
// le treuil est suspendu sous la poutre.
export function travellingCrane(L, x0, x1, z0, z1, y, o = {}) {
  const m = mats();
  for (const x of [x0, x1]) beam(L, V(x, y, z0), V(x, y, z1), 0.45, m.rack);
  const roof = (L._roofs || []).find((r) => r.y > y && x0 >= r.x0 - 1 && x1 <= r.x1 + 1 && z0 >= r.z0 - 1 && z1 <= r.z1 + 1);
  if (roof && roof.cols) {
    for (const x of [x0, x1]) {
      const cx = roof.cols.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a)), sg = Math.sign(x - cx);
      for (let z = roof.z0; z <= roof.z1 + 0.01; z += roof.step) {
        if (z < z0 - 0.01 || z > z1 + 0.01) continue;
        const yc = y - 0.225 - 0.15, xe = x + sg * 0.25;
        L.add(G.box(Math.abs(xe - cx), 0.3, 0.3), m.rack, mtx([(xe + cx) / 2, yc, z]));
        L.add(sbar(V(cx, yc - 0.85, z), V(x, yc - 0.1, z), 0.12), m.rack);
      }
    }
  }
  // garde sous les fermes : la poutre roulante s'amincit au besoin pour passer dessous
  const clear = roof ? roof.y - 0.175 - (y + 0.225) : Infinity;
  const bh = Math.min(0.6, clear - 0.02), gy = 0.225 + bh / 2 - 0.5;
  const bridge = joint(L.root, [(x0 + x1) / 2, y + 0.5, z0]);
  part(bridge, G.box(x1 - x0 + 0.6, bh, 0.9), m.rack, { p: [0, gy, 0] });
  part(bridge, G.box(x1 - x0 + 0.6, 0.1, 0.95), m.hazard, { p: [0, gy - bh / 2 + 0.05, 0] });
  const hook = joint(bridge, [o.dx ?? 0, 0, 0]);
  part(hook, G.rbox(1.2, 0.7, 1.4, 0.1), m.dark, { p: [0, clear < 1.4 ? gy - bh / 2 - 0.35 : 0.5, 0] });
  const drop = o.drop ?? 4;
  // câble, moufle à crochet, puis élingues jusqu'au palonnier et chaînes aux pièces de coin d'un conteneur maritime
  const xm = xmats();
  // treuil sous la poutre : câble rallongé d'autant pour que la moufle sorte du treuil (la charge descend avec)
  const hb = clear < 1.4 ? 0.75 : 0;
  const cab = Math.max(0.3, drop - 1.3) + hb;
  part(hook, G.cyl(0.04, 0.04, cab, 5), m.pipe, { p: [0, -cab / 2, 0] });
  const blk = [rboxAt(0.34, 0.4, 0.22, 0.05, 0, -cab - 0.15, 0), cylX(0.12, 0.26, 14, 0, -cab - 0.08, 0)];
  const hk = new THREE.TorusGeometry(0.09, 0.03, 6, 14, Math.PI * 1.4).toNonIndexed().rotateZ(Math.PI * 0.8).translate(0, -cab - 0.45, 0);
  part(hook, mergeParts([...blk, hk]), xm.yellow, {});
  const load = joint(hook, [0, -drop - 1.3 - hb, 0]);
  const rig = [], rigD = [];
  const top = 1.2, sp = top + 0.3;
  rigD.push(boxAt(G.box(4.6, 0.16, 0.2), 0, sp, 0));
  for (const sx of [1, -1]) {
    // élingues accrochées au fond du crochet (elles partaient du vide de son œil, la charge ne tenait à rien)
    rig.push(tube(V(0, -cab - 0.55 + drop + 1.3 + hb, 0), V(sx * 0.9, sp + 0.08, 0), 0.025, 0.025, 5));
    rigD.push(boxAt(G.box(0.04, 0.12, 0.1), sx * 0.9, sp + 0.12, 0));
    rigD.push(boxAt(G.box(0.16, 0.12, 2.3), sx * 2.2, sp - 0.04, 0));
    for (const sz of [1, -1]) rig.push(tube(V(sx * 2.2, sp - 0.1, sz * 1.05), V(sx * 2.38, top + 0.02, sz * 1.08), 0.02, 0.02, 4));
  }
  part(load, mergeParts(rig), m.pipe, {});
  part(load, mergeParts(rigD), xm.darkPaint, {});
  // la tôle du conteneur prend un bleu vif propre au lieu de la tôle rouillée
  // partagée avec les conteneurs posés au sol
  const proxy = { game: L.game, add: (geo, material, mm) => {
    const me = part(load, geo, material === contMats['#2f7ac8'] ? craneBlue() : material, {});
    mm.decompose(me.position, me.quaternion, me.scale);
  } };
  container(proxy, V(0, -top, 0), 0, '#2f7ac8', { w: 5, h: 2.4, d: 2.4, collide: false });
  // gyrophare posé sur le bout de la poutre (au-dessus quand la garde le permet, sinon contre la face d'about)
  part(bridge, G.sphere(0.16, 8, 6), glow('#ff9a3a', 3), { p: clear < 1.4 ? [(x1 - x0) / 2 + 0.34, gy, 0.3] : [x1 - (x0 + x1) / 2, gy + bh / 2 + 0.1, 0.3] });
  let t = o.phase ?? 0;
  L.every((dt) => {
    t += dt * (o.speed ?? 0.12);
    const k = 0.5 - 0.5 * Math.cos(t);
    bridge.position.z = z0 + (z1 - z0) * k;
    load.rotation.z = Math.sin(t * 7) * 0.02;
  });
}

// Marquage au sol (bande peinte)
export function floorLine(L, a, b, w = 0.22, color = '#ffcc33') {
  const d = new THREE.Vector3().subVectors(b, a);
  const c = new THREE.Vector3().lerpVectors(a, b, 0.5);
  L.add(G.box(w, 0.02, d.length()), mat(color, { rough: 0.7 }), new THREE.Matrix4().compose(c, new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), d.normalize()), V(1, 1, 1)));
}

// ------------------------------------------------------------- pont de commande
// Écran animé partagé par les consoles d'un niveau : courbes et barres qui défilent
function screenTexture(L) {
  if (L._screenTex) return L._screenTex;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  let t = 0, acc = 0;
  const draw = () => {
    ctx.fillStyle = '#06142a'; ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = 'rgba(62,242,255,0.25)';
    ctx.lineWidth = 1;
    for (let x = 0; x < 256; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 128); ctx.stroke(); }
    ctx.strokeStyle = '#3ef2ff'; ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 0; x <= 128; x += 4) { const y = 40 + Math.sin(x * 0.08 + t * 3) * 18 + Math.sin(x * 0.21 - t * 5) * 6; x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const h = 20 + (Math.sin(t * 2 + i * 1.7) * 0.5 + 0.5) * 70;
      ctx.fillStyle = i % 3 ? '#ff4fa0' : '#ffcc33';
      ctx.fillRect(140 + i * 14, 120 - h, 10, h);
    }
    ctx.fillStyle = '#ffcc33';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('VORAX ' + String(Math.floor(9000 + t * 37) % 10000).padStart(4, '0'), 8, 112);
    tex.needsUpdate = true;
  };
  draw();
  L.every((dt) => { t += dt; acc += dt; if (acc > 0.2) { acc = 0; draw(); } });
  L._screenTex = tex;
  return tex;
}

// Console de commande : pupitre incliné, écran animé, boutons
export function console3(L, pos, yaw = 0) {
  const m = mats();
  const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), yaw);
  const P = (x, y, z) => V(x, y, z).applyQuaternion(q).add(pos);
  const Q = (rx) => new THREE.Quaternion().multiplyQuaternions(q, new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), rx));
  L.add(G.rbox(1.8, 1.0, 1.0, 0.08), m.voraxPanel, new THREE.Matrix4().compose(P(0, 0.5, 0), q, V(1, 1, 1)));
  L.add(G.rbox(1.8, 0.12, 0.9, 0.04), m.dark, new THREE.Matrix4().compose(P(0, 1.05, 0.1), Q(-0.35), V(1, 1, 1)));
  for (let k = 0; k < 6; k++) L.add(G.cyl(0.05, 0.05, 0.05, 8), k % 3 === 0 ? m.neonPink : k % 3 === 1 ? m.neonGold : m.neonCyan, new THREE.Matrix4().compose(P(-0.65 + k * 0.26, 1.13, 0.25), Q(-0.35), V(1, 1, 1)));
  const scr = new THREE.MeshBasicMaterial({ map: screenTexture(L), toneMapped: false });
  scr.color.setScalar(1.6);
  L.add(G.box(1.6, 0.85, 0.05), m.dark, new THREE.Matrix4().compose(P(0, 1.75, -0.32), Q(-0.12), V(1, 1, 1)));
  // deux montants derrière l'écran, du dessus du pupitre au cadre (l'écran flottait 33 cm au-dessus du caisson)
  for (const x of [-0.5, 0.5]) L.add(G.box(0.1, 0.5, 0.08), m.dark, new THREE.Matrix4().compose(P(x, 1.2, -0.33), q, V(1, 1, 1)));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.75), scr);
  screen.position.copy(P(0, 1.75, -0.29));
  screen.quaternion.copy(Q(-0.12));
  L.root.add(screen);
  lights.add({ pos: P(0, 1.7, 0.35), color: '#5ae8ff', intensity: 8, range: 4.5, priority: 0.8 });
  L.game.world.add(new BoxCollider(P(0, 0.6, 0), V(0.9, 0.6, 0.5), q, { surface: 'metal' }));
}

// Hologramme rotatif de la Méga-Benne sur un projecteur
export function holoBenne(L, pos, s = 1) {
  const m = mats();
  L.add(G.cyl(1.1 * s, 1.3 * s, 0.6, 20), m.dark, mtx([pos.x, pos.y + 0.3, pos.z]));
  L.add(G.torus(1.0 * s, 0.06, 6, 28), m.neonCyan, mtx([pos.x, pos.y + 0.62, pos.z], [Math.PI / 2, 0, 0]));
  lights.add({ pos: V(pos.x, pos.y + 1.6 * s, pos.z), color: '#3ef2ff', intensity: 22 * s, range: 9 * s, priority: 1.2 });
  const grp = joint(L.root, [pos.x, pos.y + 0.7, pos.z]);
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(1.6 * s, 0.45 * s, 2.2 * s, 16, 4, true), M.holo);
  funnel.position.y = 1.6 * s;
  grp.add(funnel);
  const fill = new THREE.Mesh(new THREE.CylinderGeometry(1.6 * s, 0.45 * s, 2.2 * s, 16, 1, true), M.holoFill);
  fill.position.y = 1.6 * s;
  grp.add(fill);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.65 * s, 0.05 * s, 6, 32), M.holo);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 2.7 * s;
  grp.add(ring);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(1.1 * s, 0.01, 24, 1, true), M.holoFill);
  cone.position.y = 0.3;
  grp.add(cone);
  L.every((dt, t) => { grp.rotation.y += dt * 0.6; funnel.material.opacity = 0.26 + Math.sin(t * 9) * 0.06; grp.position.y = pos.y + 0.7 + Math.sin(t * 1.5) * 0.06; });
}

// Bannière Vorax suspendue (tissu violet, emblème « V » doré)
let bannerMat = null;
function bannerMaterial() {
  if (bannerMat) return bannerMat;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const ctx = c.getContext('2d');
  const grd = ctx.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#5a1fa8'); grd.addColorStop(1, '#2a0a5a');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, 128, 256);
  ctx.fillStyle = '#ffcc33';
  ctx.fillRect(8, 8, 112, 6); ctx.fillRect(8, 216, 112, 6);
  ctx.beginPath(); ctx.arc(64, 100, 40, 0, Math.PI * 2); ctx.lineWidth = 7; ctx.strokeStyle = '#ffcc33'; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(40, 76); ctx.lineTo(64, 128); ctx.lineTo(88, 76); ctx.lineWidth = 12; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.fillStyle = '#ff4fa0';
  for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(8 + i * 30, 222); ctx.lineTo(23 + i * 30, 250); ctx.lineTo(38 + i * 30, 222); ctx.fill(); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  bannerMat = mat('#ffffff', { map: tex, rough: 0.85, side: THREE.DoubleSide });
  return bannerMat;
}
export function banner(L, pos, yaw = 0, w = 2, h = 4) {
  const m = mats();
  const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), yaw);
  L.add(G.cyl(0.06, 0.06, w + 0.4, 8), m.gold, new THREE.Matrix4().compose(V(pos.x, pos.y + 0.05, pos.z), new THREE.Quaternion().multiplyQuaternions(q, new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), Math.PI / 2)), V(1, 1, 1)));
  // deux pattes dorées portent la tringle jusqu'au support situé derrière la bannière (arceau de la verrière, fût
  // des piliers de l'arène) : la tringle flottait devant
  for (const sx of [-1, 1]) {
    const pp = V(sx * Math.min(0.5, w * 0.3), 0.05, -0.26).applyQuaternion(q).add(pos);
    L.add(G.box(0.06, 0.25, 0.52), m.gold, new THREE.Matrix4().compose(pp, q, V(1, 1, 1)));
  }
  const geo = new THREE.PlaneGeometry(w, h, 1, 6);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getY(i) / h) * 5) * 0.06);
  geo.computeVertexNormals();
  L.add(geo.translate(0, -h / 2, 0), bannerMaterial(), new THREE.Matrix4().compose(pos, q, V(1, 1, 1)));
}

// Grande porte blindée (cadre seul, les battants sont rentrés) avec l'emblème du Baron
export function voraxGate(L, pos, yaw = 0, w = 8, h = 7) {
  const m = mats();
  const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), yaw);
  const P = (x, y, z) => V(x, y, z).applyQuaternion(q).add(pos);
  for (const sx of [-1, 1]) {
    L.box(P(sx * (w / 2 + 0.7), h / 2, 0), V(1.4, h, 1.6), m.voraxPanel, { ry: yaw, surface: 'metal', uvScale: 0.3 });
    L.add(G.box(0.12, h - 0.8, 0.12), m.neonPink, new THREE.Matrix4().compose(P(sx * (w / 2 + 0.05), h / 2, 0.82), q, V(1, 1, 1)));
    lights.add({ line: [P(sx * (w / 2 - 0.3), 0.8, 1.3), P(sx * (w / 2 - 0.3), h - 0.6, 1.3)], color: NEON.pink, intensity: 20, range: 8, priority: 1.2 });
    // battant rentré dans le chambranle (rainures)
    for (let y = 1; y < h; y += 1.2) L.add(G.box(0.3, 0.16, 1.7), m.hazard, new THREE.Matrix4().compose(P(sx * (w / 2 + 0.2), y, 0), q, V(1, 1, 1)));
  }
  L.box(P(0, h + 0.8, 0), V(w + 2.8, 1.6, 1.6), m.voraxPanel, { ry: yaw, surface: 'metal', uvScale: 0.3 });
  L.add(G.box(w + 2.6, 0.14, 0.14), m.neonGold, new THREE.Matrix4().compose(P(0, h + 0.05, 0.82), q, V(1, 1, 1)));
  // emblème : anneau doré et « V »
  const em = P(0, h + 2.4, 0.2);
  L.add(G.torus(1.3, 0.2, 8, 32), m.gold, new THREE.Matrix4().compose(em, q, V(1, 1, 1)));
  for (const s of [-1, 1]) L.add(G.box(0.34, 1.9, 0.3), m.gold, new THREE.Matrix4().compose(em.clone().add(V(s * 0.42, 0.15, 0).applyQuaternion(q)), new THREE.Quaternion().multiplyQuaternions(q, new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), s * 0.42)), V(1, 1, 1)));
  L.add(G.cyl(1.15, 1.15, 0.1, 28), m.voraxPanel, new THREE.Matrix4().compose(em.clone().add(V(0, 0, -0.12).applyQuaternion(q)), new THREE.Quaternion().multiplyQuaternions(q, new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), Math.PI / 2)), V(1, 1, 1)));
}

// Arceaux de verrière au-dessus d'un pont (nervures + vitrage)
export function canopy(L, pos, w, len, h, o = {}) {
  const m = mats();
  const n = o.ribs ?? 4;
  for (let i = 0; i <= n; i++) {
    const z = pos.z - len / 2 + (i / n) * len;
    const pts = [];
    for (let k = 0; k <= 10; k++) { const a = Math.PI * (k / 10); pts.push(V(pos.x + Math.cos(a) * w / 2, pos.y + Math.sin(a) * h, z)); }
    for (let k = 0; k < 10; k++) beam(L, pts[k], pts[k + 1], 0.22, m.voraxPanel);
    L.add(G.sphere(0.12, 8, 6), m.neonCyan, mtx([pos.x, pos.y + h + 0.05, z]));
  }
  lights.add({ line: [V(pos.x, pos.y + h - 0.6, pos.z - len / 2), V(pos.x, pos.y + h - 0.6, pos.z + len / 2)], color: NEON.cyan, intensity: 16, range: 9, priority: 1 });
  for (const k of [2, 5, 8]) {
    const a = Math.PI * (k / 10);
    beam(L, V(pos.x + Math.cos(a) * w / 2, pos.y + Math.sin(a) * h, pos.z - len / 2), V(pos.x + Math.cos(a) * w / 2, pos.y + Math.sin(a) * h, pos.z + len / 2), 0.12, m.gold);
  }
}
