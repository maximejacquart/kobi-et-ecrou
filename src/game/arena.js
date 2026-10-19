// Arènes : champs de force qui se ferment, vagues d'ennemis téléportés, récompense à la fin.
import * as THREE from 'three';

export class Arena {
  constructor(game, o) {
    this.game = game;
    this.o = o;
    this.fields = o.fields || [];
    this.waves = o.waves || [];
    this.wave = -1;
    this.active = false;
    this.done = false;
    this.alive = [];
    this.delay = 0;
    this.level = game.level;
    // caisses de munitions remises en place pendant le combat (o.ammo : positions) : un boss ne doit jamais
    // laisser Kobi à sec, quelle que soit son arme
    this.supply = (o.ammo || []).map((pos) => ({ pos, crate: null, t: 0 }));
    game.level.every((dt) => this.update(dt));
  }
  start() {
    if (this.active || this.done) return;
    const g = this.game;
    this.active = true;
    for (const f of this.fields) g.props.setField(f, true);
    g.audio.play('alarm');
    if (this.o.title) g.hud.toast(this.o.title, 2.5);
    if (this.o.onStart) this.o.onStart();
    this.delay = 1.2;
    this.before = new Set(g.enemies.list);
  }
  _spawnWave(i) {
    const g = this.game;
    const wave = this.waves[i];
    this.alive = [];
    if (wave.say) g.hud.say(wave.say);
    if (wave.onStart) wave.onStart();
    wave.list.forEach(([type, x, z, opts], k) => {
      this.level.after(k * ((wave.stagger ?? 180) / 1000), () => {
        if (!this.active || g.level !== this.level) return;
        const hit = g.world.groundBelow(x, 80, z, 160);
        const p = new THREE.Vector3(x, hit ? hit.point.y + 0.1 : 0, z);
        const e = g.enemies.spawn(type, p, { warp: true, alert: true, ...(opts || {}) });
        if (e) this.alive.push(e);
      });
    });
    this._spawnT = wave.list.length * ((wave.stagger ?? 180) / 1000) + 0.3;
  }
  _resupply(dt) {
    const g = this.game;
    for (const s of this.supply) {
      if (s.crate && s.crate.alive) { s.t = this.o.ammoEvery ?? 12; continue; }
      s.t -= dt;
      if (s.t > 0) continue;
      const again = !!s.crate;
      s.crate = g.props.crate(s.pos, 'ammo');
      s.crate.squash = 1;
      g.fx.ring(s.pos, '#4aa3ff', 2.2, 0.45);
      g.fx.sparks(s.pos.clone().setY(s.pos.y + 0.6), null, 14, '#9fd4ff', 6);
      g.audio.play('ammo', { pos: s.pos, pitch: 0.8 });
      if (again && !this.level.supplySaid) {
        this.level.supplySaid = true;
        g.hud.say([['ecrou', 'Je te renvoie des caisses de munitions pendant le combat : les bleues ! Casse-les, même à la clé.']]);
      }
    }
  }
  update(dt) {
    if (!this.active) return;
    const g = this.game;
    this._resupply(dt);
    if (this.delay > 0) {
      this.delay -= dt;
      if (this.delay <= 0) {
        this.wave++;
        if (this.wave >= this.waves.length) this._finish();
        else this._spawnWave(this.wave);
      }
      return;
    }
    if (this._spawnT > 0) { this._spawnT -= dt; return; }
    if (this.alive.every((e) => e.dead)) {
      // dernière vague vidée : l'arène est acquise même si Kobi meurt pendant le délai
      if (this.wave === this.waves.length - 1) this.cleared = true;
      this.delay = this.waves[this.wave]?.after ?? 1.6;
      if (this.wave + 1 < this.waves.length) g.audio.play('beep', { pitch: 0.8 });
    }
  }
  _finish() {
    const g = this.game;
    this.active = false;
    this.done = true;
    for (const f of this.fields) g.props.setField(f, false);
    g.audio.play('checkpoint', { pitch: 1.2 });
    if (this.o.reward) g.pickups.spawnBolts(this.o.rewardPos || g.player.pos.clone().setY(g.player.pos.y + 3), this.o.reward, { spread: 2.2, up: 1.3 });
    if (this.o.onDone) this.o.onDone();
  }
  reset() {
    // à la mort du joueur : l'arène se réinitialise
    const g = this.game;
    if (!this.active) return;
    if (this.cleared) { this._finish(); return; }
    this.active = false;
    // retire les vagues et les renforts invoqués
    for (const e of g.enemies.list) if (!e.dead && this.before && !this.before.has(e)) e.remove();
    this.alive = [];
    this.wave = -1;
    g.hud.boss(null);
    for (const f of this.fields) g.props.setField(f, false, true);
  }
}
