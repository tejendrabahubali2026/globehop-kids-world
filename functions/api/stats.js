// Privacy-first anonymous analytics backed by Cloudflare D1 (binding: DB).
// No names, emails, exact GPS or any personal data are collected. Visit
// uniqueness comes only from a random first-party cookie (gh_vid); the
// community tables store landmark/state identifiers and integer counters.

const COOKIE_NAME = 'gh_vid';
const ONE_YEAR = 60 * 60 * 24 * 365;
const MAX_DISTANCE_KM = 100000;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,119}$/;

const jsonResponse = (payload, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders
    }
  });

function readVisitorId(request) {
  const cookies = request.headers.get('cookie') || '';
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function generateVisitorId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function ensureSchema(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS visit_stats (
         id INTEGER PRIMARY KEY CHECK (id = 1),
         total_visits INTEGER NOT NULL DEFAULT 0,
         unique_visitors INTEGER NOT NULL DEFAULT 0
       )`
    )
    .run();
  await db
    .prepare('INSERT OR IGNORE INTO visit_stats (id, total_visits, unique_visitors) VALUES (1, 0, 0)')
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS community_stats (
         id INTEGER PRIMARY KEY CHECK (id = 1),
         total_hops INTEGER NOT NULL DEFAULT 0,
         total_distance_km REAL NOT NULL DEFAULT 0
       )`
    )
    .run();
  await db
    .prepare('INSERT OR IGNORE INTO community_stats (id, total_hops, total_distance_km) VALUES (1, 0, 0)')
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS landmark_stats (
         landmark_id TEXT PRIMARY KEY,
         landmark_name TEXT NOT NULL,
         state_name TEXT NOT NULL DEFAULT '',
         click_count INTEGER NOT NULL DEFAULT 0
       )`
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS state_stats (
         state_code TEXT PRIMARY KEY,
         state_name TEXT NOT NULL,
         explore_count INTEGER NOT NULL DEFAULT 0
       )`
    )
    .run();
}

async function readAllStats(db) {
  const visits = await db
    .prepare('SELECT total_visits, unique_visitors FROM visit_stats WHERE id = 1')
    .first();
  const community = await db
    .prepare('SELECT total_hops, total_distance_km FROM community_stats WHERE id = 1')
    .first();
  const topLandmarks = await db
    .prepare(
      `SELECT landmark_id, landmark_name, state_name, click_count
         FROM landmark_stats
        ORDER BY click_count DESC, landmark_name ASC
        LIMIT 3`
    )
    .all();
  const topStates = await db
    .prepare(
      `SELECT state_code, state_name, explore_count
         FROM state_stats
        ORDER BY explore_count DESC, state_name ASC
        LIMIT 3`
    )
    .all();

  return {
    total_visits: Number(visits?.total_visits ?? 0),
    unique_visitors: Number(visits?.unique_visitors ?? 0),
    total_hops: Number(community?.total_hops ?? 0),
    total_distance_km: Math.round(Number(community?.total_distance_km ?? 0) * 10) / 10,
    top_landmarks: (topLandmarks?.results || []).map((row) => ({
      landmark_id: row.landmark_id,
      landmark_name: row.landmark_name,
      state_name: row.state_name,
      click_count: Number(row.click_count)
    })),
    top_states: (topStates?.results || []).map((row) => ({
      state_code: row.state_code,
      state_name: row.state_name,
      explore_count: Number(row.explore_count)
    }))
  };
}

function cleanName(value) {
  return typeof value === 'string' ? value.trim().slice(0, 160) : '';
}

function parseHop(body) {
  const landmarkId = typeof body.landmark_id === 'string' ? body.landmark_id.trim().toLowerCase() : '';
  if (!ID_PATTERN.test(landmarkId)) return null;
  const rawDistance = Number(body.distance_km);
  if (!Number.isFinite(rawDistance) || rawDistance < 0) return null;
  return {
    landmarkId,
    landmarkName: cleanName(body.landmark_name) || landmarkId,
    stateName: cleanName(body.state_name),
    distanceKm: Math.min(Math.round(rawDistance * 10) / 10, MAX_DISTANCE_KM)
  };
}

function parseStateExplore(body) {
  const stateCode = typeof body.state_code === 'string' ? body.state_code.trim().toLowerCase() : '';
  if (!ID_PATTERN.test(stateCode)) return null;
  const stateName = cleanName(body.state_name);
  if (!stateName) return null;
  return { stateCode, stateName };
}

async function recordVisit(db, request) {
  const existingId = readVisitorId(request);
  const isUnique = !existingId;
  const headers = {};

  if (isUnique) {
    const visitorId = generateVisitorId();
    const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
    headers['set-cookie'] =
      `${COOKIE_NAME}=${visitorId}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax${secure}`;
  }

  await db
    .prepare(
      `UPDATE visit_stats
          SET total_visits = total_visits + 1,
              unique_visitors = unique_visitors + ?
        WHERE id = 1`
    )
    .bind(isUnique ? 1 : 0)
    .run();

  return headers;
}

async function readPostBody(request) {
  const type = request.headers.get('content-type') || '';
  if (!type.includes('application/json')) return { action: 'visit' };
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : {};
  } catch {
    return {};
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  if (!env || !env.DB) {
    return jsonResponse({ error: 'analytics_unavailable' }, 503);
  }

  try {
    await ensureSchema(env.DB);

    if (request.method === 'GET') {
      return jsonResponse(await readAllStats(env.DB));
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'method_not_allowed' }, 405);
    }

    const body = await readPostBody(request);
    const action = typeof body.action === 'string' ? body.action : 'visit';

    if (action === 'hop') {
      const hop = parseHop(body);
      // Invalid payloads fail soft: acknowledge but change nothing.
      if (hop) {
        try {
          await env.DB
            .prepare(
              `UPDATE community_stats
                  SET total_hops = total_hops + 1,
                      total_distance_km = total_distance_km + ?
                WHERE id = 1`
            )
            .bind(hop.distanceKm)
            .run();
          await env.DB
            .prepare(
              `INSERT INTO landmark_stats (landmark_id, landmark_name, state_name, click_count)
               VALUES (?, ?, ?, 1)
               ON CONFLICT(landmark_id) DO UPDATE SET
                 click_count = click_count + 1,
                 landmark_name = excluded.landmark_name,
                 state_name = excluded.state_name`
            )
            .bind(hop.landmarkId, hop.landmarkName, hop.stateName)
            .run();
        } catch {
          return jsonResponse({ ok: false }, 200);
        }
      }
      return jsonResponse({ ok: true, ...(await readAllStats(env.DB)) }, 200);
    }

    if (action === 'explore_state') {
      const stateEntry = parseStateExplore(body);
      if (stateEntry) {
        try {
          await env.DB
            .prepare(
              `INSERT INTO state_stats (state_code, state_name, explore_count)
               VALUES (?, ?, 1)
               ON CONFLICT(state_code) DO UPDATE SET
                 explore_count = explore_count + 1,
                 state_name = excluded.state_name`
            )
            .bind(stateEntry.stateCode, stateEntry.stateName)
            .run();
        } catch {
          return jsonResponse({ ok: false }, 200);
        }
      }
      return jsonResponse({ ok: true, ...(await readAllStats(env.DB)) }, 200);
    }

    // Default action: page-load visit (legacy behaviour, no JSON body).
    const headers = await recordVisit(env.DB, request);
    return jsonResponse(await readAllStats(env.DB), 200, headers);
  } catch (error) {
    // Never break the client: analytics is best-effort.
    return jsonResponse({ ok: false }, 200);
  }
}
