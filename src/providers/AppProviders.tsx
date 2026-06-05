import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { AuthProvider } from '../auth/AuthContext';
import { NetworkActivityProvider } from './NetworkActivityProvider';

const queryClient = new QueryClient();

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      <NetworkActivityProvider>
        <AuthProvider>{children}</AuthProvider>
      </NetworkActivityProvider>
    </QueryClientProvider>
  );
}
