// Planète 2 — Nimbara : l'Archipel des Brises (îles flottantes au-dessus d'une mer de nuages).
import * as THREE from 'three';
import { lights } from '../engine/lightpool.js';
import { island, islandPond, plaza, springRocks, crystalSpring, cloudShadows, bubbleTree, crystals, column, arch, stiltHouse, lantern, mast, balloon, liftBalloon, cloudSea, cloudPuffs, ropeBridge, skyMats, cloudCannon, updraftFan, skyVault } from '../models/environment/skyIslands.js';
import { kobiShip, rock, bunting, barrel } from '../models/environment/props.js';
import { Arena } from '../game/arena.js';
import { G, part } from '../models/geo.js';
import { glow } from '../engine/materials.js';
import { rand, clamp } from '../engine/util.js';
import { lawn, motes } from '../models/nature.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export default {
  id: 'nimbara',
  name: 'Nimbara',
  subtitle: 'L’Archipel des Brises',
  orb: 'radial-gradient(circle at 35% 30%, #e8fff6, #6fd6c9 40%, #6a54c8 90%)',
  mapPos: [32, 40],
  music: 'nimbara',
  build(L, g) {
    const props = g.props;
    // petit matin pastel : soleil bas et doré sur le côté, ciel bleu tendre, horizon pêche, brume rose lumineuse
    L.environment({
      skyTop: '#4c86e8', skyHorizon: '#ffd6cc', skyBottom: '#f6dcea', sunDir: [0.75, 0.55, 0.37], sunColor: '#ffe4c8',
      clouds: 0.62, cloudColor: '#fffaf6', cloudHeight: 0.12, moonDir: [0.25, 0.32, 0.92], moonSize: 0.09, moonColor: '#e6ecff',
      planetDir: [-0.7, 0.25, 0.66], planetSize: 0.05, planetA: '#8ad0ff', planetB: '#e0f4ff', sunHalo: 1.0, skyGlow: 0.95,
      fogColor: '#e6cfe2', fogNear: 130, fogFar: 920, fogBase: -14, fogFall: 0.07, fogHeight: 0.8, fogSun: 0.3, fogSunColor: '#ffdcc2',
      fill: 0.22, fillColor: '#e8eeff', hemiSky: '#cadcff', hemiGround: '#f6dae8', hemiIntensity: 0.78,
      sunIntensity: 3.0, envIntensity: 0.7, rimColor: '#ffe6ee', rimStrength: 0.6, dust: '#fff0e8', bloom: 0.32, exposure: 0.94, saturation: 1.18,
      // ciel très clair : halo réservé aux vraies sources (soleil, lanternes), sinon il voile toute l'image
      bloomThreshold: 1.25,
      glare: 0.6, grade: { shadows: '#4a70d8', highlights: '#ffdccc', amount: 0.16, contrast: 0.24 },
      // air limpide en altitude, voile lumineux plus dense vers la mer de nuages ; rayons vers le soleil
      volumetric: { density: 0.0036, floor: 0.09, sun: 0.6, anisotropy: 0.45, noise: 0.65, ambientAmount: 0.14, tint: '#fff4f2' },
    });
    // lumières locales : petit matin, les lanternes encore allumées effleurent le décor
    lights.gain = 0.42;
    // montgolfières : brûleur allumé, flamme et halo chaud sur la nacelle et le bas de l'enveloppe
    const burner = (grp, y) => {
      part(grp, G.cone(0.14, 0.42, 8), glow('#ffb04a', 3.2), { p: [0, y, 0] });
      lights.add({ obj: grp, offset: V(0, y + 0.35, 0), color: '#ffa24a', intensity: 30, range: 9, decay: 1.4, flicker: 0.2, priority: 0.8 });
    };
    L.killY = -22;
    L.ambient = 'breeze';
    L.every((dt) => { if (g.state === 'playing' && Math.random() < dt * 0.25) g.audio.play('bird', { pitch: 0.8 + Math.random() * 0.5, pos: g.camera.cam.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 40, 10, (Math.random() - 0.5) * 40)) }); });
    cloudSea(L, -30, { a: '#fff4ee', b: '#b2a8e6' });
    cloudPuffs(L, V(0, 0, 150), 90, 700, -18, 60, '#ffffff', { seed: 3 });
    cloudPuffs(L, V(0, 0, 150), 20, 900, 60, 90, '#fff8f6', { seed: 11, shade: '#e4def8' });
    // ombres des nuages qui passent sur les îles (et rayons de soleil entre eux dans la brume)
    cloudShadows(L, V(10, 0, 160), 22, 380, 62, { seed: 9 });
    const m2 = skyMats();

    // ------------------------------------------------ S0 : aire d'arrivée
    // source du nord-est : l'eau sourd d'un amas de rochers, remplit une mare et déborde par une échancrure du rebord
    // dans la mer de nuages
    const s0 = island(L, V(0, 0, 0), 14, {
      seed: 11, clear: { x: -6, z: -6, r: 5 },
      carve: [{ x: 7.6, z: 8.6, r: 2.6, depth: 0.5 }, { a: [7.6, 8.6], b: [9.7, 11], r: 1.7, depth: 0.42, bank: 0.6 }],
      lips: [{ dir: 0.72, width: 2.6 }],
    });
    // aire d'atterrissage pavée sous le vaisseau
    plaza(L, s0, -6, -6, 5, { seed: 2 });
    const src0 = islandPond(L, s0, { at: [7.6, 8.6], lip: { dir: 0.72, width: 2.6 }, pads: 5, keep: [{ x: 6.3, z: 7.1, r: 1.3 }] });
    springRocks(L, src0, { at: [6.55, 7.45], dir: 0.72, h: 0.95 });
    const ship = kobiShip(L.root);
    ship.position.set(-6, 0, -6);
    ship.rotation.y = 0.6;
    L.box(V(-6, 1.6, -6), V(2.6, 3, 6), null, { ry: 0.6, surface: 'metal' });
    L.checkpoint = { pos: V(0, 0.3, 2), yaw: 0 };
    bubbleTree(L, V(8, 0, -4), 3);
    bubbleTree(L, V(-9, 0, 5), 7, 0.9);
    crystals(L, V(9, 0, 6), 5);
    lantern(L, V(3, 0, 10));
    lantern(L, V(-3, 0, 10));
    props.crate(V(2.6, 0, 5.2), 'bolt');
    props.crate(V(3.6, 0, 4.2), 'bolt');
    props.crate(V(-5, 0, 8), 'ammo');
    props.sign(V(4, 0, 11), -0.3, 'PORT-NUAGE\n↑ PAR LES ÎLES', 3, 1.2, { bg: '#fff3df', fg: '#6a4ac8', border: '#ff6f8a', post: '#8a5a3a' });
    L.titleShot = () => {};

    // ------------------------------------------------ S1 : pont de corde
    ropeBridge(L, V(0, 0.05, 13), V(0, 0.5, 27.2));
    island(L, V(0, 0.5, 35), 9.5, { seed: 21 });
    bubbleTree(L, V(-4, 0.5, 36), 12, 0.8);
    crystals(L, V(4, 0.5, 31), 4, true);
    props.crate(V(3, 0.5, 37), 'bolt');
    props.crate(V(-2, 0.5, 31), 'boom');
    props.jumpPad(V(0, 0.5, 38), V(-10, 5, 53), 4);
    L.trigger({ sphere: [[0, 0.5, 30], 6], fn: () => {
      ['grignoteur', 'grignoteur', 'grignoteur'].forEach((t, i) => g.enemies.spawn(t, V(-3 + i * 3, 1, 36 + (i % 2)), { alert: true }));
      g.hud.say([['ecrou', 'Même dans les nuages, il y a des Grignoteurs. La ferraille, ça vole partout !']]);
    } });

    // ------------------------------------------------ S2 : apprentissage du grappin
    island(L, V(-10, 5, 54), 7, { seed: 31 });
    crystals(L, V(-14, 5, 52), 6);
    column(L, V(-6, 5, 50), 4, true);
    props.crate(V(-12, 5, 57), 'bolt');
    props.grapple(V(-10, 13, 68), V(-6, 4, 84), { apex: 2, back: V(-10, 5, 57) });
    L.trigger({ sphere: [[-10, 5, 54], 7], fn: () => {
      g.hud.say([['ecrou', 'Pendant le voyage, j’ai bricolé un grappin magnétique ! Regarde vers un anneau bleu et appuie sur ' + g.input.actionLabel('interact') + '.']], true);
      g.hud.objective('Utiliser le grappin pour franchir le vide');
    } });
    // détour : boulon d'or sur un rocher isolé
    props.grapple(V(-20, 13, 55), V(-27, 8.2, 62), { apex: 1.5, back: V(-13, 5, 53) });
    island(L, V(-27, 8, 62), 3, { seed: 41, flowers: false, depth: 6 });
    props.goldBolt(V(-27, 9.3, 62), 0);
    props.jumpPad(V(-27, 8, 64), V(-7, 4, 86), 5);

    // ------------------------------------------------ S3 : premier affrontement
    island(L, V(-6, 4, 90), 13, { seed: 51 });
    props.checkpoint(V(-6, 4, 82), 0);
    arch(L, V(-6, 4, 86), 0, 5, 5);
    bubbleTree(L, V(-13, 4, 95), 9);
    bubbleTree(L, V(1, 4, 96), 15, 0.8);
    crystals(L, V(-12, 4, 88), 4, true);
    props.crate(V(-1, 4, 88), 'bolt');
    props.crate(V(-11, 4, 92), 'ammo');
    props.crate(V(-9, 4, 98), 'boom');
    props.crate(V(-3, 4, 97), 'big');
    L.trigger({ sphere: [[-6, 4, 84], 5], fn: () => {
      g.enemies.spawn('larbin', V(-3, 4.2, 95), { elite: true });
      g.enemies.spawn('larbin', V(-10, 4.2, 97));
      g.enemies.spawn('tourelle', V(-6, 4, 99), { yaw: Math.PI });
      g.enemies.spawn('bourdon', V(-8, 4, 102));
      g.enemies.spawn('bourdon', V(0, 4, 104));
    } });
    // plateforme mobile vers Port-Nuage
    props.platform([[-3, 3.7, 106.5], [7, 5.7, 115]], { speed: 3, wait: 1.4, size: V(4, 0.6, 4), color: '#8a9ad0' });

    // ------------------------------------------------ S4 : Port-Nuage (village, Bazar)
    // mare du village, alimentée par une source qui jaillit d'un rocher fendu sur sa rive ouest : elle se déverse
    // par le flanc sud en une grande cascade, face à l'arrivée
    const port = island(L, V(10, 6, 130), 13, {
      seed: 61, clear: { x: 10, z: 130, r: 6 },
      carve: [{ x: 14, z: 121, r: 2.9, depth: 0.52 }, { a: [14, 121], b: [15.3, 117.6], r: 3, depth: 0.45, bank: 0.5 }],
      lips: [{ dir: 2.73, width: 5.2 }],
    });
    // place du village, pavée
    plaza(L, port, 10, 130, 6, { seed: 5 });
    const mare = islandPond(L, port, { at: [14, 121], lip: { dir: 2.73, width: 5.2, speed: 1.6 }, pads: 6, keep: [{ x: 12.3, z: 121.1, r: 1 }] });
    springRocks(L, mare, { at: [12.2, 121.1], dir: Math.PI / 2, h: 0.85 });
    mare.body.addLamp(V(14, 8.7, 125), '#ffc87a', 1.2);
    props.checkpoint(V(7, 6, 120), 0);
    stiltHouse(L, V(1, 6, 132), 0.8);
    stiltHouse(L, V(3.5, 6, 138.5), 2.2, { roof: 'b' });
    stiltHouse(L, V(19.3, 6, 125), -1.2, { roof: 'b' });
    props.vendor(V(16, 6, 132), -Math.PI / 2 - 0.2);
    // lanternes de la place : potences tournées vers le mât central
    for (const [x, z] of [[6, 125], [14, 125], [12, 137]]) lantern(L, V(x, 6, z), 2.6, { toward: [10, 130] });
    // guirlandes de fête : un grand mât au milieu de la place, quatre mâts à son bord, fanions bien au-dessus des têtes
    const FEST = [['#ff6f8a', '#ffd23a', '#7ff3ff', '#b8f07a'], ['#ffd23a', '#6a8cff', '#ff6f8a']];
    const top = V(10, 6, 130).add(V(0, mast(L, V(10, 6, 130), 7.2), 0));
    [[4.4, 130.5], [10.5, 135.6], [15.4, 128], [8.6, 124.6]].forEach(([x, z], i) => {
      const end = V(x, 6, z).add(V(0, mast(L, V(x, 6, z), 5.2), 0));
      bunting(L, top, end, FEST[i % 2], { sag: 0.45 });
    });
    barrel(L, V(17.2, 6, 129.6), { color: '#6a8cff' });
    props.crate(V(6.6, 6, 134.6), 'bolt');
    props.crate(V(7.7, 6, 135.4), 'bolt');
    props.crate(V(2, 6, 124), 'health');
    burner(balloon(L, V(-14, 10, 125), '#ff6f8a', { drift: 6 }), 0.12);
    burner(balloon(L, V(36, 14, 118), '#7ff3ff', { drift: 8 }), 0.12);
    burner(balloon(L, V(-6, 22, 160), '#ffd23a', { drift: 5 }), 0.12);
    // colonne au boulon d'or + nacelle-ascenseur (côté place, posée au-dessus de l'herbe en bas de course)
    const CX = 18.8, CZ = 137.2;
    column(L, V(CX, 6, CZ), 12);
    props.goldBolt(V(CX, 20.6, CZ), 1);
    const nacelle = props.platform([[CX - 3.6, 6.55, CZ], [CX - 3.6, 19.2, CZ]], { speed: 2.4, wait: 2, size: V(2.6, 0.5, 2.6), color: '#c09060' });
    // ballon au-dessus de la nacelle
    liftBalloon(nacelle.grp, '#ff6f8a');
    burner(nacelle.grp, 1.7);
    L.trigger({ sphere: [[10, 6, 126], 10], fn: () => g.hud.say([
      ['gigi', 'Re-bonjour, mon lapin à grandes oreilles ! Le Bazar Pétarade a une succursale dans les nuages. Nouvelles armes en rayon !'],
      ['ecrou', 'Les Vorax ont installé une base sur la grande île au bout de l’archipel. Il nous faut une arme sérieuse.'],
    ]) });

    // coffre céleste sur un îlot, au bout d'un pont de corde : verrou magnétique
    island(L, V(-11, 6, 118), 4, { seed: 131 });
    ropeBridge(L, V(-0.85, 6.05, 123.8), V(-7.9, 6.05, 119.8));
    {
      const C = V(-12.2, 6, 117.2), q = 1.03;
      skyVault(L, C, q);
      props.magDoor(V(C.x + Math.sin(q) * 2, 6, C.z + Math.cos(q) * 2), q, 2.6, 3.4);
      props.orbium(V(C.x - Math.sin(q) * 0.3, 6, C.z - Math.cos(q) * 0.3), 1);
      L.trigger({
        sphere: [[-6, 6, 121], 4],
        fn: () => g.hud.say([['ecrou', g.hasGadget('magneto')
          ? 'Un coffre céleste à verrou magnétique : un coup de Magnéto-clé !'
          : 'Un coffre à verrou magnétique… Il faudra revenir avec le bon outil.']]),
      });
    }

    // ------------------------------------------------ courants ascendants
    // îlot du ventilateur, sous le village : jamais retenu comme point de reprise (une chute renverrait dessus en boucle)
    island(L, V(20, -3, 152), 5, { seed: 71, depth: 8, flowers: false, tag: 'courant' });
    const fan = updraftFan(L, V(20, -2.9, 152));
    L.every((dt) => { fan.rotation.y += dt * 12; });
    L.wind([13, -3, 145], [27, 19, 159], 13);
    L.trigger({ sphere: [[12, 6, 142], 5], fn: () => {
      g.hud.say([['ecrou', 'Une colonne de vent ! Double saut, puis maintiens ' + g.input.actionLabel('jump') + ' pour planer : le courant nous portera jusqu’à l’île du haut.']], true);
      g.hud.objective('Remonter le courant ascendant');
    } });

    // ------------------------------------------------ S5 : île haute
    // source aux cristaux roses : un ruisseau file vers l'ouest et chute de toute la hauteur de l'archipel
    const haute = island(L, V(30, 18, 162), 10.5, {
      seed: 81,
      carve: [{ x: 24.8, z: 165.2, r: 1.7, depth: 0.45 }, { a: [24.8, 165.2], b: [19.2, 163.2], r: 1.6, depth: 0.4, bank: 0.6 }],
      lips: [{ dir: -1.45, width: 3 }],
    });
    const src5 = islandPond(L, haute, { at: [24.4, 165], lip: { dir: -1.45, width: 3, speed: 1.8 }, current: 0.4, keep: [{ x: 26, z: 165.6, r: 1.1 }], reeds: 2 });
    crystalSpring(L, src5, { at: [25.6, 165.4] });
    props.checkpoint(V(27, 18, 157), 0.6);
    bubbleTree(L, V(34, 18, 166), 18, 0.9);
    crystals(L, V(26.5, 18, 165.9), 5, true);
    props.crate(V(32, 18, 158), 'ammo');
    props.crate(V(33, 18, 159.2), 'bolt');
    L.trigger({ sphere: [[30, 18, 160], 7], fn: () => {
      g.enemies.spawn('bourdon', V(26, 18, 176));
      g.enemies.spawn('bourdon', V(34, 18, 178));
      g.enemies.spawn('tourelle', V(31, 18, 167), { yaw: Math.PI });
    } });
    // chaîne de grappins
    props.grapple(V(28, 27, 175), V(23.5, 24, 188), { apex: 1.2, back: V(30, 18, 169) });
    props.grapple(V(21, 28.5, 193), V(15, 20.2, 205), { apex: 2, back: V(25.5, 25.5, 181) });

    // ruines célestes, au-dessus de l'île haute : il faut le Propulseur
    island(L, V(44.6, 23.2, 154.3), 4.5, { seed: 121, mat: m2.islandGrey, depth: 7 });
    column(L, V(46.5, 23.2, 151.6), 3, true);
    column(L, V(47.4, 23.2, 156.4), 4.5);
    crystals(L, V(45.8, 23.2, 152), 5, true);
    props.orbium(V(44.6, 23.2, 155), 0, 3);
    props.crate(V(42.8, 23.2, 152.6), 'big');
    L.trigger({
      sphere: [[36, 18, 160], 6],
      fn: () => g.hud.say([['ecrou', g.hasGadget('propulseur')
        ? 'Les ruines célestes, juste au-dessus ! Double saut, puis le Propulseur.'
        : 'Des ruines flottent là-haut, avec un cristal d’Orbium… Hors de portée pour l’instant.']]),
    });

    // ------------------------------------------------ S6 : île de garnison
    island(L, V(14, 20, 208), 12.5, { seed: 91 });
    props.checkpoint(V(16, 20, 200), 0);
    column(L, V(8, 20, 204), 5, true);
    column(L, V(20, 20, 212), 7);
    crystals(L, V(9, 20, 213), 6);
    props.crate(V(18, 20, 204), 'bolt');
    props.crate(V(10, 20, 210), 'boom');
    props.crate(V(16, 20, 214), 'health');
    L.trigger({ sphere: [[15, 20, 202], 5], fn: () => {
      g.enemies.spawn('pinceur', V(14, 20.5, 212));
      g.enemies.spawn('boumboule', V(8, 20.5, 208));
      g.enemies.spawn('boumboule', V(19, 20.5, 207));
      g.enemies.spawn('larbin', V(11, 20.5, 215));
      g.enemies.spawn('larbin', V(18, 20.5, 216));
      g.hud.say([['ecrou', 'Un Pinceur ! Sa carapace avant est blindée. Contourne-le pour viser l’évent lumineux à l’arrière !']], true);
    } });
    // boulon d'or : île basse en contrebas
    island(L, V(-4, 12, 216), 3.5, { seed: 101 });
    props.goldBolt(V(-4, 13.3, 216), 2);
    props.jumpPad(V(-4, 12, 218.5), V(10, 20, 210), 5);

    // ------------------------------------------------ rails vers l'Aire du Vent
    props.rail([[13, 20.9, 218.5], [11, 19, 228], [6, 15, 238], [8, 11, 248], [3, 8.5, 258], [0, 7.2, 263]], { speed: 15, bolts: 2.5, color: '#7ff3ff' });
    L.trigger({ sphere: [[13, 20, 216], 4], fn: () => g.hud.objective('Glisser jusqu’à l’Aire du Vent') });

    // ------------------------------------------------ S7 : l'Aire du Vent (arène + boss)
    island(L, V(0, 6, 282), 21, { seed: 111, mat: m2.islandGrey });
    props.checkpoint(V(0, 6, 265), 0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      if (i === 0 || i === 4) continue;
      column(L, V(Math.sin(a) * 17, 6, 282 + Math.cos(a) * 17), i % 2 ? 6 : 9, i % 3 === 0);
    }
    arch(L, V(0, 6, 300), 0, 6, 7);
    crystals(L, V(-10, 6, 290), 6, true, 1.4);
    crystals(L, V(11, 6, 276), 5, false, 1.3);
    props.crate(V(-8, 6, 274), 'ammo');
    props.crate(V(9, 6, 289), 'ammo');
    props.crate(V(-12, 6, 284), 'health');
    // canon à nuages (sortie)
    const { barrel: barrelJ, mouth } = cloudCannon(L, V(0, 6, 300));
    barrelJ.rotation.x = 0.6; // incliné vers +z : c'est par là que Kobi est tiré
    L.every((dt, t) => { if (mouth.visible) mouth.scale.setScalar(1 + Math.sin(t * 8) * 0.06); });

    const arena = new Arena(g, {
      title: 'Les Vorax gardent l’Aire du Vent !',
      ammo: [V(4, 6, 271), V(-10, 6, 279), V(6, 6, 291)],
      waves: [
        { list: [['larbin', -6, 290], ['larbin', 6, 292], ['larbin', 0, 296, { elite: true }], ['bourdon', -10, 284], ['bourdon', 10, 286]], say: [['ecrou', 'Toute une garnison ! Sers-toi du décor pour te mettre à couvert.']] },
        { list: [['pinceur', -8, 292], ['pinceur', 8, 292], ['grignoteur', -4, 280], ['grignoteur', 4, 280], ['boumboule', 0, 288]] },
        { list: [['pinceurRoyal', 0, 292]], after: 2.5, say: [['baron', 'Mon Pinceur Royal ! Plaqué or, garanti trois générations. Pince-moi ce fennec !']] },
      ],
      reward: 1000,
      rewardPos: V(0, 10, 282),
      onDone: () => {
        mouth.visible = true;
        g.hud.say([
          ['ecrou', 'Victoire ! Et regarde ce canon à nuages : les Vorax s’en servent pour expédier leur matériel vers Givrelune, la lune glacée.'],
          ['ecrou', 'Le Baron y creuse une mine. Si on veut retrouver notre garage, il faut suivre la ferraille !'],
        ]);
        g.hud.objective('Embarquer dans le canon à nuages');
        L.interactables.push({ pos: V(0, 6, 297), radius: 4, label: 'Embarquer dans le canon à nuages', action: () => {
          // tir dans l'axe du fût, depuis la bouche
          const dir = V(0, 1, 0).applyQuaternion(barrelJ.getWorldQuaternion(new THREE.Quaternion()));
          const muzzle = mouth.getWorldPosition(V(0, 0, 0));
          g.audio.play('explosion', { big: true, pitch: 1.4 });
          g.fx.explosion(muzzle, 3, '#7ff3ff', { core: '#ffffff', smoke: true });
          g.player.pos.copy(muzzle).addScaledVector(dir, -1);
          g.player.pos.y -= 1; // pos = pieds de Kobi
          g.player.vel.copy(dir).multiplyScalar(43);
          g.player.ballistic = true;
          g.player.grounded = false;
          g.player.state = 'normal';
          g.state = 'cutscene';
          g.player.frozen = true;
          g.camera.setScript(V(-7, 10, 293), V(0, 12, 302), 3);
          let tt = 0;
          L.every((dt) => {
            if (tt < 0) return;
            tt += dt;
            g.camera.setScript(V(-7, 10 + tt * 7, 293 + tt * 4), g.player.pos.clone(), 4);
            g.fx.trail(g.player.center.clone(), '#7ff3ff', 0.8, 0.4, 0);
            if (tt > 1.9) { tt = -1; g.camera.clearScript(); g.player.frozen = false; g.levelComplete(); }
          });
        } });
      },
    });
    L.trigger({ sphere: [[0, 6, 280], 12], once: false, fn: () => { if (!arena.active && !arena.done) arena.start(); } });
    L.arena = arena;
    L.onPlayerRespawn = () => { if (arena.active) arena.reset(); };

    // îles-sources du décor (hors d'atteinte) : leurs lagons débordent en longues chutes, à l'ouest du départ et
    // face à l'Aire du Vent
    for (const [x, y, z, r, seed, dir, w] of [[-44, 13, 66, 8, 141, Math.PI / 2, 3.6], [30, 17, 322, 7.5, 151, -2.3, 3.2]]) {
      const lx = x + Math.sin(dir) * r * 0.55, lz = z + Math.cos(dir) * r * 0.55;
      const isl = island(L, V(x, y, z), r, {
        seed, grass: false, cell: 0.6,
        carve: [{ x: lx, z: lz, r: r * 0.42, depth: 0.6 }, { a: [lx, lz], b: [x + Math.sin(dir) * r * 1.1, z + Math.cos(dir) * r * 1.1], r: w * 0.6, depth: 0.4, bank: 0.6 }],
        lips: [{ dir, width: w }],
      });
      islandPond(L, isl, { at: [lx, lz], lip: { dir, width: w, speed: 1.8 }, water: { caustics: 0 }, spray: 0.6 });
      bubbleTree(L, V(x - Math.sin(dir) * r * 0.4, y, z - Math.cos(dir) * r * 0.4), seed, 1.3);
    }

    // décor lointain : îles flottantes à l'horizon
    for (let i = 0; i < 26; i++) {
      const a = rand(0, Math.PI * 2), d = rand(160, 380);
      const p = V(Math.cos(a) * d, rand(-15, 40), 140 + Math.sin(a) * d);
      island(L, p, rand(5, 14), { flowers: false, dangles: false, grass: false });
      if (Math.random() < 0.6) bubbleTree(L, V(p.x + rand(-2, 2), p.y, p.z + rand(-2, 2)), i, rand(1, 1.6));
    }
    // pelouse dense sur toutes les îles jouables (clairsemée sur les ruines grises), fleurs des prés en colonies
    lawn(L, L.islandTops.map((t) => ({ ...t, sparse: t.grey })), {
      avoid: [{ x: 16, z: 132, r: 2.2 }, { x: 0, z: 300, r: 3 }, { x: 20, z: 152, r: 2.8 }],
      flowers: { colors: ['#ffffff', '#ffd6ec', '#ff8ac8', '#fff2a6', '#b8c8ff'], amount: 0.06 },
      seed: 5,
    });
    motes(L, { count: 420, colorA: '#ffd6f0', colorB: '#ffffff', size: 0.12, drift: [0.8, 0.25, 0.5], glow: 1.2 });
    void rock; void clamp;
  },
  onStart(L, g) {
    g.hud.titleCard('Nimbara', 'L’Archipel des Brises');
    g.hud.objective('Rejoindre Port-Nuage');
    L.after(1.8, () => g.hud.say([
      ['ecrou', 'Nimbara ! Des îles qui flottent au-dessus des nuages. Attention où tu mets les pieds.'],
      ['ecrou', 'Si tu tombes, je te rattrape… mais ça coûte un peu de santé.'],
    ]));
  },
};
