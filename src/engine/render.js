// Rendu : WebGLRenderer et déroulé d'une image.
//  1. avant l'éclairage : passe de profondeur (normales, rugosité, profondeur) puis étapes « preLight »
//     (occlusion ambiante ; reflets et lumière indirecte à l'écran) — textures lues par les matériaux
//  2. scène : monde opaque (couche 0, MSAA) → copie couleur + profondeur → eau (couche WATER) → effets (couche FX)
//  3. post-traitement en HDR (étapes insérées par addPost), profondeur de champ, flou de mouvement, halo lumineux et
//     exposition automatique, rendu des couleurs, étalonnage (voir post/)
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { SunRaysPass } from './godrays.js';
import { frameU, LAYERS, QUALITY } from './frame.js';
import { Prepass } from './prepass.js';
import { AOStage } from './ao.js';
import { setupScreen } from './temporal.js';
import { ContactStage } from './contact.js';
import { SSRStage } from './ssr.js';
import { SSGIStage } from './ssgi.js';
import { installPost } from './post/index.js';
import { setSlotsLite } from './shaderSlots.js';
import { refreshMaterials } from './materials.js';

// Scène : monde opaque, puis eau, puis effets, dans la même cible MSAA (profondeur et rejet précoce des pixels cachés
// intacts). Pendant l'eau et les effets, frameU.tSceneColor / tSceneDepth sont l'image opaque résolue (textures
// attachées au tampon de résolution, pas au tampon multiéchantillonné où l'on dessine) : réfraction, contact adouci.
// Après l'eau, three.js résout de nouveau : les effets puis le post-traitement voient aussi la surface de l'eau.
class ScenePass extends Pass {
  constructor(R) {
    super();
    this.R = R;
    this.name = 'scene';
    this.depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, depthTexture: this.depthTexture });
    this.copyMat = new THREE.ShaderMaterial({
      uniforms: { tColor: { value: null } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor;
        varying vec2 vUv;
        void main() { gl_FragColor = texture2D(tColor, vUv); }`,
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    });
    this.fsq = new FullScreenQuad(this.copyMat);
    frameU.tSceneColor.value = this.rt.texture;
    frameU.tSceneDepth.value = this.depthTexture;
  }
  setSize(w, h) {
    this.rt.setSize(w, h);
  }
  render(renderer, writeBuffer) {
    const { scene, camera } = this.R;
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    camera.layers.set(LAYERS.WORLD);
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(scene, camera);
    // eau puis effets, dans la même cible (un fond uni forcerait un effacement : il ne sert qu'à l'image opaque)
    const bg = scene.background;
    scene.background = null;
    camera.layers.set(LAYERS.WATER);
    renderer.render(scene, camera);
    camera.layers.set(LAYERS.FX);
    renderer.render(scene, camera);
    camera.layers.set(LAYERS.WORLD);
    scene.background = bg;
    // image finale (résolue) recopiée dans le tampon du composer
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.copyMat.uniforms.tColor.value = this.rt.texture;
    this.fsq.render(renderer);
    renderer.autoClear = ac;
  }
  dispose() {
    this.rt.dispose();
    this.copyMat.dispose();
    this.fsq.dispose();
  }
}

export class Renderer {
  constructor(container) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.shadowSize = 4096;
    r.setSize(window.innerWidth, window.innerHeight);
    // rendu des couleurs : fait par la passe 'output' (post/output.js ; ?tm=neutral|agx|aces pour comparer, en
    // développement) ; toneMappingExposure reste l'exposition de base de la planète
    const tm = import.meta.env.DEV && new URLSearchParams(location.search).get('tm');
    r.toneMapping = THREE.NoToneMapping;
    this.toneName = tm || 'kobi';
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    // les ombres sont calculées une seule fois par image (plusieurs rendus de la scène par image)
    r.shadowMap.autoUpdate = false;
    container.appendChild(r.domElement);
    r.domElement.id = 'game-canvas';

    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1400);
    this.scene = new THREE.Scene();
    this.Q = QUALITY.ultra;
    // fonctions appelées au début de chaque image : f(dt, time)
    this.onFrame = [];

    const size = r.getDrawingBufferSize(new THREE.Vector2());
    this.prepass = new Prepass(this);
    this.ao = new AOStage(this);
    // étapes avant l'éclairage (dans l'ordre) : objets { enabled, setSize(w, h, R), render(renderer) }
    this.preLight = [this.ao];
    // rayons à l'écran : ombres de contact, reflets, lumière indirecte
    this.preLight.push(new ContactStage(this), new SSRStage(this), new SSGIStage(this));

    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(r, rt);
    this.scenePass = new ScenePass(this);
    this.composer.addPass(this.scenePass);
    this.rays = new SunRaysPass();
    this.rays.name = 'rays';
    this.rays.depthTexture = this.scenePass.depthTexture;
    this.raysU = this.rays.uniforms;
    this.composer.addPass(this.rays);
    // dof, motion, bloom (R.bloom.strength), output, grade (R.gradeU) ; R.dof, R.motion, R.exposure
    installPost(this, this.toneName);
    this.gradeU.uRes.value.set(size.x, size.y);
    // historique couleur (avant les rayons) et vues de débogage des effets à l'écran
    setupScreen(this);
    this._last = 0;

    window.addEventListener('resize', () => this.resize());
  }
  // Insère une passe de post-traitement avant la passe nommée (scene, rays, bloom, output, grade).
  // « Avant le halo » place la passe avant la profondeur de champ et le flou de mouvement, qui lui sont attachés.
  addPost(pass, before = 'bloom') {
    const list = this.composer.passes;
    const i = list.findIndex((p) => p.name === before || (before === 'bloom' && p.lens));
    list.splice(i < 0 ? list.length : i, 0, pass);
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    pass.setSize(s.x, s.y);
    return pass;
  }
  // qualité : 'ultra', 'haute', 'moyenne' (voir QUALITY dans frame.js)
  setQuality(q) {
    this.quality = q;
    const Q = this.Q = QUALITY[q] || QUALITY.ultra;
    // Moyenne : matériaux allégés (sans le code des effets à l'écran, des cascades ni des sondes)
    const lite = q === 'moyenne';
    if (lite !== this._lite) {
      setSlotsLite(lite);
      if (this._lite !== undefined) refreshMaterials(this.scene);
      this._lite = lite;
    }
    const ratio = Math.min(window.devicePixelRatio || 1, Q.pixelRatio);
    this.renderer.setPixelRatio(ratio);
    this.composer.setPixelRatio(ratio);
    this.ao.enabled = Q.ao;
    // multiéchantillonnage de l'image principale (2× en Moyenne)
    const rt = this.scenePass.rt;
    if (rt.samples !== Q.msaa) { rt.samples = Q.msaa; rt.dispose(); }
    this.rays.enabled = Q.rays;
    this.shadowSize = Q.shadowSize;
    this.resize();
    if (this.onQuality) this.onQuality(q);
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.gradeU.uRes.value.set(size.x, size.y);
    frameU.uRes.value.set(size.x, size.y);
    const k = this.Q.prepassScale;
    const pw = Math.max(1, Math.round(size.x * k)), ph = Math.max(1, Math.round(size.y * k));
    this.prepass.setSize(pw, ph);
    for (const s of this.preLight) s.setSize(pw, ph, this);
  }
  // Précompile les shaders de toute la scène (toutes couches) pour éviter les à-coups
  compile() {
    const cam = this.camera;
    const mask = cam.layers.mask;
    cam.layers.enableAll();
    this.renderer.compile(this.scene, cam);
    cam.layers.mask = mask;
  }
  _frameUniforms() {
    const cam = this.camera;
    cam.updateMatrixWorld();
    frameU.uFrame.value = (frameU.uFrame.value + 1) % 65536;
    frameU.uCamNear.value = cam.near;
    frameU.uCamFar.value = cam.far;
    frameU.uProj.value.copy(cam.projectionMatrix);
    frameU.uInvProj.value.copy(cam.projectionMatrixInverse);
    frameU.uView.value.copy(cam.matrixWorldInverse);
    frameU.uInvView.value.copy(cam.matrixWorld);
    frameU.uPrevViewProj.value.copy(frameU.uViewProj.value);
    frameU.uViewProj.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const ao = this.Q.prepass && this.ao.enabled;
    frameU.uAOOn.value = ao ? 1 : 0;
  }
  render(time) {
    const dt = Math.min(0.1, Math.max(0, time - this._last));
    this._last = time;
    this.gradeU.uTime.value = time;
    this._frameUniforms();
    for (const f of this.onFrame) f(dt, time);
    const r = this.renderer;
    r.shadowMap.needsUpdate = true;
    if (this.Q.prepass) {
      this.prepass.render();
      for (const s of this.preLight) if (s.enabled) s.render(r);
    }
    this.composer.render(dt);
  }
}
