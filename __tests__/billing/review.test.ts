import { describe, expect, it } from 'vitest';

import {
  groupForReview,
  hfseCustomerName,
  reviewReason,
} from '@/lib/billing/review';

describe('reviewReason', () => {
  it('no candidates', () =>
    expect(reviewReason([])).toBe('No QuickBooks customer has this name'));
  it('two with the same name', () =>
    expect(
      reviewReason([{ reason: 'same name' }, { reason: 'same name' }])
    ).toBe('More than one QuickBooks customer has this name'));
  it('a typed number points elsewhere', () =>
    expect(reviewReason([{ reason: 'typed invoice number' }])).toBe(
      "The typed invoice number belongs to a customer with another name — often a sibling's"
    ));
  it('already taken', () =>
    expect(
      reviewReason([{ reason: 'already linked to another student' }])
    ).toBe('The matching customer is already linked to another student'));
});

describe('hfseCustomerName', () => {
  it('SURNAME, Given M.', () =>
    expect(
      hfseCustomerName({
        lastName: 'dela Cruz',
        firstName: 'Juan Miguel',
        middleName: 'Santos',
      })
    ).toBe('DELA CRUZ, Juan Miguel S.'));
  it('no middle name', () =>
    expect(
      hfseCustomerName({
        lastName: 'Tan',
        firstName: 'Wei Ling',
        middleName: null,
      })
    ).toBe('TAN, Wei Ling'));
  it('no name', () =>
    expect(
      hfseCustomerName({ lastName: null, firstName: 'X', middleName: null })
    ).toBeNull());
});

describe('groupForReview', () => {
  const ys = { current: 'AY2027', upcoming: 'AY2028' };
  it('current and upcoming get their own group', () => {
    expect(groupForReview({ ...ys, ayCode: 'AY2027' })).toBe('AY2027');
    expect(groupForReview({ ...ys, ayCode: 'AY2028' })).toBe('AY2028');
  });
  it('anything older, or unknown, is Earlier', () => {
    expect(groupForReview({ ...ys, ayCode: 'AY2025' })).toBe('earlier');
    expect(groupForReview({ ...ys, ayCode: null })).toBe('earlier');
  });
});
