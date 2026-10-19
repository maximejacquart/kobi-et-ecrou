// Nimbara, les îles flottantes : îles, arbres-bulles, cristaux, ruines, maisons sur pilotis, montgolfières,
// mer de nuages, ponts de cordes (maisons, lanternes et ponts servent aussi à Luminbois).
import * as THREE from 'three';
import { G, part, joint, mtx } from '../geo.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mat, glow, terrainMaterial } from '../../engine/materials.js';
import { rockTexture, woodTexture, grassTexture, cobbleTexture, plankTexture, shingleTexture, paintedMetalTexture, treadPlateTexture } from '../../engine/textures.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BoxCollider, CylinderCollider, HeightfieldCollider } from '../../engine/physics.js';
import { noise2, noise3, fbm2, rand, rng as mkRng } from '../../engine/util.js';
import { createWater, createWaterfall, waterSystem } from '../../engine/water/water.js';
import { rockGeo, plankBox, plankPanel, rivets, beam } from './props.js';
import { reeds } from './canyon.js';
import { lights } from '../../engine/lightpool.js';
import { foliage } from '../../engine/shading.js';
import { frameU, LAYERS } from '../../engine/frame.js';
import { csmU, CSM_PARS } from '../../engine/shadows.js';
import { noiseTexture } from '../../engine/sky.js';

const M = {};
function mats() {
  if (M.ready) return M;
  const grass = grassTexture();
  const purple = rockTexture('purple');
  const grey = rockTexture('grey');
  M.island = terrainMaterial({ mapA: grass.map, mapB: purple.map, normalA: grass.normalMap, normalB: purple.normalMap, scaleA: 0.18, scaleB: 0.1, slopeLo: 0.55, slopeHi: 0.78 });
  M.islandGrey = terrainMaterial({ mapA: grass.map, mapB: grey.map, normalA: grass.normalMap, normalB: grey.normalMap, scaleA: 0.18, scaleB: 0.1, slopeLo: 0.55, slopeHi: 0.78 });
  M.stone = terrainMaterial({ mapA: grey.map, mapB: grey.map, normalA: grey.normalMap, normalB: grey.normalMap, scaleA: 0.3, scaleB: 0.25, slopeLo: 0.9, slopeHi: 1 });
  M.trunk = mat('#8a5a3a', { rough: 0.85 });
  // feuillages des arbres-bulles : translucides à contre-jour
  M.leafA = foliage(mat('#ff9ad0', { rough: 0.7, unique: true }));
  M.leafB = foliage(mat('#9ae0ff', { rough: 0.7, unique: true }));
  M.leafC = foliage(mat('#b8f07a', { rough: 0.7, unique: true }));
  for (const k of ['leafA', 'leafB', 'leafC']) M[k].userData.shared = true;
  M.crystal = mat('#7ff3ff', { rough: 0.1, metal: 0.2, emissive: '#2ab8d0', emissiveIntensity: 1.2, transparent: true, opacity: 0.88 });
  M.crystalPink = mat('#ff8ae0', { rough: 0.1, metal: 0.2, emissive: '#d03aa0', emissiveIntensity: 1.2, transparent: true, opacity: 0.88 });
  M.roofA = mat('#ff6f8a', { rough: 0.6 });
  M.roofB = mat('#6a8cff', { rough: 0.6 });
  M.wall = mat('#eedcc0', { rough: 0.85 });
  const wood = woodTexture();
  M.wood = mat('#ffffff', { map: wood.map, rough: 0.85 });
  M.cloth = mat('#ffd23a', { rough: 0.8, side: THREE.DoubleSide });
  M.cloth2 = mat('#ff6f8a', { rough: 0.8, side: THREE.DoubleSide });
  M.lantern = glow('#ffd27a', 3);
  M.ready = true;
  return M;
}
export function skyMats() { return mats(); }

// ------------------------------------------------------------- îles flottantes
const islandCache = new Map();
const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// Creux sculptés dans le dessus d'une île (lagons, ruisseaux, déversoirs), en coordonnées monde :
// { x, z, r, depth } (cuvette) ou { a: [x, z], b: [x, z], r, depth } (chenal) ; bank : part du rayon en pente
// (rive), wobble : rive irrégulière. Renvoie la profondeur du creux en (x, z).
// grow : creux élargi (rive comprise)
function carveDepth(list, x, z, grow = 1) {
  let d = 0;
  for (const c of list) {
    let dist;
    if (c.a) {
      const [ax, az] = c.a, ux = c.b[0] - ax, uz = c.b[1] - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * ux + (z - az) * uz) / (ux * ux + uz * uz)));
      dist = Math.hypot(x - ax - ux * t, z - az - uz * t);
    } else dist = Math.hypot(x - c.x, z - c.z);
    const wob = 1 + (noise2(x * 0.6 + 13.1, z * 0.6 - 4.2) - 0.5) * (c.wobble ?? 0.3);
    const t = dist / (c.r * wob * grow);
    if (t < 1) d = Math.max(d, c.depth * smooth01((1 - t) / (c.bank ?? 0.45)));
  }
  return d;
}
// relief du dessus (avant le bruit) : légèrement bombé, bord à peine plus bas
const topY = (k) => (k > 0.6 ? 0.06 - (k - 0.6) / 0.36 * 0.04 : 0.08 - k / 0.6 * 0.02);

// o.carve : creux (voir carveDepth) ; o.lips : déversoirs [{ dir, width }] (angle, 0 = vers +z) : sous eux, la
// paroi rentre pour ne pas déborder dans la chute d'eau
function islandGeo(radius, depth, seed, o = {}) {
  const key = `${radius}|${depth}|${seed}`;
  const carve = o.carve, cx = o.cx ?? 0, cz = o.cz ?? 0;
  if (!carve && islandCache.has(key)) return islandCache.get(key);
  const pts = [];
  // dessus plat, bord arrondi, dessous en cône irrégulier
  pts.push(new THREE.Vector2(0, -depth));
  for (let i = 1; i <= 10; i++) {
    const t = i / 10;
    const y = -depth + depth * Math.pow(t, 0.75);
    const r = radius * (0.12 + 0.88 * Math.pow(t, 0.55)) * (1 + Math.sin(t * 9 + seed) * 0.05);
    pts.push(new THREE.Vector2(r, y));
  }
  pts.push(new THREE.Vector2(radius * 1.02, -0.6));
  pts.push(new THREE.Vector2(radius * 1.0, -0.15));
  pts.push(new THREE.Vector2(radius * 0.96, 0.02));
  // dessus sculpté : maillage fin (anneaux et secteurs de o.cell, 30 cm par défaut)
  const cs = o.cell ?? 0.3;
  if (carve) for (let r = radius * 0.96 - cs; r > cs * 0.7; r -= cs) pts.push(new THREE.Vector2(r, topY(r / radius)));
  else pts.push(new THREE.Vector2(radius * 0.6, 0.06));
  pts.push(new THREE.Vector2(0, 0.08));
  const g = new THREE.LatheGeometry(pts, carve ? Math.round((radius * Math.PI * 2) / cs) : Math.max(20, Math.round(radius * 3)));
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const wet = new Float32Array(p.count);
  const lipOf = (x, z) => {
    if (!o.lips) return 0;
    const a = Math.atan2(x, z);
    let k = 0;
    for (const l of o.lips) {
      const da = Math.abs(Math.atan2(Math.sin(a - l.dir), Math.cos(a - l.dir)));
      k = Math.max(k, 1 - smooth01((da * radius - l.width * 0.5) / 1.2));
    }
    return k;
  };
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const rr = Math.hypot(v.x, v.z);
    if (v.y < -0.5) {
      let n = noise3(v.x * 0.25 + seed, v.y * 0.3, v.z * 0.25, 3) - 0.5;
      // sous un déversoir, la paroi ne déborde pas dans la chute d'eau
      if (v.y > -depth * 0.5) { const lk = lipOf(v.x, v.z); if (lk > 0) n = n * (1 - lk) + Math.min(n, -0.12) * lk; }
      const k = 1 + n * 0.45;
      p.setXYZ(i, v.x * k, v.y + n * 1.5, v.z * k);
    } else if (rr > 0.1) {
      const cd = carve ? carveDepth(carve, v.x + cx, v.z + cz) : 0;
      wet[i] = cd;
      // relief du dessus effacé dans les creux et sur leurs rives (ligne d'eau régulière)
      const ny = (fbm2(v.x * 0.15 + seed, v.z * 0.15, 2, 5) - 0.5) * 0.3 * (rr / radius) * (carve ? 1 - smooth01(carveDepth(carve, v.x + cx, v.z + cz, 1.6) / 0.05) : 1);
      p.setY(i, Math.max(v.y + ny - cd, rr > radius * 0.98 ? -0.55 : -9));
    }
  }
  g.computeVertexNormals();
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    // rive mouillée un peu plus sombre, sous la ligne d'eau seulement (niveau 0 : le lagon affleure)
    const k = (y > -0.5 || wet[i] > 0 ? 1 : 0.75 + 0.25 * (1 + y / depth)) * (wet[i] > 0 ? 1 - 0.3 * smooth01((0.03 - y) / 0.12) : 1);
    col[i * 3] = k; col[i * 3 + 1] = k; col[i * 3 + 2] = k * 1.05;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (!carve) islandCache.set(key, g);
  return g;
}

// Fond de sable clair sous l'eau d'un creux (un lagon turquoise doit sa couleur à son fond pâle)
function sandBed(L, pos, radius, carve) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const c of carve) {
    for (const [x, z] of c.a ? [c.a, c.b] : [[c.x, c.z]]) {
      x0 = Math.min(x0, x - c.r * 1.2); x1 = Math.max(x1, x + c.r * 1.2);
      z0 = Math.min(z0, z - c.r * 1.2); z1 = Math.max(z1, z + c.r * 1.2);
    }
  }
  const S = 0.2, nx = Math.ceil((x1 - x0) / S), nz = Math.ceil((z1 - z0) / S);
  const pos3 = [], col = [], idx = [], keep = [];
  // fond de galets clairs (l'eau d'une source est limpide), terre mouillée brune juste au-dessus de la ligne d'eau
  const A = new THREE.Color('#a9a48c'), B = new THREE.Color('#e2dcc4'), W = new THREE.Color('#5a5440'), c3 = new THREE.Color();
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = x0 + i * S, z = z0 + j * S;
      const rr = Math.hypot(x - pos.x, z - pos.z) / radius;
      const cd = carveDepth(carve, x, z);
      // le fond affleure juste au-dessus de la ligne d'eau (petite grève) et plonge sous l'herbe au-delà : la
      // limite est l'intersection des deux surfaces, nette et régulière
      keep.push(cd > 0 && rr < 0.955);
      pos3.push(x, pos.y + topY(Math.min(rr, 0.96)) - cd + (cd > 0.06 ? 0.045 : -0.08 + cd * 2.08), z);
      // galets : cellules plus ou moins claires, joints sombres ; la rive émergée est de la terre mouillée
      const peb = noise2(x * 6.5, z * 6.5, 7), joint = Math.abs(noise2(x * 4.1 + 3, z * 4.1, 8) - 0.5);
      c3.copy(A).lerp(B, peb * 0.8 + fbm2(x * 0.9, z * 0.9, 3, 7) * 0.3).multiplyScalar(0.8 + 0.2 * smooth01(joint * 8));
      c3.lerp(W, 1 - smooth01((cd - 0.03) / 0.07));
      col.push(c3.r, c3.g, c3.b);
    }
  }
  const at = (i, j) => j * (nx + 1) + i;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = at(i, j), b = a + 1, c = at(i, j + 1), d = c + 1;
      if (keep[a] && keep[c] && keep[b]) idx.push(a, c, b);
      if (keep[b] && keep[c] && keep[d]) idx.push(b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos3, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  L.add(g.toNonIndexed(), pondMats().sand, null);
}

// Surface réelle d'un maillage posé (matrice M), relevée par lancer de rayon vertical : le dessus d'une île non
// sculptée n'a que trois anneaux de sommets, sa surface interpolée s'écarte de heightAt de plusieurs centimètres.
// probe(x, z) : premier point touché en venant d'en haut ; probe(x, z, true) : en venant d'en bas (dessous de l'île)
const _ray = new THREE.Raycaster();
const _rayMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
function surfaceProbe(geo, M) {
  const mesh = new THREE.Mesh(geo, _rayMat);
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(M);
  mesh.matrixWorld.copy(M);
  const o = new THREE.Vector3(), d = new THREE.Vector3();
  return (x, z, below = false) => {
    _ray.set(o.set(x, below ? -1e4 : 1e4, z), d.set(0, below ? 1 : -1, 0));
    _ray.far = 2e4;
    const hit = _ray.intersectObject(mesh, false)[0];
    return hit ? hit.point.y : null;
  };
}
// Hauteur du sol en (x, z) : terrain du niveau, sinon dessus de l'île flottante qui porte le point (null : le vide)
function groundAt(L, x, z) {
  if (L.heightfield) return L.heightfield.height(x, z);
  for (const s of L.skyIslands || []) {
    if (Math.hypot(x - s.pos.x, z - s.pos.z) > s.radius * 1.05) continue;
    const y = s.probe(x, z);
    if (y !== null) return y;
  }
  return null;
}
// Sol le plus bas (et le plus haut) sous une liste de points [x, z], autour de la hauteur de pose fb (repli : fb là
// où il n'y a rien dessous, ou un sol bien plus bas, qui n'est pas l'appui : objet posé sur un plancher, bord d'île)
function groundSpan(L, pts, fb, drop = 0.6) {
  let lo = Infinity, hi = -Infinity;
  for (const [x, z] of pts) {
    let y = groundAt(L, x, z) ?? fb;
    if (y < fb - drop || y > fb + drop) y = fb;
    lo = Math.min(lo, y); hi = Math.max(hi, y);
  }
  return [lo, hi];
}
// Points d'un cercle de rayon r autour de (x, z) (et le centre)
const ringPts = (x, z, r, n = 8) => [[x, z], ...Array.from({ length: n }, (_, i) => [x + Math.sin((i / n) * Math.PI * 2) * r, z + Math.cos((i / n) * Math.PI * 2) * r])];

// o.tag : étiquette des sols de l'île (un sol étiqueté n'est jamais retenu comme point de reprise après une chute)
export function island(L, pos, radius, o = {}) {
  const m = mats();
  const depth = o.depth ?? radius * 1.4;
  const seed = o.seed ?? Math.floor(rand(0, 1000));
  const carve = o.carve || null;
  // île sculptée : pas de rotation (les creux sont donnés en coordonnées monde)
  const ry = carve ? 0 : rand(0, 6);
  const geo = islandGeo(radius, depth, seed, { carve, lips: o.lips, cx: pos.x, cz: pos.z, cell: o.cell });
  const M = mtx([pos.x, pos.y, pos.z], [0, ry, 0]);
  L.add(geo, o.mat || m.island, M);
  const probe = surfaceProbe(geo, M);
  (L.skyIslands || (L.skyIslands = [])).push({ pos, radius, probe });
  const dig = carve ? (x, z, grow = 1) => carveDepth(carve, x, z, grow) : null;
  // hauteur du dessus en (x, z), relief compris (exacte sur une île sculptée, au maillage fin)
  const heightAt = (x, z) => {
    const wx = x - pos.x, wz = z - pos.z, c = Math.cos(ry), s = Math.sin(ry);
    const vx = wx * c - wz * s, vz = wx * s + wz * c;
    const k = Math.hypot(vx, vz) / radius;
    const ny = (fbm2(vx * 0.15 + seed, vz * 0.15, 2, 5) - 0.5) * 0.3 * k * (carve ? 1 - smooth01(carveDepth(carve, x, z, 1.6) / 0.05) : 1);
    return pos.y + topY(k) + ny - (carve ? carveDepth(carve, x, z) : 0);
  };
  // dessus herbu (pelouse posée par le niveau) ; o.flowers : fleurs des prés
  if (o.grass !== false) (L.islandTops || (L.islandTops = [])).push({ x: pos.x, y: pos.y + 0.06, z: pos.z, r: radius * 0.975, grey: o.mat === m.islandGrey, dig, clear: o.clear, flowers: o.flowers !== false });
  if (carve) {
    sandBed(L, pos, radius, carve);
    // sol praticable : champ de hauteur qui épouse les creux (Kobi y patauge) ; le cylindre, abaissé sous le fond,
    // garde la paroi de l'île. Le champ déborde d'une case et demie du bord d'origine (0,97 r) : sa chute vers le vide
    // (interpolée sur une case) reste au-delà, sans fossé le long du bord
    let deepest = 0;
    for (const c of carve) deepest = Math.max(deepest, c.depth);
    const half = radius + 0.6, size = half * 2, res = Math.ceil(size / 0.3), n = res + 1, step = size / res;
    const h = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = pos.x - half + i * step, z = pos.z - half + j * step;
        h[j * n + i] = Math.hypot(x - pos.x, z - pos.z) <= radius * 0.97 + step * 1.45 ? pos.y + 0.06 - dig(x, z) : pos.y - 60;
      }
    }
    L.game.world.add(new HeightfieldCollider(pos.x - half, pos.z - half, size, res, h, { surface: 'grass', tag: o.tag }));
    L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y - 2.5, pos.y + 0.06 - deepest - 0.15, radius * 0.97, { surface: 'grass', tag: o.tag }));
  } else L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y - 2.5, pos.y + 0.06, radius * 0.97, { surface: 'grass', tag: o.tag }));
  L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y - depth * 0.6, pos.y - 2.5, radius * 0.6, { surface: 'rock', tag: o.tag }));
  // rochers suspendus sous l'île : un rocher tiré sous la paroi est remonté jusqu'à s'y ancrer (sa base, en haut,
  // rentre dans la roche sur tout son pourtour) ; celui qui reste noyé dans la masse est laissé tel quel (invisible)
  if (o.dangles !== false) for (let i = 0; i < Math.round(radius / 3); i++) {
    const a = rand(0, Math.PI * 2), d = rand(0.3, 0.8) * radius;
    const r = rand(0.4, 1.0), h = rand(1.5, 3.5), x = pos.x + Math.cos(a) * d, z = pos.z + Math.sin(a) * d;
    let y = pos.y - depth * rand(0.3, 0.6);
    let roof = -Infinity;
    for (const [px, pz] of ringPts(x, z, r * 0.9)) roof = Math.max(roof, probe(px, pz, true) ?? -Infinity);
    if (roof > -Infinity && y + h / 2 < roof + 0.25) y = roof + 0.25 - h / 2;
    L.add(G.cone(r, h, 6), m.stone, mtx([x, y, z], [Math.PI, rand(0, 6), 0]));
  }
  return { pos, radius, carve, dig, heightAt };
}

// ------------------------------------------------------------- lagons et cascades
const PM = {};
function pondMats() {
  if (PM.sand) return PM;
  PM.sand = mat('#ffffff', { rough: 0.92, vertexColors: true });
  PM.lily = mat('#4fae5a', { rough: 0.55 });
  PM.lily2 = mat('#7cc85a', { rough: 0.55 });
  PM.lotus = mat('#ffb0dc', { rough: 0.5 });
  // galets de rive : gris clair, beige, lavande (la roche des îles roulée par l'eau)
  PM.pebbles = ['#9d978a', '#8f8d92', '#a89f8c', '#8e86a0'].map((c) => mat(c, { rough: 0.75 }));
  return PM;
}

// Plan d'eau d'un creux d'île : contour relevé par rayons depuis o.at [x, z] (forme étoilée autour de ce point),
// niveau o.y (par défaut au ras de la rive). o.lip { dir, width, speed } : déversoir sur le bord de l'île (angle,
// 0 = vers +z) ; l'eau file vers lui (o.current) et tombe en cascade jusque dans la mer de nuages (o.to : pied de la
// chute, o.mistY : embruns). o.water : options de createWater ; o.pads : nénuphars ancrés (nombre) ; o.bank : rive
// de galets et touffes de joncs (false pour s'en passer) ; o.keep : zones de rive laissées libres [{ x, z, r }]
// (source, gouttière…). Renvoie { body, fall, shore } (shore : points de la ligne d'eau [x, z]).
export function islandPond(L, isl, o = {}) {
  const { pos, radius, dig } = isl;
  const level = o.y ?? pos.y;
  const [ax, az] = o.at;
  const cell = o.cell ?? 0.25;
  // l'eau s'arrête avant le rebord (la grille déborde d'une case et demie du contour)
  const rimMax = radius * 0.95 - cell * 1.5;
  // le contour déborde un peu du creux (sous la rive, la surface est cachée par le sol) : pas d'encoche entre deux
  // rayons le long d'un chenal
  const shape = [], shore = [];
  const N = o.rays ?? 240;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
    let r = 0, edge = -1;
    for (; r < 40; r += 0.05) {
      const x = ax + dx * r, z = az + dz * r;
      if (Math.hypot(x - pos.x, z - pos.z) > rimMax) { edge = -1; break; }
      // ligne d'eau : le fond remonte au niveau de l'eau (sol à +0,06 au-dessus du niveau, moins le creux)
      if (edge < 0 && dig(x, z) < 0.065) edge = r;
      if (dig(x, z) < 0.002) { r = Math.min(r + 0.35, rimMax - Math.hypot(ax - pos.x + dx * r, az - pos.z + dz * r) + r); break; }
    }
    shape.push([ax + dx * r, az + dz * r]);
    // rayons qui filent jusqu'au rebord (déversoir) : pas de rive
    if (edge >= 0) shore.push([ax + dx * edge, az + dz * edge]);
  }
  const lip = o.lip;
  let lx = 0, lz = 0, ldx = 0, ldz = 0;
  if (lip) {
    ldx = Math.sin(lip.dir); ldz = Math.cos(lip.dir);
    lx = pos.x + ldx * radius * 0.95; lz = pos.z + ldz * radius * 0.95;
  }
  // courant uniforme vers le déversoir (une carte de courant convergente étirerait l'écume en étoile) ; pas de
  // miroir planaire (une seconde image de toute la scène pour une mare) : reflets tracés à l'écran et ciel
  const cur = o.current ?? 0.06;
  // eau de source : limpide, un peu verte en profondeur (pas le turquoise d'un lagon de carte postale)
  const body = createWater(L, {
    shape, y: level, preset: 'lagon', cell, foam: 0.5, shore: 0.18, reflect: false, caustics: 0.45, causticScale: 0.16,
    shallow: '#86e2cf', deep: '#0f4e58', absorb: [0.5, 0.12, 0.1], turbidity: 0.1,
    waves: [[0.4, 0.008, 2.2], [1.9, 0.006, 1.4], [3.1, 0.004, 0.9]],
    flow: lip ? [ldx * cur, ldz * cur] : [0.03, 0.02],
    ...o.water,
  });
  let fall = null;
  if (lip) {
    const to = o.to ?? -31;
    const mistY = o.mistY ?? -24.5;
    const vh = lip.speed ?? 1.7;
    // deux voiles décalés (largeur, vitesse) : une chute plus dense, qui se divise en filets
    const falls = [[1, vh, 0], [0.72, vh * 0.86, 0.3]].slice(0, o.layers ?? 2).map(([wk, sp, back]) => createWaterfall(L, {
      from: [lx - ldx * back, level - back * 0.1, lz - ldz * back], to, width: lip.width * wk, dir: lip.dir, speed: sp,
      tint: o.tint || '#c8f6f0', pool: { y: mistY }, spray: (o.spray ?? 1.4) * wk,
    }));
    for (const f of falls) {
      for (const c of f.group.children) {
        // pas de disque d'écume au pied : la chute se perd dans les nuages (bouffées de brume)
        if (c.geometry.type === 'PlaneGeometry') c.visible = false;
        // en plein ciel, l'eau blanchie doit rester éclatante
        else c.material.uniforms.uShade.value *= o.bright ?? 1.7;
      }
    }
    fall = falls[0];
    const T = Math.sqrt((2 * (level - to)) / 9.8);
    const fx = lx + ldx * vh * T, fz = lz + ldz * vh * T;
    // bouffées d'embruns qui montent de la mer de nuages, là où l'eau s'y enfonce
    cloudPuffs(L, new THREE.Vector3(fx, 0, fz), o.billows ?? 3, lip.width + 2, mistY + 1, lip.width * 2.2 + 10, '#ffffff', { seed: Math.round(fx * 7 + fz * 13), ySpread: 2, opacity: 0.6, bow: 0.22 });
    if (BOW_N.value < 6) BOW_FEET.value[BOW_N.value++].set(fx, mistY, fz, lip.width * 3 + 16);
  }
  const keep = o.keep || [];
  if (o.bank !== false) pondBank(L, level, shore, { keep, seed: Math.round(ax * 13 + az * 7), reeds: o.reeds ?? 3 });
  if (o.pads) anchoredPads(L, body, { count: o.pads, shore, dig, avoid: [...keep, ...(lip ? [{ x: lx, z: lz, r: lip.width * 0.5 + 0.4 }] : [])], seed: Math.round(ax * 3 + az) });
  return { body, fall, shore };
}

// Rive d'une mare : galets à demi immergés le long de la ligne d'eau, quelques pierres plus grosses, touffes de
// joncs (o.reeds : nombre de touffes) ; o.keep : bouts de rive laissés libres
function pondBank(L, level, shore, o = {}) {
  const R = mkRng(o.seed ?? 3);
  const free = (x, z) => !(o.keep || []).some((c) => Math.hypot(x - c.x, z - c.z) < c.r);
  // échantillons espacés d'environ 0,3 m le long de la rive
  const pts = [];
  let last = null;
  for (const p of shore) {
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.3) continue;
    pts.push(p);
    last = p;
  }
  const pm = pondMats().pebbles;
  // galets par petits groupes (le courant les rassemble), avec des trous : jamais un collier régulier
  pts.forEach(([x, z], i) => {
    if (!free(x, z) || noise2(x * 1.3, z * 1.3, o.seed ?? 3) < 0.42) return;
    for (let k = 0, n = 1 + Math.floor(R() * 3); k < n; k++) {
      const big = R() < 0.08;
      const sz = big ? 0.28 + R() * 0.18 : 0.06 + R() * 0.1;
      const px = x + (R() - 0.5) * 0.45, pz = z + (R() - 0.5) * 0.45;
      L.add(rockGeo(i * 7 + k), pm[Math.floor(R() * pm.length)], mtx([px, level - sz * 0.2 + (big ? 0.04 : 0), pz], [0, R() * 6.28, 0], [sz * (1 + R() * 0.5), sz * (0.45 + R() * 0.25), sz * (1 + R() * 0.4)]));
    }
  });
  // joncs : touffes serrées au bord de l'eau, les pieds dans la vase
  const tufts = [];
  for (let k = 0; k < (o.reeds ?? 3) && pts.length; k++) {
    const [x, z] = pts[Math.floor(R() * pts.length)];
    if (!free(x, z)) continue;
    for (let j = 0; j < 9; j++) tufts.push({ x: x + (R() - 0.5) * 0.7, y: level - 0.02, z: z + (R() - 0.5) * 0.7 });
  }
  if (tufts.length) reeds(L, tufts, { base: '#2a5e30', tip: '#9ccf6a', height: [0.7, 1.15], heads: 0.25, seed: o.seed });
}

// Nénuphars ancrés (une tige les retient au fond) : posés en eau assez profonde, loin des rives et du déversoir, sans
// se chevaucher ; ils suivent la houle et tournent un peu autour de leur tige, sans jamais dériver
function anchoredPads(L, body, o) {
  const R = mkRng(o.seed ?? 9);
  const xs = o.shore.map((p) => p[0]), zs = o.shore.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const placed = [];
  for (let k = 0; k < 400 && placed.length < o.count; k++) {
    const x = x0 + R() * (x1 - x0), z = z0 + R() * (z1 - z0);
    const i = placed.length, sc = 0.28 + ((i * 37) % 10) * 0.02;
    if (o.dig(x, z) < 0.3 || !body.contains(x, z)) continue;
    if (o.shore.some((p) => Math.hypot(p[0] - x, p[1] - z) < sc + 0.25)) continue;
    if (o.avoid.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + sc)) continue;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + sc + 0.08)) continue;
    const obj = lilyPad(i, sc);
    obj.userData.noAO = true;
    L.root.add(obj);
    placed.push({ obj, x, z, r: sc, yaw: R() * 6.28, ph: R() * 6.28 });
  }
  body.updaters.push((dt, t) => {
    for (const p of placed) {
      p.obj.position.set(p.x, body.heightAt(p.x, p.z, t) + 0.004, p.z);
      p.obj.rotation.set(Math.sin(t * 1.3 + p.ph) * 0.03, p.yaw + Math.sin(t * 0.3 + p.ph) * 0.12, Math.cos(t * 1.1 + p.ph) * 0.03);
    }
  });
  return placed;
}

// Bloc de roche arrondi par l'érosion (normales lisses), base aplatie, quelques arêtes de strates
const boulders = new Map();
function boulderGeo(seed) {
  if (boulders.has(seed)) return boulders.get(seed);
  let g = new THREE.IcosahedronGeometry(1, 5);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = noise3(v.x * 1.1 + seed * 7, v.y * 1.1, v.z * 1.1, seed) * 0.5 + noise3(v.x * 3, v.y * 3, v.z * 3, seed + 5) * 0.12;
    v.multiplyScalar(0.72 + n);
    // strates : légers ressauts horizontaux
    v.y += Math.sin(v.y * 9 + seed) * 0.025;
    if (v.y < -0.25) v.y = -0.25 + (v.y + 0.25) * 0.25;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  g.userData.shared = true;
  boulders.set(seed, g);
  return g;
}

// Place pavée (village, aire d'atterrissage) : pavés ronds posés sur le relief de l'île, bord irrégulier que
// l'herbe recouvre
export function plaza(L, isl, x, z, r, o = {}) {
  if (!PM.cobble) {
    const t = cobbleTexture();
    PM.cobble = mat('#ffffff', { map: t.map, normalMap: t.normalMap, rough: 0.85 });
  }
  const seed = o.seed ?? 3;
  const edge = (a) => r * (0.84 + 0.16 * noise2(Math.cos(a) * 2.2 + seed, Math.sin(a) * 2.2, seed));
  const rings = Math.ceil(r / 0.25), segs = Math.ceil((r * Math.PI * 2) / 0.25);
  const pos = [], uv = [], idx = [];
  pos.push(x, isl.heightAt(x, z) + 0.03, z);
  uv.push(x * 0.4, z * 0.4);
  for (let j = 1; j <= rings; j++) {
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2, rr = edge(a) * (j / rings);
      const px = x + Math.sin(a) * rr, pz = z + Math.cos(a) * rr;
      pos.push(px, isl.heightAt(px, pz) + 0.03, pz);
      uv.push(px * 0.4, pz * 0.4);
    }
  }
  for (let i = 0; i < segs; i++) idx.push(0, 1 + i, 1 + ((i + 1) % segs));
  for (let j = 1; j < rings; j++) {
    const a0 = 1 + (j - 1) * segs, a1 = 1 + j * segs;
    for (let i = 0; i < segs; i++) {
      const i1 = (i + 1) % segs;
      idx.push(a0 + i, a1 + i, a1 + i1, a0 + i, a1 + i1, a0 + i1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  L.add(g, PM.cobble, null);
}

// ------------------------------------------------------------- d'où vient l'eau
// Source de rocher : l'eau sourd d'une fente entre de gros blocs et tombe en filet dans la mare.
// o : { at: [x, z] (où le filet touche l'eau), dir (angle vers la mare, 0 = +z), h (hauteur de la fente), width }
export function springRocks(L, pond, o) {
  const m = mats();
  const y = pond.body.y, ground = y + 0.06;
  const [x, z] = o.at, dx = Math.sin(o.dir), dz = Math.cos(o.dir), rx = dz, rz = -dx;
  const B = [x - dx * 1.2, z - dz * 1.2];
  // matière des îles : roche violette sur les flancs, mousse sur les dessus
  const blk = (fwd, side, up, s, seed, ry) => L.add(boulderGeo(seed), m.island, mtx([B[0] + dx * fwd + rx * side, ground + up, B[1] + dz * fwd + rz * side], [0, ry, 0], s));
  // gros bloc fendu au milieu, deux épaules, un chapeau en surplomb au-dessus de la fente
  blk(-0.1, 0.55, 0.3, [0.95, 1.35, 0.9], 2, o.dir);
  blk(-0.15, -0.6, 0.25, [0.85, 1.15, 0.85], 4, o.dir + 1.3);
  blk(0.2, 1.25, 0.15, [0.6, 0.6, 0.65], 1, o.dir + 2.1);
  blk(0.1, -1.3, 0.1, [0.55, 0.5, 0.6], 5, o.dir + 0.4);
  blk(-0.1, 0, (o.h ?? 0.9) + 0.45, [0.75, 0.38, 0.6], 3, o.dir + 0.8);
  // pierres de gué devant la source
  blk(0.75, 0.45, -0.1, [0.32, 0.18, 0.28], 0, 0.5);
  blk(0.85, -0.5, -0.1, [0.25, 0.14, 0.3], 1, 2.2);
  L.game.world.add(new CylinderCollider(B[0], B[1], ground - 0.5, ground + (o.h ?? 0.9) + 0.7, 1.15, { surface: 'rock' }));
  const w = o.width ?? 0.6;
  createWaterfall(L, {
    from: [x - dx * 0.55, y + (o.h ?? 0.9), z - dz * 0.55], to: y, width: w, dir: o.dir, speed: 0.9,
    tint: '#d8f8f2', pool: { y }, spray: 0.3, footR: 0.75,
  });
}

// Résurgence : l'eau remonte du fond entre les cristaux (bouillonnement continu, lueur sous la surface)
export function crystalSpring(L, pond, o) {
  const [x, z] = o.at;
  const body = pond.body;
  body.addLamp(new THREE.Vector3(x, body.y + 0.25, z), o.color || '#ff8ae0', 0.8);
  let tt = 0;
  body.updaters.push((dt) => {
    const S = waterSystem();
    if (!S) return;
    tt -= dt;
    if (tt > 0) return;
    tt = 0.12;
    const a = Math.random() * 6.28, r = Math.random() * 0.25;
    S.ripple.impulse(x + Math.cos(a) * r, z + Math.sin(a) * r, 0.22, 0.012);
  });
}

// Nénuphar (feuille échancrée, parfois une fleur) : posé sur l'eau par anchoredPads
let lilyGeo = null;
function lilyPad(i = 0, size) {
  const m = pondMats();
  if (!lilyGeo) {
    lilyGeo = new THREE.CylinderGeometry(1, 1, 0.03, 18, 1, false, 0.4, Math.PI * 2 - 0.4);
    lilyGeo.userData.shared = true;
  }
  const g = new THREE.Group();
  const s = size ?? 0.32 + ((i * 37) % 10) * 0.025;
  const pad = new THREE.Mesh(lilyGeo, i % 3 ? m.lily : m.lily2);
  pad.scale.set(s, 1, s);
  g.add(pad);
  if (i % 3 === 0) {
    for (let k = 0; k < 5; k++) {
      const pt = new THREE.Mesh(G.cone(0.06, 0.16, 5), m.lotus);
      pt.position.set(Math.sin(k * 1.26) * 0.05, 0.08, Math.cos(k * 1.26) * 0.05);
      pt.rotation.set(Math.cos(k * 1.26) * 0.5, 0, -Math.sin(k * 1.26) * 0.5);
      g.add(pt);
    }
    const heart = new THREE.Mesh(G.sphere(0.035, 6, 4), mats().cloth);
    heart.position.y = 0.07;
    g.add(heart);
  }
  return g;
}

// Arbre-bulle (tronc courbe + boules de feuillage pastel)
export function bubbleTree(L, pos, seed = 1, scale = 1) {
  const m = mats();
  const R = mkRng(seed);
  const h = (3 + R() * 2.5) * scale;
  const lean = (R() - 0.5) * 0.5;
  const leaf = [m.leafA, m.leafB, m.leafC][Math.floor(R() * 3)];
  const top = [pos.x + Math.sin(lean) * h * 0.5, pos.y + h, pos.z];
  const balls = [];
  for (let i = 0; i < 4; i++) {
    const r = (0.9 + R() * 0.8) * scale;
    const c = new THREE.Vector3(top[0] + (R() - 0.5) * 1.6 * scale, top[1] + (R() - 0.3) * 1.2 * scale, top[2] + (R() - 0.5) * 1.6 * scale);
    balls.push([c, r]);
    L.add(G.sphere(1, 16, 12), leaf, mtx(c.toArray(), [0, 0, 0], r));
  }
  // tronc droit, du pied (sur l'axe de sa collision, enfoncé dans le sol le plus bas sous lui) jusque dans le feuillage
  // (la tête entre de 25 cm dans la boule la plus proche)
  const T = new THREE.Vector3(...top);
  const [c0, r0] = balls.reduce((b, x) => (x[0].distanceTo(T) - x[1] < b[0].distanceTo(T) - b[1] ? x : b));
  if (c0.distanceTo(T) > r0 - 0.25 * scale) T.sub(c0).setLength(r0 - 0.25 * scale).add(c0);
  const B = new THREE.Vector3(pos.x, groundSpan(L, ringPts(pos.x, pos.z, 0.3 * scale), pos.y)[0] - 0.08, pos.z);
  const len = T.distanceTo(B);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), T.clone().sub(B).normalize());
  L.add(G.cyl(0.18 * scale, 0.3 * scale, len, 8), m.trunk, new THREE.Matrix4().compose(B.clone().add(T).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y, pos.y + h, 0.35 * scale, { surface: 'wood' }));
}

// Grappe de cristaux lumineux
export function crystals(L, pos, n = 5, pink = false, scale = 1) {
  const m = mats();
  const e = new THREE.Euler(), q = new THREE.Quaternion(), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const h = rand(0.8, 2.6) * scale;
    const a = rand(0, Math.PI * 2), d = rand(0, 0.7) * scale;
    const x = pos.x + Math.cos(a) * d, z = pos.z + Math.sin(a) * d, r = [rand(-0.4, 0.4), rand(0, 6), rand(-0.4, 0.4)];
    // pointe penchée : toute sa base (pentagone de 0,25 m) est enfoncée de 3 cm au moins dans le sol sous elle
    q.setFromEuler(e.set(r[0], r[1], r[2]));
    let y = pos.y + h * 0.4, sink = 0;
    for (let k = 0; k < 5; k++) {
      const t = (k / 5) * Math.PI * 2;
      v.set(Math.sin(t) * 0.25 * scale, -h / 2, Math.cos(t) * 0.25 * scale).applyQuaternion(q);
      const g = groundAt(L, x + v.x, z + v.z);
      if (g !== null && Math.abs(g - pos.y) < 0.5) sink = Math.max(sink, y + v.y - (g - 0.03));
    }
    y -= sink;
    L.add(G.cyl(0, 0.25 * scale, h, 5), pink ? m.crystalPink : m.crystal, mtx([x, y, z], r));
  }
  lights.add({ pos: new THREE.Vector3(pos.x, pos.y + 1.1 * scale, pos.z), color: pink ? '#ff5ad0' : '#4ad8ff', intensity: 14 * scale, range: 7 * scale, priority: 1 });
}

// Ruines : colonne, arche
// Colonne cannelée : plinthe, tore, fût à 16 cannelures légèrement galbé, chapiteau (échine + abaque) ;
// cassée : sommet déchiqueté et éclats au pied
const colGeo = new Map();
function columnShaft(h, broken, seed) {
  const key = h + '|' + broken + '|' + seed;
  if (colGeo.has(key)) return colGeo.get(key);
  const g = new THREE.CylinderGeometry(0.6, 0.66, h, 64, Math.max(2, Math.ceil(h * 2)), false).toNonIndexed();
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const r = Math.hypot(v.x, v.z);
    if (r < 0.05) {
      if (broken && v.y > 0) v.y -= 0.25 + noise2(v.x * 3 + seed, v.z * 3, seed) * 0.3;
      p.setXYZ(i, v.x, v.y, v.z);
      continue;
    }
    const a = Math.atan2(v.z, v.x);
    const t = (v.y + h / 2) / h;
    const flute = Math.pow(Math.abs(Math.cos(a * 8)), 0.6);
    const k = (1 - 0.045 * flute) * (1 + 0.025 * Math.sin(t * Math.PI));
    let y = v.y;
    if (broken && v.y > 0) y -= Math.pow(noise2(Math.cos(a) * 2.5 + seed, Math.sin(a) * 2.5, seed + 3), 1.5) * 0.9;
    p.setXYZ(i, v.x * k, y, v.z * k);
  }
  g.computeVertexNormals();
  g.userData.shared = true;
  colGeo.set(key, g);
  return g;
}
export function column(L, pos, h = 6, broken = false) {
  const m = mats();
  const at = (y, r) => mtx([pos.x, pos.y + y, pos.z], r || [0, 0, 0]);
  // plinthe : elle descend jusqu'au sol le plus bas sous son emprise (posée à plat sur un dessus d'île bombé)
  const foot = [];
  for (const u of [-0.85, 0, 0.85]) for (const v of [-0.85, 0, 0.85]) foot.push([pos.x + u, pos.z + v]);
  const y0 = Math.min(0, groundSpan(L, foot, pos.y)[0] - pos.y - 0.04);
  L.add(G.rbox(1.75, 0.32 - y0, 1.75, 0.05), m.stone, at((0.32 + y0) / 2));
  L.add(G.cyl(0.82, 0.86, 0.12, 24), m.stone, at(0.38));
  L.add(G.torus(0.72, 0.09, 8, 28), m.stone, at(0.5, [Math.PI / 2, 0, 0]));
  const tilt = broken ? [rand(-0.05, 0.05), rand(0, 6), rand(-0.05, 0.05)] : [0, rand(0, 6), 0];
  L.add(columnShaft(h, broken, Math.floor(pos.x * 7 + pos.z * 3) % 13), m.stone, at(h / 2 + 0.5, tilt));
  if (!broken) {
    L.add(G.torus(0.62, 0.06, 8, 28), m.stone, at(h + 0.44, [Math.PI / 2, 0, 0]));
    L.add(G.cyl(0.85, 0.62, 0.3, 28), m.stone, at(h + 0.56));
    L.add(G.rbox(1.75, 0.32, 1.75, 0.05), m.stone, at(h + 0.84));
  } else {
    // éclats tombés au pied : à moitié enfoncés dans le sol sous eux (jamais au-dessus du vide, au bord d'une île)
    for (let k = 0; k < 3; k++) {
      let a, d, x, z, g;
      for (let t = 0; t < 8; t++) {
        a = rand(0, 6); d = rand(1.1, 1.8); x = pos.x + Math.cos(a) * d; z = pos.z + Math.sin(a) * d;
        g = groundAt(L, x, z);
        if (g !== null && Math.abs(g - pos.y) < 0.5) break;
        g = null;
      }
      if (g === null) continue;
      const r = rand(0.16, 0.3);
      L.add(G.dodeca(r, 0), m.stone, mtx([x, g + 0.05 - r * 0.3, z], [rand(0, 3), rand(0, 3), rand(0, 3)], [1, 0.7, 1]));
    }
  }
  L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y, pos.y + h + 1, broken ? 0.65 : 0.85, { surface: 'rock' }));
}

// Arche : deux colonnes et un entablement mouluré assorti (architrave à deux fasces et listel, frise à triglyphes et
// rosaces, denticules sous la corniche), taillé en trois blocs jointifs au droit des colonnes, un peu tassés
// demi-profil de l'entablement [hauteur, demi-épaisseur], du bas au sommet (centre à 0, hauteur totale 0,8)
const ENTAB = [[-0.4, 0.58], [-0.24, 0.58], [-0.24, 0.61], [-0.1, 0.61], [-0.1, 0.645], [-0.045, 0.645], [-0.045, 0.6],
  [0.17, 0.6], [0.17, 0.62], [0.26, 0.62], [0.26, 0.71], [0.29, 0.74], [0.35, 0.74], [0.4, 0.66]];
function entabBlock(len) {
  const sh = new THREE.Shape();
  ENTAB.forEach(([y, h], i) => (i ? sh.lineTo(-h, y) : sh.moveTo(-h, y)));
  for (let i = ENTAB.length - 1; i >= 0; i--) sh.lineTo(ENTAB[i][1], ENTAB[i][0]);
  sh.closePath();
  return new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false }).rotateY(Math.PI / 2).translate(-len / 2, 0, 0);
}
export function arch(L, pos, yaw = 0, w = 6, h = 6) {
  const m = mats();
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  for (const s of [-1, 1]) {
    const p = new THREE.Vector3(s * w / 2, 0, 0).applyQuaternion(q).add(pos);
    column(L, p, h);
  }
  const top = new THREE.Vector3(0, h + 1.3, 0).applyQuaternion(q).add(pos);
  const len = w + 1.8, k = kit(), R = mkRng(Math.floor(pos.x * 13 + pos.z * 7) & 0xffff);
  const cuts = [-len / 2, -w / 2, w / 2, len / 2];
  for (let i = 0; i < 3; i++) {
    const x0 = cuts[i] + (i ? 0.012 : 0), x1 = cuts[i + 1] - (i < 2 ? 0.012 : 0);
    k.put(m.stone, entabBlock(x1 - x0).rotateX((R() - 0.5) * 0.012).rotateZ((R() - 0.5) * 0.01).translate((x0 + x1) / 2, i === 1 ? -0.025 : (R() - 0.5) * 0.01, 0));
  }
  for (const s of [-1, 1]) {
    // triglyphes au droit des colonnes et entre elles, rosaces sur les métopes
    const tri = [-w / 2, -w / 4, 0, w / 4, w / 2];
    for (const x of tri) for (const dx of [-0.13, 0, 0.13]) k.put(m.stone, new THREE.BoxGeometry(0.09, 0.2, 0.035).translate(x + dx, 0.065, s * 0.615));
    for (let i = 0; i < tri.length - 1; i++) {
      const x = (tri[i] + tri[i + 1]) / 2;
      k.put(m.stone, new THREE.CylinderGeometry(0.075, 0.085, 0.03, 10).rotateX(Math.PI / 2).translate(x, 0.065, s * 0.612));
      k.put(m.stone, new THREE.SphereGeometry(0.035, 8, 4).translate(x, 0.065, s * 0.627));
    }
    // denticules sous la corniche
    for (let x = -len / 2 + 0.12; x < len / 2 - 0.08; x += 0.17) k.put(m.stone, new THREE.BoxGeometry(0.09, 0.085, 0.07).translate(x, 0.215, s * 0.65));
  }
  // denticules en retour sur les bouts
  for (const s of [-1, 1]) for (let z = -0.55; z < 0.6; z += 0.17) k.put(m.stone, new THREE.BoxGeometry(0.07, 0.085, 0.09).translate(s * (len / 2 + 0.03), 0.215, z));
  k.add(L, new THREE.Matrix4().compose(top, q, new THREE.Vector3(1, 1, 1)));
  L.game.world.add(new BoxCollider(top, new THREE.Vector3((w + 1.8) / 2, 0.4, 0.7), q, { surface: 'rock' }));
}

// Maison sur pilotis au toit rond : bardage de planches peintes cerclé de fer, toit en bardeaux, porte en planches
// ferrée, hublots de laiton rivetés, plancher et pilotis contreventés, échelle. o.roof : 'a' (rose) ou 'b' (bleu)
const HM = {};
function hutMats() {
  if (HM.ready) return HM;
  const tm = (t, o) => mat('#ffffff', { map: t.map, normalMap: t.normalMap, ...o });
  HM.board = tm(plankTexture('#9a6a40', 'hut-board', { paint: '#f1dfc2', chip: 0.4, wear: 0.5, seed: 11 }), { rough: 0.72 });
  HM.timber = tm(plankTexture('#8a5a3a', 'hut-timber', { wear: 0.6, knots: 1.5, seed: 13 }), { rough: 0.8 });
  HM.door = tm(plankTexture('#7a4a2a', 'hut-door', { paint: '#5f9a86', chip: 0.45, wear: 0.6, seed: 17 }), { rough: 0.65 });
  HM.roofA = tm(shingleTexture('#ff8aa2', 'hut-roof-a', { rows: 6, cols: 4, round: 0.75, moss: 0.12 }), { rough: 0.6 });
  HM.roofB = tm(shingleTexture('#86a4ff', 'hut-roof-b', { rows: 6, cols: 4, round: 0.75, moss: 0.12 }), { rough: 0.6 });
  HM.iron = mat('#3b3542', { metal: 0.7, rough: 0.45 });
  HM.brass = mat('#d2a650', { metal: 0.85, rough: 0.3, coat: 0.4 });
  HM.inner = mat('#3a2a22', { rough: 0.9, side: THREE.DoubleSide });
  // sous-face du débord de toit : planches teintées sombre (sans liseré : vu en rasant, il blanchirait tout le dessous)
  const sf = plankTexture('#8a5a3a', 'hut-timber', { wear: 0.6, knots: 1.5, seed: 13 });
  HM.soffit = mat('#6a4c38', { map: sf.map, normalMap: sf.normalMap, rough: 0.9, side: THREE.DoubleSide, rim: 0 });
  HM.porthole = glow('#ffd27a', 1.5);
  HM.ready = true;
  return HM;
}
const ni = (g) => (g.index ? g.toNonIndexed() : g);
export function stiltHouse(L, pos, yaw = 0, o = {}) {
  const m = mats(), H = hutMats();
  const parts = new Map();
  const put = (mt, g) => { if (!parts.has(mt)) parts.set(mt, []); parts.get(mt).push(ni(g)); return g; };
  const R = mkRng(Math.floor(pos.x * 7 + pos.z * 13) & 0xffff);
  const DECK = 1.8, WALL = 2.02, TOP = 4.4;
  const P = (x, y, z) => new THREE.Vector3(x, y, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(pos);
  // sol sous un point local (x, z), relatif au pied de la maison (0 au-dessus du vide)
  const gnd = (pts) => groundSpan(L, pts.map(([x, z]) => { const w = P(x, 0, z); return [w.x, w.z]; }), pos.y).map((y) => y - pos.y);
  // pilotis : six poteaux équarris sur des pierres plates, contreventés deux à deux, cerce sous le plancher ; chaque
  // pierre descend jusqu'au sol le plus bas sous elle (posée sur tout son pourtour) et dépasse du plus haut
  const posts = [];
  for (let k = 0; k < 6; k++) {
    const a = (k + 0.5) / 6 * Math.PI * 2, x = Math.sin(a) * 1.75, z = Math.cos(a) * 1.75;
    posts.push([x, z]);
    put(H.timber, plankBox(0.2, DECK - 0.05, 0.2, 1, R()).rotateY(a).translate(x, (DECK - 0.05) / 2, z));
    const [lo, hi] = gnd(ringPts(x, z, 0.27));
    const y0 = Math.min(-0.04, lo - 0.05), y1 = Math.max(0.12, hi + 0.06);
    put(m.stone, new THREE.CylinderGeometry(0.2, 0.27, y1 - y0, 7).rotateY(R() * 3).translate(x, (y0 + y1) / 2, z));
  }
  for (let k = 0; k < 6; k++) {
    const [x0, z0] = posts[k], [x1, z1] = posts[(k + 1) % 6];
    put(H.timber, beam(new THREE.Vector3(x0 * 0.97, 0.3, z0 * 0.97), new THREE.Vector3(x1 * 0.97, DECK - 0.35, z1 * 0.97), 0.045));
  }
  put(H.timber, new THREE.TorusGeometry(1.75, 0.09, 6, 36).rotateX(Math.PI / 2).translate(0, DECK - 0.17, 0));
  // plancher : planches en travers, coupées au rond, sur la cerce
  for (let z = -2.4 + 0.11; z < 2.4; z += 0.225) {
    const len = 2 * Math.sqrt(Math.max(0, 2.4 * 2.4 - z * z)) - 0.06 - R() * 0.08;
    if (len < 0.4) continue;
    put(H.timber, plankBox(len, 0.08, 0.21, 1, R()).translate((R() - 0.5) * 0.04, DECK - 0.04, z));
  }
  // bardage : planches debout autour du mur (ouverture de la porte vers +z), doublage sombre derrière les jointures
  const n = 26, step = (Math.PI * 2) / n;
  put(H.inner, new THREE.CylinderGeometry(WALL - 0.05, WALL - 0.05, TOP - DECK, n, 1, true).translate(0, (DECK + TOP) / 2, 0));
  for (let i = 0; i < n; i++) {
    const a = (i + 0.5) * step, door = Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.3;
    const y0 = door ? DECK + 1.86 : DECK, hh = TOP - y0;
    const r = WALL + (R() - 0.5) * 0.015;
    put(H.board, plankBox(step * WALL - 0.02, hh, 0.06, 1, R()).rotateZ((R() - 0.5) * 0.01).rotateY(a).translate(Math.sin(a) * r, y0 + hh / 2, Math.cos(a) * r));
  }
  // cerclages de fer, interrompus au droit de la porte (ils s'arrêtent dans le chambranle), rivetés
  const gap = 0.26, riv = [];
  for (const y of [DECK + 0.25, TOP - 0.22]) {
    put(H.iron, new THREE.TorusGeometry(WALL + 0.045, 0.032, 5, 52, Math.PI * 2 - gap * 2).rotateX(Math.PI / 2).rotateY(-(Math.PI / 2 + gap)).translate(0, y, 0));
    for (let a = gap + 0.2; a < Math.PI * 2 - gap - 0.1; a += 0.26) rivets(riv, [[Math.sin(a) * (WALL + 0.075), y, Math.cos(a) * (WALL + 0.075)]], [Math.sin(a), 0, Math.cos(a)], 0.022);
  }
  // porte : planches debout, traverses et écharpe, chambranle, pentures et anneau
  const dz = WALL - 0.02;
  put(H.door, plankPanel(0.9, 1.82, 4, { vertical: true, thick: 0.05, seed: 3 }).translate(0, DECK + 0.91, dz - 0.05));
  for (const y of [DECK + 0.3, DECK + 1.5]) put(H.door, plankBox(0.86, 0.12, 0.04, 1, y).translate(0, y, dz + 0.02));
  put(H.door, plankBox(1.25, 0.11, 0.04, 1, 0.4).rotateZ(Math.atan2(1.2, 0.76)).translate(0, DECK + 0.9, dz + 0.02));
  for (const s of [-1, 1]) put(H.timber, plankBox(0.11, 1.95, 0.13, 1, s).translate(s * 0.52, DECK + 0.97, dz));
  put(H.timber, plankBox(1.2, 0.13, 0.15, 1, 0.7).translate(0, DECK + 1.92, dz + 0.01));
  for (const y of [DECK + 0.3, DECK + 1.5]) {
    put(H.iron, new THREE.BoxGeometry(0.42, 0.06, 0.015).translate(-0.24, y, dz + 0.05));
    rivets(riv, [[-0.38, y, dz + 0.058], [-0.12, y, dz + 0.058]], [0, 0, 1], 0.016);
  }
  // anneau de tirage pendu à un piton planté dans la porte, sur une platine
  put(H.iron, new THREE.TorusGeometry(0.07, 0.014, 5, 14).translate(0.3, DECK + 0.95, dz + 0.06));
  put(H.iron, new THREE.CylinderGeometry(0.05, 0.05, 0.012, 10).rotateX(Math.PI / 2).translate(0.3, DECK + 1.02, dz - 0.02));
  put(H.iron, new THREE.CylinderGeometry(0.011, 0.011, 0.1, 6).rotateX(Math.PI / 2).translate(0.3, DECK + 1.02, dz + 0.025));
  // hublots : verre éclairé, cerclage de laiton riveté
  for (const a of [0.95, -0.95]) {
    const rx = Math.sin(a), rz = Math.cos(a), y = 3.3, c = new THREE.Vector3(rx * (WALL + 0.04), y, rz * (WALL + 0.04));
    put(H.porthole, new THREE.CircleGeometry(0.28, 20).rotateY(a).translate(c.x, c.y, c.z));
    put(H.brass, new THREE.TorusGeometry(0.31, 0.05, 6, 22).rotateY(a).translate(c.x + rx * 0.02, c.y, c.z + rz * 0.02));
    for (let k = 0; k < 6; k++) {
      const t = (k / 6) * Math.PI * 2, ox = Math.cos(t) * 0.31, oy = Math.sin(t) * 0.31;
      rivets(riv, [[c.x + rz * ox + rx * 0.07, y + oy, c.z - rx * ox + rz * 0.07]], [rx, 0, rz], 0.018);
    }
  }
  put(H.iron, mergeGeometries(riv));
  // toit en bardeaux (UV étirées : un bardeau d'environ 35 cm), sous-face en bois, rive et faîtage
  const roof = new THREE.ConeGeometry(2.78, 2.45, 40, 4, true);
  const uv = roof.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 12, uv.getY(i) * 2.6);
  put(o.roof === 'b' ? H.roofB : H.roofA, roof.translate(0, TOP - 0.05 + 2.45 / 2, 0));
  put(H.soffit, new THREE.RingGeometry(WALL - 0.05, 2.78, 40, 1).rotateX(Math.PI / 2).translate(0, TOP - 0.05, 0));
  put(H.timber, new THREE.TorusGeometry(2.76, 0.06, 5, 44).rotateX(Math.PI / 2).translate(0, TOP - 0.06, 0));
  put(H.iron, new THREE.CylinderGeometry(0.05, 0.16, 0.35, 8).translate(0, TOP + 2.45 - 0.12, 0));
  put(m.lantern, new THREE.SphereGeometry(0.22, 10, 8).translate(0, TOP + 2.55, 0));
  put(H.iron, new THREE.TorusGeometry(0.2, 0.025, 5, 14).rotateX(Math.PI / 2).translate(0, TOP + 2.55, 0));
  // échelle de meunier jusqu'au seuil ; ses montants descendent (ou s'arrêtent) au sol sous leur pied
  const LL = 2.08, tilt = -Math.atan2(1.0, DECK), ct = Math.cos(tilt), st = Math.sin(tilt);
  const lad = [-1, 1].map((s) => {
    // pied du montant (bas de l'axe, à LL / 2 sous le centre), allongé vers le bas jusqu'à 5 cm sous le sol
    const fy = DECK / 2 - (LL / 2) * ct, fz = 2.9 - (LL / 2) * st;
    const ext = Math.max(-0.1, (fy - (gnd([[s * 0.3, fz]])[0] - 0.05)) / ct);
    return plankBox(0.07, LL + ext, 0.06, 1, s * 0.3).translate(s * 0.3, -ext / 2, 0);
  });
  for (let y = -LL / 2 + 0.3; y < LL / 2 - 0.1; y += 0.34) lad.push(plankBox(0.56, 0.05, 0.08, 1, y).translate(0, y, 0));
  for (const g of lad) put(H.timber, g.rotateX(tilt).translate(0, DECK / 2, 2.9));
  // pose : une géométrie fusionnée par matière, tournée et placée d'un coup
  const M = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
  for (const [mt, list] of parts) L.add(mergeGeometries(list), mt, M);
  // lueur des hublots sur le seuil
  lights.add({ pos: P(0, 3.2, 3), color: '#ffb866', intensity: 22, range: 8, flicker: 0.05, priority: 1.3 });
  L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y, pos.y + 4.4, 2.2, { surface: 'wood' }));
  L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y + 4.4, pos.y + 6.2, 1.4, { surface: 'wood' }));
}

// Mât de fête : poteau équarri sur une pierre plate, cerclé de fer, pommeau doré. Renvoie la hauteur où attacher
// les guirlandes (sous le pommeau).
export function mast(L, pos, h = 5) {
  const m = mats(), H = hutMats();
  const M = new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z);
  L.add(plankBox(0.17, h, 0.17, 1, pos.x * 0.37).rotateY(pos.z).translate(0, h / 2, 0), H.timber, M);
  // pierre plate du pied : elle descend jusqu'au sol le plus bas sous elle
  const [lo, hi] = groundSpan(L, ringPts(pos.x, pos.z, 0.3), pos.y);
  const y0 = Math.min(-0.04, lo - pos.y - 0.05), y1 = Math.max(0.14, hi - pos.y + 0.05);
  L.add(new THREE.CylinderGeometry(0.22, 0.3, y1 - y0, 7).translate(0, (y0 + y1) / 2, 0), m.stone, M);
  const iron = [0.45, h * 0.55, h - 0.35].map((y) => ni(new THREE.CylinderGeometry(0.115, 0.115, 0.07, 10).translate(0, y, 0)));
  L.add(mergeGeometries(iron), H.iron, M);
  L.add(new THREE.SphereGeometry(0.13, 10, 8).translate(0, h + 0.1, 0), H.brass, M);
  L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y, pos.y + h, 0.12, { surface: 'wood' }));
  return h - 0.3;
}

// Lanterne sur poteau : poteau équarri sur une pierre plate, cerclé de fer riveté ; potence à jambe de force et volute
// de fer ; lanterne suspendue à un crochet (cage à montants, verre éclairé, chapeau de fer à pommeau de laiton).
// Une géométrie par hauteur, partagée ; l'orientation de la potence varie d'une lanterne à l'autre.
const LANT_ARM = 0.47;
const lanternGeo = new Map();
// chapeau et plateaux : tôle peinte bleu ardoise, écaillée (un fer nu reflèterait le ciel et virerait au blanc)
let capMat = null;
function lanternCap() {
  if (!capMat) {
    const t = paintedMetalTexture('#3a4a5e', 'lanterne-chapeau', { chip: 0.3, edge: 0.8, rust: 0.25 });
    capMat = mat('#ffffff', { map: t.map, normalMap: t.normalMap, rough: 0.55, metal: 0.25 });
  }
  return capMat;
}
function lanternParts(h) {
  if (lanternGeo.has(h)) return lanternGeo.get(h);
  const m = mats(), H = hutMats(), k = kit(), riv = [];
  const P = h + 0.58, ax = LANT_ARM, ay = h + 0.42;
  k.put(H.timber, plankBox(0.14, P, 0.14, 1, 0.37).translate(0, P / 2, 0));
  for (const y of [0.32, P - 0.38]) {
    k.put(H.iron, new THREE.BoxGeometry(0.16, 0.05, 0.16).translate(0, y, 0));
    for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) rivets(riv, [[nx * 0.081, y, nz * 0.081]], [nx, 0, nz], 0.013);
  }
  k.put(H.iron, new THREE.ConeGeometry(0.11, 0.1, 4).rotateY(Math.PI / 4).translate(0, P + 0.05, 0));
  k.put(H.brass, new THREE.SphereGeometry(0.035, 8, 6).translate(0, P + 0.12, 0));
  // potence : bras, jambe de force, volute, bande de fer rivetée sur le bras
  k.put(H.timber, plankBox(ax + 0.2, 0.09, 0.09, 1, 0.8).translate((ax + 0.2) / 2 - 0.04, ay, 0));
  k.put(H.timber, beam(new THREE.Vector3(0.05, h - 0.12, 0), new THREE.Vector3(ax - 0.13, ay - 0.03, 0), 0.028));
  // volute calée dans l'angle : son dos contre le poteau, ses deux bouts sous le bras
  k.put(H.iron, new THREE.TorusGeometry(0.075, 0.012, 4, 14, Math.PI * 1.5).rotateZ(Math.PI * 0.75).translate(0.139, ay - 0.09, 0));
  k.put(H.iron, new THREE.BoxGeometry(ax + 0.12, 0.012, 0.095).translate((ax + 0.12) / 2 - 0.02, ay + 0.051, 0));
  rivets(riv, [[0.08, ay + 0.057, 0], [ax - 0.06, ay + 0.057, 0]], [0, 1, 0], 0.013);
  // crochet et maillon
  k.put(H.iron, new THREE.TorusGeometry(0.035, 0.009, 4, 10).translate(ax, ay - 0.075, 0));
  k.put(H.iron, new THREE.TorusGeometry(0.032, 0.009, 4, 10).rotateY(Math.PI / 2).translate(ax, ay - 0.13, 0));
  // lanterne (flamme à h - 0,3) : plateaux, montants d'angle, barreaux, verre éclairé, chapeau, anneau
  const yb = h - 0.56, yt = h - 0.04, mid = (yb + yt) / 2, hh = yt - yb;
  k.put(m.lantern, new THREE.BoxGeometry(0.3, hh - 0.03, 0.3).translate(ax, mid, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.put(H.iron, new THREE.BoxGeometry(0.036, hh, 0.036).translate(ax + sx * 0.165, mid, sz * 0.165));
  for (const t of [-0.055, 0.055]) {
    for (const s of [-1, 1]) {
      k.put(H.iron, new THREE.BoxGeometry(0.013, hh, 0.013).translate(ax + t, mid, s * 0.157));
      k.put(H.iron, new THREE.BoxGeometry(0.013, hh, 0.013).translate(ax + s * 0.157, mid, t));
    }
  }
  const cap = lanternCap();
  k.put(cap, new THREE.BoxGeometry(0.39, 0.045, 0.39).translate(ax, yb, 0));
  k.put(cap, new THREE.BoxGeometry(0.41, 0.035, 0.41).translate(ax, yt, 0));
  k.put(cap, new THREE.ConeGeometry(0.09, 0.09, 4).rotateY(Math.PI / 4).rotateX(Math.PI).translate(ax, yb - 0.065, 0));
  k.put(cap, new THREE.ConeGeometry(0.34, 0.21, 4).rotateY(Math.PI / 4).translate(ax, yt + 0.12, 0));
  k.put(H.brass, new THREE.SphereGeometry(0.04, 8, 6).translate(ax, yt + 0.23, 0));
  k.put(H.brass, new THREE.TorusGeometry(0.034, 0.009, 4, 10).translate(ax, yt + 0.29, 0));
  k.put(H.iron, mergeGeometries(riv));
  const res = k.merged();
  lanternGeo.set(h, res);
  return res;
}
// o.toward [x, z] : point vers lequel la potence avance (le chemin, la place) ; par défaut l'axe x = 0 (chemins
// des niveaux), ou une orientation propre à la lanterne quand elle est dessus
export function lantern(L, pos, h = 2.6, o = {}) {
  const s = Math.sin(pos.x * 12.9898 + pos.z * 78.233) * 43758.5453;
  const [tx, tz] = o.toward || [0, pos.z];
  const yaw = Math.hypot(tx - pos.x, tz - pos.z) > 0.5 ? Math.atan2(-(tz - pos.z), tx - pos.x) : (s - Math.floor(s)) * Math.PI * 2;
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const M = new THREE.Matrix4().compose(new THREE.Vector3(pos.x, pos.y, pos.z), q, new THREE.Vector3(1, 1, 1));
  for (const [mt, g] of lanternParts(h)) L.add(g, mt, M);
  // pierre plate du pied, propre à chaque lanterne : elle descend jusqu'au sol le plus bas sous elle
  const [lo, hi] = groundSpan(L, ringPts(pos.x, pos.z, 0.24), pos.y);
  const y0 = Math.min(-0.04, lo - pos.y - 0.05), y1 = Math.max(0.1, hi - pos.y + 0.05);
  L.add(new THREE.CylinderGeometry(0.18, 0.24, y1 - y0, 7).translate(0, (y0 + y1) / 2, 0), mats().stone, M);
  // flamme chaude qui éclaire réellement le sol, les troncs et Kobi (dans la lanterne, sous la potence)
  const off = new THREE.Vector3(LANT_ARM, 0, 0).applyQuaternion(q);
  lights.add({ pos: new THREE.Vector3(pos.x + off.x, pos.y + h - 0.3, pos.z + off.z), color: '#ffb36b', intensity: 55, range: 14, decay: 1.3, flicker: 0.1, priority: 2 });
  // solides : le poteau, et la lanterne (on passe dessous)
  L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y, pos.y + h + 0.58, 0.09, { surface: 'wood' }));
  L.game.world.add(new CylinderCollider(pos.x + off.x, pos.z + off.z, pos.y + h - 0.62, pos.y + h + 0.17, 0.2, { surface: 'metal' }));
}

// Montgolfière décorative (animée, dérive lentement) : enveloppe en fuseaux de toile cousue (deux teintes alternées),
// galons sur les coutures, ceinture et couronne, filet en losange sur le haut, suspentes jusqu'au cercle de charge sous
// la jupe ; nacelle en osier à bord de cuir, sacs de lest, bouteilles, cadre du brûleur et son serpentin.
// Géométries communes, matières par couleur.
const BAL = {};
const ENV = { yc: 3.75, R: 2.45, top: 2.4, low: 3.3, throat: 0.42, gores: 12 };
const GORE = (Math.PI * 2) / ENV.gores;
// profil de l'enveloppe (angle th de -π/2 au col à π/2 au sommet) : [rayon, hauteur]
const envProf = (th) => (th >= 0
  ? [ENV.R * Math.cos(th), ENV.yc + ENV.top * Math.sin(th)]
  : [ENV.throat + (ENV.R - ENV.throat) * Math.pow(Math.cos(th), 1.25), ENV.yc + ENV.low * Math.sin(th)]);
// chaque fuseau bombe entre ses deux coutures
const goreK = (phi) => { const f = phi / GORE - Math.floor(phi / GORE); return 1 + 0.03 * Math.sin(Math.PI * f); };
const envPt = (th, phi, out) => { const [r, y] = envProf(th); const rr = r * goreK(phi) + out; return new THREE.Vector3(rr * Math.sin(phi), y, rr * Math.cos(phi)); };
function balloonMats() {
  if (BAL.ready) return BAL;
  const f = fabricTexture(), r = ropeTexture(), w = wickerTexture();
  BAL.fabric = f;
  BAL.cream = mat('#fff3df', { map: f.map, normalMap: f.normalMap, rough: 0.65, side: THREE.DoubleSide });
  BAL.net = mat('#c49a5e', { map: r.map, normalMap: r.normalMap, rough: 0.85 });
  BAL.wicker = mat('#ffffff', { map: w.map, normalMap: w.normalMap, rough: 0.85 });
  BAL.leather = mat('#7a4a2e', { rough: 0.5 });
  BAL.burlap = mat('#b8986a', { map: f.map, normalMap: f.normalMap, rough: 0.95 });
  BAL.ready = true;
  return BAL;
}
function envelopeParts(color) {
  const B = balloonMats(), H = hutMats();
  if (!BAL.env) {
    const ROWS = 26, prof = [];
    for (let i = 0; i <= ROWS; i++) { const [r, y] = envProf(-Math.PI / 2 + (i / ROWS) * Math.PI); prof.push(new THREE.Vector2(Math.max(r, 0.002), y)); }
    const A = [], Bg = [], cream = [], rope = [], iron = [];
    for (let g = 0; g < ENV.gores; g++) {
      const geo = new THREE.LatheGeometry(prof, 5, g * GORE, GORE);
      // fuseau bombé ; UV : u en travers du fuseau, v en panneaux de toile (dix du col au sommet)
      const p = geo.attributes.position, uv = geo.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        const k = 1 + 0.03 * Math.sin(Math.PI * uv.getX(i));
        p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k);
        uv.setY(i, uv.getY(i) * 10);
      }
      geo.computeVertexNormals();
      (g % 2 ? Bg : A).push(geo.toNonIndexed());
      // galon sur la couture
      const tape = [];
      for (let i = 1; i < ROWS; i++) tape.push(envPt(-Math.PI / 2 + (i / ROWS) * Math.PI, g * GORE, 0.012));
      cream.push(ropeGeo(tape, 0.03, { radial: 4, step: 0.3 }));
    }
    // ceinture, couronne, jupe sous le col
    cream.push(new THREE.TorusGeometry(ENV.R * 1.03 + 0.01, 0.075, 6, 64).rotateX(Math.PI / 2).translate(0, ENV.yc, 0));
    const thc = Math.acos(0.5 / ENV.R);
    cream.push(new THREE.TorusGeometry(0.52, 0.05, 5, 24).rotateX(Math.PI / 2).translate(0, ENV.yc + ENV.top * Math.sin(thc), 0));
    cream.push(new THREE.CylinderGeometry(0.44, 0.53, 0.34, 16, 1, true).translate(0, 0.3, 0));
    // filet : deux familles d'hélices croisées sur le haut (mailles en losange)
    for (const fam of [-1, 1]) {
      for (let j = 0; j < ENV.gores; j++) {
        const net = [];
        for (let i = 0; i <= 16; i++) {
          const th = -0.3 + (i / 16) * 1.66;
          net.push(envPt(th, (j + 0.5) * GORE + fam * ((th + 0.3) / 1.66) * GORE * 2, 0.03));
        }
        rope.push(ropeGeo(net, 0.017, { radial: 3, step: 0.3 }));
      }
    }
    // suspentes : du bas du filet au cercle de charge
    for (let j = 0; j < ENV.gores; j++) {
      const phi = (j + 0.5) * GORE, line = [];
      for (let i = 0; i <= 5; i++) line.push(envPt(-0.3 - i * 0.2, phi, 0.035));
      line.push(new THREE.Vector3(0.6 * Math.sin(phi), 0.12, 0.6 * Math.cos(phi)));
      rope.push(ropeGeo(line, 0.018, { radial: 3, step: 0.3 }));
    }
    iron.push(new THREE.TorusGeometry(0.58, 0.028, 5, 24).rotateX(Math.PI / 2).translate(0, 0.12, 0));
    const mg = (l) => { const g = mergeGeometries(l.map(ni)); g.userData.shared = true; return g; };
    BAL.env = { A: mg(A), B: mg(Bg), cream: mg(cream), rope: mg(rope), iron: mg(iron) };
  }
  const key = 'm' + color;
  if (!BAL[key]) {
    const lite = new THREE.Color(color).lerp(new THREE.Color('#fff3df'), 0.38);
    const o = { map: BAL.fabric.map, normalMap: BAL.fabric.normalMap, rough: 0.6 };
    BAL[key] = [mat(color, o), mat('#' + lite.getHexString(), o)];
  }
  const E = BAL.env;
  return [[E.A, BAL[key][0]], [E.B, BAL[key][1]], [E.cream, B.cream], [E.rope, B.net], [E.iron, H.iron]];
}
function basketParts() {
  const B = balloonMats(), H = hutMats();
  if (!BAL.basket) {
    const k = kit(), V3 = (x, y, z) => new THREE.Vector3(x, y, z);
    k.put(B.wicker, new RoundedBoxGeometry(1.24, 0.78, 1.24, 2, 0.09).translate(0, -0.6, 0));
    k.put(B.leather, new RoundedBoxGeometry(1.18, 0.07, 1.18, 1, 0.03).translate(0, -1.0, 0));
    k.put(H.inner, new THREE.BoxGeometry(1.08, 0.02, 1.08).translate(0, -0.215, 0));
    // bord de cuir rembourré, coins sanglés
    for (const s of [-1, 1]) {
      k.put(B.leather, new THREE.CylinderGeometry(0.055, 0.055, 1.16, 8).rotateZ(Math.PI / 2).translate(0, -0.21, s * 0.6));
      k.put(B.leather, new THREE.CylinderGeometry(0.055, 0.055, 1.16, 8).rotateX(Math.PI / 2).translate(s * 0.6, -0.21, 0));
      for (const t of [-1, 1]) {
        k.put(B.leather, new THREE.SphereGeometry(0.055, 8, 6).translate(s * 0.58, -0.21, t * 0.58));
        k.put(B.leather, new THREE.BoxGeometry(0.1, 0.76, 0.02).rotateY(Math.PI / 4 * s * t).translate(s * 0.592, -0.6, t * 0.592));
      }
    }
    // bouteilles de gaz (dépassent du bord), cadre du brûleur sur quatre tiges, serpentin de laiton
    for (const x of [-0.28, 0.28]) {
      k.put(H.brass, new THREE.CylinderGeometry(0.11, 0.11, 0.42, 12).translate(x, -0.33, -0.32));
      k.put(H.iron, new THREE.CylinderGeometry(0.035, 0.035, 0.08, 8).translate(x, -0.08, -0.32));
    }
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) k.put(H.iron, beam(V3(sx * 0.55, -0.2, sz * 0.55), V3(sx * 0.2, -0.05, sz * 0.2), 0.016));
      k.put(H.iron, new THREE.BoxGeometry(0.43, 0.03, 0.03).translate(0, -0.05, sx * 0.2));
      k.put(H.iron, new THREE.BoxGeometry(0.03, 0.03, 0.43).translate(sx * 0.2, -0.05, 0));
      k.put(H.iron, new THREE.BoxGeometry(0.2, 0.025, 0.025).translate(sx * 0.1, -0.06, 0));
    }
    k.put(H.iron, new THREE.CylinderGeometry(0.075, 0.09, 0.12, 10).translate(0, -0.07, 0));
    for (const y of [-0.015, 0.04]) k.put(H.brass, new THREE.TorusGeometry(0.16, 0.026, 6, 20).rotateX(Math.PI / 2).translate(0, y, 0));
    // haubans jusqu'au cercle de charge, sacs de lest accrochés au bord
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.put(B.net, ropeGeo([V3(sx * 0.58, -0.18, sz * 0.58), V3(sx * 0.42, 0.12, sz * 0.42)], 0.022, { radial: 4 }));
    for (const [x, z, y] of [[0.67, 0.32, -0.7], [-0.67, -0.24, -0.76], [0.18, -0.67, -0.72]]) {
      k.put(B.burlap, new THREE.SphereGeometry(0.1, 8, 6).scale(1, 1.3, 0.85).translate(x, y, z));
      k.put(B.net, ropeGeo([V3(x * 0.93, -0.2, z * 0.93), V3(x, y + 0.12, z)], 0.01, { radial: 3 }));
    }
    BAL.basket = k.merged().map(([mt, g]) => [g, mt]);
  }
  return BAL.basket;
}
export function balloon(L, pos, color = '#ff6f8a', o = {}) {
  const grp = joint(L.root, [pos.x, pos.y, pos.z]);
  for (const [g, mt] of [...envelopeParts(color), ...basketParts()]) part(grp, g, mt);
  const t0 = rand(0, 6);
  L.every((dt, t) => {
    grp.position.y = pos.y + Math.sin(t * 0.5 + t0) * (o.bob ?? 1.2);
    grp.rotation.y += dt * 0.05;
    if (o.drift) grp.position.x = pos.x + Math.sin(t * 0.07 + t0) * o.drift;
  });
  return grp;
}
// Ballon de la nacelle-ascenseur (plateau de 2,6 m) : la même enveloppe réduite, haubans des coins du plateau au
// cercle de charge, cadre du brûleur accroché aux haubans (le brûleur allumé se pose à y = 1,7)
export function liftBalloon(grp, color = '#ff6f8a') {
  const B = balloonMats(), H = hutMats();
  const S = 0.833, env = joint(grp, [0, 1.85, 0]);
  env.scale.setScalar(S);
  for (const [g, mt] of envelopeParts(color)) part(env, g, mt);
  const k = kit(), ringY = 1.85 + 0.12 * S, ringR = 0.6 * S * Math.SQRT1_2, fy = 1.42;
  const f = 1.1 + (ringR - 1.1) * ((fy - 0.25) / (ringY - 0.25));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) k.put(B.net, ropeGeo([new THREE.Vector3(sx * 1.1, 0.25, sz * 1.1), new THREE.Vector3(sx * ringR, ringY, sz * ringR)], 0.03, { radial: 5 }));
    k.put(H.iron, new THREE.BoxGeometry(f * 2 + 0.04, 0.035, 0.035).translate(0, fy, sx * f));
    k.put(H.iron, new THREE.BoxGeometry(0.035, 0.035, f * 2 + 0.04).translate(sx * f, fy, 0));
    // écharpes en croix, d'un coin du cadre à l'autre, sous le brûleur
    k.put(H.iron, new THREE.BoxGeometry(f * 2 * Math.SQRT2, 0.03, 0.03).rotateY(sx * Math.PI / 4).translate(0, fy - 0.01, 0));
  }
  k.put(H.iron, new THREE.CylinderGeometry(0.08, 0.1, 0.12, 10).translate(0, fy + 0.02, 0));
  for (const y of [fy + 0.08, fy + 0.135]) k.put(H.brass, new THREE.TorusGeometry(0.16, 0.026, 6, 20).rotateX(Math.PI / 2).translate(0, y, 0));
  for (const [mt, g] of k.merged()) part(grp, g, mt);
}

// Arc-en-ciel (stylisé, mais à sa vraie place) : bandes colorées à 39-43° du point antisolaire, rouge à
// l'extérieur ; visible dans la brume quand on lui tourne le dos au soleil.
const BOW = /* glsl */ `
vec3 kobiBow(vec3 rd, vec3 sunDir) {
  float a = acos(clamp(dot(rd, -sunDir), -1.0, 1.0)) * 57.29578;
  float t = (a - 38.8) / 4.0;
  if (t <= 0.0 || t >= 1.0) return vec3(0.0);
  vec3 c = clamp(abs(fract(vec3(0.78 * (1.0 - t)) + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return mix(vec3(1.0), c, 0.8) * smoothstep(0.0, 0.22, t) * smoothstep(1.0, 0.72, t);
}`;
// pieds des cascades (x, y, z, rayon) : la brume y porte l'arc-en-ciel
const BOW_FEET = { value: Array.from({ length: 6 }, () => new THREE.Vector4()) };
const BOW_N = { value: 0 };

// Mer de nuages : une couche épaisse en relief (2,5D). Le plan posé sur son sommet marche le long du rayon de vue
// dans un champ de hauteurs (amas de Worley) jusqu'à la surface des nuages, puis l'éclaire : soleil adouci,
// ombre propre des bosses, ombres des îles (cascades), creux violets, liseré à contre-jour, brume au loin.
// La profondeur écrite est celle du point touché : les îles s'enfoncent vraiment dans les nuages.
const SEA_VERT = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const SEA_FRAG = /* glsl */ `
${CSM_PARS}
uniform sampler2D tNoise;
uniform float uTime, uTop, uThick, uSteps;
uniform vec3 uA, uB, uSunDir, uSunColor, fogColor;
uniform float fogNear, fogFar;
uniform vec4 uFeet[6];
uniform int uFeetN;
${BOW}
uniform mat4 projectionMatrix;
varying vec3 vW;
float lodK;
// dôme arrondi sur une cellule de Worley (b = 1 - distance au germe) : têtes de cumulus, pas des pics
float dome(float b) { float d = 1.0 - b; return sqrt(max(1.0 - d * d * 2.1, 0.0)); }
// hauteur des nuages (0 : creux, 1 : sommet) en un point du plan : grosses têtes rondes, bourgeons plus petits
// posés dessus, fin moutonnement
float seaH(vec2 x) {
  vec2 p = x / 420.0 + vec2(uTime * 0.0011, uTime * 0.0004);
  vec2 w = vec2(textureLod(tNoise, p * 0.5, lodK).a, textureLod(tNoise, p * 0.5 + 0.5, lodK).a) - 0.5;
  p += w * 0.06;
  float big = dome(textureLod(tNoise, p, lodK).b);
  float bud = dome(textureLod(tNoise, p * 2.7 + 0.3, lodK).b);
  float h = big * 0.66 + bud * 0.26 * (0.4 + 0.6 * big) + textureLod(tNoise, p * 7.3, lodK).r * 0.08;
  return smoothstep(0.12, 0.96, h);
}
void main() {
  vec3 rd = normalize(vW - cameraPosition);
  float dist0 = length(vW - cameraPosition);
  // au loin, relief aplati et texture moins détaillée (pas de scintillement)
  float flat0 = smoothstep(350.0, 900.0, dist0);
  float thick = uThick * (1.0 - flat0 * 0.85);
  lodK = clamp(log2(dist0 / 60.0), 0.0, 6.0);
  float y0 = uTop - thick;
  float tMax = min(thick / max(-rd.y, 0.02), 300.0);
  // marche à pas sûrs : le pas suit la hauteur au-dessus des nuages (pente du relief bornée), puis
  // interpolation entre les deux derniers points (au-dessus / en dessous)
  int n = int(uSteps);
  float t = 0.0, tPrev = 0.0, dPrev = 0.0;
  for (int i = 0; i < 64; i++) {
    if (i >= n) break;
    vec3 p = vW + rd * t;
    float d = p.y - (y0 + seaH(p.xz) * thick);
    if (d < 0.0) { t = tPrev + (t - tPrev) * dPrev / max(dPrev - d, 1e-4); break; }
    tPrev = t;
    dPrev = d;
    t = min(t + max(d / (-rd.y + 1.1), 0.25 + t * 0.006), tMax);
  }
  vec3 P = vW + rd * t;
  float h = clamp((P.y - y0) / max(thick, 0.01), 0.0, 1.0);
  // normale du relief (bosses arrondies)
  float e = 1.6;
  float hx = seaH(P.xz + vec2(e, 0.0)) - seaH(P.xz - vec2(e, 0.0));
  float hz = seaH(P.xz + vec2(0.0, e)) - seaH(P.xz - vec2(0.0, e));
  vec3 N = normalize(vec3(-hx * thick / (2.0 * e) * 1.4, 1.0, -hz * thick / (2.0 * e) * 1.4));
  // ombre propre : quelques pas vers le soleil dans le champ de hauteurs
  float sh = 1.0;
  if (uSteps > 20.0) {
    for (int i = 1; i <= 5; i++) {
      vec3 q = P + uSunDir * (float(i) * 2.6);
      float under = y0 + seaH(q.xz) * thick - q.y;
      sh -= clamp(under * 0.12, 0.0, 0.22);
    }
  } else {
    vec3 q = P + uSunDir * 5.0;
    sh -= clamp((y0 + seaH(q.xz) * thick - q.y) * 0.1, 0.0, 0.5);
  }
  sh = clamp(sh, 0.0, 1.0);
  // ombre des îles (cascades) : large pénombre (la lumière diffuse dans la masse du nuage)
  float vis = 1.0;
  if (uCsmOn > 0.5) {
    vis = 0.0;
    for (int i = 0; i < 7; i++) {
      float a = float(i) * 0.8976;
      vis += kobiCsmVis(P + vec3(cos(a), 0.0, sin(a)) * (i == 0 ? 0.0 : 3.2));
    }
    vis = mix(0.42, 1.0, vis / 7.0);
  }
  float ndl = dot(N, uSunDir);
  float dif = clamp(ndl * 0.55 + 0.45, 0.0, 1.0) * sh * vis;
  // creux lavande, sommets clairs ; le soleil (couleur × intensité) éclaire le dessus
  float ao = 0.55 + 0.45 * smoothstep(0.0, 0.85, h);
  vec3 amb = mix(uB, uA, 0.25 + 0.7 * h) * ao;
  vec3 col = amb * 0.55 + uA * uSunColor * dif * 0.26;
  // lumière qui traverse les bourgeons minces, vers le soleil
  col += uA * uSunColor * 0.035 * smoothstep(0.55, 1.0, h) * (1.0 - sh * 0.5);
  // liseré argenté : bords rasants des têtes, très fort à contre-jour
  float fres = pow(1.0 - clamp(dot(N, -rd), 0.0, 1.0), 3.0);
  float back = pow(max(dot(rd, uSunDir), 0.0), 3.0);
  col += uSunColor * fres * (0.04 + back * 0.4) * (0.35 + 0.65 * vis) * (0.6 + 0.4 * h);
  // arc-en-ciel de brume : à peine esquissé sur toute la mer, franc dans les embruns des cascades
  float spray = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= uFeetN) break;
    spray = max(spray, 1.0 - smoothstep(uFeet[i].w * 0.3, uFeet[i].w, length(P.xz - uFeet[i].xz)));
  }
  col += kobiBow(rd, uSunDir) * uSunColor * (0.025 + 0.16 * spray);
  // brume au loin (comme le brouillard de la scène)
  float dist = length(P - cameraPosition);
  float f = smoothstep(fogNear, fogFar, dist);
  col = mix(col, fogColor, f * 0.9);
  gl_FragColor = vec4(col, 1.0);
  vec4 clip = projectionMatrix * viewMatrix * vec4(P, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
}`;

export function cloudSea(L, y = -30, colors = {}) {
  BOW_N.value = 0;
  const geo = new THREE.PlaneGeometry(4000, 4000, 1, 1).rotateX(-Math.PI / 2);
  const top = y + 6;
  const m = new THREE.ShaderMaterial({
    uniforms: {
      ...csmU,
      tNoise: { value: noiseTexture() },
      uTime: { value: 0 }, uTop: { value: top }, uThick: { value: 16 }, uSteps: { value: 32 },
      uA: { value: new THREE.Color(colors.a || '#fff4fb') }, uB: { value: new THREE.Color(colors.b || '#b896e0') },
      uSunDir: frameU.uSunDir, uSunColor: frameU.uSunColor,
      fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 },
      uFeet: BOW_FEET, uFeetN: BOW_N,
    },
    vertexShader: SEA_VERT,
    fragmentShader: SEA_FRAG,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.y = top;
  mesh.renderOrder = -5;
  L.root.add(mesh);
  L.every((dt, t) => {
    m.uniforms.uTime.value = t;
    m.uniforms.uSteps.value = L.game.R.Q.seaSteps ?? 32;
    const f = L.game.scene.fog;
    if (f) { m.uniforms.fogColor.value.copy(f.color); m.uniforms.fogNear.value = f.near; m.uniforms.fogFar.value = f.far * 1.4; }
    mesh.position.x = L.game.camera.cam.position.x;
    mesh.position.z = L.game.camera.cam.position.z;
  });
  return mesh;
}

// Bancs de nuages : panneaux tournés vers la position de la caméra, sans roulis — pas vers sa direction de visée :
// tourner ou lever les yeux ne les fait plus pivoter ni plonger dans la mer de nuages —, chacun un cumulus procédural
// (amas de dômes) éclairé par le soleil (face éclairée, base ombrée, liseré à contre-jour) et fondu au contact du décor
// avec la profondeur de son dôme (couche des effets). Triés du plus lointain au plus proche à chaque image.
const PUFF_VERT = /* glsl */ `
attribute vec4 aPuff;
uniform float uSize;
varying vec2 vUv;
varying float vSeed;
varying float vViewZ;
varying float vS;
varying vec3 vDir;
varying vec3 vSunB;
varying vec3 vUpB;
uniform vec3 uSunDir;
void main() {
  vUv = uv * 2.0 - 1.0;
  vSeed = aPuff.w;
  // repère du panneau : tourné vers la position de la caméra (pas vers sa direction de visée), sans roulis
  vec3 fwd = normalize(cameraPosition - aPuff.xyz);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd) + vec3(1e-5, 0.0, 0.0));
  vec3 up = cross(fwd, right);
  vS = uSize * (0.8 + 0.5 * aPuff.w);
  vec3 wp = aPuff.xyz + (right * position.x + up * position.y) * vS;
  // soleil et ciel dans le repère du panneau (x : droite, y : haut, z : vers la caméra)
  vSunB = vec3(dot(uSunDir, right), dot(uSunDir, up), dot(uSunDir, fwd));
  vUpB = vec3(0.0, up.y, fwd.y);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vViewZ = -mv.z;
  vDir = wp - cameraPosition;
  gl_Position = projectionMatrix * mv;
}`;
const PUFF_FRAG = /* glsl */ `
uniform sampler2D tNoise, tSceneDepth;
uniform vec3 uColor, uShade, uSunDir, uSunColor, fogColor;
uniform float fogNear, fogFar, uCamNear, uCamFar, uOpacity, uBow;
${BOW}
uniform vec2 uRes;
uniform vec4 uMoon, uPlanet;
varying vec2 vUv;
varying float vSeed;
varying float vViewZ;
varying float vS;
varying vec3 vDir;
varying vec3 vSunB;
varying vec3 vUpB;
// part du disque d'un astre (direction xyz, rayon angulaire w) couverte en ce point
float bodyMask(vec3 d, vec4 b) {
  return b.w > 0.0 ? smoothstep(b.w * 1.25, b.w * 0.9, acos(clamp(dot(d, b.xyz), -1.0, 1.0))) : 0.0;
}
// union douce de quelques dômes : silhouette de cumulus arrondie, à base plate
float dome(vec2 p, float s) {
  float acc = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    vec2 c = vec2(sin(fi * 2.1 + s * 7.0) * 0.44, -0.24 + 0.3 * abs(cos(fi * 1.7 + s * 3.0)) * (1.0 - fi / 8.0));
    float r = 0.28 + 0.16 * fract(sin(fi * 12.9 + s * 78.2) * 43758.5);
    vec2 d = p - c;
    acc += exp(8.0 * sqrt(max(r * r - dot(d, d), 0.0)) / r);
  }
  return max(log(acc) / 8.0 - 0.224, 0.0) * smoothstep(-0.62, -0.36, p.y);
}
void main() {
  float h = dome(vUv, vSeed);
  // bords effilochés par le bruit (le cœur reste plein)
  float er = texture2D(tNoise, vUv * 0.22 + vSeed).b * 0.6 + texture2D(tNoise, vUv * 0.5 + vSeed * 3.0).r * 0.4;
  float a = smoothstep(0.0, 0.32, h - (er - 0.45) * 0.3 * (1.0 - smoothstep(0.2, 0.6, h)));
  if (a < 0.005) discard;
  float e = 0.04;
  vec3 n = normalize(vec3(dome(vUv - vec2(e, 0.0), vSeed) - dome(vUv + vec2(e, 0.0), vSeed), dome(vUv - vec2(0.0, e), vSeed) - dome(vUv + vec2(0.0, e), vSeed), 0.11));
  vec3 sv = normalize(vSunB);
  float dif = clamp(dot(n, sv) * 0.65 + 0.35, 0.0, 1.0);
  float sky = dot(n, vUpB) * 0.5 + 0.5;
  // ciel sur le dessus, ombre lavande dessous, soleil (couleur × intensité) sur la face tournée vers lui
  vec3 col = mix(uShade, uColor, sky) * mix(0.78, 1.0, smoothstep(-0.5, 0.15, vUv.y)) * 0.7;
  col += uColor * uSunColor * dif * 0.26;
  // contre-jour : le soleil derrière le nuage illumine ses bords minces
  float back = clamp(-sv.z, 0.0, 1.0);
  col += uSunColor * pow(back, 4.0) * (1.0 - smoothstep(0.0, 0.45, h)) * 0.22;
  // lumière diffusée vers l'avant à travers la masse : un nuage à contre-jour reste lumineux, pas gris
  col += uColor * uSunColor * pow(back, 5.0) * 0.09;
  if (uBow > 0.0) col += kobiBow(normalize(vDir), uSunDir) * uSunColor * uBow * smoothstep(0.0, 0.5, h);
  col = mix(col, fogColor, smoothstep(fogNear, fogFar, vViewZ) * 0.85);
  // fondu au contact du décor et de la mer de nuages, à la profondeur du dôme (pas à celle du panneau plat)
  float d = texture2D(tSceneDepth, gl_FragCoord.xy / uRes).x;
  float zs = uCamNear * uCamFar / (uCamFar - d * (uCamFar - uCamNear));
  float zp = vViewZ - h * vS * 0.45;
  a *= clamp((zs - zp) / (4.0 + vS * 0.08), 0.0, 1.0) * smoothstep(2.0, 12.0, zp);
  // la lune et la planète restent lisibles derrière les nuages (voile léger)
  vec3 dw = normalize(vDir);
  a *= 1.0 - 0.92 * max(bodyMask(dw, uMoon), bodyMask(dw, uPlanet));
  gl_FragColor = vec4(col, a * uOpacity);
}`;

// o : { seed (tirage reproductible), ySpread (étalement vertical), opacity }
export function cloudPuffs(L, center, count, spread, y, size = 40, color = '#ffffff', o = {}) {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  const data = new Float32Array(count * 4);
  const R = o.seed === undefined ? Math.random : mkRng(o.seed);
  for (let i = 0; i < count; i++) {
    data[i * 4] = center.x + (R() - 0.5) * spread;
    data[i * 4 + 1] = y + (R() - 0.5) * (o.ySpread ?? 12);
    data[i * 4 + 2] = center.z + (R() - 0.5) * spread;
    data[i * 4 + 3] = R();
  }
  geo.setAttribute('aPuff', new THREE.InstancedBufferAttribute(data, 4));
  geo.instanceCount = count;
  const c = new THREE.Color(color);
  const su = L.sky ? L.sky.material.uniforms : null;
  const body = (dir, size) => (su ? new THREE.Vector4().copy(dir.value).setW(size.value) : new THREE.Vector4());
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uMoon: { value: su ? body(su.uMoonDir, su.uMoonSize) : new THREE.Vector4() },
      uPlanet: { value: su ? body(su.uPlanetDir, su.uPlanetSize) : new THREE.Vector4() },
      tNoise: { value: noiseTexture() }, tSceneDepth: frameU.tSceneDepth, uRes: frameU.uRes, uCamNear: frameU.uCamNear, uCamFar: frameU.uCamFar,
      uColor: { value: c }, uShade: { value: c.clone().multiply(new THREE.Color(o.shade || '#d2cdf4')) }, uSize: { value: size * 1.15 },
      uSunDir: frameU.uSunDir, uSunColor: frameU.uSunColor, uOpacity: { value: o.opacity ?? 0.92 }, uBow: { value: o.bow ?? 0 },
      fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 },
    },
    vertexShader: PUFF_VERT,
    fragmentShader: PUFF_FRAG,
    transparent: true,
    depthWrite: false,
  });
  const puffs = new THREE.Mesh(geo, m);
  puffs.frustumCulled = false;
  puffs.renderOrder = -4;
  // couche des effets : la profondeur de l'image opaque y est lisible (fondu au contact)
  puffs.layers.set(LAYERS.FX);
  L.root.add(puffs);
  // tri du plus lointain au plus proche (mélange correct des nuages qui se chevauchent, quel que soit l'angle)
  const items = Array.from({ length: count }, (_, i) => Array.from(data.subarray(i * 4, i * 4 + 4)));
  const attr = geo.attributes.aPuff, last = new THREE.Vector3(Infinity, 0, 0);
  L.every(() => {
    const f = L.game.scene.fog;
    if (f) { m.uniforms.fogColor.value.copy(f.color); m.uniforms.fogNear.value = f.near; m.uniforms.fogFar.value = f.far * 1.2; }
    const c = L.game.camera.cam.position;
    if (count < 2 || c.distanceToSquared(last) < 0.25) return;
    last.copy(c);
    for (const it of items) it[4] = (it[0] - c.x) ** 2 + (it[1] - c.y) ** 2 + (it[2] - c.z) ** 2;
    items.sort((p, q) => q[4] - p[4]);
    items.forEach((it, i) => data.set([it[0], it[1], it[2], it[3]], i * 4));
    attr.needsUpdate = true;
  });
  return puffs;
}

// Ombres de nuages : masses invisibles (elles ne font que porter ombre, dans les cascades du soleil) qui dérivent
// lentement au-dessus de l'archipel. Les îles, la mer de nuages et la brume volumétrique les reçoivent : taches
// d'ombre qui passent, rayons entre les nuages. o : { seed, wind: [x, z] (m/s), size: [min, max] }
export function cloudShadows(L, center, count, spread, y, o = {}) {
  const R = mkRng(o.seed ?? 5);
  const parts = [];
  for (let k = 0; k < 4; k++) {
    const g = new THREE.SphereGeometry(1, 14, 8);
    g.scale(0.5 + R() * 0.3, 0.22, 0.4 + R() * 0.25).translate((R() - 0.5) * 0.7, (R() - 0.5) * 0.08, (R() - 0.5) * 0.5);
    parts.push(g);
  }
  const geo = mergeGeometries(parts);
  const mat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const [s0, s1] = o.size || [14, 28];
  const wind = o.wind || [0.9, 0.33];
  const items = [];
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = false;
    m.userData.noAO = true;
    m.userData.noReflect = true;
    m.scale.setScalar(s0 + R() * (s1 - s0));
    m.rotation.y = R() * 6.28;
    m.position.set(center.x + (R() - 0.5) * spread, y + (R() - 0.5) * 10, center.z + (R() - 0.5) * spread);
    L.root.add(m);
    items.push(m);
  }
  L.every((dt) => {
    for (const m of items) {
      m.position.x += wind[0] * dt;
      m.position.z += wind[1] * dt;
      if (m.position.x > center.x + spread / 2) m.position.x -= spread;
      if (m.position.z > center.z + spread / 2) m.position.z -= spread;
    }
  });
  return items;
}

// Pont de corde entre deux îles : planches de travers posées sur deux cordes porteuses, mains courantes en cordage
// tressé reliées aux porteuses par des suspentes nouées, potelets ligaturés, poteaux d'ancrage cerclés aux deux bouts.
// Les collisions (une boîte par tronçon) ne dépendent que du tracé.
const BM = {};
function bridgeMats() {
  if (BM.ready) return BM;
  const d = plankTexture('#a27548', 'pont-planche', { wear: 0.75, knots: 1.3, seed: 23 });
  BM.deck = mat('#ffffff', { map: d.map, normalMap: d.normalMap, rough: 0.8 });
  const r = ropeTexture();
  BM.rope = mat('#ffffff', { map: r.map, normalMap: r.normalMap, rough: 0.85 });
  BM.ready = true;
  return BM;
}
export function ropeBridge(L, a, b, width = 2.2) {
  const H = hutMats(), B = bridgeMats();
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const yaw = Math.atan2(dir.x, dir.z);
  const n = Math.ceil(len / 0.6);
  const sag = Math.min(1.2, len * 0.04);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = new THREE.Vector3().lerpVectors(a, b, t);
    p.y -= Math.sin(t * Math.PI) * sag;
    pts.push(p);
  }
  const R = mkRng(Math.floor(a.x * 31 + a.z * 17 + b.z * 7) & 0xffff);
  const k = kit();
  // géométrie posée par rapport à a
  const loc = (p) => p.clone().sub(a);
  const across = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const at = (i, side, y) => loc(pts[i]).addScaledVector(across, side).add(new THREE.Vector3(0, y, 0));
  for (let i = 0; i < n; i++) {
    const p = new THREE.Vector3().lerpVectors(pts[i], pts[i + 1], 0.5);
    const d = new THREE.Vector3().subVectors(pts[i + 1], pts[i]);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.atan2(d.y, Math.hypot(d.x, d.z)), yaw, 0, 'YXZ'));
    // deux planches de travers par tronçon, un peu de biais, de longueurs et de hauteurs inégales
    const dl = d.length(), lp = loc(p);
    for (const f of [-0.25, 0.25]) {
      const g = plankBox(width - 0.02 - R() * 0.14, 0.07, dl * 0.45, 0.8, R() * 5)
        .rotateY((R() - 0.5) * 0.07).rotateZ((R() - 0.5) * 0.02).translate((R() - 0.5) * 0.08, 0.015 + (R() - 0.5) * 0.012, f * dl);
      k.put(B.deck, g.applyQuaternion(q).translate(lp.x, lp.y, lp.z));
    }
    // collision par tronçon
    L.game.world.add(new BoxCollider(p.clone().setY(p.y - 0.05), new THREE.Vector3(width / 2, 0.1, d.length() / 2 + 0.02), q, { surface: 'wood' }));
  }
  const W = width / 2;
  for (const s of [-1, 1]) {
    // cordes porteuses sous les bouts des planches, main courante, corde basse
    const under = [], rail = [], low = [];
    for (let i = 0; i <= n; i++) {
      under.push(at(i, s * (W - 0.16), -0.05));
      rail.push(at(i, s * W, 0.95));
      low.push(at(i, s * (W - 0.05), 0.42));
    }
    k.put(B.rope, ropeGeo(under, 0.035));
    k.put(B.rope, ropeGeo(rail, 0.042));
    k.put(B.rope, ropeGeo(low, 0.026));
    // suspentes : de la main courante à la porteuse, nouées en haut et sur la corde basse
    for (let i = 1; i < n; i++) {
      if (i % 2 === 0) continue;
      k.put(B.rope, ropeGeo([at(i, s * W, 0.93), at(i, s * (W - 0.05), 0.42), at(i, s * (W - 0.16), -0.03)], 0.016, { radial: 4, step: 0.2 }));
      for (const [o, y] of [[W, 0.95], [W - 0.05, 0.42]]) k.put(B.rope, new THREE.SphereGeometry(0.05, 6, 4).scale(1, 0.75, 1).translate(...at(i, s * o, y).toArray()));
    }
    // potelets ligaturés un tronçon sur deux ; poteaux d'ancrage aux deux bouts
    for (let i = 0; i <= n; i += 2) {
      if (i === 0 || i >= n - 1) continue;
      const p = at(i, s * (W + 0.02), 0);
      k.put(H.timber, plankBox(0.075, 1.05, 0.075, 1, R() * 3).rotateY(yaw).translate(p.x, p.y + 0.47, p.z));
      L.game.world.add(new CylinderCollider(a.x + p.x, a.z + p.z, a.y + p.y - 0.05, a.y + p.y + 0.99, 0.045, { surface: 'wood' }));
      for (const y of [0.92, 0.42]) k.put(B.rope, new THREE.TorusGeometry(0.058, 0.02, 4, 10).rotateX(Math.PI / 2).translate(p.x, p.y + y, p.z));
    }
    for (const i of [0, n]) {
      const p = at(i, s * (W + 0.1), 0);
      k.put(H.timber, plankBox(0.17, 1.65, 0.17, 1, R() * 3).rotateY(yaw).translate(p.x, p.y + 0.37, p.z));
      L.game.world.add(new CylinderCollider(a.x + p.x, a.z + p.z, a.y + p.y - 0.45, a.y + p.y + 1.3, 0.1, { surface: 'wood' }));
      k.put(H.timber, new THREE.ConeGeometry(0.125, 0.1, 4).rotateY(yaw + Math.PI / 4).translate(p.x, p.y + 1.25, p.z));
      k.put(H.iron, new THREE.BoxGeometry(0.19, 0.05, 0.19).rotateY(yaw).translate(p.x, p.y + 1.08, p.z));
      // tours de corde où s'amarrent la main courante et la porteuse
      for (const y of [0.88, 0.95, 1.02, -0.02, 0.05]) k.put(B.rope, new THREE.TorusGeometry(0.115, 0.024, 4, 12).rotateX(Math.PI / 2).translate(p.x, p.y + y, p.z));
    }
  }
  k.add(L, new THREE.Matrix4().makeTranslation(a.x, a.y, a.z));
}

// ------------------------------------------------------------- aides de construction et matières locales
// Géométries regroupées par matière (toutes rendues non indexées), fusionnées puis posées d'un coup
function kit() {
  const parts = new Map();
  const put = (mt, g) => { if (!parts.has(mt)) parts.set(mt, []); parts.get(mt).push(ni(g)); return g; };
  const merged = () => [...parts].map(([mt, list]) => { const g = mergeGeometries(list); g.userData.shared = true; return [mt, g]; });
  return { put, merged, add: (L, M) => { for (const [mt, g] of merged()) L.add(g, mt, M); } };
}
// UV multipliées (panneaux de tôle répétés autour d'un cylindre, etc.)
const uvRep = (g, su, sv = 1) => {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return g;
};
// UV ramenées de 0 à 1 sur l'emprise de la pièce (plaque découpée : usure de la peinture sur son pourtour)
const uvFit = (g) => {
  const uv = g.attributes.uv;
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (let i = 0; i < uv.count; i++) { u0 = Math.min(u0, uv.getX(i)); u1 = Math.max(u1, uv.getX(i)); v0 = Math.min(v0, uv.getY(i)); v1 = Math.max(v1, uv.getY(i)); }
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) - u0) / (u1 - u0 || 1), (uv.getY(i) - v0) / (v1 - v0 || 1));
  return g;
};
// Couronne de révolution à section rectangulaire (frette, bride, cerclage) : rayons r0 → r1, de y0 à y1
const ringBand = (r0, r1, y0, y1, seg = 36) => new THREE.LatheGeometry([[r0, y0], [r1, y0], [r1, y1], [r0, y1], [r0, y0]].map(([r, y]) => new THREE.Vector2(r, y)), seg);
// Couleur uniforme (teinte propre d'un bloc de pierre)
const tintGeo = (g, r, gg = r, b = r) => {
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = gg; c[i * 3 + 2] = b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
};

// Texture de canvas locale (raccordable), avec sa carte de normales : fn(u, v, out) écrit r, g, b et rend une hauteur
const LT = new Map();
function localTex(key, size, fn, strength = 2) {
  if (LT.has(key)) return LT.get(key);
  const cv = () => { const c = document.createElement('canvas'); c.width = c.height = size; return c; };
  const c = cv(), ctx = c.getContext('2d'), img = ctx.createImageData(size, size);
  const hs = new Float32Array(size * size), out = [0, 0, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      hs[y * size + x] = fn(x / size, y / size, out) ?? 0.5;
      const i = (y * size + x) * 4;
      img.data[i] = Math.max(0, Math.min(1, out[0])) * 255;
      img.data[i + 1] = Math.max(0, Math.min(1, out[1])) * 255;
      img.data[i + 2] = Math.max(0, Math.min(1, out[2])) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const nc = cv(), nctx = nc.getContext('2d'), nimg = nctx.createImageData(size, size);
  const H = (x, y) => hs[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1), i = (y * size + x) * 4;
      nimg.data[i] = (-dx / l * 0.5 + 0.5) * 255;
      nimg.data[i + 1] = (dy / l * 0.5 + 0.5) * 255;
      nimg.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      nimg.data[i + 3] = 255;
    }
  }
  nctx.putImageData(nimg, 0, 0);
  const tex = (cnv, srgb) => {
    const t = new THREE.CanvasTexture(cnv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.userData.shared = true;
    return t;
  };
  const res = { map: tex(c, true), normalMap: tex(nc, false) };
  LT.set(key, res);
  return res;
}
const hex3 = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
const mixc = (out, a, b, t) => { t = Math.max(0, Math.min(1, t)); for (let k = 0; k < 3; k++) out[k] = a[k] + (b[k] - a[k]) * t; return out; };

// Cordage de chanvre à trois torons : u court le long de la corde (un pas de torsade par unité), v en fait le tour
function ropeTexture() {
  const dark = hex3('#6e4c22'), light = hex3('#f2d08a');
  return localTex('corde', 256, (u, v, out) => {
    const ph = (((v * 3 + u) % 1) + 1) % 1;
    const s = Math.sin(Math.PI * ph);
    const fib = fbm2(u * 32, v * 32, 2, 611, 32), blot = fbm2(u * 4, v * 4, 3, 617, 4);
    const h = Math.pow(s, 0.55) * (0.88 + fib * 0.24);
    mixc(out, dark, light, h * 0.95 - 0.08 + (fib - 0.5) * 0.35 + (blot - 0.5) * 0.2);
    return h;
  }, 3);
}
// Osier tressé : brins horizontaux arrondis, rang après rang, qui ondulent en passant devant puis derrière les montants
// (décalés d'un rang à l'autre) ; u : 12 montants par tuile, v : 14 rangs
function wickerTexture() {
  const dark = hex3('#6a421c'), light = hex3('#ebc27e');
  return localTex('osier', 256, (u, v, out) => {
    const y = v * 14, cy = Math.floor(y), fy = y - cy;
    const wave = 0.5 + 0.5 * Math.cos(Math.PI * 2 * (u * 12 + (cy % 2) * 0.5));
    const prof = Math.pow(Math.sin(Math.PI * fy), 0.6);
    const n = fbm2(u * 32, v * 32, 2, 621, 32), r = noise2(cy * 3.1, 0.5, 623);
    const h = prof * (0.65 + 0.35 * wave);
    mixc(out, dark, light, h * (0.82 + n * 0.3) + (r - 0.5) * 0.15);
    return h;
  }, 4);
}
// Toile cousue d'enveloppe (presque blanche, teintée par le matériau) : u en travers du fuseau, coutures doublées et
// piquées en u = 0 et 1 ; v : un panneau par tuile, couture horizontale piquée en v = 0
function fabricTexture() {
  return localTex('toile', 256, (u, v, out) => {
    let c = 0.88 + 0.1 * Math.sin(Math.PI * u) + (fbm2(u * 6, v * 6, 3, 631, 6) - 0.5) * 0.06 + (noise2(u * 96, v * 96, 633, 96) - 0.5) * 0.03;
    let h = 0.5 + 0.12 * Math.sin(Math.PI * u);
    const eu = Math.min(u, 1 - u), ev = Math.min(v, 1 - v);
    if (eu < 0.05) {
      c *= 0.84; h = 0.64;
      if (Math.abs(eu - 0.03) < 0.007 && (v * 48) % 1 < 0.55) { c *= 0.6; h = 0.68; }
    } else if (ev < 0.028) {
      c *= 0.88; h = 0.6;
      if (Math.abs(ev - 0.014) < 0.006 && (u * 36) % 1 < 0.55) c *= 0.6;
    }
    out[0] = c; out[1] = c; out[2] = c * 0.985;
    return h;
  }, 2.5);
}

// Corde tressée le long des points pts (rayon r) : UV de cordage (un pas de torsade ≈ 8 rayons)
function ropeGeo(pts, r, o = {}) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const len = curve.getLength();
  const g = new THREE.TubeGeometry(curve, Math.max(o.min ?? 2, Math.ceil(len / (o.step ?? 0.16))), r, o.radial ?? 6, false).toNonIndexed();
  return uvRep(g, len / (r * 8), 1);
}
// Volant à rayons (axe +z, centre à l'origine) : jante, rayons, moyeu, poignée
function handwheel(put, mt, R, o = {}) {
  const geos = [new THREE.TorusGeometry(R, o.rim ?? 0.035, 6, 24)];
  const n = o.spokes ?? 5;
  for (let k = 0; k < n; k++) geos.push(new THREE.BoxGeometry(R * 0.98, 0.03, 0.03).translate(R * 0.49, 0, 0).rotateZ((k / n) * Math.PI * 2));
  geos.push(new THREE.CylinderGeometry(R * 0.2, R * 0.2, 0.08, 10).rotateX(Math.PI / 2));
  geos.push(new THREE.CylinderGeometry(0.022, 0.022, 0.16, 8).rotateX(Math.PI / 2).translate(R, 0, 0.08));
  geos.push(new THREE.SphereGeometry(0.035, 8, 6).translate(R, 0, 0.17));
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), o.axis || new THREE.Vector3(0, 0, 1));
  for (const g of geos) put(mt, g.applyQuaternion(q).translate(o.at ? o.at.x : 0, o.at ? o.at.y : 0, o.at ? o.at.z : 0));
}

// ------------------------------------------------------------- machines des Vorax (canon à nuages, ventilateur)
const CM = {};
function machineMats() {
  if (CM.ready) return CM;
  const tm = (t, o) => mat('#ffffff', { map: t.map, normalMap: t.normalMap, ...o });
  CM.pink = tm(paintedMetalTexture('#ff7a92', 'canon-rose', { chip: 0.25, edge: 0.4, rust: 0.05 }), { rough: 0.42, metal: 0.35 });
  CM.slate = tm(paintedMetalTexture('#3a3f55', 'machine-ardoise', { chip: 0.35, edge: 0.75, rust: 0.2 }), { rough: 0.5, metal: 0.55 });
  CM.deck = tm(treadPlateTexture('#7d869c', 'canon-pont'), { rough: 0.45, metal: 0.7 });
  CM.gold = mat('#ffd23a', { metal: 0.8, rough: 0.3 });
  CM.steel = mat('#c9d2e3', { metal: 0.8, rough: 0.3 });
  CM.bore = mat('#1c1824', { rough: 0.85, side: THREE.DoubleSide, rim: 0 });
  CM.cream = mat('#fff3df', { rough: 0.5 });
  CM.ready = true;
  return CM;
}
// rivets en couronne (rayon r, hauteur y, n têtes tournées vers l'extérieur)
function rivetRing(list, r, y, n, size = 0.03, a0 = 0) {
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    rivets(list, [[Math.sin(a) * r, y, Math.cos(a) * r]], [Math.sin(a), 0, Math.cos(a)], size);
  }
  return list;
}

// Canon à nuages : tourelle tournante (socle boulonné, tambour de tôle peinte à couvre-joints rivetés, cerclages,
// couronne dentée et volant de pointage, pont en tôle larmée), flasques rivetées portant les tourillons ; fût rose
// cerclé de frettes rivetées, culasse à bouton, anses dorées, hausse et guidon, bouche à bourrelet dorée, âme sombre ;
// secteur denté d'élévation, pignon et volant sur la flasque gauche. Renvoie { root, barrel, mouth } : le fût (barrel)
// pivote autour de y = 1,6 ; la bouche (mouth, lumineuse, cachée) est à 4,26 dans son axe.
export function cloudCannon(L, pos) {
  const C = machineMats(), H = hutMats();
  const root = joint(L.root, [pos.x, pos.y, pos.z]);
  // ---- tourelle (décor fixe, fusionné avec le niveau)
  const k = kit(), riv = [], N = 40;
  // socle : il descend jusqu'au sol le plus bas sous lui (posé sur tout son tour)
  const [lo] = groundSpan(L, ringPts(pos.x, pos.z, 2.38, 24), pos.y);
  const s0 = Math.min(0, lo - pos.y - 0.04);
  k.put(C.slate, uvRep(new THREE.CylinderGeometry(2.3, 2.38 - 0.4 * s0, 0.2 - s0, N), 14).translate(0, (0.2 + s0) / 2, 0));
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    k.put(H.iron, new THREE.CylinderGeometry(0.045, 0.045, 0.05, 6).translate(Math.sin(a) * 2.24, 0.22, Math.cos(a) * 2.24));
  }
  k.put(C.slate, uvRep(new THREE.CylinderGeometry(2.15, 2.15, 0.76, N, 1, true), 12).translate(0, 0.58, 0));
  for (const y of [0.27, 0.9]) {
    k.put(H.iron, ringBand(2.13, 2.2, y - 0.05, y + 0.05, N));
    rivetRing(riv, 2.2, y, 36, 0.028);
  }
  // couvre-joints des panneaux du tambour
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, s = Math.sin(a), c = Math.cos(a);
    k.put(H.iron, new THREE.BoxGeometry(0.08, 0.52, 0.02).rotateY(a).translate(s * 2.16, 0.585, c * 2.16));
    for (const y of [0.42, 0.585, 0.75]) rivets(riv, [[s * 2.172, y, c * 2.172]], [s, 0, c], 0.022);
  }
  // couronne dentée de pointage sous le pont
  k.put(H.iron, ringBand(2.1, 2.19, 0.98, 1.02, N));
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    k.put(H.iron, new THREE.BoxGeometry(0.05, 0.06, 0.07).rotateY(a).translate(Math.sin(a) * 2.21, 1.0, Math.cos(a) * 2.21));
  }
  k.put(C.deck, uvRep(new THREE.CylinderGeometry(2.04, 2.08, 0.1, N), 8, 8).translate(0, 1.07, 0));
  // boîtier et volant de pointage, à l'arrière gauche
  {
    const a = -2.3, s = Math.sin(a), c = Math.cos(a);
    k.put(C.slate, uvFit(new THREE.BoxGeometry(0.42, 0.4, 0.3)).rotateY(a).translate(s * 2.3, 0.62, c * 2.3));
    k.put(H.iron, new THREE.CylinderGeometry(0.035, 0.035, 0.32, 8).rotateX(Math.PI / 2).rotateY(a).translate(s * 2.55, 0.62, c * 2.55));
    handwheel(k.put, C.gold, 0.26, { axis: new THREE.Vector3(s, 0, c), at: new THREE.Vector3(s * 2.68, 0.62, c * 2.68) });
  }
  // flasques : plaques découpées, rivetées sur leur pourtour, tourillons à moyeu doré
  const cheek = [[-1.25, 1.08], [1.15, 1.08], [0.75, 1.9], [0.3, 2.15], [-0.4, 2.12], [-1.05, 1.7]];
  const shape = new THREE.Shape();
  cheek.forEach(([z, y], i) => (i ? shape.lineTo(-z, y) : shape.moveTo(-z, y)));
  shape.closePath();
  for (const sx of [-1, 1]) {
    const g = uvFit(new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1 }));
    k.put(C.slate, g.rotateY(Math.PI / 2).translate(sx > 0 ? 1.47 : -1.65, 0, 0));
    const xo = sx * 1.67;
    for (let i = 0; i < cheek.length; i++) {
      const [z0, y0] = cheek[i], [z1, y1] = cheek[(i + 1) % cheek.length];
      const l = Math.hypot(z1 - z0, y1 - y0), n = Math.max(1, Math.round(l / 0.3));
      for (let t = 0; t < n; t++) {
        const f = (t + 0.5) / n, z = z0 + (z1 - z0) * f, y = y0 + (y1 - y0) * f;
        // un peu en dedans du bord
        rivets(riv, [[xo, y + (1.62 - y) * 0.12, z * 0.88]], [sx, 0, 0], 0.028);
      }
    }
    k.put(C.gold, new THREE.CylinderGeometry(0.3, 0.32, 0.12, 20).rotateZ(Math.PI / 2).translate(sx * 1.72, 1.6, 0));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      rivets(riv, [[sx * 1.785, 1.6 + Math.sin(a) * 0.21, Math.cos(a) * 0.21]], [sx, 0, 0], 0.026);
    }
  }
  // axe des tourillons, d'une flasque à l'autre à travers le fût (il comble le jeu entre le fût et les flasques) et
  // jusqu'au secteur denté, à gauche
  k.put(H.iron, new THREE.CylinderGeometry(0.2, 0.2, 3.6, 16).rotateZ(Math.PI / 2).translate(-0.05, 1.6, 0));
  // pignon et volant d'élévation sur la flasque gauche (le secteur denté est sur le fût)
  {
    const py = 1.6 - 0.99 * Math.sin(5 * Math.PI / 180), pz = -0.99 * Math.cos(5 * Math.PI / 180);
    k.put(H.iron, new THREE.CylinderGeometry(0.1, 0.1, 0.07, 14).rotateZ(Math.PI / 2).translate(-1.83, py, pz));
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      k.put(H.iron, new THREE.BoxGeometry(0.07, 0.05, 0.04).rotateX(a).translate(-1.83, py + Math.cos(a) * 0.115, pz + Math.sin(a) * 0.115));
    }
    k.put(H.iron, new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8).rotateZ(Math.PI / 2).translate(-1.9, py, pz));
    handwheel(k.put, C.gold, 0.3, { axis: new THREE.Vector3(-1, 0, 0), at: new THREE.Vector3(-2.12, py, pz) });
  }
  k.put(H.iron, mergeGeometries(riv));
  k.add(L, new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z));
  // solides : socle, tambour et pont, flasques, bas du fût (incliné de 0,6 rad, comme le règle le niveau) ; le haut du
  // fût reste libre (Kobi y est placé au moment du tir)
  const W = L.game.world;
  W.add(new CylinderCollider(pos.x, pos.z, pos.y, pos.y + 0.2, 2.38, { surface: 'metal' }));
  W.add(new CylinderCollider(pos.x, pos.z, pos.y + 0.2, pos.y + 1.12, 2.2, { surface: 'metal' }));
  for (const sx of [-1, 1]) W.add(new BoxCollider(new THREE.Vector3(pos.x + sx * 1.57, pos.y + 1.52, pos.z - 0.05), new THREE.Vector3(0.11, 0.44, 1.05), null, { surface: 'metal' }));
  const bq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.6);
  W.add(new BoxCollider(new THREE.Vector3(0, 0.2, 0).applyQuaternion(bq).add(new THREE.Vector3(pos.x, pos.y + 1.6, pos.z)), new THREE.Vector3(1.2, 1.4, 1.2), bq, { surface: 'metal' }));

  // ---- fût (pivote avec son joint)
  const barrel = joint(root, [0, 1.6, 0]);
  const b = kit(), briv = [];
  const r = (y) => 1.4 - (y + 0.25) * 0.047;
  const hoops = [[-0.25, -0.05], [0.7, 0.88], [1.85, 2.03], [2.95, 3.13], [3.78, 3.95]];
  for (let i = 0; i < hoops.length - 1; i++) {
    const y0 = hoops[i][1] - 0.02, y1 = hoops[i + 1][0] + 0.02;
    b.put(C.pink, uvRep(new THREE.CylinderGeometry(r(y1), r(y0), y1 - y0, 40, 1, true), 8).translate(0, (y0 + y1) / 2, 0));
  }
  for (const [y0, y1] of hoops) {
    const rr = r((y0 + y1) / 2);
    b.put(H.iron, ringBand(rr - 0.02, rr + 0.055, y0, y1, 40));
    rivetRing(briv, rr + 0.055, (y0 + y1) / 2, 28, 0.026, 0.1);
  }
  // culasse et bouton
  b.put(C.slate, new THREE.SphereGeometry(1.4, 32, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(1, 0.5, 1).translate(0, -0.25, 0));
  b.put(C.slate, new THREE.CylinderGeometry(0.16, 0.24, 0.2, 14).translate(0, -1.0, 0));
  b.put(C.gold, new THREE.SphereGeometry(0.2, 14, 10).translate(0, -1.18, 0));
  // bourrelet de bouche, anneau doré (identité du canon), âme sombre
  b.put(C.pink, new THREE.LatheGeometry([[1.22, 3.93], [1.33, 4.02], [1.34, 4.1], [1.24, 4.15], [1.18, 4.18]].map(([x, y]) => new THREE.Vector2(x, y)), 40));
  b.put(C.gold, new THREE.TorusGeometry(1.25, 0.18, 10, 40).rotateX(Math.PI / 2).translate(0, 4.2, 0));
  b.put(C.bore, new THREE.CylinderGeometry(1.06, 1.06, 1.8, 32, 1, true).translate(0, 3.38, 0));
  b.put(C.bore, new THREE.CircleGeometry(1.06, 32).rotateX(-Math.PI / 2).translate(0, 2.5, 0));
  // anses dorées (dessus du fût : -z local), hausse et guidon
  for (const x of [-0.38, 0.38]) b.put(C.gold, new THREE.TorusGeometry(0.22, 0.055, 6, 14, Math.PI).rotateZ(Math.PI / 2).rotateY(-Math.PI / 2).translate(x, 1.45, -r(1.45) + 0.03));
  b.put(H.iron, new THREE.BoxGeometry(0.05, 0.16, 0.12).translate(0, 3.6, -r(3.6) - 0.05));
  b.put(H.iron, new THREE.BoxGeometry(0.22, 0.12, 0.1).translate(0, 0.35, -r(0.35) - 0.03));
  // emblème : petit nuage crème peint de chaque côté
  for (const sx of [-1, 1]) {
    for (const [dy, dz, s] of [[0, 0, 0.3], [0.05, 0.32, 0.22], [0.02, -0.3, 0.2], [0.2, 0.08, 0.2]]) {
      const y = 2.45 + dy, x = sx * (r(y) - 0.04);
      b.put(CM.cream, new THREE.SphereGeometry(s, 12, 8).scale(0.18, 1, 1).translate(x, y, dz));
    }
  }
  // secteur denté d'élévation, côté gauche, centré sur les tourillons
  b.put(H.iron, new THREE.CylinderGeometry(0.86, 0.86, 0.06, 18, 1, false, (130 * Math.PI) / 180, (100 * Math.PI) / 180).rotateZ(Math.PI / 2).translate(-1.83, 0, 0));
  for (let i = 0; i <= 18; i++) {
    const a = ((-140 + (i / 18) * 100) * Math.PI) / 180;
    b.put(H.iron, new THREE.BoxGeometry(0.06, 0.07, 0.05).rotateX(a).translate(-1.83, Math.cos(a) * 0.9, Math.sin(a) * 0.9));
  }
  b.put(H.iron, mergeGeometries(briv));
  for (const [mt, g] of b.merged()) part(barrel, g, mt);
  const mouth = part(barrel, G.cyl(1.05, 1.05, 0.1, 18), glow('#7ff3ff', 1.5), { p: [0, 4.26, 0] });
  mouth.visible = false;
  return { root, barrel, mouth };
}

// Ventilateur du courant ascendant : carter de tôle peinte à bride boulonnée sur l'herbe, couronne lumineuse, grille de
// cercles et de rayons, moteur à ailettes tenu par quatre bras sous la grille ; hélice à six pales vrillées sur un moyeu
// à ogive. Le carter ne dépasse l'herbe que de 23 cm. Renvoie le joint de l'hélice (à faire
// tourner autour de y).
let fanBlade = null;
export function updraftFan(L, pos) {
  const C = machineMats(), H = hutMats();
  const k = kit(), riv = [];
  // bride au sol (sa tranche descend jusqu'au sol le plus bas sous elle : posée sur tout son tour), carter, bride
  // haute, intérieur sombre
  const [lo] = groundSpan(L, [...ringPts(pos.x, pos.z, 2.75, 24), ...ringPts(pos.x, pos.z, 2.0, 16)], pos.y);
  k.put(C.slate, uvRep(ringBand(2.0, 2.75, Math.min(-0.07, lo - pos.y - 0.04), 0.02, 48), 16));
  for (let i = 0; i < 24; i++) {
    const a = ((i + 0.5) / 24) * Math.PI * 2;
    k.put(H.iron, new THREE.CylinderGeometry(0.05, 0.05, 0.05, 6).translate(Math.sin(a) * 2.6, 0.04, Math.cos(a) * 2.6));
  }
  k.put(C.slate, uvRep(new THREE.CylinderGeometry(2.45, 2.47, 0.2, 48, 1, true), 12).translate(0, 0.1, 0));
  k.put(C.slate, uvRep(ringBand(2.08, 2.58, 0.17, 0.23, 48), 16));
  rivetRing(riv, 2.47, 0.1, 36, 0.026);
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    rivets(riv, [[Math.sin(a) * 2.5, 0.23, Math.cos(a) * 2.5]], [0, 1, 0], 0.024);
  }
  // fond du carter (juste au-dessus du dessus de l'île) et paroi intérieure
  k.put(C.bore, new THREE.CylinderGeometry(2.1, 2.1, 0.2, 40, 1, true).translate(0, 0.13, 0));
  k.put(C.bore, new THREE.CircleGeometry(2.1, 40).rotateX(-Math.PI / 2).translate(0, 0.045, 0));
  // couronne lumineuse posée sur la bride
  k.put(glow('#7ff3ff', 2), new THREE.TorusGeometry(2.33, 0.07, 6, 56).rotateX(Math.PI / 2).translate(0, 0.25, 0));
  // grille : cercles et rayons
  for (const R of [0.6, 1.0, 1.4, 1.78]) k.put(H.iron, new THREE.TorusGeometry(R, 0.022, 4, Math.round(R * 30)).rotateX(Math.PI / 2).translate(0, 0.2, 0));
  for (let i = 0; i < 16; i++) k.put(H.iron, new THREE.BoxGeometry(0.035, 0.035, 1.72).translate(0, 0.2, 1.24).rotateY((i / 16) * Math.PI * 2));
  // moteur au centre de la grille : carcasse à ailettes, calotte, plaque de laiton rivetée
  k.put(C.slate, uvRep(new THREE.CylinderGeometry(0.4, 0.43, 0.12, 24), 4).translate(0, 0.23, 0));
  for (let i = 0; i < 16; i++) k.put(H.iron, new THREE.BoxGeometry(0.025, 0.1, 0.07).translate(0, 0.23, 0.44).rotateY((i / 16) * Math.PI * 2));
  k.put(C.slate, new THREE.SphereGeometry(0.4, 24, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.18, 1).translate(0, 0.29, 0));
  k.put(H.brass, new THREE.CylinderGeometry(0.17, 0.17, 0.02, 20).translate(0, 0.36, 0));
  for (let i = 0; i < 8; i++) rivets(riv, [[Math.sin(i * 0.785) * 0.3, 0.33, Math.cos(i * 0.785) * 0.3]], [0, 1, 0], 0.02);
  k.put(C.steel, new THREE.CylinderGeometry(0.06, 0.06, 0.12, 10).translate(0, 0.14, 0));
  k.put(H.iron, mergeGeometries(riv));
  k.add(L, new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z));
  // solides : carter (grille comprise) et moteur, étiquetés « courant » comme l'îlot (jamais retenus comme point de
  // reprise) ; le courant ascendant ne dépend que de sa zone de vent
  L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y - 0.1, pos.y + 0.23, 2.6, { surface: 'metal', tag: 'courant' }));
  L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y + 0.23, pos.y + 0.37, 0.43, { surface: 'metal', tag: 'courant' }));
  // hélice : pales vrillées (calage fort au pied, faible en bout), bouts arrondis, colliers, moyeu à ogive
  if (!fanBlade) {
    const f = kit();
    for (let i = 0; i < 6; i++) {
      const g = new THREE.BoxGeometry(1.62, 0.03, 0.36, 12, 1, 2).translate(0.38 + 0.81, 0, 0);
      const p = g.attributes.position;
      for (let j = 0; j < p.count; j++) {
        const x = p.getX(j), t = (x - 0.38) / 1.62;
        let z = p.getZ(j) * (1 - 0.22 * t);
        if (t > 0.8) z *= Math.sqrt(Math.max(0.05, 1 - Math.pow((t - 0.8) / 0.2, 2)));
        const tw = 0.38 - 0.2 * t, y = p.getY(j);
        p.setXYZ(j, x, y * Math.cos(tw) + z * Math.sin(tw), -y * Math.sin(tw) + z * Math.cos(tw));
      }
      g.computeVertexNormals();
      f.put(C.steel, g.rotateY((i / 6) * Math.PI * 2));
      f.put(H.iron, new THREE.BoxGeometry(0.16, 0.08, 0.26).translate(0.4, 0, 0).rotateY((i / 6) * Math.PI * 2));
    }
    f.put(C.slate, new THREE.CylinderGeometry(0.34, 0.36, 0.1, 20));
    f.put(C.gold, new THREE.CylinderGeometry(0.2, 0.3, 0.06, 20).translate(0, 0.07, 0));
    fanBlade = f.merged();
  }
  const fan = joint(L.root, [pos.x, pos.y + 0.112, pos.z]);
  for (const [mt, g] of fanBlade) part(fan, g, mt);
  return fan;
}

// Coffre céleste : petit édicule de pierre en assises réglées (blocs aux arêtes adoucies, de teintes inégales, harpés
// aux angles, joints sombres), soubassement débordant, rosaces de glyphes lumineux sur les flancs, linteau à clef
// au-dessus de la porte, chapeau mouluré (frise, doucines, denticules, larmier, chaperon et acrotères d'angle).
// C : centre au sol, q : orientation (la porte magnétique, posée par le niveau, est en +z local à 2 m).
// Collisions : quatre dalles (deux flancs, fond, toit).
export function skyVault(L, C, q) {
  const m = mats();
  const box = (dx, dz, w, h, d, y = 0) => {
    const p = new THREE.Vector3(dx * Math.cos(q) + dz * Math.sin(q), 0, -dx * Math.sin(q) + dz * Math.cos(q)).add(C);
    L.box(new THREE.Vector3(p.x, C.y + y + h / 2, p.z), new THREE.Vector3(w, h, d), null, { ry: q, surface: 'rock' });
  };
  box(-1.6, 0, 0.5, 4.6, 4);
  box(1.6, 0, 0.5, 4.6, 4);
  box(0, -1.8, 3.7, 4.6, 0.5);
  box(0, 0, 4, 0.5, 4.4, 4.6);
  // décor rendu solide : soubassement, linteau à clef, corniche, chaperon, acrotères d'angle
  for (const s of [-1, 1]) box(s * 1.6, -0.29, 0.64, 0.34, 3.68);
  box(0, -1.84, 2.56, 0.34, 0.6);
  box(0, 1.98, 3.7, 0.33, 0.75, 4.29);
  box(0, -0.03, 4.25, 0.16, 4.66, 4.92);
  box(0, -0.03, 4.1, 0.1, 4.5, 5.08);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(sx * 1.9, -0.03 + sz * 2.1, 0.32, 0.4, 0.32, 5.15);
  const R = mkRng(1187), k = kit();
  const stone = (g, dark = 1) => {
    const t = (0.84 + R() * 0.2) * dark, w = (R() - 0.5) * 0.05;
    return k.put(m.stone, tintGeo(ni(g), t * (1 + w), t, t * (1 - w)));
  };
  // bloc aux arêtes adoucies, posé en (x, y, z), légèrement de travers
  const block = (w, h, d, x, y, z) => stone(new RoundedBoxGeometry(w, h, d, 1, Math.min(0.06, h * 0.18, w * 0.18, d * 0.18))
    .rotateY((R() - 0.5) * 0.025).rotateZ((R() - 0.5) * 0.012).translate(x, y, z));
  // assise de blocs le long de x (alongX) ou de z, de a0 à a1, centrée en c (autre axe), épaisseur T
  const course = (alongX, a0, a1, c, T, y, h, half) => {
    let a = a0, first = true;
    while (a < a1 - 0.05) {
      let len = (first && half ? 0.5 : 1) * (0.75 + R() * 0.55);
      if (a1 - a - len < 0.4) len = a1 - a;
      first = false;
      const mid = a + len / 2, ins = R() * 0.03, bw = len - 0.04, bt = T - ins * 2, bh = h - 0.04;
      if (alongX) block(bw, bh, bt, mid, y, c + (R() - 0.5) * 0.02);
      else block(bt, bh, bw, c + (R() - 0.5) * 0.02, y, mid);
      a += len;
    }
  };
  // noyau de mortier sombre derrière les joints
  stone(new THREE.BoxGeometry(0.4, 4.3, 3.95).translate(-1.6, 2.45, -0.03), 0.4);
  stone(new THREE.BoxGeometry(0.4, 4.3, 3.95).translate(1.6, 2.45, -0.03), 0.4);
  stone(new THREE.BoxGeometry(2.8, 4.3, 0.4).translate(0, 2.45, -1.8), 0.4);
  // soubassement débordant (sous les flancs et le fond, arrêté avant les socles de la porte) : il descend jusqu'au
  // sol le plus bas sous l'édicule (posé à plat sur un dessus d'île bombé)
  const foot = [];
  for (let u = -2.1; u <= 2.11; u += 0.7) for (let v = -2.2; v <= 2.11; v += 0.72) foot.push([C.x + u * Math.cos(q) + v * Math.sin(q), C.z - u * Math.sin(q) + v * Math.cos(q)]);
  const y0 = Math.min(0.02, groundSpan(L, foot, C.y)[0] - C.y - 0.04);
  for (const s of [-1, 1]) course(false, -2.13, 1.55, s * 1.6, 0.64, (y0 + 0.32) / 2, 0.36 - y0, false);
  course(true, -1.28, 1.28, -1.84, 0.6, (y0 + 0.32) / 2, 0.36 - y0, false);
  // assises réglées, harpées aux angles du fond (une assise sur deux, le flanc ou le fond passe devant)
  const nC = 8, ch = (4.6 - 0.34) / nC;
  for (let i = 0; i < nC; i++) {
    const y = 0.34 + ch * (i + 0.5), odd = i % 2 === 1;
    for (const s of [-1, 1]) course(false, odd ? -1.55 : -2.05, 2.0, s * 1.6, 0.5, y, ch, odd);
    course(true, odd ? -1.85 : -1.35, odd ? 1.85 : 1.35, -1.8, 0.5, y, ch, !odd);
  }
  // rosaces de glyphes lumineux sur les flancs
  const glowM = glow('#7ff3ff', 1.6);
  for (const s of [-1, 1]) {
    stone(new THREE.CylinderGeometry(0.72, 0.76, 0.06, 28).rotateZ(Math.PI / 2).translate(s * 1.88, 2.5, -0.1), 0.95);
    k.put(glowM, new THREE.TorusGeometry(0.56, 0.04, 6, 32).rotateY(Math.PI / 2).translate(s * 1.92, 2.5, -0.1));
    k.put(glowM, new THREE.TorusGeometry(0.22, 0.03, 6, 20).rotateY(Math.PI / 2).translate(s * 1.92, 2.5, -0.1));
    for (let j = 0; j < 6; j++) {
      const a = (j / 6) * Math.PI * 2;
      k.put(glowM, new THREE.BoxGeometry(0.03, 0.22, 0.03).translate(0, 0.39, 0).rotateX(a).translate(s * 1.92, 2.5, -0.1));
    }
  }
  // linteau à clef au-dessus de la porte
  block(3.7, 0.3, 0.42, 0, 4.45, 1.82);
  block(0.5, 0.36, 0.5, 0, 4.45, 2.1);
  // chapeau mouluré
  block(3.86, 0.13, 4.26, 0, 4.665, -0.03);
  block(4.0, 0.06, 4.4, 0, 4.76, -0.03);
  block(4.1, 0.05, 4.5, 0, 4.815, -0.03);
  for (const [w, d, z] of [[4.1, 4.5, -0.03]]) {
    for (let x = -w / 2 + 0.1; x < w / 2 - 0.05; x += 0.2) for (const s of [-1, 1]) stone(new THREE.BoxGeometry(0.1, 0.08, 0.08).translate(x, 4.88, z + s * (d / 2 + 0.02)));
    for (let zz = -d / 2 + 0.12; zz < d / 2 - 0.05; zz += 0.2) for (const s of [-1, 1]) stone(new THREE.BoxGeometry(0.08, 0.08, 0.1).translate(s * (w / 2 + 0.02), 4.88, z + zz));
  }
  stone(new RoundedBoxGeometry(4.25, 0.16, 4.66, 1, 0.04).translate(0, 5.0, -0.03));
  const cap = new THREE.CylinderGeometry(0.88, 1, 0.1, 4, 1).rotateY(Math.PI / 4);
  stone(cap.scale(2.06 / Math.SQRT1_2, 1, 2.27 / Math.SQRT1_2).translate(0, 5.13, -0.03));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    block(0.32, 0.2, 0.32, sx * 1.9, 5.25, -0.03 + sz * 2.1);
    stone(new THREE.SphereGeometry(0.1, 10, 6).translate(sx * 1.9, 5.4, -0.03 + sz * 2.1));
  }
  k.add(L, new THREE.Matrix4().compose(C, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), q), new THREE.Vector3(1, 1, 1)));
}
