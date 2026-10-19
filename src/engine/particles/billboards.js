// Particules en quadrilatères instanciés (un seul appel de dessin par système), simulées sur le processeur sans
// allocation : tableaux fixes, retrait par échange avec la dernière, envoi au GPU des seules particules vivantes.
//  - GlowSystem  : lumière pure (additive, sans tri) — étincelles étirées par la vitesse, braises, éclairs, étoiles
//  - SmokeSystem : matière (alpha prémultiplié, triée de l'arrière vers l'avant, éclairée) — fumées à relief,
//                  boules de feu qui refroidissent en fumée, poussières, gravillons, gouttes
// Toutes deux : couche FX, adoucies au contact du décor (profondeur de l'image opaque), brouillard de la planète.
import * as THREE from 'three';
import { LAYERS } from '../frame.js';
import { fxUniforms, FX_PARS, FX_VERT, FX_FRAG } from './shared.js';

// formes lumineuses
export const GLOW = { SOFT: 0, STAR: 1, STREAK: 2, RING: 3, FLARE: 4, EMBER: 5 };
// genres de matière
export const MATTER = { SMOKE: 0, BLOB: 1, CHIP: 2, DROP: 3, FLAKE: 4 };

function quadGeometry(max, attrs) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const out = {};
  for (const k of attrs) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute(k, a);
    out[k] = a;
  }
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  return { geo: g, attrs: out };
}

// Sommet commun : quadrilatère face caméra, tourné, ou étiré selon la vitesse vue à l'écran
const BILLBOARD = /* glsl */ `
vec4 fxBillboard(vec3 wp, float size, vec4 vel, float rot, out vec2 corner, out float stretchLen) {
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  corner = position.xy;
  stretchLen = 0.0;
  if (vel.w > 0.0) {
    vec2 v2 = (mat3(viewMatrix) * vel.xyz).xy;
    float l = length(v2);
    vec2 ax = l > 1e-4 ? v2 / l : vec2(1.0, 0.0);
    stretchLen = min(l * vel.w, size * 40.0);
    vec2 pp = vec2(-ax.y, ax.x);
    mv.xy += ax * (corner.x * (size + stretchLen * 0.5) - stretchLen * 0.5) + pp * corner.y * size;
  } else {
    float c = cos(rot), s = sin(rot);
    mv.xy += vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * size;
  }
  return mv;
}
`;

class Base {
  constructor(max, attrs) {
    this.max = max;
    this.n = 0;
    const { geo, attrs: a } = quadGeometry(max, attrs);
    this.geo = geo;
    this.attrs = a;
    this._sent = 0;
  }
  _upload(count) {
    this.geo.instanceCount = count;
    if (!count && !this._sent) return;
    for (const k in this.attrs) {
      const a = this.attrs[k];
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(1, count) * 4);
      a.needsUpdate = true;
    }
    this._sent = count;
  }
  _mesh(mat, order) {
    const m = new THREE.Mesh(this.geo, mat);
    m.frustumCulled = false;
    m.renderOrder = order;
    m.layers.set(LAYERS.FX);
    this.mesh = m;
    return m;
  }
  clear() { this.n = 0; this._upload(0); }
}

// ---------------------------------------------------------------------------------------------- lumière
const GLOW_VERT = /* glsl */ `
${FX_PARS}
${FX_VERT}
${BILLBOARD}
attribute vec4 iA, iB, iC, iD;
varying vec2 vC;
varying vec4 vCol;
varying vec3 vInfo;
varying float vViewZ, vSoft, vLen;
void main() {
  vec2 corner; float sl;
  vec4 mv = fxBillboard(iA.xyz, iA.w, iB, iD.y, corner, sl);
  vC = corner;
  vLen = sl / max(iA.w, 1e-3);
  vec3 fcol;
  float fog = fxFog(iA.xyz, fcol);
  vCol = vec4(iC.rgb * (1.0 - fog), iC.a);
  vInfo = vec3(iD.x, iD.w, iD.z);
  vViewZ = -mv.z;
  vSoft = max(0.08, iA.w * 0.8);
  gl_Position = projectionMatrix * mv;
}`;
const GLOW_FRAG = /* glsl */ `
${FX_PARS}
${FX_FRAG}
varying vec2 vC;
varying vec4 vCol;
varying vec3 vInfo;
varying float vViewZ, vSoft, vLen;
void main() {
  vec2 c = vC;
  float r2 = dot(c, c);
  int shape = int(vInfo.x + 0.5);
  float a;
  if (shape == 0) a = exp(-r2 * 5.0) * (1.0 - min(r2, 1.0));
  else if (shape == 1) {
    // étoile à quatre branches et cœur net
    float rays = exp(-abs(c.y) * 30.0) * (1.0 - abs(c.x)) + exp(-abs(c.x) * 30.0) * (1.0 - abs(c.y));
    a = exp(-r2 * 14.0) * 1.4 + rays * 0.9 + exp(-r2 * 4.0) * 0.25;
  } else if (shape == 2) {
    // trait d'étincelle : tête vive, queue qui s'efface
    float along = c.x * 0.5 + 0.5;
    a = exp(-c.y * c.y * 4.0) * smoothstep(1.0, 0.75, abs(c.x)) * mix(0.25, 1.0, along * along);
    a *= 1.0 - min(r2, 1.0) * step(vLen, 0.2);
  } else if (shape == 3) {
    float r = sqrt(r2);
    a = exp(-pow((r - 0.82) / 0.045, 2.0)) + exp(-pow((r - 0.8) / 0.2, 2.0)) * 0.15;
  } else if (shape == 4) {
    a = exp(-r2 * 3.5) * 0.55 + exp(-r2 * 26.0) * 2.2 + exp(-c.y * c.y * 260.0) * (1.0 - abs(c.x)) * 0.5;
  } else {
    a = exp(-r2 * 7.0) * (0.75 + 0.25 * sin(uFxTime * 23.0 + vInfo.y * 60.0)) + exp(-r2 * 30.0) * 0.6;
  }
  a *= vCol.a * fxSoft(vViewZ, vSoft) * smoothstep(0.25, 0.9, vViewZ);
  if (a < 0.002) discard;
  gl_FragColor = vec4(vCol.rgb * a, 0.0);
}`;

export class GlowSystem extends Base {
  constructor(scene, max) {
    super(max, ['iA', 'iB', 'iC', 'iD']);
    const mat = new THREE.ShaderMaterial({
      uniforms: fxUniforms(),
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    this.mat = mat;
    scene.add(this._mesh(mat, 12));
    const F = (k = 1) => new Float32Array(max * k);
    this.p = F(3); this.v = F(3); this.c0 = F(3); this.c1 = F(3);
    this.life = F(); this.maxLife = F(); this.s0 = F(); this.s1 = F(); this.a0 = F(); this.drag = F(); this.grav = F();
    this.rot = F(); this.spin = F(); this.shape = F(); this.stretch = F(); this.floor = F(); this.bounce = F(); this.seed = F(); this.turb = F();
    this._scal = [this.life, this.maxLife, this.s0, this.s1, this.a0, this.drag, this.grav, this.rot, this.spin, this.shape, this.stretch, this.floor, this.bounce, this.seed, this.turb];
  }
  // o : life, size, size1, color (THREE.Color, HDR), color1, alpha, drag, gravity, shape, rot, spin, stretch (s), floor, bounce, turb
  emit(x, y, z, vx, vy, vz, o) {
    if (this.n >= this.max) return -1;
    const i = this.n++, i3 = i * 3;
    this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z;
    this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
    const c = o.color, c1 = o.color1 || c;
    this.c0[i3] = c.r; this.c0[i3 + 1] = c.g; this.c0[i3 + 2] = c.b;
    this.c1[i3] = c1.r; this.c1[i3 + 1] = c1.g; this.c1[i3 + 2] = c1.b;
    this.life[i] = 0; this.maxLife[i] = o.life;
    this.s0[i] = o.size; this.s1[i] = o.size1 ?? o.size;
    this.a0[i] = o.alpha ?? 1;
    this.drag[i] = o.drag ?? 0; this.grav[i] = o.gravity ?? 0;
    this.rot[i] = o.rot ?? Math.random() * 6.283; this.spin[i] = o.spin ?? 0;
    this.shape[i] = o.shape ?? 0; this.stretch[i] = o.stretch ?? 0;
    this.floor[i] = o.floor ?? -1e9; this.bounce[i] = o.bounce ?? 0.35;
    this.seed[i] = Math.random(); this.turb[i] = o.turb ?? 0;
    return i;
  }
  update(dt, time) {
    const { p, v } = this;
    let i = 0;
    while (i < this.n) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) { this._kill(i); continue; }
      const i3 = i * 3;
      const d = Math.exp(-this.drag[i] * dt);
      v[i3] *= d; v[i3 + 1] = v[i3 + 1] * d - this.grav[i] * dt; v[i3 + 2] *= d;
      const tb = this.turb[i];
      if (tb) {
        const s = this.seed[i] * 40;
        v[i3] += Math.sin(p[i3 + 1] * 1.7 + time * 2.3 + s) * tb * dt;
        v[i3 + 1] += Math.sin(p[i3 + 2] * 1.3 + time * 1.9 + s) * tb * dt * 0.6;
        v[i3 + 2] += Math.sin(p[i3] * 1.5 + time * 2.1 + s) * tb * dt;
      }
      p[i3] += v[i3] * dt; p[i3 + 1] += v[i3 + 1] * dt; p[i3 + 2] += v[i3 + 2] * dt;
      if (p[i3 + 1] < this.floor[i]) {
        // rebond au sol : l'étincelle ricoche, perd sa vitesse, puis s'arrête
        p[i3 + 1] = this.floor[i];
        const b = this.bounce[i];
        v[i3 + 1] = Math.abs(v[i3 + 1]) * b;
        v[i3] *= 0.55; v[i3 + 2] *= 0.55;
        if (v[i3 + 1] < 0.6) { v[i3 + 1] = 0; this.grav[i] = 0; this.drag[i] = Math.max(this.drag[i], 6); }
      }
      this.rot[i] += this.spin[i] * dt;
      i++;
    }
    this._write();
  }
  _write() {
    const { iA, iB, iC, iD } = this.attrs;
    const A = iA.array, B = iB.array, C = iC.array, D = iD.array;
    const { p, v } = this;
    for (let i = 0; i < this.n; i++) {
      const i3 = i * 3, i4 = i * 4;
      const t = this.life[i] / this.maxLife[i];
      A[i4] = p[i3]; A[i4 + 1] = p[i3 + 1]; A[i4 + 2] = p[i3 + 2];
      A[i4 + 3] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      B[i4] = v[i3]; B[i4 + 1] = v[i3 + 1]; B[i4 + 2] = v[i3 + 2]; B[i4 + 3] = this.stretch[i];
      C[i4] = this.c0[i3] + (this.c1[i3] - this.c0[i3]) * t;
      C[i4 + 1] = this.c0[i3 + 1] + (this.c1[i3 + 1] - this.c0[i3 + 1]) * t;
      C[i4 + 2] = this.c0[i3 + 2] + (this.c1[i3 + 2] - this.c0[i3 + 2]) * t;
      C[i4 + 3] = this.a0[i] * Math.min(1, t * 14) * (1 - t * t);
      D[i4] = this.shape[i]; D[i4 + 1] = this.rot[i]; D[i4 + 2] = t; D[i4 + 3] = this.seed[i];
    }
    this._upload(this.n);
  }
  _kill(i) {
    const j = --this.n;
    if (i === j) return;
    const i3 = i * 3, j3 = j * 3;
    for (let k = 0; k < 3; k++) {
      this.p[i3 + k] = this.p[j3 + k]; this.v[i3 + k] = this.v[j3 + k];
      this.c0[i3 + k] = this.c0[j3 + k]; this.c1[i3 + k] = this.c1[j3 + k];
    }
    for (const a of this._scal) a[i] = a[j];
  }
}

// ---------------------------------------------------------------------------------------------- matière
const SMOKE_VERT = /* glsl */ `
${FX_PARS}
${FX_VERT}
${BILLBOARD}
attribute vec4 iA, iB, iC, iD, iE;
varying vec2 vC;
varying vec4 vAlb;
varying vec4 vInfo;   // genre, variante, chaleur, âge
varying vec4 vEmis;
varying vec3 vLt, vUt, vSun, vAmbFlash;
varying float vViewZ, vSoft, vScatter, vFog, vLen;
varying vec3 vFogCol;
void main() {
  vec2 corner; float sl;
  float rot = iD.y;
  float kind = floor(iD.x / 16.0);
  // fumée : le dessin n'occupe que le disque central de sa tuile, le quadrilatère est resserré d'autant
  float qs = kind < 0.5 ? iA.w * 0.64 : iA.w;
  vec4 mv = fxBillboard(iA.xyz, qs, iB, rot, corner, sl);
  vC = corner;
  vLen = sl / max(qs, 1e-3);
  vInfo = vec4(kind, iD.x - kind * 16.0, iD.z, iD.w);
  // repère de la texture dans le monde (droite, haut tournés ; avant = vers la caméra)
  vec3 R = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 U = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 F = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  if (iB.w <= 0.0) {
    float c = cos(rot), s = sin(rot);
    vec3 R2 = c * R + s * U;
    U = -s * R + c * U;
    R = R2;
  }
  vLt = vec3(dot(uSunDir, R), dot(uSunDir, U), dot(uSunDir, F));
  vUt = vec3(R.y, U.y, F.y);
  vec3 alb = iC.rgb;
  if (kind < 0.5) alb = mix(alb, uFxTint * dot(alb, vec3(0.33)) * 1.6, 0.22);
  vAlb = vec4(alb, iC.a);
  vEmis = iE;
  vSun = uSunColor * fxSunShadow(iA.xyz, iA.w);
  vAmbFlash = fxFlashLight(iA.xyz);
  vec3 toP = normalize(iA.xyz - cameraPosition);
  vScatter = pow(max(dot(toP, uSunDir), 0.0), 5.0);
  vFog = fxFog(iA.xyz, vFogCol);
  vViewZ = -mv.z;
  vSoft = max(0.1, iA.w * (kind < 0.5 ? 0.7 : 0.4));
  gl_Position = projectionMatrix * mv;
  // contre la caméra : entièrement fondue, inutile de la dessiner
  if (vViewZ < 0.32) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const SMOKE_FRAG = /* glsl */ `
${FX_PARS}
${FX_FRAG}
uniform sampler2D tSmoke;
varying vec2 vC;
varying vec4 vAlb, vInfo, vEmis;
varying vec3 vLt, vUt, vSun, vAmbFlash;
varying float vViewZ, vSoft, vScatter, vFog, vLen;
varying vec3 vFogCol;
// rampe de flamme : rouge sombre → orange → jaune → cœur presque blanc, teintée par la couleur de l'explosion
// (entièrement pour les énergies froides, en partie pour les feux) ; valeurs modérées : le halo amplifie le reste
vec3 fxFire(float h, vec3 tint) {
  h = clamp(h, 0.0, 1.2);
  vec3 c = mix(vec3(0.0), vec3(0.32, 0.05, 0.01), smoothstep(0.0, 0.2, h));
  c = mix(c, vec3(0.95, 0.36, 0.06), smoothstep(0.15, 0.5, h));
  c = mix(c, vec3(1.15, 0.72, 0.2), smoothstep(0.5, 0.9, h));
  c = mix(c, vec3(1.3, 1.08, 0.62), smoothstep(1.0, 1.2, h));
  float k = clamp((tint.b - tint.g * 0.5) * 2.0, 0.3, 1.0);
  vec3 t = tint * (0.2 + h * 1.05) + vec3(0.4, 0.4, 0.4) * smoothstep(0.9, 1.15, h);
  return mix(c, t, k);
}
vec2 fxTileUV(vec2 uv, float variant) {
  vec2 t = vec2(mod(variant, 4.0), floor(variant / 4.0));
  return (t + clamp(uv, 0.004, 0.996)) * vec2(0.25, 0.5);
}
void main() {
  vec2 c = vC;
  float r2 = dot(c, c);
  int kind = int(vInfo.x + 0.5);
  float age = vInfo.w;
  vec3 n;
  float dens;
  float detail = 0.5;
  if (kind == 0) {
    vec2 uv = c * 0.32 + 0.5;
    vec4 tx = texture2D(tSmoke, fxTileUV(uv, vInfo.y));
    // dissipation : la bouffée s'effiloche par ses zones fines en vieillissant
    float thr = age * age * 0.55;
    dens = smoothstep(thr, thr + 0.3, tx.a * (0.7 + tx.b * 0.6)) * tx.a;
    n = vec3(tx.rg * 2.0 - 1.0, 0.0);
    n.z = sqrt(max(0.0, 1.0 - dot(n.xy, n.xy)));
    detail = tx.b;
  } else if (kind == 2) {
    // gravillon / éclat : bord net irrégulier, relief en dôme
    float ang = atan(c.y, c.x);
    float rr = sqrt(r2) * (1.0 + 0.18 * sin(ang * 5.0 + vInfo.y * 3.0));
    dens = smoothstep(1.0, 0.8, rr);
    n = normalize(vec3(c * 0.9, sqrt(max(0.05, 1.0 - r2))));
  } else if (kind == 3) {
    // goutte étirée par sa vitesse
    dens = exp(-c.y * c.y * 3.5) * smoothstep(1.0, 0.5, abs(c.x)) * mix(0.55, 1.0, c.x * 0.5 + 0.5);
    n = normalize(vec3(0.0, c.y * 0.9, 0.6));
  } else if (kind == 4) {
    // flocon : disque doux à cœur dense
    dens = smoothstep(1.0, 0.25, sqrt(r2));
    n = normalize(vec3(c * 0.5, 1.0));
  } else {
    // nappe douce (vapeur, spores, souffle)
    dens = pow(max(0.0, 1.0 - r2), 1.6);
    n = normalize(vec3(c * 0.75, sqrt(max(0.0, 1.0 - r2 * 0.56))));
  }
  // une flamme vive masque peu ce qui est derrière : elle éclaire plus qu'elle ne couvre
  float a = dens * vAlb.a * mix(1.0, 0.8, vInfo.z);
  if (a < 0.003 && vInfo.z < 0.01) discard;
  // éclairage : soleil (enveloppé, auto-ombrage), diffusion vers l'avant à contre-jour, ciel/sol, flashs
  float ndl = dot(n, vLt);
  float diff = clamp(ndl * 0.75 + 0.25, 0.0, 1.0);
#if FX_LIGHT >= 2
  if (kind == 0) {
    vec2 ld = vLt.xy * 0.12;
    vec2 uv = c * 0.32 + 0.5;
    float occ = texture2D(tSmoke, fxTileUV(uv + ld, vInfo.y)).a + texture2D(tSmoke, fxTileUV(uv + ld * 2.2, vInfo.y)).a * 0.7;
    diff *= mix(1.0, exp(-occ * 1.5), 0.8);
  }
#endif
  float trans = vScatter * (1.0 - dens * 0.7) * 1.4;
  // ciel et sol, plus la lumière renvoyée par le décor de la planète (teinte de poussière)
  vec3 hemi = mix(uFxHemiGround, uFxHemiSky, clamp(dot(n, vUt) * 0.5 + 0.5, 0.0, 1.0));
  vec3 amb = (hemi * 0.65 + uFxTint * dot(uFxHemiSky, vec3(0.3, 0.55, 0.15)) * 0.9) * (0.6 + 0.45 * dens);
  vec3 col = vAlb.rgb * (vSun * (diff + trans) + amb + vAmbFlash);
  if (kind == 3) col += vSun * pow(max(dot(normalize(vLt + vec3(0.0, 0.0, 1.0)), n), 0.0), 24.0) * 2.0;
  // chaleur : flamme dans les zones denses, qui recule en refroidissant
  // (fumée : seule sa chaleur la fait briller ; autres genres : lueur propre constante)
  vec3 emis = vec3(0.0);
  if (kind == 0) {
    if (vInfo.z > 0.001) {
      float h = vInfo.z * (0.2 + 0.8 * dens) + (detail - 0.5) * 0.3;
      emis = fxFire(h, vEmis.rgb) * vEmis.w * smoothstep(0.0, 0.08, dens);
    }
  } else emis = vEmis.rgb * vEmis.w * dens;
  float soft = fxSoft(vViewZ, vSoft) * clamp((vViewZ - 0.3) / max(0.4, vSoft * 1.6), 0.0, 1.0);
  a *= soft;
  emis *= soft * (1.0 - vFog);
  col = mix(col, vFogCol, vFog);
  gl_FragColor = vec4(col * a + emis * vAlb.a, a);
}`;

export class SmokeSystem extends Base {
  constructor(scene, max, smokeTex, light = 2) {
    super(max, ['iA', 'iB', 'iC', 'iD', 'iE']);
    const mat = new THREE.ShaderMaterial({
      uniforms: fxUniforms({ tSmoke: { value: smokeTex } }),
      defines: { FX_LIGHT: light },
      vertexShader: SMOKE_VERT,
      fragmentShader: SMOKE_FRAG,
      transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mat = mat;
    scene.add(this._mesh(mat, 10));
    const F = (k = 1) => new Float32Array(max * k);
    this.p = F(3); this.v = F(3); this.c0 = F(3); this.c1 = F(3); this.tint = F(3);
    this.life = F(); this.maxLife = F(); this.s0 = F(); this.s1 = F(); this.a0 = F(); this.drag = F(); this.grav = F();
    this.rot = F(); this.spin = F(); this.kind = F(); this.stretch = F(); this.floor = F(); this.seed = F(); this.turb = F();
    this.heat = F(); this.heatT = F(); this.emis = F(); this.fadeIn = F(); this.fadeOut = F(); this.grow = F();
    this._scal = [this.life, this.maxLife, this.s0, this.s1, this.a0, this.drag, this.grav, this.rot, this.spin, this.kind, this.stretch,
      this.floor, this.seed, this.turb, this.heat, this.heatT, this.emis, this.fadeIn, this.fadeOut, this.grow];
    // tri : clé = profondeur quantifiée (20 bits, du plus loin au plus proche) puis indice (12 bits)
    this.keys = new Uint32Array(4096);
    this.keys.fill(0xffffffff);
    this._lastN = 0;
  }
  setLight(level) {
    if (this.mat.defines.FX_LIGHT !== level) { this.mat.defines.FX_LIGHT = level; this.mat.needsUpdate = true; }
  }
  // o : life, size, size1, color, color1, alpha, drag, gravity, kind, variant, rot, spin, stretch, floor, turb,
  //     heat (0..1), heatTime (s), tint (couleur de la flamme ou de la lueur), emissive, fadeIn, fadeOut, grow
  emit(x, y, z, vx, vy, vz, o) {
    if (this.n >= this.max) return -1;
    const i = this.n++, i3 = i * 3;
    this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z;
    this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
    const c = o.color, c1 = o.color1 || c, tn = o.tint || c;
    this.c0[i3] = c.r; this.c0[i3 + 1] = c.g; this.c0[i3 + 2] = c.b;
    this.c1[i3] = c1.r; this.c1[i3 + 1] = c1.g; this.c1[i3 + 2] = c1.b;
    this.tint[i3] = tn.r; this.tint[i3 + 1] = tn.g; this.tint[i3 + 2] = tn.b;
    this.life[i] = 0; this.maxLife[i] = o.life;
    this.s0[i] = o.size; this.s1[i] = o.size1 ?? o.size;
    this.a0[i] = o.alpha ?? 1;
    this.drag[i] = o.drag ?? 0; this.grav[i] = o.gravity ?? 0;
    this.rot[i] = o.rot ?? Math.random() * 6.283; this.spin[i] = o.spin ?? 0;
    const kind = o.kind ?? 0;
    this.kind[i] = kind * 16 + (o.variant ?? (kind === 0 ? Math.floor(Math.random() * 6) : Math.floor(Math.random() * 8)));
    this.stretch[i] = o.stretch ?? 0;
    this.floor[i] = o.floor ?? -1e9;
    this.seed[i] = Math.random(); this.turb[i] = o.turb ?? 0;
    this.heat[i] = o.heat ?? 0; this.heatT[i] = o.heatTime ?? 0.5; this.emis[i] = o.emissive ?? (o.heat ? 1 : 0);
    this.fadeIn[i] = o.fadeIn ?? 0.08; this.fadeOut[i] = o.fadeOut ?? 0.45; this.grow[i] = o.grow ?? 2.2;
    return i;
  }
  update(dt, time) {
    const { p, v } = this;
    let i = 0;
    while (i < this.n) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) { this._kill(i); continue; }
      const i3 = i * 3;
      const d = Math.exp(-this.drag[i] * dt);
      v[i3] *= d; v[i3 + 1] = v[i3 + 1] * d - this.grav[i] * dt; v[i3 + 2] *= d;
      const tb = this.turb[i];
      if (tb) {
        // remous : champ de sinus croisés, différent pour chaque bouffée
        const s = this.seed[i] * 40;
        v[i3] += Math.sin(p[i3 + 1] * 0.9 + time * 0.8 + s) * tb * dt;
        v[i3 + 1] += Math.sin(p[i3 + 2] * 0.7 + time * 0.6 + s) * tb * dt * 0.4;
        v[i3 + 2] += Math.sin(p[i3] * 0.8 + time * 0.7 + s * 1.3) * tb * dt;
      }
      p[i3] += v[i3] * dt; p[i3 + 1] += v[i3 + 1] * dt; p[i3 + 2] += v[i3 + 2] * dt;
      if (p[i3 + 1] < this.floor[i]) {
        p[i3 + 1] = this.floor[i];
        v[i3 + 1] = Math.abs(v[i3 + 1]) * 0.25;
        v[i3] *= 0.5; v[i3 + 2] *= 0.5;
        if (v[i3 + 1] < 0.8) { v[i3 + 1] = 0; this.grav[i] = 0; this.drag[i] = Math.max(this.drag[i], 8); this.spin[i] = 0; }
      }
      this.rot[i] += this.spin[i] * dt;
      i++;
    }
  }
  // tri et envoi, juste avant le rendu (caméra à jour)
  write(camera) {
    const n = this.n;
    const keys = this.keys;
    const e = camera.matrixWorld.elements;
    const cx = e[12], cy = e[13], cz = e[14], fx = -e[8], fy = -e[9], fz = -e[10];
    const { p } = this;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      const dz = (p[i3] - cx) * fx + (p[i3 + 1] - cy) * fy + (p[i3 + 2] - cz) * fz;
      const q = Math.min(1048575, Math.max(0, Math.round(dz * 600)));
      keys[i] = (((1048575 - q) << 12) | i) >>> 0;
    }
    for (let i = n; i < this._lastN; i++) keys[i] = 0xffffffff;
    this._lastN = n;
    keys.sort();
    const { iA, iB, iC, iD, iE } = this.attrs;
    const A = iA.array, B = iB.array, C = iC.array, D = iD.array, E = iE.array;
    for (let k = 0; k < n; k++) {
      const i = keys[k] & 4095;
      const i3 = i * 3, k4 = k * 4;
      const t = this.life[i] / this.maxLife[i];
      const g = 1 - Math.pow(1 - t, this.grow[i]);
      A[k4] = p[i3]; A[k4 + 1] = p[i3 + 1]; A[k4 + 2] = p[i3 + 2];
      A[k4 + 3] = this.s0[i] + (this.s1[i] - this.s0[i]) * g;
      B[k4] = this.v[i3]; B[k4 + 1] = this.v[i3 + 1]; B[k4 + 2] = this.v[i3 + 2]; B[k4 + 3] = this.stretch[i];
      C[k4] = this.c0[i3] + (this.c1[i3] - this.c0[i3]) * t;
      C[k4 + 1] = this.c0[i3 + 1] + (this.c1[i3 + 1] - this.c0[i3 + 1]) * t;
      C[k4 + 2] = this.c0[i3 + 2] + (this.c1[i3 + 2] - this.c0[i3 + 2]) * t;
      const fo = this.fadeOut[i];
      const out = t < fo ? 1 : 1 - (t - fo) / (1 - fo);
      C[k4 + 3] = this.a0[i] * Math.min(1, t / Math.max(1e-3, this.fadeIn[i])) * out * (2 - out);
      // chaleur : palier brûlant, puis refroidissement
      const x = this.life[i] / this.heatT[i];
      const ht = this.heat[i] ? this.heat[i] * (x < 0.15 ? 1 : Math.pow(Math.max(0, 1 - (x - 0.15) / 0.85), 1.2)) : 0;
      D[k4] = this.kind[i]; D[k4 + 1] = this.rot[i]; D[k4 + 2] = ht; D[k4 + 3] = t;
      E[k4] = this.tint[i3]; E[k4 + 1] = this.tint[i3 + 1]; E[k4 + 2] = this.tint[i3 + 2]; E[k4 + 3] = this.emis[i];
    }
    this._upload(n);
  }
  _kill(i) {
    const j = --this.n;
    if (i === j) return;
    const i3 = i * 3, j3 = j * 3;
    for (let k = 0; k < 3; k++) {
      this.p[i3 + k] = this.p[j3 + k]; this.v[i3 + k] = this.v[j3 + k];
      this.c0[i3 + k] = this.c0[j3 + k]; this.c1[i3 + k] = this.c1[j3 + k]; this.tint[i3 + k] = this.tint[j3 + k];
    }
    for (const a of this._scal) a[i] = a[j];
  }
}
