// HUD en DOM, stylé avec la police maison : santé, boulons, arme, réticule, invites, dialogues, boss, roue des armes.
import * as THREE from 'three';
import { formatBolts, clamp, damp } from '../engine/util.js';

const NUT_SVG = `<svg viewBox="-12 -12 24 24" class="nut-ico"><polygon points="10,0 5,8.66 -5,8.66 -10,0 -5,-8.66 5,-8.66" fill="#ffd23a" stroke="#7a4b00" stroke-width="1.6"/><circle r="4.2" fill="#3a2a10" stroke="#fff3b0" stroke-width="1.2"/></svg>`;
const ECROU_FACE = `<svg viewBox="0 0 100 100" class="ecrou-face"><defs><radialGradient id="eg" cx="0.4" cy="0.35"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#b9c3d9"/></radialGradient></defs>
<line x1="62" y1="18" x2="72" y2="2" stroke="#56607d" stroke-width="4"/><circle cx="73" cy="4" r="5" fill="#ff5a4a"/>
<ellipse cx="50" cy="56" rx="40" ry="36" fill="url(#eg)" stroke="#1d1028" stroke-width="4"/>
<rect x="18" y="38" width="64" height="34" rx="16" fill="#141526" stroke="#1d1028" stroke-width="3"/>
<ellipse class="ecrou-eye" cx="50" cy="55" rx="14" ry="11" fill="#4ff3ff"/><ellipse cx="45" cy="51" rx="4" ry="3" fill="#ffffff" opacity="0.8"/>
<rect x="14" y="84" width="72" height="8" rx="4" fill="#56607d"/></svg>`;
const BARON_FACE = `<svg viewBox="0 0 100 100" class="ecrou-face"><ellipse cx="50" cy="58" rx="38" ry="34" fill="#c99ae8" stroke="#1d1028" stroke-width="4"/>
<rect x="20" y="12" width="60" height="22" rx="6" fill="#ffd23a" stroke="#1d1028" stroke-width="3"/><rect x="30" y="2" width="40" height="14" rx="4" fill="#ffd23a" stroke="#1d1028" stroke-width="3"/>
<circle cx="38" cy="52" r="8" fill="#fff" stroke="#1d1028" stroke-width="3"/><circle cx="64" cy="52" r="10" fill="#fff" stroke="#1d1028" stroke-width="3"/><circle cx="64" cy="52" r="4" fill="#1d1028"/><circle cx="38" cy="53" r="3" fill="#1d1028"/>
<circle cx="64" cy="52" r="12" fill="none" stroke="#ffd23a" stroke-width="3"/>
<path d="M28 74 Q50 64 72 74 Q60 70 50 78 Q40 70 28 74" fill="#5a2a1a" stroke="#1d1028" stroke-width="3"/></svg>`;
const MERCHANT_FACE = `<svg viewBox="0 0 100 100" class="ecrou-face"><ellipse cx="50" cy="60" rx="36" ry="32" fill="#7fd36a" stroke="#1d1028" stroke-width="4"/>
<ellipse cx="34" cy="20" rx="8" ry="16" fill="#7fd36a" stroke="#1d1028" stroke-width="3"/><ellipse cx="66" cy="20" rx="8" ry="16" fill="#7fd36a" stroke="#1d1028" stroke-width="3"/>
<circle cx="38" cy="52" r="9" fill="#fff" stroke="#1d1028" stroke-width="3"/><circle cx="62" cy="52" r="9" fill="#fff" stroke="#1d1028" stroke-width="3"/><circle cx="40" cy="53" r="4" fill="#1d1028"/><circle cx="60" cy="53" r="4" fill="#1d1028"/>
<path d="M32 70 Q50 86 68 70" fill="#ff4f6d" stroke="#1d1028" stroke-width="3"/><rect x="44" y="70" width="12" height="6" fill="#ffd23a"/></svg>`;
const MORSE_FACE = `<svg viewBox="0 0 100 100" class="ecrou-face"><ellipse cx="50" cy="56" rx="38" ry="34" fill="#9a6a5a" stroke="#1d1028" stroke-width="4"/>
<path d="M22 30 Q50 8 78 30" fill="none" stroke="#3a2a2a" stroke-width="5"/><circle cx="36" cy="30" r="9" fill="#9ae4ff" stroke="#c9a040" stroke-width="4"/><circle cx="64" cy="30" r="9" fill="#9ae4ff" stroke="#c9a040" stroke-width="4"/>
<circle cx="38" cy="48" r="4" fill="#1d1028"/><circle cx="62" cy="48" r="4" fill="#1d1028"/>
<path d="M44 76 L41 96 L48 78 Z M56 76 L59 96 L52 78 Z" fill="#fff8e8" stroke="#1d1028" stroke-width="2"/>
<ellipse cx="40" cy="66" rx="13" ry="10" fill="#f2ece0" stroke="#1d1028" stroke-width="3"/><ellipse cx="60" cy="66" rx="13" ry="10" fill="#f2ece0" stroke="#1d1028" stroke-width="3"/>
<ellipse cx="50" cy="57" rx="6" ry="4" fill="#4a2a2a"/></svg>`;
const CAMELA_FACE = `<svg viewBox="0 0 100 100" class="ecrou-face"><path d="M50 6 Q74 10 70 30" fill="none" stroke="#2f8a5a" stroke-width="7" stroke-linecap="round"/>
<ellipse cx="50" cy="58" rx="36" ry="32" fill="#6ad08a" stroke="#1d1028" stroke-width="4"/>
<circle cx="30" cy="46" r="14" fill="#9ae86a" stroke="#1d1028" stroke-width="3"/><circle cx="70" cy="46" r="14" fill="#9ae86a" stroke="#1d1028" stroke-width="3"/>
<circle cx="32" cy="46" r="5" fill="#1d1028"/><circle cx="68" cy="47" r="5" fill="#1d1028"/>
<circle cx="28" cy="70" r="6" fill="#ff8ab8" opacity="0.7"/><circle cx="72" cy="70" r="6" fill="#ff8ab8" opacity="0.7"/>
<path d="M36 74 Q50 84 64 74" fill="none" stroke="#1d1028" stroke-width="3"/><circle cx="50" cy="20" r="5" fill="#ffd23a" stroke="#1d1028" stroke-width="2"/></svg>`;
export const FACES = { ecrou: ECROU_FACE, baron: BARON_FACE, gigi: MERCHANT_FACE, morse: MORSE_FACE, camela: CAMELA_FACE };
const NAMES = { ecrou: 'Écrou', baron: 'Baron Vorax', gigi: 'Gigi Pétarade', kobi: 'Kobi', morse: 'Grand-père Morsillon', camela: 'Tantine Caméla' };
// hauteur de la « voix » (charabia) de chaque personnage
const VOICE_PITCH = { kobi: 1.15, gigi: 1.3, morse: 0.72, camela: 1.08 };

const _mk = new THREE.Vector3();
function setText(el, v) { if (el._v !== v) { el._v = v; el.textContent = v; } }
function setW(el, v) { const s = v.toFixed(2) + '%'; if (el._w !== s) { el._w = s; el.style.width = s; } }

export class HUD {
  constructor(game) {
    this.game = game;
    const root = (this.root = document.createElement('div'));
    root.id = 'hud';
    root.innerHTML = `
      <div class="hud-health"><div class="hp-label"><span class="hp-ico">+</span><span class="hp-num">100</span></div><div class="hp-bar"><div class="hp-fill"></div><div class="hp-ghost"></div><div class="hp-segs"></div></div><div class="hero-lvl">NIV. 1</div></div>
      <div class="hud-marks"></div>
      <div class="hud-objective"></div>
      <div class="hud-bolts"><span class="bolt-chain"><i>×</i><b>1</b></span>${NUT_SVG}<span class="bolt-num">0</span><div class="bolt-gains"></div></div>
      <div class="hud-orbium"><svg viewBox="-10 -14 20 28" class="orb-ico"><polygon points="0,-13 8,0 0,13 -8,0" fill="#c06aff" stroke="#3a0a6a" stroke-width="1.6"/><polygon points="0,-13 3,0 0,13" fill="#e8b8ff" opacity="0.7"/></svg><span class="orb-num">0</span></div>
      <div class="hud-weapon"><div class="w-icon"></div><div class="w-info"><div class="w-name">—</div><div class="w-ammo"><span class="w-cur">0</span><span class="w-max">/ 0</span></div><div class="w-xp"><div class="w-xp-fill"></div></div><div class="w-lvl">NIV. 1</div></div></div>
      <div class="crosshair"><i></i><i></i><i></i><i></i><b></b></div>
      <div class="hud-prompt"><span class="key"></span><span class="txt"></span></div>
      <div class="hud-toast"></div>
      <div class="hud-title"><div class="t1"></div><div class="t2"></div></div>
      <div class="hud-notify"></div>
      <div class="hud-dialog"><div class="d-face"></div><div class="d-body"><div class="d-name"></div><div class="d-text"></div></div></div>
      <div class="hud-boss"><div class="b-name"></div><div class="b-bar"><div class="b-fill"></div><div class="b-ghost"></div></div></div>
      <div class="hud-wheel"><div class="wheel-ring"></div><div class="wheel-center"><div class="wc-name"></div><div class="wc-ammo"></div></div></div>
      <div class="hud-fps"></div>
      <div class="hud-lock"><span class="key">Clic</span> pour prendre les commandes</div>
      <div class="hud-scope"><i class="sc-h"></i><i class="sc-v"></i><i class="sc-dot"></i></div>
    `;
    document.body.appendChild(root);
    const q = (s) => root.querySelector(s);
    this.el = {
      hpFill: q('.hp-fill'), hpGhost: q('.hp-ghost'), hpNum: q('.hp-num'), hpSegs: q('.hp-segs'), heroLvl: q('.hero-lvl'), health: q('.hud-health'),
      bolts: q('.bolt-num'), boltBox: q('.hud-bolts'), gains: q('.bolt-gains'),
      wIcon: q('.w-icon'), wName: q('.w-name'), wCur: q('.w-cur'), wMax: q('.w-max'), wXp: q('.w-xp-fill'), wLvl: q('.w-lvl'), weapon: q('.hud-weapon'),
      cross: q('.crosshair'), prompt: q('.hud-prompt'), pKey: q('.hud-prompt .key'), pTxt: q('.hud-prompt .txt'),
      toast: q('.hud-toast'), title: q('.hud-title'), t1: q('.hud-title .t1'), t2: q('.hud-title .t2'), notify: q('.hud-notify'),
      dialog: q('.hud-dialog'), dFace: q('.d-face'), dName: q('.d-name'), dText: q('.d-text'),
      boss: q('.hud-boss'), bName: q('.b-name'), bFill: q('.b-fill'), bGhost: q('.b-ghost'),
      wheel: q('.hud-wheel'), wheelRing: q('.wheel-ring'), wcName: q('.wc-name'), wcAmmo: q('.wc-ammo'),
      objective: q('.hud-objective'), fps: q('.hud-fps'), lock: q('.hud-lock'),
    };
    this.shownBolts = 0;
    this.ghostHp = 1;
    this.toastT = 0;
    this.titleT = 0;
    this.dialogQueue = [];
    this.dialogT = 0;
    this.dialogChars = 0;
    this.lastPrompt = null;
    this.hitT = 0;
    this.wheelOpen = false;
    this.wheelSel = -1;
    this.wheelAcc = { x: 0, y: 0 };
    this.bossGhost = 1;
    this.lastSegs = 0;
    this.bubbles = [];
    this.show(false);
  }

  show(on) {
    this.root.style.display = on ? 'block' : 'none';
    this.visible = on;
  }
  refreshAll() {
    this.shownBolts = this.game.data.bolts;
    this.el.bolts.textContent = formatBolts(this.shownBolts);
    this._refreshOrbium();
    this.weaponChanged();
    this.el.heroLvl.textContent = 'NIV. ' + this.game.data.heroLevel;
  }

  // ------------------------------------------------------------- Orbium (cristal rare des améliorations)
  _refreshOrbium() {
    if (!this._orbEl) { this._orbEl = this.root.querySelector('.hud-orbium'); this._orbNum = this.root.querySelector('.orb-num'); }
    const n = this.game.data.orbium || 0;
    this._orbNum.textContent = n;
    this._orbEl.classList.toggle('on', n > 0);
  }
  orbiumGained() {
    this._refreshOrbium();
    this._orbEl.classList.remove('bump');
    void this._orbEl.offsetWidth;
    this._orbEl.classList.add('bump');
  }

  // ------------------------------------------------------------- boulons
  boltsGained(n) {
    this._gainAcc = (this._gainAcc || 0) + n;
    this._gainT = 0.25;
    this.el.boltBox.classList.remove('bump');
    void this.el.boltBox.offsetWidth;
    this.el.boltBox.classList.add('bump');
  }
  _flushGain() {
    const n = this._gainAcc;
    this._gainAcc = 0;
    if (!n) return;
    const d = document.createElement('div');
    d.className = 'gain';
    d.textContent = '+' + formatBolts(n);
    this.el.gains.prepend(d);
    setTimeout(() => d.remove(), 1400);
    while (this.el.gains.children.length > 4) this.el.gains.lastChild.remove();
  }

  // multiplicateur du mode Défi (×1 à ×10), affiché devant le compteur de boulons
  chain(n, anim, broke) {
    if (!this._chainEl) { this._chainEl = this.root.querySelector('.bolt-chain'); this._chainNum = this._chainEl.querySelector('b'); }
    const el = this._chainEl;
    el.classList.toggle('on', !!this.game.defi);
    this._chainNum.textContent = n;
    el.style.setProperty('--k', Math.min(1, (n - 1) / 9).toFixed(2));
    el.classList.toggle('max', n >= 10);
    if (anim) {
      el.classList.remove('up', 'broke');
      void el.offsetWidth;
      el.classList.add(broke ? 'broke' : 'up');
    }
  }

  // ------------------------------------------------------------- santé
  damage() {
    this.el.health.classList.remove('hit');
    void this.el.health.offsetWidth;
    this.el.health.classList.add('hit');
  }
  flashHealth() {
    this.el.health.classList.remove('heal');
    void this.el.health.offsetWidth;
    this.el.health.classList.add('heal');
  }

  // ------------------------------------------------------------- arme
  weaponChanged() {
    const w = this.game.weapons;
    const cur = w.current ? w.state(w.current) : null;
    if (!cur) {
      this.el.weapon.style.opacity = 0;
      return;
    }
    this.el.weapon.style.opacity = 1;
    const def = w.def(w.current);
    this.el.wName.textContent = w.displayName(w.current);
    this.el.wName.style.color = def.color;
    const icon = w.icon(w.current);
    this.el.wIcon.style.backgroundImage = icon ? `url(${icon})` : '';
    this.el.weapon.classList.remove('swap');
    void this.el.weapon.offsetWidth;
    this.el.weapon.classList.add('swap');
  }
  crosshairHit(kill) {
    this.hitT = kill ? 0.3 : 0.15;
    this.el.cross.classList.toggle('kill', !!kill);
  }

  // ------------------------------------------------------------- invites et messages
  prompt(p) {
    const key = p ? p.text + p.action : null;
    if (key === this.lastPrompt) return;
    this.lastPrompt = key;
    if (!p) { this.el.prompt.classList.remove('on'); return; }
    this.el.pKey.textContent = this.game.input.actionLabel(p.action);
    this.el.pTxt.textContent = p.text;
    this.el.prompt.classList.add('on');
  }
  toast(text, dur = 2.5, kind = '') {
    this.el.toast.textContent = text;
    this.el.toast.className = 'hud-toast on ' + kind;
    this.toastT = dur;
  }
  titleCard(t1, t2, dur = 3.6) {
    this.el.t1.textContent = t1;
    this.el.t2.textContent = t2 || '';
    this.el.title.classList.remove('on');
    void this.el.title.offsetWidth;
    this.el.title.classList.add('on');
    this.titleT = dur;
  }
  notify(text, color = '#ffd23a', dur = 3.2) {
    const d = document.createElement('div');
    d.className = 'note';
    d.style.borderColor = color;
    d.innerHTML = `<span style="color:${color}">◆</span> ${text}`;
    this.el.notify.appendChild(d);
    setTimeout(() => d.classList.add('out'), dur * 1000);
    setTimeout(() => d.remove(), dur * 1000 + 500);
  }
  objective(text) {
    this.el.objective.innerHTML = text ? `<span class="obj-k">Objectif</span> ${text}` : '';
    this.el.objective.classList.toggle('on', !!text);
  }
  // Dialogues : [[qui, texte, durée?], ...]
  say(lines, priority = false) {
    if (priority) { this.dialogQueue = []; this.dialogT = 0; }
    for (const l of lines) this.dialogQueue.push(l);
    if (!this.dialogCur) this._nextDialog();
  }
  _nextDialog() {
    const l = this.dialogQueue.shift();
    this.dialogCur = l || null;
    if (!l) { this.el.dialog.classList.remove('on'); return; }
    const [who, text, dur] = l;
    this.el.dFace.innerHTML = FACES[who] || '';
    this.el.dFace.style.display = FACES[who] ? 'block' : 'none';
    this.el.dName.textContent = NAMES[who] || who;
    this.el.dName.className = 'd-name ' + who;
    this.dialogText = text;
    this.dialogChars = 0;
    this.dialogT = dur ?? Math.max(2.6, text.length * 0.055);
    this.el.dText.textContent = '';
    this.el.dialog.classList.add('on');
    this.game.audio.play(who === 'ecrou' ? 'voiceEcrou' : who === 'baron' ? 'voiceBaron' : 'voice', { pitch: VOICE_PITCH[who] ?? 1 });
  }
  // vide messages et dialogues (changement de niveau)
  resetMessages() {
    this.dialogQueue = [];
    this.dialogCur = null;
    this.el.dialog.classList.remove('on');
    this.el.toast.classList.remove('on');
    this.toastT = 0;
    this.el.title.classList.remove('on');
    this.titleT = 0;
    this.el.notify.innerHTML = '';
    this.objective(null);
    for (const b of this.bubbles) b.el.remove();
    this.bubbles.length = 0;
    this.prompt(null);
  }
  boss(name, frac) {
    if (name === null) { this.el.boss.classList.remove('on'); this.root.classList.remove('bossfight'); return; }
    this.el.boss.classList.add('on');
    this.root.classList.add('bossfight');
    this.el.bName.textContent = name;
    this.el.bFill.style.width = clamp(frac, 0, 1) * 100 + '%';
    this.bossFrac = frac;
  }

  // Bulle de texte accrochée à un point 3D
  // o.follow : objet suivi (sa position + o.dy), o.cls : classe CSS en plus
  bubble(pos, text, dur = 2.2, o = {}) {
    const el = document.createElement('div');
    el.className = 'bubble' + (o.cls ? ' ' + o.cls : '');
    el.textContent = text;
    this.root.appendChild(el);
    this.bubbles.push({ el, pos: pos.clone(), t: dur, follow: o.follow, dy: o.dy || 0 });
  }
  _updateBubbles(dt) {
    const cam = this.game.camera.cam;
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.t -= dt;
      if (b.t <= 0 || (b.follow && b.follow.dead)) { b.el.remove(); this.bubbles.splice(i, 1); continue; }
      if (b.follow) b.pos.copy(b.follow.pos).setY(b.follow.pos.y + b.dy);
      const v = b.pos.clone().project(cam);
      const vis = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      b.el.style.display = vis ? 'block' : 'none';
      b.el.style.left = ((v.x + 1) / 2) * innerWidth + 'px';
      b.el.style.top = ((1 - v.y) / 2) * innerHeight + 'px';
      b.el.style.opacity = Math.min(1, b.t * 3);
    }
  }

  // ------------------------------------------------------------- repères à l'écran
  // Bazar (quand il y a une raison d'y passer) et, avec le Radar à trésors de l'Établi, boulons d'or et Orbium proches.
  // Hors champ, le repère se colle au bord de l'écran et une flèche indique la direction.
  _updateMarks() {
    const g = this.game;
    if (!this._marks) { this._marks = new Map(); this._marksEl = this.root.querySelector('.hud-marks'); }
    const p = g.player;
    const want = [];
    if (g.state === 'playing' && p.alive && g.props) {
      const why = g.shopReason();
      if (why) for (const v of g.props.vendors) {
        const d = v.pos.distanceTo(p.pos);
        if (d > 6 && d < (why.far ? 170 : 70)) want.push([v, v.top, 'shop', 'Bazar', why.text, d]);
      }
      if (g.up.has('radar')) {
        for (const gb of g.props.goldBolts) if (!gb.taken) { const d = gb.pos.distanceTo(p.pos); if (d < 45) want.push([gb, gb.pos, 'gold', '', '', d]); }
        for (const ob of g.props.orbiums) if (!ob.taken) { const d = ob.pos.distanceTo(p.pos); if (d < 45) want.push([ob, ob.pos, 'orb', '', '', d]); }
      }
    }
    const seen = new Set();
    const cam = g.camera.cam;
    const W = innerWidth, H = innerHeight;
    for (const [key, pos, cls, label, sub, d] of want) {
      seen.add(key);
      let m = this._marks.get(key);
      if (!m) {
        const el = document.createElement('div');
        el.className = 'mk ' + cls;
        el.innerHTML = `<s class="mk-arrow"></s><i class="mk-ico"></i>${label ? `<b>${label}</b>` : ''}<span class="mk-d"></span>${sub ? '<em></em>' : ''}`;
        this._marksEl.appendChild(el);
        m = { el, d: el.querySelector('.mk-d'), sub: el.querySelector('em'), arrow: el.querySelector('.mk-arrow') };
        this._marks.set(key, m);
      }
      if (m.sub) setText(m.sub, sub);
      setText(m.d, Math.round(d) + ' m');
      const v = _mk.copy(pos).project(cam);
      let x = v.x, y = v.y;
      const behind = v.z > 1;
      if (behind) { x = -x; y = -y; }
      const mx = 0.84, my = 0.74;
      const off = behind || Math.abs(x) > mx || Math.abs(y) > my;
      if (behind) {
        // derrière Kobi : sur le bord gauche ou droit, à mi-hauteur
        x = x < 0 ? -mx : mx;
        y = clamp(y, -0.4, 0.4);
      } else if (off) {
        // sur le bord, dans la direction de la cible
        const k = Math.max(Math.abs(x) / mx, Math.abs(y) / my, 1e-3);
        x /= k; y /= k;
      }
      m.el.classList.toggle('edge', off);
      if (off) m.arrow.style.transform = `rotate(${Math.atan2(-y * H, x * W)}rad)`;
      m.el.style.left = ((x + 1) / 2) * W + 'px';
      m.el.style.top = ((1 - y) / 2) * H + 'px';
    }
    for (const [key, m] of this._marks) if (!seen.has(key)) { m.el.remove(); this._marks.delete(key); }
  }

  // ------------------------------------------------------------- roue des armes
  wheel(open) {
    if (open === this.wheelOpen) return;
    this.wheelOpen = open;
    this.el.wheel.classList.toggle('on', open);
    const w = this.game.weapons;
    if (open) {
      this.wheelAcc.x = this.wheelAcc.y = 0;
      const owned = w.ownedList();
      this.wheelItems = owned;
      this.wheelSel = owned.indexOf(w.current);
      const ring = this.el.wheelRing;
      ring.innerHTML = '';
      const n = Math.max(owned.length, 1);
      owned.forEach((id, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const d = document.createElement('div');
        d.className = 'wslot';
        d.style.left = `calc(50% + ${Math.cos(a) * 150}px)`;
        d.style.top = `calc(50% + ${Math.sin(a) * 150}px)`;
        const icon = w.icon(id);
        d.innerHTML = `<div class="ws-ico" style="background-image:url(${icon || ''})"></div><div class="ws-key">${i + 1}</div>`;
        ring.appendChild(d);
      });
      this._wheelRefresh();
      this.game.audio.play('uiMove', { pitch: 0.8 });
    } else if (this.wheelSel >= 0 && this.wheelItems && this.wheelItems[this.wheelSel] && this.wheelItems[this.wheelSel] !== w.current) {
      w.select(this.wheelItems[this.wheelSel]);
    }
  }
  _wheelRefresh() {
    const w = this.game.weapons;
    [...this.el.wheelRing.children].forEach((c, i) => c.classList.toggle('sel', i === this.wheelSel));
    const id = this.wheelItems && this.wheelItems[this.wheelSel];
    if (id) {
      const st = w.state(id);
      this.el.wcName.textContent = w.displayName(id);
      this.el.wcName.style.color = w.def(id).color;
      this.el.wcAmmo.textContent = `${st.ammo} / ${w.maxAmmo(id)}`;
    }
  }

  // ------------------------------------------------------------- mise à jour
  update(dt) {
    const g = this.game;
    if (!this.visible) return;
    const p = g.player;
    const el = this.el;
    // lunette de la Longue-Vue (le réticule normal s'efface)
    const scoped = (g.camera.zoomBlend || 0) > 0.55;
    if (scoped !== this._scoped) {
      this._scoped = scoped;
      if (!this._scopeEl) this._scopeEl = this.root.querySelector('.hud-scope');
      this._scopeEl.classList.toggle('on', scoped);
      this.root.classList.toggle('scoped', scoped);
    }
    // santé
    const frac = clamp(p.hp / p.maxHp, 0, 1);
    setW(el.hpFill, frac * 100);
    this.ghostHp = frac > this.ghostHp ? frac : damp(this.ghostHp, frac, 3, dt);
    setW(el.hpGhost, this.ghostHp * 100);
    setText(el.hpNum, String(Math.ceil(p.hp)));
    el.health.classList.toggle('low', frac < 0.3);
    const segs = Math.round(p.maxHp / 20);
    if (segs !== this.lastSegs) {
      this.lastSegs = segs;
      el.hpSegs.innerHTML = '<i></i>'.repeat(segs - 1);
      el.health.style.setProperty('--hpw', 180 + segs * 18 + 'px');
    }
    // boulons (compteur qui roule)
    const target = g.data.bolts;
    if (this.shownBolts !== target) {
      const diff = target - this.shownBolts;
      const step = Math.max(1, Math.abs(diff) * 10 * dt);
      this.shownBolts = Math.abs(diff) <= step ? target : this.shownBolts + Math.sign(diff) * step;
      el.bolts.textContent = formatBolts(Math.round(this.shownBolts));
    }
    if (this._gainT > 0) { this._gainT -= dt; if (this._gainT <= 0) this._flushGain(); }
    // arme
    const w = g.weapons;
    if (w.current) {
      const st = w.state(w.current);
      setText(el.wCur, String(st.ammo));
      setText(el.wMax, '/ ' + w.maxAmmo(w.current));
      el.wCur.classList.toggle('empty', st.ammo === 0);
      const xp = w.xpFrac(w.current);
      setW(el.wXp, xp * 100);
      setText(el.wLvl, st.level >= w.cap(w.current) ? 'MAX' : (w.isMega(w.current) ? 'MÉGA ' : 'NIV. ') + st.level);
    }
    // réticule
    this.hitT = Math.max(0, this.hitT - dt);
    el.cross.classList.toggle('hit', this.hitT > 0);
    el.cross.classList.toggle('aim', p.aimHeld);
    const co = p.state === 'normal' && g.state === 'playing' ? '1' : '0';
    if (el.cross._o !== co) { el.cross._o = co; el.cross.style.opacity = co; }
    // messages
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) el.toast.classList.remove('on'); }
    if (this.titleT > 0) { this.titleT -= dt; if (this.titleT <= 0) el.title.classList.remove('on'); }
    if (this.dialogCur) {
      this.dialogChars += dt * 55;
      const n = Math.min(this.dialogText.length, Math.floor(this.dialogChars));
      if (el.dText.textContent.length !== n) el.dText.textContent = this.dialogText.slice(0, n);
      this.dialogT -= dt;
      if (this.dialogT <= 0) this._nextDialog();
    }
    if (this.bossFrac !== undefined) {
      this.bossGhost = this.bossFrac > this.bossGhost ? this.bossFrac : damp(this.bossGhost, this.bossFrac, 2.5, dt);
      setW(el.bGhost, this.bossGhost * 100);
    }
    // roue
    if (this.wheelOpen && this.wheelItems && this.wheelItems.length) {
      const inp = g.input;
      this.wheelAcc.x = this.wheelAcc.x * 0.9 + inp.mouseDX + inp.padAxes.mx * 30;
      this.wheelAcc.y = this.wheelAcc.y * 0.9 + inp.mouseDY + inp.padAxes.my * 30;
      if (Math.hypot(this.wheelAcc.x, this.wheelAcc.y) > 25) {
        const a = Math.atan2(this.wheelAcc.y, this.wheelAcc.x) + Math.PI / 2;
        const n = this.wheelItems.length;
        const sel = ((Math.round((a / (Math.PI * 2)) * n) % n) + n) % n;
        if (sel !== this.wheelSel) { this.wheelSel = sel; this._wheelRefresh(); g.audio.play('uiMove'); }
      }
    }
    this._updateBubbles(dt);
    this._updateMarks();
    const cine = g.state === 'cutscene';
    if (this._cine !== cine) { this._cine = cine; this.root.classList.toggle('cine', cine); }
    const needLock = g.state === 'playing' && !g.input.locked && g.input.lastDevice !== 'pad';
    if (el.lock._on !== needLock) { el.lock._on = needLock; el.lock.classList.toggle('on', needLock); }
    if (g.cheats.fps) el.fps.textContent = Math.round(g.fps) + ' i/s';
  }
}
