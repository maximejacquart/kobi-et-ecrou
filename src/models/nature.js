// Végétation et atmosphère : herbe instanciée animée (vent + passage de Kobi), particules d'ambiance.
import * as THREE from 'three';
import { globalU } from '../engine/materials.js';
import { injectSlots, slotsTier } from '../engine/shaderSlots.js';
import '../engine/shading.js';
import { rng as mkRng, noise2, fbm2 } from '../engine/util.js';
import { noiseTexture } from '../engine/sky.js';
import { QUALITY } from '../engine/frame.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const natureU = { uPlayer: { value: new THREE.Vector3(0, -999, 0) } };

function clumpGeometry(blades = 5, seed = 1) {
  const R = mkRng(seed);
  const pos = [], uv = [], nrm = [], idx = [];
  let v = 0;
  for (let b = 0; b < blades; b++) {
    const a = R() * Math.PI;
    const ox = (R() - 0.5) * 0.28, oz = (R() - 0.5) * 0.28;
    const h = 0.6 + R() * 0.5;
    const w = 0.05 + R() * 0.035;
    const bend = (R() - 0.5) * 0.3;
    const ca = Math.cos(a), sa = Math.sin(a);
    const seg = 3;
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const ww = w * (1 - t * 0.92);
      const y = h * t;
      const off = bend * t * t;
      for (const s of [-1, 1]) {
        pos.push(ox + ca * ww * s + sa * off, y, oz - sa * ww * s + ca * off);
        uv.push(s * 0.5 + 0.5, t);
        nrm.push(0, 1, 0);
      }
      if (i < seg) idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      v += 2;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

// points : [{x, y, z}] ; o : { base, tip, height:[min,max], blades }
export function grassField(L, points, o = {}) {
  if (!points.length) return null;
  const geo = clumpGeometry(o.blades || 5, o.seed || 3);
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  const base = new THREE.Color(o.base || '#2f8f45'), tip = new THREE.Color(o.tip || '#b5ec6a');
  const uBase = { value: base }, uTip = { value: tip }, uSway = { value: o.sway ?? 1 };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = globalU.uTime;
    shader.uniforms.uPlayer = natureU.uPlayer;
    shader.uniforms.uBase = uBase;
    shader.uniforms.uTip = uTip;
    shader.uniforms.uSway = uSway;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec3 uPlayer; uniform float uSway; varying float vGH;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vGH = uv.y;
        vec3 ip = vec3(instanceMatrix[3]);
        float h2 = uv.y * uv.y;
        float w = sin(uTime * 1.7 + ip.x * 0.31 + ip.z * 0.23) * 0.13 + sin(uTime * 3.3 + ip.x * 0.9 + ip.z * 0.5) * 0.04;
        vec3 wOff = vec3(w, 0.0, w * 0.6) * h2 * uSway;
        vec2 away = ip.xz - uPlayer.xz;
        float d = length(away);
        float push = smoothstep(1.3, 0.15, d) * step(abs(ip.y - uPlayer.y), 1.5) * h2;
        wOff += vec3(normalize(away + 1e-4).x * 0.55, -0.35, normalize(away + 1e-4).y * 0.55) * push;
        transformed += inverse(mat3(instanceMatrix)) * wOff;`);
    // brins translucides : le soleil les traverse à contre-jour, plus fort vers la pointe
    shader.fragmentShader = '#define KOBI_FOLIAGE ( 0.35 + 0.9 * vGH )\n#define KOBI_GRASS\n' + shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uBase; uniform vec3 uTip; varying float vGH;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= mix(uBase, uTip, vGH) * (0.75 + 0.35 * vGH);');
    injectSlots(shader);
  };
  m.customProgramCacheKey = () => 'grass' + slotsTier();
  const mesh = new THREE.InstancedMesh(geo, m, points.length);
  const mx = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const R = mkRng(o.seed || 7);
  const [h0, h1] = o.height || [0.35, 0.7];
  const col = new THREE.Color();
  points.forEach((pt, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * Math.PI * 2);
    const sc = h0 + R() * (h1 - h0);
    s.set(0.8 + R() * 0.5, sc, 0.8 + R() * 0.5);
    p.set(pt.x, pt.y - 0.03, pt.z);
    mx.compose(p, q, s);
    mesh.setMatrixAt(i, mx);
    col.setHSL(0, 0, 0.82 + R() * 0.3);
    mesh.setColorAt(i, col);
  });
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  mesh.userData.noAO = true;
  L.root.add(mesh);
  return mesh;
}

// ------------------------------------------------------------- pelouse dense
// Touffe de brins fins, effilés et courbés qui s'écartent du centre ; aBase : pied du brin (x, z) et phase.
// Normales tirées vers le ciel (et vers la courbure du brin) : la pelouse s'éclaire comme une masse, pas comme des
// lamelles qui virent au noir de dos.
function lawnClump(blades, seed) {
  const R = mkRng(seed);
  const pos = [], uv = [], nrm = [], base = [], idx = [];
  let v = 0;
  for (let b = 0; b < blades; b++) {
    const a = R() * Math.PI * 2, d = Math.sqrt(R()) * 0.15;
    const ox = Math.cos(a) * d, oz = Math.sin(a) * d;
    const h = 0.55 + R() * 0.45;
    const w = 0.026 + R() * 0.018;
    // le brin penche vers l'extérieur de la touffe, un peu au hasard
    const la = a + (R() - 0.5) * 1.2, lean = (0.12 + R() * 0.3) * h;
    const lx = Math.cos(la), lz = Math.sin(la);
    // face du brin : à peu près perpendiculaire à son penchant, légèrement vrillée
    const fa = la + Math.PI / 2 + (R() - 0.5) * 0.8, wx = Math.cos(fa), wz = Math.sin(fa);
    const ph = R();
    const seg = 3;
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const ww = w * (1 - Math.pow(t, 1.5) * 0.94) * (i === 0 ? 0.8 : 1);
      const off = lean * t * t;
      for (const s of [-1, 1]) {
        pos.push(ox + lx * off + wx * ww * s, h * t * (1 - 0.18 * (lean / h) * t), oz + lz * off + wz * ww * s);
        uv.push(s * 0.5 + 0.5, t);
        const n = new THREE.Vector3(lx * 0.35 * t + wx * s * 0.25, 1, lz * 0.35 * t + wz * s * 0.25).normalize();
        nrm.push(n.x, n.y, n.z);
        base.push(ox, oz, ph);
      }
      if (i < seg) idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      v += 2;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aBase', new THREE.Float32BufferAttribute(base, 3));
  g.setIndex(idx);
  return g;
}

// Fleur des prés : tige, cinq pétales en coupelle, cœur ; la couleur « kind » (attribut color.r) dit quelle partie
// c'est (0 : tige, 0,5 : cœur, 1 : pétale) — la teinte des pétales vient de l'instance.
function flowerGeometry() {
  const parts = [];
  const tag = (g, k) => { g = g.index ? g.toNonIndexed() : g; const n = g.attributes.position.count; g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(k), 3)); g.deleteAttribute('uv'); return g; };
  parts.push(tag(new THREE.CylinderGeometry(0.008, 0.012, 1, 4, 1, true).translate(0, 0.5, 0), 0));
  for (let k = 0; k < 5; k++) {
    const p = new THREE.SphereGeometry(1, 6, 3);
    p.scale(0.055, 0.012, 0.028).translate(0.06, 0, 0).rotateZ(0.35).rotateY((k / 5) * Math.PI * 2).translate(0, 1, 0);
    parts.push(tag(p, 1));
  }
  parts.push(tag(new THREE.SphereGeometry(0.026, 6, 4).scale(1, 0.7, 1).translate(0, 1.012, 0), 0.5));
  const g = mergeGeometries(parts);
  // la tige garde sa longueur (échelle y de l'instance) ; la tête (au-dessus de 0,98) garde sa taille
  return g;
}

// Pelouse dense des îles : touffes de brins instanciées par carreaux de 6 m. Chaque touffe a un rang (0-1) ; elle
// n'est dessinée que si son rang passe sous la densité voulue à sa distance de la caméra (au loin, moins de touffes
// mais des brins plus larges, avec un fondu en hauteur : pas de saut). Le vent passe en grandes rafales qui couchent
// et éclaircissent l'herbe, Kobi l'écarte en marchant.
// areas : [{ x, y, z, r, dig(x, z) (creux : pas d'herbe), sparse (ruines : herbe clairsemée), clear: {x, z, r} }]
// o : { avoid: [{ x, z, r }], spacing, height: [min, max], root: [a, b], tip: [a, b], wind: [x, z], seed,
//       flowers: { colors: [...], amount } }
const lawnU = { uDens: { value: 1 } };
Object.assign(QUALITY.ultra, { lawnDensity: 1 });
Object.assign(QUALITY.haute, { lawnDensity: 0.8 });
Object.assign(QUALITY.moyenne, { lawnDensity: 0.55 });
export function lawn(L, areas, o = {}) {
  const R = mkRng(o.seed ?? 5);
  const S = o.spacing ?? 0.2, CH = 6;
  const [h0, h1] = o.height || [0.16, 0.4];
  const avoid = o.avoid || [];
  const chunks = new Map();
  const fl = [];
  const flowerCols = (o.flowers && o.flowers.colors || ['#ffffff']).map((c) => new THREE.Color(c));
  for (const A of areas) {
    const r = A.r, seed = (A.x * 7.1 + A.z * 3.3) | 0;
    for (let z = A.z - r; z <= A.z + r; z += S) {
      for (let x = A.x - r; x <= A.x + r; x += S) {
        const px = x + (R() - 0.5) * S * 0.9, pz = z + (R() - 0.5) * S * 0.9;
        const k = Math.hypot(px - A.x, pz - A.z) / r;
        if (k > 1) continue;
        if (avoid.some((c) => Math.hypot(px - c.x, pz - c.z) < c.r)) continue;
        if (A.clear && Math.hypot(px - A.clear.x, pz - A.clear.z) < A.clear.r * (0.75 + 0.25 * noise2(px * 0.7, pz * 0.7, 3))) continue;
        let bank = 1;
        if (A.dig) {
          if (A.dig(px, pz) > 0.004) continue;
          // l'herbe s'éclaircit et raccourcit en approchant de l'eau (la rive reste lisible)
          const near = A.dig(px, pz, 1.35);
          if (near > 0.004 && R() < 0.6) continue;
          bank = near > 0.004 ? 0.75 : 1;
        }
        const n = fbm2(px * 0.16, pz * 0.16, 3, seed);
        if (A.sparse && n < 0.48 + R() * 0.1) continue;
        // plus courte au bord de l'île (le vent la rase), plus haute par plaques
        const edge = 1 - 0.55 * Math.max(0, (k - 0.82) / 0.18);
        const hh = (h0 + (h1 - h0) * Math.min(1, Math.max(0, n * 1.6 - 0.3)) * (0.75 + R() * 0.5)) * edge * bank;
        const key = Math.floor(px / CH) + ',' + Math.floor(pz / CH);
        let c = chunks.get(key);
        if (!c) chunks.set(key, (c = []));
        // teinte : luminosité, plaque de couleur (bruit lent), rang
        c.push([px, A.y, pz, hh, R() * Math.PI * 2, 0.72 + R() * 0.4, Math.min(1, Math.max(0, fbm2(px * 0.07 + 40, pz * 0.07, 3, seed + 9) * 1.7 - 0.35)), R()]);
        // fleurs des prés, en colonies
        if (o.flowers && A.flowers !== false && !A.sparse && fbm2(px * 0.12 + 7, pz * 0.12, 2, seed + 4) > 0.6 && R() < (o.flowers.amount ?? 0.05)) {
          fl.push([px + (R() - 0.5) * 0.1, A.y, pz + (R() - 0.5) * 0.1, hh * (1.05 + R() * 0.35), flowerCols[Math.floor(fbm2(px * 0.3, pz * 0.3, 1, seed + 2) * flowerCols.length * 1.3) % flowerCols.length]]);
        }
      }
    }
  }
  const geo = lawnClump(o.blades ?? 9, o.seed ?? 5);
  const uRootA = { value: new THREE.Color((o.root || [])[0] || '#155a2a') }, uRootB = { value: new THREE.Color((o.root || [])[1] || '#14523c') };
  const uTipA = { value: new THREE.Color((o.tip || [])[0] || '#5cc24e') }, uTipB = { value: new THREE.Color((o.tip || [])[1] || '#5ec98a') };
  const w = new THREE.Vector2(...(o.wind || [0.94, 0.34])).normalize();
  const uWind = { value: w };
  const noise = noiseTexture();
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.72, metalness: 0, side: THREE.DoubleSide });
  const WIND = /* glsl */ `
    vec3 ip = vec3(instanceMatrix[3]);
    float bh = length(instanceMatrix[1].xyz);
    float gust = smoothstep(0.32, 0.78, textureLod(tLawnNoise, ip.xz * 0.0045 - uWind * uTime * 0.011, 0.0).a);
    float fl = sin(uTime * 2.2 + ip.x * 0.8 + ip.z * 0.6 + aBase.z * 6.28);
    vec3 wOff = vec3(uWind.x, 0.0, uWind.y) * (0.08 + 0.42 * gust + 0.06 * fl) + vec3(-uWind.y, 0.0, uWind.x) * 0.05 * fl;
    vec2 away = ip.xz - uPlayer.xz;
    float push = smoothstep(1.0, 0.1, length(away)) * step(abs(ip.y - uPlayer.y), 1.5);
    wOff += vec3(normalize(away + 1e-4).x, 0.0, normalize(away + 1e-4).y) * push * 0.9;
    wOff *= lawnH * lawnH * bh * 1.4;
    wOff.y = -dot(wOff.xz, wOff.xz) * 0.8 / max(bh, 0.1) - push * 0.25 * bh * lawnH;`;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uTime: globalU.uTime, uPlayer: natureU.uPlayer, uDens: lawnU.uDens, uWind, tLawnNoise: { value: noise }, uRootA, uRootB, uTipA, uTipB });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec3 uPlayer; uniform float uDens; uniform vec2 uWind; uniform sampler2D tLawnNoise;\nattribute vec3 aBase;\nvarying float vGH; varying float vGust; varying vec2 vTint;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvColor.rgb = vec3(1.0);\nvTint = instanceColor.rg;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float lawnH = uv.y;
        ${WIND}
        // densité selon la distance : la touffe s'efface (en hauteur) si son rang dépasse la densité voulue
        float dc = distance(ip, cameraPosition);
        float dens = uDens * mix(1.0, 0.22, smoothstep(6.0, 32.0, dc)) * mix(1.0, 0.35, smoothstep(32.0, 100.0, dc));
        float keep = 1.0 - smoothstep(dens * 0.8, dens, instanceColor.b);
        float wk = clamp(inversesqrt(max(dens / max(uDens, 0.01), 0.05)), 1.0, 2.6);
        transformed.xz = aBase.xy + (transformed.xz - aBase.xy) * wk;
        transformed.y *= keep;
        vGH = uv.y;
        vGust = gust;
        transformed += inverse(mat3(instanceMatrix)) * wOff * keep;`);
    // brins translucides : le soleil les traverse à contre-jour, plus fort vers la pointe
    shader.fragmentShader = '#define KOBI_FOLIAGE ( 0.35 + 0.9 * vGH )\n#define KOBI_GRASS\n' + shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRootA; uniform vec3 uRootB; uniform vec3 uTipA; uniform vec3 uTipB;\nvarying float vGH; varying float vGust; varying vec2 vTint;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 gc = mix(mix(uRootA, uRootB, vTint.y), mix(uTipA, uTipB, vTint.y), smoothstep(0.0, 1.0, vGH));
        // pied des touffes dans l'ombre des autres brins ; une rafale couche l'herbe et montre sa face claire
        gc *= vTint.x * mix(0.42, 1.0, smoothstep(0.0, 0.6, vGH)) * (1.0 + vGust * vGH * 0.3);
        diffuseColor.rgb *= gc;`)
      // recto et verso éclairés pareil (normales vers le ciel)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);\nnonPerturbedNormal = normal;');
    injectSlots(shader);
  };
  m.customProgramCacheKey = () => 'lawn' + slotsTier();
  const mx = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  const meshes = [];
  for (const list of chunks.values()) {
    // par rang croissant : réduire mesh.count retire d'abord les touffes de rang élevé
    list.sort((a, b) => a[7] - b[7]);
    const mesh = new THREE.InstancedMesh(geo, m, list.length);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y = 0;
    list.forEach(([x, yy, z, h, yaw, br, hue, rank], i) => {
      q.setFromAxisAngle(up, yaw);
      const wd = 0.85 + (rank * 7.3 % 1) * 0.4;
      mx.compose(p.set(x, yy - 0.02, z), q, s.set(wd, h, wd));
      mesh.setMatrixAt(i, mx);
      mesh.setColorAt(i, col.setRGB(br, hue, rank));
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); y = yy;
    });
    mesh.computeBoundingSphere();
    mesh.boundingSphere.radius += 1;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.userData.noAO = true;
    mesh.userData.noReflect = true;
    mesh.userData.noProbe = true;
    mesh.userData.lawn = { x0, x1, z0, z1, y, n: list.length, ranks: list.map((e) => e[7]) };
    L.root.add(mesh);
    meshes.push(mesh);
  }
  // fleurs : tige + tête, mêmes rafales que l'herbe
  if (fl.length) {
    const fm = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, metalness: 0, vertexColors: true });
    fm.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, { uTime: globalU.uTime, uPlayer: natureU.uPlayer, uWind, tLawnNoise: { value: noise } });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec3 uPlayer; uniform vec2 uWind; uniform sampler2D tLawnNoise;')
        .replace('#include <color_vertex>', `vec3 aBase = vec3(0.0, 0.0, fract(instanceMatrix[3].x * 3.7));
          float kind = color.r;
          vColor.rgb = kind < 0.25 ? vec3(0.22, 0.52, 0.2) : kind < 0.75 ? vec3(1.0, 0.78, 0.22) : instanceColor.rgb;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          // la tête garde sa taille quelle que soit la hauteur de la tige
          float sy = length(instanceMatrix[1].xyz);
          if (position.y > 0.97) transformed.y = 1.0 + (position.y - 1.0) / sy;
          float lawnH = min(position.y, 1.0);
          ${WIND}
          transformed += inverse(mat3(instanceMatrix)) * wOff * 0.8;`);
      injectSlots(shader);
    };
    fm.customProgramCacheKey = () => 'lawnFlower' + slotsTier();
    const fgeo = flowerGeometry();
    const fmesh = new THREE.InstancedMesh(fgeo, fm, fl.length);
    fl.forEach(([x, y, z, h, c], i) => {
      q.setFromEuler(new THREE.Euler((R() - 0.5) * 0.3, R() * 6.28, (R() - 0.5) * 0.3));
      mx.compose(p.set(x, y - 0.02, z), q, s.set(1, h, 1));
      fmesh.setMatrixAt(i, mx);
      fmesh.setColorAt(i, c);
    });
    fmesh.computeBoundingSphere();
    fmesh.receiveShadow = true;
    fmesh.castShadow = false;
    fmesh.userData.noAO = true;
    fmesh.userData.noProbe = true;
    L.root.add(fmesh);
  }
  // nombre de touffes envoyées à la carte : celles dont le rang peut passer sous la densité au point le plus proche
  // du carreau
  const cam = L.game.camera.cam;
  L.every(() => {
    const qd = L.game.R.Q.lawnDensity ?? 1;
    lawnU.uDens.value = qd;
    const c = cam.position;
    for (const mesh of meshes) {
      const d = mesh.userData.lawn;
      const dx = Math.max(d.x0 - c.x, 0, c.x - d.x1), dz = Math.max(d.z0 - c.z, 0, c.z - d.z1);
      const dc = Math.hypot(dx, dz, d.y - c.y);
      const ss = (a, b, t) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };
      const dens = qd * (1 - 0.78 * ss(6, 32, dc)) * (1 - 0.65 * ss(32, 100, dc));
      let lo = 0, hi = d.n;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (d.ranks[mid] < dens) lo = mid + 1; else hi = mid; }
      mesh.count = lo;
      mesh.visible = lo > 0;
    }
  });
  return meshes;
}

// Particules d'ambiance autour de la caméra (poussière, pollen, neige, lucioles, braises) : voir engine/particles/motes.js
export { motes } from '../engine/particles/motes.js';
