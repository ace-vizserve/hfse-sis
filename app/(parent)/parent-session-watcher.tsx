'use client';

import { useEffect } from 'react';

// Best-effort cookie wipe when the parent leaves the SIS. Uses the
// `pagehide` event (fires on tab close + navigation to another origin)
// + navigator.sendBeacon so the POST survives the unload. Does NOT
// fire on Next.js client-side <Link> navigation within /parent/* — only
// on actual page unloads — so in-app navigation between the dashboard
// and a child's report card keeps the cookie intact.
export function ParentSessionWatcher() {
  useEffect(() => {
    const handler = () => {
      navigator.sendBeacon('/api/parent/exit');
    };
    window.addEventListener('pagehide', handler);
    return () => {
      window.removeEventListener('pagehide', handler);
    };
  }, []);
  return null;
}
