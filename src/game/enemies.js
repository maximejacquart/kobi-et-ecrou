// Ennemis : gestionnaire, classe de base (physique, dégâts, mort spectaculaire) et comportements de chaque type.
import * as THREE from 'three';
import * as Models from '../models/enemies.js';
import { uniqueMaterials } from '../models/geo.js';
import { cloneMat, setFlash } from '../engine/materials.js';
import { clamp, damp, dampAngle, angleDiff, rand, pick, lerp } from '../engine/util.js';
import { segSphere } from './projectiles.js';
import { fxLayer } from '../engine/particles/shared.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
// temporaires réservés aux calculs qui traversent d'autres appels (pas d'allocation à chaque image)
const _dir = new THREE.Vector3();
const _side = new THREE.Vector3();
const _fxp = new THREE.Vector3();
const _fxv = new THREE.Vector3();
const C_SUCK = new THREE.Color('#e8c0ff');
const C_SNOW = new THREE.Color('#eef6ff');
const _contacts = [];
const UP = new THREE.Vector3(0, 1, 0);
const ELITE_RIM = { value: new THREE.Color('#ffc83a') };
// projectiles de Kobi que les robots cherchent à éviter
const DODGE_FROM = new Set(['bomb', 'bomblet', 'comet', 'duckray', 'saw']);
// jamais promus élites par le mode Défi (canards, renforts de boss, nuées)
const NO_ELITE = new Set(['canard', 'bulbe', 'moustique', 'boumboule']);
// blindage des chefs : les rivets y ricochent (la Riveteuse ne doit pas suffire à tout)
const RIVET_BOSS = 0.65;
// renforts appelés par un boss : plus coriaces que les sbires ordinaires
const SUMMON_HP = 1.5;

// Paramètres par type
const DEFS = {
  grignoteur: { hp: 34, radius: 0.55, height: 1.0, speed: 6.5, xp: 15, bolts: [25, 40], mass: 1, model: () => Models.grignoteur(Math.floor(Math.random() * 3)) },
  larbin: { hp: 95, radius: 0.55, height: 1.85, speed: 3.8, xp: 30, bolts: [70, 100], mass: 1.5, model: Models.larbin },
  bourdon: { hp: 46, radius: 0.6, height: 0.6, speed: 7, xp: 25, bolts: [50, 70], mass: 0.8, flying: true, model: Models.bourdon },
  boumboule: { hp: 15, radius: 0.5, height: 1.0, speed: 8.5, xp: 10, bolts: [20, 30], mass: 0.8, model: Models.boumboule },
  pinceur: { hp: 320, radius: 1.5, height: 2.0, speed: 2.4, xp: 60, bolts: [180, 240], mass: 6, model: () => Models.pinceur(false) },
  pinceurRoyal: { hp: 3100, radius: 1.5, height: 2.0, speed: 3, xp: 300, bolts: [1800, 1800], mass: 30, boss: true, name: 'Pinceur Royal', scale: 1.7, model: () => Models.pinceur(true) },
  tourelle: { hp: 120, radius: 1.0, height: 2.2, speed: 0, xp: 40, bolts: [90, 120], mass: 99, static: true, model: Models.tourelleV },
  grosbras: { hp: 2100, radius: 1.7, height: 4.0, speed: 4.2, xp: 300, bolts: [1500, 1500], mass: 30, boss: true, name: 'Contremaître Grosbras', model: Models.grosbras },
  canard: { hp: 1, radius: 0.45, height: 0.8, speed: 1.6, xp: 0, bolts: [0, 0], mass: 0.5, model: Models.canard },
  larbinBouclier: { hp: 140, radius: 0.6, height: 1.85, speed: 3.3, xp: 45, bolts: [110, 150], mass: 2.2, model: Models.larbinBouclier },
  lunette: { hp: 75, radius: 0.5, height: 2.3, speed: 3.8, xp: 40, bolts: [100, 130], mass: 1.2, model: Models.lunette },
  fouisseur: { hp: 120, radius: 0.8, height: 1.1, speed: 7, xp: 45, bolts: [110, 150], mass: 2, model: Models.fouisseur },
  moustique: { hp: 9, radius: 0.32, height: 0.3, speed: 9, xp: 6, bolts: [8, 12], mass: 0.3, flying: true, model: Models.moustique },
  phaseur: { hp: 95, radius: 0.6, height: 2.0, speed: 0, xp: 50, bolts: [120, 160], mass: 1.5, model: Models.phaseur },
  pingouin: { hp: 85, radius: 0.55, height: 1.25, speed: 3.6, xp: 35, bolts: [85, 115], mass: 1.3, model: Models.pingouin },
  champi: { hp: 75, radius: 0.8, height: 2.0, speed: 0, xp: 30, bolts: [75, 105], mass: 99, static: true, model: Models.champi },
  bulbe: { hp: 360, radius: 0.7, height: 2.6, speed: 0, xp: 20, bolts: [40, 60], mass: 99, static: true, model: Models.bulbe },
  mammouth: { hp: 5100, radius: 2.6, height: 6.5, speed: 3.2, xp: 450, bolts: [2200, 2200], mass: 80, boss: true, name: 'Mammouth-Foreuse', model: Models.mammouth },
  reineSpore: { hp: 6400, radius: 3.0, height: 7, speed: 0, xp: 550, bolts: [2600, 2600], mass: 999, boss: true, static: true, name: 'Reine Spore', model: Models.reineSpore },
  goinfrotron: { hp: 8000, radius: 4.2, height: 9, speed: 2.5, xp: 600, bolts: [5000, 5000], mass: 999, boss: true, name: 'Baron Vorax — Goinfrotron', model: Models.goinfrotron },
};

export class Enemies {
  constructor(game) {
    this.game = game;
    this.list = [];
  }
  reset() {
    for (const e of this.list) {
      if (e.cleanup) e.cleanup();
      e.root.parent && e.root.parent.remove(e.root);
    }
    this.list.length = 0;
  }
  spawn(type, pos, opts = {}) {
    const Cls = CLASSES[type] || Enemy;
    const e = new Cls(this.game, type, pos, opts);
    this.list.push(e);
    return e;
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (e.removed) { this.list.splice(i, 1); continue; }
      e.update(dt);
    }
    // les ennemis au sol ne traversent pas Kobi
    const p = this.game.player;
    if (p.alive) {
      for (const e of this.list) {
        if (e.dead || e.hidden || e.def.static || e.def.flying) continue;
        const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z;
        const r = e.radius + 0.55;
        const d2 = dx * dx + dz * dz;
        if (d2 < r * r && d2 > 1e-6 && Math.abs(e.pos.y - p.pos.y) < 1.8) {
          const d = Math.sqrt(d2);
          const push = r - d;
          const share = e.def.mass >= 5 ? 0.15 : 0.85;
          e.pos.x += (dx / d) * push * share; e.pos.z += (dz / d) * push * share;
          if (share < 1) { p.pos.x -= (dx / d) * push * (1 - share); p.pos.z -= (dz / d) * push * (1 - share); }
        }
      }
    }
    // séparation simple
    const L = this.list;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      if (a.dead || a.def.static) continue;
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        if (b.dead || b.def.static) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const r = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < r * r && d2 > 1e-6 && Math.abs(a.pos.y - b.pos.y) < 2) {
          const d = Math.sqrt(d2);
          const push = (r - d) * 0.5;
          const wa = b.def.mass / (a.def.mass + b.def.mass), wb = 1 - wa;
          a.pos.x -= (dx / d) * push * wa * 2; a.pos.z -= (dz / d) * push * wa * 2;
          b.pos.x += (dx / d) * push * wb * 2; b.pos.z += (dz / d) * push * wb * 2;
        }
      }
    }
  }
  // Kobi réapparaît : les ennemis qui le poursuivaient regagnent leur poste (pas de traque à travers le niveau)
  onPlayerRespawn() {
    for (const e of this.list) {
      if (e.dead || !e.alert || e.def.boss || e.type === 'canard' || e.opts.warp) continue;
      e.alert = false;
      e.alarmed = false;
      e.spotted = false;
      e.alarmT = 0;
      e.setState('idle');
      e.stun = 0;
      e.pos.copy(e.home);
      e.vel.set(0, 0, 0);
    }
  }
  alertCount() {
    let n = 0;
    for (const e of this.list) if (!e.dead && e.alert && e.type !== 'canard') n += e.def.boss ? 3 : 1;
    return n;
  }
  alive() { return this.list.filter((e) => !e.dead); }
  nearest(pos, maxD = Infinity, alive = true, exclude) {
    let best = null, bd = maxD;
    for (const e of this.list) {
      if (alive && e.dead) continue;
      if (e.hidden) continue;
      if (e.type === 'canard' && !e.explosive) continue;
      if (exclude && exclude.includes(e)) continue;
      const d = e.pos.distanceTo(pos);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  inSphere(c, r) {
    const out = [];
    for (const e of this.list) {
      if (e.dead || e.hidden) continue;
      for (const hs of e.hitSpheres()) {
        if (hs.c.distanceTo(c) < r + hs.r) { out.push(e); break; }
      }
    }
    return out;
  }
  // Rayon : premier ennemi touché
  raycast(o, d, maxT, extra = 0) {
    let best = null, bt = maxT;
    for (const e of this.list) {
      if (e.dead || e.hidden) continue;
      for (const hs of e.hitSpheres()) {
        const t = raySphere(o, d, hs.c, hs.r + extra);
        if (t !== null && t < bt) { bt = t; best = e; }
      }
    }
    return best ? { enemy: best, t: bt } : null;
  }
  // Ennemi le plus proche de l'axe de visée (aide à la visée)
  nearestToRay(o, d, maxAngle, maxDist) {
    let best = null, score = Infinity;
    const world = this.game.world;
    for (const e of this.list) {
      if (e.dead || e.hidden || (e.type === 'canard' && !e.explosive)) continue;
      const p = e.aimPoint();
      _v.subVectors(p, o);
      const dist = _v.length();
      if (dist > maxDist || dist < 1) continue;
      const ang = Math.acos(clamp(_v.dot(d) / dist, -1, 1));
      const allowance = maxAngle + Math.atan(e.radius / dist);
      if (ang > allowance) continue;
      const s = ang / allowance + dist / maxDist * 0.3;
      if (s < score) {
        // ligne de vue
        const hit = world.raycast(o, _v2.copy(_v).normalize(), dist - e.radius, losFilter);
        if (hit) continue;
        score = s;
        best = e;
      }
    }
    return best;
  }
  segmentHit(a, b, r, exclude) {
    let best = null, bt = Infinity;
    _v3.subVectors(b, a);
    const len = _v3.length();
    if (len < 1e-6) return null;
    const d = _v3.clone().divideScalar(len);
    for (const e of this.list) {
      if (e.dead || e.hidden || (exclude && exclude.has(e))) continue;
      for (const hs of e.hitSpheres()) {
        if (!segSphere(a, b, hs.c, hs.r + r)) continue;
        let t = raySphere(a, d, hs.c, hs.r + r);
        if (t === null) t = 0;
        if (t < bt) { bt = t; best = e; }
      }
    }
    if (!best) return null;
    return { enemy: best, t: bt, point: a.clone().addScaledVector(d, Math.min(bt, len)) };
  }
}

// la ligne de vue ignore les obstacles transparents (champs de force, lave)
const losFilter = (c) => c.blocksCamera !== false;

function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0) return cc < 0 ? 0 : null;
  return t;
}

// =========================================================================================
class Enemy {
  constructor(game, type, pos, opts = {}) {
    this.game = game;
    this.type = type;
    this.def = DEFS[type];
    this.opts = opts;
    this.pos = pos.clone();
    this.home = pos.clone();
    this.vel = new THREE.Vector3();
    this.yaw = opts.yaw ?? rand(0, Math.PI * 2);
    // mode Défi : PV renforcés et élites plus fréquentes
    const dp = game.dp;
    if (!opts.elite && dp.elite && !this.def.boss && !NO_ELITE.has(type) && !opts.warp && Math.random() < dp.elite) opts.elite = true;
    this.elite = !!opts.elite && !this.def.boss;
    // courbe de difficulté : les sbires des planètes suivantes encaissent un peu plus et attaquent plus souvent
    const tier = game.tier || 0;
    this.maxHp = this.def.hp * (this.elite ? 2.3 : 1) * (this.def.boss ? dp.boss : dp.hp * (1 + 0.08 * tier)) * (opts.summoned ? SUMMON_HP : 1);
    this.aggro = this.def.boss ? (game.defi ? 1.15 : 1) : 1 + 0.06 * tier + (game.defi ? 0.2 : 0) + (this.elite ? 0.1 : 0);
    this.hp = this.maxHp;
    if (this.elite && !opts.scale) opts.scale = (this.def.scale || 1) * 1.15;
    this.radius = this.def.radius * (opts.scale || this.def.scale || 1);
    this.height = this.def.height * (opts.scale || this.def.scale || 1);
    this.dead = false;
    this.removed = false;
    this.alert = !!opts.alert;
    this.state = 'idle';
    this.t = 0;
    this.st = 0; // temps dans l'état
    this.flashT = 0;
    this.stun = 0;
    this.grounded = false;
    this.move = new THREE.Vector3();
    this.leash = opts.leash || 30;
    this.m = this.def.model();
    this.root = this.m.root;
    const sc = opts.scale || this.def.scale || 1;
    this.root.scale.setScalar(sc);
    this.mats = uniqueMaterials(this.root, cloneMat);
    // liseré coloré propre aux ennemis : se détachent du décor
    for (const mm of this.mats) {
      mm.userData.enemyRim = true;
      mm.userData.rimMul.value = this.elite ? 2.8 : 1.7;
      if (this.elite) mm.userData.rimColorU = ELITE_RIM;
    }
    if (this.elite) this.speedBoost = 1.2;
    const mc = this.mats.find((mm) => mm.color && !mm.userData.isGlow && !mm.vertexColors);
    this.debrisColor = this.m.debrisColor || (mc ? '#' + mc.color.getHexString() : '#6a6478');
    this.root.position.copy(this.pos);
    this.root.rotation.order = 'YXZ';
    this.baseScale = sc;
    this.flinchX = 0; this.flinchZ = 0; this.squashP = 0;
    game.scene.add(this.root);
    this.warp = opts.warp ? 0 : 1;
    if (opts.warp) {
      this.root.scale.setScalar(0.01);
      game.fx.ring(this.pos, '#c890ff', 3, 0.5);
      game.fx.sparks(_v.copy(this.pos).setY(this.pos.y + 1), UP, 16, '#d8a8ff', 8);
      game.fx.flash(_v.copy(this.pos).setY(this.pos.y + 1), '#c890ff', 20, 8, 0.3);
      game.audio.play('forcefield', { pos: this.pos, pitch: 2, vol: 0.4 });
    }
    this._hs = [{ c: new THREE.Vector3(), r: this.radius }];
    this.anim = 0;
    if (this.init) this.init();
  }
  get player() { return this.game.player; }
  aimPoint() { return _v.copy(this.pos).setY(this.pos.y + this.height * 0.5); }
  hitSpheres() {
    this._hs[0].c.copy(this.pos).setY(this.pos.y + (this.def.flying ? 0 : this.height * 0.5));
    this._hs[0].r = this.def.flying ? this.radius : Math.max(this.radius, this.height * 0.5) * 0.95;
    return this._hs;
  }
  distToPlayer() { return this.pos.distanceTo(this.player.pos); }
  canSeePlayer(maxD = 30) {
    const p = this.player;
    if (!p.alive) return false;
    const a = _v.copy(this.pos).setY(this.pos.y + this.height * 0.7);
    const b = _v2.copy(p.pos).setY(p.pos.y + 1);
    const d = a.distanceTo(b);
    if (d > maxD) return false;
    const dir = _v3.subVectors(b, a).divideScalar(d);
    return !this.game.world.raycast(a, dir, d - 0.5, (c) => c.blocksCamera !== false);
  }
  canDuck() { return !this.def.boss && this.type !== 'canard' && this.type !== 'tourelle'; }

  // Givreur : le gel s'accumule ; une fois gelé, l'ennemi est figé et éclate sous un coup appuyé
  applyFreeze(k, v2, extra = 0) {
    if (this.dead) return;
    if (this.def.boss) { this.chillT = 0.6; return; }
    if (this.frozenT > 0) { this.frozenT = Math.max(this.frozenT, 1.2); return; }
    this.freezeAmt = (this.freezeAmt || 0) + k;
    if (this.freezeAmt >= 1) {
      this.freezeAmt = 0;
      this.frozenT = (v2 ? 4 : 3.2) + extra;
      this.frozenV2 = v2;
      this.vel.set(0, Math.min(this.vel.y, 0), 0);
      this.game.audio.play('freeze', { pos: this.pos });
      this.game.fx.sparks(this.aimPoint().clone(), UP, 14, '#d8f6ff', 5);
    }
  }
  _shatter() {
    const g = this.game;
    const c = this.aimPoint().clone();
    g.audio.play('shatter', { pos: c });
    g.fx.sparks(c, UP, 30, '#d8f6ff', 10, 0.25);
    g.fx.explosion(c, clamp(this.radius * 1.4, 1, 3), '#bfefff', { core: '#ffffff', debrisColor: '#bfefff', smoke: false, shake: 0.2 });
    if (this.frozenV2) {
      // éclats coupants (V2)
      for (const e of g.enemies.inSphere(c, 4)) if (e !== this) e.damage(40, { source: 'givreur', dir: _v.subVectors(e.pos, this.pos).setY(0).normalize(), knock: 6 });
    }
  }

  damage(amount, o = {}) {
    if (this.dead || this.warp < 0.5) return;
    const g = this.game;
    if (this.def.boss && o.source === 'riveteuse') {
      amount *= RIVET_BOSS;
      this._rivetDmg = (this._rivetDmg || 0) + amount;
      // une fois par combat, Écrou suggère de sortir l'artillerie
      if (!this._rivetHint && this._rivetDmg > this.maxHp * 0.06 && g.weapons.ownedList().length > 1) {
        this._rivetHint = true;
        g.hud.say([['ecrou', 'Tes rivets ricochent sur son blindage ! Sors l’artillerie lourde, on a de quoi faire mieux.']]);
      }
    }
    amount = this.modifyDamage ? this.modifyDamage(amount, o) : amount;
    // statue de glace : un coup de clé, une explosion ou un gros impact la fait éclater
    if (this.frozenT > 0 && !o.frost && (o.melee || o.explosive || amount >= 20)) {
      this._shatter();
      this.frozenT = 0;
      amount = this.hp + 1;
      o = { ...o, source: o.source || 'givreur' };
    }
    if (amount <= 0) return;
    this.hp -= amount;
    // touché sans avoir vu Kobi : il appelle quand même ses collègues
    if (!this.alert) this.spotted = true;
    this.alert = true;
    this.recentDmg = (this.recentDmg || 0) + amount;
    if (o.source && o.source !== 'enemy') this.lastSource = o.source;
    this.flashT = 0.08;
    setFlash(this.mats, o.zap ? 0.14 : 0.45, o.zap ? '#7fe8ff' : '#fff2d8');
    if (o.stun && !this.def.boss) this.stun = Math.max(this.stun, o.stun);
    if (o.dir && o.knock && !this.def.static) {
      const k = o.knock / this.def.mass;
      this.vel.x += o.dir.x * k * 1.6;
      this.vel.z += o.dir.z * k * 1.6;
      if (o.up && !this.def.flying) this.vel.y = Math.max(this.vel.y, o.up / Math.sqrt(this.def.mass));
      if (o.melee && this.def.mass < 5) this.stun = Math.max(this.stun, 0.35);
    }
    // bascule sous l'impact (dans le repère de l'ennemi) et petit écrasement
    {
      const amp = (this.def.boss ? 0.05 : 0.22) * clamp(amount / 30, 0.4, 1.4) / Math.sqrt(this.def.mass);
      let dx = 0, dz = 0;
      if (o.dir) { dx = o.dir.x; dz = o.dir.z; } else { const d = this.dirToPlayer(_v3); dx = -d.x; dz = -d.z; }
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      const lz = dx * fx + dz * fz, lx = dx * fz - dz * fx;
      this.flinchX += lz * amp; this.flinchZ -= lx * amp;
      this.squashP = Math.min(0.25, this.squashP + (this.def.boss ? 0.04 : 0.12));
    }
    if (o.source && o.source !== 'crate' && o.source !== 'enemy') g.hud.crosshairHit(this.hp <= 0);
    if (!o.zap) g.audio.play('enemyHurt', { pos: this.pos, pitch: rand(0.85, 1.2) });
    if (this.onHurt) this.onHurt(amount, o);
    // les boss perdent des pièces (munitions, santé) tous les 20 % de vie
    if (this.def.boss && this.hp > 0) {
      const step = Math.floor((1 - this.hp / this.maxHp) * 5);
      if (step > (this._lootStep || 0)) {
        this._lootStep = step;
        const c = this.aimPoint().clone();
        g.pickups.spawnAmmo(c, 2);
        g.pickups.spawnHealth(c, 20, 1);
        g.pickups.spawnBolts(c, 120);
        g.fx.sparks(c, null, 20, '#ffd36b', 9);
        g.audio.play('crate', { pos: c, pitch: 0.6 });
      }
    }
    if (this.hp <= 0) this.die(o.source);
  }

  die(source) {
    if (this.dead) return;
    const g = this.game;
    this.dead = true;
    const c = _v.copy(this.pos).setY(this.pos.y + this.height * 0.5).clone();
    const big = this.def.boss;
    g.fx.explosion(c, big ? 4 : clamp(this.radius * 1.6, 1.2, 3), big ? '#ff7a2a' : '#ffb03a', { debrisColor: this.debrisColor, shake: big ? 0.9 : 0.25 });
    g.audio.play('enemyDie', { pos: c, pitch: big ? 0.6 : rand(0.9, 1.15) });
    if (big) g.audio.play('explosion', { pos: c, big: true, pitch: 0.7 });
    // morceaux du modèle projetés
    for (const ch of this.m.chunks || []) {
      if (!ch.parent) continue;
      const v = new THREE.Vector3(rand(-5, 5), rand(5, 10), rand(-5, 5));
      g.fx.meshChunk(ch, v, 1.8 + Math.random());
    }
    const [b0, b1] = this.def.bolts;
    const self = source === 'self'; // autodestruction (Boum-Boule) : ni boulons ni victoire
    if (source === 'fall') {
      // tombé dans le vide : Écrou aspire les boulons à distance
      if (b1 && !this.noBolts) g.addBolts(Math.round(rand(b0, b1) * g.boltFactor));
      source = this.lastSource || 'fall';
    } else if (b1 && !this.noBolts && !self) {
      const lucky = g.up && g.up.has('chance') && Math.random() < 0.2 ? 2 : 1;
      g.pickups.spawnBolts(c, Math.round(rand(b0, b1) * (this.elite ? 2 : 1) * lucky), { spread: big ? 2.5 : 1, up: big ? 1.4 : 1 });
    }
    if (!self && (this.elite || big)) g.pickups.spawnOrbium(c, big ? 4 : 1);
    if (!big && !self && Math.random() < 0.1) g.pickups.spawnHealth(c, 20);
    if (!big && !self && Math.random() < 0.1) g.pickups.spawnAmmo(c);
    g.hitStop(big ? 0.15 : 0.03);
    if (this.type !== 'canard' && !self) g.onEnemyKilled(this, source);
    if (big) g.bossDefeated(this);
    if (this.onDeath) this.onDeath();
    this.root.parent && this.root.parent.remove(this.root);
    this.removed = true;
  }
  remove() {
    this.dead = true;
    this.removed = true;
    this.resetRemoved = true;
    if (this.cleanup) this.cleanup();
    this.root.parent && this.root.parent.remove(this.root);
  }
  toDuck(explosive) {
    const g = this.game;
    g.audio.play('transform', { pos: this.pos });
    g.fx.ring(this.pos, '#fff27a', 2.5, 0.4);
    g.fx.sparks(_v.copy(this.pos).setY(this.pos.y + 1), UP, 24, '#fff27a', 7);
    g.fx.dust(this.pos, 8, '#ffffff', 2, 1);
    const duck = g.enemies.spawn('canard', this.pos.clone(), { explosive, bolts: this.def.bolts, alert: false });
    duck.explosive = explosive;
    duck.loot = this.def.bolts;
    g.onEnemyKilled(this, 'canardiseur');
    this.remove();
    return duck;
  }

  // Physique commune : gravité, collisions, sol, recul
  physics(dt) {
    const g = this.game;
    if (this.def.static) return;
    if (this.def.flying) {
      this.pos.addScaledVector(this.vel, dt);
      this.vel.multiplyScalar(Math.exp(-2 * dt));
      // évite les murs
      const c = _v.copy(this.pos);
      g.world.sphereContacts(c, this.radius, _contacts);
      for (const ct of _contacts) this.pos.addScaledVector(ct.normal, ct.depth);
      return;
    }
    const speed = this.def.speed * (this.speedMult || 1) * (this.speedBoost || 1) * (this.chillT > 0 ? 0.55 : 1) * (this.stun > 0 ? 0 : 1);
    const k = 1 - Math.exp(-(this.grounded ? 10 : 2) * dt);
    // anti-chute : pas de pas dans le vide
    if (this.grounded && this.move.lengthSq() > 0.01 && !this.noEdgeCheck) {
      const ax = this.pos.x + this.move.x * (this.radius + 0.6), az = this.pos.z + this.move.z * (this.radius + 0.6);
      const h = g.world.groundBelow(ax, this.pos.y + 1.2, az, 3);
      if (!h || h.collider.tag === 'lava') this.move.set(0, 0, 0);
    }
    this.vel.x += (this.move.x * speed - this.vel.x) * k;
    this.vel.z += (this.move.z * speed - this.vel.z) * k;
    this.vel.y -= 30 * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.grounded = false;
    for (const off of [this.radius, Math.max(this.radius, this.height - this.radius)]) {
      const c = _v.set(this.pos.x, this.pos.y + off, this.pos.z);
      g.world.sphereContacts(c, this.radius, _contacts);
      for (const ct of _contacts) {
        if (ct.collider.tag === 'jumppad' && ct.normal.y > 0.5) { /* traité comme sol */ }
        if (ct.normal.y > 0.55 && off === this.radius) {
          this.pos.y += ct.depth / ct.normal.y;
          if (this.vel.y < 0) this.vel.y = 0;
          this.grounded = true;
        } else {
          this.pos.x += ct.normal.x * ct.depth;
          this.pos.z += ct.normal.z * ct.depth;
          if (ct.normal.y < -0.5 && this.vel.y > 0) this.vel.y = 0;
        }
      }
    }
    if (!this.grounded && this.vel.y <= 0) {
      const h = g.world.groundBelow(this.pos.x, this.pos.y + 0.5, this.pos.z, 0.8);
      if (h && h.normal.y > 0.55) { this.pos.y = h.point.y; this.vel.y = 0; this.grounded = true; }
    }
    // moins de dérive après un recul
    if (this.grounded && this.move.lengthSq() < 0.01) { this.vel.x *= Math.exp(-6 * dt); this.vel.z *= Math.exp(-6 * dt); }
    if (this.pos.y < g.level.killY) { this.noBolts = false; this.die('fall'); }
  }

  faceTo(target, rate, dt) {
    const want = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
    this.yaw = dampAngle(this.yaw, want, rate, dt);
    return Math.abs(angleDiff(this.yaw, want));
  }
  setState(s) { this.state = s; this.st = 0; }

  update(dt) {
    if (this.dead) return;
    this.t += dt;
    this.st += dt;
    if (this.warp < 1) {
      this.warp = Math.min(1, this.warp + dt * 3);
      const s = (this.opts.scale || this.def.scale || 1) * (this.warp < 1 ? Math.sin(this.warp * Math.PI * 0.5) * (1 + Math.sin(this.warp * Math.PI) * 0.3) : 1);
      this.root.scale.setScalar(Math.max(0.01, s));
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) setFlash(this.mats, 0);
    }
    if (this.stun > 0) this.stun -= dt;
    // gelé : figé (le temps s'arrête pour lui), teinte de glace
    if (this.frozenT > 0) {
      this.frozenT -= dt;
      setFlash(this.mats, 0.5 + 0.06 * Math.sin(this.t * 3), '#c8f2ff');
      if (Math.random() < 0.08) this.game.fx.sparks(this.aimPoint().clone(), UP, 1, '#e8fbff', 2, 0.12);
      if (this.frozenT <= 0) { setFlash(this.mats, 0); this.game.fx.sparks(this.aimPoint().clone(), null, 10, '#d8f6ff', 5); }
      if (!this.def.flying) { this.move.set(0, 0, 0); this.physics(dt); }
      this.root.position.copy(this.pos);
      return;
    }
    if (this.chillT > 0) this.chillT -= dt;
    // Danse-o-Tron : il danse au lieu d'attaquer
    if (this.danceT > 0) {
      this.danceT -= dt;
      this.move.set(0, 0, 0);
      this.physics(dt);
      this.root.position.copy(this.pos);
      this.root.position.y += Math.abs(Math.sin(this.t * 9)) * 0.25 * (this.def.flying ? 0.3 : 1);
      this.yaw += dt * 6;
      this.root.rotation.y = this.yaw;
      this.root.rotation.z = Math.sin(this.t * 4.5) * 0.25;
      this.animate(dt);
      return;
    }
    // éveil : le joueur est proche, visible, ou tire à portée d'oreille ; un voisin peut aussi donner l'alerte
    if (!this.alert && this.player.alive) {
      const d = this.distToPlayer();
      if (d < 9 || (d < 16 && this.game.weapons.firing) || (d < (this.opts.sight || 22) && this.t % 0.5 < dt && this.canSeePlayer(this.opts.sight || 22))) {
        this.alert = true;
        this.spotted = true;
        this.onAlert && this.onAlert();
      } else if (this.alarmT > 0) {
        this.alarmT -= dt;
        if (this.alarmT <= 0) { this.alert = true; this.onAlert && this.onAlert(); }
      }
    }
    if (this.alert && !this.alarmed) { this.alarmed = true; this._alarm(); }
    if (this.recentDmg) { this.recentDmg *= Math.exp(-dt / 1.5); if (this.recentDmg < 1) this.recentDmg = 0; }
    this.move.set(0, 0, 0);
    if (this.introT > 0) this.introT -= dt;
    else if (this.warp >= 1 && this.stun <= 0) this.think(dt);
    this.physics(dt);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    // retour élastique de la bascule et de l'écrasement
    if (this.flinchX || this.flinchZ || this.squashP) {
      const kf = Math.exp(-9 * dt);
      this.flinchX *= kf; this.flinchZ *= kf; this.squashP *= Math.exp(-14 * dt);
      if (Math.abs(this.flinchX) + Math.abs(this.flinchZ) + this.squashP < 1e-3) { this.flinchX = this.flinchZ = this.squashP = 0; }
      this.root.rotation.x = this.flinchX;
      this.root.rotation.z = this.flinchZ;
      if (this.warp >= 1) {
        const b = this.baseScale, p = this.squashP;
        this.root.scale.set(b * (1 + p * 0.5), b * (1 - p), b * (1 + p * 0.5));
      }
    }
    this.animate(dt);
  }
  think() {}
  animate() {}

  // ---------------------------------------------------------------- IA commune
  // Alerte de groupe : un robot qui repère Kobi prévient ses voisins (avec un petit délai selon la distance)
  _alarm() {
    if (this.def.boss || this.type === 'canard' || this.type === 'bulbe') return;
    const g = this.game;
    const R = g.defi ? 20 : 15;
    let n = 0;
    for (const e of g.enemies.list) {
      if (e === this || e.dead || e.alert || e.alarmT > 0 || e.def.boss || e.type === 'canard' || e.hidden) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > R * R || Math.abs(e.pos.y - this.pos.y) > 6) continue;
      e.alarmT = 0.3 + Math.sqrt(d2) * 0.04 + Math.random() * 0.35;
      n++;
    }
    // le guetteur crie « ! » quand il a des collègues à prévenir
    if (n && this.spotted) g.hud.bubble(this.pos, '!', 1.1, { follow: this, dy: this.height + 0.7, cls: 'alarm' });
    if (n && this.spotted) g.audio.play('beep', { pos: this.pos, pitch: 1.6, vol: 0.5 });
  }
  // Esquive : saut de côté quand Kobi l'ajuste en tirant, ou quand un explosif arrive sur lui
  tryDodge(dt, chance) {
    if (!this.grounded || this.def.static || this.def.flying || this.frozenT > 0 || this.stun > 0) return false;
    this.dodgeCD = (this.dodgeCD ?? rand(1, 2)) - dt;
    if (this.dodgeCD > 0) return false;
    const g = this.game;
    let from = null, blast = false;
    for (const pr of g.projectiles.list) {
      if (!pr.T.player || !DODGE_FROM.has(pr.type)) continue;
      const dx = pr.pos.x - this.pos.x, dz = pr.pos.z - this.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 49) continue;
      if (pr.vel.x * dx + pr.vel.z * dz < 0 || d2 < 9) { from = pr.pos; blast = true; break; }
    }
    if (!from && g.weapons.firing && g.weapons.aimTarget === this) from = g.player.pos;
    if (!from) return false;
    this.dodgeCD = rand(0.3, 0.6);
    if (Math.random() > chance * (g.defi ? 1.4 : 1) * (0.75 + 0.12 * (g.tier || 0))) return false;
    let tx = this.pos.x - from.x, tz = this.pos.z - from.z;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len; tz /= len;
    const s = Math.random() < 0.5 ? 1 : -1;
    // de côté (un peu en arrière face à un explosif) ; sinon l'autre côté ; sinon pas d'esquive
    for (const k of [s, -s]) {
      const dx = -tz * k + (blast ? tx * 0.6 : 0), dz = tx * k + (blast ? tz * 0.6 : 0);
      const dl = Math.hypot(dx, dz);
      const ax = this.pos.x + (dx / dl) * 3, az = this.pos.z + (dz / dl) * 3;
      const h = g.world.groundBelow(ax, this.pos.y + 1.5, az, 3);
      if (!h || h.collider.tag === 'lava' || h.normal.y < 0.6) continue;
      if (g.world.raycast(_v.copy(this.pos).setY(this.pos.y + 0.6), _v2.set(dx / dl, 0, dz / dl), 3.2, losFilter)) continue;
      this.vel.set((dx / dl) * 9.5, 5.5, (dz / dl) * 9.5);
      this.grounded = false;
      this.dodgeCD = rand(2.4, 3.8) / (g.defi ? 1.4 : 1);
      this.squashP = Math.min(0.25, this.squashP + 0.15);
      g.fx.dust(this.pos, 6, '#d8ccc0', 1.2, 0.6);
      g.audio.play('whoosh', { pos: this.pos, pitch: 1.6, vol: 0.5 });
      return true;
    }
    return false;
  }
  // Abri : point proche, sur un sol sûr, que la ligne de vue de Kobi ne voit pas (un obstacle s'interpose)
  findCover(maxR = 8) {
    const g = this.game;
    const p = this.player;
    const eye = _v.copy(p.pos).setY(p.pos.y + 1.3);
    let best = null, bs = Infinity;
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * TAU_E + rand(-0.2, 0.2), r = rand(2.5, maxR);
      const x = this.pos.x + Math.cos(a) * r, z = this.pos.z + Math.sin(a) * r;
      if (Math.hypot(x - this.home.x, z - this.home.z) > this.leash * 0.8) continue;
      const h = g.world.groundBelow(x, this.pos.y + 2, z, 4);
      if (!h || h.normal.y < 0.7 || h.collider.tag === 'lava' || Math.abs(h.point.y - this.pos.y) > 1.5) continue;
      const tx = x, ty = h.point.y + this.height * 0.6, tz = z;
      const dist = Math.hypot(tx - eye.x, ty - eye.y, tz - eye.z);
      if (dist < 7) continue;
      const hit = g.world.raycast(eye, _v2.set(tx - eye.x, ty - eye.y, tz - eye.z).divideScalar(dist), dist - 0.4, losFilter);
      if (!hit || hit.t > dist - 1.2) continue;
      // le chemin depuis la position actuelle doit être libre
      const wx = x - this.pos.x, wz = z - this.pos.z, wl = Math.hypot(wx, wz);
      if (g.world.raycast(_v3.copy(this.pos).setY(this.pos.y + 0.7), _v2.set(wx / wl, 0, wz / wl), wl, losFilter)) continue;
      const s = r + Math.max(0, 14 - dist) * 0.4;
      if (s < bs) { bs = s; best = new THREE.Vector3(x, h.point.y, z); }
    }
    return best;
  }

  // Contact au corps à corps avec Kobi
  touchPlayer(range, dmg, knock = 8) {
    const p = this.player;
    if (!p.alive) return false;
    const c = _v.copy(this.pos).setY(this.pos.y + this.height * 0.5);
    if (c.distanceTo(p.center) < range) return p.hurt(dmg, this.pos, knock);
    return false;
  }
  // direction vers le joueur (horizontale)
  dirToPlayer(out = _v2) {
    return out.subVectors(this.player.pos, this.pos).setY(0).normalize();
  }
}

// =========================================================================================
class Grignoteur extends Enemy {
  init() { this.hop = rand(0, 6); this.wanderT = 0; this.wander = new THREE.Vector3(); }
  think(dt) {
    const p = this.player;
    const d = this.distToPlayer();
    switch (this.state) {
      case 'idle':
        this.wanderT -= dt;
        if (this.wanderT <= 0) {
          this.wanderT = rand(1.5, 3.5);
          const a = rand(0, Math.PI * 2);
          this.wander.set(Math.cos(a), 0, Math.sin(a)).multiplyScalar(Math.random() < 0.5 ? 0.35 : 0);
          if (this.pos.distanceTo(this.home) > 6) this.wander.subVectors(this.home, this.pos).setY(0).normalize().multiplyScalar(0.4);
        }
        this.move.copy(this.wander);
        if (this.move.lengthSq() > 0.01) this.yaw = dampAngle(this.yaw, Math.atan2(this.move.x, this.move.z), 5, dt);
        if (this.alert) this.setState('chase');
        break;
      case 'chase':
        if (!p.alive) { this.setState('idle'); this.alert = false; break; }
        this.dirToPlayer(this.move);
        // zigzag
        this.move.applyAxisAngle(UP, Math.sin(this.t * 3 + this.hop) * 0.5);
        this.faceTo(p.pos, 10, dt);
        if (d < 3.2 && this.grounded) this.setState('windup');
        break;
      case 'windup':
        this.faceTo(p.pos, 14, dt);
        if (this.st < dt * 1.5) this.game.audio.play('robot', { pos: this.pos, pitch: 0.7, vol: 0.45 });
        if (this.st > 0.45) {
          this.setState('lunge');
          const dir = this.dirToPlayer(new THREE.Vector3());
          this.vel.set(dir.x * 11, 5.5, dir.z * 11);
          this.grounded = false;
          this.bit = false;
          this.game.audio.play('robot', { pos: this.pos, pitch: 1.8, vol: 0.5 });
        }
        break;
      case 'lunge':
        this.move.set(0, 0, 0);
        if (!this.bit && this.touchPlayer(1.1, 8, 7)) this.bit = true;
        if (this.st > 0.25 && this.grounded) this.setState('recover');
        break;
      case 'recover':
        if (this.st > 0.55) this.setState('chase');
        break;
    }
    if (this.state === 'lunge') this.speedMult = 0;
    else this.speedMult = this.state === 'chase' ? 1 : 0.6;
  }
  physics(dt) {
    if (this.state === 'lunge') {
      // élan préservé pendant le bond
      const g = this.game;
      this.vel.y -= 30 * dt;
      this.pos.addScaledVector(this.vel, dt);
      const h = g.world.groundBelow(this.pos.x, this.pos.y + 0.6, this.pos.z, 1.2);
      this.grounded = false;
      if (h && this.vel.y <= 0 && this.pos.y <= h.point.y + 0.05) { this.pos.y = h.point.y; this.vel.set(0, 0, 0); this.grounded = true; }
      g.world.sphereContacts(_v.set(this.pos.x, this.pos.y + this.radius + 0.1, this.pos.z), this.radius, _contacts);
      for (const ct of _contacts) if (ct.normal.y < 0.55) { this.pos.x += ct.normal.x * ct.depth; this.pos.z += ct.normal.z * ct.depth; }
      if (this.pos.y < g.level.killY) this.die('fall');
      return;
    }
    super.physics(dt);
  }
  animate(dt) {
    const m = this.m;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.hop += dt * (4 + sp * 2.2);
    const bounce = Math.abs(Math.sin(this.hop)) * Math.min(1, sp / 3) * 0.18;
    m.body.position.y = 0.55 + bounce + (this.state === 'windup' ? -0.12 : 0);
    m.body.rotation.x = this.state === 'windup' ? -0.3 : this.state === 'lunge' ? 0.4 : Math.sin(this.hop) * 0.08;
    m.body.scale.set(1, this.state === 'windup' ? 0.85 + Math.sin(this.st * 60) * 0.03 : 1, 1);
    m.jaw.rotation.x = this.state === 'windup' ? 0.7 : this.state === 'lunge' ? 0.9 * Math.abs(Math.sin(this.st * 25)) : Math.max(0, Math.sin(this.t * 6)) * 0.25;
    m.legs.forEach((l, i) => { l.rotation.x = Math.sin(this.hop * 2 + i * Math.PI / 2) * 0.6 * Math.min(1, sp / 2); });
    m.eye.rotation.y = Math.sin(this.t * 1.7) * 0.3;
  }
}

// =========================================================================================
class Larbin extends Enemy {
  init() { this.strafe = rand() < 0.5 ? 1 : -1; this.strafeT = rand(1, 2.5); this.fireT = rand(1, 2.2); this.shots = 0; this.walk = 0; this.usesCover = true; this.coverCD = rand(0.5, 1.5); }
  onAlert() { this.game.audio.play('robot', { pos: this.pos, pitch: 0.9 }); }
  think(dt) {
    const p = this.player;
    const d = this.distToPlayer();
    this.speedMult = 1;
    if (!this.alert) {
      // patrouille en va-et-vient
      const a = this.t * 0.4;
      this.move.set(Math.sin(a), 0, 0).multiplyScalar(0.35);
      this.yaw = dampAngle(this.yaw, Math.atan2(this.move.x, this.move.z), 4, dt);
      return;
    }
    if (!p.alive) { this.move.set(0, 0, 0); return; }
    // sous le feu : il court se mettre à l'abri, souffle un instant, puis ressort en tirant
    if (this.state === 'cover' || this.state === 'hide') {
      this.faceTo(p.pos, 6, dt);
      if (this.state === 'cover') {
        const to = _v3.subVectors(this.coverAt, this.pos).setY(0);
        const dd = to.length();
        if (dd > 0.7 && this.st < 2.4) { this.move.copy(to.divideScalar(dd)); this.speedMult = 1.4; }
        else { this.setState('hide'); this.hideT = rand(0.9, 1.7) / this.aggro; }
      } else if (this.st > this.hideT) { this.setState('idle'); this.fireT = Math.min(this.fireT, 0.25); }
      return;
    }
    const free = this.state !== 'aim' && this.state !== 'burst' && this.state !== 'punchWind' && this.state !== 'punch';
    if (free && this.usesCover) {
      this.coverCD -= dt;
      if (this.coverCD <= 0 && this.recentDmg > this.maxHp * 0.25 && d > 5) {
        this.coverCD = rand(5, 8);
        const c = this.findCover(10);
        if (c) { this.coverAt = c; this.recentDmg = 0; this.setState('cover'); this.game.audio.play('robot', { pos: this.pos, pitch: 1.5, vol: 0.5 }); return; }
      }
    }
    if (free && this.usesCover && this.tryDodge(dt, 0.3)) return;
    this.faceTo(p.pos, 8, dt);
    const dir = this.dirToPlayer(_dir);
    const side = _side.set(-dir.z, 0, dir.x).multiplyScalar(this.strafe);
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafe *= -1; this.strafeT = rand(1.2, 2.8); }
    if (d > 14) this.move.copy(dir).add(side.multiplyScalar(0.3));
    else if (d < 7) this.move.copy(dir).multiplyScalar(-0.8).add(side.multiplyScalar(0.5));
    else this.move.copy(side).multiplyScalar(0.8);
    if (this.move.lengthSq() > 1) this.move.normalize();
    // tir en rafale
    if (this.state === 'aim') {
      this.move.multiplyScalar(0.2);
      if (this.st > 0.5) { this.setState('burst'); this.shots = 0; this.shotT = 0; }
    } else if (this.state === 'burst') {
      this.move.multiplyScalar(0.3);
      this.shotT -= dt;
      if (this.shotT <= 0) {
        this.shotT = 0.17;
        this._shoot();
        this.shots++;
        if (this.shots >= 3) { this.setState('idle'); this.fireT = rand(1.2, 2.1); }
      }
    } else if (this.state !== 'punchWind' && this.state !== 'punch') {
      this.fireT -= dt * this.aggro;
      if (this.fireT <= 0 && d < 26 && this.canSeePlayer(28)) this.setState('aim');
      if (d < 2.6 && this.st > 0.8) { this.setState('punchWind'); this.game.audio.play('windup', { pos: this.pos, pitch: 1.2, vol: 0.6 }); }
    }
    if (this.state === 'punchWind') {
      this.move.multiplyScalar(0.1);
      if (this.st > 0.4) { this.setState('punch'); this.punched = false; this.vel.addScaledVector(dir, 5); }
    } else if (this.state === 'punch') {
      if (!this.punched && this.st > 0.05) { this.punched = true; this.touchPlayer(2.4, 12, 10); this.game.audio.play('swing', { pos: this.pos, pitch: 0.9 }); }
      if (this.st > 0.45) { this.setState('idle'); this.fireT = Math.max(this.fireT, 0.6); }
    }
  }
  _shoot() {
    const g = this.game;
    const tip = this.m.gunTip;
    tip.updateWorldMatrix(true, false);
    const from = new THREE.Vector3(0, -0.55, 0).applyMatrix4(tip.matrixWorld);
    // vise là où Kobi sera (anticipation partielle)
    const p = g.player;
    const lead = from.distanceTo(p.center) / 20 * 0.45;
    const target = p.center.clone().addScaledVector(p.vel, lead).add(new THREE.Vector3(rand(-0.5, 0.5), rand(-0.3, 0.3), rand(-0.5, 0.5)));
    const dir = target.sub(from).normalize();
    g.projectiles.spawn('ebolt', from, dir, { damage: 10, speed: 20 });
    g.fx.muzzle(from, dir, '#ff6aa0', 0.5);
    g.audio.play('enemyShot', { pos: from });
  }
  animate(dt) {
    const m = this.m;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.walk += dt * sp * 2.6;
    const sw = Math.sin(this.walk) * Math.min(1, sp / 2);
    // jambes (avant/arrière ou pas chassés)
    m.legs[0].hip.rotation.x = sw * 0.6;
    m.legs[1].hip.rotation.x = -sw * 0.6;
    m.legs[0].knee.rotation.x = Math.max(0, -Math.cos(this.walk)) * 0.8 * Math.min(1, sp / 2);
    m.legs[1].knee.rotation.x = Math.max(0, Math.cos(this.walk)) * 0.8 * Math.min(1, sp / 2);
    m.hips.position.y = 0.82 + Math.abs(Math.cos(this.walk)) * 0.04;
    // bras-canon vers Kobi
    const aiming = this.alert && this.player.alive;
    const [l, r] = m.arms;
    const charge = this.state === 'aim' ? this.st / 0.5 : 0;
    r.up.rotation.x = damp(r.up.rotation.x, aiming ? -Math.PI / 2 + 0.1 : 0.2, 10, dt);
    r.fore.rotation.x = damp(r.fore.rotation.x, aiming ? -0.05 : -0.3, 10, dt);
    // poing gauche : armé en arrière puis projeté
    const lx = this.state === 'punchWind' ? 0.9 + Math.sin(this.st * 50) * 0.05 : this.state === 'punch' ? -1.7 : -sw * 0.6;
    l.up.rotation.x = damp(l.up.rotation.x, lx, this.state === 'punch' ? 35 : 10, dt);
    l.fore.rotation.x = damp(l.fore.rotation.x, this.state === 'punchWind' ? -1.4 : 0, 12, dt);
    m.torso.rotation.y = this.state === 'punchWind' ? 0.35 : this.state === 'punch' ? -0.3 : Math.sin(this.t * 2) * 0.05;
    l.up.rotation.z = -0.25;
    r.up.rotation.z = 0.15;
    m.head.rotation.y = Math.sin(this.t * 0.8) * 0.2;
    m.gunTip.scale.setScalar(1 + charge * 0.25 + (this.state === 'burst' ? Math.sin(this.st * 60) * 0.1 : 0));
  }
}

// =========================================================================================
class Bourdon extends Enemy {
  init() { this.orbit = rand(0, 6); this.attackT = rand(2, 4); this.alt = rand(3.2, 4.5); this.falling = false; this.pos.y += this.alt; this.home.y = this.pos.y; }
  modifyDamage(a) { return a; }
  die(source) {
    if (this.falling) { super.die(source); return; }
    // tombe en vrille avant d'exploser
    this.falling = true;
    this.fallSource = source;
    this.hp = 1;
    this.fallT = 0;
    this.game.audio.play('enemyHurt', { pos: this.pos, pitch: 0.5 });
  }
  think(dt) {
    const g = this.game;
    const p = this.player;
    if (this.falling) {
      this.fallT += dt;
      this.vel.y -= 25 * dt;
      this.root.rotation.z += dt * 12;
      if (Math.random() < 0.7) g.fx.smoke(this.pos, 1, '#2a2430', 0.6, 0.5);
      const h = g.world.groundBelow(this.pos.x, this.pos.y + 0.5, this.pos.z, 1.2);
      if (h || this.fallT > 2.5) { this.falling = true; this.hp = 0; super.die(this.fallSource); }
      return;
    }
    const gh = g.world.groundBelow(this.pos.x, this.pos.y, this.pos.z, 30);
    const groundY = gh ? gh.point.y : this.home.y - this.alt;
    if (!this.alert || !p.alive) {
      // ronde autour du point de départ
      this.orbit += dt * 0.6;
      const tgt = _v.set(this.home.x + Math.cos(this.orbit) * 4, groundY + this.alt + Math.sin(this.t * 2) * 0.3, this.home.z + Math.sin(this.orbit) * 4);
      this.vel.lerp(_v2.subVectors(tgt, this.pos).multiplyScalar(1.5), 1 - Math.exp(-3 * dt));
      this.yaw = dampAngle(this.yaw, Math.atan2(this.vel.x, this.vel.z), 4, dt);
      return;
    }
    const d = this.distToPlayer();
    switch (this.state) {
      case 'idle': {
        this.orbit += dt * 0.9;
        const r = 7.5;
        const tgt = _v.set(p.pos.x + Math.cos(this.orbit) * r, Math.max(groundY, p.pos.y) + this.alt + Math.sin(this.t * 2.3) * 0.5, p.pos.z + Math.sin(this.orbit) * r);
        this.vel.lerp(_v2.subVectors(tgt, this.pos).multiplyScalar(1.6).clampLength(0, 9), 1 - Math.exp(-3 * dt));
        this.faceTo(p.pos, 6, dt);
        this.attackT -= dt * this.aggro;
        if (this.attackT <= 0 && d < 20) {
          if (Math.random() < 0.55) { this.setState('dive'); g.audio.play('windup', { pos: this.pos, pitch: 1.4 }); }
          else this.setState('shoot');
        }
        break;
      }
      case 'dive':
        this.vel.multiplyScalar(Math.exp(-6 * dt));
        this.faceTo(p.pos, 10, dt);
        if (this.st > 0.6) {
          this.setState('dash');
          this.diveDir = _v2.copy(p.center).sub(this.pos).normalize().clone();
          this.hitDone = false;
        }
        break;
      case 'dash':
        this.vel.copy(this.diveDir).multiplyScalar(17);
        if (!this.hitDone && this.touchPlayer(1.3, 10, 8)) this.hitDone = true;
        if (this.st > 0.55 || (gh && this.pos.y < groundY + 0.8)) { this.setState('idle'); this.attackT = rand(2.5, 4); this.vel.y = 5; }
        break;
      case 'shoot':
        this.vel.multiplyScalar(Math.exp(-4 * dt));
        this.faceTo(p.pos, 10, dt);
        if (this.st > 0.4 && !this.shot) {
          this.shot = true;
          const from = this.pos.clone().add(new THREE.Vector3(0, -0.4, 0));
          const dir = p.center.clone().sub(from).normalize();
          g.projectiles.spawn('ebolt', from, dir, { damage: 8, speed: 15 });
          g.audio.play('enemyShot', { pos: from, pitch: 1.3 });
        }
        if (this.st > 0.8) { this.shot = false; this.setState('idle'); this.attackT = rand(2, 3.5); }
        break;
    }
  }
  animate(dt) {
    const m = this.m;
    for (const r of m.rotors) r.rotation.y += dt * 40;
    m.body.rotation.x = clamp(this.vel.length() * 0.03, 0, 0.4) + (this.state === 'dash' ? 0.5 : 0);
    m.body.position.y = Math.sin(this.t * 4) * 0.08;
    const tele = this.state === 'dive' || this.state === 'shoot';
    m.eye.scale.setScalar(tele ? 1.3 + Math.sin(this.st * 40) * 0.3 : 1);
    if (Math.random() < 0.02) this.game.audio.play('beep', { pos: this.pos, pitch: 2, vol: 0.2 });
  }
}

// =========================================================================================
class BoumBoule extends Enemy {
  init() { this.roll = 0; this.fuse = -1; }
  modifyDamage(a) { return a; }
  die(source) {
    const g = this.game;
    if (this.dead) return;
    const c = this.pos.clone().setY(this.pos.y + 0.5);
    super.die(source);
    g.explode(c, 3.6, 45, { source: 'enemy', hurtsPlayer: 20, color: '#ff6a2a' });
  }
  think(dt) {
    const p = this.player;
    if (!this.alert || !p.alive) return;
    const d = this.distToPlayer();
    if (this.fuse >= 0) {
      this.fuse -= dt;
      this.move.set(0, 0, 0);
      if (Math.random() < 0.5) this.game.fx.sparks(this.m.spark.getWorldPosition(_fxp), UP, 1, '#ffd23a', 3);
      if (this.st % 0.15 < dt) this.game.audio.play('beep', { pos: this.pos, pitch: 1.5 + (0.7 - this.fuse) });
      if (this.fuse <= 0) this.die('self');
      return;
    }
    this.dirToPlayer(this.move);
    this.faceTo(p.pos, 8, dt);
    if (d < 2.6) { this.fuse = 0.7; this.st = 0; }
  }
  animate(dt) {
    const m = this.m;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.roll += (sp / 0.5) * dt;
    m.ball.rotation.x = this.roll;
    const blink = this.fuse >= 0 && Math.floor(this.fuse * 14) % 2 === 0;
    m.ball.scale.setScalar(this.fuse >= 0 ? 1 + (0.7 - this.fuse) * 0.4 : 1);
    m.spark.scale.setScalar(1 + Math.sin(this.t * 30) * 0.4);
    if (blink) setFlash(this.mats, 0.8, '#ff3a2a');
    else if (this.flashT <= 0) setFlash(this.mats, 0);
  }
}

// =========================================================================================
class Pinceur extends Enemy {
  init() {
    this.mortarT = rand(1.5, 3); this.walk = 0; this.salvo = 0;
    if (this.def.boss) { this.game.hud.boss(this.def.name, 1); this.game.camera.shake(0.3); this.game.bossIntro(this, 'Garde du corps plaqué or'); }
  }
  onHurt() { if (this.def.boss) this.game.hud.boss(this.def.name, this.hp / this.maxHp); }
  onDeath() { if (this.def.boss) { this.game.hud.boss(null); this.game.slowMo(0.25, 1.2); } }
  modifyDamage(a, o) {
    // blindage frontal : dégâts réduits sauf explosions et coups par l'arrière
    if (o.explosive || o.zap) return a;
    const src = o.dir ? _v.copy(o.dir).negate() : this.dirToPlayer(_v);
    const fwd = _v2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const front = src.x * fwd.x + src.z * fwd.z;
    if (front > 0.35) {
      this.game.audio.play('shieldHit', { pos: this.pos });
      this.game.fx.sparks(this.aimPoint().clone().addScaledVector(fwd, this.radius), fwd, 4, '#ffe7a0', 5);
      return a * 0.35;
    }
    if (front < -0.4) return a * 1.6;
    return a;
  }
  think(dt) {
    const g = this.game;
    const p = this.player;
    if (!this.alert || !p.alive) return;
    const d = this.distToPlayer();
    const royal = this.type === 'pinceurRoyal';
    const turn = royal ? 1.0 : 1.3;
    if (this.ringT > 0) {
      this.ringT -= dt;
      setFlash(this.mats, 0.25 + 0.25 * Math.sin(this.ringT * 40), '#ff4fa0');
      if (this.ringT <= 0) {
        setFlash(this.mats, 0);
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2;
          g.projectiles.spawn('ebolt', this.pos.clone().setY(this.pos.y + 0.9), new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), { damage: 10, speed: 12 });
        }
        g.audio.play('laser', { pos: this.pos });
      }
    }
    const err = this.faceTo(p.pos, turn, dt);
    if (this.state === 'claw') {
      if (this.st > 0.55 && !this.swept) {
        this.swept = true;
        g.audio.play('swing', { pos: this.pos, pitch: 0.5 });
        const fwd = _v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        const toP = _v2.subVectors(p.pos, this.pos).setY(0);
        if (toP.length() < this.radius + 3 && toP.normalize().dot(fwd) > 0.2) p.hurt(royal ? 22 : 15, this.pos, 12);
        g.camera.shakeAt(this.pos, 0.2);
      }
      if (this.st > 1.0) this.setState('idle');
      return;
    }
    if (d > 6) this.move.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(err < 0.6 ? 1 : 0.2);
    if (d < this.radius + 2.6 && err < 0.5) { this.setState('claw'); this.swept = false; return; }
    this.mortarT -= dt * this.aggro;
    if (this.mortarT <= 0 && d < 34) {
      const n = royal ? 3 : 1;
      for (let i = 0; i < n; i++) {
        const tp = p.pos.clone().add(new THREE.Vector3(i ? rand(-4, 4) : p.vel.x * 0.6, 0, i ? rand(-4, 4) : p.vel.z * 0.6));
        const hit = g.world.groundBelow(tp.x, tp.y + 3, tp.z, 10);
        if (hit) tp.y = hit.point.y;
        this._lob(tp, 1.4 + i * 0.25);
      }
      this.mortarT = royal ? rand(2.4, 3.2) : rand(3, 4);
      if (royal) {
        this.salvo++;
        if (this.salvo % 3 === 0) {
          // anneau d'énergie, annoncé 0,7 s avant : lueur rose et sifflement
          this.ringT = 0.7;
          g.audio.play('charge', { pos: this.pos, pitch: 1.1 });
          g.fx.ring(this.pos, '#ff4fa0', 6, 0.7, 0.3);
        }
      }
    }
  }
  _lob(target, T) {
    const g = this.game;
    const m = this.m.mortar;
    m.updateWorldMatrix(true, false);
    const from = new THREE.Vector3(0, 0.8, 0).applyMatrix4(m.matrixWorld);
    const vel = new THREE.Vector3((target.x - from.x) / T, 0, (target.z - from.z) / T);
    vel.y = (target.y - from.y + 0.5 * 22 * T * T) / T;
    g.projectiles.spawn('mortar', from, vel, { damage: 16, targetPos: target, markerTime: T, radius: 3.5 });
    g.fx.smoke(from, 4, '#4a4050', 0.8);
    g.audio.play('bomb', { pos: from, pitch: 0.6 });
    g.audio.play('mortar', { pos: target });
    this.recoil = 1;
  }
  animate(dt) {
    const m = this.m;
    const sp = Math.hypot(this.vel.x, this.vel.z) + Math.abs(this.yaw - (this._py ?? this.yaw)) * 20;
    this._py = this.yaw;
    this.walk += dt * (2 + sp * 3);
    for (const L of m.legs) {
      const ph = this.walk + L.i * 2.1 + (L.s > 0 ? Math.PI : 0);
      L.up.rotation.x = Math.sin(ph) * 0.35 * Math.min(1, sp);
      L.up.rotation.z = L.s * (1.2 + Math.max(0, Math.cos(ph)) * 0.25 * Math.min(1, sp));
    }
    m.body.position.y = 1.1 + Math.sin(this.walk * 2) * 0.04;
    this.recoil = Math.max(0, (this.recoil || 0) - dt * 4);
    m.mortar.rotation.x = -0.5 + this.recoil * 0.3;
    for (const c of m.claws) {
      let rx = -1.1, open = 0.2 + Math.sin(this.t * 3 + c.s) * 0.1;
      if (this.state === 'claw') {
        const k = this.st < 0.5 ? this.st / 0.5 : Math.max(0, 1 - (this.st - 0.5) * 3);
        rx = -1.1 - k * 1.2 + (this.st > 0.5 && this.st < 0.7 ? 1.5 : 0);
        open = 0.6 * k;
      }
      c.sh.rotation.x = damp(c.sh.rotation.x, rx, 12, dt);
      c.pinA.rotation.z = open;
      c.pinB.rotation.z = -open;
    }
    m.eyes.forEach((e, i) => { e.rotation.z = Math.sin(this.t * 2 + i) * 0.2; });
    m.vent.scale.setScalar(1 + Math.sin(this.t * 6) * 0.1);
  }
}

// =========================================================================================
class TourelleV extends Enemy {
  init() {
    this.fireT = rand(1, 2); this.shots = 0; this.headYaw = this.yaw;
    // laser de visée (annonce de la rafale)
    const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.sight = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color('#ff3a5a').multiplyScalar(2.5), transparent: true, opacity: 0.9 }));
    this.sight.frustumCulled = false;
    this.sight.visible = false;
    this.game.scene.add(this.sight);
  }
  // le matériau du laser reste en mémoire (minuscule) : le libérer pendant sa compilation asynchrone gêne WebGL
  cleanup() { if (this.sight) { this.sight.parent && this.sight.parent.remove(this.sight); this.sight.geometry.dispose(); this.sight = null; } }
  onDeath() { this.cleanup(); }
  think(dt) {
    const g = this.game;
    const p = this.player;
    if (!this.alert || !p.alive) { this.headYaw += dt * 0.4; return; }
    const want = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z) - this.yaw;
    this.headYaw = dampAngle(this.headYaw, want, 3, dt);
    this.fireT -= dt * this.aggro;
    if (this.fireT <= 0 && this.state !== 'burst' && this.state !== 'lock' && this.canSeePlayer(34)) {
      this.setState('lock');
      g.audio.play('beep', { pos: this.pos, pitch: 2.2, vol: 0.6 });
    }
    if (this.sight) {
      const on = this.state === 'lock';
      this.sight.visible = on && Math.floor(this.st * 20) % 2 === 0;
      if (on) {
        const h = this.m.head;
        h.updateWorldMatrix(true, false);
        const a = this.sight.geometry.attributes.position;
        const from = _v.set(0, -0.1, 1.3).applyMatrix4(h.matrixWorld);
        a.setXYZ(0, from.x, from.y, from.z);
        const c = p.center;
        a.setXYZ(1, c.x, c.y, c.z);
        a.needsUpdate = true;
      }
    }
    if (this.state === 'lock' && this.st > 0.55) { this.setState('burst'); this.shots = 0; this.shotT = 0; }
    if (this.state === 'burst') {
      this.shotT -= dt;
      if (this.shotT <= 0) {
        this.shotT = 0.16;
        const h = this.m.head;
        h.updateWorldMatrix(true, false);
        const from = new THREE.Vector3((this.shots % 2 ? 1 : -1) * 0.35, -0.1, 1.3).applyMatrix4(h.matrixWorld);
        const dir = p.center.clone().sub(from).normalize();
        g.projectiles.spawn('ebolt', from, dir, { damage: 8, speed: 20 });
        g.audio.play('enemyShot', { pos: from, pitch: 0.8 });
        g.fx.muzzle(from, dir, '#ff6aa0', 0.5);
        this.shots++;
        if (this.shots >= 4) { this.setState('idle'); this.fireT = rand(2, 3); }
      }
    }
  }
  animate() { this.m.head.rotation.y = this.headYaw; }
}

// =========================================================================================
class Canard extends Enemy {
  init() { this.wanderT = 0; this.wdir = new THREE.Vector3(); this.quackT = rand(0.5, 2); this.waddle = 0; this.life = 0; }
  canDuck() { return false; }
  die(source) {
    if (this.dead) return;
    const g = this.game;
    this.dead = true;
    const c = this.pos.clone().setY(this.pos.y + 0.5);
    const cols = ['#ff4f6d', '#ffd23a', '#3ef2ff', '#4dffa0', '#b98aff'];
    for (const col of cols) g.fx.sparks(c, UP, 8, col, 8, 0.25);
    g.fx.ring(this.pos, '#ffe14a', 2, 0.35);
    g.audio.play('pop', { pos: c, pitch: 0.8 });
    g.audio.play('quack', { pos: c, pitch: 1.6 });
    if (this.loot) g.pickups.spawnBolts(c, Math.round(rand(this.loot[0], this.loot[1]) * 1.2));
    if (this.explosive) g.explode(c, this.boomR || 3.5, 60 * ((this.boomR || 3.5) / 3.5), { source: 'canardiseur', color: '#ffe14a', core: '#ffffff', smoke: false });
    this.root.parent && this.root.parent.remove(this.root);
    this.removed = true;
    void source;
  }
  think(dt) {
    const g = this.game;
    this.wanderT -= dt;
    if (this.wanderT <= 0) {
      this.wanderT = rand(1, 2.5);
      const a = rand(0, Math.PI * 2);
      this.wdir.set(Math.cos(a), 0, Math.sin(a));
    }
    this.move.copy(this.wdir);
    this.yaw = dampAngle(this.yaw, Math.atan2(this.wdir.x, this.wdir.z), 5, dt);
    this.quackT -= dt;
    if (this.quackT <= 0) { this.quackT = rand(1.5, 3.5); g.audio.play('quack', { pos: this.pos, pitch: rand(0.9, 1.3), vol: 0.6 }); }
    // canard explosif : fonce sur les ennemis proches
    if (this.explosive) {
      const e = g.enemies.nearest(this.pos, 8, true, [this]);
      if (e && e.type !== 'canard') {
        this.move.subVectors(e.pos, this.pos).setY(0).normalize();
        this.speedMult = 3;
        if (e.pos.distanceTo(this.pos) < e.radius + 0.8) this.die('canardiseur');
      }
    }
  }
  animate(dt) {
    const m = this.m;
    this.waddle += dt * 9;
    m.body.rotation.z = Math.sin(this.waddle) * 0.15;
    m.body.position.y = 0.35 + Math.abs(Math.sin(this.waddle)) * 0.05;
    m.head.rotation.x = Math.sin(this.waddle * 0.5) * 0.1;
  }
}

// =========================================================================================
// Mini-boss de Brikka : le contremaître Grosbras
class Grosbras extends Enemy {
  init() {
    this.cool = 2;
    this.walk = 0;
    this.rings = [];
    this.summoned = false;
    this.phase2 = false;
    this.game.hud.boss(this.def.name, 1);
    this.game.camera.shake(0.4);
    this.game.bossIntro(this, 'Contremaître du chantier Vorax');
  }
  onHurt() { this.game.hud.boss(this.def.name, this.hp / this.maxHp); }
  cleanup() {
    for (const r of this.rings) { r.mesh.parent && r.mesh.parent.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); }
    this.rings.length = 0;
  }
  onDeath() {
    this.game.hud.boss(null);
    this.cleanup();
    this.game.slowMo(0.25, 1.2);
  }
  modifyDamage(a, o) { return o.melee ? a * 0.8 : a; }
  think(dt) {
    const g = this.game;
    const p = this.player;
    this._updateRings(dt);
    if (!p.alive) return;
    this.alert = true;
    const d = this.distToPlayer();
    if (!this.phase2 && this.hp < this.maxHp * 0.5) {
      this.phase2 = true;
      this.setState('roar');
      g.audio.play('roar', { pos: this.pos, pitch: 1.2 });
      g.hud.say([['baron', 'Grosbras ! Appelle les renforts ! Et facture-les à ce fennec !']], true);
    }
    switch (this.state) {
      case 'idle':
        this.faceTo(p.pos, 3, dt);
        if (d > 5) this.dirToPlayer(this.move);
        this.speedMult = this.phase2 ? 1.25 : 1;
        this.cool -= dt;
        if (this.cool <= 0) {
          const r = Math.random();
          if (d > 13 && r < 0.45) this.setState('throwWind');
          else if (d < 9 || r < 0.6) this.setState('slamWind');
          else this.setState('chargeWind');
        }
        break;
      case 'slamWind':
        this.faceTo(p.pos, 5, dt);
        if (this.st > 0.85) { this.setState('slam'); this._slam(); }
        break;
      case 'slam':
        if (this.phase2 && this.st > 0.5 && !this.second) { this.second = true; this._slam(true); }
        if (this.st > 1.0) { this.second = false; this.setState('idle'); this.cool = this.phase2 ? rand(1.2, 2) : rand(1.8, 2.8); }
        break;
      case 'chargeWind':
        this.faceTo(p.pos, 6, dt);
        if (this.st > 0.7) {
          this.setState('charge');
          this.chargeDir = this.dirToPlayer(new THREE.Vector3()).clone();
          this.hitDone = false;
          g.audio.play('roar', { pos: this.pos, pitch: 1.5, vol: 0.6 });
        }
        break;
      case 'charge': {
        this.move.copy(this.chargeDir);
        this.speedMult = 3.6;
        this.noEdgeCheck = false;
        if (!this.hitDone && this.touchPlayer(this.radius + 0.9, 25, 16)) this.hitDone = true;
        if (Math.random() < 0.6) g.fx.dust(this.pos, 1, '#e8c49a', 2, 1.2);
        const ahead = g.world.raycast(this.aimPoint().clone(), this.chargeDir, this.radius + 1);
        if (this.st > 1.8 || ahead) {
          if (ahead) { g.camera.shakeAt(this.pos, 0.5); g.audio.play('stomp', { pos: this.pos }); this.stun = 1.0; }
          this.setState('idle');
          this.cool = rand(1.5, 2.5);
          this.speedMult = 1;
        }
        break;
      }
      case 'throwWind':
        this.faceTo(p.pos, 6, dt);
        if (this.st > 0.6) {
          this.setState('throw');
          // lance des débris de chantier en cloche
          const n = this.phase2 ? 4 : 3;
          for (let i = 0; i < n; i++) {
            const tp = p.pos.clone().add(new THREE.Vector3(i ? rand(-4, 4) : p.vel.x * 0.7, 0, i ? rand(-4, 4) : p.vel.z * 0.7));
            const hit = g.world.groundBelow(tp.x, tp.y + 4, tp.z, 12);
            if (hit) tp.y = hit.point.y;
            const from = this.pos.clone().setY(this.pos.y + 4.5);
            const T = 1.1 + i * 0.2;
            const vel = new THREE.Vector3((tp.x - from.x) / T, 0, (tp.z - from.z) / T);
            vel.y = (tp.y - from.y + 0.5 * 22 * T * T) / T;
            g.projectiles.spawn('mortar', from, vel, { damage: 15, targetPos: tp, markerTime: T, radius: 3.2 });
          }
          g.audio.play('swing', { pos: this.pos, pitch: 0.4 });
        }
        break;
      case 'throw':
        if (this.st > 0.7) { this.setState('idle'); this.cool = rand(1.4, 2.4); }
        break;
      case 'roar':
        if (this.st > 0.3 && !this.summoned) {
          this.summoned = true;
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2;
            g.enemies.spawn(i % 2 ? 'grignoteur' : 'boumboule', this.pos.clone().add(new THREE.Vector3(Math.cos(a) * 6, 0.5, Math.sin(a) * 6)), { warp: true, alert: true, summoned: true });
          }
        }
        if (this.st > 1.4) this.setState('idle');
        break;
    }
  }
  _slam(small) {
    const g = this.game;
    const hh = this.m.hHead;
    hh.updateWorldMatrix(true, false);
    const at = new THREE.Vector3().setFromMatrixPosition(hh.matrixWorld);
    const gh = g.world.groundBelow(at.x, at.y + 1, at.z, 8);
    if (gh) at.y = gh.point.y;
    g.audio.play('slam', { pos: at, pitch: 0.7 });
    g.camera.shakeAt(at, 0.7);
    g.fx.dust(at, 16, '#e8c49a', 6, 1.6);
    g.fx.sparks(at, UP, 20, '#ffd36b', 9);
    g.fx.ring(at, '#ffb627', 5, 0.4);
    if (this.player.center.distanceTo(at) < 3.2) this.player.hurt(22, at, 14);
    // onde de choc à sauter
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(1, 0.18, 6, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb627').multiplyScalar(2.5), transparent: true, opacity: 0.9 }));
    mesh.rotation.x = Math.PI / 2;
    mesh.position.copy(at).add(new THREE.Vector3(0, 0.25, 0));
    g.scene.add(mesh);
    this.rings.push({ mesh, r: 1, center: at.clone(), hit: false, speed: small ? 16 : 13 });
  }
  _updateRings(dt) {
    const g = this.game;
    const p = this.player;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.r += r.speed * dt;
      r.mesh.scale.set(r.r, r.r, 1 + r.r * 0.1);
      r.mesh.material.opacity = Math.max(0, 1 - r.r / 22);
      const dx = p.pos.x - r.center.x, dz = p.pos.z - r.center.z;
      const d = Math.hypot(dx, dz);
      if (!r.hit && p.alive && Math.abs(d - r.r) < 0.7 && p.pos.y - r.center.y < 0.8) {
        r.hit = true;
        p.hurt(18, r.center, 10);
      }
      if (Math.random() < 0.5) {
        const a = rand(0, Math.PI * 2);
        g.fx.dust(_fxp.set(r.center.x + Math.cos(a) * r.r, r.center.y, r.center.z + Math.sin(a) * r.r), 1, '#e8c49a', 1, 0.8);
      }
      if (r.r > 22) { r.mesh.parent && r.mesh.parent.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); this.rings.splice(i, 1); }
    }
  }
  animate(dt) {
    const m = this.m;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.walk += dt * (1 + sp * 1.2);
    const sw = Math.sin(this.walk) * Math.min(1, sp / 2);
    m.legs[0].hip.rotation.x = sw * 0.5;
    m.legs[1].hip.rotation.x = -sw * 0.5;
    m.hips.position.y = 1.3 + Math.abs(Math.cos(this.walk)) * 0.1 * Math.min(1, sp / 2);
    m.torso.rotation.z = sw * 0.06;
    const [l, r] = m.arms;
    let rx = -0.3 + sw * 0.3, lx = -sw * 0.4, tx = 0.1;
    if (this.state === 'slamWind') { const k = Math.min(1, this.st / 0.6); rx = -3.0 * k; lx = -2.6 * k; tx = -0.3 * k; }
    else if (this.state === 'slam') { const k = Math.min(1, this.st / 0.12); rx = lerp(-3.0, -0.6, k); lx = lerp(-2.6, -0.5, k); tx = 0.45 * (1 - this.st); }
    else if (this.state === 'chargeWind') { rx = 0.6; lx = 0.6; tx = 0.4; }
    else if (this.state === 'charge') { rx = -1.2; lx = -1.2; tx = 0.5; }
    else if (this.state === 'roar') { rx = -2.6 + Math.sin(this.st * 30) * 0.2; lx = -2.6; tx = -0.4; }
    else if (this.state === 'throwWind') { lx = -2.8 * Math.min(1, this.st / 0.5); tx = -0.3; }
    else if (this.state === 'throw') { lx = 0.6; tx = 0.3; }
    r.up.rotation.x = damp(r.up.rotation.x, rx, this.state === 'slam' ? 30 : 8, dt);
    l.up.rotation.x = damp(l.up.rotation.x, lx, this.state === 'slam' ? 30 : 8, dt);
    l.up.rotation.z = -0.3;
    r.up.rotation.z = 0.3;
    m.torso.rotation.x = damp(m.torso.rotation.x, tx, 8, dt);
    if (Math.random() < 0.2) this.game.fx.smoke(this.m.torso.localToWorld(_fxp.set(0.5, 2.4, -0.8)), 1, '#2a2430', 0.6, 1);
  }
}

// =========================================================================================
// Boss final : le Goinfrotron
class Goinfrotron extends Enemy {
  init() {
    this.cool = 3;
    this.walk = 0;
    this.phase = 1;
    this.game.hud.boss(this.def.name, 1);
    this.laser = null;
    this.noEdgeCheck = false;
    this.game.bossIntro(this, 'Le Baron Vorax aux commandes');
  }
  hitSpheres() {
    if (!this._hs2) this._hs2 = [{ c: new THREE.Vector3(), r: 3.6 }, { c: new THREE.Vector3(), r: 2.2 }, { c: new THREE.Vector3(), r: 1.4 }];
    this._hs2[0].c.copy(this.pos).setY(this.pos.y + 6.5);
    this._hs2[1].c.copy(this.pos).setY(this.pos.y + 3.5);
    const core = this.m.core;
    core.updateWorldMatrix(true, false);
    this._hs2[2].c.setFromMatrixPosition(core.matrixWorld);
    return this._hs2;
  }
  aimPoint() { return _v.copy(this.pos).setY(this.pos.y + 6); }
  modifyDamage(a, o) {
    // le réservoir dorsal prend les dégâts doublés
    const fwd = _v2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const from = o.dir ? _v3.copy(o.dir).negate().setY(0).normalize() : this.dirToPlayer(_v3);
    const behind = from.dot(fwd) < -0.3;
    if (this.state === 'suck') return a * 1.8; // bouche ouverte = vulnérable
    if (behind) return a * 1.6;
    if (o.explosive) return a * 0.8;
    return a * 0.55;
  }
  onHurt() {
    this.game.hud.boss(this.def.name, this.hp / this.maxHp);
    const f = this.hp / this.maxHp;
    if (this.phase === 1 && f < 0.66) this._phase(2);
    else if (this.phase === 2 && f < 0.33) this._phase(3);
  }
  cleanup() {
    this.game.audio.loop('vacuum', false);
    this._dropLaser();
    this._dropWarn();
  }
  _dropLaser() {
    if (!this.laser) return;
    this.laser.parent && this.laser.parent.remove(this.laser);
    this.laser.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    this.laser = null;
  }
  _phase(n) {
    const g = this.game;
    this.phase = n;
    this.cleanup();
    this.setState('roar');
    g.audio.play('roar', { pos: this.pos, pitch: 0.7 });
    g.camera.shake(0.6);
    if (n === 2) g.hud.say([['baron', 'Tu cabosses ma carrosserie ! Tu sais combien ça coûte, la tôle violette ?!']], true);
    if (n === 3) g.hud.say([['baron', 'MODE ASPIRATION MAXIMALE ! Rien ne m’échappe ! Ni les boulons, ni les fennecs !']], true);
    if (this.onPhase) this.onPhase(n);
  }
  onDeath() {
    const g = this.game;
    g.hud.boss(null);
    this.cleanup();
    g.slowMo(0.2, 2);
  }
  think(dt) {
    const g = this.game;
    const p = this.player;
    if (!p.alive) { g.audio.loop('vacuum', false); return; }
    this.alert = true;
    const d = this.distToPlayer();
    switch (this.state) {
      case 'idle': {
        this.faceTo(p.pos, 0.9 + this.phase * 0.2, dt);
        if (d > 16) this.dirToPlayer(this.move);
        else if (d < 9) this.dirToPlayer(this.move).multiplyScalar(-0.5);
        if (this.pos.distanceTo(this.home) > 14) this.move.subVectors(this.home, this.pos).setY(0).normalize();
        this.cool -= dt;
        if (this.cool <= 0) {
          const opts = ['missiles', 'suck', 'laser', 'stomp'];
          if (this.phase >= 2) opts.push('summon');
          let pickS = pick(opts);
          if (pickS === this.lastAttack) pickS = pick(opts);
          this.lastAttack = pickS;
          this.setState(pickS + 'Wind');
          if (pickS === 'suck') g.audio.play('charge', { pos: this.pos, pitch: 0.6 });
        }
        break;
      }
      case 'missilesWind':
        this.faceTo(p.pos, 2, dt);
        if (this.st > 0.6) { this.setState('missiles'); this.shots = 0; this.shotT = 0; }
        break;
      case 'missiles':
        this.shotT -= dt;
        if (this.shotT <= 0) {
          this.shotT = 0.22;
          const pod = this.m.pods[this.shots % 2];
          pod.updateWorldMatrix(true, false);
          const from = new THREE.Vector3(0, 0.8, 0).applyMatrix4(pod.matrixWorld);
          const dir = new THREE.Vector3(rand(-0.5, 0.5), 1, rand(-0.5, 0.5)).normalize();
          g.projectiles.spawn('missile', from, dir, { damage: 14 });
          g.audio.play('rocket', { pos: from, pitch: 1.3, vol: 0.5 });
          this.shots++;
          if (this.shots >= 4 + this.phase * 2) { this.setState('idle'); this.cool = rand(2, 3) - this.phase * 0.3; }
        }
        break;
      case 'suckWind':
        this.faceTo(p.pos, 2, dt);
        if (this.st > 0.8) { this.setState('suck'); g.audio.loop('vacuum', true); }
        break;
      case 'suck': {
        this.faceTo(p.pos, 1.2, dt);
        // aspiration : attire Kobi vers la bouche
        const m = this.m.mouth;
        m.updateWorldMatrix(true, false);
        const mouth = new THREE.Vector3().setFromMatrixPosition(m.matrixWorld);
        const to = _v.subVectors(mouth, p.pos).setY(0);
        const dist = to.length();
        to.normalize();
        const pull = (7 + this.phase * 1.5) * clamp(1.4 - dist / 30, 0.3, 1);
        if (p.state === 'normal') { p.pos.addScaledVector(to, pull * dt); }
        if (Math.random() < 0.8) {
          const s = _fxp.copy(mouth).add(_fxv.set(rand(-10, 10), rand(-4, 2), rand(-10, 10)));
          g.fx.puff(s, _v2.subVectors(mouth, s).multiplyScalar(1.5), { life: 0.6, size: 0.4, size1: 0.1, color: C_SUCK, alpha: 0.6, tile: 0 });
        }
        if (dist < 4.5) p.hurt(14, mouth, 18);
        if (this.st > 3.2 + this.phase * 0.5) { g.audio.loop('vacuum', false); this.setState('idle'); this.cool = rand(1.5, 2.5); }
        break;
      }
      case 'laserWind':
        this.faceTo(p.pos, 3, dt);
        if (!this.warn) {
          this.laserDir = Math.random() < 0.5 ? 1 : -1;
          this._makeWarn();
        }
        this.warn.position.set(this.pos.x, this.pos.y + 0.15, this.pos.z);
        this.warn.rotation.y = this.yaw - this.laserDir * 1.1;
        this.warn.material.opacity = 0.25 + 0.35 * Math.abs(Math.sin(this.st * 14));
        if (this.st > 0.9) {
          this._dropWarn();
          this.setState('laser');
          this.sweepDir = this.laserDir || 1;
          this.sweep0 = this.yaw - this.sweepDir * 1.1;
          this._makeLaser();
          g.audio.play('laser', { pos: this.pos, pitch: 0.7 });
        }
        break;
      case 'laser': {
        // balayage horizontal au ras du sol : il faut sauter
        const k = this.st / (2.2 - this.phase * 0.2);
        const a = this.sweep0 + this.sweepDir * 2.2 * k;
        this.yaw = a;
        const origin = this.m.mouth.getWorldPosition(_fxv);
        const groundY = this.pos.y + 0.6;
        const dir = _dir.set(Math.sin(a), 0, Math.cos(a));
        this.laser.position.set(origin.x, groundY, origin.z);
        this.laser.rotation.y = a;
        // touche Kobi s'il est au sol dans l'axe
        const rel = _v.subVectors(p.pos, this.laser.position);
        const along = rel.dot(dir);
        const lateral = Math.abs(rel.x * dir.z - rel.z * dir.x);
        if (along > 0 && along < 40 && lateral < 0.8 && p.pos.y - groundY < 0.9) p.hurt(20, this.pos, 8);
        if (Math.random() < 0.8) g.fx.sparks(_fxp.copy(this.laser.position).addScaledVector(dir, rand(3, 40)), UP, 2, '#ff4fa0', 5);
        if (k >= 1) { this._dropLaser(); this.setState('idle'); this.cool = rand(1.5, 2.5); }
        break;
      }
      case 'stompWind':
        if (this.st > 0.9) {
          this.setState('stomp');
          g.audio.play('slam', { pos: this.pos, pitch: 0.5 });
          g.camera.shake(0.7);
          g.fx.ring(this.pos, '#c890ff', 14, 0.8);
          g.fx.dust(this.pos, 20, '#9a8ab0', 8, 2);
          for (let k = 0; k < 12 + this.phase * 4; k++) {
            const a = (k / (12 + this.phase * 4)) * Math.PI * 2;
            g.projectiles.spawn('ebolt', this.pos.clone().setY(this.pos.y + 1), new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), { damage: 12, speed: 11 });
          }
        }
        break;
      case 'stomp':
        if (this.st > 0.8) { this.setState('idle'); this.cool = rand(1.5, 2.5); }
        break;
      case 'summonWind':
        if (this.st > 0.6) {
          this.setState('idle');
          this.cool = 2;
          const types = this.phase >= 3 ? ['larbin', 'bourdon', 'boumboule'] : ['grignoteur', 'boumboule', 'bourdon'];
          for (let i = 0; i < 3; i++) {
            const a = rand(0, Math.PI * 2);
            g.enemies.spawn(types[i], this.pos.clone().add(new THREE.Vector3(Math.cos(a) * 12, 1, Math.sin(a) * 12)), { warp: true, alert: true, summoned: true });
          }
        }
        break;
      case 'roar':
        if (this.st > 1.5) { this.setState('summonWind'); }
        break;
    }
  }
  _makeWarn() {
    this._dropWarn();
    const geo = new THREE.PlaneGeometry(1.4, 40).rotateX(-Math.PI / 2).translate(0, 0, 20);
    this.warn = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#ff3a8a', transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.game.scene.add(fxLayer(this.warn));
  }
  _dropWarn() {
    if (!this.warn) return;
    this.warn.parent && this.warn.parent.remove(this.warn);
    this.warn.geometry.dispose(); this.warn.material.dispose();
    this.warn = null;
  }
  _makeLaser() {
    const g = this.game;
    const geo = new THREE.BoxGeometry(0.6, 0.6, 40).translate(0, 0, 20);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff4fa0').multiplyScalar(4), transparent: true, opacity: 0.9 }));
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 40).translate(0, 0, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff').multiplyScalar(4) }));
    m.add(core);
    g.scene.add(m);
    this.laser = m;
  }
  animate(dt) {
    const m = this.m;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.walk += dt * (0.6 + sp * 0.8);
    const sw = Math.sin(this.walk) * Math.min(1, sp);
    m.legs[0].hip.rotation.x = sw * 0.4;
    m.legs[1].hip.rotation.x = -sw * 0.4;
    m.hips.position.y = 4.2 + Math.abs(Math.cos(this.walk)) * 0.2 * Math.min(1, sp);
    m.fan.rotation.z += dt * (this.state === 'suck' ? 30 : 3);
    m.throat.material = m.throat.material;
    m.core.scale.setScalar(1 + Math.sin(this.t * 5) * 0.12);
    const wind = this.state.endsWith('Wind');
    m.torso.rotation.x = damp(m.torso.rotation.x, this.state === 'suck' ? 0.25 : wind ? -0.15 : 0, 4, dt);
    for (const [i, a] of m.arms.entries()) {
      a.up.rotation.x = damp(a.up.rotation.x, this.state === 'missiles' ? -0.5 : this.state === 'stompWind' ? -2.5 : -0.2 + Math.sin(this.t + i) * 0.1, 5, dt);
      a.up.rotation.z = (i ? 1 : -1) * 0.25;
    }
    m.baron.rotation.y = Math.sin(this.t * 2) * 0.4;
    if (this.state === 'stompWind') m.hips.position.y += Math.min(1, this.st) * 1.5;
  }
}

// =========================================================================================
// Larbin-Bouclier : bouclier frontal (seuls les coups de dos, de flanc ou les explosions passent), coup de bouclier
class LarbinBouclier extends Larbin {
  // il ne se cache pas et n'esquive pas : son bouclier s'en charge
  init() { super.init(); this.fireT = rand(2.5, 4); this.usesCover = false; }
  modifyDamage(a, o) {
    if (o.explosive || o.zap) return a;
    const src = o.dir ? _v.copy(o.dir).negate() : this.dirToPlayer(_v);
    const fwd = _v2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const front = src.x * fwd.x + src.z * fwd.z;
    if (front > 0.3 && this.state !== 'punch') {
      const g = this.game;
      g.audio.play('shieldHit', { pos: this.pos, pitch: 1.3 });
      g.fx.sparks(this.aimPoint().clone().addScaledVector(fwd, 0.8), fwd, 5, '#7ff8ff', 6);
      this.shieldFlash = 1;
      return a * 0.08;
    }
    if (front < -0.4) return a * 1.5;
    return a;
  }
  think(dt) {
    super.think(dt);
    // avance plus volontiers au contact
    if (this.alert && this.player.alive && this.state !== 'punchWind' && this.state !== 'punch') {
      const d = this.distToPlayer();
      if (d > 4) this.move.add(this.dirToPlayer(_v3).multiplyScalar(0.6));
      if (this.move.lengthSq() > 1) this.move.normalize();
    }
  }
  animate(dt) {
    super.animate(dt);
    const l = this.m.arms[0];
    const thrust = this.state === 'punch' ? -2.0 : this.state === 'punchWind' ? -0.6 : -1.25;
    l.up.rotation.x = damp(l.up.rotation.x, thrust, this.state === 'punch' ? 30 : 10, dt);
    l.fore.rotation.x = damp(l.fore.rotation.x, this.state === 'punch' ? -0.2 : -0.9, 12, dt);
    l.up.rotation.z = -0.15;
    this.shieldFlash = Math.max(0, (this.shieldFlash || 0) - dt * 4);
    this.m.shield.scale.setScalar(1 + this.shieldFlash * 0.12);
  }
}

// =========================================================================================
// Lunette : tireur d'élite. Garde ses distances, vise longuement au laser (la ligne se fige juste avant le tir).
class Lunette extends Enemy {
  init() {
    this.fireT = rand(1.5, 2.5); this.walk = 0; this.strafe = rand() < 0.5 ? 1 : -1;
    this.aimDir = new THREE.Vector3(0, 0, 1);
    const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.sight = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color('#ff2a3a').multiplyScalar(2), transparent: true, opacity: 0.85 }));
    this.sight.frustumCulled = false;
    this.sight.visible = false;
    this.game.scene.add(this.sight);
  }
  cleanup() { if (this.sight) { this.sight.parent && this.sight.parent.remove(this.sight); this.sight.geometry.dispose(); this.sight = null; } }
  onDeath() { this.cleanup(); }
  onAlert() { this.game.audio.play('robot', { pos: this.pos, pitch: 1.3 }); }
  _muzzle(out) { this.m.muzzle.updateWorldMatrix(true, false); return out.setFromMatrixPosition(this.m.muzzle.matrixWorld); }
  think(dt) {
    const g = this.game;
    const p = this.player;
    if (!this.alert || !p.alive) { this.sight.visible = false; if (this.state !== 'idle') this.setState('idle'); return; }
    const d = this.distToPlayer();
    this.faceTo(p.pos, this.state === 'aim' ? 4 : 6, dt);
    if (this.state === 'aim') {
      // la ligne suit Kobi, puis se fige 0,3 s avant le tir
      const from = this._muzzle(_v);
      if (this.st < 1.0) this.aimDir.subVectors(p.center, from).normalize();
      const a = this.sight.geometry.attributes.position;
      const to = _v2.copy(from).addScaledVector(this.aimDir, 60);
      const hit = g.world.raycast(from, this.aimDir, 60, (c) => c.blocksCamera !== false);
      if (hit) to.copy(from).addScaledVector(this.aimDir, hit.t);
      a.setXYZ(0, from.x, from.y, from.z); a.setXYZ(1, to.x, to.y, to.z); a.needsUpdate = true;
      this.sight.visible = this.st < 1.0 || Math.floor(this.st * 24) % 2 === 0;
      this.sight.material.opacity = 0.4 + Math.min(1, this.st / 1.0) * 0.5;
      if (this.st > 1.0 && !this._locked) { this._locked = true; g.audio.play('beep', { pos: this.pos, pitch: 2.6, vol: 0.7 }); }
      if (this.st > 1.3) {
        g.projectiles.spawn('snipe', from, this.aimDir, { damage: 22, speed: 75 });
        g.fx.muzzle(from, this.aimDir, '#ff3a3a', 0.9);
        g.audio.play('laser', { pos: from, pitch: 1.6 });
        this.recoil = 1;
        this.sight.visible = false;
        this.setState('cool');
        this.fireT = rand(1.8, 2.8);
      }
      return;
    }
    this.sight.visible = false;
    if (this.state === 'kickWind') {
      if (this.st > 0.3) { this.setState('kick'); this.touchPlayer(2.0, 10, 13); g.audio.play('swing', { pos: this.pos, pitch: 1.2 }); }
      return;
    }
    if (this.state === 'kick') { if (this.st > 0.35) this.setState('idle'); return; }
    // change de poste : court vers un abri voisin après avoir encaissé
    if (this.state === 'relocate') {
      const to = _v3.subVectors(this.coverAt, this.pos).setY(0);
      const dd = to.length();
      if (dd > 0.7 && this.st < 2.4) { this.move.copy(to.divideScalar(dd)); this.speedMult = 1.3; return; }
      this.setState('idle');
      this.fireT = Math.min(this.fireT, 0.8);
    }
    this.speedMult = 1;
    this.coverCD = (this.coverCD ?? rand(0.5, 1.5)) - dt;
    if (this.coverCD <= 0 && this.recentDmg > this.maxHp * 0.25 && d > 6) {
      this.coverCD = rand(5, 8);
      const c = this.findCover(11);
      if (c) { this.coverAt = c; this.recentDmg = 0; this.setState('relocate'); return; }
    }
    if (this.tryDodge(dt, 0.45)) return;
    // déplacements : garde une distance de tir confortable
    const dir = this.dirToPlayer(_v3);
    const side = _v2.set(-dir.z, 0, dir.x).multiplyScalar(this.strafe);
    if (d < 3) { this.setState('kickWind'); return; }
    if (d < 13) this.move.copy(dir).multiplyScalar(-1).addScaledVector(side, 0.3);
    else if (d > 28) this.move.copy(dir).addScaledVector(side, 0.2);
    else this.move.copy(side).multiplyScalar(0.4);
    if (this.move.lengthSq() > 1) this.move.normalize();
    if (rand() < dt * 0.3) this.strafe *= -1;
    this.fireT -= dt * this.aggro;
    if (this.fireT <= 0 && d < 45 && this.canSeePlayer(45)) { this.setState('aim'); this._locked = false; g.audio.play('charge', { pos: this.pos, pitch: 2.2, vol: 0.5 }); }
  }
  animate(dt) {
    const m = this.m;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.walk += dt * sp * 2.2;
    const sw = Math.sin(this.walk) * Math.min(1, sp / 2);
    m.legs[0].hip.rotation.x = -0.35 + sw * 0.4;
    m.legs[1].hip.rotation.x = -0.35 - sw * 0.4;
    m.hips.position.y = 1.15 + Math.abs(Math.cos(this.walk)) * 0.04 - (this.state === 'aim' ? 0.08 : 0);
    this.recoil = Math.max(0, (this.recoil || 0) - dt * 5);
    const aiming = this.state === 'aim' || this.state === 'cool';
    // fusil pointé vers Kobi (ou vers le sol au repos)
    const tgt = this.alert && this.player.alive ? this.player.center : _v.copy(this.pos).addScaledVector(_v2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)), 3);
    m.rifleAim.lookAt(tgt);
    m.rifleAim.rotateX(-this.recoil * 0.4);
    m.torso.rotation.x = damp(m.torso.rotation.x, aiming ? 0.12 : 0.05, 8, dt);
    m.eye.scale.setScalar(this.state === 'aim' ? 1 + Math.sin(this.st * 30) * 0.15 : 1);
    if (this.state === 'kickWind' || this.state === 'kick') m.legs[1].hip.rotation.x = this.state === 'kick' ? -1.6 : 0.4;
    m.grip(); // main gauche sous le garde-main, une fois le fusil orienté
  }
}

// =========================================================================================
// Fouisseur : creuse, file sous terre vers Kobi (traînée de poussière), s'arrête, cercle d'alerte, surgit.
class Fouisseur extends Enemy {
  init() { this.digT = rand(1.5, 2.5); this.walk = 0; this.setState('surface'); }
  modifyDamage(a) { return this.hidden ? 0 : a; }
  think(dt) {
    const g = this.game;
    const p = this.player;
    if (!this.alert || !p.alive) { if (this.hidden) this._emerge(false); return; }
    const d = this.distToPlayer();
    switch (this.state) {
      case 'surface':
        this.faceTo(p.pos, 5, dt);
        if (d > 3) this.dirToPlayer(this.move).multiplyScalar(0.45);
        this.digT -= dt;
        if (this.digT <= 0) { this.setState('dig'); g.audio.play('dig', { pos: this.pos, pitch: 0.8, vol: 0.8 }); }
        break;
      case 'dig':
        if (Math.random() < 0.6) g.fx.dust(this.pos, 2, g.level.dustColor || '#c8a070', 1.6, 0.8);
        if (this.st > 0.6) { this.hidden = true; this.root.visible = false; this.setState('under'); }
        break;
      case 'under':
        this.dirToPlayer(this.move);
        this.speedMult = 1.15;
        if (this.st % 0.09 < dt) g.fx.dust(this.pos, 1, g.level.dustColor || '#c8a070', 1.3, 0.7);
        if (this.st % 0.4 < dt) g.audio.play('dig', { pos: this.pos, vol: 0.5 });
        if (d < 1.4 || this.st > 5) {
          this.setState('warn');
          this.speedMult = 1;
          g.projectiles._marker(this.pos.clone(), 0.7, 2.2);
          g.audio.play('charge', { pos: this.pos, pitch: 1.4, vol: 0.6 });
        }
        break;
      case 'warn':
        if (Math.random() < 0.8) g.fx.dust(this.pos, 2, g.level.dustColor || '#c8a070', 2.4, 0.9);
        if (this.st > 0.7) this._emerge(true);
        break;
      case 'burst':
        if (this.st > 2.8) { this.setState('surface'); this.digT = rand(1.2, 2); }
        break;
    }
  }
  _emerge(attack) {
    const g = this.game;
    this.hidden = false;
    this.root.visible = true;
    this.setState(attack ? 'burst' : 'surface');
    this.vel.y = attack ? 9 : 4;
    g.fx.dust(this.pos, 14, g.level.dustColor || '#c8a070', 4, 1.2);
    g.fx.sparks(this.pos, UP, 12, '#ffd36b', 8);
    g.camera.shakeAt(this.pos, 0.35);
    g.audio.play('slam', { pos: this.pos, pitch: 1.3 });
    if (attack) {
      const p = this.player;
      const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
      if (Math.hypot(dx, dz) < 2.2 && Math.abs(p.pos.y - this.pos.y) < 1.8 && p.hurt(16, this.pos, 8)) p.vel.y = Math.max(p.vel.y, 9);
    }
  }
  animate(dt) {
    const m = this.m;
    const spinning = this.state === 'burst' || this.state === 'dig' || this.state === 'warn';
    m.bit.rotation.z += dt * (spinning ? 30 : 4);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.walk += dt * (2 + sp * 3);
    m.claws.forEach((c, i) => { c.rotation.x = 0.4 + Math.sin(this.walk + i * Math.PI) * 0.35 * Math.min(1, sp) + (this.state === 'dig' ? Math.sin(this.st * 40) * 0.6 : 0); });
    m.body.position.y = 0.62 - (this.state === 'dig' ? this.st * 1.2 : 0) + (this.state === 'surface' ? Math.abs(Math.sin(this.walk)) * 0.04 : 0);
    m.body.rotation.x = this.state === 'dig' ? 0.6 : this.state === 'burst' && this.st < 0.5 ? -0.8 * (1 - this.st * 2) : 0;
  }
}

// =========================================================================================
// Moustique : nuée de mini-drones qui tournent autour de Kobi et piquent tour à tour.
class Moustique extends Enemy {
  init() { this.orbit = rand(0, TAU_E); this.rad = rand(2.6, 4.6); this.alt = rand(1.2, 2.6); this.diveT = rand(1.5, 4); this.pos.y += this.alt; this.home.y = this.pos.y; }
  think(dt) {
    const p = this.player;
    if (!this.alert || !p.alive) {
      this.orbit += dt * 1.5;
      const t = _v.set(this.home.x + Math.cos(this.orbit) * 1.5, this.home.y + Math.sin(this.t * 3) * 0.3, this.home.z + Math.sin(this.orbit) * 1.5);
      this.vel.lerp(_v2.subVectors(t, this.pos).multiplyScalar(2), 1 - Math.exp(-4 * dt));
      return;
    }
    if (this.state === 'dive') {
      this.vel.copy(this.diveDir).multiplyScalar(15);
      if (!this.hitDone && this.touchPlayer(0.9, 5, 3)) this.hitDone = true;
      if (this.st > 0.35) { this.setState('idle'); this.diveT = rand(2, 4); this.vel.y = 4; }
      return;
    }
    this.orbit += dt * (1.6 + Math.sin(this.t * 0.7) * 0.5);
    const c = p.center;
    const t = _v.set(c.x + Math.cos(this.orbit) * this.rad, c.y + this.alt - 0.8 + Math.sin(this.t * 4) * 0.4, c.z + Math.sin(this.orbit) * this.rad);
    this.vel.lerp(_v2.subVectors(t, this.pos).multiplyScalar(3).clampLength(0, 11), 1 - Math.exp(-5 * dt));
    this.faceTo(p.pos, 8, dt);
    this.diveT -= dt;
    if (this.diveT <= 0) {
      this.setState('dive');
      this.hitDone = false;
      this.diveDir = _v3.subVectors(p.center, this.pos).normalize().clone();
      this.game.audio.play('beep', { pos: this.pos, pitch: 3, vol: 0.3 });
    }
  }
  animate() {
    const m = this.m;
    const f = Math.sin(this.t * 70) * 0.6;
    m.wings[0].rotation.z = f; m.wings[1].rotation.z = -f;
    m.body.rotation.x = this.state === 'dive' ? 0.6 : clamp(this.vel.length() * 0.03, 0, 0.3);
  }
}

// =========================================================================================
// Phaseur : se dématérialise, réapparaît ailleurs autour de Kobi et lance des orbes chercheuses.
class Phaseur extends Enemy {
  init() { this.castT = rand(1, 2); this.fade = 1; this.setState('idle'); }
  onHurt() {
    // touché : il esquive parfois en se téléportant aussitôt
    if (this.state === 'idle' && Math.random() < 0.35) this._startBlink();
  }
  modifyDamage(a) { return this.state === 'blinkIn' || this.state === 'blinkOut' ? a * 0.3 : a; }
  _startBlink() {
    this.setState('blinkOut');
    this.game.audio.play('forcefield', { pos: this.pos, pitch: 2.4, vol: 0.4 });
    this.game.fx.sparks(this.aimPoint().clone(), UP, 14, '#c890ff', 6);
  }
  think(dt) {
    const g = this.game;
    const p = this.player;
    if (!this.alert || !p.alive) return;
    this.faceTo(p.pos, 6, dt);
    switch (this.state) {
      case 'idle':
        this.castT -= dt * this.aggro;
        if (this.castT <= 0) { this.setState('cast'); this.shots = 0; this.shotT = 0.15; g.audio.play('charge', { pos: this.pos, pitch: 1.8, vol: 0.5 }); }
        break;
      case 'cast':
        this.shotT -= dt;
        if (this.shotT <= 0 && this.shots < 3) {
          this.shotT = 0.3;
          const h = this.m.hands[this.shots % 2];
          h.updateWorldMatrix(true, false);
          const from = new THREE.Vector3().setFromMatrixPosition(h.matrixWorld);
          const dir = _v.subVectors(p.center, from).normalize().add(_v2.set(rand(-0.4, 0.4), 0.5, rand(-0.4, 0.4))).normalize();
          g.projectiles.spawn('orb', from, dir, { damage: 9, speed: 9 });
          g.audio.play('enemyShot', { pos: from, pitch: 0.7 });
          this.shots++;
        }
        if (this.st > 1.2) this._startBlink();
        break;
      case 'blinkOut':
        this.fade = Math.max(0, 1 - this.st / 0.28);
        if (this.st > 0.28) {
          // nouvelle position : à 8-14 m de Kobi, sur un sol solide
          for (let k = 0; k < 8; k++) {
            const a = rand(0, TAU_E), r = rand(8, 14);
            const x = p.pos.x + Math.cos(a) * r, z = p.pos.z + Math.sin(a) * r;
            const h = g.world.groundBelow(x, p.pos.y + 6, z, 14);
            if (h && h.normal.y > 0.7 && h.collider.tag !== 'lava' && Math.abs(h.point.y - p.pos.y) < 4) { this.pos.set(x, h.point.y, z); this.vel.set(0, 0, 0); break; }
          }
          g.fx.ring(this.pos, '#c890ff', 2.5, 0.4);
          this.setState('blinkIn');
        }
        break;
      case 'blinkIn':
        this.fade = Math.min(1, this.st / 0.28);
        if (this.st > 0.28) { this.setState('idle'); this.castT = rand(0.8, 1.6); }
        break;
    }
  }
  animate(dt) {
    const m = this.m;
    m.body.position.y = 1.3 + Math.sin(this.t * 2.2) * 0.1;
    m.ring.rotation.z += dt * 2;
    m.ring.rotation.x = Math.sin(this.t * 1.3) * 0.2;
    m.core.rotation.y += dt * 3;
    m.core.scale.setScalar(1 + Math.sin(this.t * 9) * 0.15 + (this.state === 'cast' ? 0.3 : 0));
    m.hands.forEach((h, i) => {
      const s = i ? 1 : -1;
      h.position.y = 0.1 + Math.sin(this.t * 2 + i) * 0.08 + (this.state === 'cast' ? 0.25 : 0);
      h.position.z = 0.15 + (this.state === 'cast' ? 0.25 : 0);
      h.position.x = s * (0.62 + (this.state === 'cast' ? -0.15 : 0));
    });
    const f = Math.max(0.01, this.fade);
    const b = this.baseScale;
    if (!this.squashP) this.root.scale.set(b * (0.3 + 0.7 * f), b * (1.6 - 0.6 * f), b * (0.3 + 0.7 * f));
    this.root.visible = this.fade > 0.02;
  }
}
const TAU_E = Math.PI * 2;

// =========================================================================================
// Pingouin-mortier : bombarde de boules de neige à distance, fonce sur le ventre quand Kobi approche.
class Pingouin extends Enemy {
  init() { this.walk = 0; this.mortarT = rand(1.5, 3); this.slideCD = rand(1.5, 3); }
  onAlert() { this.game.audio.play('quack', { pos: this.pos, pitch: 0.7, vol: 0.6 }); }
  think(dt) {
    const g = this.game;
    const p = this.player;
    this.speedMult = 1;
    if (!this.alert || !p.alive) {
      const a = this.t * 0.35;
      this.move.set(Math.sin(a), 0, Math.cos(a * 0.7)).multiplyScalar(0.3);
      if (this.pos.distanceTo(this.home) > 5) this.move.subVectors(this.home, this.pos).setY(0).normalize().multiplyScalar(0.4);
      if (this.move.lengthSq() > 0.01) this.yaw = dampAngle(this.yaw, Math.atan2(this.move.x, this.move.z), 4, dt);
      return;
    }
    const d = this.distToPlayer();
    if (this.state === 'slide') {
      this.move.copy(this.slideDir);
      this.speedMult = 3.6;
      this.noEdgeCheck = true;
      if (!this.hitDone && this.touchPlayer(1.3, 12, 11)) this.hitDone = true;
      if (Math.random() < 0.6) g.fx.puff(_fxp.copy(this.pos).setY(this.pos.y + 0.2), _fxv.set(rand(-1, 1), 1.2, rand(-1, 1)), { life: 0.6, size: 0.3, size1: 0.9, color: C_SNOW, alpha: 0.6, tile: 0 });
      const ahead = g.world.raycast(this.aimPoint().clone(), this.slideDir, this.radius + 0.6);
      if (this.st > 1.15 || ahead) { this.setState('getup'); this.noEdgeCheck = false; }
      return;
    }
    if (this.state === 'getup') { if (this.st > 0.55) this.setState('idle'); return; }
    if (this.state === 'slideWind') {
      this.faceTo(p.pos, 10, dt);
      if (this.st > 0.45) {
        this.setState('slide');
        this.slideDir = this.dirToPlayer(new THREE.Vector3()).clone();
        this.hitDone = false;
        g.audio.play('whoosh', { pos: this.pos, pitch: 1.3 });
      }
      return;
    }
    if (this.tryDodge(dt, 0.25)) return;
    this.faceTo(p.pos, 6, dt);
    const dir = this.dirToPlayer(_v3);
    if (d > 16) this.move.copy(dir);
    else if (d < 6.5) this.move.copy(dir).multiplyScalar(-0.6);
    else this.move.set(-dir.z, 0, dir.x).multiplyScalar(0.35 * Math.sin(this.t * 0.5 + this.home.x));
    this.slideCD -= dt;
    if (d < 9 && this.slideCD <= 0 && this.grounded) { this.setState('slideWind'); this.slideCD = rand(4, 6); g.audio.play('windup', { pos: this.pos, pitch: 1.5, vol: 0.5 }); return; }
    this.mortarT -= dt * this.aggro;
    if (this.mortarT <= 0 && d < 28 && this.canSeePlayer(30)) {
      const tp = p.pos.clone().add(new THREE.Vector3(p.vel.x * 0.7, 0, p.vel.z * 0.7));
      const hit = g.world.groundBelow(tp.x, tp.y + 3, tp.z, 10);
      if (hit) tp.y = hit.point.y;
      const m = this.m.mortar;
      m.updateWorldMatrix(true, false);
      const from = new THREE.Vector3(0, 0.5, 0).applyMatrix4(m.matrixWorld);
      const T = 1.25;
      const vel = new THREE.Vector3((tp.x - from.x) / T, 0, (tp.z - from.z) / T);
      vel.y = (tp.y - from.y + 0.5 * 22 * T * T) / T;
      g.projectiles.spawn('snowball', from, vel, { damage: 12, targetPos: tp, markerTime: T, radius: 2.6 });
      g.audio.play('bomb', { pos: from, pitch: 1.2 });
      this.recoil = 1;
      this.mortarT = rand(2.8, 4);
    }
  }
  animate(dt) {
    const m = this.m;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.walk += dt * (3 + sp * 3);
    const sliding = this.state === 'slide';
    const lie = sliding ? 1.35 : this.state === 'getup' ? 1.35 * Math.max(0, 1 - this.st / 0.5) : this.state === 'slideWind' ? -0.25 : 0;
    m.body.rotation.x = damp(m.body.rotation.x, lie, 14, dt);
    m.body.rotation.z = sliding ? 0 : Math.sin(this.walk) * 0.14 * Math.min(1, sp / 2);
    m.body.position.y = damp(m.body.position.y, sliding ? 0.38 : 0.55 + Math.abs(Math.sin(this.walk)) * 0.04, 12, dt);
    m.flippers.forEach((f, i) => {
      const s = i ? 1 : -1;
      f.rotation.z = s * (sliding ? 1.4 : 0.35 + Math.max(0, Math.sin(this.walk * 2 + i)) * 0.4 * Math.min(1, sp));
      f.rotation.x = sliding ? 0.8 : 0;
    });
    m.head.rotation.x = sliding ? -1.0 : 0;
    this.recoil = Math.max(0, (this.recoil || 0) - dt * 4);
    m.mortar.rotation.x = -0.4 + this.recoil * 0.4;
  }
}

// =========================================================================================
// Champi-cracheur : planté dans le sol, protégé par son chapeau ; il se dresse pour cracher des spores toxiques.
class Champi extends Enemy {
  init() { this.up = 0; this.cycleT = rand(1, 2.2); this.setState('hidden'); }
  modifyDamage(a, o) {
    if (this.up < 0.5 && !o.explosive) { this.game.fx.sparks(this.aimPoint().clone(), UP, 4, '#7affc8', 4); return a * 0.15; }
    return a;
  }
  think(dt) {
    const g = this.game;
    const p = this.player;
    const want = this.state === 'hidden' ? 0 : 1;
    this.up = damp(this.up, want, this.state === 'rise' ? 10 : 6, dt);
    if (!this.alert || !p.alive) { if (this.state !== 'hidden') this.setState('hidden'); return; }
    this.faceTo(p.pos, 5, dt);
    switch (this.state) {
      case 'hidden':
        this.cycleT -= dt * this.aggro;
        if (this.cycleT <= 0 && this.distToPlayer() < 30) { this.setState('rise'); g.audio.play('pop', { pos: this.pos, pitch: 0.5 }); }
        break;
      case 'rise':
        if (this.st > 0.45) { this.setState('spit'); this.shots = 0; this.shotT = 0.2; }
        break;
      case 'spit':
        this.shotT -= dt;
        if (this.shotT <= 0 && this.shots < 2) {
          this.shotT = 0.55;
          this.shots++;
          const off = this.shots === 1 ? new THREE.Vector3(p.vel.x * 0.8, 0, p.vel.z * 0.8) : new THREE.Vector3(rand(-3, 3), 0, rand(-3, 3));
          const tp = p.pos.clone().add(off);
          const hit = g.world.groundBelow(tp.x, tp.y + 3, tp.z, 10);
          if (hit) tp.y = hit.point.y;
          const from = this.pos.clone().setY(this.pos.y + 1.9);
          const T = 1.1;
          const vel = new THREE.Vector3((tp.x - from.x) / T, 0, (tp.z - from.z) / T);
          vel.y = (tp.y - from.y + 0.5 * 22 * T * T) / T;
          g.projectiles.spawn('spore', from, vel, { damage: 8, targetPos: tp, markerTime: T, radius: 2.4 });
          g.audio.play('enemyShot', { pos: from, pitch: 0.5 });
          this.puff = 1;
        }
        if (this.st > 1.6) { this.setState('hidden'); this.cycleT = rand(1.4, 2.4); }
        break;
    }
  }
  animate(dt) {
    const m = this.m;
    this.puff = Math.max(0, (this.puff || 0) - dt * 4);
    m.stem.position.y = 0.1 - (1 - this.up) * 0.95;
    m.stem.scale.y = 0.55 + this.up * 0.45;
    m.cap.scale.setScalar(1 + this.puff * 0.15 + Math.sin(this.t * 3) * 0.02);
    m.cap.rotation.z = Math.sin(this.t * 1.7) * 0.06;
    m.spots.forEach((s, i) => s.scale.setScalar(0.8 + 0.3 * Math.sin(this.t * 4 + i)));
  }
}

// =========================================================================================
// Mammouth-Foreuse, boss de Givrelune : charge aux défenses, piétinement à ondes, salves de neige, forage.
class Mammouth extends Enemy {
  init() {
    this.cool = 2.5; this.walk = 0; this.phase = 1; this.rings = [];
    this.noEdgeCheck = false;
    this.game.hud.boss(this.def.name, 1);
    this.game.bossIntro(this, 'La foreuse à défenses du Baron');
  }
  hitSpheres() {
    if (!this._hs2) this._hs2 = [{ c: new THREE.Vector3(), r: 2.6 }, { c: new THREE.Vector3(), r: 1.5 }, { c: new THREE.Vector3(), r: 1.0 }];
    if (this.hidden) { this._hs2[0].c.set(0, -999, 0); this._hs2[1].c.set(0, -999, 0); this._hs2[2].c.set(0, -999, 0); return this._hs2; }
    this._hs2[0].c.copy(this.pos).setY(this.pos.y + 3.4);
    this.m.head.updateWorldMatrix(true, false);
    this._hs2[1].c.setFromMatrixPosition(this.m.head.matrixWorld);
    this.m.core.updateWorldMatrix(true, false);
    this._hs2[2].c.setFromMatrixPosition(this.m.core.matrixWorld);
    return this._hs2;
  }
  aimPoint() { return _v.copy(this.pos).setY(this.pos.y + 3.6); }
  modifyDamage(a, o) {
    if (this.hidden) return 0;
    if (this.state === 'dazed') return a * 1.7;
    const fwd = _v2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const from = o.dir ? _v3.copy(o.dir).negate().setY(0).normalize() : this.dirToPlayer(_v3);
    const front = from.dot(fwd);
    if (front < -0.3) return a * 1.35; // le cœur thermique du dos
    if (front > 0.4 && !o.explosive) return a * 0.6;
    return a;
  }
  onHurt() {
    const g = this.game;
    g.hud.boss(this.def.name, this.hp / this.maxHp);
    const f = this.hp / this.maxHp;
    if (this.phase === 1 && f < 0.6) this._phase(2);
    else if (this.phase === 2 && f < 0.3) this._phase(3);
  }
  _phase(n) {
    const g = this.game;
    this.phase = n;
    this.setState('roar');
    g.audio.play('roar', { pos: this.pos, pitch: 0.55 });
    g.camera.shake(0.6);
    if (n === 2) g.hud.say([['baron', 'Mammouth ! Fore-moi ce fennec jusqu’au noyau de la lune !']], true);
    if (n === 3) g.hud.say([['ecrou', 'Il surchauffe ! Le cœur dans son dos, Kobi, vise le cœur !']], true);
  }
  cleanup() { for (const r of this.rings) { r.mesh.parent && r.mesh.parent.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); } this.rings.length = 0; }
  onDeath() { this.game.hud.boss(null); this.cleanup(); this.game.slowMo(0.25, 1.4); }
  think(dt) {
    const g = this.game;
    const p = this.player;
    this._updateRings(dt);
    if (!p.alive) return;
    this.alert = true;
    const d = this.distToPlayer();
    this.speedMult = 1;
    switch (this.state) {
      case 'idle': {
        this.faceTo(p.pos, 1.6 + this.phase * 0.3, dt);
        if (d > 12) this.dirToPlayer(this.move);
        this.cool -= dt;
        if (this.cool <= 0) {
          const opts = ['charge', 'stomp', 'snow'];
          if (this.phase >= 2) opts.push('burrow', 'charge');
          let pk = pick(opts);
          if (pk === this.last) pk = pick(opts);
          this.last = pk;
          this.setState(pk + 'Wind');
          if (pk === 'charge') g.audio.play('roar', { pos: this.pos, pitch: 0.9, vol: 0.7 });
          if (pk === 'burrow') g.audio.play('dig', { pos: this.pos, pitch: 0.6 });
        }
        break;
      }
      case 'chargeWind':
        this.faceTo(p.pos, 4, dt);
        if (Math.random() < 0.5) g.fx.dust(this.pos, 1, '#eef4ff', 3, 1);
        if (this.st > 0.95) { this.setState('charge'); this.chargeDir = this.dirToPlayer(new THREE.Vector3()).clone(); this.hitDone = false; }
        break;
      case 'charge': {
        this.move.copy(this.chargeDir);
        this.speedMult = 3.8 + this.phase * 0.3;
        if (!this.hitDone && this.touchPlayer(this.radius + 1.2, 28, 18)) this.hitDone = true;
        if (Math.random() < 0.8) g.fx.dust(this.pos, 2, '#eef4ff', 3, 1.4);
        const ahead = g.world.raycast(this.aimPoint().clone().setY(this.pos.y + 1.5), this.chargeDir, this.radius + 1.5);
        if (this.st > 2.3 || ahead) {
          if (ahead) {
            g.camera.shakeAt(this.pos, 0.7);
            g.audio.play('stomp', { pos: this.pos, pitch: 0.6 });
            g.fx.sparks(this.pos.clone().addScaledVector(this.chargeDir, this.radius + 1).setY(this.pos.y + 2), null, 30, '#dff4ff', 10);
            this.setState('dazed');
          } else { this.setState('idle'); this.cool = rand(1.4, 2.2); }
        }
        break;
      }
      case 'dazed':
        if (Math.random() < 0.3) g.fx.sparks(this.m.head.getWorldPosition(_fxp).setY(this.pos.y + 6.5), UP, 2, '#ffe27a', 4);
        if (this.st > 2.2) { this.setState('idle'); this.cool = rand(0.8, 1.5); }
        break;
      case 'stompWind':
        this.faceTo(p.pos, 2, dt);
        if (this.st > 1.0) {
          this.setState('stomp');
          const at = this.pos.clone().addScaledVector(_v2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)), 2.2);
          g.audio.play('slam', { pos: at, pitch: 0.5 });
          g.camera.shakeAt(at, 0.9);
          g.fx.dust(at, 22, '#eef4ff', 7, 2);
          g.fx.ring(at, '#bfe8ff', 6, 0.5);
          if (p.center.distanceTo(at) < 4) p.hurt(24, at, 14);
          this._ring(at, 12 + this.phase * 2);
          if (this.phase >= 2) this.level_after(0.45, () => this._ring(at, 15));
          // stalactites qui tombent autour de Kobi
          for (let i = 0; i < 2 + this.phase; i++) {
            const tp = p.pos.clone().add(new THREE.Vector3(rand(-6, 6), 0, rand(-6, 6)));
            const hit = g.world.groundBelow(tp.x, tp.y + 6, tp.z, 14);
            if (hit) tp.y = hit.point.y;
            g.projectiles.spawn('snowball', tp.clone().setY(tp.y + 16), new THREE.Vector3(0, -4, 0), { damage: 14, targetPos: tp, markerTime: 1.15, radius: 2.4 });
          }
        }
        break;
      case 'stomp':
        if (this.st > 1.1) { this.setState('idle'); this.cool = rand(1.3, 2.2) - this.phase * 0.2; }
        break;
      case 'snowWind':
        this.faceTo(p.pos, 3, dt);
        if (this.st > 0.6) { this.setState('snow'); this.shots = 0; this.shotT = 0; }
        break;
      case 'snow':
        this.faceTo(p.pos, 2, dt);
        this.shotT -= dt;
        if (this.shotT <= 0 && this.shots < 4 + this.phase) {
          this.shotT = 0.28;
          this.shots++;
          const tp = p.pos.clone().add(new THREE.Vector3(this.shots === 1 ? p.vel.x * 0.8 : rand(-5, 5), 0, this.shots === 1 ? p.vel.z * 0.8 : rand(-5, 5)));
          const hit = g.world.groundBelow(tp.x, tp.y + 4, tp.z, 12);
          if (hit) tp.y = hit.point.y;
          const nz = this.m.nozzle;
          nz.updateWorldMatrix(true, false);
          const from = new THREE.Vector3().setFromMatrixPosition(nz.matrixWorld);
          const T = 1.2;
          const vel = new THREE.Vector3((tp.x - from.x) / T, 0, (tp.z - from.z) / T);
          vel.y = (tp.y - from.y + 0.5 * 22 * T * T) / T;
          g.projectiles.spawn('snowball', from, vel, { damage: 14, targetPos: tp, markerTime: T, radius: 2.8 });
          g.audio.play('bomb', { pos: from, pitch: 0.7 });
        }
        if (this.st > 2.2) { this.setState('idle'); this.cool = rand(1.5, 2.4); }
        break;
      case 'burrowWind':
        if (Math.random() < 0.8) g.fx.dust(this.pos, 3, '#eef4ff', 4, 1.4);
        if (this.st > 1.1) { this.hidden = true; this.root.visible = false; this.setState('under'); g.hud.boss(this.def.name, this.hp / this.maxHp); }
        break;
      case 'under':
        this.dirToPlayer(this.move);
        this.speedMult = 2.6;
        if (this.st % 0.08 < dt) g.fx.dust(this.pos, 2, '#eef4ff', 3, 1);
        if (this.st % 0.35 < dt) { g.audio.play('stomp', { pos: this.pos, pitch: 1.4, vol: 0.4 }); g.camera.shakeAt(this.pos, 0.15); }
        if (d < 2 || this.st > 4.5) {
          this.setState('emergeWarn');
          g.projectiles._marker(this.pos.clone(), 0.9, 4.6, '#bfe8ff');
          g.audio.play('charge', { pos: this.pos, pitch: 0.7 });
        }
        break;
      case 'emergeWarn':
        if (Math.random() < 0.9) g.fx.dust(this.pos, 3, '#eef4ff', 5, 1.2);
        if (this.st > 0.9) {
          this.hidden = false;
          this.root.visible = true;
          this.vel.y = 10;
          g.fx.dust(this.pos, 30, '#eef4ff', 8, 2.4);
          g.fx.sparks(this.pos, UP, 30, '#dff4ff', 12);
          g.camera.shakeAt(this.pos, 0.9);
          g.audio.play('slam', { pos: this.pos, pitch: 0.45 });
          const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
          if (Math.hypot(dx, dz) < 4.6 && p.hurt(30, this.pos, 16)) p.vel.y = Math.max(p.vel.y, 11);
          this.setState('idle');
          this.cool = rand(1.2, 2);
        }
        break;
      case 'roar':
        if (this.st > 0.4 && !this.summoned) {
          this.summoned = true;
          const types = this.phase >= 3 ? ['moustique', 'moustique', 'moustique', 'pingouin'] : ['pingouin', 'pingouin', 'pingouin'];
          types.forEach((tp, i) => {
            const a = (i / types.length) * Math.PI * 2;
            g.enemies.spawn(tp, this.pos.clone().add(new THREE.Vector3(Math.cos(a) * 9, 0.5, Math.sin(a) * 9)), { warp: true, alert: true, summoned: true });
          });
        }
        if (this.st > 1.5) { this.summoned = false; this.setState('idle'); this.cool = 1; }
        break;
    }
  }
  level_after(d, fn) { const L = this.game.level; L.after(d, () => { if (this.game.level === L && !this.dead) fn(); }); }
  _ring(at, speed) {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(1, 0.22, 6, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color('#bfe8ff').multiplyScalar(2.5), transparent: true, opacity: 0.9 }));
    mesh.rotation.x = Math.PI / 2;
    mesh.position.copy(at).add(new THREE.Vector3(0, 0.25, 0));
    this.game.scene.add(mesh);
    this.rings.push({ mesh, r: 1, center: at.clone(), hit: false, speed });
  }
  _updateRings(dt) {
    const g = this.game;
    const p = this.player;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.r += r.speed * dt;
      r.mesh.scale.set(r.r, r.r, 1 + r.r * 0.1);
      r.mesh.material.opacity = Math.max(0, 1 - r.r / 26);
      const d = Math.hypot(p.pos.x - r.center.x, p.pos.z - r.center.z);
      if (!r.hit && p.alive && Math.abs(d - r.r) < 0.8 && p.pos.y - r.center.y < 0.9) { r.hit = true; p.hurt(20, r.center, 10); }
      if (Math.random() < 0.5) { const a = rand(0, Math.PI * 2); g.fx.dust(_fxp.set(r.center.x + Math.cos(a) * r.r, r.center.y, r.center.z + Math.sin(a) * r.r), 1, '#eef4ff', 1, 0.8); }
      if (r.r > 26) { r.mesh.parent && r.mesh.parent.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); this.rings.splice(i, 1); }
    }
  }
  animate(dt) {
    const m = this.m;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.walk += dt * (1 + sp * 0.9);
    const g = Math.min(1, sp / 2);
    m.legs.forEach((L, i) => {
      const ph = this.walk + ((i === 0 || i === 3) ? 0 : Math.PI);
      L.hip.rotation.x = Math.sin(ph) * 0.45 * g;
      L.knee.rotation.x = Math.max(0, -Math.cos(ph)) * 0.5 * g;
    });
    let pitch = 0;
    if (this.state === 'stompWind') pitch = -0.45 * Math.min(1, this.st / 0.7);
    else if (this.state === 'stomp') pitch = Math.max(0, 0.2 - this.st * 0.4);
    else if (this.state === 'chargeWind') pitch = 0.12 + Math.sin(this.st * 30) * 0.03;
    else if (this.state === 'charge') pitch = 0.18;
    else if (this.state === 'dazed') pitch = Math.sin(this.st * 6) * 0.05;
    m.body.rotation.x = damp(m.body.rotation.x, pitch, 8, dt);
    m.body.position.y = 3.4 + Math.abs(Math.sin(this.walk)) * 0.15 * g + (this.state === 'stompWind' ? Math.min(1, this.st) * 0.8 : 0);
    m.head.rotation.x = this.state === 'snow' || this.state === 'snowWind' ? -0.35 : this.state === 'dazed' ? 0.25 + Math.sin(this.st * 9) * 0.1 : Math.sin(this.t * 0.8) * 0.05;
    m.head.rotation.y = this.state === 'dazed' ? Math.sin(this.st * 5) * 0.3 : 0;
    const raise = this.state === 'snow' || this.state === 'snowWind' ? -1 : 0;
    m.trunk.forEach((seg, i) => {
      seg.rotation.x = damp(seg.rotation.x, raise * (0.6 + i * 0.3) + Math.sin(this.t * 1.6 - i) * 0.12, 6, dt);
      seg.rotation.z = Math.sin(this.t * 1.1 - i * 0.7) * 0.15;
    });
    const spin = this.state === 'charge' || this.state === 'burrowWind' ? 30 : this.state === 'chargeWind' ? 15 : 2;
    for (const t of m.tusks) t.rotation.z += dt * spin;
    m.core.scale.setScalar(1 + Math.sin(this.t * (this.phase >= 3 ? 9 : 4)) * 0.12);
    if (this.state === 'burrowWind') m.body.position.y -= this.st * 2.5;
  }
}

// =========================================================================================
// Reine Spore, boss de Luminbois : enracinée, elle fouette de ses lianes et crache des spores. Ses pétales
// blindés se referment régulièrement : il faut alors crever les bulbes luminescents pour l'étourdir.
class ReineSpore extends Enemy {
  init() {
    this.cool = 2.5; this.phase = 1; this.open = 1; this.cycle = 7; this.closed = false; this.bulbs = []; this.stunT = 0;
    this.game.hud.boss(this.def.name, 1);
    this.game.bossIntro(this, 'Souveraine de la jungle (et de ses impôts)');
  }
  hitSpheres() {
    if (!this._hs2) this._hs2 = [{ c: new THREE.Vector3(), r: 2.6 }, { c: new THREE.Vector3(), r: 1.3 }];
    this._hs2[0].c.copy(this.pos).setY(this.pos.y + 2.4);
    this.m.core.updateWorldMatrix(true, false);
    this._hs2[1].c.setFromMatrixPosition(this.m.core.matrixWorld);
    return this._hs2;
  }
  aimPoint() { this.m.core.updateWorldMatrix(true, false); return _v.setFromMatrixPosition(this.m.core.matrixWorld); }
  modifyDamage(a, o) {
    if (this.stunT > 0) return a * 2.2;
    if (this.closed) {
      if (!o.zap) { this.game.audio.play('shieldHit', { pos: this.pos, pitch: 0.8 }); this.game.fx.sparks(this.aimPoint().clone(), UP, 4, '#ff9ad8', 5); }
      return a * 0.08;
    }
    return a;
  }
  onHurt() {
    const g = this.game;
    g.hud.boss(this.def.name, this.hp / this.maxHp);
    const f = this.hp / this.maxHp;
    if (this.phase === 1 && f < 0.66) { this.phase = 2; g.hud.say([['baron', 'Ma Reine ! Montrez à ce fennec ce que coûte une visite guidée !']], true); }
    else if (this.phase === 2 && f < 0.33) { this.phase = 3; g.hud.say([['ecrou', 'Elle fatigue ! Encore un effort, vise l’œil dès que les pétales s’ouvrent !']], true); }
  }
  onBulbDestroyed() {
    this.bulbs = this.bulbs.filter((b) => !b.dead);
    const g = this.game;
    if (this.bulbs.length === 0 && this.closed) {
      this.closed = false;
      this.stunT = 6;
      this.cycle = 9;
      g.audio.play('roar', { pos: this.pos, pitch: 1.4 });
      g.camera.shake(0.4);
      g.hud.toast('La Reine est étourdie : visez l’œil !', 2.5);
    } else g.hud.toast(`Bulbes restants : ${this.bulbs.length}`, 1.5);
  }
  cleanup() { for (const b of this.bulbs) if (!b.dead) b.remove(); this.bulbs = []; }
  onDeath() { this.game.hud.boss(null); this.cleanup(); this.game.slowMo(0.25, 1.4); }
  _close() {
    const g = this.game;
    this.closed = true;
    this.cycle = 15;
    g.audio.play('stomp', { pos: this.pos, pitch: 1.6 });
    g.hud.toast('Les pétales se referment : crevez les bulbes luminescents !', 2.5);
    this.bulbs = [];
    for (let i = 0; i < 3; i++) {
      const a = this.yaw + (i / 3) * Math.PI * 2 + 0.5;
      const x = this.pos.x + Math.sin(a) * 11, z = this.pos.z + Math.cos(a) * 11;
      const h = g.world.groundBelow(x, this.pos.y + 6, z, 16);
      const b = g.enemies.spawn('bulbe', new THREE.Vector3(x, h ? h.point.y : this.pos.y, z), { warp: true, alert: true });
      b.queen = this;
      this.bulbs.push(b);
    }
  }
  think(dt) {
    const g = this.game;
    const p = this.player;
    if (!p.alive) return;
    this.alert = true;
    if (this.stunT > 0) { this.stunT -= dt; if (this.stunT <= 0) this.cycle = 4; return; }
    // cycle ouvert / fermé
    this.cycle -= dt;
    if (this.cycle <= 0) {
      if (this.closed) { this.closed = false; this.cycle = 7 - this.phase * 0.6; for (const b of this.bulbs) if (!b.dead) b.remove(); this.bulbs = []; }
      else this._close();
    }
    // le regard suit Kobi
    const want = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    this.yaw = dampAngle(this.yaw, want, 0.8, dt);
    switch (this.state) {
      case 'idle':
        this.cool -= dt;
        if (this.cool <= 0) {
          const opts = ['slam', 'slam', 'spores'];
          if (!this.closed) opts.push('seeds');
          if (this.phase >= 2) opts.push('summon');
          this.setState(pick(opts) + 'Wind');
          if (this.state === 'slamWind') {
            // la liane la plus proche de Kobi se lève ; cercle d'alerte sous lui
            const rel = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z) - this.yaw;
            this.vineIdx = ((Math.round(rel / (Math.PI / 2)) % 4) + 4) % 4;
            this.slamAt = p.pos.clone();
            g.projectiles._marker(this.slamAt, 0.95, 2.8, '#ff9ad8');
          }
        }
        break;
      case 'slamWind':
        if (this.st > 0.95) {
          this.setState('slam');
          g.audio.play('slam', { pos: this.slamAt, pitch: 0.7 });
          g.camera.shakeAt(this.slamAt, 0.6);
          g.fx.dust(this.slamAt, 16, '#3a6a4a', 5, 1.4);
          g.fx.ring(this.slamAt, '#ff9ad8', 3.5, 0.4);
          const dx = p.pos.x - this.slamAt.x, dz = p.pos.z - this.slamAt.z;
          if (Math.hypot(dx, dz) < 2.8 && Math.abs(p.pos.y - this.slamAt.y) < 2) p.hurt(22, this.slamAt, 12);
        }
        break;
      case 'slam':
        if (this.st > 0.7) {
          this.setState('idle');
          this.cool = this.phase >= 3 ? rand(0.6, 1.1) : rand(1.2, 2);
        }
        break;
      case 'sporesWind':
        if (this.st > 0.7) {
          this.setState('idle');
          this.cool = rand(1.4, 2.2);
          for (let i = 0; i < 3 + this.phase; i++) {
            const tp = p.pos.clone().add(new THREE.Vector3(i === 0 ? p.vel.x * 0.7 : rand(-7, 7), 0, i === 0 ? p.vel.z * 0.7 : rand(-7, 7)));
            const hit = g.world.groundBelow(tp.x, tp.y + 5, tp.z, 14);
            if (hit) tp.y = hit.point.y;
            const from = this.aimPoint().clone();
            const T = 1.3 + i * 0.12;
            const vel = new THREE.Vector3((tp.x - from.x) / T, 0, (tp.z - from.z) / T);
            vel.y = (tp.y - from.y + 0.5 * 22 * T * T) / T;
            g.projectiles.spawn('spore', from, vel, { damage: 10, targetPos: tp, markerTime: T, radius: 2.8 });
          }
          g.audio.play('pop', { pos: this.pos, pitch: 0.4 });
        }
        break;
      case 'seedsWind':
        if (this.st > 0.6) {
          this.setState('idle');
          this.cool = rand(1.5, 2.3);
          for (let i = 0; i < 3 + this.phase; i++) {
            const from = this.aimPoint().clone();
            const dir = new THREE.Vector3(rand(-1, 1), 1, rand(-1, 1)).normalize();
            g.projectiles.spawn('orb', from, dir, { damage: 10, speed: 10 });
          }
          g.audio.play('laser', { pos: this.pos, pitch: 0.6 });
        }
        break;
      case 'summonWind':
        if (this.st > 0.6) {
          this.setState('idle');
          this.cool = 2.5;
          const n = this.enemiesAround();
          if (n < 5) {
            const types = this.phase >= 3 ? ['champi', 'moustique', 'moustique'] : ['moustique', 'moustique', 'champi'];
            for (const tp of types) {
              const a = rand(0, Math.PI * 2), r = rand(8, 14);
              const x = this.pos.x + Math.sin(a) * r, z = this.pos.z + Math.cos(a) * r;
              const h = g.world.groundBelow(x, this.pos.y + 6, z, 16);
              g.enemies.spawn(tp, new THREE.Vector3(x, h ? h.point.y : this.pos.y, z), { warp: true, alert: true, summoned: true });
            }
          }
        }
        break;
    }
  }
  enemiesAround() { return this.game.enemies.list.filter((e) => !e.dead && e !== this && e.type !== 'bulbe').length; }
  animate(dt) {
    const m = this.m;
    const openT = this.closed && this.stunT <= 0 ? 0 : 1;
    this.open = damp(this.open, openT, 3, dt);
    m.petals.forEach((pv, i) => {
      pv.rotation.x = lerp(-1.05, 0.8 + Math.sin(this.t * 1.3 + i) * 0.06, this.open) + (this.stunT > 0 ? Math.sin(this.t * 12 + i) * 0.08 : 0);
    });
    m.vines.forEach((chain, i) => {
      const slamming = (this.state === 'slamWind' || this.state === 'slam') && i === this.vineIdx;
      chain.forEach((seg, k) => {
        let x;
        if (slamming && this.state === 'slamWind') x = k === 0 ? -1.3 : -0.25;
        else if (slamming) x = k === 0 ? 0.35 : 0.3;
        else x = (k === 0 ? -0.55 : 0.28) + Math.sin(this.t * 1.4 - k * 0.9 + i * 1.7) * 0.18;
        seg.rotation.x = damp(seg.rotation.x, x, slamming && this.state === 'slam' ? 28 : 5, dt);
        if (k > 0) seg.rotation.z = Math.sin(this.t * 1.1 - k + i) * 0.2;
      });
      if (slamming && this.slamAt) {
        // la liane s'oriente vers la cible
        const rel = Math.atan2(this.slamAt.x - this.pos.x, this.slamAt.z - this.pos.z) - this.yaw;
        chain[0].rotation.y = damp(chain[0].rotation.y, rel, 10, dt);
      } else chain[0].rotation.y = damp(chain[0].rotation.y, (i / 4) * Math.PI * 2, 2, dt);
    });
    const p = this.player;
    m.iris.position.x = damp(m.iris.position.x, clamp((p.pos.x - this.pos.x) * 0.02, -0.25, 0.25), 6, dt);
    m.bulb.scale.set(1 + Math.sin(this.t * 2) * 0.02, 1 + Math.sin(this.t * 2 + 1) * 0.03, 1 + Math.sin(this.t * 2) * 0.02);
  }
}

// Bulbe satellite de la Reine Spore
class Bulbe extends Enemy {
  init() { this.pulse = 0; }
  onDeath() { if (this.queen && !this.queen.dead) this.queen.onBulbDestroyed(); }
  animate(dt) {
    this.pulse += dt * 4;
    this.m.light.scale.setScalar(1 + Math.sin(this.pulse) * 0.15);
    this.m.st.rotation.z = Math.sin(this.t * 1.5) * 0.08;
  }
}

const CLASSES = {
  grignoteur: Grignoteur, larbin: Larbin, bourdon: Bourdon, boumboule: BoumBoule, pinceur: Pinceur, pinceurRoyal: Pinceur, tourelle: TourelleV, canard: Canard, grosbras: Grosbras, goinfrotron: Goinfrotron,
  larbinBouclier: LarbinBouclier, lunette: Lunette, fouisseur: Fouisseur, moustique: Moustique, phaseur: Phaseur,
  pingouin: Pingouin, champi: Champi, bulbe: Bulbe, mammouth: Mammouth, reineSpore: ReineSpore,
};
