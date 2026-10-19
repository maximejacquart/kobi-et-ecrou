// Illustrations animées des cartes d'histoire, dessinées en 2D sur canvas.
import { FONT_TITLE } from './font.js';

const stars = Array.from({ length: 260 }, (_, i) => ({ x: Math.random(), y: Math.random(), s: Math.random() * 1.8 + 0.3, p: Math.random() * 6, d: (i % 3) + 1 }));
const debris = Array.from({ length: 40 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 6, s: 0.3 + Math.random(), a: Math.random() * 6 }));

function sky(ctx, w, h, top, bot, t) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top);
  g.addColorStop(1, bot);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (const s of stars) {
    const tw = 0.5 + 0.5 * Math.sin(t * 2 + s.p);
    ctx.fillStyle = `rgba(255,255,255,${0.3 + tw * 0.7})`;
    const x = ((s.x * w + t * 6 * s.d) % w);
    ctx.fillRect(x, s.y * h, s.s, s.s);
  }
}

function planet(ctx, x, y, r, c1, c2, c3, bands = 7) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, c1);
  g.addColorStop(0.55, c2);
  g.addColorStop(1, c3);
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 0.18;
  for (let i = 0; i < bands; i++) {
    ctx.fillStyle = i % 2 ? '#fff' : '#000';
    ctx.fillRect(x - r, y - r + (i / bands) * r * 2, r * 2, r / bands);
  }
  ctx.restore();
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#1a1028';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

function voraxShip(ctx, x, y, s, t) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  // faisceau aspirant
  const beam = ctx.createLinearGradient(0, 30, 0, 300);
  beam.addColorStop(0, 'rgba(200,120,255,0.7)');
  beam.addColorStop(1, 'rgba(200,120,255,0)');
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(-40, 30); ctx.lineTo(40, 30); ctx.lineTo(160, 320); ctx.lineTo(-160, 320); ctx.closePath();
  ctx.fill();
  // coque
  ctx.fillStyle = '#5b2aa8';
  ctx.strokeStyle = '#1a1028';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.ellipse(0, 0, 220, 60, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#8a4fe0';
  ctx.beginPath();
  ctx.ellipse(0, -25, 120, 40, 0, Math.PI, 0);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ffd23a';
  ctx.fillRect(-200, -6, 400, 12);
  ctx.strokeRect(-200, -6, 400, 12);
  for (let i = -3; i <= 3; i++) {
    ctx.fillStyle = Math.sin(t * 5 + i) > 0 ? '#ffe98a' : '#b8860b';
    ctx.beginPath(); ctx.arc(i * 50, 28, 7, 0, Math.PI * 2); ctx.fill();
  }
  // embouchure
  ctx.fillStyle = '#2a1050';
  ctx.beginPath(); ctx.ellipse(0, 50, 46, 16, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // logo V
  ctx.font = `64px "${FONT_TITLE}"`;
  ctx.fillStyle = '#ffd23a';
  ctx.textAlign = 'center';
  ctx.fillText('V', 0, -18);
  ctx.restore();
}

function kobi(ctx, x, y, s, t) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  const bob = Math.sin(t * 3) * 3;
  ctx.translate(0, bob);
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#1d1028';
  // queue
  ctx.fillStyle = '#f29a35';
  ctx.beginPath(); ctx.ellipse(-60, 40, 50, 22, -0.6 + Math.sin(t * 2) * 0.15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff0d8';
  ctx.beginPath(); ctx.ellipse(-98, 12, 16, 12, -0.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // corps
  ctx.fillStyle = '#3f4fc9';
  ctx.beginPath(); ctx.roundRect(-38, 0, 76, 90, 26); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ffb627';
  ctx.fillRect(-36, 54, 72, 10);
  ctx.fillStyle = '#ef3e4a';
  ctx.beginPath(); ctx.ellipse(0, 2, 40, 12, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // oreilles
  for (const sgn of [-1, 1]) {
    ctx.save();
    ctx.translate(sgn * 42, -96);
    ctx.rotate(sgn * (0.4 + Math.sin(t * 4 + sgn) * 0.05));
    ctx.fillStyle = '#f29a35';
    ctx.beginPath(); ctx.moveTo(-26, 30); ctx.quadraticCurveTo(-18, -70, 0, -95); ctx.quadraticCurveTo(18, -70, 26, 30); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ff9fb0';
    ctx.beginPath(); ctx.moveTo(-14, 20); ctx.quadraticCurveTo(-8, -50, 0, -70); ctx.quadraticCurveTo(8, -50, 14, 20); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // tête
  ctx.fillStyle = '#f29a35';
  ctx.beginPath(); ctx.ellipse(0, -50, 62, 56, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff0d8';
  ctx.beginPath(); ctx.ellipse(0, -28, 40, 28, 0, 0, Math.PI * 2); ctx.fill();
  // yeux
  for (const sgn of [-1, 1]) {
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(sgn * 22, -58, 15, 19, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#37d67a';
    ctx.beginPath(); ctx.ellipse(sgn * 22 + 2, -56, 9, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#120a18';
    ctx.beginPath(); ctx.ellipse(sgn * 22 + 3, -55, 5, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(sgn * 22 + 6, -60, 2.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#3b1e2c';
  ctx.beginPath(); ctx.ellipse(0, -36, 9, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(0, -26, 9, 0.2, Math.PI - 0.2); ctx.stroke();
  // lunettes
  ctx.fillStyle = '#7fe8ff';
  for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.arc(sgn * 20, -96, 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  ctx.restore();
}

function ecrou(ctx, x, y, s, t) {
  ctx.save();
  ctx.translate(x, y + Math.sin(t * 4) * 6);
  ctx.scale(s, s);
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#1d1028';
  // hélices
  ctx.save();
  ctx.translate(0, -70);
  ctx.fillStyle = '#ffc23a';
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.scale(1, 0.25);
    ctx.rotate(t * 20 + (i * Math.PI * 2) / 3);
    ctx.beginPath(); ctx.roundRect(0, -8, 80, 16, 8); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
  ctx.fillStyle = '#56607d';
  ctx.fillRect(-4, -70, 8, 30);
  const g = ctx.createRadialGradient(-12, -16, 4, 0, 0, 48);
  g.addColorStop(0, '#fff');
  g.addColorStop(1, '#b9c3d9');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(0, 0, 46, 44, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#141526';
  ctx.beginPath(); ctx.roundRect(-34, -18, 68, 34, 16); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#4ff3ff';
  ctx.shadowColor = '#4ff3ff';
  ctx.shadowBlur = 20;
  const blink = Math.sin(t * 1.3) > 0.95 ? 0.2 : 1;
  ctx.beginPath(); ctx.ellipse(0, -1, 13, 10 * blink, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function baron(ctx, x, y, s, t) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#1d1028';
  // costume
  ctx.fillStyle = '#4a1f8a';
  ctx.beginPath(); ctx.roundRect(-110, 60, 220, 200, 50); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ffd23a';
  ctx.beginPath(); ctx.moveTo(-20, 60); ctx.lineTo(0, 150); ctx.lineTo(20, 60); ctx.closePath(); ctx.fill(); ctx.stroke();
  // tête
  ctx.fillStyle = '#c99ae8';
  ctx.beginPath(); ctx.ellipse(0, -10, 100, 90, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // chapeau haut-de-forme doré
  ctx.fillStyle = '#ffd23a';
  ctx.beginPath(); ctx.roundRect(-90, -100, 180, 26, 8); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.roundRect(-60, -190, 120, 96, 10); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#5b2aa8';
  ctx.fillRect(-60, -120, 120, 18);
  // yeux (monocle)
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(-36, -20, 18, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(36, -20, 24, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#1d1028';
  ctx.beginPath(); ctx.arc(-34 + Math.sin(t) * 4, -18, 7, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(38 + Math.sin(t) * 4, -18, 9, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#ffd23a';
  ctx.beginPath(); ctx.arc(36, -20, 30, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = '#1d1028';
  // moustache
  ctx.fillStyle = '#5a2a1a';
  const w = Math.sin(t * 3) * 6;
  ctx.beginPath();
  ctx.moveTo(0, 26);
  ctx.quadraticCurveTo(-50, 10 - w, -90, 40 + w);
  ctx.quadraticCurveTo(-50, 30, 0, 46);
  ctx.quadraticCurveTo(50, 30, 90, 40 + w);
  ctx.quadraticCurveTo(50, 10 - w, 0, 26);
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

export function drawStory(cv, art, t, gt) {
  const ctx = cv.getContext('2d');
  const w = cv.width, h = cv.height;
  ctx.clearRect(0, 0, w, h);
  if (art === 'stars') {
    sky(ctx, w, h, '#0a0618', '#21123f', gt);
    const g = ctx.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, w * 0.6);
    g.addColorStop(0, 'rgba(120,60,200,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  if (art === 'belt') {
    sky(ctx, w, h, '#0b0720', '#3a1f5a', t);
    planet(ctx, w * 0.62, h * 1.05, h * 0.75, '#ffd9a0', '#e07a32', '#7a2c18', 9);
    for (const d of debris) {
      const x = (d.x * w + t * 20 * d.s) % (w + 40) - 20;
      const y = d.y * h * 0.6;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(d.a + t * d.s);
      ctx.fillStyle = '#8a7a9a';
      ctx.strokeStyle = '#1d1028';
      ctx.lineWidth = 2;
      ctx.fillRect(-d.r - 2, -d.r - 2, d.r * 2 + 4, d.r * 2 + 4);
      ctx.strokeRect(-d.r - 2, -d.r - 2, d.r * 2 + 4, d.r * 2 + 4);
      ctx.restore();
    }
    kobi(ctx, w * 0.3, h * 0.62, 1.05, t);
    ecrou(ctx, w * 0.17, h * 0.42, 0.9, t);
  } else if (art === 'ship') {
    sky(ctx, w, h, '#2a0f40', '#d0703a', t);
    ctx.fillStyle = '#7a2c18';
    ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(0, h * 0.78);
    for (let x = 0; x <= w; x += 40) ctx.lineTo(x, h * 0.78 + Math.sin(x * 0.02) * 20 + (x % 80 ? 10 : 0));
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
    // débris aspirés
    for (const d of debris) {
      const k = ((d.y + t * 0.25 * d.s) % 1);
      const x = w * 0.5 + (d.x - 0.5) * w * 0.9 * (1 - k);
      const y = h * 0.85 - k * h * 0.6;
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * 3 * d.s + d.a);
      ctx.fillStyle = ['#c98a4b', '#6b7a9a', '#d9b23a'][Math.floor(d.a) % 3];
      ctx.fillRect(-d.r, -d.r, d.r * 2 + 3, d.r * 2 + 3);
      ctx.restore();
    }
    // garage aspiré
    const gk = Math.min(1, t * 0.18);
    ctx.save();
    ctx.translate(w * 0.5 + Math.sin(t * 2) * 10, h * 0.78 - gk * h * 0.45);
    ctx.rotate(Math.sin(t * 1.5) * 0.3);
    ctx.fillStyle = '#d07040'; ctx.strokeStyle = '#1d1028'; ctx.lineWidth = 4;
    ctx.fillRect(-50, -40, 100, 60); ctx.strokeRect(-50, -40, 100, 60);
    ctx.fillStyle = '#5a6a8a';
    ctx.beginPath(); ctx.moveTo(-60, -40); ctx.lineTo(0, -75); ctx.lineTo(60, -40); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.font = `20px "${FONT_TITLE}"`; ctx.fillStyle = '#ffd23a'; ctx.textAlign = 'center'; ctx.fillText('GARAGE', 0, -4);
    ctx.restore();
    voraxShip(ctx, w * 0.5, h * 0.2, 1, t);
  } else if (art === 'baron') {
    sky(ctx, w, h, '#1a0a30', '#5b2aa8', t);
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.font = `200px "${FONT_TITLE}"`;
    ctx.fillStyle = '#ffd23a';
    ctx.textAlign = 'center';
    ctx.fillText('VORAX', w / 2, h * 0.62);
    ctx.restore();
    baron(ctx, w * 0.5, h * 0.55, 1, t);
    ctx.font = `28px "${FONT_TITLE}"`;
    ctx.fillStyle = '#ffd23a';
    ctx.textAlign = 'center';
    ctx.fillText('« ON ASPIRE À MIEUX ! »', w / 2, h * 0.95);
  } else if (art === 'heroes') {
    sky(ctx, w, h, '#ff9a5a', '#ffd9a0', t);
    ctx.fillStyle = '#c0582c';
    ctx.beginPath(); ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 60) ctx.lineTo(x, h * 0.62 - (Math.floor(x / 120) % 2) * 50 - Math.sin(x) * 10);
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e8a060';
    ctx.fillRect(0, h * 0.82, w, h * 0.2);
    kobi(ctx, w * 0.42, h * 0.62, 1.2, t);
    ecrou(ctx, w * 0.62, h * 0.32, 1, t);
  } else if (art === 'boom') {
    sky(ctx, w, h, '#120820', '#4a1f6a', t);
    const r = 60 + t * 120;
    for (let i = 0; i < 3; i++) {
      const g = ctx.createRadialGradient(w / 2, h * 0.55, 0, w / 2, h * 0.55, r * (1 + i * 0.4));
      g.addColorStop(0, 'rgba(255,240,180,0.9)');
      g.addColorStop(0.5, 'rgba(255,140,40,0.5)');
      g.addColorStop(1, 'rgba(255,60,40,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    for (const d of debris) {
      const k = (t * 0.3 * d.s + d.y) % 1;
      const ang = d.a;
      ctx.save();
      ctx.translate(w / 2 + Math.cos(ang) * k * w * 0.6, h * 0.55 + Math.sin(ang) * k * h * 0.6 + k * k * 120);
      ctx.rotate(t * 4 * d.s);
      ctx.fillStyle = '#ffd23a'; ctx.strokeStyle = '#7a4b00'; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; ctx.lineTo(Math.cos(a) * 9, Math.sin(a) * 9); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }
}
