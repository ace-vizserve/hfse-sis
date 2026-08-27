-- 125_student_declarations.sql
--
-- Student Absence and Travel Declaration — action item #6, reshaped 2026-08-17.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY THE PARENT FILES IT, NOT THE TEACHER
--
-- The 2026-08-12 spec had the form class adviser uploading a medical
-- certificate. Christina raised the opposite unprompted the same week — "in my
-- sons' schools, parents file a leave of absence online and attach the medical
-- certificate" — and then showed Mr Ace the actual screen. His call: "this is
-- the best way since parents are the ones who initially have the doc."
--
-- WHAT THIS IS FOR, and it is not a mailbox for MCs. Today the reason for an
-- absence is four disconnected things: a WhatsApp message to the teacher, a
-- paper MC in Mr Hanafi's drawer, the teacher's guess between `A` and `EX`, and
-- the mark itself. This table joins them, so the teacher stops guessing and the
-- proof sits on the day. The payoff is the attendance warning letter, which
-- lists absence dates as unexcused — whoever writes it has to know which days
-- carried a certificate, and today that means asking Hanafi.
--
-- ⚠ THE REGISTER STAYS THE RECORD. This table is the EVIDENCE and the request.
-- `attendance_daily` remains the only place a day's attendance is stated, and
-- `ex_note` (migration 109) keeps its job for when a parent files nothing.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ONE TABLE, TYPED — the same call migration 120 made, for the same reason
--
-- Absence and travel are two shapes of one artefact: a parent telling the
-- school a child will not be in, with something attached. The school sees one
-- queue and a parent tracks one list, so two tables would force every reader to
-- merge them by date. `declaration_type` plus per-type CHECKs keeps each shape
-- honest without splitting the queue.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ONE ROW PER STUDENT, GROUPED BY `filing_group_id`
--
-- A parent picks several children on one form; this stores one row each. That
-- is structural, not tidiness: the first approval stage is THAT CHILD'S form
-- class adviser, and siblings are in different classes. A single shared row
-- would have to pool both advisers into one stage, and "first to act carries
-- it" would then let one class's adviser decide another class's child — a
-- routing bug that reads like a feature. Fanning out also makes the vacation
-- quota per student, which is what the quota is.
--
-- ─────────────────────────────────────────────────────────────────────────
-- `status` IS THE COLUMN THE PARENT WATCHES
--
-- Mr Ace, 2026-08-27: "a new table is needed here for the absent filing of
-- parents and parents should be able to track its status". It moves under the
-- approval flow (migration 126) — nothing in THIS migration advances it, and a
-- declaration filed before that flow exists simply sits at 'pending'.
--
-- ⚠ NO FK TO THE APPROVAL REQUEST. The approval engine points AT a subject
-- (`subject_type`, `subject_id`) and deliberately holds no foreign key to any
-- consumer, so that it can serve flows that have nothing to do with attendance.
-- Pointing back from here would rebuild that coupling from the other end.
--
-- ─────────────────────────────────────────────────────────────────────────
-- EVIDENCE: AN UPLOAD **AND** A LINK, both optional
--
-- Christina's spec said "an upload or an mc.gov.sg link" — Singapore issues
-- digital MCs as a URL, and a paper one gets photographed. Mr Ace, 2026-08-27:
-- both, not either.
--
-- Files go in the EXISTING `parent-portal` bucket, in the `declarations/`
-- folder Mr Ace created. ⚠ An earlier draft made this its own phase, on the
-- grounds that migration 121 had refused to store warning letters because it
-- would be "the app's FIRST private file". That does not survive checking:
-- P-Files already keeps passports, birth certificates and medical reports in
-- that same public-by-URL bucket, and has since the beginning
-- (`DOCUMENT_SLOTS`, `lib/p-files/document-config.ts`). An MC is the same
-- category of document. The real observation is broader and predates this
-- feature — the whole document store is public-by-URL — and fixing it is one
-- project covering every document type, not a special case bolted on here.
--
-- `evidence_path` is the OBJECT PATH inside the bucket, not a URL: the public
-- URL is derivable from it and storing both invites them to disagree.
--
-- ─────────────────────────────────────────────────────────────────────────
-- PRIVACY: `parent_note` NEVER REACHES `audit_log`
--
-- Same reasoning migration 109 wrote down for `ex_note`. The content is
-- medical-adjacent and about a child; `audit_log` is readable by every
-- `is_registrar_or_above()` user, is append-only, and can never be corrected.
-- The routes log `note_present: true` and nothing else. The 300-char cap
-- matches `attendance_daily_ex_note_len_chk` exactly so the two can never
-- disagree about what fits.
--
-- ─────────────────────────────────────────────────────────────────────────
-- RLS
--
-- Staff read is scoped like migration 120's: leadership sees everything, a
-- teacher sees declarations for a section they hold (cover included). All
-- writes denied to `authenticated` — every write is a service-role route.
--
-- ⚠ A PARENT IS `authenticated` WITH NO ROLE (`current_user_role()` is null),
-- so they match no arm of the read policy and see zero rows through PostgREST.
-- That is correct and intentional: there is no parent→student link inside
-- Postgres to scope them with (the link is an email match into the AY-prefixed
-- admissions tables, which no policy can reach). Parents read their own
-- declarations through `/api/parent/v2/declarations`, which verifies the Bearer
-- token and resolves linkage in the application layer — the same pattern the
-- report-card route already uses.
--
-- Idempotent — safe to re-run.

create table if not exists public.student_declarations (
  id                    uuid primary key default gen_random_uuid(),
  filing_group_id       uuid not null,
  declaration_type      text not null check (declaration_type in ('absence', 'travel')),

  student_id            uuid not null references public.students(id) on delete cascade,
  section_student_id    uuid not null references public.section_students(id) on delete restrict,
  section_id            uuid not null references public.sections(id) on delete cascade,
  academic_year_id      uuid not null references public.academic_years(id) on delete cascade,

  start_date            date not null,
  end_date              date not null,

  -- absence only
  with_medical          boolean,
  evidence_path         text,
  evidence_url          text,

  -- travel only
  destination_country   text,
  destination_city      text,

  parent_note           text,
  status                text not null default 'pending'
                          check (status in ('pending', 'approved', 'rejected', 'cancelled')),

  filed_by              uuid,
  filed_by_email        text not null,

  -- Set by the register write once the last stage approves. Kept here rather
  -- than inferred, because `attendance_daily` is append-only with no stable row
  -- id — there is nothing to point at and no way to ask it "was this written?".
  register_written_at   timestamptz,
  register_days_written smallint,
  register_write_error  text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint student_declarations_date_order_chk
    check (end_date >= start_date),

  -- Each type carries its own fields and none of the other's. Shape enforced in
  -- SQL rather than prose — the same posture as
  -- `teacher_assignments_role_subject_shape` (migration 124).
  constraint student_declarations_type_shape_chk
    check (
      (declaration_type = 'absence'
        and with_medical is not null
        and destination_country is null
        and destination_city is null)
      or
      (declaration_type = 'travel'
        and with_medical is null
        and destination_country is not null
        and evidence_path is null
        and evidence_url is null)
    ),

  -- Saying a certificate exists and attaching nothing makes the row useless to
  -- the person who has to decide it.
  constraint student_declarations_medical_needs_evidence_chk
    check (
      declaration_type <> 'absence'
      or with_medical is false
      or evidence_path is not null
      or evidence_url is not null
    ),

  constraint student_declarations_note_len_chk
    check (parent_note is null or char_length(parent_note) <= 300)
);

-- ⚠ No "not in the future" / "not in the past" CHECK, and no check against term
-- boundaries — the same reasoning migration 120 wrote down. `current_date` is
-- not immutable, so a constraint against it revalidates on pg_dump/restore and
-- a row that was legal when filed can block a restore months later. Those rules
-- live in `lib/schemas/declarations.ts`, which is also where a parent can be
-- told about them in words.

comment on table public.student_declarations is
  'One row per child per parent-filed absence or travel declaration. Action item #6 from the 2026-07-31 academics training, reshaped 2026-08-17 so the PARENT files it rather than the form class adviser. Carries the request and its evidence; the attendance register remains the record of what actually happened.';
comment on column public.student_declarations.filing_group_id is
  'Groups the rows created by one parent submission covering several children. One row per child because the first approval stage is that child''s own form class adviser and siblings sit in different classes — a shared row would let one class''s adviser decide another class''s child.';
comment on column public.student_declarations.status is
  'What the parent tracks. Moved by the approval flow (migration 126); nothing in migration 125 advances it, so a declaration filed before that flow exists simply sits at ''pending''. There is deliberately no FK to the approval request — the engine points at its subject and holds no key back to any consumer.';
comment on column public.student_declarations.section_id is
  'The class the child was in when this was filed. A stored fact, not derived: a student who transfers later must not have their filing re-attributed to the new class (same rule as student_discipline_records.section_id).';
comment on column public.student_declarations.with_medical is
  'The form''s "with medical / without medical" radio. Absence only. It does NOT gate approval — approved is approved — it selects the reason recorded under the register mark: ''mc'' with a certificate, no subtype without one.';
comment on column public.student_declarations.evidence_path is
  'Object path inside the existing public `parent-portal` bucket, under the `declarations/` folder. A PATH, not a URL — the public URL is derivable and storing both invites them to disagree. Coexists with evidence_url: a parent may upload a photo of a paper MC, paste an mc.gov.sg link, or both.';
comment on column public.student_declarations.evidence_url is
  'A parent-supplied external link to the certificate (mc.gov.sg issues digital MCs as a URL). Validated as https in zod and NEVER fetched server-side. The school does not control this resource''s availability, and the reviewing UI says so.';
comment on column public.student_declarations.parent_note is
  'The parent''s message to the teacher. Sensitive by nature and about a child — deliberately never copied into audit_log context, which is readable by every is_registrar_or_above() user and is append-only. Same privacy rule as attendance ex_note (migration 109), and the same 300-char cap so the two can never disagree.';
comment on column public.student_declarations.filed_by is
  'auth.users(id) of the parent. Nullable and undeclared as an FK: a parent account can be removed while the filing stays part of the child''s record, and filed_by_email preserves who it was.';
comment on column public.student_declarations.register_written_at is
  'Stamped AFTER the EX marks land, never before. attendance_daily is append-only with no stable row id, so there is nothing to point at and no way to ask it whether this declaration was already encoded — this column is that answer. Written second on purpose: a stamp with no marks is the one failure mode that leaves no trace.';

create index if not exists student_declarations_student_idx
  on public.student_declarations (student_id, start_date desc);

create index if not exists student_declarations_section_idx
  on public.student_declarations (section_id, start_date desc);

create index if not exists student_declarations_group_idx
  on public.student_declarations (filing_group_id);

-- The parent's own list, newest first — this is the status tracker's query.
create index if not exists student_declarations_filed_by_idx
  on public.student_declarations (filed_by, created_at desc);

-- The staff queue only ever looks at open ones.
create index if not exists student_declarations_pending_idx
  on public.student_declarations (section_id, start_date)
  where status = 'pending';

-- A parent double-tapping submit on a flaky connection must not file twice.
-- The route catches 23505 and returns the existing filing rather than an error.
create unique index if not exists student_declarations_no_duplicate_filing
  on public.student_declarations
     (filed_by, declaration_type, student_id, start_date, end_date)
  where filed_by is not null and status <> 'cancelled';

alter table public.student_declarations enable row level security;

-- Read: leadership sees everything; a teacher sees declarations for a section
-- they hold, cover included. Mirrors student_discipline_records_scoped_read.
-- A parent has no role, matches no arm, and sees nothing here — by design; see
-- the header.
drop policy if exists student_declarations_scoped_read
  on public.student_declarations;
create policy student_declarations_scoped_read
  on public.student_declarations for select
  to authenticated
  using (
    public.is_registrar_or_above()
    or exists (
      select 1
      from public.teacher_assignments ta
      where ta.section_id = student_declarations.section_id
        and (
          ta.teacher_user_id = auth.uid()
          or ta.relief_teacher_user_id = auth.uid()
        )
    )
  );

drop policy if exists student_declarations_no_insert
  on public.student_declarations;
create policy student_declarations_no_insert
  on public.student_declarations for insert to authenticated with check (false);

drop policy if exists student_declarations_no_update
  on public.student_declarations;
create policy student_declarations_no_update
  on public.student_declarations for update to authenticated
  using (false) with check (false);

drop policy if exists student_declarations_no_delete
  on public.student_declarations;
create policy student_declarations_no_delete
  on public.student_declarations for delete to authenticated using (false);
