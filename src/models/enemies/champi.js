import * as THREE from 'three';
import { G, part, joint, mergeGeometries } from '../geo.js';
import { mat, glow } from '../../engine/materials.js';
import { rig } from './common.js';

// ===================================================================== Champi-cracheur (Luminbois)
// Champignon planté dans une butte de terre moussue : chapeau velouté à verrues et pores lumineux (le cratère du
// sommet crache les spores), bord ourlé, lamelles luisantes, pied fibreux à collerette, visage boudeur, volve
// déchirée, racines, mycélium lumineux et petits champignons au pied.
// Os : base (fixe), stem (s'enfonce dans le sol et s'écrase quand il se cache), cap (gonfle quand il crache).

const TAU = Math.PI * 2;
// hasard déterministe (même modèle à chaque fois)
let seedS = 1;
const rnd = () => { seedS = (seedS * 16807) % 2147483647; return (seedS - 1) / 2147483646; };
const seed = (s) => { seedS = s; };

// chapeau : demi-ellipsoïde (rayon CR, hauteur CH) posé sur l'os cap ; dessous creusé (rayon UR, profondeur UH)
const CR = 1.0, CH = 0.66, UR = 0.86, UH = 0.15;
const _up = new THREE.Vector3(0, 1, 0), _n = new THREE.Vector3(), _q = new THREE.Quaternion(), _eu = new THREE.Euler();
// point du dessus du chapeau (a : azimut, f : 0 au sommet → 1 au bord) et sa normale ; rot : Euler qui couche y sur la normale
function capPoint(a, f, lift = 0) {
  const ph = f * Math.PI * 0.5;
  const x = Math.sin(ph) * Math.sin(a) * CR, y = Math.cos(ph) * CH, z = Math.sin(ph) * Math.cos(a) * CR;
  _n.set(x / (CR * CR), y / (CH * CH), z / (CR * CR)).normalize();
  _q.setFromUnitVectors(_up, _n);
  _eu.setFromQuaternion(_q);
  return { p: [x + _n.x * lift, y + _n.y * lift, z + _n.z * lift], n: _n.toArray(), rot: [_eu.x, _eu.y, _eu.z] };
}
// plafond du dessous du chapeau (où s'accrochent les lamelles)
const ceilY = (r) => -0.02 + UH * Math.sqrt(Math.max(0, 1 - (r / UR) ** 2));

// ------------------------------------------------------------------ géométries partagées (calculées une fois)
const GEO = {};
const shared = (g) => { g.userData.shared = true; return g; };

// Lamelles : lames radiales sous le chapeau (longues jusqu'au pied, courtes intercalées), double face
function gillsGeo() {
  if (GEO.gills) return GEO.gills;
  const pos = [], nrm = [], idx = [];
  const N = 64, SEG = 7;
  for (let g = 0; g < N; g++) {
    const a = (g / N) * TAU, short = g % 2 === 1, tiny = g % 4 === 3;
    const r0 = tiny ? 0.68 : short ? 0.52 : 0.29, r1 = 0.84;
    const c = Math.cos(a), s = Math.sin(a);
    const b = pos.length / 3;
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG, r = r0 + (r1 - r0) * t;
      const top = ceilY(r) + 0.015;
      const d = (short ? 0.07 : 0.11) * Math.pow(Math.sin(Math.PI * (0.18 + 0.82 * t)), 0.7) + 0.01;
      pos.push(r * s, top, r * c, r * s, top - d, r * c);
      nrm.push(-c, 0, s, -c, 0, s);
      if (i) idx.push(b + i * 2 - 2, b + i * 2 - 1, b + i * 2, b + i * 2 - 1, b + i * 2 + 1, b + i * 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return (GEO.gills = shared(geo));
}

// Collerette (anneau) : jupe évasée qui pend sous l'os, bord froncé
function skirtGeo() {
  if (GEO.skirt) return GEO.skirt;
  const prof = [[0.42, -0.16], [0.405, -0.13], [0.37, -0.08], [0.33, -0.035], [0.295, 0.0], [0.265, 0.03]];
  const geo = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 40);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = Math.max(0, -y / 0.16), a = Math.atan2(z, x);
    const k = 1 + t * t * (0.07 * Math.sin(a * 11) + 0.03 * Math.sin(a * 5 + 1));
    p.setXYZ(i, x * k, y + t * t * 0.025 * Math.sin(a * 11 + 0.5), z * k);
  }
  geo.computeVertexNormals();
  return (GEO.skirt = shared(geo));
}

// Petit champignon satellite (pied + chapeau, couleurs par sommet) et ses points lumineux
function satGeo() {
  if (GEO.sat) return GEO.sat;
  const col = (g, hex) => {
    const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  };
  const stem = col(new THREE.CylinderGeometry(0.03, 0.045, 0.3, 8, 1, true).translate(0, 0.1, 0), '#ece0c8');
  const cap = col(new THREE.SphereGeometry(0.12, 12, 5, 0, TAU, 0, Math.PI / 2).scale(1, 0.75, 1).translate(0, 0.23, 0), '#d8508e');
  const under = col(new THREE.CircleGeometry(0.12, 12).rotateX(Math.PI / 2).translate(0, 0.23, 0), '#5a2448');
  GEO.sat = shared(mergeGeometries([stem, cap, under]));
  const dots = [];
  for (let k = 0; k < 4; k++) {
    const a = k * 2.1 + 0.4, f = k ? 0.6 : 0;
    const x = Math.sin(f * 1.2) * Math.sin(a) * 0.12, y = 0.23 + Math.cos(f * 1.2) * 0.09, z = Math.sin(f * 1.2) * Math.cos(a) * 0.12;
    dots.push(new THREE.SphereGeometry(k ? 0.018 : 0.024, 6, 4).translate(x, y, z));
  }
  GEO.satDots = shared(mergeGeometries(dots));
  return GEO.sat;
}

// Mycélium : filaments lumineux qui rampent sur le sol depuis la butte (un seul maillage)
function myceliumGeo() {
  if (GEO.myc) return GEO.myc;
  seed(77);
  const list = [];
  for (let k = 0; k < 11; k++) {
    let a = (k / 11) * TAU + rnd() * 0.4;
    const pts = [];
    let r = 0.8 + rnd() * 0.15;
    const len = 0.45 + rnd() * 0.5;
    for (let i = 0; i < 6; i++) {
      pts.push(new THREE.Vector3(Math.sin(a) * r, i === 0 ? 0.02 : 0.012 + rnd() * 0.01, Math.cos(a) * r));
      r += len / 5;
      a += (rnd() - 0.5) * 0.35;
    }
    list.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, 0.009 + rnd() * 0.005, 3, false));
    // ramification
    const m = pts[2 + Math.floor(rnd() * 2)], aa = a + (rnd() - 0.5) * 1.6;
    const p2 = m.clone().add(new THREE.Vector3(Math.sin(aa) * 0.3, 0, Math.cos(aa) * 0.3));
    const p3 = p2.clone().add(new THREE.Vector3(Math.sin(aa + 0.4) * 0.25, 0, Math.cos(aa + 0.4) * 0.25));
    list.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([m, p2, p3]), 6, 0.007, 3, false));
  }
  for (const g of list) g.deleteAttribute('uv');
  return (GEO.myc = shared(mergeGeometries(list)));
}

// Œil organique : globe verni, iris lumineux, pupille, reflet
function eyeBall(parent, r, p, ry) {
  const e = joint(parent, p);
  e.rotation.y = ry;
  part(e, G.sphere(r, 16, 12), mat('#fbf6ee', { rough: 0.15, coat: 0.6 }), { outline: 0.014 });
  part(e, G.sphere(r * 0.6, 14, 8), glow('#ff3a6a', 2.2), { p: [0, -r * 0.08, r * 0.8], s: [1, 1, 0.35], shadow: false });
  part(e, G.sphere(r * 0.3, 10, 6), mat('#160a14', { rough: 0.2 }), { p: [0, -r * 0.08, r * 0.95], s: [1, 1, 0.35], shadow: false });
  part(e, G.sphere(r * 0.12, 6, 4), glow('#ffffff', 1.4), { p: [r * 0.22, r * 0.12, r * 1.06], shadow: false });
  return e;
}

export function champi() {
  const { S, root, B, skin } = rig({
    stem: { color: '#ece0c8', rough: 0.62, sheen: 0.5, fur: 0.35 },
    stemF: { color: '#d6c4a6', rough: 0.7, sheen: 0.4, fur: 0.5 },
    stemD: { color: '#b9a080', rough: 0.75, sheen: 0.3, fur: 0.4 },
    ring: { color: '#f4ecdc', rough: 0.5, sheen: 0.6 },
    cap: { color: '#d04a8a', rough: 0.5, sheen: 0.95 },
    capD: { color: '#93245f', rough: 0.55, sheen: 0.9 },
    capL: { color: '#f79ac4', rough: 0.45, sheen: 0.9 },
    wart: { color: '#f6e8d4', rough: 0.7, sheen: 0.5, fur: 0.15 },
    pore: { color: '#5a1840', rough: 0.6, sheen: 0.4 },
    under: { color: '#4a2040', rough: 0.75 },
    lip: { color: '#c8607e', rough: 0.4, sheen: 0.5, coat: 0.5 },
    blush: { color: '#eaa8a4', rough: 0.55, sheen: 0.6 },
    dark: { color: '#2a1828', rough: 0.6 },
    volva: { color: '#d8c6a8', rough: 0.7, sheen: 0.4, fur: 0.2 },
    rootC: { color: '#7c5c46', rough: 0.8, sheen: 0.2, fur: 0.3 },
    soil: { color: '#3a2a26', rough: 0.95 },
    moss: { color: '#3a7a48', rough: 0.9, sheen: 0.7, fur: 0.8 },
    mossL: { color: '#78b05a', rough: 0.85, sheen: 0.7, fur: 0.8 },
  });
  const base = B(root, [0, 0, 0], 'base');
  const stem = B(base, [0, 0.1, 0], 'stem');
  const cap = B(stem, [0, 1.3, 0], 'cap');

  // --- butte de terre, racines, mousse, volve (os base : ne bouge pas) ; assez basses pour rester sous le chapeau
  //     quand il se cache (chapeau écrasé contre le sol)
  S.add(base, { t: 'ell', r: [0.95, 0.16, 0.95], p: [0, -0.04, 0], col: 'soil', k: 0.1, fuzz: [0.03, 5] });
  S.add(base, { t: 'torus', R: 0.55, r: 0.15, p: [0, -0.05, 0], col: 'soil', k: 0.12, fuzz: [0.03, 7] });
  seed(11);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + rnd() * 0.5, r1 = 1.05 + rnd() * 0.35, bend = (rnd() - 0.5) * 0.5;
    S.add(base, { t: 'cone', a: [Math.sin(a) * 0.4, 0.0, Math.cos(a) * 0.4], b: [Math.sin(a + bend * 0.5) * 0.8, -0.005, Math.cos(a + bend * 0.5) * 0.8], r1: 0.08, r2: 0.06, col: 'rootC', k: 0.06 });
    S.add(base, { t: 'cone', a: [Math.sin(a + bend * 0.5) * 0.8, -0.005, Math.cos(a + bend * 0.5) * 0.8], b: [Math.sin(a + bend) * r1, -0.02, Math.cos(a + bend) * r1], r1: 0.06, r2: 0.035, col: 'rootC', k: 0.04 });
  }
  // coussinets de mousse : des touffes bombées groupées en plaques, posées sur la butte
  const soilY = (d) => Math.max(-0.04 + 0.16 * Math.sqrt(Math.max(0, 1 - (d / 0.95) ** 2)), -0.05 + Math.sqrt(Math.max(0, 0.0225 - (d - 0.55) ** 2)), -0.03);
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * TAU + rnd() * 0.6;
    for (let j = 0; j < 5; j++) {
      const a = a0 + (rnd() - 0.5) * 0.7, d = 0.5 + rnd() * 0.65, r = 0.06 + rnd() * 0.05;
      S.add(base, { t: 'ell', r: [r, r * 0.7, r], p: [Math.sin(a) * d, soilY(d) - r * 0.25, Math.cos(a) * d], col: j % 3 ? 'moss' : 'mossL', k: 0.05, fuzz: [0.012, 40] });
    }
  }
  // volve : sac déchiré d'où sort le pied
  S.add(base, { t: 'ell', r: [0.48, 0.18, 0.48], p: [0, -0.04, 0], col: 'volva', k: 0.08, fuzz: [0.015, 9] });
  S.add(base, { t: 'torus', R: 0.46, r: 0.065, p: [0, 0.08, 0], col: 'volva', k: 0.06, fuzz: [0.02, 11] });
  S.sub(base, { t: 'ell', r: [0.41, 0.2, 0.41], p: [0, 0.16, 0], col: 'stemD', k: 0.03 });
  // lambeaux du bord, déchiré par endroits
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.3;
    if (i % 3 === 2) S.sub(base, { t: 'sph', r: 0.08, p: [Math.sin(a) * 0.47, 0.15, Math.cos(a) * 0.47], col: 'volva', k: 0.03 });
    else S.add(base, { t: 'ell', r: [0.1, 0.075, 0.025], p: [Math.sin(a) * 0.5, 0.1, Math.cos(a) * 0.5], rot: [-0.45, a, 0], col: 'volva', k: 0.03, fuzz: [0.01, 25] });
  }
  S.add(base, { t: 'ell', r: [0.14, 0.05, 0.1], p: [0.4, 0.08, -0.14], rot: [0, 0.4, 0.4], col: 'moss', k: 0.04, fuzz: [0.02, 22] });

  // --- chapeau (os cap) : dôme velouté, dessous creusé, bord ourlé
  S.add(cap, { t: 'ell', r: [CR, CH, CR], col: 'cap', k: 0.04, fuzz: [0.02, 2.4] });
  // (sans couleur : sa face cachée croise le pied et le teinterait)
  S.sub(cap, { t: 'box', s: [1.3, 0.4, 1.3], p: [0, -0.42, 0], k: 0.02 });
  S.sub(cap, { t: 'ell', r: [UR, UH, UR], p: [0, -0.02, 0], col: 'under', k: 0.04 });
  S.add(cap, { t: 'torus', R: 0.96, r: 0.09, p: [0, -0.02, 0], col: 'capL', k: 0.06, fuzz: [0.014, 6] });
  S.paint(cap, { t: 'ell', r: [0.55, 0.3, 0.55], p: [0, CH, 0], col: 'capD', feather: 0.2 });
  // verrues crème en relief
  seed(5);
  for (let i = 0; i < 15; i++) {
    const a = i * 2.39996 + rnd() * 0.3, f = 0.3 + 0.62 * Math.sqrt((i + 0.5) / 15);
    const w = 0.05 + rnd() * 0.05;
    const c = capPoint(a, f, 0.012);
    S.add(cap, { t: 'ell', r: [w, 0.045, w * (0.8 + rnd() * 0.4)], p: c.p, rot: c.rot, col: 'wart', k: 0.025, fuzz: [0.014, 32] });
  }
  // pores cracheurs : cratère au sommet + 8 pores autour (lueurs pulsées par le comportement)
  const pores = [[0, 0, 0.11], ...Array.from({ length: 8 }, (_, i) => [i * TAU / 8 + 0.2, 0.42 + (i % 2) * 0.2, 0.06])];
  for (const [a, f, r] of pores) {
    const c = capPoint(a, f);
    S.add(cap, { t: 'ell', r: [r * 1.55, r * 0.7, r * 1.55], p: c.p, rot: c.rot, col: 'pore', k: 0.05 });
    const c2 = capPoint(a, f, r * 0.55);
    S.sub(cap, { t: 'sph', r: r * 0.95, p: c2.p, col: 'dark', k: 0.02 });
  }

  // --- pied (os stem) : fibreux, ventru, collerette, visage
  S.add(stem, { t: 'cone', a: [0, -0.25, 0], b: [0, 1.32, 0], r1: 0.34, r2: 0.24, col: 'stem', k: 0.02 });
  S.add(stem, { t: 'ell', r: [0.36, 0.42, 0.35], p: [0, 0.4, 0.01], col: 'stem', k: 0.2 });
  // fibres : sillons verticaux (pas sur le visage)
  seed(23);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU + 0.2;
    if (Math.cos(a) > 0.55) continue;
    const y0 = 0.05 + rnd() * 0.2, y1 = 0.8 + rnd() * 0.3;
    const rr = (y) => 0.34 - y * 0.065 + (Math.abs(y - 0.4) < 0.4 ? 0.02 : 0);
    S.sub(stem, { t: 'cone', a: [Math.sin(a) * (rr(y0) + 0.028), y0, Math.cos(a) * (rr(y0) + 0.028)], b: [Math.sin(a) * (rr(y1) + 0.028), y1, Math.cos(a) * (rr(y1) + 0.028)], r1: 0.038, r2: 0.032, col: 'stemF', k: 0.035 });
  }
  // anneau sous la collerette
  S.add(stem, { t: 'torus', R: 0.25, r: 0.045, p: [0, 1.13, 0], col: 'ring', k: 0.04 });
  // la face cachée du dôme du chapeau croise le pied à cette hauteur : on y remet la couleur du pied
  S.paint(stem, { t: 'cyl', r: 0.5, h: 0.07, p: [0, 0.67, 0], col: 'stem', feather: 0.02 });
  // pied qui se salit vers le bas
  S.paint(stem, { t: 'ell', r: [0.5, 0.25, 0.5], p: [0, -0.1, 0], col: 'stemD', feather: 0.22 });
  // visage : orbites, paupières lourdes en colère, sourcils, joues, bouche en cul-de-poule (il crache !)
  for (const s of [-1, 1]) {
    S.sub(stem, { t: 'sph', r: 0.115, p: [s * 0.13, 0.72, 0.29], col: 'stemD', k: 0.03 });
    S.add(stem, { t: 'ell', r: [0.135, 0.06, 0.1], p: [s * 0.13, 0.79, 0.255], rot: [0.45, 0, s * 0.3], col: 'stem', k: 0.025 });
    S.add(stem, { t: 'ell', r: [0.11, 0.03, 0.05], p: [s * 0.14, 0.875, 0.27], rot: [0.25, 0, s * 0.42], col: 'stemD', k: 0.03 });
    S.add(stem, { t: 'ell', r: [0.1, 0.075, 0.07], p: [s * 0.17, 0.49, 0.28], col: 'stem', k: 0.07 });
    S.paint(stem, { t: 'sph', r: 0.045, p: [s * 0.2, 0.5, 0.35], col: 'blush', feather: 0.035 });
  }
  S.add(stem, { t: 'torus', R: 0.05, r: 0.032, p: [0.015, 0.41, 0.375], rot: [Math.PI / 2 - 0.15, 0, 0.1], col: 'lip', k: 0.03 });
  S.sub(stem, { t: 'sph', r: 0.035, p: [0.015, 0.41, 0.41], col: 'dark', k: 0.01 });
  // la partie enterrée ne sert à rien
  S.sub(base, { t: 'box', s: [1.6, 0.3, 1.6], p: [0, -0.42, 0], k: 0.01 });
  skin('champi', { mesh: { cell: 0.032, skinSoft: 0.03 }, mat: { enemyRim: true, sheenColor: '#ffd6ee' } });

  // --- pièces rapportées
  // lamelles qui luisent sous le chapeau, collerette froncée
  part(cap, gillsGeo(), mat('#8a3a7c', { rough: 0.6, emissive: '#ff5ac8', emissiveIntensity: 0.45, side: THREE.DoubleSide }), { shadow: false });
  part(stem, skirtGeo(), mat('#a8977e', { rough: 0.65, sheen: 0.25, sheenColor: '#ffe0f0', side: THREE.DoubleSide }), { p: [0, 1.11, 0] });
  eyeBall(stem, 0.105, [-0.13, 0.72, 0.245], 0.14);
  eyeBall(stem, 0.105, [0.13, 0.72, 0.245], -0.14);
  // lueurs des pores (pulsées par le comportement)
  const sporeM = glow('#7affc8', 2.4);
  const spots = pores.map(([a, f, r]) => {
    const c = capPoint(a, f, r * 0.15);
    const j = joint(cap, c.p);
    j.rotation.set(...c.rot);
    part(j, G.sphere(r * 0.85, 10, 6), sporeM, { s: [1, 0.55, 1], shadow: false });
    return j;
  });
  // mycélium lumineux au sol
  part(base, myceliumGeo(), glow('#b0ffe4', 0.7), { shadow: false });
  // petits champignons au pied (projetés à la mort)
  const satM = mat('#ffffff', { rough: 0.5, sheen: 0.7, sheenColor: '#ffd6ee', vertexColors: true });
  const chunks = [];
  for (const [a, d, s, tx, tz] of [[2.5, 1.1, 1.25, 0.15, -0.1], [2.85, 1.2, 0.8, -0.2, 0.15], [2.2, 1.28, 0.6, 0.1, 0.25], [-0.85, 1.12, 0.9, -0.12, 0.1], [0.55, 1.2, 0.55, 0.2, -0.2]]) {
    const m = part(base, satGeo(), satM, { p: [Math.sin(a) * d, -0.03, Math.cos(a) * d], r: [tx, a, tz], s });
    part(m, GEO.satDots, sporeM, { shadow: false });
    chunks.push(m);
  }
  return { root, debrisColor: '#d04a8a', base, stem, cap, spots, chunks };
}
