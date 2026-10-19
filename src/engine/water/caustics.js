// Caustiques : réseau de lumière projeté par la surface agitée sur tout ce qui est immergé (fonds, rochers,
// colonnes, Kobi). Injecté dans tous les matériaux éclairés (emplacement « directExtra ») : pour un fragment
// sous la surface d'un plan d'eau enregistré, le motif est lu à l'endroit où le rayon de soleil a traversé
// l'eau, deux fois avec des dérives différentes (min des deux : filaments qui se font et se défont),
// pondéré par l'ombre du soleil, l'angle d'incidence et l'absorption avec la profondeur.
import * as THREE from 'three';
import { frameU } from '../frame.js';
import { addSlot } from '../shaderSlots.js';
import { causticsTexture, waveTexture } from './textures.js';

export const MAX_VOLUMES = 8;

// volumes d'eau : (xmin, zmin, xmax, zmax) et (niveau, intensité, échelle, absorption)
Object.assign(frameU, {
  uWaterTime: { value: 0 },
  uWaterN: { value: 0 },
  uWaterVol: { value: Array.from({ length: MAX_VOLUMES }, () => new THREE.Vector4()) },
  uWaterVolB: { value: Array.from({ length: MAX_VOLUMES }, () => new THREE.Vector4()) },
  uWaterFlow: { value: Array.from({ length: MAX_VOLUMES }, () => new THREE.Vector2()) },
  tWaterCaustics: { value: null },
  tWaterWaves: { value: null },
});

export function initCaustics() {
  if (!frameU.tWaterCaustics.value) frameU.tWaterCaustics.value = causticsTexture();
  if (!frameU.tWaterWaves.value) frameU.tWaterWaves.value = waveTexture();
}

addSlot('pars', 'water-caustics', /* glsl */ `
uniform float uWaterTime;
uniform int uWaterN;
uniform vec4 uWaterVol[${MAX_VOLUMES}];
uniform vec4 uWaterVolB[${MAX_VOLUMES}];
uniform vec2 uWaterFlow[${MAX_VOLUMES}];
uniform sampler2D tWaterCaustics;
float kWaterSun = 1.0;
`, {
  uWaterTime: frameU.uWaterTime, uWaterN: frameU.uWaterN, uWaterVol: frameU.uWaterVol, uWaterVolB: frameU.uWaterVolB,
  uWaterFlow: frameU.uWaterFlow, tWaterCaustics: frameU.tWaterCaustics,
});

// mémorise l'ombre du soleil telle que les autres modules l'ont calculée (rang élevé : après eux)
addSlot('sunShadow', 'water-caustics', 'kWaterSun = sunShadow;', {}, 100);

addSlot('directExtra', 'water-caustics', /* glsl */ `
if (uWaterN > 0) {
  vec3 kcw = kobiWorldPos();
  for (int i = 0; i < ${MAX_VOLUMES}; i++) {
    if (i >= uWaterN) break;
    vec4 vb = uWaterVol[i];
    vec4 vc = uWaterVolB[i];
    float dpt = vc.x - kcw.y;
    if (dpt > 0.0 && kcw.x > vb.x && kcw.x < vb.z && kcw.z > vb.y && kcw.z < vb.w) {
      vec3 sl = normalize(uSunDir);
      // point de la surface traversé par le rayon (réfraction approchée : rayon redressé)
      vec2 sp = kcw.xz + sl.xz / max(sl.y, 0.3) * dpt * 0.75;
      vec2 fl = uWaterFlow[i] * uWaterTime;
      vec2 cu = (sp - fl * 0.6) * vc.z;
      // deux réseaux déformés par la houle qui défile : les filaments ondulent, se font et se défont
      vec2 w1 = 0.5 * vec2(sin(cu.y * 4.1 + uWaterTime * 0.9) + sin(cu.x * 2.3 - uWaterTime * 0.6), cos(cu.x * 3.7 - uWaterTime * 0.8) + cos(cu.y * 2.9 + uWaterTime * 0.5)) * 0.5;
      vec2 w2 = 0.5 * vec2(cos(cu.y * 3.3 - uWaterTime * 0.7) + sin(cu.x * 4.7 + uWaterTime * 0.4), sin(cu.x * 2.7 + uWaterTime * 0.6) + cos(cu.y * 3.9 - uWaterTime * 0.9)) * 0.5;
      float c1 = texture2D(tWaterCaustics, cu + w1 * 0.22).r;
      float c2 = texture2D(tWaterCaustics, cu * 1.37 + w2 * 0.25 + 0.31).r;
      float ca = max(c1, c2) * 1.2 + c1 * c2 * 1.5;
      // les bords de la flaque se fondent, l'eau profonde éteint le motif
      float edge = smoothstep(0.0, 1.5, min(min(kcw.x - vb.x, vb.z - kcw.x), min(kcw.z - vb.y, vb.w - kcw.z)));
      float fade = smoothstep(0.0, 0.25, dpt) * exp(-dpt * vc.w) * edge;
      float ndl = clamp(dot(geometryNormal, normalize((viewMatrix * vec4(sl, 0.0)).xyz)), 0.0, 1.0);
      // la lumière du soleil est redistribuée (filaments plus clairs, creux plus sombres), pas seulement ajoutée
      vec3 sun = material.diffuseContribution * uSunColor * (ndl * kWaterSun * fade * RECIPROCAL_PI);
      reflectedLight.directDiffuse += sun * ((ca - 0.32) * 1.7 * vc.y);
      break;
    }
  }
}`);
