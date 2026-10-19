// Luminbois, la jungle bioluminescente : arbres géants, champignons-tremplins, fougères, fleurs lumineuses,
// lianes, ruines, eau.
import * as THREE from 'three';
import { G, mtx, mergeGeometries } from '../geo.js';
import { mat, glow, terrainMaterial, globalU } from '../../engine/materials.js';
import { createWater } from '../../engine/water/water.js';
import { rockTexture, mossTexture, barkTexture } from '../../engine/textures.js';
import { BoxCollider, CylinderCollider } from '../../engine/physics.js';
import { lights } from '../../engine/lightpool.js';
import { foliage } from '../../engine/shading.js';
import { LAYERS, QUALITY, frameU } from '../../engine/frame.js';
import { rng as mkRng } from '../../engine/util.js';
import { fxUniforms, FX_PARS, FX_VERT, FX_FRAG } from '../../engine/particles/shared.js';
import { noiseTexture } from '../../engine/sky.js';

let M = null;
function mats() {
  if (M) return M;
  const moss = mossTexture(), bark = barkTexture(), jRock = rockTexture('jungle');
  M = {
    moss: mat('#ffffff', { map: moss.map, normalMap: moss.normalMap, rough: 0.9, normalScale: 0.7 }),
    bark: mat('#ffffff', { map: bark.map, normalMap: bark.normalMap, rough: 0.85 }),
    jRock: terrainMaterial({ mapA: moss.map, mapB: jRock.map, normalA: moss.normalMap, normalB: jRock.normalMap, scaleA: 0.2, scaleB: 0.14, slopeLo: 0.6, slopeHi: 0.8 }),
    // feuillages translucides (contre-jour)
    leaf: foliage(mat('#1f6a5a', { rough: 0.7, sheen: 0.6, sheenColor: '#7affd0', unique: true })),
    leafL: foliage(mat('#2f8a6a', { rough: 0.7, sheen: 0.6, sheenColor: '#a0ffe0', unique: true })),
    leafUnder: foliage(mat('#163a3a', { rough: 0.8, unique: true }), 0.8),
    stem: mat('#e8e0d0', { rough: 0.7, sheen: 0.4 }),
    fruitGlow: glow('#ffd23a', 2.2),
    sporeGlow: glow('#7affc8', 2.4),
    flowerGlow: glow('#ff6ad8', 2.4),
    stone: mat('#6a7a70', { rough: 0.9 }),
  };
  for (const k of Object.keys(M)) M[k].userData.shared = true;
  return M;
}
export function jungleMats() { return mats(); }

let seedState = 1;
const R = () => { seedState = (seedState * 16807) % 2147483647; return (seedState - 1) / 2147483646; };
const seed = (s) => { seedState = Math.max(1, Math.floor(s * 7919) % 2147483646); };

// Sol sous les pieds : terrain du niveau en (x, z) (sinon y). Un objet est « posé sur le terrain » quand son pied est
// à moins de 0,6 m du sol (sinon il est posé sur une construction : pilier, plateforme). groundMin : point le plus bas
// du terrain sous un disque de rayon r (centre + 8 points du bord) — on y enfonce les pieds en pente.
const groundAt = (L, x, z, y) => (L.heightfield && L.heightfield.inside(x, z) ? L.heightfield.height(x, z) : y);
const onGround = (L, p) => !!L.heightfield && L.heightfield.inside(p.x, p.z) && Math.abs(p.y - L.heightfield.height(p.x, p.z)) < 0.6;
function groundMin(L, x, z, r, y) {
  let mn = groundAt(L, x, z, y);
  for (let k = 0; k < 8; k++) mn = Math.min(mn, groundAt(L, x + Math.cos(k * 0.785) * r, z + Math.sin(k * 0.785) * r, y));
  return mn;
}
const _up = new THREE.Vector3(0, 1, 0);

// Arbre géant : tronc évasé à contreforts, canopée en boules, fruits luminescents
export function jungleTree(L, pos, scale = 1, s = 1) {
  const m = mats();
  seed(s);
  const h = (9 + R() * 5) * scale, r = 0.9 * scale;
  const prof = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; prof.push(new THREE.Vector2(r * (1 + Math.pow(1 - t, 4) * 1.4) * (0.85 + 0.15 * Math.sin(t * 9)), t * h)); }
  // pied évasé enfoncé de 0,3 m, davantage en pente (jusqu'au point le plus bas du terrain sous l'évasement)
  const ground = onGround(L, pos);
  const sink = ground ? Math.max(0.3, pos.y - groundMin(L, pos.x, pos.z, prof[0].x, pos.y) + 0.15) : 0.3;
  if (sink > 0.3) prof.unshift(new THREE.Vector2(prof[0].x, 0.3 - sink));
  L.add(new THREE.LatheGeometry(prof, 12), m.bark, mtx([pos.x, pos.y - 0.3, pos.z], [0, R() * 6, 0]));
  // contreforts (pointe inchangée ; en pente, la base descend jusqu'au terrain)
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * 6.28 + R();
    const bx = pos.x + Math.cos(a) * r * 1.4, bz = pos.z + Math.sin(a) * r * 1.4;
    const ext = ground ? Math.max(0, pos.y - 0.4 * scale - (groundMin(L, bx, bz, 1.2 * scale, pos.y) - 0.1)) : 0;
    L.add(G.cone(0.9 * scale, 2.4 * scale, 4), m.bark, mtx([bx, pos.y + 0.8 * scale - ext / 2, bz], [0, -a, 0], [0.35, 1 + ext / (2.4 * scale), 1.4]));
  }
  // canopée ; les fruits pendent au bout d'un pédoncule accroché au dessous du feuillage
  const top = pos.y + h;
  for (let k = 0; k < 6; k++) {
    const a = R() * 6.28, d = (k === 0 ? 0 : 2.2 + R() * 1.8) * scale;
    const rr = (2.6 + R() * 1.4) * scale;
    const cx = pos.x + Math.cos(a) * d, cz = pos.z + Math.sin(a) * d, cy = top + (R() - 0.3) * 1.5 * scale;
    L.add(G.ellipsoid(rr, rr * 0.55, rr, 14, 10), k % 2 ? m.leaf : m.leafL, mtx([cx, cy, cz], [0, R() * 6, 0]));
    L.add(G.ellipsoid(rr * 0.9, rr * 0.2, rr * 0.9, 12, 6), m.leafUnder, mtx([cx, cy - rr * 0.38, cz]));
    for (let f = 0; f < 3; f++) {
      const fa = R() * 6.28, fd = rr * (0.4 + R() * 0.5);
      const fm = R() < 0.5 ? m.fruitGlow : m.sporeGlow, fy = cy - rr * 0.45 - R() * 0.8;
      const fx = cx + Math.cos(fa) * fd, fz = cz + Math.sin(fa) * fd, fr = 0.18 * scale;
      L.add(G.sphere(fr, 8, 6), fm, mtx([fx, fy, fz]));
      // jusque dans la boule de feuillage au-dessus du fruit (en traversant la sous-face aplatie) ; marge pour les
      // facettes, plus grande vers le bord où la surface est raide
      const sy = cy - rr * 0.55 * Math.sqrt(Math.max(0, 1 - (fd / rr) ** 2));
      const y0 = fy + fr * 0.6, y1 = sy + 0.12 * scale + 0.15 * rr * (fd / rr) ** 2;
      if (y1 > fy + fr) L.add(G.cyl(0.022, 0.03, 1, 4), m.leafUnder, mtx([fx, (y0 + y1) / 2, fz], [0, 0, 0], [scale, y1 - y0, scale]));
    }
  }
  L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y - 1, pos.y + h, r * 1.15, { surface: 'wood' }));
}

// Champignon géant : pied crème, chapeau coloré à pois luminescents ; bounce = tremplin naturel
export function giantMushroom(L, pos, scale = 1, color = '#c86aff', o = {}) {
  const m = mats();
  const h = (o.h ?? 3.2) * scale, cr = 2.2 * scale;
  const stemP = [];
  for (let i = 0; i <= 6; i++) { const t = i / 6; stemP.push(new THREE.Vector2(0.45 * scale * (1.3 - t * 0.4 + Math.sin(t * 3) * 0.1), t * h)); }
  // pied enfoncé : dans le support (0,15 m), ou jusque sous le point le plus bas du terrain autour du pied
  const sink = onGround(L, pos) ? Math.max(0.15 * scale, pos.y - groundMin(L, pos.x, pos.z, stemP[0].x, pos.y) + 0.12) : 0.15 * scale;
  stemP.unshift(new THREE.Vector2(stemP[0].x, -sink));
  L.add(new THREE.LatheGeometry(stemP, 12), m.stem, mtx([pos.x, pos.y, pos.z]));
  const capM = mat(color, { rough: 0.45, sheen: 0.8, sheenColor: '#ffffff', emissive: color, emissiveIntensity: 0.18 });
  capM.userData.shared = true;
  L.add(new THREE.SphereGeometry(cr, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1), capM, mtx([pos.x, pos.y + h - 0.15, pos.z]));
  L.add(new THREE.CircleGeometry(cr, 20).rotateX(Math.PI / 2), m.leafUnder, mtx([pos.x, pos.y + h - 0.14, pos.z]));
  // lueur colorée sous le chapeau (o.light : facteur d'intensité)
  lights.add({ pos: new THREE.Vector3(pos.x, pos.y + h - 0.6 * scale, pos.z), color, intensity: 32 * scale * (o.light ?? 1), range: 9 * scale, priority: 1.2 });
  seed(Math.floor(pos.x * 13 + pos.z * 7));
  for (let k = 0; k < 9; k++) {
    const a = R() * 6.28, d = R() * cr * 0.8;
    const yy = Math.sqrt(Math.max(0, 1 - (d / cr) ** 2)) * cr * 0.55;
    L.add(G.sphere(0.16 * scale + R() * 0.1, 8, 6), m.sporeGlow, mtx([pos.x + Math.cos(a) * d, pos.y + h - 0.15 + yy, pos.z + Math.sin(a) * d]));
  }
  L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y, pos.y + h - 0.6, 0.5 * scale, { surface: 'wood' }));
  L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y + h - 0.6, pos.y + h + cr * 0.4, cr * 0.92, { surface: 'grass', bounce: o.bounce || 0 }));
}

// Fougère
export function fern(L, pos, scale = 1, s = 1) {
  const m = mats();
  seed(s);
  const n = 6 + Math.floor(R() * 4);
  const q = new THREE.Quaternion(), qp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.5), c = new THREE.Vector3(), d = new THREE.Vector3();
  for (let k = 0; k < n; k++) {
    const a = (k / n) * 6.28 + R() * 0.4;
    const len = (0.9 + R() * 0.6) * scale;
    // fronde qui monte vers l'extérieur (cap, puis inclinaison de 0,5 rad dans son propre plan) : le bout intérieur
    // plonge dans le sol au pied de la touffe, enfoncé d'au moins 4 cm même en pente
    q.setFromAxisAngle(_up, -a + Math.PI / 2).multiply(qp);
    d.set(0, 0, 1).applyQuaternion(q);
    c.set(pos.x + Math.cos(a) * len * 0.6, pos.y + 0.35 * scale, pos.z + Math.sin(a) * len * 0.6);
    const ix = c.x - d.x * len, iz = c.z - d.z * len, iy = c.y - d.y * len;
    c.y -= Math.max(0, iy - (groundAt(L, ix, iz, pos.y) - 0.04));
    L.add(G.ellipsoid(0.16 * scale, 0.03 * scale, len, 8, 4), k % 2 ? m.leaf : m.leafL, new THREE.Matrix4().compose(c, q, new THREE.Vector3(1, 1, 1)));
  }
}

// Fleur luminescente : tige un peu penchée depuis son pied (enfoncé de 5 cm), bouton et sépales au bout de la tige
export function glowFlower(L, pos, scale = 1, color = 'pink') {
  const m = mats();
  const h = 0.9 * scale;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.15, 0, 0.1));
  const u = _up.clone().applyQuaternion(q);
  const by = (onGround(L, pos) ? Math.min(pos.y, groundMin(L, pos.x, pos.z, 0.05 * scale, pos.y)) : pos.y) - 0.05 * scale;
  const len = pos.y + h - by;
  const at = (t) => new THREE.Vector3(pos.x, by, pos.z).addScaledVector(u, t);
  L.add(G.cyl(0.03 * scale, 0.04 * scale, h, 5), m.leafL, new THREE.Matrix4().compose(at(len / 2), q, new THREE.Vector3(1, len / h, 1)));
  const bulb = at(len + 0.05);
  L.add(G.sphere(0.16 * scale, 8, 6), color === 'pink' ? m.flowerGlow : color === 'gold' ? m.fruitGlow : m.sporeGlow, mtx([bulb.x, bulb.y, bulb.z]));
  lights.add({ pos: bulb.clone(), color: color === 'pink' ? '#ff6ad8' : color === 'gold' ? '#ffc23a' : '#7affc8', intensity: 6 * scale, range: 4.5 * scale, priority: 0.6 });
  const sp = at(len - h * 0.05);
  for (let k = 0; k < 4; k++) L.add(G.ellipsoid(0.16 * scale, 0.03 * scale, 0.08 * scale, 6, 4), m.leaf, mtx([sp.x, sp.y, sp.z], [0.6, (k / 4) * 6.28, 0]));
}

// Rideau de lianes qui pendent d'un support (bord de plateforme, linteau, branche) : le haut de chaque liane entre
// dans le support. o : { dz: [min, max] (écart en z de chaque liane, déf. ±0,2), up (longueur enfoncée au-dessus de
// pos.y), top(x) → [y, z] (accroche propre à chaque liane, sous une branche penchée) }. Feuilles et grain lumineux
// sont sur leur liane.
export function vines(L, pos, w = 3, h = 5, s = 1, o = {}) {
  const m = mats();
  seed(s);
  const n = Math.floor(w * 3);
  const [z0, z1] = o.dz || [-0.2, 0.2], up = o.up || 0;
  for (let k = 0; k < n; k++) {
    const x = pos.x + (k / n - 0.5) * w + (R() - 0.5) * 0.3;
    const hh = h * (0.5 + R() * 0.5);
    let z = pos.z + z0 + R() * (z1 - z0), y = pos.y;
    if (o.top) [y, z] = o.top(x, z);
    L.add(G.cyl(0.03, 0.03, 1, 4), m.leafL, mtx([x, y + (up - hh) / 2, z], [0, 0, 0], [1, hh + up, 1]));
    for (let f = 0; f < 4; f++) L.add(G.ellipsoid(0.1, 0.02, 0.06, 6, 3), m.leaf, mtx([x, y - R() * hh, z], [R(), R() * 6, 0]));
    if (R() < 0.3) L.add(G.sphere(0.08, 6, 4), m.sporeGlow, mtx([x, y - hh, z]));
  }
}

// Bloc de ruine moussu (plateforme)
// Bloc de ruine maçonné : assises de pierres taillées décalées (joints creux sur un noyau en retrait),
// pierres légèrement de travers ; la mousse vient du matériau (faces tournées vers le ciel)
export function ruinBlock(L, pos, size, o = {}) {
  const m = mats();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx || 0, o.ry || 0, o.rz || 0));
  const c = new THREE.Vector3(pos.x, pos.y + size.y / 2, pos.z);
  const R = mkRng(Math.floor(pos.x * 73 + pos.z * 31 + pos.y * 17) + 7);
  const parts = [];
  const gap = 0.05;
  // assise du bas prolongée sous le bloc : 4 cm dans ce qui le porte (bloc, pilier) ; posé sur le terrain, jusque
  // sous le point le plus bas du terrain sous son emprise (en pente, le bloc ne reste pas en l'air sur un coin).
  // Assise du haut au ras du dessus praticable : deux blocs empilés se touchent.
  let sink = gap / 2 + 0.04;
  if (L.heightfield && L.heightfield.inside(pos.x, pos.z) && pos.y - L.heightfield.height(pos.x, pos.z) < 1.2) {
    const v = new THREE.Vector3();
    for (let i = 0; i <= 4; i++) {
      for (let j = 0; j <= 4; j++) {
        v.set((i / 4 - 0.5) * size.x, -size.y / 2, (j / 4 - 0.5) * size.z).applyQuaternion(q).add(c);
        sink = Math.max(sink, Math.min(6, v.y - groundAt(L, v.x, v.z, v.y) + 0.1));
      }
    }
  }
  const cs = sink + 0.05;
  parts.push(boxAt(G.box(Math.max(0.1, size.x - 0.1), Math.max(0.1, size.y - 0.1) + cs, Math.max(0.1, size.z - 0.1)), 0, -cs / 2, 0));
  const alongX = size.x >= size.z;
  const L1 = alongX ? size.x : size.z, T = alongX ? size.z : size.x;
  const courses = Math.max(1, Math.round(size.y / 0.85));
  const ch = size.y / courses;
  for (let k = 0; k < courses; k++) {
    let a = -L1 / 2;
    let first = true;
    while (a < L1 / 2 - 0.05) {
      let len = (first && k % 2 ? 0.5 : 1) * (1.1 + R() * 0.9);
      if (L1 / 2 - a - len < 0.6) len = L1 / 2 - a;
      first = false;
      const mid = a + len / 2, ins = R() * 0.04;
      const y0 = -size.y / 2 + ch * k + (k === 0 ? -sink : gap / 2), y1 = -size.y / 2 + ch * (k + 1) - (k === courses - 1 ? 0 : gap / 2);
      const bw = len - gap, bh = y1 - y0, bt = T - ins * 2;
      const geo = G.rbox(alongX ? bw : bt, bh, alongX ? bt : bw, Math.min(0.07, (ch - gap) * 0.2, bw * 0.2), 1).clone();
      geo.rotateY((R() - 0.5) * 0.03).rotateX((R() - 0.5) * 0.02);
      geo.translate(alongX ? mid : (R() - 0.5) * 0.02, (y0 + y1) / 2, alongX ? (R() - 0.5) * 0.02 : mid);
      parts.push(geo);
      a += len;
    }
  }
  const g = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  L.add(g, m.jRock, new THREE.Matrix4().compose(c, q, new THREE.Vector3(1, 1, 1)));
  if (o.glyph) {
    L.add(G.torus(Math.min(size.x, size.y) * 0.25, 0.05, 6, 20), m.sporeGlow, new THREE.Matrix4().compose(new THREE.Vector3(0, 0, size.z / 2 - 0.005).applyQuaternion(q).add(c), q, new THREE.Vector3(1, 1, 1)));
    lights.add({ pos: new THREE.Vector3(0, 0, size.z / 2 + 0.6).applyQuaternion(q).add(c), color: '#7affc8', intensity: 6, range: 5, priority: 0.5 });
  }
  if (o.collide !== false) L.game.world.add(new BoxCollider(c, size.clone().multiplyScalar(0.5), q, { surface: 'rock', tag: o.tag }));
}
const boxAt = (geo, x, y, z) => geo.toNonIndexed().translate(x, y, z);

// Eau (rivière, bassin) : système d'eau du moteur — réfraction, reflets, courant contourné par les obstacles,
// écume, ondes, caustiques. o : options de createWater (preset, flow, obstacles, glowAmount…). Renvoie la surface
// (body.mesh.userData.water = plan d'eau).
export function water(L, x0, z0, w, d, y, o = {}) {
  return createWater(L, { rect: [x0, z0, w, d], y, ...o }).mesh;
}

// ------------------------------------------------------------------ lueurs de la jungle (plancton, lucioles, brume)
const NOISE_GLSL = /* glsl */ `
float kJH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float kJN(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(kJH(i), kJH(i + vec2(1.0, 0.0)), f.x), mix(kJH(i + vec2(0.0, 1.0)), kJH(i + vec2(1.0, 1.0)), f.x), f.y);
}`;

const PLANKTON_PARS = /* glsl */ `
uniform float uPTime, uPAmt, uPScale;
uniform vec2 uPFlow, uPStreak, uPPatch;
uniform vec3 uPA, uPB, uPC;
uniform vec4 uPMix;
varying vec3 vPW;
${NOISE_GLSL}
vec3 kPlankton() {
  vec2 p = vPW.xz;
  float t = uPTime;
  vec2 q = p - uPFlow * t;
  float dist = length(cameraPosition - vPW);
  // grandes nappes qui dérivent avec le courant
  float n = kJN(q * 0.06 * uPScale) * 0.6 + kJN(q * 0.17 * uPScale + vec2(3.1, t * 0.03)) * 0.4;
  float patchK = smoothstep(uPPatch.x, uPPatch.y, n);
  // filets étirés dans le sens du courant (uPStreak : fréquences le long / en travers), ondulés, par tronçons
  vec2 fd = normalize(uPFlow + vec2(1e-4, 0.0));
  float along = dot(q, fd), across = dot(p, vec2(-fd.y, fd.x));
  float s = kJN(vec2(along * uPStreak.x, across * uPStreak.y + kJN(q * 0.08) * 1.6));
  // au loin, un filet plus fin que le pixel s'élargit mais s'atténue d'autant (même énergie, pas de nappe)
  float w = max(0.014, fwidth(s) * 1.5);
  float streak = (1.0 - smoothstep(0.0, w, abs(s - 0.5))) * (0.014 / w) * smoothstep(0.42, 0.68, kJN(q * 0.045 + 11.0));
  // points de plancton qui s'allument et s'éteignent (estompés au loin : pas de scintillement de pixels)
  vec2 gp = q * 1.4;
  vec2 gi = floor(gp);
  float gh = kJH(gi);
  float gd = length(fract(gp) - (vec2(kJH(gi + 3.1), kJH(gi + 5.7)) * 0.6 + 0.2));
  float tw = pow(0.5 + 0.5 * sin(t * (0.8 + gh * 2.5) + gh * 60.0), 3.0);
  float dots = smoothstep(0.11, 0.0, gd) * step(0.78, gh) * tw * smoothstep(45.0, 15.0, dist);
  vec3 col = mix(uPA, uPB, smoothstep(0.3, 0.7, kJN(q * 0.025 + 7.0)));
  col = mix(col, uPC, streak * 0.6);
  // la lueur grandit un peu au loin : elle y traverse plus d'eau (absorption) et la surface reflète davantage
  float far = 1.0 + smoothstep(8.0, 50.0, dist) * 1.6;
  return col * (uPMix.x + patchK * uPMix.y + streak * uPMix.z * (1.0 + patchK * 2.0) + dots * uPMix.w) * uPAmt * far;
}`;

// Lit de plancton luminescent juste sous la surface d'un plan d'eau : nappes qui dérivent avec le courant, filets
// étirés dans son sens, points qui scintillent. La surface le réfracte, l'absorbe et le reflète par-dessus : l'eau
// reste de l'eau, sa lueur vient du dessous. o : { depth (sous la surface), colors [a, b, filets], amount,
// flow (dérive, sinon le courant), streak [fréquence le long, en travers] (veines : fréquences égales),
// patch [seuils des nappes], scale (taille des nappes : 2 = deux fois plus petites), mix [fond, nappes, filets, points] }
export function planktonBed(L, body, o = {}) {
  const [x0, z0, w, d] = body.rect;
  const cols = o.colors || ['#1affc0', '#3aa8ff', '#9affe0'];
  const u = {
    uPTime: globalU.uTime, uPAmt: { value: o.amount ?? 1 }, uPFlow: { value: new THREE.Vector2(...(o.flow || body.o.flow)) },
    uPStreak: { value: new THREE.Vector2(...(o.streak || [0.05, 0.3])) }, uPPatch: { value: new THREE.Vector2(...(o.patch || [0.42, 0.9])) },
    uPMix: { value: new THREE.Vector4(...(o.mix || [0.04, 0.6, 0.35, 1.8])) }, uPScale: { value: o.scale ?? 1 },
    uPA: { value: new THREE.Color(cols[0]) }, uPB: { value: new THREE.Color(cols[1]) }, uPC: { value: new THREE.Color(cols[2]) },
  };
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  // matériau lumineux : présent dans la passe de profondeur, comme les autres sources de lumière
  m.userData.isGlow = true;
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader.replace('void main() {', 'varying vec3 vPW;\nvoid main() {')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvPW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    s.fragmentShader = s.fragmentShader.replace('void main() {', PLANKTON_PARS + '\nvoid main() {')
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( kPlankton(), 1.0 );');
  };
  m.customProgramCacheKey = () => 'plancton';
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), m);
  mesh.position.set(x0 + w / 2, body.y - (o.depth ?? 0.9), z0 + d / 2);
  mesh.name = 'plancton';
  mesh.userData.u = u;
  L.root.add(mesh);
  return { mesh, u };
}

const FLY_VERT = /* glsl */ `
${FX_PARS}
${FX_VERT}
uniform float uTime, uSize, uGlow, uWander;
uniform vec3 uMin, uBox, uColA, uColB;
attribute vec4 aSeed;
varying vec2 vC;
varying vec4 vCol;
varying float vViewZ;
void main() {
  float r = aSeed.w, t = uTime;
  vec3 p = uMin + aSeed.xyz * uBox;
  p += vec3(sin(t * 0.37 + r * 40.0) + sin(t * 0.83 + r * 9.0) * 0.5, sin(t * 0.51 + r * 17.0) * 0.5,
    cos(t * 0.43 + r * 23.0) + cos(t * 0.71 + r * 5.0) * 0.5) * uWander;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vC = position.xy;
  mv.xy += vC * uSize * (0.6 + r * 0.8);
  float bl = sin(t * (0.9 + r * 1.3) + r * 60.0);
  vec3 fcol;
  float fog = fxFog(p, fcol);
  vCol = vec4(mix(uColA, uColB, fract(r * 7.13)) * uGlow, (0.1 + pow(max(bl, 0.0), 5.0) * 1.6) * (1.0 - fog));
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FLY_FRAG = /* glsl */ `
${FX_PARS}
${FX_FRAG}
varying vec2 vC;
varying vec4 vCol;
varying float vViewZ;
void main() {
  float r2 = dot(vC, vC);
  float a = vCol.a * (exp(-r2 * 9.0) * 1.4 + exp(-r2 * 2.5) * 0.25) * fxSoft(vViewZ, 0.3) * smoothstep(0.8, 2.5, vViewZ);
  if (a < 0.003) discard;
  gl_FragColor = vec4(vCol.rgb * a, 0.0);
}`;

// Essaim de lucioles posé sur une zone (au-dessus d'une rivière, autour d'une lanterne) ; box : [x, y, z, l, h, p]
// (coin bas et taille). o : { count, colors [a, b], size, glow, wander }. Un seul appel de dessin.
export function fireflies(L, box, o = {}) {
  const n0 = o.count ?? 120;
  const seed = new Float32Array(n0 * 4).map(() => Math.random());
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(box[0] + box[3] / 2, box[1] + box[4] / 2, box[2] + box[5] / 2), Math.hypot(box[3], box[4], box[5]) / 2 + 4);
  const cols = o.colors || ['#d8ff6a', '#7affd0'];
  const m = new THREE.ShaderMaterial({
    uniforms: fxUniforms({
      uTime: globalU.uTime, uSize: { value: o.size ?? 0.11 }, uGlow: { value: o.glow ?? 3 }, uWander: { value: o.wander ?? 1.4 },
      uMin: { value: new THREE.Vector3(box[0], box[1], box[2]) }, uBox: { value: new THREE.Vector3(box[3], box[4], box[5]) },
      uColA: { value: new THREE.Color(cols[0]) }, uColB: { value: new THREE.Color(cols[1]) },
    }),
    vertexShader: FLY_VERT, fragmentShader: FLY_FRAG, transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  const mesh = new THREE.Mesh(geo, m);
  mesh.renderOrder = 8;
  mesh.layers.set(LAYERS.FX);
  mesh.userData.noAO = true;
  L.root.add(mesh);
  L.every(() => { geo.instanceCount = Math.round(n0 * Math.min(1, ((L.game.R && L.game.R.Q) || QUALITY.ultra).fxMotes ?? 1)); });
  return mesh;
}

const MIST_FRAG = /* glsl */ `
uniform sampler2D tSceneDepth, tNoise;
uniform vec2 uRes, uFogRange;
uniform float uCamNear, uCamFar, uTime, uDensity;
uniform vec3 uMin, uMax, uCol, uColB;
varying vec3 vWPos;
float kLin(float d) { return (uCamNear * uCamFar) / (uCamFar - (uCamFar - uCamNear) * d); }
void main() {
  vec2 suv = gl_FragCoord.xy / uRes;
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWPos - ro);
  vec3 inv = 1.0 / rd;
  vec3 ta = (uMin - ro) * inv, tb = (uMax - ro) * inv;
  vec3 tmin = min(ta, tb), tmax = max(ta, tb);
  float t0 = max(max(max(tmin.x, tmin.y), tmin.z), 0.0);
  float t1 = min(min(tmax.x, tmax.y), tmax.z);
  // le décor arrête le rayon
  vec3 fw = normalize((viewMatrix * vec4(rd, 0.0)).xyz);
  t1 = min(t1, kLin(texture2D(tSceneDepth, suv).x) / max(-fw.z, 1e-3));
  if (t1 <= t0) discard;
  float h = uMax.y - uMin.y, acc = 0.0, hue = 0.0;
  for (int i = 0; i < 6; i++) {
    vec3 p = ro + rd * mix(t0, t1, (float(i) + 0.5) / 6.0);
    float e = min(min(p.x - uMin.x, uMax.x - p.x), min(p.z - uMin.z, uMax.z - p.z));
    float y = (p.y - uMin.y) / h;
    // nappes qui rampent au ras du liquide, effilochées vers le haut
    vec2 w = p.xz * 0.006 + vec2(uTime * 0.0021, uTime * 0.0013) + y * 0.03;
    float n = texture2D(tNoise, w).r * 0.6 + texture2D(tNoise, w * 3.1 - uTime * 0.0017).a * 0.4;
    float d = exp(-y * 3.2) * smoothstep(0.32, 0.72, n + 0.12 * (1.0 - y)) * smoothstep(0.0, 5.0, e);
    acc += d;
    hue += d * n;
  }
  float k = acc * (t1 - t0) / 6.0;
  float a = (1.0 - exp(-k * uDensity)) * (1.0 - smoothstep(uFogRange.x, uFogRange.y, t0));
  vec3 c = mix(uCol, uColB, clamp(hue / max(acc, 1e-3) * 1.6 - 0.5, 0.0, 1.0));
  gl_FragColor = vec4(c * a, 0.0);
}`;

const POOL_VERT = /* glsl */ `
attribute vec4 aPool;
attribute vec3 aCol;
uniform float uMaxDist;
varying vec4 vPool;
varying vec3 vCol;
void main() {
  vPool = aPool;
  vCol = aCol;
  gl_Position = projectionMatrix * viewMatrix * vec4(aPool.xyz + position * aPool.w, 1.0);
  // au loin : rien à dessiner
  if (distance(cameraPosition, aPool.xyz) > uMaxDist + aPool.w) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const POOL_FRAG = /* glsl */ `
uniform sampler2D tSceneDepth;
uniform vec2 uRes;
uniform mat4 uInvProj, uInvView;
uniform float uGain;
varying vec4 vPool;
varying vec3 vCol;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, texture2D(tSceneDepth, uv).x * 2.0 - 1.0, 1.0);
  vec3 wp = (uInvView * vec4(v.xyz / v.w, 1.0)).xyz;
  vec3 L = vPool.xyz - wp;
  float d = length(L), r = d / vPool.w;
  if (r >= 1.0) discard;
  // normale de la surface reconstruite depuis la profondeur : les faces tournées vers la source s'éclairent
  vec3 n = normalize(cross(dFdx(wp), dFdy(wp)));
  if (dot(n, cameraPosition - wp) < 0.0) n = -n;
  float ndl = max(dot(n, L / max(d, 1e-3)), 0.0) * 0.75 + 0.25;
  float fall = 1.0 - r * r;
  gl_FragColor = vec4(vCol * fall * fall * ndl * uGain, 0.0);
}`;

// Flaques de lumière « gratuites » (toutes qualités) : la lueur d'une touffe de champignons sur le sol, les racines et
// Kobi, sans lumière du moteur. Sphère d'influence dessinée après le décor, qui relit la profondeur de l'image et
// ajoute la lumière aux surfaces dans son rayon. Toutes les flaques d'un niveau : un seul appel de dessin.
export function glowPool(L, pos, color, radius = 4, intensity = 1) {
  let P = L._glowPools;
  if (!P) {
    const N = 400;
    const geo = new THREE.InstancedBufferGeometry().copy(new THREE.IcosahedronGeometry(1, 1));
    geo.instanceCount = 0;
    const aPool = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
    const aCol = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
    geo.setAttribute('aPool', aPool);
    geo.setAttribute('aCol', aCol);
    const m = new THREE.ShaderMaterial({
      uniforms: {
        tSceneDepth: frameU.tSceneDepth, uRes: frameU.uRes, uInvProj: frameU.uInvProj, uInvView: frameU.uInvView,
        uMaxDist: { value: 50 }, uGain: { value: 1 },
      },
      vertexShader: POOL_VERT, fragmentShader: POOL_FRAG,
      transparent: true, depthWrite: false, depthTest: false, side: THREE.BackSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    const mesh = new THREE.Mesh(geo, m);
    mesh.frustumCulled = false;
    mesh.layers.set(LAYERS.FX);
    mesh.renderOrder = -6;
    mesh.userData.noAO = true;
    mesh.name = 'flaques-de-lumiere';
    L.root.add(mesh);
    P = L._glowPools = { geo, aPool, aCol, n: 0, N, u: m.uniforms };
  }
  if (P.n >= P.N) return null;
  const c = new THREE.Color(color).multiplyScalar(intensity);
  P.aPool.setXYZW(P.n, pos.x, pos.y, pos.z, radius);
  P.aCol.setXYZ(P.n, c.r, c.g, c.b);
  P.n++;
  P.geo.instanceCount = P.n;
  P.aPool.needsUpdate = P.aCol.needsUpdate = true;
  return P;
}

// Touffe de petits champignons lumineux (sans collision) et sa flaque de lumière sur le sol
export function glowShrooms(L, pos, scale = 1, color = '#3affe0', s = 1, o = {}) {
  const m = mats();
  const cap = glow(color, 2.6);
  seed(s);
  const n = 3 + Math.floor(R() * 4), ground = onGround(L, pos);
  for (let k = 0; k < n; k++) {
    const a = R() * 6.28, d = (k === 0 ? 0 : 0.25 + R() * 0.55) * scale;
    const h = (0.25 + R() * 0.55) * scale * (k === 0 ? 1.3 : 1), cr = h * (0.35 + R() * 0.2);
    const x = pos.x + Math.cos(a) * d, z = pos.z + Math.sin(a) * d;
    const tilt = [(R() - 0.5) * 0.4, 0, (R() - 0.5) * 0.4];
    // le pied penche depuis le sol (enfoncé de 4 cm sous le point le plus bas autour de lui), le chapeau coiffe sa tête
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...tilt)), u = _up.clone().applyQuaternion(q);
    const by = (ground ? Math.min(pos.y, groundMin(L, x, z, cr * 0.4, pos.y)) : pos.y) - 0.04;
    const len = pos.y + h - by, b = new THREE.Vector3(x, by, z);
    L.add(G.cyl(cr * 0.18, cr * 0.26, h, 5), m.stem, new THREE.Matrix4().compose(b.clone().addScaledVector(u, len / 2), q, new THREE.Vector3(1, len / h, 1)));
    L.add(new THREE.SphereGeometry(cr, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1), cap, new THREE.Matrix4().compose(b.clone().addScaledVector(u, len - 0.02), q, new THREE.Vector3(1, 1, 1)));
    // le chapeau est une coque : le pied monte dedans jusque sous son sommet
    L.add(G.cyl(cr * 0.18, cr * 0.18, 1, 5), m.stem, new THREE.Matrix4().compose(b.addScaledVector(u, len - 0.02 + cr * 0.285), q, new THREE.Vector3(1, cr * 0.57, 1)));
  }
  glowPool(L, new THREE.Vector3(pos.x, pos.y + 0.5 * scale, pos.z), color, (o.radius ?? 3.6) * scale, o.light ?? 0.5);
}

// Guirlande d'ampoules chaudes tendue entre deux points (même flèche que les fanions du village) et sa lumière
export function garland(L, a, b, color = '#ffc86a', sag = 1) {
  const n = Math.ceil(a.distanceTo(b) / 0.9) * 2;
  const bulb = glow(color, 3.2), rope = mat('#2a2218', { rough: 0.9 });
  const pt = (t) => new THREE.Vector3().lerpVectors(a, b, t).setY(THREE.MathUtils.lerp(a.y, b.y, t) - Math.sin(t * Math.PI) * sag);
  const up = new THREE.Vector3(0, 1, 0);
  let prev = pt(0);
  for (let i = 1; i <= n; i++) {
    const p = pt(i / n), d = p.clone().sub(prev);
    L.add(G.cyl(0.018, 0.018, d.length(), 4), rope, new THREE.Matrix4().compose(prev.clone().lerp(p, 0.5), new THREE.Quaternion().setFromUnitVectors(up, d.normalize()), new THREE.Vector3(1, 1, 1)));
    if (i % 2 && i < n) L.add(G.sphere(0.09, 6, 4), bulb, mtx([p.x, p.y - 0.1, p.z]));
    prev = p;
  }
  lights.add({ line: [pt(0.15), pt(0.85)], offset: new THREE.Vector3(0, -sag * 0.5, 0), color, intensity: 16, range: 9, flicker: 0.04, priority: 1.3 });
}

// Orbe d'esprit qui flotte et palpite (temple) : lueur, halo et lumière qui le suit
export function spiritOrb(L, pos, color = '#b06aff', s = 0) {
  const grp = new THREE.Group();
  grp.position.copy(pos);
  const core = new THREE.Mesh(G.sphere(0.22, 12, 8), glow(color, 4));
  const halo = new THREE.Mesh(G.torus(0.42, 0.025, 6, 28), glow(color, 2.2));
  grp.add(core, halo);
  grp.traverse((o) => { o.userData.noAO = true; });
  L.root.add(grp);
  lights.add({ obj: grp, color, intensity: 20, range: 8, flicker: 0.15, priority: 1.4 });
  L.every((dt, t) => {
    grp.position.y = pos.y + Math.sin(t * 1.1 + s) * 0.25;
    halo.rotation.set(t * 0.7 + s, t * 0.5, 0);
    core.scale.setScalar(1 + Math.sin(t * 3.1 + s * 2) * 0.12);
  });
  return grp;
}

// Brume lumineuse au ras d'un liquide (marais acide) : volume (boîte, faces arrière) intégré le long du rayon
// jusqu'au décor, dense au ras de la surface, en nappes qui dérivent ; ajoutée à l'image (elle luit).
// rect : [x0, z0, l, p] ; o : { height, color, colorB, density }
export function glowMist(L, rect, y, o = {}) {
  const [x0, z0, w, d] = rect;
  const hh = o.height ?? 4;
  const u = {
    tSceneDepth: frameU.tSceneDepth, tNoise: { value: noiseTexture() }, uRes: frameU.uRes, uFogRange: frameU.uFxFogRange,
    uCamNear: frameU.uCamNear, uCamFar: frameU.uCamFar, uTime: globalU.uTime, uDensity: { value: o.density ?? 0.08 },
    uMin: { value: new THREE.Vector3(x0, y, z0) }, uMax: { value: new THREE.Vector3(x0 + w, y + hh, z0 + d) },
    uCol: { value: new THREE.Color(o.color || '#4aff3a') }, uColB: { value: new THREE.Color(o.colorB || '#c8ff6a') },
  };
  const m = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: 'varying vec3 vWPos; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWPos = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: MIST_FRAG,
    transparent: true, depthWrite: false, depthTest: false, side: THREE.BackSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), m);
  mesh.position.set(x0 + w / 2, y + hh / 2, z0 + d / 2);
  mesh.layers.set(LAYERS.FX);
  mesh.renderOrder = -4;
  mesh.userData.noAO = true;
  mesh.name = 'brume-lumineuse';
  L.root.add(mesh);
  return { mesh, u };
}
