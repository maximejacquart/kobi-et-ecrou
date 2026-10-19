// Usage : node tools/snap.mjs <dossier> <nom>=<chemin-url>[@attente_ms] ...   (affiche console et window.__stats)
import { launch, BASE } from './browser.mjs';
const [dir, ...jobs] = process.argv.slice(2);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('X4122')) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
for (const job of jobs) {
  const [name, rest] = job.split(/=(.*)/s);
  const [url, wait] = rest.split('@');
  await page.goto(BASE + url);
  await page.waitForTimeout(+(wait || 2500));
  await page.screenshot({ path: `${dir}/${name}.png` });
  const st = await page.evaluate(() => window.__stats).catch(() => null);
  if (st) console.log(name, JSON.stringify(st));
}
if (logs.length) console.log(logs.slice(0, 20).join('\n'));
await browser.close();
