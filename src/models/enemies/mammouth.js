import * as THREE from 'three';
import { G, part, joint, bake, mtx } from '../geo.js';
import { mat, glow } from '../../engine/materials.js';
import { paintedMetalTexture, hazardTexture } from '../../engine/textures.js';
import { rng } from '../../engine/util.js';
import { addFur } from '../fur.js';
import { C, rig } from './common.js';

// ===================================================================== Mammouth-Foreuse (boss de Givrelune)
// Mammouth mécanique blindé : défenses-foreuses à filets hélicoïdaux qui tournent, trompe-canon en anneaux articulés,
// cœur thermique incandescent sous grille sur le dos (point faible). Corps sculpté (fourrure en coquilles sur le dos,
// la tête et les cuisses, givrée au sommet), coque en plaques de tôle peinte écaillée boulonnées, glaçons accrochés.

// Fourrure : longue, raide et peignée vers le bas et l'arrière (jupe le long des flancs)
const FUR_MAMMOUTH = {
  len: 0.13, cell: 0.034, minW: 0.3, lean: 1.1, sheen: 0.5,
  bones: { hip: 1.2, head: 0.75 },
  comb: { body: [0, -1, -0.45], head: [0, -0.4, -1], hip: [0, -1, 0] },
  trim: [],
  regions: [{ root: 'body', track: 'body', at: [0, 1.5, 0] }, { root: 'head', track: 'head', at: [0, 1, 0] }],
};

// ------------------------------------------------------------------ aides géométriques
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3();

// Grille (nu × nv quadrilatères) : P(i, j) → [x, y, z], UV(i, j) → [u, v] ; orientée pour que sa normale suive hint(i, j)
function grid(nu, nv, P, UV, hint) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { pos.push(...P(i, j)); uv.push(...UV(i, j)); }
  const w = nu + 1;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * w + i;
    idx.push(a, a + 1, a + w + 1, a, a + w + 1, a + w);
  }
  // sens des triangles : comparé à la direction attendue au milieu de la grille
  const i0 = Math.floor(nu / 2), j0 = Math.floor(nv / 2), a = j0 * w + i0;
  const h = hint(i0, j0).clone();
  _a.fromArray(pos, a * 3); _b.fromArray(pos, (a + 1) * 3); _c.fromArray(pos, (a + w + 1) * 3);
  _b.sub(_a).cross(_c.sub(_a));
  if (_b.dot(h) < 0) for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}
const V3 = (p) => new THREE.Vector3(p[0], p[1], p[2]);

// Plaque épaisse posée sur une surface paramétrée f(u, v, o) → [x, y, z] (o : décalage vers l'extérieur) :
// dessus (UV 0..1 : l'écaillage de la texture suit les arêtes), dessous et quatre chants
function plate(f, nu, nv, thick) {
  const out = (u, v) => _n.subVectors(V3(f(u, v, 0)), V3(f(u, v, -1))).clone();
  const parts = [
    grid(nu, nv, (i, j) => f(i / nu, j / nv, 0), (i, j) => [i / nu, j / nv], (i, j) => out(i / nu, j / nv)),
    grid(nu, nv, (i, j) => f(i / nu, j / nv, -thick), (i, j) => [i / nu, j / nv], (i, j) => out(i / nu, j / nv).negate()),
  ];
  const e = 0.015;
  // chants : l'arête extérieure de la plaque, vers l'extérieur du contour
  const edge = (n, at, away) => grid(n, 1, (i, k) => f(...at(i / n), -thick * k), (i, k) => [i / n, k * e], (i) => away(i / n));
  const d = (u0, v0, u1, v1) => _n.subVectors(V3(f(u0, v0, 0)), V3(f(u1, v1, 0))).clone();
  parts.push(edge(nu, (t) => [t, 0], (t) => d(t, 0, t, 0.1)));
  parts.push(edge(nu, (t) => [t, 1], (t) => d(t, 1, t, 0.9)));
  parts.push(edge(nv, (t) => [0, t], (t) => d(0, t, 0.1, t)));
  parts.push(edge(nv, (t) => [1, t], (t) => d(1, t, 0.9, t)));
  return bake(parts.map((g) => [g, null]));
}

// Croûte de neige sur le bord haut (u = 1) d'une plaque : lisière en festons arrondis, épaisseur bosselée
function snowCap(f, depth = 0.16, seed = 0) {
  const n = (v) => 0.25 + 0.55 * Math.abs(Math.sin(v * Math.PI * 4.5 + seed)) + 0.2 * Math.sin(v * 7 + seed * 3);
  return plate((u, v, o) => f(1 - depth * (0.45 + n(v)) * (1 - u), v, o + 0.015 + 0.09 * Math.sin(u * Math.PI * 0.75) * (0.5 + 0.5 * n(v * 1.7 + 0.3))), 5, 32, 0.04);
}

// Marquage peint au pochoir (« M-07 » jaune du Baron, usé) : texture de canvas, fond transparent
let DECAL = null;
function decalTexture() {
  if (DECAL) return DECAL;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = C.gold;
  x.font = '900 92px Arial Black, Arial, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('M-07', 128, 66);
  // ponts du pochoir et éclats de peinture
  x.globalCompositeOperation = 'destination-out';
  x.fillRect(0, 62, 256, 5);
  const R = rng(5);
  for (let i = 0; i < 220; i++) { x.beginPath(); x.arc(R() * 256, R() * 128, 0.6 + R() * R() * 5, 0, 7); x.fill(); }
  DECAL = new THREE.CanvasTexture(c);
  DECAL.colorSpace = THREE.SRGBColorSpace;
  DECAL.anisotropy = 4;
  return DECAL;
}

// Surface d'ellipsoïde (centre c, rayons R) : u balaie l'angle a0 → a1 autour de l'axe, v la position t0 → t1 le long
// de l'axe ; axe 'z' (angle dans le plan xy, 0 = +x), 'y' (angle dans le plan zx, 0 = +z) ou 'x' (plan yz, 0 = +y)
function ellSurf(c, R, a0, a1, t0, t1, off = 0, axis = 'z') {
  const [ia, ib, it] = axis === 'z' ? [0, 1, 2] : axis === 'y' ? [2, 0, 1] : [1, 2, 0];
  return (u, v, o) => {
    const a = a0 + (a1 - a0) * u, t = t0 + (t1 - t0) * v;
    const ra = R[ia] + off + o, rb = R[ib] + off + o, rt = R[it] + off + o;
    const s = Math.sqrt(Math.max(0, 1 - (t / rt) ** 2));
    const p = [0, 0, 0];
    p[ia] = c[ia] + ra * s * Math.cos(a); p[ib] = c[ib] + rb * s * Math.sin(a); p[it] = c[it] + t;
    return p;
  };
}
// normale de la surface paramétrée (pour poser rivets et glaçons)
function surfN(f, u, v) { return _n.subVectors(V3(f(u, v, 0.01)), V3(f(u, v, -0.01))).normalize().clone(); }

// Rivet bombé tourné vers n, posé en p
const RIV = new THREE.SphereGeometry(1, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2);
const TOE = new THREE.SphereGeometry(0.17, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
const _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);
function rivetAt(list, p, n, r = 0.045) {
  _q.setFromUnitVectors(_up, n);
  list.push([RIV, new THREE.Matrix4().compose(V3(p), _q.clone(), new THREE.Vector3(r, r * 0.55, r))]);
}
// Rivets le long des bords d'une plaque (marge m en UV) ; sides : 'b' (v = 0), 'h' (v = 1), 'g' (u = 0), 'd' (u = 1)
function plateRivets(list, f, sides, n, m = 0.06, r = 0.045, lift = 0) {
  const pts = [];
  for (const s of sides) for (let k = 0; k < n; k++) {
    const t = m + (1 - 2 * m) * (k + 0.5) / n;
    pts.push(s === 'b' ? [t, m] : s === 'h' ? [t, 1 - m] : s === 'g' ? [m, t] : [1 - m, t]);
  }
  for (const [u, v] of pts) rivetAt(list, f(u, v, lift), surfN(f, u, v), r);
}
// Glaçons pendus sous le bord v = 0 d'une plaque (cônes effilés tête en bas, longueurs au hasard)
function iciclesUnder(list, f, n, R, len = 0.4, u0 = 0.08, u1 = 0.92) {
  for (let k = 0; k < n; k++) {
    if (R() < 0.25) continue;
    const u = u0 + (u1 - u0) * (k + R() * 0.6 + 0.2) / n;
    icicle(list, f(u, 0.02, -0.02), R, len);
  }
}
function icicle(list, p, R, len) {
  const l = len * (0.35 + R() * 0.75), r = 0.04 + R() * 0.04;
  list.push([G.cone(1, 1, 7), mtx([p[0], p[1] - l * 0.5, p[2]], [Math.PI + (R() - 0.5) * 0.15, R() * 3, (R() - 0.5) * 0.15], [r, l, r])]);
}
// Tube le long de points (durites, échappements) ; ribs : bourrelets annelés (durite)
function tube(pts, r, seg = 40, rs = 10, ribs = 0) {
  const curve = new THREE.CatmullRomCurve3(pts.map(V3));
  const g = new THREE.TubeGeometry(curve, seg, r, rs, false);
  if (ribs) {
    const p = g.attributes.position, nr = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const ring = Math.floor(i / (rs + 1));
      const k = 0.5 + 0.5 * Math.cos((ring / seg) * ribs * Math.PI * 2);
      p.setXYZ(i, p.getX(i) + nr.getX(i) * r * 0.22 * k, p.getY(i) + nr.getY(i) * r * 0.22 * k, p.getZ(i) + nr.getZ(i) * r * 0.22 * k);
    }
    g.computeVertexNormals();
  }
  return g;
}

// Foret hélicoïdal le long de +z (de 0 à L, rayon R au talon) : deux filets en spirale à crête vive, goujures creuses ;
// couleurs de sommet : crêtes polies claires, fond des goujures sombre, talon lisse
function drillGeo(L, R, turns = 4.2, nA = 36, nZ = 64) {
  const pos = [], col = [], idx = [];
  const hi = new THREE.Color('#f2f6ff'), lo = new THREE.Color('#5d6678'), cc = new THREE.Color();
  for (let j = 0; j <= nZ; j++) {
    const t = j / nZ, z = t * L;
    const r0 = R * Math.pow(1 - t, 0.8) + 0.004;
    const thread = THREE.MathUtils.smoothstep(t, 0.1, 0.18);
    for (let i = 0; i < nA; i++) {
      const a = (i / nA) * Math.PI * 2;
      let ph = (2 * a / (Math.PI * 2) - turns * t) % 1;
      if (ph < 0) ph += 1;
      const d = Math.min(ph, 1 - ph) * 2; // 0 sur la crête
      const ridge = 1 - THREE.MathUtils.smoothstep(d, 0.05, 0.6);
      const r = r0 * (1 - thread * (0.3 - 0.3 * ridge));
      pos.push(Math.cos(a) * r, Math.sin(a) * r, z);
      cc.copy(lo).lerp(hi, thread ? 0.15 + 0.85 * ridge * thread + (1 - thread) * 0.6 : 0.6);
      col.push(cc.r, cc.g, cc.b);
    }
  }
  for (let j = 0; j < nZ; j++) for (let i = 0; i < nA; i++) {
    const a = j * nA + i, b = j * nA + (i + 1) % nA;
    idx.push(a, b, b + nA, a, b + nA, a + nA);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ matériaux
function mats() {
  const hull = paintedMetalTexture('#7d90b8', 'mammouth-hull', { chip: 0.3, edge: 0.8, rust: 0.06, bare: '#d2d9e4', tile: 2 });
  const vorax = paintedMetalTexture(C.vorax, 'mammouth-vorax', { chip: 0.25, edge: 0.7, rust: 0, bare: '#c9d1de' });
  const haz = hazardTexture();
  const decal = mat('#ffffff', { map: decalTexture(), rough: 0.5, metal: 0.1 });
  decal.alphaTest = 0.5;
  return {
    plate: mat('#ffffff', { map: hull.map, normalMap: hull.normalMap, rough: 0.5, metal: 0.2, coat: 0.55 }),
    vorax: mat('#ffffff', { map: vorax.map, normalMap: vorax.normalMap, rough: 0.38, metal: 0.25, coat: 0.7 }),
    hazard: mat('#ffffff', { map: haz.map, rough: 0.5, metal: 0.2 }),
    dark: mat('#2b2737', { rough: 0.42, metal: 0.7 }),
    steel: mat('#c3ccdc', { rough: 0.28, metal: 0.92 }),
    gold: mat(C.gold, { rough: 0.3, metal: 0.8, coat: 0.4 }),
    drill: mat('#ffffff', { rough: 0.22, metal: 0.95, vertexColors: true }),
    blued: mat('#4a4f86', { rough: 0.3, metal: 0.9 }),
    ice: mat('#d4f1ff', { rough: 0.06, metal: 0.05, coat: 1, emissive: '#2c6a8a', emissiveIntensity: 0.35 }),
    hose: mat('#24212c', { rough: 0.6, sheen: 0.3, sheenColor: '#8a90b0' }),
    snow: mat('#d8e6f4', { rough: 0.85, sheen: 0.4, sheenColor: '#ffffff' }),
    decal,
  };
}

// ------------------------------------------------------------------ pièces rigides (construites une fois)
// Par emplacement (os) : liste de [clé de matériau, géométrie fusionnée]
let PARTS = null;
function buildParts() {
  const R = rng(17);
  const P = {};
  const L = (slot, key) => { P[slot] = P[slot] || {}; return (P[slot][key] = P[slot][key] || []); };
  const add = (slot, key, geo, p, r, s) => L(slot, key).push([geo, mtx(p, r, s)]);
  const push = (slot, key, geo) => L(slot, key).push([geo, null]);

  // ---- corps : plaques de blindage des flancs (se chevauchent d'avant en arrière), liserés violets, rivets, glaçons
  const BODY = [2.0, 1.7, 2.85];
  const bands = [[0.45, 1.75, 0.2, 0.5], [-0.95, 0.7, 0.15, 0.78], [-2.35, -0.7, 0.1, 0.78]];
  for (const s of [-1, 1]) {
    bands.forEach(([z0, z1, off, top]) => {
      const a0 = s > 0 ? -0.5 : Math.PI + 0.5, a1 = s > 0 ? top : Math.PI - top;
      const f = ellSurf([0, 0, 0], BODY, a0, a1, z0, z1, off);
      push('body', 'plate', plate(f, 12, 10, 0.07));
      // liseré violet au bord avant des plaques (pas sur celle de l'épaule, sous la fourrure)
      if (z1 < 1.5) {
        const fv = ellSurf([0, 0, 0], BODY, a0, a1, z1 - 0.2, z1 - 0.04, off + 0.025);
        push('body', 'vorax', plate(fv, 12, 1, 0.04));
      }
      plateRivets(L('body', 'steel'), f, ['b', 'h'], 6, 0.07, 0.045, 0.01);
      plateRivets(L('body', 'steel'), f, ['g'], 3, 0.07, 0.045, 0.01);
      push('body', 'snow', snowCap(f, 0.26, z0 * 3 + s));
      if (z0 < 0 && z0 > -1.5) {
        // marquage au pochoir sur la plaque du milieu (lisible des deux côtés)
        push('body', 'decal', grid(10, 10, (i, j) => f(0.3 + 0.34 * i / 10, 0.2 + 0.6 * j / 10, 0.012), (i, j) => [s > 0 ? 1 - j / 10 : j / 10, i / 10], () => surfN(f, 0.5, 0.5)));
      }
    });
  }
  // plaque de croupe (la queue sort dessous)
  const rump = ellSurf([0, 0, 0], BODY, Math.PI + 0.7, Math.PI * 1.5 + 0.45, -1.05, 1.05, 0.12, 'x');
  push('body', 'plate', plate(rump, 12, 12, 0.07));
  push('body', 'snow', snowCap(rump, 0.12, 4));
  iciclesUnder(L('body', 'ice'), (u, v, o) => rump(v, u, o), 7, R, 0.45);
  // glaçons pris dans la frange de poils des flancs
  for (const s of [-1, 1]) for (let i = 0; i < 9; i++) if (R() > 0.2) icicle(L('body', 'ice'), [s * (1.66 + R() * 0.12), -1.3 - R() * 0.12, -1.9 + i * 0.48 + R() * 0.2], R, 0.6);
  plateRivets(L('body', 'steel'), rump, ['h', 'g', 'd'], 5, 0.07, 0.045, 0.01);
  // ---- tourelle du cœur thermique : collerette dorée, grille en cage, ailettes de radiateur, fentes rougeoyantes, feux
  const CORE = [0, 2.35, -1.6];
  add('body', 'gold', G.torus(0.98, 0.07, 8, 32), [CORE[0], 2.2, CORE[2]], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 4; i++) add('body', 'steel', G.torus(0.86, 0.055, 6, 22, Math.PI), [CORE[0], 2.25, CORE[2]], [0, (i * Math.PI) / 4, 0]);
  add('body', 'steel', G.torus(0.62, 0.05, 6, 24), [CORE[0], 2.85, CORE[2]], [Math.PI / 2, 0, 0]);
  add('body', 'steel', G.cyl(0.16, 0.16, 0.08, 12), [CORE[0], 3.12, CORE[2]]);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    add('body', 'dark', G.box(0.06, 0.42, 0.34), [CORE[0] + Math.cos(a) * 1.05, 1.9, CORE[2] + Math.sin(a) * 1.05], [0, -a, 0]);
  }
  for (const a of [0.6, 2.54, 3.74, 5.68]) add('body', 'heat', G.box(0.05, 0.08, 0.3), [CORE[0] + Math.cos(a) * 0.97, 2.0, CORE[2] + Math.sin(a) * 0.97], [0, -a + Math.PI / 2, 0]);
  // ---- échappements : deux cheminées coudées vers l'arrière, embouchures bleuies, braises au fond, colliers
  for (const s of [-1, 1]) {
    const pts = [[s * 0.95, 1.2, -1.7], [s * 1.0, 2.0, -2.1], [s * 1.05, 2.75, -2.45], [s * 1.05, 3.05, -2.8]];
    push('body', 'dark', tube(pts, 0.19, 24, 12));
    const end = V3(pts[3]), dir = V3(pts[3]).sub(V3(pts[2])).normalize();
    _q.setFromUnitVectors(_up, dir);
    L('body', 'blued').push([G.cyl(0.25, 0.22, 0.32, 14, true), new THREE.Matrix4().compose(end.clone().addScaledVector(dir, 0.08), _q.clone(), new THREE.Vector3(1, 1, 1))]);
    L('body', 'blued').push([G.torus(0.25, 0.04, 6, 16), new THREE.Matrix4().compose(end.clone().addScaledVector(dir, 0.24), _q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)), new THREE.Vector3(1, 1, 1))]);
    L('body', 'ember').push([G.cyl(0.17, 0.17, 0.02, 12), new THREE.Matrix4().compose(end.clone().addScaledVector(dir, -0.05), _q.clone(), new THREE.Vector3(1, 1, 1))]);
    for (const t of [0.3, 0.62]) {
      const c = new THREE.CatmullRomCurve3(pts.map(V3));
      const p = c.getPointAt(t), tg = c.getTangentAt(t);
      L('body', 'steel').push([G.torus(0.21, 0.035, 6, 16), new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tg), new THREE.Vector3(1, 1, 1))]);
    }
    // durite annelée de la tourelle vers le flanc
    push('body', 'hose', tube([[s * 0.75, 1.75, -1.15], [s * 1.2, 1.6, -0.75], [s * 1.6, 1.3, -0.45], [s * 1.86, 1.0, -0.25]], 0.1, 30, 8, 8));
    add('body', 'steel', G.cyl(0.15, 0.17, 0.2, 12), [s * 1.9, 0.94, -0.22], [0.3, 0, s * 0.7]);
    // feux de signalisation sur la collerette
    add('body', 'lamp', G.sphere(0.08, 10, 8), [s * 0.72, 2.25, -0.9]);
    add('body', 'dark', G.cyl(0.1, 0.12, 0.08, 10), [s * 0.72, 2.18, -0.9]);
  }
  // ---- poitrail : grille d'aération entre les pattes avant
  for (let i = 0; i < 5; i++) add('body', 'dark', G.rbox(1.0 - Math.abs(i - 2) * 0.12, 0.07, 0.1, 0.03, 2), [0, -0.35 - i * 0.16, 2.62 - i * 0.07], [0.5, 0, 0]);

  // ---- tête : visière de front, plaques de joues, sourcils de tôle, antenne, glaçons
  const HEAD = [1.3, 1.25, 1.2];
  const visor = ellSurf([0, 0, 0], HEAD, 0.62, Math.PI - 0.62, 0.45, 1.06, 0.08);
  push('head', 'plate', plate(visor, 14, 8, 0.07));
  plateRivets(L('head', 'steel'), visor, ['h'], 5, 0.08, 0.04, 0.01);
  for (const s of [-1, 1]) {
    const a0 = s > 0 ? -0.75 : Math.PI + 0.75, a1 = s > 0 ? 0.35 : Math.PI - 0.35;
    const cheek = ellSurf([0, 0, 0], HEAD, a0, a1, -0.35, 0.6, 0.07);
    push('head', 'plate', plate(cheek, 10, 9, 0.07));
    plateRivets(L('head', 'steel'), cheek, ['h', 'd'], 3, 0.1, 0.04, 0.01);
    iciclesUnder(L('head', 'ice'), (u, v, o) => cheek(v, u, o), 4, R, 0.35);
    // sourcil froncé au-dessus de l'œil
    add('head', 'dark', G.rbox(0.5, 0.1, 0.16, 0.04, 2), [s * 0.5, 0.5, 1.02], [0.25, s * 0.2, s * -0.38]);
  }
  // antenne du Baron
  add('head', 'steel', G.cyl(0.03, 0.04, 0.9, 6), [0.62, 1.85, -0.45], [0, 0, -0.3]);
  add('head', 'dark', G.cyl(0.1, 0.13, 0.16, 8), [0.5, 1.45, -0.45], [0, 0, -0.3]);
  add('head', 'lamp', G.sphere(0.08, 10, 8), [0.76, 2.31, -0.45]);
  for (const x of [-0.45, -0.2, 0.2, 0.45]) icicle(L('head', 'ice'), [x, -1.05 + Math.abs(x) * 0.35, 0.55 + R() * 0.15], R, 0.35);
  // monture de la trompe : bague d'acier boulonnée
  add('head', 'steel', G.torus(0.48, 0.07, 8, 24), [0, -0.18, 1.12], [0, 0, 0]);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    rivetAt(L('head', 'steel'), [Math.cos(a) * 0.48, -0.18 + Math.sin(a) * 0.48, 1.2], new THREE.Vector3(0, 0, 1), 0.04);
  }

  // ---- défenses : carter fixe (bague violette, bande de danger, boulons, bouche dorée) et foret qui tourne
  add('tusk', 'dark', G.cyl(0.5, 0.56, 0.75, 18), [0, 0, -0.05], [Math.PI / 2, 0, 0]);
  add('tusk', 'vorax', G.cyl(0.575, 0.575, 0.16, 18, true), [0, 0, -0.25], [Math.PI / 2, 0, 0]);
  add('tusk', 'hazard', G.cyl(0.53, 0.53, 0.14, 18, true), [0, 0, 0.12], [Math.PI / 2, 0, 0]);
  add('tusk', 'gold', G.torus(0.45, 0.06, 8, 22), [0, 0, 0.33]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    rivetAt(L('tusk', 'steel'), [Math.cos(a) * 0.535, Math.sin(a) * 0.535, -0.07], new THREE.Vector3(Math.cos(a), Math.sin(a), 0), 0.045);
  }
  for (const x of [-0.3, -0.05, 0.25]) icicle(L('tusk', 'ice'), [x, -0.52 + Math.abs(x) * 0.3, -0.1 + R() * 0.25], R, 0.4);
  push('drill', 'drill', drillGeo(2.75, 0.42));
  add('drill', 'steel', G.cyl(0.4, 0.4, 0.22, 6), [0, 0, 0.18], [Math.PI / 2, 0, 0]);

  // ---- trompe : bague articulée d'acier au départ de chaque segment ; bouche du canon
  for (let i = 0; i < 3; i++) {
    const r = 0.45 - i * 0.1;
    add('trunk' + i, 'steel', G.torus(r + 0.03, 0.055, 6, 20), [0, -0.03, 0.005], [Math.PI / 2, 0, 0]);
  }
  add('nozzle', 'dark', G.cyl(0.3, 0.27, 0.42, 16), [0, 0.05, 0]);
  add('nozzle', 'steel', G.cyl(0.34, 0.34, 0.2, 16), [0, -0.24, 0]);
  for (let i = 0; i < 4; i++) add('nozzle', 'dark', G.box(0.1, 0.12, 0.08), [Math.cos(i * Math.PI / 2) * 0.32, -0.24, Math.sin(i * Math.PI / 2) * 0.32], [0, -i * Math.PI / 2, 0]);
  add('nozzle', 'vorax', G.cyl(0.32, 0.32, 0.08, 16, true), [0, 0.18, 0]);

  // ---- jambes : moyeu de hanche (côté extérieur), genouillère, pied à semelle crantée et orteils d'acier
  for (const s of [-1, 1]) {
    const slot = s < 0 ? 'hipL' : 'hipR';
    const thigh = ellSurf([0, -0.3, 0], [1.02, 0.85, 1.02], s * Math.PI / 2 - 0.8, s * Math.PI / 2 + 0.8, -0.45, 0.42, 0.02, 'y');
    push(slot, 'plate', plate(thigh, 10, 8, 0.06));
    plateRivets(L(slot, 'steel'), thigh, ['b', 'g', 'd'], 3, 0.1, 0.04, 0.01);
    add(slot, 'steel', G.cyl(0.4, 0.44, 0.14, 18), [s * 1.0, 0.05, 0], [0, 0, Math.PI / 2]);
    add(slot, 'dark', G.cyl(0.2, 0.2, 0.1, 6), [s * 1.09, 0.05, 0], [0, 0, Math.PI / 2]);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      rivetAt(L(slot, 'steel'), [s * 1.08, 0.05 + Math.sin(a) * 0.3, Math.cos(a) * 0.3], new THREE.Vector3(s, 0, 0), 0.04);
    }
  }
  const knee = ellSurf([0, -0.05, 0], [0.82, 0.55, 0.82], -0.9, 0.9, -0.42, 0.42, 0, 'y');
  push('knee', 'plate', plate(knee, 10, 8, 0.06));
  plateRivets(L('knee', 'steel'), knee, ['h'], 4, 0.12, 0.04, 0.01);
  iciclesUnder(L('knee', 'ice'), knee, 5, R, 0.3);
  const greave = ellSurf([0, -0.55, 0], [0.82, 0.62, 0.82], -0.75, 0.75, -0.3, 0.32, 0, 'y');
  push('knee', 'plate', plate(greave, 10, 6, 0.05));
  add('knee', 'vorax', G.cyl(0.86, 0.86, 0.12, 22, true), [0, -0.8, 0]);
  add('knee', 'dark', G.cyl(0.88, 0.96, 0.26, 22), [0, -0.96, 0]);
  add('knee', 'dark', G.cyl(0.97, 0.94, 0.07, 22), [0, -1.11, 0]);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    add('knee', 'dark', G.box(0.2, 0.09, 0.26), [Math.cos(a) * 0.86, -1.15, Math.sin(a) * 0.86], [0, -a, 0]);
  }
  for (const a of [-0.65, -0.22, 0.22, 0.65]) add('knee', 'steel', TOE, [Math.sin(a) * 0.88, -1.06, Math.cos(a) * 0.88], [0, 0, 0], [1, 0.9, 1.25]);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    rivetAt(L('knee', 'steel'), [Math.cos(a) * 0.93, -0.92, Math.sin(a) * 0.93], new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), 0.04);
  }

  // fusion par emplacement et matériau
  const OUT = {};
  for (const slot in P) OUT[slot] = Object.entries(P[slot]).map(([k, list]) => { const g = bake(list); g.userData.shared = true; return [k, g]; });
  return OUT;
}
// contour : grosses pièces seulement
const OUTLINED = new Set(['plate', 'vorax', 'dark', 'drill', 'blued', 'hazard', 'gold', 'snow']);
const NO_SHADOW = new Set(['ice', 'heat', 'ember', 'lamp', 'decal', 'snow']);

// La fourrure vit toute seule (le comportement ne l'anime pas) et reste dessinée sous le matériau cloné du flash
function liveFur(fur) {
  if (!fur) return;
  const m0 = fur.material, before = fur.mesh.onBeforeRender;
  let last = 0;
  fur.mesh.onBeforeRender = (r, s, cam, geo, m) => {
    before(r, s, cam, geo, m === fur.mesh.material ? m0 : m);
    // une mise à jour par image (plusieurs rendus possibles), remise à zéro après une absence (terrier)
    const now = performance.now() / 1000, dt = now - last;
    if (dt < 0.004) return;
    last = now;
    if (dt > 0.25) fur.reset();
    else fur.update(dt);
  };
}

export function mammouth() {
  const { S, root, B, skin } = rig({
    hull: { color: '#5d6e92', rough: 0.4, metal: 0.45, sheen: 0.2, coat: 0.7 },
    hullD: { color: '#3d4763', rough: 0.5, metal: 0.55, coat: 0.3 },
    fur: { color: '#7a4a2e', rough: 0.88, sheen: 0.6, fur: 1 },
    furD: { color: '#4e2f1f', rough: 0.9, sheen: 0.5, fur: 1 },
    furL: { color: '#9a6440', rough: 0.85, sheen: 0.7, fur: 1 },
    frost: { color: '#e6f4ff', rough: 0.5, sheen: 0.8, fur: 0.85 },
    vorax: { color: C.vorax, rough: 0.35, metal: 0.5, coat: 0.6 },
    dark: { color: '#252033', rough: 0.45, metal: 0.65 },
  });
  const M = mats();
  M.heat = glow('#ff6a1a', 3);
  M.ember = glow('#ff7a2a', 2.2);
  M.lamp = glow('#ff3a2a', 3);
  if (!PARTS) PARTS = buildParts();
  const parts = (bone, slot) => {
    for (const [k, g] of PARTS[slot] || []) part(bone, g, M[k], { outline: OUTLINED.has(k) ? 0.03 : 0, shadow: !NO_SHADOW.has(k) });
  };

  // ---- corps
  const body = B(root, [0, 3.4, 0], 'body');
  S.add(body, { t: 'ell', r: [2.0, 1.7, 2.85], col: 'hull', k: 0.3 });
  S.add(body, { t: 'ell', r: [1.75, 1.05, 2.45], p: [0, -0.72, 0.05], col: 'hullD', k: 0.4 });
  // garrot haut et dos fuyant (silhouette de mammouth), collier de fourrure au cou
  S.add(body, { t: 'ell', r: [1.42, 1.3, 1.65], p: [0, 1.0, 0.95], col: 'fur', k: 0.6, fuzz: [0.05, 2.5] });
  S.add(body, { t: 'ell', r: [1.32, 1.0, 2.05], p: [0, 0.8, -0.95], col: 'fur', k: 0.6, fuzz: [0.05, 2.5] });
  S.add(body, { t: 'ell', r: [1.3, 1.2, 0.8], p: [0, 0.4, 2.15], col: 'fur', k: 0.5, fuzz: [0.05, 3] });
  // jupe de longs poils le long des flancs, sous les plaques
  for (const s of [-1, 1]) S.add(body, { t: 'ell', r: [0.32, 0.55, 2.2], p: [s * 1.72, -0.95, 0.05], col: 'furD', k: 0.35, fuzz: [0.06, 3.5] });
  S.paint(body, { t: 'ell', r: [1.5, 0.55, 1.3], p: [0, 2.25, 1.05], col: 'furL', feather: 0.35 });
  S.paint(body, { t: 'ell', r: [1.1, 0.35, 0.9], p: [0, 2.35, 1.1], col: 'frost', feather: 0.25 });
  S.paint(body, { t: 'ell', r: [0.6, 0.3, 0.5], p: [0.4, 1.75, -2.2], col: 'frost', feather: 0.2 });
  // tourelle du cœur : fût sombre qui sort de la fourrure, creusé d'une coupe
  S.add(body, { t: 'cyl', r: 0.95, h: 0.42, round: 0.1, p: [0, 1.82, -1.6], col: 'dark', k: 0.18 });
  S.sub(body, { t: 'sph', r: 0.8, p: [0, 2.4, -1.6], col: 'dark', k: 0.05 });
  // poitrail et ventre : joints de panneaux creusés
  for (let i = 0; i < 3; i++) S.sub(body, { t: 'box', s: [1.4, 0.025, 0.4], round: 0.01, p: [0, -1.35, -1.2 + i * 1.2], col: 'dark', k: 0.02 });
  // queue mécanique à houppe
  S.add(body, { t: 'cone', a: [0, 0.35, -2.7], b: [0, -0.45, -3.25], r1: 0.24, r2: 0.13, col: 'dark', k: 0.12 });
  for (let i = 0; i < 3; i++) S.add(body, { t: 'torus', R: 0.2 - i * 0.03, r: 0.06, p: [0, 0.15 - i * 0.25, -2.85 - i * 0.17], rot: [-0.6, 0, 0], col: i === 1 ? 'vorax' : 'hull', k: 0.03 });
  S.add(body, { t: 'ell', r: [0.2, 0.36, 0.2], p: [0, -0.7, -3.32], col: 'furD', k: 0.08, fuzz: [0.04, 6] });

  // ---- tête
  const head = B(body, [0, 0.6, 2.7], 'head');
  S.add(head, { t: 'ell', r: [1.3, 1.25, 1.2], col: 'hull', k: 0.3 });
  S.add(head, { t: 'ell', r: [1.2, 0.85, 1.0], p: [0, 0.72, -0.3], col: 'fur', k: 0.4, fuzz: [0.05, 3] });
  S.add(head, { t: 'ell', r: [0.85, 0.65, 0.75], p: [0, 1.05, -0.05], col: 'fur', k: 0.35, fuzz: [0.05, 3] });
  S.paint(head, { t: 'ell', r: [0.75, 0.3, 0.6], p: [0, 1.65, -0.1], col: 'frost', feather: 0.2 });
  for (const s of [-1, 1]) {
    // joues renflées qui portent les défenses, orbites froncées, oreilles
    S.add(head, { t: 'ell', r: [0.55, 0.6, 0.65], p: [s * 0.8, -0.4, 0.55], col: 'hull', k: 0.3 });
    S.sub(head, { t: 'ell', r: [0.27, 0.16, 0.22], p: [s * 0.52, 0.3, 1.02], rot: [0, 0, s * -0.3], col: 'dark', k: 0.06 });
    S.add(head, { t: 'ell', r: [0.2, 0.82, 0.66], p: [s * 1.22, 0.05, -0.25], col: 'fur', k: 0.2, fuzz: [0.04, 4] });
  }
  // mâchoire et bouche sous la trompe
  S.add(head, { t: 'ell', r: [0.6, 0.35, 0.5], p: [0, -0.85, 0.5], col: 'hullD', k: 0.25 });
  S.sub(head, { t: 'ell', r: [0.42, 0.08, 0.3], p: [0, -0.75, 0.88], col: 'dark', k: 0.06 });
  S.add(head, { t: 'cyl', r: 0.48, h: 0.2, round: 0.06, p: [0, -0.18, 1.0], rot: [Math.PI / 2, 0, 0], col: 'dark', k: 0.1 });

  // ---- trompe : segments annelés (bagues de coque sur âme sombre)
  const trunk = [];
  let tp = head;
  const tl = [[0, -0.2, 1.0], [0, -0.85, 0.15], [0, -0.8, 0.1]];
  const ax = Math.atan2(0.12, 0.85);
  tl.forEach((p, i) => {
    const seg = B(tp, p, 'trunk' + i);
    const r = 0.45 - i * 0.1;
    S.add(seg, { t: 'cone', a: [0, 0, 0], b: [0, -0.85, 0.12], r1: r - 0.06, r2: r - 0.13, col: 'dark', k: 0.1, skinSoft: 0.1 });
    for (let k = 0; k < 3; k++) {
      const t = 0.16 + k * 0.28;
      S.add(seg, { t: 'cyl', r: r - 0.02 - t * 0.08, h: 0.075, round: 0.05, p: [0, -0.85 * t, 0.12 * t], rot: [-ax, 0, 0], col: k === 1 ? 'vorax' : 'hull', k: 0.02, skinSoft: 0.1 });
    }
    trunk.push(seg);
    tp = seg;
  });

  // ---- jambes : cuisses à longs poils, tibias de coque
  const legs = [];
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const hip = B(body, [sx * 1.35, -1.1, sz * 1.9], 'hip');
    S.add(hip, { t: 'cone', a: [0, 0.4, 0], b: [0, -0.98, 0], r1: 0.88, r2: 0.68, col: 'fur', k: 0.3, fuzz: [0.06, 3], skinSoft: 0.15 });
    S.paint(hip, { t: 'cone', a: [0, -0.6, 0], b: [0, -1.0, 0], r1: 0.95, r2: 0.95, col: 'furD', feather: 0.25 });
    const knee = B(hip, [0, -1.2, 0], 'knee');
    S.add(knee, { t: 'cone', a: [0, 0, 0], b: [0, -0.9, 0], r1: 0.68, r2: 0.76, col: 'hull', k: 0.2, skinSoft: 0.15 });
    legs.push({ hip, knee, s: sx, front: sz > 0 });
  }
  const sk = skin('mammouth', { mesh: { cell: 0.065, skinSoft: 0.2, aoDist: 0.16 }, mat: { enemyRim: true, sheenColor: '#ffe2c0' }, outline: 0.03 });
  liveFur(addFur(sk, FUR_MAMMOUTH));

  // ---- pièces rigides
  parts(body, 'body');
  parts(head, 'head');
  trunk.forEach((t, i) => parts(t, 'trunk' + i));
  for (const L of legs) { parts(L.hip, L.s < 0 ? 'hipL' : 'hipR'); parts(L.knee, 'knee'); }
  // défenses-foreuses (tournent)
  const tusks = [];
  for (const s of [-1, 1]) {
    const t = joint(head, [s * 0.75, -0.55, 0.8]);
    t.rotation.set(-0.15, s * 0.35, 0);
    parts(t, 'tusk');
    const spin = joint(t, [0, 0, 0.2]);
    parts(spin, 'drill');
    tusks.push(spin);
  }
  // yeux rouges au fond des orbites
  for (const s of [-1, 1]) {
    part(head, G.sphere(0.17, 14, 10), glow('#ff4a2a', 2.8), { p: [s * 0.52, 0.28, 0.98], s: [1.2, 0.75, 0.8], shadow: false });
    part(head, G.sphere(0.04, 8, 6), glow('#fff2e0', 2), { p: [s * 0.52 + 0.06, 0.32, 1.12], shadow: false });
  }
  // bouche du canon de la trompe
  const nozzle = joint(trunk[2], [0, -0.9, 0.12]);
  parts(nozzle, 'nozzle');
  part(nozzle, G.torus(0.26, 0.05, 6, 18), glow('#7ff3ff', 2.6), { p: [0, -0.35, 0], r: [Math.PI / 2, 0, 0], shadow: false });
  part(nozzle, G.cyl(0.21, 0.21, 0.02, 14), glow('#bff8ff', 2), { p: [0, -0.3, 0], shadow: false });
  // cœur thermique (point faible) sous sa grille : noyau incandescent et halo
  const core = joint(body, [0, 2.35, -1.6]);
  part(core, G.ico(0.72, 3), glow('#ff7400', 1.5), { shadow: false });
  part(core, G.ico(0.42, 2), glow('#ffcc40', 2), { p: [0, 0.38, 0], shadow: false });
  root.traverse((o) => { if (o.isMesh && o.userData.isOutline) o.castShadow = false; });
  return { root, debrisColor: '#5d6e92', body, head, trunk, legs, tusks, nozzle, core, chunks: [tusks[0].parent, tusks[1].parent] };
}
