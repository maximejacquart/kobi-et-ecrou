// Zappeur à Chaîne : modèle tenu en main (canon vers +Z, origine à la main, poignée vers −Y).
// Un pistolet-Tesla : boîtier laqué, réservoir d'énergie lumineux sur des isolateurs en céramique, condensateurs
// sur les flancs, isolateur à ailettes puis bobine de cuivre autour d'un cœur lumineux, couronne de griffes à
// l'avant. v2 « Zappeur Orageux » : cinq griffes (une par cible), bobine plus longue, condensateurs doublés,
// paratonnerres, éclair de cuivre sur le réservoir et cinq voyants de charge.
// Pièces rigides fusionnées par matériau (8 matériaux), géométries en cache par variante.
import * as THREE from 'three';
import { G, mtx, mergeGeometries } from '../geo.js';
import { mat } from '../../engine/materials.js';
import { paintedMetalTexture } from '../../engine/textures.js';

const HP = Math.PI / 2;
const AY = 0.045; // hauteur de l'axe du canon

// ------------------------------------------------------------------ aides
// copie non indexée d'une géométrie, placée ; seuls position / normal / uv sont gardés
function at(geo, p = [0, 0, 0], r = [0, 0, 0], s = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return g.applyMatrix4(mtx(p, r, s));
}
// teinte par sommet (pour le matériau lumineux : plusieurs intensités dans un seul matériau)
function tint(g, color, k) {
  const c = new THREE.Color(color).multiplyScalar(k);
  const a = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; }
  g.setAttribute('color', new THREE.Float32BufferAttribute(a, 3));
  return g;
}
// UV d'une géométrie ramenées dans un rectangle de l'atlas d'autocollants
function uvRect(g, u0, v0, u1, v1) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return g;
}
const tube = (pts, r, segs = 16, rad = 5) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), segs, r, rad, false);
class Helix extends THREE.Curve {
  constructor(r, len, turns) { super(); this.r = r; this.len = len; this.turns = turns; }
  getPoint(t, out = new THREE.Vector3()) {
    const a = t * this.turns * Math.PI * 2;
    return out.set(Math.cos(a) * this.r, Math.sin(a) * this.r, t * this.len);
  }
}
// rivet bombé tourné vers +Y
let RIVET = null;
const rivet = () => RIVET || (RIVET = new THREE.SphereGeometry(1, 6, 2, 0, Math.PI * 2, 0, HP).scale(1, 0.55, 1));
// isolateur à ailettes (axe Y, de 0 à h) : n ailettes de rayon R sur un fût de rayon r
function insulator(key, r, R, h, n, segs = 20) {
  const pts = [[r * 0.9, 0]];
  for (let i = 0; i < n; i++) {
    const y0 = (i / n) * h, y1 = ((i + 1) / n) * h, d = y1 - y0;
    pts.push([r, y0 + d * 0.1], [R, y0 + d * 0.38], [R * 0.9, y0 + d * 0.56], [r, y0 + d * 0.86]);
  }
  pts.push([r * 0.9, h]);
  return G.lathe('zap' + key, pts, segs);
}

// ------------------------------------------------------------------ atlas d'autocollants (256 px, une fois)
// gauche : « HAUTE TENSION — NE PAS LÉCHER » ; droite : cadran du voltmètre, aiguille dans le rouge
let DECALS = null;
function decals() {
  if (DECALS) return DECALS;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  // autocollant : coin haut gauche, 128 × 92 px
  x.fillStyle = '#d8dde6'; x.fillRect(0, 0, 256, 256);
  const S = (ox, oy) => {
    x.save(); x.translate(ox, oy);
    x.fillStyle = '#ffd21f'; x.beginPath(); x.roundRect(3, 3, 122, 86, 10); x.fill();
    x.lineWidth = 4; x.strokeStyle = '#1d1a22'; x.stroke();
    // triangle et éclair
    x.fillStyle = '#1d1a22'; x.beginPath(); x.moveTo(30, 12); x.lineTo(52, 50); x.lineTo(8, 50); x.closePath(); x.fill();
    x.fillStyle = '#ffd21f'; x.beginPath(); x.moveTo(30, 19); x.lineTo(46, 46); x.lineTo(14, 46); x.closePath(); x.fill();
    x.fillStyle = '#1d1a22'; x.beginPath();
    x.moveTo(33, 22); x.lineTo(24, 36); x.lineTo(30, 36); x.lineTo(26, 46); x.lineTo(37, 31); x.lineTo(31, 31); x.lineTo(35, 22); x.closePath(); x.fill();
    x.font = 'bold 15px sans-serif'; x.textAlign = 'left';
    x.fillText('HAUTE', 58, 28); x.fillText('TENSION', 58, 45);
    x.fillStyle = '#c8261e'; x.fillRect(10, 56, 108, 26);
    x.fillStyle = '#ffffff'; x.font = 'bold 13px sans-serif'; x.textAlign = 'center';
    x.fillText('NE PAS LÉCHER', 64, 74);
    x.restore();
  };
  S(0, 0);
  // cadran : coin haut droit, 128 × 128 px
  x.save(); x.translate(192, 64);
  x.fillStyle = '#1d1a22'; x.beginPath(); x.arc(0, 0, 64, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#f4efdc'; x.beginPath(); x.arc(0, 0, 58, 0, Math.PI * 2); x.fill();
  const a0 = Math.PI * 0.8, a1 = Math.PI * 2.2;
  x.lineWidth = 9; x.strokeStyle = '#3fb860'; x.beginPath(); x.arc(0, 0, 46, a0, a0 + (a1 - a0) * 0.55); x.stroke();
  x.strokeStyle = '#ffb21f'; x.beginPath(); x.arc(0, 0, 46, a0 + (a1 - a0) * 0.55, a0 + (a1 - a0) * 0.78); x.stroke();
  x.strokeStyle = '#d8261e'; x.beginPath(); x.arc(0, 0, 46, a0 + (a1 - a0) * 0.78, a1); x.stroke();
  x.strokeStyle = '#1d1a22'; x.lineWidth = 2;
  for (let i = 0; i <= 10; i++) {
    const a = a0 + (a1 - a0) * (i / 10), l = i % 5 ? 8 : 14;
    x.beginPath(); x.moveTo(Math.cos(a) * 52, Math.sin(a) * 52); x.lineTo(Math.cos(a) * (52 - l), Math.sin(a) * (52 - l)); x.stroke();
  }
  x.fillStyle = '#1d1a22'; x.font = 'bold 14px sans-serif'; x.textAlign = 'center'; x.fillText('ZAP', 0, 30);
  const an = a0 + (a1 - a0) * 0.93;
  x.strokeStyle = '#c8261e'; x.lineWidth = 4; x.lineCap = 'round';
  x.beginPath(); x.moveTo(-Math.cos(an) * 8, -Math.sin(an) * 8); x.lineTo(Math.cos(an) * 48, Math.sin(an) * 48); x.stroke();
  x.fillStyle = '#1d1a22'; x.beginPath(); x.arc(0, 0, 7, 0, Math.PI * 2); x.fill();
  x.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.userData.shared = true;
  t.name = 'arme-zappeur-autocollants';
  DECALS = t;
  return t;
}

// ------------------------------------------------------------------ matériaux (en cache par mat())
let GLOW = null;
function mats(v2) {
  // peinture laquée écaillée : texture claire partagée (celle de Lunette), teintée par la couleur du matériau
  const pw = paintedMetalTexture('#eceaf6', 'lunette-blanc', { chip: 0.22, edge: 0.7, rust: 0.03, bare: '#9aa0b4' });
  if (!GLOW) {
    // lumineux à intensité par sommet ; la finition Méga le remplace par un néon doré (userData.isGlow)
    GLOW = new THREE.MeshBasicMaterial({ color: '#ffffff', vertexColors: true, toneMapped: true });
    GLOW.userData.shared = true;
    GLOW.userData.isGlow = true;
  }
  return {
    paint: mat(v2 ? '#5a8aff' : '#3a6ad8', { map: pw.map, normalMap: pw.normalMap, normalScale: 0.6, rough: 0.34, metal: 0.3, coat: 0.8 }),
    // en Méga : acier et céramique (clairs, peu saturés) passent à l'or, métal sombre et caoutchouc restent
    steel: mat('#cfd3d8', { rough: 0.26, metal: 0.9 }),
    dark: mat('#2c2c34', { rough: 0.36, metal: 0.7 }),
    rubber: mat('#1f1f22', { rough: 0.85 }),
    copper: mat('#d9824a', { rough: 0.28, metal: 0.95 }),
    ceramic: mat('#d6d4cc', { rough: 0.35, metal: 0, coat: 0.7 }),
    decal: mat('#ffffff', { map: decals(), rough: 0.4, metal: 0.1, coat: 0.6 }),
    glow: GLOW,
  };
}

// ------------------------------------------------------------------ géométrie (par variante, une fois)
const CACHE = new Map();
function build(v2) {
  const L = { paint: [], steel: [], dark: [], rubber: [], copper: [], ceramic: [], decal: [], glow: [] };
  const CY = '#7ff3ff', PALE = '#d8fcff';
  const glw = (g, k = 2, col = CY) => L.glow.push(tint(g, col, k));
  const zc = (geo, z, r = 0, extra = [0, 0, 0]) => at(geo, [extra[0], AY + extra[1], z], [HP, 0, r]); // pièce de révolution d'axe Z

  // --- boîtier laqué
  L.paint.push(at(G.rbox(0.13, 0.125, 0.24, 0.035, 2), [0, AY, 0.03]));
  L.paint.push(at(G.rbox(0.075, 0.03, 0.2, 0.012, 1), [0, 0.112, 0.02])); // dos, sous le réservoir
  L.paint.push(at(G.rbox(0.085, 0.05, 0.1, 0.02, 1), [0, -0.02, 0.1])); // ventre devant la détente
  // collerette évasée qui porte l'avant
  L.paint.push(zc(G.lathe('zapCol', [[0.062, 0], [0.07, 0.008], [0.078, 0.03], [0.074, 0.04], [0.05, 0.045], [0.04, 0.045]], 18), 0.145));
  // plaque arrière, cadran, évents, rivets
  L.dark.push(at(G.rbox(0.116, 0.11, 0.022, 0.02, 1), [0, AY, -0.093]));
  L.dark.push(zc(G.cyl(0.036, 0.038, 0.022, 18), -0.106, 0, [0, 0.015, 0]));
  L.steel.push(at(G.torus(0.032, 0.0042, 4, 16), [0, AY + 0.015, -0.118]));
  L.decal.push(uvRect(at(new THREE.CircleGeometry(0.03, 18), [0, AY + 0.015, -0.1175], [0, Math.PI, 0]), 0.5, 0.5, 1, 1));
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 4; i++) L.dark.push(at(G.box(0.008, 0.008, 0.06), [sx * 0.064, 0.012 + i * 0.019, -0.035]));
    // autocollant « Haute tension »
    L.decal.push(uvRect(at(new THREE.PlaneGeometry(0.06, 0.043), [sx * 0.0656, 0.052, 0.062], [0, sx * HP, 0]), 0, 0.6406, 0.5, 1));
    for (const [y, z] of [[0.0, -0.072], [0.09, -0.072], [0.09, 0.112]]) L.steel.push(at(rivet(), [sx * 0.064, y, z], [0, 0, -sx * HP], [0.006, 0.006, 0.006]));
  }
  // voyants arrière (vert / ambre / rouge)
  [['#5aff7a', -0.03], ['#ffc23a', 0], ['#ff4a3a', 0.03]].forEach(([col, x], i) => {
    L.dark.push(zc(G.cyl(0.008, 0.008, 0.006, 8), -0.106, 0, [x * 0.8, -0.038, 0]));
    glw(at(G.ico(0.0058, 0), [x * 0.8, AY - 0.038, -0.11]), i === 2 ? 3 : 2, col);
  });

  // --- poignée caoutchouc, détente, pontet
  const gr = -0.3;
  const gp = (y, z) => [0, -0.02 + y * Math.cos(gr) - z * Math.sin(gr), -0.04 + y * Math.sin(gr) + z * Math.cos(gr)];
  const gm = (geo, y, z, s = 1, r = [0, 0, 0]) => at(geo, gp(y, z), [gr + r[0], r[1], r[2]], s);
  L.rubber.push(gm(G.rbox(0.064, 0.15, 0.075, 0.02, 1), -0.07, 0));
  for (let i = 0; i < 3; i++) L.rubber.push(gm(G.capsule(0.012, 0.034, 1, 6), -0.035 - i * 0.034, 0.03, 1, [0, 0, HP]));
  for (let i = 0; i < 4; i++) L.dark.push(gm(G.capsule(0.0045, 0.036, 1, 5), -0.032 - i * 0.026, -0.036, 1, [0, 0, HP]));
  L.dark.push(gm(G.rbox(0.072, 0.022, 0.085, 0.009, 1), -0.148, 0));
  L.steel.push(gm(G.cyl(0.012, 0.012, 0.004, 10), -0.16, 0));
  L.steel.push(at(G.rbox(0.014, 0.036, 0.014, 0.006, 1), [0, -0.037, 0.032], [0.3, 0, 0]));
  L.dark.push(at(tube([[0, -0.04, 0.075], [0, -0.072, 0.068], [0, -0.082, 0.035], [0, -0.072, 0.0]], 0.0055, 10, 5)));

  // --- réservoir d'énergie sur deux isolateurs
  const TY = 0.168, TZ = 0.015, TL = v2 ? 0.17 : 0.155;
  for (const z of [-0.045, 0.075]) {
    L.ceramic.push(at(insulator('post', 0.011, 0.02, 0.026, 1, 10), [0, 0.124, TZ + z]));
    L.steel.push(at(G.cyl(0.016, 0.016, 0.006, 10), [0, 0.124, TZ + z]));
  }
  glw(at(G.cyl(0.034, 0.034, TL, 16), [0, TY, TZ], [HP, 0, 0]), 1.5);
  glw(at(G.cyl(0.012, 0.012, TL - 0.01, 6), [0, TY, TZ], [HP, 0, 0]), 4, PALE);
  for (const s of [-1, 1]) {
    L.steel.push(at(G.cyl(0.044, 0.042, 0.022, 14), [0, TY, TZ + s * (TL / 2 + 0.008)], [HP, 0, 0]));
    L.dark.push(at(G.cyl(0.03, 0.03, 0.01, 12), [0, TY, TZ + s * (TL / 2 + 0.022)], [HP, 0, 0]));
    L.steel.push(at(G.cyl(0.006, 0.006, 0.014, 6), [0, TY, TZ + s * (TL / 2 + 0.032)], [HP, 0, 0]));
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    L.steel.push(at(G.cyl(0.0045, 0.0045, TL, 4), [Math.cos(a) * 0.039, TY + Math.sin(a) * 0.039, TZ], [HP, 0, 0]));
  }
  L.dark.push(at(G.cyl(0.042, 0.042, 0.014, 16, true), [0, TY, TZ], [HP, 0, 0]));
  // câble du réservoir vers la bobine, et de l'arrière du réservoir vers le boîtier
  L.copper.push(at(tube([[0, TY + 0.012, TZ + TL / 2 + 0.035], [0, TY + 0.03, 0.17], [0, AY + 0.075, 0.24], [0, AY + 0.052, 0.27]], 0.0045, 14, 4)));
  L.rubber.push(at(tube([[0, TY, TZ - TL / 2 - 0.035], [0.02, TY - 0.01, -0.105], [0.05, 0.11, -0.1], [0.06, 0.09, -0.07]], 0.007, 12, 5)));

  // --- condensateurs sur les flancs
  // v2 : une deuxième paire, plus petite, de part et d'autre du réservoir
  const caps = v2 ? [[0.088, 0.006, 0.023], [0.066, 0.134, 0.016]] : [[0.088, 0.004, 0.024]];
  for (const sx of [-1, 1]) for (const [cx, cy, cr] of caps) {
    const x = sx * cx, z0 = -0.005, len = 0.13;
    L.dark.push(at(G.cyl(cr, cr, len, cy > 0.1 ? 10 : 12), [x, cy, z0 + len / 2], [HP, 0, 0]));
    L.copper.push(at(G.cyl(cr + 0.002, cr + 0.002, 0.045, cy > 0.1 ? 10 : 12, true), [x, cy, z0 + len * 0.45], [HP, 0, 0]));
    if (cy < 0.1) for (const z of [z0 + 0.02, z0 + 0.11]) L.steel.push(at(G.cyl(cr + 0.0015, cr + 0.0015, 0.005, 10, true), [x, cy, z], [HP, 0, 0]));
    // pattes de fixation au boîtier
    if (cy < 0.1) for (const z of [z0 + 0.03, z0 + 0.1]) L.dark.push(at(G.box(0.03, 0.012, 0.02), [sx * 0.072, cy, z]));
    else for (const z of [z0 + 0.03, z0 + 0.1]) L.dark.push(at(G.box(0.012, 0.02, 0.016), [x, cy - 0.016, z]));
    if (cy > 0.1) { L.steel.push(at(G.cyl(cr * 0.8, cr, 0.01, 10), [x, cy, z0 + len + 0.005], [HP, 0, 0])); continue; }
    L.ceramic.push(at(insulator('cap' + cr, cr * 0.55, cr * 0.95, 0.024, 1, 10), [x, cy, z0 + len], [HP, 0, 0]));
    L.steel.push(at(G.cyl(0.004, 0.004, 0.02, 6), [x, cy, z0 + len + 0.035], [HP, 0, 0]));
    L.copper.push(at(tube([[x, cy, z0 + len + 0.04], [x * 0.95, cy + 0.004, 0.2], [x * 0.7, cy * 0.5 + AY * 0.5, 0.235], [x * 0.38, AY + (cy - AY) * 0.3, 0.26]], 0.0032, 10, 4)));
  }

  // --- avant : isolateur à ailettes, bobine sur cœur lumineux, couronne de griffes
  const Z0 = 0.185, ZB = 0.275, ZE = v2 ? 0.435 : 0.405;
  L.steel.push(zc(G.cyl(0.02, 0.02, ZE - Z0 + 0.02, 10), (Z0 + ZE) / 2));
  L.ceramic.push(zc(insulator('front', 0.032, 0.058, ZB - Z0, 3, 14), Z0));
  L.dark.push(zc(G.cyl(0.052, 0.052, 0.012, 18), ZB + 0.004));
  glw(zc(G.cyl(0.031, 0.031, ZE - ZB, 14), (ZB + ZE) / 2), 2.3);
  const turns = v2 ? 8 : 7, len = ZE - ZB - 0.016;
  L.copper.push(at(new THREE.TubeGeometry(new Helix(0.041, len, turns), turns * 7, 0.0068, 5, false), [0, AY, ZB + 0.012]));
  // bague avant et griffes
  L.dark.push(zc(G.cyl(0.054, 0.05, 0.02, 18), ZE + 0.006));
  L.steel.push(at(G.torus(0.052, 0.005, 4, 18), [0, AY, ZE - 0.004]));
  const nP = v2 ? 5 : 3, Lp = v2 ? 0.1 : 0.085;
  for (let i = 0; i < nP; i++) {
    const a = HP + (i / nP) * Math.PI * 2;
    const P = (r, z) => [Math.cos(a) * r, AY + Math.sin(a) * r, ZE + z];
    L.steel.push(at(G.box(0.018, 0.014, 0.024), P(0.046, 0.022), [0, 0, a - HP]));
    L.copper.push(at(tube([P(0.046, 0.02), P(0.062, 0.045), P(0.05, Lp * 0.8), P(0.026, Lp)], 0.0065, 8, 4)));
    glw(at(G.sphere(0.009, 6, 4), P(0.024, Lp + 0.003)), 3.5, PALE);
  }
  // émetteur : boule qui grésille au centre des griffes
  glw(at(G.ico(0.03, 1), [0, AY, ZE + Lp * 0.62]), 3.2, PALE);
  L.steel.push(zc(G.cyl(0.012, 0.016, 0.03, 8), ZE + 0.03));

  // --- v2 : paratonnerres, éclair de cuivre, cinq voyants de charge
  if (v2) {
    for (const sx of [-1, 1]) {
      const b = [sx * 0.05, 0.105, -0.075];
      L.ceramic.push(at(insulator('rod', 0.008, 0.017, 0.022, 1, 10), b, [-0.35, 0, -sx * 0.45]));
      const d = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(-0.35, 0, -sx * 0.45));
      const p = (t) => [b[0] + d.x * t, b[1] + d.y * t, b[2] + d.z * t];
      L.steel.push(at(G.cyl(0.0035, 0.005, 0.1, 6), p(0.08), [-0.35, 0, -sx * 0.45]));
      L.dark.push(at(G.cyl(0.011, 0.011, 0.005, 8), p(0.1), [-0.35, 0, -sx * 0.45]));
      glw(at(G.sphere(0.011, 6, 4), p(0.132)), 3.5, PALE);
    }
    // éclair de cuivre posé sur le réservoir (aileron en zigzag)
    const sh = new THREE.Shape();
    [[0, 0], [0.05, 0], [0.03, 0.022], [0.06, 0.022], [-0.005, 0.07], [0.012, 0.036], [-0.02, 0.036]].forEach(([u, v], i) => (i ? sh.lineTo(u, v) : sh.moveTo(u, v)));
    const bolt = new THREE.ExtrudeGeometry(sh, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 });
    L.copper.push(at(bolt, [0.004, TY + 0.036, TZ - 0.03], [0, -HP, 0]));
    bolt.dispose();
    // cinq voyants de charge par flanc (un par cible), le dernier jaune orage
    for (const sx of [-1, 1]) {
      L.dark.push(at(G.box(0.006, 0.078, 0.018), [sx * 0.0645, AY, -0.074]));
      for (let i = 0; i < 5; i++) glw(at(G.ico(0.0055, 0), [sx * 0.067, AY + 0.028 - i * 0.014, -0.074]), 2.6, i ? CY : '#ffe95a');
    }
  }

  const out = [];
  for (const k of Object.keys(L)) {
    if (!L[k].length) continue;
    const g = mergeGeometries(L[k]);
    g.userData.shared = true;
    for (const x of L[k]) x.dispose();
    out.push([k, g]);
  }
  return out;
}

export function zappeur(v2) {
  const key = v2 ? 'v2' : 'base';
  if (!CACHE.has(key)) CACHE.set(key, build(v2));
  const M = mats(v2);
  const g = new THREE.Group();
  for (const [k, geo] of CACHE.get(key)) g.add(new THREE.Mesh(geo, M[k]));
  g.userData.muzzles = [new THREE.Vector3(0, AY, (v2 ? 0.435 : 0.405) + (v2 ? 0.1 : 0.085) * 0.62 + 0.03)];
  return g;
}
