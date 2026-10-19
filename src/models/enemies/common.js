// Modèles des ennemis, socle commun : palette des robots du Baron, squelette + sculpture, œil de robot.
// Les articulations gardent les noms attendus par les comportements (enemies.js du jeu).
import * as THREE from 'three';
import { G, part, joint } from '../geo.js';
import { mat, glow } from '../../engine/materials.js';
import { Sculpt, bone, sculptSkin } from '../sculpt.js';

export const OL = 0.02;
export const C = {
  vorax: '#6a2bd0', voraxD: '#40177e', gold: '#ffcc33', white: '#eceaf6', dark: '#2a2438', metal: '#9aa6c2',
};
// palette commune des robots du Baron
export const VORAX_PAL = {
  vorax: { color: C.vorax, rough: 0.35, metal: 0.45, sheen: 0.2, coat: 0.85 },
  voraxD: { color: C.voraxD, rough: 0.4, metal: 0.5, coat: 0.6 },
  white: { color: C.white, rough: 0.32, metal: 0.15, sheen: 0.3, coat: 0.85 },
  gold: { color: C.gold, rough: 0.25, metal: 0.85, coat: 0.4 },
  dark: { color: C.dark, rough: 0.45, metal: 0.55, coat: 0.2 },
  metal: { color: C.metal, rough: 0.3, metal: 0.85 },
  black: { color: '#15111d', rough: 0.5, metal: 0.2 },
};

// Squelette + sculpture : B() crée un os, S reçoit les formes ; skin() termine (géométrie en cache par clé)
export function rig(palette) {
  const S = new Sculpt(palette);
  const root = new THREE.Group();
  const bones = [];
  const B = (parent, p, name, r) => { const b = bone(parent || root, p, name, r); bones.push(b); return b; };
  const skin = (key, o) => sculptSkin(key, S, root, bones, { outline: OL, mat: { sheenColor: '#d8e0ff' }, ...o });
  return { S, root, B, skin };
}

// Œil de robot : globe blanc, iris lumineux, pupille
export function robotEye(parent, r, irisColor, p = [0, 0, 0]) {
  const e = joint(parent, p);
  part(e, G.sphere(r, 16, 12), mat('#ffffff', { rough: 0.15 }), { outline: OL * 0.8 });
  part(e, G.sphere(r * 0.55, 12, 8), glow(irisColor, 2.4), { p: [0, 0, r * 0.62] });
  part(e, G.sphere(r * 0.27, 8, 6), mat('#140a10', { rough: 0.2 }), { p: [0, 0, r * 0.98] });
  part(e, G.sphere(r * 0.12, 6, 4), glow('#ffffff', 1.4), { p: [r * 0.25, r * 0.25, r * 1.02] });
  return e;
}
