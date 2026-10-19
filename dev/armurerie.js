// Armurerie : visionneuse des armes. ?w=riveteuse (ou w=all : toutes les armes de base alignées)
//   défaut : base, v2 et Méga côte à côte, agrandies ×s (s=3) ; a (angle), d (distance), y (hauteur visée), spin
//   ?hand=1 : Kobi tient l'arme (v=base|v2|mega, aim=1 pour la pose de tir, view=front|side|gauche|back|q|qg, dist)
//   ?ally=1 : l'allié déployé (grille-pain, tourelle, tornade, boule à facettes), normal et v2 (v=base : normal seul)
//   ?icons=1 : les icônes du Bazar (base, v2, Méga) par-dessus la scène
import * as THREE from 'three';
import { Renderer } from '../src/engine/render.js';
import { devEnvironment } from './devenv.js';
import { weaponModel, wrenchModel, toasterModel, turretModel, tornadoModel, discoModel, renderIcons } from '../src/models/weapons.js';
import { sandTexture } from '../src/engine/textures.js';
import { mat } from '../src/engine/materials.js';

const q = new URLSearchParams(location.search);
const R = new Renderer(document.getElementById('app'));
R.setQuality(q.get('q') || 'ultra');
devEnvironment(R, [6, 10, 7]);
const { scene, camera } = R;
R.renderer.setClearColor('#8fc4f0');
scene.add(new THREE.HemisphereLight('#cfe6ff', '#b08060', 1.1));
const sun = new THREE.DirectionalLight('#fff1d6', 2.8);
sun.position.set(6, 10, 7); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, far: 40 });
scene.add(sun);
const sand = sandTexture(); sand.map.repeat.set(6, 6);
const ground = new THREE.Mesh(new THREE.CircleGeometry(20, 64), mat('#ffffff', { map: sand.map, rough: 0.9 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

const ALL = ['riveteuse', 'bombe', 'grillepain', 'zappeur', 'canardiseur', 'tourelle', 'disqueuse', 'comete', 'givreur', 'tourbillonneur', 'danseotron', 'longuevue', 'ruine'];
const ALLIES = { grillepain: toasterModel, tourelle: turretModel, tourbillonneur: tornadoModel, danseotron: discoModel };
const w = q.get('w') || 'riveteuse';
const VAR = { base: [false, false], v2: [true, false], mega: [true, true] };
const make = (id, v) => (id === 'cle' ? wrenchModel() : weaponModel(id, ...VAR[v]));
const spinning = [];
const track = (m) => m.traverse((o) => { if (o.userData.blade) spinning.push(o.userData); });

let target = new THREE.Vector3(0, 1, 0), dist = 4, ang = +(q.get('a') || 0.12);
if (q.get('hand')) {
  const { createHero } = await import('../src/models/hero.js');
  const { installFur } = await import('../src/models/fur.js');
  installFur(R);
  const hero = createHero();
  scene.add(hero.root);
  const m = make(w, q.get('v') || 'base');
  m.rotation.x = m.userData.hold ?? Math.PI / 2;
  hero.arms[1].socket.add(m);
  track(m);
  const two = ['comete', 'bombe', 'longuevue', 'ruine'].includes(w);
  const st = { speed: 0, grounded: true, vy: 0, armed: true, aiming: !!q.get('aim'), twoHanded: two, aimPitch: 0, jets: 0, grip: m };
  R.onFrame.push((dt) => hero.anim.update(dt, st));
  window.hero = hero;
  ang = { front: 0.35, side: Math.PI / 2, gauche: -Math.PI / 2, back: Math.PI, q: 2.4, qg: -2.4 }[q.get('view') || 'q'] ?? ang;
  dist = +(q.get('dist') || 2.4); target.set(0, +(q.get('y') || 0.75), 0);
} else if (q.get('ally')) {
  const fn = ALLIES[w];
  const only = q.get('v') === 'base';
  (only ? [false] : [false, true]).forEach((v2, i) => {
    const m = fn(v2);
    m.position.set(only ? 0 : (i - 0.5) * (w === 'tourbillonneur' ? 6 : 2.2), w === 'grillepain' ? 1 : w === 'danseotron' ? 1.6 : 0, 0);
    scene.add(m);
    const L = m.userData.layers;
    R.onFrame.push((dt) => {
      if (L) L.forEach((l, k) => { l.rotation.y += dt * (3 + k * 1.5); });
      if (m.userData.ball) { m.userData.ball.rotation.y += dt * 1.6; m.userData.beams.rotation.y += dt * 1.1; }
      if (m.userData.wings) for (const wg of m.userData.wings) wg.rotation.x = Math.sin(performance.now() * 0.03) * 0.6 * (wg.position.z > 0 ? 1 : -1);
    });
  });
  dist = +(q.get('d') || (w === 'tourbillonneur' ? 12 : 4.5)); target.set(0, w === 'tourbillonneur' ? 2 : 0.9, 0);
} else {
  const s = +(q.get('s') || 3);
  const list = w === 'all' ? ALL.map((id) => [id, 'base']) : (q.get('v') || 'base,v2,mega').split(',').map((v) => [w, v]);
  const gap = +(q.get('gap') || 2.6);
  // w=all : grille de 5 colonnes, les rangées empilées en hauteur
  const cols = w === 'all' ? 5 : list.length, rows = Math.ceil(list.length / cols);
  list.forEach(([id, v], k) => {
    const i = k % cols, row = Math.floor(k / cols);
    const m = make(id, v);
    m.scale.setScalar(s);
    // posée de profil, canon vers +X, au-dessus du sol
    m.rotation.y = Math.PI / 2;
    const box = new THREE.Box3().setFromObject(m);
    m.position.set((i - (cols - 1) / 2) * gap - (box.max.x + box.min.x) / 2, 1 + (rows - 1 - row) * 1.4 - (box.max.y + box.min.y) / 2, -(box.max.z + box.min.z) / 2);
    m.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(m);
    track(m);
  });
  dist = +(q.get('d') || (w === 'all' ? 13 : 7));
  target.y = 1 + (rows - 1) * 0.7;
}
if (q.get('icons') && w !== 'cle') {
  // R.U.I.N.E. n'a pas de Méga
  const icons = renderIcons([[w, false, false], [w, true, false], ...(w === 'ruine' ? [] : [[w, true, true]])]);
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;right:8px;top:8px;display:flex;flex-direction:column;gap:6px';
  for (const k of Object.keys(icons)) {
    const img = new Image(); img.src = icons[k];
    img.style.cssText = 'width:192px;height:144px;background:#1b1830c0;border-radius:10px';
    box.appendChild(img);
  }
  document.body.appendChild(box);
}
window.R = R;
window.__stats = { tris: R.renderer.info.render.triangles };
const yy = +(q.get('y') || target.y);
let t = 0;
function frame() {
  const dt = 1 / 60;
  t += dt;
  for (const u of spinning) u.blade.rotation[u.bladeAxis || 'x'] += dt * 6;
  const aa = q.get('spin') ? ang + t * 0.6 : ang;
  camera.position.set(Math.sin(aa) * dist, yy + dist * 0.12, Math.cos(aa) * dist);
  camera.lookAt(target.x, yy, target.z);
  R.render(t);
  requestAnimationFrame(frame);
}
frame();
window.__ready = true;
