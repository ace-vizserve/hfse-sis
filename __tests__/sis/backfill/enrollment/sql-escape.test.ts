import { describe, expect, it } from 'vitest';

import {
  sqlString,
  sqlStringOrNull,
} from '@/lib/sis/backfill/enrollment/sql-escape';

describe('sqlString', () => {
  it('quotes a plain string', () => {
    expect(sqlString('Patience')).toBe("'Patience'");
  });

  it('doubles embedded single quotes', () => {
    expect(sqlString("D'Angelo")).toBe("'D''Angelo'");
  });

  it('handles multiple embedded quotes', () => {
    expect(sqlString("O'Brien's")).toBe("'O''Brien''s'");
  });
});

describe('sqlStringOrNull', () => {
  it('quotes a non-empty string', () => {
    expect(sqlStringOrNull('Ms. Kristel')).toBe("'Ms. Kristel'");
  });

  it('emits NULL for null', () => {
    expect(sqlStringOrNull(null)).toBe('NULL');
  });

  it('emits NULL for undefined', () => {
    expect(sqlStringOrNull(undefined)).toBe('NULL');
  });

  it('emits NULL for an empty/whitespace string', () => {
    expect(sqlStringOrNull('')).toBe('NULL');
    expect(sqlStringOrNull('   ')).toBe('NULL');
  });
});
