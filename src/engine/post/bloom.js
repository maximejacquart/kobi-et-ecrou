// Halo lumineux à chaîne de mipmaps, à énergie conservée (méthode « Call of Duty: Advanced Warfare ») :
//  - réduction en 13 points ; le premier niveau prend la moyenne de Karis (pas de lucioles qui scintillent) puis un
//    seuil doux, évalué après exposition : le halo suit l'adaptation de l'œil ;
//  - remontée en tente 3 × 3, chaque niveau mêlé au suivant (somme des poids = 1 : rayon large et doux) ;
//  - traînées anamorphiques (Ultra, Haute) : chaîne horizontale sur les seules sources très intenses.
// La passe ne modifie pas l'image : le rendu des couleurs (output.js) ajoute halo, salissure d'objectif et traînées.
// Elle mesure aussi l'exposition automatique (exposure.js), sur l'image HDR finale avant halo.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { hdrTarget, material, GLSL } from './common.js';

const TAP = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
vec3 tap(float x, float y) { return max(texture2D(tSrc, vUv + vec2(x, y) * uTexel).rgb, 0.0); }
`;

// 13 points : 4 carrés de 4 qui se chevauchent autour d'un carré central (filtre sans crénelage)
const DOWN13 = /* glsl */ `
  vec3 a = tap(-2.0, 2.0), b = tap(0.0, 2.0), c = tap(2.0, 2.0);
  vec3 d = tap(-2.0, 0.0), e = tap(0.0, 0.0), f = tap(2.0, 0.0);
  vec3 g = tap(-2.0, -2.0), h = tap(0.0, -2.0), i = tap(2.0, -2.0);
  vec3 j = tap(-1.0, 1.0), k = tap(1.0, 1.0), l = tap(-1.0, -1.0), m = tap(1.0, -1.0);
`;

export class BloomPass extends Pass {
  constructor(R, exposure) {
    super();
    this.R = R;
    this.name = 'bloom';
    this.needsSwap = false;
    this.exposure = exposure;
    // réglage par planète (o.bloom)
    this.strength = 0.55;
    this.threshold = 0.85;
    this.knee = 0.3;
    // part de chaque niveau plus large dans le précédent : plus haut = halo plus étendu. Les premiers niveaux
    // (presque nets) en gardent peu : l'énergie va surtout aux rayons moyens (le halo autour des lampes), avec une
    // longue traîne douce
    this.scatter = 0.6;
    this.scatterFine = [0.82, 0.78, 0.68];
    this.streakThreshold = 1.8;
    this.mips = [];
    this.ups = [];
    this.streaks = [];
    this.streakUps = [];
    this.w = 1;
    this.h = 1;
    this._q = null;

    this.preMat = material({ tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, tExp: { value: null }, uExposure: { value: 1 }, uThreshold: { value: 1 }, uKnee: { value: 0.5 } }, /* glsl */ `
      ${GLSL}
      ${TAP}
      uniform sampler2D tExp;
      uniform float uExposure, uThreshold, uKnee;
      void main() {
        ${DOWN13}
        // moyenne de Karis par carré, adoucie : un reflet isolé extrême ne scintille pas, une lampe garde son énergie
        vec3 g0 = (j + k + l + m) * 0.25, g1 = (a + b + d + e) * 0.25, g2 = (b + c + e + f) * 0.25;
        vec3 g3 = (d + e + g + h) * 0.25, g4 = (e + f + h + i) * 0.25;
        float w0 = 0.5 / (1.0 + luma(g0) * 0.25), w1 = 0.125 / (1.0 + luma(g1) * 0.25), w2 = 0.125 / (1.0 + luma(g2) * 0.25);
        float w3 = 0.125 / (1.0 + luma(g3) * 0.25), w4 = 0.125 / (1.0 + luma(g4) * 0.25);
        vec3 col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
        col = min(col, vec3(6e4));
        // seuil doux sur la luminance exposée : un sable orangé bien éclairé ne bave pas, une lampe ou un néon
        // rayonnent de toute leur énergie
        float br = luma(col) * uExposure * exp2(texture2D(tExp, vec2(0.5)).x);
        float kb = smoothstep(uThreshold - uKnee, uThreshold + uKnee, br);
        // sources très intenses adoucies (Reinhard sur la luminance exposée) : un œil lumineux ou une explosion tout
        // près de la caméra ne noie plus l'écran sous un halo coloré ; une lampe ordinaire (br de 1 à 3) n'y perd presque rien
        gl_FragColor = vec4(col * kb / (1.0 + br * kb / 6.0), 1.0);
      }`);
    this.downMat = material({ tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } }, /* glsl */ `
      ${TAP}
      void main() {
        ${DOWN13}
        gl_FragColor = vec4(e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125, 1.0);
      }`);
    this.upMat = material({ tSrc: { value: null }, tCur: { value: null }, uTexel: { value: new THREE.Vector2() }, uScatter: { value: 0.7 } }, /* glsl */ `
      ${TAP}
      uniform sampler2D tCur;
      uniform float uScatter;
      void main() {
        // tente 3 × 3 sur le niveau inférieur, au pas du niveau courant
        vec3 s = tap(0.0, 0.0) * 4.0;
        s += (tap(-1.0, 0.0) + tap(1.0, 0.0) + tap(0.0, -1.0) + tap(0.0, 1.0)) * 2.0;
        s += tap(-1.0, -1.0) + tap(1.0, -1.0) + tap(-1.0, 1.0) + tap(1.0, 1.0);
        gl_FragColor = vec4(mix(texture2D(tCur, vUv).rgb, s / 16.0, uScatter), 1.0);
      }`);
    // traînées : réduction horizontale (1 3 3 1), le premier niveau ne garde que les sources très intenses
    this.streakDownMat = material({ tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, tExp: { value: null }, uExposure: { value: 1 }, uThreshold: { value: 0 } }, /* glsl */ `
      ${GLSL}
      ${TAP}
      uniform sampler2D tExp;
      uniform float uExposure, uThreshold;
      void main() {
        vec3 c = (tap(-1.5, 0.0) + tap(1.5, 0.0) + (tap(-0.5, 0.0) + tap(0.5, 0.0)) * 3.0) / 8.0;
        if (uThreshold > 0.0) {
          float br = luma(c) * uExposure * exp2(texture2D(tExp, vec2(0.5)).x);
          c *= max(br - uThreshold, 0.0) / max(br, 1e-5);
        }
        gl_FragColor = vec4(c, 1.0);
      }`);
    this.streakUpMat = material({ tSrc: { value: null }, tCur: { value: null }, uTexel: { value: new THREE.Vector2() }, uScatter: { value: 0.9 } }, /* glsl */ `
      ${TAP}
      uniform sampler2D tCur;
      uniform float uScatter;
      void main() {
        vec3 s = (tap(-1.0, 0.0) + tap(0.0, 0.0) * 2.0 + tap(1.0, 0.0)) * 0.25;
        gl_FragColor = vec4(mix(texture2D(tCur, vUv).rgb, s, uScatter), 1.0);
      }`);
    this.fsq = new FullScreenQuad(null);
  }

  get texture() { return (this.ups[0] || this.mips[0]).texture; }
  // niveau très large : module la salissure d'objectif selon la lumière qui atteint l'objectif
  get wide() { const i = Math.max(0, this.mips.length - 3); return (this.ups[i] || this.mips[i]).texture; }
  get streakTexture() { return this.streakUps[0] ? this.streakUps[0].texture : this.streaks[0] ? this.streaks[0].texture : null; }

  setSize(w, h) {
    this.w = w;
    this.h = h;
    this._q = null;
  }
  _alloc() {
    const Q = this.R.Q;
    this._q = Q;
    for (const rt of [...this.mips, ...this.ups, ...this.streaks, ...this.streakUps]) rt.dispose();
    this.mips = []; this.ups = []; this.streaks = []; this.streakUps = [];
    const { w, h } = this;
    // le plus petit niveau garde au moins ~6 pixels de haut
    const n = Math.max(1, Math.min(Q.bloomLevels ?? 8, Math.floor(Math.log2(Math.min(w, h) / 6))));
    for (let i = 0; i < n; i++) {
      const mw = Math.max(1, Math.floor(w / 2 ** (i + 1))), mh = Math.max(1, Math.floor(h / 2 ** (i + 1)));
      const m = hdrTarget(); m.setSize(mw, mh); this.mips.push(m);
      if (i < n - 1) { const u = hdrTarget(); u.setSize(mw, mh); this.ups.push(u); }
    }
    if (Q.bloomStreaks && this.mips.length) {
      // demi-hauteur, largeurs divisées par deux jusqu'à ~16 pixels
      const sh = this.mips[0].height;
      for (let sw = Math.floor(w / 4); sw >= 16; sw = Math.floor(sw / 2)) {
        const s = hdrTarget(); s.setSize(sw, sh); this.streaks.push(s);
      }
      for (let i = 0; i < this.streaks.length - 1; i++) {
        const u = hdrTarget(); u.setSize(this.streaks[i].width, sh); this.streakUps.push(u);
      }
    }
  }
  _draw(renderer, mat, target) {
    this.fsq.material = mat;
    renderer.setRenderTarget(target);
    this.fsq.render(renderer);
  }
  render(renderer, writeBuffer, readBuffer, dt) {
    if (this._q !== this.R.Q) this._alloc();
    const ex = this.exposure;
    ex.enabled = this.R.Q.autoExposure !== false;
    ex.update(renderer, readBuffer.texture, dt);
    const base = renderer.toneMappingExposure;
    // 1. premier niveau : 13 points + Karis + seuil
    const pu = this.preMat.uniforms;
    pu.tSrc.value = readBuffer.texture;
    pu.uTexel.value.set(1 / readBuffer.width, 1 / readBuffer.height);
    pu.tExp.value = ex.texture;
    pu.uExposure.value = base;
    pu.uThreshold.value = this.threshold;
    pu.uKnee.value = this.knee;
    this._draw(renderer, this.preMat, this.mips[0]);
    // 2. réduction
    const du = this.downMat.uniforms;
    for (let i = 1; i < this.mips.length; i++) {
      const src = this.mips[i - 1];
      du.tSrc.value = src.texture;
      du.uTexel.value.set(1 / src.width, 1 / src.height);
      this._draw(renderer, this.downMat, this.mips[i]);
    }
    // 3. remontée : ups[i] = mix(mips[i], tente(niveau i + 1), scatter)
    const uu = this.upMat.uniforms;
    for (let i = this.ups.length - 1; i >= 0; i--) {
      uu.uScatter.value = this.scatterFine[i] ?? this.scatter;
      const low = i + 1 < this.ups.length ? this.ups[i + 1] : this.mips[i + 1];
      const dst = this.ups[i];
      uu.tSrc.value = low.texture;
      uu.tCur.value = this.mips[i].texture;
      uu.uTexel.value.set(1 / dst.width, 1 / dst.height);
      this._draw(renderer, this.upMat, dst);
    }
    // 4. traînées anamorphiques
    if (this.streaks.length) {
      const su = this.streakDownMat.uniforms;
      su.tExp.value = ex.texture;
      su.uExposure.value = base;
      let src = this.mips[0];
      for (let i = 0; i < this.streaks.length; i++) {
        su.tSrc.value = src.texture;
        su.uTexel.value.set(1 / src.width, 1 / src.height);
        su.uThreshold.value = i === 0 ? this.streakThreshold : 0;
        this._draw(renderer, this.streakDownMat, this.streaks[i]);
        src = this.streaks[i];
      }
      const uu2 = this.streakUpMat.uniforms;
      for (let i = this.streakUps.length - 1; i >= 0; i--) {
        const low = i + 1 < this.streakUps.length ? this.streakUps[i + 1] : this.streaks[i + 1];
        const dst = this.streakUps[i];
        uu2.tSrc.value = low.texture;
        uu2.tCur.value = this.streaks[i].texture;
        uu2.uTexel.value.set(1 / dst.width, 1 / dst.height);
        this._draw(renderer, this.streakUpMat, dst);
      }
    }
  }
  dispose() {
    for (const rt of [...this.mips, ...this.ups, ...this.streaks, ...this.streakUps]) rt.dispose();
    for (const m of [this.preMat, this.downMat, this.upMat, this.streakDownMat, this.streakUpMat]) m.dispose();
    this.fsq.dispose();
  }
}
