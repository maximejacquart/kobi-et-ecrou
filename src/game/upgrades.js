// Arbre de compétences : grilles d'amélioration des armes (payées en Orbium, cristal rare trouvé en explorant)
// et Établi d'Écrou (améliorations de Kobi, payées en points gagnés à chaque niveau et avec les boulons d'or).

// ---------------------------------------------------------------- grilles d'armes
// Quatre anneaux : le 1er est ouvert d'emblée, les suivants s'ouvrent aux niveaux 2, 3 et 5 de l'arme.
// Acheter toutes les cases d'un anneau accorde son bonus (anneaux 2 à 4).
export const RING_LEVEL = [1, 2, 3, 5];
const RING_COST = [1, 1, 2, 3];
const RING_BONUS = [null, { dmg: 0.05 }, { rate: 0.05 }, { dmg: 0.1 }];
const RING_BONUS_TEXT = [null, '+5 % de dégâts', '+5 % de cadence', '+10 % de dégâts (maîtrise)'];
const RING_BONUS_SHORT = [null, '+5 % dégâts', '+5 % cadence', '+10 % dégâts'];

// Effets spéciaux propres à chaque arme (deux par arme : anneau 3 et anneau 4)
const SPECIALS = {
  riveteuse: [['ricochet', 'Rivets rebondissants', 'Chaque rivet ricoche une fois de plus.'], ['rafale', 'Gâchette nerveuse', 'Cadence +15 % quand Kobi vise.']],
  bombe: [['grappe', 'Grappe', 'La bombe lâche une bombinette de plus.'], ['souffle', 'Gros souffle', 'Rayon d’explosion +20 %.']],
  grillepain: [['escadron', 'Escadron', 'Un grille-pain de plus dans l’escadrille.'], ['longue', 'Pile longue durée', 'Les grille-pain restent 8 s de plus.']],
  zappeur: [['chaine', 'Chaîne', 'L’arc saute sur un ennemi de plus.'], ['surtension', 'Surtension', 'Les cibles sont brièvement paralysées.']],
  canardiseur: [['mare', 'Mare aux canards', 'Le rayon traverse et canardise deux ennemis.'], ['couac', 'Gros couac', 'Explosions des canards +50 %.']],
  tourelle: [['trio', 'Trio grincheux', 'Trois tourelles en même temps.'], ['rancune', 'Rancune tenace', 'Les tourelles restent 10 s de plus.']],
  givreur: [['frisson', 'Frisson', 'Gel 30 % plus rapide.'], ['banquise', 'Banquise', 'Les statues de glace restent gelées 2 s de plus.']],
  tourbillonneur: [['cyclone', 'Cyclone', 'Tornades 2 s plus longues.'], ['aspiro', 'Aspi-boulons', 'Les tornades ramassent les boulons pour vous.']],
  danseotron: [['bal', 'Grand bal', 'La piste dure 4 s de plus.'], ['pourboire', 'Pourboire', 'Les danseurs lâchent des boulons en rythme.']],
  longuevue: [['critique', 'Point faible', 'Dégâts doublés sur une cible indemne.'], ['chasseur', 'Réarmement éclair', 'Cadence de tir +25 %.']],
  disqueuse: [['rebonds', 'Rebonds', 'Deux rebonds de plus par lame.'], ['tranchant', 'Tranchant', 'Lames 25 % plus grosses et plus dures.']],
  comete: [['essaim', 'Essaim', 'Une petite comète chercheuse de plus.'], ['propulsion', 'Propulsion', 'Les comètes filent et virent plus vite.']],
  ruine: [['salve', 'Salve nourrie', 'Deux roquettes de plus par salve.'], ['ogive', 'Ogives lourdes', 'Explosions 25 % plus larges.']],
};

// Gabarit commun de 11 cases (disposition hexagonale : anneau, position angulaire)
const GRID_TEMPLATE = [
  { ring: 0, kind: 'dmg', v: 0.08 }, { ring: 0, kind: 'ammo', v: 0.15 }, { ring: 0, kind: 'rate', v: 0.06 },
  { ring: 1, kind: 'dmg', v: 0.1 }, { ring: 1, kind: 'area', v: 0.12 }, { ring: 1, kind: 'ammo', v: 0.15 },
  { ring: 2, kind: 'dmg', v: 0.12 }, { ring: 2, kind: 'rate', v: 0.08 }, { ring: 2, kind: 'special', s: 0 },
  { ring: 3, kind: 'dmg', v: 0.15 }, { ring: 3, kind: 'special', s: 1 },
];
const KIND_TEXT = {
  dmg: (v) => `Dégâts +${Math.round(v * 100)} %`,
  ammo: (v) => `Munitions max +${Math.round(v * 100)} %`,
  rate: (v) => `Cadence +${Math.round(v * 100)} %`,
  area: (v) => `Portée et zone +${Math.round(v * 100)} %`,
};
const KIND_ICON = { dmg: '✸', ammo: '▤', rate: '»', area: '◎', special: '★' };
// effet détaillé (panneau de l'onglet Améliorations du Bazar)
const KIND_DESC = {
  dmg: (v) => `Chaque coup de l’arme inflige ${Math.round(v * 100)} % de dégâts en plus.`,
  ammo: (v) => `L’arme emporte ${Math.round(v * 100)} % de munitions en plus.`,
  rate: (v) => `L’arme tire ${Math.round(v * 100)} % plus vite.`,
  area: (v) => `Portée et rayon d’effet de l’arme augmentés de ${Math.round(v * 100)} %.`,
};

export function weaponGrid(id) {
  return GRID_TEMPLATE.map((n, i) => {
    const node = { id: id + ':' + i, idx: i, ring: n.ring, kind: n.kind, v: n.v, cost: RING_COST[n.ring], icon: KIND_ICON[n.kind] };
    if (n.kind === 'special') {
      const [key, name, desc] = SPECIALS[id][n.s];
      node.special = key; node.name = name; node.desc = desc;
    } else { node.name = KIND_TEXT[n.kind](n.v); node.desc = KIND_DESC[n.kind](n.v); }
    return node;
  });
}
export function ringBonusText(r, short) { return (short ? RING_BONUS_SHORT : RING_BONUS_TEXT)[r]; }

// ---------------------------------------------------------------- Établi d'Écrou (arbre de Kobi)
// Cinq branches ; chaque case demande la précédente de sa branche.
export const TREE = [
  { id: 'sante', name: 'Santé', color: '#4dffa0', nodes: [
    { id: 'pv1', name: 'Blindage I', desc: 'Santé max +15.', cost: 1, hp: 15 },
    { id: 'pv2', name: 'Blindage II', desc: 'Santé max +15.', cost: 1, hp: 15 },
    { id: 'regen', name: 'Nano-réparation', desc: 'Hors combat, la santé remonte doucement.', cost: 2 },
    { id: 'pv3', name: 'Blindage III', desc: 'Santé max +20.', cost: 2, hp: 20 },
    { id: 'bouclier', name: 'Bouclier d’Écrou', desc: 'Une fois par point de contrôle, Écrou absorbe un coup fatal.', cost: 3 },
  ] },
  { id: 'cle', name: 'Clé', color: '#ffb627', nodes: [
    { id: 'cle1', name: 'Clé lestée', desc: 'Dégâts de la clé +20 %.', cost: 1, wrench: 0.2 },
    { id: 'combo', name: 'Combo fluide', desc: 'Enchaînements à la clé plus rapides.', cost: 1 },
    { id: 'onde', name: 'Onde de choc', desc: 'Attaque plongeante : rayon +40 %.', cost: 2 },
    { id: 'cle2', name: 'Clé en titane', desc: 'Dégâts de la clé +30 %.', cost: 2, wrench: 0.3 },
    { id: 'renvoi', name: 'Renvoi', desc: 'Un coup de clé renvoie les projectiles ennemis.', cost: 3 },
  ] },
  { id: 'mobilite', name: 'Mobilité', color: '#7ff3ff', nodes: [
    { id: 'esquive', name: 'Ressorts neufs', desc: 'Esquive rechargée 30 % plus vite.', cost: 1 },
    { id: 'course', name: 'Semelles turbo', desc: 'Course +7 %.', cost: 1 },
    { id: 'plane', name: 'Hélices affûtées', desc: 'Plané plus rapide et plus long.', cost: 2 },
    { id: 'air', name: 'Élan aérien', desc: 'Une esquive en l’air de plus.', cost: 2 },
    { id: 'roulade', name: 'Grande roulade', desc: 'Esquive plus longue et plus rapide.', cost: 3 },
  ] },
  { id: 'economie', name: 'Économie', color: '#ffd23a', nodes: [
    { id: 'aimant1', name: 'Aimant I', desc: 'Rayon d’aimantation des boulons +35 %.', cost: 1, magnet: 0.35 },
    { id: 'boulons1', name: 'Bon client', desc: 'Boulons ramassés +10 %.', cost: 1, bolts: 0.1 },
    { id: 'remise', name: 'Carte de fidélité', desc: 'Munitions 20 % moins chères au Bazar.', cost: 2 },
    { id: 'aimant2', name: 'Aimant II', desc: 'Rayon d’aimantation +35 % de plus.', cost: 2, magnet: 0.35 },
    { id: 'boulons2', name: 'Négociateur', desc: 'Boulons ramassés +15 %.', cost: 3, bolts: 0.15 },
  ] },
  { id: 'ecrou', name: 'Écrou', color: '#c890ff', nodes: [
    { id: 'roue', name: 'Roue zen', desc: 'La roue des armes ralentit davantage le temps.', cost: 1 },
    { id: 'radar', name: 'Radar à trésors', desc: 'Signale les boulons d’or et l’Orbium proches.', cost: 1 },
    { id: 'recup', name: 'Récupérateur', desc: 'Les caisses donnent plus de munitions.', cost: 2 },
    { id: 'xp', name: 'Mentor', desc: 'Expérience des armes +25 %.', cost: 2 },
    { id: 'chance', name: 'Porte-bonheur', desc: 'Les ennemis lâchent parfois le double de boulons.', cost: 3 },
  ] },
];
const TREE_NODES = new Map(TREE.flatMap((b) => b.nodes.map((n, i) => [n.id, { ...n, branch: b.id, i, prev: i > 0 ? b.nodes[i - 1].id : null }])));

// ---------------------------------------------------------------- état et effets
export class Upgrades {
  constructor(game) { this.game = game; this._cache = new Map(); }
  get data() { return this.game.data; }
  _grids() { return this.data.grids || (this.data.grids = {}); }
  _tree() { return this.data.tree || (this.data.tree = []); }
  invalidate() { this._cache.clear(); }

  // ---- Orbium
  get orbium() { return this.data.orbium || 0; }
  addOrbium(n) {
    this.data.orbium = this.orbium + n;
    this.game.hud.orbiumGained && this.game.hud.orbiumGained(n);
  }

  // ---- grilles
  owned(id) { return this._grids()[id] || []; }
  hasNode(id, idx) { return this.owned(id).includes(idx); }
  ringOpen(id, ring) { return this.game.weapons.state(id).level >= RING_LEVEL[ring]; }
  ringComplete(id, ring) { return weaponGrid(id).filter((n) => n.ring === ring).every((n) => this.hasNode(id, n.idx)); }
  canBuyNode(id, idx) {
    const n = weaponGrid(id)[idx];
    return n && this.game.weapons.state(id).owned && !this.hasNode(id, idx) && this.ringOpen(id, n.ring) && this.orbium >= n.cost;
  }
  buyNode(id, idx) {
    if (!this.canBuyNode(id, idx)) return false;
    const n = weaponGrid(id)[idx];
    this.data.orbium -= n.cost;
    (this._grids()[id] = this._grids()[id] || []).push(idx);
    this.invalidate();
    this.game.weapons.onUpgrade(id);
    this.game.save();
    return true;
  }
  // Totaux d'une arme : { dmg, rate, ammo, area, specials:Set }
  weapon(id) {
    let w = this._cache.get(id);
    if (w) return w;
    w = { dmg: 1, rate: 1, ammo: 1, area: 1, specials: new Set() };
    for (const n of weaponGrid(id)) {
      if (!this.hasNode(id, n.idx)) continue;
      if (n.kind === 'special') w.specials.add(n.special);
      else w[n.kind] += n.v;
    }
    for (let r = 1; r < 4; r++) if (this.ringComplete(id, r)) for (const [k, v] of Object.entries(RING_BONUS[r])) w[k] += v;
    this._cache.set(id, w);
    return w;
  }
  special(id, key) { return this.weapon(id).specials.has(key); }

  // ---- Établi
  pointsEarned() {
    const d = this.data;
    const gold = Object.values(d.goldBolts || {}).reduce((a, b) => a + b.length, 0);
    return (d.heroLevel - 1) + gold;
  }
  pointsSpent() { return this._tree().reduce((a, id) => a + (TREE_NODES.get(id)?.cost || 0), 0); }
  points() { return this.pointsEarned() - this.pointsSpent(); }
  has(id) { return this._tree().includes(id); }
  canBuy(id) {
    const n = TREE_NODES.get(id);
    return n && !this.has(id) && (!n.prev || this.has(n.prev)) && this.points() >= n.cost;
  }
  buy(id) {
    if (!this.canBuy(id)) return false;
    this._tree().push(id);
    this.invalidate();
    this.game.onTreeChanged && this.game.onTreeChanged();
    this.game.save();
    return true;
  }
  // somme d'un champ numérique sur les cases achetées
  sum(field) {
    const key = 'sum:' + field;
    if (this._cache.has(key)) return this._cache.get(key);
    let v = 0;
    for (const id of this._tree()) v += TREE_NODES.get(id)?.[field] || 0;
    this._cache.set(key, v);
    return v;
  }
}
export { TREE_NODES };
