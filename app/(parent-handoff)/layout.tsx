import type { Metadata } from 'next';

// Auth-free layout for the parent SSO handoff page. Lives in its own
// route group so /parent/enter escapes the (parent) layout's
// getSessionUser() gate — the SSO tokens arrive in the URL fragment
// (client-only) and only get applied after setSession() runs in the
// browser, so any server-side cookie check would short-circuit before
// the handoff completes and bounce the parent to /login.

export const metadata: Metadata = {
  title: 'Opening report card',
};

export default function ParentHandoffLayout({ children }: { children: React.ReactNode }) {
  return <main className="min-h-dvh bg-muted">{children}</main>;
}
