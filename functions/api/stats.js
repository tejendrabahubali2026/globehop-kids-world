// Privacy-first anonymous visit counters backed by Cloudflare D1 (binding: DB).
// No names, emails, exact GPS or any personal data are collected. Uniqueness is
// derived only from a random first-party cookie id (gh_vid) regenerated per browser.

const COOKIE_NAME = 'gh_vid';
const ONE_YEAR = 60 * 60 * 24 * 365;

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
}

async function readCounts(db) {
  const row = await db
    .prepare('SELECT total_visits, unique_visitors FROM visit_stats WHERE id = 1')
    .first();
  return {
    total_visits: Number(row?.total_visits ?? 0),
    unique_visitors: Number(row?.unique_visitors ?? 0)
  };
}

export async function onRequest(context) {
  const { request, env } = context;

  if (!env || !env.DB) {
    return jsonResponse({ error: 'analytics_unavailable' }, 503);
  }

  try {
    await ensureSchema(env.DB);

    if (request.method === 'GET') {
      return jsonResponse(await readCounts(env.DB));
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'method_not_allowed' }, 405);
    }

    const existingId = readVisitorId(request);
    const isUnique = !existingId;
    const headers = {};

    if (isUnique) {
      const visitorId = generateVisitorId();
      const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
      headers['set-cookie'] =
        `${COOKIE_NAME}=${visitorId}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax${secure}`;
    }

    await env.DB
      .prepare(
        `UPDATE visit_stats
            SET total_visits = total_visits + 1,
                unique_visitors = unique_visitors + ?
          WHERE id = 1`
      )
      .bind(isUnique ? 1 : 0)
      .run();

    return jsonResponse(await readCounts(env.DB), 200, headers);
  } catch (error) {
    return jsonResponse({ error: 'analytics_error' }, 500);
  }
}
