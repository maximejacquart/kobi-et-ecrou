// Lumière indirecte à l'écran (SSGI), Ultra seulement : depuis chaque pixel (demi-résolution), quelques rayons courts
// tirés en hémisphère cosinus autour de la normale, marchés à l'écran dans la profondeur ; un rayon qui touche une
// surface (de face) en prend la couleur dans l'image HDR précédente. Accumulation temporelle, débruitage spatial
// guidé par la profondeur et les normales (à trous), remontée de résolution.
// Résultat : frameU.uSSGITex (taille de la passe de profondeur), irradiance (rgb) ajoutée à la lumière indirecte des
// matériaux : rebond orangé du sable, des néons sur le sol, des champignons lumineux…
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { frameU, QUALITY } from './frame.js';
import { addSlot } from './shaderSlots.js';
import { SCREEN_GLSL, screenUniforms, screenMaterial, screenTarget, drawQuad, TemporalFilter, Upsampler } from './temporal.js';
import { SSR_TRACE_GLSL } from './ssr.js';

// ssgi : résolution (fraction de l'écran, 0 = désactivé) ; ssgiRays : rayons par pixel ; ssgiLen : longueur (m)
Object.assign(QUALITY.ultra, { ssgi: 0.5, ssgiRays: 2, ssgiSteps: 10, ssgiLen: 3, ssgiGain: 1.5 });
Object.assign(QUALITY.haute, { ssgi: 0, ssgiRays: 0, ssgiSteps: 0, ssgiLen: 0, ssgiGain: 0 });
Object.assign(QUALITY.moyenne, { ssgi: 0, ssgiRays: 0, ssgiSteps: 0, ssgiLen: 0, ssgiGain: 0 });

Object.assign(frameU, { uSSGITex: { value: null }, uSSGIOn: { value: 0 }, uSSGIGain: { value: 1 } });

const TRACE_FRAG = /* glsl */ `
uniform highp sampler2D tHistColor;
uniform vec2 uSize;
uniform float uRays;
uniform float uSteps;
uniform float uLen;
uniform float uMaxLum;
layout(location = 0) out vec4 oVal;
${SCREEN_GLSL}
${SSR_TRACE_GLSL}
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  oVal = vec4(0.0);
  float d = gDepth(uv);
  if (d >= 1.0) return;
  vec3 vp = viewPos(uv, d);
  vec3 N = gNR(uv).xyz;
  float z = -vp.z;
  vec3 T = normalize(cross(abs(N.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), N));
  vec3 B = cross(N, T);
  vec3 o = vp + N * (0.03 + z * 0.002);
  float u0 = ign(gl_FragCoord.xy, 0.0), u1 = ign(gl_FragCoord.xy, 1.0), jit = ign(gl_FragCoord.xy, 2.0);
  vec3 acc = vec3(0.0);
  float hits = 0.0;
  for (float r = 0.0; r < 8.0; r++) {
    if (r >= uRays) break;
    // hémisphère cosinus (suite de Fibonacci décalée par pixel et par image)
    float a = fract(u0 + r * 0.618034), b = fract(u1 + r * 0.381966);
    float phi = 6.2831853 * a;
    float sr = sqrt(b);
    vec3 dir = normalize(T * (sr * cos(phi)) + B * (sr * sin(phi)) + N * sqrt(max(1.0 - b, 0.0)));
    vec4 hit = kobiTraceScreen(tGDepth, uGSize.xy, uProj, uLinZ, o, dir, uLen, uSteps, fract(jit + r * 0.5), 0.25);
    if (hit.w < 0.5) continue;
    // surface vue de dos ou par la tranche : peu ou pas de lumière (l'image ne montre que sa face tournée vers la
    // caméra) — sauf une surface lumineuse, qui éclaire aussi par sa face cachée (dessous des champignons)
    vec4 hv = textureLod(tGVel, hit.xy, 0.0);
    float facing = hv.b < 0.0 ? 1.0 : clamp(-dot(gNR(hit.xy).xyz, dir) * 2.0, 0.0, 1.0);
    if (facing <= 0.0) continue;
    vec2 puv = hit.xy - hv.rg;
    if (puv != clamp(puv, vec2(0.0), vec2(1.0))) continue;
    vec3 L = textureLod(tHistColor, puv, 2.0).rgb;
    L *= min(1.0, uMaxLum / max(luma(L), 1e-4));
    // fondu au bout du rayon (pas de coupure nette)
    acc += L * facing * (1.0 - smoothstep(0.6, 1.0, hit.z / uLen));
    hits += 1.0;
  }
  // irradiance : π × moyenne des radiances (échantillonnage cosinus)
  oVal = vec4(acc * (3.141593 / uRays), hits / uRays);
}`;

// Débruitage « à trous » (B-spline 5×5, pas croissant), arrêté par la profondeur et les normales
const ATROUS_FRAG = /* glsl */ `
uniform sampler2D tIn;
uniform vec2 uSize;
uniform float uStep;
layout(location = 0) out vec4 oVal;
${SCREEN_GLSL}
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec2 uv = gl_FragCoord.xy / uSize;
  float d = gDepth(uv);
  vec4 c = texelFetch(tIn, ip, 0);
  if (d >= 1.0) { oVal = c; return; }
  float z = linZ(d);
  vec3 n = gNR(uv).xyz;
  // pente de la profondeur (surfaces rasantes)
  float zx = linZ(gDepth(uv + vec2(1.0 / uSize.x, 0.0))) - z;
  float zy = linZ(gDepth(uv + vec2(0.0, 1.0 / uSize.y))) - z;
  float grad = abs(zx) + abs(zy);
  const float K[3] = float[3](0.375, 0.25, 0.0625);
  ivec2 mx = ivec2(uSize) - 1;
  vec4 acc = vec4(0.0);
  float ws = 0.0;
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
    ivec2 q = clamp(ip + ivec2(x, y) * int(uStep), ivec2(0), mx);
    vec2 quv = (vec2(q) + 0.5) / uSize;
    float qz = linZ(gDepth(quv));
    vec3 qn = gNR(quv).xyz;
    float w = K[abs(x)] * K[abs(y)];
    w *= exp(-abs(qz - z) / (grad * uStep * length(vec2(x, y)) + 0.02 * z + 0.02));
    w *= pow(max(dot(n, qn), 0.0), 16.0);
    acc += texelFetch(tIn, q, 0) * w;
    ws += w;
  }
  oVal = acc / max(ws, 1e-5);
}`;

export class SSGIStage {
  constructor(R) {
    this.R = R;
    this.mat = screenMaterial(TRACE_FRAG, {
      ...screenUniforms(), tHistColor: frameU.tHistColor,
      uSize: { value: new THREE.Vector2(1, 1) }, uRays: { value: 2 }, uSteps: { value: 10 }, uLen: { value: 3 }, uMaxLum: { value: 8 },
    });
    this.fsq = new FullScreenQuad(this.mat);
    this.rt = screenTarget({ minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.temporal = new TemporalFilter({ color: true, maxAge: 32, gamma: 2.5, depthTol: 0.04 });
    this.atrous = screenMaterial(ATROUS_FRAG, { ...screenUniforms(), tIn: { value: null }, uSize: { value: new THREE.Vector2(1, 1) }, uStep: { value: 1 } });
    this.afsq = new FullScreenQuad(this.atrous);
    this.ping = [0, 1].map(() => screenTarget({ minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }));
    this.up = new Upsampler({ neutral: [0, 0, 0, 0] });
    frameU.uSSGITex.value = this.up.texture;
    this._s = new THREE.Vector2();
    this.w = this.h = 1;
    R.onFrame.push(() => {
      frameU.uSSGIOn.value = this.enabled && R.Q.prepass ? 1 : 0;
      frameU.uSSGIGain.value = R.Q.ssgiGain || 0;
    });
  }
  get enabled() { return !!this.R.Q.ssgi; }
  setSize(w, h, R) {
    const s = R.renderer.getDrawingBufferSize(this._s);
    const k = R.Q.ssgi || 0.5;
    this.w = Math.max(1, Math.round(s.x * k));
    this.h = Math.max(1, Math.round(s.y * k));
    this.rt.setSize(this.w, this.h);
    this.temporal.setSize(this.w, this.h);
    for (const p of this.ping) p.setSize(this.w, this.h);
    this.mat.uniforms.uSize.value.set(this.w, this.h);
    this.atrous.uniforms.uSize.value.set(this.w, this.h);
    this.up.setSize(w, h);
  }
  render(renderer) {
    const Q = this.R.Q, u = this.mat.uniforms;
    u.uRays.value = Q.ssgiRays;
    u.uSteps.value = Q.ssgiSteps;
    u.uLen.value = Q.ssgiLen;
    drawQuad(renderer, this.fsq, this.rt);
    let t = this.temporal.render(renderer, this.rt.texture);
    for (let i = 0; i < 2; i++) {
      this.atrous.uniforms.tIn.value = t;
      this.atrous.uniforms.uStep.value = 1 << i;
      drawQuad(renderer, this.afsq, this.ping[i]);
      t = this.ping[i].texture;
    }
    frameU.uSSGITex.value = this.up.render(renderer, t, this.w, this.h);
  }
}

// Matériaux : irradiance ajoutée avant le calcul indirect (l'occlusion ambiante s'y applique ensuite : pas de lueur
// au pied des objets)
addSlot('pars', 'ssgi', 'uniform sampler2D uSSGITex;\nuniform float uSSGIOn;\nuniform float uSSGIGain;',
  { uSSGITex: frameU.uSSGITex, uSSGIOn: frameU.uSSGIOn, uSSGIGain: frameU.uSSGIGain });
addSlot('indirectInputs', 'ssgi', /* glsl */ `
#if defined( RE_IndirectDiffuse )
if (uSSGIOn > 0.5) irradiance += kobiScreenTex(uSSGITex, vec4(0.0)).rgb * uSSGIGain;
#endif`, {}, 5);
