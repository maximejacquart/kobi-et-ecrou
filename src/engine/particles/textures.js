// Textures des effets, générées au lancement : bouffées de fumée avec relief (normales + densité + détail),
// trace de brûlure, et géométrie des éclats de débris.
import * as THREE from 'three';
import { fbm2, rng } from '../util.js';

// Atlas 4 × 2 de bouffées 128 px, contenues dans le disque central (rayon 0,64) : le quadrilatère dessiné est
// resserré d'autant (moins de pixels vides). r, g : normale (relief de la bouffée) · b : détail fin (flammes, érosion) · a : densité
// Variantes 0 à 5 : chou-fleur (amas de dômes de tailles variées, dont le relief accroche la lumière) ;
// 6 et 7 : volutes étirées et peu bombées (poussière, vapeur).
const SMOKE_VARIANTS = 8;
export function smokeAtlas() {
  const S = 128, W = S * 4, H = S * 2;
  const data = new Uint8Array(W * H * 4);
  const hgt = new Float32Array(S * S);
  const dens = new Float32Array(S * S);
  for (let v = 0; v < SMOKE_VARIANTS; v++) {
    const R = rng(91 + v * 37);
    const wispy = v >= 6;
    // dômes : gros au centre, plus petits vers le bord
    const blobs = [];
    const nb = wispy ? 0 : 22 + Math.floor(R() * 8);
    for (let i = 0; i < nb; i++) {
      const a = R() * Math.PI * 2, d = Math.pow(R(), 0.7) * 0.42;
      let r = (0.3 - d * 0.4) * (0.75 + R() * 0.5);
      const cx = Math.cos(a) * d, cy = Math.sin(a) * d * 0.9;
      r = Math.min(r, 0.6 - Math.hypot(cx, cy));
      if (r > 0.05) blobs.push([cx, cy, r]);
    }
    const ox = R() * 50, oy = R() * 50;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const px = (x + 0.5) / S * 2 - 1, py = (y + 0.5) / S * 2 - 1;
        let h = 0, dd;
        if (px * px + py * py > 0.42) { hgt[y * S + x] = 0; dens[y * S + x] = 0; continue; }
        if (wispy) {
          // volute : bruit étiré dans une ellipse, relief faible
          const n = fbm2(px * 2.8 + ox, py * 6.5 + oy, 5, v);
          const e = Math.hypot(px * 1.55, py * 2.9);
          const m = Math.max(0, 1 - e);
          dd = Math.max(0, Math.min(1, (n * 1.25 - 0.35) * 2.2)) * m * m * (3 - 2 * m);
          h = dd * 0.22;
        } else {
          for (const [cx, cy, r] of blobs) {
            const dx = px - cx, dy = py - cy;
            const q = r * r - dx * dx - dy * dy;
            if (q > 0) { const hh = Math.sqrt(q); if (hh > h) h = hh; }
          }
          // grain de surface et bord effiloché
          const n = fbm2(px * 5 + ox, py * 5 + oy, 4, v);
          if (h > 0) h += (n - 0.5) * 0.05;
          const edgeN = fbm2(px * 3.2 + oy, py * 3.2 + ox, 4, v + 50);
          const k = Math.min(1, Math.max(0, h / 0.32));
          dd = k * k * (3 - 2 * k) * (0.6 + 0.4 * n);
          const w = Math.min(1, Math.max(0, (edgeN - 0.3) * 2.2 + h * 4));
          dd *= w * w * (3 - 2 * w);
        }
        hgt[y * S + x] = Math.max(0, h);
        dens[y * S + x] = Math.max(0, Math.min(1, dd));
      }
    }
    const tx = (v % 4) * S, ty = Math.floor(v / 4) * S;
    const dp = 2 / S;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const hx = (hgt[y * S + Math.min(S - 1, x + 1)] - hgt[y * S + Math.max(0, x - 1)]) / (2 * dp);
        const hy = (hgt[Math.min(S - 1, y + 1) * S + x] - hgt[Math.max(0, y - 1) * S + x]) / (2 * dp);
        let nx = -hx * 0.7, ny = -hy * 0.7, nz = 1;
        const l = Math.hypot(nx, ny, nz);
        nx /= l; ny /= l; nz /= l;
        const det = fbm2(x * 0.09 + v * 7, y * 0.09 + v * 3, 4, 300 + v);
        const o = ((ty + y) * W + tx + x) * 4;
        data[o] = Math.round((nx * 0.5 + 0.5) * 255);
        data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        data[o + 2] = Math.round(det * 255);
        data[o + 3] = Math.round(dens[y * S + x] * 255);
      }
    }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

// Trace de brûlure : cœur charbonneux, auréole irrégulière, projections
export function scorchTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = x / S * 2 - 1, py = y / S * 2 - 1;
      const r = Math.hypot(px, py);
      const a = Math.atan2(py, px);
      const n = fbm2(Math.cos(a) * 2 + 5, Math.sin(a) * 2 + 5, 4, 7);
      const edge = 0.55 + n * 0.45;
      const core = Math.max(0, 1 - r / edge);
      const grain = fbm2(px * 9, py * 9, 3, 11);
      let al = Math.pow(core, 0.6) * (0.55 + grain * 0.45);
      // rayons de projection
      const ray = Math.pow(Math.max(0, Math.sin(a * 9 + n * 6)), 6) * Math.max(0, 1 - r) * 0.5;
      al = Math.min(1, al + ray * (r > 0.3 ? 1 : 0));
      const o = (y * S + x) * 4;
      img.data[o] = 18 + grain * 14; img.data[o + 1] = 12 + grain * 9; img.data[o + 2] = 10 + grain * 6;
      img.data[o + 3] = Math.round(al * 235);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Éclat de débris : icosaèdre bosselé, facettes franches
export function chunkGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const p = g.attributes.position;
  const R = rng(5);
  const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!map.has(key)) map.set(key, 0.65 + R() * 0.5);
    const k = map.get(key);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.8, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}
