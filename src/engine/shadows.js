// Ombres du soleil en cascades (Ultra : 3, Haute : 2). La Moyenne garde la carte unique de three.js centrée sur
// Kobi (level.sun), comme avant.
// Chaque cascade est une carte de profondeur brute (sans comparaison matérielle), centrée devant la caméra et
// accrochée à la grille de ses texels. Elle est rendue par le moteur d'ombres de three.js lui-même (matériaux de
// profondeur propres à chaque objet : os, instances, faces arrière) depuis scene.onAfterRender, au premier rendu
// de la scène de chaque image. La cascade lointaine n'est recalculée que si la caméra s'en éloigne : le décor est fixe.
// Les matériaux lisent les cascades dans l'emplacement « sunShadow » : ombre douce dont la pénombre s'élargit
// avec la distance au bloqueur (PCSS simplifié, disques de Vogel tournés par un bruit fixe).
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { QUALITY, frameU } from './frame.js';
import { addSlot } from './shaderSlots.js';

// cascades : nombre, demi-côté de chacune (m), taille des cartes (texels), prises du filtre de pénombre
Object.assign(QUALITY.ultra, { cascades: 3, cascadeRadius: [22, 75, 260], cascadeSize: 2048, cascadeTaps: [16, 12, 8] });
Object.assign(QUALITY.haute, { cascades: 2, cascadeRadius: [26, 150], cascadeSize: 2048, cascadeTaps: [12, 8] });
Object.assign(QUALITY.moyenne, { cascades: 0 });

const MAX = 3;
export const csmU = {
  uCsmOn: { value: 0 },
  uCsmCount: { value: 0 },
  uCsmMat: { value: Array.from({ length: MAX }, () => new THREE.Matrix4()) },
  // x : mètres par texel, y : profondeur couverte (m), z : texel en uv, w : prises du filtre
  uCsmInfo: { value: Array.from({ length: MAX }, () => new THREE.Vector4(1, 1, 1, 8)) },
  // les cascades côte à côte dans une seule texture (les matériaux n'ont que 16 textures en tout)
  uCsmAtlas: { value: null },
  // tangente du rayon apparent du soleil (stylisé : bien plus large que le vrai) → largeur de la pénombre
  uSunSoft: { value: 0.03 },
};

// GLSL commun (matériaux, brouillard volumétrique, mer de nuages) : uniformes et lecture d'une cascade
export const CSM_PARS = /* glsl */ `
uniform float uCsmOn;
uniform int uCsmCount;
uniform mat4 uCsmMat[${MAX}];
uniform vec4 uCsmInfo[${MAX}];
uniform highp sampler2D uCsmAtlas;
uniform float uSunSoft;
float kobiCsmDepth(int i, vec2 uv) {
  return textureLod(uCsmAtlas, vec2((float(i) + uv.x) / ${MAX}.0, uv.y), 0.0).r;
}
// visibilité du soleil en un point (une seule lecture, pour le brouillard) : cascade la plus fine qui le contient
float kobiCsmVis(vec3 wp) {
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uCsmCount) break;
    vec3 c = (uCsmMat[i] * vec4(wp, 1.0)).xyz;
    if (all(greaterThan(c, vec3(0.002))) && all(lessThan(c, vec3(0.998)))) return step(c.z - uCsmInfo[i].x * 2.0 / uCsmInfo[i].y, kobiCsmDepth(i, c.xy));
  }
  return 1.0;
}`;

const CSM_FILTER = /* glsl */ `
vec2 kobiVogel(int i, int n, float phi) {
  float r = sqrt((float(i) + 0.5) / float(n));
  float a = float(i) * 2.399963 + phi;
  return vec2(cos(a), sin(a)) * r;
}
// c : uv + profondeur du receveur ; slope : pente du receveur vue du soleil (biais selon l'écart au centre)
float kobiCsmFilter(int ci, vec3 c, vec4 info, float slope, float phi) {
  float mt = info.x, range = info.y, tx = info.z;
  // recherche des bloqueurs jusqu'à ~10 m au-dessus du receveur
  float searchM = uSunSoft * 10.0 + mt * 2.0;
  float bSum = 0.0, bN = 0.0;
  for (int i = 0; i < 8; i++) {
    vec2 o = kobiVogel(i, 8, phi) * searchM;
    float zb = kobiCsmDepth(ci, c.xy + o * (tx / mt));
    if (zb < c.z - (length(o) * slope + mt) / range) { bSum += zb; bN += 1.0; }
  }
  if (bN < 0.5) return 1.0;
  // pénombre proportionnelle à la distance moyenne au bloqueur (au moins un texel et quart : bord lissé)
  float penM = clamp((c.z - bSum / bN) * range * uSunSoft, mt * 1.25, searchM);
  int n = int(info.w);
  float lit = 0.0;
  for (int i = 0; i < 16; i++) {
    if (i >= n) break;
    vec2 o = kobiVogel(i, n, phi + 1.7) * penM;
    float z = kobiCsmDepth(ci, c.xy + o * (tx / mt));
    lit += step(c.z - (length(o) * slope + mt * 0.5) / range, z);
  }
  return lit / float(n);
}
// ombre bon marché (herbe dense : des millions de petits fragments) : quatre lectures autour du point, cascade la
// plus fine qui le contient
float kobiCsmQuick(vec3 wp) {
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uCsmCount) break;
    vec4 info = uCsmInfo[i];
    vec3 c = (uCsmMat[i] * vec4(wp, 1.0)).xyz;
    float m = info.z * 3.0;
    if (all(greaterThan(c.xy, vec2(m))) && all(lessThan(c.xy, vec2(1.0 - m))) && c.z < 1.0) {
      float b = c.z - info.x * 2.0 / info.y;
      float t = info.z * 1.2;
      return (step(b, kobiCsmDepth(i, c.xy + vec2(t, t * 0.4))) + step(b, kobiCsmDepth(i, c.xy + vec2(-t * 0.4, t)))
        + step(b, kobiCsmDepth(i, c.xy - vec2(t, t * 0.4))) + step(b, kobiCsmDepth(i, c.xy + vec2(t * 0.4, -t)))) * 0.25;
    }
  }
  return 1.0;
}
float kobiCascades(vec3 wp, vec3 n) {
  float nl = dot(n, uSunDir);
  // face bien tournée à l'opposé du soleil : dans sa propre ombre, inutile de lire les cartes
  if (nl < -0.2) return 0.0;
  float slope = clamp(sqrt(max(1.0 - nl * nl, 0.0)) / max(abs(nl), 0.08), 0.0, 6.0);
  // bruit fixe (sans image d'accumulation, un bruit animé scintillerait)
  float phi = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uCsmCount) break;
    vec4 info = uCsmInfo[i];
    vec3 c = (uCsmMat[i] * vec4(wp + n * info.x * 1.5, 1.0)).xyz;
    vec2 e2 = min(c.xy, 1.0 - c.xy);
    float e = min(e2.x, e2.y);
    // marge : le noyau de recherche ne doit pas lire hors de la carte
    float m = info.z * (4.0 + (uSunSoft * 10.0) / info.x);
    if (e > m && c.z < 1.0) {
      float s = kobiCsmFilter(i, c, info, slope, phi);
      // fondu vers la cascade suivante (ou vers la lumière, au-delà de la dernière)
      float w = smoothstep(m, m + 0.07, e);
      if (w < 1.0) {
        float s2 = 1.0;
        if (i + 1 < uCsmCount) {
          vec4 info2 = uCsmInfo[i + 1];
          vec3 c2 = (uCsmMat[i + 1] * vec4(wp + n * info2.x * 1.5, 1.0)).xyz;
          s2 = kobiCsmFilter(i + 1, c2, info2, slope, phi);
        }
        s = mix(s2, s, w);
      }
      return s;
    }
  }
  return 1.0;
}`;

// Normale du receveur (monde) : normale interpolée, ou normale de la face pour les matériaux à facettes
addSlot('pars', 'csm', CSM_PARS + CSM_FILTER, csmU);
addSlot('sunShadow', 'csm', /* glsl */ `
if (uCsmOn > 0.5) {
  #if defined( KOBI_GRASS )
    sunShadow = kobiCsmQuick(kobiWorldPos());
  #elif defined( FLAT_SHADED )
    vec3 kN = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
  #else
    vec3 kN = normalize(vNormal);
    #ifdef DOUBLE_SIDED
      kN *= gl_FrontFacing ? 1.0 : -1.0;
    #endif
  #endif
  #ifndef KOBI_GRASS
  sunShadow = kobiCascades(kobiWorldPos(), normalize((vec4(kN, 0.0) * viewMatrix).xyz));
  #endif
}`, {}, 0);

const _c = new THREE.Color();
const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

class SunShadows {
  constructor(R) {
    this.R = R;
    this.level = null;
    this.casc = [];
    this.count = 0;
    this._Q = null;
    this._frame = -1;
    // caméra « couches » : seuls les objets du monde (couche 0) projettent une ombre, comme avec three.js
    this.layerCam = new THREE.PerspectiveCamera();
    this.layerCam.layers.set(0);
    this.atlas = null;
    this.atlasSize = 0;
    this.copyMat = new THREE.ShaderMaterial({
      uniforms: { tDepth: { value: null } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform highp sampler2D tDepth; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(tDepth, vUv).x); }',
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    });
    this.copyQuad = new FullScreenQuad(this.copyMat);
    const scene = R.scene;
    const prev = scene.onAfterRender;
    scene.onAfterRender = (renderer, sc, cam) => {
      prev.call(scene, renderer, sc, cam);
      this._render(renderer);
    };
    // qualité changée, ou carte de repli jetée (game.js la recrée à chaque changement de qualité)
    R.onFrame.push(() => {
      const sun = this.level && this.level.sun;
      if (R.Q !== this._Q || (this.count && sun && (!sun.shadow.map || sun.shadow.mapSize.x > 4))) this._apply();
    });
  }

  // le niveau fournit son soleil (DirectionalLight à ombre, carte de repli) et la direction du soleil
  attach(level) {
    this.level = level;
    for (const c of this.casc) c.dirty = true;
    this._Q = null;
    this._apply();
  }
  detach(level) {
    if (this.level !== level) return;
    this.level = null;
    csmU.uCsmOn.value = 0;
  }

  _apply() {
    const Q = this._Q = this.R.Q;
    const sun = this.level && this.level.sun;
    const n = sun ? Q.cascades || 0 : 0;
    // cascades inutiles libérées (mémoire), cascades manquantes créées
    while (this.casc.length > n) this._dispose(this.casc.pop());
    for (let i = 0; i < n; i++) {
      if (!this.casc[i] || this.casc[i].size !== Q.cascadeSize) {
        if (this.casc[i]) this._dispose(this.casc[i]);
        this.casc[i] = this._create(Q.cascadeSize);
      }
      const c = this.casc[i];
      c.radius = Q.cascadeRadius[i];
      c.taps = Q.cascadeTaps[i];
      c.dirty = true;
    }
    this.count = n;
    csmU.uCsmCount.value = n;
    csmU.uCsmOn.value = n > 0 ? 1 : 0;
    // atlas : une tuile par cascade (profondeur en flottant 32 bits)
    const size = n ? Q.cascadeSize : 0;
    if (!this.atlas || this.atlasSize !== size) {
      if (this.atlas) this.atlas.dispose();
      this.atlas = size ? new THREE.WebGLRenderTarget(size * MAX, size, {
        format: THREE.RedFormat, type: THREE.FloatType, depthBuffer: false,
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
      }) : null;
      this.atlasSize = size;
      for (const c of this.casc) c.dirty = true;
    }
    csmU.uCsmAtlas.value = this.atlas ? this.atlas.texture : null;
    if (sun) {
      // repli : la carte de three.js ne sert plus quand les cascades prennent le relais ; elle est réduite à
      // quelques texels, dessinée une fois (un échantillonneur d'ombre doit rester lié à une vraie carte)
      const sh = sun.shadow;
      sh.autoUpdate = n === 0;
      const s = n > 0 ? 4 : this.R.shadowSize;
      if (sh.mapSize.x !== s) {
        sh.mapSize.set(s, s);
        if (sh.map) { sh.map.dispose(); sh.map = null; }
      }
      if (n > 0 && !sh.map) sh.needsUpdate = true;
    }
  }

  _create(size) {
    const depth = new THREE.DepthTexture(size, size, THREE.FloatType);
    depth.minFilter = depth.magFilter = THREE.NearestFilter;
    const map = new THREE.WebGLRenderTarget(size, size, {
      format: THREE.RedFormat, type: THREE.UnsignedByteType, depthTexture: depth,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
    });
    const light = new THREE.DirectionalLight();
    light.castShadow = true;
    light.shadow.mapSize.set(size, size);
    light.shadow.map = map;
    return { light, map, depth, size, radius: 1, taps: 8, dirty: true, center: new THREE.Vector3(), time: 0 };
  }
  _dispose(c) {
    c.map.dispose();
    c.depth.dispose();
  }

  // Cadrage d'une cascade : carré de demi-côté r, centré devant la caméra, accroché aux texels (pas de scintillement)
  _fit(c, i, camPos, fwd, sunDir, lx, ly) {
    const r = c.radius;
    const target = _v.copy(camPos).addScaledVector(fwd, r * 0.55);
    const texel = (2 * r) / c.size;
    const x = target.dot(lx), y = target.dot(ly);
    target.addScaledVector(lx, Math.round(x / texel) * texel - x).addScaledVector(ly, Math.round(y / texel) * texel - y);
    // cascade lointaine quasi statique : recalculée quand la caméra s'en éloigne (ou de temps en temps)
    const last = i === this.count - 1 && i > 0;
    const now = performance.now();
    if (last && !c.dirty && c.center.distanceTo(target) < r * 0.08 && now - c.time < 1500) return false;
    c.dirty = false;
    c.time = now;
    c.center.copy(target);
    const D = r + 160;
    const cam = c.light.shadow.camera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
    cam.near = 1; cam.far = D + r + 80;
    cam.updateProjectionMatrix();
    c.light.position.copy(target).addScaledVector(sunDir, D);
    c.light.target.position.copy(target);
    c.light.updateMatrixWorld();
    c.light.target.updateMatrixWorld();
    c.light.shadow.needsUpdate = true;
    return true;
  }

  _render(renderer) {
    if (!this.count || !this.level || !this.level.sunDir) return;
    const fr = frameU.uFrame.value;
    if (fr === this._frame) return;
    this._frame = fr;
    const cam = this.R.camera;
    const sunDir = this.level.sunDir;
    const lx = _lx.crossVectors(UP, sunDir).normalize();
    const ly = _ly.crossVectors(sunDir, lx);
    cam.getWorldDirection(_f);
    _f.y = 0;
    if (_f.lengthSq() < 1e-6) _f.set(0, 0, 1);
    _f.normalize();
    const list = [];
    for (let i = 0; i < this.count; i++) {
      const c = this.casc[i];
      if (this._fit(c, i, cam.position, _f, sunDir, lx, ly)) list.push(c.light);
    }
    if (list.length) {
      const sm = renderer.shadowMap;
      const nu = sm.needsUpdate;
      renderer.getClearColor(_c);
      const ca = renderer.getClearAlpha();
      sm.needsUpdate = true;
      sm.render(list, this.R.scene, this.layerCam);
      sm.needsUpdate = nu;
      renderer.setClearColor(_c, ca);
      // recopie des cascades recalculées dans leur tuile de l'atlas
      if (this.atlas) {
        const prevRT = renderer.getRenderTarget();
        const ac = renderer.autoClear;
        renderer.autoClear = false;
        for (let i = 0; i < this.count; i++) {
          const c = this.casc[i];
          if (!list.includes(c.light)) continue;
          this.atlas.viewport.set(i * c.size, 0, c.size, c.size);
          renderer.setRenderTarget(this.atlas);
          this.copyMat.uniforms.tDepth.value = c.depth;
          this.copyQuad.render(renderer);
        }
        renderer.autoClear = ac;
        renderer.setRenderTarget(prevRT);
      }
    }
    // matrices et réglages lus par les shaders (une cascade non recalculée garde les siens)
    for (let i = 0; i < this.count; i++) {
      const c = this.casc[i];
      const cc = c.light.shadow.camera;
      csmU.uCsmMat.value[i].copy(c.light.shadow.matrix);
      csmU.uCsmInfo.value[i].set((2 * c.radius) / c.size, cc.far - cc.near, 1 / c.size, c.taps);
    }
  }
}
const _lx = new THREE.Vector3();
const _ly = new THREE.Vector3();

// Un seul gestionnaire par moteur de rendu
export function sunShadows(R) {
  if (!R.sunShadows) R.sunShadows = new SunShadows(R);
  return R.sunShadows;
}
