// Fourrure en coquilles (« shell texturing ») : les triangles à poils d'un corps sculpté (surf.w > 0) sont
// redessinés N fois, chaque coquille un peu plus loin de la peau. Un SkinnedMesh à géométrie instanciée partage
// le squelette du corps (une instance = une coquille, gl_InstanceID donne sa hauteur).
//  - mèches : bruit de cellules 3D sur la position de repos (même motif d'une coquille à l'autre), allongées dans le
//    sens du peigné, cônes qui s'affinent vers la pointe, couverture en alphaToCoverage dans le MSAA ; l'échelle
//    des mèches suit la taille du pixel (jamais plus fines qu'un pixel : pas de scintillement), puis au loin une
//    couverture moyenne ;
//  - ombrage de Kajiya-Kay (deux reflets décalés), auto-ombrage vers la racine, translucidité au contre-jour ;
//  - mouvement : gravité, inertie et traînée de chaque région (tête, queue, bras), vent léger.
// Qualité : QUALITY.*.furShells coquilles (0 en Moyenne : seul le micro-relief du matériau sculpté reste).
import * as THREE from 'three';
import { slotsTier } from '../engine/shaderSlots.js';
import { patchRim } from '../engine/materials.js';
import { QUALITY } from '../engine/frame.js';

Object.assign(QUALITY.ultra, { furShells: 20 });
Object.assign(QUALITY.haute, { furShells: 8 });
Object.assign(QUALITY.moyenne, { furShells: 0 });

// nombre de coquilles courant (suivi de R.Q par installFur ; Ultra par défaut)
const state = { shells: QUALITY.ultra.furShells };
// 1 quand la fourrure est dessinée (contour aminci sous les poils)
const furOnU = { value: 1 };

// À appeler une fois par moteur de rendu : la fourrure suit le niveau de qualité
export function installFur(R) {
  R.onFrame.push(() => {
    state.shells = R.Q.furShells ?? 0;
    furOnU.value = state.shells > 0 ? 1 : 0;
  });
}

// ------------------------------------------------------------------ réglages des personnages
// len : longueur de base (m) ; cell : taille d'une mèche (m) ; bones : facteur de longueur par os (préfixe du nom) ;
// comb : sens du peigné par os, dans le repère de l'os ; trim : sphères (repère d'un os) où les poils raccourcissent
// (k : facteur au centre, fade : largeur du fondu) ; regions : groupes qui bougent ensemble (os racine, point suivi)
export const FUR = {
  kobi: {
    len: 0.016, cell: 0.0034, minW: 0.3,
    bones: { tail: 1.8, ear: 0.6, elbow: 0.8, neck: 1 },
    comb: { head: [0, -0.35, -1], neck: [0, -1, -0.4], ear: [0, 1, 0], tail: [0, 0, -1], elbow: [0, -1, 0] },
    trim: [
      { bone: 'head', p: [0, 0.14, 0.24], r: 0.13, fade: 0.09, k: 0.28 }, // visage : poil ras
      { bone: 'head', p: [-0.088, 0.2, 0.2], r: 0.085, fade: 0.035, k: 0 }, // yeux
      { bone: 'head', p: [0.088, 0.2, 0.2], r: 0.085, fade: 0.035, k: 0 },
      { bone: 'head', p: [0, 0.1, 0.27], r: 0.07, fade: 0.03, k: 0.1 }, // truffe et sourire
      { bone: 'head', p: [-0.088, 0.305, 0.2], r: 0.035, fade: 0.03, k: 0.15 }, // sourcils
      { bone: 'head', p: [0.088, 0.305, 0.2], r: 0.035, fade: 0.03, k: 0.15 },
      { bone: 'head', p: [-0.24, 0.025, 0.02], r: 0.035, fade: 0.05, k: 0.45 }, // pointes des touffes des joues
      { bone: 'head', p: [0.24, 0.025, 0.02], r: 0.035, fade: 0.05, k: 0.45 },
      // sangle des lunettes (anneau)
      { bone: 'head', p: [0, 0.266, 0.006], axis: [0, 0.939, -0.343], R: 0.235, r: 0.03, fade: 0.025, k: 0.1 },
    ],
    regions: [
      { root: 'head', track: 'head', at: [0, 0.2, 0] },
      { root: 'tail0', track: 'tail2' },
      { root: 'elbowL', track: 'handL' },
      { root: 'elbowR', track: 'handR' },
    ],
  },
  // Grand-père Morsillon : poil ras et dru, moustaches plus longues
  morse: {
    len: 0.018, cell: 0.0065, minW: 0.1,
    bones: {},
    comb: { body: [0, -1, -0.3], head: [0, -1, 0.4], arm: [0, -1, 0] },
    trim: [
      { bone: 'head', p: [-0.17, 0.15, 0.4], r: 0.075, fade: 0.04, k: 0 }, // yeux et lunettes
      { bone: 'head', p: [0.17, 0.15, 0.4], r: 0.075, fade: 0.04, k: 0 },
      { bone: 'head', p: [0, 0.02, 0.45], r: 0.09, fade: 0.04, k: 0 }, // truffe
    ],
    regions: [{ root: 'body', track: 'head', at: [0, 0, 0] }],
  },
};

// ------------------------------------------------------------------ géométrie
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

// os → premier préfixe trouvé dans une table { préfixe: valeur }
function byPrefix(table, name, dflt) {
  for (const k in table) if (name.startsWith(k)) return table[k];
  return dflt;
}

function furGeometry(skin, P) {
  const g = skin.geometry;
  const bones = skin.skeleton.bones;
  const pos = g.attributes.position.array, nrm = g.attributes.normal.array;
  const col = g.attributes.color.array, surf = g.attributes.surf.array;
  const si = g.attributes.skinIndex.array, sw = g.attributes.skinWeight.array;
  const idx = g.index.array;
  const nv = pos.length / 3;
  // repère de repos des os dans l'espace du maillage (la sculpture est faite os au repos)
  const root = skin.parent;
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const boneM = bones.map((b) => new THREE.Matrix4().copy(rootInv).multiply(b.matrixWorld));
  const isUnder = (b, anc) => { for (let x = b; x; x = x.parent) if (x === anc) return true; return false; };
  const byName = (n) => bones.find((b) => b.name === n);
  const regionBones = P.regions.map((r) => byName(r.root));
  // par os : facteur de longueur, sens du peigné (repère du maillage), région
  const boneInfo = bones.map((b, i) => {
    const c = byPrefix(P.comb, b.name, null);
    const dir = c ? new THREE.Vector3(...c).normalize().transformDirection(boneM[i]) : new THREE.Vector3();
    let reg = 0;
    regionBones.forEach((rb, k) => { if (rb && isUnder(b, rb)) reg = k; });
    return { len: byPrefix(P.bones, b.name, 1), dir, reg };
  });
  const trims = P.trim.map((t) => {
    const bi = bones.indexOf(byName(t.bone));
    const c = new THREE.Vector3(...t.p);
    const axis = t.axis ? new THREE.Vector3(...t.axis).normalize() : null;
    if (bi >= 0) { c.applyMatrix4(boneM[bi]); if (axis) axis.transformDirection(boneM[bi]); }
    return { c, axis, R: t.R, r: t.r, fade: t.fade, k: t.k };
  });
  // distance à une sphère (centre) ou à un anneau (centre, axe, rayon R)
  const _d = new THREE.Vector3();
  const trimDist = (t, p) => {
    _d.subVectors(p, t.c);
    if (!t.axis) return _d.length();
    const along = _d.dot(t.axis);
    const rad = Math.sqrt(Math.max(0, _d.lengthSq() - along * along));
    return Math.hypot(rad - t.R, along);
  };
  const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const len = new Float32Array(nv);
  for (let v = 0; v < nv; v++) {
    const w = surf[v * 4 + 3];
    let k = smooth(P.minW, P.minW + 0.3, w);
    if (k <= 0) continue;
    // os dominant : premier indice (poids triés par ordre décroissant)
    k *= boneInfo[si[v * 4]].len;
    _v.fromArray(pos, v * 3);
    for (const t of trims) {
      const d = trimDist(t, _v);
      if (d < t.r + t.fade) k *= t.k + (1 - t.k) * smooth(t.r, t.r + t.fade, d);
    }
    len[v] = P.len * k;
  }
  // triangles à poils, sommets compactés
  const remap = new Int32Array(nv).fill(-1);
  const tris = [];
  let count = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (len[a] <= 1e-4 && len[b] <= 1e-4 && len[c] <= 1e-4) continue;
    for (const x of [a, b, c]) if (remap[x] < 0) remap[x] = count++;
    tris.push(remap[a], remap[b], remap[c]);
  }
  const P3 = new Float32Array(count * 3), N3 = new Float32Array(count * 3), C3 = new Float32Array(count * 3);
  const SI = new Uint16Array(count * 4), SW = new Float32Array(count * 4);
  const FUR = new Float32Array(count * 4); // sens du peigné (xyz, tangent à la peau) + longueur
  const DEN = new Float32Array(count * 2); // densité (w), région
  for (let v = 0; v < nv; v++) {
    const o = remap[v];
    if (o < 0) continue;
    for (let q = 0; q < 3; q++) { P3[o * 3 + q] = pos[v * 3 + q]; N3[o * 3 + q] = nrm[v * 3 + q]; C3[o * 3 + q] = col[v * 3 + q]; }
    for (let q = 0; q < 4; q++) { SI[o * 4 + q] = si[v * 4 + q]; SW[o * 4 + q] = sw[v * 4 + q]; }
    const info = boneInfo[si[v * 4]];
    _n.fromArray(nrm, v * 3);
    _v.copy(info.dir).addScaledVector(_n, -info.dir.dot(_n));
    if (_v.lengthSq() > 1e-4) _v.normalize(); else _v.set(0, 0, 0);
    FUR[o * 4] = _v.x; FUR[o * 4 + 1] = _v.y; FUR[o * 4 + 2] = _v.z; FUR[o * 4 + 3] = len[v];
    DEN[o * 2] = smooth(P.minW, P.minW + 0.3, surf[v * 4 + 3]);
    DEN[o * 2 + 1] = info.reg;
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P3, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(N3, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(C3, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
  geo.setAttribute('furComb', new THREE.BufferAttribute(FUR, 4));
  geo.setAttribute('furDen', new THREE.BufferAttribute(DEN, 2));
  geo.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(tris, 1) : new THREE.Uint16BufferAttribute(tris, 1));
  geo.instanceCount = state.shells;
  geo.boundingSphere = skin.geometry.boundingSphere.clone();
  geo.boundingBox = skin.geometry.boundingBox.clone();
  geo.userData.stats = { verts: count, tris: tris.length / 3 };
  return geo;
}

// ------------------------------------------------------------------ matériau des coquilles
const FUR_PARS_V = /* glsl */ `
attribute vec4 furComb;
attribute vec2 furDen;
uniform float uShells;
uniform vec3 uFurForce[4];
uniform vec3 uFurWind;
uniform float uFurTime;
uniform float uFurLean;
varying float vH;
varying vec3 vRoot;
varying vec3 vComb;
varying vec3 vFurT;
varying float vFurDen;
`;
// position de repos : la coquille s'écarte de la peau le long du poil (normale penchée dans le sens du peigné)
const FUR_BEGIN = /* glsl */ `
float fH = (float(gl_InstanceID) + 1.0) / uShells;
vH = fH;
vRoot = position;
vComb = furComb.xyz;
vFurDen = furDen.x;
vec3 fDir = normalize(normal + furComb.xyz * uFurLean);
vec3 transformed = position + fDir * furComb.w * fH;
`;
// après la peau : gravité, inertie et vent courbent le poil (pointe plus souple que la racine)
const FUR_SKINNED = /* glsl */ `
{
  int reg = int(furDen.y + 0.5);
  vec3 fF = reg == 0 ? uFurForce[0] : reg == 1 ? uFurForce[1] : reg == 2 ? uFurForce[2] : uFurForce[3];
  fF += uFurWind * (0.55 + 0.45 * sin(uFurTime * 6.3 + dot(position, vec3(21.0, 13.0, 17.0))));
  vec3 nS = normalize(objectNormal);
  #ifdef USE_SKINNING
    vec3 dS = normalize((skinMatrix * vec4(fDir, 0.0)).xyz);
  #else
    vec3 dS = fDir;
  #endif
  // le poil ne rentre pas dans le corps : on retire l'essentiel de la poussée vers la peau
  float fn = dot(fF, nS);
  fF -= nS * min(fn, 0.0) * 0.85;
  transformed += fF * furComb.w * fH * fH;
  // tangente du poil (dérivée de la courbe racine → pointe), repère vue
  vFurT = normalize(normalMatrix * (dS + fF * 2.0 * fH));
}
`;
const FUR_PARS_F = /* glsl */ `
varying float vH;
varying vec3 vRoot;
varying vec3 vComb;
varying vec3 vFurT;
varying float vFurDen;
uniform float uShells;
uniform float uFurFreq;
// globales lues par l'éclairage des poils
vec3 furT;
float furH;
float furShade;
float furSpark;
// hachage entier (pcg3d) : stable quelle que soit la position
vec3 furHash(vec3 p) {
  uvec3 v = uvec3(ivec3(floor(p)) + 65536);
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return vec3(v) * (1.0 / 4294967295.0);
}
// Voronoï F1 (unités de cellule) et identifiant aléatoire de la mèche la plus proche ; distances raccourcies
// dans le sens du peigné (mèches allongées, sans dépendre de la position absolue)
float furCell(vec3 x, vec3 comb, out float id) {
  vec3 i = floor(x), f = x - i;
  float d = 8.0;
  id = 0.0;
  for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int n = -1; n <= 1; n++) {
    vec3 g = vec3(float(n), float(j), float(k));
    vec3 o = furHash(i + g);
    vec3 r = g + o - f;
    r -= comb * (dot(r, comb) * 0.7);
    float dd = dot(r, r);
    if (dd < d) { d = dd; id = fract(o.x * 7.31 + o.y * 3.17 + o.z * 5.53); }
  }
  return sqrt(d);
}
// mèches à la fréquence f (par mètre) : cônes qui s'affinent vers leur pointe, étirés dans le sens du peigné ;
// pxm : pied de pixel (m) pour l'anticrénelage
float furStrands(float f, float h, float pxm, out float id) {
  float d = furCell(vRoot * f, vComb, id);
  float t = h / mix(0.45, 1.0, id);
  if (t >= 1.0) return 0.0;
  float rad = 0.8 * pow(1.0 - t, 0.75);
  float aa = max(pxm * f * 0.9, 0.03);
  return clamp((rad - d) / aa + 0.5, 0.0, 1.0);
}
`;
// Kajiya-Kay : diffus enveloppant, reflet primaire (blanc, vers la racine) et secondaire (teinté, vers la pointe),
// translucidité quand la lumière vient de derrière les poils
const FUR_RE = /* glsl */ `
void RE_Direct_Fur(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
  vec3 L = directLight.direction, V = geometryViewDir, N = geometryNormal, T = furT;
  float nl = dot(N, L);
  float tl = dot(T, L);
  float kkD = sqrt(max(0.0, 1.0 - tl * tl));
  // diffus enveloppant, renormalisé (la lumière qui passe le terminateur est prise au côté éclairé)
  float wrapD = saturate((nl + 0.4) / 1.4) / 1.15;
  float diff = mix(wrapD, kkD * saturate(nl * 0.6 + 0.55), 0.25) * furShade;
  vec3 c = directLight.color;
  reflectedLight.directDiffuse += c * diff * BRDF_Lambert(material.diffuseColor);
  #ifdef USE_SHEEN
    // reflet satiné du pelage, comme sur le corps sculpté
    sheenSpecularDirect += c * saturate(nl * 0.8 + 0.2) * furShade * BRDF_Sheen(L, V, N, material.sheenColor, material.sheenRoughness);
  #endif
  vec3 H = normalize(L + V);
  vec3 t1 = normalize(T - N * 0.12);
  vec3 t2 = normalize(T + N * 0.2);
  float h1 = dot(t1, H), h2 = dot(t2, H);
  float s1 = pow(max(0.0, 1.0 - h1 * h1), 0.5 * 120.0);
  float s2 = pow(max(0.0, 1.0 - h2 * h2), 0.5 * 26.0);
  float vis = smoothstep(-0.2, 0.35, nl) * furShade;
  reflectedLight.directSpecular += c * vis * (s1 * 0.05 + s2 * 0.06 * furSpark * material.diffuseColor);
  // contre-jour : les pointes s'illuminent, surtout sur la silhouette
  float back = pow(saturate(dot(-V, L)), 6.0) * furH * furH * pow(1.0 - saturate(abs(dot(N, V))), 1.5);
  reflectedLight.directDiffuse += c * back * 0.3 * BRDF_Lambert(material.diffuseColor);
}
#undef RE_Direct
#define RE_Direct RE_Direct_Fur
`;
// couverture des mèches (alphaToCoverage) : l'échelle des mèches suit la taille du pixel (jamais plus fines
// qu'un pixel, donc sans scintillement) ; très loin, couverture moyenne
const FUR_COVER = /* glsl */ `
#include <color_fragment>
{
  float h = vH;
  furH = h;
  // pied de pixel le plus étroit : vu de biais (silhouette), les mèches restent nettes au lieu de se fondre
  float pxm = min(length(dFdx(vRoot)), length(dFdy(vRoot)));
  float lv = log2(max(pxm * uFurFreq * 2.5, 1e-4));
  float mean = 0.75 * pow(max(0.0, 1.0 - h * 1.05), 1.4);
  float far = smoothstep(1.6, 2.6, lv);
  float a = mean, id = 0.5;
  float l0 = clamp(floor(lv), 0.0, 2.0);
  if (far < 0.999) {
    float lf = clamp(lv - l0, 0.0, 1.0);
    float id0, id1 = 0.5;
    float f0 = uFurFreq * exp2(-l0);
    float s = furStrands(f0, h, pxm, id0);
    if (lf > 0.01) s = mix(s, furStrands(f0 * 0.5, h, pxm, id1), lf);
    else id1 = id0;
    id = mix(id0, id1, lf);
    a = mix(s, mean, far);
  }
  // sous-poil : la première coquille couvre toute la peau
  if (h * uShells < 1.5) a = 1.0;
  a *= vFurDen;
  if (a < 0.01) discard;
  diffuseColor.a = a;
  // auto-ombrage vers la racine, pointes plus claires, variation d'une mèche à l'autre
  furShade = mix(0.74, 1.04, h);
  furSpark = mix(0.5 + id, 1.0, far);
  diffuseColor.rgb *= mix(0.9 + 0.2 * id, 1.0, max(far, l0 * 0.4)) * mix(0.96, 1.06, h);
  furT = normalize(vFurT);
}
`;

function furMaterial(P, body) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, vertexColors: true, roughness: 1, metalness: 0,
    sheen: P.sheen ?? 0.4, sheenRoughness: body?.sheenRoughness ?? 0.45, sheenColor: body?.sheenColor?.clone() ?? new THREE.Color('#ffe2b8'),
  });
  m.alphaToCoverage = true;
  const u = {
    uShells: { value: state.shells },
    uFurFreq: { value: 1 / P.cell },
    uFurForce: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    uFurWind: { value: new THREE.Vector3() },
    uFurTime: { value: 0 },
    uFurLean: { value: P.lean ?? 0.9 },
  };
  // liseré plus doux que sur le corps : sur une silhouette duveteuse il s'étale vite en halo
  patchRim(m, 0.45, (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = FUR_PARS_V + shader.vertexShader
      .replace('#include <begin_vertex>', FUR_BEGIN)
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\n' + FUR_SKINNED);
    shader.fragmentShader = '#define CHAR_LIGHT\n' + FUR_PARS_F + shader.fragmentShader
      .replace('#include <lights_physical_pars_fragment>', '#include <lights_physical_pars_fragment>\n' + FUR_RE)
      .replace('#include <color_fragment>', FUR_COVER)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= mix(0.75, 1.05, furH);
        reflectedLight.indirectSpecular *= mix(0.5, 1.0, furH);`);
  });
  m.customProgramCacheKey = () => 'fur' + slotsTier();
  // le flash d'impact du corps s'applique aussi aux poils
  if (body) { m.userData.flash = body.userData.flash; m.userData.flashColor = body.userData.flashColor; }
  m.userData.furU = u;
  return m;
}

// Contour du corps : aminci là où il y a des poils (ce sont eux qui dessinent la silhouette), intact en Moyenne
function furOutline(ol) {
  const src = ol.material;
  const th = parseFloat(String(src.customProgramCacheKey?.() || '').replace('outline', '')) || 0.01;
  const m = new THREE.MeshBasicMaterial({ color: src.color, side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uFurOn = furOnU;
    shader.vertexShader = 'attribute vec4 surf;\nuniform float uFurOn;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      transformed += normalize(normal) * ${th.toFixed(4)} * (1.0 - 0.45 * uFurOn * smoothstep(0.3, 0.6, surf.w));`);
  };
  m.customProgramCacheKey = () => 'furOutline' + th;
  m.userData.shared = true;
  ol.material = m;
}

// ------------------------------------------------------------------ dynamique
const G_SAG = 0.32, DRAG = 0.045, INERTIA = 0.016, K = 110, DAMP = 7.5;
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _a = new THREE.Vector3(), _t = new THREE.Vector3();

// Ajoute la fourrure à un corps sculpté (SkinnedMesh de sculptSkin). P : réglages (FUR.kobi…).
// Renvoie { mesh, material, update(dt) } ; update fait vivre les poils (à appeler avec le temps du jeu).
export function addFur(skin, P) {
  if (!skin) return null;
  const geo = furGeometry(skin, P);
  if (!geo.userData.stats.tris) return null;
  const material = furMaterial(P, skin.material);
  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.name = 'fur';
  mesh.castShadow = false;
  mesh.receiveShadow = skin.receiveShadow; // comme le corps (les personnages ne reçoivent pas d'ombre portée)
  mesh.renderOrder = 1; // après le monde opaque : le décor masque déjà ce qui est derrière
  mesh.raycast = () => {};
  mesh.userData.noAO = true;
  skin.parent.add(mesh);
  mesh.bind(skin.skeleton, skin.bindMatrix);
  if (skin.userData.outline) furOutline(skin.userData.outline);
  mesh.boundingSphere = skin.boundingSphere;
  const u = material.userData.furU;
  // dessiné seulement par son propre matériau (pas dans la passe de profondeur, ni sous un matériau de remplacement)
  mesh.onBeforeRender = (renderer, scene, camera, geometry, mat) => {
    const n = mat === material ? state.shells : 0;
    geometry.instanceCount = n;
    if (n) u.uShells.value = n;
  };
  // pas d'ombre portée (le corps s'en charge), même si un parcours du modèle active castShadow
  mesh.onBeforeShadow = (renderer, object, camera, shadowCamera, geometry) => { geometry.instanceCount = 0; };
  const bones = skin.skeleton.bones;
  const regions = P.regions.map((r) => ({
    bone: bones.find((b) => b.name === r.track) || skin.parent,
    at: new THREE.Vector3(...(r.at || [0, 0, 0])),
    prev: null, vel: new THREE.Vector3(), acc: new THREE.Vector3(),
    x: new THREE.Vector3(0, -G_SAG, 0), v: new THREE.Vector3(),
  }));
  let time = Math.random() * 10;
  const wind = new THREE.Vector3();
  return {
    mesh, material,
    // oublie les mouvements passés (pose changée d'un coup, réapparition) : pas d'à-coup des poils
    reset() { for (const r of regions) { r.prev = null; r.vel.set(0, 0, 0); r.acc.set(0, 0, 0); } },
    update(dt) {
      if (dt <= 0) return;
      time += dt;
      // vent léger : souffle lent qui tourne, avec des rafales
      const gust = 0.5 + 0.5 * Math.sin(time * 0.7) * Math.sin(time * 1.9 + 1.3);
      wind.set(Math.sin(time * 0.13), 0, Math.cos(time * 0.13)).multiplyScalar(0.1 + 0.16 * gust);
      skin.parent.getWorldQuaternion(_q).invert();
      regions.forEach((r, i) => {
        r.bone.updateWorldMatrix(true, false);
        _p.copy(r.at).applyMatrix4(r.bone.matrixWorld);
        if (!r.prev) r.prev = _p.clone();
        _t.subVectors(_p, r.prev).divideScalar(dt);
        // téléportation (réapparition) : pas d'à-coup
        if (_t.lengthSq() > 900) _t.set(0, 0, 0);
        _a.subVectors(_t, r.vel).divideScalar(dt);
        r.acc.lerp(_a, 1 - Math.exp(-dt * 25));
        r.vel.copy(_t);
        r.prev.copy(_p);
        // cible : affaissement, traînée de l'air, vent ; ressort amorti poussé par l'inertie
        _t.set(0, -G_SAG, 0).addScaledVector(r.vel, -DRAG).add(wind);
        const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
        for (let s = 0; s < n; s++) {
          _a.copy(_t).addScaledVector(r.acc, -INERTIA).sub(r.x).multiplyScalar(K).addScaledVector(r.v, -DAMP);
          r.v.addScaledVector(_a, h);
          r.x.addScaledVector(r.v, h);
        }
        if (r.x.length() > 1.1) r.x.setLength(1.1);
        u.uFurForce.value[i].copy(r.x).applyQuaternion(_q);
      });
      u.uFurWind.value.copy(wind).multiplyScalar(0.35).applyQuaternion(_q);
      u.uFurTime.value = time;
    },
  };
}
