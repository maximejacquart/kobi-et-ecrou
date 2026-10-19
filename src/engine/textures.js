// Textures procédurales générées sur canvas (raccordables), avec cartes de normales dérivées.
import * as THREE from 'three';
import { fbm2, noise2, clamp, rng } from './util.js';

const cache = new Map();

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

// Remplit un canvas pixel par pixel. fn(u, v, out) écrit r,g,b (0..1) et renvoie une hauteur optionnelle.
function paint(size, fn) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const heights = new Float32Array(size * size);
  const out = [0, 0, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const h = fn(x / size, y / size, out) ?? 0.5;
      const i = (y * size + x) * 4;
      img.data[i] = clamp(out[0], 0, 1) * 255;
      img.data[i + 1] = clamp(out[1], 0, 1) * 255;
      img.data[i + 2] = clamp(out[2], 0, 1) * 255;
      img.data[i + 3] = 255;
      heights[y * size + x] = h;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, heights, size };
}

function normalMap(heights, size, strength) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const H = (x, y) => heights[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = (-dx / l * 0.5 + 0.5) * 255;
      img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function toTex(c, srgb = true, repeat = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

export function build(key, size, fn, normalStrength = 0) {
  if (cache.has(key)) return cache.get(key);
  const { canvas: c, heights } = paint(size, fn);
  const res = { map: toTex(c), canvas: c };
  res.map.userData.shared = true;
  if (normalStrength) { res.normalMap = toTex(normalMap(heights, size, normalStrength), false); res.normalMap.userData.shared = true; }
  cache.set(key, res);
  return res;
}

const mix = (a, b, t) => a + (b - a) * t;
export const mix3 = (out, a, b, t) => {
  out[0] = mix(a[0], b[0], t); out[1] = mix(a[1], b[1], t); out[2] = mix(a[2], b[2], t);
  return out;
};
export const hex = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };

// ---- Sable ondulé (Brikka) ----
export function sandTexture() {
  const A = hex('#f2b56b'), B = hex('#d98a4a'), C = hex('#ffd9a0');
  return build('sand', 512, (u, v, o) => {
    const n = fbm2(u * 8, v * 8, 4, 3, 8);
    const warp = fbm2(u * 4 + 7, v * 4, 3, 5, 4) * 2.5;
    const rip = Math.sin((v * 22 + warp * 3 + n * 2) * Math.PI * 2) * 0.5 + 0.5;
    const ripple = Math.pow(rip, 3);
    mix3(o, B, A, 0.45 + n * 0.6);
    mix3(o, o, C, ripple * 0.35);
    const speck = noise2(u * 180, v * 180, 9, 180);
    if (speck > 0.86) { o[0] *= 0.82; o[1] *= 0.78; o[2] *= 0.75; }
    return ripple * 0.6 + n * 0.4;
  }, 2.5);
}

// ---- Roche stratifiée (falaises) ----
export function rockTexture(variant = 'red') {
  const pal = {
    red: [hex('#a9573a'), hex('#cf8656'), hex('#6c3828'), hex('#f1d2a2')],
    sandstone: [hex('#b9805a'), hex('#dcae80'), hex('#7c4e36'), hex('#f6e0bc')],
    grey: [hex('#6f6a80'), hex('#9a93ab'), hex('#47435a'), hex('#c4bdd4')],
    purple: [hex('#6a4a8c'), hex('#9b74c2'), hex('#3f2b5a'), hex('#d0b0f0')],
    ice: [hex('#5f7fa8'), hex('#a3c4e6'), hex('#34486a'), hex('#eef8ff')],
    jungle: [hex('#34463f'), hex('#56705f'), hex('#1a2624'), hex('#8ac4a0')],
  }[variant];
  return build('rock-' + variant, 512, (u, v, o) => {
    const n = fbm2(u * 6, v * 6, 5, 11, 6);
    const band = Math.sin((v * 6 + n * 0.7) * Math.PI * 2) * 0.5 + 0.5;
    const band2 = Math.sin((v * 17 + n * 1.2) * Math.PI * 2) * 0.5 + 0.5;
    mix3(o, pal[0], pal[1], band * 0.45 + n * 0.45);
    mix3(o, o, pal[2], Math.pow(1 - band2, 8) * 0.35);
    // grain et blocs fracturés
    const blk = fbm2(u * 14, v * 7, 3, 33, 14);
    mix3(o, o, pal[2], Math.max(0, 0.42 - blk) * 0.8);
    const crack = Math.abs(fbm2(u * 10, v * 3, 3, 21, 10) - 0.5);
    if (crack < 0.014) mix3(o, o, pal[2], 0.38 * (1 - crack / 0.014));
    mix3(o, o, pal[3], Math.pow(n, 4) * 0.8);
    // fines strates claires
    const cream = Math.pow(Math.sin((v * 5 + n * 0.8) * Math.PI * 2) * 0.5 + 0.5, 10);
    mix3(o, o, pal[3], cream * 0.3);
    return band * 0.5 + n * 0.6 + cream * 0.2 - (crack < 0.014 ? 0.2 : 0);
  }, 4);
}

// ---- Neige poudreuse (Givrelune) : ombres bleutées, congères soufflées, paillettes ----
export function snowTexture() {
  const A = hex('#eef4ff'), B = hex('#bcd0f0'), C = hex('#ffffff'), D = hex('#9ab4e0');
  return build('snow', 512, (u, v, o) => {
    const n = fbm2(u * 6, v * 6, 4, 41, 6);
    const drift = Math.sin((u * 3 + v * 9 + fbm2(u * 3, v * 3, 3, 43, 3) * 2.2) * Math.PI * 2) * 0.5 + 0.5;
    mix3(o, B, A, 0.35 + n * 0.75);
    mix3(o, o, D, Math.pow(1 - drift, 6) * 0.25);
    const sp = noise2(u * 220, v * 220, 47, 220);
    if (sp > 0.93) mix3(o, o, C, 0.9);
    return n * 0.6 + drift * 0.25;
  }, 1.6);
}

// ---- Glace : bleu profond, fissures blanches, givre en plaques ----
export function iceTexture() {
  const A = hex('#7ec4ee'), B = hex('#3a86c8'), C = hex('#e8faff'), D = hex('#bfe8ff');
  return build('ice', 512, (u, v, o) => {
    const n = fbm2(u * 4, v * 4, 4, 51, 4);
    mix3(o, B, A, 0.3 + n * 0.8);
    // fissures (réseau de Voronoï approché par deux bruits pliés)
    const c1 = Math.abs(fbm2(u * 7, v * 7, 3, 53, 7) - 0.5);
    const c2 = Math.abs(fbm2(u * 13 + 3, v * 13, 2, 57, 13) - 0.5);
    if (c1 < 0.018) mix3(o, o, C, 0.75 * (1 - c1 / 0.018));
    if (c2 < 0.01) mix3(o, o, C, 0.4 * (1 - c2 / 0.01));
    const frost = fbm2(u * 9, v * 9, 3, 59, 9);
    mix3(o, o, D, Math.max(0, frost - 0.55) * 1.4);
    return n * 0.3 - (c1 < 0.018 ? 0.25 : 0) + frost * 0.2;
  }, 1.2);
}

// ---- Mousse de jungle (Luminbois) : vert sombre, litière de feuilles, spores luminescentes ----
export function mossTexture() {
  const A = hex('#2f6a4a'), B = hex('#163a2c'), C = hex('#5aa070'), D = hex('#7a5a3a');
  return build('moss', 512, (u, v, o) => {
    const n = fbm2(u * 7, v * 7, 4, 61, 7);
    mix3(o, B, A, 0.25 + n * 0.85);
    const leaf = fbm2(u * 22, v * 22, 2, 63, 22);
    if (leaf > 0.62) mix3(o, o, D, (leaf - 0.62) * 2.2);
    mix3(o, o, C, Math.pow(Math.max(0, fbm2(u * 3, v * 3, 3, 65, 3) - 0.5), 2) * 2.2);
    const sp = noise2(u * 160, v * 160, 67, 160);
    if (sp > 0.95) { o[0] = 0.55; o[1] = 1.0; o[2] = 0.85; }
    return n * 0.6 + leaf * 0.3;
  }, 2.2);
}

// ---- Pavés ronds (places de village) : cellules de Voronoï raccordables, joints de terre et de mousse ----
export function cobbleTexture() {
  const N = 9, R = rng(12);
  const pts = Array.from({ length: N * N }, () => [R(), R(), R()]);
  const cols = [hex('#d8cdb8'), hex('#c4bcb0'), hex('#cdbfaa'), hex('#b9b2bf'), hex('#e0d6c2')];
  const joint = hex('#6a6248'), moss = hex('#5e8a46');
  return build('cobble', 512, (u, v, o) => {
    const x = u * N, y = v * N, ix = Math.floor(x), iy = Math.floor(y);
    let d1 = 9, d2 = 9, c = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = ix + i, cy = iy + j;
      const k = (((cy % N) + N) % N) * N + (((cx % N) + N) % N);
      const d = Math.hypot(cx + 0.15 + pts[k][0] * 0.7 - x, cy + 0.15 + pts[k][1] * 0.7 - y);
      if (d < d1) { d2 = d1; d1 = d; c = k; } else if (d < d2) d2 = d;
    }
    const e = d2 - d1;
    const n = fbm2(u * 24, v * 24, 3, 71, 24);
    const base = cols[Math.floor(pts[c][2] * cols.length)];
    // pavé bombé, grain de la pierre, joint sombre où pousse la mousse
    mix3(o, base, [base[0] * 0.82, base[1] * 0.8, base[2] * 0.78], n * 0.6 + Math.max(0, 0.3 - e) * 1.2);
    const jt = 1 - clamp((e - 0.04) / 0.08, 0, 1);
    if (jt > 0) mix3(o, o, fbm2(u * 13, v * 13, 2, 73, 13) > 0.55 ? moss : joint, jt * 0.9);
    return clamp(Math.sqrt(Math.max(e, 0)) * 1.6, 0, 1) * 0.8 + n * 0.1;
  }, 3);
}

// ---- Écorce (arbres de Luminbois) ----
export function barkTexture() {
  const A = hex('#4a3a3a'), B = hex('#2a1e22'), C = hex('#6a5248');
  return build('bark', 512, (u, v, o) => {
    const n = fbm2(u * 4, v * 16, 4, 71, 4);
    const ridge = Math.abs(Math.sin((u * 18 + n * 2.5) * Math.PI));
    mix3(o, B, A, 0.4 + n * 0.6);
    mix3(o, o, C, Math.pow(ridge, 6) * 0.6);
    return ridge * 0.6 + n * 0.4;
  }, 3);
}

// ---- Herbe (Nimbara) ----
export function grassTexture() {
  const A = hex('#5cc456'), B = hex('#2f8f45'), C = hex('#b5ec6a'), D = hex('#1f6b3d');
  return build('grass', 512, (u, v, o) => {
    const n = fbm2(u * 6, v * 6, 4, 31, 6);
    const n2 = fbm2(u * 24, v * 24, 2, 41, 24);
    mix3(o, B, A, n * 0.9 + 0.05);
    mix3(o, o, C, Math.pow(n2, 3) * 0.7);
    mix3(o, o, D, Math.pow(1 - n, 5) * 0.8);
    return n2 * 0.5 + n * 0.5;
  }, 2);
}

// ---- Panneaux métalliques peints (usine, structures) ----
export function metalTexture(color = '#5d6b8a', key = 'metal', opts = {}) {
  const base = hex(color);
  const dark = base.map((c) => c * 0.55);
  const light = base.map((c) => Math.min(1, c * 1.25 + 0.05));
  const grid = opts.grid || 2;
  const rust = opts.rust ?? 0.25;
  const rustC = hex('#9a4e22');
  return build(key, 512, (u, v, o) => {
    const gu = (u * grid) % 1, gv = (v * grid) % 1;
    const n = fbm2(u * 8, v * 8, 4, 51, 8);
    mix3(o, base, light, n * 0.5);
    // jointures de panneaux
    const edge = Math.min(gu, 1 - gu, gv, 1 - gv);
    let h = 0.6;
    if (edge < 0.012) { mix3(o, o, dark, 0.9); h = 0.1; }
    else if (edge < 0.03) { mix3(o, o, light, 0.35); h = 0.75; }
    // rivets aux coins
    const rx = Math.min(gu, 1 - gu), ry = Math.min(gv, 1 - gv);
    const dr = Math.hypot(rx - 0.06, ry - 0.06);
    if (dr < 0.018) { mix3(o, o, light, 0.6); h = 1.0 - dr * 20; }
    // rayures et usure
    const scratch = noise2(u * 3, v * 140, 61, 0);
    if (scratch > 0.93) mix3(o, o, light, 0.4);
    const r = fbm2(u * 5 + 3, v * 5, 4, 71, 5);
    if (r > 0.68 - rust * 0.3) mix3(o, o, rustC, clamp((r - (0.68 - rust * 0.3)) * 6 * rust * 2, 0, 0.85));
    return h + n * 0.1;
  }, 3);
}

// ---- Bandes de danger jaune/noir ----
export function hazardTexture() {
  const Y = hex('#ffc21a'), K = hex('#1d1a22');
  return build('hazard', 256, (u, v, o) => {
    const s = ((u + v) * 4) % 1;
    mix3(o, Y, K, s < 0.5 ? 0 : 1);
    const n = fbm2(u * 8, v * 8, 3, 81, 8);
    if (n > 0.62) mix3(o, o, hex('#6b5a48'), (n - 0.62) * 2);
    return s < 0.5 ? 0.6 : 0.5;
  }, 1);
}

// ---- Caisse en bois cerclée de métal ----
export function crateTexture(kind = 'bolt') {
  const tint = { bolt: '#c98a4b', ammo: '#4a7fd1', health: '#43b06a', boom: '#d8452f', gold: '#e8b830' }[kind];
  const wood = hex(tint), woodD = wood.map((c) => c * 0.6), woodL = wood.map((c) => Math.min(1, c * 1.2));
  const steel = hex('#cfd6e4'), steelD = hex('#626b80');
  return build('crate-' + kind, 256, (u, v, o) => {
    const border = Math.min(u, 1 - u, v, 1 - v);
    const grain = fbm2(u * 2, v * 30, 3, 91, 0);
    const plank = Math.floor(v * 4);
    mix3(o, woodD, woodL, grain * 0.7 + (plank % 2) * 0.15);
    let h = 0.5 + grain * 0.2;
    if (Math.abs(((v * 4) % 1) - 0.5) > 0.47) { mix3(o, o, woodD, 0.8); h = 0.2; }
    // croisillon
    const diag = Math.min(Math.abs(u - v), Math.abs(u - (1 - v)));
    if (diag < 0.06 && border > 0.12) { mix3(o, woodL, wood, grain); h = 0.8; }
    if (border < 0.12) {
      mix3(o, steelD, steel, 0.5 + fbm2(u * 9, v * 9, 2, 95, 9) * 0.6);
      h = 0.9;
      if (border < 0.015) { mix3(o, o, steelD, 0.8); h = 0.6; }
      const cx = Math.min(u, 1 - u), cy = Math.min(v, 1 - v);
      if (Math.hypot(cx - 0.06, cy - 0.06) < 0.025) { mix3(o, o, [1, 1, 1], 0.5); h = 1.1; }
    }
    return h;
  }, 3);
}

// ---- Sol carrelé de station (usine) ----
export function floorTexture() {
  const A = hex('#4a5068'), B = hex('#565d78'), D = hex('#2a2e3e'), L = hex('#8a95b8'), Y = hex('#ffbf2a'), K = hex('#1a1a22');
  return build('floor', 512, (u, v, o) => {
    const P = 2; // plaques par texture
    const gu = (u * P) % 1, gv = (v * P) % 1;
    const tx = Math.floor(u * P), ty = Math.floor(v * P);
    const id = (tx * 7 + ty * 13) % 4;
    const n = fbm2(u * 9, v * 9, 4, 101, 9);
    mix3(o, A, B, n * 0.7 + (id % 2) * 0.15);
    const edge = Math.min(gu, 1 - gu, gv, 1 - gv);
    let h = 0.55;
    // biseau
    if (edge < 0.012) { mix3(o, o, K, 0.85); h = 0.05; }
    else if (edge < 0.035) { const k = (edge - 0.012) / 0.023; mix3(o, o, L, 0.35 * (1 - k)); h = 0.3 + k * 0.25; }
    // rivets
    const rx = Math.min(gu, 1 - gu), ry = Math.min(gv, 1 - gv);
    for (const [cx, cy] of [[0.06, 0.06], [0.06, 0.5], [0.5, 0.06]]) {
      const dr = Math.hypot(rx - cx, ry - cy);
      if (dr < 0.016) { mix3(o, o, L, 0.7 - dr * 25); h = 0.95 - dr * 20; }
    }
    // grille d'aération sur une plaque sur quatre
    if (id === 0) {
      const cx = Math.abs(gu - 0.5), cy = Math.abs(gv - 0.5);
      if (cx < 0.28 && cy < 0.18) {
        const slot = ((gv * 40) % 1) < 0.45;
        mix3(o, o, slot ? D : L, slot ? 0.9 : 0.25);
        h = slot ? 0.1 : 0.6;
        if (cx > 0.26 || cy > 0.16) { mix3(o, o, L, 0.4); h = 0.75; }
      }
    }
    // bande de signalisation sur une autre
    if (id === 2) {
      const s = gu > 0.08 && gu < 0.92 && gv > 0.42 && gv < 0.58;
      if (s) { mix3(o, o, (((gu + gv) * 16) % 1) < 0.5 ? Y : K, 0.8); h = 0.6; }
    }
    // usure et taches
    const w = fbm2(u * 4 + 9, v * 4, 4, 107, 4);
    if (w > 0.6) mix3(o, o, D, (w - 0.6) * 1.2);
    const sc = noise2(u * 2, v * 120, 109, 0);
    if (sc > 0.94) mix3(o, o, L, 0.25);
    return h + n * 0.08;
  }, 3);
}

// ---- Coque de station avec hublots éclairés (couleur + émission) ----
export function hullTexture() {
  if (cache.has('hull')) return cache.get('hull');
  const S = 256;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const e = document.createElement('canvas'); e.width = e.height = S;
  const x = c.getContext('2d'), y = e.getContext('2d');
  x.fillStyle = '#5a6078'; x.fillRect(0, 0, S, S);
  y.fillStyle = '#000'; y.fillRect(0, 0, S, S);
  const R = rng(55);
  for (let i = 0; i < 40; i++) {
    x.fillStyle = R() < 0.5 ? '#4e546c' : '#666d88';
    x.fillRect(Math.floor(R() * 8) * 32, Math.floor(R() * 8) * 32, 32 * (1 + Math.floor(R() * 2)), 32);
  }
  x.strokeStyle = '#2a2e3e'; x.lineWidth = 2;
  for (let i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(i * 32, 0); x.lineTo(i * 32, S); x.stroke(); x.beginPath(); x.moveTo(0, i * 32); x.lineTo(S, i * 32); x.stroke(); }
  for (let row = 0; row < 8; row++) {
    if (R() < 0.45) continue;
    for (let col = 0; col < 16; col++) {
      if (R() < 0.35) continue;
      const lit = R() < 0.75;
      const px = col * 16 + 4, py = row * 32 + 12;
      x.fillStyle = '#1a1c28'; x.fillRect(px, py, 8, 6);
      if (lit) { y.fillStyle = R() < 0.8 ? '#ffd9a0' : '#7fe8ff'; y.fillRect(px + 1, py + 1, 6, 4); }
    }
  }
  const map = new THREE.CanvasTexture(c), em = new THREE.CanvasTexture(e);
  for (const tt of [map, em]) { tt.wrapS = tt.wrapT = THREE.RepeatWrapping; tt.colorSpace = THREE.SRGBColorSpace; tt.anisotropy = 8; tt.userData.shared = true; }
  const res = { map, emissiveMap: em };
  cache.set('hull', res);
  return res;
}

// ---- Écorce / bois de structure ----
export function woodTexture() {
  const A = hex('#8a5a34'), B = hex('#5e3a22'), C = hex('#b07a46');
  return build('wood', 256, (u, v, o) => {
    const g = fbm2(u * 3, v * 24, 4, 111, 0);
    const ring = Math.sin((u * 10 + g * 4) * Math.PI * 2) * 0.5 + 0.5;
    mix3(o, B, A, ring * 0.7 + g * 0.3);
    mix3(o, o, C, Math.pow(g, 3));
    return ring * 0.4 + g * 0.5;
  }, 2);
}

// ---- Ferraille rouillée (décors de casse) ----
export function scrapTexture() {
  const A = hex('#8f5636'), B = hex('#5b3a2c'), C = hex('#c98552'), P = hex('#4d77a8'), Y = hex('#d9b23a');
  return build('scrap', 512, (u, v, o) => {
    const n = fbm2(u * 6, v * 6, 5, 121, 6);
    const cell = Math.floor(u * 3) + Math.floor(v * 3) * 3;
    const paint = [P, Y, A, P, C, Y, A, P, Y][cell % 9];
    mix3(o, B, A, n);
    const peel = fbm2(u * 9 + cell, v * 9, 4, 131, 9);
    if (peel > 0.48) mix3(o, o, paint, clamp((peel - 0.48) * 8, 0, 1) * 0.85);
    const gu = (u * 3) % 1, gv = (v * 3) % 1;
    const edge = Math.min(gu, 1 - gu, gv, 1 - gv);
    if (edge < 0.015) mix3(o, o, [0.15, 0.1, 0.08], 0.8);
    return peel > 0.48 ? 0.7 : 0.4 + n * 0.2;
  }, 3);
}

// ---- Tôle peinte de conteneur (les ondulations sont dans la géométrie) : 1 tuile = 4 m ----
export function containerTexture(color = '#c8452f', key) {
  const base = hex(color);
  const shade = (k, add = 0) => base.map((c) => Math.min(1, c * k + add));
  const deep = shade(0.74), mid = shade(1), pale = shade(1.14, 0.07);
  const rustD = hex('#4e2616'), rustL = hex('#b8622c'), grime = hex('#352820');
  return build('cont2-' + (key || color), 512, (u, v, o) => {
    // peinture marbrée, passée au soleil par endroits
    const n = fbm2(u * 4, v * 4, 5, 141, 4);
    mix3(o, deep, mid, clamp(n * 1.7 - 0.25, 0, 1));
    const sun = fbm2(u * 2 + 3, v * 2, 3, 161, 2);
    mix3(o, o, pale, clamp((sun - 0.52) * 2.4, 0, 0.5));
    let h = 0.5 + (n - 0.5) * 0.35;
    // coulures de crasse (colonnes étroites, interrompues)
    const colm = noise2(u * 56, 0.5, 191, 56);
    const run = fbm2(u * 6, v * 6, 3, 201, 6);
    mix3(o, o, grime, clamp((colm - 0.6) * 4, 0, 1) * clamp((run - 0.42) * 3, 0, 1) * 0.5);
    // rayures claires
    const sc = Math.abs(fbm2(u * 12, v * 12, 3, 211, 12) - 0.5);
    if (sc < 0.01) { mix3(o, o, pale, 0.55 * (1 - sc / 0.01)); h -= 0.12; }
    // rouille : cœur sombre, auréole orangée
    const r = fbm2(u * 7, v * 7, 5, 171, 7);
    if (r > 0.63) {
      const t = clamp((r - 0.63) * 8, 0, 1);
      mix3(o, o, rustL, t * 0.75);
      mix3(o, o, rustD, clamp((r - 0.72) * 5, 0, 0.4));
      h -= t * 0.25;
    }
    // bosses
    h += (fbm2(u * 3 + 5, v * 3, 3, 221, 3) - 0.5) * 0.5;
    return h;
  }, 1.6);
}

// =====================================================================================================================
// Matières réutilisables (objets du décor, cabanes…) : bois de planches, métal peint écaillé, tôle larmée, bardeaux.
// Toutes renvoient { map, normalMap } partagées (cache par clé). La salissure du bas des objets vient des couleurs de
// sommet : fusion des décors du niveau (automatique), ou grime() de environment/props.js pour les objets animés.
// =====================================================================================================================

// Bruit de valeur périodique à périodes distinctes en x et en y (grain étiré qui se raccorde quand même)
function hashP(x, y, seed) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function noiseP(x, y, px, py, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const wx = (k) => ((k % px) + px) % px, wy = (k) => ((k % py) + py) % py;
  const a = hashP(wx(xi), wy(yi), seed), b = hashP(wx(xi + 1), wy(yi), seed);
  const c = hashP(wx(xi), wy(yi + 1), seed), d = hashP(wx(xi + 1), wy(yi + 1), seed);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return mix(mix(a, b, u), mix(c, d, u), v);
}
export function fbmP(x, y, px, py, oct, seed) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noiseP(x * f, y * f, px * f, py * f, seed + i * 13); n += a; a *= 0.5; f *= 2; }
  return s / n;
}
// Rayures : un trait court au hasard dans une cellule sur trois d'une grille n × n ; renvoie la distance au trait
export function scratch(u, v, n, seed) {
  const x = u * n, y = v * n, cx = Math.floor(x), cy = Math.floor(y);
  let best = 9;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const ix = cx + i, iy = cy + j, wx = ((ix % n) + n) % n, wy = ((iy % n) + n) % n;
    if (hashP(wx, wy, seed) > 0.33) continue;
    const a = hashP(wx, wy, seed + 1) * Math.PI, l = 0.4 + hashP(wx, wy, seed + 2) * 0.7;
    const ox = ix + hashP(wx, wy, seed + 3), oy = iy + hashP(wx, wy, seed + 4);
    const dx = Math.cos(a), dy = Math.sin(a), px = x - ox, py = y - oy;
    const t = clamp(px * dx + py * dy, -l / 2, l / 2);
    best = Math.min(best, Math.hypot(px - dx * t, py - dy * t) / n);
  }
  return best;
}
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---- Planche de bois veiné : 1 tuile = UNE planche. v (0 → 1) traverse la largeur de la planche, u court le long du
// fil (raccordable en u). À poser avec plankBox() / plankPanel() de environment/props.js (u en mètres × échelle).
// o : { knots (nœuds, 0..2), wear (arêtes usées, éclaircies, 0..1), paint (couleur : peinture écaillée sur le bois),
//       chip (part de peinture partie, 0..1), seed, size (px) }
//   ex. plankTexture('#a8703f')                                        bois naturel (caisses, bardage brut)
//       plankTexture('#9a6a40', null, { paint: '#4d77a8', chip: 0.5 })   bardage peint usé
export function plankTexture(color = '#a8703f', key, o = {}) {
  const base = hex(color);
  const dark = base.map((c) => c * 0.6), light = base.map((c) => Math.min(1, c * 1.22 + 0.05)), bare = base.map((c) => Math.min(1, c * 1.35 + 0.1));
  const paint = o.paint ? hex(o.paint) : null;
  const paintD = paint && paint.map((c) => c * 0.82), paintL = paint && paint.map((c) => Math.min(1, c * 1.12 + 0.04));
  const wear = o.wear ?? 0.5, chip = o.chip ?? 0.35, knots = o.knots ?? 1;
  const R = rng(o.seed ?? 7);
  const kn = Array.from({ length: Math.round(knots * 2) }, () => [R(), 0.25 + R() * 0.5, 0.03 + R() * 0.03]);
  const k = key || [color, o.paint || '', wear, chip, knots, o.seed ?? 7].join('|');
  return build('plank-' + k, o.size || 256, (u, v, out) => {
    // déformation du fil autour des nœuds
    let warp = 0, knot = 0;
    for (const [ku, kv, kr] of kn) {
      let du = u - ku; du -= Math.round(du);
      const d = Math.hypot(du * 0.45, v - kv);
      warp += Math.exp(-d * d / (kr * kr * 9)) * (v - kv) * 1.6;
      knot = Math.max(knot, 1 - sstep(kr * 0.5, kr, d));
    }
    const g = fbmP(u * 3, v * 2, 3, 2, 3, 401);
    const ring = Math.sin(((v + warp) * 8 + g * 1.1) * Math.PI * 2) * 0.5 + 0.5;
    const fibre = noiseP(u * 5, v * 70, 5, 70, 409);
    mix3(out, dark, light, 0.3 + ring * 0.35 + (g - 0.5) * 0.5);
    mix3(out, out, dark, Math.pow(ring, 14) * 0.55 + (fibre > 0.7 ? 0.18 : 0));
    let h = 0.5 + ring * 0.12 + fibre * 0.08;
    if (knot > 0) { mix3(out, out, dark.map((c) => c * 0.7), knot * 0.85); h -= knot * 0.15; }
    // arêtes : bois clair usé, puis biseau sombre tout au bord
    const e = Math.min(v, 1 - v);
    const wn = fbmP(u * 8, v * 4, 8, 4, 2, 419);
    const worn = sstep(0.16 * wear + 0.03, 0.0, e - (wn - 0.5) * 0.12) * wear;
    if (paint) {
      const cn = fbmP(u * 6, v * 3, 6, 3, 4, 431);
      const s = cn + worn * 0.8;
      if (s <= 0.88 - chip * 0.35) {
        const brush = noiseP(u * 3, v * 40, 3, 40, 433);
        mix3(out, paintD, paintL, 0.45 + (g - 0.5) * 0.6 + (brush - 0.5) * 0.25);
        mix3(out, out, dark, Math.pow(ring, 14) * 0.12);
        if (s > 0.85 - chip * 0.35) mix3(out, out, paintD.map((c) => c * 0.7), 0.6);
        h += 0.12;
      } else mix3(out, out, bare, 0.25);
    } else mix3(out, out, bare, worn * 0.55);
    const bevel = sstep(0.035, 0.0, e);
    mix3(out, out, dark.map((c) => c * 0.65), bevel * 0.7);
    return h - bevel * 0.5;
  }, 2.2);
}

// ---- Métal peint écaillé : UV de 0 à 1 par face (G.box, G.rbox) ; la peinture saute surtout près des arêtes de la
// face (usure), laissant voir le métal nu cerné d'un liseré sombre (lisible de loin) ; rayures claires, rouille en option.
// o : { chip (écaillage diffus, 0..1), edge (usure aux arêtes, 0..1), rust (0..1), bare (couleur du métal nu),
//       tile (répétitions du motif d'écaillage par face), size (px) }
//   ex. paintedMetalTexture('#3f8f5a')                          peinture verte usée (bornes, ferrures peintes)
//       paintedMetalTexture('#d84a3a', null, { rust: 0.4 })   rouge rouillé (pièces de ferraille)
export function paintedMetalTexture(color = '#5d6b8a', key, o = {}) {
  const base = hex(color);
  const deep = base.map((c) => c * 0.86), pale = base.map((c) => Math.min(1, c * 1.1 + 0.06)), rimC = base.map((c) => c * 0.45);
  const bare = hex(o.bare || '#c3c8d2'), bareD = bare.map((c) => c * 0.7);
  const rustL = hex('#b8622c'), rustD = hex('#5a2c18');
  const chip = o.chip ?? 0.35, edge = o.edge ?? 0.6, rust = o.rust ?? 0.1, T = o.tile || 1;
  const k = key || [color, chip, edge, rust, o.bare || '', T].join('|');
  return build('pmetal-' + k, o.size || 256, (u, v, out) => {
    const n = fbm2(u * 4, v * 4, 4, 451, 4);
    mix3(out, deep, pale, clamp(0.35 + (n - 0.5) * 1.4, 0, 1));
    const e = Math.min(u, 1 - u, v, 1 - v);
    const cn = fbm2(u * 7 * T, v * 7 * T, 4, 457, 7 * T);
    const cn2 = fbm2(u * 22, v * 22, 3, 459, 22);
    const lim = 0.95 - chip * 0.3;
    const s = cn + (sstep(0.13, 0.0, e) * 0.35 + sstep(0.04, 0.0, e) * 0.3) * edge * (0.4 + cn2 * 1.2);
    let h = 0.6 + (n - 0.5) * 0.08;
    if (s > lim) {
      // métal nu (cœur de l'éclat), rouille au fond des plus gros éclats
      mix3(out, bareD, bare, 0.4 + fbm2(u * 30, v * 30, 2, 461, 30) * 0.6);
      if (rust > 0) mix3(out, out, rustL, clamp((s - lim - 0.06) * 8, 0, 0.8) * Math.min(1, rust * 1.6));
      h = 0.4;
    } else if (s > lim - 0.025) { mix3(out, out, rimC, 0.75); h = 0.66; }
    // rayures claires, coulures de rouille
    if (s <= lim - 0.025 && scratch(u, v, 8, 467) < 0.0035) { mix3(out, out, bare, 0.4); h -= 0.08; }
    if (rust > 0) {
      const col = noise2(u * 40, 0.5, 471, 40), run = fbm2(u * 6, v * 3, 3, 473, 3);
      mix3(out, out, rustD, clamp((col - 0.62) * 4, 0, 1) * clamp((run - 0.45) * 3, 0, 1) * rust);
    }
    return h;
  }, 2);
}

// ---- Tôle larmée (plancher antidérapant) : larmes en relief alternées à ±45°, usure brillante sur les reliefs ;
// raccordable. 1 tuile = 4 × 4 motifs (≈ 0,5 m avec des UV en mètres × 2). o : { size }
export function treadPlateTexture(color = '#8d97ad', key, o = {}) {
  const base = hex(color);
  const dark = base.map((c) => c * 0.58), light = base.map((c) => Math.min(1, c * 1.3 + 0.08));
  return build('tread-' + (key || color), o.size || 256, (u, v, out) => {
    const n = fbm2(u * 5, v * 5, 4, 481, 5);
    mix3(out, dark, base, 0.45 + n * 0.6);
    const N = 4, x = u * N, y = v * N;
    const cx = Math.floor(x), cy = Math.floor(y);
    let hh = 0;
    for (const [ox, oy, a] of [[0.25, 0.25, 1], [0.75, 0.75, -1]]) {
      const dx = x - cx - ox, dy = y - cy - oy;
      const p = (dx + a * dy) * 0.7071, q = (dx - a * dy) * 0.7071;
      const d = Math.hypot(p / 0.2, q / 0.055);
      hh = Math.max(hh, 1 - sstep(0.75, 1.0, d));
    }
    if (hh > 0) mix3(out, out, light, hh * (0.45 + n * 0.4));
    const w = fbm2(u * 3, v * 3, 3, 487, 3);
    if (w > 0.62) mix3(out, out, dark.map((c) => c * 0.7), (w - 0.62) * 1.6);
    return hh * 0.8 + n * 0.1;
  }, 3.5);
}

// ---- Bardeaux de toit : rangées décalées de bardeaux (bois ou ardoise) au bas arrondi, ombre sous la rangée du
// dessus, teinte propre à chaque bardeau, mousse en option. UV : v monte vers le faîtage, 1 tuile = rows rangées
// (u et v en mètres × 1/largeur de tuile, raccordable). o : { rows (6), cols (4), round (bas arrondi 0..1), moss (0..1), size }
//   ex. shingleTexture('#9a5a3a')                        bardeaux de bois roux
//       shingleTexture('#5a6a8a', null, { round: 0 })    ardoises droites bleutées
export function shingleTexture(color = '#9a5a3a', key, o = {}) {
  const base = hex(color);
  const dark = base.map((c) => c * 0.55), light = base.map((c) => Math.min(1, c * 1.2 + 0.05));
  const moss = hex('#5e8a46');
  const rows = o.rows || 6, cols = o.cols || 4, round = o.round ?? 0.7, mossA = o.moss ?? 0;
  const k = key || [color, rows, cols, round, mossA].join('|');
  return build('shingle-' + k, o.size || 256, (u, v, out) => {
    const y = v * rows;
    const r = Math.floor(y), fy = y - r; // fy = 0 : bord libre (bas) du bardeau
    const x = u * cols + (r % 2) * 0.5, c = Math.floor(x), fx = x - c;
    const id = hashP(((c % cols) + cols) % cols, ((r % rows) + rows) % rows, 491);
    const edgeY = round * 0.28 * (1 - Math.sqrt(Math.max(0, 1 - Math.pow((fx - 0.5) * 2, 2))));
    const g = fbmP(u * 4, v * 20, 4, 20, 3, 493);
    mix3(out, dark, light, 0.35 + id * 0.35 + (g - 0.5) * 0.4);
    let h;
    if (fy < edgeY) {
      // sous l'arrondi : la rangée du dessous, dans l'ombre
      mix3(out, out, dark.map((cc) => cc * 0.55), 0.8); h = 0.0;
    } else {
      // ombre portée de la rangée du dessus sur le haut du bardeau, bord libre éclairé
      mix3(out, out, dark, sstep(0.6, 1.0, fy) * 0.55);
      h = 0.25 + (1 - fy) * 0.75;
      if (fy - edgeY < 0.05) mix3(out, out, light, 0.3);
    }
    const gap = Math.min(fx, 1 - fx);
    if (gap < 0.025) { mix3(out, out, dark.map((cc) => cc * 0.5), 0.85); h = Math.min(h, 0.05); }
    if (mossA > 0) {
      const m = fbm2(u * 6, v * 6, 4, 497, 6);
      if (m > 0.62 - mossA * 0.2) mix3(out, out, moss, clamp((m - 0.62 + mossA * 0.2) * 5, 0, 0.85));
    }
    return h + g * 0.1;
  }, 3);
}

// ---- Liquide à spores (cuves vitrées de la Station) : nappes lumineuses étirées en hauteur, bulles cerclées et amas
// de spores sombres ; raccordable (la texture défile vers le haut pour faire monter les bulles)
export function sporeFluidTexture(color = '#5affa0', key) {
  const hi = hex(color), deep = hi.map((c) => c * 0.12), mid = hi.map((c) => c * 0.42), dark = hi.map((c) => c * 0.03);
  const R = rng(83), bubbles = [];
  for (let i = 0; i < 26; i++) bubbles.push([R(), R(), 0.025 + R() * R() * 0.07]);
  return build('spore-' + (key || color), 256, (u, v, out) => {
    const n = fbm2(u * 3, v * 1.5, 4, 811, 3), s = fbm2(u * 6, v * 2, 3, 813, 6);
    mix3(out, deep, mid, clamp(0.3 + (n - 0.5) * 2.6, 0, 1));
    // filets plus clairs qui montent
    mix3(out, out, hi, clamp((s - 0.58) * 3.5, 0, 0.7));
    // amas de spores en suspension
    const sp = fbm2(u * 6, v * 6, 3, 817, 6);
    if (sp > 0.6) mix3(out, out, dark, clamp((sp - 0.6) * 7, 0, 0.9));
    // bulles : liseré clair, cœur un peu plus clair que le liquide
    for (const [bu, bv, br] of bubbles) {
      const du = u - bu - Math.round(u - bu), dv = v - bv - Math.round(v - bv);
      const d = Math.hypot(du, dv);
      if (d < br) {
        mix3(out, out, hi, d > br * 0.72 ? 0.85 : 0.3);
        // reflet en haut à gauche
        if (Math.hypot(du + br * 0.35, dv + br * 0.35) < br * 0.22) mix3(out, out, [1, 1, 1], 0.6);
      }
    }
  });
}
