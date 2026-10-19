import * as THREE from 'three';
import { G, part, joint, mergeGeometries } from '../geo.js';
import { mat, glow } from '../../engine/materials.js';
import { build, mix3, hex, sstep, scratch, fbmP, hazardTexture } from '../../engine/textures.js';
import { fbm2, clamp } from '../../engine/util.js';
import { Sculpt, sculptSkin } from '../sculpt.js';
import { OL, rig, robotEye } from './common.js';

// ===================================================================== Pinceur (et Pinceur Royal)
// Crabe-char : carapace bombée en plaques de tôle peinte qui se chevauchent, blindage frontal doré, mortier dorsal
// à culasse et frettes, yeux pédonculés, évent arrière cerclé de bandes de danger (point faible).
// Deux corps sculptés : la coque (maille large) et les membres (pattes, pinces, pédoncules : maille fine).
// Le Royal (boss, mis à l'échelle par DEFS) : laque framboise à liserés dorés gravés, couronne fleuronnée,
// épaulières, pierres lumineuses ; mêmes os et mêmes pièces animées.

// ------------------------------------------------------------------ textures
// Tôle de carapace peinte, raccordable en u (le long de la plaque) : écaillage, rivets et rayures sur les bords en v
// (avant/arrière de la plaque). o : { chip (0..1), trim (couleur : liseré doré gravé le long des bords), seed }
function plateTexture(color, o = {}) {
  const base = hex(color);
  const deep = base.map((c) => c * 0.95), pale = base.map((c) => Math.min(1, c * 1.2 + 0.07)), rimC = base.map((c) => c * 0.42);
  const bare = hex('#c3c8d2'), bareD = bare.map((c) => c * 0.66), rivC = hex(o.trim ? '#ffe7a0' : '#9aa6c2');
  const gold = o.trim && hex(o.trim), goldD = gold && gold.map((c) => c * 0.5), goldL = gold && gold.map((c) => Math.min(1, c * 1.2 + 0.06));
  const chip = o.chip ?? 0.4, sd = o.seed ?? 701, band = o.trim ? 0.14 : 0;
  return build('pinceur-plate-' + [color, chip, o.trim || '', sd].join('|'), 256, (u, v, out) => {
    const n = fbm2(u * 4, v * 4, 4, sd, 4);
    mix3(out, deep, pale, clamp(0.35 + (n - 0.5) * 1.3, 0, 1));
    let h = 0.6 + (n - 0.5) * 0.06;
    const e = Math.min(v, 1 - v);
    if (gold && e < band) {
      // liseré doré : rinceau ondulé entre deux filets, perles
      const t = e / band;
      mix3(out, goldD, goldL, 0.5 + (fbm2(u * 24, v * 24, 2, sd + 9, 24) - 0.5) * 0.8);
      h = 0.9;
      const w = Math.abs(t - 0.52 - 0.2 * Math.sin(u * Math.PI * 8));
      const pearl = Math.hypot(((u * 16) % 1) - 0.5, (t - 0.2) * 5.5);
      if (w < 0.07) { mix3(out, out, goldD, 0.75); h = 0.72; }
      if (pearl < 0.22) { mix3(out, out, goldL, 0.7); h = 1.05 - pearl; }
      if (t > 0.86) { mix3(out, out, goldD.map((c) => c * 0.6), 0.85); h = 0.5; }
      return h;
    }
    // écaillage : surtout près des bords, cerné d'un liseré sombre
    const ee = e - band;
    const cn = fbm2(u * 7, v * 7, 4, sd + 12, 7), cn2 = fbm2(u * 22, v * 22, 3, sd + 18, 22);
    const s = cn + (sstep(0.16, 0, ee) * 0.28 + sstep(0.05, 0, ee) * 0.16) * (0.4 + cn2 * 1.2);
    const lim = 0.95 - chip * 0.3;
    if (s > lim) { mix3(out, bareD, bare, 0.35 + cn2 * 0.65); h = 0.42; }
    else if (s > lim - 0.025) { mix3(out, out, rimC, 0.75); h = 0.66; }
    else if (scratch(u, v, 5, sd + 26) < 0.0025) { mix3(out, out, bare, 0.45); h -= 0.08; }
    // rangées de rivets le long des bords
    const ru = ((u * 3) % 1) - 0.5, rd = Math.hypot(ru / 3, ee - 0.055);
    if (rd < 0.022) { mix3(out, rivC.map((c) => c * 0.55), rivC, 1 - rd * 30); h = 1.05 - rd * 18; }
    else if (rd < 0.027) { mix3(out, out, rimC, 0.6); h = 0.5; }
    return h;
  }, 2.6);
}

// Or brossé (blindage, pinces, couronne) : grain étiré, ternissure dans les creux, rayures ; gravé de rinceaux
// (volutes, perles) pour le Royal. Raccordable ; UV en mètres × 1,5 environ.
function goldTexture(color, engrave) {
  const base = hex(color);
  const dk = base.map((c) => c * 0.74), lt = base.map((c) => Math.min(1, c * 1.15 + 0.1)), tarn = hex('#6a5634');
  return build('pinceur-gold-' + color + (engrave ? '-g' : ''), 256, (u, v, out) => {
    const br = fbmP(u * 3, v * 96, 3, 96, 2, 741), n = fbm2(u * 5, v * 5, 4, 743, 5);
    mix3(out, dk, lt, clamp(0.58 + (br - 0.5) * 0.16 + (n - 0.5) * 0.7, 0, 1));
    let h = 0.6 + (br - 0.5) * 0.04;
    const t = fbm2(u * 4 + 3, v * 4, 4, 747, 4);
    if (t > 0.64) mix3(out, out, tarn, clamp((t - 0.64) * 1.6, 0, 0.3));
    if (scratch(u, v, 10, 751) < 0.003) { mix3(out, out, lt, 0.6); h -= 0.06; }
    if (engrave) {
      // frise de rinceaux : tige ondulée, volutes dans les creux, rangs de perles entre les frises
      const x = u * 2, y = v * 2, fx = x - Math.floor(x), fy = y - Math.floor(y);
      const yc = 0.5 + 0.2 * Math.sin(fx * Math.PI * 2);
      const d = Math.min(
        Math.abs(fy - yc) * 0.8,
        Math.abs(Math.hypot(fx - 0.25, fy - 0.43) - 0.09), Math.abs(Math.hypot(fx - 0.75, fy - 0.57) - 0.09),
        Math.abs(Math.hypot(fx - 0.04, fy - 0.33) - 0.05), Math.abs(Math.hypot(fx - 0.54, fy - 0.67) - 0.05),
      );
      const pearl = Math.min(fy, 1 - fy) < 0.07 ? Math.hypot(((fx * 10) % 1) - 0.5, (Math.min(fy, 1 - fy) - 0.035) * 10) : 9;
      if (d < 0.016) { mix3(out, out, dk.map((c) => c * 0.6), 0.7 * (1 - d / 0.016)); h = 0.35 + d * 12; }
      if (pearl < 0.3) { mix3(out, out, lt, 0.6); h = 0.95 - pearl; }
      if (Math.min(fy, 1 - fy) > 0.07 && Math.min(fy, 1 - fy) < 0.085) { mix3(out, out, dk, 0.7); h = 0.4; }
    }
    return h;
  }, engrave ? 3 : 1.6);
}

// ------------------------------------------------------------------ géométries (calculées une fois, partagées)
const GEO = new Map();
const once = (key, make) => {
  if (!GEO.has(key)) { const g = make(); g.userData.shared = true; GEO.set(key, g); }
  return GEO.get(key);
};
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
// Pièce posée : copie non indexée (position, normale, uv), tournée r, placée p, échelle s, teintée c (couleurs de sommet)
function pc(geo, p = [0, 0, 0], r = [0, 0, 0], c = null, s = null) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  _s.set(1, 1, 1);
  if (s) typeof s === 'number' ? _s.setScalar(s) : _s.set(s[0], s[1], s[2]);
  g.applyMatrix4(_m4.compose(_p.set(p[0], p[1], p[2]), _q.setFromEuler(_e.set(r[0], r[1], r[2])), _s));
  return c ? tint(g, c) : g;
}
function tint(g, c) {
  const col = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
// Tige de a à b (vérins, tuyaux, mâts)
function rod(a, b, r0, r1, c, seg = 8) {
  _a.set(a[0], a[1], a[2]); _b.set(b[0], b[1], b[2]).sub(_a);
  const len = _b.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1).toNonIndexed();
  g.applyQuaternion(_q.setFromUnitVectors(_up, _b.normalize()));
  g.translate(_a.x + _b.x * len / 2, _a.y + _b.y * len / 2, _a.z + _b.z * len / 2);
  return c ? tint(g, c) : g;
}
// Vérin hydraulique de a à b : corps sombre, bague, tige chromée, chapes aux deux bouts
function ram(list, a, b, r = 0.045, k = 0.6) {
  const m = a.map((v, i) => v + (b[i] - v) * k);
  list.push(rod(a, m, r, r, '#3a3448', 10), rod(m, b, r * 0.5, r * 0.5, '#d8dee8', 8));
  list.push(pc(G.sphere(r * 1.25, 8, 6), a, [0, 0, 0], '#5a5468'), pc(G.sphere(r * 0.95, 8, 6), b, [0, 0, 0], '#5a5468'));
  const m2 = a.map((v, i) => v + (b[i] - v) * (k - 0.06));
  list.push(rod(m2, m, r * 1.25, r * 1.25, '#9aa6c2', 10));
  return list;
}
const uvScale = (g, su, sv = su) => {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return g;
};
// Retourne une géométrie (faces vues de l'intérieur : fourreaux, alésages)
function flip(g) {
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv, c = g.attributes.color;
  for (let i = 0; i < p.count; i += 3) for (const at of [p, n, uv, c]) {
    if (!at) continue;
    for (let k = 0; k < at.itemSize; k++) { const t = at.getComponent(i + 1, k); at.setComponent(i + 1, k, at.getComponent(i + 2, k)); at.setComponent(i + 2, k, t); }
  }
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}
const merge = (list) => { const g = mergeGeometries(list); for (const x of list) x.dispose(); return g; };

// Carapace : bandes d'ellipsoïde (axe polaire z, de l'avant à l'arrière) qui se chevauchent comme des écailles,
// bombées, marquées des trois crêtes longitudinales, épaisseur de tôle visible aux bords.
// UV : u le long de la bande (en largeurs de bande : texture raccordable), v de 0 (bord avant) à 1 (bord arrière).
function shellPlates(R, edges) {
  const out = [];
  const a0 = -0.16, a1 = Math.PI + 0.16, NU = 48, NV = 7, TH = 0.035;
  const ridge = (x, sa) => { let k = 0; for (const xc of [-0.55, 0, 0.55]) k += Math.exp(-(((x - xc) / 0.15) ** 2)); return 0.075 * k * Math.max(0, sa); };
  for (let i = 0; i < edges.length - 1; i++) {
    const t0 = edges[i] - (i ? 0.06 : 0), t1 = edges[i + 1];
    const sc = 1 + 0.02 * (edges.length - 2 - i);
    const P = (t, a, o, inset = 0) => {
      const st = Math.sin(t), v = (t - t0) / (t1 - t0), sa = Math.sin(a);
      const k = sc + 0.035 * Math.sin(Math.PI * Math.min(1, Math.max(0, v)));
      const x = st * Math.cos(a) * R[0] * k, z = Math.cos(t) * R[2] * k;
      const y = st * sa * R[1] * k + ridge(x, sa) * st;
      o.set(x, y, z);
      if (inset) o.multiplyScalar(1 - inset / o.length());
      return o;
    };
    // surface (grille indexée, normales lisses)
    const pos = [], uv = [], idx = [];
    const tmp = new THREE.Vector3(), prev = new THREE.Vector3();
    const bw = P(t0, Math.PI / 2, new THREE.Vector3()).distanceTo(P(t1, Math.PI / 2, tmp));
    const us = [];
    for (let iu = 0; iu <= NU; iu++) {
      const a = a0 + (a1 - a0) * iu / NU;
      P((t0 + t1) / 2, a, tmp);
      us.push(iu ? us[iu - 1] + tmp.distanceTo(prev) / bw : 0);
      prev.copy(tmp);
    }
    for (let iv = 0; iv <= NV; iv++) for (let iu = 0; iu <= NU; iu++) {
      const t = t0 + (t1 - t0) * iv / NV, a = a0 + (a1 - a0) * iu / NU;
      P(t, a, tmp);
      pos.push(tmp.x, tmp.y, tmp.z); uv.push(us[iu], iv / NV);
    }
    const W = NU + 1;
    for (let iv = 0; iv < NV; iv++) for (let iu = 0; iu < NU; iu++) {
      const q0 = iv * W + iu, q1 = q0 + 1, q2 = q0 + W, q3 = q2 + 1;
      idx.push(q0, q2, q1, q1, q2, q3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // orientation : la normale du sommet du milieu doit sortir de la coque
    const mid = Math.floor(NV / 2) * W + Math.floor(NU / 2);
    const nn = g.attributes.normal;
    if (nn.getX(mid) * pos[mid * 3] + nn.getY(mid) * pos[mid * 3 + 1] + nn.getZ(mid) * pos[mid * 3 + 2] < 0) {
      for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
      g.setIndex(idx); g.computeVertexNormals();
    }
    out.push(g.toNonIndexed());
    // tranches de tôle sur les quatre bords
    const wp = [], wuv = [];
    const edge = (pts, vEdge, outward) => {
      for (let k = 0; k < pts.length - 1; k++) {
        const [ta, aa, ua] = pts[k], [tb, ab, ub] = pts[k + 1];
        const A = P(ta, aa, new THREE.Vector3()), B = P(tb, ab, new THREE.Vector3());
        const Ai = P(ta, aa, new THREE.Vector3(), TH), Bi = P(tb, ab, new THREE.Vector3(), TH);
        // sens : la normale de la tranche doit suivre « outward »
        const nrm = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(Ai, A));
        const o = outward(ta, aa, A);
        const tri = nrm.dot(o) > 0 ? [A, B, Ai, B, Bi, Ai] : [A, Ai, B, B, Ai, Bi];
        const tuv = nrm.dot(o) > 0 ? [ua, ub, ua, ub, ub, ua] : [ua, ua, ub, ub, ua, ub];
        tri.forEach((p, j) => { wp.push(p.x, p.y, p.z); wuv.push(tuv[j], 0.5); });
      }
    };
    const along = (t, sgn) => (tt, aa, A) => P(tt + 0.01 * sgn, aa, new THREE.Vector3()).sub(A);
    const across = (sgn) => (tt, aa, A) => P(tt, aa + 0.01 * sgn, new THREE.Vector3()).sub(A);
    const rowT = (t) => us.map((u, iu) => [t, a0 + (a1 - a0) * iu / NU, u]);
    const colA = (a, u) => Array.from({ length: NV + 1 }, (_, iv) => [t0 + (t1 - t0) * iv / NV, a, u]);
    edge(rowT(t0), 0.003, along(t0, -1));
    edge(rowT(t1), 0.997, along(t1, 1));
    edge(colA(a0, 0), 0.5, across(-1));
    edge(colA(a1, us[NU]), 0.5, across(1));
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
    wg.setAttribute('uv', new THREE.Float32BufferAttribute(wuv, 2));
    wg.computeVertexNormals();
    out.push(wg);
  }
  return merge(out);
}

// Doigt de pince : section ovale balayée le long d'une courbe qui se recourbe vers l'autre doigt, effilée jusqu'à la
// pointe, dents coniques sur le bord intérieur (side : +1 doigt de droite, dents vers -x)
function fingerGeo(side) {
  return once('pinceur-finger' + side, () => {
    const s = side, N = 16, RS = 12;
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(s * 0.07, 0.02, 0), new THREE.Vector3(s * 0.22, -0.34, 0), new THREE.Vector3(-s * 0.01, -0.66, 0));
    const P = new THREE.Vector3(), T = new THREE.Vector3(), Nn = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1);
    const pos = [], uv = [], idx = [], L = [];
    const rad = (t) => 0.115 * (1 - Math.pow(t, 1.4) * 0.92) * (t < 0.12 ? 0.88 + t : 1);
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      curve.getPoint(t, P); curve.getTangent(t, T);
      Nn.crossVectors(Z, T).normalize();
      const r = rad(t);
      for (let j = 0; j <= RS; j++) {
        const a = (j / RS) * Math.PI * 2, cx = Math.cos(a) * r, cz = Math.sin(a) * r * 0.78;
        pos.push(P.x + Nn.x * cx, P.y + Nn.y * cx, cz);
        uv.push(j / RS, t * 0.9);
      }
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < RS; j++) {
      const q0 = i * (RS + 1) + j, q1 = q0 + 1, q2 = q0 + RS + 1, q3 = q2 + 1;
      idx.push(q0, q1, q2, q1, q3, q2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // orientation : au milieu du doigt, la normale doit s'écarter de l'axe
    const n0 = g.attributes.normal, c0 = curve.getPoint(0.5);
    const k = Math.floor(N / 2) * (RS + 1);
    if ((pos[k * 3] - c0.x) * n0.getX(k) + (pos[k * 3 + 1] - c0.y) * n0.getY(k) + pos[k * 3 + 2] * n0.getZ(k) < 0) {
      for (let q = 0; q < idx.length; q += 3) { const t = idx[q + 1]; idx[q + 1] = idx[q + 2]; idx[q + 2] = t; }
      g.setIndex(idx); g.computeVertexNormals();
    }
    L.push(g.toNonIndexed());
    // dents : cônes tournés vers l'autre doigt
    for (const t of [0.28, 0.42, 0.56, 0.7, 0.82]) {
      curve.getPoint(t, P); curve.getTangent(t, T);
      Nn.crossVectors(Z, T).normalize().multiplyScalar(-s);
      const r = rad(t), len = 0.06 + r * 0.25;
      const cg = new THREE.ConeGeometry(0.03 + r * 0.12, len, 6).toNonIndexed();
      cg.applyQuaternion(_q.setFromUnitVectors(_up, Nn));
      cg.translate(P.x + Nn.x * (r * 0.75 + len / 2), P.y + Nn.y * (r * 0.75 + len / 2), 0);
      L.push(cg);
    }
    return uvScale(merge(L), 1.2, 1.2);
  });
}

// Blindage frontal (forme extrudée) : bord haut cintré, menton en chevron ; le Royal a une crête festonnée
function shieldShape(royal, sc = 1) {
  const pts = royal
    ? [[-1.0, 0.24], [-0.82, 0.34], [-0.62, 0.3], [-0.4, 0.38], [-0.2, 0.36], [0, 0.5], [0.2, 0.36], [0.4, 0.38], [0.62, 0.3], [0.82, 0.34], [1.0, 0.24],
      [1.03, -0.16], [0.82, -0.31], [0.18, -0.31], [0, -0.42], [-0.18, -0.31], [-0.82, -0.31], [-1.03, -0.16]]
    : [[-1.0, 0.26], [-0.86, 0.33], [0.86, 0.33], [1.0, 0.26], [1.02, -0.17], [0.82, -0.31], [0.16, -0.31], [0, -0.38], [-0.16, -0.31], [-0.82, -0.31], [-1.02, -0.17]];
  const sh = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? sh.lineTo(x * sc, y * sc) : sh.moveTo(x * sc, y * sc)));
  sh.closePath();
  return sh;
}

// ------------------------------------------------------------------ modèle
export function pinceur(royal = false) {
  const key = royal ? 'pinceurRoyal' : 'pinceur';
  const shellC = royal ? '#c0306a' : '#2a8a8a';
  const shellL = royal ? '#ff7aa8' : '#6ac8c0';
  const shellD = royal ? '#6e1840' : '#1a5a5e';
  const goldC = royal ? '#ffd23a' : '#e2ac44';
  const PAL = {
    shell: { color: shellC, rough: 0.38, metal: 0.45, sheen: 0.25, coat: 0.8 },
    shellL: { color: shellL, rough: 0.4, metal: 0.4, coat: 0.7 },
    shellD: { color: shellD, rough: 0.45, metal: 0.5, coat: 0.5 },
    dark: { color: '#2a2438', rough: 0.45, metal: 0.6 },
    black: { color: '#141019', rough: 0.6, metal: 0.3 },
    steel: { color: '#8a94aa', rough: 0.3, metal: 0.9 },
    gold: { color: goldC, rough: 0.28, metal: 0.85, coat: 0.4 },
    rubber: { color: '#25212c', rough: 0.85, metal: 0.05 },
    grime: { color: '#3a3430', rough: 0.8, metal: 0.2 },
  };
  const { S, root, B, skin } = rig(PAL);
  // second corps sculpté pour les membres (maille plus fine : vérins, soufflets, rotules lisibles)
  const LS = new Sculpt(PAL);
  const limbBones = [];
  const BL = (parent, p, name, r) => { const b = B(parent, p, name, r); limbBones.push(b); return b; };

  // matières des pièces rigides
  const plateT = plateTexture(shellC, royal ? { chip: 0.18, trim: goldC, seed: 703 } : { chip: 0.42 });
  const plateM = mat('#ffffff', { map: plateT.map, normalMap: plateT.normalMap, rough: 0.42, metal: 0.12, coat: 0.6, coatRough: 0.12, sheen: 0.3, sheenColor: '#d8e0ff' });
  const goldT = goldTexture(goldC, royal);
  const gold = mat('#ffffff', { map: goldT.map, normalMap: goldT.normalMap, rough: 0.32, metal: 0.8, coat: 0.35 });
  const gunT = plateTexture('#3b3550', { chip: 0.5, seed: 709 });
  const gun = mat('#ffffff', { map: gunT.map, normalMap: gunT.normalMap, rough: 0.45, metal: 0.55, coat: 0.3 });
  const mech = mat('#ffffff', { vertexColors: true, rough: 0.38, metal: 0.65 });
  const rubber = mat('#25212c', { rough: 0.85, metal: 0.05 });
  const hz = hazardTexture();
  const hazard = mat('#ffffff', { map: hz.map, normalMap: hz.normalMap, rough: 0.5, metal: 0.25 });
  const dark = mat('#2a2438', { rough: 0.4, metal: 0.6 });
  const lidM = mat(shellD, { rough: 0.45, metal: 0.3, coat: 0.3 });

  // ---------------------------------------------------------------- coque (sculpture large)
  const body = B(root, [0, 1.1, 0], 'body');
  // dôme sous les plaques (visible aux jointures et à l'arrière), jupe, ventre
  S.add(body, { t: 'ell', r: [1.33, 0.55, 1.09], col: 'shellD', k: 0.08 });
  S.add(body, { t: 'ell', r: [1.41, 0.11, 1.17], p: [0, -0.07, 0], col: 'shellD', k: 0.06 });
  S.paint(body, { t: 'ell', r: [1.5, 0.03, 1.25], p: [0, -0.02, 0], col: 'shell', feather: 0.03 });
  S.add(body, { t: 'ell', r: [1.18, 0.34, 0.98], p: [0, -0.3, 0], col: 'dark', k: 0.1 });
  // plaques ventrales
  for (let i = 0; i < 4; i++) S.sub(body, { t: 'box', s: [1.3, 0.02, 0.012], p: [0, -0.6, 0.45 - i * 0.3], round: 0.01, col: 'black', k: 0.03 });
  S.paint(body, { t: 'ell', r: [1.2, 0.2, 1.0], p: [0, -0.62, 0], col: 'grime', feather: 0.12 });
  // cornes latérales
  for (const s of [-1, 1]) S.add(body, { t: 'cone', a: [s * 0.95, 0.15, 0.55], b: [s * 1.62, 0.12, 0.82], r1: 0.2, r2: 0.04, col: 'shell', k: 0.12 });
  // rotules des hanches et des épaules
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) S.add(body, { t: 'sph', r: 0.17, p: [s * 1.08, -0.2, 0.4 - i * 0.55], col: 'dark', k: 0.06 });
  for (const s of [-1, 1]) S.add(body, { t: 'sph', r: 0.23, p: [s * 1.17, -0.1, 0.8], col: 'dark', k: 0.08 });
  // bouche : fente sombre et mandibules sous le blindage
  S.add(body, { t: 'ell', r: [0.42, 0.14, 0.2], p: [0, -0.4, 0.92], col: 'dark', k: 0.08 });
  S.sub(body, { t: 'ell', r: [0.3, 0.05, 0.12], p: [0, -0.42, 1.1], col: 'black', k: 0.03 });
  for (const s of [-1, 1]) S.add(body, { t: 'cone', a: [s * 0.16, -0.42, 1.02], b: [s * 0.08, -0.6, 1.12], r1: 0.06, r2: 0.02, col: 'steel', k: 0.03 });
  // bloc moteur arrière et logement de l'évent
  S.add(body, { t: 'ell', r: [0.62, 0.46, 0.27], p: [0, 0.15, -0.94], col: 'dark', k: 0.12 });
  S.sub(body, { t: 'cyl', r: 0.37, h: 0.1, p: [0, 0.155, -1.223], rot: [Math.PI / 2 - 0.3, 0, 0], col: 'black', k: 0.03 });
  for (const s of [-1, 1]) S.add(body, { t: 'box', s: [0.05, 0.16, 0.16], p: [s * 0.5, 0.15, -1.1], rot: [-0.3, 0, 0], round: 0.03, col: 'dark', k: 0.05 });
  skin(key, { mesh: { cell: 0.04, skinSoft: 0.05, aoDist: 0.06 }, mat: { enemyRim: true }, outline: OL });

  // plaques de la carapace
  const plates = once(key + '-plates', () => shellPlates([1.38, 0.6, 1.14], [0.42, 0.84, 1.24, 1.64, 2.06, 2.5]));
  part(body, plates, plateM, { outline: OL });

  // ---------------------------------------------------------------- pédoncules et yeux
  const eyes = [];
  for (const s of [-1, 1]) {
    const st = BL(body, [s * 0.35, 0.45, 0.8], s < 0 ? 'stalkL' : 'stalkR');
    LS.add(st, { t: 'cyl', r: 0.11, h: 0.05, p: [0, -0.02, 0], round: 0.03, col: 'dark', k: 0.03 });
    LS.add(st, { t: 'cone', a: [0, 0, 0], b: [0, 0.4, 0], r1: 0.065, r2: 0.05, col: 'dark', k: 0.03 });
    for (const y of [0.12, 0.25]) LS.add(st, { t: 'torus', R: 0.062, r: 0.022, p: [0, y, 0], col: 'steel', k: 0.02 });
    LS.add(st, { t: 'sph', r: 0.09, p: [0, 0.42, -0.02], col: 'dark', k: 0.04 });
    eyes.push(st);
  }

  // ---------------------------------------------------------------- pinces
  const claws = [];
  for (const s of [-1, 1]) {
    const sh = BL(body, [s * 1.2, -0.1, 0.8], s < 0 ? 'clawShL' : 'clawShR', [-1.1, 0, -s * 0.6]);
    // épaule : rotule, soufflet de caoutchouc, manchon blindé
    LS.add(sh, { t: 'sph', r: 0.19, col: 'steel', k: 0.03, skinSoft: 0.03 });
    LS.add(sh, { t: 'cyl', r: 0.13, h: 0.12, p: [0, -0.2, 0], col: 'rubber', k: 0.02, skinSoft: 0.03 });
    for (const y of [-0.12, -0.2, -0.28]) LS.add(sh, { t: 'torus', R: 0.135, r: 0.035, p: [0, y, 0], col: 'rubber', k: 0.015, skinSoft: 0.03 });
    LS.add(sh, { t: 'cone', a: [0, -0.34, 0], b: [0, -0.68, 0], r1: 0.17, r2: 0.15, col: 'shell', k: 0.03, skinSoft: 0.03 });
    LS.add(sh, { t: 'ell', r: [0.1, 0.19, 0.07], p: [0, -0.5, 0.15], col: 'shellL', k: 0.04, skinSoft: 0.03 });
    LS.sub(sh, { t: 'torus', R: 0.17, r: 0.022, p: [0, -0.4, 0], col: 'dark', k: 0.015 });
    const claw = BL(sh, [0, -0.75, 0], s < 0 ? 'clawL' : 'clawR');
    // poing : bracelet, paume renflée à côtes, épines, logement des doigts
    LS.add(claw, { t: 'torus', R: 0.15, r: 0.05, p: [0, 0.0, 0], col: 'gold', k: 0.02, skinSoft: 0.03 });
    LS.add(claw, { t: 'ell', r: [0.34, 0.5, 0.28], p: [0, -0.34, 0], col: 'shell', k: 0.06, skinSoft: 0.03 });
    LS.add(claw, { t: 'ell', r: [0.1, 0.36, 0.08], p: [0, -0.34, 0.22], col: 'shellL', k: 0.07, skinSoft: 0.03 });
    LS.add(claw, { t: 'ell', r: [0.08, 0.34, 0.15], p: [s * 0.28, -0.36, 0.02], col: 'shellD', k: 0.06, skinSoft: 0.03 });
    LS.paint(claw, { t: 'ell', r: [0.32, 0.44, 0.14], p: [0, -0.34, -0.22], col: 'shellD', feather: 0.08 });
    LS.sub(claw, { t: 'torus', R: 0.31, r: 0.03, p: [0, -0.14, 0], sc: [1, 1, 0.85], col: 'shellD', k: 0.02 });
    for (const y of [-0.22, -0.36, -0.5]) {
      LS.add(claw, { t: 'cone', a: [0, y, 0.27], b: [0, y + 0.05, 0.43], r1: 0.05, r2: 0.012, col: royal ? 'gold' : 'shellD', k: 0.03 });
    }
    for (const y of [-0.28, -0.44]) LS.add(claw, { t: 'cone', a: [s * 0.33, y, 0.04], b: [s * 0.47, y + 0.04, 0.06], r1: 0.045, r2: 0.01, col: royal ? 'gold' : 'shellD', k: 0.03 });
    LS.add(claw, { t: 'ell', r: [0.27, 0.13, 0.2], p: [0, -0.68, 0], col: 'dark', k: 0.05, skinSoft: 0.03 });
    // doigts dentelés (pivots animés)
    const pinA = joint(claw, [0, -0.7, 0]);
    part(pinA, fingerGeo(1), gold, { p: [0.03, -0.02, 0], outline: OL });
    const pinB = joint(claw, [0, -0.7, 0]);
    part(pinB, fingerGeo(-1), gold, { p: [-0.03, -0.02, 0], outline: OL });
    // vérins : le long du bras, et sur la paume vers les doigts
    part(sh, once('pinceur-armRam', () => merge(ram([], [0, -0.06, -0.2], [0, -0.66, -0.19], 0.05))), mech, { shadow: false });
    part(claw, once('pinceur-palmRam', () => merge([
      ...ram([], [0.22, -0.16, -0.24], [0.1, -0.6, -0.18], 0.04),
      ...ram([], [-0.22, -0.16, -0.24], [-0.1, -0.6, -0.18], 0.04),
      pc(G.cyl(0.075, 0.075, 0.24, 12), [0, -0.7, 0], [Math.PI / 2, 0, 0], '#a8b2c8'),
      pc(G.nut(0.06, 0.03), [0, -0.7, 0.13], [0, 0, 0], '#5a5468'), pc(G.nut(0.06, 0.03), [0, -0.7, -0.13], [0, 0, 0], '#5a5468'),
    ])), mech, { shadow: false });
    if (royal) {
      // épaulière dorée sertie
      part(sh, once('pinceur-pauldron', () => merge([
        pc(new THREE.SphereGeometry(0.27, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), [0, -0.14, 0.06], [Math.PI / 2 - 0.25, 0, 0], null, [1, 0.75, 1]),
        pc(G.torus(0.27, 0.03, 6, 24), [0, -0.14, 0.06], [-0.25, 0, 0], null, [1, 1, 1]),
      ])), gold, { outline: OL });
      part(sh, G.sphere(0.06, 12, 8), glow('#ff4fa0', 2.4), { p: [0, -0.06, 0.28], s: [1, 1, 0.6], shadow: false });
    }
    claws.push({ sh, claw, pinA, pinB, s });
  }

  // ---------------------------------------------------------------- pattes
  const legs = [];
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) {
    const l = joint(body, [s * 1.1, -0.2, 0.4 - i * 0.55]);
    const up = BL(l, [0, 0, 0], 'legUp', [0, 0, s * 1.2]);
    // hanche : rotule d'acier, soufflet, cuisse blindée à crête, dessous sombre
    LS.add(up, { t: 'sph', r: 0.13, col: 'steel', k: 0.02, skinSoft: 0.02 });
    LS.add(up, { t: 'cyl', r: 0.085, h: 0.07, p: [0, -0.16, 0], col: 'rubber', k: 0.02, skinSoft: 0.02 });
    for (const y of [-0.11, -0.17, -0.23]) LS.add(up, { t: 'torus', R: 0.09, r: 0.03, p: [0, y, 0], col: 'rubber', k: 0.012, skinSoft: 0.02 });
    LS.add(up, { t: 'cone', a: [0, -0.28, 0], b: [0, -0.62, 0], r1: 0.12, r2: 0.095, col: 'shell', k: 0.03, skinSoft: 0.02 });
    LS.add(up, { t: 'ell', r: [0.06, 0.2, 0.08], p: [s * 0.1, -0.44, 0], col: 'shellL', k: 0.04, skinSoft: 0.02 });
    LS.paint(up, { t: 'cone', a: [-s * 0.12, -0.3, 0], b: [-s * 0.1, -0.62, 0], r1: 0.08, r2: 0.07, col: 'shellD', feather: 0.04 });
    LS.paint(up, { t: 'cyl', r: 0.2, h: 0.022, p: [0, -0.5, 0], col: royal ? 'gold' : 'shellD', feather: 0.03 });
    const low = BL(up, [0, -0.7, 0], 'legLow', [0, 0, -s * 1.7]);
    // genou : rotule et chape, tibia effilé cerclé, pied pointu crotté
    LS.add(low, { t: 'sph', r: 0.085, col: 'steel', k: 0.02, skinSoft: 0.02 });
    LS.add(low, { t: 'cyl', r: 0.07, h: 0.04, p: [0, -0.13, 0], col: 'rubber', k: 0.015, skinSoft: 0.02 });
    LS.add(low, { t: 'torus', R: 0.075, r: 0.028, p: [0, -0.14, 0], col: 'rubber', k: 0.01, skinSoft: 0.02 });
    LS.add(low, { t: 'cone', a: [0, -0.2, 0], b: [0, -0.52, 0], r1: 0.095, r2: 0.06, col: 'shell', k: 0.03, skinSoft: 0.02 });
    LS.add(low, { t: 'torus', R: 0.07, r: 0.022, p: [0, -0.46, 0], col: royal ? 'gold' : 'dark', k: 0.012, skinSoft: 0.02 });
    LS.add(low, { t: 'cone', a: [0, -0.5, 0], b: [0, -0.7, 0], r1: 0.06, r2: 0.014, col: 'dark', k: 0.02, skinSoft: 0.02 });
    LS.paint(low, { t: 'sph', r: 0.16, p: [0, -0.72, 0], col: 'grime', feather: 0.06 });
    // vérin de cuisse et axe du genou
    part(up, once('pinceur-legRam' + s, () => merge([
      ...ram([], [-s * 0.15, -0.08, 0], [-s * 0.1, -0.62, 0], 0.035, 0.55),
      pc(G.cyl(0.06, 0.06, 0.24, 10), [0, -0.7, 0], [Math.PI / 2, 0, 0], '#5a5468'),
      pc(G.cyl(0.06, 0.06, 0.03, 6), [0, -0.7, 0.12], [Math.PI / 2, 0, 0], royal ? goldC : '#5a5468'),
      pc(G.cyl(0.06, 0.06, 0.03, 6), [0, -0.7, -0.12], [Math.PI / 2, 0, 0], royal ? goldC : '#5a5468'),
    ])), mech, { shadow: false });
    legs.push({ l, up, low, s, i });
  }
  sculptSkin(key + 'Limbs', LS, root, limbBones, { mesh: { cell: 0.033, skinSoft: 0.02, aoDist: 0.035 }, mat: { sheenColor: '#d8e0ff', enemyRim: true }, outline: OL });

  // ---------------------------------------------------------------- blindage frontal
  const armor = joint(body, [0, 0.0, 1.06]);
  armor.rotation.x = 0.2;
  part(armor, once(key + '-shield', () => {
    const g = new THREE.ExtrudeGeometry(shieldShape(royal), { depth: 0.12, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2 });
    g.translate(0, 0, -0.04);
    g.computeVertexNormals();
    return uvScale(g, 1.4);
  }), gold, { outline: OL });
  part(armor, once(key + '-shieldMech', () => {
    const L = [];
    const back = new THREE.ExtrudeGeometry(shieldShape(royal, 1.07), { depth: 0.08, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1 });
    L.push(pc(back, [0, 0, -0.14], [0, 0, 0], '#2a2438'));
    back.dispose();
    // boulons à tête hexagonale, fente de visée
    const bolts = royal ? [[-0.88, 0.15], [0.88, 0.15], [-0.88, -0.14], [0.88, -0.14], [-0.5, -0.22], [0.5, -0.22]]
      : [[-0.8, 0.2], [-0.4, 0.2], [0, 0.2], [0.4, 0.2], [0.8, 0.2], [-0.88, -0.14], [0.88, -0.14], [-0.5, -0.22], [0.5, -0.22]];
    for (const [x, y] of bolts) L.push(pc(G.bolt(0.04), [x, y, 0.13], [Math.PI / 2, 0, 0], '#5a5468'));
    L.push(pc(G.rbox(1.3, 0.09, 0.05, 0.02), [0, -0.06, 0.12], [0, 0, 0], '#141019'));
    // cornières d'angle
    for (const sx of [-1, 1]) L.push(pc(G.box(0.05, 0.4, 0.04), [sx * 0.97, 0.03, 0.1], [0, 0, 0], '#3a3448'));
    for (const x of [-0.5, 0, 0.5]) L.push(pc(G.box(0.025, 0.07, 0.03), [x, -0.06, 0.135], [0, 0, 0], '#9aa6c2'));
    return merge(L);
  }), mech, { shadow: false });
  if (!royal) {
    // nervures embouties du blindage
    part(armor, once('pinceur-ribs', () => merge([pc(G.rbox(1.5, 0.06, 0.05, 0.02, 2), [0, 0.09, 0.11]), pc(G.rbox(0.8, 0.06, 0.05, 0.02, 2), [0, -0.17, 0.11])])), gold, { shadow: false });
  }
  // lumières de signalisation dans la fente (et pierres du Royal)
  part(armor, once('pinceur-slitLights', () => merge([-0.25, 0.25].map((x) => pc(G.sphere(0.035, 8, 6), [x, -0.06, 0.13], [0, 0, 0], null, [1.4, 0.8, 0.6])))), glow('#ffb02a', 2.2), { shadow: false });
  if (royal) {
    part(armor, G.sphere(0.12, 16, 10), glow('#ff4fa0', 2.6), { p: [0, 0.2, 0.13], s: [1, 1.15, 0.55], shadow: false });
    part(armor, once('pinceur-gemSet', () => merge([
      pc(G.torus(0.13, 0.03, 6, 20), [0, 0.2, 0.12], [0, 0, 0], null, [1, 1.15, 1]),
      pc(G.torus(0.08, 0.025, 6, 16), [-0.62, 0.1, 0.12]), pc(G.torus(0.08, 0.025, 6, 16), [0.62, 0.1, 0.12]),
      ...[-0.36, 0.36].map((x) => pc(G.cone(0.05, 0.12, 6), [x, 0.43, 0.04])),
    ])), gold, { shadow: false });
    part(armor, once('pinceur-gemSide', () => merge([-0.62, 0.62].map((x) => pc(G.sphere(0.07, 12, 8), [x, 0.1, 0.12], [0, 0, 0], null, [1, 1, 0.55])))), glow('#7ff3ff', 2.2), { shadow: false });
  }

  // ---------------------------------------------------------------- évent arrière (point faible)
  const vent = part(body, G.cyl(0.35, 0.35, 0.2, 18), glow('#ff9a3a', 2.5), { p: [0, 0.2, -1.08], r: [Math.PI / 2 - 0.3, 0, 0], shadow: false });
  // buse cerclée de bandes de danger (vers l'arrière, un peu vers le bas), fourreau sombre, grille
  const ax = [0, -0.296, -0.955];
  const at = (d) => [0, 0.2 + ax[1] * d, -1.08 + ax[2] * d];
  part(body, once('pinceur-ventHazard', () => uvScale(pc(G.cyl(0.62, 0.45, 0.07, 36, true), [0, 0, 0]), 7, 0.4)), hazard, { p: at(0.2), r: [Math.PI / 2 - 0.3, 0, 0], shadow: false });
  part(body, once('pinceur-ventMech', () => {
    const L = [];
    // (repère de la buse : -y sort de la coque)
    L.push(flip(pc(G.cyl(0.43, 0.43, 0.2, 28, true), [0, 0, 0], [0, 0, 0], '#1d1a24')).translate(0, -0.13, 0));
    L.push(pc(G.torus(0.45, 0.035, 8, 32), [0, -0.24, 0], [Math.PI / 2, 0, 0], '#8a94aa'));
    L.push(pc(G.torus(0.62, 0.025, 6, 36), [0, -0.165, 0], [Math.PI / 2, 0, 0], '#2a2438'));
    L.push(pc(G.torus(0.38, 0.05, 6, 24), [0, -0.03, 0], [Math.PI / 2, 0, 0], '#2a2438'));
    for (const x of [-0.16, 0.16]) L.push(pc(G.box(0.035, 0.05, 0.74), [x, -0.17, 0], [0, 0, 0], '#5a5468'));
    const g = merge(L);
    g.applyMatrix4(_m4.compose(_p.set(0, 0.2, -1.08), _q.setFromEuler(_e.set(Math.PI / 2 - 0.3, 0, 0)), _s.set(1, 1, 1)));
    // ailettes de refroidissement et cheminées sur le bloc moteur
    const F = [g];
    for (const x of [-0.32, -0.16, 0, 0.16, 0.32]) F.push(pc(G.box(0.04, 0.12, 0.34), [x, 0.6 - Math.abs(x) * 0.35, -0.9], [0.25, 0, 0], '#3a3448'));
    for (const s of [-1, 1]) {
      F.push(rod([s * 0.42, 0.35, -0.95], [s * 0.5, 0.78, -1.08], 0.06, 0.055, '#6a7288', 12));
      F.push(pc(G.cyl(0.075, 0.075, 0.06, 12), [s * 0.5, 0.78, -1.08], [-0.3, 0, s * 0.18], '#2a2438'));
      F.push(pc(G.torus(0.065, 0.015, 6, 14), [s * 0.46, 0.55, -1.01], [Math.PI / 2 - 0.3, 0, s * 0.18], '#5a5468'));
    }
    return merge(F);
  }), mech, { shadow: false });

  // ---------------------------------------------------------------- mortier
  // tourelle fixe sur la carapace
  part(body, once(key + '-turret', () => merge([
    pc(G.cyl(0.44, 0.48, 0.18, 28), [0, 0.6, -0.2], [0, 0, 0], '#2a2438'),
    ...Array.from({ length: 10 }, (_, k) => { const a = (k / 10) * Math.PI * 2; return pc(G.cyl(0.035, 0.035, 0.03, 6), [Math.cos(a) * 0.38, 0.7, -0.2 + Math.sin(a) * 0.38], [0, 0, 0], '#8a94aa'); }),
  ])), mech, {});
  part(body, G.torus(0.45, 0.04, 8, 32), gold, { p: [0, 0.69, -0.2], r: [Math.PI / 2, 0, 0], shadow: false });
  const mortar = joint(body, [0, 0.55, -0.2]);
  mortar.rotation.x = -0.5;
  // fût (profil tourné : frettes, bouche évasée, âme creuse)
  part(mortar, once('pinceur-barrel', () => uvScale(new THREE.LatheGeometry([
    [0.0, 0.12], [0.3, 0.12], [0.3, 0.2], [0.27, 0.23], [0.265, 0.62], [0.29, 0.66], [0.31, 0.76], [0.3, 0.81], [0.27, 0.83], [0.215, 0.82], [0.21, 0.6], [0.0, 0.6],
  ].map(([r, y]) => new THREE.Vector2(r, y)), 28), 4, 1)), gun, { outline: OL });
  // culasse boulonnée et tourillons
  part(mortar, once(key + '-breech', () => merge([
    pc(G.cyl(0.34, 0.36, 0.22, 24), [0, 0.06, 0], [0, 0, 0], '#3b3550'),
    pc(G.cyl(0.36, 0.36, 0.035, 24), [0, -0.05, 0], [0, 0, 0], '#5a5468'),
    ...Array.from({ length: 8 }, (_, k) => { const a = (k / 8) * Math.PI * 2 + 0.2; return pc(G.cyl(0.032, 0.032, 0.03, 6), [Math.cos(a) * 0.29, 0.18, Math.sin(a) * 0.29], [0, 0, 0], '#8d97ad'); }),
    ...[-1, 1].flatMap((s) => [
      pc(G.cyl(0.13, 0.13, 0.12, 14), [s * 0.4, 0.06, 0], [0, 0, Math.PI / 2], '#2a2438'),
      pc(G.nut(0.07, 0.04), [s * 0.47, 0.06, 0], [0, Math.PI / 2, 0], '#9aa6c2'),
    ]),
    // vérins de recul et durite d'alimentation
    ...ram([], [0.2, 0.0, 0.26], [0.2, 0.5, 0.25], 0.035, 0.5),
    ...ram([], [-0.2, 0.0, 0.26], [-0.2, 0.5, 0.25], 0.035, 0.5),
  ])), mech, { shadow: false });
  part(mortar, once('pinceur-hose', () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.3, 0.1, -0.12), new THREE.Vector3(-0.5, 0.05, -0.15), new THREE.Vector3(-0.58, -0.2, 0.05), new THREE.Vector3(-0.5, -0.35, 0.25),
  ]), 16, 0.055, 8)), rubber, { shadow: false });
  // frettes et bouche dorées
  part(mortar, once(key + '-bands', () => merge([
    pc(G.torus(0.275, 0.032, 8, 28), [0, 0.32, 0], [Math.PI / 2, 0, 0]),
    pc(G.torus(0.275, 0.032, 8, 28), [0, 0.5, 0], [Math.PI / 2, 0, 0]),
    pc(G.torus(0.305, 0.03, 8, 28), [0, 0.8, 0], [Math.PI / 2, 0, 0]),
    ...(royal ? Array.from({ length: 8 }, (_, k) => { const a = (k / 8) * Math.PI * 2; return pc(G.cone(0.05, 0.13, 6), [Math.cos(a) * 0.29, 0.88, Math.sin(a) * 0.29]); }) : []),
  ])), gold, { shadow: false });
  part(mortar, G.cyl(0.2, 0.2, 0.05, 16), glow('#ff6a3a', 1.6), { p: [0, 0.74, 0], shadow: false });

  // ---------------------------------------------------------------- yeux au bout des pédoncules
  for (const st of eyes) {
    robotEye(st, 0.15, '#ff3a3a', [0, 0.5, 0.02]);
    // paupière blindée (regard de char), bague de l'œil
    part(st, once('pinceur-lid', () => new THREE.SphereGeometry(0.175, 18, 6, 0, Math.PI * 2, 0, Math.PI * 0.42)), royal ? gold : lidM, { p: [0, 0.5, 0.02], r: [0.55, 0, 0], outline: OL * 0.8 });
    part(st, G.torus(0.15, 0.022, 6, 20), royal ? gold : dark, { p: [0, 0.5, 0.06], r: [0.2, 0, 0], shadow: false });
  }

  // ---------------------------------------------------------------- antenne arrière
  const mast = joint(body, [-0.78, 0.36, -0.58]);
  mast.rotation.set(-0.3, 0, 0.18);
  part(mast, once('pinceur-mast', () => merge([
    pc(G.cyl(0.07, 0.09, 0.08, 10), [0, 0.02, 0], [0, 0, 0], '#2a2438'),
    pc(G.cyl(0.018, 0.024, 0.8, 6), [0, 0.42, 0], [0, 0, 0], '#8d97ad'),
    pc(G.sphere(0.03, 8, 6), [0, 0.82, 0], [0, 0, 0], '#5a5468'),
  ])), mech, { shadow: false });
  if (royal) {
    // fanion framboise bordé d'or
    part(mast, once('pinceur-pennant', () => {
      const sh = new THREE.Shape();
      sh.moveTo(0, 0); sh.quadraticCurveTo(0.22, 0.02, 0.42, -0.08); sh.lineTo(0.3, -0.12); sh.lineTo(0.4, -0.2); sh.quadraticCurveTo(0.2, -0.2, 0, -0.24);
      sh.closePath();
      return new THREE.ShapeGeometry(sh, 8).translate(0.015, 0.78, 0);
    }), mat(shellC, { rough: 0.8, sheen: 0.8, sheenColor: '#ffc0d8', side: THREE.DoubleSide }), { shadow: false });
    part(mast, G.sphere(0.045, 10, 8), gold, { p: [0, 0.84, 0], shadow: false });
  } else part(mast, G.sphere(0.045, 10, 8), glow('#ff3a3a', 2.6), { p: [0, 0.84, 0], shadow: false });

  // ---------------------------------------------------------------- Royal : couronne et pierreries
  if (royal) {
    const crown = joint(body, [0, 0.82, 0.28]);
    // coussin de velours
    part(crown, G.ellipsoid(0.46, 0.2, 0.46, 24, 12), mat('#5a1a6a', { rough: 0.85, sheen: 1, sheenColor: '#d080ff' }), { p: [0, 0.02, 0] });
    // bandeau tourné et gravé
    part(crown, once('pinceur-crownBand', () => uvScale(new THREE.LatheGeometry([
      [0.47, -0.08], [0.52, -0.07], [0.53, -0.03], [0.5, -0.01], [0.51, 0.12], [0.555, 0.15], [0.55, 0.18], [0.5, 0.17], [0.47, 0.15], [0.47, -0.08],
    ].map(([r, y]) => new THREE.Vector2(r, y)), 40), 5, 1)), gold, { outline: OL });
    // fleurons et pointes perlées, arceaux, globe crucifère
    part(crown, once('pinceur-crownTop', () => {
      const L = [];
      const fl = new THREE.Shape();
      fl.moveTo(-0.05, 0); fl.lineTo(-0.05, 0.1);
      fl.quadraticCurveTo(-0.17, 0.07, -0.15, 0.2); fl.quadraticCurveTo(-0.09, 0.15, -0.035, 0.17);
      fl.quadraticCurveTo(-0.08, 0.28, 0, 0.38); fl.quadraticCurveTo(0.08, 0.28, 0.035, 0.17);
      fl.quadraticCurveTo(0.09, 0.15, 0.15, 0.2); fl.quadraticCurveTo(0.17, 0.07, 0.05, 0.1);
      fl.lineTo(0.05, 0); fl.closePath();
      const flG = new THREE.ExtrudeGeometry(fl, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 1, curveSegments: 6 });
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const p = [Math.sin(a) * 0.5, 0.15, Math.cos(a) * 0.5];
        if (k % 2 === 0) L.push(pc(flG, p, [0, a, 0]));
        else L.push(pc(G.cone(0.05, 0.2, 6), [p[0], 0.25, p[2]], [0, a, 0]));
      }
      flG.dispose();
      for (const ry of [0, Math.PI / 2]) L.push(pc(G.torus(0.46, 0.028, 6, 24, Math.PI), [0, 0.12, 0], [0, ry, 0], null, [1, 0.62, 1]));
      L.push(pc(G.sphere(0.085, 14, 10), [0, 0.5, 0]));
      L.push(pc(G.box(0.035, 0.18, 0.035), [0, 0.64, 0]), pc(G.box(0.12, 0.035, 0.035), [0, 0.66, 0]));
      return uvScale(merge(L), 2);
    }), gold, { outline: OL });
    // perles au bout des pointes, cabochons sertis sur le bandeau
    part(crown, once('pinceur-pearls', () => merge(Array.from({ length: 4 }, (_, k) => {
      const a = ((2 * k + 1) / 8) * Math.PI * 2;
      return pc(G.sphere(0.045, 10, 8), [Math.sin(a) * 0.5, 0.37, Math.cos(a) * 0.5]);
    }))), mat('#fff4ec', { rough: 0.15, metal: 0.1, coat: 1, sheen: 0.6, sheenColor: '#ffd8f0' }), { shadow: false });
    for (const [c, k0] of [['#ff4fa0', 0], ['#7ff3ff', 1]]) {
      part(crown, once('pinceur-crownGems' + k0, () => merge(Array.from({ length: 4 }, (_, k) => {
        const a = ((2 * k + k0) / 8) * Math.PI * 2;
        return pc(G.sphere(0.055, 12, 8), [Math.sin(a) * 0.525, 0.06, Math.cos(a) * 0.525], [0, a, 0], null, [1, 1.2, 0.5]);
      }))), glow(c, 2.3), { shadow: false });
    }
    // pierres serties tout autour de la jupe
    const studs = [];
    for (let k = 0; k < 7; k++) {
      const t = -0.9 + k * 0.3;
      for (const s of [-1, 1]) studs.push([s * 1.41 * Math.cos(t * 0.75), -0.04, 1.17 * Math.sin(t * 0.75) * 0.95, s, t]);
    }
    part(body, once('pinceur-studSet', () => merge(studs.map(([x, y, z]) => pc(G.torus(0.055, 0.018, 6, 14), [x, y, z], [0, Math.atan2(x, z), 0])))), gold, { shadow: false });
    for (const [c, odd] of [['#ff4fa0', 0], ['#7ff3ff', 1]]) {
      part(body, once('pinceur-studGems' + odd, () => merge(studs.filter((_, k) => k % 2 === odd).map(([x, y, z]) => pc(G.sphere(0.045, 10, 8), [x, y, z], [0, 0, 0])))), glow(c, 2.2), { shadow: false });
    }
  }

  return { root, debrisColor: shellC, body, mortar, eyes, claws, legs, vent, chunks: [mortar, armor, claws[0].pinA, claws[1].pinB] };
}
