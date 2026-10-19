import * as THREE from 'three';
import { G, part, joint, mtx, mergeGeometries } from '../geo.js';
import { mat, glow } from '../../engine/materials.js';
import { paintedMetalTexture, hazardTexture } from '../../engine/textures.js';
import { OL, rig } from './common.js';

// ===================================================================== Grosbras (mini-boss de Brikka)
// Contremaître de chantier : torse-chaudière rivetée en tôle jaune écaillée, casque de chantier à gyrophare grillagé,
// poings en fonte aux phalanges blindées, marteau-pilon à vérins. Corps sculpté (formes, peinture, crasse) + pièces
// rigides texturées fusionnées par os et par matériau (rivets, manomètres, cheminées, durites, plaques).

const YEL = '#f4b120', ORA = '#e2592a', DARK = '#3a3546';

// ------------------------------------------------------------------ matières (créées une fois)
let MT = null;
function mats() {
  if (MT) return MT;
  const tex = (t, o) => mat('#ffffff', { map: t.map, normalMap: t.normalMap, ...o });
  const pm = (c, k, o) => paintedMetalTexture(texCol(c), k, o);
  // « Box » : usure aux arêtes des faces (boîtes) ; « C » : écaillage diffus sans arêtes (cylindres, coques)
  const hz = hazardTexture();
  MT = {
    yellow: tex(pm(YEL, 'gb-y', { chip: 0.3, edge: 0.75, rust: 0.25 }), { rough: 0.5, metal: 0.35, coat: 0.6 }),
    // (double face : le casque arraché à la mort montre son intérieur)
    yellowC: tex(pm(YEL, 'gb-yc', { chip: 0.42, edge: 0, rust: 0.18, tile: 2 }), { rough: 0.5, metal: 0.35, coat: 0.6, side: THREE.DoubleSide }),
    orange: tex(pm(ORA, 'gb-o', { chip: 0.35, edge: 0.8, rust: 0.3 }), { rough: 0.5, metal: 0.35, coat: 0.5 }),
    orangeC: tex(pm(ORA, 'gb-oc', { chip: 0.45, edge: 0, rust: 0.25, tile: 2 }), { rough: 0.5, metal: 0.35, coat: 0.5 }),
    dark: tex(pm(DARK, 'gb-d', { chip: 0.45, edge: 0.85, rust: 0.35, bare: '#9a9ca6' }), { rough: 0.5, metal: 0.6, coat: 0.15 }),
    darkC: tex(pm(DARK, 'gb-dc', { chip: 0.5, edge: 0, rust: 0.3, bare: '#9a9ca6', tile: 2 }), { rough: 0.5, metal: 0.6, coat: 0.15 }),
    hazard: mat('#ffffff', { map: hz.map, normalMap: hz.normalMap, rough: 0.55, metal: 0.3, coat: 0.5 }),
    steel: mat('#c4ccd8', { rough: 0.28, metal: 0.95 }),
    brass: mat('#d9a54c', { rough: 0.3, metal: 0.9, coat: 0.3 }),
    rubber: mat('#26222b', { rough: 0.72, metal: 0.05 }),
    dial: mat('#ffffff', { map: dialTexture(), rough: 0.25, coat: 1 }),
    plates: mat('#ffffff', { map: plateAtlas(), rough: 0.5, metal: 0.3, coat: 0.4 }),
    eye: glow('#ffb43a', 3.2),
    beacon: glow('#ff6a1a', 3.4),
    fire: glow('#ff5a14', 3.2),
  };
  return MT;
}

// les générateurs de textures écrivent la couleur linéaire telle quelle dans le canevas sRVB : on la pré-encode
// pour que la tôle peinte ait la même teinte que la sculpture
function texCol(h) {
  const c = new THREE.Color(h);
  return '#' + new THREE.Color().setRGB(...c.clone().convertLinearToSRGB().toArray(), THREE.LinearSRGBColorSpace).getHexString();
}

// cadran de manomètre : graduations, zone rouge (l'aiguille y est, évidemment)
function dialTexture() {
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = '#efe4c8'; x.fillRect(0, 0, S, S);
  x.translate(S / 2, S / 2);
  x.lineCap = 'butt';
  x.strokeStyle = '#d63a2a'; x.lineWidth = 12;
  x.beginPath(); x.arc(0, 0, 47, -0.15 * Math.PI, 0.25 * Math.PI); x.stroke();
  x.strokeStyle = '#2a2430';
  for (let i = 0; i <= 20; i++) {
    const a = 0.75 * Math.PI + (i / 20) * 1.5 * Math.PI, big = i % 5 === 0;
    x.lineWidth = big ? 4 : 2;
    x.beginPath(); x.moveTo(Math.cos(a) * (big ? 38 : 44), Math.sin(a) * (big ? 38 : 44)); x.lineTo(Math.cos(a) * 54, Math.sin(a) * 54); x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.userData.shared = true;
  return t;
}

// planche de plaques peintes au pochoir (une seule texture) : zones [u0, v0, u1, v1] lues par plate()
const PLATE = { n07: [0, 0, 0.5, 1], ton: [0.5, 0, 1, 0.5], chef: [0.5, 0.5, 1, 1] };
function plateAtlas() {
  const W = 512, H = 256, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const font = (px) => `bold ${px}px Impact, "Arial Black", sans-serif`;
  const panel = (px, py, w, h, bg, edge) => {
    x.fillStyle = bg; x.fillRect(px, py, w, h);
    x.strokeStyle = edge; x.lineWidth = 6; x.strokeRect(px + 7, py + 7, w - 14, h - 14);
    x.fillStyle = edge;
    for (const [rx, ry] of [[16, 16], [w - 16, 16], [16, h - 16], [w - 16, h - 16]]) { x.beginPath(); x.arc(px + rx, py + ry, 5, 0, Math.PI * 2); x.fill(); }
  };
  const text = (s, cx, cy, px, col) => { x.fillStyle = col; x.font = font(px); x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(s, cx, cy); };
  // « 07 » : numéro du contremaître, jaune sur tôle sombre
  panel(0, 0, 256, 256, '#3a3546', '#f4b120');
  text('07', 128, 136, 170, '#f4b120');
  // « 10 T » : poids du marteau, noir sur jaune
  panel(256, 0, 256, 128, '#f4b120', '#1d1a22');
  text('10 T', 384, 68, 92, '#1d1a22');
  // « CHEF » : autocollant du casque, blanc liseré violet Vorax
  panel(256, 128, 256, 128, '#f2efe6', '#5a2bb0');
  text('CHEF', 384, 196, 84, '#3a1470');
  // usure : éclats, rayures et crasse
  let s = 7;
  const R = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 260; i++) {
    x.fillStyle = R() < 0.6 ? 'rgba(40,32,28,0.35)' : 'rgba(190,190,195,0.5)';
    const r = 1 + R() * 3.5;
    x.beginPath(); x.ellipse(R() * W, R() * H, r * (1 + R()), r, R() * 3, 0, Math.PI * 2); x.fill();
  }
  x.strokeStyle = 'rgba(220,220,225,0.35)'; x.lineWidth = 1;
  for (let i = 0; i < 40; i++) { const px = R() * W, py = R() * H, a = R() * 6; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * 30, py + Math.sin(a) * 30); x.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.userData.shared = true;
  return t;
}

// ------------------------------------------------------------------ géométries d'appoint
const _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3();
// rivet bombé tourné vers +y
const rivetGeo = (r) => new THREE.SphereGeometry(r, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1);
// boulon sans tige (tête hexagonale + rondelle), tourné vers +y : moitié moins de triangles que G.bolt
const BOLTS = new Map();
function bolt(r) {
  if (!BOLTS.has(r)) {
    const h = new THREE.CylinderGeometry(r, r, r * 0.7, 6).translate(0, r * 0.35, 0).toNonIndexed();
    const w = new THREE.CylinderGeometry(r * 1.15, r * 1.15, r * 0.12, 10).translate(0, -r * 0.05, 0).toNonIndexed();
    BOLTS.set(r, mergeGeometries([h, w]));
  }
  return BOLTS.get(r).clone();
}
// cylindre de a à b (rayons r0 côté a, r1 côté b)
function tube(a, b, r0, r1 = r0, seg = 10, open = false) {
  _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const g = new THREE.CylinderGeometry(r1, r0, _d.length(), seg, 1, open);
  g.applyQuaternion(_q.setFromUnitVectors(_up, _d.normalize()));
  return g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
}
// durite : tuyau souple le long d'une courbe
const hose = (pts, r, seg = 18) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), seg, r, 7, false);
// géométrie tournée de +y vers la normale n puis posée en p
function onto(g, p, n, spin = 0) {
  if (spin) g.rotateY(spin);
  g.applyQuaternion(_q.setFromUnitVectors(_up, _d.set(n[0], n[1], n[2]).normalize()));
  return g.translate(p[0], p[1], p[2]);
}
// plaque peinte de la planche : plan (face +z) aux UV de la zone
function plate(w, h, zone, sx = 1, sy = 1) {
  const g = new THREE.PlaneGeometry(w, h, sx, sy);
  const [u0, v0, u1, v1] = PLATE[zone], uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), 1 - (v1 - uv.getY(i) * (v1 - v0)));
  return g;
}
// bande cylindrique (texture rayée) : UV en mètres / tuile
function band(rx, rz, h, tileM, seg = 56, th0 = 0, thL = Math.PI * 2) {
  const g = new THREE.CylinderGeometry(1, 1, h, seg, 1, true, th0, thL).scale(rx, 1, rz);
  const L = thL * (rx + rz) / 2, uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * L / tileM, uv.getY(i) * h / tileM);
  return g;
}
// point et normale d'une ellipse horizontale (demi-axes a, b) à l'angle t (0 = +z, sens de x positif)
function ellAt(a, b, t, y, off = 0) {
  const x = Math.sin(t) * a, z = Math.cos(t) * b;
  const nx = x / (a * a), nz = z / (b * b), l = Math.hypot(nx, nz);
  return { p: [x + (nx / l) * off, y, z + (nz / l) * off], n: [nx / l, 0, nz / l] };
}

// Pièces rigides : fusionnées par (os, matériau) en un maillage ; géométries calculées une seule fois (cache)
const GEO = new Map();
function kit() {
  const groups = new Map();
  const fresh = !GEO.size;
  return {
    // g : géométrie (déjà placée, ou placée par o = { p, r, s }) ; name : nom stable de l'os pour le cache
    add(name, bone, material, g, o) {
      const key = name + '|' + material.uuid;
      let e = groups.get(key);
      if (!e) groups.set(key, (e = { name, bone, material, list: [] }));
      if (!fresh) return;
      let c = g.index ? g.toNonIndexed() : g.clone();
      if (o) c.applyMatrix4(mtx(o.p, o.r, o.s ?? 1));
      for (const k of Object.keys(c.attributes)) if (!['position', 'normal', 'uv'].includes(k)) c.deleteAttribute(k);
      e.list.push(c);
    },
    done(outlined = []) {
      let i = 0;
      for (const e of groups.values()) {
        const k = 'g' + i++;
        let g = GEO.get(k);
        if (!g) {
          g = mergeGeometries(e.list);
          g.userData.shared = true;
          for (const c of e.list) c.dispose();
          GEO.set(k, g);
        }
        const ol = outlined.some(([n, m]) => n === e.name && m === e.material);
        part(e.bone, g, e.material, { outline: ol ? OL : false });
      }
    },
  };
}

export function grosbras() {
  const M = mats();
  const { S, root, B, skin } = rig({
    yellow: { color: YEL, rough: 0.45, metal: 0.35, sheen: 0.15, coat: 0.7 },
    yellowW: { color: '#c48a26', rough: 0.62, metal: 0.3, coat: 0.25 },
    orange: { color: ORA, rough: 0.45, metal: 0.35, coat: 0.7 },
    dark: { color: DARK, rough: 0.42, metal: 0.6, coat: 0.15 },
    iron: { color: '#77737f', rough: 0.55, metal: 0.4, coat: 0.1 },
    bare: { color: '#a3a19c', rough: 0.35, metal: 0.85 },
    steel: { color: '#a9b2c2', rough: 0.3, metal: 0.9 },
    black: { color: '#1d1a22', rough: 0.65 },
    rust: { color: '#8a4424', rough: 0.85, metal: 0.25 },
    grime: { color: '#4a3a2e', rough: 0.9, metal: 0.1 },
  });
  const K = kit();

  // ---------------------------------------------------------------- bassin et ceinture à outils
  const hips = B(root, [0, 1.3, 0], 'hips');
  S.add(hips, { t: 'ell', r: [0.74, 0.4, 0.58], col: 'dark', k: 0.1 });
  S.add(hips, { t: 'torus', R: 0.66, r: 0.085, sc: [1.12, 1, 0.94], p: [0, 0.02, 0], col: 'black', k: 0.03 });
  S.paint(hips, { t: 'box', s: [1, 0.25, 1], p: [0, -0.4, 0], col: 'grime', feather: 0.12, fuzz: [0.05, 7] });
  K.add('hips', hips, M.brass, G.rbox(0.26, 0.2, 0.06, 0.025), { p: [0, 0.02, 0.66] });
  K.add('hips', hips, M.dark, G.rbox(0.14, 0.11, 0.07, 0.02), { p: [0, 0.02, 0.69] });
  for (const s of [-1, 1]) {
    // sacoches de ceinture
    const a = s * 1.05;
    K.add('hips', hips, M.dark, G.rbox(0.26, 0.28, 0.16, 0.04), { p: [Math.sin(a) * 0.8, -0.08, Math.cos(a) * 0.66], r: [0, a, 0] });
    K.add('hips', hips, M.orange, G.rbox(0.27, 0.09, 0.17, 0.03), { p: [Math.sin(a) * 0.81, 0.04, Math.cos(a) * 0.67], r: [0, a, 0] });
  }
  // grosse clé plate pendue à la hanche gauche
  K.add('hips', hips, M.steel, G.rbox(0.07, 0.5, 0.03, 0.015), { p: [-0.86, -0.3, 0.3], r: [0, -1.1, 0.15] });
  K.add('hips', hips, M.steel, G.torus(0.08, 0.025, 5, 12, Math.PI * 1.5), { p: [-0.89, -0.58, 0.31], r: [0, -1.1, -Math.PI * 0.6] });

  // ---------------------------------------------------------------- torse-chaudière
  const torso = B(hips, [0, 0.3, 0], 'torso');
  // virole (fût elliptique), fonds bombés en haut et en bas : les jonctions sont couvertes de cerclages rivetés
  S.add(torso, { t: 'cyl', r: 1, h: 0.5, round: 0.1, sc: [1.28, 1, 0.98], p: [0, 0.72, 0], col: 'yellow', k: 0.05 });
  S.add(torso, { t: 'ell', r: [1.3, 0.66, 1.0], p: [0, 1.2, 0], col: 'yellow', k: 0.08 });
  S.add(torso, { t: 'ell', r: [1.24, 0.42, 0.95], p: [0, 0.24, 0], col: 'yellowW', k: 0.08 });
  for (const [y, a, b] of [[1.2, 1.3, 1.0], [0.24, 1.25, 0.96]]) S.add(torso, { t: 'torus', R: 1, r: 0.05, sc: [a, 1, b], p: [0, y, 0], col: 'yellowW', k: 0.02 });
  // collerette du cou et joint caoutchouc
  S.add(torso, { t: 'torus', R: 0.36, r: 0.075, p: [0, 1.74, 0.6], rot: [-0.55, 0, 0], col: 'dark', k: 0.04 });
  // porte du foyer (cadre sombre, foyer creusé) au ventre
  S.add(torso, { t: 'cyl', r: 0.34, h: 0.05, round: 0.03, rot: [Math.PI / 2, 0, 0], p: [0, 0.78, 0.97], col: 'dark', k: 0.03 });
  S.sub(torso, { t: 'cyl', r: 0.25, h: 0.12, round: 0.02, rot: [Math.PI / 2, 0, 0], p: [0, 0.78, 1.04], col: 'black', k: 0.02 });
  // trappe de visite dans le dos
  S.add(torso, { t: 'box', s: [0.4, 0.34, 0.08], round: 0.05, p: [0, 0.74, -0.94], col: 'dark', k: 0.03 });
  // fond du ventre : crasse, rouille sous les rivets
  S.paint(torso, { t: 'ell', r: [1.5, 0.42, 1.2], p: [0, -0.05, 0], col: 'grime', feather: 0.14, fuzz: [0.06, 6] });
  for (let i = 0; i < 16; i++) {
    const t = (i / 16) * Math.PI * 2 + 0.2 * Math.sin(i * 3.1);
    const len = 0.1 + ((i * 37) % 7) * 0.025;
    S.paint(torso, { t: 'box', s: [0.022, len, 0.25], round: 0.01, p: [Math.sin(t) * 1.3, 1.12 - len, Math.cos(t) * 1.0], rot: [0, t, 0], col: 'rust', feather: 0.02, fuzz: [0.015, 14] });
  }
  // éclats de peinture (métal nu) sur les arêtes exposées
  for (const [x, y, z, r] of [[0.9, 1.55, 0.45, 0.07], [-1.05, 1.42, 0.35, 0.06], [0.35, 1.78, 0.5, 0.05], [-0.4, 0.35, 0.86, 0.06], [1.15, 0.5, -0.4, 0.07], [-0.7, 1.7, -0.5, 0.06]]) {
    S.paint(torso, { t: 'sph', r, p: [x, y, z], col: 'bare', feather: 0.015, fuzz: [0.025, 18] });
  }

  // rivets des cerclages, couvre-joints verticaux
  const rv = rivetGeo(0.032);
  for (const [y, a, b, n] of [[1.2, 1.3, 1.0, 44], [0.24, 1.25, 0.96, 40]]) {
    for (let i = 0; i < n; i++) {
      const { p, n: nn } = ellAt(a, b, (i / n) * Math.PI * 2, y, 0.048);
      K.add('torso', torso, M.steel, onto(rv.clone(), p, nn));
    }
  }
  for (const t of [Math.PI, Math.PI * 0.62, -Math.PI * 0.62]) {
    const { p, n } = ellAt(1.29, 0.99, t, 0.72, 0);
    K.add('torso', torso, M.yellow, G.rbox(0.14, 0.86, 0.03, 0.012).clone().rotateY(Math.atan2(n[0], n[2])).translate(...p));
    for (let j = 0; j < 7; j++) {
      const q = ellAt(1.29, 0.99, t, 0.36 + j * 0.12, 0.03);
      K.add('torso', torso, M.steel, onto(rv.clone(), q.p, q.n));
    }
  }
  // bande de danger autour de la taille
  K.add('torso', torso, M.hazard, band(1.288, 0.988, 0.15, 0.9).translate(0, 0.4, 0));
  // foyer : braises, grille, charnières, loquet, rivets du cadre
  K.add('torso', torso, M.fire, new THREE.CircleGeometry(0.25, 20), { p: [0, 0.78, 0.97] });
  for (let i = -2; i <= 2; i++) K.add('torso', torso, M.dark, G.rbox(0.5 - Math.abs(i) * 0.06 * Math.abs(i), 0.045, 0.05, 0.015), { p: [0, 0.78 + i * 0.09, 1.0] });
  K.add('torso', torso, M.dark, G.rbox(0.05, 0.46, 0.05, 0.015), { p: [0, 0.78, 1.02] });
  for (const y of [0.62, 0.94]) K.add('torso', torso, M.steel, G.cyl(0.04, 0.04, 0.12, 8), { p: [-0.36, y, 1.0] });
  K.add('torso', torso, M.steel, G.rbox(0.06, 0.18, 0.06, 0.02), { p: [0.37, 0.78, 1.03] });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    K.add('torso', torso, M.steel, onto(rv.clone(), [Math.cos(a) * 0.3, 0.78 + Math.sin(a) * 0.3, 1.02], [0, 0, 1]));
  }
  // manomètres de part et d'autre du foyer (le droit plus gros, dans le rouge)
  for (const s of [-1, 1]) {
    const t = s * 0.4, y = s > 0 ? 1.0 : 0.98, r = s > 0 ? 0.17 : 0.14;
    const { p, n } = ellAt(1.28, 0.98, t, y, 0);
    const yaw = Math.atan2(n[0], n[2]);
    const at = (d) => [p[0] + n[0] * d, y, p[2] + n[2] * d];
    K.add('torso', torso, M.brass, G.cyl(r, r * 1.05, 0.1, 18).clone().rotateX(Math.PI / 2).rotateY(yaw).translate(...at(0.04)));
    K.add('torso', torso, M.brass, G.torus(r, 0.024, 6, 20).clone().rotateY(yaw).translate(...at(0.1)));
    K.add('torso', torso, M.dial, new THREE.CircleGeometry(r * 0.92, 20).rotateY(yaw).translate(...at(0.098)));
    K.add('torso', torso, M.rubber, G.box(0.018, r * 0.85, 0.01).clone().translate(0, r * 0.32, 0).rotateZ(s > 0 ? -1.1 : 0.9).rotateY(yaw).translate(...at(0.11)));
    K.add('torso', torso, M.brass, tube(at(0.0), [p[0] - n[0] * 0.1, y - r - 0.12, p[2] - n[2] * 0.1], 0.03, 0.03, 8));
  }
  // soupapes de sûreté sur le dôme : corps en laiton, levier et contrepoids
  for (const s of [-1, 1]) {
    const x = s * 0.55, z = -0.25, y = 1.74;
    K.add('torso', torso, M.brass, G.cyl(0.07, 0.09, 0.18, 12), { p: [x, y + 0.06, z] });
    K.add('torso', torso, M.brass, G.cyl(0.1, 0.1, 0.04, 12), { p: [x, y + 0.16, z] });
    K.add('torso', torso, M.steel, G.rbox(0.03, 0.03, 0.34, 0.01), { p: [x, y + 0.2, z - 0.12], r: [-0.12, 0, 0] });
    K.add('torso', torso, M.dark, G.sphere(0.055, 10, 8), { p: [x, y + 0.22, z - 0.3] });
  }

  // cheminées (la droite fume : sommet en (0.5, 2.4, -0.8)) ; à gauche, pot d'échappement court coiffé d'un clapet
  // anti-pluie entrouvert (charnière à l'arrière, contrepoids), sifflet à vapeur au pied
  const stackR = joint(torso, [0.5, 0, -0.8], 'stackR');
  K.add('stackR', stackR, M.darkC, G.cyl(0.15, 0.17, 1.0, 16), { p: [0, 1.85, 0] });
  K.add('stackR', stackR, M.orangeC, G.cyl(0.19, 0.19, 0.12, 16), { p: [0, 2.3, 0] });
  K.add('stackR', stackR, M.dark, G.torus(0.15, 0.03, 6, 16), { p: [0, 2.37, 0], r: [Math.PI / 2, 0, 0] });
  K.add('stackR', stackR, M.dark, G.cyl(0.2, 0.2, 0.05, 16), { p: [0, 1.62, 0] });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    K.add('stackR', stackR, M.steel, tube([Math.cos(a) * 0.14, 2.36, Math.sin(a) * 0.14], [Math.cos(a) * 0.1, 2.56, Math.sin(a) * 0.1], 0.012, 0.012, 4));
  }
  K.add('stackR', stackR, M.darkC, G.cone(0.24, 0.12, 14), { p: [0, 2.6, 0] });
  const stackL = joint(torso, [-0.5, 0, -0.8], 'stackL');
  K.add('stackL', stackL, M.darkC, G.cyl(0.12, 0.14, 0.62, 14), { p: [0, 1.66, 0] });
  K.add('stackL', stackL, M.dark, G.cyl(0.18, 0.18, 0.05, 14), { p: [0, 1.62, 0] });
  K.add('stackL', stackL, M.orangeC, G.cyl(0.15, 0.15, 0.1, 14), { p: [0, 1.86, 0] });
  K.add('stackL', stackL, M.dark, G.torus(0.125, 0.022, 6, 14), { p: [0, 1.97, 0], r: [Math.PI / 2, 0, 0] });
  // clapet : charnière en (0, 1.99, -0.13), relevé de 0,45 rad
  K.add('stackL', stackL, M.darkC, G.cyl(0.15, 0.15, 0.025, 16), { p: [0, 2.053, 0], r: [-0.45, 0, 0] });
  K.add('stackL', stackL, M.dark, G.cyl(0.06, 0.06, 0.02, 12), { p: [0, 2.069, 0.007], r: [-0.45, 0, 0] });
  K.add('stackL', stackL, M.dark, G.rbox(0.09, 0.035, 0.07, 0.012), { p: [0, 1.96, -0.193], r: [-0.45, 0, 0] });
  K.add('stackL', stackL, M.steel, G.cyl(0.02, 0.02, 0.13, 8), { p: [0, 1.99, -0.13], r: [0, 0, Math.PI / 2] });
  for (const x of [-0.045, 0.045]) K.add('stackL', stackL, M.steel, G.rbox(0.02, 0.06, 0.035, 0.008), { p: [x, 1.965, -0.125] });
  // sifflet
  K.add('stackL', stackL, M.brass, G.cyl(0.035, 0.035, 0.3, 8), { p: [0.18, 1.85, 0.12] });
  K.add('stackL', stackL, M.brass, G.cyl(0.075, 0.075, 0.2, 12), { p: [0.18, 2.08, 0.12] });
  K.add('stackL', stackL, M.brass, G.sphere(0.075, 12, 6), { p: [0.18, 2.18, 0.12], s: [1, 0.6, 1] });
  K.add('stackL', stackL, M.dark, G.rbox(0.13, 0.025, 0.02, 0.008), { p: [0.18, 2.0, 0.19] });

  // trappe dorsale : plaque « 07 », volant de vanne, charnières, boulons
  K.add('torso', torso, M.dark, G.rbox(0.62, 0.52, 0.04, 0.02), { p: [0, 0.74, -1.02] });
  K.add('torso', torso, M.plates, plate(0.5, 0.42, 'n07').rotateY(Math.PI).translate(0, 0.74, -1.045));
  for (const [x, y] of [[-0.36, 0.95], [-0.36, 0.53], [0.36, 0.95], [0.36, 0.53]]) K.add('torso', torso, M.steel, bolt(0.04).rotateX(-Math.PI / 2).translate(x, y, -1.03));
  K.add('torso', torso, M.orange, G.torus(0.13, 0.022, 6, 18), { p: [0.36, 1.25, -0.88], r: [0.35, 0, 0] });
  K.add('torso', torso, M.steel, G.cyl(0.03, 0.03, 0.12, 8), { p: [0.36, 1.22, -0.84], r: [Math.PI / 2 + 0.35, 0, 0] });
  for (let i = 0; i < 3; i++) K.add('torso', torso, M.orange, G.box(0.23, 0.02, 0.02), { p: [0.36, 1.25, -0.88], r: [0.35, 0, (i / 3) * Math.PI] });
  // durites du dos vers les épaules (colliers en acier aux extrémités)
  for (const s of [-1, 1]) {
    const pts = [[s * 0.42, 1.0, -0.98], [s * 0.85, 1.25, -1.0], [s * 1.25, 1.55, -0.6], [s * 1.42, 1.62, -0.22]];
    K.add('torso', torso, M.rubber, hose(pts, 0.065));
    for (const p of [pts[0], pts[3]]) K.add('torso', torso, M.steel, G.sphere(0.085, 10, 6), { p });
  }

  // ---------------------------------------------------------------- tête : casque, sourcils froncés, moustache en brosse
  const head = B(torso, [0, 2.1, 0.68], 'head');
  S.add(head, { t: 'ell', r: [0.4, 0.33, 0.37], col: 'dark', k: 0.05 });
  S.add(head, { t: 'cone', a: [0, -0.1, -0.1], b: [0, -0.42, -0.3], r1: 0.28, r2: 0.36, col: 'black', k: 0.1 });
  S.add(head, { t: 'box', s: [0.3, 0.1, 0.22], round: 0.08, p: [0, -0.3, 0.15], col: 'iron', k: 0.06 });
  for (const s of [-1, 1]) {
    S.sub(head, { t: 'ell', r: [0.1, 0.075, 0.07], p: [s * 0.15, 0.02, 0.33], col: 'black', k: 0.03 });
    S.add(head, { t: 'cyl', r: 0.13, h: 0.06, round: 0.03, rot: [0, 0, Math.PI / 2], p: [s * 0.4, -0.02, -0.03], col: 'orange', k: 0.03 });
  }
  const eyes = joint(head, [0, 0, 0], 'eyes');
  for (const s of [-1, 1]) {
    K.add('eyes', eyes, M.eye, G.ellipsoid(0.07, 0.052, 0.03, 14, 10), { p: [s * 0.15, 0.015, 0.31], r: [0, s * 0.35, 0] });
    // sourcil : plaque inclinée, bout intérieur bas (air furieux)
    K.add('head', head, M.steel, G.capsule(0.04, 0.17, 4, 8), { p: [s * 0.15, 0.075, 0.345], r: [0, s * 0.32, s * (Math.PI / 2 - 0.42)] });
    // moustache en brosse d'acier
    K.add('head', head, M.steel, G.capsule(0.055, 0.16, 4, 10), { p: [s * 0.13, -0.1, 0.35], r: [0, s * 0.3, s * (Math.PI / 2 - 0.35)] });
    // coquille de protection auditive : vis centrale
    K.add('head', head, M.dark, G.cyl(0.05, 0.05, 0.05, 10), { p: [s * 0.47, -0.02, -0.03], r: [0, 0, Math.PI / 2] });
  }
  // mâchoire : dents carrées en avant (prognathe)
  for (let i = 0; i < 4; i++) K.add('head', head, M.steel, G.rbox(0.06, 0.075, 0.045, 0.014), { p: [(i - 1.5) * 0.085, -0.19, 0.35 - Math.abs(i - 1.5) * 0.02], r: [0, (i - 1.5) * 0.2, 0] });
  // jugulaire du casque
  K.add('head', head, M.rubber, G.torus(0.39, 0.016, 4, 18, Math.PI), { p: [0, 0.02, 0.06], r: [0.35, 0, Math.PI] });

  const helmet = joint(head, [0, 0.2, 0], 'helmet');
  const hat = G.lathe('gbHat', [[0.44, -0.06], [0.5, -0.08], [0.63, -0.1], [0.68, -0.09], [0.67, -0.06], [0.6, -0.04], [0.53, -0.02], [0.51, 0.04], [0.48, 0.18], [0.41, 0.3], [0.3, 0.38], [0.16, 0.42], [0.001, 0.43]], 30);
  K.add('helmet', helmet, M.yellowC, hat, { p: [0, 0, 0.05], s: [1, 1, 1.12] });
  K.add('helmet', helmet, M.yellowC, G.ellipsoid(0.07, 0.09, 0.46, 10, 8), { p: [0, 0.39, 0.03] });
  K.add('helmet', helmet, M.rubber, G.torus(0.46, 0.03, 5, 26), { p: [0, -0.05, 0.05], r: [Math.PI / 2, 0, 0], s: [1, 1.12, 1] });
  // autocollant « CHEF » épousant le dôme (approché par un ellipsoïde)
  const chef = plate(0.3, 0.15, 'chef', 6, 3), cp = chef.attributes.position;
  for (let i = 0; i < cp.count; i++) {
    const x = cp.getX(i), y = cp.getY(i) + 0.19;
    cp.setXYZ(i, x, y, 0.05 + 1.12 * Math.sqrt(Math.max(0, 0.27 * (1 - (y / 0.43) ** 2) - x * x)) + 0.012);
  }
  chef.computeVertexNormals();
  K.add('helmet', helmet, M.plates, chef);
  // gyrophare sous grille
  K.add('helmet', helmet, M.dark, G.cyl(0.13, 0.15, 0.08, 14), { p: [0, 0.46, 0.0] });
  K.add('helmet', helmet, M.beacon, G.cyl(0.095, 0.1, 0.16, 14), { p: [0, 0.57, 0.0] });
  K.add('helmet', helmet, M.beacon, G.sphere(0.095, 14, 6), { p: [0, 0.65, 0], s: [1, 0.7, 1] });
  for (const a of [0, Math.PI / 2]) K.add('helmet', helmet, M.steel, G.torus(0.13, 0.012, 4, 14, Math.PI), { p: [0, 0.5, 0], r: [0, a, 0], s: [1, 1.4, 1] });
  K.add('helmet', helmet, M.steel, G.torus(0.13, 0.012, 4, 18), { p: [0, 0.6, 0], r: [Math.PI / 2, 0, 0] });

  // ---------------------------------------------------------------- bras : épaulières, vérins, avant-bras « Popeye », poings en fonte
  const arms = [];
  for (const s of [-1, 1]) {
    const nm = s < 0 ? 'L' : 'R';
    const sh = B(torso, [s * 1.45, 1.35, 0], 'sh' + nm);
    S.add(sh, { t: 'sph', r: 0.5, col: 'orange', k: 0.12 });
    S.add(sh, { t: 'ell', r: [0.48, 0.2, 0.46], p: [s * 0.1, -0.34, 0], rot: [0, 0, s * 0.45], col: 'orange', k: 0.03 });
    // éclat de peinture
    S.paint(sh, { t: 'sph', r: 0.06, p: [s * 0.35, 0.18, 0.3], col: 'bare', feather: 0.015, fuzz: [0.02, 18] });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const n = [Math.cos(a) * 0.55, 0.83, Math.sin(a) * 0.55];
      K.add('sh' + nm, sh, M.steel, onto(bolt(0.04), [n[0] * 0.5, n[1] * 0.5, n[2] * 0.5], n));
    }
    const up = B(sh, [0, 0, 0], 'up' + nm, [0, 0, s * 0.3]);
    S.add(up, { t: 'cone', a: [0, -0.1, 0], b: [0, -0.95, 0], r1: 0.3, r2: 0.27, col: 'dark', k: 0.08, skinSoft: 0.05 });
    S.add(up, { t: 'sph', r: 0.3, p: [0, -1.0, 0], col: 'iron', k: 0.06, skinSoft: 0.05 });
    // vérin hydraulique du biceps
    K.add('up' + nm, up, M.darkC, tube([0, -0.18, 0.3], [0, -0.62, 0.32], 0.075, 0.075, 12));
    K.add('up' + nm, up, M.steel, tube([0, -0.62, 0.32], [0, -1.2, 0.34], 0.04, 0.04, 8));
    K.add('up' + nm, up, M.dark, G.rbox(0.1, 0.12, 0.2, 0.03), { p: [0, -0.16, 0.2] });
    K.add('up' + nm, up, M.rubber, hose([[s * 0.08, -0.25, 0.36], [s * 0.25, -0.5, 0.3], [s * 0.33, -0.95, 0.15], [s * 0.4, -1.25, 0.05]], 0.035, 12));
    const fore = B(up, [0, -1.0, 0], 'fore' + nm);
    // avant-bras évasé coupé net au poignet (la calotte du cône engloutirait le poing)
    S.add(fore, { t: 'cone', a: [0, -0.05, 0], b: [0, -0.8, 0], r1: 0.42, r2: 0.58, col: 'yellow', k: 0.08, skinSoft: 0.05 });
    S.sub(fore, { t: 'box', s: [0.9, 0.3, 0.9], p: [0, -1.2, 0], k: 0.05 });
    S.add(fore, { t: 'torus', R: 0.45, r: 0.06, p: [0, -0.15, 0], col: 'orange', k: 0.03, skinSoft: 0.05 });
    S.add(fore, { t: 'torus', R: 0.5, r: 0.09, p: [0, -0.87, 0], col: 'black', k: 0.03, skinSoft: 0.05 });
    // poing en fonte : dos de la main, quatre doigts repliés (jointures puis phalanges), pouce. Le gauche montre
    // ses jointures vers l'avant ; le droit, refermé sur le manche du marteau (axe z), les tourne vers l'extérieur.
    const yaw = s > 0 ? Math.PI / 2 : 0, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const F = (x, y, z) => [x * cy + z * sy, y, -x * sy + z * cy + 0.05];
    S.add(fore, { t: 'ell', r: [0.62, 0.5, 0.54], p: F(0, -1.32, 0), rot: [0, yaw, 0], col: 'iron', k: 0.1, skinSoft: 0.05 });
    for (let f = 0; f < 4; f++) {
      const x = (f - 1.5) * 0.27;
      S.add(fore, { t: 'box', s: [0.115, 0.16, 0.14], round: 0.1, p: F(x, -1.38, 0.5), rot: [0, yaw, 0], col: 'iron', k: 0.03, skinSoft: 0.05 });
      S.add(fore, { t: 'box', s: [0.11, 0.15, 0.13], round: 0.095, p: F(x, -1.66, 0.36), rot: [0, yaw, 0], col: 'iron', k: 0.03, skinSoft: 0.05 });
      S.paint(fore, { t: 'sph', r: 0.075, p: F(x, -1.66, 0.5), col: 'bare', feather: 0.03, fuzz: [0.02, 18] });
    }
    S.add(fore, { t: 'cone', a: F(-0.55, -1.2, 0.24), b: F(-0.33, -1.55, 0.52), r1: 0.16, r2: 0.13, col: 'iron', k: 0.05, skinSoft: 0.05 });
    S.paint(fore, { t: 'ell', r: [0.7, 0.3, 0.7], p: F(0, -1.85, 0), col: 'grime', feather: 0.12, fuzz: [0.04, 10] });
    // phalanges blindées : barre boulonnée sur les jointures
    const KM = new THREE.Matrix4().makeRotationY(yaw).setPosition(...F(0, -1.35, 0.645));
    K.add('fore' + nm, fore, M.yellow, G.rbox(1.12, 0.21, 0.12, 0.04).clone().rotateX(0.15).applyMatrix4(KM));
    for (let f = 0; f < 4; f++) K.add('fore' + nm, fore, M.steel, bolt(0.04).rotateX(Math.PI / 2 + 0.15).translate((f - 1.5) * 0.27, 0, 0.065).applyMatrix4(KM));
    // couvre-joint riveté sur le dessus de l'avant-bras, rivets du bracelet orange
    K.add('fore' + nm, fore, M.yellow, G.rbox(0.13, 0.62, 0.035, 0.012).clone().rotateX(-0.2).translate(0, -0.45, 0.5));
    for (let j = 0; j < 5; j++) K.add('fore' + nm, fore, M.steel, onto(rv.clone(), [0, -0.2 - j * 0.125, 0.47 + j * 0.025 + 0.02], [0, 0.2, 1]));
    for (let j = 0; j < 10; j++) {
      const a = (j / 10) * Math.PI * 2;
      K.add('fore' + nm, fore, M.steel, onto(rv.clone(), [Math.sin(a) * 0.51, -0.15, Math.cos(a) * 0.51], [Math.sin(a), 0, Math.cos(a)]));
    }
    // plaque de danger boulonnée sur l'avant-bras (côté extérieur)
    K.add('fore' + nm, fore, M.hazard, G.rbox(0.06, 0.4, 0.38, 0.02), { p: [s * 0.53, -0.5, 0], r: [0, 0, s * 0.2] });
    const PM = mtx([s * 0.53, -0.5, 0], [0, 0, s * 0.2]);
    for (const [yy, zz] of [[0.15, 0.13], [0.15, -0.13], [-0.15, 0.13], [-0.15, -0.13]]) {
      K.add('fore' + nm, fore, M.steel, bolt(0.028).rotateZ(-s * Math.PI / 2).translate(s * 0.03, yy, zz).applyMatrix4(PM));
    }
    arms.push({ sh, up, fore });
  }

  // ---------------------------------------------------------------- jambes : vérins, genouillères, chaussures de sécurité
  const legs = [];
  for (const s of [-1, 1]) {
    const nm = s < 0 ? 'L' : 'R';
    const hip = B(hips, [s * 0.55, -0.1, 0], 'hip' + nm);
    S.add(hip, { t: 'cone', a: [0, 0.05, 0], b: [0, -0.6, 0], r1: 0.3, r2: 0.26, col: 'dark', k: 0.1, skinSoft: 0.04 });
    const knee = B(hip, [0, -0.65, 0], 'knee' + nm);
    S.add(knee, { t: 'cone', a: [0, -0.02, 0], b: [0, -0.4, 0], r1: 0.3, r2: 0.34, col: 'orange', k: 0.08, skinSoft: 0.04 });
    S.add(knee, { t: 'ell', r: [0.22, 0.2, 0.15], p: [0, 0.02, 0.19], col: 'steel', k: 0.04, skinSoft: 0.04 });
    S.paint(knee, { t: 'box', s: [0.5, 0.15, 0.5], p: [0, -0.55, 0], col: 'grime', feather: 0.12, fuzz: [0.04, 9] });
    S.paint(knee, { t: 'sph', r: 0.07, p: [s * 0.2, -0.25, 0.25], col: 'rust', feather: 0.02, fuzz: [0.03, 14] });
    const foot = B(knee, [0, -0.55, 0], 'foot' + nm);
    S.add(foot, { t: 'box', s: [0.33, 0.17, 0.44], round: 0.13, p: [0, 0.17, 0.12], col: 'dark', k: 0.06, skinSoft: 0.04 });
    S.add(foot, { t: 'box', s: [0.37, 0.05, 0.5], round: 0.03, p: [0, 0.03, 0.14], col: 'black', k: 0.02, skinSoft: 0.04 });
    S.add(foot, { t: 'ell', r: [0.3, 0.16, 0.18], p: [0, 0.14, 0.44], col: 'steel', k: 0.03, skinSoft: 0.04 });
    S.add(foot, { t: 'cyl', r: 0.32, h: 0.05, round: 0.02, p: [0, 0.37, 0.02], col: 'black', k: 0.03, skinSoft: 0.04 });
    S.paint(foot, { t: 'box', s: [0.5, 0.1, 0.7], p: [0, 0.02, 0.14], col: 'grime', feather: 0.08, fuzz: [0.04, 9] });
    // vérin de cuisse (côté extérieur), boulon de genou, sangles de chaussure
    K.add('hip' + nm, hip, M.darkC, tube([s * 0.3, -0.02, -0.05], [s * 0.32, -0.42, -0.05], 0.065, 0.065, 10));
    K.add('hip' + nm, hip, M.steel, tube([s * 0.32, -0.42, -0.05], [s * 0.33, -0.95, -0.06], 0.035, 0.035, 8));
    K.add('hip' + nm, hip, M.steel, bolt(0.045).rotateX(Math.PI / 2).translate(0, -0.63, 0.35));
    for (const z of [0.0, 0.2]) K.add('foot' + nm, foot, M.dark, G.rbox(0.72, 0.05, 0.06, 0.02), { p: [0, 0.27 - z * 0.25, z], r: [0.25, 0, 0] });
    K.add('foot' + nm, foot, M.steel, G.rbox(0.07, 0.07, 0.03, 0.01), { p: [s * 0.35, 0.24, 0.05], r: [0, s * Math.PI / 2, 0] });
    legs.push({ hip, knee, foot });
  }

  skin('grosbras', { mesh: { cell: 0.042, skinSoft: 0.07, aoDist: 0.08 }, mat: { enemyRim: true }, outline: OL });

  // ---------------------------------------------------------------- marteau-pilon dans la main droite
  // manche-vérin le long de +z ; tête cylindrique d'axe y (perpendiculaire au manche, dans le plan de frappe)
  const hammer = joint(arms[1].fore, [0, -1.35, 0], 'hammer');
  K.add('hammer', hammer, M.rubber, G.cyl(0.135, 0.135, 0.8, 12), { p: [0, 0, 0.0], r: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < 5; i++) K.add('hammer', hammer, M.dark, G.torus(0.135, 0.02, 4, 12), { p: [0, 0, -0.32 + i * 0.16] });
  K.add('hammer', hammer, M.orangeC, G.cyl(0.18, 0.15, 0.14, 14), { p: [0, 0, -0.44], r: [Math.PI / 2, 0, 0] });
  K.add('hammer', hammer, M.steel, G.sphere(0.12, 12, 8), { p: [0, 0, -0.52], s: [1, 1, 0.6] });
  K.add('hammer', hammer, M.darkC, G.cyl(0.155, 0.155, 0.62, 14), { p: [0, 0, 0.72], r: [Math.PI / 2, 0, 0] });
  K.add('hammer', hammer, M.orangeC, G.cyl(0.19, 0.19, 0.1, 14), { p: [0, 0, 1.03], r: [Math.PI / 2, 0, 0] });
  K.add('hammer', hammer, M.orangeC, G.cyl(0.19, 0.19, 0.1, 14), { p: [0, 0, 0.42], r: [Math.PI / 2, 0, 0] });
  K.add('hammer', hammer, M.steel, G.cyl(0.1, 0.1, 0.55, 12), { p: [0, 0, 1.33], r: [Math.PI / 2, 0, 0] });
  // vérins latéraux et leurs durites
  for (const s of [-1, 1]) {
    K.add('hammer', hammer, M.darkC, tube([s * 0.25, 0, 0.45], [s * 0.25, 0, 1.0], 0.055, 0.055, 10));
    K.add('hammer', hammer, M.steel, tube([s * 0.25, 0, 1.0], [s * 0.25, 0, 1.58], 0.03, 0.03, 8));
    K.add('hammer', hammer, M.dark, G.rbox(0.36, 0.1, 0.1, 0.03), { p: [s * 0.12, 0, 0.45] });
    K.add('hammer', hammer, M.rubber, hose([[s * 0.13, 0.08, 0.3], [s * 0.3, 0.14, 0.32], [s * 0.3, 0.06, 0.52]], 0.028, 10));
  }
  const hHead = joint(hammer, [0, 0, 2.1], 'hHead');
  // bas : masse de frappe (face d'acier usée) ; haut : corps du vérin à bande de danger ; tige chromée entre les deux
  K.add('hHead', hHead, M.darkC, G.cyl(0.56, 0.56, 0.52, 22), { p: [0, -0.46, 0] });
  K.add('hHead', hHead, M.steel, G.cyl(0.56, 0.5, 0.12, 22), { p: [0, -0.78, 0] });
  K.add('hHead', hHead, M.orangeC, G.cyl(0.6, 0.6, 0.12, 22), { p: [0, -0.3, 0] });
  K.add('hHead', hHead, M.steel, G.cyl(0.24, 0.24, 0.16, 16), { p: [0, -0.14, 0] });
  K.add('hHead', hHead, M.darkC, G.cyl(0.47, 0.47, 0.72, 22), { p: [0, 0.3, 0] });
  K.add('hHead', hHead, M.orangeC, G.cyl(0.5, 0.5, 0.1, 22), { p: [0, -0.04, 0] });
  K.add('hHead', hHead, M.hazard, band(0.475, 0.475, 0.3, 0.7, 40).translate(0, 0.3, 0));
  K.add('hHead', hHead, M.orangeC, G.cyl(0.4, 0.5, 0.14, 22), { p: [0, 0.73, 0] });
  K.add('hHead', hHead, M.dark, G.cyl(0.18, 0.22, 0.1, 14), { p: [0, 0.84, 0] });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.2;
    K.add('hHead', hHead, M.steel, onto(bolt(0.04), [Math.sin(a) * 0.605, -0.3, Math.cos(a) * 0.605], [Math.sin(a), 0, Math.cos(a)]));
    K.add('hHead', hHead, M.steel, onto(bolt(0.03), [Math.sin(a) * 0.43, 0.8, Math.cos(a) * 0.43], [Math.sin(a) * 0.6, 0.8, Math.cos(a) * 0.6]));
  }
  // durites du vérin vers le manche, douille boulonnée côté manche, plaque « 10 T » à l'opposé
  for (const s of [-1, 1]) K.add('hHead', hHead, M.rubber, hose([[s * 0.12, 0.88, -0.05], [s * 0.2, 1.0, -0.45], [s * 0.25, 0.55, -0.75], [s * 0.25, 0.08, -0.6]], 0.04, 14));
  K.add('hHead', hHead, M.orangeC, G.cyl(0.22, 0.26, 0.16, 16), { p: [0, 0, -0.5], r: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    K.add('hHead', hHead, M.steel, bolt(0.03).rotateX(-Math.PI / 2).translate(Math.cos(a) * 0.19, Math.sin(a) * 0.19, -0.58));
  }
  K.add('hHead', hHead, M.dark, G.rbox(0.42, 0.24, 0.08, 0.02), { p: [0, -0.46, 0.55] });
  K.add('hHead', hHead, M.plates, plate(0.36, 0.19, 'ton').translate(0, -0.46, 0.595));

  K.done([['helmet', M.yellowC], ['hHead', M.darkC], ['stackR', M.darkC], ['stackL', M.darkC]]);
  return { root, debrisColor: YEL, hips, torso, head, arms, legs, hammer, hHead, chunks: [helmet, hHead, stackL] };
}
