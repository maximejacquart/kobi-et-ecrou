// Cœur du jeu : boucle, états, chargement des niveaux, sauvegarde, économie de boulons et d'expérience.
import * as THREE from 'three';
import { Renderer } from '../engine/render.js';
import { lensDirector } from '../engine/post/cinema.js';
import { Input } from '../engine/input.js';
import { AudioEngine } from '../engine/audio.js';
import { PhysicsWorld } from '../engine/physics.js';
import { FX } from '../engine/fx.js';
import { globalU } from '../engine/materials.js';
import { clamp } from '../engine/util.js';
import { Player } from './player.js';
import { CameraRig } from './camera.js';
import { Pickups } from './pickups.js';
import { Props } from './props.js';
import { Enemies } from './enemies.js';
import { Weapons } from './weapons.js';
import { toasterModel, turretModel } from '../models/weapons.js';
import { Upgrades, weaponGrid } from './upgrades.js';
import { Projectiles } from './projectiles.js';
import { Level } from '../levels/level.js';
import { LEVELS, LEVEL_ORDER } from '../levels/index.js';
import { HUD } from '../ui/hud.js';
import { Menus } from '../ui/menus.js';
import { installFur } from '../models/fur.js';
import { PhotoMode } from '../ui/photo.js';
import { waterExplosion } from '../engine/water/water.js';

const SAVE_KEY = 'kobi-ecrou-save-v1';
const SAVE_VERSION = 2;
const OPT_KEY = 'kobi-ecrou-options-v1';
// une partie complète (≈ 6 400 XP) mène Kobi vers le niveau 13 : de quoi finir une branche de l'Établi et entamer
// les autres ; les niveaux 14 et 15 se gagnent en mode Défi (expérience doublée)
const HERO_XP = [0, 150, 350, 650, 1000, 1450, 2000, 2600, 3250, 3950, 4700, 5500, 6300, 8500, 11000];
const heroLevelFor = (xp) => { let l = 1; while (l < HERO_XP.length && xp >= HERO_XP[l]) l++; return l; };

function freshSave() {
  return {
    bolts: 0,
    heroXp: 0,
    heroLevel: 1,
    weapons: null,
    current: 'riveteuse',
    levelsDone: [],
    unlocked: ['brikka'],
    level: 'brikka',
    goldBolts: {},
    orbium: 0,
    orbiumFound: {},
    gadgets: [],
    grids: {},
    tree: [],
    stats: { kills: 0, bolts: 0, deaths: 0, crates: 0, time: 0 },
    started: false,
    // mode Défi : jeu fini au moins une fois, cycle en cours (0 = première partie), planètes finies dans ce cycle
    gameDone: false,
    defi: 0,
    defiDone: [],
    defiCleared: 0,
    bestChain: 1,
    version: SAVE_VERSION,
  };
}

// Mode Défi : ennemis plus coriaces à chaque cycle, expérience doublée, multiplicateur de boulons
export const CHAIN_MAX = 10;
function defiParams(c) {
  if (!c) return { hp: 1, boss: 1, dmg: 1, xp: 1, elite: 0 };
  const k = c - 1;
  return { hp: Math.min(4, 2 + 0.5 * k), boss: Math.min(3, 1.7 + 0.35 * k), dmg: Math.min(2.5, 1.5 + 0.25 * k), xp: 2, elite: Math.min(0.3, 0.12 + 0.05 * k) };
}

// Sauvegarde relue : complétée avec les valeurs par défaut, nettoyée, et migrée (nouvelles planètes débloquées)
function normalizeSave(raw) {
  const base = freshSave();
  if (!raw || typeof raw !== 'object') return base;
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  const d = { ...base, ...raw };
  d.bolts = Math.max(0, num(raw.bolts, 0));
  d.heroXp = Math.max(0, num(raw.heroXp, 0));
  // le niveau découle de l'expérience (les paliers ont changé depuis certaines sauvegardes)
  d.heroLevel = Math.max(heroLevelFor(d.heroXp), Math.min(HERO_XP.length, num(raw.heroLevel, 1)));
  d.stats = { ...base.stats, ...(raw.stats && typeof raw.stats === 'object' ? raw.stats : {}) };
  d.goldBolts = raw.goldBolts && typeof raw.goldBolts === 'object' ? raw.goldBolts : {};
  for (const k of Object.keys(d.goldBolts)) if (!Array.isArray(d.goldBolts[k]) || !LEVELS[k]) delete d.goldBolts[k];
  d.levelsDone = Array.isArray(raw.levelsDone) ? raw.levelsDone.filter((id) => LEVELS[id]) : [];
  d.unlocked = Array.isArray(raw.unlocked) ? raw.unlocked.filter((id) => LEVELS[id]) : [];
  if (!d.unlocked.includes(LEVEL_ORDER[0])) d.unlocked.unshift(LEVEL_ORDER[0]);
  for (const id of d.levelsDone) {
    const next = LEVEL_ORDER[LEVEL_ORDER.indexOf(id) + 1];
    if (next && !d.unlocked.includes(next)) d.unlocked.push(next);
  }
  if (!LEVELS[d.level]) d.level = LEVEL_ORDER[0];
  if (d.weapons !== null && typeof d.weapons !== 'object') d.weapons = null;
  d.orbium = Math.max(0, num(raw.orbium, 0));
  d.orbiumFound = raw.orbiumFound && typeof raw.orbiumFound === 'object' ? raw.orbiumFound : {};
  d.grids = raw.grids && typeof raw.grids === 'object' ? raw.grids : {};
  d.tree = Array.isArray(raw.tree) ? raw.tree.filter((x) => typeof x === 'string') : [];
  d.gadgets = Array.isArray(raw.gadgets) ? raw.gadgets.filter((x) => typeof x === 'string') : [];
  d.gameDone = !!raw.gameDone || d.levelsDone.includes(LEVEL_ORDER[LEVEL_ORDER.length - 1]);
  d.defi = Math.max(0, Math.floor(num(raw.defi, 0)));
  d.defiDone = Array.isArray(raw.defiDone) ? raw.defiDone.filter((id) => LEVELS[id]) : [];
  d.defiCleared = Math.max(0, Math.min(d.defi, Math.floor(num(raw.defiCleared, 0))));
  d.bestChain = Math.max(1, num(raw.bestChain, 1));
  d.version = SAVE_VERSION;
  return d;
}

export class Game {
  constructor(container) {
    this.container = container;
    this.R = new Renderer(container);
    installFur(this.R);
    this.scene = this.R.scene;
    this.world = new PhysicsWorld(10);
    this.input = new Input(this.R.renderer.domElement);
    this.audio = new AudioEngine();
    this.options = { music: 0.45, sfx: 0.9, sensitivity: 1, invertY: false, shake: 1, quality: 'ultra', ...this._loadJSON(OPT_KEY) };
    this.applyOptions();
    this.R.onQuality = (q) => {
      const sun = this.level && this.level.sun;
      if (sun) {
        sun.shadow.mapSize.set(this.R.shadowSize, this.R.shadowSize);
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      }
      void q;
    };
    this.R.setQuality(this.options.quality);
    this.perf = { acc: 0, n: 0, low: 0 };
    this.fx = new FX(this);
    this.pickups = new Pickups(this);
    this.props = new Props(this);
    this.enemies = new Enemies(this);
    this.projectiles = new Projectiles(this);
    this.player = new Player(this);
    this.player.addToScene(this.scene);
    this.camera = new CameraRig(this, this.R.camera);
    this.weapons = new Weapons(this);
    this.up = new Upgrades(this);
    this.hud = new HUD(this);
    this.menus = new Menus(this);
    this.photo = new PhotoMode(this);
    this.state = 'loading';
    this.time = 0;
    this.realTime = 0;
    this.hitStopT = 0;
    this.slowT = 0;
    this.slowScale = 1;
    this.level = null;
    this.data = this._loadSave();
    this.stats = this.data.stats;
    this.cheats = {};
    this.boltMult = 1;
    this.chain = 1;
    this.levelStats = null;
    this.last = performance.now();
    this.fpsAcc = 0;
    this.fpsN = 0;
    this.fps = 60;
    this.input.onLockChange = (locked) => {
      // l'Échap qui ferme un menu peut aussi faire relâcher la souris par le navigateur :
      // ce relâchement-là ne doit pas rouvrir la pause (un clic reprend la souris)
      if (!locked && this.state === 'playing' && !this._ignoreUnlock && !this._justClosedMenu()) this.pause();
    };
    // l'audio démarre au premier geste du joueur
    this.audio.onReady = () => { this.playStateMusic(); if (this.state === 'playing') this._restoreLoops(); };
    const unlock = () => this.audio.init();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    if (import.meta.env.DEV) window.__game = this;
    requestAnimationFrame((t) => this.loop(t));
  }

  _loadJSON(k) {
    try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; }
  }
  _loadSave() {
    let raw = null;
    try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { /* stockage indisponible */ }
    if (!raw) return freshSave();
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
    try {
      // copie de secours de la sauvegarde telle qu'elle était au lancement
      localStorage.setItem(SAVE_KEY + '-secours', raw);
    } catch (e) { /* idem */ }
    if (!parsed) {
      this._saveWarning = 'Sauvegarde illisible : une copie de secours a été conservée.';
      return freshSave();
    }
    return normalizeSave(parsed);
  }
  save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch (e) { /* stockage indisponible */ }
  }
  saveOptions() {
    try { localStorage.setItem(OPT_KEY, JSON.stringify(this.options)); } catch (e) { /* idem */ }
  }
  applyOptions() {
    const o = this.options;
    this.audio.volumes.music = o.music;
    this.audio.volumes.sfx = o.sfx;
    this.audio.applyVolumes();
    this.input.sensitivity = o.sensitivity;
    this.input.invertY = o.invertY;
  }
  hasSave() { return !!(this.data && this.data.started); }

  // ------------------------------------------------------------- niveaux
  async loadLevel(id, mode = 'play') {
    const def = LEVELS[id];
    if (this.level) this.unloadLevel();
    this.world.clear();
    this.fx.reset();
    this.pickups.reset();
    this.props.reset();
    this.enemies.reset();
    this.projectiles.reset();
    this.audio.stopAllLoops();
    this.hud.boss(null);
    this.hud.resetMessages();
    this._pendingIntro = null;
    const level = new Level(this, def);
    this.level = level;
    this.levelStats = { bolts: 0, kills: 0, time: 0, gold: 0, startBolts: this.data.bolts, chain: 1 };
    // rang de la planète dans le parcours (courbe de difficulté)
    this.tier = Math.max(0, LEVEL_ORDER.indexOf(id));
    this.chain = 1;
    this.vendorVisited = false;
    this._shopWhy = null;
    def.build(level, this);
    level.finalizeBatches();
    this.player.maxHp = this.maxHpFor(this.data.heroLevel);
    this.applyGoldPerks(false);
    this.player.spawn(level.checkpoint.pos, level.checkpoint.yaw);
    this.camera.snapBehind(level.checkpoint.yaw);
    this.camera.clearScript();
    this.weapons.reset();
    // compilation anticipée des shaders
    const endWarmup = this._warmup();
    this.R.compile();
    endWarmup();
    this.mode = mode;
    return level;
  }
  // fait apparaître une fois chaque projectile, allié et modèle ennemi pour compiler leurs shaders au chargement
  _warmup() {
    const far = new THREE.Vector3(0, -500, 0);
    const tmp = new THREE.Group();
    tmp.position.copy(far);
    this.scene.add(tmp);
    for (const t of ['rivet', 'bomb', 'bomblet', 'toast', 'duckray', 'saw', 'comet', 'turretShot', 'ebolt', 'mortar', 'missile', 'snipe', 'orb', 'snowball', 'spore', 'ruine']) {
      const p = this.projectiles.spawn(t, far, new THREE.Vector3(0, 0, 1), {});
      p.life = 0.0001;
    }
    this._warm = this._warm || {};
    if (!this._warm.models) {
      this._warm.models = true;
      const grp = new THREE.Group();
      grp.position.copy(far);
      grp.add(toasterModel(false), turretModel(false), toasterModel(true), turretModel(true));
      this.scene.add(grp);
      this.R.compile();
      this.scene.remove(grp);
    }
    // les modèles restent dans la scène jusqu'à la compilation, puis sont retirés
    const warm = [];
    for (const type of ['grignoteur', 'larbin', 'bourdon', 'boumboule', 'pinceur', 'tourelle', 'canard', 'larbinBouclier', 'lunette', 'fouisseur', 'moustique', 'phaseur', 'pingouin', 'champi', 'bulbe']) {
      const e = this.enemies.spawn(type, far, {});
      this.enemies.list.pop();
      warm.push(e);
    }
    return () => {
      for (const e of warm) e.remove();
      this.scene.remove(tmp);
    };
  }
  unloadLevel() {
    if (!this.level) return;
    this.level.dispose();
    this.level = null;
  }

  async toTitle() {
    this.state = 'title';
    this.hud.show(false);
    this.input.unlock();
    await this.loadLevel(this.level?.id === 'brikka' ? 'brikka' : 'brikka', 'title');
    this.player.frozen = true;
    if (this.level.titleShot) this.level.titleShot();
    this.menus.showTitle();
    this.audio.music && this.audio.music.play('title');
  }

  async startLevel(id, opts = {}) {
    this.menus.loading(true);
    await new Promise((r) => setTimeout(r, 30));
    this.data.level = id;
    this.data.started = true;
    this.save();
    await this.loadLevel(id, 'play');
    this.menus.loading(false);
    this.menus.hideAll();
    this.state = 'playing';
    this.hud.show(true);
    this.hud.refreshAll();
    this.input.wantLock = true;
    this.input.lock();
    this.player.frozen = false;
    this.player.victory = false;
    this.playMusic(LEVELS[id].music);
    const def = LEVELS[id];
    if (this.level.ambient) this.audio.loop(this.level.ambient, true);
    if (def.onStart) def.onStart(this.level, this, opts);
    else this.hud.titleCard(def.name, def.subtitle);
    if (this.defi) this.level.after(4, () => this.hud.notify(`Mode Défi ${this.defi} : ennemis renforcés. Chaque robot détruit fait grimper le multiplicateur de boulons (×${CHAIN_MAX} max)… jusqu’au premier coup reçu !`, '#ff6ad5', 6));
    this.hud.chain(this.chain, false);
    if (this._saveWarning) { this.hud.notify(this._saveWarning, '#ff9a6a', 6); this._saveWarning = null; }
  }

  // ------------------------------------------------------------- mode Défi
  get defi() { return this.data.defi || 0; }
  get dp() {
    if (!this._dp || this._dpFor !== this.defi) { this._dpFor = this.defi; this._dp = defiParams(this.defi); }
    return this._dp;
  }
  // un nouveau cycle peut commencer : jeu fini, et le Défi en cours (s'il y en a un) terminé
  canStartDefi() { return !!this.data.gameDone && (this.defi === 0 || this.data.defiCleared >= this.defi); }
  startDefi() {
    if (!this.canStartDefi()) return;
    const d = this.data;
    d.defi = this.defi + 1;
    d.defiDone = [];
    // les cristaux d'Orbium repoussent ; les boulons d'or restent trouvés
    d.orbiumFound = {};
    d.level = LEVEL_ORDER[0];
    d.started = true;
    this.stats = d.stats;
    this.weapons.initFromSave(false);
    this.save();
    this.menus.showDefiIntro(() => this.startLevel(LEVEL_ORDER[0]));
  }
  // multiplicateur de boulons du Défi : +1 par robot détruit, perdu au premier coup reçu
  get boltFactor() { return (this.boltMult || 1) * this.chain; }
  chainUp() {
    if (!this.defi || this.chain >= CHAIN_MAX) return;
    this.chain++;
    if (this.levelStats) this.levelStats.chain = Math.max(this.levelStats.chain || 1, this.chain);
    if (this.chain > (this.data.bestChain || 1)) this.data.bestChain = this.chain;
    this.hud.chain(this.chain, true);
    if (this.chain === CHAIN_MAX) {
      this.audio.play('weaponUp', { pitch: 1.3, vol: 0.6 });
      this.hud.toast(`Multiplicateur ×${CHAIN_MAX} !`, 1.6);
    } else this.audio.play('coin', { pitch: 1 + this.chain * 0.06, vol: 0.5 });
  }
  chainBreak() {
    if (this.chain <= 1) return;
    this.chain = 1;
    this.hud.chain(1, true, true);
    this.audio.play('deny', { pitch: 0.7, vol: 0.7 });
  }

  newGame() {
    this.data = freshSave();
    this._afforded = new Set();
    this.stats = this.data.stats;
    this.weapons.initFromSave(true);
    this.save();
    this.menus.showIntro(() => this.menus.showBasics(() => this.startLevel('brikka', { intro: true })));
  }
  continueGame() {
    this.stats = this.data.stats;
    this.weapons.initFromSave(false);
    this.menus.showGalaxy();
  }

  playStateMusic() {
    const m = this.audio.music;
    if (!m) return;
    if (this.state === 'title' || this.state === 'map' || this.state === 'credits') m.play('title');
    else if (this.state === 'vendor') m.play('vendor');
    else if (this.level && LEVELS[this.level.id]) m.play(LEVELS[this.level.id].music);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.pausedAt = this.realTime;
    this.input.unlock();
    this.audio.stopAllLoops();
    this.menus.showPause();
    this.hud.wheel(false);
    this.hud.show(false);
  }
  playMusic(name) {
    this.levelMusic = name;
    this.audio.music && this.audio.music.play(name);
  }
  // relance les boucles sonores interrompues par un menu
  _restoreLoops() {
    const p = this.player;
    if (this.level && this.level.ambient) this.audio.loop(this.level.ambient, true);
    if (p.gliding) this.audio.loop('glide', true);
    if (p.state === 'grind') this.audio.loop('grind', true);
    if (this.enemies.list.some((e) => !e.dead && e.type === 'goinfrotron' && e.state === 'suck')) this.audio.loop('vacuum', true);
  }
  _justClosedMenu() { return this.realTime - (this._menuClosedAt ?? -9) < 0.6; }
  resume() {
    if (this.state !== 'paused' && this.state !== 'vendor') return;
    this.menus.hideAll();
    this.state = 'playing';
    this._menuClosedAt = this.realTime;
    this.hud.show(true);
    this.input.lock();
    this.audio.music && this.audio.music.play(this.levelMusic || LEVELS[this.level.id].music);
    this._restoreLoops();
  }
  openVendor() {
    if (this.state !== 'playing') return;
    this.state = 'vendor';
    this.vendorVisited = true;
    this.pausedAt = this.realTime;
    this._ignoreUnlock = true;
    this.input.unlock();
    setTimeout(() => { this._ignoreUnlock = false; }, 300);
    this.audio.stopAllLoops();
    this.audio.play('open');
    this.audio.music && this.audio.music.play('vendor');
    this.hud.show(false);
    this.menus.showVendor();
  }
  // Raison de passer au Bazar (balise, repère à l'écran, Gigi qui hèle) : { text, far } ou null.
  // far : la raison vaut le détour (achat possible), sinon le repère ne s'affiche qu'à proximité.
  shopReason() {
    const t = this.realTime;
    if (this._shopWhy !== null && t - this._shopWhyT < 0.5) return this._shopWhy;
    this._shopWhyT = t;
    this._shopWhy = this._computeShopReason();
    return this._shopWhy;
  }
  _computeShopReason() {
    const w = this.weapons;
    if (!this.level || !this.data.weapons) return false;
    const ids = w.availableIn(this.level.id);
    if (ids.some((id) => !w.state(id).owned && this.data.bolts >= w.def(id).price)) return { text: 'Nouvelle arme abordable !', far: true };
    if (ids.some((id) => w.canBuyMega(id))) return { text: 'Version Méga abordable !', far: true };
    const owned = w.ownedList();
    if (this.up.orbium > 0 && owned.some((id) => weaponGrid(id).some((n) => this.up.canBuyNode(id, n.idx)))) return { text: 'Amélioration d’arme possible', far: false };
    const low = owned.filter((id) => w.state(id).ammo < w.maxAmmo(id) * 0.3);
    if (low.length && this.data.bolts >= Math.min(w.refillCost(low[0]), 400)) return { text: 'Refaire le plein de munitions', far: false };
    if (!this.vendorVisited) return { text: 'Armes, munitions, améliorations', far: false };
    return false;
  }
  closeVendor() {
    this._shopWhy = null;
    this.menus.hideAll();
    this.state = 'playing';
    this._menuClosedAt = this.realTime;
    this.hud.show(true);
    this.input.lock();
    this.audio.music && this.audio.music.play(this.levelMusic || LEVELS[this.level.id].music);
    this.hud.refreshAll();
    this._restoreLoops();
  }

  levelComplete() {
    if (this.state !== 'playing' && this.state !== 'cutscene') return;
    const id = this.level.id;
    const d = this.data;
    if (!d.levelsDone.includes(id)) d.levelsDone.push(id);
    const idx = LEVEL_ORDER.indexOf(id);
    const next = LEVEL_ORDER[idx + 1];
    if (next && !d.unlocked.includes(next)) d.unlocked.push(next);
    if (!next) {
      // fin du jeu : le mode Défi s'ouvre ; en Défi, le cycle en cours est bouclé
      d.gameDone = true;
      if (this.defi) d.defiCleared = Math.max(d.defiCleared || 0, this.defi);
    }
    if (this.defi && !d.defiDone.includes(id)) d.defiDone.push(id);
    this.levelStats.time = this.levelStats.time || 0;
    // les boulons encore au sol sont aspirés par Écrou
    let left = 0;
    for (const it of this.pickups.items) if (it.kind === 'nut' || it.kind === 'bolt') left += it.value;
    this.pickups.items = this.pickups.items.filter((it) => it.kind !== 'nut' && it.kind !== 'bolt');
    if (left > 0) this.addBolts(left);
    this.save();
    this.state = 'complete';
    this.input.unlock();
    this.audio.stopAllLoops();
    this.audio.music && this.audio.music.fanfare();
    this.hud.show(false);
    this.menus.showLevelComplete(id, this.levelStats, next);
  }

  // ------------------------------------------------------------- économie
  addBolts(n) {
    this.data.bolts += n;
    this.stats.bolts += n;
    if (this.levelStats) this.levelStats.bolts += n;
    this.hud.boltsGained(n);
    this._checkAffordable();
  }
  // prévient quand une nouvelle arme du Bazar devient abordable
  _checkAffordable() {
    if (!this.level || !this.data.weapons) return;
    this._afforded = this._afforded || new Set();
    const w = this.weapons;
    for (const id of w.availableIn(this.level.id)) {
      const st = w.state(id);
      if (st.owned || this._afforded.has(id)) continue;
      if (this.data.bolts >= w.def(id).price) {
        this._afforded.add(id);
        this.hud.notify(`De quoi s’offrir : ${w.def(id).name} au Bazar Pétarade !`, w.def(id).color, 4);
        this.audio.play('coin', { pitch: 1.5 });
      }
    }
  }
  spendBolts(n) {
    if (this.data.bolts < n) return false;
    this.data.bolts -= n;
    this.hud.refreshAll();
    return true;
  }
  maxHpFor(level) { return 100 + (level - 1) * 10 + (this.up ? this.up.sum('hp') : 0); }
  // Établi : les améliorations de Kobi s'appliquent aussitôt
  onTreeChanged() {
    const p = this.player;
    const was = p.maxHp;
    p.maxHp = this.maxHpFor(this.data.heroLevel);
    p.hp = Math.min(p.maxHp, p.hp + Math.max(0, p.maxHp - was));
    this.applyGoldPerks(false);
    this.hud.refreshAll();
  }
  collectOrbium(id, pos, n) {
    const lid = this.level.id;
    const arr = (this.data.orbiumFound[lid] = this.data.orbiumFound[lid] || []);
    if (!arr.includes(id)) arr.push(id);
    this.up.addOrbium(n);
    this.audio.play('goldbolt', { pitch: 1.4 });
    this.fx.ring(pos, '#d08aff', 4, 0.6);
    this.fx.sparks(pos, new THREE.Vector3(0, 1, 0), 30, '#d08aff', 9);
    this.hitStop(0.05);
    this.hud.notify(`Cristal d’Orbium ! (+${n}) — de quoi améliorer vos armes au Bazar`, '#d08aff', 4);
    this.save();
  }
  hasOrbium(levelId, id) { return (this.data.orbiumFound[levelId] || []).includes(id); }
  // Gadgets d'Écrou : ils rouvrent des passages sur les planètes déjà visitées
  hasGadget(id) { return (this.data.gadgets || []).includes(id); }
  giveGadget(id, name, how) {
    if (this.hasGadget(id)) return;
    (this.data.gadgets = this.data.gadgets || []).push(id);
    this.audio.play('weaponUp');
    this.fx.ring(this.player.pos, '#7ff3ff', 5, 0.7);
    this.fx.sparks(this.player.center, new THREE.Vector3(0, 1, 0), 40, '#7ff3ff', 10);
    this.hud.notify(`Nouveau gadget : ${name} ! ${how}`, '#7ff3ff', 6);
    this.save();
  }
  addHeroXp(n) {
    const d = this.data;
    d.heroXp += n;
    while (d.heroLevel < HERO_XP.length && d.heroXp >= HERO_XP[d.heroLevel]) {
      d.heroLevel++;
      this.player.maxHp = this.maxHpFor(d.heroLevel);
      this.player.hp = this.player.maxHp;
      this.hud.notify(`Kobi passe au niveau ${d.heroLevel} ! Santé max : ${this.player.maxHp} — un point d’Établi à dépenser`, '#4dffa0');
      this.audio.play('levelup');
      this.fx.ring(this.player.pos, '#4dffa0', 4, 0.6);
      this.fx.sparks(this.player.center, new THREE.Vector3(0, 1, 0), 30, '#4dffa0', 9);
    }
  }
  onEnemyKilled(enemy, source) {
    this.stats.kills++;
    if (this.levelStats) this.levelStats.kills++;
    const xp = (enemy.def.xp || 20) * this.dp.xp;
    this.addHeroXp(xp);
    this.weapons.addXp(source, xp);
    this.chainUp();
  }
  // récompenses des boulons d'or : aimant plus large, puis boulons doublés quand les 9 sont réunis
  applyGoldPerks(announce) {
    const total = Object.values(this.data.goldBolts || {}).reduce((a, b) => a + b.length, 0);
    this.pickups.magnetRadius = (8.5 + total * 0.6) * (1 + (this.up ? this.up.sum('magnet') : 0));
    const was = this.boltMult;
    this.boltMult = total >= LEVEL_ORDER.length * 3 ? 2 : 1;
    if (announce && this.boltMult > was) this.hud.notify(`Les ${LEVEL_ORDER.length * 3} boulons d’or sont réunis : tous les boulons comptent double !`, '#ffd23a', 6);
  }
  hasGoldBolt(levelId, id) {
    return (this.data.goldBolts[levelId] || []).includes(id);
  }
  collectGoldBolt(id, pos) {
    const lid = this.level.id;
    const arr = (this.data.goldBolts[lid] = this.data.goldBolts[lid] || []);
    if (!arr.includes(id)) arr.push(id);
    if (this.levelStats) this.levelStats.gold++;
    this.audio.play('goldbolt');
    this.fx.ring(pos, '#ffe27a', 5, 0.8);
    this.fx.sparks(pos, new THREE.Vector3(0, 1, 0), 40, '#ffe27a', 10);
    this.hitStop(0.08);
    this.slowMo(0.35, 0.6);
    const total = Object.values(this.data.goldBolts).reduce((a, b) => a + b.length, 0);
    this.hud.notify(`Boulon d’or trouvé ! (${total} / ${LEVEL_ORDER.length * 3}) — +1 000 boulons, aimant renforcé`, '#ffd23a');
    this.addBolts(1000);
    this.applyGoldPerks(true);
    this.save();
  }

  // Mort d'un boss : renforts et projectiles ennemis disparaissent, Kobi est à l'abri pendant la célébration
  bossDefeated(boss) {
    this.projectiles.clearHostile();
    this.player.invuln = Math.max(this.player.invuln, 4);
    const level = this.level;
    this.enemies.list.filter((e) => e !== boss && !e.dead && !e.def.boss && e.type !== 'canard').forEach((e, i) => {
      level.after(0.25 + i * 0.12, () => { if (this.level === level && !e.dead) e.die('boss'); });
    });
  }

  // Courte présentation d'un boss : caméra sur lui, titre, puis retour au jeu
  bossIntro(e, sub) {
    if (this.state !== 'playing' || !this.player.grounded || this.player.state !== 'normal') {
      // on attend que Kobi soit posé (le boss patiente)
      e.introT = 99;
      this._pendingIntro = { e, sub };
      return;
    }
    this._pendingIntro = null;
    this.state = 'cutscene';
    this.player.frozen = true;
    e.introT = 3.2;
    const dir = new THREE.Vector3().subVectors(this.player.pos, e.pos).setY(0);
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1);
    dir.normalize();
    e.yaw = Math.atan2(dir.x, dir.z);
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const camPos = e.pos.clone().addScaledVector(dir, e.radius * 2.2 + 5.5).addScaledVector(side, e.radius + 2).add(new THREE.Vector3(0, e.height * 0.35 + 1.4, 0));
    const look = e.pos.clone().add(new THREE.Vector3(0, e.height * 0.6, 0));
    this.camera.setScript(camPos, look, 3.5);
    this.hud.titleCard(e.def.name, sub, 3.2);
    this.audio.play('roar', { pitch: 0.8 });
    const level = this.level;
    level.after(3.2, () => {
      if (this.level !== level) return;
      if (this.state === 'cutscene') this.state = 'playing';
      this.player.frozen = false;
      this.camera.clearScript();
      this.camera.snapBehind(Math.atan2(e.pos.x - this.player.pos.x, e.pos.z - this.player.pos.z), -0.12);
    });
  }

  // ------------------------------------------------------------- effets de jeu
  hitStop(d) { this.hitStopT = Math.max(this.hitStopT, d); }
  // brève aberration chromatique (impacts, explosions proches)
  punch(k) { this.aberr = Math.min(1, Math.max(this.aberr || 0, k)); }
  slowMo(scale, dur) { this.slowScale = scale; this.slowT = dur; }

  // Explosion avec dégâts de zone (ennemis, caisses, éventuellement Kobi)
  explode(pos, radius, damage, o = {}) {
    this.fx.explosion(pos, radius * 0.75, o.color || '#ff9a3a', { core: o.core, spark: o.spark, smoke: o.smoke, debris: o.debris });
    waterExplosion(pos, radius);
    this.audio.play('explosion', { pos, pitch: clamp(1.4 - radius * 0.08, 0.6, 1.3), big: radius > 5 });
    const dc = pos.distanceTo(this.camera.cam.position);
    if (dc < radius * 5) this.punch(clamp(radius * 0.12 * (1 - dc / (radius * 5)), 0, 0.7));
    for (const e of this.enemies.inSphere(pos, radius)) {
      // distance à la surface de la sphère de collision la plus proche (pas aux pieds : les grands ennemis comptent)
      let d = Infinity;
      for (const hs of e.hitSpheres()) d = Math.min(d, Math.max(0, hs.c.distanceTo(pos) - hs.r));
      const k = 1 - clamp(d / radius, 0, 0.6);
      const dir = new THREE.Vector3().subVectors(e.pos, pos).setY(0).normalize();
      e.damage(damage * k, { dir, knock: 9 * k, up: 5 * k, source: o.source || 'explosion', explosive: true });
    }
    this.props.hitSphere(pos, radius * 0.8, damage, null);
    if (o.hurtsPlayer && this.player.alive) {
      const d = this.player.center.distanceTo(pos);
      if (d < radius) this.player.hurt(o.hurtsPlayer * (1 - d / radius * 0.5), pos, 10);
    }
  }

  // Baisse automatiquement la qualité si les images/seconde s'effondrent
  _adaptQuality(dt) {
    const p = this.perf;
    p.acc += dt; p.n++;
    if (p.acc < 2) return;
    const fps = p.n / p.acc;
    p.acc = 0; p.n = 0;
    if (fps < 42) p.low++; else p.low = Math.max(0, p.low - 1);
    if (p.low >= 3) {
      p.low = 0;
      const order = ['ultra', 'haute', 'moyenne'];
      const i = order.indexOf(this.R.quality);
      if (i < order.length - 1) {
        this.R.setQuality(order[i + 1]);
        this.options.quality = order[i + 1];
        this.saveOptions();
        this.hud.notify('Qualité graphique ajustée : ' + ['Ultra', 'Haute', 'Moyenne'][i + 1], '#7ff3ff');
      }
    }
  }

  // ------------------------------------------------------------- boucle
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.1) dt = 0.1;
    if (dt <= 0) return;
    this.realTime += dt;
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; }
    const input = this.input;
    input.pollPad();

    if (this.state === 'playing' || this.state === 'cutscene') {
      if (this.state === 'playing' && input.pressed('pause') && !this._justClosedMenu()) this.pause();
      else if (this.state === 'playing' && input.pressed('photo') && !this._justClosedMenu()) this.photo.enter('playing');
    } else if (this.state === 'paused' || this.state === 'vendor') {
      // Échap = « Retour » : ferme le Bazar, remonte d'un sous-menu, ou quitte la pause
      if (input.pressed('pause') && this.realTime - (this.pausedAt || 0) > 0.35 && this.menus.back) this.menus.back();
      else if (this.state === 'paused' && input.pressed('photo') && this.realTime - (this.pausedAt || 0) > 0.35) this.photo.enter('paused');
    } else if (this.state === 'photo') {
      // mode photo : temps du jeu figé, caméra libre
      this.photo.update(dt);
    }
    this.menus.update(dt);

    const active = this.state === 'playing' || this.state === 'cutscene' || this.state === 'title' || this.state === 'complete';
    if (active && this.level) {
      let gdt = dt;
      if (this.hitStopT > 0) { this.hitStopT -= dt; gdt = dt * 0.03; }
      if (this.slowT > 0) { this.slowT -= dt; gdt *= this.slowScale; if (this.slowT <= 0) this.slowScale = 1; }
      if (this.hud.wheelOpen) gdt *= this.up && this.up.has('roue') ? 0.06 : 0.15;
      this.time += gdt;
      globalU.uTime.value = this.time;
      if (this.state === 'playing') {
        this.data.stats.time += gdt;
        if (this.levelStats) this.levelStats.time += gdt;
      }
      const sim = this.state !== 'complete';
      if (sim) {
        this.player.update(gdt);
        this.weapons.update(gdt);
        this.enemies.update(gdt);
        this.projectiles.update(gdt);
      }
      this.props.update(gdt);
      this.level.update(gdt);
      this.pickups.update(gdt);
      this.fx.update(gdt);
      this.camera.update(dt, this.state === 'playing' ? input : null);
      this.hud.update(dt);
      // intensité musicale
      if (this.audio.music) {
        const alert = this.enemies.alertCount();
        this.audio.music.setIntensity(this.state === 'playing' ? clamp(alert / 3, 0, 1) : 0);
      }
      // post-traitement
      const gu = this.R.gradeU;
      const p = this.player;
      gu.uDamage.value = Math.max(clamp((this.time - p.lastHurt) < 0.4 ? 0.6 * (1 - (this.time - p.lastHurt) / 0.4) : 0, 0, 1), p.hp / p.maxHp < 0.3 && p.alive ? 0.25 + Math.sin(this.time * 6) * 0.1 : 0);
      this.aberr = (this.aberr || 0) * Math.exp(-7 * dt);
      gu.uAberration.value = this.aberr;
    }
    if (this.state === 'playing') this._adaptQuality(dt);
    const pi = this._pendingIntro;
    if (pi && this.state === 'playing') {
      if (pi.e.dead) this._pendingIntro = null;
      else if (this.player.grounded && this.player.state === 'normal') this.bossIntro(pi.e, pi.sub);
    }
    // profondeur de champ et flou de mouvement selon l'état du jeu (post/cinema.js)
    lensDirector(this);
    this.R.render(this.realTime);
    input.endFrame();
  }
}
