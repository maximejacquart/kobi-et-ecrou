// Bombe-Ressort : modèle tenu en main (canon vers +Z, origine dans la main droite, poignée vers −Y).
// Lance-bombe de jouet à remonter : boîtier laqué avec clé de remontage au dos et manomètre « TENSION », cage à
// barreaux où se tasse un gros ressort chromé (l'élément qu'on reconnaît de loin), coupelle de tir garnie d'une bombe
// à mèche allumée, poignée-pistolet et prise avant en caoutchouc pour la main gauche.
// v2 « Méga-Ressort » : ressort à double spire, pince à trois griffes chargée de trois bombinettes, clé à trois
// lobes, cartouchière de bombinettes de rechange, cornes sur le boîtier.
import * as THREE from 'three';
import { G, part, mtx, mergeGeometries } from '../geo.js';
import { mat, glow } from '../../engine/materials.js';
import { build, hex, mix3, sstep, scratch } from '../../engine/textures.js';
import { fbm2, noise2 } from '../../engine/util.js';

const HP = Math.PI / 2, TAU = Math.PI * 2;
const AY = 0.08; // hauteur de l'axe du canon

// ------------------------------------------------------------------ aides : pièces rigides fusionnées par matériau
const CACHE = new Map();
function merged(key, make) {
  let g = CACHE.get(key);
  if (!g) {
    const list = [];
    make(list);
    g = mergeGeometries(list.map((x) => {
      const y = x.index ? x.toNonIndexed() : x;
      for (const k of Object.keys(y.attributes)) if (!['position', 'normal', 'uv'].includes(k)) y.deleteAttribute(k);
      return y;
    }));
    g.userData.shared = true;
    for (const x of list) x.dispose();
    CACHE.set(key, g);
  }
  return g;
}
// copie non indexée placée (position, rotation d'Euler ou quaternion, échelle)
const at = (geo, p, r = [0, 0, 0], s = 1) => (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(mtx(p, r, s));
const _m = new THREE.Matrix4(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const atQ = (geo, p, q, s = [1, 1, 1]) => (geo.index ? geo.toNonIndexed() : geo.clone())
  .applyMatrix4(_m.compose(new THREE.Vector3(...p), q, new THREE.Vector3(...s)));
// quaternion qui envoie l'axe `from` sur la direction d
const toward = (d, from = [0, 1, 0]) => new THREE.Quaternion().setFromUnitVectors(_a.set(...from), _b.set(...d).normalize());
// barre (cylindre) d'un point à un autre
function bar(L, p0, p1, r0, r1 = r0, seg = 8) {
  const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const len = Math.hypot(...d);
  L.push(atQ(G.cyl(r1, r0, len, seg), [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2], toward(d)));
}
// rivet bombé tourné vers +Y
const RIVET = () => G.lathe('bmbRivet', [[0.001, 1], [0.75, 0.7], [1, 0]], 5);
const rivet = (L, p, n, r = 0.006) => L.push(atQ(RIVET(), p, toward(n), [r, r * 0.6, r]));

// ressort : spire hélicoïdale d'axe Z, de z0 à z1
class Helix extends THREE.Curve {
  constructor(R, z0, z1, turns, phase) { super(); Object.assign(this, { R, z0, z1, turns, phase }); }
  getPoint(t, out = new THREE.Vector3()) {
    const a = this.phase + t * this.turns * TAU;
    // spires serrées aux deux bouts (ressort meulé), plus lâches au milieu
    const e = t - 0.03 * Math.sin(t * TAU);
    return out.set(Math.cos(a) * this.R, Math.sin(a) * this.R, this.z0 + (this.z1 - this.z0) * e);
  }
}
const spring = (R, r, z0, z1, turns, phase = 0, segTurn = 13, rad = 6) =>
  new THREE.TubeGeometry(new Helix(R, z0, z1, turns, phase), Math.round(turns * segTurn), r, rad, false).translate(0, AY, 0);
// coupelle de tir (révolution autour de Y, ouverte vers +Y)
// clé de remontage plate : n lobes percés autour d'un moyeu (plan XY, épaisseur selon Z)
function windKey(n) {
  const s = new THREE.Shape(), N = 40;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * TAU, r = 0.024 + 0.05 * Math.pow(Math.abs(Math.cos((t * n) / 2)), 1.6);
    i ? s.lineTo(Math.cos(t) * r, Math.sin(t) * r) : s.moveTo(Math.cos(t) * r, Math.sin(t) * r);
  }
  for (let k = 0; k < n; k++) {
    const h = new THREE.Path(), a = (k / n) * TAU;
    h.absarc(Math.cos(a) * 0.046, Math.sin(a) * 0.046, 0.0145, 0, TAU, true);
    s.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 8 });
  g.translate(0, 0, -0.004);
  return g;
}
const CUP = () => G.lathe('bmbCup', [[0.001, 0], [0.08, 0], [0.102, 0.022], [0.112, 0.07], [0.104, 0.075], [0.094, 0.032], [0.06, 0.014], [0.001, 0.014]], 18);
// découpe d'une zone [x, y, l, h] (pixels) de la planche d'autocollants dans les UV d'une géométrie (UV 0..1)
function decal(geo, [x, y, w, h]) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (x + uv.getX(i) * w) / 256, 1 - (y + h - uv.getY(i) * h) / 256);
  return g;
}

// ------------------------------------------------------------------ textures (construites au premier appel)
// Laque de jouet neutre (teintée par la couleur du matériau, donc suivie par la Méga) : peau d'orange, arêtes usées
// qui montrent l'apprêt clair, liseré sombre autour des éclats, fines rayures
function laque() {
  const base = hex('#f2efea'), deep = hex('#d9d4cc'), primer = hex('#ffffff'), rim = hex('#8f877c');
  return build('arme-bombe-laque', 256, (u, v, out) => {
    const n = fbm2(u * 6, v * 6, 2, 811, 6);
    mix3(out, deep, base, sstep(0.25, 0.75, n));
    const e = Math.min(u, 1 - u, v, 1 - v);
    const cn = fbm2(u * 9, v * 9, 3, 817, 9);
    const s = cn + (e < 0.08 ? sstep(0.08, 0.0, e) * (0.16 + noise2(u * 24, v * 24, 821, 24) * 0.4) : 0);
    let h = 0.6 + (noise2(u * 48, v * 48, 823, 48) - 0.5) * 0.06; // peau d'orange
    if (s > 0.9) { mix3(out, out, primer, 0.8); h = 0.45; } else if (s > 0.875) { mix3(out, out, rim, 0.55); h = 0.66; }
    else if (n > 0.38 && n < 0.62 && scratch(u, v, 7, 829) < 0.003) { mix3(out, out, primer, 0.5); h -= 0.06; }
    return h;
  }, 1.6);
}
// Planche d'autocollants : « BOING ! », « BOING ×3 », cadran du manomètre, bandes de danger, « NE PAS SECOUER »
const Z = { boing: [0, 0, 256, 64], boing3: [0, 64, 256, 64], dial: [0, 128, 128, 128], hazard: [128, 128, 128, 64], shake: [128, 192, 128, 64] };
let decalTex = null;
function decals() {
  if (decalTex) return decalTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  const font = (px) => `bold ${px}px Impact, "Arial Black", sans-serif`;
  const rr = (px, py, w, h, r) => { x.beginPath(); x.roundRect(px, py, w, h, r); };
  const sticker = (py, bg, ink, txt, sz) => {
    x.fillStyle = '#1d1a26'; x.fillRect(0, py, 256, 64);
    rr(3, py + 3, 250, 58, 12); x.fillStyle = bg; x.fill();
    x.lineWidth = 4; x.strokeStyle = '#1d1a26'; rr(9, py + 9, 238, 46, 8); x.stroke();
    // petit ressort dessiné à gauche
    x.strokeStyle = '#1d1a26'; x.lineWidth = 3; x.beginPath();
    for (let i = 0; i <= 40; i++) { const t = i / 40, px = 30 + Math.sin(t * TAU * 4) * 9, pyy = py + 50 - t * 36; i ? x.lineTo(px, pyy) : x.moveTo(px, pyy); }
    x.stroke();
    x.font = font(sz); x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = '#1d1a26'; x.fillText(txt, 143, py + 35);
    x.fillStyle = ink; x.fillText(txt, 141, py + 32);
  };
  sticker(0, '#ffd23a', '#e8352c', 'BOING !', 40);
  sticker(64, '#ffe1e6', '#d0164a', 'BOING ×3', 40);
  // cadran : fond crème, zones vert / jaune / rouge, graduations, aiguille dans le rouge
  const cx = 64, cy = 192;
  x.fillStyle = '#1d1a26'; x.fillRect(0, 128, 128, 128);
  x.fillStyle = '#f6efdc'; x.beginPath(); x.arc(cx, cy, 62, 0, TAU); x.fill();
  const a0 = 0.75 * Math.PI, span = 1.5 * Math.PI;
  for (const [f0, f1, col] of [[0, 0.5, '#3fb950'], [0.5, 0.75, '#ffc21a'], [0.75, 1, '#e8352c']]) {
    x.strokeStyle = col; x.lineWidth = 10; x.beginPath(); x.arc(cx, cy, 46, a0 + span * f0, a0 + span * f1); x.stroke();
  }
  x.strokeStyle = '#1d1a26';
  for (let i = 0; i <= 12; i++) {
    const a = a0 + (i / 12) * span, big = i % 3 === 0;
    x.lineWidth = big ? 3 : 1.5;
    x.beginPath(); x.moveTo(cx + Math.cos(a) * (big ? 30 : 35), cy + Math.sin(a) * (big ? 30 : 35)); x.lineTo(cx + Math.cos(a) * 40, cy + Math.sin(a) * 40); x.stroke();
  }
  x.font = font(13); x.textAlign = 'center'; x.fillStyle = '#1d1a26'; x.fillText('TENSION', cx, cy + 26);
  const an = a0 + span * 0.93;
  x.strokeStyle = '#d01818'; x.lineWidth = 4; x.lineCap = 'round';
  x.beginPath(); x.moveTo(cx - Math.cos(an) * 8, cy - Math.sin(an) * 8); x.lineTo(cx + Math.cos(an) * 42, cy + Math.sin(an) * 42); x.stroke();
  x.fillStyle = '#1d1a26'; x.beginPath(); x.arc(cx, cy, 7, 0, TAU); x.fill();
  // bandes de danger
  x.save(); x.beginPath(); x.rect(128, 128, 128, 64); x.clip();
  x.fillStyle = '#ffc21a'; x.fillRect(128, 128, 128, 64);
  x.fillStyle = '#1d1a26';
  for (let i = -2; i < 8; i++) { x.beginPath(); x.moveTo(128 + i * 24, 192); x.lineTo(140 + i * 24, 192); x.lineTo(204 + i * 24, 128); x.lineTo(192 + i * 24, 128); x.fill(); }
  x.restore();
  // « NE PAS SECOUER » : étiquette blanche liserée de rouge
  x.fillStyle = '#f4f1ea'; x.fillRect(128, 192, 128, 64);
  x.strokeStyle = '#e8352c'; x.lineWidth = 5; x.strokeRect(133, 197, 118, 54);
  x.font = font(22); x.fillStyle = '#1d1a26'; x.textAlign = 'center';
  x.fillText('NE PAS', 192, 215); x.fillText('SECOUER', 192, 240);
  // usure : éclats et rayures
  let sd = 11;
  const R = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 160; i++) {
    x.fillStyle = R() < 0.55 ? 'rgba(40,30,30,0.3)' : 'rgba(255,255,255,0.4)';
    x.beginPath(); x.arc(R() * 256, R() * 256, 0.8 + R() * 2.2, 0, TAU); x.fill();
  }
  x.strokeStyle = 'rgba(255,255,255,0.3)'; x.lineWidth = 1;
  for (let i = 0; i < 24; i++) { const a = R() * 256, b = R() * 256, t = R() * 6; x.beginPath(); x.moveTo(a, b); x.lineTo(a + Math.cos(t) * 22, b + Math.sin(t) * 22); x.stroke(); }
  decalTex = new THREE.CanvasTexture(c);
  decalTex.colorSpace = THREE.SRGBColorSpace;
  decalTex.anisotropy = 8;
  decalTex.userData.shared = true;
  return decalTex;
}

// ------------------------------------------------------------------ matériaux (8 au plus)
function mats(v2) {
  const L = laque();
  return {
    paint: mat(v2 ? '#ff4f6d' : '#ff7b2a', { map: L.map, normalMap: L.normalMap, normalScale: 0.5, rough: 0.32, metal: 0.25, coat: 0.9, coatRough: 0.08 }),
    cream: mat('#f3ead8', { map: L.map, normalMap: L.normalMap, normalScale: 0.5, rough: 0.36, metal: 0.1, coat: 0.7 }),
    dark: mat('#2c2a3a', { rough: 0.34, metal: 0.7 }),
    rubber: mat('#1d1924', { rough: 0.88 }),
    steel: mat('#d4dae6', { rough: 0.18, metal: 1 }),
    shell: mat('#24212e', { rough: 0.22, metal: 0.45, coat: 1, coatRough: 0.05 }),
    spark: glow('#ffb347', 3),
    decal: mat('#ffffff', { map: decals(), rough: 0.45, coat: 0.5 }),
  };
}

// bombe (ou bombinette) de rayon r au centre c, mèche selon la direction d
function bomb(L, c, r, d, k) {
  const dn = new THREE.Vector3(...d).normalize(), D = dn.toArray();
  const q = toward(D);
  L.shell.push(at(G.sphere(r, r > 0.06 ? 18 : 11, r > 0.06 ? 12 : 7), c));
  // bague de culot de mèche, bande laquée perpendiculaire à la mèche
  L.dark.push(atQ(G.cyl(r * 0.28, r * 0.34, r * 0.32, 12), c.map((x, i) => x + D[i] * r * 0.95), q));
  L.paint.push(atQ(G.cyl(r * 1.025, r * 1.025, r * 0.32, r > 0.06 ? 22 : 14, true), c, q));
  if (r > 0.06) L.steel.push(atQ(G.cyl(r * 1.035, r * 1.035, r * 0.06, 22, true), c, q));
  // mèche tortillée, étincelle au bout
  const p0 = new THREE.Vector3(...c).addScaledVector(dn, r * 1.08);
  const side = new THREE.Vector3(1, 0, 0).cross(dn).normalize();
  const pts = [p0, p0.clone().addScaledVector(dn, r * 0.28).addScaledVector(side, r * 0.1),
    p0.clone().addScaledVector(dn, r * 0.48).addScaledVector(side, -r * 0.1).add(new THREE.Vector3(r * 0.12 * k, 0, 0)),
    p0.clone().addScaledVector(dn, r * 0.66).addScaledVector(side, r * 0.04)];
  L.cream.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 7, r * 0.07, 4, false));
  const tip = pts[3].toArray();
  L.spark.push(at(G.ico(r * 0.13, 0), tip));
  for (let i = 0; i < 2; i++) L.spark.push(atQ(G.box(r * 0.035, r * 0.34, r * 0.035), tip, new THREE.Quaternion().setFromEuler(new THREE.Euler(i * 1.05, i * 0.7, i * 0.6))));
}

export function bombe(v2) {
  const g = new THREE.Group();
  const M = mats(v2);
  const V = v2 ? 'v2' : 'v1';
  const L = { paint: [], cream: [], dark: [], rubber: [], steel: [], shell: [], spark: [], decal: [] };
  const make = () => {
    // ---------------- boîtier : bloc laqué, flasques sombres rivetées, dos fermé
    L.paint.push(at(G.rbox(0.15, 0.15, 0.2, 0.045, 2), [0, AY, -0.03]));
    L.dark.push(at(G.rbox(0.124, 0.124, 0.026, 0.012, 1), [0, AY, -0.133]));
    for (const s of [-1, 1]) {
      L.dark.push(at(G.rbox(0.012, 0.086, 0.13, 0.005, 1), [s * 0.077, AY, -0.03]));
      for (const y of [-0.033, 0.033]) for (const z of [-0.087, 0.027]) rivet(L.steel, [s * 0.083, AY + y, z], [s, 0, 0], 0.0055);
    }
    // dessus : plaque d'évents crème, trois fentes sombres
    L.cream.push(at(G.rbox(0.084, 0.02, 0.07, 0.008, 1), [0, 0.158, 0.02]));
    for (const z of [-0.002, 0.02, 0.042]) L.dark.push(at(G.box(0.062, 0.008, 0.009), [0, 0.167, z]));
    // manomètre « TENSION » tourné vers le tireur
    const tilt = -0.6, gc = [0, 0.165, -0.085], gn = [0, Math.cos(0.6), -Math.sin(0.6)];
    L.dark.push(at(G.cyl(0.038, 0.044, 0.03, 20), gc, [tilt, 0, 0]));
    L.steel.push(at(G.torus(0.035, 0.0055, 4, 20), gc.map((x, i) => x + gn[i] * 0.016), [-HP + tilt, 0, 0]));
    L.decal.push(at(decal(new THREE.CircleGeometry(0.032, 24), Z.dial), gc.map((x, i) => x + gn[i] * 0.0158), [-HP + tilt, 0, 0]));
    // voyant de charge (crème autour, ampoule allumée)
    L.dark.push(at(G.cyl(0.013, 0.015, 0.018, 10), [-0.045, 0.16, -0.1]));
    L.spark.push(at(G.sphere(0.0105, 10, 6), [-0.045, 0.172, -0.1]));
    // autocollants des flancs : « BOING » côté extérieur, « NE PAS SECOUER » côté Kobi
    L.decal.push(at(decal(new THREE.PlaneGeometry(0.12, 0.03), v2 ? Z.boing3 : Z.boing), [0.0835, AY + (v2 ? 0.012 : 0), -0.03], [0, HP, 0]));
    L.decal.push(at(decal(new THREE.PlaneGeometry(0.062, 0.031), Z.shake), [-0.0835, AY, -0.03], [0, -HP, 0]));
    // câble gainé du boîtier à la cage
    const cable = [[0.064, 0.14, -0.118], [0.082, 0.163, -0.04], [0.09, 0.168, 0.07], [0.086, 0.158, 0.19], [0.074, 0.15, 0.288]].map((p) => new THREE.Vector3(...p));
    L.rubber.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cable), 18, 0.0065, 4, false));
    bar(L.dark, [0.058, 0.135, -0.13], [0.066, 0.142, -0.11], 0.011);
    bar(L.dark, [0.075, 0.15, 0.275], [0.074, 0.15, 0.3], 0.011);

    // ---------------- clé de remontage au dos : tige d'acier, lobes crème (2, ou 3 en v2)
    L.steel.push(at(G.cyl(0.011, 0.011, 0.05, 10), [0, AY, -0.165], [HP, 0, 0]));
    L.dark.push(at(G.cyl(0.024, 0.024, 0.012, 16), [0, AY, -0.15], [HP, 0, 0]));
    const kz = -0.195, nL = v2 ? 3 : 2, k0 = 0.35;
    L.dark.push(at(G.cyl(0.02, 0.022, 0.03, 14), [0, AY, kz], [HP, 0, 0]));
    L.steel.push(at(windKey(nL), [0, AY, kz], [0, 0, k0]));

    // ---------------- poignée-pistolet, pontet, détente
    L.rubber.push(at(G.rbox(0.054, 0.14, 0.066, 0.022, 1), [0, -0.05, -0.006], [-0.3, 0, 0]));
    L.dark.push(at(G.rbox(0.062, 0.02, 0.076, 0.008, 1), [0, -0.118, 0.013], [-0.3, 0, 0]));
    L.dark.push(at(G.torus(0.034, 0.0055, 4, 12, Math.PI), [0, 0.01, 0.07], [0, HP, Math.PI]));
    L.steel.push(at(G.box(0.01, 0.036, 0.012), [0, -0.002, 0.06], [0.35, 0, 0]));

    // ---------------- cage du ressort : bagues, barreaux d'acier, rivets
    L.dark.push(at(G.cyl(0.1, 0.1, 0.03, 24), [0, AY, 0.08], [HP, 0, 0]));
    L.paint.push(at(G.cyl(0.103, 0.103, 0.036, 24), [0, AY, 0.3], [HP, 0, 0]));
    for (const z of [0.281, 0.319]) L.steel.push(at(G.torus(0.1, 0.0045, 3, 22), [0, AY, z]));
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * HP;
      bar(L.steel, [Math.cos(a) * 0.09, AY + Math.sin(a) * 0.09, 0.09], [Math.cos(a) * 0.09, AY + Math.sin(a) * 0.09, 0.29], 0.0085);
    }
    for (let i = 0; i < 5; i++) {
      const a = HP + i * (TAU / 5);
      rivet(L.steel, [Math.cos(a) * 0.103, AY + Math.sin(a) * 0.103, 0.3], [Math.cos(a), Math.sin(a), 0], 0.006);
    }
    // le ressort : gros, chromé, spires serrées aux bouts (double spire en v2)
    if (v2) for (const ph of [0, Math.PI]) L.steel.push(spring(0.066, 0.0098, 0.095, 0.283, 3.5, ph, 12, 5));
    else L.steel.push(spring(0.066, 0.0125, 0.095, 0.283, 4.5, 0, 16, 6));
    // plateau poussoir au bout du ressort
    L.cream.push(at(G.cyl(0.074, 0.074, 0.012, 24), [0, AY, 0.09], [HP, 0, 0]));

    // ---------------- prise avant (main gauche) sous la cage
    L.dark.push(at(G.rbox(0.05, 0.05, 0.075, 0.012, 1), [0, -0.02, 0.24]));
    L.rubber.push(at(G.cyl(0.024, 0.027, 0.12, 12), [0, -0.1, 0.25], [-0.18, 0, 0]));
    for (const t of [-0.03, 0, 0.03]) L.rubber.push(at(G.torus(0.026, 0.0055, 4, 10), [0, -0.1 + t * Math.cos(0.18), 0.25 - t * Math.sin(0.18)], [HP - 0.18, 0, 0]));
    L.dark.push(at(G.cyl(0.031, 0.029, 0.016, 14), [0, -0.161, 0.261], [-0.18, 0, 0]));
    for (const s of [-1, 1]) L.decal.push(at(decal(new THREE.PlaneGeometry(0.06, 0.03), Z.hazard), [s * 0.0255, -0.025, 0.24], [0, s * HP, 0]));

    // ---------------- bouche
    if (!v2) {
      // coupelle sombre lèvre chromée, bombe à mèche allumée
      L.dark.push(at(CUP(), [0, AY, 0.318], [HP, 0, 0]));
      L.steel.push(at(G.torus(0.108, 0.0065, 4, 22), [0, AY, 0.391]));
      bomb(L, [0, AY, 0.405], 0.08, [0, 0.75, 0.66], 1);
    } else {
      // pince à trois griffes (pointes d'acier), trois bombinettes en trèfle
      L.dark.push(at(G.cyl(0.097, 0.09, 0.03, 24), [0, AY, 0.33], [HP, 0, 0]));
      L.dark.push(at(G.cyl(0.03, 0.035, 0.03, 12), [0, AY, 0.35], [HP, 0, 0]));
      for (let i = 0; i < 3; i++) {
        const a = -HP + i * (TAU / 3), ca = Math.cos(a), sa = Math.sin(a);
        const P = (r, z) => [ca * r, AY + sa * r, z];
        bar(L.dark, P(0.088, 0.33), P(0.112, 0.4), 0.017, 0.014, 6);
        L.dark.push(at(G.ico(0.0155, 0), P(0.112, 0.4)));
        bar(L.dark, P(0.112, 0.4), P(0.09, 0.465), 0.014, 0.009, 6);
        L.steel.push(atQ(G.cone(0.011, 0.04, 8), P(0.084, 0.48), toward([-ca * 0.35, -sa * 0.35, 1])));
        const b = a + Math.PI / 3, cb = Math.cos(b), sb = Math.sin(b);
        bomb(L, [cb * 0.056, AY + sb * 0.056, 0.405], 0.052, [cb, sb, 0.9], i % 2 ? 1 : -1);
      }
      // cartouchière de bombinettes de rechange sur le flanc extérieur
      L.dark.push(at(G.rbox(0.02, 0.026, 0.15, 0.006, 1), [0.084, 0.032, -0.03]));
      for (const z of [-0.08, -0.03, 0.02]) {
        L.shell.push(at(G.sphere(0.022, 9, 6), [0.1, 0.038, z]));
        L.paint.push(at(G.cyl(0.0232, 0.0232, 0.008, 10, true), [0.1, 0.038, z]));
      }
      // cornes sur les épaules du boîtier
      for (const s of [-1, 1]) {
        L.dark.push(atQ(G.cone(0.02, 0.07, 6), [s * 0.06, 0.16, -0.11], toward([s * 0.45, 0.75, -0.55])));
      }
    }
  };
  if (!CACHE.has('bmb-' + V + '-paint')) make();
  for (const k of Object.keys(L)) {
    const gk = 'bmb-' + V + '-' + k;
    const geo = merged(gk, (list) => list.push(...L[k]));
    part(g, geo, M[k], { shadow: k !== 'spark' && k !== 'decal' });
  }
  g.userData.muzzles = [new THREE.Vector3(0, AY, v2 ? 0.47 : 0.49)];
  g.userData.grip = new THREE.Vector3(-0.015, -0.1, 0.25); // main gauche (prise avant), voir leftGrip dans hero.js
  return g;
}
