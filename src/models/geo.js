// Aides de modélisation : formes de base et assemblage de hiérarchies.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { outlineMaterial } from '../engine/materials.js';

const geoCache = new Map();
function cached(key, make) {
  if (!geoCache.has(key)) {
    const g = make();
    g.userData.shared = true;
    geoCache.set(key, g);
  }
  return geoCache.get(key);
}

export const G = {
  sphere: (r = 1, ws = 20, hs = 14) => cached(`s${r}|${ws}|${hs}`, () => new THREE.SphereGeometry(r, ws, hs)),
  ellipsoid: (rx, ry, rz, ws = 22, hs = 16) =>
    cached(`e${rx}|${ry}|${rz}|${ws}|${hs}`, () => new THREE.SphereGeometry(1, ws, hs).scale(rx, ry, rz)),
  capsule: (r, len, cs = 6, rs = 14) => cached(`c${r}|${len}|${cs}|${rs}`, () => new THREE.CapsuleGeometry(r, len, cs, rs)),
  cyl: (rt, rb, h, s = 20, open = false) => cached(`y${rt}|${rb}|${h}|${s}|${open}`, () => new THREE.CylinderGeometry(rt, rb, h, s, 1, open)),
  cone: (r, h, s = 16) => cached(`o${r}|${h}|${s}`, () => new THREE.ConeGeometry(r, h, s)),
  box: (w, h, d) => cached(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d)),
  rbox: (w, h, d, r = 0.05, seg = 3) => cached(`r${w}|${h}|${d}|${r}|${seg}`, () => new RoundedBoxGeometry(w, h, d, seg, r)),
  torus: (R, r, rs = 10, ts = 28, arc = Math.PI * 2) => cached(`t${R}|${r}|${rs}|${ts}|${arc}`, () => new THREE.TorusGeometry(R, r, rs, ts, arc)),
  // Profil de révolution : liste [rayon, y]
  lathe: (key, pts, segs = 24) => cached('lt' + key, () => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs)),
  ico: (r, d = 0) => cached(`i${r}|${d}`, () => new THREE.IcosahedronGeometry(r, d)),
  dodeca: (r, d = 0) => cached(`d${r}|${d}`, () => new THREE.DodecahedronGeometry(r, d)),
  // Écrou hexagonal (la monnaie !)
  nut: (r = 0.12, h = 0.07) =>
    cached(`nut${r}|${h}`, () => {
      const shape = new THREE.Shape();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
      }
      shape.closePath();
      const hole = new THREE.Path();
      hole.absarc(0, 0, r * 0.45, 0, Math.PI * 2, true);
      shape.holes.push(hole);
      const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: true, bevelThickness: h * 0.25, bevelSize: r * 0.12, bevelSegments: 2, curveSegments: 14 });
      g.translate(0, 0, -h / 2);
      g.computeVertexNormals();
      return g;
    }),
  // Boulon (tête hexagonale + tige filetée)
  bolt: (r = 0.1) =>
    cached(`bolt${r}`, () => {
      const head = new THREE.CylinderGeometry(r, r, r * 0.7, 6).translate(0, r * 0.35, 0);
      const shaft = new THREE.CylinderGeometry(r * 0.45, r * 0.45, r * 1.6, 10).translate(0, -r * 0.8, 0);
      const washer = new THREE.CylinderGeometry(r * 1.15, r * 1.15, r * 0.12, 18).translate(0, -r * 0.05, 0);
      return mergeGeometries([head.toNonIndexed(), shaft.toNonIndexed(), washer.toNonIndexed()]);
    }),
};

export { mergeGeometries, mergeVertices };

// Crée un maillage et l'ajoute au parent. o : { p:[x,y,z], r:[x,y,z], s:[x,y,z]|n, shadow, outline }
export function part(parent, geo, material, o = {}) {
  const m = new THREE.Mesh(geo, material);
  if (o.p) m.position.set(o.p[0], o.p[1], o.p[2]);
  if (o.r) m.rotation.set(o.r[0], o.r[1], o.r[2], o.order || 'XYZ');
  if (o.s !== undefined) {
    if (typeof o.s === 'number') m.scale.setScalar(o.s);
    else m.scale.set(o.s[0], o.s[1], o.s[2]);
  }
  m.castShadow = o.shadow !== false;
  m.receiveShadow = !!o.receive;
  if (o.name) m.name = o.name;
  if (parent) parent.add(m);
  if (o.outline) addOutline(m, o.outline === true ? 0.012 : o.outline);
  return m;
}

export function joint(parent, p = [0, 0, 0], name) {
  const g = new THREE.Group();
  g.position.set(p[0], p[1], p[2]);
  if (name) g.name = name;
  if (parent) parent.add(g);
  return g;
}

function addOutline(mesh, thickness = 0.012, color = '#1d1028') {
  const o = new THREE.Mesh(mesh.geometry, outlineMaterial(color, thickness));
  o.castShadow = false;
  o.receiveShadow = false;
  o.raycast = () => {};
  o.userData.isOutline = true;
  mesh.add(o);
  return o;
}

// Remplace les matériaux par des clones individuels (flash propre à une instance)
export function uniqueMaterials(root, cloneFn) {
  const map = new Map();
  root.traverse((o) => {
    if (o.isMesh && !o.userData.isOutline && o.material && o.material.userData && o.material.userData.flash) {
      if (!map.has(o.material)) map.set(o.material, cloneFn(o.material));
      o.material = map.get(o.material);
    }
  });
  return [...map.values()];
}

// Fusionne une liste de [geometry, matrix] en une seule géométrie (non indexée)
export function bake(list, forceColor = false) {
  const geos = list.map(([g, m]) => {
    const c = (g.index ? g.toNonIndexed() : g.clone());
    if (m) c.applyMatrix4(m);
    for (const k of Object.keys(c.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) c.deleteAttribute(k);
    if (!c.attributes.uv) c.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(c.attributes.position.count * 2), 2));
    return c;
  });
  const hasColor = forceColor || geos.some((g) => g.attributes.color);
  if (hasColor) for (const g of geos) if (!g.attributes.color) {
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
  }
  return mergeGeometries(geos);
}

// Fusionne les maillages d'un groupe statique : un seul maillage par matériau (moins d'appels de dessin).
// Avec une clé, la géométrie fusionnée est calculée une fois puis partagée.
const compactCache = new Map();
export function compact(group, key, o = {}) {
  let parts = key && compactCache.get(key);
  if (!parts) {
    group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
    const byMat = new Map();
    group.traverse((obj) => {
      if (!obj.isMesh || obj.userData.isOutline) return;
      let list = byMat.get(obj.material);
      if (!list) { list = []; byMat.set(obj.material, list); }
      list.push([obj.geometry, new THREE.Matrix4().multiplyMatrices(inv, obj.matrixWorld)]);
    });
    parts = [...byMat].map(([material, list]) => {
      const geo = bake(list);
      geo.userData.shared = true;
      return [geo, material];
    });
    if (key) compactCache.set(key, parts);
  }
  const out = new THREE.Group();
  for (const [geo, material] of parts) {
    const m = new THREE.Mesh(geo, material);
    m.castShadow = !!o.shadow;
    m.receiveShadow = !!o.receive;
    out.add(m);
  }
  return out;
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
export function mtx(p = [0, 0, 0], r = [0, 0, 0], s = 1) {
  _p.set(p[0], p[1], p[2]);
  _q.setFromEuler(_e.set(r[0], r[1], r[2]));
  if (typeof s === 'number') _s.setScalar(s);
  else _s.set(s[0], s[1], s[2]);
  return new THREE.Matrix4().compose(_p, _q, _s);
}
