import type { Role } from '@/lib/auth/roles';

// What a role is CALLED on screen.
//
// Lived in components/module-sidebar/sidebar-profile.tsx until the role
// switcher grew a second and third surface (the topbar switcher on `/` and
// `/account`, and the "not one of your classes" notice). Three copies of this
// map would drift, and the string is user-visible: the popover row, the
// success toast and the button on the notice all name the same view in the
// same words, which is what makes "Switch to School Admin view" recognisable
// as the thing the popover also offers.
//
// Deliberately NOT in lib/auth/roles.ts. That file is one of the six
// authorization gates scanned by
// `__tests__/auth/active-role-never-authorises.test.ts`, and it is imported by
// the edge proxy — display copy has no business travelling there.
//
// Plain English, not the database's snake_case (Mr Ace's standing note: school
// administrators are not IT). `p_file_officer` is "P-File Officer" because
// that is what the school calls the job.
//
// ⚠ THERE IS A SECOND SIX-ROLE MAP AND IT IS NOT A MISTAKE: `ROLE_LABELS` in
// `lib/copy/data-table.ts`, whose own docstring claims role labels belong
// there. Both stay. RULED 2026-09-03, so nobody "fixes" one into the other:
//
//   • `lib/copy/data-table.ts` → EXPORTED DATA. Column headers and CSV cells,
//     where the house voice is sentence case, alongside `lockedRoleNote()`.
//   • this file → APP CHROME. The view switcher's rows, the "Now viewing as …"
//     toast, and the "Switch to School Admin view" button — a named control,
//     which the design system title-cases.
//
// ⚠ EXACTLY ONE OF THE SIX ACTUALLY DIFFERS, and it is worth knowing which
// before anyone reaches for a merge: `school_admin` is "School admin" there
// and "School Admin" here. The other five are byte-identical. That single
// difference is the whole of the sentence-case-in-exports vs
// title-case-in-chrome split, and it is not worth churning user-visible copy
// over in either direction.
//
// (`lib/copy/data-table.ts` also documents four further hand-rolled copies in
// `components/sis/` that it deliberately left alone. This file does not add a
// fifth — it ABSORBED the one that was in
// `components/module-sidebar/sidebar-profile.tsx`.)
export const ROLE_LABEL: Record<Role, string> = {
  teacher: 'Teacher',
  academic_coordinator: 'Academic Coordinator',
  school_admin: 'School Admin',
  superadmin: 'Superadmin',
  p_file_officer: 'P-File Officer',
  admissions: 'Admissions',
};
