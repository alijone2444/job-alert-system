import React, { createContext, useContext } from 'react';

type AppContextValue = {
  deviceId: string | null;
};

const AppContext = createContext<AppContextValue>({ deviceId: null });

export function AppProvider({
  deviceId,
  children,
}: {
  deviceId: string | null;
  children: React.ReactNode;
}) {
  return <AppContext.Provider value={{ deviceId }}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  return useContext(AppContext);
}
