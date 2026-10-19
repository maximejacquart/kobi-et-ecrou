// Installe les dépendances au premier lancement pour que `npm start` suffise.
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const needed = ['three', 'vite', 'opentype.js'];
const missing = needed.filter((m) => !existsSync(new URL(`../node_modules/${m}/package.json`, import.meta.url)));
if (missing.length) {
  console.log(`\n  Kobi & Écrou — installation des dépendances (${missing.join(', ')})…\n`);
  execSync('npm install --no-audit --no-fund', { stdio: 'inherit', cwd: new URL('..', import.meta.url) });
}
