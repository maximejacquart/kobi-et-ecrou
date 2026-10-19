// Système d'eau : plans d'eau (eau, lave, acide, glace), cascades, ondes dynamiques, éclaboussures, caustiques,
// réflexion planaire et vue sous l'eau. Un plan d'eau s'ajoute en une ligne depuis un niveau :
//   createWater(L, { rect: [x0, z0, largeur, profondeur], y: -4, preset: 'riviere', flow: [0.6, 0] })
//   createWater(L, { shape: [[x, z], …], y: 2, preset: 'lagon' })          (oasis, ocean, nuit, marais, lave,
//   createWaterfall(L, { from: [x, y, z], to: yPied, width: 6, dir: angle, pool })    metal, glace : voir plus bas)
// et l'eau réagit d'elle-même : waterImpulse(pos, force) depuis le jeu (pas, tirs, explosions…).
// API : createWater → plan d'eau (mesh, heightAt, flowAt, contains, addLamp) ; createWaterfall ; waterImpulse ;
//       waterAt(x, z, y) ; waterFloaters (objets qui dérivent) ; WATER_PRESETS.
// Options principales de createWater (toutes facultatives sauf rect/shape) : type, preset, y, shallow, deep,
//   absorb [r, g, b] (par mètre), turbidity, foam, shore (largeur d'écume en profondeur), flow [x, z] ou flowFn,
//   obstacles [[x, z, rayon]] (sillages), waves [[direction, amplitude, longueur]] ou { amp, length, dir },
//   glowAmount / glow (plancton), caustics, reflect, crust (lave), heat (brume de chaleur, lave).
// Console : __game.R.water (système), __game.R.water.waterU.uWDebug.value = 1…7 (termes du shader, réglages).
import * as THREE from 'three';
import { frameU, LAYERS, QUALITY } from '../frame.js';
import { waterU, surfaceMaterial, surfaceUniforms } from './surface.js';
import { RippleSim } from './ripples.js';
import { PlanarReflection } from './reflection.js';
import { Splashes } from './splash.js';
import { UnderwaterPass } from './underwater.js';
import { initCaustics, MAX_VOLUMES } from './caustics.js';
import { buildWaterfall } from './waterfall.js';
import { waveTexture, foamTexture } from './textures.js';
import { heatHaze } from './heat.js';

// Réglages par qualité (lus via R.Q) :
//  waterReflect  'planar' : miroir de la scène à demi-résolution ; 'env' : carte d'environnement (ciel)
//  waterRipples  résolution de la simulation d'ondes (0 : aucune)
//  waterDetail   couches de normales de détail (2 : trois couches et scintillements fins)
//  waterSplash   densité des éclaboussures
Object.assign(QUALITY.ultra, { waterReflect: 'planar', waterSSR: 32, waterReflectScale: 0.5, waterRipples: 256, waterDetail: 2, waterSplash: 1 });
Object.assign(QUALITY.haute, { waterReflect: 'env', waterSSR: 24, waterReflectScale: 0.5, waterRipples: 256, waterDetail: 1, waterSplash: 1 });
Object.assign(QUALITY.moyenne, { waterReflect: 'env', waterSSR: 0, waterReflectScale: 0.5, waterRipples: 128, waterDetail: 0, waterSplash: 0.6 });

// caméra sous l'eau (lisible par les autres modules)
frameU.uCamUnderwater = { value: 0 };

// ------------------------------------------------------------------ réglages
const BASE = {
  type: 'eau', y: 0, cell: 0,
  shallow: '#8cf2e0', deep: '#0a3a4e', absorb: [0.42, 0.1, 0.065], turbidity: 0.1,
  foamColor: '#f4fbff', foam: 1, shore: 0.4, edge: 0.1,
  flow: [0, 0], flowFn: null, obstacles: [], wake: 1,
  waves: null, steep: 0.45,
  normal: 0.17, scale: [7.5, 2.7, 0.95], refraction: 0.07, roughness: 0.03, ior: 1.333,
  glow: '#3affd0', glowAmount: 0, glowIntensity: 1, rippleStrength: 1.8,
  caustics: 1, causticScale: 0.22, causticAbsorb: 0.12,
  reflect: true, splash: '#eaf7ff', fumes: 0, embers: 0,
};
// variantes : même cœur, autres paramètres
const TYPES = {
  eau: {},
  acide: {
    shallow: '#c8ff5a', deep: '#2a7a14', absorb: [1.4, 0.3, 1.9], turbidity: 2.2, foamColor: '#e8ff9a', glow: '#7aff4a', glowIntensity: 0.3,
    ior: 1.38, roughness: 0.05, normal: 0.06, caustics: 0.5, causticScale: 0.3, splash: '#b6ff6a', fumes: 1, shore: 0.06,
    waves: [[0.4, 0.015, 5], [2.1, 0.01, 3.1]],
  },
  lave: {
    shallow: '#ff5210', deep: '#241612', glow: '#ffb447', glowIntensity: 1.6, roughness: 0.18, normal: 1, caustics: 0, refraction: 0,
    flow: [0.12, 0.04], waves: [[0.3, 0.05, 9], [1.9, 0.03, 5.5]], steep: 0.2, splash: '#ffb040', embers: 1, foam: 0, reflect: false, crust: 0.55,
  },
  glace: {
    shallow: '#d8f6ff', deep: '#0d4868', absorb: [0.3, 0.09, 0.06], turbidity: 0.25, roughness: 0.1, ior: 1.31, foamColor: '#f2f9ff',
    normal: 0.25, caustics: 0, refraction: 0.03, waves: [], foam: 0.9, splash: '#f0faff',
  },
};
// préréglages prêts à l'emploi (phase 2 : oasis, lagons, eau libre, lac gelé…)
const WATER_PRESETS = {
  riviere: { flow: [0.7, 0], waves: [[0.2, 0.025, 4.5], [1.3, 0.018, 2.6]] },
  lagon: { shallow: '#6af4e4', deep: '#0b5674', absorb: [0.34, 0.06, 0.045], turbidity: 0.05, waves: [[0.3, 0.09, 10], [1.2, 0.06, 6], [2.5, 0.04, 3.4]], shore: 0.45 },
  oasis: { shallow: '#9af0d0', deep: '#0e4a50', absorb: [0.4, 0.09, 0.08], turbidity: 0.09, waves: [[0.5, 0.02, 5], [2.2, 0.015, 2.8]] },
  ocean: { shallow: '#5ae0e8', deep: '#062e48', absorb: [0.38, 0.08, 0.05], turbidity: 0.08, waves: [[0.2, 0.32, 24], [0.9, 0.2, 14], [-0.5, 0.12, 8], [1.6, 0.07, 4.5]], shore: 1.4, steep: 0.6 },
  nuit: { shallow: '#4adcc8', deep: '#03202e', absorb: [0.5, 0.13, 0.09], turbidity: 0.16, glowAmount: 1, glow: '#3affd0' },
  marais: { type: 'acide' },
  lave: { type: 'lave' },
  metal: { type: 'lave', shallow: '#ff5a0c', glow: '#ffd88a', deep: '#3a2a24', glowIntensity: 1.2, crust: 0.42, roughness: 0.14 },
  glace: { type: 'glace' },
};

// ------------------------------------------------------------------ système (un par moteur de rendu)
let S = null;
const _frustum = new THREE.Frustum();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _c = new THREE.Color();

function system(L) {
  const g = L.game;
  const R = g.R;
  if (S && S.R === R) { S.game = g; return S; }
  initCaustics();
  waterU.tWaves.value = waveTexture();
  waterU.tWFoam.value = foamTexture();
  S = {
    R, game: g, bodies: [], falls: [], time: 0, q: null,
    ripple: new RippleSim(R.renderer, 256, 44),
    refl: new PlanarReflection(R, waterU),
    splash: new Splashes(R.scene),
    under: new UnderwaterPass(),
    focus: null,
    ambient: new THREE.Color(0.35, 0.38, 0.42),
    ambT: 0,
    wade: { prevY: null, t: 0 },
    projY: new WeakMap(),
  };
  waterU.tRipple.value = S.ripple.texture;
  // accès depuis la console : __game.R.water (système, uniformes communs)
  S.waterU = waterU;
  S.frameU = frameU;
  R.water = S;
  R.preLight.push(S.refl);
  S.refl.setSize();
  R.addPost(S.under, 'bloom');
  S.splash.onLand = (x, y, z) => { if (Math.random() < 0.3) S.ripple.impulse(x, z, 0.12, 0.004); };
  R.onFrame.push(update);
  return S;
}

// ------------------------------------------------------------------ plans d'eau
class WaterBody {
  constructor(L, o) {
    this.L = L;
    this.o = o;
    this.type = o.type;
    this.y = o.y;
    if (o.shape) {
      this.shape = o.shape;
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const [x, z] of o.shape) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
      this.rect = [x0, z0, x1 - x0, z1 - z0];
    } else this.rect = o.rect;
    const [x0, z0, w, d] = this.rect;
    this.box = new THREE.Box3(new THREE.Vector3(x0, o.y - 2, z0), new THREE.Vector3(x0 + w, o.y + 1, z0 + d));
    this.waves = o.waves;
    if (o.flowFn || (o.obstacles && o.obstacles.length)) Object.assign(o, bakeFlow(o, this.rect));
    this.u = surfaceUniforms(o);
    this.material = surfaceMaterial(o.type, o, this.u);
    this.mesh = new THREE.Mesh(buildGeometry(this.rect, o), this.material);
    this.mesh.name = 'eau-' + o.type;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.userData.noAO = true;
    this.mesh.userData.water = this;
    if (o.type !== 'lave') this.mesh.layers.set(LAYERS.WATER);
    L.root.add(this.mesh);
    // lave : brume de chaleur au-dessus
    if (o.type === 'lave' && o.heat !== false) this.heat = heatHaze(L, this.rect, o.y, o.heatHeight ?? 4, o.heat ?? 1.6);
    this.visible = false;
    this.updaters = [];
    this.lamps = [];
  }
  // Lanterne au-dessus de l'eau (12 au plus) : reflet en traînée et halo sur la surface. pos : Vector3 (suivi
  // s'il bouge), intensity ~1. Renvoie l'entrée (modifiable).
  addLamp(pos, color = '#ffc46a', intensity = 1) {
    const l = { pos, color: new THREE.Color(color), intensity };
    if (this.lamps.length < 12) this.lamps.push(l);
    return l;
  }
  _syncLamps(cp) {
    const u = this.u;
    // les plus proches de la caméra d'abord
    const list = this.lamps.length > 12 ? this.lamps.slice().sort((a, b) => a.pos.distanceToSquared(cp) - b.pos.distanceToSquared(cp)) : this.lamps;
    const n = Math.min(12, list.length);
    for (let i = 0; i < n; i++) {
      const l = list[i];
      u.uLamp.value[i].set(l.pos.x, l.pos.y, l.pos.z, l.intensity);
      u.uLampCol.value[i].copy(l.color);
    }
    u.uLampN.value = n;
  }
  contains(x, z) {
    const [x0, z0, w, d] = this.rect;
    if (x < x0 || z < z0 || x > x0 + w || z > z0 + d) return false;
    return this.shape ? inPolygon(x, z, this.shape) : true;
  }
  // hauteur de la surface (houle comprise) au temps courant
  heightAt(x, z, t = S ? S.time : 0) {
    let h = this.y;
    for (const w of this.waves) {
      const k = (2 * Math.PI) / w[2];
      const c = Math.sqrt(9.8 / k);
      h += w[1] * Math.sin(k * (Math.cos(w[0]) * x + Math.sin(w[0]) * z - c * t));
    }
    return h;
  }
  // courant au point (carte cuite : contourne les obstacles)
  flowAt(x, z, out = new THREE.Vector2()) {
    const fc = this.o.flowCpu;
    if (fc) {
      const [x0, z0, w, d] = this.rect;
      const i = Math.min(fc.n - 1, Math.max(0, Math.floor(((x - x0) / w) * fc.n)));
      const j = Math.min(fc.n - 1, Math.max(0, Math.floor(((z - z0) / d) * fc.n)));
      return out.set(fc.vx[j * fc.n + i], fc.vz[j * fc.n + i]);
    }
    return out.set(this.o.flow[0], this.o.flow[1]);
  }
  get alive() {
    let p = this.mesh;
    while (p.parent) p = p.parent;
    return S && p === S.R.scene;
  }
}

function inPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Grille en coordonnées monde (assez fine pour la houle) ; pour un polygone, seules les cellules qui le touchent
function buildGeometry(rect, o) {
  const [x0, z0, w, d] = rect;
  const cell = o.cell || THREE.MathUtils.clamp(Math.max(w, d) / 110, 0.5, 2.5);
  const nx = Math.max(1, Math.ceil(w / cell)), nz = Math.max(1, Math.ceil(d / cell));
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      pos.push(x0 + (i / nx) * w, o.y, z0 + (j / nz) * d);
      uv.push(i / nx, j / nz);
    }
  }
  const pad = cell * 1.5;
  const keep = (i, j) => {
    if (!o.shape) return true;
    const cx = x0 + ((i + 0.5) / nx) * w, cz = z0 + ((j + 0.5) / nz) * d;
    if (inPolygon(cx, cz, o.shape)) return true;
    // cellule de bord : gardée si un coin (élargi) est dedans
    for (const [dx, dz] of [[-pad, -pad], [pad, -pad], [-pad, pad], [pad, pad]]) if (inPolygon(cx + dx, cz + dz, o.shape)) return true;
    return false;
  };
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      if (!keep(i, j)) continue;
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, e = c + 1;
      idx.push(a, c, b, b, c, e);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  // la houle soulève la surface : marge pour le découpage
  geo.boundingSphere.radius += 2;
  return geo;
}

// Carte de courant : courant de base (ou fonction), contourné par les obstacles (écoulement potentiel autour
// d'un cylindre) ; le canal bleu porte l'écume de sillage (étrave + traîne qui s'élargit en aval).
function bakeFlow(o, rect) {
  const [x0, z0, w, d] = rect;
  const N = Math.min(256, Math.max(32, Math.ceil(Math.max(w, d) * 2)));
  const vx = new Float32Array(N * N), vz = new Float32Array(N * N), wk = new Float32Array(N * N);
  let max = 0.05;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = x0 + ((i + 0.5) / N) * w, z = z0 + ((j + 0.5) / N) * d;
      let [ux, uz] = o.flowFn ? o.flowFn(x, z) : o.flow;
      const U = Math.hypot(ux, uz);
      let fx = ux, fz = uz, wake = 0;
      if (U > 1e-4) {
        const dx = ux / U, dz = uz / U;
        for (const [ox, oz, a] of o.obstacles || []) {
          // repère de l'écoulement : s le long du courant, l en travers
          const rx = x - ox, rz = z - oz;
          const s = rx * dx + rz * dz, l = -rx * dz + rz * dx;
          const r2 = s * s + l * l;
          if (r2 < a * a) { fx = 0; fz = 0; wake = 1; continue; }
          // vitesse complexe U(1 - a²/ζ²), ζ = s + i l
          const a2 = a * a, q = r2 * r2;
          const re = 1 - (a2 * (s * s - l * l)) / q, im = (a2 * 2 * s * l) / q;
          const ps = U * re - U, pl = -U * im;
          fx += ps * dx - pl * dz;
          fz += ps * dz + pl * dx;
          const r = Math.sqrt(r2);
          const bow = Math.exp(-(((r - a) / (0.3 + a * 0.12)) ** 2)) * (s < 0 ? 1 : 0.7);
          // traîne : deux bras qui partent des flancs et s'écartent en aval
          const sp = a * (0.75 + s * 0.09);
          const arms = Math.exp(-(((Math.abs(l) - sp) / (0.25 + s * 0.05)) ** 2)) + Math.exp(-((l / sp) ** 2)) * 0.35;
          const tail = s > 0 ? Math.exp(-s / (4 + a * 2.2)) * arms : 0;
          wake = Math.max(wake, bow, tail * 0.85);
        }
      }
      const k = j * N + i;
      // un courant lent ne laisse presque pas de sillage
      vx[k] = fx; vz[k] = fz; wk[k] = wake * (o.wake ?? 1) * THREE.MathUtils.smoothstep(U, 0.05, 0.6);
      max = Math.max(max, Math.hypot(fx, fz));
    }
  }
  const data = new Uint8Array(N * N * 4);
  for (let k = 0; k < N * N; k++) {
    data[k * 4] = Math.round((vx[k] / max * 0.5 + 0.5) * 255);
    data[k * 4 + 1] = Math.round((vz[k] / max * 0.5 + 0.5) * 255);
    data[k * 4 + 2] = Math.round(Math.min(1, wk[k]) * 255);
    data[k * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return { flowMap: t, flowMax: max, flowRect: [x0, z0, w, d], flowCpu: { n: N, vx, vz } };
}

// Résout les options : base ← type ← préréglage ← options
function resolve(opts) {
  const preset = opts.preset ? WATER_PRESETS[opts.preset] || {} : {};
  const type = opts.type || preset.type || 'eau';
  const o = { ...BASE, ...TYPES[type], ...preset, ...opts, type };
  // vagues : [[direction (rad), amplitude, longueur d'onde], …] ou { amp, length, dir }
  if (!Array.isArray(o.waves)) {
    if (o.waves && typeof o.waves === 'object') {
      const { amp = 0.05, length = 5, dir = 0.3 } = o.waves;
      o.waves = [[dir, amp * 0.55, length], [dir + 1.1, amp * 0.3, length * 0.6], [dir - 0.9, amp * 0.15, length * 0.37]];
    } else o.waves = [[0.3, 0.035, 6], [1.4, 0.022, 3.6], [2.5, 0.012, 2.1]];
  }
  o.waves = o.waves.slice(0, 4);
  return o;
}

// API : crée un plan d'eau. L : niveau (L.root, L.game.R). Voir WATER_PRESETS et BASE pour les options.
export function createWater(L, opts = {}) {
  const sys = system(L);
  const o = resolve(opts);
  if (!o.rect && !o.shape) throw new Error('createWater : rect ou shape requis');
  const b = new WaterBody(L, o);
  sys.bodies.push(b);
  return b;
}

// API : cascade (voir waterfall.js pour les options) ; o.pool : plan d'eau du pied
export function createWaterfall(L, o = {}) {
  const sys = system(L);
  const f = buildWaterfall(L, o, sys.R);
  sys.falls.push(f);
  return f;
}

// Plan d'eau (y compris lave/acide/glace) au point (x, z) ; y facultatif : la surface doit être proche
// y facultatif : la surface doit être proche (au plus « up » au-dessus, « down » en dessous)
function waterAt(x, z, y, down = 2, up = 0.6) {
  if (!S) return null;
  for (const b of S.bodies) {
    if (!b.contains(x, z)) continue;
    if (y !== undefined && (y > b.y + up || y < b.y - down)) continue;
    return b;
  }
  return null;
}

// Impulsion dans l'eau (pas, atterrissage, tir, explosion) : onde, éclaboussure. Renvoie le plan touché ou null.
// force : 0,2 (pas) … 1 (atterrissage lourd) … 3 (explosion)
export function waterImpulse(pos, force = 1, o = {}) {
  if (!S) return null;
  const b = waterAt(pos.x, pos.z, pos.y, o.depth ?? 1.8, o.up ?? 0.3);
  if (!b) return null;
  const y = b.heightAt(pos.x, pos.z);
  const f = Math.max(0.05, force);
  if (b.type !== 'glace') {
    // creux, puis rebonds : plusieurs anneaux serrés
    const r = 0.2 + Math.min(f, 2) * 0.16, k = 0.016 + f * 0.032;
    S.ripple.impulse(pos.x, pos.z, r, k);
    if (f > 0.35) {
      S.ripple.impulse(pos.x, pos.z, r * 0.8, -k * 0.6, 0.13);
      S.ripple.impulse(pos.x, pos.z, r * 0.7, k * 0.35, 0.26);
    }
  }
  const dens = S.R.Q.waterSplash ?? 1;
  S.splash.density = dens;
  if (b.type === 'lave') {
    for (let i = 0; i < Math.round((3 + f * 12) * dens); i++) S.splash.ember(pos.x, y, pos.z, b.o.splash, 0.6 + f * 0.5);
  } else if (b.type === 'glace') {
    if (f > 0.5) S.splash.burst(pos.x, y + 0.02, pos.z, f * 0.25, { color: b.o.splash, mist: true });
  } else {
    if (f > 0.12) S.splash.burst(pos.x, y, pos.z, f, { color: b.o.splash, mist: f > 0.4 });
    if (b.type === 'acide' && f > 0.3) S.splash.fume(pos.x, y + 0.3, pos.z, b.o.shallow, 0.2, 0.8 + f);
  }
  return b;
}

// Objets flottants (lanternes, feuilles, glaçons) : dérivent avec le courant (en contournant les obstacles),
// dansent sur la houle, et reviennent en amont quand ils sortent du plan d'eau.
// o : { count, make(i) → Object3D, lamp(i) → [couleur, intensité, hauteur], spin, wake, lift,
//       region: [x0, z0, l, p] (zone parcourue, sinon tout le plan) }
export function waterFloaters(L, body, o = {}) {
  const items = [];
  const [x0, z0, w, d] = o.region || body.rect;
  const n = o.count ?? 6;
  const spawn = (it, first) => {
    for (let k = 0; k < 30; k++) {
      const f = body.flowAt(x0 + w / 2, z0 + d / 2, _v2);
      const len = Math.hypot(f.x, f.y) || 1;
      // départ : n'importe où la première fois, ensuite sur le bord amont
      let x = x0 + Math.random() * w, z = z0 + Math.random() * d;
      if (!first) {
        if (Math.abs(f.x) / len > Math.abs(f.y) / len) x = f.x > 0 ? x0 + 0.5 : x0 + w - 0.5;
        else z = f.y > 0 ? z0 + 0.5 : z0 + d - 0.5;
      }
      if (!body.contains(x, z)) continue;
      const fl = body.flowAt(x, z, _v2);
      if (Math.hypot(fl.x, fl.y) < 0.02 && body.o.flowCpu) continue;
      it.x = x; it.z = z;
      return;
    }
  };
  for (let i = 0; i < n; i++) {
    const obj = o.make(i);
    obj.userData.noAO = true;
    L.root.add(obj);
    const it = { obj, x: 0, z: 0, ph: Math.random() * 6.28, yaw: Math.random() * 6.28, wakeT: Math.random() };
    spawn(it, true);
    // o.lamp(i) → [couleur, intensité, hauteur] : la lanterne se reflète dans l'eau
    if (o.lamp) { const [c, k, h] = o.lamp(i); it.lamp = body.addLamp(new THREE.Vector3(), c, k); it.lampH = h ?? 0.3; }
    items.push(it);
  }
  const speed = o.speed ?? 1;
  body.updaters.push((dt, t) => {
    for (const it of items) {
      const f = body.flowAt(it.x, it.z, _v2);
      it.x += f.x * dt * speed;
      it.z += f.y * dt * speed;
      const [bx, bz, bw, bd] = o.region || body.rect;
      if (it.x < bx || it.z < bz || it.x > bx + bw || it.z > bz + bd || !body.contains(it.x, it.z)) spawn(it, false);
      const y = body.heightAt(it.x, it.z, t);
      it.yaw += (o.spin ?? 0.15) * dt * Math.sin(it.ph);
      it.obj.position.set(it.x, y + (o.lift ?? 0), it.z);
      if (it.lamp) it.lamp.pos.set(it.x, y + it.lampH, it.z);
      it.obj.rotation.set(Math.sin(t * 1.3 + it.ph) * 0.06, it.yaw, Math.cos(t * 1.1 + it.ph) * 0.06);
      // petit sillage dans la simulation d'ondes
      it.wakeT -= dt;
      if (it.wakeT <= 0 && (o.wake ?? true)) { it.wakeT = 0.35; S.ripple.impulse(it.x, it.z, 0.25, 0.004); }
    }
  });
  return items;
}

// Pour le banc d'essai : point suivi par la simulation d'ondes (sinon Kobi, sinon la caméra)
export function setWaterFocus(v) { if (S) S.focus = v; }
export function waterSystem() { return S; }
export function waterSplashes(L) { return system(L).splash; }

// ------------------------------------------------------------------ image par image
function applyQuality() {
  const Q = S.R.Q;
  S.q = Q;
  waterU.uWDetail.value = Q.waterDetail ?? 1;
  S.refl.scale = Q.waterReflectScale ?? 0.5;
  S.refl.setSize();
  if (Q.waterRipples) S.ripple.setSize(Q.waterRipples);
  S.splash.density = Q.waterSplash ?? 1;
}

function update(dt) {
  const R = S.R;
  // plans d'eau des niveaux déchargés : oubliés (le niveau a libéré maillages et matériaux, reste la carte de courant)
  if (S.bodies.length && S.bodies.some((b) => !b.alive)) {
    for (const b of S.bodies) if (!b.alive && b.o.flowMap) b.o.flowMap.dispose();
    S.bodies = S.bodies.filter((b) => b.alive);
  }
  if (S.falls.length && S.falls.some((f) => !f.alive)) S.falls = S.falls.filter((f) => f.alive);
  waterU.uRefl.value.y = 0;
  S.refl.enabled = false;
  // reflets tracés à l'écran depuis la surface (Haute ; en Ultra, pour les plans d'eau sans miroir)
  waterU.uWSSR.value = R.Q.waterSSR ? 1 : 0;
  waterU.uWSSRSteps.value = R.Q.waterSSR || 24;
  if (!S.bodies.length && !S.falls.length) {
    frameU.uWaterN.value = 0;
    S.under.enabled = false;
    frameU.uCamUnderwater.value = 0;
    S.splash.clear();
    S.splash.update(0);
    return;
  }
  if (R.Q !== S.q || S.refl.rt.width <= 2) applyQuality();
  S.time += dt;
  waterU.uWTime.value = S.time;
  frameU.uWaterTime.value = S.time;
  const cam = R.camera;
  const cp = cam.position;

  // volumes de caustiques (les plus proches d'abord)
  let n = 0;
  const near = S.bodies.filter((b) => b.o.caustics > 0).sort((a, b) => a.box.distanceToPoint(cp) - b.box.distanceToPoint(cp));
  for (const b of near) {
    if (n >= MAX_VOLUMES) break;
    const [x0, z0, w, d] = b.rect;
    frameU.uWaterVol.value[n].set(x0, z0, x0 + w, z0 + d);
    frameU.uWaterVolB.value[n].set(b.y, b.o.caustics, b.o.causticScale, b.o.causticAbsorb);
    frameU.uWaterFlow.value[n].set(b.o.flow[0], b.o.flow[1]);
    n++;
  }
  frameU.uWaterN.value = n;

  // visibilité, plan de réflexion
  _m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_m);
  let best = null, bestScore = 0;
  for (const b of S.bodies) {
    b.visible = _frustum.intersectsBox(b.box);
    if (!b.visible || !b.o.reflect || b.type === 'lave' || cp.y < b.y) continue;
    // part de l'écran couverte (boîte projetée) : un plan d'eau lointain ou à peine visible garde le ciel
    const score = screenCover(b, cam);
    if (score > bestScore) { bestScore = score; best = b; }
  }
  if (best && bestScore > 0.03 && R.Q.waterReflect === 'planar') {
    S.refl.y = best.y;
    S.refl.enabled = true;
  }

  // ondes : fenêtre centrée sur Kobi (ou le point suivi)
  const g = S.game;
  const player = g && g.player && g.player.pos ? g.player : null;
  const focus = S.focus || (player ? player.pos : null) || _v.copy(cp);
  const nearWater = S.bodies.some((b) => b.type !== 'glace' && b.box.distanceToPoint(focus) < 40);
  if (R.Q.waterRipples && nearWater) {
    S.ripple.update(dt, focus.x, focus.z);
    waterU.tRipple.value = S.ripple.texture;
    waterU.uRipple.value.set(S.ripple.center.x, S.ripple.center.y, S.ripple.area, S.ripple.active ? 1 : 0);
  } else waterU.uRipple.value.w = 0;

  if (g) gameHooks(g, dt);

  // sous l'eau
  let under = null;
  for (const b of S.bodies) if (b.type !== 'lave' && b.contains(cp.x, cp.z) && cp.y < b.heightAt(cp.x, cp.z) - 0.05 && cp.y > b.y - 60) { under = b; break; }
  S.under.enabled = !!under;
  frameU.uCamUnderwater.value = under ? 1 : 0;
  if (under) {
    const u = S.under.mat.uniforms;
    u.uTime.value = S.time;
    u.uLevel.value = under.y;
    u.uColor.value.copy(under.u.uDeep.value).multiplyScalar(0.7 + 0.3 * Math.max(0, frameU.uSunDir.value.y));
    u.uAbsorb.value.copy(under.u.uAbsorb.value);
    u.uDensity.value = 0.04 + under.o.turbidity * 0.5;
  }

  // lumière approximative des éclaboussures et des cascades : ciel (lumière d'hémisphère) + soleil
  S.ambT -= dt;
  if (S.ambT <= 0) {
    S.ambT = 0.5;
    const h = findHemi(R.scene, 0);
    if (h) S.ambient.copy(h.color).multiplyScalar(0.7).add(_c.copy(h.groundColor).multiplyScalar(0.3)).multiplyScalar(h.intensity * 0.38);
  }
  const sc = frameU.uSunColor.value, sy = Math.max(0, frameU.uSunDir.value.y);
  _c.copy(S.ambient).add(_c2.copy(sc).multiplyScalar(0.1 + 0.18 * sy));
  S.splash.setLight(_c);
  S.splash.setScale(R.renderer.getDrawingBufferSize(_v2).y * 0.6);
  // fumerolles et braises
  for (const b of S.bodies) {
    if (!b.visible || b.box.distanceToPoint(cp) > 60) continue;
    const area = b.rect[2] * b.rect[3];
    if (b.o.fumes && Math.random() < dt * Math.min(6, area * 0.004) * S.splash.density) {
      const [x0, z0, w, d] = b.rect;
      const x = x0 + Math.random() * w, z = z0 + Math.random() * d;
      if (b.contains(x, z) && Math.hypot(x - cp.x, z - cp.z) < 45) S.splash.fume(x, b.y + 0.1, z, b.o.shallow, 0.12, 1.4);
    }
    if (b.o.embers && Math.random() < dt * Math.min(10, area * 0.01) * S.splash.density) {
      const [x0, z0, w, d] = b.rect;
      const x = x0 + Math.random() * w, z = z0 + Math.random() * d;
      if (b.contains(x, z)) {
        for (let i = 0; i < 4; i++) S.splash.ember(x, b.y, z, b.o.splash, 0.5);
        S.ripple.impulse(x, z, 0.4, 0.02);
      }
    }
  }
  for (const b of S.bodies) {
    for (const f of b.updaters) f(dt, S.time);
    if (b.lamps.length && b.visible) b._syncLamps(cp);
  }
  for (const f of S.falls) f.update(dt, S);
  S.splash.update(dt);
}
const _v2 = new THREE.Vector2();
const _c2 = new THREE.Color();
function findHemi(o, depth) {
  for (const c of o.children) {
    if (c.isHemisphereLight) return c;
    if (depth < 2) { const h = findHemi(c, depth + 1); if (h) return h; }
  }
  return null;
}

// Part de l'écran couverte par la surface (rectangle au niveau de l'eau, découpé par les plans proche et lointain)
const _corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
function screenCover(b, cam) {
  const [x0, z0, w, d] = b.rect;
  // on se limite à la partie proche (au-delà de 120 m, le reflet planaire n'apporte presque rien)
  const cx = cam.position.x, cz = cam.position.z, L = 120;
  const ax = Math.max(x0, cx - L), az = Math.max(z0, cz - L), bx = Math.min(x0 + w, cx + L), bz = Math.min(z0 + d, cz + L);
  if (ax >= bx || az >= bz) return 0;
  _corners[0].set(ax, b.y, az); _corners[1].set(bx, b.y, az); _corners[2].set(ax, b.y, bz); _corners[3].set(bx, b.y, bz);
  let minX = 1, minY = 1, maxX = -1, maxY = -1, behind = 0;
  for (const c of _corners) {
    c.applyMatrix4(cam.matrixWorldInverse);
    if (c.z > -cam.near) { behind++; continue; }
    c.applyMatrix4(cam.projectionMatrix);
    minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x); minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
  }
  // un coin derrière la caméra : la surface passe sous elle, l'écran est largement couvert vers le bas
  if (behind) { if (behind === 4) return 0; minY = -1; minX = Math.min(minX, -1); maxX = Math.max(maxX, 1); }
  const sx = Math.max(0, Math.min(1, maxX) - Math.max(-1, minX)), sy = Math.max(0, Math.min(1, maxY) - Math.max(-1, minY));
  return (sx * sy) / 4;
}

// Liens avec le jeu : Kobi qui patauge ou plonge, projectiles qui traversent la surface, explosions
function gameHooks(g, dt) {
  const p = g.player;
  if (p && p.pos) {
    const b = waterAt(p.pos.x, p.pos.z, p.pos.y, 3);
    const w = S.wade;
    if (b && b.type !== 'glace' && b.type !== 'lave') {
      const surf = b.heightAt(p.pos.x, p.pos.z);
      // traversée de la surface : grande gerbe
      if (w.prevY !== null && w.prevY > surf + 0.05 && p.pos.y <= surf + 0.05) {
        const vy = Math.abs(p.vel ? p.vel.y : 8);
        waterImpulse(_v.set(p.pos.x, surf, p.pos.z), Math.min(2.2, 0.5 + vy * 0.08));
      }
      // sillage en marchant dans l'eau
      const depth = surf - p.pos.y;
      const hs = p.vel ? Math.hypot(p.vel.x, p.vel.z) : 0;
      if (depth > 0 && depth < 1.6 && hs > 0.8) {
        w.t -= dt;
        if (w.t <= 0) {
          w.t = 0.09;
          S.ripple.impulse(p.pos.x, p.pos.z, 0.35, 0.006 + hs * 0.0018);
          if (hs > 5 && Math.random() < 0.5) S.splash.burst(p.pos.x, surf, p.pos.z, 0.12, { color: b.o.splash, mist: false });
        }
      }
    }
    w.prevY = p.pos.y;
  }
  // projectiles qui entrent dans l'eau
  const list = g.projectiles && g.projectiles.list;
  if (list) {
    for (const q of list) {
      if (!q.pos) continue;
      const py = S.projY.get(q);
      S.projY.set(q, q.pos.y);
      if (py === undefined) continue;
      const b = waterAt(q.pos.x, q.pos.z, q.pos.y, 3);
      if (b && py > b.y && q.pos.y <= b.y) waterImpulse(_v.set(q.pos.x, b.y, q.pos.z), q.explosive || q.type === 'bomb' ? 1.2 : 0.45);
    }
  }
}

// Explosion proche d'un plan d'eau : onde proportionnelle au rayon (appelé par game.explode)
export function waterExplosion(pos, radius) {
  const b = waterAt(pos.x, pos.z);
  if (b && Math.abs(pos.y - b.y) < radius) waterImpulse(_v.set(pos.x, b.y, pos.z), Math.min(3, 0.6 + radius * 0.35), { depth: radius });
}
