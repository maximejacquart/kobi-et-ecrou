// Emplacements GLSL partagés par tous les matériaux éclairés du jeu (mat(), terrain, herbe, personnages).
// Chaque module du rendu (ombres, occlusion, reflets, caustiques…) y dépose son code à l'import, avant toute
// compilation de shader ; les matériaux appellent injectSlots(shader) dans leur onBeforeCompile.
//
// Emplacements (fragment, sauf mention) — variables de three.js disponibles entre parenthèses :
//   pars           déclarations (uniformes, fonctions), juste avant main()
//   vpars / vmain  vertex : déclarations / code après project_vertex (mvPosition, transformed)
//   roughness      après la rugosité (roughnessFactor)
//   sunShadow      corps de float kobiSunShadow(float sunShadow) : ombre du soleil (cascades, ombres de contact)
//   directExtra    après les lumières directes (reflectedLight, geometryNormal, geometryViewDir, material)
//   indirectInputs avant le calcul indirect (irradiance, iblIrradiance, radiance)
//   indirectPost   après l'indirect (reflectedLight.indirectDiffuse / indirectSpecular)
//   final          juste avant le brouillard (gl_FragColor)
// Aides communes (frame.js) : kobiScreenUV(), kobiWorldPos(), kobiIGN(p), uRes, uFrame, uSunDir, uSunColor.
import * as THREE from 'three';
import { frameU, FRAME_PARS } from './frame.js';

const SLOTS = ['pars', 'vpars', 'vmain', 'roughness', 'sunShadow', 'directExtra', 'indirectInputs', 'indirectPost', 'final'];
const registry = Object.fromEntries(SLOTS.map((k) => [k, []]));
const slotUniforms = {
  uRes: frameU.uRes, uFrame: frameU.uFrame, uAOTex: frameU.uAOTex, uAOOn: frameU.uAOOn,
  uSunDir: frameU.uSunDir, uSunColor: frameU.uSunColor,
};

// Ajoute (ou remplace, même id) un morceau de GLSL dans un emplacement ; order : rang d'exécution (croissant)
export function addSlot(slot, id, glsl, uniforms = {}, order = 0) {
  const list = registry[slot];
  if (!list) throw new Error('Emplacement GLSL inconnu : ' + slot);
  const i = list.findIndex((e) => e.id === id);
  const entry = { id, glsl, order };
  if (i >= 0) list[i] = entry; else list.push(entry);
  list.sort((a, b) => a.order - b.order);
  Object.assign(slotUniforms, uniforms);
}

// Matériaux allégés (qualité Moyenne) : le code des effets coupés n'est pas compilé du tout (shaders plus courts,
// plus rapides). Les clés de programme des matériaux portent la variante (slotsTier) ; Renderer.setQuality recompile.
const HEAVY = new Set(['ao', 'contact', 'csm', 'ssr', 'ssgi', 'screen', 'probes']);
let lite = false;
export function setSlotsLite(on) { lite = !!on; }
export const slotsTier = () => (lite ? '-allege' : '');

const code = (slot) => registry[slot].filter((e) => !(lite && HEAVY.has(e.id))).map((e) => `// [${e.id}]\n${e.glsl}`).join('\n');

// Ombre du soleil : la première lumière directionnelle à ombre (le soleil) passe par kobiSunShadow()
const LIGHTS_BEGIN = THREE.ShaderChunk.lights_fragment_begin.replace(
  /\? getShadow\( directionalShadowMap\[ i \],([^;]*?)vDirectionalShadowCoord\[ i \] \) : 1\.0;/,
  '? kobiSunShadow( getShadow( directionalShadowMap[ i ],$1vDirectionalShadowCoord[ i ] ) ) : 1.0;',
);
if (LIGHTS_BEGIN === THREE.ShaderChunk.lights_fragment_begin) console.warn('shaderSlots : ombre du soleil non raccordée (three.js a changé)');
// Lumières ponctuelles (toutes celles du pool, lightpool.js) : rayon apparent de chaque source, qui élargit ses reflets
const LIGHTS_BEGIN_SPREAD = LIGHTS_BEGIN.replace(
  /(getPointLightInfo\( pointLight, geometryPosition, directLight \);)([\s\S]*?)(RE_Direct\( directLight[^;]*;)(\s*\}\s*#pragma unroll_loop_end)/,
  '$1\n\t\tkobiSpread = uPoolSpread[ i ] / ( 2.0 * max( length( pointLight.position - geometryPosition ), 0.05 ) );$2$3\n\t\tkobiSpread = 0.0;$4',
);
if (LIGHTS_BEGIN_SPREAD === LIGHTS_BEGIN) console.warn('shaderSlots : taille des sources non raccordée (three.js a changé)');

export function injectSlots(shader) {
  Object.assign(shader.uniforms, slotUniforms);
  let fs = shader.fragmentShader;
  fs = fs.replace('void main() {', `${FRAME_PARS}
${code('pars')}
float kobiSunShadow(float sunShadow) {
${code('sunShadow')}
  return sunShadow;
}
void main() {`);
  fs = fs
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + code('roughness'))
    .replace('#include <lights_fragment_begin>', LIGHTS_BEGIN_SPREAD + '\n' + code('directExtra'))
    .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n' + code('indirectInputs'))
    .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n' + code('indirectPost'))
    .replace('#include <fog_fragment>', code('final') + '\n#include <fog_fragment>');
  shader.fragmentShader = fs;
  shader.vertexShader = shader.vertexShader
    .replace('void main() {', code('vpars') + '\nvoid main() {')
    .replace('#include <project_vertex>', '#include <project_vertex>\n' + code('vmain'));
}

// Occlusion ambiante à l'écran : n'assombrit que la lumière indirecte (et les reflets, selon la rugosité)
addSlot('indirectPost', 'ao', /* glsl */ `
if (uAOOn > 0.5) {
  float kAO = texture2D(uAOTex, kobiScreenUV()).r;
  reflectedLight.indirectDiffuse *= kAO;
  #if defined( USE_SHEEN )
    sheenSpecularIndirect *= kAO;
  #endif
  #if defined( USE_ENVMAP ) && defined( STANDARD )
    reflectedLight.indirectSpecular *= computeSpecularOcclusion(saturate(dot(geometryNormal, geometryViewDir)), kAO, material.roughness);
  #endif
}`);
