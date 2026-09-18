-- 169_school_student_number.sql
--
-- Give a student TWO numbers, because the school and the system need different
-- things from one.
--
-- `student_number` is the SYSTEM's key. It must equal the admissions
-- `studentNumber` for the same child, because that is what the student sync
-- matches on: it reads admissions, looks for a student with that number, and
-- INSERTS A NEW STUDENT when it finds none. A `student_number` that drifts from
-- admissions therefore does not break a link — it silently splits one child
-- into two. That column stays fixed, whatever prefix it carries (H, V, Y).
--
-- `school_student_number` is the SCHOOL's number — what the office writes on
-- its own class lists and what staff say out loud. It is reference data: no
-- join reads it, nothing syncs on it, and an admin may correct it freely.
--
-- WHAT PROMPTED THIS. The AY2026 YoungStarters class arrived with numbers from
-- the school's own list (Y250006, Y240009, …) while admissions held minted ones
-- (H260357, H260420, …). Those Y numbers were written into `student_number` on
-- 2026-09-18, which put the school's value in the system's key — exactly the
-- drift described above. `scripts/backfill/apply-ys-school-student-number.ts`
-- puts it right: the H number returns to `student_number`, the Y number lands here.
--
-- ⚠ NULLABLE ON PURPOSE. Most children have no separate school number — the two
-- are the same value and there is nothing to record. Null means "the school
-- uses the system number for this child", not "missing".
--
-- ⚠ UNIQUE ONLY WHERE PRESENT. A partial unique index, so the many nulls do not
-- collide while a real school number still cannot be handed to two children.

alter table public.students
  add column if not exists school_student_number text;

create unique index if not exists students_school_student_number_key
  on public.students (school_student_number)
  where school_student_number is not null;

comment on column public.students.school_student_number is
  'The school''s own student number, when it differs from student_number. '
  'Reference data only: no join or sync reads it, and staff may correct it. '
  'student_number remains the system key and must match the admissions '
  'studentNumber, which the student sync uses to decide whether a child '
  'already exists.';
