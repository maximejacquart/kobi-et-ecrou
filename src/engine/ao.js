// Occlusion ambiante (GTAO, Jimenez 2016) calculée depuis la passe de profondeur, AVANT l'image principale :
// quelques tranches par pixel, tournées d'une image à l'autre et accumulées dans le temps (temporal.js). Les matériaux
// l'appliquent à la seule lumière indirecte, en multi-rebond selon l'albédo (les surfaces claires s'assombrissent
// moins) et en occlusion spéculaire (sauf sur ce que les reflets à l'écran remplacent).
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { frameU, QUALITY } from './frame.js';
import { addSlot } from './shaderSlots.js';
import { SCREEN_GLSL, screenUniforms, screenMaterial, screenTarget, drawQuad, TemporalFilter } from './temporal.js';

// aoSlices × aoSteps : tranches par pixel et pas de chaque côté ; aoRadius : rayon (m)
Object.assign(QUALITY.ultra, { aoSlices: 2, aoSteps: 6, aoRadius: 1.4 });
Object.assign(QUALITY.haute, { aoSlices: 2, aoSteps: 5, aoRadius: 1.4 });
Object.assign(QUALITY.moyenne, { aoSlices: 0, aoSteps: 0, aoRadius: 1.4 });
// contraste de l'occlusion (puissance appliquée à la visibilité)
const AO_POWER = 1.7;

const GTAO_FRAG = /* glsl */ `
uniform float uRadius;
uniform float uPower;
uniform float uSlices;
uniform float uSteps;
layout(location = 0) out vec4 oVal;
${SCREEN_GLSL}
float fastAcos(float x) {
  float r = -0.156583 * abs(x) + 1.570796;
  r *= sqrt(1.0 - abs(x));
  return x >= 0.0 ? r : 3.141593 - r;
}
void main() {
  vec2 uv = gl_FragCoord.xy * uGSize.zw;
  float d = gDepth(uv);
  if (d >= 1.0) { oVal = vec4(1.0); return; }
  vec3 vp = viewPos(uv, d);
  vec3 N = gNR(uv).xyz;
  vec3 V = normalize(-vp);
  float z = -vp.z;
  // rayon à l'écran (uv) ; borné pour les surfaces toutes proches
  vec2 rUV = uRadius * vec2(uProj[0][0], uProj[1][1]) * 0.5 / z;
  float rPx = rUV.y * uGSize.y;
  if (rPx < 1.5) { oVal = vec4(1.0); return; }
  float k = min(1.0, 0.25 * uGSize.y / rPx);
  rUV *= k;
  float radius = uRadius * k;
  // atténuation : un échantillon au-delà du rayon n'occulte plus (pas de halo autour des objets au premier plan)
  float fRange = 0.6 * radius;
  float fMul = -1.0 / fRange, fAdd = (radius - fRange) / fRange + 1.0;
  float noiseA = ign(gl_FragCoord.xy, 0.0);
  float noiseS = ign(gl_FragCoord.xy, 1.0);
  float minS = 1.3 / max(rPx * k, 1.0);
  float vis = 0.0;
  for (float s = 0.0; s < 4.0; s++) {
    if (s >= uSlices) break;
    float phi = (s + noiseA) / uSlices * 3.141593;
    vec2 dir = vec2(cos(phi), sin(phi));
    vec3 dirV = vec3(dir, 0.0);
    vec3 ortho = dirV - dot(dirV, V) * V;
    vec3 axis = normalize(cross(ortho, V));
    vec3 pn = N - axis * dot(N, axis);
    float pnLen = length(pn);
    float cosN = clamp(dot(pn, V) / pnLen, -1.0, 1.0);
    float n = sign(dot(ortho, pn)) * fastAcos(cosN);
    float low0 = cos(n + 1.570796), low1 = cos(n - 1.570796);
    float h0c = low0, h1c = low1;
    for (float j = 0.0; j < 12.0; j++) {
      if (j >= uSteps) break;
      float t = (j + fract(noiseS + j * 0.618034)) / uSteps;
      t = t * t + minS;
      vec2 off = dir * rUV * t;
      vec2 u0 = uv + off, u1 = uv - off;
      vec3 d0 = viewPos(u0, gDepth(u0)) - vp;
      vec3 d1 = viewPos(u1, gDepth(u1)) - vp;
      float l0 = length(d0), l1 = length(d1);
      float c0 = mix(low0, dot(d0 / l0, V), clamp(l0 * fMul + fAdd, 0.0, 1.0));
      float c1 = mix(low1, dot(d1 / l1, V), clamp(l1 * fMul + fAdd, 0.0, 1.0));
      h0c = max(h0c, c0);
      h1c = max(h1c, c1);
    }
    pnLen = mix(pnLen, 1.0, 0.05);
    float h0 = -fastAcos(h1c), h1 = fastAcos(h0c);
    h0 = n + clamp(h0 - n, -1.570796, 1.570796);
    h1 = n + clamp(h1 - n, -1.570796, 1.570796);
    float sn = sin(n);
    vis += pnLen * ((cosN + 2.0 * h0 * sn - cos(2.0 * h0 - n)) + (cosN + 2.0 * h1 * sn - cos(2.0 * h1 - n))) * 0.25;
  }
  vis /= uSlices;
  // fondu au loin (rayon de moins de quelques pixels)
  vis = mix(1.0, pow(clamp(vis, 0.0, 1.0), uPower), smoothstep(1.5, 4.0, rPx));
  oVal = vec4(clamp(vis, 0.03, 1.0));
}`;

export class AOStage {
  constructor(R) {
    this.R = R;
    this.enabled = true;
    this.mat = screenMaterial(GTAO_FRAG, {
      ...screenUniforms(), uRadius: { value: 1 }, uPower: { value: AO_POWER }, uSlices: { value: 2 }, uSteps: { value: 6 },
    });
    this.fsq = new FullScreenQuad(this.mat);
    this.rt = screenTarget({ type: THREE.HalfFloatType, format: THREE.RedFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.temporal = new TemporalFilter({ maxAge: 12, gamma: 1.0, depthTol: 0.03 });
    frameU.uAOTex.value = this.temporal.texture;
  }
  // w, h : taille de la passe de profondeur
  setSize(w, h) {
    this.rt.setSize(w, h);
    this.temporal.setSize(w, h);
  }
  render(renderer) {
    const Q = this.R.Q, u = this.mat.uniforms;
    u.uSlices.value = Q.aoSlices || 2;
    u.uSteps.value = Q.aoSteps || 5;
    u.uRadius.value = Q.aoRadius || 1;
    drawQuad(renderer, this.fsq, this.rt);
    frameU.uAOTex.value = this.temporal.render(renderer, this.rt.texture);
  }
}

// Remplace l'occlusion du socle (même id) : multi-rebond selon l'albédo, occlusion spéculaire (sauf sur ce que les
// reflets à l'écran remplacent)
addSlot('indirectPost', 'ao', /* glsl */ `
if (uAOOn > 0.5) {
  float kAO = kobiScreenTex(uAOTex, vec4(1.0)).r;
  #ifdef STANDARD
    vec3 kAlb = material.diffuseContribution;
    vec3 kMB = max(vec3(kAO), ((kAO * (2.0404 * kAlb - 0.3324) + (-4.7951 * kAlb + 0.6417)) * kAO + (2.7552 * kAlb + 0.6903)) * kAO);
  #else
    vec3 kMB = vec3(kAO);
  #endif
  reflectedLight.indirectDiffuse *= kMB;
  #if defined( USE_SHEEN )
    sheenSpecularIndirect *= kAO;
  #endif
  #if defined( USE_ENVMAP ) && defined( STANDARD )
    float kSO = computeSpecularOcclusion(saturate(dot(geometryNormal, geometryViewDir)), kAO, material.roughness);
    reflectedLight.indirectSpecular *= mix(kSO, 1.0, kobiSSRA);
  #endif
}`);
