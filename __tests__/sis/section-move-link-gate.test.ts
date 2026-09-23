/**
 * The "Move to another section" control on the Enrollment tab's class-stage
 * tile (`components/sis/enrollment-tab.tsx`).
 *
 * It used to be a link to `/sis/sections/[id]`, which `admissions` cannot open
 * (they hold the placement right but not SIS Admin), so it was hidden from
 * them and they had no way to change a student's section from this page. It
 * now opens the SectionTransferDialog in place, which posts to the
 * transfer-section API — open to every ENROLMENT_PLACEMENT_WRITERS role — so
 * the placement right alone is the gate.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isRouteAllowed } from '@/lib/auth/roles';
import {
  canAssignSection,
  ENROLMENT_PLACEMENT_WRITERS,
} from '@/lib/auth/student-record';

const root = join(__dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf8');

const tab = read('components', 'sis', 'enrollment-tab.tsx');
const page = read(
  'app',
  '(admissions)',
  'admissions',
  'applications',
  '[enroleeNumber]',
  'page.tsx'
);
const transferRoute = read(
  'app',
  'api',
  'sis',
  'students',
  '[enroleeNumber]',
  'transfer-section',
  'route.ts'
);

describe('admissions can move a student from the class tile', () => {
  it('admissions holds the placement right but not SIS Admin', () => {
    expect(canAssignSection('admissions')).toBe(true);
    expect(isRouteAllowed('/sis/sections', 'admissions')).toBe(false);
  });

  it('the transfer API admits every placement role, admissions included', () => {
    expect(ENROLMENT_PLACEMENT_WRITERS).toContain('admissions');
    expect(transferRoute).toContain(
      'requireRole([...ENROLMENT_PLACEMENT_WRITERS])'
    );
  });

  it('the tile opens the transfer dialog instead of linking to /sis/sections', () => {
    expect(tab).toMatch(
      /autoManaged &&\s*currentSectionId &&\s*canAssignSection &&\s*transfer && \(\s*<SectionTransferDialog/
    );
    expect(tab).not.toContain('href={`/sis/sections/');
  });

  it('the page passes the transfer data and no longer gates on the SIS Admin route', () => {
    expect(page).toContain('transfer={sectionTransfer}');
    expect(page).not.toContain('isRouteAllowed');
  });
});
