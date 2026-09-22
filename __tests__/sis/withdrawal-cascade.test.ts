import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  StageWithdrawalDatesSchema,
  buildCascadeSectionPatch,
  buildCascadeWithdrawalNotes,
  mapTerminalReasonToWithdrawalReason,
  withdrawalDateRequiredError,
} from '@/lib/sis/withdrawal-cascade';
import { proseLength } from '@/lib/rich-text';
import { WITHDRAWAL_REASON_MAX } from '@/lib/schemas/enrolment';

describe('stage withdrawal cascade — dates are the registrar’s, never today', () => {
  it('writes exactly the dates it was given', () => {
    const patch = buildCascadeSectionPatch({
      dates: {
        withdrawal_date: '2026-04-26',
        withdrawal_approved_date: '2026-05-11',
      },
      terminalReason: 'family_relocation',
      terminalNotes: null,
    });
    expect(patch).toEqual({
      enrollment_status: 'withdrawn',
      withdrawal_date: '2026-04-26',
      withdrawal_approved_date: '2026-05-11',
      withdrawal_reason: 'family_relocation',
      withdrawal_notes: null,
    });
  });

  it('leaves an unknown approval date blank rather than filling it', () => {
    const patch = buildCascadeSectionPatch({
      dates: { withdrawal_date: '2026-04-26', withdrawal_approved_date: null },
      terminalReason: 'health',
      terminalNotes: null,
    });
    expect(patch.withdrawal_approved_date).toBeNull();
  });

  it('refuses a withdrawal from a class without a last day', () => {
    expect(
      withdrawalDateRequiredError({
        activeClassRows: 1,
        hasAttendance: true,
        dates: { withdrawal_date: null, withdrawal_approved_date: null },
      })
    ).toMatchObject({ code: 'withdrawal_date_required' });
  });

  it('does not ask for a last day when the applicant never had a class', () => {
    expect(
      withdrawalDateRequiredError({
        activeClassRows: 0,
        hasAttendance: false,
        dates: { withdrawal_date: null, withdrawal_approved_date: null },
      })
    ).toBeNull();
  });

  it('does not ask for a last day when the class has no attendance behind it', () => {
    // The YS Youngstarters case, measured 2026-09-22: a full roster of 15 with
    // ZERO attendance marks, while every other section holds 1,000–4,400. The
    // form was demanding "the last day they actually attended" from the one
    // cohort that has never been marked present or absent.
    expect(
      withdrawalDateRequiredError({
        activeClassRows: 1,
        hasAttendance: false,
        dates: { withdrawal_date: null, withdrawal_approved_date: null },
      })
    ).toBeNull();
  });

  it('still refuses when attendance exists, however many class rows', () => {
    // The relaxation must not leak into the case it was never meant to touch:
    // a transferred student holds two rows (KD #67) and has a real register.
    expect(
      withdrawalDateRequiredError({
        activeClassRows: 2,
        hasAttendance: true,
        dates: { withdrawal_date: null, withdrawal_approved_date: null },
      })
    ).toMatchObject({ code: 'withdrawal_date_required' });
  });

  it('accepts a last day when the student is in a class', () => {
    expect(
      withdrawalDateRequiredError({
        activeClassRows: 2,
        hasAttendance: true,
        dates: {
          withdrawal_date: '2026-04-26',
          withdrawal_approved_date: null,
        },
      })
    ).toBeNull();
  });
});

describe('StageWithdrawalDatesSchema', () => {
  it('reads blank and absent as not known', () => {
    expect(StageWithdrawalDatesSchema.parse({})).toEqual({
      withdrawal_date: null,
      withdrawal_approved_date: null,
    });
    expect(
      StageWithdrawalDatesSchema.parse({
        withdrawal_date: '',
        withdrawal_approved_date: null,
      })
    ).toEqual({ withdrawal_date: null, withdrawal_approved_date: null });
  });

  it('rejects a date that is not YYYY-MM-DD', () => {
    expect(
      StageWithdrawalDatesSchema.safeParse({ withdrawal_date: '26/04/2026' })
        .success
    ).toBe(false);
  });
});

describe('application reason → class reason', () => {
  it('maps the reasons both lists share', () => {
    expect(mapTerminalReasonToWithdrawalReason('chose_another_school')).toBe(
      'transferred_other_school'
    );
    expect(mapTerminalReasonToWithdrawalReason('financial')).toBe('financial');
    expect(mapTerminalReasonToWithdrawalReason('family_relocation')).toBe(
      'family_relocation'
    );
    expect(mapTerminalReasonToWithdrawalReason('health')).toBe('health');
  });

  it('falls back to other and keeps the admissions wording in the notes', () => {
    expect(mapTerminalReasonToWithdrawalReason('visa_denied')).toBe('other');
    expect(buildCascadeWithdrawalNotes('visa_denied', null)).toBe(
      '<p>Pass / visa application denied</p>'
    );
    expect(
      buildCascadeWithdrawalNotes('lost_interest', '<p>No reply</p>')
    ).toBe('<p>Lost interest / no response</p><p>No reply</p>');
  });

  it('passes notes through untouched when the reason maps directly', () => {
    expect(buildCascadeWithdrawalNotes('health', '  <p>Surgery</p>  ')).toBe(
      '<p>Surgery</p>'
    );
    expect(buildCascadeWithdrawalNotes('other', 'Moving abroad')).toBe(
      'Moving abroad'
    );
  });

  // The roster sheet re-sends these notes on every save through
  // `optionalRichText(WITHDRAWAL_REASON_MAX)`; a value it refuses would lock
  // that child's sheet against every later edit.
  it('always produces notes the roster schema accepts', () => {
    expect(buildCascadeWithdrawalNotes('health', '<p></p>')).toBeNull();
    expect(buildCascadeWithdrawalNotes('visa_denied', '<p></p>')).toBe(
      '<p>Pass / visa application denied</p>'
    );
    const long = `<p>${'x'.repeat(195)}</p>`;
    const out = buildCascadeWithdrawalNotes('visa_denied', long);
    expect(out).toBe(long);
    expect(proseLength(out)).toBeLessThanOrEqual(WITHDRAWAL_REASON_MAX);
  });
});

// Source guards. The property worth protecting is "no writer of a withdrawal
// stamps today", which no single runtime assertion can express across files.
describe('no roster writer invents a withdrawal date', () => {
  const WRITERS = [
    'app/api/sis/students/[enroleeNumber]/stage/[stageKey]/route.ts',
    'app/api/students/sync/route.ts',
    'lib/sync/students.ts',
    'app/api/sections/[id]/students/[enrolmentId]/route.ts',
  ];
  it.each(WRITERS)('%s never pairs withdrawal_date with sgToday()', (path) => {
    const src = readFileSync(path, 'utf8');
    expect(src).not.toMatch(/withdrawal_date\s*[:=]\s*(sgToday\(\)|today\b)/);
    expect(src).not.toMatch(/withdrawal_date\s*[:=]\s*todayDate/);
  });
});

describe('auto-sync is reachable by Vercel Cron', () => {
  it('exports GET (Vercel Cron calls cron paths with GET)', () => {
    const src = readFileSync('app/api/sis/students/auto-sync/route.ts', 'utf8');
    expect(src).toMatch(/export async function GET\(/);
    expect(src).toMatch(/export async function POST\(/);
  });
});
