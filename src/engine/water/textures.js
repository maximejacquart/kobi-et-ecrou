// Textures procédurales de l'eau, calculées une seule fois au lancement (toutes raccordables) :
//  - vagues : pentes d'un champ de houle (somme de sinus à vecteurs d'onde entiers) → normales de détail
//  - écume : bulles (cellules de Worley) + bruit de rupture + taches
//  - caustiques : photons réfractés par la houle et accumulés sur un fond plat (vrais réseaux lumineux)
import * as THREE from 'three';
import { rng } from '../util.js';

const cache = {};

function dataTex(data, size, linear = true) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = linear ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.generateMipmaps = linear;
  t.anisotropy = 8;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  t.userData.shared = true;
  return t;
}

// Champ de houle raccordable : renvoie hauteur et pentes (par unité de tuile) sur une grille N×N
function waveField(N, count, seed, fMin, fMax, slopePow) {
  const R = rng(seed);
  const h = new Float32Array(N * N), sx = new Float32Array(N * N), sy = new Float32Array(N * N);
  const su = new Float32Array(N), cu = new Float32Array(N), sv = new Float32Array(N), cv = new Float32Array(N);
  for (let w = 0; w < count; w++) {
    const f = fMin + Math.pow(R(), 1.7) * (fMax - fMin);
    const a = R() * Math.PI * 2;
    let kx = Math.round(Math.cos(a) * f), ky = Math.round(Math.sin(a) * f);
    if (!kx && !ky) kx = 1;
    const k = Math.hypot(kx, ky);
    const amp = Math.pow(k, -slopePow) * (0.6 + R() * 0.8);
    const ph = R() * Math.PI * 2;
    for (let i = 0; i < N; i++) {
      const A = (2 * Math.PI * kx * i) / N + ph, B = (2 * Math.PI * ky * i) / N;
      su[i] = Math.sin(A); cu[i] = Math.cos(A); sv[i] = Math.sin(B); cv[i] = Math.cos(B);
    }
    const gx = amp * 2 * Math.PI * kx, gy = amp * 2 * Math.PI * ky;
    for (let y = 0; y < N; y++) {
      const s2 = sv[y], c2 = cv[y];
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        // sin(A+B) et sa dérivée cos(A+B), sans trigonométrie dans la boucle
        const s = su[x] * c2 + cu[x] * s2;
        const c = cu[x] * c2 - su[x] * s2;
        h[i] += amp * s;
        sx[i] += gx * c;
        sy[i] += gy * c;
      }
    }
  }
  return { h, sx, sy };
}

// Vagues de détail : R, G = pentes (biaisées autour de 0,5), B = hauteur, A = petite houle indépendante
export function waveTexture() {
  if (cache.waves) return cache.waves;
  const N = 256;
  // spectre en loi de puissance (pentes qui décroissent avec la fréquence : surface lisible, pas de grain)
  const big = waveField(N, 140, 11, 2, 30, 1.8);
  const fine = waveField(N, 64, 29, 10, 44, 1.3);
  let ms = 0, mh = 0, mf = 0;
  for (let i = 0; i < N * N; i++) {
    ms = Math.max(ms, Math.abs(big.sx[i]), Math.abs(big.sy[i]));
    mh = Math.max(mh, Math.abs(big.h[i]));
    mf = Math.max(mf, Math.abs(fine.h[i]));
  }
  const data = new Uint8Array(N * N * 4);
  // pentes normalisées : |pente| ≤ 1 sur la tuile (le shader les remet à l'échelle)
  const ks = 0.5 / ms;
  for (let i = 0; i < N * N; i++) {
    data[i * 4] = Math.round((0.5 + big.sx[i] * ks) * 255);
    data[i * 4 + 1] = Math.round((0.5 + big.sy[i] * ks) * 255);
    data[i * 4 + 2] = Math.round((0.5 + (big.h[i] / mh) * 0.5) * 255);
    data[i * 4 + 3] = Math.round((0.5 + (fine.h[i] / mf) * 0.5) * 255);
  }
  cache.waves = dataTex(data, N);
  cache.wavesField = big;
  return cache.waves;
}

// Bruit de valeur raccordable (période p cellules)
function vnoise(x, y, p, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const hh = (a, b) => {
    a = ((a % p) + p) % p; b = ((b % p) + p) % p;
    let t = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(seed, 1442695041);
    t = Math.imul(t ^ (t >>> 13), 1274126177);
    return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
  };
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hh(xi, yi), b = hh(xi + 1, yi), c = hh(xi, yi + 1), d = hh(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, p, oct, seed) {
  let s = 0, a = 0.5, n = 0;
  for (let o = 0; o < oct; o++) { s += a * vnoise(x, y, p, seed + o * 17); n += a; x *= 2; y *= 2; p *= 2; a *= 0.5; }
  return s / n;
}
// Worley raccordable : distance au point le plus proche (F1) et au second (F2), cellules de taille 1/p
function worley(u, v, p, seed, out) {
  const x = u * p, y = v * p;
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 9, f2 = 9;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i, cy = yi + j;
      const wx = ((cx % p) + p) % p, wy = ((cy % p) + p) % p;
      let t = Math.imul(wx, 2246822519) ^ Math.imul(wy, 3266489917) ^ Math.imul(seed, 668265263);
      t = Math.imul(t ^ (t >>> 15), 2654435761);
      const t2 = Math.imul(t ^ (t >>> 13), 1274126177);
      const rx = (t >>> 16) / 65535, ry = (t2 >>> 16) / 65535;
      const dx = cx + rx - x, dy = cy + ry - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
  }
  out[0] = f1; out[1] = f2;
  return out;
}

// Écume : R = bulles (cellules), G = bruit de rupture (fbm), B = fissures (F2 - F1, pour la croûte et la glace),
// A = taches larges (plaques d'écume, givre)
export function foamTexture() {
  if (cache.foam) return cache.foam;
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  const w = [0, 0];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      // dentelle d'écume : parois de bulles claires (bords des cellules), deux tailles
      worley(u, v, 16, 3, w);
      const e1 = 1 - Math.min(1, (w[1] - w[0]) / 0.22);
      const c1 = Math.min(1, w[0] * 2.2);
      worley(u, v, 34, 7, w);
      const e2 = 1 - Math.min(1, (w[1] - w[0]) / 0.2);
      const bub = Math.min(1, Math.max(e1 * (0.55 + 0.45 * c1), e2 * 0.85));
      const n = fbm(u * 8, v * 8, 8, 4, 5);
      worley(u, v, 9, 13, w);
      const crack = Math.min(1, Math.max(0, (w[1] - w[0]) * 5));
      const blot = fbm(u * 4, v * 4, 4, 4, 41);
      const i = (y * N + x) * 4;
      data[i] = bub * 255;
      data[i + 1] = n * 255;
      data[i + 2] = crack * 255;
      data[i + 3] = blot * 255;
    }
  }
  cache.foam = dataTex(data, N);
  return cache.foam;
}

// Caustiques : chaque photon d'une grille fine est dévié par la pente de la houle puis accumulé au fond ;
// les plis de la surface concentrent la lumière en filaments (raccordable car la houle l'est).
export function causticsTexture() {
  if (cache.caustics) return cache.caustics;
  const N = 256, P = 768;
  const f = waveField(128, 70, 53, 2, 9, 1.5);
  const M = 128;
  let ms = 0;
  for (let i = 0; i < M * M; i++) ms = Math.max(ms, Math.hypot(f.sx[i], f.sy[i]));
  const acc = new Float32Array(N * N);
  // profondeur de projection (en tuiles) : assez pour plier la lumière en réseaux nets
  const k = 0.06 / ms;
  for (let py = 0; py < P; py++) {
    for (let px = 0; px < P; px++) {
      const u = (px + 0.5) / P, v = (py + 0.5) / P;
      // pente bilinéaire du champ (128²)
      const fx = u * M - 0.5, fy = v * M - 0.5;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const ix0 = (x0 + M) % M, iy0 = (y0 + M) % M, ix1 = (ix0 + 1) % M, iy1 = (iy0 + 1) % M;
      const s = (arr) => (arr[iy0 * M + ix0] * (1 - tx) + arr[iy0 * M + ix1] * tx) * (1 - ty) + (arr[iy1 * M + ix0] * (1 - tx) + arr[iy1 * M + ix1] * tx) * ty;
      const du = -s(f.sx) * k, dv = -s(f.sy) * k;
      const gx = (u + du) * N - 0.5, gy = (v + dv) * N - 0.5;
      const gx0 = Math.floor(gx), gy0 = Math.floor(gy), ax = gx - gx0, ay = gy - gy0;
      const a0 = ((gx0 % N) + N) % N, b0 = ((gy0 % N) + N) % N, a1 = (a0 + 1) % N, b1 = (b0 + 1) % N;
      acc[b0 * N + a0] += (1 - ax) * (1 - ay);
      acc[b0 * N + a1] += ax * (1 - ay);
      acc[b1 * N + a0] += (1 - ax) * ay;
      acc[b1 * N + a1] += ax * ay;
    }
  }
  // léger flou (3×3) puis contraste : fond sombre, filaments brillants
  const mean = (P * P) / (N * N);
  const out = new Float32Array(N * N);
  let mx = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let s = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const wgt = (i === 0 ? 2 : 1) * (j === 0 ? 2 : 1);
        s += acc[((y + j + N) % N) * N + ((x + i + N) % N)] * wgt;
      }
      const c = Math.pow(s / 16 / mean, 1.6);
      out[y * N + x] = c;
      mx = Math.max(mx, c);
    }
  }
  const data = new Uint8Array(N * N * 4);
  const norm = 1 / Math.min(mx, 6);
  for (let i = 0; i < N * N; i++) {
    const c = Math.min(1, out[i] * norm);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = c * 255;
    data[i * 4 + 3] = 255;
  }
  cache.caustics = dataTex(data, N);
  return cache.caustics;
}
