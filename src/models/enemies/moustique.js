import * as THREE from 'three';
import { G, part, joint, mergeGeometries } from '../geo.js';
import { mat, glow } from '../../engine/materials.js';
import { rig } from './common.js';

// ===================================================================== Moustique (essaim)
// Mini-drone-insecte : thorax laqué vert à jointures rivetées, tête aux gros yeux composés à facettes, trompe-aiguille
// chromée, abdomen segmenté éclairé de l'intérieur, réservoir dorsal à fiole lumineuse, ailes de verre nervurées,
// pattes fines repliées. On les rencontre par nuées : les pièces fixes sont fusionnées et mises en cache.

// Tige cylindrique de a à b (rayons r0 → r1), non indexée
const _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);
function rod(a, b, r0, r1 = r0, seg = 6) {
  _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const g = new THREE.CylinderGeometry(r1, r0, _d.length(), seg, 1).toNonIndexed();
  g.applyQuaternion(_q.setFromUnitVectors(_up, _d.normalize()));
  return g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
}
const ball = (r, p, ws = 6, hs = 4) => new THREE.SphereGeometry(r, ws, hs).toNonIndexed().translate(p[0], p[1], p[2]);
const merged = (list) => {
  const g = mergeGeometries(list);
  g.userData.shared = true;
  for (const p of list) p.dispose();
  return g;
};

// ------------------------------------------------------------------ aile de verre nervurée
// Contour de l'aile dans son plan (u : envergure, v : corde, v > 0 vers l'avant), en mètres
const WING = [[0, 0.012], [0.07, 0.028], [0.17, 0.03], [0.26, 0.016], [0.305, -0.008], [0.3, -0.035], [0.25, -0.058],
  [0.16, -0.068], [0.08, -0.058], [0.02, -0.034], [0, -0.016]];
const WU = 0.31, WV0 = -0.07, WV = 0.1;
// Texture : membrane irisée (cyan → mauve → vert vers la pointe), nervures sombres en éventail, cellules, liseré
function wingTexture() {
  const W = 512, H = 192;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const P = ([u, v]) => [(u / WU) * W, (1 - (v - WV0) / WV) * H];
  const outline = () => { x.beginPath(); WING.forEach((p, i) => { const [a, b] = P(p); if (i) x.lineTo(a, b); else x.moveTo(a, b); }); x.closePath(); };
  const g = x.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(170,235,255,0.55)');
  g.addColorStop(0.45, 'rgba(205,200,255,0.32)');
  g.addColorStop(0.8, 'rgba(190,255,215,0.3)');
  g.addColorStop(1, 'rgba(230,255,240,0.45)');
  outline();
  x.fillStyle = g;
  x.fill();
  x.save();
  outline();
  x.clip();
  // nervures longitudinales en éventail depuis l'emplanture
  x.strokeStyle = 'rgba(28,46,52,0.9)';
  x.lineCap = 'round';
  const root = P([0.005, -0.012]);
  const tips = [[0.3, 0.004], [0.3, -0.03], [0.24, -0.06], [0.16, -0.07], [0.09, -0.062]];
  const veins = tips.map(([u, v], i) => {
    const [a, b] = P([u, v]);
    const cx = root[0] + (a - root[0]) * 0.45, cy = root[1] + (b - root[1]) * 0.3 - 8;
    x.lineWidth = i === 0 ? 5 : 3.2;
    x.beginPath(); x.moveTo(root[0], root[1]); x.quadraticCurveTo(cx, cy, a, b); x.stroke();
    return (t) => {
      const it = 1 - t;
      return [it * it * root[0] + 2 * it * t * cx + t * t * a, it * it * root[1] + 2 * it * t * cy + t * t * b];
    };
  });
  // nervures transverses : cellules irrégulières entre deux longitudinales
  x.lineWidth = 2;
  const ts = [[0.3, 0.55, 0.78], [0.4, 0.66, 0.86], [0.35, 0.6], [0.45, 0.75], [0.5]];
  for (let i = 0; i < veins.length - 1; i++) {
    for (const t of ts[i]) {
      const [a, b] = veins[i](t), [c2, d] = veins[i + 1](t + 0.05);
      x.beginPath(); x.moveTo(a, b); x.lineTo(c2, d); x.stroke();
    }
  }
  // cellule pigmentée près de la pointe (tache, comme sur une aile de moustique)
  x.fillStyle = 'rgba(40,70,60,0.35)';
  const [sa, sb] = P([0.235, 0.008]);
  x.beginPath(); x.ellipse(sa, sb, 22, 9, -0.25, 0, Math.PI * 2); x.fill();
  x.restore();
  // liseré du contour, plus épais au bord d'attaque
  outline();
  x.strokeStyle = 'rgba(28,46,52,0.95)';
  x.lineWidth = 4;
  x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.userData.shared = true;
  return t;
}
function wingGeometry() {
  const s = new THREE.Shape(WING.map(([u, v]) => new THREE.Vector2(u, v)));
  const g = new THREE.ShapeGeometry(s, 4);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / WU, (p.getY(i) - WV0) / WV);
  g.rotateX(Math.PI / 2); // v (corde) → +z
  // léger galbe : l'aile se cambre vers le bas au bord de fuite
  for (let i = 0; i < p.count; i++) p.setY(i, -Math.max(0, -p.getZ(i)) * 0.18 + p.getX(i) * 0.04);
  g.computeVertexNormals();
  g.userData.shared = true;
  return g;
}

// ------------------------------------------------------------------ pièces fusionnées (communes à toute la nuée)
let K = null;
function kit() {
  if (K) return K;
  K = {};
  K.wingTex = wingTexture();
  K.wing = wingGeometry();
  // nervure d'attaque et charnière, dans le repère de l'articulation de l'aile droite
  K.spar = merged([
    rod([0, 0, 0.008], [0.17, 0.0068, 0.03], 0.0055, 0.0035, 5),
    rod([0.17, 0.0068, 0.03], [0.295, 0.012, 0.0], 0.0035, 0.002, 5),
    new THREE.CylinderGeometry(0.012, 0.012, 0.02, 8).toNonIndexed().rotateZ(Math.PI / 2),
  ]);
  // pattes repliées (fémur, tibia, tarse) + rotules, antennes, durites, grilles des ouïes : un seul maillage sombre
  const legs = [];
  const LEG = [ // hanche, genou, cheville, pied
    [[0.035, -0.068, 0.045], [0.085, -0.09, 0.085], [0.06, -0.135, 0.11], [0.045, -0.155, 0.08]],
    [[0.045, -0.072, 0.0], [0.105, -0.1, 0.01], [0.08, -0.15, -0.04], [0.06, -0.165, -0.08]],
    [[0.04, -0.07, -0.05], [0.1, -0.095, -0.075], [0.07, -0.13, -0.15], [0.05, -0.14, -0.2]],
  ];
  for (const s of [-1, 1]) {
    for (const L of LEG) {
      const q = L.map(([a, b, c]) => [a * s, b, c]);
      legs.push(rod(q[0], q[1], 0.0075, 0.0055), rod(q[1], q[2], 0.0048, 0.0036), rod(q[2], q[3], 0.0032, 0.0022, 5));
      legs.push(ball(0.0085, q[1]), ball(0.006, q[2]));
    }
    // antenne coudée (fouet de capteur)
    const a0 = [s * 0.02, 0.06, 0.165], a1 = [s * 0.04, 0.098, 0.212], a2 = [s * 0.066, 0.112, 0.262];
    legs.push(rod(a0, a1, 0.0045, 0.0035, 5), rod(a1, a2, 0.0035, 0.002, 5), ball(0.006, a1));
  }
  // durites : du réservoir dorsal vers l'abdomen, de chaque côté
  for (const s of [-1, 1]) {
    const c = new THREE.CatmullRomCurve3([[s * 0.022, 0.1, -0.06], [s * 0.04, 0.085, -0.11], [s * 0.045, 0.045, -0.145]].map((v) => new THREE.Vector3(...v)));
    legs.push(new THREE.TubeGeometry(c, 8, 0.0065, 5).toNonIndexed());
  }
  // ouïes des flancs : cadre et trois lames
  for (const s of [-1, 1]) {
    legs.push(new THREE.TorusGeometry(0.025, 0.0035, 4, 16).toNonIndexed().rotateY(Math.PI / 2).translate(s * 0.089, -0.002, -0.02));
    for (const y of [-0.012, 0, 0.012]) legs.push(new THREE.BoxGeometry(0.005, 0.0045, 2 * Math.sqrt(0.025 ** 2 - y * y)).toNonIndexed().translate(s * 0.088, y - 0.002, -0.02));
  }
  K.legs = merged(legs);
  // œil composé : icosphère à facettes, chaque facette d'une teinte un peu différente
  const eg = new THREE.IcosahedronGeometry(0.047, 2);
  const ec = new Float32Array(eg.attributes.position.count * 3);
  for (let f = 0; f < ec.length / 9; f++) {
    const v = 0.55 + 0.45 * Math.abs(Math.sin(f * 12.9898) * 43758.5453 % 1);
    for (let j = 0; j < 9; j++) ec[f * 9 + j] = v;
  }
  eg.setAttribute('color', new THREE.BufferAttribute(ec, 3));
  eg.userData.shared = true;
  K.eye = eg;
  // anneaux lumineux entre les segments de l'abdomen
  K.rings = merged(ABDO.slice(0, -1).map(([p, r], i) => {
    const q = ABDO[i + 1][0];
    return new THREE.TorusGeometry(r[0] * 0.7, 0.0085, 5, 18).toNonIndexed().scale(1, r[1] / r[0], 1)
      .rotateX(ABDO_TILT).translate((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2);
  }));
  // rivets (calottes) sur la jointure du thorax
  const riv = [];
  for (let i = 0; i < 9; i++) {
    const a = -1.25 + (i / 8) * 2.5; // de flanc à flanc, par-dessus
    const nx = Math.sin(a), ny = Math.cos(a);
    const g = new THREE.SphereGeometry(0.0055, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed();
    g.applyQuaternion(_q.setFromUnitVectors(_up, new THREE.Vector3(nx, ny, 0.15).normalize()));
    riv.push(g.translate(nx * 0.086, ny * 0.079 + 0.004, 0.066));
  }
  K.rivets = merged(riv);
  // aiguille (trompe) : fourreau, bague, aiguille effilée
  K.needle = merged([
    rod([0, -0.022, 0.205], [0, -0.032, 0.24], 0.011, 0.008, 8),
    new THREE.TorusGeometry(0.01, 0.0035, 5, 12).toNonIndexed().rotateX(-0.25).translate(0, -0.03, 0.235),
    rod([0, -0.032, 0.24], [0, -0.07, 0.4], 0.0045, 0.0007, 8),
  ]);
  return K;
}

// Segments de l'abdomen : centre, rayons (du plus large au dard)
const ABDO_TILT = -0.28;
const ABDO = [
  [[0, -0.008, -0.135], [0.068, 0.06, 0.048]],
  [[0, -0.024, -0.192], [0.064, 0.056, 0.045]],
  [[0, -0.041, -0.245], [0.056, 0.049, 0.041]],
  [[0, -0.058, -0.292], [0.045, 0.04, 0.036]],
  [[0, -0.073, -0.332], [0.031, 0.028, 0.03]],
];

export function moustique() {
  const { S, root, B, skin } = rig({
    body: { color: '#4fdc7a', rough: 0.3, metal: 0.35, sheen: 0.25, coat: 0.9 },
    bodyD: { color: '#1f8f52', rough: 0.34, metal: 0.4, coat: 0.75 },
    dark: { color: '#1c2628', rough: 0.45, metal: 0.5, coat: 0.25 },
    metal: { color: '#a3adb8', rough: 0.26, metal: 0.85, coat: 0.2 },
    brass: { color: '#e3a83c', rough: 0.3, metal: 0.8, coat: 0.4 },
    mark: { color: '#f4e04a', rough: 0.35, metal: 0.2, coat: 0.8 },
  });
  const k = kit();
  const body = B(root, [0, 0, 0], 'body');
  // --- thorax : coque bombée, plaque dorsale sombre, jointure transverse, ouïes sur les flancs
  S.add(body, { t: 'ell', r: [0.092, 0.084, 0.102], p: [0, 0.004, 0], col: 'body', k: 0.02 });
  S.add(body, { t: 'ell', r: [0.07, 0.032, 0.08], p: [0, 0.058, -0.012], col: 'bodyD', k: 0.018 });
  S.add(body, { t: 'ell', r: [0.075, 0.05, 0.085], p: [0, -0.04, 0], col: 'dark', k: 0.03 });
  S.sub(body, { t: 'torus', R: 0.084, r: 0.0055, sc: [1.03, 0.95, 1], p: [0, 0.004, 0.062], rot: [Math.PI / 2 - 0.15, 0, 0], col: 'dark', k: 0.004 });
  for (const s of [-1, 1]) {
    // logement de l'ouïe (sa grille est dans kit().legs)
    S.sub(body, { t: 'ell', r: [0.01, 0.026, 0.026], p: [s * 0.097, -0.002, -0.02], col: 'dark', k: 0.004 });
    // carter de l'articulation d'aile
    S.add(body, { t: 'cyl', r: 0.019, h: 0.014, round: 0.005, p: [s * 0.078, 0.098, -0.02], rot: [0, 0, Math.PI / 2], col: 'metal', k: 0.008 });
  }
  // chevrons peints sur l'avant du dos
  S.paint(body, { t: 'box', s: [0.009, 0.05, 0.03], round: 0.002, p: [0.03, 0.07, 0.05], rot: [0, -0.6, 0], col: 'mark', feather: 0.003 });
  S.paint(body, { t: 'box', s: [0.009, 0.05, 0.03], round: 0.002, p: [-0.03, 0.07, 0.05], rot: [0, 0.6, 0], col: 'mark', feather: 0.003 });
  // éclats de peinture (métal nu) sur les arêtes exposées
  for (const [x, y, z] of [[0.55, 0.55, 0.62], [-0.7, 0.5, 0.5], [0.9, -0.1, -0.42], [-0.35, 0.75, -0.55], [-0.85, -0.3, 0.4], [0.25, 0.3, 0.92]]) {
    const n = Math.hypot(x, y, z);
    S.paint(body, { t: 'sph', r: 0.011, p: [0.092 * x / n, 0.004 + 0.084 * y / n, 0.102 * z / n], fuzz: [0.005, 140], col: 'metal', feather: 0.002 });
  }
  // --- réservoir dorsal (cuve de métal cerclée de laiton) et ses brides
  S.add(body, { t: 'cyl', r: 0.03, h: 0.048, round: 0.014, p: [0, 0.104, -0.035], rot: [Math.PI / 2, 0, 0], col: 'metal', k: 0.012 });
  for (const z of [-0.07, 0.0]) S.paint(body, { t: 'cyl', r: 0.04, h: 0.007, round: 0.002, p: [0, 0.104, z], rot: [Math.PI / 2, 0, 0], col: 'brass', feather: 0.003 });
  // --- tête : crâne, mufle qui porte la trompe, orbites
  S.add(body, { t: 'ell', r: [0.062, 0.058, 0.06], p: [0, 0.018, 0.125], col: 'body', k: 0.02 });
  S.add(body, { t: 'cone', a: [0, -0.002, 0.15], b: [0, -0.02, 0.205], r1: 0.032, r2: 0.016, col: 'dark', k: 0.016 });
  S.paint(body, { t: 'ell', r: [0.05, 0.02, 0.05], p: [0, 0.07, 0.13], col: 'bodyD', feather: 0.006 });
  for (const s of [-1, 1]) S.add(body, { t: 'sph', r: 0.036, p: [s * 0.047, 0.026, 0.136], col: 'dark', k: 0.01 });
  // --- abdomen : anneaux emboîtés, plaques vertes dessus, ventre sombre, dard-feu au bout
  ABDO.forEach(([p, r], i) => {
    S.add(body, { t: 'ell', r, p, rot: [ABDO_TILT, 0, 0], col: 'dark', k: 0.006 });
    S.paint(body, { t: 'ell', r: [r[0] * 0.78, r[1] * 0.55, r[2] * 1.1], p: [p[0], p[1] + r[1] * 0.8, p[2]], col: i % 2 ? 'bodyD' : 'body', feather: 0.006 });
  });
  skin('moustique', { mesh: { cell: 0.0095, skinSoft: 0.02 }, mat: { enemyRim: true }, outline: 0.009 });

  // --- matières
  const chrome = mat('#e6edf4', { rough: 0.12, metal: 1 });
  const darkM = mat('#232b2e', { rough: 0.4, metal: 0.7 });
  const brass = mat('#e3a83c', { rough: 0.3, metal: 0.8, coat: 0.4 });
  const lume = glow('#b4ff4a', 2.2);
  const facet = mat('#ff3424', { rough: 0.14, metal: 0.3, emissive: '#ff1a08', emissiveIntensity: 0.45, flat: true, vertexColors: true });
  const wingM = mat('#ffffff', { map: k.wingTex, transparent: true, rough: 0.12, metal: 0.1, coat: 0.6, side: THREE.DoubleSide });
  wingM.depthWrite = false;
  wingM.iridescence = 0.8;
  wingM.iridescenceIOR = 1.35;

  part(body, k.legs, darkM, { shadow: false });
  part(body, k.rivets, brass, { shadow: false });
  part(body, k.rings, lume, { shadow: false });
  const needle = part(body, k.needle, chrome, { shadow: false });
  // fiole lumineuse sur le réservoir, feu au bout de l'abdomen, pointes d'antennes
  const tank = part(body, G.capsule(0.014, 0.04, 3, 8), lume, { p: [0, 0.135, -0.035], r: [Math.PI / 2, 0, 0], shadow: false });
  const [tp, tr] = ABDO[ABDO.length - 1];
  part(body, G.sphere(0.017, 10, 8), lume, { p: [0, tp[1] - 0.012, tp[2] - tr[2] * 0.75], shadow: false });
  for (const s of [-1, 1]) part(body, G.sphere(0.008, 6, 4), glow('#ff5a3a', 2.4), { p: [s * 0.066, 0.112, 0.262], shadow: false });
  // yeux composés : globes à facettes, rouges et luisants
  const eye = joint(body, [0, 0.028, 0.138]);
  for (const s of [-1, 1]) part(eye, k.eye, facet, { p: [s * 0.064, 0, 0.008], s: [0.8, 1, 0.95], shadow: false });

  // ailes (avant + arrière sur la même articulation, qui bat)
  const wings = [];
  for (const s of [-1, 1]) {
    const w = joint(body, [s * 0.08, 0.1, -0.02]);
    part(w, k.wing, wingM, { p: [s * 0.004, 0.004, 0], s: [s, 1, 1], r: [0, s * 0.22, 0], shadow: false });
    part(w, k.wing, wingM, { p: [s * 0.004, -0.004, -0.02], s: [s * 0.74, 1, 0.82], r: [0, s * 0.62, 0], shadow: false });
    part(w, k.spar, darkM, { s: [s, 1, 1], r: [0, s * 0.22, 0], shadow: false });
    wings.push(w);
  }
  // modelé à l'échelle d'Écrou, agrandi d'un bloc (os et pièces) pour rester lisible au milieu de la nuée
  body.scale.setScalar(1.2);
  return { root, debrisColor: '#5aff8a', body, eye, wings, chunks: [needle, tank] };
}
