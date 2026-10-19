// Givreur : lance-azote liquide tenu en main (canon vers +Z, origine dans la main, poignée vers −Y).
// Gros réservoir cryogénique en verre sous cage d'acier (azote aux trois quarts où flottent des glaçons, volant de
// vanne rouge à l'arrière, manomètre dans le rouge), conduite givrée jusqu'à la buse à ailettes, que le givre gagne
// depuis la lèvre, avec ses stalactites. Flanc droit : flocon lumineux, diodes de charge, ouïes, rivets.
// v2 « Givreur Polaire » : réservoir plus gros, buse en corolle plus large à quatre pétales, serpentin lumineux
// autour du col, couronne d'éclats de glace coupants et pointes de glace sur les flancs.
import * as THREE from 'three';
import { G, part, mtx, mergeGeometries } from '../geo.js';
import { mat, glow } from '../../engine/materials.js';
import { build, mix3, hex, sstep, scratch } from '../../engine/textures.js';
import { fbm2, noise2, noise3, clamp } from '../../engine/util.js';

const HP = Math.PI / 2;
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const _q = new THREE.Quaternion();
const _Y = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------------ aides géométriques
// Pièces rigides fusionnées par matériau, calculées une fois (clé) puis partagées
const GEO = new Map();
function merged(key, make) {
  let g = GEO.get(key);
  if (!g) {
    const list = [];
    make(list);
    g = mergeGeometries(list);
    g.userData.shared = true;
    for (const x of list) x.dispose();
    GEO.set(key, g);
  }
  return g;
}
const copy = (geo) => (geo.index ? geo.toNonIndexed() : geo.clone());
// copie placée (position, rotation, échelle), éventuellement dans un repère M
const at = (geo, p, r = [0, 0, 0], s = 1) => copy(geo).applyMatrix4(mtx(p, r, s));
const atM = (geo, M, p = [0, 0, 0], r = [0, 0, 0], s = 1) => copy(geo).applyMatrix4(new THREE.Matrix4().multiplyMatrices(M, mtx(p, r, s)));
const rb = (w, h, d, r, seg = 1) => G.rbox(w, h, d, r, seg);
// repère posé en p, son axe Y tourné vers n
function onN(p, n, s = 1) {
  _q.setFromUnitVectors(_Y, V(n).normalize());
  return new THREE.Matrix4().compose(V(p), _q, typeof s === 'number' ? new THREE.Vector3(s, s, s) : V(s));
}
// tube le long d'une courbe ; ribs > 0 : gaine annelée
function tube(pts, r, segs, radial = 8, ribs = 0) {
  const curve = new THREE.CatmullRomCurve3(pts.map(V));
  const g = new THREE.TubeGeometry(curve, segs, r, radial, false);
  if (ribs) {
    const P = g.attributes.position, U = g.attributes.uv, c = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) {
      const t = U.getX(i);
      curve.getPointAt(t, c);
      const k = 1 + 0.28 * Math.max(0, Math.sin(t * ribs * Math.PI * 2));
      P.setXYZ(i, c.x + (P.getX(i) - c.x) * k, c.y + (P.getY(i) - c.y) * k, c.z + (P.getZ(i) - c.z) * k);
    }
    g.computeVertexNormals();
  }
  return g;
}
// hélice d'axe Z (serpentins)
function helix(r, z0, z1, turns, tr, y0, segs, radial = 3) {
  const pts = [];
  for (let i = 0; i <= turns * 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    pts.push([Math.cos(a) * r, y0 + Math.sin(a) * r, z0 + ((z1 - z0) * i) / (turns * 12)]);
  }
  return tube(pts, tr, segs, radial);
}
// Givre : la pièce gonflée par un bruit le long de ses normales, à facettes. bias > 0 : une partie reste sous la
// surface (plaques de givre éparses au lieu d'une gaine continue) ; bias peut dépendre de la position (x, y, z).
function frosty(src, M, amp, freq, seed, bias = 0.3) {
  // pièce indexée : normales lissées (croûte) ; non indexée (icosaèdre) : facettes (glaçon)
  const g = src.clone().applyMatrix4(M);
  const P = g.attributes.position, N = g.attributes.normal;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const n = noise3(x * freq, y * freq, z * freq, seed) * 0.7 + noise3(x * freq * 2.7, y * freq * 2.7, z * freq * 2.7, seed + 5) * 0.3;
    const d = amp * (n - (typeof bias === 'function' ? bias(x, y, z) : bias));
    P.setXYZ(i, x + N.getX(i) * d, y + N.getY(i) * d, z + N.getZ(i) * d);
  }
  g.computeVertexNormals();
  return g.index ? g.toNonIndexed() : g;
}
// azote : cylindre d'axe Z rempli jusqu'à la hauteur h (au-dessus de l'axe), surface plane
function liquid(r, h, len) {
  const a = Math.asin(h / r);
  const sh = new THREE.Shape();
  sh.moveTo(-r * Math.cos(a), h);
  sh.absarc(0, 0, r, Math.PI - a, Math.PI * 2 + a, false);
  sh.closePath();
  return new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false, curveSegments: 14 }).translate(0, 0, -len / 2);
}
// éclat de glace : prisme hexagonal pointu, base à l'origine, pointe vers +Y
// (prisme et pointe ouverts : la base est toujours noyée dans une pièce)
function shard(r, h) {
  const prism = new THREE.CylinderGeometry(r, r * 0.85, h * 0.62, 6, 1, true).translate(0, h * 0.31, 0);
  const tip = new THREE.ConeGeometry(r, h * 0.38, 6, 1, true).translate(0, h * 0.81, 0);
  const g = mergeGeometries([prism.toNonIndexed(), tip.toNonIndexed()]);
  prism.dispose(); tip.dispose();
  return g;
}

// ------------------------------------------------------------------ textures (256 px, créées à l'appel)
// Peinture laquée neutre (la couleur vient du matériau) : joint de panneau gravé, vis aux coins, écaillage aux arêtes
// qui laisse voir le métal, rayures. UV de 0 à 1 par face (G.rbox).
function coqueTex() {
  return build('arme-givreur-coque', 256, (u, v, o) => {
    const n = fbm2(u * 4, v * 4, 4, 701, 4);
    const g0 = 0.9 + (n - 0.5) * 0.1;
    o[0] = o[1] = o[2] = g0;
    let h = 0.6 + (n - 0.5) * 0.05;
    const e = Math.min(u, 1 - u, v, 1 - v);
    const seam = Math.abs(e - 0.085);
    if (seam < 0.007) { o[0] = o[1] = o[2] = g0 * 0.55; h = 0.3; }
    else if (seam < 0.014 && e > 0.085) { o[0] = o[1] = o[2] = Math.min(1, g0 * 1.06); h = 0.66; }
    // vis cruciformes dans les coins
    const cx = Math.min(u, 1 - u), cy = Math.min(v, 1 - v), dr = Math.hypot(cx - 0.042, cy - 0.042);
    if (dr < 0.02) {
      const slot = Math.min(Math.abs(cx - 0.042), Math.abs(cy - 0.042)) < 0.004 && dr < 0.015;
      o[0] = o[1] = o[2] = slot ? 0.3 : 0.62 + (0.02 - dr) * 10;
      h = slot ? 0.45 : 0.8 - dr * 8;
      return h;
    }
    const cn = fbm2(u * 7, v * 7, 4, 707, 7), cn2 = fbm2(u * 22, v * 22, 3, 709, 22);
    const s = cn + (sstep(0.13, 0, e) * 0.35 + sstep(0.04, 0, e) * 0.3) * 0.75 * (0.4 + cn2 * 1.2);
    if (s > 0.9) {
      const b = 0.48 + fbm2(u * 30, v * 30, 2, 711, 30) * 0.2;
      o[0] = b * 0.97; o[1] = b; o[2] = b * 1.03;
      h = 0.42;
    } else if (s > 0.875) { o[0] = o[1] = o[2] = g0 * 0.5; h = 0.66; }
    else if (scratch(u, v, 8, 713) < 0.003) { o[0] = o[1] = o[2] = g0 * 0.72; h -= 0.08; }
    return h;
  }, 2);
}
// Givre : fond bleuté pommelé, aiguilles de glace entrecroisées, paillettes
function givreTex() {
  const A = hex('#b4d8ee'), B = hex('#f4fbff'), W = [1, 1, 1];
  return build('arme-givreur-givre', 256, (u, v, o) => {
    const n = fbm2(u * 6, v * 6, 4, 721, 6);
    mix3(o, A, B, clamp(0.3 + n * 0.95, 0, 1));
    let h = n * 0.5;
    const s1 = scratch(u, v, 10, 723), s2 = scratch(u, v, 22, 727), s3 = scratch(u, v, 16, 731);
    const needle = Math.max(sstep(0.005, 0, s1), sstep(0.003, 0, s2) * 0.85, sstep(0.004, 0, s3) * 0.7);
    mix3(o, o, W, needle * 0.95);
    h += needle * 0.55;
    const sp = noise2(u * 96, v * 96, 733, 96);
    if (sp > 0.84) { mix3(o, o, W, Math.min(1, (sp - 0.84) * 8)); h += 0.25; }
    return h;
  }, 3.2);
}

// Matériaux (8) : coque laquée, acier (doré en Méga), métal sombre, caoutchouc, verre, givre, rouge, lumière.
function mats(v2) {
  const tc = coqueTex(), tf = givreTex();
  return {
    body: mat(v2 ? '#5a8aff' : '#bfe8ff', { map: tc.map, normalMap: tc.normalMap, normalScale: 0.7, rough: 0.32, metal: 0.25, coat: 0.85 }),
    steel: mat('#c8ccd2', { rough: 0.26, metal: 0.92 }),
    dark: mat('#2c2a3a', { rough: 0.38, metal: 0.65 }),
    rubber: mat('#20222c', { rough: 0.82 }),
    // gris peu saturé et sombre : la finition Méga le garde tel quel (verre clair sur azote doré)
    glass: mat('#71828c', { rough: 0.04, metal: 0.4, coat: 1, transparent: true, opacity: 0.2 }),
    frost: mat('#f4fbff', { map: tf.map, normalMap: tf.normalMap, normalScale: 1.2, rough: 0.7, metal: 0, sheen: 0.6, sheenColor: '#dff4ff' }),
    red: mat('#d8323a', { rough: 0.3, metal: 0.3, coat: 0.9 }),
    glow: glow(v2 ? '#4aa8ff' : '#3fcaff', 1.25),
  };
}

// ===================================================================== Givreur
export function givreur(v2) {
  const M = mats(v2);
  const K = v2 ? 'giv2-' : 'giv1-';
  const g = new THREE.Group();
  const add = (name, make, o = {}) => part(g, merged(K + name, make), M[name], o);

  // cotes : axe de la buse (NY), réservoir (rayon R, axe TY, centre TZ, longueur TL), départ de la buse (N0)
  const NY = 0.035, N0 = 0.19;
  const R = v2 ? 0.076 : 0.068, TY = v2 ? 0.172 : 0.165, TZ = 0.055, TL = 0.22;
  const TF = TZ + TL / 2, TB = TZ - TL / 2;
  const GRIP = mtx([0, -0.075, -0.035], [-0.3, 0, 0]);
  // profil de la buse [rayon, avancée depuis N0] : collerette, col, cloche évasée, lèvre, gorge
  const NOZ = v2
    ? [[0.05, 0], [0.053, 0.012], [0.04, 0.022], [0.036, 0.03], [0.036, 0.09], [0.042, 0.1], [0.052, 0.118], [0.088, 0.21], [0.095, 0.226], [0.088, 0.238], [0.078, 0.226], [0.05, 0.16], [0.03, 0.145]]
    : [[0.05, 0], [0.053, 0.012], [0.04, 0.022], [0.034, 0.03], [0.034, 0.1], [0.037, 0.11], [0.05, 0.13], [0.066, 0.19], [0.072, 0.214], [0.066, 0.225], [0.056, 0.214], [0.044, 0.17], [0.028, 0.14]];
  const LIP = N0 + (v2 ? 0.24 : 0.225);
  // rayon extérieur de la cloche à une avancée donnée (profil NOZ jusqu'à la lèvre)
  const bellR = (z) => {
    const o = z - N0;
    for (let i = 1; i < 9; i++) if (NOZ[i][1] >= o) { const [r0, y0] = NOZ[i - 1], [r1, y1] = NOZ[i]; return r0 + ((r1 - r0) * (o - y0)) / (y1 - y0); }
    return NOZ[8][0];
  };
  // repères des pétales de la v2 (charnière sur la lèvre, Z vers l'avant et le dehors)
  const PET = [0, 1, 2, 3].map((i) => new THREE.Matrix4().multiplyMatrices(mtx([0, NY, 0], [0, 0, Math.PI / 4 + i * HP]), mtx([0, 0.09, LIP - 0.024], [-0.62, 0, 0])));
  const PIPE = [[0, TY, TF + 0.052], [0, TY - 0.012, TF + 0.07], [0, TY - 0.05, N0 + 0.03], [0, NY + 0.062, N0 + 0.012]];
  const MZ = LIP + 0.01;
  // manomètre : face tournée vers l'arrière, le haut et le dehors (lisible derrière Kobi)
  const GP = [0.062, TY + 0.03, TB - 0.012], GN = [0.6, 0.4, -0.7];
  const GM = onN(GP, GN);

  // ---------------- coque laquée : carcasse, flancs, menton
  add('body', (L) => {
    L.push(at(rb(0.115, 0.115, 0.29, 0.03, 2), [0, NY, 0.045]));
    for (const s of [-1, 1]) L.push(at(rb(0.014, 0.08, 0.18, 0.006), [s * 0.062, NY - 0.004, 0.05]));
    L.push(at(rb(0.085, 0.045, 0.1, 0.018), [0, -0.022, 0.14], [0.14, 0, 0]));
    // capot de culasse en pente sous l'arrière du réservoir
    L.push(at(rb(0.1, 0.04, 0.07, 0.016), [0, 0.086, -0.068], [0.3, 0, 0]));
    if (v2) {
      // pétales de la corolle (cône plus large) : quatre lames en X, pointues, ouvertes vers l'avant
      const blade = shard(1, 1);
      for (const F of PET) L.push(atM(blade, F, [0, 0, -0.01], [HP, 0, 0], [0.034, 0.1, 0.008]));
    }
  });

  // ---------------- acier : cage du réservoir, buse, raccords, gâchette, rivets
  add('steel', (L) => {
    L.push(at(G.lathe(K + 'noz', NOZ, 12), [0, NY, N0], [HP, 0, 0]));
    // calottes du réservoir (dôme, bord roulé)
    const cap = G.lathe(K + 'cap', [[R + 0.002, -0.014], [R + 0.008, -0.006], [R + 0.004, 0.008], [0.042, 0.027], [0.001, 0.034]], 12);
    L.push(at(cap, [0, TY, TF], [HP, 0, 0]));
    L.push(at(cap, [0, TY, TB], [-HP, 0, 0]));
    for (const z of [TZ - 0.07, TZ, TZ + 0.07]) L.push(at(G.torus(R + 0.004, 0.0065, 4, 14), [0, TY, z]));
    for (const a of [0.55, Math.PI - 0.55]) L.push(at(G.cyl(0.0048, 0.0048, TL + 0.01, 5), [Math.cos(a) * (R + 0.007), TY + Math.sin(a) * (R + 0.007), TZ], [HP, 0, 0]));
    // sortie avant : raccord, écrou, conduite qui plonge dans la collerette de la buse
    L.push(at(G.cyl(0.016, 0.016, 0.03, 10), [0, TY, TF + 0.045], [HP, 0, 0]));
    L.push(at(G.cyl(0.021, 0.021, 0.012, 6), [0, TY, TF + 0.05], [HP, 0, 0]));
    L.push(at(G.cyl(0.02, 0.02, 0.012, 6), [0, NY + 0.058, N0 + 0.012]));
    L.push(at(tube(PIPE, 0.011, 10, 6)));
    // tige de vanne arrière et moyeu du volant
    L.push(at(G.cyl(0.008, 0.008, 0.026, 6), [0, TY, TB - 0.035], [HP, 0, 0]));
    L.push(at(G.cyl(0.013, 0.013, 0.012, 8), [0, TY, TB - 0.046], [HP, 0, 0]));
    // manomètre : lunette, piquage sur la calotte arrière
    L.push(atM(G.torus(0.027, 0.005, 3, 14), GM, [0, 0.008, 0], [HP, 0, 0]));
    L.push(at(tube([[0.026, TY + 0.012, TB - 0.022], [0.042, TY + 0.02, TB - 0.02], GP], 0.006, 4, 5)));
    // gâchette
    L.push(at(G.box(0.012, 0.042, 0.012), [0, -0.034, 0.032], [0.35, 0, 0]));
    // rivets des flancs
    const RIV = G.lathe('giv-rivet3', [[0.006, 0], [0.0045, 0.003], [0.001, 0.004]], 5);
    for (const s of [-1, 1]) for (const z of [-0.03, 0.13]) for (const y of [NY - 0.036, NY + 0.028]) L.push(at(RIV, [s * 0.069, y, z], [0, 0, -s * HP]));
    if (v2) {
      // bords d'acier des pétales
      for (const F of PET) {
        L.push(atM(G.cyl(0.008, 0.008, 0.044, 6), F, [0, -0.002, 0], [0, 0, HP]));
        L.push(atM(G.box(0.007, 0.007, 0.045), F, [0, 0.005, 0.018]));
      }
    }
  });

  // ---------------- métal sombre : culasse, berceaux, pontet, pied de poignée, ailettes, ouïes, boîtier du manomètre
  add('dark', (L) => {
    L.push(at(rb(0.1, 0.095, 0.022, 0.012), [0, NY, -0.104]));
    for (const z of [TZ - 0.07, TZ + 0.07]) L.push(at(G.box(0.08, 0.03, 0.026), [0, TY - R - 0.004, z]));
    L.push(at(G.torus(0.034, 0.0065, 4, 10, Math.PI), [0, -0.026, 0.03], [0, HP, Math.PI]));
    L.push(atM(rb(0.062, 0.02, 0.082, 0.008), GRIP, [0, -0.078, 0]));
    if (!v2) for (const z of [0.226, 0.246, 0.266]) L.push(at(G.cyl(0.054, 0.054, 0.007, 14), [0, NY, z], [HP, 0, 0]));
    else for (const z of [0.222, 0.272]) L.push(at(G.cyl(0.05, 0.05, 0.008, 14), [0, NY, z], [HP, 0, 0]));
    // ouïes des flancs
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) L.push(at(G.box(0.004, 0.005, 0.036), [s * 0.0692, NY - 0.008 - i * 0.012, s > 0 ? 0.004 : 0.09]));
    // boîtier du manomètre, graduations
    L.push(atM(G.cyl(0.026, 0.024, 0.02, 12), GM, [0, -0.004, 0]));
    for (let i = 0; i <= 4; i++) {
      const a = Math.PI * 1.25 - (i / 4) * Math.PI * 1.5;
      L.push(atM(G.box(0.0025, 0.002, 0.006), GM, [Math.cos(a) * 0.019, 0.0072, -Math.sin(a) * 0.019], [0, a + HP, 0]));
    }
  });

  // ---------------- caoutchouc : poignée à bossages, gaine annelée, tampon de culasse
  add('rubber', (L) => {
    L.push(atM(rb(0.05, 0.14, 0.066, 0.02, 2), GRIP));
    for (const y of [-0.04, -0.005, 0.03]) L.push(atM(G.cyl(0.0085, 0.0085, 0.04, 6), GRIP, [0, y, 0.03], [0, 0, HP]));
    L.push(at(tube([[-0.035, TY - 0.02, TB - 0.012], [-0.085, TY - 0.03, TB - 0.03], [-0.098, 0.06, -0.07], [-0.08, 0.025, -0.02], [-0.066, 0.02, 0.02]], 0.0095, 26, 5, 8)));
    L.push(at(rb(0.09, 0.07, 0.012, 0.01), [0, NY - 0.005, -0.119]));
  });

  // ---------------- rouge : volant de vanne, aiguille et zone rouge du manomètre, purge
  add('red', (L) => {
    const W = mtx([0, TY, TB - 0.05]);
    L.push(atM(G.torus(0.031, 0.0065, 4, 16), W));
    for (let i = 0; i < 3; i++) L.push(atM(G.box(0.004, 0.031, 0.006), W, [0, 0, 0], [0, 0, (i * Math.PI * 2) / 3], 1));
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + Math.PI / 6; L.push(atM(G.sphere(0.0072, 5, 3), W, [Math.cos(a) * 0.031, Math.sin(a) * 0.031, 0])); }
    // aiguille dans le rouge (ça déborde), zone rouge
    const na = -Math.PI * 0.33;
    L.push(atM(G.box(0.0028, 0.002, 0.02), GM, [Math.cos(na) * 0.008, 0.009, -Math.sin(na) * 0.008], [0, na + HP, 0]));
    L.push(atM(G.torus(0.02, 0.0028, 3, 8, Math.PI * 0.4), GM, [0, 0.0075, 0], [HP, 0, -Math.PI * 0.15]));
    // bouton de purge sous le menton
    L.push(at(G.cyl(0.011, 0.013, 0.014, 8), [0.03, -0.045, 0.16]));
  });

  // ---------------- verre du réservoir
  add('glass', (L) => L.push(at(G.cyl(R, R, TL, 22, true), [0, TY, TZ], [HP, 0, 0])), { shadow: false });

  // ---------------- lumière : azote, gorge et lèvre de la buse, cadran, diodes, flocon
  add('glow', (L) => {
    L.push(at(liquid(R - 0.006, (R - 0.006) * 0.42, TL - 0.004), [0, TY, TZ]));
    L.push(at(G.cyl(0.032, 0.032, 0.004, 12), [0, NY, N0 + (v2 ? 0.15 : 0.145)], [HP, 0, 0]));
    L.push(at(G.torus(v2 ? 0.08 : 0.06, 0.0045, 3, 20), [0, NY, LIP - 0.004]));
    L.push(atM(G.cyl(0.0225, 0.0225, 0.003, 12), GM, [0, 0.0055, 0]));
    for (let i = 0; i < 4; i++) L.push(at(G.box(0.004, 0.008, 0.012), [0.0695, NY + 0.024, -0.025 + i * 0.017]));
    // flocon : trois branches et leurs barbes
    const F = mtx([0.0695, NY - 0.006, 0.098], [0, HP, 0]);
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI) / 3;
      L.push(atM(G.box(0.044, 0.0045, 0.002), F, [0, 0, 0], [0, 0, a]));
      for (const s of [-1, 1]) for (const sd of [-1, 1]) {
        const c = [Math.cos(a) * 0.013 * s, Math.sin(a) * 0.013 * s, 0];
        L.push(atM(G.box(0.012, 0.0035, 0.002), F, c, [0, 0, a + sd * 0.9]));
      }
    }
    if (v2) {
      // serpentin de gel express autour du col
      L.push(at(helix(0.043, N0 + 0.034, N0 + 0.082, 3, 0.0045, 0, 24, 4), [0, NY, 0]));
    }
  }, { shadow: false });

  // ---------------- givre : croûte sur la cloche, bourrelet sur la calotte avant, manchon sur la conduite, plaques
  // sur le menton et la collerette, stalactites
  add('frost', (L) => {
    // croûte calée un peu sous la cloche : seuls les reliefs du bruit dépassent (plaques éparses)
    const bell = [];
    for (let i = 0; i <= 7; i++) { const z = N0 + 0.1 + ((LIP - 0.012 - N0 - 0.1) * i) / 7; bell.push([bellR(z) - 0.002, z - N0]); }
    // le givre gagne depuis la lèvre et le dessous de la cloche
    const z0 = N0 + 0.1, z1 = LIP - 0.012;
    const creep = (x, y, z) => 0.63 - 0.2 * clamp((z - z0) / (z1 - z0), 0, 1) - 0.12 * clamp((NY - y) / 0.06, 0, 1);
    L.push(frosty(G.lathe(K + 'bellF', bell, 16), mtx([0, NY, N0], [HP, 0, 0]), 0.026, 46, 11, creep));
    L.push(frosty(G.torus(R + 0.006, 0.006, 4, 18), mtx([0, TY, TF - 0.008]), 0.016, 55, 13, 0.5));
    L.push(frosty(tube(PIPE, 0.0115, 8, 5), new THREE.Matrix4(), 0.016, 70, 19, 0.5));
    // plaques sur le menton et le bord avant de la carcasse
    for (const [p, s] of [[[0.028, -0.02, 0.185], [0.03, 0.022, 0.02]], [[-0.03, -0.012, 0.19], [0.026, 0.02, 0.018]], [[0.045, 0.075, 0.18], [0.024, 0.016, 0.022]], [[-0.04, 0.082, 0.175], [0.02, 0.014, 0.02]]]) {
      L.push(frosty(G.ico(1, 0), mtx(p, [0.3, 0.5, 0.2], [s[0], s[1] * 0.6, s[2]]), 0.012, 90, 23, 0.4));
    }
    // givre sur la tige de vanne et le bord du manomètre
    L.push(frosty(G.ico(1, 0), mtx([0, TY - 0.012, TB - 0.03], [0, 0, 0], [0.02, 0.014, 0.018]), 0.006, 80, 29, 0.2));
    L.push(frosty(G.ico(1, 0), onN(GP, GN).multiply(mtx([-0.02, 0.0, 0.012], [0, 0, 0], [0.012, 0.01, 0.014])), 0.004, 90, 31, 0.2));
    // glaçons qui flottent sur l'azote
    const lv = TY + (R - 0.006) * 0.42;
    for (const [x, z, a, k] of [[0.018, TZ - 0.06, 0.4, 1], [-0.022, TZ + 0.01, 1.1, 0.8], [0.01, TZ + 0.07, 2.2, 0.9]]) {
      L.push(at(G.box(0.019, 0.019, 0.019), [x, lv + 0.002, z], [0.25, a, 0.15], k));
    }
    // stalactites sous la cloche, le menton et le réservoir
    const ic = v2
      ? [[0, 0.33, 0.05], [0.025, 0.36, 0.06], [-0.03, 0.37, 0.042], [0.05, 0.39, 0.034], [-0.052, 0.4, 0.04], [0.01, 0.405, 0.07], [0.022, 0.15, 0.032], [-0.02, 0.17, 0.026]]
      : [[0, 0.33, 0.045], [0.022, 0.355, 0.055], [-0.026, 0.365, 0.04], [0.04, 0.38, 0.03], [-0.042, 0.39, 0.036], [0.008, 0.398, 0.062], [0.022, 0.15, 0.028], [-0.02, 0.17, 0.022]];
    if (v2) {
      // couronne d'éclats de glace coupants entre les pétales (dessus et côtés) et petits éclats intercalés
      for (const a of [0, HP, Math.PI]) {
        const d = [Math.cos(a) * 0.75, Math.sin(a) * 0.75, 0.65];
        L.push(copy(shard(0.013, 0.08)).applyMatrix4(onN([Math.cos(a) * 0.07, NY + Math.sin(a) * 0.07, LIP - 0.05], d)));
      }
      for (let i = 0; i < 2; i++) {
        const b = i * Math.PI + 0.5;
        L.push(copy(shard(0.008, 0.045)).applyMatrix4(onN([Math.cos(b) * 0.06, NY + Math.sin(b) * 0.06, LIP - 0.08], [Math.cos(b), Math.sin(b), 0.35])));
      }
      // pointes de glace qui jaillissent des flancs vers l'arrière, et grappe sur la calotte avant
      for (const s of [-1, 1]) {
        L.push(copy(shard(0.012, 0.085)).applyMatrix4(onN([s * 0.066, NY + 0.045, 0.17], [s * 0.75, 0.55, -0.4])));
      }
      L.push(copy(shard(0.011, 0.065)).applyMatrix4(onN([0.012, TY + 0.03, TF + 0.02], [0.25, 0.7, 0.65])));
      L.push(copy(shard(0.008, 0.045)).applyMatrix4(onN([-0.015, TY + 0.028, TF + 0.022], [-0.4, 0.75, 0.5])));
    }
    for (const [x, z, h] of ic) {
      // accrochées sous la cloche (ou sous le menton)
      const r = bellR(z);
      const y0 = z > 0.2 ? NY - Math.sqrt(Math.max(0, r * r - x * x)) + 0.006 : -0.038;
      L.push(at(G.cone(0.006 + h * 0.08, h, 5), [x, y0 - h / 2, z], [Math.PI, 0, 0]));
    }
  });

  g.userData.muzzles = [new THREE.Vector3(0, NY, MZ)];
  return g;
}
