// Ramassables : pluie de boulons (écrous argentés + gros boulons dorés), nano-santé, munitions.
// Rendu instancié, physique simple avec rebonds, aimantation vers Kobi, compteur qui tinte.
import * as THREE from 'three';
import { G } from '../models/geo.js';
import { mat, glow } from '../engine/materials.js';
import { rand, clamp } from '../engine/util.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();

const KINDS = {
  nut: { max: 500, scale: 1 },
  bolt: { max: 160, scale: 1.3 },
  health: { max: 30, scale: 1 },
  ammo: { max: 30, scale: 1 },
  orbium: { max: 30, scale: 1 },
};

export class Pickups {
  constructor(game) {
    this.game = game;
    this.items = [];
    this.meshes = {};
    const scene = game.scene;
    const make = (kind, geo, material) => {
      const m = new THREE.InstancedMesh(geo, material, KINDS[kind].max);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      scene.add(m);
      this.meshes[kind] = m;
    };
    make('nut', G.nut(0.13, 0.07), mat('#dfe6f2', { rough: 0.22, metal: 0.95, emissive: '#3a4152', emissiveIntensity: 0.6 }));
    make('bolt', G.bolt(0.12), mat('#ffc93a', { rough: 0.25, metal: 0.9, emissive: '#6b4200', emissiveIntensity: 0.7 }));
    make('health', G.ico(0.22, 2), mat('#4dff9a', { rough: 0.1, metal: 0.1, emissive: '#18c060', emissiveIntensity: 0.7, transparent: true, opacity: 0.9 }));
    make('ammo', G.rbox(0.42, 0.3, 0.3, 0.06), mat('#4aa3ff', { rough: 0.4, metal: 0.5, emissive: '#1b4f9a', emissiveIntensity: 0.8 }));
    make('orbium', new THREE.OctahedronGeometry(0.26, 0).scale(0.8, 1.35, 0.8), mat('#c06aff', { rough: 0.08, metal: 0.3, emissive: '#7a2ad8', emissiveIntensity: 1.4, flat: true }));
    // halo autour de la santé
    this.combo = 0;
    this.comboT = 0;
    this.magnetRadius = 8.5;
    void glow;
  }

  reset() {
    this.items.length = 0;
    for (const m of Object.values(this.meshes)) m.count = 0;
  }

  _floor(p) {
    const hit = this.game.world.groundBelow(p.x, p.y + 0.6, p.z, 60);
    return hit ? hit.point.y : -1e9;
  }

  // Disperse une valeur totale de boulons en plusieurs objets
  spawnBolts(pos, total, opts = {}) {
    total = Math.round(total);
    if (total <= 0) return;
    const floor = this._floor(pos);
    const pieces = [];
    let remaining = total;
    const bigVal = total >= 300 ? 50 : total >= 120 ? 25 : 0;
    while (bigVal && remaining > bigVal * 2 && pieces.length < 8) { pieces.push(['bolt', bigVal]); remaining -= bigVal; }
    const n = clamp(Math.round(remaining / 6), 3, 28);
    const per = remaining / n;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const v = Math.round(per * (i + 1)) - acc;
      acc += v;
      pieces.push(['nut', v]);
    }
    const spread = opts.spread ?? 1;
    for (const [kind, value] of pieces) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(1.5, 4.5) * spread;
      this._add(kind, pos, new THREE.Vector3(Math.cos(a) * sp, rand(5, 9) * (opts.up ?? 1), Math.sin(a) * sp), value, floor);
    }
  }
  // Boulon fixe (rangées le long d'un chemin, au-dessus d'un rail...)
  placeBolt(pos, value = 5, kind = 'nut') {
    const it = this._add(kind, pos, new THREE.Vector3(), value, -1e9);
    it.fixed = true;
    it.life = 1e9;
    return it;
  }
  spawnHealth(pos, amount = 20, n = 1) {
    const floor = this._floor(pos);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this._add('health', pos, new THREE.Vector3(Math.cos(a) * 2, 6, Math.sin(a) * 2), amount, floor);
    }
  }
  spawnOrbium(pos, n = 1) {
    const floor = this._floor(pos);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this._add('orbium', pos, new THREE.Vector3(Math.cos(a) * 2.5, 7, Math.sin(a) * 2.5), 1, floor);
    }
  }
  spawnAmmo(pos, n = 1) {
    const floor = this._floor(pos);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this._add('ammo', pos, new THREE.Vector3(Math.cos(a) * 2, 6, Math.sin(a) * 2), 1, floor);
    }
  }
  _add(kind, pos, vel, value, floor) {
    if (this.items.filter((i) => i.kind === kind).length >= KINDS[kind].max) {
      // recycle le plus ancien de ce type (en le donnant directement)
      const idx = this.items.findIndex((i) => i.kind === kind && !i.fixed);
      if (idx >= 0) { this._collect(this.items[idx], true); this.items.splice(idx, 1); }
    }
    const it = {
      kind, value,
      p: pos.clone(), v: vel,
      r: new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)),
      w: new THREE.Vector3(rand(-8, 8), rand(-8, 8), rand(-8, 8)),
      age: 0, life: kind === 'nut' || kind === 'bolt' ? 22 : kind === 'orbium' ? 90 : 40,
      floor, fixed: false, magnet: false, bounces: 0,
    };
    this.items.push(it);
    return it;
  }

  _collect(it, silent) {
    const g = this.game;
    if (it.kind === 'nut' || it.kind === 'bolt') {
      g.addBolts(Math.round(it.value * g.boltFactor * (1 + (g.up ? g.up.sum('bolts') : 0))));
      if (!silent) {
        this.combo = Math.min(this.combo + 1, 24);
        this.comboT = 0.35;
        g.audio.play(it.kind === 'bolt' ? 'boltGold' : 'bolt', { pitch: 1 + this.combo * 0.035, vol: it.kind === 'bolt' ? 0.6 : 1 });
        g.fx.pickupBurst(it.p, it.kind === 'bolt' ? '#ffd23a' : '#e6f0ff', 3);
      }
    } else if (it.kind === 'health') {
      g.player.heal(it.value);
      g.audio.play('heal');
      g.fx.pickupBurst(it.p, '#4dff9a', 10);
      g.hud.flashHealth();
    } else if (it.kind === 'orbium') {
      g.up.addOrbium(it.value);
      g.audio.play('goldbolt', { pitch: 1.7, vol: 0.6 });
      g.fx.pickupBurst(it.p, '#d08aff', 12);
    } else if (it.kind === 'ammo') {
      g.weapons.pickupAmmo();
      g.audio.play('ammo');
      g.fx.pickupBurst(it.p, '#4aa3ff', 8);
    }
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    const pc = _v.copy(p.pos);
    pc.y += 0.8;
    this.comboT -= dt;
    if (this.comboT <= 0) this.combo = 0;
    const alive = p.alive;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      if (it.age > it.life || it.p.y < g.level.killY - 5) { this.items.splice(i, 1); continue; }
      const dx = pc.x - it.p.x, dy = pc.y - it.p.y, dz = pc.z - it.p.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const needs = it.kind === 'health' ? p.hp < p.maxHp : it.kind === 'ammo' ? g.weapons.needsAmmo() : true;
      if (alive && needs && (it.age > 0.3 || it.fixed) && d < (it.fixed ? 2.2 : this.magnetRadius)) it.magnet = true;
      if (it.magnet && alive) {
        const sp = 10 + Math.min(it.age, 2) * 14;
        const k = 1 - Math.exp(-10 * dt);
        it.v.x += (dx / d * sp - it.v.x) * k;
        it.v.y += (dy / d * sp - it.v.y) * k;
        it.v.z += (dz / d * sp - it.v.z) * k;
        it.p.addScaledVector(it.v, dt);
        if (d < 0.75) {
          this._collect(it);
          this.items.splice(i, 1);
          continue;
        }
      } else if (!it.fixed) {
        it.v.y -= 26 * dt;
        it.p.addScaledVector(it.v, dt);
        if (it.p.y < it.floor + 0.12) {
          it.p.y = it.floor + 0.12;
          if (it.bounces < 3 && Math.abs(it.v.y) > 1.5) {
            it.v.y = -it.v.y * 0.42;
            it.bounces++;
            if (it.bounces === 1 && Math.random() < 0.15) g.audio.play('coin', { pos: it.p, pitch: rand(0.8, 1.3), vol: 0.4 });
          } else it.v.y = 0;
          it.v.x *= 0.55; it.v.z *= 0.55;
          it.w.multiplyScalar(0.7);
        }
      }
      if (it.fixed || it.v.y === 0) {
        it.r.y += dt * 3;
        it.r.x = it.r.x * 0.9;
      } else {
        it.r.x += it.w.x * dt; it.r.y += it.w.y * dt; it.r.z += it.w.z * dt;
      }
      // scintillement
      if (Math.random() < dt * (it.kind === 'orbium' ? 6 : 0.6) && d < 30) g.fx.trail(it.p, it.kind === 'bolt' ? '#ffdd66' : it.kind === 'orbium' ? '#d08aff' : '#ffffff', 0.35, 0.25, 1, 0.8);
    }
    // rendu
    const counts = { nut: 0, bolt: 0, health: 0, ammo: 0, orbium: 0 };
    const t = g.time;
    for (const it of this.items) {
      const mesh = this.meshes[it.kind];
      const k = counts[it.kind]++;
      const blink = it.life - it.age < 3 && Math.floor(it.age * 10) % 2 === 0 ? 0.001 : 1;
      let sc = KINDS[it.kind].scale * blink * Math.min(1, it.age * 6 + (it.fixed ? 1 : 0.3));
      _q.setFromEuler(it.r);
      _s.setScalar(sc);
      if (it.kind === 'health') _s.setScalar(sc * (1 + Math.sin(t * 6) * 0.1));
      const hover = (it.fixed || it.kind === 'health' || it.kind === 'ammo' || it.kind === 'orbium') && it.v.y === 0 ? Math.sin(t * 3 + it.p.x) * 0.08 + 0.15 : 0;
      _m.compose(_v.set(it.p.x, it.p.y + hover, it.p.z), _q, _s);
      mesh.setMatrixAt(k, _m);
    }
    for (const [kind, mesh] of Object.entries(this.meshes)) {
      mesh.count = counts[kind];
      mesh.instanceMatrix.needsUpdate = true;
    }
    void _e;
  }
}
