// Ondes dynamiques : équation des ondes intégrée sur le GPU (deux textures en ping-pong) dans un carré centré
// sur Kobi. La fenêtre suit le joueur par pas entiers de texels (l'état est décalé, pas étiré). Les impulsions
// (pas, atterrissages, tirs, explosions, chutes) s'ajoutent à la vitesse de la surface.
// Sortie : r = hauteur, g = vitesse, ba = pente (en mètres par mètre), lue par les surfaces d'eau.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const MAX_IMP = 16;
const STEP = 1 / 50;

const FRAG = /* glsl */ `
uniform sampler2D tPrev;
uniform vec2 uShift;
uniform float uTexel, uWorldTexel, uDamp;
uniform vec4 uArea;
uniform vec4 uImp[${MAX_IMP}];
uniform int uImpN;
varying vec2 vUv;
float st(vec2 uv) {
  // hors de la fenêtre précédente : eau calme
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  return texture2D(tPrev, uv).r;
}
void main() {
  vec2 uv = vUv + uShift;
  vec4 c = (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture2D(tPrev, uv);
  float l = st(uv - vec2(uTexel, 0.0)), r = st(uv + vec2(uTexel, 0.0));
  float b = st(uv - vec2(0.0, uTexel)), t = st(uv + vec2(0.0, uTexel));
  float h = c.r, v = c.g;
  v += ((l + r + b + t) * 0.25 - h) * 0.55;
  v *= uDamp;
  h = (h + v) * 0.997;
  vec2 wp = uArea.xy + (vUv - 0.5) * uArea.z;
  for (int i = 0; i < ${MAX_IMP}; i++) {
    if (i >= uImpN) break;
    vec4 im = uImp[i];
    vec2 d = wp - im.xy;
    v -= im.w * exp(-dot(d, d) / (im.z * im.z));
  }
  // bord de la fenêtre amorti (pas de réflexion parasite)
  vec2 e = smoothstep(0.0, 0.04, vUv) * smoothstep(1.0, 0.96, vUv);
  float k = e.x * e.y;
  gl_FragColor = vec4(h * k, v * k, (r - l) / (2.0 * uWorldTexel), (t - b) / (2.0 * uWorldTexel));
}`;

export class RippleSim {
  constructor(renderer, size = 256, area = 44) {
    this.renderer = renderer;
    this.area = area;
    const opts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false };
    this.a = new THREE.WebGLRenderTarget(size, size, opts);
    this.b = new THREE.WebGLRenderTarget(size, size, opts);
    this.imps = [];
    for (let i = 0; i < MAX_IMP; i++) this.imps.push(new THREE.Vector4());
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tPrev: { value: null }, uShift: { value: new THREE.Vector2() }, uTexel: { value: 1 / size }, uWorldTexel: { value: area / size },
        uDamp: { value: 0.985 }, uArea: { value: new THREE.Vector4(0, 0, area, 0) }, uImp: { value: this.imps }, uImpN: { value: 0 },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: FRAG,
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    });
    this.fsq = new FullScreenQuad(this.mat);
    this.size = size;
    this.center = new THREE.Vector2(0, 0);
    this.shift = new THREE.Vector2(0, 0);
    this.later = [];
    this.clock = 0;
    this.pending = [];
    this.acc = 0;
    this.active = false;
    this.idle = 99;
    this._clear();
  }
  get texture() { return this.a.texture; }
  setSize(size) {
    if (size === this.size) return;
    this.size = size;
    this.a.setSize(size, size);
    this.b.setSize(size, size);
    this.mat.uniforms.uTexel.value = 1 / size;
    this.mat.uniforms.uWorldTexel.value = this.area / size;
    this._clear();
  }
  _clear() {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    for (const t of [this.a, this.b]) { r.setRenderTarget(t); r.clear(); }
    r.setClearColor(cc, ca);
    r.setRenderTarget(prev);
  }
  // force en mètres de creusement par seconde environ ; rayon en mètres ; delay : plus tard (secondes)
  impulse(x, z, radius, strength, delay = 0) {
    if (delay > 0) { this.later.push([this.clock + delay, x, z, radius, strength]); return; }
    // hors de la fenêtre : rien à faire
    const h = this.area * 0.55;
    if (Math.abs(x - this.center.x) > h || Math.abs(z - this.center.y) > h) return;
    if (this.pending.length >= MAX_IMP) this.pending.shift();
    this.pending.push([x, z, Math.max(radius, this.area / this.size * 1.2), strength]);
    this.idle = 0;
  }
  // cx, cz : centre souhaité (Kobi) ; renvoie vrai si la simulation a tourné
  update(dt, cx, cz) {
    this.clock += dt;
    for (let i = this.later.length - 1; i >= 0; i--) {
      const l = this.later[i];
      if (l[0] <= this.clock) { this.later.splice(i, 1); this.impulse(l[1], l[2], l[3], l[4]); }
    }
    this.idle += dt;
    // eau calme depuis longtemps et rien de nouveau : rien à calculer
    if (this.idle > 8 && !this.pending.length) { this.active = false; return false; }
    this.active = true;
    const u = this.mat.uniforms;
    const texel = this.area / this.size;
    const nx = Math.round(cx / texel) * texel, nz = Math.round(cz / texel) * texel;
    // décalage cumulé jusqu'au prochain pas de calcul
    this.shift.x += (nx - this.center.x) / this.area;
    this.shift.y += (nz - this.center.y) / this.area;
    this.center.set(nx, nz);
    u.uArea.value.set(nx, nz, this.area, 0);
    this.acc = Math.min(this.acc + dt, STEP * 3);
    const r = this.renderer;
    const prev = r.getRenderTarget();
    let first = true;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      u.tPrev.value = this.a.texture;
      u.uShift.value.copy(this.shift);
      this.shift.set(0, 0);
      if (first) {
        const n = this.pending.length;
        for (let i = 0; i < n; i++) this.imps[i].set(...this.pending[i]);
        u.uImpN.value = n;
        this.pending.length = 0;
        first = false;
      } else u.uImpN.value = 0;
      r.setRenderTarget(this.b);
      this.fsq.render(r);
      const t = this.a; this.a = this.b; this.b = t;
    }
    r.setRenderTarget(prev);
    return true;
  }
  dispose() {
    this.a.dispose(); this.b.dispose(); this.mat.dispose(); this.fsq.dispose();
  }
}
