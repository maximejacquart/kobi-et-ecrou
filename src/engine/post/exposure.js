// Exposition automatique (adaptation de l'œil), entièrement sur le GPU, sans lecture côté processeur :
//  1. image réduite (128 × 64) : log de la luminance, pondéré vers le centre de l'image ;
//  2. moyenne par les niveaux de mipmap ;
//  3. adaptation lente vers la cible (plus rapide vers le clair que vers le sombre, comme l'œil), dans une texture
//     1 × 1 lue par le halo (seuil) et par le rendu des couleurs. La valeur est une correction en IL (EV).
// La luminance de référence d'une planète est, par défaut, celle mesurée aux premières images (au point de départ) :
// le rendu voulu par la planète est conservé, l'œil ne s'adapte qu'aux écarts (intérieur sombre, extérieur ébloui).
// L'adaptation est partielle et bornée : une planète de nuit reste nocturne, un intérieur sombre s'éclaircit un peu.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { material, GLSL } from './common.js';

// Réglages par défaut (L.environment({ autoExposure: { … } }) les remplace planète par planète) :
//  key : luminance moyenne de référence (absente : mesurée au départ) ; amount : part de l'écart corrigée
//  (0 = exposition fixe, 1 = adaptation complète) ; min / max : bornes de la correction (IL) ; comp : compensation
//  (IL) ; up / down : vitesses (1/s) quand l'exposition monte (on entre dans le sombre : lent) et quand elle descend
//  (ébloui : plus vif)
const EXPOSURE_DEFAULTS = { key: 0, amount: 0.6, min: -1.2, max: 0.8, comp: 0, up: 0.7, down: 1.4 };

const LUM_W = 128, LUM_H = 64, LUM_LOD = 7;
// images de mesure de la référence après un changement de planète
const CALIB_FRAMES = 6;

export class Exposure {
  constructor() {
    this.enabled = true;
    this.lum = new THREE.WebGLRenderTarget(LUM_W, LUM_H, {
      type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    });
    // 1 × 1 en flottants 32 bits : l'adaptation avance par pas minuscules à haute fréquence d'image
    const one = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.rts = [one(), one()];
    this.cur = 0;
    // texture lue par les autres passes : r = correction appliquée (IL), g = log2 de la luminance de référence,
    // b = log2 de la luminance moyenne mesurée
    this.texture = this.rts[0].texture;
    this.lumMat = material({ tSrc: { value: null }, uAspect: { value: 16 / 9 } }, /* glsl */ `
      ${GLSL}
      uniform sampler2D tSrc;
      uniform float uAspect;
      varying vec2 vUv;
      float lg(vec2 o) { return log2(clamp(luma(texture2D(tSrc, vUv + o).rgb), 1.0 / 1024.0, 64.0)); }
      void main() {
        // 4 échantillons filtrés par cellule
        vec2 o = vec2(0.25 / ${LUM_W}.0, 0.25 / ${LUM_H}.0);
        float s = (lg(-o) + lg(vec2(o.x, -o.y)) + lg(vec2(-o.x, o.y)) + lg(o)) * 0.25;
        // pondération centrale (le regard porte sur le centre de l'image, Kobi compris)
        vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
        float w = exp(-dot(p, p) * 3.5) + 0.12;
        gl_FragColor = vec4(s * w, w, 0.0, 1.0);
      }`);
    this.u = {
      tLum: { value: this.lum.texture }, tPrev: { value: null }, uDt: { value: 0 }, uReset: { value: 1 }, uAuto: { value: 1 },
      uCalib: { value: 0 }, uKeyLog: { value: -99 }, uAmount: { value: 0.5 }, uMin: { value: -1 }, uMax: { value: 1 },
      uComp: { value: 0 }, uUp: { value: 1 }, uDown: { value: 1 },
    };
    this.adaptMat = material(this.u, /* glsl */ `
      uniform sampler2D tLum, tPrev;
      uniform float uDt, uReset, uAuto, uCalib, uKeyLog, uAmount, uMin, uMax, uComp, uUp, uDown;
      varying vec2 vUv;
      void main() {
        vec4 m = textureLod(tLum, vec2(0.5), ${LUM_LOD}.0);
        float avg = m.x / max(m.y, 1e-5);
        vec4 prev = texture2D(tPrev, vec2(0.5));
        // référence : imposée par la planète, ou moyenne des premières images
        float key = uKeyLog > -50.0 ? uKeyLog : uCalib > 0.5 ? (uReset > 0.5 ? avg : mix(prev.g, avg, 0.3)) : prev.g;
        float target = uComp + (uAuto > 0.5 && uCalib < 0.5 ? clamp((key - avg) * uAmount, uMin, uMax) : 0.0);
        // cible plus claire que l'état actuel (on entre dans le sombre) : adaptation lente ; l'inverse est plus vif
        float speed = target > prev.r ? uUp : uDown;
        float ev = uReset > 0.5 ? target : mix(prev.r, target, 1.0 - exp(-uDt * speed));
        gl_FragColor = vec4(ev, key, avg, 1.0);
      }`);
    this.fsq = new FullScreenQuad(this.lumMat);
    this.configure();
  }
  // Réglages de la planète (EXPOSURE_DEFAULTS complétés par o) ; la référence est remesurée si elle n'est pas imposée
  configure(o = {}) {
    const c = { ...EXPOSURE_DEFAULTS, ...o };
    const u = this.u;
    u.uKeyLog.value = c.key > 0 ? Math.log2(c.key) : -99;
    u.uAmount.value = c.amount; u.uMin.value = c.min; u.uMax.value = c.max;
    u.uComp.value = c.comp; u.uUp.value = c.up; u.uDown.value = c.down;
    this._calib = c.key > 0 ? 0 : CALIB_FRAMES;
    this.reset();
  }
  // saute directement à la valeur cible à la prochaine image (changement de niveau, téléportation)
  reset() { this.u.uReset.value = 1; }
  setSize(w, h) { this.lumMat.uniforms.uAspect.value = w / Math.max(1, h); }
  update(renderer, src, dt) {
    const auto = this.enabled;
    if (auto) {
      this.lumMat.uniforms.tSrc.value = src;
      renderer.setRenderTarget(this.lum);
      this.fsq.material = this.lumMat;
      this.fsq.render(renderer);
    }
    const prev = this.rts[this.cur];
    this.cur ^= 1;
    const next = this.rts[this.cur];
    const u = this.u;
    u.tPrev.value = prev.texture;
    u.uDt.value = dt;
    u.uAuto.value = auto ? 1 : 0;
    // la mesure de la référence attend que l'exposition automatique soit active
    u.uCalib.value = auto && this._calib > 0 ? 1 : 0;
    renderer.setRenderTarget(next);
    this.fsq.material = this.adaptMat;
    this.fsq.render(renderer);
    if (auto && this._calib > 0) this._calib--;
    // la remise à zéro attend aussi la première vraie mesure
    if (auto || this._calib === 0) u.uReset.value = 0;
    this.texture = next.texture;
  }
  // lecture de contrôle (synchrone, pour les tests) : [correction, log2 référence, log2 luminance moyenne]
  read(renderer) {
    const b = new Float32Array(4);
    renderer.readRenderTargetPixels(this.rts[this.cur], 0, 0, 1, 1, b);
    return [b[0], b[1], b[2]];
  }
  dispose() {
    this.lum.dispose();
    for (const r of this.rts) r.dispose();
    this.lumMat.dispose();
    this.adaptMat.dispose();
    this.fsq.dispose();
  }
}
