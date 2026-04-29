'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';

// Parent portal → SIS handoff page. Reached from the "View report card"
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
// We do NOT call supabase.auth.setSession() — that would clobber any
// staff Supabase session in the same browser. Instead we POST the access
// token to /api/parent/handoff, which validates it via the service
// client's auth.getUser(jwt), extracts the email, and sets a parallel
// HMAC-signed parent_session cookie. The Supabase auth state in the
// browser is never touched.

export default function ParentEnterPage() {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const hash = window.location.hash.startsWith('#')
        ? window.location.hash.slice(1)
        : window.location.hash;
      const params = new URLSearchParams(hash);
      const accessToken = params.get('access_token');
      const next = params.get('next') ?? undefined;

      if (!accessToken) {
        if (cancelled) return;
        setErrorMessage(
          'This link is missing its access token. Please return to the parent portal and click the report-card button again.',
        );
        return;
      }

      try {
        const res = await fetch('/api/parent/handoff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ access_token: accessToken, next }),
        });
        if (cancelled) return;
        if (!res.ok) {
          setErrorMessage(
            res.status === 401
              ? 'Your parent-portal session has expired. Please return to the parent portal and click the button again.'
              : 'We couldn’t open your report card right now. Please return to the parent portal and try again.',
          );
          return;
        }
        const data = (await res.json()) as { redirect_to?: string };
        const redirectTo =
          typeof data.redirect_to === 'string' && data.redirect_to ? data.redirect_to : '/parent';
        // Full reload so the parent layout's SSR run picks up the new
        // parent_session cookie. router.replace() would race the cookie
        // visibility on some hosting environments.
        window.location.replace(redirectTo);
      } catch {
        if (cancelled) return;
        setErrorMessage(
          'Something went wrong opening your report card. Please return to the parent portal and try again.',
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const parentPortalUrl =
    process.env.NEXT_PUBLIC_PARENT_PORTAL_URL ??
    'https://enrol.hfse.edu.sg/admission/dashboard';

  if (!errorMessage) {
    return (
      <PageShell className="max-w-md">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <div className="font-serif text-lg font-semibold text-foreground">
              Opening report card…
            </div>
            <p className="text-sm text-muted-foreground">
              One moment while we verify your access.
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
            Couldn&rsquo;t verify your access
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">{errorMessage}</p>
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
