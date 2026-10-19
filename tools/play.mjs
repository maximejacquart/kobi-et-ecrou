// Scénario joué : node tools/play.mjs <dossier> <niveau> "<étapes>"
// étapes séparées par ';' (ou ';;' si un code contient ';') : hold:KeyW:1500 | down:Mouse0 | up:Mouse0 | press:Space
//   | wait:500 | shot:nom | eval:code | evalfile:fichier.js | click:sélecteur
// niveau « title » : démarre à l'écran titre ; étape reload : recharge la page (après avoir écrit une sauvegarde)
import { launch, BASE } from './browser.mjs';

const [dir, level, script] = process.argv.slice(2);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('X4122') && !m.text().includes('404')) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
const ready = () => page.waitForFunction((t) => window.__game && window.__game.state === t, level === 'title' ? 'title' : 'playing', { timeout: 60000 });
await page.goto(BASE + (level === 'title' ? '' : '?niveau=' + level));
await ready();
await page.waitForTimeout(1500);
if (level !== 'title') await page.evaluate(() => { window.__dbg.god(); window.__game.hud.resetMessages?.(); });
for (const step of script.split(script.includes(';;') ? ';;' : ';').map((s) => s.trim()).filter(Boolean)) {
  const parts = step.split(':');
  const cmd = parts[0], a = cmd === 'eval' ? parts.slice(1).join(':') : parts[1], b = parts[2];
  if (cmd === 'hold') {
    const codes = a, ms = +b;
    await page.evaluate((cs) => { for (const c of cs.split('+')) { window.__game.input.keys.add(c); window.__game.input.pressedSet.add(c); } }, codes);
    await page.waitForTimeout(ms);
    await page.evaluate((cs) => { for (const c of cs.split('+')) { window.__game.input.keys.delete(c); window.__game.input.releasedSet.add(c); } }, codes);
  } else if (cmd === 'down') {
    await page.evaluate((cs) => { for (const c of cs.split('+')) { window.__game.input.keys.add(c); window.__game.input.pressedSet.add(c); } }, a);
  } else if (cmd === 'up') {
    await page.evaluate((cs) => { for (const c of cs.split('+')) { window.__game.input.keys.delete(c); window.__game.input.releasedSet.add(c); } }, a);
  } else if (cmd === 'press') {
    await page.evaluate((c) => { window.__game.input.keys.add(c); window.__game.input.pressedSet.add(c); }, a);
    await page.waitForTimeout(60);
    await page.evaluate((c) => { window.__game.input.keys.delete(c); window.__game.input.releasedSet.add(c); }, a);
  } else if (cmd === 'reload') { await page.reload(); await ready(); await page.waitForTimeout(1000); }
  else if (cmd === 'click') await page.click(a);
  else if (cmd === 'wait') await page.waitForTimeout(+a);
  else if (cmd === 'shot') await page.screenshot({ path: `${dir}/${a}.png` });
  else if (cmd === 'eval') console.log('eval', JSON.stringify(await page.evaluate(a)));
  else if (cmd === 'evalfile') console.log('eval', JSON.stringify(await page.evaluate((await import('node:fs')).readFileSync(a, 'utf8'))));
}
if (logs.length) console.log(logs.slice(0, 20).join('\n'));
await browser.close();
