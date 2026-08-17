import { describe, expect, it } from 'vitest';

import {
  applyFilterRules,
  countRules,
  distinctValuesFor,
  inferFieldType,
  isRuleReady,
  operatorsFor,
  type FilterGroup,
  type FilterRule,
  type OperatorId,
  type RuleContext,
} from '@/components/ui/data-table/export-filter-rules';

const rule = (
  fieldId: string,
  operator: OperatorId,
  value = ''
): FilterRule => ({
  kind: 'rule',
  id: `${fieldId}-${operator}-${value}`,
  fieldId,
  operator,
  value,
});

const group = (
  conjunction: 'and' | 'or',
  children: FilterGroup['children']
): FilterGroup => ({ kind: 'group', id: 'root', conjunction, children });

// ──────────────────────────────────────────────────────────────────────────
// inferFieldType — the every-value rule
// ──────────────────────────────────────────────────────────────────────────
describe('inferFieldType', () => {
  it('falls back to text when there is nothing to go on', () => {
    expect(inferFieldType([])).toBe('text');
    expect(inferFieldType([null, undefined, ''])).toBe('text');
  });

  it('reads plain numbers and numeric strings as numbers', () => {
    expect(inferFieldType([1, 2, 3])).toBe('number');
    expect(inferFieldType(['1', '2'])).toBe('number');
  });

  it('reads the Yes/No the exporter emits as boolean', () => {
    expect(inferFieldType(['Yes', 'No'])).toBe('boolean');
    expect(inferFieldType([true, false])).toBe('boolean');
  });

  it('reads ISO dates as dates', () => {
    expect(inferFieldType(['2026-01-01', '2026-08-17'])).toBe('date');
    expect(inferFieldType(['2026-08-17T09:00:00Z'])).toBe('date');
  });

  it('does not mistake a bare year for a date', () => {
    // `new Date('2026')` parses, which would make a numeric column date-typed
    // and give it before/after operators that compare nonsense.
    expect(inferFieldType(['2026', '1999'])).toBe('number');
  });

  it('SCANS EVERY VALUE — one stray string demotes a numeric column', () => {
    // The KD #162 lesson: sampling the first non-null value would call this
    // a number column or a text column depending on row order.
    expect(inferFieldType([1, 2, 'n/a'])).toBe('text');
    expect(inferFieldType(['n/a', 1, 2])).toBe('text');
  });

  it('is order-independent for a mixed date column', () => {
    const mixed = ['2026-01-01', 'unknown'];
    expect(inferFieldType(mixed)).toBe('text');
    expect(inferFieldType([...mixed].reverse())).toBe('text');
  });

  it('ignores nulls and blanks when deciding', () => {
    expect(inferFieldType([null, 1, '', 2])).toBe('number');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// operatorsFor
// ──────────────────────────────────────────────────────────────────────────
describe('operatorsFor', () => {
  it('gives text the substring operators and numbers the comparisons', () => {
    expect(operatorsFor('text').map((o) => o.id)).toContain('contains');
    expect(operatorsFor('number').map((o) => o.id)).toContain('gt');
    expect(operatorsFor('number').map((o) => o.id)).not.toContain('contains');
  });

  it('gives dates before/after rather than more/less than', () => {
    const ids = operatorsFor('date').map((o) => o.id);
    expect(ids).toContain('before');
    expect(ids).not.toContain('gt');
  });

  it('marks presence operators as needing no value', () => {
    const isEmpty = operatorsFor('text').find((o) => o.id === 'isEmpty');
    expect(isEmpty?.needsValue).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// distinctValuesFor
// ──────────────────────────────────────────────────────────────────────────
describe('distinctValuesFor', () => {
  it('offers a sorted list for a low-cardinality field', () => {
    expect(distinctValuesFor(['P2', 'P1', 'P1'])).toEqual(['P1', 'P2']);
  });

  it('declines when there are too many to be a menu', () => {
    const many = Array.from({ length: 30 }, (_, i) => `v${i}`);
    expect(distinctValuesFor(many)).toBeNull();
  });

  it('declines when there is nothing to offer', () => {
    expect(distinctValuesFor([null, ''])).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// isRuleReady
// ──────────────────────────────────────────────────────────────────────────
describe('isRuleReady', () => {
  it('is not ready while a value-taking operator has no value', () => {
    expect(isRuleReady(rule('name', 'contains'), 'text')).toBe(false);
    expect(isRuleReady(rule('name', 'contains', '  '), 'text')).toBe(false);
    expect(isRuleReady(rule('name', 'contains', 'a'), 'text')).toBe(true);
  });

  it('is ready immediately for a presence operator', () => {
    expect(isRuleReady(rule('name', 'isEmpty'), 'text')).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// applyFilterRules
// ──────────────────────────────────────────────────────────────────────────
type Row = { name: string | null; level: string; age: number };

const rows: Row[] = [
  { name: 'Alpha', level: 'Primary One', age: 7 },
  { name: 'Bravo', level: 'Primary Two', age: 8 },
  { name: null, level: 'Secondary One', age: 13 },
];

const ctx =
  (types: Record<string, 'text' | 'number' | 'date' | 'boolean'>) =>
  (row: Row): RuleContext => ({
    valueOf: (fieldId) => (row as unknown as Record<string, unknown>)[fieldId],
    typeOf: (fieldId) => types[fieldId] ?? 'text',
  });

const textCtx = ctx({ name: 'text', level: 'text', age: 'number' });

describe('applyFilterRules', () => {
  it('returns every row when there are no rules', () => {
    expect(applyFilterRules(rows, group('and', []), textCtx)).toHaveLength(3);
  });

  it('IGNORES an unfinished rule instead of matching nothing', () => {
    // Adding a rule must not blank the export before a value is typed.
    const out = applyFilterRules(
      rows,
      group('and', [rule('name', 'contains')]),
      textCtx
    );
    expect(out).toHaveLength(3);
  });

  it('matches case-insensitively', () => {
    const out = applyFilterRules(
      rows,
      group('and', [rule('name', 'contains', 'ALPHA')]),
      textCtx
    );
    expect(out.map((r) => r.name)).toEqual(['Alpha']);
  });

  it('combines rules with And', () => {
    const out = applyFilterRules(
      rows,
      group('and', [
        rule('level', 'startsWith', 'Primary'),
        rule('name', 'contains', 'b'),
      ]),
      textCtx
    );
    expect(out.map((r) => r.name)).toEqual(['Bravo']);
  });

  it('combines rules with Or', () => {
    const out = applyFilterRules(
      rows,
      group('or', [
        rule('name', 'equals', 'Alpha'),
        rule('level', 'equals', 'Secondary One'),
      ]),
      textCtx
    );
    expect(out).toHaveLength(2);
  });

  it('nests a group inside a group', () => {
    // level starts with Primary AND (name is Alpha OR age more than 7)
    const out = applyFilterRules(
      rows,
      group('and', [
        rule('level', 'startsWith', 'Primary'),
        {
          kind: 'group',
          id: 'g1',
          conjunction: 'or',
          children: [rule('name', 'equals', 'Alpha'), rule('age', 'gt', '7')],
        },
      ]),
      textCtx
    );
    expect(out.map((r) => r.name)).toEqual(['Alpha', 'Bravo']);
  });

  it('treats a null cell as empty, not as a match', () => {
    const missing = applyFilterRules(
      rows,
      group('and', [rule('name', 'isEmpty')]),
      textCtx
    );
    expect(missing).toHaveLength(1);

    const contains = applyFilterRules(
      rows,
      group('and', [rule('name', 'contains', 'a')]),
      textCtx
    );
    expect(contains.every((r) => r.name != null)).toBe(true);
  });

  it("does not let Doesn't contain resurrect an empty cell", () => {
    // A null name genuinely does not contain "x", but reporting it here
    // would mean a filter that excludes a value silently pulls in blanks.
    const out = applyFilterRules(
      rows,
      group('and', [rule('name', 'notContains', 'x')]),
      textCtx
    );
    expect(out.map((r) => r.name)).toEqual(['Alpha', 'Bravo']);
  });

  it('compares numbers numerically, not as strings', () => {
    const out = applyFilterRules(
      rows,
      group('and', [rule('age', 'gt', '9')]),
      textCtx
    );
    expect(out.map((r) => r.age)).toEqual([13]);
  });

  it('ignores an empty nested group', () => {
    const out = applyFilterRules(
      rows,
      group('and', [
        rule('level', 'startsWith', 'Primary'),
        { kind: 'group', id: 'g1', conjunction: 'or', children: [] },
      ]),
      textCtx
    );
    expect(out).toHaveLength(2);
  });
});

describe('countRules', () => {
  it('counts rules through nesting', () => {
    expect(
      countRules(
        group('and', [
          rule('a', 'contains', '1'),
          {
            kind: 'group',
            id: 'g',
            conjunction: 'or',
            children: [rule('b', 'contains', '2'), rule('c', 'contains', '3')],
          },
        ])
      )
    ).toBe(3);
  });
});
