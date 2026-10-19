// Kobi, fennec mécanicien de l'espace, et Écrou, son robot sac-à-dos.
// Corps sculpté par champs de distance et habillé d'une peau sur squelette, accessoires rigides,
// animation procédurale (marche, sauts, vrille, plané, coups...).
import * as THREE from 'three';
import { G, part, joint, mergeGeometries } from './geo.js';
import { Sculpt, bone, sculptSkin } from './sculpt.js';
import { addFur, FUR } from './fur.js';
import { mat, glow } from '../engine/materials.js';
import { damp, clamp, lerp, TAU } from '../engine/util.js';

const C = {
  fur: '#f29a35',
  furDark: '#c86a22',
  cream: '#fff0d8',
  pink: '#ff9fb0',
  suit: '#3f4fc9',
  suitDark: '#2e338f',
  accent: '#ffb627',
  scarf: '#ef3e4a',
  glove: '#3b3550',
  boot: '#8a3b2b',
  sole: '#2a2230',
  eye: '#37d67a',
  nose: '#3b1e2c',
};

export function createHero() {
  // accessoires rigides (yeux, lunettes, boucles…) ; le corps est un seul maillage sculpté et habillé de peau
  const M = {
    white: mat('#ffffff', { rough: 0.2 }),
    iris: mat(C.eye, { rough: 0.3, emissive: '#0c4020', emissiveIntensity: 0.6 }),
    pupil: mat('#120a18', { rough: 0.2 }),
    nose: mat(C.nose, { rough: 0.25 }),
    metal: mat('#c9d2e3', { rough: 0.3, metal: 0.8 }),
    lens: mat('#7fe8ff', { rough: 0.05, metal: 0.3, emissive: '#1a7fa0', emissiveIntensity: 0.6 }),
    brow: mat('#7a3a18', { rough: 0.9 }),
    accent: mat(C.accent, { rough: 0.45, metal: 0.2, coat: 0.8 }),
    suitDark: mat(C.suitDark, { rough: 0.6 }),
    lid: mat(C.fur, { rough: 0.8, sheen: 1, sheenColor: '#ffd9a0', sheenRoughness: 0.4 }),
  };
  const OL = 0.011;
  const S = new Sculpt({
    fur: { color: C.fur, rough: 0.82, sheen: 0.9, fur: 1 },
    furDark: { color: C.furDark, rough: 0.85, sheen: 0.8, fur: 1 },
    cream: { color: C.cream, rough: 0.85, sheen: 1, fur: 0.8 },
    pink: { color: C.pink, rough: 0.7, sheen: 0.4, fur: 0.15 },
    suit: { color: C.suit, rough: 0.55, sheen: 0.5 },
    suitDark: { color: C.suitDark, rough: 0.6, sheen: 0.3 },
    accent: { color: C.accent, rough: 0.42, metal: 0.25, coat: 0.8 },
    scarf: { color: C.scarf, rough: 0.75, sheen: 0.6, fur: 0.12 },
    glove: { color: C.glove, rough: 0.5, sheen: 0.2 },
    boot: { color: C.boot, rough: 0.5, sheen: 0.2, coat: 0.45 },
    sole: { color: C.sole, rough: 0.85 },
    nose: { color: C.nose, rough: 0.25 },
  });

  const root = new THREE.Group();
  root.name = 'kobi';
  const bones = [];
  const B = (parent, p, name, r) => { const b = bone(parent, p, name, r); bones.push(b); return b; };
  // Le corps pivote autour de son centre (vrilles)
  const body = B(root, [0, 0.52, 0], 'body');
  const hips = B(body, [0, 0, 0], 'hips');
  S.add(hips, { t: 'ell', r: [0.168, 0.125, 0.138], p: [0, 0.02, 0], col: 'suit', k: 0.05 });
  S.add(hips, { t: 'torus', R: 0.152, r: 0.026, p: [0, 0.085, 0.004], col: 'boot', k: 0.012 });
  S.add(hips, { t: 'box', s: [0.038, 0.04, 0.026], round: 0.014, p: [0.13, 0.03, 0.085], rot: [0, 0.6, 0], col: 'suitDark', k: 0.01 });
  part(hips, G.rbox(0.09, 0.062, 0.03, 0.012), M.accent, { p: [0, 0.085, 0.157] });

  // --- Torse ---
  const spine = B(hips, [0, 0.08, 0], 'spine');
  S.add(spine, { t: 'ell', r: [0.15, 0.12, 0.13], p: [0, 0.05, 0.008], col: 'suit', k: 0.07 });
  S.add(spine, { t: 'ell', r: [0.168, 0.15, 0.135], p: [0, 0.17, 0], col: 'suit', k: 0.07 });
  // bretelles du harnais (peintes : elles suivent la déformation du torse)
  for (const s of [-1, 1]) S.paint(spine, { t: 'box', s: [0.021, 0.2, 0.25], round: 0.005, p: [s * 0.075, 0.15, 0], rot: [0, 0, -s * 0.35], col: 'accent', feather: 0.003 });
  S.paint(spine, { t: 'box', s: [0.25, 0.012, 0.25], round: 0.004, p: [0, 0.035, 0], col: 'suitDark', feather: 0.003 });
  part(spine, G.cyl(0.035, 0.035, 0.02, 12), M.metal, { p: [0, 0.15, 0.135], r: [Math.PI / 2 - 0.12, 0, 0] });
  part(spine, G.nut(0.028, 0.012), M.accent, { p: [-0.095, 0.22, 0.118], r: [-0.1, -0.5, 0] });

  // --- Cou et écharpe ---
  const neck = B(spine, [0, 0.31, 0], 'neck');
  S.add(neck, { t: 'cone', a: [0, -0.04, 0], b: [0, 0.1, 0.01], r1: 0.085, r2: 0.08, col: 'fur', k: 0.04 });
  S.add(neck, { t: 'torus', R: 0.098, r: 0.046, p: [0, -0.005, 0.0], rot: [0.16, 0, 0], col: 'scarf', k: 0.02, fuzz: [0.003, 60] });
  S.add(neck, { t: 'ell', r: [0.05, 0.045, 0.04], p: [0.05, -0.03, -0.1], col: 'scarf', k: 0.02 });
  const scarfTail = [];
  let sp = B(neck, [0.06, -0.03, -0.11], 'scarf0');
  for (let i = 0; i < 3; i++) {
    const seg = i === 0 ? sp : B(sp, [0, 0, -0.1], 'scarf' + i);
    S.add(seg, { t: 'box', s: [0.036 - i * 0.005, 0.017, 0.06], round: 0.014, p: [0, 0, -0.05], col: 'scarf', k: 0.012, skinSoft: 0.01 });
    scarfTail.push(seg);
    sp = seg;
  }

  // --- Tête ---
  const head = B(neck, [0, 0.07, 0.01], 'head');
  S.add(head, { t: 'ell', r: [0.236, 0.214, 0.226], p: [0, 0.17, 0], col: 'fur', k: 0.04 });
  for (const s of [-1, 1]) {
    // joues duveteuses et touffes
    S.add(head, { t: 'ell', r: [0.11, 0.085, 0.1], p: [s * 0.13, 0.075, 0.07], col: 'fur', k: 0.07, fuzz: [0.005, 45] });
    S.add(head, { t: 'cone', a: [s * 0.17, 0.06, 0.05], b: [s * 0.275, -0.005, 0.0], r1: 0.05, r2: 0.01, col: 'cream', k: 0.035, fuzz: [0.004, 55] });
    // orbites où se logent les yeux
    S.sub(head, { t: 'ell', r: [0.062, 0.078, 0.035], p: [s * 0.088, 0.2, 0.205], rot: [0, s * 0.28, 0], k: 0.025 });
  }
  S.add(head, { t: 'ell', r: [0.108, 0.078, 0.12], p: [0, 0.088, 0.16], rot: [0.15, 0, 0], col: 'cream', k: 0.055 });
  S.add(head, { t: 'ell', r: [0.15, 0.09, 0.11], p: [0, 0.045, 0.1], col: 'cream', k: 0.06 });
  S.add(head, { t: 'ell', r: [0.038, 0.027, 0.03], p: [0, 0.133, 0.285], col: 'nose', k: 0.012 });
  S.add(head, { t: 'cone', a: [0.0, 0.33, 0.05], b: [0.035, 0.46, 0.14], r1: 0.055, r2: 0.012, col: 'fur', k: 0.035 });
  S.add(head, { t: 'cone', a: [-0.05, 0.33, 0.08], b: [-0.08, 0.42, 0.16], r1: 0.04, r2: 0.01, col: 'furDark', k: 0.03 });
  // bouche (petit sourire)
  part(head, G.torus(0.03, 0.007, 6, 16, Math.PI), M.nose, { p: [0, 0.073, 0.268], r: [0.35, 0, Math.PI] });

  // yeux (rigides) et paupières
  const eyes = [];
  for (const s of [-1, 1]) {
    const eye = joint(head, [s * 0.088, 0.2, 0.19]);
    eye.rotation.set(0, s * 0.28, 0);
    part(eye, G.ellipsoid(0.066, 0.083, 0.045), M.white, {});
    const iris = joint(eye, [0, -0.005, 0.03]);
    part(iris, G.ellipsoid(0.044, 0.054, 0.02), M.iris, {});
    part(iris, G.ellipsoid(0.026, 0.034, 0.014), M.pupil, { p: [0, 0, 0.01] });
    part(iris, G.sphere(0.011, 8, 6), glow('#ffffff', 0.9), { p: [0.014, 0.018, 0.02] });
    // paupière : demi-coque qui descend sur l'œil
    const lidJ = joint(eye, [0, 0, 0]);
    part(lidJ, LID_GEO, M.lid, { shadow: false });
    lidJ.rotation.x = LID_OPEN;
    // sourcil
    const brow = part(head, G.capsule(0.012, 0.06, 4, 8), M.brow, { p: [s * 0.088, 0.305, 0.205], r: [0, 0, s * 1.35] });
    eyes.push({ eye, iris, lid: lidJ, brow, s });
  }

  // lunettes de mécano sur le front
  const gog = joint(head, [0, 0.3, 0.1]);
  gog.rotation.x = -0.35;
  part(gog, G.torus(0.235, 0.02, 6, 30, Math.PI * 0.9), M.suitDark, { p: [0, 0.0, -0.1], r: [Math.PI / 2, 0, Math.PI * 0.05] });
  for (const s of [-1, 1]) {
    part(gog, G.cyl(0.058, 0.062, 0.05, 16), M.metal, { p: [s * 0.075, 0.02, 0.1], r: [Math.PI / 2 - 0.2, 0, 0], outline: OL * 0.8 });
    part(gog, G.cyl(0.046, 0.046, 0.055, 16), M.lens, { p: [s * 0.075, 0.02, 0.105], r: [Math.PI / 2 - 0.2, 0, 0] });
  }

  // oreilles géantes : coque en coupe, intérieur rose duveteux
  const ears = [];
  for (const s of [-1, 1]) {
    const ear = B(head, [s * 0.14, 0.3, -0.03], s < 0 ? 'earL' : 'earR', [-0.12, 0, -s * 0.5]);
    // grand triangle aplati, large à la base, pointu au bout
    S.add(ear, { t: 'cone', a: [0, 0.02, 0], b: [0, 0.39, 0], r1: 0.125, r2: 0.024, sc: [1, 1, 0.42], col: 'fur', k: 0.05, skinSoft: 0.03 });
    S.sub(ear, { t: 'cone', a: [0, 0.08, 0.05], b: [0, 0.35, 0.04], r1: 0.085, r2: 0.012, sc: [1, 1, 0.3], col: 'pink', k: 0.015 });
    S.add(ear, { t: 'cone', a: [0, 0.06, 0.012], b: [0, 0.19, 0.022], r1: 0.04, r2: 0.012, col: 'cream', k: 0.03, fuzz: [0.004, 70] });
    S.paint(ear, { t: 'sph', r: 0.06, p: [0, 0.43, 0], col: 'furDark', feather: 0.025 });
    ears.push({ ear, s, base: ear.rotation.clone(), vel: 0, off: 0, velX: 0, offX: 0 });
  }

  // --- Bras (sculptés en pose « A », l'animation les ramène le long du corps) ---
  const arms = [];
  for (const s of [-1, 1]) {
    const shoulder = B(spine, [s * 0.2, 0.245, 0], s < 0 ? 'shoulderL' : 'shoulderR');
    S.add(shoulder, { t: 'sph', r: 0.074, col: 'suit', k: 0.035 });
    const upper = B(shoulder, [0, 0, 0], s < 0 ? 'upperL' : 'upperR', [0, 0, s * 0.8]);
    S.add(upper, { t: 'cone', a: [0, -0.01, 0], b: [0, -0.175, 0], r1: 0.058, r2: 0.05, col: 'suit', k: 0.03, skinSoft: 0.015 });
    const elbow = B(upper, [0, -0.18, 0], s < 0 ? 'elbowL' : 'elbowR');
    S.add(elbow, { t: 'cone', a: [0, 0, 0], b: [0, -0.15, 0], r1: 0.049, r2: 0.043, col: 'fur', k: 0.02, skinSoft: 0.015 });
    S.add(elbow, { t: 'torus', R: 0.05, r: 0.018, p: [0, -0.012, 0], col: 'suitDark', k: 0.008, skinSoft: 0.012 });
    const hand = B(elbow, [0, -0.17, 0], s < 0 ? 'handL' : 'handR');
    S.add(hand, { t: 'ell', r: [0.068, 0.066, 0.076], p: [0, -0.012, 0], col: 'glove', k: 0.028 });
    S.add(hand, { t: 'cone', a: [s * -0.03, 0.0, 0.03], b: [s * -0.062, -0.035, 0.068], r1: 0.026, r2: 0.021, col: 'glove', k: 0.016 });
    S.add(hand, { t: 'torus', R: 0.05, r: 0.021, p: [0, 0.052, 0], col: 'accent', k: 0.01 });
    const socket = joint(hand, [0, -0.04, 0.02]);
    arms.push({ shoulder, upper, elbow, hand, socket, s });
  }

  // --- Jambes ---
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = B(hips, [s * 0.1, -0.04, 0], s < 0 ? 'hipL' : 'hipR');
    S.add(hip, { t: 'cone', a: [0, 0.03, 0], b: [0, -0.165, 0], r1: 0.082, r2: 0.067, col: 'suit', k: 0.035, skinSoft: 0.008 });
    const knee = B(hip, [0, -0.17, 0], s < 0 ? 'kneeL' : 'kneeR');
    S.add(knee, { t: 'cone', a: [0, 0, 0], b: [0, -0.15, 0], r1: 0.067, r2: 0.058, col: 'suit', k: 0.03, skinSoft: 0.008 });
    S.add(knee, { t: 'ell', r: [0.052, 0.056, 0.03], p: [0, -0.005, 0.052], col: 'accent', k: 0.012, skinSoft: 0.008 });
    S.add(knee, { t: 'torus', R: 0.064, r: 0.02, p: [0, -0.125, 0], col: 'accent', k: 0.008, skinSoft: 0.008 });
    const foot = B(knee, [0, -0.17, 0], s < 0 ? 'footL' : 'footR');
    S.add(foot, { t: 'box', s: [0.078, 0.07, 0.135], round: 0.055, p: [0, -0.055, 0.05], col: 'boot', k: 0.03, skinSoft: 0.008 });
    S.paint(foot, { t: 'box', s: [0.1, 0.022, 0.17], round: 0.004, p: [0, -0.11, 0.05], col: 'sole', feather: 0.003 });
    S.paint(foot, { t: 'ell', r: [0.075, 0.05, 0.05], p: [0, -0.04, 0.175], col: 'accent', feather: 0.004 });
    legs.push({ hip, knee, foot, s });
  }

  // --- Queue touffue ---
  const tail = [];
  // pose de repos (sculpture et peau) proche du port réel : base un peu basse, sous Écrou (voir TAIL plus bas)
  let tp = B(hips, [0, -0.02, -0.13], 'tail0', [-0.2, 0, 0]);
  const tailSizes = [[0.07, 0.1], [0.09, 0.12], [0.088, 0.11], [0.065, 0.085]];
  tailSizes.forEach(([r, l], i) => {
    const seg = i === 0 ? tp : B(tp, [0, 0, -tailSizes[i - 1][1] * 1.1], 'tail' + i);
    S.add(seg, { t: 'ell', r: [r, r * 0.92, l * 0.82], p: [0, 0, -l * 0.6], col: i === 3 ? 'cream' : 'fur', k: 0.05, fuzz: [0.007, 32], skinSoft: 0.03 });
    tail.push(seg);
    tp = seg;
  });
  S.paint(tail[3], { t: 'ell', r: [0.1, 0.1, 0.07], p: [0, 0, -0.085], col: 'cream', feather: 0.025 });

  // --- Corps sculpté ---
  const skin = sculptSkin('hero', S, root, bones, { mesh: { cell: 0.0112, skinSoft: 0.02, colorSoft: 0.004 }, mat: { sheenColor: '#ffd9a0' }, outline: OL });
  // fourrure en coquilles (Ultra, Haute)
  const fur = addFur(skin, FUR.kobi);

  // --- Écrou, le robot sac-à-dos ---
  const ecrou = createEcrou();
  spine.add(ecrou.root);
  // un peu haut sur le dos : la racine de la queue passe sous ses pieds sans le traverser
  ecrou.root.position.set(0, 0.2, -0.2);

  root.traverse((o) => { if (o.isMesh && !o.userData.isOutline) o.castShadow = true; });

  const rig = {
    root, body, hips, spine, neck, head, eyes, ears, arms, legs, tail, scarfTail, ecrou, skin, fur,
    materials: [...Object.values(M), ...(skin ? [skin.material] : [])],
  };
  rig.anim = new HeroAnimator(rig);
  return rig;
}
// paupière : calotte tournée vers l'avant (fermée à 0, relevée vers l'arrière quand l'œil est ouvert)
const LID_GEO = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(0.071, 0.089, 0.052);
const LID_OPEN = -2.45;
// port de queue (rotation x, positive = vers le haut) : base inclinée vers le bas sous Écrou, crosse au-delà
const TAIL = { drop: -0.5, lift: 0.4, curl: [0, 0.35, 0.35, 0.25], fall1: 0.4 };

// rivets de la façade d'Écrou : demi-sphères aplaties vers chaque coin de l'hexagone (méplats en haut et en bas)
let rivets = null;
const ECROU_RIVETS = () => rivets || (rivets = mergeGeometries([0, 1, 2, 3, 4, 5].map((i) => {
  const a = (i / 6) * TAU;
  return new THREE.SphereGeometry(0.0085, 8, 4, 0, TAU, 0, Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 1, 0.6)
    .translate(Math.cos(a) * 0.094, Math.sin(a) * 0.094, -0.074);
})));

export function createEcrou() {
  // Écrou porte bien son nom : un torse en écrou hexagonal au cœur lumineux, une tête-écran au grand œil,
  // de petits bras et des jambes qui pendent. Il regarde derrière Kobi (son avant est -z).
  const M = {
    band: mat('#56607d', { rough: 0.4, metal: 0.6 }),
    eye: glow('#4ff3ff', 3.2),
    core: glow('#5ff6ff', 2.4),
    tip: glow('#ff7a5a', 2.2),
    rotor: mat('#ffc23a', { rough: 0.35, metal: 0.4, coat: 0.7 }),
    jet: glow('#8ff7ff', 4),
    gold: mat('#ffc23a', { rough: 0.3, metal: 0.7, coat: 0.5 }),
  };
  const S = new Sculpt({
    shell: { color: '#e9edf7', rough: 0.28, metal: 0.35, sheen: 0.3, coat: 0.9 },
    band: { color: '#ffb627', rough: 0.35, metal: 0.55, coat: 0.6 },
    dark: { color: '#56607d', rough: 0.4, metal: 0.6 },
    screen: { color: '#10121f', rough: 0.08, metal: 0.4 },
  });
  const root = new THREE.Group();
  root.name = 'ecrou';
  const bones = [];
  const B = (parent, p, name, r) => { const b = bone(parent, p, name, r); bones.push(b); return b; };
  const bodyJ = B(root, [0, 0, 0], 'ecrouBody');
  // torse-écrou (axe avant-arrière, méplats en haut et en bas), trou central, bande dorée sur la tranche.
  // Le prisme du sculpteur a son axe en Y : la seule bascule Rx(π/2) le couche sur l'axe z.
  S.add(bodyJ, { t: 'hex', r: 0.13, h: 0.075, round: 0.025, rot: [Math.PI / 2, 0, 0], col: 'shell', k: 0.02 });
  S.sub(bodyJ, { t: 'cyl', r: 0.055, h: 0.1, round: 0.01, rot: [Math.PI / 2, 0, 0], col: 'dark', k: 0.012 });
  // bande : un prisme coaxial à peine plus large que l'écrou (elle ne déborde plus sur les bras), prolongée sur la tête
  S.paint(bodyJ, { t: 'hex', r: 0.136, h: 0.022, round: 0.004, rot: [Math.PI / 2, 0, 0], col: 'band', feather: 0.004 });
  S.add(bodyJ, { t: 'hex', r: 0.045, h: 0.025, round: 0.008, p: [0, 0.12, 0], col: 'band', k: 0.012 });
  const headJ = B(bodyJ, [0, 0.215, -0.005], 'ecrouHead');
  S.add(headJ, { t: 'ell', r: [0.13, 0.115, 0.12], col: 'shell', k: 0.02 });
  S.paint(headJ, { t: 'box', s: [0.2, 0.2, 0.022], round: 0.004, col: 'band', feather: 0.004 });
  S.sub(headJ, { t: 'ell', r: [0.098, 0.07, 0.05], p: [0, -0.008, -0.108], col: 'screen', k: 0.014 });
  for (const s of [-1, 1]) S.add(headJ, { t: 'cyl', r: 0.035, h: 0.018, round: 0.008, p: [s * 0.127, 0, 0], rot: [0, 0, Math.PI / 2], col: 'band', k: 0.01 });
  const armsE = [];
  for (const s of [-1, 1]) {
    // épaule fixe au coin de l'écrou : retournée (Ry π) pour que la rotation x des animations (repos -0.9, coucou -2.7)
    // porte la main vers l'avant d'Écrou (-z) et non dans son dos, et écartée (Rz) pour dégager le bras du torse
    const sh = B(bodyJ, [s * 0.148, 0.035, -0.012], 'ecrouShoulder');
    sh.rotation.order = 'ZYX';
    sh.rotation.set(0.64, Math.PI, s * 0.42);
    S.add(bodyJ, { t: 'sph', r: 0.024, p: [s * 0.148, 0.035, -0.012], col: 'band', k: 0.01 });
    const a = B(sh, [0, 0, 0], 'ecrouArm', [-0.9, 0, 0]);
    S.add(a, { t: 'cone', a: [0, 0, 0], b: [0, -0.085, 0], r1: 0.021, r2: 0.019, col: 'dark', k: 0.012, skinSoft: 0.008 });
    S.add(a, { t: 'sph', r: 0.032, p: [0, -0.11, 0], col: 'band', k: 0.012, skinSoft: 0.008 });
    // le bras frôle le coin de l'écrou : on le repeint sombre par-dessus la bande dorée
    S.paint(a, { t: 'cone', a: [0, -0.026, 0], b: [0, -0.082, 0], r1: 0.025, r2: 0.023, col: 'dark', feather: 0.003 });
    armsE.push(a);
  }
  const legsE = [];
  for (const s of [-1, 1]) {
    const l = B(bodyJ, [s * 0.055, -0.11, -0.02], 'ecrouLeg', [0.3, 0, 0]);
    S.add(l, { t: 'cone', a: [0, 0.01, 0], b: [0, -0.07, 0], r1: 0.019, r2: 0.017, col: 'dark', k: 0.01, skinSoft: 0.008 });
    S.add(l, { t: 'ell', r: [0.026, 0.02, 0.034], p: [0, -0.085, -0.01], col: 'shell', k: 0.01, skinSoft: 0.008 });
    legsE.push(l);
  }
  const skin = sculptSkin('ecrou', S, root, bones, { mesh: { cell: 0.0075, skinSoft: 0.012, aoDist: 0.012 }, mat: { sheenColor: '#e8f4ff' }, outline: 0.008 });
  // cœur lumineux dans le trou de l'écrou, côté visible
  part(bodyJ, G.sphere(0.045, 14, 10), M.core, { p: [0, 0, -0.03], shadow: false });
  part(bodyJ, G.torus(0.05, 0.008, 6, 20), M.gold, { p: [0, 0, -0.07], shadow: false });
  // six rivets sur la façade, un vers chaque coin de l'écrou (un seul maillage)
  part(bodyJ, ECROU_RIVETS(), M.band, { shadow: false });
  // œil sur l'écran
  const eye = joint(headJ, [0, -0.005, -0.1]);
  for (const s of [-1, 1]) {
    part(eye, G.ellipsoid(0.024, 0.033, 0.01), M.eye, { p: [s * 0.04, 0, 0], shadow: false });
    part(eye, G.ellipsoid(0.008, 0.009, 0.005), glow('#ffffff', 2), { p: [s * 0.04 + 0.008, 0.012, -0.007], shadow: false });
  }
  // antenne sur le côté (sa pointe ne brille plus derrière la tête de Kobi)
  const ant = joint(headJ, [0.08, 0.085, 0.02]);
  ant.rotation.z = -0.55;
  part(ant, G.cyl(0.005, 0.007, 0.1, 6), M.band, { p: [0, 0.05, 0] });
  const tip = part(ant, G.sphere(0.016, 10, 8), M.tip, { p: [0, 0.11, 0], shadow: false });
  // réacteurs
  const jets = [];
  for (const s of [-1, 1]) {
    part(bodyJ, G.cyl(0.028, 0.038, 0.05, 10), M.band, { p: [s * 0.075, -0.12, 0.035] });
    const j = part(bodyJ, G.cone(0.03, 0.18, 10), M.jet, { p: [s * 0.075, -0.22, 0.035], r: [Math.PI, 0, 0], shadow: false });
    j.scale.set(1, 0.01, 1);
    j.visible = false;
    jets.push(j);
  }
  // rotor (planeur) : mât télescopique qui porte l'hélice au-dessus des oreilles de Kobi (pointes à ~0,5 m
  // au-dessus de la tête d'Écrou pendant le plané ; les pales font 0,44 m de rayon)
  const mast = joint(headJ, [0, 0.105, 0]);
  part(mast, G.cyl(0.016, 0.02, 0.3, 8), M.band, { p: [0, 0.15, 0] });
  part(mast, G.cyl(0.022, 0.022, 0.025, 10), M.rotor, { p: [0, 0.3, 0] });
  part(mast, G.cyl(0.011, 0.013, 0.3, 8), M.band, { p: [0, 0.44, 0] });
  const rotor = joint(mast, [0, 0.6, 0]);
  part(rotor, G.cyl(0.035, 0.035, 0.03, 12), M.rotor, {});
  const blades = [];
  for (let i = 0; i < 3; i++) {
    const b = joint(rotor, [0, 0, 0]);
    b.rotation.y = (i / 3) * TAU;
    part(b, G.rbox(0.42, 0.012, 0.07, 0.006), M.rotor, { p: [0.23, 0, 0], r: [0.12, 0, 0] });
    blades.push(b);
  }
  mast.scale.setScalar(0.001);
  return { root, bodyJ, headJ, eye, tip, armsE, legsE, jets, mast, rotor, blades, skin, materials: [...Object.values(M), ...(skin ? [skin.material] : [])] };
}

// ---------------- Animation procédurale ----------------
// ---- main gauche sur l'arme (armes à deux mains) : IK à deux os, bras gauche vers userData.grip de l'arme tenue.
// La cible hors de portée est ramenée au bout du bras ; w mélange avec la pose animée.
const ARM_UP = 0.18, ARM_FORE = 0.17; // épaule → coude → poignet (voir les bras plus haut)
const GRIP_POLE = new THREE.Vector3(-0.7, -1, -0.25); // le coude part vers le bas et l'extérieur (repère du buste)
const _S = new THREE.Vector3(), _T = new THREE.Vector3(), _E = new THREE.Vector3(), _P = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _mb = new THREE.Matrix4();
function leftGrip(r, weapon, w) {
  const { upper, elbow } = r.arms[0];
  r.root.updateWorldMatrix(true, true);
  _S.setFromMatrixPosition(upper.matrixWorld);
  _T.copy(weapon.userData.grip).applyMatrix4(weapon.matrixWorld);
  const k = _x.setFromMatrixColumn(upper.matrixWorld, 0).length();
  const a = ARM_UP * k, b = ARM_FORE * k;
  _y.subVectors(_T, _S);
  const d = clamp(_y.length(), Math.abs(a - b) + 1e-3, (a + b) * 0.999);
  _y.normalize();
  _P.copy(GRIP_POLE).transformDirection(r.spine.matrixWorld);
  _P.addScaledVector(_y, -_P.dot(_y)).normalize();
  const cosA = (a * a + d * d - b * b) / (2 * a * d);
  _E.copy(_S).addScaledVector(_y, a * cosA).addScaledVector(_P, a * Math.sqrt(Math.max(0, 1 - cosA * cosA)));
  _T.copy(_S).addScaledVector(_y, d);
  // repère monde du bras : +Y vers l'épaule, +Z vers le côté où part l'avant-bras, X = charnière du coude
  _y.subVectors(_S, _E).normalize();
  _z.subVectors(_T, _E);
  const bend = Math.acos(clamp(-_z.dot(_y) / _z.length(), -1, 1));
  _z.addScaledVector(_y, -_z.dot(_y)).normalize();
  _x.crossVectors(_y, _z);
  _q.setFromRotationMatrix(_mb.makeBasis(_x, _y, _z));
  upper.parent.matrixWorld.decompose(_P, _qp, _E);
  upper.quaternion.slerp(_qp.invert().multiply(_q), w);
  elbow.rotation.x = lerp(elbow.rotation.x, -bend, w);
}

class HeroAnimator {
  constructor(rig) {
    this.rig = rig;
    this.phase = 0;
    this.t = 0;
    this.blink = 2;
    this.flip = 0; // progression de la vrille du double saut
    this.flipDir = 1;
    this.squash = 0;
    this.squashV = 0;
    this.meleeT = 0;
    this.meleeKind = 0;
    this.recoil = 0;
    this.rotor = 0;
    this.rotorSpin = 0;
    this.prevVy = 0;
    this.hurtT = 0;
    this.dashT = 0;
    this.gripW = 0;
    this.landT = 0;
    this.landK = 0;
    this.earTwitch = 3;
    this.springs = new Map();
    this.prevYaw = null;
    this.yawRate = 0;
    this.prevSpeed = 0;
    this.accel = 0;
    this.idleT = 0;
    this.lookT = 0;
    this.lookX = 0;
    this.lookY = 0;
  }
  doFlip(dir = 1) { this.flip = 0.0001; this.flipDir = dir; this.sideFlip = 0; }
  doSideFlip(dir = 1) { this.sideFlip = 0.0001; this.sideDir = dir; this.flip = 0; }
  doLongJump() { this.longT = 0.0001; this.flip = 0; this.sideFlip = 0; }
  doMelee(kind) { this.meleeT = 0.0001; this.meleeKind = kind; }
  doRecoil(a = 1) { this.recoil = Math.min(1.4, this.recoil + a); }
  doHurt() { this.hurtT = 0.35; }
  doLand(strength) {
    this.squashV -= strength;
    // réception : les genoux amortissent, d'autant plus que la chute était longue
    if (strength > 0) { this.landT = 0.32; this.landK = clamp(strength / 14, 0.25, 1); }
  }
  doDash() { this.dashT = 0.3; }

  // Ressort amorti (pulsation w, amortissement z) : inertie, léger dépassement, chaque articulation à son rythme
  sp(key, target, w, z, dt) {
    let s = this.springs.get(key);
    if (!s) { s = { v: target, d: 0 }; this.springs.set(key, s); }
    const n = Math.max(1, Math.ceil((w * dt) / 0.35));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      s.d += (w * w * (target - s.v) - 2 * z * w * s.d) * h;
      s.v += s.d * h;
    }
    return s.v;
  }
  spRot(key, o, x, y, z, w, zeta, dt) {
    o.rotation.x = this.sp(key + 'x', x, w, zeta, dt);
    o.rotation.y = this.sp(key + 'y', y, w, zeta, dt);
    o.rotation.z = this.sp(key + 'z', z, w, zeta, dt);
  }

  // s : { speed, grounded, vy, gliding, aiming, armed, aimPitch, grinding, grappling, dead, slam, jets, hipYaw, strafeBack, lean, victory, yaw }
  update(dt, s) {
    const r = this.rig;
    this.t += dt;
    const k = (l) => 1 - Math.exp(-l * dt); // facteur d'amortissement
    const run = clamp(s.speed / 9, 0, 1.25);
    const moving = s.speed > 0.4 && s.grounded;
    // dérivées : virage (inclinaison) et accélération (bascule avant/arrière)
    if (s.yaw !== undefined) {
      const dy = this.prevYaw === null ? 0 : angleWrap(s.yaw - this.prevYaw);
      this.prevYaw = s.yaw;
      this.yawRate = damp(this.yawRate, dt > 0 ? dy / dt : 0, 10, dt);
    }
    this.accel = damp(this.accel, dt > 0 ? (s.speed - this.prevSpeed) / dt : 0, 8, dt);
    this.prevSpeed = s.speed;

    // phase de foulée (en radians)
    if (moving) this.phase += dt * (5.2 + s.speed * 0.95);
    else this.phase = lerp(this.phase, Math.round(this.phase / Math.PI) * Math.PI, k(6));
    const ph = this.phase;
    const dir = s.strafeBack ? -1 : 1;

    // ressort d'écrasement/étirement
    this.squashV += (-this.squash * 220 - this.squashV * 16) * dt;
    this.squash += this.squashV * dt;
    if (!s.grounded) {
      const stretch = clamp(s.vy * 0.012, -0.08, 0.12);
      this.squash = lerp(this.squash, stretch, k(10));
    }
    const sq = clamp(this.squash, -0.3, 0.25);
    r.body.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);

    // ---- cibles ----
    let hipY = 0.52, hipX = 0, bodyPitch = 0, bodyRoll = 0, hipsYaw = 0;
    let legL = 0, legR = 0, kneeL = 0.08, kneeR = 0.08, footL = 0, footR = 0;
    let armLx = 0.1, armLz = 0.3, armRx = 0.1, armRz = -0.3, elbL = -0.3, elbR = -0.3;
    let armLy = 0, armRy = 0;
    let spineX = 0, spineY = 0, spineZ = 0, headX = 0, headY = 0, headZ = 0;
    let tailX = 0.6, tailY = 0;
    let browAngry = 0, browUp = 0;

    if (s.dead) {
      bodyPitch = -1.4;
      hipY = 0.22;
      armLz = 1.4; armRz = -1.4; legL = -0.3; legR = 0.3;
      browUp = 1;
    } else if (s.grinding) {
      hipY = 0.45;
      legL = -0.5; legR = 0.3; kneeL = 0.9; kneeR = 0.5;
      armLz = 1.2; armRz = -1.1; armLx = -0.2; armRx = 0.3;
      spineY = 0.5; bodyRoll = Math.sin(this.t * 3) * 0.06 + (s.lean || 0) * 0.4;
      headY = -0.4;
      tailX = 0.3; tailY = Math.sin(this.t * 4) * 0.3;
    } else if (s.grappling) {
      armRx = -2.9; armRz = -0.2; elbR = 0;
      armLx = 0.5; armLz = 0.6;
      legL = 0.4; legR = -0.2; kneeL = 0.6; kneeR = 0.8;
      bodyPitch = 0.2;
      tailX = 0.1;
    } else if (s.gliding) {
      // plané : bras écartés légèrement vers l'avant, jambes groupées qui battent doucement
      armLz = 1.15; armRz = -1.15; armLx = -0.45; armRx = -0.45; elbL = -0.35; elbR = -0.35;
      legL = -0.25 + Math.sin(this.t * 5) * 0.12; legR = -0.15 - Math.sin(this.t * 5) * 0.12;
      kneeL = 0.7; kneeR = 0.9;
      bodyPitch = 0.28 + (s.speed / 10) * 0.18;
      bodyRoll = Math.sin(this.t * 1.7) * 0.08 - clamp(this.yawRate * 0.12, -0.4, 0.4);
      headX = -0.25;
      tailX = 0.1; tailY = Math.sin(this.t * 3) * 0.3;
      browUp = 0.5;
    } else if (!s.grounded) {
      // en l'air : montée groupée, descente qui tend les jambes vers le sol et ouvre les bras
      const up = clamp(s.vy / 9, -1, 1);
      const rise = Math.max(0, up), fall = Math.max(0, -up);
      legL = 0.55 * rise + 0.2 * fall; legR = -0.15 * rise - 0.05 * fall;
      kneeL = 1.25 * rise + 0.35 * fall + 0.3; kneeR = 0.55 * rise + 0.25 * fall + 0.2;
      armLx = 0.35 * rise - 0.45 * fall; armRx = 0.35 * rise - 0.45 * fall;
      armLz = 0.42 + fall * 0.32; armRz = -0.42 - fall * 0.32;
      elbL = -0.7 * rise - 0.3; elbR = -0.7 * rise - 0.3;
      bodyPitch = -up * 0.1 + 0.05;
      headX = fall * 0.15;
      tailX = 0.25 + rise * 0.4; tailY = 0;
      browUp = fall * 0.6;
    } else if (moving) {
      // course : jambe et bras opposés, genou plié pendant le retour de la jambe, bassin et épaules en contre-rotation
      const sw = Math.sin(ph) * dir;
      const cs = Math.cos(ph) * dir;
      const amp = 0.5 + run * 0.5;
      legL = sw * amp; legR = -sw * amp;
      // talons relevés avec mesure : la queue, basse sous Écrou, passe juste au-dessus
      const bend = 0.55 + run * 0.45;
      kneeL = 0.12 + Math.pow(Math.max(0, cs), 1.3) * bend;
      kneeR = 0.12 + Math.pow(Math.max(0, -cs), 1.3) * bend;
      footL = -legL * 0.45 + Math.max(0, -sw) * 0.35 * run;
      footR = -legR * 0.45 + Math.max(0, sw) * 0.35 * run;
      armLx = sw * amp * 0.85; armRx = -sw * amp * 0.85;
      armLz = 0.22 + run * 0.08; armRz = -0.22 - run * 0.08;
      elbL = -0.35 - run * 0.95; elbR = -0.35 - run * 0.95;
      hipY = 0.49 + Math.abs(Math.cos(ph)) * 0.055 * (0.5 + run);
      hipsYaw = sw * 0.14 * run;
      spineY = -sw * 0.2 * run;
      headY = sw * 0.08 * run;
      bodyPitch = run * 0.2 + clamp(this.accel * 0.012, -0.18, 0.22);
      bodyRoll = clamp(-this.yawRate * s.speed * 0.012, -0.32, 0.32) + Math.cos(ph) * 0.03 * run;
      headZ = -bodyRoll * 0.6;
      tailX = 0.95; tailY = Math.sin(ph) * 0.45;
    } else {
      // repos : respiration, report du poids d'une jambe à l'autre, regard qui flâne
      this.idleT += dt;
      const br = Math.sin(this.t * 2.2);
      const weight = Math.sin(this.t * 0.37) * Math.min(1, this.idleT * 0.5);
      hipY = 0.515 + br * 0.006 - Math.abs(weight) * 0.012;
      hipX = weight * 0.022;
      bodyRoll = -weight * 0.04;
      kneeL = 0.1 + Math.max(0, weight) * 0.22;
      kneeR = 0.1 + Math.max(0, -weight) * 0.22;
      legL = Math.max(0, weight) * 0.08; legR = Math.max(0, -weight) * 0.08;
      armLz = 0.2 + br * 0.03; armRz = -0.2 - br * 0.03;
      armLx = 0.12; armRx = 0.12;
      elbL = -0.28; elbR = -0.28;
      spineX = br * 0.02;
      spineZ = weight * 0.03;
      headY = Math.sin(this.t * 0.5) * 0.35 * Math.max(0, Math.sin(this.t * 0.23));
      headX = Math.sin(this.t * 0.7) * 0.05;
      headZ = weight * 0.05;
      tailY = Math.sin(this.t * 1.7) * 0.5;
      tailX = 0.7;
    }
    if (moving || !s.grounded) this.idleT = 0;
    if (s.wallSlide && !s.dead) {
      // dos à la paroi, une main qui frotte, jambes repliées
      armLz = 1.3; armLx = -0.4; armRz = -0.4; armRx = 0.3; elbL = -0.2;
      legL = 0.6; legR = 0.2; kneeL = 1.2; kneeR = 0.6;
      bodyPitch = -0.15; bodyRoll = 0;
      tailX = -0.2;
      browUp = 0.4;
    }
    if (s.longJump && !s.dead && !s.gliding) {
      // plongeon : corps allongé vers l'avant, bras tendus, jambes en arrière
      const k = clamp((this.longT || 0) / 0.25, 0, 1);
      bodyPitch = 0.75 * k + bodyPitch * (1 - k);
      armLx = -2.6 * k; armRx = -2.6 * k; armLz = 0.25; armRz = -0.25; elbL = -0.1; elbR = -0.1;
      legL = -0.5; legR = -0.35; kneeL = 0.5; kneeR = 0.8;
      headX = -0.5;
      tailX = 0.0;
    }
    if (this.longT > 0) this.longT += dt;
    if (s.grounded) this.longT = 0;

    // ---- réception : les genoux encaissent ----
    if (this.landT > 0 && s.grounded && !s.dead) {
      this.landT -= dt;
      const env = Math.sin(clamp(this.landT / 0.32, 0, 1) * Math.PI) * this.landK;
      hipY -= 0.09 * env;
      kneeL += 0.75 * env; kneeR += 0.75 * env;
      legL += 0.35 * env; legR += 0.35 * env;
      footL -= 0.3 * env; footR -= 0.3 * env;
      bodyPitch += 0.18 * env;
      armLz += 0.35 * env; armRz -= 0.35 * env;
    }

    // ---- arme en main au repos : avant-bras relevé, le canon pointe devant au lieu de traverser le sol ----
    if (s.armed) elbR = Math.min(elbR, -1.0);

    // ---- visée / tir : bras droit tendu vers la cible ----
    if (s.aiming && !s.grinding && !s.dead && !s.grappling) {
      armRx = -Math.PI / 2 - s.aimPitch;
      armRz = -0.05; armRy = 0.0;
      elbR = -0.05 - this.recoil * 0.5;
      armRx -= this.recoil * 0.35;
      if (s.twoHanded) {
        armLx = -Math.PI / 2 - s.aimPitch + 0.15; armLz = -0.5; elbL = -0.6;
      }
      spineX = -s.aimPitch * 0.35 + this.recoil * 0.05;
      headX = -s.aimPitch * 0.4;
      spineY = 0;
      headY = 0;
      browAngry = 1;
    }

    // ---- coup de clé ----
    if (this.meleeT > 0) {
      this.meleeT += dt;
      const D = this.meleeKind === 2 ? 0.42 : 0.3;
      const p = clamp(this.meleeT / D, 0, 1);
      const wind = p < 0.25 ? p / 0.25 : 1;
      const strike = p < 0.25 ? 0 : clamp((p - 0.25) / 0.3, 0, 1);
      const ease = 1 - Math.pow(1 - strike, 3);
      // arcs hauts et larges : vu de dos (caméra de jeu), la clé doit sortir de la silhouette au lieu de passer
      // devant le torse ; la fin du geste est tenue jusqu'au bout de l'animation
      if (this.meleeKind === 0) { // revers droite → gauche, les hanches entraînent le buste
        armRx = -1.85; armRz = lerp(-1.6 * wind, 1.45, ease); armRy = 0;
        elbR = -0.2;
        spineY = lerp(-0.6 * wind, 0.7, ease);
        hipsYaw = lerp(-0.25 * wind, 0.3, ease);
      } else if (this.meleeKind === 1) { // gauche → droite
        armRx = -1.75; armRz = lerp(1.0 * wind, -1.8, ease);
        elbR = -0.3;
        spineY = lerp(0.55 * wind, -0.8, ease);
        hipsYaw = lerp(0.25 * wind, -0.3, ease);
      } else { // coup vertical, porté un peu à droite du corps
        armRx = lerp(-3.0 * wind, -0.75, ease); armRz = -0.45;
        elbR = -0.1;
        spineX = lerp(-0.3 * wind, 0.5, ease);
        bodyPitch += lerp(-0.2 * wind, 0.35, ease);
        hipY -= 0.05 * ease;
        kneeL += 0.4 * ease; kneeR += 0.3 * ease;
      }
      armLz = 0.6; armLx = -0.3;
      browAngry = 1;
      if (p >= 1) this.meleeT = 0;
    }
    if (s.slam) {
      armRx = -3.0; armLx = -3.0; elbR = -0.2; elbL = -0.2;
      legL = -0.9; legR = -0.9; kneeL = 1.5; kneeR = 1.5;
      bodyPitch = 0.3;
      browAngry = 1;
    }
    // ---- esquive ----
    if (this.dashT > 0) {
      this.dashT -= dt;
      bodyPitch = 0.5;
      armLx = 1.0; armRx = s.aiming ? armRx : 1.0;
      // jambe arrière moins tirée et queue gardée au port de course : elles ne se croisent plus
      legL = -0.4; legR = 0.6; kneeL = 0.3; kneeR = 0.4;
      tailX = 0.8;
    }
    // ---- douleur ----
    if (this.hurtT > 0) {
      this.hurtT -= dt;
      bodyPitch -= 0.4 * (this.hurtT / 0.35);
      headX -= 0.3;
      browUp = 1; browAngry = 0;
    }
    // ---- victoire ----
    if (s.victory) {
      armRx = -2.8 + Math.sin(this.t * 10) * 0.2; armRz = -0.3; elbR = -0.2;
      armLz = 0.9; armLx = 0; elbL = -1.6;
      headX = -0.25;
      browUp = 0.6;
    }

    // ---- application par ressorts (le bassin mène, le buste suit, la tête et les bras traînent un peu) ----
    r.body.position.y = this.sp('hipY', hipY, 26, 0.75, dt);
    r.body.position.x = this.sp('hipX', hipX, 8, 0.9, dt);
    // vrille du double saut
    if (this.flip > 0) {
      this.flip += dt / 0.42;
      if (this.flip >= 1) this.flip = 0;
    }
    if (this.flip > 0) {
      r.body.rotation.x = Math.sin(this.flip * Math.PI * 0.5) * TAU * this.flipDir;
      this.springs.delete('pitch');
    } else r.body.rotation.x = this.sp('pitch', bodyPitch, 16, 0.7, dt);
    // vrille latérale (saut de côté en visée)
    if (this.sideFlip > 0) {
      this.sideFlip += dt / 0.46;
      if (this.sideFlip >= 1) this.sideFlip = 0;
    }
    if (this.sideFlip > 0) {
      r.body.rotation.z = Math.sin(this.sideFlip * Math.PI * 0.5) * TAU * this.sideDir;
      this.springs.delete('roll');
    } else r.body.rotation.z = this.sp('roll', bodyRoll + (s.bank || 0), 12, 0.65, dt);

    const [aL, aR] = r.arms;
    const fast = s.aiming || this.meleeT > 0;
    this.spRot('aL', aL.upper, armLx, armLy, -armLz, 17, 0.55, dt);
    this.spRot('aR', aR.upper, armRx, armRy, -armRz, fast ? 40 : 17, fast ? 0.9 : 0.55, dt);
    aL.elbow.rotation.x = this.sp('eL', elbL, 15, 0.5, dt);
    aR.elbow.rotation.x = this.sp('eR', elbR, fast ? 40 : 15, fast ? 0.9 : 0.5, dt);
    const [lL, lR] = r.legs;
    lL.hip.rotation.x = this.sp('lL', -legL, 30, 0.8, dt);
    lR.hip.rotation.x = this.sp('lR', -legR, 30, 0.8, dt);
    lL.knee.rotation.x = this.sp('kL', kneeL, 30, 0.8, dt);
    lR.knee.rotation.x = this.sp('kR', kneeR, 30, 0.8, dt);
    lL.foot.rotation.x = this.sp('fL', footL - kneeL * 0.3, 26, 0.8, dt);
    lR.foot.rotation.x = this.sp('fR', footR - kneeR * 0.3, 26, 0.8, dt);
    // hanches orientées vers le déplacement en mode visée, plus la contre-rotation de la foulée
    r.hips.rotation.y = this.sp('hipsY', (s.hipYaw || 0) + hipsYaw, 14, 0.7, dt);
    this.spRot('spine', r.spine, spineX, spineY - (s.hipYaw || 0) - hipsYaw * 0.5, spineZ, 13, 0.6, dt);
    this.spRot('head', r.head, headX, headY, headZ, 9, 0.55, dt);

    // ---- arme à deux mains en visée : la main gauche vient la tenir ----
    const wantGrip = !!(s.aiming && s.twoHanded && s.grip && s.grip.userData.grip && s.grip.visible) &&
      !s.grinding && !s.dead && !s.grappling && this.meleeT <= 0 && this.dashT <= 0;
    this.gripW = damp(this.gripW, wantGrip ? 1 : 0, 16, dt);
    if (this.gripW > 0.01 && s.grip && s.grip.userData.grip) leftGrip(r, s.grip, this.gripW);

    // queue et écharpe : traîne ondulante
    // Écrou pend sur le dos, juste au-dessus de la racine de la queue : elle part vers le bas pour passer sous lui, puis
    // remonte en crosse une fois dégagée. Les cibles d'allure (tailX) gardent leur effet, mais leur montée est réduite.
    // (quand le buste plonge, en visant vers le bas, Écrou descend avec lui : la queue s'abaisse d'autant)
    const tailX0 = TAIL.drop + tailX * TAIL.lift + clamp(r.spine.rotation.x, -0.4, 0) * 1.5;
    const fallCurl = -clamp(s.vy * 0.03, -0.3, 0.3);
    r.tail.forEach((seg, i) => {
      const w = Math.sin(this.t * 3.2 - i * 0.9) * 0.18 * (i + 1) * 0.6;
      seg.rotation.y = this.sp('tY' + i, tailY * (i === 0 ? 1 : 0.3) + w - this.yawRate * 0.05 * i, 9 - i, 0.45, dt);
      if (i === 0) seg.rotation.x = this.sp('tX0', tailX0, 7, 0.5, dt);
      else seg.rotation.x = this.sp('tX' + i, TAIL.curl[i] + Math.sin(this.t * 2.5 - i) * 0.1 + fallCurl * (i === 1 ? TAIL.fall1 : 1), 9 - i, 0.45, dt);
    });
    const flutter = 0.3 + Math.min(1, s.speed / 8) * 0.9;
    r.scarfTail.forEach((seg, i) => {
      seg.rotation.x = damp(seg.rotation.x, (i === 0 ? 0.9 - flutter * 0.7 : 0.15) + Math.sin(this.t * 9 - i * 1.3) * 0.25 * flutter + clamp(s.vy * 0.04, -0.4, 0.4), 12, dt);
      seg.rotation.y = Math.sin(this.t * 7 - i * 1.7) * 0.25 * flutter - this.yawRate * 0.04;
    });

    // oreilles : ressorts secondaires
    const accY = (s.vy - this.prevVy) / Math.max(dt, 1e-3);
    this.prevVy = s.vy;
    this.earTwitch -= dt;
    let twitch = 0;
    if (this.earTwitch < 0) { twitch = 1; this.earTwitch = 2 + Math.random() * 4; }
    for (const e of r.ears) {
      const force = clamp(accY * 0.0025, -0.5, 0.5) + (moving ? Math.sin(ph * 2) * 0.03 * run : 0) + clamp(this.yawRate * 0.02, -0.3, 0.3) * e.s;
      e.vel += (-e.off * 160 - e.vel * 9 + force * 60) * dt;
      e.off += e.vel * dt;
      if (twitch && e.s > 0 === Math.random() > 0.5) e.vel += 5;
      e.velX += (-e.offX * 120 - e.velX * 8 + (s.speed > 6 ? 0.4 : 0) * 40 - (s.gliding ? 30 : 0) + (browAngry ? 8 : 0)) * dt;
      e.offX += e.velX * dt;
      e.ear.rotation.z = e.base.z - e.s * clamp(e.off, -0.6, 0.6);
      e.ear.rotation.x = e.base.x - clamp(e.offX, -0.2, 0.8);
    }

    // clignement des yeux (paupières) et regard
    this.blink -= dt;
    let lid = 1;
    if (this.blink < 0.12) lid = Math.abs(this.blink - 0.06) / 0.06;
    if (this.blink < 0) this.blink = 1.5 + Math.random() * 3.5;
    if (s.dead) lid = 0.15;
    else if (browAngry) lid = Math.min(lid, 0.78);
    else if (browUp > 0.5) lid = Math.min(1.1, lid + 0.1);
    for (const e of r.eyes) {
      if (e.lid) e.lid.rotation.x = LID_OPEN * Math.min(1, lid);
      else e.eye.scale.y = Math.max(0.08, lid);
    }
    this.lookT -= dt;
    if (this.lookT <= 0) {
      this.lookT = 0.8 + Math.random() * 2.2;
      this.lookX = (Math.random() - 0.5) * (s.aiming ? 0.2 : 1);
      this.lookY = (Math.random() - 0.4) * (s.aiming ? 0.2 : 0.8);
    }
    for (const e of r.eyes) {
      e.iris.position.x = damp(e.iris.position.x, this.lookX * 0.016, 18, dt);
      e.iris.position.y = damp(e.iris.position.y, -0.005 + this.lookY * 0.014, 18, dt);
      // sourcils : froncés en combat, levés quand Kobi est surpris ou plane
      if (e.brow) {
        const ang = this.sp('brA' + e.s, browAngry - browUp * 0.6, 20, 0.6, dt);
        e.brow.rotation.z = e.s * (1.35 - ang * 0.3);
        e.brow.position.y = 0.305 + browUp * 0.018 - Math.max(0, ang) * 0.012;
      }
    }

    this.recoil = Math.max(0, this.recoil - dt * 8);

    // ---- Écrou ----
    const ec = r.ecrou;
    this.rotor = damp(this.rotor, s.gliding ? 1 : 0, s.gliding ? 14 : 8, dt);
    ec.mast.scale.setScalar(Math.max(0.001, this.rotor));
    this.rotorSpin += dt * (8 + this.rotor * 40);
    ec.rotor.rotation.y = this.rotorSpin;
    ec.headJ.rotation.y = Math.sin(this.t * 0.8) * 0.4 + clamp(this.yawRate * 0.08, -0.4, 0.4);
    ec.headJ.rotation.x = Math.sin(this.t * 1.3) * 0.08;
    ec.tip.scale.setScalar(Math.sin(this.t * 6) > 0.6 ? 1.3 : 0.8);
    const jetOn = s.jets > 0;
    for (const j of ec.jets) {
      j.visible = jetOn;
      if (jetOn) j.scale.set(1, s.jets * (0.8 + Math.random() * 0.4), 1);
    }
    ec.eye.scale.y = Math.sin(this.t * 0.9) > 0.97 ? 0.15 : 1;
    // jambes qui pendent et bras qui se balancent (inertie de Kobi)
    if (ec.legsE) {
      const swing = clamp(-s.vy * 0.04, -0.6, 0.7) + (moving ? 0.25 * run : 0);
      // les pieds pendent un peu en avant (sur le dos, la racine de la queue de Kobi passe juste dessous) et ne
      // reviennent pas vers elle quand Kobi s'élance vers le haut
      // (quand Kobi se cambre en visant, son buste et Écrou descendent vers la queue : les pieds se relèvent d'autant)
      const legSwing = Math.max(swing, -0.2) + clamp(-r.spine.rotation.x, 0, 0.4) * 2;
      ec.legsE.forEach((l, i) => { l.rotation.x = this.sp('ecL' + i, Math.max(0.55, 0.6 + legSwing + Math.sin(this.t * (moving ? 9 : 2) + i * Math.PI) * (moving ? 0.35 : 0.08)), 14, 0.35, dt); });
      ec.armsE.forEach((a, i) => { a.rotation.x = this.sp('ecA' + i, -0.9 + (s.gliding ? -0.9 : 0) + Math.sin(this.t * 2.2 + i) * 0.12 + swing * 0.4, 12, 0.4, dt); });
    }
    if (r.fur) r.fur.update(dt);
  }
}

function angleWrap(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}
