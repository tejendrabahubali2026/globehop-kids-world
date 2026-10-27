import { APP } from './config.js';
import { displayCountryName, getCountryCitySuggestions, getKoreaTourismCity, resolveCityLocation } from './dataService.js';
import { resolveWikipediaImages } from './wikiMedia.js';

const WIKI_LOCALE = {
  en: 'en', hi: 'hi', bn: 'bn', ur: 'ur', mr: 'mr', te: 'te', ta: 'ta', gu: 'gu'
};

function wikiLanguage(locale) {
  return WIKI_LOCALE[locale] || 'en';
}

async function fetchJson(url, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function distanceKm(a, b) {
  const r = 6371.0088;
  const rad = (n) => n * Math.PI / 180;
  const dLat = rad(Number(b.lat) - Number(a.lat));
  const dLon = rad(Number(b.lon) - Number(a.lon));
  const lat1 = rad(Number(a.lat));
  const lat2 = rad(Number(b.lat));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

function normalized(value) {
  return String(value || '').normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

async function fetchWeather(location) {
  const params = new URLSearchParams({
    latitude: String(location.lat),
    longitude: String(location.lon),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,surface_pressure,cloud_cover,visibility,precipitation,is_day',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max',
    timezone: 'auto',
    forecast_days: '1'
  });
  return fetchJson(`${APP.forecastEndpoint}?${params}`, 6500);
}

async function fetchAirQuality(location) {
  const params = new URLSearchParams({
    latitude: String(location.lat),
    longitude: String(location.lon),
    current: 'us_aqi,european_aqi,pm2_5,pm10,uv_index,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide,dust',
    timezone: 'auto',
    forecast_days: '1'
  });
  return fetchJson(`${APP.airQualityEndpoint}?${params}`, 6500);
}

function mapWikiPage(page) {
  const coords = page.coordinates?.[0];
  return {
    pageId: page.pageid,
    title: page.title,
    extract: page.extract || page.description || '',
    description: page.description || '',
    url: page.fullurl || '',
    image: page.thumbnail?.source || page.original?.source || '',
    width: page.thumbnail?.width,
    height: page.thumbnail?.height,
    lat: coords?.lat,
    lon: coords?.lon,
    qid: page.pageprops?.wikibase_item || ''
  };
}

async function searchWikipediaCity(location, country, locale) {
  const lang = wikiLanguage(locale);
  const countryName = displayCountryName(country.code2, locale, country.name);
  const queryName = location.localizedName || location.name;
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrsearch: `${queryName} ${countryName}`,
    gsrnamespace: '0',
    gsrlimit: '6',
    prop: 'extracts|pageimages|info|pageprops|description',
    exintro: '1',
    explaintext: '1',
    exchars: '750',
    piprop: 'thumbnail|original',
    pithumbsize: '900',
    inprop: 'url'
  });
  const endpoint = `https://${lang}.wikipedia.org/w/api.php?${params}`;
  const json = await fetchJson(endpoint, 7000);
  const pages = Object.values(json?.query?.pages || {}).sort((a, b) => (a.index ?? 999) - (b.index ?? 999));
  if (!pages.length) return null;
  const target = normalized(queryName);
  const ranked = pages.map((page, index) => {
    const title = normalized(page.title);
    let score = Math.max(0, 10 - index);
    if (title === target) score += 20;
    else if (title.startsWith(target) || target.startsWith(title)) score += 8;
    if (page.coordinates?.length) score += 2;
    if (page.pageprops?.wikibase_item) score += 1;
    return { page, score };
  }).sort((a, b) => b.score - a.score);
  return { ...mapWikiPage(ranked[0].page), language: lang };
}

function claimRows(entity, property) {
  return (entity?.claims?.[property] || []).filter((row) => row?.mainsnak?.datavalue?.value != null);
}

function claimValue(row) {
  return row?.mainsnak?.datavalue?.value;
}

function timeYear(value) {
  const match = String(value?.time || '').match(/^([+-]?\d{1,6})-/);
  return match ? Number(match[1]) : null;
}

function latestQuantity(entity, property) {
  const rows = claimRows(entity, property).map((row) => {
    const value = claimValue(row);
    const date = row.qualifiers?.P585?.[0]?.datavalue?.value;
    return { row, value, year: timeYear(date), rank: row.rank === 'preferred' ? 2 : row.rank === 'normal' ? 1 : 0 };
  }).sort((a, b) => b.rank - a.rank || (b.year || -99999) - (a.year || -99999));
  return rows[0] || null;
}

function amountNumber(value) {
  const n = Number(value?.amount);
  return Number.isFinite(n) ? n : null;
}

function firstString(entity, property) {
  const row = claimRows(entity, property)[0];
  const value = claimValue(row);
  if (typeof value === 'string') return value;
  if (value?.text) return value.text;
  return '';
}

function itemIds(entity, property, limit = 8) {
  return claimRows(entity, property).map((row) => claimValue(row)?.id).filter(Boolean).slice(0, limit);
}

async function fetchLabels(ids, locale) {
  if (!ids.length) return {};
  const lang = wikiLanguage(locale);
  const params = new URLSearchParams({
    action: 'wbgetentities', format: 'json', origin: '*', ids: ids.join('|'), props: 'labels', languages: `${lang}|en`, languagefallback: '1'
  });
  const json = await fetchJson(`https://www.wikidata.org/w/api.php?${params}`, 7000);
  const out = {};
  for (const [id, entity] of Object.entries(json.entities || {})) {
    out[id] = entity.labels?.[lang]?.value || entity.labels?.en?.value || Object.values(entity.labels || {})[0]?.value || id;
  }
  return out;
}

async function fetchWikidataCity(qid, locale) {
  if (!/^Q\d+$/.test(qid || '')) return null;
  const lang = wikiLanguage(locale);
  const params = new URLSearchParams({
    action: 'wbgetentities', format: 'json', origin: '*', ids: qid, props: 'claims|labels|descriptions', languages: `${lang}|en`, languagefallback: '1'
  });
  const json = await fetchJson(`https://www.wikidata.org/w/api.php?${params}`, 7000);
  const entity = json.entities?.[qid];
  if (!entity || entity.missing !== undefined) return null;

  const pop = latestQuantity(entity, 'P1082');
  const area = latestQuantity(entity, 'P2046');
  const elevation = latestQuantity(entity, 'P2044');
  const inception = claimRows(entity, 'P571').map((row) => timeYear(claimValue(row))).filter(Number.isFinite).sort((a, b) => a - b)[0] ?? null;
  const areaAmount = amountNumber(area?.value);
  const areaUnit = String(area?.value?.unit || '').split('/').pop();
  let areaKm2 = areaAmount;
  if (areaUnit === 'Q25343') areaKm2 = areaAmount == null ? null : areaAmount / 1_000_000; // square metre
  const elevationAmount = amountNumber(elevation?.value);

  const related = {
    timezones: itemIds(entity, 'P421', 4),
    languages: itemIds(entity, 'P37', 8),
    twinCities: itemIds(entity, 'P190', 8)
  };
  const labelMap = await fetchLabels([...new Set(Object.values(related).flat())], locale).catch(() => ({}));
  return {
    qid,
    url: `https://www.wikidata.org/wiki/${qid}`,
    description: entity.descriptions?.[lang]?.value || entity.descriptions?.en?.value || '',
    officialName: firstString(entity, 'P1448'),
    demonym: firstString(entity, 'P1549'),
    nickname: firstString(entity, 'P1449'),
    motto: firstString(entity, 'P1451'),
    inceptionYear: inception,
    population: amountNumber(pop?.value),
    populationYear: pop?.year || null,
    areaKm2: Number.isFinite(areaKm2) ? areaKm2 : null,
    elevation: elevationAmount,
    officialWebsite: firstString(entity, 'P856'),
    postalCode: firstString(entity, 'P281'),
    callingCode: firstString(entity, 'P473'),
    timezones: related.timezones.map((id) => labelMap[id] || id),
    languages: related.languages.map((id) => labelMap[id] || id),
    twinCities: related.twinCities.map((id) => labelMap[id] || id)
  };
}

async function fetchNearbyWikipedia(location, locale) {
  const lang = wikiLanguage(locale);
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'geosearch',
    ggscoord: `${location.lat}|${location.lon}`,
    ggsradius: '10000',
    ggslimit: '14',
    ggsnamespace: '0',
    prop: 'coordinates|pageimages|extracts|info|description',
    exintro: '1',
    explaintext: '1',
    exchars: '260',
    piprop: 'thumbnail',
    pithumbsize: '600',
    inprop: 'url'
  });
  const json = await fetchJson(`https://${lang}.wikipedia.org/w/api.php?${params}`, 7500);
  const cityName = normalized(location.localizedName || location.name);
  return Object.values(json?.query?.pages || {})
    .map(mapWikiPage)
    .filter((page) => Number.isFinite(Number(page.lat)) && Number.isFinite(Number(page.lon)))
    .map((page) => ({ ...page, distanceKm: distanceKm(location, page) }))
    .filter((page) => normalized(page.title) !== cityName && page.distanceKm > 0.03)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 8)
    .map((page) => ({ ...page, language: lang }));
}

export function weatherCodeLabel(code) {
  const en = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
    51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Light freezing drizzle', 57: 'Heavy freezing drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Light freezing rain', 67: 'Heavy freezing rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Light showers', 81: 'Showers', 82: 'Heavy showers',
    85: 'Light snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Severe thunderstorm with hail'
  };
  return en[Number(code)] || 'Weather';
}

export function aqiLabel(aqi) {
  const n = Number(aqi);
  if (!Number.isFinite(n)) return '';
  const labels = ['Good', 'Moderate', 'Unhealthy for sensitive groups', 'Unhealthy', 'Very unhealthy', 'Hazardous'];
  if (n <= 50) return labels[0];
  if (n <= 100) return labels[1];
  if (n <= 150) return labels[2];
  if (n <= 200) return labels[3];
  if (n <= 300) return labels[4];
  return labels[5];
}

export async function fetchCityInsights(destination, country, locale = 'en') {
  if (!destination || !country) return null;
  let location = destination;
  if (!Number.isFinite(Number(location.lat)) || !Number.isFinite(Number(location.lon)) || !location.timezone || !location.admin1) {
    location = await resolveCityLocation({ ...destination, name: destination.rawName || destination.name }, locale).catch(() => null) || destination;
  } else if (!location.population || !location.elevation) {
    location = await resolveCityLocation({ ...destination, name: destination.rawName || destination.name }, locale).catch(() => null) || destination;
  }
  if (!Number.isFinite(Number(location.lat)) || !Number.isFinite(Number(location.lon))) return { location, failed: true };

  const [weatherResult, airResult, wikiResult, nearbyResult, cityListResult] = await Promise.allSettled([
    fetchWeather(location),
    fetchAirQuality(location),
    searchWikipediaCity(location, country, locale),
    fetchNearbyWikipedia(location, locale),
    getCountryCitySuggestions(country.code2, { admin1: location.admin1, excludeName: location.rawName || location.name, limit: 12 })
  ]);

  const wiki = wikiResult.status === 'fulfilled' ? wikiResult.value : null;
  const wikidata = wiki?.qid ? await fetchWikidataCity(wiki.qid, locale).catch(() => null) : null;
  const tourism = country.code2 === 'KR'
    ? await getKoreaTourismCity(destination.rawName || location.rawName || location.name).catch(() => null)
    : null;
  const tourismAttractions = tourism?.attractions?.length
    ? await resolveWikipediaImages(tourism.attractions, { size: 1000, limit: 8 }).catch(() => tourism.attractions.map((item) => ({ ...item, image: null })))
    : [];
  const nearby = nearbyResult.status === 'fulfilled' ? nearbyResult.value : [];
  const gallery = [];
  const gallerySeen = new Set();
  const addGallery = (item) => {
    const src = item?.image?.src || item?.image || '';
    if (!src || gallerySeen.has(src)) return;
    gallerySeen.add(src);
    gallery.push({
      src,
      title: item.nameKo || item.title || item.name || wiki?.title || destination.name,
      subtitle: item.descriptionKo || item.extract || item.description || '',
      lat: item.lat,
      lon: item.lon,
      type: item.category || item.type || 'photo'
    });
  };
  if (wiki?.image) addGallery({ image: wiki.image, title: wiki.title, description: wiki.description });
  tourismAttractions.forEach(addGallery);
  nearby.forEach(addGallery);
  return {
    location,
    weather: weatherResult.status === 'fulfilled' ? weatherResult.value : null,
    air: airResult.status === 'fulfilled' ? airResult.value : null,
    wiki,
    wikidata,
    tourism,
    tourismAttractions,
    gallery: gallery.slice(0, 12),
    nearby,
    otherCities: cityListResult.status === 'fulfilled' ? cityListResult.value : [],
    sourceStatus: {
      weather: weatherResult.status,
      air: airResult.status,
      wiki: wikiResult.status,
      nearby: nearbyResult.status,
      wikidata: wikidata ? 'fulfilled' : (wiki?.qid ? 'rejected' : 'skipped')
    }
  };
}
