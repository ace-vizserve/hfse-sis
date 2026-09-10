/**
 * The "Move to another section" CTA on the Enrollment tab's class-stage tile
 * (`components/sis/enrollment-tab.tsx`) must be hidden for a viewer who
 * cannot open where it points.
 *
 * THE BUG (2026-09-10, third instance of this bug class on this branch). The
 * link is gated on `canAssignSection` — the RIGHT to place a student. Until
 * this task, every role holding that right could also open `/sis/sections`,
 * so one check covered both. Task 3 gave `admissions` the placement right
 * (Records absorbed it, along with the retired `p_file_officer` role) without
 * giving them SIS Admin — Mr Ace named three modules for admissions
 * (Records, P-Files, Admissions), not four. `ROUTE_ACCESS`'s `/sis/sections`
 * rule still excludes `admissions`, so the link rendered and bounced.
 *
 * THE FIX. The control now also requires `canReachSectionSetup`, computed by
 * the page via `isRouteAllowed('/sis/sections', role)` (the app's one
 * "may this role open this path" answer) and passed down as a prop — never a
 * fresh hand-rolled role list, which is exactly the drift this branch's other
 * two fix rounds cleaned up.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isRouteAllowed } from '@/lib/auth/roles';
import { canAssignSection } from '@/lib/auth/student-record';

/**
 * The class-stage tile's "Move to another section" gate, mirrored exactly as
 * `enrollment-tab.tsx` computes it (`autoManaged && currentSectionId &&
 * canAssignSection && canReachSectionSetup`), with the first two conditions
 * held true so this isolates the two role-derived booleans.
 */
function canShowMoveToAnotherSection(input: {
  canAssignSection: boolean;
  canReachSectionSetup: boolean;
}): boolean {
  const autoManaged = true;
  const currentSectionId = 'some-section-id';
  return !!(
    autoManaged &&
    currentSectionId &&
    input.canAssignSection &&
    input.canReachSectionSetup
  );
}

describe('the "Move to another section" link only appears for a viewer who can open it', () => {
  it('is hidden when the viewer holds the placement right but cannot reach /sis/sections', () => {
    // This is exactly the admissions case: canAssignSection is true, but
    // ROUTE_ACCESS excludes admissions from /sis/sections.
    expect(
      canShowMoveToAnotherSection({
        canAssignSection: true,
        canReachSectionSetup: false,
      })
    ).toBe(false);
  });

  it('is shown when the viewer holds both the right and the route', () => {
    expect(
      canShowMoveToAnotherSection({
        canAssignSection: true,
        canReachSectionSetup: true,
      })
    ).toBe(true);
  });

  it('is hidden when the viewer lacks the placement right, even if the route is open', () => {
    // Guards against ever dropping the right-check in favour of the
    // route-check alone — both matter.
    expect(
      canShowMoveToAnotherSection({
        canAssignSection: false,
        canReachSectionSetup: true,
      })
    ).toBe(false);
  });

  it('is hidden when neither holds', () => {
    expect(
      canShowMoveToAnotherSection({
        canAssignSection: false,
        canReachSectionSetup: false,
      })
    ).toBe(false);
  });
});

describe('the real role functions reproduce the admissions gap this test guards', () => {
  // Ties the mirror above to the actual source of truth, not just to itself.
  it('admissions holds the placement right but not the route', () => {
    expect(canAssignSection('admissions')).toBe(true);
    expect(isRouteAllowed('/sis/sections', 'admissions')).toBe(false);
    expect(
      canShowMoveToAnotherSection({
        canAssignSection: canAssignSection('admissions'),
        canReachSectionSetup: isRouteAllowed('/sis/sections', 'admissions'),
      })
    ).toBe(false);
  });

  it('academic_coordinator holds both, and still sees the link', () => {
    expect(canAssignSection('academic_coordinator')).toBe(true);
    expect(isRouteAllowed('/sis/sections', 'academic_coordinator')).toBe(true);
    expect(
      canShowMoveToAnotherSection({
        canAssignSection: canAssignSection('academic_coordinator'),
        canReachSectionSetup: isRouteAllowed(
          '/sis/sections',
          'academic_coordinator'
        ),
      })
    ).toBe(true);
  });

  it('school_admin and superadmin also hold both', () => {
    for (const role of ['school_admin', 'superadmin'] as const) {
      expect(canAssignSection(role)).toBe(true);
      expect(isRouteAllowed('/sis/sections', role)).toBe(true);
    }
  });
});

describe('the mirror above is still the code that ships', () => {
  // Without this the suite is self-satisfying: the mirror encodes the fix, so
  // every assertion above would keep passing after someone deleted
  // canReachSectionSetup from the real gate. This reads the real source.
  const tab = readFileSync(
    join(__dirname, '..', '..', 'components', 'sis', 'enrollment-tab.tsx'),
    'utf8'
  );
  const page = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      'app',
      '(admissions)',
      'admissions',
      'applications',
      '[enroleeNumber]',
      'page.tsx'
    ),
    'utf8'
  );

  it('the tab still requires canReachSectionSetup on the "Move to another section" gate', () => {
    expect(tab).toMatch(
      /autoManaged &&\s*currentSectionId &&\s*canAssignSection &&\s*canReachSectionSetup/
    );
  });

  it('the page still computes canReachSectionSetup via isRouteAllowed, not a hand-rolled list', () => {
    // Tolerant of prettier's line-wrapping of the call's arguments.
    expect(page).toMatch(
      /canReachSectionSetup = isRouteAllowed\(\s*'\/sis\/sections',\s*sessionUser\.role\s*\);/
    );
  });

  it('the page still passes canReachSectionSetup down to EnrollmentTab', () => {
    expect(page).toContain('canReachSectionSetup={canReachSectionSetup}');
  });
});
