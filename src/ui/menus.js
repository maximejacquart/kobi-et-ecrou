// Écrans : titre, intro, pause, options, commandes, Bazar Pétarade, carte galactique, fin de niveau, crédits.
import { formatBolts, clamp } from '../engine/util.js';
import { FACES } from './hud.js';
import { LEVELS, LEVEL_ORDER } from '../levels/index.js';
import { drawStory } from './story.js';
import { LEVEL_DMG, LEVEL_AMMO, MAX_LEVEL, MEGA_LEVEL, MEGA_DMG, MEGA_AMMO, CATCH_UP } from '../game/weapons.js';
import { CHAIN_MAX } from '../game/game.js';
import { weaponGrid, ringBonusText, RING_LEVEL, TREE, TREE_NODES } from '../game/upgrades.js';
const ORB_SVG = '<svg viewBox="-10 -14 20 28" class="orb-ico"><polygon points="0,-13 8,0 0,13 -8,0" fill="#c06aff" stroke="#3a0a6a" stroke-width="1.6"/><polygon points="0,-13 3,0 0,13" fill="#e8b8ff" opacity="0.7"/></svg>';

const QUIPS = [
  'Bienvenue au Bazar Pétarade ! Ici, tout explose… sauf les prix. Enfin, presque.',
  'Satisfait ou remboursé ! Enfin, satisfait.',
  'Nos armes sont garanties trois jours ou trois explosions, au premier des deux termes échu.',
  'Un client qui achète est un client qui revient. Un client qui n’achète pas… revient aussi, je l’espère !',
  'Les boulons ne poussent pas sur les arbres, mais sur les robots du Baron, si !',
  'Attention, certaines armes peuvent provoquer une forte envie d’en acheter d’autres.',
];

export class Menus {
  constructor(game) {
    this.game = game;
    this.screens = {};
    this.focusList = [];
    this.focusIdx = 0;
    for (const id of ['title', 'pause', 'options', 'controls', 'vendor', 'story', 'galaxy', 'complete', 'credits', 'etabli']) {
      const d = document.createElement('div');
      d.className = 'screen';
      d.id = 'scr-' + id;
      document.body.appendChild(d);
      this.screens[id] = d;
    }
    this.fade = document.createElement('div');
    this.fade.className = 'fade-black';
    document.body.appendChild(this.fade);
    this.loadingEl = document.getElementById('loading');
    this.current = null;
    this.back = null;
  }

  // ------------------------------------------------------------- outils
  hideAll() {
    for (const s of Object.values(this.screens)) s.classList.remove('on');
    this.current = null;
    this.focusList = [];
    this.spatial = false;
    if (this.storyRAF) cancelAnimationFrame(this.storyRAF);
  }
  _show(id, html) {
    this.hideAll();
    const s = this.screens[id];
    if (html !== undefined) s.innerHTML = html;
    s.classList.add('on');
    this.current = id;
    this._bindButtons(s);
    return s;
  }
  _bindButtons(root) {
    this.focusList = [...root.querySelectorAll('.btn:not(.disabled)')];
    this.focusIdx = 0;
    this.focusList.forEach((b, i) => {
      // le focus suit la souris seulement quand elle bouge vraiment : un nouveau rendu sous un curseur immobile
      // (sélection au clavier, achat) ne doit pas voler le focus
      b.addEventListener('mousemove', (e) => {
        const moved = e.clientX !== this._mouseX || e.clientY !== this._mouseY;
        this._mouseX = e.clientX; this._mouseY = e.clientY;
        if (moved && this.focusIdx !== i) this._focus(i, true);
      });
      b.addEventListener('click', () => {
        this.game.audio.init();
        this.game.audio.play('uiSelect');
      });
    });
    if (this.focusList.length) this._focus(0, false);
  }
  _focus(i, sound) {
    if (!this.focusList.length) return;
    this.focusIdx = (i + this.focusList.length) % this.focusList.length;
    this.focusList.forEach((b, k) => b.classList.toggle('focus', k === this.focusIdx));
    if (sound) this.game.audio.play('uiMove');
  }
  update() {
    const inp = this.game.input;
    if (!this.current || !this.focusList.length || this.current === 'story') {
      if (this.current === 'story' && (inp.rawPressed('Enter') || inp.rawPressed('Space') || inp.pressed('jump') || inp.rawPressed('Mouse0'))) this._storyNext && this._storyNext();
      if (this.current === 'story' && (inp.rawPressed('Escape') || inp.rawPressed('Paddash'))) this._storySkip && this._storySkip();
      return;
    }
    // grilles d'amélioration (Bazar, Établi) : déplacement dans le plan, vers le bouton le plus proche
    if (this.spatial) {
      const dir = inp.rawPressed('ArrowRight') || inp.rawPressed('KeyD') || inp.rawPressed('PadD3') ? [1, 0]
        : inp.rawPressed('ArrowLeft') || inp.rawPressed('KeyA') || inp.rawPressed('PadD2') ? [-1, 0]
        : inp.rawPressed('ArrowDown') || inp.rawPressed('KeyS') || inp.rawPressed('PadD1') ? [0, 1]
        : inp.rawPressed('ArrowUp') || inp.rawPressed('KeyW') || inp.rawPressed('PadD0') ? [0, -1] : null;
      if (dir) this._moveSpatial(dir);
    } else {
      const down = inp.rawPressed('ArrowDown') || inp.rawPressed('KeyS') || inp.rawPressed('PadD1') || inp.rawPressed('ArrowRight') || inp.rawPressed('PadD3');
      const up = inp.rawPressed('ArrowUp') || inp.rawPressed('KeyW') || inp.rawPressed('PadD0') || inp.rawPressed('ArrowLeft') || inp.rawPressed('PadD2');
      if (down) this._focus(this.focusIdx + 1, true);
      if (up) this._focus(this.focusIdx - 1, true);
      if ((down || up) && this.current === 'vendor') {
        const b = this.focusList[this.focusIdx];
        if (b && b.dataset.id && b.dataset.id !== this.vendorSel) b.click();
      }
    }
    if (inp.rawPressed('Enter') || inp.rawPressed('Padjump')) {
      const b = this.focusList[this.focusIdx];
      // valider une case déjà choisie mène au bouton d'achat (l'achat reste un geste distinct)
      if (b && this.spatial && b.classList.contains('pick')) {
        if (!this._refocus('[data-a=buynode]')) this.game.audio.play('deny');
        else this.game.audio.play('uiMove');
      } else if (b) b.click();
    }
    if ((inp.rawPressed('Paddash') || inp.rawPressed('Backspace')) && this.back) this.back();
  }
  loading(on, tip) {
    const el = this.loadingEl;
    if (!el) return;
    if (on) {
      el.classList.remove('off');
      el.style.display = 'grid';
      const t = el.querySelector('.load-tip');
      if (t) t.textContent = tip || TIPS[Math.floor(Math.random() * TIPS.length)];
    } else {
      el.classList.add('off');
      setTimeout(() => { if (el.classList.contains('off')) el.style.display = 'none'; }, 500);
    }
  }
  fadeTo(on) { this.fade.classList.toggle('on', on); }

  // ------------------------------------------------------------- titre
  showTitle() {
    const g = this.game;
    const has = g.hasSave();
    const s = this._show('title', `
      <div class="title-wrap">
        <div class="logo"><div class="l1">KOBI <span class="amp">&amp;</span> ÉCROU</div><div class="l2">LA GRANDE ASPIRATION</div></div>
        <div class="menu">
          ${has ? '<button class="btn" data-a="continue"><span>Continuer</span></button>' : ''}
          ${g.canStartDefi() ? `<button class="btn defi" data-a="defi"><span>${g.defi ? 'Défi ' + (g.defi + 1) : 'Mode Défi'}</span></button>` : ''}
          <button class="btn" data-a="new"><span>Nouvelle partie</span></button>
          <button class="btn ghost" data-a="options"><span>Options</span></button>
          <button class="btn ghost" data-a="controls"><span>Commandes</span></button>
        </div>
      </div>
      <div class="title-hint">Souris + clavier ou manette<br>Plein écran conseillé (F11)</div>`);
    this.back = null;
    s.querySelector('[data-a=new]').onclick = () => {
      if (has && !this._confirmNew) {
        this._confirmNew = true;
        s.querySelector('[data-a=new] span').textContent = 'Sûr ? Ça efface la partie !';
        return;
      }
      this._confirmNew = false;
      g.audio.init();
      g.newGame();
    };
    if (has) s.querySelector('[data-a=continue]').onclick = () => { g.audio.init(); g.continueGame(); };
    const defiB = s.querySelector('[data-a=defi]');
    if (defiB) defiB.onclick = () => { g.audio.init(); g.startDefi(); };
    s.querySelector('[data-a=options]').onclick = () => this.showOptions(() => this.showTitle());
    s.querySelector('[data-a=controls]').onclick = () => this.showControls(() => this.showTitle());
    this._confirmNew = false;
    // premier geste : démarre l'audio
    const kick = () => { g.audio.init(); g.audio.music && g.audio.music.play('title'); window.removeEventListener('pointerdown', kick); window.removeEventListener('keydown', kick); };
    window.addEventListener('pointerdown', kick);
    window.addEventListener('keydown', kick);
  }

  // ------------------------------------------------------------- pause
  showPause() {
    const g = this.game;
    const lv = LEVELS[g.level.id];
    const gold = (g.data.goldBolts[g.level.id] || []).length;
    const s = this._show('pause', `<div class="dim" style="position:absolute;inset:0"></div>
      <div class="panel" style="min-width:560px">
        <h1>Pause</h1>
        <div style="font-size:22px;margin-bottom:6px">${lv.name} — <span style="color:#c9c0e6">${lv.subtitle}</span></div>
        <div style="font-size:20px;color:#ffd23a;margin-bottom:18px">Boulons d’or : ${gold} / 3 · Boulons : ${formatBolts(g.data.bolts)}</div>
        <div class="menu" style="margin-top:10px">
          <button class="btn" data-a="resume"><span>Reprendre</span></button>
          <button class="btn ghost" data-a="photo"><span>Mode photo</span></button>
          <button class="btn ghost" data-a="cp"><span>Revenir au point de contrôle</span></button>
          <button class="btn ghost" data-a="etabli"><span>Établi d’Écrou${g.up.points() > 0 ? ` <b style="color:#4dffa0">(${g.up.points()} point${g.up.points() > 1 ? 's' : ''})</b>` : ''}</span></button>
          <button class="btn ghost" data-a="options"><span>Options</span></button>
          <button class="btn ghost" data-a="controls"><span>Commandes</span></button>
          <button class="btn ghost" data-a="basics"><span>Les bases</span></button>
          <button class="btn ghost" data-a="map"><span>Carte galactique</span></button>
          <button class="btn ghost" data-a="title"><span>Écran titre</span></button>
        </div>
      </div>`);
    this.back = () => g.resume();
    s.querySelector('[data-a=resume]').onclick = () => g.resume();
    s.querySelector('[data-a=photo]').onclick = () => g.photo.enter('paused');
    s.querySelector('[data-a=cp]').onclick = () => { g.resume(); g.player.respawn(); };
    s.querySelector('[data-a=etabli]').onclick = () => this.showEtabli(() => this.showPause());
    s.querySelector('[data-a=options]').onclick = () => this.showOptions(() => this.showPause());
    s.querySelector('[data-a=controls]').onclick = () => this.showControls(() => this.showPause());
    s.querySelector('[data-a=basics]').onclick = () => this.showBasics(() => this.showPause());
    s.querySelector('[data-a=map]').onclick = () => { g.save(); this.showGalaxy(); };
    s.querySelector('[data-a=title]').onclick = () => { g.save(); g.toTitle(); };
  }

  // ------------------------------------------------------------- options
  showOptions(onBack) {
    const g = this.game;
    const o = g.options;
    const s = this._show('options', `<div class="dim" style="position:absolute;inset:0"></div>
      <div class="panel">
        <h1>Options</h1>
        <div class="opt-row"><span>Musique</span><input type="range" min="0" max="1" step="0.05" data-o="music" value="${o.music}"></div>
        <div class="opt-row"><span>Bruitages</span><input type="range" min="0" max="1" step="0.05" data-o="sfx" value="${o.sfx}"></div>
        <div class="opt-row"><span>Sensibilité de la visée</span><input type="range" min="0.3" max="2.5" step="0.05" data-o="sensitivity" value="${o.sensitivity}"></div>
        <div class="opt-row"><span>Tremblements de caméra</span><input type="range" min="0" max="1.5" step="0.1" data-o="shake" value="${o.shake}"></div>
        <div class="opt-row"><span>Qualité graphique</span><button class="btn small" data-a="quality"><span>${{ ultra: 'Ultra', haute: 'Haute', moyenne: 'Moyenne' }[g.R.quality]}</span></button></div>
        <div class="opt-row"><span>Inverser l’axe vertical</span><input type="checkbox" data-o="invertY" ${o.invertY ? 'checked' : ''}></div>
        <div class="opt-row"><span>Afficher les images/seconde</span><input type="checkbox" data-o="fps" ${g.cheats.fps ? 'checked' : ''}></div>
        <div class="row"><button class="btn small" data-a="back"><span>Retour</span></button></div>
      </div>`);
    s.querySelectorAll('input').forEach((inp) => {
      inp.addEventListener('input', () => {
        const k = inp.dataset.o;
        if (k === 'fps') { g.cheats.fps = inp.checked; g.hud.el.fps.textContent = ''; return; }
        o[k] = inp.type === 'checkbox' ? inp.checked : parseFloat(inp.value);
        g.applyOptions();
        g.saveOptions();
        if (k === 'sfx') g.audio.play('bolt');
      });
    });
    s.querySelector('[data-a=quality]').onclick = () => {
      const order = ['ultra', 'haute', 'moyenne'];
      const q = order[(order.indexOf(g.R.quality) + 1) % 3];
      g.R.setQuality(q);
      o.quality = q;
      g.saveOptions();
      s.querySelector('[data-a=quality] span').textContent = { ultra: 'Ultra', haute: 'Haute', moyenne: 'Moyenne' }[q];
    };
    this.back = onBack;
    s.querySelector('[data-a=back]').onclick = onBack;
  }
  showControls(onBack) {
    const inp = this.game.input;
    const k = (a) => `<span class="key">${inp.keyLabel(a)}</span>`;
    const s = this._show('controls', `<div class="dim" style="position:absolute;inset:0"></div>
      <div class="panel">
        <h1>Commandes</h1>
        <div class="keys-grid">
          <div>${k('KeyW')}${k('KeyA')}${k('KeyS')}${k('KeyD')}</div><div>Se déplacer</div>
          <div><span class="key">Souris</span></div><div>Orienter la caméra / viser</div>
          <div>${k('Space')}</div><div>Sauter · en l’air : double saut · maintenir : planer avec Écrou</div>
          <div>${k('Mouse0')}</div><div>Tirer</div>
          <div>${k('Mouse2')}</div><div>Viser (déplacement latéral, caméra à l’épaule)</div>
          <div>${k('KeyF')} / ${k('Mouse1')}</div><div>Coup de clé à molette, sans munitions (enchaîner : combo) · en l’air : attaque plongeante</div>
          <div>${k('ShiftLeft')}</div><div>Esquive éclair (invulnérable un instant)</div>
          <div>${k('KeyE')}</div><div>Interagir · Grappin</div>
          <div>${k('KeyQ')}</div><div>Roue des armes (maintenir, ralentit le temps)</div>
          <div>${k('Digit1')}…${k('Digit8')}</div><div>Choisir une arme · ${k('KeyR')} : arme précédente</div>
          <div>${k('Escape')}</div><div>Pause</div>
          <div>${k('KeyP')}</div><div>Mode photo</div>
        </div>
        <h2>Manette</h2>
        <div class="keys-grid">
          <div><span class="pad">A</span></div><div>Sauter · planer</div>
          <div><span class="pad">X</span></div><div>Coup de clé</div>
          <div><span class="pad">B</span></div><div>Esquive</div>
          <div><span class="pad">Y</span></div><div>Interagir · grappin</div>
          <div><span class="pad">RT</span><span class="pad">LT</span></div><div>Tirer · viser</div>
          <div><span class="pad">RB</span><span class="pad">LB</span></div><div>Roue des armes · arme précédente</div>
          <div><span class="pad">R3</span></div><div>Mode photo (clic du stick droit)</div>
        </div>
        <div class="row"><button class="btn small" data-a="back"><span>Retour</span></button></div>
      </div>`);
    this.back = onBack;
    s.querySelector('[data-a=back]').onclick = onBack;
  }

  // ------------------------------------------------------------- les bases
  // Panneaux de commandes lus au lancement d'une nouvelle partie (et depuis la pause). La clé à molette y a sa place :
  // c'est l'arme qui reste quand les munitions manquent.
  showBasics(done) {
    const inp = this.game.input;
    const pad = inp.lastDevice === 'pad';
    const k = (a) => `<span class="${pad ? 'pad' : 'key'}">${inp.actionLabel(a)}</span>`;
    const key = (t) => `<span class="key">${t}</span>`;
    const crate = (c) => `<span class="tuto-crate" style="--c:${c}"></span>`;
    const pages = [
      {
        title: 'Se déplacer',
        rows: [
          [pad ? '<span class="pad">L</span>' : ['forward', 'left', 'back', 'right'].map(k).join(''), 'Courir'],
          [pad ? '<span class="pad">R</span>' : key('Souris'), 'Tourner la caméra'],
          [k('jump'), 'Sauter · une deuxième fois en l’air : double saut · maintenir : planer avec Écrou'],
          [k('dash'), 'Esquive éclair'],
          [k('interact'), 'Parler, ouvrir, s’accrocher au grappin'],
        ],
      },
      {
        title: 'Se battre',
        rows: [
          [k('fire'), 'Tirer avec l’arme en main'],
          [k('aim'), 'Viser (caméra à l’épaule)'],
          [pad ? k('melee') : k('melee') + ' ou ' + key('Clic molette'), '<b>Coup de clé à molette</b>'],
          [k('wheel'), 'Roue des armes (maintenir)' + (pad ? '' : ' · ' + key('1') + '…' + key('8') + ' : choisir une arme')],
        ],
        tip: 'La clé à molette ne s’use jamais : à court de munitions, c’est elle qui sauve la mise. Trois coups d’affilée font un combo, et frappée en l’air, elle plonge sur l’ennemi. Elle casse aussi les caisses !',
      },
      {
        title: 'Boulons et munitions',
        rows: [
          [crate('#c4823f'), 'Caisse en bois : des boulons'],
          [crate('#3f6fc0'), 'Caisse bleue : des munitions'],
          [crate('#3f9a5a'), 'Caisse verte : de la santé'],
          [crate('#d8452f'), 'Caisse rouge : elle explose, gardez vos distances !'],
        ],
        tip: 'Au Bazar Pétarade, les boulons s’échangent contre des armes et des munitions : suivez sa colonne de lumière dorée. ' + k('pause') + ' met le jeu en pause, pour revoir les commandes.',
      },
    ];
    let i = 0;
    const s = this._show('story');
    const render = () => {
      const pg = pages[i];
      s.innerHTML = `<div class="story"><div class="tuto">
        <div class="tuto-step">Les bases · ${i + 1} / ${pages.length}</div>
        <h1>${pg.title}</h1>
        <div class="tuto-rows">${pg.rows.map(([a, b]) => `<div class="tuto-keys">${a}</div><div>${b}</div>`).join('')}</div>
        ${pg.tip ? `<div class="tuto-tip">${pg.tip}</div>` : ''}
        <div class="tuto-dots">${pages.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('')}</div>
      </div><div class="story-skip">${pad ? 'A : suite · B : passer' : 'Entrée / clic : suite · Échap : passer'}</div></div>`;
      this.game.audio.play('whoosh', { pitch: 1.1 });
    };
    const finish = () => {
      this._storyNext = null;
      this._storySkip = null;
      this.back = null;
      this.hideAll();
      done();
    };
    this._storyNext = () => { if (++i >= pages.length) finish(); else render(); };
    this._storySkip = finish;
    this.back = finish;
    render();
  }

  // ------------------------------------------------------------- intro
  showIntro(done) {
    const cards = [
      { art: 'belt', text: 'Dans la Ceinture de Ferraille, on répare tout et on ne jette rien. C’est ici que vivent Kobi, mécano fennec à grandes oreilles, et Écrou, son robot de poche.' },
      { art: 'ship', text: 'Mais un matin, une ombre violette recouvre la planète Brikka : le croiseur-aspirateur du Baron Vorax gobe tout ce qui traîne… y compris le garage de Kobi !' },
      { art: 'baron', text: '« Vorax Industries : on aspire à mieux ! » Ferraille, boulons, planètes entières : le Baron veut tout aspirer pour construire sa Méga-Benne.' },
      { art: 'heroes', text: 'Kobi enfile ses gants, Écrou déplie ses hélices. Direction le Canyon des Casseurs, pour récupérer le garage… et rendre au Baron la monnaie de sa ferraille.' },
    ];
    this._playStory(cards, done, 'title');
  }
  showDefiIntro(done) {
    const n = this.game.defi;
    const cards = [
      { art: 'baron', text: n > 1
        ? `« Encore vous ? » Le Baron Vorax a reconstruit son empire une ${n === 2 ? 'deuxième' : n + 'e'} fois, et ses robots reviennent encore plus blindés. Ils commencent à vous connaître.`
        : '« Vous croyiez être débarrassés de moi ? » Le Baron Vorax a racheté toutes ses usines, et ses robots reviennent blindés, plus nombreux et nettement plus rancuniers.' },
      { art: 'heroes', text: `Mode Défi ${n} : Kobi garde tout son arsenal. Chaque robot détruit fait grimper le multiplicateur de boulons jusqu’à ×${CHAIN_MAX}, mais le moindre coup le remet à ×1. Au Bazar, Gigi a reçu les armes Méga !` },
    ];
    this._playStory(cards, done, 'title');
  }
  showEnding(done) {
    const cards = [
      { art: 'boom', text: 'Le Goinfrotron s’effondre dans un concert de tôle froissée. La Méga-Benne se vide d’un coup, et la ferraille de toute la Ceinture retombe en pluie… de boulons.' },
      { art: 'baron', text: 'Le Baron Vorax s’enfuit à bord de sa capsule de secours, en jurant qu’il reviendra « avec un aspirateur encore plus gros ».' },
      { art: 'heroes', text: 'Kobi récupère son garage, un peu cabossé. Écrou, lui, a déjà une idée : « Et si on ouvrait un deuxième garage… avec tous ces boulons ? »' },
    ];
    this._playStory(cards, done, 'nimbara');
  }
  _playStory(cards, done, music) {
    const g = this.game;
    g.audio.music && g.audio.music.play(music);
    let i = 0;
    const s = this._show('story', `<div class="story"><div class="story-card"><div class="story-art"><canvas width="960" height="460"></canvas></div><div class="story-text"></div></div><div class="story-skip">Entrée / clic : suite · Échap : passer</div></div>`);
    const cv = s.querySelector('canvas');
    const txt = s.querySelector('.story-text');
    let t0 = performance.now();
    let chars = 0;
    const show = () => {
      txt.textContent = '';
      chars = 0;
      t0 = performance.now();
      g.audio.play('whoosh', { pitch: 0.8 });
    };
    const finish = () => {
      if (this.storyRAF) cancelAnimationFrame(this.storyRAF);
      this.storyRAF = null;
      this._storyNext = null;
      this._storySkip = null;
      this.hideAll();
      done();
    };
    this._storyNext = () => {
      const full = cards[i].text;
      if (chars < full.length) { chars = full.length; txt.textContent = full; return; }
      i++;
      if (i >= cards.length) finish();
      else show();
    };
    this._storySkip = finish;
    const frame = (now) => {
      const t = (now - t0) / 1000;
      const c = cards[i];
      if (!c) return;
      drawStory(cv, c.art, t, now / 1000);
      const target = Math.floor(t * 38);
      if (chars < c.text.length && target > chars) {
        chars = Math.min(c.text.length, target);
        txt.textContent = c.text.slice(0, chars);
      }
      this.storyRAF = requestAnimationFrame(frame);
    };
    show();
    this.storyRAF = requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------- carte galactique
  showGalaxy() {
    const g = this.game;
    g.state = 'map';
    g.hud.show(false);
    g.input.unlock();
    const planets = LEVEL_ORDER.map((id) => {
      const L = LEVELS[id];
      const unlocked = g.data.unlocked.includes(id);
      const done = g.defi ? g.data.defiDone.includes(id) : g.data.levelsDone.includes(id);
      const gold = (g.data.goldBolts[id] || []).length;
      return `<div class="planet-btn btn-like ${unlocked ? '' : 'locked'}" data-id="${id}" style="left:${L.mapPos[0]}%;top:${L.mapPos[1]}%">
        <div class="orb" style="background:${L.orb}"></div>
        <div class="pn">${L.name}</div><div class="ps">${L.subtitle}</div>
        <div class="pg">${unlocked ? (done ? '✓ Terminé · ' : '') + 'Boulons d’or : ' + gold + ' / 3' : 'Verrouillé'}</div></div>`;
    }).join('');
    const s = this._show('galaxy', `<canvas class="galaxy-bg" style="position:absolute;inset:0;width:100%;height:100%"></canvas>
      <div class="galaxy"><div class="galaxy-title">Carte galactique${g.defi ? ` <span class="defi-tag">Défi ${g.defi}</span>` : ''}</div>${planets}
      <div class="galaxy-foot"><button class="btn small ghost" data-a="title"><span>Écran titre</span></button></div></div>`);
    s.querySelectorAll('.planet-btn').forEach((b) => {
      b.addEventListener('click', () => {
        g.audio.init();
        g.audio.play('uiSelect');
        g.startLevel(b.dataset.id);
      });
      b.addEventListener('mouseenter', () => g.audio.play('uiMove'));
    });
    s.querySelector('[data-a=title]').onclick = () => g.toTitle();
    this.back = () => g.toTitle();
    // fond étoilé animé
    const cv = s.querySelector('canvas');
    const draw = (now) => {
      if (this.current !== 'galaxy') return;
      drawStory(cv, 'stars', now / 1000, now / 1000);
      this.storyRAF = requestAnimationFrame(draw);
    };
    cv.width = innerWidth; cv.height = innerHeight;
    this.storyRAF = requestAnimationFrame(draw);
    // liste de focus : planètes déverrouillées
    this.focusList = [...s.querySelectorAll('.planet-btn:not(.locked)'), s.querySelector('[data-a=title]')];
    const last = this.focusList.length > 1 ? this.focusList.length - 2 : 0;
    this._focus(last, false);
  }

  // ------------------------------------------------------------- fin de niveau
  showLevelComplete(id, st, next) {
    const g = this.game;
    const L = LEVELS[id];
    const mins = Math.floor(st.time / 60), secs = Math.floor(st.time % 60);
    const gold = (g.data.goldBolts[id] || []).length;
    const final = !next;
    const s = this._show('complete', `<div class="dim" style="position:absolute;inset:0"></div>
      <div class="panel" style="min-width:640px">
        <h1 style="white-space:nowrap;font-size:40px">${L.name} : terminé !</h1>
        <div class="complete-stats">
          <div>Boulons ramassés</div><div class="v" data-count="${st.bolts}">0</div>
          <div>Ennemis démantelés</div><div class="v" data-count="${st.kills}">0</div>
          <div>Temps</div><div class="v">${mins} min ${String(secs).padStart(2, '0')} s</div>
          <div>Boulons d’or</div><div class="v">${gold} / 3</div>
          ${g.defi ? `<div>Multiplicateur max</div><div class="v">×${st.chain || 1}</div>` : ''}
          <div>Total en poche</div><div class="v">${formatBolts(g.data.bolts)}</div>
        </div>
        <div class="row">
          <button class="btn" data-a="next"><span>${final ? 'Voir la fin' : 'Cap sur ' + LEVELS[next].name}</span></button>
          <button class="btn small ghost" data-a="map"><span>Carte galactique</span></button>
        </div>
      </div>`);
    s.querySelector('[data-a=next]').onclick = () => {
      if (final) this.showEnding(() => this.showCredits());
      else g.startLevel(next);
    };
    s.querySelector('[data-a=map]').onclick = () => this.showGalaxy();
    this.back = null;
    // décompte animé
    const els = [...s.querySelectorAll('[data-count]')];
    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / 1400);
      const e = 1 - Math.pow(1 - k, 3);
      for (const el of els) el.textContent = formatBolts(Math.round(+el.dataset.count * e));
      if (k < 1 && this.current === 'complete') {
        if (Math.random() < 0.5) g.audio.play('bolt', { pitch: 1 + k, vol: 0.6 });
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  }

  showCredits() {
    const g = this.game;
    g.state = 'credits';
    const total = Object.values(g.data.goldBolts).reduce((a, b) => a + b.length, 0);
    const s = this._show('credits', `<div class="credits"><div class="credits-roll">
      <h1>KOBI &amp; ÉCROU</h1><div>La Grande Aspiration</div>
      <h3>Conception, code, graphismes, musique</h3><div>Entièrement générés en code — Three.js et WebAudio</div>
      <h3>Distribution</h3><div>Kobi — mécano fennec</div><div>Écrou — robot de poche</div><div>Baron Vorax — PDG de Vorax Industries</div><div>Gigi Pétarade — marchande d’armes douteuses</div><div>Grosbras — contremaître très en colère</div>
      <h3>Police de caractères</h3><div>« Boulonnerie », dessinée trait par trait dans le code</div>
      <h3>Votre partie</h3><div>Ennemis démantelés : ${g.stats.kills}</div><div>Boulons ramassés : ${formatBolts(g.stats.bolts)}</div><div>Boulons d’or : ${total} / ${LEVEL_ORDER.length * 3}</div><div>Chutes et K.-O. : ${g.stats.deaths}</div>
      <h3>Merci d’avoir joué !</h3><div>Aucun boulon n’a été maltraité pendant la fabrication de ce jeu.</div>
      ${g.canStartDefi() ? `<h3>${g.defi ? 'Défi ' + g.defi + ' remporté !' : 'Mode Défi débloqué !'}</h3><div style="max-width:900px;margin:0 auto">Recommencez l’aventure avec tout votre arsenal : robots renforcés, multiplicateur de boulons, armes Méga au Bazar… et une certaine R.U.I.N.E. en vitrine.</div>` : ''}
      <div style="margin-top:60px;display:flex;gap:16px;justify-content:center">${g.canStartDefi() ? `<button class="btn small defi" data-a="defi" style="pointer-events:auto"><span>${g.defi ? 'Défi ' + (g.defi + 1) : 'Lancer le Défi'}</span></button>` : ''}<button class="btn small" data-a="title" style="pointer-events:auto"><span>Écran titre</span></button></div>
    </div></div>`);
    g.audio.music && g.audio.music.play('title');
    s.querySelector('[data-a=title]').onclick = () => g.toTitle();
    const defiB = s.querySelector('[data-a=defi]');
    if (defiB) defiB.onclick = () => g.startDefi();
    this.back = () => g.toTitle();
  }

  // ------------------------------------------------------------- Bazar Pétarade
  showVendor() {
    const g = this.game;
    const w = g.weapons;
    this.vendorSel = this.vendorSel && w.availableIn(g.level.id).includes(this.vendorSel) ? this.vendorSel : w.availableIn(g.level.id)[0];
    const s = this._show('vendor', '<div class="vendor-wrap"></div>');
    this.vendorTab = 'armes';
    this.vendorFresh = true;
    this.vendorQuip = QUIPS[Math.floor(Math.random() * QUIPS.length)];
    this._renderVendor();
    this.back = () => g.closeVendor();
    void s;
  }
  // le panneau n'apparaît en zoomant qu'à l'ouverture, pas à chaque nouveau rendu (sélection, achat, onglet)
  _vendorStill() {
    const still = !this.vendorFresh;
    this.vendorFresh = false;
    return still ? ' still' : '';
  }
  _vendorHead(extra = '') {
    const g = this.game;
    return `<div class="v-head"><div class="v-face">${FACES.gigi}</div><div><div class="v-title">Bazar Pétarade</div><div class="v-quip">${this.vendorQuip}</div></div>
          <div class="v-money"><div class="v-bolts"><svg viewBox="-12 -12 24 24" class="nut-ico"><polygon points="10,0 5,8.66 -5,8.66 -10,0 -5,-8.66 5,-8.66" fill="#ffd23a" stroke="#7a4b00" stroke-width="1.6"/><circle r="4.2" fill="#3a2a10" stroke="#fff3b0" stroke-width="1.2"/></svg>${formatBolts(g.data.bolts)}</div>
          <div class="v-orb">${ORB_SVG}${g.up.orbium}</div></div></div>
        <div class="v-tabs"><button class="btn small tab ${this.vendorTab === 'armes' ? 'on' : ''}" data-tab="armes"><span>Armes</span></button><button class="btn small tab ${this.vendorTab === 'amelio' ? 'on' : ''}" data-tab="amelio"><span>Améliorations</span></button>${extra}</div>`;
  }
  _bindTabs(s) {
    s.querySelectorAll('[data-tab]').forEach((b) => {
      b.onclick = () => {
        if (this.vendorTab === b.dataset.tab) return;
        this.vendorTab = b.dataset.tab;
        if (this.vendorTab === 'amelio') {
          const owned = this.game.weapons.ownedList();
          if (!owned.includes(this.vendorSel)) this.vendorSel = owned[0];
        }
        this._renderVendor();
      };
    });
  }
  _renderVendor() {
    const g = this.game;
    const w = g.weapons;
    const s = this.screens.vendor;
    this.spatial = false;
    if (this.vendorTab === 'amelio') { this._renderUpgrades(); return; }
    const ids = w.availableIn(g.level.id);
    const sel = this.vendorSel;
    const d = w.def(sel);
    const st = w.state(sel);
    const list = ids.map((id) => {
      const st2 = w.state(id);
      const df = w.def(id);
      const afford = g.data.bolts >= df.price;
      const tag = !st2.owned ? `<span class="vt ${afford ? 'ok' : 'no'}">${formatBolts(df.price)}</span>`
        : w.megaOffered(id) && w.isV2(id) ? '<span class="vt mega">MÉGA ?</span>'
        : `<span class="vt owned${w.isMega(id) ? ' mega' : ''}">${st2.level >= w.cap(id) ? 'MAX' : 'NIV. ' + st2.level}</span>`;
      return `<div class="v-item btn ${id === sel ? 'sel' : ''}" data-id="${id}"><span><i style="background-image:url(${w.icon(id) || ''})"></i><b style="color:${df.color}">${w.displayName(id)}</b>${tag}</span></div>`;
    }).join('');
    // la barre « Dégâts » montre en clair le gain du prochain niveau d'arme
    const nextDmg = st.owned ? w.nextDmgStat(sel) : null;
    const stats = w.stats(sel).map(([label, v], i) => {
      const cur = clamp(v, 0.05, 1);
      const gain = i === 0 && nextDmg ? `<div class="v-next" style="left:${cur * 100}%;width:${Math.max(0, clamp(nextDmg, 0.05, 1) - cur) * 100}%;background:${d.color}"></div>` : '';
      return `<div class="v-stat"><span>${label}</span><div class="v-bar"><div style="width:${cur * 100}%;background:${d.color}"></div>${gain}</div></div>`;
    }).join('');
    const lvBonus = (lv) => `dégâts +${Math.round((lv - 1) * LEVEL_DMG * 100)} %, munitions +${Math.round((lv - 1) * LEVEL_AMMO * 100)} %`;
    const perLevel = `+${Math.round(LEVEL_DMG * 100)} % de dégâts et +${Math.round(LEVEL_AMMO * 100)} % de munitions max par niveau`;
    let level;
    const cap = w.cap(sel);
    // rattrapage d'expérience d'une arme en retard sur le reste de l'arsenal
    const catchUp = st.owned && st.level < cap && w.catchUp(sel) > 1 ? `<div class="v-catch">Expérience ×${String(CATCH_UP).replace('.', ',')} : elle rattrape votre meilleure arme.</div>` : '';
    if (!st.owned) level = `<div class="v-lvl"><div><b class="v-lvl-t">Niveaux 1 → ${MAX_LEVEL}</b> en éliminant des ennemis avec l’arme : ${perLevel}.</div></div>`;
    else if (w.isMega(sel) && st.level >= MEGA_LEVEL) level = `<div class="v-lvl"><div class="v-lvl-t">Niveau ${MEGA_LEVEL} — MAX</div><div>Bonus : ${lvBonus(st.level)}, version Méga.</div></div>`;
    else if (w.isMega(sel)) level = `<div class="v-lvl"><div class="v-lvl-t">Méga · niveau ${st.level} / ${MEGA_LEVEL} · ${lvBonus(st.level)}</div>
      <div class="v-bar v-xp"><div style="width:${w.xpFrac(sel) * 100}%;background:${d.color}"></div></div>
      <div>Niveau ${st.level + 1} dans ${w.xpToNext(sel)} XP : ${lvBonus(st.level + 1)}.</div>${catchUp}</div>`;
    else if (st.level >= MAX_LEVEL) level = `<div class="v-lvl"><div class="v-lvl-t">Niveau ${MAX_LEVEL} — MAX</div><div>Bonus : ${lvBonus(st.level)}, transformée en <b style="color:${d.color}">${d.v2}</b>.</div></div>`;
    else level = `<div class="v-lvl"><div class="v-lvl-t">Niveau ${st.level} / ${MAX_LEVEL}${st.level > 1 ? ` · ${lvBonus(st.level)}` : ''}</div>
      <div class="v-bar v-xp"><div style="width:${w.xpFrac(sel) * 100}%;background:${d.color}"></div></div>
      <div>Niveau ${st.level + 1} dans ${w.xpToNext(sel)} XP : ${st.level + 1 >= MAX_LEVEL ? `transformation en <b style="color:${d.color}">${d.v2}</b>` : lvBonus(st.level + 1)}.</div>${catchUp}</div>`;
    const refill = st.owned ? w.refillCost(sel) : 0;
    const allCost = w.refillAllCost();
    let action;
    void cap;
    if (!st.owned) {
      const afford = g.data.bolts >= d.price;
      action = `<button class="btn ${afford ? '' : 'disabled'}" data-a="buy"><span>Acheter — ${formatBolts(d.price)}</span></button>${afford ? '' : `<div class="v-miss">Il manque ${formatBolts(d.price - g.data.bolts)} boulons</div>`}`;
    } else if (w.megaOffered(sel) && w.isV2(sel)) {
      // mode Défi : version Méga d'une arme déjà en V2 (boutons compacts, recharge à côté)
      const mp = w.megaPrice(sel);
      action = (refill > 0 ? `<button class="btn small ${g.data.bolts >= refill ? '' : 'disabled'}" data-a="refill"><span>Recharger — ${formatBolts(refill)}</span></button>` : '')
        + `<button class="btn small mega ${g.data.bolts >= mp ? '' : 'disabled'}" data-a="mega"><span>Version Méga — ${formatBolts(mp)}</span></button>`
        + (g.data.bolts >= mp ? '' : `<div class="v-miss">Il manque ${formatBolts(mp - g.data.bolts)} boulons pour la version Méga</div>`);
    } else {
      action = refill > 0
        ? `<button class="btn ${g.data.bolts >= refill ? '' : 'disabled'}" data-a="refill"><span>Munitions pleines — ${formatBolts(refill)}</span></button>`
        : '<div class="v-full">Munitions au maximum</div>';
      if (w.megaOffered(sel)) action += `<div class="v-mega-note">Version Méga (<b>${d.mega}</b>) proposée quand l’arme atteint le niveau ${MAX_LEVEL}.</div>`;
    }
    s.querySelector('.vendor-wrap').innerHTML = `
      <div class="dim" style="position:absolute;inset:0"></div>
      <div class="vendor${this._vendorStill()}">
        ${this._vendorHead()}
        <div class="v-body">
          <div class="v-list">${list}</div>
          <div class="v-detail">
            <div class="v-top"><div class="v-big" style="background-image:url(${w.icon(sel) || ''})"></div>
            <div class="v-name" style="color:${d.color}">${w.displayName(sel)}</div></div>
            <div class="v-desc">${st.owned && st.level >= 5 ? d.descV2 : d.desc}</div>
            ${d.upgrade && st.level < MAX_LEVEL ? `<div class="v-up">Au niveau ${MAX_LEVEL} : <b style="color:${d.color}">${d.v2}</b> — ${d.upgrade}</div>` : ''}
            ${w.isMega(sel) ? `<div class="v-up mega">Version Méga : dégâts +${Math.round(MEGA_DMG * 100)} %, munitions +${Math.round(MEGA_AMMO * 100)} %, niveaux ${MAX_LEVEL + 1} à ${MEGA_LEVEL}.</div>`
              : w.megaOffered(sel) && w.isV2(sel) ? `<div class="v-up mega">Version Méga : <b>${d.mega}</b> — dégâts +${Math.round(MEGA_DMG * 100)} %, munitions +${Math.round(MEGA_AMMO * 100)} %, et cinq niveaux de plus à gagner.</div>` : ''}
            <div class="v-stats">${stats}</div>
            ${level}
            ${st.owned ? `<div class="v-ammo">Munitions : ${st.ammo} / ${w.maxAmmo(sel)}</div>` : `<div class="v-ammo">Munitions : ${w.maxAmmo(sel)} (pleines à l’achat)</div>`}
            <div class="v-act">${action}</div>
          </div>
        </div>
        <div class="v-foot">
          <button class="btn small ${allCost > 0 && g.data.bolts >= allCost ? '' : 'disabled'}" data-a="all"><span>Tout recharger${allCost > 0 ? ' — ' + formatBolts(allCost) : ''}</span></button>
          <button class="btn small ghost" data-a="close"><span>Quitter (Échap)</span></button>
        </div>
      </div>`;
    this._bindButtons(s);
    this._bindTabs(s);
    s.querySelectorAll('.v-item').forEach((el) => {
      el.onclick = () => {
        this.vendorSel = el.dataset.id;
        this._renderVendor();
        const idx = this.focusList.findIndex((b) => b.dataset && b.dataset.id === el.dataset.id);
        if (idx >= 0) this._focus(idx, false);
      };
    });
    const buy = s.querySelector('[data-a=buy]');
    if (buy) buy.onclick = () => {
      if (w.buy(sel)) {
        g.audio.play('buy');
        this.vendorQuip = 'Excellent choix ! Elle est garantie… jusqu’au premier tir.';
        g.hud.notify(`Nouvelle arme : ${d.name} !`, d.color);
      } else g.audio.play('deny');
      this._renderVendor();
    };
    const megaB = s.querySelector('[data-a=mega]');
    if (megaB) megaB.onclick = () => {
      if (w.buyMega(sel)) {
        g.audio.play('weaponUp');
        this.vendorQuip = 'Version Méga ! Chromée, dorée, et totalement déraisonnable. Comme je les aime.';
        g.hud.notify(`${d.mega} : version Méga !`, '#ffd23a');
      } else g.audio.play('deny');
      this._renderVendor();
    };
    const refillB = s.querySelector('[data-a=refill]');
    if (refillB) refillB.onclick = () => { if (w.refill(sel)) g.audio.play('ammo'); else g.audio.play('deny'); this._renderVendor(); };
    s.querySelector('[data-a=all]').onclick = () => { if (w.refillAll()) g.audio.play('ammo'); else g.audio.play('deny'); this._renderVendor(); };
    s.querySelector('[data-a=close]').onclick = () => g.closeVendor();
    // garder le focus sur l'élément sélectionné
    const idx = this.focusList.findIndex((b) => b.dataset && b.dataset.id === sel);
    if (idx >= 0) this._focus(idx, false);
  }
}

// ------------------------------------------------------------- grilles d'amélioration (Bazar) et Établi d'Écrou
// Un seul composant pour les deux écrans : colonnes à en-tête (anneau d'arme ou branche de l'Établi), tuiles de taille
// fixe à quatre états (acquis, achetable, trop cher, verrouillé), panneau de détail avec un bouton d'achat explicite.
// Un clic (ou le déplacement au clavier / à la manette) choisit une case ; l'achat passe toujours par le bouton.
const UP_ICO = {
  dmg: '<path d="M12 2l2.2 5.6L20 5.5l-2.6 5.4L22 14l-5.8.9L16 21l-4-4.4L8 21l-.2-6.1L2 14l4.6-3.1L4 5.5l5.8 2.1z"/>',
  ammo: '<path d="M4 10q0-5 2.5-7Q9 5 9 10v11H4zM10 10q0-5 2.5-7 2.5 2 2.5 7v11h-5zM16 10q0-5 2.5-7Q21 5 21 10v11h-5z"/>',
  rate: '<path d="M3 4l7 8-7 8h4l7-8-7-8zM11 4l7 8-7 8h4l7-8-7-8z"/>',
  area: '<path fill-rule="evenodd" d="M12 1a11 11 0 110 22 11 11 0 010-22zm0 3a8 8 0 100 16 8 8 0 000-16zm0 3a5 5 0 110 10 5 5 0 010-10zm0 3a2 2 0 100 4 2 2 0 000-4z"/>',
  special: '<path d="M12 1.5l3.1 6.9 7.4.7-5.6 5 1.7 7.4L12 17.7l-6.6 3.8 1.7-7.4-5.6-5 7.4-.7z"/>',
  lock: '<path fill-rule="evenodd" d="M7 10V7a5 5 0 0110 0v3h2v12H5V10zm3 0h4V7a2 2 0 00-4 0zm2 4a2 2 0 00-1 3.7V20h2v-2.3A2 2 0 0012 14z"/>',
  check: '<path d="M2 12.5l3-3 4.5 4.5L19 4.5l3 3L9.5 20z"/>',
  sante: '<path d="M8.5 2h7v6.5H22v7h-6.5V22h-7v-6.5H2v-7h6.5z"/>',
  cle: '<path d="M21 6.5a5.5 5.5 0 01-7.3 5.2L5.6 19.8a2 2 0 01-2.8-2.8l8.1-8.1A5.5 5.5 0 0117.5 1.6l-3.3 3.3.9 3.9 3.9.9z"/>',
  mobilite: '<path d="M14 1L4 14h7l-2 9 11-14h-7z"/>',
  economie: '<path fill-rule="evenodd" d="M12 1.5l9.1 5.25v10.5L12 22.5l-9.1-5.25V6.75zM12 8a4 4 0 100 8 4 4 0 000-8z"/>',
  ecrou: '<path fill-rule="evenodd" d="M11 1h2v3h4a4 4 0 014 4v8a4 4 0 01-4 4H7a4 4 0 01-4-4V8a4 4 0 014-4h4zM8.5 9a2 2 0 100 4 2 2 0 000-4zm7 0a2 2 0 100 4 2 2 0 000-4zM8 15.5v1.5h8v-1.5z"/>',
};
const upIco = (k, cls = 'up-ico') => `<svg class="${cls}" viewBox="0 0 24 24" fill="currentColor">${UP_ICO[k] || UP_ICO.special}</svg>`;
// tuile : st = have | can | poor | locked ; chip = contenu de la pastille (coût, « Acquis », niveau requis…)
const upTile = (attr, st, pick, icon, label, chip, extra = '') =>
  `<button class="btn up-tile ${st}${pick ? ' pick' : ''}${extra}" ${attr}><span>${upIco(icon)}<em class="up-chip">${chip}</em><b class="up-lbl">${label}</b></span></button>`;
const upLegend = (color, have = 'Acquis', can = 'Achetable') => `<div class="up-legend" style="--c:${color}"><span class="have">${upIco('check')}${have}</span><span class="can">${can}</span><span class="poor">Trop cher</span><span class="locked">${upIco('lock')}Verrouillé</span></div>`;
// panneau de détail : rows = [[texte, ok (true | false | null)]], act = bouton ou mention « acquis »
const upInfo = (color, icon, name, cost, effect, rows, act) => `<div class="up-info" style="--c:${color}">
    ${upIco(icon, 'up-info-ico')}
    <div class="up-info-name">${name}<em class="up-chip">${cost}</em></div>
    <div class="up-info-txt"><div class="up-info-eff">${effect}</div>
      <div class="up-info-meta">${rows.map(([t, ok]) => `<span class="${ok === true ? 'ok' : ok === false ? 'no' : ''}">${ok === true ? upIco('check', 'up-mi') : ok === false ? upIco('lock', 'up-mi') : ''}${t}</span>`).join('')}</div></div>
    <div class="up-info-act">${act}</div>
  </div>`;
const upAct = (have, haveText, can, label, reason) => have
  ? `<div class="up-done">${upIco('check', 'up-mi')}${haveText}</div>`
  : `<button class="btn up-buy ${can ? '' : 'disabled'}" data-a="buynode"><span>${label}</span></button>${can ? '' : `<div class="v-miss">${reason}</div>`}`;
const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;

Menus.prototype._renderUpgrades = function () {
  const g = this.game;
  const w = g.weapons;
  const up = g.up;
  const s = this.screens.vendor;
  const owned = w.ownedList();
  const sel = owned.includes(this.vendorSel) ? this.vendorSel : owned[0];
  this.vendorSel = sel;
  const d = w.def(sel);
  const st = w.state(sel);
  const grid = weaponGrid(sel);
  const color = d.color;
  const state = (n) => up.hasNode(sel, n.idx) ? 'have' : !up.ringOpen(sel, n.ring) ? 'locked' : up.orbium >= n.cost ? 'can' : 'poor';
  // case choisie : celle de l'utilisateur, sinon la première achetable, sinon la première à acquérir
  if (!grid[this.nodeSel]) {
    const first = grid.find((n) => state(n) === 'can') || grid.find((n) => state(n) !== 'have') || grid[0];
    this.nodeSel = first.idx;
  }
  const pick = grid[this.nodeSel];
  const list = owned.map((id) => {
    const df = w.def(id);
    const n = up.owned(id).length;
    const ready = weaponGrid(id).some((c) => up.canBuyNode(id, c.idx));
    return `<div class="v-item btn ${id === sel ? 'sel' : ''}" data-id="${id}"><span><i style="background-image:url(${w.icon(id) || ''})"></i><b style="color:${df.color}">${w.displayName(id)}</b><span class="vt ${n === grid.length ? 'owned' : ready ? 'ok' : 'no'}">${n} / ${grid.length}</span></span></div>`;
  }).join('');
  // une colonne par anneau : niveau d'arme requis et bonus d'anneau en tête
  const cols = RING_LEVEL.map((lv, r) => {
    const open = up.ringOpen(sel, r);
    const cells = grid.filter((n) => n.ring === r);
    const got = cells.filter((n) => up.hasNode(sel, n.idx)).length;
    const done = got === cells.length;
    const bonus = r === 0 ? '<div class="up-bonus">Pas de bonus</div>' : `<div class="up-bonus${done ? ' on' : ''}">Bonus ${ringBonusText(r, true)}</div>`;
    const tiles = cells.map((n) => {
      const ns = state(n);
      const chip = ns === 'have' ? `${upIco('check', 'up-mi')}Acquis` : ns === 'locked' ? `${upIco('lock', 'up-mi')}Niv. ${lv}` : `${ORB_SVG}${n.cost}`;
      return upTile(`data-node="${n.idx}"`, ns, n.idx === pick.idx, n.special ? 'special' : n.kind, n.name, chip);
    }).join('');
    return `<div class="up-col${open ? ' open' : ''}"><div class="up-head"><div class="up-h1">Anneau ${r + 1} <small>${got} / ${cells.length}</small></div>
      <div class="up-req ${open ? 'ok' : 'no'}">${upIco(open ? 'check' : 'lock', 'up-mi')}Arme niveau ${lv}</div>${bonus}</div><div class="up-cells">${tiles}</div></div>`;
  }).join('');
  // détail de la case choisie
  const ps = state(pick);
  const ringCells = grid.filter((n) => n.ring === pick.ring);
  const ringGot = ringCells.filter((n) => up.hasNode(sel, n.idx)).length;
  const lvReq = RING_LEVEL[pick.ring];
  const rows = [
    [`Requis : arme niveau ${lvReq}${up.ringOpen(sel, pick.ring) ? '' : ` (actuel : ${st.level})`}`, up.ringOpen(sel, pick.ring)],
    [pick.ring ? `Anneau ${pick.ring + 1} : ${ringGot} / ${ringCells.length} · complet : ${ringBonusText(pick.ring, true)}` : `Anneau 1 : ${ringGot} / ${ringCells.length}, sans bonus`, null],
  ];
  const reason = !up.ringOpen(sel, pick.ring) ? `Arme niveau ${lvReq} requis : elle progresse en éliminant des ennemis.`
    : `Il manque ${pick.cost - up.orbium} Orbium (exploration, élites, boss).`;
  const info = upInfo(color, pick.special ? 'special' : pick.kind, pick.name, `${ORB_SVG}${pick.cost} Orbium`, pick.desc, rows,
    upAct(ps === 'have', 'Acquis', ps === 'can', `Acheter — ${pick.cost} Orbium`, reason));
  const total = up.owned(sel).length;
  s.querySelector('.vendor-wrap').innerHTML = `
    <div class="dim" style="position:absolute;inset:0"></div>
    <div class="vendor${this._vendorStill()}">
      ${this._vendorHead(`<div class="up-title" style="--c:${color}"><span class="up-tn">${w.displayName(sel)}</span><span class="up-ts">Niveau ${st.level} · ${total} / ${grid.length} cases</span></div>`)}
      <div class="v-body up">
        <div class="v-list">${list}</div>
        <div class="v-detail up-pane" style="--c:${color}">
          <div class="up-grid wpn" style="--n:4">${cols}</div>
          ${info}
        </div>
      </div>
      <div class="v-foot">${upLegend(color)}<button class="btn small ghost" data-a="close"><span>Quitter (Échap)</span></button></div>
    </div>`;
  this._bindButtons(s);
  this._bindTabs(s);
  this.spatial = true;
  s.querySelectorAll('.v-item').forEach((el) => {
    el.onclick = () => {
      if (this.vendorSel !== el.dataset.id) this.nodeSel = null;
      this.vendorSel = el.dataset.id;
      this._renderVendor();
      this._refocus('[data-id="' + el.dataset.id + '"]');
    };
  });
  s.querySelectorAll('[data-node]').forEach((el) => {
    el.onclick = () => {
      this.nodeSel = +el.dataset.node;
      this._renderVendor();
      this._refocus('[data-node="' + el.dataset.node + '"]');
    };
  });
  const buy = s.querySelector('[data-a=buynode]');
  if (buy) buy.onclick = () => {
    const n = grid[this.nodeSel];
    if (up.buyNode(sel, n.idx)) {
      g.audio.play('buy', { pitch: 1.2 });
      g.hud.notify(`${d.name} : ${n.name}`, color, 2.5);
      const r = n.ring;
      if (r && up.ringComplete(sel, r)) {
        this.vendorQuip = `Anneau ${r + 1} complet ! ${ringBonusText(r)[0].toUpperCase() + ringBonusText(r).slice(1)}, offert par la maison.`;
        g.audio.play('weaponUp');
      }
    } else g.audio.play('deny');
    this._renderVendor();
    this._refocus('[data-node="' + n.idx + '"]');
  };
  s.querySelector('[data-a=close]').onclick = () => g.closeVendor();
  this._refocus('[data-id="' + sel + '"]');
};
Menus.prototype._refocus = function (selector) {
  const idx = this.focusList.findIndex((b) => b.matches(selector));
  if (idx >= 0) this._focus(idx, false);
  return idx >= 0;
};
// déplacement au clavier / à la manette vers le bouton le plus proche dans la direction voulue
Menus.prototype._moveSpatial = function (dir) {
  const cur = this.focusList[this.focusIdx];
  if (!cur) return;
  const a = cur.getBoundingClientRect();
  const [dx, dy] = dir;
  let best = null, bestScore = Infinity;
  for (const b of this.focusList) {
    if (b === cur) continue;
    const r = b.getBoundingClientRect();
    if (!r.width) continue;
    // distance le long de la direction (bord à bord) et écart sur l'axe perpendiculaire
    const along = dx > 0 ? r.left - a.right : dx < 0 ? a.left - r.right : dy > 0 ? r.top - a.bottom : a.top - r.bottom;
    const centre = dx ? (r.left + r.right) / 2 - (a.left + a.right) / 2 : (r.top + r.bottom) / 2 - (a.top + a.bottom) / 2;
    if (along < -4 || centre * (dx || dy) <= 0) continue;
    const gap = dx ? Math.max(0, r.top - a.bottom, a.top - r.bottom) : Math.max(0, r.left - a.right, a.left - r.right);
    const off = dx ? Math.abs((r.top + r.bottom) / 2 - (a.top + a.bottom) / 2) : Math.abs((r.left + r.right) / 2 - (a.left + a.right) / 2);
    const score = Math.max(0, along) + gap * 4 + off * 0.15;
    if (score < bestScore) { bestScore = score; best = b; }
  }
  if (!best) return;
  this._focus(this.focusList.indexOf(best), true);
  // la liste des armes défile pour garder l'élément visible
  const list = best.closest('.v-list');
  if (list) {
    const lr = list.getBoundingClientRect(), br = best.getBoundingClientRect();
    if (br.top < lr.top) list.scrollTop -= lr.top - br.top + 8;
    else if (br.bottom > lr.bottom) list.scrollTop += br.bottom - lr.bottom + 8;
  }
  // choisir une arme ou une case en s'y déplaçant (comme la liste de l'onglet Armes)
  if ((best.dataset.id && best.dataset.id !== this.vendorSel) || ((best.dataset.node !== undefined || best.dataset.t) && !best.classList.contains('pick'))) best.click();
};

Menus.prototype.showEtabli = function (onBack) {
  this.etabliBack = onBack;
  this._show('etabli', '<div class="dim" style="position:absolute;inset:0"></div><div class="etabli-wrap"></div>');
  this.treeSel = this.treeSel || null;
  this._renderEtabli();
  this.back = () => onBack();
};
Menus.prototype._renderEtabli = function () {
  const g = this.game;
  const up = g.up;
  const s = this.screens.etabli;
  const pts = up.points();
  const state = (n) => up.has(n.id) ? 'have' : n.prev && !up.has(n.prev) ? 'locked' : pts >= n.cost ? 'can' : 'poor';
  const all = TREE.flatMap((b) => b.nodes.map((n) => TREE_NODES.get(n.id)));
  if (!TREE_NODES.get(this.treeSel)) this.treeSel = (all.find((n) => state(n) === 'can') || all.find((n) => state(n) !== 'have') || all[0]).id;
  const pick = TREE_NODES.get(this.treeSel);
  // une colonne par branche ; chaque case est reliée à la précédente, qu'elle demande
  const cols = TREE.map((b) => {
    const got = b.nodes.filter((n) => up.has(n.id)).length;
    const tiles = b.nodes.map((n, i) => {
      const node = TREE_NODES.get(n.id);
      const ns = state(node);
      const chip = ns === 'have' ? `${upIco('check', 'up-mi')}Installé` : ns === 'locked' ? `${upIco('lock', 'up-mi')}${plural(n.cost, 'pt')}` : plural(n.cost, 'pt');
      return upTile(`data-t="${n.id}"`, ns, n.id === pick.id, b.id, n.name, chip, i > 0 && up.has(node.prev) ? ' linked' : '');
    }).join('');
    return `<div class="up-col open" style="--c:${b.color}"><div class="up-head"><div class="up-h1">${upIco(b.id, 'up-hi')}${b.name} <small>${got} / ${b.nodes.length}</small></div></div><div class="up-cells chain">${tiles}</div></div>`;
  }).join('');
  const branch = TREE.find((b) => b.id === pick.branch);
  const ps = state(pick);
  const prevName = pick.prev ? TREE_NODES.get(pick.prev).name : null;
  const rows = [
    prevName ? [`Requis : ${prevName} installé`, up.has(pick.prev)] : ['Requis : rien, première case de la branche', true],
    [`Branche ${branch.name} : ${branch.nodes.filter((n) => up.has(n.id)).length} / ${branch.nodes.length}`, null],
  ];
  const reason = ps === 'locked' ? `Installez d’abord ${prevName}.`
    : `Il manque ${plural(pick.cost - pts, 'point')} : un par niveau de Kobi et par boulon d’or.`;
  const info = upInfo(branch.color, branch.id, pick.name, plural(pick.cost, 'point'), pick.desc, rows,
    upAct(ps === 'have', 'Installé', ps === 'can', `Installer — ${plural(pick.cost, 'pt')}`, reason));
  s.querySelector('.etabli-wrap').innerHTML = `
    <div class="etabli">
      <div class="e-head"><div class="e-face">${FACES.ecrou}</div><div><div class="v-title">Établi d’Écrou</div><div class="v-quip">« Passe-moi la clé de 12, je te bricole un fennec tout neuf. »</div></div>
        <div class="e-pts"><b>${pts}</b><span>point${pts > 1 ? 's' : ''} disponible${pts > 1 ? 's' : ''}</span></div></div>
      <div class="up-pane e-pane">
        <div class="up-grid tree" style="--n:${TREE.length}">${cols}</div>
        ${info}
      </div>
      <div class="v-foot"><div class="g-hint">Kobi niveau ${g.data.heroLevel} · ${plural(up.pointsEarned(), 'point')} gagné${up.pointsEarned() > 1 ? 's' : ''}</div>${upLegend('#7ff3ff', 'Installé', 'Installable')}<button class="btn small ghost" data-a="back"><span>Retour (Échap)</span></button></div>
    </div>`;
  this._bindButtons(s);
  this.spatial = true;
  s.querySelectorAll('[data-t]').forEach((el) => {
    el.onclick = () => {
      this.treeSel = el.dataset.t;
      this._renderEtabli();
      this._refocus('[data-t="' + el.dataset.t + '"]');
    };
  });
  const buy = s.querySelector('[data-a=buynode]');
  if (buy) buy.onclick = () => {
    const id = this.treeSel;
    if (up.buy(id)) {
      g.audio.play('levelup', { pitch: 1.3 });
    } else g.audio.play('deny');
    this._renderEtabli();
    this._refocus('[data-t="' + id + '"]');
  };
  s.querySelector('[data-a=back]').onclick = () => this.etabliBack();
  this._refocus('[data-t="' + pick.id + '"]');
};

const TIPS = [
  'Astuce : maintenez le saut après un double saut pour planer grâce aux hélices d’Écrou.',
  'Astuce : en l’air, le coup de clé devient une attaque plongeante qui sonne tout le monde autour.',
  'Astuce : les armes gagnent de l’expérience. Au niveau 5, elles se transforment !',
  'Astuce : l’esquive (Maj) rend Kobi invulnérable une fraction de seconde.',
  'Astuce : la roue des armes ralentit le temps. Profitez-en pour respirer.',
  'Astuce : les caisses rouges explosent. Les ennemis autour aussi, du coup.',
  'Astuce : trois boulons d’or se cachent sur chaque planète.',
];
