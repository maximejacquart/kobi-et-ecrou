// Entrées : clavier (codes physiques, donc ZQSD en AZERTY = WASD en QWERTY), souris
// (pointer lock), manette. Expose des actions abstraites.
const BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  dash: ['ShiftLeft', 'ShiftRight'],
  melee: ['KeyF', 'KeyV', 'Mouse1'],
  fire: ['Mouse0'],
  aim: ['Mouse2'],
  interact: ['KeyE'],
  wheel: ['KeyQ', 'Tab'],
  swap: ['KeyR'],
  pause: ['Escape'],
  photo: ['KeyP'],
  map: ['KeyM'],
  w1: ['Digit1'], w2: ['Digit2'], w3: ['Digit3'], w4: ['Digit4'],
  w5: ['Digit5'], w6: ['Digit6'], w7: ['Digit7'], w8: ['Digit8'], w9: ['Digit9'], w10: ['Digit0'],
};
// Manette standard
const PAD = { jump: 0, dash: 1, melee: 2, interact: 3, swap: 4, wheel: 5, aim: 6, fire: 7, pause: 9, photo: 11 };

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressedSet = new Set();
    this.releasedSet = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheelDelta = 0;
    this.locked = false;
    this.enabled = true;
    this.sensitivity = 1;
    this.invertY = false;
    this.lastDevice = 'kb';
    this.padAxes = { mx: 0, my: 0, lx: 0, ly: 0 };
    this.layoutMap = null;
    this.wantLock = false;

    const down = (code) => {
      if (!this.keys.has(code)) this.pressedSet.add(code);
      this.keys.add(code);
    };
    const up = (code) => {
      if (this.keys.has(code)) this.releasedSet.add(code);
      this.keys.delete(code);
    };
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.repeat) return;
      this.lastDevice = 'kb';
      down(e.code);
    });
    window.addEventListener('keyup', (e) => up(e.code));
    window.addEventListener('blur', () => {
      for (const k of this.keys) this.releasedSet.add(k);
      this.keys.clear();
    });
    canvas.addEventListener('mousedown', (e) => {
      this.lastDevice = 'kb';
      // le clic qui reprend la souris ne doit pas aussi tirer
      if (this.wantLock && !this.locked) { this.lock(); return; }
      down('Mouse' + e.button);
    });
    window.addEventListener('mouseup', (e) => up('Mouse' + e.button));
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (this.locked) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    window.addEventListener('wheel', (e) => { this.wheelDelta += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    if (navigator.keyboard && navigator.keyboard.getLayoutMap) {
      navigator.keyboard.getLayoutMap().then((m) => { this.layoutMap = m; }).catch(() => {});
    }
  }
  lock() {
    if (this.locked) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { const q = this.canvas.requestPointerLock(); if (q && q.catch) q.catch(() => {}); } catch (e) { /* ignoré */ } });
    } catch (e) { /* ignoré */ }
  }
  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }
  // Libellé d'une touche selon la disposition du clavier
  keyLabel(code) {
    const names = { Space: 'Espace', ShiftLeft: 'Maj', Escape: 'Échap', Tab: 'Tab', Mouse0: 'Clic gauche', Mouse1: 'Clic molette', Mouse2: 'Clic droit' };
    if (names[code]) return names[code];
    if (code.startsWith('Digit')) return code.slice(5);
    if (this.layoutMap && this.layoutMap.get(code)) return this.layoutMap.get(code).toUpperCase();
    return code.replace('Key', '').replace('Digit', '');
  }
  actionLabel(action) {
    if (this.lastDevice === 'pad') {
      const padNames = { jump: 'A', dash: 'B', melee: 'X', interact: 'Y', swap: 'LB', wheel: 'RB', aim: 'LT', fire: 'RT', pause: 'Start', photo: 'R3' };
      return padNames[action] || action;
    }
    return this.keyLabel(BINDINGS[action][0]);
  }
  moveLabel() {
    return ['forward', 'left', 'back', 'right'].map((a) => this.keyLabel(BINDINGS[a][0])).join('');
  }
  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && Array.from(pads).find((p) => p && p.connected);
    if (!pad) {
      // manette débranchée : tout relâcher
      const a = this.padAxes;
      a.lx = a.ly = a.mx = a.my = 0;
      for (const code of [...this.keys]) if (code.startsWith('Pad')) { this.keys.delete(code); this.releasedSet.add(code); }
      return;
    }
    // zone morte radiale (les diagonales ne collent plus aux axes)
    const radial = (x, y) => {
      const l = Math.hypot(x, y);
      if (l < 0.15) return [0, 0];
      const k = Math.min(1, (l - 0.15) / 0.85) / l;
      return [x * k, y * k];
    };
    const ax = pad.axes;
    [this.padAxes.lx, this.padAxes.ly] = radial(ax[0] || 0, ax[1] || 0);
    const [rx, ry] = radial(ax[2] || 0, ax[3] || 0);
    this.padAxes.mx = rx * Math.abs(rx);
    this.padAxes.my = ry * Math.abs(ry);
    let any = Math.abs(this.padAxes.lx) + Math.abs(this.padAxes.ly) + Math.abs(rx) + Math.abs(ry) > 0;
    for (const [action, idx] of Object.entries(PAD)) {
      const b = pad.buttons[idx];
      const v = b && (b.pressed || b.value > 0.4);
      const code = 'Pad' + action;
      if (v) {
        any = true;
        if (!this.keys.has(code)) this.pressedSet.add(code);
        this.keys.add(code);
      } else if (this.keys.has(code)) {
        this.keys.delete(code);
        this.releasedSet.add(code);
      }
    }
    // croix directionnelle : choix d'arme
    // croix : 0 haut, 1 bas, 2 gauche, 3 droite
    const dpad = [12, 13, 14, 15];
    dpad.forEach((bi, k) => {
      const b = pad.buttons[bi];
      const code = 'PadD' + k;
      if (b && b.pressed) {
        any = true;
        if (!this.keys.has(code)) this.pressedSet.add(code);
        this.keys.add(code);
      } else if (this.keys.has(code)) { this.keys.delete(code); this.releasedSet.add(code); }
    });
    if (any) this.lastDevice = 'pad';
  }
  _codes(action) {
    const c = BINDINGS[action] || [];
    return PAD[action] !== undefined ? [...c, 'Pad' + action] : c;
  }
  down(action) {
    if (!this.enabled) return false;
    return this._codes(action).some((c) => this.keys.has(c));
  }
  pressed(action) {
    if (!this.enabled) return false;
    return this._codes(action).some((c) => this.pressedSet.has(c));
  }
  rawPressed(code) { return this.pressedSet.has(code); }
  moveVector() {
    if (!this.enabled) return { x: 0, y: 0 };
    let x = 0, y = 0;
    if (this.down('right')) x += 1;
    if (this.down('left')) x -= 1;
    if (this.down('forward')) y += 1;
    if (this.down('back')) y -= 1;
    x += this.padAxes.lx;
    y -= this.padAxes.ly;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }
  // Delta de visée (radians) depuis la souris + le stick droit
  lookDelta(dt) {
    const s = 0.0022 * this.sensitivity;
    let dx = this.mouseDX * s;
    let dy = this.mouseDY * s;
    dx += this.padAxes.mx * 3.2 * dt * this.sensitivity;
    dy += this.padAxes.my * 2.2 * dt * this.sensitivity;
    if (this.invertY) dy = -dy;
    return { dx, dy };
  }
  endFrame() {
    this.pressedSet.clear();
    this.releasedSet.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheelDelta = 0;
  }
}
