// Givrelune, la lune glacée : sapins, igloos, piliers et éclats de glace, congères, bonhomme de neige, foreuse du
// Baron, piste de glisse, paroi rainurée pour le saut mural (utilisée aussi ailleurs), plaques de glace flottantes,
// projecteurs de chantier, paillettes de la neige.
import * as THREE from 'three';
import { G, mtx, mergeGeometries } from '../geo.js';
import { mat, glow, terrainMaterial } from '../../engine/materials.js';
import { rockTexture, snowTexture, iceTexture, paintedMetalTexture, treadPlateTexture, barkTexture } from '../../engine/textures.js';
import { BoxCollider, CylinderCollider } from '../../engine/physics.js';
import { noise3, fbm2, clamp, rng as mkRng } from '../../engine/util.js';
import { lights } from '../../engine/lightpool.js';
import { foliage } from '../../engine/shading.js';
import { plankBox, beam } from './props.js';
import { boxUV } from '../../levels/level.js';

let M = null;
function mats() {
  if (M) return M;
  const snow = snowTexture(), ice = iceTexture(), iceRock = rockTexture('ice');
  M = {
    snow: mat('#ffffff', { map: snow.map, normalMap: snow.normalMap, rough: 0.85, normalScale: 0.6 }),
    ice: mat('#ffffff', { map: ice.map, normalMap: ice.normalMap, rough: 0.12, metal: 0.15, normalScale: 0.4 }),
    iceGlow: mat('#9ad8ff', { rough: 0.05, metal: 0.2, emissive: '#2a8ac8', emissiveIntensity: 0.55 }),
    // tranche d'une dalle de glace : claire, un peu de lumière la traverse
    iceEdge: mat('#d4f0ff', { rough: 0.16, metal: 0.05, emissive: '#3a8cc8', emissiveIntensity: 0.22 }),
    floe: mat('#dcf4ff', { rough: 0.28, emissive: '#2a6a9a', emissiveIntensity: 0.12 }),
    iceRock: terrainMaterial({ mapA: snow.map, mapB: iceRock.map, normalA: snow.normalMap, normalB: iceRock.normalMap, scaleA: 0.18, scaleB: 0.12, slopeLo: 0.62, slopeHi: 0.8 }),
    // aiguilles : un peu de lumière les traverse à contre-jour
    pine: foliage(mat('#2a5a4a', { rough: 0.8, unique: true }), 0.6),
    pineDark: foliage(mat('#1e4038', { rough: 0.85, unique: true }), 0.6),
    trunk: mat('#5a3a2a', { rough: 0.9 }),
    carrot: mat('#ff8a2a', { rough: 0.6 }),
    coal: mat('#1a1a22', { rough: 0.5 }),
    scarf: mat('#ef3e4a', { rough: 0.7 }),
    vorax: mat('#6a2bd0', { rough: 0.35, metal: 0.5 }),
    voraxD: mat('#3a1a70', { rough: 0.4, metal: 0.6 }),
    steel: mat('#b8c2d6', { rough: 0.3, metal: 0.9 }),
    darkMetal: mat('#2a2438', { rough: 0.4, metal: 0.7 }),
    gold: mat('#ffcc33', { rough: 0.25, metal: 0.85 }),
    pinkGlow: glow('#ff4fa0', 2.2),
    cyanGlow: glow('#7ff3ff', 2.4),
  };
  for (const k of Object.keys(M)) M[k].userData.shared = true;
  return M;
}
export function iceMats() { return mats(); }

let seedState = 1;
const R = () => { seedState = (seedState * 16807) % 2147483647; return (seedState - 1) / 2147483646; };
const seed = (s) => { seedState = Math.max(1, Math.floor(s * 7919) % 2147483646); };
const TAU = Math.PI * 2;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const hashPos = (p, k = 1) => (Math.floor(Math.abs(p.x * 73.1 + p.z * 37.7 + p.y * 11.3) * k) % 100000) + 1;
// Terrain le plus bas sur un cercle de rayon r autour de (x, z) (et en son centre) ; null sans terrain ou hors terrain
function groundMin(L, x, z, r, n = 8) {
  const hf = L.heightfield;
  if (!hf || !hf.inside(x, z)) return null;
  let mn = hf.height(x, z);
  for (let k = 0; k < n; k++) { const a = (k / n) * TAU; mn = Math.min(mn, hf.height(x + Math.cos(a) * r, z + Math.sin(a) * r)); }
  return mn;
}

// ---------------------------------------------------------------------------------------------------------------------
// Aides locales : pièces fusionnées par matière, matières propres à Givrelune (briques de neige, profilés peints du
// Baron, fissures de glace…), géométries paramétriques (blocs bombés, balayages de profil)
// ---------------------------------------------------------------------------------------------------------------------
const ni = (g) => (g.index ? g.toNonIndexed() : g);
// Accumulateur : put(matière, géométrie neuve) puis put.flush(L, matrice) pose une géométrie fusionnée par matière
function parts() {
  const map = new Map();
  const put = (mt, g) => { let l = map.get(mt); if (!l) map.set(mt, (l = [])); l.push(ni(g)); return g; };
  put.build = () => {
    const out = [];
    for (const [mt, l] of map) {
      const g = mergeGeometries(l);
      for (const p of l) if (p !== g) p.dispose();
      g.userData.shared = true;
      out.push([mt, g]);
    }
    map.clear();
    return out;
  };
  put.flush = (L, M) => { for (const [mt, g] of put.build()) L.add(g, mt, M); };
  return put;
}
// UV en mètres × s, projetées sur l'axe dominant de la normale (géométrie non indexée ou indexée)
function metricUV(g, s = 0.5) {
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); } else if (ax >= az) { u = p.getZ(i); v = p.getY(i); } else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u * s; uv[i * 2 + 1] = v * s;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
// Grille (rows × cols) de sommets pos(i, j) → [x, y, z], uv(i, j) → [u, v] ; normales lissées. out : point de contrôle
// pour l'orientation (une normale de la grille doit pointer vers out depuis le sommet de contrôle ctl = [i, j])
function gridGeo(rows, cols, pos, uv, ctl, out) {
  const P = [], U = [], I = [];
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { P.push(...pos(i, j)); U.push(...uv(i, j)); }
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols - 1; j++) {
    const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
    I.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setIndex(I);
  g.computeVertexNormals();
  if (ctl) {
    const k = ctl[0] * cols + ctl[1], n = g.attributes.normal, p = g.attributes.position;
    const dot = n.getX(k) * (out[0] - p.getX(k)) + n.getY(k) * (out[1] - p.getY(k)) + n.getZ(k) * (out[2] - p.getZ(k));
    if (dot < 0) {
      for (let t = 0; t < I.length; t += 3) { const s = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = s; }
      g.setIndex(I);
      g.computeVertexNormals();
    }
  }
  return g;
}
// Bloc bombé sur une surface paramétrique S(s, t) → { p, n } (s, t ∈ [0, 1]) : arêtes rentrées de inset, cœur bombé
// de puff (bloc de neige taillé, pierre, voussoir) ; ns × nt segments
const bump = (x) => 1 - Math.pow(Math.abs(2 * x - 1), 4);
function pillow(S, ns, nt, inset, puff, uvS = 0.5) {
  const _p = new THREE.Vector3();
  const c = S(0.5, 0.5), out = c.p.clone().addScaledVector(c.n, 1);
  const g = gridGeo(ns + 1, nt + 1, (i, j) => {
    const s = i / ns, t = j / nt, { p, n } = S(s, t);
    const d = -inset + (inset + puff) * bump(s) * bump(t);
    _p.copy(p).addScaledVector(n, d);
    return [_p.x, _p.y, _p.z];
  }, () => [0, 0], [ns >> 1, nt >> 1], [out.x, out.y, out.z]);
  // UV projetées sur la normale du cœur du bloc (pas de couture au milieu d'un bloc)
  const p = g.attributes.position, uv = g.attributes.uv;
  const ax = Math.abs(c.n.x), ay = Math.abs(c.n.y), az = Math.abs(c.n.z);
  for (let i = 0; i < p.count; i++) {
    const [u, v] = ay >= ax && ay >= az ? [p.getX(i), p.getZ(i)] : ax >= az ? [p.getZ(i), p.getY(i)] : [p.getX(i), p.getY(i)];
    uv.setXY(i, u * uvS, v * uvS);
  }
  return g;
}
// Bosselage : chaque sommet poussé le long de sa normale par un bruit (congères, boules de neige) ; amp en mètres
function lumpy(g, amp, k = 1, f = 1.6) {
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = (noise3(x * f + k * 3.1, y * f, z * f, k) - 0.5) * amp + (noise3(x * f * 3, y * f * 3, z * f * 3, k + 7) - 0.5) * amp * 0.3;
    p.setXYZ(i, x + n.getX(i) * d, y + n.getY(i) * d, z + n.getZ(i) * d);
  }
  g.computeVertexNormals();
  return g;
}
// Boîte aux arêtes chanfreinées (c), UV en mètres × uvS
function chamferBox(w, h, d, c = 0.03, uvS = 0.5) {
  const x = w / 2 - c, y = h / 2 - c;
  const sh = new THREE.Shape();
  sh.moveTo(-x + c, -y); sh.lineTo(x - c, -y); sh.lineTo(x, -y + c); sh.lineTo(x, y - c); sh.lineTo(x - c, y);
  sh.lineTo(-x + c, y); sh.lineTo(-x, y - c); sh.lineTo(-x, -y + c); sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.001, d - 2 * c), bevelEnabled: true, bevelThickness: c, bevelSize: c, bevelSegments: 1, curveSegments: 1 });
  g.translate(0, 0, -(d - 2 * c) / 2);
  g.clearGroups();
  return metricUV(ni(g), uvS);
}
// Tête de boulon hexagonale tournée vers +Y (six pans et dessus, 18 triangles), posée en (x, y, z) selon la normale nrm
const _bq = new THREE.Quaternion(), _bY = new THREE.Vector3(0, 1, 0), _bN = new THREE.Vector3();
const boltCache = new Map();
function boltHead(r) {
  if (!boltCache.has(r)) {
    const side = new THREE.CylinderGeometry(r, r * 1.12, r * 0.75, 6, 1, true).toNonIndexed();
    const cap = new THREE.CircleGeometry(r, 6).rotateX(-Math.PI / 2).translate(0, r * 0.375, 0).toNonIndexed();
    const g = mergeGeometries([side, cap]).translate(0, r * 0.3, 0);
    boltCache.set(r, g);
  }
  return boltCache.get(r);
}
function bolts(list, pts, nrm, r = 0.03) {
  _bq.setFromUnitVectors(_bY, _bN.set(nrm[0], nrm[1], nrm[2]).normalize());
  for (const [x, y, z] of pts) list.push(boltHead(r).clone().applyQuaternion(_bq).translate(x, y, z));
  return list;
}
// Plat de fer de a à b, largeur w, épaisseur t, face tournée vers nrm (croisillons, ferrures)
function flatBar(a, b, w, t, nrm, uOff = 0) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  d.normalize();
  const z = nrm.clone().addScaledVector(d, -nrm.dot(d)).normalize();
  const x = new THREE.Vector3().crossVectors(d, z);
  return plankBox(w, len, t, 0.5, uOff).applyMatrix4(new THREE.Matrix4().makeBasis(x, d, z).setPosition(a.clone().add(b).multiplyScalar(0.5)));
}

// Textures locales (canvas, raccordables en u) : profilés peints du Baron
const TEX = new Map();
const hexc = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
const mix3 = (o, a, b, t) => { o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; return o; };
const sst = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function canvasTex(key, size, fn, nStr) {
  if (TEX.has(key)) return TEX.get(key);
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = size; return c; };
  const cv = mk(), ctx = cv.getContext('2d'), img = ctx.createImageData(size, size);
  const H = new Float32Array(size * size), out = [0, 0, 0];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    H[y * size + x] = fn(x / size, y / size, out) ?? 0.5;
    const i = (y * size + x) * 4;
    img.data[i] = clamp(out[0], 0, 1) * 255; img.data[i + 1] = clamp(out[1], 0, 1) * 255; img.data[i + 2] = clamp(out[2], 0, 1) * 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const nc = mk(), nctx = nc.getContext('2d'), nimg = nctx.createImageData(size, size);
  const h = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (h(x + 1, y) - h(x - 1, y)) * nStr, dy = (h(x, y + 1) - h(x, y - 1)) * nStr, l = Math.hypot(dx, dy, 1);
    const i = (y * size + x) * 4;
    nimg.data[i] = (-dx / l * 0.5 + 0.5) * 255; nimg.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; nimg.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; nimg.data[i + 3] = 255;
  }
  nctx.putImageData(nimg, 0, 0);
  const tex = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.userData.shared = true;
    return t;
  };
  const res = { map: tex(cv, true), normalMap: tex(nc, false) };
  TEX.set(key, res);
  return res;
}
// Profilé peint (cornière, plat, tube) : à poser avec plankBox (u le long de la pièce, en mètres × 0,5 ; v en travers,
// de 0 à 1). La peinture saute le long des arêtes de la pièce, coulures de crasse dans le sens de la longueur.
function beamPaint(color, key) {
  const base = hexc(color);
  const deep = base.map((c) => c * 0.78), pale = base.map((c) => Math.min(1, c * 1.18 + 0.05)), rimC = base.map((c) => c * 0.42);
  const bare = hexc('#bcc3d2'), bareD = bare.map((c) => c * 0.62), dirt = hexc('#221a2a');
  return canvasTex('givre-beam-' + key, 256, (u, v, o) => {
    const n = fbm2(u * 6, v * 2, 4, 601, 6);
    mix3(o, deep, pale, clamp(0.42 + (n - 0.5) * 1.3, 0, 1));
    const e = Math.min(v, 1 - v);
    const cn = fbm2(u * 24, v * 4, 4, 607, 24), cn2 = fbm2(u * 48, v * 8, 2, 609, 48);
    const s = cn + (sst(0.13, 0, e) * 0.2 + sst(0.04, 0, e) * 0.24) * (0.3 + cn2 * 0.9);
    let h = 0.6;
    if (s > 0.9) { mix3(o, bareD, bare, 0.35 + cn2 * 0.65); h = 0.4; } else if (s > 0.86) { mix3(o, o, rimC, 0.75); h = 0.68; }
    const st = fbm2(u * 12, v * 12, 3, 613, 12);
    mix3(o, o, dirt, clamp((st - 0.58) * 2.2, 0, 0.5));
    return h;
  }, 2.2);
}

let X = null;
function xmats() {
  if (X) return X;
  const snow = snowTexture(), ice = iceTexture();
  const tm = (t, o) => mat('#ffffff', { map: t.map, normalMap: t.normalMap, ...o });
  const blk = (c) => mat(c, { map: snow.map, normalMap: snow.normalMap, rough: 0.8, normalScale: 0.7 });
  X = {
    // briques de neige taillées (trois teintes à peine différentes), joints creux dans l'ombre, intérieur sombre
    blockA: blk('#fdfeff'), blockB: blk('#eef4fc'), blockC: blk('#e2ecf8'),
    joint: mat('#7a96c0', { map: snow.map, rough: 0.95, rim: 0 }),
    hollow: mat('#33466e', { rough: 0.95, side: THREE.DoubleSide, rim: 0 }),
    hollowEnd: mat('#0e1830', { rough: 1, rim: 0 }),
    // profilés du Baron (violet sombre des jambes, violet vif des traverses), tôles de la tête
    violet: tm(beamPaint('#6a2bd0', 'vx'), { rough: 0.42, metal: 0.45 }),
    violetD: tm(beamPaint('#48218a', 'vxd'), { rough: 0.48, metal: 0.5 }),
    capPaint: tm(paintedMetalTexture('#2c2640', 'givre-cap', { chip: 0.3, edge: 0.8, rust: 0.12, bare: '#a8aec0' }), { rough: 0.5, metal: 0.55 }),
    tread: tm(treadPlateTexture('#5c5872', 'givre-tread'), { rough: 0.42, metal: 0.7 }),
    iron: mat('#2b2734', { rough: 0.5, metal: 0.65 }),
    grille: mat('#1c1a24', { rough: 0.45, metal: 0.7 }),
    concrete: mat('#a3a8b6', { rough: 0.92 }),
    // fissures de glace : fines lignes claires, un peu lumineuses
    crack: mat('#f0fcff', { rough: 0.1, emissive: '#6cc8ff', emissiveIntensity: 0.5 }),
    iceUnder: mat('#a6d4f2', { map: ice.map, normalMap: ice.normalMap, rough: 0.2, metal: 0.1, rim: 0 }),
    bark: tm(barkTexture(), { rough: 0.9 }),
    knit: mat('#ef3e4a', { rough: 0.95, sheen: 0.7, sheenColor: '#ffc0c0' }),
    knitW: mat('#f6f1ea', { rough: 0.95, sheen: 0.7, sheenColor: '#ffffff' }),
  };
  for (const k of Object.keys(X)) X[k].userData.shared = true;
  return X;
}

// Sapin enneigé : étages de cônes et chapeaux de neige
export function pine(L, pos, scale = 1, s = 1) {
  const m = mats();
  seed(s);
  const h = (4 + R() * 2.5) * scale;
  // tronc planté jusque sous le terrain le plus bas autour de son pied (pente, rebord de falaise)
  const gm = groundMin(L, pos.x, pos.z, 0.3 * scale);
  const tTop = pos.y + h * 0.345, tBot = pos.y - (gm !== null && pos.y - gm < 2 ? Math.max(0.05, pos.y - gm + 0.08) : 0.05);
  L.add(G.cyl(0.18 * scale, 0.28 * scale, tTop - tBot, 8), m.trunk, mtx([pos.x, (tTop + tBot) / 2, pos.z]));
  const layers = 4;
  for (let i = 0; i < layers; i++) {
    const t = i / layers;
    const r = (1.6 - t * 1.1) * scale, ch = (1.7 - t * 0.5) * scale;
    const y = pos.y + h * 0.25 + t * h * 0.62;
    const ry = R() * 6;
    L.add(G.cone(r, ch, 9), i % 2 ? m.pineDark : m.pine, mtx([pos.x, y + ch / 2, pos.z], [0, ry, 0]));
    L.add(G.cone(r * 0.82, ch * 0.42, 9), m.snow, mtx([pos.x, y + ch * 0.82, pos.z], [0, ry, 0]));
  }
  L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y, pos.y + h, 0.45 * scale, { surface: 'grass' }));
}

// Igloo de briques de neige, avec tunnel d'entrée ; o.warm : habité (entrée et fenêtre de glace éclairées par le
// feu, lumière chaude qui vacille)
export function igloo(L, pos, yaw = 0, r = 2.6, o = {}) {
  const m = mats(), X = xmats();
  const put = parts();
  const rnd = mkRng(hashPos(pos, 7));
  const Y0 = -0.1, gap = 0.024, inset = 0.05, puff = 0.035;
  const tint = () => [X.blockA, X.blockB, X.blockC][Math.floor(rnd() * 3)];
  // dôme de fond (joints creux, dans l'ombre) sous les briques : juste sous leurs arêtes rentrées, qui y reposent
  // (maillage fin : ses facettes ne s'écartent pas des arêtes)
  put(X.joint, new THREE.SphereGeometry(r - inset - 0.003, 56, 20, 0, TAU, 0, Math.PI / 2).translate(0, Y0, 0));
  // briques posées en spirale : une seule rangée qui monte d'un tour à l'autre (bord bas de la première en biseau)
  const dE = 0.52 / r, eTop = Math.PI / 2 - 0.5 / r;
  const B = (f) => (f < 0 ? 0 : Math.max((f / TAU) * dE, 0.34 * dE));
  const sph = (f, e, rr = r) => ({ p: V3(rr * Math.cos(e) * Math.sin(f), Y0 + rr * Math.sin(e), rr * Math.cos(e) * Math.cos(f)), n: V3(Math.cos(e) * Math.sin(f), Math.sin(e), Math.cos(e) * Math.cos(f)) });
  const ge = gap / r / 2;
  let F = rnd() * 0.5;
  while (B(F - TAU) < eTop - 0.02) {
    const em = Math.min(eTop, (B(F - TAU) + B(F)) / 2);
    const dF = (0.78 + rnd() * 0.3) / (r * Math.cos(em));
    const f0 = F, f1 = F + dF, gf = gap / (2 * r * Math.cos(em));
    const lo = (f) => B(f - TAU) + ge, hi = (f) => Math.min(B(f), eTop) - ge;
    if (hi((f0 + f1) / 2) - lo((f0 + f1) / 2) > 0.2 * dE) {
      const ns = Math.max(4, Math.round(dF * r * Math.cos(em) / 0.17));
      put(tint(), pillow((s, t) => { const f = f0 + gf + (f1 - f0 - 2 * gf) * s; return sph(f, lo(f) + (hi(f) - lo(f)) * t); }, ns, 3, inset, puff * (0.8 + rnd() * 0.5)));
    }
    F = f1;
  }
  // clef de voûte : bloc rond au sommet
  put(X.blockA, gridGeo(5, 25, (j, i) => {
    const t = j / 4, f = (i / 24) * TAU, e = eTop + ge + (Math.PI / 2 - eTop - ge) * t;
    const d = -inset + (inset + puff * 0.7) * (1 - Math.pow(1 - t, 4));
    const { p, n } = sph(f, e);
    return [p.x + n.x * d, p.y + n.y * d, p.z + n.z * d];
  }, (j, i) => [Math.cos((i / 24) * TAU) * j * 0.12, Math.sin((i / 24) * TAU) * j * 0.12], [2, 3], [0, Y0 + r * 3, 0]));
  // tunnel d'entrée en briques (vers +z) : voûte en demi-cylindre, anneaux décalés, front en voussoirs
  const rt = r * 0.42, z0 = r * 0.82, z1 = r * 1.4, th = 0.3, ri = rt - th;
  const cyl = (a, z, rr = rt) => ({ p: V3(rr * Math.cos(a), rr * Math.sin(a), z), n: V3(Math.cos(a), Math.sin(a), 0) });
  put(X.joint, new THREE.CylinderGeometry(rt - inset - 0.003, rt - inset - 0.003, z1 - z0, 28, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2).translate(0, 0, (z0 + z1) / 2));
  // front du tunnel : joint plein derrière les voussoirs, entre la voûte intérieure et la voûte de briques
  put(X.joint, new THREE.RingGeometry(ri, rt - inset - 0.003, 28, 1, 0, Math.PI).translate(0, 0, z1 - inset * 0.6 - 0.003));
  const nRing = Math.max(2, Math.round((z1 - z0) / 0.5)), nA = 5, ga = gap / rt / 2, gz = gap / 2;
  for (let j = 0; j < nRing; j++) {
    const za = z0 + ((z1 - z0) * j) / nRing + gz, zb = z0 + ((z1 - z0) * (j + 1)) / nRing - gz;
    const off = j % 2 ? 0.5 : 0;
    for (let k = -off; k < nA; k++) {
      const a0 = Math.max(0, (k / nA) * Math.PI) + ga, a1 = Math.min(Math.PI, ((k + 1) / nA) * Math.PI) - ga;
      if (a1 - a0 < 0.12) continue;
      put(tint(), pillow((s, t) => cyl(a0 + (a1 - a0) * s, za + (zb - za) * t), 4, 3, inset, puff));
    }
  }
  for (let k = 0; k < nA - 1; k++) {
    const a0 = (k / (nA - 1)) * Math.PI + ga, a1 = ((k + 1) / (nA - 1)) * Math.PI - ga;
    put(tint(), pillow((s, t) => { const a = a0 + (a1 - a0) * s, rr = ri + gz + (rt - ri - 2 * gz) * t; return { p: V3(rr * Math.cos(a), rr * Math.sin(a), z1), n: V3(0, 0, 1) }; }, 4, 3, inset * 0.6, puff));
  }
  // intérieur du tunnel : voûte et sol sombres, fond (lueur du feu si habité) juste devant le dôme (les briques bombées
  // du dôme ne percent pas le fond)
  const zIn = r + 0.07;
  put(X.hollow, new THREE.CylinderGeometry(ri, ri, z1 - zIn, 12, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2).translate(0, 0, (z1 + zIn) / 2));
  put(X.hollow, new THREE.PlaneGeometry(ri * 2, z1 - zIn).rotateX(-Math.PI / 2).translate(0, 0.02, (z1 + zIn) / 2));
  const warm = o.warm ? glow(o.warm, 1.2) : null;
  put(warm || X.hollowEnd, new THREE.CircleGeometry(ri, 14, 0, Math.PI).translate(0, 0, zIn));
  // bourrelet de neige soufflée au pied du dôme (ouvert devant le tunnel) et le long du tunnel
  const open = 2 * Math.asin(Math.min(0.95, rt / r));
  put(m.snow, lumpy(new THREE.TorusGeometry(r + 0.02, 0.3, 7, 56, TAU - open).rotateX(Math.PI / 2).rotateY(TAU - open / 2 - Math.PI / 2), 0.22, hashPos(pos)).scale(1, 0.36, 1).translate(0, -0.03, 0));
  // en pente : socle de neige tassée sous le bourrelet, le long du tunnel et devant l'entrée, jusqu'au terrain côté aval
  // (le terrain lu sous chaque point ; rien n'est ajouté là où le pied touche déjà le sol)
  const hf = L.heightfield, cyw = Math.cos(yaw), syw = Math.sin(yaw);
  const gAt = (x, z) => (hf ? hf.height(pos.x + x * cyw + z * syw, pos.z - x * syw + z * cyw) - pos.y : 0);
  const skirt = (pts, k) => {
    let worst = 0;
    const n = pts.length - 1;
    const cols = pts.map(([x, z, nx, nz, y0], j) => {
      // bouts effilés : la bande se resserre sur sa crête aux deux extrémités
      const w = Math.min(1, j / 1.6, (n - j) / 1.6);
      const at = (d) => [x + nx * (d * w - 0.1 * (1 - w)), z + nz * (d * w - 0.1 * (1 - w))];
      const drop = Math.max(0, y0 - gAt(...at(0.35)));
      worst = Math.max(worst, drop);
      const d2 = 0.24 + drop * 0.45, d3 = 0.34 + drop * 0.85;
      const y3 = Math.min(y0 - 0.12, gAt(...at(d3)) - 0.15), y2 = Math.min(y0 - 0.1, y0 - 0.06 + (y3 - y0 + 0.06) * 0.45);
      // côté aval, la crête recouvre le bourrelet (pas de lèvre en surplomb)
      const lift = clamp(drop / 0.2, 0, 1), yt = y0 + 0.02 + 0.04 * lift;
      const yw = (y) => yt + (y - yt) * w;
      return [[...at(-0.1), yt], [...at(0.18 + 0.12 * lift), yw(y0 - 0.06 + 0.02 * lift)], [...at(d2), yw(y2)], [...at(d3), yw(y3)]];
    });
    if (worst < 0.06) return;
    const [cx, cz, cnx, cnz, cy0] = pts[pts.length >> 1];
    put(m.snow, lumpy(gridGeo(4, cols.length, (i, j) => { const [x, z, y] = cols[j][i]; return [x, y, z]; }, (i, j) => [j * 0.4, i * 0.4], [1, cols.length >> 1], [cx + cnx * 3, cy0 + 2, cz + cnz * 3]), 0.07, k, 1.4));
  };
  const ring = [], rs = r + 0.12, nRs = 44;
  for (let i = 0; i <= nRs; i++) { const f = open / 2 + ((TAU - open) * i) / nRs; ring.push([Math.sin(f) * rs, Math.cos(f) * rs, Math.sin(f), Math.cos(f), -0.02]); }
  skirt(ring, hashPos(pos, 2));
  // tunnel : une seule bande qui longe un flanc, contourne le front (angles arrondis) et revient par l'autre flanc
  const zs0 = Math.sqrt(r * r - rt * rt) - 0.15, nTs = 6, tun = [];
  for (let i = 0; i <= nTs; i++) tun.push([rt, zs0 + ((z1 - zs0) * i) / nTs, 1, 0, 0]);
  for (let k = 1; k < 4; k++) tun.push([rt, z1, Math.cos((k * Math.PI) / 8), Math.sin((k * Math.PI) / 8), 0]);
  for (let i = 0; i <= nTs; i++) tun.push([rt - (2 * rt * i) / nTs, z1, 0, 1, 0]);
  for (let k = 1; k < 4; k++) tun.push([-rt, z1, -Math.sin((k * Math.PI) / 8), Math.cos((k * Math.PI) / 8), 0]);
  for (let i = 0; i <= nTs; i++) tun.push([-rt, z1 - ((z1 - zs0) * i) / nTs, -1, 0, 0]);
  skirt(tun, hashPos(pos, 3));
  if (warm) {
    // fenêtre : bloc de glace serti dans le dôme, de biais par rapport à l'entrée
    const a = o.window ?? 1.25, e = 0.5;
    const w = new THREE.Object3D();
    w.position.set(Math.sin(a) * Math.cos(e) * r * 0.99, Y0 + Math.sin(e) * r * 0.99, Math.cos(a) * Math.cos(e) * r * 0.99);
    w.lookAt(0, Y0, 0);
    w.updateMatrix();
    put(glow(o.warm, 2.2), G.rbox(r * 0.26, r * 0.2, 0.16, 0.04).clone().applyMatrix4(w.matrix));
  }
  put.flush(L, new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromAxisAngle(_bY, yaw), new THREE.Vector3(1, 1, 1)));
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  if (warm) lights.add({ pos: new THREE.Vector3(pos.x + fx * r * 1.75, pos.y + r * 0.3, pos.z + fz * r * 1.75), color: o.warm, intensity: 26, range: 9, flicker: 0.12, priority: 1.4 });
  L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y - 0.2, pos.y + r * 0.85, r * 0.92, { surface: 'snow' }));
  // tunnel d'entrée (voûte pleine, de la façade jusque dans le dôme)
  const tq = new THREE.Quaternion().setFromAxisAngle(_bY, yaw), tz0 = r * 0.8;
  L.game.world.add(new BoxCollider(new THREE.Vector3(0, (rt * 0.92 - 0.2) / 2, (tz0 + z1) / 2).applyQuaternion(tq).add(pos), new THREE.Vector3(rt + 0.02, (rt * 0.92 + 0.2) / 2, (z1 - tz0) / 2), tq, { surface: 'snow' }));
}

// Pilier de glace hexagonal (plateforme), chapeau de neige ; o.base : pied visible plus bas que la collision
// (pilier pris dans un lac gelé, vu à travers la glace)
// Coulée de neige (goutte allongée, pointe en bas, sommet à y = 0,05, hauteur 1) : à étirer par la matrice
let dripG = null;
function dripGeo() {
  if (!dripG) {
    dripG = new THREE.LatheGeometry([[0, 0.05], [0.75, 0.0], [1, -0.16], [0.86, -0.4], [0.52, -0.7], [0.22, -0.9], [0, -1]].map(([r, y]) => new THREE.Vector2(r, y)).reverse(), 10);
    dripG.userData.shared = true;
  }
  return dripG;
}
// Prisme de glace facetté : 12 arêtes par anneau (coins de l'hexagone et milieux des faces, bombés), anneaux tous les
// ~1,2 m légèrement tournés et décalés, facettes planes (ombrage par triangle) ; fissures claires sur quelques facettes
export function icePillar(L, pos, h, r = 1.4, o = {}) {
  const m = mats(), X = xmats();
  const bottom = o.bottom ?? pos.y - 30;
  const base = Math.min(bottom, o.base ?? bottom);
  const ry = o.ry ?? R() * 6;
  const rnd = mkRng(hashPos(pos, 5));
  const H = pos.y - base, nr = Math.max(3, Math.min(26, Math.round(H / 1.2)));
  const top = r * 0.96, foot = r * (o.taper ?? 1.15);
  const rings = [];
  for (let j = 0; j <= nr; j++) {
    const t = j / nr, edge = j === 0 || j === nr;
    const y = -H + H * t + (edge ? 0 : (rnd() - 0.5) * (H / nr) * 0.5);
    const rr = foot + (top - foot) * t, tw = edge ? 0 : (rnd() - 0.5) * 0.08;
    const pts = [];
    for (let k = 0; k < 12; k++) {
      const a = ry + (k * Math.PI) / 6 + tw;
      const rad = k % 2 ? rr * 0.866 * (1.09 + (edge ? 0 : (rnd() - 0.5) * 0.1)) : rr * (1 + (edge ? 0 : (rnd() - 0.5) * 0.09));
      pts.push([Math.sin(a) * rad, y + (edge ? 0 : (rnd() - 0.5) * 0.12), Math.cos(a) * rad]);
    }
    rings.push(pts);
  }
  const P = [], U = [], tris = [];
  const tri = (a, b, c) => { P.push(...a, ...b, ...c); tris.push([a, b, c]); for (const p of [a, b, c]) U.push(Math.atan2(p[0], p[2]) * r * 0.35, p[1] * 0.35); };
  for (let j = 0; j < nr; j++) for (let k = 0; k < 12; k++) {
    const a = rings[j][k], b = rings[j][(k + 1) % 12], c = rings[j + 1][(k + 1) % 12], d = rings[j + 1][k];
    if ((j + k) % 2) { tri(a, b, c); tri(a, c, d); } else { tri(a, b, d); tri(b, c, d); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.computeVertexNormals();
  const M = new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z);
  L.add(g, m.ice, M);
  // fissures : lignes brisées sur des facettes du haut (au-dessus du sol ou de la glace du lac)
  const cracks = [];
  const vis = Math.max(0, Math.floor(((o.base !== undefined ? H - (pos.y - bottom) : 0) / H) * nr));
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3(), _d = new THREE.Vector3(), _s = new THREE.Vector3();
  for (let c = 0; c < 7; c++) {
    const j = Math.min(nr - 1, vis + Math.floor(rnd() * Math.max(1, nr - vis))), k = Math.floor(rnd() * 12);
    const [A, B, C] = tris[(j * 12 + k) * 2 + (rnd() < 0.5 ? 0 : 1)];
    _a.fromArray(A); _b.fromArray(B); _c.fromArray(C);
    _n.subVectors(_b, _a).cross(_d.subVectors(_c, _a)).normalize();
    const p0 = _a.clone().lerp(_b, 0.3 + rnd() * 0.4), p1 = _c.clone().lerp(p0, 0.15 + rnd() * 0.2);
    const n = 5, pts = [];
    for (let i = 0; i <= n; i++) {
      const p = p0.clone().lerp(p1, i / n);
      _s.subVectors(p1, p0).cross(_n).normalize();
      if (i && i < n) p.addScaledVector(_s, (rnd() - 0.5) * 0.12);
      pts.push(p.addScaledVector(_n, 0.008));
    }
    for (let i = 0; i < n; i++) {
      _s.subVectors(pts[i + 1], pts[i]).cross(_n).normalize().multiplyScalar(0.018 * (1 - i / n * 0.6));
      const q0 = pts[i].clone().add(_s), q1 = pts[i].clone().sub(_s), q2 = pts[i + 1].clone().sub(_s), q3 = pts[i + 1].clone().add(_s);
      const cg = new THREE.BufferGeometry().setFromPoints([q0, q1, q2, q0, q2, q3]);
      cg.computeVertexNormals();
      if (cg.attributes.normal.getX(0) * _n.x + cg.attributes.normal.getY(0) * _n.y + cg.attributes.normal.getZ(0) * _n.z < 0) cg.setFromPoints([q0, q2, q1, q0, q3, q2]).computeVertexNormals();
      cg.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(12), 2));
      cracks.push(cg);
    }
  }
  L.add(mergeGeometries(cracks), X.crack, M);
  // chapeau de neige : coussin hexagonal arrondi qui déborde, coulées et glaçons sur les faces
  const ap = top * 0.866, hexR = (a) => ap / Math.cos(((((a - ry) % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3)) - Math.PI / 6);
  const prof = [[0.98, -0.17], [1.07, -0.1], [1.1, 0.03], [1.05, 0.15], [0.86, 0.22], [0.5, 0.245], [0, 0.25]];
  const ks = hashPos(pos) % 40;
  const cap = gridGeo(prof.length, 37, (i, jj) => {
    const a = ry + Math.PI / 6 + (jj / 36) * TAU, [f, y] = prof[i], rr = hexR(a) * f;
    const bumpY = i < prof.length - 1 ? (noise3(Math.sin(a) * 2 + ks, Math.cos(a) * 2, i * 0.3, 3) - 0.5) * 0.06 : 0;
    return [Math.sin(a) * rr, y + bumpY, Math.cos(a) * rr];
  }, (i, jj) => [jj / 36 * 4, i * 0.2], [5, 5], [0, 5, 0]);
  L.add(cap, m.snow, M);
  for (let s = 0; s < 6; s++) {
    const a = ry + Math.PI / 6 + (s * Math.PI) / 3, nd = 1 + Math.floor(rnd() * 2);
    for (let d = 0; d < nd; d++) {
      const off = (rnd() - 0.5) * top * 0.7, len = 0.22 + rnd() * 0.45, w = 0.12 + rnd() * 0.1;
      const cx = Math.sin(a) * ap * 1.06 + Math.cos(a) * off, cz = Math.cos(a) * ap * 1.06 - Math.sin(a) * off;
      L.add(dripGeo(), m.snow, mtx([pos.x + cx, pos.y - 0.1, pos.z + cz], [0, a, 0], [w, len, 0.06]));
    }
    if (rnd() < 0.7) {
      // glaçon contre la face du pilier (hors du renflement du milieu), pris dans le chapeau : sa base est dans la neige,
      // la pointe au même endroit qu'avant
      const u = rnd() - 0.5, off = Math.sign(u) * (0.22 + Math.abs(u) * 0.4) * top, len = 0.18 + rnd() * 0.35;
      const rr = top * (0.944 - 0.156 * Math.abs(off) / top) + 0.03, ln = len + 0.15;
      L.add(G.cone(0.045, ln, 5), m.ice, mtx([pos.x + Math.sin(a) * rr + Math.cos(a) * off, pos.y - 0.02 - ln / 2, pos.z + Math.cos(a) * rr - Math.sin(a) * off], [Math.PI, 0, 0]));
    }
  }
  L.game.world.add(new CylinderCollider(pos.x, pos.z, bottom, pos.y + 0.2, r * 0.95, { surface: o.surface || 'ice' }));
}

// Éclats de glace luminescents
export function iceShards(L, pos, n = 5, scale = 1, s = 3) {
  const m = mats();
  seed(s);
  for (let i = 0; i < n; i++) {
    const a = R() * 6.28, d = R() * 0.8 * scale;
    const h = (0.8 + R() * 1.8) * scale;
    // en pente, l'éclat descend jusque sous le terrain le plus bas de son pied (la pointe ne bouge pas)
    const cx = pos.x + Math.cos(a) * d, cz = pos.z + Math.sin(a) * d, gm = groundMin(L, cx, cz, 0.22 * scale + 0.08, 6);
    const hh = h + (gm !== null && pos.y > gm && pos.y - gm < 1 ? pos.y - gm : 0);
    L.add(new THREE.CylinderGeometry(0, 0.22 * scale, hh, 5), m.iceGlow, mtx([cx, pos.y + h - 0.1 - hh / 2, cz], [(R() - 0.5) * 0.6, R() * 6, (R() - 0.5) * 0.6]));
  }
  lights.add({ pos: new THREE.Vector3(pos.x, pos.y + 0.9 * scale, pos.z), color: '#4aa8ff', intensity: 10 * scale, range: 6 * scale, priority: 0.8 });
}

// Congère (rocher couvert de neige)
const driftGeoCache = [];

function driftGeo(k) {
  if (driftGeoCache[k]) return driftGeoCache[k];
  const g = new THREE.IcosahedronGeometry(1, 3);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    v.multiplyScalar(0.75 + noise3(v.x * 1.3 + k * 9, v.y * 1.3, v.z * 1.3, k) * 0.5);
    if (v.y < -0.2) v.y = -0.2;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  driftGeoCache[k] = g;
  return g;
}

// En pente : le bas de la congère (dessous plat et premier rang des flancs) descend jusque sous le terrain, sommet par
// sommet (copie de la géométrie partagée, seulement si nécessaire)
function driftOnGround(L, g, M, pos, sy) {
  const hf = L.heightfield;
  if (!hf || !hf.inside(pos.x, pos.z)) return g;
  const p = g.attributes.position, v = new THREE.Vector3(), low = pos.y - 0.2 * sy, out = new Float32Array(p.count);
  let any = false, worst = 0;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    if (v.y > 0.1) continue;
    v.applyMatrix4(M);
    const lift = low - (hf.height(v.x, v.z) - 0.06), w = clamp((0.1 - p.getY(i)) / 0.3, 0, 1);
    if (lift > 0.01) { out[i] = (lift * w) / sy; any = true; worst = Math.max(worst, lift); }
  }
  // congère plaquée contre une paroi (plus de 1,5 m de vide dessous) : rien à prolonger, elle est laissée telle quelle
  if (!any || worst > 1.5) return g;
  const c = g.clone();
  const cp = c.attributes.position;
  for (let i = 0; i < cp.count; i++) if (out[i]) cp.setY(i, cp.getY(i) - out[i]);
  c.computeVertexNormals();
  return c;
}

export function snowDrift(L, pos, size = 2, s = 1, o = {}) {
  const m = mats();
  seed(s);
  const sc = [0, 0, 0], ry = R() * 6;
  sc[0] = size * (1 + R() * 0.5); sc[1] = size * (0.45 + R() * 0.3); sc[2] = size * (1 + R() * 0.5);
  const M = mtx([pos.x, pos.y, pos.z], [0, ry, 0], sc);
  L.add(driftOnGround(L, driftGeo(s % 5), M, pos, sc[1]), o.mat || (o.rock ? m.iceRock : m.snow), M);
  if (o.collide !== false && size > 1) L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y - 1, pos.y + size * 0.45, size * 0.9, { surface: 'snow' }));
}

// Bonhomme de neige… aux oreilles de fennec (œuvre de Kobi ?)
// Boules de neige roulées (bosselées), tas de neige tassée au pied, boutons et sourire de charbon, nez de carotte
// annelé, bras en branches fourchues, bonnet tricoté percé pour les oreilles (pompon, revers), écharpe à pans rayés
export function snowman(L, pos, yaw = 0) {
  const m = mats(), X = xmats();
  const P = parts();
  const k = hashPos(pos) % 50;
  for (const [r, y] of [[0.7, 0.6], [0.5, 1.55], [0.36, 2.25]]) P(m.snow, lumpy(new THREE.SphereGeometry(r, 18, 12), r * 0.1, k + r * 10, 3 / r).translate(0, y, 0));
  // charbon : yeux, sourire, boutons
  const coal = [];
  for (const sx of [-1, 1]) coal.push(new THREE.DodecahedronGeometry(0.055).translate(sx * 0.12, 2.35, 0.32));
  for (let t = -2; t <= 2; t++) {
    const x = t * 0.065, y = 2.15 + 0.012 * t * t, z = Math.sqrt(Math.max(0, 0.36 * 0.36 - x * x - (y - 2.25) * (y - 2.25)));
    coal.push(new THREE.DodecahedronGeometry(0.026).translate(x, y, z));
  }
  for (const e of [-0.32, 0.02, 0.36]) coal.push(new THREE.DodecahedronGeometry(0.058).translate(0, 1.55 + 0.5 * Math.sin(e), 0.5 * Math.cos(e) + 0.01));
  coal.push(new THREE.DodecahedronGeometry(0.065).translate(0, 0.6 + 0.7 * Math.sin(0.45), 0.7 * Math.cos(0.45) + 0.01));
  for (const g of coal) P(m.coal, g);
  // carotte annelée
  const prof = [[0, 0], [0.075, 0], [0.074, 0.06], [0.06, 0.08], [0.065, 0.1], [0.057, 0.17], [0.046, 0.19], [0.049, 0.21], [0.038, 0.28], [0.029, 0.3], [0.03, 0.32], [0.014, 0.4], [0, 0.45]];
  P(m.carrot, new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 10).rotateX(Math.PI / 2).translate(0, 2.25, 0.3));
  // oreilles de fennec (de neige) qui passent par les trous du bonnet
  for (const sx of [-1, 1]) P(m.snow, new THREE.ConeGeometry(0.14, 0.45, 8).rotateZ(-sx * 0.35).translate(sx * 0.2, 2.65, 0));
  const BR = 0.39;
  P(X.knit, new THREE.SphereGeometry(BR, 18, 8, 0, TAU, 0, Math.PI * 0.34).translate(0, 2.24, 0));
  P(X.knitW, new THREE.TorusGeometry(BR * Math.sin(Math.PI * 0.34), 0.055, 6, 22).rotateX(Math.PI / 2).translate(0, 2.24 + BR * Math.cos(Math.PI * 0.34), 0));
  P(X.knitW, new THREE.TorusGeometry(BR * Math.sin(0.62) + 0.005, 0.022, 4, 18).rotateX(Math.PI / 2).translate(0, 2.24 + BR * Math.cos(0.62), 0));
  P(X.knitW, lumpy(new THREE.SphereGeometry(0.1, 10, 8), 0.045, 5, 30).translate(0, 2.24 + BR + 0.06, 0));
  // écharpe : tour de cou, deux pans rayés qui épousent la boule, franges
  P(X.knit, lumpy(new THREE.TorusGeometry(0.37, 0.085, 8, 24).rotateX(Math.PI / 2).rotateZ(0.08), 0.03, 9, 12).translate(0, 1.95, 0));
  // les pans suivent la surface bosselée de la boule du milieu (même bruit que lumpy), à 1,4 cm au-dessus
  const bodyR = (x, y, z) => {
    const l = Math.hypot(x, y, z) || 1, r = 0.5, f = 3 / r, kk = k + r * 10, px = (x / l) * r, py = (y / l) * r, pz = (z / l) * r;
    return r + (noise3(px * f + kk * 3.1, py * f, pz * f, kk) - 0.5) * r * 0.1 + (noise3(px * f * 3, py * f * 3, pz * f * 3, kk + 7) - 0.5) * r * 0.03;
  };
  const onBody = (x, y, lift) => {
    const dy = y - 1.55, z = Math.sqrt(Math.max(0.01, 0.25 - x * x - dy * dy)), l = Math.hypot(x, dy, z), R = bodyR(x, dy, z) + lift;
    return [(x / l) * R, 1.55 + (dy / l) * R, (z / l) * R];
  };
  for (const [cx, y0, y1, w] of [[0.15, 1.9, 1.38, 0.15], [0.31, 1.88, 1.5, 0.13]]) {
    const segs = 4;
    for (let sg = 0; sg < segs; sg++) {
      const va = sg / segs, vb = (sg + 1) / segs;
      P(sg % 2 ? X.knitW : X.knit, gridGeo(4, 3, (i, j) => {
        const v = va + (vb - va) * (i / 3);
        return onBody(cx + (j - 1) * w * 0.5 + v * 0.03, y0 + (y1 - y0) * v, 0.014);
      }, (i, j) => [j * 0.5, i * 0.3], [1, 1], [cx, 1.6, 2]));
    }
    for (let f = -1.5; f <= 1.5; f++) {
      const [x, y, z] = onBody(cx + f * w * 0.28 + 0.03, y1 - 0.035, 0.02);
      P(X.knit, new THREE.BoxGeometry(0.018, 0.08, 0.018).translate(x, y, z));
    }
  }
  // bras : branches fourchues
  for (const sx of [-1, 1]) {
    const a = V3(sx * 0.4, 1.62, 0), b = V3(sx * 1.12, 2.02 + (sx > 0 ? 0.08 : -0.04), 0.12);
    P(X.bark, beam(a, b, 0.036, 0.022, 6));
    const mid = a.clone().lerp(b, 0.55);
    P(X.bark, beam(mid, mid.clone().add(V3(sx * 0.14, 0.26, 0.05)), 0.018, 0.01, 5));
    P(X.bark, beam(b, b.clone().add(V3(sx * 0.16, 0.14, 0.02)), 0.017, 0.009, 5));
    P(X.bark, beam(b, b.clone().add(V3(sx * 0.2, -0.04, 0.06)), 0.016, 0.009, 5));
    P(X.bark, beam(b.clone().lerp(a, 0.12), b.clone().add(V3(sx * 0.02, 0.2, -0.04)), 0.014, 0.008, 5));
  }
  const M = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromAxisAngle(_bY, yaw), new THREE.Vector3(1, 1, 1));
  P.flush(L, M);
  // tas de neige tassée au pied (pièce à part : il ne prend pas l'ombre de pied du bonhomme)
  L.add(lumpy(new THREE.SphereGeometry(0.9, 18, 6, 0, TAU, 0, Math.PI / 2), 0.3, k, 2.4).scale(1, 0.3, 1).translate(0, -0.12, 0), m.snow, M);
  L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y, pos.y + 2.5, 0.6, { surface: 'snow' }));
  // tête coiffée (au-dessus du corps) et bras
  L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y + 2.5, pos.y + 2.8, 0.4, { surface: 'snow' }));
  const yq = new THREE.Quaternion().setFromAxisAngle(_bY, yaw);
  for (const sx of [-1, 1]) {
    const a = V3(sx * 0.58, 1.72, 0.03), b = V3(sx * 1.14, 2.04 + (sx > 0 ? 0.08 : -0.04), 0.12), d = b.clone().sub(a);
    const aq = yq.clone().multiply(new THREE.Quaternion().setFromUnitVectors(V3(1, 0, 0), d.clone().normalize()));
    L.game.world.add(new BoxCollider(a.clone().add(b).multiplyScalar(0.5).applyQuaternion(yq).add(pos), V3(d.length() / 2, 0.05, 0.05), aq, { surface: 'wood' }));
  }
}

// Pièces de la lanterne par hauteur (partagées) : pied à volutes, poteau de fer forgé torsadé, bagues, consoles, cage,
// chapeau pyramidal à larmier coiffé de neige, fleuron et anneau
const lanternGeo = new Map();
function lanternParts(h) {
  if (lanternGeo.has(h)) return lanternGeo.get(h);
  const m = mats(), X = xmats();
  const P = parts();
  // pied : socle, collet et quatre volutes
  P(X.iron, new THREE.CylinderGeometry(0.19, 0.28, 0.18, 8).translate(0, 0.03, 0));
  P(X.iron, new THREE.CylinderGeometry(0.1, 0.15, 0.22, 8).translate(0, 0.22, 0));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + Math.PI / 4;
    P(X.iron, new THREE.TorusGeometry(0.1, 0.018, 4, 10, Math.PI * 1.25).rotateZ(-Math.PI * 0.1).translate(0.13, 0.2, 0).rotateY(a));
  }
  // poteau carré torsadé
  const L0 = 0.3, L1 = h - 0.3;
  const post = new THREE.BoxGeometry(0.075, L1 - L0, 0.075, 1, Math.max(8, Math.round((L1 - L0) * 9)), 1).translate(0, (L0 + L1) / 2, 0);
  const pp = post.attributes.position;
  for (let i = 0; i < pp.count; i++) {
    const y = pp.getY(i), a = (y - L0) * 2.4, c = Math.cos(a), s = Math.sin(a), x = pp.getX(i), z = pp.getZ(i);
    pp.setXYZ(i, x * c - z * s, y, x * s + z * c);
  }
  post.computeVertexNormals();
  P(X.iron, post);
  for (const y of [L0 + 0.02, h * 0.5, L1 - 0.02]) P(X.iron, new THREE.CylinderGeometry(0.065, 0.065, 0.07, 8).translate(0, y, 0));
  // consoles en volute sous la cage
  for (let k = 0; k < 4; k++) P(X.iron, new THREE.TorusGeometry(0.1, 0.014, 4, 10, Math.PI * 0.9).rotateZ(Math.PI * 0.55).translate(0.08, h - 0.38, 0).rotateY((k / 4) * TAU + Math.PI / 4));
  // cage autour du cristal : plateau, quatre montants, ceinture, couvercle
  const cb = h - 0.27, ct = h + 0.36, rc = 0.2;
  P(X.iron, new THREE.CylinderGeometry(0.2, 0.13, 0.07, 4).translate(0, cb - 0.035, 0));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU, x = Math.cos(a) * rc * 1.414 * 0.707, z = Math.sin(a) * rc * 1.414 * 0.707;
    P(X.iron, new THREE.BoxGeometry(0.03, ct - cb, 0.03).translate(x, (cb + ct) / 2, z));
  }
  for (const y of [cb + 0.04, h + 0.05, ct - 0.02]) P(X.iron, new THREE.TorusGeometry(0.2, 0.012, 3, 4).rotateX(Math.PI / 2).translate(0, y, 0));
  // chapeau : larmier, pyramide, neige sur le dessus, fleuron, anneau
  P(X.iron, new THREE.CylinderGeometry(0.36, 0.36, 0.03, 4).translate(0, ct + 0.015, 0));
  P(X.iron, new THREE.ConeGeometry(0.33, 0.24, 4).translate(0, ct + 0.15, 0));
  P(m.snow, lumpy(new THREE.ConeGeometry(0.235, 0.18, 4, 2).translate(0, ct + 0.21, 0), 0.025, 3, 6));
  P(X.iron, new THREE.SphereGeometry(0.04, 8, 6).translate(0, ct + 0.33, 0));
  P(X.iron, new THREE.TorusGeometry(0.045, 0.011, 4, 10).translate(0, ct + 0.4, 0));
  const res = P.build();
  lanternGeo.set(h, res);
  return res;
}
// Lanterne glacée : cristal lumineux dans la cage d'un réverbère de fer forgé ; o.color : teinte (cyan par défaut)
export function iceLantern(L, pos, h = 2.6, o = {}) {
  const m = mats();
  const color = o.color || '#6ae8ff';
  const M = new THREE.Matrix4().makeRotationY(pos.x * 1.7 + pos.z * 0.3).setPosition(pos.x, pos.y, pos.z);
  for (const [mt, g] of lanternParts(h)) L.add(g, mt, M);
  // cristal posé sur la pointe au fond de la cage (plateau à h - 0,27)
  L.add(new THREE.OctahedronGeometry(0.17, 0).scale(1, 1.4, 1), o.color ? glow(color, 2.4) : m.cyanGlow, mtx([pos.x, pos.y + h - 0.04, pos.z], [0, 0.4, 0]));
  lights.add({ pos: new THREE.Vector3(pos.x, pos.y + h - 0.1, pos.z), color, intensity: o.intensity ?? 40, range: o.range ?? 12, flicker: o.flicker ?? 0.04, priority: 1.6 });
  L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y, pos.y + h - 0.3, 0.13, { surface: 'metal' }));
  L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y + h - 0.3, pos.y + h + 0.45, 0.3, { surface: 'metal' }));
}

// Pièces du projecteur, partagées : boîtier (incliné), lyre (tournée seulement en lacet) et sa fixation : tige sur mât
// (mount 'mat') ou bras arrière à platine contre un mur (mount 'mur', bras de longueur reach)
let floodGeo = null;
const floodMount = new Map();
function floodWall(reach) {
  if (!floodMount.has(reach)) {
    const X = xmats(), W = parts();
    W(X.iron, plankBox(0.07, 0.07, reach, 0.5, 0.5).translate(0, -0.44, -reach / 2));
    W(X.capPaint, G.rbox(0.26, 0.26, 0.04, 0.012, 1).clone().translate(0, -0.44, -reach));
    floodMount.set(reach, W.build());
  }
  return floodMount.get(reach);
}
function floodParts() {
  if (floodGeo) return floodGeo;
  const m = mats(), X = xmats();
  const H = parts(), Y = parts(), S = parts();
  // boîtier peint aux arêtes arrondies, cadre de la vitre, grille de fils, ailettes de refroidissement au dos
  H(X.capPaint, G.rbox(0.9, 0.6, 0.26, 0.05, 2).clone().translate(0, 0, -0.08));
  for (const y of [-0.27, 0.27]) H(X.iron, plankBox(0.9, 0.06, 0.06, 0.5, y).translate(0, y, 0.07));
  for (const x of [-0.42, 0.42]) H(X.iron, plankBox(0.06, 0.48, 0.06, 0.5, x).translate(x, 0, 0.07));
  for (let k = -2; k <= 2; k++) H(X.grille, new THREE.CylinderGeometry(0.009, 0.009, 0.5, 4).translate(k * 0.14, 0, 0.11));
  for (const y of [-0.1, 0.1]) H(X.grille, new THREE.CylinderGeometry(0.009, 0.009, 0.82, 4).rotateZ(Math.PI / 2).translate(0, y, 0.11));
  for (let k = -4; k <= 4; k++) H(X.iron, plankBox(0.022, 0.5, 0.13, 0.5, k).translate(k * 0.09, 0, -0.27));
  // visière et joues (violet du Baron), moyeux de pivot
  H(m.voraxD, plankBox(0.98, 0.035, 0.34, 0.5, 0.3).rotateX(-0.12).translate(0, 0.33, 0.12));
  for (const s of [-1, 1]) {
    const sh = new THREE.Shape();
    sh.moveTo(-0.22, 0.31); sh.lineTo(0.28, 0.31); sh.lineTo(0.28, 0.2); sh.lineTo(-0.22, -0.2); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.025, bevelEnabled: false });
    g.clearGroups();
    // joues collées aux flancs du boîtier (x = ±0,45), le moyeu du pivot les traverse
    H(m.voraxD, g.rotateY(-Math.PI / 2).translate(s * 0.45 + (s > 0 ? 0.025 : 0), 0, 0));
    H(X.iron, new THREE.CylinderGeometry(0.075, 0.075, 0.06, 10).rotateZ(Math.PI / 2).translate(s * 0.5, 0, 0));
    H(X.iron, new THREE.CylinderGeometry(0.035, 0.035, 0.03, 6).rotateZ(Math.PI / 2).translate(s * 0.545, 0, 0));
  }
  // lyre : bras et traverse ; tige de mât sous la traverse (bas à y = -0,66)
  for (const s of [-1, 1]) Y(X.iron, plankBox(0.05, 0.46, 0.09, 0.5, s).translate(s * 0.555, -0.21, 0));
  Y(X.iron, plankBox(1.16, 0.06, 0.09, 0.5, 0.2).translate(0, -0.44, 0));
  S(X.iron, new THREE.CylinderGeometry(0.05, 0.06, 0.2, 8).translate(0, -0.56, 0));
  S(X.iron, new THREE.CylinderGeometry(0.1, 0.1, 0.04, 10).translate(0, -0.47, 0));
  floodGeo = { head: H.build(), yoke: Y.build(), stem: S.build() };
  return floodGeo;
}

// Projecteur de chantier (lumière industrielle) : boîtier peint à ailettes, vitre éclairée sous grille, visière, monté
// sur une lyre à pivots ; pos : boîtier, yaw : direction éclairée. o.mount : 'mat' (par défaut : tige sous la lyre, à
// poser sur un mât ou un plancher, bas de la tige à pos.y - 0,66) ou 'mur' (bras vers l'arrière, platine à o.reach =
// 0,42 m derrière le pivot, à pos.y - 0,44, contre une paroi) ;
// o.tilt : inclinaison vers le bas, o.color, o.intensity
export function floodlight(L, pos, yaw = 0, o = {}) {
  const color = o.color || '#ffd49a';
  const tilt = o.tilt ?? 0.55;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, yaw, 0, 'YXZ'));
  const at = (x, y, z) => new THREE.Vector3(x, y, z).applyQuaternion(q).add(pos);
  const one = new THREE.Vector3(1, 1, 1);
  const Mh = new THREE.Matrix4().compose(pos, q, one);
  const My = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromAxisAngle(_bY, yaw), one);
  const fg = floodParts();
  for (const [mt, g] of fg.head) L.add(g, mt, Mh);
  for (const [mt, g] of fg.yoke) L.add(g, mt, My);
  for (const [mt, g] of o.mount === 'mur' ? floodWall(o.reach ?? 0.42) : fg.stem) L.add(g, mt, My);
  // vitre éclairée, en retrait derrière la grille
  L.add(G.box(0.76, 0.46, 0.03), glow(color, 3.2), new THREE.Matrix4().compose(at(0, 0, 0.045), q, one));
  lights.add({ pos: at(0, -0.2, 0.9), color, intensity: o.intensity ?? 60, range: o.range ?? 18, decay: 1.3, priority: o.priority ?? 1.5 });
  // boîtier (incliné) ; la lyre, fine, reste traversable
  L.game.world.add(new BoxCollider(at(0, 0, -0.08), V3(0.5, 0.33, 0.2), q, { surface: 'metal', blocksCamera: false }));
}

// Mèche hélicoïdale (tarière) : âme effilée, spire de 3 tours qui s'amincit vers la pointe, dents de carbure, manchon
// coulissant sur la tige ; pointe en bas (y = -1,6), sommet du manchon à y = 2,55. Partagée par toutes les tours.
let augerGeo = null;
function auger() {
  if (augerGeo) return augerGeo;
  const steel = [], teeth = [];
  steel.push(new THREE.CylinderGeometry(0.28, 0.05, 2.95, 10).translate(0, -0.08, 0));
  steel.push(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12).translate(0, 1.5, 0));
  steel.push(new THREE.CylinderGeometry(0.35, 0.35, 0.9, 12).translate(0, 2.1, 0));
  for (const y of [1.75, 2.45]) steel.push(new THREE.CylinderGeometry(0.39, 0.39, 0.07, 12).translate(0, y, 0));
  // spire : dessus, dessous et chant extérieur
  const N = 96, turns = 3, top = 1.3, bot = -1.42, thk = 0.06;
  const ring = (k) => {
    const t = k / N, a = t * turns * TAU, y = top + (bot - top) * t;
    const ri = 0.27 - 0.2 * t, ro = 0.14 + 0.72 * Math.pow(1 - t, 0.85);
    return { c: Math.cos(a), s: Math.sin(a), y, ri, ro };
  };
  const pos = [], uv = [], idx = [];
  for (let k = 0; k <= N; k++) {
    const { c, s, y, ri, ro } = ring(k);
    for (const [rr, yy] of [[ri, y], [ro, y], [ro, y - thk], [ri, y - thk]]) { pos.push(c * rr, yy, s * rr); uv.push(k / 12, rr); }
  }
  for (let k = 0; k < N; k++) {
    const a = k * 4, b = a + 4;
    // faces : dessus (0-1), chant (1-2), dessous (2-3)
    for (const [p, q] of [[0, 1], [1, 2], [2, 3]]) idx.push(a + p, b + p, a + q, a + q, b + p, b + q);
  }
  const fl = new THREE.BufferGeometry();
  fl.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  fl.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  fl.setIndex(idx);
  fl.computeVertexNormals();
  // orientation : le dessus de la spire doit regarder vers le haut
  if (fl.attributes.normal.getY(0) < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } fl.setIndex(idx); fl.computeVertexNormals(); }
  steel.push(fl);
  // dents de carbure au bout de la spire et sur la pointe
  for (const k of [N - 2, N - 14, N - 26]) {
    const { c, s, y, ro } = ring(k);
    teeth.push(new THREE.BoxGeometry(0.1, 0.09, 0.07).rotateY(-Math.atan2(s, c)).translate(c * (ro + 0.02), y - 0.04, s * (ro + 0.02)));
  }
  teeth.push(new THREE.ConeGeometry(0.075, 0.2, 6).rotateX(Math.PI).translate(0, -1.62, 0));
  const mk = (l) => { const g = mergeGeometries(l.map(ni)); g.userData.shared = true; return g; };
  augerGeo = { steel: mk(steel), teeth: mk(teeth) };
  return augerGeo;
}
// Tige carrée de forage (kelly) avec ses bagues, de y = 3 à h + 1 ; par hauteur
const shaftGeo = new Map();
function kelly(h) {
  if (shaftGeo.has(h)) return shaftGeo.get(h);
  const l = [new THREE.BoxGeometry(0.4, h - 2, 0.4).translate(0, 3 + (h - 2) / 2, 0)];
  for (let y = 3.6; y < h - 0.2; y += 2.3) l.push(new THREE.CylinderGeometry(0.33, 0.33, 0.16, 8).translate(0, y, 0));
  const g = mergeGeometries(l.map(ni));
  g.userData.shared = true;
  shaftGeo.set(h, g);
  return g;
}

// Tour de forage du Baron : quatre jambes en cornières peintes, ceintures en U, croix de Saint-André en plats, goussets
// boulonnés, semelles sur dés de béton, échelle ; tête moteur (caisson à persiennes, plancher en tôle larmée, réducteur à
// ailettes sous le caisson, gyrophare en cage) ; tige carrée et mèche hélicoïdale qui tournent ; tête de puits au sol.
// o.lampRail : hauteur (au-dessus de pos) d'une lisse porte-projecteurs boulonnée sur la face des jambes, côtés ±x
// (pour des projecteurs floodlight 'mur' fixés à la tour)
export function drillRig(L, pos, h = 14, o = {}) {
  const m = mats(), X = xmats();
  const put = parts();
  const rnd = mkRng(hashPos(pos, 3));
  const A = 1.6, LW = 0.36, LT = 0.05, OUT = A + LW / 2;
  const C = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  const bl = [];
  // jambes (cornières, angle tourné vers l'extérieur), dés de béton et semelles boulonnées
  for (const [sx, sz] of C) {
    put(X.violetD, plankBox(LT, h, LW, 0.5, rnd() * 4).translate(sx * (OUT - LT / 2), h / 2, sz * A));
    put(X.violetD, plankBox(LW, h, LT, 0.5, rnd() * 4).translate(sx * A, h / 2, sz * (OUT - LT / 2)));
    put(X.concrete, chamferBox(0.95, 0.5, 0.95, 0.05).translate(sx * (A + 0.05), 0.2, sz * (A + 0.05)));
    put(X.iron, new THREE.BoxGeometry(0.66, 0.05, 0.66).translate(sx * (A + 0.05), 0.475, sz * (A + 0.05)));
    bolts(bl, [[-0.24, 0.5, -0.24], [0.24, 0.5, -0.24], [-0.24, 0.5, 0.24], [0.24, 0.5, 0.24]].map(([x, y, z]) => [sx * (A + 0.05) + x, y, sz * (A + 0.05) + z]), [0, 1, 0], 0.035);
  }
  // ceintures en U boulonnées sur les jambes, une ceinture de tête
  const levels = [];
  for (let y = 2; y < h - 0.8; y += 2.4) levels.push(y);
  levels.push(h - 0.16);
  // faces : normale (nx, nz) ; axe de la face (ux, uz)
  const faces = [[0, 1, 1, 0], [0, -1, -1, 0], [1, 0, 0, -1], [-1, 0, 0, 1]];
  const F = (f, u, y, d) => V3(f[2] * u + f[0] * d, y, f[3] * u + f[1] * d);
  for (const f of faces) {
    const n = V3(f[0], 0, f[1]);
    for (const y of levels) {
      const web = plankBox(2 * OUT + 0.1, 0.22, 0.05, 0.5, rnd() * 4), fl1 = plankBox(2 * OUT + 0.1, 0.05, 0.16, 0.5, rnd() * 4), fl2 = fl1.clone();
      const M = new THREE.Matrix4().makeBasis(V3(f[2], 0, f[3]), V3(0, 1, 0), n);
      put(X.violet, web.applyMatrix4(M).translate(f[0] * (OUT + 0.025), y, f[1] * (OUT + 0.025)));
      put(X.violet, fl1.applyMatrix4(M).translate(f[0] * (OUT - 0.03), y + 0.085, f[1] * (OUT - 0.03)));
      put(X.violet, fl2.applyMatrix4(M).translate(f[0] * (OUT - 0.03), y - 0.085, f[1] * (OUT - 0.03)));
      // goussets aux deux jambes, boulonnés sur la jambe et sur la ceinture
      for (const s of [-1, 1]) {
        const sh = new THREE.Shape();
        sh.moveTo(0.1, -0.42); sh.lineTo(0.1, 0.42); sh.lineTo(-0.5, 0.15); sh.lineTo(-0.5, -0.15); sh.closePath();
        const g = new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: false });
        g.clearGroups();
        const gp = g.attributes.position, gu = g.attributes.uv;
        for (let i = 0; i < gp.count; i++) gu.setXY(i, gp.getX(i) * 0.5 + rnd(), (gp.getY(i) + 0.42) / 0.84);
        const gx = V3(f[2] * s, 0, f[3] * s), gz = new THREE.Vector3().crossVectors(gx, _bY);
        g.applyMatrix4(new THREE.Matrix4().makeBasis(gx, _bY, gz));
        const c = F(f, s * A, y, gz.dot(n) > 0 ? OUT + 0.05 : OUT + 0.072);
        put(X.violetD, g.translate(c.x, c.y, c.z));
        const nn = [f[0], 0, f[1]];
        bolts(bl, [[0, 0.3], [0, -0.3], [-0.36, 0]].map(([u, v]) => { const p = F(f, s * (A + u), y + v, OUT + 0.075); return [p.x, p.y, p.z]; }), nn, 0.028);
      }
    }
    // croix de Saint-André dans chaque travée, plaque de croisement boulonnée
    const lv = [0.55, ...levels];
    for (let k = 0; k < lv.length - 1; k++) {
      const y0 = lv[k] + 0.16, y1 = lv[k + 1] - 0.16;
      if (y1 - y0 < 0.8) continue;
      for (const s of [-1, 1]) put(X.violet, flatBar(F(f, -s * (A - 0.1), y0, OUT - 0.07), F(f, s * (A - 0.1), y1, OUT - 0.07), 0.13, 0.03, n, rnd() * 4));
      const pc = F(f, 0, (y0 + y1) / 2, OUT - 0.045);
      put(X.violetD, new THREE.BoxGeometry(f[2] ? 0.24 : 0.02, 0.24, f[3] ? 0.24 : 0.02).translate(pc.x, pc.y, pc.z));
      const pb = F(f, 0, (y0 + y1) / 2, OUT - 0.035);
      bolts(bl, [[pb.x, pb.y, pb.z]], [f[0], 0, f[1]], 0.035);
    }
  }
  // guides de tige : traverses et bagues aux ceintures paires
  for (let k = 1; k < levels.length - 1; k += 2) {
    const y = levels[k] + 0.2;
    // traverses posées sur l'aile haute de la ceinture
    for (const s of [-1, 1]) put(X.violetD, plankBox(OUT - 0.42, 0.14, 0.12, 0.5, rnd() * 4).translate(s * (OUT + 0.42) / 2, y - 0.02, 0));
    put(X.iron, new THREE.TorusGeometry(0.42, 0.06, 6, 16).rotateX(Math.PI / 2).translate(0, y - 0.02, 0));
  }
  if (o.lampRail !== undefined) {
    for (const sx of [-1, 1]) {
      put(X.violet, plankBox(0.05, 0.22, 2 * OUT + 0.1, 0.5, rnd() * 4).translate(sx * (OUT + 0.025), o.lampRail, 0));
      const pts = [];
      for (const sz of [-1, 1]) for (const dy of [-0.06, 0.06]) pts.push([sx * (OUT + 0.05), o.lampRail + dy, sz * A]);
      bolts(bl, pts, [sx, 0, 0], 0.028);
    }
  }
  // échelle à crinoline légère sur la face -z (vers l'allée)
  const LZ = -(OUT + 0.2);
  // montants plantés dans le sol (le terrain est à y = 0,3 sous la tour)
  for (const s of [-1, 1]) put(X.iron, plankBox(0.05, h + 1.1, 0.07, 0.5, s).translate(s * 0.25, (h + 1.1) / 2 + 0.1, LZ));
  for (let y = 0.85; y < h + 1.1; y += 0.32) put(X.iron, new THREE.CylinderGeometry(0.018, 0.018, 0.5, 5).rotateZ(Math.PI / 2).translate(0, y, LZ));
  for (const y of levels) for (const s of [-1, 1]) put(X.iron, new THREE.BoxGeometry(0.04, 0.04, 0.18).translate(s * 0.25, y, LZ + 0.12));
  // tête moteur : caisson peint (posé sur la tête des jambes et la ceinture du haut), plancher en tôle larmée
  // (praticable), cornière de rive boulonnée, persiennes
  const T = h;
  put(X.capPaint, G.rbox(4.3, 0.98, 4.3, 0.07, 2).clone().translate(0, T + 0.44, 0));
  const tread = boxUV(4.4, 0.12, 4.4, 2).clone();
  put(X.tread, tread.translate(0, T + 1.14, 0));
  for (const f of faces) {
    const n = V3(f[0], 0, f[1]), M = new THREE.Matrix4().makeBasis(V3(f[2], 0, f[3]), V3(0, 1, 0), n);
    put(X.violet, plankBox(4.52, 0.26, 0.06, 0.5, rnd() * 4).applyMatrix4(M).translate(f[0] * 2.23, T + 1.03, f[1] * 2.23));
    const pts = [];
    for (let u = -2; u <= 2.01; u += 0.5) { const p = F(f, u, T + 1.03, 2.265); pts.push([p.x, p.y, p.z]); }
    bolts(bl, pts, [f[0], 0, f[1]], 0.026);
    for (const s of [-1, 1]) {
      const c = F(f, s * 1.0, T + 0.5, 2.15);
      put(X.iron, new THREE.BoxGeometry(f[2] ? 1.5 : 0.04, 0.6, f[3] ? 1.5 : 0.04).translate(c.x, c.y, c.z));
      for (let y = T + 0.28; y < T + 0.76; y += 0.09) {
        const sl = plankBox(1.42, 0.05, 0.12, 0.5, y).rotateX(0.65).applyMatrix4(M);
        const p = F(f, s * 1.0, y, 2.2);
        put(X.capPaint, sl.translate(p.x, p.y, p.z));
      }
    }
  }
  // réducteur à ailettes sous le caisson, anneau rose (marque du Baron), câbles qui descendent le long d'une jambe
  put(X.iron, new THREE.CylinderGeometry(0.85, 0.95, 0.55, 18).translate(0, T - 0.27, 0));
  put(X.iron, new THREE.TorusGeometry(0.95, 0.05, 5, 24).rotateX(Math.PI / 2).translate(0, T - 0.55, 0));
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * TAU;
    put(X.violet, plankBox(0.03, 0.46, 0.28, 0.5, k).rotateY(Math.PI / 2 - a).translate(Math.cos(a) * 1.0, T - 0.27, Math.sin(a) * 1.0));
  }
  put(m.pinkGlow, new THREE.TorusGeometry(0.52, 0.06, 6, 20).rotateX(Math.PI / 2).translate(0, T - 0.59, 0));
  // câbles : du réducteur au creux d'une jambe, qu'ils suivent jusqu'au dé de béton
  const CA = OUT - 0.045 - 0.05;
  for (const s of [-1, 1]) {
    const cv = new THREE.CatmullRomCurve3([V3(s * 0.7, T - 0.4, 0.6), V3(s * 1.2, T - 1.3, 1.2), V3(s * CA, T - 2.2, CA), V3(s * CA, T - 3.4, CA), V3(s * CA, 0.4, CA)]);
    put(X.grille, new THREE.TubeGeometry(cv, 40, 0.045, 5));
  }
  // gyrophare rose en cage sur la tête
  L.add(G.cyl(0.4, 0.4, 0.5, 10), m.pinkGlow, mtx([pos.x, pos.y + h + 1.4, pos.z]));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + Math.PI / 4;
    put(X.iron, new THREE.BoxGeometry(0.04, 0.6, 0.04).translate(Math.cos(a) * 0.5, T + 1.5, Math.sin(a) * 0.5));
  }
  put(X.iron, new THREE.CylinderGeometry(0.56, 0.56, 0.05, 12).translate(0, T + 1.8, 0));
  put(X.iron, new THREE.TorusGeometry(0.52, 0.03, 4, 16).rotateX(Math.PI / 2).translate(0, T + 1.25, 0));
  // tête de puits : tubage à bride boulonnée, fond sombre
  put(X.iron, new THREE.CylinderGeometry(1.0, 1.08, 0.55, 18, 1, true).translate(0, 0.42, 0));
  put(X.hollow, new THREE.CylinderGeometry(0.96, 0.96, 0.5, 18, 1, true).translate(0, 0.45, 0));
  put(X.iron, new THREE.TorusGeometry(1.06, 0.08, 6, 24).rotateX(Math.PI / 2).translate(0, 0.7, 0));
  put(X.hollowEnd, new THREE.CircleGeometry(1.0, 18).rotateX(-Math.PI / 2).translate(0, 0.3, 0));
  const fb = [];
  for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU; fb.push([Math.cos(a) * 1.06, 0.77, Math.sin(a) * 1.06]); }
  bolts(bl, fb, [0, 1, 0], 0.03);
  put(X.iron, mergeGeometries(bl.map(ni)));
  put.flush(L, new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z));
  lights.add({ pos: new THREE.Vector3(pos.x, pos.y + h + 1.8, pos.z), color: '#ff4fa0', intensity: 35, range: 11, priority: 1.2 });
  const drill = new THREE.Group();
  drill.position.set(pos.x, pos.y, pos.z);
  const ag = auger();
  const bit = new THREE.Group();
  bit.position.y = 1.4;
  for (const [g, mt] of [[ag.steel, m.steel], [ag.teeth, m.gold]]) { const me = new THREE.Mesh(g, mt); me.castShadow = true; bit.add(me); }
  drill.add(bit);
  const shaft = new THREE.Mesh(kelly(h), m.steel);
  shaft.castShadow = true;
  drill.add(shaft);
  L.root.add(drill);
  L.every((dt) => { drill.rotation.y += dt * 4; bit.position.y = 1.4 + Math.sin(L.time * 1.5) * 0.4; });
  L.game.world.add(new BoxCollider(new THREE.Vector3(pos.x, pos.y + h / 2, pos.z), new THREE.Vector3(1.9, h / 2, 1.9), null, { surface: 'metal' }));
  // échelle (hors du caisson de la tour), dés de béton des pieds, cage du gyrophare sur la tête
  L.game.world.add(new BoxCollider(V3(pos.x, pos.y + (0.5 + h + 1.2) / 2, pos.z - 1.97), V3(0.3, (h + 0.7) / 2, 0.07), null, { surface: 'metal', blocksCamera: false }));
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) L.game.world.add(new BoxCollider(V3(pos.x + sx * 1.65, pos.y + 0.225, pos.z + sz * 1.65), V3(0.475, 0.225, 0.475), null, { surface: 'metal' }));
  L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y + h + 1.2, pos.y + h + 1.83, 0.56, { surface: 'metal' }));
}

// Pente glacée : longue glissière inclinée (surface « ice ») bordée de murets
export function iceSlide(L, a, b, width = 5, o = {}) {
  const m = mats();
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz);
  const yaw = Math.atan2(dx, dz);
  const pitch = Math.asin(dy / len);
  const c = new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, yaw, 0, 'YXZ'));
  const mm = new THREE.Matrix4().compose(c, q, new THREE.Vector3(1, 1, 1));
  const walls = o.walls !== false, X = xmats();
  const w2 = width / 2, Rf = walls ? 0.55 : 0.14, Y = 0.25;
  const rnd = mkRng(hashPos(a, 9)), ks = hashPos(a) % 97;
  const nz = Math.max(2, Math.ceil(len / 0.9));
  const zAt = (j) => -len / 2 + (len * j) / nz;
  // gouttière : fond plat (le niveau de la collision), bords relevés en quart de cercle jusqu'au pied des congères
  const prof = [];
  for (let i = 0; i <= 6; i++) { const t = i / 6, a2 = (t * Math.PI) / 2; prof.push([-w2 + Rf - Math.sin(a2) * Rf, Y + Rf - Math.cos(a2) * Rf]); }
  prof.reverse();
  for (let i = 1; i < 6; i++) prof.push([-w2 + Rf + ((width - 2 * Rf) * i) / 6, Y]);
  for (let i = 0; i <= 6; i++) { const t = i / 6, a2 = (t * Math.PI) / 2; prof.push([w2 - Rf + Math.sin(a2) * Rf, Y + Rf - Math.cos(a2) * Rf]); }
  L.add(gridGeo(nz + 1, prof.length, (j, i) => [prof[i][0], prof[i][1], zAt(j)], (j, i) => [prof[i][0] * 0.25, zAt(j) * 0.25], [0, 8], [0, 5, 0]), m.ice, mm);
  // flancs et dessous de la dalle, tranches aux deux bouts
  const under = [new THREE.PlaneGeometry(width, len).rotateX(Math.PI / 2).translate(0, -0.25, 0)];
  for (const s of [-1, 1]) under.push(new THREE.PlaneGeometry(len, Y + Rf + 0.25).rotateY(s * Math.PI / 2).translate(s * w2, (Y + Rf - 0.25) / 2, 0));
  L.add(metricUV(mergeGeometries(under.map(ni)), 0.25), X.iceUnder, mm);
  const sh = new THREE.Shape();
  sh.moveTo(-w2, -0.25); sh.lineTo(w2, -0.25);
  for (let i = prof.length - 1; i >= 0; i--) sh.lineTo(prof[i][0], prof[i][1]);
  sh.closePath();
  const ends = [new THREE.ShapeGeometry(sh).translate(0, 0, len / 2), new THREE.ShapeGeometry(sh).rotateY(Math.PI).translate(0, 0, -len / 2)];
  L.add(metricUV(mergeGeometries(ends.map(ni)), 0.3), m.iceEdge, mm);
  L.game.world.add(new BoxCollider(c.clone(), new THREE.Vector3(width / 2, 0.25, len / 2), q, { surface: 'ice' }));
  if (walls) {
    const banks = [], icicles = [];
    for (const sx of [-1, 1]) {
      // congère irrégulière : profil (d = distance à l'extérieur du bord intérieur, y), bosses le long de la piste,
      // bouts arrondis ; le flanc intérieur reste au droit de la collision
      const shape = (z) => {
        const nA = noise3(z * 0.42 + sx * 17 + ks, 0.3, 0.7, 5), nB = noise3(z * 1.15 + sx * 7, 1.7 + ks, 0.2, 9);
        const e = sst(0, 1, Math.min(1, (len / 2 - Math.abs(z)) / 1.1));
        const Hc = 0.62 + (1.12 + (nA - 0.5) * 0.5 + (nB - 0.5) * 0.18 - 0.62) * e, B = 0.42 + (nB - 0.5) * 0.3 + nA * 0.15;
        return [[-0.07, Y + Rf * 0.64], [0.0, Y + Rf + (Hc - Y - Rf) * 0.55], [0.07, Hc - 0.08], [0.22, Hc], [0.4, Hc - 0.07], [B + 0.08, Hc * 0.62], [B + 0.14, 0.18], [B + 0.06, -0.24], [0.28, -0.42], [-0.02, -0.33]];
      };
      // profil refermé (le flanc intérieur passe dans la dalle) et bouts arrondis qui se referment en pointe : on ne voit
      // plus l'intérieur creux de la congère au-delà des bouts de la dalle
      const rows = [], zs = [];
      zs.push(-len / 2 - 0.3, -len / 2 - 0.22);
      for (let j = 0; j <= nz; j++) zs.push(zAt(j));
      zs.push(len / 2 + 0.22, len / 2 + 0.3);
      for (let r2 = 0; r2 < zs.length; r2++) {
        const z = zs[r2], pr = shape(Math.max(-len / 2, Math.min(len / 2, z)));
        pr.push(pr[0]);
        const tip = r2 === 0 || r2 === zs.length - 1, end = tip || r2 === 1 || r2 === zs.length - 2;
        const cx = pr.reduce((s2, p) => s2 + p[0], 0) / pr.length, cy = pr.reduce((s2, p) => s2 + p[1], 0) / pr.length;
        const kd = tip ? 0.02 : 0.25, ky = tip ? 0.03 : 0.35;
        rows.push(pr.map(([d, y]) => (end ? [cx + (d - cx) * kd, cy + (y - cy) * ky] : [d, y])).map(([d, y]) => [sx * (w2 + d), y, z]));
        if (!end && rnd() < 0.55) {
          const [d, y] = pr[7], ln = 0.25 + rnd() * 0.55, zi = clamp(z + (rnd() - 0.5) * 0.4, -len / 2 + 0.3, len / 2 - 0.3);
          icicles.push(new THREE.ConeGeometry(0.055 + rnd() * 0.03, ln, 5).rotateX(Math.PI).translate(sx * (w2 + d - 0.03), y - ln / 2 + 0.04, zi));
        }
      }
      banks.push(gridGeo(rows.length, rows[0].length, (j, i) => rows[j][i], (j, i) => [i * 0.3, zs[j] * 0.35], [Math.floor(rows.length / 2), 3], [sx * w2, 5, zs[Math.floor(rows.length / 2)]]));
      // collision par tronçons de ~1,8 m à la hauteur de la crête (jamais sous 1,05 m), flanc
      // intérieur toujours au droit du bord de la gouttière
      for (let j = 0; j < nz; j += 2) {
        const za = zAt(j), zb = zAt(Math.min(nz, j + 2));
        let hc = 0;
        for (let t = 0; t <= 4; t++) hc += shape(za + ((zb - za) * t) / 4)[3][1] / 5;
        const top = Math.max(1.05, hc - 0.06);
        const wc = new THREE.Vector3(sx * (w2 + 0.35), (top - 0.05) / 2, (za + zb) / 2).applyQuaternion(q).add(c);
        L.game.world.add(new BoxCollider(wc, new THREE.Vector3(0.35, (top + 0.05) / 2, (zb - za) / 2), q, { surface: 'snow' }));
      }
    }
    L.add(mergeGeometries(banks.map(ni)), m.snow, mm);
    if (icicles.length) L.add(mergeGeometries(icicles.map(ni)), m.iceEdge, mm);
  }
}

// Paroi de glace rainurée (saut mural)
// Âme pleine, assises de dalles taillées aux arêtes chanfreinées (longueurs, épaisseurs et aplombs un peu variés :
// facettes), rainures creusées entre les assises avec leur filet lumineux au fond, couronnement chanfreiné
export function wallJumpWall(L, pos, yaw, w, h, o = {}) {
  const m = mats();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
  const c = new THREE.Vector3(pos.x, pos.y + h / 2, pos.z);
  const wm = o.mat || m.ice, gl = o.glow || m.cyanGlow;
  const rnd = mkRng(hashPos(pos, 11));
  const P = parts();
  P(wm, metricUV(new THREE.BoxGeometry(w, h, 1.0).toNonIndexed(), 0.35));
  // o.foot : semelle (âme seule) prolongée sous le pied jusqu'au terrain, visuelle (la collision ne change pas)
  if (o.foot > 0) P(wm, metricUV(new THREE.BoxGeometry(w, o.foot + 0.02, 1.0).toNonIndexed().translate(0, -h / 2 - o.foot / 2 + 0.01, 0), 0.35));
  const grooves = [];
  for (let y = 0.8; y < h; y += 1.4) grooves.push(y);
  const GH = 0.075;
  for (const sz of [-1, 1]) {
    let y0 = 0;
    for (const gy of [...grooves, null]) {
      const y1 = gy === null ? h - 0.16 : gy - GH;
      if (y1 - y0 > 0.12) {
        let x = -w / 2;
        while (x < w / 2 - 0.05) {
          let len = 1.2 + rnd() * 1.3;
          if (w / 2 - x - len < 0.8) len = w / 2 - x;
          const t = 0.075 + rnd() * 0.03;
          const g = chamferBox(len - 0.035, y1 - y0, t, 0.03, 0.35);
          g.rotateX((rnd() - 0.5) * 0.035).rotateY((rnd() - 0.5) * 0.03);
          P(wm, g.translate(x + len / 2, (y0 + y1) / 2 - h / 2, sz * (0.5 + t / 2)));
          x += len;
        }
      }
      if (gy !== null) {
        P(gl, new THREE.BoxGeometry(w * 0.97, 0.085, 0.075).translate(0, gy - h / 2, sz * 0.5375));
        y0 = gy + GH;
      }
    }
  }
  // couronnement
  P(wm, chamferBox(w + 0.08, 0.17, 1.28, 0.05, 0.35).translate(0, h / 2 - 0.085, 0));
  P.flush(L, new THREE.Matrix4().compose(c, q, new THREE.Vector3(1, 1, 1)));
  L.game.world.add(new BoxCollider(c, new THREE.Vector3(w / 2, h / 2, 0.6), q, { surface: o.surface || 'ice', tag: 'walljump' }));
}

// Massif de roche ou de glace facettée (visuel seul, la collision reste celle de la boîte) : boîte subdivisée (mailles
// serrées sur les 16 m du haut) dont les faces sont repoussées par un bruit, dessus plat (palier) aux rives écornées,
// facettes planes. c : centre, size : dimensions ; o.snug : faces collées à un voisin, qui ne reculent pas
// ('-x', '+x', '-z', '+z'), o.step : maille, o.uv : échelle des UV (matières à texture)
export function rockMassif(L, c, size, material, o = {}) {
  const W = size.x, H = size.y, D = size.z, step = o.step ?? 1.2;
  const nx = Math.max(2, Math.round(W / step)), nz = Math.max(2, Math.round(D / step));
  const dense = Math.min(H, 16), nd = Math.max(2, Math.round(dense / 1.1)), nl = H > dense + 0.5 ? Math.max(1, Math.round((H - dense) / 8)) : 0;
  const ny = nd + nl;
  const g = new THREE.BoxGeometry(W, H, D, nx, ny, nz);
  const p = g.attributes.position, snug = new Set(o.snug || []), k = hashPos(c) % 61;
  const eps = 1e-4;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // rangées : réparties autrement en hauteur (fines en haut)
    const t = Math.round(((y + H / 2) / H) * ny);
    y = t <= nl ? -H / 2 + (nl ? (t / nl) * (H - dense) : 0) : -H / 2 + (H - dense) + ((t - nl) / nd) * dense;
    const onX = Math.abs(Math.abs(x) - W / 2) < eps, onZ = Math.abs(Math.abs(z) - D / 2) < eps, onTop = t === ny, onBot = t === 0;
    const wx = c.x + x, wy = c.y + y, wz = c.z + z;
    const n1 = noise3(wx * 0.45 + k, wy * 0.45, wz * 0.45, 7), n2 = noise3(wx * 1.25, wy * 1.25 + k, wz * 1.25, 11);
    const d = clamp((n1 - 0.5) * 1.4 + (n2 - 0.5) * 0.9 - 0.04, -0.85, 0);
    const face = (axis, s) => (snug.has((s > 0 ? '+' : '-') + axis) ? 0 : d);
    if (onX) x += Math.sign(x) * face('x', x);
    if (onZ) z += Math.sign(z) * face('z', z);
    if (onTop && (onX || onZ)) y -= 0.04 + n2 * 0.14;
    else if (!onTop && !onBot && (onX || onZ)) y += (n2 - 0.5) * 0.5 * (t > nl ? dense / nd : 4);
    p.setXYZ(i, x, y, z);
  }
  const f = g.toNonIndexed();
  g.dispose();
  f.computeVertexNormals();
  metricUV(f, o.uv ?? 0.3);
  L.add(f, material, new THREE.Matrix4().makeTranslation(c.x, c.y, c.z));
}

// Plaque de glace flottante (pour waterFloaters) : dalle irrégulière de rayon r, croûte de neige sur le dessus.
// L'origine est à la ligne de flottaison.
export function iceFloe(r = 0.7, s = 1) {
  const m = mats();
  seed(s);
  const n = 6 + Math.floor(R() * 4);
  const shape = new THREE.Shape(), cap = new THREE.Shape();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (R() - 0.5) * 0.5;
    const rr = r * (0.7 + R() * 0.45);
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr * (0.75 + R() * 0.25);
    const c = 0.45 + R() * 0.25;
    if (i) { shape.lineTo(x, y); cap.lineTo(x * c, y * c); } else { shape.moveTo(x, y); cap.moveTo(x * c, y * c); }
  }
  const slab = new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.04, bevelSegments: 1 }).rotateX(-Math.PI / 2).translate(0, -0.12, 0);
  const top = new THREE.ExtrudeGeometry(cap, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.08, bevelSegments: 2 }).rotateX(-Math.PI / 2).translate(0, 0.02, 0);
  const g = new THREE.Group();
  const a = new THREE.Mesh(slab, m.floe), b = new THREE.Mesh(top, m.snow);
  a.castShadow = b.castShadow = true;
  a.receiveShadow = b.receiveShadow = true;
  g.add(a, b);
  return g;
}

// Paillettes de la neige : un cristal sur cinq cellules de 6 cm renvoie la lumière directe (soleil, lanternes) vers
// l'œil quand sa facette est bien orientée. Greffé au matériau de terrain d'une planète (aucune texture : hachage de
// la position, quelques opérations) ; s'éteint au loin et sur les parois. o : amount, scale, range, normal (relief des
// cartes de normales du terrain). Renvoie les uniformes (réglages).
const SPARKLE = /* glsl */ `
{
  float kSpD = length(cameraPosition - vWPos);
  if (kSpD < uSparkleRange && vWNrm.y > 0.55) {
    vec3 sp = vWPos * uSparkleScale;
    vec3 sc = floor(sp);
    float sh = fract(sin(dot(sc, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    if (sh > 0.8) {
      float s2 = fract(sh * 91.7), s3 = fract(sh * 37.3);
      float ct = mix(0.35, 1.0, s3), st = sqrt(1.0 - ct * ct);
      vec3 nf = vec3(cos(s2 * 6.2831853) * st, ct, sin(s2 * 6.2831853) * st);
      vec3 vv = normalize(cameraPosition - vWPos);
      float gs = pow(max(dot(nf, normalize(vv + uSunDir)), 0.0), 36.0);
      // à l'ombre, quelques reflets du ciel
      float gk = pow(max(dot(nf, normalize(vv + vec3(0.0, 1.0, 0.0))), 0.0), 40.0) * step(0.95, sh);
      float k = smoothstep(0.5, 0.05, length(sp - sc - 0.5)) * (1.0 - smoothstep(uSparkleRange * 0.5, uSparkleRange, kSpD)) * smoothstep(0.55, 0.8, vWNrm.y);
      outgoingLight += (reflectedLight.directDiffuse * gs + reflectedLight.indirectDiffuse * gk * 0.6) * k * uSparkle;
    }
  }
}`;
export function snowSparkle(material, o = {}) {
  const u = { uSparkle: { value: o.amount ?? 8 }, uSparkleScale: { value: o.scale ?? 16 }, uSparkleRange: { value: o.range ?? 26 } };
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, r) => {
    prev.call(material, shader, r);
    if (o.normal !== undefined && shader.uniforms.nStr) shader.uniforms.nStr = { value: o.normal };
    Object.assign(shader.uniforms, u);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uSparkle, uSparkleScale, uSparkleRange;\nvoid main() {')
      .replace('#include <opaque_fragment>', SPARKLE + '\n#include <opaque_fragment>');
  };
  const prevKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => prevKey.call(material) + '-paillettes';
  material.needsUpdate = true;
  return u;
}
