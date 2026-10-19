// Ombres de contact : courte marche à l'écran depuis chaque pixel vers le soleil, dans la profondeur de la passe de
// profondeur (image courante, avant l'éclairage), avec une épaisseur supposée des objets. Accumulées dans le temps
// (le décalage des pas change à chaque image), elles multiplient l'ombre du soleil dans les matériaux : les pieds,
// les petits objets et les rainures gagnent une ombre nette que la carte d'ombre est trop grossière pour donner.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { frameU, QUALITY } from './frame.js';
import { addSlot } from './shaderSlots.js';
import { SCREEN_GLSL, screenUniforms, screenMaterial, screenTarget, drawQuad, TemporalFilter } from './temporal.js';

// contact : nombre de pas (0 = désactivé) ; contactLen : longueur de la marche (m)
Object.assign(QUALITY.ultra, { contact: 16, contactLen: 0.8 });
Object.assign(QUALITY.haute, { contact: 10, contactLen: 0.7 });
Object.assign(QUALITY.moyenne, { contact: 0, contactLen: 0 });

Object.assign(frameU, { uContactTex: { value: null }, uContactOn: { value: 0 } });

const CONTACT_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform float uSteps;
uniform float uLen;
layout(location = 0) out vec4 oVal;
${SCREEN_GLSL}
void main() {
  vec2 uv = gl_FragCoord.xy * uGSize.zw;
  float d = gDepth(uv);
  oVal = vec4(1.0);
  if (d >= 1.0) return;
  vec3 vp = viewPos(uv, d);
  vec3 N = gNR(uv).xyz;
  vec3 L = normalize(mat3(uView) * uSunDir);
  float ndl = dot(N, L);
  if (ndl <= 0.0) return;
  float z = -vp.z;
  // au loin, la carte d'ombre suffit (et un pixel couvre plus que la marche)
  // (surfaces rasantes : la marche longe la surface et s'y heurte ; la lumière directe y est faible de toute façon)
  float fade = (1.0 - smoothstep(25.0, 45.0, z)) * smoothstep(0.0, 0.2, ndl);
  if (fade <= 0.0) return;
  // départ légèrement décollé de la surface (précision de la profondeur)
  vec3 p0 = vp + N * (0.015 + z * 0.0015);
  vec3 stepV = L * (uLen / uSteps);
  float jit = ign(gl_FragCoord.xy, 0.0);
  float thick = 0.22 + z * 0.012;
  float bias = 0.01 + z * 0.002;
  float occ = 0.0;
  for (float i = 0.0; i < 24.0; i++) {
    if (i >= uSteps) break;
    vec3 p = p0 + stepV * (i + jit);
    vec3 s = projUVZ(p);
    if (s.xy != clamp(s.xy, vec2(0.0), vec2(1.0))) break;
    float sz = linZ(gDepth(s.xy));
    float dz = s.z - sz;
    if (dz > bias && dz < thick) {
      // ombre plus douce pour les occulteurs lointains (pénombre)
      occ = 1.0 - 0.5 * smoothstep(0.3, 1.0, (i + jit) / uSteps);
      break;
    }
  }
  oVal = vec4(1.0 - occ * fade);
}`;

export class ContactStage {
  constructor(R) {
    this.R = R;
    this.mat = screenMaterial(CONTACT_FRAG, {
      ...screenUniforms(), uSunDir: frameU.uSunDir, uSteps: { value: 12 }, uLen: { value: 0.8 },
    });
    this.fsq = new FullScreenQuad(this.mat);
    this.rt = screenTarget({ format: THREE.RedFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.temporal = new TemporalFilter({ maxAge: 8, gamma: 1.0, depthTol: 0.03 });
    frameU.uContactTex.value = this.temporal.texture;
    // occlusion (r) et contact (g) réunis dans une seule texture : les matériaux n'ont que 16 textures en tout
    this.packMat = screenMaterial(/* glsl */ `
      uniform sampler2D tAO, tC;
      layout(location = 0) out vec4 oVal;
      void main() { oVal = vec4(texture(tAO, vUv).r, texture(tC, vUv).r, 0.0, 1.0); }`, { tAO: { value: null }, tC: { value: null } });
    this.packFsq = new FullScreenQuad(this.packMat);
    this.pack = screenTarget({ format: THREE.RGFormat });
    this.white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    this.white.needsUpdate = true;
    R.onFrame.push(() => { frameU.uContactOn.value = this.enabled && R.Q.prepass ? 1 : 0; });
  }
  get enabled() { return !!this.R.Q.contact; }
  setSize(w, h) {
    this.rt.setSize(w, h);
    this.temporal.setSize(w, h);
    this.pack.setSize(w, h);
  }
  render(renderer) {
    const Q = this.R.Q, u = this.mat.uniforms;
    u.uSteps.value = Q.contact;
    u.uLen.value = Q.contactLen;
    drawQuad(renderer, this.fsq, this.rt);
    frameU.uContactTex.value = this.temporal.render(renderer, this.rt.texture);
    const ao = frameU.uAOTex.value;
    this.packMat.uniforms.tAO.value = this.R.ao.enabled && ao && ao !== this.pack.texture ? ao : this.white;
    this.packMat.uniforms.tC.value = frameU.uContactTex.value;
    drawQuad(renderer, this.packFsq, this.pack);
    frameU.uAOTex.value = this.pack.texture;
  }
}

addSlot('pars', 'contact', 'uniform float uContactOn;',
  { uContactTex: frameU.uContactTex, uContactOn: frameU.uContactOn });
addSlot('sunShadow', 'contact', 'if (uContactOn > 0.5) sunShadow *= kobiScreenTex(uAOTex, vec4(1.0)).g;', {}, 10);
