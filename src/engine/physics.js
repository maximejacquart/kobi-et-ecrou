// Monde de collision maison : boîtes orientées, cylindres verticaux et champs de hauteur.
// Requêtes : contacts sphère, lancer de rayon, sol sous un point. Grille spatiale pour le statique.
import * as THREE from 'three';
import { clamp } from './util.js';

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

let stampCounter = 1;

class Collider {
  constructor(type, opts = {}) {
    this.type = type;
    this.solid = opts.solid !== false;
    this.surface = opts.surface || 'rock';
    this.tag = opts.tag || null;
    this.user = opts.user || null;
    this.enabled = true;
    this.dynamic = !!opts.dynamic;
    this.blocksCamera = opts.blocksCamera !== false;
    this.walkable = opts.walkable !== false;
    this.conveyor = opts.conveyor || null; // Vector3 vitesse de tapis
    this.bounce = opts.bounce || 0;
    this.deltaPos = new THREE.Vector3();
    this.deltaYaw = 0;
    this.pivot = new THREE.Vector3();
    this.aabb = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
    this._stamp = 0;
  }
}

export class BoxCollider extends Collider {
  constructor(center, half, quat, opts) {
    super('box', opts);
    this.center = center.clone();
    this.half = half.clone();
    this.quat = quat ? quat.clone() : new THREE.Quaternion();
    this.matrix = new THREE.Matrix4();
    this.inv = new THREE.Matrix4();
    this.rot = new THREE.Matrix3();
    this.update();
  }
  update() {
    this.matrix.compose(this.center, this.quat, _v.set(1, 1, 1));
    this.inv.copy(this.matrix).invert();
    this.rot.setFromMatrix4(this.matrix);
    // AABB : projection des demi-axes
    const e = this.matrix.elements;
    const hx = this.half.x, hy = this.half.y, hz = this.half.z;
    const ex = Math.abs(e[0]) * hx + Math.abs(e[4]) * hy + Math.abs(e[8]) * hz;
    const ey = Math.abs(e[1]) * hx + Math.abs(e[5]) * hy + Math.abs(e[9]) * hz;
    const ez = Math.abs(e[2]) * hx + Math.abs(e[6]) * hy + Math.abs(e[10]) * hz;
    const a = this.aabb, c = this.center;
    a.minX = c.x - ex; a.maxX = c.x + ex;
    a.minY = c.y - ey; a.maxY = c.y + ey;
    a.minZ = c.z - ez; a.maxZ = c.z + ez;
  }
  sphere(c, r, res) {
    _v.copy(c).applyMatrix4(this.inv);
    const hx = this.half.x, hy = this.half.y, hz = this.half.z;
    const qx = clamp(_v.x, -hx, hx), qy = clamp(_v.y, -hy, hy), qz = clamp(_v.z, -hz, hz);
    let dx = _v.x - qx, dy = _v.y - qy, dz = _v.z - qz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > 1e-10) {
      if (d2 > r * r) return false;
      const d = Math.sqrt(d2);
      _n.set(dx / d, dy / d, dz / d);
      res.depth = r - d;
    } else {
      // centre à l'intérieur : axe de moindre pénétration
      const px = hx - Math.abs(_v.x), py = hy - Math.abs(_v.y), pz = hz - Math.abs(_v.z);
      if (py <= px && py <= pz) { _n.set(0, Math.sign(_v.y) || 1, 0); res.depth = py + r; }
      else if (px <= pz) { _n.set(Math.sign(_v.x) || 1, 0, 0); res.depth = px + r; }
      else { _n.set(0, 0, Math.sign(_v.z) || 1); res.depth = pz + r; }
    }
    res.normal.copy(_n).applyMatrix3(this.rot).normalize();
    res.collider = this;
    return true;
  }
  ray(o, d, maxT, res) {
    const _o = _bo.copy(o).applyMatrix4(this.inv);
    const _d = _bd.copy(d).applyMatrix3(_m3.copy(this.rot).transpose());
    let tmin = -Infinity, tmax = Infinity, axis = -1, sgn = 1;
    const h = [this.half.x, this.half.y, this.half.z];
    const oo = [_o.x, _o.y, _o.z], dd = [_d.x, _d.y, _d.z];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(dd[i]) < 1e-9) {
        if (oo[i] < -h[i] || oo[i] > h[i]) return false;
      } else {
        let t1 = (-h[i] - oo[i]) / dd[i], t2 = (h[i] - oo[i]) / dd[i];
        let s = -1;
        if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = i; sgn = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return false;
      }
    }
    if (tmin < 0 || tmin > maxT || axis < 0) return false;
    res.t = tmin;
    _n.set(0, 0, 0).setComponent(axis, sgn);
    res.normal.copy(_n).applyMatrix3(this.rot).normalize();
    res.collider = this;
    return true;
  }
}
const _m3 = new THREE.Matrix3();
const _bo = new THREE.Vector3();
const _bd = new THREE.Vector3();

export class CylinderCollider extends Collider {
  constructor(x, z, y0, y1, radius, opts) {
    super('cyl', opts);
    this.x = x; this.z = z; this.y0 = y0; this.y1 = y1; this.radius = radius;
    // les objets fins (poteaux, troncs, colonnes) ne repoussent pas la caméra
    if (!opts || opts.blocksCamera === undefined) this.blocksCamera = radius >= 1.0;
    this.update();
  }
  update() {
    const a = this.aabb;
    a.minX = this.x - this.radius; a.maxX = this.x + this.radius;
    a.minZ = this.z - this.radius; a.maxZ = this.z + this.radius;
    a.minY = this.y0; a.maxY = this.y1;
  }
  sphere(c, r, res) {
    const dx = c.x - this.x, dz = c.z - this.z;
    const rd = Math.hypot(dx, dz);
    const R = this.radius;
    const insideY = c.y >= this.y0 && c.y <= this.y1;
    if (rd < R && insideY) {
      const pTop = this.y1 - c.y, pBot = c.y - this.y0, pSide = R - rd;
      if (pTop <= pSide && pTop <= pBot) { res.normal.set(0, 1, 0); res.depth = pTop + r; }
      else if (pSide <= pBot) {
        res.normal.set(rd > 1e-6 ? dx / rd : 1, 0, rd > 1e-6 ? dz / rd : 0);
        res.depth = pSide + r;
      } else { res.normal.set(0, -1, 0); res.depth = pBot + r; }
      res.collider = this;
      return true;
    }
    const k = rd > R ? R / rd : 1;
    const qx = this.x + dx * k, qz = this.z + dz * k;
    const qy = clamp(c.y, this.y0, this.y1);
    const ex = c.x - qx, ey = c.y - qy, ez = c.z - qz;
    const d2 = ex * ex + ey * ey + ez * ez;
    if (d2 > r * r || d2 < 1e-12) return false;
    const d = Math.sqrt(d2);
    res.normal.set(ex / d, ey / d, ez / d);
    res.depth = r - d;
    res.collider = this;
    return true;
  }
  ray(o, d, maxT, res) {
    let best = Infinity;
    // côtés
    const ox = o.x - this.x, oz = o.z - this.z;
    const a = d.x * d.x + d.z * d.z;
    if (a > 1e-9) {
      const b = 2 * (ox * d.x + oz * d.z);
      const c = ox * ox + oz * oz - this.radius * this.radius;
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const t = (-b - Math.sqrt(disc)) / (2 * a);
        if (t >= 0 && t < best) {
          const y = o.y + d.y * t;
          if (y >= this.y0 && y <= this.y1) {
            best = t;
            res.normal.set((ox + d.x * t) / this.radius, 0, (oz + d.z * t) / this.radius);
          }
        }
      }
    }
    // couvercles
    if (Math.abs(d.y) > 1e-9) {
      for (const [y, ny] of [[this.y1, 1], [this.y0, -1]]) {
        const t = (y - o.y) / d.y;
        if (t >= 0 && t < best) {
          const px = ox + d.x * t, pz = oz + d.z * t;
          if (px * px + pz * pz <= this.radius * this.radius) {
            best = t;
            res.normal.set(0, ny, 0);
          }
        }
      }
    }
    if (best > maxT) return false;
    res.t = best;
    res.collider = this;
    return true;
  }
}

export class HeightfieldCollider extends Collider {
  // heights : (res+1)² échantillons couvrant [x0, x0+size] × [z0, z0+size]
  constructor(x0, z0, size, res, heights, opts) {
    super('hf', opts);
    this.x0 = x0; this.z0 = z0; this.size = size; this.res = res; this.heights = heights;
    this.step = size / res;
    let mn = Infinity, mx = -Infinity;
    for (const h of heights) { if (h < mn) mn = h; if (h > mx) mx = h; }
    const a = this.aabb;
    a.minX = x0; a.maxX = x0 + size; a.minZ = z0; a.maxZ = z0 + size; a.minY = mn; a.maxY = mx;
  }
  inside(x, z) {
    return x >= this.x0 && z >= this.z0 && x <= this.x0 + this.size && z <= this.z0 + this.size;
  }
  height(x, z) {
    const fx = clamp((x - this.x0) / this.step, 0, this.res - 1e-4);
    const fz = clamp((z - this.z0) / this.step, 0, this.res - 1e-4);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const n = this.res + 1, H = this.heights;
    const h00 = H[iz * n + ix], h10 = H[iz * n + ix + 1], h01 = H[(iz + 1) * n + ix], h11 = H[(iz + 1) * n + ix + 1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }
  normal(x, z, out) {
    const e = this.step * 0.75;
    const hl = this.height(x - e, z), hr = this.height(x + e, z);
    const hd = this.height(x, z - e), hu = this.height(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }
  sphere(c, r, res) {
    if (!this.inside(c.x, c.z)) return false;
    const h = this.height(c.x, c.z);
    if (c.y - r > h + 0.05) return false;
    this.normal(c.x, c.z, res.normal);
    const dist = (c.y - h) * res.normal.y;
    if (dist >= r) return false;
    res.depth = r - dist;
    res.collider = this;
    return true;
  }
  ray(o, d, maxT, res) {
    const step = this.step * 0.5;
    // ne marcher que sur la portion du rayon au-dessus du terrain
    let t0 = 0, t1 = maxT;
    for (const [o0, d0, lo, hi] of [[o.x, d.x, this.x0, this.x0 + this.size], [o.z, d.z, this.z0, this.z0 + this.size]]) {
      if (Math.abs(d0) < 1e-9) { if (o0 < lo || o0 > hi) return false; continue; }
      let a = (lo - o0) / d0, b = (hi - o0) / d0;
      if (a > b) { const tt = a; a = b; b = tt; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    }
    if (t0 > t1) return false;
    maxT = t1;
    let t = t0;
    let prevT = t0;
    let prevAbove = null;
    while (t <= maxT) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (this.inside(x, z)) {
        const above = y > this.height(x, z);
        if (prevAbove === true && !above) {
          // raffinement par dichotomie
          let a = prevT, b = t;
          for (let i = 0; i < 10; i++) {
            const m = (a + b) / 2;
            const yy = o.y + d.y * m;
            if (yy > this.height(o.x + d.x * m, o.z + d.z * m)) a = m;
            else b = m;
          }
          res.t = b;
          this.normal(o.x + d.x * b, o.z + d.z * b, res.normal);
          res.collider = this;
          return true;
        }
        prevAbove = above;
      } else prevAbove = null;
      if (t >= maxT) break;
      prevT = t;
      t = Math.min(t + step, maxT);
    }
    return false;
  }
}

export class PhysicsWorld {
  constructor(cellSize = 10) {
    this.cell = cellSize;
    this.grid = new Map();
    this.dynamics = new Set();
    this.large = new Set(); // champs de hauteur et très gros objets
    this.all = new Set();
    this._list = [];
  }
  _key(ix, iz) { return ix * 73856093 ^ iz * 19349663; }
  add(col) {
    this.all.add(col);
    if (col.dynamic) { this.dynamics.add(col); return col; }
    const a = col.aabb;
    const cs = this.cell;
    const ix0 = Math.floor(a.minX / cs), ix1 = Math.floor(a.maxX / cs);
    const iz0 = Math.floor(a.minZ / cs), iz1 = Math.floor(a.maxZ / cs);
    if ((ix1 - ix0 + 1) * (iz1 - iz0 + 1) > 400) { this.large.add(col); return col; }
    col._cells = [];
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const k = this._key(ix, iz);
        let arr = this.grid.get(k);
        if (!arr) { arr = []; this.grid.set(k, arr); }
        arr.push(col);
        col._cells.push(arr);
      }
    }
    return col;
  }
  remove(col) {
    this.all.delete(col);
    this.dynamics.delete(col);
    this.large.delete(col);
    if (col._cells) for (const arr of col._cells) {
      const i = arr.indexOf(col);
      if (i >= 0) arr.splice(i, 1);
    }
    col._cells = null;
  }
  clear() {
    this.grid.clear(); this.dynamics.clear(); this.large.clear(); this.all.clear();
  }
  // Candidats dont l'AABB recoupe la boîte donnée
  query(minX, minY, minZ, maxX, maxY, maxZ) {
    const out = this._list;
    out.length = 0;
    const stamp = ++stampCounter;
    const B = _qb;
    B[0] = minX; B[1] = minY; B[2] = minZ; B[3] = maxX; B[4] = maxY; B[5] = maxZ;
    const cs = this.cell;
    const ix0 = Math.floor(minX / cs), ix1 = Math.floor(maxX / cs);
    const iz0 = Math.floor(minZ / cs), iz1 = Math.floor(maxZ / cs);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const arr = this.grid.get(this._key(ix, iz));
        if (arr) for (let i = 0; i < arr.length; i++) qtest(arr[i], stamp, out);
      }
    }
    for (const c of this.dynamics) qtest(c, stamp, out);
    for (const c of this.large) qtest(c, stamp, out);
    return out;
  }
  // Contacts d'une sphère : renvoie un tableau de { normal, depth, collider }
  sphereContacts(c, r, out, filter) {
    out.length = 0;
    const list = this.query(c.x - r, c.y - r, c.z - r, c.x + r, c.y + r, c.z + r);
    for (let i = 0; i < list.length; i++) {
      const col = list[i];
      if (!col.solid || (filter && !filter(col))) continue;
      const res = _contactPool[out.length] || (_contactPool[out.length] = { normal: new THREE.Vector3(), depth: 0, collider: null });
      if (col.sphere(c, r, res)) out.push(res);
    }
    return out;
  }
  raycast(o, d, maxT, filter) {
    const ex = o.x + d.x * maxT, ey = o.y + d.y * maxT, ez = o.z + d.z * maxT;
    const list = this.query(
      Math.min(o.x, ex), Math.min(o.y, ey), Math.min(o.z, ez),
      Math.max(o.x, ex), Math.max(o.y, ey), Math.max(o.z, ez),
    );
    let best = null;
    let bestT = maxT;
    for (let i = 0; i < list.length; i++) {
      const col = list[i];
      if (!col.solid || (filter && !filter(col))) continue;
      if (col.ray(o, d, bestT, _rayRes) && _rayRes.t <= bestT) {
        bestT = _rayRes.t;
        best = best || { t: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), collider: null };
        best.t = _rayRes.t;
        best.normal.copy(_rayRes.normal);
        best.collider = col;
      }
    }
    if (best) best.point.copy(d).multiplyScalar(best.t).add(o);
    return best;
  }
  // Hauteur du sol sous (x, y, z) : lance un rayon vers le bas
  groundBelow(x, y, z, maxDist = 50, filter) {
    _go.set(x, y, z);
    return this.raycast(_go, _gd, maxDist, filter);
  }
}
const _contactPool = [];
const _qb = new Float64Array(6);
function qtest(c, stamp, out) {
  if (c._stamp === stamp || !c.enabled) return;
  c._stamp = stamp;
  const a = c.aabb, B = _qb;
  if (a.maxX < B[0] || a.minX > B[3] || a.maxY < B[1] || a.minY > B[4] || a.maxZ < B[2] || a.minZ > B[5]) return;
  out.push(c);
}
const _go = new THREE.Vector3();
const _gd = new THREE.Vector3(0, -1, 0);
const _rayRes = { t: 0, normal: new THREE.Vector3(), collider: null };
