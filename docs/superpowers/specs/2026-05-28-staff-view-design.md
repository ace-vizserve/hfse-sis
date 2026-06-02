# Staff View — Design Spec

**Goal:** A school-wide `/sis/admin/staff` page that shows every teacher's FCA section and subject-teaching assignments for the current AY, with a slide-over editor to add, change, or remove assignments without navigating into individual sections.

**Architecture:** New RSC page in the existing SIS admin group. Server-side loader joins `teacher_assignments` → `sections` → `subjects`, merges with the `auth.admin.listUsers` teacher list, and caches on `sis:${ayCode}`. Client-side slide-over fires existing POST/DELETE assignment routes. No migrations required.

**Tech stack:** Next.js 16 App Router, Supabase service client, shadcn `<Sheet>`, `<Select>`, `<DataTable>` shell (KD #84), `unstable_cache` tagged `sis:${ayCode}`.

---

## Role gate

`registrar | school_admin | superadmin` — full read-write. Mirrors `/sis/sections/[id]` access.

---

## Data model

All data lives in existing tables; no schema changes.

```
auth.users          → teacher list (role = 'teacher' in app_metadata)
teacher_assignments → (id, teacher_user_id, section_id, subject_id, role)
sections            → (id, name, academic_year_id, level_id)
subjects            → (id, code, name)
academic_years      → (id, ay_code, is_current)
```

**Constraints preserved (server-enforced, no changes):**

- At most one `form_adviser` row per section (unique partial index)
- `form_adviser` rows have `subject_id IS NULL`
- `subject_teacher` rows have `subject_id IS NOT NULL`
- Duplicate `(teacher_user_id, section_id, subject_id)` rejected for `subject_teacher`

---

## New lib: `lib/sis/staff.ts`

```typescript
export type StaffRow = {
  userId: string;
  email: string;
  name: string;
  disabled: boolean;
  fcaSection: { id: string; name: string; levelCode: string } | null;
  subjectAssignments: Array<{
    assignmentId: string;
    subjectId: string;
    subjectCode: string;
    subjectName: string;
    sectionId: string;
    sectionName: string;
    levelCode: string;
  }>;
};
```

`loadStaffAssignments(ayCode: string): Promise<StaffRow[]>`

- Fetches current AY id from `ayCode`
- Fetches all sections for that AY joined with `levels(code)`
- Fetches all `teacher_assignments` for those sections joined with `sections(name)` and `subjects(code, name)`
- Calls `getTeacherList()` to get all teacher users
- Merges: one `StaffRow` per teacher; teachers with zero assignments included (empty columns)
- Wrapped in `unstable_cache`, tag `sis:${ayCode}`, revalidate 60s

---

## Page: `app/(sis)/sis/admin/staff/page.tsx`

RSC. Runs `requireRole(['registrar', 'school_admin', 'superadmin'])` then calls `loadStaffAssignments(ayCode)` and passes the result to the client table component.

**Header:** breadcrumb (← SIS Admin), title "Staff Assignments", current AY badge.

**Summary strip (3 KPI chips):**

- Total teachers
- Teachers with FCA assigned
- Sections missing an FCA (total sections − sections with adviser)

---

## Table: `components/sis/staff-table.tsx`

`<DataTable>` shell (KD #84). One row per teacher.

**Columns:**

| Column          | Content                                                     |
| --------------- | ----------------------------------------------------------- |
| Teacher         | Display name (bold) + email (muted, text-sm)                |
| FCA Section     | Section name badge or "—" muted                             |
| Subjects Taught | Up to 3 chips `CODE · Section`, then `+N more`; "—" if none |
| Load            | `1 FCA + 3 subjects` mono muted; or `No assignments`        |

**Toolbar:**

- Name/email search input (`w-64`, `h-8`, Search icon, X clear)
- Filter chips: `All | Has FCA | No FCA`
- Toggle: "Show disabled accounts" (hidden by default; disabled rows rendered greyed, no slide-over)

**Row interaction:** Entire row is clickable → opens `<StaffAssignmentSheet>` for that teacher. No separate Edit button.

**Empty state:** "No teachers found — add staff accounts via Users."

---

## Slide-over: `components/sis/staff-assignment-sheet.tsx`

shadcn `<Sheet side="right">`. Title: "Assignments — {Teacher Name}". Subtitle: teacher email.

### FCA Section block

- Label: "Form Class Adviser"
- shadcn `<Select>`, options grouped by level (P1 … S4)
- "None" option at top to clear
- Current FCA pre-selected on open
- Save button (outline variant) fires:
  1. `DELETE /api/teacher-assignments/[oldId]` if clearing or changing
  2. `POST /api/teacher-assignments` with `role='form_adviser'` if setting a new section
- **Conflict error:** if target section already has a different FCA, server returns 409; surface as `toast.error("Section already has a form adviser — remove them first.")`.

### Subject Assignments block

- Label: "Subject Teaching"
- List of current `(Subject · Section)` pairs, each with a `×` remove button
  - Remove fires `DELETE /api/teacher-assignments/[id]`
- "+ Add subject" inline form below the list:
  - `<Select>` for subject (all subjects, sorted by code)
  - `<Select>` for section (all sections, grouped by level)
  - Add button fires `POST /api/teacher-assignments` with `role='subject_teacher'`
- **Duplicate error:** server rejects duplicate `(teacher, section, subject)` → `toast.error("Already assigned to this subject in that section.")`

### Sheet behaviour

- Sheet stays open after each save (user may make multiple changes in sequence)
- Table row updates optimistically on each mutation
- `revalidateTag('sis:${ayCode}')` fired server-side after each mutation (via existing route pattern) so a full page refresh reflects the latest state

---

## New API route: `app/api/teacher-assignments/by-teacher/route.ts`

`GET /api/teacher-assignments/by-teacher?ayCode=AY2026`

Used by the slide-over to fetch the teacher's current assignment state on open (lazy — not pre-fetched for every row).

Role gate: `registrar | school_admin | superadmin`.

Returns:

```typescript
{
  fcaAssignment: { id: string; sectionId: string; sectionName: string } | null;
  subjectAssignments: Array<{
    id: string;
    subjectId: string;
    subjectCode: string;
    subjectName: string;
    sectionId: string;
    sectionName: string;
  }>;
  allSections: Array<{ id: string; name: string; levelCode: string }>;
  allSubjects: Array<{ id: string; code: string; name: string }>;
}
```

Accepts `?teacherId=` (UUID) to scope the query. `allSections` and `allSubjects` are returned in the same call to populate the pickers without a second round-trip.

---

## Sidebar: `lib/sidebar/registry.ts`

Add to the SIS admin `iconByHref` map:

```typescript
'/sis/admin/staff': Users,   // lucide-react Users icon
```

Position: after `/sis/admin/approvers`, before `/sis/admin/school-config`.

---

## Audit trail

No new audit actions. All mutations go through existing routes:

- `POST /api/teacher-assignments` → logs `assignment.create`
- `DELETE /api/teacher-assignments/[id]` → logs `assignment.delete`

Both routes already call `logAction` with `actor_email`, `entity_id`, and context. The existing SIS audit-log page at `/sis/audit-log` already surfaces these actions.

---

## Files to create

| File                                              | Purpose                                                      |
| ------------------------------------------------- | ------------------------------------------------------------ |
| `app/(sis)/sis/admin/staff/page.tsx`              | RSC page — role gate, data load, header, KPI strip, table    |
| `components/sis/staff-table.tsx`                  | `<DataTable>` shell consumer — columns, search, filter chips |
| `components/sis/staff-assignment-sheet.tsx`       | Slide-over editor — FCA picker + subject list                |
| `lib/sis/staff.ts`                                | `loadStaffAssignments` loader + `StaffRow` type              |
| `app/api/teacher-assignments/by-teacher/route.ts` | GET — lazy-fetch assignments + pickers for slide-over        |

## Files to modify

| File                      | Change                                             |
| ------------------------- | -------------------------------------------------- |
| `lib/sidebar/registry.ts` | Add `/sis/admin/staff` nav entry with `Users` icon |

## No migrations

All data is in existing tables. No schema changes.

---

## Out of scope

- Multi-AY assignment management (current AY only)
- Bulk assignment (e.g. copy all assignments from one teacher to another)
- Per-subject teacher coverage report (different grain — a future `/sis/admin/subjects` enhancement)
- Assignment history / who changed what (audit log at `/sis/audit-log` covers this)
