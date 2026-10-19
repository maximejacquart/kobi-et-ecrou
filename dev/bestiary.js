// Bestiaire : visionneuse des modèles d'ennemis. ?m=larbin&a=0.4&d=4&y=1 (m=all : alignement complet)
import * as THREE from 'three';
import { Renderer } from '../src/engine/render.js';
import { devEnvironment } from './devenv.js';
import * as M from '../src/models/enemies.js';
import { prebuildSculpts, sculptStats } from '../src/models/sculpt.js';
import { sandTexture } from '../src/engine/textures.js';
import { mat } from '../src/engine/materials.js';

const q = new URLSearchParams(location.search);
const R = new Renderer(document.getElementById('app'));
R.setQuality(q.get('q') || 'ultra');
devEnvironment(R, [6, 10, 7]);
const { scene, camera } = R;
// fond uni par la couleur d'effacement : un fond THREE.Color effacerait l'image à chaque couche (eau, effets)
R.renderer.setClearColor('#8fc4f0');
scene.add(new THREE.HemisphereLight('#cfe6ff', '#b08060', 1.1));
const sun = new THREE.DirectionalLight('#fff1d6', 2.8);
sun.position.set(6, 10, 7); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, far: 60 });
scene.add(sun);
const sand = sandTexture(); sand.map.repeat.set(10, 10);
const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 64), mat('#ffffff', { map: sand.map, rough: 0.9 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

const t0 = performance.now();
await prebuildSculpts(M.SCULPT_FACTORIES);
const MAKERS = {
  grignoteur: () => M.grignoteur(0), grignoteur1: () => M.grignoteur(1), grignoteur2: () => M.grignoteur(2),
  larbin: M.larbin, bourdon: M.bourdon, boumboule: M.boumboule, pinceur: () => M.pinceur(false), pinceurRoyal: () => M.pinceur(true),
  tourelle: M.tourelleV, grosbras: M.grosbras, canard: M.canard, goinfrotron: M.goinfrotron,
  larbinBouclier: M.larbinBouclier, lunette: M.lunette, fouisseur: M.fouisseur, moustique: M.moustique, phaseur: M.phaseur,
  pingouin: M.pingouin, champi: M.champi, mammouth: M.mammouth, reineSpore: M.reineSpore, bulbe: M.bulbe,
};
const which = q.get('m') || 'all';
const list = which === 'all' ? ['grignoteur', 'grignoteur1', 'boumboule', 'canard', 'bourdon', 'larbin', 'tourelle', 'pinceur'] : which.split(',');
let x = -(list.length - 1) * 1.4;
for (const k of list) {
  const m = MAKERS[k]();
  if (k === 'bourdon') m.root.position.y = 1.2;
  m.root.position.x = list.length > 1 ? x : 0;
  x += k === 'pinceur' ? 4 : 2.8;
  scene.add(m.root);
}
window.R = R;
window.__stats = { ms: Math.round(performance.now() - t0), workers: window.__sculptMs, ...Object.fromEntries(list.map((k) => [k, sculptStats(k.replace(/^grignoteur$/, 'grignoteur0'))?.tris])) };
const a = +(q.get('a') || 0.5), d = +(q.get('d') || (which === 'all' ? 16 : 4)), y = +(q.get('y') || 1);
let t = 0;
function frame() {
  t += 1 / 60;
  const aa = q.get('spin') ? a + t * 0.6 : a;
  camera.position.set(Math.sin(aa) * d, y + d * 0.25, Math.cos(aa) * d);
  camera.lookAt(0, y, 0);
  R.render(t);
  requestAnimationFrame(frame);
}
frame();
