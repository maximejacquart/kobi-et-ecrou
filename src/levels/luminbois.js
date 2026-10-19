// Planète 4 — Luminbois : la Jungle des Lucioles (forêt bioluminescente de nuit, temple de la Reine Spore).
import * as THREE from 'three';
import { mossTexture, rockTexture, plankTexture } from '../engine/textures.js';
import { fbm2, distToPolyline, smooth, clamp, lerp, rng, rand } from '../engine/util.js';
import { kobiShip, bunting, plankBox, rivets, grime } from '../models/environment/props.js';
import { stiltHouse, lantern, ropeBridge } from '../models/environment/skyIslands.js';
import { jungleTree, giantMushroom, fern, glowFlower, vines, ruinBlock, water, jungleMats, planktonBed, fireflies, glowMist, glowShrooms, glowPool, garland, spiritOrb } from '../models/environment/jungle.js';
import { camelaModel } from '../models/npc.js';
import { Arena } from '../game/arena.js';
import { shipExit, placeNpc, wallChimney } from './common.js';
import { mat } from '../engine/materials.js';
import { waterFloaters, createWaterfall } from '../engine/water/water.js';
import { G, mtx, mergeGeometries } from '../models/geo.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { grassField, motes } from '../models/nature.js';
import { BoxCollider, CylinderCollider } from '../engine/physics.js';
import { lights } from '../engine/lightpool.js';
import { volU } from '../engine/volumetrics.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const PATH = [[0, -44], [0, 0], [-4, 36], [-2, 80], [4, 112], [2, 140], [0, 172], [-4, 200], [-4, 232], [2, 266], [2, 300], [4, 340], [0, 372], [0, 428], [0, 500]];
// demi-largeur de la vallée, altitude du fond, amplitude du relief le long du parcours
const HW = [[-44, 22], [30, 22], [40, 17], [106, 18], [114, 24], [166, 24], [174, 18], [226, 20], [234, 24], [296, 24], [304, 18], [384, 18], [390, 11], [396, 11], [404, 24], [452, 24], [459, 8], [467, 8], [474, 16], [500, 16]];
const FLOOR = [[-60, 0], [35, 0], [37, 5.5], [111, 5.5], [113, -12], [167, -12], [169, 5.5], [229, 5.5], [231, -0.5], [297, -0.5], [299, 8], [520, 8]];
const AMP = [[-60, 0.5], [30, 0.5], [34, 0], [40, 0], [46, 0.6], [104, 0.6], [110, 0], [172, 0], [178, 0.5], [224, 0.5], [229, 0], [300, 0], [306, 0.5], [384, 0.5], [392, 0.15]];

function prof(z, k) {
  if (z <= k[0][0]) return k[0][1];
  for (let i = 0; i < k.length - 1; i++) {
    if (z <= k[i + 1][0]) return lerp(k[i][1], k[i + 1][1], smooth(clamp((z - k[i][0]) / (k[i + 1][0] - k[i][0]), 0, 1)));
  }
  return k[k.length - 1][1];
}
function bumps(x, z) {
  const amp = prof(z, AMP);
  return (fbm2(x * 0.06, z * 0.06, 3, 31) - 0.5) * 2 * amp;
}
function height(x, z) {
  const { d } = distToPolyline(x, z, PATH);
  const hw = prof(z, HW);
  const base = prof(z, FLOOR) + bumps(x, z);
  let wall = 24 + fbm2(x * 0.025, z * 0.025, 4, 9) * 22;
  const step = 4;
  wall = Math.floor(wall / step) * step + Math.pow((wall / step) % 1, 3) * step;
  const t = smooth(clamp((d - hw) / 7, 0, 1));
  const root = smooth(clamp((d - hw + 3) / 3, 0, 1)) * (1 - t) * 1.0;
  return lerp(base + root, wall, t);
}

const SIGN = { bg: '#14324a', fg: '#c8ffe8', border: '#7affc8', post: '#5a3a2a' };

// ---------------------------------------------------------------------------------------------------------------------
// Matières locales : corde tressée et papier de lanterne (textures canvas 128 px, raccordables), bois des plateformes
// ---------------------------------------------------------------------------------------------------------------------
const texCache = new Map();
function localTex(key, size, fn, strength = 0) {
  if (texCache.has(key)) return texCache.get(key);
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = size; return c; };
  const c = mk(), ctx = c.getContext('2d'), img = ctx.createImageData(size, size);
  const hts = new Float32Array(size * size), out = [0, 0, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const h = fn(x / size, y / size, out) ?? 0.5, i = (y * size + x) * 4;
      img.data[i] = clamp(out[0], 0, 1) * 255; img.data[i + 1] = clamp(out[1], 0, 1) * 255; img.data[i + 2] = clamp(out[2], 0, 1) * 255;
      img.data[i + 3] = 255;
      hts[y * size + x] = h;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = (cv, srgb) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.userData.shared = true;
    return t;
  };
  const res = { map: tex(c, true) };
  if (strength) {
    const n = mk(), nctx = n.getContext('2d'), nimg = nctx.createImageData(size, size);
    const Hh = (x, y) => hts[((y + size) % size) * size + ((x + size) % size)];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (Hh(x + 1, y) - Hh(x - 1, y)) * strength, dy = (Hh(x, y + 1) - Hh(x, y - 1)) * strength;
        const l = Math.hypot(dx, dy, 1), i = (y * size + x) * 4;
        nimg.data[i] = (-dx / l * 0.5 + 0.5) * 255; nimg.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; nimg.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
        nimg.data[i + 3] = 255;
      }
    }
    nctx.putImageData(nimg, 0, 0);
    res.normalMap = tex(n, false);
  }
  texCache.set(key, res);
  return res;
}
// corde de chanvre à trois torons : 1 tuile = 8 pas de torsion en u (≈ 0,48 m), 3 torons autour (v)
const ropeTexture = () => localTex('lumi-rope', 128, (u, v, out) => {
  const ph = u * 8 + v * 3, f = ph - Math.floor(ph);
  const s = Math.pow(Math.sin(f * Math.PI), 0.7);
  const fib = Math.sin((u * 64 - v * 6) * Math.PI * 2) * 0.5 + 0.5;
  const n = fbm2(u * 16, v * 16, 2, 611, 16);
  const k = 0.42 + s * 0.5 + (fib - 0.5) * 0.12 + (n - 0.5) * 0.2;
  out[0] = 0.92 * k; out[1] = 0.76 * k; out[2] = 0.5 * k;
  return s * 0.8 + fib * 0.12;
}, 3);
// papier huilé tendu entre deux baguettes : 1 tuile = un pan (u), toute la hauteur (v) ; plus clair au milieu du pan,
// fibres, lattes horizontales vues par transparence, bords haut et bas plus sombres
const paperTexture = () => localTex('lumi-paper', 128, (u, v, out) => {
  const e = Math.sin(u * Math.PI);
  const n = fbm2(u * 6, v * 12, 3, 621, 6), f = fbm2(u * 40, v * 3, 2, 627, 40);
  let k = 0.5 + Math.pow(e, 0.6) * 0.46 + (n - 0.5) * 0.14 + (f - 0.5) * 0.08;
  k *= 1 - Math.pow(Math.abs(v * 2 - 1), 6) * 0.4;
  if (Math.abs(((v * 4) % 1) - 0.5) > 0.465) k *= 0.8;
  out[0] = k; out[1] = k * 0.97; out[2] = k * 0.9;
});
let DM = null;
function deckMats() {
  if (DM) return DM;
  const tm = (t, o) => mat('#ffffff', { map: t.map, normalMap: t.normalMap, ...o });
  const timber = plankTexture('#7a5236', 'lumi-timber', { wear: 0.55, knots: 1.6, seed: 23 });
  DM = {
    plank: tm(plankTexture('#a87a4c', 'lumi-deck', { wear: 0.65, knots: 1.2, seed: 21 }), { rough: 0.78 }),
    timber: tm(timber, { rough: 0.85 }),
    rope: tm(ropeTexture(), { rough: 0.95, normalScale: 1 }),
    iron: mat('#3b3542', { metal: 0.7, rough: 0.45 }),
    // baguettes, couvercle et toit des lanternes flottantes : bois sombre (vu par-dessous, sans liseré)
    frame: mat('#6a5444', { map: timber.map, normalMap: timber.normalMap, rough: 0.75, rim: 0 }),
    hull: tm(plankTexture('#8a5a36', 'lumi-boat', { wear: 0.7, knots: 1, seed: 31 }), { rough: 0.8, vertexColors: true }),
    core: mat('#17221f', { rough: 1, rim: 0 }),
  };
  return DM;
}
const nonIdx = (g) => (g.index ? g.toNonIndexed() : g);
const _yUp = new THREE.Vector3(0, 1, 0);
// pièce de bois équarrie (plankBox) de a à b, section t × t
function stick(a, b, t, uOff = 0) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  return plankBox(t, len, t, 1, uOff).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_yUp, d.normalize()))
    .translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}
// corde tendue de a à b avec une flèche sag (UV en mètres pour ropeTexture)
function ropeSpan(a, b, sag, r = 0.028) {
  const c = a.clone().lerp(b, 0.5);
  c.y -= sag * 2;
  const g = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, c, b), 6, r, 5, false);
  const uv = g.attributes.uv, k = a.distanceTo(b) / 0.48;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * k);
  return g.toNonIndexed();
}
// tore de corde (UV en mètres le long du tour) ; lashing : tour horizontal (ligature) de rayon R à l'altitude y
function ropeRing(R, tube, seg) {
  const g = new THREE.TorusGeometry(R, tube, 4, seg), uv = g.attributes.uv, k = (2 * Math.PI * R) / 0.48;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * k);
  return g;
}
const lashing = (R, y, tube = 0.026) => ropeRing(R, tube, Math.max(10, Math.round(R * 40))).rotateX(Math.PI / 2).translate(0, y, 0).toNonIndexed();
// rayon du tronc d'un jungleTree (même tirage que jungle.js) à l'altitude y : profil de révolution, pied en base
function treeRadius(s, scale, base) {
  let st = Math.max(1, Math.floor(s * 7919) % 2147483646);
  const Rn = () => { st = (st * 16807) % 2147483647; return (st - 1) / 2147483646; };
  const h = (9 + Rn() * 5) * scale, r = 0.9 * scale;
  const pr = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; pr.push(r * (1 + Math.pow(1 - t, 4) * 1.4) * (0.85 + 0.15 * Math.sin(t * 9))); }
  return (y) => { const t = clamp((y - base) / h, 0, 1) * 8, i = Math.min(7, Math.floor(t)); return lerp(pr[i], pr[i + 1], t - i); };
}

// Plateforme de la canopée : plancher de planches (cerné autour du tronc par un collier), solives, ceinture et
// poutres maîtresses ligaturées au tronc, contrefiches jusqu'à une frette de fer ; garde-corps de corde sur poteaux
// (ouvertures o.open : [côté, décalage depuis le milieu du côté, largeur]), lanternes-fruits aux quatre coins.
// La surface praticable reste la boîte w × 0,6 × d de dessus y.
function canopyDeck(L, M3, x, y, z, w, d, o = {}) {
  const D = deckMats();
  const R = rng((Math.floor(x * 31 + z * 17 + y * 7) & 0xffff) + 5);
  const parts = new Map();
  const put = (mt, g) => { if (!parts.has(mt)) parts.set(mt, []); parts.get(mt).push(nonIdx(g)); };
  const V3 = (a, b, c) => new THREE.Vector3(a, b, c);
  const tr = o.tree != null ? treeRadius(o.tree, 2.2, -0.8) : null;
  const rAt = (ly) => tr(y + ly);
  const rTop = tr ? Math.max(rAt(0.05), rAt(-0.6)) : 0, rh = rTop + 0.1;
  const T = 0.075, PW = 0.3, FR = 0.08;
  // solives (en travers, tous les 1,2 m environ) ; les aboutements des planches tombent sur elles
  const nj = Math.max(1, Math.ceil((d - 2 * FR) / 1.25) - 1), joists = [];
  for (let k = 1; k <= nj; k++) joists.push(-d / 2 + FR + (k * (d - 2 * FR)) / (nj + 1));
  // plancher : planches dans la longueur, coupées autour du tronc
  const n = Math.floor((w - 0.04) / PW), px0 = (-(n - 1) * PW) / 2;
  for (let i = 0; i < n; i++) {
    const px = px0 + i * PW, ax = Math.abs(px) + PW / 2;
    const ranges = tr && Math.abs(px) - PW / 2 < rh ? [[-d / 2, -(ax < rh ? Math.sqrt(rh * rh - ax * ax) : 0)], [ax < rh ? Math.sqrt(rh * rh - ax * ax) : 0, d / 2]] : [[-d / 2, d / 2]];
    for (const [a, b] of ranges) {
      if (b - a < 0.15) continue;
      const cuts = joists.filter((zj) => zj > a + 1.4 && zj < b - 1.4);
      const pieces = b - a > 4.2 && cuts.length ? [[a, cuts[(i * 2 + Math.floor(R() * 2)) % cuts.length]], [cuts[(i * 2) % cuts.length], b]] : [[a, b]];
      if (pieces.length === 2) pieces[1][0] = pieces[0][1];
      for (const [p, q] of pieces) {
        put(D.plank, plankBox(PW - 0.022, T, q - p - 0.012, 1, R() * 7).rotateZ((R() - 0.5) * 0.012).translate(px, -T / 2 - R() * 0.004, (p + q) / 2));
      }
    }
  }
  // ceinture, solives, poutres maîtresses
  for (const s of [-1, 1]) {
    put(D.timber, plankBox(w, 0.26, 0.16, 1, R()).translate(0, -T - 0.13, s * (d / 2 - FR)));
    put(D.timber, plankBox(0.16, 0.26, d - 0.32, 1, R()).translate(s * (w / 2 - FR), -T - 0.13, 0));
  }
  for (const zj of joists) put(D.timber, plankBox(w - 0.32, 0.2, 0.12, 1, R()).translate(0, -T - 0.1, zj));
  const bearers = tr ? [rAt(-0.42) + 0.13, w / 2 - 0.75] : [w / 4];
  for (const bx of bearers) for (const s of [-1, 1]) put(D.timber, plankBox(0.22, 0.28, d - 0.3, 1, R()).translate(s * bx, -T - 0.34, 0));
  // ferrures : équerres rivetées aux angles de la ceinture, boulons au bout des solives
  const riv = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const cx = sx * w / 2, cz = sz * d / 2;
      put(D.iron, new THREE.BoxGeometry(0.36, 0.2, 0.014).translate(cx - sx * 0.18, -T - 0.13, cz + sz * 0.007));
      put(D.iron, new THREE.BoxGeometry(0.014, 0.2, 0.36).translate(cx + sx * 0.007, -T - 0.13, cz - sz * 0.18));
      rivets(riv, [[cx - sx * 0.08, -T - 0.07, cz + sz * 0.014], [cx - sx * 0.27, -T - 0.19, cz + sz * 0.014]], [0, 0, sz], 0.02);
      rivets(riv, [[cx + sx * 0.014, -T - 0.07, cz - sz * 0.08], [cx + sx * 0.014, -T - 0.19, cz - sz * 0.27]], [sx, 0, 0], 0.02);
    }
    for (const zj of joists) rivets(riv, [[sx * w / 2, -T - 0.09, zj], [sx * w / 2, -T - 0.18, zj]], [sx, 0, 0], 0.022);
  }
  if (tr) {
    // collier de planches autour du tronc (couvre la coupe du plancher)
    const ri = rTop * 0.9, ro = rh + 0.17;
    put(D.timber, new THREE.LatheGeometry([new THREE.Vector2(ri, -0.1), new THREE.Vector2(ro, -0.1), new THREE.Vector2(ro + 0.02, 0.0), new THREE.Vector2(ro, 0.03), new THREE.Vector2(ri, 0.03)], 24));
    // ligatures de corde : poutres maîtresses serrées contre le tronc
    const rb = rAt(-0.42);
    for (const ly of [-0.36, -0.44, -0.52]) {
      put(D.rope, ropeRing(1, 0.03 / rb, 28).rotateX(Math.PI / 2).scale(rb + 0.27, rb, rb * 0.985).translate(0, ly, 0));
    }
    // contrefiches : des poutres extérieures jusqu'à une frette de fer sur le tronc
    const fy = -2.9 - w * 0.05, rf = rAt(fy);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const a = V3(sx * (w / 2 - 0.75), -T - 0.48, sz * (d / 2 - 1.1));
        const dir = V3(a.x, 0, a.z).normalize();
        const b = V3(dir.x * rf * 0.85, fy, dir.z * rf * 0.85);
        put(D.timber, stick(a, b, 0.15, R() * 3));
        put(D.iron, new THREE.BoxGeometry(0.3, 0.012, 0.3).translate(a.x, -T - 0.48 - 0.006, a.z));
      }
    }
    put(D.iron, new THREE.TorusGeometry(rf * 0.985, 0.05, 6, 36).rotateX(Math.PI / 2).translate(0, fy + 0.05, 0));
    put(D.iron, new THREE.TorusGeometry(rf * 0.985, 0.05, 6, 36).rotateX(Math.PI / 2).translate(0, fy - 0.2, 0));
  }
  if (o.branch) {
    // plateforme posée sur une branche : ligatures autour de la branche
    const [a, b, r] = o.branch, ax = new THREE.Vector3().subVectors(b, a).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), ax);
    for (const t of [0.78, 0.86, 0.94]) {
      const c = a.clone().lerp(b, t);
      put(D.rope, ropeRing(r * (1 - t * 0.2) + 0.02, 0.03, 16).applyQuaternion(q).translate(c.x - x, c.y - y, c.z - z));
    }
  }
  // garde-corps : poteaux, deux cordes, ligatures aux poteaux ; lanternes aux coins
  const IN = 0.15, H1 = 0.95, H2 = 0.5;
  const C = (sx, sz) => [sx * (w / 2 - IN), sz * (d / 2 - IN)];
  const SIDES = { '-z': [C(-1, -1), C(1, -1)], '+z': [C(-1, 1), C(1, 1)], '-x': [C(-1, -1), C(-1, 1)], '+x': [C(1, -1), C(1, 1)] };
  for (const [id, [A, B]] of Object.entries(SIDES)) {
    const Ls = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const at = (s) => [A[0] + (B[0] - A[0]) * s / Ls, A[1] + (B[1] - A[1]) * s / Ls];
    const ops = (o.open || []).filter((e) => e[0] === id).map(([, off, ow]) => [Ls / 2 + off - ow / 2, Ls / 2 + off + ow / 2]);
    const keys = [0, Ls];
    for (const [p, q] of ops) keys.push(clamp(p, 0, Ls), clamp(q, 0, Ls));
    keys.sort((p, q) => p - q);
    const posts = new Set();
    for (let k = 0; k < keys.length - 1; k++) {
      const a = keys[k], b = keys[k + 1];
      if (b - a < 0.2) continue;
      const open = ops.some(([p, q]) => (a + b) / 2 > p && (a + b) / 2 < q);
      if (open) continue;
      const nn = Math.max(1, Math.ceil((b - a) / 2.5));
      for (let j = 0; j < nn; j++) {
        const s0 = a + ((b - a) * j) / nn, s1 = a + ((b - a) * (j + 1)) / nn;
        const p0 = at(s0), p1 = at(s1);
        for (const hh of [H1, H2]) put(D.rope, ropeSpan(V3(p0[0], hh, p0[1]), V3(p1[0], hh, p1[1]), 0.035 * (s1 - s0)));
        posts.add(s0.toFixed(3)); posts.add(s1.toFixed(3));
        // garde-corps solide : une lame mince de poteau à poteau, du plancher à la corde du haut
        const ax = Math.abs(p1[0] - p0[0]) > Math.abs(p1[1] - p0[1]), hl = (s1 - s0) / 2 + 0.07;
        L.game.world.add(new BoxCollider(V(x + (p0[0] + p1[0]) / 2, y + 0.5, z + (p0[1] + p1[1]) / 2), ax ? V(hl, 0.5, 0.07) : V(0.07, 0.5, hl), null, { surface: 'wood' }));
      }
    }
    for (const sk of posts) {
      const s = +sk;
      const [qx, qz] = at(s);
      for (const hh of [H1, H2]) put(D.rope, lashing(0.09, hh).translate(qx, 0, qz));
      if (s < 0.01 || s > Ls - 0.01) continue; // poteau d'angle : la lanterne
      put(D.timber, plankBox(0.13, 1.33, 0.13, 1, R() * 5).translate(qx, 1.0 - 1.33 / 2, qz));
      put(D.timber, new THREE.ConeGeometry(0.095, 0.07, 4).rotateY(Math.PI / 4).translate(qx, 1.035, qz));
    }
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const [qx, qz] = C(sx, sz);
    put(D.timber, plankBox(0.16, 1.35, 0.16, 1, R() * 5).translate(qx, 1.02 - 1.35 / 2, qz));
    // poteau d'angle solide jusqu'à la coupelle (la cage de la lanterne reste traversable : pas de perchoir plus haut que la corde)
    L.game.world.add(new CylinderCollider(x + qx, z + qz, y, y + 1.0, 0.11, { surface: 'wood' }));
    put(D.iron, new THREE.CylinderGeometry(0.15, 0.09, 0.08, 8).translate(qx, 1.06, qz));
    put(M3.fruitGlow, new THREE.SphereGeometry(0.16, 12, 8).translate(qx, 1.22, qz));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      put(D.iron, new THREE.BoxGeometry(0.022, 0.32, 0.014).rotateY(a).translate(qx + Math.sin(a) * 0.168, 1.24, qz + Math.cos(a) * 0.168));
    }
    put(D.iron, new THREE.CylinderGeometry(0.03, 0.13, 0.07, 8).translate(qx, 1.41, qz));
    put(D.iron, new THREE.TorusGeometry(0.035, 0.009, 4, 10).translate(qx, 1.48, qz));
  }
  put(D.iron, mergeGeometries(riv));
  // lianes qui pendent de la ceinture, devant et derrière : leur haut est pris dans la poutre de ceinture (rideau
  // raccourci s'il dépasserait du bout de la ceinture)
  for (const sz of [-1, 1]) {
    const vx = (R() - 0.5) * w * 0.6, vw = Math.min(1 + R() * 0.8, w - 0.8 - 2 * Math.abs(vx));
    vines(L, V(x + vx, y - 0.3, z + sz * (d / 2 - 0.08)), vw, 1.2 + R() * 1.2, Math.floor(R() * 99), { dz: [-0.04, 0.04], up: 0.1 });
  }
  const M = new THREE.Matrix4().makeTranslation(x, y, z);
  for (const [mt, list] of parts) {
    const g = mergeGeometries(list);
    for (const p of list) p.dispose();
    L.add(g, mt, M);
  }
  // (au coin d'une lanterne : le tronc occupe le centre)
  lights.add({ pos: V(x - (w / 2 - IN), y + 1.4, z + (d / 2 - IN)), color: '#ffb84a', intensity: 18, range: 10, flicker: 0.06, priority: 1.5 });
  L.box(V(x, y - 0.3, z), V(w, 0.6, d), null, { surface: 'wood' });
}

// Mur des ruines (52 × 6,5 × 3,5 m, front à z = 35) : parement en assises inégales de pierres taillées décalées,
// bombées et de teintes variées, joints profonds sur un noyau sombre, chaperon de dalles au ras du dessus praticable,
// brèches dans le parement (gravats et mousse dans le creux), éboulis de pierres tombées sur le talus du pied, mousse
// qui retombe du chaperon. Même boîte de collision.
function ruinWall(L, M3) {
  const D = deckMats();
  const R = rng(3675);
  const X0 = -26, X1 = 21, YB = -1, YT = 5.5, ZF = 35, ZB = 38.5, COP = 0.4, GAP = 0.05;
  const stones = [], core = [], moss = [];
  const ground = (x, z) => (L.heightfield ? L.heightfield.height(x, z) : 0);
  core.push(new THREE.BoxGeometry(X1 - X0, YT - COP - YB, ZB - ZF - 0.5).toNonIndexed().translate((X0 + X1) / 2, (YB + YT - COP) / 2, (ZF + 0.5 + ZB) / 2));
  // brèches : [x, y, demi-largeur, demi-hauteur] (au-dessus du talus de terre qui couvre le pied du mur)
  const BR = [[-15, 3.6, 1.0, 0.7], [0, 2.75, 1.1, 0.55], [-21.5, 3.9, 1.1, 0.75], [15.2, 4.2, 0.7, 0.5]];
  const ledge = BR.map(() => Infinity);
  // pierre : boîte arrondie, face avant bombée (vers -z), teinte propre et pied assombri (couleurs de sommet)
  const stone = (w, h, dd, r, o = {}) => {
    const g = new RoundedBoxGeometry(w, h, dd, 1, Math.min(r, w * 0.3, h * 0.3, dd * 0.3));
    const p = g.attributes.position, n = p.count;
    if (o.bulge) for (let i = 0; i < n; i++) if (p.getZ(i) < -dd / 2 + 1e-4) p.setZ(i, p.getZ(i) - o.bulge);
    const k = o.k ?? 0.8 + R() * 0.32, gr = o.green ?? (R() < 0.18 ? 0.08 + R() * 0.1 : 0), cool = (R() - 0.5) * 0.08;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const t = (p.getY(i) + h / 2) / h, s = k * (0.8 + 0.2 * Math.min(1, t * 2.5));
      col[i * 3] = s * (1 - gr - cool * 0.5); col[i * 3 + 1] = s * (1 + gr * 0.4); col[i * 3 + 2] = s * (1 - gr * 0.5 + cool);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  };
  // moellon irrégulier (dodécaèdre écrasé) : blocage du noyau, éboulis
  const rubble = (s, k) => {
    const g = new THREE.DodecahedronGeometry(1, 0).scale(s * (0.8 + R() * 0.6), s * (0.6 + R() * 0.4), s * (0.7 + R() * 0.5));
    g.rotateY(R() * 3).rotateX((R() - 0.5) * 0.8);
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = k * 0.97; col[i * 3 + 1] = k; col[i * 3 + 2] = k * 0.98; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  };
  const tint = (g, k) => {
    const n = g.attributes.position.count;
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(k), 3));
    return g;
  };
  const bars = [-20, -14, -2, 2, 14, 20], pil = [-12, -4, 4, 12];
  // assises de hauteurs inégales
  const hs = [];
  for (let k = 0; k < 7; k++) hs.push(0.72 + R() * 0.36);
  const sum = hs.reduce((a, b) => a + b, 0);
  let ya = YB;
  for (let k = 0; k < hs.length; k++) {
    const ch = (hs[k] * (YT - COP - YB)) / sum, yb = ya + ch;
    let a = X0, first = true;
    while (a < X1 - 0.05) {
      let len = (first && k % 2 ? 0.55 : 1) * (0.9 + R() * 1.3);
      if (X1 - a - len < 0.5) len = X1 - a;
      first = false;
      const mid = a + len / 2, ym = (ya + yb) / 2;
      let q = Infinity, bi = -1;
      BR.forEach(([bx, by, rx, ry], i) => { const e = ((mid - bx) / (rx + len * 0.3)) ** 2 + ((ym - by) / ry) ** 2; if (e < q) { q = e; bi = i; } });
      if (q < 1) { ledge[bi] = Math.min(ledge[bi], ya); a += len; continue; }
      const worn = q < 1.9 || R() < 0.1;
      const depth = 0.55;
      const front = worn ? ZF + 0.03 + R() * 0.06 : ZF + 0.01 - R() * 0.05;
      const g = stone(len - GAP, ch - GAP, depth, worn ? 0.16 : 0.09 + R() * 0.04, { bulge: worn ? 0 : 0.02 + R() * 0.03, k: worn ? 0.7 + R() * 0.15 : undefined });
      const j = worn ? 3 : 1;
      g.rotateY((R() - 0.5) * 0.03 * j).rotateX((R() - 0.5) * 0.02 * j).rotateZ((R() - 0.5) * 0.012 * j);
      stones.push(g.translate(mid, ym, front + depth / 2));
      a += len;
    }
    ya = yb;
  }
  // chaperon : dalles sur toute l'épaisseur, dessus au ras de la boîte, léger débord en façade
  let a = X0;
  while (a < X1 - 0.05) {
    let len = 1.2 + R() * 1.1;
    if (X1 - a - len < 0.6) len = X1 - a;
    const fr = ZF - 0.1 + R() * 0.06, h = COP - 0.03;
    const g = stone(len - 0.04, h, ZB - fr, 0.06, { k: 0.85 + R() * 0.2, green: 0.1 + R() * 0.1 });
    g.rotateZ((R() - 0.5) * 0.008).rotateX((R() - 0.5) * 0.006);
    stones.push(g.translate(a + len / 2, YT - h / 2, (fr + ZB) / 2));
    a += len;
  }
  // mousse qui retombe du chaperon par touffes irrégulières, coussins sur le bord
  const drape = (mx, my, mz, w, h) => tint(new THREE.SphereGeometry(1, 9, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).toNonIndexed().scale(w, h, 0.07), 1).translate(mx, my, mz);
  const cushion = (mx, my, mz, w, d) => tint(new THREE.SphereGeometry(1, 9, 4, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed().scale(w, 0.07, d), 1).translate(mx, my, mz);
  for (let k = 0; k < 12; k++) {
    const mx = lerp(-24, 18, (k + R() * 0.8) / 12);
    if (pil.some((p) => Math.abs(mx - p) < 1.1)) continue;
    const nb = 2 + Math.floor(R() * 3);
    for (let b = 0; b < nb; b++) {
      const w = 0.16 + R() * 0.3;
      moss.push(drape(mx + (R() - 0.5) * 1.1, YT - 0.06, ZF - 0.1 - R() * 0.02, w, 0.25 + R() * (b === 0 ? 0.9 : 0.45)));
    }
    moss.push(cushion(mx + (R() - 0.5) * 0.4, YT - 0.02, ZF + 0.1, 0.4 + R() * 0.5, 0.25));
  }
  // brèches : blocage de moellons sombres au fond du creux, gravats et mousse sur le rebord
  BR.forEach(([bx, by, rx, ry], i) => {
    const ly = Number.isFinite(ledge[i]) ? ledge[i] : by;
    for (let u = -rx - 0.3; u <= rx + 0.3; u += 0.3) {
      for (let v = ly; v <= by + ry + 0.5; v += 0.26) {
        stones.push(rubble(0.15 + R() * 0.07, 0.42 + R() * 0.2).translate(bx + u + (R() - 0.5) * 0.12, v + (R() - 0.5) * 0.08, ZF + 0.5 + R() * 0.06));
      }
    }
    for (let k = 0; k < 5; k++) {
      const s = 0.16 + R() * 0.2;
      const g = stone(s * (1 + R()), s, s * (0.8 + R() * 0.6), 0.05, { k: 0.65 + R() * 0.25 });
      g.rotateY(R() * 3).rotateZ((R() - 0.5) * 0.6).rotateX((R() - 0.5) * 0.5);
      stones.push(g.translate(bx + (R() - 0.5) * rx * 1.3, ly + s * 0.4, ZF + 0.15 + R() * 0.3));
    }
    moss.push(cushion(bx, ly, ZF + 0.12, rx * 0.6, 0.22));
    moss.push(drape(bx + (R() - 0.5) * rx, ly - 0.02, ZF + 0.02, 0.2 + R() * 0.2, 0.3 + R() * 0.3));
  });
  // éboulis au pied : pierres tombées au bas du talus de terre, solides ; aucune ne dépasse la hauteur où Kobi tient déjà
  // debout contre le mur (sa sphère de 0,36 m posée sur le talus raide touche le sol 0,3 m en aval de son centre,
  // pieds 0,15 m plus bas) : pas de marche plus haute qu'avant
  const top = (fx) => Math.min(...[-0.6, 0, 0.6].map((o) => ground(fx + o, ZF - 0.65))) - 0.15;
  const sink = (g, fx) => { g.computeBoundingBox(); const bb = g.boundingBox, dy = Math.max(0, bb.max.y - top(fx)); g.translate(0, -dy, 0); bb.min.y -= dy; bb.max.y -= dy; return bb; };
  for (let k = 0; k < 46; k++) {
    const fx = lerp(-22.5, 15.5, R());
    if (pil.some((p) => Math.abs(fx - p) < 1.0) || bars.some((p) => Math.abs(fx - p) < 0.45)) continue;
    const near = BR.some(([bx, , rx]) => Math.abs(fx - bx) < rx * 1.6);
    const fz = 33.45 + R() * 0.85, s = near ? 1.2 : 0.8;
    const w = (0.35 + R() * 0.55) * s, h = (0.2 + R() * 0.2) * s, dd = (0.3 + R() * 0.3) * s;
    if (R() < 0.45) {
      const g = rubble(h * 0.9, 0.6 + R() * 0.3).translate(fx, ground(fx, fz) + h * 0.2, fz);
      const bb = sink(g, fx);
      stones.push(g);
      L.game.world.add(new CylinderCollider(fx, fz, bb.min.y, bb.max.y - 0.02, Math.min(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.4, { surface: 'rock' }));
      continue;
    }
    const g = stone(w, h, dd, 0.07, { k: 0.7 + R() * 0.3 });
    const ry = R() * 3, rz = (R() - 0.5) * 0.4, rx = -0.2 + (R() - 0.5) * 0.3;
    g.rotateY(ry).rotateZ(rz).rotateX(rx);
    g.translate(fx, ground(fx, fz) - h * 0.1, fz);
    const bb = sink(g, fx), cy = (bb.min.y + bb.max.y) / 2;
    stones.push(g);
    // boîte orientée comme la pierre (rotations Y, puis Z, puis X), un peu rentrée pour les arêtes arrondies
    const q = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), rx).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), rz)).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), ry));
    L.game.world.add(new BoxCollider(V(fx, cy, fz), V(w * 0.45, h * 0.44, dd * 0.45), q, { surface: 'rock' }));
  }
  L.add(mergeGeometries(stones), M3.jRock);
  L.add(mergeGeometries(core), D.core);
  L.add(mergeGeometries(moss), M3.moss);
  for (const l of [stones, core, moss]) for (const g of l) g.dispose();
  L.box(V(0, 2.25, 36.75), V(52, 6.5, 3.5), null, { surface: 'rock' });
}

// Lanterne flottante : baquet de douelles cerclé de fer riveté, banc et socle ; lanterne de papier tendu sur huit
// baguettes et trois cerces, couvercle, toit de planches à arêtiers, pommeau et anneau. Géométries partagées.
let FL = null;
function floatLanternKit() {
  if (FL) return FL;
  const D = deckMats();
  const R = rng(4111);
  const hull = [], frame = [], iron = [], riv = [];
  const N = 16, RB = 0.38, RT = 0.5, H0 = -0.1, H1 = 0.17, HH = H1 - H0, tilt = Math.atan2(RT - RB, HH);
  for (let k = 0; k < N; k++) {
    const a = ((k + 0.5) / N) * Math.PI * 2, rm = (RB + RT) / 2;
    hull.push(plankBox((2 * Math.PI * rm) / N - 0.008, HH / Math.cos(tilt), 0.035, 1, R() * 5).rotateX(tilt).translate(0, (H0 + H1) / 2, rm).rotateY(a));
  }
  // pont de planches au-dessus de la ligne de flottaison (l'eau ne monte pas dans le baquet)
  const FY = 0.09, FR = RB + ((FY - H0) / HH) * (RT - RB) - 0.01;
  for (const pz of [-0.38, -0.19, 0, 0.19, 0.38]) hull.push(plankBox(2 * Math.sqrt(Math.max(0.01, FR * FR - pz * pz)), 0.03, 0.18, 1, R() * 5).translate(0, FY - 0.015, pz));
  hull.push(nonIdx(new THREE.TorusGeometry(RT + 0.004, 0.022, 5, 32)).rotateX(Math.PI / 2).translate(0, H1, 0));
  hull.push(plankBox(0.34, 0.05, 0.34, 1, 0.7).translate(0, FY + 0.025, 0));
  for (const y of [-0.02, 0.11]) {
    const r = RB + ((y - H0) / HH) * (RT - RB) + 0.02;
    iron.push(nonIdx(new THREE.TorusGeometry(r, 0.014, 4, 32)).rotateX(Math.PI / 2).translate(0, y, 0));
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + y * 9; rivets(riv, [[Math.sin(a) * (r + 0.012), y, Math.cos(a) * (r + 0.012)]], [Math.sin(a), 0, Math.cos(a)], 0.012); }
  }
  // papier tendu (profil un peu bombé, plus large en bas) : UV x × 8 = un pan entre deux baguettes
  const P = [[0.235, 0.14], [0.25, 0.25], [0.257, 0.37], [0.245, 0.49], [0.205, 0.6]];
  const paper = nonIdx(new THREE.LatheGeometry(P.map(([r, yy]) => new THREE.Vector2(r, yy)), 16));
  const puv = paper.attributes.uv;
  for (let i = 0; i < puv.count; i++) puv.setX(i, puv.getX(i) * 8);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2, sx = Math.sin(a), sz = Math.cos(a);
    for (let j = 0; j < P.length - 1; j++) {
      const [r0, y0] = P[j], [r1, y1] = P[j + 1];
      frame.push(stick(new THREE.Vector3(sx * (r0 + 0.008), y0, sz * (r0 + 0.008)), new THREE.Vector3(sx * (r1 + 0.008), y1, sz * (r1 + 0.008)), 0.018, k));
    }
  }
  for (const [r, yy, t] of [[0.24, 0.14, 0.016], [0.262, 0.37, 0.01], [0.21, 0.6, 0.016]]) frame.push(nonIdx(new THREE.TorusGeometry(r, t, 4, 20)).rotateX(Math.PI / 2).translate(0, yy, 0));
  frame.push(nonIdx(new THREE.CylinderGeometry(0.13, 0.215, 0.05, 8)).translate(0, 0.625, 0));
  // toit : huit planches rayonnantes (fil le long de la pente), arêtiers, sous-face
  const roof = nonIdx(new THREE.ConeGeometry(0.37, 0.2, 8, 1, true));
  const ruv = roof.attributes.uv;
  for (let i = 0; i < ruv.count; i++) { const u = ruv.getX(i), v = ruv.getY(i); ruv.setXY(i, v * 0.45, u * 8); }
  frame.push(roof.translate(0, 0.75, 0));
  frame.push(nonIdx(new THREE.CircleGeometry(0.37, 8)).rotateX(Math.PI / 2).translate(0, 0.651, 0));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    frame.push(stick(new THREE.Vector3(0, 0.85, 0), new THREE.Vector3(Math.sin(a) * 0.385, 0.64, Math.cos(a) * 0.385), 0.024, k));
  }
  iron.push(nonIdx(new THREE.SphereGeometry(0.04, 8, 6)).translate(0, 0.87, 0));
  iron.push(nonIdx(new THREE.TorusGeometry(0.035, 0.009, 4, 10)).translate(0, 0.94, 0));
  iron.push(...riv);
  const hullG = grime(mergeGeometries(hull), H0, H1 + 0.02, 0.45, '#24382e');
  const pm = PAPER_COLORS.map((c) => {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2.6), map: paperTexture().map, toneMapped: true });
    m.userData.shared = true;
    m.userData.isGlow = true;
    return m;
  });
  FL = { hull: hullG, frame: mergeGeometries(frame), iron: mergeGeometries(iron), paper, D, pm };
  for (const k of ['hull', 'frame', 'iron', 'paper']) FL[k].userData.shared = true;
  return FL;
}
const PAPER_COLORS = ['#ffc46a', '#ff8ad8', '#7affd0'];

export default {
  id: 'luminbois',
  name: 'Luminbois',
  subtitle: 'La Jungle des Lucioles',
  orb: 'radial-gradient(circle at 35% 30%, #c8ffe8, #2fa07a 40%, #14284a 90%)',
  mapPos: [68, 40],
  music: 'luminbois',
  build(L, g) {
    const props = g.props;
    const R = rng(777);
    const M3 = jungleMats();
    // le Propulseur est indispensable ici (il s'obtient à la fin de Givrelune)
    if (!g.hasGadget('propulseur')) (g.data.gadgets = g.data.gadgets || []).push('propulseur');
    L.environment({
      // nuit au clair de lune bleuté : ciel indigo, lune et planète au-dessus de la canopée
      skyTop: '#02061a', skyHorizon: '#103a5e', skyBottom: '#061a26', sunDir: [-0.3, 0.6, -0.74], sunColor: '#9cc6ff',
      clouds: 0.25, cloudColor: '#24406a', cloudHeight: 0.2, stars: 1.0, nebula: 0.75, nebulaA: '#ff4fd8', nebulaB: '#3affd0',
      planetDir: [0.35, 0.3, 0.89], planetSize: 0.11, planetA: '#2f8a7a', planetB: '#c8ffe8',
      moonDir: [-0.45, 0.42, 0.79], moonSize: 0.05, moonColor: '#e8fff4',
      fogColor: '#0a2238', fogNear: 30, fogFar: 260, fogBase: -8, fogFall: 0.12, fogHeight: 0.7, fogSun: 0.25, fogSunColor: '#7ab4ff',
      hemiSky: '#2c5a9a', hemiGround: '#14402e', hemiIntensity: 0.95, envGround: '#12303a', fill: 0.45, fillColor: '#9cc0ff',
      sunIntensity: 1.9, envIntensity: 0.65, glare: 0, rays: 0.15, rimColor: '#8ad4ff', rimStrength: 0.75, dust: '#5a8a6a', bloom: 0.85, exposure: 1.15, saturation: 1.12,
      grade: { shadows: '#1a3a8a', highlights: '#ffb0d0', amount: 0.24, contrast: 0.24 },
      // brume de sous-bois : rais de lune entre les troncs, halos des lanternes et des champignons
      volumetric: { density: 0.022, floor: 0.35, sun: 1.0, anisotropy: 0.55, extinction: 0.6, ambient: '#183a6a', ambientAmount: 0.4, lights: 2.0 },
    });
    // lumières locales : nuit : les lanternes et la flore lumineuse éclairent vraiment
    lights.gain = 1.0;
    L.killY = -5;
    L.ambient = 'forest';
    // grenouilles et insectes nocturnes
    L.every((dt) => { if (g.state === 'playing' && Math.random() < dt * 0.35) g.audio.play('bird', { pitch: 0.35 + Math.random() * 0.3, vol: 0.6, pos: g.camera.cam.position.clone().add(V(rand(-30, 30), 2, rand(-30, 30))) }); });
    const moss = mossTexture();
    const jR = rockTexture('jungle');
    L.terrain({
      x0: -320, z0: -130, size: 640, res: 320, height, surface: 'grass',
      mapA: moss.map, mapB: jR.map, normalA: moss.normalMap, normalB: jR.normalMap, scaleA: 0.16, scaleB: 0.07, slopeLo: 0.62, slopeHi: 0.8,
      color: (x, z, h) => {
        const n = fbm2(x * 0.08, z * 0.08, 2, 41);
        let k = 0.8 + n * 0.25;
        if (h < 0) k *= 0.6 + clamp((h + 12) / 12, 0, 1) * 0.4;
        // taches de mousse violette et de lichen doré
        const v = smooth(clamp((fbm2(x * 0.035, z * 0.035, 3, 77) - 0.52) * 6, 0, 1));
        const o = smooth(clamp((fbm2(x * 0.05 + 9, z * 0.05, 2, 13) - 0.6) * 6, 0, 1)) * 0.5;
        return [k * (0.85 + v * 0.25 + o * 0.3), k * (1.0 - v * 0.25 + o * 0.05), k * (0.95 + v * 0.2 - o * 0.3)];
      },
    });
    const H = (x, z) => height(x, z);
    const at = (x, z, dy = 0) => V(x, H(x, z) + dy, z);
    // caisse posée sur le terrain réel (maillage) : dessous au point le plus bas du sol sous elle (coins compris, quelle
    // que soit sa rotation) ; en pente douce, le coin d'amont entre de quelques centimètres dans le sol. rotY : pour
    // deux caisses côte à côte à moins de 1,41 m, faces parallèles (tournées au hasard, elles s'interpénétraient)
    const crate = (x, z, type, rotY) => {
      let y = Infinity;
      for (let i = 0; i < 16; i++) for (const r of [0, 0.5, 0.71]) y = Math.min(y, L.heightfield.height(x + Math.cos(i * 0.3927) * r, z + Math.sin(i * 0.3927) * r));
      return props.crate(V(x, y - 0.01, z), type, rotY);
    };
    const spawnGroup = (list) => list.forEach(([type, x, z, o, y]) => g.enemies.spawn(type, V(x, y ?? H(x, z), z), o || {}));
    const UP = V(0, 1, 0);
    // poutre (branche, liane épaisse) entre deux points
    const beam = (a, b, r, m) => {
      const d = b.clone().sub(a);
      const q = new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize());
      L.add(G.cyl(r * 0.8, r, d.length(), 8), m, new THREE.Matrix4().compose(a.clone().lerp(b, 0.5), q, V(1, 1, 1)));
    };
    // accroche de lianes sous une poutre a → b (rayon r au pied a, 0,8 r au bout b) : le haut de chaque liane entre
    // dans le dessous de la poutre, à l'aplomb de son axe (z0 : z de référence du rideau)
    const under = (a, b, r, z0) => (x, z) => {
      const t = clamp((x - a.x) / (b.x - a.x), 0, 1), p = a.clone().lerp(b, t);
      return [p.y - r * (1 - 0.2 * t) * 0.4, p.z + z - z0];
    };
    const PLANT_AVOID = [];
    // maisons sur pilotis du village : x, z, et sens dans lequel y écarter un arbre (rotation en radians du recul,
    // pour ne pas le coller à un arbre voisin)
    const HOUSES = [[12, 186, 0.7], [-14, 210, 0], [13, 214, 0]];
    // décor de sous-bois : arbres géants contre les parois, fougères, fleurs, champignons
    const scatter = (z0, z1, n, trees = true) => {
      for (let i = 0; i < n; i++) {
        const z = lerp(z0, z1, R());
        let best = null;
        for (let k = 0; k < 8 && best === null; k++) {
          const x = lerp(-40, 45, R());
          const dd = distToPolyline(x, z, PATH).d;
          const hw = prof(z, HW);
          if (dd > hw - 6 && dd < hw + 1 && !PLANT_AVOID.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar)) best = x;
        }
        if (best === null) continue;
        let p = at(best, z);
        const t = R();
        if (trees && t < 0.35) {
          const sc = 0.9 + R() * 0.6;
          // un tronc tiré dans une maison sur pilotis du village (plancher, pilotis, toit) en est écarté
          for (const [hx, hz, turn] of HOUSES) {
            const dx = p.x - hx, dz = p.z - hz, dd = Math.hypot(dx, dz), need = 2.95 + 1.55 * sc;
            if (dd < need) {
              const a = Math.atan2(dz, dx) + turn;
              p = at(hx + Math.cos(a) * need, hz + Math.sin(a) * need);
            }
          }
          jungleTree(L, p, sc, Math.floor(R() * 40));
        }
        else if (t < 0.55) giantMushroom(L, p, 0.6 + R() * 0.6, ['#c86aff', '#ff6ad8', '#6ad8ff', '#ffd23a'][Math.floor(R() * 4)]);
        else if (t < 0.8) fern(L, p, 1 + R() * 0.8, Math.floor(R() * 99));
        else glowFlower(L, p, 1 + R() * 0.8, ['pink', 'gold', 'spore'][Math.floor(R() * 3)]);
      }
    };
    // touffes : fougères et fleurs au milieu du chemin
    const tuft = (x, z, n = 3) => {
      for (let i = 0; i < n; i++) {
        const xx = x + rand(-1.5, 1.5), zz = z + rand(-1.5, 1.5);
        if (i % 2) glowFlower(L, at(xx, zz), 0.8 + Math.random() * 0.6, ['pink', 'gold', 'spore'][i % 3]);
        else fern(L, at(xx, zz), 0.8 + Math.random() * 0.5, Math.floor(Math.random() * 99));
      }
    };

    // ------------------------------------------------ A. La clairière d'arrivée
    L.checkpoint = { pos: V(0, H(0, -4) + 0.2, -4), yaw: 0 };
    const ship = kobiShip(L.root, { ground: (x, z) => L.heightfield.height(x, z) });
    ship.position.set(-8, H(-8, -12), -12);
    ship.rotation.y = 0.5;
    L.box(V(-8, H(-8, -12) + 1.6, -12), V(2.6, 3, 6), null, { ry: 0.5, surface: 'metal' });
    L.titleShot = () => {};
    jungleTree(L, at(12, 2), 1.3, 7);
    jungleTree(L, at(-13, 22), 1.2, 12);
    giantMushroom(L, at(8, 14), 0.9, '#6ad8ff');
    giantMushroom(L, at(-6, 6), 0.6, '#ff6ad8');
    tuft(4, 4); tuft(-4, 18); tuft(9, 26); tuft(-9, -2);
    props.sign(at(-3, 6), 0.3, 'LUMINBOIS\nVILLAGE DES LUCIOLES ↑', 3.2, 1.3, SIGN);
    crate(5, 10, 'bolt', -0.39);
    crate(6.2, 10.5, 'bolt', -0.41);
    crate(-7, 14, 'ammo');
    crate(3, 22, 'bolt');
    // mur des ruines : 5,5 m, il faut le Propulseur
    ruinWall(L, M3);
    for (const x of [-12, -4, 4, 12]) ruinBlock(L, V(x, 0, 34.2), V(1.6, 7, 1.6), { glyph: x === -4 || x === 4 });
    // glyphes lumineux gravés dans le mur : même nu en façade qu'avant, mais assez profonds pour entrer dans les pierres
    // en retrait (usées) et dans les joints
    for (const [x, y, r] of [[-8, 3.2, 0.7], [8, 3.4, 0.8], [0, 4.2, 0.6], [-17, 2.6, 0.5], [17, 2.8, 0.6]]) {
      L.add(G.torus(r, 0.06, 6, 24), M3.sporeGlow, mtx([x, y, 34.98], [0, 0, 0], [1, 1, 2]));
      L.add(G.box(r * 1.4, 0.08, 0.2), M3.sporeGlow, mtx([x, y, 35.005]));
    }
    for (const x of [-20, -14, -2, 2, 14, 20]) L.add(G.box(0.08, 1.6, 0.2), M3.flowerGlow, mtx([x, 1.6, 35.01]));
    lights.add({ line: [V(-17, 3.2, 35.8), V(17, 3.2, 35.8)], color: '#7affc8', intensity: 16, range: 7, priority: 1.2 });
    // lianes plaquées contre le parement, le haut pris sous le chaperon
    vines(L, V(-8, 5.45, 34.95), 4, 3.5, 3, { dz: [-0.03, 0], up: 0.03 });
    vines(L, V(8, 5.45, 34.95), 5, 4, 5, { dz: [-0.03, 0], up: 0.03 });
    for (let i = 0; i < 4; i++) g.pickups.placeBolt(V(0, 1.5 + i * 1.4, 33.6), 5);
    L.trigger({
      box: [[-25, -5, 24], [25, 20, 28]],
      fn: () => g.hud.say([['ecrou', 'Un mur trop haut pour un double saut… C’est le moment d’essayer le Propulseur de Morsillon : double saut, puis appuie encore sur ' + g.input.actionLabel('jump') + ' !']], true),
    });
    // réserve scellée (Magnéto-clé, gagnée à la fin de la planète)
    const VY = H(-15, 14);
    ruinBlock(L, V(-18.4, VY, 14), V(1, 5, 7));
    for (const z of [10.8, 17.2]) ruinBlock(L, V(-15.6, VY, z), V(6.6, 5, 0.8));
    ruinBlock(L, V(-15.6, VY + 5, 14), V(7.2, 0.6, 7.2));
    props.magDoor(V(-12.4, VY, 14), Math.PI / 2, 4, 4);
    props.orbium(V(-15.8, VY, 14), 3, 3);
    PLANT_AVOID.push([-15, 14, 6]);
    L.trigger({
      sphere: [[-9, VY, 14], 4.5],
      fn: () => g.hud.say([['ecrou', g.hasGadget('magneto')
        ? 'Le verrou magnétique ! Un coup de Magnéto-clé et la réserve est à nous.'
        : 'Une porte à verrou magnétique… Il faudra revenir avec le bon outil.']]),
    });

    // ------------------------------------------------ B. La terrasse des ruines
    const TY = 5.5;
    ruinBlock(L, V(-7, TY, 52), V(4, 1.6, 3), { glyph: true });
    ruinBlock(L, V(6, TY, 58), V(3, 2.4, 3), { ry: 0.4 });
    ruinBlock(L, V(-3, TY, 74), V(5, 1.2, 2), { ry: -0.2 });
    ruinBlock(L, V(9, TY, 84), V(2.5, 3, 2.5), { glyph: true });
    ruinBlock(L, V(-9, TY, 92), V(3, 2, 3), { ry: 0.6 });
    for (const [x, z, h] of [[-12, 46, 6], [12, 66, 4.5], [-13, 80, 7], [13, 100, 5]]) ruinBlock(L, V(x, TY, z), V(1.4, h, 1.4));
    // arche effondrée
    ruinBlock(L, V(-5, TY, 88), V(1.6, 6, 1.6));
    ruinBlock(L, V(5, TY, 88), V(1.6, 6, 1.6));
    ruinBlock(L, V(0, TY + 6, 88), V(12, 1.2, 2), { glyph: true });
    vines(L, V(0, TY + 6, 88.8), 8, 3, 9, { dz: [-0.12, 0.12], up: 0.15 });
    tuft(-2, 48); tuft(4, 70); tuft(-6, 82); tuft(2, 100);
    crate(2, 50, 'ammo');
    crate(-9, 66, 'bolt');
    crate(-8, 67.2, 'bolt');
    crate(7, 92, 'boom');
    crate(-4, 104, 'health');
    for (let i = 0; i < 5; i++) g.pickups.placeBolt(V(lerp(-2, 2, i / 4), TY + 1, 42 + i * 3), 5);
    L.trigger({
      box: [[-25, 0, 44], [25, 20, 48]],
      fn: () => {
        spawnGroup([['champi', -6, 64], ['champi', 8, 70], ['grignoteur', 0, 58], ['grignoteur', 3, 64], ['grignoteur', -3, 67]]);
        g.hud.say([['ecrou', 'Des Champi-cracheurs ! Ils se cachent dans le sol : tire quand ils sortent la tête, et évite leurs nuages de spores.']], true);
      },
    });
    L.trigger({
      box: [[-25, 0, 76], [25, 20, 80]],
      fn: () => {
        spawnGroup([['larbin', 2, 94], ['larbin', -6, 98], ['phaseur', 4, 100]]);
        g.hud.say([['ecrou', 'Un Phaseur ! Il se téléporte autour de toi entre deux salves : reste en mouvement.']], true);
      },
    });
    props.checkpoint(V(-8, TY, 104), 0);
    props.sign(V(6, TY, 108), -0.3, 'RIVIÈRE AUX LUCIOLES\nBAIGNADE INTERDITE', 3.4, 1.3, SIGN);

    // ------------------------------------------------ C. La rivière
    // courant vers l'est qui contourne les piliers (sillages d'écume), plancton qui s'allume dans les ondes ;
    // lanternes flottantes, lanternes des berges et lune s'y reflètent
    const river = water(L, -40, 111, 80, 58, -4, {
      preset: 'nuit', flow: [0.85, 0.06], glowAmount: 1.8, glow: '#3affd0',
      shallow: '#5ae8d0', deep: '#021c26', absorb: [0.55, 0.12, 0.1], turbidity: 0.1,
      obstacles: [[2, 117, 1.9], [-2.5, 123.5, 1.9], [2.5, 130, 1.9], [-2, 156, 4.2], [8.5, 149, 1.9]],
    }).userData.water;
    // bioluminescence : plancton sous la surface, lueur cyan qui éclaire piliers et berges, lucioles au ras de l'eau
    planktonBed(L, river, { depth: 0.5, amount: 1.7, mix: [0.09, 0.6, 0.35, 1.8] });
    lights.add({ pos: V(0, -2.6, 140), area: [56, 52], color: '#2affc0', intensity: 18, range: 10, decay: 1.2, priority: 1.4 });
    fireflies(L, [-22, -3.5, 112, 44, 5, 56], { count: 140 });
    waterFloaters(L, river, {
      count: 8, region: [-24, 112, 48, 56], lift: -0.06,
      make: (i) => {
        const K = floatLanternKit();
        const b = new THREE.Group();
        b.add(new THREE.Mesh(K.hull, K.D.hull), new THREE.Mesh(K.frame, K.D.frame), new THREE.Mesh(K.iron, K.D.iron), new THREE.Mesh(K.paper, K.pm[i % 3]));
        b.scale.setScalar(1.15);
        return b;
      },
      lamp: (i) => [PAPER_COLORS[i % 3], 1.3, 0.45],
    });
    for (const [x, z] of [[-14, 109.5], [14, 109.5], [-12, 171.5], [12, 171.5]]) {
      lantern(L, at(x, z));
      river.addLamp(at(x, z, 2.7), '#ffc87a', 1.6);
    }
    // une source jaillit de la falaise ouest et tombe dans la rivière
    // et une seconde, plus fine, sur la paroi est ; eau chargée de plancton : rideaux teintés de cyan, pied lumineux
    for (const f of [
      createWaterfall(L, { from: [-28.5, H(-28.5, 141) + 0.2, 141], to: -4, width: 3.4, dir: Math.PI / 2, speed: 2.2, pool: river, tint: '#8afce8' }),
      createWaterfall(L, { from: [33, H(33, 124) + 0.2, 124], to: -4, width: 2.4, dir: -Math.PI / 2, speed: 1.9, pool: river, tint: '#8afce8' }),
    ]) {
      f.group.children.forEach((m) => { if (m.material.uniforms.uShade) m.material.uniforms.uShade.value *= 1.7; });
      lights.add({ pos: f.foot.clone().setY(-2.6), color: '#3affd0', intensity: 16, range: 9, flicker: 0.05, priority: 1.1 });
    }
    ruinBlock(L, V(2, -12, 117), V(3, 17, 3), { glyph: true });
    ruinBlock(L, V(-2.5, -12, 123.5), V(3, 17.5, 3));
    ruinBlock(L, V(2.5, -12, 130), V(3, 18, 3), { glyph: true });
    props.platform([[0, 4.2, 136.5], [-3, 4.2, 150]], { speed: 3, wait: 1.2, size: V(3.5, 0.6, 3.5), color: '#7a5a3a' });
    ruinBlock(L, V(-2, -12, 156), V(7, 15.5, 7));
    props.checkpoint(V(-4.5, 3.5, 157.5), 0);
    giantMushroom(L, V(0.8, 3.5, 154.5), 0.8, '#ffd23a', { bounce: 20 });
    // boulon d'or : pilier au-dessus du champignon-tremplin
    ruinBlock(L, V(8.5, -12, 149), V(3, 26, 3), { glyph: true });
    props.goldBolt(V(8.5, 15.2, 149), 0);
    // la grande liane du grappin, sous une branche géante qui sort du tronc de l'arbre voisin (-15, 172) ; les lianes
    // pendent de son dessous
    const BR1 = [V(-14.8, 17.1, 171.6), V(1, 14.8, 163.5), 0.6];
    beam(...BR1, M3.bark);
    props.grapple(V(0, 13.6, 163.5), V(0, 5.5, 175), { apex: 2, back: V(-3, 3.5, 158) });
    vines(L, V(-0.7, 14.6, 163.5), 3, 2.5, 13, { top: under(...BR1, 163.5) });
    vines(L, V(-7, 15.8, 167), 4, 5, 14, { top: under(...BR1, 167) });
    jungleTree(L, at(-15, 172), 1.4, 9);
    L.trigger({
      box: [[-25, 0, 106], [25, 20, 110]],
      fn: () => {
        g.hud.say([['ecrou', 'La rivière ! Avec des oreilles pareilles, mieux vaut ne pas nager : de pilier en pilier, puis le radeau.']], true);
        g.hud.objective('Traverser la rivière jusqu’au village des Lucioles');
      },
    });
    L.trigger({ box: [[-25, -2, 112], [25, 20, 116]], fn: () => spawnGroup([['bourdon', -6, 140, {}, 6], ['bourdon', 8, 146, {}, 7]]) });
    L.trigger({
      sphere: [[-2, 3.5, 157], 4],
      fn: () => g.hud.say([['ecrou', 'Un champignon-tremplin ! Saute dessus pour rebondir. Et regarde ce pilier… il y a de l’or là-haut !'], ['ecrou', 'Pour l’autre rive : la liane, avec le grappin.']]),
    });

    // ------------------------------------------------ D. Le village des Lucioles
    const VG = 5.5;
    props.checkpoint(V(6, VG, 176), 0);
    props.vendor(V(-12, VG, 194), Math.PI / 2);
    stiltHouse(L, V(12, VG, 186), -1.3);
    stiltHouse(L, V(-14, VG, 210), 1.4, { roof: 'b' });
    stiltHouse(L, V(13, VG, 214), -1.8, { roof: 'b' });
    for (const [x, z] of [[-6, 180], [6, 198], [-4, 214], [6, 224], [-8, 200]]) lantern(L, V(x, VG, z));
    // la lanterne voisine du panneau de la canopée l'éblouissait : plus douce
    const nearSign = lights.emitters.find((e) => Math.hypot(e.pos.x - 6, e.pos.z - 224) < 1.2);
    if (nearSign) nearSign.intensity = 24;
    // (du toit de la maison sur pilotis au coin haut de l'enseigne du Bazar, côté maison : planche de 2,6 × 0,55 m centrée à 3,35 m)
    bunting(L, V(12, VG + 6, 186), V(-12, VG + 3.58, 192.8), ['#7affc8', '#ff6ad8', '#ffd23a']);
    bunting(L, V(-14, VG + 6.5, 210), V(13, VG + 6.5, 214), ['#ffd23a', '#6ad8ff', '#ff6ad8']);
    // village chaleureux : guirlandes d'ampoules entre les fanions, lucioles dorées
    garland(L, V(12, VG + 6, 186), V(-12, VG + 3.5, 192.85));
    garland(L, V(-14, VG + 6.5, 210), V(13, VG + 6.5, 214));
    fireflies(L, [-16, VG + 0.5, 176, 32, 6, 52], { count: 80, colors: ['#ffd27a', '#ffb05a'], glow: 2.6 });
    jungleTree(L, V(20, VG, 200), 1.3, 11);
    jungleTree(L, V(-21, VG, 186), 1.4, 6);
    // cristal au sommet d'un champignon géant (Propulseur)
    giantMushroom(L, V(-3, VG, 203), 1.3, '#6ad8ff');
    props.orbium(V(-3, VG + 5.3, 203), 0);
    tuft(4, 180); tuft(-6, 190); tuft(8, 206); tuft(0, 218);
    crate(4, 190, 'bolt', -0.44);
    crate(5.2, 190.6, 'bolt', -0.48);
    crate(-8, 220, 'ammo');
    crate(9, 226, 'health');
    L.trigger({
      sphere: [[-8, VG, 192], 9],
      fn: () => g.hud.say([
        ['gigi', 'Bienvenue au village des Lucioles ! Enfin… ce qu’il en reste. Le Bazar, lui, reste ouvert jour et nuit.'],
        ['ecrou', 'Les habitants ont fui. On dit que la Reine Spore a pris le temple, de l’autre côté de la canopée.'],
      ]),
    });
    L.trigger({
      box: [[-25, 0, 204], [25, 20, 208]],
      fn: () => spawnGroup([['champi', -10, 222], ['champi', 10, 220], ['grignoteur', -3, 218], ['grignoteur', 3, 222], ['moustique', -2, 226], ['moustique', 2, 224], ['moustique', 0, 228]]),
    });
    // champignon-tremplin vers la canopée
    giantMushroom(L, V(-6, VG, 227.5), 1, '#ff6ad8', { bounce: 18, light: 0.5 });
    props.sign(V(2, VG, 226), -0.2, 'CANOPÉE\n↑ PAR LE CHAMPIGNON', 3, 1.2, SIGN);
    L.trigger({
      sphere: [[-4, VG, 224], 5],
      fn: () => {
        g.hud.say([['ecrou', 'En dessous, c’est un marais acide. On passe par les arbres : rebondis sur le champignon !']], true);
        g.hud.objective('Traverser la canopée jusqu’au temple');
      },
    });

    // ------------------------------------------------ E. La canopée, au-dessus du marais acide
    // le marais luit : liquide sombre veiné de vert toxique, bulles, brume acide au ras de la surface ; sa lueur
    // éclaire les troncs et le dessous des plateformes
    const swamp = props.lava(V(-2, -0.3, 264), 60, 68, { type: 'acide', damage: 10, spark: '#7affc8', light: '#5aff3a' }).userData.water;
    swamp.u.uGlow.value.set('#4aff2a').multiplyScalar(0.035);
    swamp.u.uDeep.value.set('#041a06');
    swamp.u.uShallow.value.set('#b8ff5a');
    swamp.u.uFoamCol.value.set('#3a6a1a');
    planktonBed(L, swamp, { depth: 0.15, colors: ['#3aff1a', '#9aff2a', '#e0ff7a'], amount: 0.65, flow: [0.04, 0.02], streak: [0.22, 0.22], patch: [0.5, 0.85], mix: [0.004, 0.7, 0.25, 1.2], scale: 3.5 });
    glowMist(L, [-32, 230, 60, 68], -0.3, { height: 5, color: '#3aff2a', colorB: '#c8ff5a', density: 0.018 });
    // ses lumières passent juste sous la surface, dans les trouées entre les troncs : elles éclairent troncs, tiges
    // et dessous des plateformes sans éclairer le liquide lui-même (qui luit déjà)
    const swampLight = lights.emitters.find((e) => e.area && e.area[0] === 60 && e.pos.z === 264);
    if (swampLight) Object.assign(swampLight, { area: null, intensity: 40, range: 22, decay: 1, flicker: 0.08 }).pos.set(0, -0.38, 250);
    for (const [x, z] of [[-1, 270], [11, 270], [3, 290], [-14, 256]]) {
      lights.add({ pos: V(x, -0.38, z), color: '#5aff3a', intensity: 40, range: 22, decay: 1, flicker: 0.08, priority: 2 });
    }
    const canopy = [[-6, 12, 240, 2], [6, 12, 258, 4], [4, 11, 280, 3], [-9.5, 16, 293, 10], [16, 13, 293, 5]];
    // ouvertures du garde-corps : arrivées des sauts, ponts de corde, départs du grappin et des planés
    const OPEN = {
      // (et retours des champignons de secours du marais : (2, 247), (-4, 268), (12, 284))
      2: [['-z', 0, 3.2], ['+z', 3.5, 2.8], ['+x', 3, 3.6]],
      4: [['-z', -3, 2.8], ['+z', -2, 6], ['+x', -2, 3], ['-x', 3, 3.6]],
      3: [['-z', -1, 6], ['-x', 3, 4], ['-x', -3, 3.6], ['+z', -3, 4], ['+x', 2, 4]],
      10: [['+x', 0, 6], ['-z', 3, 4], ['+z', 2, 2.8]],
      5: [['-x', 0, 5], ['-z', -2, 3]],
    };
    for (const [x, y, z, s] of canopy) {
      jungleTree(L, V(x, -0.5, z), 2.2, s);
      canopyDeck(L, M3, x, y, z, s === 5 ? 8 : 10, s === 5 ? 8 : 10, { tree: s, open: OPEN[s] });
    }
    ropeBridge(L, V(-2.5, 12, 245), V(3, 12, 253));
    props.grapple(V(5, 19, 268.5), V(4, 11, 279), { apex: 2, back: V(6, 12, 259.5) });
    const BR2 = [V(-4, 22, 262), V(5, 20, 268.5), 0.5];
    vines(L, V(3.8, 20, 268.5), 2, 2, 17, { top: under(...BR2, 268.5) });
    beam(...BR2, M3.bark);
    ropeBridge(L, V(-7.5, 16, 298), V(-4, 8, 313));
    // repères : boulons dans le vide entre les deux plateformes
    for (let i = 0; i < 3; i++) g.pickups.placeBolt(V(-1.5 - i * 0.9, 13 + i * 1.4, 286 + i * 0.9), 5);
    // branche au cristal (Propulseur depuis la 2e plateforme)
    canopyDeck(L, M3, 15, 17, 256, 4, 4, { branch: [V(8, 15, 258), V(14, 16.5, 256), 0.4], open: [['-x', 0, 2.6]] });
    // (son pied entre dans le tronc : prolongée de 0,85 m vers lui)
    beam(V(7.22, 14.8, 258.26), V(14, 16.5, 256), 0.4, M3.bark);
    props.orbium(V(15, 17, 256), 1);
    // plateforme isolée au boulon d'or : long plané depuis la plus haute
    props.goldBolt(V(16, 14.4, 293), 2);
    // champignons de secours dans le marais
    giantMushroom(L, V(2, -0.5, 247), 1, '#ffd23a', { bounce: 22 });
    giantMushroom(L, V(-4, -0.5, 268), 1, '#ffd23a', { bounce: 22 });
    giantMushroom(L, V(12, -0.5, 284), 1, '#ffd23a', { bounce: 22 });
    L.trigger({
      sphere: [[-6, 12, 240], 6],
      fn: () => {
        spawnGroup([['moustique', 4, 254, {}, 12], ['moustique', 7, 257, {}, 12], ['moustique', 5, 261, {}, 12], ['bourdon', -2, 266, {}, 14]]);
        g.hud.say([['ecrou', 'Si tu tombes dans le marais, ça pique ! Les champignons jaunes te renverront dans les arbres.']]);
      },
    });
    L.trigger({ sphere: [[6, 12, 258], 6], fn: () => spawnGroup([['lunette', -10, 295, { yaw: Math.PI }, 16]]) });
    L.trigger({
      sphere: [[4, 11, 280], 6],
      fn: () => g.hud.say([['ecrou', 'La dernière plateforme est plus haute : double saut, puis le Propulseur !']]),
    });

    // ------------------------------------------------ F. Le temple
    const TT = 8;
    props.checkpoint(V(-2, TT, 316), 0);
    ruinBlock(L, V(-7, TT, 322), V(2, 9, 2), { glyph: true });
    ruinBlock(L, V(7, TT, 322), V(2, 9, 2), { glyph: true });
    ruinBlock(L, V(0, TT + 9, 322), V(17, 1.6, 2.6), { glyph: true });
    vines(L, V(0, TT + 9, 323), 12, 4, 21, { dz: [-0.15, 0.15], up: 0.15 });
    for (const [x, z, h] of [[-14, 330, 5], [-15, 344, 7], [18, 352, 6], [-12, 366, 4], [15, 374, 8], [-16, 382, 6]]) ruinBlock(L, V(x, TT, z), V(1.8, h, 1.8), { glyph: h > 6 });
    // tour à cheminée : boulon d'or au sommet
    wallChimney(L, 13, TT, TT + 9, 330, 338, { mat: M3.jRock, wallMat: M3.stone, glow: M3.sporeGlow, side: 4, back: 4, bottom: TT - 1, surface: 'rock' });
    props.goldBolt(V(13, TT + 10.2, 340), 1);
    PLANT_AVOID.push([13, 334, 9]);
    L.trigger({ sphere: [[13, TT, 326], 6], fn: () => g.hud.say([['ecrou', 'Des parois rainurées, comme sur Givrelune ! Rebondis de l’une à l’autre jusqu’en haut de la tour.']]) });
    // corniche au cristal (Propulseur)
    ruinBlock(L, V(-12, TT, 352), V(5, 5.4, 5), { glyph: true });
    props.orbium(V(-12, TT + 5.4, 352), 2);
    PLANT_AVOID.push([-12, 352, 6]);
    tuft(-4, 330); tuft(4, 346); tuft(-6, 360); tuft(6, 378);
    crate(2, 328, 'ammo');
    crate(-8, 340, 'bolt');
    crate(-7, 341.2, 'bolt');
    crate(8, 360, 'boom');
    crate(-3, 384, 'health');
    // le parvis : le passage vers l'arène reste scellé tant qu'il est gardé
    const gate = props.forceField(V(0, TT, 389), 26, 7, 0, { on: true, color: '#7affc8' });
    // temple mystérieux : orbes d'esprit violets et bleus qui flottent devant la porte et sur le parvis
    [[-7, 320.2, '#b06aff'], [7, 320.2, '#b06aff'], [-13, 346, '#6a8aff'], [15, 366, '#6a8aff'], [-12, 380, '#b06aff']]
      .forEach(([x, z, c], i) => spiritOrb(L, V(x, TT + 4.2, z), c, i * 1.7));
    // et une brume violette qui rampe entre les ruines
    glowMist(L, [-22, 318, 44, 68], TT - 0.5, { height: 3, color: '#5a2aff', colorB: '#3a8aff', density: 0.04 });
    const parvis = new Arena(g, {
      title: 'Le parvis du temple s’éveille !',
      waves: [
        { list: [['champi', -8, 368], ['champi', 8, 372], ['larbinBouclier', 0, 376], ['larbin', -4, 380], ['grignoteur', 4, 366], ['grignoteur', -2, 364]], say: [['ecrou', 'Le passage est scellé. Nettoyons le parvis !']] },
        { list: [['phaseur', -6, 370], ['phaseur', 6, 374], ['larbin', 0, 380, { elite: true }], ['moustique', -3, 362], ['moustique', 3, 362], ['moustique', 0, 366]] },
      ],
      reward: 600,
      rewardPos: V(0, TT + 3, 372),
      onDone: () => {
        g.props.setField(gate, false);
        g.hud.say([['ecrou', 'Le passage s’ouvre. J’entends quelque chose respirer là-dedans… quelque chose de gros.']]);
        g.hud.objective('Affronter la Reine Spore');
      },
    });
    L.trigger({ box: [[-20, 0, 356], [20, 20, 360]], once: false, fn: () => { if (!parvis.active && !parvis.done) parvis.start(); } });

    // ------------------------------------------------ G. L'arène de la Reine Spore
    const AY = 8, AC = V(0, AY, 430);
    props.checkpoint(V(6, AY, 386), 0);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      if (i === 5 || i === 0) continue; // entrée et sortie
      ruinBlock(L, V(AC.x + Math.sin(a) * 21, AY, AC.z + Math.cos(a) * 21), V(1.8, i % 2 ? 6 : 8, 1.8), { glyph: i % 3 === 0 });
    }
    for (const [x, z, c] of [[-16, 412, '#c86aff'], [17, 416, '#6ad8ff'], [-18, 446, '#ff6ad8'], [-10, 452, '#6ad8ff']]) giantMushroom(L, V(x, AY, z), 1.1, c);
    // arène lisible : grandes flaques de lueur douce sur le pourtour (toutes qualités, sans lumière du moteur)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.3;
      glowPool(L, V(AC.x + Math.sin(a) * 15, AY + 3, AC.z + Math.cos(a) * 15), ['#c86aff', '#3affe0', '#ff6ad8', '#6ad8ff'][i % 4], 13, 0.22);
    }
    for (let i = 0; i < 14; i++) { const a = Math.random() * 6.28, d = 14 + Math.random() * 6; glowFlower(L, V(AC.x + Math.cos(a) * d, AY, AC.z + Math.sin(a) * d), 1 + Math.random() * 0.6, ['pink', 'gold', 'spore'][i % 3]); }
    crate(-14, 420, 'ammo');
    crate(14, 440, 'ammo');
    crate(-12, 440, 'health');
    // Tantine Caméla, prisonnière d'un cocon de spores
    const CP = V(15, AY, 447);
    const cocoonM = mat('#ff9ad8', { rough: 0.3, emissive: '#c83a9a', emissiveIntensity: 0.9, transparent: true, opacity: 0.55 });
    const cocoon = new THREE.Mesh(G.sphere(1.5, 20, 14), cocoonM);
    cocoon.position.copy(CP).setY(AY + 1.3);
    cocoon.scale.set(1, 1.25, 1);
    L.root.add(cocoon);
    lights.add({ obj: cocoon, color: '#ff6ad8', intensity: 26, range: 9, flicker: 0.08, priority: 1.6 });
    const cocoonCol = new CylinderCollider(CP.x, CP.z, AY, AY + 3.2, 1.5, { surface: 'grass' });
    g.world.add(cocoonCol);
    let popT = -1, talked = false;
    L.every((dt, t) => {
      if (popT < 0) { cocoon.scale.set(1 + Math.sin(t * 2) * 0.04, 1.25 + Math.sin(t * 2 + 1) * 0.05, 1 + Math.sin(t * 2) * 0.04); return; }
      if (!cocoon.visible) return;
      popT += dt;
      cocoon.scale.setScalar(Math.max(0.01, 1 + popT * 3) * (1 - Math.min(1, popT / 0.35)));
      if (popT > 0.35) cocoon.visible = false;
    });
    const popCocoon = () => {
      if (popT >= 0) return;
      popT = 0;
      g.world.remove(cocoonCol);
      g.audio.play('pop', { pos: CP, pitch: 0.6 });
      g.fx.sparks(CP.clone().setY(AY + 1.5), null, 40, '#ff9ad8', 9);
      g.fx.ring(CP, '#ff9ad8', 3, 0.5);
    };
    placeNpc(L, g, camelaModel(), CP.clone(), Math.PI + 0.6, {
      label: 'Parler à Tantine Caméla',
      radius: 3.6,
      enabled: () => popT >= 0 && !talked,
      action: () => {
        talked = true;
        g.hud.say([
          ['camela', 'Ouf ! Merci, mon mignon. Tantine Caméla, bricoleuse de la jungle. Cette plante prétentieuse m’avait mise en conserve !'],
          ['camela', 'Tiens, prends ma Magnéto-clé : un coup sur un verrou aimanté, et la porte s’ouvre. Même les blocs aimantés t’obéiront.'],
          ['ecrou', 'La porte du fond est justement scellée par un verrou magnétique. Essayons !'],
          ['camela', 'Le Baron est reparti vers sa Station Goinfre, les soutes pleines de spores. Il prépare quelque chose d’énorme…'],
        ], true);
        L.after(5, () => g.giveGadget('magneto', 'la Magnéto-clé', 'Frappez un verrou magnétique avec la clé (' + g.input.actionLabel('melee') + ') pour l’ouvrir.'));
        g.hud.objective('Ouvrir la porte magnétique avec la Magnéto-clé');
      },
    });
    // la porte de sortie et ses murs
    const EZ = 463;
    const exitDoor = props.magDoor(V(0, AY, EZ), 0, 6, 5);
    for (const s of [-1, 1]) ruinBlock(L, V(s * 12, AY, EZ), V(17, 10, 2), { glyph: true });
    ruinBlock(L, V(0, AY + 5.6, EZ), V(8, 4.4, 2));
    L.every(() => {
      if (exitDoor.open && !exitDoor._landed) { exitDoor._landed = true; exitShip.land(); }
    });
    const gateIn = props.forceField(V(0, AY, 396), 26, 7, 0, { on: false, color: '#7affc8' });
    const arena = new Arena(g, {
      fields: [gateIn],
      title: 'Le cœur du temple !',
      ammo: [at(9, 415), at(-16, 428), at(4, 448)],
      waves: [
        { list: [['moustique', -6, 418], ['moustique', 6, 418], ['moustique', 0, 422], ['champi', -12, 426], ['champi', 12, 432]], say: [['ecrou', 'Le sol tremble… Ce n’est pas un temple, c’est un pot de fleurs géant !']] },
        {
          list: [['reineSpore', AC.x, AC.z, { yaw: Math.PI }]], after: 2, onStart: () => g.playMusic('boss'),
          say: [
            ['baron', 'Ma Reine ! Mon plus bel investissement. Faites de ce fennec de l’engrais !'],
            ['ecrou', 'Quand ses pétales se ferment, détruis les bulbes lumineux autour d’elle : elle sera étourdie. Ensuite, vise l’œil !'],
          ],
        },
      ],
      reward: 1500,
      rewardPos: V(0, AY + 4, 416),
      onDone: () => {
        g.playMusic('luminbois');
        popCocoon();
        g.hud.say([['ecrou', 'La Reine est fanée ! Et ce cocon… il y avait quelqu’un dedans !']]);
        g.hud.objective('Parler à la prisonnière');
      },
    });
    L.trigger({ box: [[-12, 0, 399], [12, 20, 404]], once: false, fn: () => { if (!arena.active && !arena.done) arena.start(); } });
    L.arena = arena;
    L.onPlayerRespawn = () => {
      if (parvis.active) parvis.reset();
      if (arena.active) { arena.reset(); g.playMusic('luminbois'); }
    };
    const exitShip = shipExit(L, g, V(0, AY, 482), 'Décoller vers la Station Goinfre', '#5a8a6a');

    // lanternes chaudes le long du sentier
    for (const [x, z] of [[4, -2], [-5, 26], [5, 48], [-6, 70], [6, 96], [-7, 316], [7, 344], [-6, 372], [7, 402], [-7, 404]]) lantern(L, at(x, z));

    // ------------------------------------------------ sous-bois, herbes et lucioles
    scatter(-34, 34, 40);
    scatter(40, 108, 40);
    scatter(172, 228, 30);
    scatter(300, 388, 40);
    scatter(404, 458, 16, false);
    const tufts = [];
    const RG = rng(91);
    for (let i = 0; i < 14000 && tufts.length < 5000; i++) {
      const z = -30 + RG() * 500, x = -30 + RG() * 60;
      const { d } = distToPolyline(x, z, PATH);
      if (d > prof(z, HW) + 1) continue;
      if ((z > 110 && z < 170) || (z > 229 && z < 299) || (z > 34 && z < 38.5)) continue;
      if (Math.hypot(x, z - 430) < 5) continue;
      const n = 3 + Math.floor(RG() * 4);
      for (let k = 0; k < n; k++) {
        const xx = x + (RG() - 0.5) * 1.6, zz = z + (RG() - 0.5) * 1.6;
        tufts.push({ x: xx, y: H(xx, zz), z: zz });
      }
    }
    // touffes de champignons lumineux au bord du sentier (hasard à part : le reste du décor ne bouge pas)
    const RS = rng(4242);
    const pathX = (z) => {
      for (let i = 0; i < PATH.length - 1; i++) if (z <= PATH[i + 1][1]) return lerp(PATH[i][0], PATH[i + 1][0], clamp((z - PATH[i][1]) / (PATH[i + 1][1] - PATH[i][1]), 0, 1));
      return PATH[PATH.length - 1][0];
    };
    const shrooms = (z0, z1, n, cols) => {
      for (let i = 0; i < n; i++) {
        const z = lerp(z0, z1, RS()), side = RS() < 0.5 ? -1 : 1;
        const x = pathX(z) + side * (prof(z, HW) - 1.5 - RS() * 5);
        if (PLANT_AVOID.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar)) continue;
        glowShrooms(L, at(x, z), 0.8 + RS() * 0.7, cols[Math.floor(RS() * cols.length)], Math.floor(RS() * 999));
      }
    };
    shrooms(-30, 32, 16, ['#3affe0', '#b06aff', '#4aa8ff']);
    shrooms(42, 106, 16, ['#3affe0', '#7aff9a', '#b06aff']);
    shrooms(174, 226, 12, ['#ffc84a', '#ff5ad0', '#3affe0']);
    shrooms(304, 386, 18, ['#b06aff', '#4aa8ff', '#ff5ad0']);
    shrooms(406, 456, 10, ['#ff5ad0', '#3affe0', '#b06aff']);
    grassField(L, tufts, { base: '#0c3426', tip: '#3ac08a', height: [0.25, 0.55], seed: 13, sway: 0.6, blades: 8 });
    motes(L, { count: 420, colorA: '#d8ff6a', colorB: '#7affc8', size: 0.13, drift: [0.15, 0.08, 0.1], glow: 1.8, box: [50, 16, 50] });

    // ------------------------------------------------ ambiance par zone
    // l'éclairage d'ambiance glisse d'une zone à l'autre avec Kobi : rivière froide et cyan, village chaleureux,
    // marais vert par en dessous, temple violet et mystérieux, arène plus claire pour lire le combat
    const hemi = L.root.children.find((c) => c.isHemisphereLight);
    const AMB = [
      // z, ciel, sol (hémisphère), intensité, brouillard, brume volumétrique (couleur, densité), gain des lumières
      [0, '#2c5a9a', '#14402e', 0.95, '#0a2238', '#183a6a', 0.022, 1],
      [100, '#2c5a9a', '#14402e', 0.95, '#0a2238', '#183a6a', 0.022, 1],
      [140, '#2a609a', '#0a4a4a', 0.9, '#08283a', '#145a6a', 0.024, 1],
      [200, '#3a5688', '#4a3420', 1.0, '#1a1c2e', '#3a2a3a', 0.02, 1.15],
      [264, '#2a5478', '#1e5a14', 0.9, '#0a2a22', '#1a4a2a', 0.024, 1],
      [345, '#3a3a80', '#1c1a3a', 0.85, '#140f30', '#2a1e5a', 0.03, 1],
      [430, '#4a6aa8', '#24384a', 1.15, '#0e1a36', '#1e3468', 0.018, 1.1],
    ].map(([z, a, b, k, f, v, dv, gn]) => ({ z, a: new THREE.Color(a), b: new THREE.Color(b), k, f: new THREE.Color(f), v: new THREE.Color(v).multiplyScalar(0.4), dv, gn }));
    const fog = g.scene.fog;
    L.every(() => {
      if (!hemi) return;
      const z = g.player.pos.z;
      let i = 0;
      while (i < AMB.length - 2 && z > AMB[i + 1].z) i++;
      const A = AMB[i], B = AMB[i + 1];
      const t = smooth(clamp((z - A.z) / (B.z - A.z), 0, 1));
      hemi.color.lerpColors(A.a, B.a, t);
      hemi.groundColor.lerpColors(A.b, B.b, t);
      hemi.intensity = lerp(A.k, B.k, t);
      fog.color.lerpColors(A.f, B.f, t);
      volU.uAmbient.value.lerpColors(A.v, B.v, t);
      volU.uDensity.value = lerp(A.dv, B.dv, t);
      lights.gain = lerp(A.gn, B.gn, t);
    });
  },
  onStart(L, g) {
    g.hud.titleCard('Luminbois', 'La Jungle des Lucioles');
    g.hud.objective('Escalader le mur des ruines');
    L.after(1.8, () => g.hud.say([
      ['ecrou', 'Luminbois… Toute la jungle brille ! Les spores du Baron doivent venir d’ici.'],
      ['ecrou', 'Reste sur tes gardes : la nuit, même les fleurs ont des dents.'],
    ]));
    L.trigger({ box: [[-25, 4, 39], [25, 20, 43]], fn: () => g.hud.objective('Rejoindre la rivière aux Lucioles') });
  },
};
