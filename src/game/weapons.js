// Arsenal : définitions, achat, munitions, expérience et transformation V2, tir, alliés (grille-pain, tourelles),
// faisceau du Zappeur, choix d'arme (roue, touches, molette).
import * as THREE from 'three';
import { weaponModel, wrenchModel, toasterModel, turretModel, tornadoModel, discoModel, renderIcons } from '../models/weapons.js';
import { LEVEL_ORDER } from '../levels/index.js';
import { clamp, rand, pick } from '../engine/util.js';
import { fxLayer } from '../engine/particles/shared.js';

// paliers recalés sur l'XP d'une partie complète (≈ 6 400 au total) : quatre à cinq armes en V2.
// Les niveaux 6 à 10 ne s'ouvrent qu'aux versions Méga (mode Défi, où l'expérience est doublée).
const XP_LEVELS = [0, 120, 330, 650, 1100, 1700, 2400, 3200, 4100, 5100];
// bonus par niveau d'arme (le niveau 5 transforme aussi l'arme en V2)
export const LEVEL_DMG = 0.12;
export const LEVEL_AMMO = 0.1;
export const MAX_LEVEL = 5;
export const MEGA_LEVEL = 10;
// bonus immédiat de la version Méga
export const MEGA_DMG = 0.25;
export const MEGA_AMMO = 0.2;
// expérience multipliée pour une arme moins avancée que la meilleure de l'arsenal
export const CATCH_UP = 1.6;

const DEFS = {
  riveteuse: {
    name: 'Riveteuse', v2: 'Riveteuse Furieuse', mega: 'Riveteuse Infernale', color: '#ffd23a', price: 0, ammoMax: 160, ammoPrice: 3, sold: null,
    desc: 'Le pistolet à rivets de l’atelier. Tire vite, tire souvent, ne réfléchit jamais. Sur le blindage des chefs, il chatouille plus qu’il ne cabosse.',
    descV2: 'Deux canons, des rivets chauffés à blanc qui ricochent sur la cible suivante. L’atelier n’a jamais été aussi bruyant.',
    upgrade: 'double canon et rivets qui ricochent',
    stats: [0.25, 0.9, 0.8],
  },
  bombe: {
    name: 'Bombe-Ressort', v2: 'Méga-Ressort', mega: 'Ressort Cataclysme', color: '#ff7b2a', price: 1200, ammoMax: 24, ammoPrice: 12, sold: 'brikka',
    desc: 'Une bombe montée sur ressort. Elle rebondit, elle sautille, elle explose. Dans cet ordre, en principe.',
    descV2: 'La bombe se divise en trois bombinettes à l’explosion. Le ressort, lui, n’a rien demandé.',
    upgrade: 'se divise en trois bombinettes',
    stats: [0.7, 0.35, 0.5],
  },
  grillepain: {
    name: 'Escadrille Grille-Pain', v2: 'Escadrille Toast-Mortel', mega: 'Escadrille Brunch Royal', color: '#ff9fb0', price: 2500, ammoMax: 6, ammoPrice: 60, sold: 'brikka',
    desc: 'Trois grille-pain volants qui bombardent vos ennemis de tartines brûlantes. Petit-déjeuner compris.',
    descV2: 'Cinq grille-pain, et des tartines qui explosent. Personne ne sait pourquoi. Personne ne demande.',
    upgrade: 'cinq grille-pain et tartines explosives',
    stats: [0.45, 0.6, 0.7],
  },
  zappeur: {
    name: 'Zappeur à Chaîne', v2: 'Zappeur Orageux', mega: 'Zappeur Tempête', color: '#7ff3ff', price: 4000, ammoMax: 300, ammoPrice: 1, sold: 'nimbara',
    desc: 'Un arc électrique qui saute d’ennemi en ennemi. Idéal pour dire bonjour à toute une foule.',
    descV2: 'L’arc touche cinq ennemis à la fois et les paralyse. Chaud devant, et un peu partout.',
    upgrade: 'chaîne de cinq ennemis, paralysie',
    stats: [0.55, 1.0, 0.45],
  },
  canardiseur: {
    name: 'Canardiseur', v2: 'Canard-Kaboum', mega: 'Canard Suprême', color: '#ffe95a', price: 5500, ammoMax: 8, ammoPrice: 80, sold: 'nimbara',
    desc: 'Transforme n’importe quel sbire en canard en caoutchouc. Couin. Ne fonctionne pas sur les chefs, qui ont un avocat.',
    descV2: 'Les canards explosent au contact de leurs anciens collègues. Couin-BOUM.',
    upgrade: 'les canards deviennent explosifs',
    stats: [1.0, 0.25, 0.75],
  },
  tourelle: {
    name: 'Tourelle Ronchon', v2: 'Tourelle Grognon-Max', mega: 'Tourelle Rancœur Éternelle', color: '#4dffa0', price: 6500, ammoMax: 6, ammoPrice: 90, sold: 'nimbara',
    desc: 'Une tourelle déployable qui tire sur tout ce qui bouge en râlant. Elle déteste son travail, mais elle le fait bien.',
    descV2: 'Roquettes intégrées et dix secondes de rancune supplémentaires.',
    upgrade: 'lance-roquettes intégré, plus longue durée',
    stats: [0.5, 0.7, 0.8],
  },
  disqueuse: {
    name: 'Disqueuse Folle', v2: 'Disqueuse Démente', mega: 'Disqueuse Apocalypse', color: '#ff4f6d', price: 11000, ammoMax: 30, ammoPrice: 25, sold: 'station',
    desc: 'Lance des lames de scie qui ricochent d’un ennemi à l’autre. Tenir à l’écart des doigts, des oreilles et des queues touffues.',
    descV2: 'Deux lames par tir et deux fois plus de rebonds. Le service après-vente refuse d’en parler.',
    upgrade: 'deux lames, rebonds doublés',
    stats: [0.65, 0.55, 0.65],
  },
  comete: {
    name: 'Lance-Comète', v2: 'Lance-Supernova', mega: 'Lance-Galaxie', color: '#b98aff', price: 14000, ammoMax: 12, ammoPrice: 90, sold: 'station',
    desc: 'Des roquettes à tête chercheuse qui poursuivent leur cible jusqu’au bout de la galaxie. Ou du canyon, au moins.',
    descV2: 'Chaque comète éclate en quatre petites comètes chercheuses. Le ciel vous dit merci.',
    upgrade: 'chaque comète se divise en quatre',
    stats: [1.0, 0.3, 1.0],
  },
  givreur: {
    name: 'Givreur', v2: 'Givreur Polaire', mega: 'Givreur Zéro Absolu', color: '#9ae4ff', price: 6000, ammoMax: 260, ammoPrice: 2, sold: 'givrelune',
    desc: 'Un souffle d’azote liquide qui fige les robots sur place. Un coup de clé et ils éclatent en mille glaçons.',
    descV2: 'Cône plus large, gel express, et les statues de glace explosent en éclats coupants.',
    upgrade: 'gel plus rapide, éclats explosifs',
    stats: [0.35, 0.9, 0.35],
  },
  tourbillonneur: {
    name: 'Tourbillonneur', v2: 'Ouragan de Poche', mega: 'Tornade Cosmique', color: '#6affc8', price: 7500, ammoMax: 10, ammoPrice: 90, sold: 'givrelune',
    desc: 'Lance une petite tornade qui aspire les ennemis, les fait tournoyer et les recrache. Bon vent !',
    descV2: 'Deux tornades plus grosses, plus longues et nettement plus vexantes.',
    upgrade: 'deux tornades plus puissantes',
    stats: [0.55, 0.3, 0.6],
  },
  danseotron: {
    name: 'Danse-o-Tron', v2: 'Danse-o-Tron Disco Inferno', mega: 'Danse-o-Tron Mégamix', color: '#e07aff', price: 8500, ammoMax: 4, ammoPrice: 160, sold: 'luminbois',
    desc: 'Une boule à facettes irrésistible : tous les sbires alentour se mettent à danser. Profitez du spectacle.',
    descV2: 'Rayon d’action géant, piste plus longue, et la boule électrise les danseurs.',
    upgrade: 'zone élargie, danseurs électrisés',
    stats: [0.15, 0.2, 0.9],
  },
  longuevue: {
    name: 'Longue-Vue', v2: 'Longue-Vue Perforante', mega: 'Longue-Vue Céleste', color: '#7f9cff', price: 9500, ammoMax: 16, ammoPrice: 70, sold: 'luminbois',
    desc: 'Fusil de précision à lunette : visez (clic droit) pour zoomer, un seul tir suffit souvent.',
    descV2: 'La balle traverse tout ce qui se trouve sur sa ligne. Les files d’attente ennemies détestent.',
    upgrade: 'balles perforantes',
    stats: [1.0, 0.15, 1.0],
  },
  // arme ultime secrète : en vente dans tous les Bazars une fois le jeu fini (clin d'œil au R.Y.N.O.)
  ruine: {
    name: 'R.U.I.N.E.', v2: 'R.U.I.N.E. Totale', color: '#ffc83a', price: 250000, ammoMax: 20, ammoPrice: 300, sold: 'fin',
    desc: 'Roquettes Ultimes, Inarrêtables et Nettement Excessives. Huit têtes chercheuses par salve. Interdite dans onze systèmes solaires.',
    descV2: 'Douze roquettes par salve, qui éclatent chacune en trois. Le mot « excessif » a été inventé pour elle.',
    upgrade: 'douze roquettes qui se divisent',
    stats: [1.0, 0.6, 1.0],
  },
};
const ORDER = ['riveteuse', 'bombe', 'grillepain', 'zappeur', 'canardiseur', 'tourelle', 'givreur', 'tourbillonneur', 'danseotron', 'longuevue', 'disqueuse', 'comete', 'ruine'];
const TURRET_LINES = ['Encore du travail…', 'Pfff. Feu.', 'J’avais pris ma journée !', 'Bande de boulons !', 'Je suis pas payé assez.', 'Rrrr… cible acquise.', 'Allez, ouste !', 'C’est mon coin, ici.', 'Vivement la retraite.'];

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _o = new THREE.Vector3();
const _zs = new THREE.Vector3();

export class Weapons {
  constructor(game) {
    this.game = game;
    this.current = null;
    this.prev = null;
    this.cool = 0;
    this.firing = false;
    this.models = {};
    this.wrench = wrenchModel();
    this.wrenchT = 0;
    this.allies = [];
    this.beam = this._makeBeam();
    game.scene.add(this.beam.mesh);
    this._icons = null;
    this.aimPoint = new THREE.Vector3();
    this.aimTarget = null;
    this.burst = 0;
    this.alt = 0;
  }

  // ------------------------------------------------------------- données
  get data() { return this.game.data; }
  def(id) { return DEFS[id]; }
  initFromSave(fresh) {
    const d = this.data;
    if (fresh || !d.weapons) {
      d.weapons = {};
      for (const id of ORDER) d.weapons[id] = { owned: id === 'riveteuse', ammo: id === 'riveteuse' ? DEFS[id].ammoMax : 0, xp: 0, level: 1 };
      d.current = 'riveteuse';
    }
    for (const id of ORDER) if (!d.weapons[id]) d.weapons[id] = { owned: false, ammo: 0, xp: 0, level: 1 };
    // une ancienne sauvegarde peut porter plus de munitions que le nouveau maximum
    for (const id of ORDER) if (d.weapons[id].owned) d.weapons[id].ammo = Math.min(d.weapons[id].ammo, this.maxAmmo(id));
    this.current = d.current && d.weapons[d.current]?.owned ? d.current : 'riveteuse';
    this._attach();
  }
  state(id) { return this.data.weapons ? this.data.weapons[id] : { owned: false, ammo: 0, xp: 0, level: 1 }; }
  isV2(id) { return this.state(id).level >= MAX_LEVEL; }
  isMega(id) { return !!this.state(id).mega; }
  // niveau maximal : 5 (V2), 10 pour une version Méga
  cap(id) { return this.isMega(id) ? MEGA_LEVEL : MAX_LEVEL; }
  displayName(id) { return this.isMega(id) ? DEFS[id].mega : this.isV2(id) ? DEFS[id].v2 : DEFS[id].name; }
  maxAmmo(id) {
    const lv = this.state(id).level;
    return Math.round(DEFS[id].ammoMax * (1 + (lv - 1) * LEVEL_AMMO) * this.up(id).ammo * (this.isMega(id) ? 1 + MEGA_AMMO : 1));
  }
  dmgMult(id, lv = this.state(id).level) { return (1 + (lv - 1) * LEVEL_DMG) * this.up(id).dmg * (this.isMega(id) ? 1 + MEGA_DMG : 1); }
  // améliorations achetées dans la grille de l'arme
  up(id) { return this.game.up ? this.game.up.weapon(id) : { dmg: 1, rate: 1, ammo: 1, area: 1, specials: new Set() }; }
  sp(id, key) { return this.up(id).specials.has(key); }
  onUpgrade(id) {
    const st = this.state(id);
    st.ammo = Math.min(this.maxAmmo(id), st.ammo);
    this.game.hud.weaponChanged();
  }
  xpFrac(id) {
    const st = this.state(id);
    if (st.level >= this.cap(id)) return 1;
    const a = XP_LEVELS[st.level - 1], b = XP_LEVELS[st.level];
    return clamp((st.xp - a) / (b - a), 0, 1);
  }
  ownedList() { return ORDER.filter((id) => this.state(id).owned); }
  availableIn(levelId) {
    const idx = LEVEL_ORDER.indexOf(levelId);
    const fin = !!this.data.gameDone;
    return ORDER.filter((id) => (DEFS[id].sold === 'fin' && fin) || (DEFS[id].sold && LEVEL_ORDER.includes(DEFS[id].sold) && LEVEL_ORDER.indexOf(DEFS[id].sold) <= idx)).concat(['riveteuse']).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  }
  // ---- versions Méga (mode Défi) : achetées au Bazar pour une arme déjà en V2
  megaPrice(id) { return DEFS[id].mega ? Math.round((DEFS[id].price * 2 + 6000) / 500) * 500 : 0; }
  megaOffered(id) { return !!this.game.defi && !!DEFS[id].mega && this.state(id).owned && !this.isMega(id); }
  canBuyMega(id) { return this.megaOffered(id) && this.isV2(id) && this.data.bolts >= this.megaPrice(id); }
  buyMega(id) {
    if (!this.canBuyMega(id) || !this.game.spendBolts(this.megaPrice(id))) return false;
    const st = this.state(id);
    st.mega = true;
    st.ammo = this.maxAmmo(id);
    if (id === this.current) this._attach();
    this.game.hud.weaponChanged();
    this.game.save();
    return true;
  }
  stats(id) {
    const s = DEFS[id].stats;
    const k = this.dmgMult(id);
    return [['Dégâts', s[0] * k], ['Cadence', s[1]], ['Portée', s[2]]];
  }
  // dégâts de la barre « Dégâts » au niveau suivant (aperçu au Bazar), null au niveau max
  nextDmgStat(id) {
    const lv = this.state(id).level;
    return lv >= this.cap(id) ? null : DEFS[id].stats[0] * this.dmgMult(id, lv + 1);
  }
  // XP restante avant le niveau suivant
  xpToNext(id) {
    const st = this.state(id);
    return st.level >= this.cap(id) ? 0 : Math.max(0, Math.ceil(XP_LEVELS[st.level] - st.xp));
  }
  icon(id) {
    if (!this._icons) {
      const list = [];
      for (const w of ORDER) { list.push([w, false]); list.push([w, true]); if (DEFS[w].mega) list.push([w, true, true]); }
      this._icons = renderIcons(list);
    }
    return this._icons[this._key(id)];
  }
  _key(id) { return id + (this.isMega(id) ? ':mega' : this.isV2(id) ? ':v2' : '');
  }
  buy(id) {
    const st = this.state(id);
    if (st.owned) return false;
    if (!this.game.spendBolts(DEFS[id].price)) return false;
    st.owned = true;
    st.ammo = this.maxAmmo(id);
    this.select(id);
    this.game.save();
    return true;
  }
  refillCost(id) {
    const st = this.state(id);
    if (!st.owned) return 0;
    const disc = this.game.up && this.game.up.has('remise') ? 0.8 : 1;
    return Math.ceil((this.maxAmmo(id) - st.ammo) * DEFS[id].ammoPrice * disc);
  }
  refill(id) {
    const c = this.refillCost(id);
    if (c <= 0 || !this.game.spendBolts(c)) return false;
    this.state(id).ammo = this.maxAmmo(id);
    this.game.save();
    return true;
  }
  refillAllCost() { return this.ownedList().reduce((a, id) => a + this.refillCost(id), 0); }
  refillAll() {
    const c = this.refillAllCost();
    if (c <= 0 || !this.game.spendBolts(c)) return false;
    for (const id of this.ownedList()) this.state(id).ammo = this.maxAmmo(id);
    this.game.save();
    return true;
  }
  needsAmmo() { return this.ownedList().some((id) => this.state(id).ammo < this.maxAmmo(id)); }
  pickupAmmo() {
    // une boîte : 35 % pour l'arme en main, 25 % pour les autres ; la Riveteuse, elle, ne prend que 15 %
    // (sinon elle se recharge plus vite qu'elle ne se vide et on ne sort jamais le reste de l'arsenal)
    for (const id of this.ownedList()) {
      const st = this.state(id);
      const k = (id === 'riveteuse' ? 0.15 : id === this.current ? 0.35 : 0.25) * (this.game.up && this.game.up.has('recup') ? 1.5 : 1);
      st.ammo = Math.min(this.maxAmmo(id), st.ammo + Math.max(1, Math.ceil(this.maxAmmo(id) * k)));
    }
  }
  addXp(source, xp) {
    if (!source || !DEFS[source]) return;
    const st = this.state(source);
    const cap = this.cap(source);
    if (!st.owned || st.level >= cap) return;
    st.xp += xp * (this.game.up && this.game.up.has('xp') ? 1.25 : 1) * this.catchUp(source);
    while (st.level < cap && st.xp >= XP_LEVELS[st.level]) {
      st.level++;
      const g = this.game;
      if (st.level === MEGA_LEVEL) {
        g.hud.notify(`${DEFS[source].mega} atteint le niveau ${MEGA_LEVEL} : puissance maximale !`, DEFS[source].color, 4.5);
        g.audio.play('weaponUp');
        g.slowMo(0.3, 0.7);
        g.fx.ring(g.player.pos, '#ffd23a', 5, 0.7);
        g.fx.sparks(g.player.center, new THREE.Vector3(0, 1, 0), 40, '#ffd23a', 10);
      } else if (st.level === MAX_LEVEL) {
        g.hud.notify(`${DEFS[source].name} évolue en ${DEFS[source].v2} !`, DEFS[source].color, 4.5);
        g.audio.play('weaponUp');
        g.slowMo(0.3, 0.7);
        g.fx.ring(g.player.pos, DEFS[source].color, 5, 0.7);
        g.fx.sparks(g.player.center, new THREE.Vector3(0, 1, 0), 40, DEFS[source].color, 10);
        if (source === this.current) this._attach();
        this._icons = this._icons; // icône V2 déjà rendue
      } else {
        g.hud.notify(`${DEFS[source].name} niveau ${st.level} : dégâts +${Math.round(LEVEL_DMG * 100)} %, munitions +${Math.round(LEVEL_AMMO * 100)} %`, DEFS[source].color, 3.5);
        g.audio.play('levelup', { pitch: 1.2 });
      }
      st.ammo = Math.min(this.maxAmmo(source), st.ammo + Math.round(this.maxAmmo(source) * 0.2));
      g.hud.weaponChanged();
    }
  }
  // rattrapage : une arme en retard sur la meilleure de l'arsenal gagne l'expérience plus vite
  catchUp(id) {
    const lv = this.state(id).level;
    return this.ownedList().some((o) => o !== id && this.state(o).level > lv) ? CATCH_UP : 1;
  }
  wrenchMult() { return 1 + (this.data.heroLevel - 1) * 0.05 + (this.game.up ? this.game.up.sum('wrench') : 0); }
  twoHanded() { return this.current === 'comete' || this.current === 'bombe' || this.current === 'longuevue' || this.current === 'ruine'; }
  isFiring() { return this.firing; }

  // ------------------------------------------------------------- modèles en main
  _attach() {
    const p = this.game.player;
    const socket = p.rig.arms[1].socket;
    for (const k of Object.keys(this.models)) socket.remove(this.models[k]);
    socket.remove(this.wrench);
    if (!this.current) return;
    const key = this._key(this.current);
    if (!this.models[key]) {
      const m = weaponModel(this.current, this.isV2(this.current), this.isMega(this.current));
      m.rotation.x = Math.PI / 2;
      this.models[key] = m;
    }
    this.held = this.models[key];
    socket.add(this.held);
    this.wrench.rotation.x = this.wrench.userData.hold ?? Math.PI / 2;
    this.held.visible = this.wrenchT <= 0;
    this.wrench.visible = this.wrenchT > 0;
    socket.add(this.wrench);
  }
  showWrench(t) {
    this.wrenchT = t;
    this.wrench.visible = true;
    if (this.held) this.held.visible = false;
  }
  select(id) {
    if (!this.state(id).owned || id === this.current) return;
    this.prev = this.current;
    this.current = id;
    this.data.current = id;
    this.cool = 0.25;
    this._attach();
    this.game.hud.weaponChanged();
    this.game.audio.play('swap');
    this.game.audio.loop('zap', false);
    this.beam.mesh.visible = false;
  }
  reset() {
    for (const a of this.allies) a.obj.parent && a.obj.parent.remove(a.obj);
    this.allies = [];
    this.beam.mesh.visible = false;
    this.cool = 0;
    if (this.data.weapons) this._attach();
  }

  // ------------------------------------------------------------- visée
  computeAim() {
    const g = this.game;
    const cam = g.camera.cam;
    const fwd = g.camera.forward;
    const origin = cam.position;
    const maxD = 160;
    let best = maxD;
    const hit = g.world.raycast(origin, fwd, maxD, (c) => (c.blocksCamera !== false || c.tag === 'lava') && c.tag !== 'field');
    if (hit) best = hit.t;
    const eh = g.enemies.raycast(origin, fwd, best, 0.25);
    this.aimTarget = null;
    if (eh) { best = eh.t; this.aimTarget = eh.enemy; }
    this.aimPoint.copy(origin).addScaledVector(fwd, best);
    // assistance à la visée : ennemi proche du réticule
    if (!this.aimTarget) {
      const e = g.enemies.nearestToRay(origin, fwd, 0.06, 70);
      if (e) {
        this.aimTarget = e;
        this.aimPoint.copy(e.aimPoint());
      }
    } else {
      _v2.copy(this.aimPoint);
      this.aimPoint.copy(this.aimTarget.aimPoint()).lerp(_v2, 0.3);
    }
    // ne pas viser derrière Kobi
    const p = g.player;
    _v.subVectors(this.aimPoint, p.pos);
    if (_v.dot(fwd) < 1) this.aimPoint.copy(p.pos).addScaledVector(fwd, 30).setY(p.pos.y + 1);
  }
  muzzle(out) {
    const p = this.game.player;
    if (this.held && this.held.userData.muzzles) {
      const mz = this.held.userData.muzzles[this.alt % this.held.userData.muzzles.length];
      this.held.updateWorldMatrix(true, false);
      return out.copy(mz).applyMatrix4(this.held.matrixWorld);
    }
    return p.muzzleWorld(out);
  }

  // ------------------------------------------------------------- boucle
  update(dt) {
    const g = this.game;
    const inp = g.input;
    const p = g.player;
    this.cool = Math.max(0, this.cool - dt);
    if (this.wrenchT > 0) {
      this.wrenchT -= dt;
      if (this.wrenchT <= 0) { this.wrench.visible = false; if (this.held) this.held.visible = true; }
    }
    const canAct = g.state === 'playing' && p.state === 'normal' && !p.frozen && inp.enabled;
    // sélection
    if (canAct) {
      for (let i = 1; i <= 10; i++) {
        if (inp.pressed('w' + i)) {
          const id = this.ownedList()[i - 1];
          if (id) this.select(id);
        }
      }
      if (inp.wheelDelta && !g.hud.wheelOpen) {
        const list = this.ownedList();
        const idx = list.indexOf(this.current);
        const n = list[(idx + (inp.wheelDelta > 0 ? 1 : -1) + list.length) % list.length];
        if (n) this.select(n);
      }
      if (inp.pressed('swap') && this.prev && this.state(this.prev).owned) this.select(this.prev);
      for (let k = 0; k < 4; k++) if (inp.rawPressed('PadD' + k)) {
        const list = this.ownedList();
        const idx = list.indexOf(this.current);
        const n = list[(idx + (k === 0 || k === 3 ? 1 : -1) + list.length) % list.length];
        if (n) this.select(n);
      }
    }
    g.hud.wheel(canAct && inp.down('wheel') && this.ownedList().length > 1);
    // une seule arme : la roue ne s'ouvre pas, on dit pourquoi
    if (canAct && inp.pressed('wheel') && this.ownedList().length <= 1) {
      g.audio.play('deny', { vol: 0.4 });
      g.hud.toast('Une seule arme pour l’instant : achetez-en d’autres au Bazar Pétarade pour ouvrir la roue.', 2.5);
    }

    // tir
    const wantFire = canAct && !g.hud.wheelOpen && inp.down('fire') && p.melee.t === 0;
    const pressed = canAct && inp.pressed('fire');
    this.firing = false;
    const id = this.current;
    if (id && wantFire) {
      const st = this.state(id);
      if (st.ammo <= 0) {
        if (pressed) { g.audio.play('deny', { vol: 0.5 }); g.hud.toast('Plus de munitions ! Frappez à la clé (' + g.input.actionLabel('melee') + '), changez d’arme (' + g.input.actionLabel('wheel') + ') ou passez au Bazar.', 2.5); }
      } else {
        this.firing = true;
        if (this.cool <= 0) {
          this.computeAim();
          this._fire(id, st, pressed);
        }
      }
    }
    if (id === 'zappeur') this._updateZap(dt, this.firing && this.state('zappeur').ammo > 0);
    else if (this.beam.mesh.visible) { this.beam.mesh.visible = false; g.audio.loop('zap', false); }
    if (id === 'givreur') this._updateFrost(dt, this.firing && this.state('givreur').ammo > 0);
    else if (this._frostOn) { this._frostOn = false; g.audio.loop('frost', false); }
    this._updateTracers(dt);
    this._updateAllies(dt);
    // le disque de la disqueuse tourne
    if (this.held && this.held.userData.blade) this.held.userData.blade.rotation[this.held.userData.bladeAxis || 'x'] += dt * (this.firing ? 40 : 6);
  }

  _fire(id, st, pressed) {
    const g = this.game;
    const p = g.player;
    const proj = g.projectiles;
    const v2 = st.level >= MAX_LEVEL;
    const mult = this.dmgMult(id);
    const m = this.muzzle(_o);
    const dir = _v.subVectors(this.aimPoint, m).normalize();
    const kick = (a, s = 0.05) => { p.rig.anim.doRecoil(a); g.camera.recoil(a); g.camera.shake(s); };
    switch (id) {
      case 'riveteuse': {
        const spread = p.aimHeld ? 0.012 : 0.03;
        const d2 = _v2.copy(dir).add(new THREE.Vector3(rand(-spread, spread), rand(-spread, spread), rand(-spread, spread))).normalize();
        proj.spawn('rivet', m, d2, { damage: (v2 ? 11 : 9) * mult, source: id, ricochet: (v2 ? 1 : 0) + (this.sp(id, 'ricochet') ? 1 : 0) });
        g.fx.muzzle(m, d2, v2 ? '#ff9a3a' : '#ffd36b', 0.35);
        g.audio.play('rivet', { pitch: v2 ? 0.85 : 1 });
        this.cool = v2 ? 1 / 11 : 1 / 8.5;
        this.alt++;
        st.ammo--;
        kick(0.25, 0.02);
        break;
      }
      case 'bombe': {
        // tir en cloche vers le point visé
        const target = this.aimPoint;
        const flat = Math.hypot(target.x - m.x, target.z - m.z);
        const vel = new THREE.Vector3(target.x - m.x, 0, target.z - m.z).normalize().multiplyScalar(Math.min(22, 8 + flat * 0.55));
        const T = Math.max(0.3, flat / vel.length());
        vel.y = (target.y - m.y + 0.5 * 26 * T * T) / T;
        vel.y = clamp(vel.y, 2, 20);
        const grappe = this.sp(id, 'grappe');
        proj.spawn('bomb', m, vel, { damage: 75 * mult, radius: 4.5 * this.up(id).area * (this.sp(id, 'souffle') ? 1.2 : 1), source: id, split: v2 || grappe, splitN: v2 ? (grappe ? 4 : 3) : 2 });
        g.fx.muzzle(m, dir, '#ff9a3a', 0.6);
        g.audio.play('bomb');
        this.cool = 0.62;
        st.ammo--;
        kick(0.9, 0.12);
        break;
      }
      case 'grillepain': {
        if (!pressed) break; // une escadrille par pression
        const n = (v2 ? 5 : 3) + (this.sp(id, 'escadron') ? 1 : 0);
        // remplace l'escadrille existante
        this.allies = this.allies.filter((a) => { if (a.kind === 'toaster') { a.obj.parent && a.obj.parent.remove(a.obj); return false; } return true; });
        for (let i = 0; i < n; i++) this._spawnToaster(i, n, v2, mult);
        g.audio.play('toaster');
        g.fx.ring(p.pos, '#ff9fb0', 3, 0.4);
        this.cool = 0.9;
        st.ammo--;
        kick(0.4, 0.05);
        break;
      }
      case 'zappeur':
        // géré en continu
        break;
      case 'canardiseur': {
        proj.spawn('duckray', m, dir, { source: id, explosive: v2 || this.sp(id, 'couac'), damage: 40 * mult, pierce: this.sp(id, 'mare') ? 1 : 0, boom: v2 && this.sp(id, 'couac') ? 5.2 : 3.5 });
        g.fx.muzzle(m, dir, '#fff27a', 0.7);
        g.audio.play('transform', { pitch: 1.3, vol: 0.6 });
        this.cool = 0.75;
        st.ammo--;
        kick(0.6, 0.06);
        break;
      }
      case 'tourelle': {
        if (!pressed) break;
        const turrets = this.allies.filter((a) => a.kind === 'turret');
        if (turrets.length >= (this.sp(id, 'trio') ? 3 : 2)) { const old = turrets[0]; old.life = 0; }
        // pose devant Kobi
        const fw = new THREE.Vector3(g.camera.forward.x, 0, g.camera.forward.z).normalize();
        const pos = p.pos.clone().addScaledVector(fw, 2.6);
        const hit = g.world.groundBelow(pos.x, pos.y + 2, pos.z, 6);
        if (hit) pos.y = hit.point.y;
        else pos.y = p.pos.y;
        this._spawnTurret(pos, v2, mult);
        g.audio.play('turret', { pos });
        this.cool = 0.8;
        st.ammo--;
        kick(0.4, 0.04);
        break;
      }
      case 'disqueuse': {
        const n = v2 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const d2 = _v2.copy(dir).applyAxisAngle(new THREE.Vector3(0, 1, 0), (i - (n - 1) / 2) * 0.12).normalize();
          const tr = this.sp(id, 'tranchant');
          proj.spawn('saw', m, d2, { damage: 32 * mult * (tr ? 1.25 : 1), source: id, bounces: (v2 ? 8 : 4) + (this.sp(id, 'rebonds') ? 2 : 0), scale: tr ? 1.25 : 1 });
        }
        g.fx.muzzle(m, dir, '#ff4f6d', 0.5);
        g.audio.play('saw');
        this.cool = 0.5;
        st.ammo--;
        kick(0.5, 0.05);
        break;
      }
      case 'givreur':
        // géré en continu (souffle)
        break;
      case 'tourbillonneur': {
        if (!pressed) break;
        const n = v2 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar((i - (n - 1) / 2) * 2.4);
          const start = p.pos.clone().addScaledVector(new THREE.Vector3(dir.x, 0, dir.z).normalize(), 2).add(side);
          const target = this.aimPoint.clone().add(side);
          this._spawnTornado(start, target, v2, mult);
        }
        g.audio.play('tornado');
        g.fx.ring(p.pos, '#6affc8', 3, 0.4);
        this.cool = 0.9;
        st.ammo--;
        kick(0.6, 0.06);
        break;
      }
      case 'danseotron': {
        if (!pressed) break;
        // une seule boule à la fois
        this.allies = this.allies.filter((a) => { if (a.kind === 'disco') { a.obj.parent && a.obj.parent.remove(a.obj); return false; } return true; });
        const target = this.aimPoint.clone();
        const flat = Math.hypot(target.x - m.x, target.z - m.z);
        if (flat > 26) target.copy(m).add(_v2.set(target.x - m.x, 0, target.z - m.z).setLength(26));
        const hit = g.world.groundBelow(target.x, target.y + 4, target.z, 30);
        if (hit) target.y = hit.point.y;
        this._spawnDisco(m.clone(), target, v2, mult);
        g.audio.play('disco');
        this.cool = 1.0;
        st.ammo--;
        kick(0.5, 0.05);
        break;
      }
      case 'longuevue': {
        // tir instantané : premier ennemi sur la ligne (tous en V2), arrêté par les murs
        const origin = g.camera.cam.position;
        const fwd = g.camera.forward;
        const wall = g.world.raycast(origin, fwd, 220, (c) => (c.blocksCamera !== false || c.tag === 'lava') && c.tag !== 'field');
        const maxT = wall ? wall.t : 220;
        const end = origin.clone().addScaledVector(fwd, maxT);
        const hits = [];
        for (const e of g.enemies.list) {
          if (e.dead || e.hidden) continue;
          for (const hs of e.hitSpheres()) {
            const t = _v2.subVectors(hs.c, origin).dot(fwd);
            if (t < 0 || t > maxT) continue;
            const dd = _v2.subVectors(hs.c, origin).addScaledVector(fwd, -t).length();
            if (dd < hs.r + 0.15) { hits.push([t, e]); break; }
          }
        }
        hits.sort((x, y) => x[0] - y[0]);
        const targets = v2 ? hits : hits.slice(0, 1);
        for (const [t, e] of targets) {
          const crit = this.sp(id, 'critique') && e.hp >= e.maxHp ? 2 : 1;
          e.damage(130 * mult * crit, { dir: fwd, knock: 6, source: id, sniper: true });
          if (crit > 1) g.hud.toast('Coup critique !', 0.8);
          g.fx.sparks(origin.clone().addScaledVector(fwd, t), fwd.clone().negate(), 14, '#bfd0ff', 9);
          if (!v2) end.copy(origin).addScaledVector(fwd, t);
        }
        if (!targets.length && wall) g.fx.impact(wall.point, wall.normal, wall.collider && wall.collider.surface, '#bfd0ff');
        this._tracer(m.clone(), end, v2 ? '#ff6a8a' : '#9ab8ff');
        g.fx.muzzle(m, fwd, '#bfd0ff', 1.1);
        g.audio.play('snipe');
        g.camera.shake(0.12);
        this.cool = 1.05;
        st.ammo--;
        kick(1.6, 0.1);
        break;
      }
      case 'comete': {
        const target = this.aimTarget && !this.aimTarget.dead ? this.aimTarget : g.enemies.nearestToRay(g.camera.cam.position, g.camera.forward, 0.25, 90);
        const essaim = this.sp(id, 'essaim');
        proj.spawn('comet', m, dir, { damage: 150 * mult, radius: 6 * this.up(id).area, source: id, target, split: v2 || essaim, splitN: v2 ? (essaim ? 5 : 4) : 2, fast: this.sp(id, 'propulsion') });
        g.fx.muzzle(m, dir, '#d0a0ff', 1);
        g.fx.smoke(m, 4, '#6a5a7a', 0.8);
        g.audio.play('rocket');
        this.cool = 0.95;
        st.ammo--;
        kick(1.4, 0.2);
        p.vel.addScaledVector(dir, -2.5);
        break;
      }
      case 'ruine': {
        // salve de micro-roquettes réparties sur les ennemis proches du réticule
        const n = (v2 ? 12 : 8) + (this.sp(id, 'salve') ? 2 : 0);
        const cam = g.camera.cam.position, fwd = g.camera.forward;
        const cands = g.enemies.list.filter((e) => !e.dead && !e.hidden && e.type !== 'canard' && e.pos.distanceTo(p.pos) < 75)
          .map((e) => [e, _v2.subVectors(e.aimPoint(), cam).normalize().dot(fwd)]).filter((x) => x[1] > 0.55)
          .sort((a, b) => b[1] - a[1]).slice(0, n).map((x) => x[0]);
        if (this.aimTarget && !this.aimTarget.dead && !cands.includes(this.aimTarget)) cands.unshift(this.aimTarget);
        const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
        const upv = new THREE.Vector3().crossVectors(side, dir).normalize();
        const area = this.up(id).area * (this.sp(id, 'ogive') ? 1.25 : 1);
        for (let i = 0; i < n; i++) {
          // éventail en demi-cercle au-dessus du canon : les roquettes montent puis piquent sur leurs cibles
          const a = ((i + 0.5) / n) * Math.PI;
          const d2 = dir.clone().addScaledVector(side, Math.cos(a) * 0.6).addScaledVector(upv, Math.sin(a) * 0.45 + 0.08).normalize();
          proj.spawn('ruine', m, d2, { damage: 70 * mult, radius: 3.6 * area, source: id, target: cands.length ? cands[i % cands.length] : null, speed: 16 + (i % 3) * 3, split: v2, splitN: 3 });
        }
        g.fx.muzzle(m, dir, '#ffcf5a', 0.7);
        g.fx.smoke(m, 6, '#5a4a5a', 1, 0.6);
        g.fx.ring(p.pos, '#ffc83a', 2.5, 0.35);
        g.audio.play('rocket', { pitch: 0.75 });
        g.audio.play('rocket', { pitch: 1.2, vol: 0.6 });
        this.cool = 0.85;
        st.ammo--;
        kick(1.7, 0.25);
        p.vel.addScaledVector(dir, -3);
        break;
      }
    }
    if (this.cool > 0) {
      let rate = this.up(id).rate;
      if (id === 'riveteuse' && p.aimHeld && this.sp(id, 'rafale')) rate += 0.15;
      if (id === 'longuevue' && this.sp(id, 'chasseur')) rate += 0.25;
      this.cool /= rate;
    }
  }

  // ------------------------------------------------------------- Zappeur
  _makeBeam() {
    const max = 5 * 14;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(max * 2 * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < max - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color('#5fe8ff').multiplyScalar(1.3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.frustumCulled = false;
    m.visible = false;
    m.renderOrder = 12;
    fxLayer(m);
    return { mesh: m, geo, pos, max };
  }
  _updateZap(dt, on) {
    const g = this.game;
    const st = this.state('zappeur');
    if (!on) {
      if (this.beam.mesh.visible) { this.beam.mesh.visible = false; g.audio.loop('zap', false); }
      return;
    }
    this.computeAim();
    const v2 = st.level >= MAX_LEVEL;
    const m = this.muzzle(_o).clone();
    const range = 22 * this.up('zappeur').area;
    // chaîne de cibles
    const chain = [];
    let first = this.aimTarget && !this.aimTarget.dead && this.aimTarget.pos.distanceTo(m) < range ? this.aimTarget : g.enemies.nearestToRay(g.camera.cam.position, g.camera.forward, 0.18, range);
    const maxN = (v2 ? 5 : 3) + (this.sp('zappeur', 'chaine') ? 1 : 0);
    let cur = first;
    while (cur && chain.length < maxN) {
      chain.push(cur);
      cur = g.enemies.nearest(cur.pos, 9, true, chain);
    }
    const pts = [m];
    if (chain.length) chain.forEach((e) => pts.push(e.aimPoint().clone()));
    else {
      const end = this.aimPoint.clone();
      if (end.distanceTo(m) > range) end.copy(m).addScaledVector(_v.subVectors(end, m).normalize(), range);
      pts.push(end);
    }
    // dégâts
    this._zapTick = (this._zapTick || 0) - dt;
    if (this._zapTick <= 0) {
      this._zapTick = 0.1;
      const mult = this.dmgMult('zappeur');
      chain.forEach((e, i) => {
        e.damage((v2 ? 6 : 4.8) * mult * (i === 0 ? 1 : 0.65), { dir: null, knock: 0.5, source: 'zappeur', zap: true, stun: v2 ? 0.25 : this.sp('zappeur', 'surtension') ? 0.2 : 0 });
        g.fx.sparks(e.aimPoint(), null, 3, '#5fe8ff', 6, 0.1);
      });
      if (chain.length) g.audio.play('zapHit', { pos: chain[0].pos });
      st.ammo = Math.max(0, st.ammo - 1);
      if (!chain.length && Math.random() < 0.5) {
        const hit = g.world.raycast(m, _v.subVectors(pts[1], m).normalize(), range);
        if (hit) g.fx.sparks(hit.point, hit.normal, 3, '#bff8ff', 5, 0.15);
      }
    }
    g.audio.loop('zap', true);
    g.player.rig.anim.doRecoil(0.08);
    // éclair en ruban
    const seg = 14;
    const cam = g.camera.cam.position;
    const arr = this.beam.pos;
    let k = 0;
    for (let s = 0; s < pts.length - 1 && k < this.beam.max - 1; s++) {
      const a = pts[s], b = pts[s + 1];
      for (let i = 0; i <= seg && k < this.beam.max; i++) {
        const t = i / seg;
        const p = _v.lerpVectors(a, b, t);
        const j = i === 0 || i === seg ? 0 : 0.35;
        p.x += rand(-j, j); p.y += rand(-j, j); p.z += rand(-j, j);
        const dirv = _v2.subVectors(b, a).normalize();
        const taper = s === 0 ? Math.min(1, 0.15 + t * 2.5) : 1;
        const side = _zs.subVectors(cam, p).cross(dirv).normalize().multiplyScalar((0.04 + Math.random() * 0.03) * taper);
        arr[k * 6] = p.x + side.x; arr[k * 6 + 1] = p.y + side.y; arr[k * 6 + 2] = p.z + side.z;
        arr[k * 6 + 3] = p.x - side.x; arr[k * 6 + 4] = p.y - side.y; arr[k * 6 + 5] = p.z - side.z;
        k++;
      }
    }
    this.beam.geo.setDrawRange(0, Math.max(0, (k - 1) * 6));
    this.beam.geo.attributes.position.needsUpdate = true;
    this.beam.mesh.visible = true;
    if (Math.random() < 0.3) g.fx.flash(m, '#7ff3ff', 3, 5, 0.05);
  }

  // ------------------------------------------------------------- Givreur
  _updateFrost(dt, on) {
    const g = this.game;
    if (!on) {
      if (this._frostOn) { this._frostOn = false; g.audio.loop('frost', false); }
      return;
    }
    if (!this._frostOn) { this._frostOn = true; g.audio.loop('frost', true); }
    this.computeAim();
    const st = this.state('givreur');
    const v2 = st.level >= MAX_LEVEL;
    const m = this.muzzle(_o).clone();
    const dir = _v.subVectors(this.aimPoint, m).normalize().clone();
    const range = (v2 ? 14 : 11) * this.up('givreur').area, cone = v2 ? 0.42 : 0.32;
    // souffle visible
    for (let i = 0; i < 3; i++) {
      const d = dir.clone().add(new THREE.Vector3(rand(-cone, cone), rand(-cone, cone), rand(-cone, cone)) .multiplyScalar(0.7)).normalize();
      g.fx.puff(m.clone().addScaledVector(d, 0.2), d.multiplyScalar(rand(14, 20)), { life: 0.55, size: 0.25, size1: 1.4, color: new THREE.Color(i ? '#d8f6ff' : '#9ae4ff'), alpha: 0.5, tile: 0, drag: 2.5 });
    }
    g.player.rig.anim.doRecoil(0.05);
    this._frostTick = (this._frostTick || 0) - dt;
    if (this._frostTick > 0) return;
    this._frostTick = 0.09;
    st.ammo = Math.max(0, st.ammo - 1);
    const mult = this.dmgMult('givreur');
    for (const e of g.enemies.list) {
      if (e.dead || e.hidden) continue;
      const c = e.aimPoint();
      const to = _v2.subVectors(c, m);
      const dist = to.length();
      if (dist > range + e.radius) continue;
      if (to.dot(dir) / Math.max(dist, 0.001) < Math.cos(cone + Math.atan(e.radius / Math.max(dist, 1)))) continue;
      if (g.world.raycast(m, to.normalize(), dist - e.radius, (col) => col.blocksCamera !== false)) continue;
      e.damage(3.2 * mult, { source: 'givreur', zap: true, frost: true });
      e.applyFreeze && e.applyFreeze((v2 ? 0.28 : 0.17) * (this.sp('givreur', 'frisson') ? 1.3 : 1), v2, this.sp('givreur', 'banquise') ? 2 : 0);
    }
  }

  // ------------------------------------------------------------- traceurs (Longue-Vue)
  _tracer(a, b, color) {
    const g = this.game;
    const len = a.distanceTo(b);
    const geo = new THREE.CylinderGeometry(0.035, 0.035, len, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, len / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3), transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }));
    mesh.position.copy(a);
    mesh.lookAt(b);
    g.scene.add(fxLayer(mesh));
    (this.tracers || (this.tracers = [])).push({ mesh, life: 0.22 });
  }
  _updateTracers(dt) {
    if (!this.tracers) return;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / 0.22);
      t.mesh.scale.set(1 + (0.22 - t.life) * 6, 1 + (0.22 - t.life) * 6, 1);
      if (t.life <= 0) {
        t.mesh.parent && t.mesh.parent.remove(t.mesh);
        t.mesh.geometry.dispose(); t.mesh.material.dispose();
        this.tracers.splice(i, 1);
      }
    }
  }

  // ------------------------------------------------------------- alliés
  _spawnTornado(start, target, v2, mult) {
    const g = this.game;
    const obj = tornadoModel(v2);
    const h = g.world.groundBelow(start.x, start.y + 3, start.z, 10);
    if (h) start.y = h.point.y;
    obj.position.copy(start);
    obj.scale.setScalar(0.01);
    g.scene.add(obj);
    const dir = new THREE.Vector3(target.x - start.x, 0, target.z - start.z);
    if (dir.lengthSq() < 0.01) dir.set(Math.sin(g.player.yaw), 0, Math.cos(g.player.yaw));
    dir.normalize();
    const life = (v2 ? 7 : 5) + (this.sp('tourbillonneur', 'cyclone') ? 2 : 0);
    this.allies.push({ kind: 'tornado', obj, life, max: life, dir, speed: 6.5, v2, mult, radius: (v2 ? 6 : 4.5) * this.up('tourbillonneur').area, tick: 0, caught: new Set(), aspiro: this.sp('tourbillonneur', 'aspiro') });
  }
  _spawnDisco(from, target, v2, mult) {
    const g = this.game;
    const obj = discoModel(v2);
    obj.position.copy(from);
    g.scene.add(obj);
    const T = 0.7;
    const vel = new THREE.Vector3((target.x - from.x) / T, 0, (target.z - from.z) / T);
    vel.y = (target.y + 2.6 - from.y + 0.5 * 20 * T * T) / T;
    this.allies.push({ kind: 'disco', obj, life: (v2 ? 10 : 7) + (this.sp('danseotron', 'bal') ? 4 : 0), vel, flight: T, target: target.clone().setY(target.y + 2.6), v2, mult, radius: (v2 ? 16 : 11) * this.up('danseotron').area, tick: 0, tip: this.sp('danseotron', 'pourboire') });
  }
  _updateTornado(a, dt) {
    const g = this.game;
    const L = a.obj.userData.layers;
    const grow = Math.min(1, (a.max - a.life) * 4) * Math.min(1, a.life * 2);
    a.obj.scale.setScalar(Math.max(0.01, grow) * (a.v2 ? 1.25 : 1));
    L.forEach((l, i) => { l.rotation.y += dt * (6 + i * 3); });
    // avance en ondulant, suit le sol
    a.obj.position.addScaledVector(a.dir, a.speed * dt);
    a.obj.position.x += Math.sin(g.time * 3) * dt * 1.5;
    const h = g.world.groundBelow(a.obj.position.x, a.obj.position.y + 3, a.obj.position.z, 8);
    if (h) a.obj.position.y = THREE.MathUtils.lerp(a.obj.position.y, h.point.y, 1 - Math.exp(-8 * dt));
    if (Math.random() < 0.7) g.fx.dust(a.obj.position, 1, g.level?.dustColor || '#d8c8a0', 2.5, 0.9);
    // aspire, soulève et fait tournoyer
    a.tick -= dt;
    const doDmg = a.tick <= 0;
    if (doDmg) a.tick = 0.25;
    const c = a.obj.position;
    for (const e of g.enemies.list) {
      if (e.dead || e.hidden || e.def.static) continue;
      const dx = c.x - e.pos.x, dz = c.z - e.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > a.radius) continue;
      const boss = e.def.boss;
      const pull = (boss ? 1.5 : 9) * (1 - d / a.radius) + 2;
      e.vel.x += (dx / (d || 1)) * pull * dt * 4 - (dz / (d || 1)) * 6 * dt;
      e.vel.z += (dz / (d || 1)) * pull * dt * 4 + (dx / (d || 1)) * 6 * dt;
      if (!boss && d < a.radius * 0.6) { e.vel.y = Math.max(e.vel.y, 7); e.grounded = false; a.caught.add(e); }
      if (doDmg) e.damage((a.v2 ? 9 : 6) * a.mult, { source: 'tourbillonneur', zap: true });
    }
    // Aspi-boulons : la tornade attire les boulons vers Kobi
    if (a.aspiro) for (const it of g.pickups.items) if ((it.kind === 'nut' || it.kind === 'bolt') && it.p.distanceTo(c) < a.radius + 1) it.magnet = true;
    if (a.life <= 0.05) {
      // relâche : projette ce qu'elle tenait
      for (const e of a.caught) if (!e.dead) { e.vel.x += rand(-6, 6); e.vel.z += rand(-6, 6); e.vel.y = 6; }
    }
  }
  _updateDisco(a, dt) {
    const g = this.game;
    const o = a.obj;
    if (a.flight > 0) {
      a.flight -= dt;
      a.vel.y -= 20 * dt;
      o.position.addScaledVector(a.vel, dt);
      if (a.flight <= 0) { o.position.copy(a.target); g.audio.play('pop', { pos: o.position, pitch: 0.7 }); g.fx.ring(o.position.clone().setY(o.position.y - 2.5), '#e07aff', a.radius, 0.6); }
      return;
    }
    o.position.y = a.target.y + Math.sin(g.time * 2) * 0.15;
    o.userData.ball.rotation.y += dt * 1.6;
    o.userData.beams.rotation.y += dt * 1.1;
    if (Math.random() < 0.5) {
      const ang = rand(0, Math.PI * 2), r = rand(1, a.radius);
      g.fx.sparks(o.position.clone().add(new THREE.Vector3(Math.cos(ang) * r, -2.4, Math.sin(ang) * r)), null, 1, pick(['#ff4f6d', '#3ef2ff', '#ffe95a', '#c86aff']), 3, 0.15);
    }
    a.tick -= dt;
    const doDmg = a.tick <= 0;
    if (doDmg) a.tick = 0.5;
    for (const e of g.enemies.list) {
      if (e.dead || e.hidden || e.def.boss || e.type === 'canard') continue;
      if (e.pos.distanceTo(o.position) > a.radius + 2) continue;
      e.danceT = Math.max(e.danceT || 0, 0.4);
      if (doDmg && a.v2) e.damage(5 * a.mult, { source: 'danseotron', zap: true });
      if (doDmg && a.tip && Math.random() < 0.5) g.pickups.spawnBolts(e.aimPoint().clone(), 4, { spread: 0.6, up: 0.8 });
    }
    if (a.life < 1.5 && Math.floor(a.life * 8) % 2 === 0) o.visible = false; else o.visible = true;
  }
  _spawnToaster(i, n, v2, mult) {
    const g = this.game;
    const obj = toasterModel(v2);
    obj.position.copy(g.player.pos).add(new THREE.Vector3(0, 2, 0));
    g.scene.add(obj);
    this.allies.push({ kind: 'toaster', obj, life: 16 + (this.sp('grillepain', 'longue') ? 8 : 0), phase: (i / n) * Math.PI * 2, cool: rand(0.2, 0.8), v2, mult });
  }
  _spawnTurret(pos, v2, mult) {
    const g = this.game;
    const obj = turretModel(v2);
    obj.position.copy(pos);
    obj.scale.setScalar(0.01);
    g.scene.add(obj);
    g.fx.ring(pos, '#4dffa0', 2.5, 0.4);
    g.fx.dust(pos, 6, '#bfbfbf', 2, 0.6);
    this.allies.push({ kind: 'turret', obj, life: (v2 ? 32 : 22) + (this.sp('tourelle', 'rancune') ? 10 : 0), cool: 0.8, rocket: 2, v2, mult, talk: rand(1, 3), born: 0 });
  }
  _updateAllies(dt) {
    const g = this.game;
    const p = g.player;
    for (let i = this.allies.length - 1; i >= 0; i--) {
      const a = this.allies[i];
      a.life -= dt;
      if (a.life <= 0) {
        g.fx.smoke(a.obj.position, 4, '#8a8a9a', 0.6);
        g.fx.sparks(a.obj.position, null, 8, '#ffd36b', 5);
        g.audio.play('pop', { pos: a.obj.position });
        a.obj.parent && a.obj.parent.remove(a.obj);
        this.allies.splice(i, 1);
        continue;
      }
      if (a.kind === 'tornado') { this._updateTornado(a, dt); continue; }
      if (a.kind === 'disco') { this._updateDisco(a, dt); continue; }
      if (a.kind === 'toaster') {
        a.phase += dt * 1.6;
        const target = _v.copy(p.pos).add(new THREE.Vector3(Math.cos(a.phase) * 2.2, 2.4 + Math.sin(a.phase * 2) * 0.3, Math.sin(a.phase) * 2.2));
        a.obj.position.lerp(target, 1 - Math.exp(-5 * dt));
        for (const w of a.obj.userData.wings) w.rotation.x = Math.sin(g.time * 30) * 0.6 * (w.position.z > 0 ? 1 : -1);
        a.cool -= dt;
        const e = g.enemies.nearest(a.obj.position, 20, true);
        if (e) {
          const yaw = Math.atan2(e.pos.x - a.obj.position.x, e.pos.z - a.obj.position.z) - Math.PI / 2;
          a.obj.rotation.y = yaw;
          if (a.cool <= 0) {
            a.cool = 0.55 + Math.random() * 0.2;
            const d = _v2.subVectors(e.aimPoint(), a.obj.position).normalize();
            g.projectiles.spawn('toast', a.obj.position.clone().add(new THREE.Vector3(0, 0.25, 0)), d, { damage: 10 * a.mult, source: 'grillepain', target: e, explosive: a.v2 });
            g.audio.play('toast', { pos: a.obj.position });
          }
        } else a.obj.rotation.y += dt;
        if (a.life < 2 && Math.floor(a.life * 8) % 2 === 0) a.obj.visible = false; else a.obj.visible = true;
      } else if (a.kind === 'turret') {
        a.born += dt;
        a.obj.scale.setScalar(Math.min(1, a.born * 4) * (1 + Math.sin(Math.min(1, a.born * 4) * Math.PI) * 0.2));
        a.cool -= dt;
        a.rocket -= dt;
        a.talk -= dt;
        const e = g.enemies.nearest(a.obj.position, 24, true);
        const head = a.obj.userData.head;
        if (e) {
          const yaw = Math.atan2(e.pos.x - a.obj.position.x, e.pos.z - a.obj.position.z);
          head.rotation.y = THREE.MathUtils.lerp(head.rotation.y, yaw, 1 - Math.exp(-10 * dt));
          if (a.cool <= 0 && a.born > 0.4) {
            a.cool = 0.11;
            const mz = new THREE.Vector3(0, 0.72, 0.6).applyAxisAngle(new THREE.Vector3(0, 1, 0), head.rotation.y).add(a.obj.position);
            const d = _v2.subVectors(e.aimPoint(), mz).normalize();
            d.x += rand(-0.03, 0.03); d.y += rand(-0.03, 0.03);
            g.projectiles.spawn('turretShot', mz, d.normalize(), { damage: 6 * a.mult, source: 'tourelle' });
            g.fx.muzzle(mz, d, '#4dffa0', 0.3);
            g.audio.play('turretShot', { pos: mz });
          }
          if (a.v2 && a.rocket <= 0) {
            a.rocket = 2.2;
            const mz = a.obj.position.clone().add(new THREE.Vector3(0, 1.2, 0));
            g.projectiles.spawn('comet', mz, new THREE.Vector3(0, 1, 0), { damage: 60 * a.mult, radius: 3.5, source: 'tourelle', target: e, small: true });
          }
          if (a.talk <= 0) {
            a.talk = rand(3, 6);
            g.hud.bubble && g.hud.bubble(a.obj.position.clone().add(new THREE.Vector3(0, 1.6, 0)), pick(TURRET_LINES));
          }
        } else head.rotation.y += dt * 0.6;
      }
    }
  }
}
