import { describe, expect, it } from 'vitest';

import {
  alreadyFiledMessage,
  filingCoversAnySchoolDay,
  findOverlappingFilings,
} from '@/lib/declarations/filing-window';

// Two things the filing route now refuses, both spotted by Mr Ace after Phase
// 4 shipped: a filing covering only days the school is shut, and a filing for
// days somebody has already filed for.

type CalRow = {
  term_id: string;
  date: string;
  day_type: string;
  audience: string;
  hbl_overlay: boolean | null;
};

/** PostgREST-shaped stub, recording filters so a missing one fails here. */
function fakeService(fixtures: {
  terms?: Array<{ id: string; start_date: string; end_date: string }>;
  calendar?: CalRow[];
  declarations?: Array<{
    student_id: string;
    start_date: string;
    end_date: string;
    status: string;
  }>;
}) {
  function builder(table: string, head: boolean) {
    const eq: Record<string, string> = {};
    const inList: Record<string, string[]> = {};
    let gte: string | null = null;
    let lte: string | null = null;
    let gteCol = '';
    let lteCol = '';

    const api = {
      eq(col: string, val: string) {
        eq[col] = val;
        return api;
      },
      in(col: string, vals: string[]) {
        inList[col] = vals;
        return api;
      },
      gte(col: string, val: string) {
        gteCol = col;
        gte = val;
        return api;
      },
      lte(col: string, val: string) {
        lteCol = col;
        lte = val;
        return api;
      },
      then(resolve: (r: unknown) => void) {
        if (table === 'terms') {
          return resolve({ data: fixtures.terms ?? [], error: null });
        }
        if (table === 'student_declarations') {
          const rows = (fixtures.declarations ?? []).filter((d) => {
            if (inList.student_id && !inList.student_id.includes(d.student_id))
              return false;
            if (inList.status && !inList.status.includes(d.status))
              return false;
            // Overlap: start_date <= end AND end_date >= start.
            if (lteCol === 'start_date' && lte && d.start_date > lte)
              return false;
            if (gteCol === 'end_date' && gte && d.end_date < gte) return false;
            return true;
          });
          return resolve({ data: rows, error: null });
        }
        const rows = (fixtures.calendar ?? []).filter((r) => {
          if (eq.term_id && r.term_id !== eq.term_id) return false;
          if (inList.term_id && !inList.term_id.includes(r.term_id))
            return false;
          if (inList.audience && !inList.audience.includes(r.audience))
            return false;
          if (gteCol === 'date' && gte && r.date < gte) return false;
          if (lteCol === 'date' && lte && r.date > lte) return false;
          return true;
        });
        return resolve(
          head
            ? { count: rows.length, error: null }
            : { data: rows, error: null }
        );
      },
    };
    return api;
  }

  return {
    from(table: string) {
      return {
        select(_cols: string, opts?: { head?: boolean }) {
          return builder(table, opts?.head === true);
        },
      };
    },
  };
}

const TERM = { id: 't1', start_date: '2026-02-01', end_date: '2026-03-31' };
const schoolDay = (date: string, audience = 'all'): CalRow => ({
  term_id: 't1',
  date,
  day_type: 'school_day',
  audience,
  hbl_overlay: false,
});

const CHILD = { academicYearId: 'ay', levelType: 'primary' as const };

describe('filingCoversAnySchoolDay', () => {
  it('lets through a range with school days in it', async () => {
    const service = fakeService({
      terms: [TERM],
      calendar: [schoolDay('2026-02-09'), schoolDay('2026-02-10')],
    });
    expect(
      await filingCoversAnySchoolDay(service as never, {
        startDate: '2026-02-09',
        endDate: '2026-02-10',
        children: [CHILD],
      })
    ).toBe(true);
  });

  it('lets through a Friday-to-Tuesday range despite the weekend', async () => {
    // The rule is "no school day AT ALL", not "contains a non-school day".
    // The register write already skips the weekend correctly.
    const service = fakeService({
      terms: [TERM],
      calendar: [schoolDay('2026-02-06'), schoolDay('2026-02-09')],
    });
    expect(
      await filingCoversAnySchoolDay(service as never, {
        startDate: '2026-02-06',
        endDate: '2026-02-09',
        children: [CHILD],
      })
    ).toBe(true);
  });

  it('refuses a weekend-only filing', async () => {
    const service = fakeService({
      terms: [TERM],
      calendar: [schoolDay('2026-02-06'), schoolDay('2026-02-09')],
    });
    expect(
      await filingCoversAnySchoolDay(service as never, {
        startDate: '2026-02-07',
        endDate: '2026-02-08',
        children: [CHILD],
      })
    ).toBe(false);
  });

  it('refuses dates that fall outside every term', async () => {
    // The live case waiting to happen: AY2026 has no Term 4, so after Term 3
    // ends no date belongs to a term at all.
    const service = fakeService({
      terms: [TERM],
      calendar: [schoolDay('2026-02-09')],
    });
    expect(
      await filingCoversAnySchoolDay(service as never, {
        startDate: '2026-09-10',
        endDate: '2026-09-11',
        children: [CHILD],
      })
    ).toBe(false);
  });

  it('lets the filing through when ONE sibling has school and the other does not', async () => {
    // Audience precedence: the day is a closure for secondary and a school day
    // for primary. Refusing the whole submission would block a filing that is
    // perfectly valid for the primary child.
    const service = fakeService({
      terms: [TERM],
      calendar: [
        schoolDay('2026-02-09'),
        {
          term_id: 't1',
          date: '2026-02-09',
          day_type: 'no_class',
          audience: 'secondary',
          hbl_overlay: false,
        },
      ],
    });
    expect(
      await filingCoversAnySchoolDay(service as never, {
        startDate: '2026-02-09',
        endDate: '2026-02-09',
        children: [CHILD, { academicYearId: 'ay', levelType: 'secondary' }],
      })
    ).toBe(true);
  });

  it('treats a preschool child as seeing only the "all" calendar', async () => {
    // `school_calendar.audience` has no preschool value (KD #76).
    const service = fakeService({
      terms: [TERM],
      calendar: [schoolDay('2026-02-09')],
    });
    expect(
      await filingCoversAnySchoolDay(service as never, {
        startDate: '2026-02-09',
        endDate: '2026-02-09',
        children: [{ academicYearId: 'ay', levelType: 'preschool' }],
      })
    ).toBe(true);
  });

  it('refuses when no child was resolved at all', async () => {
    const service = fakeService({ terms: [TERM] });
    expect(
      await filingCoversAnySchoolDay(service as never, {
        startDate: '2026-02-09',
        endDate: '2026-02-09',
        children: [],
      })
    ).toBe(false);
  });
});

describe('findOverlappingFilings', () => {
  const KIDS = [{ studentId: 's1', studentName: 'Ana Reyes' }];

  it('finds a filing that overlaps without matching exactly', async () => {
    // The gap the unique index cannot see: 27–31 filed, then 28–29 filed.
    const service = fakeService({
      declarations: [
        {
          student_id: 's1',
          start_date: '2026-08-27',
          end_date: '2026-08-31',
          status: 'pending',
        },
      ],
    });
    const found = await findOverlappingFilings(service as never, {
      startDate: '2026-08-28',
      endDate: '2026-08-29',
      children: KIDS,
    });
    expect(found).toHaveLength(1);
    expect(found[0].studentName).toBe('Ana Reyes');
  });

  it('finds one the OTHER parent filed', async () => {
    // `filed_by` is in the unique index, so the second parent slips past it.
    // This query never looks at who filed.
    const service = fakeService({
      declarations: [
        {
          student_id: 's1',
          start_date: '2026-08-27',
          end_date: '2026-08-27',
          status: 'pending',
        },
      ],
    });
    expect(
      await findOverlappingFilings(service as never, {
        startDate: '2026-08-27',
        endDate: '2026-08-27',
        children: KIDS,
      })
    ).toHaveLength(1);
  });

  it('ignores a rejected filing, so the parent can file again', async () => {
    // Being turned down is exactly when somebody needs to re-file.
    const service = fakeService({
      declarations: [
        {
          student_id: 's1',
          start_date: '2026-08-27',
          end_date: '2026-08-27',
          status: 'rejected',
        },
      ],
    });
    expect(
      await findOverlappingFilings(service as never, {
        startDate: '2026-08-27',
        endDate: '2026-08-27',
        children: KIDS,
      })
    ).toHaveLength(0);
  });

  it('ignores dates that do not overlap', async () => {
    const service = fakeService({
      declarations: [
        {
          student_id: 's1',
          start_date: '2026-08-01',
          end_date: '2026-08-02',
          status: 'approved',
        },
      ],
    });
    expect(
      await findOverlappingFilings(service as never, {
        startDate: '2026-08-27',
        endDate: '2026-08-28',
        children: KIDS,
      })
    ).toHaveLength(0);
  });

  it('ignores another family entirely', async () => {
    const service = fakeService({
      declarations: [
        {
          student_id: 'someone-else',
          start_date: '2026-08-27',
          end_date: '2026-08-27',
          status: 'pending',
        },
      ],
    });
    expect(
      await findOverlappingFilings(service as never, {
        startDate: '2026-08-27',
        endDate: '2026-08-27',
        children: KIDS,
      })
    ).toHaveLength(0);
  });
});

describe('alreadyFiledMessage', () => {
  it('names the child and the dates on record', () => {
    // The commonest cause is the OTHER parent having filed, so "you have
    // already filed this" would be wrong as well as unhelpful.
    const msg = alreadyFiledMessage({
      studentName: 'Ana Reyes',
      startDate: '2026-08-27',
      endDate: '2026-08-31',
    });
    expect(msg).toContain('Ana Reyes');
    expect(msg).toContain('2026-08-27 to 2026-08-31');
    expect(msg).not.toContain('you have already filed');
  });

  it('reads as one day rather than a range when it is one day', () => {
    const msg = alreadyFiledMessage({
      studentName: 'Ana Reyes',
      startDate: '2026-08-27',
      endDate: '2026-08-27',
    });
    expect(msg).toContain('on 2026-08-27.');
    expect(msg).not.toContain(' to ');
  });
});
