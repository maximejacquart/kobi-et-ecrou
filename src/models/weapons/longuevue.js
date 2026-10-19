// Longue-Vue : fusil de précision façon longue-vue de marine (canon vers +Z, poignée à l'origine vers −Y).
// Canon télescopique en laiton (trois tubes emboîtés, bagues moletées, pavillon d'objectif), carcasse et crosse
// évidée laquées bleu nuit (filet gravé), lunette gainée de cuir à bagues dorées, tourelles de réglage en barres de
// navire, compas de marine et hublot sur les flancs, prise avant caoutchouc pour la main gauche.
// v2 « Perforante » : bobines d'accélération rouges sur le canon, tête de perforation à trois éperons, chargeur à
// fenêtre (balles-aiguilles), télémètre accolé à la lunette, crosse à arête.
// Pièces rigides fusionnées par matériau (une géométrie par variante, partagée). Le laiton est porté par les
// couleurs de sommets sur un matériau clair : la finition Méga, qui ne garde pas ces couleurs, le change en or pur.
import * as THREE from 'three';
import { G, mtx, mergeGeometries } from '../geo.js';
import { mat, glow } from '../../engine/materials.js';
import { build } from '../../engine/textures.js';
import { fbm2, noise2 } from '../../engine/util.js';

const HP = Math.PI / 2, TAU = Math.PI * 2;
const RZ = [HP, 0, 0]; // axe Y des cylindres et des tours → axe Z (le long du canon)
const BRASS = new THREE.Color('#e0a63e'), BRASS_D = new THREE.Color('#b47c2c'), BRASS_L = new THREE.Color('#ffd27a');

// ------------------------------------------------------------------ textures (niveaux de gris, la teinte vient du matériau)
// Laque : marbrure légère, filet gravé à 11 % du bord de chaque face, vernis éclairci par l'usure aux arêtes
function laqueTex() {
  return build('arme-longuevue-laque', 256, (u, v, o) => {
    const n = fbm2(u * 6, v * 6, 4, 811, 6);
    let c = 0.84 + (n - 0.5) * 0.14, h = 0.5 + (n - 0.5) * 0.06;
    const e = Math.min(u, 1 - u, v, 1 - v);
    const d = Math.abs(e - 0.11);
    if (d < 0.009) { c += 0.16 * (1 - d / 0.009); h -= 0.35 * (1 - d / 0.009); }
    const lim = 0.035 + fbm2(u * 14, v * 14, 3, 823, 14) * 0.05;
    if (e < lim) c += 0.12 * (1 - e / lim);
    if (noise2(u * 3, v * 120, 829, 120) > 0.94) c += 0.06;
    o[0] = o[1] = o[2] = Math.min(1, c);
    return h;
  }, 2);
}
// Cuir : grain, coutures en pointillés près des deux bords (v) et leur sillon
function cuirTex() {
  return build('arme-longuevue-cuir', 256, (u, v, o) => {
    const g = fbm2(u * 20, v * 20, 3, 831, 20);
    const g2 = noise2(u * 64, v * 64, 837, 64);
    let c = 0.8 + (g - 0.5) * 0.32 + (g2 - 0.5) * 0.08, h = 0.45 + g * 0.3 + g2 * 0.12;
    for (const sv of [0.12, 0.88]) {
      const dv = Math.abs(v - sv);
      if (dv < 0.014 && (u * 36) % 1 < 0.62) { c = 1; h = 0.85; }
      else if (dv < 0.03) { c *= 0.85; h -= 0.12; }
    }
    o[0] = o[1] = o[2] = Math.min(1, c);
    return h;
  }, 2.5);
}

// ------------------------------------------------------------------ assemblage par matériau
const CACHE = new Map();
const KEEP = ['position', 'normal', 'uv'];
function kit() {
  const L = {};
  // ajoute une pièce placée ; c : teinte du laiton (couleurs de sommets, matériau « brass » seulement)
  const add = (k, geo, p = [0, 0, 0], r = [0, 0, 0], s = 1, c) => {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(mtx(p, r, s));
    for (const a of Object.keys(g.attributes)) if (!KEEP.includes(a) && !(k === 'brass' && a === 'color')) g.deleteAttribute(a);
    if (k === 'brass' && !g.attributes.color) {
      const col = c || BRASS, n = g.attributes.position.count, arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    }
    (L[k] ||= []).push(g);
  };
  const done = () => {
    const out = {};
    for (const k in L) { out[k] = mergeGeometries(L[k]); for (const g of L[k]) g.dispose(); }
    return out;
  };
  return { add, done };
}
// sous-ensemble fusionné (repère local), à replacer ensuite avec add()
function sub(make) {
  const K = kit();
  make(K.add);
  return K.done();
}
const lathe = (pts, segs = 16) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);
// Profil latéral (points [z, y], ou [cz, cy, z, y] pour une courbe) extrudé sur la largeur (X), arêtes biseautées ; UV planes recadrées sur le profil
// (le filet gravé de la laque suit ainsi le contour de la pièce)
function profile(pts, width, bevel, holes = [], bseg = 2, cseg = 4) {
  const trace = (path, list) => {
    path.moveTo(list[0][0], list[0][1]);
    for (const q of list.slice(1)) if (q.length === 4) path.quadraticCurveTo(q[0], q[1], q[2], q[3]); else path.lineTo(q[0], q[1]);
    return path;
  };
  const sh = trace(new THREE.Shape(), pts);
  for (const h of holes) sh.holes.push(trace(new THREE.Path(), h));
  const d = width - 2 * bevel;
  const g = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: bseg, curveSegments: cseg });
  g.translate(0, 0, -d / 2);
  g.computeBoundingBox();
  const b = g.boundingBox, p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - b.min.x) / (b.max.x - b.min.x), (p.getY(i) - b.min.y) / (b.max.y - b.min.y));
  g.rotateY(-HP); // X du profil → Z
  return g;
}

// Pavé chanfreiné léger (≈ 28 triangles) : rectangle extrudé, biseau d'un segment
function cbox(w, h, d, b) {
  const g = profile([[-d / 2 + b, -h / 2 + b], [d / 2 - b, -h / 2 + b], [d / 2 - b, h / 2 - b], [-d / 2 + b, h / 2 - b]], w, b, [], 1);
  return g;
}

// Barre de navire (axe Y local) : moyeu, jante, 8 rayons et leurs poignées
function shipWheel(R) {
  return sub((add) => {
    add('brass', G.cyl(R * 0.32, R * 0.36, R * 0.7, 8), [0, 0, 0], [0, 0, 0], 1, BRASS_D);
    add('brass', G.torus(R, R * 0.12, 3, 10), [0, 0, 0], [HP, 0, 0]);
    // rayons traversants : leurs bouts dépassent de la jante et font les poignées
    for (let i = 0; i < 4; i++) add('brass', G.box(R * 2.9, R * 0.16, R * 0.16), [0, 0, 0], [0, (i / 4) * Math.PI + Math.PI / 8, 0], 1, BRASS_L);
  }).brass;
}

// Vis à tête fendue (axe Y local)
function screw(r) {
  return sub((add) => {
    add('gun', G.cyl(r, r * 1.05, r * 0.5, 6, true), [0, 0, 0]);
    add('gun', new THREE.CircleGeometry(r, 6), [0, r * 0.25, 0], [-HP, 0, 0]);
    add('gun', G.box(r * 1.7, r * 0.3, r * 0.3), [0, r * 0.25, 0]);
  }).gun;
}

function geometry(v2) {
  const key = v2 ? 'v2' : 'base';
  if (CACHE.has(key)) return CACHE.get(key);
  const { add, done } = kit();
  const SCR = screw(0.0075);
  const BY = 0.05; // axe du canon

  // ---------------- carcasse laquée (profil : nez chanfreiné, ventre plat, talon arrondi)
  add('laque', profile([[-0.09, 0.03], [-0.065, 0.006], [0.2, 0.006], [0.23, 0.016], [0.252, 0.016], [0.252, 0.08], [0.232, 0.088], [-0.09, 0.088]], 0.088, 0.01));
  add('gun', cbox(0.05, 0.02, 0.3, 0.006), [0, 0.103, 0.08]); // rail de lunette
  for (let i = 0; i < 7; i++) add('gun', G.box(0.056, 0.006, 0.014), [0, 0.114, -0.03 + i * 0.037]); // crans du rail
  // flasques de laiton sur les deux flancs, vissées
  for (const sx of [-1, 1]) {
    add('brass', G.box(0.008, 0.06, 0.19), [sx * 0.045, 0.045, 0.035], [0, 0, 0], 1, BRASS_D);
    for (const [y, z] of [[0.065, -0.045], [0.025, 0.115]]) add('gun', SCR, [sx * 0.0495, y, z], [0, 0, -sx * HP]);
    // plaque au centre de la flasque
    add('brass', G.box(0.003, sx > 0 ? 0.04 : 0.022, 0.06), [sx * 0.0495, 0.045, 0.035], [0, 0, 0], 1, BRASS_L);
  }
  // ancre de marine incrustée sur la plaque droite (le côté que voit le joueur)
  {
    const x = 0.0515, y = 0.046, z = 0.035;
    add('gun', G.box(0.002, 0.024, 0.003), [x, y, z]);
    add('gun', G.box(0.002, 0.003, 0.015), [x, y + 0.008, z]);
    add('gun', G.torus(0.0035, 0.0012, 3, 8), [x, y + 0.0155, z], [0, HP, 0]);
    add('gun', G.torus(0.01, 0.0015, 3, 8, Math.PI), [x, y - 0.002, z], [0, HP, Math.PI]);
    for (const sz of [-1, 1]) add('gun', G.cone(0.0028, 0.006, 4), [x, y - 0.001, z + sz * 0.0105], [0, 0, 0]);
  }
  // compas de marine (flanc gauche) : cuvette de laiton, rose sombre, aiguille, verre bombé
  {
    const cz = 0.2, cy = 0.047, cx = -0.044;
    add('brass', lathe([[0.001, 0], [0.031, 0], [0.032, 0.006], [0.025, 0.008], [0.023, 0.003], [0.001, 0.003]], 12), [cx, cy, cz], [0, 0, HP], 1, BRASS_L);
    add('brass', G.cyl(0.023, 0.023, 0.002, 12), [cx - 0.004, cy, cz], [0, 0, HP], 1, new THREE.Color('#fff1c8'));
    for (let i = 0; i < 4; i++) add('gun', G.box(0.001, 0.038, 0.0018), [cx - 0.0052, cy, cz], [i * Math.PI / 4, 0, 0]);
    add('gun', G.box(0.002, 0.034, 0.005), [cx - 0.0062, cy, cz], [0.5, 0, 0]);
    add('glow', G.box(0.002, 0.017, 0.0052), [cx - 0.0066, cy + 0.0075, cz - 0.004], [0.5, 0, 0]);
    add('gun', G.cyl(0.004, 0.004, 0.004, 6), [cx - 0.007, cy, cz], [0, 0, HP]);
  }
  // hublot (flanc droit) : cellule d'énergie derrière une grille
  {
    const hz = 0.2, hy = 0.047, hx = 0.044;
    add('brass', lathe([[0.019, 0], [0.03, 0], [0.032, 0.005], [0.029, 0.01], [0.02, 0.009]], 12), [hx, hy, hz], [0, 0, -HP], 1, BRASS);
    add('glow', G.cyl(0.02, 0.02, 0.002, 12), [hx + 0.002, hy, hz], [0, 0, -HP]);
    for (const a of [0, HP]) add('gun', G.box(0.003, 0.04, 0.004), [hx + 0.006, hy, hz], [a, 0, 0]);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; add('gun', G.cyl(0.003, 0.003, 0.004, 5), [hx + 0.009, hy + Math.cos(a) * 0.025, hz + Math.sin(a) * 0.025], [0, 0, -HP]); }
  }
  // culasse à verrou (côté droit, +X) : boîtier, levier coudé, boule de laiton
  add('gun', G.cyl(0.02, 0.02, 0.12, 12), [0.028, 0.078, -0.03], RZ);
  add('brass', G.cyl(0.021, 0.021, 0.012, 12), [0.028, 0.078, -0.09], RZ, 1, BRASS_L);
  add('gun', G.cyl(0.007, 0.007, 0.075, 6), [0.075, 0.062, -0.07], [0, 0, 1.2]);
  add('brass', G.sphere(0.017, 8, 6), [0.11, 0.046, -0.07], [0, 0, 0], 1, BRASS_L);

  // ---------------- poignée pistolet (inclinée vers l'arrière), pontet, détente
  {
    // profil : trois bosses pour les doigts à l'avant, paume galbée à l'arrière, talon évasé
    const F = (t, k) => [0.012 - 0.034 * t + k * 0.96, -0.108 * t - k * 0.28];
    const pts = [F(0, 0)];
    for (const [a, b] of [[0, 0.3], [0.3, 0.62], [0.62, 0.92]]) pts.push([...F((a + b) / 2, 0.016), ...F(b, 0)]);
    pts.push([-0.018, -0.118], [-0.064, -0.118], [-0.068, -0.112], [-0.058, -0.05, -0.03, 0.004]);
    add('rubber', profile(pts, 0.044, 0.009));
    add('brass', cbox(0.05, 0.01, 0.062, 0.003), [0, -0.129, -0.041], [0, 0, 0], 1, BRASS_D);
  }
  add('brass', G.torus(0.038, 0.0055, 4, 10, Math.PI), [0, 0.0, 0.055], [0, HP, Math.PI]);
  add('gun', G.torus(0.022, 0.005, 4, 6, 1.6), [0, -0.008, 0.035], [0, HP, Math.PI * 0.8]);

  // ---------------- chargeur (sous la carcasse, devant le pontet)
  if (v2) {
    add('laque', cbox(0.05, 0.075, 0.08, 0.012), [0, -0.035, 0.155], [-0.12, 0, 0]);
    // fenêtre : balles-aiguilles visibles
    add('glass', G.box(0.0525, 0.034, 0.05), [0, -0.04, 0.156], [-0.12, 0, 0]);
    for (let i = 0; i < 3; i++) {
      const y = -0.03 - i * 0.011, z = 0.15 - (y + 0.04) * 0.12;
      for (const sx of [1]) {
        add('brass', G.cyl(0.0045, 0.0045, 0.028, 6, true), [sx * 0.0265, y, z - 0.008], RZ, 1, BRASS_L);
        add('glow', G.cone(0.0045, 0.016, 6), [sx * 0.0265, y, z + 0.014], RZ);
      }
    }
    add('brass', cbox(0.056, 0.012, 0.086, 0.004), [0, -0.075, 0.15], [-0.12, 0, 0], 1, BRASS_D);
  } else {
    add('laque', cbox(0.046, 0.06, 0.07, 0.012), [0, -0.025, 0.155], [-0.1, 0, 0]);
    add('brass', cbox(0.052, 0.012, 0.076, 0.004), [0, -0.057, 0.152], [-0.1, 0, 0], 1, BRASS_D);
  }

  // ---------------- crosse évidée : laque, appui-joue de cuir, plaque de couche en laiton, talon caoutchouc
  add('laque', profile(
    [[-0.072, 0.082], [-0.068, 0.015], [-0.075, -0.008, -0.11, -0.015], [-0.2, -0.042], [-0.25, -0.056, -0.278, -0.062],
      [-0.292, -0.062, -0.29, -0.045], [-0.29, 0.06], [-0.29, 0.078, -0.27, 0.078], [-0.12, 0.082]],
    0.056, 0.008, [[[-0.145, 0.03], [-0.145, 0.005, -0.17, 0.0], [-0.22, -0.014], [-0.242, -0.02, -0.242, 0.003], [-0.242, 0.024],
      [-0.242, 0.042, -0.224, 0.042], [-0.16, 0.042], [-0.145, 0.042, -0.145, 0.03]]], 2, 3,
  ));
  add('leather', cbox(0.05, 0.03, 0.15, 0.012), [0, 0.098, -0.19], [0.03, 0, 0]);
  add('brass', cbox(0.062, 0.15, 0.012, 0.006), [0, 0.003, -0.302], [-0.03, 0, 0], 1, BRASS_D);
  add('rubber', cbox(0.056, 0.145, 0.02, 0.008), [0, 0.003, -0.316], [-0.03, 0, 0]);
  for (const y of [-0.04, 0.045]) add('gun', SCR, [0, y, -0.309], [-HP - 0.03, 0, 0]);
  add('brass', G.torus(0.012, 0.0025, 4, 10), [0, -0.056, -0.25], [0, HP, 0]); // anneau de bretelle
  if (v2) {
    // arête dorsale et réglage de joue sur tiges de laiton
    add('laque', cbox(0.014, 0.04, 0.17, 0.006), [0, 0.118, -0.19], [0.03, 0, 0]);
    for (const z of [-0.135, -0.235]) add('brass', G.cyl(0.005, 0.005, 0.03, 6), [0.018, 0.09, z], [0, 0, 0], 1, BRASS_L);
  }

  // ---------------- canon télescopique : trois tubes emboîtés, bagues, pavillon
  add('brass', lathe([[0.03, 0], [0.05, 0], [0.052, 0.01], [0.05, 0.03], [0.046, 0.034], [0.042, 0.034]], 16), [0, BY, 0.255], RZ, 1, BRASS_D);
  // tube 1 : laque, gaine de cuir cousue, deux frettes
  add('laque', G.cyl(0.04, 0.04, 0.22, 16, true), [0, BY, 0.4], RZ);
  add('leather', G.cyl(0.0425, 0.0425, 0.13, 16, true), [0, BY, 0.4], RZ);
  for (const z of [0.328, 0.472]) add('brass', G.torus(0.042, 0.005, 3, 12), [0, BY, z]);
  // bague de sortie du tube 1, moletée
  add('brass', lathe([[0.038, 0], [0.047, 0.004], [0.047, 0.022], [0.043, 0.028], [0.033, 0.028]], 16), [0, BY, 0.5], RZ);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + 0.2; add('brass', G.box(0.004, 0.004, 0.016), [Math.cos(a) * 0.047, BY + Math.sin(a) * 0.047, 0.513], [0, 0, a], 1, BRASS_D); }
  // tube 2
  add('brass', G.cyl(0.032, 0.032, 0.2, 14, true), [0, BY, 0.62], RZ);
  add('brass', lathe([[0.03, 0], [0.038, 0.004], [0.038, 0.018], [0.034, 0.022], [0.026, 0.022]], 14), [0, BY, 0.71], RZ, 1, BRASS_D);
  // tube 3
  add('brass', G.cyl(0.025, 0.025, 0.16, 12, true), [0, BY, 0.8], RZ, 1, BRASS_L);
  if (v2) {
    // bobines d'accélération : spires sombres sur les tubes 2 et 3, entrefers rouges lumineux
    const coils = (z0, n, step, len, r0, r1, segs) => {
      const pts = [];
      for (let i = 0; i < n; i++) { const z = z0 + i * step; pts.push([r0, z], [r1, z + 0.003], [r1, z + len - 0.003], [r0, z + len]); }
      add('gun', lathe(pts, segs), [0, BY, 0], RZ);
      add('glow', G.cyl(r0 + 0.001, r0 + 0.001, (n - 1) * step + len, segs, true), [0, BY, z0 + ((n - 1) * step + len) / 2], RZ);
    };
    coils(0.54, 4, 0.04, 0.026, 0.035, 0.043, 10);
    coils(0.745, 3, 0.036, 0.022, 0.0275, 0.035, 8);
    // tête de perforation : collier, trois éperons vers l'avant, âme rouge
    add('brass', lathe([[0.022, 0], [0.04, 0.0], [0.044, 0.02], [0.04, 0.05], [0.03, 0.06], [0.018, 0.06]], 16), [0, BY, 0.875], RZ, 1, BRASS_D);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + HP, c = Math.cos(a), s = Math.sin(a);
      add('laque', G.cone(0.016, 0.11, 6), [c * 0.034, BY + s * 0.034, 0.965], RZ);
      add('gun', G.cone(0.0065, 0.05, 5), [c * 0.03, BY + s * 0.03, 1.0], RZ);
    }
    add('gun', G.cyl(0.018, 0.016, 0.07, 12), [0, BY, 0.95], RZ);
    add('glow', G.cyl(0.011, 0.011, 0.004, 12), [0, BY, 0.986], RZ);
  } else {
    // pavillon d'objectif (frein de bouche) : évasé, lèvre roulée, quatre lumières
    add('laque', lathe([[0.024, 0], [0.03, 0.01], [0.038, 0.05], [0.05, 0.085], [0.054, 0.09], [0.049, 0.09], [0.04, 0.07], [0.022, 0.06]], 14), [0, BY, 0.87], RZ);
    add('brass', G.torus(0.052, 0.006, 4, 16), [0, BY, 0.96], [0, 0, 0], 1, BRASS_L);
    add('brass', G.torus(0.029, 0.0045, 4, 14), [0, BY, 0.875]);
    add('gun', G.cyl(0.02, 0.02, 0.012, 12), [0, BY, 0.937], RZ);
    add('glow', G.cyl(0.011, 0.011, 0.004, 10), [0, BY, 0.944], RZ);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4;
      add('gun', G.box(0.008, 0.008, 0.03), [Math.cos(a) * 0.04, BY + Math.sin(a) * 0.04, 0.925], [Math.sin(a) * 0.35, -Math.cos(a) * 0.35, 0]);
    }
  }

  // ---------------- prise avant (main gauche) : collier, poignée caoutchouc annelée, molette de mise au point
  add('brass', G.cyl(0.046, 0.046, 0.024, 16), [0, BY, 0.36], RZ, 1, BRASS_D);
  add('laque', G.box(0.03, 0.035, 0.034), [0, 0.0, 0.36]);
  add('rubber', cbox(0.036, 0.085, 0.042, 0.016), [0, -0.05, 0.37], [-0.18, 0, 0]);
  for (let i = 0; i < 2; i++) add('rubber', G.torus(0.0215, 0.004, 3, 8), [0, -0.035 - i * 0.03, 0.372 + i * 0.005], [HP - 0.18, 0, 0], [0.9, 1.05, 1]);
  add('brass', G.cyl(0.022, 0.02, 0.012, 12), [0, -0.094, 0.378], [-0.18, 0, 0], 1, BRASS_D);
  add('brass', G.cyl(0.02, 0.02, 0.012, 14), [0.05, BY, 0.43], [0, 0, HP], 1, BRASS_L);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; add('brass', G.box(0.014, 0.003, 0.003), [0.05, BY + Math.cos(a) * 0.02, 0.43 + Math.sin(a) * 0.02], [a, 0, 0], 1, BRASS_D); }
  add('brass', G.torus(0.012, 0.0025, 4, 10), [0, BY - 0.045, 0.45], [0, HP, 0]); // anneau de bretelle

  // ---------------- lunette : tube gainé de cuir, bagues dorées, oculaire lumineux, pare-soleil, barres de navire
  const SY = 0.172;
  for (const z of [0.0, 0.17]) {
    add('gun', G.box(0.03, 0.05, 0.024), [0, 0.135, z]);
    add('brass', G.torus(0.04, 0.0065, 3, 12), [0, SY, z], [0, 0, 0], 1, BRASS_D);
    add('gun', SCR, [0.0155, 0.15, z], [0, 0, -HP]);
  }
  add('brass', G.cyl(0.032, 0.032, 0.25, 16, true), [0, SY, 0.08], RZ, 1, BRASS_D);
  add('leather', G.cyl(0.0345, 0.0345, 0.12, 16, true), [0, SY, 0.085], RZ);
  for (const z of [0.025, 0.145]) add('brass', G.torus(0.035, 0.004, 3, 12), [0, SY, z]);
  // oculaire (vers Kobi) : bague, bonnette caoutchouc, lentille lumineuse
  add('brass', lathe([[0.03, 0], [0.034, 0.005], [0.034, 0.045], [0.028, 0.06], [0.026, 0.065]], 16), [0, SY, -0.045], [-HP, 0, 0]);
  add('rubber', lathe([[0.024, 0], [0.031, 0.004], [0.033, 0.02], [0.03, 0.026], [0.022, 0.024], [0.02, 0.01]], 12), [0, SY, -0.105], [-HP, 0, 0]);
  add('glow', G.cyl(0.018, 0.018, 0.004, 12), [0, SY, -0.122], RZ);
  // objectif : pavillon évasé + pare-soleil, verre sombre et cœur lumineux
  add('brass', lathe([[0.032, 0], [0.034, 0.01], [0.044, 0.06], [0.047, 0.06], [0.047, 0.11], [0.051, 0.115], [0.051, 0.122], [0.043, 0.122], [0.042, 0.075]], 14), [0, SY, 0.2], RZ, 1, BRASS);
  add('glass', G.cyl(0.042, 0.042, 0.004, 18), [0, SY, 0.272], RZ);
  add('glow', G.cyl(0.016, 0.016, 0.004, 12), [0, SY, 0.275], RZ);
  add('brass', G.torus(0.046, 0.004, 4, 14), [0, SY, 0.205], [0, 0, 0], 1, BRASS_L);
  // tourelles en barres de navire : élévation (dessus) et dérive (droite)
  const W1 = shipWheel(0.026);
  add('gun', G.cyl(0.014, 0.016, 0.02, 10), [0, SY + 0.04, 0.085]);
  add('brass', W1, [0, SY + 0.057, 0.085], [0, 0.2, 0]);
  add('gun', G.cyl(0.014, 0.016, 0.02, 10), [0.04, SY, 0.085], [0, 0, -HP]);
  add('brass', W1, [0.057, SY, 0.085], [0, 0, -HP], 0.75);
  if (v2) {
    // télémètre accolé (gauche) : petit tube, lentille rouge, câble vers la carcasse
    add('laque', cbox(0.028, 0.028, 0.15, 0.008), [-0.05, SY - 0.004, 0.11]);
    add('glow', G.cyl(0.009, 0.009, 0.004, 10), [-0.05, SY - 0.004, 0.187], RZ);
    add('brass', G.torus(0.012, 0.003, 4, 10), [-0.05, SY - 0.004, 0.186], [0, 0, 0], 1, BRASS_L);
    add('gun', G.box(0.012, 0.03, 0.02), [-0.04, SY - 0.03, 0.11]);
  }

  const out = done();
  for (const k in out) out[k].userData.shared = true;
  CACHE.set(key, out);
  return out;
}

export function longuevue(v2) {
  const lq = laqueTex(), cu = cuirTex();
  const M = {
    laque: mat(v2 ? '#3a3a86' : '#34458f', { map: lq.map, normalMap: lq.normalMap, normalScale: 0.6, rough: 0.3, metal: 0.45, coat: 0.9 }),
    // laiton : teinte dans les couleurs de sommets (la Méga, sans elles, devient de l'or)
    brass: mat('#ffffff', { rough: 0.24, metal: 0.95, coat: 0.5, vertexColors: true }),
    gun: mat('#2e2c3a', { rough: 0.36, metal: 0.8 }),
    rubber: mat('#1f1b27', { rough: 0.86 }),
    leather: mat('#7a4a2c', { map: cu.map, normalMap: cu.normalMap, rough: 0.62, sheen: 0.35, sheenColor: '#d8a070' }),
    glass: mat('#0f1838', { rough: 0.05, metal: 0.6, coat: 1 }),
    glow: glow(v2 ? '#ff4f6d' : '#7ff3ff', 2.2),
  };
  const geos = geometry(v2);
  const g = new THREE.Group();
  for (const k in geos) {
    const m = new THREE.Mesh(geos[k], M[k]);
    m.castShadow = true;
    g.add(m);
  }
  g.userData.muzzles = [new THREE.Vector3(0, 0.05, v2 ? 0.99 : 0.97)];
  g.userData.grip = new THREE.Vector3(-0.015, -0.05, 0.37); // main gauche (prise avant), voir leftGrip dans hero.js
  return g;
}
