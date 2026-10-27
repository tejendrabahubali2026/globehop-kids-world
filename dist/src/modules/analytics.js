// Privacy-first anonymous analytics. The only data stored server-side is
// integer counters plus public landmark/state identifiers; uniqueness comes
// from a random first-party cookie (gh_vid) managed by the Pages Function.
// No names of people, location or personal data are ever sent.
//
// CRITICAL: every activity call is fire-and-forget. Callers never await these
// functions, so the UI thread and fly-to animations are never blocked.

const ENDPOINT = './api/stats';

function isValidStats(payload) {
  return payload
    && Number.isFinite(Number(payload.total_visits))
    && Number.isFinite(Number(payload.unique_visitors));
}

// Background POST with keepalive; falls back to sendBeacon, then swallows
// errors so analytics can never affect the app experience.
function postActivity(payload) {
  try {
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true
    })
      .then((response) => (response.ok ? response.json().catch(() => null) : null))
      .catch(() => {
        try {
          const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
          navigator.sendBeacon?.(ENDPOINT, blob);
        } catch {
          // ignore — analytics is best-effort
        }
        return null;
      });
  } catch {
    return Promise.resolve(null);
  }
}

// Registers one page load (POST bumps total_visits, and unique_visitors once per
// browser) and returns the latest counters. Falls back to a read-only GET, then
// fails soft so the app never breaks when Functions/D1 are unavailable.
export async function registerVisit() {
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      keepalive: true
    });
    if (response.ok) {
      const payload = await response.json();
      if (isValidStats(payload)) return payload;
    }
  } catch {
    // fall through to GET
  }

  try {
    const response = await fetch(ENDPOINT, { headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    const payload = await response.json();
    return isValidStats(payload) ? payload : null;
  } catch {
    return null;
  }
}

// A landmark "hop": one journey to an Indian landmark with its great-circle
// distance from the current origin. Never throws; resolves with fresh stats.
export function recordHop({ landmarkId, landmarkName, stateName, distanceKm } = {}) {
  if (!landmarkId) return Promise.resolve(null);
  const km = Number(distanceKm);
  return postActivity({
    action: 'hop',
    landmark_id: String(landmarkId),
    landmark_name: String(landmarkName || '').slice(0, 160),
    state_name: String(stateName || '').slice(0, 160),
    distance_km: Number.isFinite(km) && km >= 0 ? Math.round(km * 10) / 10 : 0
  });
}

// A state selection in the Explore India panel. Never throws.
export function recordStateExplore({ stateCode, stateName } = {}) {
  if (!stateCode || !stateName) return Promise.resolve(null);
  return postActivity({
    action: 'explore_state',
    state_code: String(stateCode),
    state_name: String(stateName).slice(0, 160)
  });
}
