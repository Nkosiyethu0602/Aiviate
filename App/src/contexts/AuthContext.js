// Authentication state for the Driver App (Bypassed for Testing/Development)

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';

import * as backend from '../services/backend';
import { ApiError, setUnauthorizedHandler } from '../services/http';
import { saveSession, clearSession } from '../services/session';

const AuthContext = createContext(null);

// Mock user details to bypass login checks
const MOCK_DRIVER = {
  id: 'driver-99',
  name: 'Test Driver',
  email: 'driver@Aiviate.com',
  role: 'driver',
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

export const AuthProvider = ({ children }) => {
  // BYPASS: Default immediately to 'signedIn' instead of 'restoring'
  const [status, setStatus] = useState('signedIn');
  const [user, setUser] = useState(MOCK_DRIVER);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  const applySignedIn = useCallback(async ({ token, user: u }) => {
    await saveSession({ token, user: u });
    if (!mounted.current) return;
    setUser(u);
    setStatus('signedIn');
  }, []);

  const signOut = useCallback(async () => {
    await clearSession();
    if (!mounted.current) return;
    setUser(null);
    setStatus('signedOut');
  }, []);

  // Wire HTTP client (disabled 401 redirect during bypass so app stays signed in)
  useEffect(() => {
    // setUnauthorizedHandler(() => { signOut(); });
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  // BYPASS: Disabled the initial server/token restore check
  useEffect(() => {
    // Restoring logic bypassed for instant entry to map/routes.
  }, []);

  const signIn = useCallback(async (email, password) => {
    setUser(MOCK_DRIVER);
    setStatus('signedIn');
    return { ok: true };
  }, []);

  const activate = useCallback(async ({ token, password }) => {
    setUser(MOCK_DRIVER);
    setStatus('signedIn');
    return { ok: true };
  }, []);

  const forgotPassword = useCallback(async (email) => {
    return { ok: true };
  }, []);

  const value = {
    status,
    user,
    isSignedIn: true, // BYPASS: Always true
    signIn,
    signOut,
    activate,
    forgotPassword,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthProvider;