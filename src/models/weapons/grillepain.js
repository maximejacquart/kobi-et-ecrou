// Escadrille Grille-Pain : le lanceur tenu en main (canon vers +Z) et le grille-pain volant allié (avant vers +X).
// Grille-pain rétro des années 50 : miche laquée entre deux flasques chromées, fentes d'où dépassent les tartines,
// insigne ailé d'escadrille. v2 « Toast-Mortel » : rouge, tartines à mèche, bandes de danger, pots d'échappement.
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, part, joint, mtx, bake } from '../geo.js';
import { mat, glow } from '../../engine/materials.js';
import { build, mix3, hex, sstep, scratch, hazardTexture } from '../../engine/textures.js';
import { fbm2, noise2, clamp } from '../../engine/util.js';
import { dark } from './common.js';

const HP = Math.PI / 2, PI = Math.PI;

// ------------------------------------------------------------------ aides : géométries en cache, pièces fusionnées
const MEMO = new Map();
const memo = (key, make) => {
  let g = MEMO.get(key);
  if (!g) { g = make(); g.userData.shared = true; MEMO.set(key, g); }
  return g;
};
// fill(add) avec add(clé du matériau, géométrie, position, rotation, échelle) : un maillage fusionné par matériau,
// calculé une fois par clé puis partagé par toutes les instances
const PARTS = new Map();
function assemble(key, fill) {
  let parts = PARTS.get(key);
  if (!parts) {
    const L = new Map();
    fill((k, geo, p = [0, 0, 0], r = [0, 0, 0], s = 1) => {
      if (!L.has(k)) L.set(k, []);
      L.get(k).push([geo, mtx(p, r, s)]);
    });
    parts = [...L].map(([k, list]) => { const g = bake(list); g.userData.shared = true; return [k, g]; });
    PARTS.set(key, parts);
  }
  return parts;
}
const place = (parent, parts, M) => { for (const [k, g] of parts) part(parent, g, M[k]); };

// normales lissées sous l'angle de pli (les extrusions sortent à facettes)
function smooth(g, crease = 0.75) {
  g.clearGroups();
  return toCreasedNormals(g, crease);
}
function scaleUV(g, k) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k);
  return g;
}

// Profil « miche » (haut très arrondi, bas plus franc), centré, w × h
function loafShape(w, h, rt, rb, S = THREE.Shape) {
  const s = new S(), x = w / 2, y = h / 2;
  s.moveTo(-x + rb, -y);
  s.lineTo(x - rb, -y);
  s.absarc(x - rb, -y + rb, rb, -HP, 0, false);
  s.lineTo(x, y - rt);
  s.absarc(x - rt, y - rt, rt, 0, HP, false);
  s.lineTo(-x + rt, y);
  s.absarc(-x + rt, y - rt, rt, HP, PI, false);
  s.lineTo(-x, -y + rb);
  s.absarc(-x + rb, -y + rb, rb, PI, PI * 1.5, false);
  return s;
}
// carrosserie : la miche extrudée sur L le long de Z, arêtes arrondies (b), centrée
function loaf(w, h, L, rt, rb, b = 0.012, cs = 4) {
  return memo(`gpLoaf${w}|${h}|${L}|${rt}|${rb}|${b}|${cs}`, () => {
    const g = new THREE.ExtrudeGeometry(loafShape(w - 2 * b, h - 2 * b, Math.max(0.004, rt - b), Math.max(0.004, rb - b)),
      { depth: L - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: cs });
    g.translate(0, 0, -(L - 2 * b) / 2);
    return smooth(scaleUV(g, 3));
  });
}
// bandeau qui ceinture la miche (épaisseur t, largeur L le long de Z)
function loafRing(w, h, rt, rb, t, L) {
  return memo(`gpRing${w}|${h}|${rt}|${rb}|${t}|${L}`, () => {
    const s = loafShape(w, h, rt, rb);
    s.holes.push(loafShape(w - 2 * t, h - 2 * t, rt - t, Math.max(0.004, rb - t), THREE.Path));
    const g = new THREE.ExtrudeGeometry(s, { depth: L, bevelEnabled: false, curveSegments: 3 });
    g.translate(0, 0, -L / 2);
    return smooth(scaleUV(g, 6));
  });
}

// ------------------------------------------------------------------ la tartine
// Silhouette de tranche de pain de mie (épaules qui débordent, dôme), x ∈ [-0.52, 0.52], y ∈ [0, 1]
function toastShape(W = 1, H = 1) {
  const s = new THREE.Shape();
  const P = (x, y) => [x * W, y * H];
  s.moveTo(...P(-0.38, 0));
  s.lineTo(...P(0.38, 0));
  s.quadraticCurveTo(...P(0.44, 0), ...P(0.44, 0.07));
  s.lineTo(...P(0.44, 0.6));
  s.bezierCurveTo(...P(0.57, 0.63), ...P(0.58, 0.86), ...P(0.4, 0.92));
  s.bezierCurveTo(...P(0.24, 1.02), ...P(-0.24, 1.02), ...P(-0.4, 0.92));
  s.bezierCurveTo(...P(-0.58, 0.86), ...P(-0.57, 0.63), ...P(-0.44, 0.6));
  s.lineTo(...P(-0.44, 0.07));
  s.quadraticCurveTo(...P(-0.44, 0), ...P(-0.38, 0));
  return s;
}
// repère texture ↔ silhouette
const TU = (x) => x / 1.12 + 0.5, TV = (y) => (y + 0.02) / 1.04;
// tranche W × H (plan XY, base en y = 0), épaisseur T le long de Z ; faces = mie, flancs = croûte
function toastGeo(W, H, T) {
  return memo(`gpToast${W}|${H}|${T}`, () => {
    const b = T * 0.22;
    const g = new THREE.ExtrudeGeometry(toastShape(W, H), { depth: T - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b * 0.8, bevelSegments: 2, curveSegments: 3 });
    g.translate(0, 0, -(T - 2 * b) / 2);
    const out = smooth(g, 0.9);
    const pos = out.attributes.position, nor = out.attributes.normal, uv = out.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(nor.getZ(i)) > 0.8) uv.setXY(i, TU(pos.getX(i) / W), TV(pos.getY(i) / H));
      else uv.setXY(i, 0.012, 0.012 + (pos.getY(i) / H) * 0.02);
    }
    return out;
  });
}

// Aile à plumes art déco : contour (s = envergure 0..1, c = corde) du bord d'attaque au bout puis plumes festonnées
function wingOutline(span, chord, n = 4, q = 1) {
  const lead = new THREE.SplineCurve([[0, 0.48], [0.25, 0.62], [0.55, 0.6], [0.8, 0.46], [1, 0.24]].map(([s, c]) => new THREE.Vector2(s, c))).getPoints(Math.round(10 * q));
  const tips = [[0.97, -0.06], [0.76, -0.34], [0.53, -0.47], [0.3, -0.52], [0.1, -0.5]].slice(0, n);
  const notch = [[1, 0.24], [0.84, 0.08], [0.62, -0.14], [0.4, -0.26], [0.18, -0.3], [0.02, -0.28]];
  const pts = [...lead];
  for (let i = 0; i < tips.length; i++) {
    const a = notch[i], b = i === tips.length - 1 ? [0, -0.3] : notch[i + 1], t = tips[i];
    // bézier quadratique qui passe par la pointe de la plume
    const cx = 2 * t[0] - (a[0] + b[0]) / 2, cy = 2 * t[1] - (a[1] + b[1]) / 2;
    const K = Math.max(3, Math.round(5 * q));
    for (let k = 1; k <= K; k++) {
      const u = k / K, w0 = (1 - u) * (1 - u), w1 = 2 * u * (1 - u), w2 = u * u;
      pts.push(new THREE.Vector2(w0 * a[0] + w1 * cx + w2 * b[0], w0 * a[1] + w1 * cy + w2 * b[1]));
    }
  }
  return pts.map((p) => new THREE.Vector2(p.x * span, p.y * chord));
}
function extrudeFlat(pts, depth, bev) {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), bev
    ? { depth: depth - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev * 0.7, bevelSegments: 1, curveSegments: 4 }
    : { depth, bevelEnabled: false });
  g.translate(0, 0, -(depth - 2 * (bev || 0)) / 2);
  return smooth(scaleUV(g, 4), 0.7);
}
// aile d'allié : envergure le long de side·Z, corde le long de X, épaisseur selon Y (racine à l'origine)
function wingGeo(span, chord, depth, side, n = 4, bev = true) {
  return memo(`gpWing${span}|${chord}|${depth}|${side}|${n}|${bev}`, () => {
    const g = extrudeFlat(wingOutline(span, chord, n, 0.8).map((p) => new THREE.Vector2(p.y, -side * p.x)), depth, bev ? depth * 0.3 : 0);
    return g.rotateX(-HP);
  });
}
// insigne d'escadrille : deux ailes déployées de part et d'autre d'un centre (plan XY, épaisseur Z)
function badgeGeo(span, chord) {
  return memo(`gpBadge${span}|${chord}`, () => {
    const R = wingOutline(span, chord, 3, 0.5).map((p) => new THREE.Vector2(p.x + span * 0.18, p.y));
    const L = R.map((p) => new THREE.Vector2(-p.x, p.y)).reverse();
    return extrudeFlat([...R, ...L], 0.007, 0);
  });
}
// tube le long d'une courbe (fil, mèche, durites)
const tube = (key, pts, r, n = 24, rs = 7) => memo('gpTube' + key, () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), n, r, rs, false));
// pavillon (lance-tartines, tuyères) : axe +Y, coque fermée
const bell = (key, pts, seg = 18) => memo('gpBell' + key, () => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg));
// demi-disque (bouche) : plan YZ, bord plat en haut, épaisseur le long de X
const halfDisc = (r, t) => memo(`gpHalf${r}|${t}`, () => new THREE.CylinderGeometry(r, r, t, 18, 1, false, 0, PI).rotateZ(-HP));
const RIVET = () => memo('gpRivet', () => new THREE.SphereGeometry(1, 7, 2, 0, PI * 2, 0, HP).scale(1, 0.5, 1));

// ------------------------------------------------------------------ textures (générées au premier appel seulement)
// laque neutre (la couleur vient du matériau) : peau d'orange, éclats jusqu'au métal, rayures fines
function paintTex() {
  const bare = hex('#b4b9c2'), rim = hex('#6a6470');
  return build('arme-grillepain-laque', 256, (u, v, out) => {
    const n = fbm2(u * 8, v * 8, 4, 811, 8);
    const c = 0.9 + n * 0.12;
    out[0] = out[1] = out[2] = c;
    let h = 0.55 + noise2(u * 64, v * 64, 813, 64) * 0.05;
    const ch = fbm2(u * 11, v * 11, 4, 817, 11) + noise2(u * 48, v * 48, 819, 48) * 0.1;
    if (ch > 0.84) { mix3(out, bare, bare.map((x) => Math.min(1, x * 1.2)), noise2(u * 90, v * 90, 823, 90)); h = 0.3; }
    else if (ch > 0.83) { mix3(out, out, rim, 0.6); h = 0.62; }
    else if (scratch(u, v, 7, 827) < 0.0028) { mix3(out, out, bare.map((x) => x * 1.2), 0.5); h -= 0.1; }
    // crasse légère (miettes, graisse)
    const gr = fbm2(u * 3, v * 3, 3, 829, 3);
    if (gr > 0.64) mix3(out, out, hex('#7a6a5a'), (gr - 0.64) * 0.6);
    return h;
  }, 1.4);
}
// mie dorée et croûte de la tartine, dessinées dans la silhouette de toastShape()
function toastTex() {
  const pts = toastShape().getPoints(10).map((p) => [p.x, p.y]);
  const crumbL = hex('#f2cf8e'), crumbD = hex('#cf8a3e'), burnt = hex('#9a5222'), crust = hex('#7a3d17'), crustL = hex('#a85a26');
  return build('arme-grillepain-pain', 256, (u, v, out) => {
    const x = (u - 0.5) * 1.12, y = (1 - v) * 1.04 - 0.02;
    // distance signée au contour (négative dedans)
    let d = 9, inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [ax, ay] = pts[j], [bx, by] = pts[i];
      if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
      const ex = bx - ax, ey = by - ay, t = clamp(((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey || 1), 0, 1);
      d = Math.min(d, Math.hypot(x - ax - ex * t, y - ay - ey * t));
    }
    if (inside) d = -d;
    const n = fbm2(u * 7, v * 7, 4, 901, 7), pore = noise2(u * 52, v * 52, 907, 52), pore2 = noise2(u * 23, v * 23, 911, 23);
    if (d > -0.05) {
      // croûte : brun profond, plus clair en surface
      mix3(out, crust, crustL, clamp(n * 1.3 - 0.2, 0, 1) * sstep(0, -0.04, d));
      return 0.7 + n * 0.1;
    }
    // mie grillée : dorée, plus brune vers la croûte et par plaques
    const toast = clamp(sstep(-0.2, -0.05, d) * 0.7 + (n - 0.45) * 1.6, 0, 1);
    mix3(out, crumbL, crumbD, toast);
    if (toast > 0.8) mix3(out, out, burnt, (toast - 0.8) * 2.5);
    let h = 0.5 + n * 0.1;
    if (pore < 0.22 || pore2 < 0.12) { mix3(out, out, burnt, 0.45); h -= 0.25; }
    return h;
  }, 2.2);
}

// ------------------------------------------------------------------ matériaux (en cache par mat())
function mats(v2, ally) {
  const pt = paintTex(), tt = toastTex();
  const paint = (c, rough = 0.28) => mat(c, { map: pt.map, normalMap: pt.normalMap, normalScale: 0.45, rough, metal: 0.3, coat: 0.85 });
  const M = {
    chrome: mat('#e8eaee', { normalMap: pt.normalMap, normalScale: 0.25, rough: 0.13, metal: 1 }),
    dark: dark(),
    rubber: mat('#1f1c27', { rough: 0.88 }),
    bread: mat('#ffffff', { map: tt.map, normalMap: tt.normalMap, normalScale: 0.9, rough: 0.82 }),
    heat: glow('#ff7a2a', 2.6),
  };
  if (!ally) {
    M.paint = paint(v2 ? '#ff4f6d' : '#ff9fb0');
    if (v2) {
      M.hazard = mat('#ffffff', { map: hazardTexture().map, rough: 0.35, metal: 0.2, coat: 0.6 });
      M.ember = glow('#ff2a1a', 3);
    }
  } else {
    // base : corps chromé, flasques roses ; v2 : corps rouge, flasques chromées
    M.body = v2 ? paint('#ff4f6d') : M.chrome;
    M.cap = v2 ? M.chrome : paint('#ff9fb0');
    M.trim = v2 ? M.chrome : M.cap;
    M.white = mat('#ebe7e1', { rough: 0.3, metal: 0.05, coat: 0.8 });
    M.lens = mat('#7fd8ff', { rough: 0.05, metal: 0.4, coat: 1 });
    if (v2) M.ember = glow('#ff2414', 2.2);
  }
  return M;
}

// ===================================================================== lanceur tenu en main (canon vers +Z)
function handParts(v2) {
  return assemble('gpHand' + (v2 ? 2 : 1), (add) => {
    const Y = 0.085, Z = 0.1; // centre de la caisse
    // caisse : miche laquée entre deux flasques chromées
    add('paint', loaf(0.2, 0.18, 0.2, 0.06, 0.025), [0, Y, Z]);
    for (const dz of [-0.115, 0.115]) add('chrome', loaf(0.212, 0.192, 0.04, 0.066, 0.031, 0.012, 3), [0, Y, Z + dz]);
    // joncs chromés le long des flancs, vis des flasques
    for (const s of [-1, 1]) {
      for (const y of [0.028, 0.044]) add('chrome', G.cyl(0.0035, 0.0035, 0.15, 6), [s * 0.1, y, Z], [HP, 0, 0]);
      for (const [y, dz] of [[0.02, -0.115], [0.15, -0.115], [0.02, 0.115], [0.15, 0.115]]) add('chrome', RIVET(), [s * 0.106, y, Z + dz], [0, 0, -s * HP], 0.006);
    }
    // fentes à pain : cadre chromé, fond sombre, résistances rougeoyantes de part et d'autre de la tartine
    for (const s of [-1, 1]) {
      const x = s * 0.046;
      add('chrome', G.rbox(0.05, 0.02, 0.18, 0.008, 1), [x, 0.17, Z]);
      add('dark', G.box(0.032, 0.012, 0.16), [x, 0.1755, Z]);
      for (const o of [-0.0135, 0.0135]) add('heat', G.box(0.004, 0.003, 0.15), [x + o, 0.182, Z]);
    }
    // tartines qui dépassent (l'une plus haut que l'autre : elles sautent)
    const toast = toastGeo(0.13, 0.13, 0.022);
    add('bread', toast, [-0.046, v2 ? 0.105 : 0.112, Z + 0.004], [0, HP, 0]);
    add('bread', toast, [0.046, v2 ? 0.098 : 0.094, Z - 0.004], [0.07, HP, 0]);
    // lance-tartines à l'avant : bague, pavillon chromé évasé, gueule sombre et résistance en spirale
    add('chrome', G.cyl(0.048, 0.05, 0.022, 16), [0, Y, 0.24], [HP, 0, 0]);
    add('chrome', bell('hand', [[0.034, 0], [0.036, 0.025], [0.041, 0.04], [0.052, 0.054], [0.057, 0.06], [0.055, 0.065], [0.045, 0.061], [0.036, 0.05], [0.03, 0.03], [0.028, 0.004]], 16), [0, Y, 0.235], [HP, 0, 0]);
    add('dark', G.cyl(0.031, 0.031, 0.01, 12), [0, Y, 0.252], [HP, 0, 0]);
    add('heat', G.torus(0.019, 0.0035, 4, 14), [0, Y, 0.258]);
    add('heat', G.torus(0.009, 0.003, 4, 10), [0, Y, 0.259]);
    add('heat', G.box(0.044, 0.004, 0.003), [0, Y, 0.26]);
    // insignes d'escadrille sur les flancs : ailes chromées autour d'une cocarde
    for (const s of [-1, 1]) {
      add('chrome', badgeGeo(0.04, 0.035), [s * 0.1035, 0.1, Z - 0.005], [0, s * HP, 0]);
      add('chrome', G.cyl(0.016, 0.016, 0.006, 12), [s * 0.104, 0.1, Z - 0.005], [0, 0, HP]);
      add(v2 ? 'ember' : 'heat', G.cyl(0.009, 0.009, 0.004, 10), [s * 0.1075, 0.1, Z - 0.005], [0, 0, HP]);
    }
    // côté droit (+X) : manette de descente du pain ; côté gauche : molette de cuisson graduée
    add('dark', G.rbox(0.006, 0.075, 0.014, 0.003, 1), [0.1005, 0.095, 0.03]);
    add('chrome', G.box(0.03, 0.01, 0.01), [0.116, 0.078, 0.03]);
    add('paint', G.rbox(0.022, 0.02, 0.034, 0.008, 1), [0.134, 0.078, 0.03]);
    add('chrome', G.cyl(0.024, 0.026, 0.012, 14), [-0.106, 0.1, 0.03], [0, 0, HP]);
    add('dark', G.cyl(0.018, 0.018, 0.006, 12), [-0.115, 0.1, 0.03], [0, 0, HP]);
    add('chrome', G.box(0.006, 0.026, 0.006), [-0.119, 0.106, 0.03], [0.5, 0, 0]);
    for (let i = 0; i < 5; i++) {
      const a = -1.1 + i * 0.55;
      add('dark', G.box(0.003, 0.008, 0.003), [-0.101, 0.1 + Math.cos(a) * 0.036, 0.03 + Math.sin(a) * 0.036], [-a, 0, 0]);
    }
    // arrière : compteur d'escadrille (un voyant par grille-pain), tiroir à miettes, fil débranché qui pend
    const n = v2 ? 5 : 3;
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 0.026;
      add('chrome', G.torus(0.009, 0.003, 4, 10), [x, 0.135, -0.037]);
      add(v2 ? 'ember' : 'heat', G.sphere(0.0075, 7, 4), [x, 0.135, -0.036]);
    }
    add('chrome', G.rbox(0.15, 0.012, 0.03, 0.004, 1), [0, 0.008, -0.034]);
    add('dark', G.rbox(0.04, 0.008, 0.014, 0.003, 1), [0, 0.008, -0.05]);
    add('rubber', tube('handCord', [[0.05, 0.03, -0.03], [0.06, 0.02, -0.07], [0.07, -0.025, -0.085], [0.075, -0.06, -0.06], [0.08, -0.085, -0.03], [0.085, -0.115, -0.035]], 0.0065, 20, 6));
    add('dark', G.rbox(0.026, 0.03, 0.022, 0.007, 1), [0.086, -0.13, -0.037], [0, 0, 0.12]);
    for (const o of [-0.006, 0.006]) add('chrome', G.box(0.003, 0.018, 0.008), [0.088 + o, -0.152, -0.037], [0, 0, 0.12]);
    // pieds chromés à l'avant
    for (const s of [-1, 1]) add('chrome', G.sphere(0.012, 8, 4), [s * 0.07, -0.004, 0.19], undefined, [1, 0.6, 1]);
    // poignée caoutchouc à rainures, détente et pontet
    add('rubber', G.rbox(0.062, 0.15, 0.074, 0.024, 2), [0, -0.068, 0.022], [-0.3, 0, 0]);
    // rainures pour les doigts sur l'avant de la poignée (axes de la poignée inclinée de -0,3 rad)
    const gu = [0, Math.cos(0.3), -Math.sin(0.3)], gf = [0, Math.sin(0.3), Math.cos(0.3)];
    for (const ly of [0.035, 0.005, -0.025, -0.055]) {
      add('rubber', G.capsule(0.009, 0.04, 1, 6), [0, -0.068 + gu[1] * ly + gf[1] * 0.036, 0.022 + gu[2] * ly + gf[2] * 0.036], [0, 0, HP]);
    }
    add('chrome', G.rbox(0.068, 0.02, 0.08, 0.008, 1), [0, -0.142, 0.045], [-0.3, 0, 0]);
    add('chrome', G.torus(0.022, 0.005, 5, 9, 1.6), [0, -0.018, 0.088], [0, -HP, 0.3]);
    add('dark', G.torus(0.04, 0.006, 5, 13, 2.2), [0, -0.005, 0.09], [0, -HP, 0.95]);
    if (v2) {
      // Toast-Mortel : bande de danger, dérive dorsale, pots d'échappement, crocs autour du pavillon
      add('hazard', loafRing(0.208, 0.188, 0.064, 0.029, 0.006, 0.022), [0, Y, 0.165]);
      add('paint', extrudeFlat([[0, 0], [0.11, 0], [0.02, 0.085], [-0.012, 0.085]].map(([a, b]) => new THREE.Vector2(a, b)), 0.012, 0.003), [0, 0.16, -0.025], [0, -HP, 0]);
      for (const s of [-1, 1]) {
        add('chrome', G.cyl(0.013, 0.016, 0.07, 10), [s * 0.08, 0.16, -0.045], [-0.7, 0, s * 0.25]);
        add('dark', G.cyl(0.0105, 0.0105, 0.004, 10), [s * 0.0895, 0.188, -0.073], [-0.7, 0, s * 0.25]);
        add('ember', G.sphere(0.009, 6, 4), [s * 0.0893, 0.186, -0.071]);
      }
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * PI * 2 + PI / 6;
        add('chrome', G.cone(0.009, 0.03, 6), [Math.cos(a) * 0.05, Y + Math.sin(a) * 0.05, 0.283], [HP, 0, 0]);
      }
      // mèches allumées sur les tartines
      for (const [x, y] of [[-0.046, 0.105 + 0.13], [0.046, 0.098 + 0.13]]) {
        add('dark', tube('mecheH' + x, [[x, y - 0.006, Z], [x, y + 0.012, Z + 0.006], [x, y + 0.022, Z - 0.004], [x, y + 0.032, Z + 0.002]], 0.0028, 8, 4));
        add('ember', G.ico(0.008, 0), [x, y + 0.034, Z + 0.002]);
        add('heat', G.ico(0.012, 0), [x, y + 0.035, Z + 0.002], [0.5, 0.3, 0]);
      }
    }
  });
}

export function grillepain(v2) {
  const g = new THREE.Group();
  place(g, handParts(v2), mats(v2, false));
  g.userData.muzzles = [new THREE.Vector3(0, 0.085, 0.29)];
  return g;
}

// ===================================================================== grille-pain volant (avant vers +X)
// Corps en miche couché le long de X, visage sur la flasque avant (gros yeux, bouche), lunettes d'aviateur
// relevées sur le front, ailes à plumes battantes sur les flancs, fil électrique en queue terminé par la prise.
function allyParts(v2) {
  return assemble('gpAlly' + (v2 ? 2 : 1), (add) => {
    const RY = [0, HP, 0]; // miche : extrusion le long de X
    add('body', loaf(0.3, 0.32, 0.34, 0.09, 0.035, 0.016), [0, 0, 0], RY);
    for (const s of [-1, 1]) add('cap', loaf(0.314, 0.334, 0.075, 0.097, 0.042, 0.016), [s * 0.19, 0, 0], RY);
    // joncs décoratifs sur les flancs, vis des flasques, supports d'ailes
    for (const s of [-1, 1]) {
      for (const y of [-0.06, -0.085, -0.11]) add('trim', G.cyl(0.006, 0.006, 0.26, 8), [0, y, s * 0.15], [0, 0, HP]);
      for (const x of [-0.19, 0.19]) for (const y of [-0.11, 0.07]) add('chrome', RIVET(), [x, y, s * 0.158], [s * HP, 0, 0], 0.009);
      add('chrome', G.rbox(0.13, 0.06, 0.04, 0.014, 1), [0, 0.05, s * 0.155]);
      add('dark', G.cyl(0.022, 0.022, 0.14, 14), [0, 0.05, s * 0.178], [0, 0, HP]);
    }
    // fentes et tartines (elles partent de y + 0,25)
    for (const s of [-1, 1]) {
      const z = s * 0.064;
      add('chrome', G.rbox(0.26, 0.02, 0.054, 0.008, 1), [-0.01, 0.158, z]);
      add('dark', G.box(0.24, 0.012, 0.035), [-0.01, 0.163, z]);
      for (const o of [-0.0155, 0.0155]) add('heat', G.box(0.22, 0.003, 0.004), [-0.01, 0.17, z + o]);
    }
    const toast = toastGeo(0.17, 0.15, 0.026);
    add('bread', toast, [-0.015, 0.1, -0.064], [0, 0, -0.04]);
    add('bread', toast, [-0.005, 0.088, 0.064], [0, 0, 0.05]);

    // ---- visage (flasque avant, x ≈ 0,228)
    const FX = 0.228;
    for (const s of [-1, 1]) {
      const z = s * 0.068;
      add('white', G.ellipsoid(0.045, 0.078, 0.062, 16, 11), [FX - 0.012, 0.03, z]);
      // pupille (un peu vers le centre et vers le bas : il vise) et reflet
      add('dark', G.ellipsoid(0.014, 0.034, 0.027, 10, 7), [FX + 0.029, 0.018, z - s * 0.01]);
      if (v2) add('ember', G.ellipsoid(0.008, 0.016, 0.013, 8, 6), [FX + 0.039, 0.016, z - s * 0.011]);
      add('white', G.sphere(0.008, 8, 6), [FX + 0.04, 0.034, z - s * 0.002]);
      // paupière (plus basse et plus penchée en v2 : colère), sourcil chromé
      const tilt = v2 ? 0.55 : 0.18;
      add(v2 ? 'body' : 'cap', memo('gpLid' + (v2 ? 2 : 1), () => new THREE.SphereGeometry(1, 16, 6, 0, PI * 2, 0, PI * (v2 ? 0.42 : 0.33))),
        [FX - 0.012, 0.03, z], [s * tilt, 0, 0], [0.05, 0.084, 0.067]);
      add(v2 ? 'dark' : 'chrome', G.rbox(0.022, v2 ? 0.026 : 0.018, 0.085, 0.008, 1), [FX + 0.006, v2 ? 0.115 : 0.128, z], [s * (v2 ? 0.5 : -0.22), 0, 0]);
    }
    if (!v2) {
      // grand sourire : bouche en D, deux dents du bonheur, langue
      add('dark', halfDisc(0.058, 0.012), [FX + 0.001, -0.07, 0], undefined, [0.7, 1, 1]);
      for (const o of [-0.012, 0.012]) add('white', G.rbox(0.008, 0.022, 0.02, 0.004, 1), [FX + 0.006, -0.078, o]);
      add('cap', G.ellipsoid(0.008, 0.016, 0.03, 10, 8), [FX + 0.004, -0.1, 0]);
    } else {
      // gueule de requin peinte, crocs en haut et en bas
      add('dark', halfDisc(0.1, 0.012), [FX + 0.001, -0.06, 0], undefined, [0.65, 1, 1]);
      add('body', G.ellipsoid(0.008, 0.016, 0.05, 10, 6), [FX + 0.004, -0.098, 0]);
      for (let i = 0; i < 7; i++) {
        const z = (i - 3) * 0.027;
        add('white', G.cone(0.011, 0.03, 4), [FX + 0.006, -0.073, z], [PI, 0, 0]);
      }
      for (let i = 0; i < 4; i++) {
        const a = -0.85 + (i / 3) * 1.7, z = Math.sin(a) * 0.075, y = -0.06 - Math.cos(a) * 0.058;
        add('white', G.cone(0.009, 0.024, 4), [FX + 0.006, y + 0.012, z], [0, 0, 0]);
      }
    }
    // lunettes d'aviateur relevées sur le front, sangle autour de la tête
    add('dark', loafRing(0.322, 0.342, 0.1, 0.045, 0.01, 0.03), [0.125, 0, 0], RY);
    const ringY = memo('gpGogRing', () => new THREE.TorusGeometry(0.036, 0.009, 5, 14).rotateX(-HP));
    const lensY = memo('gpGogLens', () => new THREE.SphereGeometry(0.034, 12, 4, 0, PI * 2, 0, HP));
    for (const s of [-1, 1]) {
      const p = [0.15, 0.172, s * 0.058], r = [0, 0, -0.85]; // verres tournés vers l'avant et le ciel
      add('chrome', ringY, p, r);
      add('lens', lensY, p, r, [1, 0.35, 1]);
    }
    add('dark', G.rbox(0.03, 0.014, 0.03, 0.005, 1), [0.15, 0.172, 0]);

    // ---- arrière (x ≈ -0,228) : manette, molette, tuyères, fil en queue terminé par la prise
    const BX = -0.228;
    add('dark', G.rbox(0.012, 0.11, 0.022, 0.005, 1), [BX, 0.0, 0.085]);
    add('chrome', G.box(0.05, 0.014, 0.014), [BX - 0.02, 0.025, 0.085]);
    add('cap', G.rbox(0.03, 0.03, 0.05, 0.01, 1), [BX - 0.048, 0.025, 0.085]);
    add('chrome', G.cyl(0.03, 0.033, 0.016, 20), [BX - 0.006, 0.03, -0.075], [0, 0, HP]);
    add('dark', G.cyl(0.022, 0.022, 0.008, 16), [BX - 0.016, 0.03, -0.075], [0, 0, HP]);
    add('chrome', G.box(0.008, 0.03, 0.008), [BX - 0.021, 0.038, -0.075], [-0.6, 0, 0]);
    for (let i = 0; i < 5; i++) {
      const a = -1.1 + i * 0.55;
      add(v2 ? 'ember' : 'heat', G.sphere(0.005, 6, 4), [BX - 0.004, 0.03 + Math.cos(a) * 0.045, -0.075 - Math.sin(a) * 0.045]);
    }
    for (const s of [-1, 1]) {
      const p = [BX + 0.01, -0.085, s * 0.075];
      add('chrome', bell('jet' + (v2 ? 2 : 1), v2
        ? [[0.034, 0], [0.036, 0.03], [0.044, 0.055], [0.05, 0.07], [0.046, 0.072], [0.034, 0.06], [0.026, 0.03], [0.024, 0.004]]
        : [[0.03, 0], [0.032, 0.025], [0.038, 0.045], [0.042, 0.055], [0.038, 0.057], [0.03, 0.048], [0.023, 0.025], [0.021, 0.004]], 12), p, [0, 0, HP]);
      add(v2 ? 'ember' : 'heat', G.cyl(0.024, 0.024, 0.006, 14), [BX - 0.015, -0.085, s * 0.075], [0, 0, HP]);
    }
    add('dark', tube('cord', [[BX + 0.01, -0.12, 0], [BX - 0.06, -0.15, 0.01], [BX - 0.14, -0.11, 0.03], [BX - 0.17, -0.03, 0.0], [BX - 0.13, 0.0, -0.04], [BX - 0.1, -0.05, -0.05], [BX - 0.15, -0.1, -0.03], [BX - 0.24, -0.08, 0.0]], 0.012, 28, 6));
    add('dark', G.rbox(0.05, 0.04, 0.034, 0.01, 1), [BX - 0.26, -0.075, 0.0], [0, 0, 0.25]);
    add('cap', G.rbox(0.014, 0.046, 0.04, 0.006, 1), [BX - 0.24, -0.08, 0.0], [0, 0, 0.25]);
    for (const o of [-0.009, 0.009]) add('chrome', G.box(0.03, 0.005, 0.012), [BX - 0.293, -0.067, o], [0, 0, 0.25]);

    // ---- dessous : tiroir à miettes ; pieds (base) ou tartine-bombe sous le ventre (v2)
    add('chrome', G.rbox(0.22, 0.012, 0.2, 0.005, 1), [0, -0.163, 0]);
    if (!v2) {
      for (const x of [-0.15, 0.15]) for (const z of [-0.1, 0.1]) add('dark', G.sphere(0.022, 8, 4), [x, -0.168, z], undefined, [1, 0.7, 1]);
    } else {
      add('bread', toastGeo(0.15, 0.13, 0.028), [-0.07, -0.205, 0], [HP, 0, -HP]);
      for (const x of [-0.06, 0.04]) add('dark', G.rbox(0.022, 0.05, 0.16, 0.006, 1), [x, -0.19, 0]);
      add('dark', tube('fuseB', [[0.08, -0.205, 0], [0.11, -0.2, 0.01], [0.13, -0.215, -0.005], [0.15, -0.205, 0.0]], 0.004, 10, 5));
      add('ember', G.ico(0.012, 0), [0.152, -0.205, 0]);
      // crête de pointes entre les fentes, mèches allumées sur les tartines
      for (const x of [-0.1, -0.02, 0.06]) add('chrome', G.cone(0.016, 0.05, 6), [x, 0.19, 0]);
      for (const [x, y, z] of [[-0.015, 0.1, -0.064], [-0.005, 0.088, 0.064]]) {
        const top = y + 0.15;
        add('dark', tube('meche' + z, [[x, top - 0.01, z], [x + 0.01, top + 0.015, z], [x - 0.006, top + 0.03, z], [x + 0.004, top + 0.045, z]], 0.004, 10, 5));
        add('ember', G.ico(0.012, 0), [x + 0.004, top + 0.048, z]);
        add('heat', G.ico(0.018, 0), [x + 0.004, top + 0.049, z], [0.5, 0.3, 0]);
      }
    }
  });
}
// une aile : plumes laquées, rangée de plumes de couverture colorées, longeron chromé et épaule
function wingParts(v2, side) {
  return assemble(`gpWing${v2 ? 2 : 1}|${side}`, (add) => {
    add('white', wingGeo(0.44, 0.25, 0.018, side), [0, 0, side * 0.015]);
    add('white', wingGeo(0.34, 0.21, 0.012, side, 4, false), [0.015, 0.011, side * 0.015]);
    add(v2 ? 'body' : 'cap', wingGeo(v2 ? 0.26 : 0.2, 0.16, 0.012, side, 3, false), [0.025, 0.02, side * 0.015]);
    add('chrome', G.capsule(0.013, 0.22, 3, 8), [0.055, 0.022, side * 0.14], [HP, 0, 0]);
    add('chrome', G.sphere(0.032, 10, 7), [0, 0, 0]);
    if (v2) for (let i = 0; i < 4; i++) add('chrome', RIVET(), [-0.005, 0.027, side * (0.06 + i * 0.05)], undefined, 0.007);
  });
}

export function toasterModel(v2) {
  const g = new THREE.Group();
  const M = mats(v2, true);
  place(g, allyParts(v2), M);
  // ailes battues par le jeu autour de X (signe donné par position.z)
  const wings = [];
  for (const s of [-1, 1]) {
    const w = joint(g, [0, 0.05, s * 0.18]);
    // dièdre : les ailes remontent vers le bout (lisible de face comme de dos)
    const d = joint(w);
    d.rotation.x = -s * 0.32;
    place(d, wingParts(v2, s), M);
    wings.push(w);
  }
  g.userData.wings = wings;
  return g;
}
