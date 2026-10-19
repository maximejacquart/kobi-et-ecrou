// Réflexion planaire (Ultra) : la scène opaque est redessinée vue depuis une caméra miroir, à demi-résolution,
// avec un plan de coupe oblique (rien de ce qui est sous l'eau n'apparaît dans le reflet). Étape « avant
// l'éclairage » du rendu : les ombres de l'image sont déjà calculées. Un seul plan par image : celui du plan
// d'eau visible le plus présent à l'écran (choisi par water.js).
import * as THREE from 'three';
import { frameU, LAYERS, screenInputs } from '../frame.js';

const _n = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3();
const _cam = new THREE.Vector3();
const _look = new THREE.Vector3();
const _target = new THREE.Vector3();
const _rot = new THREE.Matrix4();
const _plane = new THREE.Plane();
const _clip = new THREE.Vector4();
const _q = new THREE.Vector4();

export class PlanarReflection {
  constructor(R, waterU) {
    this.R = R;
    this.u = waterU;
    this.enabled = false;
    this.y = 0;
    this.scale = 0.5;
    this.camera = new THREE.PerspectiveCamera();
    this.camera.layers.set(LAYERS.WORLD);
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.rt.texture.generateMipmaps = false;
    waterU.tReflect.value = this.rt.texture;
    this.far = 320;
    this.skip = [];
    this.skipT = 0;
  }
  // objets absents du reflet : herbe (instances par milliers), points, et tout ce qui est marqué noReflect
  _skipList() {
    this.skip.length = 0;
    this.R.scene.traverse((o) => {
      if (o.userData.noReflect || o.isPoints || o.isSprite || (o.isInstancedMesh && o.count >= 1500)) this.skip.push(o);
    });
  }
  // appelé par le rendu au changement de taille (w, h : passe de profondeur ; la taille vient de l'image)
  setSize() {
    const s = this.R.renderer.getDrawingBufferSize(new THREE.Vector2());
    // demi-résolution, plafonnée (au-delà, le flou des vagues ne laisse rien voir de plus)
    const k = Math.min(this.scale, 1400 / Math.max(1, s.x));
    this.rt.setSize(Math.max(2, Math.round(s.x * k)), Math.max(2, Math.round(s.y * k)));
  }
  render(renderer) {
    const cam = this.R.camera;
    const vc = this.camera;
    const y = this.y;
    this.u.uRefl.value.y = 0;
    cam.updateMatrixWorld();
    _p.set(0, y, 0);
    _cam.setFromMatrixPosition(cam.matrixWorld);
    if (_cam.y <= y + 0.05) return;
    // caméra miroir (méthode de three.js Reflector) : position, cible et vertical réfléchis
    _rot.extractRotation(cam.matrixWorld);
    _look.set(0, 0, -1).applyMatrix4(_rot).add(_cam);
    vc.position.set(_cam.x, 2 * y - _cam.y, _cam.z);
    _target.set(_look.x, 2 * y - _look.y, _look.z);
    vc.up.set(0, 1, 0).applyMatrix4(_rot).reflect(_n);
    vc.lookAt(_target);
    // portée réduite (le brouillard cache le lointain ; le ciel est toujours dessiné)
    vc.near = cam.near;
    vc.far = Math.min(cam.far, this.far);
    vc.fov = cam.fov;
    vc.aspect = cam.aspect;
    vc.updateProjectionMatrix();
    vc.updateMatrixWorld();
    // matrice de projection de texture (monde → uv du reflet), lue par les surfaces d'eau
    this.u.uReflMat.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);
    // plan de coupe oblique : le plan proche de la caméra devient la surface de l'eau
    _plane.setFromNormalAndCoplanarPoint(_n, _p).applyMatrix4(vc.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const pm = vc.projectionMatrix.elements;
    _q.set((Math.sign(_clip.x) + pm[8]) / pm[0], (Math.sign(_clip.y) + pm[9]) / pm[5], -1, (1 + pm[10]) / pm[14]);
    _clip.multiplyScalar(2 / _clip.dot(_q));
    pm[2] = _clip.x; pm[6] = _clip.y; pm[10] = _clip.z + 1 - 0.003; pm[14] = _clip.w;
    vc.projectionMatrixInverse.copy(vc.projectionMatrix).invert();

    // entrées écran coupées pendant la capture (occlusion et autres textures lues à l'écran : *On = 0)
    const saved = [];
    for (const k of Object.keys(frameU)) {
      if (k.endsWith('On') && typeof frameU[k].value === 'number') { saved.push([k, frameU[k].value]); frameU[k].value = 0; }
    }
    const scene = this.R.scene;
    this.skipT -= 1;
    if (this.skipT <= 0) { this.skipT = 90; this._skipList(); }
    const hidden = [];
    for (const o of this.skip) if (o.visible) { o.visible = false; hidden.push(o); }
    const prevTarget = renderer.getRenderTarget();
    const ac = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setRenderTarget(this.rt);
    screenInputs(false);
    renderer.render(scene, vc);
    screenInputs(true);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = ac;
    for (const o of hidden) o.visible = true;
    for (const [k, v] of saved) frameU[k].value = v;
    this.u.uRefl.value.set(y, 1);
  }
  dispose() { this.rt.dispose(); }
}
