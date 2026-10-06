import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Linking,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import RouteMap from '../components/RouteMap';
import ScreenHeader from '../components/ScreenHeader';
import AnimatedProgress from '../components/AnimatedProgress';
import LogoMark from '../components/LogoMark';
import BarcodeScanModal from '../components/BarcodeScanModal';
import DeliveryOutcomeModal from '../components/DeliveryOutcomeModal';
import { useJobs } from '../contexts/JobsContext';
import { useDriver } from '../contexts/DriverContext';
import { useToast } from '../contexts/ToastContext';
import { useDriverLocation } from '../hooks/useDriverLocation';
import { fetchOptimizedRoute, fetchLeg } from '../services/routing';
import { deviceBridge } from '../services/deviceBridge';
import { haversineMeters, formatMeters, ARRIVAL_RADIUS_M } from '../utils/geo';
import { haptic } from '../utils/haptics';
import { COLORS } from '../theme';

export default function ActiveJobScreen({ navigation }) {
  const { activeRoute, advance, start } = useJobs();
  const { driver } = useDriver();
  const { toast } = useToast();

  const [routePath, setRoutePath] = useState(null);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [acting, setActing] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [capturedBarcode, setCapturedBarcode] = useState(null);
  const [simulatedAtStop, setSimulatedAtStop] = useState(false);
  const [isDrowsy, setIsDrowsy] = useState(false);
  const [safeRouteInserted, setSafeRouteInserted] = useState(false);
  const arrivalNotifiedRef = useRef(null);

  const isInProgress = activeRoute?.status === 'in_progress';
  const isLocationNeeded = !!activeRoute && !['completed'].includes(activeRoute?.status);

  // Stream device location
  const { coords: realDriverLocation, status: locStatus, error: locError, retry } =
    useDriverLocation({ enabled: isLocationNeeded, driverId: driver?.id });

  // Connect to local hardware bridge / WebSocket Python Server
  useEffect(() => {
    // Port 8081 matches bridge.py local server
    deviceBridge.connect('ws://localhost:8081'); 

    const unsubscribe = deviceBridge.subscribe((event) => {
      // Handles both WebSocket event definitions
      if (
        event?.type === 'DROWSINESS_ALERT' || 
        (event?.type === 'DROWSINESS_UPDATE' && event.isDrowsy)
      ) {
        setIsDrowsy(true);
        setSafeRouteInserted(true);
        haptic.error();
        toast.error('Drowsiness detected! Rerouting to nearest rest stop.');
      } else if (event?.type === 'DROWSINESS_UPDATE' && !event.isDrowsy) {
        setIsDrowsy(false);
      }
    });

    return () => unsubscribe();
  }, [toast]);

  const handleDismissDrowsiness = () => {
    setIsDrowsy(false);
    deviceBridge.triggerBuzzer(false);
    haptic.medium();
  };

  const simulatedLocation = useMemo(() => {
    if (!simulatedAtStop || !activeRoute) return null;
    const s = activeRoute.stops[activeRoute.current_stop_index];
    return s ? { lat: s.lat, lng: s.lng } : null;
  }, [simulatedAtStop, activeRoute]);

  const driverLocation = simulatedLocation || realDriverLocation;

  // Insert emergency rest stop if driver fatigue is detected
  const activeStops = useMemo(() => {
    if (!activeRoute?.stops) return [];
    if (!safeRouteInserted) return activeRoute.stops;

    // Create emergency rest stop insertion
    const currentIdx = activeRoute.current_stop_index || 0;
    const currentStop = activeRoute.stops[currentIdx] || activeRoute.stops[0];
    
    const restStop = {
      id: 'emergency_rest_stop',
      address: 'TotalEnergies Oasis Rest Stop (2.4 km)',
      customer: 'Emergency Safe Zone',
      cargo: 'Mandatory Driver Break (15 min)',
      type: 'pickup',
      lat: (currentStop?.lat || -26.2041) + 0.005,
      lng: (currentStop?.lng || 28.0473) + 0.005,
      completed: false,
    };

    const newStops = [...activeRoute.stops];
    newStops.splice(currentIdx, 0, restStop);
    return newStops;
  }, [activeRoute, safeRouteInserted]);

  // Fetch road-routed polyline whenever the active route changes
  useEffect(() => {
    let cancelled = false;
    if (!activeRoute) {
      setRoutePath(null);
      return;
    }
    setLoadingRoute(true);
    fetchOptimizedRoute(activeStops).then((path) => {
      if (cancelled) return;
      setRoutePath(path);
      setLoadingRoute(false);
    });
    return () => {
      cancelled = true;
    };
  }, [activeRoute?.id, activeStops]);

  // Driver-to-stop live leg calculation
  const [driverLeg, setDriverLeg] = useState(null);
  const lastLegFetchRef = useRef({ lat: null, lng: null, stopKey: null });

  useEffect(() => {
    if (!activeRoute || !driverLocation) {
      setDriverLeg(null);
      return;
    }
    const idx = activeRoute.current_stop_index;
    const stop = activeStops[idx];
    if (!stop) {
      setDriverLeg(null);
      return;
    }

    const stopKey = `${activeRoute.id}:${idx}:${safeRouteInserted}`;
    const prev = lastLegFetchRef.current;
    const movedMeters =
      prev.lat != null
        ? haversineMeters({ lat: prev.lat, lng: prev.lng }, driverLocation)
        : Infinity;

    if (prev.stopKey === stopKey && movedMeters < 150) return;

    const distToStop = haversineMeters(driverLocation, { lat: stop.lat, lng: stop.lng });
    if (distToStop != null && distToStop < ARRIVAL_RADIUS_M) {
      setDriverLeg(null);
      lastLegFetchRef.current = { lat: driverLocation.lat, lng: driverLocation.lng, stopKey };
      return;
    }

    let cancelled = false;
    lastLegFetchRef.current = { lat: driverLocation.lat, lng: driverLocation.lng, stopKey };
    fetchLeg(driverLocation, { lat: stop.lat, lng: stop.lng }).then((leg) => {
      if (cancelled) return;
      setDriverLeg(leg);
    });

    return () => {
      cancelled = true;
    };
  }, [activeRoute?.id, activeRoute?.current_stop_index, driverLocation?.lat, driverLocation?.lng, activeStops, safeRouteInserted]);

  const distanceToNext = useMemo(() => {
    if (!activeRoute || !driverLocation) return null;
    const idx = activeRoute.current_stop_index;
    const stop = activeStops[idx];
    if (!stop) return null;
    return haversineMeters(driverLocation, { lat: stop.lat, lng: stop.lng });
  }, [activeRoute, driverLocation, activeStops]);

  const isWithinArrival = distanceToNext != null && distanceToNext <= ARRIVAL_RADIUS_M;

  useEffect(() => {
    if (!activeRoute) {
      arrivalNotifiedRef.current = null;
      return;
    }
    const stopKey = `${activeRoute.id}:${activeRoute.current_stop_index}`;
    if (isWithinArrival && arrivalNotifiedRef.current !== stopKey) {
      arrivalNotifiedRef.current = stopKey;
      haptic.warning();
      const stop = activeStops[activeRoute.current_stop_index];
      if (stop) toast.info(`Arriving at ${stop.address}`);
    } else if (!isWithinArrival && arrivalNotifiedRef.current === stopKey) {
      arrivalNotifiedRef.current = null;
    }
  }, [isWithinArrival, activeRoute, toast, activeStops]);

  if (!activeRoute) {
    return (
      <SafeAreaView style={styles.container}>
        <ScreenHeader title="Active" subtitle="No route in progress" />
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <LogoMark size={56} />
          </View>
          <Text style={styles.emptyTitle}>No active route</Text>
          <Text style={styles.emptySub}>Accept a route from the Routes tab to begin.</Text>
          <TouchableOpacity
            style={styles.emptyBtn}
            onPress={() => navigation.navigate('Jobs')}
            activeOpacity={0.85}
          >
            <Text style={styles.emptyBtnText}>View routes</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const idx = activeRoute.current_stop_index;
  const completedCount = activeStops.filter((s) => s.completed).length;
  const currentStop = activeStops[idx];
  const isComplete = idx >= activeStops.length;

  const handleStart = async () => {
    if (acting) return;
    setActing(true);
    haptic.medium();
    try {
      await start(activeRoute.id);
      haptic.success();
      toast.success('Trip started — drive safe');
    } catch (e) {
      haptic.error();
      toast.error('Could not start trip. Try again.');
    } finally {
      setActing(false);
    }
  };

  const handleRecordRequest = () => {
    if (!isWithinArrival) {
      haptic.warning();
      toast.error('Get within 30 m of the stop before recording delivery.');
      return;
    }
    haptic.light();
    setCapturedBarcode(null);
    setOutcomeOpen(true);
  };

  const handleScanConfirmed = (code) => {
    setScanOpen(false);
    setCapturedBarcode(code);
    haptic.success();
  };

  const handleOutcomeSubmit = async (payload) => {
    if (!driverLocation) {
      haptic.error();
      toast.error('Lost GPS signal — wait a moment and try again.');
      return;
    }

    const liveDistance = haversineMeters(driverLocation, {
      lat: currentStop.lat,
      lng: currentStop.lng,
    });

    if (liveDistance > ARRIVAL_RADIUS_M) {
      haptic.error();
      toast.error(`You moved out of range (${formatMeters(liveDistance)}). Get closer and retry.`);
      return;
    }

    setOutcomeOpen(false);
    setActing(true);
    try {
      await advance(activeRoute.id, {
        ...payload,
        driverLocation: { lat: driverLocation.lat, lng: driverLocation.lng },
      });
      haptic.success();
      setSimulatedAtStop(false);
      setCapturedBarcode(null);
      const isLast = idx + 1 >= activeStops.length;
      const label =
        payload.outcome === 'delivered'
          ? `Stop ${idx + 1} delivered`
          : payload.outcome === 'partially_delivered'
          ? `Stop ${idx + 1} partially delivered`
          : `Stop ${idx + 1} — outcome recorded`;

      if (isLast) {
        toast.success('Route complete — nice work');
        setTimeout(() => navigation.navigate('Jobs'), 600);
      } else {
        toast.success(label);
      }
    } catch (e) {
      haptic.error();
      const msg =
        e?.code === 'OUT_OF_RANGE'
          ? 'You are no longer in range of the stop.'
          : e?.code === 'BARCODE_MISMATCH'
          ? 'Scanned package does not match this stop.'
          : e?.message || 'Could not record outcome. Try again.';
      toast.error(msg);
    } finally {
      setActing(false);
    }
  };

  const handlePrimary = () => {
    if (isComplete || acting) return;
    if (activeRoute.status === 'assigned') return handleStart();
    return handleRecordRequest();
  };

  const openExternalNav = () => {
    if (!currentStop) return;
    haptic.light();
    const { lat, lng } = currentStop;
    const url = Platform.select({
      ios: `http://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`,
      android: `google.navigation:q=${lat},${lng}&mode=d`,
      web: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`,
    });
    Linking.openURL(url).catch(() => {});
  };

  const distLabel = distanceToNext != null ? formatMeters(distanceToNext) : null;
  const primaryLabel = isComplete
    ? 'Route complete'
    : activeRoute.status === 'assigned'
    ? 'Start trip'
    : isWithinArrival
    ? 'Record delivery'
    : distLabel
    ? `Get closer · ${distLabel} away`
    : 'Waiting for GPS…';

  const primaryDisabled =
    isComplete || acting || (activeRoute.status === 'in_progress' && !isWithinArrival);

  const showLocBanner =
    isLocationNeeded &&
    (locStatus === 'denied' || locStatus === 'unavailable' || locStatus === 'error');

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader
        title="Active"
        subtitle={`${activeRoute.id} · ${activeRoute.assigned_by}`}
      />

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {/* Hardware Drowsiness Warning Banner */}
        {isDrowsy && (
          <View style={styles.drowsyBanner}>
            <View style={styles.drowsyHead}>
              <Ionicons name="warning" size={20} color="#FFFFFF" />
              <Text style={styles.drowsyTitle}>DROWSINESS DETECTED</Text>
            </View>
            <Text style={styles.drowsySub}>
              Camera system detected signs of fatigue. Navigation automatically rerouted to the nearest rest stop.
            </Text>
            <TouchableOpacity
              style={styles.drowsyBtn}
              onPress={handleDismissDrowsiness}
              activeOpacity={0.85}
            >
              <Text style={styles.drowsyBtnText}>Dismiss Alert</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.progressCard}>
          <View style={styles.progressHead}>
            <Text style={styles.progressLabel}>
              {isComplete ? 'All stops complete' : `Stop ${idx + 1} of ${activeStops.length}`}
            </Text>
            {loadingRoute && <ActivityIndicator size="small" color={COLORS.teal} />}
          </View>
          <AnimatedProgress value={completedCount / activeStops.length} />
          <Text style={styles.progressText}>
            {completedCount} / {activeStops.length} delivered · {activeRoute.total_distance_km} km total
          </Text>
        </View>

        {showLocBanner && (
          <TouchableOpacity style={styles.locWarn} onPress={retry} activeOpacity={0.85}>
            <Ionicons name="location-outline" size={16} color={COLORS.danger} />
            <Text style={styles.locWarnText} numberOfLines={2}>
              {locStatus === 'denied'
                ? 'Location permission is required for live navigation. Tap to retry.'
                : locStatus === 'unavailable'
                ? 'Location services are off. Enable GPS, then tap to retry.'
                : `Couldn't read location${locError ? `: ${locError}` : ''}. Tap to retry.`}
            </Text>
          </TouchableOpacity>
        )}

        <View
          style={[
            styles.mapCard,
            isInProgress && styles.mapCardActive,
            isDrowsy && styles.mapCardDrowsy,
          ]}
        >
          <RouteMap
            style={styles.map}
            stops={activeStops}
            currentIndex={isComplete ? -1 : idx}
            polyline={routePath}
            focusActive={isInProgress && !isComplete}
            driverLocation={isLocationNeeded ? driverLocation : null}
            driverLeg={driverLeg?.path || null}
            isDrowsy={isDrowsy}
          />
          {!isComplete && (isInProgress || activeRoute.status === 'assigned') && (
            <View style={styles.mapBanner}>
              <View style={[styles.liveDot, locStatus === 'watching' && styles.liveDotOn]} />
              <Text style={styles.mapBannerText} numberOfLines={1}>
                {!isInProgress
                  ? distanceToNext != null
                    ? `${formatMeters(distanceToNext)} to start point · ${currentStop?.address}`
                    : `Drive to start point · ${currentStop?.address}`
                  : distanceToNext != null
                  ? `${formatMeters(distanceToNext)} to stop ${idx + 1} · ${currentStop?.address}`
                  : `Heading to stop ${idx + 1} · ${currentStop?.address}`}
              </Text>
            </View>
          )}
          {driverLeg?.distanceMeters != null && (
            <View style={styles.legChip}>
              <Ionicons name="navigate" size={12} color="#fff" />
              <Text style={styles.legChipText}>
                {formatMeters(driverLeg.distanceMeters)}
                {driverLeg.durationSeconds != null &&
                  ` · ${Math.max(1, Math.round(driverLeg.durationSeconds / 60))} min`}
              </Text>
            </View>
          )}
        </View>

        {!isComplete && currentStop && (
          <View style={styles.currentCard}>
            <View style={styles.currentHead}>
              <View
                style={[
                  styles.typePill,
                  currentStop.type === 'pickup' ? styles.pillPickup : styles.pillDropoff,
                ]}
              >
                <Text style={styles.pillText}>
                  {currentStop.type === 'pickup' ? 'PICKUP' : 'DROP-OFF'}
                </Text>
              </View>
              <Text style={styles.currentNumber}>Stop {idx + 1}</Text>
            </View>
            <Text style={styles.currentAddress}>{currentStop.address}</Text>

            <TouchableOpacity style={styles.navBtn} onPress={openExternalNav} activeOpacity={0.8}>
              <Ionicons name="navigate" size={14} color={COLORS.teal} />
              <Text style={styles.navBtnText}>
                {isInProgress ? 'Open in maps' : 'Navigate to start in maps'}
              </Text>
            </TouchableOpacity>

            <View style={styles.divider} />
            <View style={styles.detailRow}>
              <Ionicons name="person-outline" size={16} color={COLORS.textDim} />
              <Text style={styles.detailValue}>{currentStop.customer}</Text>
            </View>
            <View style={styles.detailRow}>
              <Ionicons name="cube-outline" size={16} color={COLORS.textDim} />
              <Text style={styles.detailValue}>{currentStop.cargo}</Text>
            </View>
            {currentStop.notes ? (
              <View style={styles.detailRow}>
                <Ionicons name="document-text-outline" size={16} color={COLORS.textDim} />
                <Text style={styles.detailValue}>{currentStop.notes}</Text>
              </View>
            ) : null}
            {currentStop.barcode ? (
              <View style={styles.detailRow}>
                <Ionicons name="barcode-outline" size={16} color={COLORS.textDim} />
                <Text style={styles.detailValue} numberOfLines={1}>
                  Package: <Text style={styles.barcodeMono}>{currentStop.barcode}</Text>
                </Text>
              </View>
            ) : null}

            {isInProgress && (
              <View
                style={[
                  styles.gateBox,
                  isWithinArrival ? styles.gateBoxOk : styles.gateBoxWait,
                ]}
              >
                <Ionicons
                  name={isWithinArrival ? 'checkmark-circle' : 'walk-outline'}
                  size={16}
                  color={isWithinArrival ? '#0A8754' : COLORS.textDim}
                />
                <Text style={[styles.gateText, isWithinArrival && { color: '#0A8754' }]}>
                  {isWithinArrival
                    ? 'You are at the stop — ready to scan the package barcode.'
                    : distLabel
                    ? `Drive within 30 m of the stop to unlock scanning · ${distLabel} away`
                    : 'Waiting for GPS to confirm you are at the stop…'}
                </Text>
              </View>
            )}

            {Platform.OS === 'web' && (
              <View style={{ gap: 8, marginTop: 10 }}>
                {isInProgress && !isWithinArrival && (
                  <TouchableOpacity
                    style={styles.simBtn}
                    onPress={() => {
                      setSimulatedAtStop(true);
                      haptic.light();
                    }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="flask-outline" size={14} color={COLORS.navy} />
                    <Text style={styles.simBtnText}>Demo: simulate arrival at this stop</Text>
                  </TouchableOpacity>
                )}

                {/* Web Demo Button to toggle Drowsiness Alert */}
                <TouchableOpacity
                  style={[styles.simBtn, { backgroundColor: '#FEE2E2' }]}
                  onPress={() => {
                    const nextDrowsy = !isDrowsy;
                    setIsDrowsy(nextDrowsy);
                    if (nextDrowsy) setSafeRouteInserted(true);
                    haptic.warning();
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="warning-outline" size={14} color="#991B1B" />
                  <Text style={[styles.simBtnText, { color: '#991B1B' }]}>
                    Demo: Toggle Drowsiness Alert ({isDrowsy ? 'ACTIVE' : 'OFF'})
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        <Text style={styles.allStopsTitle}>All stops</Text>
        <View style={styles.stopsList}>
          {activeStops.map((s, i) => (
            <View key={s.id || i} style={styles.stopRow}>
              <View
                style={[
                  styles.stopDot,
                  s.completed && styles.stopDotDone,
                  i === idx && !s.completed && styles.stopDotActive,
                  s.id === 'emergency_rest_stop' && { backgroundColor: '#EF4444' },
                ]}
              >
                {s.completed ? (
                  <Ionicons name="checkmark" size={12} color="#fff" />
                ) : s.id === 'emergency_rest_stop' ? (
                  <Ionicons name="warning" size={12} color="#fff" />
                ) : (
                  <Text style={[styles.stopDotText, i === idx && { color: '#fff' }]}>{i + 1}</Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.stopAddress, 
                    s.completed && styles.stopAddressDone,
                    s.id === 'emergency_rest_stop' && { color: '#DC2626', fontWeight: '800' }
                  ]}
                  numberOfLines={1}
                >
                  {s.address}
                </Text>
                <Text style={styles.stopMeta}>
                  {s.customer} · {s.type}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.primaryBtn,
            primaryDisabled && { backgroundColor: '#9AA8B2' },
            acting && { backgroundColor: COLORS.tealDark },
            isWithinArrival &&
              !isComplete &&
              activeRoute.status !== 'assigned' &&
              !acting && { backgroundColor: '#0A8754' },
          ]}
          onPress={handlePrimary}
          activeOpacity={0.85}
          disabled={primaryDisabled}
        >
          {acting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              {!isComplete && activeRoute.status === 'in_progress' && (
                <Ionicons
                  name={isWithinArrival ? 'clipboard-outline' : 'lock-closed'}
                  size={18}
                  color="#fff"
                />
              )}
              <Text style={styles.primaryBtnText}>{primaryLabel}</Text>
              {!isComplete && activeRoute.status === 'assigned' && (
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              )}
            </>
          )}
        </TouchableOpacity>
      </View>

      <DeliveryOutcomeModal
        visible={outcomeOpen}
        stop={currentStop}
        injectedBarcode={capturedBarcode}
        onRequestScan={() => setScanOpen(true)}
        onClose={() => setOutcomeOpen(false)}
        onSubmit={handleOutcomeSubmit}
      />

      <BarcodeScanModal
        visible={scanOpen}
        expectedBarcode={currentStop?.barcode}
        stopLabel={currentStop ? `Delivery · ${currentStop.address}` : ''}
        onClose={() => setScanOpen(false)}
        onConfirm={handleScanConfirmed}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },

  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyIcon: {
    width: 88,
    height: 88,
    borderRadius: 22,
    backgroundColor: COLORS.fill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 6 },
  emptySub: { fontSize: 13, color: COLORS.textDim, textAlign: 'center', marginBottom: 22 },
  emptyBtn: { backgroundColor: COLORS.teal, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  emptyBtnText: { color: '#fff', fontWeight: '700' },

  drowsyBanner: {
    backgroundColor: COLORS.danger || '#FF3B30',
    marginHorizontal: 16,
    marginTop: 12,
    padding: 16,
    borderRadius: 16,
  },
  drowsyHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  drowsyTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', letterSpacing: 0.5 },
  drowsySub: { color: '#FFFFFF', fontSize: 13, lineHeight: 18, opacity: 0.9, marginBottom: 12 },
  drowsyBtn: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  drowsyBtnText: { color: COLORS.danger || '#FF3B30', fontWeight: '800', fontSize: 13 },

  progressCard: {
    backgroundColor: COLORS.surface,
    margin: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  progressHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  progressLabel: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  progressText: { fontSize: 11, color: COLORS.textDim, marginTop: 8 },

  locWarn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(217,83,79,0.08)',
    borderColor: 'rgba(217,83,79,0.25)',
    borderWidth: 1,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
  },
  locWarnText: { color: COLORS.danger, fontSize: 12, flex: 1 },

  mapCard: {
    height: 280,
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
    position: 'relative',
  },
  mapCardActive: { height: 380, borderColor: COLORS.teal, borderWidth: 2 },
  mapCardDrowsy: { borderColor: COLORS.danger || '#FF3B30', borderWidth: 3 },
  map: { flex: 1 },
  mapBanner: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    backgroundColor: 'rgba(15,42,61,0.92)',
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mapBannerText: { color: '#fff', fontSize: 12, fontWeight: '600', flex: 1 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.4)' },
  liveDotOn: { backgroundColor: '#1E88FF' },
  legChip: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1E88FF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  legChipText: { color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },

  currentCard: {
    backgroundColor: COLORS.surface,
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 16,
  },
  currentHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  typePill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  pillPickup: { backgroundColor: COLORS.fill },
  pillDropoff: { backgroundColor: COLORS.fill },
  pillText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, color: COLORS.text },
  currentNumber: { fontSize: 12, color: COLORS.textDim, fontWeight: '600' },
  currentAddress: { fontSize: 17, fontWeight: '700', color: COLORS.text, marginBottom: 4 },
  navBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,128,128,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 6,
  },
  navBtnText: { color: COLORS.teal, fontWeight: '700', fontSize: 12 },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 12 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  detailValue: { flex: 1, fontSize: 13, color: COLORS.text },
  barcodeMono: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', web: 'monospace' }),
    fontWeight: '700',
    color: COLORS.teal,
    letterSpacing: 0.4,
  },

  gateBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  gateBoxWait: { backgroundColor: COLORS.fillTertiary, borderColor: COLORS.border },
  gateBoxOk: { backgroundColor: 'rgba(52,199,89,0.10)', borderColor: 'rgba(52,199,89,0.40)' },
  gateText: { flex: 1, fontSize: 12, color: COLORS.textDim, lineHeight: 17 },

  simBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(15,42,61,0.06)',
  },
  simBtnText: { color: COLORS.navy, fontSize: 11, fontWeight: '700' },

  allStopsTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textDim,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginHorizontal: 20,
    marginBottom: 8,
  },
  stopsList: {
    marginHorizontal: 16,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 10,
  },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stopDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopDotActive: { backgroundColor: COLORS.tint },
  stopDotDone: { backgroundColor: COLORS.success },
  stopDotText: { color: COLORS.text, fontSize: 11, fontWeight: '700' },
  stopAddress: { fontSize: 13, color: COLORS.text, fontWeight: '600' },
  stopAddressDone: { textDecorationLine: 'line-through', color: COLORS.textDim },
  stopMeta: { fontSize: 11, color: COLORS.textDim, marginTop: 1 },

  footer: {
    padding: 16,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: COLORS.teal,
    paddingVertical: 16,
    borderRadius: 14,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});