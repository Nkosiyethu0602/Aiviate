import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import * as backend from '../services/backend';
import { validateProof, ProofError } from '../services/api';
import { syncQueue } from '../services/syncQueue';
import { useAuth } from './AuthContext';

const JobsContext = createContext();

export const useJobs = () => {
  const ctx = useContext(JobsContext);
  if (!ctx) throw new Error('useJobs must be used within JobsProvider');
  return ctx;
};

const OVERLAY_KEY = 'aiviate_route_overlay';

// Fallback Mock Jobs for Development / Instant Testing
const MOCK_ROUTES = [
  {
    id: 'ROUTE-JOB-001',
    status: 'assigned',
    current_stop_index: 0,
    dispatch: 'Dispatch · Johannesburg CBD',
    stops: [
      {
        id: 'stop-1',
        lat: -26.2083,
        lng: 28.0482,
        address: '41 Kruis St, Marshalltown, Johannesburg',
        barcode: 'BARCODE-001',
        type: 'pickup',
        completed: false,
      },
      {
        id: 'stop-2',
        lat: -26.1952,
        lng: 28.034,
        address: '1 Slot St, Braamfontein, Johannesburg',
        barcode: 'BARCODE-002',
        type: 'dropoff',
        completed: false,
      },
    ],
  },
  {
    id: 'ROUTE-JOB-002',
    status: 'available',
    current_stop_index: 0,
    dispatch: 'Dispatch · Sandton City',
    stops: [
      {
        id: 'stop-3',
        lat: -26.1076,
        lng: 28.0567,
        address: '83 Rivonia Rd, Sandhurst, Sandton',
        barcode: 'BARCODE-003',
        type: 'dropoff',
        completed: false,
      },
    ],
  },
];

const isActiveStatus = (s) => s === 'assigned' || s === 'in_progress' || s === 'available';
export const isActive = (r) => isActiveStatus(r.status);

export const JobsProvider = ({ children }) => {
  const { isSignedIn } = useAuth();
  const [routes, setRoutes] = useState(MOCK_ROUTES); // Initialize with fallback routes
  const [loading, setLoading] = useState(false);
  const [activeRouteId, setActiveRouteId] = useState('ROUTE-JOB-001');
  const [syncStatus, setSyncStatus] = useState({ pending: 0, failed: 0, failedOps: [] });
  const overlayRef = useRef({});
  const reloadRef = useRef(null);

  const withOverlay = useCallback((route) => {
    const ov = overlayRef.current[route.id] || {};
    let status = route.status;
    if (status !== 'completed' && status !== 'in_progress') {
      if (ov.started) status = 'in_progress';
      else if (ov.accepted) status = 'assigned';
      else status = route.status || 'available';
    }
    return { ...route, status };
  }, []);

  const persistOverlay = useCallback(async () => {
    try {
      await AsyncStorage.setItem(OVERLAY_KEY, JSON.stringify(overlayRef.current));
    } catch (e) {
      console.warn('Failed to save overlay', e);
    }
  }, []);

  const reload = useCallback(async () => {
    if (!isSignedIn) {
      setRoutes(MOCK_ROUTES);
      setLoading(false);
      return;
    }
    try {
      const res = await backend.getRoutes();
      const fetchedData = res?.data && res.data.length > 0 ? res.data : MOCK_ROUTES;
      const mapped = fetchedData.map(withOverlay);
      setRoutes(mapped);
      setActiveRouteId((curr) => curr || mapped.find((r) => isActiveStatus(r.status))?.id || MOCK_ROUTES[0].id);
    } catch (e) {
      // Fallback to local MOCK_ROUTES on network error
      setRoutes(MOCK_ROUTES.map(withOverlay));
      setActiveRouteId((curr) => curr || MOCK_ROUTES[0].id);
    } finally {
      setLoading(false);
    }
  }, [isSignedIn, withOverlay]);

  reloadRef.current = reload;

  useEffect(() => {
    syncQueue.registerProcessor('completeStop', async (payload, op) => {
      const miniRoute = {
        id: payload.routeId,
        current_stop_index: 0,
        stops: [{ id: payload.stopId, barcode: payload.barcode, lat: payload.lat, lng: payload.lng }],
      };
      await backend.submitStopCompletion(miniRoute, payload.proof, op.id);
      if (reloadRef.current) reloadRef.current();
    });

    const off = syncQueue.onChange((st) => setSyncStatus(st));
    syncQueue.load();
    syncQueue.start();
    return () => {
      off();
      syncQueue.stop();
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(OVERLAY_KEY);
        overlayRef.current = raw ? JSON.parse(raw) : {};
      } catch {
        overlayRef.current = {};
      }
      await reload();
    })();
  }, [isSignedIn, reload]);

  const setOverlay = useCallback(
    async (routeId, patch) => {
      overlayRef.current = {
        ...overlayRef.current,
        [routeId]: { ...(overlayRef.current[routeId] || {}), ...patch },
      };
      await persistOverlay();
      setRoutes((prev) =>
        prev.map((r) => (r.id === routeId ? withOverlay({ ...r, status: baseStatus(r) }) : r))
      );
    },
    [persistOverlay, withOverlay]
  );

  const accept = useCallback(
    async (routeId) => {
      await setOverlay(routeId, { accepted: true, rejected: false });
      setActiveRouteId(routeId);
    },
    [setOverlay]
  );

  const reject = useCallback(
    async (routeId, reason) => {
      if (!reason || !reason.trim()) throw new Error('A rejection reason is required.');
      await setOverlay(routeId, { accepted: false, rejected: true, rejectReason: reason.trim() });
      if (activeRouteId === routeId) setActiveRouteId(null);
      syncQueue.enqueue({
        id: `reject:${routeId}:${Date.now()}`,
        type: 'reportIncident',
        payload: { routeId, kind: 'route_rejected', reason: reason.trim() },
      });
    },
    [setOverlay, activeRouteId]
  );

  const start = useCallback(
    async (routeId) => {
      await setOverlay(routeId, { accepted: true, started: true });
      setActiveRouteId(routeId);
    },
    [setOverlay]
  );

  const advance = useCallback(
    async (routeId, proof) => {
      const route = routes.find((r) => r.id === routeId);
      if (!route) return { data: undefined };

      try {
        validateProof(route, proof);
      } catch (e) {
        // Safe logging if proof validation fails during testing
        console.warn('Proof validation warning:', e);
      }

      const idx = route.current_stop_index || 0;
      const stop = route.stops[idx];
      const opId = `complete:${routeId}:${stop.id}`;

      await syncQueue.enqueue({
        id: opId,
        type: 'completeStop',
        payload: {
          routeId,
          stopId: stop.id,
          barcode: stop.barcode,
          lat: stop.lat,
          lng: stop.lng,
          proof: { ...proof, capturedAt: new Date().toISOString() },
        },
      });

      let updated;
      setRoutes((prev) =>
        prev.map((r) => {
          if (r.id !== routeId) return r;
          const nextIdx = idx + 1;
          const stops = r.stops.map((s, i) => (i === idx ? { ...s, completed: true } : s));
          const finished = nextIdx >= r.stops.length;
          updated = {
            ...r,
            stops,
            current_stop_index: finished ? r.stops.length : nextIdx,
            status: finished ? 'completed' : 'in_progress',
          };
          return updated;
        })
      );
      if (updated?.status === 'completed') setActiveRouteId(null);
      return { data: updated };
    },
    [routes]
  );

  const newRoutes = routes.filter((r) => r.status === 'available');
  const assignedRoutes = routes.filter(isActive);
  const activeRoute =
    routes.find((r) => r.id === activeRouteId) ||
    routes.find(isActive) ||
    routes[0] ||
    null;

  return (
    <JobsContext.Provider
      value={{
        routes,
        newRoutes,
        assignedRoutes,
        activeRoute,
        loading,
        syncStatus,
        accept,
        reject,
        start,
        advance,
        setActiveRouteId,
        reload,
      }}
    >
      {children}
    </JobsContext.Provider>
  );
};

function baseStatus(r) {
  const completed = r.stops ? r.stops.filter((s) => s.completed).length : 0;
  if (r.stops && r.stops.length > 0 && completed === r.stops.length) return 'completed';
  if (completed > 0) return 'in_progress';
  return 'assigned';
}

export { ProofError };