# Grading sheet — show the real subject teacher

**Date:** 2026-07-28
**Status:** Approved, ready for planning
**Scope:** `/markbook/grading/[id]` display + one shared pure helper. No migration.

## Problem

A Markbook grading sheet does not tell you who teaches the subject. The attendance
Term sheet names its Form Class Adviser in the register card; the grading sheet has no
equivalent, so a coordinator opening a sheet cannot see who owns it.

The page does print something. Its hero paragraph reads:

```text
// app/(markbook)/markbook/grading/[id]/page.tsx:364-368
// (fenced as text, not tsx — a bare JSX fragment is not a parseable module,
//  and the repo's prettier hook rewrites it into nonsense if told otherwise)
{level?.label} {section?.name}
{sheet.teacher_name && <> · {sheet.teacher_name}</>}
```

`grading_sheets.teacher_name` is a **denormalized legacy text column** — written at
sheet creation, never updated when assignments change. It is empty across AY2026, so
the segment renders nothing at all. Where it is populated (historical sheets) it can be
stale.

So this is not "add a missing line." It is "stop reading a column that cannot be right,
and read the assignment instead."

**Why it is empty:** teacher accounts have not been created yet for the AY2026
migration, so `teacher_assignments` has no `subject_teacher` rows to resolve. That is a
data-loading gap, not a code gap — this change is correct now and populates itself once
those accounts exist, with no further work. It does mean **"No subject teacher assigned"
is the state everyone sees for a while**, which is why it must read as a clear statement
rather than an empty gap.

## Decisions

| Question           | Decision                                                                                                                                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| How much UI?       | **Just the hero line.** No context card, no meta strip.                                                                                                                                                                                                                                          |
| Co-teaching        | **Show every assigned teacher**, comma-joined. The list page picks first-write-wins because a table cell is tight; a prose line has room, and hiding a co-teacher is a silent wrong.                                                                                                             |
| Empty state        | **"No subject teacher assigned"**, muted italic. Not silence — the gap should be visible.                                                                                                                                                                                                        |
| Link to fix it?    | **No.** Until teacher accounts exist, a link would land on a page where the task cannot be completed. Trivial to add later.                                                                                                                                                                      |
| Legacy column      | **Keep as last-resort fallback** — assignment first, `teacher_name` only when no assignment exists. Not because it is trustworthy, but because `/markbook/grading` already does exactly this, and the list and the sheet disagreeing about who teaches a class is worse than either being stale. |
| Form Class Adviser | **Out of scope.** This is about the subject teacher.                                                                                                                                                                                                                                             |

## Data model

`teacher_assignments` (migration 003):

```sql
teacher_user_id uuid not null,   -- auth.users(id)
section_id      uuid not null references public.sections(id) on delete cascade,
subject_id      uuid references public.subjects(id) on delete cascade,
role            text not null check (role in ('form_adviser','subject_teacher'))
```

Constraints that shape the design:

- `teacher_assignments_subject_teacher_unique` on `(teacher_user_id, section_id, subject_id)`
  — a `(section, subject)` pair **may hold several subject teachers**. The design must
  handle N, not assume 1.
- `teacher_assignments_role_subject_shape` — `subject_teacher` rows always carry
  `subject_id`; `form_adviser` rows never do.
- RLS `teacher_assignments_auth_read` is `using (true)`, so the **cookie-scoped client
  reads it fine**. No service-role escalation (unlike the list page, which needed the
  service client only for its batched `.in()` across many sections).

Staff names come from `auth.users` — there is no `staff` table. Resolve with
`lib/auth/staff-list.ts::getStaffDisplayNameById()`: one hop id→name, `unstable_cache`d
for 5 minutes behind a single Auth Admin call shared across the app.

**Use `getStaffDisplayNameById()`, not `getTeacherList()`.** `getTeacherList` filters to
`app_metadata.role === 'teacher'` and non-disabled, so an assignment held by an
academic coordinator or a since-disabled account is silently dropped. On a list of
hundreds of rows that degradation is tolerable; on the one sheet you are looking at,
rendering "No subject teacher assigned" when somebody _is_ assigned would be a lie.

Do not use the attendance page's two-hop `getTeacherEmailMap()` + `getStaffDisplayEntries()`
(id→email→name). `getStaffDisplayNameById()` supersedes it;
`lib/report-card/build-report-card.ts:282` is the precedent.

## Design

### 1. Shared pure helper

Add to `lib/markbook/`, as a direct sibling of the existing tested
`buildFormAdviserNameMap` (`masterfile.ts:216`):

```ts
export function buildSubjectTeacherNameMap(
  assignments: Array<{
    section_id: string;
    subject_id: string | null;
    teacher_user_id: string;
  }>,
  staffNameEntries: Array<[string, string]>
): Map<string, string[]>; // key `${sectionId}|${subjectId}` → display names
```

Rules:

- Skip rows with a null `subject_id` (defence — the CHECK constraint already prevents
  them on `subject_teacher` rows, but the helper takes plain data and should not trust
  its caller).
- Unresolvable `teacher_user_id` falls back to the id itself, matching
  `buildFormAdviserNameMap`. Never render blank — a raw id is ugly but tells a
  superadmin exactly what to go fix; a blank tells them nothing.
- Preserve input order so output is stable across renders.

**Why extract rather than inline:** the sheet page is an async RSC, so logic inlined
there cannot be unit-tested without mocking the whole Supabase call graph. A pure helper
taking plain data tests in milliseconds. `buildFormAdviserNameMap` exists for exactly
this reason and is the pattern to mirror.

It is also where `/markbook/grading/page.tsx` should eventually converge — but that
refactor is explicitly **not** part of this change; see §4.

### 2. Detail page query

`app/(markbook)/markbook/grading/[id]/page.tsx` currently joins no assignment data. The
page's own `loadAssignmentsForUser` call is keyed `.eq('teacher_user_id', sessionUser.id)`
— it gates the current user's edit rights and cannot answer "who teaches this."

Add one fetch keyed on the sheet's section + subject, folded into the **existing
`Promise.all` at lines 174-199** so it adds no serial latency:

```
.from('teacher_assignments')
.select('section_id, subject_id, teacher_user_id')
.eq('role', 'subject_teacher')
.eq('section_id', <sectionForSeed.id>)
.eq('subject_id', <subjectEarly.id>)
```

Both ids are already extracted above that block (`sectionForSeed` L138, `subjectEarly`
L160). Pair it with `getStaffDisplayNameById()` in the same batch.

### 3. The line

```
one teacher   Primary Five Tenacity · Ms Chandana Perera
two teachers  Primary Five Tenacity · Ms Chandana Perera, Mr Amier Ordonez
legacy only   Primary Five Tenacity · <grading_sheets.teacher_name>
none at all   Primary Five Tenacity · No subject teacher assigned      (muted italic)
```

The paragraph is already `text-muted-foreground`, so italic alone carries the empty
state — consistent with how `MetaBlock` renders _Unassigned_ on the attendance card
(`sheet-context.tsx:211-218`).

### 4. The grading list is NOT touched (decision reversed, 2026-07-28)

An earlier draft folded `/markbook/grading/page.tsx:314-357` onto the same helper, to
avoid two resolvers drifting. **Dropped after review.** Two reasons.

**It achieves nothing observable.** The list's Teacher column already resolves from
`teacher_assignments` and works. There is no user-visible outcome — only one resolver
instead of two.

**The swap is not clean.** That block also builds `subjectTeacherUserIds` /
`formAdviserUserIds`, which produce the **Teacher and Form Adviser facet dropdown
options** by filtering `teacherList` (L360-365), and `subject_teacher_id`, which drives
the "My sheets" filter. Since `getStaffDisplayNameById()` resolves names `getTeacherList()`
drops, a half-refactor would put a name in a **cell** that has no matching **facet
option** — precisely the vocabulary drift KD #84 warns about. Doing it correctly means
also re-sourcing the dropdowns, which is real surface area for zero present benefit.

**On the drift argument:** it does not apply yet. Drift needs two live implementations;
the sheet page has none today. Nothing can diverge from a resolver until someone edits
one of them.

**Known, deliberately unfixed:** the list drops assignments held by an account whose
role is not `teacher`, or that is disabled (`if (!t) continue;`), so such a section reads
"—" though someone is assigned. Realistically that means an academic coordinator holding
a subject assignment. Invisible on AY2026 (no assignments at all). If it surfaces, it is
its own small fix with its own evidence — see `getStaffDisplayNameById()` as the
resolver to move to, and re-source the facet options in the same change.

## Testing

Unit tests for `buildSubjectTeacherNameMap`:

1. Single assignment → one name under the composite key.
2. Two assignments on the same `(section, subject)` → **both** names, input order preserved.
3. No assignment → key absent (caller renders the empty state).
4. `teacher_user_id` missing from the staff entries → falls back to the raw id, not blank.
5. Row with null `subject_id` → skipped, no crash, no `section|null` key.

Plus regression: the full suite, `npx tsc --noEmit`, and `npx next build` clean per the
project workflow rule.

No component test for the hero line — it is a string concatenation in an async RSC, and
the resolver beneath it carries the logic worth testing.

## Out of scope

- No context card or meta strip on the grading sheet.
- No Form Class Adviser display.
- No link to teacher setup (revisit once teacher accounts exist).
- No migration; `grading_sheets.teacher_name` stays in the schema.
- No change to how assignments are created or edited.
- **No change to `/markbook/grading` (the list)** — see §4 for why the earlier plan to
  refactor it was dropped.
- Creating the AY2026 teacher accounts — a separate data task this change waits on.

## References

- `lib/markbook/masterfile.ts:206-226` — `buildFormAdviserNameMap`, the pattern mirrored
  here, including its authoritative-vs-mirror rationale.
- `lib/auth/staff-list.ts:149` — `getStaffDisplayNameById`.
- `lib/report-card/build-report-card.ts:274-286` — the same id→name resolution.
- `app/(markbook)/markbook/grading/page.tsx:294-357` — the inline map being replaced.
- `components/attendance/sheet-context.tsx:139-146` — the attendance parallel that
  prompted the request.
- KD #3 (`.claude/rules/key-decisions/markbook-grading.md`) — teacher assignments.
