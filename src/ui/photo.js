// Mode photo : temps figé, interface masquée, caméra libre autour de Kobi (orbite et déplacement limités à RANGE
// mètres, sans traverser le décor), réglages de l'image (champ, inclinaison, mise au point, ouverture, exposition,
// filtres, vignette, grain, cadres), poses de Kobi, et capture PNG de l'image sans interface.
// Le flou de profondeur passe par R.dof (post-traitement) quand il existe ; le reste est une passe à part,
// ajoutée en fin de chaîne et active seulement dans ce mode.
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { clamp } from '../engine/util.js';
import { LEVELS } from '../levels/index.js';

const RANGE = 15; // éloignement maximal du point visé autour de Kobi (m)
const BLOCKS = (c) => c.blocksCamera;
const FILTERS = [
  ['aucun', 'Aucun'], ['chaud', 'Chaud'], ['froid', 'Froid'], ['nb', 'Noir et blanc'], ['sepia', 'Sépia'],
  ['retro', 'Rétro'], ['neon', 'Néon'], ['cinema', 'Cinéma'], ['vif', 'Vif'],
];
const FRAMES = [['aucun', 'Aucun'], ['cinema', 'Bandes cinéma'], ['carre', 'Carré'], ['polaroid', 'Polaroïd'], ['pellicule', 'Pellicule'], ['hublot', 'Hublot']];
const POSES = [['actuelle', 'Telle quelle'], ['repos', 'Repos'], ['victoire', 'Victoire'], ['visee', 'Visée'], ['course', 'Course'], ['saut', 'Saut'], ['plane', 'Plané'], ['cle', 'Coup de clé']];
const YESNO = [[true, 'Oui'], [false, 'Non']];
const DEFAULTS = {
  fov: 62, roll: 0, focusMode: 'auto', focus: 4, aperture: 0, exposure: 0, filter: 'aucun', filterAmt: 1,
  vignette: 0.3, grain: 0, frame: 'aucun', logo: false, pose: 'actuelle', look: false, kobi: true, ecrou: true,
};
const pct = (v) => Math.round(v * 100) + ' %';

// ------------------------------------------------------------------ passe d'image (après l'étalonnage du jeu)
const PhotoShader = {
  uniforms: {
    tDiffuse: { value: null },
    tFrame: { value: null },
    uExposure: { value: 1 },
    uFilter: { value: 0 },
    uFilterAmt: { value: 1 },
    uVignette: { value: 0 },
    uGrain: { value: 0 },
    uTime: { value: 0 },
    uFrameOn: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tFrame;
    uniform float uExposure, uFilterAmt, uVignette, uGrain, uTime, uFrameOn;
    uniform int uFilter;
    uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
    vec3 sat(vec3 c, float s) { return mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, s); }
    vec3 contrast(vec3 c, float k) { return (c - 0.5) * k + 0.5; }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // exposition, appliquée en linéaire (épaule douce au-dessus du blanc)
      vec3 L = pow(max(c, 0.0), vec3(2.2)) * uExposure;
      L = mix(L, 1.0 - exp(-L), smoothstep(0.7, 1.6, L));
      c = pow(L, vec3(1.0 / 2.2));
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      vec3 f = c;
      if (uFilter == 1) f = c * vec3(1.07, 1.0, 0.84) + vec3(0.025, 0.012, 0.0);
      else if (uFilter == 2) f = c * vec3(0.86, 0.97, 1.1) + vec3(0.0, 0.01, 0.03);
      else if (uFilter == 3) { float g = mix(l, l * l * (3.0 - 2.0 * l), 0.45); f = vec3(g); }
      else if (uFilter == 4) { float g = mix(l, l * l * (3.0 - 2.0 * l), 0.25); f = vec3(g) * vec3(1.08, 0.93, 0.72) + vec3(0.04, 0.025, 0.0); }
      else if (uFilter == 5) { f = sat(c, 0.62); f = mix(vec3(0.1, 0.075, 0.12), vec3(0.97, 0.9, 0.76), f); }
      else if (uFilter == 6) {
        // néon : ombres violettes, lumières cyan, couleurs poussées
        f = sat(c, 1.3);
        f = mix(f, f * vec3(0.85, 0.55, 1.25) + vec3(0.06, 0.0, 0.1), (1.0 - smoothstep(0.1, 0.55, l)) * 0.7);
        f = mix(f, f * vec3(0.85, 1.08, 1.15), smoothstep(0.45, 0.95, l) * 0.6);
        f = contrast(f, 1.1);
      }
      else if (uFilter == 7) {
        // cinéma : ombres sarcelle, hautes lumières orangées, contraste doux
        f = mix(c * vec3(0.9, 1.0, 1.08), c * vec3(1.06, 0.99, 0.9), smoothstep(0.2, 0.75, l));
        f = contrast(sat(f, 0.95), 1.08);
      }
      else if (uFilter == 8) { f = contrast(sat(c, 1.38), 1.08); }
      c = mix(c, max(f, 0.0), uFilterAmt);
      // vignette (ronde, quel que soit le format)
      vec2 q = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
      float v = 1.0 - smoothstep(0.25, 1.05, length(q) * 1.25);
      c *= mix(1.0, v, uVignette);
      // grain argentique, plus visible dans les tons moyens
      vec2 px = floor(vUv * uRes);
      float n = (hash(px + fract(uTime * 7.31) * 517.0) + hash(px * 1.37 + 91.0 + fract(uTime * 3.7) * 211.0)) - 1.0;
      c += n * uGrain * 0.11 * (0.35 + 0.65 * (1.0 - abs(l * 2.0 - 1.0)));
      // cadre dessiné dans un canevas (bandes, polaroïd, pellicule, hublot, signature)
      if (uFrameOn > 0.5) { vec4 fr = texture2D(tFrame, vUv); c = mix(c, fr.rgb, fr.a); }
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
};

// ------------------------------------------------------------------ cadres
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function drawFrame(cv, kind, logo, caption) {
  const ctx = cv.getContext('2d');
  const w = cv.width, h = cv.height, u = h / 100;
  ctx.clearRect(0, 0, w, h);
  const ink = '#07040d';
  if (kind === 'cinema') {
    const bar = Math.max(0, (h - w / 2.39) / 2);
    ctx.fillStyle = ink;
    ctx.fillRect(0, 0, w, bar);
    ctx.fillRect(0, h - bar, w, bar);
  } else if (kind === 'carre') {
    const bar = Math.max(0, (w - h) / 2);
    ctx.fillStyle = ink;
    ctx.fillRect(0, 0, bar, h);
    ctx.fillRect(w - bar, 0, bar, h);
  } else if (kind === 'polaroid') {
    const s = 4 * u, b = 15 * u;
    ctx.fillStyle = '#f5efe2';
    ctx.fillRect(0, 0, w, s); ctx.fillRect(0, 0, s, h); ctx.fillRect(w - s, 0, s, h); ctx.fillRect(0, h - b, w, b);
    // ombre intérieure de la photo
    ctx.strokeStyle = 'rgba(40, 30, 50, 0.35)';
    ctx.lineWidth = 0.35 * u;
    ctx.strokeRect(s, s, w - 2 * s, h - s - b);
    ctx.fillStyle = '#3a3048';
    ctx.font = `${5.2 * u}px "Boulonnerie", sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(caption.title, s + 1.5 * u, h - b / 2 - 1.5 * u);
    ctx.font = `${2.8 * u}px "Boulonnerie Texte", sans-serif`;
    ctx.fillStyle = '#6a5d78';
    ctx.fillText(caption.sub, s + 1.6 * u, h - b / 2 + 3.6 * u);
  } else if (kind === 'pellicule') {
    const band = 9 * u;
    ctx.fillStyle = '#120d0a';
    ctx.fillRect(0, 0, w, band);
    ctx.fillRect(0, h - band, w, band);
    // perforations
    ctx.fillStyle = 'rgba(255, 244, 220, 0.9)';
    const pw = 2.4 * u, ph = 3.4 * u, gap = 6 * u;
    for (let x = gap * 0.4; x < w; x += gap) {
      roundRect(ctx, x, (band - ph) / 2 + 0.6 * u, pw, ph, 0.6 * u); ctx.fill();
      roundRect(ctx, x, h - band + (band - ph) / 2 - 0.6 * u, pw, ph, 0.6 * u); ctx.fill();
    }
    ctx.fillStyle = '#ff9a2a';
    ctx.font = `${2.1 * u}px "Boulonnerie", sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText('KOBI 400  ▸  12A', gap * 2, band - 1.1 * u);
    ctx.fillText('ÉCROU-COLOR', w - gap * 6, h - band + 1.2 * u);
  } else if (kind === 'hublot') {
    const cx = w / 2, cy = h / 2, R = 45 * u;
    const g = ctx.createRadialGradient(cx, cy, R, cx, cy, R * 1.6);
    g.addColorStop(0, '#2a2438');
    g.addColorStop(1, '#0d0a14');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.arc(cx, cy, R + 4.5 * u, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    // bague métallique et rivets
    const ring = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    ring.addColorStop(0, '#e8eef8'); ring.addColorStop(0.45, '#7d879c'); ring.addColorStop(1, '#3a3f52');
    ctx.strokeStyle = ring;
    ctx.lineWidth = 4.5 * u;
    ctx.beginPath(); ctx.arc(cx, cy, R + 2.25 * u, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 0.5 * u;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const x = cx + Math.cos(a) * (R + 2.25 * u), y = cy + Math.sin(a) * (R + 2.25 * u);
      ctx.fillStyle = '#c9d2e3';
      ctx.beginPath(); ctx.arc(x, y, 0.9 * u, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(10, 6, 20, 0.6)';
      ctx.beginPath(); ctx.arc(x + 0.25 * u, y + 0.3 * u, 0.5 * u, 0, Math.PI * 2); ctx.fill();
    }
  }
  if (logo) {
    const size = 3.6 * u;
    ctx.font = `${size}px "Boulonnerie", sans-serif`;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'right';
    const inset = kind === 'polaroid' ? 4 * u + 2 * u : kind === 'pellicule' ? 3 * u : 3 * u;
    const by = kind === 'polaroid' ? h - 7 * u : kind === 'pellicule' ? h - 11 * u : kind === 'cinema' ? h - Math.max(0, (h - w / 2.39) / 2) - 2.5 * u : h - 3 * u;
    const bx = kind === 'carre' ? w - Math.max(0, (w - h) / 2) - 2.5 * u : w - inset;
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * 0.22;
    ctx.strokeStyle = 'rgba(26, 16, 40, 0.9)';
    ctx.strokeText('KOBI & ÉCROU', bx, by);
    ctx.fillStyle = '#ffd23a';
    ctx.fillText('KOBI & ÉCROU', bx, by);
    ctx.textAlign = 'left';
  }
}

// ------------------------------------------------------------------ mode photo
const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _size = new THREE.Vector2();

export class PhotoMode {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.s = { ...DEFAULTS };
    this.pivot = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.dist = 3;
    this.sel = 0;
    this.drag = null;
    this.rep = null;
    const R = game.R;
    this.pass = new ShaderPass(PhotoShader);
    this.pass.name = 'photo';
    this.pass.enabled = false;
    // en toute fin de chaîne, après l'étalonnage du jeu (aucune passe ne s'appelle « fin »)
    R.addPost(this.pass, 'fin');
    this.u = this.pass.uniforms;
    this.frameCanvas = document.createElement('canvas');
    this.frameCanvas.width = this.frameCanvas.height = 4;
    this.frameTex = new THREE.CanvasTexture(this.frameCanvas);
    this.frameTex.generateMipmaps = false;
    this.frameTex.minFilter = THREE.LinearFilter;
    this.u.tFrame.value = this.frameTex;
    this._frameKey = '';
    this._buildUI();
    this._bindPointer();
  }

  // --------------------------------------------------------------- entrée / sortie
  canEnter() {
    const st = this.game.state;
    return !this.active && this.game.level && (st === 'playing' || st === 'paused');
  }
  enter(from = this.game.state) {
    if (!this.canEnter()) return;
    const g = this.game, p = g.player, cam = g.R.camera;
    this.active = true;
    this.from = from;
    g.state = 'photo';
    g.pausedAt = g.realTime;
    this._wantLock = g.input.wantLock;
    g.input.wantLock = false;
    g.input.unlock();
    g.audio.stopAllLoops();
    g.menus.hideAll();
    g.hud.wheel(false);
    g.hud.show(false);
    // état à restaurer en sortant
    this.saved = { fov: cam.fov, pos: cam.position.clone(), quat: cam.quaternion.clone(), rootVisible: p.root.visible };
    p.root.visible = true;
    this._snapRig();
    // orbite initiale : depuis la caméra du jeu, autour de Kobi
    this.kobiCenter = new THREE.Vector3().copy(p.pos).setY(p.pos.y + 0.75);
    this.pivot.copy(this.kobiCenter);
    _d.subVectors(cam.position, this.pivot);
    this.dist = clamp(_d.length(), 0.6, 10);
    _d.normalize().negate();
    this.yaw = Math.atan2(_d.x, _d.z);
    this.pitch = Math.asin(clamp(_d.y, -1, 1));
    this.start = { pivot: this.pivot.clone(), yaw: this.yaw, pitch: this.pitch, dist: this.dist };
    this.s = { ...DEFAULTS, fov: Math.round(cam.fov) };
    this.sel = 0;
    this._dofKey = '';
    // la mise en scène automatique de l'objectif (post-traitement) s'efface tant que le mode photo est ouvert
    if (g.R.dof) g.R.dof.manual = true;
    this.pass.enabled = true;
    this.root.classList.add('on');
    this.root.classList.remove('hide');
    g.R.renderer.domElement.classList.add('ph-grab');
    this._render();
    this._applyScene();
    this._refresh();
    g.audio.play('uiSelect');
  }
  exit() {
    if (!this.active) return;
    const g = this.game, cam = g.R.camera, p = g.player;
    this.active = false;
    this.drag = null;
    this.pass.enabled = false;
    this.root.classList.remove('on');
    g.R.renderer.domElement.classList.remove('ph-grab', 'ph-grabbing');
    // tout revient comme avant : pose, visibilités, caméra, flou
    this._restoreRig();
    this._restoreVisibility();
    p.root.visible = this.saved.rootVisible;
    cam.fov = this.saved.fov;
    cam.position.copy(this.saved.pos);
    cam.quaternion.copy(this.saved.quat);
    cam.updateProjectionMatrix();
    const dof = g.R.dof;
    if (dof) { if (dof.off) dof.off(0.25); dof.manual = false; }
    g.input.wantLock = this._wantLock;
    // la touche qui a fermé le mode ne doit pas aussi agir sur le menu de pause (même image)
    g.input.pressedSet.clear();
    g.audio.play('uiMove');
    if (this.from === 'paused') {
      g.state = 'paused';
      g.pausedAt = g.realTime;
      g.menus.showPause();
    } else {
      g.state = 'playing';
      g._menuClosedAt = g.realTime;
      g.hud.show(true);
      g.input.lock();
      g._restoreLoops();
    }
  }

  // --------------------------------------------------------------- pose et visibilités
  _snapRig() {
    const rig = this.game.player.rig, a = rig.anim;
    const objs = [];
    rig.root.traverse((o) => objs.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone(), o.visible]));
    const fields = {};
    for (const k of Object.keys(a)) if (typeof a[k] !== 'object' || a[k] === null) fields[k] = a[k];
    this.snap = {
      objs, fields,
      springs: new Map([...a.springs].map(([k, v]) => [k, { ...v }])),
      ears: rig.ears.map((e) => ({ vel: e.vel, off: e.off, velX: e.velX, offX: e.offX })),
      blob: this.game.player.blob.visible,
    };
    this.headBase = rig.head.quaternion.clone();
  }
  _restoreRig() {
    const rig = this.game.player.rig, a = rig.anim, sn = this.snap;
    for (const [o, p, q, s] of sn.objs) { o.position.copy(p); o.quaternion.copy(q); o.scale.copy(s); }
    Object.assign(a, sn.fields);
    a.springs = new Map([...sn.springs].map(([k, v]) => [k, { ...v }]));
    rig.ears.forEach((e, i) => Object.assign(e, sn.ears[i]));
    if (rig.fur) rig.fur.reset();
    this.headBase = rig.head.quaternion.clone();
  }
  _restoreVisibility() {
    for (const [o, , , , vis] of this.snap.objs) o.visible = vis;
    this.game.player.blob.visible = this.snap.blob;
  }
  _pose(name) {
    const g = this.game, rig = g.player.rig, a = rig.anim;
    this._restoreRig();
    if (name !== 'actuelle') {
      const st = { speed: 0, grounded: true, vy: 0, gliding: false, aiming: false, twoHanded: false, aimPitch: 0, jets: 0, yaw: g.player.visYaw, hipYaw: 0 };
      const step = (n) => { for (let i = 0; i < n; i++) a.update(1 / 60, st); };
      a.blink = 5; // pas de clignement pendant la pose
      a.meleeT = 0; a.flip = 0; a.sideFlip = 0; a.dashT = 0; a.hurtT = 0; a.landT = 0; a.longT = 0;
      if (name === 'victoire') st.victory = true;
      else if (name === 'visee') { st.aiming = true; st.twoHanded = !!(g.weapons && g.weapons.twoHanded && g.weapons.twoHanded()); }
      else if (name === 'saut') { st.grounded = false; st.vy = 6; }
      else if (name === 'plane') { st.grounded = false; st.gliding = true; st.vy = -2; st.jets = 0.3; st.speed = 6; }
      if (name === 'course') {
        // grande foulée : on attend que la jambe avant soit tendue
        st.speed = 9;
        step(40);
        for (let i = 0; i < 40 && Math.sin(a.phase - 0.35) < 0.96; i++) step(1);
      } else if (name === 'cle') {
        step(40);
        a.doMelee(0);
        step(9);
      } else step(70);
      a.blink = 5;
      if (rig.fur) rig.fur.reset();
    }
    this.headBase = rig.head.quaternion.clone();
  }
  _applyScene() {
    const g = this.game, p = g.player, s = this.s;
    const ecrou = p.rig.ecrou.root;
    this._restoreVisibility();
    p.root.visible = true;
    if (!s.kobi) {
      // Kobi masqué, Écrou éventuellement visible (il reste accroché à son dos)
      p.root.traverse((o) => {
        if (!(o.isMesh || o.isLine || o.isPoints)) return;
        for (let x = o; x; x = x.parent) if (x === ecrou) return;
        o.visible = false;
      });
      p.blob.visible = false;
    }
    if (!s.ecrou) ecrou.visible = false;
  }

  // --------------------------------------------------------------- interface
  _rows() {
    // réglages courants (this.s est remplacé à chaque entrée dans le mode)
    const s = new Proxy({}, { get: (t, k) => this.s[k] });
    return [
      { sec: 'Objectif' },
      { id: 'fov', label: 'Champ de vision', type: 'range', min: 20, max: 100, step: 1, fmt: (v) => v + '°' },
      { id: 'roll', label: 'Inclinaison', type: 'range', min: -45, max: 45, step: 1, fmt: (v) => v + '°' },
      { id: 'focusMode', label: 'Mise au point', type: 'choice', options: [['auto', 'Auto (Kobi)'], ['manuel', 'Manuelle']] },
      { id: 'focus', label: 'Distance (manuelle)', type: 'range', min: 0.3, max: 30, step: 0.1, fmt: (v) => v.toFixed(1) + ' m', off: () => s.focusMode === 'auto' },
      { id: 'aperture', label: 'Ouverture (flou)', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
      { sec: 'Image' },
      { id: 'exposure', label: 'Exposition', type: 'range', min: -2, max: 2, step: 0.1, fmt: (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + ' IL' },
      { id: 'filter', label: 'Filtre', type: 'choice', options: FILTERS },
      { id: 'filterAmt', label: 'Intensité du filtre', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct, off: () => s.filter === 'aucun' },
      { id: 'vignette', label: 'Vignette', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
      { id: 'grain', label: 'Grain', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
      { id: 'frame', label: 'Cadre', type: 'choice', options: FRAMES },
      { id: 'logo', label: 'Signature', type: 'choice', options: YESNO },
      { sec: 'Scène' },
      { id: 'pose', label: 'Pose de Kobi', type: 'choice', options: POSES, off: () => !s.kobi },
      { id: 'look', label: 'Regarder l’objectif', type: 'choice', options: YESNO, off: () => !s.kobi },
      { id: 'kobi', label: 'Kobi', type: 'choice', options: [[true, 'Visible'], [false, 'Masqué']] },
      { id: 'ecrou', label: 'Écrou', type: 'choice', options: [[true, 'Visible'], [false, 'Masqué']] },
      { id: 'capture', label: 'Capturer', type: 'button', main: true },
      { id: 'reset', label: 'Réinitialiser', type: 'button' },
      { id: 'quit', label: 'Quitter', type: 'button' },
    ];
  }
  _buildUI() {
    const root = (this.root = document.createElement('div'));
    root.id = 'photo';
    this.rows = this._rows();
    const ctl = this.rows.filter((r) => r.id);
    this.ctl = ctl;
    const rowHTML = (r) => {
      if (r.sec) return `<div class="ph-sec">${r.sec}</div>`;
      const i = ctl.indexOf(r);
      if (r.type === 'range') return `<div class="ph-row" data-i="${i}"><span class="ph-l">${r.label}</span><input type="range" min="${r.min}" max="${r.max}" step="${r.step}"><span class="ph-v"></span></div>`;
      if (r.type === 'choice') return `<div class="ph-row" data-i="${i}"><span class="ph-l">${r.label}</span><span class="ph-choice"><i class="ph-arr l" data-d="-1"></i><span class="ph-v"></span><i class="ph-arr r" data-d="1"></i></span></div>`;
      return '';
    };
    const buttons = ctl.filter((r) => r.type === 'button').map((r) => `<button class="btn small ${r.main ? '' : 'ghost'} ph-btn" data-i="${ctl.indexOf(r)}"><span>${r.label}</span></button>`).join('');
    root.innerHTML = `
      <div class="ph-flash"></div>
      <div class="ph-panel"><div class="ph-title">Mode photo<small class="ph-sub"></small></div>
        ${this.rows.filter((r) => r.type !== 'button').map(rowHTML).join('')}
        <div class="ph-btns">${buttons}</div>
      </div>
      <div class="ph-help"></div>
      <div class="ph-hint"></div>
      <div class="ph-toast"></div>`;
    document.body.appendChild(root);
    this.els = [...root.querySelectorAll('[data-i]')].sort((a, b) => a.dataset.i - b.dataset.i);
    for (const el of this.els) {
      const i = +el.dataset.i, r = ctl[i];
      el.addEventListener('mouseenter', () => { this.sel = i; this._refresh(); });
      if (r.type === 'range') {
        const inp = el.querySelector('input');
        inp.addEventListener('input', () => this._set(r, parseFloat(inp.value)));
        // le curseur rend la main au clavier (sinon les flèches le feraient bouger deux fois)
        inp.addEventListener('change', () => inp.blur());
      } else if (r.type === 'choice') {
        el.querySelectorAll('.ph-arr').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); this._nudge(r, +b.dataset.d); }));
        el.addEventListener('click', () => this._nudge(r, 1));
      } else {
        el.addEventListener('click', () => { el.blur(); this._activate(r); });
      }
    }
    this.flash = root.querySelector('.ph-flash');
    this.help = root.querySelector('.ph-help');
    this.hint = root.querySelector('.ph-hint');
    this.toastEl = root.querySelector('.ph-toast');
    this.sub = root.querySelector('.ph-sub');
  }
  _refresh() {
    const s = this.s;
    this.ctl.forEach((r, i) => {
      const el = this.els[i];
      el.classList.toggle('sel', i === this.sel);
      el.classList.toggle('off', !!(r.off && r.off()));
      if (r.type === 'range') {
        const inp = el.querySelector('input');
        if (document.activeElement !== inp) inp.value = s[r.id];
        el.querySelector('.ph-v').textContent = r.fmt(s[r.id]);
      } else if (r.type === 'choice') {
        const o = r.options.find((x) => x[0] === s[r.id]);
        el.querySelector('.ph-v').textContent = o ? o[1] : '';
      }
    });
    this._refreshHelp(true);
  }
  _refreshHelp(force) {
    const inp = this.game.input;
    const dev = inp.lastDevice;
    if (!force && dev === this._helpDev) return;
    this._helpDev = dev;
    const k = (c) => `<b>${inp.keyLabel(c)}</b>`;
    this.help.innerHTML = dev === 'pad'
      ? '<b>Stick gauche</b> : déplacer · <b>stick droit</b> : tourner · <b>LB / RB</b> : distance · <b>LT / RT</b> : descendre, monter<br><b>Croix</b> : réglages · <b>A</b> : valider · <b>X</b> : capturer · <b>Y</b> : masquer · <b>B</b> : quitter'
      : `<b>Souris</b> : glisser pour tourner · clic droit : déplacer · molette : distance<br><b>${inp.moveLabel()}</b> : déplacer · ${k('Space')} / ${k('ShiftLeft')} : monter, descendre<br><b>Flèches</b> : réglages · ${k('KeyC')} : capturer · ${k('KeyH')} : masquer · ${k('Escape')} : quitter`;
    this.hint.innerHTML = dev === 'pad' ? '<b>Y</b> : réglages' : `${k('KeyH')} : réglages`;
    this.sub.textContent = dev === 'pad' ? 'Croix : choisir' : 'Flèches : choisir';
  }
  _set(r, v) {
    if (r.off && r.off()) { this._refresh(); return; }
    const s = this.s;
    if (r.type === 'range') v = clamp(Math.round(v / r.step) * r.step, r.min, r.max);
    if (s[r.id] === v) return;
    s[r.id] = r.type === 'range' ? +v.toFixed(3) : v;
    if (r.id === 'pose') this._pose(v);
    if (r.id === 'kobi' || r.id === 'ecrou') this._applyScene();
    if (r.id === 'look' && !v) this.game.player.rig.head.quaternion.copy(this.headBase);
    if (r.id === 'focusMode' && v === 'manuel') s.focus = +this._kobiDist().toFixed(1);
    this._refresh();
  }
  _nudge(r, d) {
    if (r.type === 'range') this._set(r, this.s[r.id] + d * r.step);
    else if (r.type === 'choice') {
      const i = r.options.findIndex((o) => o[0] === this.s[r.id]);
      this._set(r, r.options[(i + d + r.options.length) % r.options.length][0]);
      this.game.audio.play('uiMove');
    } else if (d > 0) this._activate(r);
  }
  _activate(r) {
    if (r.type === 'choice') { this._nudge(r, 1); return; }
    if (r.id === 'capture') this.capture();
    else if (r.id === 'reset') {
      this.s = { ...DEFAULTS, fov: Math.round(this.saved.fov) };
      this.pivot.copy(this.start.pivot);
      this.yaw = this.start.yaw; this.pitch = this.start.pitch; this.dist = this.start.dist;
      this._pose('actuelle');
      this._applyScene();
      this._refresh();
      this.game.audio.play('uiSelect');
    } else if (r.id === 'quit') this.exit();
  }
  _toggleUI() {
    this.root.classList.toggle('hide');
    this.game.audio.play('uiMove');
  }
  _toast(text) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('on');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.toastEl.classList.remove('on'), 2200);
  }

  // --------------------------------------------------------------- souris : orbite, déplacement, distance
  _bindPointer() {
    const cv = this.game.R.renderer.domElement;
    cv.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      this.drag = { x: e.clientX, y: e.clientY, pan: e.button !== 0 };
      cv.setPointerCapture(e.pointerId);
      cv.classList.add('ph-grabbing');
    });
    cv.addEventListener('pointermove', (e) => {
      if (!this.active || !this.drag) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX; this.drag.y = e.clientY;
      const k = this.game.input.sensitivity || 1;
      if (this.drag.pan) {
        // déplacement dans le plan de l'image, proportionnel à la distance
        const sp = 0.0016 * Math.max(0.6, this.dist);
        this._movePivot(_r.copy(this.right).multiplyScalar(-dx * sp).addScaledVector(this.up, dy * sp));
      } else {
        this.yaw -= dx * 0.005 * k;
        this.pitch = clamp(this.pitch - dy * 0.005 * k * (this.game.input.invertY ? -1 : 1), -1.45, 1.45);
      }
    });
    const up = (e) => {
      if (!this.drag) return;
      this.drag = null;
      cv.classList.remove('ph-grabbing');
      if (cv.hasPointerCapture(e.pointerId)) cv.releasePointerCapture(e.pointerId);
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => {
      if (!this.active) return;
      this.dist = clamp(this.dist * Math.pow(1.1, Math.sign(e.deltaY)), 0.4, 12);
    }, { passive: true });
  }

  // --------------------------------------------------------------- caméra
  _movePivot(delta) {
    const g = this.game;
    const len = delta.length();
    if (len < 1e-5) return;
    _d.copy(delta).divideScalar(len);
    // le point visé ne traverse pas le décor
    const hit = g.world.raycast(this.pivot, _d, len + 0.3, BLOCKS);
    const t = hit ? Math.max(0, hit.t - 0.3) : len;
    this.pivot.addScaledVector(_d, Math.min(t, len));
    // et reste à portée de Kobi, au-dessus du sol
    _v.subVectors(this.pivot, this.kobiCenter);
    if (_v.length() > RANGE) this.pivot.copy(this.kobiCenter).addScaledVector(_v.normalize(), RANGE);
    const gh = g.world.groundBelow(this.pivot.x, this.pivot.y + 1, this.pivot.z, 60);
    if (gh && this.pivot.y < gh.point.y + 0.15) this.pivot.y = gh.point.y + 0.15;
  }
  _kobiDist() { return this.game.R.camera.position.distanceTo(this.kobiCenter); }
  _camera(dt) {
    const g = this.game, cam = g.R.camera, s = this.s;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    _f.set(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp);
    // la caméra recule depuis le point visé, sans passer à travers les murs ni sous le sol
    _d.copy(_f).negate();
    const hit = g.world.raycast(this.pivot, _d, this.dist + 0.25, BLOCKS);
    const d = hit ? Math.max(0.15, hit.t - 0.25) : this.dist;
    cam.position.copy(this.pivot).addScaledVector(_d, d);
    const gh = g.world.groundBelow(cam.position.x, Math.min(cam.position.y + 0.5, this.pivot.y), cam.position.z, 6);
    if (gh && cam.position.y < gh.point.y + 0.12) cam.position.y = gh.point.y + 0.12;
    cam.up.set(0, 1, 0);
    cam.lookAt(_v.copy(this.pivot).addScaledVector(_f, 5));
    cam.rotateZ(-s.roll * Math.PI / 180);
    cam.fov = s.fov;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.right = (this.right || new THREE.Vector3()).setFromMatrixColumn(cam.matrixWorld, 0);
    this.up = (this.up || new THREE.Vector3()).setFromMatrixColumn(cam.matrixWorld, 1);
    void dt;
  }
  // tête de Kobi tournée vers l'objectif
  _look() {
    const rig = this.game.player.rig, head = rig.head;
    head.quaternion.copy(this.headBase);
    if (!this.s.look || !this.s.kobi) return;
    const neck = head.parent;
    neck.updateWorldMatrix(true, false);
    neck.worldToLocal(_v.copy(this.game.R.camera.position)).sub(head.position);
    const yaw = clamp(Math.atan2(_v.x, _v.z), -1.0, 1.0);
    const pitch = clamp(-Math.atan2(_v.y - 0.17, Math.hypot(_v.x, _v.z)), -0.55, 0.45);
    head.rotation.set(pitch, yaw, 0);
  }
  // flou de profondeur (R.dof du post-traitement), appelé seulement quand les réglages changent.
  // R.dof.set({ focus (m, ou point du monde suivi), range (m), aperture (% de la hauteur d'image), near, far }, t)
  _dof() {
    const R = this.game.R, s = this.s, dof = R.dof;
    if (!dof) return;
    const auto = s.focusMode === 'auto';
    const key = s.aperture > 0 ? [auto ? 'auto' : s.focus, s.aperture].join() : 'off';
    if (key === this._dofKey) return;
    const was = this._dofKey;
    this._dofKey = key;
    if (s.aperture <= 0) { if (was && was !== 'off' && dof.off) dof.off(0.2); return; }
    const dist = auto ? this._kobiDist() : s.focus;
    // plage nette qui se resserre quand on ouvre ; flou maximal de 3 % de la hauteur d'image
    const range = Math.max(0.12, dist * (0.3 - 0.24 * s.aperture));
    if (dof.set) dof.set({ focus: auto ? this.kobiCenter : s.focus, range, aperture: s.aperture * 3, near: 1, far: 1 }, 0.15);
  }
  _render() {
    const g = this.game, s = this.s, u = this.u;
    const size = g.R.renderer.getDrawingBufferSize(_size);
    u.uRes.value.copy(size);
    u.uExposure.value = Math.pow(2, s.exposure);
    u.uFilter.value = FILTERS.findIndex((f) => f[0] === s.filter);
    u.uFilterAmt.value = s.filterAmt;
    u.uVignette.value = s.vignette;
    u.uGrain.value = s.grain;
    u.uTime.value = g.realTime;
    // canevas du cadre : redessiné quand le cadre, la signature ou la taille changent
    const on = s.frame !== 'aucun' || s.logo;
    u.uFrameOn.value = on ? 1 : 0;
    const key = [s.frame, s.logo, size.x, size.y].join();
    if (on && key !== this._frameKey) {
      this._frameKey = key;
      const cv = this.frameCanvas;
      const k = Math.min(1, 4096 / Math.max(size.x, size.y));
      cv.width = Math.round(size.x * k); cv.height = Math.round(size.y * k);
      const L = g.level && LEVELS[g.level.id];
      const date = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
      drawFrame(cv, s.frame, s.logo, { title: L ? L.name : 'Kobi & Écrou', sub: (L ? L.subtitle + ' · ' : '') + date });
      this.frameTex.dispose();
      this.frameTex.needsUpdate = true;
    }
  }

  // --------------------------------------------------------------- capture
  capture() {
    const g = this.game, R = g.R;
    this._render();
    // rendu et lecture dans la même tâche : l'image est intacte, sans l'interface (qui n'est pas dans le canevas)
    R.render(g.realTime);
    const L = g.level && LEVELS[g.level.id];
    const d = new Date(), two = (n) => String(n).padStart(2, '0');
    const name = `kobi-${(L ? L.name : 'photo').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')}-${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}.png`;
    R.renderer.domElement.toBlob((blob) => {
      if (!blob) { this._toast('Capture impossible'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      this._toast('Photo enregistrée : ' + name);
    }, 'image/png');
    this.flash.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => this.flash.classList.remove('on')));
    g.audio.play('uiSelect', { pitch: 1.6 });
  }

  // --------------------------------------------------------------- image par image (temps du jeu figé)
  update(dt) {
    const g = this.game, inp = g.input;
    this._refreshHelp(false);
    if (inp.pressed('pause') || inp.pressed('photo') || inp.rawPressed('Backspace') || inp.rawPressed('Paddash')) { this.exit(); return; }
    if (inp.rawPressed('KeyH') || inp.rawPressed('Padinteract')) this._toggleUI();
    if (inp.rawPressed('KeyC') || inp.rawPressed('Padmelee')) this.capture();
    // réglages : flèches / croix (maintien = répétition), Entrée / A
    const hidden = this.root.classList.contains('hide');
    if (!hidden) {
      const n = this.ctl.length;
      if (inp.rawPressed('ArrowDown') || inp.rawPressed('PadD1')) { this.sel = (this.sel + 1) % n; this._refresh(); g.audio.play('uiMove'); }
      if (inp.rawPressed('ArrowUp') || inp.rawPressed('PadD0')) { this.sel = (this.sel - 1 + n) % n; this._refresh(); g.audio.play('uiMove'); }
      const r = this.ctl[this.sel];
      const pl = inp.rawPressed('ArrowLeft') || inp.rawPressed('PadD2'), pr = inp.rawPressed('ArrowRight') || inp.rawPressed('PadD3');
      const held = inp.keys.has('ArrowLeft') || inp.keys.has('PadD2') || inp.keys.has('ArrowRight') || inp.keys.has('PadD3');
      if (pl || pr) {
        this.rep = { t: 0.35, dir: pr ? 1 : -1 };
        if (r.type !== 'button') this._nudge(r, this.rep.dir);
      } else if (held && this.rep && r.type === 'range') {
        this.rep.t -= dt;
        if (this.rep.t <= 0) { this.rep.t = 0.045; this._nudge(r, this.rep.dir); }
      } else if (!held) this.rep = null;
      if (inp.rawPressed('Enter') || inp.rawPressed('Padjump')) this._activate(r);
    }
    // déplacement : ZQSD / stick gauche (les flèches servent aux réglages), montée Espace / RT, descente Maj / LT ;
    // orbite au stick droit
    const key = (c) => (inp.keys.has(c) ? 1 : 0);
    const mv = { x: key('KeyD') - key('KeyA') + inp.padAxes.lx, y: key('KeyW') - key('KeyS') - inp.padAxes.ly };
    let vy = 0;
    if (inp.keys.has('Space') || inp.keys.has('Padfire')) vy += 1;
    if (inp.keys.has('ShiftLeft') || inp.keys.has('ShiftRight') || inp.keys.has('Padaim')) vy -= 1;
    const speed = (1.4 + this.dist * 0.5) * dt;
    if (mv.x || mv.y || vy) {
      _r.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar(-mv.x);
      _r.x += Math.sin(this.yaw) * mv.y; _r.z += Math.cos(this.yaw) * mv.y;
      _r.y = vy;
      this._movePivot(_r.multiplyScalar(speed));
    }
    const pa = inp.padAxes;
    if (pa.mx || pa.my) {
      this.yaw -= pa.mx * 2.4 * dt * inp.sensitivity;
      this.pitch = clamp(this.pitch - pa.my * 1.8 * dt * inp.sensitivity * (inp.invertY ? -1 : 1), -1.45, 1.45);
    }
    if (inp.keys.has('Padswap')) this.dist = clamp(this.dist * (1 + 1.4 * dt), 0.4, 12);
    if (inp.keys.has('Padwheel')) this.dist = clamp(this.dist * (1 - 1.4 * dt), 0.4, 12);
    this._camera(dt);
    this._look();
    this._dof();
    this._render();
  }
}
