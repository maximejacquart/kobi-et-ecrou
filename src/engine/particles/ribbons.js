// Traînées en rubans (projectiles, roquettes, esquive) : chaque ruban garde ses derniers points dans un anneau,
// élargis face caméra dans le shader. Tous les rubans tiennent dans un seul maillage (un appel de dessin) ;
// les emplacements libres et les points inutilisés sont réduits à des triangles vides.
import * as THREE from 'three';
import { LAYERS } from '../frame.js';
import { fxUniforms, FX_PARS, FX_VERT, FX_FRAG } from './shared.js';

const VERT = /* glsl */ `
${FX_PARS}
${FX_VERT}
attribute vec3 aDir;
attribute vec4 aInfo;   // côté (±1), âge (0..1), largeur, abscisse (0 = tête)
attribute vec4 aCol;
varying vec4 vCol;
varying vec3 vInfo;
varying float vViewZ;
void main() {
  vec3 toCam = normalize(cameraPosition - position);
  vec3 side = cross(aDir, toCam);
  float l = length(side);
  side = l > 1e-4 ? side / l : vec3(0.0, 1.0, 0.0);
  float age = aInfo.y;
  float w = aInfo.z * pow(1.0 - age, 0.7) * smoothstep(0.0, 0.08, aInfo.w + 0.02);
  vec3 wp = position + side * aInfo.x * w;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vec3 fcol;
  float fog = fxFog(position, fcol);
  vCol = vec4(aCol.rgb * (1.0 - fog), aCol.a * pow(1.0 - age, 1.6));
  vInfo = vec3(aInfo.x, aInfo.w, age);
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
${FX_PARS}
${FX_FRAG}
varying vec4 vCol;
varying vec3 vInfo;
varying float vViewZ;
void main() {
  float x = vInfo.x;
  // bord doux, cœur blanc chaud, pulsation qui défile le long du ruban
  float prof = exp(-x * x * 2.5) * (1.0 - x * x);
  float core = exp(-x * x * 18.0);
  float flick = 0.82 + 0.18 * sin(vInfo.y * 40.0 - uFxTime * 50.0);
  float a = vCol.a * prof * flick * fxSoft(vViewZ, 0.25) * smoothstep(0.2, 0.8, vViewZ);
  if (a < 0.002) discard;
  vec3 col = vCol.rgb * (1.0 + core * 1.6 * (1.0 - vInfo.z));
  gl_FragColor = vec4(col * a, 0.0);
}`;

export class RibbonSystem {
  constructor(scene, slots = 64, pts = 32) {
    this.S = slots;
    this.P = pts;
    const nv = slots * pts * 2;
    const geo = new THREE.BufferGeometry();
    const mk = (k) => new THREE.BufferAttribute(new Float32Array(nv * k), k).setUsage(THREE.DynamicDrawUsage);
    this.aPos = mk(3); this.aDir = mk(3); this.aInfo = mk(4); this.aCol = mk(4);
    this._attrs = [this.aPos, this.aDir, this.aInfo, this.aCol];
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aDir', this.aDir);
    geo.setAttribute('aInfo', this.aInfo);
    geo.setAttribute('aCol', this.aCol);
    const idx = new Uint32Array(slots * (pts - 1) * 6);
    let k = 0;
    for (let s = 0; s < slots; s++) {
      for (let i = 0; i < pts - 1; i++) {
        const a = (s * pts + i) * 2;
        idx[k++] = a; idx[k++] = a + 1; idx[k++] = a + 2;
        idx[k++] = a + 1; idx[k++] = a + 3; idx[k++] = a + 2;
      }
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    // côtés fixes : sommet pair à gauche, impair à droite
    const info = this.aInfo.array;
    for (let v = 0; v < nv; v++) info[v * 4] = v % 2 ? 1 : -1;
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      uniforms: fxUniforms(),
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    this.mesh.layers.set(LAYERS.FX);
    scene.add(this.mesh);
    // état des emplacements
    this.slot = [];
    for (let s = 0; s < slots; s++) {
      this.slot.push({
        on: false, ended: false, gen: 0, n: 0, h: 0, life: 0.3, width: 0.2, minSeg: 0.4, alpha: 1,
        color: new THREE.Color(), x: new Float32Array(pts), y: new Float32Array(pts), z: new Float32Array(pts), t: new Float32Array(pts),
        smoke: null, smokeAcc: 0,
      });
    }
    this.now = 0;
    this.onSmoke = null;
    this._sent = 0;
  }
  // o : color (THREE.Color, HDR), width, life (durée de vie d'un point), minSeg, alpha, smoke { every, … } (relayé à onSmoke)
  start(o) {
    let best = -1;
    for (let s = 0; s < this.S; s++) if (!this.slot[s].on) { best = s; break; }
    if (best < 0) {
      // plein : on recycle le ruban terminé le plus ancien
      for (let s = 0; s < this.S; s++) if (this.slot[s].ended) { best = s; break; }
      if (best < 0) return null;
    }
    const r = this.slot[best];
    r.on = true; r.ended = false; r.gen++; r.n = 0; r.h = 0;
    r.color.copy(o.color);
    r.width = o.width ?? 0.2; r.life = o.life ?? 0.3; r.minSeg = o.minSeg ?? 0.35; r.alpha = o.alpha ?? 1;
    r.smoke = o.smoke || null; r.smokeAcc = 0;
    return { s: best, g: r.gen };
  }
  _get(hd) {
    if (!hd) return null;
    const r = this.slot[hd.s];
    return r.on && r.gen === hd.g ? r : null;
  }
  push(hd, p) {
    const r = this._get(hd);
    if (!r || r.ended) return;
    const P = this.P, now = this.now;
    let ins = r.n < 2;
    if (!ins) {
      const j = (r.h + 1) % P;
      const dx = p.x - r.x[j], dy = p.y - r.y[j], dz = p.z - r.z[j];
      const d2 = dx * dx + dy * dy + dz * dz;
      ins = d2 > r.minSeg * r.minSeg;
      if (ins && r.smoke && this.onSmoke) {
        r.smokeAcc += Math.sqrt(d2);
        if (r.smokeAcc >= r.smoke.every) { r.smokeAcc = 0; this.onSmoke(r.x[j], r.y[j], r.z[j], r.smoke); }
      }
    }
    if (ins) {
      r.h = (r.h - 1 + P) % P;
      r.n = Math.min(r.n + 1, P);
    }
    r.x[r.h] = p.x; r.y[r.h] = p.y; r.z[r.h] = p.z; r.t[r.h] = now;
  }
  end(hd) {
    const r = this._get(hd);
    if (r) r.ended = true;
  }
  clear() {
    for (const r of this.slot) { r.on = false; r.n = 0; }
    this.geo.setDrawRange(0, 0);
  }
  update(dt) {
    this.now += dt;
    const P = this.P, now = this.now;
    const pos = this.aPos.array, dir = this.aDir.array, info = this.aInfo.array, col = this.aCol.array;
    let top = -1;
    for (let s = 0; s < this.S; s++) {
      const r = this.slot[s];
      if (!r.on) continue;
      // les points trop vieux quittent la queue
      while (r.n > 0 && now - r.t[(r.h + r.n - 1) % P] > r.life) r.n--;
      if (r.ended && r.n === 0) { r.on = false; }
      top = s;
      const base = s * P * 2;
      // longueur totale (abscisse normalisée)
      let total = 0;
      for (let k = 0; k < r.n - 1; k++) {
        const a = (r.h + k) % P, b = (r.h + k + 1) % P;
        total += Math.hypot(r.x[a] - r.x[b], r.y[a] - r.y[b], r.z[a] - r.z[b]);
      }
      let acc = 0, px = 0, py = 0, pz = 0;
      for (let k = 0; k < P; k++) {
        const live = k < r.n && r.n > 1;
        const kk = live ? k : Math.max(0, r.n - 1);
        const a = (r.h + kk) % P;
        // tangente orientée vers la tête
        let tx = 0, ty = 0, tz = 1;
        if (kk < r.n - 1) {
          const b = (r.h + kk + 1) % P;
          tx = r.x[a] - r.x[b]; ty = r.y[a] - r.y[b]; tz = r.z[a] - r.z[b];
        } else if (kk > 0) {
          const b = (r.h + kk - 1) % P;
          tx = r.x[b] - r.x[a]; ty = r.y[b] - r.y[a]; tz = r.z[b] - r.z[a];
        }
        const tl = Math.hypot(tx, ty, tz) || 1;
        if (live && k > 0) acc += Math.hypot(r.x[a] - px, r.y[a] - py, r.z[a] - pz);
        px = r.x[a]; py = r.y[a]; pz = r.z[a];
        const age = live ? Math.min(1, (now - r.t[a]) / r.life) : 1;
        const w = live ? r.width : 0, al = live ? r.alpha : 0, u = total > 0 ? acc / total : 0;
        for (let sd = 0; sd < 2; sd++) {
          const v = base + k * 2 + sd, v3 = v * 3, v4 = v * 4;
          pos[v3] = px; pos[v3 + 1] = py; pos[v3 + 2] = pz;
          dir[v3] = tx / tl; dir[v3 + 1] = ty / tl; dir[v3 + 2] = tz / tl;
          info[v4 + 1] = age; info[v4 + 2] = w; info[v4 + 3] = u;
          col[v4] = r.color.r; col[v4 + 1] = r.color.g; col[v4 + 2] = r.color.b; col[v4 + 3] = al;
        }
      }
    }
    const used = (top + 1) * P * 2;
    this.geo.setDrawRange(0, (top + 1) * (P - 1) * 6);
    if (used || this._sent) {
      const n = Math.max(used, this._sent);
      for (const a of this._attrs) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, Math.max(1, n) * a.itemSize);
        a.needsUpdate = true;
      }
    }
    this._sent = used;
  }
}
