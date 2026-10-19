// Éclaboussures, embruns et brume : petit système de particules autonome, sur la couche des effets (dessiné
// après l'eau, donc visible devant elle). Gouttes (lumière de la scène), brume douce (adoucie au contact du
// décor), et gouttes incandescentes (lave, additives).
import * as THREE from 'three';
import { frameU, LAYERS } from '../frame.js';

const VERT = /* glsl */ `
attribute vec4 aColor;
attribute vec2 aSize;
uniform float uScale;
varying vec4 vColor;
varying float vSoft;
varying float vViewZ;
#include <fog_pars_vertex>
void main() {
  vColor = aColor;
  vSoft = aSize.y;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewZ = -mvPosition.z;
  gl_PointSize = aSize.x * uScale / max(0.1, -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FRAG = /* glsl */ `
uniform vec3 uLight;
uniform float uGlow;
uniform sampler2D tSceneDepth;
uniform vec2 uRes;
uniform float uCamNear, uCamFar;
varying vec4 vColor;
varying float vSoft;
varying float vViewZ;
#include <fog_pars_fragment>
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float r = length(p) * 2.0;
  if (r > 1.0) discard;
  float a;
  vec3 col = vColor.rgb;
  if (vSoft > 0.5) {
    // brume : disque très doux, fondu au contact du décor
    a = (1.0 - r) * (1.0 - r);
    float d = texture2D(tSceneDepth, gl_FragCoord.xy / uRes).x;
    float sz = (uCamNear * uCamFar) / (uCamFar - (uCamFar - uCamNear) * d);
    a *= clamp((sz - vViewZ) / 1.5, 0.0, 1.0);
  } else {
    // goutte : bord net, reflet clair en haut
    a = smoothstep(1.0, 0.7, r);
    col *= 0.85 + 0.5 * smoothstep(0.6, 0.0, length(p - vec2(-0.12, 0.15)) * 2.0);
  }
  col = uGlow > 0.5 ? col : col * uLight;
  gl_FragColor = vec4(col, a * vColor.a);
  #include <fog_fragment>
}`;

class Pool {
  constructor(max, blending, soft, glow) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.siz = new Float32Array(max * 2);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.floor = new Float32Array(max);
    this.soft = soft;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.siz, 2).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geo = geo;
    const u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uScale: { value: 500 }, uLight: { value: new THREE.Color(1, 1, 1) }, uGlow: { value: glow ? 1 : 0 },
    }]);
    u.tSceneDepth = frameU.tSceneDepth;
    u.uRes = frameU.uRes;
    u.uCamNear = frameU.uCamNear;
    u.uCamFar = frameU.uCamFar;
    this.mat = new THREE.ShaderMaterial({
      uniforms: u, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, blending, fog: true,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.layers.set(LAYERS.FX);
    this.points.renderOrder = soft ? 8 : 11;
  }
  emit(x, y, z, vx, vy, vz, o) {
    if (this.n >= this.max) return;
    const i = this.n++;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.life[i] = 0;
    this.maxLife[i] = o.life;
    this.s0[i] = o.size;
    this.s1[i] = o.size1 ?? o.size;
    this.a0[i] = o.alpha ?? 1;
    this.grav[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 0;
    this.floor[i] = o.floor ?? -1e9;
    const c = o.color;
    this.col[i * 4] = c.r; this.col[i * 4 + 1] = c.g; this.col[i * 4 + 2] = c.b; this.col[i * 4 + 3] = 0;
    this.siz[i * 2 + 1] = this.soft ? 1 : 0;
  }
  update(dt, onLand) {
    let i = 0;
    while (i < this.n) {
      this.life[i] += dt;
      const t = this.life[i] / this.maxLife[i];
      const i3 = i * 3;
      const landed = this.pos[i3 + 1] < this.floor[i] && this.vel[i3 + 1] < 0;
      if (t >= 1 || landed) {
        if (landed && onLand) onLand(this.pos[i3], this.floor[i], this.pos[i3 + 2]);
        const j = --this.n;
        if (i !== j) this._copy(j, i);
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= d; this.vel[i3 + 1] = this.vel[i3 + 1] * d - this.grav[i] * dt; this.vel[i3 + 2] *= d;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      this.siz[i * 2] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.col[i * 4 + 3] = this.a0[i] * Math.min(1, t * 10) * (1 - t * t);
      i++;
    }
    const g = this.geo;
    g.setDrawRange(0, this.n);
    if (this.n || this._sent) {
      for (const k of ['position', 'aColor', 'aSize']) {
        const a = g.attributes[k];
        a.clearUpdateRanges();
        a.addUpdateRange(0, Math.max(1, this.n) * a.itemSize);
        a.needsUpdate = true;
      }
    }
    this._sent = this.n > 0;
    this.points.visible = this.n > 0;
  }
  _copy(j, i) {
    for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] = this.pos[j * 3 + k]; this.vel[i * 3 + k] = this.vel[j * 3 + k]; }
    for (let k = 0; k < 4; k++) this.col[i * 4 + k] = this.col[j * 4 + k];
    this.siz[i * 2] = this.siz[j * 2]; this.siz[i * 2 + 1] = this.siz[j * 2 + 1];
    this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j];
    this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j]; this.a0[i] = this.a0[j];
    this.grav[i] = this.grav[j]; this.drag[i] = this.drag[j]; this.floor[i] = this.floor[j];
  }
  clear() { this.n = 0; }
}

const _c = new THREE.Color();

export class Splashes {
  constructor(scene) {
    this.drops = new Pool(1500, THREE.NormalBlending, false, false);
    this.mist = new Pool(500, THREE.NormalBlending, true, false);
    this.embers = new Pool(400, THREE.AdditiveBlending, false, true);
    this.group = new THREE.Group();
    this.group.name = 'eau-eclaboussures';
    this.group.add(this.drops.points, this.mist.points, this.embers.points);
    scene.add(this.group);
    this.density = 1;
    this.onLand = null;
  }
  setLight(c) {
    this.drops.mat.uniforms.uLight.value.copy(c);
    this.mist.mat.uniforms.uLight.value.copy(c);
  }
  setScale(s) { for (const p of [this.drops, this.mist, this.embers]) p.mat.uniforms.uScale.value = s; }
  // gerbe d'éclaboussure : couronne de gouttes + brume ; o : { color, floor, glow, mist }
  burst(x, y, z, force, o = {}) {
    const n = Math.round((6 + force * 26) * this.density);
    const col = _c.set(o.color || '#e8f6ff');
    const pool = o.glow ? this.embers : this.drops;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.6 + Math.random() * 2.2) * (0.6 + force);
      const up = (2.2 + Math.random() * 4.5) * (0.5 + force * 0.8);
      pool.emit(x + Math.cos(a) * 0.15, y + 0.05, z + Math.sin(a) * 0.15, Math.cos(a) * sp, up, Math.sin(a) * sp, {
        life: 0.6 + Math.random() * 0.8, size: 0.05 + Math.random() * 0.07 * (0.5 + force), size1: 0.03, gravity: 16, drag: 0.4,
        color: col, alpha: 0.95, floor: o.floor ?? y,
      });
    }
    if (o.mist !== false) {
      const m = Math.round((1 + force * 5) * this.density);
      for (let i = 0; i < m; i++) {
        this.mist.emit(x + (Math.random() - 0.5) * force * 0.6, y + 0.15, z + (Math.random() - 0.5) * force * 0.6,
          (Math.random() - 0.5) * 1.5, 0.8 + Math.random() * 1.4, (Math.random() - 0.5) * 1.5, {
            life: 0.7 + Math.random() * 0.6, size: 0.3 + force * 0.3, size1: 1.0 + force * 1.2, drag: 2, color: col, alpha: 0.16,
          });
      }
    }
  }
  // embruns continus (pied de cascade) : quelques gouttes et une bouffée de brume
  spray(x, y, z, r, rate, dt, o = {}) {
    const col = _c.set(o.color || '#eef8ff');
    let k = rate * dt * this.density;
    while (k > 0) {
      if (Math.random() < k) {
        const a = Math.random() * Math.PI * 2, d = Math.random() * r;
        const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
        if (Math.random() < 0.55) {
          this.drops.emit(px, y, pz, Math.cos(a) * (1 + Math.random() * 2.5), 2 + Math.random() * 5, Math.sin(a) * (1 + Math.random() * 2.5), {
            life: 0.7 + Math.random() * 0.6, size: 0.05 + Math.random() * 0.06, size1: 0.03, gravity: 14, drag: 0.6, color: col, alpha: 0.85, floor: y - 0.05,
          });
        } else {
          this.mist.emit(px, y + Math.random() * 0.8, pz, Math.cos(a) * 0.8, 0.6 + Math.random() * 1.4, Math.sin(a) * 0.8, {
            life: 2 + Math.random() * 1.5, size: (o.mistSize ?? 1.4) * (1 + Math.random() * 0.6), size1: (o.mistSize ?? 1.4) * (2.5 + Math.random() * 1.8), drag: 0.8, color: col, alpha: o.mistAlpha ?? 0.2,
          });
        }
      }
      k -= 1;
    }
  }
  // fumerolles (acide) / chaleur (lave) : bouffées qui montent
  fume(x, y, z, color, alpha = 0.25, size = 1.2) {
    this.mist.emit(x, y, z, (Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.6, (Math.random() - 0.5) * 0.4, {
      life: 2.5 + Math.random() * 1.5, size, size1: size * 3, drag: 0.4, color: _c.set(color), alpha,
    });
  }
  ember(x, y, z, color, force = 1) {
    this.embers.emit(x, y, z, (Math.random() - 0.5) * 2 * force, (2 + Math.random() * 4) * force, (Math.random() - 0.5) * 2 * force, {
      life: 0.6 + Math.random() * 0.7, size: 0.08 + Math.random() * 0.06, size1: 0.02, gravity: 9, drag: 0.3, color: _c.set(color), alpha: 1, floor: y - 0.1,
    });
  }
  update(dt) {
    this.drops.update(dt, this.onLand);
    this.mist.update(dt);
    this.embers.update(dt);
  }
  clear() { this.drops.clear(); this.mist.clear(); this.embers.clear(); }
}
