import { describe, expect, it } from 'vitest';

import {
  READY_FOR_INVOICING_STATUS_SELECT,
  buildReadyForInvoicingRows,
  compareReadyForInvoicing,
  daysSince,
  plainRemarks,
  type ReadyForInvoicingIdentity,
  type ReadyForInvoicingRow,
} from '@/lib/admissions/ready-for-invoicing';
import { STAGE_COLUMN_MAP } from '@/lib/schemas/sis';

const ID: ReadyForInvoicingIdentity = {
  ayCode: 'AY2026',
  enroleeNumber: 'E260160',
  studentNumber: 'H260001',
  studentName: 'Fernandes, Bianca',
  level: 'Primary One',
};

describe('buildReadyForInvoicingRows', () => {
  it('gives one row per stage ticked Ready for invoicing', () => {
    const rows = buildReadyForInvoicingRows(ID, {
      applicationStatus: 'Submitted',
      registrationStatus: 'Ready for invoicing',
      registrationUpdatedby: 'ana@hfse.test',
      registrationUpdateDate: '2026-10-01T01:00:00Z',
      registrationRemarks: '<p>Sibling discount</p>',
      feeStatus: 'Ready for invoicing',
      feeUpdatedby: 'ben@hfse.test',
      feeUpdatedDate: '2026-10-02T03:00:00Z',
      feeRemarks: null,
    });
    expect(rows.map((r) => r.stage)).toEqual(['registration', 'fees']);
    expect(rows[0]).toMatchObject({
      tickedBy: 'ana@hfse.test',
      tickedOn: '2026-10-01',
      remarks: 'Sibling discount',
      applicationStatus: 'Submitted',
      studentNumber: 'H260001',
    });
    expect(rows[1]).toMatchObject({
      tickedBy: 'ben@hfse.test',
      tickedOn: '2026-10-02',
      remarks: null,
    });
  });

  it('includes any application status, enrolled included', () => {
    for (const applicationStatus of [
      'Enrolled',
      'Enrolled (Conditional)',
      'Withdrawn',
      null,
    ]) {
      const rows = buildReadyForInvoicingRows(ID, {
        applicationStatus,
        feeStatus: 'Ready for invoicing',
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].stage).toBe('fees');
    }
  });

  it('matches the status exactly', () => {
    for (const s of [
      'ready for invoicing',
      ' Ready for invoicing',
      'Unpaid',
      'Paid',
      '',
      null,
    ]) {
      expect(
        buildReadyForInvoicingRows(ID, {
          registrationStatus: s,
          feeStatus: s,
        })
      ).toEqual([]);
    }
  });

  it('dates the tick in Singapore, not UTC', () => {
    // 20 Oct 17:30 UTC is already 21 Oct in Singapore.
    const [row] = buildReadyForInvoicingRows(ID, {
      registrationStatus: 'Ready for invoicing',
      registrationUpdateDate: '2026-10-20T17:30:00Z',
    });
    expect(row.tickedOn).toBe('2026-10-21');
    // A bare date stays as it is.
    const [bare] = buildReadyForInvoicingRows(ID, {
      registrationStatus: 'Ready for invoicing',
      registrationUpdateDate: '2026-10-20',
    });
    expect(bare.tickedOn).toBe('2026-10-20');
  });

  it('reads the columns STAGE_COLUMN_MAP names, all in the select', () => {
    const select = READY_FOR_INVOICING_STATUS_SELECT.split(',').map((c) =>
      c.trim()
    );
    for (const stage of ['registration', 'fees'] as const) {
      const c = STAGE_COLUMN_MAP[stage];
      for (const col of [
        c.statusCol,
        c.remarksCol,
        c.updatedDateCol,
        c.updatedByCol,
      ]) {
        expect(select).toContain(col);
      }
    }
  });
});

describe('compareReadyForInvoicing', () => {
  const row = (over: Partial<ReadyForInvoicingRow>): ReadyForInvoicingRow => ({
    ...ID,
    applicationStatus: null,
    stage: 'registration',
    tickedBy: null,
    tickedOn: null,
    remarks: null,
    ...over,
  });

  it('puts the oldest tick first and unknown dates last', () => {
    const sorted = [
      row({ studentName: 'C', tickedOn: null }),
      row({ studentName: 'B', tickedOn: '2026-10-05' }),
      row({ studentName: 'A', tickedOn: '2026-09-01' }),
    ].sort(compareReadyForInvoicing);
    expect(sorted.map((r) => r.studentName)).toEqual(['A', 'B', 'C']);
  });

  it('keeps Registration before Fees for the same child', () => {
    const sorted = [
      row({ stage: 'fees', tickedOn: '2026-10-01' }),
      row({ stage: 'registration', tickedOn: '2026-10-01' }),
    ].sort(compareReadyForInvoicing);
    expect(sorted.map((r) => r.stage)).toEqual(['registration', 'fees']);
  });
});

describe('helpers', () => {
  it('plainRemarks strips tags and entities', () => {
    expect(plainRemarks('<p>Pay&nbsp;by <b>Friday</b></p><p>Thanks</p>')).toBe(
      'Pay by Friday Thanks'
    );
    expect(plainRemarks('<p></p>')).toBeNull();
    expect(plainRemarks(null)).toBeNull();
  });

  it('daysSince counts whole days', () => {
    expect(daysSince('2026-10-01', '2026-10-21')).toBe(20);
    expect(daysSince('2026-10-21', '2026-10-21')).toBe(0);
  });
});
