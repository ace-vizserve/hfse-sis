import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';

import { getCurrentAcademicYear } from '@/lib/academic-year';
import { isTestAyCode } from '@/lib/sis/environment';
import { createClient } from '@/lib/supabase/server';

// Renders a thin amber strip at the top of every authenticated module
// shell when the active academic year is a test environment (ay_code
// starts with `AY9`). Returns null in production so the banner disappears
// automatically on switch-to-Production via /sis/admin/settings.
//
// Server component — does its own AY lookup so module layouts don't have
// to plumb anything through. One cheap round-trip per rendered page.
export async function TestModeBanner() {
  const supabase = await createClient();
  const ay = await getCurrentAcademicYear(supabase);
  if (!ay || !isTestAyCode(ay.ay_code)) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex shrink-0 items-center justify-center gap-2 border-b border-brand-amber/40 bg-brand-amber-light px-4 py-1.5 text-[12px] font-medium text-ink print:hidden"
    >
      <AlertTriangle className="size-3.5 shrink-0 text-brand-amber" aria-hidden="true" />
      <span>
        Test environment — data here is disposable.
      </span>
      <Link
        href="/sis/admin/settings"
        className="underline decoration-dotted underline-offset-4 hover:decoration-solid"
      >
        Switch to Production
      </Link>
    </div>
  );
}
