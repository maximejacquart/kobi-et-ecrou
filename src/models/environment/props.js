// Objets présents sur plusieurs planètes : rochers, conteneurs, barils, lampadaires, éoliennes, fanions,
// vaisseau de Kobi (fusionnés par matériau).
import * as THREE from 'three';
import { G, part, joint, mtx, mergeGeometries, compact } from '../geo.js';
import { mat, glow, terrainMaterial } from '../../engine/materials.js';
import { sandTexture, rockTexture, scrapTexture, containerTexture, metalTexture, woodTexture, plankTexture } from '../../engine/textures.js';
import { BoxCollider, CylinderCollider } from '../../engine/physics.js';
import { noise3, rand, rng as mkRng } from '../../engine/util.js';
import { lights, glowColor } from '../../engine/lightpool.js';
import { boxUV } from '../../levels/level.js';

const M = {};
function mats() {
  if (M.ready) return M;
  const rock = rockTexture('sandstone');
  const sandT = sandTexture();
  M.rock = terrainMaterial({ mapA: sandT.map, mapB: rock.map, normalA: sandT.normalMap, normalB: rock.normalMap, scaleA: 0.2, scaleB: 0.16, slopeLo: 0.72, slopeHi: 0.86 });
  const scrap = scrapTexture();
  M.scrap = mat('#ffffff', { map: scrap.map, normalMap: scrap.normalMap, rough: 0.75, metal: 0.4 });
  M.metalDark = mat('#3a3f52', { rough: 0.45, metal: 0.7 });
  M.metal = mat('#8d97ad', { rough: 0.35, metal: 0.85 });
  M.rust = mat('#8a4a2a', { rough: 0.8, metal: 0.3 });
  const wood = woodTexture();
  M.wood = mat('#ffffff', { map: wood.map, normalMap: wood.normalMap, rough: 0.85 });
  const plank = plankTexture('#a8703f');
  M.plank = mat('#ffffff', { map: plank.map, normalMap: plank.normalMap, rough: 0.8 });
  M.lampGlow = glow('#ffd27a', 3);
  M.pinkGlow = glow('#ff4fa0', 2.5);
  M.voraxGold = mat('#ffcc33', { rough: 0.3, metal: 0.8 });
  M.cloth = mat('#ff6f5a', { rough: 0.9, side: THREE.DoubleSide });
  M.ready = true;
  return M;
}
export function propMats() { return mats(); }

// Roche bosselée (icosaèdre déformé par du bruit)
const rockGeoCache = [];

export function rockGeo(seed) {
  const key = seed % 6;
  if (rockGeoCache[key]) return rockGeoCache[key];
  const g = new THREE.IcosahedronGeometry(1, 3);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = noise3(v.x * 1.4 + key * 10, v.y * 1.4, v.z * 1.4, key) * 0.55 + noise3(v.x * 4, v.y * 4, v.z * 4, key + 3) * 0.15;
    v.multiplyScalar(0.7 + n);
    if (v.y < -0.3) v.y = -0.3 + (v.y + 0.3) * 0.3;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const cols = new Float32Array(p.count * 3).fill(1);
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  rockGeoCache[key] = g;
  return g;
}

// Terrain du niveau sous (x, z) quand l'objet est posé dessus (à moins de near m), sinon null (îles, planchers, toits)
function terrainNear(L, x, y, z, near = 0.5) {
  const hf = L.heightfield;
  if (!hf) return null;
  const h = hf.height(x, z);
  return Math.abs(h - y) < near ? hf : null;
}
const _sv = new THREE.Vector3();

export function rock(L, pos, size, o = {}) {
  const m = mats();
  const sx = size * (o.sx ?? rand(0.8, 1.3)), sy = size * (o.sy ?? rand(0.6, 1.1)), sz = size * (o.sz ?? rand(0.8, 1.3));
  const geo = rockGeo(o.seed ?? Math.floor(rand(0, 100)));
  const mm = mtx([pos.x, pos.y, pos.z], [0, o.ry ?? rand(0, 6), 0], [sx, sy, sz]);
  // sur une pente, le dessous aplati décollait côté aval : la roche s'enfonce jusqu'à toucher partout
  let dy = 0;
  const hf = terrainNear(L, pos.x, pos.y, pos.z, 1);
  if (hf) {
    const p = geo.attributes.position;
    let gap = 0;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > -0.22) continue;
      _sv.fromBufferAttribute(p, i).applyMatrix4(mm);
      gap = Math.max(gap, _sv.y - hf.height(_sv.x, _sv.z));
    }
    if (gap > 0.01 && gap < 0.8) { dy = -(gap + 0.03); mm.elements[13] += dy; }
  }
  L.add(geo, o.mat || m.rock, mm);
  if (o.collide !== false && size > 0.8) {
    L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y + dy - sy * 0.3, pos.y + dy + sy * 0.85, Math.min(sx, sz) * 0.92, { surface: 'rock' }));
  }
}

// Conteneur maritime (plateforme)
// matériaux de tôle par couleur, partagés avec les cabanes de Brikka (canyon.js)
export const contMats = {};

// Tôle ondulée : bande dans le plan XY tournée vers +Z, de x = -len/2 à len/2 et de y = y0 à y0 + hgt.
// Profil trapézoïdal (crête à z = 0, flanc, creux à z = -depth, flanc), normales lissées aux arêtes du profil ;
// UV en mètres × uvS (la texture ne porte que la peinture et l'usure).
export function corrugated(len, hgt, pitch, depth, uvS = 0.25, y0 = 0) {
  const n = Math.max(1, Math.round(len / pitch)), p = len / n;
  const prof = [];
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + i * p;
    prof.push([x, 0], [x + p * 0.32, 0], [x + p * 0.5, -depth], [x + p * 0.82, -depth]);
  }
  prof.push([len / 2, 0]);
  const seg = [];
  for (let k = 0; k < prof.length - 1; k++) {
    const [x0, z0] = prof[k], [x1, z1] = prof[k + 1];
    const l = Math.hypot(x1 - x0, z1 - z0);
    seg.push([-(z1 - z0) / l, (x1 - x0) / l]);
  }
  const pn = prof.map((_, k) => {
    const a = seg[Math.max(0, k - 1)], b = seg[Math.min(seg.length - 1, k)];
    const l = Math.hypot(a[0] + b[0], a[1] + b[1]);
    return [(a[0] + b[0]) / l, (a[1] + b[1]) / l];
  });
  const pos = [], nor = [], uv = [];
  const y1 = y0 + hgt;
  for (let k = 0; k < prof.length - 1; k++) {
    const [x0, z0] = prof[k], [x1, z1] = prof[k + 1];
    const [ax, az] = pn[k], [bx, bz] = pn[k + 1];
    for (const [x, y, z, nx, nz] of [[x0, y0, z0, ax, az], [x1, y0, z1, bx, bz], [x1, y1, z1, bx, bz], [x0, y0, z0, ax, az], [x1, y1, z1, bx, bz], [x0, y1, z0, ax, az]]) {
      pos.push(x, y, z); nor.push(nx, 0, nz); uv.push(x * uvS, y * uvS);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
export const boxAt = (geo, x, y, z) => geo.toNonIndexed().translate(x, y, z);
// Boîte arrondie (G.rbox, déjà non indexée : copiée avant déplacement) posée en (x, y, z)
export const rboxAt = (w, h, d, r, x, y, z, seg = 2) => G.rbox(w, h, d, r, seg).clone().translate(x, y, z);
export function mergeParts(list) {
  const g = mergeGeometries(list);
  g.userData.shared = true;
  for (const p of list) p.dispose();
  return g;
}

// ---------------------------------------------------------------------------------------------------------------------
// Aides de construction réutilisables (caisses, bornes, cabanes…). Toutes rendent des géométries non indexées, à
// fusionner par matériau avec mergeParts() puis à poser avec L.add (décor) ou en maillage (objet animé).
// Matières associées (engine/textures.js) : plankTexture (bois), paintedMetalTexture (métal peint écaillé),
// treadPlateTexture (tôle larmée), shingleTexture (bardeaux).
// ---------------------------------------------------------------------------------------------------------------------

// Pièce de bois pour plankTexture : sur chaque face, u suit la plus grande dimension (mètres × uS, décalé de uOff),
// v traverse l'autre de 0 à 1 (arêtes usées de la texture sur les arêtes de la pièce). Planche, liteau, poutre, poteau.
export function plankBox(w, h, d, uS = 1, uOff = 0) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)) > 0.5 ? [2, 1] : Math.abs(n.getY(i)) > 0.5 ? [0, 2] : [0, 1];
    const size = [w, h, d], c = [p.getX(i), p.getY(i), p.getZ(i)];
    const [a, b] = size[ax[0]] >= size[ax[1]] ? ax : [ax[1], ax[0]];
    uv.setXY(i, c[a] * uS + uOff, c[b] / size[b] + 0.5);
  }
  return g;
}

// Panneau de planches dans le plan XY, face avant vers +Z, dos à z = 0 : n planches couchées (debout si o.vertical)
// couvrant len × hgt, avec jointures, épaisseurs et retraits légèrement variés. Bardage, porte, plateau de caisse.
// o : { thick (0,05), gap (0,012), jitter (0..1), seed, vertical, uS }
export function plankPanel(len, hgt, n, o = {}) {
  const R = mkRng(o.seed ?? 1);
  const t = o.thick ?? 0.05, gap = o.gap ?? 0.012, j = o.jitter ?? 1, uS = o.uS ?? 1;
  const span = o.vertical ? len : hgt, along = o.vertical ? hgt : len;
  const pw = span / n;
  const parts = [];
  for (let i = 0; i < n; i++) {
    const c = -span / 2 + pw * (i + 0.5);
    const tt = t * (1 - R() * 0.25 * j);
    const g = o.vertical ? plankBox(pw - gap, along, tt, uS, R() * 7) : plankBox(along, pw - gap, tt, uS, R() * 7);
    g.rotateZ((R() - 0.5) * 0.012 * j);
    if (o.vertical) g.translate(c, 0, tt / 2); else g.translate(0, c, tt / 2);
    parts.push(g);
  }
  const g = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return g;
}

// Rivet / tête de clou bombé (calotte basse), tourné vers +Y ; rivets() en pose une série
const rivetCache = new Map();
export function rivet(r = 0.02) {
  if (!rivetCache.has(r)) {
    const g = new THREE.SphereGeometry(r, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1);
    rivetCache.set(r, g);
  }
  return rivetCache.get(r).clone().toNonIndexed();
}
// Pose des rivets aux points pts ([[x, y, z]…]), tête tournée vers nrm ; ajoutés à la liste list
const _rq = new THREE.Quaternion(), _ry = new THREE.Vector3(0, 1, 0), _rn = new THREE.Vector3();
export function rivets(list, pts, nrm = [0, 0, 1], r = 0.02) {
  _rq.setFromUnitVectors(_ry, _rn.set(nrm[0], nrm[1], nrm[2]).normalize());
  for (const [x, y, z] of pts) list.push(rivet(r).applyQuaternion(_rq).translate(x, y, z));
  return list;
}

// Salissure : couleurs de sommet assombries et teintées vers le bas (de y0 à y1), pour les objets animés posés hors
// de la fusion du niveau (la fusion assombrit déjà la base des décors). Le matériau doit avoir vertexColors.
// k : assombrissement au pied (0..1), tint : couleur de la crasse
export function grime(geo, y0, y1, k = 0.35, tint = '#6a5844') {
  const p = geo.attributes.position, c = new THREE.Color(tint);
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const t = THREE.MathUtils.smoothstep(p.getY(i), y0, y1);
    const a = (1 - t) * k;
    col[i * 3] = 1 - a + a * c.r * 0.8; col[i * 3 + 1] = 1 - a + a * c.g * 0.8; col[i * 3 + 2] = 1 - a + a * c.b * 0.8;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// Géométries d'un conteneur (origine au centre de la base, longueur sur x, porte en +x), par matériau
const contGeoCache = new Map();
function containerGeo(w, h, d) {
  const key = `${w}|${h}|${d}`;
  if (contGeoCache.has(key)) return contGeoCache.get(key);
  const f = 0.13, ci = 0.03, S = 0.25;
  const iw = w - 2 * f, ih = h - 2 * f, id = d - 2 * f;
  const body = [], dark = [], steel = [];
  // flancs, fond et toit en tôle ondulée
  for (const side of [1, -1]) {
    const g = corrugated(iw, ih, 0.3, 0.04, S, f).translate(0, 0, d / 2 - ci);
    if (side < 0) g.rotateY(Math.PI);
    body.push(g);
  }
  body.push(corrugated(id, ih, 0.3, 0.04, S, f).rotateY(-Math.PI / 2).translate(-(w / 2 - ci), 0, 0));
  body.push(corrugated(iw, id, 0.55, 0.025, S, -id / 2).rotateX(-Math.PI / 2).translate(0, h - 0.012, 0));
  body.push(boxAt(boxUV(w - 0.02, 0.05, d - 0.02, S), 0, 0.025, 0));
  // double porte (nervures plus serrées), affleurante
  const leaf = id / 2 - 0.012;
  for (const s of [1, -1]) body.push(corrugated(leaf, ih, 0.22, 0.03, S, f).rotateY(Math.PI / 2).translate(w / 2 - 0.02, 0, s * (leaf / 2 + 0.012)));
  // cadre : longerons, traverses, montants
  for (const y of [f / 2, h - f / 2]) {
    for (const z of [d / 2 - f / 2, -(d / 2 - f / 2)]) body.push(boxAt(boxUV(w, f, f, S), 0, y, z));
    for (const x of [w / 2 - f / 2, -(w / 2 - f / 2)]) body.push(boxAt(boxUV(f, f, id, S), x, y, 0));
  }
  for (const x of [w / 2 - f / 2, -(w / 2 - f / 2)]) for (const z of [d / 2 - f / 2, -(d / 2 - f / 2)]) body.push(boxAt(boxUV(f, ih, f, S), x, h / 2, z));
  // pièces de coin (acier brut, légèrement plus grosses que le cadre)
  const c = 0.19;
  for (const x of [1, -1]) for (const y of [c / 2 - 0.005, h - c / 2 + 0.005]) for (const z of [1, -1]) dark.push(boxAt(G.box(c, c, c), x * (w / 2 - c / 2 + 0.006), y, z * (d / 2 - c / 2 + 0.006)));
  // porte : joint central, charnières, barres de verrouillage avec leurs gâches et leurs poignées
  dark.push(boxAt(G.box(0.03, ih, 0.035), w / 2 - 0.005, h / 2, 0));
  for (const s of [1, -1]) for (const y of [0.22, 0.5, 0.78]) dark.push(boxAt(G.box(0.05, 0.12, 0.07), w / 2, f + ih * y, s * (id / 2 - 0.02)));
  for (const zb of [id * 0.13, id * 0.36]) for (const s of [1, -1]) {
    const z = s * zb;
    steel.push(boxAt(G.cyl(0.024, 0.024, ih + 0.1, 8), w / 2 + 0.03, h / 2, z));
    for (const y of [f + 0.02, h - f - 0.02]) dark.push(boxAt(G.box(0.07, 0.09, 0.1), w / 2 + 0.02, y, z));
    dark.push(boxAt(G.box(0.05, 0.06, 0.07), w / 2 + 0.03, f + ih * 0.42, z));
    steel.push(boxAt(G.box(0.03, 0.035, 0.26), w / 2 + 0.06, f + ih * 0.42, z - s * 0.12));
  }
  const res = { body: mergeParts(body), dark: mergeParts(dark), steel: mergeParts(steel) };
  contGeoCache.set(key, res);
  return res;
}

export function container(L, pos, yaw = 0, color = '#c8452f', o = {}) {
  const m = mats();
  if (!contMats[color]) {
    const t = containerTexture(color);
    contMats[color] = mat('#ffffff', { map: t.map, normalMap: t.normalMap, rough: 0.82, metal: 0.15 });
  }
  const w = o.w ?? 6, h = o.h ?? 2.6, d = o.d ?? 2.5;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx || 0, yaw, o.rz || 0));
  const mm = new THREE.Matrix4().compose(new THREE.Vector3(pos.x, pos.y, pos.z), q, new THREE.Vector3(1, 1, 1));
  const geo = containerGeo(w, h, d);
  L.add(geo.body, contMats[color], mm);
  L.add(geo.dark, m.metalDark, mm);
  L.add(geo.steel, m.metal, mm);
  containerChocks(L, mm, w, d);
  if (o.collide !== false) {
    L.game.world.add(new BoxCollider(new THREE.Vector3(0, h / 2, 0).applyQuaternion(q).add(pos), new THREE.Vector3(w / 2, h / 2, d / 2), q, { surface: 'metal' }));
  }
}

// Cales : sur une pente (ou un sol dessiné plus bas que le point de pose), un bout du conteneur décollait du terrain.
// Sous chaque bout qui ne porte pas, des traverses de bois empilées descendent du cadre jusque dans le sol. Rien sous
// un conteneur posé sur un autre ou sur un décor (collider juste dessous) ni au-dessus du vide (plus de 1,2 m).
function containerChocks(L, mm, w, d) {
  const hf = L.heightfield, world = L.game && L.game.world;
  if (!hf) return;
  const parts = [], R = mkRng(Math.round(mm.elements[12] * 7 + mm.elements[14] * 13));
  for (const s of [1, -1]) {
    const lx = s * (w / 2 - 0.3);
    let top = -Infinity, low = Infinity, gap = -Infinity, supported = false;
    for (const dx of [-0.13, 0.13]) for (let k = 0; k <= 4; k++) {
      _sv.set(lx + dx, 0, (k / 4 - 0.5) * (d - 0.16)).applyMatrix4(mm);
      const gy = hf.height(_sv.x, _sv.z);
      top = Math.max(top, _sv.y); low = Math.min(low, gy); gap = Math.max(gap, _sv.y - gy);
      if (world && world.groundBelow) {
        const hit = world.groundBelow(_sv.x, _sv.y + 0.05, _sv.z, 0.15, (c) => c !== hf && c.aabb.maxY <= _sv.y + 0.06);
        if (hit) supported = true;
      }
    }
    if (supported || gap < 0.025 || gap > 1.2) continue;
    const hS = top - low + 0.12, n = Math.max(1, Math.ceil(hS / 0.24)), th = hS / n;
    for (let i = 0; i < n; i++) {
      const g = plankBox(0.26, th - 0.006, d - 0.08 - R() * 0.12, 1, R() * 5);
      g.translate(lx + (R() - 0.5) * 0.06, -th * (i + 0.5), (R() - 0.5) * 0.06);
      parts.push(g);
    }
  }
  if (!parts.length) return;
  const g = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  L.add(g, mats().wood, mm);
}

// Fût de 200 L : profil légèrement bombé, deux cercles de roulement, rebords sertis, couvercle à deux bondes
let barrelGeo = null;
function barrelParts() {
  if (barrelGeo) return barrelGeo;
  const prof = [[0, -0.53], [0.37, -0.53], [0.385, -0.55], [0.405, -0.55], [0.41, -0.52], [0.395, -0.5], [0.4, -0.2], [0.418, -0.18], [0.418, -0.16], [0.405, -0.14],
    [0.41, 0], [0.405, 0.14], [0.418, 0.16], [0.418, 0.18], [0.4, 0.2], [0.395, 0.5], [0.41, 0.52], [0.405, 0.55], [0.385, 0.55], [0.37, 0.53], [0, 0.53]];
  const body = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 28);
  body.computeVertexNormals();
  const caps = [boxAt(G.cyl(0.06, 0.06, 0.03, 10), 0.22, 0.54, 0.05), boxAt(G.cyl(0.04, 0.04, 0.03, 8), -0.2, 0.54, -0.12)];
  barrelGeo = { body, caps: mergeParts(caps) };
  barrelGeo.body.userData.shared = true;
  return barrelGeo;
}
export function barrel(L, pos, o = {}) {
  const m = mats();
  const col = o.color ? mat(o.color, { rough: 0.5, metal: 0.4 }) : m.rust;
  const g = barrelParts();
  const mm = mtx([pos.x, pos.y + 0.55, pos.z], [o.tip ? Math.PI / 2 : 0, rand(0, 6), 0]);
  // debout sur une pente, le fût touchait par un point du rebord et flottait de l'autre côté : il penche un peu
  // avec le terrain (12° au plus) et s'enfonce jusqu'à ce que tout le rebord porte
  let dy = 0;
  const hf = !o.tip && terrainNear(L, pos.x, pos.y, pos.z);
  if (hf) {
    const n = hf.normal(pos.x, pos.z, new THREE.Vector3()), up = new THREE.Vector3(0, 1, 0);
    const a = Math.min(up.angleTo(n), 0.21);
    if (a > 0.005) {
      const ax = new THREE.Vector3().crossVectors(up, n).normalize();
      mm.premultiply(new THREE.Matrix4().makeTranslation(-pos.x, -pos.y, -pos.z))
        .premultiply(new THREE.Matrix4().makeRotationAxis(ax, a))
        .premultiply(new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z));
    }
    let gap = -Infinity;
    for (let k = 0; k < 12; k++) {
      _sv.set(Math.cos(k * 0.5236) * 0.4, -0.55, Math.sin(k * 0.5236) * 0.4).applyMatrix4(mm);
      gap = Math.max(gap, _sv.y - hf.height(_sv.x, _sv.z));
    }
    if (gap > 0.005) { dy = -(gap + 0.02); mm.elements[13] += dy; }
  }
  L.add(g.body, col, mm);
  L.add(g.caps, m.metalDark, mm);
  if (o.collide !== false) L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y + dy, pos.y + dy + 1.1, 0.42, { surface: 'metal' }));
}

// Lampadaire de chantier
export function lamp(L, pos, o = {}) {
  const m = mats();
  const h = o.h ?? 4;
  const at = (x, y, z, r) => mtx([pos.x + x, pos.y + y, pos.z + z], r || [0, 0, 0]);
  // socle de béton sous la platine : sur une pente, il descend jusqu'au point le plus bas du terrain
  const hf = terrainNear(L, pos.x, pos.y, pos.z);
  if (hf) {
    let low = Infinity;
    for (let k = 0; k < 10; k++) low = Math.min(low, hf.height(pos.x + Math.cos(k * 0.628) * 0.32, pos.z + Math.sin(k * 0.628) * 0.32));
    const drop = pos.y - low;
    if (drop > 0.015) {
      if (!M.concrete) M.concrete = mat('#8f8a80', { rough: 0.95 });
      const hc = drop + 0.15;
      L.add(new THREE.CylinderGeometry(0.29, 0.32, hc, 10), M.concrete, at(0, -hc / 2, 0));
    }
  }
  // platine boulonnée, mât effilé avec son manchon, boîtier électrique
  L.add(G.cyl(0.24, 0.26, 0.08, 10), m.metalDark, at(0, 0.04, 0));
  for (let k = 0; k < 4; k++) L.add(G.cyl(0.03, 0.03, 0.06, 6), m.metal, at(Math.cos(k * 1.571 + 0.785) * 0.18, 0.1, Math.sin(k * 1.571 + 0.785) * 0.18));
  L.add(G.cyl(0.13, 0.15, 0.5, 10), m.metalDark, at(0, 0.3, 0));
  L.add(G.cyl(0.07, 0.11, h, 10), m.metalDark, at(0, h / 2, 0));
  L.add(G.box(0.16, 0.24, 0.1), m.metal, at(0, 1.2, 0.1));
  // potence avec jambe de force, abat-jour conique, ampoule et grille
  L.add(G.box(0.95, 0.07, 0.07), m.metalDark, at(0.42, h - 0.02, 0));
  // jambe de force : du mât (0,4 m sous la potence) jusque sous la potence (elle s'arrêtait 3 cm dessous)
  L.add(G.box(0.6, 0.045, 0.045), m.metalDark, at(0.27, h - 0.225, 0, [0, 0, 0.654]));
  L.add(G.cyl(0.09, 0.09, 0.12, 10), m.metal, at(0.8, h - 0.06, 0));
  L.add(G.cyl(0.1, 0.3, 0.24, 14), m.metal, at(0.8, h - 0.22, 0));
  L.add(G.torus(0.3, 0.02, 6, 16), m.metalDark, at(0.8, h - 0.34, 0, [Math.PI / 2, 0, 0]));
  // douille : l'ampoule pend sous le chapeau au lieu de flotter dans l'abat-jour
  L.add(G.cyl(0.04, 0.05, 0.1, 8), m.metalDark, at(0.8, h - 0.165, 0));
  L.add(G.sphere(0.13, 10, 8), o.glow || m.lampGlow, at(0.8, h - 0.32, 0));
  // grille : quatre fils du cerclage au moyeu sous l'ampoule (la croix flottait sous le cerclage)
  for (let k = 0; k < 4; k++) {
    const c = Math.cos(k * Math.PI / 2), sn = Math.sin(k * Math.PI / 2);
    L.add(beam(new THREE.Vector3(pos.x + 0.8 + c * 0.3, pos.y + h - 0.34, pos.z + sn * 0.3), new THREE.Vector3(pos.x + 0.8 + c * 0.02, pos.y + h - 0.47, pos.z + sn * 0.02), 0.009, 0.009, 4), m.metalDark, null);
  }
  L.add(G.cyl(0.03, 0.03, 0.03, 8), m.metalDark, at(0.8, h - 0.465, 0));
  lights.add({ pos: new THREE.Vector3(pos.x + 0.8, pos.y + h - 0.5, pos.z), color: glowColor(o.glow || m.lampGlow), intensity: 45, range: 13, priority: 1.6 });
  L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y, pos.y + h, 0.15, { surface: 'metal' }));
}

// Poutre cylindrique de a à b (rayons r0 au pied, r1 en tête) : jambes, entretoises, tubes
const _ba = new THREE.Vector3(), _bq = new THREE.Quaternion(), _bu = new THREE.Vector3(0, 1, 0);
export function beam(a, b, r0, r1 = r0, seg = 6) {
  _ba.subVectors(b, a);
  const len = _ba.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1).toNonIndexed();
  g.applyQuaternion(_bq.setFromUnitVectors(_bu, _ba.normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

// Éolienne de ferraille (animée) : pylône en treillis (quatre jambes effilées, ceintures et croix de Saint-André),
// semelles boulonnées, plancher de planches au sommet ; nacelle en tôle rouillée cerclée, nez, queue à dérive ;
// pales de toile et de tôle sur longerons, attachées par des brides
export function windmill(L, pos, yaw = 0) {
  const m = mats();
  const H = 8.9, legs = [], braces = [], dark = [], deck = [];
  const corner = (y, sx, sz) => { const k = 0.75 - (0.53 * y) / H; return new THREE.Vector3(sx * k, y, sz * k); };
  const C = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  const piers = [];
  const hf = terrainNear(L, pos.x, pos.y, pos.z);
  for (const [sx, sz] of C) {
    legs.push(beam(corner(0, sx, sz), corner(H, sx, sz), 0.09, 0.06, 7));
    dark.push(G.box(0.36, 0.14, 0.36).toNonIndexed().translate(sx * 0.75, 0.07, sz * 0.75));
    rivets(dark, [[sx * 0.75 + 0.11, 0.14, sz * 0.75 + 0.11], [sx * 0.75 - 0.11, 0.14, sz * 0.75 - 0.11]], [0, 1, 0], 0.03);
    // plot de béton sous la semelle, jusqu'au terrain le plus bas sous elle (en pente, la semelle décollait)
    if (hf) {
      let low = Infinity;
      for (const dx of [-0.2, 0.2]) for (const dz of [-0.2, 0.2]) low = Math.min(low, hf.height(pos.x + sx * 0.75 + dx, pos.z + sz * 0.75 + dz));
      const drop = pos.y - low;
      if (drop > 0.015 && drop < 1) piers.push(G.box(0.44, drop + 0.15, 0.44).toNonIndexed().translate(sx * 0.75, -(drop + 0.15) / 2, sz * 0.75));
    }
  }
  const rings = [0.5, 2.6, 4.7, 6.8, H - 0.1];
  for (let r = 0; r < rings.length; r++) {
    for (let k = 0; k < 4; k++) {
      const [ax, az] = C[k], [bx, bz] = C[(k + 1) % 4];
      braces.push(beam(corner(rings[r], ax, az), corner(rings[r], bx, bz), 0.04, 0.04, 5));
      if (r < rings.length - 1) {
        braces.push(beam(corner(rings[r], ax, az), corner(rings[r + 1], bx, bz), 0.028, 0.028, 4));
        braces.push(beam(corner(rings[r], bx, bz), corner(rings[r + 1], ax, az), 0.028, 0.028, 4));
      }
    }
  }
  for (let i = 0; i < 5; i++) deck.push(plankBox(1.5, 0.05, 0.28, 1, i * 0.37).translate(0, H + 0.03, -0.6 + i * 0.3));
  // deux solives sur les têtes des jambes : les planches de bord, en porte-à-faux, ne reposaient sur rien
  for (const x of [-0.22, 0.22]) deck.push(plankBox(0.1, 0.08, 1.5, 1, x * 3).translate(x, H - 0.035, 0));
  const at = mtx([pos.x, pos.y, pos.z]);
  L.add(mergeParts(legs), m.metalDark, at);
  L.add(mergeParts(braces), m.rust, at);
  L.add(mergeParts(dark), m.metalDark, at);
  L.add(mergeParts(deck), m.plank, at);
  if (piers.length) {
    if (!M.concrete) M.concrete = mat('#8f8a80', { rough: 0.95 });
    L.add(mergeParts(piers), M.concrete, at);
  }
  L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y, pos.y + 9, 0.6, { surface: 'metal' }));
  // nacelle (s'oriente avec yaw) : posée sur sa couronne d'orientation, elle-même posée sur le plancher (la nacelle
  // traversait le plancher et la couronne pendait dessous)
  const head = joint(L.root, [pos.x, pos.y + 9.5, pos.z]);
  head.rotation.y = yaw;
  const hb = new THREE.Group();
  part(hb, G.cyl(0.4, 0.44, 1.5, 14), m.rust, { r: [Math.PI / 2, 0, 0] });
  for (const z of [-0.68, 0.0, 0.68]) part(hb, G.torus(0.43, 0.035, 5, 18), m.metalDark, { p: [0, 0, z] });
  part(hb, G.cone(0.3, 0.4, 14), m.metalDark, { p: [0, 0, 0.92], r: [Math.PI / 2, 0, 0] });
  part(hb, G.cyl(0.25, 0.3, 0.17, 10), m.metalDark, { p: [0, -0.47, 0] });
  part(hb, G.cyl(0.05, 0.05, 1.4, 6), m.metalDark, { p: [0, 0.05, -1.35], r: [Math.PI / 2, 0, 0] });
  part(hb, G.box(0.05, 0.9, 0.9), m.scrap, { p: [0, 0.2, -2.0] });
  part(hb, G.box(0.36, 0.2, 0.4), m.metalDark, { p: [0, 0.48, -0.2] });
  head.add(compact(hb, 'windmill-head', { shadow: true }));
  // rotor : pales sur longerons, brides, moyeu doré
  const rb = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const b = joint(rb, [0, 0, 0]);
    b.rotation.z = (i / 5) * Math.PI * 2;
    const bl = joint(b, [0, 1.8, 0]);
    bl.rotation.y = 0.3;
    part(bl, G.box(0.5, 3.2, 0.05), i % 2 ? m.cloth : m.scrap, {});
    part(bl, G.cyl(0.035, 0.035, 3.5, 6), m.metalDark, { p: [0, 0.05, -0.05] });
    for (const y of [-1.0, 0.4, 1.4]) part(bl, G.box(0.56, 0.06, 0.07), m.metalDark, { p: [0, y, 0] });
  }
  part(rb, G.cyl(0.3, 0.3, 0.3, 14), m.voraxGold, { r: [Math.PI / 2, 0, 0] });
  part(rb, G.cone(0.2, 0.3, 14), m.voraxGold, { p: [0, 0, 0.3], r: [Math.PI / 2, 0, 0] });
  const rotor = compact(rb, 'windmill-rotor', { shadow: true });
  rotor.position.set(0, 0, 0.9);
  head.add(rotor);
  L.every((dt) => { rotor.rotation.z += dt * 1.6; });
}

// Fanions tendus entre deux points : cordelette qui pend en chaînette, fanions de toile à ourlet, gonflés et un peu
// de travers
const pennantGeo = (() => {
  let g = null;
  return () => {
    if (g) return g;
    // triangle 0,44 × 0,5 subdivisé (bombé en son milieu), pointe en bas, haut à y = 0
    const rows = 4, pos = [], uv = [];
    const P = (u, v) => { const w = 0.22 * (1 - v); const x = (u - 0.5) * 2 * w; const y = -0.5 * v; const z = Math.sin(Math.PI * u) * 0.04 * (1 - v) * Math.sin(Math.PI * Math.min(1, v * 1.6 + 0.2)); return [x, y, z]; };
    for (let r = 0; r < rows; r++) {
      const v0 = r / rows, v1 = (r + 1) / rows;
      for (let c = 0; c < 4; c++) {
        const u0 = c / 4, u1 = (c + 1) / 4;
        const a = P(u0, v0), b = P(u1, v0), d = P(u0, v1), e = P(u1, v1);
        pos.push(...a, ...d, ...b, ...b, ...d, ...e);
        uv.push(u0, 1 - v0, u0, 1 - v1, u1, 1 - v0, u1, 1 - v0, u0, 1 - v1, u1, 1 - v1);
      }
    }
    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    // ourlet replié sur la cordelette
    g = mergeGeometries([g, G.box(0.46, 0.05, 0.025).toNonIndexed().translate(0, -0.015, 0)].map((x) => { x.deleteAttribute('color'); return x; }));
    g.userData.shared = true;
    return g;
  };
})();
// o.sag : flèche au milieu (m)
export function bunting(L, a, b, colors = ['#ff4f6d', '#ffd23a', '#3ef2ff', '#4dffa0'], o = {}) {
  const n = Math.ceil(a.distanceTo(b) / 0.9);
  const dir = new THREE.Vector3().subVectors(b, a).setY(0).normalize();
  const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
  const sag = (t) => new THREE.Vector3().lerpVectors(a, b, t).setY(a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * (o.sag ?? 1.0));
  const pts = [];
  for (let i = 0; i <= n * 3; i++) pts.push(sag(i / (n * 3)));
  L.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 3, 0.016, 4, false), mat('#3a3030', { rough: 0.9 }), null);
  const R = mkRng(Math.floor(a.x * 13 + a.z * 7 + b.x));
  const mm = new THREE.Matrix4(), rot = new THREE.Matrix4(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 1; i < n; i++) {
    const p = sag(i / n);
    rot.makeBasis(dir, up, side).multiply(new THREE.Matrix4().makeRotationX((R() - 0.5) * 0.5)).multiply(new THREE.Matrix4().makeRotationZ((R() - 0.5) * 0.12));
    mm.copy(rot).setPosition(p);
    L.add(pennantGeo(), mat(colors[i % colors.length], { rough: 0.85, side: THREE.DoubleSide }), mm);
  }
}

// Vaisseau de Kobi : « La Bricole » (fusée rétro bricolée). o.ground(x, z) : hauteur du terrain sous un point (les
// patins s'y calent), à fournir par le niveau quand il pose le vaisseau sur un terrain
export function kobiShip(parent, o = {}) {
  const grp = new THREE.Group();
  const hullTex = metalTexture('#e9dcc2', 'metal-ship', { grid: 2, rust: 0.12 });
  // carrosserie laquée, comme un jouet en tôle peinte
  const body = mat('#ffffff', { map: hullTex.map, normalMap: hullTex.normalMap, rough: 0.5, metal: 0.35, coat: 0.7, coatRough: 0.08 });
  const red = mat('#e2453a', { rough: 0.45, metal: 0.35, coat: 0.9 });
  const blue = mat('#3f4fc9', { rough: 0.45, metal: 0.4, coat: 0.9 });
  const yellow = mat('#ffc23a', { rough: 0.4, metal: 0.5, coat: 0.8 });
  const dark = mat('#2a2438', { rough: 0.4, metal: 0.6, coat: 0.4 });
  const steel = mat('#b8c2d6', { rough: 0.3, metal: 0.9 });
  const glass = mat('#7fe8ff', { rough: 0.05, metal: 0.2, emissive: '#1a6f90', emissiveIntensity: 0.45, transparent: true, opacity: 0.75 });
  const hull = [[0.0, -3.2], [0.6, -3.0], [1.2, -2.2], [1.5, -0.8], [1.45, 0.8], [1.1, 2.2], [0.5, 3.1], [0.0, 3.3]];
  const hullMesh = part(grp, G.lathe('kship', hull, 32), body, { r: [Math.PI / 2, 0, 0], p: [0, 1.7, 0], outline: 0.03 });
  // ventre rouge
  part(grp, G.ellipsoid(1.38, 0.75, 2.9, 28, 12), red, { p: [0, 1.25, 0] });
  part(grp, G.torus(1.47, 0.11, 8, 32), yellow, { p: [0, 1.7, 0.6] });
  part(grp, G.torus(1.32, 0.09, 8, 32), yellow, { p: [0, 1.7, -1.6] });
  // hublots
  for (const s2 of [-1, 1]) for (const z of [-0.6, 0.2]) {
    part(grp, G.torus(0.22, 0.05, 6, 16), steel, { p: [s2 * 1.47, 2.0, z], r: [0, Math.PI / 2, 0] });
    part(grp, G.cyl(0.19, 0.19, 0.04, 16), glass, { p: [s2 * 1.47, 2.0, z], r: [0, 0, Math.PI / 2] });
  }
  // cockpit
  part(grp, G.ellipsoid(0.95, 0.75, 1.35, 22, 14), glass, { p: [0, 2.75, 1.05] });
  part(grp, G.torus(0.92, 0.07, 6, 28), steel, { p: [0, 2.4, 1.05], r: [Math.PI / 2, 0, 0], s: [1, 1.42, 1] });
  // ailes en flèche
  for (const s2 of [-1, 1]) {
    const wing = joint(grp, [s2 * 1.3, 1.45, -0.6]);
    wing.rotation.set(0, s2 * -0.2, s2 * -0.12);
    part(wing, G.rbox(2.6, 0.2, 1.9, 0.08), blue, { p: [s2 * 1.1, 0, 0] });
    part(wing, G.rbox(0.4, 0.18, 1.55, 0.06), yellow, { p: [s2 * 2.0, 0, 0] });
    // nacelle moteur
    const nac = joint(grp, [s2 * 2.05, 1.25, -1.5]);
    part(nac, G.cyl(0.42, 0.36, 1.8, 16), red, { r: [Math.PI / 2, 0, 0], outline: 0.02 });
    part(nac, G.torus(0.42, 0.06, 6, 18), steel, { p: [0, 0, 0.9] });
    part(nac, G.cyl(0.3, 0.3, 0.05, 16), dark, { p: [0, 0, 0.92], r: [Math.PI / 2, 0, 0] });
    part(nac, G.torus(0.33, 0.05, 6, 18), glow('#7fd8ff', 1.6), { p: [0, 0, -0.92] });
  }
  // dérive avec l'écrou emblème
  const finTop = joint(grp, [0, 3.0, -2.2]);
  finTop.rotation.x = -0.35;
  part(finTop, G.rbox(0.18, 1.5, 1.4, 0.08), blue, { p: [0, 0.45, 0] });
  part(finTop, G.rbox(0.2, 0.3, 1.45, 0.06), yellow, { p: [0, 1.1, 0] });
  part(finTop, G.nut(0.3, 0.08), mat('#ffd23a', { metal: 0.8, rough: 0.3 }), { p: [0.12, 0.45, 0], r: [0, Math.PI / 2, 0] });
  part(finTop, G.nut(0.3, 0.08), mat('#ffd23a', { metal: 0.8, rough: 0.3 }), { p: [-0.12, 0.45, 0], r: [0, Math.PI / 2, 0] });
  // antenne
  part(grp, G.cyl(0.03, 0.03, 0.9, 6), steel, { p: [0.5, 3.2, 0.2], r: [0, 0, -0.3] });
  part(grp, G.sphere(0.08, 8, 6), glow('#ff5a4a', 3), { p: [0.64, 3.62, 0.2] });
  // tuyère
  part(grp, G.cyl(0.9, 1.15, 0.9, 20), dark, { p: [0, 1.7, -3.35], r: [Math.PI / 2, 0, 0] });
  part(grp, G.cyl(0.7, 0.7, 0.1, 20), glow('#5ab8ff', 1.2), { p: [0, 1.7, -3.82], r: [Math.PI / 2, 0, 0] });
  const flame = part(grp, G.cone(0.75, 2.4, 16), glow('#7fd8ff', 3), { p: [0, 1.7, -5.0], r: [-Math.PI / 2, 0, 0], shadow: false });
  flame.visible = !!o.flame;
  // trains d'atterrissage hydrauliques
  const gear = [];
  for (const [x, z] of [[-1.15, 1.3], [1.15, 1.3], [0, -2.1]]) {
    part(grp, G.cyl(0.13, 0.13, 0.9, 8), steel, { p: [x, 0.75, z] });
    const rod = part(grp, G.cyl(0.08, 0.08, 0.7, 8), dark, { p: [x, 0.3, z] });
    const pad = part(grp, G.cyl(0.42, 0.48, 0.14, 14), dark, { p: [x, 0.07, z] });
    gear.push({ x, z, rod, pad });
  }
  // vérins télescopiques : posé sur un terrain en pente, chaque patin descend jusqu'au sol sous tout son pourtour
  // (il flottait jusqu'à 15 cm côté aval) ; le vaisseau et ses collisions ne bougent pas. Recalculé quand le vaisseau
  // bouge (vaisseau de sortie qui se pose) ; loin du sol (en vol) ou sans terrain (Station, îles), jambes rentrées.
  const last = new Float64Array(16).fill(NaN), gv = new THREE.Vector3(), ground = o.ground;
  if (ground) hullMesh.onBeforeRender = () => {
    const me = grp.matrixWorld.elements;
    let same = true;
    for (let i = 0; i < 16; i++) if (last[i] !== me[i]) { same = false; last[i] = me[i]; }
    if (same) return;
    const sy = Math.hypot(me[4], me[5], me[6]) || 1;
    for (const g of gear) {
      let gap = -Infinity;
      for (let k = 0; k <= 8; k++) {
        const r = k < 8 ? 0.47 : 0, a = k * Math.PI / 4;
        gv.set(g.x + Math.cos(a) * r, 0, g.z + Math.sin(a) * r).applyMatrix4(grp.matrixWorld);
        gap = Math.max(gap, gv.y - ground(gv.x, gv.z));
      }
      const ext = gap > 0.005 && gap < 0.6 ? Math.min(gap + 0.02, 0.45) / sy : 0;
      g.pad.position.y = 0.07 - ext;
      g.rod.scale.y = (0.7 + ext) / 0.7;
      g.rod.position.y = 0.65 - (0.7 + ext) / 2;
    }
  };
  grp.userData.flame = flame;
  if (parent) parent.add(grp);
  return grp;
}
