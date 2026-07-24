import { describe, it, expect } from 'vitest';
import { viewAllActivityHref } from '@/lib/account/view-all-target';

describe('viewAllActivityHref', () => {
  it('maps each role to its primary module audit-log page, with the email URL-encoded', () => {
    expect(viewAllActivityHref('teacher', 'maria.t@hfse.edu.sg')).toBe(
      '/markbook/audit-log?actor=maria.t%40hfse.edu.sg'
    );
    expect(
      viewAllActivityHref('academic_coordinator', 'joann@hfse.edu.sg')
    ).toBe('/markbook/audit-log?actor=joann%40hfse.edu.sg');
    expect(viewAllActivityHref('school_admin', 'admin@hfse.edu.sg')).toBe(
      '/sis/audit-log?actor=admin%40hfse.edu.sg'
    );
    expect(viewAllActivityHref('superadmin', 'amier@hfse.edu.sg')).toBe(
      '/sis/audit-log?actor=amier%40hfse.edu.sg'
    );
    expect(viewAllActivityHref('p_file_officer', 'pfiles@hfse.edu.sg')).toBe(
      '/p-files/audit-log?actor=pfiles%40hfse.edu.sg'
    );
    expect(viewAllActivityHref('admissions', 'admissions@hfse.edu.sg')).toBe(
      '/admissions/audit-log?actor=admissions%40hfse.edu.sg'
    );
  });
});
