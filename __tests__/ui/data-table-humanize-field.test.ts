import { describe, expect, it } from 'vitest';

import { humanizeFieldName } from '@/components/ui/data-table/humanize-field';

describe('humanizeFieldName', () => {
  it('splits camelCase into title case', () => {
    expect(humanizeFieldName('preferredPaymentScheme')).toBe(
      'Preferred Payment Scheme'
    );
  });

  it('splits snake_case into title case', () => {
    expect(humanizeFieldName('reason_category')).toBe('Reason Category');
  });

  it('handles a single lowercase word', () => {
    expect(humanizeFieldName('status')).toBe('Status');
  });

  it('handles consecutive uppercase runs without inserting extra spaces mid-run', () => {
    expect(humanizeFieldName('enroleeNumber')).toBe('Enrolee Number');
  });

  it('collapses mixed separators and casing', () => {
    expect(humanizeFieldName('foo_barBaz-qux')).toBe('Foo Bar Baz Qux');
  });
});
