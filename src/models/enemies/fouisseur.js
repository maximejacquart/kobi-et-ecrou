import * as THREE from 'three';
import { G, part, joint, mtx, mergeGeometries, mergeVertices } from '../geo.js';
import { mat, glow } from '../../engine/materials.js';
import { build, noiseP, fbmP, paintedMetalTexture, treadPlateTexture } from '../../engine/textures.js';
import { rivet, mergeParts } from '../environment/props.js';
import { OL, rig } from './common.js';

// ===================================================================== Fouisseur
// Taupe-foreuse mécanique : carénage cuivré, plaques dorsales en tôle peinte écaillée et rivetée, foret conique à
// deux filets hélicoïdaux et pointe en carbure, griffes-pelles, chenilles arrière, lunettes et lampe de mineur,
// durites, terre et neige tassées sur le bas.

// ------------------------------------------------------------------ matières
// Acier brossé (traits fins le long de u) pour le foret ; la teinte de revenu vient des couleurs de sommet
function brushedTexture() {
  return build('fouisseur-brosse', 256, (u, v, out) => {
    const n = fbmP(u * 2, v * 48, 2, 48, 3, 701);
    const s = noiseP(u * 6, v * 190, 6, 190, 703);
    const g = 0.8 + (n - 0.5) * 0.22 + (s - 0.5) * 0.22;
    out[0] = g; out[1] = g; out[2] = g * 1.03;
    return n * 0.4 + s * 0.25;
  }, 1.4);
}

let M = null;
function mats() {
  if (M) return M;
  const plate = paintedMetalTexture('#ec9440', 'fouisseur-carene', { chip: 0.45, edge: 0.95, rust: 0.12, bare: '#cfc6bb' });
  const brushed = brushedTexture();
  const tread = treadPlateTexture('#8a909e', 'fouisseur-larmee');
  M = {
    paint: mat('#ffffff', { map: plate.map, normalMap: plate.normalMap, rough: 0.45, metal: 0.4, coat: 0.5, coatRough: 0.12 }),
    drill: mat('#d2d6de', { map: brushed.map, normalMap: brushed.normalMap, normalScale: 0.5, rough: 0.34, metal: 0.95, vertexColors: true }),
    tread: mat('#ffffff', { map: tread.map, normalMap: tread.normalMap, rough: 0.4, metal: 0.8 }),
    steel: mat('#c3cad6', { rough: 0.28, metal: 0.9 }),
    dark: mat('#2e2a35', { rough: 0.5, metal: 0.6 }),
    brass: mat('#d9a441', { rough: 0.3, metal: 0.9 }),
    rubber: mat('#26211f', { rough: 0.85 }),
    carbide: mat('#40424c', { rough: 0.22, metal: 0.75 }),
    eye: glow('#ffcf3a', 2.2),
    lamp: glow('#fff1c4', 2.2),
    tail: glow('#ff4632', 2.2),
  };
  return M;
}

// ------------------------------------------------------------------ aides géométriques
// Copie d'une géométrie prête à fusionner (non indexée, position/normal/uv seulement, couleur en option)
function prep(geo, m, keepColor = false) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', ...(keepColor ? ['color'] : [])].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (m) g.applyMatrix4(m);
  return g;
}
const T = (p, r, s) => mtx(p, r, s);
const mul = (...ms) => ms.reduce((a, b) => a.clone().multiply(b));

// Carène : ellipsoïde de la coque (les plaques dorsales s'y conforment)
const EC = [0, 0.04, -0.08], ER = [0.5, 0.46, 0.66];
// Point de la coque vu depuis l'axe (angle phi depuis le haut, vers +x) à la cote z, décollé de off le long de la normale
function hullAt(phi, z, off) {
  const sx = Math.sin(phi), cy = Math.cos(phi);
  const dz = (z - EC[2]) / ER[2];
  const t = Math.sqrt(Math.max(0.001, 1 - dz * dz) / (sx * sx / (ER[0] * ER[0]) + cy * cy / (ER[1] * ER[1])));
  const x = sx * t, y = EC[1] + cy * t;
  const n = new THREE.Vector3(x / (ER[0] * ER[0]), (y - EC[1]) / (ER[1] * ER[1]), (z - EC[2]) / (ER[2] * ER[2])).normalize();
  return { p: new THREE.Vector3(x, y, z).addScaledVector(n, off), n };
}

// Point d'un cylindre d'axe z (museau) : rayon r, centre (0, cy)
const snoutAt = (r, cy) => (phi, z, off) => ({ p: new THREE.Vector3(Math.sin(phi) * (r + off), cy + Math.cos(phi) * (r + off), z), n: new THREE.Vector3(Math.sin(phi), Math.cos(phi), 0) });

// Plaque bombée qui épouse une surface surf(phi, z, off) de phi0 à phi1 et de z0 à z1 : faces dessus/dessous et
// quatre chants, UV de 0 à 1 par face (l'écaillage de la peinture se concentre ainsi sur les bords de la plaque)
function shellPlate(surf, phi0, phi1, z0, z1, off, thick, nu = 14, nv = 6) {
  const pos = [], uv = [];
  const P = (i, j, o) => surf(phi0 + ((phi1 - phi0) * i) / nu, z0 + ((z1 - z0) * j) / nv, o).p;
  const quad = (a, b, c, d, ua, ub, uc, ud) => {
    pos.push(...a.toArray(), ...c.toArray(), ...b.toArray(), ...a.toArray(), ...d.toArray(), ...c.toArray());
    uv.push(...ua, ...uc, ...ub, ...ua, ...ud, ...uc);
  };
  const oIn = off, oOut = off + thick;
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const u0 = i / nu, u1 = (i + 1) / nu, v0 = j / nv, v1 = (j + 1) / nv;
    // dessus (normale sortante) puis dessous
    quad(P(i, j, oOut), P(i + 1, j, oOut), P(i + 1, j + 1, oOut), P(i, j + 1, oOut), [u0, v0], [u1, v0], [u1, v1], [u0, v1]);
    quad(P(i, j, oIn), P(i, j + 1, oIn), P(i + 1, j + 1, oIn), P(i + 1, j, oIn), [u0, v0], [u0, v1], [u1, v1], [u1, v0]);
  }
  // chants avant/arrière (le long de u) et latéraux (le long de v)
  for (let i = 0; i < nu; i++) {
    const u0 = i / nu, u1 = (i + 1) / nu;
    quad(P(i, nv, oIn), P(i, nv, oOut), P(i + 1, nv, oOut), P(i + 1, nv, oIn), [u0, 0], [u0, 1], [u1, 1], [u1, 0]);
    quad(P(i, 0, oIn), P(i + 1, 0, oIn), P(i + 1, 0, oOut), P(i, 0, oOut), [u0, 0], [u1, 0], [u1, 1], [u0, 1]);
  }
  for (let j = 0; j < nv; j++) {
    const v0 = j / nv, v1 = (j + 1) / nv;
    quad(P(0, j, oIn), P(0, j, oOut), P(0, j + 1, oOut), P(0, j + 1, oIn), [v0, 0], [v0, 1], [v1, 1], [v1, 0]);
    quad(P(nu, j, oIn), P(nu, j + 1, oIn), P(nu, j + 1, oOut), P(nu, j, oOut), [v0, 0], [v1, 0], [v1, 1], [v0, 1]);
  }
  // normales lissées sur chaque face (sommets soudés par position + UV), arêtes vives entre faces
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g = mergeVertices(g, 1e-5);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

// Rivet posé en p, tête tournée vers n
const _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);
function rivetAt(list, p, n, r = 0.016) {
  _q.setFromUnitVectors(_up, n.clone().normalize());
  list.push(rivet(r).applyQuaternion(_q).translate(p.x, p.y, p.z));
}

// Foret : rayon du noyau le long de l'axe (z de 0,06 à 0,84)
const coreR = (z) => 0.035 + 0.235 * Math.pow(1 - THREE.MathUtils.clamp((z - 0.06) / 0.78, 0, 1), 0.85);
// Teinte de revenu (acier chauffé par le forage) : blanc → paille → bronze → bleu vers la pointe
function temper(t) {
  const K = [[0, [1, 1, 1]], [0.45, [1, 1, 1]], [0.65, [1, 0.82, 0.5]], [0.8, [0.85, 0.5, 0.45]], [0.92, [0.45, 0.52, 0.95]], [1, [0.4, 0.5, 0.9]]];
  for (let i = 1; i < K.length; i++) if (t <= K[i][0]) {
    const [a, ca] = K[i - 1], [b, cb] = K[i], k = (t - a) / (b - a);
    return ca.map((c, j) => c + (cb[j] - c) * k);
  }
  return K[K.length - 1][1];
}
function tint(g) {
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) col.set(temper(THREE.MathUtils.clamp((p.getZ(i) - 0.06) / 0.8, 0, 1)), i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
// Noyau du foret (tour)
function drillCore() {
  const pts = [];
  for (let i = 0; i <= 20; i++) { const z = 0.04 + (0.8 * i) / 20; pts.push(new THREE.Vector2(coreR(z), z)); }
  pts.push(new THREE.Vector2(0.0, 0.85));
  // axe du tour (y) couché sur z
  return tint(prep(new THREE.LatheGeometry(pts, 28).rotateX(Math.PI / 2)));
}
// Filets hélicoïdaux : profil trapézoïdal (base large, arête étroite) balayé le long d'une hélice qui s'affine
function drillFlights(starts = 2, pitch = 0.44) {
  const N = 140, z0 = 0.07, z1 = 0.84;
  const pos = [], uv = [], idx = [];
  for (let s = 0; s < starts; s++) {
    const a0 = (s / starts) * Math.PI * 2;
    const prof = (t) => {
      const z = z0 + (z1 - z0) * t, rc = coreR(z) - 0.012;
      const h = 0.085 * Math.pow(1 - t, 0.7) * Math.min(1, t / 0.05 + 0.3);
      const w = 0.05 * (1 - 0.45 * t);
      return [[rc, -w], [rc + h, -w * 0.28], [rc + h, w * 0.28], [rc, w]];
    };
    for (let b = 0; b < 3; b++) {
      const base = pos.length / 3;
      for (let i = 0; i <= N; i++) {
        const t = i / N, z = z0 + (z1 - z0) * t, a = a0 + ((z - z0) / pitch) * Math.PI * 2;
        const pr = prof(t);
        for (const k of [b, b + 1]) {
          const [r, dz] = pr[k];
          pos.push(Math.cos(a) * r, Math.sin(a) * r, z + dz);
          uv.push(t * 6, (b + (k - b)) / 3);
        }
        if (i < N) { const q = base + i * 2; idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return tint(prep(g));
}

// Griffe recourbée : cône dont l'axe (+y) s'incurve vers +z
function clawGeo(len, r, bend) {
  const g = new THREE.ConeGeometry(r, len, 8, 5).translate(0, len / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const t = p.getY(i) / len; p.setZ(i, p.getZ(i) * (1 - 0.15 * t) + bend * t * t * len); }
  g.computeVertexNormals();
  return g;
}

// Durite annelée le long d'une courbe (rayon modulé en anneaux)
function hoseGeo(pts, r, ribs) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const tub = Math.round(ribs * 3), rad = 6;
  const g = new THREE.TubeGeometry(curve, tub, r, rad, false);
  const p = g.attributes.position, c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= tub; i++) {
    curve.getPointAt(i / tub, c);
    const k = 1 + 0.1 * Math.cos((i / tub) * ribs * Math.PI * 2);
    for (let j = 0; j <= rad; j++) {
      const n = i * (rad + 1) + j;
      v.fromBufferAttribute(p, n).sub(c).multiplyScalar(k).add(c);
      p.setXYZ(n, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ chenilles
const TRK = { a: 0.19, R: 0.085, th: 0.022, n: 22, x: 0.42, y: -0.5, z: -0.34 };
TRK.Rs = TRK.R + TRK.th / 2;
TRK.L = 4 * TRK.a + 2 * Math.PI * TRK.Rs;
// Patin à l'abscisse s de la boucle (dessus vers l'arrière, barbotin arrière, dessous vers l'avant, barbotin avant)
function trackAt(s) {
  const { a, Rs } = TRK, arc = Math.PI * Rs;
  s = ((s % TRK.L) + TRK.L) % TRK.L;
  if (s < 2 * a) return [Rs, a - s, 0];
  s -= 2 * a;
  if (s < arc) { const f = s / Rs; return [Rs * Math.cos(f), -a - Rs * Math.sin(f), -f]; }
  s -= arc;
  if (s < 2 * a) return [-Rs, -a + s, -Math.PI];
  s -= 2 * a;
  const f = s / Rs;
  return [-Rs * Math.cos(f), a + Rs * Math.sin(f), -Math.PI - f];
}
let TRACK_GEO = null;
function trackGeos() {
  if (TRACK_GEO) return TRACK_GEO;
  // patin : semelle et crampon
  const shoe = mergeGeometries([prep(G.box(0.15, TRK.th, 0.052)), prep(G.box(0.15, 0.016, 0.012), T([0, TRK.th * 0.5 + 0.006, 0]))]);
  // roue : jante sombre, moyeu d'acier et six boulons (axe x)
  const rx = T([0, 0, 0], [0, 0, Math.PI / 2]);
  const rim = [prep(new THREE.LatheGeometry([[0.5, -0.07], [0.9, -0.07], [1, -0.04], [1, 0.04], [0.9, 0.07], [0.5, 0.07]].map(([x, y]) => new THREE.Vector2(x, y)), 14), rx)];
  const hub = [prep(G.cyl(0.52, 0.52, 0.12, 12), rx), prep(G.cyl(0.18, 0.18, 0.2, 8), rx)];
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; hub.push(prep(G.cyl(0.08, 0.08, 0.17, 6), T([0, Math.cos(a) * 0.32, Math.sin(a) * 0.32], [0, 0, Math.PI / 2]))); }
  TRACK_GEO = { shoe, rim: mergeParts(rim), hub: mergeParts(hub) };
  TRACK_GEO.shoe.userData.shared = true;
  return TRACK_GEO;
}
// Roues : [z, y, rayon] (barbotins aux extrémités, galets porteurs entre les deux)
const WHEELS = [[TRK.a, 0, TRK.R], [-TRK.a, 0, TRK.R], [0.065, -0.026, 0.058], [-0.065, -0.026, 0.058]];

// Chenilles animées sans toucher au comportement : la distance parcourue (projetée sur l'avant du corps) fait
// défiler les patins et tourner les roues, au rendu de chaque image
function addTracks(body, m) {
  const g = trackGeos();
  const shoes = new THREE.InstancedMesh(g.shoe, m.dark, TRK.n * 2);
  const rims = new THREE.InstancedMesh(g.rim, m.rubber, WHEELS.length * 2);
  const hubs = new THREE.InstancedMesh(g.hub, m.steel, WHEELS.length * 2);
  for (const im of [shoes, rims, hubs]) { im.castShadow = true; body.add(im); }
  const o = new THREE.Object3D(), last = new THREE.Vector3(NaN), cur = new THREE.Vector3(), fwd = new THREE.Vector3();
  let dist = 0;
  const layout = () => {
    for (let side = 0; side < 2; side++) {
      const sx = side ? 1 : -1;
      for (let i = 0; i < TRK.n; i++) {
        const [y, z, th] = trackAt((i * TRK.L) / TRK.n - dist);
        o.position.set(sx * TRK.x, TRK.y + y, TRK.z + z);
        o.rotation.set(th, 0, 0);
        o.scale.setScalar(1);
        o.updateMatrix();
        shoes.setMatrixAt(side * TRK.n + i, o.matrix);
      }
      WHEELS.forEach(([z, y, r], k) => {
        o.position.set(sx * TRK.x, TRK.y + y, TRK.z + z);
        o.rotation.set(dist / r, 0, 0);
        o.scale.setScalar(r);
        o.updateMatrix();
        rims.setMatrixAt(side * WHEELS.length + k, o.matrix);
        hubs.setMatrixAt(side * WHEELS.length + k, o.matrix);
      });
    }
    shoes.instanceMatrix.needsUpdate = rims.instanceMatrix.needsUpdate = hubs.instanceMatrix.needsUpdate = true;
  };
  layout();
  for (const im of [shoes, rims, hubs]) im.computeBoundingSphere();
  shoes.onBeforeRender = () => {
    cur.setFromMatrixPosition(body.matrixWorld);
    if (last.x === last.x) {
      fwd.setFromMatrixColumn(body.matrixWorld, 2).normalize();
      const d = cur.clone().sub(last).dot(fwd);
      if (Math.abs(d) > 1e-5 && Math.abs(d) < 0.5) { dist += d; layout(); }
    }
    last.copy(cur);
  };
}

// ------------------------------------------------------------------ pièces fixes (fusionnées une fois, partagées)
let GEO = null;
function geos() {
  if (GEO) return GEO;
  const L = {};
  const put = (slot, geo, m, keepColor) => (L[slot] ||= []).push(keepColor ? geo : prep(geo, m));

  // --- plaques dorsales (de l'avant vers l'arrière, chacune chevauche la suivante) et leurs rivets
  const PL = [[0.06, 0.3], [-0.18, 0.1], [-0.42, -0.14], [-0.64, -0.38]];
  const rv = [];
  PL.forEach(([z0, z1], i) => {
    const off = 0.006 + (PL.length - 1 - i) * 0.011, phi = 1.2 - i * 0.04;
    put('body.paint', shellPlate(hullAt, -phi, phi, z0, z1, off, 0.026));
    for (let k = 0; k <= 8; k++) {
      const h = hullAt(-phi * 0.9 + (1.8 * phi * k) / 8, z1 - 0.035, off + 0.026);
      rivetAt(rv, h.p, h.n);
    }
    for (const s of [-1, 1]) for (const f of [0.3, 0.7]) {
      const h = hullAt(s * phi * 0.93, z0 + (z1 - z0) * f, off + 0.026);
      rivetAt(rv, h.p, h.n);
    }
  });
  // joues du museau : plaques latérales rivetées
  const sn = snoutAt(0.36, 0.045);
  for (const s of [-1, 1]) {
    const [p0, p1] = s > 0 ? [0.95, 2.05] : [-2.05, -0.95];
    put('body.paint', shellPlate(sn, p0, p1, 0.36, 0.58, 0.004, 0.022, 10, 5));
    for (let k = 0; k < 4; k++) for (const z of [0.39, 0.55]) {
      const h = sn(p0 + (p1 - p0) * (0.1 + 0.8 * k / 3), z, 0.026);
      rivetAt(rv, h.p, h.n);
    }
  }
  put('body.steel', mergeParts(rv));

  // --- lunettes de mineur (les yeux) et lampe frontale
  for (const s of [-1, 1]) {
    const E = T([s * 0.165, 0.41, 0.46], [-0.55 + Math.PI / 2, 0, -s * 0.28]);
    put('body.rubber', G.cyl(0.098, 0.112, 0.09, 18), E);
    put('body.brass', G.torus(0.094, 0.022, 8, 22), mul(E, T([0, 0.05, 0], [Math.PI / 2, 0, 0])));
    put('body.eye', G.cyl(0.078, 0.078, 0.02, 18), mul(E, T([0, 0.05, 0])));
    // pupille sombre (regard vers l'avant et le bas) et sourcil de tôle, l'air buté
    put('body.rubber', G.cyl(0.032, 0.032, 0.012, 12), mul(E, T([-s * 0.012, 0.062, 0.022])));
    put('body.paint', G.rbox(0.2, 0.035, 0.07, 0.012), T([s * 0.17, 0.53, 0.44], [-0.45, 0, s * 0.32]));
    // vis latérales de la sangle
    put('body.brass', G.cyl(0.022, 0.022, 0.03, 8), mul(E, T([s * 0.115, 0, 0], [0, 0, Math.PI / 2])));
  }
  // sangle de cuir entre les lunettes, par-dessus le front
  put('body.rubber', G.torus(0.3, 0.022, 5, 18, Math.PI * 0.62), T([0, 0.2, 0.42], [-0.55, 0, Math.PI * 0.19]));
  // lampe de mineur : support, boîtier, réflecteur, verre
  const LP = T([0, 0.5, 0.38], [-0.4, 0, 0]);
  put('body.dark', G.rbox(0.09, 0.05, 0.1, 0.015), mul(LP, T([0, -0.035, -0.02])));
  put('body.brass', G.cyl(0.062, 0.05, 0.11, 16), mul(LP, T([0, 0.02, 0.02], [Math.PI / 2, 0, 0])));
  put('body.steel', G.torus(0.06, 0.014, 6, 16), mul(LP, T([0, 0.02, 0.078])));
  put('body.lamp', G.cyl(0.05, 0.05, 0.01, 16), mul(LP, T([0, 0.02, 0.08], [Math.PI / 2, 0, 0])));

  // --- durites : de la boîte arrière jusqu'au collier du foret, de chaque côté
  for (const s of [-1, 1]) {
    put('body.rubber', hoseGeo([[s * 0.2, 0.06, -0.72], [s * 0.4, -0.04, -0.56], [s * 0.52, -0.12, -0.3], [s * 0.54, -0.12, -0.02], [s * 0.5, -0.02, 0.28], [s * 0.4, 0.03, 0.62]], 0.028, 48));
    for (const z of [-0.6, 0.62]) {
      // colliers de serrage aux deux bouts
      const p = z < 0 ? [s * 0.27, 0.06, -0.67] : [s * 0.38, 0.06, 0.6];
      put('body.steel', G.torus(0.034, 0.01, 6, 12), T(p, [0, s * (z < 0 ? 0.9 : -0.6), 0]));
    }
  }

  // --- arrière : pots d'échappement suies, grille
  for (const s of [-1, 1]) {
    const E = T([s * 0.12, 0.12, -0.74], [-0.55, 0, s * 0.12]);
    put('body.dark', G.cyl(0.04, 0.045, 0.3, 12), mul(E, T([0, 0.1, 0])));
    put('body.steel', G.cyl(0.052, 0.052, 0.05, 12), mul(E, T([0, 0.24, 0])));
    put('body.rubber', G.cyl(0.03, 0.03, 0.052, 10), mul(E, T([0, 0.245, 0])));
  }

  // --- feux arrière (boîtier, verre rouge) et queue de câble
  for (const s of [-1, 1]) {
    put('body.dark', G.rbox(0.07, 0.07, 0.05, 0.015), T([s * 0.27, -0.1, -0.65], [0, s * 0.5, 0]));
    put('body.tail', G.cyl(0.026, 0.026, 0.02, 12), T([s * 0.285, -0.1, -0.677], [Math.PI / 2, s * 0.5, 0]));
  }
  put('body.rubber', hoseGeo([[0, -0.2, -0.66], [0, -0.26, -0.82], [0, -0.2, -0.95], [0, -0.08, -0.98]], 0.022, 9));
  put('body.steel', G.cyl(0.03, 0.03, 0.05, 10), T([0, -0.06, -0.98], [0.2, 0, 0]));
  // moustaches de taupe : antennes sensitives sur les joues
  for (const s of [-1, 1]) for (const [dy, a] of [[0.06, 0.25], [0, 0.05], [-0.06, -0.18]]) {
    put('body.steel', G.cyl(0.007, 0.004, 0.3, 5), mul(T([s * 0.4, 0.06 + dy, 0.56], [0, -s * 0.5, -s * (Math.PI / 2 - a)]), T([0, 0.15, 0])));
    put('body.dark', G.sphere(0.016, 8, 6), T([s * 0.4, 0.06 + dy, 0.56]));
  }
  // rivets des cerclages, sur le bas de la coque
  const rb = [];
  for (const z of [-0.2, 0.12]) for (let k = 0; k <= 10; k++) {
    const phi = 1.45 + (k / 10) * 1.55;
    for (const s of [-1, 1]) { const h = hullAt(s * phi, z, 0.03); rivetAt(rb, h.p, h.n, 0.014); }
  }
  put('body.steel', mergeParts(rb));

  // --- chenilles : garde-boue en tôle larmée, flanc intérieur, axes
  for (const s of [-1, 1]) {
    const C = [s * TRK.x, TRK.y, TRK.z];
    put('body.tread', G.rbox(0.19, 0.022, 0.6, 0.008), T([C[0], C[1] + TRK.R + TRK.th + 0.03, C[2]]));
    put('body.rubber', G.box(0.17, 0.1, 0.012), T([C[0], C[1] + TRK.R + 0.02, C[2] - 0.31], [-0.15, 0, 0]));
    put('body.dark', G.rbox(0.02, 0.15, 0.44, 0.008), T([C[0] - s * 0.09, C[1], C[2]]));
    for (const [z, y] of WHEELS) put('body.steel', G.cyl(0.022, 0.022, 0.1, 8), T([C[0] - s * 0.05, C[1] + y, C[2] + z], [0, 0, Math.PI / 2]));
  }

  // --- foret (tourne avec bit) : moyeu boulonné, noyau, filets, pointe et plaquettes en carbure
  put('bit.dark', G.cyl(0.33, 0.35, 0.1, 28), T([0, 0, 0.04], [Math.PI / 2, 0, 0]));
  put('bit.steel', G.torus(0.3, 0.018, 6, 28), T([0, 0, 0.09]));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    put('bit.steel', G.cyl(0.022, 0.022, 0.03, 6), T([Math.cos(a) * 0.29, Math.sin(a) * 0.29, 0.1], [Math.PI / 2, 0, 0]));
  }
  put('bit.drill', drillCore(), null, true);
  put('bit.drill', drillFlights(), null, true);
  put('bit.carbide', G.cone(0.055, 0.17, 4), T([0, 0, 0.9], [Math.PI / 2, 0, 0]));
  put('bit.carbide', G.cyl(0.05, 0.045, 0.04, 8), T([0, 0, 0.82], [Math.PI / 2, 0, 0]));
  // plaquettes de carbure sur l'arête des filets (avant du foret)
  for (let s = 0; s < 2; s++) for (const t of [0.12, 0.3, 0.5]) {
    const z = 0.07 + 0.77 * t, a = s * Math.PI + ((z - 0.07) / 0.44) * Math.PI * 2;
    const r = coreR(z) - 0.012 + 0.085 * Math.pow(1 - t, 0.7) + 0.008;
    put('bit.carbide', G.box(0.03, 0.024, 0.05), T([Math.cos(a) * r, Math.sin(a) * r, z], [0, 0, a]));
  }

  GEO = Object.fromEntries(Object.entries(L).map(([k, list]) => [k, mergeParts(list)]));
  return GEO;
}
const OUTLINED = new Set(['body.paint', 'bit.drill', 'bit.dark', 'body.rubber', 'body.tread']);

// ------------------------------------------------------------------ modèle
export function fouisseur() {
  const { S, root, B, skin } = rig({
    body: { color: '#c86a30', rough: 0.4, metal: 0.5, sheen: 0.1, coat: 0.55 },
    bodyD: { color: '#8a4322', rough: 0.5, metal: 0.45, coat: 0.3 },
    belly: { color: '#d9ad78', rough: 0.55, metal: 0.2, coat: 0.3 },
    dark: { color: '#2c2733', rough: 0.5, metal: 0.6 },
    steel: { color: '#b4bccb', rough: 0.3, metal: 0.9 },
    bare: { color: '#e8b98e', rough: 0.25, metal: 0.9 },
    hazard: { color: '#f2b62a', rough: 0.45, metal: 0.2, coat: 0.6 },
    dirt: { color: '#5b4331', rough: 0.95 },
    snow: { color: '#eef4ff', rough: 0.65, sheen: 0.5 },
    soot: { color: '#1d1917', rough: 0.9 },
  });
  const m = mats();
  const body = B(root, [0, 0.62, 0], 'body');
  const hull = { t: 'ell', r: ER, p: EC, col: 'body', k: 0.06 };
  S.add(body, hull);
  // museau : cône du cou jusqu'au collier du foret
  S.add(body, { t: 'cone', a: [0, 0.04, 0.3], b: [0, 0.05, 0.6], r1: 0.36, r2: 0.36, col: 'body', k: 0.12 });
  S.add(body, { t: 'cyl', r: 0.38, h: 0.06, round: 0.025, p: [0, 0.05, 0.64], rot: [Math.PI / 2, 0, 0], col: 'dark', k: 0.03 });
  // collier rayé jaune et noir
  S.paint(body, { t: 'cyl', r: 0.4, h: 0.045, p: [0, 0.05, 0.64], rot: [Math.PI / 2, 0, 0], col: 'hazard', feather: 0.004 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    S.paint(body, { t: 'box', s: [0.035, 0.08, 0.06], round: 0, p: [Math.cos(a) * 0.38, 0.05 + Math.sin(a) * 0.38, 0.64], rot: [0, 0.6, a + Math.PI / 2], col: 'dark', feather: 0.004 });
  }
  // usure abrasive : cuivre nu autour du museau et sur les flancs avant
  S.paint(body, { t: 'torus', R: 0.37, r: 0.05, p: [0, 0.05, 0.54], rot: [Math.PI / 2, 0, 0], col: 'bare', feather: 0.02, fuzz: [0.025, 14] });
  // ventre bombé à segments
  S.add(body, { t: 'ell', r: [0.4, 0.22, 0.55], p: [0, -0.26, -0.04], col: 'belly', k: 0.08 });
  for (const z of [-0.35, -0.12, 0.11, 0.32]) S.sub(body, { t: 'box', s: [0.5, 0.06, 0.012], round: 0.006, p: [0, -0.46, z], col: 'dark', k: 0.01 });
  // joints de panneaux : cerclage du cou, ligne de flanc
  S.sub(body, { t: 'torus', R: 0.43, r: 0.014, p: [0, 0.04, 0.33], rot: [Math.PI / 2, 0, 0], col: 'dark', k: 0.008 });
  for (const s of [-1, 1]) S.sub(body, { t: 'box', s: [0.02, 0.012, 0.5], round: 0.006, p: [s * 0.49, -0.06, -0.08], rot: [0, 0, s * 0.3], col: 'dark', k: 0.008 });
  // cerclages d'acier (sous les plaques dorsales)
  for (const [z, R] of [[-0.2, 0.47], [0.12, 0.465]]) S.add(body, { t: 'torus', R, r: 0.026, p: [0, 0.03, z], rot: [Math.PI / 2, 0, 0], sc: [1, 0.94, 1], col: 'dark', k: 0.015 });
  // numéro peint au pochoir sur chaque flanc : « 07 »
  for (const s of [-1, 1]) {
    const at = (u, v) => [s * 0.5, 0.075 + v, -0.03 - s * u];
    S.paint(body, { t: 'torus', R: 0.042, r: 0.017, p: at(-0.06, 0), rot: [0, 0, Math.PI / 2], sc: [1.6, 5, 1], col: 'belly', feather: 0.005 });
    S.paint(body, { t: 'box', s: [0.12, 0.017, 0.05], round: 0, p: at(0.065, 0.068), col: 'belly', feather: 0.005 });
    S.paint(body, { t: 'box', s: [0.12, 0.075, 0.017], round: 0, p: at(0.05, -0.012), rot: [-s * 0.55, 0, 0], col: 'belly', feather: 0.005 });
  }
  // épaules des griffes et supports des chenilles
  for (const s of [-1, 1]) {
    S.add(body, { t: 'ell', r: [0.16, 0.14, 0.17], p: [s * 0.4, -0.17, 0.3], col: 'bodyD', k: 0.08 });
    S.add(body, { t: 'cyl', r: 0.1, h: 0.05, round: 0.015, p: [s * 0.49, -0.2, 0.3], rot: [0, 0, Math.PI / 2], col: 'dark', k: 0.02 });
    S.add(body, { t: 'box', s: [0.07, 0.07, 0.17], round: 0.03, p: [s * 0.3, -0.42, TRK.z], col: 'dark', k: 0.05 });
  }
  // arrière : boîte de ventilation à ouïes
  S.add(body, { t: 'cyl', r: 0.21, h: 0.05, round: 0.02, p: [0, 0.03, -0.73], rot: [Math.PI / 2, 0, 0], col: 'dark', k: 0.05 });
  for (const y of [-0.06, 0.0, 0.06, 0.12]) S.sub(body, { t: 'box', s: [0.15, 0.013, 0.04], round: 0.005, p: [0, y, -0.79], col: 'soot', k: 0.006 });
  S.paint(body, { t: 'ell', r: [0.3, 0.22, 0.14], p: [0, 0.25, -0.74], col: 'soot', feather: 0.05, fuzz: [0.03, 10] });
  // terre et neige tassées sur le bas
  S.paint(body, { t: 'box', s: [0.7, 0.2, 0.9], round: 0, p: [0, -0.5, 0], col: 'dirt', feather: 0.02, fuzz: [0.06, 7] });
  for (const [x, y, z, r] of [[0.34, -0.42, 0.1, 0.09], [-0.36, -0.4, -0.2, 0.1], [0.24, -0.44, -0.5, 0.08], [-0.2, -0.45, 0.38, 0.08]]) {
    S.paint(body, { t: 'sph', r, p: [x, y, z], col: 'snow', feather: 0.015, fuzz: [0.035, 16] });
  }
  for (const s of [-1, 1]) {
    // mottes sur les supports de chenille et sous le museau
    S.add(body, { t: 'ell', r: [0.07, 0.04, 0.12], p: [s * 0.33, -0.36, TRK.z + 0.1], col: 'snow', k: 0.04, fuzz: [0.015, 18] });
    S.add(body, { t: 'ell', r: [0.1, 0.05, 0.08], p: [s * 0.22, -0.33, 0.5], col: 'dirt', k: 0.05, fuzz: [0.02, 16] });
  }

  // griffes-pelles (articulées par l'IA : rotation x)
  const claws = [];
  for (const s of [-1, 1]) {
    const c = B(body, [s * 0.5, -0.2, 0.3], s < 0 ? 'clawL' : 'clawR', [0.4, 0, s * 0.6]);
    S.add(c, { t: 'sph', r: 0.115, col: 'dark', k: 0.02, skinSoft: 0.02 });
    S.add(c, { t: 'cone', a: [0, -0.03, 0], b: [0, -0.22, 0.06], r1: 0.1, r2: 0.08, col: 'body', k: 0.04, skinSoft: 0.02 });
    S.add(c, { t: 'cyl', r: 0.078, h: 0.03, round: 0.01, p: [0, -0.22, 0.06], rot: [0.3, 0, 0], col: 'dark', k: 0.015, skinSoft: 0.02 });
    // pelle : paume large et creuse, rebord usé
    S.add(c, { t: 'ell', r: [0.19, 0.06, 0.17], p: [0, -0.31, 0.13], rot: [0.5, 0, 0], col: 'steel', k: 0.04, skinSoft: 0.02 });
    S.sub(c, { t: 'ell', r: [0.15, 0.03, 0.13], p: [0, -0.28, 0.16], rot: [0.5, 0, 0], col: 'dark', k: 0.015 });
    S.paint(c, { t: 'ell', r: [0.2, 0.07, 0.17], p: [0, -0.36, 0.12], rot: [0.5, 0, 0], col: 'dirt', feather: 0.02, fuzz: [0.03, 14] });
    S.add(c, { t: 'ell', r: [0.08, 0.04, 0.06], p: [0, -0.35, 0.06], col: 'snow', k: 0.03, fuzz: [0.012, 20], skinSoft: 0.02 });
    claws.push(c);
  }
  skin('fouisseur', { mesh: { cell: 0.022, skinSoft: 0.035 }, mat: { enemyRim: true } });

  // pièces fixes du corps, mèche de forage (tourne)
  const drill = joint(body, [0, 0.05, 0.7]);
  const bit = joint(drill, [0, 0, 0]);
  const at = { body, bit };
  for (const [k, g] of Object.entries(geos())) {
    const [b, mm] = k.split('.');
    part(at[b], g, m[mm], { outline: OUTLINED.has(k) ? OL : 0, shadow: !['eye', 'lamp', 'tail'].includes(mm) });
  }
  addTracks(body, m);

  // pièces des griffes : vérin, griffes recourbées à pointe de carbure
  for (const [i, c] of claws.entries()) {
    const s = i ? 1 : -1;
    part(c, G.cyl(0.03, 0.03, 0.14, 10), m.dark, { p: [s * 0.075, -0.1, -0.03], r: [0.2, 0, 0] });
    part(c, G.cyl(0.016, 0.016, 0.12, 8), m.steel, { p: [s * 0.075, -0.2, 0.0], r: [0.2, 0, 0] });
    for (let k = 0; k < 4; k++) {
      const x = (k - 1.5) * 0.075;
      part(c, CLAW(), m.steel, { p: [x, -0.33, 0.24 - Math.abs(x) * 0.4], r: [2.03, 0, x * 0.8], outline: OL * 0.6 });
    }
  }
  return { root, debrisColor: '#c86a30', body, drill, bit, claws, chunks: [drill] };
}
let clawG = null;
const CLAW = () => clawG || (clawG = Object.assign(clawGeo(0.17, 0.032, 0.35), { userData: { shared: true } }));
