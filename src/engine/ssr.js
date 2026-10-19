// Reflets à l'écran (SSR), calculés avant l'éclairage : un rayon par pixel (demi-résolution ou moins), tiré dans le
// lobe GGX de la rugosité, marché à l'écran dans la profondeur puis affiné par dichotomie. La couleur vient de
// l'image HDR précédente (reprojetée par la vitesse du point touché), floue selon la rugosité (mips). Confiance
// réduite aux bords de l'écran, au bout du rayon, vers la caméra et sur le dos des surfaces ; filtre spatial selon
// la rugosité, accumulation temporelle puis remontée de résolution guidée par la profondeur.
// Résultat : frameU.uSSRTex (taille de la passe de profondeur) — rgb : couleur réfléchie, a : confiance. Les
// matériaux remplacent la radiance de l'environnement : radiance = mix(radiance, ssr.rgb, ssr.a).
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { frameU, QUALITY } from './frame.js';
import { addSlot } from './shaderSlots.js';
import { SCREEN_GLSL, screenUniforms, screenMaterial, screenTarget, drawQuad, TemporalFilter, Upsampler } from './temporal.js';

// ssr : résolution de la marche (fraction de l'écran, 0 = désactivé) ; ssrSteps : pas ; ssrRough : rugosité max
Object.assign(QUALITY.ultra, { ssr: 0.5, ssrSteps: 40, ssrRough: 0.85 });
Object.assign(QUALITY.haute, { ssr: 0.5, ssrSteps: 24, ssrRough: 0.75 });
Object.assign(QUALITY.moyenne, { ssr: 0, ssrSteps: 0, ssrRough: 0 });

Object.assign(frameU, { uSSRTex: { value: null }, uSSROn: { value: 0 } });

// Marche d'un rayon à l'écran (réutilisable : l'eau peut s'en servir avec tSceneDepth). Repère vue.
//   depthTex : profondeur non linéaire (uv 0..1), size : sa taille en pixels, proj : projection,
//   linZ : (proj[3][2], proj[2][2]) — profondeur linéaire = linZ.x / (ndc + linZ.y)
//   o, dir : origine et direction ; maxDist : longueur (m) ; steps : nombre de pas ; jit : décalage 0..1 ;
//   thick : épaisseur supposée des objets (m, à 1 m de la caméra ; elle croît avec la distance)
// Retour : (uv touché, distance parcourue (m), 1 si touché sinon 0)
export const SSR_TRACE_GLSL = /* glsl */ `
float kobiTraceLin(vec2 linZ, float d) { return linZ.x / (d * 2.0 - 1.0 + linZ.y); }
vec4 kobiTraceScreen(highp sampler2D depthTex, vec2 size, mat4 proj, vec2 linZ, vec3 o, vec3 dir, float maxDist, float steps, float jit, float thick) {
  float zNear = linZ.x / (linZ.y - 1.0);
  float len = maxDist;
  if (dir.z > 1e-4) len = min(len, (-zNear * 1.5 - o.z) / dir.z);
  if (len <= 0.0) return vec4(0.0);
  vec3 e = o + dir * len;
  vec4 h0 = proj * vec4(o, 1.0), h1 = proj * vec4(e, 1.0);
  float k0 = 1.0 / h0.w, k1 = 1.0 / h1.w;
  vec2 s0 = h0.xy * k0 * 0.5 + 0.5, s1 = h1.xy * k1 * 0.5 + 0.5;
  vec2 ds = s1 - s0;
  // segment borné au cadre
  float tMax = 1.0;
  if (ds.x > 1e-6) tMax = min(tMax, (1.0 - s0.x) / ds.x); else if (ds.x < -1e-6) tMax = min(tMax, -s0.x / ds.x);
  if (ds.y > 1e-6) tMax = min(tMax, (1.0 - s0.y) / ds.y); else if (ds.y < -1e-6) tMax = min(tMax, -s0.y / ds.y);
  float pix = length(ds * size) * tMax;
  if (pix < 2.0) return vec4(0.0);
  float n = clamp(pix * 0.5, 4.0, steps);
  float tMin = 1.5 / length(ds * size);
  float zA = o.z * k0, zB = e.z * k1;
  float tPrev = tMin, rzPrev = -o.z;
  for (float i = 0.0; i < 64.0; i++) {
    if (i >= n) break;
    // pas plus fins près de l'origine (reflets de contact), plus longs au loin
    float f = (i + jit) / n;
    float t = mix(tMin, tMax, f * f);
    vec2 s = s0 + ds * t;
    float rz = -mix(zA, zB, t) / mix(k0, k1, t);
    float sz = kobiTraceLin(linZ, textureLod(depthTex, s, 0.0).x);
    float dz = rz - sz;
    // épaisseur : au moins l'avancée du rayon en profondeur sur un pas
    float th = thick * max(1.0, rz * 0.08) + abs(rz - rzPrev);
    if (dz > 0.0 && dz < th) {
      // affinage par dichotomie entre le dernier point devant la surface et le premier derrière
      float a = tPrev, b = t;
      for (int j = 0; j < 5; j++) {
        float m = 0.5 * (a + b);
        float mz = -mix(zA, zB, m) / mix(k0, k1, m);
        if (mz - kobiTraceLin(linZ, textureLod(depthTex, s0 + ds * m, 0.0).x) > 0.0) b = m; else a = m;
      }
      vec3 hp = mix(o * k0, e * k1, b) / mix(k0, k1, b);
      return vec4(s0 + ds * b, length(hp - o), 1.0);
    }
    tPrev = t;
    rzPrev = rz;
  }
  return vec4(0.0);
}`;

const TRACE_FRAG = /* glsl */ `
uniform highp sampler2D tHistColor;
uniform vec2 uSize;
uniform float uSteps;
uniform float uMaxRough;
uniform float uMaxDist;
uniform float uMaxLum;
layout(location = 0) out vec4 oVal;
${SCREEN_GLSL}
${SSR_TRACE_GLSL}
// échantillonnage des normales visibles GGX (calottes sphériques, Dupuy et Benyoub 2023), repère tangent
vec3 sampleVNDF(vec3 v, float a, vec2 u) {
  vec3 vh = normalize(vec3(a * v.x, a * v.y, v.z));
  float phi = 6.2831853 * u.x;
  float zc = (1.0 - u.y) * (1.0 + vh.z) - vh.z;
  float st = sqrt(clamp(1.0 - zc * zc, 0.0, 1.0));
  vec3 h = vec3(st * cos(phi), st * sin(phi), zc) + vh;
  return normalize(vec3(a * h.x, a * h.y, max(h.z, 1e-4)));
}
float edgeFade(vec2 uv) {
  vec2 e = min(uv, 1.0 - uv) * vec2(uGSize.x * uGSize.w, 1.0);
  return smoothstep(0.0, 0.07, min(e.x, e.y));
}
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  oVal = vec4(0.0);
  float d = gDepth(uv);
  if (d >= 1.0) return;
  vec4 nr = gNR(uv);
  float rough = nr.w;
  if (rough >= uMaxRough) return;
  vec3 vp = viewPos(uv, d);
  vec3 V = normalize(vp);
  vec3 N = nr.xyz;
  float z = -vp.z;
  // direction réfléchie tirée dans un lobe resserré (moins de bruit) ; le reste du flou vient des mips
  vec3 T = normalize(cross(abs(N.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), N));
  vec3 B = cross(N, T);
  vec3 ve = vec3(dot(-V, T), dot(-V, B), dot(-V, N));
  vec2 xi = vec2(ign(gl_FragCoord.xy, 0.0), ign(gl_FragCoord.xy, 1.0) * 0.75);
  float a = max(rough * rough, 0.002);
  vec3 h = sampleVNDF(ve, a * 0.6, xi);
  vec3 R = reflect(V, T * h.x + B * h.y + N * h.z);
  if (dot(R, N) <= 0.02) R = reflect(V, N);
  vec4 hit = kobiTraceScreen(tGDepth, uGSize.xy, uProj, uLinZ, vp + N * (0.02 + z * 0.002), R, uMaxDist, uSteps,
    ign(gl_FragCoord.xy, 2.0), 0.12);
  if (hit.w < 0.5) return;
  // dos d'une surface : le vrai point touché est caché derrière
  vec4 nh = gNR(hit.xy);
  if (dot(nh.xyz, R) > 0.2) return;
  // couleur de l'image précédente au point touché (reprojeté par sa vitesse)
  vec2 puv = hit.xy - textureLod(tGVel, hit.xy, 0.0).rg;
  float conf = edgeFade(hit.xy) * edgeFade(puv);
  conf *= 1.0 - smoothstep(0.7, 1.0, hit.z / uMaxDist);
  conf *= 1.0 - smoothstep(uMaxRough * 0.75, uMaxRough, rough);
  // rayons vers la caméra : souvent arrêtés par un objet dont on ne voit que l'avant
  conf *= 1.0 - smoothstep(0.4, 0.9, R.z);
  if (conf <= 0.0) return;
  // flou selon la rugosité : empreinte du lobe au point touché (en pixels de l'image)
  float hz = linZ(gDepth(hit.xy));
  float px = 1.2 * a * hit.z * uProj[1][1] * float(textureSize(tHistColor, 0).y) / max(hz, 0.1);
  float lod = clamp(log2(max(px, 1.0)) - 1.0, 0.0, 6.0);
  vec3 col = textureLod(tHistColor, puv, lod).rgb;
  // pas de lucioles : luminance bornée
  col *= min(1.0, uMaxLum / max(luma(col), 1e-4));
  oVal = vec4(col * conf, conf);
}`;

// Filtre spatial avant l'accumulation : les voisins de même normale, profondeur et rugosité mettent leurs rayons
// en commun, sur une largeur qui croît avec la rugosité (un miroir reste net)
const RESOLVE_FRAG = /* glsl */ `
uniform sampler2D tIn;
uniform vec2 uSize;
uniform float uMaxRough;
layout(location = 0) out vec4 oVal;
${SCREEN_GLSL}
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec2 uv = gl_FragCoord.xy / uSize;
  vec4 c = texelFetch(tIn, ip, 0);
  oVal = c;
  float d = gDepth(uv);
  if (d >= 1.0) return;
  vec4 nr = gNR(uv);
  float k = smoothstep(0.06, uMaxRough * 0.7, nr.w);
  if (k <= 0.0) return;
  float z = linZ(d);
  float stride = 1.0 + 1.5 * k;
  ivec2 mx = ivec2(uSize) - 1;
  vec4 acc = c;
  float ws = 1.0;
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
    if (x == 0 && y == 0) continue;
    vec2 o = vec2(x, y);
    ivec2 q = clamp(ip + ivec2(floor(o * stride + 0.5)), ivec2(0), mx);
    vec2 quv = (vec2(q) + 0.5) / uSize;
    vec4 qn = gNR(quv);
    float qz = linZ(gDepth(quv));
    float w = k * exp(-dot(o, o) / 4.0);
    w *= pow(max(dot(nr.xyz, qn.xyz), 0.0), 32.0);
    w *= max(0.0, 1.0 - abs(qz - z) / (0.02 * z + 0.02));
    w *= 1.0 - smoothstep(0.0, 0.15, abs(qn.w - nr.w));
    acc += texelFetch(tIn, q, 0) * w;
    ws += w;
  }
  oVal = acc / ws;
}`;

export class SSRStage {
  constructor(R) {
    this.R = R;
    this.mat = screenMaterial(TRACE_FRAG, {
      ...screenUniforms(), tHistColor: frameU.tHistColor,
      uSize: { value: new THREE.Vector2(1, 1) }, uSteps: { value: 32 }, uMaxRough: { value: 0.6 },
      uMaxDist: { value: 40 }, uMaxLum: { value: 12 },
    });
    this.fsq = new FullScreenQuad(this.mat);
    this.rt = screenTarget({ minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.resolve = screenMaterial(RESOLVE_FRAG, { ...screenUniforms(), tIn: { value: this.rt.texture }, uSize: this.mat.uniforms.uSize, uMaxRough: this.mat.uniforms.uMaxRough });
    this.rfsq = new FullScreenQuad(this.resolve);
    this.rt2 = screenTarget({ minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.temporal = new TemporalFilter({ color: true, maxAge: 16, gamma: 1.25, depthTol: 0.04, roughAge: true });
    this.up = new Upsampler({ unpremul: true });
    frameU.uSSRTex.value = this.up.texture;
    this._s = new THREE.Vector2();
    this.w = this.h = 1;
    R.onFrame.push(() => { frameU.uSSROn.value = this.enabled && R.Q.prepass ? 1 : 0; });
  }
  get enabled() { return !!this.R.Q.ssr; }
  // w, h : taille de la passe de profondeur
  setSize(w, h, R) {
    const s = R.renderer.getDrawingBufferSize(this._s);
    const k = R.Q.ssr || 0.5;
    this.w = Math.max(1, Math.round(s.x * k));
    this.h = Math.max(1, Math.round(s.y * k));
    this.rt.setSize(this.w, this.h);
    this.rt2.setSize(this.w, this.h);
    this.temporal.setSize(this.w, this.h);
    this.up.setSize(w, h);
    this.mat.uniforms.uSize.value.set(this.w, this.h);
  }
  render(renderer) {
    const Q = this.R.Q, u = this.mat.uniforms;
    u.uSteps.value = Q.ssrSteps;
    u.uMaxRough.value = Q.ssrRough;
    drawQuad(renderer, this.fsq, this.rt);
    drawQuad(renderer, this.rfsq, this.rt2);
    const t = this.temporal.render(renderer, this.rt2.texture);
    frameU.uSSRTex.value = this.up.render(renderer, t, this.w, this.h);
  }
}

// Matériaux : la radiance de l'environnement est remplacée par le reflet là où il est fiable (la pondération BRDF
// de three s'applique ensuite) ; placé après les sondes de reflets (rang -10)
addSlot('pars', 'ssr', 'uniform sampler2D uSSRTex;\nuniform float uSSROn;', { uSSRTex: frameU.uSSRTex, uSSROn: frameU.uSSROn });
addSlot('indirectInputs', 'ssr', /* glsl */ `
#if defined( RE_IndirectSpecular )
if (uSSROn > 0.5) {
  vec4 kR = kobiScreenTex(uSSRTex, vec4(0.0));
  kobiSSRA = kR.a;
  radiance = mix(radiance, kR.rgb, kR.a);
}
#endif`, {}, 0);
