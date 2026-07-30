import { CalendarRange } from 'lucide-react';

import { getCurrentAcademicYear } from '@/lib/academic-year';
import { createClient } from '@/lib/supabase/server';

// Always-present strip at the top of every authenticated module shell.
// Neutral passive context label — the AY code + label inline via the
// CalendarRange icon — so admins always know which AY they're operating
// on without scrolling to a header badge.
//
// Renders null only if `getCurrentAcademicYear()` returns null (no AY
// row marked is_current — broken setup state, banner can't help).
//
// Server component — does its own AY lookup so module layouts don't have
// to plumb anything through. One cheap round-trip per rendered page,
// deduped within the request via the React.cache wrapper inside
// getCurrentAcademicYear().
export async function AyBanner() {
  const supabase = await createClient();
  const ay = await getCurrentAcademicYear(supabase);
  if (!ay) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex shrink-0 items-center justify-center gap-3 border-b border-hairline bg-muted/40 px-4 py-2 text-ink print:hidden"
    >
      <div className="flex size-5 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-sm">
        <CalendarRange className="size-3" aria-hidden="true" />
      </div>
      <div className="flex items-center gap-2 text-[12px]">
        <span className="font-mono font-semibold uppercase tracking-[0.14em] text-ink">
          Academic year
        </span>
        <span className="font-mono text-ink-4" aria-hidden="true">
          ·
        </span>
        <span className="font-mono font-semibold tabular-nums text-ink-2">
          {ay.ay_code}
        </span>
        <span className="font-mono text-ink-4" aria-hidden="true">
          ·
        </span>
        <span className="text-ink-3">{ay.label}</span>
      </div>
    </div>
  );
}
