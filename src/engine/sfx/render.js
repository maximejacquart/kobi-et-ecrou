// Calcul des bruitages : chaque recette donne plusieurs variantes, ramenées à une même sonie pour que le mixage se
// règle uniquement par le gain (en dB) de chaque recette.
import { Dsp } from './dsp.js';
import { SFX, LOOPS } from './recipes.js';

const TARGET = -18; // sonie de référence (dB, max sur fenêtre glissante, pondération proche de K)
const LOOP_TARGET = -24; // les boucles se mesurent en moyenne

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// sonie : coupe le grave, relève l'aigu (l'oreille y est plus sensible), puis RMS max sur 100 ms (ou moyenne)
function loudness(x, sr, mean = false) {
  const d = new Dsp(sr);
  const y = d.hp(x.slice(), 80, 0.5);
  d.mix(y, d.hp(y.slice(), 1500, 0.7), 0.6);
  const toDb = (v) => 10 * Math.log10(Math.max(1e-12, v));
  if (mean) {
    let s = 0;
    for (let i = 0; i < y.length; i++) s += y[i] * y[i];
    return toDb(s / y.length);
  }
  const w = Math.round(0.1 * sr), step = Math.round(0.01 * sr);
  let best = 0;
  for (let a = 0; a + w <= Math.max(y.length, w); a += step) {
    let s = 0;
    for (let i = a; i < a + w; i++) { const v = y[i] || 0; s += v * v; }
    best = Math.max(best, s / w);
  }
  return toDb(best);
}

function recipe(key) { return SFX[key] || LOOPS[key]; }

// variantes d'un son, prêtes à jouer : [Float32Array, …]
export function renderSet(key, sr) {
  const r = recipe(key);
  if (!r) return [];
  const out = [];
  const n = r.v || (LOOPS[key] ? 1 : 3);
  for (let v = 0; v < n; v++) {
    const d = new Dsp(sr, hash(key) + v * 7919);
    let x;
    if (LOOPS[key]) {
      // boucle : on calcule un peu plus long et on fond la fin dans le début pour un raccord invisible
      const L = d.len(r.len), xf = Math.min(Math.round(L * 0.25), d.len(0.5));
      const raw = r.gen(d, (L + xf) / sr, v);
      d.dc(raw);
      x = new Float32Array(L);
      for (let i = 0; i < L; i++) x[i] = raw[i];
      for (let i = 0; i < xf; i++) {
        const u = i / xf;
        x[i] = raw[i] * Math.sin(u * Math.PI / 2) + raw[L + i] * Math.cos(u * Math.PI / 2);
      }
      d.gain(x, Math.pow(10, (LOOP_TARGET - loudness(x, sr, true)) / 20));
    } else {
      x = r.gen(d, v);
      d.dc(x);
      d.fade(x, 0, Math.min(0.02, x.length / sr / 4));
      d.gain(x, Math.pow(10, (TARGET - loudness(x, sr)) / 20));
    }
    out.push(x);
  }
  return out;
}
