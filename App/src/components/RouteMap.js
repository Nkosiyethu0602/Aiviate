import React, { useEffect, useRef } from 'react';
import { Platform, View, Text, StyleSheet } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { COLORS } from '../theme';
import { bearingDeg } from '../utils/geo';

export default function RouteMap({
  stops = [],
  currentIndex = 0,
  polyline,
  style,
  focusActive = false,
  driverLocation = null,
  driverLeg = null,
}) {
  const mapRef = useRef(null);

  const safeStops = Array.isArray(stops) ? stops : [];
  const points = safeStops.map((s) => ({ latitude: s.lat, longitude: s.lng }));
  const polyCoords = polyline || points;
  const activeStop = safeStops[currentIndex] || null;

  const initialRegion = {
    latitude: safeStops[0]?.lat || -26.2083,
    longitude: safeStops[0]?.lng || 28.0482,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  };

  // Web Render Branch with Explicit Flex & Canvas Heights
  if (Platform.OS === 'web') {
    return (
      <View style={[styles.webWrapper, style]}>
        <MapView
          style={styles.webMap}
          initialRegion={initialRegion}
          fitToPoints={safeStops.map((s) => ({ lat: s.lat, lng: s.lng }))}
          focusZoom={16}
          driverLocation={driverLocation}
        >
          {polyCoords.length >= 2 && (
            <Polyline coordinates={polyCoords} strokeColor={COLORS?.teal || '#008080'} strokeWidth={5} />
          )}
          {driverLeg && driverLeg.length >= 2 && (
            <Polyline coordinates={driverLeg} strokeColor="#1E88FF" strokeWidth={4} />
          )}
          {safeStops.map((s, i) => (
            <Marker
              key={s.id || String(i)}
              coordinate={{ latitude: s.lat, longitude: s.lng }}
              label={String(i + 1)}
              variant={s.completed ? 'done' : s.type}
              active={i === currentIndex && !s.completed}
            />
          ))}
        </MapView>
      </View>
    );
  }

  // Native (iOS / Android) Render Branch
  return (
    <View style={[styles.container, style]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        initialRegion={initialRegion}
        showsUserLocation={!driverLocation}
        followsUserLocation={focusActive && !driverLocation}
        showsMyLocationButton={false}
      >
        {polyCoords.length >= 2 && (
          <Polyline coordinates={polyCoords} strokeColor={COLORS?.teal || '#008080'} strokeWidth={5} />
        )}
        {safeStops.map((s, i) => (
          <Marker
            key={s.id || String(i)}
            coordinate={{ latitude: s.lat, longitude: s.lng }}
            title={`Stop ${i + 1}`}
            description={s.address}
          />
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  webWrapper: {
    flex: 1,
    width: '100%',
    height: '100%',
    minHeight: '400px', // Prevents Web DOM height collapse
    position: 'relative',
  },
  webMap: {
    width: '100%',
    height: '100%',
    flex: 1,
  },
});