import * as THREE from 'three';
import { G, part, joint, mergeGeometries } from '../geo.js';
import { mat, glow } from '../../engine/materials.js';
import { build, paintedMetalTexture } from '../../engine/textures.js';
import { fbm2, noise2, rng } from '../../engine/util.js';
import { primDist } from '../sculptCore.js';
import { addFur } from '../fur.js';
import { OL, C, rig } from './common.js';

// ===================================================================== Pingouin-mortier (Givrelune)
// Gorfou enrôlé par le Baron : plumage court (fourrure en coquilles), plastron blanc, aigrettes jaunes, bec et pattes
// palmées orange ; lunettes de neige, harnais Vorax (sangles, boucles, plaque dorsale) et mortier à boules de neige
// sur le dos (culasse boulonnée, bandes de renfort, réserve de boules, bouche givrée). Givre sur les épaules.

// plumage : poil très court et couché vers l'arrière (lisse de loin, plumeux de près)
const FUR_PINGOUIN = {
  len: 0.011, cell: 0.0042, minW: 0.3, lean: 1.6, sheen: 0.3,
  bones: { head: 0.85, flip: 0.7 },
  comb: { body: [0, -1, -0.35], head: [0, -0.3, -1], flip: [0, -1, 0] },
  trim: [
    { bone: 'head', p: [-0.1, 0.05, 0.22], r: 0.1, fade: 0.03, k: 0 }, // lunettes
    { bone: 'head', p: [0.1, 0.05, 0.22], r: 0.1, fade: 0.03, k: 0 },
    { bone: 'head', p: [0, -0.04, 0.25], r: 0.07, fade: 0.04, k: 0.2 }, // base du bec
    // bas du corps lissé (plumes plaquées, micro-relief seul) : le duvet reste à la tête, au cou et aux épaules
    { bone: 'body', p: [0, -0.5, 0], r: 0.42, fade: 0.2, k: 0 },
  ],
  regions: [
    { root: 'body', track: 'body', at: [0, 0.3, 0] },
    { root: 'head', track: 'head', at: [0, 0.1, 0] },
    { root: 'flipL', track: 'flipL', at: [0, -0.4, 0] },
    { root: 'flipR', track: 'flipR', at: [0, -0.4, 0] },
  ],
};

// ------------------------------------------------------------------ aides (champ de la sculpture, sangles, givre)
const smin = (a, b, k) => { if (k <= 0) return Math.min(a, b); const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
// champ de distance de la sculpture au repos (repère du modèle) : pour poser sangles et givre sur la peau
function sculptField(S, root, bones) {
  const prims = S.prepare(root, bones).filter((p) => p.op !== 'paint');
  return (x, y, z) => {
    let f = 1;
    for (const P of prims) {
      const b = P.box;
      if (x < b[0] || y < b[1] || z < b[2] || x > b[3] || y > b[4] || z > b[5]) continue;
      const d = primDist(P, x, y, z);
      f = P.op === 'add' ? smin(f, d, P.k) : -smin(-f, d, P.k);
    }
    return f;
  };
}
// point de la peau sur le rayon o + d·t (o à l'intérieur) et normale (gradient du champ)
function onSkin(F, o, d) {
  let t0 = 0, t1 = 0.01;
  while (F(o.x + d.x * t1, o.y + d.y * t1, o.z + d.z * t1) < 0 && t1 < 2) { t0 = t1; t1 += 0.01; }
  for (let i = 0; i < 18; i++) {
    const tm = (t0 + t1) / 2;
    if (F(o.x + d.x * tm, o.y + d.y * tm, o.z + d.z * tm) < 0) t0 = tm; else t1 = tm;
  }
  const p = o.clone().addScaledVector(d, (t0 + t1) / 2), e = 0.004;
  const n = new THREE.Vector3(
    F(p.x + e, p.y, p.z) - F(p.x - e, p.y, p.z), F(p.x, p.y + e, p.z) - F(p.x, p.y - e, p.z), F(p.x, p.y, p.z + e) - F(p.x, p.y, p.z - e),
  ).normalize();
  return { p, n };
}
// tracé d'une sangle : intersection de la peau et du plan (centre c, axes u et v), de l'angle a0 à a1
function loopOnSkin(F, c, u, v, a0, a1, n) {
  const pts = [], nrm = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n);
    const s = onSkin(F, c, u.clone().multiplyScalar(Math.cos(a)).addScaledVector(v, Math.sin(a)));
    pts.push(s.p); nrm.push(s.n);
  }
  return { pts, nrm };
}
// Sangle en relief sur la peau : section en rectangle arrondi (largeur w, épaisseur h), décalée vers l'extérieur ;
// u = longueur (m × 10), v = tour de la section. off : translation (repère du modèle → repère de l'os)
function ribbon({ pts, nrm }, w, h, off) {
  const K = 8, N = pts.length;
  const pos = [], nor = [], uv = [], idx = [];
  const t = new THREE.Vector3(), b = new THREE.Vector3(), q = new THREE.Vector3();
  let len = 0;
  for (let i = 0; i < N; i++) {
    const a = pts[Math.max(0, i - 1)], c = pts[Math.min(N - 1, i + 1)];
    t.subVectors(c, a).normalize();
    const n = nrm[i];
    b.crossVectors(t, n).normalize();
    if (i) len += pts[i].distanceTo(pts[i - 1]);
    const ctr = pts[i].clone().addScaledVector(n, h * 0.42).add(off);
    for (let k = 0; k <= K; k++) {
      const f = (k / K) * Math.PI * 2, cs = Math.cos(f), sn = Math.sin(f);
      // superellipse (p = 4) : flancs droits, arêtes arrondies
      const x = Math.sign(cs) * Math.sqrt(Math.abs(cs)), y = Math.sign(sn) * Math.sqrt(Math.abs(sn));
      q.copy(ctr).addScaledVector(b, x * w / 2).addScaledVector(n, y * h / 2);
      pos.push(q.x, q.y, q.z);
      const gx = Math.sign(cs) * Math.abs(cs) ** 1.5 / w, gy = Math.sign(sn) * Math.abs(sn) ** 1.5 / h;
      q.set(0, 0, 0).addScaledVector(b, gx).addScaledVector(n, gy).normalize();
      nor.push(q.x, q.y, q.z);
      uv.push(len * 10, k / K);
    }
  }
  const R = K + 1;
  for (let i = 0; i < N - 1; i++) for (let k = 0; k < K; k++) {
    const a = i * R + k, c = a + R;
    idx.push(a, c, a + 1, a + 1, c, c + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // sens des faces : la normale du premier triangle doit regarder vers l'extérieur
  const p0 = new THREE.Vector3().fromArray(pos, 0), p1 = new THREE.Vector3().fromArray(pos, R * 3), p2 = new THREE.Vector3().fromArray(pos, 3);
  const fn = p1.sub(p0).cross(p2.sub(p0));
  if (fn.dot(new THREE.Vector3().fromArray(nor, 0)) < 0) { for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]]; g.setIndex(idx); }
  return g.toNonIndexed();
}
// Pose une géométrie (clonée, non indexée) : p, rotation r (Euler) ou orientée de +Y vers dir, échelle s
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function put(list, geo, p = [0, 0, 0], r = null, s = 1, dir = null) {
  if (dir) _q.setFromUnitVectors(_up, dir.clone().normalize());
  else _q.setFromEuler(_e.set(...(r || [0, 0, 0])));
  if (typeof s === 'number') _s.setScalar(s); else _s.set(s[0], s[1], s[2]);
  const g = (geo.index ? geo.toNonIndexed() : geo.clone());
  g.applyMatrix4(_m.compose(new THREE.Vector3(p[0], p[1], p[2]), _q, _s));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  list.push(g);
  return g;
}
function fuse(list) {
  const g = mergeGeometries(list);
  g.userData.shared = true;
  return g;
}
// tête de rivet bombée
const RIVET = new THREE.SphereGeometry(1, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1);
RIVET.userData.shared = true;
// anneau couché (axe +Y), pour l'orienter selon une normale
const RING = new THREE.TorusGeometry(0.032, 0.008, 6, 14).rotateX(Math.PI / 2);
const rivet = (list, p, n, r = 0.012) => put(list, RIVET, p.toArray ? p.toArray() : p, null, r, n);
// amas de cristaux de givre (facettes) orientés autour de la normale n
const ICE = new THREE.IcosahedronGeometry(1, 0);
ICE.userData.shared = true;
function frost(list, R, p, n, size, count = 4) {
  const tg = new THREE.Vector3().crossVectors(n, Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : _up).normalize();
  const bt = new THREE.Vector3().crossVectors(n, tg);
  for (let i = 0; i < count; i++) {
    const a = R() * Math.PI * 2, d = R() * size * 1.2;
    const q = p.clone().addScaledVector(tg, Math.cos(a) * d).addScaledVector(bt, Math.sin(a) * d);
    const dir = n.clone().multiplyScalar(1.4).addScaledVector(tg, R() - 0.5).addScaledVector(bt, R() - 0.5);
    const sz = size * (0.45 + R() * 0.6);
    put(list, ICE, q.addScaledVector(n, sz * 0.25).toArray(), null, [sz * 0.55, sz * 1.25, sz * 0.55], dir);
  }
}

// sangle tissée : sergé en diagonale, surpiqûres dorées le long des bords, fils un peu irréguliers (v = tour de la section)
function webbingTexture() {
  return build('pingouin-sangle', 128, (u, v, o) => {
    const tw = Math.sin((u * 16 + v * 16) * Math.PI * 2) * 0.5 + 0.5;
    const n = fbm2(u * 6, v * 6, 3, 911, 6);
    const edge = Math.min(Math.abs(v - 0.15), Math.abs(v - 0.35)); // bords de la face visible (v = 0,25 au milieu)
    const st = edge < 0.025 && (u * 24) % 1 < 0.6 ? 1 : 0;
    const k = 0.78 + tw * 0.16 + (n - 0.5) * 0.18 + noise2(u * 64, v * 4, 913, 64) * 0.06;
    o[0] = o[1] = o[2] = k;
    if (st) { o[0] = 0.95; o[1] = 0.8; o[2] = 0.45; }
    return 0.5 + tw * 0.25 - st * 0.2;
  }, 2.5);
}

// ------------------------------------------------------------------ géométries rigides (calculées une fois)
let GEO = null;
function buildGeo(F) {
  const R = rng(17);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const BODY = V(0, -0.55, 0), HEAD = V(0, -1.1, -0.03); // repère du modèle → repère de l'os
  const body = { strap: [], gold: [], steel: [], dark: [], ice: [], led: [], plate: [], paint: [], claw: [] };
  // --- harnais : ceinture de poitrine, collier, bretelles avant ; anneaux en D aux jonctions, médaille au collier
  const beltY = 0.6, collarY = 0.9;
  body.strap.push(ribbon(loopOnSkin(F, V(0, beltY, 0), V(0, 0, 1), V(1, 0, 0), 0, Math.PI * 2, 48), 0.07, 0.022, BODY));
  body.strap.push(ribbon(loopOnSkin(F, V(0, collarY, 0.02), V(0, 0, 1), V(1, 0, 0), 0, Math.PI * 2, 40), 0.055, 0.02, BODY));
  for (const s of [-1, 1]) {
    // bretelle : plan vertical x = ±0,12, de la ceinture au collier (devant)
    const l = loopOnSkin(F, V(s * 0.12, beltY, 0), V(0, 0, 1), V(0, 1, 0), 0, Math.PI / 2, 24);
    const k = l.pts.findIndex((q) => q.y > collarY);
    body.strap.push(ribbon({ pts: l.pts.slice(0, k), nrm: l.nrm.slice(0, k) }, 0.05, 0.018, BODY));
    for (const y of [beltY, collarY]) {
      const r = onSkin(F, V(s * 0.12, y, 0), V(0, 0, 1));
      put(body.gold, RING, r.p.clone().addScaledVector(r.n, 0.026).add(BODY).toArray(), null, 1, r.n);
    }
  }
  {
    const r = onSkin(F, V(0, collarY - 0.03, 0.02), V(0, 0, 1));
    const p = r.p.clone().addScaledVector(r.n, 0.03).add(BODY);
    put(body.gold, RING, p.toArray(), [0, 0, Math.PI / 2], 0.7);
    put(body.gold, G.nut(0.04, 0.014), p.clone().add(V(0, -0.055, 0.01)).toArray(), [-0.25, 0, 0]);
  }
  // boucle de ceinture : cadre doré, plaque Vorax, voyant
  const bk = onSkin(F, V(0, beltY, 0), V(0, 0, 1));
  const bq = bk.p.clone().addScaledVector(bk.n, 0.03).add(BODY);
  put(body.gold, G.rbox(0.15, 0.1, 0.02, 0.012, 1), bq.toArray());
  put(body.plate, G.rbox(0.12, 0.074, 0.024, 0.01, 1), bq.clone().add(V(0, 0, 0.004)).toArray());
  for (const s of [-1, 1]) put(body.gold, G.box(0.016, 0.06, 0.012), bq.clone().add(V(s * 0.022, 0.004, 0.018)).toArray(), [0, 0, -s * 0.42]);
  put(body.led, G.sphere(0.009, 8, 6), bq.clone().add(V(0.042, -0.022, 0.016)).toArray());
  // griffes au bout des doigts palmés
  for (const s of [-1, 1]) for (const a of [-0.5, 0, 0.5]) {
    const ang = a + s * 0.15, d = V(Math.sin(ang), -0.25, Math.cos(ang)).normalize();
    put(body.claw, G.cone(0.013, 0.04, 6), [s * 0.15 + Math.sin(ang) * 0.145, -0.55, 0.13 + Math.cos(ang) * 0.145], null, 1, d);
  }
  // --- plaque dorsale : rivets et support du mortier (deux flasques, axe)
  for (const [x, y] of [[-0.13, 0.04], [0.13, 0.04], [-0.13, 0.3], [0.13, 0.3], [0, 0.0]]) {
    const r = onSkin(F, V(x * 0.5, 0.55 + y, -0.1), V(x, 0, -1).normalize());
    rivet(body.steel, r.p.clone().add(BODY), r.n, 0.014);
  }
  for (const s of [-1, 1]) {
    put(body.paint, G.rbox(0.035, 0.17, 0.16, 0.012, 1), [s * 0.185, 0.235, -0.35], [0.25, 0, 0]);
    put(body.gold, G.cyl(0.032, 0.032, 0.03, 6), [s * 0.21, 0.25, -0.38], [0, 0, Math.PI / 2]);
    put(body.steel, G.cyl(0.018, 0.018, 0.04, 10), [s * 0.22, 0.25, -0.38], [0, 0, Math.PI / 2]);
  }
  // --- givre sur les épaules et le haut du dos
  for (const s of [-1, 1]) {
    for (const [x, z, sz] of [[0.3, 0.02, 0.05], [0.26, -0.12, 0.042], [0.34, 0.12, 0.036], [0.2, -0.02, 0.035]]) {
      const r = onSkin(F, V(s * 0.12, 0.62, 0), V(s * x, 0.33, z).normalize());
      frost(body.ice, R, r.p.clone().add(BODY), r.n, sz, 5);
    }
  }
  // --- tête : sangle des lunettes (par l'arrière du crâne), boîtier de commande
  const head = { strap: [], dark: [], led: [], gold: [], ice: [] };
  const hc = V(0, 1.15, 0.03);
  const hn = V(0, 1, 0.12).normalize(), hu = V(1, 0, 0), hv = new THREE.Vector3().crossVectors(hu, hn);
  head.strap.push(ribbon(loopOnSkin(F, hc, hu, hv, -0.42, Math.PI + 0.42, 28), 0.05, 0.018, HEAD));
  {
    const r = onSkin(F, hc, V(-1, 0.05, -0.25).normalize());
    const p = r.p.clone().addScaledVector(r.n, 0.025).add(HEAD);
    put(head.dark, G.rbox(0.05, 0.075, 0.06, 0.012, 1), p.toArray(), [0, -0.25, 0]);
    put(head.led, G.sphere(0.011, 8, 6), p.clone().add(V(-0.026, 0.014, -0.006)).toArray());
    put(head.gold, G.cyl(0.006, 0.006, 0.08, 5), p.clone().add(V(-0.01, 0.06, -0.012)).toArray(), [0, 0, 0.25]);
    put(head.led, G.sphere(0.012, 6, 4), p.clone().add(V(-0.02, 0.1, -0.012)).toArray());
  }
  // givre sur le sommet du crâne
  for (const [x, z] of [[0.1, -0.1], [-0.12, -0.04]]) {
    const r = onSkin(F, hc, V(x, 1, z).normalize());
    frost(head.ice, R, r.p.clone().add(HEAD), r.n, 0.022, 3);
  }

  // --- mortier (repère du mortier : axe +Y, bouche en y = 0,5)
  const m = { paint: [], dark: [], gold: [], steel: [], bore: [], glass: [], snow: [], ice: [], glowRing: [] };
  m.paint.push(G.lathe('pingouin-tube', [
    [0.128, 0.1], [0.134, 0.12], [0.132, 0.3], [0.124, 0.41], [0.128, 0.43], [0.146, 0.455], [0.156, 0.485], [0.154, 0.51], [0.142, 0.522], [0.112, 0.52],
  ], 28).toNonIndexed());
  m.bore.push(G.lathe('pingouin-ame', [[0.113, 0.52], [0.106, 0.505], [0.104, 0.34], [0.001, 0.34]], 20).toNonIndexed());
  m.dark.push(G.lathe('pingouin-culasse', [
    [0.001, -0.11], [0.07, -0.106], [0.115, -0.088], [0.142, -0.055], [0.152, -0.02], [0.152, 0.085], [0.143, 0.11], [0.132, 0.12],
  ], 24).toNonIndexed());
  // bandes de renfort rivetées, collier de culasse boulonné
  for (const y of [0.17, 0.31]) {
    put(m.gold, G.cyl(0.143, 0.145, 0.04, 24, true), [0, y, 0]);
    put(m.gold, G.torus(0.143, 0.006, 3, 24), [0, y + 0.02, 0], [Math.PI / 2, 0, 0]);
    put(m.gold, G.torus(0.145, 0.006, 3, 24), [0, y - 0.02, 0], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      rivet(m.steel, [Math.sin(a) * 0.146, y, Math.cos(a) * 0.146], V(Math.sin(a), 0, Math.cos(a)), 0.009);
    }
  }
  put(m.gold, G.torus(0.15, 0.008, 4, 28), [0, 0.505, 0], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    put(m.steel, G.cyl(0.013, 0.013, 0.014, 6), [Math.sin(a) * 0.153, 0.05, Math.cos(a) * 0.153], null, 1, V(Math.sin(a), 0, Math.cos(a)));
  }
  put(m.steel, G.cyl(0.03, 0.03, 0.4, 12), [0, 0, 0], [0, 0, Math.PI / 2]);
  // volant de pointage (côté droit), réserve vitrée de boules de neige (face arrière) et sa goulotte
  put(m.gold, G.torus(0.05, 0.009, 6, 16), [0.185, 0.24, 0], [0, Math.PI / 2, 0]);
  for (let i = 0; i < 3; i++) put(m.gold, G.box(0.008, 0.1, 0.008), [0.185, 0.24, 0], [(i / 3) * Math.PI, 0, 0]);
  put(m.steel, G.cyl(0.016, 0.016, 0.06, 8), [0.16, 0.24, 0], [0, 0, Math.PI / 2]);
  put(m.steel, G.sphere(0.014, 8, 6), [0.19, 0.24, 0]);
  const cz = -0.19;
  put(m.glass, G.cyl(0.048, 0.048, 0.13, 16, true), [0, 0.235, cz]);
  for (const y of [0.16, 0.31]) put(m.dark, G.cyl(0.056, 0.056, 0.024, 16), [0, y, cz]);
  for (const y of [0.2, 0.27]) put(m.gold, G.torus(0.05, 0.005, 4, 16), [0, y, cz], [Math.PI / 2, 0, 0]);
  for (const [y, r] of [[0.205, 0.04], [0.27, 0.038]]) put(m.snow, G.ico(r, 1), [0, y, cz]);
  put(m.dark, G.cyl(0.018, 0.018, 0.08, 8), [0, 0.12, cz + 0.03], [0.5, 0, 0]);
  put(m.dark, G.rbox(0.05, 0.03, 0.08, 0.01, 1), [0, 0.235, -0.145]);
  // plaque « V » du Baron sur le tube, face arrière
  put(m.dark, G.rbox(0.08, 0.07, 0.02, 0.008, 1), [0, 0.37, -0.128], [0.05, 0, 0]);
  for (const s of [-1, 1]) put(m.gold, G.box(0.014, 0.055, 0.012), [s * 0.016, 0.372, -0.14], [0, 0, -s * 0.4]);
  // lueur de la charge au fond de l'âme, anneau lumineux à la bouche
  put(m.glowRing, G.torus(0.11, 0.011, 6, 24), [0, 0.505, 0], [Math.PI / 2, 0, 0]);
  put(m.glowRing, new THREE.CircleGeometry(0.1, 16), [0, 0.345, 0], [-Math.PI / 2, 0, 0]);
  // givre et stalactites autour de la bouche
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + R() * 0.5;
    const n = V(Math.sin(a), 0.6, Math.cos(a)).normalize();
    frost(m.ice, R, V(Math.sin(a) * 0.15, 0.5, Math.cos(a) * 0.15), n, 0.018, 2);
    if (i % 2 === 0) put(m.ice, G.cone(0.011, 0.05 + R() * 0.05, 5), [Math.sin(a) * 0.158, 0.44, Math.cos(a) * 0.158], [Math.PI, 0, 0]);
  }
  // --- lunettes (repère de la tête) : par œil, coque, cerclage riveté, globe, iris, pupille, reflet, paupière, verre
  const gg = { rubber: [], paint: [], gold: [], white: [], iris: [], pupil: [], spark: [], lid: [], glass: [] };
  const eyeM = new THREE.Matrix4(), loc = new THREE.Matrix4();
  const at = (list, geo, p, r = [0, 0, 0], sc = 1) => {
    loc.compose(V(...p), _q.setFromEuler(_e.set(...r)), typeof sc === 'number' ? _s.setScalar(sc) : _s.set(...sc));
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(loc.premultiply(eyeM));
    list.push(g);
  };
  for (const s of [-1, 1]) {
    eyeM.compose(V(s * 0.105, 0.055, 0.205), _q.setFromEuler(_e.set(-0.08, s * 0.4, 0)), _s.setScalar(1));
    at(gg.rubber, G.cyl(0.086, 0.094, 0.09, 22, true), [0, 0, -0.005], [Math.PI / 2, 0, 0]);
    at(gg.paint, G.torus(0.084, 0.02, 8, 24), [0, 0, 0.04]);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      at(gg.gold, RIVET, [Math.cos(a) * 0.084, Math.sin(a) * 0.084, 0.06], [Math.PI / 2, 0, 0], 0.009);
    }
    at(gg.white, G.sphere(0.064, 16, 12), [0, 0, -0.03]);
    at(gg.iris, G.sphere(0.036, 12, 8), [s * -0.008, -0.006, 0.03], [0, 0, 0], [1, 1, 0.5]);
    at(gg.pupil, G.sphere(0.016, 8, 6), [s * -0.01, -0.008, 0.045], [0, 0, 0], [1, 1, 0.4]);
    at(gg.spark, G.sphere(0.008, 6, 4), [0.014, 0.014, 0.046]);
    // paupière : demi-coque inclinée, coin intérieur abaissé (air renfrogné)
    at(gg.lid, LID, [0, 0, -0.03], [0.55, 0, -s * 0.42]);
    at(gg.glass, LENS, [0, 0, 0.045]);
  }
  eyeM.identity();
  at(gg.gold, G.rbox(0.07, 0.03, 0.03, 0.01, 1), [0, 0.07, 0.262], [-0.25, 0, 0]);
  const out = (o) => Object.fromEntries(Object.entries(o).filter(([, l]) => l.length).map(([k, l]) => [k, fuse(l)]));
  return { body: out(body), head: out(head), mortar: out(m), goggles: out(gg) };
}

export function pingouin() {
  const { S, root, B, skin } = rig({
    plume: { color: '#181d30', rough: 0.62, sheen: 0.5, fur: 1 },
    plumeB: { color: '#252e4a', rough: 0.6, sheen: 0.5, fur: 1 },
    white: { color: '#eef3fb', rough: 0.72, sheen: 0.8, fur: 0.25 },
    slush: { color: '#b9c8dc', rough: 0.8, sheen: 0.5, fur: 0.2 },
    crest: { color: '#ffc22e', rough: 0.6, sheen: 0.7, fur: 1 },
    frost: { color: '#c8e6ff', rough: 0.4, sheen: 1, fur: 0.28 },
    beak: { color: '#ff7a12', rough: 0.32, sheen: 0.2, coat: 0.7 },
    beakD: { color: '#b8401a', rough: 0.4, coat: 0.5 },
    foot: { color: '#ff9634', rough: 0.55, sheen: 0.35, coat: 0.2 },
    footD: { color: '#c8602a', rough: 0.6, sheen: 0.3 },
    strap: { color: '#22183a', rough: 0.75, sheen: 0.3 },
    plate: { color: C.vorax, rough: 0.35, metal: 0.45, sheen: 0.2, coat: 0.85 },
    plateD: { color: C.voraxD, rough: 0.45, metal: 0.5, coat: 0.5 },
  });
  // --- corps en poire : dos noir, plastron blanc jusqu'à la gorge
  const body = B(root, [0, 0.55, 0], 'body');
  S.add(body, { t: 'ell', r: [0.4, 0.5, 0.37], p: [0, 0.02, 0], col: 'plume', k: 0.05 });
  S.add(body, { t: 'ell', r: [0.42, 0.34, 0.38], p: [0, -0.17, 0.01], col: 'plume', k: 0.12 });
  S.add(body, { t: 'ell', r: [0.3, 0.45, 0.2], p: [0, -0.06, 0.2], col: 'white', k: 0.08 });
  S.paint(body, { t: 'ell', r: [0.27, 0.5, 0.3], p: [0, 0.02, 0.24], col: 'white', feather: 0.03 });
  // le blanc descend jusqu'entre les pattes ; neige fondue au bas du plastron
  S.paint(body, { t: 'ell', r: [0.3, 0.22, 0.3], p: [0, -0.25, 0.25], col: 'white', feather: 0.04 });
  S.paint(body, { t: 'ell', r: [0.28, 0.08, 0.12], p: [0, -0.37, 0.33], col: 'slush', feather: 0.08 });
  // reflets bleutés au milieu du dos
  S.paint(body, { t: 'ell', r: [0.22, 0.36, 0.2], p: [0, 0.05, -0.33], col: 'plumeB', feather: 0.08 });
  // queue : courte palette de plumes raides qui touche le sol
  S.add(body, { t: 'cone', a: [0, -0.3, -0.28], b: [0, -0.5, -0.47], r1: 0.1, r2: 0.035, sc: [1.5, 0.55, 1], col: 'plume', k: 0.05 });
  // plaque dorsale du harnais (berceau du mortier), joints de panneaux
  S.add(body, { t: 'box', s: [0.165, 0.17, 0.05], round: 0.035, p: [0, 0.18, -0.34], rot: [0.25, 0, 0], col: 'plate', k: 0.03 });
  S.sub(body, { t: 'box', s: [0.2, 0.004, 0.08], round: 0.002, p: [0, 0.12, -0.39], rot: [0.25, 0, 0], k: 0.004 });
  S.paint(body, { t: 'box', s: [0.15, 0.03, 0.07], round: 0.01, p: [0, 0.03, -0.37], rot: [0.25, 0, 0], col: 'plateD', feather: 0.004 });
  // lit des sangles (pas de plumes dessous) : ceinture, collier, bretelles
  S.paint(body, { t: 'box', s: [0.6, 0.04, 0.6], round: 0.004, p: [0, 0.05, 0], col: 'strap', feather: 0.006 });
  S.paint(body, { t: 'box', s: [0.6, 0.032, 0.6], round: 0.004, p: [0, 0.35, 0.02], col: 'strap', feather: 0.006 });
  for (const s of [-1, 1]) S.paint(body, { t: 'box', s: [0.028, 0.15, 0.3], round: 0.004, p: [s * 0.12, 0.2, 0.3], col: 'strap', feather: 0.006 });
  // givre sur les épaules
  for (const s of [-1, 1]) S.paint(body, { t: 'ell', r: [0.15, 0.09, 0.18], p: [s * 0.27, 0.42, -0.03], col: 'frost', feather: 0.04 });
  // pattes palmées : paume, trois doigts, palmure, cheville
  for (const s of [-1, 1]) {
    const fx = s * 0.15;
    S.add(body, { t: 'cone', a: [fx, -0.42, 0.02], b: [fx, -0.52, 0.1], r1: 0.06, r2: 0.045, col: 'foot', k: 0.04 });
    S.add(body, { t: 'ell', r: [0.075, 0.032, 0.07], p: [fx, -0.53, 0.12], col: 'foot', k: 0.03 });
    for (const a of [-0.5, 0, 0.5]) {
      const ang = a + s * 0.15;
      S.add(body, { t: 'cone', a: [fx, -0.53, 0.13], b: [fx + Math.sin(ang) * 0.13, -0.545, 0.13 + Math.cos(ang) * 0.13], r1: 0.03, r2: 0.019, col: 'foot', k: 0.02 });
    }
    S.add(body, { t: 'ell', r: [0.11, 0.012, 0.075], p: [fx + s * 0.012, -0.545, 0.2], col: 'foot', k: 0.025 });
    S.paint(body, { t: 'ell', r: [0.09, 0.02, 0.05], p: [fx, -0.52, 0.12], col: 'footD', feather: 0.02 });
  }
  // --- tête : face noire, gorge blanche, sourcils froncés, aigrettes jaunes de gorfou
  const head = B(body, [0, 0.55, 0.03], 'head');
  S.add(head, { t: 'ell', r: [0.27, 0.26, 0.265], col: 'plume', k: 0.06 });
  S.paint(head, { t: 'ell', r: [0.16, 0.1, 0.12], p: [0, -0.2, 0.15], col: 'white', feather: 0.04 });
  for (const s of [-1, 1]) {
    // sourcil froncé (coin intérieur bas) souligné d'un trait jaune
    S.add(head, { t: 'cone', a: [s * 0.035, 0.135, 0.235], b: [s * 0.17, 0.185, 0.18], r1: 0.032, r2: 0.04, col: 'plume', k: 0.03 });
    S.paint(head, { t: 'cone', a: [s * 0.06, 0.17, 0.235], b: [s * 0.19, 0.215, 0.16], r1: 0.012, r2: 0.018, col: 'crest', feather: 0.01 });
    // aigrette : lame de plumes plaquée contre le crâne (aplatie sur x), qui remonte vers l'arrière et s'effile
    const fl = 0.55, X = (x) => x / fl;
    S.add(head, { t: 'cone', a: [X(s * 0.17), 0.2, 0.15], b: [X(s * 0.25), 0.27, 0.0], r1: 0.04, r2: 0.036, sc: [fl, 1, 1], col: 'crest', k: 0.03 });
    S.add(head, { t: 'cone', a: [X(s * 0.25), 0.27, 0.0], b: [X(s * 0.28), 0.31, -0.16], r1: 0.036, r2: 0.012, sc: [fl, 1, 1], col: 'crest', k: 0.02 });
    S.add(head, { t: 'cone', a: [X(s * 0.25), 0.24, -0.01], b: [X(s * 0.29), 0.2, -0.13], r1: 0.026, r2: 0.01, sc: [fl, 1, 1], col: 'crest', k: 0.025 });
  }
  // houppe hérissée sur le sommet
  for (const [x, z, h] of [[0, -0.02, 0.15], [0.05, -0.07, 0.11], [-0.05, -0.06, 0.12]]) {
    S.add(head, { t: 'cone', a: [x * 0.5, 0.2, z + 0.03], b: [x, 0.24 + h * 0.6, z - h * 0.5], r1: 0.04, r2: 0.013, col: 'plume', k: 0.03, fuzz: [0.004, 50] });
  }
  // bec : mandibule supérieure crochue, inférieure plus courte, commissure et narines peintes
  S.add(head, { t: 'cone', a: [0, -0.02, 0.2], b: [0, -0.065, 0.41], r1: 0.072, r2: 0.02, sc: [1.25, 0.8, 1], col: 'beak', k: 0.03 });
  S.add(head, { t: 'sph', r: 0.022, p: [0, -0.078, 0.405], col: 'beakD', k: 0.015 });
  S.add(head, { t: 'cone', a: [0, -0.095, 0.2], b: [0, -0.1, 0.36], r1: 0.05, r2: 0.016, sc: [1.2, 0.65, 1], col: 'beak', k: 0.02 });
  S.paint(head, { t: 'box', s: [0.09, 0.006, 0.13], round: 0.004, p: [0, -0.078, 0.31], rot: [-0.08, 0, 0], col: 'beakD', feather: 0.006 });
  for (const s of [-1, 1]) S.paint(head, { t: 'ell', r: [0.012, 0.008, 0.018], p: [s * 0.03, 0.005, 0.3], col: 'beakD', feather: 0.004 });
  S.paint(head, { t: 'sph', r: 0.04, p: [0, -0.07, 0.42], col: 'beakD', feather: 0.025 });
  // lit de la sangle des lunettes
  S.paint(head, { t: 'box', s: [0.4, 0.028, 0.25], round: 0.004, p: [0, 0.05, -0.12], rot: [-0.12, 0, 0], col: 'strap', feather: 0.006 });
  S.paint(head, { t: 'ell', r: [0.1, 0.05, 0.1], p: [0, 0.24, -0.15], col: 'frost', feather: 0.05 });
  // --- ailerons : palette effilée, dessous blanc
  const flippers = [];
  for (const s of [-1, 1]) {
    const f = B(body, [s * 0.36, 0.18, 0], s < 0 ? 'flipL' : 'flipR', [0, 0, s * 0.35]);
    S.add(f, { t: 'ell', r: [0.055, 0.2, 0.14], p: [0, -0.15, 0], col: 'plume', k: 0.03, skinSoft: 0.012 });
    S.add(f, { t: 'cone', a: [0, -0.15, 0], b: [s * 0.01, -0.5, -0.05], r1: 0.12, r2: 0.035, sc: [0.42, 1, 1], col: 'plume', k: 0.04, skinSoft: 0.012 });
    S.paint(f, { t: 'ell', r: [0.035, 0.32, 0.15], p: [-s * 0.045, -0.3, 0], col: 'white', feather: 0.025 });
    S.paint(f, { t: 'ell', r: [0.08, 0.1, 0.12], p: [0, 0.02, 0], col: 'frost', feather: 0.05 });
    S.paint(f, { t: 'box', s: [0.1, 0.04, 0.2], round: 0.004, p: [0, -0.09, 0], col: 'strap', feather: 0.006 });
    flippers.push(f);
  }
  const sk = skin('pingouin', { mesh: { cell: 0.02, skinSoft: 0.03 }, mat: { enemyRim: true, sheenColor: '#c8d8ff' } });
  if (!GEO) GEO = buildGeo(sculptField(S, root, S.ops.map((o) => o.bone).filter((b, i, a) => a.indexOf(b) === i)));

  // plumage en coquilles (Ultra, Haute)
  const fur = addFur(sk, FUR_PINGOUIN);
  if (fur) {
    // les ennemis clonent leurs matériaux (flash d'impact) : le clone tient lieu de l'original ; les plumes vivent
    // au rythme du rendu (inertie, vent)
    const base = fur.mesh.onBeforeRender;
    let last = 0;
    fur.mesh.onBeforeRender = (r, sc, cam, geo, m, grp) => {
      base(r, sc, cam, geo, m === fur.mesh.material ? fur.material : m, grp);
      const now = performance.now();
      if (now - last > 8) { fur.update(Math.min(0.05, (now - last) / 1000)); last = now; }
    };
  }

  // --- matières des accessoires
  const vp = paintedMetalTexture(C.vorax, null, { chip: 0.3, edge: 0.7, rust: 0.05, tile: 2 });
  const gp = paintedMetalTexture('#3a3d52', null, { chip: 0.25, edge: 0.8, rust: 0.15 });
  const web = webbingTexture();
  const M = {
    paint: mat('#ffffff', { map: vp.map, normalMap: vp.normalMap, rough: 0.42, metal: 0.4, coat: 0.6 }),
    dark: mat('#ffffff', { map: gp.map, normalMap: gp.normalMap, rough: 0.5, metal: 0.6 }),
    strap: mat('#4a2a78', { map: web.map, normalMap: web.normalMap, normalScale: 0.6, rough: 0.8, sheen: 0.6, sheenColor: '#c8a8ff' }),
    gold: mat(C.gold, { rough: 0.28, metal: 0.85, coat: 0.3 }),
    steel: mat('#c3cad8', { rough: 0.3, metal: 0.85 }),
    plate: mat(C.vorax, { rough: 0.35, metal: 0.45, coat: 0.85 }),
    ice: mat('#e2f5ff', { rough: 0.12, metal: 0.05, coat: 1, emissive: '#3aa8d8', emissiveIntensity: 0.18 }),
    glass: mat('#bff4ff', { rough: 0.05, metal: 0.1, coat: 1, transparent: true, opacity: 0.18 }),
    snow: mat('#f6fbff', { rough: 0.7, sheen: 0.8, sheenColor: '#cfe8ff' }),
    bore: mat('#141220', { rough: 0.7, metal: 0.3 }),
    claw: mat('#2a2230', { rough: 0.3, coat: 0.6 }),
    led: glow('#ff3a8a', 3),
    glowRing: glow('#3ef2ff', 2.2),
  };
  const place = (parent, set) => {
    for (const [k, g] of Object.entries(set)) part(parent, g, M[k] || M.dark, { shadow: k !== 'led' && k !== 'glowRing' && k !== 'glass' });
  };
  place(body, GEO.body);
  place(head, GEO.head);

  // --- lunettes de neige : coques en caoutchouc, cerclage Vorax, verres teintés ; derrière, l'œil lumineux
  // aux paupières froncées
  const goggles = joint(head, [0, 0, 0]);
  const G2 = {
    rubber: mat('#2a2438', { rough: 0.7, sheen: 0.4 }), white: mat('#ffffff', { rough: 0.15 }), iris: glow('#3ef2ff', 2.6),
    pupil: mat('#140a10', { rough: 0.2 }), spark: glow('#ffffff', 1.4), lid: mat('#1a1f33', { rough: 0.6, sheen: 0.6, sheenColor: '#c8d8ff' }),
  };
  for (const [k, g] of Object.entries(GEO.goggles)) {
    part(goggles, g, G2[k] || M[k], { shadow: false, outline: k === 'paint' ? OL * 0.7 : false });
  }

  // --- mortier dorsal (pivot fourni au comportement ; bouche en y = 0,5 du repère du mortier)
  const mortar = joint(body, [0, 0.25, -0.38]);
  mortar.rotation.x = -0.4;
  for (const [k, g] of Object.entries(GEO.mortar)) {
    part(mortar, g, M[k] || M.dark, { shadow: k !== 'glowRing' && k !== 'glass', outline: k === 'paint' ? OL * 0.7 : false });
  }
  // bracelets des ailerons
  for (const f of flippers) {
    part(f, BRACER, M.plate, { p: [0, -0.1, 0] });
    part(f, G.torus(0.1, 0.008, 4, 20), M.gold, { p: [0, -0.07, 0], r: [Math.PI / 2, 0, 0], s: [0.62, 1.5, 1] });
  }
  return { root, debrisColor: '#1e2236', body, head, flippers, mortar, chunks: [mortar, goggles] };
}

// demi-coque de paupière, verre bombé, bracelet aplati (anneau elliptique autour de l'aileron)
const LID = new THREE.SphereGeometry(0.068, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2);
LID.userData.shared = true;
const LENS = new THREE.SphereGeometry(0.08, 22, 6, 0, Math.PI * 2, 0, Math.PI * 0.28).rotateX(Math.PI / 2).scale(1, 1, 0.45).translate(0, 0, -0.023);
LENS.userData.shared = true;
const BRACER = new THREE.CylinderGeometry(0.1, 0.1, 0.06, 20, 1, true).scale(0.6, 1, 1.48);
BRACER.userData.shared = true;
