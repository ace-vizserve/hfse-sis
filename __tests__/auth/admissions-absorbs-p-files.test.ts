import { describe, expect, it } from 'vitest';

import { DEFAULT_ROLE_CAPABILITIES } from '@/lib/auth/capabilities';
import { ROLES, isRouteAllowed } from '@/lib/auth/roles';
import {
  ENROLMENT_PLACEMENT_WRITERS,
  STUDENT_RECORD_WRITERS,
} from '@/lib/auth/student-record';

/**
 * 2026-09-10 — the P-Files Officer role was retired and `admissions` took the
 * whole document lifecycle. These are the eight capabilities that role held.
 * If one goes missing, somebody's daily job silently stops working: the
 * officer's queue, staff upload, or the chase emails.
 */
const DOCUMENT_CAPABILITIES = [
  'documents_pre_enrolment.read',
  'documents_pre_enrolment.chase',
  'documents_pre_enrolment.upload',
  'documents_pre_enrolment.validate',
  'documents_post_enrolment.read',
  'documents_post_enrolment.chase',
  'documents_post_enrolment.upload',
  'documents_post_enrolment.validate',
] as const;

describe('admissions absorbs the P-Files officer', () => {
  it('holds every document capability, both sides of enrolment', () => {
    const held = DEFAULT_ROLE_CAPABILITIES.admissions;
    for (const capability of DOCUMENT_CAPABILITIES) {
      expect(held, `admissions must hold ${capability}`).toContain(capability);
    }
  });

  it('does not gain anything outside the document lifecycle', () => {
    // The merge moves documents, not the whole officer's keyring. Anything
    // else appearing here is a widened grant nobody asked for.
    const extra = DEFAULT_ROLE_CAPABILITIES.admissions.filter(
      (c) => !(DOCUMENT_CAPABILITIES as readonly string[]).includes(c)
    );
    expect(extra).toEqual([]);
  });
});

describe('admissions reaches the modules it absorbed', () => {
  it('may open P-Files', () => {
    expect(isRouteAllowed('/p-files', 'admissions')).toBe(true);
    expect(isRouteAllowed('/p-files/2026-0001', 'admissions')).toBe(true);
  });

  it('may open Records', () => {
    expect(isRouteAllowed('/records', 'admissions')).toBe(true);
    expect(isRouteAllowed('/records/academic-summary', 'admissions')).toBe(
      true
    );
  });

  it('still does not reach SIS Admin or the approvers editor', () => {
    // The merge is about student documents and records, not about handing
    // admissions the configuration surfaces.
    expect(isRouteAllowed('/sis/admin/roles', 'admissions')).toBe(false);
    expect(isRouteAllowed('/sis/admin/approvers', 'admissions')).toBe(false);
  });
});

describe('admissions may place and withdraw students', () => {
  it('is an enrolment placement writer', () => {
    // The two lists used to differ by exactly this role. They no longer do:
    // admissions owns the child end to end now that Records is theirs.
    expect(ENROLMENT_PLACEMENT_WRITERS).toContain('admissions');
  });

  it('leaves the two writer lists in agreement', () => {
    expect([...ENROLMENT_PLACEMENT_WRITERS].sort()).toEqual(
      [...STUDENT_RECORD_WRITERS].sort()
    );
  });
});

describe('the P-Files officer role is retired', () => {
  it('is gone from the role list', () => {
    expect(ROLES).not.toContain('p_file_officer');
    expect(ROLES).toHaveLength(5);
  });

  it('left no capability grants behind', () => {
    expect(
      Object.keys(DEFAULT_ROLE_CAPABILITIES),
      'a Role-keyed map still carries the retired role'
    ).not.toContain('p_file_officer');
  });
});
