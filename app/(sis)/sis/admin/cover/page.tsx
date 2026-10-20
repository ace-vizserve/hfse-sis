import { redirect } from 'next/navigation';

import { BookCoverDialog } from '@/components/relief/book-cover-dialog';
import { CoverTable } from '@/components/relief/cover-table';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { PageShell } from '@/components/ui/page-shell';
import { listAyCodes } from '@/lib/academic-year';
import { can } from '@/lib/auth/capabilities';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import { getTeacherList } from '@/lib/auth/staff-list';
import { sgToday } from '@/lib/dates';
import { getCoverBoard } from '@/lib/relief/cover-board';
import { getCoverHistory } from '@/lib/relief/cover-history';
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
//
// One table, three tabs (2026-10-20): Active now and Scheduled are today's live
// board; History is every finished absence in the year picked with `?ay=`,
// rebuilt from the audit log (`lib/relief/cover-history.ts`), because stopping
// a cover early wipes its window from the row.
export default async function CoverPage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');

  // Same capability the write gates on, so the page can never show a board
  // whose controls all refuse (KD #175 — the link layer gates like the page).
  const capabilities = sessionUser.role
    ? await getCapabilitiesForRole(sessionUser.role)
    : [];
  if (!can(capabilities, 'staff.manage_relief')) redirect('/sis');

  const supabase = await createClient();
  const [{ data: ayRow }, ayCodes, { ay: ayParam }] = await Promise.all([
    supabase
      .from('academic_years')
      .select('id, ay_code')
      .eq('is_current', true)
      .single(),
    listAyCodes(supabase),
    searchParams,
  ]);
  const current = ayRow as { id: string; ay_code: string } | null;
  if (!current?.id) redirect('/sis');
  const ayId = current.id;
  // History's year. Anything not a real year falls back to the current one.
  const historyAy =
    ayParam && ayCodes.includes(ayParam) ? ayParam : current.ay_code;

  const today = sgToday();
  // Anyone on staff can stand in, not only accounts whose role is `teacher` —
  // this list has to match what POST /api/relief/book will accept. Active
  // accounts only (the helper's default): a substitute who cannot sign in
  // cannot take the register.
  const [board, historyRead, teachers] = await Promise.all([
    getCoverBoard(ayId, today),
    getCoverHistory(historyAy, today),
    getTeacherList(),
  ]);
  const teacherOptions = teachers.map((t) => ({ id: t.id, name: t.name }));

  return (
    <PageShell>
      <SisPageHeader
        group="Staffing"
        title="Cover."
        description="Who is standing in for an absent teacher, who is booked to, and how each past cover ended. Booking one covers every class that teacher holds — they stay the name on report cards and mark sheets throughout."
        actions={<BookCoverDialog teacherOptions={teacherOptions} />}
      />

      <CoverTable
        board={{ active: board.active, scheduled: board.scheduled }}
        history={historyRead.rows}
        historyFailed={historyRead.failed}
        today={today}
        ayCode={historyAy}
        ayOptions={ayCodes}
        teacherOptions={teacherOptions}
      />
    </PageShell>
  );
}
