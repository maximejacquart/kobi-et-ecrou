// Synthèse échantillon par échantillon : générateurs, filtres, enveloppes et résonateurs. Pur calcul (aucune API
// audio) : tourne dans le worker des bruitages comme dans la page.
//
// Une « courbe » est un nombre ou une fonction du temps en secondes ; les générateurs et filtres l'évaluent à chaque
// échantillon, ce qui permet de moduler n'importe quel paramètre.

const TAU = Math.PI * 2;
const at = (c) => (typeof c === 'function' ? c : () => c);

// --- courbes ---
// rampe exponentielle de a à b en d secondes, à partir de t0
export const ex = (a, b, d, t0 = 0) => (t) => (t <= t0 ? a : t >= t0 + d ? b : a * Math.pow(b / a, (t - t0) / d));
// points [[t, v], …] reliés en exponentiel (valeurs > 0) ou en linéaire
export function pts(p, lin = false) {
  return (t) => {
    if (t <= p[0][0]) return p[0][1];
    for (let i = 1; i < p.length; i++) {
      if (t < p[i][0]) {
        const [t0, a] = p[i - 1], [t1, b] = p[i];
        const u = (t - t0) / (t1 - t0);
        return lin || a <= 0 || b <= 0 ? a + (b - a) * u : a * Math.pow(b / a, u);
      }
    }
    return p[p.length - 1][1];
  };
}
// enveloppe percussive : montée en a secondes, palier h, puis chute de 60 dB en d secondes
export const perc = (a, d, h = 0) => (t) => (t < a ? Math.sin((t / a) * Math.PI / 2) : Math.exp(-6.9 * Math.max(0, t - a - h) / d));
// bosse : montée douce en a, descente douce en r (souffles, passages)
export const swell = (a, r, h = 0) => (t) => {
  if (t < a) { const u = t / a; return u * u * (3 - 2 * u); }
  if (t < a + h) return 1;
  const u = (t - a - h) / r;
  return u >= 1 ? 0 : (1 - u) * (1 - u);
};
export const db = (x) => Math.pow(10, x / 20);

// générateur pseudo-aléatoire reproductible (mulberry32)
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

export class Dsp {
  constructor(sr, seed = 1) {
    this.sr = sr;
    this.random = rng(seed);
  }
  r(a = 0, b = 1) { return a + (b - a) * this.random(); }
  // variation multiplicative de ±p
  j(p) { return 1 + (this.random() * 2 - 1) * p; }
  len(d) { return Math.max(1, Math.round(d * this.sr)); }
  buf(d) { return new Float32Array(this.len(d)); }

  // --- générateurs ---
  // oscillateur : sine, tri, saw, square, pulse (largeur pw), à fréquence modulable
  osc(d, freq, type = 'sine', { pw = 0.5, ph = 0 } = {}) {
    const x = this.buf(d), sr = this.sr, f = at(freq), w = at(pw);
    let p = ph;
    for (let i = 0; i < x.length; i++) {
      const t = i / sr, dt = Math.min(0.5, Math.abs(f(t)) / sr);
      let v;
      if (type === 'sine') v = Math.sin(TAU * p);
      else if (type === 'tri') v = 1 - 4 * Math.abs(p - 0.5);
      else if (type === 'saw') v = 2 * p - 1 - blep(p, dt);
      else {
        const q = type === 'square' ? 0.5 : w(t);
        v = (p < q ? 1 : -1) + blep(p, dt) - blep((p + 1 - q) % 1, dt);
      }
      x[i] = v;
      p += dt;
      if (p >= 1) p -= 1;
    }
    return x;
  }
  // FM à deux opérateurs : porteuse fc, modulante fc·ratio, indice de modulation idx
  fm(d, fc, ratio, idx, { fb = 0 } = {}) {
    const x = this.buf(d), sr = this.sr, f = at(fc), r = at(ratio), k = at(idx);
    let pc = 0, pm = 0, last = 0;
    for (let i = 0; i < x.length; i++) {
      const t = i / sr, fr = f(t);
      const m = Math.sin(TAU * pm + fb * last);
      last = m;
      x[i] = Math.sin(TAU * pc + k(t) * m);
      pc += fr / sr; pm += fr * r(t) / sr;
      if (pc > 1) pc -= 1;
      if (pm > 1) pm -= 1;
    }
    return x;
  }
  // bruit blanc, rose ou brun
  noise(d, color = 'white') {
    const x = this.buf(d), rnd = this.random;
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < x.length; i++) {
      const w = rnd() * 2 - 1;
      if (color === 'pink') {
        b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
        x[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
      } else if (color === 'brown') {
        b0 = (b0 + 0.02 * w) / 1.02;
        x[i] = b0 * 3.5;
      } else x[i] = w;
    }
    return x;
  }
  // grésillement : impulsions isolées, density par seconde (courbe), amplitude au hasard
  dust(d, density, { min = 0.2 } = {}) {
    const x = this.buf(d), sr = this.sr, dn = at(density);
    for (let i = 0; i < x.length; i++) {
      if (this.random() < dn(i / sr) / sr) x[i] = (this.random() < 0.5 ? -1 : 1) * this.r(min, 1);
    }
    return x;
  }
  // impulsion unique (excitation des résonateurs)
  click(d, at0 = 0, amp = 1) {
    const x = this.buf(d);
    const i = Math.min(x.length - 1, Math.round(at0 * this.sr));
    x[i] = amp;
    return x;
  }

  // --- traitements (en place, renvoient le tampon) ---
  // filtre à variables d'état (topologie TPT) : lp, bp, hp, notch ; fréquence et Q modulables
  svf(x, mode, freq, q = 0.707) {
    const sr = this.sr, f = at(freq), qq = at(q), cf = typeof freq === 'number', cq = typeof q === 'number';
    let s1 = 0, s2 = 0, g = 0, k = 0, a1 = 0, a2 = 0, a3 = 0;
    const coef = (t) => {
      g = Math.tan(Math.PI * Math.min(0.49 * sr, Math.max(10, f(t))) / sr);
      k = 1 / Math.max(0.05, qq(t));
      a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2;
    };
    coef(0);
    for (let i = 0; i < x.length; i++) {
      if (!(cf && cq) && (i & 7) === 0) coef(i / sr);
      const v0 = x[i];
      const v3 = v0 - s2, v1 = a1 * s1 + a2 * v3, v2 = s2 + a2 * s1 + a3 * v3;
      s1 = 2 * v1 - s1; s2 = 2 * v2 - s2;
      // passe-bande normalisé : gain 1 à la fréquence centrale quel que soit le Q
      x[i] = mode === 'lp' ? v2 : mode === 'bp' ? k * v1 : mode === 'hp' ? v0 - k * v1 - v2 : v0 - k * v1;
    }
    return x;
  }
  lp(x, f, q) { return this.svf(x, 'lp', f, q); }
  hp(x, f, q) { return this.svf(x, 'hp', f, q); }
  bp(x, f, q) { return this.svf(x, 'bp', f, q); }
  // multiplie par une courbe d'amplitude
  amp(x, env) {
    const e = at(env), sr = this.sr;
    for (let i = 0; i < x.length; i++) x[i] *= e(i / sr);
    return x;
  }
  gain(x, g) {
    for (let i = 0; i < x.length; i++) x[i] *= g;
    return x;
  }
  // saturation douce (tanh), quantité modulable
  drive(x, k) {
    const kk = at(k), sr = this.sr;
    for (let i = 0; i < x.length; i++) {
      const v = kk(i / sr);
      x[i] = Math.tanh(x[i] * v) / Math.tanh(Math.max(1, v));
    }
    return x;
  }
  // repliement d'onde : timbre métallique et agressif
  fold(x, k) {
    for (let i = 0; i < x.length; i++) {
      let v = x[i] * k;
      while (v > 1 || v < -1) v = v > 1 ? 2 - v : -2 - v;
      x[i] = v;
    }
    return x;
  }
  // réduction de résolution et d'échantillonnage (grain « numérique »)
  crush(x, bits, hold = 1) {
    const q = Math.pow(2, bits - 1);
    let h = 0;
    for (let i = 0; i < x.length; i++) {
      if (i % hold === 0) h = Math.round(x[i] * q) / q;
      x[i] = h;
    }
    return x;
  }
  // banc de résonateurs (synthèse modale) excité par x : modes [[fréquence, durée -60 dB, amplitude], …]
  modes(x, list, pitch = 1) {
    const y = new Float32Array(x.length), sr = this.sr;
    for (const [f0, t60, a] of list) {
      const f = f0 * pitch;
      if (f >= sr * 0.45) continue;
      const w = TAU * f / sr, r = Math.exp(-6.9 / (t60 * sr));
      const c1 = 2 * r * Math.cos(w), c2 = r * r, b = a * Math.sin(w);
      let y1 = 0, y2 = 0;
      for (let i = 0; i < x.length; i++) {
        const v = b * x[i] + c1 * y1 - c2 * y2;
        y2 = y1; y1 = v;
        y[i] += v;
      }
    }
    return y;
  }
  // filtre en peigne (résonance de tube, écho métallique)
  comb(x, delay, fb, damp = 0) {
    const n = Math.max(1, Math.round(delay * this.sr)), line = new Float32Array(n);
    let p = 0, lpv = 0;
    for (let i = 0; i < x.length; i++) {
      const o = line[p];
      lpv = o + damp * (lpv - o);
      line[p] = x[i] + lpv * fb;
      x[i] = x[i] + o;
      p = (p + 1) % n;
    }
    return x;
  }
  // petite réverbération mono (type Freeverb) : size ~ taille de pièce, decay 0..1, mix humide
  verb(x, { size = 1, decay = 0.8, damp = 0.3, mix = 0.3 } = {}) {
    const sr = this.sr, k = (sr / 44100) * size;
    const combs = [1116, 1188, 1277, 1356, 1422, 1491].map((n) => ({ b: new Float32Array(Math.round(n * k)), p: 0, f: 0 }));
    const aps = [556, 441, 341].map((n) => ({ b: new Float32Array(Math.round(n * k)), p: 0 }));
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      let s = 0;
      for (const c of combs) {
        const o = c.b[c.p];
        c.f = o * (1 - damp) + c.f * damp;
        c.b[c.p] = v * 0.12 + c.f * decay;
        c.p = (c.p + 1) % c.b.length;
        s += o;
      }
      for (const a of aps) {
        const o = a.b[a.p];
        a.b[a.p] = s + o * 0.5;
        a.p = (a.p + 1) % a.b.length;
        s = o - s * 0.5;
      }
      x[i] = v * (1 - mix * 0.5) + s * mix;
    }
    return x;
  }
  // ajoute src dans dst à partir de t secondes, avec un gain
  mix(dst, src, g = 1, t = 0) {
    const o = Math.round(t * this.sr), n = Math.min(src.length, dst.length - o);
    for (let i = 0; i < n; i++) dst[i + o] += src[i] * g;
    return dst;
  }
  // somme de plusieurs couches [tampon, gain, départ] : chaque couche est d'abord ramenée à une crête de 1, le gain
  // donne donc directement son niveau de crête relatif
  sum(d, layers) {
    const out = this.buf(d);
    for (const l of layers) {
      if (!l) continue;
      let pk = 0;
      for (let i = 0; i < l[0].length; i++) pk = Math.max(pk, Math.abs(l[0][i]));
      if (pk > 0) this.mix(out, l[0], (l[1] ?? 1) / pk, l[2] ?? 0);
    }
    return out;
  }
  fade(x, fin = 0.002, fout = 0.01) {
    const a = Math.round(fin * this.sr), b = Math.round(fout * this.sr), n = x.length;
    for (let i = 0; i < a && i < n; i++) x[i] *= i / a;
    for (let i = 0; i < b && i < n; i++) x[n - 1 - i] *= i / b;
    return x;
  }
  // coupe la composante continue et l'infra-grave
  dc(x, f = 25) { return this.hp(x, f, 0.6); }
}
