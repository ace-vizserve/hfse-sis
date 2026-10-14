import { describe, expect, it } from 'vitest';

import {
  exactMatches,
  normalizeName,
  studentNameForms,
} from '@/lib/qbo/customer-match';

const sofia = {
  enroleeFullName: 'LIM, SOFIA ALCANTARA',
  firstName: 'Sofia',
  middleName: 'Alcantara',
  lastName: 'Lim',
};

describe('customer matching', () => {
  it('normalizes case and spacing only', () => {
    expect(normalizeName('  Lim,   sofia  Alcantara ')).toBe(
      'LIM, SOFIA ALCANTARA'
    );
  });

  it('builds the full-name forms, never dropping the middle name', () => {
    expect(studentNameForms(sofia)).toEqual([
      'LIM, SOFIA ALCANTARA',
      'SOFIA ALCANTARA LIM',
    ]);
  });

  it('matches exactly one customer by any full-name form', () => {
    const customers = [
      { Id: '1', DisplayName: 'Sofia Alcantara Lim' },
      { Id: '2', DisplayName: 'LIM, SOFIA' },
      { Id: '3', DisplayName: 'LIM, SOFIA ALCANTARA (old)' },
    ];
    expect(
      exactMatches(customers, studentNameForms(sofia)).map((c) => c.Id)
    ).toEqual(['1']);
  });

  it('a near miss is not a match', () => {
    expect(
      exactMatches(
        [{ Id: '9', DisplayName: 'LIM, SOFIA ALCANTRA' }],
        studentNameForms(sofia)
      )
    ).toEqual([]);
  });
});
