// Privacy-first anonymous analytics. The only data stored server-side is two
// integer counters; uniqueness comes from a random first-party cookie (gh_vid)
// managed by the Pages Function. No names, location or personal data are sent.

const ENDPOINT = './api/stats';

function isValidStats(payload) {
  return payload
    && Number.isFinite(Number(payload.total_visits))
    && Number.isFinite(Number(payload.unique_visitors));
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
