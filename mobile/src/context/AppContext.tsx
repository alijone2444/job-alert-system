import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  AuthUser,
  configureGoogleSignIn,
  getIdToken,
  signOut as doSignOut,
  subscribeToAuth,
} from '../services/auth';
import { setTokenProvider } from '../api/client';
import { logger } from '../utils/logger';

type AppContextValue = {
  /** The id every API call and Firestore path is keyed by (the Firebase uid). */
  userId: string | null;
  user: AuthUser | null;
  /** Still resolving the persisted auth session on launch. */
  initializing: boolean;
  signOut: () => Promise<void>;
  /** Set by App after push setup — only used to migrate pre-auth device data. */
  deviceId: string | null;
  setDeviceId: (deviceId: string) => void;
};

const AppContext = createContext<AppContextValue>({
  userId: null,
  user: null,
  initializing: true,
  signOut: async () => {},
  deviceId: null,
  setDeviceId: () => {},
});

/**
 * Holds the signed-in identity.
 *
 * `userId` is the Firebase uid. Every screen, service and Firestore path reads
 * it from here, so exactly one place decides who "the user" is — which is what
 * made replacing the device id with a real account a local change instead of a
 * rewrite.
 */
export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  useEffect(() => {
    configureGoogleSignIn();

    // The API client PULLS a fresh token before each request rather than being
    // handed one — ID tokens expire hourly, and a cached copy would start
    // returning 401 an hour into a session.
    setTokenProvider(getIdToken);

    return subscribeToAuth((nextUser) => {
      setUser(nextUser);
      setInitializing(false);
    });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await doSignOut();
    } catch (error) {
      logger.error('App', 'Sign-out failed', error);
    }
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      userId: user?.uid ?? null,
      user,
      initializing,
      deviceId,
      setDeviceId,
      signOut,
    }),
    [user, initializing, deviceId, signOut]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  return useContext(AppContext);
}
