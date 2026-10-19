// Planète 5 — Station Goinfre : l'usine orbitale du Baron Vorax, et le combat final contre le Goinfrotron.
import * as THREE from 'three';
import { lights } from '../engine/lightpool.js';
import { deck, neonStrip, tank, crate3, vertPipe, stationMats, railing, furnace, smokestack, ladleGantry, embers, overheadPipe, rack, forklift, trussRoof, travellingCrane, floorLine, console3, holoBenne, banner, voraxGate, canopy, coolantPool, coolingTower, steamVent, lightBeam, windowShafts, beacon } from '../models/environment/station.js';
import { container, lamp, barrel, kobiShip, rivets, rboxAt, boxAt, mergeParts, grime, beam as tube } from '../models/environment/props.js';
import { Arena } from '../game/arena.js';
import { G, part, joint, mtx, mergeGeometries } from '../models/geo.js';
import { mat, glow } from '../engine/materials.js';
import { crateTexture, hullTexture, paintedMetalTexture, treadPlateTexture } from '../engine/textures.js';
import { BoxCollider, CylinderCollider } from '../engine/physics.js';
import { rand, clamp, rng as mkRng } from '../engine/util.js';
import { boxUV } from './level.js';
import { motes } from '../models/nature.js';
import { createWater, waterImpulse } from '../engine/water/water.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _vB = new THREE.Vector3();

export default {
  id: 'station',
  name: 'Station Goinfre',
  subtitle: 'L’usine orbitale du Baron',
  orb: 'radial-gradient(circle at 35% 30%, #d0d6ff, #6a4ad6 40%, #1e1240 90%)',
  mapPos: [86, 60],
  music: 'station',
  build(L, g) {
    const props = g.props;
    const M = stationMats();
    const D4 = stationMats();
    L.environment({
      skyTop: '#06051a', skyHorizon: '#2c1450', skyBottom: '#0c0820', sunDir: [-0.45, 0.42, -0.79], sunColor: '#dfe8ff',
      clouds: 0, stars: 1.4, nebula: 1.0, sunHalo: 0.55, nebulaA: '#ff4fa0', nebulaB: '#3a6aff',
      planetDir: [0.35, -0.18, 0.92], planetSize: 0.55, planetA: '#3a8ac0', planetB: '#b0f0ff', ring: 0,
      moonDir: [-0.6, 0.3, 0.74], moonSize: 0.04, moonColor: '#ffd0a0',
      fogColor: '#1e1036', fogNear: 120, fogFar: 760, fogBase: -25, fogFall: 0.05, fogHeight: 0.5, fogSun: 0.35, hemiSky: '#8a90ff', hemiGround: '#401a50', hemiIntensity: 0.55,
      sunIntensity: 3.0, fill: 0.5, fillColor: '#e8e0ff', envIntensity: 0.4, rimColor: '#ff9ae0', rimStrength: 0.5, dust: '#9a90b0', bloom: 0.45, exposure: 1.0, saturation: 1.2, lift: [-0.018, -0.018, -0.01],
      envGround: '#301040',
      // poussière et vapeur de la station : rais du soleil par les baies, halos des néons, sans voiler l'espace
      volumetric: { density: 0.016, floor: 0.3, sun: 0.55, lights: 1.8, anisotropy: 0.35, ambientAmount: 0.2, maxDist: 120 },
      grade: { shadows: '#3a2aa8', highlights: '#8ae4ff', amount: 0.3, contrast: 0.36 },
    });
    // lumières locales : néons, fours et coulées éclairent les dalles
    lights.gain = 1.15;
    L.killY = -40;
    L.ambient = 'machines';

    // ------------------------------------------------ D0 : sas d'arrivée
    deck(L, V(0, 0, 0), 26, 32, { underH: 30 });
    L.checkpoint = { pos: V(0, 0.3, -10), yaw: 0 };
    // toit du hangar
    for (const sx of [-1, 1]) {
      L.box(V(sx * 12.5, 4, -6), V(1, 8, 20), M.wallMetal, { surface: 'metal', uvScale: 0.18 });
      neonStrip(L, V(sx * 11.94, 7.5, -16), V(sx * 11.94, 7.5, 4), 'pink');
      // liseré au pied du mur : il se reflète dans les tôles lustrées
      neonStrip(L, V(sx * 11.94, 0.07, -15.9), V(sx * 11.94, 0.07, 3.9), 'cyan', { light: false });
    }
    L.box(V(0, 8.4, -6), V(26, 0.8, 20), M.voraxPanel, { surface: 'metal', uvScale: 0.2 });
    // mur du fond : soubassement, grande baie vitrée sur l'espace, bandeau haut
    L.box(V(0, 4, -16.5), V(26, 8, 1), null, { surface: 'metal' });
    L.box(V(0, 1, -16.5), V(26, 2, 1), M.wallMetal, { collide: false, uvScale: 0.25 });
    L.box(V(0, 7.6, -16.5), V(26, 0.8, 1), M.wallMetal, { collide: false, uvScale: 0.25 });
    // vitre sans ombre : le soleil entre en rais entre les montants de la baie
    const pane = new THREE.Mesh(G.box(26, 5.2, 0.08), mat('#9ad8ff', { rough: 0.05, metal: 0.2, transparent: true, opacity: 0.12 }));
    pane.position.set(0, 4.6, -16.6);
    pane.userData.noAO = true;
    L.root.add(pane);
    windowShafts(L, L.sunDir, { min: V(-12, 0, -16.45), max: V(12, 7.9, -1.5), z: -16.6, x0: -13, x1: 13, y0: 2, y1: 7.2, step: 4, m0: -12, bar: 4.6, intensity: 0.024 });
    for (let x = -12; x <= 12; x += 4) L.add(G.box(0.3, 5.2, 0.5), M.voraxPanel, new THREE.Matrix4().makeTranslation(x, 4.6, -16.4));
    L.add(G.box(26, 0.25, 0.5), M.voraxPanel, new THREE.Matrix4().makeTranslation(0, 4.6, -16.4));
    neonStrip(L, V(-12.8, 2.05, -15.95), V(12.8, 2.05, -15.95), 'cyan');
    // tuyauteries le long des murs du hangar : tenues au mur par des colliers à patte scellée, coude et piquage dans
    // le mur côté sas (elles s'arrêtaient en l'air au bout du mur)
    const LS = lmats(M);
    for (const sx of [-1, 1]) {
      for (const [y, r] of [[6.6, 0.22], [7.15, 0.16]]) {
        L.add(G.cyl(r, r, 19.75, 10), M.pipe, mtx([sx * 11.7, y, -6.125], [Math.PI / 2, 0, 0]));
        for (let z = -15; z <= 3; z += 4.5) L.add(G.cyl(r * 1.35, r * 1.35, 0.18, 10), M.gold, mtx([sx * 11.7, y, z], [Math.PI / 2, 0, 0]));
        L.add(G.sphere(r, 10, 8), M.pipe, mtx([sx * 11.7, y, 3.75]));
        L.add(G.cyl(r, r, 0.45, 10), M.pipe, mtx([sx * 11.925, y, 3.75], [0, 0, Math.PI / 2]));
        for (let z = -12.75; z < 2; z += 4.5) {
          L.add(G.cyl(r * 1.12, r * 1.12, 0.08, 10), LS.steel, mtx([sx * 11.7, y, z], [Math.PI / 2, 0, 0]));
          L.add(G.box(0.38, 0.07, 0.1), LS.steel, mtx([sx * 11.89, y, z]));
        }
      }
      L.add(G.cyl(0.22, 0.22, 6.6, 10), M.pipe, mtx([sx * 11.7, 3.3, -15.5]));
      for (const y of [1.8, 4.4]) {
        L.add(G.cyl(0.246, 0.246, 0.08, 10), LS.steel, mtx([sx * 11.7, y, -15.5]));
        L.add(G.box(0.38, 0.1, 0.07), LS.steel, mtx([sx * 11.89, y, -15.5]));
      }
    }
    // consoles de contrôle (écrans lumineux)
    for (const z of [-13.4, -10.2]) console3(L, V(-11.45, 0, z), Math.PI / 2);
    // ventilateur au plafond
    const fan = joint(L.root, [0, 7.8, -6]);
    for (const [mt, geo] of fanGeos(M)) part(fan, geo, mt, { shadow: mt !== LM.hull });
    // platine boulonnée au plafond
    L.add(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 16), lmats(M).steel, mtx([0, 7.975, -6]));
    for (let k = 0; k < 6; k++) L.add(G.cyl(0.04, 0.04, 0.04, 6), LM.bright, mtx([Math.cos(k * 1.047) * 0.52, 7.94, -6 + Math.sin(k * 1.047) * 0.52]));
    L.every((dt) => { fan.rotation.y += dt * 2.5; });
    props.goldBolt(V(8, 10.2, -10), 0);
    for (const [x, z] of [[-10.8, 2.5], [10.8, -3]]) steamVent(L, V(x, 0, z), { period: 5, burst: 1.3, puff: 1.1 });
    crate3(L, V(9, 0, 6), '#6a2bd0');
    crate3(L, V(9.5, 2, 6.2), '#ffcc33');
    crate3(L, V(10, 0, 8.4), '#c8452f');
    // marche fixe vers le toit du hangar (le boulon d'or y attend)
    crate3(L, V(9.5, 4, 6.1), '#2f7ac8');
    props.crate(V(11.5, 0, 9.5), 'bolt');
    tank(L, V(-9, 0, 8), 2, 5);
    props.vendor(V(-9, 0, -4), Math.PI / 2);
    props.crate(V(4, 0, -12), 'ammo');
    props.crate(V(5.2, 0, -12.4), 'ammo');
    props.crate(V(-4, 0, 2), 'bolt');
    // mât d'antenne au-dessus du toit du hangar : cristal au Propulseur
    latticeMast(L, M, V(-6, 8.8, -9), 4.2);
    // fût du mât solide ; la parabole reste traversable (elle ferait une marche vers le cristal sans Propulseur)
    g.world.add(new CylinderCollider(-6, -9, 8.8, 13, 0.5, { surface: 'metal' }));
    deck(L, V(-6, 14, -9), 3, 3, { under: false });
    neonStrip(L, V(-7.4, 14.1, -10.4), V(-4.6, 14.1, -10.4), 'cyan');
    props.orbium(V(-6, 14, -9), 0, 3);
    L.trigger({
      sphere: [[-2, 8.8, -8], 5],
      fn: () => g.hud.say([['ecrou', g.hasGadget('propulseur')
        ? 'Un cristal en haut de l’antenne ! Double saut, puis le Propulseur.'
        : 'Un cristal en haut de l’antenne… Même depuis le toit, c’est trop haut.']]),
    });
    // réserve Vorax scellée (Magnéto-clé)
    L.box(V(-12.6, 1.8, 13), V(0.6, 3.6, 6.4), M.wallMetal, { surface: 'metal', uvScale: 0.3 });
    for (const z of [10.1, 15.9]) L.box(V(-9.4, 1.8, z), V(6.8, 3.6, 0.6), M.wallMetal, { surface: 'metal', uvScale: 0.3 });
    L.box(V(-9.4, 3.85, 13), V(7, 0.5, 6.4), M.voraxPanel, { surface: 'metal', uvScale: 0.3 });
    props.magDoor(V(-6.3, 0, 13), Math.PI / 2, 4, 3);
    props.orbium(V(-10, 0, 13), 1, 3);
    L.trigger({
      sphere: [[-3.5, 0, 13], 3.5],
      fn: () => g.hud.say([['ecrou', g.hasGadget('magneto')
        ? 'La réserve du Baron, scellée par un verrou magnétique. Un coup de Magnéto-clé !'
        : 'Une réserve à verrou magnétique… On ne l’ouvrira pas à mains nues.']]),
    });
    props.sign(V(0, 0, 15.5), 0, 'VORAX INDUSTRIES\nON ASPIRE À MIEUX', 6, 1.6, { bg: '#2a0f50', fg: '#ffcc33', border: '#ff4fa0', glow: 0.8, height: 6.5, posts: true, post: '#2a2438' });
    const arrival = kobiShip(L.root);
    // patins du train posés sur les dalles (le vaisseau flottait 16 cm au-dessus) ; le volume de collision suit
    arrival.position.set(-4, 0.035, -11);
    arrival.rotation.y = 0.3;
    arrival.scale.setScalar(0.8);
    L.box(V(-4, 1.135, -11), V(2.2, 2.4, 5), null, { ry: 0.3, surface: 'metal' });
    L.titleShot = () => {};

    // ------------------------------------------------ tapis roulant à contre-courant
    // bande en caoutchouc à tasseaux et chevrons : la texture défile dans le sens de la poussée (-z)
    const { map: beltTex, normalMap: beltNrm } = beltTextures();
    const beltMat = mat('#ffffff', { map: beltTex, normalMap: beltNrm, rough: 0.62, metal: 0.1, rim: 0 });
    const belt = new THREE.Mesh(beltTop(5, 16, 50, 0), beltMat);
    belt.receiveShadow = true;
    L.root.add(belt);
    const beltCol = new BoxCollider(V(0, -0.3, 33), V(2.5, 0.3, 17), null, { surface: 'metal', conveyor: V(0, 0, -3.6) });
    g.world.add(beltCol);
    for (const sx of [-1, 1]) L.box(V(sx * 2.9, 0.1, 33), V(0.8, 1.2, 34), null, { surface: 'metal' });
    conveyorFrame(L, M, 16, 50);
    // longerons et treillis sous les flasques
    for (const sx of [-1, 1]) g.world.add(new BoxCollider(V(sx * 2.9, -1.55, 33), V(0.25, 1.05, 17), null, { surface: 'metal', blocksCamera: false }));
    // caisses qui défilent sur le tapis (décor gênant)
    const beltCrates = [];
    for (let i = 0; i < 4; i++) {
      const ct = crateTexture('boom');
      const c = new THREE.Mesh(G.rbox(1.2, 1.2, 1.2, 0.08), mat('#c9a6ff', { map: ct.map, normalMap: ct.normalMap, rough: 0.55, metal: 0.3 }));
      c.position.set(rand(-1.4, 1.4), 0.6, 18 + i * 8.5);
      c.castShadow = true;
      L.root.add(c);
      const col = new BoxCollider(c.position, V(0.6, 0.6, 0.6), null, { dynamic: true, surface: 'metal' });
      g.world.add(col);
      beltCrates.push({ c, col });
    }
    L.every((dt) => {
      beltTex.offset.y += dt * 3.6 / 4.25;
      beltNrm.offset.y = beltTex.offset.y;
      for (const b of beltCrates) {
        const old = b.c.position.clone();
        b.c.position.z -= 3.6 * dt;
        let wrapped = false;
        if (b.c.position.z < 16.5) { b.c.position.z = 49.5; b.c.position.x = rand(-1.4, 1.4); wrapped = true; }
        b.col.center.copy(b.c.position);
        b.col.update();
        if (wrapped) b.col.deltaPos.set(0, 0, 0);
        else b.col.deltaPos.subVectors(b.c.position, old);
      }
    });
    L.trigger({ box: [[-6, -2, 14], [6, 10, 18]], fn: () => {
      g.hud.say([['ecrou', 'Un tapis roulant à contre-sens ! Cours, Kobi, cours ! Et saute par-dessus les caisses.']], true);
      g.hud.objective('Remonter la chaîne de production');
    } });

    // ------------------------------------------------ D1 : fonderie (métal en fusion, presses, lasers)
    deck(L, V(0, 0, 58), 20, 16, { underH: 30, mat: D4.floorFoundry });
    props.checkpoint(V(0, 0, 53), 0);
    props.crate(V(-7, 0, 56), 'ammo');
    props.crate(V(7, 0, 60), 'bolt');
    props.crate(V(-7, 0, 61), 'health');
    // bassin de fonte avec pistons : coulée vive (croûte rare, veines blanches), brume de chaleur haute
    const fonte = createWater(L, { rect: [-10, 66, 20, 22], y: -1.2, preset: 'metal', shallow: '#ff600e', glow: '#ffe2a0', glowIntensity: 1.55, deep: '#3a2620', crust: 0.26, flow: [0.04, 0.15], heat: 2.4, heatHeight: 5.5, embers: 0 });
    g.world.add(new BoxCollider(V(0, -2.2, 77), V(10, 1, 11), null, { tag: 'lava', surface: 'lava', user: { damage: 20 }, blocksCamera: false }));
    props.lavas.push({ mesh: fonte.mesh, body: fonte, center: V(0, -1.2, 77), w: 20, d: 22 });
    // la coulée éclaire la salle : nappe au ras du bain (suit Kobi) et lueur haute sur le portique et les tuyaux
    lights.add({ pos: V(0, 2, 77), area: [20, 22], color: '#ff7424', intensity: 48, range: 17, decay: 1, flicker: 0.12, priority: 2.6 });
    lights.add({ pos: V(0, 7.5, 77), color: '#ff8a30', intensity: 50, range: 24, decay: 1, flicker: 0.08, priority: 2.2, size: 8 });
    // bulles qui crèvent la surface : anneau lent et gerbe d'escarbilles
    let bloop = 0;
    L.every((dt) => {
      bloop -= dt;
      if (bloop > 0) return;
      bloop = rand(0.35, 0.8);
      if (g.camera.cam.position.distanceTo(fonte.box.getCenter(_vB)) > 55) return;
      waterImpulse(V(rand(-9, 9), -1.2, rand(67, 87)), rand(0.04, 0.1));
    });
    for (const sx of [-1, 1]) L.box(V(sx * 10.5, -0.6, 77), V(1, 1.4, 22), M.hazard, { surface: 'metal', uvScale: 0.5 });
    L.add(G.box(20, 2, 22), M.dark, new THREE.Matrix4().makeTranslation(0, -2.4, 77));
    const piston = (x, z, phase) => {
      const pl = props.platform([[x, -1.2, z], [x, 0.6, z]], { speed: 1.4, wait: 0.9, size: V(3.2, 0.6, 3.2), color: '#ff7b2a' });
      pl.segT = phase; pl.waitT = phase * 2;
      return pl;
    };
    piston(-4, 70, 0.0);
    piston(3, 74, 0.5);
    piston(-3, 79, 0.25);
    piston(4, 83, 0.75);
    deck(L, V(0, 0, 94), 20, 12, { underH: 30, mat: D4.floorFoundry });
    // presse hydraulique au-dessus du passage
    // couloir de la presse
    for (const sx of [-1, 1]) L.box(V(sx * 6.6, 2, 94), V(6.8, 4, 4), M.voraxPanel, { surface: 'metal', uvScale: 0.3 });
    const press = new THREE.Group();
    L.root.add(press);
    press.position.set(0, 7, 94);
    part(press, G.rbox(6, 2.2, 4, 0.2), M.voraxPanel, {});
    part(press, G.box(6.1, 0.4, 4.1), M.hazard, { p: [0, -1.2, 0] });
    // fourreaux de guidage : le coulisseau glisse le long des colonnes (il pendait entre elles sans les toucher)
    for (const sx of [-1, 1]) {
      part(press, G.cyl(0.55, 0.55, 1.5, 16), lmats(M).steel, { p: [sx * 3.6, 0, 0] });
      part(press, G.box(0.5, 1.5, 0.7), lmats(M).steel, { p: [sx * 3.2, 0, 0] });
      for (const y of [-0.75, 0.75]) part(press, G.cyl(0.6, 0.6, 0.1, 16), M.gold, { p: [sx * 3.6, y, 0] });
    }
    for (const sx of [-1, 1]) part(L.root, G.cyl(0.4, 0.4, 12, 10), M.pipe, { p: [sx * 3.6, 5, 94] });
    const pressCol = new BoxCollider(press.position, V(3, 1.1, 2), null, { dynamic: true, surface: 'metal' });
    g.world.add(pressCol);
    let pressT = 0;
    L.every((dt) => {
      pressT += dt;
      const c = pressT % 3;
      const old = press.position.clone();
      let y;
      if (c < 1.6) y = 7;
      else if (c < 1.85) y = 7 - ((c - 1.6) / 0.25) * 5.9;
      else if (c < 2.3) y = 1.1;
      else y = 1.1 + ((c - 2.3) / 0.7) * 5.9;
      press.position.y = y;
      if (c >= 1.6 && c < 1.85 && (c + dt) >= 1.85) {
        g.audio.play('stomp', { pos: press.position });
        g.camera.shakeAt(press.position, 0.4);
        g.fx.dust(V(0, 0, 94), 10, '#9a90b0', 3, 1);
        const p = g.player;
        if (Math.abs(p.pos.x) < 3.2 && Math.abs(p.pos.z - 94) < 2.2 && p.pos.y < 2) {
          p.hurt(25, V(0, 0, 94), 0);
          p.pos.z = p.pos.z < 94 ? 91 : 97;
          p.vel.y = 8;
        }
      }
      if (c > 1.2 && c < 1.6 && Math.floor(c * 10) % 2 === 0) press.children[1].scale.y = 1.6; else press.children[1].scale.y = 1;
      pressCol.center.copy(press.position);
      pressCol.update();
      pressCol.deltaPos.subVectors(press.position, old);
    });
    // projecteurs d'alerte sur la presse, vapeur des bouches au sol
    for (const sx of [-1, 1]) lightBeam(L, V(sx * 3.9, 4.3, 92.2), V(sx * 0.8, 0, 89.4), { r0: 0.3, r1: 2.2, color: '#ffb84a', intensity: 0.3 });
    for (const [x, z, p] of [[8.4, 63.5, 4], [-8.4, 52.5, 5.5], [8.6, 90.3, 3.5], [-8.6, 90.3, 4.2], [-8.6, 106, 6], [8.6, 107, 5]]) steamVent(L, V(x, 0, z), { period: p, burst: 1.3, puff: 1.2 });
    // barrières laser en fin de fonderie
    const lasers = [];
    const laser = (z, y, phase) => {
      const beam = new THREE.Mesh(G.box(20, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3a6a').multiplyScalar(4) }));
      beam.position.set(0, y, z);
      L.root.add(beam);
      const post = laserPostGeos(M, y);
      for (const sx of [-1, 1]) {
        addGeos(L, post, mtx([sx * 10.2, 0, z], [0, sx > 0 ? 0 : Math.PI, 0]));
        // poteau et boîtier de l'émetteur (canon compris, tourné vers le couloir)
        g.world.add(new BoxCollider(V(sx * 10.2, 1.55, z), V(0.24, 1.55, 0.24), null, { surface: 'metal', blocksCamera: false }));
        g.world.add(new BoxCollider(V(sx * 10.12, y, z), V(0.35, 0.18, 0.25), null, { surface: 'metal', blocksCamera: false }));
      }
      lasers.push({ beam, z, y, phase });
    };
    laser(98, 0.5, 0);
    laser(99.5, 1.6, 1);
    L.every((dt, t) => {
      const p = g.player;
      for (const l of lasers) {
        const on = Math.sin(t * 2 + l.phase * Math.PI) > -0.2;
        l.beam.visible = on;
        l.beam.scale.y = 1 + Math.sin(t * 40) * 0.4;
        if (on && Math.abs(p.pos.z - l.z) < 0.4 && Math.abs(p.pos.x) < 10 && p.pos.y < l.y + 0.2 && p.pos.y + 1.3 > l.y) {
          if (p.hurt(12, V(p.pos.x, l.y, l.z + 1), 6)) g.audio.play('zapHit', { pos: p.pos, pitch: 0.7 });
        }
      }
    });
    deck(L, V(0, 0, 108), 20, 14, { underH: 30, mat: D4.floorFoundry });
    // halle de la fonderie : haut-fourneau et cheminées à gauche, portique et poche de coulée au-dessus du bassin
    deck(L, V(-19.5, -2, 77), 12, 16, { underH: 26, mat: D4.floorFoundry });
    furnace(L, V(-19.5, -2, 77), { h: 16, face: Math.PI / 2, to: V(-11.2, 0.2, 77) });
    smokestack(L, V(-23.5, -2, 71), 24, 1.3);
    smokestack(L, V(-23, -2, 83.5), 19, 1.0);
    // pieds du portique posés sur les dalles du haut-fourneau et du bac (ils plongeaient de 30 m dans le vide entre
    // les dalles et la bordure du bassin)
    ladleGantry(L, -13.85, 13.85, 77, 11, V(6.5, -1.2, 77), { hang: 5, foot: -2, phase: 2 });
    embers(L, V(0, -1.2, 77), 20, 22, 0.035);
    // bac de refroidissement face au haut-fourneau : contrepoint froid à la coulée (peu profond, Kobi y patauge)
    deck(L, V(20, -1, 77), 13, 16, { underH: 24, mat: D4.floorFoundry });
    coolantPool(L, 14.6, 70.2, 6.4, 13.6, -0.53);
    coolingTower(L, V(24, -1, 73.5), 12, 2.1);
    tank(L, V(24.2, -1, 81.5), 1.4, 3.6);
    // conduites de la halle : coudes fermés, chaque extrémité entre dans un appareil ou descend jusqu'à une dalle
    // (la conduite basse pendait dans le vide à ses deux bouts, la descente s'arrêtait 3 m au-dessus du sol)
    const LF = lmats(M);
    overheadPipe(L, V(14.3, -0.6, 79.3), V(10.9, -0.6, 79.3), 0.22);
    overheadPipe(L, V(24, 9.5, 73.5), V(24, 9.5, 65.5), 0.45);
    overheadPipe(L, V(24, 9.5, 65.5), V(16, 9.5, 65.5), 0.45);
    for (const z of [71, 83]) steamVent(L, V(25.2, -1, z + 0.5), { period: 4.5, burst: 1.4, puff: 1.3 });
    overheadPipe(L, V(-15.5, 9.5, 65.5), V(16, 9.5, 65.5), 0.45);
    for (const x of [24, -15.5]) L.add(G.sphere(0.45, 12, 8), M.pipe, mtx([x, 9.5, 65.5]));
    // descente vers la dalle du haut-fourneau, jusqu'à son manchon au sol
    overheadPipe(L, V(-15.5, 9.5, 65.5), V(-15.5, -2.3, 70.36), 0.45);
    L.add(G.cyl(0.72, 0.76, 0.5, 14), LF.steel, mtx([-15.5, -1.75, 70.13]));
    L.add(G.cyl(0.79, 0.79, 0.08, 14), M.gold, mtx([-15.5, -1.52, 70.13]));
    // conduite basse : portée au-dessus du bassin, coudes et jambes posées sur les dalles du haut-fourneau et du bac
    overheadPipe(L, V(-14, 8.2, 84.6), V(13.9, 8.2, 84.6), 0.32);
    for (const [x, y] of [[-14, -2], [13.9, -1]]) {
      overheadPipe(L, V(x, 8.2, 84.6), V(x, y, 84.6), 0.32);
      L.add(G.sphere(0.32, 12, 8), M.pipe, mtx([x, 8.2, 84.6]));
      L.add(G.cyl(0.46, 0.5, 0.12, 12), M.gold, mtx([x, y + 0.06, 84.6]));
    }
    // poteaux-supports sous les longues portées (30 m sans appui) : semelle, fût d'acier, berceau et collier ; au bout
    // des garde-corps de la première dalle et sur le bord extérieur des bordures du bassin
    const stand = (x, y0, z, yp, r) => {
      const h = yp - r - 0.1 - y0;
      L.add(G.box(0.56, 0.06, 0.56), LF.steel, mtx([x, y0 + 0.03, z]));
      L.add(G.box(0.24, h, 0.24), LF.steel, mtx([x, y0 + h / 2, z]));
      L.add(G.box(0.32, 0.14, 2 * r + 0.16), LF.steel, mtx([x, yp - r - 0.05, z]));
      L.add(G.cyl(r * 1.08, r * 1.08, 0.14, 14), LF.steel, mtx([x, yp, z], [0, 0, Math.PI / 2]));
    };
    for (const sx of [-1, 1]) {
      stand(sx * 9.95, 0, 65.5, 9.5, 0.45);
      stand(sx * 10.72, 0.1, 84.6, 8.2, 0.32);
    }
    for (const sx of [-1, 1]) {
      railing(L, V(sx * 9.95, 0, 50.5), V(sx * 9.95, 0, 65.6));
      railing(L, V(sx * 9.95, 0, 101.3), V(sx * 9.95, 0, 114.6));
    }
    L.trigger({ box: [[-10, -2, 50], [10, 10, 54]], fn: () => {
      g.enemies.spawn('larbin', V(-6, 0.2, 94));
      g.enemies.spawn('larbin', V(6, 0.2, 96), { elite: true });
      g.enemies.spawn('tourelle', V(0, 0, 112), { yaw: Math.PI });
      g.hud.say([['ecrou', 'La fonderie ! Saute de piston en piston, et attention à la presse : elle ne fait pas de quartier.']], true);
    } });
    L.trigger({ box: [[-10, -2, 100], [10, 10, 103]], fn: () => {
      ['grignoteur', 'grignoteur', 'boumboule', 'boumboule'].forEach((t, i) => g.enemies.spawn(t, V(-6 + i * 4, 0.3, 110 + (i % 2) * 2), { alert: true }));
    } });
    tank(L, V(-8, 0, 112), 1.5, 4);
    tank(L, V(8, 0, 112), 1.5, 4);
    vertPipe(L, V(-9.5, 0, 102), 10);
    vertPipe(L, V(9.5, 0, 102), 10);

    // ------------------------------------------------ rails dans le vide
    props.checkpoint(V(6, 0, 104), 0);
    const ringGrp = joint(L.root, [20, 6, 140]);
    part(ringGrp, G.torus(26, 1.2, 10, 64), M.voraxPanel, {});
    for (let i = 0; i < 12; i++) part(ringGrp, G.box(1.2, 4, 2.5), M.neonPinkSoft, { p: [Math.cos(i / 12 * Math.PI * 2) * 26, Math.sin(i / 12 * Math.PI * 2) * 26, 0], r: [0, 0, i / 12 * Math.PI * 2] });
    ringGrp.rotation.y = 0.9;
    L.every((dt) => { ringGrp.rotation.z += dt * 0.15; });
    props.rail([[0, 0.8, 115.5], [2, 0.5, 125], [10, 2, 136], [22, 4, 144], [32, 6.5, 150], [38, 9, 160], [40, 10.8, 168.5]], { speed: 16, bolts: 2.5, color: '#ff4fa0' });
    // balises qui jalonnent les rails dans le vide
    for (const [x, y, z, c, ph] of [[-3, -1.5, 121, '#3ef2ff', 0], [7.5, -0.5, 129, '#ff4fa0', 0.3], [12, 0, 141, '#3ef2ff', 0.55], [24.5, 1.5, 151, '#ff4fa0', 0.15], [36, 4, 154, '#3ef2ff', 0.7], [43, 6.5, 164, '#ff4fa0', 0.45]]) beacon(L, V(x, y, z), c, ph);
    // branche secrète vers un boulon d'or
    props.rail([[22.5, 4.6, 145.5], [16, 6, 154], [8, 8, 160], [2, 9.2, 162]], { speed: 14, bolts: 3, color: '#ffcc33', oneWay: true });
    deck(L, V(0, 9, 164), 5, 5, { underH: 10 });
    props.goldBolt(V(0, 10.4, 164), 1);
    props.jumpPad(V(0, 9, 166), V(38, 10, 176), 5);
    L.trigger({ box: [[-8, -2, 112], [8, 10, 115]], fn: () => g.hud.objective('Glisser jusqu’à l’entrepôt') });

    // ------------------------------------------------ D2 : entrepôt
    deck(L, V(40, 10, 182), 28, 26, { underH: 34, mat: D4.floorWare });
    props.checkpoint(V(40, 10, 172), 0);
    // rayonnages, chariot élévateur, charpente et pont roulant
    rack(L, V(52.9, 10, 188.5), Math.PI / 2, 10, 6, { seed: 3 });
    rack(L, V(27.1, 10, 179.5), Math.PI / 2, 8, 6, { seed: 9 });
    forklift(L, V(29.6, 10, 191.2), 0.4);
    trussRoof(L, 26.5, 53.5, 170, 194, 22.4, { step: 6, lamps: [38, 46], floor: 10 });
    for (const [x, z] of [[27.6, 195], [52.6, 171.2], [52.6, 183]]) steamVent(L, V(x, 10, z), { period: 6, burst: 1.5, puff: 1.2 });
    travellingCrane(L, 26.8, 53.2, 172, 192, 21.6, { dx: -8, drop: 2, speed: 0.1 });
    for (const x of [33.5, 46.5]) floorLine(L, V(x, 10.01, 170), V(x, 10.01, 194));
    floorLine(L, V(33.5, 10.01, 182), V(46.5, 10.01, 182), 0.22, '#ffcc33');
    for (let z = 171; z < 194; z += 3) floorLine(L, V(26.6, 10.012, z), V(27.6, 10.012, z + 1), 0.3, '#ffcc33');
    const cc = ['#6a2bd0', '#ffcc33', '#c8452f', '#2f7ac8'];
    container(L, V(30, 10, 186), 0, cc[0]);
    container(L, V(30.5, 12.6, 186.3), 0.1, cc[1], { w: 5 });
    container(L, V(50, 10, 178), Math.PI / 2, cc[2]);
    container(L, V(50.2, 12.6, 178.4), Math.PI / 2 + 0.1, cc[3], { w: 5 });
    container(L, V(50, 15.2, 178.8), Math.PI / 2 - 0.1, cc[0], { w: 4 });
    props.goldBolt(V(50, 19.2, 178.8), 2);
    container(L, V(44, 10, 190), 0.3, cc[3]);
    crate3(L, V(36, 10, 176), '#2f7ac8');
    crate3(L, V(47, 10, 186), '#ffcc33');
    props.crate(V(34, 10, 178), 'bolt');
    props.crate(V(35.2, 10, 178.5), 'bolt');
    props.crate(V(46, 10, 172), 'boom');
    props.crate(V(45, 10, 194), 'ammo');
    props.crate(V(38, 10, 192), 'health');
    props.crate(V(31, 15.2, 186), 'big');
    lamp(L, V(28, 10, 174), { glow: M.neonPink });
    lamp(L, V(52, 10, 192), { glow: M.neonCyan });
    L.trigger({ box: [[26, 8, 172], [54, 20, 176]], fn: () => {
      g.enemies.spawn('pinceur', V(40, 10.5, 188));
      g.enemies.spawn('larbin', V(34, 10.5, 192));
      g.enemies.spawn('larbin', V(46, 10.5, 194), { elite: true });
      g.enemies.spawn('bourdon', V(36, 10, 190));
      g.enemies.spawn('bourdon', V(44, 10, 190));
      g.enemies.spawn('tourelle', V(33, 10, 194), { yaw: Math.PI });
      g.hud.say([['baron', 'Un fennec dans MON entrepôt ? Sécurité ! Facturez-lui la poussière qu’il soulève !']], true);
    } });

    // ------------------------------------------------ D3 : soute à spores (couloir des cuves, halle verrouillée)
    // les spores pompées sur Luminbois macèrent dans des cuves vitrées avant de partir vers la Méga-Benne
    const HY = 18, SPORE = '#5affa0';
    props.jumpPad(V(40, 10, 192.5), V(40, HY, 206), 4);
    deck(L, V(40, HY, 221), 18, 36, { underH: 22, mat: D4.floorHold });
    props.checkpoint(V(40, HY, 210), 0);
    // files de cuves reliées par une conduite qui entre dans le fût haut de chacune
    const vatRow = (x, zs, r, h) => {
      for (const z of zs) tank(L, V(x, HY, z), r, h, { fluid: SPORE });
      for (let i = 0; i + 1 < zs.length; i++) overheadPipe(L, V(x, HY + h - 0.48, zs[i] + r - 0.1), V(x, HY + h - 0.48, zs[i + 1] - r + 0.1), 0.16);
    };
    for (const x of [33.6, 46.4]) vatRow(x, [210, 222, 234], 1.5, 5.4);
    trussRoof(L, 31.5, 48.5, 203.5, 239.5, HY + 8.5, { step: 6, floor: HY, lamps: [36, 44] });
    for (const x of [35.5, 44.5]) floorLine(L, V(x, HY + 0.01, 204), V(x, HY + 0.01, 238));
    container(L, V(38.5, HY, 225), Math.PI / 2, '#6a2bd0');
    crate3(L, V(42.6, HY, 214), '#ffcc33');
    crate3(L, V(42.6, HY + 2, 214.2), '#2f7ac8');
    crate3(L, V(36.8, HY, 232.5), '#c8452f');
    props.crate(V(36.5, HY, 216), 'bolt');
    props.crate(V(43.5, HY, 230), 'ammo');
    props.crate(V(44, HY, 236.5), 'health');
    steamVent(L, V(35.6, HY, 228), { period: 5, burst: 1.3, puff: 1.1 });
    steamVent(L, V(44.4, HY, 218), { period: 6.5, burst: 1.3, puff: 1.1 });
    props.sign(V(33.4, HY, 205.4), 0, 'SOUTE À SPORES\nNE PAS RESPIRER', 3.6, 1.3, { bg: '#123a2a', fg: '#7affc8', border: '#ffcc33', glow: 0.8, height: 3.2, posts: true, post: '#2a2438' });
    L.trigger({ box: [[31, HY - 2, 207], [49, HY + 10, 211]], fn: () => {
      g.enemies.spawn('larbinBouclier', V(40, HY + 0.5, 229));
      g.enemies.spawn('larbin', V(36.5, HY + 0.5, 235));
      g.enemies.spawn('lunette', V(42, HY + 0.5, 237.5), { yaw: Math.PI });
      for (const [x, z] of [[37, 220], [43, 221], [39, 225], [42, 227]]) g.enemies.spawn('moustique', V(x, HY + 3, z));
      g.hud.say([
        ['ecrou', 'La soute à spores… Tout ce que le Baron a pompé sur Luminbois macère dans ces cuves.'],
        ['ecrou', 'Et le comité d’accueil est là. Une Lunette au fond : reste à couvert !'],
      ], true);
      g.hud.objective('Traverser la soute à spores');
    } });
    L.trigger({ box: [[31, HY - 2, 229], [49, HY + 10, 233]], fn: () => {
      for (const [x, z] of [[36, 207], [40, 206], [44, 207]]) g.enemies.spawn('grignoteur', V(x, HY + 0.5, z), { alert: true });
      for (const x of [36, 44]) g.enemies.spawn('bourdon', V(x, HY + 3, 212), { alert: true });
      g.enemies.spawn('phaseur', V(40, HY + 0.5, 216));
      g.hud.say([['ecrou', 'Derrière nous ! Ils sortent de la cale !']]);
    } });
    props.checkpoint(V(40, HY, 236.5), 0);

    // halle de chargement : cloison percée d'une porte Vorax à chaque bout, verrouillée pendant l'alerte
    deck(L, V(40, HY, 256), 30, 34, { underH: 24, mat: D4.floorHold });
    // cloisons de la hauteur des portes, du chambranle au bord de la dalle
    for (const z of [239.5, 272.2]) {
      voraxGate(L, V(40, HY, z), 0, 8, 6);
      for (const sx of [-1, 1]) {
        const xa = 40 + sx * 5.4, xb = 40 + sx * 15;
        L.box(V((xa + xb) / 2, HY + 3.8, z), V(9.6, 7.6, 1), M.voraxPanel, { surface: 'metal', uvScale: 0.3 });
        for (const f of [-1, 1]) neonStrip(L, V(xa + sx * 0.4, HY + 6.9, z + f * 0.53), V(xb - sx * 0.4, HY + 6.9, z + f * 0.53), 'cyan', { light: f < 0 });
      }
    }
    for (const x of [28.6, 51.4]) vatRow(x, [247, 256, 265], 1.8, 6);
    trussRoof(L, 25.9, 54.1, 240.5, 270.5, HY + 11, { step: 6, floor: HY, lamps: [34, 46] });
    for (const x of [25.15, 54.85]) railing(L, V(x, HY, 240.1), V(x, HY, 271.6));
    container(L, V(40, HY, 257), 0, '#c8452f');
    for (const [x, z, c] of [[33, 251, '#2f7ac8'], [47, 251, '#6a2bd0'], [33.5, 263, '#ffcc33'], [46.5, 263, '#c8452f']]) crate3(L, V(x, HY, z), c);
    crate3(L, V(33, HY + 2, 251.2), '#ffcc33');
    props.crate(V(36, HY, 242), 'health');
    props.crate(V(44, HY, 242), 'ammo');
    props.crate(V(40, HY, 268.5), 'bolt');
    steamVent(L, V(26.6, HY, 251.5), { period: 5.5, burst: 1.4, puff: 1.2 });
    steamVent(L, V(53.4, HY, 260.5), { period: 7, burst: 1.4, puff: 1.2 });
    const holdDoor = props.forceField(V(40, HY, 239.5), 8, 6, 0, { on: false, color: '#ff4fa0' });
    const holdGate = props.forceField(V(40, HY, 272.2), 8, 6, 0, { on: true, color: '#7affc8' });
    const hold = new Arena(g, {
      title: 'Alerte dans la soute !',
      fields: [holdDoor],
      waves: [
        { list: [['larbin', 33, 247], ['larbin', 47, 247], ['pinceur', 34, 267], ['larbinBouclier', 46, 267], ['moustique', 36, 255], ['moustique', 44, 255], ['moustique', 40, 251], ['moustique', 40, 263]], say: [['ecrou', 'Ils ont verrouillé la porte derrière nous ! Le Pinceur a l’avant blindé : prends-le à revers.']] },
        { list: [['phaseur', 32, 261], ['phaseur', 48, 261], ['lunette', 40, 269.5, { yaw: Math.PI }], ['larbin', 40, 248, { elite: true }], ['boumboule', 34, 268], ['boumboule', 46, 268], ['boumboule', 40, 265], ['bourdon', 40, 261]], say: [['baron', 'Pas touche à mes spores ! Elles valent plus cher que vous tous réunis !']] },
      ],
      reward: 700,
      rewardPos: V(40, HY + 3, 252),
      onDone: () => {
        g.props.setField(holdGate, false);
        g.hud.say([['ecrou', 'La porte du fond s’ouvre. Le pont de commande est juste au-dessus !']]);
        g.hud.objective('Monter au pont de commande');
      },
    });
    L.trigger({ box: [[25, HY - 2, 243], [55, HY + 10, 246]], once: false, fn: () => { if (!hold.active && !hold.done) hold.start(); } });

    // ------------------------------------------------ montée vers le pont supérieur
    props.platform([[40, 17.7, 276], [40, 25.7, 284]], { speed: 3, wait: 1, size: V(4, 0.6, 4), color: '#6a2bd0' });
    deck(L, V(40, 26, 290), 10, 6, { underH: 26, mat: D4.floorBridge });
    props.checkpoint(V(40, 26, 290), 0);
    // ailes du pont de commande : consoles, hologramme de la Méga-Benne, verrière et grande porte
    deck(L, V(30.5, 26, 290), 9, 8, { underH: 18, mat: D4.floorBridge });
    deck(L, V(49.5, 26, 290), 9, 8, { underH: 18, mat: D4.floorBridge });
    for (const z of [287.4, 290, 292.6]) console3(L, V(27.2, 26, z), Math.PI / 2);
    for (const z of [287.4, 292.6]) console3(L, V(52.8, 26, z), -Math.PI / 2);
    holoBenne(L, V(31, 26, 290), 0.9);
    lightBeam(L, V(31, 33.2, 290), V(31, 26.6, 290), { r0: 0.35, r1: 1.8, color: '#3ef2ff', intensity: 0.22 });
    railing(L, V(26.2, 26, 286.2), V(34.8, 26, 286.2));
    railing(L, V(26.2, 26, 293.8), V(34.8, 26, 293.8));
    railing(L, V(45.2, 26, 286.2), V(53.8, 26, 286.2));
    railing(L, V(45.2, 26, 293.8), V(53.8, 26, 293.8));
    railing(L, V(53.9, 26, 286.2), V(53.9, 26, 293.8));
    railing(L, V(26.1, 26, 286.2), V(26.1, 26, 293.8));
    canopy(L, V(40, 26, 290), 28, 8, 7.5, { ribs: 4 });
    // bannières accrochées derrière le premier arceau de la verrière (leur tringle flottait à 30 cm de lui)
    for (const x of [33, 47]) banner(L, V(x, 32.4, 286.17), 0, 1.6, 3.4);
    voraxGate(L, V(40, 26, 298.3), 0, 7, 5.6);
    props.crate(V(36.5, 26, 291), 'ammo');
    props.crate(V(36.5, 26, 292.4), 'health');
    L.trigger({ box: [[34, 24, 287], [46, 32, 293]], fn: () => {
      g.hud.say([
        ['ecrou', 'C’est le pont de commande. Derrière cette porte : le Baron… et la Méga-Benne.'],
        ['ecrou', 'Fais le plein au Bazar si besoin. Une fois le combat engagé, la porte se referme derrière nous !'],
      ], true);
      g.hud.objective('Affronter le Baron Vorax');
    } });
    props.vendor(V(43.4, 26, 291.5), -Math.PI / 2);

    // ------------------------------------------------ D4 : arène finale
    const A = V(40, 26, 325);
    deck(L, A, 54, 54, { underH: 40, trim: true, mat: D4.floorArena });
    // anneaux de néon incrustés dans le sol : repères de distance, reflets dans les tôles
    L.add(G.torus(21, 0.07, 4, 160), M.inlayCyan, mtx([A.x, A.y + 0.01, A.z], [Math.PI / 2, 0, 0]));
    L.add(G.torus(8.5, 0.06, 4, 96), M.inlayPink, mtx([A.x, A.y + 0.01, A.z], [Math.PI / 2, 0, 0]));
    // couloir d'entrée
    deck(L, V(40, 26, 296), 6, 6, { underH: 20 });
    // décor : Méga-Benne géante derrière l'arène
    const benne = joint(L.root, [40, 30, 393]);
    megaBenne(L, M, new THREE.Matrix4().makeTranslation(40, 30, 393));
    // colonne d'aspiration sous la bouche de la Méga-Benne
    lightBeam(L, V(40, 34, 393), V(40, -40, 393), { r0: 11, r1: 2.5, color: '#b46aff', intensity: 0.22 });
    const vortex = joint(benne, [0, 30, 0]);
    const swirl = [];
    for (let i = 0; i < 60; i++) {
      const b = part(vortex, i % 3 ? G.box(1.2, 0.8, 1) : G.nut(0.8, 0.3), i % 2 ? mat('#8a5a3a') : mat('#9aa6c2', { metal: 0.8 }), { shadow: false });
      swirl.push({ m: b, a: rand(0, 6), r: rand(8, 34), y: rand(-20, 25), sp: rand(0.3, 1) });
    }
    L.every((dt) => {
      for (const s of swirl) {
        s.a += dt * s.sp * (30 / s.r);
        s.y -= dt * 3 * s.sp;
        if (s.y < -25) s.y = 25;
        s.m.position.set(Math.cos(s.a) * s.r, s.y, Math.sin(s.a) * s.r);
        s.m.rotation.x += dt; s.m.rotation.y += dt * 1.3;
      }
    });
    // piliers lumineux du bord
    const pillar = pillarGeos(M), LA = lmats(M);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const p = V(A.x + Math.cos(a) * 25, A.y, A.z + Math.sin(a) * 25);
      if (Math.abs(p.z - (A.z - 25)) < 3 && Math.abs(p.x - A.x) < 6) continue;
      addGeos(L, pillar, mtx([p.x, p.y, p.z], [0, -a, 0]));
      // embase (marche franchissable) et fût jusqu'en haut de la cage
      g.world.add(new CylinderCollider(p.x, p.z, p.y, p.y + 0.56, 1.25, { surface: 'metal' }));
      g.world.add(new CylinderCollider(p.x, p.z, p.y, p.y + 8.3, 0.82, { surface: 'metal' }));
      L.add(G.sphere(0.7, 12, 8), i % 2 ? M.neonPink : M.neonCyan, new THREE.Matrix4().makeTranslation(p.x, p.y + 7.4, p.z));
      const col = i % 2 ? '#ff4fa0' : '#3ef2ff';
      lights.add({ pos: V(p.x - Math.cos(a) * 1.2, p.y + 6.4, p.z - Math.sin(a) * 1.2), color: col, intensity: 30, range: 11, priority: 1.1 });
      if (i % 2 === 0) {
        // bannière tenue au fût par deux pattes (sa tringle flottait devant le pilier), écartée des collerettes
        const yaw = Math.atan2(A.x - p.x, A.z - p.z), q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), yaw);
        banner(L, V(A.x + Math.cos(a) * 24.16, p.y + 6.6, A.z + Math.sin(a) * 24.16), yaw, 1.5, 3.6);
        for (const s of [-0.32, 0.32]) L.add(G.box(0.06, 0.08, 0.36), LA.steel, new THREE.Matrix4().compose(V(s, 6.65, 0.68).applyQuaternion(q).add(p), q, V(1, 1, 1)));
      }
      // projecteurs : un pilier sur deux, faisceau qui balaie le ciel
      else {
        const out = V(Math.cos(a), 0, Math.sin(a));
        lightBeam(L, V(p.x, p.y + 7.6, p.z), V(p.x + out.x * 18, p.y + 62, p.z + out.z * 18), { r0: 0.5, r1: 5.5, color: col, intensity: 0.4, sweep: [out, 0.32, 0.35, i] });
      }
    }
    // bouches de vapeur entre les piliers (rafales)
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      steamVent(L, V(A.x + Math.cos(a) * 23.5, A.y, A.z + Math.sin(a) * 23.5), { period: 7, burst: 1.6, puff: 1.5, color: '#d0c8e8' });
    }
    // abris (couverture)
    const cover = coverGeos(M);
    for (const [x, z] of [[-12, -6], [12, -6], [-10, 10], [10, 10]]) {
      L.box(V(A.x + x, A.y + 1.2, A.z + z), V(4, 2.4, 1.2), null, { surface: 'metal' });
      addGeos(L, cover, mtx([A.x + x, A.y, A.z + z]));
      // montants (un peu plus hauts et plus épais que la barricade)
      for (const sx of [-1, 1]) g.world.add(new BoxCollider(V(A.x + x + sx * 1.75, A.y + 1.285, A.z + z), V(0.25, 1.285, 0.66), null, { surface: 'metal' }));
      neonStrip(L, V(A.x + x - 1.5, A.y + 2.43, A.z + z - 0.57), V(A.x + x + 1.5, A.y + 2.43, A.z + z - 0.57), 'gold', { light: false });
    }
    // porte de l'arène (se ferme derrière Kobi)
    const door = props.forceField(V(40, 26, 297.6), 6, 4.5, 0, { on: false, color: '#ff4fa0' });
    // distributeurs de munitions pendant le combat
    let dispT = 0;
    const dispensers = [V(A.x - 18, A.y, A.z), V(A.x + 18, A.y, A.z)];
    const disp = dispenserGeos(M);
    for (const d of dispensers) {
      addGeos(L, disp, mtx([d.x, d.y, d.z]));
      // socle bas : Kobi y monte sans sauter (marche de 0,6 m), les munitions s'y posent
      g.world.add(new CylinderCollider(d.x, d.z, d.y, d.y + 0.6, 1.45, { surface: 'metal' }));
      L.add(G.torus(1.2, 0.1, 6, 24), M.neonCyan, new THREE.Matrix4().compose(V(d.x, d.y + 0.62, d.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), V(1, 1, 1)));
    }
    let boss = null;
    const arena = new Arena(g, {
      fields: [door],
      waves: [
        { list: [['goinfrotron', A.x, A.z + 14, { yaw: Math.PI }]], after: 1, onStart: () => g.playMusic('boss') },
      ],
      onStart: () => {
        g.hud.say([
          ['baron', 'Tiens, tiens… le petit mécano. Tu as cassé mon contremaître, mon pinceur et ma moquette.'],
          ['baron', 'Admire le Goinfrotron : il aspire les planètes, et il va commencer par toi !'],
          ['ecrou', 'Son ventre est blindé ! Vise le réservoir rose dans son dos… ou sa bouche quand elle aspire !'],
        ], true);
      },
      onDone: () => {},
    });
    L.trigger({ box: [[34, 24, 301], [46, 34, 305]], once: false, fn: () => { if (!arena.active && !arena.done) arena.start(); } });
    L.onPlayerRespawn = () => {
      if (hold.active) hold.reset();
      if (arena.active) {
        arena.reset();
        boss = null;
        g.hud.boss(null);
        g.playMusic('station');
      }
    };
    L.every((dt) => {
      if (!arena.active) return;
      if (!boss) boss = g.enemies.list.find((e) => e.type === 'goinfrotron' && !e.dead && e.hp > 0);
      dispT -= dt;
      if (dispT <= 0) {
        dispT = 12;
        for (const d of dispensers) {
          g.pickups.spawnAmmo(V(d.x, d.y + 1.2, d.z), 2);
          if (Math.random() < 0.6) g.pickups.spawnHealth(V(d.x, d.y + 1.2, d.z), 20);
          g.fx.ring(d, '#3ef2ff', 2.5, 0.4);
        }
        g.audio.play('ammo', { pos: dispensers[0] });
      }
      if (boss && boss.dead && !boss.resetRemoved && !L.endingStarted) {
        L.endingStarted = true;
        ending(boss.pos.clone());
      }
    });

    // ------------------------------------------------ fin : explosion du Goinfrotron et fuite du Baron
    const pod = new THREE.Group();
    part(pod, G.sphere(1.2, 18, 12), mat('#ffcc33', { metal: 0.8, rough: 0.3 }), {});
    part(pod, G.sphere(0.9, 14, 10), mat('#c890ff', { rough: 0.05, emissive: '#5a2a9a', emissiveIntensity: 0.6, transparent: true, opacity: 0.6 }), { p: [0, 0.5, 0.5] });
    const podFlame = part(pod, G.cone(0.6, 2, 12), glow('#ff9a3a', 4), { p: [0, -1.6, 0], r: [Math.PI, 0, 0], shadow: false });
    pod.visible = false;
    L.root.add(pod);
    const ending = (at) => {
      g.state = 'cutscene';
      g.input.enabled = false;
      g.player.frozen = true;
      g.audio.music && g.audio.music.stop();
      let t = 0;
      const p0 = at.clone().setY(at.y + 8);
      let done = false;
      L.every((dt) => {
        if (!L.endingStarted || done) return;
        t += dt;
        if (t < 3 && Math.random() < dt * 8) {
          const q = p0.clone().add(V(rand(-4, 4), rand(-5, 3), rand(-4, 4)));
          g.fx.explosion(q, rand(1.5, 3), pick(['#ff7a2a', '#ff4fa0', '#ffcc33']), { shake: 0.3 });
          g.audio.play('explosion', { pos: q, pitch: rand(0.6, 1.1) });
        }
        if (t > 1.2 && !pod.visible) {
          pod.visible = true;
          pod.position.copy(p0);
          g.hud.say([['baron', 'Ce n’est pas fini, Kobi ! Je reviendrai… avec un aspirateur ENCORE PLUS GROS !']], true);
        }
        if (pod.visible) {
          pod.position.y += dt * (4 + t * 6);
          pod.position.z += dt * 10;
          pod.rotation.y += dt * 4;
          podFlame.scale.set(1, 0.8 + Math.random() * 0.5, 1);
          g.fx.trail(pod.position.clone().add(V(0, -1.5, 0)), '#ffb35a', 1, 0.4, 0);
        }
        const camT = Math.min(1, t / 6);
        if (t < 8.5) g.camera.setScript(V(at.x - 14 + camT * 4, at.y + 6 + camT * 10, at.z - 22), pod.visible ? pod.position : p0, 2);
        if (t > 3.2 && t - dt <= 3.2) {
          g.fx.explosion(p0, 6, '#ffcc33', { core: '#ffffff', shake: 1 });
          g.audio.play('explosion', { big: true, pitch: 0.5 });
          g.pickups.spawnBolts(at.clone().setY(at.y + 4), 3000, { spread: 3, up: 1.6 });
          g.hud.say([['ecrou', 'Kobi ! La Méga-Benne se vide ! Toute la ferraille retourne d’où elle vient… y compris notre garage !']]);
        }
        if (t > 8.5 && t - dt <= 8.5) {
          g.camera.clearScript();
          g.player.victory = true;
          g.menus.fadeTo(true);
        }
        if (t > 9.8) {
          done = true;
          g.input.enabled = true;
          g.player.frozen = false;
          g.player.victory = false;
          g.levelComplete();
          g.menus.fadeTo(false);
        }
      });
    };
    // décor lointain : structures flottantes et antennes
    const hull = hullTexture();
    const hullMat = new THREE.MeshStandardMaterial({ map: hull.map, emissiveMap: hull.emissiveMap, emissive: '#ffffff', emissiveIntensity: 1.6, roughness: 0.5, metalness: 0.5 });
    for (let i = 0; i < 18; i++) {
      // jamais au-dessus de l'arène ni devant la baie du hangar : l'espace y reste dégagé
      let a, d, p;
      do {
        a = rand(0, Math.PI * 2); d = rand(120, 300);
        p = V(20 + Math.cos(a) * d, rand(-60, 60), 180 + Math.sin(a) * d);
      } while (p.distanceTo(A) < 110 || (p.z < -10 && Math.abs(p.x) < 160 && p.y > -30));
      const sx = rand(8, 24), sy = rand(4, 12), sz = rand(8, 24), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rand(0, 3), 0));
      L.add(boxUV(sx, sy, sz, 0.12), hullMat, new THREE.Matrix4().compose(p, q, V(1, 1, 1)));
      // rampe de néon posée sur le toit de la coque, dans son axe (elle flottait au-dessus des coques basses, dépassait
      // dans le vide ou restait enfermée dans les hautes)
      const len = Math.min(rand(10, 30), sz - 1.5), off = (rand(0, 3) / 3 - 0.5) * (sx - 2);
      L.add(G.box(0.5, 0.5, len), M.neonPink, new THREE.Matrix4().compose(V(off, sy / 2 + 0.2, 0).applyQuaternion(q).add(p), q, V(1, 1, 1)));
    }
    motes(L, { count: 360, colorA: '#ff7ad8', colorB: '#7ff3ff', size: 0.09, drift: [0.2, 0.6, 0.3], glow: 2 });
    void barrel; void clamp;
  },
  onStart(L, g) {
    g.hud.titleCard('Station Goinfre', 'L’usine orbitale du Baron');
    g.hud.objective('S’infiltrer dans la station');
    L.after(1.8, () => g.hud.say([
      ['ecrou', 'Atterrissage… disons « réussi ». Bienvenue dans la Station Goinfre, la base du Baron.'],
      ['gigi', 'Psst ! Le Bazar Pétarade livre partout, même en orbite. Mes plus grosses armes sont en rayon !'],
    ]));
  },
};

function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

// =====================================================================================================================
// Objets propres au niveau : Méga-Benne, piliers et abris de l'arène, distributeurs, bornes laser, tapis
// roulant, ventilateur et mât d'antenne du hangar. Géométries fusionnées par matière (bag), matières partagées (lmats).
// =====================================================================================================================
const TAU = Math.PI * 2;
const _zf = new THREE.Vector3(0, 0, 1);

// Sac de géométries par matière : put(matière, géo) (copiée si en cache), puis flush(L, matrice) ou geos()
function bag() {
  const parts = new Map();
  const put = (mt, g) => {
    if (g.userData.shared) g = g.clone();
    if (g.index) g = g.toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!parts.has(mt)) parts.set(mt, []);
    parts.get(mt).push(g);
    return g;
  };
  put.geos = () => { const out = new Map(); for (const [mt, l] of parts) out.set(mt, mergeParts(l)); parts.clear(); return out; };
  put.flush = (L, m) => { for (const [mt, g] of put.geos()) L.add(g, mt, m); };
  return put;
}
const addGeos = (L, geos, m) => { for (const [mt, g] of geos) L.add(g, mt, m); };

// Cylindre ouvert dont chaque facette reçoit sa propre tuile de texture (panneaux de tôle peinte : usure aux arêtes)
function panelCyl(rt, rb, h, sides, y0 = 0, uRep = sides, vRep = 1) {
  const g = new THREE.CylinderGeometry(rt, rb, h, sides, 1, true);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uRep, uv.getY(i) * vRep);
  return g.translate(0, y0 + h / 2, 0);
}
// Géométrie dont l'axe +z est tourné vers n, posée en c
const facing = (g, n, c) => g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_zf, n)).translate(c.x, c.y, c.z);

const LM = {};
function lmats(M) {
  if (LM.ready) return LM;
  const tm = (t, o) => mat('#ffffff', { map: t.map, normalMap: t.normalMap, ...o });
  // tôle violette Vorax peinte, écaillée aux arêtes ; acier sombre peint ; acier nu (dents, lentilles)
  LM.hull = tm(paintedMetalTexture('#5a2aa0', 'st-vorax', { chip: 0.22, edge: 0.75, rust: 0.04, bare: '#c4bedb' }), { rough: 0.5, metal: 0.3 });
  LM.steel = tm(paintedMetalTexture('#2e2b40', 'st-acier', { chip: 0.3, edge: 0.7, rust: 0.12, bare: '#a9afc2' }), { rough: 0.45, metal: 0.6 });
  LM.bright = mat('#c9cede', { rough: 0.26, metal: 0.9 });
  LM.tread = tm(treadPlateTexture('#8d97ad', 'st-larmee'), { rough: 0.38, metal: 0.7 });
  // doublure intérieure de la Méga-Benne (vue par la bouche) : sombre, lueur violette, sans liseré
  LM.liner = mat('#1a0c30', { rough: 0.7, metal: 0.2, side: THREE.DoubleSide, rim: 0, emissive: '#2a0c5a', emissiveIntensity: 0.6 });
  LM.dish = mat('#6e7286', { rough: 0.55, metal: 0.3, side: THREE.DoubleSide, rim: 0 });
  LM.window = glow('#8ff6ff', 1.7);
  LM.laser = glow('#ff3a6a', 3);
  LM.red = glow('#ff4040', 2.4);
  LM.gold = M.gold;
  LM.ready = true;
  return LM;
}

// ------------------------------------------------------------- Méga-Benne
// Entonnoir géant (bouche r = 12 à y = 5, gueule r = 40 à y = 55, repère local) : coque en panneaux de tôle bombés
// sur une doublure sombre, nervures méridiennes rivetées (une sur deux porte un néon rose), ceintures, rangée de
// hublots, col à bandes de danger, lèvre dorée et couronne de dents d'acier autour de la bouche.
function megaBenne(L, M, at) {
  const S = lmats(M), put = bag();
  const Y0 = 5, R0 = 12, K = 0.56, nl = Math.hypot(1, K), tilt = -Math.atan(K);
  const rad = (y) => R0 + (y - Y0) * K;
  const COLS = 32, ROWS = [8, 16.8, 25.6, 34.4, 43.2, 52];
  const nrm = (a) => new THREE.Vector3(Math.cos(a) / nl, -K / nl, Math.sin(a) / nl);
  const surf = (a, y, off = 0) => new THREE.Vector3(Math.cos(a) * (rad(y) + off / nl), y - (K * off) / nl, Math.sin(a) * (rad(y) + off / nl));
  // panneaux bombés, jointés (la doublure sombre paraît dans les joints) ; UV 0..1 par panneau
  const panels = [];
  for (let r = 0; r < ROWS.length - 1; r++) {
    const ya = ROWS[r], yb = ROWS[r + 1];
    for (let c = 0; c < COLS; c++) {
      const a0 = (c / COLS) * TAU, a1 = ((c + 1) / COLS) * TAU, gap = 0.2, da = gap / rad((ya + yb) / 2), N = 4;
      const pos = [], uv = [], idx = [];
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
        const s = i / N, t = j / N;
        const a = a0 + da + s * (a1 - a0 - 2 * da), y = ya + gap + t * (yb - ya - 2 * gap);
        const p = surf(a, y, 0.05 + 0.24 * Math.sin(Math.PI * s) * Math.sin(Math.PI * t));
        pos.push(p.x, p.y, p.z); uv.push(s, t);
      }
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const v = j * (N + 1) + i;
        idx.push(v, v + N + 1, v + 1, v + 1, v + N + 1, v + N + 2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      panels.push(g.toNonIndexed());
      g.dispose();
    }
  }
  // suie aspirée : la coque s'encrasse vers la bouche
  L.add(grime(mergeParts(panels), 8, 34, 0.45, '#2a1838'), S.hull, at);
  put(S.liner, new THREE.CylinderGeometry(rad(55) - 0.25, rad(5) - 0.25, 50, 64, 1, true).translate(0, 30, 0));
  // nervures méridiennes (un tronçon par rangée), rivetées sur deux files ; néon rose sur une nervure sur deux
  const riv = [];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * TAU, n = nrm(a), tg = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    for (let r = 0; r < ROWS.length - 1; r++) {
      const ya = ROWS[r] + 0.1, yb = ROWS[r + 1] - 0.1, m = (ya + yb) / 2;
      put(S.steel, rboxAt(0.5, (yb - ya) * nl, 0.9, 0.08, 0, 0, 0).rotateZ(tilt).translate(rad(m) + 0.25 / nl, m - (0.25 * K) / nl, 0).rotateY(-a));
      const pts = [];
      for (let y = ya + 0.9; y < yb - 0.5; y += 2.4) for (const s of [-0.3, 0.3]) pts.push(surf(a, y, 0.5).addScaledVector(tg, s).toArray());
      rivets(riv, pts, n.toArray(), 0.16);
    }
    if (k % 2 === 0) put(M.neonPinkSoft, new THREE.BoxGeometry(0.1, (ROWS[5] - ROWS[0]) * nl, 0.22).rotateZ(tilt).translate(rad(30) + 0.53 / nl, 30 - (0.53 * K) / nl, 0).rotateY(-a));
  }
  // ceintures entre les rangées
  for (const y of ROWS) put(S.steel, new THREE.TorusGeometry(rad(y) + 0.12, 0.38, 6, 128).rotateX(Math.PI / 2).translate(0, y, 0));
  // bombé d'un panneau en (angle, hauteur), même formule que les panneaux ci-dessus
  const bulge = (a, y) => {
    const r = Math.max(0, Math.min(ROWS.length - 2, ROWS.findIndex((v) => v > y) - 1)), ya = ROWS[r], yb = ROWS[r + 1];
    const w = TAU / COLS, aa = ((a % TAU) + TAU) % TAU, a0 = Math.floor(aa / w) * w, gap = 0.2, da = gap / rad((ya + yb) / 2);
    const s = Math.min(1, Math.max(0, (aa - a0 - da) / (w - 2 * da))), t = Math.min(1, Math.max(0, (y - ya - gap) / (yb - ya - 2 * gap)));
    // interpolé entre les sommets de la grille 4 × 4 du panneau (les facettes passent sous la courbe exacte)
    const f = (i, j) => 0.05 + 0.24 * Math.sin((Math.PI * i) / 4) * Math.sin((Math.PI * j) / 4);
    const i = Math.min(3, Math.floor(s * 4)), j = Math.min(3, Math.floor(t * 4)), u = s * 4 - i, v = t * 4 - j;
    return (f(i, j) * (1 - u) + f(i + 1, j) * u) * (1 - v) + (f(i, j + 1) * (1 - u) + f(i + 1, j + 1) * u) * v;
  };
  // hublots : verre lumineux, cerclage doré riveté, au milieu de chaque panneau de la troisième rangée ; les rivets du
  // cerclage sont posés sur le bombé du panneau (ils flottaient jusqu'à 12 cm au-dessus de la tôle)
  for (let c = 0; c < COLS; c++) {
    const a = ((c + 0.5) / COLS) * TAU, n = nrm(a), pc = surf(a, 30, 0.34);
    put(S.window, facing(new THREE.CircleGeometry(1.15, 20), n, pc));
    put(S.gold, facing(new THREE.TorusGeometry(1.28, 0.17, 6, 24), n, pc));
    const q = new THREE.Quaternion().setFromUnitVectors(_zf, n), pts = [];
    for (let k = 0; k < 8; k++) {
      const t = (k / 8) * TAU;
      const p = new THREE.Vector3(Math.cos(t) * 1.66, Math.sin(t) * 1.66, 0).applyQuaternion(q).add(pc);
      const ap = Math.atan2(p.z, p.x), o = (Math.hypot(p.x, p.z) - rad(p.y)) / nl, yp = p.y + (K * o) / nl;
      pts.push(surf(ap, yp, bulge(ap, yp) - 0.01).toArray());
    }
    rivets(riv, pts, n.toArray(), 0.13);
  }
  put(S.steel, mergeGeometries(riv));
  for (const g of riv) g.dispose();
  // col de la bouche à bandes de danger, lèvre dorée, couronne de dents (deux tailles alternées) tournées vers l'axe
  put(M.hazard, panelCyl(rad(8) + 0.32, rad(5.6) + 0.32, 2.4, 96, 5.6, 40));
  put(S.gold, new THREE.TorusGeometry(12, 1.3, 10, 64).rotateX(Math.PI / 2).translate(0, 5, 0));
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * TAU, big = k % 2 === 0;
    put(S.bright, new THREE.ConeGeometry(big ? 0.95 : 0.7, big ? 3.2 : 2.2, 4).rotateY(Math.PI / 4).rotateX(Math.PI).rotateZ(-0.38).translate(11.1, big ? 3.3 : 3.9, 0).rotateY(-a));
  }
  // col de la gueule et lèvre dorée du haut
  put(S.steel, panelCyl(rad(54.6) + 0.3, rad(52.3) + 0.3, 2.3, 48, 52.3));
  put(S.gold, new THREE.TorusGeometry(40, 2, 10, 96).rotateX(Math.PI / 2).translate(0, 55, 0));
  put.flush(L, at);
}

// ------------------------------------------------------------- arène : piliers lumineux et abris blindés
// Pilier (repère local, +x vers l'extérieur de l'arène) : embase octogonale à gradins boulonnée, bande de danger,
// fût effilé en trois tronçons de tôle peinte séparés par des collerettes rivetées, gaine électrique et boîtier,
// coupelle à lèvre dorée et cage d'acier autour du globe (le globe lumineux est posé à part, à sa couleur).
function pillarGeos(M) {
  const S = lmats(M), put = bag();
  const r = (y) => 0.8 - (0.2 * y) / 7;
  put(S.steel, panelCyl(1.2, 1.28, 0.28, 8, 0));
  put(S.steel, new THREE.CylinderGeometry(1.2, 1.2, 0.01, 8).translate(0, 0.28, 0));
  put(M.hazard, panelCyl(1.06, 1.06, 0.14, 8, 0.28, 8));
  put(S.steel, new THREE.CylinderGeometry(0.9, 1.08, 0.14, 8).translate(0, 0.49, 0));
  const riv = [];
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) / 8) * TAU;
    put(S.bright, new THREE.CylinderGeometry(0.055, 0.055, 0.06, 6).translate(Math.cos(a) * 1.14, 0.31, Math.sin(a) * 1.14));
  }
  const cuts = [0.55, 2.75, 4.95, 6.9];
  for (let i = 0; i < 3; i++) put(S.hull, panelCyl(r(cuts[i + 1]), r(cuts[i]), cuts[i + 1] - cuts[i], 10, cuts[i], 10, 1));
  for (const y of cuts.slice(0, 3)) {
    const rc = r(y) + 0.09;
    put(S.steel, new THREE.CylinderGeometry(rc, rc, 0.2, 20).translate(0, y, 0));
    const pts = [];
    for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU; pts.push([Math.cos(a) * (rc + 0.005), y, Math.sin(a) * (rc + 0.005)]); }
    for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU; rivets(riv, [pts[k]], [Math.cos(a), 0, Math.sin(a)], 0.025); }
  }
  // gaine plaquée le long du flanc extérieur (du gradin à la coupelle), colliers, boîtier de raccordement adossé au fût
  // (gaine, colliers et boîtier flottaient à 6-7 cm du fût)
  put(S.bright, tube(new THREE.Vector3(r(0.56) + 0.05, 0.56, 0), new THREE.Vector3(r(6.96) + 0.05, 6.96, 0), 0.055, 0.055, 8));
  for (const y of [2.0, 3.85, 5.9]) put(S.steel, new THREE.BoxGeometry(0.13, 0.07, 0.18).translate(r(y) + 0.05, y, 0));
  put(S.steel, rboxAt(0.16, 0.44, 0.34, 0.03, r(1.25) + 0.07, 1.25, 0));
  put(M.neonGold, new THREE.BoxGeometry(0.02, 0.05, 0.12).translate(r(1.25) + 0.156, 1.38, 0));
  // coupelle, lèvre dorée, cage d'acier au-dessus du globe, fleuron
  put(S.steel, new THREE.CylinderGeometry(0.82, 0.62, 0.32, 16).translate(0, 7.06, 0));
  put(S.gold, new THREE.TorusGeometry(0.8, 0.05, 6, 24).rotateX(Math.PI / 2).translate(0, 7.22, 0));
  // arceaux de la cage : pieds dans la lèvre dorée (ils tombaient 4 cm à côté de la coupelle)
  for (let k = 0; k < 3; k++) put(S.steel, new THREE.TorusGeometry(0.86, 0.035, 5, 18, Math.PI).rotateY((k * Math.PI) / 3).translate(0, 7.25, 0));
  put(S.steel, new THREE.CylinderGeometry(0.06, 0.1, 0.14, 8).translate(0, 8.16, 0));
  put(S.gold, new THREE.SphereGeometry(0.07, 8, 6).translate(0, 8.27, 0));
  put(S.steel, mergeGeometries(riv));
  for (const g of riv) g.dispose();
  return put.geos();
}

// Abri blindé 4 × 2,4 × 1,2 (repère local : base au centre, face avant vers -z) : deux montants d'acier coiffés
// d'anneaux de levage, âme sombre, plaques de blindage violettes rivetées sur les deux faces, traverse et lisse
// haute, plinthe à bandes de danger.
function coverGeos(M) {
  const S = lmats(M), put = bag(), riv = [];
  for (const sx of [-1, 1]) {
    put(S.steel, rboxAt(0.5, 2.5, 1.26, 0.06, sx * 1.75, 1.25, 0));
    put(S.gold, rboxAt(0.56, 0.07, 1.32, 0.025, sx * 1.75, 2.53, 0));
    put(S.steel, new THREE.TorusGeometry(0.08, 0.025, 5, 12).translate(sx * 1.75, 2.64, 0));
    for (const sz of [-1, 1]) rivets(riv, [[sx * 1.75 - 0.14, 0.5, sz * 0.632], [sx * 1.75 + 0.14, 0.5, sz * 0.632], [sx * 1.75 - 0.14, 2.0, sz * 0.632], [sx * 1.75 + 0.14, 2.0, sz * 0.632]], [0, 0, sz], 0.028);
  }
  put(S.steel, boxAt(G.box(3.0, 2.2, 0.8), 0, 1.2, 0));
  put(M.hazard, boxAt(boxUV(3.0, 0.28, 1.04, 0.5), 0, 0.14, 0));
  for (const sz of [-1, 1]) for (const y of [0.81, 1.81]) for (const x of [-0.75, 0.75]) {
    put(S.hull, rboxAt(1.44, 0.92, 0.12, 0.035, x, y, sz * 0.44));
    const z = sz * 0.5, pts = [];
    for (const dx of [-0.6, 0, 0.6]) for (const dy of [-0.36, 0.36]) pts.push([x + dx, y + dy, z]);
    rivets(riv, pts, [0, 0, sz], 0.025);
  }
  put(S.steel, rboxAt(3.04, 0.12, 1.04, 0.03, 0, 1.31, 0));
  put(S.steel, rboxAt(0.1, 2.0, 1.06, 0.02, 0, 1.31, 0));
  put(S.steel, rboxAt(3.04, 0.14, 1.08, 0.04, 0, 2.33, 0));
  put(S.steel, mergeGeometries(riv));
  for (const g of riv) g.dispose();
  return put.geos();
}

// ------------------------------------------------------------- tapis roulant
// Bande en caoutchouc (texture locale, 1 tuile = 4,25 m : six tasseaux, bords piqués, chevron de sens peint et usé)
// avec sa carte de normales ; raccordable en v
let beltTex = null;
function beltTextures() {
  if (beltTex) return beltTex;
  const S = 256, R = mkRng(41);
  const hs = new Float32Array(S * S);
  const c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d'), img = ctx.createImageData(S, S);
  const grain = new Float32Array(S * S).map(() => R());
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = y * S + x, n = grain[i];
    const lf = 0.5 + 0.5 * Math.sin(u * 23 + Math.sin(v * TAU * 2) * 2) * Math.sin(v * TAU * 3 + u * 7);
    let r = 0.15, g = 0.145, b = 0.19, h = 0.2 + n * 0.05;
    const k = 0.9 + lf * 0.15 + (n - 0.5) * 0.08;
    r *= k; g *= k; b *= k;
    // tasseaux : arête vive éclairée en tête, ombre derrière
    const f = (v * 6) % 1;
    if (f < 0.13) { const t = Math.sin((f / 0.13) * Math.PI); r = g = 0.26 + t * 0.12; b = r + 0.04; h = 0.2 + t * 0.8; if (f < 0.03) { r += 0.08; g += 0.08; b += 0.08; } }
    else if (f < 0.2) { const t = 1 - (f - 0.13) / 0.07; r *= 1 - t * 0.35; g *= 1 - t * 0.35; b *= 1 - t * 0.35; }
    // chevron jaune usé au milieu de la tuile, pointe vers les v décroissants de la texture (le canvas est retourné) :
    // le sens de la bande
    const dv = 0.6 - v - Math.abs(u - 0.5) * 0.5;
    if (Math.abs(u - 0.5) < 0.2 && dv > 0 && dv < 0.07 && f >= 0.2 && lf * 0.25 + n * 0.75 > 0.2 + sm(0.12, 0.2, Math.abs(u - 0.5)) * 0.45) {
      const w = 0.75 + lf * 0.25; r = 0.88 * w; g = 0.68 * w; b = 0.16 * w; h += 0.04;
    }
    // bords de la bande : liseré plus sombre et piqûres
    const e = Math.min(u, 1 - u);
    if (e < 0.045) { r *= 0.62; g *= 0.62; b *= 0.62; h = 0.15; if (e > 0.018 && e < 0.03 && (y % 8) < 3) { r = g = b = 0.42; h = 0.3; } }
    img.data[i * 4] = Math.min(255, r * 255); img.data[i * 4 + 1] = Math.min(255, g * 255); img.data[i * 4 + 2] = Math.min(255, b * 255); img.data[i * 4 + 3] = 255;
    hs[i] = h;
  }
  ctx.putImageData(img, 0, 0);
  const nc = document.createElement('canvas'); nc.width = nc.height = S;
  const nctx = nc.getContext('2d'), nimg = nctx.createImageData(S, S);
  const H = (x, y) => hs[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * 3, dy = (H(x, y + 1) - H(x, y - 1)) * 3, l = Math.hypot(dx, dy, 1), i = (y * S + x) * 4;
    nimg.data[i] = (-dx / l * 0.5 + 0.5) * 255; nimg.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; nimg.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; nimg.data[i + 3] = 255;
  }
  nctx.putImageData(nimg, 0, 0);
  const tex = (cv, srgb) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    return t;
  };
  beltTex = { map: tex(c, true), normalMap: tex(nc, false) };
  return beltTex;
}

// Surface de la bande (z0 → z1, largeur w, dessus à y) : v en tuiles de 4,25 m croissant avec z
function beltTop(w, z0, z1, y) {
  const g = new THREE.PlaneGeometry(w, z1 - z0).rotateX(-Math.PI / 2).translate(0, y, (z0 + z1) / 2);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / w + 0.5, (p.getZ(i) - z0) / 4.25);
  return g;
}

// Châssis du tapis (z0 → z1) : corps de la bande, flasques d'acier en tronçons rivetés et raidis, lisse à bandes de
// danger, bavettes de caoutchouc, lampes dorées encastrées, longerons en I et poutres en treillis dessous
function conveyorFrame(L, M, z0, z1) {
  const S = lmats(M), put = bag(), riv = [];
  const len = z1 - z0, zc = (z0 + z1) / 2, n = Math.round(len / 4.25), seg = len / n;
  // corps de la bande serré entre les flasques (il flottait à 2 cm de chacune)
  put(M.rubber, boxAt(G.box(5.04, 0.5, len), 0, -0.27, zc));
  for (const sx of [-1, 1]) {
    const x = sx * 2.9;
    for (let k = 0; k < n; k++) {
      const z = z0 + seg * (k + 0.5);
      put(S.steel, rboxAt(0.76, 1.12, seg - 0.04, 0.05, x, 0.1, z));
      const pts = [];
      for (let t = -seg / 2 + 0.45; t < seg / 2 - 0.3; t += 0.85) for (const y of [-0.3, 0.5]) pts.push([sx * 3.282, y, z + t]);
      rivets(riv, pts, [sx, 0, 0], 0.022);
    }
    for (let k = 0; k <= n; k++) put(S.steel, rboxAt(0.1, 1.16, 0.22, 0.02, sx * 3.31, 0.1, z0 + seg * k));
    put(M.hazard, boxAt(boxUV(0.62, 0.06, len, 0.5), x, 0.68, zc));
    put(M.rubber, boxAt(G.box(0.06, 0.14, len), sx * 2.49, 0.07, zc));
    for (let z = z0 + 2; z <= z1 - 2; z += 6) {
      put(S.steel, new THREE.CylinderGeometry(0.46, 0.5, 0.1, 16).translate(x, 0.73, z));
      put(M.neonGold, new THREE.CylinderGeometry(0.34, 0.34, 0.06, 16).translate(x, 0.78, z));
      put(S.gold, new THREE.TorusGeometry(0.4, 0.03, 5, 20).rotateX(Math.PI / 2).translate(x, 0.79, z));
    }
    // longeron en I sous la flasque (âme jusqu'au pied de la flasque), membrure basse, montants et diagonales alternées
    put(S.steel, boxAt(G.box(0.08, 0.74, len), x, -0.83, zc));
    put(S.steel, boxAt(G.box(0.46, 0.06, len), x, -1.2, zc));
    put(M.pipe, tube(V(x, -2.6, z0 + 0.3), V(x, -2.6, z1 - 0.3), 0.09, 0.09, 8));
    for (let k = 0; k <= n; k++) {
      const z = Math.min(z1 - 0.3, Math.max(z0 + 0.3, z0 + seg * k));
      put(M.pipe, tube(V(x, -1.2, z), V(x, -2.6, z), 0.07, 0.07, 6));
      if (k < n) {
        const zn = Math.min(z1 - 0.3, z0 + seg * (k + 1));
        put(M.pipe, k % 2 ? tube(V(x, -1.2, z), V(x, -2.6, zn), 0.055, 0.055, 6) : tube(V(x, -2.6, z), V(x, -1.2, zn), 0.055, 0.055, 6));
      }
    }
  }
  // traverses sous la bande et entre les membrures basses
  for (let k = 0; k <= n; k++) {
    const z = Math.min(z1 - 0.3, Math.max(z0 + 0.3, z0 + seg * k));
    put(S.steel, boxAt(G.box(5.8, 0.14, 0.14), 0, -1.15, z));
    put(M.pipe, tube(V(-2.9, -2.6, z), V(2.9, -2.6, z), 0.06, 0.06, 6));
  }
  put(S.steel, mergeGeometries(riv));
  for (const g of riv) g.dispose();
  put.flush(L, null);
}

// ------------------------------------------------------------- petits équipements
// Borne d'émetteur laser (repère local, faisceau vers -x à la hauteur by) : platine boulonnée, poteau d'acier
// peint, gaine, boîtier doré de l'émetteur avec son canon et sa lentille rouge, bande de danger, chapeau et feu
function laserPostGeos(M, by) {
  const S = lmats(M), put = bag();
  put(S.steel, rboxAt(0.8, 0.12, 0.8, 0.03, 0, 0.06, 0));
  for (const x of [-0.3, 0.3]) for (const z of [-0.3, 0.3]) put(S.bright, new THREE.CylinderGeometry(0.045, 0.045, 0.06, 6).translate(x, 0.15, z));
  put(S.steel, rboxAt(0.4, 2.8, 0.4, 0.05, 0, 1.52, 0));
  put(M.hazard, boxAt(boxUV(0.43, 0.3, 0.43, 0.5), 0, 2.55, 0));
  put(S.steel, rboxAt(0.52, 0.14, 0.52, 0.04, 0, 2.97, 0));
  put(LM.red, new THREE.SphereGeometry(0.1, 10, 6, 0, TAU, 0, Math.PI / 2).translate(0, 3.04, 0));
  put(S.bright, tube(V(0.25, 0.14, 0), V(0.25, 2.3, 0), 0.04, 0.04, 6));
  for (const y of [0.9, 1.9]) put(S.steel, new THREE.BoxGeometry(0.06, 0.06, 0.14).translate(0.25, y, 0));
  put(S.gold, rboxAt(0.5, 0.36, 0.5, 0.06, 0, by, 0));
  put(S.steel, rboxAt(0.06, 0.28, 0.4, 0.02, -0.25, by, 0));
  put(S.bright, new THREE.CylinderGeometry(0.12, 0.15, 0.16, 12).rotateZ(Math.PI / 2).translate(-0.34, by, 0));
  put(LM.laser, new THREE.CircleGeometry(0.1, 14).rotateY(-Math.PI / 2).translate(-0.425, by, 0));
  return put.geos();
}

// Distributeur de munitions (socle bas, 0,65 m) : embase octogonale, tambour d'acier nervuré à bande de danger et
// voyants, plateau de tôle larmée, anneau cyan, trappe à iris au centre
function dispenserGeos(M) {
  const S = lmats(M), put = bag();
  put(S.steel, panelCyl(1.42, 1.5, 0.16, 8, 0));
  put(S.steel, new THREE.CylinderGeometry(1.42, 1.42, 0.01, 8).translate(0, 0.16, 0));
  put(S.steel, panelCyl(1.24, 1.3, 0.42, 16, 0.16, 16));
  put(M.hazard, panelCyl(1.312, 1.312, 0.1, 16, 0.2, 16));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    put(S.steel, rboxAt(0.12, 0.44, 0.14, 0.02, 1.29, 0.38, 0).rotateY(-a));
    // voyant serti dans la tôle du tambour (il flottait 1,6 cm devant)
    put(M.neonCyan, new THREE.BoxGeometry(0.05, 0.05, 0.22).translate(1.255, 0.45, 0).rotateY(-a - TAU / 16));
  }
  const top = new THREE.CylinderGeometry(1.16, 1.24, 0.06, 24);
  const uv = top.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, uv.getY(i) * 4);
  put(S.tread, top.translate(0, 0.6, 0));
  put(S.steel, new THREE.CylinderGeometry(0.5, 0.56, 0.06, 6).translate(0, 0.64, 0));
  for (let k = 0; k < 6; k++) put(S.gold, new THREE.BoxGeometry(0.035, 0.02, 0.44).translate(0.2, 0.675, 0).rotateY((k / 6) * TAU + 0.5));
  put(M.neonCyan, new THREE.CircleGeometry(0.12, 12).rotateX(-Math.PI / 2).translate(0, 0.68, 0));
  return put.geos();
}

// Ventilateur du plafond (animé) : moteur à ailettes de refroidissement, moyeu boulonné, cinq pales de tôle peinte
// effilées sur leurs pattes de fixation rivetées, calotte dorée ; renvoie la géométrie par matière (repère du moyeu)
function fanGeos(M) {
  const S = lmats(M), put = bag(), riv = [];
  put(S.steel, panelCyl(0.42, 0.5, 0.3, 12, -0.15));
  put(S.steel, new THREE.CylinderGeometry(0.42, 0.42, 0.01, 12).translate(0, 0.15, 0));
  // fond du carter (le moyeu s'y boulonne ; on voyait l'intérieur du moteur par-dessous)
  put(S.steel, new THREE.CylinderGeometry(0.5, 0.5, 0.01, 12).translate(0, -0.15, 0));
  for (let k = 0; k < 12; k++) put(S.steel, new THREE.BoxGeometry(0.12, 0.26, 0.03).translate(0.5, 0, 0).rotateY((k / 12) * TAU));
  put(S.steel, new THREE.CylinderGeometry(0.3, 0.3, 0.08, 16).translate(0, -0.19, 0));
  put(S.gold, new THREE.SphereGeometry(0.2, 12, 6, 0, TAU, 0, Math.PI / 2).rotateX(Math.PI).translate(0, -0.23, 0));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    // pale effilée (plus large au bout), vrillée de 0,25 rad
    const b = new THREE.BoxGeometry(2.3, 0.05, 0.5, 4, 1, 1);
    const p = b.attributes.position;
    for (let j = 0; j < p.count; j++) { const t = (p.getX(j) + 1.15) / 2.3; p.setZ(j, p.getZ(j) * (0.62 + 0.38 * t)); }
    b.computeVertexNormals();
    put(S.hull, b.rotateX(0.25).translate(1.65, -0.08, 0).rotateY(a));
    put(S.steel, rboxAt(0.62, 0.06, 0.3, 0.02, 0.62, -0.06, 0).rotateY(a));
    const pts = [];
    for (const x of [0.45, 0.8]) pts.push(new THREE.Vector3(x, -0.025, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), a).toArray());
    rivets(riv, pts, [0, 1, 0], 0.025);
  }
  put(S.bright, mergeGeometries(riv));
  for (const g of riv) g.dispose();
  return put.geos();
}

// Mât d'antenne en treillis (de pos sur h mètres) : platine boulonnée, trois membrures effilées, ceintures et
// diagonales, gaine de câble, petite parabole tournée vers l'espace et feu de balisage à mi-hauteur
function latticeMast(L, M, pos, h) {
  const S = lmats(M), put = bag();
  const corner = (k, y) => { const a = (k / 3) * TAU + 0.5, r = 0.55 - (0.15 * y) / h; return V(Math.cos(a) * r, y, Math.sin(a) * r); };
  put(S.steel, rboxAt(1.6, 0.1, 1.6, 0.03, 0, 0.05, 0));
  for (const x of [-0.65, 0.65]) for (const z of [-0.65, 0.65]) put(S.bright, new THREE.CylinderGeometry(0.045, 0.045, 0.06, 6).translate(x, 0.12, z));
  for (let k = 0; k < 3; k++) put(M.pipe, tube(corner(k, 0.1), corner(k, h), 0.06, 0.05, 8));
  const n = 4, st = (h - 0.1) / n;
  for (let i = 0; i <= n; i++) {
    const y = 0.1 + i * st;
    for (let k = 0; k < 3; k++) {
      put(S.steel, tube(corner(k, y), corner((k + 1) % 3, y), 0.035, 0.035, 6));
      if (i < n) put(S.steel, tube(corner(k, y), corner((k + 1) % 3, y + st), 0.03, 0.03, 6));
    }
  }
  const c0 = corner(0, 0.1), c1 = corner(0, h);
  put(S.bright, tube(V(c0.x * 0.7, 0.1, c0.z * 0.7 + 0.12), V(c1.x * 0.7, h, c1.z * 0.7 + 0.12), 0.03, 0.03, 6));
  // parabole (calotte creuse) sur sa potence, tournée vers -x (l'espace)
  // la potence part d'une traverse posée entre les membrures 1 et 2 (elle s'arrêtait à 8 cm du treillis)
  const dy = h * 0.62, b1 = corner(1, dy), b2 = corner(2, dy), bt = b1.z / (b1.z - b2.z);
  put(S.steel, tube(b1, b2, 0.035, 0.035, 6));
  put(S.steel, tube(V(b1.x + bt * (b2.x - b1.x), dy, 0), V(-0.86, dy, 0), 0.03, 0.03, 6));
  put(LM.dish, new THREE.SphereGeometry(0.55, 16, 5, 0, TAU, 0, 0.65).rotateZ(-Math.PI / 2).translate(-1.4, dy, 0));
  put(S.steel, tube(V(-0.86, dy, 0), V(-1.25, dy, 0), 0.02, 0.02, 6));
  put(LM.red, new THREE.SphereGeometry(0.08, 10, 8).translate(corner(1, h * 0.5).x * 1.15, h * 0.5, corner(1, h * 0.5).z * 1.15));
  put.flush(L, mtx([pos.x, pos.y, pos.z]));
}
