// Disqueuse Folle : meuleuse d'atelier transformée en lance-lames (canon vers +Z, poignée vers −Y).
// Moteur laqué à ailettes lumineuses, tête d'engrenage en alu, poignée latérale, carter à bandes de danger
// et grande lame dentée horizontale (elle tourne autour de son Y : bladeAxis = 'y'). Cordon et prise qui pendent :
// personne n'a jamais su où la brancher.
// v2 « Disqueuse Démente » : deux lames superposées, chargeur de lames de rechange, carter hérissé, pots d'échappement.
import * as THREE from 'three';
import { G, mtx, bake } from '../geo.js';
import { mat, glow } from '../../engine/materials.js';
import { paintedMetalTexture, hazardTexture } from '../../engine/textures.js';
import { rng } from '../../engine/util.js';
import { steel, dark } from './common.js';

const HP = Math.PI / 2;
const AX = 0.05; // hauteur de l'axe du moteur
const BY = -0.045, BZ = 0.3; // centre de la lame (sous la tête d'engrenage)
const TILT = -0.1; // lame et carter relevés vers l'avant : la face de la lame se voit de derrière Kobi
const TEETH = 22, R_TIP = 0.165, R_GUL = 0.137;

// ------------------------------------------------------------------ textures (créées au premier appel seulement)
const TEX = new Map();
function canvasTex(key, w, h, draw) {
  let t = TEX.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.userData.shared = true;
  TEX.set(key, t);
  return t;
}

// Face de lame : acier poli brossé en cercles, pointes carbure sombres, anneau imprimé, flèches de rotation
function bladeTexture() {
  return canvasTex('arme-disqueuse-lame', 256, 256, (ctx, W) => {
    const c = W / 2, k = c / 0.17; // pixels par mètre (la face va de −0,17 à 0,17 m)
    const rnd = rng(4242);
    const ring = (r0, r1, col) => { ctx.beginPath(); ctx.arc(c, c, r1 * k, 0, Math.PI * 2); ctx.arc(c, c, r0 * k, 0, Math.PI * 2, true); ctx.fillStyle = col; ctx.fill(); };
    ctx.fillStyle = '#a7adb8';
    ctx.fillRect(0, 0, W, W);
    // brossage concentrique
    for (let i = 0; i < 520; i++) {
      const r = rnd() * c * 1.42, l = rnd() < 0.5 ? 255 : 40;
      ctx.strokeStyle = `rgba(${l},${l},${l + 8},${0.04 + rnd() * 0.09})`;
      ctx.lineWidth = 0.6 + rnd() * 1.2;
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    // liseré poli puis pointes carbure
    ring(0.128, 0.137, 'rgba(255,255,255,0.35)');
    ring(0.153, 0.2, '#7c818d');
    ring(0.153, 0.1555, 'rgba(20,18,26,0.55)');
    // anneau imprimé
    ring(0.052, 0.098, '#25212c');
    ring(0.095, 0.098, '#ff4f6d');
    ring(0.052, 0.055, '#ff4f6d');
    const txt = 'DISQUEUSE FOLLE • 12 000 TR/MIN • NE PAS LÉCHER • ';
    ctx.font = 'bold 10px Arial, sans-serif';
    ctx.fillStyle = '#efe6cf';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const rt = 0.0765 * k;
    const total = ctx.measureText(txt).width;
    let a = -HP;
    for (const ch of txt) {
      const step = (ctx.measureText(ch).width / total) * Math.PI * 2; // le texte fait exactement le tour
      const am = a + step / 2;
      ctx.save();
      ctx.translate(c + Math.cos(am) * rt, c + Math.sin(am) * rt);
      ctx.rotate(am + HP);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
      a += step;
    }
    // flèches dans le sens de rotation de la lame (angle décroissant sur l'image, qui est retournée en V)
    ctx.fillStyle = '#ff4f6d';
    for (let i = 0; i < 3; i++) {
      const a0 = i * (Math.PI * 2 / 3), r = 0.116 * k;
      ctx.beginPath();
      ctx.arc(c, c, r + 3, a0, a0 + 0.62);
      ctx.arc(c, c, r - 3, a0 + 0.62, a0, true);
      ctx.fill();
      const ah = a0, tip = a0 - 0.22;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(ah) * (r + 8), c + Math.sin(ah) * (r + 8));
      ctx.lineTo(c + Math.cos(tip) * r, c + Math.sin(tip) * r);
      ctx.lineTo(c + Math.cos(ah) * (r - 8), c + Math.sin(ah) * (r - 8));
      ctx.fill();
    }
    // moyeu poli
    ring(0, 0.05, '#c9cdd6');
    ring(0.03, 0.034, 'rgba(30,28,38,0.6)');
  });
}

// Autocollant de mise en garde (queue touffue barrée)
function stickerTexture() {
  return canvasTex('arme-disqueuse-etiquette', 256, 128, (ctx, W, H) => {
    ctx.fillStyle = '#1a1720';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff0c4';
    ctx.beginPath();
    ctx.roundRect(5, 5, W - 10, H - 10, 14);
    ctx.fill();
    // bande de danger à gauche
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(5, 5, W - 10, H - 10, 14);
    ctx.clip();
    for (let i = -4; i < 6; i++) {
      ctx.fillStyle = i % 2 ? '#1a1720' : '#ffc21a';
      ctx.beginPath();
      ctx.moveTo(0, i * 22); ctx.lineTo(18, i * 22 - 18); ctx.lineTo(18, i * 22 + 4); ctx.lineTo(0, i * 22 + 22);
      ctx.fill();
    }
    ctx.restore();
    // pictogramme : queue de renard dans un cercle barré
    const cx = 72, cy = 64;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(cx, cy, 44, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.5);
    ctx.fillStyle = '#ef8a2a';
    ctx.strokeStyle = '#1a1720';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-30, 8);
    ctx.bezierCurveTo(-20, -18, 10, -26, 30, -8);
    ctx.bezierCurveTo(38, 2, 30, 16, 18, 14);
    ctx.bezierCurveTo(6, 12, -10, 22, -30, 8);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(22, -14);
    ctx.bezierCurveTo(34, -8, 36, 6, 26, 12);
    ctx.bezierCurveTo(22, 6, 18, -4, 22, -14);
    ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#e8263f';
    ctx.lineWidth = 9;
    ctx.beginPath(); ctx.arc(cx, cy, 40, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 28, cy - 28); ctx.lineTo(cx + 28, cy + 28); ctx.stroke();
    // texte
    ctx.fillStyle = '#1a1720';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 25px Arial, sans-serif';
    ctx.fillText('DANGER', 124, 44);
    ctx.font = 'bold 14px Arial, sans-serif';
    ctx.fillText('QUEUES', 124, 66);
    ctx.fillText('TOUFFUES', 124, 82);
    ctx.fillText('INTERDITES', 124, 98);
    ctx.fillStyle = '#e8263f';
    ctx.font = 'bold 11px Arial, sans-serif';
    ctx.fillText('12 000 TR/MIN', 124, 114);
  });
}

function mats(v2) {
  const pw = paintedMetalTexture('#eceaf6', 'lunette-blanc', { chip: 0.22, edge: 0.7, rust: 0.03, bare: '#9aa0b4' });
  const hz = hazardTexture();
  return {
    paint: mat(v2 ? '#ff2a4a' : '#ff4f6d', { map: pw.map, normalMap: pw.normalMap, rough: 0.3, metal: 0.25, coat: 0.85 }),
    alu: steel(),
    dark: dark(),
    rubber: mat('#1d1c21', { rough: 0.85 }),
    blade: mat('#ffffff', { map: bladeTexture(), rough: 0.28, metal: 0.7 }),
    hazard: mat('#ffffff', { map: hz.map, normalMap: hz.normalMap, rough: 0.42, metal: 0.2, coat: 0.6 }),
    glow: glow('#ff4f6d', 2.6),
    sticker: mat('#ffffff', { map: stickerTexture(), rough: 0.45, coat: 0.7 }),
  };
}

// ------------------------------------------------------------------ géométries
const GEO = new Map();
// Construit (une fois) un ensemble de pièces rangées par matériau puis fusionnées
function built(key, make) {
  let out = GEO.get(key);
  if (!out) {
    const L = {};
    const own = [];
    // k : matériau, geo, position, rotation, échelle, matrice parente
    const add = (k, geo, p, r, s, parent) => {
      const m = mtx(p, r, s);
      if (parent) m.premultiply(parent);
      (L[k] ||= []).push([geo, m]);
    };
    make(add, own);
    out = {};
    for (const k in L) { out[k] = bake(L[k]); out[k].userData.shared = true; }
    for (const g of own) g.dispose();
    GEO.set(key, out);
  }
  return out;
}

// Lame dentée : dents en crochet (face raide en avant dans le sens de rotation) et trous de dilatation
// (pas d'alésage : il est caché par les flasques)
function bladeGeometry() {
  const s = new THREE.Shape();
  const st = (Math.PI * 2) / TEETH;
  for (let i = 0; i < TEETH; i++) {
    const a = i * st;
    const P = (r, t) => [Math.cos(a + t * st) * r, Math.sin(a + t * st) * r];
    const pts = [P(R_GUL + 0.004, 0), P(R_TIP, 0.78), P(0.146, 0.84), P(R_GUL, 0.92)];
    pts.forEach(([x, y], j) => (i === 0 && j === 0 ? s.moveTo(x, y) : s.lineTo(x, y)));
  }
  s.closePath();
  for (let i = 0; i < 4; i++) {
    const a = i * HP + 0.4, h = new THREE.Path();
    h.absarc(Math.cos(a) * 0.112, Math.sin(a) * 0.112, 0.007, 0, Math.PI * 2, true);
    s.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: false, curveSegments: 3 });
  // UV polaires : la face entière correspond à la texture de lame
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 0.34 + 0.5, p.getY(i) / 0.34 + 0.5);
  g.translate(0, 0, -0.004);
  g.rotateX(-HP); // forme dans le plan XZ, épaisseur selon Y
  return g;
}

// Secteur de cylindre retourné (face intérieure d'un carter)
function innerSector(r, h, segs, t0, tl) {
  const g = new THREE.CylinderGeometry(r, r, h, segs, 1, true, t0, tl);
  g.scale(-1, 1, 1);
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}

// Autocollant galbé sur le moteur, côté side (+1 = +X) ; u le long de l'arme, v vers le haut
function stickerGeometry(side) {
  const r = 0.0685, arc = 0.05, tl = arc / r;
  const t0 = (side > 0 ? HP : 3 * HP) - tl / 2;
  const g = new THREE.CylinderGeometry(r, r, 0.105, 8, 1, true, t0, tl);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    if (side > 0) uv.setXY(i, 1 - v, u);
    else uv.setXY(i, v, 1 - u);
  }
  return g;
}

function bodyParts(v2) {
  return built('disq-corps-' + (v2 ? 2 : 1), (add, own) => {
    const keep = (g) => { own.push(g); return g; };
    // --- moteur laqué
    const motor = keep(new THREE.LatheGeometry([
      [0.001, -0.152], [0.024, -0.15], [0.042, -0.145], [0.054, -0.136], [0.062, -0.122], [0.066, -0.104], [0.067, -0.085],
      [0.067, 0.115], [0.064, 0.14], [0.058, 0.16], [0.05, 0.172], [0.001, 0.172],
    ].map(([r, y]) => new THREE.Vector2(r, y)), 18));
    add('paint', motor, [0, AX, 0], [HP, 0, 0]);
    // bagues alu et bride avant
    for (const z of [-0.06, 0.128]) add('alu', G.torus(0.0675, 0.0055, 3, 18), [0, AX, z]);
    add('dark', G.torus(0.056, 0.008, 4, 20), [0, AX, 0.162]);
    // ouïes de refroidissement lumineuses (pas sous le moteur, où se trouve la poignée)
    for (let i = -4; i <= 4; i++) {
      const a = i * 0.6;
      const pos = (r) => [Math.sin(a) * r, AX + Math.cos(a) * r, -0.097];
      add('dark', G.box(0.015, 0.008, 0.046), pos(0.064), [0, 0, -a]);
      add('glow', G.box(0.007, 0.006, 0.036), pos(0.067), [0, 0, -a]);
    }
    // calotte arrière : grille sombre et fentes lumineuses (lisible de dos)
    add('dark', G.cyl(0.044, 0.046, 0.01, 20), [0, AX, -0.146], [HP, 0, 0]);
    for (const y of [-0.016, 0, 0.016]) {
      add('glow', G.box(0.056 - Math.abs(y) * 0.9, 0.007, 0.004), [0, AX + y, -0.151]);
      add('alu', G.box(0.07 - Math.abs(y) * 0.9, 0.004, 0.003), [0, AX + y + 0.008, -0.152]);
    }
    // interrupteur à glissière, voyant
    add('dark', G.box(0.026, 0.014, 0.1), [0, AX + 0.063, 0.025]);
    add('paint', G.rbox(0.032, 0.02, 0.034, 0.007, 1), [0, AX + 0.073, 0.052]);
    add('alu', G.box(0.026, 0.003, 0.004), [0, AX + 0.084, 0.044]);
    add('alu', G.box(0.026, 0.003, 0.004), [0, AX + 0.084, 0.06]);
    // jauge de régime : trois segments lumineux dans un cadre
    add('dark', G.box(0.022, 0.012, 0.038), [0, AX + 0.063, 0.103]);
    for (const z of [0.091, 0.103, 0.115]) add('glow', G.box(0.014, 0.004, 0.008), [0, AX + 0.069, z]);
    // autocollants « queues touffues »
    add('sticker', keep(stickerGeometry(1)), [0, AX, 0.034], [HP, 0, 0]);
    add('sticker', keep(stickerGeometry(-1)), [0, AX, 0.034], [HP, 0, 0]);

    // --- poignée pistolet
    add('paint', G.rbox(0.056, 0.04, 0.1, 0.012, 1), [0, 0.0, -0.025]);
    const grip = mtx([0, -0.085, -0.035], [-0.25, 0, 0]);
    add('rubber', G.rbox(0.05, 0.15, 0.064, 0.02, 1), [0, 0, 0], [0, 0, 0], 1, grip);
    for (const y of [-0.042, -0.006, 0.03]) add('rubber', G.cyl(0.008, 0.008, 0.054, 6), [0, y, 0.03], [0, 0, HP], 1, grip);
    for (const x of [-0.026, 0.026]) add('dark', G.box(0.004, 0.1, 0.042), [x, -0.005, -0.006], [0, 0, 0], 1, grip);
    add('dark', G.rbox(0.058, 0.02, 0.074, 0.008, 1), [0, -0.08, 0], [0, 0, 0], 1, grip);
    // gâchette et pontet
    add('paint', G.box(0.014, 0.044, 0.016), [0, -0.038, 0.036], [0.3, 0, 0]);
    add('dark', G.box(0.012, 0.008, 0.07), [0, -0.074, 0.03]);
    add('dark', G.box(0.012, 0.062, 0.008), [0, -0.046, 0.064]);

    // --- cordon qui pend et sa prise
    add('rubber', G.cyl(0.01, 0.014, 0.034, 10), [0, AX - 0.024, -0.158], [-HP - 0.5, 0, 0]);
    const cord = new THREE.CatmullRomCurve3([
      [0, AX - 0.03, -0.17], [0, AX - 0.045, -0.192], [0.012, -0.02, -0.205], [-0.008, -0.055, -0.206], [0.01, -0.085, -0.2], [0, -0.112, -0.19],
    ].map((p) => new THREE.Vector3(...p)));
    add('rubber', keep(new THREE.TubeGeometry(cord, 20, 0.0075, 5)), [0, 0, 0]);
    add('rubber', G.rbox(0.03, 0.036, 0.022, 0.008, 1), [0, -0.13, -0.19]);
    add('dark', G.box(0.032, 0.006, 0.024), [0, -0.12, -0.19]);
    for (const x of [-0.008, 0.008]) add('alu', G.box(0.003, 0.022, 0.007), [x, -0.158, -0.19]);

    // --- tête d'engrenage en alu
    add('alu', G.rbox(0.105, 0.09, 0.15, 0.022, 2), [0, AX - 0.002, 0.235]);
    add('alu', G.cyl(0.05, 0.05, 0.09, 18), [0, AX - 0.002, BZ]);
    add('dark', G.cyl(0.042, 0.042, 0.006, 18), [0, AX + 0.045, BZ]);
    for (let i = 0; i < 4; i++) {
      const a = i * HP + Math.PI / 4;
      add('alu', G.cyl(0.006, 0.006, 0.004, 6), [Math.cos(a) * 0.032, AX + 0.049, BZ + Math.sin(a) * 0.032]);
    }
    for (const x of [-0.034, 0.034]) for (const z of [0.188, 0.262]) add('dark', G.cyl(0.0075, 0.0075, 0.006, 6), [x, AX + 0.044, z]);
    // ouïes latérales et bouton de blocage de broche
    for (const x of [-0.053, 0.053]) for (const y of [-0.018, 0, 0.018]) add('dark', G.box(0.006, 0.008, 0.06), [x, AX + y, 0.225]);
    // support de broche et collier du carter (repère de la lame, incliné)
    const H = mtx([0, BY, BZ], [TILT, 0, 0]);
    add('alu', G.cyl(0.032, 0.036, 0.04, 16), [0, 0.038, 0], [0, 0, 0], 1, H);
    add('alu', G.torus(0.036, 0.006, 4, 14), [0, 0.022, 0], [HP, 0, 0], 1, H);
    add('paint', G.box(0.05, 0.01, 0.014), [-0.052, 0.022, -0.022], [0, -0.7, 0], 1, H);
    add('dark', G.cyl(0.006, 0.006, 0.016, 6), [-0.032, 0.022, -0.008], [0, 0, HP], 1, H);

    // --- poignée latérale vissée sur le côté droit, relevée
    const hb = [0.052, AX, 0.245], hr = -1.134, d = [Math.sin(-hr), Math.cos(hr)];
    const at = (t) => [hb[0] + d[0] * t, hb[1] + d[1] * t, hb[2]];
    add('dark', G.cyl(0.017, 0.019, 0.014, 12), at(0.006), [0, 0, hr]);
    add('dark', G.cyl(0.008, 0.008, 0.03, 8), at(0.026), [0, 0, hr]);
    add('rubber', G.cyl(0.021, 0.018, 0.085, 14), at(0.08), [0, 0, hr]);
    for (const t of [0.062, 0.098]) add('dark', G.cyl(0.0228, 0.0222, 0.006, 14), at(t), [0, 0, hr]);
    add('paint', G.cyl(0.02, 0.023, 0.012, 14), at(0.128), [0, 0, hr]);

    // --- carter de protection (couvre l'arrière de la lame)
    // secteur arrière de 150° seulement : les flancs dentés de la lame dépassent, visibles de dos
    const span = Math.PI - 0.5, t0 = Math.PI - span / 2, f0 = HP - span / 2;
    const lipH = v2 ? 0.068 : 0.044, top = 0.016;
    const plate = new THREE.Shape();
    plate.absarc(0, 0, 0.182, f0, f0 + span, false);
    plate.absarc(0, 0, 0.028, f0 + span, f0, true);
    const pg = keep(new THREE.ExtrudeGeometry(plate, { depth: 0.005, bevelEnabled: false, curveSegments: 14 }));
    const pp = pg.attributes.position, pu = pg.attributes.uv;
    for (let i = 0; i < pp.count; i++) pu.setXY(i, pp.getX(i) / 0.37 + 0.5, pp.getY(i) / 0.37 + 0.5);
    add('paint', pg, [0, top, 0], [-HP, 0, 0], 1, H);
    const lip = keep(new THREE.CylinderGeometry(0.182, 0.182, lipH, 26, 1, true, t0, span));
    const uv = lip.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * lipH * 6);
    add('hazard', lip, [0, top - lipH / 2 + 0.002, 0], [0, 0, 0], 1, H);
    add('dark', keep(innerSector(0.178, lipH, 26, t0, span)), [0, top - lipH / 2 + 0.002, 0], [0, 0, 0], 1, H);
    add('alu', G.torus(0.18, 0.0045, 3, 22, span), [0, top - lipH + 0.002, 0], [-HP, 0, f0], 1, H);
    add('alu', G.torus(0.182, 0.004, 3, 22, span), [0, top + 0.004, 0], [-HP, 0, f0], 1, H);
    // rivets du carter
    for (let i = 0; i < 5; i++) {
      const a = t0 + 0.2 + (i / 4) * (span - 0.4);
      add('dark', G.cyl(0.0055, 0.0055, 0.004, 6), [Math.sin(a) * 0.164, top + 0.006, Math.cos(a) * 0.164], [0, 0, 0], 1, H);
    }

    if (v2) {
      // carter hérissé
      for (let i = 0; i < 5; i++) {
        const a = t0 + 0.3 + (i / 4) * (span - 0.6);
        add('dark', G.cone(0.011, 0.04, 6), [Math.sin(a) * 0.2, top - lipH / 2, Math.cos(a) * 0.2], [0, a - HP, -HP], 1, H);
      }
      // chargeur de lames de rechange sur le moteur
      const mz = -0.08;
      add('paint', G.rbox(0.07, 0.014, 0.1, 0.005, 1), [0, AX + 0.068, mz]);
      for (const y of [0.084, 0.095, 0.106]) add('blade', G.cyl(0.046, 0.046, 0.006, 16), [0, AX + y, mz]);
      add('alu', G.cyl(0.012, 0.012, 0.05, 10), [0, AX + 0.098, mz]);
      for (const [x, z] of [[0.04, 0.04], [-0.04, 0.04], [0.04, -0.04], [-0.04, -0.04]]) add('dark', G.cyl(0.004, 0.004, 0.05, 4), [x * 1.05, AX + 0.098, mz + z * 1.05]);
      add('dark', G.cyl(0.054, 0.054, 0.007, 16), [0, AX + 0.124, mz]);
      add('glow', G.cyl(0.02, 0.02, 0.003, 14), [0, AX + 0.128, mz]);
      // pots d'échappement chromés
      for (const sx of [-1, 1]) {
        const pm = mtx([sx * 0.046, AX + 0.035, -0.118], [-0.75, 0, -sx * 0.45]);
        add('alu', G.cyl(0.012, 0.014, 0.07, 8), [0, 0.02, 0], [0, 0, 0], 1, pm);
        add('dark', G.cyl(0.016, 0.016, 0.008, 8), [0, 0.052, 0], [0, 0, 0], 1, pm);
        add('glow', G.cyl(0.01, 0.01, 0.003, 8), [0, 0.0555, 0], [0, 0, 0], 1, pm);
      }
      // gyrophare d'alerte sur la tête d'engrenage
      add('dark', G.cyl(0.019, 0.021, 0.01, 14), [0, AX + 0.053, BZ]);
      add('glow', G.sphere(0.016, 10, 5), [0, AX + 0.062, BZ], [0, 0, 0], [1, 0.85, 1]);
    } else {
      add('paint', G.cyl(0.014, 0.014, 0.012, 12), [0, AX + 0.052, BZ]);
    }
  });
}

function bladeParts(v2) {
  return built('disq-lame-' + (v2 ? 2 : 1), (add, own) => {
    const bg = bladeGeometry();
    own.push(bg);
    const st = (Math.PI * 2) / TEETH;
    add('blade', bg, [0, 0, 0]);
    if (v2) add('blade', bg, [0, -0.024, 0], [0, st / 2, 0]);
    const low = v2 ? -0.024 : 0;
    add('dark', G.cyl(0.034, 0.034, 0.006, 16), [0, 0.007, 0]);
    if (v2) add('dark', G.cyl(0.03, 0.03, 0.016, 12), [0, -0.012, 0]);
    add('dark', G.cyl(0.026, 0.026, 0.01, 6), [0, low - 0.009, 0]);
    add('alu', G.cyl(0.012, 0.012, 0.006, 10), [0, low - 0.016, 0]);
    add('glow', G.cyl(0.007, 0.007, 0.002, 10), [0, low - 0.0195, 0]);
  });
}

export function disqueuse(v2) {
  const M = mats(v2);
  const g = new THREE.Group();
  const mesh = (parent, set) => { for (const k in set) parent.add(new THREE.Mesh(set[k], M[k])); };
  mesh(g, bodyParts(v2));
  const blade = new THREE.Group();
  blade.position.set(0, BY, BZ);
  blade.rotation.x = TILT; // ordre XYZ : la lame tourne autour de son propre Y, déjà incliné
  g.add(blade);
  mesh(blade, bladeParts(v2));
  g.userData.blade = blade;
  g.userData.bladeAxis = 'y';
  g.userData.muzzles = [new THREE.Vector3(0, BY - Math.sin(TILT) * 0.17, BZ + Math.cos(TILT) * 0.17)];
  return g;
}
