// Étalonnage final (après le rendu des couleurs, en valeurs d'affichage) : aberration chromatique des bords et des
// chocs, reflet de soleil, teinte, saturation, virage des ombres et des hautes lumières par planète, contraste,
// vignettage optique, voile de dégâts, flash, grain de film, fondu.
import * as THREE from 'three';
import { VERT } from './common.js';

export const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.32 },
    uDamage: { value: 0 },
    uAberration: { value: 0 },
    // aberration latérale permanente : nulle au centre, à peine un pixel dans les coins
    uEdgeCA: { value: 0.0009 },
    uSaturation: { value: 1.12 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(1, 1, 1) },
    uFade: { value: 0 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    uSunUV: { value: new THREE.Vector2(0.5, 0.5) },
    uSunVis: { value: 0 },
    uSunCol: { value: new THREE.Color(1, 0.9, 0.7) },
    uLift: { value: new THREE.Vector3(0, 0, 0) },
    // étalonnage par planète : teinte des ombres et des hautes lumières (décalage de chrominance), contraste
    uShadowTint: { value: new THREE.Vector3(0, 0, 0) },
    uHighTint: { value: new THREE.Vector3(0, 0, 0) },
    uContrast: { value: 0.18 },
    uGrain: { value: 0.016 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uDamage, uAberration, uEdgeCA, uSaturation, uFlash, uFade, uGrain;
    uniform vec3 uFlashColor;
    uniform vec3 uTint;
    uniform vec2 uSunUV;
    uniform float uSunVis;
    uniform vec3 uSunCol;
    uniform vec3 uLift;
    uniform vec3 uShadowTint, uHighTint;
    uniform float uContrast;
    uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      float asp = uRes.x / uRes.y;
      // aberration chromatique latérale : croît vers les bords (∝ r³) ; les chocs l'amplifient jusqu'au centre
      vec2 off = c * (uEdgeCA * r2 * 4.0 + (uAberration * 0.012 + uDamage * 0.006) * (0.25 + r2 * 3.0));
      vec3 col;
      if (dot(off, off) * uRes.y * uRes.y > 0.04) {
        col.r = texture2D(tDiffuse, uv + off).r;
        col.g = texture2D(tDiffuse, uv).g;
        col.b = texture2D(tDiffuse, uv - off).b;
      } else {
        col = texture2D(tDiffuse, uv).rgb;
      }
      col = col * uTint + uLift * (1.0 - col);
      if (uSunVis > 0.001) {
        vec2 sd = (uv - uSunUV) * vec2(asp, 1.0);
        float dist = length(sd);
        float glare = exp(-dist * 5.0) * 0.28 + exp(-dist * 22.0) * 0.35;
        float streak = exp(-abs(sd.y) * 140.0) * exp(-abs(sd.x) * 2.2) * 0.3;
        vec2 axis = vec2(0.5) - uSunUV;
        float gh = 0.0;
        for (int i = 1; i < 4; i++) {
          vec2 gp = uSunUV + axis * (float(i) * 0.6);
          float gd = length((uv - gp) * vec2(asp, 1.0));
          gh += smoothstep(0.05 + 0.035 * float(i), 0.0, gd) * (0.07 - 0.015 * float(i));
        }
        col += uSunCol * (glare + streak + gh) * uSunVis;
      }
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, uSaturation);
      // virage partiel : les ombres et les hautes lumières prennent la couleur de la planète, sans changer la luminosité
      float sh = 1.0 - smoothstep(0.02, 0.42, l);
      float hi = smoothstep(0.38, 0.95, l);
      col += uShadowTint * sh + uHighTint * hi;
      col = max(col, 0.0);
      // contraste en S
      col = mix(col, col * col * (3.0 - 2.0 * col), uContrast);
      // vignettage optique (loi en cos⁴ d'un objectif, rayon normalisé sur la diagonale), un peu renforcé aux coins
      vec2 q = c * vec2(asp, 1.0);
      float rn = dot(q, q) / (0.25 * (asp * asp + 1.0));
      float k = uVignette * 0.55;
      float vig = 1.0 / ((1.0 + rn * k) * (1.0 + rn * k));
      vig *= 1.0 - uVignette * smoothstep(0.6, 1.0, rn);
      col *= vig;
      // voile de dégâts
      float edge = smoothstep(0.08, 0.5, r2);
      col = mix(col, vec3(0.9, 0.05, 0.08), uDamage * edge * 0.75);
      col = mix(col, uFlashColor, uFlash);
      // grain de film : fin (au pixel), distribution triangulaire (efface aussi les bandes), discret dans les
      // hautes lumières et les noirs profonds
      vec2 gp = uv * uRes + fract(uTime * vec2(17.31, 41.77)) * 512.0;
      float n = hash(gp) + hash(gp + 37.17) - 1.0;
      float lg = clamp(dot(col, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
      col += n * uGrain * (0.45 + 2.2 * lg * (1.0 - lg));
      col = mix(col, vec3(0.0), uFade);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
