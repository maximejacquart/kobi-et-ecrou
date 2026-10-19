// Recettes des bruitages. Chaque recette rend un tampon mono ; render.js en tire plusieurs variantes et les ramène
// à une même sonie : `db` règle ensuite le niveau dans le mixage, `jit` la variation de hauteur à chaque lecture,
// `duck` l'atténuation passagère de la musique.
import { ex, pts, perc, swell } from './dsp.js';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const TAU = Math.PI * 2;

// rapports de fréquences des modes de vibration
const BAR = [1, 2.756, 5.404, 8.933]; // barre libre (clé, tige)
const PLATE = [1, 1.594, 2.136, 2.296, 2.653, 2.918, 3.156]; // tôle
const GLASS = [1, 2.32, 4.25, 6.63, 9.38]; // verre, glace
const WOOD = [1, 2.57, 4.12, 6.3]; // planche
const NUT = [1, 1.83, 2.94, 4.41, 5.6]; // petit écrou

// ---------------------------------------------------------------- briques
// coup sur un objet résonant : f fondamentale, t60 durée de résonance, hard = dureté du choc (brillance)
function strike(d, f, t60, ratios, { hard = 6000, exc = 0.0015, spread = 0.015, tilt = 0.7, damp = 0.5, dur } = {}) {
  const e = d.buf(dur ?? t60 * 1.1 + exc);
  const n = Math.max(2, Math.round(exc * d.sr));
  for (let i = 0; i < n && i < e.length; i++) e[i] = (d.random() * 2 - 1) * Math.sin(Math.PI * i / n);
  d.lp(e, hard);
  return d.modes(e, ratios.map((r, i) => [f * r * d.j(spread), t60 / (1 + i * damp), Math.pow(tilt, i)]));
}
// coup sourd : sinus qui chute en fréquence
function thump(d, dur, f0, f1, drv = 1) {
  const x = d.osc(dur, ex(f0, f1, dur * 0.5));
  d.amp(x, perc(0.0015, dur));
  return drv > 1 ? d.drive(x, drv) : x;
}
// claquement bref (attaque)
function tick(d, f = 3000, dur = 0.006) {
  const x = d.noise(dur + 0.004);
  d.hp(x, f);
  return d.amp(x, perc(0.0002, dur));
}
// souffle : bruit filtré dont la bande passe de f0 à f1 (au sommet, à peak·dur) puis à f2
function whoosh(d, dur, f0, f1, f2, q = 1, peak = 0.4, color = 'pink') {
  const x = d.noise(dur, color);
  d.bp(x, pts([[0, f0], [dur * peak, f1], [dur, f2]]), q);
  return d.amp(x, swell(dur * peak, dur * (1 - peak)));
}
// petit moteur électrique qui monte ou descend
function servo(d, dur, f0, f1, q = 3) {
  const f = ex(f0, f1, dur);
  const x = d.osc(dur, f, 'saw');
  const y = d.bp(x.slice(), (t) => f(t) * 3, q);
  d.mix(y, d.lp(x, 1800), 0.35);
  return d.amp(y, swell(Math.min(0.02, dur * 0.2), dur * 0.3, dur * 0.5));
}
// cloche FM (glockenspiel avec ratio 3.5)
function fmBell(d, dur, f, { ratio = 3.5, idx = 2, t60 = dur } = {}) {
  const x = d.fm(dur, f, ratio, ex(idx, 0.05, t60 * 0.7));
  return d.amp(x, perc(0.001, t60));
}
// corde pincée synthétique (deux dents de scie désaccordées, filtre qui se referme)
function pluck(d, dur, f, { cut = 5000, t60 = dur, bend = 1 } = {}) {
  const fr = bend === 1 ? f : ex(f, f * bend, t60);
  const x = d.sum(dur, [[d.osc(dur, (t) => (typeof fr === 'number' ? fr : fr(t)) * 1.003, 'saw'), 1], [d.osc(dur, (t) => (typeof fr === 'number' ? fr : fr(t)) * 0.997, 'saw'), 1]]);
  d.lp(x, ex(cut, f * 1.5, t60 * 0.4), 1.2);
  return d.amp(x, perc(0.002, t60));
}
// nappe tenue
function pad(d, dur, f) {
  const x = d.sum(dur, [[d.osc(dur, f * 1.004, 'saw'), 1], [d.osc(dur, f * 0.996, 'saw'), 1], [d.osc(dur, f, 'tri'), 1]]);
  d.lp(x, ex(4000, 1200, dur), 0.8);
  return d.amp(x, swell(0.02, dur * 0.8, dur * 0.15));
}
// ressort : hauteur qui oscille en s'amortissant
function spring(d, dur, f, depth = 0.4, rate = 22) {
  const x = d.osc(dur, (t) => f * (1 + depth * Math.sin(TAU * rate * t) * Math.exp(-t * 7)) * (1 + 0.6 * Math.exp(-t * 25)), 'tri');
  d.lp(x, 2500);
  return d.amp(x, perc(0.002, dur));
}
// bulle : sinus bref qui monte
function bubble(d, f, dur) {
  const x = d.osc(dur, (t) => f * (1 + 2.5 * t / dur));
  return d.amp(x, perc(0.001, dur));
}
// éparpille n grains dans le temps : when(k, n) → instant, make(k, n, t) → tampon
function scatter(d, dur, n, when, make) {
  const out = d.buf(dur);
  for (let k = 0; k < n; k++) {
    const t = when(k, n);
    if (t < dur) d.mix(out, make(k, n, t), 1, t);
  }
  return out;
}
// tintements cristallins
function sparkle(d, dur, n, f0, f1) {
  return scatter(d, dur, n, () => d.r(0, dur * 0.7), () => d.gain(strike(d, d.r(f0, f1), d.r(0.08, 0.25), GLASS, { hard: 12000, exc: 0.0005 }), d.r(0.3, 1)));
}
// débris qui retombent (plus serrés au début)
function debris(d, dur, n, f0, f1) {
  return scatter(d, dur, n, () => dur * 0.85 * Math.pow(d.random(), 1.8), (k, m, t) =>
    d.gain(strike(d, d.r(f0, f1), d.r(0.02, 0.07), d.random() < 0.5 ? WOOD : PLATE, { hard: 6000, exc: 0.0006 }), d.r(0.3, 1) * Math.exp(-t * 3)));
}
// variation lente et douce entre 0 et 1 (rate changements par seconde)
function drift(d, L, rate) {
  const p = Array.from({ length: Math.ceil(L * rate) + 2 }, () => d.random());
  return (t) => {
    const u = t * rate, i = Math.floor(u), f = u - i, s = f * f * (3 - 2 * f);
    return p[i] + (p[i + 1] - p[i]) * s;
  };
}
// voix : source glottale passée dans les formants d'une voyelle
const VOW = {
  a: [[800, 1], [1150, 0.5], [2900, 0.2]], e: [[400, 1], [1700, 0.45], [2600, 0.2]], i: [[300, 1], [2250, 0.4], [3000, 0.25]],
  o: [[450, 1], [800, 0.55], [2830, 0.12]], u: [[325, 1], [700, 0.4], [2530, 0.1]],
};
function vocal(d, dur, f0, vowel, { q = 8, breath = 0.06, shift = 1 } = {}) {
  const src = d.osc(dur, f0, 'saw');
  if (breath) d.mix(src, d.noise(dur), breath);
  const out = d.buf(dur);
  for (const [f, g] of VOW[vowel]) d.mix(out, d.bp(src.slice(), f * shift, q), g);
  return out;
}
// charabia : suite de syllabes
function babble(d, n, f0, { syl = [0.07, 0.13], gap = [0.01, 0.05], shift = 1, drift: dr = 0.15, q = 8 } = {}) {
  let t = 0;
  const parts = [];
  for (let k = 0; k < n; k++) {
    const L = d.r(syl[0], syl[1]), fa = f0 * d.j(dr), fb = fa * d.r(0.8, 1.15);
    const s = vocal(d, L, ex(fa, fb, L), 'aeiou'[Math.floor(d.random() * 5)], { shift, q });
    d.amp(s, swell(L * 0.25, L * 0.7));
    parts.push([s, d.r(0.7, 1), t]);
    t += L + d.r(gap[0], gap[1]);
  }
  return d.sum(t + 0.05, parts);
}
// gazouillis de robot : glissés FM courts
function chatter(d, n, f0, f1, cute = false) {
  let t = 0;
  const parts = [];
  for (let k = 0; k < n; k++) {
    const L = d.r(0.035, cute ? 0.08 : 0.1), a = d.r(f0, f1), b = d.r(f0, f1), w = d.r(18, 45), shape = d.random();
    const f = shape < 0.45 ? ex(a, b, L) : shape < 0.75 ? (u) => a * (1 + 0.12 * Math.sin(TAU * w * u)) : ex(a, a * (cute ? 1.6 : 0.6), L);
    const x = d.fm(L, f, cute ? 2 : 1.5, cute ? 0.6 : 1.4);
    d.amp(x, swell(0.005, L * 0.4, L * 0.5));
    parts.push([x, d.r(0.6, 1), t]);
    t += L + d.r(0.005, 0.04);
  }
  return d.sum(t + 0.02, parts);
}
// explosion : claquement, corps, coup de grave, grondement, débris
function blast(d, L, big) {
  const k = big ? 1.6 : 1;
  const crack = d.noise(0.06);
  d.hp(crack, 900); d.amp(crack, perc(0.0005, 0.04)); d.drive(crack, 3);
  const body = d.sum(L, [[d.noise(L, 'brown'), 1], [d.noise(L, 'pink'), 0.6]]);
  d.lp(body, ex(5000, 180, 0.5 * k)); d.amp(body, perc(0.003, 0.8 * k)); d.drive(body, 2.5);
  const rumble = d.noise(L, 'brown');
  d.lp(rumble, 140); d.amp(rumble, swell(0.06, 1.1 * k));
  const layers = [[crack, 0.7], [body, 1], [thump(d, 0.9 * k, big ? 70 : 85, 26, 3), 1], [rumble, 0.7], [debris(d, L - 0.06, big ? 40 : 22, 500, 3500), 0.22, 0.06]];
  if (big) {
    const b2 = d.noise(1.2, 'brown');
    d.lp(b2, ex(3000, 150, 0.6)); d.amp(b2, perc(0.004, 1.0)); d.drive(b2, 2);
    layers.push([b2, 0.7, 0.14], [thump(d, 0.8, 60, 25, 2.5), 0.6, 0.14]);
  }
  return d.verb(d.sum(L, layers), { size: 1.4, decay: 0.8, mix: 0.18 });
}

// ---------------------------------------------------------------- bruitages
export const SFX = {
  // --- ramassage ---
  bolt: { v: 5, db: -13, jit: 0.03, gen(d) {
    const f = d.r(1650, 1900);
    const out = d.sum(0.32, [[strike(d, f, 0.16, NUT, { hard: 9000, exc: 0.0008, tilt: 0.75 }), 1], [tick(d, 5000), 0.3]]);
    if (d.random() < 0.7) d.mix(out, strike(d, f * d.r(1.04, 1.12), 0.09, NUT, { hard: 7000, exc: 0.0008 }), d.r(0.3, 0.5), d.r(0.03, 0.06));
    return out;
  } },
  boltGold: { v: 4, db: -12, gen(d) {
    const f = d.r(980, 1100);
    return d.sum(0.55, [[strike(d, f, 0.3, NUT, { hard: 7000, exc: 0.001 }), 1], [strike(d, f * 1.5, 0.22, NUT, { hard: 8000, exc: 0.001 }), 0.6, 0.045],
      [fmBell(d, 0.5, f * 2, { idx: 1.5, t60: 0.45 }), 0.25, 0.05], [tick(d, 4000), 0.3]]);
  } },
  coin: { v: 3, db: -15, gen(d) {
    return d.sum(0.5, [[fmBell(d, 0.5, 1975, { t60: 0.4 }), 1], [fmBell(d, 0.4, 2960, { idx: 1, t60: 0.3 }), 0.5, 0.06], [tick(d, 6000), 0.2]]);
  } },
  goldbolt: { v: 1, db: -6, jit: 0, gen(d) {
    const layers = [72, 76, 79, 84, 88, 91, 96].map((m, i) => [fmBell(d, 1.4, mtof(m), { idx: 2.2, t60: 1.2 }), 0.5 + i * 0.05, i * 0.065]);
    layers.push([sparkle(d, 1.8, 14, 3000, 9000), 0.25, 0.2], [whoosh(d, 0.6, 400, 3000, 6000, 0.8, 0.8), 0.25]);
    return d.verb(d.sum(2.2, layers), { size: 1.2, decay: 0.84, mix: 0.25 });
  } },
  ammo: { v: 3, db: -13, gen(d) {
    const slide = d.noise(0.07);
    d.bp(slide, ex(1800, 3500, 0.07), 2); d.amp(slide, swell(0.01, 0.06));
    return d.sum(0.45, [[strike(d, 2300, 0.05, PLATE, { hard: 9000, exc: 0.0006 }), 0.8], [tick(d, 4000), 0.5], [slide, 0.4, 0.02],
      [strike(d, 1500, 0.08, PLATE, { hard: 7000, exc: 0.0008 }), 1, 0.1], [thump(d, 0.05, 220, 120), 0.4, 0.1], [fmBell(d, 0.3, 1760, { idx: 1.2, t60: 0.25 }), 0.3, 0.14]]);
  } },
  heal: { v: 2, db: -11, gen(d) {
    const layers = [76, 79, 83, 88, 91].map((m, i) => [fmBell(d, 0.7, mtof(m), { ratio: 2, idx: 1, t60: 0.6 }), 0.5, i * 0.045]);
    layers.push([whoosh(d, 0.5, 2000, 6000, 8000, 0.7, 0.7, 'white'), 0.12]);
    return d.verb(d.sum(1.0, layers), { size: 0.8, decay: 0.75, mix: 0.2 });
  } },

  // --- déplacements ---
  step: { v: 6, db: -23, jit: 0.06, gen(d) {
    const n = d.noise(0.12, 'pink');
    d.lp(n, ex(1600 * d.j(0.2), 400, 0.06)); d.amp(n, perc(0.002, 0.07));
    const grit = d.dust(0.12, 2500);
    d.bp(grit, d.r(2500, 4000), 1); d.amp(grit, perc(0.001, 0.05));
    return d.sum(0.12, [[n, 1], [grit, 0.35], [thump(d, 0.06, 110, 65), 0.45]]);
  } },
  stepMetal: { v: 6, db: -22, jit: 0.05, gen(d) {
    return d.sum(0.22, [[strike(d, d.r(360, 470), 0.14, PLATE, { hard: 4000, exc: 0.003, tilt: 0.8 }), 0.7], [thump(d, 0.06, 140, 80), 0.5], [tick(d, 2500, 0.01), 0.3]]);
  } },
  stepGrass: { v: 6, db: -23, jit: 0.06, gen(d) {
    const n = d.noise(0.14);
    d.bp(n, d.r(2800, 4200), 0.7); d.amp(n, swell(0.012, 0.09));
    const c = d.dust(0.14, 1800);
    d.hp(c, 2500); d.amp(c, swell(0.01, 0.1));
    return d.sum(0.14, [[n, 0.8], [c, 0.4], [thump(d, 0.05, 90, 60), 0.25]]);
  } },
  jump: { v: 4, db: -16, gen(d) {
    const toon = d.amp(d.osc(0.12, ex(330, 700, 0.1)), perc(0.004, 0.1));
    const cloth = d.hp(d.noise(0.05), 3500);
    d.amp(cloth, perc(0.001, 0.035));
    return d.sum(0.22, [[whoosh(d, 0.18, 500, 1900 * d.j(0.1), 1100, 0.9, 0.35), 1], [thump(d, 0.07, 170, 90), 0.5], [toon, 0.18], [cloth, 0.2]]);
  } },
  // poussée des propulseurs d'Écrou
  djump: { v: 4, db: -12, gen(d) {
    const jet = d.noise(0.35, 'pink');
    d.bp(jet, ex(700, 2600, 0.12), 1.1); d.amp(jet, perc(0.008, 0.28));
    const hiss = d.hp(d.noise(0.35), 4000);
    d.amp(hiss, perc(0.004, 0.15));
    return d.sum(0.35, [[jet, 1], [hiss, 0.3], [thump(d, 0.12, 110, 60, 1.5), 0.6], [servo(d, 0.09, 500, 1300), 0.2]]);
  } },
  land: { v: 4, db: -14, gen(d) {
    const dirt = d.noise(0.3, 'brown');
    d.lp(dirt, ex(1200, 300, 0.1)); d.amp(dirt, perc(0.002, 0.14));
    const grit = d.dust(0.3, ex(3000, 50, 0.15));
    d.bp(grit, 3000, 0.8); d.amp(grit, perc(0.001, 0.12));
    return d.sum(0.3, [[thump(d, 0.18, 130, 48, 1.6), 1], [dirt, 0.7], [grit, 0.25]]);
  } },
  dash: { v: 3, db: -13, gen(d) {
    const air = d.noise(0.3, 'pink');
    d.bp(air, pts([[0, 2400], [0.05, 3400], [0.28, 600]]), 1); d.amp(air, perc(0.006, 0.24));
    const jet = d.hp(d.noise(0.15, 'brown'), 150);
    d.amp(jet, perc(0.003, 0.12));
    return d.sum(0.3, [[air, 1], [jet, 0.6], [thump(d, 0.08, 150, 90), 0.4]]);
  } },
  whoosh: { v: 4, db: -16, gen(d) {
    return d.sum(0.36, [[whoosh(d, 0.34, 300, 1500 * d.j(0.15), 450, 1.0, 0.5), 1], [whoosh(d, 0.3, 150, 500, 200, 0.7, 0.5, 'brown'), 0.6, 0.02]]);
  } },
  grapple: { v: 3, db: -10, gen(d) {
    const thwip = d.noise(0.12);
    d.bp(thwip, ex(1500, 4500, 0.08), 2.5); d.amp(thwip, perc(0.002, 0.1));
    const chain = scatter(d, 0.2, 12, (k) => k * 0.013 + d.r(0, 0.003), (k) => d.gain(strike(d, d.r(2600, 3400), 0.035, NUT, { hard: 9000, exc: 0.0005 }), 1 - k / 14));
    return d.sum(0.6, [[thwip, 0.8], [chain, 0.35, 0.02], [strike(d, 820, 0.28, BAR, { hard: 6000, tilt: 0.8 }), 0.6, 0.17],
      [thump(d, 0.1, 140, 70, 1.5), 0.7, 0.17], [tick(d, 3000), 0.5, 0.17]]);
  } },
  pad: { v: 2, db: -9, gen(d) {
    return d.sum(0.7, [[spring(d, 0.6, 160, 0.5, 16), 0.8], [whoosh(d, 0.5, 300, 2500, 3500, 0.9, 0.35), 0.6], [thump(d, 0.12, 110, 55, 1.5), 0.8]]);
  } },
  splash: { v: 3, db: -10, gen(d) {
    const slap = d.noise(0.12, 'pink');
    d.lp(slap, ex(3000, 600, 0.1)); d.amp(slap, perc(0.002, 0.09));
    const bub = scatter(d, 0.7, 18, () => 0.45 * Math.pow(d.random(), 1.3) + 0.02, (k, n, t) => d.gain(bubble(d, d.r(350, 1500), d.r(0.03, 0.09)), d.r(0.2, 0.8) * Math.exp(-t * 3)));
    const spray = d.hp(d.noise(0.5), 2500);
    d.amp(spray, swell(0.01, 0.4));
    return d.sum(0.8, [[slap, 1], [thump(d, 0.12, 120, 55), 0.6], [bub, 0.6], [spray, 0.35]]);
  } },

  // --- corps à corps, dégâts ---
  swing: { v: 4, db: -13, gen(d) {
    const tone = d.noise(0.2);
    d.bp(tone, pts([[0, 900], [0.09, 1700], [0.2, 1000]]), 7); d.amp(tone, swell(0.09, 0.11));
    return d.sum(0.24, [[whoosh(d, 0.2, 450, 2400 * d.j(0.1), 700, 1.3, 0.45), 1], [tone, 0.5]]);
  } },
  hit: { v: 5, db: -9, jit: 0.04, gen(d) {
    const crunch = d.noise(0.08);
    d.bp(crunch, 1600, 0.9); d.amp(crunch, perc(0.0008, 0.05)); d.drive(crunch, 3);
    return d.sum(0.5, [[tick(d, 2500, 0.004), 0.8], [thump(d, 0.14, 190, 60, 2), 1], [crunch, 0.5],
      [strike(d, d.r(620, 780), 0.4, BAR, { hard: 7000, exc: 0.001, tilt: 0.8, damp: 0.8 }), 0.35], [strike(d, d.r(240, 300), 0.12, PLATE, { hard: 3000, exc: 0.002 }), 0.4]]);
  } },
  slam: { v: 3, db: -5, duck: 0.5, gen(d) {
    const body = d.noise(0.8, 'brown');
    d.lp(body, ex(3000, 150, 0.4)); d.amp(body, perc(0.002, 0.6)); d.drive(body, 2);
    const crack = d.hp(d.noise(0.05), 1500);
    d.amp(crack, perc(0.0005, 0.04));
    const out = d.sum(1.2, [[thump(d, 0.7, 95, 28, 3), 1], [body, 0.8], [crack, 0.6], [debris(d, 1.0, 40, 800, 3000), 0.35, 0.04], [strike(d, 520, 0.5, BAR, { hard: 5000, tilt: 0.75 }), 0.15]]);
    return d.verb(out, { size: 1.3, decay: 0.7, mix: 0.2 });
  } },
  stomp: { v: 3, db: -7, gen(d) {
    const body = d.noise(0.6, 'brown');
    d.lp(body, ex(900, 120, 0.3)); d.amp(body, perc(0.003, 0.45));
    return d.sum(0.8, [[thump(d, 0.55, 75, 28, 2.5), 1], [body, 0.8], [debris(d, 0.6, 10, 300, 1200), 0.12, 0.03]]);
  } },
  // Kobi touché : petit cri et impact
  hurt: { v: 4, db: -8, gen(d) {
    const f0 = d.r(300, 360);
    const v = vocal(d, 0.22, pts([[0, f0], [0.05, f0 * 1.08], [0.22, f0 * 0.7]]), d.random() < 0.5 ? 'a' : 'e', { q: 6, breath: 0.15 });
    d.amp(v, swell(0.015, 0.17, 0.03));
    const crunch = d.bp(d.noise(0.06), 1200, 0.8);
    d.amp(crunch, perc(0.001, 0.05));
    return d.sum(0.35, [[v, 1], [thump(d, 0.15, 150, 55, 2), 0.8], [crunch, 0.4]]);
  } },
  death: { v: 1, db: -7, jit: 0, gen(d) {
    const layers = [[64, 0], [60, 0.18], [57, 0.36], [52, 0.6]].map(([m, t], i) =>
      [pluck(d, i === 3 ? 1.3 : 0.5, mtof(m), { cut: 2600, t60: i === 3 ? 1.2 : 0.45, bend: i === 3 ? 0.94 : 1 }), 0.6, t]);
    const down = d.osc(1.2, ex(700, 60, 1.1), 'saw');
    d.lp(down, ex(2500, 200, 1.1)); d.amp(down, swell(0.05, 1.0, 0.1));
    layers.push([down, 0.15, 0.1]);
    return d.verb(d.sum(2.0, layers), { size: 1.1, decay: 0.8, mix: 0.25 });
  } },

  // --- armes ---
  rivet: { v: 5, db: -12, jit: 0.04, gen(d) {
    const hiss = d.bp(d.noise(0.12), 5500, 0.7);
    d.amp(hiss, perc(0.002, 0.09));
    const zap = d.amp(d.fm(0.08, ex(1900, 520, 0.06), 1, ex(2.5, 0.2, 0.07)), perc(0.001, 0.06));
    return d.sum(0.2, [[tick(d, 3000, 0.006), 0.8], [thump(d, 0.09, 260, 85, 2.5), 0.9], [strike(d, d.r(1250, 1450), 0.07, BAR, { hard: 8000, exc: 0.0006, tilt: 0.8 }), 0.45], [hiss, 0.35], [zap, 0.3]]);
  } },
  bomb: { v: 3, db: -11, gen(d) {
    const pop = d.bp(d.noise(0.08, 'pink'), 650, 2);
    d.amp(pop, perc(0.002, 0.06));
    return d.sum(0.45, [[thump(d, 0.14, 170, 70, 2), 1], [pop, 0.6], [spring(d, 0.35, 190, 0.45), 0.35, 0.02]]);
  } },
  boing: { v: 3, db: -14, gen(d) {
    return d.sum(0.4, [[spring(d, 0.38, d.r(230, 270), 0.35, 20), 0.8], [thump(d, 0.08, 120, 70), 0.6], [tick(d, 2000, 0.005), 0.3]]);
  } },
  explosion: { v: 4, db: -3, duck: 0.35, gen: (d) => blast(d, 1.5, false) },
  explosionBig: { v: 3, db: -1, duck: 0.6, gen: (d) => blast(d, 2.6, true) },
  toaster: { v: 2, db: -10, gen(d) {
    return d.sum(0.9, [[spring(d, 0.2, 320, 0.3, 30), 0.3], [strike(d, 780, 0.12, PLATE, { hard: 5000 }), 0.7], [thump(d, 0.08, 180, 100), 0.5],
      [fmBell(d, 0.8, 2093, { idx: 2.5, t60: 0.7 }), 0.55, 0.06], [fmBell(d, 0.6, 4186, { ratio: 2, idx: 0.5, t60: 0.4 }), 0.15, 0.06]]);
  } },
  toast: { v: 3, db: -16, gen(d) {
    const puff = d.bp(d.noise(0.1, 'pink'), 1200, 1.2);
    d.amp(puff, perc(0.002, 0.07));
    return d.sum(0.18, [[thump(d, 0.08, 230, 120), 0.8], [puff, 0.6], [spring(d, 0.12, 400, 0.3, 30), 0.15]]);
  } },
  zapHit: { v: 4, db: -14, gen(d) {
    const cr = d.dust(0.18, ex(9000, 300, 0.1));
    d.bp(cr, 3500, 0.7); d.amp(cr, perc(0.001, 0.12));
    const buzz = d.osc(0.12, d.r(90, 130), 'saw');
    d.drive(buzz, 3); d.lp(buzz, 3000); d.amp(buzz, perc(0.002, 0.09));
    const snap = d.amp(d.fm(0.06, ex(3200, 600, 0.05), 1.41, 3), perc(0.001, 0.05));
    return d.sum(0.18, [[cr, 1], [buzz, 0.4], [snap, 0.4]]);
  } },
  quack: { v: 4, db: -12, jit: 0.05, gen(d) {
    const L = 0.26, f0 = d.r(480, 560);
    const src = d.osc(L, pts([[0, f0 * 0.9], [0.03, f0], [0.2, f0 * 0.72]]), 'pulse', { pw: 0.18 });
    d.amp(src, (t) => 1 + 0.35 * Math.sin(TAU * 55 * t));
    const out = d.sum(L, [[d.bp(src.slice(), pts([[0, 1300], [0.2, 900]]), 4), 1], [d.bp(src.slice(), 2600, 5), 0.45], [d.hp(src.slice(), 300), 0.15]]);
    return d.amp(out, perc(0.01, 0.2, 0.05));
  } },
  transform: { v: 2, db: -10, gen(d) {
    const puff = d.bp(d.noise(0.35, 'pink'), ex(700, 3000, 0.25), 1);
    d.amp(puff, swell(0.02, 0.3));
    const rise = d.amp(d.osc(0.25, ex(400, 2400, 0.22)), swell(0.15, 0.1));
    return d.sum(0.7, [[puff, 0.8], [rise, 0.2], [sparkle(d, 0.4, 7, 3000, 7000), 0.35], [SFX.quack.gen(d), 0.7, 0.28]]);
  } },
  pop: { v: 4, db: -14, gen(d) {
    const b = d.amp(d.osc(0.08, ex(450, 1400, 0.03)), perc(0.001, 0.06));
    const puff = d.bp(d.noise(0.06, 'pink'), 1400, 1);
    d.amp(puff, perc(0.001, 0.04));
    return d.sum(0.14, [[b, 1], [puff, 0.5], [tick(d, 3000, 0.003), 0.3]]);
  } },
  turret: { v: 2, db: -11, gen(d) {
    const beep = (f) => d.amp(d.osc(0.08, f, 'tri'), perc(0.002, 0.06, 0.02));
    return d.sum(0.9, [[servo(d, 0.3, 150, 650), 0.5], [strike(d, 1200, 0.05, PLATE, { hard: 7000 }), 0.5, 0.1], [strike(d, 1350, 0.05, PLATE, { hard: 7000 }), 0.5, 0.2],
      [thump(d, 0.12, 150, 70, 1.5), 0.8, 0.3], [strike(d, 600, 0.18, BAR, { hard: 5000 }), 0.5, 0.3], [beep(1800), 0.3, 0.42], [beep(2400), 0.3, 0.52],
      [babble(d, 2, 105, { syl: [0.08, 0.12], q: 6 }), 0.35, 0.6]]);
  } },
  turretShot: { v: 4, db: -17, gen(d) {
    const z = d.amp(d.fm(0.1, ex(1700, 600, 0.08), 0.5, ex(4, 0.5, 0.08)), perc(0.001, 0.08));
    return d.sum(0.13, [[z, 1], [tick(d, 3500, 0.004), 0.5], [thump(d, 0.05, 320, 150), 0.4]]);
  } },
  saw: { v: 3, db: -11, gen(d) {
    const L = 0.5, f = pts([[0, 1500], [0.08, 1750], [0.45, 1350]]), sw = swell(0.02, 0.3, 0.1);
    const whine = d.sum(L, [[d.osc(L, f), 1], [d.osc(L, (t) => f(t) * 2.03), 0.5], [d.osc(L, (t) => f(t) * 3.1), 0.3]]);
    d.amp(whine, (t) => (1 + 0.5 * Math.sin(TAU * 38 * t)) * sw(t));
    const air = d.bp(d.noise(L), 2800, 1.5);
    d.amp(air, swell(0.02, 0.35));
    return d.sum(L, [[thump(d, 0.1, 180, 90, 1.5), 0.8], [tick(d, 3000), 0.6], [whine, 0.3], [air, 0.3]]);
  } },
  sawHit: { v: 4, db: -12, gen(d) {
    const scr = d.bp(d.noise(0.25), d.r(3800, 4800), 6);
    d.amp(scr, perc(0.002, 0.2));
    const grit = d.hp(d.dust(0.2, 4000), 2000);
    d.amp(grit, perc(0.001, 0.15));
    return d.sum(0.35, [[scr, 0.8], [grit, 0.5], [strike(d, d.r(2000, 2400), 0.25, BAR, { hard: 9000 }), 0.4], [tick(d, 2500), 0.5]]);
  } },
  rocket: { v: 3, db: -9, gen(d) {
    const L = 1.1;
    const jet = d.sum(L, [[d.noise(L, 'pink'), 1], [d.noise(L), 0.4]]);
    d.lp(jet, pts([[0, 1200], [0.06, 5000], [1.0, 700]]), 0.8);
    d.amp(jet, pts([[0, 0], [0.015, 1], [0.3, 0.55], [1.05, 0]], true));
    const comb = d.bp(d.dust(L, 900), 1800, 0.8);
    d.amp(comb, swell(0.01, 0.8));
    const roar = d.lp(d.noise(L, 'brown'), 220);
    d.amp(roar, swell(0.03, 0.9));
    return d.sum(L, [[thump(d, 0.14, 130, 50, 2), 0.8], [tick(d, 1500, 0.01), 0.6], [jet, 1], [comb, 0.3], [roar, 0.6]]);
  } },
  snipe: { v: 3, db: -5, duck: 0.3, gen(d) {
    const crack = d.hp(d.noise(0.04), 1800);
    d.amp(crack, perc(0.0003, 0.025)); d.drive(crack, 3);
    const tchiew = d.amp(d.fm(0.35, ex(3800, 380, 0.25), 1, ex(6, 0.1, 0.2)), perc(0.001, 0.3));
    const tail = d.noise(0.9, 'brown');
    d.lp(tail, ex(1200, 300, 0.6)); d.amp(tail, swell(0.01, 0.8));
    return d.verb(d.sum(1.1, [[crack, 1], [tchiew, 0.35], [thump(d, 0.4, 120, 40, 2.5), 0.9], [tail, 0.5]]), { size: 1.5, decay: 0.8, mix: 0.25 });
  } },
  tornado: { v: 2, db: -10, gen(d) {
    const L = 1.2, c = ex(400, 1300, 0.9);
    const sw = d.bp(d.noise(L, 'pink'), (t) => c(t) * (1 + 0.45 * Math.sin(TAU * 6 * t)), 2);
    const wh = d.bp(d.noise(L), (t) => c(t) * 2.2 * (1 + 0.3 * Math.sin(TAU * 6 * t + 1)), 12);
    const out = d.sum(L, [[sw, 1], [wh, 0.4], [d.lp(d.noise(L, 'brown'), 200), 0.5]]);
    return d.amp(out, swell(0.15, 0.75, 0.25));
  } },
  disco: { v: 2, db: -10, gen(d) {
    const stab = d.sum(0.5, [60, 64, 67, 71].map((m) => [d.osc(0.5, mtof(m) * d.j(0.003), 'saw'), 0.5]));
    d.lp(stab, pts([[0, 600], [0.04, 4500], [0.3, 700]]), 4); d.amp(stab, perc(0.004, 0.4, 0.05));
    const bass = d.osc(0.3, mtof(36), 'saw');
    d.lp(bass, ex(1500, 200, 0.2), 2); d.amp(bass, perc(0.003, 0.25));
    const hat = d.hp(d.noise(0.25), 7000);
    d.amp(hat, perc(0.002, 0.2));
    return d.verb(d.sum(0.8, [[stab, 1], [bass, 0.6], [hat, 0.3, 0.12], [sparkle(d, 0.5, 6, 4000, 8000), 0.2, 0.05]]), { size: 0.8, decay: 0.75, mix: 0.2 });
  } },
  freeze: { v: 3, db: -10, gen(d) {
    const cr = d.dust(0.6, ex(5000, 150, 0.45));
    d.bp(cr, 5500, 1.2); d.amp(cr, perc(0.003, 0.5));
    const hiss = d.hp(d.noise(0.5), 4500);
    d.amp(hiss, swell(0.01, 0.45));
    const creak = d.bp(d.osc(0.3, ex(300, 180, 0.3), 'saw'), 1100, 4), sw = swell(0.05, 0.25);
    d.amp(creak, (t) => (0.5 + 0.5 * Math.sin(TAU * 35 * t)) * sw(t));
    return d.sum(0.8, [[cr, 0.7], [hiss, 0.4], [sparkle(d, 0.5, 6, 2500, 6500), 0.5], [creak, 0.2, 0.05]]);
  } },
  shatter: { v: 4, db: -8, gen(d) {
    const crack = d.hp(d.noise(0.05), 1500);
    d.amp(crack, perc(0.0005, 0.04)); d.drive(crack, 2.5);
    const shards = scatter(d, 0.8, 16, () => 0.3 * Math.pow(d.random(), 1.5), (k, n, t) =>
      d.gain(strike(d, d.r(1800, 7000), d.r(0.12, 0.45), GLASS, { hard: 12000, exc: 0.0005 }), d.r(0.3, 1) * Math.exp(-t * 4)));
    const burst = d.hp(d.noise(0.3), 2500);
    d.amp(burst, perc(0.002, 0.22));
    return d.sum(0.9, [[crack, 0.8], [shards, 0.6], [burst, 0.4], [thump(d, 0.08, 200, 90), 0.4]]);
  } },

  // --- ennemis ---
  enemyShot: { v: 4, db: -12, gen(d) {
    const a = d.amp(d.fm(0.2, ex(1300, 260, 0.16), 2, ex(3, 0.4, 0.15)), perc(0.002, 0.17));
    const b = d.amp(d.fm(0.16, ex(1950, 390, 0.13), 1.5, 1.5), perc(0.002, 0.12));
    return d.sum(0.22, [[a, 1], [b, 0.35], [tick(d, 3000, 0.004), 0.4]]);
  } },
  laser: { v: 3, db: -10, gen(d) {
    const L = 0.65, f = ex(440, 200, 0.55);
    const beam = d.sum(L, [[d.osc(L, f, 'saw'), 1], [d.osc(L, (t) => f(t) * 1.012, 'saw'), 1], [d.osc(L, (t) => f(t) * 0.5, 'square'), 0.5]]);
    d.lp(beam, ex(5000, 900, 0.55), 3);
    d.amp(beam, (t) => 1 + 0.25 * Math.sin(TAU * 48 * t));
    d.amp(beam, pts([[0, 0], [0.01, 1], [0.38, 0.7], [0.6, 0]], true));
    const fizz = d.amp(d.fm(L, 2200, 1.41, 2), pts([[0, 0], [0.01, 1], [0.6, 0]], true));
    return d.sum(L, [[beam, 1], [fizz, 0.12], [tick(d, 2500, 0.006), 0.5]]);
  } },
  enemyHurt: { v: 5, db: -13, gen(d) {
    const crunch = d.bp(d.noise(0.05), 2000, 0.8);
    d.amp(crunch, perc(0.001, 0.04));
    const glitch = d.osc(0.07, ex(d.r(800, 1100), 280, 0.06), 'square');
    d.crush(glitch, 3, 6); d.lp(glitch, 4000); d.amp(glitch, perc(0.001, 0.06));
    return d.sum(0.22, [[strike(d, d.r(480, 760), 0.13, PLATE, { hard: 5000, exc: 0.001 }), 0.7], [crunch, 0.5], [glitch, 0.18], [thump(d, 0.06, 180, 90), 0.4]]);
  } },
  enemyDie: { v: 4, db: -8, gen(d) {
    const crack = d.hp(d.noise(0.04), 1200);
    d.amp(crack, perc(0.0005, 0.03));
    const body = d.noise(0.4, 'pink');
    d.lp(body, ex(4500, 300, 0.25)); d.amp(body, perc(0.002, 0.32)); d.drive(body, 2);
    const parts = scatter(d, 0.8, 8, () => d.r(0.03, 0.5), (k, n, t) => d.gain(strike(d, d.r(600, 2600), d.r(0.05, 0.15), PLATE, { hard: 7000, exc: 0.0006 }), d.r(0.3, 1) * Math.exp(-t * 3)));
    const down = d.osc(0.45, ex(1000, 70, 0.4), 'saw');
    d.lp(down, 2500); d.crush(down, 5, 3); d.amp(down, perc(0.005, 0.42));
    return d.sum(0.9, [[crack, 0.6], [body, 1], [thump(d, 0.3, 130, 40, 2), 0.8], [parts, 0.35, 0.02], [down, 0.18]]);
  } },
  robot: { v: 5, db: -13, gen: (d) => chatter(d, 3 + Math.floor(d.random() * 3), 700, 1900) },
  // voix des dialogues
  voiceEcrou: { v: 6, db: -13, gen: (d) => chatter(d, 4 + Math.floor(d.random() * 3), 1300, 2800, true) },
  voiceBaron: { v: 5, db: -11, gen(d) {
    const x = babble(d, 3 + Math.floor(d.random() * 2), 92, { shift: 0.85, q: 7, drift: 0.2 });
    d.amp(x, (t) => 0.7 + 0.3 * Math.sin(TAU * 32 * t));
    return d.drive(x, 2);
  } },
  voice: { v: 6, db: -14, gen: (d) => babble(d, 2 + Math.floor(d.random() * 3), d.r(170, 230)) },
  beep: { v: 1, db: -17, jit: 0, gen(d) {
    const x = d.sum(0.13, [[d.osc(0.13, 1000), 1], [d.osc(0.13, 2000), 0.2], [d.osc(0.13, 3000), 0.08]]);
    return d.amp(x, perc(0.002, 0.08, 0.03));
  } },
  shieldHit: { v: 4, db: -12, gen(d) {
    const ring = strike(d, d.r(1400, 1700), 0.35, [1, 1.5, 2.2, 3.1], { hard: 9000 });
    const rm = d.amp(ring.slice(), (t) => Math.sin(TAU * 330 * t));
    const cr = d.bp(d.dust(0.1, 5000), 4000, 1);
    d.amp(cr, perc(0.001, 0.08));
    return d.sum(0.45, [[ring, 0.5], [rm, 0.5], [cr, 0.4], [tick(d, 3000), 0.4]]);
  } },
  forcefield: { v: 2, db: -12, gen(d) {
    const L = 0.9;
    const hum = d.sum(L, [[d.osc(L, 110, 'saw'), 1], [d.osc(L, 110.8, 'saw'), 1], [d.osc(L, 221, 'saw'), 0.5]]);
    d.lp(hum, pts([[0, 300], [0.25, 2600], [0.85, 400]]), 2); d.amp(hum, swell(0.06, 0.6, 0.15));
    const sweep = d.amp(d.osc(0.5, ex(300, 1400, 0.4)), swell(0.2, 0.3));
    return d.sum(L, [[hum, 1], [sweep, 0.15], [d.bp(d.dust(L, 60), 3000, 1), 0.15]]);
  } },
  alarm: { v: 1, db: -9, jit: 0, gen(d) {
    const L = 1.05, cyc = (t) => (t % 0.33) / 0.33;
    const f = (t) => 520 + 360 * Math.min(1, cyc(t) * 1.6);
    const x = d.sum(L, [[d.osc(L, f, 'saw'), 1], [d.osc(L, (t) => f(t) * 1.5, 'square'), 0.4]]);
    d.bp(x, 1300, 1.2); d.drive(x, 2.5);
    d.amp(x, (t) => { const u = cyc(t); return u < 0.85 ? Math.min(1, u * 20) : Math.max(0, (1 - u) / 0.15); });
    return d.verb(x, { size: 1.2, decay: 0.7, mix: 0.2 });
  } },
  // sifflement d'un obus qui arrive
  mortar: { v: 2, db: -12, gen(d) {
    const L = 1.0, f = (t) => 2300 * Math.pow(650 / 2300, Math.min(1, t / 0.95)) * (1 + 0.012 * Math.sin(TAU * 7 * t));
    const out = d.sum(L, [[d.osc(L, f), 1], [d.bp(d.noise(L), f, 8), 0.6]]);
    return d.amp(out, pts([[0, 0.05], [0.7, 0.9], [0.95, 1], [1, 0]], true));
  } },
  roar: { v: 3, db: -6, duck: 0.4, gen(d) {
    const L = 1.4, sr = d.sr;
    const jit = d.lp(d.noise(L), 25);
    let m = 1e-6;
    for (const v of jit) m = Math.max(m, Math.abs(v));
    const base = pts([[0, 55], [0.25, 82], [1.3, 50]]);
    const f0 = (t) => base(t) * (1 + 0.25 * jit[Math.min(jit.length - 1, Math.floor(t * sr))] / m);
    const src = d.sum(L, [[d.osc(L, f0, 'saw'), 1], [d.osc(L, (t) => f0(t) * 1.01, 'pulse', { pw: 0.3 }), 0.6], [d.noise(L, 'pink'), 0.4]]);
    const out = d.sum(L, [[d.bp(src.slice(), 480, 3), 1], [d.bp(src.slice(), 1050, 4), 0.7], [d.bp(src.slice(), 2400, 5), 0.35], [d.lp(src.slice(), 300), 0.6]]);
    d.drive(out, 3);
    d.mix(out, d.osc(L, (t) => f0(t) * 0.5), 0.4);
    return d.amp(out, pts([[0, 0], [0.12, 1], [0.8, 0.8], [1.3, 0]], true));
  } },
  crate: { v: 4, db: -10, gen(d) {
    const crack = d.hp(d.noise(0.04), 800);
    d.amp(crack, perc(0.0005, 0.025)); d.drive(crack, 2.5);
    const spl = d.dust(0.3, ex(4000, 60, 0.2));
    d.bp(spl, 2500, 1.2); d.amp(spl, perc(0.001, 0.22));
    const planks = scatter(d, 0.5, 5, () => d.r(0.06, 0.35), (k, n, t) => d.gain(strike(d, d.r(250, 600), d.r(0.05, 0.1), WOOD, { hard: 3000, exc: 0.0015 }), d.r(0.3, 0.8) * Math.exp(-t * 3)));
    return d.sum(0.6, [[crack, 0.7], [strike(d, d.r(180, 240), 0.12, WOOD, { hard: 3000, exc: 0.002, tilt: 0.6 }), 1],
      [strike(d, d.r(330, 430), 0.09, WOOD, { hard: 3500, exc: 0.0015, tilt: 0.6 }), 0.6, 0.01], [spl, 0.4], [planks, 0.6], [thump(d, 0.1, 150, 70), 0.5]]);
  } },
  // montée d'énergie avant une attaque à distance
  charge: { v: 2, db: -12, gen(d) {
    const L = 0.7, sr = d.sr, f = ex(160, 1000, 0.6), rate = ex(7, 32, 0.6);
    const x = d.sum(L, [[d.osc(L, f, 'saw'), 0.6], [d.osc(L, (t) => f(t) * 2), 0.6]]);
    d.lp(x, 3500);
    let ph = 0;
    for (let i = 0; i < x.length; i++) { ph += rate(i / sr) / sr; x[i] *= 0.6 + 0.4 * Math.sin(TAU * ph); }
    const out = d.sum(L, [[x, 1], [d.bp(d.noise(L), ex(800, 5000, 0.6), 2), 0.25]]);
    return d.amp(out, pts([[0, 0], [0.55, 1], [0.68, 0]], true));
  } },
  // élan d'une attaque physique (coup de poing, plongeon, glissade)
  windup: { v: 3, db: -13, gen(d) {
    const clicks = scatter(d, 0.4, 7, (k) => 0.3 * (1 - Math.pow(1 - k / 7, 1.6)), () => strike(d, d.r(2200, 2800), 0.03, PLATE, { hard: 8000, exc: 0.0005 }));
    return d.sum(0.5, [[servo(d, 0.4, 220, 700), 0.45], [clicks, 0.4], [whoosh(d, 0.4, 300, 1500, 1800, 1, 0.9), 0.4]]);
  } },
  dig: { v: 4, db: -15, gen(d) {
    const dirt = d.noise(0.3, 'brown');
    d.lp(dirt, ex(2200, 500, 0.2)); d.amp(dirt, perc(0.004, 0.22));
    const grav = d.dust(0.3, ex(3000, 100, 0.25));
    d.bp(grav, 2200, 1); d.amp(grav, perc(0.002, 0.25));
    return d.sum(0.35, [[dirt, 1], [grav, 0.4], [thump(d, 0.08, 120, 70), 0.5]]);
  } },
  bird: { v: 8, db: -20, jit: 0.05, gen(d) {
    const n = 2 + Math.floor(d.random() * 4), trill = d.random() < 0.5;
    let t = 0;
    const parts = [];
    for (let k = 0; k < n; k++) {
      const L = d.r(0.05, 0.12), a = d.r(2200, 3600), b = a * d.r(0.6, 1.5), w = d.r(25, 60);
      const f = trill ? (u) => a * (1 + 0.2 * Math.sin(TAU * w * u)) : ex(a, b, L);
      const x = d.osc(L, f);
      d.mix(x, d.osc(L, (u) => f(u) * 2), 0.15);
      d.amp(x, swell(L * 0.25, L * 0.65, L * 0.05));
      parts.push([x, d.r(0.6, 1), t]);
      t += L + d.r(0.03, 0.12);
    }
    return d.sum(t + 0.05, parts);
  } },

  // --- interface ---
  uiMove: { v: 2, db: -20, jit: 0.01, gen(d) {
    return d.sum(0.06, [[d.amp(d.osc(0.05, 2100), perc(0.001, 0.03)), 1], [tick(d, 5000, 0.003), 0.3]]);
  } },
  uiSelect: { v: 1, db: -14, jit: 0, gen(d) {
    const b = (f) => d.amp(d.fm(0.16, f, 2, ex(1.2, 0.1, 0.12)), perc(0.002, 0.14));
    return d.sum(0.24, [[b(1046), 0.8], [b(1568), 1, 0.06], [tick(d, 4000, 0.003), 0.3]]);
  } },
  uiBack: { v: 1, db: -13, jit: 0, gen(d) {
    const b = (f) => d.amp(d.fm(0.16, f, 2, ex(1.2, 0.1, 0.12)), perc(0.002, 0.14));
    return d.sum(0.24, [[b(1568), 0.8], [b(1046), 1, 0.06]]);
  } },
  deny: { v: 1, db: -13, jit: 0, gen(d) {
    const tone = (L, f) => {
      const x = d.sum(L, [[d.osc(L, f, 'saw'), 1], [d.osc(L, f * 1.012, 'saw'), 1]]);
      d.lp(x, 900, 1.5);
      return d.amp(x, perc(0.004, L, L * 0.4));
    };
    return d.sum(0.36, [[tone(0.12, 196), 1], [tone(0.16, 147), 1, 0.13]]);
  } },
  swap: { v: 3, db: -13, gen(d) {
    return d.sum(0.3, [[strike(d, 1900, 0.05, PLATE, { hard: 8000, exc: 0.0006 }), 0.8], [servo(d, 0.1, 600, 1100), 0.2, 0.02],
      [strike(d, 1250, 0.09, PLATE, { hard: 6000, exc: 0.0008 }), 1, 0.09], [thump(d, 0.05, 200, 110), 0.4, 0.09]]);
  } },
  buy: { v: 2, db: -8, gen(d) {
    const coins = scatter(d, 0.5, 9, () => d.r(0, 0.3), () => d.gain(strike(d, d.r(2400, 4200), d.r(0.1, 0.25), NUT, { hard: 10000, exc: 0.0006 }), d.r(0.3, 1)));
    return d.verb(d.sum(1.1, [[coins, 0.5], [fmBell(d, 0.9, mtof(84), { t60: 0.8 }), 0.6, 0.1], [fmBell(d, 0.9, mtof(91), { t60: 0.8 }), 0.5, 0.22]]), { size: 0.9, decay: 0.75, mix: 0.2 });
  } },
  levelup: { v: 1, db: -7, jit: 0, gen(d) {
    const layers = [60, 64, 67, 72, 76, 79].map((m, i) => [pluck(d, 0.4, mtof(m), { cut: 6000, t60: 0.35 }), 0.5, i * 0.055]);
    for (const m of [72, 76, 79, 84]) layers.push([pad(d, 1.3, mtof(m)), 0.25, 0.33]);
    layers.push([sparkle(d, 1.2, 8, 3000, 7000), 0.15, 0.33]);
    return d.verb(d.sum(1.8, layers), { size: 1.1, decay: 0.8, mix: 0.22 });
  } },
  weaponUp: { v: 1, db: -7, jit: 0, gen(d) {
    const layers = [55, 60, 64, 67, 72].map((m, i) => [pluck(d, 0.4, mtof(m), { cut: 5000, t60: 0.35 }), 0.45, i * 0.06]);
    for (const m of [60, 67, 72, 76, 79]) layers.push([pad(d, 1.5, mtof(m)), 0.22, 0.3]);
    const rise = d.osc(0.35, ex(200, 1600, 0.3), 'saw');
    d.lp(rise, 3000); d.amp(rise, swell(0.25, 0.1));
    layers.push([whoosh(d, 0.5, 300, 4000, 6000, 0.8, 0.85), 0.3], [rise, 0.15], [sparkle(d, 1.4, 12, 3000, 9000), 0.18, 0.3]);
    return d.verb(d.sum(2.0, layers), { size: 1.2, decay: 0.82, mix: 0.25 });
  } },
  checkpoint: { v: 1, db: -9, jit: 0, gen(d) {
    const layers = [79, 83, 86, 91].map((m, i) => [fmBell(d, 1.4, mtof(m), { idx: 1.6, t60: 1.2 }), 0.5, i * 0.09]);
    layers.push([sparkle(d, 1.2, 6, 4000, 8000), 0.1, 0.3]);
    return d.verb(d.sum(2.0, layers), { size: 1.2, decay: 0.84, mix: 0.3 });
  } },
  open: { v: 2, db: -11, gen(d) {
    const hiss = d.hp(d.noise(0.45), 2500);
    d.amp(hiss, swell(0.02, 0.4));
    return d.sum(0.9, [[servo(d, 0.3, 180, 520), 0.4], [hiss, 0.3, 0.05], [strike(d, 760, 0.18, PLATE, { hard: 5000 }), 0.8, 0.3],
      [thump(d, 0.12, 130, 60, 1.5), 0.7, 0.3], [fmBell(d, 0.6, 1046, { idx: 1.5, t60: 0.5 }), 0.35, 0.38]]);
  } },
};

// ---------------------------------------------------------------- boucles
// gen(d, L) rend L secondes ; render.js fond la fin dans le début. `len` = durée de la boucle, `spin` = régime de
// départ d'un moteur (fraction de la vitesse), `fade` = temps de fondu à l'entrée et à la sortie.
export const LOOPS = {
  // hélice d'Écrou : battements de pales (souffle + coup sourd à chaque passage), flux d'air et petit moteur
  glide: { len: 2, db: -10, spin: 0.7, gen(d, L) {
    const sr = d.sr, n = d.len(L), bpf = 21; // 21 passages de pale par seconde : 42 dans la boucle de 2 s
    const air = d.bp(d.noise(L, 'pink'), 520, 0.9);
    const low = d.osc(L, 78);
    const amps = Array.from({ length: Math.ceil(L * bpf) + 2 }, (_, k) => d.r(0.88, 1.08) * (k % 2 ? 0.9 : 1));
    const flow = d.lp(d.noise(L, 'pink'), 1100);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = i / sr * bpf, ph = u % 1;
      const g = (ph < 0.18 ? Math.sin(ph / 0.18 * Math.PI / 2) : Math.exp(-(ph - 0.18) * 9)) * amps[Math.floor(u) % (bpf * 2)];
      out[i] = air[i] * g + low[i] * g * 0.35 + flow[i] * (0.18 + 0.1 * g);
    }
    const motor = d.lp(d.osc(L, (t) => 165 * (1 + 0.004 * Math.sin(TAU * 3 * t)), 'saw'), 1400);
    return d.sum(L, [[out, 1], [motor, 0.07], [d.osc(L, 662), 0.02]]);
  } },
  grind: { len: 2, db: -6, gen(d, L) {
    const w = drift(d, L, 6);
    const exc = d.amp(d.noise(L), (t) => 0.6 + 0.4 * w(t));
    const ring = d.modes(exc, [[1150, 0.06, 1], [1730, 0.05, 0.8], [2540, 0.04, 0.6], [3620, 0.03, 0.5], [5200, 0.02, 0.3]]);
    return d.sum(L, [[ring, 1], [d.bp(d.dust(L, 2500), 3500, 1), 0.4], [d.hp(d.noise(L), 6000), 0.12]]);
  } },
  // rayon du Zappeur : arc électrique qui bourdonne et crépite
  zap: { len: 2, db: -5, gen(d, L) {
    const buzz = d.sum(L, [[d.osc(L, 110, 'saw'), 1], [d.osc(L, 111.3, 'saw'), 1], [d.osc(L, 220.7, 'square'), 0.4]]);
    d.fold(buzz, 1.8); d.bp(buzz, 1500, 0.7);
    const gate = d.lp(d.noise(L), 40);
    d.amp(buzz, (t) => 0.55 + 0.45 * Math.tanh(gate[Math.min(gate.length - 1, Math.floor(t * d.sr))] * 30));
    return d.sum(L, [[buzz, 1], [d.hp(d.dust(L, 350), 2500), 0.45], [d.hp(d.noise(L), 6500), 0.15]]);
  } },
  // jet du Givreur : sifflement froid et cristaux
  frost: { len: 2, db: -8, gen(d, L) {
    const w = drift(d, L, 9);
    const hiss = d.hp(d.noise(L), 2500);
    d.mix(hiss, d.bp(hiss.slice(), 6500, 1.2), 0.8);
    d.amp(hiss, (t) => 0.75 + 0.25 * w(t));
    return d.sum(L, [[hiss, 1], [sparkle(d, L, 22, 4000, 9000), 0.3], [d.lp(d.noise(L, 'pink'), 700), 0.35]]);
  } },
  // aspiration du Goinfrotron
  vacuum: { len: 2.4, db: -3, spin: 0.6, gen(d, L) {
    const motor = d.sum(L, [[d.osc(L, 92, 'saw'), 1], [d.osc(L, 184.5, 'saw'), 0.6], [d.osc(L, 46, 'square'), 0.4]]);
    d.drive(motor, 2); d.lp(motor, 900, 1.2);
    const whistle = d.bp(d.noise(L), (t) => 2300 * (1 + 0.05 * Math.sin(TAU * 0.8 * t)), 14);
    return d.sum(L, [[motor, 0.5], [d.bp(d.noise(L, 'pink'), 850, 0.8), 1], [whistle, 0.25], [d.lp(d.noise(L, 'brown'), 150), 0.6]]);
  } },

  // --- ambiances des planètes ---
  // Brikka : vent de canyon, rafales et sifflements
  wind: { len: 9, db: -20, fade: 0.6, gen(d, L) {
    const a = drift(d, L, 0.25), b = drift(d, L, 0.12), c = drift(d, L, 0.4);
    const base = d.bp(d.noise(L, 'pink'), (t) => 300 + 450 * a(t), 0.6);
    d.amp(base, (t) => 0.35 + 0.65 * b(t));
    const howl = d.bp(d.noise(L), (t) => 650 + 400 * c(t), 18);
    d.amp(howl, (t) => a(t) * a(t));
    return d.sum(L, [[base, 1], [howl, 0.35], [d.lp(d.noise(L, 'brown'), 120), 0.5]]);
  } },
  // Nimbara : brise d'altitude, légère et claire
  breeze: { len: 9, db: -21, fade: 0.6, gen(d, L) {
    const a = drift(d, L, 0.3), b = drift(d, L, 0.15);
    const air = d.bp(d.noise(L, 'pink'), (t) => 900 + 900 * a(t), 0.5);
    d.amp(air, (t) => 0.35 + 0.65 * b(t));
    const hi = d.hp(d.noise(L), 5000);
    d.amp(hi, (t) => 0.2 + 0.4 * a(t));
    return d.sum(L, [[air, 1], [hi, 0.12]]);
  } },
  // Givrelune : blizzard qui hurle
  blizzard: { len: 10, db: -18, fade: 0.6, gen(d, L) {
    const a = drift(d, L, 0.35), b = drift(d, L, 0.2), c = drift(d, L, 0.5);
    const gust = d.bp(d.noise(L, 'pink'), (t) => 500 + 900 * a(t), 0.7);
    d.amp(gust, (t) => 0.3 + 0.7 * b(t) * b(t));
    const howl = d.bp(d.noise(L), (t) => 600 + 500 * c(t), 25);
    d.amp(howl, (t) => 0.2 + 0.8 * a(t));
    const snow = d.hp(d.noise(L), 4500);
    d.amp(snow, (t) => 0.3 + 0.7 * b(t));
    return d.sum(L, [[gust, 1], [howl, 0.35], [d.bp(d.noise(L), (t) => 950 + 400 * b(t), 30), 0.2], [snow, 0.15]]);
  } },
  // Luminbois : insectes nocturnes et souffle de la forêt
  forest: { len: 8, db: -21, fade: 0.6, gen(d, L) {
    const layers = [];
    for (let k = 0; k < 3; k++) {
      const f = d.r(4200, 5600), period = L / Math.round(L / d.r(0.45, 0.8)), pulses = 2 + Math.floor(d.random() * 3), off = d.r(0, 0.5);
      const x = d.osc(L, f);
      d.amp(x, (t) => {
        const u = (t + off) % period, p = Math.floor(u / 0.028);
        return p >= pulses ? 0 : Math.pow(Math.sin(((u % 0.028) / 0.028) * Math.PI), 2);
      });
      layers.push([x, d.r(0.3, 0.7)]);
    }
    const a = drift(d, L, 0.2);
    const air = d.lp(d.noise(L, 'pink'), 600);
    d.amp(air, (t) => 0.4 + 0.6 * a(t));
    layers.push([air, 0.5]);
    return d.sum(L, layers);
  } },
  // Station : ronronnement électrique, ventilation et coups métalliques lointains
  machines: { len: 8, db: -20, fade: 0.6, gen(d, L) {
    const hum = d.sum(L, [[d.osc(L, 50), 1], [d.osc(L, 100.25), 0.6], [d.osc(L, 150, 'saw'), 0.15]]);
    d.lp(hum, 400);
    const fan = d.bp(d.noise(L, 'pink'), 1200, 2);
    d.amp(fan, (t) => 0.85 + 0.15 * Math.sin(TAU * 12.5 * t));
    const clanks = scatter(d, L, 4, () => d.r(0.3, L - 2), () =>
      d.verb(d.gain(strike(d, d.r(150, 400), 0.6, PLATE, { hard: 1500, exc: 0.004, dur: 1.8 }), d.r(0.4, 1)), { size: 1.5, decay: 0.85, mix: 0.6 }));
    return d.sum(L, [[hum, 0.6], [d.lp(d.noise(L, 'brown'), 350), 0.8], [fan, 0.25], [clanks, 0.35]]);
  } },
};

// nom joué → recette, selon les options (surface des pas, grosse explosion)
export function pick(name, opts) {
  if (name === 'step') return opts.surface === 'metal' ? 'stepMetal' : opts.surface === 'grass' ? 'stepGrass' : 'step';
  if (name === 'explosion' && opts.big) return 'explosionBig';
  return name;
}

// ordre de calcul en tâche de fond : les sons les plus fréquents d'abord
export const PRIORITY = ['glide', 'step', 'stepMetal', 'stepGrass', 'jump', 'djump', 'land', 'rivet', 'bolt', 'swing', 'hit', 'enemyHurt', 'uiMove', 'uiSelect', 'whoosh',
  'explosion', 'enemyShot', 'enemyDie', 'hurt', 'dash', 'boltGold', 'robot', 'voiceEcrou', 'voice', 'voiceBaron', 'beep', 'crate'];
