import { describe, expect, it } from 'vitest';

import {
  alreadyFiledMessage,
  filingCoversAnySchoolDay,
  findOverlappingFilings,
  type OverlappingFiling,
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

  const filed = (
    start: string,
    end: string,
    status: string,
    type = 'absence',
    studentId = 's1'
  ) => ({
    student_id: studentId,
    start_date: start,
    end_date: end,
    status,
    declaration_type: type,
  });

  const find = (
    service: unknown,
    startDate: string,
    endDate: string,
    declarationType = 'absence'
  ) =>
    findOverlappingFilings(service as never, {
      startDate,
      endDate,
      declarationType,
      children: KIDS,
    });

  it('finds a filing that overlaps without matching exactly', async () => {
    // The gap the unique index cannot see: 27–31 filed, then 28–29 filed.
    const service = fakeService({
      declarations: [filed('2026-08-27', '2026-08-31', 'pending')],
    });
    const found = await find(service, '2026-08-28', '2026-08-29');
    expect(found).toHaveLength(1);
    expect(found[0].studentName).toBe('Ana Reyes');
    // Different dates, so NOT the same request — the route interrupts rather
    // than answering with a filing they did not ask about.
    expect(found[0].isExactMatch).toBe(false);
  });

  it('marks an identical re-send as the SAME request, not an overlap', async () => {
    // ⚠ This is the double-tap migration 125 chose to answer with a success.
    // Losing the distinction would turn a flaky connection into an error and
    // make the parent tap a third time.
    const service = fakeService({
      declarations: [filed('2026-08-27', '2026-08-31', 'pending')],
    });
    const found = await find(service, '2026-08-27', '2026-08-31');
    expect(found[0].isExactMatch).toBe(true);
  });

  it('does not call the same dates a match when the KIND differs', async () => {
    // Travel filed, then an absence for the same days. Same dates, different
    // request — the child cannot be both away travelling and off sick.
    const service = fakeService({
      declarations: [filed('2026-08-27', '2026-08-31', 'pending', 'travel')],
    });
    const found = await find(service, '2026-08-27', '2026-08-31', 'absence');
    expect(found).toHaveLength(1);
    expect(found[0].isExactMatch).toBe(false);
  });

  it('finds one the OTHER parent filed', async () => {
    // `filed_by` is in the unique index, so the second parent slips past it.
    // This query never looks at who filed.
    const service = fakeService({
      declarations: [filed('2026-08-27', '2026-08-27', 'pending')],
    });
    expect(await find(service, '2026-08-27', '2026-08-27')).toHaveLength(1);
  });

  it('ignores a rejected filing, so the parent can file again', async () => {
    // Being turned down is exactly when somebody needs to re-file. Migration
    // 130 narrows the unique index to match this.
    const service = fakeService({
      declarations: [filed('2026-08-27', '2026-08-27', 'rejected')],
    });
    expect(await find(service, '2026-08-27', '2026-08-27')).toHaveLength(0);
  });

  it('ignores a cancelled filing too', async () => {
    const service = fakeService({
      declarations: [filed('2026-08-27', '2026-08-27', 'cancelled')],
    });
    expect(await find(service, '2026-08-27', '2026-08-27')).toHaveLength(0);
  });

  it('reports the status, so the route can tell pending from approved', async () => {
    // Mr Ace, 2026-08-29: re-filing dates that are already approved and being
    // told it worked "is confusing". The route cannot word that differently
    // from a filing still awaiting a decision unless the status comes back
    // with the clash.
    const service = fakeService({
      declarations: [filed('2026-08-27', '2026-08-27', 'approved')],
    });
    const found = await find(service, '2026-08-27', '2026-08-27');
    expect(found[0].status).toBe('approved');
  });

  it('ignores dates that do not overlap', async () => {
    const service = fakeService({
      declarations: [filed('2026-08-01', '2026-08-02', 'approved')],
    });
    expect(await find(service, '2026-08-27', '2026-08-28')).toHaveLength(0);
  });

  it('ignores another family entirely', async () => {
    const service = fakeService({
      declarations: [
        filed('2026-08-27', '2026-08-27', 'pending', 'absence', 'someone-else'),
      ],
    });
    expect(await find(service, '2026-08-27', '2026-08-27')).toHaveLength(0);
  });
});

describe('alreadyFiledMessage', () => {
  const clash = (over: Partial<OverlappingFiling> = {}): OverlappingFiling => ({
    studentName: 'Ana Reyes',
    declarationType: 'absence',
    isExactMatch: false,
    status: 'pending',
    startDate: '2026-08-27',
    endDate: '2026-08-31',
    ...over,
  });

  it('names the child and the dates on record', () => {
    // The commonest cause is the OTHER parent having filed, so "you have
    // already filed this" would be wrong as well as unhelpful.
    const msg = alreadyFiledMessage(clash());
    expect(msg).toContain('Ana Reyes');
    expect(msg).toContain('2026-08-27 to 2026-08-31');
    expect(msg).not.toContain('you have already filed');
  });

  it('reads as one day rather than a range when it is one day', () => {
    const msg = alreadyFiledMessage(
      clash({ startDate: '2026-08-27', endDate: '2026-08-27' })
    );
    expect(msg).toContain('on 2026-08-27');
    expect(msg).not.toContain(' to ');
  });

  it('says the school has not decided yet when the filing is still pending', () => {
    // The parent needs to know it is IN, not that something went wrong —
    // otherwise they file a third time.
    const msg = alreadyFiledMessage(clash({ status: 'pending' }));
    expect(msg).toContain('not decided');
    expect(msg).not.toContain('approved');
  });

  it('says it is already approved when the school has decided', () => {
    // Mr Ace, 2026-08-29: an approved absence must not be re-filed, and the
    // parent must be told which of the two states they are in.
    const msg = alreadyFiledMessage(clash({ status: 'approved' }));
    expect(msg).toContain('already been approved');
    expect(msg).toContain('school office');
  });
});
