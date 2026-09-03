import { Suspense } from 'react';
import { connection } from 'next/server';

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

/**
 * The Cmd+K palette's data, resolved behind a Suspense boundary.
 *
 * This used to be three awaits at the top of RootLayout, which made the
 * ROOT of the app read `cookies()` — so no route in the app could have a
 * static shell, and every page waited on the session before rendering a
 * pixel. Since the only thing these reads feed is the command palette, and
 * the palette is invisible until someone presses Cmd+K, moving them behind a
 * boundary costs nothing visually and unblocks every route above it.
 *
 * `fallback={null}` for the same reason: there is nothing on screen to stand
 * in for.
 *
 * The two dependent reads are now issued together rather than in sequence.
 */
async function CommandPaletteMount() {
  // Declares this subtree request-time so Cache Components stops trying to
  // prerender it. Needed on top of the Suspense boundary because the
  // assignment lookup below reaches `todaySGT()` (lib/dates.ts), which calls
  // `new Date()` to resolve the relief-cover window — an unstable value that
  // must not be baked into a prerendered shell.
  await connection();

  // Returns null for unauthenticated users (login page, parent-portal SSO
  // landing) — the palette short-circuits in that case.
  //
  // `cache()`d, so a page that has already asked pays nothing.
  const viewer = await getSessionUser();
  const role = viewer?.role ?? null;
  if (!viewer || !role) return null;

  const [hiddenModules, capabilities] = await Promise.all([
    // Same narrowing the switchers apply, so Cmd+K cannot offer a module the
    // tiles have stopped showing. The palette is the FIFTH place modules are
    // offered — see `isHiddenModuleHref`.
    resolveHiddenModules(role, viewer.id),
    // What this viewer may actually DO (KD #166). Some routes admit a role at
    // the prefix and then bounce them on a capability the page requires — the
    // palette must not advertise those.
    getCapabilitiesForRole(role),
  ]);

  return (
    <CommandPalette
      role={role}
      capabilities={capabilities}
      hiddenModules={hiddenModules}
    />
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
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
            <Suspense fallback={null}>
              <CommandPaletteMount />
            </Suspense>
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
