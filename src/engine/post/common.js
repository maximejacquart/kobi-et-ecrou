// Outils communs aux passes de post-traitement : sommet plein écran, cibles de rendu HDR, GLSL partagé.
import * as THREE from 'three';

export const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

// cible HDR sans profondeur (o : options supplémentaires de WebGLRenderTarget)
export const hdrTarget = (o = {}) => new THREE.WebGLRenderTarget(1, 1, {
  type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, ...o,
});

export const material = (uniforms, fragmentShader, defines = {}) => new THREE.ShaderMaterial({
  uniforms, defines, vertexShader: VERT, fragmentShader, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
});

export const GLSL = /* glsl */ `
float max3(vec3 c) { return max(c.r, max(c.g, c.b)); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// profondeur (tampon perspective, 0..1) → distance le long de l'axe de visée (m)
float linZ(float d, float n, float f) { return n * f / (f - d * (f - n)); }
// bruit « interleaved gradient » (échantillonnage décalé pixel par pixel)
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;
