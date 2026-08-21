import { describe, expect, it } from 'vitest';

import {
  DISCIPLINE_DETAILS_MAX,
  DISCIPLINE_NATURE_MAX,
  DISCIPLINE_RECORD_TYPE_LABELS,
  DISCIPLINE_RECORD_TYPE_VALUES,
  DISCIPLINE_URL_MAX,
  DisciplineRecordSchema,
} from '@/lib/schemas/discipline';

/**
 * Local-calendar dates, built the same way the schema builds "today".
 *
 * Deliberately NOT `toISOString().slice(0, 10)`: Singapore is UTC+8, so on a
 * machine in SGT the UTC date is yesterday until 8am, and a test written that
 * way would pass all afternoon and fail every morning.
 */
function localIsoOffsetByDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const TODAY = localIsoOffsetByDays(0);

function valid(overrides: Record<string, unknown> = {}) {
  return {
    record_type: 'incident',
    occurred_on: TODAY,
    nature: 'Pushing in the canteen queue',
    details: 'Two students were separated by the duty teacher.',
    ...overrides,
  };
}

describe('DisciplineRecordSchema', () => {
  it('accepts a filled-in incident', () => {
    expect(DisciplineRecordSchema.safeParse(valid()).success).toBe(true);
  });

  it('accepts a letter, which is the other half of one list', () => {
    const r = DisciplineRecordSchema.safeParse(
      valid({ record_type: 'letter', nature: 'First warning — attendance' })
    );
    expect(r.success).toBe(true);
  });

  it('rejects a record type the school does not have', () => {
    expect(
      DisciplineRecordSchema.safeParse(valid({ record_type: 'suspension' }))
        .success
    ).toBe(false);
  });

  describe('the date', () => {
    it('accepts today', () => {
      expect(
        DisciplineRecordSchema.safeParse(valid({ occurred_on: TODAY })).success
      ).toBe(true);
    });

    it('accepts a date in the past — a letter is often filed days later', () => {
      expect(
        DisciplineRecordSchema.safeParse(
          valid({ occurred_on: localIsoOffsetByDays(-30) })
        ).success
      ).toBe(true);
    });

    // The database deliberately carries no `current_date` CHECK (it is not
    // immutable and would revalidate on a dump/restore), so this schema is the
    // ONLY thing standing between a typo and a record filed in the future.
    it('rejects tomorrow', () => {
      const r = DisciplineRecordSchema.safeParse(
        valid({ occurred_on: localIsoOffsetByDays(1) })
      );
      expect(r.success).toBe(false);
      expect(r.success === false && r.error.issues[0]?.message).toMatch(
        /future/i
      );
    });

    it('rejects a date that is not YYYY-MM-DD', () => {
      expect(
        DisciplineRecordSchema.safeParse(valid({ occurred_on: '25/05/2026' }))
          .success
      ).toBe(false);
    });

    it('rejects a missing date', () => {
      const body = valid();
      delete (body as Record<string, unknown>).occurred_on;
      expect(DisciplineRecordSchema.safeParse(body).success).toBe(false);
    });
  });

  describe('the time', () => {
    it('accepts HH:MM', () => {
      expect(
        DisciplineRecordSchema.safeParse(valid({ occurred_at_time: '14:05' }))
          .success
      ).toBe(true);
    });

    // The school's own incident form is routinely filed without one, and a
    // letter has a date but no clock time at all.
    it('accepts a blank time', () => {
      expect(
        DisciplineRecordSchema.safeParse(valid({ occurred_at_time: null }))
          .success
      ).toBe(true);
      expect(DisciplineRecordSchema.safeParse(valid()).success).toBe(true);
    });

    it('rejects a 25th hour', () => {
      expect(
        DisciplineRecordSchema.safeParse(valid({ occurred_at_time: '25:00' }))
          .success
      ).toBe(false);
    });

    it('rejects seconds, which the form never collects', () => {
      expect(
        DisciplineRecordSchema.safeParse(
          valid({ occurred_at_time: '14:05:30' })
        ).success
      ).toBe(false);
    });
  });

  describe('nature — the school form’s "Nature of incident"', () => {
    it('is required', () => {
      expect(
        DisciplineRecordSchema.safeParse(valid({ nature: '' })).success
      ).toBe(false);
    });

    it('rejects whitespace pretending to be a value', () => {
      expect(
        DisciplineRecordSchema.safeParse(valid({ nature: '   ' })).success
      ).toBe(false);
    });

    it('trims', () => {
      const r = DisciplineRecordSchema.safeParse(valid({ nature: '  Late  ' }));
      expect(r.success && r.data.nature).toBe('Late');
    });

    // Free text ON PURPOSE — their field reads as a picklist but only one
    // value has ever been seen, and the list has been asked for and not
    // supplied. A schema written from one sample would reject the school's own
    // vocabulary on day one.
    it('accepts a value nobody has shown us yet', () => {
      expect(
        DisciplineRecordSchema.safeParse(
          valid({ nature: 'Something the school invents next term' })
        ).success
      ).toBe(true);
    });

    it('rejects a nature longer than the cap', () => {
      expect(
        DisciplineRecordSchema.safeParse(
          valid({ nature: 'a'.repeat(DISCIPLINE_NATURE_MAX + 1) })
        ).success
      ).toBe(false);
    });
  });

  describe('details and remarks', () => {
    it('defaults details to empty — the nature line can stand alone', () => {
      const body = valid();
      delete (body as Record<string, unknown>).details;
      const r = DisciplineRecordSchema.safeParse(body);
      expect(r.success).toBe(true);
      expect(r.success && r.data.details).toBe('');
    });

    it('accepts details exactly at the cap', () => {
      expect(
        DisciplineRecordSchema.safeParse(
          valid({ details: 'a'.repeat(DISCIPLINE_DETAILS_MAX) })
        ).success
      ).toBe(true);
    });

    it('rejects details over the cap', () => {
      expect(
        DisciplineRecordSchema.safeParse(
          valid({ details: 'a'.repeat(DISCIPLINE_DETAILS_MAX + 1) })
        ).success
      ).toBe(false);
    });

    it('accepts an omitted remark and an explicitly cleared one', () => {
      expect(DisciplineRecordSchema.safeParse(valid()).success).toBe(true);
      expect(
        DisciplineRecordSchema.safeParse(valid({ remarks: null })).success
      ).toBe(true);
    });
  });

  describe('the document link (migration 121)', () => {
    it('accepts a plain https link', () => {
      const r = DisciplineRecordSchema.safeParse(
        valid({ document_url: 'https://hfse.sharepoint.com/case-702.pdf' })
      );
      expect(r.success).toBe(true);
    });

    // Real SharePoint and Drive links are long and full of query string. A
    // validator with opinions about that would reject the links people
    // actually have.
    it('accepts a long link with a query string', () => {
      const url = `https://drive.example.com/file/d/${'a'.repeat(60)}/view?usp=sharing&x=1`;
      expect(
        DisciplineRecordSchema.safeParse(valid({ document_url: url })).success
      ).toBe(true);
    });

    // The security-relevant half: this value ends up in an href.
    it.each(['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc'])(
      'rejects %s',
      (bad) => {
        expect(
          DisciplineRecordSchema.safeParse(valid({ document_url: bad })).success
        ).toBe(false);
      }
    );

    it('rejects something that is not a web address', () => {
      expect(
        DisciplineRecordSchema.safeParse(valid({ document_url: 'the letter' }))
          .success
      ).toBe(false);
    });

    // Clearing a link has to be possible: a form that was typed into and then
    // emptied submits '', not undefined.
    it('accepts an empty string, a null and an omission', () => {
      expect(
        DisciplineRecordSchema.safeParse(valid({ document_url: '' })).success
      ).toBe(true);
      expect(
        DisciplineRecordSchema.safeParse(valid({ document_url: null })).success
      ).toBe(true);
      expect(DisciplineRecordSchema.safeParse(valid()).success).toBe(true);
    });

    it('rejects a link over the length cap', () => {
      expect(
        DisciplineRecordSchema.safeParse({
          ...valid(),
          document_url: `https://x.test/${'a'.repeat(DISCIPLINE_URL_MAX)}`,
        }).success
      ).toBe(false);
    });
  });

  // The warning letter ends with a tear-off slip the parent signs and returns
  // within two days, so a letter is not finished when it is sent (migration
  // 122). Both rules below are CHECK constraints as well.
  describe('the parent acknowledgement', () => {
    const letter = (overrides: Record<string, unknown> = {}) =>
      valid({
        record_type: 'letter',
        nature: 'First warning — attendance',
        occurred_on: localIsoOffsetByDays(-10),
        ...overrides,
      });

    it('accepts a letter whose slip has come back', () => {
      const r = DisciplineRecordSchema.safeParse(
        letter({ acknowledged_on: localIsoOffsetByDays(-8) })
      );
      expect(r.success).toBe(true);
    });

    it('accepts a letter with no slip back yet', () => {
      expect(DisciplineRecordSchema.safeParse(letter()).success).toBe(true);
      expect(
        DisciplineRecordSchema.safeParse(letter({ acknowledged_on: null }))
          .success
      ).toBe(true);
    });

    it('accepts a slip returned the same day the letter went out', () => {
      const day = localIsoOffsetByDays(-3);
      expect(
        DisciplineRecordSchema.safeParse(
          letter({ occurred_on: day, acknowledged_on: day })
        ).success
      ).toBe(true);
    });

    it('rejects a slip that came back before the letter went out', () => {
      const r = DisciplineRecordSchema.safeParse(
        letter({
          occurred_on: localIsoOffsetByDays(-5),
          acknowledged_on: localIsoOffsetByDays(-6),
        })
      );
      expect(r.success).toBe(false);
      expect(r.success === false && r.error.issues[0]?.message).toMatch(
        /before the letter went out/i
      );
    });

    // An incident has nothing for a parent to acknowledge. This is the case
    // that matters on an EDIT — switching a letter to an incident must not
    // strand the date.
    it('rejects an acknowledgement on an incident', () => {
      const r = DisciplineRecordSchema.safeParse(
        valid({ acknowledged_on: TODAY })
      );
      expect(r.success).toBe(false);
      expect(r.success === false && r.error.issues[0]?.message).toMatch(
        /only a letter/i
      );
    });

    it('rejects a slip dated in the future', () => {
      expect(
        DisciplineRecordSchema.safeParse(
          letter({ acknowledged_on: localIsoOffsetByDays(1) })
        ).success
      ).toBe(false);
    });
  });

  // The school's form identifies the filer by office ("Academics"), not by
  // class role — Chandana, 2026-08-14.
  it('accepts an optional office', () => {
    const r = DisciplineRecordSchema.safeParse(
      valid({ filed_by_office: 'Academics' })
    );
    expect(r.success && r.data.filed_by_office).toBe('Academics');
  });

  it('rejects a body that is not an object at all', () => {
    expect(DisciplineRecordSchema.safeParse(null).success).toBe(false);
  });

  it('never reports a raw zod type error to a school admin', () => {
    // Every field carries its own wording, so a half-filled form must not
    // answer "Invalid input: expected string, received undefined".
    const r = DisciplineRecordSchema.safeParse({});
    expect(r.success).toBe(false);
    if (r.success) return;
    for (const issue of r.error.issues) {
      expect(issue.message).not.toMatch(/expected \w+, received/i);
    }
  });
});

describe('record type vocabulary', () => {
  it('labels every value, so no database word can reach a screen', () => {
    for (const value of DISCIPLINE_RECORD_TYPE_VALUES) {
      expect(DISCIPLINE_RECORD_TYPE_LABELS[value]).toBeTruthy();
      expect(DISCIPLINE_RECORD_TYPE_LABELS[value]).not.toBe(value);
    }
  });
});
