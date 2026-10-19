// Bac à sable des effets : chaque effet se déclenche au clic, au clavier ou en boucle, pour itérer sans jouer.
// Adresse : dev/fx.html?effet=explosion&boucle=1.6&q=ultra&planete=desert&cam=moyen&ambiance=1
//   effet     : nom d'un effet (liste des boutons) ; boucle : période de répétition (s)
//   q         : ultra | haute | moyenne ; planete : desert | neige | foret | station | ciel ; cam : pres | moyen | loin
//   ambiance  : 1 pour afficher les particules d'ambiance de la planète
// Console : __fire('explosion'), __fx (système d'effets), __R (rendu).
import * as THREE from 'three';
import { Renderer } from '../src/engine/render.js';
import { frameU, allLayers, LAYERS } from '../src/engine/frame.js';
import { globalU, mat } from '../src/engine/materials.js';
import { sandTexture, snowTexture, metalTexture, mossTexture } from '../src/engine/textures.js';
import { FX } from '../src/engine/fx.js';
import { motes } from '../src/models/nature.js';

const P = new URLSearchParams(location.search);
const PLANETS = {
  desert: { id: 'brikka', top: '#3a5fb0', hor: '#ffb47a', sun: [0.45, 0.5, -0.74], sunC: '#ffd9a0', sunI: 2.9, fog: '#f0a878', fogN: 70, fogF: 520, hs: '#9fc4ff', hg: '#c87850', hi: 0.85, dust: '#e8c49a', ground: 'sand', surface: 'sand', exposure: 1.05 },
  neige: { id: 'givrelune', top: '#1d3878', hor: '#bcd6f2', sun: [0.5, 0.4, -0.77], sunC: '#ffe6cc', sunI: 2.5, fog: '#c4d8f0', fogN: 60, fogF: 480, hs: '#cfe2ff', hg: '#8a9ec8', hi: 0.85, dust: '#eef4ff', ground: 'snow', surface: 'snow', exposure: 0.9 },
  foret: { id: 'luminbois', top: '#040820', hor: '#14405a', sun: [-0.3, 0.6, -0.74], sunC: '#a8d4ff', sunI: 1.7, fog: '#0c2a36', fogN: 30, fogF: 270, hs: '#3a78a0', hg: '#1a4a3a', hi: 1.1, dust: '#5a8a6a', ground: 'moss', surface: 'grass', exposure: 1.15 },
  station: { id: 'station', top: '#06051a', hor: '#2c1450', sun: [-0.45, 0.42, -0.79], sunC: '#dfe8ff', sunI: 2.6, fog: '#1e1036', fogN: 120, fogF: 760, hs: '#8a90ff', hg: '#401a50', hi: 0.8, dust: '#9a90b0', ground: 'metal', surface: 'metal', exposure: 1.0 },
  ciel: { id: 'nimbara', top: '#4f74e0', hor: '#ffd3ea', sun: [0.45, 0.6, -0.66], sunC: '#fff2dc', sunI: 2.7, fog: '#e2bce8', fogN: 150, fogF: 880, hs: '#cfe0ff', hg: '#d8a0d0', hi: 0.9, dust: '#f4f0e8', ground: 'sand', surface: 'rock', exposure: 0.92 },
};
const PL = PLANETS[P.get('planete')] || PLANETS.desert;
// particules d'ambiance de chaque planète (mêmes réglages que les niveaux)
const AMB = {
  brikka: { count: 380, colorA: '#ffe0b0', colorB: '#fff4dc', size: 0.07, drift: [1.6, 0.1, 0.6], glow: 1.1 },
  givrelune: { count: 900, colorA: '#ffffff', colorB: '#dfeeff', size: 0.07, drift: [0.6, -2.2, 0.3], additive: false, glow: 1.0, box: [60, 30, 60] },
  luminbois: { count: 420, colorA: '#d8ff6a', colorB: '#7affc8', size: 0.13, drift: [0.15, 0.08, 0.1], glow: 1.8, box: [50, 16, 50] },
  station: { count: 360, colorA: '#ff7ad8', colorB: '#7ff3ff', size: 0.09, drift: [0.2, 0.6, 0.3], glow: 2 },
  nimbara: { count: 420, colorA: '#ffd6f0', colorB: '#ffffff', size: 0.12, drift: [0.8, 0.25, 0.5], glow: 1.2 },
};

const R = new Renderer(document.getElementById('app'));
R.setQuality(P.get('q') || 'ultra');
const { scene, camera } = R;
R.renderer.toneMappingExposure = PL.exposure;

// ciel en dégradé
const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.ShaderMaterial({
  uniforms: { uTop: { value: new THREE.Color(PL.top) }, uHor: { value: new THREE.Color(PL.hor) } },
  vertexShader: 'varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
  fragmentShader: 'uniform vec3 uTop, uHor; varying vec3 vD; void main(){ float h = normalize(vD).y; gl_FragColor = vec4(mix(uHor, uTop, pow(clamp(h, 0.0, 1.0), 0.5)), 1.0); }',
  side: THREE.BackSide, depthWrite: false, fog: false,
}));
sky.frustumCulled = false;
sky.renderOrder = -10;
scene.add(sky);
scene.fog = new THREE.Fog(PL.fog, PL.fogN, PL.fogF);
const sunDir = new THREE.Vector3(...PL.sun).normalize();
globalU.uFogSunDir.value.copy(sunDir);
globalU.uFogSunCol.value.set(PL.sunC);
const hemi = new THREE.HemisphereLight(PL.hs, PL.hg, PL.hi);
scene.add(allLayers(hemi));
const sun = new THREE.DirectionalLight(PL.sunC, PL.sunI);
sun.position.copy(sunDir).multiplyScalar(60);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 160 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.04;
scene.add(allLayers(sun));
scene.add(sun.target);
frameU.uSunDir.value.copy(sunDir);
frameU.uSunColor.value.copy(sun.color).multiplyScalar(sun.intensity);
scene.add(allLayers(new THREE.DirectionalLight('#fff4ea', 0.4)));
const envRT = new THREE.PMREMGenerator(R.renderer).fromScene((() => { const s = new THREE.Scene(); s.add(sky.clone()); return s; })(), 0.04);
scene.environment = envRT.texture;
scene.environmentIntensity = 0.7;

// décor : sol, piliers, caisses, un bassin (couche de l'eau)
const tex = PL.ground === 'snow' ? snowTexture() : PL.ground === 'metal' ? metalTexture('#4a4a5e') : PL.ground === 'moss' ? mossTexture() : sandTexture();
const gmap = tex.map || tex;
gmap.wrapS = gmap.wrapT = THREE.RepeatWrapping;
gmap.repeat.set(16, 16);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2), mat('#ffffff', { map: gmap, rough: 0.9, unique: true }));
ground.receiveShadow = true;
scene.add(ground);
const boxes = [];
const rock = mat(PL.ground === 'snow' ? '#c8d8ee' : PL.ground === 'metal' ? '#5a5a70' : '#b0704a', { rough: 0.85 });
for (const [x, z, w, h, d] of [[-6, -4, 2, 5, 2], [7, -6, 3, 3, 3], [-3, -12, 6, 7, 2], [10, 4, 1.5, 6, 1.5], [-11, 3, 3, 2, 4]]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), rock);
  m.position.set(x, h / 2, z);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  boxes.push(new THREE.Box3().setFromObject(m));
}
const water = new THREE.Mesh(new THREE.PlaneGeometry(10, 8).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#1a5a7a', transparent: true, opacity: 0.75, depthWrite: false }));
water.position.set(6, 0.04, 9);
water.layers.set(LAYERS.WATER);
scene.add(water);

// monde minimal pour les effets : sol plat + caisses
const _ray = new THREE.Ray();
const _hitP = new THREE.Vector3();
const world = {
  raycast(o, d, maxT) {
    _ray.set(o, d);
    let best = null;
    for (const b of boxes) {
      const p = _ray.intersectBox(b, _hitP);
      if (p) {
        const t = p.distanceTo(o);
        if (t <= maxT && (!best || t < best.t)) best = { t, point: p.clone(), normal: new THREE.Vector3(0, 1, 0), collider: { surface: 'rock' } };
      }
    }
    if (d.y < 0) {
      const t = -o.y / d.y;
      if (t >= 0 && t <= maxT && (!best || t < best.t)) {
        const p = o.clone().addScaledVector(d, t);
        const inWater = Math.abs(p.x - 6) < 5 && Math.abs(p.z - 9) < 4;
        best = { t, point: p, normal: new THREE.Vector3(0, 1, 0), collider: { surface: inWater ? 'water' : PL.surface } };
      }
    }
    return best;
  },
  groundBelow(x, y, z, max = 50) { return this.raycast(new THREE.Vector3(x, y, z), new THREE.Vector3(0, -1, 0), max); },
};
const level = { id: PL.id, dustColor: PL.dust, sun, root: scene, updaters: [], every(fn) { this.updaters.push(fn); } };
const game = { scene, R, world, level, camera: { cam: camera, shakeAt() {}, shake() {} } };
level.game = game;
const fx = new FX(game);
game.fx = fx;
if (P.get('ambiance')) motes(level, AMB[PL.id] || {});
R.compile();
window.__fx = fx;
window.__R = R;

// caméra en orbite (glisser : tourner ; molette : distance)
const CAMS = { pres: [7, 0.25, 1.4], moyen: [14, 0.32, 1.6], loin: [26, 0.3, 2] };
let [dist, pitch, ty] = CAMS[P.get('cam')] || CAMS.moyen;
let yaw = +(P.get('yaw') || 0.5);
let drag = null;
addEventListener('pointerdown', (e) => { if (e.target.tagName !== 'BUTTON') drag = [e.clientX, e.clientY]; });
addEventListener('pointerup', () => { drag = null; });
addEventListener('pointermove', (e) => {
  if (!drag) return;
  yaw -= (e.clientX - drag[0]) * 0.005;
  pitch = Math.max(-0.2, Math.min(1.3, pitch + (e.clientY - drag[1]) * 0.004));
  drag = [e.clientX, e.clientY];
});
addEventListener('wheel', (e) => { dist = Math.max(3, Math.min(60, dist * (e.deltaY > 0 ? 1.1 : 0.9))); });

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const r = (a, b) => a + Math.random() * (b - a);
// projectiles factices pour les rubans
const shots = [];
function shoot(kind, from, vel, life = 1.2) {
  const o = { p: from.clone(), v: vel.clone(), life, kind };
  if (kind === 'rivet') o.rib = fx.ribbon({ color: '#ffb35a', width: 0.07, life: 0.12, glow: 3 });
  else if (kind === 'roquette') o.rib = fx.ribbon({ color: '#ffcf5a', width: 0.12, life: 0.25, glow: 3, smoke: { color: '#6a6070', size: 0.5, every: 0.45 } });
  else if (kind === 'comete') o.rib = fx.ribbon({ color: '#d8a8ff', width: 0.22, life: 0.35, glow: 2.5, smoke: { color: '#706080', size: 0.6, every: 0.5 } });
  else o.rib = fx.ribbon({ color: '#ff4f9a', width: 0.18, life: 0.2, glow: 2.5 });
  shots.push(o);
}
const EFFECTS = {
  explosion: () => fx.explosion(V(0, 0.8, 0), 3, '#ff9a3a', {}),
  'explosion-grosse': () => fx.explosion(V(0, 1.2, 0), 4.5, '#ff7a2a', { shake: 0.9 }),
  'explosion-petite': () => fx.explosion(V(r(-2, 2), 0.6, r(-2, 2)), 1.3, '#ffb03a', {}),
  'explosion-comete': () => fx.explosion(V(0, 1, 0), 3.4, '#c08aff', { core: '#ffe8ff' }),
  'explosion-glace': () => fx.explosion(V(0, 1, 0), 2.2, '#bfefff', { core: '#ffffff', debrisColor: '#bfefff', smoke: false }),
  'explosion-energie': () => fx.explosion(V(0, 1.2, 0), 1.6, '#7ff3ff', { core: '#ffffff', debris: false, smoke: true }),
  etincelles: () => fx.sparks(V(0, 1.5, 0), UP, 24, '#ffd36b', 9),
  fumee: () => fx.smoke(V(0, 0.5, 0), 6, '#3d3540', 1.4, 2),
  poussiere: () => fx.dust(V(0, 0, 0), 12, PL.dust, 4, 1.2),
  pas: () => { for (let i = 0; i < 5; i++) setTimeout(() => fx.dust(V(-4 + i * 1.6, 0, 0), 1, PL.dust, 0.6, 0.45), i * 130); },
  'impact-sable': () => fx.impact(V(0, 0, 0), UP, 'sand', '#ffd36b'),
  'impact-metal': () => fx.impact(V(-6, 2.5, -2.99), V(0, 0, 1), 'metal', '#ffd36b'),
  'impact-roche': () => fx.impact(V(0, 0, 0), UP, 'rock', '#ffd36b'),
  'impact-neige': () => fx.impact(V(0, 0, 0), UP, 'snow', '#7ff3ff'),
  'impact-herbe': () => fx.impact(V(0, 0, 0), UP, 'grass', '#ffd36b'),
  'impact-bois': () => fx.impact(V(0, 0, 0), UP, 'wood', '#ffd36b'),
  eclaboussure: () => fx.splash(V(6, 0.05, 9), 1.2),
  ramassage: () => { for (let i = 0; i < 4; i++) setTimeout(() => fx.pickupBurst(V(-1.5 + i, 1, 0), '#ffd23a', 3), i * 90); },
  bouche: () => fx.muzzle(V(0, 1.4, 0), V(1, 0, 0), '#ffd36b', 0.6),
  anneau: () => fx.ring(V(0, 0, 0), '#7ff3ff', 5, 0.7),
  debris: () => fx.debrisBurst(V(0, 1, 0), 14, '#8a7f8c', 0.18, 7, 1.6, 1),
  rubans: () => {
    shoot('rivet', V(-8, 1.5, 2), V(60, 0, -4), 0.3);
    shoot('roquette', V(-8, 1.2, -1), V(18, 4, 1), 1.2);
    shoot('comete', V(-8, 2, 4), V(16, 2, -6), 1.3);
    shoot('ebolt', V(8, 2, 0), V(-14, 0, 1), 1.2);
  },
  salve: () => { for (let i = 0; i < 8; i++) setTimeout(() => fx.explosion(V(r(-6, 6), 0.5, r(-6, 4)), r(1.2, 2.6), '#ffb03a', {}), i * 70); },
  combat: () => {
    const k = Math.floor(Math.random() * 5);
    if (k === 0) fx.explosion(V(r(-6, 6), 0.6, r(-6, 4)), r(1.5, 3.5), '#ff9a3a', {});
    else if (k === 1) EFFECTS.rubans();
    else if (k === 2) fx.impact(V(r(-4, 4), 0, r(-4, 4)), UP, PL.surface, '#ffd36b');
    else if (k === 3) fx.sparks(V(r(-4, 4), 1, r(-4, 4)), UP, 16, '#ffd36b', 8);
    else fx.muzzle(V(0, 1.4, 0), V(0, 0, -1), '#ffd36b', 0.5);
  },
};
window.__fire = (name) => (EFFECTS[name] || EFFECTS.explosion)();

// interface
const ui = document.getElementById('ui');
let loopName = P.get('effet');
const period = +(P.get('boucle') || 0);
for (const name of Object.keys(EFFECTS)) {
  const b = document.createElement('button');
  b.textContent = name;
  b.onclick = (e) => { if (e.shiftKey) loopName = loopName === name ? null : name; EFFECTS[name](); };
  ui.appendChild(b);
}
const info = document.getElementById('info');

let t = 0, last = performance.now(), loopT = 0, fpsN = 0, fpsT = 0;
if (loopName && !period) EFFECTS[loopName]();
// __freeze = true fige la simulation (le rendu continue) ; __step(s) avance d'un temps donné
window.__freeze = false;
window.__step = (s) => { for (let k = 0; k < Math.round(s * 60); k++) { fx.update(1 / 60); for (let i = shots.length - 1; i >= 0; i--) { const o = shots[i]; o.life -= 1 / 60; o.p.addScaledVector(o.v, 1 / 60); o.rib.push(o.p); } } return [fx.glow.n, fx.matter.n]; };
function frame(now) {
  const dt = window.__freeze ? 0 : Math.min(0.05, (now - last) / 1000);
  last = now;
  t += dt;
  globalU.uTime.value = t;
  if (loopName && period) {
    loopT -= dt;
    if (loopT <= 0) { loopT = period; EFFECTS[loopName](); }
  }
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    s.life -= dt;
    s.v.y -= (s.kind === 'roquette' ? 2 : 0) * dt;
    s.p.addScaledVector(s.v, dt);
    s.rib.push(s.p);
    if (s.life <= 0) { s.rib.end(); fx.explosion(s.p, s.kind === 'rivet' ? 0.6 : 1.6, s.kind === 'comete' ? '#c08aff' : '#ff9a3a', { debris: false, scorch: false }); shots.splice(i, 1); }
  }
  fx.update(dt);
  for (const f of level.updaters) f(dt);
  camera.position.set(Math.sin(yaw) * Math.cos(pitch) * dist, ty + Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist);
  camera.lookAt(0, ty, 0);
  R.render(t);
  fpsN++; fpsT += dt;
  if (fpsT > 0.5) { info.textContent = `${Math.round(fpsN / fpsT)} i/s · ${R.quality} · lumière ${fx.glow.n} · matière ${fx.matter.n}`; fpsN = 0; fpsT = 0; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__ready = true;
