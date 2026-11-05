type AuthEvent =
  | { event: 'signed_in' }
  | { event: 'signed_out' }
  | { event: 'sign_in_failed'; email: string; reason?: string };

// Tells the audit log about a sign-in or sign-out (app/api/auth/event/route.ts).
// Never blocks signing in or out, and never carries the password. `keepalive`
// lets it finish while the page navigates away.
export function reportAuthEvent(event: AuthEvent): Promise<void> {
  return fetch('/api/auth/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
    keepalive: true,
  }).then(
    () => undefined,
    () => undefined
  );
}
