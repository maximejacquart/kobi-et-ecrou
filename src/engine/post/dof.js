// Profondeur de champ à bokeh, en HDR avant le halo (les lumières floues deviennent des disques nets et brillants) :
//  1. demi-résolution : couleur + cercle de confusion (CdC) signé — négatif au premier plan, positif à l'arrière —
//     calculé depuis la profondeur de l'image opaque ; pondération anti-lucioles (Karis) ;
//  2. collecte sur un disque en anneaux (43, 22 ou 16 points selon la qualité). Premier plan et arrière-plan sont
//     séparés : le flou du premier plan déborde sur ce qui est net, l'arrière-plan ne bave pas sur le sujet.
//     Pour les grands rayons, chaque point lit un niveau de mipmap adapté à l'écart entre points (pas de motif) ;
//  3. filtre en tente, puis recomposition pleine résolution selon le CdC.
// Coût nul quand l'ouverture est nulle. Transitions douces : R.dof.set({ … }, secondes), R.dof.off(secondes),
// mise au point qui suit un point du monde : R.dof.focusOn(vecteur).
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { frameU } from '../frame.js';
import { hdrTarget, material, GLSL } from './common.js';
import { damp, smooth } from '../util.js';

// Noyau en anneaux concentriques (Unity PPv2) : 43 = 1 + 7 + 14 + 21 ; 22 = 1 + 7 + 14 ; 16 = 1 + 5 + 10
function diskKernel(n) {
  const [rings, per] = n >= 43 ? [3, 7] : n >= 22 ? [2, 7] : [2, 5];
  const pts = [[0, 0]];
  for (let i = 1; i <= rings; i++) {
    const cnt = i * per;
    for (let j = 0; j < cnt; j++) {
      const a = ((j + (i % 2) * 0.5) / cnt) * Math.PI * 2;
      pts.push([(Math.cos(a) * i) / rings, (Math.sin(a) * i) / rings]);
    }
  }
  return { pts, rings };
}

// CdC en fraction de la hauteur d'image. Zone nette : focus ± range / 2 ; au-delà, loi d'une lentille mince
// (1 − zf / z à l'arrière, zn / z − 1 à l'avant), saturée à l'ouverture
const COC = /* glsl */ `
uniform float uFocus, uRange, uNearK, uFarK, uMaxR;
float cocAt(float d) {
  float z = linZ(d, uCamNear, uCamFar);
  float zn = max(uFocus - uRange * 0.5, 0.05), zf = uFocus + uRange * 0.5;
  float far = uFarK * clamp(1.0 - zf / z, 0.0, 1.0);
  float near = uNearK * clamp(zn / z - 1.0, 0.0, 1.0);
  return (far - near) * uMaxR;
}`;

const PARAMS = ['focus', 'range', 'aperture', 'near', 'far'];

export class DofPass extends Pass {
  constructor(R) {
    super();
    this.R = R;
    this.name = 'dof';
    // passe attachée au halo : R.addPost(x, 'bloom') s'insère avant elle (le flou s'applique à tout le reste)
    this.lens = true;
    this.needsSwap = false;
    // ouverture : rayon maximal du flou, en % de la hauteur d'image ; near / far : part du flou au premier plan et
    // à l'arrière-plan (0 = net)
    this.cur = { focus: 8, range: 4, aperture: 0, near: 1, far: 1 };
    this._from = null;
    this._to = null;
    this._t = 0;
    this._dur = 0;
    this.target = null;
    // true : réglages pris en main par un autre système (mode photo), la mise en scène automatique s'efface
    this.manual = false;
    this.pre = hdrTarget({ generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.bokeh = hdrTarget();
    this.tent = hdrTarget();
    const coc = {
      uFocus: { value: 8 }, uRange: { value: 4 }, uNearK: { value: 1 }, uFarK: { value: 1 }, uMaxR: { value: 0 },
      uCamNear: frameU.uCamNear, uCamFar: frameU.uCamFar,
    };
    this.coc = coc;
    this.preMat = material({ ...coc, tColor: { value: null }, tDepth: frameU.tSceneDepth, uTexel: { value: new THREE.Vector2() } }, /* glsl */ `
      ${GLSL}
      uniform float uCamNear, uCamFar;
      ${COC}
      uniform sampler2D tColor, tDepth;
      uniform vec2 uTexel;
      varying vec2 vUv;
      void main() {
        vec2 o = uTexel * 0.5;
        vec2 u0 = vUv - o, u1 = vUv + vec2(o.x, -o.y), u2 = vUv + vec2(-o.x, o.y), u3 = vUv + o;
        vec3 c0 = texture2D(tColor, u0).rgb, c1 = texture2D(tColor, u1).rgb, c2 = texture2D(tColor, u2).rgb, c3 = texture2D(tColor, u3).rgb;
        float k0 = cocAt(texture2D(tDepth, u0).x), k1 = cocAt(texture2D(tDepth, u1).x);
        float k2 = cocAt(texture2D(tDepth, u2).x), k3 = cocAt(texture2D(tDepth, u3).x);
        // anti-lucioles adouci (les lumières gardent l'énergie de beaux disques), et un texel net ne teinte pas un
        // voisin flou
        float w0 = (abs(k0) + 1e-4) / (1.0 + max3(c0) * 0.125), w1 = (abs(k1) + 1e-4) / (1.0 + max3(c1) * 0.125);
        float w2 = (abs(k2) + 1e-4) / (1.0 + max3(c2) * 0.125), w3 = (abs(k3) + 1e-4) / (1.0 + max3(c3) * 0.125);
        vec3 c = (c0 * w0 + c1 * w1 + c2 * w2 + c3 * w3) / (w0 + w1 + w2 + w3);
        float kmin = min(min(k0, k1), min(k2, k3)), kmax = max(max(k0, k1), max(k2, k3));
        gl_FragColor = vec4(min(c, vec3(6e4)), -kmin > kmax ? kmin : kmax);
      }`);
    this.gatherU = { tPre: { value: this.pre.texture }, uTexel: { value: new THREE.Vector2() }, uAspect: { value: 1 }, uMaxR: coc.uMaxR, uLod: { value: 0 }, uBoost: { value: 0 } };
    // reflets : poids supplémentaire des points très lumineux (disques de bokeh plus francs) ; flou des mipmaps
    this.boost = 2;
    this.lodGap = 2.2;
    this.gatherMat = null;
    this.tentMat = material({ tSrc: { value: this.bokeh.texture }, uTexel: { value: new THREE.Vector2() } }, /* glsl */ `
      uniform sampler2D tSrc;
      uniform vec2 uTexel;
      varying vec2 vUv;
      void main() {
        vec4 o = uTexel.xyxy * vec4(0.5, 0.5, -0.5, 0.0);
        vec4 s = texture2D(tSrc, vUv - o.xy) + texture2D(tSrc, vUv - o.zy) + texture2D(tSrc, vUv + o.zy) + texture2D(tSrc, vUv + o.xy);
        gl_FragColor = s * 0.25;
      }`);
    this.compMat = material({ ...coc, tDiffuse: { value: null }, tDof: { value: this.tent.texture }, tDepth: frameU.tSceneDepth, uTexel: { value: new THREE.Vector2() } }, /* glsl */ `
      ${GLSL}
      uniform float uCamNear, uCamFar;
      ${COC}
      uniform sampler2D tDiffuse, tDof, tDepth;
      uniform vec2 uTexel;
      varying vec2 vUv;
      void main() {
        vec4 base = texture2D(tDiffuse, vUv);
        float k = cocAt(texture2D(tDepth, vUv).x);
        vec4 d = texture2D(tDof, vUv);
        // arrière-plan : selon le CdC du pixel ; premier plan : selon la couverture calculée à la collecte
        float ffa = smoothstep(uTexel.y * 2.0, uTexel.y * 4.0, k);
        float a = ffa + d.a - ffa * d.a;
        gl_FragColor = vec4(mix(base.rgb, d.rgb, a), base.a);
      }`);
    this.fsq = new FullScreenQuad(null);
    this._samples = 0;
    this._fwd = new THREE.Vector3();
  }

  // ---------------------------------------------------------------- API
  // o : { focus (m, ou un point du monde à suivre), range (m), aperture (% de hauteur), near, far } ; t : secondes
  set(o, t = 0.5) {
    o = { ...o };
    if (o.focus && o.focus.isVector3) { this.focusOn(o.focus); delete o.focus; }
    else if (o.focus !== undefined) this.target = null;
    // depuis un objectif fermé, la mise au point est immédiate (aucun « pompage » visible)
    if (this.cur.aperture < 0.02 && o.focus !== undefined) this.cur.focus = o.focus;
    this._from = { ...this.cur };
    this._to = { ...this.cur, ...o };
    this._t = 0;
    this._dur = Math.max(1e-3, t);
  }
  off(t = 0.5) { this.set({ aperture: 0 }, t); }
  // suit un point du monde (référence conservée : un vecteur mis à jour en continu est suivi) ; null = arrêt
  focusOn(v) {
    if (v && !this.target && this.cur.aperture < 0.02) this._snap = true;
    this.target = v || null;
  }
  get active() { return this.cur.aperture * Math.max(this.cur.near, this.cur.far) > 0.004; }

  update(dt) {
    if (this._to) {
      this._t = Math.min(1, this._t + dt / this._dur);
      const e = smooth(this._t);
      for (const k of PARAMS) this.cur[k] = this._from[k] + (this._to[k] - this._from[k]) * e;
      if (this._t >= 1) this._to = null;
    }
    if (this.target) {
      // distance le long de l'axe de visée (la profondeur que lit le shader)
      const cam = this.R.camera;
      cam.getWorldDirection(this._fwd);
      const d = Math.max(0.2, this._fwd.dot(this.target) - this._fwd.dot(cam.position));
      this.cur.focus = this._snap ? d : damp(this.cur.focus, d, 7, dt);
      this._snap = false;
    }
  }

  // ---------------------------------------------------------------- rendu
  setSize(w, h) {
    const hw = Math.max(1, Math.round(w / 2)), hh = Math.max(1, Math.round(h / 2));
    this.pre.setSize(hw, hh);
    this.bokeh.setSize(hw, hh);
    this.tent.setSize(hw, hh);
    this.preMat.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.compMat.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.gatherU.uTexel.value.set(1 / hw, 1 / hh);
    this.gatherU.uAspect.value = w / Math.max(1, h);
    this.tentMat.uniforms.uTexel.value.set(1 / hw, 1 / hh);
  }
  _gather(n) {
    if (this._samples === n && this.gatherMat) return;
    this._samples = n;
    if (this.gatherMat) this.gatherMat.dispose();
    const { pts, rings } = diskKernel(n);
    this._rings = rings;
    const arr = pts.map(([x, y]) => `vec2(${x.toFixed(6)}, ${y.toFixed(6)})`).join(', ');
    this.gatherMat = material(this.gatherU, /* glsl */ `
      #define N ${pts.length}
      const vec2 K[N] = vec2[N](${arr});
      uniform sampler2D tPre;
      uniform vec2 uTexel;
      uniform float uAspect, uMaxR, uLod, uBoost;
      varying vec2 vUv;
      void main() {
        vec4 s0 = textureLod(tPre, vUv, 0.0);
        float margin = uTexel.y * 2.0;
        vec4 bg = vec4(0.0), fg = vec4(0.0);
        float fgc = 0.0;
        for (int i = 0; i < N; i++) {
          vec2 d = K[i] * uMaxR;
          float dist = length(d);
          vec4 s = textureLod(tPre, vUv + vec2(d.x / uAspect, d.y), i == 0 ? 0.0 : uLod);
          // arrière-plan : un point ne contribue que s'il est assez flou pour atteindre ce pixel, et jamais plus
          // flou que le pixel lui-même (le sujet net ne s'étale pas sur le fond)
          float bw = clamp((max(min(s0.a, s.a), 0.0) - dist + margin) / margin, 0.0, 1.0);
          // premier plan : selon son propre CdC (il déborde sur ce qui est derrière lui)
          float fw = clamp((-s.a - dist + margin) / margin, 0.0, 1.0) * step(uTexel.y, -s.a);
          float hw = 1.0 + uBoost * max(dot(s.rgb, vec3(0.2126, 0.7152, 0.0722)) - 1.0, 0.0);
          bg += vec4(s.rgb, 1.0) * bw * hw;
          fg += vec4(s.rgb, 1.0) * fw * hw;
          fgc += fw;
        }
        bg.rgb /= bg.a + (bg.a == 0.0 ? 1.0 : 0.0);
        fg.rgb /= fg.a + (fg.a == 0.0 ? 1.0 : 0.0);
        float fa = clamp(fgc * 3.14159265 / float(N), 0.0, 1.0);
        gl_FragColor = vec4(mix(bg.rgb, fg.rgb, fa), fa);
      }`);
  }
  _draw(renderer, mat, target) {
    this.fsq.material = mat;
    renderer.setRenderTarget(target);
    this.fsq.render(renderer);
  }
  render(renderer, writeBuffer, readBuffer) {
    if (!this.active || !frameU.tSceneDepth.value) { this.needsSwap = false; return; }
    this.needsSwap = true;
    const c = this.cur, u = this.coc;
    u.uFocus.value = c.focus;
    u.uRange.value = Math.max(0, c.range);
    u.uNearK.value = Math.max(0, c.near);
    u.uFarK.value = Math.max(0, c.far);
    u.uMaxR.value = Math.max(0, c.aperture) * 0.01;
    this._gather(this.R.Q.dofSamples || 22);
    // écart entre deux anneaux (en texels de demi-résolution) → niveau de mipmap qui le comble
    const gap = (u.uMaxR.value * this.pre.height) / this._rings;
    this.gatherU.uLod.value = Math.max(0, Math.log2(gap / this.lodGap));
    this.gatherU.uBoost.value = this.boost;
    this.preMat.uniforms.tColor.value = readBuffer.texture;
    this._draw(renderer, this.preMat, this.pre);
    this._draw(renderer, this.gatherMat, this.bokeh);
    this._draw(renderer, this.tentMat, this.tent);
    this.compMat.uniforms.tDiffuse.value = readBuffer.texture;
    this._draw(renderer, this.compMat, this.renderToScreen ? null : writeBuffer);
  }
  dispose() {
    for (const rt of [this.pre, this.bokeh, this.tent]) rt.dispose();
    for (const m of [this.preMat, this.gatherMat, this.tentMat, this.compMat]) if (m) m.dispose();
    this.fsq.dispose();
  }
}
