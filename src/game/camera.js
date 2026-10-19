// Caméra à la troisième personne : orbite souris, épaule en visée, collisions, tremblements, plans scriptés.
import * as THREE from 'three';
import { clamp, damp, lerp, noise2 } from '../engine/util.js';

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _o = new THREE.Vector3();
const _side = new THREE.Vector3();

export class CameraRig {
  constructor(game, camera) {
    this.game = game;
    this.cam = camera;
    this.yaw = 0;
    this.pitch = -0.12;
    this.pivot = new THREE.Vector3();
    this.pivotSmooth = new THREE.Vector3();
    this.dist = 5.4;
    this.aimBlend = 0;
    this.trauma = 0;
    this.kick = 0;
    this.fovKick = 0;
    this.baseFov = 62;
    this.time = 0;
    this.forward = new THREE.Vector3(0, 0, 1);
    this.right = new THREE.Vector3(-1, 0, 0);
    this.collDist = 5.4;
    this.script = null; // { pos, look, lerp }
    this.scriptPos = new THREE.Vector3();
    this.scriptLook = new THREE.Vector3();
  }
  snapBehind(yaw, pitch = -0.15) {
    this.yaw = yaw;
    this.pitch = pitch;
    const p = this.game.player;
    if (p) {
      this.pivotSmooth.copy(p.pos).add(_v.set(0, 1.45, 0));
      this.collDist = this.dist;
    }
  }
  shake(amount) { this.trauma = Math.min(1, this.trauma + amount); }
  shakeAt(pos, amount) {
    const d = pos.distanceTo(this.cam.position);
    this.shake(amount * clamp(1.4 - d / 30, 0, 1));
  }
  recoil(a) { this.kick += a; }
  setScript(pos, look, speed = 3) {
    if (!this.script) {
      this.scriptPos.copy(this.cam.position);
      const f = new THREE.Vector3();
      this.cam.getWorldDirection(f);
      this.scriptLook.copy(this.cam.position).addScaledVector(f, 10);
    }
    this.script = { pos: pos.clone(), look: look.clone(), speed };
  }
  clearScript() { this.script = null; }

  update(dt, input) {
    this.time += dt;
    const g = this.game;
    const p = g.player;
    const cam = this.cam;

    if (this.script) {
      const s = this.script;
      if (s.speed <= 0) {
        this.scriptPos.copy(s.pos);
        this.scriptLook.copy(s.look);
      } else {
        this.scriptPos.lerp(s.pos, 1 - Math.exp(-s.speed * dt));
        this.scriptLook.lerp(s.look, 1 - Math.exp(-s.speed * 1.4 * dt));
      }
      cam.position.copy(this.scriptPos);
      this._applyShake(dt);
      cam.lookAt(this.scriptLook);
      cam.fov = damp(cam.fov, this.baseFov, 5, dt);
      cam.updateProjectionMatrix();
      this._updateVectors();
      return;
    }

    if (input && input.enabled && !this.game.hud.wheelOpen) {
      const { dx, dy } = input.lookDelta(dt);
      const sniperZoom = p && p.aimHeld && g.weapons && g.weapons.current === 'longuevue';
      const slow = sniperZoom ? 0.35 : p && p.aimHeld ? 0.75 : 1;
      this.yaw -= dx * slow;
      this.pitch = clamp(this.pitch - dy * slow, -1.2, 0.85);
    }
    if (!p) return;
    const aiming = p.aiming && p.state === 'normal';
    this.aimBlend = damp(this.aimBlend, p.aimHeld ? 1 : 0, 10, dt);
    // Longue-Vue : zoom de lunette en visée
    this.zoomBlend = damp(this.zoomBlend || 0, p.aimHeld && g.weapons && g.weapons.current === 'longuevue' ? 1 : 0, 9, dt);

    // pivot : suit le joueur, retard vertical doux
    const target = _v.copy(p.pos);
    target.y += 1.45;
    const ky = p.grounded || p.state === 'grind' ? 12 : (p.vel.y < -12 ? 14 : 5);
    this.pivotSmooth.x = damp(this.pivotSmooth.x, target.x, 28, dt);
    this.pivotSmooth.z = damp(this.pivotSmooth.z, target.z, 28, dt);
    this.pivotSmooth.y = damp(this.pivotSmooth.y, target.y, ky, dt);
    if (Math.abs(this.pivotSmooth.y - target.y) > 4) this.pivotSmooth.y = target.y - Math.sign(target.y - this.pivotSmooth.y) * 4;

    const speed = Math.hypot(p.vel.x, p.vel.z);
    const bossOn = g.hud.root.classList.contains('bossfight');
    this.bossBlend = damp(this.bossBlend || 0, bossOn ? 1 : 0, 2, dt);
    const wantDist = lerp(5.6 + clamp((speed - 9) * 0.15, 0, 1.6), 4.0, this.aimBlend) + (p.state === 'grind' ? 1.2 : 0) + this.bossBlend * 2.4;
    this.dist = damp(this.dist, wantDist, 6, dt);
    let shoulder = lerp(0.35, 0.85, this.aimBlend);

    const pitch = this.pitch + this.kick * 0.04;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const fx = Math.sin(this.yaw) * cp, fy = sp, fz = Math.cos(this.yaw) * cp;
    const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
    // épaule : on la rapproche si un mur se trouve sur le côté
    const blocks = (c) => c.blocksCamera;
    const sideHit = g.world.raycast(this.pivotSmooth, _side.set(rx, 0, rz), shoulder + 0.3, blocks);
    if (sideHit) shoulder = Math.max(0, Math.min(shoulder, sideHit.t - 0.3));
    this.shoulderSmooth = this.shoulderSmooth === undefined || shoulder < this.shoulderSmooth ? shoulder : damp(this.shoulderSmooth, shoulder, 6, dt);
    shoulder = this.shoulderSmooth;
    const pivot = this.pivot.copy(this.pivotSmooth);
    pivot.x += rx * shoulder;
    pivot.z += rz * shoulder;

    // collision caméra : rayon pivot (épaule comprise) → position voulue
    _d.set(-fx, -fy, -fz);
    const hit = g.world.raycast(_o.copy(pivot), _d, this.dist + 0.3, blocks);
    let d = this.dist;
    if (hit) d = Math.max(0.3, hit.t - 0.35);
    this.collDist = d < this.collDist ? d : damp(this.collDist, d, 4, dt);
    cam.position.set(pivot.x - fx * this.collDist, pivot.y - fy * this.collDist, pivot.z - fz * this.collDist);
    if (this.collDist < 1.3 || this.zoomBlend > 0.55) p.root.visible = false;
    // éviter de passer sous le sol (sans se hisser au-dessus d'un plafond ou d'une passerelle)
    const gh = g.world.groundBelow(cam.position.x, Math.min(cam.position.y + 0.5, pivot.y), cam.position.z, 4);
    if (gh && cam.position.y < gh.point.y + 0.4) cam.position.y = gh.point.y + 0.4;

    _v.set(pivot.x + fx * 20, pivot.y + fy * 20, pivot.z + fz * 20);
    cam.lookAt(_v);
    this._applyShake(dt);

    const fovTarget = this.baseFov + this.fovKick + clamp((speed - 10) * 0.9, 0, 14) - this.aimBlend * 5 - this.zoomBlend * 34 + (this.bossBlend || 0) * 6;
    cam.fov = damp(cam.fov, fovTarget, 6, dt);
    cam.updateProjectionMatrix();
    this.fovKick = damp(this.fovKick, 0, 4, dt);
    this.kick = damp(this.kick, 0, 12, dt);
    this._updateVectors();
    void aiming;
  }
  _applyShake(dt) {
    if (this.trauma > 0) {
      const s = this.trauma * this.trauma * (this.game.options?.shake ?? 1);
      const t = this.time * 22;
      this.cam.position.x += (noise2(t, 1.3) - 0.5) * s * 0.9;
      this.cam.position.y += (noise2(t, 7.1) - 0.5) * s * 0.9;
      this.cam.position.z += (noise2(t, 13.7) - 0.5) * s * 0.9;
      this.cam.rotation.z += (noise2(t, 21.9) - 0.5) * s * 0.12;
      this.trauma = Math.max(0, this.trauma - dt * 1.6);
    }
  }
  _updateVectors() {
    this.cam.getWorldDirection(this.forward);
    this.right.crossVectors(this.forward, this.cam.up).normalize();
    if (this.game.audio) this.game.audio.setListener(this.cam.position, this.right);
  }
}
