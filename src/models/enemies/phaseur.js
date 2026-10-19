import * as THREE from 'three';
import { G, part, joint, bake } from '../geo.js';
import { mat, glow } from '../../engine/materials.js';
import { paintedMetalTexture } from '../../engine/textures.js';
import { OL, rig } from './common.js';

// ===================================================================== Phaseur
// Drone-toupie de phase : dôme de céramique à l'œil-capteur, ceinture de coque aux fentes lumineuses, cœur de phase
// derrière une grille, segments inférieurs emboîtés jusqu'à la pointe de cristal ; anneau-cardan de métal à émetteurs
// (il culbute autour du drone : tout le corps tient dans une sphère de 0,74 m autour de son pivot), mains flottantes.
const TAU = Math.PI * 2;
const RING_R = 0.8; // rayon moyen de l'anneau-cardan (bord intérieur 0,775)
const RING_N = 6; // plaques et émetteurs de l'anneau
// fentes lumineuses de la ceinture (angles autour de l'axe ; l'avant, libre, porte le hublot du cœur)
const SLITS = [55, 90, 125, 160, -55, -90, -125, -160].map((d) => (d * Math.PI) / 180);

// Géométries fixes (fusionnées une fois par matériau, partagées entre instances)
let GEO = null;
const _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3();
const _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
// pièce posée en p, tournée par les angles r (ordre o), échelle s
const at = (g, p, r = [0, 0, 0], s = 1, o = 'XYZ') => [g, new THREE.Matrix4().compose(_p.set(...p),
  _q.setFromEuler(_e.set(r[0], r[1], r[2], o)), typeof s === 'number' ? _s.setScalar(s) : _s.set(...s))];
// pièce dont l'axe Y pointe vers dir
const atDir = (g, p, dir, s = 1) => [g, new THREE.Matrix4().compose(_p.set(...p),
  _q.setFromUnitVectors(_up, _d.set(...dir).normalize()), typeof s === 'number' ? _s.setScalar(s) : _s.set(...s))];
// rivet : calotte basse tournée vers n
const rivetAt = (list, p, n, r = 0.013) => list.push(atDir(G.sphere(r, 6, 2), p, n, [1, 0.5, 1]));
// décharge : ligne brisée de fins prismes de a à b (zigzag déterministe)
function zigzag(list, a, b, n, amp, seed) {
  const A = new THREE.Vector3(...a), d = new THREE.Vector3(...b).sub(A);
  const side = new THREE.Vector3().crossVectors(d, _up);
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  side.normalize();
  const up2 = new THREE.Vector3().crossVectors(side, d).normalize();
  const pts = [A];
  for (let i = 1; i < n; i++) {
    const h = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453, j = (h - Math.floor(h)) * 2 - 1;
    pts.push(A.clone().addScaledVector(d, i / n).addScaledVector(i % 2 ? side : up2, amp * (0.6 + 0.4 * Math.abs(j)) * (i % 4 < 2 ? 1 : -1)));
  }
  pts.push(new THREE.Vector3(...b));
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i], p1 = pts[i + 1], dir = p1.clone().sub(p0);
    list.push(atDir(G.cyl(0.006, 0.006, dir.length() + 0.008, 3), p0.clone().add(p1).multiplyScalar(0.5).toArray(), dir.toArray()));
  }
}
// plaque de l'anneau : arc de profil plat (rainure sur la face extérieure) ; UV de 0 à 1 le long de l'arc
function ringArc(a0, a1) {
  const ri = RING_R - 0.02, ro = RING_R + 0.022, h = 0.034, c = 0.007;
  const prof = [[ri, -h + c], [ri + c, -h], [ro - c, -h], [ro, -h + c], [ro, -0.01], [ro - 0.01, -0.008], [ro - 0.01, 0.008],
    [ro, 0.01], [ro, h - c], [ro - c, h], [ri + c, h], [ri, h - c], [ri, -h + c]];
  return new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 12, a0, a1 - a0);
}
function buildGeo() {
  const L = () => [];
  const R = { plates: L(), metal: L(), lens: L(), rivets: L(), arcs: L(), dash: L() }; // anneau (repère de l'anneau)
  const Bd = { panels: L(), metal: L(), rivets: L(), fins: L(), arcs: L(), crystal: L(), slits: L(), blades: L() }; // corps
  const H = { metal: L() }; // main (repère de la main)
  // --- anneau-cardan : plaques peintes, émetteurs aux jointures (lentille tournée vers le cœur), rivets
  const gap = 0.2;
  for (let i = 0; i < RING_N; i++) {
    const a0 = (i / RING_N) * TAU + gap / 2, a1 = ((i + 1) / RING_N) * TAU - gap / 2;
    R.plates.push([ringArc(a0, a1), null]);
    for (const k of [0.2, 0.5, 0.8]) {
      const a = a0 + (a1 - a0) * k, x = Math.sin(a) * (RING_R + 0.002), z = Math.cos(a) * (RING_R + 0.002);
      rivetAt(R.rivets, [x, 0.034, z], [0, 1, 0], 0.009);
      rivetAt(R.rivets, [x, -0.034, z], [0, -1, 0], 0.009);
    }
    // émetteur : boîtier arrondi, collier et lentille vers l'intérieur, témoin à l'extérieur
    const a = (i / RING_N) * TAU, s = Math.sin(a), c = Math.cos(a);
    R.metal.push(at(G.rbox(0.075, 0.11, 0.08, 0.02, 2), [s * RING_R, 0, c * RING_R], [0, a, 0]));
    R.metal.push(atDir(G.cyl(0.026, 0.036, 0.04, 10), [s * (RING_R - 0.052), 0, c * (RING_R - 0.052)], [-s, 0, -c]));
    R.lens.push(at(G.sphere(0.023, 10, 6), [s * (RING_R - 0.072), 0, c * (RING_R - 0.072)]));
    R.lens.push(at(G.sphere(0.012, 6, 4), [s * (RING_R + 0.04), 0.03, c * (RING_R + 0.04)]));
    for (const y of [-0.055, 0.055]) rivetAt(R.rivets, [s * (RING_R + 0.0375), y, c * (RING_R + 0.0375)], [s, 0, c], 0.01);
  }
  // décharges le long de l'anneau, entre deux émetteurs
  for (const i of [0, 3]) {
    const a0 = (i / RING_N) * TAU + 0.12, a1 = ((i + 1) / RING_N) * TAU - 0.12, am = (a0 + a1) / 2;
    const P = (a, r, y) => [Math.sin(a) * r, y, Math.cos(a) * r];
    zigzag(R.arcs, P(a0, RING_R + 0.03, 0.02), P(am, RING_R + 0.055, -0.01), 5, 0.022, i + 1);
    zigzag(R.arcs, P(am, RING_R + 0.055, -0.01), P(a1, RING_R + 0.03, 0.02), 5, 0.022, i + 7);
  }
  // anneau d'énergie en pointillés, un peu incliné sur l'anneau de métal
  for (let i = 0; i < 12; i++) R.dash.push(at(G.torus(0.88, 0.009, 4, 6, 0.32), [0, 0, 0], [Math.PI / 2 + 0.25, 0, (i / 12) * TAU], 1, 'XYZ'));
  // --- dérive dorsale sur l'arrière du dôme et stabilisateurs du bas (quatre)
  Bd.fins.push(at(G.rbox(0.03, 0.13, 0.24, 0.014, 2), [0, 0.5, -0.2], [0.75, 0, 0]));
  for (const z of [-0.14, -0.24]) for (const s of [-1, 1]) rivetAt(Bd.rivets, [s * 0.016, 0.47 + (z + 0.2) * -0.9, z], [s, 0, 0], 0.01);
  for (let i = 0; i < 4; i++) {
    const a = (i + 0.5) * (TAU / 4), s = Math.sin(a), c = Math.cos(a);
    Bd.fins.push(at(G.rbox(0.03, 0.17, 0.16, 0.012, 2), [s * 0.25, -0.4, c * 0.25], [-0.55, a, 0], 1, 'YXZ'));
    rivetAt(Bd.rivets, [s * 0.272, -0.37, c * 0.272], [s, 0, c], 0.011);
  }
  // --- pointe de cristal : bipyramide hexagonale, éclats autour, décharges depuis deux stabilisateurs
  Bd.crystal.push(at(G.cone(0.085, 0.07, 6), [0, -0.525, 0]));
  Bd.crystal.push(at(G.cone(0.085, 0.2, 6), [0, -0.66, 0], [Math.PI, 0, 0]));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.4, s = Math.sin(a), c = Math.cos(a);
    Bd.crystal.push(atDir(G.cone(0.03, 0.11, 5), [s * 0.09, -0.6, c * 0.09], [s * 0.6, -1, c * 0.6]));
  }
  for (const i of [0, 2]) {
    const a = (i + 0.5) * (TAU / 4), s = Math.sin(a), c = Math.cos(a);
    zigzag(Bd.arcs, [s * 0.32, -0.48, c * 0.32], [s * 0.05, -0.64, c * 0.05], 4, 0.02, i + 21);
  }
  // --- segments inférieurs emboîtés : deux étages de six panneaux de tôle (bourrelet en haut, rebord en bas),
  // un rivet par panneau ; les jours entre panneaux laissent voir le noyau sombre
  const SEG = [
    [[0.33, -0.08], [0.372, -0.068], [0.382, -0.09], [0.36, -0.13], [0.3, -0.24], [0.272, -0.29], [0.278, -0.3], [0.25, -0.3], [0.31, -0.13], [0.33, -0.08]],
    [[0.235, -0.31], [0.265, -0.31], [0.268, -0.33], [0.24, -0.37], [0.17, -0.45], [0.152, -0.47], [0.13, -0.465], [0.2, -0.36], [0.235, -0.31]],
  ];
  for (const [j, prof] of SEG.entries()) {
    const v2 = prof.map(([r, y]) => new THREE.Vector2(r, y)).reverse(); // sens du profil : faces vers l'extérieur
    for (let i = 0; i < 6; i++) {
      const g0 = (i / 6) * TAU + 0.03 + j * 0.5;
      Bd.panels.push([new THREE.LatheGeometry(v2, 8, g0, TAU / 6 - 0.06), null]);
      const a = g0 + TAU / 12, s = Math.sin(a), c = Math.cos(a), r = j ? 0.245 : 0.355, y = j ? -0.345 : -0.125;
      rivetAt(Bd.rivets, [s * r, y, c * r], [s, 0.45, c], 0.012);
    }
  }
  // --- rivets de la ceinture (deux rangs, sur l'ellipsoïde 0,5 × 0,17 centrée en y = 0,05)
  for (let i = 0; i < 16; i++) {
    const a = ((i + 0.5) / 16) * TAU, s = Math.sin(a), c = Math.cos(a);
    for (const y of [0.15, -0.05]) {
      const t = (y - 0.05) / 0.17, r = 0.5 * Math.sqrt(1 - t * t);
      rivetAt(Bd.rivets, [s * r, y, c * r], [(s * r) / 0.25, t / 0.17, (c * r) / 0.25]);
    }
  }
  // --- boulons du capot (sillon du sommet)
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * TAU, s = Math.sin(a), c = Math.cos(a);
    rivetAt(Bd.rivets, [s * 0.262, 0.478, c * 0.262], [s * 0.5, 1, c * 0.5], 0.012);
  }
  // --- hublot du cœur : lunette, deux barreaux et une traverse ; moyeu du sommet et antenne
  Bd.metal.push(at(G.torus(0.14, 0.02, 8, 28), [0, 0.065, 0.45]));
  for (const x of [-0.05, 0.05]) Bd.metal.push(at(G.cyl(0.012, 0.012, 0.23, 8), [x, 0.065, 0.46]));
  Bd.metal.push(at(G.cyl(0.01, 0.01, 0.23, 8), [0, 0.065, 0.465], [0, 0, Math.PI / 2]));
  Bd.metal.push(at(G.cyl(0.075, 0.09, 0.04, 14), [0, 0.565, 0]));
  Bd.metal.push(at(G.cyl(0.008, 0.012, 0.11, 6), [0.03, 0.635, -0.03]));
  // --- lueur du cœur au fond des fentes
  for (const a of SLITS) Bd.slits.push(at(G.box(0.04, 0.15, 0.03), [Math.sin(a) * 0.425, 0.05, Math.cos(a) * 0.425], [0, a, 0]));
  // --- main : manchette et douille du poignet, trois griffes vers l'avant autour de l'émetteur de la paume
  H.metal.push(at(G.torus(0.068, 0.022, 6, 16), [0, 0, -0.055]));
  H.metal.push(at(G.cyl(0.05, 0.04, 0.05, 10), [0, 0, -0.085], [Math.PI / 2, 0, 0]));
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU + Math.PI / 2, x = Math.cos(a) * 0.055, y = Math.sin(a) * 0.055;
    H.metal.push(atDir(G.cone(0.022, 0.1, 6), [x, y, 0.08], [-x * 2.5, -y * 2.5, 1]));
  }
  // --- lamelles de l'iris de l'œil (repère de l'œil)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    Bd.blades.push(at(G.box(0.05, 0.016, 0.008), [Math.cos(a) * 0.042, Math.sin(a) * 0.042, 0.05], [0, 0, a + Math.PI / 2 + 0.5]));
  }
  // l'anneau culbute autour de l'axe avant : son point avant reste devant le hublot, on y met une plaque (pas un émetteur)
  const rot = new THREE.Matrix4().makeRotationY(TAU / (2 * RING_N));
  for (const l of Object.values(R)) for (const e of l) e[1] = e[1] ? rot.clone().multiply(e[1]) : rot.clone();
  const merge = (o) => Object.fromEntries(Object.entries(o).map(([k, l]) => { const m = bake(l); m.userData.shared = true; return [k, m]; }));
  GEO = { ring: merge(R), body: merge(Bd), hand: merge(H) };
  return GEO;
}

export function phaseur() {
  const { ring: gr, body: gb, hand: gh } = GEO || buildGeo();
  const { S, root, B, skin } = rig({
    shell: { color: '#2b1f62', rough: 0.3, metal: 0.4, sheen: 0.35, coat: 0.85 },
    trim: { color: '#c890ff', rough: 0.25, metal: 0.5, coat: 0.6 },
    white: { color: '#d8ccf4', rough: 0.32, metal: 0.15, sheen: 0.3, coat: 0.85 },
    dark: { color: '#17122a', rough: 0.45, metal: 0.6, coat: 0.2 },
    metal: { color: '#b4b0d2', rough: 0.3, metal: 0.85 },
  });
  const body = B(root, [0, 1.3, 0], 'body');
  // dôme de céramique, sillon de capot, visière au-dessus de l'œil
  S.add(body, { t: 'ell', r: [0.38, 0.32, 0.38], p: [0, 0.24, 0], col: 'white', k: 0.03 });
  S.add(body, { t: 'ell', r: [0.15, 0.035, 0.08], p: [0, 0.425, 0.3], rot: [-0.5, 0, 0], col: 'white', k: 0.03 });
  S.paint(body, { t: 'box', s: [0.2, 0.012, 0.2], round: 0.004, p: [0, 0.445, 0.3], rot: [-0.5, 0, 0], col: 'trim', feather: 0.006 });
  S.sub(body, { t: 'torus', R: 0.29, r: 0.012, p: [0, 0.45, 0], col: 'dark', k: 0.006 });
  S.sub(body, { t: 'sph', r: 0.125, p: [0, 0.3, 0.41], col: 'dark', k: 0.02 });
  // grille d'aération et chevron peint au dos du dôme
  for (const y of [0.22, 0.27, 0.32]) S.sub(body, { t: 'box', s: [0.09, 0.011, 0.06], round: 0.008, p: [0, y, -0.37], col: 'dark', k: 0.006 });
  for (const s of [-1, 1]) S.paint(body, { t: 'box', s: [0.085, 0.02, 0.12], round: 0.004, p: [s * 0.06, 0.43, -0.25], rot: [0, 0, s * 0.55], col: 'trim', feather: 0.004 });
  // ceinture de coque : bandeaux peints, fentes lumineuses, hublot du cœur à l'avant
  S.add(body, { t: 'ell', r: [0.5, 0.17, 0.5], p: [0, 0.05, 0], col: 'shell', k: 0.03 });
  S.sub(body, { t: 'torus', R: 0.37, r: 0.016, p: [0, 0.19, 0], col: 'dark', k: 0.006 });
  for (const y of [0.13, -0.03]) S.paint(body, { t: 'cyl', r: 0.6, h: 0.01, p: [0, y, 0], col: 'trim', feather: 0.004 });
  for (const a of SLITS) S.sub(body, { t: 'box', s: [0.024, 0.075, 0.11], round: 0.012, p: [Math.sin(a) * 0.5, 0.05, Math.cos(a) * 0.5], rot: [0, a, 0], col: 'dark', k: 0.008 });
  S.sub(body, { t: 'sph', r: 0.15, p: [0, 0.065, 0.49], col: 'dark', k: 0.02 });
  // noyau sombre sous la ceinture : visible entre les panneaux des segments inférieurs (pièces de tôle à part)
  S.add(body, { t: 'cone', a: [0, -0.08, 0], b: [0, -0.42, 0], r1: 0.33, r2: 0.12, col: 'dark', k: 0.02 });
  S.add(body, { t: 'cyl', r: 0.11, h: 0.03, round: 0.01, p: [0, -0.52, 0], col: 'metal', k: 0.02 });
  S.paint(body, { t: 'sph', r: 0.2, p: [0, -0.5, 0], col: 'dark', feather: 0.08 });
  skin('phaseur', { mesh: { cell: 0.019, skinSoft: 0.03 }, mat: { enemyRim: true, sheenColor: '#e0d0ff' } });

  const pm = paintedMetalTexture('#5b40b8', null, { chip: 0.15, edge: 0.4, bare: '#cfc8e6' });
  // lueurs (partagées) : violet du cœur, lilas pâle des décharges et lentilles, fil d'énergie, pointillés, blanc, ambre
  const GL = {
    violet: glow('#c890ff', 3), pale: glow('#e6d2ff', 3), thread: glow('#b07aff', 2.6), dash: glow('#e0c8ff', 1.8),
    white: glow('#ffffff', 2.2), amber: glow('#ffb347', 3),
  };
  const M = {
    plate: mat('#ffffff', { map: pm.map, normalMap: pm.normalMap, rough: 0.38, metal: 0.55, coat: 0.5 }),
    metal: mat('#b9b5d8', { rough: 0.3, metal: 0.85 }),
    crystal: mat('#b98cff', { rough: 0.12, metal: 0.1, emissive: '#7b3cff', emissiveIntensity: 1.3, flat: true, coat: 1 }),
    lens: mat('#120c22', { rough: 0.08, metal: 0.3, coat: 1 }),
    hand: mat('#efe8ff', { rough: 0.3, metal: 0.2, coat: 0.6 }),
  };
  // pièces fixes du corps : grille, moyeu, rivets, ailettes, cristal, décharges, fentes lumineuses
  part(body, gb.metal, M.metal, { outline: OL * 0.5 });
  part(body, gb.rivets, M.metal, { shadow: false });
  part(body, gb.fins, M.plate, { outline: OL * 0.6 });
  part(body, gb.panels, M.plate, { outline: OL * 0.5 });
  part(body, gb.crystal, M.crystal, { outline: OL * 0.5 });
  part(body, gb.arcs, GL.pale, { shadow: false });
  part(body, G.sphere(0.022, 10, 8), GL.amber, { p: [0.03, 0.69, -0.03], shadow: false });
  part(body, gb.slits, GL.violet, { shadow: false });
  // cœur de phase derrière la grille du hublot (cristal tournant, cœur blanc)
  const core = part(body, G.ico(0.095, 1), GL.violet, { p: [0, 0.065, 0.37], shadow: false });
  part(core, G.sphere(0.05, 10, 8), GL.white, { shadow: false });
  // œil-capteur : lunette de métal, verre sombre, iris à lamelles, pupille lumineuse
  const eye = joint(body, [0, 0.3, 0.33]);
  part(eye, G.torus(0.1, 0.02, 8, 24), M.metal, { p: [0, 0, 0.035], outline: OL * 0.5 });
  part(eye, G.sphere(0.095, 16, 10), M.lens, { s: [1, 1, 0.55] });
  part(eye, G.torus(0.062, 0.01, 6, 24), GL.thread, { p: [0, 0, 0.045], shadow: false });
  part(eye, gb.blades, M.lens);
  part(eye, G.sphere(0.024, 10, 8), GL.pale, { p: [0, 0, 0.05], shadow: false });
  part(eye, G.sphere(0.01, 6, 4), GL.white, { p: [0.03, 0.03, 0.055], shadow: false });
  const eyes = [eye];
  // anneau-cardan : plaques peintes, émetteurs, fil d'énergie dans la rainure ; anneau d'énergie en pointillés
  const ring = joint(body, [0, -0.05, 0]);
  part(ring, gr.plates, M.plate, { outline: OL * 0.5 });
  part(ring, gr.metal, M.metal, { outline: OL * 0.4 });
  part(ring, gr.lens, GL.pale, { shadow: false });
  part(ring, gr.rivets, M.metal, { shadow: false });
  part(ring, gr.arcs, GL.pale, { shadow: false });
  part(ring, G.torus(RING_R + 0.013, 0.006, 4, 64), GL.thread, { r: [Math.PI / 2, 0, 0], shadow: false });
  part(ring, gr.dash, GL.dash, { shadow: false });
  // mains flottantes : poing de céramique, manchette de métal au poignet, trois griffes vers l'avant autour de
  // l'émetteur de la paume (les orbes partent de là), bracelet d'énergie
  const hands = [];
  for (const s of [-1, 1]) {
    const h = joint(body, [s * 0.62, 0.1, 0.15]);
    part(h, G.ellipsoid(0.085, 0.09, 0.08, 16, 12), M.hand, { outline: OL * 0.6 });
    part(h, gh.metal, M.metal, { outline: OL * 0.4 });
    part(h, G.torus(0.1, 0.012, 5, 20), GL.thread, { p: [0, 0, -0.02], shadow: false });
    part(h, G.sphere(0.032, 10, 6), GL.pale, { p: [0, 0, 0.07], s: [1, 1, 0.6], shadow: false });
    hands.push(h);
  }
  return { root, debrisColor: '#6a4ac0', body, core, ring, eyes, hands, chunks: [hands[0], hands[1]] };
}
