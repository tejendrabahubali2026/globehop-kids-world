import { APP } from './modules/config.js';
import { translator, localeLabel } from './modules/i18n.js';
import { getStored, setStored, pushRecent, toggleFavorite, migrateStorage } from './modules/storage.js';
import { haversineKm, estimateLandRoute, estimateFlightTimeHours, timeDifferenceHours } from './modules/geo.js';
import {
  displayCountryName, fetchRoadRoute, fetchWorldBankStats, getCountry, getCountryCitySuggestions, getFlagEmoji,
  getKoreaTourismAttractions, loadCountryIndex, loadIndianLandmarks, loadKnowledge, loadOrigins, loadPlaces, loadWorldGeometries,
  resolveCityLocation, searchLocal, searchOnlinePlaces
} from './modules/dataService.js';
import { GlobeView } from './modules/globe.js';
import { Globe3DView } from './modules/globe3d.js';
import { resolveWikipediaImages } from './modules/wikiMedia.js';
import { registerVisit } from './modules/analytics.js';
import { aqiLabel, fetchCityInsights, weatherCodeLabel } from './modules/cityInsights.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const escapeHtml = (value = '') => String(value).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

const requestedViewMode = new URLSearchParams(location.search).get('view');

// Clear legacy trips/destinations (old Seoul/KR fallbacks) before any state reads.
migrateStorage();

const initialLocale = (() => {
  const stored = getStored('locale', null);
  return APP.supportedLocales.includes(stored) ? stored : APP.defaultLocale;
})();

const state = {
  locale: initialLocale,
  theme: getStored('theme', 'system'),
  viewMode: ['map', 'globe'].includes(requestedViewMode) ? requestedViewMode : getStored('viewMode', 'globe'),
  tripType: getStored('tripType', 'oneway'),
  originPreset: getStored('originPreset', APP.defaultOriginId),
  origin: null,
  originCountry: null,
  destination: null,
  country: null,
  knowledge: null,
  stats: null,
  countryIndex: [],
  places: [],
  mapPoints: [],
  origins: [],
  indianLandmarks: [],
  indiaState: '',
  indiaPanelOpen: true,
  roadRoute: null,
  searchTimer: null,
  searchAbort: null,
  searchResults: [],
  selectedResultIndex: -1,
  mediaRenderToken: 0,
  cityInfo: null,
  cityInsightsToken: 0,
  countryCities: null,
  countryCitiesToken: 0,
  countryMapCities: [],
  countryMapToken: 0,
  navigationTrail: [],
  restoringHistory: false,
  appHistoryDepth: Number(history.state?.globehop ? history.state.depth : 0) || 0
};

let t = translator(state.locale);
let globe2D;
let globe3D;
let globeData = null;

function icon(name, size = 20) {
  const paths = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    location: '<path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z"/><circle cx="12" cy="10" r="2"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.7 6.7 0 0 0 9.8 9.8Z"/>',
    monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    replay: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>'
  };
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
}

function renderAppShell() {
  $('#app').innerHTML = `
    <header class="site-header">
      <a class="brand" href="./" aria-label="GlobeHop home">
        <span class="brand-mark" aria-hidden="true"><span class="brand-globe">🌎</span><span class="brand-plane">✈</span></span>
        <span><strong>GlobeHop</strong><small data-i18n="tagline"></small></span>
      </a>
      <nav class="header-actions" aria-label="Utilities">
        <label class="language-control"><span class="sr-only">Language</span><select id="languageSelect"></select></label>
        <button class="icon-button" id="themeButton" type="button" title="Theme" aria-label="Theme"></button>
        <button class="icon-button" id="infoButton" type="button" title="Data sources" aria-label="Data sources">${icon('info')}</button>
      </nav>
    </header>

    <main class="page-shell">
      <section class="search-hero" aria-labelledby="heroTitle">
        <div class="hero-copy">
          <h1 id="heroTitle" data-i18n="exploreTitle"></h1>
          <p data-i18n="exploreBody"></p>
        </div>
        <div class="search-wrap">
          <div class="search-box" role="search">
            ${icon('search', 23)}
            <input id="searchInput" type="search" autocomplete="off" spellcheck="false" aria-autocomplete="list" aria-controls="searchResults" />
            <button id="clearSearch" class="clear-search" type="button" aria-label="Clear" hidden>${icon('close', 18)}</button>
          </div>
          <div class="search-hint" id="searchHint"></div>
          <div class="search-results" id="searchResults" role="listbox" hidden></div>
        </div>
      </section>

      <section class="explore-india" aria-labelledby="exploreIndiaTitle">
        <div class="explore-india-head">
          <h2 id="exploreIndiaTitle"><span aria-hidden="true">🇮🇳</span> <span data-i18n="exploreIndia"></span></h2>
          <button class="ghost-button explore-toggle" id="exploreIndiaToggle" type="button" aria-expanded="true" aria-controls="exploreIndiaBody"></button>
        </div>
        <div class="explore-india-body" id="exploreIndiaBody">
          <p class="explore-india-hint" data-i18n="exploreIndiaHint"></p>
          <div class="explore-india-controls">
            <select id="indiaStateSelect" aria-label="Indian state or union territory"></select>
            <span class="explore-india-count" id="indiaLandmarkCount"></span>
          </div>
          <div class="explore-india-list" id="indiaLandmarkList" role="list"></div>
        </div>
      </section>

      <section class="explorer-grid" aria-live="polite">
        <div class="map-column">
          <div class="origin-bar">
            <div class="origin-main">
              <div class="origin-status">
                <span class="origin-dot" aria-hidden="true"></span>
                <div><strong id="originLabel"></strong><small id="originPrivacy"></small></div>
              </div>
              <label class="origin-select-wrap">
                <span data-i18n="startFrom"></span>
                <select id="originSelect"></select>
              </label>
            </div>
            <div class="origin-actions">
              <button id="locationButton" class="secondary-button" type="button">${icon('location', 18)}<span data-i18n="useMyLocation"></span></button>
            </div>
          </div>

          <div class="globe-card" id="globeCard">
            <div class="map-surface map-surface-2d" id="map2DSurface">
              <svg id="globeSvg" class="globe-svg" viewBox="0 0 1000 500" role="img" aria-label="Interactive 2D world map with animated travel route"></svg>
            </div>
            <div class="map-surface map-surface-3d" id="globe3DHost" aria-label="Interactive 3D globe"></div>
            <div class="map-label map-label-origin" id="mapOriginLabel"></div>
            <div class="map-label map-label-destination" id="mapDestinationLabel"></div>
            <div class="map-tooltip" id="mapTooltip" role="status" hidden></div>
            <button class="map-reset-button" id="resetMapButton" type="button">🌍 <span data-i18n="worldView"></span></button>
            <div class="map-zoom-controls" id="mapZoomControls" aria-label="Map zoom controls">
              <button type="button" data-zoom="in" aria-label="Zoom in" title="Zoom in">＋</button>
              <button type="button" data-zoom="out" aria-label="Zoom out" title="Zoom out">−</button>
            </div>
            <div class="map-camera-controls" id="mapCameraControls" hidden>
              <button type="button" data-camera="route">✈️ <span data-i18n="routeFocus"></span></button>
              <button type="button" data-camera="origin">🔵 <span data-i18n="originFocus"></span></button>
              <button type="button" data-camera="destination">🔴 <span data-i18n="destinationFocus"></span></button>
              <button type="button" data-camera="world">🌍 <span data-i18n="worldFocus"></span></button>
            </div>
            <div class="route-country-legend" id="routeCountryLegend" hidden></div>
            <div class="map-interaction-hint" id="mapInteractionHint"></div>
          </div>

          <div class="journey-panel" id="journeyPanel">
            <div class="journey-heading">
              <div>
                <span class="eyebrow" data-i18n="route"></span>
                <strong id="journeyTitle">—</strong>
              </div>
              <button class="ghost-button" id="replayButton" type="button">${icon('replay', 17)}<span data-i18n="replay"></span></button>
            </div>

            <div class="journey-controls-grid">
              <div class="journey-control-card">
                <span class="transport-label" data-i18n="travelView"></span>
                <div class="segmented" id="viewSelector">
                  <button type="button" data-view="map"><span data-i18n="mapView"></span></button>
                  <button type="button" data-view="globe"><span data-i18n="globeView"></span></button>
                </div>
              </div>
              <div class="journey-control-card">
                <span class="transport-label" data-i18n="tripType"></span>
                <div class="segmented" id="tripSelector">
                  <button type="button" data-trip="oneway"><span data-i18n="oneWay"></span></button>
                  <button type="button" data-trip="roundtrip"><span data-i18n="roundTrip"></span></button>
                </div>
              </div>
            </div>

            <div class="transport-note">✈️ <strong data-i18n="plane"></strong> · <span data-i18n="planeOnlyNote"></span></div>

            <div class="journey-stats journey-stats-extended">
              <div><span data-i18n="airDistance"></span><strong id="airDistanceValue">—</strong></div>
              <div><span data-i18n="landDistance"></span><strong id="landDistanceValue">—</strong></div>
              <div><span data-i18n="flightTime"></span><strong id="flightTimeValue">—</strong></div>
              <div><span data-i18n="landTime"></span><strong id="landTimeValue">—</strong></div>
              <div><span data-i18n="timeDiff"></span><strong id="timeDiffValue">—</strong></div>
              <div><span data-i18n="localTime"></span><strong id="localTimeValue">—</strong></div>
            </div>
            <p class="inline-note" id="routeNote" data-i18n="routeNote"></p>
          </div>
        </div>

        <aside class="detail-column" id="detailColumn">
          <div class="country-heading">
            <div class="country-heading-main">
              <div class="detail-navigation" id="detailNavigation">
                <button class="detail-nav-button" id="previousPlaceButton" type="button" hidden>← <span data-i18n="previousPlace"></span></button>
                <button class="detail-nav-button detail-nav-country" id="countryParentButton" type="button" hidden>↑ <span id="countryParentLabel"></span></button>
              </div>
              <div class="country-title-wrap"><span id="flagEmoji" class="flag-emoji">🌍</span><div><span class="eyebrow" id="destinationType"></span><h2 id="destinationTitle">—</h2><p id="destinationSubtitle"></p></div></div>
            </div>
            <button class="icon-button favorite-button" id="favoriteButton" type="button" aria-label="Favorite">${icon('heart')}</button>
          </div>

          <section class="city-section" id="citySection" aria-labelledby="cityTitle" hidden>
            <div class="section-heading"><h3 id="cityTitle" data-i18n="cityExplorer"></h3><span class="data-badge city-live-badge" data-i18n="cityLiveBadge"></span></div>
            <div id="cityInsights" class="city-insights"></div>
          </section>

          <section class="media-section" aria-labelledby="mediaTitle">
            <div class="section-heading"><h3 id="mediaTitle" data-i18n="photos"></h3><span class="data-badge" data-i18n="studyNote"></span></div>
            <div id="mediaGallery" class="media-gallery"></div><p class="media-source-note" data-i18n="imageSourceNote"></p>
          </section>

          <section class="facts-section" aria-labelledby="factsTitle">
            <div class="section-heading"><h3 id="factsTitle" data-i18n="countryFacts"></h3><span class="data-badge" id="statsBadge" data-i18n="staticStat"></span></div>
            <div class="facts-grid" id="factsGrid"></div>
            <p class="inline-note" id="statsNote"></p>
          </section>

          <section class="knowledge-section" aria-labelledby="knowledgeTitle">
            <h3 id="knowledgeTitle" data-i18n="kidKnowledge"></h3>
            <div id="knowledgeContent"></div>
          </section>
        </aside>
      </section>

      <section class="history-section" aria-labelledby="recentTitle">
        <div class="section-heading"><h2 id="recentTitle" data-i18n="recent"></h2><span id="favoriteCount"></span></div>
        <div class="history-strip" id="recentStrip"></div>
      </section>
    </main>

    <footer class="site-footer">
      <div class="dev-credit-bar">
        <span>Dev- Tejendra Bahubali</span>
        <span aria-hidden="true">|</span>
        <span>Email - <a href="mailto:tejendrabahubali@outlook.com">tejendrabahubali@outlook.com</a></span>
        <span aria-hidden="true">|</span>
        <span>Website - <a href="https://tejendrabahubali2026.pagezapp.cc.cd/" target="_blank" rel="noreferrer">https://tejendrabahubali2026.pagezapp.cc.cd/</a></span>
      </div>
      <div class="visit-stats-bar" id="visitStatsBar" hidden>
        <span class="visit-stat">🌍 <span data-i18n="totalVisits"></span>: <strong id="totalVisitsCount">—</strong></span>
        <span aria-hidden="true">|</span>
        <span class="visit-stat">👥 <span data-i18n="uniqueVisitors"></span>: <strong id="uniqueVisitorsCount">—</strong></span>
      </div>
      <div class="site-footer-meta">
        <span data-i18n="footer"></span>
        <span class="build-version" title="GlobeHop Kids — India edition">V8.5</span>
        <button type="button" id="footerInfo" class="text-button" data-i18n="dataSources"></button>
      </div>
    </footer>

    <dialog id="landmarkDialog" class="landmark-dialog">
      <button class="dialog-close icon-button" type="button" data-landmark-close aria-label="Close">${icon('close')}</button>
      <div id="landmarkCardContent"></div>
    </dialog>

    <dialog id="sourceDialog" class="source-dialog">
      <button class="dialog-close icon-button" type="button" data-dialog-close aria-label="Close">${icon('close')}</button>
      <div class="dialog-globe" aria-hidden="true">🌍</div>
      <h2 data-i18n="dataSources"></h2>
      <p data-i18n="dataSourceBody"></p>
      <div class="source-links">
        <a href="https://download.geonames.org/export/dump/" target="_blank" rel="noreferrer">GeoNames cities15000</a>
        <a href="https://open-meteo.com/en/docs/geocoding-api" target="_blank" rel="noreferrer">Open-Meteo Geocoding</a>
        <a href="https://open-meteo.com/en/docs" target="_blank" rel="noreferrer">Open-Meteo Weather</a>
        <a href="https://open-meteo.com/en/docs/air-quality-api" target="_blank" rel="noreferrer">Open-Meteo / CAMS Air Quality</a>
        <a href="https://www.mediawiki.org/wiki/API:Geosearch" target="_blank" rel="noreferrer">Wikipedia/Wikimedia Geosearch</a>
        <a href="https://www.wikidata.org/wiki/Wikidata:Data_access" target="_blank" rel="noreferrer">Wikidata structured city data</a>
        <a href="https://datahelpdesk.worldbank.org/knowledgebase/articles/889392" target="_blank" rel="noreferrer">World Bank Indicators API</a>
        <a href="https://project-osrm.org/docs/v5.24.0/api/" target="_blank" rel="noreferrer">OSRM Route API</a>
      </div>
      <button class="primary-button" type="button" data-dialog-close data-i18n="close"></button>
    </dialog>
    <div id="toast" class="toast" role="status" aria-live="polite"></div>
  `;
}

function originPresetById(id) {
  return state.origins.find((x) => x.id === id) || state.origins.find((x) => x.id === APP.defaultOriginId) || state.origins[0];
}

function originLabel(origin) {
  if (!origin) return '';
  if (origin.isCustom) return t('originCustom');
  return origin.names?.[state.locale] || origin.names?.en || origin.id;
}

function setOriginObject(origin) {
  state.origin = {
    ...origin,
    name: origin.names?.en || origin.name || origin.id,
    source: origin.isCustom ? 'geolocation' : 'preset'
  };
}

function renderOriginSelect() {
  const select = $('#originSelect');
  if (!select) return;
  const options = state.origins.map((origin) => `<option value="${origin.id}">${escapeHtml(origin.emoji || '')} ${escapeHtml(originLabel(origin))}</option>`);
  const customOption = state.origin?.isCustom ? `<option value="custom">📍 ${escapeHtml(t('originCustom'))}</option>` : '';
  select.innerHTML = `${options.join('')}${customOption}`;
  select.value = state.origin?.isCustom ? 'custom' : state.originPreset;
}

function applyTranslations() {
  t = translator(state.locale);
  document.documentElement.lang = state.locale;
  document.documentElement.dir = state.locale === 'ur' ? 'rtl' : 'ltr';
  $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  $('#searchInput').placeholder = t('searchPlaceholder');
  $('#searchHint').textContent = t('searchHint');
  $('#originPrivacy').textContent = t('locationPrivacy');
  renderLanguageSelect();
  renderOriginSelect();
  renderThemeButton();
  updateViewControls();
  globe3D?.setHelpText(t('globeInteractionHint'));
  renderExploreIndia();
  renderCurrentSelection();
  renderRecent();
}

function renderLanguageSelect() {
  const select = $('#languageSelect');
  select.innerHTML = APP.supportedLocales.map((l) => `<option value="${l}" ${l === state.locale ? 'selected' : ''}>${localeLabel(l)}</option>`).join('');
}

function setTheme(theme) {
  state.theme = theme;
  setStored('theme', theme);
  document.documentElement.dataset.theme = theme;
  renderThemeButton();
}

function renderThemeButton() {
  const btn = $('#themeButton');
  if (!btn) return;
  const cycle = { system: 'light', light: 'dark', dark: 'system' };
  btn.dataset.nextTheme = cycle[state.theme] || 'system';
  btn.innerHTML = icon(state.theme === 'light' ? 'sun' : state.theme === 'dark' ? 'moon' : 'monitor');
  btn.title = `${t('theme')}: ${t(state.theme)}`;
  btn.setAttribute('aria-label', btn.title);
}

function updateViewControls() {
  $$('#viewSelector button').forEach((b) => b.classList.toggle('is-active', b.dataset.view === state.viewMode));
  $$('#tripSelector button').forEach((b) => b.classList.toggle('is-active', b.dataset.trip === state.tripType));
  const card = $('#globeCard');
  if (!card) return;
  card.classList.toggle('view-globe', state.viewMode === 'globe');
  card.classList.toggle('view-map', state.viewMode === 'map');
  const surface2D = $('#map2DSurface');
  const surface3D = $('#globe3DHost');
  if (surface2D) surface2D.hidden = state.viewMode !== 'map';
  if (surface3D) surface3D.hidden = state.viewMode !== 'globe';
  const cameraControls = $('#mapCameraControls');
  const resetButton = $('#resetMapButton');
  const routeLegend = $('#routeCountryLegend');
  if (cameraControls) cameraControls.hidden = state.viewMode !== 'globe';
  if (resetButton) resetButton.hidden = state.viewMode === 'globe';
  if (routeLegend) routeLegend.hidden = state.viewMode !== 'globe' || !state.destination;
  const hint = $('#mapInteractionHint');
  if (hint) hint.textContent = state.viewMode === 'globe' ? t('globeInteractionHint') : t('mapInteractionHint');
  hideMapTooltip();
}

function localizedLanguage(value) {
  if (!value) return t('unavailable');
  if (/^[a-z]{2,3}$/i.test(value)) {
    try { return new Intl.DisplayNames([state.locale], { type: 'language' }).of(value); } catch { return value; }
  }
  return value;
}

function formatNumber(value) {
  return new Intl.NumberFormat(state.locale).format(value);
}

function formatCompact(value) {
  if (value == null) return t('unavailable');
  return new Intl.NumberFormat(state.locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function formatUsd(value) {
  return new Intl.NumberFormat(state.locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

function formatLocalTime(timeZone) {
  if (!timeZone) return '—';
  try {
    return new Intl.DateTimeFormat(state.locale, { timeZone, hour: 'numeric', minute: '2-digit', weekday: 'short' }).format(new Date());
  } catch {
    return '—';
  }
}

function formatDuration(hours) {
  if (!Number.isFinite(hours)) return t('unavailable');
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (!h) return `${m}m`;
  if (!m) return `${h}h`;
  return `${h}h ${m}m`;
}

function getDestinationTimezone() {
  return state.destination?.timezone || state.country?.timezones?.[0] || state.country?.timezone || null;
}


function localizedCapitalName(country) {
  if (!country) return '';
  const point = state.mapPoints.find((p) => p.type === 'capital' && p.countryCode === country.code2);
  return point?.name || country.capital || '';
}

function syncRouteDisplayData() {
  if (state.origin) {
    state.origin.displayLabel = originLabel(state.origin);
    if (state.originCountry) {
      state.origin.countryCode = state.originCountry.code2;
      state.origin.countryLabel = displayCountryName(state.originCountry.code2, state.locale, state.originCountry.name || state.originCountry.nativeName || state.originCountry.code2);
    }
  }
  if (state.destination && state.country) {
    const countryLabel = displayCountryName(state.country.code2, state.locale, state.country.name || state.country.nativeName || state.country.code2);
    state.destination.countryLabel = countryLabel;
    state.destination.displayLabel = state.destination.kind === 'country' ? localizedCapitalName(state.country) : state.destination.name;
  }
}

function ensureGlobe3D() {
  if (globe3D) return globe3D;
  if (!globeData) return null;
  try {
    globe3D = new Globe3DView($('#globe3DHost'), {
      onHover: showMapTooltip,
      onLeave: hideMapTooltip,
      onClick: travelToInteractiveItem
    });
    globe3D.setData(globeData);
    globe3D.setHelpText(t('globeInteractionHint'));
    if (state.country?.code2) globe3D.setSelectedCountry(state.country.code2);
    if (state.origin && state.destination) globe3D.setRoute(state.origin, state.destination, state.tripType, { focus: true });
    return globe3D;
  } catch (error) {
    console.warn('3D globe is unavailable; falling back to the 2D map.', error);
    globe3D = null;
    state.viewMode = 'map';
    const globeButton = $('#viewSelector button[data-view="globe"]');
    if (globeButton) { globeButton.disabled = true; globeButton.title = t('webglUnavailable'); }
    updateViewControls();
    return null;
  }
}

function updateInteractiveRoute({ focus3D = true } = {}) {
  if (!state.origin || !state.destination) return;
  syncRouteDisplayData();
  globe2D?.setRoute(state.origin, state.destination, 'plane', state.tripType);
  globe3D?.setRoute(state.origin, state.destination, state.tripType, { focus: focus3D });
}

function mapItemName(item) {
  if (!item?.data) return '';
  if (item.kind === 'country') return displayCountryName(item.data.code2, state.locale, item.data.name || item.data.code2);
  if (item.data.isIndiaLandmark) return `${item.data.emoji || '📍'} ${item.data.name}`;
  return item.data.name || item.data.nameKo || item.data.id;
}

function mapItemSecondary(item) {
  if (!item?.data) return '';
  if (item.data.isIndiaLandmark) return `${item.data.state} · ${t('landmarkBadge')}`;
  if (item.kind === 'country') {
    const capital = item.data.capital ? `${t('capital')}: ${item.data.capital}` : '';
    return [capital, displayRegion(item.data.region)].filter(Boolean).join(' · ');
  }
  const type = item.data.type === 'landmark' ? t('landmark') : item.data.type === 'region' ? t('regionPlace') : item.data.type === 'capital' ? t('capital') : t('city');
  const country = displayCountryName(item.data.countryCode, state.locale, item.data.country || '');
  return [type, country].filter(Boolean).join(' · ');
}

function showMapTooltip(item, position) {
  const tooltip = $('#mapTooltip');
  const card = $('#globeCard');
  if (!tooltip || !card || !item?.data) return;
  const rect = card.getBoundingClientRect();
  const clientX = position?.clientX ?? (rect.left + (position?.x || 0));
  const clientY = position?.clientY ?? (rect.top + (position?.y || 0));
  const lat = Number(item.data.capitalLat ?? item.data.lat);
  const lon = Number(item.data.capitalLon ?? item.data.lon);
  let distanceText = '';
  if (state.origin && Number.isFinite(lat) && Number.isFinite(lon)) {
    const km = haversineKm(state.origin, { lat, lon });
    distanceText = `<span>✈ ${escapeHtml(formatNumber(Math.round(km)))} km</span>`;
  }
  const population = item.data.population ? `<span>👥 ${escapeHtml(formatCompact(item.data.population))}</span>` : '';
  const area = item.data.areaKm2 ? `<span>📐 ${escapeHtml(formatNumber(Math.round(item.data.areaKm2)))} km²</span>` : '';
  const description = item.data.isIndiaLandmark ? (item.data.landmark?.funFact || '') : (item.data.description || '');
  tooltip.innerHTML = `
    <strong>${escapeHtml(mapItemName(item))}</strong>
    <small>${escapeHtml(mapItemSecondary(item))}</small>
    ${description ? `<p>${escapeHtml(description)}</p>` : ''}
    <div class="map-tooltip-meta">${distanceText}${population}${area}</div>
    <em>${escapeHtml(t('clickToTravel'))}</em>
  `;
  tooltip.hidden = false;
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const left = Math.max(10, Math.min(rect.width - 230, localX + 14));
  const top = Math.max(10, Math.min(rect.height - 122, localY + 14));
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideMapTooltip() {
  const tooltip = $('#mapTooltip');
  if (tooltip) tooltip.hidden = true;
}

function travelToInteractiveItem(item) {
  if (!item?.data) return;
  if (item.data.isIndiaLandmark) {
    const landmark = item.data.landmark || item.data;
    openLandmarkCard(landmark);
    flyToLandmark(landmark);
    return;
  }
  if (item.kind === 'country') {
    const country = item.data;
    selectResult({ kind: 'country', ...country, code2: country.code2, displayName: displayCountryName(country.code2, state.locale, country.name || country.code2) });
    return;
  }
  const place = item.data;
  selectResult({ kind: 'place', ...place, countryCode: place.countryCode || place.code2 });
}

function landmarkToMapPoint(lm) {
  return {
    id: `il-${lm.id}`,
    name: lm.name,
    nameHi: lm.nameHi,
    type: 'india-landmark',
    isIndiaLandmark: true,
    countryCode: 'IN',
    lat: lm.lat,
    lon: lm.lon,
    emoji: lm.emoji,
    state: lm.state,
    landmark: lm
  };
}

function flyToLandmark(lm) {
  if (!lm) return;
  globe2D?.highlightCountry('IN');
  globe2D?.focusPoint(lm.lat, lm.lon);
  globe3D?.setSelectedCountry('IN');
  if (state.viewMode === 'globe') {
    const active3D = globe3D || ensureGlobe3D();
    active3D?.setSelectedCountry('IN');
    active3D?.focusPoint(lm.lat, lm.lon, { zoom: 1.5 });
  }
}

function openLandmarkCard(lm) {
  const dialog = $('#landmarkDialog');
  const root = $('#landmarkCardContent');
  if (!dialog || !root || !lm) return;
  root.innerHTML = `
    <div class="landmark-hero">
      <span class="landmark-emoji-big" aria-hidden="true">${escapeHtml(lm.emoji || '📍')}</span>
      <div>
        <span class="eyebrow">${escapeHtml(t('landmarkBadge'))}</span>
        <h2>${escapeHtml(lm.name)}</h2>
        <h3>${escapeHtml(lm.nameHi)}</h3>
      </div>
    </div>
    <div class="landmark-state-chips">
      <span class="data-badge">📍 ${escapeHtml(lm.state)}</span>
      <span class="data-badge">${escapeHtml(lm.stateHi)}</span>
      <span class="data-badge">📍 ${escapeHtml(Number(lm.lat).toFixed(3))}, ${escapeHtml(Number(lm.lon).toFixed(3))}</span>
    </div>
    <div class="landmark-facts">
      <article class="landmark-fact">
        <h4>${escapeHtml(t('funFact'))} <small>English</small></h4>
        <p>${escapeHtml(lm.funFact)}</p>
      </article>
      <article class="landmark-fact landmark-fact-hi">
        <h4>${escapeHtml(t('funFact'))} <small>हिन्दी</small></h4>
        <p>${escapeHtml(lm.funFactHi)}</p>
      </article>
    </div>
    <div class="landmark-actions">
      <button class="primary-button" type="button" data-landmark-fly>${icon('location', 17)}<span>${escapeHtml(t('flyHere'))}</span></button>
      <button class="secondary-button" type="button" data-landmark-close>${escapeHtml(t('close'))}</button>
    </div>`;
  root.querySelector('[data-landmark-fly]')?.addEventListener('click', () => {
    // Close first so the fly-to animation (especially on mobile) is fully visible.
    dialog.close();
    flyToLandmark(lm);
  });
  if (!dialog.open) dialog.showModal();
}

function renderExploreIndia() {
  const select = $('#indiaStateSelect');
  const list = $('#indiaLandmarkList');
  const count = $('#indiaLandmarkCount');
  const toggle = $('#exploreIndiaToggle');
  if (!select || !state.indianLandmarks.length) return;
  const stateNames = [...new Set(state.indianLandmarks.map((lm) => lm.state))].sort((a, b) => a.localeCompare(b));
  select.innerHTML = `<option value="">${escapeHtml(t('pickState'))}</option>${stateNames
    .map((name) => {
      const n = state.indianLandmarks.filter((lm) => lm.state === name).length;
      return `<option value="${escapeHtml(name)}"${name === state.indiaState ? ' selected' : ''}>${escapeHtml(name)} (${n})</option>`;
    })
    .join('')}`;
  if (toggle) {
    toggle.textContent = state.indiaPanelOpen ? t('hidePanel') : t('showPanel');
    toggle.setAttribute('aria-expanded', String(state.indiaPanelOpen));
  }
  const body = $('#exploreIndiaBody');
  if (body) body.hidden = !state.indiaPanelOpen;
  if (count) count.textContent = state.indiaState ? `${state.indianLandmarks.filter((lm) => lm.state === state.indiaState).length} ${t('landmarks')}` : '';
  if (!list) return;
  if (!state.indiaState) {
    list.innerHTML = `<p class="explore-empty">${escapeHtml(t('exploreIndiaHint'))}</p>`;
    return;
  }
  const items = state.indianLandmarks.filter((lm) => lm.state === state.indiaState);
  list.innerHTML = items
    .map((lm) => `
      <button type="button" class="india-landmark-chip" role="listitem" data-landmark-id="${escapeHtml(lm.id)}">
        <span class="chip-emoji" aria-hidden="true">${escapeHtml(lm.emoji || '📍')}</span>
        <span class="chip-copy"><strong>${escapeHtml(lm.name)}</strong><small>${escapeHtml(lm.nameHi)}</small></span>
      </button>`)
    .join('');
  $$('.india-landmark-chip', list).forEach((button) => button.addEventListener('click', () => {
    const lm = state.indianLandmarks.find((item) => item.id === button.dataset.landmarkId);
    if (!lm) return;
    openLandmarkCard(lm);
    flyToLandmark(lm);
  }));
}

function buildInteractiveMapPoints(countries, places) {
  const points = [...places];
  for (const country of countries) {
    const lat = Number(country.capitalLat);
    const lon = Number(country.capitalLon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !country.capital) continue;
    const duplicate = places.some((place) => place.countryCode === country.code2 && Math.abs(Number(place.lat) - lat) < 0.2 && Math.abs(Number(place.lon) - lon) < 0.2);
    if (duplicate) continue;
    points.push({
      id: `capital-${country.code2.toLowerCase()}`,
      name: country.capital,
      nameKo: country.capital,
      type: 'capital',
      countryCode: country.code2,
      lat, lon,
      timezone: null,
      isCapitalPoint: true
    });
  }
  return points;
}

async function hydrateCountryMapPoints(code2) {
  if (!code2) return;
  const token = ++state.countryMapToken;
  const [cities, koreaAttractions] = await Promise.all([
    getCountryCitySuggestions(code2, { limit: Number.POSITIVE_INFINITY }).catch(() => []),
    code2 === 'KR' ? getKoreaTourismAttractions().catch(() => []) : Promise.resolve([])
  ]);
  if (token !== state.countryMapToken || state.country?.code2 !== code2) return;
  state.countryMapCities = cities;
  const retained = state.mapPoints.filter((point) => !point.isDynamicCity && !point.isKoreaTourismPoint && !(code2 === 'KR' && point.isFamousPoint && point.countryCode === 'KR'));
  const cityPoints = cities.map((city, index) => ({
    ...city,
    type: city.type || 'city',
    cityRank: index + 1,
    isDynamicCity: true
  }));
  const tourismPoints = koreaAttractions.map((place, index) => ({
    ...place,
    id: `kr-tourism-${index}`,
    type: 'landmark',
    countryCode: 'KR',
    isKoreaTourismPoint: true,
    isDynamicLandmark: true
  }));
  state.mapPoints = [...retained, ...cityPoints, ...tourismPoints];
  globe2D?.setPlaces(state.mapPoints);
  globe2D?.highlightCountry(code2);
  if (globeData) globeData.places = state.mapPoints;
  globe3D?.setPlaces(state.mapPoints);
  globe3D?.setSelectedCountry(code2);
  if (state.destination?.kind === 'country') renderCityInsights();
}

function resultFromDestination(destination) {
  if (!destination) return null;
  if (destination.kind === 'country') {
    const row = state.countryIndex.find((item) => item.code2 === destination.countryCode);
    return row ? { kind: 'country', ...row, code2: row.code2, displayName: displayCountryName(row.code2, state.locale, row.name) } : null;
  }
  return {
    kind: 'place',
    id: destination.key || destination.id || 'history-place',
    name: destination.rawName || destination.name,
    nameKo: destination.nameKo || destination.name,
    type: destination.kind,
    countryCode: destination.countryCode,
    lat: destination.lat,
    lon: destination.lon,
    timezone: destination.timezone,
    admin1: destination.admin1,
    admin2: destination.admin2,
    population: destination.population,
    elevation: destination.elevation,
    geonameId: destination.geonameId
  };
}

function updateDetailNavigation() {
  const previous = $('#previousPlaceButton');
  const parent = $('#countryParentButton');
  const parentLabel = $('#countryParentLabel');
  if (!previous || !parent || !parentLabel) return;
  previous.hidden = !(state.appHistoryDepth > 0 || isCityDestination());
  parent.hidden = !state.destination || state.destination.kind === 'country';
  parentLabel.textContent = state.country ? `${getFlagEmoji(state.country.code2)} ${displayCountryName(state.country.code2, state.locale, state.country.name)}` : t('backToCountry');
}

function resultName(result) {
  return result.displayName || result.localizedName || result.name || result.nameKo || displayCountryName(result.code2 || result.countryCode, state.locale, result.name || result.country || '');
}

function resultSecondary(result) {
  if (result.kind === 'country') return result.capital || result.region || '';
  return [result.admin1, result.country || displayCountryName(result.countryCode, state.locale, '')].filter(Boolean).join(' · ');
}

function factCard(iconEmoji, label, value, source = '') {
  return `<div class="fact-card"><span class="fact-icon" aria-hidden="true">${iconEmoji}</span><div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${source ? `<small>${escapeHtml(source)}</small>` : ''}</div></div>`;
}

function displayRegion(region) {
  return region || t('unavailable');
}

function renderFacts() {
  if (!state.country) return;
  const c = state.country;
  const s = state.stats;
  const pop = s?.population?.value ?? c.population;
  const popSrc = s?.population ? `${t('sourceYear')} ${s.population.year}` : t('staticStat');
  const gdp = s?.gdp?.value;
  const gni = s?.gni?.value;
  const statsOnline = Boolean(s?.population || s?.gdp || s?.gni);
  $('#statsBadge').textContent = statsOnline ? t('liveStat') : t('staticStat');
  const currencies = (c.currencies || []).join(', ') || t('unavailable');
  const langs = (c.languages || []).map(localizedLanguage).join(', ') || t('unavailable');
  const calling = (c.callingCodes || []).filter(Boolean).map((x) => `+${x}`).join(', ') || t('unavailable');

  $('#factsGrid').innerHTML = [
    factCard('🏛️', t('capital'), c.capital || t('unavailable')),
    factCard('👥', t('population'), formatCompact(pop), popSrc),
    factCard('📐', t('area'), c.areaKm2 ? `${formatNumber(Math.round(c.areaKm2))} km²` : t('unavailable')),
    factCard('💵', t('gdp'), gdp ? formatUsd(gdp) : t('unavailable'), s?.gdp ? `${t('sourceYear')} ${s.gdp.year}` : ''),
    factCard('🌱', t('gni'), gni ? formatUsd(gni) : t('unavailable'), s?.gni ? `${t('sourceYear')} ${s.gni.year}` : ''),
    factCard('💰', t('currency'), currencies),
    factCard('🗣️', t('languages'), langs),
    factCard('🧭', t('region'), displayRegion(c.region)),
    factCard('☎️', t('callingCode'), calling)
  ].join('');
  $('#statsNote').textContent = s?.failed ? t('onlineDataError') : '';
}

function isCityDestination(destination = state.destination) {
  return Boolean(destination && ['city', 'capital'].includes(destination.kind));
}

function formatCityValue(value, suffix = '') {
  if (value == null || value === '' || Number.isNaN(value)) return t('unavailable');
  return `${value}${suffix}`;
}

function formatClockFromIso(value) {
  if (!value) return '—';
  const match = String(value).match(/T(\d{2}:\d{2})/);
  return match?.[1] || String(value);
}

function formatCityLocalTime(timezone) {
  if (!timezone) return t('unavailable');
  try {
    return new Intl.DateTimeFormat(state.locale, { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date());
  } catch {
    return t('unavailable');
  }
}

function hemisphereLabel(lat, lon) {
  const northSouth = Number(lat) >= 0 ? 'Northern' : 'Southern';
  const eastWest = Number(lon) >= 0 ? 'Eastern' : 'Western';
  return `${northSouth} · ${eastWest}`;
}

function cityMetricCard(emoji, label, value, note = '') {
  return `<div class="city-metric"><span class="city-metric-icon" aria-hidden="true">${emoji}</span><div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${note ? `<small>${escapeHtml(note)}</small>` : ''}</div></div>`;
}

function renderCityInsights() {
  const section = $('#citySection');
  const root = $('#cityInsights');
  const badge = $('.city-live-badge', section || document);
  if (!section || !root) return;
  if (state.destination?.kind === 'country') {
    section.hidden = false;
    if (badge) badge.textContent = 'GeoNames index';
    const cities = state.countryCities;
    if (!Array.isArray(cities)) {
      root.innerHTML = `<div class="city-loading"><span class="city-loading-orbit" aria-hidden="true">🏙️</span><p>${escapeHtml(t('loading'))}</p></div>`;
      return;
    }
    const totalCities = state.countryMapCities?.length || cities.length;
    const koreaBadge = state.country?.code2 === 'KR' ? `<span class="korea-map-badge">🇰🇷 ${escapeHtml(t('koreaTourismMap'))}</span>` : '';
    root.innerHTML = `<div class="country-city-directory"><div class="country-city-title-row"><h4>${escapeHtml(t('countryCities'))}</h4>${koreaBadge}</div><p>${escapeHtml(t('cityDirectoryNote'))}</p><p class="zoom-city-hint">🔎 ${escapeHtml(t('zoomCityHint'))} <strong>${escapeHtml(formatNumber(totalCities))}</strong></p><div class="country-city-grid">${cities.map((city, index) => `<button type="button" data-country-city-index="${index}"><span><strong>${escapeHtml(city.name)}</strong>${city.admin1 ? `<small>${escapeHtml(city.admin1)}</small>` : ''}</span>${city.population ? `<em>👥 ${escapeHtml(formatCompact(city.population))}</em>` : '<em>→</em>'}</button>`).join('')}</div></div><p class="city-source-note">GeoNames cities15000 · CC BY 4.0</p>`;
    $$('[data-country-city-index]', root).forEach((button) => button.addEventListener('click', () => {
      const city = cities[Number(button.dataset.countryCityIndex)];
      if (city) selectResult(city);
    }));
    return;
  }
  if (!isCityDestination()) {
    section.hidden = true;
    root.innerHTML = '';
    return;
  }
  section.hidden = false;
  if (badge) badge.textContent = t('cityLiveBadge');
  const info = state.cityInfo;
  if (!info || info.loading) {
    root.innerHTML = `<div class="city-loading"><span class="city-loading-orbit" aria-hidden="true">🌐</span><p>${escapeHtml(t('cityLoading'))}</p></div>`;
    return;
  }

  const loc = info.location || state.destination;
  const weather = info.weather;
  const air = info.air;
  const wiki = info.wiki;
  const wikidata = info.wikidata;
  const tourism = info.tourism;
  const tourismAttractions = info.tourismAttractions || [];
  const gallery = info.gallery || [];
  const nearby = info.nearby || [];
  const otherCities = info.otherCities || [];
  const admin = [loc.admin2, loc.admin1].filter(Boolean).join(' · ') || loc.admin1 || t('unavailable');
  const coords = Number.isFinite(Number(loc.lat)) && Number.isFinite(Number(loc.lon)) ? `${Number(loc.lat).toFixed(3)}, ${Number(loc.lon).toFixed(3)}` : t('unavailable');
  const postcodes = Array.isArray(loc.postcodes) ? loc.postcodes.slice(0, 5).join(', ') : (loc.postcodes || t('unavailable'));
  const preferredPopulation = wikidata?.population || loc.population;
  const populationSource = wikidata?.population ? `Wikidata${wikidata.populationYear ? ` · ${wikidata.populationYear}` : ''}` : (loc.population ? 'GeoNames / Open-Meteo' : '');
  const preferredElevation = Number.isFinite(Number(wikidata?.elevation)) ? wikidata.elevation : loc.elevation;
  const areaKm2 = Number.isFinite(Number(wikidata?.areaKm2)) ? Number(wikidata.areaKm2) : null;
  const density = preferredPopulation && areaKm2 > 0 ? Number(preferredPopulation) / areaKm2 : null;
  const capitalDistance = Number.isFinite(Number(state.country?.capitalLat)) && Number.isFinite(Number(state.country?.capitalLon))
    ? haversineKm(loc, { lat: state.country.capitalLat, lon: state.country.capitalLon })
    : null;
  const cityFacts = [
    cityMetricCard('👥', t('population'), preferredPopulation ? formatCompact(preferredPopulation) : t('unavailable'), populationSource),
    cityMetricCard('🧮', t('populationDensity'), Number.isFinite(density) ? `${formatNumber(Math.round(density))} / km²` : t('unavailable'), density ? 'population ÷ area' : ''),
    cityMetricCard('🧭', t('administrativeArea'), admin),
    cityMetricCard('📐', t('area'), areaKm2 != null ? `${formatNumber(Math.round(areaKm2 * 100) / 100)} km²` : t('unavailable'), areaKm2 != null ? 'Wikidata' : ''),
    cityMetricCard('⛰️', t('elevation'), Number.isFinite(Number(preferredElevation)) ? `${formatNumber(Math.round(Number(preferredElevation)))} m` : t('unavailable')),
    cityMetricCard('🏛️', t('distanceToCapital'), Number.isFinite(capitalDistance) ? `${formatNumber(Math.round(capitalDistance))} km` : t('unavailable')),
    cityMetricCard('📜', t('founded'), Number.isFinite(Number(wikidata?.inceptionYear)) ? String(wikidata.inceptionYear) : t('unavailable'), wikidata?.inceptionYear ? 'Wikidata' : ''),
    cityMetricCard('🏷️', t('officialName'), wikidata?.officialName || t('unavailable')),
    cityMetricCard('✨', t('nickname'), wikidata?.nickname || t('unavailable')),
    cityMetricCard('💬', t('motto'), wikidata?.motto || t('unavailable')),
    cityMetricCard('👤', t('demonym'), wikidata?.demonym || t('unavailable')),
    cityMetricCard('🕐', t('timezone'), wikidata?.timezones?.join(', ') || loc.timezone || t('unavailable')),
    cityMetricCard('⌚', t('cityLocalTime'), formatCityLocalTime(loc.timezone)),
    cityMetricCard('🌐', t('hemisphere'), Number.isFinite(Number(loc.lat)) && Number.isFinite(Number(loc.lon)) ? hemisphereLabel(loc.lat, loc.lon) : t('unavailable')),
    cityMetricCard('🗣️', t('cityLanguages'), wikidata?.languages?.join(', ') || t('unavailable')),
    cityMetricCard('✉️', t('postalCodes'), wikidata?.postalCode || postcodes),
    cityMetricCard('☎️', t('callingCode'), wikidata?.callingCode || t('unavailable')),
    cityMetricCard('🤝', t('twinCities'), wikidata?.twinCities?.slice(0, 6).join(', ') || t('unavailable')),
    cityMetricCard('📍', t('coordinates'), coords)
  ].join('');

  const galleryBlock = gallery.length ? `<div class="city-photo-tour"><div class="city-photo-tour-heading"><h4>${escapeHtml(t('cityPhotoGallery'))}</h4><div><button type="button" data-city-gallery="prev" aria-label="Previous photo">‹</button><button type="button" data-city-gallery="next" aria-label="Next photo">›</button></div></div><div class="city-photo-track" data-city-gallery-track>${gallery.map((photo, index) => `<figure class="city-photo-slide" data-city-photo-index="${index}"><img src="${escapeHtml(photo.src)}" alt="${escapeHtml(photo.title || state.destination.name)}" loading="lazy" referrerpolicy="no-referrer"><figcaption><strong>${escapeHtml(photo.title || state.destination.name)}</strong>${photo.subtitle ? `<span>${escapeHtml(photo.subtitle)}</span>` : ''}</figcaption></figure>`).join('')}</div><div class="city-photo-dots">${gallery.map((_, index) => `<button type="button" data-city-photo-dot="${index}" aria-label="Photo ${index + 1}"></button>`).join('')}</div></div>` : '';

  let overview = '';
  if (wiki?.extract) {
    const overviewText = wiki.extract || '';
    overview = `<div class="city-overview-card${gallery.length ? ' city-overview-card-text' : ''}">${wiki.image && !gallery.length ? `<img src="${escapeHtml(wiki.image)}" alt="${escapeHtml(wiki.title || state.destination.name)}" loading="lazy" referrerpolicy="no-referrer">` : ''}<div><span class="city-subheading">${escapeHtml(t('cityOverview'))}</span><p>${escapeHtml(overviewText)}</p>${wiki?.url ? `<a href="${escapeHtml(wiki.url)}" target="_blank" rel="noreferrer">${escapeHtml(t('wikipediaSource'))} ↗</a>` : ''}</div></div>`;
  }

  const tourismBlock = tourism ? `<div class="korea-tourism-block"><div class="korea-tourism-title"><span>🇰🇷</span><div><h4>${escapeHtml(t('tourismHighlights'))}</h4></div></div><div class="tourism-highlight-grid">${tourismAttractions.map((place, index) => `<button type="button" class="tourism-highlight-card" data-tourism-index="${index}">${place.image?.src ? `<img src="${escapeHtml(place.image.src)}" alt="${escapeHtml(place.name)}" loading="lazy" referrerpolicy="no-referrer">` : `<span class="tourism-image-fallback">📍</span>`}<span><strong>${escapeHtml(place.name)}</strong></span></button>`).join('')}</div></div>` : '';

  const cityReferenceLinks = [
    wiki?.url ? `<a href="${escapeHtml(wiki.url)}" target="_blank" rel="noreferrer">Wikipedia ↗</a>` : '',
    wikidata?.url ? `<a href="${escapeHtml(wikidata.url)}" target="_blank" rel="noreferrer">Wikidata ↗</a>` : '',
    wikidata?.officialWebsite ? `<a href="${escapeHtml(wikidata.officialWebsite)}" target="_blank" rel="noreferrer">${escapeHtml(t('officialWebsite'))} ↗</a>` : ''
  ].filter(Boolean).join('');
  const referenceBlock = cityReferenceLinks ? `<div class="city-reference-links">${cityReferenceLinks}</div>` : '';

  let weatherBlock = '';
  if (weather?.current) {
    const c = weather.current;
    const d = weather.daily || {};
    const high = d.temperature_2m_max?.[0];
    const low = d.temperature_2m_min?.[0];
    const precipitation = d.precipitation_probability_max?.[0];
    const weatherCards = [
      cityMetricCard(c.is_day === 0 ? '🌙' : '🌤️', t('weatherCondition'), weatherCodeLabel(c.weather_code, state.locale)),
      cityMetricCard('🌡️', t('temperature'), formatCityValue(c.temperature_2m, ' °C')),
      cityMetricCard('🧥', t('feelsLike'), formatCityValue(c.apparent_temperature, ' °C')),
      cityMetricCard('💧', t('humidity'), formatCityValue(c.relative_humidity_2m, '%')),
      cityMetricCard('💨', t('wind'), formatCityValue(c.wind_speed_10m, ' km/h')),
      cityMetricCard('🌬️', t('windGusts'), formatCityValue(c.wind_gusts_10m, ' km/h')),
      cityMetricCard('🧭', t('windDirection'), Number.isFinite(Number(c.wind_direction_10m)) ? `${Math.round(Number(c.wind_direction_10m))}°` : t('unavailable')),
      cityMetricCard('☁️', t('cloudCover'), Number.isFinite(Number(c.cloud_cover)) ? `${Math.round(Number(c.cloud_cover))}%` : t('unavailable')),
      cityMetricCard('🔵', t('pressure'), Number.isFinite(Number(c.surface_pressure)) ? `${Math.round(Number(c.surface_pressure))} hPa` : t('unavailable')),
      cityMetricCard('👀', t('visibility'), Number.isFinite(Number(c.visibility)) ? `${(Number(c.visibility) / 1000).toFixed(Number(c.visibility) < 10000 ? 1 : 0)} km` : t('unavailable')),
      cityMetricCard('↕️', t('todayRange'), Number.isFinite(Number(high)) && Number.isFinite(Number(low)) ? `${high} / ${low} °C` : t('unavailable')),
      cityMetricCard('☔', t('precipChance'), Number.isFinite(Number(precipitation)) ? `${precipitation}%` : t('unavailable')),
      cityMetricCard('🌅', t('sunriseSunset'), `${formatClockFromIso(d.sunrise?.[0])} / ${formatClockFromIso(d.sunset?.[0])}`)
    ].join('');
    weatherBlock = `<div class="city-live-group"><h4>${escapeHtml(t('currentWeather'))}</h4><div class="city-metrics-grid">${weatherCards}</div></div>`;
  }

  let airBlock = '';
  if (air?.current) {
    const c = air.current;
    const usAqi = Number(c.us_aqi);
    const aqiNote = Number.isFinite(usAqi) ? aqiLabel(usAqi, state.locale) : '';
    const airCards = [
      cityMetricCard('🫁', t('usAqi'), Number.isFinite(usAqi) ? String(Math.round(usAqi)) : t('unavailable'), aqiNote),
      cityMetricCard('🌿', t('europeanAqi'), Number.isFinite(Number(c.european_aqi)) ? String(Math.round(Number(c.european_aqi))) : t('unavailable')),
      cityMetricCard('🔬', t('pm25'), Number.isFinite(Number(c.pm2_5)) ? `${c.pm2_5} μg/m³` : t('unavailable')),
      cityMetricCard('🌫️', t('pm10'), Number.isFinite(Number(c.pm10)) ? `${c.pm10} μg/m³` : t('unavailable')),
      cityMetricCard('🟣', t('ozone'), Number.isFinite(Number(c.ozone)) ? `${c.ozone} μg/m³` : t('unavailable')),
      cityMetricCard('🧪', t('nitrogenDioxide'), Number.isFinite(Number(c.nitrogen_dioxide)) ? `${c.nitrogen_dioxide} μg/m³` : t('unavailable')),
      cityMetricCard('🧫', t('sulphurDioxide'), Number.isFinite(Number(c.sulphur_dioxide)) ? `${c.sulphur_dioxide} μg/m³` : t('unavailable')),
      cityMetricCard('⚪', t('carbonMonoxide'), Number.isFinite(Number(c.carbon_monoxide)) ? `${c.carbon_monoxide} μg/m³` : t('unavailable')),
      cityMetricCard('🏜️', t('dust'), Number.isFinite(Number(c.dust)) ? `${c.dust} μg/m³` : t('unavailable')),
      cityMetricCard('☀️', t('uvIndex'), Number.isFinite(Number(c.uv_index)) ? String(c.uv_index) : t('unavailable'))
    ].join('');
    airBlock = `<div class="city-live-group"><h4>${escapeHtml(t('airQuality'))}</h4><div class="city-metrics-grid">${airCards}</div></div>`;
  }

  const nearbyBlock = nearby.length ? `<div class="city-nearby-group"><h4>${escapeHtml(t('nearbyKnowledge'))}</h4><div class="nearby-city-grid">${nearby.map((place, index) => `<button class="nearby-city-card" type="button" data-nearby-index="${index}">${place.image ? `<img src="${escapeHtml(place.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="nearby-city-placeholder" aria-hidden="true">📚</span>`}<span><strong>${escapeHtml(place.title)}</strong><small>${escapeHtml(`${place.distanceKm.toFixed(place.distanceKm < 10 ? 1 : 0)} km`)}</small>${place.extract ? `<em>${escapeHtml(place.extract)}</em>` : ''}</span></button>`).join('')}</div></div>` : '';

  const otherCitiesBlock = otherCities.length ? `<div class="other-cities-group"><h4>${escapeHtml(t('otherCities'))}</h4><div class="other-city-chips">${otherCities.map((city, index) => `<button type="button" data-city-index="${index}">${escapeHtml(city.name)}${city.admin1 ? `<small>${escapeHtml(city.admin1)}</small>` : ''}</button>`).join('')}</div></div>` : '';

  const degraded = info.failed || Object.values(info.sourceStatus || {}).some((x) => x === 'rejected');
  root.innerHTML = `${galleryBlock}${overview}${tourismBlock}${referenceBlock}<div class="city-live-group"><h4>${escapeHtml(t('cityDetails'))}</h4><div class="city-metrics-grid">${cityFacts}</div></div>${weatherBlock}${airBlock}${nearbyBlock}${otherCitiesBlock}${degraded ? `<p class="city-warning">${escapeHtml(t('cityInfoUnavailable'))}</p>` : ''}<p class="city-source-note">${escapeHtml(t('cityDataSources'))}</p>`;

  const galleryTrack = $('[data-city-gallery-track]', root);
  const gallerySlides = $$('.city-photo-slide', root);
  const galleryDots = $$('[data-city-photo-dot]', root);
  const syncGalleryDots = () => {
    if (!galleryTrack || !gallerySlides.length) return;
    const index = Math.max(0, Math.min(gallerySlides.length - 1, Math.round(galleryTrack.scrollLeft / Math.max(1, galleryTrack.clientWidth * 0.82))));
    galleryDots.forEach((dot, i) => dot.classList.toggle('is-active', i === index));
  };
  if (galleryTrack) {
    galleryDots[0]?.classList.add('is-active');
    galleryTrack.addEventListener('scroll', () => requestAnimationFrame(syncGalleryDots), { passive: true });
    $$('[data-city-gallery]', root).forEach((button) => button.addEventListener('click', () => {
      galleryTrack.scrollBy({ left: (button.dataset.cityGallery === 'next' ? 1 : -1) * galleryTrack.clientWidth * 0.86, behavior: 'smooth' });
    }));
    galleryDots.forEach((dot) => dot.addEventListener('click', () => gallerySlides[Number(dot.dataset.cityPhotoDot)]?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })));
  }
  $$('[data-tourism-index]', root).forEach((button) => button.addEventListener('click', () => {
    const place = tourismAttractions[Number(button.dataset.tourismIndex)];
    if (!place) return;
    selectResult({ kind: 'place', id: `kr-tourism-city-${Number(button.dataset.tourismIndex)}`, name: place.name, nameKo: place.nameKo, type: 'landmark', countryCode: state.country.code2, lat: place.lat, lon: place.lon, timezone: state.destination?.timezone || 'Asia/Seoul' });
  }));

  $$('.nearby-city-card[data-nearby-index]', root).forEach((button) => button.addEventListener('click', () => {
    const place = nearby[Number(button.dataset.nearbyIndex)];
    if (!place) return;
    selectResult({ kind: 'place', id: `wiki-${place.pageId}`, name: place.title, type: 'landmark', countryCode: state.country.code2, lat: place.lat, lon: place.lon, timezone: state.destination?.timezone || null });
  }));
  $$('[data-city-index]', root).forEach((button) => button.addEventListener('click', () => {
    const city = otherCities[Number(button.dataset.cityIndex)];
    if (city) selectResult(city);
  }));
}

async function hydrateCountryCities() {
  if (state.destination?.kind !== 'country' || !state.country) return;
  const token = ++state.countryCitiesToken;
  const code2 = state.country.code2;
  state.countryCities = null;
  renderCityInsights();
  const rows = await getCountryCitySuggestions(code2, { limit: code2 === 'KR' ? 60 : 30 }).catch(() => []);
  if (token !== state.countryCitiesToken || state.destination?.kind !== 'country' || state.country?.code2 !== code2) return;
  state.countryCities = rows;
  renderCityInsights();
}

async function hydrateCityInsights() {
  if (!isCityDestination() || !state.country || !state.destination) return;
  const requestKey = state.destination.key;
  const token = ++state.cityInsightsToken;
  state.cityInfo = { loading: true, location: state.destination };
  renderCityInsights();
  const info = await fetchCityInsights(state.destination, state.country, state.locale).catch(() => null);
  if (token !== state.cityInsightsToken || state.destination?.key !== requestKey) return;
  if (!info) {
    state.cityInfo = { loading: false, failed: true, location: state.destination, nearby: [], otherCities: [] };
    renderCityInsights();
    return;
  }
  const loc = info.location || {};
  state.destination = {
    ...state.destination,
    ...Object.fromEntries(Object.entries({
      lat: Number.isFinite(Number(loc.lat)) ? Number(loc.lat) : state.destination.lat,
      lon: Number.isFinite(Number(loc.lon)) ? Number(loc.lon) : state.destination.lon,
      timezone: loc.timezone || state.destination.timezone,
      population: loc.population || state.destination.population,
      elevation: loc.elevation ?? state.destination.elevation,
      admin1: loc.admin1 || state.destination.admin1,
      admin2: loc.admin2 || state.destination.admin2,
      admin3: loc.admin3 || state.destination.admin3,
      admin4: loc.admin4 || state.destination.admin4,
      postcodes: loc.postcodes || state.destination.postcodes,
      geonameId: loc.geonameId || state.destination.geonameId
    }).filter(([, value]) => value !== undefined)),
    name: loc.localizedName || state.destination.name,
    subtitle: [loc.admin2 || state.destination.admin2, loc.admin1 || state.destination.admin1].filter(Boolean).join(' · ')
  };
  state.cityInfo = { ...info, loading: false, location: { ...loc, ...state.destination } };
  $('#destinationTitle').textContent = state.destination.name;
  $('#destinationSubtitle').textContent = [state.destination.subtitle, displayCountryName(state.country.code2, state.locale, state.country.name)].filter(Boolean).join(' · ');
  renderCityInsights();
  renderJourneyStats();
}

function famousPlacesForCurrentCountry() {
  const base = state.knowledge?.famousPlaces || [];
  if (base.length) return base;
  if (!state.country) return [];
  const countryName = displayCountryName(state.country.code2, state.locale, state.country.name);
  const items = [{
    name: state.country.name,
    nameKo: countryName,
    wikiTitle: state.country.name,
    descriptionKo: `${countryName} ${t('overview')}`,
    lat: state.country.lat,
    lon: state.country.lon
  }];
  if (state.country.capital) items.push({
    name: state.country.capital,
    nameKo: state.country.capital,
    wikiTitle: state.country.capital,
    descriptionKo: `${t('capital')} · ${state.country.capital}`,
    lat: state.country.capitalLat,
    lon: state.country.capitalLon
  });
  return items;
}

function famousPlaceDisplayName(place) {
  return place.name || place.nameKo;
}

function famousPlaceDescription(place) {
  return place.description || '';
}

function travelToFamousPlace(place) {
  if (!place || !state.country) return;
  const lat = Number(place.lat);
  const lon = Number(place.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  selectResult({
    kind: 'place',
    id: `famous-${state.country.code2}-${place.wikiTitle || place.name}`,
    name: place.name,
    nameKo: place.nameKo,
    type: 'landmark',
    countryCode: state.country.code2,
    lat,
    lon,
    timezone: null
  });
}

function renderFamousPlaceCard(place, index) {
  const image = place.image?.src;
  const title = famousPlaceDisplayName(place);
  const description = famousPlaceDescription(place);
  const featured = index === 0 ? ' famous-place-card-featured' : '';
  return `<button class="famous-place-card${featured}" type="button" data-famous-index="${index}" aria-label="${escapeHtml(title)}">
    <span class="famous-place-image">${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(title)}" loading="lazy" referrerpolicy="no-referrer">` : '<span class="image-fallback" aria-hidden="true">🗺️</span>'}</span>
    <span class="famous-place-copy"><strong>${escapeHtml(title)}</strong>${description ? `<small>${escapeHtml(description)}</small>` : ''}<em>${escapeHtml(t('clickToTravel'))}</em></span>
  </button>`;
}

async function renderMedia() {
  const gallery = $('#mediaGallery');
  if (!gallery || !state.country) return;
  const token = ++state.mediaRenderToken;
  const places = famousPlacesForCurrentCountry().slice(0, 10);
  if (!places.length) {
    gallery.innerHTML = `<div class="media-empty">${escapeHtml(t('knowledgeFallback'))}</div>`;
    return;
  }
  gallery.innerHTML = places.slice(0, Math.min(8, places.length)).map((place, index) => `<div class="famous-place-card media-skeleton${index === 0 ? ' famous-place-card-featured' : ''}"><span></span><strong>${escapeHtml(famousPlaceDisplayName(place))}</strong></div>`).join('');
  const resolved = await resolveWikipediaImages(places, { size: 900, limit: 10 }).catch(() => places.map((item) => ({ ...item, image: null })));
  if (token !== state.mediaRenderToken || !gallery.isConnected) return;
  gallery.innerHTML = resolved.map(renderFamousPlaceCard).join('');
  $$('.famous-place-card[data-famous-index]', gallery).forEach((button) => {
    button.addEventListener('click', () => travelToFamousPlace(resolved[Number(button.dataset.famousIndex)]));
  });
}

function chipBlock(emoji, label, items) {
  if (!items?.length) return '';
  return `<div class="knowledge-row"><div class="knowledge-label"><span>${emoji}</span><strong>${escapeHtml(label)}</strong></div><div class="chip-list">${items.map((x) => `<span>${escapeHtml(x)}</span>`).join('')}</div></div>`;
}

function infoMini(label, value) {
  if (!value) return '';
  return `<div class="mini-info-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function renderKnowledge() {
  const root = $('#knowledgeContent');
  if (!root || !state.country) return;
  const fallbackOverview = `${displayCountryName(state.country.code2, state.locale, state.country.name)} · ${t('capital')}: ${state.country.capital || t('unavailable')} · ${displayRegion(state.country.region)}`;
  const k = state.knowledge;
  if (!k) {
    root.innerHTML = `<div class="knowledge-empty"><span aria-hidden="true">🧩</span><p>${escapeHtml(t('knowledgeFallback'))}</p></div><div class="overview-card"><strong>${escapeHtml(t('overview'))}</strong><p>${escapeHtml(fallbackOverview)}</p></div>`;
    return;
  }
  const data = k;
  root.innerHTML = `
    <div class="overview-card"><strong>${escapeHtml(t('overview'))}</strong><p>${escapeHtml(data.overview || fallbackOverview)}</p></div>
    <div class="story-grid">
      ${data.geography ? `<article class="story-card"><span>🗺️</span><div><strong>${escapeHtml(t('geography'))}</strong><p>${escapeHtml(data.geography)}</p></div></article>` : ''}
      ${data.history ? `<article class="story-card"><span>🏺</span><div><strong>${escapeHtml(t('history'))}</strong><p>${escapeHtml(data.history)}</p></div></article>` : ''}
      ${data.culture ? `<article class="story-card"><span>🎎</span><div><strong>${escapeHtml(t('culture'))}</strong><p>${escapeHtml(data.culture)}</p></div></article>` : ''}
      ${data.etiquette ? `<article class="story-card"><span>🙏</span><div><strong>${escapeHtml(t('etiquette'))}</strong><p>${escapeHtml(data.etiquette)}</p></div></article>` : ''}
    </div>
    <div class="mini-info-grid">
      ${infoMini(t('greeting'), data.greeting)}
      ${infoMini(t('climate'), data.climate)}
      ${infoMini(t('bestSeason'), data.bestSeason)}
      ${infoMini(t('travelTips'), data.travelTips)}
    </div>
    ${chipBlock('🍽️', t('foods'), data.foods || data.specialties)}
    ${chipBlock('🎉', t('festivals'), data.festivals)}
    ${chipBlock('🐾', t('animals'), data.animals)}
    ${chipBlock('🌿', t('plants'), data.plants)}
    ${chipBlock('🗺️', t('landmarks'), data.landmarks)}
    <div class="fun-facts"><h4>💡 ${escapeHtml(t('funFacts'))}</h4><ul>${(data.facts || []).map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul></div>
  `;
}

function renderFavoriteState() {
  const favs = getStored('favorites', []);
  const active = state.destination && favs.some((x) => x.key === state.destination.key);
  const btn = $('#favoriteButton');
  if (!btn) return;
  btn.classList.toggle('is-active', active);
  btn.title = active ? t('unfavorite') : t('favorite');
  btn.setAttribute('aria-label', btn.title);
}

// Fire-and-forget anonymous analytics; the counters bar stays hidden on failure.
function bootVisitStats() {
  registerVisit()
    .then((stats) => {
      if (!stats) return;
      const bar = $('#visitStatsBar');
      const total = $('#totalVisitsCount');
      const unique = $('#uniqueVisitorsCount');
      if (!bar || !total || !unique) return;
      total.textContent = formatNumber(stats.total_visits);
      unique.textContent = formatNumber(stats.unique_visitors);
      bar.hidden = false;
    })
    .catch(() => {});
}

function renderRecent() {
  const root = $('#recentStrip');
  if (!root) return;
  const recent = getStored('recent', []);
  const favs = getStored('favorites', []);
  $('#favoriteCount').textContent = favs.length ? `♥ ${favs.length}` : '';
  if (!recent.length) {
    root.innerHTML = `<p class="history-empty">${escapeHtml(t('noRecent'))}</p>`;
    return;
  }
  root.innerHTML = recent.map((x, i) => `<button class="history-item" type="button" data-recent="${i}"><span>${getFlagEmoji(x.countryCode)}</span><strong>${escapeHtml(x.name)}</strong><small>${escapeHtml(displayCountryName(x.countryCode, state.locale, ''))}</small></button>`).join('');
  $$('.history-item', root).forEach((btn) => btn.addEventListener('click', () => {
    const x = recent[Number(btn.dataset.recent)];
    selectResult({ kind: x.kind === 'country' ? 'country' : 'place', id: x.key, name: x.rawName || x.name, nameKo: x.name, type: x.kind, countryCode: x.countryCode, code2: x.countryCode, lat: x.lat, lon: x.lon, timezone: x.timezone, admin1: x.admin1, population: x.population, geonameId: x.geonameId });
  }));
}

function renderJourneyStats() {
  if (!state.destination || !state.country || !state.origin) return;
  const airDistance = haversineKm(state.origin, state.destination);
  const estimatedLand = estimateLandRoute(state.originCountry, state.country, airDistance);
  const land = state.roadRoute || estimatedLand;
  const destTz = getDestinationTimezone();
  const diff = timeDifferenceHours(state.origin.timezone, destTz);
  const flightHours = estimateFlightTimeHours(airDistance);
  $('#journeyTitle').textContent = `${originLabel(state.origin)} → ${state.destination.name}`;
  $('#airDistanceValue').textContent = `${formatNumber(Math.round(airDistance * (state.tripType === 'roundtrip' ? 2 : 1)))} km`;
  $('#landDistanceValue').textContent = land.available ? `${formatNumber(Math.round(land.distanceKm * (state.tripType === 'roundtrip' ? 2 : 1)))} km` : t('landUnavailable');
  $('#flightTimeValue').textContent = formatDuration(flightHours * (state.tripType === 'roundtrip' ? 2 : 1));
  $('#landTimeValue').textContent = land.available ? formatDuration(land.hours * (state.tripType === 'roundtrip' ? 2 : 1)) : t('unavailable');
  $('#timeDiffValue').textContent = diff == null ? '—' : `${diff > 0 ? '+' : ''}${diff} h`;
  $('#localTimeValue').textContent = formatLocalTime(destTz);
  const routeNote = $('#routeNote');
  if (routeNote) routeNote.textContent = state.roadRoute?.source === 'osrm' ? t('roadLiveNote') : t('routeNote');
}

function renderCurrentSelection() {
  if (!state.origin || !$('#originLabel')) return;
  syncRouteDisplayData();
  $('#originLabel').textContent = state.origin.isCustom ? t('locationReady') : `${t('currentOrigin')}: ${originLabel(state.origin)}`;
  if (!state.destination || !state.country || !$('#destinationTitle')) {
    $('#mapOriginLabel').textContent = originLabel(state.origin);
    return;
  }
  const d = state.destination;
  const c = state.country;
  $('#flagEmoji').textContent = getFlagEmoji(c.code2);
  $('#destinationType').textContent = d.kind === 'country' ? t('country') : d.kind === 'landmark' ? t('landmark') : d.kind === 'region' ? t('regionPlace') : d.kind === 'capital' ? t('capital') : t('city');
  $('#destinationTitle').textContent = d.name;
  const countryName = displayCountryName(c.code2, state.locale, c.name);
  const originCountryName = state.originCountry ? displayCountryName(state.originCountry.code2, state.locale, state.originCountry.name || state.originCountry.nativeName || state.originCountry.code2) : originLabel(state.origin);
  const routeLegend = $('#routeCountryLegend');
  if (routeLegend) {
    routeLegend.innerHTML = `<span class="route-country-origin">${getFlagEmoji(state.originCountry?.code2 || state.origin.countryCode)} ${escapeHtml(originCountryName)}</span><b>→</b><span class="route-country-destination">${getFlagEmoji(c.code2)} ${escapeHtml(countryName)}</span>`;
    routeLegend.hidden = state.viewMode !== 'globe';
  }
  $('#destinationSubtitle').textContent = d.kind === 'country' ? [c.subregion, c.region].filter(Boolean).join(' · ') : [d.subtitle, countryName].filter(Boolean).join(' · ');
  $('#mapOriginLabel').textContent = originLabel(state.origin);
  $('#mapDestinationLabel').textContent = d.name;
  renderJourneyStats();
  renderCityInsights();
  renderFacts();
  renderMedia();
  renderKnowledge();
  renderFavoriteState();
  updateDetailNavigation();
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3200);
}

async function setOriginFromPreset(id) {
  const preset = originPresetById(id);
  state.originPreset = preset.id;
  setStored('originPreset', preset.id);
  setOriginObject(preset);
  state.originCountry = await getCountry(preset.countryCode);
  state.roadRoute = null;
  renderOriginSelect();
  renderCurrentSelection();
  if (state.destination) {
    updateInteractiveRoute();
    resolveRoadRoute();
  }
}

async function useLocation() {
  if (!navigator.geolocation) {
    toast(t('locationDenied'));
    return;
  }
  const btn = $('#locationButton');
  btn.disabled = true;
  btn.classList.add('is-loading');
  navigator.geolocation.getCurrentPosition(async (pos) => {
    state.origin = {
      id: 'custom',
      isCustom: true,
      names: { [state.locale]: t('originCustom'), en: 'My location' },
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      countryCode: null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      source: 'geolocation'
    };
    let nearest = null;
    let min = Infinity;
    for (const c of state.countryIndex) {
      if (c.lat == null || c.lon == null) continue;
      const d = haversineKm(state.origin, { lat: c.lat, lon: c.lon });
      if (d < min) { min = d; nearest = c; }
    }
    state.originCountry = nearest ? await getCountry(nearest.code2) : null;
    state.roadRoute = null;
    renderOriginSelect();
    renderCurrentSelection();
    if (state.destination) {
      updateInteractiveRoute();
      resolveRoadRoute();
    }
    btn.disabled = false;
    btn.classList.remove('is-loading');
    toast(t('locationReady'));
  }, () => {
    btn.disabled = false;
    btn.classList.remove('is-loading');
    toast(t('locationDenied'));
  }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 });
}

function resultRow(result) {
  const index = state.searchResults.length ? state.searchResults.indexOf(result) : -1;
  const realIndex = index >= 0 ? index : 0;
  const type = result.kind === 'country' ? t('country') : result.type === 'landmark' ? t('landmark') : result.type === 'region' ? t('regionPlace') : t('city');
  return `<button class="search-result" role="option" type="button" data-index="${realIndex}">
    <span class="result-icon">${getFlagEmoji(result.code2 || result.countryCode)}</span>
    <span class="result-copy"><strong>${escapeHtml(resultName(result))}</strong><small>${escapeHtml(type)} · ${escapeHtml(resultSecondary(result))}</small></span>
    ${icon('chevron', 17)}
  </button>`;
}

function renderSearchResults(results, onlineState = '') {
  const box = $('#searchResults');
  state.searchResults = results;
  state.selectedResultIndex = -1;
  if (!$('#searchInput').value.trim()) { box.hidden = true; return; }
  if (!results.length) {
    box.innerHTML = `<div class="search-empty">${onlineState === 'error' ? escapeHtml(t('networkFallback')) : escapeHtml(t('noResults'))}</div>`;
    box.hidden = false;
    return;
  }
  const groups = [];
  const countries = results.filter((x) => x.kind === 'country');
  const places = results.filter((x) => x.kind !== 'country');
  if (countries.length) groups.push(`<div class="result-group-label">${escapeHtml(t('countries'))}</div>${countries.map(resultRow).join('')}`);
  if (places.length) groups.push(`<div class="result-group-label">${escapeHtml(t('places'))}</div>${places.map(resultRow).join('')}`);
  box.innerHTML = groups.join('');
  box.hidden = false;
  $$('.search-result', box).forEach((el) => el.addEventListener('click', () => selectResult(results[Number(el.dataset.index)])));
}

async function doSearch() {
  const input = $('#searchInput');
  const query = input.value.trim();
  $('#clearSearch').hidden = !query;
  if (!query) { $('#searchResults').hidden = true; return; }
  const local = await searchLocal(query, state.locale);
  state.searchResults = local;
  renderSearchResults(local);
  if (query.length < 2) return;
  state.searchAbort?.abort();
  const controller = new AbortController();
  state.searchAbort = controller;
  try {
    const online = await searchOnlinePlaces(query, state.locale);
    if (controller.signal.aborted || $('#searchInput').value.trim() !== query) return;
    const keys = new Set(local.map((x) => `${x.countryCode || x.code2}:${(x.name || x.displayName || '').toLowerCase()}`));
    const extra = online.filter((x) => !keys.has(`${x.countryCode}:${x.name.toLowerCase()}`));
    const merged = [...local, ...extra].slice(0, 12);
    state.searchResults = merged;
    renderSearchResults(merged);
  } catch {
    if (!controller.signal.aborted && !local.length) renderSearchResults([], 'error');
  }
}

async function selectResult(result, { skipUrl = false, urlMode = 'push', skipRecent = false } = {}) {
  if (!result) return;
  $('#searchResults').hidden = true;
  $('#searchInput').value = '';
  $('#clearSearch').hidden = true;

  if (result.kind !== 'country' && ['city', 'capital'].includes(result.type || result.kind) && (!Number.isFinite(Number(result.lat)) || !Number.isFinite(Number(result.lon)) || result.needsGeocode)) {
    const resolved = await resolveCityLocation(result, state.locale).catch(() => null);
    if (!resolved || !Number.isFinite(Number(resolved.lat)) || !Number.isFinite(Number(resolved.lon))) {
      toast(t('networkFallback'));
      return;
    }
    result = { ...result, ...resolved, kind: result.kind, type: result.type || 'city', needsGeocode: false };
  }

  const code2 = (result.code2 || result.countryCode || '').toUpperCase();
  const country = await getCountry(code2);
  if (!country) return;
  state.country = country;
  hydrateCountryMapPoints(code2);
  if (result.kind === 'country') {
    state.destination = {
      key: `country:${code2}`,
      kind: 'country',
      name: displayCountryName(code2, state.locale, country.name),
      lat: country.capitalLat ?? country.lat,
      lon: country.capitalLon ?? country.lon,
      countryCode: code2,
      timezone: null,
      subtitle: country.capital ? `${t('capital')}: ${country.capital}` : '',
      rawName: country.name
    };
  } else {
    state.destination = {
      key: `place:${result.id || result.name}:${code2}`,
      kind: result.type || 'city',
      name: resultName(result),
      nameKo: result.nameKo || '',
      lat: Number(result.lat),
      lon: Number(result.lon),
      countryCode: code2,
      timezone: result.timezone || null,
      subtitle: [result.admin2, result.admin1].filter(Boolean).join(' · '),
      rawName: result.name,
      population: result.population,
      elevation: result.elevation,
      admin1: result.admin1,
      admin2: result.admin2,
      admin3: result.admin3,
      admin4: result.admin4,
      postcodes: result.postcodes,
      geonameId: result.geonameId,
      featureCode: result.featureCode,
      source: result.source
    };
  }
  if (isCityDestination()) {
    state.cityInfo = { loading: true, location: state.destination };
    state.countryCities = null;
    state.countryCitiesToken += 1;
  } else {
    state.cityInfo = null;
    state.cityInsightsToken += 1;
    state.countryCities = state.destination.kind === 'country' ? null : [];
    if (state.destination.kind !== 'country') state.countryCitiesToken += 1;
  }
  if (result.kind !== 'country' && Number.isFinite(state.destination.lat) && Number.isFinite(state.destination.lon)) {
    const existsOnMap = state.mapPoints.some((point) => point.countryCode === code2 && Math.abs(Number(point.lat) - state.destination.lat) < 0.02 && Math.abs(Number(point.lon) - state.destination.lon) < 0.02);
    if (!existsOnMap) {
      state.mapPoints.push({
        id: result.id || `searched-${Date.now()}`,
        name: result.name || state.destination.rawName || state.destination.name,
        nameKo: result.nameKo || state.destination.name,
        type: result.type || 'city',
        countryCode: code2,
        lat: state.destination.lat,
        lon: state.destination.lon,
        timezone: state.destination.timezone,
        population: result.population || null,
        isSearchedPoint: true
      });
      globe2D?.setPlaces(state.mapPoints);
      if (globeData) globeData.places = state.mapPoints;
      globe3D?.setPlaces(state.mapPoints);
    }
  }
  state.knowledge = await loadKnowledge(code2);
  const famousPlaces = state.knowledge?.famousPlaces || state.knowledge?.ko?.famousPlaces || [];
  if (Array.isArray(famousPlaces) && famousPlaces.length) {
    for (let i = 0; i < famousPlaces.length; i++) {
      const place = famousPlaces[i];
      const lat = Number(place.lat);
      const lon = Number(place.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const id = `famous-${code2.toLowerCase()}-${i}`;
      if (state.mapPoints.some((point) => point.id === id)) continue;
      state.mapPoints.push({
        id,
        name: place.name,
        nameKo: place.nameKo,
        type: 'landmark',
        countryCode: code2,
        lat,
        lon,
        timezone: null,
        wikiTitle: place.wikiTitle,
        descriptionKo: place.descriptionKo,
        isFamousPoint: true
      });
    }
    globe2D?.setPlaces(state.mapPoints);
    if (globeData) globeData.places = state.mapPoints;
    globe3D?.setPlaces(state.mapPoints);
  }
  state.stats = null;
  state.roadRoute = null;
  globe2D?.highlightCountry(code2);
  globe3D?.setSelectedCountry(code2);
  updateInteractiveRoute();
  renderCurrentSelection();
  if (state.destination.kind === 'country') hydrateCountryCities();
  else if (isCityDestination()) hydrateCityInsights();
  resolveRoadRoute();
  const recentItem = { key: state.destination.key, name: state.destination.name, nameKo: state.destination.nameKo, countryCode: code2, kind: state.destination.kind, lat: state.destination.lat, lon: state.destination.lon, timezone: state.destination.timezone, rawName: state.destination.rawName, admin1: state.destination.admin1, admin2: state.destination.admin2, population: state.destination.population, elevation: state.destination.elevation, geonameId: state.destination.geonameId };
  if (!skipRecent) {
    pushRecent(recentItem, APP.maxRecent);
    setStored('lastDestination', recentItem);
  }
  renderRecent();
  updateDetailNavigation();
  if (!skipUrl) updateUrl(urlMode);
  fetchWorldBankStats(country.code3).then((stats) => { if (state.country?.code2 === code2) { state.stats = stats; renderFacts(); } }).catch(() => {});
}

async function resolveRoadRoute() {
  if (!state.origin || !state.destination || !state.country) return;
  const airDistance = haversineKm(state.origin, state.destination);
  const fallback = estimateLandRoute(state.originCountry, state.country, airDistance);
  if (!fallback.available) {
    state.roadRoute = null;
    renderJourneyStats();
    return;
  }
  const originKey = `${state.origin.lat},${state.origin.lon}`;
  const destinationKey = `${state.destination.lat},${state.destination.lon}`;
  const requestKey = `${originKey}|${destinationKey}`;
  state.roadRouteRequest = requestKey;
  const route = await fetchRoadRoute(state.origin, state.destination);
  if (state.roadRouteRequest !== requestKey) return;
  if (route) {
    state.roadRoute = { available: true, distanceKm: route.distanceKm, hours: route.hours, source: 'osrm' };
  } else {
    state.roadRoute = null;
  }
  renderJourneyStats();
}

function updateUrl(mode = 'replace') {
  if (!state.destination) return;
  const u = new URL(location.href);
  u.search = '';
  u.searchParams.set('c', state.destination.countryCode);
  if (state.destination.kind !== 'country') {
    u.searchParams.set('name', state.destination.rawName || state.destination.name);
    u.searchParams.set('kind', state.destination.kind || 'city');
    u.searchParams.set('lat', Number(state.destination.lat).toFixed(4));
    u.searchParams.set('lon', Number(state.destination.lon).toFixed(4));
    if (state.destination.timezone) u.searchParams.set('tz', state.destination.timezone);
  }
  if (mode === 'push') {
    state.appHistoryDepth += 1;
    history.pushState({ globehop: true, depth: state.appHistoryDepth }, '', u);
  } else {
    history.replaceState({ globehop: true, depth: state.appHistoryDepth }, '', u);
  }
}

function wireEvents() {
  $('#languageSelect').addEventListener('change', (e) => {
    state.locale = e.target.value;
    setStored('locale', state.locale);
    applyTranslations();
    if (state.country && state.destination?.kind === 'country') {
      state.destination.name = displayCountryName(state.country.code2, state.locale, state.country.name);
    }
    if (isCityDestination()) state.cityInfo = { loading: true, location: state.destination };
    renderCurrentSelection();
    if (isCityDestination()) hydrateCityInsights();
    if (state.destination) updateInteractiveRoute({ focus3D: false });
  });
  $('#originSelect').addEventListener('change', async (e) => {
    if (e.target.value === 'custom') return;
    await setOriginFromPreset(e.target.value);
  });
  $('#themeButton').addEventListener('click', () => setTheme($('#themeButton').dataset.nextTheme));
  $('#locationButton').addEventListener('click', useLocation);
  $('#previousPlaceButton').addEventListener('click', () => {
    if (state.appHistoryDepth > 0) {
      history.back();
      return;
    }
    $('#countryParentButton').click();
  });
  $('#countryParentButton').addEventListener('click', () => {
    if (!state.country || state.destination?.kind === 'country') return;
    selectResult({ kind: 'country', ...state.country, code2: state.country.code2, displayName: displayCountryName(state.country.code2, state.locale, state.country.name) });
  });
  window.addEventListener('popstate', async (event) => {
    state.appHistoryDepth = Number(event.state?.globehop ? event.state.depth : 0) || 0;
    state.restoringHistory = true;
    await loadSelectionFromLocation();
    state.restoringHistory = false;
    updateDetailNavigation();
  });
  $('#replayButton').addEventListener('click', () => {
    globe2D?.replay();
    globe3D?.replay();
  });
  $('#mapCameraControls').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-camera]');
    if (!button) return;
    const active3D = globe3D || ensureGlobe3D();
    if (!active3D) return;
    const mode = button.dataset.camera;
    if (mode === 'route') active3D.resetView();
    if (mode === 'origin') active3D.focusOrigin();
    if (mode === 'destination') active3D.focusDestination();
    if (mode === 'world') active3D.worldView();
  });
  $('#resetMapButton').addEventListener('click', () => {
    hideMapTooltip();
    if (state.viewMode === 'globe') (globe3D || ensureGlobe3D())?.resetView();
    else globe2D?.resetView();
  });
  $('#mapZoomControls').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-zoom]');
    if (!button) return;
    hideMapTooltip();
    const factor = button.dataset.zoom === 'in' ? 1.22 : (1 / 1.22);
    if (state.viewMode === 'globe') (globe3D || ensureGlobe3D())?.zoomBy(factor);
    else globe2D?.zoomBy(factor);
  });
  $('#tripSelector').addEventListener('click', (e) => {
    const button = e.target.closest('button[data-trip]');
    if (!button) return;
    state.tripType = button.dataset.trip;
    setStored('tripType', state.tripType);
    updateViewControls();
    if (state.destination) {
      updateInteractiveRoute();
      renderCurrentSelection();
    }
  });
  $('#viewSelector').addEventListener('click', (e) => {
    const button = e.target.closest('button[data-view]');
    if (!button) return;
    state.viewMode = button.dataset.view;
    setStored('viewMode', state.viewMode);
    updateViewControls();
    if (state.destination) {
      syncRouteDisplayData();
      if (state.viewMode === 'globe') {
        const active3D = globe3D || ensureGlobe3D();
        active3D?.resize();
        active3D?.setRoute(state.origin, state.destination, state.tripType, { focus: true });
      } else {
        globe2D?.setRoute(state.origin, state.destination, 'plane', state.tripType);
      }
    }
  });
  $('#favoriteButton').addEventListener('click', () => {
    if (!state.destination) return;
    const item = { key: state.destination.key, name: state.destination.name, countryCode: state.destination.countryCode, kind: state.destination.kind, lat: state.destination.lat, lon: state.destination.lon, timezone: state.destination.timezone, rawName: state.destination.rawName };
    const r = toggleFavorite(item);
    renderFavoriteState();
    renderRecent();
    toast(r.active ? t('favorite') : t('unfavorite'));
  });
  $('#searchInput').addEventListener('input', () => { clearTimeout(state.searchTimer); state.searchTimer = setTimeout(doSearch, 180); });
  $('#searchInput').addEventListener('keydown', (e) => {
    if ($('#searchResults').hidden) return;
    const rows = $$('.search-result', $('#searchResults'));
    if (!rows.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      state.selectedResultIndex = (state.selectedResultIndex + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
      rows.forEach((r, i) => r.classList.toggle('is-keyboard-selected', i === state.selectedResultIndex));
      rows[state.selectedResultIndex].scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'Enter' && state.selectedResultIndex >= 0) { e.preventDefault(); rows[state.selectedResultIndex].click(); }
    if (e.key === 'Escape') $('#searchResults').hidden = true;
  });
  $('#clearSearch').addEventListener('click', () => { $('#searchInput').value = ''; $('#clearSearch').hidden = true; $('#searchResults').hidden = true; $('#searchInput').focus(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search-wrap')) $('#searchResults').hidden = true; });
  const dialog = $('#sourceDialog');
  const open = () => dialog.showModal();
  $('#infoButton').addEventListener('click', open);
  $('#footerInfo').addEventListener('click', open);
  $$('[data-dialog-close]').forEach((b) => b.addEventListener('click', () => dialog.close()));

  // Explore India panel
  $('#indiaStateSelect').addEventListener('change', (event) => {
    state.indiaState = event.target.value;
    renderExploreIndia();
  });
  $('#exploreIndiaToggle').addEventListener('click', () => {
    state.indiaPanelOpen = !state.indiaPanelOpen;
    renderExploreIndia();
  });
  const landmarkDialog = $('#landmarkDialog');
  landmarkDialog.addEventListener('click', (event) => {
    if (event.target.closest('[data-landmark-close]')) landmarkDialog.close();
  });
}

async function loadSelectionFromLocation() {
  const params = new URLSearchParams(location.search);
  const c = (params.get('c') || APP.defaultCountryCode).toUpperCase();
  if (params.get('lat') && params.get('lon')) {
    await selectResult({
      kind: 'place',
      id: 'url',
      name: params.get('name') || displayCountryName(c, state.locale, c),
      type: params.get('kind') || 'city',
      countryCode: c,
      lat: Number(params.get('lat')),
      lon: Number(params.get('lon')),
      timezone: params.get('tz') || null
    }, { skipUrl: true });
    return;
  }
  const countryRow = state.countryIndex.find((x) => x.code2 === c) || state.countryIndex.find((x) => x.code2 === APP.defaultCountryCode);
  if (countryRow) await selectResult({ kind: 'country', ...countryRow, displayName: displayCountryName(countryRow.code2, state.locale, countryRow.name) }, { skipUrl: true });
}

async function loadInitialSelection() {
  const params = new URLSearchParams(location.search);
  if (params.has('c')) {
    await loadSelectionFromLocation();
    updateUrl('replace');
    return;
  }
  const saved = getStored('lastDestination', null);
  if (saved?.countryCode && state.countryIndex.some((row) => row.code2 === saved.countryCode)) {
    if (saved.kind === 'country') {
      const row = state.countryIndex.find((item) => item.code2 === saved.countryCode);
      await selectResult({ kind: 'country', ...row, displayName: displayCountryName(row.code2, state.locale, row.name) }, { skipUrl: true });
    } else if (Number.isFinite(Number(saved.lat)) && Number.isFinite(Number(saved.lon))) {
      await selectResult({
        kind: 'place', id: saved.key || 'saved-place', name: saved.rawName || saved.name, nameKo: saved.nameKo || saved.name,
        type: saved.kind || 'city', countryCode: saved.countryCode, lat: Number(saved.lat), lon: Number(saved.lon),
        timezone: saved.timezone || null, admin1: saved.admin1, admin2: saved.admin2, population: saved.population, elevation: saved.elevation, geonameId: saved.geonameId
      }, { skipUrl: true });
    }
    if (state.destination) {
      updateUrl('replace');
      return;
    }
  }
  const india = state.countryIndex.find((row) => row.code2 === APP.defaultCountryCode);
  await selectResult({ kind: 'country', ...india, displayName: displayCountryName(APP.defaultCountryCode, state.locale, india?.name || 'India') }, { skipUrl: true, skipRecent: true });
  updateUrl('replace');
}

async function init() {
  renderAppShell();
  renderLanguageSelect();
  setTheme(state.theme);
  // Anonymous analytics: non-blocking, fails silently if Functions/D1 are absent.
  bootVisitStats();
  const [geoms, index, places, origins, indianLandmarks] = await Promise.all([
    loadWorldGeometries(), loadCountryIndex(), loadPlaces(), loadOrigins(),
    loadIndianLandmarks().catch(() => [])
  ]);
  state.countryIndex = index;
  state.places = places;
  state.indianLandmarks = indianLandmarks;
  state.mapPoints = [...buildInteractiveMapPoints(index, places), ...indianLandmarks.map(landmarkToMapPoint)];
  state.origins = origins;
  const initialOrigin = originPresetById(state.originPreset);
  setOriginObject(initialOrigin);
  applyTranslations();
  renderExploreIndia();
  wireEvents();
  updateViewControls();
  globe2D = new GlobeView($('#globeSvg'), {
    onHover: showMapTooltip,
    onLeave: hideMapTooltip,
    onCountryClick: (country) => travelToInteractiveItem({ kind: 'country', data: country }),
    onPlaceClick: (place) => travelToInteractiveItem({ kind: 'place', data: place })
  });
  globeData = { geometries: geoms, countries: index, places: state.mapPoints };
  if (state.viewMode === 'globe') ensureGlobe3D();
  state.originCountry = await getCountry(initialOrigin.countryCode);
  globe2D.setData({ geometries: geoms, countries: index, places: state.mapPoints });
  await loadInitialSelection();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    let reloadingForWorker = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadingForWorker) return;
      reloadingForWorker = true;
      location.reload();
    });
    navigator.serviceWorker.register('./sw.js').then((registration) => registration.update()).catch(() => {});
  }
  const focus = new URLSearchParams(location.search).get('focus');
  if (focus === 'search') $('#searchInput').focus();
}

init().catch((error) => {
  console.error(error);
  $('#app').innerHTML = '<main class="fatal-error"><span>🌍</span><h1>GlobeHop Kids</h1><p>We could not load the map. Please refresh the page to try again.</p><button onclick="location.reload()">Refresh</button></main>';
});
