// src/contexts/JobsContext.js
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { sql } from '../services/neon';
import { validateProof, ProofError } from '../services/api';
import { useAuth } from './AuthContext';

const JobsContext = createContext();

export const useJobs = () => {
  const ctx = useContext(JobsContext);
  if (!ctx) throw new Error('useJobs must be used within JobsProvider');
  return ctx;
};

const OVERLAY_KEY = 'aiviate_route_overlay';

const isActiveStatus = (s) => s === 'assigned' || s === 'in_progress';
export const isActive = (r) => isActiveStatus(r.status);

export const JobsProvider = ({ children }) => {
  const { user, status } = useAuth();
  const isSignedIn = status === 'signedIn' || !!user;
  const [routes, setRoutes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeRouteId, setActiveRouteId] = useState(null);
  const overlayRef = useRef({});
  const reloadRef = useRef(null);

  const withOverlay = useCallback((route) => {
    const ov = overlayRef.current[route.id] || {};
    let st = route.status;
    if (st !== 'completed' && st !== 'in_progress') {
      if (ov.started) st = 'in_progress';
      else if (ov.accepted) st = 'assigned';
      else st = 'available';
    }

    const defaultStops = route.center_lat && route.center_lng ? [{
      id: `${route.id}-stop-1`,
      lat: route.center_lat,
      lng: route.center_lng,
      latitude: Number(route.center_lat),
      longitude: Number(route.center_lng),
      barcode: route.area || 'Delivery Stop',
      completed: false,
    }] : [];

    const validStops = Array.isArray(route.stops) && route.stops.length > 0 ? route.stops : defaultStops;

    return { 
      ...route, 
      stops: validStops,
      current_stop_index: route.current_stop_index || 0,
      status: st 
    };
  }, []);

  const persistOverlay = useCallback(async () => {
    await AsyncStorage.setItem(OVERLAY_KEY, JSON.stringify(overlayRef.current));
  }, []);

  // Fetch jobs and stops directly from Neon database with map coordinates
  const reload = useCallback(async () => {
    if (!isSignedIn || !user) { 
      setRoutes([]); 
      setLoading(false); 
      return; 
    }

    try {
      setLoading(true);
      const driverId = user.driver_id || user.id;

      const jobRows = await sql`
        SELECT * FROM jobs 
        WHERE driver_id = ${driverId} 
        ORDER BY created_at DESC;
      `;

      const safeJobs = Array.isArray(jobRows) ? jobRows : [];

      if (safeJobs.length > 0) {
        const jobIds = safeJobs.map(j => j.id);

        const stopRows = await sql`
          SELECT * FROM stops 
          WHERE job_id = ANY(${jobIds}) 
          ORDER BY stop_number ASC;
        `;

        const safeStops = Array.isArray(stopRows) ? stopRows : [];

        const stopsByJobId = {};
        for (const stop of safeStops) {
          if (!stopsByJobId[stop.job_id]) {
            stopsByJobId[stop.job_id] = [];
          }
          stopsByJobId[stop.job_id].push({
            id: stop.id,
            lat: stop.lat,
            lng: stop.lng,
            latitude: Number(stop.lat),   // Required by react-native-maps
            longitude: Number(stop.lng), // Required by react-native-maps
            barcode: stop.address || stop.customer_name || 'Stop',
            address: stop.address,
            customer_name: stop.customer_name,
            phone: stop.phone,
            notes: stop.notes,
            completed: stop.completed || false,
            stop_number: stop.stop_number,
          });
        }

        for (const job of safeJobs) {
          job.stops = stopsByJobId[job.id] || [];
          job.total_stops = job.stops.length;
          
          // Compute current stop index based on completed stops in DB
          const completedCount = job.stops.filter(s => s.completed).length;
          job.current_stop_index = completedCount;
        }
      }

      const mapped = safeJobs.map(withOverlay);
      setRoutes(mapped);
      setActiveRouteId((curr) => curr || mapped.find((r) => r.status === 'in_progress')?.id || null);
    } catch (e) {
      console.warn('Failed to fetch jobs/stops from Neon:', e.message);
      setRoutes([]);
    } finally {
      setLoading(false);
    }
  }, [isSignedIn, user, withOverlay]);

  reloadRef.current = reload;

  useEffect(() => {
    (async () => {
      if (!isSignedIn) { setRoutes([]); setLoading(false); return; }
      try {
        const raw = await AsyncStorage.getItem(OVERLAY_KEY);
        overlayRef.current = raw ? JSON.parse(raw) : {};
      } catch { overlayRef.current = {}; }
      setLoading(true);
      await reload();
    })();
  }, [isSignedIn, reload]);

  const setOverlay = useCallback(async (routeId, patch) => {
    overlayRef.current = {
      ...overlayRef.current,
      [routeId]: { ...(overlayRef.current[routeId] || {}), ...patch },
    };
    await persistOverlay();
    setRoutes((prev) => (Array.isArray(prev) ? prev.map((r) => (r.id === routeId ? withOverlay(r) : r)) : []));
  }, [persistOverlay, withOverlay]);

  const accept = useCallback(async (routeId) => {
    await setOverlay(routeId, { accepted: true, rejected: false });
    setActiveRouteId(routeId);
  }, [setOverlay]);

  const reject = useCallback(async (routeId, reason) => {
    if (!reason || !reason.trim()) throw new Error('A rejection reason is required.');
    await setOverlay(routeId, { accepted: false, rejected: true, rejectReason: reason.trim() });
    if (activeRouteId === routeId) setActiveRouteId(null);
  }, [setOverlay, activeRouteId]);

  const start = useCallback(async (routeId) => {
    await setOverlay(routeId, { accepted: true, started: true });
    setActiveRouteId(routeId);

    // Update job status to in_progress in Neon
    try {
      await sql`
        UPDATE jobs 
        SET status = 'in_progress', started_at = NOW() 
        WHERE id = ${routeId};
      `;
    } catch (err) {
      console.error('Failed to update job start status in Neon:', err);
    }
  }, [setOverlay]);

  // ADVANCE / COMPLETE STOP with direct Neon database merge/update
  const advance = useCallback(async (routeId, proof) => {
    const route = (routes || []).find((r) => r.id === routeId);
    if (!route) return { data: undefined };

    const idx = route.current_stop_index || 0;
    const stop = route.stops[idx];

    try {
      // 1. Mark stop as completed in Neon database
      if (stop && stop.id && !stop.id.includes('-stop-1')) {
        await sql`
          UPDATE stops 
          SET completed = true, completed_at = NOW(), status = 'completed'
          WHERE id = ${stop.id};
        `;
      }

      const nextIdx = idx + 1;
      const totalStops = route.total_stops || route.stops.length;
      const finished = nextIdx >= totalStops;
      const newStatus = finished ? 'completed' : 'in_progress';

      // 2. Update job status in Neon database
      await sql`
        UPDATE jobs 
        SET status = ${newStatus}, completed_at = ${finished ? sql`NOW()` : null}
        WHERE id = ${routeId};
      `;

      // 3. Optimistic local state update
      let updated;
      setRoutes((prev) => (Array.isArray(prev) ? prev.map((r) => {
        if (r.id !== routeId) return r;
        const stops = r.stops.map((s, i) => (i === idx ? { ...s, completed: true } : s));
        updated = { ...r, stops, current_stop_index: finished ? totalStops : nextIdx, status: newStatus };
        return updated;
      }) : []));

      if (updated?.status === 'completed') setActiveRouteId(null);
      return { data: updated };
    } catch (err) {
      console.error('Error executing stop completion in Neon:', err);
      throw err;
    }
  }, [routes]);

  const newRoutes = (routes || []).filter((r) => r.status === 'available');
  const assignedRoutes = (routes || []).filter(isActive);
  const activeRoute =
    (routes || []).find((r) => r.id === activeRouteId) ||
    (routes || []).find(isActive) ||
    null;

  return (
    <JobsContext.Provider
      value={{
        routes: routes || [],
        newRoutes: newRoutes || [],
        assignedRoutes: assignedRoutes || [],
        activeRoute,
        loading,
        syncStatus: { pending: 0, failed: 0, failedOps: [] },
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

export { ProofError };