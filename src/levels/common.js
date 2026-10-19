// Outils partagés par les planètes : vaisseau de sortie (atterrissage, embarquement, décollage) et PNJ.
import * as THREE from 'three';
import { kobiShip } from '../models/environment/props.js';
import { wallJumpWall, iceMats, rockMassif } from '../models/environment/ice.js';
import { clamp } from '../engine/util.js';
import { CylinderCollider } from '../engine/physics.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// La Bricole se pose à landSpot quand on appelle land() ; un coup d'interaction pour décoller vers la suite.
export function shipExit(L, g, landSpot, label, dustColor = '#e8c49a') {
  const exitShip = kobiShip(L.root, { flame: true, ground: L.heightfield && ((x, z) => L.heightfield.height(x, z)) });
  exitShip.visible = false;
  let landT = -1, takeT = -1;
  const takeOff = () => {
    if (takeT >= 0) return;
    takeT = 0;
    g.state = 'cutscene';
    g.player.frozen = true;
    g.player.root.visible = false;
    g.hud.objective(null);
    g.audio.play('rocket', { pos: landSpot, pitch: 0.8 });
    g.audio.play('whoosh', { pitch: 0.6 });
    exitShip.userData.flame.visible = true;
    g.camera.setScript(landSpot.clone().add(V(-12, 4, -14)), landSpot.clone().add(V(0, 3, 0)), 3);
  };
  L.every((dt) => {
    if (takeT >= 0) {
      takeT += dt;
      g.player.root.visible = false;
      const k = Math.max(0, takeT - 0.6);
      exitShip.position.y = landSpot.y + k * k * 6;
      exitShip.position.z = landSpot.z + k * k * 3;
      exitShip.rotation.x = -Math.min(0.5, k * 0.25); // cabre le nez en montant
      exitShip.userData.flame.scale.set(1, 0.8 + Math.random() * 0.5 + k * 0.4, 1);
      if (Math.random() < 0.8) g.fx.smoke(exitShip.position.clone().add(V(0, 0.5, -3)), 1, '#c8c4d0', 1.5, 0.5);
      if (takeT < 1.2 && Math.random() < 0.5) g.fx.dust(landSpot, 2, dustColor, 6, 1.6);
      g.camera.setScript(landSpot.clone().add(V(-12, 4 + k * 2, -14)), exitShip.position.clone().add(V(0, 2, 0)), 3);
      if (takeT > 3.4 && takeT - dt <= 3.4) {
        g.camera.clearScript();
        g.player.frozen = false;
        g.levelComplete();
      }
      return;
    }
    if (landT < 0 || exitShip.userData.ready) return;
    landT += dt;
    const k = clamp(landT / 3, 0, 1);
    const e = 1 - Math.pow(1 - k, 3);
    exitShip.position.set(landSpot.x, landSpot.y + (1 - e) * 40, landSpot.z - (1 - e) * 30);
    // nez vers +z (sens du modèle) : approche nez baissé, arrondi à l'arrivée
    exitShip.rotation.set((1 - e) * 0.4, 0, 0);
    exitShip.userData.flame.visible = k < 1;
    if (k >= 1) {
      exitShip.userData.ready = true;
      g.fx.dust(landSpot, 20, dustColor, 6, 2);
      L.box(V(landSpot.x, landSpot.y + 1.6, landSpot.z), V(3, 3, 6.5), null, { surface: 'metal' });
      L.interactables.push({ pos: landSpot.clone().add(V(2.5, 0, 0)), radius: 4, label, action: () => takeOff() });
      g.hud.objective('Monter à bord de la Bricole');
    }
  });
  return {
    land() { if (landT >= 0) return; exitShip.visible = true; landT = 0; g.audio.play('rocket', { pos: landSpot }); },
  };
}

// Cheminée de sauts muraux : deux parois rainurées face à face (3,6 m d'écart) autour de cx, entre z0 et z1,
// flanquées de massifs facettés dont le dessus (top) est le palier de sortie ; o.back ferme le fond de la fente.
// Les collisions restent des boîtes ; seul le visuel des massifs est taillé.
export function wallChimney(L, cx, y0, top, z0, z1, o = {}) {
  const zc = (z0 + z1) / 2, len = z1 - z0, side = o.side ?? 8, bottom = o.bottom ?? -60, m = o.mat || iceMats().iceRock;
  for (const s of [-1, 1]) {
    // semelle jusqu'au terrain quand il passe sous le pied de la paroi (jamais sur un plancher plus haut que le terrain)
    let gmin = Infinity;
    const hf = L.heightfield;
    if (hf) for (let z = z0; z <= z1 + 1e-6; z += len / 6) for (const dx of [-0.5, 0.5]) gmin = Math.min(gmin, hf.height(cx + s * 2.4 + dx, z));
    const foot = y0 - gmin > 0.03 && y0 - gmin < 1.5 ? y0 - gmin + 0.1 : 0;
    wallJumpWall(L, V(cx + s * 2.4, y0, zc), Math.PI / 2, len, top - y0, { mat: o.wallMat, glow: o.glow, surface: o.surface === 'snow' ? 'ice' : o.surface, foot });
    const c = V(cx + s * (3 + side / 2), (top + bottom) / 2, zc), size = V(side, top - bottom, len);
    L.box(c, size, null, { surface: o.surface || 'snow' });
    rockMassif(L, c, size, m, { snug: [s > 0 ? '-x' : '+x', ...(o.back ? ['+z'] : [])] });
  }
  if (o.back) {
    const c = V(cx, (top + bottom) / 2, z1 + o.back / 2), size = V(6 + side * 2, top - bottom, o.back);
    L.box(c, size, null, { surface: o.surface || 'snow' });
    rockMassif(L, c, size, m, { snug: ['-z'] });
  }
}

// PNJ posé dans le niveau : animation, regard vers Kobi, interaction optionnelle
export function placeNpc(L, g, model, pos, yaw, o = {}) {
  L.root.add(model.root);
  model.root.position.copy(pos);
  model.root.rotation.y = yaw;
  L.every((dt) => model.update(dt, L.time, g.player.pos.clone().setY(g.player.pos.y + 1.2)));
  g.world.add(new CylinderCollider(pos.x, pos.z, pos.y, pos.y + 1.8, 0.7, { surface: 'wood' }));
  if (o.label) L.interactables.push({ pos: pos.clone(), radius: o.radius || 3.2, label: o.label, action: o.action, get enabled() { return o.enabled ? o.enabled() : true; } });
  return model;
}
