// Rendu des couleurs : ajoute à l'image HDR le halo, la salissure d'objectif et les traînées, applique l'exposition
// (réglage de la planète × adaptation automatique), la courbe de rendu puis le codage sRGB.
// Courbes : 'kobi' (maison, par défaut), 'neutral' (Khronos), 'agx', 'aces' — ?tm=neutral|agx|aces pour comparer
// (développement).
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { material, GLSL } from './common.js';
import { lensDirtTexture } from './dirt.js';

const TONES = ['kobi', 'neutral', 'agx', 'aces'];

const FRAG = /* glsl */ `
#include <tonemapping_pars_fragment>
${GLSL}
uniform sampler2D tDiffuse, tBloom, tWide, tDirt, tStreak, tExp;
uniform float uBloom, uDirt, uStreak, uExposure;
varying vec2 vUv;

// Courbe maison : pied doux (noirs denses, couleurs franches dans les ombres), tons moyens et saturation intacts,
// épaule longue sur la composante maximale (la teinte ne vire pas, contrairement à ACES), puis passage progressif
// au blanc des valeurs très comprimées, comme une pellicule : néons et lave gardent un cœur blanc et un bord coloré.
vec3 KobiToneMapping(vec3 c) {
  float x = min(c.r, min(c.g, c.b));
  float toe = x < 0.1 ? x - 5.0 * x * x : 0.05;
  c -= toe;
  float peak = max3(c);
  const float S = 0.7;
  if (peak <= S) return c;
  const float D = 1.0 - S;
  float np = 1.0 - D * D / (peak + D - S);
  c *= np / peak;
  float g = 1.0 - 1.0 / (0.32 * (peak - np) + 1.0);
  return mix(c, vec3(np), g);
}

void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  c += texture2D(tBloom, vUv).rgb * uBloom;
  float ex = uExposure * exp2(texture2D(tExp, vec2(0.5)).x);
  #ifdef DIRT
  // salissure : révélée par la lumière diffuse qui l'atteint (niveau large du halo), seulement là où elle est forte :
  // le léger halo d'un ciel clair ne doit pas la faire apparaître sur tout l'écran
  vec3 wide = texture2D(tWide, vUv).rgb;
  c += texture2D(tDirt, vUv).rgb * wide * smoothstep(0.4, 1.3, luma(wide) * ex) * uDirt;
  #endif
  #ifdef STREAK
  // traînées anamorphiques, légèrement bleutées
  vec3 s = texture2D(tStreak, vUv).rgb;
  c += mix(s, luma(s) * vec3(0.55, 0.78, 1.25), 0.45) * uStreak;
  #endif
  c *= ex;
  #ifdef DEBUG_BLOOM
  c = texture2D(tBloom, vUv).rgb * uBloom * ex;
  #endif
  #ifdef DEBUG_WIDE
  c = texture2D(tWide, vUv).rgb;
  #endif
  #if defined(DEBUG_STREAK) && defined(STREAK)
  c = texture2D(tStreak, vUv).rgb * 10.0;
  #endif
  #ifdef DEBUG_DIRT
  c = texture2D(tDirt, vUv).rgb * 4.0;
  #endif
  #if defined(TONE_AGX)
  c = AgXToneMapping(c);
  #elif defined(TONE_ACES)
  c = ACESFilmicToneMapping(c);
  #elif defined(TONE_NEUTRAL)
  c = NeutralToneMapping(c);
  #else
  c = KobiToneMapping(c);
  #endif
  gl_FragColor = sRGBTransferOETF(vec4(clamp(c, 0.0, 1.0), 1.0));
}`;

export class LensOutputPass extends Pass {
  constructor(R, bloom, exposure, tone = 'kobi') {
    super();
    this.R = R;
    this.name = 'output';
    this.bloom = bloom;
    this.exposure = exposure;
    // salissure et traînées (multiplicateurs ; 0 = absentes)
    this.dirt = 2.5;
    this.streak = 0.3;
    // échelle du halo : o.bloom (≈ 0.3 à 0.85)
    this.bloomScale = 5;
    // vue de contrôle : 'bloom', 'wide', 'streak', 'dirt' (null = image normale)
    this.debug = null;
    this.u = {
      tDiffuse: { value: null }, tBloom: { value: null }, tWide: { value: null }, tDirt: { value: lensDirtTexture() },
      tStreak: { value: null }, tExp: { value: null }, uBloom: { value: 0 }, uDirt: { value: 0 }, uStreak: { value: 0 },
      uExposure: { value: 1 }, toneMappingExposure: { value: 1 },
    };
    this.mat = material(this.u, FRAG);
    this.fsq = new FullScreenQuad(this.mat);
    this.setTone(tone);
  }
  setTone(t) {
    this.tone = TONES.includes(t) ? t : 'kobi';
    this._defs = null;
  }
  render(renderer, writeBuffer, readBuffer) {
    const Q = this.R.Q, b = this.bloom, u = this.u;
    const streak = !!(Q.bloomStreaks && b.streakTexture && this.streak > 0);
    const dirt = !!(Q.lensDirt && this.dirt > 0);
    const key = `${this.tone}|${dirt}|${streak}|${this.debug}`;
    if (key !== this._defs) {
      this._defs = key;
      const d = {};
      if (this.tone !== 'kobi') d['TONE_' + this.tone.toUpperCase()] = '';
      if (dirt) d.DIRT = '';
      if (streak) d.STREAK = '';
      if (this.debug) d['DEBUG_' + this.debug.toUpperCase()] = '';
      this.mat.defines = d;
      this.mat.needsUpdate = true;
    }
    u.tDiffuse.value = readBuffer.texture;
    u.tBloom.value = b.texture;
    u.tWide.value = b.wide;
    u.tStreak.value = b.streakTexture;
    u.tExp.value = this.exposure.texture;
    u.uBloom.value = b.strength * this.bloomScale;
    u.uDirt.value = this.dirt * (0.5 + b.strength);
    u.uStreak.value = this.streak;
    u.uExposure.value = renderer.toneMappingExposure;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsq.render(renderer);
  }
  dispose() {
    this.u.tDirt.value.dispose();
    this.mat.dispose();
    this.fsq.dispose();
  }
}
