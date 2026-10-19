import * as THREE from 'three';
import { G, part, joint, mtx, bake } from '../geo.js';
import { mat, glow, patchRim } from '../../engine/materials.js';
import { slotsTier } from '../../engine/shaderSlots.js';
import { paintedMetalTexture } from '../../engine/textures.js';
import { fbm2, rng } from '../../engine/util.js';
import { rig } from './common.js';
import { Sculpt } from '../sculpt.js';
import { primDist } from '../sculptCore.js';

// ===================================================================== Grignoteur
// Petit rongeur de ferraille : grosse mâchoire à dents de scie, œil unique, plaques dorsales boulonnées.
// Corps sculpté (silhouette, peinture écaillée, crasse) habillé de tôles peintes texturées (flancs, dos, menton,
// paupière), dents en lames vissées, charnière de mâchoire à vérins, pattes à rotules et griffes, queue en gaine.
// Les pièces rigides sont fusionnées une fois pour toutes (une géométrie par matière et par os, partagée).

const MAIN = ['#d0703a', '#b85a8a', '#5a9a6a'];
const NUM = ['07', '13', '42'];
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);

// Matrice : pose une pièce (axe Y local) en p, axe tourné vers n, puis rotation propre autour de cet axe
function along(p, n, spin = 0, s = 1) {
  _q.setFromUnitVectors(_y, _n.set(n[0], n[1], n[2]).normalize());
  if (spin) _q.multiply(new THREE.Quaternion().setFromAxisAngle(_y, spin));
  return new THREE.Matrix4().compose(_v.set(p[0], p[1], p[2]), _q, typeof s === 'number' ? _s.setScalar(s) : _s.set(...s));
}
// Géométrie teintée (couleurs de sommet) : la matière « métal » est partagée, la teinte vient du sommet
function tint(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
// Crasse au bas des pièces (en repère de l'os) : multiplie les couleurs de sommet
function grimeY(geo, y0, y1, k = 0.4) {
  const p = geo.attributes.position;
  let c = geo.attributes.color;
  if (!c) { c = new THREE.BufferAttribute(new Float32Array(p.count * 3).fill(1), 3); geo.setAttribute('color', c); }
  for (let i = 0; i < p.count; i++) {
    const t = THREE.MathUtils.smoothstep(p.getY(i), y0, y1), a = (1 - t) * k;
    c.setXYZ(i, c.getX(i) * (1 - a * 0.6), c.getY(i) * (1 - a * 0.62), c.getZ(i) * (1 - a * 0.66));
  }
  return geo;
}

// Champ de distance de la sculpture d'un seul os (repère de l'os, origin = sa position dans le modèle au repos) :
// sert à plaquer les tôles sur la vraie surface du corps
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
function boneField(S, root, bone, origin) {
  const prims = Sculpt.prototype.prepare.call({ ops: S.ops.filter((o) => o.bone === bone && o.op !== 'paint'), palIndex: S.palIndex }, root, [bone]);
  return (x, y, z) => {
    x += origin[0]; y += origin[1]; z += origin[2];
    let f = 1;
    for (const P of prims) {
      const b = P.box;
      if (x < b[0] || y < b[1] || z < b[2] || x > b[3] || y > b[4] || z > b[5]) continue;
      const d = primDist(P, x, y, z);
      f = P.op === 'add' ? smin(f, d, P.k) : -smin(-f, d, P.k);
    }
    return f;
  };
}

// Tôle bombée épaisse posée sur un ellipsoïde (centre c, rayons r) : carreau centré sur la direction dir, demi-angles
// au (le long de t1) et av (le long de dir × t1). UV de 0 à 1 sur la face (écaillage aux arêtes de paintedMetalTexture),
// chants et dessous inclus ; dents : bosses [u, v, profondeur, rayon] ; f : champ de la sculpture sur lequel le carreau
// est plaqué (dessous à off de la vraie surface). Renvoie { geo, at(u, v, lift) → [p, n] }.
function shell(o) {
  const C = new THREE.Vector3(...o.dir).normalize();
  const T1 = new THREE.Vector3(...o.t1);
  T1.addScaledVector(C, -T1.dot(C)).normalize();
  const T2 = new THREE.Vector3().crossVectors(C, T1);
  if (o.twist) { T1.applyAxisAngle(C, o.twist); T2.applyAxisAngle(C, o.twist); }
  const [rx, ry, rz] = o.r, [cx, cy, cz] = o.c, off = o.off ?? 0.012, th = o.th ?? 0.02;
  const nu = o.nu || 10, nv = o.nv || 8;
  const d = new THREE.Vector3();
  const surf = (u, v, lift, P, N) => {
    d.copy(C).addScaledVector(T1, Math.tan(o.au * (2 * u - 1))).addScaledVector(T2, Math.tan(o.av * (2 * v - 1))).normalize();
    const t = 1 / Math.hypot(d.x / rx, d.y / ry, d.z / rz);
    P.set(cx + d.x * t, cy + d.y * t, cz + d.z * t);
    N.set((P.x - cx) / (rx * rx), (P.y - cy) / (ry * ry), (P.z - cz) / (rz * rz)).normalize();
    if (o.f) for (let k = 0; k < 4; k++) P.addScaledVector(N, -Math.max(-0.08, Math.min(0.08, o.f(P.x, P.y, P.z))));
    let dent = 0;
    for (const [du, dv, dd, dr] of o.dents || []) dent += dd * Math.exp(-((u - du) ** 2 + (v - dv) ** 2) / (dr * dr));
    // lift de -th (dessous, à off de la surface) à 0 (dessus) ; les bosses ne creusent que le dessus
    P.addScaledVector(N, off + th + lift - dent * (1 + lift / th));
  };
  const P = new THREE.Vector3(), N = new THREE.Vector3();
  const grid = (lift, flip) => {
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      surf(i / nu, j / nv, lift, P, N);
      pos.push(P.x, P.y, P.z); uv.push(i / nu, j / nv);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 2, e = a + nu + 1;
      if (flip) idx.push(a, c, b, a, e, c); else idx.push(a, b, c, a, c, e);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g.toNonIndexed();
  };
  // chants : tour du carreau (sens direct vu de dehors), quads entre dessus et dessous
  const loop = [];
  for (let i = 0; i < nu; i++) loop.push([i / nu, 0]);
  for (let j = 0; j < nv; j++) loop.push([1, j / nv]);
  for (let i = nu; i > 0; i--) loop.push([i / nu, 1]);
  for (let j = nv; j > 0; j--) loop.push([0, j / nv]);
  const sp = [], suv = [];
  const Q = new THREE.Vector3(), P1 = new THREE.Vector3(), Q1 = new THREE.Vector3();
  for (let k = 0; k < loop.length; k++) {
    const [u0, v0] = loop[k], [u1, v1] = loop[(k + 1) % loop.length];
    surf(u0, v0, 0, P, N); surf(u0, v0, -th, Q, N); surf(u1, v1, 0, P1, N); surf(u1, v1, -th, Q1, N);
    for (const [V, uu, vv] of [[P, u0, v0], [Q, u0, v0], [P1, u1, v1], [P1, u1, v1], [Q, u0, v0], [Q1, u1, v1]]) { sp.push(V.x, V.y, V.z); suv.push(uu, vv); }
  }
  const side = new THREE.BufferGeometry();
  side.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  side.setAttribute('uv', new THREE.Float32BufferAttribute(suv, 2));
  side.computeVertexNormals();
  const geo = th ? bake([[grid(0, false)], [grid(-th, true)], [side]]) : grid(0, false);
  const at = (u, v, lift = 0) => { const p = new THREE.Vector3(), n = new THREE.Vector3(); surf(u, v, lift, p, n); return [p.toArray(), n.toArray()]; };
  return { geo, at };
}

// Lame de dent : profil de scie (base vissée + pointe couchée vers l'arrière) extrudé, dans le plan XY, pointe vers +Y
function toothGeo(w, hb, ht, t, broken) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, hb);
  if (broken) { s.lineTo(w * 0.18, hb + ht * 0.42); s.lineTo(-w * 0.05, hb + ht * 0.22); s.lineTo(-w * 0.3, hb + ht * 0.5); }
  else s.lineTo(-w * 0.22, hb + ht);
  s.lineTo(-w / 2, hb + ht * 0.08);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false }).translate(0, 0, -t / 2);
}

// Éclairage d'appoint des personnages (comme le corps sculpté) sur les pièces rigides : sinon elles paraissent
// plus sombres que la peau à contre-jour. Passe par patchRim pour survivre aux copies de cloneMat.
function charLit(m) {
  patchRim(m, 1, (sh) => { sh.fragmentShader = '#define CHAR_LIGHT\n' + sh.fragmentShader; });
  m.customProgramCacheKey = () => 'rimChar' + slotsTier();
  return m;
}
const OPT = { chip: 0.4, edge: 0.9, rust: 0.3 };
// teinte des tôles : un peu plus claire que la peau sculptée (que l'éclairage d'appoint éclaircit davantage)
const PANEL_HSL = [[0.02, 0.06], [-0.01, 0.08], [0, 0.05]];
const PANEL = (v) => '#' + new THREE.Color(MAIN[v]).offsetHSL(PANEL_HSL[v][0], 0, PANEL_HSL[v][1]).getHexString();
const paintMat = (map, normalMap) => charLit(mat('#ffffff', { map, normalMap, vertexColors: true, rough: 0.5, metal: 0.35, coat: 0.35 }));

// Tôle du flanc droit : la peinture du corps, plus un numéro peint au pochoir, écaillé
function numberedPaint(v) {
  const t = paintedMetalTexture(PANEL(v), null, OPT), S = t.canvas.width;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  const tc = document.createElement('canvas');
  tc.width = tc.height = S;
  const y = tc.getContext('2d');
  y.fillStyle = '#f1e7cf';
  y.font = `bold ${Math.round(S * 0.3)}px "Arial Black", Impact, sans-serif`;
  y.textAlign = 'center'; y.textBaseline = 'middle';
  y.fillText(NUM[v], S * 0.42, S * 0.5);
  y.clearRect(0, S * 0.49, S, S * 0.018); // ponts du pochoir
  const img = y.getImageData(0, 0, S, S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const k = (j * S + i) * 4;
    if (fbm2(i / 22, j / 22, 3, 91) > 0.66 || fbm2(i / 5, j / 5, 2, 93) > 0.76) img.data[k + 3] = 0;
    else img.data[k + 3] *= 0.92;
  }
  y.putImageData(img, 0, 0);
  x.drawImage(t.canvas, 0, 0);
  x.drawImage(tc, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return paintMat(map, t.normalMap);
}

// Matières (partagées entre toutes les instances)
let MM = null;
function mats() {
  if (MM) return MM;
  const paint = (col, o) => { const t = paintedMetalTexture(col, null, o); return paintMat(t.map, t.normalMap); };
  MM = {
    main: [0, 1, 2].map((v) => paint(PANEL(v), OPT)),
    num: [0, 1, 2].map(numberedPaint),
    slate: paint('#646b85', { chip: 0.45, edge: 0.8, rust: 0.4 }),
    patch: paint('#6f8faa', { chip: 0.6, edge: 1, rust: 0.7 }),
    metal: charLit(mat('#ffffff', { vertexColors: true, rough: 0.36, metal: 0.85 })),
    iris: glow('#ff5a2a', 2.6),
    glint: glow('#ffffff', 1.6),
    led: glow('#ff3a2a', 3),
    tip: glow('#7ff3ff', 3),
  };
  return MM;
}

// Teintes des pièces métalliques
const K = { wire: '#8d95a6', rivet: '#9da5b4', steel: '#4a5062', dark: '#25232c', chrome: '#d4d9e3', blade: '#ece6d6', weld: '#6e5f50', brass: '#c9a24a', black: '#120c10', cable: '#2f2c36' };

// Pièces rigides fusionnées (géométries partagées, calculées une fois)
const JAW_H = [0, -0.08, 0.22]; // charnière (position de l'os jaw dans le corps)
const PIST_A = [0.1, 0.1]; // (y, z) de l'œil du vérin sur le corps
const PIST_B = [-0.04, 0.2]; // (y, z) de l'œil de la tige dans la mâchoire
const PIST_X = 0.42;
let GEO = null;
function geos(FB, FJ) {
  if (GEO) return GEO;
  const R = rng(2207);
  const L = { body: { metal: [], main: [], num: [], slate: [], patch: [], led: [] }, plates: { slate: [], metal: [] }, jaw: { metal: [], main: [], patch: [] } };
  const bolt = (list, p, n, r = 0.02, col = K.chrome) => {
    list.push([tint(G.cyl(r, r, r * 0.7, 6), col), along(p, n, R() * 1)]);
    list.push([tint(G.cyl(r * 1.35, r * 1.35, r * 0.25, 10), K.steel), along(p, n)]);
  };
  const rivet = (list, p, n, r = 0.012, col = K.rivet) => list.push([tint(G.sphere(r, 7, 3).clone().scale(1, 0.5, 1), col), along(p, n)]);
  // cordon de soudure autour d'un carreau
  const weld = (list, sh, step = 14) => {
    for (let k = 0; k < step * 4; k++) {
      const s = (k % step) / step, side = Math.floor(k / step);
      const [u, v] = [[s, 0], [1, s], [1 - s, 1], [0, 1 - s]][side];
      const [p, n] = sh.at(u, v, -0.004);
      list.push([tint(G.ico(0.013, 0), K.weld), along(p, n, R() * 3, [1, 0.6, 1])]);
    }
  };
  const B = L.body;
  // --- flancs en tôle peinte (cabossés), numéro peint à droite
  const HULL = { c: [0, 0.02, -0.06], r: [0.4, 0.32, 0.46] };
  for (const s of [-1, 1]) {
    const fl = shell({ ...HULL, f: FB, dir: [s, 0.1, -0.15], t1: [0, 0, -s], au: 0.62, av: 0.48, off: 0.004, th: 0.02, nu: 12, nv: 8,
      dents: s > 0 ? [[0.75, 0.35, 0.018, 0.12], [0.2, 0.7, 0.01, 0.08]] : [[0.3, 0.4, 0.02, 0.13], [0.8, 0.75, 0.012, 0.09]] });
    (s > 0 ? B.num : B.main).push([fl.geo]);
    // rivets le long des arêtes haute et basse
    for (let i = 0; i < 6; i++) for (const v of [0.08, 0.92]) { const [p, n] = fl.at(0.08 + i * 0.168, v); rivet(B.metal, p, n); }
  }
  // rustine soudée sur le flanc gauche, à cheval sur la tôle
  const rus = shell({ ...HULL, f: FB, dir: [-0.9, 0.42, -0.5], t1: [0, 0, 1], au: 0.16, av: 0.13, off: 0.026, th: 0.012, nu: 4, nv: 4, twist: 0.3 });
  B.patch.push([rus.geo]);
  weld(B.metal, rus, 7);
  // --- plaques dorsales boulonnées (en tuiles, l'avant recouvre l'arrière) : pièce détachable
  const HUMP = { c: [0, 0.16, -0.2], r: [0.34, 0.26, 0.34] };
  [[0, 1, 0.5, 0.03], [0, 1, -0.15, 0.018], [0, 0.75, -0.8, 0.006]].forEach(([x, y, z, off], i) => {
    const pl = shell({ ...HUMP, f: FB, dir: [x, y, z], t1: [1, 0, 0], au: 1.05 - i * 0.08, av: 0.3, off, th: 0.024, nu: 10, nv: 4, dents: i === 1 ? [[0.3, 0.5, 0.012, 0.15]] : [] });
    L.plates.slate.push([pl.geo]);
    for (const [u, v] of [[0.1, 0.25], [0.9, 0.25], [0.1, 0.75], [0.9, 0.75]]) { const [p, n] = pl.at(u, v); bolt(L.plates.metal, p, n, 0.016, K.rivet); }
  });
  // --- dents du haut : barre d'appui et lames vissées (pointes vers le bas)
  const arc = (ax, az, cz, y, s) => [Math.sin(s) * ax, y, cz + Math.cos(s) * az];
  const teeth = (list, n, s0, s1, ax, az, cz, y, dir, sizes, broken = -1) => {
    for (let i = 0; i < n; i++) {
      const s = s0 + ((i + 0.5) / n) * (s1 - s0);
      const p = arc(ax, az, cz, y, s);
      const sz = sizes[i % sizes.length];
      const g = tint(toothGeo(0.075, 0.03, 0.075 * sz, 0.014, i === broken), K.blade);
      // repère : x le long de l'arc, y vers la pointe, z vers l'extérieur
      const tx = new THREE.Vector3(Math.cos(s) * ax, 0, -Math.sin(s) * az).normalize();
      const tz = new THREE.Vector3(Math.sin(s) * az, 0, Math.cos(s) * ax).normalize();
      const ty = new THREE.Vector3(0, dir, 0);
      const m = new THREE.Matrix4().makeBasis(tx.clone().multiplyScalar(dir), ty, tz).setPosition(p[0], p[1], p[2]);
      m.multiply(new THREE.Matrix4().makeRotationZ((R() - 0.5) * 0.18));
      list.push([g, m]);
      bolt(list, [p[0] + tz.x * 0.009, p[1] + dir * 0.015, p[2] + tz.z * 0.009], tz.toArray(), 0.011);
    }
  };
  // barre d'appui : tube aplati en arc
  const bar = (list, R0, ax, az, cz, y, a0, a1) => {
    const g = new THREE.TorusGeometry(R0, 0.022, 6, 18, a1 - a0).rotateZ(a0).rotateX(Math.PI / 2);
    g.scale(ax / R0, 1.5, az / R0).rotateY(-Math.PI / 2);
    list.push([tint(g, K.steel), mtx([0, y, cz])]);
  };
  bar(B.metal, 0.25, 0.25, 0.25, 0.24, -0.075, -1.2, 1.2);
  teeth(B.metal, 6, -1.0, 1.0, 0.255, 0.255, 0.24, -0.065, -1, [0.8, 1, 0.9, 1.05, 0.85, 0.95]);
  // --- charnières de la mâchoire (sur le corps, coaxiales à l'os) et chape des vérins
  for (const s of [-1, 1]) {
    B.metal.push([tint(G.cyl(0.065, 0.065, 0.04, 16), K.steel), mtx([s * 0.32, JAW_H[1], JAW_H[2]], [0, 0, Math.PI / 2])]);
    bolt(B.metal, [s * 0.34, JAW_H[1], JAW_H[2]], [s, 0, 0], 0.024);
    B.metal.push([tint(G.rbox(0.1, 0.045, 0.06, 0.012, 2), K.steel), mtx([s * (PIST_X - 0.04), PIST_A[0], PIST_A[1]])]);
    B.metal.push([tint(G.cyl(0.03, 0.03, 0.05, 10), K.steel), mtx([s * PIST_X, PIST_A[0], PIST_A[1]], [0, 0, Math.PI / 2])]);
  }
  // --- capot du crâne, entre la paupière et les plaques du dos
  const HEAD = { c: [0, 0.07, 0.24], r: [0.33, 0.25, 0.26] };
  B.main.push([shell({ ...HEAD, f: FB, dir: [0, 1, -0.1], t1: [1, 0, 0], au: 0.62, av: 0.3, off: 0.004, th: 0.02, nu: 10, nv: 4, dents: [[0.7, 0.4, 0.012, 0.12]] }).geo]);
  // --- joues : tôles rivetées entre l'œil et la charnière
  for (const s of [-1, 1]) {
    const ch = shell({ ...HEAD, f: FB, dir: [s, 0.25, 0.75], t1: [0, 0, -s], au: 0.32, av: 0.3, off: 0.004, th: 0.018, nu: 6, nv: 5, twist: s * 0.2,
      dents: s > 0 ? [[0.4, 0.6, 0.012, 0.15]] : [] });
    B.main.push([ch.geo]);
    for (const [u, v] of [[0.12, 0.15], [0.12, 0.85], [0.88, 0.15], [0.88, 0.85]]) { const [p, n] = ch.at(u, v); rivet(B.metal, p, n); }
  }
  // --- tôle arrière : feux, grille d'aération
  const rp = shell({ ...HUMP, f: FB, dir: [0, -0.15, -1], t1: [-1, 0, 0], au: 0.6, av: 0.42, off: 0.004, th: 0.02, nu: 10, nv: 8, dents: [[0.7, 0.3, 0.014, 0.12]] });
  B.main.push([rp.geo]);
  for (const [u, v] of [[0.06, 0.5], [0.94, 0.5], [0.3, 0.95], [0.7, 0.95], [0.5, 0.95]]) { const [p, n] = rp.at(u, v); rivet(B.metal, p, n); }
  // --- oreilles en coupelles
  for (const s of [-1, 1]) {
    const cup = G.lathe('grigEar', [[0.0, 0.0], [0.06, 0.004], [0.095, 0.025], [0.1, 0.045], [0.088, 0.045], [0.055, 0.02], [0.0, 0.016]], 14);
    // ouverture tournée vers l'avant et le dehors : on voit le creux sombre de face, le dos peint de profil
    const ed = [s * 0.6, 0.3, 0.75], o = new THREE.Vector3(...ed).normalize().multiplyScalar(0.03);
    B.main.push([cup, along([s * 0.2, 0.37, 0.0], ed, 0, [1.05, 1.4, 1.25])]);
    B.metal.push([tint(G.cyl(0.085, 0.085, 0.006, 14), K.dark), along([s * 0.2 + o.x, 0.37 + o.y, o.z], ed, 0, [1, 1, 1.2])]);
  }
  // --- queue : gaine de câble annelée qui remonte en crochet
  const tail = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    tail.push(new THREE.Vector3(Math.sin(t * 2.4) * 0.05, -0.02 + t * 0.12 + t * t * 0.3, -0.48 - t * 0.38 + t * t * t * 0.1));
  }
  for (let i = 0; i < 12; i++) {
    const a = tail[i], b = tail[i + 1], r = 0.034 - i * 0.002;
    const dv = new THREE.Vector3().subVectors(b, a), len = dv.length();
    B.metal.push([tint(G.cyl(r * 0.9, r, len * 0.82, 8), K.cable), along(a.clone().addScaledVector(dv, 0.5).toArray(), dv.toArray())]);
    B.metal.push([tint(G.cyl(r * 1.12, r * 1.12, len * 0.22, 8), i % 3 ? K.steel : K.brass), along(b.toArray(), dv.toArray())]);
  }
  B.metal.push([tint(G.cyl(0.05, 0.06, 0.06, 12), K.steel), along([0, -0.02, -0.47], [0, 0.1, -1])]);
  // --- feux arrière et grille d'aération (sur la tôle arrière)
  for (const u of [0.2, 0.8]) {
    const [p, n] = rp.at(u, 0.45, 0.012), [p2] = rp.at(u, 0.45, 0.02);
    B.metal.push([tint(G.cyl(0.036, 0.036, 0.024, 10), K.dark), along(p, n)]);
    B.led.push([G.sphere(0.024, 8, 6), mtx(p2)]);
  }
  {
    const [p, n] = rp.at(0.5, 0.72, 0.008);
    const vent = along(p, n).multiply(mtx([0, 0, 0], [-Math.PI / 2, 0, 0]));
    B.metal.push([tint(G.rbox(0.2, 0.12, 0.03, 0.012, 2), K.dark), vent]);
    for (let i = 0; i < 4; i++) B.metal.push([tint(G.box(0.17, 0.014, 0.022), K.rivet), vent.clone().multiply(mtx([0, -0.04 + i * 0.027, 0.014], [0.5, 0, 0]))]);
  }
  // --- truffe en caoutchouc et moustaches en fil d'acier
  B.metal.push([tint(G.sphere(0.05, 12, 8), K.dark), mtx([0, 0.07, 0.51], [0, 0, 0], [1.3, 0.85, 0.9])]);
  for (const s of [-1, 1]) B.metal.push([tint(G.sphere(0.014, 6, 4), K.black), mtx([s * 0.028, 0.058, 0.553], [0, 0, 0], [1, 0.7, 0.5])]);
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    const a = new THREE.Vector3(s * 0.1, 0.02 - i * 0.025, 0.47), d = new THREE.Vector3(s, 0.2 - i * 0.2, 0.35 - i * 0.05).normalize();
    B.metal.push([tint(G.cyl(0.0035, 0.006, 0.24, 5), K.wire), along(a.clone().addScaledVector(d, 0.12).toArray(), d.toArray())]);
  }
  // --- paupière blindée au-dessus de l'œil (rivetée, de biais : l'air mauvais)
  const lid = shell({ c: [0, 0.25, 0.33], r: [0.17, 0.17, 0.17], dir: [0.12, 0.85, 0.5], t1: [1, 0, 0], au: 0.95, av: 0.42, off: 0.012, th: 0.026, nu: 10, nv: 4, twist: -0.2 });
  B.slate.push([lid.geo]);
  for (const u of [0.1, 0.9]) { const [p, n] = lid.at(u, 0.5); bolt(B.metal, p, n, 0.018); }
  // --- mâchoire : blindage de menton, rustine, barre et lames du bas (pointes vers le haut), chapes des tiges
  const J = L.jaw;
  const JAWE = { c: [0, -0.085, 0.14], r: [0.39, 0.15, 0.33] };
  const chin = shell({ ...JAWE, f: FJ, dir: [0, -0.3, 1], t1: [1, 0, 0], au: 0.85, av: 0.38, off: 0.01, th: 0.022, nu: 12, nv: 5, dents: [[0.62, 0.45, 0.012, 0.1]] });
  J.main.push([chin.geo]);
  for (const u of [0.07, 0.35, 0.65, 0.93]) { const [p, n] = chin.at(u, 0.2); rivet(J.metal, p, n, 0.015); }
  const jr = shell({ ...JAWE, f: FJ, dir: [1, -0.25, 0.1], t1: [0, 0, -1], au: 0.2, av: 0.22, off: 0.006, th: 0.012, nu: 4, nv: 4, twist: 0.25 });
  J.patch.push([jr.geo]);
  weld(J.metal, jr, 6);
  bar(J.metal, 0.32, 0.32, 0.3, 0.11, -0.015, -1.25, 1.25);
  teeth(J.metal, 7, -1.12, 1.12, 0.32, 0.3, 0.11, -0.005, 1, [1, 0.85, 1.1, 0.95, 1.05, 0.9, 1], 4);
  for (const s of [-1, 1]) {
    J.metal.push([tint(G.rbox(0.16, 0.04, 0.055, 0.012, 2), K.steel), mtx([s * (PIST_X - 0.07), PIST_B[0], PIST_B[1]])]);
    J.metal.push([tint(G.cyl(0.026, 0.026, 0.05, 10), K.steel), mtx([s * PIST_X, PIST_B[0], PIST_B[1]], [0, 0, Math.PI / 2])]);
  }
  // --- pattes : rotules de genou et de cheville, tibia à vérin, pied à trois griffes (gauche / droite)
  const legGeo = (x) => {
    const l = [];
    l.push([tint(G.sphere(0.05, 12, 8), K.chrome), mtx([0, -0.16, 0.02])]);
    l.push([tint(G.cyl(0.03, 0.036, 0.13, 10), K.steel), mtx([0, -0.235, 0.035], [0.1, 0, 0])]);
    l.push([tint(G.cyl(0.042, 0.042, 0.05, 10), K.dark), mtx([0, -0.175, 0.02], [0, 0, Math.PI / 2])]);
    // petit vérin arrière du tibia
    l.push([tint(G.cyl(0.016, 0.016, 0.08, 6), K.steel), mtx([0, -0.09, -0.06], [-0.2, 0, 0])]);
    l.push([tint(G.cyl(0.009, 0.009, 0.08, 6), K.rivet), mtx([0, -0.16, -0.045], [-0.2, 0, 0])]);
    l.push([tint(G.sphere(0.036, 10, 6), K.chrome), mtx([0, -0.305, 0.045])]);
    // pied remis à plat (l'os est incliné de x × 0,5 en z)
    const foot = new THREE.Matrix4().compose(new THREE.Vector3(0, -0.315, 0.05), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -x * 0.5)), _s.setScalar(1));
    const fp = (p, r = [0, 0, 0], s = 1) => foot.clone().multiply(mtx(p, r, s));
    l.push([tint(G.rbox(0.13, 0.05, 0.15, 0.018, 2), K.steel), fp([0, -0.02, 0.02])]);
    l.push([tint(G.rbox(0.11, 0.02, 0.13, 0.008, 1), K.dark), fp([0, -0.045, 0.02])]);
    for (let i = -1; i <= 1; i++) {
      l.push([tint(G.cone(0.02, 0.07, 6), K.blade), fp([i * 0.042, -0.025, 0.11], [1.25, i * 0.25, 0])]);
      l.push([tint(G.cone(0.014, 0.05, 6), K.blade), fp([i * 0.046, -0.045, 0.15], [2.3, i * 0.25, 0])]);
    }
    return grimeY(bake(l), -0.36, -0.2, 0.5);
  };
  // --- vérins mobiles : corps (sur le corps, axe +z) et tige (sur la mâchoire, axe +z)
  const barrel = [], rod = [];
  for (const s of [-1, 1]) {
    barrel.push([tint(G.cyl(0.024, 0.024, 0.22, 10), K.steel), mtx([s * PIST_X, 0, 0.13], [Math.PI / 2, 0, 0])]);
    barrel.push([tint(G.cyl(0.03, 0.03, 0.03, 10), K.brass), mtx([s * PIST_X, 0, 0.235], [Math.PI / 2, 0, 0])]);
    rod.push([tint(G.cyl(0.012, 0.012, 0.24, 8), K.chrome), mtx([s * PIST_X, 0, 0.12], [Math.PI / 2, 0, 0])]);
  }
  // --- œil-objectif : boîtier, bague moletée, iris lumineux, pupille-diaphragme
  const eM = [], eI = [], eG = [];
  eM.push([tint(G.cyl(0.125, 0.14, 0.13, 20), K.steel), mtx([0, 0, -0.01], [Math.PI / 2, 0, 0])]);
  eM.push([tint(G.torus(0.122, 0.024, 8, 24), K.chrome), mtx([0, 0, 0.058])]);
  eM.push([tint(G.cyl(0.14, 0.14, 0.03, 24), K.dark), mtx([0, 0, 0.02], [Math.PI / 2, 0, 0])]);
  eM.push([tint(G.cyl(0.1, 0.1, 0.02, 20), K.black), mtx([0, 0, 0.055], [Math.PI / 2, 0, 0])]);
  eM.push([tint(G.cyl(0.03, 0.03, 0.01, 12), K.black), mtx([0, 0, 0.074], [Math.PI / 2, 0, 0])]);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; eM.push([tint(G.box(0.012, 0.03, 0.006), K.dark), mtx([Math.cos(a) * 0.05, Math.sin(a) * 0.05, 0.072], [0, 0, a])]); }
  eI.push([G.cyl(0.082, 0.082, 0.008, 20), mtx([0, 0, 0.068], [Math.PI / 2, 0, 0])]);
  eG.push([G.sphere(0.018, 8, 6), mtx([0.04, 0.045, 0.08], [0, 0, 0], [1, 0.7, 0.4])]);
  // --- antenne : socle, ressort, fouet et feu
  const aM = [];
  aM.push([tint(G.cyl(0.035, 0.045, 0.04, 10), K.steel), mtx([0, 0.02, 0])]);
  for (let i = 0; i < 4; i++) aM.push([tint(G.torus(0.02, 0.006, 5, 10), K.chrome), mtx([0, 0.05 + i * 0.016, 0], [Math.PI / 2, 0, 0])]);
  aM.push([tint(G.cyl(0.008, 0.012, 0.3, 6), K.steel), mtx([0, 0.25, 0])]);
  aM.push([tint(G.cyl(0.02, 0.016, 0.03, 8), K.dark), mtx([0, 0.39, 0])]);
  const fins = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, bake(v)]));
  GEO = {
    body: fins(L.body), plates: fins(L.plates), jaw: fins(L.jaw),
    leg: { [-1]: legGeo(-1), 1: legGeo(1) },
    barrel: bake(barrel), rod: bake(rod),
    eye: { metal: bake(eM), iris: bake(eI), glint: bake(eG) },
    ant: bake(aM),
  };
  // crasse au bas des tôles du corps et de la mâchoire
  for (const g of [GEO.body.main, GEO.body.num, GEO.body.patch, GEO.body.metal, GEO.jaw.main, GEO.jaw.patch, GEO.jaw.metal]) grimeY(g, -0.32, 0.05, 0.45);
  for (const g of [GEO.body.slate, GEO.plates.slate]) grimeY(g, -0.1, 0.2, 0.2);
  for (const o of [GEO.body, GEO.plates, GEO.jaw, GEO.eye]) for (const g of Object.values(o)) g.userData.shared = true;
  for (const g of [GEO.leg[-1], GEO.leg[1], GEO.barrel, GEO.rod, GEO.ant]) g.userData.shared = true;
  return GEO;
}

export function grignoteur(variant = 0) {
  const v = variant % 3, mainC = MAIN[v];
  const { S, root, B, skin } = rig({
    main: { color: mainC, rough: 0.55, metal: 0.3, sheen: 0.15, coat: 0.2 },
    bare: { color: '#b4b9c4', rough: 0.35, metal: 0.9 },
    belly: { color: '#3a3448', rough: 0.5, metal: 0.5 },
    plate: { color: '#4d5366', rough: 0.42, metal: 0.7 },
    mouth: { color: '#5a1626', rough: 0.7 },
    rust: { color: '#7a3a1a', rough: 0.9, metal: 0.1 },
    grime: { color: '#4a3a2c', rough: 0.85, metal: 0.2 },
    dark: { color: '#1e1b24', rough: 0.6, metal: 0.4 },
  });
  const body = B(root, [0, 0.55, 0], 'body');
  // coque cabossée (bruit lent), bosse du dos, crâne et museau carré
  S.add(body, { t: 'ell', r: [0.4, 0.32, 0.46], p: [0, 0.02, -0.06], col: 'main', k: 0.05, fuzz: [0.008, 6] });
  S.add(body, { t: 'ell', r: [0.34, 0.26, 0.34], p: [0, 0.16, -0.2], col: 'main', k: 0.12 });
  S.add(body, { t: 'ell', r: [0.33, 0.25, 0.26], p: [0, 0.07, 0.24], col: 'main', k: 0.1 });
  S.add(body, { t: 'box', s: [0.25, 0.07, 0.08], round: 0.05, p: [0, -0.03, 0.4], col: 'main', k: 0.07 });
  S.add(body, { t: 'ell', r: [0.1, 0.06, 0.05], p: [0, 0.06, 0.47], col: 'main', k: 0.04 });
  // ventre sombre, crasse, rouille et éclats de peinture
  S.paint(body, { t: 'ell', r: [0.4, 0.2, 0.48], p: [0, -0.3, -0.06], col: 'belly', feather: 0.04 });
  S.paint(body, { t: 'ell', r: [0.46, 0.14, 0.52], p: [0, -0.18, -0.06], col: 'grime', feather: 0.08, fuzz: [0.03, 9] });
  for (const [p, r] of [[[-0.3, 0.2, -0.28], 0.06], [[0.2, 0.3, 0.2], 0.05], [[-0.12, 0.34, 0.1], 0.04], [[0.28, -0.05, 0.3], 0.045]]) {
    S.paint(body, { t: 'sph', r, p, col: 'bare', feather: 0.008, fuzz: [0.025, 28] });
  }
  S.paint(body, { t: 'sph', r: 0.06, p: [0.33, 0.12, -0.3], col: 'rust', feather: 0.04, fuzz: [0.02, 20] });
  // bosses de tôle
  for (const [p, n, r] of [[[0.29, 0.12, 0.33], [0.85, 0.1, 0.5], 0.1], [[-0.27, 0, 0.35], [-0.7, -0.1, 0.7], 0.09], [[0.15, 0.02, -0.49], [0.3, 0, -0.95], 0.11]]) {
    const l = Math.hypot(...n), d = r - 0.016;
    S.sub(body, { t: 'sph', r, p: p.map((c, i) => c + (n[i] / l) * d), k: 0.04, col: 'main' });
  }
  // orbite de l'œil et gueule
  S.sub(body, { t: 'sph', r: 0.165, p: [0, 0.25, 0.38], k: 0.03, col: 'dark' });
  S.sub(body, { t: 'ell', r: [0.27, 0.085, 0.2], p: [0, -0.11, 0.42], k: 0.03, col: 'mouth' });
  const jaw = B(body, JAW_H, 'jaw');
  // mâchoire en godet : large, carrée, en avant du museau
  S.add(jaw, { t: 'box', s: [0.34, 0.065, 0.2], round: 0.065, p: [0, -0.085, 0.17], col: 'main', k: 0.05, skinSoft: 0.015 });
  S.add(jaw, { t: 'ell', r: [0.37, 0.12, 0.3], p: [0, -0.075, 0.12], col: 'main', k: 0.06, skinSoft: 0.015 });
  S.paint(jaw, { t: 'ell', r: [0.3, 0.08, 0.3], p: [0, -0.17, 0.1], col: 'belly', feather: 0.04 });
  S.sub(jaw, { t: 'ell', r: [0.25, 0.05, 0.2], p: [0, -0.01, 0.15], k: 0.03, col: 'mouth' });
  const legs = [];
  for (const [x, z] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const l = B(body, [x * 0.34, -0.2, z * 0.25], 'leg', [0, 0, x * 0.5]);
    S.add(l, { t: 'ell', r: [0.1, 0.09, 0.115], p: [0, 0.01, 0], col: 'main', k: 0.04, skinSoft: 0.012 });
    S.add(l, { t: 'cone', a: [0, -0.02, 0], b: [0, -0.14, 0.015], r1: 0.07, r2: 0.05, col: 'plate', k: 0.03, skinSoft: 0.012 });
    legs.push(l);
  }
  skin('grignoteur' + v, { mesh: { cell: 0.022, skinSoft: 0.03 }, mat: { enemyRim: true } });

  // ---- pièces rigides (géométries partagées)
  const M = mats(), g = GEO || geos(boneField(S, root, body, [0, 0.55, 0]), boneField(S, root, jaw, [0, 0.55 + JAW_H[1], JAW_H[2]]));
  const mainM = M.main[v];
  part(body, g.body.main, mainM, { outline: 0.012 });
  part(body, g.body.slate, M.slate, { outline: 0.012 });
  part(body, g.body.patch, M.patch);
  part(body, g.body.metal, M.metal);
  part(body, g.body.led, M.led, { shadow: false });
  part(body, g.body.num, M.num[v], { outline: 0.012 });
  const plates = joint(body, [0, 0, 0]);
  part(plates, g.plates.slate, M.slate, { outline: 0.012 });
  part(plates, g.plates.metal, M.metal);
  part(jaw, g.jaw.main, mainM, { outline: 0.012 });
  part(jaw, g.jaw.patch, M.patch);
  part(jaw, g.jaw.metal, M.metal);
  legs.forEach((l, i) => part(l, g.leg[i % 2 ? 1 : -1], M.metal));
  // vérins : le corps pivote sur son œil (corps), la tige sur le sien (mâchoire) ; orientés vers l'autre œil
  const pa = joint(body, [0, PIST_A[0], PIST_A[1]]);
  const pb = joint(jaw, [0, PIST_B[0], PIST_B[1]]);
  part(pa, g.barrel, M.metal);
  const rodM = part(pb, g.rod, M.metal);
  const aimPistons = () => {
    const th = jaw.rotation.x, c = Math.cos(th), s = Math.sin(th);
    const by = JAW_H[1] + PIST_B[0] * c - PIST_B[1] * s, bz = JAW_H[2] + PIST_B[0] * s + PIST_B[1] * c;
    const dy = by - PIST_A[0], dz = bz - PIST_A[1];
    pa.rotation.x = Math.atan2(-dy, dz);
    pb.rotation.x = Math.atan2(dy, -dz) - th;
  };
  aimPistons();
  rodM.onBeforeRender = aimPistons;
  // œil-objectif (pivote en lacet dans son orbite)
  const eye = joint(body, [0, 0.25, 0.33]);
  part(eye, g.eye.metal, M.metal, { outline: 0.01 });
  part(eye, g.eye.iris, M.iris, { shadow: false });
  part(eye, g.eye.glint, M.glint, { shadow: false });
  // antenne fouet sur la bosse
  const ant = joint(body, [-0.17, 0.4, -0.12]);
  ant.rotation.set(-0.25, 0, 0.38);
  part(ant, g.ant, M.metal);
  part(ant, G.sphere(0.035, 10, 8), M.tip, { p: [0, 0.42, 0], shadow: false });
  return { root, debrisColor: mainC, body, jaw, eye, legs, chunks: [plates, eye, ant] };
}
