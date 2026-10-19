// Salissure d'objectif générée au lancement (aucune image externe) : voiles, traces de doigts, poussières floues
// (disques à bord plus clair, comme des bokehs) et grains fins. Noir = propre ; le halo la révèle là où il est fort.
import * as THREE from 'three';
import { rng } from '../util.js';

export function lensDirtTexture(w = 1024, h = 576, seed = 7) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const r = rng(seed);
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'lighter';
  // tache douce (dégradé radial) ; rim > 0 : bord plus lumineux, comme une poussière floue
  const blob = (x, y, rad, a, tint, rim = 0) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    const col = (k) => `rgba(${tint[0]},${tint[1]},${tint[2]},${Math.max(0, a * k).toFixed(4)})`;
    gr.addColorStop(0, col(1 - rim * 0.5));
    if (rim) { gr.addColorStop(0.72, col(1 - rim * 0.3)); gr.addColorStop(0.88, col(1 + rim)); }
    else gr.addColorStop(0.5, col(0.6));
    gr.addColorStop(1, col(0));
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  };
  const warm = () => (r() < 0.6 ? [255, 236, 210] : r() < 0.5 ? [220, 235, 255] : [240, 240, 240]);
  // 1. voiles larges (graisse diffuse)
  for (let i = 0; i < 26; i++) blob(r() * w, r() * h, r.range(60, 190), r.range(0.025, 0.06), warm());
  // 2. traces de doigts : chapelets de taches le long d'arcs
  for (let i = 0; i < 9; i++) {
    let x = r() * w, y = r() * h, a = r() * Math.PI * 2;
    const n = r.int(18, 40), step = r.range(5, 11), rad = r.range(10, 24), alpha = r.range(0.018, 0.04), tint = warm();
    const turn = r.range(-0.08, 0.08);
    for (let j = 0; j < n; j++) {
      blob(x, y, rad * r.range(0.8, 1.2), alpha, tint);
      x += Math.cos(a) * step;
      y += Math.sin(a) * step;
      a += turn;
    }
  }
  // 3. poussières floues : disques à bord marqué, quelques gros
  for (let i = 0; i < 70; i++) blob(r() * w, r() * h, r.range(4, 13), r.range(0.07, 0.22), warm(), r.range(0.4, 1));
  for (let i = 0; i < 10; i++) blob(r() * w, r() * h, r.range(16, 30), r.range(0.05, 0.1), warm(), 0.8);
  // 4. grains fins
  for (let i = 0; i < 520; i++) blob(r() * w, r() * h, r.range(0.8, 2.6), r.range(0.15, 0.55), warm());
  // 5. quelques fibres
  g.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    let x = r() * w, y = r() * h, a = r() * Math.PI * 2;
    g.strokeStyle = `rgba(240,235,225,${r.range(0.08, 0.16).toFixed(3)})`;
    g.lineWidth = r.range(0.8, 1.6);
    g.beginPath();
    g.moveTo(x, y);
    for (let j = 0; j < 12; j++) {
      a += r.range(-0.5, 0.5);
      x += Math.cos(a) * 6;
      y += Math.sin(a) * 6;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}
