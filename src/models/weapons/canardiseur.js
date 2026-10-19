// Canardiseur : pistolet de bain rétro-futuriste (canon vers +Z, poignée vers −Y, main à l'origine).
// Un canard en vinyle flotte dans une baignoire laquée (l'eau, la mousse, le rebord roulé), qui sert de carcasse ;
// devant, un canon à ailettes façon pistolet à rayons finit en pavillon d'appeau. Détente en patte de canard, bonde
// au bout d'une chaînette sous la crosse, « couinomètre » à l'arrière, canards abattus peints en tableau de chasse.
// v2 « Canard-Kaboum » : canard orange au regard mauvais, mèche allumée sur la tête, fagots de dynamite sur les
// flancs, aileron dorsal et pavillon à pointes.
// Méga : le canard (couleur portée par les sommets, matériau blanc) devient d'or ; la baignoire, sombre et lustrée.
import * as THREE from 'three';
import { G, mtx, mergeGeometries } from '../geo.js';
import { mat, glow } from '../../engine/materials.js';
import { build as buildTex, fbmP, noiseP, sstep, paintedMetalTexture } from '../../engine/textures.js';

const HP = Math.PI / 2;

// ------------------------------------------------------------------ textures (créées au premier appel)
// Vinyle moulé : blanc cassé à peine marbré, peau d'orange fine, ligne de moulage dans le plan médian (u = ¼ et ¾
// sur les sphères) ; la teinte vient des sommets, pour que la Méga puisse la remplacer par de l'or.
function vinylTexture() {
  return buildTex('arme-canard-vinyle', 256, (u, v, o) => {
    const n = fbmP(u * 4, v * 4, 4, 4, 3, 811);
    const fine = noiseP(u * 96, v * 96, 96, 96, 823);
    const k = 0.94 + (n - 0.5) * 0.08 + (fine - 0.5) * 0.025;
    o[0] = k; o[1] = k; o[2] = k * 0.985;
    const d = Math.min(Math.abs(u - 0.25), Math.abs(u - 0.75));
    const seam = sstep(0.006, 0.0, d);
    if (seam > 0) { o[0] = o[1] = Math.min(1, k + 0.06 * seam); o[2] = o[1] * 0.985; }
    return 0.5 + fine * 0.05 + seam * 0.25;
  }, 1.4);
}
// Tôle émaillée claire de la baignoire, teintée par le matériau (la Méga la garde et l'assombrit)
const tubTexture = () => paintedMetalTexture('#eef2f2', 'arme-canard-email', { chip: 0.25, edge: 0.8, rust: 0.05, bare: '#8e959f' });

function mats(v2) {
  const vt = vinylTexture(), tt = tubTexture();
  return {
    vinyl: mat('#ffffff', { map: vt.map, normalMap: vt.normalMap, normalScale: 0.6, rough: 0.3, coat: 0.55, coatRough: 0.2, vertexColors: true }),
    beak: mat(v2 ? '#e8301c' : '#ff7a14', { rough: 0.32, coat: 0.6, coatRough: 0.18 }),
    tub: mat(v2 ? '#4b3a72' : '#2fb3ad', { map: tt.map, normalMap: tt.normalMap, rough: 0.34, metal: 0.3, coat: 0.85 }),
    chrome: mat('#d7dce3', { rough: 0.2, metal: 0.95 }),
    rubber: mat('#2b2633', { rough: 0.62 }),
    white: mat('#fbf6ea', { rough: 0.3, coat: 0.6, coatRough: 0.15 }),
    light: v2 ? glow('#ffa53a', 3) : glow('#fff27a', 2.6),
    water: mat('#3fd2ff', { rough: 0.06, metal: 0.2, coat: 1, emissive: '#0b7aa8', emissiveIntensity: 0.9 }),
  };
}

// ------------------------------------------------------------------ assemblage des pièces rigides
// Une géométrie fusionnée par matériau, calculée une fois par variante puis partagée.
const CACHE = new Map();
function bakeList(list, colored) {
  const c3 = new THREE.Color();
  const geos = list.map(([geo, m, col]) => {
    const c = geo.index ? geo.toNonIndexed() : geo.clone();
    c.applyMatrix4(m);
    for (const k of Object.keys(c.attributes)) if (!['position', 'normal', 'uv'].includes(k)) c.deleteAttribute(k);
    if (!c.attributes.uv) c.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(c.attributes.position.count * 2), 2));
    if (colored) {
      c3.set(col || '#ffffff');
      const a = new Float32Array(c.attributes.position.count * 3);
      for (let i = 0; i < a.length; i += 3) { a[i] = c3.r; a[i + 1] = c3.g; a[i + 2] = c3.b; }
      c.setAttribute('color', new THREE.Float32BufferAttribute(a, 3));
    }
    return c;
  });
  const g = mergeGeometries(geos);
  for (const x of geos) x.dispose();
  g.userData.shared = true;
  return g;
}

// matrice locale orientée : Z local le long de n (normale de surface), X local à l'horizontale
const _up = new THREE.Vector3(0, 1, 0);
function onSurface(p, n, s, spin = 0) {
  const z = new THREE.Vector3(...n).normalize();
  const x = new THREE.Vector3().crossVectors(_up, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  if (spin) m.multiply(new THREE.Matrix4().makeRotationZ(spin));
  m.scale(new THREE.Vector3(...(typeof s === 'number' ? [s, s, s] : s)));
  m.setPosition(p[0], p[1], p[2]);
  return m;
}
// tube le long d'une courbe passant par des points
const tube = (pts, r, seg = 16, rad = 6) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), seg, r, rad, false);
// anneau elliptique (rx, rz) à la hauteur y
class Ellipse extends THREE.Curve {
  constructor(rx, rz, y) { super(); this.rx = rx; this.rz = rz; this.y = y; }
  getPoint(t, out = new THREE.Vector3()) { const a = t * Math.PI * 2; return out.set(Math.cos(a) * this.rx, this.y, Math.sin(a) * this.rz); }
}
const ring = (rx, rz, y, r, seg = 24) => new THREE.TubeGeometry(new Ellipse(rx, rz, y), seg, r, 4, true);

// silhouette de canard de profil (bec vers +x, ~1 unité), pour le tableau de chasse peint sur la baignoire
function duckShape(mirror) {
  const P = [[-0.5, 0.32], [-0.36, 0.12], [-0.12, 0.16], [0.06, 0.2], [0.03, 0.36], [0.12, 0.5], [0.27, 0.5], [0.34, 0.42],
    [0.5, 0.37], [0.34, 0.3], [0.33, 0.22], [0.42, 0.11], [0.34, -0.02], [0.0, -0.07], [-0.34, -0.03], [-0.48, 0.12]];
  const pts = P.map(([x, y]) => new THREE.Vector2(mirror ? -x : x, y - 0.2));
  const s = new THREE.Shape();
  s.moveTo(pts[0].x, pts[0].y);
  s.splineThru([...pts.slice(1), pts[0]]);
  return new THREE.ShapeGeometry(s, 1);
}

// profil de la baignoire (rayon, hauteur), étiré en Z : fond arrondi, flanc évasé, rebord roulé, paroi intérieure
const TUB_Z = 1.55;
const TUB = [[0.001, -0.012], [0.06, -0.012], [0.076, -0.004], [0.084, 0.012], [0.089, 0.04], [0.093, 0.06],
  [0.1, 0.066], [0.102, 0.072], [0.095, 0.077], [0.087, 0.072], [0.084, 0.055]];
// rayon du flanc à la hauteur y (interpolé sur le profil extérieur)
function tubR(y) {
  for (let i = 1; i < 6; i++) {
    const [r0, y0] = TUB[i], [r1, y1] = TUB[i + 1];
    if (y <= y1) return r0 + (r1 - r0) * ((y - y0) / (y1 - y0));
  }
  return 0.095;
}
// point et normale du flanc pour un angle a (0 = +X, π/2 = +Z) à la hauteur y, décollé de off
function tubSide(a, y, off = 0.002) {
  const r = tubR(y), c = Math.cos(a), s = Math.sin(a);
  const n = [c / r, 0.12, s / (r * TUB_Z * TUB_Z)];
  const l = Math.hypot(...n);
  return { p: [c * r + (c / r / l) * off, y, s * r * TUB_Z + (s / (r * TUB_Z * TUB_Z) / l) * off], n: n.map((k) => k / l) };
}

function geometry(v2) {
  const key = 'canardiseur' + (v2 ? '-v2' : '');
  if (CACHE.has(key)) return CACHE.get(key);
  const L = { vinyl: [], beak: [], tub: [], chrome: [], rubber: [], white: [], light: [], water: [] };
  const add = (k, geo, m, col) => L[k].push([geo, m, col]);
  const tmp = []; // géométries créées ici (à libérer après fusion)
  const own = (g) => { tmp.push(g); return g; };
  const Y = v2 ? '#ff9a3a' : '#ffd23a', YD = v2 ? '#f07a22' : '#f4b422', BLUSH = v2 ? '#ff6a3a' : '#ff9a52';

  // ---------------- canard : corps, poitrail, croupion, ailes, cou, tête, joues, mèche
  // quatre finesses de sphère : grosses formes, pièces moyennes, petites, détails
  const sph = G.sphere(1, 14, 10), sphM = G.sphere(1, 12, 8), sphL = G.sphere(1, 9, 6), sphXL = G.sphere(1, 6, 4);
  add('vinyl', sph, mtx([0, 0.088, -0.015], [0, 0, 0], [0.084, 0.068, 0.122]), Y);
  add('vinyl', sphM, mtx([0, 0.1, 0.06], [0, 0, 0], [0.074, 0.066, 0.072]), Y);
  add('vinyl', sphL, mtx([0, 0.148, 0.065], [0, 0, 0], [0.052, 0.05, 0.05]), Y);
  add('vinyl', sph, mtx([0, 0.19, 0.075], [0, 0, 0], 0.066), Y);
  // croupion relevé (pointe retroussée) ; v2 : trois plumes en pointe
  add('vinyl', sphM, mtx([0, 0.118, -0.115], [0.75, 0, 0], [0.05, 0.036, 0.056]), Y);
  if (!v2) add('vinyl', sphL, mtx([0, 0.153, -0.155], [1.0, 0, 0], [0.028, 0.02, 0.038]), Y);
  else for (const s of [-1, 0, 1]) add('vinyl', G.cone(1, 1, 12), mtx([s * 0.018, 0.15 - Math.abs(s) * 0.012, -0.15], [-0.6 - Math.abs(s) * 0.15, 0, -s * 0.55], [0.02, 0.075, 0.016]), s ? YD : Y);
  for (const s of [-1, 1]) {
    // aile plaquée, rémige moulée au bout
    add('vinyl', sphM, mtx([s * 0.072, 0.104, -0.03], [0.3, s * 0.12, s * 0.12], [0.017, 0.04, 0.068]), YD);
    for (const [y, z, l] of [[0.012, -0.088, 0.026]]) {
      add('vinyl', sphXL, mtx([s * 0.079, 0.104 + y, z], [0.45, s * 0.2, s * 0.12], [0.008, 0.009, l]), YD);
    }
    // joues rosées
    add('vinyl', sphL, onSurface([s * 0.044, 0.172, 0.118], [s * 0.6, -0.15, 0.78], [0.02, 0.015, 0.006]), BLUSH);
  }
  if (!v2) {
    // mèche bouclée
    add('vinyl', own(tube([[0, 0.25, 0.08], [0, 0.274, 0.083], [0, 0.29, 0.068], [0, 0.288, 0.05], [0, 0.276, 0.046], [0, 0.272, 0.058]], 0.0075, 12, 4)), new THREE.Matrix4(), Y);
    add('vinyl', sphXL, mtx([0, 0.272, 0.058], [0, 0, 0], 0.0075), Y);
  }

  // yeux : blanc, pupille (vers le bec, un peu bas), reflet ; v2 : pupilles plus petites, sourcils froncés
  const H = new THREE.Vector3(0, 0.19, 0.075), R = 0.066;
  for (const s of [-1, 1]) {
    const n = new THREE.Vector3(s * 0.46, 0.3, 0.84).normalize();
    const at = (k) => [H.x + n.x * k, H.y + n.y * k, H.z + n.z * k];
    add('white', sphL, onSurface(at(R - 0.004), n.toArray(), [0.023, 0.028, 0.012]));
    const pn = n.clone().add(new THREE.Vector3(-s * 0.06, -0.06, 0.05)).normalize();
    const pk = (k) => [H.x + pn.x * k, H.y + pn.y * k, H.z + pn.z * k];
    add('rubber', sphL, onSurface(pk(R + 0.003), pn.toArray(), v2 ? [0.011, 0.012, 0.006] : [0.014, 0.018, 0.006]));
    const hn = n.clone().add(new THREE.Vector3(s * 0.04, 0.12, 0.0)).normalize();
    add('white', sphXL, onSurface([H.x + hn.x * (R + 0.008), H.y + hn.y * (R + 0.008), H.z + hn.z * (R + 0.008)], hn.toArray(), 0.005));
    if (v2) {
      const bn = n.clone().add(new THREE.Vector3(0, 0.3, -0.05)).normalize();
      add('rubber', sphXL, onSurface([H.x + bn.x * (R + 0.004), H.y + bn.y * (R + 0.004), H.z + bn.z * (R + 0.004)], bn.toArray(), [0.019, 0.0055, 0.006], s * 0.42));
    }
  }
  // bec en deux mandibules, narines
  add('beak', sphM, mtx([0, 0.178, 0.132], [-0.12, 0, 0], [0.04, 0.014, 0.048]));
  add('beak', sphL, mtx([0, 0.165, 0.126], [0.12, 0, 0], [0.03, 0.01, 0.034]));
  for (const s of [-1, 1]) add('rubber', sphXL, mtx([s * 0.011, 0.19, 0.163], [0, 0, 0], [0.0045, 0.003, 0.004]));

  // ---------------- baignoire : coque émaillée, eau, mousse, bande chromée, rivets
  add('tub', G.lathe('arme-canard-bain', TUB, 16), mtx([0, 0, 0], [0, 0, 0], [1, 1, TUB_Z]));
  add('water', own(new THREE.CircleGeometry(1, 24)), mtx([0, 0.06, 0], [-HP, 0, 0], [0.086, 0.086 * TUB_Z, 1]));
  add('chrome', own(ring(tubR(0.022) + 0.002, (tubR(0.022) + 0.002) * TUB_Z, 0.022, 0.0035)), new THREE.Matrix4());
  // mousse le long de la ligne de flottaison
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + Math.sin(i * 1.7) * 0.12, r = 0.009 + ((i * 53) % 5) * 0.0018;
    const k = 0.081 - ((i * 37) % 3) * 0.002;
    add('white', sphXL, mtx([Math.cos(a) * k, 0.068 + ((i * 29) % 4) * 0.0015, Math.sin(a) * k * TUB_Z], [0, 0, 0], [r, r * 0.8, r]));
  }
  // rivets sur le flanc bas
  const RIV = new THREE.SphereGeometry(1, 5, 2, 0, Math.PI * 2, 0, HP);
  tmp.push(RIV);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const { p, n } = tubSide(a, 0.006, 0.0);
    add('chrome', RIV, onSurface(p, n, 0.0042, 0).multiply(new THREE.Matrix4().makeRotationX(HP)));
  }
  // flancs : hublot de niveau (base) ou fagot de dynamite (v2), tableau de chasse de canards peints
  for (const s of [-1, 1]) {
    const a0 = s > 0 ? 0 : Math.PI;
    if (!v2) {
      const { p, n } = tubSide(a0 + s * 0.42, 0.036, 0.003);
      add('chrome', G.torus(1, 0.22, 3, 12), onSurface(p, n, 0.015));
      add('water', G.cyl(1, 1, 1, 10), onSurface(p, n, [0.012, 0.012, 0.004]).multiply(new THREE.Matrix4().makeRotationX(HP)));
    }
    for (let k = 0; k < 3; k++) {
      const { p, n } = tubSide(a0 - s * (0.12 + k * 0.3), 0.034, 0.0012);
      const sh = own(duckShape(s > 0));
      add('white', sh, onSurface(p, n, 0.021));
    }
    if (v2) {
      // trois bâtons rouges ligotés, mèches tordues vers l'arrière
      const x = s * 0.097, z = 0.045;
      for (const [dx, y] of [[0, 0.012], [0, 0.037], [s * 0.021, 0.0245]]) {
        add('beak', G.cyl(1, 1, 1, 8), mtx([x + dx, y, z], [HP, 0, 0], [0.0115, 0.075, 0.0115]));
        add('rubber', own(tube([[x + dx, y, z - 0.04], [x + dx + s * 0.004, y + 0.004, z - 0.052], [x + dx + s * 0.002, y + 0.012, z - 0.06]], 0.0018, 3, 3)), new THREE.Matrix4());
      }
      for (const dz of [-0.022, 0.022]) add('rubber', G.box(1, 1, 1), mtx([x + s * 0.008, 0.0245, z + dz], [0, 0, 0], [0.042, 0.054, 0.007]));
    }
  }
  // couinomètre à l'arrière (cadran, aiguille ; v2 : aiguille dans le rouge)
  {
    const { p, n } = tubSide(-HP, 0.03, 0.006);
    add('chrome', G.torus(1, 0.2, 3, 14), onSurface(p, n, 0.02));
    add('white', G.cyl(1, 1, 1, 16), onSurface(p, n, [0.02, 0.02, 0.003]).multiply(new THREE.Matrix4().makeRotationX(HP)));
    add('beak', G.cyl(1, 1, 1, 10, false), onSurface(p.map((v, i) => v + n[i] * 0.001 + (i === 0 ? -0.009 : 0)), n, [0.004, 0.004, 0.003]).multiply(new THREE.Matrix4().makeRotationX(HP)));
    const needle = v2 ? -1.1 : 0.5;
    add('rubber', G.box(1, 1, 1), onSurface(p.map((v, i) => v + n[i] * 0.0025), n, [0.0025, 0.03, 0.002], needle).multiply(new THREE.Matrix4().makeTranslation(0, 0.25, 0)));
    add('chrome', sphXL, onSurface(p.map((v, i) => v + n[i] * 0.003), n, 0.003));
  }

  // ---------------- crosse : caoutchouc rainuré, capuchon émaillé, bonde au bout d'une chaînette
  const Mg = mtx([0, -0.078, -0.028], [-0.3, 0, 0]);
  const g = (p, r, s) => Mg.clone().multiply(mtx(p, r, s));
  add('rubber', G.rbox(0.056, 0.135, 0.07, 0.022, 1), Mg.clone());
  // bosses des doigts à l'avant, plaquettes émaillées vissées et rainurées sur les flancs
  for (let i = 0; i < 3; i++) add('rubber', sphXL, g([0, 0.034 - i * 0.032, 0.032], [0, 0, 0], [0.023, 0.011, 0.007]));
  for (const s of [-1, 1]) {
    add('tub', G.box(0.006, 0.1, 0.054), g([s * 0.026, 0.002, -0.002], [0, 0, 0], 1));
    add('chrome', sphXL, g([s * 0.029, 0.038, -0.004], [0, 0, 0], [0.002, 0.0055, 0.0055]));
    for (let i = 0; i < 4; i++) add('rubber', G.box(0.002, 0.0035, 0.038), g([s * 0.0292, 0.017 - i * 0.012, -0.004], [0, 0, 0], 1));
  }
  add('tub', G.rbox(0.062, 0.02, 0.074, 0.008, 1), g([0, -0.07, 0], [0, 0, 0], 1));
  add('chrome', G.torus(0.006, 0.0018, 3, 6), g([0, -0.083, -0.022], [0, HP, 0], 1));
  add('chrome', G.torus(0.0055, 0.0016, 3, 6), g([0, -0.093, -0.022], [0, 0, 0], 1));
  add('rubber', G.cyl(0.011, 0.014, 0.012, 12), g([0, -0.112, -0.022], [0, 0, 0], 1));
  add('chrome', G.torus(0.004, 0.0015, 3, 6), g([0, -0.104, -0.022], [0, HP, 0], 1));
  // pontet chromé et détente en patte de canard
  add('chrome', own(tube([[0, -0.004, -0.0], [0, -0.038, 0.004], [0, -0.054, 0.032], [0, -0.044, 0.07], [0, -0.006, 0.084]], 0.0045, 12, 4)), new THREE.Matrix4());
  add('beak', sphL, mtx([0, -0.028, 0.04], [0.35, 0, 0], [0.016, 0.02, 0.005]));

  // ---------------- canon : collier, tube, ailettes émaillées cerclées de chrome, pavillon d'appeau, lentille
  const BY = 0.03;
  add('chrome', G.cyl(0.036, 0.036, 0.03, 16), mtx([0, BY, 0.135], [HP, 0, 0]));
  add('chrome', G.cyl(0.023, 0.023, 0.23, 14, true), mtx([0, BY, 0.255], [HP, 0, 0]));
  add('tub', G.cyl(0.03, 0.03, 0.05, 14), mtx([0, BY, 0.17], [HP, 0, 0]));
  const fins = v2 ? [[0.205, 0.066], [0.255, 0.058], [0.305, 0.05]] : [[0.21, 0.056], [0.255, 0.049], [0.3, 0.042]];
  for (const [z, r] of fins) {
    add('tub', G.cyl(r, r, 0.012, 16), mtx([0, BY, z], [HP, 0, 0]));
    add('chrome', G.cyl(r + 0.0025, r + 0.0025, 0.007, 16, true), mtx([0, BY, z], [HP, 0, 0]));
  }
  // bagues serrées avant le pavillon
  for (let i = 0; i < 4; i++) add('chrome', G.cyl(0.027, 0.027, 0.005, 12, true), mtx([0, BY, 0.322 + i * 0.008], [HP, 0, 0]));
  const bell = v2
    ? [[0.024, 0], [0.027, 0.02], [0.036, 0.045], [0.054, 0.066], [0.064, 0.072], [0.062, 0.078], [0.052, 0.074], [0.036, 0.058], [0.022, 0.045]]
    : [[0.024, 0], [0.027, 0.02], [0.034, 0.042], [0.048, 0.06], [0.056, 0.066], [0.055, 0.072], [0.046, 0.068], [0.032, 0.054], [0.02, 0.042]];
  const z0 = 0.355;
  add('chrome', G.lathe('arme-canard-pavillon' + (v2 ? '2' : ''), bell, 16), mtx([0, BY, z0], [HP, 0, 0]));
  add('light', G.sphere(1, 12, 6), mtx([0, BY, z0 + 0.046], [0, 0, 0], [0.03, 0.03, 0.012]));
  add('light', G.torus(1, 0.08, 3, 24), mtx([0, BY, z0 + 0.062], [0, 0, 0], v2 ? 0.052 : 0.046));
  if (v2) {
    // pointes autour du pavillon
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const d = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
      const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(-d.y, d.x, 0), d.clone().multiplyScalar(0.6).add(new THREE.Vector3(0, 0, 0.8)).normalize(), new THREE.Vector3(0, 0, 1));
      m.scale(new THREE.Vector3(0.01, 0.042, 0.01)).setPosition(d.x * 0.062, BY + d.y * 0.062, z0 + 0.078);
      add('chrome', G.cone(1, 1, 6), m);
    }
    // aileron dorsal sur le canon
    const fs = new THREE.Shape();
    fs.moveTo(0, 0); fs.lineTo(0.13, 0); fs.quadraticCurveTo(0.04, 0.01, -0.01, 0.062); fs.quadraticCurveTo(0.0, 0.03, 0, 0);
    const fin = own(new THREE.ExtrudeGeometry(fs, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1, curveSegments: 6 }));
    add('tub', fin, mtx([0.003 + 0.002, BY + 0.018, 0.17], [0, -HP, 0]));
    // mèche allumée plantée dans la tête : virole chromée, cordon, étincelle
    add('chrome', G.cyl(0.011, 0.013, 0.012, 10), mtx([0, 0.256, 0.072], [-0.25, 0, 0]));
    add('rubber', own(tube([[0, 0.258, 0.07], [0, 0.285, 0.062], [0, 0.302, 0.04], [0, 0.305, 0.018]], 0.004, 10, 4)), new THREE.Matrix4());
    add('light', G.ico(1, 0), mtx([0, 0.306, 0.014], [0.4, 0.3, 0], 0.011));
    for (const [rx, rz] of [[0, 0], [HP, 0], [0, HP], [0.8, 0.8]]) add('light', G.cone(1, 1, 5), mtx([0, 0.306, 0.014], [rx, 0, rz], [0.004, 0.05, 0.004]));
  }

  const out = {};
  for (const k of Object.keys(L)) if (L[k].length) out[k] = bakeList(L[k], k === 'vinyl');
  for (const x of tmp) x.dispose();
  CACHE.set(key, out);
  return out;
}

export function canardiseur(v2) {
  const g = new THREE.Group();
  const M = mats(v2);
  const geo = geometry(v2);
  for (const k of Object.keys(geo)) {
    const m = new THREE.Mesh(geo[k], M[k]);
    m.castShadow = k !== 'light' && k !== 'water';
    g.add(m);
  }
  g.userData.muzzles = [new THREE.Vector3(0, 0.03, 0.43)];
  return g;
}
