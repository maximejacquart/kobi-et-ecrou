// Effets à l'écran : socle commun. Accumulation temporelle (historique par effet, reprojeté par la vitesse de la
// passe de profondeur, rejet par écart de profondeur et par voisinage), historique couleur de l'image précédente,
// remontée de résolution guidée par la profondeur, aides GLSL, vues de débogage (R.debugView) et coupure des
// entrées écran pendant les rendus hors écran (setScreenInputs).
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { frameU, onScreenInputs } from './frame.js';
import { addSlot } from './shaderSlots.js';

Object.assign(frameU, {
  // passe de profondeur : vitesse écran (rg, uv courant − uv précédent), profondeur linéaire attendue à l'image
  // précédente (b, négative pour une surface lumineuse) et profondeur linéaire courante (a) ; profondeur linéaire de
  // l'image précédente (r)
  tGVel: { value: null },
  tGPrevZ: { value: null },
  // image HDR précédente (avant halo et rayons), avec mips : couleur des reflets et de la lumière indirecte
  tHistColor: { value: null },
  // taille de la passe de profondeur (w, h, 1/w, 1/h) et linéarisation de la profondeur : z = x / (ndc + y)
  uGSize: { value: new THREE.Vector4(1, 1, 1, 1) },
  uLinZ: { value: new THREE.Vector2(-0.2, -1) },
  // 1 : les historiques repartent de zéro (coupure de caméra, changement de taille)
  uScreenReset: { value: 1 },
});

// GLSL des passes plein écran (GLSL3)
export const SCREEN_GLSL = /* glsl */ `
uniform highp sampler2D tGDepth;
uniform highp sampler2D tGNormal;
uniform highp sampler2D tGVel;
uniform highp sampler2D tGPrevZ;
uniform mat4 uProj;
uniform mat4 uInvProj;
uniform mat4 uView;
uniform vec4 uGSize;
uniform vec2 uLinZ;
uniform float uFrame;
float linZ(float d) { return uLinZ.x / (d * 2.0 - 1.0 + uLinZ.y); }
float gDepth(vec2 uv) { return textureLod(tGDepth, uv, 0.0).x; }
// normale vue (xyz) + rugosité (w)
vec4 gNR(vec2 uv) { vec4 n = textureLod(tGNormal, uv, 0.0); return vec4(normalize(n.xyz * 2.0 - 1.0), n.w); }
vec3 viewPos(vec2 uv, float d) { vec4 p = uInvProj * vec4(vec3(uv, d) * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
// position vue → (uv, profondeur linéaire)
vec3 projUVZ(vec3 vp) { vec4 c = uProj * vec4(vp, 1.0); return vec3(c.xy / c.w * 0.5 + 0.5, c.w); }
// bruit « interleaved gradient » décalé à chaque image ; k : graine d'une deuxième série indépendante
float ign(vec2 p, float k) {
  p += 5.588238 * mod(uFrame + k * 23.0, 64.0) + k * vec2(47.0, 17.0);
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
vec3 toYC(vec3 c) { return vec3(dot(c, vec3(0.25, 0.5, 0.25)), dot(c, vec3(0.5, 0.0, -0.5)), dot(c, vec3(-0.25, 0.5, -0.25))); }
vec3 fromYC(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

export const screenUniforms = () => ({
  tGDepth: frameU.tGDepth, tGNormal: frameU.tGNormal, tGVel: frameU.tGVel, tGPrevZ: frameU.tGPrevZ,
  uProj: frameU.uProj, uInvProj: frameU.uInvProj, uView: frameU.uView,
  uGSize: frameU.uGSize, uLinZ: frameU.uLinZ, uFrame: frameU.uFrame,
});

const VS = /* glsl */ `out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// Matériau plein écran (GLSL3, sorties déclarées par le fragment)
export function screenMaterial(frag, uniforms, defines = {}) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, defines, uniforms, vertexShader: VS, fragmentShader: 'precision highp float;\nin vec2 vUv;\n' + frag,
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
  });
}

export function screenTarget(o = {}) {
  return new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, ...o,
  });
}

// Dessine un quad plein écran dans une cible (sans effacement préalable)
export function drawQuad(renderer, fsq, target) {
  const ac = renderer.autoClear;
  renderer.autoClear = false;
  renderer.setRenderTarget(target);
  fsq.render(renderer);
  renderer.autoClear = ac;
}

// ------------------------------------------------------------- accumulation temporelle
const TEMPORAL_FRAG = /* glsl */ `
uniform sampler2D tCur;
uniform sampler2D tHist;
uniform sampler2D tHistM;
uniform vec2 uSize;
uniform float uMaxAge;
uniform float uGamma;
uniform float uDepthTol;
uniform float uReset;
layout(location = 0) out vec4 oVal;
layout(location = 1) out vec4 oMeta;
${SCREEN_GLSL}
vec4 enc(vec4 c) {
#ifdef COLOR
  return vec4(toYC(c.rgb), c.a);
#else
  return c;
#endif
}
vec4 dec(vec4 c) {
#ifdef COLOR
  return vec4(fromYC(c.rgb), c.a);
#else
  return c;
#endif
}
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  ivec2 mx = ivec2(uSize) - 1;
  vec2 uv = gl_FragCoord.xy / uSize;
  vec4 cur = texelFetch(tCur, ip, 0);
  vec4 vel = textureLod(tGVel, uv, 0.0);
  vel.b = abs(vel.b);
  oMeta = vec4(1.0, 0.0, 0.0, 0.0);
  if (vel.a <= 0.0) { oVal = cur; return; }
  // voisinage 3×3 du signal courant (moyenne, écart type) pour borner l'historique
  vec4 m1 = vec4(0.0), m2 = vec4(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec4 s = enc(texelFetch(tCur, clamp(ip + ivec2(x, y), ivec2(0), mx), 0));
    m1 += s; m2 += s * s;
  }
  m1 /= 9.0; m2 /= 9.0;
  vec4 sig = sqrt(max(m2 - m1 * m1, 0.0));
  // reprojection : 4 texels bilinéaires de l'historique, chacun validé par la profondeur de l'image précédente
  vec2 puv = uv - vel.rg;
  vec4 hist = vec4(0.0);
  float age = 0.0, hw = 0.0;
  if (uReset < 0.5 && puv == clamp(puv, vec2(0.0), vec2(1.0))) {
    float nz = abs(gNR(uv).z);
    float tol = vel.b * uDepthTol * (1.0 + 4.0 * (1.0 - nz)) + 0.03;
    vec2 p = puv * uSize - 0.5;
    ivec2 i0 = ivec2(floor(p));
    vec2 f = p - floor(p);
    for (int k = 0; k < 4; k++) {
      ivec2 o = ivec2(k & 1, k >> 1);
      ivec2 q = i0 + o;
      if (q != clamp(q, ivec2(0), mx)) continue;
      float w = (o.x == 1 ? f.x : 1.0 - f.x) * (o.y == 1 ? f.y : 1.0 - f.y);
      float pz = textureLod(tGPrevZ, (vec2(q) + 0.5) / uSize, 0.0).r;
      w *= step(abs(pz - vel.b), tol);
      hist += texelFetch(tHist, q, 0) * w;
      age += texelFetch(tHistM, q, 0).r * w;
      hw += w;
    }
  }
  if (hw < 0.02) { oVal = cur; return; }
  hist /= hw;
  age /= hw;
  if (uGamma > 0.0) hist = dec(clamp(enc(hist), m1 - uGamma * sig, m1 + uGamma * sig));
  float maxAge = uMaxAge;
#ifdef ROUGH_AGE
  // reflets nets : historique court (le reflet ne suit pas exactement la surface)
  maxAge = mix(4.0, uMaxAge, smoothstep(0.05, 0.4, gNR(uv).w));
#endif
  age = min(age + 1.0, maxAge);
  oVal = mix(hist, cur, 1.0 / age);
  oMeta = vec4(age, 0.0, 0.0, 0.0);
}`;

// Historique d'un effet : render(renderer, signal) → texture accumulée (même taille que le signal)
// o : color (rgb borné en YCoCg, sinon par canal), maxAge (nombre d'images moyennées), gamma (largeur de la borne,
// 0 = sans), depthTol (écart relatif de profondeur toléré), roughAge (historique court sur les surfaces lisses)
export class TemporalFilter {
  constructor(o = {}) {
    const defines = {};
    if (o.color) defines.COLOR = '';
    if (o.roughAge) defines.ROUGH_AGE = '';
    this.mat = screenMaterial(TEMPORAL_FRAG, {
      ...screenUniforms(),
      tCur: { value: null }, tHist: { value: null }, tHistM: { value: null },
      uSize: { value: new THREE.Vector2(1, 1) },
      uMaxAge: { value: o.maxAge ?? 16 }, uGamma: { value: o.gamma ?? 1.5 }, uDepthTol: { value: o.depthTol ?? 0.04 },
      uReset: { value: 1 },
    }, defines);
    this.fsq = new FullScreenQuad(this.mat);
    this.rts = [0, 1].map(() => screenTarget({ count: 2 }));
    this.i = 0;
    this.reset = true;
    this.texture = this.rts[0].textures[0];
  }
  get u() { return this.mat.uniforms; }
  setSize(w, h) {
    for (const rt of this.rts) rt.setSize(w, h);
    this.u.uSize.value.set(w, h);
    this.reset = true;
  }
  render(renderer, tex) {
    const read = this.rts[this.i], write = this.rts[1 - this.i];
    const u = this.u;
    u.tCur.value = tex;
    u.tHist.value = read.textures[0];
    u.tHistM.value = read.textures[1];
    u.uReset.value = this.reset || frameU.uScreenReset.value > 0.5 ? 1 : 0;
    drawQuad(renderer, this.fsq, write);
    this.reset = false;
    this.i = 1 - this.i;
    this.texture = write.textures[0];
    return this.texture;
  }
  dispose() {
    for (const rt of this.rts) rt.dispose();
    this.mat.dispose();
    this.fsq.dispose();
  }
}

// ------------------------------------------------------------- remontée de résolution
// Signal basse résolution → taille de la passe de profondeur, pondéré par la profondeur et la normale (pas de halo
// aux silhouettes). WIDE : noyau 4×4 élargi selon la rugosité (reflets flous) ; UNPREMUL : rgb prémultiplié → rgb.
const UPSAMPLE_FRAG = /* glsl */ `
uniform sampler2D tLow;
uniform vec2 uLow;
uniform vec4 uNeutral;
uniform float uMaxRough;
layout(location = 0) out vec4 oVal;
${SCREEN_GLSL}
void main() {
  vec2 uv = gl_FragCoord.xy * uGSize.zw;
  float d = gDepth(uv);
  if (d >= 1.0) { oVal = uNeutral; return; }
  float z = linZ(d);
  vec4 nr = gNR(uv);
  vec2 p = uv * uLow - 0.5;
  vec2 f = p - floor(p);
#ifdef WIDE
  ivec2 i0 = ivec2(floor(p)) - 1;
  const int K = 4;
  float sg = mix(0.45, 1.25, smoothstep(0.05, uMaxRough, nr.w));
#else
  ivec2 i0 = ivec2(floor(p));
  const int K = 2;
#endif
  ivec2 mx = ivec2(uLow) - 1;
  vec4 acc = vec4(0.0);
  float ws = 0.0, best = 1e9;
  vec4 nearest = uNeutral;
  for (int y = 0; y < K; y++) for (int x = 0; x < K; x++) {
    ivec2 q = clamp(i0 + ivec2(x, y), ivec2(0), mx);
    vec2 luv = (vec2(q) + 0.5) / uLow;
    float lz = linZ(gDepth(luv));
    vec3 ln = gNR(luv).xyz;
#ifdef WIDE
    vec2 dd = vec2(i0 + ivec2(x, y)) - p;
    float w = exp(-dot(dd, dd) / (2.0 * sg * sg));
#else
    float w = (x == 1 ? f.x : 1.0 - f.x) * (y == 1 ? f.y : 1.0 - f.y);
#endif
    float dz = abs(lz - z) / (0.03 * z + 0.03);
    w *= max(0.0, 1.0 - dz) * pow(max(dot(nr.xyz, ln), 0.0), 8.0);
    vec4 s = texelFetch(tLow, q, 0);
    acc += s * w;
    ws += w;
    if (dz < best) { best = dz; nearest = s; }
  }
  vec4 r = ws > 1e-4 ? acc / ws : nearest;
#ifdef UNPREMUL
  r.rgb /= max(r.a, 1e-3);
#endif
  oVal = r;
}`;

export class Upsampler {
  constructor(o = {}) {
    const defines = {};
    if (o.wide) defines.WIDE = '';
    if (o.unpremul) defines.UNPREMUL = '';
    this.mat = screenMaterial(UPSAMPLE_FRAG, {
      ...screenUniforms(),
      tLow: { value: null }, uLow: { value: new THREE.Vector2(1, 1) },
      uNeutral: { value: new THREE.Vector4(...(o.neutral || [0, 0, 0, 0])) }, uMaxRough: { value: 0.6 },
    }, defines);
    this.fsq = new FullScreenQuad(this.mat);
    this.rt = screenTarget();
    this.texture = this.rt.texture;
  }
  setSize(w, h) { this.rt.setSize(w, h); }
  render(renderer, tex, lw, lh) {
    this.mat.uniforms.tLow.value = tex;
    this.mat.uniforms.uLow.value.set(lw, lh);
    drawQuad(renderer, this.fsq, this.rt);
    return this.texture;
  }
  dispose() {
    this.rt.dispose();
    this.mat.dispose();
    this.fsq.dispose();
  }
}

// ------------------------------------------------------------- historique couleur
// Copie de l'image HDR (monde, eau, effets ; avant rayons et halo) : les reflets et la lumière indirecte de l'image
// suivante y lisent la couleur des points touchés. Les mips servent aux reflets flous.
class HistoryPass extends Pass {
  constructor() {
    super();
    this.name = 'history';
    this.needsSwap = false;
    this.rt = screenTarget({ generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.mat = screenMaterial(/* glsl */ `
      uniform sampler2D tSrc;
      layout(location = 0) out vec4 oVal;
      void main() {
        // bornée (ni NaN ni infini) : l'historique se réinjecte dans l'image suivante
        oVal = vec4(min(max(texelFetch(tSrc, ivec2(gl_FragCoord.xy), 0).rgb, 0.0), 512.0), 1.0);
      }`, { tSrc: { value: null } });
    this.fsq = new FullScreenQuad(this.mat);
    frameU.tHistColor.value = this.rt.texture;
  }
  setSize(w, h) { this.rt.setSize(w, h); }
  render(renderer, writeBuffer, readBuffer) {
    this.mat.uniforms.tSrc.value = readBuffer.texture;
    drawQuad(renderer, this.fsq, this.rt);
  }
  dispose() {
    this.rt.dispose();
    this.mat.dispose();
    this.fsq.dispose();
  }
}

// ------------------------------------------------------------- vues de débogage
// R.debugView = 'ao' | 'contact' | 'ssr' | 'ssr-a' | 'ssgi' | 'vel' | 'normal' | 'hist' (null : image normale)
const DEBUG_MODES = { ao: 0, contact: 1, ssr: 2, 'ssr-a': 3, ssgi: 4, vel: 5, normal: 6, hist: 7 };
class DebugPass extends Pass {
  constructor() {
    super();
    this.name = 'debug';
    this.needsSwap = false;
    this.enabled = false;
    this.mat = screenMaterial(/* glsl */ `
      uniform sampler2D tAO, tContact, tSSR, tSSGI, tHistColor;
      uniform float uMode;
      uniform vec2 uRes;
      layout(location = 0) out vec4 oVal;
      ${SCREEN_GLSL}
      void main() {
        vec2 uv = gl_FragCoord.xy / uRes;
        vec3 c;
        int m = int(uMode + 0.5);
        if (m == 0) c = vec3(texture(tAO, uv).r);
        else if (m == 1) c = vec3(texture(tContact, uv).r);
        else if (m == 2) { vec4 s = texture(tSSR, uv); c = s.rgb * s.a; }
        else if (m == 3) c = vec3(texture(tSSR, uv).a);
        else if (m == 4) c = texture(tSSGI, uv).rgb * 0.5;
        else if (m == 5) c = vec3(abs(textureLod(tGVel, uv, 0.0).rg) * 40.0, 0.0);
        else if (m == 6) c = textureLod(tGNormal, uv, 0.0).rgb;
        else c = textureLod(tHistColor, uv, 0.0).rgb;
        if (m == 2 || m == 4 || m == 7) c = c / (1.0 + c);
        oVal = vec4(pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
      }`, {
      ...screenUniforms(),
      tAO: frameU.uAOTex, tContact: { value: null }, tSSR: { value: null }, tSSGI: { value: null }, tHistColor: frameU.tHistColor,
      uMode: { value: 0 }, uRes: frameU.uRes,
    });
    this.fsq = new FullScreenQuad(this.mat);
  }
  render(renderer, writeBuffer) {
    const u = this.mat.uniforms;
    u.tContact.value = frameU.uContactTex ? frameU.uContactTex.value : null;
    u.tSSR.value = frameU.uSSRTex ? frameU.uSSRTex.value : null;
    u.tSSGI.value = frameU.uSSGITex ? frameU.uSSGITex.value : null;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsq.render(renderer);
  }
}

// ------------------------------------------------------------- entrées écran des matériaux
// Pendant un rendu hors écran (cubemap…), les matériaux ne doivent pas lire les textures de l'écran :
// setScreenInputs(false) coupe occlusion, ombres de contact, reflets et lumière indirecte ; setScreenInputs(true)
// les rétablit.
// (l'occlusion est déjà coupée par frame.js)
const SCREEN_KEYS = ['uContactOn', 'uSSROn', 'uSSGIOn'];
const saved = {};
let screenOff = false;
function setScreenInputs(on) {
  if (!on && !screenOff) {
    for (const k of SCREEN_KEYS) if (frameU[k]) { saved[k] = frameU[k].value; frameU[k].value = 0; }
    screenOff = true;
  } else if (on && screenOff) {
    for (const k of SCREEN_KEYS) if (frameU[k]) frameU[k].value = saved[k];
    screenOff = false;
  }
}

// Aides des matériaux : lecture d'une texture d'écran (taille de la passe de profondeur) au pixel courant, avec
// remontée de résolution guidée par la profondeur (4 texels voisins pondérés par l'écart à la profondeur du
// fragment). Un fragment absent de la passe de profondeur (herbe, objet transparent…) reçoit la valeur neutre.
addSlot('pars', 'screen', /* glsl */ `
uniform highp sampler2D tScrDepth;
uniform vec4 uScrSize;
uniform vec2 uScrLinZ;
vec4 kobiScrW = vec4(0.0);
vec2 kobiScrUV = vec2(0.0);
float kobiScrSum = -1.0;
// confiance des reflets à l'écran (l'occlusion spéculaire ne s'applique pas à ce qu'ils remplacent)
float kobiSSRA = 0.0;
void kobiScrPrep() {
  if (kobiScrSum >= 0.0) return;
  float z = vViewPosition.z;
  if (uScrSize.x > uRes.x - 0.5) {
    // passe de profondeur à pleine résolution : le texel du fragment suffit
    kobiScrUV = kobiScreenUV();
    float lz = uScrLinZ.x / (texture(tScrDepth, kobiScrUV).x * 2.0 - 1.0 + uScrLinZ.y);
    kobiScrW = vec4(clamp(1.0 - abs(lz - z) / (0.04 * z + 0.04), 0.0, 1.0), 0.0, 0.0, 0.0);
  } else {
    vec2 p = kobiScreenUV() * uScrSize.xy - 0.5;
    vec2 f = p - floor(p);
    kobiScrUV = (floor(p) + 0.5) * uScrSize.zw;
    vec2 o = uScrSize.zw;
    vec4 d = vec4(texture(tScrDepth, kobiScrUV).x, texture(tScrDepth, kobiScrUV + vec2(o.x, 0.0)).x,
      texture(tScrDepth, kobiScrUV + vec2(0.0, o.y)).x, texture(tScrDepth, kobiScrUV + o).x);
    vec4 lz = uScrLinZ.x / (d * 2.0 - 1.0 + uScrLinZ.y);
    vec4 bw = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
    kobiScrW = bw * clamp(1.0 - abs(lz - z) / (0.04 * z + 0.04), 0.0, 1.0);
  }
  kobiScrSum = dot(kobiScrW, vec4(1.0));
}
vec4 kobiScreenTex(sampler2D t, vec4 neutral) {
  kobiScrPrep();
  if (kobiScrSum < 0.01) return neutral;
  vec4 r;
  if (uScrSize.x > uRes.x - 0.5) r = texture(t, kobiScrUV) * kobiScrW.x;
  else {
    vec2 o = uScrSize.zw;
    r = texture(t, kobiScrUV) * kobiScrW.x + texture(t, kobiScrUV + vec2(o.x, 0.0)) * kobiScrW.y
      + texture(t, kobiScrUV + vec2(0.0, o.y)) * kobiScrW.z + texture(t, kobiScrUV + o) * kobiScrW.w;
  }
  return mix(neutral, r / kobiScrSum, smoothstep(0.01, 0.15, kobiScrSum));
}`, { tScrDepth: frameU.tGDepth, uScrSize: frameU.uGSize, uScrLinZ: frameU.uLinZ }, -100);

// ------------------------------------------------------------- mise en place
// Historique couleur (avant les rayons), vue de débogage (en dernier), uniformes d'écran mis à jour à chaque image
export function setupScreen(R) {
  const history = R.addPost(new HistoryPass(), 'rays');
  const debug = import.meta.env.DEV ? R.addPost(new DebugPass(), '') : null;
  R.history = history;
  R.frameU = frameU;
  onScreenInputs(setScreenInputs);
  const lastPos = new THREE.Vector3(1e9, 0, 0);
  let lastW = 0, lastH = 0;
  R.onFrame.push(() => {
    const Q = R.Q, cam = R.camera;
    const e = cam.projectionMatrix.elements;
    frameU.uLinZ.value.set(e[14], e[10]);
    const img = R.prepass.rt;
    frameU.uGSize.value.set(img.width, img.height, 1 / img.width, 1 / img.height);
    // coupure de caméra (téléportation, changement de niveau) ou de taille : les historiques repartent de zéro
    const cut = cam.position.distanceToSquared(lastPos) > 16 || img.width !== lastW || img.height !== lastH;
    frameU.uScreenReset.value = cut ? 1 : 0;
    lastPos.copy(cam.position);
    lastW = img.width; lastH = img.height;
    history.enabled = !!(Q.prepass && (Q.ssr || Q.ssgi));
    if (debug) {
      const mode = DEBUG_MODES[R.debugView];
      debug.enabled = mode !== undefined;
      if (debug.enabled) debug.mat.uniforms.uMode.value = mode;
    }
  });
}
