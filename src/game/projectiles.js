// Projectiles : du joueur (rivets, bombes, tartines, rayons-canard, lames, comètes, tirs de tourelle)
// et des ennemis (boules d'énergie, obus de mortier, missiles).
import * as THREE from 'three';
import { G } from '../models/geo.js';
import { mat, glow } from '../engine/materials.js';
import { rand, clamp } from '../engine/util.js';
import { LAYERS } from '../engine/frame.js';
import { fxLayer } from '../engine/particles/shared.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const C_SPORE = [new THREE.Color('#5aff9a'), new THREE.Color('#a0ffd0')];
const UP4 = new THREE.Vector3(0, 0.4, 0);
const RISE = new THREE.Vector3(0, 0.6, 0);
const _q = new THREE.Quaternion();
const Z = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);

const LOB = new Set(['mortar', 'snowball', 'spore']);
// traînées en rubans (couleur, largeur, durée de vie d'un point, intensité, fumée semée le long du trajet)
const TRAILS = {
  rivet: { color: '#ffb35a', width: 0.085, life: 0.13, glow: 3.5 },
  turretShot: { color: '#4dffa0', width: 0.07, life: 0.12, glow: 3.5 },
  bomb: { color: '#ffb03a', width: 0.05, life: 0.18, glow: 1.6 },
  bomblet: { color: '#ffb03a', width: 0.04, life: 0.15, glow: 1.6 },
  toast: { color: '#ff9a5a', width: 0.08, life: 0.22, glow: 1.6, smoke: { color: '#8a8080', size: 0.3, every: 0.7, alpha: 0.3 } },
  duckray: { color: '#fff27a', width: 0.2, life: 0.2, glow: 2.4 },
  saw: { color: '#ff4f6d', width: 0.1, life: 0.12, glow: 2 },
  comet: { color: '#d8a8ff', width: 0.22, life: 0.35, glow: 2.4, smoke: { color: '#706080', size: 0.6, every: 0.45, heat: 0.6, tint: '#ff9ad8' } },
  ruine: { color: '#ffcf5a', width: 0.1, life: 0.22, glow: 3, smoke: { color: '#5a4a5a', size: 0.4, every: 0.45, heat: 0.5 } },
  missile: { color: '#ff9a3a', width: 0.16, life: 0.3, glow: 2.4, smoke: { color: '#706080', size: 0.55, every: 0.45, heat: 0.6 } },
  ebolt: { color: '#ff4f9a', width: 0.2, life: 0.18, glow: 2.4 },
  snipe: { color: '#ff3a3a', width: 0.09, life: 0.14, glow: 3 },
  orb: { color: '#9a6aff', width: 0.14, life: 0.25, glow: 2 },
  mortar: { color: '#ff6a3a', width: 0.07, life: 0.2, glow: 1.5, smoke: { color: '#5a4a5a', size: 0.35, every: 0.7, alpha: 0.35 } },
  snowball: { color: '#dff4ff', width: 0.1, life: 0.2, glow: 0.8 },
  spore: { color: '#7affc8', width: 0.12, life: 0.25, glow: 1.2 },
};
const MARKER_GEO = {};
const TYPES = {
  rivet: { speed: 80, radius: 0.15, life: 1.6, gravity: 0, player: true },
  bomb: { speed: 0, radius: 0.32, life: 2.2, gravity: 26, player: true },
  bomblet: { speed: 0, radius: 0.22, life: 1.4, gravity: 26, player: true },
  toast: { speed: 32, radius: 0.25, life: 2, gravity: 0, player: true },
  duckray: { speed: 48, radius: 0.35, life: 1.4, gravity: 0, player: true },
  saw: { speed: 30, radius: 0.45, life: 3.2, gravity: 0, player: true },
  comet: { speed: 22, radius: 0.35, life: 4, gravity: 0, player: true },
  ruine: { speed: 24, radius: 0.3, life: 3.5, gravity: 0, player: true },
  turretShot: { speed: 60, radius: 0.15, life: 1.2, gravity: 0, player: true },
  ebolt: { speed: 17, radius: 0.32, life: 4, gravity: 0, player: false },
  mortar: { speed: 0, radius: 0.4, life: 5, gravity: 22, player: false },
  snowball: { speed: 0, radius: 0.45, life: 5, gravity: 22, player: false },
  spore: { speed: 0, radius: 0.4, life: 5, gravity: 22, player: false },
  missile: { speed: 15, radius: 0.4, life: 6, gravity: 0, player: false },
  snipe: { speed: 75, radius: 0.22, life: 1.5, gravity: 0, player: false },
  orb: { speed: 9, radius: 0.3, life: 5, gravity: 0, player: false },
};

function buildMesh(type) {
  const g = new THREE.Group();
  const add = (geo, m, p, r, s) => {
    const mesh = new THREE.Mesh(geo, m);
    if (p) mesh.position.set(...p);
    if (r) mesh.rotation.set(...r);
    if (s) mesh.scale.set(...s);
    g.add(mesh);
    return mesh;
  };
  switch (type) {
    case 'rivet':
      add(G.capsule(0.055, 0.9, 3, 8), glow('#ffcf5a', 3), [0, 0, -0.25], [Math.PI / 2, 0, 0]);
      add(G.capsule(0.11, 0.8, 3, 8), new THREE.MeshBasicMaterial({ color: '#ff8a2a', transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }), [0, 0, -0.35], [Math.PI / 2, 0, 0]);
      break;
    case 'turretShot':
      add(G.capsule(0.06, 0.4, 3, 8), glow('#4dffa0', 4), null, [Math.PI / 2, 0, 0]);
      break;
    case 'bomb':
    case 'bomblet': {
      const s = type === 'bomb' ? 1 : 0.7;
      add(G.sphere(0.28 * s, 14, 10), mat('#2a2438', { rough: 0.3, metal: 0.6 }));
      add(G.torus(0.22 * s, 0.05 * s, 6, 14), mat('#ff7b2a', { rough: 0.4, metal: 0.4 }), null, [Math.PI / 2, 0, 0]);
      for (let i = 0; i < 3; i++) add(G.torus(0.12 * s, 0.025 * s, 5, 10), mat('#c9d2e3', { metal: 0.9, rough: 0.3 }), [0, (0.28 + i * 0.06) * s, 0], [Math.PI / 2, 0, 0]);
      add(G.sphere(0.07 * s, 8, 6), glow('#ff4a2a', 4), [0, 0.48 * s, 0]);
      break;
    }
    case 'toast':
      add(G.rbox(0.32, 0.32, 0.08, 0.06), mat('#e0a060', { rough: 0.8, emissive: '#ff5a10', emissiveIntensity: 0.6 }));
      add(G.rbox(0.24, 0.24, 0.09, 0.05), mat('#f6d8a0', { rough: 0.9 }));
      break;
    case 'duckray':
      add(G.torus(0.3, 0.07, 8, 20), glow('#fff27a', 3.5));
      add(G.sphere(0.16, 10, 8), glow('#ffffff', 3));
      break;
    case 'saw': {
      const blade = new THREE.Group();
      const m = mat('#e8eef8', { rough: 0.2, metal: 0.95, emissive: '#ff4f6d', emissiveIntensity: 0.3 });
      const disc = new THREE.Mesh(G.cyl(0.42, 0.42, 0.04, 20), m);
      blade.add(disc);
      for (let i = 0; i < 10; i++) {
        const t = new THREE.Mesh(G.cone(0.07, 0.15, 4), m);
        const a = (i / 10) * Math.PI * 2;
        t.position.set(Math.cos(a) * 0.45, 0, Math.sin(a) * 0.45);
        t.rotation.set(0, -a, -Math.PI / 2);
        blade.add(t);
      }
      const hub = new THREE.Mesh(G.cyl(0.12, 0.12, 0.08, 10), glow('#ff4f6d', 3));
      blade.add(hub);
      g.add(blade);
      g.userData.blade = blade;
      break;
    }
    case 'comet':
      add(G.capsule(0.13, 0.5, 4, 10), mat('#b98aff', { rough: 0.3, metal: 0.5 }), null, [Math.PI / 2, 0, 0]);
      add(G.cone(0.14, 0.3, 10), mat('#ffd23a', { metal: 0.7, rough: 0.3 }), [0, 0, 0.45], [Math.PI / 2, 0, 0]);
      add(G.sphere(0.2, 10, 8), glow('#ffd8ff', 4), [0, 0, -0.42]);
      break;
    case 'ruine':
      // micro-roquette de la R.U.I.N.E. : fuselage noir, ogive dorée, réacteur rouge
      add(G.capsule(0.1, 0.42, 4, 10), mat('#24202e', { rough: 0.25, metal: 0.8 }), null, [Math.PI / 2, 0, 0]);
      add(G.cone(0.11, 0.26, 10), mat('#ffc83a', { metal: 0.85, rough: 0.2 }), [0, 0, 0.38], [Math.PI / 2, 0, 0]);
      add(G.torus(0.1, 0.025, 6, 12), glow('#ff3a4a', 2.4), [0, 0, -0.12]);
      add(G.sphere(0.12, 10, 8), glow('#ffb03a', 3), [0, 0, -0.34]);
      break;
    case 'ebolt':
      add(G.sphere(0.24, 12, 10), glow('#ff6aa0', 3.5));
      add(G.sphere(0.4, 12, 10), new THREE.MeshBasicMaterial({ color: '#ff3a8a', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      break;
    case 'snipe':
      add(G.capsule(0.07, 1.6, 3, 8), glow('#ff3a3a', 4), [0, 0, -0.5], [Math.PI / 2, 0, 0]);
      add(G.capsule(0.16, 1.4, 3, 8), new THREE.MeshBasicMaterial({ color: '#ff2a3a', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }), [0, 0, -0.6], [Math.PI / 2, 0, 0]);
      break;
    case 'orb':
      add(G.ico(0.18, 1), glow('#c890ff', 1.8));
      add(G.sphere(0.3, 12, 10), new THREE.MeshBasicMaterial({ color: '#7a4adf', transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
      break;
    case 'snowball':
      add(G.ico(0.42, 2), mat('#f2f8ff', { rough: 0.6 }));
      add(G.sphere(0.16, 8, 6), glow('#7ff3ff', 2), [0, 0.3, 0]);
      break;
    case 'spore':
      add(G.sphere(0.34, 12, 10), mat('#5aff9a', { rough: 0.3, emissive: '#1a8a4a', emissiveIntensity: 1.2 }));
      add(G.sphere(0.5, 12, 10), new THREE.MeshBasicMaterial({ color: '#7affc8', transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
      break;
    case 'mortar':
      add(G.sphere(0.36, 12, 10), mat('#3a2a3a', { rough: 0.4, metal: 0.5 }));
      add(G.sphere(0.14, 8, 6), glow('#ff3a2a', 4), [0, 0.3, 0]);
      break;
    case 'missile':
      add(G.capsule(0.16, 0.6, 4, 10), mat('#6a2bd0', { rough: 0.3, metal: 0.5 }), null, [Math.PI / 2, 0, 0]);
      add(G.cone(0.17, 0.3, 10), mat('#ffcc33', { metal: 0.7, rough: 0.3 }), [0, 0, 0.5], [Math.PI / 2, 0, 0]);
      add(G.sphere(0.2, 10, 8), glow('#ff8a3a', 4), [0, 0, -0.5]);
      break;
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  // halos transparents : couche des effets (visibles devant l'eau)
  return fxLayer(g);
}

export class Projectiles {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.pool = {};
    this.markers = [];
  }
  reset() {
    for (const p of this.list) this._release(p);
    this.list.length = 0;
    for (const m of this.markers) this._disposeMarker(m);
    this.markers.length = 0;
    this.clouds = [];
  }
  _get(type) {
    const arr = this.pool[type] || (this.pool[type] = []);
    const m = arr.pop() || buildMesh(type);
    this.game.scene.add(m);
    m.visible = true;
    return m;
  }
  _release(p) {
    if (p.rib) { p.rib.end(); p.rib = null; }
    p.mesh.parent && p.mesh.parent.remove(p.mesh);
    (this.pool[p.type] || (this.pool[p.type] = [])).push(p.mesh);
  }

  // dir : direction normalisée (ou vitesse pour les bombes/obus)
  spawn(type, pos, dir, o = {}) {
    const T = TYPES[type];
    const vel = T.speed ? dir.clone().normalize().multiplyScalar(o.speed || T.speed) : dir.clone();
    const p = {
      type, T, pos: pos.clone(), prev: pos.clone(), vel, life: o.life || T.life, age: 0,
      damage: o.damage || 10, source: o.source, radius: o.radius || 0, target: o.target || null,
      bounces: o.bounces ?? 0, ricochet: o.ricochet || 0, split: !!o.split, explosive: !!o.explosive, small: !!o.small,
      splitN: o.splitN || 0, pierce: o.pierce || 0, fast: !!o.fast, boom: o.boom || 0,
      hit: new Set(), mesh: this._get(type), bounceN: 0, wob: Math.random() * 6.3,
    };
    p.mesh.position.copy(pos);
    p.mesh.scale.setScalar(p.small ? 0.6 : (o.scale || 1));
    const tr = TRAILS[type];
    if (tr && this.game.fx.ribbon) {
      p.rib = this.game.fx.ribbon(p.small ? { ...tr, width: tr.width * 0.6 } : tr);
      p.rib.push(p.pos);
    }
    this.list.push(p);
    if (LOB.has(type) && o.targetPos) this._marker(o.targetPos, o.markerTime || 1.5, o.radius || 3.5, type === 'spore' ? '#5aff9a' : type === 'snowball' ? '#7fd8ff' : '#ff3a4a');
    return p;
  }

  // cercle d'impact au sol (recyclé : anneau et disque unitaires mis à l'échelle)
  _marker(pos, dur, r, color = '#ff3a4a') {
    const g = this.game;
    let mk = (this._markerPool || (this._markerPool = [])).pop();
    if (!mk) {
      if (!MARKER_GEO.ring) { MARKER_GEO.ring = new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2); MARKER_GEO.disc = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2); }
      const mesh = new THREE.Mesh(MARKER_GEO.ring, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
      const inner = new THREE.Mesh(MARKER_GEO.disc, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.18, depthWrite: false }));
      mesh.add(inner);
      // cercle d'alerte : visible aussi sur l'eau
      mesh.layers.set(LAYERS.FX);
      inner.layers.set(LAYERS.FX);
      mk = { mesh, inner };
    }
    mk.mesh.material.color.set(color);
    mk.inner.material.color.set(color);
    mk.mesh.scale.setScalar(r);
    mk.inner.scale.setScalar(0);
    mk.mesh.position.copy(pos);
    mk.mesh.position.y += 0.08;
    g.scene.add(mk.mesh);
    mk.t = 0;
    mk.dur = dur;
    this.markers.push(mk);
  }

  update(dt) {
    const g = this.game;
    const world = g.world;
    const enemies = g.enemies;
    const player = g.player;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.age += dt;
      if (p.age > p.life) {
        this._expire(p);
        this._release(p);
        this.list.splice(i, 1);
        continue;
      }
      p.prev.copy(p.pos);
      // comportements
      if (p.T.gravity) p.vel.y -= p.T.gravity * dt;
      if (p.type === 'comet' || p.type === 'ruine' || p.type === 'missile' || p.type === 'toast' || p.type === 'orb') this._home(p, dt);
      if (p.type === 'orb') { p.mesh.rotation.x += dt * 4; p.mesh.rotation.y += dt * 5; }
      if (p.type === 'saw') p.mesh.userData.blade.rotation.y += dt * 30;
      p.pos.addScaledVector(p.vel, dt);
      // orientation
      if (p.type === 'bomb' || p.type === 'bomblet' || LOB.has(p.type)) {
        p.mesh.rotation.x += dt * 6;
        p.mesh.rotation.z += dt * 4;
      } else if (p.type === 'duckray') {
        p.mesh.quaternion.setFromUnitVectors(Z, _v.copy(p.vel).normalize());
        p.mesh.rotateZ(p.age * 10);
      } else if (p.type !== 'saw' && p.type !== 'ebolt' && p.type !== 'orb') {
        p.mesh.quaternion.setFromUnitVectors(Z, _v.copy(p.vel).normalize());
      }
      p.mesh.position.copy(p.pos);
      // traînées : ruban continu, plus quelques éclats pour certains tirs
      if (p.rib) p.rib.push(p.pos);
      if (p.type === 'comet' || p.type === 'missile') g.fx.trail(p.pos, p.type === 'comet' ? '#ffb0ff' : '#ff9a3a', 0.5, 0.12, 0);
      else if (p.type === 'ruine' && Math.random() < 0.5) g.fx.trail(p.pos, '#ffcf5a', 0.3, 0.1, 0);
      else if (p.type === 'ebolt' && Math.random() < 0.5) g.fx.trail(p.pos, '#ff4f9a', 0.4, 0.15, 0);
      else if (p.type === 'duckray' && Math.random() < 0.6) g.fx.trail(p.pos, '#fff27a', 0.45, 0.3, 1);
      else if (p.type === 'saw' && Math.random() < 0.4) g.fx.trail(p.pos, '#ff4f6d', 0.35, 0.15, 1);
      else if ((p.type === 'bomb' || LOB.has(p.type)) && Math.random() < 0.6) g.fx.trail(_v.copy(p.pos).add(UP4), p.type === 'snowball' ? '#dff4ff' : p.type === 'spore' ? '#7affc8' : '#ffb03a', 0.25, 0.25, 1);

      const dist = p.prev.distanceTo(p.pos);
      const dir = _v.subVectors(p.pos, p.prev);
      if (dist > 1e-6) dir.divideScalar(dist);
      let remove = false;

      if (p.T.player) {
        // ennemis
        const eh = enemies.segmentHit(p.prev, p.pos, p.T.radius, p.hit);
        if (eh) {
          p.pos.copy(eh.point);
          remove = this._hitEnemy(p, eh.enemy, dir);
        }
      } else if (player.alive) {
        // Kobi
        const c = player.center;
        const r = p.T.radius + 0.5;
        if (segSphere(p.prev, p.pos, c, r)) {
          player.hurt(p.damage, p.prev, 6);
          g.fx.sparks(p.pos, null, 10, '#ff6aa0', 6);
          if (p.type === 'missile' || LOB.has(p.type)) this._enemyBoom(p);
          remove = true;
        }
      }
      // murs et sol
      if (!remove && dist > 0) {
        const wh = world.raycast(p.prev, dir, dist + p.T.radius * 0.5, (c) => c.tag !== 'jumppad' || true);
        if (wh) {
          remove = this._hitWorld(p, wh);
        }
      }
      // caisses
      if (!remove && p.T.player && p.type !== 'duckray') {
        if (g.props.hitSphere(p.pos, p.T.radius + 0.1, p.damage, dir)) {
          if (p.type === 'bomb' || p.type === 'bomblet' || p.type === 'comet' || p.type === 'ruine') { this._explode(p); remove = true; }
          else if (p.type !== 'saw') remove = true;
        }
      }
      if (remove) {
        this._release(p);
        this.list.splice(i, 1);
      }
    }
    // nuages de spores : piquent Kobi tant qu'il reste dedans
    if (this.clouds) for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      c.t += dt;
      if (Math.random() < 0.7) {
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * c.r;
        g.fx.puff(_v3.copy(c.pos).add(_v4.set(Math.cos(a) * d, 0.3, Math.sin(a) * d)), RISE, { life: 1.2, size: 0.6, size1: 1.6, color: C_SPORE[Math.random() < 0.5 ? 0 : 1], alpha: 0.35, tile: 0 });
      }
      c.tick -= dt;
      if (c.tick <= 0 && player.alive) {
        const dx = player.pos.x - c.pos.x, dz = player.pos.z - c.pos.z;
        if (Math.hypot(dx, dz) < c.r && Math.abs(player.pos.y - c.pos.y) < 2.5) { c.tick = 0.5; player.hurt(5, null, 0); }
      }
      if (c.t > c.life) this.clouds.splice(i, 1);
    }
    // marqueurs au sol
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i];
      m.t += dt;
      const k = m.t / m.dur;
      m.mesh.material.opacity = 0.4 + Math.sin(m.t * 20) * 0.3;
      m.inner.scale.setScalar(Math.min(1, k));
      if (m.t > m.dur + 0.2) {
        this._disposeMarker(m);
        this.markers.splice(i, 1);
      }
    }
  }

  _home(p, dt) {
    const g = this.game;
    let target = null;
    if (p.type === 'missile' || p.type === 'orb') target = g.player.alive ? g.player.center : null;
    else if (p.target && !p.target.dead) target = p.target.aimPoint();
    if (p.type === 'ruine') {
      // la salve s'ouvre en éventail, puis chaque roquette pique sur sa cible en louvoyant
      p.vel.setLength(Math.min(50, p.vel.length() + dt * 40));
      if ((!p.target || p.target.dead) && p.age > 0.15) {
        const e = g.enemies.nearest(p.pos, 35, true);
        p.target = e || null;
      }
      if (p.target && !p.target.dead && p.age > 0.16) {
        const want = _v2.subVectors(p.target.aimPoint(), p.pos).normalize();
        want.x += Math.sin(p.age * 14 + p.wob) * 0.25; want.y += Math.cos(p.age * 11 + p.wob) * 0.2;
        p.vel.lerp(want.normalize().multiplyScalar(p.vel.length()), 1 - Math.exp(-9 * dt));
      }
      return;
    }
    if (p.type === 'comet') {
      const sp = p.vel.length();
      p.vel.setLength(Math.min(p.fast ? 56 : 42, sp + dt * (p.fast ? 45 : 30)));
      if (!target && p.age > 0.2) {
        const e = g.enemies.nearest(p.pos, 30, true);
        if (e) { p.target = e; target = e.aimPoint(); }
      }
    }
    if (!target) return;
    const want = _v2.subVectors(target, p.pos).normalize().multiplyScalar(p.vel.length());
    const turn = p.type === 'comet' ? (p.age < 0.15 ? 2 : p.fast ? 11 : 7) : p.type === 'toast' ? 4 : p.type === 'orb' ? 1.1 : 1.6;
    p.vel.lerp(want, 1 - Math.exp(-turn * dt));
  }

  _hitEnemy(p, e, dir) {
    const g = this.game;
    switch (p.type) {
      case 'rivet':
      case 'turretShot': {
        e.damage(p.damage, { dir, knock: 1.2, source: p.source });
        g.fx.sparks(p.pos, dir.clone().negate(), 5, p.type === 'rivet' ? '#ffd36b' : '#4dffa0', 6, 0.14);
        if (p.ricochet > 0) {
          p.hit.add(e);
          const n = g.enemies.nearest(p.pos, 12, true, [...p.hit]);
          if (n) {
            p.ricochet--;
            p.vel.copy(_v2.subVectors(n.aimPoint(), p.pos).normalize().multiplyScalar(80));
            p.age = 0;
            p.life = 0.5;
            return false;
          }
        }
        return true;
      }
      case 'toast':
        e.damage(p.damage, { dir, knock: 2, source: p.source });
        g.fx.sparks(p.pos, null, 6, '#ffb35a', 5);
        if (p.explosive) g.explode(p.pos, 2.2, p.damage * 1.5, { source: p.source, color: '#ffb35a', smoke: false, debris: false });
        return true;
      case 'duckray':
        if (e.canDuck()) {
          const duck = e.toDuck(p.explosive);
          if (duck && p.boom) duck.boomR = p.boom;
        } else {
          e.damage(p.damage * 3, { dir, knock: 3, source: p.source });
          g.fx.sparks(p.pos, null, 14, '#fff27a', 7);
        }
        // Mare aux canards : le rayon traverse
        if (p.pierce > 0) { p.pierce--; p.hit.add(e); return false; }
        return true;
      case 'saw': {
        e.damage(p.damage, { dir, knock: 4, source: p.source });
        g.fx.sparks(p.pos, null, 14, '#ffd36b', 9, 0.2);
        g.audio.play('sawHit', { pos: p.pos });
        p.hit.add(e);
        p.bounceN++;
        if (p.bounceN > p.bounces) return true;
        const n = g.enemies.nearest(p.pos, 15, true, [...p.hit]);
        if (n) p.vel.copy(_v2.subVectors(n.aimPoint(), p.pos).normalize().multiplyScalar(30));
        else { p.vel.reflect(dir).multiplyScalar(0.9); p.hit.clear(); p.hit.add(e); }
        p.life = Math.max(p.life, p.age + 1.2);
        return false;
      }
      case 'bomb':
      case 'bomblet':
      case 'comet':
      case 'ruine':
        this._explode(p);
        return true;
    }
    return true;
  }

  _hitWorld(p, wh) {
    const g = this.game;
    const n = wh.normal;
    switch (p.type) {
      case 'bomb':
      case 'bomblet':
        p.pos.copy(wh.point).addScaledVector(n, p.T.radius + 0.02);
        p.vel.reflect(n).multiplyScalar(0.55);
        p.bounceN++;
        g.audio.play('boing', { pos: p.pos, pitch: p.type === 'bomb' ? 1 : 1.4, vol: 0.5 });
        if (p.bounceN >= 3 || p.vel.length() < 2) { this._explode(p); return true; }
        return false;
      case 'saw':
        p.pos.copy(wh.point).addScaledVector(n, 0.5);
        p.vel.reflect(n);
        p.vel.y = Math.max(p.vel.y, -2);
        g.fx.sparks(wh.point, n, 8, '#ffd36b', 7);
        g.audio.play('sawHit', { pos: p.pos, pitch: 1.3, vol: 0.6 });
        p.bounceN++;
        return p.bounceN > p.bounces + 2;
      case 'comet':
      case 'ruine':
      case 'missile':
        if (p.type !== 'missile') this._explode(p);
        else this._enemyBoom(p);
        return true;
      case 'mortar':
      case 'snowball':
      case 'spore':
        this._enemyBoom(p);
        return true;
      default:
        // impact selon la matière touchée (sable, métal, neige…)
        if (g.fx.impact) g.fx.impact(wh.point, n, wh.collider && wh.collider.surface, p.type === 'ebolt' ? '#ff6aa0' : p.type === 'turretShot' ? '#4dffa0' : '#ffd36b');
        else g.fx.sparks(wh.point, n, 4, p.type === 'ebolt' ? '#ff6aa0' : '#ffd36b', 5, 0.14);
        return true;
    }
  }

  _expire(p) {
    if (p.type === 'bomb' || p.type === 'bomblet' || p.type === 'comet' || p.type === 'ruine') this._explode(p);
    if (LOB.has(p.type) || p.type === 'missile') this._enemyBoom(p);
  }

  _explode(p) {
    const g = this.game;
    const r = p.type === 'bomblet' ? 3 : p.radius || 4;
    const col = p.type === 'comet' ? '#c08aff' : p.type === 'ruine' ? '#ffb03a' : '#ff8a2a';
    g.explode(p.pos, p.small ? 3 : r, p.damage, { source: p.source, color: col, core: p.type === 'comet' ? '#ffe8ff' : p.type === 'ruine' ? '#fff2c0' : undefined, debris: p.type === 'ruine' ? false : undefined });
    if (p.split && p.type === 'bomb') {
      const nb = p.splitN || 3;
      for (let k = 0; k < nb; k++) {
        const a = (k / nb) * Math.PI * 2;
        this.spawn('bomblet', p.pos.clone().add(new THREE.Vector3(0, 0.4, 0)), new THREE.Vector3(Math.cos(a) * 5, 8, Math.sin(a) * 5), { damage: p.damage * 0.5, source: p.source });
      }
    }
    if (p.split && (p.type === 'comet' || p.type === 'ruine')) {
      for (let k = 0; k < (p.splitN || 4); k++) {
        const d = new THREE.Vector3(rand(-1, 1), rand(0.3, 1), rand(-1, 1)).normalize();
        this.spawn(p.type, p.pos.clone().addScaledVector(d, 0.6), d, { damage: p.damage * 0.35, radius: 3, source: p.source, small: true, speed: 14 });
      }
    }
  }
  _enemyBoom(p) {
    const g = this.game;
    const pl = g.player;
    const r = p.radius || (LOB.has(p.type) ? 3.5 : 2.5);
    if (p.type === 'snowball') {
      g.fx.explosion(p.pos, r * 0.6, '#dff4ff', { core: '#ffffff', debrisColor: '#ffffff', smoke: false, shake: 0.25 });
      g.fx.sparks(p.pos, new THREE.Vector3(0, 1, 0), 18, '#ffffff', 7);
      g.audio.play('shatter', { pos: p.pos, pitch: 0.7, vol: 0.6 });
    } else if (p.type === 'spore') {
      g.fx.explosion(p.pos, r * 0.5, '#5aff9a', { core: '#c8ffe0', debris: false, smoke: false, shake: 0.15 });
      g.audio.play('pop', { pos: p.pos, pitch: 0.6 });
      // nuage toxique qui reste quelques secondes
      (this.clouds || (this.clouds = [])).push({ pos: p.pos.clone(), r: r * 0.9, t: 0, life: 4.5, tick: 0 });
    } else {
      g.fx.explosion(p.pos, r * 0.7, '#ff5a3a', { shake: 0.3 });
      g.audio.play('explosion', { pos: p.pos, pitch: 1.2 });
    }
    if (!pl.alive) return;
    if (LOB.has(p.type)) {
      // obus : exactement le cercle annoncé au sol
      const dy = pl.pos.y - p.pos.y;
      if (Math.hypot(pl.pos.x - p.pos.x, pl.pos.z - p.pos.z) < r && dy > -1.2 && dy < 1.6) pl.hurt(p.damage, p.pos, 9);
    } else if (pl.center.distanceTo(p.pos) < r + 0.4) pl.hurt(p.damage, p.pos, 9);
  }
  // retire projectiles ennemis et cercles d'obus (mort d'un boss, cinématique)
  clearHostile() {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (p.T.player) continue;
      this.game.fx.sparks(p.pos, null, 6, '#ffd36b', 4);
      this._release(p);
      this.list.splice(i, 1);
    }
    for (const m of this.markers) this._disposeMarker(m);
    this.markers.length = 0;
    this.clouds = [];
  }
  // le marqueur retourne dans la réserve (géométries partagées, matériaux réutilisés)
  _disposeMarker(m) {
    m.mesh.parent && m.mesh.parent.remove(m.mesh);
    (this._markerPool || (this._markerPool = [])).push(m);
  }
}

// Segment [a,b] contre sphère (c, r)
export function segSphere(a, b, c, r) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz;
  let t = l2 ? ((c.x - a.x) * abx + (c.y - a.y) * aby + (c.z - a.z) * abz) / l2 : 0;
  t = clamp(t, 0, 1);
  const px = a.x + abx * t - c.x, py = a.y + aby * t - c.y, pz = a.z + abz * t - c.z;
  return px * px + py * py + pz * pz <= r * r;
}
void _q; void UP;
