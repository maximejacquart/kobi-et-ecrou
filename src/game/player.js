// Contrôleur de Kobi : déplacements nerveux, double saut + vrille, plané, esquive, combos à la clé,
// attaque plongeante, glisse sur rails, grappin, tremplins, plateformes mobiles, dégâts et réapparition.
import * as THREE from 'three';
import { createHero } from '../models/hero.js';
import { clamp, damp, dampAngle, angleDiff, rand } from '../engine/util.js';
import { setFlash } from '../engine/materials.js';
import { waterImpulse } from '../engine/water/water.js';

const R = 0.36; // rayon des sphères de collision
const SPHERES = [R, 0.95];
const GRAV = 33;
const JUMP_V = 11.4;
const DJUMP_V = 10.6;
const RUN = 8.8;
const AIM_RUN = 7.2;
const GLIDE_FALL = -2.4;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _c = new THREE.Vector3();
const _contacts = [];
const _down = new THREE.Vector3(0, -1, 0);
const _up = new THREE.Vector3(0, 1, 0);
const _mc = new THREE.Vector3();
const _mfwd = new THREE.Vector3();

export class Player {
  constructor(game) {
    this.game = game;
    this.rig = createHero();
    this.root = this.rig.root;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.visYaw = 0;
    this.grounded = false;
    this.wasGrounded = false;
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.groundCol = null;
    this.coyote = 0;
    this.jumpBuf = 0;
    this.jumps = 0;
    this.jumpCut = false;
    this.gliding = false;
    this.dashT = 0;
    this.dashCD = 0;
    this.hp = 100;
    this.maxHp = 100;
    this.invuln = 0;
    this.state = 'normal';
    this.melee = { t: 0, combo: 0, queued: false, hit: false, dur: 0.3 };
    this.slamT = 0;
    this.rail = null;
    this.railS = 0;
    this.railDir = 1;
    this.railSpeed = 0;
    this.railCD = 0;
    this.grapple = null;
    this.grappleT = 0;
    this.safe = [];
    this.safeT = 0;
    this.stepAcc = 0;
    this.aimT = 0;
    this.aiming = false;
    this.aimHeld = false;
    this.deadT = 0;
    this.fallT = 0;
    this.airTime = 0;
    this.padLock = 0;
    this.hipYaw = 0;
    this.frozen = false;
    this.victory = false;
    this.rope = this._makeRope();
    this.blob = this._makeBlob();
    this.knock = new THREE.Vector3();
    this.carry = new THREE.Vector3(); // élan hérité d'une plateforme mobile
    this.wallN = new THREE.Vector3(); // normale de la paroi rainurée touchée (saut mural)
    this.wallT = 0;
    this.longJump = false;
    this.lastHurt = -10;
    this.burnT = 0;
  }

  _makeRope() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#7ff3ff' }));
    line.frustumCulled = false;
    line.visible = false;
    return line;
  }

  _makeBlob() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(10,6,20,0.85)');
    gr.addColorStop(0.6, 'rgba(10,6,20,0.45)');
    gr.addColorStop(1, 'rgba(10,6,20,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    m.renderOrder = 2;
    m.userData.noAO = true;
    return m;
  }

  addToScene(scene) {
    scene.add(this.root);
    scene.add(this.rope);
    scene.add(this.blob);
  }

  spawn(pos, yaw = 0) {
    this.shieldUsed = false;
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.yaw = this.visYaw = yaw;
    this.state = 'normal';
    this.grounded = false;
    this.rail = null;
    this.grapple = null;
    this.gliding = false;
    this.safe.length = 0;
    this.invuln = 1;
    this.hp = this.maxHp;
    this.rope.visible = false;
    this.rig.root.visible = true;
    this.victory = false;
    this.slamT = 0;
    this.ballistic = false;
    this._clearTransient();
    this.melee.t = 0;
    this.game.audio.loop('glide', false);
    this.game.audio.loop('grind', false);
    this.rig.body.rotation.set(0, 0, 0);
    this.root.position.copy(this.pos);
    this.root.rotation.y = yaw;
  }

  // esquive, saut mémorisé et élan : effacés à chaque transition (tremplin, rail, grappin, réapparition)
  _clearTransient() {
    this.boostUsed = false;
    this.dashT = 0;
    this.jumpBuf = 0;
    this.carry.set(0, 0, 0);
  }

  get center() { return _c.copy(this.pos).setY(this.pos.y + 0.8); }
  get alive() { return this.state !== 'dead'; }

  // ------------------------------------------------------------- dégâts
  hurt(amount, from, knock = 7) {
    const g = this.game;
    if (this.invuln > 0 || this.state === 'dead' || g.cheats?.god) return false;
    // jamais de dégâts pendant une cinématique ou la fin d'un niveau
    if (g.state === 'cutscene' || g.state === 'complete' || this.frozen) return false;
    // mode Défi et courbe de difficulté : les coups font plus mal sur les dernières planètes
    amount *= g.dp.dmg * (1 + 0.1 * (g.tier || 0));
    g.chainBreak();
    if (this.hp - amount <= 0 && g.up.has('bouclier') && !this.shieldUsed) {
      this.shieldUsed = true;
      amount = Math.max(0, this.hp - 1);
      this.invuln = 2.2;
      g.audio.play('forcefield', { pitch: 1.5 });
      g.fx.ring(this.center, '#7ff3ff', 3.5, 0.6);
      g.fx.sparks(this.center, null, 30, '#7ff3ff', 8);
      g.hud.notify('Bouclier d’Écrou ! Coup fatal évité', '#7ff3ff', 3);
    }
    this.hp -= amount;
    this.invuln = Math.max(this.invuln, 1.1);
    this.lastHurt = g.time;
    g.audio.play('hurt', { pitch: 0.9 + Math.random() * 0.2 });
    g.camera.shake(0.45);
    g.hud.damage(amount);
    g.hitStop(0.05);
    this.rig.anim.doHurt();
    setFlash(this.rig.materials, 0.6, '#ff3040');
    this._flashT = 0.12;
    if (from) {
      _v.copy(this.pos).sub(from).setY(0).normalize();
      this.vel.x += _v.x * knock;
      this.vel.z += _v.z * knock;
      if (this.grounded && this.state === 'normal') { this.vel.y = 5; this.grounded = false; }
    }
    if (this.hp <= 0) this.die();
    return true;
  }
  heal(n) {
    this.hp = Math.min(this.maxHp, this.hp + n);
  }
  die() {
    const g = this.game;
    this.hp = 0;
    this.state = 'dead';
    this.deadT = 0;
    this.gliding = false;
    this.rail = null;
    this.grapple = null;
    this.rope.visible = false;
    g.audio.play('death');
    g.audio.stopAllLoops();
    g.fx.explosion(this.center, 1.6, '#7ff3ff', { core: '#ffffff', debris: false, smoke: true, shake: 0.4 });
    g.hud.say([['ecrou', 'Aïe ! Accroche-toi, je te ramène au dernier point de contrôle…', 2.4]], true);
    g.stats.deaths++;
    g.chainBreak();
  }
  respawn() {
    const g = this.game;
    const cp = g.level.checkpoint;
    this.spawn(cp.pos, cp.yaw);
    g.camera.snapBehind(cp.yaw);
    g.fx.ring(this.pos, '#7ff3ff', 3, 0.6);
    g.audio.play('checkpoint', { pitch: 0.8 });
    g.enemies.onPlayerRespawn();
    g.level.onPlayerRespawn && g.level.onPlayerRespawn();
  }
  fallOut() {
    const g = this.game;
    const spot = this.safe.length ? this.safe[0] : g.level.checkpoint.pos;
    g.audio.play('whoosh', { pitch: 0.6 });
    if (this.hp - 10 <= 0 && !g.cheats?.god) { this.die(); return; }
    if (!g.cheats?.god) { this.hp -= 10; g.chainBreak(); }
    g.hud.damage(10);
    this.pos.copy(spot);
    this.vel.set(0, 0, 0);
    this.invuln = 1.2;
    this.slamT = 0;
    this.ballistic = false;
    this._clearTransient();
    this.rail = null;
    this.grapple = null;
    this.rope.visible = false;
    this.state = 'normal';
    g.camera.snapBehind(g.camera.yaw, g.camera.pitch);
    g.fx.ring(this.pos, '#7ff3ff', 2.5, 0.5);
  }

  // ------------------------------------------------------------- mise à jour
  update(dt) {
    const g = this.game;
    const input = g.input;
    this.invuln = Math.max(0, this.invuln - dt);
    if (this.state !== 'dead' && g.up.has('regen') && g.time - this.lastHurt > 6 && this.hp < this.maxHp && g.enemies.alertCount() === 0) {
      this.hp = Math.min(this.maxHp, this.hp + 5 * dt);
    }
    if (this._flashT > 0) {
      this._flashT -= dt;
      if (this._flashT <= 0) setFlash(this.rig.materials, 0);
    }
    // clignotement d'invulnérabilité
    this.rig.root.visible = this.state === 'dead' ? this.deadT < 0.05 : !(this.invuln > 0 && this.invuln < 1.05 && Math.floor(this.invuln * 18) % 2 === 0 && g.time - this.lastHurt < 1.2);

    if (this.state === 'dead') {
      this.deadT += dt;
      if (this.deadT > 2.2) this.respawn();
      this._animate(dt, 0);
      return;
    }

    const frozen = this.frozen || !input.enabled;
    const mv = frozen ? { x: 0, y: 0 } : input.moveVector();
    const cam = g.camera;
    const cy = cam.yaw;
    const fwdX = Math.sin(cy), fwdZ = Math.cos(cy);
    const rgtX = -Math.cos(cy), rgtZ = Math.sin(cy);
    const wishX = fwdX * mv.y + rgtX * mv.x;
    const wishZ = fwdZ * mv.y + rgtZ * mv.x;
    const wishLen = Math.hypot(wishX, wishZ);

    // visée
    const w = g.weapons;
    this.aimHeld = !frozen && input.down('aim');
    const firing = !frozen && w && w.isFiring();
    if (firing || this.aimHeld) this.aimT = 0.7;
    this.aimT = Math.max(0, this.aimT - dt);
    this.aiming = this.aimT > 0 && this.state === 'normal' && this.melee.t === 0;

    if (!frozen) {
      if (input.pressed('jump')) this.jumpBuf = 0.14;
    }
    this.jumpBuf = Math.max(0, this.jumpBuf - dt);
    this.dashCD = Math.max(0, this.dashCD - dt);
    this.railCD = Math.max(0, this.railCD - dt);
    this.padLock = Math.max(0, this.padLock - dt);

    // plateforme mobile : entraînement
    if (this.grounded && this.groundCol && this.groundCol.dynamic) {
      const gc = this.groundCol;
      this.pos.add(gc.deltaPos);
      if (gc.deltaYaw) {
        _v.copy(this.pos).sub(gc.pivot);
        _v.applyAxisAngle(_v2.set(0, 1, 0), gc.deltaYaw);
        this.pos.copy(gc.pivot).add(_v);
        this.yaw += gc.deltaYaw;
        cam.yaw += gc.deltaYaw;
      }
    }

    if (this.state === 'grind') this._updateGrind(dt, frozen);
    else if (this.state === 'grapple') this._updateGrapple(dt);
    else this._updateNormal(dt, frozen, wishX, wishZ, wishLen);

    // limites du monde
    if (this.pos.y < g.level.killY) this.fallOut();

    // points sûrs
    this.safeT += dt;
    if (this.grounded && this.state === 'normal' && this.groundCol && !this.groundCol.dynamic && !this.groundCol.tag && this.safeT > 0.35) {
      this.safeT = 0;
      this.safe.push(this.pos.clone());
      if (this.safe.length > 6) this.safe.shift();
    }

    this._updateInteract(frozen);
    this._animate(dt, wishLen);
  }

  _updateNormal(dt, frozen, wishX, wishZ, wishLen) {
    const g = this.game;
    const input = g.input;
    const audio = g.audio;
    const fx = g.fx;
    let grounded = this.grounded;

    if (grounded) { this.coyote = 0.12; this.airTime = 0; }
    else { this.coyote = Math.max(0, this.coyote - dt); this.airTime += dt; }

    // ---- esquive ----
    if (!frozen && input.pressed('dash') && this.dashCD <= 0 && (grounded || (this.airDashes || 0) < (g.up.has('air') ? 2 : 1)) && this.slamT <= 0) {
      let dx = wishX, dz = wishZ;
      if (wishLen < 0.1) { dx = Math.sin(this.yaw); dz = Math.cos(this.yaw); }
      const l = Math.hypot(dx, dz) || 1;
      const dsp = g.up.has('roulade') ? 28 : 23;
      this.vel.x = (dx / l) * dsp;
      this.vel.z = (dz / l) * dsp;
      if (!grounded) { this.vel.y = Math.max(this.vel.y, 1.5); this.airDashes = (this.airDashes || 0) + 1; }
      this.dashT = 0.17;
      this.dashCD = g.up.has('esquive') ? 0.35 : 0.5;
      this.invuln = Math.max(this.invuln, 0.25);
      this.rig.anim.doDash();
      audio.play('dash');
      fx.dust(this.pos, 6, this._dustColor(), 2.5, 0.8);
      if (!this.aiming) this.yaw = Math.atan2(dx, dz);
      g.camera.fovKick += 6;
    }
    const dashing = this.dashT > 0;
    if (dashing) {
      this.dashT -= dt;
      if (Math.random() < 0.8) fx.trail(this.center, '#7ff3ff', 0.9, 0.2, 0, 0.5);
      if (this.dashT <= 0) { this.vel.x *= 0.42; this.vel.z *= 0.42; }
    }

    // ---- attaque à la clé ----
    const m = this.melee;
    if (!frozen && input.pressed('melee') && this.slamT <= 0) {
      const gh = g.world.groundBelow(this.pos.x, this.pos.y + 0.3, this.pos.z, 30);
      const height = gh ? this.pos.y - gh.point.y : 99;
      if (!grounded && height > 1.3 && this.airTime > 0.12) {
        // attaque plongeante
        this.slamT = 1;
        this.vel.set(this.vel.x * 0.15, -28, this.vel.z * 0.15);
        this.gliding = false;
        audio.play('whoosh', { pitch: 1.4 });
        this.rig.anim.doMelee(2);
      } else if (m.t === 0) {
        this._startSwing(0);
      } else if (m.t > m.dur * 0.45) {
        m.queued = true;
      }
    }
    if (m.t > 0) {
      m.t += dt;
      const hitAt = m.combo === 2 ? 0.17 : 0.1;
      if (!m.hit && m.t >= hitAt) { m.hit = true; this._meleeHit(); }
      if (m.t >= m.dur) {
        if (m.queued && m.combo < 2) this._startSwing(m.combo + 1);
        else { m.t = 0; m.combo = 0; m.queued = false; }
      }
    }

    // ---- saut ----
    this.wallT = Math.max(0, this.wallT - dt);
    if (!frozen && this.jumpBuf > 0 && this.slamT <= 0 && !grounded && this.wallT > 0 && this.coyote <= 0) {
      // saut mural : on rebondit sur la paroi rainurée
      this.vel.x = this.wallN.x * 9.5;
      this.vel.z = this.wallN.z * 9.5;
      this.vel.y = JUMP_V * 1.02;
      this.yaw = Math.atan2(this.wallN.x, this.wallN.z);
      this.jumps = 1;
      this.jumpCut = true;
      this.wallT = 0;
      this.jumpBuf = 0;
      this.ballistic = true;
      this.padLock = 0.18;
      audio.play('djump', { pitch: 0.9 });
      fx.dust(this.pos.clone().addScaledVector(this.wallN, -0.3).setY(this.pos.y + 0.8), 6, this._dustColor(), 1.5, 0.6);
      this.rig.anim.doFlip(1);
    } else if (!frozen && this.jumpBuf > 0 && this.slamT <= 0) {
      if ((grounded || this.coyote > 0) && dashing) {
        // saut en longueur : l'élan de l'esquive est conservé, longue trajectoire rasante
        const hl = Math.hypot(this.vel.x, this.vel.z) || 1;
        const sp = Math.min(16.5, Math.max(13, hl));
        this.vel.x = (this.vel.x / hl) * sp;
        this.vel.z = (this.vel.z / hl) * sp;
        this.vel.y = 8.6;
        this.dashT = 0;
        this.jumps = 2; // pas de double saut, mais le plané reste possible
        this.jumpCut = true;
        this.ballistic = true;
        this.longJump = true;
        this.grounded = false;
        grounded = false;
        this.coyote = 0;
        this.jumpBuf = 0;
        audio.play('jump', { pitch: 0.85 });
        audio.play('whoosh', { pitch: 1.1 });
        fx.dust(this.pos, 8, this._dustColor(), 2.5, 0.7);
        this.rig.anim.doLongJump();
        g.camera.fovKick += 6;
      } else if ((grounded || this.coyote > 0) && this.aiming && wishLen > 0.35) {
        // en visée : saut latéral (vrille sur le côté) ou saut arrière, plus long qu'un saut normal
        const cy = g.camera.yaw;
        const lat = wishX * -Math.cos(cy) + wishZ * Math.sin(cy);
        const fwd = wishX * Math.sin(cy) + wishZ * Math.cos(cy);
        this.vel.y = JUMP_V * 0.92;
        this.vel.x += wishX * 4.5;
        this.vel.z += wishZ * 4.5;
        this.jumps = 1;
        this.jumpCut = true;
        this.grounded = false;
        grounded = false;
        this.coyote = 0;
        this.jumpBuf = 0;
        audio.play('jump', { pitch: 1.15 });
        fx.dust(this.pos, 4, this._dustColor(), 1.5, 0.6);
        if (Math.abs(lat) > Math.abs(fwd)) this.rig.anim.doSideFlip(lat > 0 ? 1 : -1);
        else if (fwd < 0) this.rig.anim.doFlip(-1);
        else this.rig.anim.doLand(-6);
      } else if (grounded || this.coyote > 0) {
        const gcj = this.groundCol;
        if (gcj && gcj.dynamic && gcj.deltaPos && dt > 0) {
          this.carry.set(gcj.deltaPos.x / dt, 0, gcj.deltaPos.z / dt);
          if (this.carry.lengthSq() > 400) this.carry.setLength(20);
          this.vel.add(this.carry);
        }
        this.vel.y = JUMP_V;
        this.jumps = 1;
        this.jumpCut = false;
        this.grounded = false;
        grounded = false;
        this.coyote = 0;
        this.jumpBuf = 0;
        audio.play('jump');
        fx.dust(this.pos, 4, this._dustColor(), 1.5, 0.6);
        this.rig.anim.doLand(-6);
      } else if (this.jumps >= 2 && !this.boostUsed && !this.longJump && g.hasGadget('propulseur')) {
        // Propulseur d'Écrou : une poussée verticale après le double saut
        this.vel.y = 13.5;
        this.boostUsed = true;
        this.ballistic = false;
        this.jumpBuf = 0;
        this.jumpCut = true;
        this._jetT = 0.75;
        if (this.gliding) { this.gliding = false; audio.loop('glide', false); }
        audio.play('rocket', { pitch: 1.7, vol: 0.5 });
        audio.play('djump', { pitch: 0.75 });
        fx.ring(this.pos, '#8ff7ff', 2.2, 0.4, 0.2, 0.7);
        for (let k = 0; k < 6; k++) fx.trail(this.pos.clone().add(new THREE.Vector3(rand(-0.3, 0.3), 0.3, rand(-0.3, 0.3))), '#8ff7ff', 0.5, 0.35, 0);
        g.camera.fovKick += 5;
      } else if (this.jumps < 2) {
        const third = false;
        this.vel.y = DJUMP_V;
        this.ballistic = false;
        this.jumps = 2;
        this.jumpCut = true;
        this.jumpBuf = 0;
        this.rig.anim.doFlip(1);
        audio.play('djump', { pitch: third ? 1.25 : 1 });
        fx.ring(this.pos, '#bff6ff', 1.6, 0.35, 0.2, 0.7);
        this._jetT = 0.35;
      }
    }
    if (!frozen && !input.down('jump') && this.vel.y > 0 && this.jumps === 1 && !this.jumpCut && this.padLock <= 0) {
      this.vel.y *= 0.5;
      this.jumpCut = true;
    }

    // ---- planeur ----
    const wantGlide = !frozen && !grounded && this.jumps >= 2 && input.down('jump') && (this.vel.y < 0 || this.gliding) && this.slamT <= 0 && !dashing;
    if (wantGlide !== this.gliding) {
      this.gliding = wantGlide;
      audio.loop('glide', wantGlide);
    }

    // ---- vitesse horizontale ----
    const runK = g.up.has('course') ? 1.07 : 1;
    let maxSpeed = (this.aiming ? AIM_RUN : RUN) * runK;
    if (this.gliding) maxSpeed = g.up.has('plane') ? 11.8 : 9.8;
    if (m.t > 0 && grounded) maxSpeed *= 0.35;
    const ice = grounded && this.groundCol && this.groundCol.surface === 'ice';
    if (ice) maxSpeed = Math.max(maxSpeed, 11.5);
    if (!dashing && this.slamT <= 0) {
      const hs = Math.hypot(this.vel.x, this.vel.z);
      // en vol balistique (ou en glissade sur la glace), orienter sans freiner
      const cap = this.ballistic || ice ? Math.max(maxSpeed, hs) : maxSpeed;
      const tx = wishX * cap + (grounded ? 0 : this.carry.x), tz = wishZ * cap + (grounded ? 0 : this.carry.z);
      let accel;
      if (ice) accel = wishLen > 0.05 ? 15 : 2.2;
      else if (grounded) accel = wishLen > 0.05 ? 80 : 62;
      else if (this.ballistic) accel = wishLen > 0.05 ? 7 : 0; // trajectoire de tremplin/grappin préservée
      else if (wishLen > 0.05) accel = hs > maxSpeed + 0.5 ? 9 : 30;
      else accel = hs > maxSpeed ? 2 : 6;
      const dx = tx - this.vel.x, dz = tz - this.vel.z;
      const dl = Math.hypot(dx, dz);
      const stepA = accel * dt;
      if (dl <= stepA) { this.vel.x = tx; this.vel.z = tz; }
      else { this.vel.x += (dx / dl) * stepA; this.vel.z += (dz / dl) * stepA; }
      // frottement plus fort sur l'excès de vitesse au sol
      if (grounded && !ice && hs > maxSpeed * 1.4) {
        this.vel.x = damp(this.vel.x, tx, 4, dt);
        this.vel.z = damp(this.vel.z, tz, 4, dt);
      }
    }

    // ---- gravité ----
    const wallSlide = !grounded && this.wallT > 0.06 && this.vel.y < 0 && !this.gliding;
    this.wallSliding = wallSlide;
    if (wallSlide) this.vel.y = Math.max(this.vel.y - GRAV * 0.4 * dt, -3.2);
    else if (dashing && !grounded) this.vel.y = Math.max(this.vel.y - GRAV * 0.25 * dt, 0);
    else if (!grounded) {
      if (this.gliding) {
        // planeur : chute lente, ou ascension dans un courant
        const wind = g.level.windAt ? g.level.windAt(this.pos) : 0;
        this.vel.y = damp(this.vel.y, wind || (g.up.has('plane') ? GLIDE_FALL * 0.7 : GLIDE_FALL), wind ? 4 : 7, dt);
      } else {
        const mult = this.vel.y < 0 ? 1.3 : 1;
        this.vel.y -= GRAV * mult * dt;
      }
      this.vel.y = Math.max(this.vel.y, -34);
    } else {
      this.vel.y = Math.min(this.vel.y, 0);
      // pente glacée : la gravité entraîne Kobi vers le bas
      if (ice && this.groundNormal.y < 0.985) {
        const n = this.groundNormal;
        this.vel.x += n.x * n.y * 30 * dt;
        this.vel.z += n.z * n.y * 30 * dt;
      }
    }

    // ---- intégration et collisions ----
    this.wasGrounded = grounded;
    const fallSpeed = -this.vel.y;
    this._move(dt);

    // atterrissage
    if (this.grounded && !this.wasGrounded) {
      this.ballistic = false;
      this.jumps = 0;
      this.airDashes = 0;
      this.jumpCut = false;
      this.carry.set(0, 0, 0);
      this.longJump = false;
      this.boostUsed = false;
      if (this.gliding) { this.gliding = false; audio.loop('glide', false); }
      const impact = clamp(fallSpeed / 25, 0, 1);
      this.rig.anim.doLand(4 + impact * 10);
      // eau peu profonde (ou lave, acide) : gerbe et ondes
      if (fallSpeed > 3) waterImpulse(this.pos, 0.35 + impact * 1.2);
      if (this.slamT > 0) this._slamImpact();
      else if (fallSpeed > 4) {
        audio.play('land', { vol: 0.5 + impact });
        fx.dust(this.pos, 4 + Math.floor(impact * 8), this._dustColor(), 2 + impact * 2, 0.7);
        if (impact > 0.6) g.camera.shake(0.12);
      }
    }
    if (this.slamT > 0 && this.grounded === false) {
      fx.trail(this.center, '#ffe27a', 0.6, 0.15, 1);
      this.slamT = Math.max(0, this.slamT - dt * 0.7);
    }

    // surfaces spéciales
    const gc = this.grounded ? this.groundCol : null;
    if (gc) {
      if (gc.conveyor) this.pos.addScaledVector(gc.conveyor, dt);
      if (gc.tag === 'jumppad' && this.padLock <= 0) this._launchPad(gc.user);
      if (gc.tag === 'lava') this._burn(gc);
    }

    // orientation
    if (this.aiming) {
      this.yaw = dampAngle(this.yaw, g.camera.yaw, 25, dt);
      // hanches vers le déplacement
      if (wishLen > 0.1 && grounded) {
        let a = angleDiff(this.yaw, Math.atan2(wishX, wishZ));
        let back = false;
        if (Math.abs(a) > Math.PI / 2) { a = angleDiff(this.yaw, Math.atan2(-wishX, -wishZ)); back = true; }
        this.hipYaw = clamp(a, -1.0, 1.0);
        this.strafeBack = back;
      } else { this.hipYaw = 0; this.strafeBack = false; }
    } else {
      this.hipYaw = 0;
      this.strafeBack = false;
      const hs = Math.hypot(this.vel.x, this.vel.z);
      if (wishLen > 0.1 && !dashing) this.yaw = dampAngle(this.yaw, Math.atan2(wishX, wishZ), grounded ? 16 : 8, dt);
      else if (hs > 3 && dashing) this.yaw = dampAngle(this.yaw, Math.atan2(this.vel.x, this.vel.z), 20, dt);
    }

    // pas
    if (this.grounded) {
      const hs = Math.hypot(this.vel.x, this.vel.z);
      if (hs > 1.5) {
        this.stepAcc += dt * (5 + hs * 0.9) / Math.PI;
        if (this.stepAcc >= 1) {
          this.stepAcc -= 1;
          const surf = gc ? gc.surface : 'rock';
          audio.play('step', { surface: surf, pitch: 0.9 + Math.random() * 0.2 });
          waterImpulse(this.pos, 0.12 + hs * 0.012);
          if (hs > 6 && surf !== 'metal') fx.dust(this.pos, 1, this._dustColor(), 0.6, 0.45);
        }
      }
    }

    // rails : accroche en tombant
    if (!this.grounded && this.vel.y <= 3 && this.railCD <= 0 && g.level.rails.length) this._tryRail();
    // jets du double saut
    this._jetT = Math.max(0, (this._jetT || 0) - dt);
  }

  _startSwing(combo) {
    const m = this.melee;
    m.combo = combo;
    m.t = 0.0001;
    m.hit = false;
    m.queued = false;
    m.dur = (combo === 2 ? 0.42 : 0.28) * (this.game.up.has('combo') ? 0.82 : 1);
    this.rig.anim.doMelee(combo);
    this.game.audio.play('swing', { pitch: 0.9 + combo * 0.12 });
    this.game.weapons && this.game.weapons.showWrench(m.dur + 0.1);
    // s'oriente vers la cible la plus proche
    const e = this.game.enemies.nearest(this.pos, 4.5, true);
    if (e) this.yaw = Math.atan2(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
    else if (this.aimT > 0) this.yaw = this.game.camera.yaw;
    if (combo === 2 && this.grounded) {
      this.vel.x += Math.sin(this.yaw) * 7;
      this.vel.z += Math.cos(this.yaw) * 7;
    }
  }

  _meleeHit() {
    const g = this.game;
    const combo = this.melee.combo;
    const dmg = [22, 26, 42][combo] * (g.weapons ? g.weapons.wrenchMult() : 1);
    const fwd = _mfwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const center = _mc.copy(this.pos).addScaledVector(fwd, 1.0);
    center.y += 0.8;
    let hitAny = false;
    const hits = g.enemies.inSphere(center, 1.9);
    for (const e of hits) {
      e.damage(dmg, { dir: fwd, knock: combo === 2 ? 11 : 5, source: 'wrench', melee: true });
      hitAny = true;
    }
    if (g.props.hitSphere(center, 1.6, dmg, fwd)) hitAny = true;
    if (g.up.has('renvoi')) {
      for (const pr of g.projectiles.list) {
        if (pr.T.player || pr.age > pr.life) continue;
        if (pr.pos.distanceTo(center) > 2.4) continue;
        pr.life = 0;
        const tgt = g.enemies.nearest(this.pos, 30, true);
        const dirR = tgt ? _v.subVectors(tgt.aimPoint(), pr.pos).normalize() : fwd.clone();
        g.projectiles.spawn('rivet', pr.pos.clone(), dirR, { damage: 30, source: 'wrench' });
        g.fx.sparks(pr.pos, dirR, 10, '#ffe7a0', 8);
        hitAny = true;
      }
    }
    if (hitAny) {
      g.hitStop(combo === 2 ? 0.07 : 0.045);
      if (combo === 2) g.punch(0.35);
      g.camera.shake(combo === 2 ? 0.25 : 0.12);
      g.audio.play('hit', { pitch: 0.9 + combo * 0.1 });
      g.fx.sparks(center, fwd, 12, '#ffe7a0', 8);
    }
  }

  _slamImpact() {
    const g = this.game;
    this.slamT = 0;
    const dmg = 48 * (g.weapons ? g.weapons.wrenchMult() : 1);
    g.audio.play('slam');
    g.camera.shake(0.5);
    g.punch(0.5);
    g.hitStop(0.06);
    g.fx.ring(this.pos, '#ffe27a', 5, 0.45, 0.4);
    g.fx.ring(this.pos, '#ffffff', 3.2, 0.3, 0.2);
    g.fx.dust(this.pos, 14, this._dustColor(), 5, 1.2);
    g.fx.sparks(this.center, null, 16, '#ffe7a0', 10);
    const slamR = g.up.has('onde') ? 5.9 : 4.2;
    if (slamR > 4.2) g.fx.ring(this.pos, '#ffcf6a', slamR + 1, 0.5, 0.3);
    for (const e of g.enemies.inSphere(this.pos, slamR)) {
      _v.copy(e.pos).sub(this.pos).setY(0).normalize();
      e.damage(dmg, { dir: _v, knock: 12, up: 6, source: 'wrench', melee: true });
    }
    g.props.hitSphere(this.pos, 3.5, dmg, null);
  }

  _launchPad(pad) {
    const g = this.game;
    this._clearTransient();
    this.vel.copy(pad.launch);
    this.grounded = false;
    this.jumps = 1;
    this.jumpCut = true;
    this.padLock = 0.4;
    this.ballistic = true;
    this.pos.y += 0.1;
    pad.bounce && pad.bounce();
    g.audio.play('pad', { pos: this.pos });
    g.fx.ring(this.pos, '#7fffb0', 3, 0.4);
    g.camera.fovKick += 10;
    this.rig.anim.doFlip(1);
  }

  _burn(col) {
    const g = this.game;
    if (this.burnT > 0) return;
    this.burnT = 0.5;
    this._clearTransient();
    this.vel.y = 13;
    this.grounded = false;
    this.jumps = 1;
    this.jumpCut = true;
    this.padLock = 0.3;
    g.fx.sparks(this.pos, new THREE.Vector3(0, 1, 0), 18, col.user?.spark || '#ff8a2a', 9);
    g.fx.smoke(this.pos, 4, '#3a2a2a', 0.8);
    g.audio.play('splash', { pitch: 1.4 });
    this.hurt(col.user?.damage ?? 18, null, 0);
    if (this.state !== 'dead') this.invuln = 0.6;
  }

  _dustColor() {
    return this.game.level?.dustColor || '#e8c9a0';
  }

  // Déplacement avec résolution de collisions par sphères empilées
  _move(dt) {
    const g = this.game;
    const world = g.world;
    const disp = _v.copy(this.vel).multiplyScalar(dt);
    const len = disp.length();
    const steps = Math.max(1, Math.ceil(len / 0.25));
    disp.divideScalar(steps);
    let grounded = false;
    let groundCol = null;
    this.groundNormal.set(0, 1, 0);
    for (let s = 0; s < steps; s++) {
      this.pos.add(disp);
      for (let iter = 0; iter < 2; iter++) {
        for (let k = 0; k < SPHERES.length; k++) {
          _c.set(this.pos.x, this.pos.y + SPHERES[k], this.pos.z);
          world.sphereContacts(_c, R, _contacts);
          for (const ct of _contacts) {
            const n = ct.normal;
            // les sphères hautes ne servent pas d'appui
            if (k === 0 && n.y > 0.55 && !(this.vel.y > 0.5 && !this.wasGrounded)) {
              // repose sur le sol : on remonte verticalement pour ne pas glisser
              const lift = ct.depth / Math.max(n.y, 0.55);
              this.pos.y += Math.min(lift, ct.depth * 2);
              grounded = true;
              groundCol = ct.collider;
              this.groundNormal.copy(n);
              if (this.vel.y < 0) this.vel.y = 0;
            } else {
              // montée de marche : petit rebord franchi sans saut
              if (k === 0 && Math.abs(n.y) < 0.55 && (this.wasGrounded || grounded) && this.vel.y <= 0.5 && this._stepUp(n)) continue;
              this.pos.addScaledVector(n, ct.depth);
              const vn = this.vel.dot(n);
              if (vn < 0) this.vel.addScaledVector(n, -vn);
              if (ct.collider.tag === 'walljump' && Math.abs(n.y) < 0.35 && !this.wasGrounded) {
                this.wallN.set(n.x, 0, n.z).normalize();
                this.wallT = 0.14;
              }
              if (n.y < -0.5 && this.vel.y > 0) this.vel.y = 0;
            }
            if (ct.collider.bounce && n.y > 0.5) {
              this.vel.y = ct.collider.bounce;
              grounded = false;
            }
          }
        }
      }
    }
    // accroche au sol (pentes descendantes, marches)
    if (!grounded && this.wasGrounded && this.vel.y <= 0.01 && this.padLock <= 0) {
      const hit = world.raycast(_v2.set(this.pos.x, this.pos.y + 0.4, this.pos.z), _down, 0.4 + 0.5);
      if (hit && hit.normal.y > 0.55) {
        this.pos.y = hit.point.y;
        grounded = true;
        groundCol = hit.collider;
        this.groundNormal.copy(hit.normal);
        this.vel.y = 0;
      }
    }
    this.grounded = grounded;
    this.groundCol = groundCol;
    this.burnT = Math.max(0, this.burnT - dt);
  }

  _stepUp(n) {
    const world = this.game.world;
    const px = this.pos.x - n.x * (R + 0.15), pz = this.pos.z - n.z * (R + 0.15);
    const hit = world.raycast(_v2.set(px, this.pos.y + 0.62, pz), _down, 0.62);
    if (!hit || hit.normal.y < 0.7) return false;
    const rise = hit.point.y - this.pos.y;
    if (rise <= 0.02 || rise > 0.6) return false;
    // la tête ne doit pas heurter un plafond
    if (world.raycast(_c.set(this.pos.x, this.pos.y + 1.3, this.pos.z), _up, rise + 0.1)) return false;
    this.pos.y = hit.point.y + 0.01;
    return true;
  }

  // ------------------------------------------------------------- rails
  _tryRail() {
    const g = this.game;
    for (const rail of g.level.rails) {
      const c = rail.closest(this.pos);
      // accroche tolérante : le rail « aspire » Kobi s'il passe à proximité
      if (c.dist < 1.3 && this.pos.y > c.point.y - 0.95) {
        this.state = 'grind';
        this.ballistic = false;
        this.slamT = 0;
        this._clearTransient();
        this.rail = rail;
        this.railS = c.s;
        const t = rail.tangent(c.s, _v2);
        const along = this.vel.x * t.x + this.vel.y * t.y + this.vel.z * t.z;
        this.railDir = along >= 0 ? 1 : -1;
        if (rail.oneWay) this.railDir = 1;
        this.railSpeed = Math.max(Math.abs(along), rail.speed || 13);
        this.gliding = false;
        g.audio.loop('glide', false);
        g.audio.loop('grind', true);
        g.audio.play('land', { pitch: 1.6, vol: 0.6 });
        g.fx.sparks(c.point, null, 14, '#ffd36b', 6);
        this.jumps = 0;
        return;
      }
    }
  }
  _updateGrind(dt, frozen) {
    const g = this.game;
    const rail = this.rail;
    const target = rail.speed || 13;
    this.railSpeed = damp(this.railSpeed, target, 1.5, dt);
    this.railS += this.railSpeed * this.railDir * dt;
    const t = rail.tangent(this.railS, _v2).multiplyScalar(this.railDir);
    if (this.railS < 0 || this.railS > rail.length) {
      // fin du rail : éjection
      this._leaveRail(t, 4);
      return;
    }
    const p = rail.point(this.railS, _v);
    this.pos.copy(p);
    this.vel.copy(t).multiplyScalar(this.railSpeed);
    this.yaw = dampAngle(this.yaw, Math.atan2(t.x, t.z), 12, dt);
    this.grounded = false;
    this.lean = clamp(angleDiff(this._prevRailYaw ?? this.yaw, Math.atan2(t.x, t.z)) / dt * 0.15, -0.6, 0.6);
    this._prevRailYaw = Math.atan2(t.x, t.z);
    if (Math.random() < 0.7) g.fx.sparks(this.pos, t.clone().multiplyScalar(-1), 2, '#ffd36b', 5, 0.14);
    if (!frozen && this.jumpBuf > 0) {
      this.jumpBuf = 0;
      // saut de rail : on peut changer de rail latéralement
      const mv = g.input.moveVector();
      const cy = g.camera.yaw;
      const wx = Math.sin(cy) * mv.y - Math.cos(cy) * mv.x, wz = Math.cos(cy) * mv.y + Math.sin(cy) * mv.x;
      const nl = Math.hypot(t.x, t.z) || 1;
      const nx = -t.z / nl, nz = t.x / nl;
      const lat = clamp(wx * nx + wz * nz, -1, 1);
      const side = new THREE.Vector3(nx, 0, nz).multiplyScalar(lat * 5.5);
      this._leaveRail(t, JUMP_V * 0.95, side);
      g.audio.play('jump', { pitch: 1.1 });
      this.railCD = 0.25;
    }
    this._jetT = 0;
  }
  _leaveRail(t, up, side) {
    const g = this.game;
    this.state = 'normal';
    this.vel.copy(t).multiplyScalar(this.railSpeed * 0.85);
    this.vel.y = Math.max(this.vel.y, 0) + up;
    if (side) this.vel.add(side);
    this.jumps = 1;
    this.jumpCut = true;
    this.padLock = 0.2;
    this.rail = null;
    this.railCD = Math.max(this.railCD, 0.3);
    this.grounded = false;
    g.audio.loop('grind', false);
  }

  // ------------------------------------------------------------- grappin
  _findGrapple() {
    const g = this.game;
    let best = null, bestScore = -Infinity;
    for (const gp of g.level.grapples) {
      _v.copy(gp.pos).sub(this.pos);
      const d = _v.length();
      if (d > gp.range || d < 2) continue;
      _v.normalize();
      const cf = g.camera.forward;
      const hl = Math.hypot(_v.x, _v.z) || 1, cl = Math.hypot(cf.x, cf.z) || 1;
      const facing = Math.max(_v.dot(cf), (_v.x * cf.x + _v.z * cf.z) / (hl * cl));
      if (facing < 0.25) continue;
      const score = facing * 2 - d / gp.range;
      if (score > bestScore) { bestScore = score; best = gp; }
    }
    return best;
  }
  _startGrapple(gp) {
    const g = this.game;
    this.state = 'grapple';
    this.slamT = 0;
    this._clearTransient();
    this.grapple = gp;
    this.grappleT = 0;
    this.grappleLaunch = gp.launchFrom(this.pos);
    this.gliding = false;
    g.audio.loop('glide', false);
    g.audio.play('grapple');
    this.rope.visible = true;
    gp.ping && gp.ping();
  }
  _updateGrapple(dt) {
    const g = this.game;
    const gp = this.grapple;
    this.grappleT += dt;
    const anchor = gp.pos;
    _v.copy(anchor).sub(this.pos);
    _v.y -= 1.2;
    const d = _v.length();
    _v.normalize();
    const speed = Math.min(26, 10 + this.grappleT * 40);
    this.vel.copy(_v).multiplyScalar(speed);
    this.yaw = dampAngle(this.yaw, Math.atan2(_v.x, _v.z), 14, dt);
    this.wasGrounded = false;
    this._move(dt);
    this.grounded = false;
    const hand = this.rig.arms[1].hand;
    hand.updateWorldMatrix(true, false);
    const arr = this.rope.geometry.attributes.position.array;
    _v2.setFromMatrixPosition(hand.matrixWorld);
    arr[0] = _v2.x; arr[1] = _v2.y; arr[2] = _v2.z;
    arr[3] = anchor.x; arr[4] = anchor.y; arr[5] = anchor.z;
    this.rope.geometry.attributes.position.needsUpdate = true;
    if (d < 1.6 || this.grappleT > 2.0) {
      this.state = 'normal';
      this.rope.visible = false;
      this._clearTransient();
      this.vel.copy(this.grappleLaunch);
      this.ballistic = true;
      this.jumps = 1;
      this.jumpCut = true;
      this.padLock = 0.3;
      this.grapple = null;
      g.audio.play('whoosh', { pitch: 1.2 });
      this.rig.anim.doFlip(1);
    }
  }

  // ------------------------------------------------------------- interactions
  _updateInteract(frozen) {
    const g = this.game;
    let target = null;
    let label = null;
    if (this.state === 'normal') {
      let best = Infinity;
      for (const it of g.level.interactables) {
        if (it.enabled === false) continue;
        const d = it.pos.distanceTo(this.pos);
        if (d < it.radius && d < best) { best = d; target = it; }
      }
      if (target) label = target.label;
      else {
        const gp = this._findGrapple();
        if (gp) { target = { grapple: gp }; label = 'Grappin'; }
      }
    }
    g.level.grapples.forEach((gp) => gp.highlight && gp.highlight(target && target.grapple === gp));
    g.hud.prompt(label ? { action: 'interact', text: label } : null);
    if (!frozen && target && g.input.pressed('interact')) {
      if (target.grapple) this._startGrapple(target.grapple);
      else target.action();
    }
  }

  // ------------------------------------------------------------- animation
  _animate(dt, wishLen) {
    const g = this.game;
    // ombre portée verticale (aide aux sauts)
    const gh = this.state !== 'dead' ? g.world.groundBelow(this.pos.x, this.pos.y + 0.3, this.pos.z, 40) : null;
    if (gh && gh.normal.y > 0.5) {
      const h = this.pos.y - gh.point.y;
      this.blob.visible = this.root.visible;
      this.blob.position.copy(gh.point).addScaledVector(gh.normal, 0.04);
      this.blob.quaternion.setFromUnitVectors(_up, gh.normal);
      const s = 0.95 - Math.min(0.45, h * 0.05);
      this.blob.scale.setScalar(s);
      this.blob.material.opacity = Math.max(0.25, 0.75 - h * 0.04);
    } else this.blob.visible = false;
    this.visYaw = dampAngle(this.visYaw, this.yaw, 20, dt);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.visYaw;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const w = g.weapons;
    this.rig.anim.update(dt, {
      speed: this.state === 'normal' ? hs : 0,
      grounded: this.grounded || this.state === 'grind',
      vy: this.vel.y,
      gliding: this.gliding,
      aiming: this.aiming && w && w.current !== null,
      twoHanded: w && w.twoHanded(),
      grip: w && w.twoHanded() ? w.held : null,
      armed: !!(w && w.current !== null),
      aimPitch: clamp(g.camera.pitch + 0.1, -0.9, 0.9),
      grinding: this.state === 'grind',
      grappling: this.state === 'grapple',
      dead: this.state === 'dead',
      slam: this.slamT > 0 && !this.grounded,
      jets: this._jetT > 0 ? this._jetT / 0.35 : this.gliding ? 0.3 : 0,
      hipYaw: this.hipYaw,
      strafeBack: this.strafeBack,
      lean: this.lean || 0,
      victory: this.victory,
      yaw: this.visYaw,
      wallSlide: !!this.wallSliding,
      longJump: this.longJump && !this.grounded,
    });
    void wishLen;
  }

  muzzleWorld(out) {
    const s = this.rig.arms[1].socket;
    s.updateWorldMatrix(true, false);
    out.setFromMatrixPosition(s.matrixWorld);
    return out;
  }
}
