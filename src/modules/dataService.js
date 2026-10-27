import { APP, REGION_FILES } from './config.js';

const cache = new Map();

async function fetchJson(url) {
  const key = url.toString();
  if (cache.has(key)) return cache.get(key);
  const promise = fetch(url).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
  cache.set(key, promise);
  try { return await promise; } catch (error) { cache.delete(key); throw error; }
}

const dataUrl = (path) => new URL(`../data/${path}`, import.meta.url);

export function getFlagEmoji(code2) {
  if (!code2 || code2.length !== 2) return '🌍';
  return [...code2.toUpperCase()].map((c) => String.fromCodePoint(127397 + c.charCodeAt())).join('');
}

export function displayCountryName(code2, locale = 'en', fallback = '') {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code2) || fallback || code2;
  } catch {
    return fallback || code2;
  }
}

export async function loadCountryIndex() {
  return fetchJson(dataUrl('countries/index.json'));
}

export async function loadWorldGeometries() {
  return fetchJson(dataUrl('world-geometries.json'));
}

export async function loadPlaces() {
  return fetchJson(dataUrl('places/index.json'));
}

export async function loadCities() {
  const payload = await fetchJson(dataUrl('cities/index.json'));
  return payload?.cities || [];
}

export async function loadKoreaTourism() {
  return fetchJson(dataUrl('korea/tourism.json'));
}

export async function getKoreaTourismCity(cityName) {
  const data = await loadKoreaTourism().catch(() => null);
  if (!data || !cityName) return null;
  const direct = data.cityProfiles?.[cityName];
  if (direct) return { key: cityName, ...direct };
  const normalized = String(cityName).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  let key = Object.keys(data.cityProfiles || {}).find((name) => name.normalize('NFKC').toLowerCase() === normalized);
  if (!key) key = Object.entries(data.cityAliases || {}).find(([, ko]) => String(ko).normalize('NFKC').toLowerCase() === normalized)?.[0];
  if (!key) key = Object.entries(data.cityProfiles || {}).find(([, profile]) => String(profile.nameKo || '').normalize('NFKC').toLowerCase() === normalized)?.[0];
  return key && data.cityProfiles?.[key] ? { key, ...data.cityProfiles[key] } : null;
}

export async function getKoreaTourismAttractions() {
  const data = await loadKoreaTourism().catch(() => null);
  return data?.nationalAttractions || [];
}

export async function loadOrigins() {
  return fetchJson(dataUrl('origins/index.json'));
}

export async function loadIndianLandmarks() {
  const payload = await fetchJson(dataUrl('indian-landmarks/index.json'));
  return payload?.landmarks || [];
}

export async function getCountry(code2) {
  const index = await loadCountryIndex();
  const base = index.find((x) => x.code2 === code2?.toUpperCase());
  if (!base) return null;
  const regionFile = REGION_FILES[base.region] || 'other';
  const rows = await fetchJson(dataUrl(`countries/regions/${regionFile}.json`));
  return rows.find((x) => x.code2 === base.code2) || base;
}

function scoreField(value, query, locale) {
  if (!value) return 99;
  const normalized = String(value).toLocaleLowerCase(locale);
  if (normalized === query) return 0;
  if (normalized.startsWith(query)) return 1;
  if (normalized.includes(query)) return 3;
  return 99;
}

export async function searchLocal(query, locale) {
  const q = query.trim().toLocaleLowerCase(locale);
  if (!q) return [];
  const [countries, places, cities, koreaTourism] = await Promise.all([loadCountryIndex(), loadPlaces(), loadCities(), loadKoreaTourism().catch(() => null)]);
  const countryMatches = countries.map((c) => {
    const localized = displayCountryName(c.code2, locale, c.name);
    const fields = [localized, c.name, c.nativeName, c.capital, c.code2, c.code3];
    const score = Math.min(...fields.map((value) => scoreField(value, q, locale)));
    return score < 99 ? { kind: 'country', score, ...c, displayName: localized } : null;
  }).filter(Boolean);

  const placeMatches = places.map((p) => {
    const fields = [p.name, p.nameKo];
    const score = Math.min(...fields.map((value) => scoreField(value, q, locale)));
    return score < 99 ? { kind: 'place', score, ...p, featured: true } : null;
  }).filter(Boolean);

  const featuredKeys = new Set(placeMatches.map((p) => `${p.countryCode}:${String(p.name).toLocaleLowerCase(locale)}`));
  const cityMatches = [];
  for (const row of cities) {
    const [name, countryCode, admin1, geonameId, lat, lon, population, timezone, featureCode, elevation] = row;
    const nameKo = countryCode === 'KR' ? koreaTourism?.cityAliases?.[name] : '';
    const score = Math.min(scoreField(name, q, locale), scoreField(nameKo, q, locale), scoreField(admin1, q, locale));
    if (score >= 99) continue;
    if (featuredKeys.has(`${countryCode}:${String(name).toLocaleLowerCase(locale)}`)) continue;
    cityMatches.push({
      kind: 'city-index',
      type: 'city',
      score: score + 0.25,
      id: `gn-${geonameId}`,
      geonameId,
      name,
      nameKo,
      countryCode,
      admin1,
      lat, lon, population, timezone, featureCode, elevation,
      needsGeocode: !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon)),
      source: 'geonames-index'
    });
  }

  return [...countryMatches, ...placeMatches, ...cityMatches]
    .sort((a, b) => a.score - b.score || Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || String(a.displayName || a.name).localeCompare(String(b.displayName || b.name)))
    .slice(0, 12);
}

export async function searchOnlinePlaces(query, locale) {
  const params = new URLSearchParams({ name: query, count: '8', language: locale, format: 'json' });
  const url = `${APP.geocodingEndpoint}?${params}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('geocoding failed');
  const json = await res.json();
  return (json.results || []).map((p) => ({
    kind: 'online-place',
    id: `om-${p.id}`,
    geonameId: p.id,
    name: p.name,
    type: 'city',
    countryCode: p.country_code,
    country: p.country,
    admin1: p.admin1,
    admin2: p.admin2,
    admin3: p.admin3,
    admin4: p.admin4,
    lat: p.latitude,
    lon: p.longitude,
    elevation: p.elevation,
    timezone: p.timezone,
    population: p.population,
    postcodes: p.postcodes,
    featureCode: p.feature_code,
    source: 'open-meteo-geocoding'
  }));
}

export async function resolveCityLocation(city, locale = 'en') {
  if (!city?.name || !city?.countryCode) return null;
  const params = new URLSearchParams({
    name: city.name,
    count: '10',
    language: locale,
    format: 'json',
    countryCode: city.countryCode
  });
  const res = await fetch(`${APP.geocodingEndpoint}?${params}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const json = await res.json();
  const rows = json.results || [];
  if (!rows.length) return null;
  const normalize = (v) => String(v || '').normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const targetName = normalize(city.name);
  const targetAdmin = normalize(city.admin1);
  const ranked = rows.map((p) => {
    let score = 0;
    const pn = normalize(p.name);
    const pa = normalize(p.admin1);
    if (pn === targetName) score += 8;
    else if (pn.startsWith(targetName) || targetName.startsWith(pn)) score += 4;
    if (targetAdmin && pa === targetAdmin) score += 5;
    if (p.feature_code === 'PPLC') score += 2;
    score += Math.min(2, Math.log10(Math.max(1, Number(p.population) || 1)) / 4);
    return { p, score };
  }).sort((a, b) => b.score - a.score);
  const p = ranked[0].p;
  return {
    id: city.id || `om-${p.id}`,
    geonameId: p.id,
    name: city.name,
    localizedName: p.name,
    type: 'city',
    countryCode: p.country_code || city.countryCode,
    country: p.country,
    admin1: p.admin1 || city.admin1,
    admin2: p.admin2,
    admin3: p.admin3,
    admin4: p.admin4,
    lat: p.latitude,
    lon: p.longitude,
    elevation: p.elevation,
    timezone: p.timezone,
    population: p.population,
    postcodes: p.postcodes,
    featureCode: p.feature_code,
    source: 'open-meteo-geocoding'
  };
}

export async function getCountryCitySuggestions(countryCode, { admin1 = '', excludeName = '', limit = 12 } = {}) {
  const [rows, koreaTourism] = await Promise.all([loadCities(), countryCode === 'KR' ? loadKoreaTourism().catch(() => null) : Promise.resolve(null)]);
  const wantedAdmin = String(admin1 || '').toLowerCase();
  const excluded = String(excludeName || '').toLowerCase();
  const candidates = [];
  const seen = new Set();
  for (const row of rows) {
    const [name, code, rowAdmin1, geonameId, lat, lon, population, timezone, featureCode, elevation] = row;
    if (code !== countryCode) continue;
    const key = `${name.toLowerCase()}|${String(rowAdmin1 || '').toLowerCase()}`;
    if (name.toLowerCase() === excluded || seen.has(key)) continue;
    seen.add(key);
    const nameKo = code === 'KR' ? (koreaTourism?.cityAliases?.[name] || '') : '';
    candidates.push({
      kind: 'city-index', type: 'city', id: `gn-${geonameId}`, geonameId, name, nameKo,
      countryCode: code, admin1: rowAdmin1, lat, lon, population, timezone, featureCode, elevation,
      needsGeocode: !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon)), source: 'geonames-index'
    });
  }
  candidates.sort((a, b) => {
    const adminBoostA = wantedAdmin && String(a.admin1 || '').toLowerCase() === wantedAdmin ? 1 : 0;
    const adminBoostB = wantedAdmin && String(b.admin1 || '').toLowerCase() === wantedAdmin ? 1 : 0;
    if (adminBoostA !== adminBoostB) return adminBoostB - adminBoostA;
    const popA = Number(a.population) || 0;
    const popB = Number(b.population) || 0;
    if (popA !== popB) return popB - popA;
    return a.name.localeCompare(b.name);
  });
  return candidates.slice(0, Number.isFinite(limit) ? limit : candidates.length);
}

export async function loadKnowledge(code2) {
  try {
    return await fetchJson(dataUrl(`knowledge/${code2.toLowerCase()}.json`));
  } catch {
    return null;
  }
}

export async function fetchRoadRoute(origin, destination, { timeoutMs = 6000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const coordinates = `${origin.lon},${origin.lat};${destination.lon},${destination.lat}`;
    const params = new URLSearchParams({ overview: 'false', steps: 'false' });
    const url = `${APP.osrmEndpoint}/route/v1/driving/${coordinates}?${params}`;
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
    const json = await res.json();
    const route = json?.routes?.[0];
    if (json?.code !== 'Ok' || !route) return null;
    return { distanceKm: route.distance / 1000, hours: route.duration / 3600, source: 'osrm' };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWorldBankIndicator(code3, indicator) {
  const url = `${APP.worldBankEndpoint}/country/${encodeURIComponent(code3)}/indicator/${indicator}?format=json&mrnev=1&per_page=1`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('World Bank unavailable');
  const json = await res.json();
  const row = Array.isArray(json) ? json[1]?.[0] : null;
  if (!row || row.value == null) return null;
  return { value: Number(row.value), year: row.date, indicator: row.indicator?.value || indicator };
}

export async function fetchWorldBankStats(code3) {
  const entries = await Promise.allSettled([
    fetchWorldBankIndicator(code3, APP.worldBankIndicators.population),
    fetchWorldBankIndicator(code3, APP.worldBankIndicators.gdp),
    fetchWorldBankIndicator(code3, APP.worldBankIndicators.gni)
  ]);
  return {
    population: entries[0].status === 'fulfilled' ? entries[0].value : null,
    gdp: entries[1].status === 'fulfilled' ? entries[1].value : null,
    gni: entries[2].status === 'fulfilled' ? entries[2].value : null,
    failed: entries.every((x) => x.status === 'rejected')
  };
}
