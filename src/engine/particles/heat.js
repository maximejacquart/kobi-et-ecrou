// Distorsion de chaleur : les sources (onde de choc, air brûlant au-dessus des flammes) écrivent un décalage d'écran
// dans un tampon à demi-résolution, puis une passe légère déforme l'image entière (eau et effets compris).
// La passe est sautée quand aucune source n'est active.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { fxUniforms, FX_PARS, FX_FRAG } from './shared.js';

export const HEAT = { SHOCK: 0, HAZE: 1 };

const VERT = /* glsl */ `
${FX_PARS}
attribute vec4 iA;   // position, taille
attribute vec4 iB;   // genre, âge (0..1), force, graine
varying vec2 vC;
varying vec4 vInfo;
varying float vViewZ, vSize;
void main() {
  vec4 mv = viewMatrix * vec4(iA.xyz, 1.0);
  vC = position.xy;
  mv.xy += position.xy * iA.w;
  vInfo = iB;
  vViewZ = -mv.z;
  vSize = iA.w;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
${FX_PARS}
${FX_FRAG}
varying vec2 vC;
varying vec4 vInfo;
varying float vViewZ, vSize;
float hh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hh(i), hh(i + vec2(1, 0)), f.x), mix(hh(i + vec2(0, 1)), hh(i + vec2(1, 1)), f.x), f.y); }
void main() {
  float r = length(vC);
  if (r > 1.0) discard;
  float age = vInfo.y;
  vec2 off;
  if (vInfo.x < 0.5) {
    // onde de choc : anneau qui repousse l'image vers l'extérieur
    float rr = 0.25 + age * 0.75;
    float band = exp(-pow((r - rr) / (0.07 + 0.05 * age), 2.0));
    off = (vC / max(r, 1e-3)) * band * (1.0 - age) * (1.0 - age);
  } else {
    // air brûlant : tremblement qui monte
    vec2 q = vC * 3.0 + vec2(vInfo.w * 17.0, -uFxTime * 2.5);
    off = vec2(vn(q) - 0.5, vn(q + 7.3) - 0.5) * 2.0 * smoothstep(1.0, 0.2, r) * sin(age * 3.14159);
  }
  // masqué par le décor placé devant
  float vis = fxSoft(vViewZ, max(0.3, vSize * 0.3));
  // décalage en pixels de l'image proportionnel à la taille apparente de la source
  float k = vInfo.z * vis * vSize / max(vViewZ, 0.5);
  gl_FragColor = vec4(off * k, 0.0, 0.0);
}`;

const COMP = /* glsl */ `
uniform sampler2D tDiffuse, tHeat;
varying vec2 vUv;
void main() {
  vec2 o = texture2D(tHeat, vUv).xy * 0.06;
  vec3 c;
  c.r = texture2D(tDiffuse, vUv + o * 1.06).r;
  c.g = texture2D(tDiffuse, vUv + o).g;
  c.b = texture2D(tDiffuse, vUv + o * 0.94).b;
  gl_FragColor = vec4(c, 1.0);
}`;

export class HeatPass extends Pass {
  constructor(camera, max = 128) {
    super();
    this.name = 'heat';
    this.camera = camera;
    this.max = max;
    this.n = 0;
    this.scene = new THREE.Scene();
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.iA = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iB = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iA', this.iA);
    g.setAttribute('iB', this.iB);
    this._attrs = [this.iA, this.iB];
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      uniforms: fxUniforms(), vertexShader: VERT, fragmentShader: FRAG,
      defines: { FX_SCREEN: '2.0' },
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.comp = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tHeat: { value: this.rt.texture } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: COMP, depthTest: false, depthWrite: false,
    });
    this.fsq = new FullScreenQuad(this.comp);
    // sources simulées
    const F = () => new Float32Array(max);
    this.px = F(); this.py = F(); this.pz = F(); this.vy = F(); this.size0 = F(); this.size1 = F();
    this.life = F(); this.maxLife = F(); this.kind = F(); this.str = F(); this.seed = F();
    this._arrs = [this.px, this.py, this.pz, this.vy, this.size0, this.size1, this.life, this.maxLife, this.kind, this.str, this.seed];
    this.enabled = false;
    this._clear = new THREE.Color(0, 0, 0);
    this._prevClear = new THREE.Color();
  }
  add(kind, p, size0, size1, life, strength, rise = 0) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.px[i] = p.x; this.py[i] = p.y; this.pz[i] = p.z; this.vy[i] = rise;
    this.size0[i] = size0; this.size1[i] = size1; this.life[i] = 0; this.maxLife[i] = life;
    this.kind[i] = kind; this.str[i] = strength; this.seed[i] = Math.random();
  }
  reset() { this.n = 0; this.geo.instanceCount = 0; }
  update(dt, allowed) {
    let i = 0;
    while (i < this.n) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) {
        const j = --this.n;
        if (i !== j) for (const a of this._arrs) a[i] = a[j];
        continue;
      }
      this.py[i] += this.vy[i] * dt;
      i++;
    }
    const A = this.iA.array, B = this.iB.array;
    for (let k = 0; k < this.n; k++) {
      const t = this.life[k] / this.maxLife[k];
      const e = this.kind[k] === HEAT.SHOCK ? 1 - Math.pow(1 - t, 2.2) : t;
      A[k * 4] = this.px[k]; A[k * 4 + 1] = this.py[k]; A[k * 4 + 2] = this.pz[k];
      A[k * 4 + 3] = this.size0[k] + (this.size1[k] - this.size0[k]) * e;
      B[k * 4] = this.kind[k]; B[k * 4 + 1] = t; B[k * 4 + 2] = this.str[k]; B[k * 4 + 3] = this.seed[k];
    }
    this.geo.instanceCount = this.n;
    if (this.n) {
      for (const a of this._attrs) { a.clearUpdateRanges(); a.addUpdateRange(0, this.n * 4); a.needsUpdate = true; }
    }
    this.enabled = allowed && this.n > 0;
  }
  setSize(w, h) {
    this.rt.setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
  }
  render(renderer, writeBuffer, readBuffer) {
    renderer.getClearColor(this._prevClear);
    const ca = renderer.getClearAlpha();
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(this._clear, 0);
    renderer.clear(true, false, false);
    renderer.render(this.scene, this.camera);
    renderer.setClearColor(this._prevClear, ca);
    this.comp.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsq.render(renderer);
  }
  dispose() {
    this.rt.dispose();
    this.comp.dispose();
    this.fsq.dispose();
  }
}
