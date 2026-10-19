// Cœur de calcul de la sculpture SDF, sans dépendance : utilisable dans le fil principal comme dans un Worker.
// Entrée : primitives « à plat » (matrice modèle → local, paramètres, boîte englobante en espace modèle).
// Sortie : tableaux typés prêts pour une BufferGeometry skinnée.

// ------------------------------------------------------------------ fonctions de distance (repère local)
function sdEllipsoid(x, y, z, rx, ry, rz) {
  const ax = x / rx, ay = y / ry, az = z / rz;
  const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
  const bx = x / (rx * rx), by = y / (ry * ry), bz = z / (rz * rz);
  const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
  if (k1 < 1e-9) return -Math.min(rx, ry, rz);
  return (k0 * (k0 - 1)) / k1;
}
// cône arrondi entre a et b (rayons r1, r2) — formule exacte d'Inigo Quilez
function sdRoundCone(px, py, pz, P) {
  const bax = P.bx - P.ax, bay = P.by - P.ay, baz = P.bz - P.az;
  const l2 = P.l2, rr = P.r1 - P.r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const pax = px - P.ax, pay = py - P.ay, paz = pz - P.az;
  const y = pax * bax + pay * bay + paz * baz;
  const z = y - l2;
  const xx = pax * l2 - bax * y, xy = pay * l2 - bay * y, xz = paz * l2 - baz * y;
  const x2 = xx * xx + xy * xy + xz * xz;
  const y2 = y * y * l2, z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - P.r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - P.r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - P.r1;
}
function sdRBox(x, y, z, hx, hy, hz, r) {
  const qx = Math.abs(x) - hx + r, qy = Math.abs(y) - hy + r, qz = Math.abs(z) - hz + r;
  const mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0);
  return Math.sqrt(mx * mx + my * my + mz * mz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - r;
}
// prisme hexagonal d'axe Y (apothème r, demi-hauteur h, arrondi rnd) — un écrou !
function sdHex(x, y, z, r, h, rnd) {
  const kx = -0.8660254, ky = 0.5, kz = 0.57735;
  let px = Math.abs(x), pz = Math.abs(z);
  const py = Math.abs(y);
  const d0 = 2 * Math.min(kx * px + ky * pz, 0);
  px -= d0 * kx; pz -= d0 * ky;
  const rr = r - rnd;
  const cx = Math.max(-kz * rr, Math.min(kz * rr, px));
  const dx = Math.hypot(px - cx, pz - rr) * Math.sign(pz - rr);
  const dy = py - (h - rnd);
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - rnd;
}
function sdTorus(x, y, z, R, r) {
  const qx = Math.sqrt(x * x + z * z) - R;
  return Math.sqrt(qx * qx + y * y) - r;
}
function sdCyl(x, y, z, r, h, rnd) {
  const dx = Math.sqrt(x * x + z * z) - r + rnd, dy = Math.abs(y) - h + rnd;
  const mx = Math.max(dx, 0), my = Math.max(dy, 0);
  return Math.min(Math.max(dx, dy), 0) + Math.sqrt(mx * mx + my * my) - rnd;
}
const smin = (a, b, k) => {
  if (k <= 0) return a < b ? a : b;
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const smax = (a, b, k) => -smin(-a, -b, k);

// bruit de valeur 3D (duvet, touffes, rouille)
function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), ux), l(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), ux), uy),
    l(l(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), ux), l(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), ux), uy),
    uz,
  ) * 2 - 1;
}

function shape(P, lx, ly, lz) {
  switch (P.t) {
    case 'sph': return Math.sqrt(lx * lx + ly * ly + lz * lz) - P.r;
    case 'ell': return sdEllipsoid(lx, ly, lz, P.r[0], P.r[1], P.r[2]);
    case 'cone': return sdRoundCone(lx, ly, lz, P);
    case 'box': return sdRBox(lx, ly, lz, P.s[0], P.s[1], P.s[2], P.round ?? 0.01);
    case 'torus': return sdTorus(lx, ly, lz, P.R, P.r);
    case 'cyl': return sdCyl(lx, ly, lz, P.r, P.h, P.round ?? 0.005);
    case 'hex': return sdHex(lx, ly, lz, P.r, P.h, P.round ?? 0.005);
  }
  return 1e9;
}
export function primDist(P, x, y, z) {
  const e = P.inv;
  const lx = e[0] * x + e[4] * y + e[8] * z + e[12];
  const ly = e[1] * x + e[5] * y + e[9] * z + e[13];
  const lz = e[2] * x + e[6] * y + e[10] * z + e[14];
  let d;
  if (P.sc) {
    // forme aplatie : distance approchée (multipliée par la plus petite échelle)
    const sx = P.sc[0], sy = P.sc[1], sz = P.sc[2];
    d = shape(P, lx / sx, ly / sy, lz / sz) * Math.min(sx, sy, sz);
  } else d = shape(P, lx, ly, lz);
  if (P.fuzz) d += P.fuzz[0] * vnoise(lx * P.fuzz[1], ly * P.fuzz[1], lz * P.fuzz[1]);
  return d;
}
const inBox = (b, x, y, z) => x >= b[0] && y >= b[1] && z >= b[2] && x <= b[3] && y <= b[4] && z <= b[5];

// champ complet en un point (évaluation séquentielle des opérations)
function fieldAt(shapes, x, y, z, far) {
  let f = far;
  for (let i = 0; i < shapes.length; i++) {
    const P = shapes[i];
    if (!inBox(P.box, x, y, z)) continue;
    const d = primDist(P, x, y, z);
    f = P.op === 'add' ? smin(f, d, P.k) : smax(f, -d, P.k);
  }
  return f;
}

// prims : primitives préparées ; pal : [{ c:[r,g,b], s:[rough, metal, sheen, fur, vernis] }]
// o : { cell, skinSoft, colorSoft, ao }
export function meshPrims(prims, pal, o = {}) {
  const t0 = Date.now();
  const shapes = prims.filter((p) => p.op !== 'paint');
  const paints = prims.filter((p) => p.op === 'paint');
  const cell = o.cell ?? 0.012;
  const kMax = Math.max(0, ...shapes.map((p) => p.k));
  const far = Math.max(kMax * 1.05, cell * 3);
  // grille
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const P of shapes) if (P.op === 'add') for (let i = 0; i < 3; i++) { bb[i] = Math.min(bb[i], P.box[i]); bb[i + 3] = Math.max(bb[i + 3], P.box[i + 3]); }
  for (let i = 0; i < 3; i++) { bb[i] -= cell * 2; bb[i + 3] += cell * 2; }
  const nx = Math.ceil((bb[3] - bb[0]) / cell) + 1;
  const ny = Math.ceil((bb[4] - bb[1]) / cell) + 1;
  const nz = Math.ceil((bb[5] - bb[2]) / cell) + 1;
  const ox = bb[0], oy = bb[1], oz = bb[2];
  const F = new Float32Array(nx * ny * nz).fill(far);
  const sxy = nx * ny;
  for (const P of shapes) {
    const b = P.box;
    const i0 = Math.max(0, Math.floor((b[0] - ox) / cell)), i1 = Math.min(nx - 1, Math.ceil((b[3] - ox) / cell));
    const j0 = Math.max(0, Math.floor((b[1] - oy) / cell)), j1 = Math.min(ny - 1, Math.ceil((b[4] - oy) / cell));
    const k0 = Math.max(0, Math.floor((b[2] - oz) / cell)), k1 = Math.min(nz - 1, Math.ceil((b[5] - oz) / cell));
    const add = P.op === 'add', k = P.k;
    for (let kk = k0; kk <= k1; kk++) {
      const z = oz + kk * cell;
      for (let jj = j0; jj <= j1; jj++) {
        const y = oy + jj * cell;
        let idx = i0 + jj * nx + kk * sxy;
        for (let ii = i0; ii <= i1; ii++, idx++) {
          const d = primDist(P, ox + ii * cell, y, z);
          const f = F[idx];
          F[idx] = add ? smin(f, d, k) : smax(f, -d, k);
        }
      }
    }
  }
  const t1 = Date.now();
  // ---------------- surface nets
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cellVert = new Int32Array(cx * cy * cz).fill(-1);
  const pos = [];
  const v = new Float32Array(8);
  const EDGES = [0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7];
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const val = F[(i + (c & 1)) + (j + ((c >> 1) & 1)) * nx + (k + ((c >> 2) & 1)) * sxy];
      v[c] = val;
      if (val < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (let e = 0; e < 24; e += 2) {
      const a = EDGES[e], b = EDGES[e + 1];
      if ((v[a] < 0) === (v[b] < 0)) continue;
      const t = v[a] / (v[a] - v[b]);
      sx += (a & 1) + (((b & 1) - (a & 1)) * t);
      sy += ((a >> 1) & 1) + ((((b >> 1) & 1) - ((a >> 1) & 1)) * t);
      sz += ((a >> 2) & 1) + ((((b >> 2) & 1) - ((a >> 2) & 1)) * t);
      n++;
    }
    cellVert[i + j * cx + k * cx * cy] = pos.length / 3;
    pos.push(ox + (i + sx / n) * cell, oy + (j + sy / n) * cell, oz + (k + sz / n) * cell);
  }
  const idx = [];
  const cxy = cx * cy;
  const cid = (i, j, k) => cellVert[i + j * cx + k * cxy];
  const dd2 = (p, q) => { const x = pos[p * 3] - pos[q * 3], y = pos[p * 3 + 1] - pos[q * 3 + 1], z = pos[p * 3 + 2] - pos[q * 3 + 2]; return x * x + y * y + z * z; };
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) { const t = b; b = d; d = t; }
    // diagonale la plus courte
    if (dd2(a, c) < dd2(b, d)) idx.push(a, b, c, a, c, d);
    else idx.push(a, b, d, b, c, d);
  };
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    const c0 = cid(i, j, k);
    if (c0 < 0) continue;
    const f0 = F[i + j * nx + k * sxy] < 0;
    if (j > 0 && k > 0 && f0 !== (F[i + 1 + j * nx + k * sxy] < 0)) quad(c0, cid(i, j - 1, k), cid(i, j - 1, k - 1), cid(i, j, k - 1), !f0);
    if (k > 0 && i > 0 && f0 !== (F[i + (j + 1) * nx + k * sxy] < 0)) quad(c0, cid(i, j, k - 1), cid(i - 1, j, k - 1), cid(i - 1, j, k), !f0);
    if (i > 0 && j > 0 && f0 !== (F[i + j * nx + (k + 1) * sxy] < 0)) quad(c0, cid(i - 1, j, k), cid(i - 1, j - 1, k), cid(i, j - 1, k), !f0);
  }
  const t2 = Date.now();
  // ---------------- projection sur la surface exacte + normales par gradient
  const nv = pos.length / 3;
  const P3 = new Float32Array(pos);
  const N3 = new Float32Array(nv * 3);
  const h = cell * 0.25;
  const fa = (x, y, z) => fieldAt(shapes, x, y, z, far);
  for (let vI = 0; vI < nv; vI++) {
    let x = P3[vI * 3], y = P3[vI * 3 + 1], z = P3[vI * 3 + 2];
    let gx = 0, gy = 0, gz = 0;
    for (let it = 0; it < 2; it++) {
      // gradient « tétraédrique » : 4 évaluations donnent pente et valeur
      const a = fa(x + h, y - h, z - h), b = fa(x - h, y - h, z + h);
      const c = fa(x - h, y + h, z - h), dd = fa(x + h, y + h, z + h);
      const d = (a + b + c + dd) * 0.25;
      gx = a - b - c + dd; gy = -a - b + c + dd; gz = -a + b - c + dd;
      const gl = Math.hypot(gx, gy, gz) || 1;
      gx /= gl; gy /= gl; gz /= gl;
      const step = Math.max(-cell, Math.min(cell, d));
      x -= gx * step; y -= gy * step; z -= gz * step;
    }
    P3[vI * 3] = x; P3[vI * 3 + 1] = y; P3[vI * 3 + 2] = z;
    N3[vI * 3] = gx; N3[vI * 3 + 1] = gy; N3[vI * 3 + 2] = gz;
  }
  const t3 = Date.now();
  // ---------------- couleurs, surface, poids de peau, occlusion
  const colorSoft = o.colorSoft ?? 0.004;
  const skinSoft = o.skinSoft ?? 0.02;
  const aoDist = o.aoDist ?? Math.max(0.018, cell * 1.5);
  const COL = new Float32Array(nv * 3);
  const SURF = new Float32Array(nv * 4);
  const COAT = new Float32Array(nv);
  const SI = new Uint16Array(nv * 4);
  const SW = new Float32Array(nv * 4);
  const aoOn = o.ao !== false;
  const nearP = [], nearD = [];
  const bw = new Map();
  const s4 = [0, 0, 0, 0, 0];
  for (let vI = 0; vI < nv; vI++) {
    const x = P3[vI * 3], y = P3[vI * 3 + 1], z = P3[vI * 3 + 2];
    nearP.length = 0; nearD.length = 0;
    let dmin = Infinity;
    for (const P of shapes) {
      if (!inBox(P.box, x, y, z)) continue;
      // distance à la surface propre de la primitive : une forme noyée dans une autre ou une soustraction
      // qui n'a pas creusé ici sont loin, celles qui forment la surface sont à ~0
      const dd = Math.abs(primDist(P, x, y, z));
      nearP.push(P); nearD.push(dd);
      if (dd < dmin) dmin = dd;
    }
    let r = 0, g = 0, bl = 0, wsum = 0;
    s4[0] = s4[1] = s4[2] = s4[3] = s4[4] = 0;
    bw.clear();
    for (let n = 0; n < nearP.length; n++) {
      const P = nearP[n];
      const rel = Math.max(0, nearD[n] - dmin);
      if (P.colIdx >= 0) {
        const w = Math.exp(-rel / colorSoft);
        const pc = pal[P.colIdx];
        r += pc.c[0] * w; g += pc.c[1] * w; bl += pc.c[2] * w;
        for (let q = 0; q < 5; q++) s4[q] += (pc.s[q] || 0) * w;
        wsum += w;
      }
      if (P.op === 'add' && P.skin !== false) {
        const ws = Math.exp(-rel / (P.skinSoft ?? skinSoft));
        bw.set(P.boneIdx, (bw.get(P.boneIdx) || 0) + ws);
      }
    }
    if (wsum > 0) { r /= wsum; g /= wsum; bl /= wsum; for (let q = 0; q < 5; q++) s4[q] /= wsum; }
    // peinture
    for (const P of paints) {
      if (!inBox(P.box, x, y, z)) continue;
      const d = primDist(P, x, y, z);
      const fe = P.feather ?? 0.004;
      const f = Math.min(1, Math.max(0, 0.5 - d / (2 * fe)));
      if (f <= 0) continue;
      const pc = pal[P.colIdx];
      r += (pc.c[0] - r) * f; g += (pc.c[1] - g) * f; bl += (pc.c[2] - bl) * f;
      for (let q = 0; q < 5; q++) s4[q] += ((pc.s[q] || 0) - s4[q]) * f;
    }
    // occlusion ambiante par le champ (creux des aisselles, du cou…)
    let ao = 1;
    if (aoOn) {
      const nx_ = N3[vI * 3], ny_ = N3[vI * 3 + 1], nz_ = N3[vI * 3 + 2];
      let occ = 0, sc = 1;
      for (let s = 1; s <= 4; s++) {
        const dist = s * aoDist;
        const fd = fa(x + nx_ * dist, y + ny_ * dist, z + nz_ * dist);
        occ += (dist - Math.min(fd, dist)) / aoDist * sc;
        sc *= 0.6;
      }
      ao = Math.max(0.45, 1 - occ * 0.135);
    }
    COL[vI * 3] = r * ao; COL[vI * 3 + 1] = g * ao; COL[vI * 3 + 2] = bl * ao;
    SURF[vI * 4] = s4[0]; SURF[vI * 4 + 1] = s4[1]; SURF[vI * 4 + 2] = s4[2]; SURF[vI * 4 + 3] = s4[3];
    COAT[vI] = s4[4];
    // 4 os les plus influents
    const top = [...bw.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const tot = top.reduce((a, e) => a + e[1], 0) || 1;
    for (let q = 0; q < top.length; q++) { SI[vI * 4 + q] = top[q][0]; SW[vI * 4 + q] = top[q][1] / tot; }
    if (!top.length) SW[vI * 4] = 1;
  }
  const t4 = Date.now();
  const index = nv > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  return {
    position: P3, normal: N3, color: COL, surf: SURF, coat: COAT, skinIndex: SI, skinWeight: SW, index,
    stats: { verts: nv, tris: idx.length / 3, grid: [nx, ny, nz], ms: { field: t1 - t0, nets: t2 - t1, project: t3 - t2, attrs: t4 - t3 } },
  };
}
