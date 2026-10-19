// Modèles des armes (tenues en main, canon vers +Z) + la clé à molette + alliés (grille-pain, tourelle, tornade,
// boule à facettes). Un fichier par arme dans weapons/ ; ici la finition Méga, l'assemblage et les icônes.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mat, glow } from '../engine/materials.js';
import { riveteuse } from './weapons/riveteuse.js';
import { bombe } from './weapons/bombe.js';
import { grillepain } from './weapons/grillepain.js';
import { zappeur } from './weapons/zappeur.js';
import { canardiseur } from './weapons/canardiseur.js';
import { tourelle } from './weapons/tourelle.js';
import { disqueuse } from './weapons/disqueuse.js';
import { comete } from './weapons/comete.js';
import { ruine } from './weapons/ruine.js';
import { givreur } from './weapons/givreur.js';
import { tourbillonneur } from './weapons/tourbillonneur.js';
import { danseotron } from './weapons/danseotron.js';
import { longuevue } from './weapons/longuevue.js';
export { wrenchModel } from './weapons/cle.js';
export { toasterModel } from './weapons/grillepain.js';
export { turretModel } from './weapons/tourelle.js';
export { tornadoModel } from './weapons/tourbillonneur.js';
export { discoModel } from './weapons/danseotron.js';

const BUILDERS = { riveteuse, bombe, grillepain, zappeur, canardiseur, tourelle, disqueuse, comete, ruine, givreur, tourbillonneur, danseotron, longuevue };

// Version Méga : carrosserie sombre et lustrée teintée de la couleur de l'arme, métaux clairs en or, néons dorés
function megaLook(g) {
  const swap = new Map();
  g.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    if (!swap.has(m)) {
      let n = m;
      if (m.userData.isGlow) n = glow('#ffd23a', 2.6);
      else if (m.color) {
        // classement sur la couleur telle qu'on la voit (sRGB) : en linéaire, un acier gris-bleu passe pour saturé
        const hsl = {};
        m.color.getHSL(hsl, THREE.SRGBColorSpace);
        const c = m.color.clone().convertLinearToSRGB();
        const chroma = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
        // les textures (peinture, gravures) suivent la nouvelle teinte
        const keep = { map: m.map, normalMap: m.normalMap, normalScale: m.normalScale?.x, coat: m.clearcoat || 0 };
        if (chroma > 0.2) n = mat('#' + new THREE.Color().setHSL(hsl.h, 0.7, 0.2).getHexString(), { rough: 0.16, metal: 0.85, ...keep });
        else if (hsl.l > 0.5) n = mat('#ffc83a', { rough: 0.22, metal: 0.95, ...keep });
      }
      swap.set(m, n);
    }
    o.material = swap.get(m);
  });
}

export function weaponModel(id, v2 = false, mega = false) {
  const g = BUILDERS[id](v2);
  if (mega) megaLook(g);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// Rendu des icônes d'armes dans un contexte WebGL séparé
export function renderIcons(ids) {
  const icons = {};
  const W = 256, H = 192;
  let r;
  try {
    r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch (e) {
    return icons;
  }
  r.setSize(W, H);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.35;
  r.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  // un studio à refléter : sans lui, l'or et le chrome des icônes virent au brun terne
  const pm = new THREE.PMREMGenerator(r);
  const room = new RoomEnvironment();
  scene.environment = pm.fromScene(room, 0.04).texture;
  scene.environmentIntensity = 0.6;
  scene.add(new THREE.HemisphereLight('#eef2ff', '#8a70a0', 1.4));
  const key = new THREE.DirectionalLight('#ffffff', 3);
  key.position.set(2, 3, 2);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#7ff3ff', 2);
  rim.position.set(-3, 1, -2);
  scene.add(rim);
  const cam = new THREE.PerspectiveCamera(28, W / H, 0.01, 20);
  for (const [id, v2, mega] of ids) {
    const m = weaponModel(id, v2, mega);
    const box = new THREE.Box3().setFromObject(m);
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3()).length();
    m.position.sub(c);
    const holder = new THREE.Group();
    holder.add(m);
    holder.rotation.set(0.35, -0.95, 0.15);
    scene.add(holder);
    cam.position.set(0, 0, s * 1.55);
    cam.lookAt(0, 0, 0);
    r.setClearColor(0x000000, 0);
    r.render(scene, cam);
    icons[id + (mega ? ':mega' : v2 ? ':v2' : '')] = r.domElement.toDataURL('image/png');
    scene.remove(holder);
  }
  scene.environment.dispose();
  room.dispose?.();
  pm.dispose();
  r.dispose();
  r.forceContextLoss();
  return icons;
}
