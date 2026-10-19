// Point d'entrée : police maison, icône, jeu.
import './ui/style.css';
import { installFonts } from './ui/font.js';
import { Game } from './game/game.js';
import { installTypography } from './ui/typo.js';
import { prebuildSculpts } from './models/sculpt.js';
import { createHero } from './models/hero.js';
import { SCULPT_FACTORIES } from './models/enemies.js';
import { NPC_FACTORIES } from './models/npc.js';

function favicon() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.translate(32, 32);
  ctx.fillStyle = '#ffd23a';
  ctx.strokeStyle = '#7a4b00';
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.lineTo(Math.cos(a) * 28, Math.sin(a) * 28);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#1a1028';
  ctx.beginPath();
  ctx.arc(0, 0, 11, 0, Math.PI * 2);
  ctx.fill();
  const link = document.createElement('link');
  link.rel = 'icon';
  link.href = c.toDataURL();
  document.head.appendChild(link);
}

function uiScale() {
  const h = window.innerHeight;
  document.documentElement.style.setProperty('--ui', Math.max(0.72, Math.min(1.6, h / 860)).toFixed(3));
  document.documentElement.style.setProperty('--uiz', Math.max(0.8, Math.min(1.5, h / 900)).toFixed(3));
}
window.addEventListener('resize', uiScale);
uiScale();

async function boot() {
  favicon();
  await installFonts();
  document.body.classList.add('fonts-ready');
  installTypography();
  // personnages sculptés : géométries calculées en parallèle avant le premier affichage
  await prebuildSculpts([createHero, ...SCULPT_FACTORIES, ...NPC_FACTORIES]);
  const game = new Game(document.getElementById('app'));
  // ?niveau=<id> : départ direct dans un niveau (développement seulement)
  const lv = import.meta.env.DEV && new URLSearchParams(location.search).get('niveau');
  if (lv) {
    game.weapons.initFromSave(!game.hasSave());
    await game.startLevel(lv);
  } else {
    await game.toTitle();
  }
  game.menus.loading(false);
}
boot();

// Outils de test (console, développement seulement) : __dbg.god(), __dbg.bolts(5000), __dbg.all(), __dbg.kill(),
// __dbg.tp(x, y, z)
if (import.meta.env.DEV) window.__dbg = {
  god(on = true) { window.__game.cheats.god = on; },
  bolts(n = 10000) { window.__game.addBolts(n); },
  all() {
    const w = window.__game.weapons;
    for (const id of Object.keys(w.data.weapons)) { const st = w.state(id); st.owned = true; st.ammo = w.maxAmmo(id); }
    window.__game.hud.refreshAll();
  },
  max() {
    const w = window.__game.weapons;
    for (const id of w.ownedList()) { const st = w.state(id); st.level = 5; st.xp = 1400; st.ammo = w.maxAmmo(id); }
    w._attach();
    window.__game.hud.refreshAll();
  },
  kill() { for (const e of window.__game.enemies.alive()) e.damage(99999, { source: 'riveteuse' }); },
  // mode Défi n (jeu marqué comme fini) ; prend effet sur les ennemis créés ensuite
  defi(n = 1) { const g = window.__game; g.data.gameDone = true; g.data.defi = n; g.hud.chain(g.chain, false); },
  tp(x, y, z) { const p = window.__game.player; p.pos.set(x, y, z); p.vel.set(0, 0, 0); },
};
