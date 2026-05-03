'use client';

import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

// "Back to parent portal" trigger in the parent layout's top header. The
// SIS report-cards surface is one branch off the parent portal; this
// button is the way back. Under the hood it still clears the
// parent_session cookie via `/api/parent/exit` so a co-resident staff
// Supabase session in a shared browser stays untouched (KD #65) — the
// framing is "navigate back to where you came from" rather than "sign
// out", but the cookie hygiene is the same.
export function ParentSignoutButton() {
  const [busy, setBusy] = useState(false);

  async function backToPortal() {
    setBusy(true);
    try {
      await fetch('/api/parent/exit', { method: 'POST', credentials: 'same-origin' });
    } catch {
      // Best-effort. If the network call fails, the cookie's 2h TTL will
      // expire it on its own — no need to block the redirect.
    }
    const portalUrl =
      process.env.NEXT_PUBLIC_PARENT_PORTAL_URL ??
      'https://enrol.hfse.edu.sg/admission/dashboard';
    window.location.href = portalUrl;
  }

  return (
    <Button variant="outline" size="sm" onClick={backToPortal} disabled={busy}>
      <ArrowLeft className="size-3.5" />
      Back to parent portal
    </Button>
  );
}
