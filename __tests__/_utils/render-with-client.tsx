import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

/**
 * A fresh QueryClient per test with retries OFF, so error states assert
 * deterministically and tests don't wait on backoff. Never reuse a client
 * across tests — a shared cache leaks state between cases.
 */
export function makeTestClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

export function renderWithClient(
  ui: ReactElement,
  client: QueryClient = makeTestClient()
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...render(ui, { wrapper }) };
}
