// Clé à molette de Kobi (corps à corps) : modèle tenu en main, tête vers +Z, origine dans la main.
// Grosse tête de dessin animé en acier brossé (mâchoire fixe, mâchoire mobile, molette de laiton à gorges visible par
// la fenêtre), manche en I à canal sombre avec l'autocollant de Kobi, poignée de caoutchouc rouge à crans, embout et
// anneau de suspension. Contour sombre comme celui du héros : elle doit se lire nettement pendant un coup.
import * as THREE from 'three';
import { G, bake, mtx } from '../geo.js';
import { mat, outlineMaterial } from '../../engine/materials.js';
import { build, noiseP, fbmP, scratch, sstep, mix3, hex } from '../../engine/textures.js';

const HP = Math.PI / 2;
const HEAD_Z = 0.78; // centre de la tête

// ------------------------------------------------------------------ textures (générées au premier appel)
// Acier brossé usé : stries fines dans le sens du manche, voile de cambouis, rayures claires et coups.
function steelTexture() {
  const lo = hex('#aab3c4'), hi = hex('#f1f4fa'), grime = hex('#6e6458'), bright = hex('#ffffff');
  return build('arme-cle-acier', 256, (u, v, out) => {
    const brush = noiseP(u * 2, v * 128, 2, 128, 811) * 0.6 + noiseP(u * 4, v * 256, 4, 256, 812) * 0.4;
    const n = fbmP(u * 4, v * 4, 4, 4, 4, 813);
    mix3(out, lo, hi, Math.min(1, 0.35 + brush * 0.35 + (n - 0.5) * 0.6));
    let h = 0.5 + brush * 0.04;
    // cambouis dans les creux du bruit
    const gr = fbmP(u * 5, v * 5, 5, 5, 4, 817);
    if (gr > 0.6) mix3(out, out, grime, Math.min(0.45, (gr - 0.6) * 2.2));
    // coups (petites cuvettes sombres cernées de clair)
    const d = fbmP(u * 12, v * 12, 12, 12, 2, 819);
    if (d > 0.76) { mix3(out, out, lo.map((c) => c * 0.82), sstep(0.76, 0.84, d) * 0.35); h -= sstep(0.76, 0.84, d) * 0.3; }
    // rayures claires
    const s1 = scratch(u, v, 16, 821), s2 = scratch(u, v, 32, 823);
    if (s1 < 0.0022) { mix3(out, out, bright, 0.45); h -= 0.2; }
    else if (s2 < 0.0016) { mix3(out, out, bright, 0.25); h -= 0.1; }
    return h;
  }, 2);
}

// Autocollant du manche (64 × 256) : « KOBI » sur fond jaune, une étiquette de mise en garde, usé aux bords.
const LABEL = new Map();
function labelCanvas() {
  if (LABEL.has('t')) return LABEL.get('t');
  const W = 64, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  // fond : le canal sombre du manche (coins de l'autocollant)
  x.fillStyle = '#34323f'; x.fillRect(0, 0, W, H);
  // autocollant jaune arrondi, liseré sombre
  const r = 12;
  x.beginPath(); x.roundRect(4, 6, W - 8, H - 12, r); x.fillStyle = '#ffc63a'; x.fill();
  x.lineWidth = 3; x.strokeStyle = '#2a2033'; x.beginPath(); x.roundRect(8, 10, W - 16, H - 20, r - 4); x.stroke();
  // texte le long du manche (lu de la poignée vers la tête)
  x.save(); x.translate(W / 2, H / 2); x.rotate(-HP);
  x.fillStyle = '#2a2033'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '900 34px "Arial Black", Arial, sans-serif';
  x.fillText('KOBI', -52, 2);
  // petit écrou (la monnaie) en guise de logo
  x.translate(22, 0);
  x.beginPath();
  for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; x.lineTo(Math.cos(a) * 13, Math.sin(a) * 13); }
  x.closePath(); x.fill();
  x.beginPath(); x.arc(0, 0, 5.5, 0, Math.PI * 2); x.fillStyle = '#ffc63a'; x.fill();
  x.fillStyle = '#c2462f'; x.font = 'bold 9px Arial, sans-serif';
  x.fillText('PAS TOUCHE', 56, 1);
  x.restore();
  // usure : éclats et rayures qui laissent voir le canal
  const img = x.getImageData(0, 0, W, H), d = img.data;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const u = i / W, v = j / H, k = (j * W + i) * 4;
    const e = Math.min(u, 1 - u, v * 4, (1 - v) * 4);
    const w = fbmP(u * 4, v * 16, 4, 16, 3, 831) + sstep(0.2, 0.0, e) * 0.35;
    const s = scratch(u, v * 4, 5, 833);
    if (w > 0.78 || s < 0.006) { d[k] = 0x34; d[k + 1] = 0x32; d[k + 2] = 0x3f; }
    else if (w > 0.72) { d[k] *= 0.8; d[k + 1] *= 0.8; d[k + 2] *= 0.8; }
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.userData.shared = true;
  LABEL.set('t', t);
  return t;
}

// ------------------------------------------------------------------ aides géométriques
// Lissage des normales par angle de pli (les biseaux d'extrusion restent ronds, les arêtes franches restent nettes)
function creaseNormals(geo, deg = 40) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const P = g.attributes.position, n = P.count;
  const fn = new Float32Array(n * 3), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(P, i); b.fromBufferAttribute(P, i + 1); c.fromBufferAttribute(P, i + 2);
    c.sub(b); a.sub(b); c.cross(a); // aire × normale
    for (let k = 0; k < 3; k++) fn.set([c.x, c.y, c.z], (i + k) * 3);
  }
  const groups = new Map(), key = (i) => `${Math.round(P.getX(i) * 1e4)}|${Math.round(P.getY(i) * 1e4)}|${Math.round(P.getZ(i) * 1e4)}`;
  for (let i = 0; i < n; i++) { const k = key(i); let l = groups.get(k); if (!l) groups.set(k, (l = [])); l.push(i); }
  const N = new Float32Array(n * 3), cos = Math.cos((deg * Math.PI) / 180), f = new THREE.Vector3(), o = new THREE.Vector3(), s = new THREE.Vector3();
  for (const l of groups.values()) for (const i of l) {
    f.fromArray(fn, i * 3).normalize(); s.set(0, 0, 0);
    for (const j of l) { o.fromArray(fn, j * 3); if (o.clone().normalize().dot(f) >= cos) s.add(o); }
    s.normalize(); N.set([s.x, s.y, s.z], i * 3);
  }
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  return g;
}
// Extrusion biseautée d'une forme du plan (x, y), posée à plat : y → +Z, épaisseur selon Y (centrée)
function slab(shape, depth, bev, curve = 6) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelOffset: -bev, bevelSegments: 2, curveSegments: curve });
  g.translate(0, 0, -depth / 2);
  g.rotateX(HP);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.2, uv.getY(i) * 2.2);
  return creaseNormals(g, 50);
}
// Molette (vis sans fin, axe X) : des gorges tout autour, qu'on voit défiler par la fenêtre de la tête
function knurl(r, len, rings = 7) {
  const g = new THREE.CylinderGeometry(r, r, len, 12, rings * 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (Math.hypot(x, z) < r * 0.5) continue;
    const k = 1 - 0.22 * Math.abs(Math.sin(((y / len) + 0.5) * rings * Math.PI));
    p.setXYZ(i, x * k, y, z * k);
  }
  g.computeVertexNormals();
  g.rotateZ(HP);
  return g;
}

// Formes de la tête (repère de la tête, y → +Z)
function bodyShape() {
  const s = new THREE.Shape();
  s.moveTo(0.062, -0.02);
  s.lineTo(0.062, 0.15);
  s.quadraticCurveTo(0.064, 0.2, 0.11, 0.2);
  s.quadraticCurveTo(0.19, 0.2, 0.207, 0.1);
  s.bezierCurveTo(0.235, -0.02, 0.2, -0.12, 0.12, -0.16);
  s.quadraticCurveTo(0.072, -0.185, 0.062, -0.24);
  s.lineTo(-0.062, -0.24);
  s.quadraticCurveTo(-0.072, -0.185, -0.12, -0.16);
  s.bezierCurveTo(-0.2, -0.12, -0.216, -0.07, -0.212, -0.02);
  s.lineTo(0.062, -0.02);
  // fenêtre de la molette
  const h = new THREE.Path();
  const x0 = -0.152, x1 = -0.022, y0 = -0.126, y1 = -0.058, r = 0.022;
  h.moveTo(x0 + r, y0); h.lineTo(x1 - r, y0); h.quadraticCurveTo(x1, y0, x1, y0 + r); h.lineTo(x1, y1 - r);
  h.quadraticCurveTo(x1, y1, x1 - r, y1); h.lineTo(x0 + r, y1); h.quadraticCurveTo(x0, y1, x0, y1 - r);
  h.lineTo(x0, y0 + r); h.quadraticCurveTo(x0, y0, x0 + r, y0);
  s.holes.push(h);
  return s;
}
function jawShape() {
  const s = new THREE.Shape();
  s.moveTo(-0.062, -0.008);
  s.lineTo(-0.062, 0.14);
  s.quadraticCurveTo(-0.064, 0.19, -0.105, 0.19);
  s.quadraticCurveTo(-0.186, 0.19, -0.202, 0.1);
  s.quadraticCurveTo(-0.214, 0.04, -0.212, -0.008);
  s.lineTo(-0.062, -0.008);
  return s;
}

// Géométries fusionnées par matériau, calculées une fois
let GEO = null;
function geometries() {
  if (GEO) return GEO;
  const L = { steel: [], dark: [], brass: [], red: [], black: [], label: [] };
  const H = []; // pièces de la silhouette, reprises dans la coque du contour
  const sil = (k, geo, m) => { L[k].push([geo, m]); H.push([geo, m]); };
  const head = (p, r = [0, 0, 0], s = 1) => mtx([p[0], p[1], p[2] + HEAD_Z], r, s);
  // --- tête
  sil('steel', slab(bodyShape(), 0.07, 0.016), head([0, 0, 0]));
  sil('steel', slab(jawShape(), 0.062, 0.016), head([0, 0, 0]));
  L.brass.push([knurl(0.058, 0.112), head([-0.087, 0, -0.092])]);
  L.dark.push([G.cyl(0.014, 0.014, 0.2, 8), head([-0.087, 0, -0.092], [0, 0, HP])]); // axe de la molette
  // rivets du col
  const RIV = new THREE.SphereGeometry(1, 7, 3, 0, Math.PI * 2, 0, HP).scale(0.016, 0.009, 0.016);
  for (const sy of [1, -1]) for (const x of [-0.019, 0.019]) L.steel.push([RIV, head([x, sy * 0.052, -0.215], [sy > 0 ? 0 : Math.PI, 0, 0])]);
  // --- manche en I : âme sombre, deux longerons d'acier
  const z0 = 0.18, z1 = 0.62, zl = (z0 + z1) / 2, ll = z1 - z0;
  L.dark.push([G.rbox(0.084, 0.042, ll, 0.008, 1), mtx([0, 0, zl])]);
  for (const x of [-0.05, 0.05]) sil('steel', G.rbox(0.03, 0.07, ll + 0.04, 0.013, 1), mtx([x, 0, zl + 0.01]));
  // le canal se prolonge en goutte sur le col de la tête
  const drop = new THREE.Shape();
  drop.moveTo(-0.035, -0.26); drop.lineTo(0.035, -0.26); drop.lineTo(0.035, -0.2);
  drop.quadraticCurveTo(0.035, -0.135, 0, -0.13); drop.quadraticCurveTo(-0.035, -0.135, -0.035, -0.2); drop.lineTo(-0.035, -0.26);
  L.dark.push([slab(drop, 0.096, 0.004, 5), head([0, 0, 0])]);
  // autocollants (dessus et dessous)
  const lab = new THREE.PlaneGeometry(0.066, 0.27);
  L.label.push([lab, mtx([0, 0.0215, 0.4], [-HP, 0, Math.PI])]);
  L.label.push([lab, mtx([0, -0.0215, 0.4], [HP, 0, Math.PI])]);
  // --- virole entre manche et poignée
  sil('dark', G.lathe('cleVirole', [[0.001, 0.0], [0.05, 0.0], [0.054, 0.012], [0.054, 0.03], [0.046, 0.045], [0.001, 0.045]], 14), mtx([0, 0, 0.15], [HP, 0, 0]));
  L.steel.push([G.torus(0.053, 0.006, 5, 14), mtx([0, 0, 0.172])]);
  // --- poignée caoutchouc à crans
  const gp = [[0.001, -0.15], [0.05, -0.15], [0.055, -0.14], [0.05, -0.12]];
  for (let y = -0.1; y < 0.13; y += 0.035) gp.push([0.044, y], [0.049, y + 0.0175]);
  gp.push([0.046, 0.135], [0.05, 0.15], [0.042, 0.158], [0.001, 0.158]);
  sil('red', G.lathe('clePoignee', gp, 14), mtx([0, 0, 0], [HP, 0, 0]));
  // réparation au chatterton : une bande noire et son bout qui rebique
  L.black.push([G.cyl(0.053, 0.053, 0.032, 14, true), mtx([0, 0, 0.1], [HP, 0, 0])]);
  L.black.push([G.box(0.026, 0.003, 0.03), mtx([0.044, 0.032, 0.124], [0.25, 0.95, 0.15])]);
  // embout noir et anneau de suspension
  sil('black', G.lathe('cleEmbout', [[0.001, -0.202], [0.024, -0.2], [0.044, -0.188], [0.056, -0.168], [0.057, -0.148], [0.001, -0.148]], 14), mtx([0, 0, 0], [HP, 0, 0]));
  sil('steel', G.torus(0.032, 0.009, 6, 12), mtx([0, 0, -0.22], [HP, 0, 0]));
  const out = {};
  // pièces dessinées à plat (épaisseur selon Y), puis la clé est tournée d'un quart de tour sur son axe : la face
  // de la tête se présente à la caméra pendant les coups balayés (vus de dos), au lieu de la tranche
  for (const k of Object.keys(L)) { out[k] = bake(L[k]).rotateZ(HP); out[k].userData.shared = true; }
  // contour : coque des pièces de la silhouette, normales lissées partout (pas de trou aux arêtes)
  const hull = new THREE.BufferGeometry();
  hull.setAttribute('position', bake(H).rotateZ(HP).attributes.position);
  out.outline = creaseNormals(hull, 180);
  out.outline.userData.shared = true;
  GEO = out;
  return out;
}

function materials() {
  const st = steelTexture();
  return {
    steel: mat('#eef3ff', { map: st.map, normalMap: st.normalMap, normalScale: 0.6, rough: 0.3, metal: 0.55, coat: 0.5, rim: 1.4 }),
    dark: mat('#3a3848', { rough: 0.38, metal: 0.7, coat: 0.5 }),
    brass: mat('#f0b440', { rough: 0.26, metal: 0.95, coat: 0.3 }),
    red: mat('#e8323e', { rough: 0.55, sheen: 0.6, sheenColor: '#ff9a9a', rim: 1.3 }),
    black: mat('#24202c', { rough: 0.7, sheen: 0.4, sheenColor: '#8a8aa0' }),
    label: mat('#ffffff', { map: labelCanvas(), rough: 0.45, coat: 0.6 }),
    outline: outlineMaterial('#1d1028', 0.009),
  };
}

export function wrenchModel() {
  const g = new THREE.Group();
  const geo = geometries(), M = materials();
  for (const k of ['steel', 'dark', 'brass', 'red', 'black', 'label']) {
    const m = new THREE.Mesh(geo[k], M[k]);
    m.castShadow = true;
    g.add(m);
  }
  const ol = new THREE.Mesh(geo.outline, M.outline);
  ol.castShadow = false;
  ol.userData.isOutline = true;
  ol.raycast = () => {};
  g.add(ol);
  // tenue en main (rotation X dans le poing) : la clé part à 45° au-dessus de l'avant-bras, comme un marteau, pour que la
  // tête dépasse des épaules pendant un coup vu de dos (dans le prolongement du bras, le corps la cachait)
  g.userData.hold = Math.PI / 4;
  return g;
}
