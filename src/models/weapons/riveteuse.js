// Riveteuse : pistolet à rivets d'atelier, modèle tenu en main (canon vers +Z, poignée vers -Y près de l'origine).
// Carter jaune laqué et écaillé, barillet-chargeur de rivets en laiton sur le dos (bien visible de l'arrière),
// manomètre au cul du carter, durite d'air comprimé, nez à ressort de rappel et bouche de bouterolle.
// v2 « Riveteuse Furieuse » : carter orange plus anguleux, deux canons à résistances de chauffe, rivets chauffés
// à blanc dans le barillet, radiateur dorsal, cheminées d'échappement et éperons de ricochet à la bouche.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mtx, bake } from '../geo.js';
import { mat, glow } from '../../engine/materials.js';
import { build, scratch } from '../../engine/textures.js';
import { fbm2, clamp } from '../../engine/util.js';

const HP = Math.PI / 2, TAU = Math.PI * 2;
const BY = 0.035; // hauteur de l'axe des canons

// ------------------------------------------------------------------ textures (générées au premier appel)
// Peinture laquée quasi blanche (la couleur vient du matériau, la Méga la reteinte) : marbrure, éclats de métal nu
// cernés de sombre, rayures, crasse dans les creux.
function paintTex() {
  return build('arme-riveteuse-peinture', 256, (u, v, out) => {
    const n = fbm2(u * 4, v * 4, 4, 811, 4);
    const b = 0.93 + (n - 0.5) * 0.12;
    out[0] = out[1] = out[2] = b;
    let h = 0.6 + (n - 0.5) * 0.05;
    const c = fbm2(u * 7, v * 7, 4, 823, 7) * 0.75 + fbm2(u * 24, v * 24, 2, 829, 24) * 0.25;
    if (c > 0.72) {
      const m = 0.5 + fbm2(u * 40, v * 40, 2, 831, 40) * 0.25;
      out[0] = out[1] = out[2] = m;
      h = 0.45;
    } else if (c > 0.70) {
      out[0] = out[1] = out[2] = b * 0.55;
      h = 0.64;
    }
    if (c <= 0.70 && scratch(u, v, 7, 837) < 0.004) { out[0] = out[1] = out[2] = Math.min(1, b + 0.07); h -= 0.06; }
    const gr = fbm2(u * 3 + 7, v * 3, 3, 841, 3);
    if (gr > 0.62) { const k = 1 - clamp((gr - 0.62) * 1.4, 0, 0.25); out[0] *= k; out[1] *= k; out[2] *= k * 0.95; }
    return h;
  }, 2);
}

// Planche d'autocollants (canvas 256) : A = cadran du manomètre (haut gauche), B = autocollant « BRÛLANT » de la v2
// (haut droite), C = plaque de la Riveteuse (moitié basse).
let DECAL = null;
function decalTex() {
  if (DECAL) return DECAL;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  const F = 'Arial Black, Arial, sans-serif';
  const rrect = (x0, y0, w, h, r) => { x.beginPath(); x.roundRect(x0, y0, w, h, r); };
  const stripes = (x0, y0, w, h, a = '#ffc21a', b = '#1d1a22') => {
    x.save(); rrect(x0, y0, w, h, 0); x.clip();
    x.fillStyle = a; x.fillRect(x0, y0, w, h);
    x.fillStyle = b;
    for (let s = -h; s < w + h; s += 18) { x.beginPath(); x.moveTo(x0 + s, y0 + h); x.lineTo(x0 + s + 9, y0 + h); x.lineTo(x0 + s + 9 + h, y0); x.lineTo(x0 + s + h, y0); x.fill(); }
    x.restore();
  };
  x.fillStyle = '#d9a441'; // fond = teinte du laiton (UV des pièces en laiton dans le coin haut gauche)
  x.fillRect(0, 0, 256, 256);

  // --- A : cadran (angles du canevas, sens horaire depuis +x ; « haut » = 270°)
  x.save();
  x.translate(64, 64);
  x.fillStyle = '#26222e'; x.beginPath(); x.arc(0, 0, 64, 0, TAU); x.fill();
  x.fillStyle = '#f4ecd6'; x.beginPath(); x.arc(0, 0, 57, 0, TAU); x.fill();
  const deg = (d) => (d * Math.PI) / 180;
  for (const [a0, a1, col] of [[135, 270, '#3fa35a'], [270, 330, '#ffb21a'], [330, 405, '#e0302a']]) {
    x.strokeStyle = col; x.lineWidth = 9; x.beginPath(); x.arc(0, 0, 47, deg(a0), deg(a1)); x.stroke();
  }
  x.strokeStyle = '#26222e';
  for (let i = 0; i <= 16; i++) {
    const a = deg(135 + i * (270 / 16)), big = i % 2 === 0;
    x.lineWidth = big ? 3 : 1.5;
    x.beginPath(); x.moveTo(Math.cos(a) * (big ? 38 : 42), Math.sin(a) * (big ? 38 : 42)); x.lineTo(Math.cos(a) * 52, Math.sin(a) * 52); x.stroke();
  }
  x.fillStyle = '#26222e'; x.font = `bold 13px ${F}`; x.textAlign = 'center'; x.textBaseline = 'middle';
  for (let i = 0; i <= 8; i += 2) { const a = deg(135 + i * (270 / 8)); x.fillText(String(i), Math.cos(a) * 28, Math.sin(a) * 28); }
  x.fillStyle = '#e0302a'; x.font = `bold 12px ${F}`; x.fillText('OUPS', 0, 40);
  x.restore();

  // --- B : autocollant « BRÛLANT » (v2) : fond noir, liseré de danger, flamme
  x.save();
  rrect(130, 2, 124, 124, 14); x.clip();
  stripes(130, 2, 124, 124, '#ff8a1a');
  x.fillStyle = '#1d1a22'; rrect(140, 12, 104, 104, 9); x.fill();
  const flame = (s, col) => {
    x.fillStyle = col; x.beginPath();
    x.moveTo(192, 92 - 0 * s);
    x.bezierCurveTo(192 - 34 * s, 92, 192 - 30 * s, 60 - 6 * s, 192 - 10 * s, 26 + 24 * (1 - s));
    x.bezierCurveTo(192 - 8 * s, 48, 192 + 2 * s, 50, 192 + 6 * s, 38 + 20 * (1 - s));
    x.bezierCurveTo(192 + 30 * s, 56, 192 + 34 * s, 92, 192, 92);
    x.fill();
  };
  flame(1, '#ff5a1a'); flame(0.7, '#ffb21a'); flame(0.4, '#fff2c8');
  x.fillStyle = '#ffffff'; x.font = `bold 17px ${F}`; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('BRÛLANT', 192, 104, 98);
  x.restore();

  // --- C : plaque de la Riveteuse (crème, bande de danger, nom, mise en garde)
  x.save();
  rrect(4, 132, 248, 120, 14); x.clip();
  x.fillStyle = '#f2ead4'; x.fillRect(4, 132, 248, 120);
  stripes(4, 132, 248, 24);
  x.fillStyle = '#26222e'; x.font = `bold 34px ${F}`; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('RIVETEUSE', 128, 180, 228);
  x.font = `bold 12px ${F}`; x.fillStyle = '#5a5262';
  x.fillText('MOD. R-8 · 8,5 RIVETS/S · ATELIER KOBI', 128, 206, 228);
  x.fillStyle = '#d8302a'; x.font = `bold 16px ${F}`;
  x.fillText('NE PAS RIVETER SES DOIGTS', 128, 232, 230);
  x.restore();
  x.strokeStyle = '#26222e'; x.lineWidth = 3; rrect(5.5, 133.5, 245, 117, 13); x.stroke();

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.userData.shared = true;
  DECAL = t;
  return t;
}

// ------------------------------------------------------------------ matériaux (au plus 8)
function mats(v2) {
  const p = paintTex();
  return {
    body: mat(v2 ? '#ff7b2a' : '#ffd23a', { map: p.map, normalMap: p.normalMap, normalScale: 0.5, rough: 0.36, metal: 0.35, coat: 0.8, coatRough: 0.08 }),
    // teintes neutres choisies pour la Méga : l'acier passe à l'or, le sombre et le caoutchouc restent tels quels
    steel: mat('#cdd0d6', { rough: 0.26, metal: 0.9 }),
    dark: mat('#2b2a30', { rough: 0.42, metal: 0.65 }),
    rubber: mat('#1e1c22', { rough: 0.85 }),
    // laiton : blanc teinté par le fond de la planche d'autocollants (la Méga le dore au lieu de l'assombrir)
    brass: mat('#ffffff', { map: decalTex(), rough: 0.28, metal: 0.92, coat: 0.3 }),
    decal: mat('#ffffff', { map: decalTex(), rough: 0.45, coat: 0.5 }),
    hot: glow(v2 ? '#ff9a3a' : '#ffe27a', v2 ? 2.4 : 2),
    ...(v2 ? { white: glow('#fff0c8', 3) } : {}),
  };
}

// ------------------------------------------------------------------ aides géométriques
const P = (geo, p, r, s) => [geo, mtx(p, r, s)];
// même chose dans un repère parent (poignée)
const PM = (M, geo, p, r, s) => [geo, M.clone().multiply(mtx(p, r, s))];
const cyl = (rt, rb, h, s = 16, open = false) => new THREE.CylinderGeometry(rt, rb, h, s, 1, open);
const rbox = (w, h, d, r, seg = 1) => new RoundedBoxGeometry(w, h, d, seg, r);
// tête de rivet bombée tournée vers +Y
const rivet = () => new THREE.SphereGeometry(1, 6, 2, 0, TAU, 0, HP).scale(1, 0.55, 1);
// plan aux UV ramenés dans une zone de la planche d'autocollants
function decalPlane(w, h, [u0, v0, u1, v1]) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return g;
}
// hélice (ressort, résistance) d'axe Z
class Helix extends THREE.Curve {
  constructor(r, z0, z1, turns, cx = 0, cy = 0) { super(); Object.assign(this, { r, z0, z1, turns, cx, cy }); }
  getPoint(t, out = new THREE.Vector3()) {
    const a = t * this.turns * TAU;
    return out.set(this.cx + Math.cos(a) * this.r, this.cy + Math.sin(a) * this.r, this.z0 + (this.z1 - this.z0) * t);
  }
}
// barillet cannelé d'axe Y (n cannelures creusées)
function fluted(r, len, n = 6, depth = 0.2) {
  const g = new THREE.CylinderGeometry(r, r, len, n * 6, 1, true);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const k = 1 - depth * Math.pow(Math.max(0, Math.cos(Math.atan2(z, x) * n)), 3);
    p.setXYZ(i, x * k, p.getY(i), z * k);
  }
  g.computeVertexNormals();
  return g;
}
// carter : profil de côté (z, y) extrudé en épaisseur (x), biseauté ; UV resserrés pour la peinture
function housing(v2) {
  const s = new THREE.Shape();
  if (!v2) {
    s.moveTo(-0.07, -0.035);
    s.lineTo(0.2, -0.035);
    s.quadraticCurveTo(0.235, -0.035, 0.235, 0.0);
    s.lineTo(0.235, 0.072);
    s.quadraticCurveTo(0.235, 0.094, 0.212, 0.097);
    s.lineTo(0.1, 0.106);
    s.lineTo(-0.06, 0.106);
    s.quadraticCurveTo(-0.1, 0.106, -0.1, 0.07);
    s.lineTo(-0.1, 0.01);
    s.quadraticCurveTo(-0.1, -0.035, -0.07, -0.035);
  } else {
    // plus anguleux : nez en coin, dos qui monte vers l'arrière en aileron
    s.moveTo(-0.07, -0.04);
    s.lineTo(0.17, -0.04);
    s.lineTo(0.245, -0.012);
    s.lineTo(0.245, 0.07);
    s.lineTo(0.205, 0.098);
    s.lineTo(0.04, 0.11);
    s.lineTo(-0.075, 0.13);
    s.quadraticCurveTo(-0.112, 0.134, -0.112, 0.09);
    s.lineTo(-0.112, 0.01);
    s.quadraticCurveTo(-0.112, -0.04, -0.07, -0.04);
  }
  const depth = v2 ? 0.1 : 0.088, bt = 0.013;
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bt, bevelSize: 0.012, bevelSegments: 2, curveSegments: 5 });
  g.rotateY(-HP);
  g.translate(depth / 2, 0, 0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.6, uv.getY(i) * 2.6);
  return { geo: g, half: depth / 2 + bt };
}

// ------------------------------------------------------------------ assemblage (géométries fusionnées par matériau)
const CACHE = new Map();
function geometries(v2) {
  const key = v2 ? 'v2' : 'base';
  if (CACHE.has(key)) return CACHE.get(key);
  const L = { body: [], steel: [], dark: [], rubber: [], brass: [], decal: [], hot: [], white: [] };
  const RIV = rivet();
  const { geo: hous, half: HX } = housing(v2);
  L.body.push([hous, null]);
  const topY = 0.118; // dessus du carter (biseau compris)

  // --- flancs : joint de panneau, rivets, ouïes
  for (const sx of [-1, 1]) {
    const fx = sx * HX;
    L.dark.push(P(cyl(0.003, 0.003, 0.29, 4), [fx, 0.07, 0.07], [HP, 0, 0]));
    for (let i = 0; i < 6; i++) {
      const z = -0.075 + i * 0.056;
      L.steel.push(P(RIV, [fx, 0.086, z], [0, 0, -sx * HP], [0.007, 0.007, 0.007]));
      if (i > 0 && i < 5) L.steel.push(P(RIV, [fx, -0.024, z], [0, 0, -sx * HP], [0.006, 0.006, 0.006]));
    }
    for (let i = 0; i < 3; i++) L.dark.push(P(new THREE.BoxGeometry(0.006, 0.011, 0.065), [fx, 0.008 + i * 0.02, 0.185]));
  }

  // --- plaque ou autocollant « BRÛLANT » (v2), sur le flanc droit (+x), celui que voit le joueur
  if (!v2) L.decal.push(P(decalPlane(0.13, 0.063, [0.0, 0.0, 1.0, 0.5]), [HX + 0.0015, 0.03, 0.035], [0, HP, 0]));
  else L.decal.push(P(decalPlane(0.066, 0.066, [0.5, 0.5, 1.0, 1.0]), [HX + 0.0015, 0.035, 0.03], [0, HP, 0]));

  // --- poignée caoutchouc (repère incliné), stries, embout d'air
  const GM = mtx([0, -0.08, -0.02], [-0.3, 0, 0]);
  L.rubber.push(PM(GM, rbox(0.072, 0.15, 0.08, 0.026, 2), [0, 0, 0]));
  for (let i = 0; i < 3; i++) L.rubber.push(PM(GM, new THREE.CapsuleGeometry(0.012, 0.046, 1, 6), [0, 0.035 - i * 0.04, 0.038], [0, 0, HP]));
  for (const sx of [-1, 1]) {
    L.dark.push(PM(GM, new THREE.BoxGeometry(0.006, 0.09, 0.05), [sx * 0.035, -0.005, -0.004]));
    L.brass.push(PM(GM, cyl(0.007, 0.007, 0.006, 8), [sx * 0.039, -0.005, -0.004], [0, 0, HP]));
  }
  L.body.push(PM(GM, rbox(0.086, 0.028, 0.094, 0.012, 2), [0, -0.085, 0]));
  L.brass.push(PM(GM, cyl(0.011, 0.011, 0.026, 10), [0, -0.11, -0.005]));
  L.dark.push(PM(GM, cyl(0.016, 0.016, 0.01, 6), [0, -0.1, -0.005]));
  L.dark.push(PM(GM, cyl(0.013, 0.013, 0.005, 10), [0, -0.123, -0.005]));

  // --- pontet et détente
  L.steel.push(P(new THREE.TorusGeometry(0.036, 0.0065, 5, 12, Math.PI), [0, -0.044, 0.058], [0, HP, Math.PI]));
  L.dark.push(P(new THREE.BoxGeometry(0.014, 0.045, 0.013), [0, -0.058, 0.04], [0.35, 0, 0]));

  // --- manomètre au cul du carter (cadran tourné vers -Z, aiguille au vert ; dans le rouge en v2)
  const rearZ = v2 ? -0.125 : -0.113, gy = 0.052;
  const GG = mtx([0, gy, rearZ - 0.006], [0, Math.PI, 0]);
  L.steel.push(PM(GG, cyl(0.035, 0.037, 0.022, 14), [0, 0, -0.008], [HP, 0, 0]));
  L.steel.push(PM(GG, new THREE.TorusGeometry(0.031, 0.006, 5, 16), [0, 0, 0.004]));
  L.decal.push(PM(GG, (() => { const g = new THREE.CircleGeometry(0.031, 20); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5, 0.5 + uv.getY(i) * 0.5); return g; })(), [0, 0, 0.003]));
  const na = v2 ? 1.95 : -0.45;
  L.dark.push(PM(GG, new THREE.BoxGeometry(0.0035, 0.025, 0.002), [Math.sin(na) * 0.01, Math.cos(na) * 0.01, 0.006], [0, 0, -na]));
  L.dark.push(PM(GG, cyl(0.004, 0.004, 0.004, 8), [0, 0, 0.007], [HP, 0, 0]));

  // --- barillet de rivets sur le dos (axe Z) : cannelures, rivets en laiton (chauffés à blanc en v2) à l'arrière
  const DY = 0.178, DZ = 0.02, DR = 0.062, DL = 0.11;
  const drumMat = v2 ? L.dark : L.steel;
  drumMat.push(P(fluted(DR, DL, 6, 0.18), [0, DY, DZ], [HP, 0, 0]));
  for (const z of [DZ - DL / 2, DZ + DL / 2]) {
    L.dark.push(P(new THREE.TorusGeometry(DR - 0.002, 0.006, 4, 20), [0, DY, z]));
    L.steel.push(P(new THREE.CircleGeometry(DR - 0.003, 18), [0, DY, z], [0, z < DZ ? Math.PI : 0, 0]));
  }
  const rearD = DZ - DL / 2;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU, rx = Math.cos(a) * 0.038, ry = DY + Math.sin(a) * 0.038;
    L.dark.push(P(new THREE.TorusGeometry(0.0175, 0.004, 3, 10), [rx, ry, rearD - 0.001]));
    (v2 ? L.white : L.brass).push(P(RIV, [rx, ry, rearD - 0.001], [-HP, 0, 0], [0.015, 0.015, 0.015]));
    if (v2) L.hot.push(P(new THREE.BoxGeometry(0.006, 0.006, DL * 0.8), [Math.cos(a + Math.PI / 6) * DR * 0.84, DY + Math.sin(a + Math.PI / 6) * DR * 0.84, DZ], [0, 0, a + Math.PI / 6]));
  }
  L.dark.push(P(cyl(0.012, 0.012, DL + 0.05, 6), [0, DY, DZ], [HP, 0, 0]));
  L.brass.push(P(cyl(0.016, 0.016, 0.008, 6), [0, DY, rearD - 0.024], [HP, 0, 0]));
  // étriers : avant plein, arrière en lame étroite (laisse voir les rivets)
  L.dark.push(P(rbox(0.05, 0.08, 0.016, 0.006), [0, topY + 0.03, DZ + DL / 2 + 0.012]));
  L.dark.push(P(new THREE.BoxGeometry(0.018, 0.075, 0.012), [0, topY + 0.026, rearD - 0.018]));

  // --- voyant de pression sur le dos
  L.dark.push(P(cyl(0.013, 0.013, 0.008, 10), [0.03, topY - 0.002, -0.085]));
  L.hot.push(P(new THREE.SphereGeometry(0.0085, 8, 5), [0.03, topY + 0.003, -0.085]));

  // --- durite d'air : du cul du carter au flanc de l'étrier avant, raccords en laiton
  const hoseC = new THREE.CatmullRomCurve3([[0.045, 0.085, rearZ + 0.004], [0.075, 0.075, rearZ - 0.03], [0.095, 0.13, rearZ - 0.012], [0.085, 0.165, -0.02], [0.05, 0.168, DZ + DL / 2 + 0.012]].map((p) => new THREE.Vector3(...p)));
  L.rubber.push([new THREE.TubeGeometry(hoseC, 28, 0.011, 5), null]);
  L.brass.push(P(cyl(0.015, 0.015, 0.02, 8), [0.045, 0.085, rearZ - 0.002], [HP, 0, 0]));
  L.brass.push(P(cyl(0.014, 0.014, 0.018, 8), [0.032, 0.168, DZ + DL / 2 + 0.012], [0, 0, HP]));

  // --- nez : collet hexagonal, canon(s), ressort ou résistances, bouterolle et anneau lumineux
  const barrels = v2 ? [-0.042, 0.042] : [0];
  const zF = v2 ? 0.255 : 0.245;
  L.dark.push(P(cyl(v2 ? 0.068 : 0.052, v2 ? 0.068 : 0.052, 0.04, 6), [0, BY, zF + 0.012], [HP, Math.PI / 6, 0], v2 ? [1, 1, 0.82] : 1));
  const tipLathe = (s) => new THREE.LatheGeometry([[0.022, 0], [0.031, 0.006], [0.031, 0.045], [0.04, 0.07], [0.044, 0.088], [0.039, 0.094], [0.027, 0.087], [0.017, 0.076]].map(([r, y]) => new THREE.Vector2(r * s, y)), v2 ? 12 : 16);
  for (const bx of barrels) {
    const s = v2 ? 0.78 : 1;
    L.steel.push(P(cyl(0.024 * s, 0.024 * s, 0.22, 14), [bx, BY, 0.375], [HP, 0, 0]));
    (v2 ? L.dark : L.steel).push(P(tipLathe(s), [bx, BY, 0.46], [HP, 0, 0]));
    L.dark.push(P(cyl(0.034 * s, 0.034 * s, 0.012, 12), [bx, BY, 0.488], [HP, 0, 0]));
    L.dark.push(P(new THREE.CircleGeometry(0.02 * s, 12), [bx, BY, 0.54]));
    (v2 ? L.white : L.hot).push(P(new THREE.TorusGeometry(0.027 * s, 0.0055, 5, 14), [bx, BY, 0.548]));
    if (!v2) {
      L.steel.push([new THREE.TubeGeometry(new Helix(0.033, 0.3, 0.435, 6.5, bx, BY), 56, 0.0052, 4), null]);
      for (const z of [0.293, 0.442]) L.dark.push(P(cyl(0.041, 0.041, 0.014, 14), [bx, BY, z], [HP, 0, 0]));
    } else {
      L.hot.push([new THREE.TubeGeometry(new Helix(0.026, 0.29, 0.39, 5, bx, BY), 40, 0.0048, 4), null]);
      L.dark.push(P(cyl(0.032, 0.032, 0.012, 14), [bx, BY, 0.284], [HP, 0, 0]));
    }
  }
  if (!v2) {
    // vérin pneumatique sous le canon, rail et guidon sur le dessus
    L.brass.push(P(cyl(0.014, 0.014, 0.15, 12), [0, BY - 0.058, 0.325], [HP, 0, 0]));
    L.dark.push(P(cyl(0.017, 0.017, 0.018, 12), [0, BY - 0.058, 0.405], [HP, 0, 0]));
    L.dark.push(P(rbox(0.016, 0.06, 0.018, 0.006), [0, BY - 0.03, 0.442]));
    L.steel.push(P(rbox(0.05, 0.012, 0.1, 0.004), [0, topY - 0.004, 0.165], [0.07, 0, 0]));
    for (const z of [0.13, 0.2]) L.dark.push(P(cyl(0.005, 0.005, 0.004, 6), [0, topY + 0.002 - (z - 0.165) * 0.07, z]));
    L.dark.push(P(new THREE.BoxGeometry(0.008, 0.026, 0.02), [0, topY + 0.008, 0.222]));
  } else {
    // carénage ajouré entre les canons, ouïes incandescentes ; radiateur dorsal ; cheminées ; éperons de ricochet
    L.dark.push(P(rbox(0.142, 0.064, 0.085, 0.02), [0, BY, 0.43]));
    for (let i = 0; i < 3; i++) L.hot.push(P(new THREE.BoxGeometry(0.1, 0.004, 0.012), [0, BY + 0.0325, 0.405 + i * 0.022]));
    L.dark.push(P(rbox(0.15, 0.018, 0.08, 0.006), [0, BY - 0.043, 0.47], [-0.15, 0, 0]));
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) L.hot.push(P(new THREE.BoxGeometry(0.004, 0.034, 0.012), [sx * 0.0715, BY, 0.405 + i * 0.022]));
    for (let i = 0; i < 5; i++) L.steel.push(P(new THREE.BoxGeometry(0.09, 0.05 - i * 0.006, 0.005), [0, 0.112 + (0.05 - i * 0.006) / 2 - 0.004, 0.105 + i * 0.026], [-0.25, 0, 0]));
    for (const sx of [-1, 1]) {
      const CM = mtx([sx * 0.046, 0.13, -0.09], [-0.55, 0, sx * -0.25]);
      L.steel.push(PM(CM, cyl(0.017, 0.014, 0.08, 12, true), [0, 0, 0]));
      L.dark.push(PM(CM, new THREE.TorusGeometry(0.017, 0.004, 4, 12), [0, 0.04, 0], [HP, 0, 0]));
      L.hot.push(PM(CM, new THREE.CircleGeometry(0.014, 10), [0, 0.03, 0], [-HP, 0, 0]));
      L.steel.push(P(new THREE.ConeGeometry(0.015, 0.085, 6), [sx * 0.056, BY - 0.045, 0.535], [HP, 0, 0]));
    }
  }

  const out = {};
  for (const [k, list] of Object.entries(L)) {
    if (!list.length) continue;
    const g = bake(list);
    if (k === 'brass') { const uv = g.attributes.uv.array; for (let i = 0; i < uv.length; i += 2) { uv[i] = 0.012; uv[i + 1] = 0.988; } }
    g.computeBoundingSphere();
    g.userData.shared = true;
    out[k] = g;
  }
  CACHE.set(key, out);
  return out;
}

export function riveteuse(v2) {
  const M = mats(v2);
  const parts = geometries(v2);
  const g = new THREE.Group();
  for (const [k, geo] of Object.entries(parts)) {
    const m = new THREE.Mesh(geo, M[k]);
    m.castShadow = true;
    g.add(m);
  }
  g.userData.muzzles = (v2 ? [-0.042, 0.042] : [0]).map((x) => new THREE.Vector3(x, BY, 0.56));
  return g;
}
