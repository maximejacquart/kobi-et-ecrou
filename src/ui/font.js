// Police « Boulonnerie » entièrement générée en code.
// Chaque glyphe est un squelette de traits sur une grille (hauteur de capitale = 6),
// épaissi en polygones (segments + jointures octogonales) puis compilé en OpenType
// avec opentype.js et installé via l'API FontFace.
import { Font, Glyph, Path } from 'opentype.js';

const UNIT = 112; // unités de police par case de grille
const CAP = 6;
const SMALL = 4.5; // hauteur des petites capitales (minuscules)

// Squelettes : polylignes séparées par « | », points « x,y ». Un point seul = pavé.
const G = {
  A: [4, '0,0 0,5 1,6 3,6 4,5 4,0 | 0,2.8 4,2.8'],
  B: [4, '0,0 0,6 3,6 4,5 4,4.1 3,3.1 0,3.1 | 3,3.1 4,2.1 4,1 3,0 0,0'],
  C: [4, '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1'],
  D: [4, '0,0 0,6 3,6 4,5 4,1 3,0 0,0'],
  E: [3.6, '3.6,6 0,6 0,0 3.6,0 | 0,3 2.8,3'],
  F: [3.6, '3.6,6 0,6 0,0 | 0,3 2.8,3'],
  G: [4, '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,2.8 2.2,2.8'],
  H: [4, '0,0 0,6 | 4,0 4,6 | 0,3 4,3'],
  I: [0, '0,0 0,6'],
  J: [3.6, '3.6,6 3.6,1 2.6,0 1,0 0,1 0,1.6'],
  K: [4, '0,0 0,6 | 4,6 4,5.4 1.6,3 0,3 | 1.6,3 4,0.6 4,0'],
  L: [3.5, '0,6 0,0 3.5,0'],
  M: [5, '0,0 0,6 2.5,3 5,6 5,0'],
  N: [4, '0,0 0,6 4,0 4,6'],
  O: [4, '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0'],
  P: [4, '0,0 0,6 3,6 4,5 4,3.9 3,2.9 0,2.9'],
  Q: [4, '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0 | 2.6,1.6 4.3,-0.4'],
  R: [4, '0,0 0,6 3,6 4,5 4,4.1 3,3.1 0,3.1 | 3,3.1 4,2.1 4,0'],
  S: [4, '4,5 3,6 1,6 0,5 0,4.1 1,3.1 3,3.1 4,2.1 4,1 3,0 1,0 0,1'],
  T: [4, '0,6 4,6 | 2,6 2,0'],
  U: [4, '0,6 0,1 1,0 3,0 4,1 4,6'],
  V: [4, '0,6 0,2.2 2,0 4,2.2 4,6'],
  W: [5, '0,6 0,0 2.5,3 5,0 5,6'],
  X: [4, '0,6 0,5.3 4,0.7 4,0 | 4,6 4,5.3 0,0.7 0,0'],
  Y: [4, '0,6 0,4.4 2,2.6 4,4.4 4,6 | 2,2.6 2,0'],
  Z: [4, '0,6 4,6 4,5.2 0,0.8 0,0 4,0'],
  '0': [4, '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0 | 2,3'],
  '1': [3, '0,4.6 1.5,6 1.5,0 | 0,0 3,0'],
  '2': [4, '0,5 1,6 3,6 4,5 4,4 3,3 1,3 0,2 0,0 4,0'],
  '3': [4, '0,5 1,6 3,6 4,5 4,4.1 3,3.1 1.2,3.1 | 3,3.1 4,2.1 4,1 3,0 1,0 0,1'],
  '4': [4, '0,6 0,2.2 4,2.2 | 3,4.2 3,0'],
  '5': [4, '4,6 0,6 0,3.2 3,3.2 4,2.2 4,1 3,0 0,0'],
  '6': [4, '3.8,6 1,6 0,5 0,1 1,0 3,0 4,1 4,2.1 3,3.1 0,3.1'],
  '7': [4, '0,6 4,6 4,5 1.6,2 1.6,0'],
  '8': [4, '1,3.1 0,4.1 0,5 1,6 3,6 4,5 4,4.1 3,3.1 1,3.1 0,2.1 0,1 1,0 3,0 4,1 4,2.1 3,3.1'],
  '9': [4, '0.2,0 3,0 4,1 4,5 3,6 1,6 0,5 0,3.9 1,2.9 4,2.9'],
  '.': [0, '0,0'],
  ',': [0.6, '0.6,0.1 0.6,-0.3 0,-1.2'],
  ':': [0, '0,0 | 0,3.6'],
  ';': [0.6, '0.6,3.6 | 0.6,0.1 0.6,-0.3 0,-1.2'],
  '!': [0, '0,6 0,2.3 | 0,0'],
  '?': [4, '0,5 1,6 3,6 4,5 4,4.1 3,3.1 2,3.1 2,2.2 | 2,0'],
  "'": [0, '0,6 0,4.4'],
  '’': [0.6, '0.6,6 0.6,5.4 0,4.4'],
  '"': [1.6, '0,6 0,4.4 | 1.6,6 1.6,4.4'],
  '-': [2.4, '0,2.8 2.4,2.8'],
  '–': [3.6, '0,2.8 3.6,2.8'],
  '—': [5, '0,2.8 5,2.8'],
  '_': [4, '0,-0.8 4,-0.8'],
  '+': [3.4, '0,2.8 3.4,2.8 | 1.7,1.1 1.7,4.5'],
  '=': [3.4, '0,1.9 3.4,1.9 | 0,3.7 3.4,3.7'],
  '/': [3, '0,-0.2 3,6.2'],
  '\\': [3, '3,-0.2 0,6.2'],
  '(': [1.4, '1.4,6.8 0,5.4 0,0.6 1.4,-0.8'],
  ')': [1.4, '0,6.8 1.4,5.4 1.4,0.6 0,-0.8'],
  '[': [1.4, '1.4,6.8 0,6.8 0,-0.8 1.4,-0.8'],
  ']': [1.4, '0,6.8 1.4,6.8 1.4,-0.8 0,-0.8'],
  '%': [4.4, '0,0 4.4,6 | 0.3,5.2 | 4.1,0.8'],
  '&': [4.4, '4.4,0 0.9,4.1 0.9,5.1 1.8,6 2.6,6 3.4,5.1 3.4,4.4 0,2 0,0.9 0.9,0 2.6,0 4.4,2.4'],
  '*': [3, '1.5,2.6 1.5,6 | 0,5.2 3,3.5 | 0,3.5 3,5.2'],
  '#': [4.2, '1.2,0 1.6,6 | 2.8,0 3.2,6 | 0,2 4.2,2 | 0,4 4.2,4'],
  '<': [3, '3,5 0,3 3,1'],
  '>': [3, '0,5 3,3 0,1'],
  '«': [3.6, '1.6,4.6 0,3 1.6,1.4 | 3.6,4.6 2,3 3.6,1.4'],
  '»': [3.6, '0,4.6 1.6,3 0,1.4 | 2,4.6 3.6,3 2,1.4'],
  '…': [4.4, '0,0 | 2.2,0 | 4.4,0'],
  '×': [3, '0,1.3 3,4.3 | 0,4.3 3,1.3'],
  '°': [1.4, '0,5.4 0,6 1.4,6 1.4,5.4 0,5.4'],
  '·': [0, '0,3'],
  'Œ': [7, '7,6 1,6 0,5 0,1 1,0 7,0 | 3.6,0 3.6,6 | 3.6,3 6.2,3'],
  'Æ': [6.6, '0,0 0,5 1,6 6.6,6 | 0,2.8 3.4,2.8 | 3.4,6 3.4,0 6.6,0 | 3.4,3 5.8,3'],
};

// Accents posés au-dessus (h = hauteur du glyphe de base, c = centre)
const ACC = {
  acute: (c, h) => `${c - 0.7},${h + 1.3} ${c + 0.9},${h + 2.5}`,
  grave: (c, h) => `${c + 0.7},${h + 1.3} ${c - 0.9},${h + 2.5}`,
  circ: (c, h) => `${c - 1.4},${h + 1.3} ${c},${h + 2.5} ${c + 1.4},${h + 1.3}`,
  diaer: (c, h) => `${c - 1.1},${h + 1.7} | ${c + 1.1},${h + 1.7}`,
  cedil: (c) => `${c + 0.2},-0.2 ${c + 0.2},-0.9 ${c - 0.8},-1.7`,
};
const COMPOSITES = {
  'À': ['A', 'grave'], 'Â': ['A', 'circ'], 'Ä': ['A', 'diaer'], 'Ç': ['C', 'cedil'],
  'É': ['E', 'acute'], 'È': ['E', 'grave'], 'Ê': ['E', 'circ'], 'Ë': ['E', 'diaer'],
  'Î': ['I', 'circ'], 'Ï': ['I', 'diaer'], 'Ô': ['O', 'circ'], 'Ö': ['O', 'diaer'],
  'Ù': ['U', 'grave'], 'Û': ['U', 'circ'], 'Ü': ['U', 'diaer'], 'Ÿ': ['Y', 'diaer'],
};

function parse(skel) {
  return skel.split('|').map((poly) =>
    poly.trim().split(/\s+/).map((p) => p.split(',').map(Number)),
  );
}

// Transforme un squelette en polygones (sens anti-horaire) d'épaisseur t.
function strokePolys(lines, t) {
  const polys = [];
  const h = t / 2;
  const R = h / Math.cos(Math.PI / 8);
  const oct = (x, y) => {
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      pts.push([x + Math.cos(a) * R, y + Math.sin(a) * R]);
    }
    return pts;
  };
  for (const line of lines) {
    for (const [x, y] of line) polys.push(oct(x, y));
    for (let i = 0; i < line.length - 1; i++) {
      const [x1, y1] = line[i];
      const [x2, y2] = line[i + 1];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * h;
      const ny = (dx / len) * h;
      polys.push([
        [x1 - nx, y1 - ny],
        [x2 - nx, y2 - ny],
        [x2 + nx, y2 + ny],
        [x1 + nx, y1 + ny],
      ]);
    }
  }
  // Orientation homogène pour un remplissage « nonzero » sans trous parasites
  return polys.map((p) => {
    let area = 0;
    for (let i = 0; i < p.length; i++) {
      const [ax, ay] = p[i];
      const [bx, by] = p[(i + 1) % p.length];
      area += ax * by - bx * ay;
    }
    return area < 0 ? p.reverse() : p;
  });
}

// Fusionne des polygones convexes qui se chevauchent : champ de distance signé
// échantillonné sur une grille fine, puis contours extraits par marching squares.
// Résultat : contours disjoints, extérieurs anti-horaires, trous horaires.
function unionContours(polys) {
  const S = 12; // échantillons par case
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polys) for (const [x, y] of p) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  const x0 = minX - 0.5, y0 = minY - 0.5;
  const nx = Math.ceil((maxX - x0 + 0.5) * S) + 1;
  const ny = Math.ceil((maxY - y0 + 0.5) * S) + 1;
  const field = new Float32Array(nx * ny).fill(1);
  for (const p of polys) {
    const edges = p.map(([ax, ay], i) => {
      const [bx, by] = p[(i + 1) % p.length];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      return [(by - ay) / len, -(bx - ax) / len, ax, ay];
    });
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const [x, y] of p) {
      bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y);
    }
    const i0 = Math.max(0, Math.floor((bx0 - x0) * S) - 2), i1 = Math.min(nx - 1, Math.ceil((bx1 - x0) * S) + 2);
    const j0 = Math.max(0, Math.floor((by0 - y0) * S) - 2), j1 = Math.min(ny - 1, Math.ceil((by1 - y0) * S) + 2);
    for (let j = j0; j <= j1; j++) {
      const py = y0 + j / S;
      for (let i = i0; i <= i1; i++) {
        const px = x0 + i / S;
        let f = -Infinity;
        for (const [enx, eny, ax, ay] of edges) f = Math.max(f, enx * (px - ax) + eny * (py - ay));
        const k = j * nx + i;
        if (f < field[k]) field[k] = f;
      }
    }
  }
  const val = (i, j) => field[j * nx + i];
  const pt = (ia, ja, ib, jb) => {
    const fa = val(ia, ja), fb = val(ib, jb);
    const t = fa / (fa - fb);
    return [x0 + (ia + (ib - ia) * t) / S, y0 + (ja + (jb - ja) * t) / S];
  };
  const segs = new Map();
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const c = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      const ins = c.map(([a, b]) => val(a, b) < 0);
      if (ins.every((v) => v) || ins.every((v) => !v)) continue;
      const ids = [`h${i},${j}`, `v${i + 1},${j}`, `h${i},${j + 1}`, `v${i},${j}`];
      const cross = [];
      for (let k = 0; k < 4; k++) {
        const a = ins[k], b = ins[(k + 1) % 4];
        if (a !== b) {
          const [ia, ja] = c[k], [ib, jb] = c[(k + 1) % 4];
          cross.push({ k, exit: a, id: ids[k], p: pt(ia, ja, ib, jb) });
        }
      }
      const n = cross.length;
      const centerIn = (val(i, j) + val(i + 1, j) + val(i + 1, j + 1) + val(i, j + 1)) / 4 < 0;
      for (let m = 0; m < n; m++) {
        if (!cross[m].exit) continue;
        let target;
        if (n === 2) target = cross[(m + 1) % 2];
        else target = centerIn ? cross[(m + 1) % n] : cross[(m - 1 + n) % n];
        segs.set(cross[m].id, { to: target.id, p: cross[m].p });
      }
    }
  }
  const loops = [];
  while (segs.size) {
    const [startId] = segs.keys();
    const loop = [];
    let id = startId;
    while (segs.has(id)) {
      const s = segs.get(id);
      segs.delete(id);
      loop.push(s.p);
      id = s.to;
    }
    if (loop.length > 2) loops.push(simplify(loop, 0.012));
  }
  return loops;
}

function simplify(loop, eps) {
  const pts = loop.slice();
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      const dx = c[0] - a[0], dy = c[1] - a[1];
      const len = Math.hypot(dx, dy) || 1e-9;
      const d = Math.abs((b[0] - a[0]) * dy - (b[1] - a[1]) * dx) / len;
      if (d < eps) {
        pts.splice(i, 1);
        i--;
        changed = true;
      }
    }
  }
  return pts;
}

function buildFont(family, t, slant) {
  const side = 0.55; // approche latérale (cases)
  const glyphs = [];
  glyphs.push(new Glyph({ name: '.notdef', unicode: 0, advanceWidth: Math.round(4 * UNIT), path: new Path() }));

  const make = (name, unicode, lines, width, sx = 1, sy = 1) => {
    const path = new Path();
    const scaled = lines.map((l) => l.map(([x, y]) => [x * sx, y * sy]));
    const contours = unionContours(strokePolys(scaled, t));
    const ox = side + t / 2;
    for (const poly of contours) {
      poly.forEach(([x, y], i) => {
        const X = Math.round((x + ox + y * slant) * UNIT);
        const Y = Math.round(y * UNIT);
        if (i === 0) path.moveTo(X, Y);
        else path.lineTo(X, Y);
      });
      path.close();
    }
    const adv = Math.round((width * sx + t + side * 2) * UNIT);
    glyphs.push(new Glyph({ name, unicode, advanceWidth: adv, path }));
  };

  const space = (name, unicode, w) =>
    glyphs.push(new Glyph({ name, unicode, advanceWidth: Math.round(w * UNIT), path: new Path() }));
  space('space', 32, 2.6);
  space('nbsp', 160, 2.6);
  space('nnbsp', 8239, 1.4);
  space('thinsp', 8201, 1.4);

  const sc = SMALL / CAP;
  const sxSmall = 0.92;
  let idx = 0;
  for (const [ch, [w, skel]] of Object.entries(G)) {
    const lines = parse(skel);
    make(`g${idx++}`, ch.codePointAt(0), lines, w);
    if (/^[A-ZŒÆ]$/.test(ch)) {
      make(`g${idx++}`, ch.toLowerCase().codePointAt(0), lines, w, sxSmall, sc);
    }
  }
  for (const [ch, [base, acc]] of Object.entries(COMPOSITES)) {
    const [w, skel] = G[base];
    const baseLines = parse(skel);
    // Capitale accentuée
    let extra = parse(acc === 'cedil' ? ACC.cedil(w / 2) : ACC[acc](w / 2, CAP));
    make(`g${idx++}`, ch.codePointAt(0), [...baseLines, ...extra], w);
    // Minuscule accentuée (petite capitale)
    const lw = w * sxSmall;
    const small = baseLines.map((l) => l.map(([x, y]) => [x * sxSmall, y * sc]));
    extra = parse(acc === 'cedil' ? ACC.cedil(lw / 2) : ACC[acc](lw / 2, SMALL));
    make(`g${idx++}`, ch.toLowerCase().codePointAt(0), [...small, ...extra], lw);
  }

  return new Font({
    familyName: family,
    styleName: 'Regular',
    unitsPerEm: 1000,
    ascender: 960,
    descender: -260,
    glyphs,
  });
}

export const FONT_TITLE = 'Boulonnerie';
const FONT_TEXT = 'Boulonnerie Texte';

export async function installFonts() {
  const specs = [
    [FONT_TITLE, 1.08, 0.08],
    [FONT_TEXT, 0.66, 0.04],
  ];
  for (const [family, t, slant] of specs) {
    const font = buildFont(family, t, slant);
    const face = new FontFace(family, font.toArrayBuffer());
    await face.load();
    document.fonts.add(face);
  }
}
