import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const g3 = read('src/modules/globe3d.js');
const g2 = read('src/modules/globe.js');
const app = read('src/app.js');
const sw = read('public/sw.js');
const analytics = read('src/modules/analytics.js');
const statsFn = read('functions/api/stats.js');

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
  ['Service worker never caches the analytics API', sw.includes("url.pathname.startsWith('/api/')")],
  ['D1 function auto-creates community tables', statsFn.includes('CREATE TABLE IF NOT EXISTS landmark_stats') && statsFn.includes('CREATE TABLE IF NOT EXISTS state_stats') && statsFn.includes('CREATE TABLE IF NOT EXISTS community_stats')],
  ['D1 function upserts landmark and state rows', statsFn.includes('ON CONFLICT(landmark_id) DO UPDATE') && statsFn.includes('ON CONFLICT(state_code) DO UPDATE')],
  ['D1 GET returns community leaderboard payload', statsFn.includes('top_landmarks') && statsFn.includes('top_states') && statsFn.includes('total_hops') && statsFn.includes('total_distance_km')],
  ['D1 function fails soft on errors', statsFn.includes('return jsonResponse({ ok: false }, 200)')],
  ['Analytics client sends fire-and-forget hops and state explores', analytics.includes('keepalive: true') && analytics.includes('action: \'hop\'') && analytics.includes('action: \'explore_state\'') && analytics.includes('sendBeacon')],
  ['Community widget renders hops, distance and trending landmarks', app.includes('communityStats') && app.includes('renderCommunityStats') && app.includes('trendingLandmarks')],
  ['Fly-to records a hop without awaiting it', app.includes('recordHop(') && app.includes('recordStateExplore(')]
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failed++;
}
if (failed) process.exit(1);
