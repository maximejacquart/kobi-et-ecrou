// Éléments interactifs du niveau : caisses, tremplins, rails, points de grappin, plateformes mobiles,
// bornes de sauvegarde, terminaux du Bazar, boulons d'or, champs de force, lave, panneaux.
import * as THREE from 'three';
import { lights } from '../engine/lightpool.js';
import { G, part, joint, mergeGeometries } from '../models/geo.js';
import { compact } from '../models/geo.js';
import { mat, glow } from '../engine/materials.js';
import { BoxCollider, CylinderCollider } from '../engine/physics.js';
import { hazardTexture, plankTexture, paintedMetalTexture, treadPlateTexture } from '../engine/textures.js';
import { plankBox, plankPanel, rivets, grime, boxAt, rboxAt, mergeParts } from '../models/environment/props.js';
import { createWater } from '../engine/water/water.js';
import { boxUV } from '../levels/level.js';
import { rand, clamp, damp, pick } from '../engine/util.js';
import { FONT_TITLE } from '../ui/font.js';
import { fxLayer } from '../engine/particles/shared.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// Pose au sol : de combien le terrain descend sous la base d'un objet (pente, bosse, bord de dalle). pts : points
// [x, z] du pourtour de la base dans le repère de l'objet (matrice m, base à y = 0). Renvoie l'écart le plus grand
// (0 si la base touche partout) : on prolonge alors le socle ou les pieds d'autant, ancrage compris (semelle).
const _gp = new THREE.Vector3();
const groundOnly = (c) => !c.dynamic && !(c.user && c.user.def);
function groundGap(world, m, pts, top = 0.4, max = 1.5) {
  let d = 0;
  for (const [x, z] of pts) {
    _gp.set(x, 0, z).applyMatrix4(m);
    const hit = world.groundBelow(_gp.x, _gp.y + top, _gp.z, top + max, groundOnly);
    if (hit) d = Math.max(d, hit.t - top);
  }
  return d;
}
// Points du pourtour d'un rectangle (w × d, centré en x, z) : coins et milieux des côtés
const rectPts = (w, d, x = 0, z = 0) => {
  const out = [];
  for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) if (a || b) out.push([x + a * w / 2, z + b * d / 2]);
  return out;
};
// Points d'un cercle de rayon r (n points)
const ringPts = (r, n = 12) => Array.from({ length: n }, (_, i) => [Math.cos(i / n * Math.PI * 2) * r, Math.sin(i / n * Math.PI * 2) * r]);

const CRATES = {
  bolt: { hp: 1, bolts: [30, 55], tex: 'bolt' },
  big: { hp: 60, bolts: [140, 200], tex: 'bolt', size: 1.4, metal: true },
  ammo: { hp: 1, bolts: [0, 0], tex: 'ammo' },
  health: { hp: 1, bolts: [0, 0], tex: 'health' },
  boom: { hp: 1, bolts: [10, 20], tex: 'boom' },
};

// Calcule une vitesse de lancer balistique (gravité montante/descendante de Kobi)
function ballistic(from, to, apexAbove = 3, gUp = 33, gDown = 42.9) {
  const apexY = Math.max(from.y, to.y) + apexAbove;
  const vy = Math.sqrt(2 * gUp * (apexY - from.y));
  const t1 = vy / gUp;
  const t2 = Math.sqrt(2 * (apexY - to.y) / gDown);
  const T = t1 + t2;
  const dx = to.x - from.x, dz = to.z - from.z;
  return new THREE.Vector3(dx / T, vy, dz / T);
}

class Rail {
  constructor(points, opts = {}) {
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    this.curve = curve;
    const len = curve.getLength();
    const n = Math.max(8, Math.ceil(len / 0.4));
    this.pts = curve.getSpacedPoints(n);
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) this.cum.push(this.cum[i - 1] + this.pts[i].distanceTo(this.pts[i - 1]));
    this.length = this.cum[this.cum.length - 1];
    this.speed = opts.speed || 13;
    this.oneWay = !!opts.oneWay;
    const b = new THREE.Box3().setFromPoints(this.pts);
    b.expandByScalar(2);
    this.box = b;
  }
  closest(p) {
    if (!this.box.containsPoint(p)) return { dist: Infinity };
    let best = Infinity, bi = 0, bt = 0;
    for (let i = 0; i < this.pts.length - 1; i++) {
      const a = this.pts[i], b = this.pts[i + 1];
      _v.subVectors(b, a);
      const l2 = _v.lengthSq();
      let t = l2 ? _v2.subVectors(p, a).dot(_v) / l2 : 0;
      t = clamp(t, 0, 1);
      _v2.copy(a).addScaledVector(_v, t);
      const d = _v2.distanceTo(p);
      if (d < best) { best = d; bi = i; bt = t; }
    }
    const s = this.cum[bi] + (this.cum[bi + 1] - this.cum[bi]) * bt;
    return { dist: best, s, point: this.point(s, new THREE.Vector3()) };
  }
  _seg(s) {
    s = clamp(s, 0, this.length);
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= s) lo = mid; else hi = mid;
    }
    const t = (s - this.cum[lo]) / Math.max(1e-6, this.cum[hi] - this.cum[lo]);
    return [lo, hi, t];
  }
  point(s, out) {
    const [a, b, t] = this._seg(s);
    return out.copy(this.pts[a]).lerp(this.pts[b], t);
  }
  tangent(s, out) {
    const [a, b] = this._seg(s);
    return out.subVectors(this.pts[b], this.pts[a]).normalize();
  }
}

// Tissu de drapeau avec écrou emblème et liseré
const flagCache = {};
function flagMat(color) {
  if (flagCache[color]) return flagCache[color];
  const c = document.createElement('canvas');
  c.width = 128; c.height = 80;
  const x = c.getContext('2d');
  x.fillStyle = color; x.fillRect(0, 0, 128, 80);
  const gr = x.createLinearGradient(0, 0, 0, 80);
  gr.addColorStop(0, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0.22)');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 80);
  x.fillStyle = '#fff3d0'; x.fillRect(0, 66, 128, 6);
  x.translate(56, 34);
  x.fillStyle = '#fff3d0'; x.strokeStyle = '#1d1028'; x.lineWidth = 3;
  x.beginPath();
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; x.lineTo(Math.cos(a) * 20, Math.sin(a) * 20); }
  x.closePath(); x.fill(); x.stroke();
  x.fillStyle = color; x.beginPath(); x.arc(0, 0, 8, 0, Math.PI * 2); x.fill(); x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.userData.shared = true;
  const m = mat('#ffffff', { map: t, rough: 0.8, side: THREE.DoubleSide });
  flagCache[color] = m;
  return m;
}

// ----------------------------------------------------------- modèles de caisses
// Caisse en bois : cadre de liteaux sur les douze arêtes, plateaux de trois planches en retrait, écharpe en diagonale
// clouée sur les côtés, coins de tôle rivetés ; peinte à la couleur de son contenu (usée jusqu'au bois aux arêtes).
// Grosse caisse (Station) : caisson blindé en tôle peinte, cadre de cornières, rivets, coins renforcés.
// Géométries fusionnées par matériau, partagées entre toutes les caisses d'un même type.
const CRATE_LOOK = {
  bolt: { wood: '#c4823f' },
  ammo: { wood: '#9a6a40', paint: '#3f6fc0' },
  health: { wood: '#9a6a40', paint: '#3f9a5a' },
  boom: { wood: '#9a6a40', paint: '#d8452f' },
};
const crateModels = new Map();
let crateSteel = null;
function crateModel(type, size) {
  const key = type + '|' + size;
  if (crateModels.has(key)) return crateModels.get(key);
  const s = size, h = s / 2;
  if (!crateSteel) {
    const t = paintedMetalTexture('#6d7a96', 'crate-steel', { chip: 0.3, edge: 0.8, rust: 0.15 });
    crateSteel = mat('#ffffff', { map: t.map, normalMap: t.normalMap, rough: 0.38, metal: 0.65, vertexColors: true });
  }
  const steel = [];
  let res;
  if (type === 'big') {
    // caisson blindé : panneaux de tôle peinte (clairs), cornières et coins (foncés), rivets le long des cornières
    const pt = paintedMetalTexture('#a9b3c8', 'crate-armor', { chip: 0.25, edge: 0.9, rust: 0.1 });
    const panelM = mat('#ffffff', { map: pt.map, normalMap: pt.normalMap, rough: 0.35, metal: 0.6, vertexColors: true });
    const f = 0.12 * s, panel = [];
    panel.push(rboxAt(s - 0.08 * s, s - 0.08 * s, s - 0.08 * s, 0.03 * s, 0, 0, 0));
    for (const [ax, sg] of [[0, 1], [0, -1], [2, 1], [2, -1], [1, 1]]) {
      // nervures horizontales embouties sur chaque face
      for (const y of [-0.17 * s, 0.17 * s]) {
        const dims = ax === 1 ? [s - 2 * f, 0.03 * s, 0.07 * s] : ax === 0 ? [0.03 * s, 0.07 * s, s - 2 * f] : [s - 2 * f, 0.07 * s, 0.03 * s];
        const p = [0, ax === 1 ? 0 : y, 0];
        p[ax] = sg * (h - 0.04 * s + 0.012 * s);
        if (ax === 1) p[2] = y;
        panel.push(boxAt(G.box(...dims), ...p));
      }
    }
    for (const a of [1, -1]) for (const b of [1, -1]) {
      const o = h - f / 2;
      steel.push(rboxAt(s, f, f, 0.015 * s, 0, a * o, b * o));
      steel.push(rboxAt(f, f, s, 0.015 * s, a * o, b * o, 0));
      steel.push(rboxAt(f, s, f, 0.015 * s, a * o, 0, b * o));
    }
    for (const x of [1, -1]) for (const y of [1, -1]) for (const z of [1, -1]) steel.push(rboxAt(f * 1.25, f * 1.25, f * 1.25, 0.02 * s, x * (h - f * 0.55), y * (h - f * 0.55), z * (h - f * 0.55)));
    // rivets sur les cornières verticales, vus des quatre côtés
    for (const [nx, nz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const pts = [];
      for (const sd of [1, -1]) for (let k = -2; k <= 2; k++) {
        const t = sd * (h - f / 2), y = k * 0.17 * s;
        pts.push(nz ? [t, y, nz * (h + 0.002)] : [nx * (h + 0.002), y, t]);
      }
      rivets(steel, pts, [nx, 0, nz], 0.022 * s);
    }
    const pg = mergeParts(panel), sg = mergeParts(steel);
    grime(pg, -h, -h + 0.5 * s, 0.3); grime(sg, -h, -h + 0.5 * s, 0.3);
    res = [[pg, panelM], [sg, crateSteel]];
  } else {
    const look = CRATE_LOOK[type] || CRATE_LOOK.bolt;
    const wt = plankTexture(look.wood, null, look.paint ? { paint: look.paint, chip: 0.45, wear: 0.5, seed: 3 } : { wear: 0.6, seed: 5 });
    const woodM = mat('#ffffff', { map: wt.map, normalMap: wt.normalMap, rough: look.paint ? 0.55 : 0.72, vertexColors: true, coat: 0.15, coatRough: 0.35 });
    const f = 0.11 * s, t = 0.045 * s, rec = 0.02 * s, L = s - 2 * f, o = h - f / 2;
    const wood = [];
    // liteaux des arêtes
    for (const a of [1, -1]) for (const b of [1, -1]) {
      wood.push(plankBox(s, f, f, 1, a * 0.37 + b * 0.11).translate(0, a * o, b * o));
      wood.push(plankBox(f, f, L, 1, a * 0.53 + b * 0.29).translate(a * o, b * o, 0));
      wood.push(plankBox(f, L, f, 1, a * 0.71 + b * 0.17).translate(a * o, 0, b * o));
    }
    // plateaux de planches (posés sur les six faces, glissés sous les liteaux)
    const faces = [[0, 0, 0], [0, Math.PI, 0], [0, Math.PI / 2, 0], [0, -Math.PI / 2, 0], [-Math.PI / 2, 0, 0], [Math.PI / 2, 0, 0]];
    const e = new THREE.Euler(), mm = new THREE.Matrix4(), q = new THREE.Quaternion();
    faces.forEach((r, i) => {
      const pnl = plankPanel(L + 0.03 * s, L + 0.03 * s, 3, { thick: t, seed: i * 7 + 1, gap: 0.014 * s });
      pnl.translate(0, 0, h - rec - t);
      // écharpe en diagonale (côtés seulement), clouée aux deux bouts et au milieu
      if (i < 4) {
        const sgn = i % 2 ? 1 : -1;
        const br = plankBox(L * Math.SQRT2 - 0.06 * s, f * 0.82, t * 0.95, 1, i * 0.3).rotateZ(sgn * Math.PI / 4).translate(0, 0, h - rec + t * 0.47);
        const nails = [];
        const dz = h - rec + t * 0.95 + 0.002;
        for (const k of [-0.36, 0, 0.36]) nails.push([k * L, sgn * k * L, dz]);
        rivets(steel, nails.map(([x, y, z]) => new THREE.Vector3(x, y, z).applyEuler(e.set(...r)).toArray()), new THREE.Vector3(0, 0, 1).applyEuler(e).toArray(), 0.016 * s);
        pnl.applyMatrix4(mm.makeRotationFromQuaternion(q.setFromEuler(e.set(...r))));
        br.applyMatrix4(mm);
        wood.push(pnl, br);
      } else {
        pnl.applyMatrix4(mm.makeRotationFromQuaternion(q.setFromEuler(e.set(...r))));
        wood.push(pnl);
      }
    });
    // coins de tôle : trois plaques pliées par coin, un rivet chacune
    const c = 0.2 * s, pt = 0.012 * s;
    for (const x of [1, -1]) for (const y of [1, -1]) for (const z of [1, -1]) {
      const cx = x * (h - c / 2 + 0.004 * s), cy = y * (h - c / 2 + 0.004 * s), cz = z * (h - c / 2 + 0.004 * s);
      steel.push(boxAt(G.box(pt, c, c), x * (h + pt / 2), cy, cz));
      steel.push(boxAt(G.box(c, pt, c), cx, y * (h + pt / 2), cz));
      steel.push(boxAt(G.box(c, c, pt), cx, cy, z * (h + pt / 2)));
      const r = 0.018 * s, k = h - c * 0.42;
      rivets(steel, [[x * (h + pt), y * k, z * k]], [x, 0, 0], r);
      rivets(steel, [[x * k, y * (h + pt), z * k]], [0, y, 0], r);
      rivets(steel, [[x * k, y * k, z * (h + pt)]], [0, 0, z], r);
    }
    // cœur sombre (on ne voit pas le jour entre les planches)
    const core = boxAt(G.box(s - 0.1 * s, s - 0.1 * s, s - 0.1 * s), 0, 0, 0);
    const nCore = core.attributes.position.count;
    const wg = mergeParts(wood);
    grime(wg, -h, -h + 0.45 * s, 0.32);
    const sg = mergeParts([...steel, core]);
    grime(sg, -h, -h + 0.45 * s, 0.3);
    sg.attributes.color.array.fill(0.12, (sg.attributes.position.count - nCore) * 3);
    res = [[wg, woodM], [sg, crateSteel]];
  }
  crateModels.set(key, res);
  return res;
}

// ----------------------------------------------------------- modèle de borne de sauvegarde
// Socle octogonal à gradins en métal peint (bande de danger, boulons), fourreau et mât d'acier à colliers, boîtier de
// raccordement, attaches du fanion, lanterne en cage (coupelle, barreaux, chapeau). Fusionné par matériau, partagé.
let cpModel = null;
function checkpointModel() {
  if (cpModel) return cpModel;
  const pt = paintedMetalTexture('#3a4058', 'cp-paint', { chip: 0.25, edge: 0.75, rust: 0.12 });
  const paintM = mat('#ffffff', { map: pt.map, normalMap: pt.normalMap, rough: 0.42, metal: 0.55, vertexColors: true });
  const steelM = mat('#c3cbe0', { rough: 0.28, metal: 0.85, vertexColors: true });
  const hz = hazardTexture();
  const hzM = mat('#ffffff', { map: hz.map, rough: 0.5, metal: 0.25 });
  const paint = [], steel = [];
  const cyl = (rt, rb, h, seg, y, open = false) => G.cyl(rt, rb, h, seg, open).toNonIndexed().rotateY(Math.PI / 8).translate(0, y, 0);
  // socle : gradin bas, chanfrein, gradin haut ceinturé d'une bande de danger, boulons sur le chanfrein
  paint.push(cyl(0.62, 0.68, 0.14, 8, 0.07), cyl(0.5, 0.62, 0.07, 8, 0.175), cyl(0.44, 0.47, 0.16, 8, 0.29));
  // bande épousant le fruit du gradin haut (rayon au sommet 0,47 → 0,44 sur 0,16 m), 5 mm de surépaisseur
  const stepR = (y) => 0.47 - (y - 0.21) / 0.16 * 0.03;
  const band = cyl(stepR(0.305) + 0.005, stepR(0.235) + 0.005, 0.07, 8, 0.27, true);
  const uv = band.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 7, uv.getY(i) * 0.25);
  band.userData.shared = true;
  // boulons au milieu du chanfrein (milieu des faces de l'octogone, apothème = rayon × cos 22,5°), tête selon la pente
  const ap = Math.cos(Math.PI / 8), cr = (0.62 + 0.5) / 2 * ap, sl = Math.hypot(0.07, (0.62 - 0.5) * ap);
  const nr = 0.07 / sl, ny = (0.62 - 0.5) * ap / sl;
  for (let k = 0; k < 8; k++) {
    const a = (k + 0.5) * Math.PI / 4 + Math.PI / 8, c = Math.cos(a), s = Math.sin(a);
    rivets(steel, [[c * cr, 0.175, s * cr]], [c * nr, ny, s * nr], 0.035);
  }
  // fourreau, mât, colliers
  paint.push(G.cyl(0.11, 0.135, 0.42, 12).toNonIndexed().translate(0, 0.58, 0));
  paint.push(G.cyl(0.13, 0.13, 0.05, 12).toNonIndexed().translate(0, 0.8, 0));
  steel.push(G.cyl(0.06, 0.07, 2.0, 12).toNonIndexed().translate(0, 1.4, 0));
  for (const y of [1.25, 2.38]) paint.push(G.cyl(0.085, 0.085, 0.06, 12).toNonIndexed().translate(0, y, 0));
  // attaches du fanion
  for (const y of [1.78, 2.32]) steel.push(G.torus(0.075, 0.016, 5, 12).toNonIndexed().rotateX(Math.PI / 2).translate(0, y, 0));
  // boîtier de raccordement (côté opposé au fanion), couvercle vissé
  paint.push(rboxAt(0.14, 0.3, 0.22, 0.025, -0.13, 1.0, 0));
  rivets(steel, [[-0.2, 1.12, 0.08], [-0.2, 1.12, -0.08], [-0.2, 0.88, 0.08], [-0.2, 0.88, -0.08]], [-1, 0, 0], 0.014);
  steel.push(G.cyl(0.025, 0.025, 0.16, 6).toNonIndexed().translate(-0.13, 0.78, 0));
  // lanterne : coupelle, barreaux, cerclage, chapeau à bouton
  paint.push(G.cyl(0.2, 0.1, 0.09, 12).toNonIndexed().translate(0, 2.4, 0));
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; steel.push(G.cyl(0.014, 0.014, 0.4, 4).toNonIndexed().translate(Math.cos(a) * 0.2, 2.62, Math.sin(a) * 0.2)); }
  steel.push(G.torus(0.2, 0.014, 4, 16).toNonIndexed().rotateX(Math.PI / 2).translate(0, 2.62, 0));
  paint.push(G.cone(0.26, 0.14, 12).toNonIndexed().translate(0, 2.9, 0));
  paint.push(G.cyl(0.23, 0.23, 0.03, 12).toNonIndexed().translate(0, 2.83, 0));
  steel.push(G.sphere(0.035, 8, 6).toNonIndexed().translate(0, 2.98, 0));
  const pg = mergeParts(paint), sg = mergeParts(steel);
  grime(pg, 0, 0.6, 0.35); grime(sg, 0, 0.6, 0.35);
  cpModel = [[pg, paintM], [sg, steelM], [band, hzM]];
  return cpModel;
}

// ----------------------------------------------------------- modèle du Bazar Pétarade
// Même silhouette et mêmes couleurs : socle sombre à plancher de tôle larmée, caisson rose en tôle peinte vernie
// (écaillée aux arêtes) avec rangées de rivets et ouïes latérales, écran dans un cadre riveté, comptoir jaune à jonc
// de caoutchouc et consoles, boutons de commande, fronton jaune à guirlande d'ampoules, lampes d'angle dans leurs
// coupelles, pattes de l'enseigne.
// répliques de Gigi quand Kobi passe près du Bazar
const HAIL = ['Psst ! Par ici, mon lapin !', 'Munitions fraîches, prix cassés !', 'Hé ! Le Bazar est ouvert !', 'On ne passe pas sans dire bonjour !'];
const HAIL_NEW = ['Psst ! J’ai une arme pour toi !', 'Tu as de quoi t’offrir du neuf !', 'Viens voir ce qui vient d’arriver !'];
// dégradé vertical de la balise du Bazar (fond plein, sommet évanoui)
let beaconTex = null;
function beaconTexture() {
  if (beaconTex) return beaconTex;
  const c = document.createElement('canvas');
  c.width = 4; c.height = 128;
  const ctx = c.getContext('2d');
  const gr = ctx.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(0.55, 'rgba(255,255,255,0.35)');
  gr.addColorStop(0.92, 'rgba(255,255,255,1)');
  gr.addColorStop(1, 'rgba(255,255,255,0.4)');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, 4, 128);
  beaconTex = new THREE.CanvasTexture(c);
  beaconTex.colorSpace = THREE.SRGBColorSpace;
  return beaconTex;
}
let vendorM = null;
function vendorModel() {
  if (vendorM) return vendorM;
  const pm = (color, key, o, m) => {
    const t = paintedMetalTexture(color, key, o);
    return mat('#ffffff', { map: t.map, normalMap: t.normalMap, vertexColors: true, ...m });
  };
  const bodyM = pm('#ff8aa0', 'bazar-rose', { chip: 0.12, edge: 0.5, rust: 0.04, bare: '#dfe2ea' }, { rough: 0.4, metal: 0.35, coat: 0.9, coatRough: 0.1 });
  const trimM = pm('#ffd23a', 'bazar-jaune', { chip: 0.1, edge: 0.55, rust: 0.03, bare: '#e8e4d8' }, { rough: 0.3, metal: 0.6, coat: 0.5 });
  const darkM = pm('#26233a', 'bazar-sombre', { chip: 0.15, edge: 0.6, rust: 0.05, bare: '#8a90a6' }, { rough: 0.32, metal: 0.5, coat: 0.5 });
  const steelM = mat('#c3cbe0', { rough: 0.28, metal: 0.85 });
  const tt = treadPlateTexture('#9097b0', 'bazar-larmee');
  const treadM = mat('#ffffff', { map: tt.map, normalMap: tt.normalMap, rough: 0.35, metal: 0.75 });
  const btnM = mat('#ffffff', { vertexColors: true, rough: 0.25, coat: 0.9, coatRough: 0.05 });
  const body = [], trim = [], dark = [], steel = [], bulbs = [], btn = [];
  // socle et plancher
  dark.push(rboxAt(2.4, 0.36, 1.6, 0.07, 0, 0.18, 0));
  const tread = boxUV(2.26, 0.02, 1.46, 1.3).toNonIndexed().translate(0, 0.365, 0);
  // caisson (posé sur le plancher de tôle larmée), ouïes latérales, rivets du chant avant
  body.push(rboxAt(2.0, 2.43, 1.0, 0.18, 0, 1.585, -0.1));
  for (const sx of [1, -1]) {
    dark.push(rboxAt(0.04, 0.62, 0.7, 0.015, sx * 1.0, 2.25, -0.1));
    for (let k = 0; k < 5; k++) trim.push(G.box(0.06, 0.035, 0.6).toNonIndexed().rotateZ(sx * 0.6).translate(sx * 1.035, 2.03 + k * 0.11, -0.1));
    // rivets sur l'arrondi des arêtes verticales (rayon 0,18 centré en x ±0,82, z 0,22) : tête selon la normale
    const pts = [];
    for (let k = 0; k < 9; k++) pts.push([sx * 0.9, 0.55 + k * 0.26, 0.22 + Math.sqrt(0.18 * 0.18 - 0.08 * 0.08)]);
    rivets(steel, pts, [sx * 0.08, 0, Math.sqrt(0.18 * 0.18 - 0.08 * 0.08)], 0.022);
    const sp = [];
    for (let k = 0; k < 6; k++) sp.push([sx * (0.82 + Math.sqrt(0.18 * 0.18 - 0.06 * 0.06)), 0.6 + k * 0.22, 0.28]);
    rivets(steel, sp, [sx * Math.sqrt(0.18 * 0.18 - 0.06 * 0.06), 0, 0.06], 0.022);
  }
  // écran : cadre riveté
  dark.push(rboxAt(1.6, 1.1, 0.12, 0.05, 0, 1.8, 0.42));
  // rivets au milieu de la bordure du cadre (l'écran couvre ±0,725 × 1,325..2,275), sur l'arrondi du chant
  rivets(steel, [[-0.7625, 2.3125, 0.477], [0.7625, 2.3125, 0.477], [-0.7625, 1.2875, 0.477], [0.7625, 1.2875, 0.477]], [0, 0, 1], 0.025);
  const screen = G.box(1.45, 0.95, 0.02).toNonIndexed().translate(0, 1.8, 0.49);
  screen.userData.shared = true;
  // comptoir : plateau, jonc avant, consoles, boutons
  trim.push(rboxAt(2.2, 0.15, 0.7, 0.05, 0, 1.0, 0.45));
  dark.push(rboxAt(2.24, 0.07, 0.07, 0.025, 0, 1.0, 0.79));
  for (const x of [-0.8, 0.8]) dark.push(G.box(0.05, 0.27, 0.27).toNonIndexed().rotateX(Math.PI / 4).translate(x, 0.86, 0.48));
  const cols = ['#ff4a4a', '#ffd23a', '#4ac8ff'];
  cols.forEach((c, i) => {
    const g = G.cyl(0.045, 0.05, 0.035, 12).toNonIndexed().translate(0.5 + i * 0.13, 1.09, 0.62);
    const cc = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) { a[k * 3] = cc.r; a[k * 3 + 1] = cc.g; a[k * 3 + 2] = cc.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    btn.push(g);
  });
  dark.push(rboxAt(0.48, 0.03, 0.16, 0.01, 0.63, 1.08, 0.62));
  // fronton, guirlande d'ampoules et leurs douilles, lampes d'angle dans leurs coupelles
  trim.push(rboxAt(2.1, 0.25, 1.1, 0.08, 0, 2.85, -0.1));
  for (let k = -3; k <= 3; k++) {
    bulbs.push(G.sphere(0.045, 8, 6).toNonIndexed().translate(k * 0.24, 2.85, 0.5));
    dark.push(G.cyl(0.03, 0.03, 0.04, 8).toNonIndexed().rotateX(Math.PI / 2).translate(k * 0.24, 2.85, 0.46));
  }
  for (const sx of [-1, 1]) {
    bulbs.push(G.sphere(0.12, 10, 8).toNonIndexed().translate(sx * 1.0, 2.85, 0.5));
    dark.push(G.cyl(0.11, 0.06, 0.1, 12).toNonIndexed().translate(sx * 1.0, 2.73, 0.5));
    // potence de la coupelle : du coin du caisson, sous le fronton, jusqu'au fond de la coupelle
    dark.push(G.box(0.05, 0.05, 0.2).toNonIndexed().translate(sx * 0.97, 2.7, 0.38));
  }
  // pattes de l'enseigne
  for (const x of [-0.9, 0.9]) { dark.push(rboxAt(0.08, 0.16, 0.08, 0.015, x, 3.03, 0)); rivets(steel, [[x, 3.03, 0.042]], [0, 0, 1], 0.016); }
  const bodyG = mergeParts(body), trimG = mergeParts(trim), darkG = mergeParts(dark);
  grime(bodyG, 0.4, 1.2, 0.2); grime(trimG, 0.9, 2.0, 0.1); grime(darkG, 0, 0.5, 0.3);
  tread.userData.shared = true;
  vendorM = {
    parts: [[bodyG, bodyM], [trimG, trimM], [darkG, darkM], [mergeParts(steel), steelM], [tread, treadM], [mergeParts(btn), btnM]],
    screen,
    bulbs: mergeParts(bulbs),
  };
  return vendorM;
}

// ----------------------------------------------------------- modèle de plateforme mobile
// Caisson en tôle peinte (écaillée aux arêtes), plancher de tôle larmée encadré de lisses rivetées, butoirs d'angle,
// bande de danger au pied, réacteurs sur platines à cerclage. Fusionné par matériau, partagé par taille et couleur.
const platModels = new Map();
function platformModel(size, color) {
  const key = [size.x, size.y, size.z, color].join('|');
  if (platModels.has(key)) return platModels.get(key);
  const sx = size.x, sy = size.y, sz = size.z, hy = sy / 2;
  const pt = paintedMetalTexture(color, null, { chip: 0.3, edge: 0.85, rust: 0.2 });
  const paintM = mat('#ffffff', { map: pt.map, normalMap: pt.normalMap, rough: 0.45, metal: 0.55, vertexColors: true });
  // plancher : tôle larmée à la couleur de la plateforme, éclaircie
  const tc = '#' + new THREE.Color(color).lerp(new THREE.Color('#b8c0d4'), 0.45).getHexString();
  const tt = treadPlateTexture(tc);
  const treadM = mat('#ffffff', { map: tt.map, normalMap: tt.normalMap, rough: 0.45, metal: 0.6 });
  const darkM = mat('#3a3f52', { rough: 0.4, metal: 0.7, vertexColors: true });
  const hz = hazardTexture();
  const hzM = mat('#ffffff', { map: hz.map, rough: 0.6 });
  const paint = [], dark = [];
  const r = 0.17, rh = 0.18;
  // caisson : du pied (sous la bande de danger) jusque sous le plancher (plus de jour entre caisson et tôle larmée)
  paint.push(rboxAt(sx - 0.08, sy - 0.09, sz - 0.08, 0.06, 0, -0.005, 0));
  // lisses du plancher, rivetées sur leur chant
  for (const s of [1, -1]) {
    paint.push(rboxAt(sx, rh, r, 0.04, 0, hy - rh / 2, s * (sz / 2 - r / 2)));
    paint.push(rboxAt(r, rh, sz - 2 * r + 0.02, 0.04, s * (sx / 2 - r / 2), hy - rh / 2, 0));
    const px = [], pz = [];
    for (let x = -sx / 2 + 0.5; x <= sx / 2 - 0.49; x += 0.42) px.push([x, hy - rh / 2, s * (sz / 2 + 0.001)]);
    for (let z = -sz / 2 + 0.5; z <= sz / 2 - 0.49; z += 0.42) pz.push([s * (sx / 2 + 0.001), hy - rh / 2, z]);
    rivets(dark, px, [0, 0, s], 0.025);
    rivets(dark, pz, [s, 0, 0], 0.025);
  }
  const deck = boxUV(sx - 2 * r + 0.02, 0.04, sz - 2 * r + 0.02, 1.2).toNonIndexed().translate(0, hy - 0.03, 0);
  // butoirs d'angle
  for (const a of [1, -1]) for (const b of [1, -1]) {
    dark.push(rboxAt(0.26, sy + 0.04, 0.26, 0.05, a * (sx / 2 - 0.1), 0, b * (sz / 2 - 0.1)));
    rivets(dark, [[a * (sx / 2 + 0.031), hy - 0.12, b * (sz / 2 - 0.1)], [a * (sx / 2 + 0.031), -hy + 0.12, b * (sz / 2 - 0.1)]], [a, 0, 0], 0.028);
    rivets(dark, [[a * (sx / 2 - 0.1), hy - 0.12, b * (sz / 2 + 0.031)], [a * (sx / 2 - 0.1), -hy + 0.12, b * (sz / 2 + 0.031)]], [0, 0, b], 0.028);
  }
  // réacteurs : platine, tuyère, cerclage
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = a * (sx / 2 - 0.5), z = b * (sz / 2 - 0.5);
    // platine engagée dans la bande de danger et sous le caisson (elle n'affleurait que la bande)
    dark.push(G.cyl(0.4, 0.4, 0.05, 14).toNonIndexed().translate(x, -hy + 0.015, z));
    dark.push(G.cyl(0.25, 0.32, 0.4, 14).toNonIndexed().translate(x, -hy - 0.2, z));
    dark.push(G.torus(0.3, 0.035, 5, 16).toNonIndexed().rotateX(Math.PI / 2).translate(x, -hy - 0.33, z));
  }
  const band = boxUV(sx - 0.06, 0.15, sz - 0.06, 0.5).toNonIndexed().translate(0, -hy + 0.1, 0);
  const pg = mergeParts(paint), dg = mergeParts(dark);
  grime(pg, -hy, hy, 0.25); grime(dg, -hy - 0.4, hy, 0.2);
  deck.userData.shared = band.userData.shared = true;
  const res = [[pg, paintM], [dg, darkM], [deck, treadM], [band, hzM]];
  platModels.set(key, res);
  return res;
}

// Flamme de réacteur : cône pointe en haut, base à l'origine (retourné à la pose)
let jetG = null;
function jetGeo() {
  if (!jetG) { jetG = G.cone(0.22, 0.7, 10).clone().translate(0, 0.35, 0); jetG.userData.shared = true; }
  return jetG;
}

// ----------------------------------------------------------- portes aimantées, champs de force, tremplins
// Matériaux communs : tôle sombre peinte écaillée, acier des rivets et coulisses, bande de danger
let magM = null;
function magMats() {
  if (magM) return magM;
  const t = paintedMetalTexture('#2f3246', 'mag-frame', { chip: 0.25, edge: 0.8, rust: 0.2, bare: '#9aa2b8' });
  const hz = hazardTexture();
  magM = {
    frame: mat('#ffffff', { map: t.map, normalMap: t.normalMap, rough: 0.4, metal: 0.6 }),
    steel: mat('#6a7290', { rough: 0.35, metal: 0.8 }),
    hazard: mat('#ffffff', { map: hz.map, rough: 0.55, metal: 0.2 }),
  };
  return magM;
}
// Battant de porte aimantée (w × h, 0,4 d'épaisseur) : âme de tôle violette, raidisseurs latéraux et nervures
// horizontales rivetées sur les deux faces (le centre reste libre pour l'emblème), bande de danger au pied
const slabModels = new Map();
function magSlab(w, h) {
  const key = w + '|' + h;
  if (slabModels.has(key)) return slabModels.get(key);
  const t = paintedMetalTexture('#5a4a8a', 'mag-slab', { chip: 0.25, edge: 0.85, rust: 0.15, bare: '#b8bccc' });
  const slabM = mat('#ffffff', { map: t.map, normalMap: t.normalMap, rough: 0.42, metal: 0.6, vertexColors: true });
  const m = magMats();
  const core = [rboxAt(w, h, 0.34, 0.06, 0, 0, 0)], steel = [];
  for (const z of [1, -1]) {
    for (const sx of [1, -1]) steel.push(rboxAt(0.18, h - 0.12, 0.06, 0.02, sx * (w / 2 - 0.14), 0, z * 0.18));
    for (const y of [-(h / 2 - 0.4), h / 2 - 0.4, -(h * 0.27 + 0.1), h * 0.27 + 0.1]) {
      steel.push(rboxAt(w - 0.5, 0.14, 0.05, 0.02, 0, y, z * 0.18));
      const pts = [];
      for (let x = -w / 2 + 0.45; x <= w / 2 - 0.44; x += 0.4) pts.push([x, y, z * 0.206]);
      rivets(steel, pts, [0, 0, z], 0.022);
    }
  }
  const band = boxUV(w - 0.04, 0.2, 0.4, 0.6).toNonIndexed().translate(0, -h / 2 + 0.12, 0);
  band.userData.shared = true;
  const cg = mergeParts(core), sg = mergeParts(steel);
  grime(cg, -h / 2, -h / 2 + 1.2, 0.35); grime(sg, -h / 2, -h / 2 + 1.2, 0.3);
  const steelM = mat('#6a7290', { rough: 0.35, metal: 0.8, vertexColors: true });
  const res = [[cg, slabM], [sg, steelM], [band, m.hazard]];
  slabModels.set(key, res);
  return res;
}
// Socle de tremplin : embase en tôle peinte, couronne de boulons, bande de danger, pattes d'ancrage
let padM = null;
function padModel() {
  if (padM) return padM;
  const m = magMats();
  const t = paintedMetalTexture('#3d4258', 'pad-base', { chip: 0.3, edge: 0.8, rust: 0.15 });
  const baseM = mat('#ffffff', { map: t.map, normalMap: t.normalMap, rough: 0.4, metal: 0.65, vertexColors: true });
  const base = [G.cyl(1.25, 1.45, 0.3, 32).toNonIndexed().translate(0, 0.15, 0), G.cyl(1.12, 1.25, 0.06, 32).toNonIndexed().translate(0, 0.33, 0)];
  const steel = [];
  // couronne de boulons posée sur le chanfrein de la bague (rayon 1,25 → 1,12 sur 0,06 m), tête selon la pente
  const sl = Math.hypot(0.06, 0.13), cy = 0.3 + (1.25 - 1.19) / 0.13 * 0.06;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    rivets(steel, [[c * 1.19, cy, s * 1.19]], [c * 0.06 / sl, 0.13 / sl, s * 0.06 / sl], 0.035);
  }
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + Math.PI / 4;
    base.push(G.box(0.3, 0.12, 0.4).toNonIndexed().translate(0, 0.06, 1.5).rotateY(a));
    steel.push(G.cyl(0.05, 0.05, 0.05, 8).toNonIndexed().translate(0, 0.14, 1.58).rotateY(a));
  }
  // bande épousant le fruit de l'embase (rayon 1,45 au sol → 1,25 à 0,3 m), 6 mm de surépaisseur
  const baseR = (y) => 1.45 - y / 0.3 * 0.2;
  const band = G.cyl(baseR(0.125) + 0.006, baseR(0.035) + 0.006, 0.09, 32, true).toNonIndexed().translate(0, 0.08, 0);
  const uv = band.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 18, uv.getY(i) * 0.25);
  band.userData.shared = true;
  const bg = mergeParts(base), sg = mergeParts(steel);
  grime(bg, 0, 0.35, 0.3); grime(sg, 0, 0.35, 0.2);
  padM = [[bg, baseM], [sg, mat('#8a93ad', { rough: 0.35, metal: 0.85, vertexColors: true })], [band, m.hazard]];
  return padM;
}
// Plateau du tremplin (animé à part) : tôle larmée sombre
function padTopMat() {
  const t = treadPlateTexture('#3a4256', 'pad-top');
  return mat('#ffffff', { map: t.map, normalMap: t.normalMap, rough: 0.4, metal: 0.7 });
}

// ----------------------------------------------------------- boulon d'or et grappin
// Boulon d'or : tête hexagonale chanfreinée (dessus bombé), rondelle, tige filetée (filets en dents de scie), bout
// chanfreiné
const boltGeos = new Map();
function goldBoltGeo(r) {
  if (boltGeos.has(r)) return boltGeos.get(r);
  const shape = new THREE.Shape();
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; shape[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92); }
  shape.closePath();
  const head = new THREE.ExtrudeGeometry(shape, { depth: r * 0.5, bevelEnabled: true, bevelThickness: r * 0.1, bevelSize: r * 0.08, bevelSegments: 2 });
  head.rotateX(-Math.PI / 2).translate(0, r * 0.1, 0);
  const prof = [[0, 0], [r * 0.45, 0]];
  const turns = 7, len = r * 1.5;
  for (let k = 0; k < turns; k++) {
    const y = -r * 0.08 - (k / turns) * len;
    prof.push([r * 0.47, y - len / turns * 0.15], [r * 0.38, y - len / turns * 0.75]);
  }
  prof.push([r * 0.4, -r * 0.08 - len], [r * 0.3, -r * 0.18 - len], [0, -r * 0.18 - len]);
  const shaft = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 18);
  const washer = new THREE.CylinderGeometry(r * 1.12, r * 1.12, r * 0.1, 24).translate(0, -r * 0.02, 0);
  // la tête extrudée n'est pas indexée : seules la tige et la rondelle sont dépliées
  const g = mergeGeometries([head, shaft.toNonIndexed(), washer.toNonIndexed()].map((x) => { x.deleteAttribute('uv'); return x; }));
  g.userData.shared = true;
  boltGeos.set(r, g);
  return g;
}
// Bagues rivetées de l'anneau de grappin (quatre, à 45° des griffes)
let collarGeo = null;
function grappleCollars() {
  if (collarGeo) return collarGeo;
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    const c = G.cyl(0.16, 0.16, 0.16, 12).toNonIndexed().rotateZ(a).translate(Math.cos(a) * 0.7, Math.sin(a) * 0.7, 0);
    parts.push(c);
    rivets(parts, [[Math.cos(a) * 0.86, Math.sin(a) * 0.86, 0]], [Math.cos(a), Math.sin(a), 0], 0.03);
  }
  collarGeo = mergeParts(parts);
  return collarGeo;
}

export class Props {
  constructor(game) {
    this.game = game;
    this.reset();
  }
  reset() {
    this.crates = [];
    this.pads = [];
    this.platforms = [];
    this.grapples = [];
    this.checkpoints = [];
    this.goldBolts = [];
    this.orbiums = [];
    this.vendors = [];
    this.magnets = [];
    this._magHint = false;
    this.fields = [];
    this.spinners = [];
    this.lavas = [];
    this.updaters = [];
  }
  get root() { return this.game.level.root; }
  get world() { return this.game.world; }

  // ----------------------------------------------------------- caisses
  crate(pos, type = 'bolt', rotY = rand(-0.4, 0.4)) {
    const def = CRATES[type];
    const size = def.size || 1;
    const m = joint(this.root, [pos.x, pos.y + size / 2, pos.z]);
    m.rotation.y = rotY;
    for (const [geo, mt] of crateModel(type, size)) part(m, geo, mt, { receive: true });
    const decal = this._crateIcon(type, size);
    if (decal) m.add(compact(decal, 'crateIcon-' + type + size));
    const col = new BoxCollider(m.position, new THREE.Vector3(size / 2, size / 2, size / 2), new THREE.Quaternion().setFromEuler(m.rotation), { surface: 'wood', user: null });
    this.world.add(col);
    const c = { type, def, mesh: m, col, hp: def.hp, pos: m.position.clone(), size, squash: 0, alive: true, fuse: -1 };
    col.user = c;
    this.crates.push(c);
    return c;
  }
  _crateIcon(type, size) {
    const icons = { bolt: '#ffd23a', big: '#ffd23a', ammo: '#9fd4ff', health: '#7dffb0', boom: '#ffef5a' };
    const color = icons[type];
    if (!color) return null;
    const g = new THREE.Group();
    // icône à fleur de l'écharpe (petites caisses) ou des nervures embouties (grosse caisse, face avant à 0,487 × taille)
    const s = type === 'big' ? size * 0.5 : size * 0.53;
    for (const [axis, sign] of [['z', 1], ['z', -1], ['x', 1], ['x', -1]]) {
      let icon;
      if (type === 'health') {
        icon = new THREE.Group();
        part(icon, G.box(0.36, 0.12, 0.02), glow(color, 1.6), {});
        part(icon, G.box(0.12, 0.36, 0.02), glow(color, 1.6), {});
      } else if (type === 'boom') {
        icon = new THREE.Group();
        part(icon, G.cyl(0.2, 0.2, 0.02, 3), glow('#ffcf3a', 1.4), { r: [Math.PI / 2, 0, Math.PI] });
        part(icon, G.box(0.05, 0.14, 0.03), mat('#1a1a1a'), { p: [0, 0.01, 0] });
      } else if (type === 'ammo') {
        icon = new THREE.Group();
        for (let k = -1; k <= 1; k++) part(icon, G.capsule(0.04, 0.16, 3, 8), glow(color, 1.3), { p: [k * 0.1, 0, 0] });
      } else {
        icon = new THREE.Mesh(G.nut(0.16 * size, 0.03), glow(color, 1.2));
      }
      if (axis === 'z') { icon.position.z = sign * s; if (sign < 0) icon.rotation.y = Math.PI; }
      else { icon.position.x = sign * s; icon.rotation.y = sign * Math.PI / 2; }
      g.add(icon);
    }
    return g;
  }
  hitSphere(center, r, dmg, dir) {
    let any = false;
    for (const m of this.magnets || []) {
      if (!m.open && m.pos.distanceTo(center) < r + m.reach) { this.magnetHit(m); any = true; }
    }
    for (const c of this.crates) {
      if (!c.alive) continue;
      if (c.pos.distanceTo(center) < r + c.size * 0.6) {
        this.damageCrate(c, dmg, dir);
        any = true;
      }
    }
    return any;
  }
  damageCrate(c, dmg, dir) {
    if (!c.alive) return;
    const g = this.game;
    if (c.type === 'boom') {
      if (c.fuse < 0) { c.fuse = 0.55; g.audio.play('beep', { pos: c.pos, pitch: 1.5 }); }
      return;
    }
    c.hp -= dmg;
    c.squash = 1;
    if (c.hp <= 0) this.breakCrate(c);
    else { g.audio.play('shieldHit', { pos: c.pos }); g.fx.sparks(c.pos, dir, 6, '#ffe7a0'); }
  }
  breakCrate(c) {
    const g = this.game;
    c.alive = false;
    this.world.remove(c.col);
    c.mesh.parent && c.mesh.parent.remove(c.mesh);
    const colors = { bolt: '#c98a4b', big: '#b9c2d6', ammo: '#4a7fd1', health: '#43b06a', boom: '#d8452f' };
    g.fx.debrisBurst(c.pos, 10, colors[c.type], 0.14 * c.size, 6);
    g.fx.dust(c.pos, 5, '#d9b48a', 2, 0.8);
    g.audio.play('crate', { pos: c.pos, pitch: c.size > 1 ? 0.7 : 1 });
    const [b0, b1] = c.def.bolts;
    if (b1) g.pickups.spawnBolts(c.pos, Math.round(rand(b0, b1)));
    if (c.type === 'ammo') g.pickups.spawnAmmo(c.pos, 2);
    if (c.type === 'health') g.pickups.spawnHealth(c.pos, 25, 2);
    if (c.type === 'boom') {
      g.explode(c.pos, 4.2, 55, { source: 'crate', hurtsPlayer: 14, color: '#ff7b2a' });
    }
    g.stats.crates++;
  }

  // ----------------------------------------------------------- tremplin
  jumpPad(pos, target, apex = 4, color = '#4dffa0') {
    const grp = joint(this.root, [pos.x, pos.y, pos.z]);
    const pm = padModel();
    for (const [geo, mt] of pm) part(grp, geo, mt, { receive: true });
    // semelle sous l'embase et ses pattes d'ancrage quand le sol descend (pente, bosse)
    grp.updateMatrixWorld(true);
    const lugA = [0, 1, 2, 3].map((k) => k * Math.PI / 2 + Math.PI / 4);
    const lugPts = lugA.flatMap((a) => [-0.15, 0.15].map((x) => [x * Math.cos(a) + 1.7 * Math.sin(a), -x * Math.sin(a) + 1.7 * Math.cos(a)]));
    const gap = groundGap(this.world, grp.matrixWorld, [[0, 0], ...ringPts(1.45, 16), ...lugPts]);
    if (gap > 0.01) {
      const hh = Math.ceil((gap + 0.06) * 100) / 100, y = 0.005 - hh / 2;
      const sp = [G.cyl(1.45, 1.47, hh, 32).toNonIndexed().translate(0, y, 0)];
      for (const a of lugA) sp.push(G.box(0.3, hh, 0.4).toNonIndexed().translate(0, y, 1.5).rotateY(a));
      const sg = mergeGeometries(sp);
      for (const g of sp) g.dispose();
      grime(sg, -hh, 0.1, 0.4);
      part(grp, sg, pm[0][1], { receive: true });
    }
    const top =part(grp, G.cyl(1.0, 1.0, 0.12, 24), padTopMat(), { p: [0, 0.38, 0] });
    const ring = part(grp, G.torus(1.02, 0.07, 8, 32), glow(color, 2.2), { p: [0, 0.42, 0], r: [Math.PI / 2, 0, 0] });
    const arrows = joint(grp, [0, 0.45, 0]);
    for (let i = 0; i < 3; i++) {
      part(arrows, G.cone(0.22, 0.3, 3), glow(color, 1.6), { p: [0, 0.3 + i * 0.35, 0], r: [0, 0, 0], s: [1, 0.6, 0.2] });
    }
    const col = new CylinderCollider(pos.x, pos.z, pos.y, pos.y + 0.44, 1.3, { tag: 'jumppad', surface: 'metal' });
    this.world.add(col);
    const launch = ballistic(_v.copy(pos).setY(pos.y + 0.45), target, apex);
    const pad = { pos: pos.clone(), launch, mesh: grp, top, ring, arrows, t: 0, col };
    pad.bounce = () => { pad.t = 0.4; };
    col.user = pad;
    this.pads.push(pad);
    return pad;
  }

  // ----------------------------------------------------------- rails
  rail(points, opts = {}) {
    const rail = new Rail(points.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p))), opts);
    const tube = new THREE.TubeGeometry(rail.curve, Math.ceil(rail.length * 1.5), 0.09, 8, false);
    part(this.root, tube, mat('#c9d3e6', { rough: 0.25, metal: 0.9 }), {});
    const glowTube = new THREE.TubeGeometry(rail.curve, Math.ceil(rail.length * 1.5), 0.035, 6, false);
    const gm = part(this.root, glowTube, glow(opts.color || '#ffb03a', 1.8), { shadow: false });
    gm.position.y = -0.1;
    // supports : poutrelle en I sur platine boulonnée, traverse rivetée à goussets, étriers de part et d'autre de la
    // ligne lumineuse ; fusionnés avec le décor du niveau
    const L = this.game.level;
    const steelM = mat('#59607c', { rough: 0.42, metal: 0.7 }), darkM = mat('#2f3344', { rough: 0.5, metal: 0.6 });
    const step = opts.postStep || 7;
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), ONE = new THREE.Vector3(1, 1, 1);
    for (let s = 2; s < rail.length; s += step) {
      const p = rail.point(s, new THREE.Vector3());
      const hit = this.world.groundBelow(p.x, p.y - 0.3, p.z, 40);
      if (!hit || hit.t > 70) continue;
      const h = hit.t;
      const t = rail.tangent(s, _v);
      M.compose(p, Q.setFromAxisAngle(UP, Math.atan2(t.x, t.z)), ONE);
      const top = -0.3, bot = top - h, my = (top + bot) / 2;
      const steel = [], dark = [];
      for (const z of [0.09, -0.09]) steel.push(new THREE.BoxGeometry(0.22, h, 0.035).toNonIndexed().translate(0, my, z));
      steel.push(new THREE.BoxGeometry(0.035, h, 0.15).toNonIndexed().translate(0, my, 0));
      for (const x of [1, -1]) steel.push(G.box(0.045, 0.42, 0.045).toNonIndexed().rotateZ(x * 0.8).translate(x * 0.17, -0.44, 0));
      dark.push(G.box(0.5, 0.05, 0.5).toNonIndexed().translate(0, bot + 0.025, 0));
      rivets(dark, [[0.18, bot + 0.05, 0.18], [-0.18, bot + 0.05, 0.18], [0.18, bot + 0.05, -0.18], [-0.18, bot + 0.05, -0.18]], [0, 1, 0], 0.035);
      dark.push(G.box(0.9, 0.1, 0.24).toNonIndexed().translate(0, -0.25, 0));
      for (const z of [1, -1]) rivets(dark, [[-0.36, -0.25, z * 0.121], [0.36, -0.25, z * 0.121], [-0.18, -0.25, z * 0.121], [0.18, -0.25, z * 0.121]], [0, 0, z], 0.02);
      for (const x of [1, -1]) dark.push(G.box(0.04, 0.17, 0.06).toNonIndexed().translate(x * 0.105, -0.115, 0));
      L.add(mergeParts(steel), steelM, M);
      L.add(mergeParts(dark), darkM, M);
    }
    // colliers d'éclisse le long du tube, avec la patte qui porte la ligne lumineuse
    const coll = [];
    const up = new THREE.Vector3(), side = new THREE.Vector3(), basis = new THREE.Matrix4();
    for (let s = 1.2; s < rail.length - 0.5; s += 2.4) {
      const p = rail.point(s, new THREE.Vector3()), t = rail.tangent(s, _v).clone();
      side.crossVectors(t, UP).normalize();
      up.crossVectors(side, t).normalize();
      basis.makeBasis(side, up, t).setPosition(p);
      for (const g of [G.torus(0.1, 0.028, 5, 14).toNonIndexed(), G.box(0.03, 0.08, 0.05).toNonIndexed().translate(0, -0.1, 0)]) coll.push(g.applyMatrix4(basis));
    }
    if (coll.length) L.add(mergeParts(coll), darkM, null);
    this.game.level.rails.push(rail);
    // boulons le long du rail
    if (opts.bolts) {
      for (let s = 4; s < rail.length - 2; s += opts.bolts) {
        const p = rail.point(s, new THREE.Vector3());
        p.y += 1.0;
        this.game.pickups.placeBolt(p, 5);
      }
    }
    return rail;
  }

  // ----------------------------------------------------------- grappin
  grapple(pos, launchTarget, opts = {}) {
    const grp = joint(this.root, [pos.x, pos.y, pos.z]);
    const ringMat = mat('#2b3048', { rough: 0.3, metal: 0.8 });
    const outer = part(grp, G.torus(0.7, 0.12, 10, 28), ringMat, {});
    // bagues rivetées sur l'anneau, entre les griffes
    part(outer, grappleCollars(), mat('#8a93ad', { rough: 0.3, metal: 0.9 }), {});
    const core = part(grp, G.ico(0.3, 1), glow('#7ff3ff', 2.4), {});
    const halo = part(grp, G.torus(0.95, 0.04, 6, 32), glow('#7ff3ff', 1.5), { shadow: false });
    for (let i = 0; i < 4; i++) {
      part(outer, G.cone(0.12, 0.3, 4), ringMat, { p: [Math.cos(i * Math.PI / 2) * 0.85, Math.sin(i * Math.PI / 2) * 0.85, 0], r: [0, 0, i * Math.PI / 2 - Math.PI / 2] });
    }
    const from = new THREE.Vector3(pos.x, pos.y - 1.2, pos.z);
    const launch = opts.launch || ballistic(from, launchTarget, opts.apex ?? 2.5);
    // retour : l'anneau relance vers opts.back quand on l'attrape depuis le côté d'arrivée
    const back = opts.back ? { dir: new THREE.Vector3(opts.back.x - pos.x, 0, opts.back.z - pos.z).normalize(), launch: ballistic(from, opts.back, opts.backApex ?? opts.apex ?? 2.5) } : null;
    const fwdDir = new THREE.Vector3(launchTarget.x - pos.x, 0, launchTarget.z - pos.z).normalize();
    const gp = {
      pos: pos.clone(), range: opts.range || 17, launch, fwdDir, back, grp, outer, core, halo, hl: 0, t: Math.random() * 6,
      // élan de sortie selon la position de départ : on repart du côté opposé à celui d'où l'on vient
      launchFrom(start) {
        if (!back) return launch;
        const ox = start.x - pos.x, oz = start.z - pos.z;
        return ox * back.dir.x + oz * back.dir.z > ox * fwdDir.x + oz * fwdDir.z ? launch : back.launch;
      },
      highlight(on) { gp.hlTarget = on ? 1 : 0; },
      ping() { gp.pingT = 0.3; },
    };
    this.grapples.push(gp);
    this.game.level.grapples.push(gp);
    return gp;
  }

  // ----------------------------------------------------------- plateformes mobiles
  // path : liste de positions ; opts : speed, wait, size, rotSpeed, model
  platform(path, opts = {}) {
    const size = opts.size || new THREE.Vector3(4, 0.6, 4);
    const pts = path.map((p) => (p.isVector3 ? p.clone() : new THREE.Vector3(...p)));
    const grp = joint(this.root, [pts[0].x, pts[0].y, pts[0].z]);
    for (const [geo, mt] of platformModel(size, opts.color || '#6f7da0')) part(grp, geo, mt, { receive: true });
    // réacteurs sous la plateforme : flammes animées
    const jets = [];
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      // flamme accrochée à la bouche de la tuyère : la géométrie part de sa base, le scintillement l'allonge vers le bas
    jets.push(part(grp, jetGeo(), glow('#7fd8ff', 2.5), { p: [sx * (size.x / 2 - 0.5), -size.y / 2 - 0.38, sz * (size.z / 2 - 0.5)], r: [Math.PI, 0, 0], shadow: false }));
    }
    const col = new BoxCollider(grp.position, size.clone().multiplyScalar(0.5), null, { dynamic: true, surface: 'metal' });
    this.world.add(col);
    const pl = { grp, col, pts, size, speed: opts.speed || 3, wait: opts.wait ?? 1, seg: 0, segT: 0, waitT: opts.wait ?? 1, dir: 1, jets, rotSpeed: opts.rotSpeed || 0, t: 0, loop: !!opts.loop, active: opts.active !== false };
    // longueurs de segments
    this.platforms.push(pl);
    return pl;
  }

  // ----------------------------------------------------------- borne de sauvegarde
  checkpoint(pos, yaw = 0) {
    const grp = joint(this.root, [pos.x, pos.y, pos.z]);
    const cm = checkpointModel();
    for (const [geo, mt] of cm) part(grp, geo, mt, { receive: true });
    // semelle octogonale sous le gradin bas quand le sol descend (pente, bord de dalle)
    grp.updateMatrixWorld(true);
    const gap = groundGap(this.world, grp.matrixWorld, [[0, 0], ...Array.from({ length: 8 }, (_, i) => [Math.sin(i * Math.PI / 4 + Math.PI / 8) * 0.68, Math.cos(i * Math.PI / 4 + Math.PI / 8) * 0.68])]);
    if (gap > 0.01) {
      const hh = Math.ceil((gap + 0.06) * 100) / 100;
      const sg = G.cyl(0.68, 0.7, hh, 8).toNonIndexed().rotateY(Math.PI / 8).translate(0, 0.005 - hh / 2, 0);
      grime(sg, -hh, 0.1, 0.4);
      part(grp, sg, cm[0][1], { receive: true });
    }
    const lamp =part(grp, G.ico(0.185, 2), glow('#ff5a4a', 2.5), { p: [0, 2.62, 0] });
    const fgeo = new THREE.PlaneGeometry(0.95, 0.6, 12, 6).translate(0.475, 0, 0);
    const flag = part(grp, fgeo, flagMat('#ff5a4a'), { p: [0.08, 2.05, 0] });
    const stripe = part(flag, new THREE.PlaneGeometry(0.95, 0.12, 12, 1).translate(0.475, 0, 0.004), mat('#ffffff', { rough: 0.75, side: THREE.DoubleSide }), { p: [0, -0.1, 0] });
    stripe.visible = false;
    const base = fgeo.attributes.position.array.slice();
    const cp = { pos: pos.clone(), yaw, grp, lamp, flag, base, active: false, t: Math.random() * 5 };
    cp.light = lights.add({ obj: lamp, offset: new THREE.Vector3(0, 0.3, 0), color: '#ff5a4a', intensity: 6, range: 6, priority: 0.9 });
    this.checkpoints.push(cp);
    return cp;
  }
  activateCheckpoint(cp, silent) {
    const g = this.game;
    if (cp.active) return;
    for (const c of this.checkpoints) if (c !== cp && c.active) {
      c.active = false;
      c.lamp.material = glow('#ff5a4a', 2.5);
      c.light.color.set('#ff5a4a');
      c.flag.material = flagMat('#ff5a4a');
    }
    cp.active = true;
    cp.lamp.material = glow('#4dffa0', 3);
    cp.light.color.set('#4dffa0');
    cp.flag.material = flagMat('#2fd08a');
    g.level.checkpoint = { pos: cp.pos.clone().add(new THREE.Vector3(0, 0.2, 0)), yaw: cp.yaw };
    if (!silent) {
      g.audio.play('checkpoint');
      g.fx.ring(cp.pos, '#4dffa0', 4, 0.6);
      g.fx.sparks(_v.copy(cp.pos).setY(cp.pos.y + 2.5), UP, 20, '#4dffa0', 7);
      g.hud.toast('Point de contrôle', 1.6, 'cp');
      g.save();
    }
  }

  // ----------------------------------------------------------- Bazar Pétarade
  vendor(pos, yaw = 0) {
    const grp = joint(this.root, [pos.x, pos.y, pos.z]);
    grp.rotation.y = yaw;
    const vm = vendorModel();
    for (const [geo, mt] of vm.parts) part(grp, geo, mt, { receive: true });
    // semelle sous le socle quand le sol descend (même arrondi que le socle, haut caché dedans)
    grp.updateMatrixWorld(true);
    const gap = groundGap(this.world, grp.matrixWorld, [[0, 0], ...rectPts(2.4, 1.6)]);
    if (gap > 0.01) {
      const hh = Math.ceil((gap + 0.19) * 100) / 100;
      const sg = rboxAt(2.4, hh, 1.6, 0.07, 0, 0.14 - hh / 2, 0);
      grime(sg, 0.14 - hh, 0.2, 0.4);
      part(grp, sg, vm.parts[2][1], { receive: true });
    }
    const screen = part(grp, vm.screen, glow('#3ef2ff', 0.9), { shadow: false });
    // enseigne
    const sign = this.textBoard('BAZAR PÉTARADE', 2.6, 0.55, { bg: '#26233a', fg: '#ffd23a', border: '#ff4f6d' });
    sign.position.set(0, 3.35, 0.0);
    grp.add(sign);
    // hologramme rotatif
    const holo = joint(grp, [0, 3.0, 0.9]);
    const holoMat = new THREE.MeshBasicMaterial({ color: '#7ff3ff', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    part(holo, G.nut(0.35, 0.12), holoMat, { shadow: false });
    // lampes d'angle et guirlande d'ampoules du fronton
    part(grp, vm.bulbs, glow('#ffd23a', 3), { shadow: false });
    lights.add({ obj: grp, offset: new THREE.Vector3(0, 1.9, 1.3), color: '#7fe6ff', intensity: 16, range: 7, priority: 1.3 });
    const col = new BoxCollider(new THREE.Vector3(pos.x, pos.y + 1.4, pos.z), new THREE.Vector3(1.1, 1.4, 0.7), new THREE.Quaternion().setFromAxisAngle(UP, yaw), { surface: 'metal' });
    this.world.add(col);
    const front = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(1.8).add(pos);
    // balise : colonne de lumière visible de loin, plus vive quand Gigi a du nouveau, effacée de près
    const beam = new THREE.Group();
    beam.position.set(0, 3.7, 0);
    grp.add(beam);
    const beamMat = new THREE.MeshBasicMaterial({ map: beaconTexture(), color: '#ffd23a', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.5, 46, 16, 1, true).translate(0, 23, 0), beamMat);
    const halo = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.3, 46, 16, 1, true).translate(0, 23, 0), beamMat.clone());
    halo.material.color.set('#7ff3ff');
    beam.add(core, halo);
    fxLayer(beam);
    const v = { grp, holo, screen, pos: front, top: new THREE.Vector3(pos.x, pos.y + 3.6, pos.z), beam, t: 0, hail: 0 };
    this.vendors.push(v);
    this.updaters.push((dt, t) => {
      const g = this.game;
      const p = g.player;
      const d = p.pos.distanceTo(v.pos);
      const why = g.shopReason();
      const k = (why ? (why.far ? 1 : 0.7) : 0.35) * clamp((d - 6) / 18, 0, 1);
      core.material.opacity = k * (0.55 + Math.sin(t * 3) * 0.12);
      halo.material.opacity = k * (0.22 + Math.sin(t * 3 + 1) * 0.06);
      beam.visible = k > 0.01;
      // Gigi hèle Kobi quand il passe près du Bazar sans s'y arrêter
      v.hail -= dt;
      if (why && v.hail <= 0 && d > 6 && d < 32 && g.state === 'playing' && p.alive) {
        v.hail = 14;
        g.hud.bubble(v.top.clone().setY(v.top.y + 2), pick(why.far ? HAIL_NEW : HAIL), 3);
        g.audio.play('coin', { pos: v.top, pitch: 1.6, vol: 0.5 });
      }
    });
    this.spinners.push({ obj: holo, speed: 1.5, bob: 0.1 });
    this.game.level.interactables.push({ pos: front, radius: 2.4, label: 'Ouvrir le Bazar Pétarade', action: () => this.game.openVendor() });
    return v;
  }

  // Panneau texte (canvas + police maison)
  textBoard(text, w, h, o = {}) {
    const c = document.createElement('canvas');
    const scale = 256;
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = o.bg || '#2a2438';
    ctx.fillRect(0, 0, c.width, c.height);
    if (o.border) {
      ctx.strokeStyle = o.border;
      ctx.lineWidth = c.height * 0.08;
      ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, c.width - ctx.lineWidth, c.height - ctx.lineWidth);
    }
    ctx.fillStyle = o.fg || '#ffffff';
    const lines = text.split('\n');
    let fs = c.height * (o.size || 0.56) / lines.length;
    ctx.font = `${fs}px "${FONT_TITLE}"`;
    const maxW = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (maxW > c.width * 0.8) { fs *= (c.width * 0.8) / maxW; ctx.font = `${fs}px "${FONT_TITLE}"`; }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, c.width / 2, (c.height * (i + 0.5)) / lines.length + fs * 0.06));
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const m = new THREE.Mesh(G.box(w, h, 0.08), [
      mat(o.bg || '#2a2438'), mat(o.bg || '#2a2438'), mat(o.bg || '#2a2438'), mat(o.bg || '#2a2438'),
      null,
      null,
    ]);
    m.material[4] = m.material[5] = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: o.glow ?? 0.25 });
    m.castShadow = true;
    return m;
  }
  sign(pos, yaw, text, w = 3, h = 1, o = {}) {
    const grp = joint(this.root, [pos.x, pos.y, pos.z]);
    // face propre (sans poteaux ni lisses) tournée vers -z, d'où l'on arrive ; yaw > 0 l'oriente vers +x
    grp.rotation.y = Math.PI - yaw;
    // poteaux équarris à chapeau, lisses clouées derrière le panneau, cadre de liteaux, clous ; fusionnés avec le décor
    const H = o.height ?? 1.6;
    const wt = plankTexture(o.post || '#9a6a42', null, { wear: 0.6, knots: 0.5, seed: 9 });
    const woodM = mat('#ffffff', { map: wt.map, normalMap: wt.normalMap, rough: 0.82 });
    const nailM = mat('#9aa3b8', { rough: 0.35, metal: 0.85 });
    const wood = [], nails = [];
    if (o.posts !== false) {
      const ph = H + h / 2 + 0.14, px = w / 2 - 0.15;
      grp.updateMatrixWorld(true);
      for (const sx of [-1, 1]) {
        // poteau fiché dans le sol : prolongé sous y = 0 jusqu'au terrain (pente) plus 8 cm d'ancrage
        const e = groundGap(this.world, grp.matrixWorld, rectPts(0.15, 0.15, sx * px, -0.15)) + 0.08;
        wood.push(plankBox(0.15, ph + e, 0.15, 1, sx * 0.4).translate(sx * px, (ph - e) / 2, -0.15));
        wood.push(plankBox(0.2, 0.05, 0.2, 1, sx).translate(sx * px, ph + 0.025, -0.15));
      }
      for (const y of [H - h * 0.28, H + h * 0.28]) {
        wood.push(plankBox(w - 0.1, 0.1, 0.05, 1, y).translate(0, y, -0.065));
        rivets(nails, [[-px, y, -0.039], [px, y, -0.039]], [0, 0, 1], 0.018);
      }
    }
    const fz = 0.0;
    for (const sy of [-1, 1]) wood.push(plankBox(w + 0.14, 0.08, 0.1, 1, sy * 0.7).translate(0, H + sy * (h / 2 + 0.04), fz));
    for (const sx of [-1, 1]) wood.push(plankBox(0.08, h, 0.1, 1, sx * 0.2).translate(sx * (w / 2 + 0.04), H, fz));
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) rivets(nails, [[sx * (w / 2 + 0.03), H + sy * (h / 2 + 0.04), fz + 0.051]], [0, 0, 1], 0.016);
    const L = this.game.level;
    grp.updateMatrix();
    L.add(mergeParts(wood), woodM, grp.matrix);
    L.add(mergeParts(nails), nailM, grp.matrix);
    const b = this.textBoard(text, w, h, o);
    b.position.y = H;
    grp.add(b);
    return grp;
  }

  // ----------------------------------------------------------- boulon d'or
  goldBolt(pos, id) {
    const g = this.game;
    if (g.hasGoldBolt(g.level.id, id)) return null;
    const grp = joint(this.root, [pos.x, pos.y, pos.z]);
    const m = part(grp, goldBoltGeo(0.38), mat('#ffcf3a', { rough: 0.15, metal: 1, emissive: '#a06a00', emissiveIntensity: 1.2 }), {});
    const halo = part(grp, G.torus(0.8, 0.04, 6, 32), glow('#ffe27a', 2), { shadow: false });
    lights.add({ obj: grp, color: '#ffc43a', intensity: 14, range: 6, priority: 1.6 });
    const gb = { id, pos: pos.clone(), grp, m, halo, t: 0, taken: false };
    this.goldBolts.push(gb);
    return gb;
  }

  // ----------------------------------------------------------- cristaux d'Orbium (à ramasser une seule fois)
  orbium(pos, id, n = 2) {
    const g = this.game;
    if (g.hasOrbium(g.level.id, id)) return null;
    const grp = joint(this.root, [pos.x, pos.y, pos.z]);
    const crystal = mat('#c06aff', { rough: 0.06, metal: 0.3, emissive: '#7a2ad8', emissiveIntensity: 1.5, flat: true });
    const spin = joint(grp, [0, 0.55, 0]);
    const shapes = [[0, 0, 0, 0.42, 0], [0.32, -0.15, 0.1, 0.26, 0.5], [-0.28, -0.2, -0.12, 0.22, -0.6], [0.05, -0.22, -0.32, 0.18, 0.3]];
    for (const [x, y, z, r, tilt] of shapes) part(spin, new THREE.OctahedronGeometry(r, 0).scale(0.8, 1.5, 0.8), crystal, { p: [x, y, z], r: [tilt, 0, tilt * 0.5] });
    part(grp, G.dodeca(0.38, 0), mat('#4a3a5a', { rough: 0.9 }), { p: [0, 0.05, 0], s: [1.3, 0.45, 1.2] });
    const halo = part(grp, G.torus(0.75, 0.03, 6, 28), glow('#d08aff', 1.8), { p: [0, 0.6, 0], r: [Math.PI / 2, 0, 0], shadow: false });
    lights.add({ obj: grp, offset: new THREE.Vector3(0, 0.7, 0), color: '#b05aff', intensity: 12, range: 6, priority: 1.4 });
    const ob = { id, n, pos: pos.clone(), grp, spin, halo, t: Math.random() * 6, taken: false };
    (this.orbiums || (this.orbiums = [])).push(ob);
    return ob;
  }

  // ----------------------------------------------------------- Magnéto-clé : portes à verrou et blocs aimantés
  // Une porte scellée par un verrou magnétique : un coup de clé l'ouvre si Kobi possède la Magnéto-clé.
  magDoor(pos, yaw = 0, w = 4, h = 4) {
    const grp = joint(this.root, [pos.x, pos.y, pos.z]);
    grp.rotation.y = yaw;
    // cadre fixe (fusionné avec le décor) : piliers sur socles, coulisses, linteau à bande de danger, rivets
    const pm = magMats();
    const frame = [], fsteel = [];
    grp.updateMatrixWorld(true);
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 + 0.3);
      frame.push(rboxAt(0.6, h + 0.6, 0.8, 0.08, x, (h + 0.6) / 2, 0));
      // socle prolongé jusqu'au terrain quand le sol descend sous le pilier (semelle)
      const gap = groundGap(this.world, grp.matrixWorld, [[x, 0], ...rectPts(0.8, 1.0, x)]);
      const sb = gap > 0.01 ? gap + 0.06 : 0;
      frame.push(rboxAt(0.8, 0.4 + sb, 1.0, 0.06, x, 0.2 - sb / 2, 0));
      fsteel.push(G.box(0.07, h, 0.5).toNonIndexed().translate(sx * (w / 2 + 0.035), h / 2, 0));
      for (const z of [1, -1]) {
        const pts = [];
        for (let y = 0.7; y < h + 0.4; y += 0.5) pts.push([x - 0.17, y, z * 0.401], [x + 0.17, y, z * 0.401]);
        rivets(fsteel, pts, [0, 0, z], 0.03);
      }
    }
    // linteau descendu jusqu'au haut du battant (plus de jour de 0,3 m au-dessus de la porte fermée)
    frame.push(rboxAt(w + 1.2, 0.9, 0.8, 0.08, 0, h + 0.45, 0));
    const fband = boxUV(w + 0.9, 0.22, 0.82, 0.5).toNonIndexed().translate(0, h + 0.6, 0);
    grp.updateMatrix();
    this.game.level.add(mergeParts(frame), pm.frame, grp.matrix);
    this.game.level.add(mergeParts(fsteel), pm.steel, grp.matrix);
    this.game.level.add(fband, pm.hazard, grp.matrix);
    // battant mobile : tôle peinte, raidisseurs, nervures rivetées, bande de danger au pied
    const slab = joint(grp, [0, h / 2, 0]);
    for (const [geo, mt] of magSlab(w, h)) part(slab, geo, mt, { receive: true });
    // emblème : aimant en fer à cheval
    const em = joint(slab, [0, 0, 0.24]);
    part(em, G.torus(0.45, 0.13, 8, 20, Math.PI), mat('#ff4f6d', { rough: 0.35, metal: 0.3 }), { r: [0, 0, Math.PI] });
    for (const sx of [-1, 1]) part(em, G.box(0.27, 0.3, 0.27), mat('#e8eef8', { rough: 0.3, metal: 0.8 }), { p: [sx * 0.45, 0.15, 0] });
    const glowM = glow('#3ef2ff', 2);
    // anneau lumineux posé sur la tôle du battant (face à z = 0,17 du battant)
    part(em, G.torus(0.75, 0.04, 6, 28), glowM, { p: [0, 0, -0.035], shadow: false });
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    const col = new BoxCollider(new THREE.Vector3(pos.x, pos.y + h / 2, pos.z), new THREE.Vector3(w / 2, h / 2, 0.3), q, { surface: 'metal' });
    this.world.add(col);
    const m = { kind: 'door', grp, slab, col, h, w, pos: new THREE.Vector3(pos.x, pos.y + h / 2, pos.z), reach: w / 2 + 0.5, open: false, t: 0 };
    (this.magnets || (this.magnets = [])).push(m);
    return m;
  }
  // Bloc aimanté : un coup de Magnéto-clé l'envoie glisser jusqu'à sa place (pont, marche…)
  magBlock(from, to, size = new THREE.Vector3(3, 0.8, 3)) {
    const pl = this.platform([from, to], { size, speed: 4.5, wait: 1e9, active: false, color: '#8a5ad8' });
    const em = joint(pl.grp, [0, size.y / 2 + 0.02, 0]);
    part(em, G.torus(0.45, 0.12, 8, 20, Math.PI), mat('#ff4f6d', { rough: 0.35, metal: 0.3 }), { r: [-Math.PI / 2, 0, 0] });
    part(em, G.torus(0.9, 0.04, 6, 28), glow('#3ef2ff', 2), { r: [Math.PI / 2, 0, 0], shadow: false });
    const m = { kind: 'block', pl, pos: pl.grp.position, reach: Math.max(size.x, size.z) / 2 + 0.6, open: false };
    (this.magnets || (this.magnets = [])).push(m);
    return m;
  }
  magnetHit(m) {
    const g = this.game;
    if (m.open) return;
    if (!g.hasGadget('magneto')) {
      g.audio.play('shieldHit', { pos: m.pos, pitch: 0.7 });
      g.fx.sparks(m.pos, null, 8, '#3ef2ff', 5);
      if (!this._magHint) {
        this._magHint = true;
        g.hud.say([['ecrou', 'Un verrou magnétique… Il nous faudrait une Magnéto-clé pour le faire bouger.']], true);
      }
      return;
    }
    m.open = true;
    g.audio.play('forcefield', { pos: m.pos, pitch: 0.8 });
    g.audio.play('grapple', { pos: m.pos });
    g.fx.ring(m.pos, '#3ef2ff', 3, 0.5);
    g.fx.sparks(m.pos, null, 20, '#3ef2ff', 8);
    if (m.kind === 'block') { m.pl.active = true; m.pl.waitT = 0; }
  }

  // ----------------------------------------------------------- champ de force
  forceField(center, width, height, yaw = 0, opts = {}) {
    const grp = joint(this.root, [center.x, center.y, center.z]);
    grp.rotation.y = yaw;
    const fieldMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(opts.color || '#ff3a8a') }, uAlpha: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float uTime; uniform vec3 uColor; uniform float uAlpha; varying vec2 vUv;
        void main(){
          vec2 p = vUv * vec2(${(width / 1.2).toFixed(1)}, ${(height / 1.2).toFixed(1)});
          vec2 h = abs(fract(p + vec2(0.0, uTime * 0.3)) - 0.5);
          float hex = smoothstep(0.42, 0.5, max(h.x, h.y));
          float scan = 0.5 + 0.5 * sin(vUv.y * 40.0 - uTime * 6.0);
          float edge = smoothstep(0.92, 1.0, max(abs(vUv.x - 0.5), abs(vUv.y - 0.5)) * 2.0);
          float a = (0.18 + hex * 0.5 + scan * 0.12 + edge) * uAlpha;
          gl_FragColor = vec4(uColor * (1.5 + hex * 2.0), a);
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    const plane = part(grp, new THREE.PlaneGeometry(width, height), fieldMat, { p: [0, height / 2, 0], shadow: false });
    // pylônes émetteurs (fusionnés avec le décor) : socle, fût peint à bande de danger, chapeau et dôme lumineux
    const pm = magMats();
    const posts = [], psteel = [], bands = [], domes = [];
    grp.updateMatrixWorld(true);
    for (const s of [-1, 1]) {
      const x = s * (width / 2 + 0.25);
      part(grp, G.box(0.12, height, 0.55), glow(opts.color || '#ff3a8a', 2), { p: [s * (width / 2 + 0.05), height / 2, 0] });
      posts.push(rboxAt(0.5, height + 0.6, 0.5, 0.06, x, (height + 0.6) / 2, 0));
      // embase prolongée jusqu'au terrain quand le sol descend sous le pylône (semelle)
      const gap = groundGap(this.world, grp.matrixWorld, [[x, 0], ...rectPts(0.8, 0.8, x)]);
      const sb = gap > 0.01 ? gap + 0.06 : 0;
      posts.push(rboxAt(0.8, 0.32 + sb, 0.8, 0.06, x, 0.16 - sb / 2, 0));
      posts.push(rboxAt(0.66, 0.2, 0.66, 0.05, x, height + 0.6, 0));
      bands.push(boxUV(0.52, 0.32, 0.52, 0.8).toNonIndexed().translate(x, 0.55, 0));
      domes.push(G.sphere(0.16, 12, 6).toNonIndexed().translate(x, height + 0.72, 0));
      for (const z of [1, -1]) rivets(psteel, [[x - 0.15, 0.85, z * 0.251], [x + 0.15, 0.85, z * 0.251], [x - 0.15, height + 0.2, z * 0.251], [x + 0.15, height + 0.2, z * 0.251]], [0, 0, z], 0.025);
      rivets(psteel, [[x + s * 0.251, 0.85, 0], [x + s * 0.251, height + 0.2, 0]], [s, 0, 0], 0.025);
    }
    grp.updateMatrix();
    this.game.level.add(mergeParts(posts), pm.frame, grp.matrix);
    this.game.level.add(mergeParts(psteel), pm.steel, grp.matrix);
    this.game.level.add(mergeParts(bands), pm.hazard, grp.matrix);
    this.game.level.add(mergeParts(domes), glow(opts.color || '#ff3a8a', 2.2), grp.matrix);
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    const col = new BoxCollider(new THREE.Vector3(center.x, center.y + height / 2, center.z), new THREE.Vector3(width / 2, height / 2, 0.3), q, { surface: 'metal', tag: 'field' });
    const ff = { grp, plane, mat: fieldMat, col, on: false, alpha: 0 };
    if (opts.on !== false) this.setField(ff, true, true);
    else { plane.visible = false; }
    this.fields.push(ff);
    return ff;
  }
  setField(ff, on, silent) {
    if (ff.on === on) return;
    ff.on = on;
    if (on) { this.world.add(ff.col); ff.plane.visible = true; }
    else this.world.remove(ff.col);
    if (!silent) this.game.audio.play('forcefield', { pos: ff.grp.position, pitch: on ? 1.2 : 0.8 });
  }

  // ----------------------------------------------------------- lave / métal en fusion (et acide)
  // Surface du système d'eau (croûte qui dérive, lueur, brume de chaleur ; ou acide bouillonnant) + collision
  // qui brûle. opts : { type: 'lave' | 'acide', preset ('metal'…), damage, spark }
  lava(center, w, d, opts = {}) {
    const o = { rect: [center.x - w / 2, center.z - d / 2, w, d], y: center.y, type: opts.type || 'lave', preset: opts.preset };
    const body = createWater(this.game.level, o);
    const col = new BoxCollider(new THREE.Vector3(center.x, center.y - 1, center.z), new THREE.Vector3(w / 2, 1, d / 2), null, { tag: 'lava', surface: 'lava', user: { damage: opts.damage ?? 18, spark: opts.spark }, blocksCamera: false });
    this.world.add(col);
    this.lavas.push({ mesh: body.mesh, body, center: center.clone(), w, d });
    // lumière de la coulée : suit le point de la nappe le plus proche de Kobi (source étendue)
    lights.add({ pos: new THREE.Vector3(center.x, center.y + 2.2, center.z), area: [w, d], color: opts.light || '#ff7424', intensity: 32, range: 12, decay: 1, flicker: 0.12, priority: 2.5 });
    return body.mesh;
  }

  // ----------------------------------------------------------- mise à jour
  update(dt) {
    const g = this.game;
    const t = g.time;
    const p = g.player;
    for (const c of this.crates) {
      if (!c.alive) continue;
      if (c.squash > 0) {
        c.squash = Math.max(0, c.squash - dt * 5);
        const s = 1 + Math.sin(c.squash * 12) * c.squash * 0.15;
        c.mesh.scale.set(s, 2 - s, s);
      }
      if (c.fuse >= 0) {
        c.fuse -= dt;
        c.mesh.scale.setScalar(1 + Math.sin(t * 40) * 0.06);
        if (Math.random() < 0.5) g.fx.sparks(_v.copy(c.pos).setY(c.pos.y + c.size * 0.6), UP, 1, '#ffd36b', 3);
        if (c.fuse <= 0) this.breakCrate(c);
      }
    }
    for (const pad of this.pads) {
      pad.t = Math.max(0, pad.t - dt);
      const s = 1 + Math.sin(pad.t * 25) * pad.t * 0.6;
      pad.top.scale.set(1, s, 1);
      pad.arrows.position.y = 0.45 + ((t * 1.2) % 1) * 0.3;
      pad.arrows.children.forEach((a, i) => { a.position.y = (((t * 1.5 + i / 3) % 1)) * 1.2; a.scale.setScalar(1 - ((t * 1.5 + i / 3) % 1) * 0.6); });
    }
    for (const gp of this.grapples) {
      gp.t += dt;
      gp.hl = damp(gp.hl, gp.hlTarget || 0, 10, dt);
      gp.outer.rotation.z = gp.t * 0.8;
      gp.halo.rotation.x = gp.t * 1.3;
      gp.halo.rotation.y = gp.t;
      gp.grp.scale.setScalar(1 + gp.hl * 0.25 + (gp.pingT > 0 ? gp.pingT : 0));
      gp.core.scale.setScalar(1 + Math.sin(gp.t * 5) * 0.1 + gp.hl * 0.4);
      gp.grp.lookAt(g.camera.cam.position);
      if (gp.pingT > 0) gp.pingT -= dt;
    }
    for (const pl of this.platforms) {
      const old = _v.copy(pl.grp.position);
      if (pl.active && pl.pts.length > 1) {
        if (pl.waitT > 0) pl.waitT -= dt;
        else {
          const a = pl.pts[pl.seg], b = pl.pts[pl.seg + pl.dir] || pl.pts[pl.seg];
          const L = a.distanceTo(b) || 1;
          pl.segT += (pl.speed * dt) / L;
          if (pl.segT >= 1) {
            pl.segT = 0;
            pl.seg += pl.dir;
            if (pl.seg + pl.dir >= pl.pts.length || pl.seg + pl.dir < 0) {
              if (pl.loop) { pl.seg = 0; }
              else pl.dir *= -1;
            }
            pl.waitT = pl.wait;
          }
          const a2 = pl.pts[pl.seg], b2 = pl.pts[pl.seg + pl.dir] || a2;
          const e = pl.segT * pl.segT * (3 - 2 * pl.segT);
          pl.grp.position.lerpVectors(a2, b2, e);
        }
      }
      pl.grp.position.y += Math.sin(t * 2 + pl.pts[0].x) * 0.002;
      let dy = 0;
      if (pl.rotSpeed) {
        dy = pl.rotSpeed * dt;
        pl.grp.rotation.y += dy;
      }
      pl.col.center.copy(pl.grp.position);
      pl.col.quat.setFromEuler(pl.grp.rotation);
      pl.col.update();
      pl.col.deltaPos.subVectors(pl.grp.position, old);
      pl.col.deltaYaw = dy;
      pl.col.pivot.copy(pl.grp.position);
      for (const j of pl.jets) j.scale.set(1, 0.8 + Math.random() * 0.4, 1);
    }
    for (const cp of this.checkpoints) {
      cp.t += dt;
      // ondulation du tissu (calcul léger, quelques dizaines de sommets)
      const fa = cp.flag.geometry.attributes.position;
      for (let i = 0; i < fa.count; i++) {
        const x = cp.base[i * 3], y = cp.base[i * 3 + 1];
        fa.array[i * 3 + 2] = Math.sin(x * 7 - cp.t * 7 + y * 2) * 0.09 * x;
        fa.array[i * 3 + 1] = y - x * 0.08 + Math.sin(x * 5 - cp.t * 5) * 0.02 * x;
      }
      fa.needsUpdate = true;
      cp.flag.geometry.computeVertexNormals();
      cp.lamp.scale.setScalar(1 + Math.sin(cp.t * 4) * 0.1);
      if (!cp.active && p.alive && cp.pos.distanceTo(p.pos) < 3) this.activateCheckpoint(cp);
    }
    for (const gb of this.goldBolts) {
      if (gb.taken) continue;
      gb.t += dt;
      gb.m.rotation.y = gb.t * 2;
      gb.m.rotation.z = Math.sin(gb.t) * 0.3;
      gb.grp.position.y = gb.pos.y + Math.sin(gb.t * 2) * 0.2;
      gb.halo.rotation.x = Math.PI / 2 + Math.sin(gb.t) * 0.3;
      gb.halo.scale.setScalar(1 + Math.sin(gb.t * 3) * 0.1);
      if (Math.random() < dt * 8) g.fx.trail(_v.copy(gb.pos).add(new THREE.Vector3(rand(-0.6, 0.6), rand(-0.4, 0.8), rand(-0.6, 0.6))), '#ffe27a', 0.35, 0.6, 1);
      if (p.alive && gb.pos.distanceTo(_v2.copy(p.pos).setY(p.pos.y + 0.8)) < 1.6) {
        gb.taken = true;
        gb.grp.parent && gb.grp.parent.remove(gb.grp);
        g.collectGoldBolt(gb.id, gb.pos);
      }
    }
    for (const m of this.magnets || []) {
      if (m.kind !== 'door' || !m.open || m.t >= 1) continue;
      m.t = Math.min(1, m.t + dt / 0.9);
      m.slab.position.y = m.h / 2 + (m.h + 0.2) * (1 - Math.pow(1 - m.t, 3));
      if (Math.random() < 0.5) g.fx.dust(m.pos.clone().setY(m.pos.y - m.h / 2), 1, '#bfb8d0', 2, 0.8);
      if (m.t >= 1 && m.col) { this.world.remove(m.col); m.col = null; }
    }
    for (const ob of this.orbiums || []) {
      if (ob.taken) continue;
      ob.t += dt;
      ob.spin.rotation.y = ob.t * 0.8;
      ob.spin.position.y = 0.55 + Math.sin(ob.t * 2) * 0.08;
      ob.halo.scale.setScalar(1 + Math.sin(ob.t * 3) * 0.12);
      if (Math.random() < dt * 6) g.fx.trail(_v.copy(ob.pos).add(new THREE.Vector3(rand(-0.5, 0.5), rand(0.2, 1.1), rand(-0.5, 0.5))), '#d08aff', 0.3, 0.5, 1);
      if (p.alive && ob.pos.distanceTo(_v2.copy(p.pos).setY(p.pos.y + 0.5)) < 1.7) {
        ob.taken = true;
        ob.grp.parent && ob.grp.parent.remove(ob.grp);
        g.collectOrbium(ob.id, ob.pos, ob.n);
      }
    }
    for (const ff of this.fields) {
      ff.mat.uniforms.uTime.value = t;
      ff.alpha = damp(ff.alpha, ff.on ? 1 : 0, 6, dt);
      ff.mat.uniforms.uAlpha.value = ff.alpha;
      ff.plane.visible = ff.alpha > 0.02;
    }
    for (const s of this.spinners) {
      s.obj.rotation.y += s.speed * dt;
      if (s.bob) s.obj.position.y += Math.sin(t * 2) * s.bob * dt;
    }
    for (const u of this.updaters) u(dt, t);
  }
}
