import { redirect } from 'next/navigation';

import { CoverBoardView } from '@/components/relief/cover-board-view';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { PageShell } from '@/components/ui/page-shell';
import { can } from '@/lib/auth/capabilities';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import { getTeacherList } from '@/lib/auth/staff-list';
import { sgToday } from '@/lib/dates';
import { getCoverBoard, RECENTLY_ENDED_DAYS } from '@/lib/relief/cover-board';
import { createClient, getSessionUser } from '@/lib/supabase/server';

// Who is standing in, who is booked to, and what is about to run out.
//
// WHY THIS PAGE EXISTS AT ALL. With a bare on/off switch it did not need to:
// you set cover while looking at the class, because you were already there, and
// nothing was ever pending. Dates broke that — a cover booked on Monday for the
// following week is invisible to everyone until it fires, so "who is covering
// tomorrow" and "is anything about to lapse" became real questions with nowhere
// to be asked.
//
// It WRITES as well as reports (Mr Ace, 2026-08-21: "its a working page not just
// for monitoring"), and it does the one thing a class row cannot — book a
// teacher's whole absence in a single action.
//
// Christina asked for the same page independently on 2026-08-21, framing it as
// part of a teachers' dashboard so a substitute could look up the lesson. That
// framing is NOT built here: this is the administrator's view, gated on
// `staff.manage_relief`. The substitute's own half is the "You're covering"
// panel on home and the module indexes.
export default async function CoverPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');

  // Same capability the write gates on, so the page can never show a board
  // whose controls all refuse (KD #175 — the link layer gates like the page).
  const capabilities = sessionUser.role
    ? await getCapabilitiesForRole(sessionUser.role)
    : [];
  if (!can(capabilities, 'staff.manage_relief')) redirect('/sis');

  const supabase = await createClient();
  const { data: ayRow } = await supabase
    .from('academic_years')
    .select('id')
    .eq('is_current', true)
    .single();
  const ayId = (ayRow as { id: string } | null)?.id;
  if (!ayId) redirect('/sis');

  const today = sgToday();
  const [board, teachers] = await Promise.all([
    getCoverBoard(ayId, today),
    getTeacherList(),
  ]);

  return (
    <PageShell>
      <SisPageHeader
        group="Staffing"
        title="Cover."
        description="Who is standing in for an absent teacher, who is booked to, and what is about to run out. Booking one covers every class that teacher holds — they stay the name on report cards and mark sheets throughout."
      />

      <CoverBoardView
        board={board}
        teacherOptions={teachers.map((t) => ({ id: t.id, name: t.name }))}
        recentlyEndedDays={RECENTLY_ENDED_DAYS}
      />
    </PageShell>
  );
}
