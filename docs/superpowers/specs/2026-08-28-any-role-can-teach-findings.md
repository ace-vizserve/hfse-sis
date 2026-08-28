# Any role can also teach — findings, not yet a design

**Status: FINDINGS ONLY. Nothing is scoped, costed or approved.** Written
2026-08-28 after a full sweep. The decisions at the end are Mr Ace's and are
deliberately left open.

## The ask, in his words

> "a school admin is a teacher (FCA, Subject Teacher), it's not necessarily a
> multi role, it's just for them to be a teacher as well — any role can be a
> teacher basically"
> — Mr Ace, 2026-08-28

## ⚠ Correction to the backlog note — this is NOT a JWT problem

The standing note said _"the JWT is the hard part, not the array"_, describing a
user → roles → active-role design with token re-minting. **That answers a
different question than the one being asked**, and building it would be a large
piece of auth work for no reason.

**Teaching is already an assignment, not a role.** `teacher_assignments` carries
`form_adviser` / `subject_teacher` / `co_adviser` / `co_teacher` and has always
been many-per-user. Every database test for "does this person teach here" —
`is_teacher_for_section`, `is_adviser_for_section`, `is_teacher_for_sheet`,
`is_section_adviser` — resolves through **`auth.uid()` against that table**,
never through the JWT role. The 12 elevated policies read
`is_registrar_or_above() OR <identity arm>`, so a `school_admin` passes anyway.

**So: no user-role array, no active-role switcher, no token re-minting, no
`custom_access_token_hook` (there is none today), and not one of the 34
role-dependent RLS policies is touched.** The database already permits
everything being asked for.

## Who this is actually about — measured on production, 2026-08-28

44 staff accounts. **Six hold `school_admin` and also teach in AY2026:**

| Account             | AY2026 assignments            |
| ------------------- | ----------------------------- |
| `kohsuat.hoon@`     | **form adviser** + 5 subjects |
| `lhen.mendoza@`     | **form adviser** + 5 subjects |
| `mae.juni@`         | **form adviser** + 6 subjects |
| `melissa.balantac@` | **form adviser** + 3 subjects |
| `muhammad.hanafi@`  | 5 subjects                    |
| `chandana.dileep@`  | 1 subject                     |

⚠ **Four form classes in the live year have their adviser on a `school_admin`
account.** FCA write-ups hard-gate report-card publishing (KD #138/#145), so
this is not cosmetic.

⚠ **`teacher_assignments` has no `academic_year_id` column** — the year comes
through `section_id → sections.academic_year_id`. Filtering the assignment table
on an AY column returns **zero rows with no error**, which reads exactly like
"nobody teaches". It caught this investigation once.

## 🔴 The one real hard block, and it was not on anybody's list

**`app/api/teacher-assignments/route.ts:264-282` refuses to assign anyone whose
role is not literally `teacher`.** It validates against `getTeacherList()`, which
filters `role === 'teacher'` (`lib/auth/staff-list.ts:162`), and 400s with
_"Only someone with a teacher account can be given a class."_ The section
teachers tab (`app/(sis)/sis/sections/[id]/page.tsx:168`) will not even list
them.

**So the six existing rows could not have been created through the app.** They
came from the deployment import, which wrote SQL directly. ⚠ **Nobody can
maintain them on screen** — a co-teacher change for Koh's class cannot be made
in the UI today.

`app/api/relief/book/route.ts:73-85` has the same gate, so **a teaching
`school_admin` also cannot be booked as a substitute.** These two fix together
or the rest is decoration.

**Everything else is open.** All four teaching routes admit `school_admin`:

```ts
// lib/auth/roles.ts:1038, 1056, 1074, 1091
{ prefix: '/classroom',  allowed: ['teacher','academic_coordinator','school_admin','superadmin'] }
{ prefix: '/attendance', allowed: [ ...same ] }
{ prefix: '/evaluation', allowed: [ ...same ] }
{ prefix: '/markbook',   allowed: [ ...same ] }
```

## The shape of the gap — three causes, not thirty

### 1. `resolveClassroomScope` decides before it looks

`lib/classroom/scope.ts:90-97` returns oversight for any role in
`OVERSIGHT_ROLES` **before the `assignments` argument is read at all**, and
`:102-109` returns an empty scope for anything that is not literally `'teacher'`.
`loadClassroomAccess` (`lib/classroom/queries.ts:60-63`) does not even load the
rows. So a teaching admin is always "all sections, oversight" and never "my four
classes, adviser".

### 2. The teaching profile has an early return

`teachingProfileFor` → `NO_TEACHING_PROFILE` when `role !== 'teacher'`
(`lib/sidebar/module-visibility.ts:153`, via `resolve-hidden-modules.ts:33-38`).
That single return empties the home page's teaching signal, so widening the
`roles` array on the to-do cards would **not** fix them — the loaders gate on the
profile (`lib/home/todos.ts:98,116`).

### 3. Roughly eight inline `role === 'teacher'` scoping branches

`app/(attendance)/attendance/page.tsx:148`, `.../sections/page.tsx:39` (one flag
driving six things), `app/(evaluation)/evaluation/sections/page.tsx:116`,
`.../[sectionId]/page.tsx:47,98`, `app/(evaluation)/evaluation/page.tsx:145`,
and the four relief-panel mounts.

**Fixing 1 and 2 cascades to most of 3**, because Markbook and Classroom already
read `scope.isOversight` rather than the role. Attendance's `isTeacherOnly` and
Evaluation's `listFormAdviserSectionIds` branch would still need converting by
hand.

## The single clearest demonstration

`app/(markbook)/markbook/grading/page.tsx` builds "My sheets" **correctly**, from
`teacher_assignments` keyed on `userId`. Then line 611 passes
`currentUserId={role === 'teacher' ? userId : null}`, and
`grading-data-table.tsx:570-582` drops the whole "My sheets" filter when that is
null.

**The assignment-derived answer is computed and then thrown away by a role
literal.** That is the entire bug in one line.

## Two label defects, one in each direction

- `app/(classroom)/classroom/page.tsx:146` renders **"Your classes."**
  unconditionally — a `school_admin` reads that over every class in the school.
- `app/(classroom)/classroom/[sectionId]/layout.tsx:133` tells a `school_admin`
  opening **their own form class** that it is a _"Read-only oversight view"_.

## The rule to design toward

The codebase has already drawn this line three times — KD #184, #191, #193:

> **What you may DO comes from your assignments. What you are CALLED comes from
> your role.**

A teaching surface should ask _"do you have assignment rows here"_, not _"is your
role literally `teacher`"_. KD #193 made exactly this correction for the co-roles
and pinned it in `__tests__/auth/assignment-read-classification.test.ts`.

## Open decisions — Mr Ace's, not ours

1. **Does a teaching admin get one lens or two?** Either "My Sheets" and "All
   Sheets" both appear for them, or one page carries a scope toggle. This is the
   decision everything else follows from.
2. **Does the nav stop being role-keyed, or gain a second input?**
   `NAV_BY_MODULE.markbook` is four hand-written trees; the cheap change adds
   "has assignments" beside the role, the clean one stops keying on role at all.
3. **Should `getTeacherList()` widen, or should assignment eligibility become its
   own question?** Widening it affects every picker that uses it, including ones
   where "teacher" genuinely is the right filter.
4. **Anything for a role with no assignments?** Expected answer: no. That keeps
   the blast radius to these six accounts.

⚠ **Auth is where a mistake locks real staff out.** Migration 114 revoked one
helper's grant and blanked every teacher's Teachers tab until 116 repaired it.
Whatever is built here needs a browser pass as a real teacher before it is called
done.
