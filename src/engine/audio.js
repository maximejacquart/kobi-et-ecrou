// Audio entièrement synthétisé : bruitages calculés en tâche de fond (sfx/) + musique adaptative séquencée.
import { clamp } from './util.js';
import { renderSet } from './sfx/render.js';
import { SFX, LOOPS, pick, PRIORITY } from './sfx/recipes.js';
import { db } from './sfx/dsp.js';
// worker intégré au script (blob) : il démarre aussi quand le jeu est ouvert depuis le disque (version fichier unique)
import SfxWorker from './sfx/sfx.worker.js?worker&inline';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function nm(name) {
  const m = /^([A-G])(#|b)?(\d)$/.exec(name);
  if (!m) return null;
  return 12 * (+m[3] + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.volumes = { master: 0.8, music: 0.55, sfx: 0.85 };
    this.listener = { x: 0, y: 0, z: 0, rx: 1, rz: 0 };
    this.last = new Map();
    this.loops = new Map();
    this.bank = new Map(); // bruitage → AudioBuffer[] (variantes)
    this.lastVar = new Map();
    this.music = null;
  }
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 10;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.2;
    this.master.connect(this.comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    // la musique passe par un gain qui s'efface un instant sous les gros impacts
    this.duckGain = ctx.createGain();
    this.musicBus.connect(this.duckGain).connect(this.master);
    // réverbération à réponse impulsionnelle générée
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(2.2, 2.5);
    this.revSend = ctx.createGain();
    this.revSend.gain.value = 0.22;
    this.revSend.connect(this.reverb).connect(this.master);
    // bruit blanc
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    this._startBank();
    this.enabled = true;
    this.music = new Music(this);
    if (this.onReady) this.onReady();
  }
  _impulse(dur, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.volumes.master;
    this.musicBus.gain.value = this.volumes.music;
    this.sfxBus.gain.value = this.volumes.sfx;
  }
  setListener(pos, right) {
    const l = this.listener;
    l.x = pos.x; l.y = pos.y; l.z = pos.z;
    l.rx = right.x; l.rz = right.z;
  }
  // Volume, panoramique et étouffement selon la position
  _spatial(pos, range = 40) {
    if (!pos) return { g: 1, pan: 0, dist: 0 };
    const l = this.listener;
    const dx = pos.x - l.x, dy = pos.y - l.y, dz = pos.z - l.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const g = clamp(1 - (dist - 4) / range, 0, 1);
    const pan = dist > 0.1 ? clamp((dx * l.rx + dz * l.rz) / Math.max(dist, 3), -0.8, 0.8) : 0;
    return { g: g * g, pan, dist };
  }
  _out(vol, pos, range, rev = 0.15) {
    const ctx = this.ctx;
    const { g, pan, dist } = this._spatial(pos, range);
    if (g <= 0.001) return null;
    const gain = ctx.createGain();
    gain.gain.value = vol * g;
    gain._near = g;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    let head = gain;
    // au loin, l'air absorbe l'aigu : le son s'étouffe en plus de baisser
    if (dist > 8) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = clamp(20000 * Math.exp(-(dist - 8) / 14), 1200, 20000);
      gain.connect(f);
      head = f;
    }
    head.connect(p).connect(this.sfxBus);
    if (rev > 0) {
      const s = ctx.createGain();
      // plus loin = proportion de réverbération plus forte
      s.gain.value = rev * (1 + Math.min(1.5, dist / 20));
      p.connect(s).connect(this.revSend);
    }
    return gain;
  }
  // --- briques de synthèse (instruments de la musique) ---
  _osc(out, type, f0, f1, t0, dur, gain = 0.3, attack = 0.005, curve = 'exp') {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) {
      if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
      else o.frequency.linearRampToValueAtTime(f1, t0 + dur);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    return o;
  }
  _noise(out, t0, dur, { type = 'lowpass', f0 = 2000, f1, q = 1, gain = 0.3, attack = 0.003 } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 1;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    if (f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.05);
  }

  // Joue un bruitage. opts : vol, pitch, pos, range, rev (+ surface, big : voir pick)
  play(name, opts = {}) {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const minGap = THROTTLE[name] ?? 0.03;
    const key = name + (opts.key || '');
    if (this.last.has(key) && now - this.last.get(key) < minGap) return;
    this.last.set(key, now);
    const id = pick(name, opts), r = SFX[id];
    if (!r) return;
    const out = this._out((opts.vol ?? 1) * db(r.db), opts.pos, opts.range ?? 45, opts.rev ?? REV[id] ?? 0.12);
    if (!out) return;
    const set = this._buffers(id);
    // variante au hasard, jamais deux fois la même d'affilée
    let v = Math.floor(Math.random() * set.length);
    if (set.length > 1 && v === this.lastVar.get(id)) v = (v + 1) % set.length;
    this.lastVar.set(id, v);
    const src = this.ctx.createBufferSource();
    src.buffer = set[v];
    src.playbackRate.value = (opts.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * (r.jit ?? 0.03));
    src.connect(out);
    src.start(now + 0.005);
    if (r.duck) this._duck(r.duck * out._near);
  }
  // atténue un instant la musique sous les gros impacts
  _duck(amount) {
    if (amount < 0.05) return;
    const g = this.duckGain.gain, t = this.ctx.currentTime;
    if (1 - amount > g.value) return;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.setTargetAtTime(1 - amount, t, 0.015);
    g.setTargetAtTime(1, t + 0.2, 0.45);
  }
  // tampons d'un bruitage : calculés par le worker, ou ici même s'il n'a pas encore fini
  _buffers(id) {
    let set = this.bank.get(id);
    if (!set) {
      set = renderSet(id, this.ctx.sampleRate).map((x) => this._toBuffer(x));
      this.bank.set(id, set);
    }
    return set;
  }
  _toBuffer(x) {
    const b = this.ctx.createBuffer(1, x.length, this.ctx.sampleRate);
    b.copyToChannel(x, 0);
    return b;
  }
  _startBank() {
    const keys = [...new Set([...PRIORITY, ...Object.keys(LOOPS), ...Object.keys(SFX)])];
    try {
      const w = new SfxWorker();
      let n = 0;
      w.onmessage = ({ data }) => {
        if (!this.bank.has(data.key)) this.bank.set(data.key, data.set.map((x) => this._toBuffer(x)));
        if (++n === keys.length) w.terminate();
      };
      w.onerror = () => w.terminate();
      w.postMessage({ keys, sr: this.ctx.sampleRate });
    } catch (e) { /* pas de worker : chaque son sera calculé à sa première lecture */ }
  }

  // Sons continus (hélice, grind, zappeur, ambiances...). opts : vol, rate
  loop(name, on, opts = {}) {
    if (!this.enabled) return;
    const cur = this.loops.get(name), r = LOOPS[name], ctx = this.ctx, t = ctx.currentTime;
    if (on && !cur) {
      if (!r) return;
      const out = ctx.createGain();
      out.gain.value = 0.0001;
      out.connect(this.sfxBus);
      const src = ctx.createBufferSource();
      src.buffer = this._buffers(name)[0];
      src.loop = true;
      const rate = opts.rate ?? 1;
      src.playbackRate.value = rate;
      // les moteurs démarrent un peu en dessous de leur régime
      if (r.spin) {
        src.playbackRate.setValueAtTime(rate * r.spin, t);
        src.playbackRate.setTargetAtTime(rate, t, 0.12);
      }
      src.connect(out);
      src.start(t, Math.random() * src.buffer.duration);
      out.gain.setTargetAtTime((opts.vol ?? 1) * db(r.db), t, r.fade ?? 0.04);
      this.loops.set(name, { out, src });
    } else if (!on && cur) {
      cur.out.gain.setTargetAtTime(0.0001, t, r.fade ?? 0.05);
      cur.src.stop(t + 0.3 + 4 * (r.fade ?? 0.05));
      this.loops.delete(name);
    } else if (on && cur) {
      if (opts.vol !== undefined) cur.out.gain.setTargetAtTime(opts.vol * db(r.db), t, 0.05);
      if (opts.rate !== undefined) cur.src.playbackRate.setTargetAtTime(opts.rate, t, 0.05);
    }
  }
  stopAllLoops() {
    for (const k of [...this.loops.keys()]) this.loop(k, false);
  }
}

const THROTTLE = { bolt: 0.022, step: 0.08, rivet: 0.03, hit: 0.03, enemyHurt: 0.05, zapHit: 0.08, uiMove: 0.04, toast: 0.05, turretShot: 0.04, crate: 0.04, explosion: 0.04, quack: 0.08 };
// envoi vers la réverbération commune
const REV = { explosion: 0.3, explosionBig: 0.35, slam: 0.3, levelup: 0.3, buy: 0.2, goldbolt: 0.3, checkpoint: 0.3, roar: 0.4, stomp: 0.2, snipe: 0.25, alarm: 0.25, uiMove: 0, uiSelect: 0.05, uiBack: 0.05 };

// ---------------------------------------------------------------- Musique
// Accords : [fondamentale MIDI, type]
const CH = { maj: [0, 4, 7], min: [0, 3, 7], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10], dom7: [0, 4, 7, 10], sus: [0, 5, 7], add9: [0, 4, 7, 14], m9: [0, 3, 7, 14] };

const TRACKS = {
  title: {
    bpm: 108, swing: 0,
    chords: [[50, 'add9'], [57, 'maj'], [59, 'min7'], [55, 'add9']],
    bass: 'R...R.R.F...R.O.',
    arp: [0, 1, 2, 3, 2, 1, 0, 1], arpRate: 2, arpOct: 1,
    drums: { k: 'x.......x.x.....', s: '....x.......x...', h: '..x...x...x...x.' },
    lead: 'A5 - F#5 - E5 - D5 - | E5 - - - A4 - - - | B4 - D5 - E5 - F#5 - | G5 - F#5 - E5 - - - | ' +
      'A5 - B5 - A5 - F#5 - | E5 - - - D5 - E5 - | F#5 - - - E5 - D5 - | D5 - - - - - - - ',
    leadWave: 'square', padWave: 'sawtooth', calmDrums: false,
  },
  brikka: {
    bpm: 116, swing: 0.08,
    chords: [[50, 'min7'], [48, 'maj'], [46, 'maj7'], [48, 'sus']],
    bass: 'R..R..R.O..R.F.R',
    arp: [0, 2, 1, 3, 0, 2, 3, 1], arpRate: 2, arpOct: 1,
    drums: { k: 'x..x..x...x..x..', s: '....x.......x..x', h: 'x.xxx.xxx.xxx.xo' },
    lead: 'D5 - - F5 - - G5 - | A5 - - - C6 - A5 - | G5 - - F5 - - E5 - | C5 - - - - - . . | ' +
      'D5 - - F5 - - A5 - | C6 - D6 - C6 - A5 - | G5 - F5 - E5 - C5 - | D5 - - - - - . . ',
    leadWave: 'square', padWave: 'triangle',
  },
  nimbara: {
    bpm: 122, swing: 0,
    chords: [[53, 'maj7'], [55, 'add9'], [57, 'min7'], [52, 'min7']],
    bass: 'R.....R.F.....O.',
    arp: [0, 1, 2, 3, 4, 3, 2, 1], arpRate: 1, arpOct: 1,
    drums: { k: 'x.....x...x.....', s: '....x.......x...', h: '..x...x...x...x.' },
    lead: 'C6 - A5 - G5 - F5 - | G5 - - - D5 - - - | E5 - G5 - A5 - C6 - | B5 - - - - - . . | ' +
      'C6 - D6 - E6 - C6 - | D6 - - - G5 - - - | A5 - B5 - C6 - E5 - | E5 - - - - - . . ',
    leadWave: 'triangle', padWave: 'sawtooth',
  },
  station: {
    bpm: 130, swing: 0,
    chords: [[40, 'min'], [41, 'maj'], [40, 'min'], [38, 'maj']],
    bass: 'RRO.RRO.RRF.RRO.',
    arp: [0, 2, 1, 2, 0, 2, 1, 3], arpRate: 1, arpOct: 2,
    drums: { k: 'x...x...x...x..x', s: '....x.......x...', h: 'xxxxxxxxxxxxxxxx' },
    lead: 'E5 - - - G5 - - - | F5 - - E5 - - C5 - | E5 - - - B5 - - - | A5 - G5 - F5 - E5 - | ' +
      'E5 - G5 - B5 - E6 - | D6 - - C6 - - B5 - | C6 - B5 - A5 - G5 - | E5 - - - - - . . ',
    leadWave: 'sawtooth', padWave: 'sawtooth',
  },
  givrelune: {
    bpm: 100, swing: 0,
    chords: [[47, 'm9'], [43, 'maj7'], [45, 'add9'], [42, 'min7']],
    bass: 'R.......O...R...',
    arp: [0, 2, 4, 2, 1, 3, 4, 3], arpRate: 2, arpOct: 2,
    drums: { k: 'x.......x.......', s: '........x.......', h: '..x...x...x...x.' },
    lead: 'F#5 - - - D5 - E5 - | F#5 - A5 - B5 - - - | A5 - - - F#5 - E5 - | D5 - - - - - . . | ' +
      'B5 - - - A5 - F#5 - | A5 - - - E5 - - - | F#5 - E5 - D5 - C#5 - | B4 - - - - - . . ',
    leadWave: 'triangle', padWave: 'triangle',
  },
  luminbois: {
    bpm: 112, swing: 0.12,
    chords: [[50, 'min7'], [55, 'dom7'], [50, 'min7'], [53, 'maj7']],
    bass: 'R..R.F..R..O.R..',
    arp: [0, 1, 2, 1, 3, 2, 1, 2], arpRate: 2, arpOct: 1,
    drums: { k: 'x..x..x.x..x....', s: '....x..x....x...', h: 'x.xx.x.xx.xx.x.x' },
    lead: 'D5 - F5 - A5 - G5 - | F5 - - - D5 - - - | C5 - D5 - F5 - G5 - | A5 - - - - - . . | ' +
      'A5 - C6 - B5 - A5 - | G5 - - - F5 - G5 - | A5 - G5 - F5 - E5 - | D5 - - - - - . . ',
    leadWave: 'square', padWave: 'triangle',
  },
  boss: {
    bpm: 142, swing: 0,
    chords: [[48, 'min'], [44, 'maj'], [46, 'maj'], [43, 'dom7']],
    bass: 'R.RR.RR.R.RRO.RF',
    arp: [0, 1, 2, 1, 0, 1, 2, 3], arpRate: 1, arpOct: 2,
    drums: { k: 'x..xx..xx..xx..x', s: '....x..x....x.xx', h: 'x.x.x.x.x.x.x.x.' },
    lead: 'C5 - Eb5 - G5 - C6 - | Bb5 - Ab5 - G5 - - - | F5 - G5 - Ab5 - Bb5 - | B5 - - - D6 - - - | ' +
      'C6 - - - G5 - - - | Ab5 - G5 - F5 - Eb5 - | D5 - Eb5 - F5 - G5 - | G5 - - - B5 - - - ',
    leadWave: 'sawtooth', padWave: 'sawtooth',
  },
  vendor: {
    bpm: 96, swing: 0.16,
    chords: [[48, 'maj7'], [45, 'min7'], [50, 'min7'], [43, 'dom7']],
    bass: 'R..F..O.R..F.R..',
    arp: [0, 2, 3, 2], arpRate: 2, arpOct: 1,
    drums: { k: 'x.....x.........', s: '........x.......', h: 'x.x.x.x.x.x.x.x.' },
    lead: 'E5 - G5 - B5 - - - | A5 - - - G5 - E5 - | F5 - A5 - C6 - - - | B5 - - - - - . . ',
    leadWave: 'triangle', padWave: 'triangle', calmOnly: true,
  },
};

function parseLead(str) {
  const toks = str.replace(/\|/g, ' ').trim().split(/\s+/);
  const notes = [];
  toks.forEach((tk, i) => {
    if (tk === '-') {
      if (notes.length) notes[notes.length - 1].len += 1;
    } else if (tk === '.') {
      notes.push({ at: i, m: null, len: 1 });
    } else {
      notes.push({ at: i, m: nm(tk), len: 1 });
    }
  });
  return { notes: notes.filter((n) => n.m !== null), length: toks.length };
}

class Music {
  constructor(audio) {
    this.a = audio;
    const ctx = audio.ctx;
    this.out = ctx.createGain();
    this.out.connect(audio.musicBus);
    this.layers = {};
    for (const k of ['pad', 'arp', 'bass', 'drums', 'lead']) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.out);
      this.layers[k] = g;
    }
    const send = ctx.createGain();
    send.gain.value = 0.3;
    this.layers.lead.connect(send);
    this.layers.arp.connect(send);
    send.connect(audio.revSend);
    this.track = null;
    this.step = 0;
    this.nextTime = 0;
    this.intensity = 0;
    this.timer = null;
  }
  play(name) {
    if (this.trackName === name) return;
    this.trackName = name;
    const tr = TRACKS[name];
    const ctx = this.a.ctx;
    // fondu rapide
    this.out.gain.cancelScheduledValues(ctx.currentTime);
    this.out.gain.setValueAtTime(this.out.gain.value, ctx.currentTime);
    this.out.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.25);
    clearTimeout(this._switch);
    this._switch = setTimeout(() => {
      this.track = tr ? { ...tr, leadP: parseLead(tr.lead) } : null;
      this.step = 0;
      this.nextTime = ctx.currentTime + 0.05;
      this.out.gain.cancelScheduledValues(ctx.currentTime);
      this.out.gain.setValueAtTime(0, ctx.currentTime);
      this.out.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.6);
      this.setIntensity(this.intensity, true);
      if (!this.timer) this.timer = setInterval(() => this._tick(), 25);
    }, 260);
  }
  stop() {
    this.trackName = null;
    this.track = null;
    if (this.a.ctx) {
      const t = this.a.ctx.currentTime;
      this.out.gain.setTargetAtTime(0, t, 0.2);
    }
  }
  // 0 = exploration, 1 = combat
  setIntensity(v, force) {
    v = clamp(v, 0, 1);
    if (!force && Math.abs(v - this.intensity) < 0.01) return;
    this.intensity = v;
    const tr = this.track;
    if (!tr) return;
    const t = this.a.ctx.currentTime;
    const calm = tr.calmOnly ? 1 : 1 - v;
    const set = (k, g) => this.layers[k].gain.setTargetAtTime(g, t, 0.6);
    set('pad', 0.16);
    set('arp', 0.07 + 0.03 * calm);
    set('bass', 0.18 + 0.1 * v);
    set('drums', tr.calmOnly ? 0.25 : 0.12 + 0.3 * v);
    set('lead', 0.035 + 0.075 * v + (tr === TRACKS.title || this.trackName === 'title' ? 0.06 : 0));
  }
  _tick() {
    const tr = this.track;
    if (!tr || !this.a.ctx) return;
    const ctx = this.a.ctx;
    const s16 = 60 / tr.bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.15) {
      let t = this.nextTime;
      if (this.step % 2 === 1) t += s16 * tr.swing;
      this._schedule(this.step, t, s16);
      this.nextTime += s16;
      this.step++;
    }
  }
  _schedule(step, t, s16) {
    const tr = this.track;
    const a = this.a;
    const bar = Math.floor(step / 16);
    const i16 = step % 16;
    const [root, type] = tr.chords[bar % tr.chords.length];
    const tones = CH[type];
    const L = this.layers;
    // nappe : à chaque mesure
    if (i16 === 0) {
      for (const iv of tones.slice(0, 4)) {
        for (const det of [-6, 6]) {
          const o = a.ctx.createOscillator();
          o.type = tr.padWave;
          o.frequency.value = mtof(root + 12 + iv);
          o.detune.value = det;
          const f = a.ctx.createBiquadFilter();
          f.type = 'lowpass';
          f.frequency.setValueAtTime(600, t);
          f.frequency.linearRampToValueAtTime(1400, t + s16 * 8);
          f.frequency.linearRampToValueAtTime(700, t + s16 * 16);
          const g = a.ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(0.12, t + s16 * 3);
          g.gain.setValueAtTime(0.12, t + s16 * 13);
          g.gain.linearRampToValueAtTime(0.0001, t + s16 * 16.5);
          o.connect(f).connect(g).connect(L.pad);
          o.start(t); o.stop(t + s16 * 17);
        }
      }
    }
    // arpège
    if (i16 % tr.arpRate === 0) {
      const idx = tr.arp[(i16 / tr.arpRate) % tr.arp.length];
      const iv = tones[idx % tones.length] + 12 * Math.floor(idx / tones.length);
      const m = root + 12 * (1 + tr.arpOct) + iv;
      const o = a.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = mtof(m);
      const f = a.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(3200, t);
      f.frequency.exponentialRampToValueAtTime(600, t + s16 * 1.5);
      const g = a.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + s16 * 1.8);
      o.connect(f).connect(g).connect(L.arp);
      o.start(t); o.stop(t + s16 * 2);
    }
    // basse
    const bc = tr.bass[i16];
    if (bc && bc !== '.' && bc !== '-') {
      const m = root - 12 + (bc === 'F' ? 7 : bc === 'O' ? 12 : 0) + 12;
      let len = 1;
      while (tr.bass[i16 + len] === '-') len++;
      const o = a.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = mtof(m);
      const o2 = a.ctx.createOscillator();
      o2.type = 'square';
      o2.frequency.value = mtof(m - 12);
      const f = a.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = 6;
      f.frequency.setValueAtTime(1100, t);
      f.frequency.exponentialRampToValueAtTime(200, t + s16 * 1.2);
      const g = a.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + s16 * (len + 0.6));
      o.connect(f); o2.connect(f);
      f.connect(g).connect(L.bass);
      o.start(t); o2.start(t);
      o.stop(t + s16 * (len + 1)); o2.stop(t + s16 * (len + 1));
    }
    // batterie
    const d = tr.drums;
    const out = L.drums;
    if (d.k[i16] === 'x') {
      a._osc(out, 'sine', 150, 42, t, 0.28, 1.0, 0.002);
      a._noise(out, t, 0.02, { type: 'lowpass', f0: 3000, gain: 0.3 });
    }
    if (d.s[i16] === 'x') {
      a._noise(out, t, 0.16, { type: 'bandpass', f0: 1800, q: 0.8, gain: 0.55 });
      a._osc(out, 'triangle', 220, 160, t, 0.08, 0.35);
    }
    if (d.h[i16] === 'x' || d.h[i16] === 'o') {
      a._noise(out, t, d.h[i16] === 'o' ? 0.18 : 0.04, { type: 'highpass', f0: 7500, gain: d.h[i16] === 'o' ? 0.22 : 0.15 });
    }
    // mélodie (en croches : 1 jeton = 2 doubles-croches)
    if (i16 % 2 === 0) {
      const lp = tr.leadP;
      const pos = (Math.floor(step / 2)) % lp.length;
      const n = lp.notes.find((x) => x.at === pos);
      if (n) {
        const dur = n.len * s16 * 2;
        const o = a.ctx.createOscillator();
        o.type = tr.leadWave;
        o.frequency.value = mtof(n.m);
        const vib = a.ctx.createOscillator();
        vib.frequency.value = 5.5;
        const vg = a.ctx.createGain();
        vg.gain.setValueAtTime(0, t);
        vg.gain.linearRampToValueAtTime(mtof(n.m) * 0.012, t + Math.min(dur, 0.4));
        vib.connect(vg).connect(o.frequency);
        const f = a.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = tr.leadWave === 'sawtooth' ? 2600 : 4200;
        const g = a.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.3, t + 0.012);
        g.gain.setValueAtTime(0.26, t + dur * 0.7);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.98);
        o.connect(f).connect(g).connect(L.lead);
        o.start(t); vib.start(t);
        o.stop(t + dur + 0.05); vib.stop(t + dur + 0.05);
      }
    }
  }
  // Courte fanfare de victoire
  fanfare() {
    const a = this.a;
    if (!a.ctx) return;
    const t = a.ctx.currentTime + 0.05;
    if (!this.fanOut) { this.fanOut = a.ctx.createGain(); this.fanOut.gain.value = 1; this.fanOut.connect(a.musicBus); }
    const seq = [[67, 0, 0.15], [72, 0.15, 0.15], [76, 0.3, 0.15], [79, 0.45, 0.45], [76, 0.9, 0.15], [79, 1.05, 0.9]];
    for (const [m, at, len] of seq) {
      a._osc(this.fanOut, 'square', mtof(m), null, t + at, len + 0.1, 0.12, 0.01);
      a._osc(this.fanOut, 'triangle', mtof(m - 12), null, t + at, len + 0.1, 0.15, 0.01);
    }
  }
}
