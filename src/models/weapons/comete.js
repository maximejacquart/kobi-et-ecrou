// Lance-Comète : lance-roquettes d'épaule à tête chercheuse (canon vers +Z, poignée à l'origine).
// Tube peint « galaxie » (violet laqué, nébuleuses et étoiles), couronne-étoile à la bouche, comète chargée qui luit
// au fond du canon, tuyère arrière à anneau rougeoyant, trois ailerons, viseur de ciblage sur le flanc droit (écran
// réticulé tourné vers le tireur, radar qui tourne), poignée-pistolet et prise avant pour la main gauche.
// v2 « Lance-Supernova » : couronne en éclat à quatre branches, quatre nacelles à mini-comètes entre les branches,
// fenêtres de chambre incandescentes, ailerons acérés, antenne à étoile.
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { G, part, mtx, mergeGeometries } from '../geo.js';
import { mat, glow } from '../../engine/materials.js';
import { build, paintedMetalTexture, fbmP, noiseP, sstep, mix3 } from '../../engine/textures.js';

const HP = Math.PI / 2;
const Y0 = 0.11; // axe du tube

// ------------------------------------------------------------------ aides
const at = (geo, p, r = [0, 0, 0], s = 1) => (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(mtx(p, r, s));
// boîte chanfreinée à facettes (44 triangles, arêtes nettes qui accrochent la lumière), UV de 0 à 1 par face ;
// seg : boîte arrondie lisse de Three.js (pièces maîtresses)
const CB = new Map();
function cbox(w, h, d, c) {
  const k = [w, h, d, c].join('|');
  let g = CB.get(k);
  if (!g) {
    const pts = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      pts.push(new THREE.Vector3(sx * w / 2, sy * (h / 2 - c), sz * (d / 2 - c)), new THREE.Vector3(sx * (w / 2 - c), sy * h / 2, sz * (d / 2 - c)), new THREE.Vector3(sx * (w / 2 - c), sy * (h / 2 - c), sz * d / 2));
    }
    g = new ConvexGeometry(pts);
    const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
      const x = p.getX(i) / w + 0.5, y = p.getY(i) / h + 0.5, z = p.getZ(i) / d + 0.5;
      if (ax >= ay && ax >= az) uv.set([z, y], i * 2);
      else if (ay >= az) uv.set([x, z], i * 2);
      else uv.set([x, y], i * 2);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    CB.set(k, g);
  }
  return g;
}
const rb = (w, h, d, r, seg = 0) => (seg ? G.rbox(w, h, d, r, seg) : cbox(w, h, d, r));
// pièce de révolution d'axe Z, profil [rayon, z]
const lz = (key, pts, segs = 24) => G.lathe('cmt' + key, pts, segs);
const onTube = (geo, z) => at(geo, [0, Y0, 0], [HP, 0, 0]).translate(0, 0, z);
// rivet bombé (demi-sphère tournée vers +Y)
let RIVET;
const rivet = () => RIVET || (RIVET = new THREE.SphereGeometry(1, 6, 2, 0, Math.PI * 2, 0, HP).scale(1, 0.55, 1));
// rivets en couronne autour du tube
function rivetRing(L, R, z, n, s = 0.008, a0 = 0) {
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    L.push(at(rivet(), [Math.cos(a) * R, Y0 + Math.sin(a) * R, z], [0, 0, a - HP], s));
  }
}
// étoile extrudée dans le plan XY (épaisseur selon Z), pointe vers le haut, trou central optionnel (rond, ou en
// étoile [rOut, rIn] pour un liseré)
function starGeo(n, rOut, rIn, depth, hole = 0, bevel = 0.005) {
  const sh = new THREE.Shape();
  for (let i = 0; i < n * 2; i++) {
    const a = HP + (i / (n * 2)) * Math.PI * 2;
    const r = i % 2 ? rIn : rOut;
    if (i === 0) sh.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else sh.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  sh.closePath();
  if (Array.isArray(hole)) { // trou en étoile (liseré)
    const h = new THREE.Path();
    for (let i = n * 2 - 1; i >= 0; i--) {
      const a = HP + (i / (n * 2)) * Math.PI * 2, r = i % 2 ? hole[1] : hole[0];
      if (i === n * 2 - 1) h.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else h.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    h.closePath();
    sh.holes.push(h);
  } else if (hole) { const h = new THREE.Path(); h.absarc(0, 0, hole, 0, Math.PI * 2, true); sh.holes.push(h); }
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 10 });
  g.translate(0, 0, -depth / 2);
  // UV ramenées à la taille de la pièce (le motif de peinture suit la forme)
  const uv = g.attributes.uv, k = 0.5 / rOut;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k + 0.5, uv.getY(i) * k + 0.5);
  return g;
}
// aileron : profil (z, rayon) extrudé en épaisseur, posé sur le tube à l'angle a (autour de Z)
function fin(pts, thick, a) {
  const sh = new THREE.Shape();
  pts.forEach(([z, r], i) => (i ? sh.lineTo(z, r) : sh.moveTo(z, r)));
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1 });
  g.translate(0, 0, -thick / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + 0.25) * 2.2, (uv.getY(i) - 0.08) * 6);
  g.rotateY(-HP); // X du profil -> Z du tube
  return at(g, [0, Y0, 0], [0, 0, a - HP]);
}

// ------------------------------------------------------------------ peinture « galaxie » du tube
// Luminance teintée (multipliée par la couleur du matériau) : fond profond, nébuleuses rosées et bleutées, étoiles
// claires (quelques-unes en scintillement à 4 branches), joints de panneaux gravés. u fait le tour du tube (raccord à
// u = 0, sous le tube), v court le long du tube.
function hash(x, y, s) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function galaxyTexture() {
  const pink = [1.0, 0.72, 0.9], blue = [0.62, 0.8, 1.0], deep = [0.36, 0.33, 0.46], deepL = deep.map((c) => c * 1.25);
  const milk = [0.85, 0.8, 0.95], white = [1, 1, 1], groove = [0.16, 0.13, 0.22];
  const N = 22;
  return build('arme-comete-galaxie', 256, (u, v, out) => {
    const n1 = fbmP(u * 4, v * 4, 4, 4, 3, 801);
    const n2 = fbmP(u * 3 + 1.7, v * 3, 3, 3, 2, 813);
    const bands = fbmP(u * 2 + v * 2, v * 6, 2, 6, 2, 827); // traînées obliques de la voie lactée
    mix3(out, deep, deepL, noiseP(u * 24, v * 24, 24, 24, 831));
    mix3(out, out, pink, sstep(0.48, 0.78, n1) * 0.75);
    mix3(out, out, blue, sstep(0.52, 0.8, n2) * 0.6);
    mix3(out, out, milk, sstep(0.55, 0.85, bands) * 0.35);
    let h = 0.5;
    // étoiles : une par cellule au plus (tenue dans sa cellule), position et éclat au hasard
    const x = u * N, y = v * N, cx = Math.floor(x) % N, cy = Math.floor(y) % N;
    let star = 0;
    const p = hash(cx, cy, 7);
    if (p < 0.55) {
      const dx = x - cx - 0.3 - hash(cx, cy, 11) * 0.4, dy = y - cy - 0.3 - hash(cx, cy, 13) * 0.4, d = Math.hypot(dx, dy);
      const big = p < 0.07;
      const r = big ? 0.13 : 0.05 + hash(cx, cy, 17) * 0.06;
      star = 1 - sstep(r * 0.4, r, d);
      if (big) star = Math.max(star, (1 - sstep(0, 0.045, Math.abs(dx))) * (1 - sstep(0.06, 0.3, Math.abs(dy))), (1 - sstep(0, 0.045, Math.abs(dy))) * (1 - sstep(0.06, 0.3, Math.abs(dx))));
      star *= 0.6 + hash(cx, cy, 19) * 0.4;
    }
    mix3(out, out, white, star);
    // joints gravés : deux anneaux autour du tube, une ligne sur le dessus
    const ev = Math.min(Math.abs(v - 0.34), Math.abs(v - 0.67));
    const eu = Math.abs(u - 0.5);
    const seam = Math.max(1 - sstep(0.004, 0.009, ev), 1 - sstep(0.002, 0.005, eu));
    if (seam > 0) { mix3(out, out, groove, seam * 0.9); h -= seam * 0.4; }
    else if (ev < 0.016 || eu < 0.009) { mix3(out, out, white, 0.12); h += 0.05; }
    return h + star * 0.04;
  }, 2);
}

// ------------------------------------------------------------------ matériaux (8)
function mats(v2) {
  const gx = galaxyTexture();
  // plaques blanches : même texture que le plastron de Lunette (déjà en cache s'il est passé par là)
  const pw = paintedMetalTexture('#eceaf6', 'lunette-blanc', { chip: 0.22, edge: 0.7, rust: 0.03, bare: '#9aa0b4' });
  return {
    paint: mat(v2 ? '#d0a0ff' : '#b98aff', { map: gx.map, normalMap: gx.normalMap, normalScale: 0.6, rough: 0.28, metal: 0.35, coat: 0.9, coatRough: 0.05 }),
    white: mat('#ffffff', { map: pw.map, normalMap: pw.normalMap, rough: 0.34, metal: 0.15, coat: 0.7 }),
    dark: mat('#2e2a3c', { rough: 0.32, metal: 0.8, coat: 0.25 }),
    steel: mat('#d2d5de', { rough: 0.24, metal: 0.92 }),
    rubber: mat('#221d2c', { rough: 0.82 }),
    glass: mat('#121018', { rough: 0.04, metal: 0.5, coat: 1 }),
    comet: glow(v2 ? '#ff8ad0' : '#d890ff', v2 ? 3 : 2.8),
    target: glow('#ff3a4a', 3),
  };
}

// ------------------------------------------------------------------ géométries (fusionnées par matériau, en cache)
const CACHE = new Map();
function geometries(v2) {
  const key = v2 ? 'v2' : 'base';
  if (CACHE.has(key)) return CACHE.get(key);
  const L = { paint: [], white: [], dark: [], steel: [], rubber: [], glass: [], comet: [], target: [] };

  // ---- tube peint
  L.paint.push(onTube(lz('Body', [[0.099, -0.19], [0.104, -0.11], [0.106, -0.02], [0.106, 0.1], [0.106, 0.22], [0.101, 0.33]], 28), 0));
  // ---- tuyère arrière : pavillon évasé, cône intérieur sombre, anneau incandescent
  L.dark.push(onTube(lz('Bell', [[0.1, -0.165], [0.116, -0.175], [0.13, -0.245], [0.122, -0.256], [0.104, -0.236], [0.05, -0.208], [0.001, -0.198]], 22), 0));
  L.comet.push(at(G.torus(0.09, 0.008, 3, 22), [0, Y0, -0.236])); // anneau rougeoyant au fond du pavillon
  L.steel.push(onTube(lz('Nub', [[0.001, -0.205], [0.028, -0.207], [0.02, -0.226], [0.001, -0.23]], 8), 0));
  // ---- bagues sombres et cerclages d'acier
  // bague arrière sombre rivetée, cerclage d'acier au milieu
  L.dark.push(onTube(lz('Band', [[0.103, -0.016], [0.113, -0.012], [0.116, 0], [0.113, 0.012], [0.103, 0.016]], 20), -0.162));
  rivetRing(L.steel, 0.116, -0.162, 6, 0.0075, Math.PI / 6);
  L.steel.push(onTube(lz('Hoop', [[0.105, -0.008], [0.111, -0.006], [0.111, 0.006], [0.105, 0.008]], 24), 0.06));
  // ---- bouche : buse sombre, âme d'acier, comète chargée qui luit au fond
  L.dark.push(onTube(lz('Nozzle' + key, v2
    ? [[0.1, 0.33], [0.113, 0.338], [0.114, 0.4], [0.134, 0.497], [0.13, 0.51], [0.108, 0.508], [0.096, 0.46]]
    : [[0.1, 0.33], [0.113, 0.338], [0.114, 0.4], [0.125, 0.49], [0.12, 0.503], [0.104, 0.5], [0.096, 0.46]], 22), 0));
  L.steel.push(onTube(lz('Bore', [[0.0955, 0.461], [0.0955, 0.37], [0.04, 0.36], [0.001, 0.358]], 16), 0));
  L.steel.push(at(G.torus(v2 ? 0.121 : 0.114, 0.006, 4, 24), [0, Y0, v2 ? 0.508 : 0.501]));
  L.comet.push(at(G.sphere(0.062, 12, 8), [0, Y0, 0.42], [0, 0, 0], [1, 1, 1.25]));
  L.comet.push(at(G.cone(0.056, 0.07, 12), [0, Y0, 0.36], [-HP, 0, 0])); // traîne de la comète
  // ---- couronne de la bouche : étoile à cinq branches (base) ou éclat de supernova à quatre branches (v2)
  if (v2) {
    L.white.push(at(starGeo(4, 0.245, 0.122, 0.03, 0.113), [0, Y0, 0.43], [0, 0, 0]));
    L.comet.push(at(starGeo(4, 0.228, 0.13, 0.008, [0.2, 0.124], 0), [0, Y0, 0.4495])); // liseré incandescent
  } else {
    L.white.push(at(starGeo(5, 0.19, 0.122, 0.032, 0.113), [0, Y0, 0.425]));
    L.comet.push(at(starGeo(5, 0.172, 0.129, 0.008, [0.148, 0.122], 0), [0, Y0, 0.4465])); // liseré incandescent
  }
  // vis aux creux de la couronne (en v2, les nacelles prennent leur place)
  if (!v2) for (let i = 0; i < 5; i++) {
    const a = HP + ((i + 0.5) / 5) * Math.PI * 2;
    L.steel.push(at(G.cyl(0.009, 0.009, 0.01, 8), [Math.cos(a) * 0.118, Y0 + Math.sin(a) * 0.118, 0.443], [HP, 0, 0]));
  }
  // ---- v2 : quatre nacelles à mini-comètes entre les branches
  if (v2) {
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i / 4) * Math.PI * 2, R = 0.15;
      const x = Math.cos(a) * R, y = Y0 + Math.sin(a) * R;
      L.paint.push(at(G.cyl(0.03, 0.034, 0.15, 10), [x, y, 0.37], [HP, 0, 0]));
      L.dark.push(at(lz('Pod', [[0.03, 0.0], [0.037, 0.004], [0.037, 0.022], [0.026, 0.026], [0.024, 0.01]], 10), [x, y, 0.432], [HP, 0, 0]));
      L.comet.push(at(G.sphere(0.024, 8, 6), [x, y, 0.458], [0, 0, 0], [1, 1, 1.3]));
      // pied qui relie la nacelle au tube
      L.dark.push(at(rb(0.03, 0.05, 0.1, 0.008), [Math.cos(a) * 0.11, Y0 + Math.sin(a) * 0.11, 0.37], [0, 0, a - HP]));
    }
    // fenêtres de chambre : la supernova qui couve dans le tube
    for (const s of [-1, 1]) {
      L.dark.push(at(rb(0.02, 0.05, 0.15, 0.008), [s * 0.1, Y0 - 0.035, 0.15]));
      L.comet.push(at(G.box(0.006, 0.03, 0.12), [s * 0.111, Y0 - 0.035, 0.15]));
    }
  }

  // ---- trois ailerons à l'arrière (dérive sur le dessus : rien ne vient vers la tête de Kobi)
  const fp = v2
    ? [[-0.235, 0.1], [-0.27, 0.205], [-0.215, 0.19], [-0.15, 0.13], [-0.05, 0.1]]
    : [[-0.225, 0.1], [-0.235, 0.175], [-0.185, 0.17], [-0.06, 0.1]];
  for (const a of [HP, HP + (2 * Math.PI) / 3, HP + (4 * Math.PI) / 3]) {
    L.white.push(fin(fp, 0.014, a));
  }

  // ---- plaques latérales blanches : compteur de comètes (droite) et ouïes (gauche)
  for (const s of [-1, 1]) {
    L.white.push(at(rb(0.03, 0.1, 0.24, 0.012), [s * 0.104, Y0 + 0.005, -0.075]));
    for (const [y, z] of [[0.04, -0.18], [0.04, 0.03], [-0.03, -0.18], [-0.03, 0.03]]) L.steel.push(at(rivet(), [s * 0.12, Y0 + y, z], [0, 0, -s * HP], 0.0065));
    if (s > 0) {
      const n = v2 ? 4 : 3;
      L.dark.push(at(rb(0.012, 0.034, 0.03 * n + 0.02, 0.005), [0.12, Y0 + 0.02, -0.065]));
      for (let i = 0; i < n; i++) L.comet.push(at(G.sphere(0.01, 6, 4), [0.126, Y0 + 0.02, -0.065 + (i - (n - 1) / 2) * 0.03], [0, 0, 0], [0.6, 1, 1]));
    }
  }
  // ouïes (gauche) : quatre lamelles
  for (let i = 0; i < 4; i++) L.dark.push(at(G.box(0.012, 0.012, 0.13), [-0.122, Y0 + 0.035 - i * 0.02, -0.075], [0, 0, -0.5]));

  // ---- viseur de ciblage sur le flanc droit : boîtier blanc, bras sombre, lentille avant, écran réticulé à l'arrière
  const SX = 0.135, SY = Y0 + 0.115, SZ = 0.06;
  L.dark.push(at(rb(0.05, 0.06, 0.1, 0.012), [0.085, Y0 + 0.08, SZ], [0, 0, -0.75]));
  L.dark.push(at(rb(0.06, 0.016, 0.12, 0.006), [0.05, Y0 + 0.098, SZ], [0, 0, -0.5]));
  L.white.push(at(rb(0.085, 0.078, 0.15, 0.022, 1), [SX, SY, SZ]));
  L.dark.push(at(rb(0.092, 0.018, 0.13, 0.008), [SX, SY + 0.04, SZ]));
  // lentille avant : pare-soleil, verre, iris rouge
  L.dark.push(at(lz('Hood', [[0.026, 0.0], [0.036, 0.0], [0.04, 0.045], [0.034, 0.05], [0.028, 0.012]], 14), [SX, SY - 0.004, SZ + 0.072], [HP, 0, 0]));
  L.glass.push(at(G.cyl(0.028, 0.028, 0.004, 14), [SX, SY - 0.004, SZ + 0.09], [HP, 0, 0]));
  L.target.push(at(G.torus(0.014, 0.003, 3, 14), [SX, SY - 0.004, SZ + 0.093]));
  L.target.push(at(G.sphere(0.005, 6, 4), [SX, SY - 0.004, SZ + 0.093]));
  // écran arrière (vu du tireur) : cadre, vitre, réticule, crochets d'angle, comète-cible
  const ez = SZ - 0.077;
  L.dark.push(at(rb(0.078, 0.066, 0.012, 0.006), [SX, SY, ez]));
  L.glass.push(at(G.box(0.064, 0.052, 0.004), [SX, SY, ez - 0.006]));
  const rz = ez - 0.0085;
  L.target.push(at(G.torus(0.016, 0.0022, 3, 16), [SX, SY, rz]));
  L.target.push(at(G.box(0.05, 0.0028, 0.002), [SX, SY, rz]), at(G.box(0.0028, 0.04, 0.002), [SX, SY, rz]));
  for (const [cx, cy] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    L.target.push(at(G.box(0.01, 0.0026, 0.002), [SX + cx * 0.025, SY + cy * 0.021, rz]));
    L.target.push(at(G.box(0.0026, 0.009, 0.002), [SX + cx * 0.029, SY + cy * 0.018, rz]));
  }
  L.comet.push(at(G.sphere(0.005, 6, 4), [SX + 0.008, SY + 0.006, rz]));
  // boutons et vis du boîtier, visière au-dessus de l'écran
  L.dark.push(at(rb(0.088, 0.012, 0.03, 0.005), [SX, SY + 0.04, ez - 0.012], [0.35, 0, 0]));
  L.steel.push(at(G.cyl(0.009, 0.009, 0.012, 8), [SX + 0.046, SY + 0.012, SZ + 0.02], [0, 0, HP]));
  L.steel.push(at(G.cyl(0.009, 0.009, 0.012, 8), [SX + 0.046, SY + 0.012, SZ - 0.025], [0, 0, HP]));
  L.target.push(at(G.sphere(0.0055, 6, 4), [SX + 0.045, SY - 0.022, SZ + 0.04]));
  for (const [y, z] of [[0.026, 0.06], [0.026, -0.06], [-0.026, 0.06], [-0.026, -0.06]]) L.steel.push(at(rivet(), [SX + 0.0425, SY + y, SZ + z], [0, 0, -HP], 0.0055));
  // câble du viseur vers le corps de l'arme
  const cable = new THREE.CatmullRomCurve3([[SX - 0.02, SY - 0.035, ez + 0.02], [0.12, Y0 + 0.03, -0.045], [0.1, Y0 - 0.045, -0.02], [0.04, Y0 - 0.1, 0.0]].map((p) => new THREE.Vector3(...p)));
  L.rubber.push(new THREE.TubeGeometry(cable, 10, 0.0075, 5).toNonIndexed());

  // ---- poignée-pistolet : carcasse sombre, poignée caoutchouc rainurée, détente et pontet d'acier
  L.dark.push(at(rb(0.064, 0.05, 0.17, 0.014), [0, 0.0, 0.04]));
  L.dark.push(at(rb(0.05, 0.03, 0.04, 0.01), [0, -0.01, -0.03], [-0.3, 0, 0]));
  L.rubber.push(at(rb(0.056, 0.135, 0.074, 0.024, 1), [0, -0.065, -0.01], [-0.28, 0, 0]));
  for (let i = 0; i < 3; i++) L.rubber.push(at(rb(0.06, 0.014, 0.02, 0.006), [0, -0.035 - i * 0.034, 0.03 - i * 0.0095], [-0.28, 0, 0]));
  L.dark.push(at(rb(0.06, 0.016, 0.082, 0.007), [0, -0.135, -0.03], [-0.28, 0, 0]));
  L.steel.push(at(G.torus(0.032, 0.006, 4, 10, Math.PI), [0, -0.022, 0.085], [0, -HP, Math.PI]));
  L.steel.push(at(rb(0.012, 0.035, 0.012, 0.005), [0, -0.025, 0.075], [0.35, 0, 0]));
  L.steel.push(at(G.cyl(0.008, 0.008, 0.07, 8), [0, -0.005, 0.0], [0, 0, HP]));
  // coussin d'épaule caoutchouc sous l'arrière du tube
  L.rubber.push(at(rb(0.075, 0.03, 0.13, 0.012), [0, Y0 - 0.106, -0.1]));
  for (let i = 0; i < 4; i++) L.rubber.push(at(G.box(0.08, 0.008, 0.012), [0, Y0 - 0.12, -0.15 + i * 0.033]));

  // ---- prise avant (main gauche) : collier, poignée inclinée vers la gauche, embout d'acier
  const FZ = 0.24;
  L.dark.push(at(lz('Clamp', [[0.104, -0.022], [0.113, -0.02], [0.115, 0], [0.113, 0.02], [0.104, 0.022]], 20), [0, Y0, FZ], [HP, 0, 0]));
  L.dark.push(at(rb(0.05, 0.04, 0.06, 0.012), [-0.008, Y0 - 0.12, FZ]));
  L.rubber.push(at(G.cyl(0.024, 0.027, 0.1, 12), [-0.022, Y0 - 0.19, FZ + 0.012], [0.18, 0, 0.22]));
  for (let i = 0; i < 2; i++) L.rubber.push(at(G.torus(0.026, 0.005, 3, 12), [-0.0185 - i * 0.01, Y0 - 0.17 - i * 0.034, FZ + 0.008 + i * 0.006], [HP + 0.18, 0, 0.22]));
  L.steel.push(at(G.cyl(0.029, 0.026, 0.014, 12), [-0.034, Y0 - 0.244, FZ + 0.022], [0.18, 0, 0.22]));
  rivetRing(L.steel, 0.115, FZ, 4, 0.007, Math.PI / 4);

  // ---- radar de tête chercheuse (sur le viseur) : socle fixe ici, coupole tournante à part
  L.dark.push(at(G.cyl(0.012, 0.016, 0.024, 10), [SX - 0.012, SY + 0.058, SZ + 0.03]));
  if (v2) {
    // antenne à étoile côté gauche
    L.dark.push(at(G.cyl(0.012, 0.014, 0.02, 8), [-0.06, Y0 + 0.095, -0.12]));
    L.steel.push(at(G.cyl(0.003, 0.005, 0.15, 6), [-0.06, Y0 + 0.17, -0.12]));
    L.comet.push(at(starGeo(5, 0.024, 0.011, 0.008, 0, 0), [-0.06, Y0 + 0.255, -0.12]));
  }

  const out = {};
  for (const [k, list] of Object.entries(L)) if (list.length) {
    for (const g of list) for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
    out[k] = mergeGeometries(list);
    out[k].userData.shared = true;
    for (const g of list) g.dispose();
  }
  // coupole radar (tourne avec userData.blade autour de Y)
  const T = 1.3, ax = [0, Math.cos(T), Math.sin(T)];
  const dish = [at(lz('Dish', [[0.001, 0.0], [0.016, 0.0015], [0.028, 0.005], [0.031, 0.007], [0.029, 0.008], [0.016, 0.0035], [0.001, 0.002]], 14), [0, 0.012, 0], [T, 0, 0])];
  dish.push(at(G.cyl(0.0025, 0.0025, 0.024, 5), [0, 0.012 + ax[1] * 0.012, ax[2] * 0.012], [T, 0, 0]));
  dish.push(at(G.cyl(0.004, 0.004, 0.016, 6), [0, 0.004, 0]));
  out.dish = mergeGeometries(dish);
  out.dishTip = at(G.sphere(0.006, 8, 6), [0, 0.012 + ax[1] * 0.026, ax[2] * 0.026]);
  out.dish.userData.shared = out.dishTip.userData.shared = true;
  CACHE.set(key, out);
  return out;
}

export function comete(v2) {
  const g = new THREE.Group();
  const M = mats(v2);
  const geo = geometries(v2);
  for (const k of Object.keys(M)) if (geo[k]) part(g, geo[k], M[k]);
  // radar : petite coupole qui tourne sur le viseur
  const radar = new THREE.Group();
  radar.position.set(0.123, Y0 + 0.185, 0.09);
  part(radar, geo.dish, M.steel);
  part(radar, geo.dishTip, M.target);
  g.add(radar);
  g.userData.blade = radar;
  g.userData.bladeAxis = 'y';
  g.userData.muzzles = [new THREE.Vector3(0, Y0, 0.5)];
  g.userData.grip = new THREE.Vector3(-0.035, Y0 - 0.19, 0.252); // main gauche (prise avant), voir leftGrip dans hero.js
  return g;
}
