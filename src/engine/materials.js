// Matériaux : PBR stylisé avec liseré de lumière (rim), flash d'impact, et matériau de terrain triplanaire.
import * as THREE from 'three';
import { injectSlots, slotsTier } from './shaderSlots.js';

export const globalU = {
  uRimColor: { value: new THREE.Color('#ffd9a8') },
  uRimStrength: { value: 0.55 },
  uTime: { value: 0 },
  uEnemyRim: { value: new THREE.Color('#6ff0ff') },
  // lumière d'appoint des personnages (couleur × intensité), venue du côté de la caméra ; réglée par le niveau
  uCharLight: { value: new THREE.Color(0, 0, 0) },
  // brume de hauteur et diffusion solaire dans le brouillard (réglées par chaque planète)
  uFogBase: { value: 0 },
  uFogFall: { value: 0.08 },
  uFogHeight: { value: 0 },
  uFogSunDir: { value: new THREE.Vector3(0.5, 0.6, 0.3).normalize() },
  uFogSunCol: { value: new THREE.Color('#fff1c8') },
  uFogSun: { value: 0 },
};

// Brouillard : distance (comme Three.js) + brume plus dense en contrebas + teinte du soleil quand on regarde vers lui.
// La position monde est reconstruite depuis la position vue (valable pour tous les shaders, particules comprises) ;
// la partie « hauteur / soleil » n'est active que dans les matériaux du jeu (HEIGHT_FOG).
THREE.ShaderChunk.fog_pars_vertex = `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif`;
THREE.ShaderChunk.fog_vertex = `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorld = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;
#endif`;
THREE.ShaderChunk.fog_pars_fragment = `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  #ifdef HEIGHT_FOG
    uniform float uFogBase, uFogFall, uFogHeight, uFogSun;
    uniform vec3 uFogSunDir, uFogSunCol;
  #endif
#endif`;
THREE.ShaderChunk.fog_fragment = `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  vec3 fogCol = fogColor;
  #ifdef HEIGHT_FOG
    vec3 fogRay = vFogWorld - cameraPosition;
    float fogDist = length(fogRay);
    float hgt = clamp(exp(-(vFogWorld.y - uFogBase) * uFogFall), 0.0, 1.0);
    fogFactor = max(fogFactor, hgt * uFogHeight * (1.0 - exp(-fogDist * 0.018)));
    float sunAmt = pow(max(dot(fogRay / max(fogDist, 0.001), uFogSunDir), 0.0), 6.0);
    fogCol = mix(fogColor, uFogSunCol, sunAmt * uFogSun);
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, clamp(fogFactor, 0.0, 1.0) );
#endif`;
function addFogUniforms(shader) {
  shader.uniforms.uFogBase = globalU.uFogBase;
  shader.uniforms.uFogFall = globalU.uFogFall;
  shader.uniforms.uFogHeight = globalU.uFogHeight;
  shader.uniforms.uFogSunDir = globalU.uFogSunDir;
  shader.uniforms.uFogSunCol = globalU.uFogSunCol;
  shader.uniforms.uFogSun = globalU.uFogSun;
  shader.fragmentShader = '#define HEIGHT_FOG\n' + shader.fragmentShader;
}

const RIM_PARS = /* glsl */ `
uniform vec3 uRimColor;
uniform float uRimStrength;
uniform float uRimMul;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform vec3 uCharLight;
`;
const RIM_CODE = /* glsl */ `
{
  vec3 vdir = normalize(vViewPosition);
  float fres = pow(1.0 - clamp(dot(normal, vdir), 0.0, 1.0), 3.0);
  gl_FragColor.rgb += uRimColor * fres * uRimStrength * uRimMul;
  #ifdef CHAR_LIGHT
  // personnages : diffus venu de la caméra (un peu au-dessus), pour qu'ils restent lisibles à contre-jour
  gl_FragColor.rgb += material.diffuseColor * uCharLight * (0.25 + 0.75 * max(dot(normal, vec3(0.0, 0.45, 0.89)), 0.0));
  #endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uFlashColor * 1.35, uFlash);
}
#include <fog_fragment>
`;

// extra(shader) : retouches supplémentaires du shader (matériaux spécialisés)
export function patchRim(mat, rimMul = 1, extra = null) {
  mat.userData.flash = { value: 0 };
  mat.userData.flashColor = { value: new THREE.Color(1, 1, 1) };
  mat.userData.rimMul = { value: rimMul };
  mat.userData.rimExtra = extra;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = mat.userData.rimColorU || (mat.userData.enemyRim ? globalU.uEnemyRim : globalU.uRimColor);
    shader.uniforms.uRimStrength = globalU.uRimStrength;
    shader.uniforms.uRimMul = mat.userData.rimMul;
    shader.uniforms.uFlash = mat.userData.flash;
    shader.uniforms.uFlashColor = mat.userData.flashColor;
    shader.uniforms.uCharLight = globalU.uCharLight;
    shader.fragmentShader = RIM_PARS + shader.fragmentShader.replace('#include <fog_fragment>', RIM_CODE);
    addFogUniforms(shader);
    injectSlots(shader);
    if (extra) extra(shader);
  };
  mat.customProgramCacheKey = () => 'rim' + slotsTier();
  return mat;
}

const matCache = new Map();

// Matériau standard stylisé. opts : rough, metal, emissive, emissiveIntensity, map, normalMap, rim, flat, transparent, opacity,
// sheen (satiné), coat / coatRough (vernis : peinture laquée de jouet)
export function mat(color, opts = {}) {
  const key = opts.unique ? null : JSON.stringify([color, opts.rough, opts.metal, opts.emissive, opts.emissiveIntensity, opts.rim, opts.flat, opts.transparent, opts.opacity, opts.side, opts.map?.uuid, opts.normalMap?.uuid, opts.vertexColors, opts.sheen, opts.sheenColor, opts.coat, opts.coatRough]);
  if (key && matCache.has(key)) return matCache.get(key);
  const C = opts.sheen || opts.coat ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const m = new C({
    color,
    roughness: opts.rough ?? 0.55,
    metalness: opts.metal ?? 0.0,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    map: opts.map || null,
    normalMap: opts.normalMap || null,
    flatShading: !!opts.flat,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
    vertexColors: !!opts.vertexColors,
  });
  if (opts.normalMap) m.normalScale.set(opts.normalScale ?? 0.8, opts.normalScale ?? 0.8);
  if (opts.sheen) {
    m.sheen = opts.sheen;
    m.sheenRoughness = opts.sheenRoughness ?? 0.45;
    m.sheenColor = new THREE.Color(opts.sheenColor || '#ffffff');
  }
  if (opts.coat) {
    m.clearcoat = opts.coat;
    m.clearcoatRoughness = opts.coatRough ?? 0.06;
  }
  patchRim(m, opts.rim ?? 1);
  if (key) { m.userData.shared = true; matCache.set(key, m); }
  return m;
}

// Matériau émissif pur (néons, yeux, projectiles)
export function glow(color, intensity = 2.5) {
  const key = 'glow' + color + intensity;
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), toneMapped: true });
  m.userData.shared = true;
  m.userData.isGlow = true;
  matCache.set(key, m);
  return m;
}

// Clone un matériau pour un usage individuel (ex : flash d'un ennemi)
export function cloneMat(m) {
  const c = m.clone();
  if (m.userData.flash !== undefined) {
    c.userData.enemyRim = m.userData.enemyRim;
    patchRim(c, m.userData.rimMul.value, m.userData.rimExtra);
    c.customProgramCacheKey = m.customProgramCacheKey;
  }
  return c;
}

// Terrain : texture A (sol) projetée en XZ, texture B (paroi) en triplanaire, mélange selon la pente.
export function terrainMaterial({ mapA, mapB, normalA, normalB, scaleA = 0.12, scaleB = 0.08, slopeLo = 0.62, slopeHi = 0.82, rough = 0.9, normalStrength = 0.8 }) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: rough, metalness: 0, vertexColors: true });
  const u = {
    tA: { value: mapA }, tB: { value: mapB },
    nA: { value: normalA || null }, nB: { value: normalB || null },
    sA: { value: scaleA }, sB: { value: scaleB },
    slope: { value: new THREE.Vector2(slopeLo, slopeHi) },
    nStr: { value: normalStrength },
  };
  const hasN = !!(normalA && normalB);
  // signature propre (textures et réglages), pour ne fusionner que des rochers identiques
  m.userData.sig = [mapA && mapA.uuid, mapB && mapB.uuid, normalA && normalA.uuid, scaleA, scaleB, slopeLo, slopeHi, rough, normalStrength].join(',');
  if (hasN) m.defines = { TERRAIN_NORMALS: '' };
  m.userData.flash = { value: 0 };
  m.userData.flashColor = { value: new THREE.Color(1, 1, 1) };
  m.userData.rimMul = { value: 0.25 };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, {
      uRimColor: globalU.uRimColor, uRimStrength: globalU.uRimStrength,
      uRimMul: m.userData.rimMul, uFlash: m.userData.flash, uFlashColor: m.userData.flashColor,
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = RIM_PARS + shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNrm;
        uniform sampler2D tA; uniform sampler2D tB; uniform float sA; uniform float sB; uniform vec2 slope;
        uniform sampler2D nA; uniform sampler2D nB; uniform float nStr;
        vec3 triB(vec3 p, vec3 n) {
          vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
          return texture2D(tB, p.zy * sB).rgb * w.x + texture2D(tB, p.xz * sB).rgb * w.y + texture2D(tB, p.xy * sB).rgb * w.z;
        }`)
      .replace('#include <map_fragment>', `
        vec3 nW = normalize(vWNrm);
        vec3 cA = mix(texture2D(tA, vWPos.xz * sA).rgb, texture2D(tA, vWPos.xz * sA * 0.23 + vec2(0.37, 0.71)).rgb, 0.4);
        vec3 cB = triB(vWPos, nW);
        float k = smoothstep(slope.x, slope.y, nW.y);
        diffuseColor.rgb *= mix(cB, cA, k);
      `)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        #ifdef TERRAIN_NORMALS
        {
          // relief : carte A projetée sur le sol, carte B triplanaire sur les parois (mélange « whiteout »)
          vec3 n0 = normalize(vWNrm);
          vec3 bw = pow(abs(n0), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
          vec3 tX = texture2D(nB, vWPos.zy * sB).xyz * 2.0 - 1.0; tX.xy *= nStr;
          vec3 tY = texture2D(nB, vWPos.xz * sB).xyz * 2.0 - 1.0; tY.xy *= nStr;
          vec3 tZ = texture2D(nB, vWPos.xy * sB).xyz * 2.0 - 1.0; tZ.xy *= nStr;
          vec3 wX = vec3(tX.xy + n0.zy, abs(tX.z) * n0.x);
          vec3 wY = vec3(tY.xy + n0.xz, abs(tY.z) * n0.y);
          vec3 wZ = vec3(tZ.xy + n0.xy, abs(tZ.z) * n0.z);
          vec3 nWall = normalize(wX.zyx * bw.x + wY.xzy * bw.y + wZ.xyz * bw.z);
          vec3 tg = texture2D(nA, vWPos.xz * sA).xyz * 2.0 - 1.0; tg.xy *= nStr;
          vec3 nGround = normalize(vec3(tg.x + n0.x, abs(tg.z) * n0.y, tg.y + n0.z));
          vec3 nW = normalize(mix(nWall, nGround, smoothstep(slope.x, slope.y, n0.y)));
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
        }
        #endif
      `)
      .replace('#include <fog_fragment>', RIM_CODE);
    addFogUniforms(shader);
    injectSlots(shader);
  };
  m.customProgramCacheKey = () => 'terrain-tri' + (hasN ? 'N' : '') + slotsTier();
  return m;
}

// Contour « coque inversée » pour les personnages
export function outlineMaterial(color = '#1a0f22', thickness = 0.018) {
  const key = 'outline' + color + thickness;
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\ntransformed += normalize(normal) * ${thickness.toFixed(4)};`,
    );
  };
  m.customProgramCacheKey = () => 'outline' + thickness;
  m.userData.shared = true;
  matCache.set(key, m);
  return m;
}

// Recompile les matériaux (changement de variante des emplacements GLSL) : ceux de la scène et ceux en cache
export function refreshMaterials(scene) {
  for (const m of matCache.values()) m.needsUpdate = true;
  scene.traverse((o) => {
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) m.needsUpdate = true;
  });
}

export function setFlash(materials, v, color) {
  for (const m of materials) {
    if (m.userData.flash) {
      m.userData.flash.value = v;
      if (color) m.userData.flashColor.value.set(color);
    }
  }
}
