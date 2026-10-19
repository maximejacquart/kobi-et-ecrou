// Effets : réglages par qualité, uniformes partagés (ambiance de la planète, flashs, ombre du soleil) et GLSL
// commun aux particules (profondeur adoucie au contact du décor, brouillard de la planète, éclairage).
import * as THREE from 'three';
import { frameU, QUALITY, LAYERS } from '../frame.js';
import { globalU } from '../materials.js';
import { CSM_PARS, csmU } from '../shadows.js';

// fxBudget : part des particules émises · fxLight : 2 = auto-ombrage des fumées + ombre du soleil, 1 = relief seul
// fxHeat : distorsion de chaleur · fxMotes : densité des particules d'ambiance · fxDebris : débris par explosion
Object.assign(QUALITY.ultra, { fxBudget: 1, fxLight: 2, fxHeat: true, fxMotes: 1.6, fxDebris: 1 });
Object.assign(QUALITY.haute, { fxBudget: 0.8, fxLight: 2, fxHeat: true, fxMotes: 1.1, fxDebris: 0.8 });
Object.assign(QUALITY.moyenne, { fxBudget: 0.5, fxLight: 1, fxHeat: false, fxMotes: 0.6, fxDebris: 0.5 });

// lumières éphémères vues par les particules (explosions, bouches de canon) : xyz + portée, couleur × intensité
export const FLASHES = 4;
Object.assign(frameU, {
  uFxHemiSky: { value: new THREE.Color(0.55, 0.6, 0.7) },
  uFxHemiGround: { value: new THREE.Color(0.35, 0.28, 0.22) },
  uFxFogColor: { value: new THREE.Color(1, 1, 1) },
  uFxFogRange: { value: new THREE.Vector2(60, 450) },
  uFxFlashPos: { value: Array.from({ length: FLASHES }, () => new THREE.Vector4(0, -1e4, 0, 1)) },
  uFxFlashCol: { value: Array.from({ length: FLASHES }, () => new THREE.Vector3()) },
  uFxShadowMap: { value: null },
  uFxShadowMatrix: { value: new THREE.Matrix4() },
  uFxShadowOn: { value: 0 },
  uFxTint: { value: new THREE.Color(0.8, 0.75, 0.7) },
  uFxTime: { value: 0 },
});

// Range sur la couche des effets les maillages transparents qui n'écrivent pas la profondeur (halos, faisceaux) :
// dessinés après l'eau, ils restent visibles devant elle
export function fxLayer(root) {
  root.traverse((o) => { if (o.isMesh && o.material && o.material.transparent && !o.material.depthWrite) o.layers.set(LAYERS.FX); });
  return root;
}

// uniformes d'un matériau d'effet (partagés : un seul jeu de valeurs pour tous)
export function fxUniforms(extra = {}) {
  const u = {};
  for (const k of ['uRes', 'uCamNear', 'uCamFar', 'tSceneDepth', 'uSunDir', 'uSunColor', 'uFxHemiSky', 'uFxHemiGround', 'uFxFogColor', 'uFxFogRange',
    'uFxFlashPos', 'uFxFlashCol', 'uFxShadowMap', 'uFxShadowMatrix', 'uFxShadowOn', 'uFxTint', 'uFxTime']) u[k] = frameU[k];
  for (const k of ['uFogBase', 'uFogFall', 'uFogHeight', 'uFogSunDir', 'uFogSunCol', 'uFogSun']) u[k] = globalU[k];
  // cascades d'ombre du soleil (Ultra, Haute)
  Object.assign(u, csmU);
  return Object.assign(u, extra);
}

// Déclarations communes (vertex et fragment)
export const FX_PARS = /* glsl */ `
uniform vec2 uRes;
uniform float uCamNear, uCamFar, uFxTime;
uniform vec3 uSunDir, uSunColor, uFxHemiSky, uFxHemiGround, uFxFogColor, uFxTint;
uniform vec2 uFxFogRange;
uniform float uFogBase, uFogFall, uFogHeight, uFogSun;
uniform vec3 uFogSunDir, uFogSunCol;
`;

// Vertex : brouillard (distance + brume de hauteur + teinte du soleil, comme les matériaux du jeu), lumières
// éphémères, ombre du soleil au centre de la particule
export const FX_VERT = /* glsl */ `
uniform vec4 uFxFlashPos[${FLASHES}];
uniform vec3 uFxFlashCol[${FLASHES}];
uniform sampler2DShadow uFxShadowMap;
uniform mat4 uFxShadowMatrix;
uniform float uFxShadowOn;
float fxFog(vec3 wp, out vec3 fcol) {
  vec3 ray = wp - cameraPosition;
  float dist = length(ray);
  float f = smoothstep(uFxFogRange.x, uFxFogRange.y, dist);
  float hgt = clamp(exp(-(wp.y - uFogBase) * uFogFall), 0.0, 1.0);
  f = max(f, hgt * uFogHeight * (1.0 - exp(-dist * 0.018)));
  float sunAmt = pow(max(dot(ray / max(dist, 0.001), uFogSunDir), 0.0), 6.0);
  fcol = mix(uFxFogColor, uFogSunCol, sunAmt * uFogSun);
  return clamp(f, 0.0, 1.0);
}
vec3 fxFlashLight(vec3 wp) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${FLASHES}; i++) {
    vec3 d = uFxFlashPos[i].xyz - wp;
    float r = uFxFlashPos[i].w;
    float k = max(0.0, 1.0 - dot(d, d) / (r * r));
    acc += uFxFlashCol[i] * k * k;
  }
  return acc;
}
${CSM_PARS}
float fxSunShadow(vec3 wp, float radius) {
  if (uFxShadowOn < 0.5) return 1.0;
  // cascades (Ultra, Haute) : quatre lectures autour du centre, une grosse bouffée passe en douceur à l'ombre
  if (uCsmOn > 0.5) {
    float r = 0.15 + radius * 0.35;
    return 0.25 * (kobiCsmVis(wp + vec3(r, 0.0, 0.0)) + kobiCsmVis(wp - vec3(r, 0.0, 0.0))
      + kobiCsmVis(wp + vec3(0.0, r * 0.7, r)) + kobiCsmVis(wp - vec3(0.0, r * 0.7, r)));
  }
  vec4 sc = uFxShadowMatrix * vec4(wp, 1.0);
  sc.xyz /= sc.w;
  if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0;
  // quatre prises écartées selon la taille de la particule : une grosse bouffée passe en douceur à l'ombre
  vec2 o = vec2(radius * 0.004 + 0.0008, 0.0);
  float z = sc.z - 0.003;
  float s = texture(uFxShadowMap, vec3(sc.xy + o.xy, z)) + texture(uFxShadowMap, vec3(sc.xy - o.xy, z))
    + texture(uFxShadowMap, vec3(sc.xy + o.yx, z)) + texture(uFxShadowMap, vec3(sc.xy - o.yx, z));
  return s * 0.25;
}
`;

// Fragment : profondeur de l'image opaque → fondu au contact du décor
export const FX_FRAG = /* glsl */ `
#ifndef FX_SCREEN
#define FX_SCREEN 1.0
#endif
uniform sampler2D tSceneDepth;
float fxLinDepth(float d) { return uCamNear * uCamFar / (uCamFar - d * (uCamFar - uCamNear)); }
float fxSoft(float viewZ, float soft) {
  float sz = fxLinDepth(texture2D(tSceneDepth, gl_FragCoord.xy * FX_SCREEN / uRes).x);
  return clamp((sz - viewZ) / soft, 0.0, 1.0);
}
`;

// Carte d'ombre de secours (1 × 1, toujours éclairée) : un échantillonneur d'ombre doit toujours recevoir une
// texture de profondeur comparable, même sans soleil ou en qualité moyenne
let _noShadow = null;
export function initShared(renderer) {
  if (_noShadow) return;
  const dt = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  dt.compareFunction = THREE.LessEqualCompare;
  dt.minFilter = dt.magFilter = THREE.LinearFilter;
  const rt = new THREE.WebGLRenderTarget(1, 1, { depthTexture: dt });
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.clear(false, true, false);
  renderer.setRenderTarget(prev);
  _noShadow = dt;
  frameU.uFxShadowMap.value = dt;
}

const _hemi = new THREE.Color();
let _hemiLevel = null, _hemiLight = null;

// Recopie chaque image l'ambiance du niveau courant (hémisphère, brouillard, ombre du soleil)
export function syncShared(game, time, flashes) {
  frameU.uFxTime.value = time;
  const scene = game.scene;
  if (scene && scene.fog) {
    frameU.uFxFogColor.value.copy(scene.fog.color);
    frameU.uFxFogRange.value.set(scene.fog.near ?? 1e5, scene.fog.far ?? 2e5);
  } else frameU.uFxFogRange.value.set(1e5, 2e5);
  const L = game.level;
  if (L !== _hemiLevel) {
    _hemiLevel = L;
    _hemiLight = null;
    if (L && L.root) L.root.traverse((o) => { if (o.isHemisphereLight && !_hemiLight) _hemiLight = o; });
    if (!_hemiLight && scene) scene.traverse((o) => { if (o.isHemisphereLight && !_hemiLight) _hemiLight = o; });
    // teinte des fumées : couleur de poussière de la planète, adoucie vers le gris
    const tint = frameU.uFxTint.value;
    tint.set((L && L.dustColor) || '#d8c8b8');
    _hemi.setRGB(0.6, 0.6, 0.62);
    tint.lerp(_hemi, 0.45);
  }
  if (_hemiLight) {
    const k = _hemiLight.intensity;
    frameU.uFxHemiSky.value.copy(_hemiLight.color).multiplyScalar(k);
    frameU.uFxHemiGround.value.copy(_hemiLight.groundColor).multiplyScalar(k);
  }
  // ombre du soleil (si la carte existe : elle est recréée quand la qualité change)
  const sun = L && L.sun;
  const map = sun && sun.castShadow && sun.shadow && sun.shadow.map;
  const on = !!(map && map.depthTexture && game.R && game.R.Q.fxLight >= 2);
  frameU.uFxShadowOn.value = on ? 1 : 0;
  if (on) {
    frameU.uFxShadowMap.value = map.depthTexture;
    frameU.uFxShadowMatrix.value.copy(sun.shadow.matrix);
  } else if (_noShadow) frameU.uFxShadowMap.value = _noShadow;
  for (let i = 0; i < FLASHES; i++) {
    const f = flashes[i];
    const P = frameU.uFxFlashPos.value[i], C = frameU.uFxFlashCol.value[i];
    if (f && f.t < f.dur) {
      const k = f.i0 * Math.max(0, 1 - f.t / f.dur) * 0.008;
      P.set(f.p.x, f.p.y, f.p.z, f.range);
      C.set(f.color.r * k, f.color.g * k, f.color.b * k);
    } else {
      P.set(0, -1e4, 0, 1);
      C.set(0, 0, 0);
    }
  }
}
