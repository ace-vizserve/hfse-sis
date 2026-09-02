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
import { getViewContext } from '@/lib/auth/view-context';
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
  // ⚠ `getViewContext()` RATHER THAN `getSessionUser()` (role-switcher Phase
  // 3c). It is the same session read with the active-role lens resolved on top,
  // and it is `cache()`d, so a page that has already asked pays nothing. The
  // palette is the FIFTH place modules are offered (see `isHiddenModuleHref`),
  // and until now it was the one that did not follow the view: Phase 3b hid the
  // SIS, Records, P-Files and Admissions tiles in the Teacher view, and Cmd+K
  // went on listing their pages.
  const viewer = await getViewContext();
  const role = viewer?.role ?? null;
  if (!viewer || !role) return null;
  const viewRole = viewer.activeRole ?? role;

  const [hiddenModules, capabilities] = await Promise.all([
    // Same narrowing the switchers apply, so Cmd+K can't offer a module the
    // tiles have stopped showing — now including the route-shaped half the
    // lens adds (`hiddenModulesForView`).
    resolveHiddenModules(role, viewer.id, viewRole),
    // What this viewer may actually DO (KD #166). Some routes admit a role at
    // the prefix and then bounce them on a capability the page requires — the
    // palette must not advertise those.
    //
    // ⚠ ON THE REAL ROLE, ALWAYS. Capabilities are never lensed anywhere in the
    // app: they are the account's grant set, and a chosen view cannot add to or
    // take from what the page will demand on arrival.
    getCapabilitiesForRole(role),
  ]);

  return (
    <CommandPalette
      role={role}
      capabilities={capabilities}
      hiddenModules={hiddenModules}
      viewRole={viewRole}
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
