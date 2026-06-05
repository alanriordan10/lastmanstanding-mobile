import type { PropsWithChildren } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';

type NetworkActivityContextValue = {
  slowRequestActive: boolean;
};

const NetworkActivityContext = createContext<NetworkActivityContextValue>({ slowRequestActive: false });

export function useNetworkActivity() {
  return useContext(NetworkActivityContext);
}

export function NetworkActivityProvider({ children }: PropsWithChildren) {
  const [slowRequestIds, setSlowRequestIds] = useState<Set<number>>(new Set());

  const removeSlowRequest = useCallback((id?: number) => {
    if (id == null) return;
    setSlowRequestIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  useEffect(() => {
    let nextRequestId = 1;

    const requestInterceptor = api.interceptors.request.use((config) => {
      const requestId = nextRequestId++;
      (config as any).metadata = { ...((config as any).metadata ?? {}), requestId };
      const timer = setTimeout(() => {
        setSlowRequestIds((current) => new Set(current).add(requestId));
      }, 3000);
      (config as any).metadata.slowTimer = timer;
      return config;
    });

    const responseInterceptor = api.interceptors.response.use(
      (response) => {
        const metadata = (response.config as any).metadata;
        clearTimeout(metadata?.slowTimer);
        removeSlowRequest(metadata?.requestId);
        return response;
      },
      (error) => {
        const metadata = (error?.config as any)?.metadata;
        clearTimeout(metadata?.slowTimer);
        removeSlowRequest(metadata?.requestId);
        return Promise.reject(error);
      },
    );

    return () => {
      api.interceptors.request.eject(requestInterceptor);
      api.interceptors.response.eject(responseInterceptor);
    };
  }, [removeSlowRequest]);

  const value = useMemo(() => ({ slowRequestActive: slowRequestIds.size > 0 }), [slowRequestIds.size]);

  return (
    <NetworkActivityContext.Provider value={value}>
      {children}
    </NetworkActivityContext.Provider>
  );
}
