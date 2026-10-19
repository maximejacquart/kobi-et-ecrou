import * as THREE from 'three';
import { G, part, joint, bake, mtx } from '../geo.js';
import { mat, glow } from '../../engine/materials.js';
import { paintedMetalTexture, metalTexture, hazardTexture } from '../../engine/textures.js';
import { rng } from '../../engine/util.js';
import { addFur } from '../fur.js';
import { C, VORAX_PAL, rig } from './common.js';

// ===================================================================== Goinfrotron (boss final)
// Méga-aspirateur bipède piloté par le Baron : panse-cuve en tôle violette laquée (panneaux à joints creusés, rivets),
// bouche-turbine à vraies pales derrière une grille, bras-canons multitubes à ailettes de refroidissement,
// lance-missiles dorsaux à trappes ouvertes, réservoir rose (point faible) en cage dans le dos, cheminées
// d'échappement, jambes à vérins et pieds griffus ; le Baron trône sous le dôme du cockpit.

const TAU = Math.PI * 2;
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const _q = new THREE.Quaternion();
const _y = new THREE.Vector3(0, 1, 0);
const _z = new THREE.Vector3(0, 0, 1);

// ------------------------------------------------------------------ aides géométriques
// Tube effilé (rayon r0 → r1) le long d'une courbe passant par pts : durites, griffes, moustache, chaînette
function taper(pts, r0, r1 = r0, radial = 8, segs = 16) {
  const curve = new THREE.CatmullRomCurve3(pts.map(V));
  const fr = curve.computeFrenetFrames(segs, false);
  const pos = [], nor = [], uv = [], idx = [];
  const P = new THREE.Vector3(), N = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, r = r0 + (r1 - r0) * t;
    curve.getPointAt(t, P);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU;
      N.copy(fr.normals[i]).multiplyScalar(-Math.cos(a)).addScaledVector(fr.binormals[i], Math.sin(a)).normalize();
      pos.push(P.x + N.x * r, P.y + N.y * r, P.z + N.z * r);
      nor.push(N.x, N.y, N.z);
      uv.push(j / radial, t);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.userData.curve = curve;
  return g;
}
// Matrice : objet posé en p, son axe (Y par défaut) tourné vers n
function onN(p, n, s = 1, axis = _y) {
  _q.setFromUnitVectors(axis, V(n).normalize());
  return new THREE.Matrix4().compose(V(p), _q, typeof s === 'number' ? new THREE.Vector3(s, s, s) : V(s));
}
// Tête de rivet (calotte basse tournée vers +Y)
const RIVET = new THREE.SphereGeometry(1, 10, 3, 0, TAU, 0, Math.PI / 2).scale(1, 0.55, 1);
// UV en mètres par face dominante (bandes de danger raccordées sur des pièces de toutes tailles)
function uvMeters(geo, s) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const p = g.attributes.position, n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const [u, v] = ax > ay && ax > az ? [p.getZ(i), p.getY(i)] : ay > az ? [p.getX(i), p.getZ(i)] : [p.getX(i), p.getY(i)];
    uv[i * 2] = u * s; uv[i * 2 + 1] = v * s;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
// Bande cylindrique ouverte (axe Y) aux UV étirés : n tuiles sur le tour
function band(r, h, n, seg = 40) {
  const g = new THREE.CylinderGeometry(r, r, h, seg, 1, true);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * n, uv.getY(i) * h * n / (TAU * r));
  return g;
}
// Pale de turbine vrillée (racine → bout le long de +Y), corde qui s'élargit, bout recourbé
function bladeGeo() {
  const N = 6, pos = [], sec = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, r = 0.4 + t * 0.98, c = 0.46 + t * 0.2, a = 0.85 - t * 0.4, th = 0.06 - t * 0.025, sw = t * t * 0.16;
    const cs = Math.cos(a), sn = Math.sin(a);
    sec.push([[-c / 2, -th / 2], [c / 2, -th / 2], [c / 2, th / 2], [-c / 2, th / 2]].map(([u, w]) => [u * cs + w * sn + sw, r, -u * sn + w * cs]));
  }
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  for (let i = 0; i < N; i++) for (let k = 0; k < 4; k++) {
    const a = sec[i][k], b = sec[i][(k + 1) % 4], c = sec[i + 1][(k + 1) % 4], d = sec[i + 1][k];
    tri(a, c, b); tri(a, d, c);
  }
  const e = sec[N];
  tri(e[0], e[2], e[1]); tri(e[0], e[3], e[2]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// Lot de pièces rigides d'un os, fusionnées par matériau ; géométrie calculée une fois par clé (kit.fresh)
const KITS = new Map();
function kit(key) {
  const cached = KITS.get(key);
  const lists = {};
  return {
    fresh: !cached,
    add(m, geo, p, r, s) {
      (lists[m] ||= []).push([geo, p && p.isMatrix4 ? p : mtx(p, r, s)]);
      return this;
    },
    // pose les maillages fusionnés sur l'os ; o.outline : { matériau: épaisseur }
    done(bone, MT, o = {}) {
      let geos = cached;
      if (!geos) {
        geos = {};
        for (const m in lists) { geos[m] = bake(lists[m]); geos[m].userData.shared = true; }
        KITS.set(key, geos);
      }
      const out = {};
      for (const m in geos) {
        const lit = !/^(glow|glass|tank|lens)/.test(m);
        out[m] = part(bone, geos[m], MT[m], { shadow: lit, outline: o.outline?.[m] });
      }
      return out;
    },
  };
}
// Durite annelée : tuyau souple, nervures, colliers d'acier aux deux bouts
function hose(kt, pts, r, step = 0.2) {
  const g = taper(pts, r, r, 8, Math.max(8, pts.length * 6));
  kt.add('rubber', g);
  const curve = g.userData.curve, len = curve.getLength();
  const n = Math.max(1, Math.floor(len / step));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    kt.add('rubber', G.torus(r, r * 0.3, 4, 10), onN(curve.getPointAt(t), curve.getTangentAt(t), 1, _z));
  }
  for (const t of [0.03, 0.97]) kt.add('steel', G.torus(r * 1.05, r * 0.38, 5, 12), onN(curve.getPointAt(t), curve.getTangentAt(t), 1, _z));
}
// Vérin hydraulique : fourreau sombre, tige chromée, rotules
function ram(kt, a, b, r, split = 0.55) {
  const A = V(a), B_ = V(b), M_ = A.clone().lerp(B_, split);
  const d = B_.clone().sub(A), len = d.length();
  d.normalize();
  kt.add('plateD', G.cyl(r, r, len * split, 10), onN(A.clone().lerp(M_, 0.5), d));
  kt.add('steel', G.cyl(r * 0.55, r * 0.55, len * (1 - split) + r, 8), onN(M_.clone().lerp(B_, 0.5), d));
  kt.add('steel', G.torus(r * 1.02, r * 0.25, 4, 10), onN(M_, d, 1, _z));
  for (const p of [A, B_]) kt.add('gun', G.sphere(r * 1.1, 8, 6), p.toArray());
}

// ------------------------------------------------------------------ coque de la panse (réplique du champ sculpté)
// Mêmes formes que la sculpture : sert à creuser les joints et à poser rivets et pièces au ras de la tôle.
const SHELL = [
  { t: 'cone', a: [0, 0.2, 0], b: [0, 1.6, 0], r1: 1.9, r2: 2.95, k: 0.5, col: 'vorax' },
  { t: 'ell', p: [0, 2.35, 0], r: [3.2, 2.1, 2.8], k: 0.5, col: 'vorax' },
  { t: 'ell', p: [0, 3.9, -0.05], r: [2.45, 0.95, 2.15], k: 0.35, col: 'white' },
];
const FAR = 0.525; // valeur de départ du champ de la sculpture (k max × 1,05)
function sdEll(x, y, z, r) {
  const k0 = Math.hypot(x / r[0], y / r[1], z / r[2]);
  const k1 = Math.hypot(x / (r[0] * r[0]), y / (r[1] * r[1]), z / (r[2] * r[2]));
  return k1 < 1e-9 ? -Math.min(...r) : (k0 * (k0 - 1)) / k1;
}
function sdCone(px, py, pz, s) {
  const [ax, ay, az] = s.a, [bx, by, bz] = s.b;
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const l2 = bax * bax + bay * bay + baz * baz, rr = s.r1 - s.r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const y = pax * bax + pay * bay + paz * baz, z = y - l2;
  const xx = pax * l2 - bax * y, xy = pay * l2 - bay * y, xz = paz * l2 - baz * y;
  const x2 = xx * xx + xy * xy + xz * xz, y2 = y * y * l2, z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - s.r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - s.r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - s.r1;
}
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
function shellD(x, y, z) {
  let f = FAR;
  for (const s of SHELL) f = smin(f, s.t === 'ell' ? sdEll(x - s.p[0], y - s.p[1], z - s.p[2], s.r) : sdCone(x, y, z, s), s.k);
  return f;
}
// point de la coque sur le rayon issu de o (direction d), et normale
function onShell(o, d) {
  let lo = 0, hi = 6;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; (shellD(o[0] + d[0] * m, o[1] + d[1] * m, o[2] + d[2] * m) < 0 ? (lo = m) : (hi = m)); }
  const p = [o[0] + d[0] * lo, o[1] + d[1] * lo, o[2] + d[2] * lo], e = 0.01;
  const n = [
    shellD(p[0] + e, p[1], p[2]) - shellD(p[0] - e, p[1], p[2]),
    shellD(p[0], p[1] + e, p[2]) - shellD(p[0], p[1] - e, p[2]),
    shellD(p[0], p[1], p[2] + e) - shellD(p[0], p[1], p[2] - e),
  ];
  const l = Math.hypot(...n);
  return { p, n: n.map((v) => v / l) };
}
const ring = (y, th) => onShell([0, y, 0], [Math.sin(th), 0, Math.cos(th)]);
const meridian = (th, ph) => onShell([0, 2.35, 0], [Math.cos(ph) * Math.sin(th), Math.sin(ph), Math.cos(ph) * Math.cos(th)]);
const deg = (d) => (d * Math.PI) / 180;
// point (et normale) d'un ellipsoïde de rayons r, centre c, tourné (Euler rot) : rivets et écussons au ras des plaques
function ellAt(c, r, rot, th, ph) {
  const e = new THREE.Euler(...rot);
  const u = [Math.cos(ph) * Math.sin(th), Math.sin(ph), Math.cos(ph) * Math.cos(th)];
  const p = new THREE.Vector3(r[0] * u[0], r[1] * u[1], r[2] * u[2]).applyEuler(e).add(V(c));
  const n = new THREE.Vector3(u[0] / r[0], u[1] / r[1], u[2] / r[2]).applyEuler(e).normalize();
  return { p: p.toArray(), n: n.toArray() };
}
const THIGH = { r: [0.66, 0.82, 0.55], p: [0.14, -0.72, 0.16], ry: 0.45 };
const angDist = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

// ------------------------------------------------------------------ matières
let MATS = null;
function gfMats() {
  if (MATS) return MATS;
  const plate = paintedMetalTexture(C.vorax, 'gf-plate', { chip: 0.3, edge: 0.8, rust: 0.05, bare: '#c4bdd4' });
  const plateD = paintedMetalTexture(C.voraxD, 'gf-plateD', { chip: 0.25, edge: 0.7, rust: 0.08, bare: '#b9b2c8' });
  const dark = metalTexture('#4a4460', 'gf-dark', { grid: 2, rust: 0.15 });
  const haz = hazardTexture();
  MATS = {
    plate: mat('#ffffff', { map: plate.map, normalMap: plate.normalMap, rough: 0.38, metal: 0.45, coat: 0.75, coatRough: 0.08 }),
    plateD: mat('#ffffff', { map: plateD.map, normalMap: plateD.normalMap, rough: 0.42, metal: 0.5, coat: 0.5 }),
    dark: mat('#ffffff', { map: dark.map, normalMap: dark.normalMap, rough: 0.5, metal: 0.55 }),
    gold: mat(C.gold, { rough: 0.26, metal: 0.9, coat: 0.35 }),
    steel: mat('#c9cfde', { rough: 0.2, metal: 1 }),
    gun: mat('#3b3548', { rough: 0.32, metal: 0.85 }),
    heat: mat('#5a5a8e', { rough: 0.28, metal: 0.95 }), // acier bleui par la chaleur
    rubber: mat('#231c2a', { rough: 0.78, metal: 0.05 }),
    soot: mat('#0f0b12', { rough: 0.95 }),
    hazard: mat('#ffffff', { map: haz.map, normalMap: haz.normalMap, rough: 0.5, metal: 0.3 }),
    red: mat('#e8343a', { rough: 0.35, metal: 0.3, coat: 0.8 }),
    cream: mat('#f2ece0', { rough: 0.4, metal: 0.2 }),
    velvet: mat('#7a1f5a', { rough: 0.85, sheen: 1, sheenColor: '#ff9ad8' }),
    plaque: mat('#ffffff', { map: plaqueTexture(), rough: 0.35, metal: 0.6 }),
    emblem: mat('#ffffff', { map: emblemTexture(), rough: 0.3, metal: 0.7 }),
    glass: mat('#c8b4ff', { rough: 0.03, metal: 0, transparent: true, opacity: 0.1 }),
    tank: mat('#ff9ad0', { rough: 0.04, metal: 0.1, emissive: '#6a1a4a', emissiveIntensity: 0.5, transparent: true, opacity: 0.35 }),
    rivet: mat(C.vorax, { rough: 0.32, metal: 0.5, coat: 0.8 }),
    glowP: glow('#ff4fa0', 2.5),
    glowPs: glow('#ff4fa0', 1.4),
    glowA: glow('#ffb03a', 3),
    glowR: glow('#ff3a2a', 3),
    glowS: glow('#6affc0', 1.8),
  };
  return MATS;
}
// Plaque du constructeur : « VORAX » en lettres d'or sur tôle violette brossée, cadre riveté
let plaqueTex = null;
function plaqueTexture() {
  if (plaqueTex) return plaqueTex;
  const W = 512, H = 176, R = rng(17);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const bg = x.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#3e1878'); bg.addColorStop(1, '#22104a');
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  for (let i = 0; i < 500; i++) { x.fillStyle = `rgba(255,255,255,${R() * 0.05})`; x.fillRect(R() * W, R() * H, 20 + R() * 90, 1); }
  x.strokeStyle = '#ffcc33'; x.lineWidth = 12; x.strokeRect(8, 8, W - 16, H - 16);
  x.strokeStyle = '#7a5a10'; x.lineWidth = 2; x.strokeRect(18, 18, W - 36, H - 36);
  for (const [px, py] of [[34, 34], [W - 34, 34], [34, H - 34], [W - 34, H - 34]]) {
    const g = x.createRadialGradient(px - 3, py - 3, 1, px, py, 9);
    g.addColorStop(0, '#fff6c0'); g.addColorStop(1, '#a07818');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, 9, 0, TAU); x.fill();
  }
  x.font = 'bold 112px Georgia, "Times New Roman", serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = '#1a0a24'; x.fillText('VORAX', W / 2 + 5, H / 2 + 11);
  const tg = x.createLinearGradient(0, 40, 0, 140);
  tg.addColorStop(0, '#fff2a8'); tg.addColorStop(0.5, '#ffcc33'); tg.addColorStop(1, '#b07a10');
  x.fillStyle = tg; x.fillText('VORAX', W / 2, H / 2 + 6);
  // usure : éclats sombres et rayures claires
  for (let i = 0; i < 70; i++) { x.fillStyle = `rgba(16,8,24,${R() * 0.3})`; x.beginPath(); x.arc(R() * W, R() * H, 1 + R() * 7, 0, TAU); x.fill(); }
  x.strokeStyle = 'rgba(255,240,220,0.25)'; x.lineWidth = 1;
  for (let i = 0; i < 14; i++) { const a = R() * W, b = R() * H; x.beginPath(); x.moveTo(a, b); x.lineTo(a + 20 + R() * 50, b + (R() - 0.5) * 20); x.stroke(); }
  plaqueTex = new THREE.CanvasTexture(c);
  plaqueTex.colorSpace = THREE.SRGBColorSpace; plaqueTex.anisotropy = 8; plaqueTex.userData.shared = true;
  return plaqueTex;
}
// Écusson du Baron (dessus des disques) : V d'or sous une couronne, dans un cercle doré
let emblemTex = null;
function emblemTexture() {
  if (emblemTex) return emblemTex;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = '#ffcc33'; x.fillRect(0, 0, S, S);
  const bg = x.createRadialGradient(S / 2, S / 2, 10, S / 2, S / 2, S * 0.42);
  bg.addColorStop(0, '#5a24a8'); bg.addColorStop(1, '#2a0f5a');
  x.fillStyle = bg; x.beginPath(); x.arc(S / 2, S / 2, S * 0.4, 0, TAU); x.fill();
  x.strokeStyle = '#8a6010'; x.lineWidth = 4; x.beginPath(); x.arc(S / 2, S / 2, S * 0.4, 0, TAU); x.stroke();
  x.fillStyle = '#ffcc33';
  x.beginPath(); // V
  x.moveTo(62, 92); x.lineTo(104, 92); x.lineTo(128, 160); x.lineTo(152, 92); x.lineTo(194, 92); x.lineTo(142, 206); x.lineTo(114, 206);
  x.closePath(); x.fill();
  x.beginPath(); // couronne
  x.moveTo(84, 78); x.lineTo(90, 46); x.lineTo(108, 64); x.lineTo(128, 38); x.lineTo(148, 64); x.lineTo(166, 46); x.lineTo(172, 78);
  x.closePath(); x.fill();
  x.strokeStyle = '#8a6010'; x.lineWidth = 3; x.stroke();
  emblemTex = new THREE.CanvasTexture(c);
  emblemTex.colorSpace = THREE.SRGBColorSpace; emblemTex.anisotropy = 8; emblemTex.userData.shared = true;
  return emblemTex;
}

// palette sculptée : robots du Baron + joints, crasse, éclats de peinture, caoutchouc
const PAL = {
  ...VORAX_PAL,
  dark: { color: '#2a2238', rough: 0.42, metal: 0.65, coat: 0.15 },
  seam: { color: '#140c1e', rough: 0.6, metal: 0.3 },
  grime: { color: '#3a2e34', rough: 0.85, metal: 0.15 },
  soot: { color: '#1a1418', rough: 0.9, metal: 0.1 },
  chip: { color: '#bdb6cc', rough: 0.3, metal: 0.9 },
  rubber: { color: '#221b28', rough: 0.8, metal: 0.05 },
};

export function goinfrotron() {
  const MT = gfMats();
  const { S, root, B, skin } = rig(PAL);
  const R = rng(11);
  // ------------------------------------------------ bassin (sous la panse) et rotules des hanches
  const hips = B(root, [0, 4.2, 0], 'hips');
  S.add(hips, { t: 'ell', r: [2.1, 0.95, 1.7], col: 'dark', k: 0.2 });
  for (const s of [-1, 1]) S.add(hips, { t: 'sph', r: 0.78, p: [s * 1.6, -0.55, 0], col: 'dark', k: 0.25 });
  S.add(hips, { t: 'box', s: [0.7, 0.5, 0.2], round: 0.16, p: [0, -0.5, 1.55], rot: [0.35, 0, 0], col: 'voraxD', k: 0.12 });
  // ------------------------------------------------ panse-cuve
  const torso = B(hips, [0, 0.8, 0], 'torso');
  for (const s of SHELL) S.add(torso, s.t === 'ell' ? { t: 'ell', r: s.r, p: s.p, col: s.col, k: s.k } : { ...s });
  // joints de panneaux creusés : deux ceintures et des méridiens en quinconce
  const GR = 0.085;
  const groove = (pts) => { for (let i = 0; i < pts.length - 1; i++) S.sub(torso, { t: 'cone', a: pts[i].p, b: pts[i + 1].p, r1: GR, r2: GR, col: 'seam', k: 0.04 }); };
  const ringPts = (y, skip) => {
    const runs = [];
    let cur = [];
    for (let d = 0; d <= 360; d += 8) {
      if (skip(d % 360)) { if (cur.length > 1) runs.push(cur); cur = []; continue; }
      cur.push(ring(y, deg(d)));
    }
    if (cur.length > 1) runs.push(cur);
    return runs;
  };
  const skipA = (d) => angDist(d, 0) < 40 || angDist(d, 180) < 30;
  const skipB = (d) => angDist(d, 0) < 32 || angDist(d, 180) < 26 || angDist(d, 90) < 16 || angDist(d, 270) < 16;
  for (const run of ringPts(1.25, skipA)) groove(run);
  for (const run of ringPts(3.25, skipB)) groove(run);
  const mer = (thD, y0, y1) => {
    const pts = [];
    for (let i = 0; i <= 6; i++) {
      const y = y0 + ((y1 - y0) * i) / 6;
      pts.push(meridian(deg(thD), Math.asin(Math.max(-0.98, Math.min(0.98, (y - 2.35) / 2.3)))));
    }
    groove(pts);
  };
  for (const s of [-1, 1]) {
    for (const th of [55, 100, 145]) mer(s * th, 1.25, 3.25);
    for (const th of [78, 122]) mer(s * th, -0.9, 1.25);
    for (const th of [68, 128]) mer(s * th, 3.25, 4.6);
  }
  mer(180, -0.9, 0.9);
  // bossages : épaules, dos (logement du réservoir), bouche, col du cockpit
  for (const s of [-1, 1]) S.add(torso, { t: 'cyl', r: 0.95, h: 0.42, round: 0.16, p: [s * 3.0, 3.0, 0], rot: [0, 0, Math.PI / 2], col: 'dark', k: 0.25 });
  S.add(torso, { t: 'cyl', r: 1.45, h: 0.4, round: 0.18, p: [0, 2.25, -2.62], rot: [Math.PI / 2, 0, 0], col: 'voraxD', k: 0.25 });
  S.sub(torso, { t: 'cyl', r: 1.15, h: 0.6, round: 0.1, p: [0, 2.25, -3.2], rot: [Math.PI / 2, 0, 0], col: 'black', k: 0.06 });
  S.add(torso, { t: 'cyl', r: 1.8, h: 0.45, round: 0.2, p: [0, 1.7, 2.6], rot: [Math.PI / 2, 0, 0], col: 'voraxD', k: 0.3 });
  S.sub(torso, { t: 'cyl', r: 1.42, h: 1.2, round: 0.08, p: [0, 1.7, 3.25], rot: [Math.PI / 2, 0, 0], col: 'black', k: 0.05 });
  // capot au-dessus de la bouche (sourcil buté)
  S.add(torso, { t: 'box', s: [1.55, 0.18, 0.5], round: 0.14, p: [0, 3.55, 2.45], rot: [0.55, 0, 0], col: 'voraxD', k: 0.14 });
  S.add(torso, { t: 'cyl', r: 1.62, h: 0.22, round: 0.1, p: [0, 4.62, 0.3], col: 'dark', k: 0.25 });
  S.sub(torso, { t: 'cyl', r: 1.4, h: 0.8, round: 0.05, p: [0, 4.95, 0.3], col: 'black', k: 0.04 });
  // ------------------------------------------------ bras-canons
  const arms = [];
  // repos de l'avant-bras (coude plié vers l'avant : les canons visent devant)
  const FORE = new THREE.Matrix4().compose(V([0, -1.8, 0]), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.6, 0, 0)), V([1, 1, 1]));
  for (const s of [-1, 1]) {
    const sh = B(torso, [s * 3.4, 3.0, 0], s < 0 ? 'shL' : 'shR');
    S.add(sh, { t: 'sph', r: 0.82, col: 'dark', k: 0.2 });
    // épaulière : coque inclinée vers l'extérieur, crête dorée, lame inférieure
    S.add(sh, { t: 'ell', r: [1.2, 0.62, 1.3], p: [s * 0.3, 0.45, 0], rot: [0, 0, s * -0.35], col: 'vorax', k: 0.05 });
    S.add(sh, { t: 'box', s: [0.1, 0.16, 0.95], round: 0.08, p: [s * 0.12, 1.02, 0], rot: [0, 0, s * -0.35], col: 'gold', k: 0.06 });
    S.add(sh, { t: 'ell', r: [0.95, 0.4, 1.12], p: [s * 0.82, -0.12, 0], rot: [0, 0, s * -0.75], col: 'voraxD', k: 0.04 });
    const up = B(sh, [0, 0, 0], s < 0 ? 'upL' : 'upR', [0, 0, s * 0.25]);
    S.add(up, { t: 'cone', a: [0, -0.2, 0], b: [0, -1.6, 0], r1: 0.5, r2: 0.45, col: 'dark', k: 0.1, skinSoft: 0.1 });
    S.add(up, { t: 'ell', r: [0.6, 0.7, 0.62], p: [s * 0.08, -0.9, -0.05], col: 'vorax', k: 0.06, skinSoft: 0.1 });
    S.sub(up, { t: 'torus', R: 0.6, r: 0.04, p: [s * 0.08, -0.9, -0.05], sc: [1, 1, 1.03], col: 'seam', k: 0.01 });
    S.add(up, { t: 'sph', r: 0.56, p: [0, -1.8, 0], col: 'dark', k: 0.1, skinSoft: 0.1 });
    const fore = B(up, [0, -1.8, 0], s < 0 ? 'foreL' : 'foreR', [-0.6, 0, 0]);
    S.add(fore, { t: 'cyl', r: 0.6, h: 0.25, round: 0.1, p: [0, -0.2, 0], col: 'dark', k: 0.1, skinSoft: 0.1 });
    S.add(fore, { t: 'cyl', r: 0.88, h: 0.78, round: 0.3, p: [0, -1.05, 0], col: 'vorax', k: 0.12, skinSoft: 0.1 });
    for (const y of [-0.78, -1.32]) S.sub(fore, { t: 'torus', R: 0.88, r: 0.045, p: [0, y, 0], col: 'seam', k: 0.01 });
    S.add(fore, { t: 'cyl', r: 0.68, h: 0.12, round: 0.05, p: [0, -1.88, 0], col: 'dark', k: 0.06, skinSoft: 0.1 });
    arms.push({ sh, up, fore, s });
  }
  // ------------------------------------------------ jambes
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = B(hips, [s * 1.6, -0.6, 0], s < 0 ? 'hipL' : 'hipR');
    S.add(hip, { t: 'cone', a: [0, -0.05, 0], b: [0, -1.5, 0], r1: 0.55, r2: 0.45, col: 'dark', k: 0.12, skinSoft: 0.08 });
    // cuissard bombé (devant et côté), joint creusé
    S.add(hip, { t: 'ell', r: THIGH.r, p: [s * THIGH.p[0], THIGH.p[1], THIGH.p[2]], rot: [0, s * THIGH.ry, 0], col: 'vorax', k: 0.05, skinSoft: 0.08 });
    S.sub(hip, { t: 'torus', R: THIGH.r[0], r: 0.045, p: [s * THIGH.p[0], THIGH.p[1], THIGH.p[2]], rot: [0, s * THIGH.ry, 0], sc: [1, 1, THIGH.r[2] / THIGH.r[0]], col: 'seam', k: 0.01 });
    const knee = B(hip, [0, -1.6, 0], s < 0 ? 'kneeL' : 'kneeR');
    S.add(knee, { t: 'sph', r: 0.55, col: 'dark', k: 0.1, skinSoft: 0.08 });
    S.add(knee, { t: 'ell', r: [0.46, 0.46, 0.28], p: [0, 0.08, 0.42], col: 'vorax', k: 0.04, skinSoft: 0.08 });
    // tibia évasé, plaque avant, bague de cheville
    S.add(knee, { t: 'cone', a: [0, -0.25, 0], b: [0, -1.25, 0], r1: 0.52, r2: 0.64, col: 'vorax', k: 0.1, skinSoft: 0.08 });
    S.sub(knee, { t: 'torus', R: 0.58, r: 0.04, p: [0, -0.75, 0], col: 'seam', k: 0.01 });
    S.add(knee, { t: 'box', s: [0.36, 0.5, 0.16], round: 0.12, p: [0, -0.8, 0.58], rot: [0.12, 0, 0], col: 'voraxD', k: 0.06, skinSoft: 0.08 });
    S.add(knee, { t: 'torus', R: 0.62, r: 0.12, p: [0, -1.33, 0], col: 'dark', k: 0.04, skinSoft: 0.08 });
    // pied : semelle, talon, trois orteils à capuchons de tôle
    const foot = B(knee, [0, -1.6, 0], s < 0 ? 'footL' : 'footR');
    S.add(foot, { t: 'sph', r: 0.48, p: [0, 0.05, 0], col: 'dark', k: 0.1, skinSoft: 0.08 });
    S.add(foot, { t: 'box', s: [0.75, 0.28, 0.75], round: 0.22, p: [0, -0.14, 0.15], col: 'dark', k: 0.14, skinSoft: 0.08 });
    S.add(foot, { t: 'ell', r: [0.42, 0.26, 0.36], p: [0, -0.16, -0.5], col: 'dark', k: 0.12, skinSoft: 0.08 });
    for (const x of [-1, 0, 1]) {
      S.add(foot, { t: 'box', s: [0.2, 0.2, 0.36], round: 0.17, p: [x * 0.5, -0.2, 0.85], rot: [0, x * 0.3, 0], col: 'dark', k: 0.1, skinSoft: 0.08 });
      S.add(foot, { t: 'ell', r: [0.24, 0.18, 0.3], p: [x * 0.52, -0.1, 0.92], rot: [0.15, x * 0.3, 0], col: 'vorax', k: 0.05, skinSoft: 0.08 });
    }
    // crasse : pieds et bas des tibias
    S.paint(foot, { t: 'box', s: [1.1, 0.5, 1.6], p: [0, -0.15, 0.2], col: 'grime', feather: 0.3, fuzz: [0.12, 2.5] });
    S.paint(knee, { t: 'ell', r: [1.0, 0.6, 1.0], p: [0, -1.45, 0], col: 'grime', feather: 0.35, fuzz: [0.12, 3] });
    legs.push({ hip, knee, foot, s });
  }
  // ------------------------------------------------ peinture : bas sombre, galons, éclats, crasse
  S.paint(torso, { t: 'cone', a: [0, 0.2, 0], b: [0, 1.25, 0], r1: 2.0, r2: 3.05, col: 'voraxD', feather: 0.03 });
  S.paint(torso, { t: 'box', s: [1.7, 0.09, 0.12], p: [0, 3.29, 2.88], rot: [0.55, 0, 0], col: 'gold', feather: 0.015 });
  S.paint(torso, { t: 'torus', R: 1.8, r: 0.07, p: [0, 1.7, 3.0], rot: [Math.PI / 2, 0, 0], col: 'gold', feather: 0.015 });
  // griffures (trois coups de clé de Kobi) et éclats aux arêtes
  for (let i = 0; i < 3; i++) S.paint(torso, { t: 'box', s: [0.025, 0.42, 0.3], p: [-2.75 + i * 0.05, 2.1 + i * 0.12, 1.45 - i * 0.12], rot: [0.2, -1.05, 0.5], col: 'chip', feather: 0.01 });
  for (let i = 0; i < 16; i++) {
    const th = R() * TAU, y = 1.25 + (R() - 0.5) * 0.3;
    const q = ring(y, th).p;
    S.paint(torso, { t: 'sph', r: 0.05 + R() * 0.07, p: q, col: 'chip', feather: 0.015, fuzz: [0.03, 9] });
  }
  for (let i = 0; i < 14; i++) {
    const a = R() * TAU;
    S.paint(torso, { t: 'sph', r: 0.06 + R() * 0.06, p: [Math.cos(a) * 1.8, 1.7 + Math.sin(a) * 1.8, 3.0], col: 'chip', feather: 0.015, fuzz: [0.03, 9] });
  }
  S.paint(torso, { t: 'sph', r: 2.2, p: [0, -0.9, 0], col: 'grime', feather: 0.6, fuzz: [0.25, 1.6] });
  for (const s of [-1, 1]) S.paint(torso, { t: 'ell', r: [0.5, 0.9, 0.5], p: [s * 2.55, 3.6, -1.75], col: 'soot', feather: 0.35, fuzz: [0.12, 3] });
  for (const a of arms) for (let i = 0; i < 6; i++) {
    const th = R() * TAU;
    S.paint(a.fore, { t: 'sph', r: 0.05 + R() * 0.05, p: [Math.cos(th) * 0.88, -0.5 - R() * 1.1, Math.sin(th) * 0.88], col: 'chip', feather: 0.012, fuzz: [0.02, 12] });
  }
  skin('goinfrotron', { mesh: { cell: 0.068, skinSoft: 0.15, aoDist: 0.18, colorSoft: 0.02 }, mat: { enemyRim: true }, outline: 0.03 });

  // ================================================= pièces rigides
  // ------------------------------------------------ panse : rivets, plaque, cheminées, réservoir et sa cage
  const kt = kit('gf-torso');
  if (kt.fresh) {
    const riv = (q, r = 0.075) => kt.add('rivet', RIVET, onN(q.p.map((v, i) => v - q.n[i] * 0.012), q.n, r));
    for (const [y, skip] of [[1.08, skipA], [1.42, skipA], [3.08, skipB], [3.42, skipB]]) {
      for (let d = 4; d < 360; d += 10) if (!skip(d)) riv(ring(y, deg(d)));
    }
    for (const s of [-1, 1]) for (const th of [55, 100, 145]) for (let i = 1; i < 6; i++) {
      const y = 1.25 + (2.0 * i) / 6;
      riv(meridian(deg(s * th + 4), Math.asin((y - 2.35) / 2.3)), 0.065);
    }
    // plaque du constructeur sous la bouche
    const pl = ring(-0.45, 0);
    kt.add('gold', G.rbox(1.62, 0.62, 0.08, 0.03, 2), onN(pl.p.map((v, i) => v + pl.n[i] * 0.01), pl.n, 1, _z));
    kt.add('plaque', new THREE.PlaneGeometry(1.5, 0.5), onN(pl.p.map((v, i) => v + pl.n[i] * 0.052), pl.n, 1, _z));
    for (const sx of [-0.72, 0.72]) for (const sy of [-0.22, 0.22]) {
      const m = onN(pl.p, pl.n, 1, _z).multiply(new THREE.Matrix4().compose(V([sx, sy, 0.05]), _q.setFromAxisAngle(V([1, 0, 0]), Math.PI / 2), V([0.035, 0.035, 0.035])));
      kt.add('gold', RIVET, m);
    }
    // cheminées d'échappement (bagues, bout bleui, chapeau, suie)
    for (const s of [-1, 1]) {
      const x = s * 2.55, z = -1.6;
      kt.add('dark', G.cyl(0.27, 0.3, 2.6, 16), [x, 3.25, z - 0.12], [-0.12, 0, 0]);
      // coude qui rentre dans la panse, bride dorée
      const el = taper([[x, 2.1, -1.58], [x, 1.85, -1.54], [x * 0.97, 1.66, -1.42], [x * 0.9, 1.5, -1.18]], 0.3, 0.3, 14, 10);
      kt.add('dark', el);
      const ec = el.userData.curve;
      kt.add('gold', G.torus(0.31, 0.06, 6, 18), onN(ec.getPointAt(0.8).toArray(), ec.getTangentAt(0.8).toArray(), 1, _z));
      kt.add('heat', G.cyl(0.3, 0.28, 0.6, 16), [x, 4.82, z - 0.32], [-0.12, 0, 0]);
      kt.add('soot', G.cyl(0.24, 0.24, 0.05, 14), [x, 5.13, z - 0.36], [-0.12, 0, 0]);
      kt.add('steel', G.torus(0.3, 0.05, 5, 16), [x, 4.5, z - 0.28], [Math.PI / 2 - 0.12, 0, 0]);
      kt.add('gold', G.torus(0.31, 0.055, 5, 16), [x, 2.6, z - 0.04], [Math.PI / 2 - 0.12, 0, 0]);
      kt.add('steel', G.torus(0.3, 0.045, 5, 16), [x, 3.6, z - 0.17], [Math.PI / 2 - 0.12, 0, 0]);
      // pare-pluie à charnière, entrouvert
      kt.add('heat', G.cyl(0.36, 0.36, 0.04, 16), [x, 5.3, z - 0.62], [-0.9, 0, 0]);
      kt.add('dark', G.box(0.08, 0.2, 0.06), [x, 5.18, z - 0.62], [-0.3, 0, 0]);
      // colliers de fixation sur la panse
      kt.add('dark', G.box(0.2, 0.12, 0.5), [x, 2.3, z + 0.18], [-0.12, 0, 0]);
    }
    // logement du réservoir : bague dorée, boulons, réservoir de verre et cage
    const zc = -3.05, yc = 2.25;
    kt.add('gold', G.torus(1.32, 0.11, 8, 36), [0, yc, -3.02]);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      kt.add('steel', G.cyl(0.07, 0.07, 0.08, 6), [Math.cos(a) * 1.3, yc + Math.sin(a) * 1.3, -3.14], [Math.PI / 2, 0, 0]);
    }
    kt.add('tank', G.capsule(0.98, 0.7, 6, 20), [0, yc, zc - 0.05]);
    for (const dy of [-1, 1]) {
      kt.add('dark', G.cyl(0.85, 1.0, 0.22, 20), [0, yc + dy * 1.38, zc - 0.05], [dy < 0 ? Math.PI : 0, 0, 0]);
      kt.add('gold', G.torus(1.12, 0.06, 6, 28), [0, yc + dy * 0.75, zc - 0.05], [Math.PI / 2, 0, 0]);
    }
    kt.add('gold', G.torus(1.12, 0.06, 6, 28), [0, yc, zc - 0.05], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * (0.06 + (0.88 * i) / 6) + Math.PI; // barreaux côté extérieur (vers -z)
      kt.add('gold', G.cyl(0.055, 0.055, 2.6, 6), [Math.cos(a) * 1.12, yc, zc - 0.05 + Math.sin(a) * 1.12]);
    }
    // durites du réservoir vers le haut du dos
    for (const s of [-1, 1]) hose(kt, [[s * 0.45, yc + 1.45, zc + 0.1], [s * 0.7, yc + 2.0, zc + 0.15], [s * 0.95, 4.0, -2.0], [s * 1.2, 4.2, -1.55]], 0.11);
    // feux de signalisation : capot de la bouche, flancs
    for (const s of [-1, 1]) {
      kt.add('dark', G.cyl(0.13, 0.15, 0.1, 10), [s * 1.15, 3.7, 2.55], [0.55, 0, 0]);
      kt.add('glowA', G.sphere(0.1, 10, 6), [s * 1.15, 3.76, 2.58], [0.55, 0, 0], [1, 0.6, 1]);
      const q = ring(2.3, s * deg(65));
      kt.add('dark', G.cyl(0.12, 0.14, 0.12, 10), onN(q.p, q.n));
      kt.add('glowR', G.sphere(0.09, 10, 6), onN(q.p.map((v, i) => v + q.n[i] * 0.06), q.n));
    }
  }
  kt.done(torso, MT, { outline: { dark: 0.02 } });
  // ------------------------------------------------ bouche-turbine
  const mouth = joint(torso, [0, 1.7, 2.5]);
  const km = kit('gf-mouth');
  if (km.fresh) {
    km.add('gold', G.torus(1.6, 0.15, 10, 40), [0, 0, 0.55]);
    km.add('hazard', band(1.815, 0.26, 10), [0, 0, 0.27], [Math.PI / 2, 0, 0]);
    // grille : barreaux verticaux (des « dents »), traverse, boulons
    for (const x of [-1.22, -0.8, -0.27, 0.27, 0.8, 1.22]) {
      const h = 2 * Math.sqrt(1.47 * 1.47 - x * x);
      km.add('steel', G.cyl(0.055, 0.055, h, 8), [x, 0, 0.42]);
      for (const sy of [-1, 1]) km.add('gold', G.sphere(0.075, 8, 6), [x, sy * h / 2, 0.42]);
    }
    km.add('steel', G.cyl(0.05, 0.05, 2.9, 8), [0, -0.55, 0.38], [0, 0, Math.PI / 2]);
    // stator derrière la turbine
    for (let i = 0; i < 4; i++) km.add('dark', G.box(0.12, 2.8, 0.08), [0, 0, -0.3], [0, 0, (i * Math.PI) / 4 + 0.3]);
    km.add('glowPs', G.torus(1.4, 0.06, 6, 36), [0, 0, -0.36]);
  }
  km.done(mouth, MT, { outline: { gold: 0.025 } });
  const throat = part(mouth, G.cyl(1.4, 1.4, 0.05, 32), MT.glowP, { p: [0, 0, -0.42], r: [Math.PI / 2, 0, 0], shadow: false });
  const fan = joint(mouth, [0, 0, 0.05]);
  const kf = kit('gf-fan');
  if (kf.fresh) {
    const bl = bladeGeo();
    for (let i = 0; i < 11; i++) kf.add('steel', bl, [0, 0, 0], [0, 0, (i / 11) * TAU]);
    kf.add('dark', G.cyl(0.45, 0.45, 0.3, 20), [0, 0, 0], [Math.PI / 2, 0, 0]);
    kf.add('gold', G.lathe('gf-spinner', [[0.001, 0.55], [0.12, 0.48], [0.26, 0.32], [0.36, 0.12], [0.4, 0.0]], 20), [0, 0, 0.12], [Math.PI / 2, 0, 0]);
    kf.add('dark', G.sphere(0.06, 8, 6), [0.2, 0.08, 0.5]);
  }
  kf.done(fan, MT);
  // ------------------------------------------------ cockpit du Baron
  const cockpit = joint(torso, [0, 4.84, 0.3]);
  const kc = kit('gf-cockpit');
  if (kc.fresh) {
    kc.add('gold', G.torus(1.52, 0.09, 8, 44), [0, 0, 0], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * TAU;
      kc.add('steel', RIVET, onN([Math.cos(a) * 1.6, -0.2, Math.sin(a) * 1.6], [Math.cos(a), 0, Math.sin(a)], 0.045));
    }
    kc.add('glass', new THREE.SphereGeometry(1.5, 36, 14, 0, TAU, 0, Math.PI / 2), [0, 0.02, 0], [0, 0, 0], [1, 1.12, 1]);
    // nervures du dôme (en diagonale : le visage du Baron reste dégagé)
    for (let i = 0; i < 4; i++) kc.add('gold', G.torus(1.52, 0.035, 5, 18, Math.PI / 2), [0, 0.02, 0], [0, Math.PI / 4 + (i * Math.PI) / 2, 0], [1, 1.12, 1]);
    kc.add('gold', G.sphere(0.08, 10, 8), [0, 1.7, 0]);
    // fauteuil de velours à passepoil doré
    kc.add('velvet', G.rbox(1.05, 1.15, 0.2, 0.08, 2), [0, 0.3, -0.92], [-0.12, 0, 0]);
    kc.add('velvet', G.rbox(1.0, 0.18, 0.8, 0.07, 2), [0, -0.39, -0.35]);
    kc.add('gold', G.torus(0.5, 0.03, 5, 20, Math.PI), [0, 0.86, -0.99], [-0.12, 0, 0]);
    for (const s of [-1, 1]) kc.add('gold', G.cyl(0.03, 0.03, 1.1, 6), [s * 0.52, 0.3, -0.92], [-0.12, 0, 0]);
    // pupitre : écrans et manettes
    kc.add('dark', G.rbox(1.6, 0.3, 0.42, 0.06, 2), [0, -0.22, 1.08], [-0.45, 0, 0]);
    kc.add('glowS', G.box(0.32, 0.17, 0.02), [-0.42, -0.08, 1.04], [-0.45, 0, 0]);
    kc.add('glowP', G.box(0.32, 0.17, 0.02), [0.42, -0.08, 1.04], [-0.45, 0, 0]);
    kc.add('glowA', G.box(0.18, 0.1, 0.02), [0, -0.1, 1.02], [-0.45, 0, 0]);
    for (const s of [-1, 1]) {
      kc.add('steel', G.cyl(0.025, 0.025, 0.36, 6), [s * 0.2, 0.05, 0.98], [-0.35, 0, 0]);
      kc.add('red', G.sphere(0.06, 10, 8), [s * 0.2, 0.22, 0.92]);
    }
  }
  kc.done(cockpit, MT);
  const baron = joint(cockpit, [0, -0.3, -0.1]);
  baron.scale.setScalar(1.12);
  baronModel(baron);
  // ------------------------------------------------ bras : épaulières, vérins, canons multitubes
  let barrels = null;
  for (const a of arms) {
    const s = a.s, side = s < 0 ? 'L' : 'R';
    const ks = kit('gf-sh' + side);
    if (ks.fresh) {
      // rivets et écusson de l'épaulière
      const c = [s * 0.3, 0.45, 0], r = [1.2, 0.62, 1.3], rot = [0, 0, s * -0.35];
      for (let i = 0; i < 10; i++) {
        const q = ellAt(c, r, rot, s * deg(-50 + i * 30), deg(4));
        ks.add('rivet', RIVET, onN(q.p.map((v, k) => v - q.n[k] * 0.012), q.n, 0.07));
      }
      // jonc doré au bord de la coque
      const ph = deg(-14), rim = new THREE.Matrix4().makeRotationZ(s * -0.35).multiply(new THREE.Matrix4().makeTranslation(0, r[1] * Math.sin(ph), 0))
        .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)).multiply(new THREE.Matrix4().makeScale(1, r[2] / r[0], 1));
      rim.setPosition(new THREE.Vector3(0, r[1] * Math.sin(ph), 0).applyEuler(new THREE.Euler(...rot)).add(V(c)));
      ks.add('gold', G.torus(r[0] * Math.cos(ph), 0.055, 6, 44), rim);
      const q = ellAt(c, r, rot, s * deg(90), deg(28));
      ks.add('emblem', G.cyl(0.3, 0.3, 0.06, 28), new THREE.Matrix4().multiplyMatrices(onN(q.p.map((v, k) => v - q.n[k] * 0.005), q.n), new THREE.Matrix4().makeRotationY(s > 0 ? Math.PI : 0)));
      // feu de gabarit
      ks.add('dark', G.cyl(0.1, 0.12, 0.12, 10), [s * 0.2, 1.25, -0.35]);
      ks.add('glowA', G.sphere(0.08, 10, 6), [s * 0.2, 1.33, -0.35]);
    }
    ks.done(a.sh, MT);
    const ku = kit('gf-up' + side);
    if (ku.fresh) {
      ram(ku, [0, -0.3, 0.6], [0, -1.75, 0.5], 0.12);
      // gaine d'alimentation : de l'épaule à l'arrière du canon (points du canon ramenés dans le repère du bras)
      const fp = (p) => V(p).applyMatrix4(FORE).toArray();
      hose(ku, [[s * 0.25, -0.25, -0.5], [s * 0.35, -0.9, -0.75], fp([s * 0.3, -0.35, -0.75]), fp([s * 0.15, -0.9, -0.92])], 0.11);
      ku.add('gold', G.torus(0.47, 0.06, 6, 20), [0, -1.45, 0], [Math.PI / 2, 0, 0]);
    }
    ku.done(a.up, MT);
    const kfo = kit('gf-fore' + side);
    if (kfo.fresh) {
      // manchon de refroidissement : ailettes empilées
      kfo.add('gold', G.torus(0.885, 0.05, 6, 32), [0, -1.55, 0], [Math.PI / 2, 0, 0]);
      kfo.add('dark', G.cyl(0.5, 0.5, 0.75, 16), [0, -2.3, 0]);
      for (let i = 0; i < 6; i++) kfo.add('steel', G.cyl(0.66, 0.66, 0.035, 24), [0, -2.02 - i * 0.11, 0]);
      // six tubes, plaque de bouche dorée, âmes noires, anneau rose
      for (let i = 0; i < 6; i++) {
        const t = (i / 6) * TAU, x = Math.cos(t) * 0.33, z = Math.sin(t) * 0.33;
        kfo.add('gun', G.cyl(0.11, 0.11, 1.35, 10), [x, -2.55, z]);
        kfo.add('gun', G.cyl(0.14, 0.14, 0.12, 10), [x, -3.1, z]);
        kfo.add('soot', G.cyl(0.075, 0.075, 0.02, 8), [x, -3.17, z]);
      }
      kfo.add('gun', G.cyl(0.14, 0.14, 1.45, 10), [0, -2.5, 0]);
      kfo.add('gold', G.cyl(0.55, 0.55, 0.1, 24), [0, -2.85, 0]);
      kfo.add('glowP', G.torus(0.55, 0.05, 6, 24), [0, -2.91, 0], [Math.PI / 2, 0, 0]);
      // rivets des bagues du canon
      for (let i = 0; i < 10; i++) {
        const t = (i / 10) * TAU;
        for (const y of [-0.62, -1.48]) kfo.add('gold', RIVET, onN([Math.cos(t) * 0.87, y, Math.sin(t) * 0.87], [Math.cos(t), 0, Math.sin(t)], 0.06));
      }
    }
    const fm = kfo.done(a.fore, MT);
    if (!barrels) barrels = fm.gun;
  }
  // ------------------------------------------------ jambes : vérins, griffes, plaques
  for (const l of legs) {
    const side = l.s < 0 ? 'L' : 'R';
    const kh = kit('gf-hip' + side);
    if (kh.fresh) {
      // vérin arrière de la cuisse au mollet, sur pattes de fixation
      ram(kh, [0, -0.3, -0.92], [0, -2.45, -0.9], 0.13, 0.5);
      kh.add('dark', G.box(0.18, 0.2, 0.42), [0, -0.3, -0.7]);
      kh.add('dark', G.box(0.18, 0.2, 0.36), [0, -2.45, -0.72]);
      // rivets au-dessus du joint du cuissard
      for (let i = 0; i < 9; i++) {
        const q = ellAt([l.s * THIGH.p[0], THIGH.p[1], THIGH.p[2]], THIGH.r, [0, l.s * THIGH.ry, 0], deg(-80 + i * 20), deg(14));
        kh.add('rivet', RIVET, onN(q.p.map((v, k) => v - q.n[k] * 0.01), q.n, 0.06));
      }
    }
    kh.done(l.hip, MT);
    const kk = kit('gf-knee' + side);
    if (kk.fresh) {
      // vérins latéraux du tibia, sur pattes
      for (const s of [-1, 1]) {
        ram(kk, [s * 0.8, -0.35, 0.02], [s * 0.78, -1.42, 0.12], 0.09);
        kk.add('dark', G.box(0.34, 0.13, 0.16), [s * 0.66, -0.35, 0.02]);
        kk.add('dark', G.box(0.2, 0.13, 0.16), [s * 0.73, -1.42, 0.12]);
      }
      kk.add('gold', G.torus(0.55, 0.05, 6, 22), [0, -0.3, 0], [Math.PI / 2, 0, 0]);
      kk.add('gold', G.cyl(0.14, 0.16, 0.08, 16), [0, 0.08, 0.71], [Math.PI / 2, 0, 0]);
      kk.add('steel', G.cyl(0.07, 0.07, 0.1, 6), [0, 0.08, 0.75], [Math.PI / 2, 0, 0]);
      for (let i = 0; i < 4; i++) kk.add('gold', RIVET, onN([(i % 2 - 0.5) * 0.4, -0.62 - Math.floor(i / 2) * 0.36, 0.73], [0, 0.12, 1], 0.05));
    }
    kk.done(l.knee, MT);
    const kp = kit('gf-foot' + side);
    if (kp.fresh) {
      // griffes au bout des orteils, ergot au talon
      for (const x of [-1, 0, 1]) {
        kp.add('gold', taper([[x * 0.61, -0.14, 1.12], [x * 0.68, -0.14, 1.38], [x * 0.73, -0.28, 1.62], [x * 0.75, -0.43, 1.7]], 0.15, 0.015, 10, 12));
        kp.add('dark', G.torus(0.15, 0.045, 5, 14), [x * 0.61, -0.14, 1.12], [0, x * 0.3, 0]);
      }
      kp.add('gold', taper([[0, -0.1, -0.78], [0, -0.22, -1.0], [0, -0.42, -1.12]], 0.15, 0.015, 8, 8));
      for (const x of [-1, 0, 1]) kp.add('gold', RIVET, onN([x * 0.53, 0.07, 0.9], [x * 0.2, 1, 0.3], 0.05));
    }
    kp.done(l.foot, MT);
  }
  // ------------------------------------------------ lance-missiles dorsaux à trappes ouvertes
  const pods = [];
  for (const s of [-1, 1]) {
    const pod = joint(torso, [s * 1.6, 4.5, -1.4]);
    pod.rotation.set(-0.15, 0, s * -0.12);
    const kp = kit('gf-pod');
    if (kp.fresh) {
      kp.add('plate', G.rbox(1.3, 0.85, 1.5, 0.12, 2), [0, 0, 0]);
      kp.add('dark', G.rbox(1.1, 0.3, 1.3, 0.08, 2), [0, -0.5, 0]);
      kp.add('hazard', uvMeters(G.rbox(1.34, 0.14, 1.54, 0.05, 2), 2.5), [0, 0.2, 0]);
      for (let i = 0; i < 6; i++) {
        const x = (i % 2 - 0.5) * 0.56, z = (Math.floor(i / 2) - 1) * 0.42;
        kp.add('dark', G.cyl(0.17, 0.17, 0.14, 12), [x, 0.46, z]);
        kp.add('soot', G.cyl(0.13, 0.13, 0.02, 10), [x, 0.53, z]);
        if (i !== 1 && i !== 4) {
          kp.add('red', G.cone(0.12, 0.24, 10), [x, 0.66, z]);
          kp.add('cream', G.cyl(0.12, 0.12, 0.06, 10), [x, 0.53, z]);
        }
      }
      // trappes ouvertes à charnière sur les grands côtés
      for (const k of [-1, 1]) {
        const m = new THREE.Matrix4().makeTranslation(k * 0.66, 0.44, 0)
          .multiply(new THREE.Matrix4().makeRotationZ(k * 2.0))
          .multiply(new THREE.Matrix4().makeTranslation(-k * 0.31, 0.03, 0));
        kp.add('plateD', G.rbox(0.62, 0.06, 1.42, 0.03, 2), m);
        kp.add('gold', G.cyl(0.04, 0.04, 1.4, 8), [k * 0.66, 0.44, 0], [Math.PI / 2, 0, 0]);
      }
      for (const x of [-0.5, 0.5]) {
        kp.add('dark', G.cyl(0.08, 0.1, 0.08, 10), [x, 0.12, 0.76], [Math.PI / 2, 0, 0]);
        kp.add('glowA', G.sphere(0.07, 8, 6), [x, 0.12, 0.8]);
      }
      for (const k of [-1, 1]) for (const y of [-0.22, 0.05]) for (const z of [-0.55, 0, 0.55]) kp.add('gold', RIVET, onN([k * 0.655, y, z], [k, 0, 0], 0.05));
    }
    kp.done(pod, MT, { outline: { plate: 0.025 } });
    pods.push(pod);
  }
  // ------------------------------------------------ point faible : cœur rose qui palpite dans le réservoir
  const core = part(torso, G.ico(0.82, 3), MT.glowP, { p: [0, 2.25, -3.1], shadow: false });
  return { root, debrisColor: C.vorax, hips, torso, mouth, fan, throat, cockpit, baron, arms, pods, legs, core, chunks: [barrels, pods[0], pods[1], cockpit] };
}

// ===================================================================== Le Baron Vorax
// Chat bedonnant en redingote violette (galons et boutons dorés, épaulettes à franges), gilet d'or tendu sur la
// panse, jabot, haut-de-forme doré, monocle à chaînette, moustache cirée. Fourrure en coquilles (tête, queue).
const FUR_BARON = {
  len: 0.03, cell: 0.0075, minW: 0.3,
  bones: { bTail: 1.5, bHead: 1 },
  comb: { bHead: [0, -0.35, -1], bTail: [0, 0, -1], baron: [0, -1, 0] },
  trim: [
    { bone: 'bHead', p: [-0.14, 0.06, 0.3], r: 0.09, fade: 0.04, k: 0 }, // yeux
    { bone: 'bHead', p: [0.14, 0.06, 0.3], r: 0.09, fade: 0.04, k: 0 },
    { bone: 'bHead', p: [0, -0.06, 0.4], r: 0.07, fade: 0.04, k: 0.15 }, // truffe et babines
    { bone: 'bHead', p: [0, 0.34, 0], r: 0.2, fade: 0.06, k: 0 }, // sous le chapeau
  ],
  regions: [{ root: 'bHead', track: 'bHead', at: [0, 0, 0] }, { root: 'bTail', track: 'bTail' }],
};

function baronModel(parent) {
  const { S, root, B, skin } = rig({
    fur: { color: '#b48ae6', rough: 0.75, sheen: 0.8, fur: 0.75 },
    furL: { color: '#f1e4ff', rough: 0.8, sheen: 0.8, fur: 0.65 },
    furD: { color: '#7c50b0', rough: 0.75, sheen: 0.7, fur: 0.75 },
    pink: { color: '#e898bc', rough: 0.5, sheen: 0.4 },
    nose: { color: '#5a2a3a', rough: 0.3, coat: 0.6 },
    coat: { color: '#33105c', rough: 0.5, sheen: 0.3 },
    coatL: { color: '#5a2496', rough: 0.4, sheen: 0.5 },
    gold: { color: C.gold, rough: 0.25, metal: 0.85, coat: 0.3 },
    vest: { color: '#d39a2a', rough: 0.4, metal: 0.35, sheen: 0.6 },
    shirt: { color: '#f6f2fb', rough: 0.6, sheen: 0.5 },
    pants: { color: '#2a1838', rough: 0.7, sheen: 0.3 },
    shoe: { color: '#1a1018', rough: 0.2, coat: 0.9 },
    glove: { color: '#fbfaff', rough: 0.6, sheen: 0.4 },
  });
  const b = B(root, [0, 0, 0], 'baron');
  // ------------------------------------------------ corps : redingote, gilet sur la panse, jabot
  S.add(b, { t: 'ell', r: [0.5, 0.5, 0.44], p: [0, 0.42, -0.04], col: 'coat', k: 0.08 });
  S.add(b, { t: 'cone', a: [0, 0.3, -0.05], b: [0, -0.04, -0.08], r1: 0.46, r2: 0.54, col: 'coat', k: 0.08 });
  S.add(b, { t: 'ell', r: [0.56, 0.2, 0.32], p: [0, 0.74, -0.05], col: 'coat', k: 0.12 });
  S.add(b, { t: 'ell', r: [0.4, 0.37, 0.31], p: [0, 0.36, 0.16], col: 'vest', k: 0.1 });
  S.add(b, { t: 'ell', r: [0.17, 0.14, 0.12], p: [0, 0.76, 0.24], col: 'shirt', k: 0.05, fuzz: [0.012, 26] });
  S.add(b, { t: 'ell', r: [0.36, 0.17, 0.2], p: [0, 0.84, -0.13], col: 'coatL', k: 0.05 });
  // galon doré autour de l'ouverture du gilet, puis le gilet repeint
  S.paint(b, { t: 'ell', r: [0.425, 0.395, 0.335], p: [0, 0.36, 0.16], col: 'gold', feather: 0.005 });
  S.paint(b, { t: 'ell', r: [0.41, 0.38, 0.32], p: [0, 0.36, 0.16], col: 'vest', feather: 0.004 });
  // revers satinés
  for (const s of [-1, 1]) S.paint(b, { t: 'box', s: [0.09, 0.16, 0.2], round: 0.02, p: [s * 0.26, 0.66, 0.24], rot: [0, 0, s * 0.45], col: 'coatL', feather: 0.006 });
  // épaulettes
  for (const s of [-1, 1]) S.add(b, { t: 'ell', r: [0.17, 0.06, 0.16], p: [s * 0.44, 0.88, -0.05], rot: [0, 0, s * -0.3], col: 'gold', k: 0.03 });
  // bras : manches, parements dorés, gants posés sur la panse
  for (const s of [-1, 1]) {
    S.add(b, { t: 'cone', a: [s * 0.46, 0.74, -0.04], b: [s * 0.48, 0.42, 0.08], r1: 0.13, r2: 0.12, col: 'coat', k: 0.06 });
    S.add(b, { t: 'cone', a: [s * 0.48, 0.42, 0.08], b: [s * 0.2, 0.25, 0.38], r1: 0.12, r2: 0.11, col: 'coat', k: 0.05 });
    S.add(b, { t: 'cone', a: [s * 0.26, 0.28, 0.32], b: [s * 0.2, 0.25, 0.39], r1: 0.125, r2: 0.12, col: 'gold', k: 0.02 });
    S.add(b, { t: 'ell', r: [0.1, 0.08, 0.11], p: [s * 0.12, 0.23, 0.46], col: 'glove', k: 0.04 });
    // jambes assises, souliers vernis
    S.add(b, { t: 'cone', a: [s * 0.2, 0.08, 0.02], b: [s * 0.22, 0.06, 0.4], r1: 0.15, r2: 0.13, col: 'pants', k: 0.06 });
    S.add(b, { t: 'cone', a: [s * 0.22, 0.06, 0.42], b: [s * 0.22, -0.18, 0.47], r1: 0.11, r2: 0.09, col: 'pants', k: 0.05 });
    S.add(b, { t: 'ell', r: [0.09, 0.07, 0.16], p: [s * 0.22, -0.23, 0.55], col: 'shoe', k: 0.04 });
  }
  // ------------------------------------------------ queue en panache, recourbée sur le côté
  const tail = B(b, [0.1, 0.15, -0.42], 'bTail');
  const tp = [[0, 0, 0], [0.25, -0.03, -0.12], [0.48, 0.06, -0.08], [0.6, 0.28, 0.05], [0.55, 0.48, 0.15]];
  for (let i = 0; i < tp.length - 1; i++) S.add(tail, { t: 'cone', a: tp[i], b: tp[i + 1], r1: 0.09 + i * 0.008, r2: 0.098 + i * 0.008, col: i === tp.length - 2 ? 'furD' : 'fur', k: 0.05 });
  // ------------------------------------------------ tête
  const head = B(b, [0, 0.98, 0.02], 'bHead');
  S.add(head, { t: 'ell', r: [0.4, 0.34, 0.36], p: [0, 0.02, 0], col: 'fur', k: 0.1 });
  for (const s of [-1, 1]) {
    S.add(head, { t: 'ell', r: [0.2, 0.15, 0.16], p: [s * 0.2, -0.1, 0.17], col: 'fur', k: 0.1, fuzz: [0.012, 18] });
    S.add(head, { t: 'cone', a: [s * 0.3, -0.08, 0.1], b: [s * 0.47, -0.17, 0.06], r1: 0.08, r2: 0.02, col: 'fur', k: 0.06 });
    // oreilles (intérieur rose), écartées sous le bord du chapeau
    S.add(head, { t: 'cone', a: [0, 0, 0], b: [0, 0.27, 0], r1: 0.13, r2: 0.02, p: [s * 0.25, 0.2, -0.04], rot: [-0.1, 0, s * -0.85], sc: [1, 1, 0.45], col: 'fur', k: 0.04 });
    S.sub(head, { t: 'cone', a: [0, 0.03, 0], b: [0, 0.25, 0], r1: 0.09, r2: 0.012, p: [s * 0.255, 0.2, -0.01], rot: [-0.1, 0, s * -0.85], sc: [1, 1, 0.28], col: 'pink', k: 0.015 });
    S.sub(head, { t: 'ell', r: [0.085, 0.07, 0.05], p: [s * 0.14, 0.06, 0.31], rot: [0, s * 0.3, 0], k: 0.03 });
  }
  S.add(head, { t: 'ell', r: [0.17, 0.11, 0.12], p: [0, -0.1, 0.3], col: 'furL', k: 0.06 });
  S.add(head, { t: 'ell', r: [0.12, 0.07, 0.1], p: [0, -0.2, 0.24], col: 'furL', k: 0.05 });
  S.add(head, { t: 'ell', r: [0.06, 0.04, 0.04], p: [0, -0.03, 0.41], col: 'nose', k: 0.02 });
  // rayures tigrées sur le front
  for (const [x, rz] of [[0, 0], [-0.1, 0.25], [0.1, -0.25]]) S.paint(head, { t: 'box', s: [0.018, 0.08, 0.12], round: 0.01, p: [x, 0.25, 0.24], rot: [-0.7, 0, rz], col: 'furD', feather: 0.008 });
  for (const s of [-1, 1]) for (const y of [-0.04, 0.04]) S.paint(head, { t: 'box', s: [0.06, 0.012, 0.1], round: 0.006, p: [s * 0.36, y, 0.08], rot: [0, s * 0.9, s * 0.2], col: 'furD', feather: 0.006 });
  const bSkin = skin('baron', { mesh: { cell: 0.022, skinSoft: 0.05, aoDist: 0.03 }, mat: { sheenColor: '#f0d8ff' }, outline: 0.008 });
  const fur = addFur(bSkin, FUR_BARON);
  if (fur && bSkin) {
    // les poils vivent au rythme des images (le comportement du boss ne les met pas à jour)
    let last = 0;
    bSkin.onBeforeRender = () => {
      const now = performance.now();
      if (last) fur.update(Math.min(0.05, (now - last) / 1000));
      last = now;
    };
  }
  // ------------------------------------------------ accessoires
  const gold = mat(C.gold, { rough: 0.25, metal: 0.85, coat: 0.3 });
  const furD = mat('#6a4498', { rough: 0.7, sheen: 0.6, sheenColor: '#d8b8ff' });
  const furC = mat('#b48ae6', { rough: 0.75, sheen: 0.8, sheenColor: '#f0d8ff' });
  const kb = kit('baron-body');
  if (kb.fresh) {
    // boutons du gilet et de la redingote
    for (const y of [0.56, 0.45, 0.34, 0.23]) {
      const z = 0.16 + 0.31 * Math.sqrt(Math.max(0, 1 - ((y - 0.36) / 0.37) ** 2));
      kb.add('gold', G.sphere(0.026, 8, 6), [0, y, z + 0.005]);
    }
    for (const s of [-1, 1]) for (const y of [0.62, 0.46, 0.3]) {
      const x = s * (0.36 + (0.62 - y) * 0.12);
      kb.add('gold', G.cyl(0.035, 0.035, 0.02, 12), [x, y, Math.sqrt(Math.max(0, 1 - (x / 0.5) ** 2 - ((y - 0.42) / 0.5) ** 2)) * 0.44 - 0.03], [Math.PI / 2 - 0.3, 0, 0]);
    }
    // franges des épaulettes
    for (const s of [-1, 1]) for (let i = 0; i < 9; i++) {
      const a = Math.PI * (0.15 + (i / 8) * 0.7);
      kb.add('gold', G.cyl(0.012, 0.012, 0.09, 5), [s * (0.44 + Math.sin(a) * 0.16), 0.79, -0.05 + Math.cos(a) * 0.15]);
    }
    // chaîne de montre en travers de la panse
    kb.add('gold', taper([[0, 0.45, 0.47], [0.12, 0.38, 0.47], [0.24, 0.36, 0.42], [0.33, 0.4, 0.33]], 0.009, 0.009, 5, 12));
    // chaînette du monocle (de l'œil droit au revers)
    kb.add('gold', taper([[0.24, 1.0, 0.4], [0.3, 0.86, 0.4], [0.3, 0.74, 0.36], [0.27, 0.66, 0.33]], 0.008, 0.008, 5, 14));
  }
  kb.done(b, { gold });
  const kh = kit('baron-head');
  if (kh.fresh) {
    for (const s of [-1, 1]) {
      // yeux mi-clos, l'air satisfait ; sourcil relevé au-dessus du monocle
      kh.add('white', G.ellipsoid(0.085, 0.075, 0.05, 14, 10), [s * 0.14, 0.06, 0.32], [0, s * 0.3, 0]);
      kh.add('iris', G.sphere(0.045, 12, 8), [s * 0.152, 0.05, 0.355], [0, 0, 0], [1, 1, 0.5]);
      kh.add('pupil', G.ellipsoid(0.012, 0.035, 0.01, 8, 6), [s * 0.156, 0.05, 0.374]);
      kh.add('lid', new THREE.SphereGeometry(0.092, 14, 6, 0, TAU, 0, Math.PI * 0.42), [s * 0.14, 0.06, 0.315], [s > 0 ? 0.15 : 0.5, s * 0.3, 0]);
      kh.add('brow', taper([[s * 0.06, 0.15 + (s > 0 ? 0.04 : 0), 0.36], [s * 0.14, 0.19 + (s > 0 ? 0.06 : 0), 0.35], [s * 0.23, 0.16 + (s > 0 ? 0.05 : 0), 0.3]], 0.03, 0.012, 6, 8));
      // moustache cirée en guidon, bouts relevés en boucle
      kh.add('stache', taper([[s * 0.01, -0.08, 0.43], [s * 0.12, -0.11, 0.43], [s * 0.24, -0.08, 0.38], [s * 0.31, 0.0, 0.33], [s * 0.28, 0.05, 0.31], [s * 0.245, 0.02, 0.32]], 0.04, 0.008, 8, 22));
      // vibrisses
      for (const [dy, dz] of [[0.02, 0], [-0.02, -0.02], [-0.06, -0.03]]) kh.add('whisk', taper([[s * 0.13, -0.1 + dy, 0.36], [s * 0.32, -0.08 + dy * 2, 0.34 + dz], [s * 0.5, -0.05 + dy * 3, 0.3 + dz * 2]], 0.006, 0.002, 4, 6));
    }
    kh.add('glintW', G.sphere(0.014, 6, 4), [0.17, 0.08, 0.375]);
    kh.add('glintW', G.sphere(0.014, 6, 4), [-0.11, 0.08, 0.375]);
    // monocle sur l'œil droit
    kh.add('gold', G.torus(0.1, 0.014, 6, 22), [0.15, 0.06, 0.39], [0, 0.3, 0]);
    kh.add('lens', G.cyl(0.095, 0.095, 0.006, 20), [0.15, 0.06, 0.39], [Math.PI / 2, 0, -0.3]);
    kh.add('gold', G.sphere(0.018, 6, 4), [0.235, 0.0, 0.39]);
  }
  kh.done(head, {
    gold, white: mat('#ffffff', { rough: 0.15 }), iris: glow('#ffc23a', 1.6), pupil: mat('#140a10', { rough: 0.2 }),
    lid: furC, brow: furD, stache: mat('#3a1846', { rough: 0.35, sheen: 0.8, sheenColor: '#c890ff' }),
    whisk: mat('#ffffff', { rough: 0.4 }), glintW: glow('#ffffff', 1.5),
    lens: mat('#e8f4ff', { rough: 0.02, metal: 0.3, transparent: true, opacity: 0.35 }),
  });
  // ------------------------------------------------ haut-de-forme doré, porté de travers
  const hat = joint(head, [0.03, 0.31, -0.02]);
  hat.rotation.set(-0.1, 0, -0.14);
  const kht = kit('baron-hat');
  if (kht.fresh) {
    kht.add('gold', G.lathe('baron-brim', [[0.12, -0.012], [0.27, -0.012], [0.31, 0.01], [0.335, 0.05], [0.325, 0.058], [0.29, 0.03], [0.26, 0.016], [0.12, 0.016]], 32));
    kht.add('gold', G.lathe('baron-crown', [[0.0, 0.01], [0.19, 0.01], [0.18, 0.12], [0.183, 0.3], [0.2, 0.43], [0.205, 0.445], [0.0, 0.448]], 28));
    kht.add('band', band(0.188, 0.08, 1, 28), [0, 0.065, 0]);
    kht.add('gem', G.ico(0.035, 0), [0, 0.065, 0.19], [0.3, 0.4, 0]);
    kht.add('gold', G.torus(0.04, 0.008, 4, 12), [0, 0.065, 0.188]);
  }
  kht.done(hat, {
    gold: mat('#ffbe1a', { rough: 0.3, metal: 0.7, coat: 0.6 }), band: mat('#33105c', { rough: 0.5, sheen: 0.8, sheenColor: '#c890ff', side: THREE.DoubleSide }),
    gem: mat('#ff4fa0', { rough: 0.1, metal: 0.2, emissive: '#ff4fa0', emissiveIntensity: 0.6 }),
  });
  if (parent) parent.add(root);
  return root;
}
