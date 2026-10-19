// Personnages non joueurs sculptés : Grand-père Morsillon (morse inventeur de Givrelune) et Tantine Caméla
// (caméléonne bricoleuse de Luminbois). Chacun renvoie { root, update(dt, t, lookAt) }.
import * as THREE from 'three';
import { G, part, joint } from './geo.js';
import { mat, glow } from '../engine/materials.js';
import { Sculpt, bone, sculptSkin } from './sculpt.js';
import { addFur, FUR } from './fur.js';

function rig(palette) {
  const S = new Sculpt(palette);
  const root = new THREE.Group();
  const bones = [];
  const B = (parent, p, name, r) => { const b = bone(parent || root, p, name, r); bones.push(b); return b; };
  return { S, root, B, bones };
}

// ------------------------------------------------------------------ Grand-père Morsillon
export function morseModel() {
  const { S, root, B, bones } = rig({
    skin: { color: '#9a6a5a', rough: 0.75, sheen: 0.6, fur: 0.3 },
    belly: { color: '#c8a090', rough: 0.8, sheen: 0.5 },
    overall: { color: '#3a6ac8', rough: 0.6, sheen: 0.3 },
    whisk: { color: '#f2ece0', rough: 0.7, fur: 0.5 },
    nose: { color: '#4a2a2a', rough: 0.4 },
  });
  const body = B(root, [0, 0.9, 0], 'body');
  S.add(body, { t: 'ell', r: [0.75, 0.85, 0.65], col: 'skin', k: 0.1 });
  S.add(body, { t: 'ell', r: [0.68, 0.7, 0.45], p: [0, -0.2, 0.22], col: 'overall', k: 0.06 });
  S.paint(body, { t: 'box', s: [0.08, 0.6, 0.6], round: 0.02, p: [0.3, 0.25, 0.3], rot: [0, 0, 0.3], col: 'overall', feather: 0.01 });
  S.paint(body, { t: 'box', s: [0.08, 0.6, 0.6], round: 0.02, p: [-0.3, 0.25, 0.3], rot: [0, 0, -0.3], col: 'overall', feather: 0.01 });
  for (const s of [-1, 1]) S.add(body, { t: 'ell', r: [0.22, 0.12, 0.4], p: [s * 0.35, -0.82, 0.2], col: 'skin', k: 0.08 });
  const head = B(body, [0, 0.95, 0.15], 'head');
  S.add(head, { t: 'ell', r: [0.48, 0.42, 0.45], col: 'skin', k: 0.1 });
  for (const s of [-1, 1]) S.add(head, { t: 'ell', r: [0.2, 0.17, 0.18], p: [s * 0.16, -0.12, 0.36], col: 'whisk', k: 0.08, fuzz: [0.01, 30] });
  S.add(head, { t: 'ell', r: [0.1, 0.07, 0.07], p: [0, 0.02, 0.45], col: 'nose', k: 0.04 });
  const arms = [];
  for (const s of [-1, 1]) {
    const a = B(body, [s * 0.68, 0.25, 0.1], s < 0 ? 'armL' : 'armR', [0, 0, s * 0.5]);
    S.add(a, { t: 'ell', r: [0.13, 0.42, 0.24], p: [0, -0.32, 0], col: 'skin', k: 0.08, skinSoft: 0.03 });
    arms.push(a);
  }
  const skin = sculptSkin('npc-morse', S, root, bones, { mesh: { cell: 0.022, skinSoft: 0.05 }, mat: { sheenColor: '#ffe0c8' }, outline: 0.014 });
  const fur = addFur(skin, FUR.morse);
  // défenses, yeux, lunettes d'aviateur, clé dans la nageoire
  const leather = mat('#3a2a2a', { rough: 0.6 });
  for (const s of [-1, 1]) {
    part(head, G.cone(0.05, 0.42, 8), mat('#fff8e8', { rough: 0.3 }), { p: [s * 0.12, -0.42, 0.36], r: [Math.PI, 0, s * 0.1] });
    part(head, G.sphere(0.06, 10, 8), mat('#140a10', { rough: 0.2 }), { p: [s * 0.17, 0.15, 0.4] });
    part(head, G.torus(0.1, 0.025, 6, 14), mat('#c9a040', { rough: 0.3, metal: 0.8 }), { p: [s * 0.17, 0.22, 0.38] });
    part(head, G.cyl(0.09, 0.09, 0.02, 12), mat('#9ae4ff', { rough: 0.05, emissive: '#2a8ac8', emissiveIntensity: 0.6 }), { p: [s * 0.17, 0.22, 0.39], r: [Math.PI / 2, 0, 0] });
    // coque de cuir derrière la monture : comble le jour entre le cerclage et le crâne bombé (jusqu'à 11 cm en haut)
    part(head, G.cyl(0.1, 0.1, 0.14, 14, true), leather, { p: [s * 0.17, 0.22, 0.31], r: [Math.PI / 2, 0, 0] });
  }
  // sangle des lunettes : fait le tour du crâne à hauteur des verres (coupe de la tête à y = 0,22 : 0,409 × 0,383),
  // d'une coque à l'autre par l'arrière
  {
    const k = Math.sqrt(1 - (0.22 / 0.42) ** 2), rx = 0.48 * k + 0.012, rz = 0.45 * k + 0.012;
    const t0 = Math.acos(0.27 / rx), pts = [];
    for (let i = 0; i <= 32; i++) {
      const t = Math.PI - t0 + (i / 32) * (Math.PI + 2 * t0);
      pts.push(new THREE.Vector3(Math.cos(t) * rx, 0.22, Math.sin(t) * rz));
    }
    part(head, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.035, 6, false), leather, {});
  }
  // clé tenue par le manche : la poignée dans la nageoire, la mâchoire dehors, ouverte vers le bas
  const wrench = joint(arms[1], [0, -0.7, 0.05]);
  part(wrench, G.cyl(0.03, 0.03, 0.5, 8), mat('#d8dfee', { rough: 0.25, metal: 0.9 }), { p: [0, -0.1, 0] });
  part(wrench, G.torus(0.08, 0.03, 6, 12, Math.PI * 1.4), mat('#d8dfee', { rough: 0.25, metal: 0.9 }), { p: [0, -0.38, 0], r: [0, 0, -Math.PI * 0.2] });
  root.traverse((o) => { if (o.isMesh && !o.userData.isOutline) o.castShadow = true; });
  return {
    root,
    update(dt, t, lookAt) {
      if (fur) fur.update(dt);
      body.position.y = 0.9 + Math.sin(t * 1.8) * 0.02;
      body.rotation.z = Math.sin(t * 0.9) * 0.04;
      arms[1].rotation.x = Math.sin(t * 2.4) * 0.25 - 0.3;
      arms[0].rotation.x = Math.sin(t * 1.3) * 0.1;
      if (lookAt) {
        const lp = root.worldToLocal(lookAt.clone());
        head.rotation.y = THREE.MathUtils.clamp(Math.atan2(lp.x, lp.z), -0.8, 0.8);
      }
    },
  };
}

// ------------------------------------------------------------------ Tantine Caméla
export function camelaModel() {
  const { S, root, B, bones } = rig({
    skin: { color: '#3ac88a', rough: 0.5, sheen: 0.8, metal: 0.1 },
    belly: { color: '#d8f06a', rough: 0.55, sheen: 0.6 },
    apron: { color: '#a0602a', rough: 0.8 },
    stripe: { color: '#1a8a6a', rough: 0.5 },
  });
  // bassin abaissé de 12 cm : les pieds (bas de la peau à 0,115 m) se posent sur le sol au lieu de flotter
  const hips = joint(root, [0, -0.12, 0]);
  const body = B(hips, [0, 0.85, 0], 'body');
  S.add(body, { t: 'ell', r: [0.42, 0.62, 0.4], col: 'skin', k: 0.08 });
  S.add(body, { t: 'ell', r: [0.32, 0.5, 0.2], p: [0, -0.05, 0.2], col: 'belly', k: 0.06 });
  S.add(body, { t: 'box', s: [0.36, 0.42, 0.06], round: 0.04, p: [0, -0.15, 0.36], col: 'apron', k: 0.03 });
  for (let i = 0; i < 3; i++) S.paint(body, { t: 'box', s: [0.6, 0.04, 0.6], round: 0.01, p: [0, 0.25 - i * 0.22, -0.1], col: 'stripe', feather: 0.02 });
  const tail = B(body, [0, -0.5, -0.35], 'tail', [0.4, 0, 0]);
  S.add(tail, { t: 'torus', R: 0.22, r: 0.07, p: [0, -0.15, -0.15], rot: [0, Math.PI / 2, 0], col: 'skin', k: 0.05 });
  // naissance de la queue : relie le croupion à l'anneau enroulé (qui flottait derrière le corps)
  S.add(tail, { t: 'cone', a: [0, 0.05, 0.16], b: [0, -0.15, 0.06], r1: 0.08, r2: 0.065, col: 'skin', k: 0.05 });
  const head = B(body, [0, 0.75, 0.08], 'head');
  S.add(head, { t: 'ell', r: [0.34, 0.3, 0.42], col: 'skin', k: 0.08 });
  S.add(head, { t: 'cone', a: [0, 0.18, -0.05], b: [0, 0.32, -0.38], r1: 0.2, r2: 0.05, col: 'stripe', k: 0.08 });
  const eyes = [];
  for (const s of [-1, 1]) {
    S.add(head, { t: 'sph', r: 0.15, p: [s * 0.25, 0.08, 0.1], col: 'skin', k: 0.05 });
    eyes.push(s);
  }
  const arms = [];
  for (const s of [-1, 1]) {
    const a = B(body, [s * 0.38, 0.2, 0.05], s < 0 ? 'armL' : 'armR', [0, 0, s * 0.4]);
    S.add(a, { t: 'cone', a: [0, 0, 0], b: [0, -0.5, 0.05], r1: 0.08, r2: 0.06, col: 'skin', k: 0.04, skinSoft: 0.02 });
    S.add(a, { t: 'sph', r: 0.08, p: [0, -0.55, 0.06], col: 'belly', k: 0.03, skinSoft: 0.02 });
    arms.push(a);
  }
  for (const s of [-1, 1]) S.add(body, { t: 'ell', r: [0.12, 0.08, 0.18], p: [s * 0.18, -0.65, 0.08], col: 'skin', k: 0.06 });
  sculptSkin('npc-camela', S, root, bones, { mesh: { cell: 0.016, skinSoft: 0.04 }, mat: { sheenColor: '#d8ffe0' }, outline: 0.012 });
  const pupils = [];
  for (const s of [-1, 1]) {
    const e = joint(head, [s * 0.32, 0.08, 0.12]);
    part(e, G.sphere(0.06, 10, 8), mat('#140a10', { rough: 0.2 }), { p: [s * 0.04, 0, 0.08] });
    pupils.push(e);
  }
  // loupe d'horlogère vissée sur l'œil droit : cerclage posé sur la bosse de l'œil (sphère 0,15 en 0,25 / 0,08 / 0,1),
  // tourné selon la normale
  {
    const n = new THREE.Vector3(0.09, 0.04, 0.1).normalize();
    const lp = new THREE.Vector3(0.25, 0.08, 0.1).addScaledVector(n, 0.132);
    const loupe = part(head, G.torus(0.09, 0.02, 6, 14), mat('#c9a040', { rough: 0.3, metal: 0.8 }), { p: lp.toArray() });
    loupe.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  }
  // petite clé magnétique tenue par sa courbure (cachée dans la main), branches vers le bas, cœur lumineux au creux
  // de la courbure (il était enfermé dans la main, l'aimant pendait sous les doigts sans les toucher)
  const tool = joint(arms[1], [0, -0.64, 0.06]);
  part(tool, G.torus(0.09, 0.03, 8, 16, Math.PI), mat('#ff4f6d', { rough: 0.35, metal: 0.3 }), {});
  part(tool, G.sphere(0.05, 8, 6), glow('#3ef2ff', 2), { p: [0, 0.03, 0] });
  root.traverse((o) => { if (o.isMesh && !o.userData.isOutline) o.castShadow = true; });
  return {
    root,
    update(dt, t, lookAt) {
      body.position.y = 0.85 + Math.sin(t * 2.2) * 0.02;
      tail.rotation.x = 0.4 + Math.sin(t * 1.5) * 0.15;
      arms[1].rotation.x = Math.sin(t * 2) * 0.3 - 0.5;
      // les yeux de caméléon roulent chacun de leur côté
      pupils[0].rotation.y = Math.sin(t * 1.3) * 0.6;
      pupils[1].rotation.y = Math.sin(t * 0.9 + 2) * 0.6;
      pupils[0].rotation.x = Math.sin(t * 1.7) * 0.3;
      if (lookAt) {
        const lp = root.worldToLocal(lookAt.clone());
        head.rotation.y = THREE.MathUtils.clamp(Math.atan2(lp.x, lp.z), -0.7, 0.7);
      }
    },
  };
}

export const NPC_FACTORIES = [morseModel, camelaModel];
