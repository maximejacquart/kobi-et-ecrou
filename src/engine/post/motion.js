// Flou de mouvement de la caméra : chaque pixel est reprojeté dans l'image précédente (profondeur + uPrevViewProj),
// et l'image est moyennée le long de ce déplacement, ramené à un obturateur fixe (indépendant des images/s).
// Seul le mouvement de la caméra compte : le sujet (Kobi, qui suit la caméra) reste net et ne s'étale pas sur le
// décor. Seuil doux : rien à l'arrêt ni en marche lente ; subtil en course, net sur les rails, en vol plané et dans
// les virages rapides. La passe ne coûte rien quand la caméra est immobile.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { frameU } from '../frame.js';
import { material, GLSL } from './common.js';

export class MotionBlurPass extends Pass {
  constructor(R) {
    super();
    this.R = R;
    this.name = 'motion';
    this.lens = true;
    this.needsSwap = false;
    // réglés par le jeu : intensité (0 en visée), point du monde qui reste net (null : aucun)
    this.amount = 1;
    this.subject = null;
    // temps de pose équivalent (s) : 1/120 = obturateur à 180° à 60 i/s
    this.shutter = 1 / 120;
    this._prevPos = new THREE.Vector3();
    this._prevDir = new THREE.Vector3(0, 0, -1);
    this._prevFov = 0;
    this._dir = new THREE.Vector3();
    this._move = 0;
    this._samples = 0;
    this.u = {
      tDiffuse: { value: null }, tDepth: frameU.tSceneDepth, uCamNear: frameU.uCamNear, uCamFar: frameU.uCamFar,
      uInvProj: frameU.uInvProj, uInvView: frameU.uInvView, uPrevViewProj: frameU.uPrevViewProj,
      uScale: { value: 1 }, uMin: { value: 0.002 }, uMax: { value: 0.04 }, uCut: { value: 0 }, uAspect: { value: 1 }, uHeight: { value: 1 },
    };
    this.mat = null;
    this.fsq = new FullScreenQuad(null);
  }
  _material(n) {
    if (this.mat && this._samples === n) return;
    this._samples = n;
    if (this.mat) this.mat.dispose();
    this.mat = material(this.u, /* glsl */ `
      #define N ${n}
      ${GLSL}
      uniform sampler2D tDiffuse, tDepth;
      uniform float uCamNear, uCamFar, uScale, uMin, uMax, uCut, uAspect, uHeight;
      uniform mat4 uInvProj, uInvView, uPrevViewProj;
      varying vec2 vUv;
      void main() {
        vec4 base = texture2D(tDiffuse, vUv);
        float d = texture2D(tDepth, vUv).x;
        vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
        vec4 w = uInvView * vec4(v.xyz / v.w, 1.0);
        vec4 p = uPrevViewProj * w;
        // déplacement à l'écran pendant la pose (uv), longueur mesurée en fraction de la hauteur d'image
        vec2 vel = (vUv - (p.xy / p.w * 0.5 + 0.5)) * uScale;
        float len = length(vel * vec2(uAspect, 1.0));
        // seuil doux + plafond ; le sujet et ce qui est à sa hauteur de champ restent nets
        float z = linZ(d, uCamNear, uCamFar);
        float L = min(max(len - uMin, 0.0), uMax) * smoothstep(uCut, uCut + 2.5, z);
        if (L * uHeight < 0.75 || p.w <= 0.0) { gl_FragColor = base; return; }
        vel *= L / len;
        float j = ign(gl_FragCoord.xy) - 0.5;
        vec3 acc = base.rgb;
        float ws = 1.0;
        for (int i = 0; i < N; i++) {
          vec2 uv = vUv + vel * ((float(i) + 0.5 + j) / float(N) - 0.5);
          // un échantillon qui tombe sur le sujet ne s'étale pas sur le décor
          float wi = smoothstep(uCut, uCut + 1.0, linZ(textureLod(tDepth, uv, 0.0).x, uCamNear, uCamFar));
          acc += textureLod(tDiffuse, uv, 0.0).rgb * wi;
          ws += wi;
        }
        gl_FragColor = vec4(acc / ws, base.a);
      }`);
  }
  setSize(w, h) {
    this.u.uAspect.value = w / Math.max(1, h);
    this.u.uHeight.value = h;
  }
  // appelée au début de chaque image : mouvement de la caméra depuis l'image précédente (et coupe franche)
  track(dt) {
    const cam = this.R.camera;
    cam.getWorldDirection(this._dir);
    const dp = cam.position.distanceTo(this._prevPos);
    const da = Math.acos(Math.min(1, Math.max(-1, this._dir.dot(this._prevDir))));
    const df = Math.abs(cam.fov - this._prevFov);
    this._prevPos.copy(cam.position);
    this._prevDir.copy(this._dir);
    this._prevFov = cam.fov;
    this._cut = dp > 3 || da > 0.5;
    // déplacement apparent maximal pendant la pose, en fraction de la hauteur d'image (estimation)
    const fov = THREE.MathUtils.degToRad(cam.fov);
    const k = this.shutter / Math.max(dt, 1e-4);
    this._move = (da / fov + dp / 2.5 / fov + df / cam.fov) * k;
  }
  render(renderer, writeBuffer, readBuffer, dt) {
    const n = this.R.Q.motionSamples || 0;
    if (!n || this.amount < 0.01 || this._cut || this._move < this.u.uMin.value * 1.5 || !frameU.tSceneDepth.value) {
      this.needsSwap = false;
      return;
    }
    this.needsSwap = true;
    this._material(n);
    const u = this.u;
    u.uScale.value = Math.min(4, (this.shutter / Math.max(dt, 1e-4)) * this.amount);
    let cut = 0;
    if (this.subject) {
      const cam = this.R.camera;
      cam.getWorldDirection(this._dir);
      cut = Math.max(0, this._dir.dot(this.subject) - this._dir.dot(cam.position)) + 1.2;
    }
    u.uCut.value = cut;
    u.tDiffuse.value = readBuffer.texture;
    this.fsq.material = this.mat;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsq.render(renderer);
  }
  dispose() {
    if (this.mat) this.mat.dispose();
    this.fsq.dispose();
  }
}
