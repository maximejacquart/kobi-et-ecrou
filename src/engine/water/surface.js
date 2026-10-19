// Surface d'eau (et variantes lave, acide, glace) : matériau physique de three.js détourné.
// Le moteur d'éclairage fait le gros du travail — éclat du soleil (GGX très étroit, ombré), reflets du ciel
// (carte d'environnement) ou réflexion planaire, lumières ponctuelles, brouillard — et ce module y ajoute :
//  - houle de Gerstner (sommets) + normales de détail multi-échelles qui suivent le courant (flow map)
//  - ondes dynamiques (simulation autour de Kobi), scintillements
//  - réfraction de l'image opaque (garde anti-fuite par la profondeur), absorption Beer-Lambert, diffusion
//  - écume de rive (différence de profondeur), de sillage (derrière les obstacles) et des ondes
// La couleur diffuse est blanche : la lumière diffuse calculée (soleil ombré, ciel, ambiance) sert de mesure de
// l'éclairement reçu, réutilisée pour l'écume et la diffusion dans le volume d'eau.
import * as THREE from 'three';
import { frameU } from '../frame.js';
import { globalU } from '../materials.js';
import { waveTexture, foamTexture } from './textures.js';
import { SSR_TRACE_GLSL } from '../ssr.js';

// uniformes communs à toutes les surfaces (mis à jour par water.js)
export const waterU = {
  uWTime: { value: 0 },
  uWDetail: { value: 2 },
  uWDebug: { value: 0 },
  tWaves: { value: null },
  tWFoam: { value: null },
  tSceneColor: frameU.tSceneColor,
  tSceneDepth: frameU.tSceneDepth,
  uRes: frameU.uRes,
  uCamNear: frameU.uCamNear,
  uCamFar: frameU.uCamFar,
  // ondes dynamiques : (centre x, centre z, taille, actif)
  tRipple: { value: null },
  uRipple: { value: new THREE.Vector4(0, 0, 1, 0) },
  // réflexion planaire : matrice de projection du miroir, (hauteur du plan, actif)
  tReflect: { value: null },
  uReflMat: { value: new THREE.Matrix4() },
  uRefl: { value: new THREE.Vector2(0, 0) },
  // reflets tracés à l'écran depuis la surface, dans l'image opaque (Haute, et Ultra hors miroir)
  uWProj: frameU.uProj,
  uWLinZ: frameU.uLinZ,
  uWSSR: { value: 0 },
  uWSSRSteps: { value: 24 },
  uWSunDir: frameU.uSunDir,
  uWSunColor: frameU.uSunColor,
};

const VERT_PARS = /* glsl */ `
uniform float uWTime;
uniform vec4 uWave[4];
uniform float uWSteep;
varying vec3 vWPos;
varying vec3 vWNrm;
varying float vCrest;
// Houle de Gerstner : 4 trains d'ondes (direction xy, amplitude, longueur d'onde) ; crêtes pointues
vec3 kGerstner(vec2 p, out vec3 n, out float crest) {
  vec3 o = vec3(0.0);
  n = vec3(0.0, 1.0, 0.0);
  crest = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 w = uWave[i];
    if (w.z <= 0.0) continue;
    float k = 6.2831853 / w.w;
    float c = sqrt(9.8 / k);
    float f = k * (dot(w.xy, p) - c * uWTime);
    float q = uWSteep / (k * w.z * 4.0);
    float sf = sin(f), cf = cos(f);
    o += vec3(q * w.z * w.x * cf, w.z * sf, q * w.z * w.y * cf);
    n -= vec3(w.x * k * w.z * cf, q * k * w.z * sf, w.y * k * w.z * cf);
    crest += (sf * 0.5 + 0.5) * w.z;
  }
  return o;
}
`;

const VERT_MAIN = /* glsl */ `
#include <begin_vertex>
{
  vec3 kw = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vec3 kn; float kc;
  transformed += kGerstner(kw.xz, kn, kc);
  vWNrm = normalize(kn);
  vCrest = kc;
  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
}
`;

const FRAG_PARS = /* glsl */ `
uniform float uWTime, uWDetail, uWDebug;
uniform sampler2D tWaves, tWFoam;
uniform sampler2D tSceneColor, tSceneDepth;
uniform vec2 uRes;
uniform float uCamNear, uCamFar;
uniform sampler2D tRipple;
uniform vec4 uRipple;
uniform sampler2D tReflect;
uniform mat4 uReflMat;
uniform vec2 uRefl;
uniform mat4 uWProj;
uniform vec2 uWLinZ;
uniform float uWSSR, uWSSRSteps;
${SSR_TRACE_GLSL}
uniform vec3 uWSunDir, uWSunColor;
// propres à chaque plan d'eau
uniform float uLevel, uNormStr, uRefr, uFoamAmt, uShoreW, uGlowAmt, uRippleStr, uTurbid, uFlowMap, uFlowMax, uEdge, uWaveAmp, uCrust;
uniform vec3 uShallow, uDeep, uAbsorb, uFoamCol, uGlow;
uniform vec2 uFlow;
uniform vec3 uScale;
uniform vec4 uLamp[12];
uniform vec3 uLampCol[12];
uniform int uLampN;
uniform vec4 uFlowRect;
uniform sampler2D tFlow;
varying vec3 vWPos;
varying vec3 vWNrm;
varying float vCrest;
float kSunSh = 1.0;
float kWSun(float s) { kSunSh = s; return s; }
float kHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 kSlope(vec2 uv) { return texture2D(tWaves, uv).rg * 2.0 - 1.0; }
// courant variable : deux échantillons décalés d'une demi-période, fondus (pas d'étirement sans fin)
vec2 kFlowSlope(vec2 p, vec2 flow, float scale, float t) {
  float ph0 = fract(t), ph1 = fract(t + 0.5);
  float w = abs(ph0 - 0.5) * 2.0;
  vec2 a = kSlope((p - flow * ph0 * 2.5) * scale);
  vec2 b = kSlope((p - flow * ph1 * 2.5) * scale + 0.37);
  return mix(a, b, w) * 1.3;
}
float kLin(float d) { return (uCamNear * uCamFar) / (uCamFar - (uCamFar - uCamNear) * d); }
`;

// Préparation (après la couleur de base) : normales, profondeurs, réfraction, écume, émission
const FRAG_PREP = /* glsl */ `
vec3 kV = normalize(cameraPosition - vWPos);
float kDist = length(cameraPosition - vWPos);
vec2 kP = vWPos.xz;
float kT = uWTime;
bool kUnder = !gl_FrontFacing;
// courant (constant, ou carte : rg = vitesse, b = sillage)
vec2 kFlow = uFlow;
float kWake = 0.0;
if (uFlowMap > 0.5) {
  vec4 fm = texture2D(tFlow, (kP - uFlowRect.xy) / uFlowRect.zw);
  kFlow = (fm.rg * 2.0 - 1.0) * uFlowMax;
  kWake = fm.b;
}
float kFar = 1.0 - 0.7 * smoothstep(18.0, 150.0, kDist);
vec2 kS = vec2(0.0);
#ifndef WATER_GLACE
  if (uFlowMap > 0.5) {
    kS += kFlowSlope(kP, kFlow, uScale.x, kT * 0.4) * 0.62;
    kS += kFlowSlope(kP + 7.3, kFlow * 1.2, uScale.y, kT * 0.4 + 0.25) * 0.42 * kFar;
  } else {
    kS += kSlope((kP - kFlow * kT) * uScale.x + vec2(kT * 0.011, kT * 0.006)) * 0.62;
    // seconde couche tournée : casse la répétition et la direction dominante de la première
    vec2 kq = mat2(0.454, -0.891, 0.891, 0.454) * ((kP - kFlow * kT * 1.2) * uScale.y) + vec2(-kT * 0.023, kT * 0.017);
    kS += mat2(0.454, 0.891, -0.891, 0.454) * kSlope(kq) * 0.42 * kFar;
  }
  if (uWDetail > 0.5) kS += kSlope(kP * uScale.z + vec2(kT * 0.045, -kT * 0.052)) * 0.26 * kFar;
#else
  // glace : relief figé, ondulations lentes du gel et micro-rayures
  kS += kSlope(kP * 0.035) * 0.3 + kSlope(kP * 0.5 + 0.3) * 0.08 * kFar;
#endif
kS *= uNormStr * (1.0 + kWake * 0.8);
// ondes dynamiques (r = hauteur, g = vitesse, ba = pente)
vec4 kR = vec4(0.0);
if (uRipple.w > 0.5) {
  vec2 ruv = (kP - uRipple.xy) / uRipple.z + 0.5;
  vec2 re = smoothstep(0.0, 0.1, ruv) * smoothstep(1.0, 0.9, ruv);
  kR = texture2D(tRipple, ruv) * (re.x * re.y);
}
#ifndef WATER_GLACE
  kS += kR.ba * uRippleStr;
#endif
float kFoam = 0.0, kStreak = 0.0;
vec3 kEmit = vec3(0.0);
#ifdef WATER_ACIDE
  // nappes de mousse toxique qui dérivent, lueur propre du liquide
  {
    vec2 ap = kP - kFlow * kT;
    float blot = texture2D(tWFoam, ap * 0.045).a + texture2D(tWFoam, ap * 0.19 + kT * 0.006).g * 0.25;
    kFoam += smoothstep(0.66, 0.86, blot) * 0.7;
    kEmit += uGlow * (0.35 + 0.5 * texture2D(tWFoam, ap * 0.03 + 0.5).a);
  }
  // bulles : une par cellule, qui gonfle puis éclate (deux grilles décalées)
  for (int j = 0; j < 2; j++) {
    float sc = j == 0 ? 1.7 : 1.05;
    vec2 bc = (kP - kFlow * kT) / sc + float(j) * 17.3;
    vec2 bi = floor(bc);
    float bh = kHash(bi);
    if (bh < 0.62) continue;
    vec2 bo = vec2(kHash(bi + 1.3), kHash(bi + 7.1)) * 0.5 + 0.25;
    vec2 bd = (fract(bc) - bo) * sc;
    float life = fract(kT * (0.16 + bh * 0.2) + bh * 13.0);
    float rad = mix(0.05, 0.3, smoothstep(0.0, 0.8, life)) * (0.7 + bh * 0.4);
    float d = length(bd);
    if (life < 0.86) {
      float dome = 1.0 - smoothstep(rad * 0.85, rad, d);
      float hgt = sqrt(max(0.0, 1.0 - (d * d) / (rad * rad)));
      kS += bd / max(rad, 0.01) * dome * (1.0 - hgt * 0.6) * 1.6;
      kFoam += smoothstep(rad * 0.75, rad, d) * dome * 0.5;
      kEmit += uGlow * dome * 0.5;
    } else {
      // éclatement : anneau qui s'élargit
      float pr = (life - 0.86) / 0.14;
      float ring = smoothstep(0.04, 0.0, abs(d - rad * (1.0 + pr * 2.0))) * (1.0 - pr);
      kFoam += ring * 0.8;
      kS += normalize(bd + 1e-4) * ring * 0.5;
    }
  }
#endif
vec3 kN = normalize(vec3(vWNrm.x - kS.x * vWNrm.y, vWNrm.y, vWNrm.z - kS.y * vWNrm.y));
if (kUnder) kN = -kN;

// --- image opaque derrière la surface : profondeurs, réfraction
float kWd0 = 10.0, kL = 50.0;
vec3 kRefr = vec3(0.0), kRaw = vec3(0.0);
float kEdgeF = 1.0;
#ifndef WATER_LAVE
{
  vec2 suv = gl_FragCoord.xy / uRes;
  float surfZ = max(vViewPosition.z, 1e-3);
  vec3 ray = vWPos - cameraPosition;
  float z0 = kLin(texture2D(tSceneDepth, suv).x);
  vec3 floor0 = cameraPosition + ray * (z0 / surfZ);
  kWd0 = kUnder ? 10.0 : vWPos.y - floor0.y;
  // décalage écran selon la pente, nul au bord (raccord invisible avec la rive)
  vec3 nV = (viewMatrix * vec4(kN - vec3(0.0, kUnder ? -1.0 : 1.0, 0.0), 0.0)).xyz;
  float amt = uRefr * clamp(kWd0 * 0.6, 0.0, 1.0) / (1.0 + surfZ * 0.03);
  vec2 uv2 = suv + nV.xy * amt;
  float z2 = kLin(texture2D(tSceneDepth, uv2).x);
  vec3 floor2 = cameraPosition + ray * (z2 / surfZ);
  // garde anti-fuite : pas de couleur prise sur un objet devant l'eau (ni au-dessus de la surface)
  if (z2 < surfZ || (!kUnder && floor2.y > vWPos.y + 0.05)) { uv2 = suv; z2 = z0; floor2 = floor0; }
  kRefr = texture2D(tSceneColor, uv2).rgb;
  kRaw = texture2D(tSceneColor, suv).rgb;
  // trajet dans l'eau : rayon de vue + descente de la lumière jusqu'au fond
  float wd = max(vWPos.y - floor2.y, 0.0);
  kL = min((z2 - surfZ) * length(ray) / surfZ + wd * 0.5, 400.0);
  kEdgeF = kUnder ? 1.0 : smoothstep(0.0, uEdge, kWd0);
}
#endif

#if defined(WATER_EAU) || defined(WATER_ACIDE)
{
  // écume de rive : dense à la ligne d'eau, en dentelle de bulles de plus en plus clairsemée vers le large
  vec2 fp = kP - kFlow * kT * 0.6;
  float bub = texture2D(tWFoam, fp * 0.42).r;
  float bub2 = texture2D(tWFoam, fp * 0.17 + 0.5).r;
  float brk = texture2D(tWFoam, kP * 0.06 + vec2(kT * 0.004, 0.0)).g;
  float shore = 1.0 - smoothstep(0.0, uShoreW, kWd0);
  float lines = sin(kWd0 / max(uShoreW, 0.01) * 6.0 - kT * 1.2 + brk * 9.0) * 0.5 + 0.5;
  float lace = bub * 0.7 + bub2 * 0.45 + pow(shore, 5.0) * 0.6;
  float thr = mix(1.1, 0.2, shore) + (brk - 0.5) * 0.55 - lines * 0.22 * shore;
  // pente du fond (profondeur gagnée par mètre) : sur une paroi raide, juste un fin liseré discret
  float dpx = length(vec2(dFdx(kWd0), dFdy(kWd0)));
  float mpx = max(length(dFdx(vWPos.xz)) + length(dFdy(vWPos.xz)), 1e-4);
  float wall = mix(0.22, 1.0, 1.0 - smoothstep(0.8, 2.5, dpx / mpx));
  // le long de la rive, l'écume se fait par endroits et laisse des trouées
  float gaps = smoothstep(0.32, 0.62, texture2D(tWFoam, kP * 0.035 + vec2(kT * 0.003, 0.0)).g + lines * 0.12);
  float f = smoothstep(thr, thr + 0.12, lace) * smoothstep(0.0, 0.12, shore) * wall * mix(0.35, 1.0, gaps);
  // filets de courant : lignes de niveau d'un bruit étiré dans le sens du courant général (repère fixe :
  // pas de motif en étoile autour des obstacles), plus marqués là où l'eau file
  float fs = length(kFlow), fb = length(uFlow);
  if (fb > 0.08) {
    vec2 fd = uFlow / fb;
    vec2 sq = vec2(dot(kP, vec2(-fd.y, fd.x)) * 0.16, dot(kP, fd) * 0.02 - kT * fb * 0.02);
    float sn = texture2D(tWaves, sq * 0.6).b - 0.5;
    float aa = fwidth(sn) * 1.2 + 0.01;
    kStreak = (1.0 - smoothstep(0.0, aa, abs(sn))) * smoothstep(0.1, 0.9, fs) * kFar * kFar;
  }
  // sillage (étrave et traîne des obstacles, dans le courant) : filets serrés et bulles
  float wake = kWake * clamp(kStreak * 0.9 + smoothstep(0.7, 0.95, lace) * 0.5 + smoothstep(0.6, 1.0, kWake) * 0.35, 0.0, 1.0);
  // crêtes de houle (mer formée seulement) et ondes
  float crest = smoothstep(0.8, 1.0, vCrest / max(0.001, uWaveAmp)) * smoothstep(0.15, 0.5, uWaveAmp) * bub;
  float rip = smoothstep(0.03, 0.12, abs(kR.r) + abs(kR.g) * 2.0) * smoothstep(0.45, 0.8, lace);
  kFoam = clamp(kFoam + (f + wake + crest * 0.6 + rip * 0.7 + kStreak * 0.06) * uFoamAmt, 0.0, 1.0);
  if (kUnder) kFoam *= 0.3;
}
#endif

#if defined(WATER_EAU) || defined(WATER_ACIDE) || defined(WATER_GLACE)
  // lanternes au-dessus de l'eau : reflet en traînée (pente des vagues) et flaque de lumière diffuse
  if (uLampN > 0 && !kUnder) {
    vec3 rv = reflect(-kV, kN);
    for (int i = 0; i < 12; i++) {
      if (i >= uLampN) break;
      vec3 lp = uLamp[i].xyz - vWPos;
      float ld = length(lp);
      lp /= ld;
      float sp = pow(clamp(dot(rv, lp), 0.0, 1.0), 900.0) * 2.5 + pow(clamp(dot(rv, lp), 0.0, 1.0), 60.0) * 0.1;
      float pool = exp(-ld * ld / (3.0 * uLamp[i].w));
      kEmit += uLampCol[i] * (sp * (1.0 - kFoam) + pool * 0.18) * uLamp[i].w;
    }
  }
#endif
#ifdef WATER_EAU
  // plancton luminescent : s'allume dans les ondes, l'écume et le sillage ; quelques points qui scintillent
  if (uGlowAmt > 0.0) {
    // plancton : s'allume dans les ondes, suit les filets du courant et les sillages ; points qui scintillent
    vec2 fp2 = kP - kFlow * kT;
    float act = clamp(abs(kR.r) * 6.0 + length(kR.ba) * 0.9, 0.0, 1.5);
    vec2 gp = fp2 * 2.2;
    vec2 gi = floor(gp);
    float gh = kHash(gi);
    float gd = length(fract(gp) - vec2(kHash(gi + 3.1), kHash(gi + 5.7)) * 0.8 - 0.1);
    float tw = 0.5 + 0.5 * sin(kT * (0.7 + gh * 2.0) + gh * 40.0);
    float dots = smoothstep(0.09, 0.0, gd) * step(0.72, gh) * tw * (0.25 + kWake + kStreak * 0.8);
    kEmit += uGlow * uGlowAmt * (act * 2.4 + dots * 1.5 + kStreak * (0.025 + kWake * 0.4) + kWake * 0.03 + kFoam * kWake * 0.2);
  }
#endif
`;

// Réflexion : planaire (Ultra), reflets écran (si fournis), sinon carte d'environnement (déjà dans radiance)
const FRAG_RADIANCE = /* glsl */ `
#include <lights_fragment_maps>
#ifndef WATER_LAVE
if (!kUnder && uRefl.y > 0.5 && abs(uLevel - uRefl.x) < 0.05) {
  vec4 rc = uReflMat * vec4(vWPos.x, uRefl.x, vWPos.z, 1.0);
  vec2 ruv = rc.xy / rc.w + kS * 0.05 / (1.0 + kDist * 0.02) + (kN.xz - vWNrm.xz) * 0.04;
  vec2 re = smoothstep(0.0, 0.03, ruv) * smoothstep(1.0, 0.97, ruv);
  radiance = mix(radiance, texture2D(tReflect, ruv).rgb, re.x * re.y);
}
if (uWSSR > 0.5 && !kUnder && !(uRefl.y > 0.5 && abs(uLevel - uRefl.x) < 0.05)) {
  // rayon réfléchi depuis la surface, tracé dans la profondeur de l'image opaque ; la couleur vient de la même image
  vec3 kVP = -vViewPosition;
  vec3 kNVw = normalize((viewMatrix * vec4(kN, 0.0)).xyz);
  vec3 kRD = reflect(normalize(kVP), kNVw);
  float kJit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec4 kHit = kobiTraceScreen(tSceneDepth, uRes, uWProj, uWLinZ, kVP + kNVw * 0.05, kRD, 90.0, uWSSRSteps, kJit, 0.6);
  if (kHit.w > 0.5) {
    vec2 kE = smoothstep(0.0, 0.07, kHit.xy) * smoothstep(1.0, 0.93, kHit.xy);
    float kConf = kE.x * kE.y * (1.0 - smoothstep(50.0, 90.0, kHit.z));
    radiance = mix(radiance, texture2D(tSceneColor, kHit.xy).rgb, kConf);
  }
}
#endif
`;

// Composition finale (remplace la sortie standard)
const FRAG_OUT = /* glsl */ `
vec3 kLightW = totalDiffuse;
// pic du soleil plafonné : un éclat très vif, pas une tache qui noie le halo lumineux
totalSpecular = min(totalSpecular, vec3(8.0));
float kNV = clamp(dot(kN, kV), 0.0, 1.0);
float kF = 0.02 + 0.98 * pow(1.0 - kNV, 5.0);
vec3 kCol;
#if defined(WATER_EAU) || defined(WATER_ACIDE)
{
  // volume : transmission (absorption par canal), puis diffusion vers la couleur du fond
  vec3 T = exp(-uAbsorb * kL);
  vec3 tint = mix(vec3(1.0), uShallow, smoothstep(0.0, 1.5, kL));
  float S = 1.0 - exp(-uTurbid * kL);
  vec3 deepLit = uDeep * (kUnder ? (kLightW + 0.25) : kLightW);
  vec3 under = mix(kRefr * T * tint, deepLit, S);
  // scintillements : micro-facettes alignées sur le soleil
  float gl = 0.0;
  if (uWDetail > 0.5) {
    vec3 gn = normalize(kN + vec3(kSlope(kP * 2.3 + vec2(kT * 0.13, kT * 0.09)) * 0.35, 0.0).xzy);
    gl = pow(clamp(dot(reflect(-kV, gn), uWSunDir), 0.0, 1.0), 2400.0) * 60.0 * kSunSh * kFar;
  }
  if (kUnder) {
    // vu d'en dessous : fenêtre de Snell, réflexion totale au-delà
    float tir = smoothstep(0.62, 0.75, 1.0 - kNV);
    kCol = mix(kRefr * T + deepLit * 0.2, deepLit, tir);
  } else {
    kCol = under * (1.0 - kF) + totalSpecular + min(uWSunColor * gl * (1.0 - kFoam) * 0.02, vec3(6.0));
  }
  kCol = mix(kCol, uFoamCol * kLightW, kFoam * 0.92);
  kCol += kEmit;
  kCol = mix(kRaw, kCol, kEdgeF);
}
#elif defined(WATER_GLACE)
{
  // glace : fond réfracté et absorbé (bleu), bulles et fissures prises dans l'épaisseur (parallaxe), givre
  vec3 T = exp(-uAbsorb * kL);
  float S = 1.0 - exp(-uTurbid * kL);
  vec3 rd = refract(-kV, kN, 1.0 / 1.31);
  vec3 inner = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    float dd = 0.08 + float(i) * 0.26;
    vec2 q = kP + rd.xz / max(-rd.y, 0.25) * dd;
    vec4 f = texture2D(tWFoam, q * (0.7 + float(i) * 0.37) + float(i) * 0.173);
    vec4 c = texture2D(tWFoam, q * (0.06 + float(i) * 0.013) + float(i) * 0.31);
    // bulles en grappes, fissures en voiles blancs (trait net + halo laiteux)
    float bubble = smoothstep(0.95, 0.995, 1.0 - f.r) * smoothstep(0.58, 0.7, c.a);
    float crack = ((1.0 - smoothstep(0.0, 0.05, c.b)) + (1.0 - smoothstep(0.0, 0.3, c.b)) * 0.22) * smoothstep(0.4, 0.6, c.a);
    inner += vec3(0.82, 0.94, 1.0) * (bubble * 0.9 + crack) * exp(-dd * 1.1);
  }
  // givre en surface : plaques claires, plus denses le long des fissures de surface
  vec4 fr = texture2D(tWFoam, kP * 0.07);
  float scrack = (1.0 - smoothstep(0.0, 0.035, texture2D(tWFoam, kP * 0.045 + 0.7).b)) * smoothstep(0.4, 0.6, fr.a);
  float feather = texture2D(tWFoam, kP * 0.9).g * 0.3 + texture2D(tWFoam, kP * 2.3).r * 0.15;
  float frost = clamp(smoothstep(0.72, 0.98, fr.a + feather) * 0.8 + scrack * 0.6, 0.0, 1.0);
  vec3 under = mix(kRefr * T * uShallow, uDeep * kLightW, S) + inner * kLightW * 0.55;
  kCol = under * (1.0 - kF) + totalSpecular * (1.0 - frost * 0.7);
  kCol = mix(kCol, uFoamCol * kLightW, frost * uFoamAmt);
  kCol = mix(kRaw, kCol, kEdgeF);
}
#else
  kCol = outgoingLight;
#endif
gl_FragColor = vec4(kCol, 1.0);
if (uWDebug > 0.5) {
  vec3 dbg = uWDebug < 1.5 ? vec3(kEdgeF) : uWDebug < 2.5 ? totalSpecular : uWDebug < 3.5 ? kLightW : uWDebug < 4.5 ? kRefr : uWDebug < 5.5 ? kEmit : uWDebug < 6.5 ? vec3(kFoam) : vec3(abs(kR.r) * 8.0, length(kR.ba), kR.g * 8.0 + 0.5);
  gl_FragColor = vec4(dbg, 1.0);
}
`;

// Lave / métal en fusion : plaques de croûte qui dérivent, fissures incandescentes, zones fondues qui respirent
const FRAG_LAVA_PREP = /* glsl */ `
float kCrust = 0.0;
#ifdef WATER_LAVE
{
  // courant lent, déformé en tourbillons
  vec2 lp = kP - kFlow * kT;
  vec2 warp = (texture2D(tWaves, lp * 0.02 + vec2(kT * 0.004, 0.0)).rg - 0.5) * 7.0;
  vec2 wp = lp + warp;
  // croûte : plaques irrégulières qui couvrent une part de la surface (uCrust), fissures entre elles
  vec4 c1 = texture2D(tWFoam, wp * 0.05);
  float blot = texture2D(tWFoam, wp * 0.04 + 0.3).a;
  float ct = 0.92 - uCrust * 0.58;
  float cover = smoothstep(ct - 0.05, ct + 0.05, blot + c1.g * 0.22);
  float cell = smoothstep(0.04, 0.22, c1.b);
  // au loin (ou en vue rasante), les fissures deviennent plus fines qu'un pixel et le filtrage les efface : les plaques
  // paraîtraient unies et sombres. On garde la part de fissures incandescentes qu'on ne peut plus dessiner
  cell = mix(cell, 0.62, smoothstep(0.006, 0.03, length(fwidth(wp * 0.05))));
  kCrust = cover * cell;
  // relief : plaques bombées, liquide lisse qui ondule à peine
  kS = kSlope(wp * 0.14) * 0.3 * kCrust + kSlope(lp * 0.35) * 0.04 + kR.ba * 0.3;
  kN = normalize(vec3(vWNrm.x - kS.x, vWNrm.y, vWNrm.z - kS.y));
  // liquide : tourbillons plus ou moins chauds, fissures et ondes incandescentes
  float swirl = texture2D(tWaves, wp * 0.05 + vec2(0.0, kT * 0.008)).b;
  float swirl2 = texture2D(tWaves, wp * 0.13 - vec2(kT * 0.011, 0.0)).a;
  float heat = (1.0 - kCrust) * smoothstep(0.25, 1.0, swirl * 0.75 + swirl2 * 0.45);
  float rim = (1.0 - cell) * cover;
  float rip = clamp(abs(kR.r) * 4.0 + abs(kR.g) * 6.0, 0.0, 1.0);
  // de l'orange sombre (moins chaud) au jaune presque blanc (veines les plus chaudes)
  vec3 hotC = mix(uShallow * 0.7, uShallow, smoothstep(0.0, 0.35, heat));
  hotC = mix(hotC, uGlow, smoothstep(0.35, 0.9, heat));
  kEmit = hotC * (1.0 - kCrust) * (0.45 + heat * 1.05) + uGlow * (rim * 0.75 + rip * 1.0);
}
#endif
`;
const FRAG_LAVA_OUT = /* glsl */ `
#ifdef WATER_LAVE
  kCol = uDeep * kLightW * kCrust + totalSpecular * mix(0.3, 0.4, kCrust) + kEmit;
  gl_FragColor = vec4(kCol, 1.0);
#endif
`;

const LIGHTS_BEGIN = THREE.ShaderChunk.lights_fragment_begin.replace(
  /\? getShadow\( directionalShadowMap\[ i \],([^;]*?)vDirectionalShadowCoord\[ i \] \) : 1\.0;/,
  '? kWSun( getShadow( directionalShadowMap[ i ],$1vDirectionalShadowCoord[ i ] ) ) : 1.0;',
);

const TYPE_DEFINE = { eau: 'WATER_EAU', lave: 'WATER_LAVE', acide: 'WATER_ACIDE', glace: 'WATER_GLACE' };

// Uniformes propres à un plan d'eau (o : options complètes, déjà résolues par water.js)
export function surfaceUniforms(o) {
  const c = (x) => new THREE.Color(x);
  const waves = [];
  for (let i = 0; i < 4; i++) {
    const w = o.waves[i];
    waves.push(w ? new THREE.Vector4(Math.cos(w[0]), Math.sin(w[0]), w[1], w[2]) : new THREE.Vector4(1, 0, 0, 1));
  }
  return {
    uWave: { value: waves },
    uWSteep: { value: o.steep },
    uWaveAmp: { value: o.waves.reduce((a, w) => a + (w ? w[1] : 0), 0) },
    uLevel: { value: o.y },
    uNormStr: { value: o.normal },
    uRefr: { value: o.refraction },
    uFoamAmt: { value: o.foam },
    uShoreW: { value: o.shore },
    uGlowAmt: { value: o.glowAmount },
    uRippleStr: { value: o.rippleStrength },
    uTurbid: { value: o.turbidity },
    uCrust: { value: o.crust ?? 0.5 },
    uEdge: { value: o.edge },
    uShallow: { value: c(o.shallow) },
    uDeep: { value: c(o.deep) },
    uAbsorb: { value: new THREE.Vector3(...o.absorb) },
    uFoamCol: { value: c(o.foamColor) },
    uGlow: { value: c(o.glow).multiplyScalar(o.glowIntensity) },
    uFlow: { value: new THREE.Vector2(...o.flow) },
    uScale: { value: new THREE.Vector3(1 / o.scale[0], 1 / o.scale[1], 1 / o.scale[2]) },
    uFlowMap: { value: o.flowMap ? 1 : 0 },
    uFlowMax: { value: o.flowMax || 1 },
    uFlowRect: { value: new THREE.Vector4(...(o.flowRect || [0, 0, 1, 1])) },
    tFlow: { value: o.flowMap || null },
    uLamp: { value: Array.from({ length: 12 }, () => new THREE.Vector4()) },
    uLampCol: { value: Array.from({ length: 12 }, () => new THREE.Color()) },
    uLampN: { value: 0 },
  };
}

export function surfaceMaterial(type, o, u) {
  waterU.tWaves.value = waveTexture();
  waterU.tWFoam.value = foamTexture();
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: o.roughness,
    metalness: 0,
    ior: o.ior,
    side: type === 'lave' ? THREE.FrontSide : THREE.DoubleSide,
  });
  m.defines = { [TYPE_DEFINE[type]]: '' };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, waterU, u, {
      uFogBase: globalU.uFogBase, uFogFall: globalU.uFogFall, uFogHeight: globalU.uFogHeight,
      uFogSunDir: globalU.uFogSunDir, uFogSunCol: globalU.uFogSunCol, uFogSun: globalU.uFogSun,
    });
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', VERT_PARS + '\nvoid main() {')
      .replace('#include <begin_vertex>', VERT_MAIN);
    shader.fragmentShader = '#define HEIGHT_FOG\n' + shader.fragmentShader
      .replace('void main() {', FRAG_PARS + '\nvoid main() {')
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_PREP + FRAG_LAVA_PREP)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.75, max(kFoam, kCrust));
        #ifdef WATER_GLACE
          roughnessFactor = mix(roughnessFactor, 0.6, smoothstep(0.7, 0.86, texture2D(tWFoam, kP * 0.07).a));
        #endif
        roughnessFactor += (1.0 - kFar) * 0.12;`)
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(kN, 0.0)).xyz);')
      .replace('#include <lights_fragment_begin>', LIGHTS_BEGIN)
      .replace('#include <lights_fragment_maps>', FRAG_RADIANCE)
      .replace('#include <opaque_fragment>', FRAG_OUT + FRAG_LAVA_OUT);
  };
  m.customProgramCacheKey = () => 'water-' + type;
  return m;
}
