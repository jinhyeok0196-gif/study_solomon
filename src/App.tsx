import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { queryClient } from '@/lib/queryClient';
import { AuthProvider } from '@/context/AuthContext';
import { AppRouter } from '@/routes/AppRouter';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { ConfigurationErrorPage } from '@/components/shared/ConfigurationErrorPage';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export function App() {
  if (!isSupabaseConfigured) {
    return <ConfigurationErrorPage />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <ErrorBoundary>
            <AppRouter />
          </ErrorBoundary>
        </BrowserRouter>
      </AuthProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
