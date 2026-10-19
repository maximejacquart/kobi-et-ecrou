// Tourelle Ronchon : le lanceur tenu en main (canon vers +Z, poignée sous l'origine) et la tourelle qu'il déploie.
// Le lanceur porte sur le dos une tourelle repliée, une boule verte qui fusille Kobi de son œil rouge sous des
// sourcils froncés ; il la tire par un gros tube de lancement. L'allié posé au sol : trépied à vérins, fût, couronne
// dentée, tête ronde qui tourne (os « head ») avec œil rouge à paupière tombante, sourcils, moue, deux canons à
// manchons de refroidissement, chargeur à bande. Grognon-Max : lance-roquettes sur le crâne, blindage à pointes.
// Les tirs partent de (0 ; 0,72 ; 0,6) tourné par la tête et les roquettes de (0 ; 1,2 ; 0) (src/game/weapons.js).
import * as THREE from 'three';
import { G, part, joint, mtx, mergeGeometries } from '../geo.js';
import { mat, glow } from '../../engine/materials.js';
import { paintedMetalTexture } from '../../engine/textures.js';

const HP = Math.PI / 2;
const KEYS = ['paint', 'dark', 'steel', 'rubber', 'brass', 'eye', 'led', 'label'];

// ------------------------------------------------------------------ matières (8 au plus, en cache via mat())
// La peinture verte écaillée est dans la texture ; la couleur du matériau, pâle mais saturée, la module (v2 plus
// sombre) et devient une carrosserie vert sombre lustrée en Méga. L'acier, clair et gris, y devient de l'or.
function mats(v2) {
  const pm = paintedMetalTexture('#4dffa0', 'arme-tourelle', { chip: 0.22, edge: 0.75, rust: 0, bare: '#d4d9e0' });
  return {
    paint: mat(v2 ? '#90d4b0' : '#c4ffdc', { map: pm.map, normalMap: pm.normalMap, rough: 0.3, metal: 0.3, coat: 0.85 }),
    dark: mat('#2b2a31', { rough: 0.36, metal: 0.7 }),
    steel: mat('#cfd3da', { rough: 0.26, metal: 0.92 }),
    rubber: mat('#1e1d21', { rough: 0.85, metal: 0.05 }),
    brass: mat('#e0ae48', { rough: 0.28, metal: 0.9, coat: 0.3 }),
    eye: glow('#ff1a12', 1.25),
    led: glow('#5affa0', 2.4),
    label: mat('#ffffff', { map: stickerTexture(), rough: 0.45, metal: 0.05, coat: 0.5 }),
  };
}

// Autocollants (canvas 256 px, fait au premier appel) : plaques « RONCHON » et « GROGNON-MAX » (moitié haute),
// manomètre de rancune (quart bas gauche), pastille « GRRR ! » (quart bas droit)
let STICKER = null;
function stickerTexture() {
  if (STICKER) return STICKER;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  const font = (px) => `900 ${px}px "Arial Black", Arial, sans-serif`;
  const fit = (s, px, w) => { x.font = font(px); const m = x.measureText(s).width; return m > w ? px * w / m : px; };
  const plate = (y, bg, fg, s) => {
    x.fillStyle = '#231d2c'; x.beginPath(); x.roundRect(4, y + 4, 248, 56, 10); x.fill();
    x.fillStyle = bg; x.beginPath(); x.roundRect(9, y + 9, 238, 46, 7); x.fill();
    for (const px of [22, 234]) { x.fillStyle = '#8d8a96'; x.beginPath(); x.arc(px, y + 32, 6, 0, 7); x.fill(); x.fillStyle = '#4a4656'; x.fillRect(px - 5, y + 31, 10, 2); }
    x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = font(fit(s, 34, 180)); x.fillText(s, 128, y + 34);
  };
  plate(0, '#f1e9cf', '#2a2236', 'RONCHON');
  plate(64, '#d8322e', '#fff2d6', 'GROGNON-MAX');
  // manomètre : cadran crème, graduations, zone rouge, aiguille plantée dans le rouge
  const gx = 64, gy = 192;
  x.fillStyle = '#231d2c'; x.beginPath(); x.arc(gx, gy, 62, 0, 7); x.fill();
  x.fillStyle = '#f4efdc'; x.beginPath(); x.arc(gx, gy, 54, 0, 7); x.fill();
  x.strokeStyle = '#d8322e'; x.lineWidth = 12; x.beginPath(); x.arc(gx, gy, 42, -0.35, 0.8); x.stroke();
  x.strokeStyle = '#2a2236'; x.lineWidth = 4;
  for (let i = 0; i <= 8; i++) {
    const a = 2.35 + (i / 8) * 4.7;
    x.beginPath(); x.moveTo(gx + Math.cos(a) * 36, gy + Math.sin(a) * 36); x.lineTo(gx + Math.cos(a) * 49, gy + Math.sin(a) * 49); x.stroke();
  }
  x.fillStyle = '#2a2236'; x.font = font(13); x.textAlign = 'center'; x.fillText('RANCUNE', gx, gy + 30);
  x.strokeStyle = '#1a1420'; x.lineWidth = 6; x.lineCap = 'round';
  x.beginPath(); x.moveTo(gx, gy); x.lineTo(gx + Math.cos(0.45) * 46, gy + Math.sin(0.45) * 46); x.stroke();
  x.fillStyle = '#d8322e'; x.beginPath(); x.arc(gx, gy, 8, 0, 7); x.fill();
  // pastille jaune « GRRR ! » : bord sombre, sourcils en V, œil rouge, moue
  const bx = 192, by = 192;
  x.fillStyle = '#231d2c'; x.beginPath(); x.arc(bx, by, 62, 0, 7); x.fill();
  x.fillStyle = '#ffc21a'; x.beginPath(); x.arc(bx, by, 55, 0, 7); x.fill();
  x.strokeStyle = '#231d2c'; x.lineWidth = 9; x.lineCap = 'round';
  x.beginPath(); x.moveTo(bx - 32, by - 34); x.lineTo(bx - 6, by - 22); x.moveTo(bx + 32, by - 34); x.lineTo(bx + 6, by - 22); x.stroke();
  x.fillStyle = '#d8322e'; x.beginPath(); x.arc(bx, by - 8, 11, 0, 7); x.fill();
  x.lineWidth = 7; x.beginPath(); x.arc(bx, by + 22, 16, Math.PI * 1.15, Math.PI * 1.85); x.stroke();
  x.fillStyle = '#231d2c'; x.font = font(fit('GRRR !', 22, 80)); x.fillText('GRRR !', bx, by + 36);
  STICKER = new THREE.CanvasTexture(c);
  STICKER.colorSpace = THREE.SRGBColorSpace;
  STICKER.anisotropy = 4;
  STICKER.userData.shared = true;
  return STICKER;
}
// zones de l'autocollant (u0, v0, u1, v1)
const ST = { ronchon: [0, 0.75, 1, 1], grognon: [0, 0.5, 1, 0.75], gauge: [0, 0, 0.5, 0.5], grrr: [0.5, 0, 1, 0.5] };

// ------------------------------------------------------------------ aides géométriques (non indexées, fusionnées)
const ni = (g) => (g.index ? g.toNonIndexed() : g.clone());
const at = (g, p, r = [0, 0, 0], s = 1) => ni(g).applyMatrix4(mtx(p, r, s));
// UV ramenées dans [lo, hi] : pas d'usure d'arête de la peinture sur les pôles et la couture des surfaces courbes
function soft(g, lo = 0.18, hi = 0.82) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, lo + uv.getX(i) * (hi - lo), lo + uv.getY(i) * (hi - lo));
  return g;
}
// UV 0..1 envoyées dans une zone de l'autocollant
function zone(g, [u0, v0, u1, v1]) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return g;
}
const plane = (w, h, z) => zone(ni(new THREE.PlaneGeometry(w, h)), ST[z]);
const disc = (r, z, seg = 20) => zone(ni(new THREE.CircleGeometry(r, seg)), ST[z]);
// ellipsoïde, couture à l'arrière (−Z), UV adoucies
const ell = (rx, ry, rz, ws = 20, hs = 14) => soft(ni(new THREE.SphereGeometry(1, ws, hs).rotateY(-HP).scale(rx, ry, rz)));
// cylindre de a à b (rayon r1 en a, r2 en b)
const _Y = new THREE.Vector3(0, 1, 0), _A = new THREE.Vector3(), _B = new THREE.Vector3(), _D = new THREE.Vector3();
const _q = new THREE.Quaternion();
function rod(a, b, r1, r2 = r1, seg = 8) {
  _A.set(...a); _B.set(...b);
  _D.subVectors(_B, _A);
  const len = _D.length();
  _q.setFromUnitVectors(_Y, _D.normalize());
  return ni(new THREE.CylinderGeometry(r2, r1, len, seg)).applyQuaternion(_q).translate((_A.x + _B.x) / 2, (_A.y + _B.y) / 2, (_A.z + _B.z) / 2);
}
// rivet bombé tourné vers n
function riv(list, p, n, r = 0.012) {
  _q.setFromUnitVectors(_Y, _D.set(n[0], n[1], n[2]).normalize());
  list.push(ni(new THREE.SphereGeometry(r, 6, 2, 0, Math.PI * 2, 0, HP)).scale(1, 0.55, 1).applyQuaternion(_q).translate(p[0], p[1], p[2]));
}
// tube souple (câble, durite) le long d'une courbe
function hose(pts, r, seg = 16, rad = 6) {
  return ni(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), seg, r, rad, false));
}
// couronne dentée d'axe Y
function gear(list, R, h, n, tooth, y) {
  list.push(at(G.cyl(R, R, h, 24), [0, y, 0]));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    list.push(at(G.box(tooth[0], tooth[1], tooth[2]), [Math.cos(a) * (R + tooth[0] * 0.35), y, Math.sin(a) * (R + tooth[0] * 0.35)], [0, -a, 0]));
  }
}
const lists = () => Object.fromEntries(KEYS.map((k) => [k, []]));
// déplace toutes les pièces d'un jeu de listes (matrice m) dans un autre
function graft(dst, src, m) { for (const k of KEYS) for (const g of src[k]) dst[k].push(g.applyMatrix4(m)); }

// Géométries fusionnées par matière, calculées une fois par clé (au premier appel) puis partagées
const CACHE = new Map();
function kit(key, fill) {
  let k = CACHE.get(key);
  if (!k) {
    const L = lists();
    fill(L);
    k = {};
    for (const [m, l] of Object.entries(L)) {
      if (!l.length) continue;
      const g = mergeGeometries(l);
      g.userData.shared = true;
      for (const x of l) x.dispose();
      k[m] = g;
    }
    CACHE.set(key, k);
  }
  return k;
}
function dress(parent, set, M) {
  for (const [k, geo] of Object.entries(set)) part(parent, geo, M[k], { shadow: k !== 'eye' && k !== 'led' && k !== 'label' });
}

// ===================================================================== lanceur tenu en main
// Tourelle repliée (repère propre : face vers +Z, centre à l'origine), montée sur le dos du lanceur
function pod(L, v2) {
  L.paint.push(ell(0.078, 0.07, 0.078, 16, 10));
  L.dark.push(at(G.torus(0.078, 0.006, 3, 18), [0, -0.012, 0], [HP, 0, 0]));
  // œil rouge sous sa paupière tombante, lunette d'acier
  L.eye.push(at(G.sphere(0.026, 12, 8), [0, 0.016, 0.066], [0, 0, 0], [1, 1, 0.6]));
  L.steel.push(at(G.torus(0.029, 0.006, 4, 14), [0, 0.016, 0.068]));
  L.paint.push(soft(at(new THREE.SphereGeometry(0.031, 14, 5, 0, Math.PI * 2, 0, 1.0), [0, 0.016, 0.064], [0.35, 0, 0])));
  L.dark.push(at(G.sphere(0.008, 6, 4), [0, 0.012, 0.081], [0, 0, 0], [1, 1, 0.4]));
  // sourcils froncés, moue, deux canons courts
  for (const s of [-1, 1]) {
    L.dark.push(at(G.rbox(0.05, 0.014, 0.018, 0.005, 1), [s * 0.026, 0.052, 0.061], [-0.3, 0, s * 0.5]));
    L.steel.push(at(G.cyl(0.011, 0.011, 0.05, 10), [s * 0.04, -0.03, 0.075], [HP, 0, 0]));
    L.dark.push(at(G.cyl(0.014, 0.014, 0.012, 10), [s * 0.04, -0.03, 0.1], [HP, 0, 0]));
  }
  L.dark.push(at(G.torus(0.015, 0.004, 4, 10, Math.PI), [0, -0.036, 0.073]));
  // antenne à témoin vert, rivets de la ceinture
  L.steel.push(rod([0.03, 0.06, -0.03], [0.05, 0.11, -0.06], 0.004));
  L.led.push(at(G.sphere(0.009, 6, 4), [0.05, 0.112, -0.06]));
  for (let k = 0; k < 6; k++) { const a = 0.6 + k * 0.85; riv(L.brass, [Math.sin(a) * 0.08, -0.012, Math.cos(a) * 0.08], [Math.sin(a), 0, Math.cos(a)], 0.006); }
  if (v2) {
    // mini lance-roquettes sur le crâne
    L.dark.push(at(G.rbox(0.06, 0.02, 0.05, 0.006, 1), [0, 0.072, -0.01]));
    for (const s of [-1, 1]) {
      L.dark.push(at(G.cyl(0.013, 0.013, 0.06, 10), [s * 0.016, 0.09, -0.005], [HP - 0.5, 0, 0]));
      L.brass.push(at(G.cone(0.01, 0.022, 8), [s * 0.016, 0.115, 0.022], [HP - 0.5, 0, 0]));
    }
  }
}

function launcher(L, v2) {
  // poignée caoutchouc à rainures, pommeau, détente et pontet
  const gr = [-0.3, 0, 0];
  L.rubber.push(at(G.rbox(0.062, 0.15, 0.074, 0.024, 2), [0, -0.085, -0.005], gr));
  const gm = mtx([0, -0.085, -0.005], gr);
  for (const s of [-1, 1]) {
    L.dark.push(at(G.box(0.008, 0.1, 0.05), [s * 0.031, -0.005, -0.004]).applyMatrix4(gm));
    for (const y of [-0.035, 0.03]) L.steel.push(at(G.cyl(0.007, 0.007, 0.006, 6), [s * 0.036, y, -0.004], [0, 0, HP]).applyMatrix4(gm));
  }
  L.dark.push(at(G.rbox(0.07, 0.025, 0.085, 0.01, 1), [0, -0.162, 0.018], gr));
  L.steel.push(at(G.torus(0.04, 0.007, 4, 12, Math.PI), [0, -0.012, 0.075], [0, HP, Math.PI]));
  L.dark.push(at(G.rbox(0.016, 0.04, 0.014, 0.006, 1), [0, -0.025, 0.065], [0.3, 0, 0]));
  // corps peint, châssis sombre, capot arrière
  L.paint.push(at(G.rbox(0.15, 0.13, 0.27, 0.035, 2), [0, 0.06, 0.08]));
  L.dark.push(at(G.rbox(0.12, 0.04, 0.24, 0.015, 1), [0, -0.005, 0.085]));
  L.dark.push(at(G.rbox(0.13, 0.11, 0.03, 0.02, 1), [0, 0.058, -0.06]));
  // manomètre de rancune au dos (face au joueur)
  L.steel.push(at(G.torus(0.036, 0.007, 4, 16), [0, 0.065, -0.077]));
  L.label.push(at(disc(0.036, 'gauge'), [0, 0.065, -0.076], [0, Math.PI, 0]));
  // flanc gauche : évents
  for (let i = 0; i < 4; i++) L.dark.push(at(G.box(0.012, 0.075, 0.016), [-0.075, 0.06, 0.0 + i * 0.032]));
  // flanc droit : plaque « RONCHON » sur fond sombre
  L.dark.push(at(G.rbox(0.008, 0.044, 0.15, 0.004, 1), [0.077, 0.075, 0.07]));
  L.label.push(at(plane(0.14, 0.035, v2 ? 'grognon' : 'ronchon'), [0.0815, 0.075, 0.07], [0, HP, 0]));
  // témoins de charge (gauche, dessus)
  for (let i = 0; i < 3; i++) L.led.push(at(G.sphere(0.009, 6, 4), [-0.077, 0.108, 0.13 + i * 0.026], [0, 0, 0], [0.6, 1, 1]));
  // rivets aux coins des flancs
  for (const s of [-1, 1]) for (const z of [-0.025, 0.185]) for (const y of [0.015, 0.11]) riv(L.brass, [s * 0.076, y, z], [s, 0, 0], 0.007);
  // tube de lancement : fût sombre, bague de laiton, pavillon d'acier, âme verte
  L.dark.push(at(G.cyl(0.062, 0.062, 0.15, 18, true), [0, 0.055, 0.265], [HP, 0, 0]));
  L.brass.push(at(G.torus(0.064, 0.008, 5, 18), [0, 0.055, 0.215]));
  L.brass.push(at(G.torus(0.064, 0.006, 4, 18), [0, 0.055, 0.3]));
  const bell = G.lathe('arme-tourelle-bell', [[0.052, 0], [0.066, 0], [0.08, 0.03], [0.082, 0.042], [0.06, 0.042], [0.052, 0.036]], 18);
  L.steel.push(at(bell, [0, 0.055, 0.32], [HP, 0, 0]));
  L.dark.push(at(G.cyl(0.054, 0.054, 0.006, 18), [0, 0.055, 0.34], [HP, 0, 0]));
  L.led.push(at(G.torus(0.04, 0.006, 4, 18), [0, 0.055, 0.345]));
  for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * HP; L.steel.push(at(G.box(0.012, 0.03, 0.06), [Math.cos(a) * 0.066, 0.055 + Math.sin(a) * 0.066, 0.26], [0, 0, a + HP])); }
  // berceau de la tourelle repliée : semelle, deux colliers, câble d'alimentation
  L.dark.push(at(G.rbox(0.08, 0.02, 0.12, 0.008, 1), [0, 0.13, 0.05]));
  for (const z of [0.01, 0.09]) L.steel.push(at(G.torus(0.081, 0.007, 4, 10, Math.PI * 0.55), [0, 0.205, z], [0, 0, -HP - Math.PI * 0.275]));
  L.rubber.push(hose([[0.04, 0.11, -0.05], [0.06, 0.15, -0.04], [0.07, 0.19, -0.0]], 0.009, 10));
  // la tourelle repliée, qui regarde Kobi de travers (vers sa droite, un peu en arrière)
  const P = lists();
  pod(P, v2);
  graft(L, P, mtx([0, 0.205, 0.05], [-0.15, HP + 0.35, 0]));
  if (v2) {
    // Grognon-Max : roquettes de part et d'autre du tube, crête de blindage, ailettes arrière
    for (const s of [-1, 1]) {
      L.dark.push(at(G.cyl(0.021, 0.021, 0.14, 12), [s * 0.086, 0.012, 0.25], [HP, 0, 0]));
      L.steel.push(at(G.torus(0.022, 0.005, 4, 12), [s * 0.086, 0.012, 0.32]));
      L.brass.push(at(G.cone(0.016, 0.035, 10), [s * 0.086, 0.012, 0.33], [HP, 0, 0]));
      L.dark.push(at(G.box(0.03, 0.012, 0.05), [s * 0.074, 0.03, 0.2]));
      L.paint.push(at(G.rbox(0.01, 0.06, 0.06, 0.004, 1), [s * 0.07, 0.1, -0.06], [0.7, 0, s * -0.3]));
    }
    L.paint.push(at(G.rbox(0.05, 0.03, 0.11, 0.01, 1), [0, 0.13, 0.165], [-0.12, 0, 0]));
    for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; L.steel.push(at(G.cone(0.011, 0.024, 6), [Math.cos(a) * 0.08, 0.055 + Math.sin(a) * 0.08, 0.36], [HP, 0, 0])); }
  }
}

export function tourelle(v2) {
  const g = new THREE.Group();
  dress(g, kit('main' + (v2 ? 2 : 1), (L) => launcher(L, v2)), mats(v2));
  g.userData.muzzles = [new THREE.Vector3(0, 0.055, 0.365)];
  return g;
}

// ===================================================================== tourelle posée (allié)
// Trépied, fût et couronne : repère du sol
function base(L, v2) {
  // moyeu, cône, bague de rivets
  L.dark.push(at(G.cyl(0.13, 0.13, 0.1, 20), [0, 0.36, 0]));
  L.dark.push(at(G.cyl(0.1, 0.05, 0.08, 16), [0, 0.27, 0]));
  for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2 + 0.3; riv(L.brass, [Math.cos(a) * 0.13, 0.36, Math.sin(a) * 0.13], [Math.cos(a), 0, Math.sin(a)], 0.011); }
  // fût peint à bande de laiton, couronne dentée
  L.paint.push(at(G.cyl(0.1, 0.115, 0.08, 20), [0, 0.45, 0]));
  L.brass.push(at(G.torus(0.108, 0.01, 4, 20), [0, 0.43, 0], [HP, 0, 0]));
  gear(L.steel, 0.13, 0.03, 20, [0.03, 0.03, 0.018], 0.49);
  // pattes : rotule de hanche, jambe de force peinte, genou, fourreau et tige, semelle caoutchouc, vérin
  for (let k = 0; k < 3; k++) {
    const a = HP + k * (Math.PI * 2 / 3);
    const Q = lists();
    Q.steel.push(at(G.cyl(0.025, 0.025, 0.07, 8), [0.12, 0.36, 0], [HP, 0, 0]));
    Q.paint.push(at(G.rbox(0.3, 0.05, 0.045, 0.015, 1), [0.225, 0.27, 0], [0, 0, -0.69]));
    Q.dark.push(at(G.cyl(0.032, 0.032, 0.07, 10), [0.33, 0.18, 0], [HP, 0, 0]));
    Q.dark.push(at(G.box(0.2, 0.014, 0.047), [0.225, 0.27, 0], [0, 0, -0.69]));
    for (const t of [0.22]) for (const z of [-0.023, 0.023]) riv(Q.brass, [0.11 + t * 0.77, 0.36 - t * 0.636 + 0.018, z], [0, 0, Math.sign(z)], 0.008);
    for (const z of [-0.037, 0.037]) Q.brass.push(at(G.cyl(0.015, 0.015, 0.008, 6), [0.33, 0.18, z], [HP, 0, 0]));
    Q.dark.push(rod([0.33, 0.18, 0], [0.4, 0.11, 0], 0.026, 0.024, 10));
    Q.steel.push(rod([0.38, 0.13, 0], [0.465, 0.05, 0], 0.016, 0.016, 8));
    Q.steel.push(at(G.sphere(0.024, 8, 5), [0.47, 0.045, 0]));
    Q.dark.push(at(G.cyl(0.05, 0.055, 0.014, 12), [0.475, 0.032, 0]));
    Q.rubber.push(at(G.cyl(0.062, 0.066, 0.026, 12), [0.475, 0.013, 0]));
    Q.dark.push(rod([0.06, 0.27, 0], [0.2, 0.21, 0], 0.017, 0.017, 8));
    Q.steel.push(rod([0.2, 0.21, 0], [0.37, 0.14, 0], 0.009, 0.009, 6));
    if (v2) for (const z of [-0.045, 0.045]) Q.steel.push(at(G.cone(0.014, 0.05, 6), [0.53, 0.02, z], [0, 0, -1.2]));
    graft(L, Q, new THREE.Matrix4().makeRotationY(a));
  }
  // batterie au dos du fût, son câble, pastille « GRRR ! », témoin vert
  L.paint.push(at(G.rbox(0.13, 0.1, 0.06, 0.015, 1), [0, 0.44, -0.15]));
  L.label.push(at(disc(0.034, 'grrr'), [0, 0.44, -0.181], [0, Math.PI, 0]));
  L.led.push(at(G.sphere(0.009, 6, 4), [0.05, 0.48, -0.181]));
  L.rubber.push(hose([[-0.04, 0.4, -0.15], [-0.07, 0.34, -0.13], [-0.08, 0.33, -0.07]], 0.011, 10));
}

// Tête tournante (repère de l'os « head », centre à 0,75 m du sol)
function head(L, v2) {
  // coque peinte, ceinture sombre, jupe et roulement
  L.paint.push(at(ell(0.3, 0.24, 0.29, 22, 14), [0, 0.02, -0.02]));
  L.dark.push(at(G.torus(0.262, 0.01, 3, 24), [0, -0.1, -0.02], [HP, 0, 0], [1, 0.967, 1]));
  L.dark.push(at(G.torus(0.185, 0.022, 4, 20), [0, -0.17, -0.02], [HP, 0, 0]));
  L.dark.push(at(G.cyl(0.15, 0.15, 0.05, 20, true), [0, -0.225, 0]));
  // masque du visage
  L.dark.push(at(ell(0.21, 0.15, 0.1, 16, 8), [0, 0.03, 0.22]));
  // œil (maillage à part) : lunette d'acier, vis, paupière tombante, pupille
  L.steel.push(at(G.torus(0.068, 0.013, 5, 20), [0, 0.075, 0.312]));
  for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * HP; riv(L.brass, [Math.cos(a) * 0.068, 0.075 + Math.sin(a) * 0.068, 0.326], [0, 0, 1], 0.007); }
  L.paint.push(soft(at(new THREE.SphereGeometry(0.073, 16, 5, 0, Math.PI * 2, 0, 1.0), [0, 0.075, 0.3], [0.35, 0, 0])));
  L.dark.push(at(G.torus(0.071, 0.007, 3, 14, Math.PI), [0, 0.087, 0.3], [-0.5, 0, 0], [1, 0.4, 1]));
  L.dark.push(at(G.sphere(0.019, 8, 5), [0, 0.062, 0.343], [0, 0, 0], [1, 1, 0.35]));
  // sourcils froncés (plaques boulonnées), à pointes en v2
  for (const s of [-1, 1]) {
    const bw = v2 ? 0.17 : 0.15, bh = v2 ? 0.048 : 0.04;
    L.dark.push(at(G.rbox(bw, bh, 0.05, 0.012, 1), [s * 0.085, 0.168, 0.262], [-0.25, 0, s * 0.42]));
    riv(L.brass, [s * 0.14, 0.198, 0.287], [0, 0.2, 1], 0.009);
    if (v2) L.steel.push(at(G.cone(0.016, 0.07, 6), [s * 0.17, 0.225, 0.25], [-0.3, 0, -s * 1.0]));
  }
  // moue et sa dent de travers
  L.dark.push(at(G.torus(0.036, 0.009, 5, 10, Math.PI), [0, -0.09, 0.29]));
  L.steel.push(at(G.box(0.014, 0.018, 0.01), [0.012, -0.063, 0.292], [0, 0, 0.12]));
  // joues-carters des canons, canons à manchon ailetté, bague de laiton, frein de bouche, âme verte
  const brake = G.lathe('arme-tourelle-brake', [[0.02, 0], [0.036, 0], [0.04, 0.008], [0.04, 0.05], [0.034, 0.06], [0.02, 0.06]], 8);
  for (const s of [-1, 1]) {
    const x = s * 0.09;
    L.paint.push(at(G.rbox(0.1, 0.11, 0.17, 0.03, 1), [s * 0.11, -0.035, 0.245]));
    L.steel.push(at(G.cyl(0.024, 0.024, 0.26, 10, true), [x, -0.03, 0.46], [HP, 0, 0]));
    L.dark.push(at(G.cyl(0.035, 0.035, 0.13, 10, true), [x, -0.03, 0.41], [HP, 0, 0]));
    const nf = v2 ? 4 : 3;
    for (let i = 0; i < nf; i++) L.dark.push(at(G.cyl(v2 ? 0.05 : 0.046, v2 ? 0.05 : 0.046, 0.01, 10), [x, -0.03, 0.36 + i * (0.1 / (nf - 1))], [HP, 0, 0]));
    L.brass.push(at(G.torus(0.033, 0.008, 4, 12), [x, -0.03, 0.49]));
    L.dark.push(at(brake, [x, -0.03, 0.54], [HP, 0, 0]));
    for (const y of [-0.02, 0.02]) L.dark.push(at(G.box(0.086, 0.008, 0.016), [x, -0.03 + y, 0.575]));
    L.led.push(at(G.cyl(0.02, 0.02, 0.004, 10), [x, -0.03, 0.598], [HP, 0, 0]));
    for (const z of [0.18, 0.31]) riv(L.brass, [s * 0.161, -0.035, z], [s, 0, 0], 0.009);
  }
  // oreilles : moyeux peints boulonnés
  for (const s of [-1, 1]) {
    L.paint.push(at(G.cyl(0.09, 0.09, 0.05, 16), [s * 0.29, 0.0, -0.03], [0, 0, HP]));
    L.steel.push(at(G.cyl(0.04, 0.045, 0.022, 6), [s * 0.322, 0.0, -0.03], [0, 0, HP]));
    for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * HP; riv(L.brass, [s * 0.316, Math.cos(a) * 0.066, -0.03 + Math.sin(a) * 0.066], [s, 0, 0], 0.009); }
    if (v2) L.paint.push(at(G.box(0.02, 0.2, 0.08), [s * 0.33, 0.05, -0.1], [-0.5, 0, s * 0.25]));
  }
  // chargeur à tambour (gauche, arrière) et bande de cartouches vers le canon gauche
  L.paint.push(at(G.cyl(0.085, 0.085, 0.11, 16), [-0.28, -0.07, -0.19], [0, 0, HP]));
  L.dark.push(at(G.cyl(0.07, 0.07, 0.116, 6), [-0.28, -0.07, -0.19], [0, 0, HP]));
  for (const x of [-0.226, -0.334]) L.brass.push(at(G.torus(0.085, 0.008, 3, 14), [x, -0.07, -0.19], [0, HP, 0]));
  const belt = new THREE.CatmullRomCurve3([[-0.23, -0.12, -0.1], [-0.25, -0.15, 0.04], [-0.21, -0.11, 0.16], [-0.16, -0.06, 0.2]].map((p) => new THREE.Vector3(...p)));
  L.rubber.push(ni(new THREE.TubeGeometry(belt, 12, 0.01, 4, false)));
  const pt = new THREE.Vector3(), tg = new THREE.Vector3(), ax = new THREE.Vector3(), bx = new THREE.Vector3(), m4 = new THREE.Matrix4();
  const out = new THREE.Vector3(-1, 0, 0);
  for (let i = 0; i < 7; i++) {
    const u = (i + 0.5) / 7;
    belt.getPointAt(u, pt); belt.getTangentAt(u, tg);
    ax.crossVectors(tg, out).normalize();
    bx.crossVectors(ax, tg).normalize();
    m4.makeBasis(ax, bx, tg).setPosition(pt);
    L.brass.push(ni(G.cyl(0.014, 0.014, 0.06, 6, true)).applyMatrix4(m4));
    L.brass.push(ni(G.cone(0.014, 0.025, 6)).translate(0, 0.042, 0).applyMatrix4(m4));
    L.rubber.push(ni(G.box(0.02, 0.034, 0.024)).applyMatrix4(m4));
  }
  // dos : grille d'aération, plaque gravée, échappements
  L.dark.push(at(G.box(0.2, 0.12, 0.04), [0, -0.02, -0.29], [-0.1, 0, 0]));
  for (let i = 0; i < 4; i++) L.dark.push(at(G.box(0.17, 0.012, 0.03), [0, -0.06 + i * 0.027, -0.312], [-0.6, 0, 0]));
  L.dark.push(at(G.box(0.2, 0.055, 0.02), [0, 0.135, -0.27], [0.5, Math.PI, 0]));
  L.label.push(at(plane(0.185, 0.044, v2 ? 'grognon' : 'ronchon'), [0, 0.14, -0.281], [0.5, Math.PI, 0]));
  for (const s of [-1, 1]) {
    L.dark.push(rod([s * 0.15, -0.1, -0.22], [s * 0.165, -0.15, -0.28], 0.019, 0.021, 10));
    L.steel.push(rod([s * 0.165, -0.15, -0.28], [s * 0.168, -0.158, -0.29], 0.025, 0.025, 10));
  }
  // côté droit : rampe de témoins (verts, un rouge de mauvaise humeur)
  L.dark.push(at(G.box(0.022, 0.034, 0.13), [0.248, 0.13, -0.05], [0, 0, -0.55]));
  L.led.push(at(G.sphere(0.011, 6, 4), [0.258, 0.137, -0.09]));
  L.led.push(at(G.sphere(0.011, 6, 4), [0.258, 0.137, -0.05]));
  L.eye.push(at(G.sphere(0.011, 6, 4), [0.258, 0.137, -0.01]));
  // antenne arrière à témoin vert
  L.dark.push(at(G.cyl(0.02, 0.026, 0.04, 10), [0.15, 0.2, -0.16], [-0.3, 0, -0.35]));
  L.steel.push(rod([0.15, 0.2, -0.16], [0.24, 0.47, -0.27], 0.007, 0.005, 6));
  L.led.push(at(G.sphere(0.017, 8, 6), [0.24, 0.475, -0.27]));
  // joint de panneau sur le dos du crâne, rivets
  // joints du panneau arrière (méridiens de la coque à x = ±0,17), rivets
  for (const s of [-1, 1]) {
    L.dark.push(ni(G.torus(1, 0.04, 3, 16, 2.2)).rotateZ(HP).rotateY(-HP).scale(0.25, 0.199, 0.24).translate(s * 0.17, 0.02, -0.02));
    for (const a of [0.8, 1.6]) riv(L.brass, [s * 0.17 * (1 - 0.06), 0.02 + Math.cos(a) * 0.205, -0.02 - Math.sin(a) * 0.245], [s * 0.5, Math.cos(a), -Math.sin(a)], 0.008);
  }
  // rivets de la ceinture
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 + 0.26;
    if (Math.sin(a) > 0.55) continue;
    riv(L.brass, [Math.cos(a) * 0.262, -0.1, -0.02 + Math.sin(a) * 0.254], [Math.cos(a), 0, Math.sin(a)], 0.009);
  }
  if (!v2) {
    // trappe du crâne, poignée et rivets
    L.paint.push(at(G.cyl(0.13, 0.135, 0.04, 20), [0, 0.245, -0.04]));
    L.dark.push(at(G.torus(0.133, 0.007, 3, 20), [0, 0.226, -0.04], [HP, 0, 0]));
    L.steel.push(at(G.torus(0.05, 0.01, 5, 10, Math.PI), [0, 0.265, -0.04]));
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + 0.5; riv(L.brass, [Math.cos(a) * 0.105, 0.265, -0.04 + Math.sin(a) * 0.105], [0, 1, 0], 0.009); }
  } else {
    // Grognon-Max : lance-roquettes quadruple sur le crâne (bouches vers 1,2 m du sol), berceau et vérins
    L.dark.push(at(G.cyl(0.12, 0.14, 0.04, 18), [0, 0.245, -0.04]));
    for (const s of [-1, 1]) L.steel.push(at(G.box(0.025, 0.1, 0.1), [s * 0.115, 0.29, -0.04]));
    const m = mtx([0, 0.33, -0.04], [0.22, 0, 0]);
    const R = lists();
    R.paint.push(at(G.rbox(0.25, 0.1, 0.21, 0.03, 1), [0, -0.02, 0]));
    R.dark.push(at(G.rbox(0.26, 0.02, 0.22, 0.008, 1), [0, -0.07, 0]));
    for (const x of [-0.06, 0.06]) for (const z of [-0.052, 0.052]) {
      R.dark.push(at(G.cyl(0.044, 0.044, 0.15, 12, true), [x, 0.07, z]));
      R.dark.push(at(G.cyl(0.034, 0.034, 0.01, 12), [x, 0.13, z]));
      R.steel.push(at(G.torus(0.044, 0.007, 4, 12), [x, 0.145, z], [HP, 0, 0]));
      R.eye.push(at(G.torus(0.031, 0.005, 3, 12), [x, 0.14, z], [HP, 0, 0]));
      R.brass.push(at(G.cone(0.03, 0.065, 10), [x, 0.165, z]));
    }
    R.label.push(at(disc(0.042, 'grrr'), [0, -0.02, 0.1055]));
    for (const s of [-1, 1]) for (const y of [-0.05, 0.01]) riv(R.brass, [s * 0.126, y, 0.07], [s, 0, 0], 0.008);
    graft(L, R, m);
    for (const s of [-1, 1]) L.steel.push(rod([s * 0.07, 0.22, 0.06], [s * 0.07, 0.29, 0.07], 0.01, 0.01, 6));
  }
}

export function turretModel(v2) {
  const M = mats(v2);
  const g = new THREE.Group();
  dress(g, kit('base' + (v2 ? 2 : 1), (L) => base(L, v2)), M);
  const h = joint(g, [0, 0.75, 0]);
  dress(h, kit('head' + (v2 ? 2 : 1), (L) => head(L, v2)), M);
  // l'œil : lentille rouge bombée (pupille et paupière fusionnées dans la tête)
  const eye = part(h, G.sphere(0.062, 16, 10), M.eye, { p: [0, 0.075, 0.315], s: [1, 1, 0.55], shadow: false });
  g.userData.head = h;
  g.userData.eye = eye;
  return g;
}
