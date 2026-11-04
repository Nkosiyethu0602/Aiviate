// components/RouteMap.js
// MapLibre GL JS inside a WebView.
// - No native MapLibre module, no react-native-maps, no OpenStreetMap tile servers.
// - Works in Expo Go and in dev builds.
// Install:  npx expo install react-native-webview   (or: npm install react-native-webview)
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

// Vector style served by MapTiler. Free key: https://cloud.maptiler.com
const MAPTILER_KEY = 'N9vHuIwjO4BcjT5N1heR';
const STYLE_URL = `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`;
// Keyless alternative (swap STYLE_URL):
// const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

const DEFAULT_CENTER = [28.0473, -26.2041]; // [lng, lat] Johannesburg

const isValidCoord = (lat, lng) =>
  typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng);

// Accepts [{lat,lng}] or [[lat,lng]] and returns GeoJSON [lng, lat] pairs.
const EMPTY = [];

// Decodes a Google/OSRM/ORS encoded polyline string into [lat, lng] pairs.
const decodePolyline = (str, precision = 5) => {
  const factor = Math.pow(10, precision);
  const out = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < str.length) {
    let b;
    let shift = 0;
    let result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < str.length);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < str.length);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    out.push([lat / factor, lng / factor]);
  }
  return out;
};

const distSq = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

const nearestRefDist = (pt, refs) =>
  refs.length ? Math.min(...refs.map((r) => distSq(pt, r))) : 0;

// Turns many route formats into GeoJSON [lng, lat] pairs:
//  - encoded polyline string
//  - GeoJSON LineString / Feature  ({coordinates: [[lng, lat], ...]})
//  - [{lat,lng}] / [{latitude,longitude}] / [{lat,lon}]
//  - [[a, b], ...] where the order is auto-detected using the stops/driver positions
const normalizePath = (input, refs) => {
  if (!input) return [];
  let lngLat = [];

  if (typeof input === 'string') {
    let pairs = decodePolyline(input, 5);
    if (pairs.length && (Math.abs(pairs[0][0]) > 90 || Math.abs(pairs[0][1]) > 180)) {
      pairs = decodePolyline(input, 6);
    }
    lngLat = pairs.map(([lat, lng]) => [lng, lat]);
  } else if (!Array.isArray(input) && (input.coordinates || input.geometry?.coordinates)) {
    lngLat = input.coordinates || input.geometry.coordinates;
  } else if (Array.isArray(input) && input.length > 0) {
    if (Array.isArray(input[0])) {
      // Ambiguous order: pick the one whose first point lands nearest a known stop/driver.
      const [a, b] = input[0];
      const asLatLng = [b, a]; // treating input as [lat, lng]
      const asLngLat = [a, b]; // treating input as [lng, lat]
      const useLatLng =
        !refs.length || nearestRefDist(asLatLng, refs) <= nearestRefDist(asLngLat, refs);
      lngLat = input.map((p) => (useLatLng ? [p[1], p[0]] : [p[0], p[1]]));
    } else {
      lngLat = input.map((p) => [
        p?.lng ?? p?.lon ?? p?.longitude,
        p?.lat ?? p?.latitude,
      ]);
    }
  }

  return lngLat.filter(
    (p) =>
      Array.isArray(p) &&
      isValidCoord(p[1], p[0]) &&
      Math.abs(p[1]) <= 90 &&
      Math.abs(p[0]) <= 180
  );
};

const buildHtml = (center, zoom) => `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet" />
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<style>
  html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; background: #0F2A3D;
                     overflow: hidden; touch-action: none; -webkit-user-select: none; user-select: none; }
  #err { position: absolute; top: 0; left: 0; right: 0; z-index: 10; display: none;
         background: #B00020; color: #fff; font: 12px sans-serif; padding: 6px 8px; }
  .stop { width: 24px; height: 24px; border-radius: 12px; background: #0F2A3D; border: 2px solid #fff;
          display: flex; align-items: center; justify-content: center; box-sizing: border-box; }
  .stop.current { background: #008080; transform: scale(1.2); }
  .stop.done { background: #34C759; opacity: 0.6; }
  .stop .inner { width: 8px; height: 8px; border-radius: 4px; background: #fff; }
  .driver { width: 22px; height: 22px; border-radius: 11px; background: rgba(30,136,255,0.25);
            display: flex; align-items: center; justify-content: center; }
  .driver .inner { width: 12px; height: 12px; border-radius: 6px; background: #1E88FF; border: 2px solid #fff; box-sizing: border-box; }
</style>
</head>
<body>
<div id="map"></div>
<div id="err"></div>
<script>
  function post(msg) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  }
  var errShown = false;
  function showErr(m) {
    if (errShown) return;
    errShown = true;
    var e = document.getElementById('err');
    e.style.display = 'block';
    e.textContent = 'Map error: ' + m;
  }
  window.onerror = function (m) { showErr(String(m)); post({ type: 'error', message: String(m) }); };

  var empty = { type: 'FeatureCollection', features: [] };
  var ready = false, pending = null, stopMarkers = [], driverMarker = null, lastFocus = '';

  var map = new maplibregl.Map({
    container: 'map',
    style: ${JSON.stringify(STYLE_URL)},
    center: ${JSON.stringify(center)},
    zoom: ${zoom},
    attributionControl: { compact: true }
  });

  map.on('error', function (e) {
    var msg = e && e.error ? String(e.error.message || e.error) : 'unknown';
    showErr(msg);
    post({ type: 'maperror', message: msg });
  });

  map.on('load', function () {
    map.addSource('route', { type: 'geojson', data: empty });
    map.addLayer({ id: 'route-line', type: 'line', source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#008080', 'line-width': 4 } });
    map.addSource('leg', { type: 'geojson', data: empty });
    map.addLayer({ id: 'leg-line', type: 'line', source: 'leg',
      layout: { 'line-join': 'round' },
      paint: { 'line-color': '#1E88FF', 'line-width': 4, 'line-dasharray': [1.5, 1] } });
    ready = true;
    post({ type: 'ready' });
    if (pending) { apply(pending); pending = null; }
  });

  function line(coords) {
    if (!coords || coords.length < 2) return empty;
    return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } };
  }

  function el(cls) {
    var outer = document.createElement('div');
    var inner = document.createElement('div');
    inner.className = cls;
    var dot = document.createElement('div');
    dot.className = 'inner';
    inner.appendChild(dot);
    outer.appendChild(inner);
    return outer;
  }

  var routeKey = '', legKey = '', stopsKey = '';

  function apply(p) {
    // Only touch the map for the parts that actually changed (keeps it smooth).
    var rk = JSON.stringify(p.route);
    if (rk !== routeKey) { routeKey = rk; map.getSource('route').setData(line(p.route)); }
    var lk = JSON.stringify(p.leg);
    if (lk !== legKey) { legKey = lk; map.getSource('leg').setData(line(p.leg)); }

    var sk = JSON.stringify(p.stops);
    if (sk !== stopsKey) {
      stopsKey = sk;
      stopMarkers.forEach(function (m) { m.remove(); });
      stopMarkers = p.stops.map(function (s) {
        var cls = 'stop' + (s.done ? ' done' : '') + (s.current ? ' current' : '');
        return new maplibregl.Marker({ element: el(cls) }).setLngLat(s.lngLat).addTo(map);
      });
    }

    if (p.driver) {
      if (driverMarker) driverMarker.setLngLat(p.driver);
      else driverMarker = new maplibregl.Marker({ element: el('driver') }).setLngLat(p.driver).addTo(map);
    } else if (driverMarker) {
      driverMarker.remove();
      driverMarker = null;
    }

    if (p.focus) {
      var key = p.focus.join(',');
      if (key !== lastFocus) {
        lastFocus = key;
        map.flyTo({ center: p.focus, zoom: 14, duration: 800 });
      }
    } else {
      lastFocus = '';
    }
  }

  window.updateMap = function (p) {
    if (!ready) { pending = p; return; }
    apply(p);
  };
</script>
</body>
</html>`;

export default function RouteMap({
  style,
  stops = EMPTY,
  currentIndex = 0,
  polyline = null,
  focusActive = false,
  driverLocation = null,
  driverLeg = null,
}) {
  const webRef = useRef(null);
  const loadedRef = useRef(false);

  const hasDriver =
    !!driverLocation && isValidCoord(driverLocation.lat, driverLocation.lng);

  // The page is only built once, using the first known position as the start view.
  const html = useMemo(() => {
    if (hasDriver) return buildHtml([driverLocation.lng, driverLocation.lat], 12);
    if (stops.length > 0 && isValidCoord(stops[0].lat, stops[0].lng)) {
      return buildHtml([stops[0].lng, stops[0].lat], 11);
    }
    return buildHtml(DEFAULT_CENTER, 10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const payload = useMemo(() => {
    const activeStop = stops[currentIndex];
    const refs = stops
      .filter((s) => isValidCoord(s.lat, s.lng))
      .map((s) => [s.lng, s.lat]);
    if (hasDriver) refs.push([driverLocation.lng, driverLocation.lat]);

    // Line from the driver to the next destination.
    // Uses the real road route (driverLeg) when the parent provides one; otherwise
    // falls back to a straight line from the driver to the current/next stop.
    let leg = normalizePath(driverLeg, refs);
    if (leg.length < 2 && hasDriver) {
      const target =
        activeStop && isValidCoord(activeStop.lat, activeStop.lng) && !activeStop.completed
          ? activeStop
          : stops.find((s) => !s.completed && isValidCoord(s.lat, s.lng));
      if (target) {
        leg = [
          [driverLocation.lng, driverLocation.lat],
          [target.lng, target.lat],
        ];
      }
    }

    return {
      route: normalizePath(polyline, refs),
      leg,
      stops: stops
        .map((s, idx) =>
          isValidCoord(s.lat, s.lng)
            ? { lngLat: [s.lng, s.lat], done: !!s.completed, current: idx === currentIndex }
            : null
        )
        .filter(Boolean),
      driver: hasDriver ? [driverLocation.lng, driverLocation.lat] : null,
      focus:
        focusActive && activeStop && isValidCoord(activeStop.lat, activeStop.lng)
          ? [activeStop.lng, activeStop.lat]
          : null,
    };
  }, [stops, currentIndex, polyline, driverLeg, driverLocation, focusActive, hasDriver]);

  useEffect(() => {
    if (__DEV__) {
      const raw = (v) =>
        v == null
          ? 'none'
          : typeof v === 'string'
          ? `string(${v.length})`
          : Array.isArray(v)
          ? `array(${v.length}) first=${JSON.stringify(v[0])}`
          : `object keys=${Object.keys(v)}`;
      console.log(
        '[RouteMap] polyline raw:', raw(polyline), '| parsed pts:', payload.route.length,
        '| driverLeg raw:', raw(driverLeg), '| parsed pts:', payload.leg.length,
        '| stops:', payload.stops.length
      );
    }
  }, [payload, polyline, driverLeg]);

  const send = useCallback(() => {
    if (!loadedRef.current || !webRef.current) return;
    webRef.current.injectJavaScript(
      `window.updateMap && window.updateMap(${JSON.stringify(payload)}); true;`
    );
  }, [payload]);

  useEffect(() => {
    send();
  }, [send]);

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={webRef}
        style={styles.map}
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://localhost/' }}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        nestedScrollEnabled
        androidLayerType="hardware"
        setBuiltInZoomControls={false}
        setSupportMultipleWindows={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        onLoadEnd={() => {
          loadedRef.current = true;
          send();
        }}
        onMessage={(e) => {
          try {
            const msg = JSON.parse(e.nativeEvent.data);
            if (msg.type === 'error' || msg.type === 'maperror') {
              console.warn('[RouteMap]', msg.message);
            }
          } catch (_) {}
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F2A3D' },
  map: { flex: 1, backgroundColor: '#0F2A3D' },
});