// Particules d'ambiance autour de la caméra, sur trois profondeurs (proches et floues, moyennes, lointaines),
// selon la planète : poussière qui ne brille que dans les rayons du soleil, pollen, neige qui tombe en
// tourbillonnant, lucioles qui clignotent, braises qui montent. Un seul appel de dessin, tout est calculé sur le GPU.
import * as THREE from 'three';
import { LAYERS, QUALITY } from '../frame.js';
import { globalU } from '../materials.js';
import { fxUniforms, FX_PARS, FX_VERT, FX_FRAG } from './shared.js';

const KINDS = { dust: 0, pollen: 1, snow: 2, fireflies: 3, embers: 4 };
const BY_LEVEL = { brikka: 'dust', nimbara: 'pollen', givrelune: 'snow', luminbois: 'fireflies', station: 'embers' };
const MAX_MUL = 1.6;

const VERT = /* glsl */ `
${FX_PARS}
${FX_VERT}
uniform float uTime, uSize, uKind, uGlow;
uniform vec3 uCam, uBox, uDrift, uColA, uColB;
attribute vec4 aSeed;   // position dans la boîte (0..1), hasard
attribute float aLayer; // 0 proche, 1 moyen, 2 lointain
varying vec2 vC;
varying vec4 vCol;
varying float vViewZ, vSoft, vSeed, vLen;
void main() {
  float r = aSeed.w;
  float s = aLayer < 0.5 ? 0.4 : (aLayer < 1.5 ? 1.0 : 2.3);
  vec3 B = uBox * s;
  vec3 p = aSeed.xyz * B;
  float t = uTime;
  vec3 vel = uDrift * (0.6 + r);
  p += vel * t;
  // mouvements propres : flottement, tourbillon de la neige, errance des lucioles
  vec3 wob = vec3(sin(t * 0.7 + r * 40.0), sin(t * 0.9 + r * 17.0), cos(t * 0.6 + r * 23.0)) * 0.6;
  if (uKind > 1.5 && uKind < 2.5) { wob = vec3(sin(t * 1.3 + r * 31.0), 0.0, cos(t * 1.1 + r * 13.0)) * 0.45; }
  if (uKind > 2.5 && uKind < 3.5) { wob = vec3(sin(t * 0.37 + r * 40.0) + sin(t * 0.83 + r * 9.0) * 0.5, sin(t * 0.51 + r * 17.0) * 0.6, cos(t * 0.43 + r * 23.0) + cos(t * 0.71 + r * 5.0) * 0.5) * 1.6; }
  p += wob;
  vec3 rel = mod(p - uCam + B * 0.5, B) - B * 0.5;
  vec3 wp = uCam + rel;
  // les bords de la boîte s'effacent (pas d'apparition brutale)
  float edge = smoothstep(0.5, 0.36, max(abs(rel.x) / B.x, abs(rel.z) / B.z)) * smoothstep(0.5, 0.38, abs(rel.y) / B.y);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float layerK = aLayer < 0.5 ? (uKind > 2.5 && uKind < 3.5 ? 0.8 : 1.25) : (aLayer < 1.5 ? 1.0 : 1.7);
  float size = uSize * (0.5 + r) * layerK;
  vC = position.xy;
  vLen = 0.0;
  if (uKind > 1.5 && uKind < 2.5) {
    // flocons proches légèrement étirés par leur chute
    vec2 v2 = (mat3(viewMatrix) * vec3(vel.x, vel.y, vel.z)).xy;
    float l = length(v2);
    vec2 ax = l > 1e-4 ? v2 / l : vec2(0.0, 1.0);
    float st = min(l * 0.018, size * 2.0);
    vLen = st / size;
    mv.xy += ax * (vC.x * (size + st * 0.5)) + vec2(-ax.y, ax.x) * vC.y * size;
  } else {
    mv.xy += vC * size;
  }
  vec3 col = mix(uColA, uColB, fract(r * 7.13)) * uGlow;
  float a = edge;
  vec3 toP = normalize(wp - cameraPosition);
  if (uKind < 0.5) {
    // poussière : visible surtout à contre-jour et dans la lumière directe
    float ph = 0.4 + 2.2 * pow(max(dot(toP, uSunDir), 0.0), 4.0);
    a *= ph * (0.3 + 0.7 * fxSunShadow(wp, 0.0));
  } else if (uKind < 1.5) {
    a *= 0.6 + 0.9 * pow(max(dot(toP, uSunDir), 0.0), 3.0);
  } else if (uKind < 2.5) {
    // neige : éclairée comme de la matière (soleil, ciel)
    float sh = fxSunShadow(wp, 0.0);
    col = uColA * (uSunColor * (0.35 + 0.4 * sh) + mix(uFxHemiGround, uFxHemiSky, 0.7) * 0.9);
  } else if (uKind < 3.5) {
    // lucioles : clignotement lent, chacune à son rythme
    float bl = sin(t * (0.9 + r * 1.3) + r * 60.0);
    a *= 0.08 + pow(max(bl, 0.0), 5.0) * 1.6;
  } else {
    a *= 0.55 + 0.45 * sin(t * (5.0 + r * 9.0) + r * 50.0);
  }
  // couches proches : plus douces (flou de mise au point) ; couche lointaine : plus discrète
  a *= aLayer < 0.5 ? 0.55 : (aLayer < 1.5 ? 1.0 : 0.7);
  vec3 fcol;
  float fog = fxFog(wp, fcol);
  if (uKind > 1.5 && uKind < 2.5) col = mix(col, fcol, fog); else a *= 1.0 - fog;
  vCol = vec4(col, a);
  vSeed = r;
  vViewZ = -mv.z;
  vSoft = max(0.15, size * 2.0);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
${FX_PARS}
${FX_FRAG}
uniform float uKind;
varying vec2 vC;
varying vec4 vCol;
varying float vViewZ, vSoft, vSeed, vLen;
void main() {
  float r2 = dot(vC, vC);
  float m;
  if (uKind > 1.5 && uKind < 2.5) m = smoothstep(1.0, 0.35, sqrt(r2));
  else if (uKind > 2.5 && uKind < 3.5) m = exp(-r2 * 9.0) * 1.4 + exp(-r2 * 2.5) * 0.25;
  else m = exp(-r2 * 6.0) * (1.0 - min(r2, 1.0));
  float a = vCol.a * m * fxSoft(vViewZ, vSoft) * smoothstep(1.2, 3.5, vViewZ);
  if (a < 0.003) discard;
#ifdef MOTES_ALPHA
  gl_FragColor = vec4(vCol.rgb * a, a);
#else
  gl_FragColor = vec4(vCol.rgb * a, 0.0);
#endif
}`;

// L : niveau (root, every, game) ; o : count, colorA, colorB, size, drift, glow, additive, box, kind
export function motes(L, o = {}) {
  const kind = o.kind || BY_LEVEL[L.id] || (o.additive === false ? 'snow' : 'dust');
  const k = KINDS[kind] ?? 0;
  const n0 = o.count || 500;
  const max = Math.ceil(n0 * MAX_MUL);
  const box = new THREE.Vector3(...(o.box || [60, 26, 60]));
  const seed = new Float32Array(max * 4);
  const layer = new Float32Array(max);
  for (let i = 0; i < max; i++) {
    seed[i * 4] = Math.random(); seed[i * 4 + 1] = Math.random(); seed[i * 4 + 2] = Math.random(); seed[i * 4 + 3] = Math.random();
    // ordre mélangé : réduire le nombre affiché (qualité) garde les trois profondeurs
    const u = (i * 0.618034) % 1;
    layer[i] = u < 0.18 ? 0 : u < 0.68 ? 1 : 2;
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  geo.setAttribute('aLayer', new THREE.InstancedBufferAttribute(layer, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  const alpha = kind === 'snow';
  const sizeMul = kind === 'snow' ? 0.55 : kind === 'fireflies' ? 0.9 : 0.6;
  const m = new THREE.ShaderMaterial({
    uniforms: fxUniforms({
      uTime: globalU.uTime, uCam: { value: new THREE.Vector3() }, uBox: { value: box },
      uDrift: { value: new THREE.Vector3(...(o.drift || [0.6, 0.15, 0.3])) },
      uColA: { value: new THREE.Color(o.colorA || '#ffe2b0') }, uColB: { value: new THREE.Color(o.colorB || '#ffffff') },
      uSize: { value: (o.size || 0.08) * sizeMul }, uGlow: { value: (o.glow ?? 1.5) * (kind === 'fireflies' ? 1.7 : 1.2) }, uKind: { value: k },
    }),
    defines: alpha ? { MOTES_ALPHA: '' } : {},
    vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: alpha ? THREE.OneMinusSrcAlphaFactor : THREE.OneFactor,
    blendSrcAlpha: alpha ? THREE.OneFactor : THREE.ZeroFactor, blendDstAlpha: alpha ? THREE.OneMinusSrcAlphaFactor : THREE.OneFactor,
  });
  const mesh = new THREE.Mesh(geo, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  mesh.layers.set(LAYERS.FX);
  L.root.add(mesh);
  L.every(() => {
    const g = L.game;
    m.uniforms.uCam.value.copy(g.camera.cam.position);
    const Q = (g.R && g.R.Q) || QUALITY.ultra;
    geo.instanceCount = Math.min(max, Math.round(n0 * (Q.fxMotes ?? 1)));
  });
  geo.instanceCount = n0;
  return mesh;
}
