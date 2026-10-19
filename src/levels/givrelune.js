// Planète 3 — Givrelune : la Lune des Glaces (banquise, piste de glisse, crevasse et mine du Baron).
import * as THREE from 'three';
import { lights } from '../engine/lightpool.js';
import { probes } from '../engine/probes.js';
import { snowTexture, rockTexture, hazardTexture, paintedMetalTexture, treadPlateTexture, containerTexture } from '../engine/textures.js';
import { fbm2, noise3, distToPolyline, smooth, clamp, lerp, rng, rand } from '../engine/util.js';
import { container, barrel, lamp, kobiShip, propMats, rivets, beam, rboxAt, rock, corrugated } from '../models/environment/props.js';
import { boxUV } from './level.js';
import { pine, igloo, icePillar, iceShards, snowDrift, snowman, iceLantern, drillRig, iceSlide, iceMats, iceFloe, snowSparkle, floodlight } from '../models/environment/ice.js';
import { createWater, waterFloaters, waterSplashes } from '../engine/water/water.js';
import { morseModel } from '../models/npc.js';
import { Arena } from '../game/arena.js';
import { shipExit, placeNpc, wallChimney } from './common.js';
import { mat, glow } from '../engine/materials.js';
import { G, mergeGeometries, mergeVertices } from '../models/geo.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { motes } from '../models/nature.js';
import { BoxCollider, CylinderCollider } from '../engine/physics.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const PATH = [[2, -44], [2, 0], [5, 40], [3, 80], [0, 108], [1, 140], [-1, 170], [-2, 200], [-2, 250], [4, 285], [7, 320], [3, 360], [0, 398], [0, 480]];
// demi-largeur de la vallée, altitude du fond et amplitude des congères le long du parcours
const HW = [[-44, 24], [34, 26], [50, 21], [104, 20], [112, 15], [160, 14], [170, 9], [248, 9], [258, 26], [326, 26], [334, 21], [392, 21], [398, 13], [403, 13], [412, 28], [474, 28], [486, 18]];
const FLOOR = [[-60, 0], [110, 0], [112, -60], [165, -60], [167, -16], [218, -16], [220, -60], [238, -60], [240, -16], [248, -16], [250, 0], [520, 0]];
const AMP = [[-60, 0.35], [30, 0.35], [44, 0.9], [96, 0.9], [104, 0.05], [114, 0.05], [166, 0], [178, 0], [186, 0.3], [248, 0.3], [256, 0.7], [326, 0.7], [334, 0.35], [394, 0.35], [404, 0.1]];
const LAKE = { x0: 11, x1: 25, z0: 2, z1: 32 };
// eau libre : chenal entre le lac et la falaise est, qu'une source tiède garde ouvert (peu profond : Kobi y patauge)
const POOL = { x1: 29.2, z0: 3, z1: 31.5, y: -0.25, floor: -0.62 };

function prof(z, k) {
  if (z <= k[0][0]) return k[0][1];
  for (let i = 0; i < k.length - 1; i++) {
    if (z <= k[i + 1][0]) return lerp(k[i][1], k[i + 1][1], smooth(clamp((z - k[i][0]) / (k[i + 1][0] - k[i][0]), 0, 1)));
  }
  return k[k.length - 1][1];
}
// 1 sur le lac gelé, 0 au-delà de 3 m du bord
function lakeK(x, z) {
  const dx = Math.max(LAKE.x0 - x, 0, x - LAKE.x1), dz = Math.max(LAKE.z0 - z, 0, z - LAKE.z1);
  return 1 - smooth(clamp(Math.hypot(dx, dz) / 3, 0, 1));
}
// fond du lac, creusé sous la glace à 2 m au moins du bord (le terrain autour de la dalle ne bouge pas)
function lakeDeep(x, z) {
  const d = Math.min(x - LAKE.x0 - 2, LAKE.x1 - 2 - x, z - LAKE.z0 - 2, LAKE.z1 - 2 - z);
  return smooth(clamp(d / 4, 0, 1));
}
// chenal d'eau libre (1 : fond du chenal)
function poolK(x, z) {
  if (x < LAKE.x1 - 1) return 0;
  return smooth(clamp((POOL.x1 - x) / 1.2, 0, 1)) * smooth(clamp((z - POOL.z0) / 4, 0, 1)) * smooth(clamp((POOL.z1 - z) / 4, 0, 1));
}
function dunes(x, z) {
  const amp = prof(z, AMP);
  return (fbm2(x * 0.05, z * 0.05, 3, 17) - 0.5) * 2 * amp + Math.sin(x * 0.15 + z * 0.07) * 0.2 * amp;
}
function height(x, z) {
  const { d } = distToPolyline(x, z, PATH);
  const hw = prof(z, HW);
  const ld = lakeDeep(x, z);
  const base = lerp(prof(z, FLOOR) + dunes(x, z), -0.4, lakeK(x, z)) - (ld > 0 ? ld * (2.4 + fbm2(x * 0.2, z * 0.2, 2, 29) * 1.2) : 0);
  let wall = 28 + fbm2(x * 0.02, z * 0.02, 4, 5) * 24;
  const step = 5;
  wall = Math.floor(wall / step) * step + Math.pow((wall / step) % 1, 4) * step;
  const t = smooth(clamp((d - hw) / 8, 0, 1));
  // congères au pied des falaises
  const scree = smooth(clamp((d - hw + 3) / 3, 0, 1)) * (1 - t) * 1.2;
  const h = lerp(base + scree, wall, t);
  const pk = poolK(x, z);
  return pk > 0 ? lerp(h, POOL.floor + (fbm2(x * 0.4, z * 0.4, 2, 31) - 0.5) * 0.12, pk) : h;
}

// Congère contre une paroi : vide sous son bord (hauteur du dessous de la congère au-dessus du terrain, au pire des
// huit directions à 1,3 × size du centre ; dy : enfoncement voulu sous le terrain)
function driftVoid(H, x, z, size, dy) {
  const y = H(x, z) - dy - 0.15 * size;
  let v = 0;
  for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; v = Math.max(v, y - H(x + Math.cos(a) * size * 1.3, z + Math.sin(a) * size * 1.3)); }
  return v;
}
// Recale une congère posée sur un pied de falaise trop raide (plus de 1 m de vide sous un bord) : elle glisse vers le
// fond de la vallée (x de PATH) jusqu'à un sol assez plat ; null si rien à moins de 6 m (on ne la pose pas)
const pathX = (z) => { for (let i = 0; i < PATH.length - 1; i++) if (z <= PATH[i + 1][1]) return lerp(PATH[i][0], PATH[i + 1][0], clamp((z - PATH[i][1]) / (PATH[i + 1][1] - PATH[i][1]), 0, 1)); return PATH[PATH.length - 1][0]; };
function seatDrift(H, x, z, size, dy = 0) {
  if (driftVoid(H, x, z, size, dy) <= 1) return x;
  const s = Math.sign(pathX(z) - x) || 1;
  for (let d = 0.25; d <= 6; d += 0.25) if (driftVoid(H, x + s * d, z, size, dy) <= 1) return x + s * d;
  return null;
}

const SIGN = { bg: '#1e3a6a', fg: '#eaf6ff', border: '#7ff3ff' };
const SIGN_VORAX = { bg: '#3a1470', fg: '#ffcc33', border: '#ffcc33' };

// ------------------------------------------------------------------ aides de construction des objets du niveau
const ni = (g) => (g.index ? g.toNonIndexed() : g);
// Collecteur de pièces par matière : put(matière, géométrie) puis flush(L, matrice) — une géométrie fusionnée par
// matière, posée d'un coup — ou merged() (maillages d'un objet animé). Les géométries reçues sont rendues
// compatibles (non indexées, position / normale / uv seulement).
function parts() {
  const map = new Map();
  const norm = (g) => {
    g = ni(g);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    return g;
  };
  return {
    put(m, g) { if (!map.has(m)) map.set(m, []); map.get(m).push(norm(g)); },
    merged() { const out = [...map].map(([m, list]) => [m, mergeGeometries(list)]); map.clear(); return out; },
    flush(L, matrix) { for (const [m, g] of this.merged()) L.add(g, m, matrix); },
  };
}
const bx = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).toNonIndexed().translate(x, y, z);
// boîte à UV en mètres × s (bandes de danger, tôle larmée)
const bxm = (w, h, d, x, y, z, s = 0.5) => boxUV(w, h, d, s).toNonIndexed().translate(x, y, z);
// rangée de rivets (têtes tournées vers nrm) ajoutée au collecteur
const riv = (P, m, pts, nrm, r = 0.025) => { const l = []; rivets(l, pts, nrm, r); for (const g of l) P.put(m, g); };
// Matières des installations Vorax : tôle peinte écaillée (violet d'identité, violet sombre, jaune), acier des
// rivets et boulons, tôle larmée, caoutchouc
let GM = null;
function gvMats() {
  if (GM) return GM;
  const pm = (c, key, o, m = {}) => { const t = paintedMetalTexture(c, key, o); return mat('#ffffff', { map: t.map, normalMap: t.normalMap, rough: 0.42, metal: 0.55, ...m }); };
  const tt = treadPlateTexture('#7d84a0', 'gv-larmee');
  GM = {
    vx: pm('#5a3a9a', 'gv-vorax', { chip: 0.3, edge: 0.85, rust: 0.15, bare: '#b8bccc' }),
    vx2: pm('#4c3186', 'gv-vorax-2', { chip: 0.35, edge: 0.9, rust: 0.2, bare: '#b0b4c6' }),
    vxD: pm('#2e2742', 'gv-sombre', { chip: 0.25, edge: 0.8, rust: 0.2, bare: '#9aa2b8' }, { rough: 0.4, metal: 0.6 }),
    gold: pm('#f0b830', 'gv-jaune', { chip: 0.2, edge: 0.75, rust: 0.12, bare: '#d8d4c8' }, { rough: 0.38, metal: 0.5 }),
    steel: mat('#8a93ad', { rough: 0.35, metal: 0.85 }),
    tread: mat('#ffffff', { map: tt.map, normalMap: tt.normalMap, rough: 0.38, metal: 0.75 }),
    rubber: mat('#22202a', { rough: 0.85 }),
    // tôle sombre vue des deux côtés (trémie), sans liseré (vue en rasant de l'intérieur)
    vxDs: (() => { const t = paintedMetalTexture('#2e2742', 'gv-sombre', { chip: 0.25, edge: 0.8, rust: 0.2, bare: '#9aa2b8' }); return mat('#ffffff', { map: t.map, normalMap: t.normalMap, rough: 0.4, metal: 0.6, side: THREE.DoubleSide, rim: 0 }); })(),
    hazard: mat('#ffffff', { map: hazardTexture().map, rough: 0.5, metal: 0.3 }),
  };
  return GM;
}
// UV projetées selon la face (mètres × s) : glace, neige
function faceUV(g, s = 0.3) {
  const p = g.attributes.position, n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const [u, v] = ay >= ax && ay >= az ? [p.getX(i), p.getZ(i)] : ax >= az ? [p.getZ(i), p.getY(i)] : [p.getX(i), p.getY(i)];
    uv[i * 2] = u * s; uv[i * 2 + 1] = v * s;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
// Polygone (anneau de points) coupé par un plan : garde le côté sgn·(p − p0)·n ≥ gap (Sutherland-Hodgman)
function clipRing(ring, p0, n, sgn, gap) {
  const d = (p) => sgn * (p.clone().sub(p0).dot(n)) - gap;
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], da = d(a), db = d(b);
    if (da >= 0) out.push(a);
    if (da * db < 0) out.push(a.clone().lerp(b, da / (da - db)));
  }
  return out;
}

// Iceberg au cristal : bloc de glace facetté (anneaux de facettes irréguliers, flancs bombés, dessus chanfreiné) fendu
// de haut en bas — lueur bleue au fond de la fente —, chapeau de neige qui déborde en bourrelets et en langues,
// stalactites sous le rebord, éclats tombés au pied. Encombrement de la collision : 4 × 4 m, dessus à y = 3,2.
function iceberg(L, M3, x, z, yaw, H) {
  const R = rng(661);
  const P = parts();
  const TOP = 3.02;
  // [y, rayon, aléa du rayon, aléa de hauteur, nombre de facettes, exposant du carré arrondi]
  const rings = [[-0.6, 2.05, 0.08, 0, 10, 3.5], [0.5, 2.3, 0.2, 0.35, 9, 3.2], [1.7, 2.25, 0.2, 0.4, 10, 3.4], [2.62, 2.12, 0.1, 0.16, 11, 4.5], [TOP, 1.92, 0.04, 0, 14, 5]];
  const pts = rings.map(([y, r, j, jy, N, ex], k) => Array.from({ length: N }, (_, i) => {
    const a = ((i + (k % 2) * 0.5 + (R() - 0.5) * 0.5) / N) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const q = r / Math.pow(Math.pow(Math.abs(c), ex) + Math.pow(Math.abs(s), ex), 1 / ex) + (R() - 0.5) * 2 * j;
    return new THREE.Vector3(c * q, y + (R() - 0.5) * jy, s * q);
  }));
  // la fente : plan presque vertical, un peu de biais
  // (la fente s'ouvre vers le haut : chaque moitié est coupée par son propre plan)
  const cn = new THREE.Vector3(0.93, 0.12, 0.34).normalize(), c0 = new THREE.Vector3(0.35, 0, -0.1);
  const glowM = glow('#6ad8ff', 2.6);
  for (const sgn of [-1, 1]) {
    const n = cn.clone().addScaledVector(new THREE.Vector3(0, 1, 0), -sgn * 0.035).normalize();
    const half = pts.map((ring) => clipRing(ring, c0, n, sgn, 0.035));
    P.put(M3.ice, faceUV(new ConvexGeometry(half.flat()), 0.28));
    // chapeau de neige : dalle arrondie un peu plus large que le dessus
    const top = half[half.length - 1];
    const cx = top.reduce((s, p) => s + p.x, 0) / top.length, cz = top.reduce((s, p) => s + p.z, 0) / top.length;
    const lip = top.map((p) => new THREE.Vector3(cx + (p.x - cx) * 1.03, TOP, cz + (p.z - cz) * 1.03).addScaledVector(new THREE.Vector3(p.x - cx, 0, p.z - cz).normalize(), 0.05));
    const shape = new THREE.Shape(lip.map((p) => new THREE.Vector2(p.x, -p.z)));
    const cap = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.09, bevelSegments: 2 });
    P.put(M3.snow, faceUV(cap.rotateX(-Math.PI / 2).translate(0, TOP + 0.06, 0), 0.5));
    // bourrelets et langues de neige sur le rebord (pas sur la tranche de la fente), stalactites entre eux
    for (let i = 0; i < lip.length; i++) {
      const a = lip[i], b = lip[(i + 1) % lip.length];
      const ab = b.clone().sub(a), len = ab.length();
      const mid = a.clone().lerp(b, 0.5);
      if (Math.abs(mid.clone().sub(c0).dot(cn)) < 0.35) continue;
      const out = new THREE.Vector3(ab.z, 0, -ab.x).normalize();
      if (out.dot(new THREE.Vector3(mid.x - cx, 0, mid.z - cz)) < 0) out.negate();
      const ang = Math.atan2(ab.x, ab.z);
      for (let t = 0.2 + R() * 0.2; t < 0.9; t += 0.38 / Math.max(len, 0.4) + R() * 0.2) {
        const p = a.clone().lerp(b, t).addScaledVector(out, 0.04 + R() * 0.05);
        P.put(M3.snow, new THREE.SphereGeometry(1, 9, 6).scale(0.12 + R() * 0.07, 0.11 + R() * 0.08, 0.2 + R() * 0.12).rotateY(ang).translate(p.x, TOP + 0.02, p.z));
        const r = R();
        if (r < 0.3) {
          const h = 0.25 + R() * 0.35;
          P.put(M3.snow, new THREE.ConeGeometry(0.09 + R() * 0.05, h, 7).rotateX(Math.PI).translate(p.x, TOP - h / 2 + 0.02, p.z));
        } else if (r < 0.65) {
          const h = 0.18 + R() * 0.3;
          P.put(M3.iceGlow, new THREE.ConeGeometry(0.035 + R() * 0.03, h, 5).rotateX(Math.PI).translate(p.x - out.x * 0.03, TOP - h / 2 - 0.02, p.z - out.z * 0.03));
        }
      }
    }
  }
  // lueur au fond de la fente (en retrait des faces : on ne la voit que par la fente)
  const up = new THREE.Vector3(0, 1.25, 0);
  const sc = c0.clone().add(up).addScaledVector(cn, -up.dot(cn));
  P.put(glowM, new THREE.BoxGeometry(0.07, 3.3, 3.7).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), cn)).translate(sc.x, sc.y, sc.z));
  // éclats tombés au pied
  for (let k = 0; k < 6; k++) {
    const a = k * 1.13 + R() * 0.5, d = 2.6 + R() * 0.7, r = 0.25 + R() * 0.3;
    const lx = Math.cos(a) * d, lz = Math.sin(a) * d;
    const gy = H(x + lx * Math.cos(yaw) + lz * Math.sin(yaw), z - lx * Math.sin(yaw) + lz * Math.cos(yaw));
    const ch = Array.from({ length: 10 }, () => new THREE.Vector3((R() - 0.5) * 2 * r, R() * 1.6 * r, (R() - 0.5) * 2 * r));
    // l'éclat penché lève un côté de sa base (jusqu'à 0,4 r) : on l'enfonce d'autant
    const rz = (R() - 0.5) * 0.8;
    P.put(M3.ice, faceUV(new ConvexGeometry(ch).rotateZ(rz).translate(lx, gy - 0.12 - Math.max(0, r * Math.abs(Math.sin(rz)) - 0.08), lz), 0.28));
  }
  // pan de glace détaché, appuyé contre un flanc
  {
    const lx = -0.6, lz = -2.55;
    const gy = H(x + lx * Math.cos(yaw) + lz * Math.sin(yaw), z - lx * Math.sin(yaw) + lz * Math.cos(yaw));
    const sl = [];
    for (const [a, b] of [[-0.8, 0], [0.75, 0], [-0.65, 1.55], [0.5, 1.75], [-0.1, 2.05]]) for (const t of [-0.22, 0.22]) sl.push(new THREE.Vector3(a + (R() - 0.5) * 0.15, b, t + (R() - 0.5) * 0.08));
    P.put(M3.ice, faceUV(new ConvexGeometry(sl).rotateX(0.22).rotateY(0.15).translate(lx, gy - 0.25, lz), 0.28));
  }
  P.flush(L, new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1)));
}

// Mirador de l'avant-poste (origine au sol, au centre) : quatre pieds en tube carré sur semelles boulonnées, ceintures
// et croix de Saint-André sur les quatre faces, plancher de tôle larmée sur cadre en U riveté et solives, plinthes à
// bande de danger, garde-corps jaune, échelle à crinoline (côté -z), gyrophare rose dans sa cage, mât du projecteur.
// Collision (posée à part) : pieds de 0,3 m à ±1,5 m, plancher 3,8 × 3,8 m de 5,1 à 5,5 m.
function mirador(L, M3, TW, H) {
  const gm = gvMats(), P = parts();
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const gy = (x, z) => H(TW.x + x, TW.z + z) - TW.y;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = sx * 1.5, z = sz * 1.5, g = gy(x, z);
    // le pied monte jusque sous la tôle larmée (5,44) : il porte le plancher
    P.put(gm.vxD, rboxAt(0.3, 5.74 - g, 0.3, 0.03, x, (5.44 + g - 0.3) / 2, z));
    P.put(gm.vxD, rboxAt(0.66, 0.1, 0.66, 0.025, x, g + 0.02, z));
    for (const [bx_, bz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P.put(gm.steel, new THREE.CylinderGeometry(0.035, 0.035, 0.07, 6).translate(x + bx_ * 0.23, g + 0.09, z + bz * 0.23));
  }
  // ceintures, croix de Saint-André (trois travées), plaques de serrage aux croisements
  const ys = [0.45, 1.9, 3.5, 5.0];
  for (const [ax, az, bx2, bz, nx, nz] of [[-1.5, -1.5, 1.5, -1.5, 0, -1], [-1.5, 1.5, 1.5, 1.5, 0, 1], [-1.5, -1.5, -1.5, 1.5, -1, 0], [1.5, -1.5, 1.5, 1.5, 1, 0]]) {
    const alongX = az === bz;
    for (const y of [1.9, 3.5]) {
      P.put(gm.vx, alongX ? rboxAt(2.72, 0.16, 0.12, 0.03, 0, y, az) : rboxAt(0.12, 0.16, 2.72, 0.03, ax, y, 0));
      const pts = alongX ? [[-1.25, y, az + nz * 0.061], [1.25, y, az + nz * 0.061]] : [[ax + nx * 0.061, y, -1.25], [ax + nx * 0.061, y, 1.25]];
      riv(P, gm.steel, pts, [nx, 0, nz], 0.022);
    }
    const ux = (bx2 - ax) / 3, uz = (bz - az) / 3;
    for (let k = 0; k < 3; k++) {
      const y0 = ys[k] + 0.12, y1 = ys[k + 1] - 0.12;
      const a = V3(ax + ux * 0.05, y0, az + uz * 0.05), b = V3(bx2 - ux * 0.05, y1, bz - uz * 0.05);
      const c = V3(ax + ux * 0.05, y1, az + uz * 0.05), d = V3(bx2 - ux * 0.05, y0, bz - uz * 0.05);
      P.put(gm.vx, beam(a, b, 0.038));
      P.put(gm.vx, beam(c, d, 0.038));
      const m = a.clone().lerp(b, 0.5);
      P.put(gm.vxD, alongX ? rboxAt(0.18, 0.18, 0.05, 0.015, m.x, m.y, m.z + nz * 0.02) : rboxAt(0.05, 0.18, 0.18, 0.015, m.x + nx * 0.02, m.y, m.z));
      riv(P, gm.steel, [[m.x + nx * 0.05, m.y, m.z + nz * 0.05]], [nx, 0, nz], 0.03);
    }
  }
  // plancher : cadre en U riveté, solives, tôle larmée (UV en mètres × 2)
  for (const s of [-1, 1]) {
    P.put(gm.vx, rboxAt(3.8, 0.34, 0.14, 0.03, 0, 5.3, s * 1.83));
    P.put(gm.vx, rboxAt(0.14, 0.34, 3.52, 0.03, s * 1.83, 5.3, 0));
    const pz = [], px = [];
    for (let t = -1.7; t <= 1.71; t += 0.34) { pz.push([t, 5.3, s * 1.901]); px.push([s * 1.901, 5.3, t]); }
    riv(P, gm.steel, pz, [0, 0, s], 0.02);
    riv(P, gm.steel, px, [s, 0, 0], 0.02);
  }
  for (const z of [-0.9, 0, 0.9]) P.put(gm.vxD, rboxAt(3.52, 0.22, 0.12, 0.02, 0, 5.2, z));
  P.put(gm.tread, bxm(3.62, 0.06, 3.62, 0, 5.47, 0, 2));
  // plinthes à bande de danger (ouverture de l'échelle côté -z, entre x = 0,2 et 1)
  P.put(gm.hazard, bxm(3.8, 0.18, 0.04, 0, 5.59, 1.88, 0.6));
  P.put(gm.hazard, bxm(2.1, 0.18, 0.04, -0.85, 5.59, -1.88, 0.6));
  P.put(gm.hazard, bxm(0.9, 0.18, 0.04, 1.45, 5.59, -1.88, 0.6));
  for (const s of [-1, 1]) P.put(gm.hazard, bxm(0.04, 0.18, 3.72, s * 1.88, 5.59, 0, 0.6));
  // garde-corps : montants, lisses haute et intermédiaire
  const C = 1.84;
  const posts = [[-C, -C], [C, -C], [-C, C], [C, C], [0, C], [-C, 0], [C, 0], [0.2, -C], [1.0, -C], [-0.9, -C]];
  for (const [x, z] of posts) P.put(gm.gold, rboxAt(0.07, 1.06, 0.07, 0.015, x, 6.03, z));
  for (const [a, b] of [[[-C, C], [C, C]], [[-C, -C], [-C, C]], [[C, -C], [C, C]], [[-C, -C], [0.2, -C]], [[1.0, -C], [C, -C]]]) {
    for (const y of [6.52, 6.03]) P.put(gm.gold, beam(V3(a[0], y, a[1]), V3(b[0], y, b[1]), 0.032));
  }
  // échelle à crinoline : montants, barreaux, pattes d'écartement, arceaux et filants
  const LZ = -2.15, ly = Math.min(gy(0.3, LZ), gy(0.9, LZ)) - 0.1;
  for (const x of [0.3, 0.9]) {
    P.put(gm.vxD, rboxAt(0.06, 6.55 - ly, 0.09, 0.015, x, (6.55 + ly) / 2, LZ));
    for (const [y, z1] of [[5.3, -1.9], [3.5, -1.56], [1.9, -1.56]]) P.put(gm.vxD, beam(V3(x, y, LZ + 0.04), V3(x, y, z1), 0.025));
  }
  for (let y = ly + 0.35; y < 5.5; y += 0.3) P.put(gm.steel, new THREE.CylinderGeometry(0.022, 0.022, 0.6, 6).rotateZ(Math.PI / 2).translate(0.6, y, LZ));
  for (let y = 2.6; y < 6; y += 0.8) {
    P.put(gm.gold, new THREE.TorusGeometry(0.42, 0.022, 4, 14, Math.PI).rotateX(-Math.PI / 2).translate(0.6, y, LZ));
    // pattes : chaque arceau est boulonné au flanc des montants
    for (const s of [-1, 1]) P.put(gm.gold, beam(V3(0.6 + s * 0.43, y, LZ), V3(0.6 + s * 0.31, y, LZ), 0.02, 0.02, 4));
  }
  for (const a of [0.55, Math.PI / 2, Math.PI - 0.55]) P.put(gm.gold, beam(V3(0.6 + Math.cos(a) * 0.42, 2.6, LZ - Math.sin(a) * 0.42), V3(0.6 + Math.cos(a) * 0.42, 5.8, LZ - Math.sin(a) * 0.42), 0.018, 0.018, 4));
  // gyrophare rose sur son socle (verre, bague, cage, chapeau)
  P.put(gm.vxD, rboxAt(0.42, 0.4, 0.42, 0.04, 1.6, 5.7, 1.6));
  P.put(gm.steel, new THREE.CylinderGeometry(0.27, 0.29, 0.06, 14).translate(1.6, 5.93, 1.6));
  P.put(M3.pinkGlow, new THREE.CylinderGeometry(0.25, 0.25, 0.3, 12).translate(1.6, 6.1, 1.6));
  for (const y of [6.0, 6.2]) P.put(gm.steel, new THREE.TorusGeometry(0.28, 0.018, 4, 16).rotateX(Math.PI / 2).translate(1.6, y, 1.6));
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.4; P.put(gm.steel, new THREE.CylinderGeometry(0.016, 0.016, 0.34, 4).translate(1.6 + Math.cos(a) * 0.28, 6.1, 1.6 + Math.sin(a) * 0.28)); }
  P.put(gm.vxD, new THREE.CylinderGeometry(0.12, 0.3, 0.1, 14).translate(1.6, 6.3, 1.6));
  // mât du projecteur et boîtier électrique sur un pied
  // (le fût s'arrête dans la tige de la lyre du projecteur, posé à 6,25 : il ne traverse plus sa traverse)
  P.put(gm.vxD, new THREE.CylinderGeometry(0.06, 0.075, 0.2, 8).translate(-1.4, 5.59, -1.4));
  P.put(gm.vxD, rboxAt(0.26, 0.06, 0.26, 0.02, -1.4, 5.52, -1.4));
  P.put(gm.gold, rboxAt(0.32, 0.42, 0.16, 0.03, 1.5, 1.3, -1.74));
  P.put(gm.vxD, beam(V3(1.5, 1.08, -1.74), V3(1.5, gy(1.5, -1.74), -1.74), 0.025));
  P.flush(L, new THREE.Matrix4().makeTranslation(TW.x, TW.y, TW.z));
  // collisions : garde-corps (ouvert au droit de l'échelle), échelle et crinoline (dessus au niveau du plancher :
  // on passe de l'une à l'autre), gyrophare, mât du projecteur. Les croix de Saint-André restent traversables : la
  // Lunette de la seconde vague apparaît entre les pieds et doit rester à portée de tir.
  const W = (x, y, z) => V3(TW.x + x, TW.y + y, TW.z + z);
  L.box(W(0, 6.03, C), V3(3.78, 1.06, 0.1), null, { surface: 'metal' });
  for (const s of [-1, 1]) L.box(W(s * C, 6.03, 0), V3(0.1, 1.06, 3.78), null, { surface: 'metal' });
  L.box(W(-0.84, 6.03, -C), V3(2.08, 1.06, 0.1), null, { surface: 'metal' });
  L.box(W(1.42, 6.03, -C), V3(0.84, 1.06, 0.1), null, { surface: 'metal' });
  L.box(W(0.6, (5.5 + ly) / 2, -2.35), V3(0.9, 5.5 - ly, 0.54), null, { surface: 'metal' });
  L.game.world.add(new CylinderCollider(TW.x + 1.6, TW.z + 1.6, TW.y + 5.5, TW.y + 6.35, 0.3, { surface: 'metal' }));
  L.game.world.add(new CylinderCollider(TW.x - 1.4, TW.z - 1.4, TW.y + 5.5, TW.y + 6.5, 0.12, { surface: 'metal' }));
}

// Barricade de l'avant-poste (mur de x0 à x1, plan z = BZ, collision 7,4 × 1,2 m de y = -0,5 à 6,9 posée à part) :
// modules de trois plaques de tôle peinte entre des poteaux rivetés, couvre-joints rivetés aux jointures, socle,
// lisse haute à bande de danger, crénelage (merlons à chapeau d'acier, neige dessus), contreforts triangulaires côté
// mine, stalactites sous la lisse et congères au pied côté avant-poste
function barricade(L, M3, x0, x1, BZ, H, seed) {
  const gm = gvMats(), P = parts(), R = rng(seed);
  const len = x1 - x0, n = Math.round(len / 2.6), pw = len / n, yb = -0.6, ph = (5.6 - yb) / 3;
  for (let i = 0; i < n; i++) {
    const cx = x0 + pw * (i + 0.5), g = H(cx, BZ - 0.8);
    // (la plaque du haut monte jusque sous la lisse, à 5,62 : plus de fente entre les deux)
    for (let r = 0; r < 3; r++) P.put(R() < 0.5 ? gm.vx : gm.vx2, rboxAt(pw - 0.3, ph - (r === 2 ? 0 : 0.04), 0.72, 0.035, cx, yb + ph * (r + 0.5) + (r === 2 ? 0.02 : 0), BZ));
    for (let r = 1; r < 3; r++) {
      const y = yb + ph * r;
      for (const s of [-1, 1]) {
        P.put(gm.vxD, rboxAt(pw - 0.3, 0.16, 0.06, 0.02, cx, y, BZ + s * 0.38));
        const pts = [];
        for (let x = cx - pw / 2 + 0.4; x < cx + pw / 2 - 0.3; x += 0.42) pts.push([x, y, BZ + s * 0.411]);
        riv(P, gm.steel, pts, [0, 0, s], 0.024);
      }
    }
    // socle, lisse haute à bande de danger et son chapeau
    P.put(gm.vxD, rboxAt(pw, 0.55, 1.5, 0.05, cx, Math.min(g, H(cx, BZ + 0.8)) - 0.1, BZ));
    P.put(gm.hazard, bxm(pw, 0.36, 1.0, cx, 5.8, BZ, 0.6));
    P.put(gm.vxD, rboxAt(pw, 0.08, 1.12, 0.02, cx, 6.02, BZ));
    // stalactites sous la lisse (côté avant-poste)
    for (let k = 0; k < 3; k++) {
      const h = 0.2 + R() * 0.45;
      P.put(M3.ice, new THREE.ConeGeometry(0.04 + R() * 0.04, h, 5).rotateX(Math.PI).translate(cx + (R() - 0.5) * pw * 0.9, 5.62 - h / 2, BZ - 0.48));
    }
    // contreforts triangulaires côté mine (un poteau sur deux), semelle boulonnée, lisse d'arête
    if (i % 2 === 0) {
      const px = x0 + pw * i + (i === 0 ? 0.4 : 0), gz = H(px, BZ + 1.6);
      const tri = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(1.9, 0), new THREE.Vector2(0, 4.4 - gz)]);
      P.put(gm.vxD, new THREE.ExtrudeGeometry(tri, { depth: 0.2, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(px + 0.1, gz - 0.1, BZ + 0.55));
      P.put(gm.vx, beam(new THREE.Vector3(px, gz - 0.05, BZ + 0.55 + 1.9), new THREE.Vector3(px, 4.3, BZ + 0.55), 0.07, 0.07, 6));
      P.put(gm.vxD, rboxAt(0.5, 0.1, 2.1, 0.02, px, gz - 0.07, BZ + 1.5));
      riv(P, gm.steel, [[px - 0.17, gz - 0.02, BZ + 0.8], [px + 0.17, gz - 0.02, BZ + 0.8], [px - 0.17, gz - 0.02, BZ + 2.3], [px + 0.17, gz - 0.02, BZ + 2.3]], [0, 1, 0], 0.035);
      // collision : deux gradins inscrits dans le triangle (une dalle inclinée se gravit en poussant ; dessus du
      // gradin haut à mi-hauteur : un double saut n'y porte pas jusqu'au haut de la barricade)
      const b0 = gz - 0.1, ht = 4.3 - b0;
      L.box(V(px, b0 + ht * 0.25, BZ + 0.55 + 0.475), V(0.28, ht * 0.5, 0.95), null, { surface: 'metal' });
      L.box(V(px, b0 + ht * 0.079, BZ + 0.55 + 1.275), V(0.28, ht * 0.158, 0.65), null, { surface: 'metal' });
    }
  }
  // poteaux rivetés entre les modules
  for (let i = 0; i <= n; i++) {
    const x = Math.min(x1 - 0.17, Math.max(x0 + 0.17, x0 + pw * i));
    P.put(gm.vxD, rboxAt(0.34, 6.6, 1.1, 0.04, x, yb + 3.3, BZ));
    for (const s of [-1, 1]) {
      const pts = [];
      for (let y = 0.3; y < 5.6; y += 0.6) pts.push([x, y, BZ + s * 0.551]);
      riv(P, gm.steel, pts, [0, 0, s], 0.03);
    }
  }
  // crénelage : merlons de tôle à chapeau d'acier (dessus = collision), neige sur la plupart
  const pitch = 1.45, nm = Math.floor((len - 0.4) / pitch);
  const m0 = x0 + (len - (nm - 1) * pitch) / 2;
  for (let k = 0; k < nm; k++) {
    const x = m0 + k * pitch;
    P.put(gm.vx, rboxAt(0.9, 0.8, 0.96, 0.05, x, 6.45, BZ));
    P.put(gm.steel, rboxAt(0.98, 0.06, 1.04, 0.02, x, 6.87, BZ));
    riv(P, gm.steel, [[x - 0.3, 6.45, BZ - 0.481], [x + 0.3, 6.45, BZ - 0.481]], [0, 0, -1], 0.028);
    riv(P, gm.steel, [[x - 0.3, 6.45, BZ + 0.481], [x + 0.3, 6.45, BZ + 0.481]], [0, 0, 1], 0.028);
    if (R() < 0.7) P.put(M3.snow, new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.46, 0.09 + R() * 0.06, 0.5).translate(x + (R() - 0.5) * 0.08, 6.9, BZ));
    if (k < nm - 1 && R() < 0.5) P.put(M3.snow, new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.3, 0.12, 0.45).translate(x + pitch / 2, 6.06, BZ));
  }
  P.flush(L, null);
  // congères au pied, côté avant-poste
  // (celles des bouts, qui montaient sur la falaise, sont ramenées au pied de la paroi)
  for (let x = x0 + 2 + R() * 2; x < x1 - 1.5; x += 3.5 + R() * 3) {
    const sz = 0.7 + R() * 0.4, sd = Math.floor(R() * 99), xs = seatDrift(H, x, BZ - 0.9, sz, 0.15);
    if (xs !== null) snowDrift(L, V(xs, H(xs, BZ - 0.9) - 0.15, BZ - 0.9), sz, sd, { collide: false });
  }
}
// Pilier du portail de la barricade (collision 1,2 × 8,2 × 1,8 m posée à part) : âme de tôle sombre, cornières d'acier,
// ceintures violettes, colonnes de rivets, bande de danger au pied, chapeau et feu rose
function gatePost(L, M3, x, BZ) {
  const gm = gvMats(), P = parts();
  P.put(gm.vxD, rboxAt(1.0, 8.0, 1.6, 0.06, x, 3.5, BZ));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.put(gm.steel, rboxAt(0.13, 8.05, 0.13, 0.02, x + sx * 0.5, 3.5, BZ + sz * 0.8));
  for (const y of [2.6, 5.2]) P.put(gm.vx, rboxAt(1.08, 0.22, 1.68, 0.03, x, y, BZ));
  P.put(gm.hazard, bxm(1.05, 0.7, 1.65, x, 0.4, BZ, 0.8));
  for (const sz of [-1, 1]) {
    const pts = [];
    for (let y = 0.95; y < 7.3; y += 0.5) if (Math.abs(y - 2.6) > 0.2 && Math.abs(y - 5.2) > 0.2) pts.push([x - 0.28, y, BZ + sz * 0.801], [x + 0.28, y, BZ + sz * 0.801]);
    riv(P, gm.steel, pts, [0, 0, sz], 0.03);
  }
  P.put(gm.vx, rboxAt(1.3, 0.24, 1.9, 0.05, x, 7.6, BZ));
  P.put(gm.vxD, new THREE.CylinderGeometry(0.2, 0.24, 0.12, 12).translate(x, 7.78, BZ));
  P.put(M3.pinkGlow, new THREE.CylinderGeometry(0.15, 0.15, 0.2, 12).translate(x, 7.94, BZ));
  P.put(gm.vxD, new THREE.CylinderGeometry(0.06, 0.2, 0.08, 12).translate(x, 8.08, BZ));
  P.flush(L, null);
}

// Pilier de la piste de glisse (tronçon de a à b, largeur w) : fût de glace à sept pans, vrillé et bosselé, qui plonge
// dans la brume du gouffre ; colliers d'acier rivetés à stalactites, sommier d'acier boulonné sous la piste (suit sa
// pente), jambes de force jusqu'au fût. Décor seul (pas de collision, comme avant).
function slidePier(L, M3, a, b, w, seed) {
  const gm = gvMats(), P = parts(), R = rng(seed);
  const m = a.clone().lerp(b, 0.5);
  const len = a.distanceTo(b), yaw = Math.atan2(b.x - a.x, b.z - a.z), pitch = Math.asin((b.y - a.y) / len);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, yaw, 0, 'YXZ'));
  const top = m.y - 0.5, bot = -62, h = top - bot, r0 = 0.88, r1 = 0.58;
  const rad = (y) => r0 + (r1 - r0) * (y - bot) / h;
  const col = new THREE.CylinderGeometry(r1, r0, h, 7, Math.ceil(h / 2.6));
  const p = col.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), ring = Math.round((y + h / 2) / (h / Math.ceil(h / 2.6)));
    const k = ((Math.round(Math.atan2(p.getZ(i), p.getX(i)) / (Math.PI * 2 / 7)) % 7) + 7) % 7;
    const hs = Math.sin(ring * 12.9898 + k * 78.233 + seed) * 43758.5453;
    const f = 1 + ((hs - Math.floor(hs)) - 0.5) * 0.22, tw = (y + h / 2) * 0.035;
    const x = p.getX(i) * f, z = p.getZ(i) * f;
    p.setXYZ(i, x * Math.cos(tw) - z * Math.sin(tw), y, x * Math.sin(tw) + z * Math.cos(tw));
  }
  const cg = col.toNonIndexed();
  cg.computeVertexNormals();
  P.put(M3.ice, faceUV(cg.translate(m.x, (top + bot) / 2, m.z), 0.28));
  // colliers rivetés, stalactites dessous
  for (let y = top - 1.6; y > -46; y -= 6.5 + R() * 2) {
    const r = rad(y) * 1.12 + 0.08;
    P.put(gm.vxD, new THREE.CylinderGeometry(r, r, 0.3, 14).translate(m.x, y, m.z));
    P.put(gm.vxD, new THREE.CylinderGeometry(r + 0.03, r + 0.03, 0.06, 14).translate(m.x, y + 0.12, m.z));
    const pts = [], nn = [];
    // rivets posés sur les pans du collier à 14 pans (et non sur le cercle circonscrit : ils flottaient de 2 cm)
    for (let k = 0; k < 9; k++) {
      const t = (k / 9) * Math.PI * 2, th = Math.atan2(Math.cos(t), Math.sin(t)), st = Math.PI * 2 / 14;
      const rp = r * Math.cos(st / 2) / Math.cos(((th % st) + st) % st - st / 2);
      pts.push([m.x + Math.cos(t) * rp, y - 0.03, m.z + Math.sin(t) * rp]); nn.push([Math.cos(t), 0, Math.sin(t)]);
    }
    pts.forEach((pt, k) => riv(P, gm.steel, [pt], nn[k], 0.028));
    for (let k = 0; k < 4; k++) {
      const t = R() * Math.PI * 2, hh = 0.25 + R() * 0.6;
      P.put(M3.ice, new THREE.ConeGeometry(0.05 + R() * 0.04, hh, 5).rotateX(Math.PI).translate(m.x + Math.cos(t) * (r - 0.02), y - 0.15 - hh / 2, m.z + Math.sin(t) * (r - 0.02)));
    }
  }
  // sommier sous la piste (repère de la piste), platine sur le fût, jambes de force
  const S = (x, y, z) => new THREE.Vector3(x, y, z).applyQuaternion(q).add(m);
  const sm = new THREE.Matrix4().compose(new THREE.Vector3(), q, new THREE.Vector3(1, 1, 1));
  const put = (mt, g) => { g.applyMatrix4(sm).translate(m.x, m.y, m.z); P.put(mt, g); };
  put(gm.vxD, rboxAt(w + 0.5, 0.3, 0.7, 0.04, 0, -0.42, 0));
  put(gm.vx, rboxAt(w + 0.56, 0.06, 0.76, 0.02, 0, -0.27, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const g = new THREE.CylinderGeometry(0.045, 0.045, 0.12, 6).rotateX(Math.PI / 2).translate(sx * (w / 2 - 0.1 + 0.25), -0.42, sz * 0.36);
    put(gm.steel, g);
  }
  P.put(gm.vxD, new THREE.CylinderGeometry(rad(top) * 1.1 + 0.1, rad(top) * 1.1 + 0.1, 0.16, 14).translate(m.x, top - 0.02, m.z));
  for (const sx of [-1, 1]) P.put(gm.vx, beam(new THREE.Vector3(m.x, top - 2.4, m.z).add(new THREE.Vector3(sx * 0.5, 0, 0).applyQuaternion(q)), S(sx * w * 0.36, -0.55, 0), 0.07, 0.07, 6));
  P.flush(L, null);
}

// Bande transporteuse crantée : caoutchouc sombre moucheté, chevrons en relief usés sur le dessus, rives renforcées,
// traînées claires laissées par le minerai. 1 tuile = 1 chevron (u le long de la bande, raccordable), v en travers.
let beltT = null;
function beltTexture() {
  if (beltT) return beltT;
  const S = 256, hgt = new Float32Array(S * S);
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return c; };
  const cm = mk(), cn = mk(), ctx = cm.getContext('2d'), img = ctx.createImageData(S, S);
  const sst = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = y * S + x;
    const n = fbm2(u * 8, v * 8, 3, 503, 8), sp = fbm2(u * 64, v * 64, 2, 509, 64);
    const d = Math.abs(u - (0.62 - Math.abs(v - 0.5) * 0.5));
    const cleat = (1 - sst(0.035, 0.06, d)) * sst(0.06, 0.1, v) * sst(0.94, 0.9, v);
    const rim = Math.max(sst(0.05, 0.02, v), sst(0.95, 0.98, v));
    const streak = sst(0.55, 0.75, fbm2(u * 2, v * 14, 3, 521, 2)) * sst(0.12, 0.25, v) * sst(0.88, 0.75, v);
    let k = 0.16 + n * 0.06 + (sp > 0.62 ? 0.03 : 0) + streak * 0.07;
    k += cleat * (0.1 + n * 0.12) + rim * 0.05;
    hgt[i] = cleat * 0.9 + rim * 0.4 + n * 0.08;
    img.data[i * 4] = k * 255 * 1.02; img.data[i * 4 + 1] = k * 255 * 0.98; img.data[i * 4 + 2] = k * 255 * 1.12; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const nctx = cn.getContext('2d'), nimg = nctx.createImageData(S, S);
  const Hh = (x, y) => hgt[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (Hh(x + 1, y) - Hh(x - 1, y)) * 4, dy = (Hh(x, y + 1) - Hh(x, y - 1)) * 4, l = Math.hypot(dx, dy, 1), i = (y * S + x) * 4;
    nimg.data[i] = (-dx / l * 0.5 + 0.5) * 255; nimg.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; nimg.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; nimg.data[i + 3] = 255;
  }
  nctx.putImageData(nimg, 0, 0);
  const tex = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    return t;
  };
  beltT = { map: tex(cm, true), normalMap: tex(cn, false) };
  return beltT;
}

// Châssis du tapis de minerai (bande de x = -14 à 16, dessus à beltY + 0,7) : longerons en U rivetés, paliers de
// rouleaux boulonnés, tambour de queue dans ses paliers jaunes à tiges de tension, pieds sur semelles, bande de danger
// en bout. Broyeur (5 × 5 × 4,4 m, centré en x = 18,5) : caisson de tôle peinte à couvre-joints rivetés, poteaux
// d'angle, étage supérieur ceinturé d'une bande de danger, trémie évasée à rebord et raidisseurs, gueule à lèvres de
// caoutchouc sous un linteau, hublot rose cerclé et grillagé, moteur à ailettes sur berceau, carter, cheminée.
function oreConveyor(L, M3, beltY, H) {
  const gm = gvMats(), P = parts();
  const Z = 372, Y = (y) => beltY + y;
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  for (const s of [-1, 1]) {
    const z = Z + s * 1.36;
    P.put(gm.vx, rboxAt(30.6, 0.42, 0.12, 0.03, 0.7, Y(0.42), z));
    P.put(gm.vxD, rboxAt(30.6, 0.05, 0.22, 0.01, 0.7, Y(0.645), Z + s * 1.33));
    P.put(gm.vxD, rboxAt(30.6, 0.05, 0.22, 0.01, 0.7, Y(0.2), Z + s * 1.33));
    for (let x = -13.4; x < 15.6; x += 1.2) {
      P.put(gm.vxD, new THREE.CylinderGeometry(0.075, 0.075, 0.05, 8).rotateX(Math.PI / 2).translate(x, Y(0.44), z + s * 0.085));
      P.put(gm.steel, new THREE.CylinderGeometry(0.035, 0.035, 0.05, 6).rotateX(Math.PI / 2).translate(x, Y(0.44), z + s * 0.12));
    }
    const pts = [];
    for (let x = -13.6; x < 15.8; x += 0.6) pts.push([x + 0.3, Y(0.3), z + s * 0.061], [x + 0.3, Y(0.56), z + s * 0.061]);
    riv(P, gm.steel, pts, [0, 0, s], 0.02);
    // pieds sur semelles
    for (let x = -12.5; x < 15; x += 3) {
      const g = H(x, z);
      if (Y(0.21) - g < 0.08) continue;
      P.put(gm.vxD, rboxAt(0.14, Y(0.25) - g + 0.1, 0.14, 0.02, x, (Y(0.25) + g - 0.1) / 2, z));
      P.put(gm.vxD, rboxAt(0.36, 0.06, 0.36, 0.015, x, g + 0.01, z));
    }
    // palier du tambour de queue, tiges de tension
    P.put(gm.gold, rboxAt(0.42, 0.34, 0.18, 0.04, -14.1, Y(0.4), Z + s * 1.52));
    riv(P, gm.steel, [[-14.25, Y(0.52), Z + s * 1.611], [-13.95, Y(0.52), Z + s * 1.611], [-14.25, Y(0.28), Z + s * 1.611], [-13.95, Y(0.28), Z + s * 1.611]], [0, 0, s], 0.025);
    P.put(gm.steel, new THREE.CylinderGeometry(0.025, 0.025, 0.9, 6).rotateZ(Math.PI / 2).translate(-13.5, Y(0.4), Z + s * 1.52));
    P.put(gm.steel, new THREE.CylinderGeometry(0.05, 0.05, 0.05, 6).rotateZ(Math.PI / 2).translate(-13.05, Y(0.4), Z + s * 1.52));
  }
  P.put(gm.vxD, new THREE.CylinderGeometry(0.33, 0.33, 2.62, 18).rotateX(Math.PI / 2).translate(-14.05, Y(0.37), Z));
  P.put(gm.steel, new THREE.CylinderGeometry(0.08, 0.08, 3.3, 8).rotateX(Math.PI / 2).translate(-14.05, Y(0.37), Z));
  P.put(gm.hazard, bxm(0.06, 0.42, 0.12, -14.6, Y(0.42), Z - 1.36, 0.8));
  P.put(gm.hazard, bxm(0.06, 0.42, 0.12, -14.6, Y(0.42), Z + 1.36, 0.8));
  // --- broyeur
  const CX = 18.5;
  // caisson et poteaux d'angle descendus de 0,35 m : le terrain s'abaisse de 20 cm vers l'angle (16,15 ; 374,35)
  P.put(gm.vx, rboxAt(4.7, 3.65, 4.7, 0.06, CX, Y(1.475), Z));
  P.put(gm.vx2, rboxAt(4.5, 1.05, 4.5, 0.05, CX, Y(3.85), Z));
  P.put(gm.vxD, rboxAt(4.9, 0.1, 4.9, 0.03, CX, Y(4.35), Z));
  P.put(gm.vxD, rboxAt(4.82, 0.12, 4.82, 0.03, CX, Y(3.32), Z));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.put(gm.vxD, rboxAt(0.34, 4.75, 0.34, 0.04, CX + sx * 2.33, Y(2.025), Z + sz * 2.33));
  // couvre-joints et rivets sur les quatre faces (pas sur la gueule) ; bande de danger de l'étage
  for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    // point de la face : t le long de la face, o en avant de la face
    const F = (t, y, o = 0) => [CX + nx * (2.35 + o) + (nz ? t : 0), Y(y), Z + nz * (2.35 + o) + (nx ? t : 0)];
    for (const y of [1.15, 2.25]) {
      if (nx === -1 && y < 2) continue;
      const c = F(0, y, 0.02);
      P.put(gm.vxD, nx ? rboxAt(0.06, 0.16, 4.3, 0.02, c[0], c[1], c[2]) : rboxAt(4.3, 0.16, 0.06, 0.02, c[0], c[1], c[2]));
      const pts = [];
      for (let t = -1.9; t <= 1.91; t += 0.38) pts.push(F(t, y, 0.055));
      riv(P, gm.steel, pts, [nx, 0, nz], 0.024);
    }
    if (nx !== -1) {
      const c = F(0, 1.65, 0.02);
      P.put(gm.vxD, nx ? rboxAt(0.06, 3.0, 0.16, 0.02, c[0], c[1], c[2]) : rboxAt(0.16, 3.0, 0.06, 0.02, c[0], c[1], c[2]));
    }
    const hb = F(0, 3.55, 0.03);
    P.put(gm.hazard, nx ? bxm(0.04, 0.32, 4.5, hb[0], hb[1], hb[2], 0.6) : bxm(4.5, 0.32, 0.04, hb[0], hb[1], hb[2], 0.6));
  }
  // trémie évasée : parois (double face), raidisseurs d'angle, rebord à bande de danger, grille au fond
  P.put(gm.vxDs, new THREE.CylinderGeometry(2.55, 1.5, 1.5, 4, 1, true).rotateY(Math.PI / 4).translate(CX, Y(5.15), Z));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.put(gm.vxD, beam(V3(CX + sx * 1.06, Y(4.4), Z + sz * 1.06), V3(CX + sx * 1.82, Y(5.92), Z + sz * 1.82), 0.06));
  for (const s of [-1, 1]) {
    P.put(gm.hazard, bxm(3.76, 0.2, 0.08, CX, Y(5.95), Z + s * 1.84, 0.6));
    P.put(gm.hazard, bxm(0.08, 0.2, 3.76, CX + s * 1.84, Y(5.95), Z, 0.6));
  }
  P.put(gm.rubber, bx(2.1, 0.05, 2.1, CX, Y(4.42), Z));
  for (let t = -0.8; t <= 0.81; t += 0.4) P.put(gm.steel, bx(0.05, 0.06, 2.1, CX + t, Y(4.46), Z));
  // gueule : joues, linteau à bande de danger, fond sombre, lèvres de caoutchouc
  for (const s of [-1, 1]) P.put(gm.vxD, rboxAt(0.34, 2.05, 0.3, 0.04, 15.95, Y(0.675), Z + s * 1.55));
  P.put(gm.vxD, rboxAt(0.42, 0.42, 3.4, 0.04, 15.95, Y(1.82), Z));
  P.put(gm.hazard, bxm(0.04, 0.3, 3.3, 15.73, Y(1.82), Z, 0.6));
  P.put(gm.rubber, bx(0.05, 1.2, 2.9, 16.04, Y(1.1), Z));
  for (let k = 0; k < 9; k++) P.put(gm.rubber, rboxAt(0.03, 0.86, 0.29, 0.01, 0, -0.43, 0).rotateZ(0.06 + (k % 3) * 0.03).translate(15.86, Y(1.6), Z - 1.28 + k * 0.32));
  // hublot rose : bague rivetée et grille
  P.put(gm.steel, new THREE.TorusGeometry(0.96, 0.08, 6, 24).rotateY(Math.PI / 2).translate(15.82, Y(2.4), Z));
  for (let k = 0; k < 10; k++) { const t = (k / 10) * Math.PI * 2; riv(P, gm.steel, [[15.76, Y(2.4) + Math.sin(t) * 0.96, Z + Math.cos(t) * 0.96]], [-1, 0, 0], 0.03); }
  for (const t of [-0.45, 0, 0.45]) P.put(gm.vxD, bx(0.04, 0.05, 1.85, 15.76, Y(2.4) + t, Z));
  // fourreau du hublot : la bague et la vitre étaient à 25 cm en avant de la tôle, sans rien pour les tenir
  P.put(gm.vxD, new THREE.CylinderGeometry(0.97, 0.97, 0.3, 24).rotateZ(Math.PI / 2).translate(16.01, Y(2.4), Z));
  // moteur à ailettes sur berceau, carter de transmission, cheminée, mât du projecteur
  P.put(gm.vxD, rboxAt(1.5, 0.32, 0.8, 0.04, 17.9, Y(0.45), Z + 2.95));
  P.put(gm.gold, new THREE.CylinderGeometry(0.42, 0.42, 1.3, 16).rotateZ(Math.PI / 2).translate(17.9, Y(1.03), Z + 2.95));
  for (let k = 0; k < 6; k++) P.put(gm.vxD, new THREE.CylinderGeometry(0.47, 0.47, 0.04, 16).rotateZ(Math.PI / 2).translate(17.4 + k * 0.2, Y(1.03), Z + 2.95));
  // le berceau flottait à 0,5 m du sol : deux pieds en tôle sur semelles boulonnées
  for (const x of [17.4, 18.4]) {
    const g = Math.min(H(x, Z + 2.65), H(x, Z + 3.25));
    P.put(gm.vxD, rboxAt(0.16, Y(0.32) - g + 0.1, 0.64, 0.02, x, (Y(0.32) + g - 0.1) / 2, Z + 2.95));
    P.put(gm.vxD, rboxAt(0.4, 0.06, 0.84, 0.015, x, g + 0.01, Z + 2.95));
    riv(P, gm.steel, [[x - 0.13, g + 0.04, Z + 2.65], [x + 0.13, g + 0.04, Z + 2.65], [x - 0.13, g + 0.04, Z + 3.25], [x + 0.13, g + 0.04, Z + 3.25]], [0, 1, 0], 0.03);
  }
  P.put(gm.vxD, new THREE.CylinderGeometry(0.3, 0.36, 0.12, 14).rotateZ(Math.PI / 2).translate(17.2, Y(1.03), Z + 2.95));
  // carter : il descend jusqu'au sol (il flottait à 0,6 m), accouplement au moteur, arbre jusqu'au caisson
  const gc = Math.min(H(18.6, Z + 2.55), H(19.1, Z + 3.15)) - 0.1;
  P.put(gm.vxD, rboxAt(0.5, Y(2.3) - gc, 0.6, 0.05, 18.85, (Y(2.3) + gc) / 2, Z + 2.85));
  P.put(gm.steel, new THREE.CylinderGeometry(0.09, 0.09, 0.16, 10).rotateZ(Math.PI / 2).translate(18.56, Y(1.03), Z + 2.95));
  P.put(gm.steel, new THREE.CylinderGeometry(0.07, 0.07, 0.24, 10).rotateX(Math.PI / 2).translate(18.85, Y(1.9), Z + 2.46));
  P.put(gm.vxD, new THREE.CylinderGeometry(0.15, 0.15, 0.06, 12).rotateX(Math.PI / 2).translate(18.85, Y(1.9), Z + 2.4));
  P.put(gm.hazard, bxm(0.52, 0.3, 0.62, 18.85, Y(2.15), Z + 2.85, 0.8));
  P.put(gm.vxD, new THREE.CylinderGeometry(0.16, 0.16, 1.7, 10).translate(20.65, Y(5.2), Z - 2.1));
  P.put(gm.vxD, new THREE.CylinderGeometry(0.21, 0.21, 0.12, 10).translate(20.65, Y(6.05), Z - 2.1));
  P.put(gm.vxD, beam(V3(20.65, Y(4.9), Z - 2.1), V3(20.2, Y(4.4), Z - 1.8), 0.04));
  // platine du projecteur (posé à 4,95) : sa tige descend dans le toit
  P.put(gm.vxD, new THREE.CylinderGeometry(0.1, 0.11, 0.06, 10).translate(16.2, Y(4.43), Z + 1.6));
  P.flush(L, null);
  // collisions : tambour de queue et ses paliers ; moteur et carter (arrêtés à 0,8 m : plus haut, ils serviraient de
  // marchepied vers le toit du broyeur, inaccessible sans Propulseur) ; trémie (quatre parois inclinées, on glisse
  // dessus) et cheminée. Joues et linteau de la gueule restent traversables (0,26 m de saillie : leur dessus ferait
  // aussi marchepied vers le toit).
  L.box(V3(-14.0, Y(0.35), Z), V3(1.2, 0.7, 3.24), null, { surface: 'metal' });
  L.box(V3(17.95, Y(0.4), Z + 2.95), V3(1.5, 0.8, 0.9), null, { surface: 'metal' });
  L.box(V3(18.85, Y(0.4), Z + 2.85), V3(0.5, 0.8, 0.6), null, { surface: 'metal' });
  const phi = Math.atan2(0.74, 1.5), sl = Math.hypot(0.74, 1.5);
  for (const s of [-1, 1]) {
    L.box(V3(CX + s * 1.43, Y(5.15), Z), V3(0.1, sl, 3.0), null, { surface: 'metal', rz: -s * phi });
    L.box(V3(CX, Y(5.15), Z + s * 1.43), V3(3.0, sl, 0.1), null, { surface: 'metal', rx: s * phi });
  }
  L.game.world.add(new CylinderCollider(20.65, Z - 2.1, Y(4.4), Y(6.1), 0.2, { surface: 'metal' }));
}

// Réserve scellée (sol à VY, centrée en z = CZ ; collisions posées à part : fond x = -19,3, flancs à CZ ∓ 3,1, toit 7 × 7 m de
// VY + 5 à VY + 5,5, porte aimantée en façade x = -13) : bardage de tôle ondulée violette (celle des conteneurs) à
// couvre-joint riveté, doublage intérieur, poteaux d'angle sur platines boulonnées, plinthe, toit de tôle ondulée sur
// chevêtre, rive à bande de danger, neige sur le toit et congères au pied
function reserve(L, M3, VY, H, CZ) {
  const gm = gvMats(), P = parts();
  const ct = containerTexture('#6a2bd0');
  const skin = mat('#ffffff', { map: ct.map, normalMap: ct.normalMap, rough: 0.82, metal: 0.15 });
  const X0 = -19.6, X1 = -12.8, Z0 = CZ - 3.4, Z1 = CZ + 3.4, CX = (X0 + X1) / 2, Y = (y) => VY + y;
  const hgt = 5.0;
  // bardage : fond (vers -x), flancs (vers -z et +z) ; doublage intérieur
  P.put(skin, corrugated(Z1 - Z0, hgt, 0.3, 0.05, 0.25, -0.1).rotateY(-Math.PI / 2).translate(X0, VY, CZ));
  P.put(skin, corrugated(X1 - X0, hgt, 0.3, 0.05, 0.25, -0.1).rotateY(Math.PI).translate(CX, VY, Z0));
  P.put(skin, corrugated(X1 - X0, hgt, 0.3, 0.05, 0.25, -0.1).translate(CX, VY, Z1));
  P.put(gm.vxD, rboxAt(0.06, hgt, 6.0, 0.02, -18.97, Y(hgt / 2 - 0.1), CZ));
  for (const z of [CZ - 2.77, CZ + 2.77]) P.put(gm.vxD, rboxAt(6.1, hgt, 0.06, 0.02, -15.9, Y(hgt / 2 - 0.1), z));
  // couvre-joint riveté à mi-hauteur, plinthe
  for (const [len, rot, x, z, nx, nz] of [[Z1 - Z0, -Math.PI / 2, X0, CZ, -1, 0], [X1 - X0, Math.PI, CX, Z0, 0, -1], [X1 - X0, 0, CX, Z1, 0, 1]]) {
    for (const [y, hh] of [[2.45, 0.14], [0.12, 0.3]]) P.put(gm.vxD, rboxAt(len - 0.3, hh, 0.05, 0.015, 0, Y(y), 0.025).rotateY(rot).translate(x, 0, z));
    const pts = [];
    for (let t = -len / 2 + 0.35; t < len / 2 - 0.3; t += 0.3) pts.push([x + (nz ? t : 0) + nx * 0.055, Y(2.45), z + (nx ? t : 0) + nz * 0.055]);
    riv(P, gm.steel, pts, [nx, 0, nz], 0.022);
  }
  // poteaux d'angle sur platines boulonnées
  for (const x of [X0, X1]) for (const z of [Z0, Z1]) {
    const g = H(x, z) - VY;
    P.put(gm.vxD, rboxAt(0.36, 5.3 - g, 0.36, 0.04, x, Y((5.1 + g - 0.2) / 2), z));
    P.put(gm.vxD, rboxAt(0.62, 0.08, 0.62, 0.02, x, Y(g + 0.02), z));
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P.put(gm.steel, new THREE.CylinderGeometry(0.035, 0.035, 0.07, 6).translate(x + a * 0.22, Y(g + 0.09), z + b * 0.22));
    const pts = [];
    for (let y = 0.5; y < 4.9; y += 0.55) pts.push([x + (x < CX ? -0.181 : 0.181), Y(y), z]);
    riv(P, gm.steel, pts, [x < CX ? -1 : 1, 0, 0], 0.025);
    L.box(V(x, (Y(5.0) + Y(g) - 0.2) / 2, z), V(0.36, 5.2 - g, 0.36), null, { surface: 'metal' });
  }
  // toit : chevêtre, tôle ondulée, rive à bande de danger, cornière de bord
  P.put(gm.vxD, rboxAt(7, 0.36, 7, 0.04, CX, Y(5.18), CZ));
  P.put(skin, corrugated(6.8, 6.8, 0.5, 0.05, 0.25, -3.4).rotateX(-Math.PI / 2).translate(CX, Y(5.44), CZ));
  for (const s of [-1, 1]) {
    P.put(gm.hazard, bxm(7.04, 0.3, 0.04, CX, Y(5.18), CZ + s * 3.51, 0.6));
    P.put(gm.hazard, bxm(0.04, 0.3, 7.04, CX + s * 3.51, Y(5.18), CZ, 0.6));
    P.put(gm.steel, rboxAt(7.1, 0.07, 0.1, 0.015, CX, Y(5.4), CZ + s * 3.5));
    P.put(gm.steel, rboxAt(0.1, 0.07, 7.1, 0.015, CX + s * 3.5, Y(5.4), CZ));
  }
  // neige sur le toit : couche bosselée aux bords irréguliers (là où elle manque, elle passe sous la tôle)
  const sn = new THREE.PlaneGeometry(6.7, 6.7, 22, 22).rotateX(-Math.PI / 2);
  const sp = sn.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i), z = sp.getZ(i);
    const e = Math.max(Math.abs(x), Math.abs(z)) / 3.35;
    const h = 0.2 * (fbm2(x * 0.45 + 3, z * 0.45, 3, 377) - 0.3) + 0.06 - Math.pow(e, 6) * 0.25 - (fbm2(x * 1.4, z * 1.4, 2, 379) - 0.5) * 0.06;
    sp.setY(i, h > 0 ? h : -0.1);
  }
  sn.computeVertexNormals();
  P.put(M3.snow, faceUV(sn.translate(CX, Y(5.44), CZ), 0.5));
  P.flush(L, null);
  snowDrift(L, V(X0 - 0.6, H(X0 - 0.6, CZ - 1.5) - 0.2, CZ - 1.5), 0.9, 4, { collide: false });
  snowDrift(L, V(-15, H(-15, Z1 + 0.6) - 0.2, Z1 + 0.6), 0.8, 9, { collide: false });
}

// Cage de Morsillon (groupe animé : elle s'envole quand on l'ouvre) : seize barreaux rivetés à trois cerclages,
// couvercle en dôme de tôle peinte à nervures rayonnantes et couronne de rivets, anneau de levage, cadenas jaune à
// moraillon (côté -z) et voyant rose, liseré rose sous le rebord. Même encombrement (rayon 1,6 m, 3,3 m de haut).
function cageModel(cage, M3) {
  const gm = gvMats(), P = parts();
  const barM = mat('#3a2a58', { metal: 0.7, rough: 0.35 });
  const NB = 16, RB = 1.4;
  for (let i = 0; i < NB; i++) {
    const a = (i / NB) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
    P.put(barM, new THREE.CylinderGeometry(0.052, 0.052, 2.7, 8).translate(c * RB, 1.65, sn * RB));
    // rivets sur le cerclage (cerclage bas : 1,485 m de rayon, cerclages fins : 1,45 m ; ils flottaient de 2 cm)
    for (const [y, rr] of [[0.38, RB + 0.08], [1.66, RB + 0.045], [2.86, RB + 0.045]]) riv(P, gm.steel, [[c * rr, y, sn * rr]], [c, 0, sn], 0.03);
  }
  P.put(barM, new THREE.TorusGeometry(RB, 0.085, 4, 48).rotateX(Math.PI / 2).scale(1, 1.3, 1).translate(0, 0.38, 0));
  for (const y of [1.66, 2.86]) P.put(barM, new THREE.TorusGeometry(RB, 0.05, 4, 48).rotateX(Math.PI / 2).scale(1, 1.6, 1).translate(0, y, 0));
  // couvercle en dôme (UV étirées en tour pour la peinture), fond, nervures, rivets
  const prof = [[1.45, 2.95], [1.6, 2.93], [1.68, 2.98], [1.66, 3.08], [1.52, 3.16], [1.2, 3.35], [0.8, 3.5], [0.35, 3.6], [0, 3.62]];
  const lid = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 36);
  const uv = lid.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 6);
  P.put(gm.vx, lid);
  P.put(gm.vxD, new THREE.CylinderGeometry(1.46, 1.46, 0.04, 36).translate(0, 2.95, 0));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2, c = Math.cos(a), sn = Math.sin(a);
    P.put(gm.vxD, beam(new THREE.Vector3(c * 0.4, 3.62, sn * 0.4), new THREE.Vector3(c * 1.56, 3.17, sn * 1.56), 0.035, 0.035, 5));
  }
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
    riv(P, gm.steel, [[c * 1.47, 3.2, sn * 1.47]], [c * 0.55, 0.83, sn * 0.55], 0.026);
  }
  P.put(gm.vxD, rboxAt(0.34, 0.12, 0.34, 0.03, 0, 3.66, 0));
  P.put(gm.steel, new THREE.TorusGeometry(0.16, 0.04, 6, 14).translate(0, 3.88, 0));
  // cadenas à moraillon, voyant rose : le moraillon pend du rebord du couvercle, un crampon soudé au cerclage le
  // traverse et l'anse du cadenas passe dans le crampon (le cadenas pendait dans le vide, 2,4 cm devant le moraillon)
  P.put(gm.vxD, rboxAt(0.12, 0.35, 0.04, 0.012, 0, 2.895, -1.69));
  P.put(gm.steel, rboxAt(0.03, 0.024, 0.36, 0.008, 0, 2.76, -1.6));
  P.put(gm.gold, rboxAt(0.34, 0.38, 0.16, 0.04, 0, 2.5, -1.74));
  P.put(gm.steel, new THREE.TorusGeometry(0.1, 0.026, 6, 12, Math.PI).translate(0, 2.69, -1.74));
  P.put(M3.pinkGlow, new THREE.BoxGeometry(0.07, 0.11, 0.01).translate(0, 2.46, -1.825));
  riv(P, gm.steel, [[-0.11, 2.62, -1.821], [0.11, 2.62, -1.821]], [0, 0, -1], 0.018);
  P.put(M3.pinkGlow, new THREE.TorusGeometry(1.61, 0.04, 6, 40).rotateX(Math.PI / 2).translate(0, 2.9, 0));
  for (const [m, g] of P.merged()) cage.add(new THREE.Mesh(g, m));
}
// Socle fixe de la cage : plateau chanfreiné boulonné, rive à bande de danger
function cagePlinth(L, pos) {
  const gm = gvMats(), P = parts();
  const plinth = new THREE.LatheGeometry([[0, 0.27], [1.52, 0.27], [1.6, 0.23], [1.66, 0.12], [1.7, -0.2]].map(([r, y]) => new THREE.Vector2(r, y)).reverse(), 40);
  P.put(gm.vxD, plinth);
  const band = new THREE.CylinderGeometry(1.665, 1.69, 0.1, 40, 1, true).translate(0, 0.06, 0);
  const uv = band.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 26, uv.getY(i) * 0.25);
  P.put(gm.hazard, band);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2 + 0.1;
    P.put(gm.steel, new THREE.CylinderGeometry(0.045, 0.045, 0.05, 6).translate(Math.cos(a) * 1.5, 0.29, Math.sin(a) * 1.5));
  }
  P.flush(L, new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z));
}

// Formation rocheuse en strates (corniches) : bloc w × h × d centré à l'origine, dessus plat praticable (y = h/2,
// arête à peine abattue), flancs bosselés à ressauts horizontaux comme les falaises, coins arrondis. À poser avec la
// roche enneigée du terrain (projetée en monde : neige sur les replats, roche sur les flancs). o : amp (relief des
// flancs), step (hauteur des strates), cell (maille en plan), cellY (maille en hauteur)
function crag(w, h, d, seed, o = {}) {
  const amp = o.amp ?? 0.3, step = o.step ?? 0.85, cell = o.cell ?? Math.max(0.35, Math.max(w, d) / 30), cy = o.cellY ?? 0.4;
  const g0 = new THREE.BoxGeometry(w, h, d, Math.ceil(w / cell), Math.ceil(h / cy), Math.ceil(d / cell));
  g0.deleteAttribute('normal');
  g0.deleteAttribute('uv');
  const g = mergeVertices(g0, 1e-4);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ax = Math.abs(x) / (w / 2), az = Math.abs(z) / (d / 2);
    const side = smooth(clamp((Math.max(ax, az) - 0.8) / 0.2, 0, 1));
    if (side <= 0) continue;
    const t = h / 2 - y;
    const nx = x / (w / 2), nz = z / (d / 2), l = Math.hypot(nx, nz) || 1;
    const n0 = noise3(x * 0.16 + seed, y * 0.12, z * 0.16, seed + 9) - 0.5;
    const n1 = noise3(x * 0.4 + seed, y * 0.35, z * 0.4, seed) - 0.5, n2 = noise3(x * 1.2, y * 1.1, z * 1.2, seed + 3) - 0.5;
    const f = (((t / step + n1 * 0.7) % 1) + 1) % 1;
    // lobes, bosses, ressauts (saillants en haut de chaque strate) ; le pourtour du dessus ondule à peine
    let out = ((n0 * 2.2 + n1 * 1.4 + n2 * 0.5) * amp + (1 - f) * (o.ledge ?? 0.3) - 0.1) * (0.3 + 0.7 * smooth(clamp(t / 0.6, 0, 1)));
    out += Math.min(t, 8) * (o.flare ?? 0.05);
    out -= smooth(clamp((Math.min(ax, az) - 0.7) / 0.3, 0, 1)) * Math.min(w, d, 6) * 0.07;
    out *= side;
    x += (nx / l) * out;
    z += (nz / l) * out;
    if (t < 1e-4 && Math.max(ax, az) > 0.999) y -= 0.05;
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

export default {
  id: 'givrelune',
  name: 'Givrelune',
  subtitle: 'La Lune des Glaces',
  orb: 'radial-gradient(circle at 35% 30%, #ffffff, #9ad0f4 40%, #3a5aa8 90%)',
  mapPos: [50, 64],
  music: 'givrelune',
  build(L, g) {
    const props = g.props;
    const R = rng(4242);
    const M3 = iceMats();
    // crépuscule polaire : soleil bas et doré dans le dos (sud), ciel indigo et aurore au nord, ombres bleues
    L.environment({
      skyTop: '#0e1a4a', skyHorizon: '#b49ac0', skyBottom: '#cdbfe0', sunDir: [-0.25, 0.48, -0.84], sunColor: '#ffb45c',
      clouds: 0.25, cloudColor: '#ffd8c8', cloudHeight: 0.18, stars: 0.9, nebula: 0.35, nebulaA: '#3affb0', nebulaB: '#7a5aff',
      aurora: { a: '#3affb0', b: '#b46aff', strength: 2, dist: 1.8 },
      planetDir: [-0.3, 0.3, 0.9], planetSize: 0.2, planetA: '#6a8ae0', planetB: '#dce8ff', ring: 1, ringColor: '#e4eeff',
      moonDir: [0.7, 0.45, 0.55], moonSize: 0.03, moonColor: '#ffe0d0',
      fogColor: '#8a98c8', fogNear: 60, fogFar: 480, fogBase: -46, fogFall: 0.08, fogHeight: 0.85, fogSun: 0.7, fogSunColor: '#ffb488',
      hemiSky: '#7090e0', hemiGround: '#5a6aa0', hemiIntensity: 0.75, envGround: '#a8b4e0', fill: 0.35, fillColor: '#c8d6ff',
      sunIntensity: 3.3, envIntensity: 0.75, rays: 0.45, sunHalo: 1.2, skyGlow: 1.2, rimColor: '#ffc8a0', rimStrength: 0.7, dust: '#eef4ff',
      bloom: 0.5, exposure: 0.9, saturation: 1.15,
      grade: { shadows: '#2a40c8', highlights: '#ffb860', amount: 0.34, contrast: 0.28 },
      // air glacé : voile léger, doré à contre-jour, halos des lanternes et des projecteurs
      volumetric: { density: 0.012, floor: 0.3, sun: 1.3, anisotropy: 0.65, ambient: '#8aa0e8', ambientAmount: 0.3 },
    });
    // lumières locales : crépuscule : lanternes, igloos et projecteurs comptent vraiment
    lights.gain = 0.85;
    // la glace bleue teinterait toute la neige : rebond diffuse modéré
    probes.diffuse = 0.5;
    L.killY = -30;
    L.ambient = 'blizzard';
    const snow = snowTexture();
    const iceR = rockTexture('ice');
    L.terrain({
      x0: -320, z0: -130, size: 640, res: 320, height, surface: 'snow',
      mapA: snow.map, mapB: iceR.map, normalA: snow.normalMap, normalB: iceR.normalMap, scaleA: 0.14, scaleB: 0.085, slopeLo: 0.62, slopeHi: 0.8,
      color: (x, z, h, ny) => {
        const n = fbm2(x * 0.07, z * 0.07, 2, 23);
        let k = 0.92 + n * 0.14;
        if (h < -18) k *= 0.55 + clamp((h + 60) / 42, 0, 1) * 0.45; // fond des gouffres plus sombre
        // fond du lac (vu à travers la glace) et du chenal : roche sombre
        const wet = Math.max(x > LAKE.x0 - 0.5 && x < LAKE.x1 + 0.5 && z > LAKE.z0 - 0.5 && z < LAKE.z1 + 0.5 ? 0.55 + lakeDeep(x, z) * 0.3 : 0, poolK(x, z) * 0.85);
        if (wet > 0) return [lerp(k * 0.94, 0.3, wet), lerp(k * 0.97, 0.36, wet), lerp(k * 1.04, 0.46, wet)];
        // parois un peu moins bleues : la lumière dorée du soleil bas y prend
        const wk = smooth(clamp((0.75 - ny) / 0.3, 0, 1));
        return [k * 0.94 * (1 + wk * 0.08), k * 0.97, k * 1.04 * (1 - wk * 0.07)];
      },
    });
    // la neige scintille (soleil, lanternes)
    snowSparkle(L.terrainMesh.material, { normal: 0.6 });
    const H = (x, z) => height(x, z);
    const at = (x, z, dy = 0) => V(x, H(x, z) + dy, z);
    const spawnGroup = (list) => list.forEach(([type, x, z, o, y]) => g.enemies.spawn(type, V(x, y ?? H(x, z), z), o || {}));

    // décor le long des parois : sapins, congères rocheuses, éclats de glace
    // pas de sapin près des corniches (on pourrait s'en servir de marchepied)
    const AVOID = [[-17, 258, 8], [21, 268, 10], [-12, 66, 6], [5.5, 186, 6]];
    const scatter = (z0, z1, n, kinds = 'pine') => {
      for (let i = 0; i < n; i++) {
        const z = lerp(z0, z1, R());
        let best = null;
        for (let k = 0; k < 8 && best === null; k++) {
          const x = lerp(-40, 45, R());
          const dd = distToPolyline(x, z, PATH).d;
          const hw = prof(z, HW);
          if (dd > hw - 6 && dd < hw + 1 && lakeK(x, z) === 0 && !AVOID.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar)) best = x;
        }
        if (best === null) continue;
        const p = at(best, z);
        const t = R();
        if (kinds === 'pine' && t < 0.6) pine(L, p, 0.9 + R() * 0.5, Math.floor(R() * 99));
        else if (t < 0.85) {
          // congère contre la paroi : recalée vers le fond si un bord flotte (son collider la suit)
          const sz = 1.2 + R() * 1.8, sd = Math.floor(R() * 99), rk = R() < 0.5, xs = seatDrift(H, best, z, sz);
          if (xs !== null) snowDrift(L, at(xs, z), sz, sd, { rock: rk });
        }
        else iceShards(L, p, 4 + Math.floor(R() * 4), 0.8 + R() * 0.6, Math.floor(R() * 99));
      }
    };
    scatter(-34, 104, 80);
    scatter(172, 200, 12, 'ice');
    scatter(254, 290, 30);
    scatter(334, 396, 22, 'ice');
    scatter(412, 474, 18, 'ice');

    // ------------------------------------------------ A. Le camp Banquise
    L.checkpoint = { pos: V(2, H(2, -4) + 0.2, -4), yaw: 0 };
    const ship = kobiShip(L.root, { ground: (x, z) => L.heightfield.height(x, z) });
    ship.position.set(-9, H(-9, -14), -14);
    ship.rotation.y = 0.5;
    L.box(V(-9, H(-9, -14) + 1.6, -14), V(2.6, 3, 6), null, { ry: 0.5, surface: 'metal' });
    L.titleShot = () => {};
    snowman(L, at(6, 5), Math.PI + 0.3);
    igloo(L, at(-15, 2), Math.PI / 2);
    igloo(L, at(-18, 15), Math.PI / 2 + 0.25, 2.3);
    igloo(L, at(-14, 28), 1.1, 2.8);
    props.vendor(at(-11, 9), Math.PI / 2);
    for (const [x, z] of [[-6, 1], [-6, 17], [7, 33], [-3, -10]]) iceLantern(L, at(x, z));
    props.sign(at(-3, 5), 0.25, 'CAMP BANQUISE\nMINE VORAX → 400 M', 3.2, 1.3, SIGN);
    snowDrift(L, at(-20, -8), 2.2, 3);
    snowDrift(L, at(12, -10), 1.8, 7, { rock: true });
    props.crate(at(4, 10), 'bolt');
    props.crate(at(5.3, 10.6), 'bolt');
    props.crate(at(4.6, 10.3, 1), 'bolt');
    props.crate(at(-6, 12), 'bolt');
    props.crate(at(-7, 24), 'ammo');
    props.crate(at(6, 26), 'bolt');
    // lac gelé et ses trois piliers (boulon d'or) : la dalle glissante est inchangée (collision seule), la vraie glace
    // la recouvre — épaisse et translucide, bulles et fissures prises dedans, fond sombre plusieurs mètres plus bas
    const LW = LAKE.x1 - LAKE.x0, LD = LAKE.z1 - LAKE.z0, LX = (LAKE.x0 + LAKE.x1) / 2, LZ = (LAKE.z0 + LAKE.z1) / 2;
    L.box(V(LX, -0.3, LZ), V(LW, 0.5, LD), null, { surface: 'ice' });
    const lake = createWater(L, {
      rect: [LAKE.x0, LAKE.z0, LW, LD], y: -0.05, preset: 'glace',
      shallow: '#cff4ff', deep: '#072f4c', absorb: [0.26, 0.075, 0.05], turbidity: 0.16, foam: 0.75, normal: 0.22,
    });
    // tranches de la dalle (bords visibles au-dessus de la rive)
    for (const [x, z, w, d] of [[LAKE.x0 + 0.06, LZ, 0.12, LD], [LAKE.x1 - 0.06, LZ, 0.12, LD], [LX, LAKE.z0 + 0.06, LW, 0.12], [LX, LAKE.z1 - 0.06, LW, 0.12]]) {
      L.box(V(x, -0.335, z), V(w, 0.55, d), M3.iceEdge, { collide: false });
    }
    // les piliers plongent jusqu'au fond, sous la glace
    icePillar(L, V(14.5, 2.2, 21), 0, 1.5, { bottom: -0.6, surface: 'snow', base: H(14.5, 21) - 0.3 });
    icePillar(L, V(18.5, 4.2, 26), 0, 1.4, { bottom: -0.6, surface: 'snow', base: H(18.5, 26) - 0.3 });
    icePillar(L, V(22.5, 6.2, 21.5), 0, 1.3, { bottom: -0.6, surface: 'snow', base: H(22.5, 21.5) - 0.3 });
    props.goldBolt(V(22.5, 7.5, 21.5), 0);
    // rochers au fond du lac : la profondeur se lit à travers la glace
    const lakeRock = mat('#5a6a84', { map: iceR.map, normalMap: iceR.normalMap, rough: 0.85 });
    for (const [x, z, sz, s] of [[15.5, 8, 1.3, 3], [20.5, 12.5, 0.9, 7], [16.5, 15.5, 0.7, 11], [19.5, 29, 1.1, 5], [13.8, 27, 0.8, 9], [21, 17, 0.6, 13]]) {
      snowDrift(L, V(x, H(x, z) + 0.1, z), sz, s, { mat: lakeRock, collide: false });
    }
    // eau libre : chenal sombre et froid au pied de la falaise, qui fume (source tiède) ; plaques de glace à la dérive
    const pool = createWater(L, {
      rect: [LAKE.x1 - 0.15, POOL.z0 - 0.5, POOL.x1 - LAKE.x1 + 1.6, POOL.z1 - POOL.z0 + 1], y: POOL.y,
      shallow: '#3a7a8c', deep: '#02121c', absorb: [1.8, 0.75, 0.5], turbidity: 1.3, roughness: 0.04,
      waves: [[1.3, 0.012, 2.6], [0.4, 0.008, 1.7]], flow: [0, 0.1], foam: 0.35, shore: 0.14, caustics: 0, splash: '#e6f4ff',
    });
    waterFloaters(L, pool, {
      count: 8, region: [LAKE.x1 + 0.5, POOL.z0 + 3, 2.4, POOL.z1 - POOL.z0 - 6], spin: 0.08,
      make: (i) => iceFloe(0.42 + (i % 3) * 0.18, i + 3),
    });
    const spl = waterSplashes(L);
    L.every((dt) => {
      const cp = g.camera.cam.position;
      if (Math.abs(cp.z - 17) > 70 || cp.x < -40) return;
      // vapeur : bouffées légères, plus denses contre la falaise (la source)
      for (let k = dt * 10 * (g.R.Q.waterSplash ?? 1); k > 0; k--) {
        if (Math.random() > k) continue;
        const x = lerp(LAKE.x1 + 0.3, POOL.x1 - 1, Math.sqrt(Math.random())), z = lerp(POOL.z0 + 3, POOL.z1 - 3, Math.random());
        spl.fume(x, POOL.y + 0.05, z, '#f4f8ff', 0.18 + Math.random() * 0.12, 1.4 + Math.random() * 1.2);
      }
    });
    // reflets des lanternes et des éclats de glace voisins
    lake.addLamp(at(7, 33, 2.6), '#6ae8ff', 1.2);
    for (const [x, z] of [[12, 30], [24, 5]]) lake.addLamp(V(x, 0.85, z), '#4aa8ff', 0.8);
    pool.addLamp(V(24, 0.85, 5), '#4aa8ff', 0.8);
    iceShards(L, V(12, -0.05, 30), 5, 0.9, 4);
    iceShards(L, V(24, -0.05, 5), 4, 0.8, 8);
    for (let i = 0; i < 6; i++) g.pickups.placeBolt(V(13 + i * 2, 1, 8 + i * 1.5), 5);
    L.trigger({
      sphere: [[16, 0, 12], 7],
      fn: () => g.hud.say([['ecrou', 'Un lac gelé ! Sur la glace, ça glisse : anticipe tes virages. Et tout en haut de ces piliers… quelque chose brille !']]),
    });

    // ------------------------------------------------ B. La plaine des congères
    pine(L, at(-6, 52), 1.1, 3);
    pine(L, at(9, 61), 1, 7);
    pine(L, at(-3, 89), 1.2, 11);
    pine(L, at(11, 92), 0.9, 13);
    snowDrift(L, at(4, 70), 2.2, 4, { rock: true });
    snowDrift(L, at(-9, 78), 1.8, 2);
    snowDrift(L, at(8, 84), 1.6, 6);
    iceShards(L, at(12, 76), 6, 1.2, 5);
    // iceberg : cristal d'Orbium au sommet
    L.box(V(-12, 1.5, 66), V(4, 3.4, 4), null, { surface: 'snow', ry: 0.4 });
    iceberg(L, M3, -12, 66, 0.4, H);
    snowDrift(L, at(-14.4, 64.6), 1.1, 3, { collide: false });
    snowDrift(L, at(-9.8, 68.2), 0.9, 8, { collide: false });
    props.orbium(V(-12, 3.2, 66), 0);
    props.crate(at(8, 58), 'ammo');
    props.crate(at(9.2, 58.6), 'bolt');
    props.crate(at(-4, 70), 'health');
    props.crate(at(2, 80), 'boom');
    props.crate(at(-8, 93), 'bolt');
    props.crate(at(10, 100), 'big');
    for (let i = 0; i < 6; i++) g.pickups.placeBolt(at(lerp(1, -3, i / 5), 40 + i * 4, 1), 5);
    L.trigger({
      box: [[-30, -10, 44], [40, 30, 48]],
      fn: () => {
        spawnGroup([['pingouin', -5, 74], ['pingouin', 7, 78], ['pingouin', 1, 86]]);
        g.hud.say([['ecrou', 'Des Pingouins-mortiers ! Ils lobent des boules de neige : surveille les cercles au sol et ne reste pas dessous.']], true);
      },
    });
    L.trigger({
      box: [[-30, -10, 80], [40, 30, 84]],
      fn: () => {
        spawnGroup([['fouisseur', 5, 95], ['fouisseur', -5, 98], ['grignoteur', 0, 92], ['grignoteur', 3, 97]]);
        g.hud.say([['ecrou', 'Le sol bouge… Un Fouisseur ! Quand un cercle apparaît sous tes pieds, esquive avec ' + g.input.actionLabel('dash') + ' !']], true);
      },
    });

    // ------------------------------------------------ C. La piste du Grand Plongeon
    props.checkpoint(at(-6, 99), 0);
    props.sign(at(5.5, 104), -0.25, 'PISTE DU GRAND PLONGEON\nACCROCHEZ VOS OREILLES', 3.6, 1.3, SIGN);
    iceLantern(L, at(-3.6, 107));
    iceLantern(L, at(3.6, 107));
    L.trigger({
      box: [[-20, -5, 100], [20, 20, 104]],
      fn: () => g.hud.say([['ecrou', 'Une piste de glisse ! Laisse-toi descendre et dirige-toi avec ' + g.input.moveLabel() + '. Tire en arrière pour freiner… et saute d’un tronçon à l’autre !']], true),
    });
    const slides = [
      [V(0, -0.3, 109), V(3, -4.3, 127.5), 5],
      [V(3.51, -6.3, 130.66), V(-2, -10.3, 148.5), 6],
      [V(-2.94, -12.3, 151.56), V(0, -16.3, 170), 6],
    ];
    for (const [a, b, w] of slides) {
      iceSlide(L, a, b, w);
      for (let i = 1; i <= 4; i++) g.pickups.placeBolt(a.clone().lerp(b, i / 5).add(V(0, 1.1, 0)), 5);
      // piliers de soutien plongés dans la brume du gouffre
      slidePier(L, M3, a, b, w, Math.round(a.z));
    }

    // ------------------------------------------------ D. La crevasse
    props.checkpoint(V(-6, H(-6, 178), 178), 0);
    L.trigger({
      box: [[-15, -25, 174], [15, 0, 178]],
      fn: () => {
        spawnGroup([['moustique', -4, 190], ['moustique', -1, 193], ['moustique', 2, 190], ['moustique', -2, 187], ['moustique', 1, 195], ['fouisseur', 3, 184]]);
        g.hud.say([['ecrou', 'Un essaim de Moustiques ! Fragiles, mais nombreux : arrose-les sans t’arrêter.']], true);
      },
    });
    // corniche au cristal (double saut)
    L.box(V(5.5, -14.45, 186), V(3, 3.1, 3), null, { surface: 'snow' });
    L.add(crag(3, 4.6, 3, 5, { amp: 0.26, step: 0.75, ledge: 0.24, cell: 0.3, cellY: 0.25 }), M3.iceRock, new THREE.Matrix4().makeTranslation(5.5, -15.2, 186));
    for (const [x, z, sz, sd] of [[7.4, 185.2, 0.55, 2], [4.1, 187.6, 0.45, 4], [6.6, 187.9, 0.35, 1]]) rock(L, V(x, H(x, z), z), sz, { mat: M3.iceRock, collide: false, seed: sd });
    props.orbium(V(5.5, -12.9, 186), 1);
    iceShards(L, V(-7, H(-7, 182), 182), 6, 1.1, 21);
    iceShards(L, V(6, H(6, 194), 194), 5, 1, 22);
    props.crate(V(-5, H(-5, 186), 186), 'ammo');
    props.crate(V(4, H(4, 178), 178), 'bolt');
    // première cheminée de sauts muraux (6 m)
    wallChimney(L, -2, -16.2, -10, 195, 204);
    g.pickups.placeBolt(V(-2, -13.2, 199), 5);
    g.pickups.placeBolt(V(-2, -11, 200), 5);
    L.trigger({
      sphere: [[-2, -16, 193], 6],
      fn: () => g.hud.say([['ecrou', 'Deux parois rainurées ! Saute contre l’une, puis appuie encore sur ' + g.input.actionLabel('jump') + ' pour rebondir vers l’autre. Grimpe comme ça jusqu’en haut !']], true),
    });
    // corniche, gouffre au grappin, palier
    L.box(V(-2, -35, 212.75), V(22, 50, 17.5), null, { surface: 'snow' });
    L.box(V(-2, -35, 243.25), V(22, 50, 13.5), null, { surface: 'snow' });
    L.add(crag(22, 50, 17.5, 11, { amp: 0.55, step: 1.2, ledge: 0.4, flare: 0.04, cellY: 0.4 }), M3.iceRock, new THREE.Matrix4().makeTranslation(-2, -35, 212.75));
    L.add(crag(22, 50, 13.5, 17, { amp: 0.55, step: 1.2, ledge: 0.4, flare: 0.04, cellY: 0.4 }), M3.iceRock, new THREE.Matrix4().makeTranslation(-2, -35, 243.25));
    props.crate(V(-6, -10, 210), 'ammo');
    props.crate(V(3, -10, 214), 'health');
    props.grapple(V(-2, -2.5, 229), V(-2, -10, 240.5), { apex: 2, back: V(-2, -10, 217) });
    L.trigger({
      box: [[-12, -11, 205], [10, 0, 209]],
      fn: () => {
        spawnGroup([['lunette', -5, 247, { yaw: Math.PI }, -10], ['moustique', -4, 232, {}, -12], ['moustique', 1, 230, {}, -12]]);
        g.hud.say([
          ['ecrou', 'Une Lunette, de l’autre côté ! Sa visée laser met du temps à se caler : tire la première.'],
          ['ecrou', 'Ensuite, l’anneau de grappin au-dessus du gouffre : regarde-le et appuie sur ' + g.input.actionLabel('interact') + '.'],
        ], true);
      },
    });
    props.checkpoint(V(-8, -10, 238.5), 0);
    // seconde cheminée (10 m) jusqu'au plateau
    wallChimney(L, -2, -10.2, 0, 241, 250);
    for (const y of [-7, -4, -1]) g.pickups.placeBolt(V(-2, y, 245 + (y + 7) * 0.2), 5);
    L.trigger({
      sphere: [[-2, -10, 239], 4],
      fn: () => g.hud.say([['ecrou', 'Encore une cheminée, deux fois plus haute. Courage : en haut, c’est le plateau !']]),
    });

    // ------------------------------------------------ E. Le hameau des Morses et l'avant-poste
    props.checkpoint(at(-7, 255), 0);
    props.vendor(at(-16, 268), Math.PI / 2 + 0.2);
    // les igloos des Morses gardent leur feu allumé : entrées et fenêtres de glace chaudes
    igloo(L, at(-21, 278), 1.3, 2.6, { warm: '#ffa448' });
    igloo(L, at(-1, 272), Math.PI, 2.4, { warm: '#ff9a40', window: -1.3 });
    igloo(L, at(-6, 282), 0.4, 2.2, { warm: '#ffac50' });
    snowman(L, at(4, 266), Math.PI);
    for (const [x, z] of [[-11, 262], [-9, 274], [8, 276]]) iceLantern(L, at(x, z), 2.6, { color: '#ffb45a', intensity: 34, flicker: 0.1 });
    props.crate(at(-12, 272), 'bolt');
    props.crate(at(-11, 273.3), 'bolt');
    props.crate(at(2, 280), 'ammo');
    L.trigger({
      sphere: [[-12, 0, 266], 9],
      fn: () => g.hud.say([
        ['gigi', 'Mon lapin des neiges ! Le Bazar Pétarade, édition glaçons : armes neuves en rayon, et ton Orbium s’échange ici aussi.'],
        ['ecrou', 'Le hameau des Morses… vide. Les Vorax ont dû emmener tout le monde à leur mine.'],
      ]),
    });
    // tour de glace : cheminée de 9 m, boulon d'or au sommet
    wallChimney(L, 21, -0.4, 8.8, 264, 272, { mat: M3.ice, side: 5, back: 4, bottom: -1 });
    props.goldBolt(V(21, 10.1, 274), 1);
    L.trigger({ sphere: [[21, 0, 262], 6], fn: () => g.hud.say([['ecrou', 'Encore des parois rainurées… et un boulon d’or tout là-haut, sur le pilier !']]) });
    // corniche trop haute pour un double saut : il faut le Propulseur
    L.box(V(-17, 2.4, 258), V(5, 6.4, 5), null, { surface: 'snow' });
    L.add(crag(5, 7.4, 5, 23, { amp: 0.36, step: 0.95, cell: 0.35, cellY: 0.3 }), M3.iceRock, new THREE.Matrix4().makeTranslation(-17, 1.9, 258));
    // pied évasé : 1 m au plus (le Propulseur reste nécessaire)
    { const g0 = Math.min(H(-19.5, 255.5), H(-14.5, 255.5), H(-19.5, 260.5), H(-14.5, 260.5)); L.box(V(-17, (g0 + 1 + g0 - 1) / 2, 258), V(5.7, 2, 5.7), null, { surface: 'rock' }); }
    for (const [x, z, sz, sd] of [[-14.2, 256.4, 0.7, 3], [-14.6, 260.3, 0.5, 5], [-19.6, 255.6, 0.6, 0]]) rock(L, V(x, H(x, z), z), sz, { mat: M3.iceRock, collide: false, seed: sd });
    props.orbium(V(-17, 5.6, 258), 2, 3);
    L.trigger({
      sphere: [[-14, 0, 258], 6],
      fn: () => g.hud.say([['ecrou', g.hasGadget('propulseur')
        ? 'La corniche au cristal ! Double saut, puis encore ' + g.input.actionLabel('jump') + ' : le Propulseur fera le reste.'
        : 'Un cristal d’Orbium, là-haut… Même avec un double saut, c’est trop haut. Il faudra revenir avec de quoi monter plus haut.']]),
    });

    // avant-poste Vorax : barricade et portail, gardés par deux vagues
    props.sign(at(-6, 286), 0.2, 'AVANT-POSTE VORAX\nDÉFENSE DE GLISSER', 3.6, 1.3, SIGN_VORAX);
    container(L, at(-12, 300), 0.3, '#6a2bd0');
    container(L, V(-11.6, H(-12, 300) + 2.6, 300.4), 0.2, '#ffcc33', { w: 5 });
    container(L, at(14, 296), -0.4, '#c8452f');
    container(L, at(17, 310), 1.4, '#6a2bd0');
    container(L, at(-4, 314), 1.2, '#ffcc33');
    barrel(L, at(-9, 306), { color: '#6a2bd0' });
    barrel(L, at(-8.2, 307), { color: '#6a2bd0' });
    barrel(L, at(9, 302), {});
    lamp(L, at(-16, 312), { glow: propMats().pinkGlow });
    lamp(L, at(22, 302), { glow: propMats().pinkGlow });
    props.crate(at(6, 292), 'boom');
    props.crate(at(-2, 304), 'ammo');
    props.crate(at(12, 316), 'health');
    // mirador
    const TW = at(10, 318);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) L.box(V(TW.x + sx * 1.5, TW.y + 2.6, TW.z + sz * 1.5), V(0.3, 5.2, 0.3), null, { surface: 'metal' });
    L.box(V(TW.x, TW.y + 5.3, TW.z), V(3.8, 0.4, 3.8), null, { surface: 'metal' });
    mirador(L, M3, TW, H);
    floodlight(L, V(TW.x - 1.4, TW.y + 6.25, TW.z - 1.4), Math.PI + 0.6, { tilt: 0.45, intensity: 70, range: 22 });
    // barricade (7 m) et portail
    const BZ = 326;
    for (const [x0, x1] of [[-30, 1], [9, 40]]) {
      L.box(V((x0 + x1) / 2, 3.2, BZ), V(x1 - x0, 7.4, 1.2), null, { surface: 'metal' });
      barricade(L, M3, x0, x1, BZ, H, x0 < 0 ? 31 : 37);
    }
    for (const x of [0.4, 9.6]) {
      L.box(V(x, 3.6, BZ), V(1.2, 8.2, 1.8), null, { surface: 'metal' });
      gatePost(L, M3, x, BZ);
    }
    // projecteurs de chantier sur la barricade (sur leur mât) : éclairent l'entrée de la mine
    for (const x of [-16, -5, 15, 26]) {
      floodlight(L, V(x, 7.5, BZ + 0.3), x < 5 ? 0.25 : -0.25, { tilt: 0.42 });
      // mât de 6 m à 6,9 m : il s'arrête dans la tige de la lyre (au lieu de traverser sa traverse jusque sous le boîtier)
      L.add(new THREE.CylinderGeometry(0.06, 0.08, 0.9, 8), gvMats().vxD, new THREE.Matrix4().makeTranslation(x, 6.45, BZ + 0.3));
    }
    const gate = props.forceField(V(5, H(5, BZ), BZ), 8, 7, 0, { on: true });
    const outpost = new Arena(g, {
      title: 'L’avant-poste donne l’alerte !',
      waves: [
        { list: [['larbin', -6, 306], ['larbin', 6, 310], ['larbinBouclier', 0, 314], ['grignoteur', -10, 304], ['grignoteur', 12, 304]], say: [['ecrou', 'Ils ont verrouillé le portail. Il va falloir faire le ménage !']] },
        { list: [['lunette', 10, 318], ['pingouin', -8, 316], ['pingouin', 14, 312], ['larbin', 2, 318, { elite: true }]], say: [['ecrou', 'Un Larbin doré ! Les élites sont coriaces… mais elles lâchent de l’Orbium.']] },
      ],
      reward: 500,
      rewardPos: V(4, 3, 312),
      onDone: () => {
        g.props.setField(gate, false);
        g.hud.say([['ecrou', 'Le portail s’ouvre ! La mine du Baron est juste derrière.']]);
        g.hud.objective('Trouver la grande foreuse au fond de la mine');
      },
    });
    L.trigger({ box: [[-25, -5, 296], [35, 25, 300]], once: false, fn: () => { if (!outpost.active && !outpost.done) outpost.start(); } });

    // ------------------------------------------------ F. La mine Vorax
    props.checkpoint(at(12, 333), 0);
    props.sign(at(-4, 334), 0.15, 'MINE VORAX\nON CREUSE, VOUS PAYEZ', 3.4, 1.3, SIGN_VORAX);
    const rig = (x, z, h) => {
      const p = at(x, z, -0.3);
      drillRig(L, p, h, { lampRail: h - 1.64 });
      // projecteurs fixés à la tour (platine sur la lisse), tournés vers l'allée
      const s = x < 2 ? 1 : -1;
      for (const dz of [-1.1, 1.1]) floodlight(L, V(p.x + s * 2.05, p.y + h - 1.2, p.z + dz), s * Math.PI / 2 + dz * 0.25, { tilt: 0.6, intensity: 55, mount: 'mur', reach: 0.23 });
      // le chapeau de la tour est praticable
      L.box(V(p.x, p.y + h + 0.6, p.z), V(4.4, 1.2, 4.4), null, { surface: 'metal' });
      return p.y + h + 1.2;
    };
    rig(-9, 350, 14);
    const rigTop = rig(15, 360, 14);
    rig(-7, 386, 12);
    // boulon d'or sur la tour : conteneurs, puis tremplin
    const C1 = at(19.5, 352);
    container(L, C1, 0.1, '#6a2bd0');
    container(L, V(19.3, C1.y + 2.6, 352.4), 0.35, '#ffcc33', { w: 5 });
    props.jumpPad(V(19.3, C1.y + 5.2, 352.4), V(13.8, rigTop, 358.8), 4);
    props.goldBolt(V(16.4, rigTop + 1.2, 361.4), 2);
    // tapis de minerai qui pousse vers le broyeur
    const beltY = H(2, 372);
    // bande crantée qui défile (texture animée) sur son châssis ; le broyeur au bout
    const bt = beltTexture();
    const beltTex = bt.map, beltNrm = bt.normalMap;
    beltTex.repeat.set(40, 1);
    beltNrm.repeat.set(40, 1);
    const beltMat = mat('#ffffff', { map: beltTex, normalMap: beltNrm, rough: 0.78, metal: 0.05, normalScale: 1, unique: true });
    const belt = new THREE.Mesh(new THREE.BoxGeometry(30, 0.1, 2.6), beltMat);
    belt.position.set(1, beltY + 0.65, 372);
    belt.receiveShadow = true;
    L.root.add(belt);
    g.world.add(new BoxCollider(V(1, beltY + 0.35, 372), V(15, 0.35, 1.5), null, { surface: 'metal', conveyor: V(3.2, 0, 0) }));
    L.box(V(18.5, beltY + 2.2, 372), V(5, 4.4, 5), null, { surface: 'metal' });
    oreConveyor(L, M3, beltY, H);
    floodlight(L, V(16.2, beltY + 4.95, 373.6), -Math.PI / 2, { tilt: 0.5 });
    L.add(G.cyl(0.9, 0.9, 0.2, 16), M3.pinkGlow, new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(15.9, beltY + 2.4, 372));
    const ores = [];
    const oreM = mat('#8ac8ff', { rough: 0.2, metal: 0.2, emissive: '#2a6ac8', emissiveIntensity: 0.6, flat: true });
    for (let i = 0; i < 9; i++) {
      const o = new THREE.Mesh(new THREE.DodecahedronGeometry(0.35 + Math.random() * 0.2, 0), oreM);
      o.position.set(-14 + i * 3.3, beltY + 0.9, 372 + rand(-0.8, 0.8));
      o.castShadow = true;
      L.root.add(o);
      ores.push(o);
    }
    L.every((dt) => {
      beltTex.offset.x -= dt * 3.2 / 0.75;
      beltNrm.offset.x = beltTex.offset.x;
      for (const o of ores) {
        o.position.x += 3.2 * dt;
        o.rotation.y += dt;
        if (o.position.x > 15.5) { o.position.x -= 30; o.position.z = 372 + rand(-0.8, 0.8); }
      }
    });
    // réserve scellée par un verrou magnétique (il faudra la Magnéto-clé)
    // (centrée en z = 377,4 : à 376, son flanc et son poteau d'angle traversaient le bout du tapis de minerai)
    const RZ = 377.4, VY = H(-16, RZ);
    L.box(V(-19.3, VY + 2.5, RZ), V(0.6, 5, 6.6), null, { surface: 'metal' });
    for (const z of [RZ - 3.1, RZ + 3.1]) L.box(V(-16.2, VY + 2.5, z), V(6.8, 5, 0.6), null, { surface: 'metal' });
    L.box(V(-16.2, VY + 5.25, RZ), V(7, 0.5, 7), null, { surface: 'metal' });
    reserve(L, M3, VY, H, RZ);
    props.magDoor(V(-13, VY, RZ), Math.PI / 2, 4, 4);
    props.orbium(V(-16.6, VY, RZ), 3, 3);
    L.trigger({
      sphere: [[-10.5, VY, RZ], 5],
      fn: () => g.hud.say([['ecrou', g.hasGadget('magneto')
        ? 'Le verrou magnétique ! Un coup de Magnéto-clé et la porte est à nous.'
        : 'Une porte à verrou magnétique… Sans l’outil adéquat, impossible de l’ouvrir. On reviendra !']]),
    });
    props.crate(at(6, 346), 'ammo');
    props.crate(at(-2, 366), 'bolt');
    props.crate(at(-0.8, 366.4), 'bolt');
    props.crate(at(8, 382), 'boom');
    props.crate(at(-3, 392), 'health');
    props.crate(at(4, 394), 'ammo');
    L.trigger({
      box: [[-25, -5, 336], [35, 25, 340]],
      fn: () => {
        spawnGroup([['larbin', -4, 352], ['larbin', 8, 356], ['fouisseur', 2, 364], ['fouisseur', -6, 368], ['moustique', -9, 346], ['moustique', -6, 348], ['moustique', -11, 351]]);
        g.hud.say([['ecrou', 'La mine du Baron ! Ces foreuses pompent le cœur de glace de la lune pour remplir sa Méga-Benne.']]);
      },
    });
    L.trigger({
      box: [[-25, -5, 376], [35, 25, 380]],
      fn: () => spawnGroup([['larbinBouclier', -2, 390], ['pingouin', 6, 391], ['pingouin', -8, 392, { elite: true }]]),
    });

    // ------------------------------------------------ G. Le puits de la grande foreuse (arène du Mammouth)
    props.checkpoint(at(6, 396), 0);
    drillRig(L, at(-20, 466, -0.3), 20);
    for (const [x, z] of [[-10, 424], [10, 424], [-10, 450], [10, 450]]) {
      icePillar(L, V(x, 7, z), 0, 1.8, { bottom: -1 });
      iceShards(L, V(x + 1.6, H(x, z), z + 1.2), 4, 0.9, Math.abs(x + z));
    }
    lamp(L, at(-22, 430), { glow: propMats().pinkGlow });
    lamp(L, at(22, 430), { glow: propMats().pinkGlow });
    lamp(L, at(24, 456), { glow: propMats().pinkGlow });
    // projecteurs fixés aux falaises, tournés vers le centre : le combat reste lisible
    for (const [sx, z] of [[-1, 420], [1, 420], [-1, 452], [1, 452]]) {
      let x = 24;
      while (H(sx * x, z) < 8.4) x += 0.1;
      floodlight(L, V(sx * (x - 0.3), 8, z), -sx * Math.PI / 2, { tilt: 0.5, intensity: 80, range: 26, priority: 1.8, mount: 'mur' });
    }
    props.crate(at(-18, 440), 'ammo');
    props.crate(at(18, 444), 'ammo');
    props.crate(at(-16, 420), 'health');
    props.crate(at(16, 458), 'health');
    // la cage du prisonnier
    const cagePos = at(8, 465);
    const cage = new THREE.Group();
    cage.position.copy(cagePos);
    L.root.add(cage);
    cageModel(cage, M3);
    cage.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    cagePlinth(L, cagePos);
    const cageCol = new CylinderCollider(cagePos.x, cagePos.z, cagePos.y, cagePos.y + 3.3, 1.6, { surface: 'metal' });
    g.world.add(cageCol);
    const cageLidCol = new CylinderCollider(cagePos.x, cagePos.z, cagePos.y + 3.3, cagePos.y + 3.55, 1.2, { surface: 'metal' });
    g.world.add(cageLidCol);
    let cageT = -1, talked = false;
    const openCage = () => {
      if (cageT >= 0) return;
      cageT = 0;
      g.world.remove(cageCol);
      g.world.remove(cageLidCol);
      g.audio.play('open', { pos: cagePos, pitch: 0.7 });
      g.fx.sparks(cagePos.clone().setY(cagePos.y + 2), null, 30, '#ff4fa0', 8);
    };
    L.every((dt) => {
      if (cageT < 0 || !cage.visible) return;
      cageT += dt;
      cage.position.y = cagePos.y + cageT * cageT * 4;
      cage.rotation.y += dt * 2;
      if (cageT > 2) cage.visible = false;
    });
    placeNpc(L, g, morseModel(), cagePos.clone().setY(cagePos.y + 0.25), Math.PI + 0.4, {
      label: 'Parler à Grand-père Morsillon',
      radius: 3.6,
      enabled: () => cageT >= 0 && !talked,
      action: () => {
        talked = true;
        g.hud.objective(null);
        g.hud.say([
          ['morse', 'Merci, mon garçon ! Grand-père Morsillon, inventeur, pour te servir. Ces brigands me forçaient à réparer leur foreuse.'],
          ['morse', 'Tiens, petit robot : un Propulseur de ma fabrication. Après un double saut, il vous pousse encore plus haut !'],
          ['ecrou', 'On va pouvoir atteindre les corniches trop hautes… même sur les planètes déjà visitées !'],
          ['morse', 'Le Baron, lui, est parti pour Luminbois, la jungle qui brille la nuit. Il y fait pousser je ne sais quelle horreur.'],
        ], true);
        L.after(6, () => g.giveGadget('propulseur', 'le Propulseur d’Écrou', 'Après un double saut, appuyez encore sur ' + g.input.actionLabel('jump') + ' pour monter plus haut.'));
      },
    });
    // la Bricole se pose quand Morsillon a fini de parler
    L.every(() => { if (talked && !g.hud.dialogCur && !g.hud.dialogQueue.length) exitShip.land(); });
    const AZ = 401;
    const gateIn = props.forceField(V(0, H(0, AZ), AZ), 32, 7, 0, { on: false });
    const arena = new Arena(g, {
      fields: [gateIn],
      title: 'Le puits de la grande foreuse !',
      ammo: [at(0, 418), at(-17, 448), at(17, 434)],
      waves: [
        { list: [['pingouin', -12, 444], ['pingouin', 12, 444], ['larbin', -6, 452], ['larbin', 6, 452], ['larbinBouclier', 0, 440]], say: [['ecrou', 'Une embuscade ! Les Vorax gardent leur grande foreuse.']] },
        { list: [['fouisseur', -8, 432], ['fouisseur', 8, 432], ['moustique', -4, 446], ['moustique', 4, 446], ['moustique', 0, 450], ['moustique', 2, 442], ['pingouin', 0, 458, { elite: true }]] },
        {
          list: [['mammouth', 0, 458, { yaw: Math.PI }]], after: 2.5, onStart: () => g.playMusic('boss'),
          say: [
            ['baron', 'Mammouth ! Mon chef-d’œuvre de forage. Transforme-moi ce fennec en sorbet !'],
            ['ecrou', 'Il fonce tête baissée : mets un pilier entre vous ! S’il s’y cogne, il sera sonné. Et vise le cœur dans son dos !'],
          ],
        },
      ],
      reward: 1200,
      rewardPos: V(0, 4, 437),
      onDone: () => {
        g.playMusic('givrelune');
        openCage();
        g.hud.say([
          ['ecrou', 'Le Mammouth est en pièces détachées ! Et regarde, la cage s’ouvre… il y a quelqu’un dedans !'],
        ]);
        g.hud.objective('Parler au prisonnier');
      },
    });
    L.trigger({ box: [[-14, -5, 405], [14, 20, 410]], once: false, fn: () => { if (!arena.active && !arena.done) arena.start(); } });
    L.arena = arena;
    L.onPlayerRespawn = () => {
      if (outpost.active) outpost.reset();
      if (arena.active) { arena.reset(); g.playMusic('givrelune'); }
    };
    const exitShip = shipExit(L, g, at(-6, 436), 'Décoller vers Luminbois', '#eef4ff');

    // neige qui tombe
    motes(L, { count: 900, colorA: '#c4ceff', colorB: '#dfeeff', size: 0.07, drift: [0.6, -2.2, 0.3], additive: false, glow: 1.0, box: [60, 30, 60] });
    void glow;
  },
  onStart(L, g) {
    g.hud.titleCard('Givrelune', 'La Lune des Glaces');
    g.hud.objective('Traverser la banquise jusqu’à la piste de glisse');
    L.after(1.8, () => g.hud.say([
      ['ecrou', 'Givrelune ! Brr… mes circuits gèlent. Les cargos du Baron se posent tous ici : il creuse quelque chose sous la glace.'],
      ['ecrou', 'Le Bazar Pétarade est ouvert, à côté des igloos. Une arme contre le froid ne serait pas de refus !'],
    ]));
    L.trigger({ box: [[-30, -5, 106], [30, 30, 110]], fn: () => g.hud.objective('Descendre la piste jusqu’au fond de la crevasse') });
    L.trigger({ box: [[-15, -25, 180], [15, 0, 184]], fn: () => g.hud.objective('Remonter la crevasse') });
    L.trigger({ box: [[-30, -5, 252], [30, 30, 256]], fn: () => g.hud.objective('Franchir l’avant-poste Vorax') });
  },
};
