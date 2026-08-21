-- 120_student_discipline_records.sql
--
-- Disciplinary records (action item #7, 2026-07-31 academics training).
-- Christina, 18:20: "What about records of disciplinary actions? Because we
-- file incident reports, and then if we click the name of the student, I was
-- hoping we can also find those incidents that the student was involved in for
-- the whole year. Whether the student received a warning letter or suspension
-- or any disciplinary action."
--
-- Nothing behavioural has ever existed in this schema. The five `incident` /
-- `disciplin` hits across migrations 001-119 are all false positives —
-- "Discipline" as a SUBJECT NAME in the schedule seeds (074, 090), "KD #119
-- discipline" meaning rigour, and one code comment.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ONE TABLE, TYPED — NOT TWO
--
-- Two school documents were supplied (2026-08-13 / 2026-08-14) and they are
-- different animals:
--
--   * The incident report — a controlled form (`C4.6.1-F02 REV NO. 04`),
--     ALREADY computer-generated and ALREADY sequentially numbered; the
--     sample was case 702. Filed by whoever was at the venue.
--   * A first warning letter — a hand-filled Word template, signed by the
--     Assistant Principal and noted by the Principal. Its trigger is
--     ATTENDANCE, not an incident, so it hangs off no incident at all.
--
-- They land in one table with a `record_type` because the ask is a single
-- chronological view of a student's year. Two tables would force every reader
-- to merge them by date, and — since the attendance letter is not caused by
-- any incident we hold — would imply a parent/child link that does not exist.
-- Decided with Mr Ace, 2026-08-17: "one list is fine for now its basically a
-- type atp no?"
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHAT THIS TABLE DELIBERATELY DOES NOT DO
--
-- It does not decide anything, and it generates no documents. The 80%
-- attendance minimum, the "four absences in a month" trigger and the rule that
-- an attendance shortfall forfeits a student's academic awards all live in the
-- Student Handbook (pp. 16-18), which the school revises on its own schedule.
-- Mr Ace, 2026-08-17: "handbooks change let them do that themselves thats
-- there role and respobsibility". So there is no threshold column, no
-- automatic flagging, and `lib/compute/awards.ts` is untouched — a hardcoded
-- policy number goes stale silently and leaves the system confidently wrong.
--
-- No sequence number either. Their incident reports are numbered to 702 and
-- nobody has decided whether those cases come across; inventing a second,
-- unrelated numbering scheme now would make that decision harder, not easier.
--
-- ─────────────────────────────────────────────────────────────────────────
-- FIELDS ARE THEIRS, NOT OURS
--
-- Taken from the two supplied forms: filer + office, level/class, date, time,
-- nature of incident, details, supporting documents, other comments/remarks.
--
-- `nature` is free text ON PURPOSE. "Nature of incident" reads as a picklist
-- on their form and we have seen exactly ONE value. The list has been asked
-- for and not yet supplied — a `check (nature in (...))` written from one
-- sample would reject the school's own vocabulary on day one. Tighten it when
-- the list arrives, not before.
--
-- `student_id` is NOT NULL, though the school's paper form marks the student
-- "(if applicable)". The entire point of #7 is opening a student and seeing
-- their incidents; a student-less incident has no home here and nobody has
-- asked for one.
--
-- Attachments (their "Supporting Document/s" field) are NOT in this migration.
-- The only storage bucket in this app is public-by-URL with no signed-URL path
-- anywhere, and a child's behavioural record is the wrong place to be the
-- first exception. Deferred deliberately, with the privacy decision owed
-- first — see the plan file.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY NO NEW CAPABILITY
--
-- Filing is open to any staff member. Chandana, 2026-08-14: "Incident reports
-- are filed by the person in charge who is present at the venue of incident."
-- Filing is a circumstance, not a role — so there is nothing to gate on.
--
-- Reach is gated by the SECTION instead, exactly as the Classroom student
-- drawer is (`app/api/classroom/[sectionId]/students/[studentNumber]`, KD
-- #181): a teacher may file against a student on a roster they hold, and
-- oversight roles reach everyone. That reuses a gate already proven in
-- production rather than adding a capability which, per KD #166, is INERT
-- until a matching `role_permissions` row exists in the live database.
--
-- Editing is the filer plus leadership (Mr Ace, 2026-08-17), enforced in the
-- PATCH route — the service-role client bypasses RLS, so the policy below is
-- defence in depth for cookie-scoped reads, not the primary gate.
--
-- No separate history table: `audit_log` already records who changed what,
-- and the relief-teacher reversal (migrations 112-117) is the standing lesson
-- against building a second one.
--
-- Idempotent — safe to re-run. APPLIED 2026-08-18. The `document_url` column
-- belongs to this same decision but landed in 121, because by the time it was
-- settled this migration was already live and editing an applied file would
-- leave it disagreeing with the database.

create table if not exists public.student_discipline_records (
  id                uuid primary key default gen_random_uuid(),
  student_id        uuid not null references public.students(id) on delete cascade,
  section_id        uuid not null references public.sections(id) on delete cascade,
  academic_year_id  uuid not null references public.academic_years(id) on delete cascade,
  record_type       text not null check (record_type in ('incident', 'letter')),
  occurred_on       date not null,
  occurred_at_time  time,
  nature            text not null,
  details           text not null default '',
  remarks           text,
  filed_by          uuid not null,
  filed_by_office   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid
);

-- No "not in the future" CHECK here on purpose. `current_date` is not
-- immutable, and a constraint written against it revalidates on pg_dump /
-- restore — so a row that was legal the day it was filed can block a restore
-- months later. That rule lives in the zod schema instead
-- (`lib/schemas/discipline.ts`), which is also where a school admin can be
-- told about it in words. Nor is there a check against term boundaries: a
-- letter is routinely written days after the thing it describes.

comment on table public.student_discipline_records is
  'One row per disciplinary thing on a student''s record — an incident that happened, or a letter the school issued. Action item #7 from the 2026-07-31 academics training (Christina, 18:20). Records what staff decided; decides nothing itself and generates no documents.';
comment on column public.student_discipline_records.record_type is
  '''incident'' = something happened. ''letter'' = the school issued a letter (e.g. a first warning on attendance). One table because the ask is a single chronological view of the year; the attendance letter is triggered by the register, not by any incident, so the two are siblings and never parent/child.';
comment on column public.student_discipline_records.nature is
  'What kind of thing this is — the school form''s "Nature of incident", or a letter''s "Subject" line. FREE TEXT on purpose: their field reads as a picklist but only one value has ever been seen, and the list has been requested and not supplied. Do not constrain it from a guess.';
comment on column public.student_discipline_records.student_id is
  'Required here, though the school''s paper form marks the student "(if applicable)" — #7 exists so that opening a student shows their incidents, and a student-less record has no home on that screen.';
comment on column public.student_discipline_records.section_id is
  'The class the student was in when this was filed — the form''s "Level / Class". Kept as a stored fact, not derived: a student who transfers later must not have their history re-attributed to the new class.';
comment on column public.student_discipline_records.filed_by is
  'auth.users(id) of whoever filed it. No declared cross-schema FK (the teacher_assignments convention, migration 003); the service-role route stamps only the verified session''s own id and never accepts it from the request body.';
comment on column public.student_discipline_records.filed_by_office is
  'The school form says "Name · Office", not "Name · Role" — the filer is identified by where they work, not by what class they teach. Optional free text; we already know the account, this is their own wording.';
comment on column public.student_discipline_records.details is
  'The narrative. Sensitive by nature and about a child — deliberately never copied into audit_log context, which is readable by every is_registrar_or_above() user and is append-only (the same PRIVACY reasoning as attendance ex_note, migration 109).';

create index if not exists student_discipline_records_student_idx
  on public.student_discipline_records (student_id, occurred_on desc);

create index if not exists student_discipline_records_section_idx
  on public.student_discipline_records (section_id, occurred_on desc);

create index if not exists student_discipline_records_ay_idx
  on public.student_discipline_records (academic_year_id);

alter table public.student_discipline_records enable row level security;

-- Read: leadership sees everything; the filer always sees their own filing;
-- a teacher sees records belonging to a section they hold, cover included
-- (`relief_teacher_user_id`, migration 117). Mirrors the Classroom drawer's
-- rule — the section answers "may this teacher see this child".
drop policy if exists student_discipline_records_scoped_read
  on public.student_discipline_records;
create policy student_discipline_records_scoped_read
  on public.student_discipline_records for select
  to authenticated
  using (
    public.is_registrar_or_above()
    or filed_by = auth.uid()
    or exists (
      select 1
      from public.teacher_assignments ta
      where ta.section_id = student_discipline_records.section_id
        and (
          ta.teacher_user_id = auth.uid()
          or ta.relief_teacher_user_id = auth.uid()
        )
    )
  );

drop policy if exists student_discipline_records_no_insert
  on public.student_discipline_records;
create policy student_discipline_records_no_insert
  on public.student_discipline_records for insert to authenticated with check (false);

drop policy if exists student_discipline_records_no_update
  on public.student_discipline_records;
create policy student_discipline_records_no_update
  on public.student_discipline_records for update to authenticated
  using (false) with check (false);

drop policy if exists student_discipline_records_no_delete
  on public.student_discipline_records;
create policy student_discipline_records_no_delete
  on public.student_discipline_records for delete to authenticated using (false);
