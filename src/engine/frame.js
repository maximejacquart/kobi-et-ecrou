// État partagé d'une image : couches de rendu, uniformes communs (textures de la passe de profondeur, matrices,
// soleil) et réglages par niveau de qualité. Tous les modules du rendu lisent et écrivent ici plutôt que de se
// connaître les uns les autres.
import * as THREE from 'three';

// Couches : le monde opaque est dessiné d'abord (couche 0) ; l'eau puis les effets sont dessinés ensuite par-dessus
// une copie de l'image et de la profondeur (réfraction, particules adoucies au contact du décor).
// Un objet transparent qui peut se trouver devant l'eau doit être sur la couche FX.
export const LAYERS = { WORLD: 0, WATER: 2, FX: 3 };

export const frameU = {
  // taille de l'image principale en pixels (gl_FragCoord / uRes = coordonnées écran)
  uRes: { value: new THREE.Vector2(1, 1) },
  // numéro d'image (bruit et accumulation temporelle)
  uFrame: { value: 0 },
  // passe de profondeur : normales vue (rgb, encodées) + rugosité (a), profondeur
  tGNormal: { value: null },
  tGDepth: { value: null },
  // occlusion ambiante (calculée avant l'éclairage, appliquée à la seule lumière indirecte)
  uAOTex: { value: null },
  uAOOn: { value: 0 },
  // image opaque (couleur et profondeur) disponible pendant le dessin de l'eau et des effets
  tSceneColor: { value: null },
  tSceneDepth: { value: null },
  // caméra
  uCamNear: { value: 0.1 },
  uCamFar: { value: 1400 },
  uProj: { value: new THREE.Matrix4() },
  uInvProj: { value: new THREE.Matrix4() },
  uView: { value: new THREE.Matrix4() },
  uInvView: { value: new THREE.Matrix4() },
  uViewProj: { value: new THREE.Matrix4() },
  uPrevViewProj: { value: new THREE.Matrix4() },
  // soleil (direction vers le soleil, couleur × intensité), réglés par le niveau
  uSunDir: { value: new THREE.Vector3(0.5, 0.6, 0.3).normalize() },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
};

// Réglages par niveau de qualité. Chaque module ajoute ses clés (lues par ses modules via R.Q).
export const QUALITY = {
  ultra: { pixelRatio: 2, prepass: true, prepassScale: 1, ao: true, rays: true, shadowSize: 2048, msaa: 4 },
  haute: { pixelRatio: 1.5, prepass: true, prepassScale: 0.5, ao: true, rays: true, shadowSize: 2048, msaa: 4 },
  moyenne: { pixelRatio: 1, prepass: false, prepassScale: 0.5, ao: false, rays: false, shadowSize: 1536, msaa: 2 },
};

// Entrées « écran » (textures calculées pour la caméra principale : occlusion, reflets, lumière indirecte…) : elles
// sont fausses dans un rendu hors écran (captures des sondes). screenInputs(false) les coupe, screenInputs(true) les
// rétablit ; chaque effet y ajoute sa bascule avec onScreenInputs((on) => …).
const screenToggles = [];
export function onScreenInputs(fn) { screenToggles.push(fn); }
export function screenInputs(on) { for (const f of screenToggles) f(on); }
let aoSaved = 0;
onScreenInputs((on) => {
  if (on) frameU.uAOOn.value = aoSaved;
  else { aoSaved = frameU.uAOOn.value; frameU.uAOOn.value = 0; }
});

// Une lumière doit éclairer toutes les couches (sinon l'eau et les effets seraient dessinés sans elle)
export function allLayers(light) {
  light.layers.enableAll();
  return light;
}

// GLSL commun, injecté dans tous les matériaux éclairés (voir shaderSlots.js)
export const FRAME_PARS = /* glsl */ `
uniform vec2 uRes;
uniform float uFrame;
uniform sampler2D uAOTex;
uniform float uAOOn;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
vec2 kobiScreenUV() { return gl_FragCoord.xy / uRes; }
// position monde du fragment (vViewPosition = - position vue)
vec3 kobiWorldPos() { return cameraPosition - transpose(mat3(viewMatrix)) * vViewPosition; }
// bruit « interleaved gradient » animé (échantillonnage décalé d'une image à l'autre)
float kobiIGN(vec2 p) { p += 5.588238 * mod(uFrame, 64.0); return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;
