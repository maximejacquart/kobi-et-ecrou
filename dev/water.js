// Bac à eau : une lagune avec berge, fond sableux, haut-fond, rochers, colonnes immergées, ponton et cascade,
// pour régler l'eau vite. Paramètres d'adresse : q (qualité), env (jour|nuit), type (eau|acide|lave|glace),
// preset, cam=x,y,z & look=x,y,z (caméra fixe), az / el (soleil, degrés), orbit=0.
// Console : __water.plouf(x, z, force), __water.view(x, y, z, lx, ly, lz)
import * as THREE from 'three';
import { Renderer } from '../src/engine/render.js';
import { Level } from '../src/levels/level.js';
import { PhysicsWorld } from '../src/engine/physics.js';
import { sandTexture, rockTexture, woodTexture } from '../src/engine/textures.js';
import { terrainMaterial, mat, globalU } from '../src/engine/materials.js';
import { fbm2, clamp, lerp, smooth, rng } from '../src/engine/util.js';
import { createWater, createWaterfall, waterImpulse, setWaterFocus, waterSystem } from '../src/engine/water/water.js';
import { createHero } from '../src/models/hero.js';
import { frameU } from '../src/engine/frame.js';

const P = new URLSearchParams(location.search);
const R = new Renderer(document.getElementById('app'));
const quality = P.get('q') || 'ultra';
R.setQuality(quality);
const world = new PhysicsWorld(10);
const target = new THREE.Vector3(0, 0, 0);
const game = { R, scene: R.scene, world, camera: { cam: R.camera, right: new THREE.Vector3(1, 0, 0) }, player: { pos: target, alive: false } };
const L = new Level(game, { id: 'bac-a-eau' });
const night = P.get('env') === 'nuit';
const type = P.get('type') || 'eau';

L.environment(night ? {
  skyTop: '#040820', skyHorizon: '#14405a', skyBottom: '#082424', sunDir: [-0.3, 0.6, -0.74], sunColor: '#a8d4ff',
  clouds: 0.25, cloudColor: '#2a4a6a', cloudHeight: 0.2, stars: 1.0, nebula: 0.7, nebulaA: '#ff4fd8', nebulaB: '#3affd0',
  planetDir: [0.35, 0.3, 0.89], planetSize: 0.11, planetA: '#2f8a7a', planetB: '#c8ffe8', moonDir: [-0.45, 0.42, 0.79], moonSize: 0.05, moonColor: '#e8fff4',
  fogColor: '#0c2a36', fogNear: 30, fogFar: 270, fogBase: -8, fogFall: 0.12, fogHeight: 0.4, fogSun: 0.25, fogSunColor: '#7ac8ff',
  hemiSky: '#3a78a0', hemiGround: '#1a4a3a', hemiIntensity: 1.1, envGround: '#1a3a3a', fill: 0.55, fillColor: '#bfe8ff',
  sunIntensity: 1.7, envIntensity: 0.7, glare: 0, rays: 0.15, rimColor: '#7affd0', rimStrength: 0.85, bloom: 0.85, exposure: 1.15, saturation: 1.15,
  grade: { shadows: '#0a6a78', highlights: '#ff9ad8', amount: 0.24, contrast: 0.22 },
} : {
  skyTop: '#2f62c8', skyHorizon: '#bfe4ff', skyBottom: '#9fc8e0', sunDir: [0.5, 0.62, -0.6], sunColor: '#fff0d8',
  clouds: 0.6, cloudColor: '#ffffff', planetDir: [-0.5, 0.3, 0.8], planetSize: 0.06, planetA: '#8ad0ff', planetB: '#e0f4ff',
  fogColor: '#b8dcf0', fogNear: 90, fogFar: 600, fogBase: -8, fogFall: 0.09, fogHeight: 0.2, fogSun: 0.5,
  hemiSky: '#bfe0ff', hemiGround: '#c8a070', hemiIntensity: 0.95, sunIntensity: 2.8, envIntensity: 0.85, rays: 0.5,
  rimColor: '#ffe6c0', rimStrength: 0.5, bloom: 0.45, exposure: 1.0, saturation: 1.1,
  grade: { shadows: '#2a5aa8', highlights: '#ffd0a0', amount: 0.18, contrast: 0.18 },
});

// ---------------------------------------------------------------- terrain
function height(x, z) {
  const n = fbm2(x * 0.045, z * 0.045, 4, 7);
  const n2 = fbm2(x * 0.13, z * 0.13, 3, 19);
  const r = Math.hypot(x / 27, (z - 2) / 20);
  let h = lerp(-3.6, 2.4, smooth(clamp((r - 0.55) / 0.7, 0, 1))) + (n - 0.5) * 1.6 + (n2 - 0.5) * 0.35;
  // haut-fond de sable à l'est
  const shelf = smooth(clamp(1 - Math.hypot((x - 13) / 9, (z - 6) / 7), 0, 1));
  h = lerp(h, Math.max(h, -0.42 + (n2 - 0.5) * 0.3), shelf);
  // vasque au pied de la cascade
  const pool = smooth(clamp(1 - Math.hypot(x / 9, (z + 18) / 6), 0, 1));
  h = lerp(h, Math.min(h, -2.8 + (n - 0.5) * 1.2), pool);
  // falaise au nord, entaillée par la cascade
  const cliff = smooth(clamp((-z - 21) / 2.5, 0, 1));
  const notch = Math.exp(-(x * x) / 12) * 3;
  h = lerp(h, 13 + (n - 0.5) * 5 - notch, cliff);
  return h;
}
const sand = sandTexture(), rockT = rockTexture('sandstone');
L.terrain({
  x0: -90, z0: -90, size: 180, res: 180, height, surface: 'sand',
  mapA: sand.map, mapB: rockT.map, normalA: sand.normalMap, normalB: rockT.normalMap, scaleA: 0.18, scaleB: 0.08,
  color: (x, z, h) => {
    const wet = h < 0.4 ? 0.72 + clamp((h + 3) / 3.4, 0, 1) * 0.28 : 1;
    const grass = smooth(clamp((h - 1.2) / 1.2, 0, 1)) * (h < 6 ? 1 : 0);
    return [wet * lerp(1, 0.55, grass), wet * lerp(1, 0.9, grass), wet * lerp(1, 0.45, grass)];
  },
});
const H = (x, z) => height(x, z);
// rochers (triplanaires)
const rockM = terrainMaterial({ mapA: rockT.map, mapB: rockT.map, normalA: rockT.normalMap, normalB: rockT.normalMap, scaleA: 0.2, scaleB: 0.16 });
const RR = rng(5);
function rock(x, z, r, sy = 0.7, dy = 0) {
  const g = new THREE.IcosahedronGeometry(r, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    const k = 1 + (fbm2(v.x * 0.6 + x, v.z * 0.6 + z, 3, 3) - 0.5) * 0.7;
    p.setXYZ(i, v.x * k, v.y * k * sy, v.z * k);
  }
  g.computeVertexNormals();
  L.mesh(g, rockM, new THREE.Matrix4().compose(new THREE.Vector3(x, H(x, z) + dy, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, RR() * 6, 0)), new THREE.Vector3(1, 1, 1)));
}
rock(-9, 4, 2.6, 0.9, 0.2);
rock(6, -7, 1.9, 0.8, 0.6);
rock(-15, 11, 3.2, 0.6);
rock(17, -5, 2.4, 0.7);
rock(-4, -16, 2.2, 0.9, 0.5);
rock(5, -18, 1.6, 1.0, 0.4);
rock(11, 2, 1.1, 0.7, 0.2);
// colonnes en ruine (dont une entièrement immergée)
const stone = mat('#d8c8a8', { rough: 0.8 });
for (const [x, z, h] of [[-3, -6, 7.5], [2.5, -1.5, 4.6], [-6.5, 1.5, 3], [8, -11, 6]]) {
  const y0 = H(x, z) - 0.3;
  L.cylinder(new THREE.Vector3(x, y0, z), 0.65, h, stone, { segments: 20, surface: 'rock' });
  L.cylinder(new THREE.Vector3(x, y0 + h, z), 0.85, 0.35, stone, { segments: 20, surface: 'rock' });
}
// ponton de bois
const wood = mat('#ffffff', { map: woodTexture().map, rough: 0.75 });
for (let i = 0; i < 6; i++) L.box(new THREE.Vector3(-3 + i * 1.2, 0.75, 13.5), new THREE.Vector3(1.1, 0.18, 3), wood, { surface: 'wood' });
for (const [x, z] of [[-3.4, 12.2], [-3.4, 14.8], [2.8, 12.2], [2.8, 14.8]]) L.cylinder(new THREE.Vector3(x, H(x, z) - 0.5, z), 0.16, 1.3 - H(x, z) + 0.5, wood, { segments: 10 });
L.finalizeBatches();
// Kobi dans le haut-fond, pour l'échelle
const hero = createHero();
hero.root.position.set(12.5, H(12.5, 5.5), 5.5);
hero.root.rotation.y = -2.3;
R.scene.add(hero.root);

// ---------------------------------------------------------------- eau
const water = createWater(L, {
  rect: [-60, -40, 120, 90], y: 0, type,
  preset: P.get('preset') || (type === 'eau' ? (night ? 'nuit' : 'lagon') : undefined),
  flow: [0.08, 0.12],
  obstacles: [[-3, -6, 0.75], [2.5, -1.5, 0.75], [6, -7, 1.6], [-9, 4, 2.3]],
});
const fall = type === 'eau' ? createWaterfall(L, { from: [0, H(0, -23.6) + 0.15, -23.6], to: 0, width: 4.5, dir: 0, pool: water }) : null;
setWaterFocus(target);

// ---------------------------------------------------------------- caméra
const cam = R.camera;
const orbit = { yaw: 0.35, pitch: 0.32, dist: 30, auto: P.get('orbit') === '1' };
const fixed = P.get('cam') ? { p: new THREE.Vector3(...P.get('cam').split(',').map(Number)), l: new THREE.Vector3(...(P.get('look') || '0,0,0').split(',').map(Number)) } : null;
let mode = fixed ? 'fixe' : 'orbite';
document.getElementById('camMode').value = mode;
let drag = null;
R.renderer.domElement.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; mode = 'orbite'; });
window.addEventListener('pointerup', () => { drag = null; });
window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  orbit.yaw -= (e.clientX - drag[0]) * 0.005;
  orbit.pitch = clamp(orbit.pitch + (e.clientY - drag[1]) * 0.004, -0.4, 1.4);
  drag = [e.clientX, e.clientY];
});
window.addEventListener('wheel', (e) => { orbit.dist = clamp(orbit.dist * Math.exp(e.deltaY * 0.001), 3, 160); });

// ---------------------------------------------------------------- interface
const ui = (id) => document.getElementById(id);
ui('q').value = quality;
ui('env').value = night ? 'nuit' : 'jour';
ui('type').value = type;
for (const id of ['q', 'env', 'type']) ui(id).onchange = () => { P.set(id, ui(id).value); location.search = P.toString(); };
ui('camMode').onchange = () => { mode = ui('camMode').value; };
if (P.get('ui') === '0') ui('ui').classList.add('cache');
function setSun(azDeg, elDeg) {
  const az = (azDeg * Math.PI) / 180, el = (elDeg * Math.PI) / 180;
  L.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  frameU.uSunDir.value.copy(L.sunDir);
  globalU.uFogSunDir.value.copy(L.sunDir);
  L._lightX = null;
}
if (P.get('az') || P.get('el')) { ui('az').value = P.get('az') || 35; ui('el').value = P.get('el') || 38; setSun(+ui('az').value, +ui('el').value); }
ui('az').oninput = ui('el').oninput = () => setSun(+ui('az').value, +ui('el').value);
const plouf = (x = 0, z = 0, f = 1.5) => waterImpulse(new THREE.Vector3(x, 0, z), f);
ui('plouf').onclick = () => plouf(target.x + (Math.random() - 0.5) * 6, target.z + (Math.random() - 0.5) * 6);

window.__water = {
  R, L, water, fall, plouf, setSun, frameU, get S() { return waterSystem(); },
  view(x, y, z, lx, ly, lz) { mode = 'fixe'; fixedV.p.set(x, y, z); fixedV.l.set(lx, ly, lz); },
};
const fixedV = fixed || { p: new THREE.Vector3(), l: new THREE.Vector3() };

R.compile();
let last = performance.now(), time = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  globalU.uTime.value = time;
  if (mode === 'fixe') {
    cam.position.copy(fixedV.p);
    cam.lookAt(fixedV.l);
    target.copy(fixedV.l);
  } else {
    if (orbit.auto) orbit.yaw += dt * 0.08;
    target.set(2, 0, 0);
    cam.position.set(target.x + Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * orbit.dist, target.y + Math.sin(orbit.pitch) * orbit.dist + 1, target.z + Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * orbit.dist);
    cam.lookAt(target);
  }
  game.camera.right.set(1, 0, 0).applyQuaternion(cam.quaternion);
  L.update(dt);
  R.render(time);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__ready = true;
