// Brouillard volumétrique (Ultra, Haute) : à basse résolution, chaque pixel marche dans la profondeur de l'image
// opaque et accumule la lumière diffusée par une brume dont la densité suit le brouillard de hauteur de la
// planète, modulée par un bruit 3D qui dérive. Le soleil y est lu dans les cascades d'ombre : le décor découpe
// de vrais rayons (canyon, troncs, poutres). Les lumières ponctuelles proches y dessinent leur halo (intégrale
// exacte le long du rayon, sans bruit). Diffusion anisotrope (Henyey-Greenstein) vers le soleil.
// Puis accumulation temporelle (reprojection + bornage par le voisinage) et remontée à pleine résolution guidée
// par la profondeur, appliquée à l'image HDR avant le halo lumineux. En Moyenne, la passe écran « rays » reste.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { QUALITY, frameU } from './frame.js';
import { globalU } from './materials.js';
import { csmU, CSM_PARS } from './shadows.js';
import { noiseTexture } from './sky.js';

// volScale : résolution de la marche, en fraction de la taille de la fenêtre (pixels CSS) ; volSteps : pas
Object.assign(QUALITY.ultra, { volumetric: true, volScale: 0.5, volSteps: 40 });
Object.assign(QUALITY.haute, { volumetric: true, volScale: 0.35, volSteps: 24 });
// en Moyenne, la passe écran « rays » (flou radial, presque gratuite) sert de repli
Object.assign(QUALITY.moyenne, { volumetric: false, rays: true });

const MAXL = 8;
const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// reconstruction de la position monde depuis la profondeur de l'image opaque
const COMMON = /* glsl */ `
uniform sampler2D tDepth;
uniform mat4 uInvProj, uInvView;
uniform float uCamNear, uCamFar;
vec3 viewPos(vec2 uv, float d) {
  vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return v.xyz / v.w;
}
float linDepth(float d) { return uCamNear * uCamFar / (uCamFar - d * (uCamFar - uCamNear)); }
`;

const MARCH_FRAG = /* glsl */ `
${COMMON}
${CSM_PARS}
uniform sampler2D tNoise;
uniform vec3 uSunDir, uSunColor, uAmbient, uCamPos, uWind, uTint;
uniform float uFrame, uTime, uSteps, uMaxDist;
uniform float uDensity, uFloor, uExt, uFogBase, uFogFall, uNoise, uNoiseScale, uAniso, uSunScatter, uLightScatter;
uniform int uLightCount;
uniform vec4 uLightPos[${MAXL}];
uniform vec3 uLightCol[${MAXL}];
uniform vec2 uLowRes;
varying vec2 vUv;
float ign(vec2 p) { p += 5.588238 * mod(uFrame, 64.0); return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
// bruit 3D à une lecture (texture raccordable : r et g décalés de (37, 17) cellules)
float n3(vec3 x) {
  float iy = floor(x.y);
  float fy = x.y - iy;
  vec2 rg = textureLod(tNoise, (x.xz + vec2(37.0, 17.0) * iy) / 32.0, 0.0).rg;
  return mix(rg.r, rg.g, fy * fy * (3.0 - 2.0 * fy));
}
// densité : brume de hauteur (plancher pour un voile partout) × bruit qui dérive
float density(vec3 p) {
  float hgt = clamp(exp(-(p.y - uFogBase) * uFogFall), 0.0, 1.0);
  float d = uDensity * max(hgt, uFloor);
  vec3 q = p * uNoiseScale + uWind * uTime;
  float n = n3(q) * 0.62 + n3(q * 2.71 + 3.1) * 0.38;
  return d * mix(1.0, smoothstep(0.18, 0.8, n) * 1.7, uNoise);
}
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
void main() {
  float d = textureLod(tDepth, vUv, 0.0).x;
  vec3 vp = viewPos(vUv, min(d, 0.999999));
  vec3 wp = (uInvView * vec4(vp, 1.0)).xyz;
  vec3 ray = wp - uCamPos;
  float dist = length(ray);
  vec3 rd = ray / dist;
  dist = d >= 1.0 ? uMaxDist : min(dist, uMaxDist);
  float cosT = dot(rd, uSunDir);
  float phase = mix(0.0796, hg(cosT, uAniso), 0.75) * uSunScatter;
  int n = int(uSteps);
  float j = ign(gl_FragCoord.xy);
  vec3 acc = vec3(0.0);
  float T = 1.0;
  float tPrev = 0.0;
  for (int i = 0; i < 64; i++) {
    if (i >= n) break;
    // pas plus serrés près de la caméra (rayons nets au premier plan)
    float u = (float(i) + j) / float(n);
    float t = dist * u * u;
    float dt = t - tPrev;
    tPrev = t;
    vec3 p = uCamPos + rd * t;
    float sigma = density(p);
    if (sigma < 1e-6) continue;
    float vis = kobiCsmVis(p);
    vec3 S = sigma * (uSunColor * vis * phase + uAmbient);
    // extinction plus faible que la diffusion (stylisé) : des rayons francs sans assombrir la scène
    float tr = exp(-sigma * uExt * dt);
    acc += T * S * (1.0 - tr) / (sigma * uExt);
    T *= tr;
  }
  // halos des lumières ponctuelles : intégrale exacte de 1/d² le long du rayon (densité au point le plus proche)
  for (int i = 0; i < ${MAXL}; i++) {
    if (i >= uLightCount) break;
    vec3 lp = uLightPos[i].xyz;
    float range = uLightPos[i].w;
    float t0 = dot(lp - uCamPos, rd);
    float h2 = max(dot(lp - uCamPos, lp - uCamPos) - t0 * t0, 0.0025);
    float hc = sqrt(max(range * range - h2, 0.0));
    float a = max(t0 - hc, 0.0), b = min(t0 + hc, dist);
    if (b <= a) continue;
    float h = sqrt(h2);
    float I = (atan((b - t0) / h) - atan((a - t0) / h)) / h;
    float sg = density(uCamPos + rd * clamp(t0, a, b));
    float Tl = mix(1.0, T, clamp(t0 / max(dist, 1e-3), 0.0, 1.0));
    acc += uLightCol[i] * sg * I * 0.0796 * uLightScatter * Tl;
  }
  gl_FragColor = vec4(acc * uTint, T);
}`;

// accumulation temporelle : l'historique est reprojeté, borné par le voisinage de l'image courante
const RESOLVE_FRAG = /* glsl */ `
${COMMON}
uniform sampler2D tCur, tHist;
uniform mat4 uPrevViewProj;
uniform vec2 uLowRes;
uniform float uReset, uBlend;
varying vec2 vUv;
void main() {
  vec4 cur = texture2D(tCur, vUv);
  vec4 mn = cur, mx = cur;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    if (x == 0 && y == 0) continue;
    vec4 s = texture2D(tCur, vUv + vec2(float(x), float(y)) / uLowRes);
    mn = min(mn, s); mx = max(mx, s);
  }
  float d = textureLod(tDepth, vUv, 0.0).x;
  vec3 wp = (uInvView * vec4(viewPos(vUv, min(d, 0.9999)), 1.0)).xyz;
  vec4 pc = uPrevViewProj * vec4(wp, 1.0);
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  vec4 hist = texture2D(tHist, puv);
  bool ok = uReset < 0.5 && pc.w > 0.0 && all(greaterThan(puv, vec2(0.0))) && all(lessThan(puv, vec2(1.0)));
  hist = clamp(hist, mn, mx);
  gl_FragColor = ok ? mix(hist, cur, uBlend) : cur;
}`;

// remontée à pleine résolution guidée par la profondeur, puis application : couleur × transmission + diffusion
const COMPOSITE_FRAG = /* glsl */ `
${COMMON}
uniform sampler2D tDiffuse, tFog;
uniform vec2 uLowRes;
varying vec2 vUv;
void main() {
  vec4 base = texture2D(tDiffuse, vUv);
  float z = linDepth(textureLod(tDepth, vUv, 0.0).x);
  vec2 c = vUv * uLowRes - 0.5;
  vec2 b = floor(c);
  vec2 f = c - b;
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int y = 0; y <= 1; y++) for (int x = 0; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 tuv = (b + o + 0.5) / uLowRes;
    float zi = linDepth(textureLod(tDepth, tuv, 0.0).x);
    vec2 bw = mix(1.0 - f, f, o);
    float w = bw.x * bw.y * exp(-abs(zi - z) / (z * 0.06 + 0.05)) + 1e-4;
    acc += texture2D(tFog, tuv) * w;
    wsum += w;
  }
  vec4 fog = acc / wsum;
  gl_FragColor = vec4(base.rgb * fog.a + fog.rgb, base.a);
}`;

export const volU = {
  uDensity: { value: 0.012 }, uFloor: { value: 0.25 }, uExt: { value: 0.5 }, uFogBase: globalU.uFogBase, uFogFall: globalU.uFogFall,
  uNoise: { value: 0.6 }, uNoiseScale: { value: 0.06 }, uAniso: { value: 0.6 }, uSunScatter: { value: 1 }, uLightScatter: { value: 1 },
  uAmbient: { value: new THREE.Color() }, uTint: { value: new THREE.Color(1, 1, 1) }, uWind: { value: new THREE.Vector3(0.05, 0.01, 0.03) },
  uMaxDist: { value: 160 },
};

class VolumetricPass extends Pass {
  constructor(R) {
    super();
    this.R = R;
    this.name = 'volumetrics';
    this.active = false;
    this.lights = [];
    this._scan = 0;
    this._reset = true;
    this._camPrev = new THREE.Vector3();
    const t = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.rtMarch = t();
    this.hist = [t(), t()];
    this.cur = 0;
    const low = new THREE.Vector2(1, 1);
    this.low = low;
    const cam = {
      tDepth: frameU.tSceneDepth, uInvProj: frameU.uInvProj, uInvView: frameU.uInvView, uCamNear: frameU.uCamNear, uCamFar: frameU.uCamFar,
    };
    this.marchMat = new THREE.ShaderMaterial({
      uniforms: {
        ...cam, ...csmU, ...volU,
        tNoise: { value: noiseTexture() },
        uSunDir: frameU.uSunDir, uSunColor: frameU.uSunColor, uCamPos: { value: new THREE.Vector3() },
        uFrame: frameU.uFrame, uTime: { value: 0 }, uSteps: { value: 32 }, uLowRes: { value: low },
        uLightCount: { value: 0 },
        uLightPos: { value: Array.from({ length: MAXL }, () => new THREE.Vector4()) },
        uLightCol: { value: Array.from({ length: MAXL }, () => new THREE.Color()) },
      },
      vertexShader: VERT, fragmentShader: MARCH_FRAG, depthTest: false, depthWrite: false,
    });
    this.resolveMat = new THREE.ShaderMaterial({
      uniforms: { ...cam, tCur: { value: this.rtMarch.texture }, tHist: { value: null }, uPrevViewProj: frameU.uPrevViewProj, uLowRes: { value: low }, uReset: { value: 1 }, uBlend: { value: 0.2 } },
      vertexShader: VERT, fragmentShader: RESOLVE_FRAG, depthTest: false, depthWrite: false,
    });
    this.compMat = new THREE.ShaderMaterial({
      uniforms: { ...cam, tDiffuse: { value: null }, tFog: { value: null }, uLowRes: { value: low } },
      vertexShader: VERT, fragmentShader: COMPOSITE_FRAG, depthTest: false, depthWrite: false,
    });
    this.fsq = new FullScreenQuad(null);
    this._size = new THREE.Vector2(1, 1);
    // qualité et lumières relues au début de chaque image ; la passe écran « rays » s'efface devant celle-ci
    R.onFrame.push((dt, time) => this._frame(dt, time));
  }

  // o : réglages de la planète (L.environment) — o.volumetric = { density (diffusion par mètre au pied de la
  // brume), floor (part de densité en altitude), extinction (atténuation relative à la diffusion), noise,
  // noiseScale, anisotropy, sun, lights, ambient (couleur), ambientAmount, tint, wind [x, y, z], maxDist } ;
  // false pour l'éteindre
  configure(level, o) {
    this.level = level;
    const v = o.volumetric === false ? null : o.volumetric || {};
    this.planetOn = !!v;
    if (!v) return;
    volU.uDensity.value = v.density ?? 0.012;
    volU.uFloor.value = v.floor ?? 0.25;
    volU.uExt.value = v.extinction ?? 0.5;
    volU.uNoise.value = v.noise ?? 0.65;
    volU.uNoiseScale.value = v.noiseScale ?? 0.07;
    volU.uAniso.value = v.anisotropy ?? 0.6;
    volU.uSunScatter.value = v.sun ?? 1;
    volU.uLightScatter.value = v.lights ?? 1;
    volU.uAmbient.value.set(v.ambient || o.fogColor || o.skyHorizon || '#ffffff').multiplyScalar(v.ambientAmount ?? 0.3);
    volU.uTint.value.set(v.tint || '#ffffff');
    volU.uWind.value.set(...(v.wind || [0.05, 0.008, 0.03]));
    volU.uMaxDist.value = v.maxDist ?? 160;
    this._reset = true;
  }
  detach(level) {
    if (this.level === level) { this.level = null; this.planetOn = false; }
  }

  _frame(dt, time) {
    const R = this.R;
    const Q = R.Q;
    this.active = !!(Q.volumetric && this.level && this.planetOn && csmU.uCsmOn.value > 0.5);
    this.enabled = this.active;
    R.rays.enabled = !this.active && !!Q.rays;
    if (!this.active) { this._reset = true; return; }
    if (this._scale !== Q.volScale) { this._scale = Q.volScale; this.setSize(this._size.x, this._size.y); }
    const u = this.marchMat.uniforms;
    u.uSteps.value = Q.volSteps;
    u.uTime.value = time;
    const cam = R.camera;
    u.uCamPos.value.copy(cam.position);
    // téléportation ou coupure de plan : l'historique ne vaut plus rien
    if (this._camPrev.distanceToSquared(cam.position) > 25) this._reset = true;
    this._camPrev.copy(cam.position);
    this._updateLights(dt, cam.position);
  }

  // jusqu'à 8 lumières ponctuelles allumées, les plus proches de la caméra (liste de la scène relue 2 fois par s)
  _updateLights(dt, camPos) {
    this._scan -= dt;
    if (this._scan <= 0) {
      this._scan = 0.5;
      this.lights.length = 0;
      this.R.scene.traverseVisible((o) => { if (o.isPointLight) this.lights.push(o); });
    }
    const u = this.marchMat.uniforms;
    const pick = [];
    for (const l of this.lights) {
      if (l.intensity <= 0 || !l.visible || !l.parent) continue;
      l.getWorldPosition(_p);
      const range = l.distance > 0 ? l.distance : 30;
      const score = _p.distanceTo(camPos) - range;
      if (score > 90) continue;
      pick.push([score, l, _p.clone(), range]);
    }
    pick.sort((a, b) => a[0] - b[0]);
    const n = Math.min(MAXL, pick.length);
    for (let i = 0; i < n; i++) {
      const [, l, p, range] = pick[i];
      u.uLightPos.value[i].set(p.x, p.y, p.z, range);
      u.uLightCol.value[i].copy(l.color).multiplyScalar(l.intensity);
    }
    u.uLightCount.value = n;
  }

  setSize(w, h) {
    this._size.set(w, h);
    const k = (this._scale || 0.5) / this.R.renderer.getPixelRatio();
    const lw = Math.max(1, Math.round(w * k)), lh = Math.max(1, Math.round(h * k));
    this.rtMarch.setSize(lw, lh);
    this.hist[0].setSize(lw, lh);
    this.hist[1].setSize(lw, lh);
    this.low.set(lw, lh);
    this._reset = true;
  }

  render(renderer, writeBuffer, readBuffer) {
    if (!this.active) { this.needsSwap = false; return; }
    this.needsSwap = true;
    renderer.setRenderTarget(this.rtMarch);
    this.fsq.material = this.marchMat;
    this.fsq.render(renderer);
    const prev = this.hist[this.cur], next = this.hist[1 - this.cur];
    this.cur = 1 - this.cur;
    const ru = this.resolveMat.uniforms;
    ru.tHist.value = prev.texture;
    ru.uReset.value = this._reset ? 1 : 0;
    this._reset = false;
    renderer.setRenderTarget(next);
    this.fsq.material = this.resolveMat;
    this.fsq.render(renderer);
    const cu = this.compMat.uniforms;
    cu.tDiffuse.value = readBuffer.texture;
    cu.tFog.value = next.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsq.material = this.compMat;
    this.fsq.render(renderer);
  }

  dispose() {
    this.rtMarch.dispose();
    this.hist[0].dispose();
    this.hist[1].dispose();
    this.marchMat.dispose();
    this.resolveMat.dispose();
    this.compMat.dispose();
    this.fsq.dispose();
  }
}
const _p = new THREE.Vector3();

// Un seul brouillard par moteur de rendu, inséré avant le halo lumineux
export function volumetrics(R) {
  if (!R.volumetrics) R.volumetrics = R.addPost(new VolumetricPass(R), 'bloom');
  return R.volumetrics;
}
