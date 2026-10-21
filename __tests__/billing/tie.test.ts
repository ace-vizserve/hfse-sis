import { describe, expect, it } from 'vitest';

import {
  addTypedNumber,
  emptyMaps,
  invoiceNumberKey,
  isTied,
  tieFor,
  typedNumberPlace,
} from '@/lib/billing/tie';

function maps() {
  const m = emptyMaps();
  addTypedNumber(m, 'S1', ' HFSE069021 ', { ayCode: 'AY2027', stage: 'fees' });
  addTypedNumber(m, 'S1', 'HFSE061210', {
    ayCode: 'AY2027',
    stage: 'registration',
  });
  // One number on both stages of a year (one combined invoice).
  addTypedNumber(m, 'S1', 'HFSE050000', { ayCode: 'AY2026', stage: 'fees' });
  addTypedNumber(m, 'S1', 'HFSE050000', {
    ayCode: 'AY2026',
    stage: 'registration',
  });
  // A number typed in two years.
  addTypedNumber(m, 'S1', 'HFSE040000', { ayCode: 'AY2025', stage: 'fees' });
  addTypedNumber(m, 'S1', 'HFSE040000', { ayCode: 'AY2026', stage: 'fees' });
  addTypedNumber(m, 'S2', 'HFSE070000', { ayCode: 'AY2027', stage: 'fees' });
  addTypedNumber(m, 'S2', '   ', { ayCode: 'AY2027', stage: 'registration' });
  return m;
}

describe('invoiceNumberKey', () => {
  it('trims and ignores case; blank is null', () => {
    expect(invoiceNumberKey(' hfse069021 ')).toBe('hfse069021');
    expect(invoiceNumberKey('')).toBeNull();
    expect(invoiceNumberKey('  ')).toBeNull();
    expect(invoiceNumberKey(null)).toBeNull();
  });
});

describe('typedNumberPlace', () => {
  it('matches the student’s typed number, trimmed and case-insensitive', () => {
    expect(typedNumberPlace(maps(), 'S1', 'hfse069021')).toEqual({
      ayCode: 'AY2027',
      stageKeys: ['fees'],
    });
  });
  it('only that student’s numbers count', () => {
    expect(typedNumberPlace(maps(), 'S2', 'HFSE069021')).toBeNull();
    expect(typedNumberPlace(maps(), 'S9', 'HFSE069021')).toBeNull();
  });
  it('both stages of one year → both', () => {
    expect(typedNumberPlace(maps(), 'S1', 'HFSE050000')).toEqual({
      ayCode: 'AY2026',
      stageKeys: ['registration', 'fees'],
    });
  });
  it('typed in two years → the newer year', () => {
    expect(typedNumberPlace(maps(), 'S1', 'HFSE040000')).toEqual({
      ayCode: 'AY2026',
      stageKeys: ['fees'],
    });
  });
  it('no number or no match → null; a blank typed value is never stored', () => {
    expect(typedNumberPlace(maps(), 'S1', null)).toBeNull();
    expect(typedNumberPlace(maps(), 'S1', 'HFSE1')).toBeNull();
    expect(maps().typed.get('S2')?.size).toBe(1);
  });
});

describe('tieFor', () => {
  const base = { studentNumber: 'S1', maps: maps() };
  it('keeps an existing tie of the same student', () => {
    expect(
      tieFor({
        ...base,
        docNumber: 'HFSE069021',
        existing: {
          ayCode: 'AY2026',
          stageKeys: ['registration'],
          studentNumber: 'S1',
        },
        explicit: { stage: 'fees', ayCode: 'AY2027' },
      })
    ).toEqual({
      place: { ayCode: 'AY2026', stageKeys: ['registration'] },
      reason: 'kept',
    });
  });
  it('created from a stage: tied to it', () => {
    expect(
      tieFor({
        ...base,
        docNumber: 'HFSE069021',
        existing: null,
        explicit: { stage: 'registration', ayCode: 'AY2027' },
      })
    ).toEqual({
      place: { ayCode: 'AY2027', stageKeys: ['registration'] },
      reason: 'created',
    });
  });
  it('no tie yet (stored without one): the explicit tie still applies', () => {
    expect(
      tieFor({
        ...base,
        docNumber: null,
        existing: { ayCode: null, stageKeys: [], studentNumber: 'S1' },
        explicit: { stage: 'fees', ayCode: 'AY2027' },
      }).reason
    ).toBe('created');
  });
  it('typed number when there is no tie and no stage', () => {
    expect(
      tieFor({ ...base, docNumber: 'HFSE061210', existing: null })
    ).toEqual({
      place: { ayCode: 'AY2027', stageKeys: ['registration'] },
      reason: 'typed',
    });
  });
  it('nothing matches: no tie — never the income account or the date', () => {
    expect(
      tieFor({ ...base, docNumber: 'HFSE099999', existing: null })
    ).toEqual({ place: { ayCode: null, stageKeys: [] }, reason: 'none' });
  });
  it('an invoice moved to another student drops the old student’s tie', () => {
    expect(
      tieFor({
        ...base,
        docNumber: 'HFSE099999',
        existing: {
          ayCode: 'AY2027',
          stageKeys: ['fees'],
          studentNumber: 'S2',
        },
      }).reason
    ).toBe('none');
  });
});

describe('isTied', () => {
  it('needs a year and a stage', () => {
    expect(isTied({ ayCode: 'AY2027', stageKeys: ['fees'] })).toBe(true);
    expect(isTied({ ayCode: 'AY2027', stageKeys: [] })).toBe(false);
    expect(isTied({ ayCode: null, stageKeys: ['fees'] })).toBe(false);
    expect(isTied({ ayCode: 'AY2027', stageKeys: null })).toBe(false);
  });
});
