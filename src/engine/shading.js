// Matériaux : anticrénelage spéculaire (tous les matériaux éclairés), translucidité du feuillage et de l'herbe à
// contre-jour, diffusion douce de la fourrure des personnages sculptés.
//   foliage(m, k) : marque un matériau de mat() comme feuillage (k : force de la translucidité) ; la marque survit
//   à la fusion du décor (le matériau fusionné est un clone repatché avec le même « extra »).
//   Matériaux à shader propre : '#define KOBI_FOLIAGE k' (et KOBI_GRASS pour les brins), '#define KOBI_SKIN k'.
import { addSlot, slotsTier } from './shaderSlots.js';
import { patchRim } from './materials.js';

// forces globales (réglage par planète, comparaisons)
const shadingU = { uTransK: { value: 1 }, uSkinK: { value: 1 }, uSpecAA: { value: 1 } };
if (import.meta.env.DEV && typeof window !== 'undefined') window.__shading = shadingU;

// visibilité du soleil au fragment (ombre finale, après les autres modules de l'emplacement sunShadow)
addSlot('pars', 'shading', /* glsl */ `
uniform float uTransK, uSkinK, uSpecAA;
float kobiSunVis = 1.0;`, shadingU);
addSlot('sunShadow', 'shading-vis', /* glsl */ `
kobiSunVis = sunShadow;`, {}, 100);

// Anticrénelage spéculaire : la variance des normales sous le pixel (courbure à l'écran, et relief des cartes de
// normales moyenné par les mipmaps — Toksvig) élargit le lobe spéculaire au lieu de scintiller
addSlot('roughness', 'specular-aa', /* glsl */ `
{
  float kAA = 0.0;
  #ifndef FLAT_SHADED
    vec3 kAAn = normalize( vNormal );
    vec3 kAAu = dFdx( kAAn ), kAAv = dFdy( kAAn );
    kAA = min( 0.5 * ( dot( kAAu, kAAu ) + dot( kAAv, kAAv ) ), 0.18 );
  #endif
  #ifdef USE_NORMALMAP
    float kAAl = length( texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0 );
    kAA += clamp( ( 1.0 - kAAl - 0.02 ) / max( kAAl, 0.1 ), 0.0, 0.35 );
  #endif
  float kAAa = roughnessFactor * roughnessFactor;
  roughnessFactor = sqrt( sqrt( min( kAAa * kAAa + kAA * uSpecAA, 1.0 ) ) );
}`);

// Lumière transmise et diffusion douce : seulement le soleil (les lumières locales restent opaques)
addSlot('directExtra', 'shading-sss', /* glsl */ `
#if defined( KOBI_FOLIAGE ) || defined( KOBI_SKIN )
{
  vec3 kL = normalize( ( viewMatrix * vec4( uSunDir, 0.0 ) ).xyz );
  float kNL = dot( geometryNormal, kL );
  #ifdef KOBI_FOLIAGE
    // à contre-jour, le soleil traverse les feuilles ; un peu de lumière diffuse passe aussi de dos
    float kFwd = pow( saturate( dot( geometryViewDir, - kL ) ), 4.0 );
    #ifdef KOBI_GRASS
      float kBack = 0.5;
    #else
      float kBack = saturate( 0.4 - 0.6 * kNL );
    #endif
    vec3 kTr = uSunColor * mix( 0.3, 1.0, kobiSunVis ) * kBack * ( 0.25 + 1.6 * kFwd );
    reflectedLight.directDiffuse += kTr * BRDF_Lambert( material.diffuseContribution ) * float( KOBI_FOLIAGE ) * uTransK;
  #endif
  #ifdef KOBI_SKIN
    // le soleil « enveloppe » le terminateur, teinté chaud (lumière diffusée sous la surface)
    float kW = saturate( ( kNL + 0.5 ) / 1.5 );
    float kAdd = max( kW * kW - saturate( kNL ), 0.0 );
    reflectedLight.directDiffuse += uSunColor * kobiSunVis * kAdd * vec3( 1.0, 0.62, 0.5 ) * BRDF_Lambert( material.diffuseContribution ) * float( KOBI_SKIN ) * uSkinK;
  #endif
}
#endif`);

export function foliage(m, k = 1) {
  const prev = m.userData.rimExtra;
  const def = `#define KOBI_FOLIAGE ${k.toFixed(2)}\n`;
  patchRim(m, m.userData.rimMul ? m.userData.rimMul.value : 1, (shader) => {
    if (prev) prev(shader);
    shader.fragmentShader = def + shader.fragmentShader;
  });
  const key = 'rim-foliage' + k;
  m.customProgramCacheKey = () => key + slotsTier();
  // groupe de fusion à part (les autres matériaux de même réglage restent opaques)
  m.userData.sig = key;
  return m;
}
