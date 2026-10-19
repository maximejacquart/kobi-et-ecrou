// Passe de profondeur : avant l'image principale, la scène opaque est dessinée une fois en normales (repère vue,
// encodées en rgb) + rugosité (a), avec sa profondeur, et en vitesse écran (deuxième sortie : uv courant − uv
// précédent, profondeur linéaire à l'image précédente, négative pour une surface lumineuse, profondeur linéaire
// courante). Elle nourrit tout ce
// qui se calcule avant l'éclairage (occlusion ambiante, ombres de contact, reflets et lumière indirecte à l'écran)
// et la reprojection de leurs historiques.
// Les objets transparents, les effets, les points, les lignes, les contours et les objets marqués userData.noAO n'y
// figurent pas ; les matériaux lumineux (glow) y figurent : les reflets et la lumière indirecte doivent les toucher.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { frameU } from './frame.js';
import { screenMaterial, drawQuad } from './temporal.js';

const VERT = /* glsl */ `
#include <common>
#include <batching_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
uniform float uSkip;
uniform mat4 uPrevModel;
uniform mat4 uPrevViewProj;
#ifdef USE_SKINNING
uniform highp sampler2D uPrevBones;
mat4 prevBone(const in float i) {
  int size = textureSize(uPrevBones, 0).x;
  int j = int(i) * 4;
  int x = j % size, y = j / size;
  return mat4(texelFetch(uPrevBones, ivec2(x, y), 0), texelFetch(uPrevBones, ivec2(x + 1, y), 0),
    texelFetch(uPrevBones, ivec2(x + 2, y), 0), texelFetch(uPrevBones, ivec2(x + 3, y), 0));
}
#endif
out vec4 vCur;
out vec4 vPrev;
out vec3 vVP;
void main() {
  #include <batching_vertex>
  #include <beginnormal_vertex>
  #include <morphinstance_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <normal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  // position à l'image précédente (os de l'image précédente pour les personnages)
  vec3 prevT = transformed;
  #ifdef USE_SKINNING
    vec4 sv = bindMatrix * vec4(prevT, 1.0);
    vec4 sk = prevBone(skinIndex.x) * sv * skinWeight.x + prevBone(skinIndex.y) * sv * skinWeight.y
      + prevBone(skinIndex.z) * sv * skinWeight.z + prevBone(skinIndex.w) * sv * skinWeight.w;
    prevT = (bindMatrixInverse * sk).xyz;
  #endif
  #include <skinning_vertex>
  #include <project_vertex>
  vVP = mvPosition.xyz;
  vec4 pp = vec4(prevT, 1.0);
  #ifdef USE_BATCHING
    pp = batchingMatrix * pp;
  #endif
  #ifdef USE_INSTANCING
    pp = instanceMatrix * pp;
  #endif
  vCur = gl_Position;
  vPrev = uPrevViewProj * (uPrevModel * pp);
  // objet exclu : rejeté hors du cadre (pas de fragment)
  if (uSkip > 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const FRAG = /* glsl */ `
#include <packing>
#include <normal_pars_fragment>
uniform float uRough;
uniform float uFlat;
uniform float uEmissive;
in vec4 vCur;
in vec4 vPrev;
in vec3 vVP;
layout(location = 0) out vec4 gNormal;
layout(location = 1) out vec4 gVel;
void main() {
  #include <normal_fragment_begin>
  if (uFlat > 0.5) normal = normalize(cross(dFdx(vVP), dFdy(vVP)));
  gNormal = vec4(packNormalToRGB(normal), uRough);
  vec2 c = vCur.xy / vCur.w;
  vec2 p = vPrev.w > 0.0 ? vPrev.xy / vPrev.w : c + 8.0;
  // b < 0 : surface lumineuse (elle éclaire aussi par sa face cachée, voir ssgi.js)
  gVel = vec4((c - p) * 0.5, uEmissive > 0.5 ? -vPrev.w : vPrev.w, vCur.w);
}`;

const ZERO4 = new Float32Array(4);

export class Prepass {
  constructor(R) {
    this.R = R;
    this.depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);
    this.rt = new THREE.WebGLRenderTarget(1, 1, {
      count: 2, type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthTexture: this.depthTexture,
    });
    this.normalTexture = this.rt.textures[0];
    this.velTexture = this.rt.textures[1];
    // profondeur linéaire de l'image précédente (copiée avant de redessiner)
    this.prevZ = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, format: THREE.RedFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    });
    this.copyZ = new FullScreenQuad(screenMaterial(/* glsl */ `
      uniform highp sampler2D tVel;
      layout(location = 0) out vec4 oVal;
      void main() { oVal = vec4(texelFetch(tVel, ivec2(gl_FragCoord.xy), 0).a); }`, { tVel: { value: this.velTexture } }));
    const u = {
      uRough: { value: 1 }, uSkip: { value: 0 }, uFlat: { value: 0 }, uEmissive: { value: 0 },
      uPrevModel: { value: new THREE.Matrix4() }, uPrevViewProj: frameU.uPrevViewProj, uPrevBones: { value: null },
    };
    this.mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, uniforms: u, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, blending: THREE.NoBlending,
    });
    this.frame = 0;
    // état de l'image précédente par objet (matrice monde) et par squelette (os)
    this.prevObj = new WeakMap();
    this.prevSkel = new WeakMap();
    // réglages propres à chaque objet (la même matière remplace toutes les autres)
    this.mat.onBeforeRender = (renderer, scene, camera, geometry, object, group) => {
      let m = object.material;
      if (Array.isArray(m)) m = m[group && group.materialIndex !== undefined ? group.materialIndex : 0];
      const skip = !m || object.isPoints || object.isLine || object.isSprite || object.userData.noAO || object.userData.isOutline
        || m.transparent || m.isShaderMaterial || (m.isMeshBasicMaterial && !m.userData.isGlow);
      u.uSkip.value = skip ? 1 : 0;
      if (!skip) {
        u.uRough.value = m.roughness !== undefined ? m.roughness : 1;
        u.uFlat.value = m.flatShading ? 1 : 0;
        const em = m.emissive;
        u.uEmissive.value = m.userData.isGlow || (em && m.emissiveIntensity * Math.max(em.r, em.g, em.b) > 0.08) ? 1 : 0;
        this._prevState(object, u);
      }
      this.mat.uniformsNeedUpdate = true;
    };
    this._clear = new THREE.Color();
    frameU.tGNormal.value = this.normalTexture;
    frameU.tGDepth.value = this.depthTexture;
    frameU.tGVel.value = this.velTexture;
    frameU.tGPrevZ.value = this.prevZ.texture;
  }
  // matrice monde (et os) de l'image précédente : la vitesse suit les objets et les personnages animés
  _prevState(object, u) {
    const f = this.frame;
    let e = this.prevObj.get(object);
    if (!e) { e = { m: new THREE.Matrix4(), f: -9 }; this.prevObj.set(object, e); }
    if (object.isSkinnedMesh) {
      // les os portent tout le mouvement (bindMatrixInverse annule la matrice de l'objet)
      u.uPrevModel.value.copy(object.matrixWorld);
      u.uPrevBones.value = this._prevBones(object.skeleton);
    } else {
      u.uPrevModel.value.copy(e.f === f - 1 ? e.m : object.matrixWorld);
    }
    e.m.copy(object.matrixWorld);
    e.f = f;
  }
  _prevBones(sk) {
    const f = this.frame;
    const cur = sk.boneMatrices;
    let s = this.prevSkel.get(sk);
    if (!s || s.len !== cur.length) {
      const size = Math.max(4, Math.ceil(Math.sqrt(cur.length / 4) / 4) * 4);
      const mk = () => {
        const t = new THREE.DataTexture(new Float32Array(size * size * 4), size, size, THREE.RGBAFormat, THREE.FloatType);
        t.image.data.set(cur);
        t.needsUpdate = true;
        return t;
      };
      if (s) s.tex.forEach((t) => t.dispose());
      s = { len: cur.length, tex: [mk(), mk()], last: 0, f: -9, prev: null };
      this.prevSkel.set(sk, s);
    }
    if (s.f !== f) {
      // s.tex[s.last] : os enregistrés à la dernière image où le squelette a été vu
      if (s.f !== f - 1) { s.tex[s.last].image.data.set(cur); s.tex[s.last].needsUpdate = true; }
      s.prev = s.tex[s.last];
      const next = 1 - s.last;
      s.tex[next].image.data.set(cur);
      s.tex[next].needsUpdate = true;
      s.last = next;
      s.f = f;
    }
    return s.prev;
  }
  setSize(w, h) {
    this.rt.setSize(w, h);
    this.prevZ.setSize(w, h);
  }
  render() {
    const { renderer: r, scene, camera } = this.R;
    this.frame++;
    drawQuad(r, this.copyZ, this.prevZ);
    r.getClearColor(this._clear);
    const ca = r.getClearAlpha();
    r.setRenderTarget(this.rt);
    // fond : normale (0, 0, 1), rugosité 1 ; vitesse et profondeurs nulles (ciel)
    r.setClearColor(0x7f7fff, 1);
    r.clear();
    const gl = r.getContext();
    gl.clearBufferfv(gl.COLOR, 1, ZERO4);
    scene.overrideMaterial = this.mat;
    const ac = r.autoClear;
    r.autoClear = false;
    r.render(scene, camera);
    r.autoClear = ac;
    scene.overrideMaterial = null;
    r.setClearColor(this._clear, ca);
  }
  dispose() {
    this.rt.dispose();
    this.prevZ.dispose();
    this.mat.dispose();
    this.copyZ.material.dispose();
    this.copyZ.dispose();
  }
}
