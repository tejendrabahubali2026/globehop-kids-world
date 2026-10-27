import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const g3 = read('src/modules/globe3d.js');
const g2 = read('src/modules/globe.js');
const app = read('src/app.js');
const sw = read('public/sw.js');

const checks = [
  ['3D texture has no persistent country-name text', !g3.includes('drawSurfaceCountryName') && !g3.includes('strokeText(label')],
  ['3D uses responsive screen-space label scale', g3.includes('uiFactor') && g3.includes('compactLabels')],
  ['3D has programmatic zoom buttons API', g3.includes('zoomBy(factor')],
  ['2D has wheel/pinch/drag interactions', g2.includes('bindMapInteractions') && g2.includes("addEventListener('wheel'") && g2.includes("addEventListener('pointermove'")],
  ['2D has pointer-anchored zoom', g2.includes('zoomAt(factor') && g2.includes('mapPointFromClient')],
  ['2D suppresses accidental click after pan', g2.includes('suppressClickUntil')],
  ['UI has +/- zoom controls', app.includes('mapZoomControls') && app.includes('data-zoom="in"') && app.includes('data-zoom="out"')],
  ['Build badge is V8.5', app.includes('V8.5')],
  ['Service worker cache is India stats build', sw.includes('globehop-kids-india-stats-20261027')],
  ['Indian landmarks dataset is precached', sw.includes('src/data/indian-landmarks/index.json')],
  ['Service worker clones responses before caching', sw.includes('response.clone()')],
  ['Service worker never caches the analytics API', sw.includes("url.pathname.startsWith('/api/')")]
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failed++;
}
if (failed) process.exit(1);
