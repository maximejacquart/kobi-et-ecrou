// Lumières locales : un petit nombre FIXE de PointLights (selon la qualité) attribuées à chaque image aux sources
// du décor les plus utiles (lanternes, néons, lave, flashs…). Le nombre de lumières ne change pas en cours de partie
// (sinon tous les shaders seraient recompilés) : une lumière libre a simplement une intensité nulle.
//
//   lights.add({ pos | obj, offset, line, area, color, intensity, range, decay, flicker, priority, size }) → émetteur
//   lights.remove(e) ; lights.flash(pos, color, intensity, range, dur) ; lights.gain : intensité globale (planète)
//
// pos : point fixe (copié) ; obj : Object3D suivi (+ offset local) ; line : [a, b] segment lumineux (néon, + offset) et
// area : [largeur, profondeur] rectangle horizontal centré sur pos (lave) — la lumière se place alors au point de
// la source le plus proche de Kobi, ce qui donne l'illusion d'une source étendue.
// size : rayon de la source (m) pour ses reflets ; par défaut 0,3 m (lampe), 0,6 m (néon), demi-largeur (nappe).
import * as THREE from 'three';
import { QUALITY, allLayers } from './frame.js';
import { addSlot } from './shaderSlots.js';

Object.assign(QUALITY.ultra, { lightPool: 8 });
Object.assign(QUALITY.haute, { lightPool: 4 });
Object.assign(QUALITY.moyenne, { lightPool: 2 });

// Une lumière hors de portée d'un fragment (ou éteinte) ne coûte presque rien : son calcul de BRDF est sauté.
addSlot('pars', 'lightpool-skip', /* glsl */ `
#if defined( RE_Direct ) && defined( STANDARD )
  #undef RE_Direct
  #define RE_Direct( l, p, n, v, cn, m, r ) if ( ( l ).visible ) { if ( kobiSpread > 0.0 ) kobiSpreadDirect( l, p, n, v, cn, m, r ); else RE_Direct_Physical( l, p, n, v, cn, m, r ); }
#endif`);

// Reflets des sources étendues (méthode des « sphere lights » d'Unreal) : le lobe spéculaire s'élargit selon le rayon
// apparent de la source (alpha' = alpha + rayon / (2 × distance)), à énergie constante. Une nappe de lave ou un néon
// donne un reflet large et doux sur un sol lustré, au lieu d'une pointe brûlée que le halo transformait en colonne.
// kobiSpread est réglé par lumière dans la boucle des lumières ponctuelles (shaderSlots.js), nul pour les autres ;
// uPoolSpread suit l'ordre des PointLights du shader, qui sont toutes celles du pool, créées dans l'ordre des places.
const spreadU = { value: new Array(8).fill(0) };
addSlot('pars', 'lightpool-spread', /* glsl */ `
uniform float uPoolSpread[ 8 ];
float kobiSpread = 0.0;
#if defined( RE_Direct ) && defined( STANDARD )
void kobiSpreadDirect( const in IncidentLight l, const in vec3 p, const in vec3 n, const in vec3 v, const in vec3 cn, const in PhysicalMaterial m, inout ReflectedLight r ) {
  PhysicalMaterial s = m;
  s.roughness = sqrt( saturate( pow2( m.roughness ) + kobiSpread ) );
  #ifdef USE_CLEARCOAT
  s.clearcoatRoughness = sqrt( saturate( pow2( m.clearcoatRoughness ) + kobiSpread ) );
  #endif
  RE_Direct_Physical( l, p, n, v, cn, s, r );
}
#endif`, { uPoolSpread: spreadU }, -1);

// Sources de rayon non nul (≈ 0,5 m) : pas de point brûlé au contact d'une lanterne, d'un mur ou de Kobi
const FALLOFF = 'float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );';
if (THREE.ShaderChunk.lights_pars_begin.includes(FALLOFF)) {
  THREE.ShaderChunk.lights_pars_begin = THREE.ShaderChunk.lights_pars_begin.replace(FALLOFF,
    'float distanceFalloff = 1.0 / pow( lightDistance * lightDistance + 0.25, decayExponent * 0.5 );');
} else console.warn('lightpool : atténuation des lumières non raccordée (three.js a changé)');

const FADE_IN = 0.45;
const FADE_OUT = 0.3;
const MAX_DIST = 75;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _s = new THREE.Sphere();
const _frustum = new THREE.Frustum();
const _vp = new THREE.Matrix4();

class Emitter {
  constructor(o) {
    this.pos = new THREE.Vector3();
    if (o.pos) this.pos.copy(o.pos);
    this.obj = o.obj || null;
    this.offset = o.offset ? new THREE.Vector3().copy(o.offset) : null;
    this.line = o.line ? [o.line[0].clone(), o.line[1].clone()] : null;
    this.area = o.area || null;
    this.color = new THREE.Color(o.color ?? '#ffffff');
    this.intensity = o.intensity ?? 10;
    this.range = o.range ?? 8;
    this.decay = o.decay ?? 1.5;
    this.flicker = o.flicker ?? 0;
    this.priority = o.priority ?? 1;
    this.size = o.size ?? (this.area ? Math.min(this.area[0], this.area[1]) / 2 : this.line ? 0.6 : 0.3);
    this.on = true;
    this.seed = Math.random() * 100;
    this.world = new THREE.Vector3().copy(this.pos);
    this.score = 0;
    this.slot = null;
    this.flash = null;
  }
  // position monde de la lumière ; target : point d'intérêt (Kobi) pour les sources étendues
  locate(target) {
    const w = this.world;
    if (this.obj) {
      this.obj.updateWorldMatrix(true, false);
      w.copy(this.offset || _v.set(0, 0, 0)).applyMatrix4(this.obj.matrixWorld);
    } else if (this.line) {
      const [a, b] = this.line;
      _v.subVectors(b, a);
      const t = THREE.MathUtils.clamp(_w.subVectors(target, a).dot(_v) / Math.max(1e-6, _v.lengthSq()), 0, 1);
      w.copy(a).addScaledVector(_v, t);
      if (this.offset) w.add(this.offset);
    } else if (this.area) {
      w.set(
        THREE.MathUtils.clamp(target.x, this.pos.x - this.area[0] / 2, this.pos.x + this.area[0] / 2),
        this.pos.y,
        THREE.MathUtils.clamp(target.z, this.pos.z - this.area[1] / 2, this.pos.z + this.area[1] / 2),
      );
    } else w.copy(this.pos);
    return w;
  }
  // rayon de la source elle-même (pour le test de visibilité)
  get extent() {
    if (this.line) return this.line[0].distanceTo(this.line[1]) / 2;
    if (this.area) return Math.hypot(this.area[0], this.area[1]) / 2;
    return 0;
  }
}

class LightPool {
  constructor() {
    this.emitters = [];
    this.slots = [];
    this.game = null;
    this.time = 0;
    this.enabled = true;
    this.gain = 1;
    this._kobi = new THREE.Vector3();
  }
  // Crée les lumières (une fois, dans la scène du jeu) et branche la mise à jour sur chaque image
  attach(game) {
    if (this.game === game) return;
    this.game = game;
    game.R.onFrame.push((dt, t) => this.update(dt, t));
    this._resize(game.R.Q.lightPool ?? 4);
  }
  _resize(n) {
    const scene = this.game.scene;
    while (this.slots.length > n) {
      const s = this.slots.pop();
      if (s.e) s.e.slot = null;
      scene.remove(s.light);
      s.light.dispose();
    }
    while (this.slots.length < n) {
      const light = new THREE.PointLight(0xffffff, 0, 8, 2);
      light.castShadow = false;
      scene.add(allLayers(light));
      this.slots.push({ light, e: null, w: 0 });
    }
    this.size = n;
  }

  add(o) {
    const e = new Emitter(o);
    this.emitters.push(e);
    return e;
  }
  remove(e) {
    if (!e) return;
    const i = this.emitters.indexOf(e);
    if (i >= 0) this.emitters.splice(i, 1);
    e.on = false;
  }
  // flash temporaire (explosion, tir, impact) : allumé d'un coup, s'éteint en (1 - t)²
  flash(pos, color, intensity = 30, range = 10, dur = 0.15) {
    const e = this.add({ pos, color, intensity, range, decay: 2, priority: 6 });
    e.flash = { t: 0, dur: Math.max(0.01, dur), i0: intensity };
    return e;
  }
  // Vide le registre (déchargement d'une planète) ; les lumières restent en place, éteintes
  clear() {
    this.emitters.length = 0;
    this.gain = 1;
    for (const s of this.slots) { s.e = null; s.w = 0; s.light.intensity = 0; }
  }

  // Note d'un émetteur : grande portée, proche de la caméra, dans le champ, éclairant Kobi → prioritaire
  _score(e, cam, kobi, useFrustum) {
    // source portée par un objet retiré ou caché (boulon ramassé, cocon éclaté) : éteinte
    if (e.obj && (!e.obj.parent || !e.obj.visible)) return 0;
    const p = e.locate(kobi);
    const reach = e.range + e.extent;
    const dCam = Math.max(0, cam.distanceTo(p) - e.extent);
    if (dCam - reach > MAX_DIST) return 0;
    if (useFrustum && !_frustum.intersectsSphere(_s.set(p, reach * 1.3))) return 0;
    let s = e.priority * e.range / Math.max(dCam, e.range * 0.6);
    const dK = kobi.distanceTo(p);
    if (dK < e.range) s *= 1 + 1.5 * (1 - dK / e.range);
    // au loin, la source s'efface d'elle-même avant d'être abandonnée
    s *= THREE.MathUtils.smoothstep(MAX_DIST, MAX_DIST * 0.6, dCam - reach);
    return s;
  }

  update(dt, time) {
    const g = this.game;
    if (!g) return;
    this.time = time;
    const n = g.R.Q.lightPool ?? 4;
    if (n !== this.size) this._resize(n);
    const cam = g.camera.cam;
    const kobi = this._kobi.copy(g.player.pos);
    kobi.y += 1;
    const camPos = cam.position;
    _frustum.setFromProjectionMatrix(_vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    // flashs : vieillissement, retrait une fois éteints
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      if (!e.flash) continue;
      e.flash.t += dt;
      const k = 1 - e.flash.t / e.flash.dur;
      if (k <= 0) { this.emitters.splice(i, 1); e.on = false; continue; }
      e.intensity = e.flash.i0 * k * k;
    }
    this._assign(dt, camPos, kobi, true);
  }

  // Attribution des lumières : les n meilleurs émetteurs gardent ou obtiennent une lumière, les autres s'éteignent
  // en fondu ; instant : sans fondu (captures des sondes)
  _assign(dt, camPos, kobi, useFrustum, instant = false) {
    const list = [];
    for (const e of this.emitters) {
      // une capture de sonde ne retient pas les flashs (ils resteraient figés dans le reflet)
      if (!e.on || !this.enabled || (instant && e.flash)) { e.score = 0; continue; }
      e.score = this._score(e, camPos, kobi, useFrustum);
      // inertie : une source déjà allumée garde sa place face à une concurrente à peine meilleure
      if (e.slot && e.slot.w > 0) e.score *= 1.35;
      if (e.score > 0.01) list.push(e);
    }
    list.sort((a, b) => b.score - a.score);
    const want = new Set(list.slice(0, this.slots.length));
    // libère ou éteint les lumières qui ne sont plus voulues
    for (const s of this.slots) {
      if (s.e && (!want.has(s.e) || !s.e.on)) {
        s.w = instant || !s.e.on ? 0 : s.w - dt / FADE_OUT;
        if (s.w <= 0) { s.e.slot = null; s.e = null; s.w = 0; }
      }
    }
    // attribue les lumières libres aux nouvelles sources (un flash prend la place la moins utile s'il le faut)
    for (const e of want) {
      if (e.slot) continue;
      let s = this.slots.find((x) => !x.e);
      if (!s && e.flash) {
        s = this.slots.reduce((a, b) => ((a.e.flash ? 1e9 : a.e.score * a.w) <= (b.e.flash ? 1e9 : b.e.score * b.w) ? a : b));
        if (s.e.flash) s = null;
        else s.e.slot = null;
      }
      if (!s) continue;
      s.e = e;
      e.slot = s;
      s.w = e.flash || instant ? 1 : 0;
    }
    // fondu d'entrée, scintillement, application
    this.slots.forEach((s, i) => { spreadU.value[i] = s.e ? s.e.size : 0; });
    for (const s of this.slots) {
      const L = s.light;
      const e = s.e;
      if (!e) { L.intensity = 0; continue; }
      if (want.has(e)) s.w = instant ? 1 : Math.min(1, s.w + dt / FADE_IN);
      const w = s.w * s.w * (3 - 2 * s.w);
      let f = 1;
      if (e.flicker > 0) {
        const t = this.time * 9 + e.seed;
        f = 1 - e.flicker * (0.5 + 0.25 * Math.sin(t) + 0.15 * Math.sin(t * 2.7 + 1.3) + 0.1 * Math.sin(t * 6.1));
      }
      L.position.copy(e.world);
      L.color.copy(e.color);
      L.distance = e.range;
      L.decay = e.decay;
      L.intensity = e.intensity * w * f * (e.flash ? 1 : this.gain);
    }
  }

  // Pendant la capture d'une sonde en pos : lumières réattribuées autour de ce point (sans fondu), puis restaurées
  focusAt(pos) {
    const saved = this.slots.map((s) => ({ s, e: s.e, w: s.w, p: s.light.position.clone(), c: s.light.color.clone(), i: s.light.intensity, d: s.light.distance, k: s.light.decay }));
    const savedSlots = this.emitters.map((e) => e.slot);
    for (const s of this.slots) { if (s.e) s.e.slot = null; s.e = null; s.w = 0; }
    this._assign(0, pos, pos, false, true);
    return () => {
      this.emitters.forEach((e, i) => { e.slot = savedSlots[i]; });
      for (const o of saved) {
        o.s.e = o.e; o.s.w = o.w;
        o.s.light.position.copy(o.p); o.s.light.color.copy(o.c);
        o.s.light.intensity = o.i; o.s.light.distance = o.d; o.s.light.decay = o.k;
      }
    };
  }

  stats() {
    return { emitters: this.emitters.length, slots: this.slots.length, used: this.slots.filter((s) => s.e).length };
  }
}

export const lights = new LightPool();

// Couleur de lumière d'un matériau lumineux (glow) : sa teinte, ramenée à une luminosité unitaire
export function glowColor(m, fallback = '#ffffff') {
  if (!m || !m.color) return new THREE.Color(fallback);
  const c = m.color.clone();
  const k = Math.max(c.r, c.g, c.b);
  return k > 0 ? c.multiplyScalar(1 / k) : new THREE.Color(fallback);
}
if (import.meta.env.DEV && typeof window !== 'undefined') window.__lights = lights;
