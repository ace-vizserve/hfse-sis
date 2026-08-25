-- 123_relief_cover_dates.sql
--
-- Gives relief cover a START and an END date.
--
-- ⚠ READ THIS BEFORE ASSUMING IT REVERSES 117. IT DOES NOT.
--
-- Migration 112 built an `assignment_reliefs` TABLE: its own row per cover, a
-- history of every past cover, a reason code, notes, who arranged it, who ended
-- it, a partial unique index, a SECURITY DEFINER helper to test the window, and
-- four migrations of corrections on top. 117 deleted all of it because the
-- history was machinery for a requirement nobody asked for — `audit_log`
-- already carried it. **That deletion stands. There is still no table.**
--
-- This adds TWO NULLABLE COLUMNS to the assignment row that already exists.
-- No table, no history, no reason code, no notes.
--
-- WHY THE DATES CAME BACK. 117's own header listed what the bare column could
-- not express and accepted the cost:
--
--     "scheduled cover ('starts Monday') — arrange it on Monday"
--
-- That cost has now been called in. Mr Ace, 2026-08-20: "with start and end
-- date added its automatic assignment and revoking of access." Most cover is
-- planned — approved leave, training, an appointment — so it can be arranged
-- once when the leave is granted and then activate and expire itself. A bare
-- toggle needs a human present on both days to remember, twice, per class.
--
-- NULL IS THE BACKWARD-COMPATIBLE CASE, and that is the whole migration story:
--   * relief_started_on IS NULL  → live from whenever it was set;
--   * relief_ended_on   IS NULL  → open-ended, "until Marrie is back".
-- So every existing row keeps behaving exactly as it does today and there is
-- nothing to backfill. Set-the-teacher-and-go stays a valid, one-step flow.
--
-- SEEING A COVER AND ACTING ON ONE ARE DIFFERENT QUESTIONS, and this migration
-- answers them differently. The three access helpers carry the window; the read
-- policy on teacher_assignments does not. So a substitute booked for next week
-- can see they are booked — which is the only way to prepare for it — and can
-- open nothing until their first day. Section 3 and the policy note say more.
--
-- ⚠ THE FAILURE THIS MUST NOT REPEAT IS 115'S, AND IT IS NOT "DATES ARE BAD".
-- It is TWO SOURCES OF TRUTH about who may act on a class: 112 put the window
-- in SQL and the app tested it separately, the two disagreed, and a teacher
-- could act in one layer but not the other. So here there is exactly ONE
-- predicate — `relief_is_live` — and every site that gates ACTION calls it.
-- They do not inline it. The TypeScript half (`isReliefLive`, lib/auth/teacher-assignments.ts)
-- is pinned to this function by __tests__/auth/relief-window-parity.test.ts,
-- which runs the same cases through both and fails if they ever diverge.
--
-- ⚠ AND THE RULE CANNOT LIVE IN SQL ALONE. Five call sites of
-- `loadEffectiveAssignmentsForUser` pass the SERVICE client, which bypasses RLS
-- outright — lib/classroom/queries.ts, lib/attendance/adviser-dashboard-queries.ts,
-- app/api/attendance/daily/route.ts, app/api/attendance/[sectionId]/export/route.ts
-- and app/(classroom)/classroom/page.tsx. A window enforced only by RLS would
-- be silently skipped by all five and a cover scheduled for next week would
-- grant access today. Hence the parity test rather than a single home.
--
-- Idempotent — safe to re-run.

-- ── 1. The columns ─────────────────────────────────────────────────────────

alter table public.teacher_assignments
  add column if not exists relief_started_on date;

alter table public.teacher_assignments
  add column if not exists relief_ended_on date;

comment on column public.teacher_assignments.relief_started_on is
  'First day the substitute named in relief_teacher_user_id may act on this class. NULL means the cover is live from whenever it was set, which is how every row created before migration 123 behaves — so this stays backward-compatible and needs no backfill. A cover whose start date has not arrived yet is SCHEDULED, not active: it must grant no access and must never be displayed as though it does.';

comment on column public.teacher_assignments.relief_ended_on is
  'Last day the substitute may act on this class, inclusive. NULL means open-ended ("until she is back"), which keeps the original enable/disable flow as a special case rather than replacing it. Access stops the day AFTER this date. Clearing relief_teacher_user_id still ends a cover immediately — somebody will want to stop one today rather than backdate an end.';

-- An end before a start is nonsense in any direction. Either being null is
-- fine — those are the two meaningful open cases above.
alter table public.teacher_assignments
  drop constraint if exists teacher_assignments_relief_dates_ordered;
alter table public.teacher_assignments
  add constraint teacher_assignments_relief_dates_ordered
  check (relief_ended_on is null
         or relief_started_on is null
         or relief_ended_on >= relief_started_on);

-- 117's self-cover CHECK is untouched and still applies.

-- ── 2. The ONE predicate ───────────────────────────────────────────────────
--
-- Every SQL site that asks "may this substitute act right now" calls this. Not
-- a copy of it — this. Four copies of a date window is precisely how 115
-- happened.
--
-- `stable`, not `immutable`: it reads the clock, so its answer changes between
-- statements but not within one.
--
-- Asia/Singapore matches the expression 117 already used when it migrated live
-- cover across, and HFSE operates there. `lib/dates.ts` sgToday() is the
-- TypeScript counterpart — same zone, deliberately.

create or replace function public.relief_is_live(
  p_started_on date,
  p_ended_on date
)
returns boolean
language sql
stable
parallel safe
as $$
  select (p_started_on is null
          or p_started_on <= (now() at time zone 'Asia/Singapore')::date)
     and (p_ended_on is null
          or p_ended_on >= (now() at time zone 'Asia/Singapore')::date);
$$;

comment on function public.relief_is_live(date, date) is
  'True when a relief cover window includes today in Asia/Singapore. NULL start = live from whenever set; NULL end = open-ended. The single source of truth for "is this cover live" in SQL — is_teacher_for_section, is_adviser_for_section, is_teacher_for_sheet and the teacher_assignments_scoped_read policy all call it rather than inlining the comparison, because migration 115 exists solely because two copies of this rule disagreed. Its TypeScript twin is isReliefLive in lib/auth/teacher-assignments.ts, pinned by __tests__/auth/relief-window-parity.test.ts.';

-- ⚠ THE POLICY BELOW CALLS THIS, AND POLICIES EVALUATE AS THE CALLER.
-- Without this grant every cookie-scoped read of teacher_assignments fails for
-- ordinary teachers while the service-role staff page shows the same rows fine
-- — which is exactly what migration 114 did to production, and 116 exists only
-- to repair. Do not remove it.
grant execute on function public.relief_is_live(date, date) to authenticated;
grant execute on function public.relief_is_live(date, date) to service_role;

-- ── 3. The three ACCESS sites gain the window ──────────────────────────────
--
-- Each previously tested `ta.relief_teacher_user_id = auth.uid()` bare. The
-- substantive arm (teacher_user_id) is untouched throughout: a teacher's own
-- class has never had a window and does not get one.
--
-- ⚠ THREE, NOT FOUR. The read policy at the bottom of this file also tests the
-- relief column and deliberately does NOT take the window — see the long note
-- there. The split is the point: these three decide what a substitute may DO,
-- the policy decides only what they may SEE.

-- Any assignment in the section — held or covered. Gates students +
-- section_students (the roster).
create or replace function public.is_teacher_for_section(p_section_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.teacher_assignments ta
    where ta.section_id = p_section_id
      and (ta.teacher_user_id = auth.uid()
           or (ta.relief_teacher_user_id = auth.uid()
               and public.relief_is_live(ta.relief_started_on, ta.relief_ended_on)))
  );
$$;

-- Form adviser of the section — held or covered. Gates attendance_records and
-- attendance_daily; taking the register is the substitute's job.
create or replace function public.is_adviser_for_section(p_section_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.teacher_assignments ta
    where ta.section_id = p_section_id
      and ta.role = 'form_adviser'
      and (ta.teacher_user_id = auth.uid()
           or (ta.relief_teacher_user_id = auth.uid()
               and public.relief_is_live(ta.relief_started_on, ta.relief_ended_on)))
  );
$$;

-- The sheet's own subject teacher, or the section's adviser — held or covered.
-- Gates grading_sheets and grade_entries.
create or replace function public.is_teacher_for_sheet(p_sheet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.grading_sheets gs
    join public.teacher_assignments ta
      on ta.section_id = gs.section_id
     and (
       ta.role = 'form_adviser'
       or (ta.role = 'subject_teacher' and ta.subject_id = gs.subject_id)
     )
     and (ta.teacher_user_id = auth.uid()
          or (ta.relief_teacher_user_id = auth.uid()
              and public.relief_is_live(ta.relief_started_on, ta.relief_ended_on)))
    where gs.id = p_sheet_id
  );
$$;

-- A teacher may read their own assignment rows, and any row naming them as the
-- substitute. Without the relief arm a substitute cannot see the class they were
-- given and the effective-assignment loader returns "you are covering nothing"
-- with no error anywhere — the quiet failure 115 was written to fix.
--
-- ⚠ THIS ARM IS DELIBERATELY *NOT* WINDOWED, and it is the one place in this
-- migration where that is true. Do not "fix" it.
--
-- Reading the assignment row is not access to the class. Students, grades and
-- attendance are gated by the three helpers above, which DO carry the window, so
-- a substitute whose cover starts next week can see that they are booked and
-- still open nothing. That is the whole point: they have to know a week early to
-- prepare for it (Mr Ace, 2026-08-24), and Christina's reason for asking about
-- relief at all was so an absent teacher's lesson could be handed over.
--
-- Windowing it here would have forced every "you're covering" screen to read
-- with the SERVICE client to get around our own policy — which is how RLS
-- quietly stops meaning anything.
drop policy if exists teacher_assignments_scoped_read on public.teacher_assignments;
create policy teacher_assignments_scoped_read
  on public.teacher_assignments for select
  to authenticated
  using (
    public.is_registrar_or_above()
    or teacher_user_id = auth.uid()
    or relief_teacher_user_id = auth.uid()
  );
