// Danse-o-Tron : lanceur de boules à facettes en forme de sono de poche (enceinte à coins chromés, haut-parleurs,
// platine qui tourne, égaliseur lumineux, pavillon à néon) et la boule déployée (vraies facettes miroir, drone
// d'attache, faisceaux colorés qui posent leurs taches de lumière au sol, pluie de points de lumière qui tourne).
import * as THREE from 'three';
import { G, mtx, mergeGeometries } from '../geo.js';
import { mat } from '../../engine/materials.js';
import { paintedMetalTexture } from '../../engine/textures.js';
import { frameU } from '../../engine/frame.js';
import { fxLayer, fxUniforms, FX_PARS, FX_FRAG } from '../../engine/particles/shared.js';

const HP = Math.PI / 2, TAU = Math.PI * 2;
const C = { red: '#ff4f6d', cyan: '#3ef2ff', yellow: '#ffe95a', green: '#4dffa0', violet: '#c86aff', orange: '#ff9a3a', pink: '#ff4fd8', white: '#ffffff' };

// ------------------------------------------------------------------ aides de géométrie
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// copie non indexée placée par une matrice ; attributs ramenés à position, normal, uv (+ couleur des néons)
function place(geo, m, col, k = 1) {
  const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(m);
  for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  if (col) {
    const c = new THREE.Color(col).multiplyScalar(k), a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  }
  return g;
}
const at = (geo, p, r = [0, 0, 0], s = 1, col, k) => place(geo, mtx(p, r, s), col, k);
const _up = new THREE.Vector3(0, 1, 0);
// pièce d'axe Y orientée selon dir (vecteur), centrée en p
function orient(geo, p, dir, col, k) {
  const q = new THREE.Quaternion().setFromUnitVectors(_up, new THREE.Vector3(...dir).normalize());
  return place(geo, new THREE.Matrix4().compose(new THREE.Vector3(...p), q, new THREE.Vector3(1, 1, 1)), col, k);
}
// tube droit entre deux points
function seg(a, b, r, sides, col, k) {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r, r, d.length(), sides, 1, true);
  const out = orient(g, [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2], [d.x, d.y, d.z], col, k);
  g.dispose();
  return out;
}
// arc électrique en zigzag de a à b
function zap(L, a, b, n, amp, r, rnd, col, k) {
  const d = new THREE.Vector3().subVectors(b, a);
  const side = new THREE.Vector3().crossVectors(d, Math.abs(d.y) > Math.abs(d.x) ? new THREE.Vector3(1, 0, 0) : _up).normalize();
  const up = new THREE.Vector3().crossVectors(side, d).normalize();
  let prev = a.clone();
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const p = a.clone().addScaledVector(d, t);
    if (i < n) p.addScaledVector(side, (rnd() - 0.5) * 2 * amp).addScaledVector(up, (rnd() - 0.5) * 2 * amp);
    L.push(seg(prev, p, r, 4, col, k));
    prev = p;
  }
}
// anneau électrique en zigzag (plan XZ), incliné
function zapRing(L, R, n, amp, r, rnd, tilt, col, k) {
  const m = mtx([0, 0, 0], tilt);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, rr = R + (rnd() - 0.5) * 2 * amp;
    pts.push(new THREE.Vector3(Math.cos(a) * rr, (rnd() - 0.5) * 2 * amp, Math.sin(a) * rr).applyMatrix4(m));
  }
  for (let i = 0; i < n; i++) L.push(seg(pts[i], pts[(i + 1) % n], r, 4, col, k));
}
function merge(list) {
  const g = mergeGeometries(list);
  for (const x of list) x.dispose();
  g.userData.shared = true;
  return g;
}
function mesh(parent, geo, material, shadow = true) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = shadow;
  parent.add(m);
  return m;
}

// Note de musique (♪ ou ♫, plan XY, tête à l'origine), placée par la matrice m
function note(L, m, double, col, k) {
  const head = G.sphere(1, 8, 5), stem = G.cyl(0.0055, 0.0055, 1, 5);
  const P = (geo, p, r, s) => L.push(place(geo, new THREE.Matrix4().multiplyMatrices(m, mtx(p, r, s)), col, k));
  P(head, [0, 0, 0], [0, 0, 0.45], [0.034, 0.025, 0.02]);
  P(stem, [0.028, 0.06, 0], [0, 0, 0], [1, 0.12, 1]);
  if (!double) {
    P(G.torus(0.034, 0.0065, 4, 8, 1.9), [0.062, 0.088, 0], [0, 0, 0]);
    return;
  }
  P(head, [0.075, 0.016, 0], [0, 0, 0.45], [0.034, 0.025, 0.02]);
  P(stem, [0.103, 0.076, 0], [0, 0, 0], [1, 0.12, 1]);
  P(G.box(0.085, 0.022, 0.016), [0.0655, 0.124, 0], [0, 0, Math.atan2(0.016, 0.075)]);
}

// Boule à facettes : carreaux de miroir plats en couronnes (léger désalignement : chacun accroche la lumière à son
// tour), quelques carreaux allumés (néon) ; joints sombres = sphère un peu plus petite
function discoTiles(r, rings, seed, spark, sparkK) {
  const rnd = rng(seed);
  const M = { p: [], n: [], c: [] }, S = { p: [], n: [], c: [] };
  const pal = [C.pink, C.cyan, C.yellow, C.violet, C.green].map((h) => new THREE.Color(h));
  const dLat = Math.PI / rings, gap = 0.09;
  const P = (la, lo) => new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)).multiplyScalar(r);
  const col = new THREE.Color();
  for (let i = 0; i < rings; i++) {
    const la0 = -HP + i * dLat, la1 = la0 + dLat, lc = (la0 + la1) / 2;
    const n = Math.max(3, Math.round((TAU * Math.cos(lc)) / dLat));
    const dLon = TAU / n, off = rnd() * dLon;
    for (let j = 0; j < n; j++) {
      const lo0 = off + j * dLon, lo1 = lo0 + dLon;
      const a0 = la0 + dLat * gap, a1 = la1 - dLat * gap, b0 = lo0 + dLon * gap, b1 = lo1 - dLon * gap;
      const q = [P(a0, b0), P(a0, b1), P(a1, b1), P(a1, b0)];
      const nr = P(lc, (lo0 + lo1) / 2).normalize();
      nr.x += (rnd() - 0.5) * 0.09; nr.y += (rnd() - 0.5) * 0.09; nr.z += (rnd() - 0.5) * 0.09;
      nr.normalize();
      const lit = rnd() < spark;
      const T = lit ? S : M;
      if (lit) {
        col.copy(rnd() < 0.5 ? new THREE.Color(1, 1, 1) : pal[Math.floor(rnd() * pal.length)]).multiplyScalar(sparkK * (0.6 + rnd() * 0.6));
      } else {
        const b = 0.78 + rnd() * 0.22;
        col.setRGB(b, b, b);
        if (rnd() < 0.16) col.lerp(pal[Math.floor(rnd() * pal.length)], 0.3);
      }
      // carreau plan : sommets projetés sur le plan de la normale (plus de pli au milieu)
      const ctr = q[0].clone().add(q[1]).add(q[2]).add(q[3]).multiplyScalar(0.25);
      for (const v of q) v.addScaledVector(nr, -nr.dot(v.clone().sub(ctr)));
      const tri = (A, B, Cc) => {
        const fn = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(Cc, A));
        const pts = fn.dot(nr) < 0 ? [A, Cc, B] : [A, B, Cc];
        for (const v of pts) { T.p.push(v.x, v.y, v.z); T.n.push(nr.x, nr.y, nr.z); T.c.push(col.r, col.g, col.b); }
      };
      tri(q[0], q[1], q[2]);
      tri(q[0], q[2], q[3]);
    }
  }
  const build = (A) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(A.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(A.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((A.p.length / 3) * 2), 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(A.c, 3));
    return g;
  };
  return { mirror: build(M), spark: build(S) };
}

// ------------------------------------------------------------------ matériaux (créés au premier appel)
const MATS = new Map();
function once(key, make) {
  if (!MATS.has(key)) MATS.set(key, make());
  return MATS.get(key);
}
// laque de la carrosserie : peinture blanche écaillée de Lunette, teintée par la couleur (la Méga l'assombrit)
function paint(color) {
  const t = paintedMetalTexture('#eceaf6', 'lunette-blanc', { chip: 0.22, edge: 0.7, rust: 0.03, bare: '#9aa0b4' });
  return mat(color, { map: t.map, normalMap: t.normalMap, normalScale: 0.6, rough: 0.3, metal: 0.25, coat: 0.9, coatRough: 0.05 });
}
const chrome = () => mat('#e2e6ef', { rough: 0.16, metal: 0.92 });
const darkM = () => mat('#2a2633', { rough: 0.42, metal: 0.6 });
const rubber = () => mat('#1c1a22', { rough: 0.85 });
const mirror = () => mat('#ffffff', { rough: 0.06, metal: 0.88, vertexColors: true });
// néons multicolores (couleur de sommet) : un seul matériau ; la Méga les passe en or comme un glow()
function neon() {
  return once('neon', () => {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.4, 2.4), vertexColors: true });
    m.userData.shared = true;
    m.userData.isGlow = true;
    return m;
  });
}
// disque vinyle : sillons, plages, reflet, étiquette « KOBI · DISCO »
function vinylTexture() {
  return once('arme-danseotron-vinyle', () => {
    const S = 256, c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    const rnd = rng(77);
    x.fillStyle = '#121016';
    x.fillRect(0, 0, S, S);
    for (let r = 42; r < 126; r += 1.4) {
      x.strokeStyle = `rgba(200,190,230,${0.04 + rnd() * 0.07})`;
      x.lineWidth = 0.7;
      x.beginPath(); x.arc(128, 128, r, 0, TAU); x.stroke();
    }
    for (const r of [64, 86, 106]) { x.strokeStyle = '#060508'; x.lineWidth = 2.2; x.beginPath(); x.arc(128, 128, r, 0, TAU); x.stroke(); }
    // reflet en éventail
    for (const a of [0.6, 0.6 + Math.PI]) {
      const g = x.createRadialGradient(128, 128, 40, 128, 128, 126);
      g.addColorStop(0, 'rgba(255,255,255,0.0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.13)'); g.addColorStop(1, 'rgba(255,255,255,0.03)');
      x.fillStyle = g;
      x.beginPath(); x.moveTo(128, 128); x.arc(128, 128, 126, a - 0.22, a + 0.22); x.closePath(); x.fill();
    }
    x.strokeStyle = '#000'; x.lineWidth = 3; x.beginPath(); x.arc(128, 128, 126, 0, TAU); x.stroke();
    // étiquette
    x.fillStyle = '#ff4fd8'; x.beginPath(); x.arc(128, 128, 40, 0, TAU); x.fill();
    x.fillStyle = '#ffe95a'; x.beginPath(); x.arc(128, 128, 40, Math.PI * 0.15, Math.PI * 0.85); x.fill();
    x.strokeStyle = '#3ef2ff'; x.lineWidth = 2.5; x.beginPath(); x.arc(128, 128, 37, 0, TAU); x.stroke();
    x.fillStyle = '#2a1036'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = 'bold 19px sans-serif'; x.fillText('KOBI', 128, 113);
    x.font = 'bold 11px sans-serif'; x.fillText('DISCO', 128, 144);
    x.fillStyle = '#060508'; x.beginPath(); x.arc(128, 128, 4, 0, TAU); x.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.userData.shared = true;
    return t;
  });
}
const vinyl = () => mat('#ffffff', { map: vinylTexture(), rough: 0.32, metal: 0.1, coat: 1, coatRough: 0.12 });

// ------------------------------------------------------------------ le lanceur tenu en main
const HAND = new Map();
function handGeos(v2) {
  if (HAND.has(v2)) return HAND.get(v2);
  const rnd = rng(v2 ? 911 : 117);
  const L = { paint: [], horn: [], dark: [], chrome: [], rubber: [], neon: [] };
  const N = (geo, p, r, s, col, k = 1) => L.neon.push(at(geo, p, r, s, col, k));
  // caisson de l'enceinte
  L.paint.push(at(G.rbox(0.15, 0.12, 0.2, 0.026, 2), [0, 0.04, 0.02]));
  // coins chromés à facettes (comme la boule)
  for (const sx of [-1, 1]) for (const sy of [-0.02, 0.1]) for (const sz of [-0.08, 0.12]) {
    L.chrome.push(at(G.dodeca(0.019), [sx * 0.068, sy + (sy < 0 ? 0.006 : -0.006), sz + (sz < 0 ? 0.006 : -0.006)], [0.3, 0.5, 0]));
  }
  // haut-parleurs latéraux : enjoliveur vissé, suspension caoutchouc, membrane, cache-noyau lumineux
  const capC = v2 ? C.cyan : C.pink;
  for (const sx of [-1, 1]) {
    const y = 0.04, z = 0.02;
    L.chrome.push(at(G.torus(0.046, 0.0055, 4, 18), [sx * 0.078, y, z], [0, HP, 0]));
    L.rubber.push(at(G.torus(0.038, 0.0075, 4, 18), [sx * 0.075, y, z], [0, HP, 0]));
    L.dark.push(at(G.lathe('dscCone', [[0.0, -0.013], [0.012, -0.012], [0.03, -0.004], [0.037, 0]], 18), [sx * 0.077, y, z], [0, 0, -sx * HP]));
    N(new THREE.SphereGeometry(0.014, 10, 3, 0, TAU, 0, HP), [sx * 0.066, y, z], [0, 0, -sx * HP], 1, capC, 1.1);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      L.chrome.push(at(G.cyl(0.0045, 0.0045, 0.004, 6), [sx * 0.082, y + Math.sin(a) * 0.046, z + Math.cos(a) * 0.046], [0, 0, HP]));
    }
  }
  // face arrière (vue du joueur) : égaliseur à diodes et deux boutons
  L.dark.push(at(G.rbox(0.118, 0.078, 0.01, 0.004, 1), [0, 0.045, -0.081]));
  const eq = v2 ? [4, 5, 5, 3] : [3, 5, 4, 2];
  eq.forEach((h, i) => {
    for (let j = 0; j < h; j++) N(G.box(0.015, 0.0075, 0.004), [-0.03 + i * 0.02, 0.016 + j * 0.012, -0.087], undefined, 1, j < 2 ? C.green : j < 4 ? C.yellow : C.red, 1);
  });
  for (const sx of [-1, 1]) {
    L.chrome.push(at(G.cyl(0.0085, 0.01, 0.008, 14), [sx * 0.049, 0.05, -0.089], [HP, 0, 0]));
    N(G.box(0.002, 0.007, 0.002), [sx * 0.049 + sx * 0.002, 0.055, -0.0935], [0, 0, sx * 0.5], 1, C.white, 0.8);
  }
  // néons de bas de caisse
  for (const sx of [-1, 1]) N(G.capsule(0.0042, 0.15, 2, 6), [sx * 0.062, -0.021, 0.02], [HP, 0, 0], 1, v2 ? C.pink : C.cyan, 1.2);
  // platine : socle, plateau chromé (le disque tourne : blade), bras de lecture et contrepoids
  L.dark.push(at(G.cyl(0.059, 0.059, 0.008, 24), [0, 0.103, -0.025]));
  L.chrome.push(at(G.cyl(0.055, 0.055, 0.006, 24), [0, 0.109, -0.025]));
  L.chrome.push(at(G.cyl(0.009, 0.011, 0.012, 12), [0.061, 0.106, -0.072]));
  L.chrome.push(at(G.cyl(0.004, 0.004, 0.018, 8), [0.061, 0.12, -0.072]));
  L.chrome.push(seg(new THREE.Vector3(0.061, 0.126, -0.072), new THREE.Vector3(0.036, 0.121, -0.002), 0.0028, 6));
  L.dark.push(at(G.box(0.013, 0.004, 0.019), [0.034, 0.118, 0.006], [0, 0.35, 0]));
  L.chrome.push(at(G.cyl(0.0075, 0.0075, 0.014, 10), [0.064, 0.126, -0.087], [HP, 0, 0]));
  // berceau de la mini boule
  const br = v2 ? 0.05 : 0.045, bz = 0.075, by = 0.104 + br;
  L.chrome.push(at(G.torus(0.027, 0.005, 4, 14), [0, 0.106, bz], [HP, 0, 0]));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.5;
    L.chrome.push(seg(new THREE.Vector3(Math.cos(a) * 0.027, 0.106, bz + Math.sin(a) * 0.027), new THREE.Vector3(Math.cos(a) * br * 0.86, by - 0.006, bz + Math.sin(a) * br * 0.86), 0.0032, 5));
  }
  // ♫ en néon, guidon de visée à l'arrière gauche
  L.chrome.push(at(G.cyl(0.004, 0.004, 0.03, 8), [-0.052, 0.113, -0.07]));
  note(L.neon, mtx([-0.062, 0.13, -0.06], [0, -0.8, 0], 0.72), true, C.yellow, 1.2);
  // col chromé, pavillon laqué lisse, cerclages, néon de lèvre, ogive au fond de la gorge
  const flare = v2 ? 1.1 : 1;
  L.chrome.push(at(G.cyl(0.054, 0.054, 0.016, 24, true), [0, 0.04, 0.124], [HP, 0, 0]));
  const hz = 0.132;
  const prof = [[0.044, 0], [0.047, 0.05], [0.055, 0.1], [0.068, 0.15], [0.085, 0.19], [0.097, 0.214], [0.1, 0.222]].map(([r, y]) => [r * (y > 0.12 ? 1 + (flare - 1) * ((y - 0.12) / 0.1) : 1), y]);
  L.horn.push(at(G.lathe('dscHornO' + v2, prof, 24), [0, 0.04, hz], [HP, 0, 0]));
  const inner = prof.slice().reverse().map(([r, y]) => [r - 0.005, y + 0.002]);
  inner[inner.length - 1][0] = 0.035;
  L.horn.push(at(G.lathe('dscHornI' + v2, inner, 24), [0, 0.04, hz], [HP, 0, 0]));
  for (const y of [0.1, 0.15]) {
    const r = prof.find((q) => q[1] === y)[0];
    L.chrome.push(at(G.torus(r + 0.001, 0.004, 4, 16), [0, 0.04, hz + y]));
  }
  const lipR = 0.098 * flare;
  N(G.torus(lipR, 0.0055, 4, 24), [0, 0.04, hz + 0.222], undefined, 1, v2 ? C.yellow : C.cyan, 1.3);
  L.chrome.push(at(G.lathe('dscPlug', [[0.001, 0], [0.02, 0.0], [0.018, 0.03], [0.01, 0.055], [0.001, 0.066]], 10), [0, 0.04, hz + 0.005], [HP, 0, 0]));
  N(G.torus(0.037, 0.003, 4, 14), [0, 0.04, hz + 0.045], undefined, 1, C.pink, 1.2);
  // poignée caoutchouc rainurée, culot chromé, pontet, détente
  const gm = mtx([0, -0.08, -0.02], [-0.3, 0, 0]);
  const GP = (list, geo, p, r = [0, 0, 0], s = 1) => list.push(place(geo, new THREE.Matrix4().multiplyMatrices(gm, mtx(p, r, s))));
  GP(L.rubber, G.rbox(0.05, 0.14, 0.07, 0.02, 1), [0, 0, 0]);
  for (const y of [0.025, -0.012, -0.049]) GP(L.rubber, G.capsule(0.007, 0.04, 2, 6), [0, y, 0.034], [0, 0, HP]);
  GP(L.chrome, G.rbox(0.056, 0.016, 0.076, 0.006, 1), [0, -0.074, 0]);
  L.chrome.push(at(G.torus(0.024, 0.004, 4, 10, Math.PI), [0, -0.022, 0.03], [Math.PI, HP, 0]));
  L.dark.push(at(G.rbox(0.012, 0.03, 0.012, 0.004, 1), [0, -0.034, 0.026], [0.3, 0, 0]));
  // cordon du jack, de la face arrière au culot
  const cord = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[0.034, 0.012, -0.087], [0.05, -0.02, -0.11], [0.03, -0.1, -0.085], [0.0, -0.142, -0.045]].map((p) => new THREE.Vector3(...p))), 14, 0.0045, 5);
  L.rubber.push(place(cord, new THREE.Matrix4()));
  cord.dispose();
  L.chrome.push(at(G.cyl(0.006, 0.006, 0.012, 8), [0.034, 0.012, -0.088], [HP, 0, 0]));
  if (v2) {
    // Disco Inferno : bobines Tesla qui électrisent la boule, pavillon hérissé, éclairs en néon sur le pavillon
    for (const sx of [-1, 1]) {
      const cx = sx * 0.062, cz = 0.028;
      L.dark.push(at(G.cyl(0.006, 0.009, 0.05, 8), [cx, 0.125, cz]));
      for (const y of [0.114, 0.132]) L.chrome.push(at(G.torus(0.0105, 0.003, 4, 8), [cx, y, cz], [HP, 0, 0]));
      N(G.sphere(0.011, 8, 5), [cx, 0.156, cz], undefined, 1, C.cyan, 1.6);
      zap(L.neon, new THREE.Vector3(cx, 0.156, cz), new THREE.Vector3(sx * br * 0.72, by + 0.012, bz - br * 0.62), 4, 0.006, 0.0016, rnd, C.white, 1.8);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + Math.PI / 8;
      L.chrome.push(orient(G.cone(0.011, 0.042, 5), [Math.cos(a) * (lipR + 0.01), 0.04 + Math.sin(a) * (lipR + 0.01), hz + 0.225], [Math.cos(a), Math.sin(a), 0.9]));
    }
    const bolt = new THREE.Shape();
    [[0, 0], [0.026, 0.012], [0.022, 0.004], [0.06, 0.014], [0.032, -0.002], [0.036, 0.006]].forEach(([u, v], i) => (i ? bolt.lineTo(u, v) : bolt.moveTo(u, v)));
    const bg = new THREE.ExtrudeGeometry(bolt, { depth: 0.003, bevelEnabled: false });
    for (const sx of [-1, 1]) N(bg, [sx * 0.071, 0.045, hz + (sx > 0 ? 0.168 : 0.108)], [0, sx * HP + (sx > 0 ? 0 : Math.PI), 0.15], 1, C.yellow, 1.5);
    bg.dispose();
  }
  const out = {};
  for (const k of Object.keys(L)) out[k] = merge(L[k]);
  // mini boule (repère du berceau)
  const t = discoTiles(br, v2 ? 9 : 8, v2 ? 5 : 3, 0.06, 1.6);
  t.mirror.userData.shared = t.spark.userData.shared = true;
  Object.assign(out, { ballM: t.mirror, ballS: t.spark, ballC: [0, by, bz], br });
  // disque de la platine (tourne)
  out.disc = merge([at(G.cyl(0.052, 0.052, 0.004, 28), [0, 0, 0])]);
  out.spindle = merge([at(G.cyl(0.0028, 0.0028, 0.012, 8), [0, 0.004, 0]), at(G.cyl(0.006, 0.006, 0.002, 12), [0, 0.0028, 0])]);
  HAND.set(v2, out);
  return out;
}

export function danseotron(v2) {
  const g = new THREE.Group();
  const D = handGeos(v2);
  const body = paint(v2 ? '#ff4fd8' : '#c86aff');
  mesh(g, D.paint, body);
  mesh(g, D.horn, mat(v2 ? '#ff4fd8' : '#c86aff', { rough: 0.22, metal: 0.3, coat: 1, coatRough: 0.04 }));
  mesh(g, D.dark, darkM());
  mesh(g, D.chrome, chrome());
  mesh(g, D.rubber, rubber());
  mesh(g, D.neon, neon(), false);
  // mini boule à facettes dans son berceau
  const ball = new THREE.Group();
  ball.position.set(...D.ballC);
  ball.rotation.set(0.25, 0.4, 0);
  g.add(ball);
  mesh(ball, D.ballM, mirror());
  mesh(ball, D.ballS, neon(), false);
  mesh(ball, G.sphere(D.br * 0.975, 12, 8), darkM(), false);
  // disque vinyle (blade : le jeu le fait tourner, plus vite pendant le tir)
  const disc = new THREE.Group();
  disc.position.set(0, 0.114, -0.025);
  g.add(disc);
  mesh(disc, D.disc, vinyl(), false);
  mesh(disc, D.spindle, chrome(), false);
  g.userData.blade = disc;
  g.userData.bladeAxis = 'y';
  g.userData.muzzles = [new THREE.Vector3(0, 0.04, 0.36)];
  return g;
}

// ------------------------------------------------------------------ la boule déployée
// Faisceaux : cônes additifs (lueur dans l'air, douce sur les bords et au contact du décor) qui posent au sol une
// tache de lumière colorée : le point du décor vu à travers le cône est éclairé s'il est dans le cône (profondeur de
// l'image opaque), sans lumière dynamique.
const BEAM_VERT = /* glsl */ `
attribute vec3 aCol;
attribute vec4 aAxis; // axe local du faisceau + cosinus du demi-angle
attribute vec2 aInfo; // longueur, phase
varying vec3 vCol, vViewPos, vApex, vAxis;
varying float vT, vFres, vCos, vLen, vPhase;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  vApex = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vAxis = normalize(mat3(modelViewMatrix) * aAxis.xyz);
  vec3 n = normalize(normalMatrix * normal);
  vFres = abs(dot(n, normalize(-mv.xyz)));
  vT = uv.y; vCol = aCol; vCos = aAxis.w; vLen = aInfo.x; vPhase = aInfo.y;
  gl_Position = projectionMatrix * mv;
}`;
const BEAM_FRAG = /* glsl */ `
${FX_PARS}
${FX_FRAG}
uniform float uTime, uAir, uPool;
uniform sampler2D tSceneColor;
varying vec3 vCol, vViewPos, vApex, vAxis;
varying float vT, vFres, vCos, vLen, vPhase;
void main() {
  float viewZ = -vViewPos.z;
  float sz = fxLinDepth(texture2D(tSceneDepth, gl_FragCoord.xy / uRes).x);
  vec3 P = vViewPos * (sz / viewZ);
  vec3 N = normalize(cross(dFdx(P), dFdy(P)));
  if (N.z < 0.0) N = -N;
  float pulse = 0.72 + 0.28 * sin(uTime * 5.5 + vPhase);
  // lueur dans l'air : forte près de la boule, bords adoucis, fondue au contact du décor
  float air = pow(vT, 1.7) * smoothstep(0.08, 0.85, vFres) * clamp((sz - viewZ) / 0.5, 0.0, 1.0) * uAir;
  // tache au sol : une seule fois par pixel (faces avant)
  float pool = 0.0;
  if (gl_FrontFacing) {
    vec3 d = P - vApex;
    float dist = length(d);
    float c = dot(d, vAxis) / max(dist, 1e-3);
    float ndl = clamp(dot(N, -d / max(dist, 1e-3)), 0.0, 1.0);
    pool = smoothstep(vCos, mix(vCos, 1.0, 0.3), c) * (1.0 - smoothstep(vLen * 0.7, vLen, dist)) * smoothstep(0.8, 1.6, dist)
      * (0.35 + 0.65 * ndl) * uPool * 6.0 / (4.0 + dist);
  }
  float fog = 1.0 - smoothstep(uFxFogRange.x, uFxFogRange.y, viewZ);
  // la tache éclaire le décor (couleur de l'image opaque × couleur du faisceau) : saturée, sans voile blanc
  vec3 scene = texture2D(tSceneColor, gl_FragCoord.xy / uRes).rgb;
  vec3 col = pow(vCol, vec3(1.5));
  gl_FragColor = vec4(col * (air + pool * (scene * 2.6 + 0.3)) * pulse * fog, 1.0);
}`;
// Points de lumière de la boule : sphère englobante (faces arrière, sans test de profondeur) ; chaque pixel du décor
// à portée reçoit le point de lumière du carreau qui le vise (grille de couronnes qui tourne avec la boule)
const SPECK_VERT = /* glsl */ `
varying vec3 vViewPos;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const SPECK_FRAG = /* glsl */ `
${FX_PARS}
${FX_FRAG}
uniform mat4 uInvMV;
uniform vec3 uCenter, uTint;
uniform float uRange, uRows, uTime, uGain, uInner, uDot;
uniform sampler2D tSceneColor;
varying vec3 vViewPos;
float h11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float viewZ = -vViewPos.z;
  float sz = fxLinDepth(texture2D(tSceneDepth, gl_FragCoord.xy / uRes).x);
  vec3 P = vViewPos * (sz / viewZ);
  vec3 N = normalize(cross(dFdx(P), dFdy(P)));
  if (N.z < 0.0) N = -N;
  vec3 Lp = (uInvMV * vec4(P, 1.0)).xyz;
  float dist = length(Lp);
  vec3 dir = Lp / max(dist, 1e-3);
  float dl = 3.14159265 / uRows;
  float lat = asin(clamp(dir.y, -1.0, 1.0));
  float row = floor((lat + 1.5707963) / dl);
  float lc = -1.5707963 + (row + 0.5) * dl;
  float n = max(3.0, floor(6.2831853 * cos(lc) / dl + 0.5));
  float dLon = 6.2831853 / n;
  float lon = mod(atan(dir.z, dir.x) + h11(row + 3.0) * 6.2831853, 6.2831853);
  float cell = floor(lon / dLon);
  vec2 o = vec2((lon - (cell + 0.5) * dLon) * cos(lat), lat - lc) / dl;
  float rr = length(o);
  float aa = min(fwidth(rr), 0.08) + 0.015;
  float h = h21(vec2(row, cell));
  float spot = (1.0 - smoothstep(uDot - aa, uDot + aa, rr)) * step(0.4, h);
  vec3 col = mix(vec3(1.0), uTint * vec3(1.0, 0.55 + 0.45 * h11(h * 91.0), 1.0), step(0.78, h));
  col = h > 0.9 ? vec3(0.35, 0.95, 1.0) : col;
  float tw = 0.65 + 0.35 * sin(uTime * (2.0 + h * 5.0) + h * 40.0);
  float ndl = clamp(dot(N, normalize(uCenter - P)), 0.0, 1.0);
  float att = (1.0 - smoothstep(uRange * 0.6, uRange, dist)) * smoothstep(uInner, uInner + 0.6, dist) * 5.0 / (3.0 + dist);
  float fog = 1.0 - smoothstep(uFxFogRange.x, uFxFogRange.y, sz);
  vec3 scene = texture2D(tSceneColor, gl_FragCoord.xy / uRes).rgb;
  gl_FragColor = vec4(col * (scene * 2.6 + 0.16) * spot * tw * (0.5 + 0.5 * ndl) * att * fog * uGain, 1.0);
}`;
// Halo : lueur douce collée à la silhouette de la boule (distance du rayon de vue au centre)
const HALO_VERT = /* glsl */ `
varying float vH;
uniform float uR;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  float c = dot(n, normalize(-mv.xyz));
  vH = sqrt(max(0.0, 1.0 - c * c));
  gl_Position = projectionMatrix * mv;
}`;
const HALO_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uR;
varying float vH;
void main() {
  float k = 1.0 - smoothstep(uR, 1.0, vH);
  k = k * k * smoothstep(uR * 0.8, uR, vH);
  gl_FragColor = vec4(uColor * k, 1.0);
}`;

const TIME = { value: 0 };
const tick = () => { TIME.value = performance.now() / 1000; };
const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
function beamMat() {
  return once('beam', () => new THREE.ShaderMaterial({
    uniforms: fxUniforms({ tSceneColor: frameU.tSceneColor, uTime: TIME, uAir: { value: 0.13 }, uPool: { value: 1.0 } }),
    vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, side: THREE.DoubleSide, ...additive,
  }));
}

const ALLY = new Map();
function allyGeos(v2) {
  if (ALLY.has(v2)) return ALLY.get(v2);
  const rnd = rng(v2 ? 4242 : 1717);
  const r = v2 ? 0.55 : 0.45;
  const L = { chrome: [], paint: [], dark: [], neon: [], bneon: [] };
  const N = (list, geo, p, rot, s, col, k = 1) => list.push(at(geo, p, rot, s, col, k));
  // couronne de suspension et pointe du bas (tournent avec la boule)
  const ball = { chrome: [], neon: [] };
  ball.chrome.push(at(G.lathe('dscCrown', [[0.001, 0], [0.11, 0], [0.12, 0.018], [0.09, 0.05], [0.045, 0.07], [0.001, 0.072]], 18), [0, r * 0.93, 0], [0, 0, 0], r / 0.45));
  ball.chrome.push(at(G.torus(0.036, 0.009, 6, 16), [0, r * 0.93 + 0.1 * (r / 0.45), 0]));
  ball.chrome.push(at(G.lathe('dscTip', [[0.001, 0], [0.06, 0], [0.05, -0.025], [0.018, -0.07], [0.001, -0.1]], 14), [0, -r * 0.94, 0], [0, 0, 0], r / 0.45));
  N(ball.neon, G.sphere(0.022, 10, 7), [0, -r * 0.94 - 0.1 * (r / 0.45), 0], undefined, 1, C.pink, 1.6);
  // drone d'attache (fixe) : soucoupe laquée, jante chromée rivetée, anneau antigravité, petits haut-parleurs,
  // antenne à ♪, crochet et chaîne jusqu'à la couronne
  const sy = r * 0.93 + 0.62 * (r / 0.45) + 0.12, S = v2 ? 1.18 : 1;
  const sm = (p, rot = [0, 0, 0], s = 1) => new THREE.Matrix4().multiplyMatrices(mtx([0, sy, 0], [0, 0, 0], S), mtx(p, rot, s));
  const SP = (list, geo, p, rot, s, col, k) => list.push(place(geo, sm(p, rot, s), col, k));
  SP(L.paint, G.lathe('dscSaucer', [[0.001, 0.1], [0.07, 0.096], [0.14, 0.066], [0.23, 0.012], [0.245, -0.004], [0.2, -0.05], [0.09, -0.07], [0.001, -0.072]], 30), [0, 0, 0]);
  SP(L.chrome, G.torus(0.238, 0.016, 5, 30), [0, 0.002, 0], [HP, 0, 0]);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    SP(L.chrome, G.sphere(0.01, 6, 3), [Math.cos(a) * 0.254, 0.002, Math.sin(a) * 0.254]);
  }
  SP(L.neon, G.torus(0.15, 0.011, 4, 28), [0, -0.062, 0], [HP, 0, 0], 1, C.cyan, 1.4);
  SP(L.dark, G.cyl(0.11, 0.13, 0.02, 24), [0, -0.064, 0]);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4, dx = Math.cos(a), dz = Math.sin(a);
    // haut-parleur sur le flanc du dôme, tourné vers l'extérieur
    const p = [dx * 0.15, 0.06, dz * 0.15], dir = new THREE.Vector3(dx, 0.75, dz).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(_up, dir);
    const m = (off, s = 1) => sm([p[0] + dir.x * off, p[1] + dir.y * off, p[2] + dir.z * off]).multiply(new THREE.Matrix4().makeRotationFromQuaternion(q)).multiply(new THREE.Matrix4().makeScale(s, s, s));
    L.chrome.push(place(G.torus(0.04, 0.007, 4, 12), m(0.004).multiply(new THREE.Matrix4().makeRotationX(HP))));
    L.dark.push(place(G.lathe('dscCone', [[0.0, -0.013], [0.012, -0.012], [0.03, -0.004], [0.037, 0]], 18), m(0.004)));
    L.neon.push(place(new THREE.SphereGeometry(0.012, 10, 4, 0, TAU, 0, HP), m(-0.006), [C.pink, C.yellow, C.green, C.violet][i], 1.2));
  }
  SP(L.chrome, G.cyl(0.006, 0.006, 0.16, 8), [0, 0.17, 0]);
  SP(L.chrome, G.sphere(0.018, 10, 7), [0, 0.1, 0]);
  note(L.neon, sm([-0.02, 0.255, 0], [0, 0, 0], 0.9), false, C.yellow, 1.5);
  SP(L.chrome, G.cyl(0.02, 0.026, 0.04, 12), [0, -0.09, 0]);
  // chaîne : maillons alternés de la soucoupe à l'anneau de la couronne
  const top = sy - 0.11 * S, bot = r * 0.93 + 0.1 * (r / 0.45) + 0.03;
  const nl = Math.max(3, Math.round((top - bot) / 0.075));
  for (let i = 0; i < nl; i++) {
    const y = top - ((i + 0.5) / nl) * (top - bot);
    L.chrome.push(at(G.torus(0.026, 0.0065, 4, 10), [0, y, 0], [0, (i % 2) * HP, HP], [1, 1.45, 1]));
  }
  if (v2) {
    // Disco Inferno : bobines Tesla sous la soucoupe, arcs électriques qui tournent autour de la boule
    for (const sx of [-1, 1]) {
      SP(L.dark, G.cyl(0.012, 0.018, 0.12, 8), [sx * 0.19, -0.1, 0]);
      for (const y of [-0.075, -0.125]) SP(L.chrome, G.torus(0.02, 0.005, 4, 10), [sx * 0.19, y, 0], [HP, 0, 0]);
      SP(L.neon, G.sphere(0.026, 10, 7), [sx * 0.19, -0.17, 0], undefined, 1, C.cyan, 1.8);
    }
    zapRing(L.bneon, r + 0.13, 44, 0.035, 0.006, rnd, [0.5, 0, 0.2], C.cyan, 1.8);
    zapRing(L.bneon, r + 0.17, 48, 0.04, 0.005, rnd, [-0.45, 0.8, -0.25], C.white, 1.6);
  }
  // notes qui tournent autour de la boule avec les faisceaux
  const notes = v2 ? 5 : 3;
  for (let i = 0; i < notes; i++) {
    const a = (i / notes) * TAU + 0.4, R = r + 0.38, y = (i % 2 ? 0.25 : -0.2) * (r / 0.45);
    note(L.bneon, mtx([Math.cos(a) * R, y, Math.sin(a) * R], [0, HP - a, (rnd() - 0.5) * 0.5], 1.6 * (r / 0.45)), i % 2 === 1, [C.yellow, C.cyan, C.pink, C.green, C.violet][i % 5], 1.5);
  }
  const out = {};
  for (const k of Object.keys(L)) out[k] = merge(L[k]);
  out.ballChrome = merge(ball.chrome);
  out.ballNeon = merge(ball.neon);
  const t = discoTiles(r, v2 ? 24 : 20, v2 ? 21 : 11, 0.045, 1.5);
  out.mirror = t.mirror; out.spark = t.spark;
  out.mirror.userData.shared = out.spark.userData.shared = true;
  // faisceaux : cônes ouverts qui partent du centre, fusionnés (couleur, axe, demi-angle, longueur, phase)
  const cols = v2 ? [C.red, C.cyan, C.yellow, C.green, C.violet, C.orange] : [C.red, C.cyan, C.yellow, C.violet];
  const len = v2 ? 11 : 8, half = v2 ? 0.15 : 0.13;
  const beams = cols.map((c, i) => {
    const tilt = [0.62, 1.02, 0.78, 1.12, 0.7, 0.95][i], yaw = (i / cols.length) * TAU + 0.3;
    const dir = new THREE.Vector3(Math.sin(tilt) * Math.cos(yaw), -Math.cos(tilt), Math.sin(tilt) * Math.sin(yaw));
    const cone = new THREE.ConeGeometry(Math.tan(half) * len, len, 20, 1, true).translate(0, -len / 2, 0);
    const g = orient(cone, [0, 0, 0], [-dir.x, -dir.y, -dir.z]);
    cone.dispose();
    const n = g.attributes.position.count, col = new THREE.Color(c);
    const A = new Float32Array(n * 3), X = new Float32Array(n * 4), I = new Float32Array(n * 2);
    for (let j = 0; j < n; j++) {
      A.set([col.r, col.g, col.b], j * 3);
      X.set([dir.x, dir.y, dir.z, Math.cos(half)], j * 4);
      I.set([len, i * 1.7], j * 2);
    }
    g.setAttribute('aCol', new THREE.BufferAttribute(A, 3));
    g.setAttribute('aAxis', new THREE.BufferAttribute(X, 4));
    g.setAttribute('aInfo', new THREE.BufferAttribute(I, 2));
    return g;
  });
  out.beams = merge(beams);
  out.r = r;
  ALLY.set(v2, out);
  return out;
}

// Boule à facettes du Danse-o-Tron : userData.ball et userData.beams tournent (_updateDisco)
export function discoModel(v2) {
  const D = allyGeos(v2);
  const r = D.r;
  const g = new THREE.Group();
  const ball = new THREE.Group();
  g.add(ball);
  mesh(ball, D.mirror, mirror());
  mesh(ball, D.spark, neon(), false);
  mesh(ball, G.sphere(r * 0.97, 20, 12), darkM(), false);
  mesh(ball, D.ballChrome, chrome());
  mesh(ball, D.ballNeon, neon(), false);
  // drone d'attache
  mesh(g, D.paint, paint(v2 ? '#ff4fd8' : '#c86aff'));
  mesh(g, D.chrome, chrome());
  mesh(g, D.dark, darkM());
  mesh(g, D.neon, neon(), false);
  // faisceaux colorés, notes et arcs (tournent ensemble)
  const beams = new THREE.Group();
  g.add(beams);
  const bm = mesh(beams, D.beams, beamMat(), false);
  bm.onBeforeRender = tick;
  mesh(beams, D.bneon, neon(), false);
  // points de lumière projetés par les facettes (tournent avec la boule)
  const range = v2 ? 15 : 10;
  const sp = new THREE.ShaderMaterial({
    uniforms: fxUniforms({
      tSceneColor: frameU.tSceneColor, uInvMV: { value: new THREE.Matrix4() }, uCenter: { value: new THREE.Vector3() }, uTint: { value: new THREE.Color(v2 ? C.pink : C.violet) },
      uRange: { value: range }, uRows: { value: v2 ? 18 : 15 }, uTime: TIME, uGain: { value: 1.6 }, uInner: { value: r + 1.0 }, uDot: { value: 0.2 },
    }),
    vertexShader: SPECK_VERT, fragmentShader: SPECK_FRAG, side: THREE.BackSide, depthTest: false, ...additive,
  });
  const speck = mesh(ball, G.sphere(range, 20, 12), sp, false);
  const _m = new THREE.Matrix4();
  speck.onBeforeRender = (renderer, scene, cam) => {
    tick();
    _m.multiplyMatrices(cam.matrixWorldInverse, speck.matrixWorld);
    sp.uniforms.uCenter.value.setFromMatrixPosition(_m);
    sp.uniforms.uInvMV.value.copy(_m).invert();
    sp.uniformsNeedUpdate = true;
  };
  // halo
  const halo = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(v2 ? C.pink : C.violet).multiplyScalar(0.55) }, uR: { value: 1 / 1.45 } },
    vertexShader: HALO_VERT, fragmentShader: HALO_FRAG, ...additive,
  });
  mesh(g, G.sphere(r * 1.45, 24, 12), halo, false);
  g.userData.ball = ball;
  g.userData.beams = beams;
  return fxLayer(g);
}
