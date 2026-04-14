'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';

// Parent portal → markbook handoff page. Reached from the "View report card"
// button on https://enrol.hfse.edu.sg/admission/dashboard. Expects the
// parent's current Supabase session tokens in the URL fragment:
//
//   /parent/enter#access_token=<jwt>&refresh_token=<jwt>&next=/parent/...
//
// Fragments are NEVER sent to the server (not in Referer, not in access
// logs, not in proxy logs), so the tokens only touch the two trusted
// origins. This page is a client component by necessity — the fragment is
// only readable in the browser.
//
// On successful setSession, the markbook's browser client writes the
// sb-*-auth-token cookies via the @supabase/ssr adapter, and the
// subsequent router.replace to `next` hits proxy.ts with a valid session.

// Anything outside the /parent namespace is rejected to close the
// open-redirect hole that a naive redirect would open.
function safeNext(raw: string | null): string {
  if (!raw) return '/parent';
  if (raw === '/parent' || raw.startsWith('/parent/')) return raw;
  return '/parent';
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string };

export default function ParentEnterPage() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;

    // All state transitions inside the async IIFE so the react-hooks/set-
    // state-in-effect rule is satisfied (no synchronous setState during
    // effect render pass).
    (async () => {
      // Pull tokens out of the fragment and immediately hand them to
      // setSession. We avoid any logging / telemetry / network fetch with
      // them. The only consumer is supabase.auth.setSession().
      const hash = window.location.hash.startsWith('#')
        ? window.location.hash.slice(1)
        : window.location.hash;
      const params = new URLSearchParams(hash);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const next = safeNext(params.get('next'));

      if (!accessToken || !refreshToken) {
        if (cancelled) return;
        setState({
          kind: 'error',
          message:
            'This handoff link is missing its session tokens. Return to the parent portal and try again.',
        });
        return;
      }

      try {
        const supabase = createClient();
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (cancelled) return;
        if (error) {
          setState({
            kind: 'error',
            message:
              'Your session has expired. Please return to the parent portal and click the button again.',
          });
          return;
        }
        // router.replace navigates to a fragment-less URL, so the tokens
        // drop out of the browser's visible URL and history entry.
        router.replace(next);
      } catch {
        if (cancelled) return;
        setState({
          kind: 'error',
          message:
            'Something went wrong signing you in. Please return to the parent portal and try again.',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const parentPortalUrl =
    process.env.NEXT_PUBLIC_PARENT_PORTAL_URL ??
    'https://enrol.hfse.edu.sg/admission/dashboard';

  if (state.kind === 'loading') {
    return (
      <PageShell className="max-w-md">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <div className="font-serif text-lg font-semibold text-foreground">
              Signing you in…
            </div>
            <p className="text-sm text-muted-foreground">
              One moment while we open your child&apos;s report card.
            </p>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell className="max-w-md">
      <header className="space-y-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Parent portal
        </p>
        <h1 className="font-serif text-[28px] font-semibold leading-[1.1] tracking-tight text-foreground">
          Can&rsquo;t open report card.
        </h1>
      </header>

      <div className="flex items-start gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground shadow-brand-tile">
          <AlertCircle className="size-4" />
        </div>
        <div className="flex-1 space-y-1.5">
          <p className="font-serif text-base font-semibold leading-tight text-foreground">
            Sign-in failed
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">{state.message}</p>
        </div>
      </div>

      <Button asChild className="w-full">
        <a href={parentPortalUrl}>
          <ArrowLeft className="h-4 w-4" />
          Back to parent portal
        </a>
      </Button>
    </PageShell>
  );
}
