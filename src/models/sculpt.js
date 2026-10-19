// Sculpture par champs de distance (SDF) : des primitives accrochées aux os d'un squelette fusionnent en douceur,
// puis le champ est maillé (« surface nets »), projeté sur la vraie surface, coloré (avec pastilles de peinture
// et occlusion ambiante calculée par le champ) et lesté de poids de peau automatiques → un SkinnedMesh d'un seul tenant.
// Le calcul lui-même vit dans sculptCore.js (exécuté dans des Workers au chargement, voir prebuildSculpts).
import * as THREE from 'three';
import { slotsTier } from '../engine/shaderSlots.js';
import { patchRim, outlineMaterial } from '../engine/materials.js';
import { meshPrims } from './sculptCore.js';
import '../engine/shading.js';
// worker intégré au script (blob) : il démarre aussi quand le jeu est ouvert depuis le disque (version fichier unique)
import SculptWorker from './sculpt.worker.js?worker&inline';

// ------------------------------------------------------------------ squelette
// Os créés comme des joint() classiques (position locale, rotation de repos) : l'animation procédurale les pilote.
export function bone(parent, p = [0, 0, 0], name, r) {
  const b = new THREE.Bone();
  b.position.set(p[0], p[1], p[2]);
  if (r) b.rotation.set(r[0], r[1], r[2]);
  if (name) b.name = name;
  if (parent) parent.add(b);
  return b;
}

// ------------------------------------------------------------------ sculpture
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();

export class Sculpt {
  // palette : { nom: { color, rough, metal, sheen, fur, coat } } (coat : vernis de peinture laquée)
  constructor(palette) {
    this.palette = palette;
    this.ops = [];
    this.palIndex = new Map(Object.keys(palette).map((k, i) => [k, i]));
  }
  // forme : { t: 'ell'|'sph'|'cone'|'box'|'torus'|'cyl'|'hex', p, rot, sc, ..., col, k, fuzz:[amp, freq], skinSoft }
  add(bone, shape) { this.ops.push({ op: 'add', bone, ...shape }); return this; }
  sub(bone, shape) { this.ops.push({ op: 'sub', bone, ...shape }); return this; }
  // peinture : ne change pas la forme, recolore ce qui est à l'intérieur du volume (fondu « feather »)
  paint(bone, shape) { this.ops.push({ op: 'paint', bone, ...shape }); return this; }

  // Primitives « à plat » (sérialisables) : matrice modèle → local, paramètres, boîte englobante
  prepare(root, bones) {
    root.updateMatrixWorld(true);
    const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const boneIndex = new Map(bones.map((b, i) => [b, i]));
    return this.ops.map((o) => {
      _m.copy(rootInv).multiply(o.bone.matrixWorld);
      const pos = o.p || [0, 0, 0];
      _e.set(...(o.rot || [0, 0, 0]));
      _q.setFromEuler(_e);
      _m2.compose(_p.set(pos[0], pos[1], pos[2]), _q, _one);
      _m.multiply(_m2);
      const P = {
        op: o.op, t: o.t, k: o.k ?? 0.02, inv: Array.from(_m.clone().invert().elements),
        colIdx: o.col !== undefined ? this.palIndex.get(o.col) : -1,
        boneIdx: boneIndex.get(o.bone) ?? 0, skin: o.skin, skinSoft: o.skinSoft,
        fuzz: o.fuzz, sc: o.sc, feather: o.feather,
        r: o.r, s: o.s, round: o.round, R: o.R, h: o.h, r1: o.r1, r2: o.r2,
      };
      if (o.col !== undefined && P.colIdx === undefined) throw new Error('Couleur inconnue : ' + o.col);
      if (o.t === 'cone') {
        P.ax = o.a[0]; P.ay = o.a[1]; P.az = o.a[2];
        P.bx = o.b[0]; P.by = o.b[1]; P.bz = o.b[2];
        const dx = P.bx - P.ax, dy = P.by - P.ay, dz = P.bz - P.az;
        P.l2 = Math.max(1e-8, dx * dx + dy * dy + dz * dz);
      }
      // boîte englobante locale → espace modèle
      let lo, hi;
      if (o.t === 'sph') { const r = o.r; lo = [-r, -r, -r]; hi = [r, r, r]; }
      else if (o.t === 'ell') { lo = o.r.map((v) => -v); hi = o.r.slice(); }
      else if (o.t === 'box') { lo = o.s.map((v) => -v); hi = o.s.slice(); }
      else if (o.t === 'torus') { const R = o.R + o.r; lo = [-R, -o.r, -R]; hi = [R, o.r, R]; }
      else if (o.t === 'cyl') { lo = [-o.r, -o.h, -o.r]; hi = [o.r, o.h, o.r]; }
      else if (o.t === 'hex') { const R = o.r * 1.155; lo = [-R, -o.h, -R]; hi = [R, o.h, R]; }
      else if (o.t === 'cone') {
        const r = Math.max(o.r1, o.r2);
        lo = [Math.min(o.a[0], o.b[0]) - r, Math.min(o.a[1], o.b[1]) - r, Math.min(o.a[2], o.b[2]) - r];
        hi = [Math.max(o.a[0], o.b[0]) + r, Math.max(o.a[1], o.b[1]) + r, Math.max(o.a[2], o.b[2]) + r];
      } else throw new Error('Forme inconnue : ' + o.t);
      if (o.sc) { lo = lo.map((v, i) => v * o.sc[i]); hi = hi.map((v, i) => v * o.sc[i]); }
      const pad = P.k + (o.fuzz ? Math.abs(o.fuzz[0]) : 0) + (o.feather || 0);
      const box = new THREE.Box3(new THREE.Vector3(lo[0] - pad, lo[1] - pad, lo[2] - pad), new THREE.Vector3(hi[0] + pad, hi[1] + pad, hi[2] + pad));
      box.applyMatrix4(_m);
      P.box = [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z];
      return P;
    });
  }
  palArray() {
    return Object.values(this.palette).map((p) => {
      const c = new THREE.Color(p.color);
      return { c: [c.r, c.g, c.b], s: [p.rough ?? 0.6, p.metal ?? 0, p.sheen ?? 0, p.fur ?? 0, p.coat ?? 0] };
    });
  }
  job(root, bones, o = {}) {
    return { prims: this.prepare(root, bones), pal: this.palArray(), opts: o };
  }
  buildGeometry(root, bones, o = {}) {
    const j = this.job(root, bones, o);
    return geometryFromArrays(meshPrims(j.prims, j.pal, j.opts));
  }
}

function geometryFromArrays(a) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(a.color, 3));
  geo.setAttribute('surf', new THREE.BufferAttribute(a.surf, 4));
  if (a.coat) geo.setAttribute('coat', new THREE.BufferAttribute(a.coat, 1));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(a.skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(a.skinWeight, 4));
  geo.setIndex(new THREE.BufferAttribute(a.index, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  geo.userData.stats = a.stats;
  geo.userData.shared = true;
  return geo;
}

// ------------------------------------------------------------------ cache, collecte et pré-calcul en parallèle
const GEO_CACHE = new Map();
let collecting = null;

// Corps sculpté d'un modèle : géométrie en cache (calculée une fois par clé) → SkinnedMesh propre à l'instance.
// o : { mesh: { cell, skinSoft, colorSoft }, mat: { sheenColor, enemyRim }, outline, outlineColor }
export function sculptSkin(key, S, root, bones, o = {}) {
  let geo = GEO_CACHE.get(key);
  if (!geo) {
    if (collecting) {
      // mode collecte : on note le travail, la géométrie sera calculée dans un Worker
      if (!collecting.some((j) => j.key === key)) collecting.push({ key, ...S.job(root, bones, o.mesh || {}) });
      return null;
    }
    geo = S.buildGeometry(root, bones, o.mesh || {});
    GEO_CACHE.set(key, geo);
  }
  const m = sculptMaterial(o.mat || {});
  if (Object.values(S.palette).some((p) => p.coat)) withCoat(m, o.mat?.coatRough);
  return skinnedFromGeometry(root, bones, geo, m, { outline: o.outline, outlineColor: o.outlineColor });
}
export function sculptStats(key) { return GEO_CACHE.get(key)?.userData.stats; }

// Appelle les fabriques de modèles en mode « collecte », puis calcule toutes les géométries dans des Workers
export async function prebuildSculpts(factories) {
  collecting = [];
  for (const f of factories) {
    try { f(); } catch (e) { console.warn('Sculpture : fabrique en échec pendant la collecte', e); }
  }
  const jobs = collecting.filter((j) => !GEO_CACHE.has(j.key));
  collecting = null;
  if (!jobs.length) return;
  const t0 = performance.now();
  let results;
  try {
    results = await runInWorkers(jobs);
  } catch (e) {
    console.warn('Sculpture : Workers indisponibles, calcul sur le fil principal', e);
    results = jobs.map((j) => meshPrims(j.prims, j.pal, j.opts));
  }
  jobs.forEach((j, i) => GEO_CACHE.set(j.key, geometryFromArrays(results[i])));
  if (import.meta.env.DEV) window.__sculptMs = Math.round(performance.now() - t0);
}

function runInWorkers(jobs) {
  const n = Math.max(1, Math.min(jobs.length, (navigator.hardwareConcurrency || 4) - 1, 8));
  const workers = Array.from({ length: n }, () => new SculptWorker());
  // les plus gros calculs d'abord
  const order = jobs.map((j, i) => i).sort((a, b) => cost(jobs[b]) - cost(jobs[a]));
  const results = new Array(jobs.length);
  let next = 0, done = 0;
  return new Promise((resolve, reject) => {
    const feed = (w) => {
      if (next >= order.length) return;
      const i = order[next++];
      w.onmessage = (ev) => {
        results[i] = ev.data;
        done++;
        if (done === jobs.length) { workers.forEach((x) => x.terminate()); resolve(results); }
        else feed(w);
      };
      w.onerror = (err) => { workers.forEach((x) => x.terminate()); reject(err); };
      w.postMessage(jobs[i]);
    };
    workers.forEach(feed);
  });
}
function cost(j) {
  const c = j.opts.cell || 0.012;
  let vol = 0;
  for (const p of j.prims) vol += (p.box[3] - p.box[0]) * (p.box[4] - p.box[1]) * (p.box[5] - p.box[2]);
  return vol / (c * c * c);
}

// ------------------------------------------------------------------ matériau
// Matériau physique piloté par sommet : rugosité, métal, reflet satiné (sheen) et « fourrure » (micro-relief
// de poils calculé dans le repère de repos, qui suit donc la peau).
const SCULPT_PARS_V = /* glsl */ `
attribute vec4 surf;
varying vec4 vSurf;
varying vec3 vRest;
`;
const SCULPT_PARS_F = /* glsl */ `
varying vec4 vSurf;
varying vec3 vRest;
float sHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float sNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sHash(i), sHash(i + vec3(1,0,0)), f.x), mix(sHash(i + vec3(0,1,0)), sHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(sHash(i + vec3(0,0,1)), sHash(i + vec3(1,0,1)), f.x), mix(sHash(i + vec3(0,1,1)), sHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
`;

function sculptMaterial(o = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, vertexColors: true, roughness: 1, metalness: 1,
    sheen: 1, sheenRoughness: o.sheenRoughness ?? 0.45, sheenColor: new THREE.Color(o.sheenColor || '#ffe2b8'),
  });
  m.userData.enemyRim = !!o.enemyRim;
  patchRim(m, o.rim ?? 1, (shader) => {
    shader.vertexShader = SCULPT_PARS_V + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurf = surf;\nvRest = position;');
    // diffusion douce du soleil, plus marquée sur la fourrure
    shader.fragmentShader = '#define KOBI_SKIN ( 0.35 + 0.65 * vSurf.w )\n#define CHAR_LIGHT\n' + SCULPT_PARS_F + shader.fragmentShader
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vSurf.x;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vSurf.y;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (vSurf.w > 0.01) {
          // poils : bruit étiré, estompé quand il devient plus fin qu'un pixel
          vec3 q = vRest * vec3(260.0, 90.0, 260.0);
          float fw = length(fwidth(q));
          float furK = vSurf.w * clamp(1.6 - fw * 0.9, 0.0, 1.0);
          float n1 = sNoise(q), n2 = sNoise(q * 2.1 + 7.0);
          vec3 jitter = vec3(n1 - 0.5, n2 - 0.5, sNoise(q * 1.3 + 3.0) - 0.5);
          normal = normalize(normal + jitter * 0.55 * furK);
          diffuseColor.rgb *= 1.0 - (1.0 - n1 * n2 * 1.6) * 0.16 * furK;
        }`)
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nmaterial.sheenColor *= vSurf.z;');
  });
  m.customProgramCacheKey = () => 'sculpt' + slotsTier();
  return m;
}

// Vernis par sommet (attribut coat, tiré de la palette) : une couche laquée sur les peintures, pas sur la fourrure.
// Ajouté aux retouches du matériau (rimExtra) pour survivre aux copies de cloneMat.
function withCoat(m, rough = 0.07) {
  const extra = m.userData.rimExtra;
  patchRim(m, m.userData.rimMul.value, (shader) => {
    if (extra) extra(shader);
    shader.vertexShader = 'attribute float coat;\nvarying float vCoat;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCoat = coat;');
    shader.fragmentShader = 'varying float vCoat;\n' + shader.fragmentShader
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat *= vCoat;\n#endif');
  });
  m.clearcoat = 1;
  m.clearcoatRoughness = rough;
  m.customProgramCacheKey = () => 'sculptCoat' + slotsTier();
  return m;
}

// Assemble un SkinnedMesh (plus son contour) lié aux os fournis
function skinnedFromGeometry(root, bones, geo, material, o = {}) {
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = !!o.receive;
  root.add(mesh);
  mesh.bind(skeleton);
  const r = geo.boundingSphere.radius * 1.6;
  mesh.boundingSphere = new THREE.Sphere(geo.boundingSphere.center.clone(), r);
  if (o.outline) {
    const ol = new THREE.SkinnedMesh(geo, outlineMaterial(o.outlineColor || '#1d1028', o.outline));
    ol.castShadow = false;
    ol.userData.isOutline = true;
    ol.raycast = () => {};
    root.add(ol);
    ol.bind(skeleton, mesh.bindMatrix);
    ol.boundingSphere = mesh.boundingSphere;
    mesh.userData.outline = ol;
  }
  return mesh;
}
