// Visionneuse de Kobi : ?view=front|side|back|q|face, dist, y, speed (course), air, vy, glide, aim, bind (pose de
// référence), q (qualité), model=ship (vaisseau), npc=morse|camela (personnage non joueur à côté)
import * as THREE from 'three';
import { Renderer } from '../src/engine/render.js';
import { devEnvironment } from './devenv.js';
import { createHero } from '../src/models/hero.js';
import { sandTexture } from '../src/engine/textures.js';
import { mat } from '../src/engine/materials.js';
import { installFur } from '../src/models/fur.js';

const params = new URLSearchParams(location.search);
const R = new Renderer(document.getElementById('app'));
// qualité (?q=ultra|haute|moyenne) : dimensionne aussi les tampons de rendu
R.setQuality(params.get('q') || 'ultra');
installFur(R);
devEnvironment(R);
const { scene, camera } = R;
// fond uni par la couleur d'effacement : un fond THREE.Color effacerait l'image à chaque couche (eau, effets)
R.renderer.setClearColor('#9fd0ff');
scene.add(new THREE.HemisphereLight('#bfe3ff', '#d08850', 1.2));
const sun = new THREE.DirectionalLight('#fff1d6', 2.6);
sun.position.set(4, 8, 5); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -3; sun.shadow.camera.right = 3; sun.shadow.camera.top = 3; sun.shadow.camera.bottom = -3;
sun.shadow.radius = 3;
scene.add(sun);
const sand = sandTexture();
sand.map.repeat.set(4, 4);
const ground = new THREE.Mesh(new THREE.CircleGeometry(8, 48), mat('#ffffff', { map: sand.map, rough: 0.9 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const tH = performance.now();
const hero = createHero();
window.__stats = { build: Math.round(performance.now() - tH), ...(hero.skin ? hero.skin.geometry.userData.stats : {}) };
scene.add(hero.root);
if (params.get('model') === 'ship') { const { kobiShip } = await import('../src/models/environment/props.js'); const sh = kobiShip(scene); sh.position.set(0, 0, 0); hero.root.position.set(3.5, 0, 2); }
// ?npc=morse|camela : un personnage non joueur à côté de Kobi
const npcName = params.get('npc');
if (npcName) {
  const { morseModel, camelaModel } = await import('../src/models/npc.js');
  const npc = (npcName === 'camela' ? camelaModel : morseModel)();
  scene.add(npc.root);
  hero.root.position.set(1.6, 0, 0.5);
  let tn = 0;
  R.onFrame.push((dt) => { tn += dt; npc.update(dt, tn, null); });
  window.npc = npc;
}
window.hero = hero; window.R = R;
const view = params.get('view') || 'front';
const st = { speed: +(params.get('speed') || 0), grounded: params.get('air') ? false : true, vy: +(params.get('vy') || 0), gliding: !!params.get('glide'), aiming: !!params.get('aim'), aimPitch: 0, jets: 0 };
const angles = { front: 0.35, side: Math.PI / 2, back: Math.PI, q: 2.4, face: 0 };
let t = 0;
function frame() {
  const dt = 1 / 60;
  t += dt;
  if (!params.get('bind')) hero.anim.update(dt, st);
  const a = angles[view] ?? 0.35;
  const dist = +(params.get('dist') || 2.6);
  const ty = +(params.get('y') || 0.8);
  camera.position.set(Math.sin(a) * dist, ty + 0.3, Math.cos(a) * dist);
  camera.lookAt(0, ty, 0);
  R.render(t);
  requestAnimationFrame(frame);
}
frame();
window.__ready = true;
