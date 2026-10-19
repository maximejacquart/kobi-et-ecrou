import * as THREE from 'three';
import { G, joint, mergeGeometries } from '../geo.js';
import { glow, patchRim, globalU, outlineMaterial } from '../../engine/materials.js';
import { slotsTier } from '../../engine/shaderSlots.js';
import { fbm2, noise2, clamp } from '../../engine/util.js';
import { C, VORAX_PAL, rig } from './common.js';

// ===================================================================== Larbin
// Soldat du Baron : combinaison sombre sculptée (un seul maillage skinné) sous une armure de plaques rigides
// (violet et blanc, liserés dorés), visière vert acide, bras-canon. Les plaques partagent UNE matière : teinte et
// part de métal par sommet, texture de données commune (nuances, éclats de peinture aux arêtes, crasse).

const TAU = Math.PI * 2;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ texture d'usure (données, pas de couleur)
// R : nuances de peinture, G : éclat (la peinture a sauté → métal nu), B : liseré sombre et crasse. Coin u, v > 0,94
// propre (pièces « clean » : caoutchouc, petites pièces).
let WEAR = null;
function wearTex() {
  if (WEAR) return WEAR;
  const N = 256, data = new Uint8ClampedArray(N * N * 4), H = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x + 0.5) / N, v = (y + 0.5) / N, i = y * N + x;
    const n = fbm2(u * 5, v * 5, 4, 811, 5);
    const e = Math.min(u, 1 - u, v, 1 - v);
    const cn = fbm2(u * 9, v * 9, 4, 823, 9), cn2 = fbm2(u * 27, v * 27, 3, 829, 27);
    const s = cn * 0.85 + (sstep(0.1, 0, e) * 0.34 + sstep(0.03, 0, e) * 0.24) * (0.25 + cn2 * 1.3);
    let chip = sstep(0.72, 0.74, s);
    let rim = sstep(0.69, 0.715, s) * (1 - chip);
    // rayures claires (traits fins, en biais)
    const sc = noise2(u * 3 + v * 9, v * 2 - u * 70, 839, 0);
    const scr = sstep(0.955, 0.975, sc) * sstep(0.3, 0.6, fbm2(u * 4, v * 4, 2, 841, 4));
    chip = Math.max(chip, scr * 0.7);
    let dirt = sstep(0.6, 0.78, fbm2(u * 3.5, v * 3.5, 3, 853, 3.5)) * 0.3;
    if (u > 0.94 && v > 0.94) { chip = 0; rim = 0; dirt = 0; }
    data[i * 4] = n * 255; data[i * 4 + 1] = chip * 255; data[i * 4 + 2] = Math.min(1, rim * 0.75 + dirt) * 255; data[i * 4 + 3] = 255;
    H[i] = 0.6 + (n - 0.5) * 0.06 - chip * 0.3 + rim * 0.04;
  }
  const tex = (arr) => {
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const ctx = c.getContext('2d'), img = ctx.createImageData(N, N);
    img.data.set(arr);
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 8;
    t.userData.shared = true;
    return t;
  };
  const nrm = new Uint8ClampedArray(N * N * 4);
  const Hh = (x, y) => H[((y + N) % N) * N + ((x + N) % N)];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (Hh(x + 1, y) - Hh(x - 1, y)) * 3, dy = (Hh(x, y + 1) - Hh(x, y - 1)) * 3, l = Math.hypot(dx, dy, 1), i = (y * N + x) * 4;
    nrm[i] = (-dx / l * 0.5 + 0.5) * 255; nrm[i + 1] = (dy / l * 0.5 + 0.5) * 255; nrm[i + 2] = (0.5 / l + 0.5) * 255; nrm[i + 3] = 255;
  }
  WEAR = { map: tex(data), normalMap: tex(nrm) };
  return WEAR;
}

// Matière des plaques : couleur de sommet (rgb : teinte, a : métal) × texture d'usure ; vernis sur la peinture
// seulement, métal nu dans les éclats ; lumière d'appoint des personnages comme le corps sculpté.
let ARMOR = null;
function armorMat() {
  if (ARMOR) return ARMOR;
  const t = wearTex();
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, vertexColors: true, map: t.map, normalMap: t.normalMap,
    roughness: 0.4, metalness: 0.06, clearcoat: 1, clearcoatRoughness: 0.08,
  });
  m.normalScale.set(0.9, 0.9);
  patchRim(m, 1, armorShader);
  m.customProgramCacheKey = () => 'larbinArmor' + slotsTier();
  m.userData.shared = true;
  ARMOR = m;
  return m;
}
function armorShader(shader) {
  shader.fragmentShader = '#define CHAR_LIGHT\n' + shader.fragmentShader
    .replace('#include <map_fragment>', `
      vec4 armD = texture2D( map, vMapUv );
      // a : 0 caoutchouc, 0,1 peinture, 1 métal
      float armRub = 1.0 - smoothstep( 0.0, 0.1, vColor.a );
      float armMet = clamp( ( vColor.a - 0.1 ) / 0.9, 0.0, 1.0 );
      float armChip = armD.g * ( 1.0 - armMet * 0.5 ) * ( 1.0 - armRub );
      vec3 armBare = mix( vec3( 0.5, 0.52, 0.58 ), vColor.rgb * 1.25, armMet ) * ( 0.85 + 0.3 * armD.r );
      diffuseColor.rgb = mix( vColor.rgb * ( 0.86 + 0.28 * armD.r ), armBare, armChip ) * ( 1.0 - armD.b * 0.55 );`)
    .replace('#include <color_fragment>', '')
    .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix( mix( mix( roughness, 0.3, armMet ), 0.34, armChip ) + armD.b * 0.3, 0.8, armRub );')
    .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = max( mix( metalness, 0.9, armMet ), armChip * 0.85 );')
    .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
      #ifdef USE_CLEARCOAT
      material.clearcoat *= ( 1.0 - armMet ) * ( 1.0 - armChip ) * ( 1.0 - armRub );
      #endif`);
}

// ------------------------------------------------------------------ champ alvéolé du bouclier
let HONEY = null;
function honeyTex() {
  if (HONEY) return HONEY;
  const N = 256, c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d'), img = ctx.createImageData(N, N);
  const S = 0.15, rx = 1, ry = 1.7320508;
  const md = (a, m) => ((a % m) + m) % m;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const px = ((x + 0.5) / N - 0.5) * 2, py = ((y + 0.5) / N - 0.5) * 2;
    // pavage hexagonal : centre de l'alvéole le plus proche
    const qx = px / S, qy = py / S;
    const ax = md(qx, rx) - rx / 2, ay = md(qy, ry) - ry / 2;
    const bx = md(qx - rx / 2, rx) - rx / 2, by = md(qy - ry / 2, ry) - ry / 2;
    const [gx, gy] = ax * ax + ay * ay < bx * bx + by * by ? [ax, ay] : [bx, by];
    const hd = Math.max(Math.abs(gx) * 0.5 + Math.abs(gy) * 0.8660254, Math.abs(gx));
    const edge = 0.5 - hd;
    const line = sstep(0.09, 0.02, edge);
    // bord du grand hexagone (sommets à gauche et à droite, comme CircleGeometry(r, 6))
    const hb = Math.max(Math.abs(py), Math.abs(px) * 0.8660254 + Math.abs(py) * 0.5) / 0.8660254;
    const border = sstep(0.72, 1.0, hb);
    const cellN = noise2(Math.floor(qx * 2), Math.floor(qy), 901);
    const val = Math.min(1, 0.15 + line * (0.6 + border * 0.3) + border * 0.4 + (cellN > 0.8 ? 0.14 : 0));
    const i = (y * N + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = val * 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.userData.shared = true;
  HONEY = t;
  return t;
}
const fieldMats = new Map();
function fieldMat(color) {
  if (fieldMats.has(color)) return fieldMats.get(color);
  // verre d'énergie : alvéoles vives et opaques, fond presque transparent (lisible sur fond clair comme sombre)
  const m = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(2.2), map: honeyTex(), alphaMap: honeyTex(), transparent: true, depthWrite: false,
    side: THREE.DoubleSide,
  });
  // reflets qui balaient le champ
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = globalU.uTime;
    shader.fragmentShader = 'uniform float uTime;\n' + shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float sweep = sin( ( vMapUv.y * 1.6 + vMapUv.x * 0.5 ) * 9.0 - uTime * 4.0 );
      diffuseColor.rgb *= 0.8 + 0.45 * smoothstep( 0.6, 1.0, sweep );`);
  };
  m.customProgramCacheKey = () => 'larbinField';
  m.userData.shared = true;
  m.userData.isGlow = true;
  fieldMats.set(color, m);
  return m;
}

// ------------------------------------------------------------------ formes
const spow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
// Cintrage d'une plaque (face avant +z) : taper (plus étroite en haut si > 0), enroulement autour de y (rayon bx)
// puis de x (rayon by) ; un rayon nul laisse la plaque plane.
function bendPt(x, y, z, o, out = new THREE.Vector3()) {
  if (o.taper) x *= 1 - o.taper * (y / (o.hh || 1));
  if (o.bx) { const a = x / o.bx, r = o.bx + z; x = Math.sin(a) * r; z = Math.cos(a) * r - o.bx; }
  if (o.by) { const a = y / o.by, r = o.by + z; y = Math.sin(a) * r; z = Math.cos(a) * r - o.by; }
  return out.set(x, y, z);
}
const _b0 = new THREE.Vector3(), _b1 = new THREE.Vector3();
// pose une géométrie plane (décalque, rivet…) sur la face avant d'une plaque, en suivant son cintrage
function onSlab(geo, o) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    bendPt(x, y, z, o, _b0);
    if (n) {
      bendPt(x + n.getX(i) * 0.002, y + n.getY(i) * 0.002, z + n.getZ(i) * 0.002, o, _b1);
      _b1.sub(_b0).normalize();
      n.setXYZ(i, _b1.x, _b1.y, _b1.z);
    }
    p.setXYZ(i, _b0.x, _b0.y, _b0.z);
  }
  return g;
}

// Plaque d'armure : contour en superellipse (e : 1 = ellipse, → 0 = rectangle), faces planes, chant arrondi
// (rim : part du rayon), face avant +z. o : { e, rim, seg, taper, bx, by }. Géométrie en cache.
const slabCache = new Map();
function slab(w, h, t, o = {}) {
  const e = o.e ?? 0.4, rim = o.rim ?? 0.14, M = o.seg ?? Math.round(clamp((w + h) * 30, 12, 24) / 2) * 2;
  const key = [w, h, t, e, rim, M, o.taper || 0, o.bx || 0, o.by || 0].join('|');
  if (slabCache.has(key)) return slabCache.get(key);
  const a = w / 2, b = h / 2, c = t / 2, bo = { ...o, hh: b };
  const rings = [[0, c], [0.5, c], [0.8, c], [1 - rim, c]];
  for (let i = 1; i <= 3; i++) { const f = (i / 3) * Math.PI / 2; rings.push([1 - rim + rim * Math.sin(f), c * Math.cos(f)]); }
  for (let i = 1; i <= 2; i++) { const f = Math.PI / 2 + (i / 2) * Math.PI / 2; rings.push([1 - rim + rim * Math.sin(f), c * Math.cos(f)]); }
  rings.push([0, -c]);
  const pos = [], idx = [];
  for (const [rho, z] of rings) {
    for (let j = 0; j < M; j++) {
      const w0 = (j / M) * TAU;
      bendPt(a * rho * spow(Math.cos(w0), e), b * rho * spow(Math.sin(w0), e), z, bo, _b0);
      pos.push(_b0.x, _b0.y, _b0.z);
    }
  }
  for (let r = 0; r < rings.length - 1; r++) for (let j = 0; j < M; j++) {
    const j1 = (j + 1) % M, A = r * M + j, B = r * M + j1, Cc = (r + 1) * M + j, D = (r + 1) * M + j1;
    idx.push(A, Cc, B, B, Cc, D);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // le premier anneau tourne vers l'extérieur ? (sens des faces) : on vérifie sur le centre avant
  if (g.attributes.normal.getZ(0) < 0) { idx.reverse(); g.setIndex(idx); g.computeVertexNormals(); }
  g.userData.bend = bo;
  g.userData.shared = true;
  slabCache.set(key, g);
  return g;
}
// Révolution autour de y, profil fermé [[r, y]…] ; sz : aplatissement en z (anneaux elliptiques)
function lathe(pts, seg = 20, sz = 1) {
  // sens du profil : la normale du point le plus éloigné de l'axe doit pointer vers l'extérieur
  let g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  let bi = 0;
  pts.forEach(([r], i) => { if (r > pts[bi][0]) bi = i; });
  if (g.attributes.normal.getZ(bi) < 0) g = new THREE.LatheGeometry(pts.slice().reverse().map(([r, y]) => new THREE.Vector2(r, y)), seg);
  if (sz !== 1) { g.scale(1, 1, sz); g.computeVertexNormals(); }
  return g;
}
// Rivet bombé tourné vers +z
const rivetG = (r = 0.012) => new THREE.SphereGeometry(r, 6, 2, 0, TAU, 0, Math.PI / 2).scale(1, 0.6, 1).rotateX(Math.PI / 2);
// rivets posés sur la face avant d'une plaque (coordonnées dans le plan de la plaque)
function slabRivets(slabGeo, pts, r = 0.012) {
  const o = slabGeo.userData.bend, c = slabGeo.userData.c;
  return pts.map(([x, y]) => onSlab(rivetG(r).translate(x, y, c), o));
}
// décalque peint (forme plane) posé sur la face avant d'une plaque
function slabDecal(slabGeo, geo) { return onSlab(geo.translate(0, 0, slabGeo.userData.c + 0.0015), slabGeo.userData.bend); }
function slabC(w, h, t, o) { const g = slab(w, h, t, o); g.userData.c = t / 2; return g; }
// chevron « V » (insigne Vorax), pointe en bas
function chevron(w, h, th) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, h / 2); s.lineTo(-w / 2 + th, h / 2); s.lineTo(0, -h / 2 + th * 1.3);
  s.lineTo(w / 2 - th, h / 2); s.lineTo(w / 2, h / 2); s.lineTo(0, -h / 2);
  s.closePath();
  return new THREE.ShapeGeometry(s);
}
// Durite annelée le long d'une courbe
function hose(pts, r, n = 14) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const g = new THREE.TubeGeometry(curve, n, r, 6, false);
  const p = g.attributes.position, c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    curve.getPointAt(i / n, c);
    const f = i % 2 ? 1.22 : 0.92;
    for (let j = 0; j <= 6; j++) {
      const k = i * 7 + j;
      v.fromBufferAttribute(p, k).sub(c).multiplyScalar(f).add(c);
      p.setXYZ(k, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ assemblage des pièces rigides
// Les pièces sont fusionnées par cible (os ou articulation) : un maillage « armure » (contour des grandes pièces
// seulement), un par lumière. Les géométries fusionnées sont calculées une fois par modèle (clé) puis partagées.
const KIT_CACHE = new Map();
const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _e4 = new THREE.Euler(), _v4 = new THREE.Vector3(), _s4 = new THREE.Vector3();
function boxUV(g, wear) {
  g.computeBoundingBox();
  const bb = g.boundingBox, lo = bb.min, sz = bb.getSize(new THREE.Vector3());
  const p = g.attributes.position, uv = new Float32Array(p.count * 2);
  const k = 0.6 + 0.4 * wear;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), Cc = new THREE.Vector3();
  for (let t = 0; t < p.count; t += 3) {
    A.fromBufferAttribute(p, t); B.fromBufferAttribute(p, t + 1); Cc.fromBufferAttribute(p, t + 2);
    B.sub(A); Cc.sub(A); B.cross(Cc);
    const ax = Math.abs(B.x), ay = Math.abs(B.y), az = Math.abs(B.z);
    const [i0, i1] = az >= ax && az >= ay ? ['x', 'y'] : ay >= ax ? ['x', 'z'] : ['z', 'y'];
    for (let q = t; q < t + 3; q++) {
      A.fromBufferAttribute(p, q);
      const u = sz[i0] > 1e-6 ? (A[i0] - lo[i0]) / sz[i0] : 0.5, v = sz[i1] > 1e-6 ? (A[i1] - lo[i1]) / sz[i1] : 0.5;
      uv[q * 2] = 0.5 + (u - 0.5) * k; uv[q * 2 + 1] = 0.5 + (v - 0.5) * k;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
function kit(key) {
  const hit = KIT_CACHE.get(key);
  const buckets = [], index = new Map();
  const get = (target, bk, info) => {
    let m = index.get(target);
    if (!m) index.set(target, (m = new Map()));
    let b = m.get(bk);
    if (!b) { b = { target, ...info, list: [] }; m.set(bk, b); buckets.push(b); }
    return b;
  };
  const prep = (geo, o, armor, target) => {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && !(k === 'uv' && o.keepUV)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (armor) {
      boxUV(g, o.wear ?? 1);
      if (o.uv === 'clean') { const uv = g.attributes.uv.array; for (let i = 0; i < uv.length; i++) uv[i] = 0.955 + uv[i] * 0.03; }
    }
    const s = o.s === undefined ? 1 : o.s;
    _e4.set(...(o.r || [0, 0, 0]));
    _m4.compose(_v4.set(...(o.p || [0, 0, 0])), _q4.setFromEuler(_e4), typeof s === 'number' ? _s4.setScalar(s) : _s4.set(...s));
    g.applyMatrix4(_m4);
    if (armor) {
      // teinte (linéaire) et métal par sommet, crasse au pied de l'armure (hauteur au repos dans le modèle)
      target.updateWorldMatrix(true, false);
      const c = new THREE.Color(o.col), p = g.attributes.position, col = new Float32Array(p.count * 4);
      const dirt = new THREE.Color('#4a3a30');
      for (let i = 0; i < p.count; i++) {
        _v4.fromBufferAttribute(p, i).applyMatrix4(target.matrixWorld);
        const d = (1 - sstep(0.02, 0.42, _v4.y)) * 0.42 * (o.dirt ?? 1);
        col[i * 4] = c.r + (dirt.r * 0.6 - c.r) * d; col[i * 4 + 1] = c.g + (dirt.g * 0.6 - c.g) * d; col[i * 4 + 2] = c.b + (dirt.b * 0.6 - c.b) * d;
        col[i * 4 + 3] = o.rub ? 0 : 0.1 + 0.9 * (o.met ?? 0);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    }
    return g;
  };
  return {
    // o : { p, r, s, col, met (0..1), ol (contour), uv ('clean' : sans usure), wear (usure aux arêtes 0..1), dirt }
    add(target, geos, o = {}) {
      const b = get(target, 'a', { kind: 'armor', ol: [] });
      if (!hit) for (const g of [].concat(geos)) { const x = prep(g, o, true, target); b.list.push(x); if (o.ol) b.ol.push(x); }
    },
    glow(target, geos, color, k, o = {}) {
      const b = get(target, 'g' + color + k, { kind: 'glow', color, k });
      if (!hit) for (const g of [].concat(geos)) b.list.push(prep(g, o, false, target));
    },
    field(target, geo, color) {
      const b = get(target, 'f' + color, { kind: 'field', color });
      if (!hit) b.list.push(prep(geo, { keepUV: true }, false, target));
    },
    build() {
      const merge = (l) => { const g = mergeGeometries(l); g.userData.shared = true; return g; };
      const geos = hit || buckets.map((b) => {
        const r = [merge(b.list), b.ol && b.ol.length ? merge(b.ol) : null];
        b.list.forEach((x) => x.dispose());
        return r;
      });
      if (!hit) KIT_CACHE.set(key, geos);
      buckets.forEach((b, i) => {
        const [g, gOl] = geos[i];
        const m = new THREE.Mesh(g, b.kind === 'armor' ? armorMat() : b.kind === 'glow' ? glow(b.color, b.k) : fieldMat(b.color));
        m.castShadow = b.kind === 'armor';
        b.target.add(m);
        // contour des grandes pièces seulement (pas des rivets ni des petites pièces)
        if (gOl) {
          const ol = new THREE.Mesh(gOl, outlineMaterial('#1d1028', 0.011));
          ol.castShadow = false;
          ol.raycast = () => {};
          ol.userData.isOutline = true;
          m.add(ol);
        }
      });
    },
  };
}

// ------------------------------------------------------------------ thèmes
const THEME = {
  larbin: {
    white: '#eceaf6', vorax: C.vorax, voraxD: C.voraxD, trim: C.gold, trimMet: 1, dark: '#3a3450', black: '#17131f',
    belt: '#2e2234', visor: '#c8ff4a', eyes: '#f4ffd8', energy: '#ff3a8a', debris: C.vorax,
  },
  larbinBouclier: {
    white: '#dfe6f2', vorax: '#4a5a8a', voraxD: '#2a3050', trim: '#3ef2ff', trimMet: 0.25, dark: '#30384c', black: '#14171f',
    belt: '#22283a', visor: '#3ef2ff', eyes: '#e8ffff', energy: '#ff3a8a', debris: '#4a5a8a',
  },
};

export function larbin() { return larbinBase('larbin'); }
function larbinBase(key, heavy = false, extra = null) {
  const T = THEME[key];
  const { S, root, B, skin } = rig({
    ...VORAX_PAL,
    vorax: { ...VORAX_PAL.vorax, color: T.vorax },
    voraxD: { ...VORAX_PAL.voraxD, color: T.voraxD },
    white: { ...VORAX_PAL.white, color: T.white },
    gold: { ...VORAX_PAL.gold, color: T.trim },
    // combinaison souple sous l'armure (satinée) et ses soufflets
    suit: { color: '#2a2436', rough: 0.62, metal: 0.05, sheen: 0.55 },
    suitD: { color: '#1b1726', rough: 0.55, metal: 0.15, sheen: 0.35 },
    grime: { color: '#3c3036', rough: 0.8, metal: 0.05 },
  });
  const H = heavy ? 1 : 0;
  // ---------------------------------------------------------------- corps sculpté
  const hips = B(root, [0, 0.82, 0], 'hips');
  S.add(hips, { t: 'ell', r: [0.27, 0.16, 0.21], col: 'suit', k: 0.05 });
  const torso = B(hips, [0, 0.12, 0], 'torso');
  S.add(torso, { t: 'cone', a: [0, 0.0, 0], b: [0, 0.3, 0.01], r1: 0.19, r2: 0.25, col: 'suit', k: 0.06 });
  for (const [y, R] of [[0.06, 0.195], [0.14, 0.21], [0.22, 0.225]]) S.add(torso, { t: 'torus', R, r: 0.022, p: [0, y, 0.005], col: 'suitD', k: 0.012 });
  S.add(torso, { t: 'ell', r: [0.35, 0.26, 0.27], p: [0, 0.42, 0], col: 'vorax', k: 0.08 });
  S.add(torso, { t: 'cyl', r: 0.115, h: 0.06, round: 0.02, p: [0, 0.68, 0], col: 'suitD', k: 0.03 });
  S.add(torso, { t: 'torus', R: 0.115, r: 0.02, p: [0, 0.665, 0], col: 'suit', k: 0.01 });
  const head = B(torso, [0, 0.72, 0], 'head');
  S.add(head, { t: 'ell', r: [0.26, 0.235, 0.25], col: 'white', k: 0.03 });
  S.add(head, { t: 'ell', r: [0.2, 0.1, 0.17], p: [0, -0.13, 0.06], col: 'vorax', k: 0.06 });
  // crête et arcade (regard sévère au-dessus de la visière)
  S.add(head, { t: 'box', s: [0.028, 0.05, 0.2], round: 0.022, p: [0, 0.2, -0.02], rot: [-0.25, 0, 0], col: 'vorax', k: 0.035 });
  S.add(head, { t: 'ell', r: [0.2, 0.04, 0.09], p: [0, 0.095, 0.175], rot: [0.25, 0, 0], col: 'white', k: 0.03 });
  S.sub(head, { t: 'ell', r: [0.235, 0.075, 0.16], p: [0, 0.02, 0.19], k: 0.015, col: 'black' });
  S.paint(head, { t: 'box', s: [0.035, 0.3, 0.3], p: [0, 0.12, -0.12], col: 'vorax', feather: 0.006 }); // bande peinte
  // écouteurs
  for (const s of [-1, 1]) S.add(head, { t: 'cyl', r: 0.08, h: 0.03, round: 0.015, p: [s * 0.255, -0.01, -0.01], rot: [0, 0, Math.PI / 2], col: 'vorax', k: 0.02 });
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = B(torso, [s * 0.44, 0.5, 0], s < 0 ? 'shL' : 'shR');
    S.add(sh, { t: 'sph', r: 0.125, col: 'suitD', k: 0.03 });
    const up = B(sh, [0, 0, 0], s < 0 ? 'upL' : 'upR', [0, 0, s * 0.45]);
    S.add(up, { t: 'cone', a: [0, -0.02, 0], b: [0, -0.3, 0], r1: 0.082, r2: 0.072, col: 'suit', k: 0.025, skinSoft: 0.012 });
    for (const y of [-0.06, -0.24]) S.add(up, { t: 'torus', R: 0.076, r: 0.016, p: [0, y, 0], col: 'suitD', k: 0.008, skinSoft: 0.012 });
    // brassard
    S.add(up, { t: 'cyl', r: 0.088, h: 0.05, round: 0.02, p: [0, -0.15, 0], col: 'vorax', k: 0.012, skinSoft: 0.012 });
    const fore = B(up, [0, -0.32, 0], s < 0 ? 'foreL' : 'foreR');
    if (s > 0) {
      S.add(fore, { t: 'cyl', r: 0.088, h: 0.16, round: 0.04, p: [0, -0.16, 0], col: 'suitD', k: 0.025, skinSoft: 0.012 });
    } else {
      S.add(fore, { t: 'cone', a: [0, 0, 0], b: [0, -0.22, 0], r1: 0.08, r2: 0.07, col: 'vorax', k: 0.025, skinSoft: 0.012 });
      S.add(fore, { t: 'ell', r: [0.105, 0.115, 0.105], p: [0, -0.31, 0.01], col: 'white', k: 0.035, skinSoft: 0.012 });
      // phalanges du poing
      S.add(fore, { t: 'cyl', r: 0.03, h: 0.075, round: 0.025, p: [0, -0.36, 0.075], rot: [0, 0, Math.PI / 2], col: 'white', k: 0.02, skinSoft: 0.012 });
    }
    arms.push({ sh, up, fore });
  }
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = B(hips, [s * 0.17, -0.08, 0], s < 0 ? 'hipL' : 'hipR');
    S.add(hip, { t: 'cone', a: [0, 0.02, 0], b: [0, -0.34, 0], r1: 0.105, r2: 0.085, col: 'suit', k: 0.035, skinSoft: 0.01 });
    const knee = B(hip, [0, -0.36, 0], s < 0 ? 'kneeL' : 'kneeR');
    S.add(knee, { t: 'ell', r: [0.085, 0.08, 0.075], col: 'suitD', k: 0.015, skinSoft: 0.01 });
    S.add(knee, { t: 'cone', a: [0, -0.04, 0], b: [0, -0.28, 0], r1: 0.088, r2: 0.072, col: 'vorax', k: 0.03, skinSoft: 0.01 });
    S.paint(knee, { t: 'cone', a: [0, -0.24, 0], b: [0, -0.34, 0], r1: 0.12, r2: 0.12, col: 'grime', feather: 0.05 });
    const foot = B(knee, [0, -0.34, 0], s < 0 ? 'footL' : 'footR');
    S.add(foot, { t: 'ell', r: [0.075, 0.07, 0.08], p: [0, 0.02, 0], col: 'suitD', k: 0.02, skinSoft: 0.01 });
    legs.push({ hip, knee, foot });
  }
  skin(key, { mesh: { cell: 0.024, skinSoft: 0.025 }, mat: { enemyRim: true } });

  // ---------------------------------------------------------------- armure rigide
  const K = kit(key);
  const W = { col: T.white }, P = { col: T.vorax }, PD = { col: T.voraxD }, GD = { col: T.trim, met: T.trimMet };
  const DK = { col: T.dark, met: 0.7 }, BK = { col: T.black, rub: true, uv: 'clean' };
  root.updateMatrixWorld(true);

  // -- plastron : grande plaque blanche cintrée, liseré doré dessous, insigne Vorax peint
  const pecW = 0.5 + H * 0.06, pecH = 0.36 + H * 0.04;
  const pec = slabC(pecW, pecH, 0.07 + H * 0.02, { e: 0.45, bx: 0.34, by: 0.55, taper: 0.1 });
  const pecO = { p: [0, 0.43, 0.265], r: [-0.1, 0, 0] };
  K.add(torso, pec, { ...W, ...pecO, ol: true });
  K.add(torso, slab(pecW + 0.03, pecH + 0.03, 0.05, { e: 0.45, bx: 0.34, by: 0.55, taper: 0.1 }), { ...GD, p: [0, 0.418, 0.255], r: [-0.1, 0, 0] });
  const emb = [slabDecal(pec, new THREE.RingGeometry(0.062, 0.08, 28)), slabDecal(pec, chevron(0.1, 0.085, 0.026).translate(0, 0.004, 0))];
  K.add(torso, emb, { ...(heavy ? { col: T.trim, met: 0.2 } : { col: T.trim, met: 0.55 }), ...pecO, wear: 0.6 });
  K.add(torso, slabRivets(pec, [[-0.2, 0.12], [0.2, 0.12], [-0.21, -0.1], [0.21, -0.1]], 0.013), { ...GD, ...pecO, uv: 'clean' });
  // plaques abdominales qui se chevauchent
  for (const [i, y] of [0.205, 0.11].entries()) {
    const ab = slabC(0.36 - i * 0.03, 0.1, 0.045, { e: 0.3, bx: 0.22 + i * 0.01 });
    const o = { p: [0, y, 0.245 - i * 0.012], r: [0.12, 0, 0] };
    K.add(torso, ab, { ...P, ...o, ol: true });
    K.add(torso, slabRivets(ab, [[-0.13 + i * 0.01, 0], [0.13 - i * 0.01, 0]], 0.011), { ...GD, ...o, uv: 'clean' });
  }
  // gorgerin : collerette violette à bord doré
  K.add(torso, lathe([[0.2, 0.07], [0.235, 0.068], [0.275, 0.035], [0.305, -0.02], [0.295, -0.04], [0.26, -0.015], [0.22, 0.02], [0.2, 0.04]], 26, 0.86), { ...P, p: [0, 0.6, 0.0], ol: true });
  K.add(torso, G.torus(0.3, 0.014, 6, 26), { ...GD, p: [0, 0.572, 0.0], r: [Math.PI / 2, 0, 0], s: [1, 0.86, 1] });
  // flancs : plaques latérales sous les aisselles
  for (const s of [-1, 1]) {
    const fl = slabC(0.2, 0.2, 0.04, { e: 0.5, bx: 0.25 });
    K.add(torso, fl, { ...PD, p: [s * 0.3, 0.3, 0.02], r: [0, s * 1.25, s * 0.12], ol: true });
  }

  // -- sac dorsal / réacteur (morceau projeté à la mort)
  const pack = joint(torso, [0, 0.42, -0.295]);
  const box = slabC(0.38, 0.4, 0.17, { e: 0.25, rim: 0.2, bx: 0.6 });
  const boxO = { p: [0, 0, -0.06], r: [0, Math.PI, 0] };
  K.add(pack, box, { ...DK, ...boxO, ol: true });
  K.add(pack, G.rbox(0.2, 0.26, 0.08, 0.02, 2), { ...DK, p: [0, -0.02, 0.03] });
  for (const s of [-1, 1]) {
    K.add(pack, slab(0.07, 0.36, 0.2, { e: 0.3, rim: 0.3 }), { ...P, p: [s * 0.2, 0, -0.06], ol: true });
    // tuyères
    K.add(pack, lathe([[0, 0.02], [0.052, 0.02], [0.056, -0.01], [0.074, -0.075], [0.064, -0.08], [0.046, -0.03], [0, -0.03]], 14), { ...DK, p: [s * 0.1, -0.21, -0.07] });
    K.glow(pack, G.cyl(0.045, 0.045, 0.01, 12), T.energy, 2.6, { p: [s * 0.1, -0.27, -0.07] });
    // durites vers les flancs
    K.add(pack, hose([[s * 0.17, 0.08, 0.02], [s * 0.27, 0.06, 0.12], [s * 0.33, -0.04, 0.24]], 0.022, 12), { ...BK, dirt: 0 });
  }
  // grille d'aération, pile d'énergie, voyants
  for (let i = 0; i < 4; i++) K.add(pack, G.box(0.22, 0.016, 0.03), { ...BK, p: [0, 0.09 - i * 0.035, -0.158] });
  K.add(pack, G.rbox(0.25, 0.15, 0.02, 0.008, 2), { ...DK, p: [0, 0.035, -0.15] });
  K.add(pack, G.cyl(0.045, 0.045, 0.3, 12), { ...GD, p: [0, 0.22, -0.05], r: [0, 0, Math.PI / 2] });
  K.glow(pack, G.cyl(0.035, 0.035, 0.2, 10), T.energy, 2.6, { p: [0, 0.22, -0.05], r: [0, 0, Math.PI / 2], s: [1.02, 1, 1.02] });
  for (const x of [-0.05, 0, 0.05]) K.add(pack, G.box(0.012, 0.01, 0.09), { ...DK, p: [x, 0.22, -0.05], s: [1, 9, 1] });
  K.add(pack, slabRivets(box, [[-0.15, 0.16], [0.15, 0.16], [-0.15, -0.16], [0.15, -0.16]], 0.013), { ...GD, ...boxO, uv: 'clean' });
  for (const x of [0, 0.04, 0.08]) K.glow(pack, G.sphere(0.012, 6, 4), T.energy, 2.6, { p: [x, -0.11, -0.15] });

  // -- ceinturon, boucle, cartouchières, poches
  const bRx = 0.285, bRz = 0.228;
  K.add(hips, lathe([[0.27, -0.038], [0.287, -0.036], [0.293, -0.02], [0.293, 0.02], [0.287, 0.036], [0.27, 0.038]], 26, 0.8), { col: T.belt, met: 0.25, p: [0, 0.03, 0], ol: true });
  const buckle = slabC(0.14, 0.095, 0.035, { e: 0.6, bx: 0.3 });
  K.add(hips, buckle, { ...GD, p: [0, 0.03, 0.233], ol: true });
  K.add(hips, slabDecal(buckle, chevron(0.07, 0.055, 0.018)), { col: T.belt, met: 0.2, p: [0, 0.03, 0.233], wear: 0.5 });
  const onBelt = (a, out = 0) => {
    const x = Math.sin(a) * (bRx + out), z = Math.cos(a) * (bRz + out);
    return { p: [x, 0.03, z], r: [0, Math.atan2(Math.sin(a) / bRx, Math.cos(a) / bRz), 0] };
  };
  for (const s of [-1, 1]) {
    // cartouches : douilles dorées dans leurs passants
    for (let i = 0; i < 4; i++) {
      const o = onBelt(s * (0.42 + i * 0.13), 0.02);
      K.add(hips, G.cyl(0.019, 0.019, 0.075, 8), { ...GD, p: [o.p[0], 0.045, o.p[2]] });
      K.add(hips, G.cyl(0.021, 0.021, 0.025, 8), { ...DK, p: [o.p[0], 0.025, o.p[2]] });
    }
    // poches
    for (const a of [1.35, 2.25]) {
      const o = onBelt(s * a, 0.035);
      K.add(hips, G.rbox(0.1, 0.1, 0.06, 0.018, 2), { ...P, ...o, p: [o.p[0], 0.0, o.p[2]], ol: true });
      K.add(hips, G.rbox(0.106, 0.035, 0.068, 0.012, 2), { ...PD, ...o, p: [o.p[0], 0.045, o.p[2]] });
      const sn = onBelt(s * a, 0.068);
      K.add(hips, rivetG(0.012), { ...GD, ...sn, p: [sn.p[0], 0.03, sn.p[2]], uv: 'clean' });
    }
  }
  // tassettes avant et arrière
  const tas = slabC(0.18, 0.13 + H * 0.03, 0.04, { e: 0.4, bx: 0.25, taper: -0.2 });
  K.add(hips, tas, { ...P, p: [0, -0.07 - H * 0.015, 0.205], r: [0.18, 0, 0], ol: true });
  K.add(hips, slabRivets(tas, [[-0.055, 0.035], [0.055, 0.035]], 0.011), { ...GD, p: [0, -0.07 - H * 0.015, 0.205], r: [0.18, 0, 0], uv: 'clean' });
  K.add(hips, slabC(0.24, 0.12, 0.04, { e: 0.4, bx: 0.25 }), { ...PD, p: [0, -0.06, -0.19], r: [-0.18, Math.PI, 0], ol: true });

  // -- jambes : cuissards, genouillères dorées, jambières blanches, bottes crantées
  for (const [i, s] of [-1, 1].entries()) {
    const { hip, knee, foot } = legs[i];
    const th = slabC(0.17, 0.2, 0.04, { e: 0.45, bx: 0.11, taper: -0.15 });
    const tho = { p: [s * 0.03, -0.16, 0.085], r: [0.06, s * 0.35, 0] };
    K.add(hip, th, { ...P, ...tho, ol: true });
    K.add(hip, slabRivets(th, [[-0.055, 0.07], [0.055, 0.07]], 0.011), { ...GD, ...tho, uv: 'clean' });
    if (heavy) K.add(hip, slabC(0.15, 0.2, 0.04, { e: 0.45, bx: 0.11 }), { ...W, p: [s * 0.095, -0.12, 0], r: [0, s * 1.45, 0], ol: true });
    K.add(knee, slab(0.13, 0.12, 0.06, { e: 0.8, bx: 0.07, by: 0.08, rim: 0.3 }), { ...GD, p: [0, 0.0, 0.075], ol: true });
    K.add(knee, rivetG(0.016), { ...DK, p: [0, 0.0, 0.112], uv: 'clean' });
    const gr = slabC(0.15, 0.22, 0.04, { e: 0.45, bx: 0.1, taper: 0.18 });
    const gro = { p: [0, -0.17, 0.07], r: [-0.04, 0, 0] };
    K.add(knee, gr, { ...W, ...gro, ol: true });
    K.add(knee, slabRivets(gr, [[-0.05, 0.08], [0.05, 0.08], [-0.042, -0.08], [0.042, -0.08]], 0.01), { ...DK, ...gro, uv: 'clean' });
    K.add(knee, slabDecal(gr, new THREE.PlaneGeometry(0.03, 0.12, 1, 4)), { col: T.vorax, ...gro, wear: 0.4 });
    // botte : tige blanche, coque de pointe sombre, semelle noire crantée, revers
    K.add(foot, slab(0.17, 0.1, 0.27, { e: 0.5, rim: 0.35 }), { ...W, p: [0, 0.012, 0.05], ol: true });
    K.add(foot, slab(0.16, 0.085, 0.11, { e: 0.5, rim: 0.4 }), { ...DK, p: [0, 0.004, 0.155], ol: true });
    K.add(foot, slab(0.19, 0.036, 0.3, { e: 0.35, rim: 0.3 }), { ...BK, p: [0, -0.028, 0.055], ol: true });
    for (let k = 0; k < 5; k++) K.add(foot, G.rbox(0.18 - (k === 4 ? 0.02 : 0), 0.024, 0.036, 0.008, 1), { ...BK, p: [0, -0.05, -0.07 + k * 0.058] });
    K.add(foot, lathe([[0.07, 0.03], [0.09, 0.025], [0.095, -0.01], [0.075, -0.02]], 14), { ...P, p: [0, 0.075, 0.0] });
    K.add(foot, G.rbox(0.18, 0.025, 0.05, 0.01, 2), { ...P, p: [0, 0.045, 0.1], r: [0.35, 0, 0] });
  }

  // -- bras : épaulières en lames superposées, gantelet, canon
  const pads = [];
  for (const [i, s] of [-1, 1].entries()) {
    const { sh, fore } = arms[i];
    const pad = joint(sh, [s * 0.03, 0.06, 0]);
    pad.rotation.z = -s * 0.35;
    pad.updateMatrixWorld(true);
    const ps = heavy ? 1.12 : 1;
    const top = slabC(0.36 * ps, 0.32 * ps, 0.05, { e: 0.6, bx: 0.17 * ps, by: 0.2 * ps, rim: 0.18 });
    const topO = { p: [s * 0.02, 0.1, 0], r: [-Math.PI / 2, 0, 0] };
    K.add(pad, top, { ...P, ...topO, ol: true });
    K.add(pad, slab(0.38 * ps, 0.34 * ps, 0.04, { e: 0.6, bx: 0.17 * ps, by: 0.2 * ps, rim: 0.18 }), { ...GD, p: [s * 0.02, 0.084, 0], r: [-Math.PI / 2, 0, 0] });
    // galons de grade peints, rivets du bord
    for (const x of [0.055, 0.1]) K.add(pad, slabDecal(top, new THREE.PlaneGeometry(0.022, 0.2 * ps, 1, 10).translate(s * x * ps, 0, 0)), { col: T.white, ...topO, wear: 0.5 });
    K.add(pad, slabRivets(top, [[-0.13, 0.1], [-0.13, -0.1], [0.13, 0.1], [0.13, -0.1], [0, 0.125], [0, -0.125]].map(([x, y]) => [x * ps, y * ps]), 0.012), { ...GD, ...topO, uv: 'clean' });
    // lames sous l'épaulière (côté extérieur du bras)
    for (let k = 0; k < 2 + H; k++) {
      const lame = slab(0.2 * ps - k * 0.02, 0.07, 0.035, { e: 0.35, bx: 0.11 });
      K.add(pad, lame, { ...(k % 2 ? PD : P), p: [s * (0.165 * ps + k * 0.008), -0.075 - k * 0.055, 0], r: [0, s * Math.PI / 2, s * 0.12], ol: true });
    }
    pads.push(pad);
    if (s < 0) {
      // gantelet gauche : plaque, bague dorée, garde de phalanges
      const ga = slabC(0.12, 0.17, 0.03, { e: 0.45, bx: 0.08, taper: -0.15 });
      K.add(fore, ga, { ...P, p: [-0.072, -0.11, 0], r: [0, -Math.PI / 2, 0], ol: true });
      K.add(fore, slabRivets(ga, [[0, 0.06], [0, -0.06]], 0.011), { ...GD, p: [-0.072, -0.11, 0], r: [0, -Math.PI / 2, 0], uv: 'clean' });
      K.add(fore, G.torus(0.082, 0.02, 6, 16), { ...GD, p: [0, -0.215, 0], r: [Math.PI / 2, 0, 0] });
      const kn = slabC(0.15, 0.06, 0.03, { e: 0.4, bx: 0.1 });
      K.add(fore, kn, { ...DK, p: [0, -0.335, 0.1], r: [0.1, 0, 0], ol: true });
      K.add(fore, slabRivets(kn, [[-0.045, 0], [0, 0], [0.045, 0]], 0.012), { ...GD, p: [0, -0.335, 0.1], r: [0.1, 0, 0], uv: 'clean' });
    }
  }
  // canon (avant-bras droit) : carter violet, culasse, aérations lumineuses, pile, viseur
  const fr = arms[1].fore;
  K.add(fr, G.torus(0.088, 0.024, 6, 16), { ...DK, p: [0, -0.035, 0], r: [Math.PI / 2, 0, 0] });
  K.add(fr, lathe([[0, -0.05], [0.1, -0.05], [0.126, -0.08], [0.132, -0.2], [0.129, -0.31], [0.112, -0.36], [0, -0.36]], 18), { ...P, ol: true });
  for (const y of [-0.15, -0.27]) K.add(fr, G.torus(0.131, 0.007, 4, 18), { ...BK, p: [0, y, 0], r: [Math.PI / 2, 0, 0] });
  // culasse sur le dessus (vers le haut quand il vise)
  K.add(fr, G.rbox(0.12, 0.13, 0.07, 0.02, 2), { ...DK, p: [0, -0.115, 0.125], ol: true });
  for (const x of [-0.04, 0.04]) K.add(fr, G.cyl(0.018, 0.018, 0.02, 8), { ...GD, p: [x, -0.07, 0.165], r: [Math.PI / 2, 0, 0] });
  K.add(fr, G.rbox(0.03, 0.08, 0.03, 0.01, 2), { ...GD, p: [0, -0.15, 0.17] });
  K.add(fr, hose([[0.05, -0.17, 0.15], [0.12, -0.2, 0.1], [0.15, -0.15, 0.02]], 0.014, 10), { ...BK, dirt: 0 });
  // aérations latérales (fentes rouges qui luisent)
  for (const sx of [-1, 1]) {
    K.add(fr, G.rbox(0.035, 0.13, 0.085, 0.012, 2), { ...DK, p: [sx * 0.13, -0.24, 0] });
    for (let k = 0; k < 4; k++) {
      K.add(fr, G.box(0.012, 0.012, 0.075), { ...BK, p: [sx * 0.15, -0.195 - k * 0.03, 0] });
      K.glow(fr, G.box(0.006, 0.008, 0.06), T.energy, 2.2, { p: [sx * 0.152, -0.195 - k * 0.03, 0] });
    }
  }
  // pile d'énergie sous le canon (vers le sol quand il vise)
  K.add(fr, G.cyl(0.036, 0.036, 0.15, 10), { ...DK, p: [0, -0.2, -0.13] });
  K.glow(fr, G.cyl(0.03, 0.03, 0.1, 10), T.energy, 2.2, { p: [0, -0.2, -0.13], s: [1.05, 1, 1.05] });
  for (const y of [-0.18, -0.22]) K.add(fr, G.cyl(0.039, 0.039, 0.012, 10), { ...DK, p: [0, y, -0.13] });
  // viseur
  K.add(fr, G.rbox(0.035, 0.07, 0.035, 0.01, 2), { ...GD, p: [0, -0.28, 0.14] });
  K.glow(fr, G.sphere(0.012, 8, 6), T.energy, 2.2, { p: [0, -0.31, 0.145] });
  // bouche (morceau projeté) : manchon à ailettes, frein de bouche, anneau lumineux
  const barrel = joint(fr, [0, -0.36, 0]);
  barrel.updateMatrixWorld(true);
  K.add(barrel, G.cyl(0.07, 0.072, 0.14, 14), { ...DK, p: [0, -0.06, 0], ol: true });
  for (const y of [-0.025, -0.055, -0.085]) K.add(barrel, G.cyl(0.095, 0.095, 0.014, 14), { ...DK, p: [0, y, 0] });
  K.add(barrel, lathe([[0.05, -0.12], [0.088, -0.12], [0.092, -0.165], [0.08, -0.172], [0.05, -0.172]], 16), { ...GD, ol: true });
  K.add(barrel, G.cyl(0.05, 0.05, 0.004, 12), { ...BK, p: [0, -0.168, 0] });
  K.glow(barrel, G.torus(0.065, 0.014, 6, 16), T.energy, 3, { p: [0, -0.172, 0], r: [Math.PI / 2, 0, 0] });
  K.glow(barrel, G.cyl(0.036, 0.036, 0.006, 12), T.energy, 3, { p: [0, -0.158, 0] });

  // -- casque : visière (deux yeux plus vifs, en colère), grille de respiration, écouteurs, antenne
  const visor = joint(head, [0, 0.02, 0.17]);
  visor.updateMatrixWorld(true);
  K.glow(visor, G.ellipsoid(0.225, 0.062, 0.14), T.visor, 1.9);
  for (const s of [-1, 1]) K.glow(visor, G.sphere(1, 10, 6), T.eyes, 4, { p: [s * 0.078, 0.004, 0.124], r: [0, s * 0.5, s * 0.42], s: [0.052, 0.012, 0.02] });
  const gr = slabC(0.15, 0.075, 0.03, { e: 0.4, bx: 0.15 });
  K.add(head, gr, { ...DK, p: [0, -0.15, 0.215], r: [0.35, 0, 0], ol: true });
  for (let k = 0; k < 4; k++) K.add(head, G.box(0.1 - (k % 2) * 0.01, 0.007, 0.012), { ...BK, p: [0, -0.128 - k * 0.015, 0.234 - k * 0.006], r: [0.35, 0, 0] });
  for (const s of [-1, 1]) {
    K.add(head, G.torus(0.06, 0.012, 6, 18), { ...GD, p: [s * 0.29, -0.01, -0.01], r: [0, Math.PI / 2, 0] });
    K.add(head, G.cyl(0.04, 0.04, 0.02, 12), { ...DK, p: [s * 0.29, -0.01, -0.01], r: [0, 0, Math.PI / 2] });
  }
  // grille arrière du casque
  K.add(head, slabC(0.14, 0.08, 0.025, { e: 0.4, bx: 0.2 }), { ...DK, p: [0, -0.03, -0.24], r: [0.1, Math.PI, 0] });
  for (let k = 0; k < 3; k++) K.add(head, G.box(0.09, 0.008, 0.01), { ...BK, p: [0, -0.01 - k * 0.018, -0.255] });
  if (heavy) {
    // joues blindées
    for (const s of [-1, 1]) K.add(head, slabC(0.1, 0.13, 0.03, { e: 0.45, bx: 0.15 }), { ...PD, p: [s * 0.21, -0.1, 0.1], r: [0, s * 0.9, 0], ol: true });
  }
  const ant = joint(head, [0.13, 0.17, -0.06]);
  ant.rotation.z = -0.35;
  ant.updateMatrixWorld(true);
  K.add(ant, G.cyl(0.03, 0.036, 0.04, 10), { ...DK, p: [0, 0.0, 0] });
  K.add(ant, G.cyl(0.016, 0.02, 0.16, 6), { ...GD, p: [0, 0.1, 0] });
  K.add(ant, G.cyl(0.011, 0.013, 0.1, 6), { ...DK, p: [0, 0.22, 0] });
  K.glow(ant, G.sphere(0.036, 10, 8), T.energy, 3, { p: [0, 0.285, 0] });

  const m = { root, debrisColor: T.debris, hips, torso, head, arms, legs, gunTip: fr, chunks: [visor, pads[0], pads[1], barrel, ant, pack] };
  if (extra) extra(m, K, T);
  K.build();
  return m;
}

// ===================================================================== Larbin-Bouclier
// Variante blindée du Larbin : armure gris acier et cyan, plus lourde, grand bouclier d'énergie hexagonal au
// bras gauche (cadre d'acier boulonné, émetteurs aux coins, champ alvéolé).
export function larbinBouclier() { return larbinBase('larbinBouclier', true, shieldArm); }
function shieldArm(m, K, T) {
  // bouclier tenu par l'avant-bras gauche, face à l'avant (+y du bouclier) dans la garde qu'il prend en jeu
  // (les deux amortis du Larbin et du Bouclier s'équilibrent vers épaule ≈ -0,65, coude ≈ -0,5 : poing devant la
  // poitrine) ; décalé vers le centre du corps, 20 cm devant le poing
  const holder = joint(m.arms[0].fore, [0.42, -0.452, 0.173]);
  holder.rotation.set(2.72, 0, 0);
  const shield = joint(holder, [0, 0, 0]);
  // repère du bouclier : hexagone dans le plan xy, face avant +z
  const face = joint(shield, [0, 0, 0]);
  face.rotation.set(-Math.PI / 2, 0, 0.15); // compense l'écart du bras (z -0,15)
  face.updateMatrixWorld(true);
  const R = 0.62, ST = { col: '#5a6478', met: 0.75 }, SD = { col: T.voraxD, met: 0.5 };
  K.field(face, new THREE.CircleGeometry(R - 0.03, 6), T.trim);
  for (let k = 0; k < 6; k++) {
    const a0 = (k / 6) * TAU, a1 = ((k + 1) / 6) * TAU, am = (a0 + a1) / 2;
    const ap = R * Math.cos(Math.PI / 6);
    const mid = [Math.cos(am) * ap, Math.sin(am) * ap, 0], rot = [0, 0, am + Math.PI / 2];
    K.add(face, G.rbox(R * 0.9, 0.075, 0.06, 0.02, 2), { ...ST, p: mid, r: rot, ol: true });
    K.add(face, G.rbox(R * 0.7, 0.03, 0.075, 0.01, 1), { ...SD, p: [mid[0] * 0.93, mid[1] * 0.93, 0], r: rot });
    for (const t of [-0.17, 0.17]) {
      const tx = Math.cos(am + Math.PI / 2) * t, ty = Math.sin(am + Math.PI / 2) * t;
      for (const z of [1, -1]) K.add(face, rivetG(0.012), { col: T.trim, met: 0.3, p: [mid[0] + tx, mid[1] + ty, z * 0.031], r: [z > 0 ? 0 : Math.PI, 0, 0], uv: 'clean' });
    }
    // émetteurs aux coins
    const cx = Math.cos(a0) * R, cy = Math.sin(a0) * R;
    K.add(face, G.cyl(0.055, 0.06, 0.1, 6), { ...SD, p: [cx, cy, 0], r: [Math.PI / 2, 0, 0], ol: true });
    for (const z of [1, -1]) K.glow(face, G.sphere(0.026, 6, 4), T.trim, 3, { p: [cx, cy, z * 0.05] });
    // filet lumineux intérieur
    K.glow(face, G.box(R * 0.82, 0.01, 0.012), '#7ff8ff', 2.4, { p: [mid[0] * 0.9, mid[1] * 0.9, 0], r: rot });
  }
  // moyeu projecteur et poignée
  K.add(face, G.cyl(0.12, 0.13, 0.09, 12), { ...ST, r: [Math.PI / 2, 0, 0], ol: true });
  K.add(face, G.cyl(0.07, 0.07, 0.04, 6), { ...SD, p: [0, 0, 0.05], r: [Math.PI / 2, 0, 0] });
  K.glow(face, G.torus(0.095, 0.012, 6, 18), T.trim, 2.6, { p: [0, 0, 0.047] });
  K.glow(face, G.sphere(0.05, 12, 8), '#bffcff', 3, { p: [0, 0, 0.06], s: [1, 1, 0.45] });
  K.glow(face, G.torus(0.095, 0.012, 6, 18), T.trim, 2.6, { p: [0, 0, -0.047] });
  // bras de liaison jusqu'à la poigne, autour du poing
  const fist = face.worldToLocal(m.arms[0].fore.localToWorld(new THREE.Vector3(0, -0.29, 0.02)));
  const a = new THREE.Vector3(0, 0, -0.05), d = fist.clone().sub(a);
  const strut = G.cyl(0.03, 0.03, d.length(), 8).clone().applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  K.add(face, strut, { ...ST, p: a.clone().addScaledVector(d, 0.5).toArray() });
  K.add(face, G.torus(0.11, 0.025, 6, 16), { ...SD, p: fist.toArray(), r: [Math.atan2(d.y, d.z) + Math.PI / 2, 0, 0] });
  m.shield = shield;
  m.chunks.push(shield);
}
