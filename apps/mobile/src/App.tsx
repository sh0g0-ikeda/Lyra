import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MobileQueryFocusBridge } from './components/MobileQueryFocusBridge';
import { createMobileQueryClient } from './lib/queryClient';
import { FoundationNavigator } from './navigation/FoundationNavigator';
import { AuthSessionProvider } from './state/AuthSessionProvider';

export default function App(): React.JSX.Element {
  const [queryClient] = useState(createMobileQueryClient);
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <MobileQueryFocusBridge />
          <AuthSessionProvider>
            <FoundationNavigator />
          </AuthSessionProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
