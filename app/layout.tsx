import { Toaster } from '@/components/ui/sonner';
import type { Metadata } from 'next';
import { Inter, JetBrains_Mono, Source_Serif_4 } from 'next/font/google';
import NextTopLoader from 'nextjs-toploader';
import './globals.css';

import {
  CommandPalette,
  CommandPaletteProvider,
} from '@/components/sis/command-palette';
import { QueryProvider } from '@/components/providers/query-provider';
import { ScreenGuard } from '@/components/ui/screen-guard';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import { getSessionUser } from '@/lib/supabase/server';
import { resolveHiddenModules } from '@/lib/sidebar/resolve-hidden-modules';

const inter = Inter({
  variable: '--font-sans',
  subsets: ['latin'],
});

const sourceSerif = Source_Serif_4({
  variable: '--font-serif',
  subsets: ['latin'],
});

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: {
    default: 'HFSE SIS',
    template: '%s · HFSE SIS',
  },
  description: 'HFSE International School student information system',
  robots: { index: false, follow: false, nocache: true },
  icons: { icon: '/hfse-logo-favicon.webp' },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Resolve role server-side for the global Cmd+K command palette so the
  // navigation results are role-gated via the same isRouteAllowed() rules
  // the proxy + sidebar use. Returns null for unauthenticated users (login
  // page, parent-portal SSO landing) — palette short-circuits in that case.
  const sessionUser = await getSessionUser();
  const role = sessionUser?.role ?? null;
  // Same assignment-based narrowing the switchers apply, so Cmd+K can't offer
  // a module the tiles have stopped showing.
  const hiddenModules = sessionUser
    ? await resolveHiddenModules(role, sessionUser.id)
    : [];
  // What this viewer may actually DO (KD #166). Some routes admit a role at the
  // prefix and then bounce them on a capability the page requires — the palette
  // must not advertise those.
  const capabilities = sessionUser ? await getCapabilitiesForRole(role) : [];

  return (
    <html
      lang="en"
      className={`${inter.variable} ${sourceSerif.variable} ${jetbrainsMono.variable} h-full`}
    >
      <body className="min-h-full bg-background text-foreground flex flex-col">
        <NextTopLoader
          color="var(--av-indigo)"
          height={3}
          showSpinner={false}
          shadow="0 0 8px var(--av-indigo), 0 0 3px var(--av-indigo)"
        />
        <QueryProvider>
          <CommandPaletteProvider>
            {children}
            {role && (
              <CommandPalette
                role={role}
                capabilities={capabilities}
                hiddenModules={hiddenModules}
              />
            )}
          </CommandPaletteProvider>
          <ScreenGuard />
          <Toaster
            theme="light"
            position="top-center"
            richColors
            closeButton
            options={{
              fill: 'black',
              styles: {
                title: 'text-white!',
                description: 'text-white/75!',
              },
            }}
          />
        </QueryProvider>
      </body>
    </html>
  );
}
