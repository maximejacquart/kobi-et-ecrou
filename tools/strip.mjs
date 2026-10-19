// Planche-contact d'une animation : node tools/strip.mjs <sortie.png> <url> [images=12] [intervalle_ms=70] [attente=2500] [x,y,w,h]
// L'URL peut contenir « #eval:code » : code exécuté avant la prise (ex. appuyer sur une touche).
import { launch, BASE } from './browser.mjs';
const [out, url0, n = 12, every = 70, wait = 2500, clipS] = process.argv.slice(2);
const [url, pre] = url0.split('#eval:');
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(BASE + url);
await page.waitForTimeout(+wait);
if (pre) await page.evaluate(pre);
const clip = clipS ? (([x, y, w, h]) => ({ x, y, width: w, height: h }))(clipS.split(',').map(Number)) : { x: 340, y: 100, width: 600, height: 600 };
const shots = [];
for (let i = 0; i < +n; i++) {
  const t0 = Date.now();
  shots.push((await page.screenshot({ clip })).toString('base64'));
  const dtw = +every - (Date.now() - t0);
  if (dtw > 0) await page.waitForTimeout(dtw);
}
const cols = Math.min(6, shots.length);
const w = 300, h = Math.round(300 * clip.height / clip.width);
await page.setViewportSize({ width: cols * w, height: Math.ceil(shots.length / cols) * h });
await page.setContent(`<body style="margin:0;display:grid;grid-template-columns:repeat(${cols},${w}px);background:#000">${shots.map((b, i) => `<div style="position:relative"><img src="data:image/png;base64,${b}" style="width:${w}px;height:${h}px;display:block"><span style="position:absolute;left:4px;top:2px;color:#fff;font:12px monospace">${i}</span></div>`).join('')}</body>`);
await page.waitForTimeout(200);
await page.screenshot({ path: out, fullPage: true });
if (errs.length) console.log(errs.join('\n'));
await browser.close();
