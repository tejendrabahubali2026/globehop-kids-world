const PREFIX = 'globehop:';
const SCHEMA_VERSION = 2;
const VERSION_KEY = 'globehop:schemaVersion';

// One-time migration for the India-focused build: discard legacy trips/destinations
// (e.g. old Seoul/KR fallbacks) so every user starts with a clean, India-first state.
export function migrateStorage() {
  try {
    const previous = Number(localStorage.getItem(VERSION_KEY) || 1);
    if (previous < SCHEMA_VERSION) {
      localStorage.removeItem(PREFIX + 'recent');
      localStorage.removeItem(PREFIX + 'lastDestination');
      localStorage.setItem(VERSION_KEY, String(SCHEMA_VERSION));
    }
  } catch {
    // Storage can be unavailable; the app still works fully without persistence.
  }
}

export function getStored(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function setStored(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage can be blocked; the app still works without persistence.
  }
}

export function pushRecent(item, max = 8) {
  const recent = getStored('recent', []);
  const next = [item, ...recent.filter((x) => x.key !== item.key)].slice(0, max);
  setStored('recent', next);
  return next;
}

export function toggleFavorite(item) {
  const favorites = getStored('favorites', []);
  const exists = favorites.some((x) => x.key === item.key);
  const next = exists ? favorites.filter((x) => x.key !== item.key) : [item, ...favorites].slice(0, 24);
  setStored('favorites', next);
  return { favorites: next, active: !exists };
}
