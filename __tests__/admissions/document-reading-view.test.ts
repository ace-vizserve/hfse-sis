import { describe, expect, it } from 'vitest';

import {
  compareReading,
  qualityFacts,
  qualityNotes,
  readingOutcome,
} from '@/lib/admissions/document-reading-view';

const TODAY = '2026-11-03';
const MINE = { expiry: '2030-11-14', number: 'P1234567A' };
const OTHER = { expiry: '2029-05-22', number: 'P2263418B' };
const read = (
  ...passports: { expiry: string | null; number: string | null }[]
) => ({
  status: 'read' as const,
  passports,
  quality: null,
});

const CLEAR = {
  pages: 1,
  totalPages: 1,
  fileBytes: 1000,
  hasText: true,
  width: null,
  height: null,
  sharpness: 900,
  inkRatio: 0.1,
  brightness: 200,
  contrast: 40,
};

describe('qualityNotes', () => {
  it('has nothing to say about a clear scan, or an unmeasured one', () => {
    expect(qualityNotes(CLEAR)).toEqual([]);
    expect(qualityNotes(null)).toEqual([]);
  });

  it('calls a nearly empty page that and nothing else', () => {
    // Real uploads: a page saying only "To Be Provided Later", or "MED. EXAM".
    expect(
      qualityNotes({ ...CLEAR, inkRatio: 0.001, contrast: 4, sharpness: 50 })
    ).toEqual(['Nearly blank']);
  });

  it('notes each problem it finds', () => {
    expect(
      qualityNotes({
        ...CLEAR,
        sharpness: 10,
        brightness: 40,
        contrast: 5,
        width: 200,
        height: 260,
      })
    ).toEqual([
      'Looks blurry',
      'Very dark',
      'Washed out',
      'Small image (200×260)',
    ]);
  });

  it('leaves alone what real uploads showed to be fine', () => {
    // A sharp scan of a pass, an ID photo on a dark backdrop, a large photo, and
    // a normal photo, whose edges are far softer than a scanned page's.
    expect(qualityNotes({ ...CLEAR, sharpness: 265 })).toEqual([]);
    expect(
      qualityNotes({ ...CLEAR, sharpness: 66, width: 1468, height: 1300 })
    ).toEqual([]);
    expect(qualityNotes({ ...CLEAR, brightness: 81 })).toEqual([]);
    expect(qualityNotes({ ...CLEAR, width: 1468, height: 1300 })).toEqual([]);
  });
});

describe('qualityFacts', () => {
  it('describes a scan in words', () => {
    expect(
      qualityFacts({
        ...CLEAR,
        hasText: false,
        totalPages: 2,
        fileBytes: 2097152,
      })
    ).toEqual({
      kind: 'Scanned or photographed PDF',
      pages: '2 pages',
      size: '2.0 MB',
      sharpness: 'Sharp',
      content: 'Has content',
      brightness: 'Normal',
      contrast: 'Normal',
    });
  });

  it('describes a PDF with text, and a poor one', () => {
    expect(
      qualityFacts({
        ...CLEAR,
        sharpness: 50,
        inkRatio: 0.001,
        brightness: 30,
        contrast: 5,
      })
    ).toEqual({
      kind: 'PDF with real text',
      pages: '1 page',
      size: '1 KB',
      sharpness: 'Blurry',
      content: 'Almost nothing on it',
      brightness: 'Very dark',
      contrast: 'Washed out',
    });
  });

  it('describes a photo, and a page with little on it', () => {
    const facts = qualityFacts({
      ...CLEAR,
      width: 600,
      height: 800,
      sharpness: 66,
      inkRatio: 0.01,
    });
    expect(facts).toMatchObject({
      kind: 'Photo, 600 × 800 px',
      sharpness: 'Sharp',
      content: 'Mostly empty page',
    });
  });
});

describe('compareReading', () => {
  const FULL = {
    expiry: '2030-11-14',
    number: 'P1234567A',
    birthDate: '2015-01-01',
    name: 'TAN, MEI LING',
    nationality: 'SGP',
    sex: 'F',
  };

  it('carries the rest of what was read, and when', () => {
    const view = compareReading(
      {
        status: 'read',
        passports: [FULL],
        quality: null,
        checkedAt: '2026-11-03T08:00:00Z',
      },
      {
        number: 'P1234567A',
        expiry: '2030-11-14',
        name: 'Tan Mei Ling Sofia',
        birthDate: '2015-01-01T00:00:00Z',
      },
      TODAY
    );
    expect(view).toMatchObject({
      birthDateMatches: true,
      nameMatches: true,
      readName: 'TAN, MEI LING',
      nationality: 'SGP',
      sex: 'F',
      checkedAt: '2026-11-03T08:00:00Z',
    });
    expect(readingOutcome(view)).toBe('matches');
  });

  it('flags a birth date that differs, and notes a name that does', () => {
    const view = compareReading(
      read(FULL),
      {
        number: 'P1234567A',
        expiry: '2030-11-14',
        name: 'Lim Wei',
        birthDate: '2014-01-01',
      },
      TODAY
    );
    expect(view).toMatchObject({ birthDateMatches: false, nameMatches: false });
    expect(readingOutcome(view)).toBe('differs');
  });

  it('compares neither when a side is blank', () => {
    expect(
      compareReading(read(FULL), { number: null, expiry: null }, TODAY)
    ).toMatchObject({
      birthDateMatches: null,
      nameMatches: null,
      checkedAt: null,
    });
  });

  it('matches ignoring case, spaces and the time on a stored date', () => {
    const view = compareReading(
      read(MINE),
      { number: ' p123 4567a ', expiry: '2030-11-14T00:00:00+00:00' },
      TODAY
    );
    expect(view).toMatchObject({
      numberMatches: true,
      expiryMatches: true,
      expired: false,
    });
    expect(readingOutcome(view)).toBe('matches');
  });

  it('flags a number and an expiry that differ', () => {
    const view = compareReading(
      read(MINE),
      { number: 'P9999999Z', expiry: '2031-01-01' },
      TODAY
    );
    expect(view).toMatchObject({ numberMatches: false, expiryMatches: false });
    expect(readingOutcome(view)).toBe('differs');
  });

  it('flags an old passport as expired, whatever was entered', () => {
    const view = compareReading(
      read({ expiry: '2023-10-21', number: 'P9258348A' }),
      { number: 'P9258348A', expiry: '2028-04-17' },
      TODAY
    );
    expect(view.expired).toBe(true);
    expect(readingOutcome(view)).toBe('expired');
  });

  it('compares nothing when a side is blank', () => {
    const view = compareReading(
      read({ expiry: '2030-11-14', number: null }),
      { number: 'P1234567A', expiry: null },
      TODAY
    );
    expect(view).toMatchObject({
      numberMatches: null,
      expiryMatches: null,
      readNumber: null,
      enteredExpiry: null,
    });
    expect(readingOutcome(view)).toBe('matches');
  });

  it.each([
    ['number', { number: 'P2263418B', expiry: null }],
    ['expiry', { number: null, expiry: '2029-05-22' }],
  ])('picks the passport in a file by its %s', (_, entered) => {
    const view = compareReading(read(MINE, OTHER), entered, TODAY);
    expect(view).toMatchObject({ readNumber: 'P2263418B', passportCount: 2 });
  });

  it('falls back to the first passport when neither matches', () => {
    const view = compareReading(
      read(MINE, OTHER),
      { number: 'X', expiry: '2040-01-01' },
      TODAY
    );
    expect(view.readNumber).toBe('P1234567A');
  });

  it('carries the quality of a document it did not read', () => {
    const view = compareReading(
      { status: 'not_read', passports: [], quality: CLEAR },
      { number: null, expiry: null },
      TODAY
    );
    expect(view.quality).toEqual(CLEAR);
    expect(readingOutcome(view)).toBe('quality-only');
  });

  it.each(['unreadable', 'timed_out', 'failed'] as const)(
    'reports a %s file as not read',
    (status) => {
      const view = compareReading(
        { status, passports: [], quality: null },
        { number: 'P1', expiry: '2030-01-01' },
        TODAY
      );
      expect(view).toMatchObject({
        readNumber: null,
        readExpiry: null,
        passportCount: 0,
      });
      expect(readingOutcome(view)).toBe('not-read');
    }
  );
});
