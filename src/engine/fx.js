// Effets : explosions (flash, boule de feu qui s'éteint en fumée, onde de choc, distorsion de chaleur, braises,
// débris brûlants), étincelles qui ricochent, fumées et poussières éclairées, impacts selon la surface,
// éclaboussures, traînées en rubans, scintillement des ramassages, traces de brûlure, flashs lumineux.
// Les systèmes de rendu sont dans engine/particles/ ; ce module en expose l'API (g.fx.*).
import * as THREE from 'three';
import { slotsTier } from './shaderSlots.js';
import { lights } from './lightpool.js';
import { rand, clamp } from './util.js';
import { LAYERS, QUALITY } from './frame.js';
import { patchRim } from './materials.js';
import { syncShared, initShared, FLASHES } from './particles/shared.js';
import { GlowSystem, SmokeSystem, GLOW, MATTER } from './particles/billboards.js';
import { RibbonSystem } from './particles/ribbons.js';
import { HeatPass, HEAT } from './particles/heat.js';
import { smokeAtlas, scorchTexture, chunkGeometry } from './particles/textures.js';

const _c = new THREE.Color();
const _c2 = new THREE.Color();
const _c3 = new THREE.Color();
const _hot = new THREE.Color();
const _tint = new THREE.Color();
const _alb = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);
const WARM = new THREE.Color(1, 0.93, 0.78);
const _tv = new THREE.Vector3();
const _tv2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

// options d'émission réutilisées (aucune allocation par particule)
const O = {};
const KEYS = ['life', 'size', 'size1', 'color', 'color1', 'alpha', 'drag', 'gravity', 'shape', 'rot', 'spin', 'stretch', 'floor', 'bounce', 'turb',
  'kind', 'variant', 'heat', 'heatTime', 'tint', 'emissive', 'fadeIn', 'fadeOut', 'grow'];
function opt() {
  for (let i = 0; i < KEYS.length; i++) O[KEYS[i]] = undefined;
  return O;
}
// numéros de tuile (o.tile) → formes
const TILE_GLOW = [GLOW.SOFT, GLOW.STAR, GLOW.SOFT, GLOW.RING];

// couleurs des éclats selon la surface
const SURF = {
  sand: { chip: '#c99a62', dust: null }, rock: { chip: '#6e6460', dust: null }, metal: { chip: '#8a8e98', dust: '#9a96a0' },
  snow: { chip: '#eef6ff', dust: '#f2f8ff' }, ice: { chip: '#cfeaff', dust: '#e8f4ff' }, grass: { chip: '#4e9a3a', dust: null },
  wood: { chip: '#8a5a32', dust: '#a88a68' },
};

const RING_VERT = /* glsl */ `
varying vec2 vUv;
varying float vFace;
#include <fog_pars_vertex>
void main() {
  vUv = uv * 2.0 - 1.0;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  // vu par la tranche, l'anneau deviendrait un trait : il s'efface
  vFace = abs(dot(normalize(normalMatrix * vec3(0.0, 1.0, 0.0)), normalize(-mvPosition.xyz)));
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uT;
varying vec2 vUv;
varying float vFace;
#include <fog_pars_fragment>
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  // front net et lumineux, voile qui s'efface derrière lui
  float edge = exp(-pow((r - 0.9) / 0.045, 2.0));
  float fill = smoothstep(0.25, 0.9, r) * smoothstep(1.0, 0.9, r) * 0.35 * (1.0 - uT);
  float a = (edge + fill) * uOpacity * smoothstep(0.06, 0.4, vFace);
  vec3 col = uColor * (1.0 + edge * 1.5);
  gl_FragColor = vec4(col * a, 0.0);
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    gl_FragColor.rgb *= 1.0 - fogFactor;
  #endif
}`;
const SCORCH_FRAG = /* glsl */ `
uniform sampler2D map;
uniform float uOpacity, uHeat, uTime;
varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(map, vUv);
  float a = t.a * uOpacity;
  // braises qui rougeoient dans le charbon puis refroidissent
  float n = sin(vUv.x * 41.0 + uTime * 3.0) * sin(vUv.y * 37.0 - uTime * 2.3);
  float glow = uHeat * smoothstep(0.45, 0.9, t.a) * (0.6 + 0.4 * n);
  vec3 col = t.rgb;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    col = mix(col, fogColor, fogFactor);
  #endif
  gl_FragColor = vec4(col * a + vec3(1.0, 0.32, 0.06) * glow * 4.0 * a, a);
}`;

export class FX {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    this.time = 0;
    this.budget = 1;
    this.smokeTex = smokeAtlas();
    this.glow = new GlowSystem(scene, 6000);
    this.matter = new SmokeSystem(scene, 4096, this.smokeTex, 2);
    this.ribbons = new RibbonSystem(scene, 64, 32);
    this.ribbons.onSmoke = (x, y, z, o) => this._trailPuff(x, y, z, o);

    // distorsion de chaleur : passe écran insérée avant le halo lumineux
    const R = game.R;
    this.heat = new HeatPass(R ? R.camera : null);
    if (R) {
      initShared(R.renderer);
      R.addPost(this.heat, 'bloom');
      // compilé d'avance : pas d'à-coup à la première explosion
      R.renderer.compile(this.heat.scene, R.camera);
      // tri des fumées et envoi au GPU juste avant le rendu (caméra à jour)
      R.onFrame.push(() => this.matter.write(R.camera));
    }

    // Débris instanciés : éclats à facettes, rougeoyants au sortir d'une explosion
    this.debrisMax = 260;
    const dgeo = chunkGeometry();
    this.debrisHeat = new THREE.InstancedBufferAttribute(new Float32Array(this.debrisMax), 1).setUsage(THREE.DynamicDrawUsage);
    dgeo.setAttribute('aHeat', this.debrisHeat);
    const dmat = patchRim(new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.25, flatShading: true }), 0.5, (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aHeat;\nvarying float vHeat;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeat = aHeat;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vHeat;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.3, 0.06) * vHeat * vHeat * 2.5;');
    });
    dmat.customProgramCacheKey = () => 'rim-debris' + slotsTier();
    this.debrisMesh = new THREE.InstancedMesh(dgeo, dmat, this.debrisMax);
    this.debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.debrisMesh.castShadow = true;
    this.debrisMesh.count = 0;
    // couleur par instance créée d'emblée : pas de recompilation du shader à la première explosion
    this.debrisMesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.debrisMesh.frustumCulled = false;
    scene.add(this.debrisMesh);
    this.debris = [];
    this._debrisFree = [];
    this.meshDebris = [];

    // Anneaux (ondes au sol, signaux) : front lumineux net
    this.rings = [];
    const rgeo = new THREE.PlaneGeometry(2, 2);
    rgeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color() }, uOpacity: { value: 0 }, uT: { value: 0 } }]),
        vertexShader: RING_VERT, fragmentShader: RING_FRAG, fog: true,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
        blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      });
      const m = new THREE.Mesh(rgeo, mat);
      m.visible = false;
      m.renderOrder = 13;
      m.frustumCulled = false;
      m.layers.set(LAYERS.FX);
      scene.add(m);
      this.rings.push({ mesh: m, t: 1, dur: 1, r0: 0, r1: 1, op: 1 });
    }
    // Traces de brûlure au sol (couche du monde : dessinées sous l'eau et les effets)
    this.decals = [];
    const stex = scorchTexture();
    const dgeo2 = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    for (let i = 0; i < 24; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null }, uOpacity: { value: 1 }, uHeat: { value: 0 }, uTime: { value: 0 } }]),
        vertexShader: RING_VERT.replace('vUv = uv * 2.0 - 1.0;', 'vUv = uv;'), fragmentShader: SCORCH_FRAG, fog: true,
        transparent: true, depthWrite: false,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      mat.uniforms.map.value = stex;
      const m = new THREE.Mesh(dgeo2, mat);
      m.visible = false;
      m.renderOrder = 1;
      scene.add(m);
      this.decals.push({ mesh: m, t: 0, life: 0 });
    }
    // Flashs lumineux : éclairage par le pool de lumières ; les derniers flashs sont aussi vus par les particules
    this.flashes = [];
    for (let i = 0; i < FLASHES; i++) this.flashes.push({ p: new THREE.Vector3(), color: new THREE.Color(), i0: 0, range: 1, t: 1, dur: 1 });
  }

  reset() {
    this.glow.clear();
    this.matter.clear();
    this.ribbons.clear();
    this.heat.reset();
    this._debrisFree.push(...this.debris);
    this.debris.length = 0;
    this.debrisMesh.count = 0;
    for (const d of this.meshDebris) d.mesh.parent && d.mesh.parent.remove(d.mesh);
    this.meshDebris.length = 0;
    for (const r of this.rings) { r.t = r.dur; r.mesh.visible = false; }
    for (const d of this.decals) { d.life = 0; d.mesh.visible = false; }
    for (const f of this.flashes) f.t = f.dur;
  }

  // nombre de particules selon le budget de la qualité (arrondi au hasard : 0,5 particule = une fois sur deux)
  _n(count) {
    const k = count * this.budget;
    const f = Math.floor(k);
    return f + (Math.random() < k - f ? 1 : 0);
  }
  _Q() { return (this.game.R && this.game.R.Q) || QUALITY.ultra; }
  // hauteur du sol sous un point (rebonds des étincelles et des éclats)
  _floorAt(p, below = 30) {
    const w = this.game.world;
    const hit = w && w.groundBelow(p.x, p.y + 0.3, p.z, below);
    return hit ? hit.point.y + 0.02 : -1e9;
  }
  _dustColor() { return (this.game.level && this.game.level.dustColor) || '#d8c4a8'; }

  // --- primitives ---
  spark(p, v, o) {
    const e = opt();
    e.life = o.life; e.size = (o.size ?? 0.3) * 0.55; e.size1 = (o.size1 ?? o.size ?? 0.3) * 0.55;
    e.color = _c3.copy(o.color || WHITE).multiplyScalar(1.6);
    e.color1 = o.color1 ? _hot.copy(o.color1).multiplyScalar(1.6) : undefined;
    e.alpha = o.alpha; e.drag = o.drag; e.gravity = o.gravity; e.rot = o.rot; e.spin = o.spin;
    e.shape = TILE_GLOW[o.tile ?? 0] ?? GLOW.SOFT;
    this.glow.emit(p.x, p.y, p.z, v.x, v.y, v.z, e);
  }
  puff(p, v, o) {
    const e = opt();
    e.life = o.life; e.size = (o.size ?? 0.5) * 0.5; e.size1 = (o.size1 ?? o.size ?? 0.5) * 0.5;
    e.color = o.color || WHITE; e.color1 = o.color1;
    e.alpha = o.alpha; e.drag = o.drag; e.gravity = o.gravity; e.rot = o.rot; e.spin = o.spin;
    e.kind = o.tile === 2 ? MATTER.SMOKE : MATTER.BLOB;
    e.fadeOut = 0.3; e.grow = 1.6;
    this.matter.emit(p.x, p.y, p.z, v.x, v.y, v.z, e);
  }

  // Lumière éphémère : confiée au pool de lumières, et retenue pour l'éclairage des particules
  _light(p, color, intensity, range, dur) {
    lights.flash(p, color, intensity, range, dur);
    let best = 0;
    for (let i = 1; i < this.flashes.length; i++) {
      const a = this.flashes[i], b = this.flashes[best];
      if (a.t / a.dur > b.t / b.dur) best = i;
    }
    const f = this.flashes[best];
    f.p.copy(p); f.color.set(color); f.i0 = intensity; f.range = range; f.t = 0; f.dur = dur;
  }
  flash(p, color, intensity = 30, distance = 10, dur = 0.15) { this._light(p, color, intensity, distance, dur); }

  ring(p, color, r1 = 4, dur = 0.45, r0 = 0.3, opacity = 0.9, normal) {
    const r = this.rings.find((x) => x.t >= x.dur) || this.rings.reduce((a, b) => (a.t / a.dur > b.t / b.dur ? a : b));
    r.mesh.position.copy(p);
    r.mesh.position.y += 0.06;
    if (normal) r.mesh.quaternion.setFromUnitVectors(_up, normal);
    else r.mesh.quaternion.identity();
    r.mesh.material.uniforms.uColor.value.set(color).multiplyScalar(1.4);
    r.mesh.visible = true;
    r.t = 0; r.dur = dur; r.r0 = r0; r.r1 = r1; r.op = opacity;
  }

  // boule d'explosion : éclair + boule de feu brève
  blast(p, color, radius, dur = 0.35) {
    this._flare(p, _c.set(color), radius * 1.4, dur * 0.6);
    this._fireball(p, radius * 0.6, _c.set(color), false, 0.6);
  }

  scorch(p, radius, heat = 0.8) {
    const w = this.game.world;
    const hit = w && w.groundBelow(p.x, p.y + 0.5, p.z, radius + 1.5);
    if (!hit || hit.normal.y < 0.6 || (hit.collider && hit.collider.tag === 'lava')) return;
    const d = this.decals.reduce((a, b) => (a.life - a.t < b.life - b.t ? a : b));
    d.mesh.position.copy(hit.point).addScaledVector(hit.normal, 0.03);
    d.mesh.quaternion.setFromUnitVectors(_up, hit.normal);
    d.mesh.rotateY(Math.random() * 6.28);
    d.mesh.scale.setScalar(radius * 1.7);
    d.mesh.visible = true;
    d.t = 0;
    d.life = 10;
    d.heat = heat;
  }

  debrisBurst(p, count, color, size = 0.12, speed = 6, life = 1.6, heat = 0) {
    const floor = this._floorAt(p);
    _c.set(color);
    const n = Math.max(1, Math.round(count * (this._Q().fxDebris ?? 1)));
    for (let i = 0; i < n; i++) {
      // enregistrements recyclés (pas d'allocation à chaque explosion)
      const d = this.debris.length >= this.debrisMax ? this.debris.shift() : this._debrisFree.pop() || { p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), color: new THREE.Color(), sc: new THREE.Vector3() };
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.8);
      d.p.set(p.x, p.y, p.z);
      d.v.set(Math.cos(a) * sp, speed * (0.6 + Math.random()), Math.sin(a) * sp);
      d.r.set(rand(0, 6), rand(0, 6), rand(0, 6));
      d.w.set(rand(-12, 12), rand(-12, 12), rand(-12, 12));
      d.s = size * (0.5 + Math.random());
      d.sc.set(rand(0.7, 1.3), rand(0.45, 1), rand(0.7, 1.3));
      d.life = 0;
      d.max = life * (0.7 + Math.random() * 0.6);
      d.floor = floor;
      d.bounces = 0;
      d.heat = heat * rand(0.6, 1);
      d.smokeT = 0;
      d.color.copy(_c).multiplyScalar(0.7 + Math.random() * 0.5);
      this.debris.push(d);
    }
  }

  // Détache un maillage (morceau d'ennemi) et le projette
  meshChunk(mesh, v, life = 2.2) {
    mesh.updateWorldMatrix(true, false);
    mesh.matrixWorld.decompose(_p, _q, _s);
    this.game.scene.add(mesh);
    mesh.position.copy(_p);
    mesh.quaternion.copy(_q);
    mesh.scale.copy(_s);
    const w = this.game.world;
    const hit = w && w.groundBelow(_p.x, _p.y + 0.5, _p.z, 30);
    this.meshDebris.push({
      mesh, v: v.clone(), w: new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9)),
      life: 0, max: life, floor: hit ? hit.point.y : -1e9, s0: _s.clone(),
    });
  }

  // --- briques ---
  // éclair bref (cœur blanc, halo coloré)
  _flare(p, color, size, life = 0.14, k = 1) {
    const e = opt();
    e.life = life; e.size = size; e.size1 = size * 1.25; e.shape = GLOW.FLARE; e.rot = 0;
    e.color = _hot.copy(color).lerp(WHITE, 0.45).multiplyScalar(1.3 * k);
    e.color1 = _c2.copy(color).multiplyScalar(0.6 * k);
    this.glow.emit(p.x, p.y, p.z, 0, 0, 0, e);
  }
  // étincelles chaudes étirées par leur vitesse, qui ricochent sur le sol
  _hotSparks(p, dir, count, color, speed, size, floor, spread = 1) {
    _hot.copy(color).lerp(WARM, 0.35).multiplyScalar(5);
    _c2.copy(color).multiplyScalar(1.8);
    for (let i = 0; i < count; i++) {
      const v = _tv.set(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize().multiplyScalar(spread);
      if (dir) v.addScaledVector(dir, 1.2).normalize();
      v.multiplyScalar(speed * rand(0.35, 1.25));
      const e = opt();
      e.life = rand(0.25, 0.65); e.size = size * rand(0.5, 1); e.size1 = size * 0.3;
      e.color = _hot; e.color1 = _c2; e.shape = GLOW.STREAK; e.stretch = 0.035;
      e.gravity = 16; e.drag = 1.6; e.floor = floor; e.bounce = 0.4;
      this.glow.emit(p.x, p.y, p.z, v.x, v.y, v.z, e);
    }
  }
  // boule de feu : bouffées chaudes qui gonflent, refroidissent, puis montent en fumée (ou s'éteignent : énergie)
  _fireball(p, r, color, smoke, alphaK = 1, smokeAlb = null) {
    const nf = this._n(4 + r * 2.2);
    _tint.copy(color);
    if (smokeAlb) _alb.copy(smokeAlb); else _alb.set('#a3968c');
    for (let i = 0; i < nf; i++) {
      const v = _tv.set(rand(-1, 1), rand(-0.25, 1), rand(-1, 1)).normalize();
      const o = _tv2.copy(v).multiplyScalar(r * rand(0.05, 0.35));
      v.multiplyScalar(r * rand(1.2, 3.0));
      const e = opt();
      const ht = rand(0.45, 0.75);
      e.kind = MATTER.SMOKE; e.heat = 1; e.heatTime = smoke ? ht : ht * 0.8; e.tint = _tint; e.emissive = 0.75;
      e.color = _alb; e.alpha = smoke ? 0.8 * alphaK : 0.3 * alphaK;
      e.life = smoke ? rand(1.0, 1.6) : ht * 0.95;
      e.size = r * 0.5; e.size1 = r * rand(1.0, 1.35) * (smoke ? 1.15 : 0.9); e.grow = smoke ? 5 : 3;
      e.drag = 3.8; e.gravity = smoke ? -2 : -0.5; e.turb = 1.2; e.spin = rand(-0.7, 0.7);
      e.fadeIn = 0.015; e.fadeOut = smoke ? 0.35 : 0.3;
      this.matter.emit(p.x + o.x, p.y + o.y, p.z + o.z, v.x, v.y, v.z, e);
    }
  }

  // --- préréglages ---
  sparks(p, dir, count = 10, color = '#ffd36b', speed = 9, size = 0.18) {
    _c.set(color);
    this._hotSparks(p, dir, this._n(count), _c, speed, size * 0.32, this._floorAt(p));
    // petit éclat au point d'émission
    if (count >= 4) {
      const e = opt();
      e.life = 0.1; e.size = size * 1.6; e.size1 = size * 2.4; e.shape = GLOW.SOFT;
      e.color = _c2.copy(_c).multiplyScalar(2);
      this.glow.emit(p.x, p.y, p.z, 0, 0, 0, e);
    }
  }
  dust(p, count = 6, color = '#e8c9a0', spread = 2, size = 0.6) {
    _alb.set(color);
    const n = this._n(count);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = spread * rand(0.5, 1.1);
      const e = opt();
      e.kind = MATTER.SMOKE; e.variant = Math.random() < 0.7 ? 6 + (i & 1) : Math.floor(Math.random() * 6);
      e.color = _alb; e.alpha = 0.4; e.life = rand(0.8, 1.4);
      e.size = size * 0.35; e.size1 = size * rand(1.1, 1.6); e.grow = 3;
      e.drag = 3.2; e.gravity = -0.35; e.turb = 0.5; e.spin = rand(-0.6, 0.6); e.fadeIn = 0.05; e.fadeOut = 0.3;
      this.matter.emit(p.x + Math.cos(a) * 0.2, p.y + 0.12, p.z + Math.sin(a) * 0.2, Math.cos(a) * sp, rand(0.25, 0.9), Math.sin(a) * sp, e);
    }
    // gravillons projetés (atterrissages, glissades)
    if (count >= 4 && this.budget >= 0.7) {
      const floor = p.y + 0.02;
      _c.copy(_alb).multiplyScalar(0.75);
      const g = this._n(count * 0.7);
      for (let i = 0; i < g; i++) {
        const a = Math.random() * Math.PI * 2, sp = spread * rand(0.4, 1.2);
        const e = opt();
        e.kind = MATTER.CHIP; e.color = _c; e.life = rand(0.4, 0.7); e.size = rand(0.018, 0.035);
        e.gravity = 14; e.drag = 1; e.floor = floor; e.fadeOut = 0.7; e.fadeIn = 0.01;
        this.matter.emit(p.x, p.y + 0.08, p.z, Math.cos(a) * sp, rand(1.5, 3.5), Math.sin(a) * sp, e);
      }
    }
  }
  smoke(p, count = 6, color = '#3d3540', size = 1.4, rise = 2) {
    _alb.set(color);
    const n = this._n(count);
    for (let i = 0; i < n; i++) {
      const e = opt();
      e.kind = MATTER.SMOKE; e.color = _alb; e.alpha = 0.6;
      e.life = rand(1.1, 1.9) * (0.8 + size * 0.15);
      e.size = size * 0.3; e.size1 = size * rand(0.8, 1.15); e.grow = 2.4;
      e.drag = 1.4; e.gravity = -0.6 * rise * 0.5; e.turb = 0.7; e.spin = rand(-0.5, 0.5); e.fadeIn = 0.06; e.fadeOut = 0.35;
      if (i === 0) { e.heat = 0.35; e.heatTime = 0.25; e.tint = _tint.set('#ff8a3a'); e.emissive = 0.6; }
      this.matter.emit(p.x + rand(-0.3, 0.3), p.y + rand(-0.15, 0.3), p.z + rand(-0.3, 0.3), rand(-0.8, 0.8), rand(0.5, 1.5) * rise, rand(-0.8, 0.8), e);
    }
  }
  explosion(p, radius = 3, color = '#ff9a3a', opts = {}) {
    const g = this.game;
    const r = radius;
    const Q = this._Q();
    _c.set(color);
    const floor = this._floorAt(p, 30);
    const nearGround = p.y - floor < r * 0.9;
    const fiery = opts.smoke !== false;
    // éclair
    this._flare(p, _c3.set(opts.core || '#fff2c0'), r * 0.45, 0.09);
    this._flare(p, _c, r * 0.9, 0.16, 0.35);
    this._light(p, color, 20 * r, r * 4.5, 0.26);
    // boule de feu (ou gerbe d'énergie)
    this._fireball(p, r, _c, fiery, 1, opts.smokeColor ? _c2.set(opts.smokeColor).multiplyScalar(0.5) : null);
    // colonne de fumée qui prend le relais de la flamme
    if (fiery) {
      _alb.set(opts.smokeColor || '#a8988e');
      const ns = this._n(1 + r * 0.8);
      for (let i = 0; i < ns; i++) {
        const e = opt();
        e.kind = MATTER.SMOKE; e.color = _alb; e.alpha = 0.36;
        e.life = rand(1.4, 2.2); e.size = r * 0.6; e.size1 = r * rand(1.2, 1.5); e.grow = 1.8;
        e.drag = 1.1; e.gravity = -0.6; e.turb = 0.9; e.spin = rand(-0.3, 0.3); e.fadeIn = 0.22; e.fadeOut = 0.4;
        this.matter.emit(p.x + rand(-0.4, 0.4) * r, p.y + r * rand(0.1, 0.5), p.z + rand(-0.4, 0.4) * r, rand(-1, 1), rand(1.5, 3), rand(-1, 1), e);
      }
    } else {
      // halo d'énergie
      const e = opt();
      e.life = 0.45; e.size = r * 0.8; e.size1 = r * 1.8; e.shape = GLOW.SOFT;
      e.color = _c2.copy(_c).multiplyScalar(1.6);
      this.glow.emit(p.x, p.y, p.z, 0, 0, 0, e);
    }
    // étincelles et braises
    this._hotSparks(p, null, this._n(14 + r * 5), _c3.set(opts.spark || '#ffe08a'), r * 5, 0.06 + r * 0.012, floor);
    _hot.copy(_c).lerp(WARM, 0.4).multiplyScalar(4);
    _c2.copy(_c).multiplyScalar(0.6);
    const ne = this._n(6 + r * 3);
    for (let i = 0; i < ne; i++) {
      const e = opt();
      e.life = rand(1.1, 2.4); e.size = rand(0.035, 0.07); e.size1 = 0.015; e.shape = GLOW.EMBER;
      e.color = _hot; e.color1 = _c2; e.drag = 1.4; e.gravity = 2.2; e.turb = 4; e.floor = floor; e.bounce = 0.2;
      const v = _tv.set(rand(-1, 1), rand(0.2, 1.2), rand(-1, 1)).normalize().multiplyScalar(r * rand(1, 3.2));
      this.glow.emit(p.x, p.y, p.z, v.x, v.y, v.z, e);
    }
    // onde de choc : poussière chassée au ras du sol, front lumineux, distorsion
    if (nearGround) {
      _p.set(p.x, floor, p.z);
      this.ring(_p, color, r * 2.2, 0.3, r * 0.3, 0.22);
      _alb.set(this._dustColor());
      const nd = this._n(8 + r * 3);
      for (let i = 0; i < nd; i++) {
        const a = (i / nd) * Math.PI * 2 + rand(-0.2, 0.2);
        const e = opt();
        e.kind = MATTER.SMOKE; e.variant = 6 + (i & 1); e.color = _alb; e.alpha = 0.32;
        e.life = rand(0.8, 1.3); e.size = r * 0.3; e.size1 = r * rand(0.7, 0.95); e.grow = 2.5;
        e.drag = 3; e.gravity = -0.15; e.turb = 0.5; e.fadeIn = 0.04; e.fadeOut = 0.25; e.rot = a + Math.PI / 2;
        const sp = r * rand(4, 6);
        this.matter.emit(_p.x + Math.cos(a) * r * 0.4, floor + 0.2, _p.z + Math.sin(a) * r * 0.4, Math.cos(a) * sp, rand(0.1, 0.5), Math.sin(a) * sp, e);
      }
    }
    if (Q.fxHeat) {
      this.heat.add(HEAT.SHOCK, p, r * 0.6, r * 3.4, 0.38, 0.9);
      if (fiery) this.heat.add(HEAT.HAZE, _p.set(p.x, p.y + r * 0.6, p.z), r * 1.2, r * 1.8, 1.3, 0.35, 1.6);
    }
    if (opts.scorch !== false) this.scorch(p, r, fiery ? 0.9 : 0);
    if (opts.debris !== false) this.debrisBurst(p, 4 + Math.floor(r * 1.5), opts.debrisColor || '#8a7f8c', 0.09 + r * 0.02, 7, 1.6, fiery ? 1 : 0);
    if (g.camera && g.camera.shakeAt) g.camera.shakeAt(p, opts.shake ?? r * 0.18);
  }
  muzzle(p, dir, color = '#ffd36b', size = 0.5) {
    _c.set(color);
    this._flare(p, _c, size * 0.7, 0.06);
    // cône de flamme : traits brefs le long du canon
    _hot.copy(_c).lerp(WARM, 0.5).multiplyScalar(4);
    const n = this.budget >= 0.7 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const v = _tv.copy(dir).multiplyScalar(rand(10, 18)).add(_tv2.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(1.5));
      const e = opt();
      e.life = 0.06; e.size = size * 0.22; e.size1 = size * 0.1; e.shape = GLOW.STREAK; e.stretch = 0.025;
      e.color = _hot; e.drag = 12;
      this.glow.emit(p.x, p.y, p.z, v.x, v.y, v.z, e);
    }
    if (Math.random() < this.budget * 0.7) {
      const e = opt();
      e.kind = MATTER.SMOKE; e.color = _alb.set('#8a8490'); e.alpha = 0.22; e.life = rand(0.5, 0.8);
      e.size = size * 0.2; e.size1 = size * 0.9; e.drag = 4; e.gravity = -0.6; e.turb = 0.5; e.fadeIn = 0.05;
      e.heat = 0.5; e.heatTime = 0.07; e.tint = _c; e.emissive = 0.8;
      this.matter.emit(p.x, p.y, p.z, dir.x * 2.5, dir.y * 2.5 + 0.3, dir.z * 2.5, e);
    }
    this._light(p, color, 5, 5, 0.06);
  }
  pickupBurst(p, color = '#ffe27a', n = 6) {
    _c.set(color);
    _hot.copy(_c).lerp(WHITE, 0.35).multiplyScalar(3);
    const k = Math.max(2, this._n(n * 1.6));
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2 + rand(-0.3, 0.3);
      const sp = rand(1.2, 2.6);
      const e = opt();
      e.life = rand(0.4, 0.7); e.size = rand(0.1, 0.18); e.size1 = 0.01; e.shape = GLOW.STAR;
      e.color = _hot; e.color1 = _c; e.drag = 3.5; e.gravity = -1.5; e.spin = rand(-4, 4);
      this.glow.emit(p.x, p.y, p.z, Math.cos(a) * sp, rand(0.8, 2.5), Math.sin(a) * sp, e);
    }
    // éclat central et petit anneau
    const e = opt();
    e.life = 0.16; e.size = 0.22; e.size1 = 0.38; e.shape = GLOW.STAR; e.rot = Math.random();
    e.color = _c2.copy(_c).lerp(WHITE, 0.6).multiplyScalar(4);
    this.glow.emit(p.x, p.y, p.z, 0, 0, 0, e);
    const e2 = opt();
    e2.life = 0.25; e2.size = 0.1; e2.size1 = 0.7; e2.shape = GLOW.RING; e2.color = _c2.copy(_c).multiplyScalar(1.2); e2.alpha = 0.45;
    this.glow.emit(p.x, p.y, p.z, 0, 0, 0, e2);
  }
  trail(p, color, size = 0.3, life = 0.25, tile = 0, alphaV = 1) {
    _c.set(color);
    const e = opt();
    e.life = life; e.size = size * 0.5; e.size1 = size * 0.12; e.alpha = alphaV;
    e.color = _c2.copy(_c).multiplyScalar(1.7); e.shape = TILE_GLOW[tile] ?? GLOW.SOFT;
    if (tile === 1) e.spin = rand(-3, 3);
    this.glow.emit(p.x, p.y, p.z, 0, 0, 0, e);
  }

  // --- nouveaux effets ---
  // Impact selon la surface (sable, métal, roche, neige, glace, herbe, bois, eau) ; color : énergie du tir
  impact(p, n, surface = 'rock', color = '#ffd36b') {
    const s = surface || 'rock';
    if (s === 'water') { this.splash(p, 0.6); return; }
    const floor = this._floorAt(_p.copy(p).addScaledVector(n || _up, 0.1));
    _c.set(color);
    this._hotSparks(p, n, this._n(s === 'metal' ? 9 : 3), _c, s === 'metal' ? 7 : 4.5, 0.04, floor, 0.8);
    const e0 = opt();
    e0.life = 0.08; e0.size = 0.25; e0.size1 = 0.4; e0.shape = GLOW.FLARE; e0.rot = 0;
    e0.color = _c2.copy(_c).lerp(WHITE, 0.4).multiplyScalar(2.5);
    this.glow.emit(p.x, p.y, p.z, 0, 0, 0, e0);
    const S = SURF[s] || SURF.rock;
    _alb.set(S.dust || this._dustColor());
    // nuage de la matière touchée
    const soft = s === 'snow' || s === 'ice';
    const nd = this._n(s === 'metal' ? 1 : 3);
    for (let i = 0; i < nd; i++) {
      const v = _tv.copy(n || _up).multiplyScalar(rand(1, 2.6)).add(_tv2.set(rand(-0.7, 0.7), rand(0, 0.7), rand(-0.7, 0.7)));
      const e = opt();
      e.kind = MATTER.SMOKE; e.color = _alb; e.alpha = soft ? 0.8 : 0.62;
      e.life = rand(0.7, 1.2); e.size = 0.15; e.size1 = rand(0.6, 0.95); e.grow = 3.5; e.drag = 4; e.gravity = -0.25; e.turb = 0.4; e.fadeIn = 0.03; e.fadeOut = 0.3;
      this.matter.emit(p.x, p.y, p.z, v.x, v.y, v.z, e);
    }
    // gerbe : jets de matière projetés en cône, puis éclats qui retombent
    _c3.set(S.chip);
    if (s !== 'metal') {
      const nj = this._n(5);
      for (let i = 0; i < nj; i++) {
        const v = _tv.copy(n || _up).multiplyScalar(rand(3.5, 6.5)).add(_tv2.set(rand(-1.6, 1.6), rand(0, 1), rand(-1.6, 1.6)));
        const e = opt();
        e.kind = MATTER.DROP; e.color = soft ? _alb : _c3; e.alpha = 0.85; e.life = rand(0.35, 0.6);
        e.size = rand(0.03, 0.05); e.stretch = 0.03; e.gravity = 14; e.floor = floor; e.fadeOut = 0.6; e.fadeIn = 0.01;
        this.matter.emit(p.x, p.y, p.z, v.x, v.y, v.z, e);
      }
    }
    const nc = this._n(s === 'metal' ? 0 : 9);
    for (let i = 0; i < nc; i++) {
      const v = _tv.copy(n || _up).multiplyScalar(rand(2, 5)).add(_tv2.set(rand(-2.2, 2.2), rand(0, 2), rand(-2.2, 2.2)));
      const e = opt();
      e.kind = soft ? MATTER.FLAKE : MATTER.CHIP; e.color = _c3; e.life = rand(0.5, 0.9);
      e.size = rand(0.022, 0.05) * (s === 'grass' ? 1.4 : 1); e.gravity = s === 'grass' ? 5 : 14; e.drag = s === 'grass' ? 3 : 1;
      e.spin = rand(-12, 12); e.floor = floor; e.fadeOut = 0.7; e.fadeIn = 0.01;
      if (s === 'wood') e.stretch = 0.03;
      this.matter.emit(p.x, p.y, p.z, v.x, v.y, v.z, e);
    }
    // glace et neige : paillettes qui scintillent
    if (s === 'snow' || s === 'ice') {
      _hot.set('#e8f6ff').multiplyScalar(2.5);
      const ng = this._n(4);
      for (let i = 0; i < ng; i++) {
        const v = _tv.copy(n || _up).multiplyScalar(rand(1, 2.5)).add(_tv2.set(rand(-1.5, 1.5), rand(0, 1.5), rand(-1.5, 1.5)));
        const e = opt();
        e.life = rand(0.4, 0.8); e.size = rand(0.04, 0.07); e.size1 = 0.01; e.shape = GLOW.STAR; e.color = _hot;
        e.gravity = 6; e.drag = 2; e.spin = rand(-5, 5); e.floor = floor;
        this.glow.emit(p.x, p.y, p.z, v.x, v.y, v.z, e);
      }
    }
  }
  // Éclaboussure simple : gouttes, couronne d'écume, brume
  splash(p, size = 1, color = '#dff3ff') {
    _alb.set(color);
    const nd = this._n(14 * size + 4);
    for (let i = 0; i < nd; i++) {
      const a = Math.random() * Math.PI * 2, sp = rand(0.8, 2.6) * size;
      const e = opt();
      e.kind = MATTER.DROP; e.color = _alb; e.alpha = 0.85; e.life = rand(0.45, 0.85);
      e.size = rand(0.025, 0.05) * (0.7 + size * 0.3); e.stretch = 0.035; e.gravity = 14; e.fadeOut = 0.75; e.fadeIn = 0.01;
      this.matter.emit(p.x, p.y + 0.05, p.z, Math.cos(a) * sp, rand(3, 6.5) * Math.sqrt(size), Math.sin(a) * sp, e);
    }
    const nm = this._n(3);
    for (let i = 0; i < nm; i++) {
      const e = opt();
      e.kind = MATTER.BLOB; e.color = _alb; e.alpha = 0.3; e.life = rand(0.6, 1);
      e.size = 0.2 * size; e.size1 = 0.8 * size; e.drag = 3; e.gravity = -0.4; e.fadeIn = 0.05;
      this.matter.emit(p.x + rand(-0.2, 0.2), p.y + 0.2, p.z + rand(-0.2, 0.2), rand(-0.5, 0.5), rand(0.5, 1.2), rand(-0.5, 0.5), e);
    }
    this.ring(p, color, 1.4 * size, 0.55, 0.15, 0.4);
  }
  // Traînée en ruban : renvoie { push(p), end() } — o : color, width, life, alpha, minSeg, smoke { color, size, every }
  ribbon(o = {}) {
    const rs = this.ribbons;
    _c.set(o.color || '#ffffff').multiplyScalar(o.glow ?? 2);
    const hd = rs.start({ color: _c, width: o.width ?? 0.15, life: o.life ?? 0.25, alpha: o.alpha ?? 1, minSeg: o.minSeg ?? 0.35, smoke: o.smoke ? { ...o.smoke, col: new THREE.Color(o.smoke.color || '#6a6070') } : null });
    return {
      push: (p) => rs.push(hd, p),
      end: () => rs.end(hd),
    };
  }
  _trailPuff(x, y, z, o) {
    if (Math.random() > this.budget + 0.2) return;
    const e = opt();
    e.kind = MATTER.SMOKE; e.color = o.col; e.alpha = o.alpha ?? 0.45; e.life = rand(0.9, 1.5);
    e.size = (o.size ?? 0.4) * 0.4; e.size1 = (o.size ?? 0.4) * rand(1, 1.4); e.drag = 2; e.gravity = -0.4; e.turb = 0.6;
    e.spin = rand(-0.6, 0.6); e.fadeIn = 0.05; e.fadeOut = 0.3;
    if (o.heat) { e.heat = o.heat; e.heatTime = 0.12; e.tint = _tint.set(o.tint || '#ff8a3a'); e.emissive = 1; }
    this.matter.emit(x, y, z, rand(-0.3, 0.3), rand(0.1, 0.5), rand(-0.3, 0.3), e);
  }

  update(dt) {
    this.time += dt;
    const Q = this._Q();
    this.budget = Q.fxBudget ?? 1;
    this.matter.setLight(Q.fxLight ?? 2);
    const t = this.time;
    this.glow.update(dt, t);
    this.matter.update(dt, t);
    this.ribbons.update(dt);
    this.heat.update(dt, !!Q.fxHeat);
    if (!this.game.R) this.matter.write(this.game.camera?.cam || this.game.camera);
    // débris instanciés
    let n = 0;
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life += dt;
      if (d.life >= d.max) { this._debrisFree.push(d); this.debris.splice(i, 1); continue; }
      d.v.y -= 24 * dt;
      d.p.addScaledVector(d.v, dt);
      if (d.p.y < d.floor + d.s * 0.5) {
        d.p.y = d.floor + d.s * 0.5;
        if (d.bounces++ === 0 && d.v.y < -4 && Math.random() < this.budget) this.dust(d.p, 1, this._dustColor(), 0.8, 0.5);
        d.v.y = Math.abs(d.v.y) * 0.35;
        d.v.x *= 0.6; d.v.z *= 0.6;
        d.w.multiplyScalar(0.6);
      }
      d.r.x += d.w.x * dt; d.r.y += d.w.y * dt; d.r.z += d.w.z * dt;
      // débris brûlant : refroidit et fume en vol
      if (d.heat > 0.05) {
        d.heat *= Math.exp(-2.4 * dt);
        d.smokeT -= dt;
        if (d.smokeT <= 0 && d.bounces === 0) {
          d.smokeT = 0.05 / Math.max(0.3, this.budget);
          const e = opt();
          e.kind = MATTER.SMOKE; e.color = _alb.set('#3a3236'); e.alpha = 0.45 * d.heat; e.life = rand(0.6, 1);
          e.size = d.s * 1.2; e.size1 = d.s * 4; e.drag = 2; e.gravity = -0.5; e.fadeIn = 0.04;
          e.heat = d.heat * 0.8; e.heatTime = 0.15; e.tint = _tint.set('#ff7a2a'); e.emissive = 1;
          this.matter.emit(d.p.x, d.p.y, d.p.z, 0, 0.3, 0, e);
        }
      }
    }
    const hArr = this.debrisHeat.array;
    for (const d of this.debris) {
      const k = 1 - Math.max(0, (d.life - d.max + 0.3) / 0.3);
      _q.setFromEuler(d.r);
      _m.compose(d.p, _q, _s.copy(d.sc).multiplyScalar(d.s * k));
      this.debrisMesh.setMatrixAt(n, _m);
      this.debrisMesh.setColorAt(n, d.color);
      hArr[n] = d.heat;
      n++;
    }
    this.debrisMesh.count = n;
    this.debrisMesh.instanceMatrix.needsUpdate = true;
    if (this.debrisMesh.instanceColor) this.debrisMesh.instanceColor.needsUpdate = true;
    this.debrisHeat.needsUpdate = true;

    for (let i = this.meshDebris.length - 1; i >= 0; i--) {
      const d = this.meshDebris[i];
      d.life += dt;
      const m = d.mesh;
      if (d.life >= d.max) {
        m.parent && m.parent.remove(m);
        this.meshDebris.splice(i, 1);
        continue;
      }
      d.v.y -= 22 * dt;
      m.position.addScaledVector(d.v, dt);
      if (m.position.y < d.floor + 0.1) {
        m.position.y = d.floor + 0.1;
        d.v.y = Math.abs(d.v.y) * 0.3;
        d.v.x *= 0.55; d.v.z *= 0.55;
        d.w.multiplyScalar(0.5);
      }
      m.rotation.x += d.w.x * dt; m.rotation.y += d.w.y * dt; m.rotation.z += d.w.z * dt;
      const k = clamp((d.max - d.life) / 0.4, 0, 1);
      m.scale.copy(d.s0).multiplyScalar(k);
      if (Math.random() < dt * 6 && d.life < d.max * 0.6) this.smoke(m.position, 1, '#2a2430', 0.5, 1);
    }
    for (const r of this.rings) {
      if (r.t >= r.dur) continue;
      r.t += dt;
      const tt = Math.min(1, r.t / r.dur);
      const e = 1 - Math.pow(1 - tt, 3);
      r.mesh.scale.setScalar(r.r0 + (r.r1 - r.r0) * e);
      const u = r.mesh.material.uniforms;
      u.uOpacity.value = (1 - tt) * (1 - tt * 0.5) * r.op;
      u.uT.value = tt;
      if (r.t >= r.dur) r.mesh.visible = false;
    }
    for (const d of this.decals) {
      if (!d.mesh.visible) continue;
      d.t += dt;
      const u = d.mesh.material.uniforms;
      u.uOpacity.value = Math.min(1, (d.life - d.t) / 2);
      u.uHeat.value = (d.heat || 0) * Math.max(0, 1 - d.t / 1.6);
      u.uTime.value = t;
      if (d.t >= d.life) d.mesh.visible = false;
    }
    for (const f of this.flashes) if (f.t < f.dur) f.t += dt;
    syncShared(this.game, t, this.flashes);
  }
}
