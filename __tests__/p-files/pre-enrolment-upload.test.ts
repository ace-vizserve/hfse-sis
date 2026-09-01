/**
 * Staff upload works on BOTH sides of enrolment (2026-09-01, KD #204).
 *
 * Before this, `documents_pre_enrolment` had no `upload` action at all and the
 * one upload route asked for `documents_post_enrolment.upload` AND refused any
 * student who had not enrolled, with a 422. That was correct while P-Files was
 * enrolled-only: an applicant had no folder here. KD #204 gave them one, and
 * the refusal became the thing standing between the office and
 * `assessmentResult` — "Assessment Result and Interview", a document the SCHOOL
 * produces, which the parent portal never offers and which therefore had no
 * staff path into an applicant's folder at all.
 *
 * What these tests hold in place:
 *
 *   1. the capability exists and is held by exactly the roles that already
 *      upload after enrolment — this widened WHICH STUDENTS, not WHO;
 *   2. the route gates on either side and narrows by enrolment state, rather
 *      than refusing applicants outright;
 *   3. the enrolment string test has ONE definition, so the route and the page
 *      cannot disagree about who counts as enrolled;
 *   4. an upload whose documents row is missing fails loudly instead of
 *      reporting success — a failure mode the old 422 made unreachable.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ALL_CAPABILITIES,
  DEFAULT_ROLE_CAPABILITIES,
  isCapability,
} from '@/lib/auth/capabilities';
import { ROLES, type Role } from '@/lib/auth/roles';
import { isEnrolledStatus } from '@/lib/p-files/_shared';

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

const UPLOAD_ROUTE = 'app/api/p-files/[enroleeNumber]/upload/route.ts';
const STUDENT_PAGE = 'app/(p-files)/p-files/[enroleeNumber]/page.tsx';

function holdersOf(capability: string): Role[] {
  return ROLES.filter((role) =>
    (DEFAULT_ROLE_CAPABILITIES[role] as string[]).includes(capability)
  ).sort();
}

describe('documents_pre_enrolment.upload', () => {
  it('is a real capability the code can gate on', () => {
    expect(ALL_CAPABILITIES).toContain('documents_pre_enrolment.upload');
    expect(isCapability('documents_pre_enrolment.upload')).toBe(true);
  });

  it('is held by exactly the roles that already upload after enrolment', () => {
    // The point of the grant: nobody NEW can upload anything. If these two ever
    // diverge it is a real permission decision, not a tidy-up.
    expect(holdersOf('documents_pre_enrolment.upload')).toEqual(
      holdersOf('documents_post_enrolment.upload')
    );
    expect(holdersOf('documents_pre_enrolment.upload')).toEqual([
      'p_file_officer',
      'school_admin',
      'superadmin',
    ]);
  });

  it('is withheld from admissions, who have no upload surface to use it on', () => {
    // Not an oversight — recorded in both lib/auth/capabilities.ts and
    // migration 139. `/p-files` excludes them at ROUTE_ACCESS and the applicant
    // file's DocumentsViewer has no upload path, so the grant would be a ticked
    // box wired to no gate. Give them a control first, then grant it as data.
    expect(holdersOf('documents_pre_enrolment.upload')).not.toContain(
      'admissions'
    );
  });
});

describe('the upload route turns on the enrolment line, not on a refusal', () => {
  it('accepts either side and narrows by enrolment state', () => {
    const text = source(UPLOAD_ROUTE);
    expect(text).toMatch(/requireAnyCapability\(\[/);
    expect(text).toContain("'documents_pre_enrolment.upload'");
    expect(text).toContain("'documents_post_enrolment.upload'");
    expect(text).toMatch(/isStudentEnrolled\(ayCode, enroleeNumber\)/);
    expect(text).toMatch(
      /enrolled\s*\n?\s*\?\s*'documents_post_enrolment\.upload'/
    );
    expect(text).toMatch(/:\s*'documents_pre_enrolment\.upload'/);
  });

  it('no longer refuses applicants outright', () => {
    const text = source(UPLOAD_ROUTE);
    // The exact 422 this replaced. Its return of any kind would mean an
    // applicant is being turned away before the capability check can speak.
    expect(text).not.toContain(
      'P-Files uploads are only available for enrolled students'
    );
    expect(text).not.toMatch(/status:\s*422/);
  });

  it('fails loudly when there is no documents row to write to', () => {
    const text = source(UPLOAD_ROUTE);
    // PostgREST reports an UPDATE that matched nothing as success. Without the
    // `.select()` and this check the file lands in storage, the record never
    // changes, and the screen says the upload worked.
    expect(text).toMatch(/\.select\('"enroleeNumber"'\)/);
    expect(text).toContain("code: 'no_document_row'");
  });
});

describe('the student page asks the same question the routes ask', () => {
  it('picks the capability side from the student, not from a constant', () => {
    const text = source(STUDENT_PAGE);
    // The page serves applicants as well as enrolled students now. Reading the
    // post-enrolment capabilities unconditionally would render buttons gated on
    // a capability their routes never consult.
    expect(text).toMatch(/isEnrolledStatus\(student\.applicationStatus\)/);
    expect(text).toMatch(/const side = enrolled/);
    expect(text).toMatch(/can\(capabilities, `\$\{side\}\.upload`\)/);
  });

  it('does not hard-code the post-enrolment side for the three buttons', () => {
    const text = source(STUDENT_PAGE);
    for (const action of ['validate', 'chase', 'upload'] as const) {
      expect(
        text,
        `the page still hard-codes documents_post_enrolment.${action}`
      ).not.toContain(`'documents_post_enrolment.${action}'`);
    }
  });
});

describe('isEnrolledStatus', () => {
  it('accepts both enrolled states and nothing else', () => {
    expect(isEnrolledStatus('Enrolled')).toBe(true);
    expect(isEnrolledStatus('Enrolled (Conditional)')).toBe(true);
    for (const status of [
      'Submitted',
      'Ongoing Verification',
      'Processing',
      'Cancelled',
      'Withdrawn',
      'Rejected',
    ]) {
      expect(isEnrolledStatus(status), status).toBe(false);
    }
  });

  it('treats absent, blank and padded values the way the database does', () => {
    expect(isEnrolledStatus(null)).toBe(false);
    expect(isEnrolledStatus(undefined)).toBe(false);
    expect(isEnrolledStatus('')).toBe(false);
    // Trimmed, because the status column is free text written by several
    // surfaces — a stray space must not silently move a student to the
    // applicant side of a permission check.
    expect(isEnrolledStatus('  Enrolled  ')).toBe(true);
  });

  it('is the single definition — the I/O wrapper delegates to it', () => {
    const text = source('lib/p-files/queries.ts');
    expect(text).toMatch(/return isEnrolledStatus\(/);
    // No second copy of the string test inside the wrapper.
    expect(text).not.toMatch(
      /status === 'Enrolled' \|\| status === 'Enrolled \(Conditional\)'/
    );
  });
});
