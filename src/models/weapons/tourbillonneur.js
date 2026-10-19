// Tourbillonneur (+ la tornade) : modèle tenu en main (canon vers +Z) et allié déployé.
// Souffleuse-jouet à turbine : grosse nacelle à hélice (spirale blanche sur le cône), tornade miniature en bocal,
// manche à air rayée. v2 « Ouragan de Poche » : deux bocaux sur les flancs (deux tornades), double étage d'hélice,
// dents à l'entrée d'air, aileron dorsal et ailerons latéraux.
import * as THREE from 'three';
import { G, part, joint, mtx, mergeGeometries } from '../geo.js';
import { mat, glow, globalU } from '../../engine/materials.js';
import { paintedMetalTexture } from '../../engine/textures.js';
import { fxLayer } from '../../engine/particles/shared.js';

const HP = Math.PI / 2, TAU = Math.PI * 2;

// ------------------------------------------------------------------ aides : pièces rigides fusionnées
const CACHE = new Map();
function merged(key, make) {
  let g = CACHE.get(key);
  if (!g) {
    const list = [];
    make(list);
    g = mergeGeometries(list);
    g.userData.shared = true;
    for (const x of list) x.dispose();
    CACHE.set(key, g);
  }
  return g;
}
// copie non indexée placée (position, rotation, échelle)
const at = (geo, p, r = [0, 0, 0], s = 1) => (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(mtx(p, r, s));
// couleur par sommet (matériau « décor » : rayures, cadrans, autocollants)
function tint(geo, hex) {
  const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
// UV ramenées au cœur de la texture peinte (loin des arêtes usées) : extrusions dont les UV sont en mètres
function midUV(geo, k = 2) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.35 + uv.getX(i) * k, 0.35 + uv.getY(i) * k);
  return geo;
}
// profil de révolution [rayon, z] autour de l'axe de la turbine (axe Z, à la hauteur Y)
const AY = 0.05;
const latheZ = (key, pts, segs = 24) => at(G.lathe('tb' + key, pts, segs), [0, AY, 0], [HP, 0, 0]);
// profils de la nacelle (rayon extérieur / intérieur selon z)
const NAC_OUT = [[0.074, 0.075], [0.09, 0.095], [0.112, 0.13], [0.13, 0.17], [0.143, 0.22], [0.152, 0.27], [0.16, 0.305], [0.165, 0.322]];
const NAC_IN = [[0.15, 0.328], [0.143, 0.3], [0.139, 0.26], [0.137, 0.21], [0.134, 0.168]];
function nacR(z) {
  for (let i = 1; i < NAC_OUT.length; i++) {
    const [r0, z0] = NAC_OUT[i - 1], [r1, z1] = NAC_OUT[i];
    if (z <= z1) return r0 + ((r1 - r0) * (z - z0)) / (z1 - z0);
  }
  return NAC_OUT[NAC_OUT.length - 1][0];
}
// point à la surface d'un cylindre d'axe Z (rayon r, angle a depuis +X), décalé de dz
const onAxis = (r, a, z) => new THREE.Vector3(Math.cos(a) * r, AY + Math.sin(a) * r, z);
// tube le long de points
const tube = (pts, r, segs = 24, rad = 5) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segs, r, rad, false);

// pale vrillée et un peu cintrée (de r0 à r1 dans le plan XY, épaisseur en Z), tournée de a autour de Z
function bladeGeo(r0, r1, w, pitch, a) {
  const g = new THREE.BoxGeometry(w, r1 - r0, 0.006, 1, 3, 1).translate(0, (r0 + r1) / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), f = (y - r0) / (r1 - r0);
    let x = p.getX(i) * (1 + f * 0.6), z = p.getZ(i);
    const t = pitch * (1 - f * 0.45);
    const c = Math.cos(t), s = Math.sin(t);
    [x, z] = [x * c - z * s, x * s + z * c];
    x += 0.022 * f * f;
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  g.rotateZ(a);
  return g;
}

// tornade miniature dans un bocal : deux hélices évasées (axe Y, base à l'origine)
function miniTwister(L, p, h) {
  for (const ph of [0, Math.PI]) {
    const pts = [];
    for (let i = 0; i <= 28; i++) {
      const f = i / 28, a = ph + f * TAU * 2.6, r = 0.004 + f * f * 0.019;
      pts.push(new THREE.Vector3(p[0] + Math.cos(a) * r, p[1] + f * h, p[2] + Math.sin(a) * r));
    }
    L.push(at(tube(pts, 0.0032, 16, 3), [0, 0, 0]));
  }
}

// bocal à tornade : verre, bagues d'acier, barreaux de cage (base au point p, axe Y incliné de rz)
function jar(M, g, p, rz, v2) {
  const j = joint(g, p);
  j.rotation.z = rz;
  const k = v2 ? 'v' : 'b';
  part(j, merged('tb-jarS' + k, (L) => {
    L.push(at(G.cyl(0.038, 0.04, 0.016, 12), [0, 0.008, 0]));
    L.push(at(G.torus(0.034, 0.006, 3, 12), [0, 0.018, 0], [HP, 0, 0]));
    L.push(at(G.cyl(0.037, 0.037, 0.014, 12), [0, 0.103, 0]));
    L.push(at(G.cyl(0.012, 0.016, 0.014, 8), [0, 0.117, 0]));
    L.push(at(G.sphere(0.009, 6, 4), [0, 0.128, 0]));
  }), M.steel);
  part(j, merged('tb-jarD' + k, (L) => {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4;
      L.push(at(G.cyl(0.0035, 0.0035, 0.082, 5), [Math.cos(a) * 0.036, 0.055, Math.sin(a) * 0.036]));
    }
  }), M.dark);
  part(j, G.cyl(0.031, 0.031, 0.082, 16, true), M.glass, { p: [0, 0.055, 0] });
  part(j, merged('tb-twist', (L) => miniTwister(L, [0, 0.018, 0], 0.074)), M.glow, { shadow: false });
  return j;
}

function mats(v2) {
  const pm = paintedMetalTexture('#ffffff', 'arme-tourbillonneur', { chip: 0.22, edge: 0.7, rust: 0.02, bare: '#8e939e' });
  return {
    paint: mat(v2 ? '#2ad8a0' : '#6affc8', { map: pm.map, normalMap: pm.normalMap, normalScale: 0.6, rough: 0.3, metal: 0.25, coat: 0.9, coatRough: 0.08 }),
    dark: mat('#2b2b31', { rough: 0.36, metal: 0.75, side: THREE.DoubleSide }),
    steel: mat('#c6cad2', { rough: 0.22, metal: 0.92 }),
    rubber: mat('#1f1f23', { rough: 0.88 }),
    glow: glow(v2 ? '#4dffa0' : '#bfffe8', 2.2),
    // verre peu saturé et sombre : la finition Méga le garde transparent
    glass: mat('#5c6e6a', { transparent: true, opacity: 0.3, rough: 0.04, metal: 0.2, coat: 1 }),
    decal: mat('#ffffff', { vertexColors: true, rough: 0.4, metal: 0.05, coat: 0.6 }),
    led: glow('#ff5a3a', 2.6),
  };
}

export function tourbillonneur(v2) {
  const g = new THREE.Group();
  const M = mats(v2);
  const k = v2 ? 'v' : 'b';

  // ---- carrosserie laquée : corps du compresseur, nacelle de la turbine, boîtier de détente (+ ailerons en v2)
  part(g, merged('tb-paint' + k, (L) => {
    L.push(latheZ('body', [[0.056, -0.152], [0.064, -0.148], [0.069, -0.136], [0.071, -0.11], [0.071, 0.04], [0.075, 0.062], [0.075, 0.082]], 18));
    L.push(latheZ('nac', NAC_OUT, 24));
    L.push(at(G.rbox(0.052, 0.05, 0.12, 0.016, 1), [0, -0.012, -0.005]));
    if (v2) {
      // aileron dorsal en flèche
      const s = new THREE.Shape();
      s.moveTo(-0.16, 0); s.lineTo(0.05, 0); s.quadraticCurveTo(-0.04, 0.03, -0.1, 0.105); s.lineTo(-0.135, 0.1); s.quadraticCurveTo(-0.14, 0.04, -0.16, 0);
      const fin = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1, curveSegments: 6 });
      L.push(at(midUV(fin), [0.006, AY + 0.062, 0], [0, -HP, 0]));
      // ailerons latéraux de la nacelle
      // (forme : x vers l'extérieur, y le long de l'axe ; l'épaisseur part vers le bas)
      for (const sx of [-1, 1]) {
        const f = new THREE.Shape();
        f.moveTo(0, 0.275); f.quadraticCurveTo(sx * 0.035, 0.2, sx * 0.085, 0.1); f.lineTo(sx * 0.07, 0.088); f.quadraticCurveTo(sx * 0.03, 0.11, 0, 0.13); f.closePath();
        const fg = new THREE.ExtrudeGeometry(f, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1, curveSegments: 5 });
        L.push(at(midUV(fg), [sx * 0.118, AY + 0.004, 0], [HP, 0, 0]));
      }
    }
  }), M.paint);

  // ---- métal sombre : intérieur de la nacelle, stator, grille arrière, garde de détente, bagues de durite
  part(g, merged('tb-dark' + k, (L) => {
    L.push(latheZ('nacIn', NAC_IN, 24));
    L.push(at(G.cyl(0.135, 0.135, 0.008, 20), [0, AY, 0.166], [HP, 0, 0]));
    L.push(at(G.cyl(0.044, 0.05, 0.05, 16), [0, AY, 0.19], [HP, 0, 0]));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.3;
      L.push(at(G.box(0.085, 0.022, 0.006), [Math.cos(a) * 0.09, AY + Math.sin(a) * 0.09, 0.182], [0.5, 0, a], 1));
    }
    // arrière : fond de grille et lamelles devant la lueur
    L.push(at(G.cyl(0.058, 0.058, 0.008, 18), [0, AY, -0.142], [HP, 0, 0]));
    for (const y of [-0.03, -0.015, 0, 0.015, 0.03]) {
      const w = Math.sqrt(0.056 * 0.056 - y * y) * 2;
      L.push(at(G.box(w, 0.006, 0.012), [0, AY + y, -0.153], [0.5, 0, 0]));
    }
    // évents latéraux du corps
    for (const sx of [-1, 1]) for (const z of [-0.1, -0.075, -0.05]) L.push(at(G.box(0.012, 0.03, 0.01), [sx * 0.066, AY - 0.012, z]));
    // garde de détente
    L.push(at(G.torus(0.032, 0.005, 4, 12, Math.PI * 0.95), [0, -0.04, 0.025], [0, HP, Math.PI * 0.55]));
    if (v2) {
      // dents d'entrée d'air
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU + 0.31;
        L.push(at(G.cone(0.013, 0.04, 4), [Math.cos(a) * 0.158, AY + Math.sin(a) * 0.158, 0.348], [HP, a, 0]));
      }
      // berceaux des bocaux latéraux
      for (const sx of [-1, 1]) L.push(at(G.box(0.04, 0.03, 0.06), [sx * 0.072, AY - 0.04, -0.075]));
    }
  }), M.dark);

  // ---- acier : lèvre de la nacelle, bagues, rivets, détente, grille de protection, mât de la manche à air
  part(g, merged('tb-steel' + k, (L) => {
    L.push(at(G.torus(0.157, 0.014, 5, 24), [0, AY, 0.326]));
    L.push(at(G.torus(0.076, 0.008, 4, 18), [0, AY, 0.075]));
    L.push(at(G.torus(0.06, 0.008, 4, 16), [0, AY, -0.15]));
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + 0.35;
      L.push(at(G.sphere(0.0065, 5, 3), onAxis(nacR(0.13) + 0.002, a, 0.13).toArray()));
    }
    for (let i = 0; i < 4; i++) L.push(at(G.sphere(0.006, 5, 3), onAxis(0.06, (i / 4) * TAU + Math.PI / 4, -0.158).toArray()));
    // grille de protection devant l'hélice
    L.push(at(G.torus(0.1, 0.0035, 3, 20), [0, AY, 0.33]));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4;
      L.push(at(G.cyl(0.003, 0.003, 0.135, 4), onAxis(0.088, a, 0.33).toArray(), [0, 0, a + HP]));
    }
    L.push(at(G.cyl(0.024, 0.024, 0.008, 14), [0, AY, 0.332], [HP, 0, 0]));
    // détente
    L.push(at(G.box(0.012, 0.042, 0.012), [0, -0.05, 0.035], [0.35, 0, 0]));
    // mât de la manche à air sur la nacelle
    L.push(at(G.cyl(0.005, 0.006, 0.08, 6), [0, AY + nacR(0.2) + 0.035, 0.2]));
    L.push(at(G.torus(0.02, 0.003, 3, 10), [0, AY + nacR(0.2) + 0.07, 0.19], [0, 0, 0]));
    // raccords de la durite
    L.push(at(G.cyl(0.016, 0.016, 0.02, 10), [0.05, -0.02, -0.03], [HP, 0, 0]));
    L.push(at(G.cyl(0.016, 0.016, 0.02, 10), [0.035, AY - nacR(0.2) + 0.012, 0.2], [HP, 0, 0]));
    if (!v2) for (const z of [-0.09, -0.05]) L.push(at(G.cyl(0.006, 0.006, 0.02, 6), [0, AY + 0.072, z]));
  }), M.steel);

  // ---- caoutchouc : poignée à crans, durite, tampon arrière
  part(g, merged('tb-rubber' + k, (L) => {
    L.push(at(G.rbox(0.05, 0.15, 0.062, 0.02, 1), [0, -0.085, -0.045], [-0.3, 0, 0]));
    for (let i = 0; i < 3; i++) L.push(at(G.cyl(0.012, 0.012, 0.054, 8), [0, -0.06 - i * 0.034, -0.005 - i * 0.01], [0, 0, HP]));
    L.push(at(G.box(0.058, 0.018, 0.072), [0, -0.16, -0.07], [-0.3, 0, 0]));
    L.push(at(tube([new THREE.Vector3(0.05, -0.02, -0.02), new THREE.Vector3(0.078, -0.055, 0.05), new THREE.Vector3(0.07, -0.085, 0.13), new THREE.Vector3(0.035, AY - nacR(0.2) + 0.012, 0.19)], 0.011, 14, 5), [0, 0, 0]));
    for (let i = 0; i < 3; i++) L.push(at(G.torus(0.013, 0.0035, 3, 8), [0.075, -0.068 + i * 0.006, 0.075 + i * 0.03], [HP - 0.3, 0.25, 0]));
  }), M.rubber);

  // ---- décor : bandeau blanc de la nacelle, manche à air rayée, cadran, spirale autocollante
  part(g, merged('tb-decal' + k, (L) => {
    const b0 = 0.24, b1 = 0.256;
    L.push(tint(latheZ('band', [[nacR(b0) + 0.0015, b0], [nacR(b1) + 0.0015, b1]], 24), '#f4f1ea'));
    // manche à air : quatre anneaux alternés, un peu tombante et ondulée
    const sock = joint(null, [0, AY + nacR(0.2) + 0.07, 0.19]);
    const n = v2 ? 5 : 4, len = v2 ? 0.035 : 0.032;
    for (let i = 0; i < n; i++) {
      const r0 = 0.02 - i * 0.0026, r1 = 0.02 - (i + 1) * 0.0026;
      const lg = new THREE.LatheGeometry([new THREE.Vector2(r0, i * len), new THREE.Vector2(r1, (i + 1) * len)], 10);
      const p = lg.attributes.position;
      for (let j = 0; j < p.count; j++) p.setX(j, p.getX(j) + Math.sin(p.getY(j) * 40) * 0.004);
      lg.computeVertexNormals();
      const ga = at(lg, [0, -0.002, 0], [-HP - 0.22, 0, 0]);
      ga.applyMatrix4(mtx(sock.position.toArray()));
      L.push(tint(ga, i % 2 ? '#f4f1ea' : v2 ? '#e8303a' : '#ff7a1a'));
      lg.dispose();
    }
    // cadran de pression (côté gauche) : fond blanc, zone rouge, aiguille
    const gp = [-0.071, AY + 0.012, -0.075];
    L.push(tint(at(G.cyl(0.021, 0.021, 0.006, 16), gp, [0, 0, HP]), '#f4f1ea'));
    L.push(tint(at(G.torus(0.015, 0.003, 3, 10, 1.4), [gp[0] - 0.0035, gp[1], gp[2]], [0, -HP, 0.2]), '#e8303a'));
    L.push(tint(at(G.box(0.003, 0.003, 0.017), [gp[0] - 0.0045, gp[1] + 0.004, gp[2] + 0.004], [0.9, 0, 0]), '#1d1a22'));
    // spirale autocollante (côté droit), posée sur le corps cylindrique
    const sp = [];
    for (let i = 0; i <= 40; i++) {
      const f = i / 40, a = f * TAU * 2.2, r = 0.004 + f * 0.024;
      const dy = Math.sin(a) * r, dz = Math.cos(a) * r;
      sp.push(onAxis(0.0735, dy / 0.0735, -0.045 + dz));
    }
    L.push(tint(at(tube(sp, 0.0028, 24, 3), [0, 0, 0]), '#f4f1ea'));
    if (v2) {
      // bandes de danger sur l'aileron dorsal
      for (let i = 0; i < 3; i++) L.push(tint(at(G.box(0.016, 0.012, 0.022), [0, AY + 0.075 + i * 0.022, -0.125 + i * 0.01]), i % 2 ? '#1d1a22' : '#ffc21a'));
    }
  }), M.decal);

  // ---- lueurs : fond de la grille arrière, voyants
  part(g, G.cyl(0.05, 0.05, 0.004, 20), M.glow, { p: [0, AY, -0.147], r: [HP, 0, 0], shadow: false });
  part(g, merged('tb-leds' + k, (L) => {
    for (let i = 0; i < 2; i++) L.push(at(G.sphere(0.0065, 6, 4), [0.045, AY + 0.056, -0.02 + i * 0.022]));
  }), M.glow, { shadow: false });
  part(g, G.sphere(0.0065, 6, 4), M.led, { p: [0.045, AY + 0.056, 0.024], shadow: false });

  // ---- bocaux à tornade : un sur le dos (base), deux sur les flancs (v2 : deux tornades)
  if (v2) for (const sx of [-1, 1]) jar(M, g, [sx * 0.088, AY - 0.03, -0.075], -sx * 0.32, v2);
  else jar(M, g, [0, AY + 0.066, -0.075], 0, v2);

  // ---- hélice (tournée par le jeu autour de Z) : pales vrillées, cône à spirale blanche, pointe lumineuse
  const blade = joint(g, [0, AY, 0.235]);
  part(blade, merged('tb-fan' + k, (L) => {
    for (let i = 0; i < 7; i++) L.push(at(bladeGeo(0.04, 0.131, 0.034, 0.75, (i / 7) * TAU), [0, 0, 0]));
    if (v2) for (let i = 0; i < 9; i++) L.push(at(bladeGeo(0.046, 0.128, 0.022, -0.7, (i / 9) * TAU + 0.2), [0, 0, -0.034]));
  }), M.steel);
  part(blade, latheZ('spin', [[0.044, 0], [0.043, 0.012], [0.038, 0.032], [0.028, 0.052], [0.014, 0.068], [0.001, 0.075]], 18), M.dark, { p: [0, -AY, -0.01] });
  const spiral = [];
  for (let i = 0; i <= 36; i++) {
    const f = i / 36, h = f * 0.064, r = (0.044 - f * f * 0.03 - f * 0.006) + 0.0015, a = f * TAU * 1.15;
    spiral.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, h - 0.006));
  }
  part(blade, merged('tb-spiral', (L) => L.push(tint(tube(spiral, 0.0045, 30, 3), '#f4f1ea'))), M.decal);
  part(blade, G.sphere(0.011, 10, 8), M.glow, { p: [0, 0, 0.064], shadow: false });

  g.userData.blade = blade;
  g.userData.bladeAxis = 'z';
  g.userData.muzzles = [new THREE.Vector3(0, AY, 0.34)];
  return g;
}

// ===================================================================== la tornade
// Effet additif sans écriture de profondeur (fxLayer). userData.layers est tourné par _updateTornado (weapons.js) :
// la couche i tourne de (6 + 3i) rad/s. 0 : débris (opaques, qui culbutent) et poussière au sol ; 1 : entonnoir
// extérieur ; 2 : rubans de vent ; 3 : cœur. Les motifs défilent aussi dans les shaders (temps du jeu).
const TT = { value: 0 };
const tick = () => { TT.value = globalU.uTime.value || performance.now() / 1000; };
const H = 4.6;
const PROF = { outer: [0.34, 2.25, 1.7], inner: [0.13, 1.05, 1.45] };
const rad = (pr, t) => pr[0] + (pr[1] - pr[0]) * Math.pow(t, pr[2]);
// entonnoir déformé : le milieu se décale (la rotation des couches le fait onduler)
const bendX = (b, t) => b * Math.sin(t * Math.PI * 0.85);
const bendZ = (b, t) => b * 0.6 * Math.sin(t * Math.PI * 1.4);

const FRAG = {
  // stries en spirale qui montent, plus denses vues par la tranche
  shell: `
  float sw = vTw.x * uP.x + vTw.y * uP.y - uT * uP.z;
  float st = 0.5 + 0.5 * sin(sw * 6.2832);
  float st2 = 0.5 + 0.5 * sin((vTw.x * (uP.x * 2.0 + 1.0) - vTw.y * uP.y * 0.55 + uT * uP.z * 0.7) * 6.2832);
  float streak = smoothstep(0.35, 0.97, st) * (0.4 + 0.6 * st2);
  float fade = smoothstep(0.0, 0.07, vTw.y) * (1.0 - smoothstep(0.72, 1.0, vTw.y));
  float fr = 1.0 - abs(dot(normalize(vVN), normalize(vVV)));
  diffuseColor.rgb *= 0.7 + 1.0 * streak;
  diffuseColor.a *= (0.12 + streak) * fade * (0.25 + 1.2 * fr * fr) * uP.w;`,
  // rubans : bord adouci, extrémités effilées, bouffées qui filent le long du ruban
  ribbon: `
  float k = floor(vTw.y);
  float across = smoothstep(0.0, 0.7, 1.0 - abs(fract(vTw.y) * 2.0 - 1.0));
  float along = sin(vTw.x * 3.1416);
  float d = fract(vTw.x * 1.6 - uT * uP.z + k * 0.37);
  float puff = smoothstep(0.0, 0.12, d) * (1.0 - smoothstep(0.25, 0.9, d));
  diffuseColor.rgb *= 0.8 + puff;
  diffuseColor.a *= across * along * (0.12 + puff) * uP.w;`,
  // poussière au sol : volutes qui tournent, anneau adouci
  dust: `
  float sw = vTw.x * uP.x + vTw.y * uP.y - uT * uP.z;
  float s1 = 0.5 + 0.5 * sin(sw * 6.2832);
  float s2 = 0.5 + 0.5 * sin((vTw.x * 2.0 - uT * 0.3) * 6.2832);
  float ring = smoothstep(0.0, 0.25, vTw.y) * (1.0 - smoothstep(0.4, 1.0, vTw.y));
  diffuseColor.a *= ring * (0.3 + 0.7 * s1 * s1 * (0.5 + 0.5 * s2)) * uP.w;`,
};

// matériaux partagés par toutes les tornades (le jeu ne libère rien en fin de vie)
const SWIRL = new Map();
function swirlMat(key, kind, color, p) {
  if (SWIRL.has(key)) return SWIRL.get(key);
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const uP = { value: new THREE.Vector4(...p) };
  m.onBeforeCompile = (s) => {
    s.uniforms.uT = TT;
    s.uniforms.uP = uP;
    s.vertexShader = 'varying vec2 vTw;\nvarying vec3 vVN, vVV;\n' + s.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vTw = uv; vVV = -mvPosition.xyz; vVN = normalMatrix * normal;');
    s.fragmentShader = 'uniform float uT;\nuniform vec4 uP;\nvarying vec2 vTw;\nvarying vec3 vVN, vVV;\n' + s.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG[kind]);
  };
  m.customProgramCacheKey = () => 'arme-tornade-' + kind;
  m.userData.shared = true;
  SWIRL.set(key, m);
  return m;
}

// grille (u autour, v en hauteur) de l'entonnoir
function funnelGeo(pr, bend, S = 32, R = 16) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= R; j++) {
    const t = j / R, r = rad(pr, t), cx = bendX(bend, t), cz = bendZ(bend, t);
    for (let i = 0; i <= S; i++) {
      const a = (i / S) * TAU;
      pos.push(cx + Math.cos(a) * r, t * H, cz + Math.sin(a) * r);
      uv.push(i / S, t);
    }
  }
  for (let j = 0; j < R; j++) for (let i = 0; i < S; i++) {
    const a = j * (S + 1) + i, b = a + S + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// rubans hélicoïdaux autour de l'entonnoir (uv.y = n° du ruban + travers)
function ribbonsGeo(n, seed, bend) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pos = [], uv = [], idx = [];
  const SEG = 36;
  for (let k = 0; k < n; k++) {
    const t0 = 0.04 + rnd() * 0.4, t1 = Math.min(0.96, t0 + 0.35 + rnd() * 0.3);
    const turns = 0.9 + rnd() * 0.8, ph = rnd() * TAU, out = 0.12 + rnd() * 0.3, w = 0.1 + rnd() * 0.12;
    const base = pos.length / 3;
    for (let i = 0; i <= SEG; i++) {
      const f = i / SEG, t = t0 + (t1 - t0) * f, a = ph - f * turns * TAU;
      const r = rad(PROF.outer, t) + out * (0.5 + t);
      const x = bendX(bend, t) + Math.cos(a) * r, z = bendZ(bend, t) + Math.sin(a) * r, y = t * H;
      const ww = w * (0.6 + t);
      pos.push(x, y - ww / 2, z, x, y + ww / 2, z);
      uv.push(f, k + 0.001, f, k + 0.999);
    }
    for (let i = 0; i < SEG; i++) {
      const a = base + i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// anneau de poussière au sol, bord relevé
function dustGeo(S = 32, R = 5) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= R; j++) {
    const f = j / R, r = 0.3 + f * 2.3, y = 0.04 + f * f * 0.55;
    for (let i = 0; i <= S; i++) {
      const a = (i / S) * TAU;
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      uv.push(i / S, f);
    }
  }
  for (let j = 0; j < R; j++) for (let i = 0; i < S; i++) {
    const a = j * (S + 1) + i, b = a + S + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// débris aspirés : cailloux, planches, écrous, boulons, caisse, panneau « attention » ; chaque pièce culbute autour
// de son centre (attribut aSpin = centre + vitesse) dans le shader
let debrisMat = null;
function getDebrisMat() {
  if (debrisMat) return debrisMat;
  const m = mat('#ffffff', { vertexColors: true, rough: 0.6, metal: 0.25, unique: true });
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (s, r) => {
    prev.call(m, s, r);
    s.uniforms.uT = TT;
    s.vertexShader = s.vertexShader
      .replace('void main() {', `uniform float uT;
attribute vec4 aSpin;
mat3 tornRot(vec3 k, float a) {
  float c = cos(a), s = sin(a);
  mat3 K = mat3(0.0, k.z, -k.y, -k.z, 0.0, k.x, k.y, -k.x, 0.0);
  return mat3(1.0) + s * K + (1.0 - c) * K * K;
}
void main() {`)
      .replace('#include <beginnormal_vertex>', `float tA = uT * aSpin.w + aSpin.x * 3.1;
  mat3 tR = tornRot(normalize(vec3(sin(aSpin.w * 7.0), 0.6, cos(aSpin.w * 5.0))), tA);
  vec3 objectNormal = tR * vec3(normal);`)
      .replace('#include <begin_vertex>', `vec3 transformed = aSpin.xyz + tR * (position - aSpin.xyz);
  transformed.y += sin(uT * 2.3 + aSpin.w * 9.0) * 0.18;`);
  };
  const pk = m.customProgramCacheKey;
  m.customProgramCacheKey = () => pk.call(m) + '-arme-debris';
  m.userData.shared = true;
  debrisMat = m;
  return m;
}

function debrisGeo(v2) {
  return merged('tb-debris' + (v2 ? 'v' : 'b'), (L) => {
    let s = v2 ? 977 : 331;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const kinds = ['rock', 'rock', 'plank', 'nut', 'rock', 'bolt', 'crate', 'plank', 'nut', 'leaf', 'rock', 'sign', 'leaf', 'nut', 'plank', 'bolt', 'rock', 'leaf'];
    const n = v2 ? 18 : 14;
    for (let i = 0; i < n; i++) {
      const t = 0.08 + (i / n) * 0.8 + rnd() * 0.05, a = rnd() * TAU, r = rad(PROF.outer, t) * (0.75 + rnd() * 0.35);
      const c = [bendX(0.25, t) + Math.cos(a) * r, t * H, bendZ(0.25, t) + Math.sin(a) * r];
      const rot = [rnd() * 3, rnd() * 3, rnd() * 3];
      const sc = 1.1 + t * 0.8;
      const pieces = [];
      switch (kinds[i]) {
        case 'rock': pieces.push(tint(at(G.ico(0.1 + rnd() * 0.08, 0), c, rot, [sc, sc * 0.75, sc]), rnd() > 0.5 ? '#8a7a68' : '#a39078')); break;
        case 'plank': pieces.push(tint(at(G.box(0.5, 0.05, 0.12), c, rot, sc), '#a8703f')); break;
        case 'nut': pieces.push(tint(at(G.nut(0.09, 0.05), c, rot, sc), rnd() > 0.5 ? '#ffc83a' : '#c9d2e3')); break;
        case 'bolt': pieces.push(tint(at(G.bolt(0.07), c, rot, sc), '#c9d2e3')); break;
        case 'leaf': pieces.push(tint(at(G.box(0.16, 0.012, 0.1), c, rot, sc), rnd() > 0.5 ? '#7ab84a' : '#e0b040')); break;
        case 'crate': {
          const m = mtx(c, rot, sc);
          pieces.push(tint(G.box(0.26, 0.26, 0.26).toNonIndexed().applyMatrix4(m), '#c08a50'));
          for (const y of [-0.1, 0.1]) pieces.push(tint(G.box(0.275, 0.04, 0.275).toNonIndexed().applyMatrix4(mtx([0, y, 0])).applyMatrix4(m), '#6a4a2a'));
          break;
        }
        case 'sign': {
          const m = mtx(c, rot, sc);
          pieces.push(tint(G.cyl(0.015, 0.015, 0.5, 5).toNonIndexed().applyMatrix4(mtx([0, -0.2, 0])).applyMatrix4(m), '#c9d2e3'));
          pieces.push(tint(G.box(0.22, 0.22, 0.02).toNonIndexed().applyMatrix4(mtx([0, 0.1, 0], [0, 0, Math.PI / 4])).applyMatrix4(m), '#ffc21a'));
          pieces.push(tint(G.box(0.03, 0.1, 0.03).toNonIndexed().applyMatrix4(mtx([0, 0.12, 0.004])).applyMatrix4(m), '#1d1a22'));
          pieces.push(tint(G.box(0.03, 0.03, 0.03).toNonIndexed().applyMatrix4(mtx([0, 0.045, 0.004])).applyMatrix4(m), '#1d1a22'));
          break;
        }
      }
      const spin = (rnd() > 0.5 ? 1 : -1) * (1.5 + rnd() * 3);
      for (const p of pieces) {
        for (const k of Object.keys(p.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) p.deleteAttribute(k);
        const cnt = p.attributes.position.count, sp = new Float32Array(cnt * 4);
        for (let v = 0; v < cnt; v++) sp.set([c[0], c[1], c[2], spin], v * 4);
        p.setAttribute('aSpin', new THREE.BufferAttribute(sp, 4));
        L.push(p);
      }
    }
  });
}

// géométries partagées par toutes les tornades (construites au premier appel)
const TGEO = new Map();
function tgeo(key, make) {
  if (!TGEO.has(key)) { const g = make(); g.userData.shared = true; TGEO.set(key, g); }
  return TGEO.get(key);
}

export function tornadoModel(v2) {
  const g = new THREE.Group();
  const col = new THREE.Color(v2 ? '#7affd0' : '#d8fff0');
  const k = v2 ? 'v' : 'b';
  const mesh = (parent, geo, m) => { const o = new THREE.Mesh(geo, m); o.castShadow = false; parent.add(o); return o; };

  // 0 : débris qui culbutent + poussière soulevée au sol
  const l0 = new THREE.Group();
  mesh(l0, debrisGeo(v2), getDebrisMat());
  mesh(l0, tgeo('dust', () => dustGeo()), swirlMat('dust', 'dust', new THREE.Color('#f0e2c4').multiplyScalar(0.55), [4, 1.5, 0.9, 1]));
  // 1 : entonnoir extérieur
  const l1 = new THREE.Group();
  const shell = mesh(l1, tgeo('outer', () => funnelGeo(PROF.outer, 0.25)), swirlMat('outer' + k, 'shell', col.clone().multiplyScalar(0.85), [6, 2.2, 0.55, 0.95]));
  // 2 : rubans de vent
  const l2 = new THREE.Group();
  mesh(l2, tgeo('rib' + k, () => ribbonsGeo(v2 ? 8 : 6, v2 ? 91 : 47, 0.25)), swirlMat('rib' + k, 'ribbon', col.clone().lerp(new THREE.Color('#ffffff'), 0.5).multiplyScalar(1.1), [0, 0, 0.9, 1]));
  // 3 : cœur, plus serré et plus vif
  const l3 = new THREE.Group();
  mesh(l3, tgeo('inner', () => funnelGeo(PROF.inner, 0.38, 24, 14)), swirlMat('inner' + k, 'shell', col.clone().multiplyScalar(1.25), [4, 3, 0.9, 0.9]));
  shell.onBeforeRender = tick;
  for (const l of [l0, l1, l2, l3]) g.add(l);
  g.userData.layers = [l0, l1, l2, l3];
  return fxLayer(g);
}
