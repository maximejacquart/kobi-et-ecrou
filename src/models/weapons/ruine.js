// R.U.I.N.E. : modèle tenu en main (canon vers +Z).
import * as THREE from 'three';
import { G, bake, mtx } from '../geo.js';
import { mat, glow } from '../../engine/materials.js';
import { steel } from './common.js';

const HP = Math.PI / 2;
const TAU = Math.PI * 2;
const AX = 0.09; // hauteur de l'axe du barillet
const DZ = 0.1; // départ du barillet (repère de l'arme)

// ------------------------------------------------------------------ laque noire et or (une texture par version)
// Moitié haute : panneau laqué pailleté, double filet d'or et volutes aux coins (UV de 0 à 1 par face).
// Moitié basse : cartouche gravé « R.U.I.N.E. ». Rien n'est dessiné avant le premier appel.
const TEX = new Map();
function laqueTexture(v2) {
  const key = v2 ? 'arme-ruine-v2' : 'arme-ruine';
  if (TEX.has(key)) return TEX.get(key);
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  let s = v2 ? 97 : 41;
  const R = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const gold = (y0, y1) => {
    const g = x.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, '#fff2b8'); g.addColorStop(0.45, '#f2be48'); g.addColorStop(1, '#a8701c');
    return g;
  };
  x.fillStyle = v2 ? '#4a1830' : '#1b1824';
  x.fillRect(0, 0, S, S);
  // reflets profonds de la laque et paillettes d'or
  for (let i = 0; i < 60; i++) { x.fillStyle = `rgba(${v2 ? '120,40,70' : '70,60,110'},${R() * 0.08})`; x.fillRect(0, R() * S, S, 1 + R() * 6); }
  for (let i = 0; i < 1600; i++) { x.fillStyle = `rgba(255,${190 + R() * 60 | 0},120,${0.05 + R() * 0.16})`; x.fillRect(R() * S, R() * S, 1, 1); }
  // panneau : filets d'or
  x.strokeStyle = gold(0, 128);
  x.lineWidth = 4; x.strokeRect(9, 9, S - 18, 110);
  x.lineWidth = 1.5; x.strokeRect(17, 17, S - 34, 94);
  // volutes aux coins
  x.lineWidth = 2;
  for (const [cx, cy, a] of [[17, 17, 0], [S - 17, 17, HP], [S - 17, 111, Math.PI], [17, 111, -HP]]) {
    x.beginPath(); x.arc(cx + Math.cos(a + Math.PI / 4) * 9, cy + Math.sin(a + Math.PI / 4) * 9, 6, a + Math.PI, a + Math.PI * 2.4); x.stroke();
    x.beginPath(); x.arc(cx + Math.cos(a + Math.PI / 4) * 9, cy + Math.sin(a + Math.PI / 4) * 9, 2.5, 0, TAU); x.fillStyle = gold(0, 128); x.fill();
  }
  // cartouche : bordure d'or, rivets, lettres gravées (ombre sombre puis or)
  x.fillStyle = gold(128, 256); x.fillRect(4, 132, S - 8, 120);
  x.fillStyle = v2 ? '#2a0f1c' : '#14111c'; x.fillRect(11, 139, S - 22, 106);
  x.strokeStyle = gold(140, 240); x.lineWidth = 1.5; x.strokeRect(17, 145, S - 34, 94);
  for (const [px, py] of [[26, 154], [S - 26, 154], [26, 230], [S - 26, 230]]) {
    const g = x.createRadialGradient(px - 1.5, py - 1.5, 0.5, px, py, 5);
    g.addColorStop(0, '#fff6c0'); g.addColorStop(1, '#8a5a10');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, 5, 0, TAU); x.fill();
  }
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = 'bold 46px Georgia, "Times New Roman", serif';
  x.fillStyle = '#000000'; x.fillText('R.U.I.N.E.', S / 2 + 2, 186 + 3);
  x.fillStyle = gold(165, 205); x.fillText('R.U.I.N.E.', S / 2, 186);
  x.font = 'bold 15px Georgia, "Times New Roman", serif';
  x.fillStyle = '#e8b84a'; x.fillText(v2 ? 'TOTALE · N° 001 / 001' : 'ÉDITION ULTIME · N° 001', S / 2, 222);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.userData.shared = true;
  TEX.set(key, t);
  return t;
}
const TILE = [0.5, 1], LABEL = [0, 0.5];
// copie de la géométrie dont les UV visent une moitié de la texture (u répété ru fois)
function uvs(geo, [v0, v1], ru = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ru, v0 + uv.getY(i) * (v1 - v0));
  return g;
}
// UV figées au milieu du panneau (laque unie, sans filet)
function plain(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5, 0.75);
  return g;
}

// ------------------------------------------------------------------ formes d'appoint
// ailette plate : profil [rayon, z] extrudé sur l'épaisseur t (axe tangentiel), plan radial X / axial Z
function finGeo(pts, t) {
  const sh = new THREE.Shape();
  pts.forEach(([r, z], i) => (i ? sh.lineTo(r, z) : sh.moveTo(r, z)));
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false });
  // UV du panneau à filets d'or étalées sur le profil
  g.computeBoundingBox();
  const { min, max } = g.boundingBox, pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) - min.x) / (max.x - min.x), 0.5 + 0.5 * (pos.getY(i) - min.y) / (max.y - min.y));
  g.translate(0, 0, -t / 2).rotateX(HP);
  return g;
}
// couronne d'or (emblème), plan XY, centrée
function crownGeo() {
  const sh = new THREE.Shape();
  const P = [[-0.03, -0.018], [0.03, -0.018], [0.034, 0.02], [0.018, 0.004], [0.0, 0.028], [-0.018, 0.004], [-0.034, 0.02]];
  P.forEach(([px, py], i) => (i ? sh.lineTo(px, py) : sh.moveTo(px, py)));
  sh.closePath();
  return new THREE.ExtrudeGeometry(sh, { depth: 0.006, bevelEnabled: false });
}
// matrice : rotation autour de Z (angle a) d'une pièce posée en (r, 0, z), inclinée de th autour de Y
const _m = new THREE.Matrix4(), _n = new THREE.Matrix4();
function polar(a, r, z, th = 0, ry = 0) {
  return new THREE.Matrix4().makeRotationZ(a).multiply(_m.makeTranslation(r, 0, z)).multiply(_n.makeRotationY(th)).multiply(new THREE.Matrix4().makeRotationX(ry));
}
// afficheur à sept segments (vu de l'arrière : x inversé), centre (cx, cy), plan z
const SEG = { a: [0, 1, 1], b: [1, 0.5, 0], c: [1, -0.5, 0], d: [0, -1, 1], e: [-1, -0.5, 0], f: [-1, 0.5, 0], g: [0, 0, 1] };
const DIGITS = { 1: 'bc', 2: 'abged', 8: 'abcdefg' };
function digit(put, n, cx, cy, z) {
  const w = 0.013, h = 0.021, t = 0.0055;
  for (const k of DIGITS[n]) {
    const [sx, sy, hor] = SEG[k];
    put('glow', hor ? G.box(w * 1.7, t, 0.004) : G.box(t, h * 0.95, 0.004), [cx - sx * w, cy + sy * h, z]);
  }
}

// ------------------------------------------------------------------ géométries fusionnées (une fois par version)
const CACHE = new Map();
function build(v2) {
  const key = v2 ? 'v2' : 'base';
  if (CACHE.has(key)) return CACHE.get(key);
  const L = { fixed: {}, drum: {} };
  let grp = 'fixed', base = null;
  const tmp = [];
  // put(matériau, géométrie, position, rotation, échelle) ; une matrice toute faite à la place de la position
  const put = (k, geo, p = [0, 0, 0], r = [0, 0, 0], s = 1) => {
    let M = p instanceof THREE.Matrix4 ? p : mtx(p, r, s);
    if (base) M = base.clone().multiply(M);
    (L[grp][k] ||= []).push([geo, M]);
  };
  const own = (g) => (tmp.push(g), g);
  const BOLT = G.cone(0.0075, 0.004, 6); // tête de vis bombée, vers +Y

  // ================= boîtier arrière : laque, filets d'or, flancs blindés
  put('laque', own(uvs(G.rbox(0.2, 0.2, 0.32, 0.03, 1), TILE)), [0, 0.07, -0.1]);
  put('laque', own(uvs(G.rbox(0.17, 0.05, 0.29, 0.02, 1), TILE)), [0, 0.185, -0.115]);
  for (const sx of [-1, 1]) {
    put('gold', G.box(0.008, 0.008, 0.27), [sx * 0.087, 0.165, -0.115]);
    put('gold', G.box(0.008, 0.008, 0.3), [sx * 0.1, -0.024, -0.1]);
    // flanc blindé : panneau laqué, cartouche gravé, médaillon à couronne, vis
    put('laque', own(uvs(G.rbox(0.02, 0.15, 0.26, 0.008, 1), TILE)), [sx * 0.105, 0.075, -0.1]);
    put('laque', own(uvs(G.box(0.008, 0.06, 0.14), LABEL)), [sx * 0.118, 0.1, -0.15]);
    put('gold', G.cyl(0.032, 0.032, 0.008, 14), [sx * 0.118, 0.08, -0.01], [0, 0, HP]);
    put('laque', own(plain(G.cyl(0.024, 0.024, 0.006, 14))), [sx * 0.121, 0.08, -0.01], [0, 0, HP]);
    put('gold', own(crownGeo()), [sx * 0.124, 0.077, -0.01], [0, sx * HP, 0], 0.62);
    for (const [y, z] of [[0.14, -0.215], [0.14, 0.015], [0.01, -0.215], [0.01, 0.015]]) {
      put('steel', BOLT, [sx * 0.116, y, z], [0, 0, -sx * HP]);
    }
    put('steel', G.box(0.002, 0.03, 0.12), [sx * 0.117, 0.035, -0.15]); // rainure sous le cartouche
  }
  // quille et talon
  put('gun', G.rbox(0.14, 0.04, 0.24, 0.015, 1), [0, -0.045, -0.12]);
  // évent du dessus : grille de lamelles sur braises rouges
  put('glow', G.box(0.11, 0.004, 0.09), [0, 0.213, -0.17]);
  put('gun', G.box(0.13, 0.012, 0.11), [0, 0.205, -0.17]);
  for (let i = 0; i < 5; i++) put('gun', G.box(0.115, 0.012, 0.008), [0, 0.218, -0.21 + i * 0.02], [0.5, 0, 0]);
  // rail et viseur réflexe : arceau d'or, verre fumé, réticule rouge
  put('gun', G.box(0.05, 0.02, 0.17), [0, 0.218, -0.02]);
  for (const sx of [-1, 1]) {
    put('gold', G.box(0.014, 0.08, 0.03), [sx * 0.042, 0.265, 0.02]);
    put('steel', BOLT, [sx * 0.05, 0.25, 0.02], [0, 0, -sx * HP]);
  }
  put('gold', G.box(0.098, 0.016, 0.03), [0, 0.305, 0.02]);
  put('glass', G.box(0.072, 0.064, 0.006), [0, 0.265, 0.02]);
  put('glow', G.torus(0.014, 0.0025, 3, 12), [0, 0.265, 0.016]);
  put('glow', G.sphere(0.0035, 6, 4), [0, 0.265, 0.015]);
  put('laque', own(plain(G.box(0.05, 0.035, 0.05))), [0, 0.245, -0.05]);
  put('glow', G.cyl(0.01, 0.01, 0.004, 10), [0, 0.248, -0.024], [HP, 0, 0]);
  // face arrière (celle que voit le joueur) : cadre d'or, écran de salve, voyants, vis
  put('gold', G.rbox(0.17, 0.17, 0.012, 0.006, 1), [0, 0.075, -0.262]);
  put('laque', own(plain(G.box(0.15, 0.15, 0.01))), [0, 0.075, -0.266]);
  put('glass', G.rbox(0.09, 0.06, 0.008, 0.003, 1), [0, 0.11, -0.272]);
  if (v2) { digit(put, 1, 0.017, 0.11, -0.277); digit(put, 2, -0.017, 0.11, -0.277); } else digit(put, 8, 0, 0.11, -0.277);
  for (const lx of [-0.035, 0, 0.035]) {
    put('gun', G.cyl(0.013, 0.013, 0.006, 8), [lx, 0.04, -0.272], [HP, 0, 0]);
    put('glow', G.sphere(0.008, 6, 3), [lx, 0.04, -0.275]);
  }
  for (const [px, py] of [[-0.068, 0.145], [0.068, 0.145], [-0.068, 0.005], [0.068, 0.005]]) put('steel', BOLT, [px, py, -0.27], [-HP, 0, 0]);
  if (v2) {
    // queue de fusée : deux ailerons d'or en flèche sur le toit
    for (const sx of [-1, 1]) put('gold', own(finGeo([[0, 0], [0, 0.13], [0.06, 0.02], [0.065, -0.03]], 0.008)), new THREE.Matrix4().makeTranslation(sx * 0.07, 0.205, -0.24).multiply(new THREE.Matrix4().makeRotationZ(HP + sx * -0.45)));
    // rangée de voyants supplémentaires sur les flancs
    for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) put('glow', G.sphere(0.0065, 5, 2), [sx * 0.117, 0.03, -0.22 + i * 0.022]);
  }

  // ================= poignée-pistolet : caoutchouc rainuré, pommeau d'or, pontet, détente rouge
  base = mtx([0, -0.1, -0.06], [-0.3, 0, 0]);
  put('rubber', G.rbox(0.066, 0.16, 0.084, 0.026, 1), [0, 0, 0]);
  for (let i = 0; i < 3; i++) put('rubber', G.cyl(0.011, 0.011, 0.07, 8), [0, 0.04 - i * 0.04, 0.042], [0, 0, HP]);
  put('gold', G.box(0.076, 0.022, 0.096), [0, -0.085, -0.003]);
  put('steel', BOLT, [0, -0.098, -0.003], [Math.PI, 0, 0]);
  base = null;
  put('gold', G.torus(0.04, 0.006, 3, 8, Math.PI), [0, -0.035, 0.005], [Math.PI, HP, 0]);
  put('warhead', G.box(0.012, 0.04, 0.016), [0, -0.055, 0.0], [-0.25, 0, 0]);

  // ================= prise avant (main gauche) : poignée en D sur le flanc gauche
  for (const y of [0.11, -0.05]) {
    put('gun', G.box(0.17, 0.028, 0.04), [-0.18, y, -0.1]);
    put('gold', G.cyl(0.032, 0.032, 0.014, 12), [-0.26, y, -0.1]);
  }
  put('rubber', G.cyl(0.026, 0.026, 0.14, 12), [-0.26, 0.03, -0.1]);
  for (let i = 0; i < 3; i++) put('rubber', G.torus(0.027, 0.004, 3, 8), [-0.26, -0.01 + i * 0.035, -0.1], [HP, 0, 0]);

  // ================= câble d'alimentation (flanc droit) avec bagues d'or
  const cable = new THREE.CatmullRomCurve3([[0.095, -0.012, -0.22], [0.135, -0.035, -0.11], [0.13, -0.02, 0.01], [0.095, 0.03, 0.09]].map((p) => new THREE.Vector3(...p)));
  put('rubber', own(new THREE.TubeGeometry(cable, 12, 0.011, 5)));
  for (const t of [0.04, 0.96]) put('gold', G.cyl(0.015, 0.015, 0.02, 8), mtx(cable.getPoint(t).toArray()).multiply(new THREE.Matrix4().lookAt(new THREE.Vector3(), cable.getTangent(t), new THREE.Vector3(0, 1, 0))).multiply(new THREE.Matrix4().makeRotationX(HP)));

  // ================= palier fixe du barillet
  put('gold', G.cyl(0.13, 0.14, 0.045, 24), [0, AX, 0.08], [HP, 0, 0]);
  put('gun', G.cyl(0.11, 0.11, 0.06, 16, true), [0, AX, 0.06], [HP, 0, 0]);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    put('steel', BOLT, [Math.cos(a) * 0.125, AX + Math.sin(a) * 0.125, 0.104], [HP, 0, 0]);
  }

  // ================= barillet tournant (repère du barillet : axe Z, départ en DZ)
  grp = 'drum';
  const N = v2 ? 12 : 8;
  const RT = v2 ? 0.152 : 0.125; // rayon des tubes autour de l'axe
  const rt = v2 ? 0.041 : 0.046; // rayon d'un tube
  const RB = v2 ? 0.215 : 0.185; // rayon des frettes
  const ZF = 0.5; // bouches
  put('gun', G.cyl(0.05, 0.05, ZF, 10, true), [0, 0, ZF / 2], [HP, 0, 0]);
  // couronne dentée arrière
  put('gold', G.cyl(RB, RB, 0.035, 24), [0, 0, 0.03], [HP, 0, 0]);
  const teeth = 16;
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * TAU;
    put('gold', G.box(0.024, 0.02, 0.03), polar(a, RB + 0.008, 0.03, 0, 0));
  }
  put('gun', G.cyl(RB - 0.02, RB - 0.02, 0.012, 20, true), [0, 0, 0.052], [HP, 0, 0]);
  // tubes, bouches cerclées d'or, ogives rouges qui dépassent
  const disc = own(new THREE.CircleGeometry(rt * 0.86, 10));
  const nose = v2 ? G.cone(0.0135, 0.042, 6) : G.lathe('ruineOgive', [[rt * 0.7, -0.02], [rt * 0.7, 0.012], [rt * 0.5, 0.04], [0.003, 0.062]], 8);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    const x = Math.cos(a) * RT, y = Math.sin(a) * RT;
    put('gun', G.cyl(rt, rt, ZF - 0.05, 10, true), [x, y, 0.05 + (ZF - 0.05) / 2], [HP, 0, 0]);
    put('rubber', disc, [x, y, ZF - 0.004]);
    put('gold', G.torus(rt * 0.93, 0.0085, 3, 8), [x, y, ZF]);
    if (v2) {
      // ogive à fragmentation : trois têtes en grappe
      for (let j = 0; j < 3; j++) {
        const b = a + (j / 3) * TAU;
        put('warhead', nose, [x + Math.cos(b) * rt * 0.42, y + Math.sin(b) * rt * 0.42, ZF + 0.017], [HP, 0, 0]);
      }
    } else put('warhead', nose, [x, y, ZF], [HP, 0, 0]);
  }
  // frettes laquées liserées d'or, rivets
  for (const [z, len] of [[0.24, 0.05], [0.425, 0.07]]) {
    put('laque', own(uvs(G.cyl(RB, RB, len, 24, true), TILE, 4)), [0, 0, z], [HP, 0, 0]);
    for (const e of [-1, 1]) put('gold', G.cyl(RB + 0.006, RB + 0.006, 0.01, 24, true), [0, 0, z + e * (len / 2 - 0.004)], [HP, 0, 0]);
    for (let i = 0; i < N; i += v2 ? 2 : 1) {
      const a = ((i + 0.5) / N) * TAU;
      put('steel', G.sphere(0.0075, 5, 2), [Math.cos(a) * RB, Math.sin(a) * RB, z]);
    }
  }
  // plaque de bouche d'or, moyeu central à œil rouge
  put('gold', G.cyl(RB + 0.006, RB + 0.006, 0.014, 24), [0, 0, ZF - 0.03], [HP, 0, 0]);
  put('laque', own(plain(new THREE.CircleGeometry(RB - 0.006, 24))), [0, 0, ZF - 0.0225]);
  const hub = RT - rt - 0.012;
  put('gold', G.cyl(hub, hub + 0.008, 0.03, 14, true), [0, 0, ZF - 0.01], [HP, 0, 0]);
  put('gun', G.sphere(hub * 0.85, 14, 6), [0, 0, ZF], [0, 0, 0], [1, 1, 0.45]);
  put('gold', G.torus(hub * 0.5, 0.005, 3, 8), [0, 0, ZF + 0.021]);
  put('glow', G.sphere(hub * 0.4, 10, 5), [0, 0, ZF + 0.024], [0, 0, 0], [1, 1, 0.5]);
  // voyants rouges entre les tubes (anneau qui tourne)
  for (let i = 0; i < N; i++) {
    const a = ((i + 0.5) / N) * TAU;
    put('glow', G.sphere(0.0075, 5, 2), [Math.cos(a) * (RB - 0.02), Math.sin(a) * (RB - 0.02), ZF - 0.02]);
  }
  // ailettes de stabilisation en étoile, chant d'or
  const finPts = v2 ? [[RB - 0.02, 0.27], [RB - 0.02, 0.49], [0.3, 0.46], [0.325, 0.32]] : [[RB - 0.02, 0.32], [RB - 0.02, 0.48], [0.255, 0.445], [0.255, 0.375]];
  const fin = own(finGeo(finPts, 0.01));
  const [, , P, Q] = finPts;
  const er = (P[0] + Q[0]) / 2 + 0.004, ez = (P[1] + Q[1]) / 2, el = Math.hypot(P[0] - Q[0], P[1] - Q[1]);
  const eth = Math.atan2(P[0] - Q[0], P[1] - Q[1]);
  for (let i = 0; i < N; i++) {
    const a = ((i + 0.5) / N) * TAU;
    put('laque', fin, new THREE.Matrix4().makeRotationZ(a));
    put('gold', G.box(0.012, 0.016, el + 0.01), polar(a, er, ez, eth));
  }
  if (v2) {
    // couronne de pointes d'or en tête du barillet
    for (let i = 0; i < N; i++) {
      const a = ((i + 0.5) / N) * TAU;
      put('gold', G.cone(0.013, 0.06, 6), [Math.cos(a) * (RB - 0.002), Math.sin(a) * (RB - 0.002), ZF + 0.005], [HP, 0, 0]);
    }
  }

  const out = {};
  for (const gk of ['fixed', 'drum']) {
    out[gk] = Object.entries(L[gk]).map(([k, list]) => {
      const geo = bake(list);
      geo.userData.shared = true;
      return [k, geo];
    });
  }
  for (const g of tmp) g.dispose();
  CACHE.set(key, out);
  return out;
}

// R.U.I.N.E. : barillet de huit tubes lance-roquettes qui tourne (douze en v2), laque noire (bordeaux en v2) et or,
// voyants rouges, poignée en D pour la main gauche
export function ruine(v2) {
  const M = {
    laque: mat('#ffffff', { map: laqueTexture(v2), rough: 0.3, metal: 0.35, coat: 1, coatRough: 0.03 }),
    gold: mat('#ffc83a', { rough: 0.2, metal: 1, coat: 0.5 }),
    gun: mat(v2 ? '#3a3238' : '#34333f', { rough: 0.3, metal: 0.9 }),
    steel: steel(),
    rubber: mat('#17151d', { rough: 0.85 }),
    warhead: mat(v2 ? '#e8461f' : '#d8202c', { rough: 0.3, metal: 0.25, coat: 1 }),
    glass: mat('#1a0b14', { rough: 0.05, metal: 0.6, coat: 1 }),
    glow: glow(v2 ? '#ff6a3a' : '#ff3a4a', 2.2),
  };
  const parts = build(v2);
  const g = new THREE.Group();
  const drum = new THREE.Group();
  drum.position.set(0, AX, DZ);
  g.add(drum);
  for (const [k, geo] of parts.fixed) g.add(new THREE.Mesh(geo, M[k]));
  for (const [k, geo] of parts.drum) drum.add(new THREE.Mesh(geo, M[k]));
  g.userData.blade = drum;
  g.userData.bladeAxis = 'z';
  g.userData.muzzles = [new THREE.Vector3(0, AX, DZ + 0.56)];
  g.userData.grip = new THREE.Vector3(-0.27, 0.03, -0.1); // main gauche (prise avant), voir leftGrip dans hero.js
  return g;
}
