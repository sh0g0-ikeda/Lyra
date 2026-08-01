import NetInfo from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from 'react';

import type { UiLanguage } from '@/domain/types';
import { normalizeNetworkOnline } from '@/lib/networkStatus';

interface NetworkStatusContextValue {
  language: UiLanguage;
  online: boolean;
}

interface NetworkStatusProviderProps extends PropsWithChildren {
  language: UiLanguage;
}

const NetworkStatusContext = createContext<NetworkStatusContextValue>({
  language: 'ja',
  online: true
});

export function NetworkStatusProvider({
  children,
  language
}: NetworkStatusProviderProps): React.JSX.Element {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const nextOnline = normalizeNetworkOnline(state);
      setOnline(nextOnline);
      onlineManager.setOnline(nextOnline);
    });
    return unsubscribe;
  }, []);

  const value = useMemo(() => ({ language, online }), [language, online]);
  return (
    <NetworkStatusContext.Provider value={value}>
      {children}
    </NetworkStatusContext.Provider>
  );
}

export function useNetworkStatus(): NetworkStatusContextValue {
  return useContext(NetworkStatusContext);
}
