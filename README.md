# GlobeHop Kids World 🌍✈️

**An interactive, educational globe for children to explore the world, customized for Indian students.**

GlobeHop Kids World lets learners search for countries, cities and landmarks, then follow the journey from a departure city to the chosen destination on both an interactive 2D world map and a real WebGL 3D globe. Along the route, children discover capitals, populations, distances, flight times, time differences, weather, culture and nature — all in a kid-friendly interface.

The app is a fully static website (HTML, CSS and vanilla JavaScript) with no build-time framework and no application server.

## Highlights

- **India-first experience** — the default departure point is **New Delhi, India**, and the map and 3D globe open centered on India.
- **Interactive 2D map** — hover and click countries, cities and landmarks; the map animates the flight route and zooms to each trip.
- **Real WebGL 3D globe** — a true rotating sphere rendered without external 3D libraries, with drag rotation, wheel/pinch zoom, animated flight arcs and a moving plane. Automatic fallback to the 2D map when WebGL is unavailable.
- **Kid-friendly learning cards** — overview, geography, history, culture, etiquette, foods, festivals, animals, plants, landmarks and fun facts for each country.
- **City explorer** — a bundled directory of major cities per country, plus live weather, air quality, city details, photos and nearby places when online.
- **Journey information** — air distance (Haversine), estimated flight time, land-route estimate (with live OSRM routing when available), time difference and local time.
- **Search** — instant local search over bundled countries, places and a large city index, with optional online place search.
- **PWA ready** — installable web app with a manifest, service worker, app icons and offline-friendly caching.
- **Light and dark themes** with responsive, touch-friendly and accessible controls.

## Supported languages

The language menu is focused on English and Indian languages only:

- English (default)
- हिन्दी (Hindi)
- বাংলা (Bengali)
- اردو (Urdu)
- मराठी (Marathi)
- తెలుగు (Telugu)
- தமிழ் (Tamil)
- ગુજરાતી (Gujarati)

English is the absolute default on first load. Any language without a full translation gracefully falls back to English, and country names are localized through `Intl.DisplayNames`.

## Default departure cities

Departure cities are configured in [`src/data/origins/index.json`](src/data/origins/index.json). The list opens with major Indian cities — **New Delhi (default), Mumbai, Bengaluru, Chennai, Kolkata, Hyderabad and Ahmedabad** — followed by a selection of world cities for global learning. Children can also choose **Use my location** to depart from their own coordinates.

## Project structure

```text
├─ index.html               # App shell template and SEO/meta tags
├─ 404.html                 # Standalone not-found page
├─ manifest.webmanifest     # PWA manifest
├─ sw.js                    # Service worker
├─ functions/               # Cloudflare Pages Functions
│  └─ api/stats.js          # Anonymous D1 visit-counter endpoint (/api/stats)
├─ public/                  # Static assets copied into the build output
│  ├─ icons/
│  ├─ 404.html
│  ├─ manifest.webmanifest
│  └─ sw.js
├─ scripts/
│  ├─ build.mjs             # Pure-Node static build (writes dist/)
│  └─ dev-server.mjs        # Local static development server
├─ src/
│  ├─ app.js                # UI shell, state and interactions
│  ├─ styles.css            # All styling, including light/dark themes
│  ├─ modules/
│  │  ├─ config.js          # App config: locales, default origin/country, API endpoints
│  │  ├─ i18n.js            # English + Indian language UI strings
│  │  ├─ storage.js         # localStorage helpers
│  │  ├─ geo.js             # Distance, route and time calculations
│  │  ├─ dataService.js     # Local data loading, search and external API helpers
│  │  ├─ analytics.js       # Anonymous visit-counter client (fails soft offline)
│  │  ├─ cityInsights.js    # Weather, air quality, Wikipedia/Wikidata city details
│  │  ├─ globe.js           # Interactive 2D SVG world map
│  │  ├─ globe3d.js         # WebGL 3D globe
│  │  └─ wikiMedia.js       # Wikimedia image resolution
│  └─ data/
│     ├─ countries/         # Country index and regional detail files
│     ├─ cities/            # Bundled GeoNames-derived city index
│     ├─ knowledge/         # Country learning-card packs
│     ├─ origins/           # Departure city presets
│     ├─ places/            # Featured cities and landmarks
│     ├─ korea/             # Regional tourism data
│     └─ world-geometries.json
└─ docs/                    # Internal architecture and data guides
```

## Local development

Requirements: Node.js 20 or newer. No third-party packages are required.

```bash
npm run dev
```

Then open the printed local URL (default `http://localhost:5173/`).

Useful query parameters:

- `?view=map` — force the 2D map
- `?view=globe` — force the 3D globe
- `?c=IN` — open a specific country by ISO code
- `?focus=search` — focus the search box on load

## Build

```bash
npm run build
```

This regenerates the `dist/` folder by copying `src/` and `public/` and filling the site URL placeholders in `index.html`. To bake a canonical URL into the metadata:

```bash
SITE_URL="https://example.com/" npm run build
```

Preview the production build with:

```bash
npm run preview
```

## Data and external services

Bundled data includes country facts, world geometries, featured places, a city index and country learning packs. When online, the app can enrich the experience with:

- Open-Meteo — geocoding, weather and air quality
- World Bank — population, GDP and GNI statistics
- OSRM — driving-route estimates
- Wikipedia / Wikimedia / Wikidata — city descriptions, photos and structured details

All external calls are optional: if a service is unreachable, the bundled data keeps the core exploration working.

## Anonymous Analytics

The site records privacy-first traffic counters through a Cloudflare Pages Function backed by a D1 database bound as `DB` (`functions/api/stats.js`):

- `POST /api/stats` — called once on app boot. Increments `total_visits`; increments `unique_visitors` only when the first-party `gh_vid` cookie is absent, then sets it for one year.
- `POST /api/stats` with `action: "hop"` — fired (fire-and-forget, `keepalive`) whenever a user flies to an Indian landmark. Adds one to `total_hops`, adds the trip's great-circle distance in km to `total_distance_km` (capped per request), and upserts the landmark's `click_count` in `landmark_stats`.
- `POST /api/stats` with `action: "explore_state"` — fired when a state/UT is chosen in the Explore India panel; upserts its `explore_count` in `state_stats`.
- `GET /api/stats` — returns `{ total_visits, unique_visitors, total_hops, total_distance_km, top_landmarks, top_states }`; the top-3 leaderboard powers the Community Explorer Hub widget inside the Explore India panel, while the visit counters appear in the footer.
- D1 tables (`visit_stats`, `community_stats`, `landmark_stats`, `state_stats`) are created automatically with `CREATE TABLE IF NOT EXISTS` and hold only integer counters plus public landmark/state identifiers. No names, emails, exact GPS coordinates, fingerprints or any personal data are collected, and no third-party analytics scripts are used.
- Every activity call is asynchronous and non-blocking by design; invalid payloads and database errors are acknowledged with a soft HTTP 200 so the app experience is never affected. If Pages Functions or D1 are unavailable, the requests fail silently and the widgets stay hidden.

## Accessibility and privacy

- Semantic HTML, keyboard navigation, visible focus states and large touch targets.
- `prefers-reduced-motion` support and alt text for images.
- Automatic 2D fallback for browsers without WebGL.
- Location coordinates are used only for client-side route calculations and are never stored on a server; the only server-side data is the anonymous visit counters described above.

## License

Application code is released under the MIT License. Bundled third-party data, images and APIs remain under their original source licenses; see [`NOTICE.md`](NOTICE.md) for details.
