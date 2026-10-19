// Reflets du décor : sondes (cubemaps de la vraie scène) capturées au fil du parcours, là où Kobi passe, converties
// en PMREM et lues par tous les matériaux éclairés à la place de la carte du ciel (emplacement « indirectInputs ») :
// les métaux et surfaces lisses reflètent le canyon, les néons, les îles, et la lumière diffuse prend la couleur du
// décor proche (rebond orangé des parois, vert de la jungle, violet de la Station).
//
// Une zone = une sonde (tous les SPACING mètres environ). La capture est étalée sur plusieurs images (quelques faces
// par image, puis la conversion PMREM) ; on passe d'une sonde à l'autre en fondu. Pendant une capture : sans effets,
// sans Kobi ni ennemis, entrées écran coupées (screenInputs), lumières locales réattribuées autour de la sonde.
import * as THREE from 'three';
import { QUALITY, LAYERS, screenInputs } from './frame.js';
import { addSlot } from './shaderSlots.js';
import { lights } from './lightpool.js';
import { mat } from './materials.js';

Object.assign(QUALITY.ultra, { probes: true, probeSize: 128, probeCache: 8, probeFaces: 1 });
Object.assign(QUALITY.haute, { probes: true, probeSize: 64, probeCache: 6, probeFaces: 1 });
Object.assign(QUALITY.moyenne, { probes: false, probeSize: 64, probeCache: 0, probeFaces: 1 });

const SPACING = 13;
const FADE = 0.7;

const probeU = {
  tProbeA: { value: null },
  tProbeB: { value: null },
  // centre de la sonde (xyz) et rayon du décor capturé (w) pour la correction de parallaxe
  uProbeA: { value: new THREE.Vector4() },
  uProbeB: { value: new THREE.Vector4() },
  // part de l'ancienne sonde B (fondu), présence des sondes (0 : ciel seul), part de la diffuse prise aux sondes
  uProbeMix: { value: 0 },
  uProbeOn: { value: 0 },
  uProbeDiffuse: { value: 1 },
  // intensité des reflets pris aux sondes (le décor capturé est déjà éclairé : 1 = tel quel)
  uProbeSpec: { value: 1 },
  // géométrie de la texture PMREM (taille d'un texel, mip le plus fin)
  uProbeTexel: { value: new THREE.Vector2(1, 1) },
  uProbeMaxMip: { value: 7 },
};

// Lecture d'une PMREM de taille quelconque (copie de textureCubeUV de three.js, tailles en uniformes)
addSlot('pars', 'probes', /* glsl */ `
#if defined( ENVMAP_TYPE_CUBE_UV ) && defined( STANDARD )
uniform sampler2D tProbeA, tProbeB;
uniform vec4 uProbeA, uProbeB;
uniform float uProbeMix, uProbeOn, uProbeDiffuse, uProbeSpec, uProbeMaxMip;
uniform vec2 uProbeTexel;
vec3 kpBilinear( sampler2D map, vec3 dir, float mipInt ) {
  float face = getFace( dir );
  float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
  mipInt = max( mipInt, cubeUV_minMipLevel );
  float faceSize = exp2( mipInt );
  highp vec2 uv = getUV( dir, face ) * ( faceSize - 2.0 ) + 1.0;
  if ( face > 2.0 ) { uv.y += faceSize; face -= 3.0; }
  uv.x += face * faceSize + filterInt * 3.0 * cubeUV_minTileSize;
  uv.y += 4.0 * ( exp2( uProbeMaxMip ) - faceSize );
  // lecture à niveau explicite : pas de dérivées, la branche « sondes coupées » reste un vrai saut
  return textureLod( map, uv * uProbeTexel, 0.0 ).rgb;
}
vec3 kpSample( sampler2D map, vec3 dir, float roughness ) {
  float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, uProbeMaxMip );
  float mipF = fract( mip ), mipInt = floor( mip );
  vec3 c0 = kpBilinear( map, dir, mipInt );
  return mipF == 0.0 ? c0 : mix( c0, kpBilinear( map, dir, mipInt + 1.0 ), mipF );
}
// parallaxe : le décor capturé est assimilé à une sphère de rayon w autour de la sonde ; la correction s'efface
// à l'approche du bord de la sphère (pas de couture)
vec3 kpParallax( vec3 p, vec3 r, vec4 probe ) {
  vec3 d = p - probe.xyz;
  float b = dot( d, r ), c = dot( d, d ) - probe.w * probe.w;
  float h = b * b - c;
  if ( probe.w <= 0.0 || c >= 0.0 || h < 0.0 ) return r;
  vec3 q = normalize( d + r * ( sqrt( h ) - b ) );
  return normalize( mix( r, q, smoothstep( probe.w, probe.w * 0.6, length( d ) ) ) );
}
#endif`, probeU);

// Reflets (radiance) et lumière diffuse ambiante (iblIrradiance) pris aux sondes ; passe avant les reflets à l'écran
addSlot('indirectInputs', 'probes', /* glsl */ `
#if defined( ENVMAP_TYPE_CUBE_UV ) && defined( STANDARD ) && defined( RE_IndirectSpecular )
if ( uProbeOn > 0.0 ) {
  vec3 kpP = kobiWorldPos();
  vec3 kpN = transformDirectionByInverseViewMatrix( geometryNormal, viewMatrix );
  vec3 kpV = transformDirectionByInverseViewMatrix( geometryViewDir, viewMatrix );
  vec3 kpR = normalize( mix( reflect( - kpV, kpN ), kpN, pow4( material.roughness ) ) );
  vec3 kpS = kpSample( tProbeA, kpParallax( kpP, kpR, uProbeA ), material.roughness );
  vec3 kpD = kpSample( tProbeA, kpN, 1.0 );
  if ( uProbeMix > 0.0 ) {
    kpS = mix( kpS, kpSample( tProbeB, kpParallax( kpP, kpR, uProbeB ), material.roughness ), uProbeMix );
    kpD = mix( kpD, kpSample( tProbeB, kpN, 1.0 ), uProbeMix );
  }
  radiance = mix( radiance, kpS * uProbeSpec, uProbeOn );
  iblIrradiance = mix( iblIrradiance, PI * kpD * envMapIntensity, uProbeOn * uProbeDiffuse );
}
#endif`, {}, -10);

const _v = new THREE.Vector3();
const DIRS = [];
for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; DIRS.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a))); }
for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; DIRS.push(new THREE.Vector3(Math.cos(a) * 0.6, 0.8, Math.sin(a) * 0.6)); }
DIRS.push(new THREE.Vector3(0, 1, 0));

class ProbeSystem {
  constructor() {
    this.game = null;
    this.probes = [];
    this.job = null;
    this.A = null;
    this.B = null;
    this.size = 0;
    this.enabled = true;
    // durée des captures (ms, CPU) : mesure du coût
    this.stats = { captures: 0, ms: 0 };
  }
  // réglages de la planète : part de la diffuse prise aux sondes, intensité des reflets (remis à 1 au déchargement)
  set diffuse(v) { probeU.uProbeDiffuse.value = v; }
  set specular(v) { probeU.uProbeSpec.value = v; }
  attach(game) {
    if (this.game === game) return;
    this.game = game;
    game.R.onFrame.push((dt) => this.update(dt));
    // préchauffage pendant le chargement : tampons de la cubemap et shaders du générateur PMREM (≈ 0,5 s, une fois)
    if (game.R.Q.probes) this._setup(game.R.Q.probeSize);
  }
  _setup(size) {
    const r = this.game.R.renderer;
    this.size = size;
    if (this.cubeRT) this.cubeRT.dispose();
    this.cubeRT = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
    if (!this.cubeCam) {
      this.cubeCam = new THREE.CubeCamera(0.1, 600, this.cubeRT);
      this.cubeCam.layers.set(LAYERS.WORLD);
      for (const c of this.cubeCam.children) c.layers.set(LAYERS.WORLD);
    }
    this.cubeCam.renderTarget = this.cubeRT;
    this.cubeCam.coordinateSystem = r.coordinateSystem;
    this.cubeCam.updateCoordinateSystem();
    if (this.pmrem) this.pmrem.dispose();
    this.pmrem = new THREE.PMREMGenerator(r);
    const empty = new THREE.Scene();
    const prev = r.getRenderTarget();
    for (let f = 0; f < 6; f++) { r.setRenderTarget(this.cubeRT, f); r.render(empty, this.cubeCam.children[f]); }
    this.pmrem.fromCubemap(this.cubeRT.texture).dispose();
    r.setRenderTarget(prev);
    const lodMax = Math.log2(size);
    probeU.uProbeMaxMip.value = lodMax;
    probeU.uProbeTexel.value.set(1 / (3 * Math.max(size, 16 * 7)), 1 / (4 * size));
  }
  // Déchargement de la planète : sondes oubliées, réglages remis par défaut
  clear() {
    this._drop();
    probeU.uProbeDiffuse.value = 1;
    probeU.uProbeSpec.value = 1;
  }
  // Oublie toutes les sondes (changement de qualité, sondes coupées)
  _drop() {
    for (const p of this.probes) if (p.rt) p.rt.dispose();
    this.probes.length = 0;
    this.job = null;
    this.A = this.B = null;
    probeU.uProbeOn.value = 0;
    probeU.uProbeMix.value = 0;
    probeU.tProbeA.value = probeU.tProbeB.value = null;
  }

  update(dt) {
    const g = this.game;
    const Q = g.R.Q;
    const on = this.enabled && Q.probes && g.level && g.scene.environment;
    if (!on) {
      if (this.probes.length) this._drop();
      return;
    }
    if (this.size !== Q.probeSize) { this._drop(); this._setup(Q.probeSize); }
    const focus = _v.copy(g.player.pos);
    focus.y += 1.5;
    // nouvelle zone : aucune sonde (prête ou en cours) à moins de SPACING mètres
    let near = Infinity;
    for (const p of this.probes) near = Math.min(near, dist(p.pos, focus));
    if (!this.job && near > SPACING && (g.player.grounded || !this.probes.length)) this._start(focus);
    // la carte d'ombre du soleil doit exister (elle est recréée après un changement de qualité)
    const sun = g.level.sun;
    if (this.job && !(sun && sun.castShadow && !sun.shadow.map)) this._step(Q.probeFaces);
    this._blend(dt, focus);
  }

  _start(pos) {
    const Q = this.game.R.Q;
    // réserve pleine : la sonde la plus éloignée (hors sondes affichées) cède sa texture
    let rt = null;
    if (this.probes.length >= Q.probeCache) {
      let worst = null;
      for (const p of this.probes) {
        if (p === this.A || p === this.B || !p.rt) continue;
        if (!worst || dist(p.pos, pos) > dist(worst.pos, pos)) worst = p;
      }
      if (!worst) return;
      this.probes.splice(this.probes.indexOf(worst), 1);
      rt = worst.rt;
    }
    const probe = { pos: pos.clone(), radius: this._radius(pos), rt, ready: false };
    this.probes.push(probe);
    this.job = { probe, face: 0 };
  }
  // rayon du décor autour de la sonde (médiane des distances aux obstacles), pour la parallaxe
  _radius(pos) {
    const w = this.game.world;
    const d = DIRS.map((dir) => { const hit = w.raycast(pos, dir, 45); return hit ? hit.t : 45; }).sort((a, b) => a - b);
    return THREE.MathUtils.clamp(d[Math.floor(d.length / 2)] * 1.1, 6, 45);
  }
  _step(faces) {
    const g = this.game;
    const job = this.job;
    const r = g.R.renderer;
    const t0 = performance.now();
    const cam = this.cubeCam;
    if (job.face === 0) { cam.position.copy(job.probe.pos); cam.updateMatrixWorld(true); }
    const restore = this._isolate(job.probe.pos);
    const prevRT = r.getRenderTarget();
    const ac = r.autoClear;
    r.autoClear = true;
    const end = Math.min(6, job.face + faces);
    for (; job.face < end; job.face++) {
      r.setRenderTarget(this.cubeRT, job.face);
      r.render(g.scene, cam.children[job.face]);
    }
    r.setRenderTarget(prevRT);
    r.autoClear = ac;
    restore();
    if (job.face >= 6) {
      // conversion PMREM, dans la texture d'une sonde abandonnée quand il y en a une
      const p = job.probe;
      p.rt = this.pmrem.fromCubemap(this.cubeRT.texture, p.rt || null);
      r.setRenderTarget(prevRT);
      p.ready = true;
      this.job = null;
      this.stats.captures++;
    }
    this.stats.ms += performance.now() - t0;
  }
  // Prépare la scène pour une capture : seuls le décor et les lumières restent ; renvoie la fonction de restauration
  _isolate(pos) {
    const g = this.game;
    const hidden = [];
    for (const o of g.scene.children) {
      if (o === g.level.root || o.isLight || !o.visible) continue;
      o.visible = false;
      hidden.push(o);
    }
    // particules d'ambiance qui suivent la caméra, végétation dense (userData.noProbe : trop chère pour un reflet flou)
    for (const o of g.level.root.children) if ((o.isPoints || o.userData.noProbe) && o.visible) { o.visible = false; hidden.push(o); }
    const on = probeU.uProbeOn.value;
    probeU.uProbeOn.value = 0;
    screenInputs(false);
    const lightsBack = lights.focusAt(pos);
    return () => {
      for (const o of hidden) o.visible = true;
      probeU.uProbeOn.value = on;
      screenInputs(true);
      lightsBack();
    };
  }
  // Sonde affichée : la plus proche parmi les prêtes, fondu depuis la précédente
  _blend(dt, focus) {
    let best = null, bd = Infinity;
    for (const p of this.probes) {
      if (!p.ready) continue;
      const d = dist(p.pos, focus);
      if (d < bd) { bd = d; best = p; }
    }
    const u = probeU;
    if (best && best !== this.A && u.uProbeMix.value <= 0 && (!this.A || bd < dist(this.A.pos, focus) - 3)) {
      if (this.A) { this.B = this.A; u.uProbeMix.value = 1; }
      this.A = best;
    }
    if (u.uProbeMix.value > 0) u.uProbeMix.value = Math.max(0, u.uProbeMix.value - dt / FADE);
    if (u.uProbeMix.value <= 0) this.B = null;
    u.uProbeOn.value = this.A ? Math.min(1, u.uProbeOn.value + dt / FADE) : 0;
    if (this.A) { u.tProbeA.value = this.A.rt.texture; u.uProbeA.value.set(this.A.pos.x, this.A.pos.y, this.A.pos.z, this.A.radius); }
    if (this.B) { u.tProbeB.value = this.B.rt.texture; u.uProbeB.value.set(this.B.pos.x, this.B.pos.y, this.B.pos.z, this.B.radius); }
  }
}

// Outil de mise au point : sphère chromée devant Kobi (console : __probes.sphere(), __probes.sphere(false))
if (import.meta.env.DEV) ProbeSystem.prototype.sphere = function (on = true, rough = 0.03) {
  const g = this.game;
  if (this._sphere) { this._sphere.removeFromParent(); this._sphere = null; }
  if (!on) return;
  const m = mat('#ffffff', { rough, metal: 1, unique: true });
  const s = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), m);
  s.position.copy(g.player.pos).add(_v.set(Math.sin(g.camera.yaw) * 2.4, 1.3, Math.cos(g.camera.yaw) * 2.4));
  g.level.root.add(s);
  this._sphere = s;
};

// distance pondérée : un écart de hauteur compte double (étages, plateformes)
function dist(a, b) {
  const dx = a.x - b.x, dy = (a.y - b.y) * 2, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export const probes = new ProbeSystem();
if (import.meta.env.DEV && typeof window !== 'undefined') { window.__probes = probes; probes.u = probeU; }
