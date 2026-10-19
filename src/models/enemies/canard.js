import * as THREE from 'three';
import { mergeGeometries } from '../geo.js';
import { mat, glow } from '../../engine/materials.js';
import { rig } from './common.js';

// ===================================================================== Canard (Canardiseur)
// Jouet de bain en vinyle : corps moulé en deux coquilles (ligne de moulage au milieu), yeux peints, sifflet sous le ventre.

const HEAD_R = 0.235;

// Pastille peinte sur une sphère de rayon R : centre décalé (cx, cy), demi-axes (ax, ay), en unités tangentes,
// autour de +Z ; chaque sommet est reprojeté sur la sphère (la peinture épouse la tête, aucun bord qui flotte)
function capGeo(R, cx, cy, ax, ay, rings = 4, segs = 18) {
  const pos = [], idx = [];
  const put = (u, v) => { const l = Math.hypot(u, v, 1); pos.push((u / l) * R, (v / l) * R, R / l); };
  put(cx, cy);
  for (let r = 1; r <= rings; r++) for (let s = 0; s < segs; s++) {
    const a = (s / segs) * Math.PI * 2, f = r / rings;
    put(cx + Math.cos(a) * ax * f, cy + Math.sin(a) * ay * f);
  }
  for (let s = 0; s < segs; s++) idx.push(0, 1 + s, 1 + ((s + 1) % segs));
  for (let r = 1; r < rings; r++) for (let s = 0; s < segs; s++) {
    const a = 1 + (r - 1) * segs + s, b = 1 + (r - 1) * segs + ((s + 1) % segs);
    idx.push(a, a + segs, b, b, a + segs, b + segs);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

// Yeux peints (blanc, pupille, reflets) : trois géométries fusionnées, calculées une fois
let EYES = null;
function eyeGeos() {
  if (EYES) return EYES;
  const up = new THREE.Vector3(0, 1, 0);
  const lists = [[], [], []];
  for (const s of [-1, 1]) {
    const n = new THREE.Vector3(s * 0.44, 0.3, 0.85).normalize();
    const x = new THREE.Vector3().crossVectors(up, n).normalize(), y = new THREE.Vector3().crossVectors(n, x);
    const m = new THREE.Matrix4().makeBasis(x, y, n);
    // pupille un peu vers le bec et vers le bas : regard tendre ; reflets en haut, côté extérieur
    const parts = [
      [0, capGeo(HEAD_R + 0.0025, 0, 0, 0.24, 0.3)],
      [1, capGeo(HEAD_R + 0.005, -s * 0.035, -0.04, 0.165, 0.215)],
      [2, capGeo(HEAD_R + 0.007, s * 0.02, 0.055, 0.05, 0.055, 2, 12)],
      [2, capGeo(HEAD_R + 0.007, -s * 0.05, -0.1, 0.022, 0.022, 1, 8)],
    ];
    for (const [i, g] of parts) { g.applyMatrix4(m); lists[i].push(g); }
  }
  EYES = lists.map((l) => { const g = mergeGeometries(l); g.userData.shared = true; return g; });
  return EYES;
}

export function canard() {
  const { S, root, B, skin } = rig({
    // vinyle satiné : sheen doux + vernis léger
    yellow: { color: '#ffc61a', rough: 0.38, sheen: 0.25, coat: 0.4 },
    yellowD: { color: '#eba000', rough: 0.42, sheen: 0.4, coat: 0.25 },
    orange: { color: '#ff6a08', rough: 0.3, sheen: 0.3, coat: 0.6 },
    orangeD: { color: '#b8380a', rough: 0.55, coat: 0.1 },
    blush: { color: '#ff9a3a', rough: 0.4, sheen: 0.5, coat: 0.35 },
    seam: { color: '#ffd23a', rough: 0.3, sheen: 0.3, coat: 0.5 },
    plug: { color: '#f3ecdc', rough: 0.42, sheen: 0.3, coat: 0.3 },
  });
  const body = B(root, [0, 0.35, 0], 'body');
  // ventre rond, poitrail bombé, dessous plat (il flotte !). k large sur la première forme : sa boîte englobante
  // doit déborder des fondus plus doux posés ensuite (sinon un pli apparaît à la nuque)
  S.add(body, { t: 'ell', r: [0.35, 0.28, 0.43], p: [0, -0.02, -0.03], col: 'yellow', k: 0.12 });
  S.add(body, { t: 'ell', r: [0.29, 0.25, 0.27], p: [0, 0.03, 0.14], col: 'yellow', k: 0.1 });
  S.sub(body, { t: 'box', s: [0.6, 0.1, 0.7], p: [0, -0.36, 0], k: 0.07 });
  // croupion relevé, pointe retroussée
  S.add(body, { t: 'cone', a: [0, 0.0, -0.28], b: [0, 0.25, -0.55], r1: 0.2, r2: 0.05, sc: [0.8, 1, 1], col: 'yellow', k: 0.12 });
  S.add(body, { t: 'cone', a: [0, 0.25, -0.54], b: [0, 0.35, -0.58], r1: 0.045, r2: 0.018, col: 'yellow', k: 0.05 });
  // ailes en relief, plumes moulées au bout
  for (const s of [-1, 1]) {
    const w = B(body, [s * 0.31, 0.05, -0.08], s > 0 ? 'aileD' : 'aileG', [0.38, s * 0.3, s * 0.28]);
    S.add(w, { t: 'ell', r: [0.065, 0.15, 0.24], p: [0, 0, 0.02], col: 'yellow', k: 0.04 });
    // pointe arrière relevée, deux plumes moulées en sillons doux
    S.add(w, { t: 'cone', a: [0, 0.02, -0.12], b: [s * -0.05, 0.1, -0.27], r1: 0.06, r2: 0.025, sc: [0.8, 1, 1], col: 'yellow', k: 0.04 });
    for (const [y, z] of [[0.04, -0.15], [-0.04, -0.13]]) {
      S.sub(w, { t: 'ell', r: [0.03, 0.026, 0.1], p: [s * 0.082, y, z], rot: [0.5 + y * 4, 0, 0], col: 'yellowD', k: 0.03 });
    }
  }
  // dessous : sifflet (bouchon blanc encastré, trou) et marquage moulé (un écrou en relief)
  S.sub(body, { t: 'cyl', r: 0.075, h: 0.02, p: [0, -0.27, 0.02], col: 'yellowD', k: 0.02 });
  S.add(body, { t: 'cyl', r: 0.058, h: 0.01, p: [0, -0.256, 0.02], col: 'plug', k: 0.008, round: 0.008 });
  S.sub(body, { t: 'cyl', r: 0.022, h: 0.02, p: [0, -0.265, 0.02], col: 'orangeD', k: 0.008 });
  S.add(body, { t: 'hex', r: 0.045, h: 0.012, p: [0, -0.262, -0.2], col: 'yellow', k: 0.01, round: 0.004 });
  S.sub(body, { t: 'cyl', r: 0.02, h: 0.012, p: [0, -0.268, -0.2], col: 'yellowD', k: 0.004 });

  const head = B(body, [0, 0.37, 0.2], 'head');
  S.add(head, { t: 'sph', r: HEAD_R, col: 'yellow', k: 0.1 });
  // cou : raccord doux entre tête et corps (pas de pli où le contour percerait)
  S.add(head, { t: 'ell', r: [0.16, 0.11, 0.17], p: [0, -0.17, -0.02], col: 'yellow', k: 0.08 });
  // joues rebondies, rosies
  for (const s of [-1, 1]) {
    S.add(head, { t: 'ell', r: [0.1, 0.085, 0.1], p: [s * 0.115, -0.075, 0.1], col: 'yellow', k: 0.08 });
    S.paint(head, { t: 'sph', r: 0.045, p: [s * 0.175, -0.085, 0.165], col: 'blush', feather: 0.035 });
  }
  // bec en deux parties : mandibule haute (narines), mandibule basse, fente du sourire
  S.add(head, { t: 'ell', r: [0.15, 0.05, 0.15], p: [0, -0.035, 0.265], rot: [-0.15, 0, 0], col: 'orange', k: 0.03 });
  S.add(head, { t: 'ell', r: [0.105, 0.032, 0.09], p: [0, -0.092, 0.235], rot: [0.1, 0, 0], col: 'orange', k: 0.02 });
  S.sub(head, { t: 'ell', r: [0.15, 0.012, 0.1], p: [0, -0.075, 0.3], rot: [-0.06, 0, 0], col: 'orangeD', k: 0.012 });
  for (const s of [-1, 1]) {
    S.sub(head, { t: 'ell', r: [0.035, 0.015, 0.03], p: [s * 0.13, -0.066, 0.22], rot: [0, 0, s * 0.5], col: 'orangeD', k: 0.02 });
    S.sub(head, { t: 'ell', r: [0.016, 0.016, 0.022], p: [s * 0.036, 0.03, 0.34], rot: [-0.3, 0, 0], k: 0.012 });
    S.paint(head, { t: 'ell', r: [0.011, 0.04, 0.016], p: [s * 0.036, 0.02, 0.34], rot: [-0.3, 0, 0], col: 'orangeD', feather: 0.006 });
  }
  // mèche bouclée sur le crâne
  S.add(head, { t: 'cone', a: [0, 0.2, 0.02], b: [0, 0.31, -0.03], r1: 0.05, r2: 0.022, col: 'yellow', k: 0.04 });
  S.add(head, { t: 'cone', a: [0, 0.31, -0.03], b: [0, 0.325, -0.09], r1: 0.022, r2: 0.014, col: 'yellow', k: 0.015 });
  S.add(head, { t: 'sph', r: 0.017, p: [0, 0.305, -0.105], col: 'yellow', k: 0.012 });

  // lignes de moulage : filet plus clair dans le plan médian (les deux coquilles du moule)
  S.paint(body, { t: 'box', s: [0.004, 0.4, 0.6], p: [0, 0.05, 0], col: 'seam', feather: 0.008 });
  S.paint(head, { t: 'box', s: [0.004, 0.4, 0.3], p: [0, 0, -0.12], col: 'seam', feather: 0.008 });

  skin('canard', { mesh: { cell: 0.016, skinSoft: 0.03 }, mat: { enemyRim: true, sheenColor: '#fff3b8', coatRough: 0.22 }, outline: 0.015 });

  // yeux peints (pastilles qui épousent la tête)
  const [gw, gp, gh] = eyeGeos();
  const add = (g, m) => { const o = new THREE.Mesh(g, m); o.castShadow = false; head.add(o); return o; };
  add(gw, mat('#fffaf0', { rough: 0.3, coat: 0.6, coatRough: 0.15 }));
  add(gp, mat('#16100c', { rough: 0.25, coat: 1, coatRough: 0.05 }));
  add(gh, glow('#ffffff', 1.3));
  return { root, debrisColor: '#ffc61a', body, head, chunks: [] };
}
