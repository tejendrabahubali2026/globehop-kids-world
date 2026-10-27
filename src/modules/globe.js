import { geometryToSvgPath, routeGeometry, quadraticPoint, equirectProject } from './geo.js';

const NS = 'http://www.w3.org/2000/svg';

function svgEl(name, attrs = {}) {
  const el = document.createElementNS(NS, name);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

function eachGeometryPoint(geometry, callback) {
  if (!geometry) return;
  const walkRing = (ring) => ring.forEach(([lon, lat]) => callback(lon, lat));
  if (geometry.type === 'Polygon') geometry.coordinates.forEach(walkRing);
  if (geometry.type === 'MultiPolygon') geometry.coordinates.forEach((polygon) => polygon.forEach(walkRing));
}

export class GlobeView {
  constructor(svg, { onHover, onLeave, onCountryClick, onPlaceClick } = {}) {
    this.svg = svg;
    this.geometries = [];
    this.geometryByCode = new Map();
    this.countries = new Map();
    this.places = [];
    this.animFrame = null;
    this.currentRoute = null;
    this.originCountry = null;
    this.destinationCountry = null;
    this.selectedCountry = null;
    this.onHover = onHover;
    this.onLeave = onLeave;
    this.onCountryClick = onCountryClick;
    this.onPlaceClick = onPlaceClick;
    this.defaultViewBox = { x: 0, y: 0, width: 1000, height: 500 };
    this.currentViewBox = { ...this.defaultViewBox };
    this.activePointers = new Map();
    this.lastPanPoint = null;
    this.lastPinchDistance = null;
    this.suppressClickUntil = 0;
    this.renderShell();
    this.bindMapInteractions();
  }

  renderShell() {
    this.svg.innerHTML = '';
    this.svg.setAttribute('viewBox', '0 0 1000 500');
    const defs = svgEl('defs');
    const oceanShade = svgEl('linearGradient', { id: 'oceanShade2d', x1: '0', x2: '1' });
    oceanShade.innerHTML = '<stop offset="0%" stop-color="var(--ocean-deep)"/><stop offset="48%" stop-color="var(--ocean)"/><stop offset="100%" stop-color="var(--ocean-deep)"/>';
    defs.appendChild(oceanShade);
    this.svg.appendChild(defs);
    this.svg.appendChild(svgEl('rect', { x: '0', y: '0', width: '1000', height: '500', class: 'map-ocean' }));
    this.gridLayer = svgEl('g', { class: 'globe-grid' });
    for (let lon = -150; lon <= 150; lon += 30) {
      const x = ((lon + 180) / 360) * 1000;
      this.gridLayer.appendChild(svgEl('path', { d: `M${x},0 V500` }));
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const y = ((90 - lat) / 180) * 500;
      this.gridLayer.appendChild(svgEl('path', { d: `M0,${y} H1000` }));
    }
    this.svg.appendChild(this.gridLayer);
    this.landLayer = svgEl('g', { class: 'land-layer' });
    this.placeLayer = svgEl('g', { class: 'place-layer' });
    this.routeLayer = svgEl('g', { class: 'route-layer' });
    this.markerLayer = svgEl('g', { class: 'marker-layer' });
    this.clusterLayer = svgEl('g', { class: 'cluster-layer' });
    this.svg.appendChild(this.landLayer);
    this.svg.appendChild(this.placeLayer);
    this.svg.appendChild(this.clusterLayer);
    this.svg.appendChild(this.routeLayer);
    this.svg.appendChild(this.markerLayer);
    this.clusterSignature = '';
    this.clusterNodes = [];
  }

  clampViewBox(box) {
    const minWidth = 34;
    const width = Math.max(minWidth, Math.min(1000, box.width));
    const height = width / 2;
    const x = Math.max(0, Math.min(1000 - width, box.x));
    const y = Math.max(0, Math.min(500 - height, box.y));
    return { x, y, width, height };
  }

  applyViewBox(box) {
    this.currentViewBox = this.clampViewBox(box);
    this.svg.setAttribute('viewBox', `${this.currentViewBox.x} ${this.currentViewBox.y} ${this.currentViewBox.width} ${this.currentViewBox.height}`);
    this.svg.classList.toggle('is-zoomed', this.currentViewBox.width < 960);
    this.refreshFixedSizeGraphics();
  }

  mapPointFromClient(clientX, clientY) {
    const rect = this.svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const nx = (clientX - rect.left) / rect.width;
    const ny = (clientY - rect.top) / rect.height;
    return {
      x: this.currentViewBox.x + nx * this.currentViewBox.width,
      y: this.currentViewBox.y + ny * this.currentViewBox.height
    };
  }

  zoomAt(factor = 1.18, clientX = null, clientY = null) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const rect = this.svg.getBoundingClientRect();
    const cx = clientX ?? (rect.left + rect.width / 2);
    const cy = clientY ?? (rect.top + rect.height / 2);
    const anchor = this.mapPointFromClient(cx, cy) || {
      x: this.currentViewBox.x + this.currentViewBox.width / 2,
      y: this.currentViewBox.y + this.currentViewBox.height / 2
    };
    const newWidth = Math.max(34, Math.min(1000, this.currentViewBox.width / factor));
    const ratio = newWidth / this.currentViewBox.width;
    const newHeight = newWidth / 2;
    const next = {
      x: anchor.x - (anchor.x - this.currentViewBox.x) * ratio,
      y: anchor.y - (anchor.y - this.currentViewBox.y) * ratio,
      width: newWidth,
      height: newHeight
    };
    this.applyViewBox(next);
  }

  zoomBy(factor = 1.18) {
    this.zoomAt(factor);
  }

  panByCss(dx, dy) {
    const rect = this.svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const mapDx = dx * this.currentViewBox.width / rect.width;
    const mapDy = dy * this.currentViewBox.height / rect.height;
    this.applyViewBox({
      ...this.currentViewBox,
      x: this.currentViewBox.x - mapDx,
      y: this.currentViewBox.y - mapDy
    });
  }

  bindMapInteractions() {
    const target = this.svg;
    target.addEventListener('wheel', (event) => {
      event.preventDefault();
      const factor = Math.max(0.82, Math.min(1.24, Math.exp(-event.deltaY * 0.0014)));
      this.zoomAt(factor, event.clientX, event.clientY);
    }, { passive: false });

    target.addEventListener('pointerdown', (event) => {
      target.setPointerCapture?.(event.pointerId);
      this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.lastPanPoint = { x: event.clientX, y: event.clientY };
      if (this.activePointers.size === 2) {
        const points = [...this.activePointers.values()];
        this.lastPinchDistance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      }
    });

    target.addEventListener('pointermove', (event) => {
      if (!this.activePointers.has(event.pointerId)) return;
      this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.activePointers.size >= 2) {
        const points = [...this.activePointers.values()].slice(0, 2);
        const pinch = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
        const midpoint = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
        if (this.lastPinchDistance && pinch > 4) {
          const factor = Math.max(0.86, Math.min(1.16, pinch / this.lastPinchDistance));
          this.zoomAt(factor, midpoint.x, midpoint.y);
          this.suppressClickUntil = performance.now() + 220;
        }
        this.lastPinchDistance = pinch;
        return;
      }
      if (this.lastPanPoint) {
        const dx = event.clientX - this.lastPanPoint.x;
        const dy = event.clientY - this.lastPanPoint.y;
        if (Math.abs(dx) + Math.abs(dy) > 1) {
          this.panByCss(dx, dy);
          this.suppressClickUntil = performance.now() + 180;
        }
      }
      this.lastPanPoint = { x: event.clientX, y: event.clientY };
    });

    const endPointer = (event) => {
      this.activePointers.delete(event.pointerId);
      if (this.activePointers.size < 2) this.lastPinchDistance = null;
      if (this.activePointers.size === 1) {
        const point = [...this.activePointers.values()][0];
        this.lastPanPoint = { ...point };
      } else if (!this.activePointers.size) {
        this.lastPanPoint = null;
      }
    };
    target.addEventListener('pointerup', endPointer);
    target.addEventListener('pointercancel', endPointer);
    target.addEventListener('lostpointercapture', endPointer);
  }

  setData({ geometries = [], countries = [], places = [] }) {
    this.countries = new Map(countries.map((c) => [c.code2, c]));
    this.setGeometries(geometries);
    this.setPlaces(places);
  }

  setGeometries(geometries) {
    this.geometries = geometries;
    this.geometryByCode = new Map(geometries.map((g) => [g.code2, g]));
    this.landLayer.innerHTML = '';
    const frag = document.createDocumentFragment();
    geometries.forEach((g) => {
      const path = svgEl('path', { d: geometryToSvgPath(g.geometry), class: 'country-shape interactive-country', 'data-code': g.code2, 'aria-label': g.name, tabindex: '0' });
      const meta = this.countries.get(g.code2) || g;
      const showHover = (event) => this.onHover?.({ kind: 'country', data: meta }, { clientX: event.clientX, clientY: event.clientY });
      path.addEventListener('pointerenter', showHover);
      path.addEventListener('pointermove', showHover);
      path.addEventListener('pointerleave', () => this.onLeave?.());
      path.addEventListener('click', () => { if (performance.now() < this.suppressClickUntil) return; this.onCountryClick?.(meta); });
      path.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.onCountryClick?.(meta); } });
      frag.appendChild(path);
    });
    this.landLayer.appendChild(frag);
  }

  markerVisualScale() {
    const geographicRatio = Math.max(0.12, Math.min(1, this.currentViewBox.width / 1000));
    // Let points grow moderately on screen as the user zooms instead of staying pixel-identical.
    return Math.max(0.04, Math.min(1, Math.pow(geographicRatio, 0.72)));
  }

  pointTransform(x, y) {
    return `translate(${x} ${y}) scale(${this.markerVisualScale()})`;
  }

  setPlaces(places) {
    this.places = places;
    this.placeLayer.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const place of places) {
      const p = equirectProject(place.lat, place.lon);
      const population = Number(place.population) || 0;
      const radius = place.type === 'landmark' ? 4.8 : place.type === 'capital' ? 3.2 : population >= 1000000 ? 3.4 : population >= 200000 ? 3.0 : population >= 50000 ? 2.6 : 2.25;
      const isIndiaLandmark = Boolean(place.isIndiaLandmark);
      const g = svgEl('g', {
        class: `map-place-point map-place-${place.type || 'city'}`,
        transform: this.pointTransform(p.x, p.y),
        tabindex: place.isCapitalPoint ? '-1' : '0', role: 'button',
        'aria-label': place.name || place.nameKo || place.id,
        'data-country': place.countryCode || '', 'data-searched': place.isSearchedPoint ? '1' : '0',
        'data-dynamic-city': place.isDynamicCity ? '1' : '0',
        'data-dynamic-landmark': place.isDynamicLandmark ? '1' : '0',
        'data-landmark': isIndiaLandmark ? '1' : '0',
        'data-population': String(population),
        'data-rank': String(place.cityRank || 999999),
        'data-x': p.x, 'data-y': p.y
      });
      if (isIndiaLandmark) {
        // Lightweight emoji marker with an invisible, generous hit area.
        g.appendChild(svgEl('circle', { cx: '0', cy: '0', r: '9', class: 'landmark-hit' }));
        const emoji = svgEl('text', { x: '0', y: '3.4', 'text-anchor': 'middle', class: 'landmark-emoji' });
        emoji.textContent = place.emoji || '📍';
        g.appendChild(emoji);
      } else {
        g.appendChild(svgEl('circle', { cx: '0', cy: '0', r: String(radius), class: 'map-place-dot' }));
      }
      const showHover = (event) => this.onHover?.({ kind: 'place', data: place }, { clientX: event.clientX, clientY: event.clientY });
      g.addEventListener('pointerenter', showHover);
      g.addEventListener('pointermove', showHover);
      g.addEventListener('pointerleave', () => this.onLeave?.());
      g.addEventListener('click', (event) => { event.stopPropagation(); if (performance.now() < this.suppressClickUntil) return; this.onPlaceClick?.(place); });
      g.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.onPlaceClick?.(place); } });
      frag.appendChild(g);
    }
    this.placeLayer.appendChild(frag);
    this.updatePlaceVisibility();
  }

  refreshFixedSizeGraphics() {
    const scale = this.markerVisualScale();
    this.placeLayer?.querySelectorAll('.map-place-point').forEach((node) => {
      const x = Number(node.dataset.x); const y = Number(node.dataset.y);
      if (Number.isFinite(x) && Number.isFinite(y)) node.setAttribute('transform', `translate(${x} ${y}) scale(${scale})`);
    });
    this.markerLayer?.querySelectorAll('.map-pin').forEach((node) => {
      const x = Number(node.dataset.x); const y = Number(node.dataset.y);
      if (Number.isFinite(x) && Number.isFinite(y)) node.setAttribute('transform', `translate(${x} ${y}) scale(${scale})`);
    });
    if (this.traveler && this.traveler.dataset.x && this.traveler.dataset.y) {
      this.updateTravelerTransform(Number(this.traveler.dataset.x), Number(this.traveler.dataset.y));
    }
    this.updatePlaceVisibility();
  }

  updatePlaceVisibility() {
    if (!this.placeLayer) return;
    const nodes = [...this.placeLayer.querySelectorAll('.map-place-point')];
    const box = this.currentViewBox;
    const zoom = 1000 / Math.max(1, box.width);
    const marginX = box.width * 0.08;
    const marginY = box.height * 0.10;
    const cityCandidates = [];
    const landmarkCandidates = [];
    const indiaLandmarkNodes = [];
    for (const node of nodes) {
      const country = node.dataset.country;
      const relevant = !this.selectedCountry || country === this.selectedCountry || country === this.originCountry || node.dataset.searched === '1';
      node.classList.toggle('is-muted-point', !relevant);
      if (node.dataset.landmark === '1') {
        indiaLandmarkNodes.push(node);
        continue;
      }
      const dynamicCity = node.dataset.dynamicCity === '1';
      const dynamicLandmark = node.dataset.dynamicLandmark === '1';
      if (!dynamicCity && !dynamicLandmark) {
        node.classList.remove('is-density-hidden');
        continue;
      }
      const x = Number(node.dataset.x);
      const y = Number(node.dataset.y);
      const inside = x >= box.x - marginX && x <= box.x + box.width + marginX && y >= box.y - marginY && y <= box.y + box.height + marginY;
      if (!relevant || !inside || (this.selectedCountry && country !== this.selectedCountry && node.dataset.searched !== '1')) {
        node.classList.add('is-density-hidden');
        continue;
      }
      (dynamicLandmark ? landmarkCandidates : cityCandidates).push(node);
    }
    const cityLimit = zoom < 1.35 ? 10 : zoom < 2 ? 24 : zoom < 3.2 ? 60 : zoom < 5 ? 140 : zoom < 7 ? 260 : zoom < 15 ? 480 : 800;
    const landmarkLimit = zoom < 1.35 ? 5 : zoom < 2 ? 10 : zoom < 3.2 ? 18 : zoom < 5 ? 32 : zoom < 12 ? 70 : 110;
    cityCandidates.sort((a, b) => Number(b.dataset.population || 0) - Number(a.dataset.population || 0) || Number(a.dataset.rank || 999999) - Number(b.dataset.rank || 999999));
    landmarkCandidates.sort((a, b) => Number(a.dataset.rank || 999999) - Number(b.dataset.rank || 999999));
    cityCandidates.forEach((node, index) => node.classList.toggle('is-density-hidden', index >= cityLimit));
    landmarkCandidates.forEach((node, index) => node.classList.toggle('is-density-hidden', index >= landmarkLimit));
    this.updateLandmarkClusters(indiaLandmarkNodes);
  }

  // Grid-based clustering for the Indian landmarks dataset. Clusters are only rebuilt
  // when the bucket layout changes; otherwise transforms are updated in place so the
  // map stays smooth even with 170+ emoji points during pans and zooms.
  updateLandmarkClusters(nodes) {
    if (!this.clusterLayer) return;
    const box = this.currentViewBox;
    const marginX = box.width * 0.08;
    const marginY = box.height * 0.1;
    const landmarkRelevant = !this.selectedCountry || this.selectedCountry === 'IN' || this.originCountry === 'IN';
    const visible = [];
    for (const node of nodes) {
      if (!landmarkRelevant) {
        node.classList.add('is-density-hidden');
        continue;
      }
      const x = Number(node.dataset.x);
      const y = Number(node.dataset.y);
      const inside = x >= box.x - marginX && x <= box.x + box.width + marginX && y >= box.y - marginY && y <= box.y + box.height + marginY;
      if (!inside) {
        node.classList.add('is-density-hidden');
        continue;
      }
      visible.push({ node, x, y });
    }
    if (!visible.length) {
      this.clusterLayer.innerHTML = '';
      this.clusterNodes = [];
      this.clusterSignature = '';
      return;
    }
    // Close zoom: show every individual emoji marker, no clustering.
    if (box.width <= 170) {
      visible.forEach((v) => v.node.classList.remove('is-density-hidden'));
      this.clusterLayer.innerHTML = '';
      this.clusterNodes = [];
      this.clusterSignature = '';
      return;
    }
    const cell = Math.max(18, Math.min(95, box.width * 0.055));
    const buckets = new Map();
    for (const v of visible) {
      const key = `${Math.floor(v.x / cell)}:${Math.floor(v.y / cell)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(v);
    }
    const groups = [];
    for (const group of buckets.values()) {
      if (group.length === 1) {
        group[0].node.classList.remove('is-density-hidden');
        continue;
      }
      group.forEach((v) => v.node.classList.add('is-density-hidden'));
      const cx = group.reduce((sum, v) => sum + v.x, 0) / group.length;
      const cy = group.reduce((sum, v) => sum + v.y, 0) / group.length;
      groups.push({ cx, cy, count: group.length });
    }
    const signature = `${cell.toFixed(1)}|${groups.map((g) => `${g.cx.toFixed(0)},${g.cy.toFixed(0)}:${g.count}`).join(';')}`;
    if (signature === this.clusterSignature && this.clusterNodes.length === groups.length) {
      this.clusterNodes.forEach((cluster, index) => {
        const g = groups[index];
        if (g) cluster.setAttribute('transform', this.pointTransform(g.cx, g.cy));
      });
      return;
    }
    this.clusterSignature = signature;
    this.clusterLayer.innerHTML = '';
    this.clusterNodes = [];
    for (const g of groups) {
      const node = svgEl('g', {
        class: 'map-landmark-cluster',
        transform: this.pointTransform(g.cx, g.cy),
        role: 'button',
        tabindex: '0',
        'aria-label': `${g.count} landmarks`
      });
      node.appendChild(svgEl('circle', { cx: '0', cy: '0', r: '10', class: 'cluster-circle' }));
      const label = svgEl('text', { x: '0', y: '3.6', 'text-anchor': 'middle', class: 'cluster-count' });
      label.textContent = String(g.count);
      node.appendChild(label);
      const activate = (event) => {
        event?.stopPropagation?.();
        this.zoomToWorldPoint(g.cx, g.cy, 2.1);
      };
      node.addEventListener('click', activate);
      node.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          activate(event);
        }
      });
      this.clusterLayer.appendChild(node);
      this.clusterNodes.push(node);
    }
  }

  zoomToWorldPoint(x, y, factor = 2) {
    const newWidth = Math.max(34, this.currentViewBox.width / factor);
    const next = this.clampViewBox({ x: x - newWidth / 2, y: y - newWidth / 4, width: newWidth, height: newWidth / 2 });
    this.animateViewBox(next, 560);
  }

  focusPoint(lat, lon, { width = 120 } = {}) {
    const p = equirectProject(lat, lon);
    const w = Math.max(46, Math.min(420, width));
    this.svg.classList.add('is-zoomed');
    this.animateViewBox({ x: p.x - w / 2, y: p.y - w / 4, width: w, height: w / 2 }, 760);
  }

  highlightCountry(code2) {
    this.selectedCountry = code2 || null;
    this.landLayer.querySelectorAll('.country-shape.is-selected').forEach((p) => p.classList.remove('is-selected'));
    if (code2) this.landLayer.querySelectorAll(`[data-code="${CSS.escape(code2)}"]`).forEach((p) => p.classList.add('is-selected'));
    this.updateRouteCountryClasses();
    this.updatePlaceVisibility();
  }

  updateRouteCountryClasses() {
    this.landLayer.querySelectorAll('.country-shape').forEach((path) => {
      const code = path.dataset.code;
      path.classList.toggle('is-route-origin', Boolean(this.originCountry && code === this.originCountry));
      path.classList.toggle('is-route-destination', Boolean(this.destinationCountry && code === this.destinationCountry));
    });
  }

  setRoute(origin, destination, transport = 'plane', tripType = 'oneway', { focus = true } = {}) {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this.routeLayer.innerHTML = '';
    this.markerLayer.innerHTML = '';
    const route = routeGeometry(origin, destination);
    this.currentRoute = { origin, destination, transport, route, tripType };
    this.originCountry = origin.countryCode || null;
    this.destinationCountry = destination.countryCode || null;
    this.updateRouteCountryClasses();
    const d = `M${route.p1.x},${route.p1.y} Q${route.control.x},${route.control.y} ${route.p2.x},${route.p2.y}`;
    const path = svgEl('path', { d, class: 'travel-path', 'vector-effect': 'non-scaling-stroke' });
    this.routeLayer.appendChild(path);
    if (tripType === 'roundtrip') this.routeLayer.appendChild(svgEl('path', { d, class: 'travel-path travel-path-return', 'vector-effect': 'non-scaling-stroke' }));
    if (route.wrap) {
      const shift = route.p2.x < 0 ? 1000 : -1000;
      this.routeLayer.appendChild(svgEl('path', {
        d: `M${route.p1.x + shift},${route.p1.y} Q${route.control.x + shift},${route.control.y} ${route.p2.x + shift},${route.p2.y}`,
        class: 'travel-path travel-path-secondary', 'vector-effect': 'non-scaling-stroke'
      }));
    }
    const start = equirectProject(origin.lat, origin.lon);
    const end = equirectProject(destination.lat, destination.lon);
    this.markerLayer.appendChild(this.pin(start.x, start.y, 'origin'));
    this.markerLayer.appendChild(this.pin(end.x, end.y, 'destination'));
    this.traveler = svgEl('g', { class: 'traveler', 'aria-hidden': 'true', 'data-x': start.x, 'data-y': start.y });
    this.traveler.appendChild(svgEl('circle', { cx: '0', cy: '0', r: '17', class: 'traveler-bubble' }));
    const text = svgEl('text', { x: '0', y: '6', 'text-anchor': 'middle', class: 'traveler-icon' });
    text.textContent = '✈️';
    this.traveler.appendChild(text);
    this.markerLayer.appendChild(this.traveler);
    this.updateTravelerTransform(start.x, start.y);
    if (focus) this.focusRoute(origin, destination);
    this.animate();
  }

  countryProjectedBounds(code2) {
    const entry = this.geometryByCode.get(code2);
    if (!entry?.geometry) return null;
    const xs = []; const ys = [];
    eachGeometryPoint(entry.geometry, (lon, lat) => {
      const p = equirectProject(lat, lon);
      xs.push(p.x); ys.push(p.y);
    });
    if (!xs.length) return null;
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const width = maxX - minX; const height = maxY - minY;
    if (width > 300 || height > 220) return null;
    return { minX, maxX, minY, maxY };
  }

  focusRoute(origin, destination) {
    this.svg.classList.add('is-zoomed');
    const p1 = equirectProject(origin.lat, origin.lon);
    const p2 = equirectProject(destination.lat, destination.lon);
    const boxes = [{ minX: p1.x, maxX: p1.x, minY: p1.y, maxY: p1.y }, { minX: p2.x, maxX: p2.x, minY: p2.y, maxY: p2.y }];
    const originBox = this.countryProjectedBounds(origin.countryCode);
    const destinationBox = this.countryProjectedBounds(destination.countryCode);
    if (originBox) boxes.push(originBox);
    if (destinationBox && destination.countryCode !== origin.countryCode) boxes.push(destinationBox);

    let minX = Math.min(...boxes.map((b) => b.minX));
    let maxX = Math.max(...boxes.map((b) => b.maxX));
    const minY = Math.min(...boxes.map((b) => b.minY));
    const maxY = Math.max(...boxes.map((b) => b.maxY));
    // Dateline routes are fitted from the endpoint pair rather than stretching across the world.
    if (maxX - minX > 620) {
      minX = Math.min(p1.x, p2.x);
      maxX = Math.max(p1.x, p2.x);
    }
    const contentW = Math.max(48, maxX - minX);
    const contentH = Math.max(34, maxY - minY);
    // Keep geographic context. The previous 96-unit minimum made Seoul→Japan zoom more than 7×,
    // which inflated markers and made the map unreadable.
    const width = Math.min(1000, Math.max(190, contentW * 1.55, contentH * 2.55));
    const height = Math.min(500, width / 2);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const x = Math.max(0, Math.min(1000 - width, centerX - width / 2));
    const y = Math.max(0, Math.min(500 - height, centerY - height / 2));
    this.animateViewBox({ x, y, width, height }, 760);
  }

  animateViewBox(target, duration = 800) {
    target = this.clampViewBox(target);
    const from = { ...this.currentViewBox };
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      this.currentViewBox = {
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
        width: from.width + (target.width - from.width) * e,
        height: from.height + (target.height - from.height) * e
      };
      this.svg.setAttribute('viewBox', `${this.currentViewBox.x} ${this.currentViewBox.y} ${this.currentViewBox.width} ${this.currentViewBox.height}`);
      this.svg.classList.toggle('is-zoomed', this.currentViewBox.width < 960);
      this.refreshFixedSizeGraphics();
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  resetView() {
    this.svg.classList.remove('is-zoomed');
    this.animateViewBox(this.defaultViewBox, 650);
  }

  pin(x, y, kind) {
    const g = svgEl('g', { class: `map-pin ${kind}`, 'data-x': x, 'data-y': y, transform: this.pointTransform(x, y) });
    g.appendChild(svgEl('circle', { cx: '0', cy: '0', r: '9' }));
    g.appendChild(svgEl('circle', { cx: '0', cy: '0', r: '3.5', class: 'pin-core' }));
    return g;
  }

  updateTravelerTransform(x, y) {
    if (!this.traveler) return;
    this.traveler.dataset.x = x;
    this.traveler.dataset.y = y;
    this.traveler.setAttribute('transform', `translate(${x} ${y}) scale(${this.markerVisualScale()})`);
  }

  animate() {
    if (!this.currentRoute || !this.traveler) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const finalT = this.currentRoute.tripType === 'roundtrip' ? 0 : 1;
      const p = quadraticPoint(this.currentRoute.route, finalT);
      this.updateTravelerTransform(p.x, p.y);
      return;
    }
    const start = performance.now();
    const duration = this.currentRoute.tripType === 'roundtrip' ? 4200 : 2600;
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const routeT = this.currentRoute.tripType === 'roundtrip' ? (eased < 0.5 ? eased * 2 : 2 - eased * 2) : eased;
      const p = quadraticPoint(this.currentRoute.route, routeT);
      this.updateTravelerTransform(p.x, p.y);
      if (progress < 1) this.animFrame = requestAnimationFrame(tick);
    };
    this.animFrame = requestAnimationFrame(tick);
  }

  replay() {
    this.animate();
    if (this.currentRoute) this.focusRoute(this.currentRoute.origin, this.currentRoute.destination);
  }
}
