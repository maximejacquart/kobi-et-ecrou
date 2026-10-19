// Brikka, le canyon de ferraille : mesas, tas de ferraille, cactus, cabanes, épaves, aspirateur du Baron Vorax,
// passerelles de planches.
import * as THREE from 'three';
import { G, part, joint, mtx, mergeGeometries } from '../geo.js';
import { mat, glow } from '../../engine/materials.js';
import { containerTexture, hazardTexture, paintedMetalTexture, plankTexture, shingleTexture, treadPlateTexture } from '../../engine/textures.js';
import { BoxCollider, CylinderCollider } from '../../engine/physics.js';
import { noise3, rand, rng as mkRng } from '../../engine/util.js';
import { boxUV } from '../../levels/level.js';
import { propMats, rock, rockGeo, contMats, corrugated, boxAt, mergeParts, plankBox, rboxAt, beam, container } from './props.js';
import { lights } from '../../engine/lightpool.js';
import { grassField } from '../nature.js';

const M = {};
function mats() {
  if (M.ready) return M;
  Object.assign(M, propMats());
  M.tire = mat('#26222c', { rough: 0.9 });
  M.cactus = mat('#3fae7a', { rough: 0.6 });
  M.cactusDark = mat('#2a7a5a', { rough: 0.6 });
  M.flower = mat('#ff6fb5', { rough: 0.5, emissive: '#801f50', emissiveIntensity: 0.4 });
  M.spike = mat('#f4e6c8', { rough: 0.5 });
  M.vorax = mat('#6a2bd0', { rough: 0.35, metal: 0.5 });
  M.voraxWhite = mat('#eceaf6', { rough: 0.35, metal: 0.3 });
  const hz = hazardTexture();
  M.hazard = mat('#ffffff', { map: hz.map, rough: 0.6 });
  // oasis : palmiers, massettes, nénuphars, guirlandes
  M.trunk = mat('#9a7048', { rough: 0.85 });
  M.trunkDark = mat('#6a4a30', { rough: 0.9 });
  M.frond = mat('#3fa26a', { rough: 0.6, side: THREE.DoubleSide });
  M.frondL = mat('#6cc070', { rough: 0.6, side: THREE.DoubleSide });
  M.reedHead = mat('#6a3f22', { rough: 0.9 });
  M.reedStem = mat('#7a8a3a', { rough: 0.8 });
  M.lily = mat('#3f9a4a', { rough: 0.45 });
  M.lilyFlower = mat('#ffb0d8', { rough: 0.5, emissive: '#80305a', emissiveIntensity: 0.3 });
  M.wire = mat('#2a2430', { rough: 0.7 });
  M.bulb = glow('#ffcf7a', 3.2);
  // matières des objets : métal peint écaillé, bois, bardeaux, tôle larmée
  const tm = (t, o) => mat('#ffffff', { map: t.map, normalMap: t.normalMap, ...o });
  M.steelP = tm(paintedMetalTexture('#4a5068', 'brk-steel', { chip: 0.3, edge: 0.8, rust: 0.3 }), { rough: 0.5, metal: 0.55 });
  M.rustP = tm(paintedMetalTexture('#9a5232', 'brk-rust', { chip: 0.6, edge: 0.9, rust: 0.9, bare: '#7a4a30' }), { rough: 0.8, metal: 0.3 });
  M.redP = tm(paintedMetalTexture('#d0442e', 'brk-red', { chip: 0.35, edge: 0.85, rust: 0.4 }), { rough: 0.5, metal: 0.35 });
  M.yellowP = tm(paintedMetalTexture('#e0a020', 'brk-yellow', { chip: 0.4, edge: 0.85, rust: 0.45 }), { rough: 0.55, metal: 0.3 });
  M.blueP = tm(paintedMetalTexture('#3a8ac0', 'brk-blue', { chip: 0.4, edge: 0.85, rust: 0.5 }), { rough: 0.5, metal: 0.35 });
  M.tank = tm(paintedMetalTexture('#32c2c6', 'brk-tank', { chip: 0.3, edge: 0.75, rust: 0.2 }), { rough: 0.55, metal: 0.05 });
  M.robot = tm(paintedMetalTexture('#a89268', 'brk-robot', { chip: 0.55, edge: 0.95, rust: 0.8, bare: '#a8a8b0' }), { rough: 0.6, metal: 0.45 });
  M.voraxP = tm(paintedMetalTexture('#6a2bd0', 'brk-vorax', { chip: 0.15, edge: 0.7, rust: 0.05, bare: '#b8b4d0' }), { rough: 0.35, metal: 0.5 });
  M.voraxD = tm(paintedMetalTexture('#3a1a78', 'brk-vorax-d', { chip: 0.2, edge: 0.8, rust: 0.1, bare: '#a8a4c0' }), { rough: 0.4, metal: 0.6 });
  M.voraxW = tm(paintedMetalTexture('#eceaf6', 'brk-vorax-w', { chip: 0.15, edge: 0.7, rust: 0.05, bare: '#9a98b0' }), { rough: 0.35, metal: 0.3, side: THREE.DoubleSide });
  M.gold = mat('#ffcc33', { rough: 0.3, metal: 0.8 });
  M.iron = mat('#3b3542', { metal: 0.7, rough: 0.45 });
  M.hole = mat('#18141c', { rough: 0.9, side: THREE.DoubleSide, rim: 0 });
  M.concrete = mat('#a39a8c', { rough: 0.95 });
  M.ceramic = mat('#ece6d6', { rough: 0.25, coat: 0.5 });
  M.copper = mat('#d07a3a', { metal: 0.9, rough: 0.3 });
  M.rope = mat('#c8a46a', { rough: 0.95 });
  M.cable = mat('#1e1c24', { rough: 0.6 });
  M.timber = tm(plankTexture('#8a5a3a', 'brk-timber', { wear: 0.6, knots: 1.5, seed: 23 }), { rough: 0.8 });
  M.boards = tm(plankTexture('#a8703f', 'brk-boards', { wear: 0.7, knots: 1, seed: 29 }), { rough: 0.8 });
  M.roof = tm(shingleTexture('#b8603a', 'brk-roof', { rows: 6, cols: 4, round: 0.4 }), { rough: 0.6, metal: 0.2 });
  M.soffit = mat('#5a6a70', { rough: 0.8, side: THREE.DoubleSide, rim: 0 });
  M.tread = tm(treadPlateTexture('#8d97ad', 'brk-tread'), { rough: 0.4, metal: 0.7 });
  M.ready = true;
  return M;
}

// ------------------------------------------------------------------ aides de construction
const ni = (g) => (g.index ? g.toNonIndexed() : g.clone());
// Sac de pièces : géométries rangées par matière (copiées, transformées par mm), fusionnées et posées d'un coup
function bag() {
  const parts = new Map();
  const put = (mt, g, mm) => {
    const c = ni(g);
    if (mm) c.applyMatrix4(mm);
    if (!parts.has(mt)) parts.set(mt, []);
    parts.get(mt).push(c);
    return c;
  };
  put.flush = (L, M4 = null) => {
    for (const [mt, list] of parts) {
      const g = mergeGeometries(list);
      for (const x of list) x.dispose();
      L.add(g, mt, M4);
    }
    parts.clear();
  };
  return put;
}
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const gy = (L, x, z) => (L.heightfield ? L.heightfield.height(x, z) : 0);
// Tête de rivet bombée (calotte basse), tournée vers +Y
let studGeo = null;
const stud = (r) => {
  if (!studGeo) studGeo = new THREE.SphereGeometry(1, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1).toNonIndexed();
  return studGeo.clone().scale(r, r, r);
};
const _sq = new THREE.Quaternion(), _sy = V3(0, 1, 0), _sn = V3(0, 0, 0);
// rivets aux points pts ([x, y, z] ou [x, y, z, nx, ny, nz]), tête tournée vers la normale du point ou vers nrm
function studs(put, mt, pts, nrm, r = 0.03) {
  for (const p of pts) {
    _sq.setFromUnitVectors(_sy, _sn.set(p[3] ?? nrm[0], p[4] ?? nrm[1], p[5] ?? nrm[2]).normalize());
    put(mt, stud(r).applyQuaternion(_sq).translate(p[0], p[1], p[2]));
  }
}
// Pièce de bois (plankBox) de a à b : section w × t, fil le long de la pièce
const _tx = V3(1, 0, 0);
function timber(a, b, w, t, uOff = 0) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const g = plankBox(len, w, t, 1, uOff);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_tx, d.normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}
// Boîte de a à b (section w × t), UV 0..1 par face : pour le métal peint (poutres, barres, cornières)
function bar(a, b, w, t, roll = 0) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const g = new THREE.BoxGeometry(len, w, t).toNonIndexed().rotateX(roll);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_tx, d.normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}
// Câble ou corde souple passant par pts (Vector3), rayon r
const tube = (pts, r, seg, rs = 5) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg ?? pts.length * 6, r, rs, false);
// Virole en tôles : cylindre (rayon r0 en y0, r1 en y1) en rows rangées de cols tôles, UV 0..1 par tôle (l'usure de
// la peinture suit le bord de chaque tôle), joints à recouvrement (une tôle sur deux un peu en saillie) ; rivets (o.rivet :
// matière) le long des joints horizontaux, et verticaux si o.vert, espacés de o.step. Renvoie le rayon à la hauteur y.
function shell(put, mt, o) {
  const { r0, r1 = r0, y0, y1, rows = 1, cols = 12, seg = 3, lap = 0.012, a0 = 0, skip = null } = o;
  const H = y1 - y0, dA = (Math.PI * 2) / cols;
  const rad = (y) => r0 + (r1 - r0) * ((y - y0) / H);
  for (let j = 0; j < rows; j++) {
    const ya = y0 + (H * j) / rows, yb = y0 + (H * (j + 1)) / rows;
    for (let i = 0; i < cols; i++) {
      if (skip && skip(i, j)) continue;
      const k = ((i + j) % 2) * lap;
      put(mt, new THREE.CylinderGeometry(rad(yb) + k, rad(ya) + k, yb - ya, seg, 1, true, a0 + i * dA, dA).translate(0, (ya + yb) / 2, 0));
    }
  }
  if (!o.rivet) return rad;
  // rayon de la tôle sous un rivet (angle a, rangées ja et jb de part et d'autre) : facette plane de la virole (corde
  // plus près de l'axe que le cercle) et recouvrement de la tôle la plus en saillie ; tête de rivet posée dessus
  const sw = dA / seg, TAU = Math.PI * 2;
  const onSheet = (a, y, ja, jb) => {
    const u = (((a - a0) % TAU) + TAU) % TAU, i = Math.floor(u / dA) % cols, f = (u - i * dA) % sw - sw / 2;
    const k = Math.max(...[ja, jb].filter((j) => j >= 0 && j < rows).map((j) => ((i + j) % 2) * lap));
    return (rad(y) * Math.cos(sw / 2)) / Math.cos(f) + k - 0.004;
  };
  const pts = [], step = o.step ?? 0.3;
  for (let j = 0; j <= rows; j++) {
    const y = Math.min(y1 - 0.06, Math.max(y0 + 0.06, y0 + (H * j) / rows));
    const n = Math.round((Math.PI * 2 * (rad(y) + lap)) / step);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, r = onSheet(a, y, j - 1, j);
      pts.push([Math.sin(a) * r, y, Math.cos(a) * r, Math.sin(a), 0, Math.cos(a)]);
    }
  }
  if (o.vert) for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = a0 + i * dA + 0.03, ya = y0 + (H * j) / rows, yb = y0 + (H * (j + 1)) / rows;
    const n = Math.max(1, Math.round((yb - ya) / step) - 1);
    for (let k = 1; k <= n; k++) {
      const y = ya + ((yb - ya) * k) / (n + 1), r = onSheet(a, y, j, j);
      pts.push([Math.sin(a) * r, y, Math.cos(a) * r, Math.sin(a), 0, Math.cos(a)]);
    }
  }
  studs(put, o.rivet, pts, null, o.rivR ?? 0.025);
  return rad;
}
// Fût de 200 L (profil légèrement bombé, cercles de roulement, rebords sertis), centré ; open : sans couvercle, paroi
// intérieure visible
const drumCache = new Map();
function drum(seg = 20, open = false) {
  const key = seg + '|' + open;
  if (drumCache.has(key)) return drumCache.get(key);
  const prof = [[0, -0.53], [0.37, -0.53], [0.385, -0.55], [0.405, -0.55], [0.41, -0.52], [0.395, -0.5], [0.4, -0.2], [0.418, -0.18], [0.418, -0.16], [0.405, -0.14],
    [0.41, 0], [0.405, 0.14], [0.418, 0.16], [0.418, 0.18], [0.4, 0.2], [0.395, 0.5], [0.41, 0.52], [0.405, 0.55], [0.385, 0.55]];
  if (open) prof.push([0.375, 0.53], [0.372, 0.3], [0.37, -0.1]);
  else prof.push([0.37, 0.53], [0, 0.53]);
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  g.computeVertexNormals();
  const res = g.toNonIndexed();
  drumCache.set(key, res);
  return res;
}
// Matrice de pose : position, angles d'Euler, échelle
const at = (p, r = [0, 0, 0], s = 1) => mtx(p, r, s);
// Collisions simples alignées sur les pièces : boîte orientée (centre, demi-tailles, quaternion), boîte de a à b
// (comme bar et timber), boîte englobante bb d'une géométrie locale posée par la matrice mm
const solid = (L, c, half, q, o = {}) => L.game.world.add(new BoxCollider(c, half, q || null, { surface: 'metal', ...o }));
function solidBar(L, a, b, w, t, o) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  return solid(L, a.clone().add(b).multiplyScalar(0.5), V3(len / 2, w / 2, t / 2), new THREE.Quaternion().setFromUnitVectors(_tx, d.normalize()), o);
}
const _mp = new THREE.Vector3(), _mq = new THREE.Quaternion(), _ms = new THREE.Vector3();
// (maxY : la boîte n'est pas posée si elle monte plus haut)
function solidBox3(L, bb, mm, o, maxY = Infinity) {
  mm.decompose(_mp, _mq, _ms);
  const c = bb.getCenter(new THREE.Vector3()).applyMatrix4(mm), h = bb.getSize(new THREE.Vector3()).multiply(_ms).multiplyScalar(0.5);
  const col = new BoxCollider(c, V3(Math.abs(h.x), Math.abs(h.y), Math.abs(h.z)), _mq, { surface: 'metal', ...o });
  if (col.aabb.maxY <= maxY) L.game.world.add(col);
  return col;
}
// Cylindre d'axe ax (Vector3 unitaire) centré en c ; anneau (tore) d'axe ax centré en c
const _z = V3(0, 0, 1);
const cylAx = (rt, rb, h, seg, c, ax, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_sy, ax)).translate(c.x, c.y, c.z);
const ringAx = (R, r, c, ax, rs = 5, ts = 20, arc = Math.PI * 2) => new THREE.TorusGeometry(R, r, rs, ts, arc).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_z, ax)).translate(c.x, c.y, c.z);
// Bride boulonnée d'axe ax en c : disque de rayon R, n boulons à six pans sur le pourtour (des deux côtés si both)
function flange(put, mt, bolt, c, ax, R, n = 6, th = 0.05, both = false) {
  put(mt, cylAx(R, R, th, 16, c, ax));
  const u = new THREE.Vector3().crossVectors(ax, Math.abs(ax.y) < 0.9 ? _sy : _tx).normalize(), w = new THREE.Vector3().crossVectors(ax, u);
  for (let k = 0; k < n; k++) {
    const a = ((k + 0.5) / n) * Math.PI * 2, p = c.clone().addScaledVector(u, Math.cos(a) * R * 0.78).addScaledVector(w, Math.sin(a) * R * 0.78);
    for (const s of both ? [1, -1] : [1]) put(bolt, cylAx(R * 0.12, R * 0.12, th * 0.8, 6, p.clone().addScaledVector(ax, s * th * 0.75), ax));
  }
}
// Volant de vanne à rayons, d'axe ax, centré en c
function handwheel(put, mt, c, ax, R = 0.19) {
  put(mt, ringAx(R, R * 0.12, c, ax, 6, 22));
  put(mt, cylAx(R * 0.22, R * 0.22, R * 0.35, 10, c, ax));
  const u = new THREE.Vector3().crossVectors(ax, Math.abs(ax.y) < 0.9 ? _sy : _tx).normalize(), w = new THREE.Vector3().crossVectors(ax, u);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2, d = u.clone().multiplyScalar(Math.cos(a)).addScaledVector(w, Math.sin(a));
    put(mt, beam(c, c.clone().addScaledVector(d, R), R * 0.07, R * 0.07, 5));
  }
}

// ------------------------------------------------------------------ château d'eau de l'oasis
// Cuve en tôles rivetées peintes en turquoise (deux viroles, cerclages), fond en cuvette, toit conique en bardeaux de
// tôle à sous-face, épi d'aération ; quatre pieds tubulaires sur des massifs de béton, contreventés (ceintures et croix de
// Saint-André en tirants) ; échelle à crinoline accrochée à la cuve, dont le bas est tombé. W : centre au sol, top :
// haut de la cuve, ground(x, z) : hauteur du sol (pieds)
export function waterTower(L, W, top, ground) {
  const m = mats(), put = bag();
  const yT0 = top - 2.2;
  // cuve : deux viroles de douze tôles, cuvette, cerclages rivetés
  shell(put, m.tank, { r0: 2, y0: yT0, y1: top, rows: 2, cols: 12, a0: 0.13, rivet: m.iron, step: 0.32, rivR: 0.03, vert: true });
  put(m.tank, new THREE.CylinderGeometry(2.0, 0.55, 0.36, 24, 1, true).translate(0, yT0 - 0.18, 0));
  put(m.steelP, new THREE.CylinderGeometry(0.55, 0.55, 0.05, 16).translate(0, yT0 - 0.37, 0));
  for (const y of [yT0 + 0.03, top - 1.1, top - 0.03]) put(m.iron, new THREE.TorusGeometry(2.025, 0.045, 5, 48).rotateX(Math.PI / 2).translate(0, y, 0));
  // toit : cône bas en bardeaux de tôle, sous-face, rive, épi d'aération
  const roof = new THREE.ConeGeometry(2.3, 0.45, 40, 3, true);
  const uv = roof.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 12, uv.getY(i) * 1.8);
  put(m.roof, roof.translate(0, top + 0.225, 0));
  put(m.soffit, new THREE.RingGeometry(1.98, 2.3, 40, 1).rotateX(Math.PI / 2).translate(0, top + 0.005, 0));
  put(m.iron, new THREE.TorusGeometry(2.29, 0.035, 5, 44).rotateX(Math.PI / 2).translate(0, top + 0.01, 0));
  put(m.steelP, new THREE.CylinderGeometry(0.11, 0.13, 0.22, 10).translate(0, top + 0.5, 0));
  put(m.iron, new THREE.ConeGeometry(0.22, 0.14, 10).translate(0, top + 0.68, 0));
  // pieds : tubes du massif de béton jusque sous la cuvette (prolongés dans leur axe jusqu'à toucher la tôle), platines
  // boulonnées en pied, sabots inclinés comme la cuvette en tête. bowl(r) : hauteur du dessous de la cuvette au rayon r
  const bowl = (r) => yT0 - 0.36 + (0.36 * (r - 0.55)) / 1.45, kB = 0.36 / 1.45;
  const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => {
    const yb = Math.min(W.y, ground(W.x + sx * 1.45, W.z + sz * 1.45)) - 0.3;
    const foot = V3(sx * 1.45, yb, sz * 1.45), h0 = V3(sx * 1.2, yT0 - 0.32, sz * 1.2);
    const on = (y) => foot.clone().lerp(h0, (y - yb) / (h0.y - yb));
    let y = h0.y;
    for (let k = 0; k < 8; k++) { const p = on(y); y = bowl(Math.hypot(p.x, p.z)); }
    return { sx, sz, yb, foot, h0, head: on(y - 0.03) };
  });
  const legAt = (l, y) => l.foot.clone().lerp(l.head, (y - l.yb) / (l.head.y - l.yb));
  for (const l of legs) {
    put(m.steelP, beam(l.foot, l.head, 0.14, 0.11, 10));
    put(m.concrete, rboxAt(0.62, 0.5, 0.62, 0.05, l.foot.x, l.yb + 0.25, l.foot.z));
    const pl = legAt(l, l.yb + 0.55);
    put(m.iron, new THREE.BoxGeometry(0.42, 0.04, 0.42).translate(pl.x, l.yb + 0.52, pl.z));
    studs(put, m.iron, [[0.15, 0, 0.15], [-0.15, 0, 0.15], [0.15, 0, -0.15], [-0.15, 0, -0.15]].map(([x, , z]) => [pl.x + x, l.yb + 0.54, pl.z + z]), [0, 1, 0], 0.035);
    // sabot : semelle plaquée sous la cuvette (normale de la tôle), boulonnée
    const u = V3(l.head.x, 0, l.head.z).normalize(), rh = Math.hypot(l.head.x, l.head.z);
    const n = V3(-kB * u.x, 1, -kB * u.z).normalize(), c = V3(l.head.x, bowl(rh), l.head.z).addScaledVector(n, -0.025);
    put(m.iron, cylAx(0.2, 0.2, 0.05, 12, c, n));
    put(m.iron, cylAx(0.13, 0.15, 0.1, 10, c.clone().addScaledVector(n, -0.07), n));
    const t1 = new THREE.Vector3().crossVectors(n, u).normalize(), t2 = new THREE.Vector3().crossVectors(t1, n);
    studs(put, m.iron, [t1, t2, t1.clone().negate(), t2.clone().negate()].map((d) => [...c.clone().addScaledVector(d, 0.15).addScaledVector(n, -0.025).toArray(), ...n.clone().negate().toArray()]), null, 0.03);
  }
  // ceintures et croix de Saint-André
  const yLow = Math.max(...legs.map((l) => l.yb)) + 1.0, yTop = yT0 - 0.6, yMid = (yLow + yTop) / 2;
  const lv = [yLow, yMid, yTop];
  for (let k = 0; k < 4; k++) {
    const a = legs[k], b = legs[(k + 1) % 4];
    for (const y of lv) put(m.steelP, bar(legAt(a, y), legAt(b, y), 0.1, 0.06));
    for (let j = 0; j < 2; j++) {
      put(m.iron, beam(legAt(a, lv[j]), legAt(b, lv[j + 1]), 0.022, 0.022, 5));
      put(m.iron, beam(legAt(b, lv[j]), legAt(a, lv[j + 1]), 0.022, 0.022, 5));
      put(m.iron, cylAx(0.05, 0.05, 0.06, 8, legAt(a, (lv[j] + lv[j + 1]) / 2).lerp(legAt(b, (lv[j] + lv[j + 1]) / 2), 0.5), new THREE.Vector3(b.foot.x - a.foot.x, 0, b.foot.z - a.foot.z).normalize().cross(_sy)));
    }
  }
  // échelle à crinoline sur la cuve, côté chemin ; le bas de l'échelle est tombé (dernier tronçon à 1,8 m du sol)
  const th = Math.atan2(-0.8, -0.6), ax = V3(Math.sin(th), 0, Math.cos(th)), sd = V3(Math.cos(th), 0, -Math.sin(th));
  const rL = 2.2, yb0 = ground(W.x + ax.x * rL, W.z + ax.z * rL) + 1.8, yt = top - 0.08;
  const P = (s, y, r = rL) => V3(ax.x * r + sd.x * s, y, ax.z * r + sd.z * s);
  for (const s of [-0.22, 0.22]) put(m.iron, bar(P(s, s > 0 ? yb0 + 0.35 : yb0), P(s, yt), 0.05, 0.05));
  for (let y = yb0 + 0.45; y < yt - 0.1; y += 0.3) put(m.iron, beam(P(-0.22, y), P(0.22, y), 0.016, 0.016, 5));
  for (const y of [yT0 + 0.3, top - 0.4]) for (const s of [-0.22, 0.22]) put(m.iron, bar(P(s, y, 2.0), P(s, y, rL), 0.04, 0.04));
  // crinoline : arceaux en demi-cercle et lisses verticales
  const cy0 = yb0 + 1.4, cy1 = yt - 0.25;
  for (let y = cy0; y <= cy1 + 0.01; y += (cy1 - cy0) / Math.round((cy1 - cy0) / 0.7)) {
    const c = P(0, y);
    put(m.iron, new THREE.TorusGeometry(0.36, 0.016, 4, 14, Math.PI).rotateX(Math.PI / 2).rotateY(th).translate(c.x, c.y, c.z));
    // pattes : chaque arceau est boulonné aux deux montants
    for (const s of [-1, 1]) put(m.iron, bar(P(s * 0.375, y), P(s * 0.2, y), 0.035, 0.012));
  }
  for (const a of [0.45, Math.PI / 2, Math.PI - 0.45]) {
    const o = sd.clone().multiplyScalar(Math.cos(a) * 0.36).addScaledVector(ax, Math.sin(a) * 0.36);
    put(m.iron, bar(P(0, cy0).add(o), P(0, cy1).add(o), 0.03, 0.03));
  }
  // haubans de l'échelle vers le pied le plus proche
  const near = legs.reduce((b, l) => (l.foot.distanceTo(P(0, l.yb)) < b.foot.distanceTo(P(0, b.yb)) ? l : b));
  for (const y of [yb0 + 0.6, (yb0 + yT0) / 2]) put(m.iron, bar(legAt(near, y), P(0, y, rL - 0.02), 0.045, 0.045));
  put.flush(L, new THREE.Matrix4().makeTranslation(W.x, 0, W.z));
  // collisions : pieds jusque sous la cuve (aucun perchoir entre les deux), massifs, échelle (son sommet est à la hauteur
  // de la cuve, hors de portée du sol) ; les ceintures et les croix restent traversables : solides, elles feraient une
  // échelle vers le cristal sans Propulseur
  for (const l of legs) {
    L.game.world.add(new CylinderCollider(W.x + (l.foot.x + l.h0.x) / 2, W.z + (l.foot.z + l.h0.z) / 2, l.yb, yT0, 0.16, { surface: 'metal', blocksCamera: false }));
    solid(L, V3(W.x + l.foot.x, l.yb + 0.25, W.z + l.foot.z), V3(0.31, 0.25, 0.31), null, { surface: 'rock' });
  }
  solid(L, P(0, (yb0 + yt) / 2, rL + 0.17).add(V3(W.x, 0, W.z)), V3(0.32, (yt - yb0) / 2, 0.3), new THREE.Quaternion().setFromAxisAngle(_sy, th), { blocksCamera: false });
}

// Tuyau d'alimentation crevé : la conduite qui montait du sol par une vanne à volant s'est arrachée de la tubulure de la
// cuve (bride boulonnée), d'où l'eau jaillit en leak ; dir : direction de la fuite (vers le bassin), W : pied du château
export function leakPipe(L, leak, dir, W, ground) {
  const m = mats(), put = bag();
  const D = V3(Math.sin(dir), 0, Math.cos(dir)), Tn = V3(Math.cos(dir), 0, -Math.sin(dir));
  // tubulure sur la cuve (rayon 2) : bride rivetée, embout déchiqueté
  const c0 = V3(W.x, leak.y, W.z).addScaledVector(D, 2.02);
  flange(put, m.steelP, m.iron, c0, D, 0.24, 8, 0.05);
  put(m.rustP, cylAx(0.12, 0.12, 0.12, 14, V3(W.x, leak.y, W.z).addScaledVector(D, 2.06), D, true));
  put(m.hole, cylAx(0.108, 0.108, 0.1, 12, V3(W.x, leak.y, W.z).addScaledVector(D, 2.06), D, true));
  // conduite : pied sur un massif, vanne, coude, tronçon horizontal arraché
  const F = leak.clone().addScaledVector(D, 0.5).addScaledVector(Tn, 0.95);
  const g = ground(F.x, F.z);
  F.y = g;
  const R = 0.22, yh = leak.y, h = V3(leak.x - F.x, 0, leak.z - F.z).normalize();
  const r = 0.1;
  put(m.concrete, rboxAt(0.5, 0.4, 0.5, 0.04, F.x, g + 0.05, F.z));
  flange(put, m.steelP, m.iron, V3(F.x, g + 0.27, F.z), _sy, 0.2, 6, 0.05);
  const vy = Math.max(g + 1.05, (g + leak.y) / 2 - 0.3);
  put(m.rustP, beam(V3(F.x, g + 0.25, F.z), V3(F.x, vy - 0.2, F.z), r, r, 12));
  put(m.rustP, beam(V3(F.x, vy + 0.2, F.z), V3(F.x, yh - R, F.z), r, r, 12));
  for (const y of [g + 0.55, yh - R - 0.5]) put(m.iron, new THREE.TorusGeometry(r + 0.012, 0.018, 5, 14).rotateX(Math.PI / 2).translate(F.x, y, F.z));
  // vanne : corps, brides boulonnées des deux côtés, chapeau, tige et volant rouge tourné vers le chemin
  put(m.steelP, new THREE.SphereGeometry(0.17, 12, 8).scale(1, 1.1, 1).translate(F.x, vy, F.z));
  for (const s of [-1, 1]) flange(put, m.steelP, m.iron, V3(F.x, vy + s * 0.2, F.z), _sy, 0.19, 6, 0.05, true);
  const sx = Tn.clone().negate();
  put(m.steelP, cylAx(0.08, 0.1, 0.2, 10, V3(F.x, vy, F.z).addScaledVector(sx, 0.22), sx));
  put(m.metal, cylAx(0.022, 0.022, 0.3, 6, V3(F.x, vy, F.z).addScaledVector(sx, 0.42), sx));
  handwheel(put, m.redP, V3(F.x, vy, F.z).addScaledVector(sx, 0.52), sx, 0.2);
  // coude (quart de tore : monte en +y, repart vers h) puis tronçon qui pend, embout arraché et bride fendue
  const ex = h.clone().negate(), ez = new THREE.Vector3().crossVectors(ex, _sy);
  const C = V3(F.x, yh - R, F.z).addScaledVector(h, R);
  put(m.rustP, new THREE.TorusGeometry(R, r, 10, 10, Math.PI / 2).applyMatrix4(new THREE.Matrix4().makeBasis(ex, _sy, ez).setPosition(C)));
  const e0 = C.clone().add(V3(0, R, 0)), len = Math.hypot(leak.x - F.x, leak.z - F.z) - 0.5;
  const E = e0.clone().addScaledVector(h, len - R).add(V3(0, -0.14, 0));
  put(m.rustP, beam(e0, E, r, r, 12));
  const hd = E.clone().sub(e0).normalize();
  put(m.hole, cylAx(r * 0.9, r * 0.9, 0.02, 10, E.clone().addScaledVector(hd, -0.005), hd));
  put(m.steelP, ringAx(0.16, 0.035, E.clone().addScaledVector(hd, -0.03), hd, 5, 14, Math.PI * 1.35));
  for (let k = 0; k < 4; k++) {
    const a = k * 1.7 + 0.4, u = ez.clone().multiplyScalar(Math.cos(a)).add(V3(0, Math.sin(a), 0));
    const p = E.clone().addScaledVector(u, r * 0.95);
    put(m.rustP, bar(p, p.clone().addScaledVector(hd, 0.06 + k * 0.025).addScaledVector(u, 0.04), 0.06, 0.012));
  }
  put.flush(L, null);
  // collisions : massif, conduite et vanne jusqu'à 1,1 m au-dessus du pied du château au plus ; plus haut (coude, tronçon
  // arraché, tubulure) tout reste traversable : ce serait un marchepied vers la cuve et son cristal sans Propulseur
  const cap = Math.min(yh - R, W.y + 1.1);
  solid(L, V3(F.x, g + 0.05, F.z), V3(0.25, 0.2, 0.25), null, { surface: 'rock' });
  if (cap > g + 0.25) L.game.world.add(new CylinderCollider(F.x, F.z, g + 0.25, cap, 0.13, { surface: 'metal', blocksCamera: false }));
  if (vy - 0.25 < cap) {
    L.game.world.add(new CylinderCollider(F.x, F.z, vy - 0.25, Math.min(vy + 0.25, cap), 0.21, { surface: 'metal', blocksCamera: false }));
    if (vy + 0.2 <= cap) solid(L, V3(F.x, vy, F.z).addScaledVector(sx, 0.4), V3(0.16, 0.2, 0.2), new THREE.Quaternion().setFromUnitVectors(_tx, sx), { blocksCamera: false });
  }
}

// Pilier de mesa (plateforme naturelle)
export function mesa(L, pos, radius, top, o = {}) {
  const m = mats();
  const bottom = o.bottom ?? top - 40;
  const h = top - bottom;
  const seg = 18;
  const pts = [];
  const r = rand(0, 10);
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const y = t * h;
    let rr = radius * (0.72 + 0.28 * Math.pow(t, 0.6)) * (1 + Math.sin(t * 20 + r) * 0.04 + (Math.floor(t * 6) % 2) * 0.05);
    pts.push(new THREE.Vector2(Math.max(0.05, rr), y));
  }
  pts.push(new THREE.Vector2(radius * 0.96, h + 0.05));
  pts.push(new THREE.Vector2(0, h + 0.1));
  const geo = new THREE.LatheGeometry(pts, seg);
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3));
  // bosselage
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = noise3(v.x * 0.4 + r, v.y * 0.25, v.z * 0.4, 5) - 0.5;
    const k = Math.hypot(v.x, v.z) > 0.1 ? 1 + n * 0.25 : 1;
    p.setXYZ(i, v.x * k, v.y, v.z * k);
  }
  geo.computeVertexNormals();
  L.add(geo, o.mat || m.rock, mtx([pos.x, bottom, pos.z], [0, rand(0, 6), 0], 1));
  L.game.world.add(new CylinderCollider(pos.x, pos.z, bottom, top, radius * 0.97, { surface: o.surface || 'rock' }));
  // dessus : galets décoratifs
  if (o.pebbles !== false) for (let i = 0; i < 3; i++) {
    const a = rand(0, 6), d = rand(0.3, 0.75) * radius;
    rock(L, new THREE.Vector3(pos.x + Math.cos(a) * d, top, pos.z + Math.sin(a) * d), rand(0.25, 0.5), { collide: false, mat: o.mat });
  }
}

// Tôle ondulée de conteneur arrachée : pliée le long d'une génératrice, gondolée, UV décalées au hasard (centrée)
function bentSheet(len, hgt, R) {
  const g = corrugated(len, hgt, 0.2, 0.035, 0.25, -hgt / 2);
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  const f = (R() - 0.5) * len * 0.5, ang = (R() - 0.3) * 1.5, wob = 0.03 + R() * 0.1, du = R() * 4, dv = R() * 4;
  const v = V3(0, 0, 0), w = V3(0, 0, 0);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); w.fromBufferAttribute(n, i);
    v.z += Math.sin(v.y * 2.4 + v.x * 1.3) * wob;
    if (v.x > f) { v.x -= f; v.applyAxisAngle(_sy, ang); v.x += f; w.applyAxisAngle(_sy, ang); }
    p.setXYZ(i, v.x, v.y, v.z); n.setXYZ(i, w.x, w.y, w.z);
    uv.setXY(i, uv.getX(i) + du, uv.getY(i) + dv);
  }
  return g;
}
// matière double face des tôles (la face arrière d'une tôle isolée se voit)
function sheetMat(color) {
  const k = 'sheet' + color;
  if (!M[k]) { const t = containerTexture(color); M[k] = mat('#ffffff', { map: t.map, normalMap: t.normalMap, rough: 0.82, metal: 0.15, side: THREE.DoubleSide }); }
  return M[k];
}
// Tas de ferraille : tôles ondulées pliées, poutrelles, pneus, fûts cabossés, tuyaux à bride, engrenages, plaques
// rivetées, sur un monticule de sable (une géométrie par matière)
const SCRAP_COLORS = ['#c8452f', '#2f7ac8', '#e0a020', '#4a9a50', '#7a5ac8'];
export function scrapPile(L, pos, size = 2, seed = 1, o = {}) {
  const m = mats(), put = bag();
  const R = mkRng(seed);
  // pièces : géométries déjà posées (repère du tas), rangées par pièce pour pouvoir les laisser retomber
  const pieces = [];
  let cur = null;
  const add = (mt, g, mm) => { const c = ni(g); if (mm) c.applyMatrix4(mm); cur.parts.push([mt, c]); };
  const n = 11 + Math.floor(size * 5);
  const paints = [m.redP, m.yellowP, m.blueP, m.steelP];
  const cols = [];
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2, d = Math.sqrt(R()) * size * 0.62;
    const h = (1 - d / size) * size * 0.55;
    const p = [Math.cos(a) * d, h * (0.3 + 0.7 * R()), Math.sin(a) * d];
    const rot = [R() * 3, R() * 3, R() * 3];
    const t = R();
    cur = { parts: [], col: null };
    pieces.push(cur);
    if (t < 0.3) {
      // tôle pliée, à plat ou de chant
      const g = bentSheet(0.9 + R() * 1.1, 0.6 + R() * 0.7, R);
      const mt = sheetMat(SCRAP_COLORS[Math.floor(R() * SCRAP_COLORS.length)]), mm = at(p, [R() * 1.2 - 0.6 + (R() < 0.5 ? Math.PI / 2 : 0), R() * 6, R() * 0.8 - 0.4]);
      add(mt, g, mm);
      g.computeBoundingBox();
      cur.col = ([g.boundingBox.clone().expandByScalar(0.02), mm]);
    } else if (t < 0.44) {
      // poutrelle en I
      const len = 1.2 + R() * 1.4, hh = 0.22 + R() * 0.1, ww = 0.14;
      const mm = at(p, [R() * 0.6 - 0.3, R() * 6, R() * 0.9 - 0.45]);
      add(m.rustP, new THREE.BoxGeometry(len, hh - 0.04, 0.025), mm);
      for (const s of [1, -1]) add(m.rustP, new THREE.BoxGeometry(len, 0.025, ww).translate(0, s * (hh / 2 - 0.0125), 0), mm);
      cur.col = ([new THREE.Box3(V3(-len / 2, -hh / 2, -ww / 2), V3(len / 2, hh / 2, ww / 2)), mm]);
    } else if (t < 0.58) {
      const sq = R() < 0.5 ? 0.62 + R() * 0.3 : 1;
      const mm = at(p, rot, [1, sq, 1 + (1 - sq) * 0.4]);
      add(R() < 0.4 ? m.blueP : R() < 0.5 ? m.redP : m.rustP, drum(14), mm);
      cur.col = ([new THREE.Box3(V3(-0.418, -0.55, -0.418), V3(0.418, 0.55, 0.418)), mm]);
    } else if (t < 0.72) {
      const mm = at(p, [R() * 0.9 - 0.45 + (R() < 0.3 ? Math.PI / 2 : 0), R() * 6, R() * 0.9 - 0.45]);
      add(m.tire, tire(36), mm);
      cur.col = ([new THREE.Box3(V3(-0.65, -0.19, -0.65), V3(0.65, 0.19, 0.65)), mm]);
    } else if (t < 0.8) {
      // tuyau à bride
      const len = 1.0 + R() * 1.2, mm = at(p, rot);
      add(m.rustP, new THREE.CylinderGeometry(0.09, 0.09, len, 10, 1, true), mm);
      add(m.hole, new THREE.CylinderGeometry(0.08, 0.08, len - 0.02, 8, 1, true), mm);
      add(m.steelP, new THREE.CylinderGeometry(0.16, 0.16, 0.04, 12).translate(0, len / 2, 0), mm);
      cur.col = ([new THREE.Box3(V3(-0.12, -len / 2, -0.12), V3(0.12, len / 2, 0.12)), mm]);
    } else if (t < 0.88) {
      // engrenage
      const mm = at(p, [Math.PI / 2 + R() * 0.8 - 0.4, R() * 6, R() * 0.8 - 0.4], 0.7 + R() * 0.6), mt = R() < 0.5 ? m.rustP : m.steelP;
      add(mt, new THREE.CylinderGeometry(0.3, 0.3, 0.08, 18), mm);
      add(m.iron, new THREE.CylinderGeometry(0.09, 0.09, 0.14, 8), mm);
      for (let k = 0; k < 12; k++) add(mt, new THREE.BoxGeometry(0.09, 0.08, 0.11).translate(0, 0, 0.33).rotateY((k / 12) * Math.PI * 2), mm);
      cur.col = ([new THREE.Box3(V3(-0.36, -0.07, -0.36), V3(0.36, 0.07, 0.36)), mm]);
    } else {
      // plaque peinte rivetée
      const w = 0.6 + R() * 0.6, dd = 0.5 + R() * 0.4, mm = at(p, [R() * 1.6 - 0.8, R() * 6, R() * 1.6 - 0.8]);
      add(paints[Math.floor(R() * paints.length)], rboxAt(w, 0.05, dd, 0.015, 0, 0, 0), mm);
      const pts = [];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) pts.push([sx * (w / 2 - 0.06), 0.025, sz * (dd / 2 - 0.06)]);
      studs(add, m.iron, pts.map((q) => V3(...q).applyMatrix4(mm).toArray()), V3(0, 1, 0).transformDirection(mm).toArray(), 0.025);
      cur.col = ([new THREE.Box3(V3(-w / 2, -0.05, -dd / 2), V3(w / 2, 0.05, dd / 2)), mm]);
    }
  }
  const moundM = mtx([pos.x, pos.y - size * 0.15, pos.z], [0, R() * 6, 0], [size * 0.9, size * 0.35, size * 0.9]);
  // tassement : une pièce qui ne repose sur rien (aucun de ses points bas n'est pris dans le sol, le monticule ou une
  // autre pièce) descend à la verticale jusqu'au premier contact ; les autres restent où elles sont
  {
    const ray = new THREE.Raycaster(), down = V3(0, -1, 0), dm = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const meshes = pieces.map((pc) => {
      const g = new THREE.BufferGeometry(), arr = [];
      for (const [, c] of pc.parts) arr.push(...c.attributes.position.array);
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      g.computeBoundingBox();
      return new THREE.Mesh(g, dm);
    });
    const mound = new THREE.Mesh(rockGeo(seed), dm);
    mound.matrixAutoUpdate = false;
    mound.matrix.copy(moundM).premultiply(new THREE.Matrix4().makeTranslation(-pos.x, -pos.y, -pos.z));
    mound.matrixWorld.copy(mound.matrix);
    const nn = V3(0, 0, 0), v = V3(0, 0, 0);
    const groundGap = (x, y, z) => y - (gy(L, pos.x + x, pos.z + z) - pos.y);
    // distance verticale libre sous le point v (0 s'il est dans une pièce ou sous le sol)
    const free = (k, x, y, z, far) => {
      const g0 = groundGap(x, y, z);
      if (g0 <= 0.005) return 0;
      ray.set(v.set(x, y + 0.002, z), down);
      ray.far = Math.min(far, g0);
      const bb = meshes[k].geometry.boundingBox, cand = [mound];
      for (let j = 0; j < meshes.length; j++) {
        const b = meshes[j].geometry.boundingBox;
        if (j !== k && b.min.y < y && b.max.x > x && b.min.x < x && b.max.z > z && b.min.z < z) cand.push(meshes[j]);
      }
      void bb;
      const hit = ray.intersectObjects(cand, false)[0];
      if (!hit) return Math.min(far, g0);
      nn.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
      return nn.y < 0 ? 0 : hit.distance;
    };
    const order = pieces.map((pc, k) => [meshes[k].geometry.boundingBox.min.y, k]).sort((a, b) => a[0] - b[0]);
    for (const [, k] of order) {
      const pc = pieces[k], a = meshes[k].geometry.attributes.position, bb = meshes[k].geometry.boundingBox;
      // points de la pièce (96 au plus, les plus bas d'abord) : un seul pris dans le sol, le monticule ou une autre
      // pièce, et elle reste en place ; sinon elle descend de la plus petite hauteur libre sous ses points
      void bb;
      const idx = [...Array(a.count).keys()].sort((p, q) => a.getY(p) - a.getY(q));
      const step = Math.max(1, Math.ceil(idx.length / 96));
      let gap = Infinity;
      for (let q = 0; q < idx.length && gap > 0.03; q += step) gap = Math.min(gap, free(k, a.getX(idx[q]), a.getY(idx[q]), a.getZ(idx[q]), gap));
      if (!(gap > 0.03) || gap === Infinity) continue;
      const dy = -(gap - 0.01);
      for (const [, c] of pc.parts) c.translate(0, dy, 0);
      meshes[k].geometry.translate(0, dy, 0);
      meshes[k].geometry.computeBoundingBox();
      if (pc.col) pc.col[2] = dy;
    }
    for (const me of meshes) me.geometry.dispose();
  }
  for (const pc of pieces) {
    for (const [mt, c] of pc.parts) put(mt, c);
    if (pc.col) cols.push(pc.col);
  }
  const T = new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z);
  put.flush(L, T);
  // collisions : une boîte orientée par pièce, en plus du cylindre du tas (sans gêner la caméra), sauf les pièces qui
  // dépassent de plus de 0,5 m le haut du cylindre : elles feraient des perchoirs plus hauts qu'avant (avec le Propulseur,
  // le sommet des piles de conteneurs de la Casse deviendrait accessible sans le bloc aimanté)
  const lim = pos.y + size * 0.4 + 0.5;
  // (la boîte d'une pièce tassée la suit, posée seulement si elle l'était à la hauteur d'origine)
  if (o.collide !== false) for (const [bb, mm, dy = 0] of cols) {
    const col = solidBox3({ game: { world: { add() {} } } }, bb, T.clone().multiply(mm), {}, Infinity);
    if (col.aabb.maxY <= lim) solidBox3(L, bb, new THREE.Matrix4().makeTranslation(0, dy, 0).multiply(T).multiply(mm), { blocksCamera: false });
  }
  // monticule de base
  L.add(rockGeo(seed), m.rock, moundM);
  if (o.collide !== false) L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y - 1, pos.y + size * 0.4, size * 0.7, { surface: 'metal' }));
}

// Cactus-candélabre extraterrestre (tige côtelée, bras courbés, fleurs lumineuses)
const cactusGeo = {};

function ribbed(h, r) {
  const key = h + '|' + r;
  if (cactusGeo[key]) return cactusGeo[key];
  const g = new THREE.CylinderGeometry(r, r * 1.08, h, 16, 6);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const a = Math.atan2(v.z, v.x);
    const k = 1 + Math.cos(a * 8) * 0.09;
    p.setXYZ(i, v.x * k, v.y, v.z * k);
  }
  g.translate(0, h / 2, 0);
  g.computeVertexNormals();
  // dôme
  const top = new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, h, 0);
  cactusGeo[key] = mergeGeometries([g.toNonIndexed(), top.toNonIndexed()]);
  return cactusGeo[key];
}

export function cactus(L, pos, seed = 1, scale = 1) {
  const m = mats();
  const R = mkRng(seed);
  const s = scale;
  const h = (1.8 + R() * 1.4) * s, r = 0.32 * s;
  const body = R() < 0.5 ? m.cactus : m.cactusDark;
  L.add(ribbed(h, r), body, mtx([pos.x, pos.y - 0.1, pos.z], [0, R() * 6, 0]));
  const arms = 1 + Math.floor(R() * 2.2);
  const flowers = [[pos.x, pos.y + h + r * 0.6, pos.z]];
  for (let i = 0; i < arms; i++) {
    const a = R() * Math.PI * 2;
    const y0 = pos.y + h * (0.35 + R() * 0.3);
    const out = 0.55 * s;
    const ah = (0.6 + R() * 0.8) * s;
    const ar = r * 0.72;
    // coude horizontal
    L.add(G.capsule(ar, out, 4, 12), body, mtx([pos.x + Math.cos(a) * out * 0.55, y0, pos.z + Math.sin(a) * out * 0.55], [0, -a, Math.PI / 2]));
    L.add(ribbed(ah, ar), body, mtx([pos.x + Math.cos(a) * out, y0, pos.z + Math.sin(a) * out], [0, R() * 6, 0]));
    flowers.push([pos.x + Math.cos(a) * out, y0 + ah + ar * 0.6, pos.z + Math.sin(a) * out]);
  }
  for (const [x, y, z] of flowers) {
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      L.add(G.ellipsoid(0.13 * s, 0.04 * s, 0.07 * s, 8, 6), m.flower, mtx([x + Math.cos(a) * 0.1 * s, y, z + Math.sin(a) * 0.1 * s], [0, -a, 0.5]));
    }
    L.add(G.sphere(0.06 * s, 8, 6), m.lampGlow, mtx([x, y + 0.03, z]));
  }
  // épines
  for (let k = 0; k < 10; k++) {
    const a = R() * Math.PI * 2, y = pos.y + R() * h;
    L.add(G.cone(0.025 * s, 0.14 * s, 4), m.spike, mtx([pos.x + Math.cos(a) * r * 1.05, y, pos.z + Math.sin(a) * r * 1.05], [0, -a, -Math.PI / 2]));
  }
  L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y, pos.y + h, r * 1.1, { surface: 'grass' }));
}

// Pneu de camion : flancs bombés, bande de roulement à pavés (profil de révolution déformé)
const tireGeos = new Map();
function tire(seg = 144) {
  if (tireGeos.has(seg)) return tireGeos.get(seg);
  const prof = [[0.3, -0.15], [0.42, -0.19], [0.56, -0.18], [0.63, -0.13], [0.65, -0.05], [0.65, 0.05], [0.63, 0.13], [0.56, 0.18], [0.42, 0.19], [0.3, 0.15], [0.27, 0], [0.3, -0.15]];
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const r = Math.hypot(v.x, v.z);
    if (r > 0.6) {
      // pavés en chevrons : creux tous les 1/24 de tour, décalés de part et d'autre de l'axe
      const a = Math.atan2(v.z, v.x) * 24 / (Math.PI * 2) + (v.y > 0 ? 0.25 : -0.25);
      const k = (a - Math.floor(a)) < 0.3 ? 0.94 : 1;
      p.setXYZ(i, v.x * k, v.y, v.z * k);
    }
  }
  g.computeVertexNormals();
  g.userData.shared = true;
  tireGeos.set(seg, g);
  return g;
}
// Pneu posé (matière de caoutchouc du canyon), solide : matrice mm
export function tireAt(L, mm, seg = 72) {
  L.add(tire(seg), mats().tire, mm);
  solidBox3(L, new THREE.Box3(V3(-0.65, -0.19, -0.65), V3(0.65, 0.19, 0.65)), mm, { surface: 'rock', blocksCamera: false });
}

export function tireStack(L, pos, n = 3) {
  const m = mats();
  for (let i = 0; i < n; i++) L.add(tire(), m.tire, mtx([pos.x + rand(-0.06, 0.06), pos.y + 0.15 + i * 0.37, pos.z + rand(-0.06, 0.06)], [rand(-0.04, 0.04), rand(0, 3), rand(-0.04, 0.04)]));
  L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y, pos.y + n * 0.37 + 0.1, 0.62, { surface: 'rock' }));
}

// Cabane de ferrailleur : murs de tôle ondulée rapiécés sur poteaux de bois, toit de tôle en pente, porte en
// planches, fenêtre à croisillons, cheminée à chapeau
export function shack(L, pos, yaw, w = 5, d = 4, h = 3, o = {}) {
  const m = mats();
  const color = o.color || '#4d77a8';
  if (!contMats[color]) {
    const t = containerTexture(color);
    contMats[color] = mat('#ffffff', { map: t.map, normalMap: t.normalMap, rough: 0.82, metal: 0.15 });
  }
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const P = (x, y, z) => new THREE.Vector3(x, y, z).applyQuaternion(q).add(pos);
  const base = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1));
  const S = 0.3, pc = 0.16;
  const sheet = [], patch = [], wood = [], dark = [], steel = [];
  // toit monopente (bas côté porte, +z) : tôle ondulée sur sous-face plane, en ry au centre, incliné de tilt ;
  // under(z) : dessous de la sous-face au-dessus du point z (repère de la cabane). Les murs et la charpente montent
  // jusque-là : pignons fermés en trapèze, mur arrière jusque sous la tôle, rien ne dépasse du toit côté porte
  const rw = w + 0.8, rd = d + 0.9, tilt = 0.12, ry = h + 0.25, tn = Math.tan(tilt);
  const under = (z) => ry - 0.08 / Math.cos(tilt) - z * tn;
  const toRoof = (g) => {
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > h - 0.02) {
      const y = under(p.getZ(i)) + 0.01;
      p.setY(i, y);
      uv.setY(i, y * S);
    }
    return g;
  };
  // murs : tôle peinte, un pan rapiécé de tôle rouillée par mur latéral
  const wall = (len, hh) => corrugated(len, hh, 0.26, 0.045, S, 0.08);
  sheet.push(toRoof(wall(w - pc, h - 0.08).translate(0, 0, d / 2 - 0.02)));
  sheet.push(toRoof(wall(w - pc, h - 0.08).rotateY(Math.PI).translate(0, 0, -(d / 2 - 0.02))));
  for (const s of [1, -1]) {
    const a = d * 0.42;
    sheet.push(toRoof(corrugated(d - pc - a, h - 0.08, 0.26, 0.045, S, 0.08).translate(s * a / 2, 0, 0).rotateY(s * Math.PI / 2).translate(s * (w / 2 - 0.02), 0, 0)));
    patch.push(toRoof(corrugated(a, h - 0.08, 0.2, 0.04, S, 0.08).translate(-s * (d - pc - a) / 2, 0, 0.015).rotateY(s * Math.PI / 2).translate(s * (w / 2 - 0.02), 0, 0)));
  }
  // poteaux d'angle jusque sous le toit, sablières (avant, arrière, rampants des pignons), plinthe
  for (const x of [1, -1]) for (const z of [1, -1]) {
    const zp = z * (d / 2 - pc / 2 + 0.02), top = under(zp);
    wood.push(boxAt(boxUV(pc, top, pc, 0.5), x * (w / 2 - pc / 2 + 0.02), top / 2, zp));
  }
  for (const z of [1, -1]) {
    wood.push(boxAt(boxUV(w + 0.1, 0.14, 0.1, 0.5), 0, under(z * (d / 2 + 0.04)) - 0.07, z * (d / 2 + 0.04)));
    wood.push(boxAt(boxUV(w + 0.1, 0.18, 0.08, 0.5), 0, 0.09, z * (d / 2 + 0.03)));
  }
  for (const x of [1, -1]) wood.push(boxUV(0.1, 0.14, d + 0.1, 0.5).toNonIndexed().rotateX(tilt).translate(x * (w / 2 + 0.03), under(0) - 0.075, 0));
  // toit : tôle ondulée en pente (nervures dans le sens de la pente), sous-face plane, rives en bois
  const roofM = new THREE.Matrix4().compose(new THREE.Vector3(0, ry, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, 0, 0)), new THREE.Vector3(1, 1, 1));
  patch.push(corrugated(rw, rd, 0.3, 0.05, S, -rd / 2).rotateX(-Math.PI / 2).applyMatrix4(roofM));
  patch.push(boxUV(rw, 0.03, rd, S).toNonIndexed().translate(0, -0.065, 0).applyMatrix4(roofM));
  for (const x of [1, -1]) wood.push(boxUV(0.1, 0.12, rd, 0.5).toNonIndexed().translate(x * rw / 2, -0.02, 0).applyMatrix4(roofM));
  // porte en planches dans son cadre, poignée et gonds
  const dx = -w * 0.2, dw = 1.0, dh = 2.0, fz = d / 2 + 0.005;
  for (let i = 0; i < 4; i++) wood.push(boxAt(boxUV(dw / 4 - 0.015, dh, 0.06, 0.5), dx - dw / 2 + dw / 8 + i * dw / 4, 0.1 + dh / 2, fz + (i % 2) * 0.008));
  for (const y of [0.45, 1.65]) wood.push(boxAt(boxUV(dw, 0.12, 0.05, 0.5), dx, y, fz + 0.05));
  wood.push(boxUV(dw * 1.15, 0.12, 0.05, 0.5).toNonIndexed().rotateZ(Math.atan2(1.2, dw)).translate(dx, 1.05, fz + 0.075));
  for (const s of [1, -1]) dark.push(boxAt(G.box(0.1, dh + 0.12, 0.09), dx + s * (dw / 2 + 0.05), 0.1 + dh / 2, fz));
  dark.push(boxAt(G.box(dw + 0.2, 0.1, 0.09), dx, 0.16 + dh, fz));
  steel.push(G.cyl(0.035, 0.035, 0.14, 8).toNonIndexed().rotateX(Math.PI / 2).translate(dx + dw * 0.36, 1.0, fz + 0.1));
  for (const y of [0.4, 1.7]) dark.push(boxAt(G.box(0.3, 0.05, 0.03), dx - dw / 2 + 0.15, y, fz + 0.09));
  // fenêtre : vitre éclairée, cadre en bois, croisillons, appui
  const wx = w * 0.22, wy = h * 0.6;
  for (const s of [1, -1]) {
    wood.push(boxAt(boxUV(0.09, 0.85, 0.09, 0.5), wx + s * 0.55, wy, fz + 0.02));
    wood.push(boxAt(boxUV(1.2, 0.09, 0.09, 0.5), wx, wy + s * 0.42, fz + 0.02));
  }
  dark.push(boxAt(G.box(1.02, 0.04, 0.03), wx, wy, fz + 0.05));
  dark.push(boxAt(G.box(0.04, 0.76, 0.03), wx, wy, fz + 0.05));
  wood.push(boxAt(boxUV(1.35, 0.07, 0.22, 0.5), wx, wy - 0.5, fz + 0.08));
  L.add(G.box(1.04, 0.78, 0.04), glow(o.window || '#ffcf6a', 1.4), new THREE.Matrix4().compose(P(wx, wy, fz), q, new THREE.Vector3(1, 1, 1)));
  lights.add({ pos: P(wx, wy, d / 2 + 0.7), color: o.window || '#ffcf6a', intensity: 14, range: 7, priority: 0.9 });
  // cheminée : tuyau, collier, chapeau
  const cx = w * 0.3, cz = -d * 0.2, ctop = h + 1.5;
  steel.push(boxAt(G.cyl(0.18, 0.18, 1.6, 12), cx, ctop - 0.8, cz));
  dark.push(boxAt(G.cyl(0.21, 0.21, 0.08, 12), cx, ctop - 0.35, cz));
  dark.push(boxAt(G.cone(0.34, 0.2, 12), cx, ctop + 0.22, cz));
  for (const a of [0, 2.1, 4.2]) dark.push(boxAt(G.box(0.02, 0.14, 0.02), cx + Math.cos(a) * 0.15, ctop + 0.06, cz + Math.sin(a) * 0.15));
  // solin : collerette de tôle à la traversée du toit
  dark.push(G.cyl(0.25, 0.3, 0.12, 12).toNonIndexed().rotateX(tilt).translate(cx, ry - cz * tn + 0.02, cz));
  L.add(mergeParts(sheet), contMats[color], base);
  L.add(mergeParts(patch), m.scrap, base);
  L.add(mergeParts(wood), m.wood, base);
  L.add(mergeParts(dark), m.metalDark, base);
  L.add(mergeParts(steel), m.rust, base);
  L.game.world.add(new BoxCollider(new THREE.Vector3(pos.x, pos.y + h / 2 + 0.2, pos.z), new THREE.Vector3(w / 2 + 0.2, h / 2 + 0.2, d / 2 + 0.2), q, { surface: 'metal' }));
}

// Épave de robot géant à moitié enfouie : crâne en plaques de tôle rivetées et cabossées (quelques plaques arrachées
// laissent voir l'ossature), orbites cerclées aux lentilles éteintes, arcade, dents ; mâchoire articulée pendante
// (charnières, vérins) ; antenne tordue à ampoule rose ; câbles et durites arrachés qui sortent du cou et traînent au sol
export function carcass(L, pos, yaw = 0, s = 1) {
  const m = mats(), put = bag(), wp = bag();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25, yaw, 0.15));
  const Wm = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(s, s, s));
  const R = mkRng((Math.floor(pos.x * 31 + pos.z * 17) & 0xffff) + 1);
  const E = V3(4, 3.4, 3.8), C = V3(0, 1.5, 0);
  const eyes = [-1, 1].map((sx) => V3(sx * 1.6 / 4, 0.7 / 3.4, Math.sqrt(1 - 0.16 - (0.7 / 3.4) ** 2)).normalize());
  // bosses : creux gaussiens sur la sphère unité (loin des orbites)
  const dents = [];
  while (dents.length < 8) {
    const t = 0.3 + R() * 1.9, f = R() * Math.PI * 2;
    const d = V3(-Math.cos(f) * Math.sin(t), Math.cos(t), Math.sin(f) * Math.sin(t));
    if (eyes.some((e) => e.dot(d) > 0.82)) continue;
    dents.push([d, 0.18 + R() * 0.25, 0.05 + R() * 0.08]);
  }
  const surf = (u, k) => {
    let d = 0;
    for (const [dv, sz, dp] of dents) { const a = Math.acos(Math.min(1, u.dot(dv))); d += dp * Math.exp(-(a / sz) * (a / sz)); }
    return V3(C.x + E.x * u.x * (k - d), C.y + E.y * u.y * (k - d), C.z + E.z * u.z * (k - d));
  };
  const nrm = (u) => V3(u.x / E.x, u.y / E.y, u.z / E.z).normalize();
  const U = (phi, th) => V3(-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th));
  // plaques : 10 fuseaux × 6 rangées (la dernière est enfouie) ; trois plaques arrachées à l'arrière
  const NU = 10, NV = 6, dP = (Math.PI * 2) / NU, dT = Math.PI / NV;
  const missing = new Set();
  while (missing.size < 3) missing.add(Math.floor(5 + R() * 4) + ',' + (1 + Math.floor(R() * 3)));
  const riv = [];
  for (let j = 0; j < NV - 1; j++) for (let i = 0; i < NU; i++) {
    const phi0 = i * dP + 0.16, th0 = j * dT;
    if (missing.has(i + ',' + j)) continue;
    const k = 1 + ((i + j) % 2) * 0.014 + R() * 0.006;
    const g = new THREE.SphereGeometry(1, 4, j === 0 ? 2 : 3, phi0, dP, th0, dT);
    const p = g.attributes.position, u = V3(0, 0, 0);
    for (let n = 0; n < p.count; n++) {
      u.fromBufferAttribute(p, n).normalize();
      const w = surf(u, k);
      p.setXYZ(n, w.x, w.y, w.z);
    }
    g.computeVertexNormals();
    put(m.robot, g);
    // rivets le long du bord gauche (méridien) et du bord haut (parallèle) de la plaque
    for (let t = 0.12; t < 1; t += 0.24) {
      const a = U(phi0 + 0.025, th0 + dT * t);
      if (j > 0 || t > 0.5) riv.push([...surf(a, k).addScaledVector(nrm(a), -0.012).toArray(), ...nrm(a).toArray()]);
    }
    if (j > 0) for (let t = 0.15; t < 1; t += 0.3) { const a = U(phi0 + dP * t, th0 + 0.03); riv.push([...surf(a, k).addScaledVector(nrm(a), -0.012).toArray(), ...nrm(a).toArray()]); }
  }
  studs(put, m.iron, riv, null, 0.075);
  // intérieur sombre et ossature visible par les trous
  put(m.hole, new THREE.SphereGeometry(1, 16, 10).scale(E.x * 0.95, E.y * 0.95, E.z * 0.95).translate(C.x, C.y, C.z));
  for (const key of missing) {
    const [i, j] = key.split(',').map(Number);
    const phi = i * dP + 0.16 + dP / 2, pts = [];
    for (let t = Math.max(0.2, (j - 0.6) * dT); t < (j + 1.6) * dT; t += 0.15) pts.push(surf(U(phi, t), 0.975));
    put(m.steelP, tube(pts, 0.09, 12, 5));
    const th = (j + 0.5) * dT, ring = [];
    for (let t = -0.8; t <= 0.8; t += 0.2) ring.push(surf(U(phi + t, th), 0.975));
    put(m.steelP, tube(ring, 0.07, 10, 5));
  }
  // orbites : cerclage boulonné, puits sombre, lentille éteinte (fêlée à droite), iris
  for (const e of eyes) {
    const p = surf(e, 1.0), n = nrm(e);
    put(m.steelP, ringAx(0.98, 0.17, p.clone().addScaledVector(n, 0.04), n, 8, 28));
    put(m.hole, cylAx(0.92, 0.82, 0.8, 20, p.clone().addScaledVector(n, -0.3), n, true));
    put(glow('#6a1818', 1.3), cylAx(0.7, 0.7, 0.04, 20, p.clone().addScaledVector(n, -0.12), n));
    put(m.iron, ringAx(0.46, 0.05, p.clone().addScaledVector(n, -0.09), n, 5, 20));
    const u = new THREE.Vector3().crossVectors(n, _sy).normalize(), w = new THREE.Vector3().crossVectors(u, n);
    const bp = [];
    for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; bp.push([...p.clone().addScaledVector(u, Math.cos(a) * 0.98).addScaledVector(w, Math.sin(a) * 0.98).addScaledVector(n, 0.2).toArray()]); }
    studs(put, m.iron, bp, n.toArray(), 0.07);
    if (e.x > 0) for (const a of [0.5, 2.2]) put(m.iron, bar(p.clone().addScaledVector(n, -0.09), p.clone().addScaledVector(n, -0.09).addScaledVector(u, Math.cos(a) * 0.68).addScaledVector(w, Math.sin(a) * 0.68), 0.04, 0.03));
  }
  // arcade au-dessus des orbites, dents du haut
  const brow = [];
  for (let x = -2.7; x <= 2.71; x += 0.45) { const a = V3(x / 4, 1.75 / 3.4, 0); a.z = Math.sqrt(Math.max(0, 1 - a.x * a.x - a.y * a.y)); brow.push(surf(a.normalize(), 1.03)); }
  put(m.steelP, tube(brow, 0.16, 24, 6));
  for (let k = 0; k < 7; k++) {
    const x = -1.95 + k * 0.65, a = V3(x / 4, -0.62 / 3.4, 0);
    a.z = Math.sqrt(1 - a.x * a.x - a.y * a.y);
    const p = surf(a, 1.0);
    put(m.metal, rboxAt(0.44, 0.5, 0.34, 0.07, 0, 0, 0).rotateY(Math.atan2(a.x / 4, a.z / 3.8)).translate(p.x, p.y - 0.28, p.z - 0.06));
  }
  // mâchoire articulée, ouverte (rotation autour des charnières)
  const hinge = V3(0, 0.25, 1.5);
  const J = new THREE.Matrix4().makeTranslation(hinge.x, hinge.y, hinge.z).multiply(new THREE.Matrix4().makeRotationX(0.38)).multiply(new THREE.Matrix4().makeTranslation(-hinge.x, -hinge.y, -hinge.z));
  put(m.robot, rboxAt(5.0, 0.95, 1.5, 0.25, 0, -0.55, 3.0), J);
  put(m.robot, rboxAt(4.4, 0.5, 1.3, 0.15, 0, -1.05, 2.7), J);
  for (const sx of [-1, 1]) put(m.robot, rboxAt(0.4, 0.7, 2.2, 0.1, sx * 2.65, -0.25, 2.0), J);
  for (let k = 0; k < 7; k++) put(m.metal, rboxAt(0.42, 0.42, 0.3, 0.07, -1.95 + k * 0.65, 0.05, 3.55), J);
  const jr = [];
  for (let k = 0; k < 9; k++) jr.push([-2.2 + k * 0.55, -0.3, 3.745]);
  studs(put, m.iron, jr.map((p) => [...V3(...p).applyMatrix4(J).toArray()]), V3(0, 0, 1).transformDirection(J).toArray(), 0.07);
  for (const sx of [-1, 1]) {
    const hc = V3(sx * 2.95, hinge.y, hinge.z);
    put(m.steelP, cylAx(0.42, 0.42, 0.6, 16, hc, _tx));
    put(m.iron, cylAx(0.2, 0.2, 0.72, 6, hc, _tx));
    // vérin : corps fixé au crâne, tige jusqu'au bras de la mâchoire
    const A = V3(sx * 3.55, 2.1, 0.9), B = V3(sx * 2.9, -0.35, 2.9).applyMatrix4(J), mid = A.clone().lerp(B, 0.55);
    put(m.steelP, beam(A, mid, 0.17, 0.17, 10));
    put(m.metal, beam(mid, B, 0.075, 0.075, 8));
    for (const c of [A, B]) put(m.iron, cylAx(0.2, 0.2, 0.22, 10, c, _tx));
  }
  // plaque frontale (plateforme) : trappe rivetée et sa poignée
  const TP = at([0, 4.7, 0.4], [-0.25, 0, -0.15]);
  put(m.steelP, rboxAt(3.2, 0.4, 2.4, 0.1, 0, 0, 0), TP);
  const tp = [];
  for (let k = 0; k < 8; k++) for (const z of [-1.05, 1.05]) tp.push([-1.4 + k * 0.4, 0.2, z]);
  for (let k = 1; k < 5; k++) for (const x of [-1.45, 1.45]) tp.push([x, 0.2, -1.05 + k * 0.42]);
  studs(put, m.iron, tp.map((p) => V3(...p).applyMatrix4(TP).toArray()), V3(0, 1, 0).transformDirection(TP).toArray(), 0.06);
  put(m.iron, bar(V3(-0.5, 0.3, 0.6), V3(0.5, 0.3, 0.6), 0.06, 0.06), TP);
  for (const x of [-0.5, 0.5]) put(m.iron, bar(V3(x, 0.2, 0.6), V3(x, 0.32, 0.6), 0.06, 0.06), TP);
  // antenne tordue : embase boulonnée, deux tronçons coudés, ampoule rose dans sa cage
  const ab = V3(0.3, 4.72, -1.0), j1 = V3(1.3, 6.6, -0.8), j2 = V3(2.6, 7.75, -1.3), bulb = V3(2.9, 8.2, -1.4);
  put(m.steelP, cylAx(0.45, 0.55, 0.3, 12, ab, _sy));
  studs(put, m.iron, [0, 1, 2, 3, 4, 5].map((k) => [ab.x + Math.cos(k * 1.05) * 0.42, ab.y + 0.16, ab.z + Math.sin(k * 1.05) * 0.42]), [0, 1, 0], 0.06);
  put(m.metal, beam(ab, j1, 0.2, 0.15, 8));
  put(m.iron, new THREE.SphereGeometry(0.24, 10, 8).translate(j1.x, j1.y, j1.z));
  put(m.metal, beam(j1, j2, 0.12, 0.1, 8));
  put(m.iron, cylAx(0.2, 0.14, 0.28, 10, j2.clone().lerp(bulb, 0.4), bulb.clone().sub(j2).normalize()));
  put(m.pinkGlow, new THREE.SphereGeometry(0.45, 12, 8).translate(bulb.x, bulb.y, bulb.z));
  const ba = bulb.clone().sub(j2).normalize();
  for (const t of [0, 1.05, 2.1]) put(m.iron, ringAx(0.5, 0.025, bulb, V3(Math.cos(t), 0, Math.sin(t)).cross(ba).normalize(), 4, 20));
  // cou arraché : collerette, puis câbles et durites qui traînent au sol (en coordonnées du monde)
  const nd = V3(0, -0.28, -0.96).normalize(), np = surf(nd, 1.0), nn = nrm(nd);
  put(m.steelP, ringAx(1.15, 0.2, np, nn, 8, 24));
  put(m.hole, cylAx(1.05, 1.05, 0.4, 18, np.clone().addScaledVector(nn, -0.15), nn));
  const side = V3(1, 0, 0).applyQuaternion(q).setY(0).normalize();
  const wires = [mat('#d8402e', { rough: 0.45 }), mat('#ffcc33', { rough: 0.45 }), mat('#3a6ad8', { rough: 0.45 })];
  const nu = new THREE.Vector3().crossVectors(nn, _sy).normalize(), nw = new THREE.Vector3().crossVectors(nu, nn);
  for (let k = 0; k < 7; k++) {
    const a = -0.4 + (k / 6) * (Math.PI + 0.8), rr = 0.35 + R() * 0.45;
    const st = np.clone().addScaledVector(nu, Math.cos(a) * rr).addScaledVector(nw, Math.sin(a) * rr * 0.8 + 0.15).addScaledVector(nn, 0.05).applyMatrix4(Wm);
    const out = V3(0, 0, 0).addScaledVector(nn, 1).transformDirection(Wm).setY(0).normalize();
    const reach = (1.6 + R() * 2.4) * s, lat = (R() - 0.5) * 3 * s, ext = 0.6 + R(), exl = (R() - 0.5) * 0.8;
    // au pied d'une falaise, les câbles s'arrêtent au sol de l'épave au lieu de grimper la paroi : on raccourcit leur
    // portée tant que leurs bouts tomberaient à plus de 0,8 m au-dessus du sol où l'épave est posée
    const gRef = pos.y + 0.9 * s;
    let f = 1, en, ex;
    for (;;) {
      en = st.clone().addScaledVector(out, reach * f).addScaledVector(side, lat * f);
      en.y = gy(L, en.x, en.z) + 0.04;
      ex = en.clone().addScaledVector(out, ext * f).addScaledVector(side, exl * f);
      ex.y = gy(L, ex.x, ex.z) + 0.04;
      if (f <= 0.2 || Math.max(en.y, ex.y) < gRef + 0.8) break;
      f -= 0.1;
    }
    const m1 = st.clone().addScaledVector(out, 0.5 * s).add(V3(0, -0.15, 0));
    const m2 = st.clone().lerp(en, 0.7);
    m2.y = Math.max(en.y + 0.15, Math.min(m1.y - 0.3, gy(L, m2.x, m2.z) + 0.35));
    const pts = [st, m1, m2, en, ex], hose = k % 3 === 0;
    const r = hose ? 0.13 * s : (0.04 + R() * 0.03) * s;
    const tg = tube(pts, r, 28, hose ? 8 : 5);
    wp(hose ? m.cable : wires[k % 3], tg);
    if (hose) {
      const crv = new THREE.CatmullRomCurve3(pts);
      for (let t = 0.04; t < 0.98; t += 0.035) wp(m.iron, ringAx(r + 0.01, 0.018 * s, crv.getPointAt(t), crv.getTangentAt(t), 4, 12));
      wp(m.steelP, ringAx(r + 0.03, 0.04 * s, ex, crv.getTangentAt(1), 5, 12));
    } else wp(m.copper, cylAx(r * 0.6, r * 0.6, 0.12, 6, ex, ex.clone().sub(en).normalize()));
  }
  put.flush(L, Wm);
  wp.flush(L, null);
  // collisions ajoutées : mâchoire (boîte inclinée comme elle, dents comprises) et collerette du cou. L'antenne (solide,
  // ce serait une rampe vers le boulon d'or), la trappe du dessus (un plafond juste au-dessus de l'appui existant) et les
  // câbles au sol restent traversables
  solid(L, V3(0, -0.52, 2.95).applyMatrix4(J).applyMatrix4(Wm), V3(2.5 * s, 0.78 * s, 0.85 * s), q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(_tx, 0.38)));
  solid(L, np.clone().applyMatrix4(Wm), V3(1.35 * s, 1.35 * s, 0.25 * s), q.clone().multiply(new THREE.Quaternion().setFromUnitVectors(_z, nn)), { blocksCamera: false });
  L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y - 2, pos.y + 3.6 * s, 3.4 * s, { surface: 'metal' }));
}

// Tour d'aspiration Vorax (animée) : socle tronconique boulonné à goussets et trappe, fût en tôles violettes rivetées
// à nervures, colliers dorés boulonnés, passerelle circulaire en tôle larmée avec garde-corps et échelle à crinoline,
// pavillon blanc en tôles sur jambes de force ; colonne à bandes de danger
export function voraxVacuum(L, pos, s = 1) {
  const m = mats(), put = bag();
  const P = (x, y, z) => [pos.x + x * s, pos.y + y * s, pos.z + z * s];
  // socle : virole en seize tôles, embase et couronne boulonnées, goussets, trappe d'accès à bandes de danger
  shell(put, m.steelP, { r0: 5, r1: 4, y0: 0, y1: 3, rows: 1, cols: 16, lap: 0.02, a0: 0.1 });
  put(m.steelP, new THREE.CylinderGeometry(5.12, 5.12, 0.25, 32).translate(0, 0.12, 0));
  put(m.steelP, new THREE.RingGeometry(3.15, 4.12, 32, 1).rotateX(-Math.PI / 2).translate(0, 3.0, 0));
  put(m.steelP, new THREE.CylinderGeometry(4.12, 4.12, 0.14, 32, 1, true).translate(0, 2.95, 0));
  const bolts = [];
  for (let k = 0; k < 40; k++) { const a = (k / 40) * Math.PI * 2; bolts.push([Math.sin(a) * 4.95, 0.26, Math.cos(a) * 4.95, 0, 1, 0]); }
  for (let k = 0; k < 32; k++) { const a = (k / 32) * Math.PI * 2; bolts.push([Math.sin(a) * 3.85, 3.02, Math.cos(a) * 3.85, 0, 1, 0]); }
  studs(put, m.iron, bolts, null, 0.06);
  const rad = (y) => 3.2 - (0.7 * (y - 3)) / 16;
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) / 8) * Math.PI * 2;
    const sh = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.75, 0), new THREE.Vector2(0, 1.6)]);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.1, bevelEnabled: false }).translate(rad(3) - 0.07, 0, -0.05);
    put(m.voraxD, g.rotateY(a - Math.PI / 2).translate(0, 3.0, 0));
  }
  {
    const a = -2.75, c = V3(Math.sin(a) * 4.62, 1.25, Math.cos(a) * 4.62), tilt = Math.atan2(1, 3);
    const D = new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(new THREE.Matrix4().makeRotationY(a)).multiply(new THREE.Matrix4().makeRotationX(-tilt));
    put(m.hazard, new THREE.BoxGeometry(1.5, 2.0, 0.06), D);
    put(m.voraxD, new THREE.BoxGeometry(1.15, 1.65, 0.1).translate(0, 0, 0.02), D);
    put(m.iron, new THREE.BoxGeometry(0.08, 0.3, 0.08).translate(0.42, 0, 0.1), D);
    for (const y of [-0.55, 0.55]) put(m.iron, new THREE.BoxGeometry(0.3, 0.08, 0.06).translate(-0.5, y, 0.08), D);
  }
  // fût : quatre viroles de douze tôles, rivets aux joints horizontaux, nervures sur les joints verticaux
  shell(put, m.voraxP, { r0: 3.2, r1: 2.5, y0: 3, y1: 19, rows: 4, cols: 12, lap: 0.015, a0: 0.26, rivet: m.voraxD, step: 0.45, rivR: 0.05 });
  for (let k = 0; k < 12; k++) {
    const a = 0.26 + (k * Math.PI * 2) / 12;
    put(m.voraxD, new THREE.BoxGeometry(0.14, 16.02, 0.2).rotateX(-Math.atan2(0.7, 16)).translate(0, 11, 2.95).rotateY(a));
  }
  // colliers dorés boulonnés
  for (const y of [5, 9, 13, 17]) {
    const r = rad(y) + 0.16;
    put(m.gold, new THREE.CylinderGeometry(r, r + 0.02, 0.5, 36, 1, true).translate(0, y, 0));
    for (const dy of [-0.25, 0.25]) put(m.gold, new THREE.TorusGeometry(r + 0.01, 0.06, 5, 40).rotateX(Math.PI / 2).translate(0, y + dy, 0));
    const bp = [];
    for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; bp.push([Math.sin(a) * (r + 0.02), y, Math.cos(a) * (r + 0.02), Math.sin(a), 0, Math.cos(a)]); }
    studs(put, m.iron, bp, null, 0.06);
  }
  // passerelle à 11 m : plancher en tôle larmée (UV en mètres), rive, garde-corps, consoles
  const yc = 11, ri = rad(yc) + 0.05, ro = 3.95, rv = rad(yc) - 0.03;
  const deck = new THREE.RingGeometry(rv, ro, 40, 1).rotateX(-Math.PI / 2);
  { const p = deck.attributes.position, uv = deck.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * 2, p.getZ(i) * 2); }
  put(m.tread, deck.translate(0, yc, 0));
  put(m.steelP, new THREE.CylinderGeometry(ro, ro, 0.16, 40, 1, true).translate(0, yc - 0.05, 0));
  put(m.steelP, new THREE.RingGeometry(rv, ro, 40, 1).rotateX(Math.PI / 2).translate(0, yc - 0.13, 0));
  for (const y of [yc + 0.55, yc + 1.05]) put(m.iron, new THREE.TorusGeometry(ro - 0.04, y > yc + 1 ? 0.04 : 0.025, 5, 56).rotateX(Math.PI / 2).translate(0, y, 0));
  for (let k = 0; k < 30; k++) {
    const a = (k / 30) * Math.PI * 2, r = ro - 0.04;
    put(m.iron, new THREE.BoxGeometry(0.05, 1.05, 0.05).translate(Math.sin(a) * r, yc + 0.53, Math.cos(a) * r));
  }
  for (let k = 0; k < 10; k++) {
    const a = ((k + 0.5) / 10) * Math.PI * 2, u = V3(Math.sin(a), 0, Math.cos(a));
    put(m.steelP, bar(u.clone().multiplyScalar(rad(yc - 1.6) + 0.05).setY(yc - 1.6), u.clone().multiplyScalar(ro - 0.2).setY(yc - 0.12), 0.12, 0.08));
    put(m.steelP, bar(u.clone().multiplyScalar(rv).setY(yc - 0.18), u.clone().multiplyScalar(ro - 0.05).setY(yc - 0.18), 0.12, 0.08));
  }
  // échelle à crinoline du socle à la passerelle (trémie dans le garde-corps)
  {
    const th = -2.2, ax = V3(Math.sin(th), 0, Math.cos(th)), sd = V3(Math.cos(th), 0, -Math.sin(th)), rl = 3.45;
    const Q = (x, y, r = rl) => V3(ax.x * r + sd.x * x, y, ax.z * r + sd.z * x);
    for (const x of [-0.24, 0.24]) put(m.iron, bar(Q(x, 3.0), Q(x, yc + 1.05), 0.06, 0.06));
    for (let y = 3.3; y < yc; y += 0.3) put(m.iron, beam(Q(-0.24, y), Q(0.24, y), 0.02, 0.02, 5));
    for (let y = 5.2; y <= yc + 0.6; y += 0.75) {
      const c = Q(0, y);
      put(m.iron, new THREE.TorusGeometry(0.4, 0.02, 4, 14, Math.PI).rotateX(Math.PI / 2).rotateY(th).translate(c.x, c.y, c.z));
      for (const x of [-1, 1]) put(m.iron, bar(Q(x * 0.415, y), Q(x * 0.22, y), 0.04, 0.014));
    }
    for (const a of [0.5, Math.PI / 2, Math.PI - 0.5]) {
      const o = sd.clone().multiplyScalar(Math.cos(a) * 0.4).addScaledVector(ax, Math.sin(a) * 0.4);
      put(m.iron, bar(Q(0, 5.2).add(o), Q(0, yc + 0.6).add(o), 0.035, 0.035));
    }
    for (const y of [4.5, 7.5]) for (const x of [-0.24, 0.24]) put(m.iron, bar(Q(x, y, rad(y)), Q(x, y), 0.05, 0.05));
  }
  // pavillon : seize tôles blanches, lèvre dorée, bride au fût, jambes de force
  shell(put, m.voraxW, { r0: 2.6, r1: 5, y0: 19, y1: 23, rows: 1, cols: 16, seg: 2, lap: 0.02, a0: 0.05, rivet: m.iron, step: 0.5, rivR: 0.05 });
  put(m.gold, new THREE.TorusGeometry(5.02, 0.14, 6, 48).rotateX(Math.PI / 2).translate(0, 23, 0));
  put(m.steelP, new THREE.CylinderGeometry(2.78, 2.78, 0.3, 32).translate(0, 19, 0));
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) / 8) * Math.PI * 2, u = V3(Math.sin(a), 0, Math.cos(a));
    put(m.steelP, beam(u.clone().multiplyScalar(rad(17.6) - 0.02).setY(17.6), u.clone().multiplyScalar(4.25).setY(22.2), 0.09, 0.09, 6));
  }
  // colonne à bandes de danger : fût chanfreiné, chapeau et pied boulonnés
  const hz = rboxAt(1.4, 10, 1.4, 0.12, 4, 5, 0);
  { const p = hz.attributes.position, n = hz.attributes.normal, uv = hz.attributes.uv; for (let i = 0; i < p.count; i++) { const side = Math.abs(n.getY(i)) < 0.5; uv.setXY(i, side ? (p.getX(i) + p.getZ(i)) * 0.45 : p.getX(i) * 0.45, side ? p.getY(i) * 0.45 : p.getZ(i) * 0.45); } }
  put(m.hazard, hz);
  for (const y of [0.25, 9.8]) put(m.steelP, rboxAt(1.62, 0.4, 1.62, 0.06, 4, y, 0));
  studs(put, m.iron, [[-0.6, -0.6], [0.6, -0.6], [0.6, 0.6], [-0.6, 0.6]].map(([x, z]) => [4 + x, 10.01, z]), [0, 1, 0], 0.07);
  // consoles du panneau VORAX (dos du panneau en z = 3,21) : platine sur le fût, bras jusqu'au panneau
  for (const x of [-1.5, 1.5]) for (const y of [7.6, 8.4]) {
    const r = rad(y), a = Math.asin(x / r), c = V3(Math.sin(a) * (r + 0.01), y, Math.cos(a) * (r + 0.01));
    put(m.voraxD, new THREE.BoxGeometry(0.24, 0.2, 0.05).rotateY(a).translate(c.x, c.y, c.z));
    put(m.voraxD, bar(V3(x, y, c.z - 0.05), V3(x, y, 3.23), 0.09, 0.07));
  }
  put.flush(L, new THREE.Matrix4().compose(V3(pos.x, pos.y, pos.z), new THREE.Quaternion(), V3(s, s, s)));
  // collisions ajoutées (le cylindre du fût reste) : socle tronconique en trois gradins, colonne de danger, échelle,
  // plancher et garde-corps de la passerelle (hors de portée : 9,4 m au plus depuis le socle avec le Propulseur, la
  // passerelle est à 11 m). Les goussets (perchoirs à 4,6 m sous la passerelle) et le pavillon restent traversables
  const S3 = (x, y, z) => V3(pos.x + x * s, pos.y + y * s, pos.z + z * s);
  for (const [y0, y1, r] of [[0, 1, 4.9], [1, 2, 4.52], [2, 3.02, 4.18]]) L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y + y0 * s, pos.y + y1 * s, r * s, { surface: 'metal' }));
  solid(L, S3(4, 5, 0), V3(0.81, 5, 0.81).multiplyScalar(s));
  {
    const th = -2.2, qa = new THREE.Quaternion().setFromAxisAngle(_sy, th);
    solid(L, S3(Math.sin(th) * 3.6, 7.525, Math.cos(th) * 3.6), V3(0.32, 4.525, 0.3).multiplyScalar(s), qa, { blocksCamera: false });
  }
  for (let k = 0; k < 20; k++) {
    const a = ((k + 0.5) / 20) * Math.PI * 2, rm = (ri + ro) / 2, qa = new THREE.Quaternion().setFromAxisAngle(_sy, a), tl = (Math.PI * ro) / 20 + 0.02;
    solid(L, S3(Math.sin(a) * rm, yc - 0.08, Math.cos(a) * rm), V3(tl, 0.08, (ro - ri) / 2).multiplyScalar(s), qa);
    solid(L, S3(Math.sin(a) * (ro - 0.04), yc + 0.55, Math.cos(a) * (ro - 0.04)), V3(tl, 0.55, 0.04).multiplyScalar(s), qa, { blocksCamera: false });
  }
  // logo
  const sign = L.game.props.textBoard('VORAX', 4.5 * s, 1.4 * s, { bg: '#3a1470', fg: '#ffcc33', border: '#ffcc33', glow: 0.6 });
  sign.position.set(...P(0, 8, 3.25));
  L.root.add(sign);
  L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y, pos.y + 20 * s, 3.2 * s, { surface: 'metal' }));
  // tourbillon de débris aspirés
  const vortex = joint(L.root, P(0, 23, 0));
  const bits = [];
  for (let i = 0; i < 40; i++) {
    const b = part(vortex, i % 3 ? G.box(0.5, 0.3, 0.4) : G.nut(0.3, 0.12), i % 2 ? m.scrap : m.rust, { shadow: false });
    bits.push({ m: b, a: rand(0, 6), r: rand(2, 9), y: rand(0, 40), sp: rand(0.6, 1.4) });
  }
  const suction = part(vortex, new THREE.CylinderGeometry(2.4 * s, 6 * s, 40, 24, 1, true), new THREE.MeshBasicMaterial({ color: '#c890ff', transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), { p: [0, 20, 0], shadow: false });
  const state = { on: true, beam: suction, vortex };
  L.every((dt) => {
    if (!state.on) return;
    for (const b of bits) {
      b.y += dt * 8 * b.sp;
      if (b.y > 40) b.y = 0;
      b.a += dt * (2 + 6 / b.r);
      const r = b.r * (1 - b.y / 50);
      b.m.position.set(Math.cos(b.a) * r, b.y, Math.sin(b.a) * r);
      b.m.rotation.x += dt * 3;
      b.m.rotation.y += dt * 2;
    }
    suction.rotation.y += dt * 0.6;
  });
  return state;
}

// Pont de planches entre deux points (praticable) : planches clouées en travers, un peu disjointes et de longueurs
// inégales, sur deux longerons qui suivent le fléchissement ; poteaux équarris cerclés de fer, gros poteaux d'ancrage
// enfoncés dans le sol aux deux bouts ; mains courantes de corde rouge qui pendent entre les poteaux, ligatures
export function plankBridge(L, a, b, width = 2.4) {
  const m = mats(), put = bag();
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const yaw = Math.atan2(dir.x, dir.z);
  const pitch = -Math.asin(dir.y / len);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  const X = V3(1, 0, 0).applyQuaternion(q), Y = V3(0, 1, 0).applyQuaternion(q);
  const R = mkRng(Math.floor(a.x * 7 + a.z * 3) & 0xffff);
  const D = (t) => new THREE.Vector3().lerpVectors(a, b, t).add(V3(0, -Math.sin(t * Math.PI) * 0.25, 0));
  const F = (t, x, y) => D(t).addScaledVector(X, x).addScaledVector(Y, y);
  // planches (dessus du tablier à y = 0)
  const n = Math.ceil(len / 0.3), nails = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, w = width + (R() - 0.5) * 0.25, off = (R() - 0.5) * 0.12;
    const slope = Math.cos(t * Math.PI) * 0.25 * Math.PI / len;
    const qq = q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(slope, (R() - 0.5) * 0.04, (R() - 0.5) * 0.04)));
    const pp = D(t).addScaledVector(X, off).addScaledVector(Y, -0.04);
    const PM = new THREE.Matrix4().compose(pp, qq, V3(1, 1, 1)), ny = V3(0, 1, 0).applyQuaternion(qq);
    put(m.boards, plankBox(w, 0.07, 0.25 - R() * 0.03, 1, R() * 5), PM);
    // clous plantés dans la planche (dans son repère : elle est un peu de travers)
    for (const sx of [-1, 1]) for (const dz of [-0.06, 0.06]) nails.push([...V3(sx * (width / 2 - 0.2), 0.033, dz).applyMatrix4(PM).toArray(), ...ny.toArray()]);
  }
  studs(put, m.iron, nails, null, 0.016);
  // longerons
  for (const sx of [-1, 1]) for (let k = 0; k < 8; k++) put(m.timber, timber(F(k / 8, sx * (width / 2 - 0.2), -0.17), F((k + 1) / 8, sx * (width / 2 - 0.2), -0.17), 0.2, 0.14, k));
  // poteaux et mains courantes
  const np = Math.ceil(len / 3);
  for (const sx of [-1, 1]) {
    const tops = [];
    for (let i = 0; i <= np; i++) {
      const t = i / np, end = i === 0 || i === np;
      const base = F(t, sx * (width / 2 + 0.06), 0);
      const bot = end ? base.y - 1.6 : base.y - 0.35, topY = base.y + 1.0;
      put(m.timber, timber(V3(base.x, bot, base.z), V3(base.x, topY, base.z), end ? 0.18 : 0.13, end ? 0.18 : 0.13, i * 1.7 + sx));
      // cale boulonnée entre le longeron et le poteau (le poteau tenait seul à côté du tablier)
      put(m.timber, timber(F(t, sx * (width / 2 - 0.15), -0.17), F(t, sx * (width / 2 + 0.02), -0.17), 0.16, 0.12, i));
      L.game.world.add(new CylinderCollider(base.x, base.z, bot, topY, end ? 0.12 : 0.09, { surface: 'wood', blocksCamera: false }));
      for (const y of end ? [base.y - 0.1, topY - 0.15] : [topY - 0.15]) put(m.iron, new THREE.CylinderGeometry(end ? 0.13 : 0.1, end ? 0.13 : 0.1, 0.05, 8).rotateY(0.4).translate(base.x, y, base.z));
      tops.push(V3(base.x, topY - 0.1, base.z));
      put(m.rope, new THREE.TorusGeometry(end ? 0.12 : 0.09, 0.025, 4, 10).rotateX(Math.PI / 2).translate(base.x, topY - 0.1, base.z));
      put(m.rope, new THREE.TorusGeometry(end ? 0.12 : 0.09, 0.025, 4, 10).rotateX(Math.PI / 2).translate(base.x, base.y + 0.45, base.z));
    }
    // garde-corps : une boîte mince par travée, entre les deux cordes (le tablier reste libre sur toute sa largeur)
    for (let i = 0; i < np; i++) solidBar(L, tops[i].clone().add(V3(0, -0.33, 0)), tops[i + 1].clone().add(V3(0, -0.33, 0)), 0.55, 0.08, { surface: 'wood', blocksCamera: false });
    for (let i = 0; i < np; i++) for (const [y0, sag] of [[0, 0.22], [-0.55, 0.12]]) {
      const pts = [];
      for (let k = 0; k <= 6; k++) {
        const p = tops[i].clone().lerp(tops[i + 1], k / 6);
        p.y += y0 - Math.sin((k / 6) * Math.PI) * sag;
        pts.push(p);
      }
      put(m.cloth, tube(pts, 0.035, 18, 5));
    }
  }
  put.flush(L, null);
  const center = new THREE.Vector3().lerpVectors(a, b, 0.5);
  center.y -= 0.12;
  L.game.world.add(new BoxCollider(center, new THREE.Vector3(width / 2, 0.1, len / 2), q, { surface: 'wood' }));
}

// Quai de bois au bord du gouffre (visuel seul : la collision reste celle du niveau) : plancher de planches posées en
// long, en deux tronçons décalés, sur trois solives ; planches de rive ; pilotis équarris (rangée avant jusqu'au fond
// du gouffre, contreventée de croix de Saint-André et de moises boulonnées ; rangées arrière jusqu'au sol)
// c : centre du plateau, w × d : emprise (x × z), top : dessus du plancher, ground(x, z) : sol, deep : pied des pilotis
export function dock(L, c, w, d, top, ground, deep = -50) {
  const m = mats(), put = bag();
  const R = mkRng(Math.floor(c.x * 11 + c.z * 5) & 0xffff);
  // tout ce qui est visible devient solide (le plateau garde sa boîte de collision dans le niveau)
  const ow = { surface: 'wood', blocksCamera: false };
  const tb = (a, b, w, t, u) => { solidBar(L, a, b, w, t, ow); return timber(a, b, w, t, u); };
  const x0 = c.x - w / 2, x1 = c.x + w / 2, z0 = c.z - d / 2, z1 = c.z + d / 2;
  const n = Math.round(w / 0.3), pw = w / n;
  for (let i = 0; i < n; i++) {
    const x = x0 + (i + 0.5) * pw, sp = z0 + d * (0.3 + R() * 0.4), dy = (R() - 0.5) * 0.012;
    for (const [za, zb] of [[z0, sp], [sp, z1]]) put(m.boards, plankBox(pw - 0.02, 0.08, zb - za - 0.012, 1, R() * 5).translate(x, top - 0.04 + dy, (za + zb) / 2));
  }
  // planches de rive et bordures latérales
  for (const z of [z0 - 0.03, z1 + 0.03]) put(m.timber, plankBox(w + 0.12, 0.32, 0.06, 1, z).translate(c.x, top - 0.2, z));
  for (const x of [x0 - 0.03, x1 + 0.03]) {
    put(m.timber, plankBox(0.06, 0.32, d + 0.06, 1, x).translate(x, top - 0.2, c.z));
    put(m.timber, plankBox(0.16, 0.12, d, 1, x * 2).translate(x + (x < c.x ? 0.08 : -0.08), top + 0.06, c.z));
    solid(L, V3(x + (x < c.x ? 0.08 : -0.08), top + 0.06, c.z), V3(0.08, 0.06, d / 2), null, ow);
  }
  // solives
  for (const z of [z0 + 0.35, c.z, z1 - 0.35]) put(m.timber, plankBox(w - 0.1, 0.26, 0.18, 1, z).translate(c.x, top - 0.08 - 0.13, z));
  // pilotis
  const xs = [x0 + 0.3, c.x, x1 - 0.3], rows = [[z1 - 0.2, null], [c.z, 1], [z0 + 0.35, 1]];
  const bolts = [];
  for (const [z, onGround] of rows) for (const x of xs) {
    const yb = onGround ? Math.max(deep, ground(x, z) - 0.3) : deep;
    put(m.timber, plankBox(0.28, top - 0.34 - yb, 0.28, 1, x + z).translate(x, (top - 0.34 + yb) / 2, z));
    solid(L, V3(x, (top - 0.34 + yb) / 2, z), V3(0.15, (top - 0.34 - yb) / 2, 0.15), null, ow);
    put(m.iron, new THREE.BoxGeometry(0.31, 0.06, 0.31).translate(x, top - 0.45, z));
  }
  // contreventement de la rangée avant : croix et moises, tous les 6 m
  const zf = z1 - 0.2;
  for (let y = top - 0.6; y > deep + 3; y -= 6) {
    const y2 = Math.max(deep + 1, y - 6);
    for (let k = 0; k < 2; k++) {
      const xa = xs[k], xb = xs[k + 1];
      put(m.timber, tb(V3(xa, y, zf + 0.17), V3(xb, y2, zf + 0.17), 0.16, 0.06, y));
      put(m.timber, tb(V3(xb, y, zf + 0.23), V3(xa, y2, zf + 0.23), 0.16, 0.06, y + 1));
      bolts.push([(xa + xb) / 2, (y + y2) / 2, zf + 0.255]);
    }
    put(m.timber, plankBox(w - 0.4, 0.2, 0.07, 1, y).translate(c.x, y, zf - 0.17));
    put(m.timber, plankBox(w - 0.4, 0.2, 0.07, 1, y + 3).translate(c.x, y, zf + 0.29));
    for (const z of [zf - 0.18, zf + 0.3]) solid(L, V3(c.x, y, z), V3(w / 2 - 0.2, 0.1, 0.035), null, ow);
    for (const x of xs) bolts.push([x, y, zf + 0.32]);
  }
  // contrefiches avant-arrière sous le plateau
  for (const x of xs) {
    const yg = Math.max(deep, ground(x, c.z) - 0.3);
    put(m.timber, tb(V3(x + 0.17, top - 0.5, zf), V3(x + 0.17, Math.max(yg + 0.3, top - 4), c.z), 0.14, 0.06, x));
  }
  studs(put, m.iron, bolts, [0, 0, 1], 0.04);
  put.flush(L, null);
}

// Barrière électrique sur un rail (partie fixe ; les faisceaux animés restent dans le niveau) : traverse boulonnée sous
// le rail, deux bornes en acier peint à bandes de danger, isolateurs de céramique au départ des faisceaux, bobines de
// cuivre coiffées d'une boule rose, câble entre les bornes. pos : point du rail, yaw : direction du rail
export function railBarrier(L, pos, yaw) {
  const m = mats(), put = bag();
  const pink = glow('#ff3a6a', 2.6);
  put(m.steelP, new THREE.BoxGeometry(1.75, 0.14, 0.18).translate(0, -0.2, 0));
  put(m.iron, new THREE.BoxGeometry(0.24, 0.05, 0.16).translate(0, -0.11, 0));
  put(m.iron, new THREE.TorusGeometry(0.12, 0.02, 4, 12, Math.PI).rotateZ(Math.PI).translate(0, -0.08, 0.05));
  for (const sx of [-1, 1]) {
    const x = sx * 0.7;
    put(m.steelP, rboxAt(0.2, 2.0, 0.2, 0.03, x, 0.9, 0));
    put(m.iron, new THREE.BoxGeometry(0.3, 0.05, 0.3).translate(x, -0.11, 0));
    studs(put, m.iron, [[x + 0.11, -0.085, 0.11], [x - 0.11, -0.085, 0.11], [x + 0.11, -0.085, -0.11], [x - 0.11, -0.085, -0.11]], [0, 1, 0], 0.022);
    for (const y of [0.15, 1.6]) put(m.hazard, new THREE.BoxGeometry(0.215, 0.32, 0.215).translate(x, y, 0));
    // isolateurs (piles de trois cloches) tournés vers l'autre borne
    for (const y of [0.5, 1.1]) {
      put(m.iron, cylAx(0.02, 0.02, 0.2, 6, V3(x - sx * 0.18, y, 0), _tx));
      for (let k = 0; k < 3; k++) put(m.ceramic, cylAx(0.045, 0.075, 0.035, 10, V3(x - sx * (0.13 + k * 0.045), y, 0), _tx));
    }
    // bobine au sommet
    put(m.ceramic, new THREE.CylinderGeometry(0.05, 0.06, 0.42, 10).translate(x, 2.1, 0));
    for (let k = 0; k < 6; k++) put(m.copper, new THREE.TorusGeometry(0.085, 0.022, 5, 14).rotateX(Math.PI / 2).translate(x, 1.98 + k * 0.045, 0));
    put(m.iron, new THREE.TorusGeometry(0.064, 0.02, 4, 14).rotateX(Math.PI / 2).translate(x, 2.3, 0));
    put(pink, new THREE.SphereGeometry(0.075, 10, 8).translate(x, 2.38, 0));
    put(m.steelP, new THREE.BoxGeometry(0.24, 0.06, 0.24).translate(x, 1.9, 0));
  }
  put(m.cable, tube([V3(-0.6, 0.0, 0.1), V3(-0.3, -0.06, 0.12), V3(0.3, -0.06, 0.12), V3(0.6, 0.0, 0.1)], 0.02, 12, 4));
  const qy = new THREE.Quaternion().setFromAxisAngle(_sy, yaw);
  put.flush(L, new THREE.Matrix4().compose(pos, qy, V3(1, 1, 1)));
  // collisions : les deux bornes (bobine comprise) et la traverse sous le rail ; le passage du rail, entre les bornes,
  // reste libre (le faisceau seul blesse, comme avant)
  const ob = { blocksCamera: false };
  for (const sx of [-1, 1]) solid(L, V3(sx * 0.7, 1.15, 0).applyQuaternion(qy).add(pos), V3(0.12, 1.25, 0.12), qy, ob);
  solid(L, V3(0, -0.2, 0).applyQuaternion(qy).add(pos), V3(0.875, 0.07, 0.09), qy, ob);
}

// Mât de guirlande : poteau équarri sur une pierre, frettes de fer, potence (traverse et contrefiches) portant des
// isolateurs, isolateur d'amarrage où s'accroche la guirlande (en p), chapeau. toward : l'autre bout de la guirlande
export function garlandPost(L, p, toward, ground) {
  const m = mats(), put = bag();
  const y0 = ground - 0.2, y1 = p.y + 0.5;
  const d = V3(toward.x - p.x, 0, toward.z - p.z).normalize(), sd = V3(d.z, 0, -d.x);
  const P = (s, y, f = 0) => V3(p.x + sd.x * s + d.x * f, y, p.z + sd.z * s + d.z * f);
  const post = plankBox(y1 - y0, 0.17, 0.17, 1, p.x * 0.3).rotateZ(Math.PI / 2).rotateY(Math.atan2(d.x, d.z)).translate(p.x, (y0 + y1) / 2, p.z);
  put(m.timber, post);
  put(m.concrete, new THREE.CylinderGeometry(0.24, 0.32, 0.2, 7).translate(p.x, ground + 0.03, p.z));
  // collisions : poteau équarri et pierre, jusqu'à p.y + 0,15 ; la tête
  // (potence, isolateurs, chapeau) reste traversable : solide, elle hausserait le perchoir existant
  L.game.world.add(new CylinderCollider(p.x, p.z, y0, p.y + 0.15, 0.12, { surface: 'wood', blocksCamera: false }));
  L.game.world.add(new CylinderCollider(p.x, p.z, ground - 0.07, ground + 0.13, 0.3, { surface: 'rock' }));
  for (const y of [ground + 0.45, (ground + p.y) / 2, y1 - 0.12]) put(m.iron, new THREE.BoxGeometry(0.195, 0.06, 0.195).rotateY(Math.atan2(d.x, d.z)).translate(p.x, y, p.z));
  put(m.iron, new THREE.ConeGeometry(0.15, 0.12, 4).rotateY(Math.atan2(d.x, d.z) + Math.PI / 4).translate(p.x, y1 + 0.06, p.z));
  // potence : traverse perpendiculaire à la guirlande, contrefiches, isolateurs debout
  const ya = p.y + 0.3;
  put(m.timber, timber(P(-0.5, ya, 0.12), P(0.5, ya, 0.12), 0.1, 0.09, 1));
  for (const s of [-1, 1]) {
    put(m.timber, timber(P(s * 0.06, ya - 0.45, 0.1), P(s * 0.36, ya - 0.04, 0.1), 0.06, 0.05, 2));
    const c = P(s * 0.42, ya + 0.1, 0.12);
    put(m.iron, new THREE.CylinderGeometry(0.012, 0.012, 0.12, 5).translate(c.x, c.y - 0.03, c.z));
    put(m.ceramic, new THREE.CylinderGeometry(0.035, 0.05, 0.09, 10).translate(c.x, c.y + 0.02, c.z));
    put(m.ceramic, new THREE.SphereGeometry(0.035, 8, 6).translate(c.x, c.y + 0.07, c.z));
  }
  // isolateur d'amarrage tourné vers la guirlande, sur sa console
  const ci = P(0, p.y, 0.16);
  put(m.iron, cylAx(0.015, 0.015, 0.16, 6, P(0, p.y, 0.1), d));
  for (let k = 0; k < 2; k++) put(m.ceramic, cylAx(0.04, 0.06, 0.04, 10, ci.clone().addScaledVector(d, k * 0.04), d));
  put.flush(L, null);
}

// Linteau de la barricade : poutre-caisson rivetée à bandes de danger (semelles, flancs, raidisseurs, platines), et
// conteneur couché par-dessus. c : centre du volume (w × h × d, d le long de la barricade)
export function lintel(L, c, w, h, d, color = '#4a9a50') {
  const m = mats(), put = bag();
  const gh = h - 2.6, yb = c.y - h / 2;
  for (const y of [yb + 0.04, yb + gh - 0.04]) put(m.steelP, new THREE.BoxGeometry(w + 0.1, 0.08, d + 0.1).translate(c.x, y, c.z));
  for (const s of [-1, 1]) {
    const g = new THREE.BoxGeometry(0.04, gh - 0.16, d).translate(c.x + s * (w / 2 - 0.02), yb + gh / 2, c.z);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getZ(i) + p.getY(i) * 0.0) * 0.45, p.getY(i) * 0.45);
    put(m.hazard, g);
    const riv = [];
    for (let z = c.z - d / 2 + 0.15; z < c.z + d / 2; z += 0.3) for (const y of [yb + 0.12, yb + gh - 0.12]) riv.push([c.x + s * (w / 2 + 0.002), y, z]);
    studs(put, m.iron, riv, [s, 0, 0], 0.03);
    for (const z of [-0.36, -0.12, 0.12, 0.36]) put(m.steelP, new THREE.BoxGeometry(0.06, gh - 0.16, 0.12).translate(c.x + s * (w / 2 + 0.01), yb + gh / 2, c.z + z * d));
  }
  for (const s of [-1, 1]) {
    put(m.steelP, new THREE.BoxGeometry(w + 0.12, gh + 0.06, 0.05).translate(c.x, yb + gh / 2, c.z + s * (d / 2 + 0.025)));
    const riv = [];
    for (const x of [-0.4, 0, 0.4]) for (const y of [0.25, 0.75]) riv.push([c.x + x * w, yb + gh * y, c.z + s * (d / 2 + 0.048)]);
    studs(put, m.iron, riv, [0, 0, s], 0.035);
  }
  put.flush(L, null);
  container(L, V3(c.x, yb + gh, c.z), Math.PI / 2, color, { w: d, h: 2.6, d: w, collide: false });
}

// ------------------------------------------------------------------ oasis
// Palme : ruban plié en V, folioles en dents de scie, qui monte puis retombe (le long de +z)
const frondGeo = {};
function frondGeometry(len) {
  if (frondGeo[len]) return frondGeo[len];
  const pos = [], idx = [], n = 16;
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const y = len * (0.3 * s - 0.6 * s * s), z = len * s * (1 - 0.12 * s);
    const w = len * 0.2 * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.06)), 0.6) * (i % 2 ? 0.5 : 1);
    pos.push(-w, y - w * 0.4, z, 0, y, z, w, y - w * 0.4, z);
    if (i < n) {
      const a = i * 3;
      idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  frondGeo[len] = g;
  return g;
}

// Palmier : stipe courbe annelé (lean : [dx, dz] du sommet), couronne de palmes, fruits turquoise lumineux
export function palm(L, pos, h = 5, lean = [0.8, 0], seed = 1) {
  const m = mats();
  const R = mkRng(seed);
  if (!M.fruit) M.fruit = mat('#5ff0e0', { rough: 0.3, emissive: '#1a9a96', emissiveIntensity: 0.7 });
  const P = (t) => new THREE.Vector3(pos.x + lean[0] * t * t, pos.y + h * t, pos.z + lean[1] * t * t);
  const up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  const seg = 9;
  // pied enfoncé de 0,4 m dans la berge en pente (le premier anneau ne flotte plus côté aval)
  L.add(G.cyl(0.276, 0.29, 0.45, 10), m.trunkDark, mtx([pos.x, pos.y - 0.2, pos.z]));
  for (let i = 0; i < seg; i++) {
    const a = P(i / seg), b = P((i + 1) / seg);
    const d = b.clone().sub(a);
    const len = d.length();
    const q = new THREE.Quaternion().setFromUnitVectors(up, d.normalize());
    const r0 = 0.26 - 0.11 * (i / seg), r1 = 0.26 - 0.11 * ((i + 1) / seg);
    L.add(G.cyl(+r1.toFixed(3), +(r0 * 1.06).toFixed(3), +(len * 1.02).toFixed(3), 10), i % 2 ? m.trunk : m.trunkDark, new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, one));
    L.add(G.cyl(+(r0 * 1.14).toFixed(3), +(r0 * 1.14).toFixed(3), 0.09, 10), m.trunkDark, new THREE.Matrix4().compose(a, q, one));
  }
  const top = P(1);
  L.add(G.sphere(0.3, 10, 8), m.trunkDark, mtx([top.x, top.y, top.z]));
  const n = 8 + Math.floor(R() * 3);
  for (let k = 0; k < n; k++) {
    const yaw = (k / n) * Math.PI * 2 + R() * 0.4;
    const pitch = -0.15 - R() * 0.45;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, (R() - 0.5) * 0.4, 'YXZ'));
    L.add(frondGeometry(2.6), k % 2 ? m.frond : m.frondL, new THREE.Matrix4().compose(top, q, new THREE.Vector3(1, 1, 0.8 + R() * 0.4)));
  }
  for (let k = 0; k < 3; k++) {
    const a = R() * 6.28;
    L.add(G.sphere(0.13, 10, 8), M.fruit, mtx([top.x + Math.cos(a) * 0.25, top.y - 0.25, top.z + Math.sin(a) * 0.25]));
  }
  L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y - 0.5, pos.y + 2.2, 0.3, { surface: 'wood' }));
  return top;
}

// Roseaux : touffes hautes (herbe qui ondule et s'écarte au passage de Kobi), quelques massettes brunes
export function reeds(L, points, o = {}) {
  const m = mats();
  const field = grassField(L, points, { base: o.base || '#355e26', tip: o.tip || '#c2d878', height: o.height || [0.9, 1.7], seed: o.seed || 21, sway: 0.45, blades: 8 });
  // brins affinés et touffes serrées
  const mx = new THREE.Matrix4(), thin = new THREE.Matrix4().makeScale(0.45, 1, 0.45);
  for (let i = 0; i < field.count; i++) { field.getMatrixAt(i, mx); field.setMatrixAt(i, mx.multiply(thin)); }
  const R = mkRng(o.seed || 21);
  const q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
  for (const p of points) {
    if (R() > (o.heads ?? 0.35)) continue;
    const h = 1.1 + R() * 0.8;
    const x = p.x + (R() - 0.5) * 0.25, z = p.z + (R() - 0.5) * 0.25;
    q.setFromEuler(e.set((R() - 0.5) * 0.16, 0, (R() - 0.5) * 0.16));
    const at = (y) => new THREE.Vector3(0, y, 0).applyQuaternion(q).add(new THREE.Vector3(x, p.y, z));
    // tige plantée 15 cm sous le sol (le point est tiré à côté de la touffe : sur la berge en pente, elle flottait)
    L.add(G.cyl(0.012, 0.018, h + 0.15, 4), m.reedStem, new THREE.Matrix4().compose(at((h - 0.15) / 2), q, one));
    L.add(G.capsule(0.04, 0.2, 3, 6), m.reedHead, new THREE.Matrix4().compose(at(h - 0.18), q, one));
  }
}

// Nénuphars posés sur l'eau : [x, z, rayon, fleur]
export function lilyPads(L, list, y) {
  const m = mats();
  const R = mkRng(5);
  for (const [x, z, r, flower] of list) {
    L.add(G.cyl(r, r, 0.02, 16), m.lily, mtx([x, y + 0.012, z], [(R() - 0.5) * 0.05, R() * 6, (R() - 0.5) * 0.05]));
    if (!flower) continue;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      L.add(G.ellipsoid(0.1, 0.035, 0.05, 8, 6), m.lilyFlower, mtx([x + Math.cos(a) * 0.07, y + 0.07, z + Math.sin(a) * 0.07], [0, -a, 0.6]));
    }
    L.add(G.sphere(0.04, 8, 6), m.lampGlow, mtx([x, y + 0.1, z]));
  }
}

// Guirlande d'ampoules entre deux points (fil qui ploie de « sag ») ; renvoie la position des ampoules.
// o : { sag, spacing ou n (intervalles), phase (0,5 : ampoules au milieu des intervalles), colors, light (false : pas de
// lumière), color, intensity, range, priority }
export function stringLights(L, a, b, o = {}) {
  const m = mats();
  const sag = o.sag ?? 0.8;
  const at = (t) => { const p = a.clone().lerp(b, t); p.y -= Math.sin(t * Math.PI) * sag; return p; };
  const up = new THREE.Vector3(0, 1, 0);
  const NS = 16;
  for (let i = 0; i < NS; i++) {
    const p = at(i / NS), q = at((i + 1) / NS);
    const d = q.clone().sub(p);
    L.add(G.cyl(0.012, 0.012, 1, 4), m.wire, new THREE.Matrix4().compose(p.clone().add(q).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(up, d.clone().normalize()), new THREE.Vector3(1, d.length(), 1)));
  }
  const n = o.n ?? Math.max(2, Math.round(a.distanceTo(b) / (o.spacing ?? 0.8)));
  const bulbs = [];
  const ph = o.phase ?? 0;
  for (let i = ph ? 0 : 1; i < n; i++) {
    const p = at((i + ph) / n);
    p.y -= 0.07;
    L.add(G.sphere(0.065, 8, 6), o.colors ? glow(o.colors[i % o.colors.length], 3) : m.bulb, mtx([p.x, p.y, p.z]));
    bulbs.push(p);
  }
  if (o.light !== false) {
    lights.add({ line: [at(0.2), at(0.8)], offset: new THREE.Vector3(0, -sag * 0.25, 0), color: o.color || '#ffc46a', intensity: o.intensity ?? 12, range: o.range ?? 7, priority: o.priority ?? 0.9 });
  }
  return bulbs;
}

// ------------------------------------------------------------------ lumières du soir
const additive = (color, k, opacity = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });

// Bidon-brasero : fût de 200 L ouvert, rouillé et noirci de suie, percé de trous où rougeoient les braises, grille
// posée dessus, bûches à côté ; flammes qui dansent, braises qui s'envolent, lumière orangée vacillante
export function fireBarrel(L, pos) {
  const m = mats(), put = bag();
  if (!M.flame) { M.flame = additive('#ff7a22', 2.2, 0.8); M.flameCore = additive('#ffd27a', 3, 0.9); }
  const yaw = rand(0, 6);
  const body = drum(24, true).clone().applyMatrix4(at([0, 0.55 * 0.94, 0], [0, yaw, 0], [1, 0.94, 1]));
  // suie : haut du fût et paroi intérieure noircis (couleurs de sommet, reprises par la fusion du niveau)
  const bp = body.attributes.position, bn = body.attributes.normal, col = new Float32Array(bp.count * 3);
  for (let i = 0; i < bp.count; i++) {
    const inner = bp.getX(i) * bn.getX(i) + bp.getZ(i) * bn.getZ(i) < 0 ? 1 : 0;
    const k = 1 - Math.max(inner * 0.8, THREE.MathUtils.smoothstep(bp.getY(i), 0.62, 1.0) * 0.7);
    col[i * 3] = k; col[i * 3 + 1] = k * 0.95; col[i * 3 + 2] = k * 0.92;
  }
  body.setAttribute('color', new THREE.BufferAttribute(col, 3));
  put(m.rustP, body);
  // trous percés au pointeau (deux rangs), braises qui luisent au travers, bord brûlé
  const coal = glow('#ff7a2a', 3);
  for (const [y, n, o] of [[0.3, 8, 0], [0.56, 8, 0.5]]) for (let k = 0; k < n; k++) {
    const a = ((k + o) / n) * Math.PI * 2 + yaw;
    put(coal, new THREE.CircleGeometry(0.042, 8).rotateY(a).translate(Math.sin(a) * 0.412, y, Math.cos(a) * 0.412));
    put(m.iron, new THREE.TorusGeometry(0.05, 0.012, 4, 10).rotateY(a).translate(Math.sin(a) * 0.405, y, Math.cos(a) * 0.405));
  }
  // lit de braises, charbons, grille
  put(glow('#ff5a14', 2.4), new THREE.CylinderGeometry(0.36, 0.36, 0.02, 16).translate(0, 0.94, 0));
  const R = mkRng(Math.floor(pos.x * 13 + pos.z * 7) & 0xffff);
  for (let k = 0; k < 14; k++) {
    const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 0.3;
    put(k % 2 ? coal : m.iron, new THREE.DodecahedronGeometry(0.05 + R() * 0.04).rotateX(R() * 3).translate(Math.cos(a) * r, 0.95 + R() * 0.04, Math.sin(a) * r));
  }
  for (const z of [-0.24, -0.08, 0.08, 0.24]) put(m.iron, beam(V3(-0.42, 1.02, z), V3(0.42, 1.02, z), 0.014, 0.014, 5).rotateY(yaw + 0.4));
  // bûches de réserve
  for (const [x, z, ry, y] of [[0.62, 0.15, 0.3, 0.08], [0.58, -0.12, -0.2, 0.08], [0.6, 0.02, 1.4, 0.22]]) {
    put(m.wood, new THREE.CylinderGeometry(0.075, 0.085, 0.75, 8).rotateZ(Math.PI / 2).rotateY(ry).translate(x, y, z).rotateY(yaw));
  }
  put.flush(L, new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z));
  // collision des bûches (le fût garde son cylindre)
  solid(L, V3(0.7, 0.15, 0.01).applyAxisAngle(_sy, yaw).add(pos), V3(0.28, 0.15, 0.41), new THREE.Quaternion().setFromAxisAngle(_sy, yaw), { surface: 'wood', blocksCamera: false });
  const fl = joint(L.root, [pos.x, pos.y + 0.98, pos.z]);
  const tongues = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 5) * Math.PI * 2, r = i ? 0.17 : 0, h = i ? 0.5 : 0.85;
    const t = part(fl, G.cone(i ? 0.12 : 0.2, h, 7), i ? M.flame : M.flameCore, { p: [Math.cos(a) * r, h / 2, Math.sin(a) * r], shadow: false });
    tongues.push({ t, h, ph: rand(0, 6), sp: rand(7, 11) });
  }
  lights.add({ pos: new THREE.Vector3(pos.x, pos.y + 1.7, pos.z), color: '#ff7a2a', intensity: 38, range: 10, decay: 1.5, flicker: 0.3, priority: 1.6 });
  L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y, pos.y + 1.0, 0.44, { surface: 'metal' }));
  const fx = L.game.fx, ember = new THREE.Color('#ffb040'), p = new THREE.Vector3(), v = new THREE.Vector3();
  let sT = 0;
  L.every((dt, time) => {
    for (const o of tongues) {
      const k = 0.75 + 0.3 * Math.sin(time * o.sp + o.ph) + 0.12 * Math.sin(time * 23 + o.ph * 2);
      o.t.scale.set(1 - (k - 0.8) * 0.4, k, 1 - (k - 0.8) * 0.4);
      o.t.position.y = (o.h * k) / 2;
    }
    fl.rotation.y += dt * 0.7;
    const cam = L.game.camera.cam.position;
    if (cam.distanceToSquared(fl.position) > 50 * 50) return;
    if (Math.random() < dt * 5) fx.spark(p.set(pos.x + rand(-0.2, 0.2), pos.y + 1.2, pos.z + rand(-0.2, 0.2)), v.set(rand(-0.4, 0.4), rand(1.5, 2.6), rand(-0.4, 0.4)), { life: rand(0.8, 1.5), size: 0.09, size1: 0.02, color: ember, drag: 0.6, gravity: -0.3 });
    sT -= dt;
    if (sT <= 0) { sT = 0.7; fx.smoke(p.set(pos.x, pos.y + 1.6, pos.z), 1, '#4a4048', 0.7, 1.4); }
  });
}

// Projecteur de chantier sur mât, braqué vers target : lentille éblouissante, faisceau dans la poussière, flaque de
// lumière froide au sol
// Mât en treillis : trois membrures, ceintures et diagonales en zigzag, sur un massif de béton ; haubans tendus vers des
// ancrages au sol ; traverse en tube carré portant deux projecteurs à étrier (boîtier à ailettes de refroidissement,
// visière, grille devant la lentille) ; câbles qui descendent le long du mât jusqu'à un coffret, puis courent au sol
export function floodlight(L, pos, target, o = {}) {
  const m = mats(), put = bag();
  const h = o.h ?? 7;
  const head = new THREE.Vector3(pos.x, pos.y + h, pos.z);
  const dir = target.clone().sub(head).normalize();
  const side = new THREE.Vector3(dir.z, 0, -dir.x).normalize();
  // treillis (coordonnées locales, pied en 0)
  const rr = 0.26, ch = [0, 1, 2].map((k) => k * 2.094 + Math.atan2(side.x, side.z));
  const C = (k, y) => V3(Math.sin(ch[k]) * rr, y, Math.cos(ch[k]) * rr);
  const top = h - 0.5, nb = Math.round((top - 0.4) / 0.62), bh = (top - 0.4) / nb;
  for (let k = 0; k < 3; k++) put(m.steelP, beam(C(k, 0.35), C(k, top), 0.045, 0.04, 6));
  for (let i = 0; i <= nb; i++) {
    const y = 0.4 + i * bh;
    for (let k = 0; k < 3; k++) {
      put(m.iron, beam(C(k, y), C((k + 1) % 3, y), 0.02, 0.02, 4));
      if (i < nb) put(m.iron, beam(C(k, y), C((k + 1) % 3, y + bh), 0.016, 0.016, 4));
    }
  }
  // massif, platine boulonnée, bande de danger
  put(m.concrete, rboxAt(0.95, 0.45, 0.95, 0.06, 0, 0.1, 0));
  put(m.steelP, new THREE.CylinderGeometry(0.42, 0.42, 0.05, 3).rotateY(ch[0]).translate(0, 0.355, 0));
  studs(put, m.iron, [0, 1, 2].map((k) => [...C(k, 0.38).multiplyScalar(1.35).setY(0.385).toArray()]), [0, 1, 0], 0.04);
  put(m.hazard, new THREE.BoxGeometry(0.97, 0.12, 0.97).translate(0, 0.27, 0));
  // tête : plateau, traverse en tube carré, bouchons
  put(m.steelP, new THREE.CylinderGeometry(0.4, 0.4, 0.06, 3).rotateY(ch[0]).translate(0, top + 0.03, 0));
  const yb = h - 0.35;
  for (let k = 0; k < 3; k++) put(m.iron, beam(C(k, top), V3(0, yb - 0.04, 0), 0.03, 0.03, 4));
  const xa = side.clone().multiplyScalar(0.85), xb = side.clone().multiplyScalar(-0.85);
  put(m.steelP, bar(xa.clone().setY(yb), xb.clone().setY(yb), 0.12, 0.12));
  for (const e of [xa, xb]) put(m.iron, bar(e.clone().setY(yb), e.clone().setY(yb).addScaledVector(side, Math.sign(e.dot(side)) * 0.03), 0.14, 0.14));
  // projecteurs (repère propre : x = côté, y = haut, z = vers la cible)
  const up = V3(0, 1, 0).addScaledVector(dir, -dir.y).normalize(), sx = new THREE.Vector3().crossVectors(up, dir).normalize();
  const lensM = glow(o.color || '#e8f4ff', 4);
  for (const s of [-0.45, 0.45]) {
    const c = V3(0, h, 0).addScaledVector(side, s);
    const LM = new THREE.Matrix4().makeBasis(sx, up, dir).setPosition(c);
    put(m.steelP, rboxAt(0.64, 0.6, 0.36, 0.05, 0, 0, -0.02), LM);
    for (let k = 0; k < 6; k++) put(m.iron, new THREE.BoxGeometry(0.025, 0.52, 0.14).translate(-0.25 + k * 0.1, 0, -0.25), LM);
    // visière et volets latéraux
    put(m.steelP, new THREE.BoxGeometry(0.68, 0.025, 0.3).rotateX(-0.18).translate(0, 0.32, 0.27), LM);
    for (const t of [-1, 1]) put(m.steelP, new THREE.BoxGeometry(0.025, 0.5, 0.18).rotateY(t * 0.3).translate(t * 0.34, 0.02, 0.22), LM);
    // cadre de lentille, lentille, grille
    put(m.iron, new THREE.TorusGeometry(0.27, 0.035, 5, 18).translate(0, 0, 0.17), LM);
    put(lensM, new THREE.CylinderGeometry(0.27, 0.27, 0.06, 14).rotateX(Math.PI / 2).translate(0, 0, 0.16), LM);
    for (const g of [-0.13, 0, 0.13]) put(m.iron, new THREE.BoxGeometry(0.012, 0.52, 0.012).translate(g, 0, 0.21), LM);
    // étrier : pattes boulonnées sur les flancs, pied sur la traverse
    const pa = c.clone().addScaledVector(sx, 0.36), pb = c.clone().addScaledVector(sx, -0.36);
    for (const p of [pa, pb]) {
      put(m.iron, bar(p, V3(p.x, yb + 0.06, p.z), 0.05, 0.03));
      put(m.iron, cylAx(0.05, 0.05, 0.1, 8, p, sx));
    }
    put(m.iron, bar(V3(pa.x, yb + 0.07, pa.z), V3(pb.x, yb + 0.07, pb.z), 0.04, 0.06));
    // câble d'alimentation : du dos du boîtier vers le mât
    const back = c.clone().addScaledVector(dir, -0.25);
    put(m.cable, tube([back, back.clone().addScaledVector(dir, -0.15).add(V3(0, -0.3, 0)), C(s > 0 ? 0 : 1, h - 1.0).multiplyScalar(1.1), C(s > 0 ? 0 : 1, h - 1.6).multiplyScalar(1.12)], 0.022, 16, 4));
  }
  // câbles le long d'une membrure, coffret, sortie au sol
  for (const k of [0, 1]) put(m.cable, beam(C(k, h - 1.6).multiplyScalar(1.12), C(k, 1.3).multiplyScalar(1.12), 0.022, 0.022, 4));
  const bx = C(0, 1.1).multiplyScalar(1.3);
  put(m.steelP, rboxAt(0.3, 0.42, 0.18, 0.03, bx.x, bx.y, bx.z).rotateY(0));
  put(m.hazard, new THREE.BoxGeometry(0.31, 0.06, 0.19).translate(bx.x, bx.y + 0.12, bx.z));
  const wo = new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z);
  put.flush(L, wo);
  // haubans et câble au sol (coordonnées du monde)
  const wp = bag();
  for (let k = 0; k < 3; k++) {
    const a = ch[k] + 0.4, d = 3.2;
    const ax = pos.x + Math.sin(a) * d, az = pos.z + Math.cos(a) * d, ay = gy(L, ax, az);
    const att = C(k, h * 0.62).add(pos);
    wp(m.iron, beam(att, V3(ax, ay + 0.12, az), 0.012, 0.012, 4));
    wp(m.iron, cylAx(0.04, 0.04, 0.3, 6, V3(ax, ay + 0.05, az), _sy));
    wp(m.iron, ringAx(0.05, 0.012, V3(ax, ay + 0.2, az), V3(Math.cos(a), 0, -Math.sin(a)), 4, 10));
  }
  const g0 = bx.clone().add(pos), run = [g0.clone().add(V3(0, -0.22, 0))];
  const away = V3(Math.sin(ch[0]), 0, Math.cos(ch[0]));
  for (let t = 0.6; t < 4; t += 0.8) {
    const p = V3(pos.x + away.x * (0.9 + t) + Math.sin(t * 2) * 0.2, 0, pos.z + away.z * (0.9 + t) + Math.cos(t * 2.3) * 0.2);
    p.y = gy(L, p.x, p.z) + 0.03;
    run.push(p);
  }
  wp(m.cable, tube(run, 0.025, 24, 4));
  wp.flush(L, null);
  // collisions : massif de béton, fût en treillis (jusqu'au sommet : pas de rebord plus bas), coffret. Les haubans
  // restent traversables (solides, ce seraient des rampes jusqu'au mât), la tête aussi (hors de portée, même au
  // Propulseur)
  solid(L, V3(pos.x, pos.y + 0.1, pos.z), V3(0.48, 0.23, 0.48), null, { surface: 'rock' });
  L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y + 0.32, pos.y + h, 0.31, { surface: 'metal', blocksCamera: false }));
  solid(L, bx.clone().add(pos), V3(0.17, 0.22, 0.17), null, { blocksCamera: false });
  // faisceau : cône ouvert, additif, qui s'estompe vers le sol
  if (!M.beamMat) {
    M.beamMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(o.color || '#e8f4ff').multiplyScalar(0.5) } },
      vertexShader: 'varying float vY; varying vec3 vN, vV; void main() { vY = uv.y; vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: 'uniform vec3 uColor; varying float vY; varying vec3 vN, vV; void main() { float e = pow(abs(dot(normalize(vN), normalize(vV))), 1.5); gl_FragColor = vec4(uColor * e * vY * vY, 1.0); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
  }
  const len = head.distanceTo(target);
  const ray = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 3.2, len, 20, 1, true), M.beamMat);
  ray.position.copy(head).addScaledVector(dir, len / 2);
  // le cône pointe vers -y (base large en bas) : on l'aligne sur -dir
  ray.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
  ray.renderOrder = 5;
  ray.userData.noAO = true;
  L.root.add(ray);
  lights.add({ pos: target.clone().addScaledVector(dir, -2.5), color: o.color || '#e8f4ff', intensity: o.intensity ?? 38, range: o.range ?? 12, decay: 1.2, priority: 1.4 });
  L.game.world.add(new CylinderCollider(pos.x, pos.z, pos.y, pos.y + h, 0.2, { surface: 'metal' }));
}

// Gyrophare orange : dôme qui tourne, deux pales de lumière, éclairage qui pulse
export function beacon(L, pos, o = {}) {
  const m = mats();
  const color = o.color || '#ff9a1a';
  L.add(G.cyl(0.18, 0.2, 0.12, 12), m.metalDark, mtx([pos.x, pos.y + 0.06, pos.z]));
  L.add(G.sphere(0.16, 12, 8), glow(color, 2.2), mtx([pos.x, pos.y + 0.2, pos.z]));
  const rot = joint(L.root, [pos.x, pos.y + 0.22, pos.z]);
  const blade = additive(color, 1.6, 0.6);
  blade.side = THREE.DoubleSide;
  for (const s of [-1, 1]) part(rot, new THREE.PlaneGeometry(1.4, 0.22).translate(0.7, 0, 0), blade, { r: [0, s > 0 ? 0 : Math.PI, 0], shadow: false });
  const e = lights.add({ pos: new THREE.Vector3(pos.x, pos.y + 0.6, pos.z), color, intensity: 0, range: o.range ?? 8, priority: 1.1 });
  const I = o.intensity ?? 26, ph = rand(0, 6), sp = o.speed ?? 5;
  L.every((dt, time) => {
    rot.rotation.y = time * sp + ph;
    e.intensity = I * (0.25 + 0.75 * Math.pow(Math.abs(Math.sin(time * sp + ph)), 3));
  });
}
