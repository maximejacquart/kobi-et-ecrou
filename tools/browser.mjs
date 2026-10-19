// Chrome installé sur la machine, sans fenêtre mais avec le vrai GPU (le jeu doit tourner : npm run dev)
import { chromium } from 'playwright-core';

// adresse du serveur de développement (PORT=5174 node tools/… pour un autre serveur)
export const BASE = `http://localhost:${process.env.PORT || 5173}/`;

export const launch = () => chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : [])],
});
