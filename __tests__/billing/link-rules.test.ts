import { describe, expect, it } from 'vitest';

import {
  buildLinkIndex,
  cleanDocNumber,
  customerNameKey,
  nameKey,
  proposeLink,
} from '@/lib/billing/link-rules';

const customers = [
  { id: '1', displayName: 'PAGCALIWANGAN, Nisa Yelle D.' },
  { id: '2', displayName: 'PAGCALIWANGAN, Nala Yelle D.' },
  { id: '3', displayName: 'OBIAS, Eon Mach N.' },
  { id: '4', displayName: 'OBIAS, Eon Mach N. (potsie.obias@gmail.com)' },
  { id: '5', displayName: 'BAÑA, Hannah Zoey U.' },
  { id: '6', displayName: 'Related Companies:HFSE YoungStarters Pte Ltd' },
  { id: '7', displayName: 'Grenke Lease Singapore PL' },
  { id: '8', displayName: 'REYES, Maximo Aurelio T.' },
];
const invoices = [
  { docNumber: 'HFSE061001', customerId: '1' },
  { docNumber: 'HFSE061002', customerId: '2' },
  { docNumber: 'HFSE061003', customerId: '8' },
  { docNumber: 'HFSE061004', customerId: '6' },
];
const index = buildLinkIndex(customers, invoices);

describe('names', () => {
  it('keys a SIS name and a QuickBooks name the same way', () => {
    expect(nameKey('Baña', 'Hannah Zoey')).toBe('bana|hannah');
    expect(customerNameKey('BAÑA, Hannah Zoey U.')).toBe('bana|hannah');
    expect(customerNameKey('Ganaden , Meril Elleigh  Corpuz')).toBe(
      'ganaden|meril'
    );
  });
  it('gives no key to sub-customers and names without a comma', () => {
    expect(
      customerNameKey('Related Companies:HFSE YoungStarters Pte Ltd')
    ).toBeNull();
    expect(customerNameKey('Grenke Lease Singapore PL')).toBeNull();
  });
  it('cleans typed invoice numbers', () => {
    expect(cleanDocNumber(' hfse061001\t')).toBe('HFSE061001');
    expect(cleanDocNumber('None')).toBeNull();
    expect(cleanDocNumber('INV-0042-20250101')).toBeNull();
    expect(cleanDocNumber('1048')).toBe('1048');
  });
});

describe('proposeLink', () => {
  it('links by the typed invoice number', () => {
    expect(
      proposeLink(
        {
          studentNumber: 'H1',
          lastName: 'Reyes',
          firstName: 'Maximo Aurelio',
          typedNumbers: ['HFSE061003'],
        },
        index
      )
    ).toEqual({ kind: 'link', customerId: '8', reason: 'invoice' });
  });
  it('sibling number: several customers, the one with the same name wins', () => {
    expect(
      proposeLink(
        {
          studentNumber: 'H2',
          lastName: 'Pagcaliwangan',
          firstName: 'Nisa Yelle',
          typedNumbers: ['HFSE061001', 'HFSE061002'],
        },
        index
      )
    ).toEqual({ kind: 'link', customerId: '1', reason: 'sibling' });
  });
  it('a typed number of a sibling only, name differs: the name decides', () => {
    expect(
      proposeLink(
        {
          studentNumber: 'H2',
          lastName: 'Pagcaliwangan',
          firstName: 'Nisa Yelle',
          typedNumbers: ['HFSE061002'],
        },
        index
      )
    ).toEqual({ kind: 'link', customerId: '1', reason: 'sibling' });
  });
  it('links by name when there is no typed number', () => {
    expect(
      proposeLink(
        {
          studentNumber: 'H3',
          lastName: 'Baña',
          firstName: 'Hannah Zoey',
          typedNumbers: [],
        },
        index
      )
    ).toEqual({ kind: 'link', customerId: '5', reason: 'name' });
  });
  it('duplicate customer: review with both, never auto-link', () => {
    const p = proposeLink(
      {
        studentNumber: 'H4',
        lastName: 'Obias',
        firstName: 'Eon Mach',
        typedNumbers: [],
      },
      index
    );
    expect(p.kind).toBe('review');
    expect(
      p.kind === 'review' && p.candidates.map((c) => c.customerId).sort()
    ).toEqual(['3', '4']);
  });
  it('a number that points at a sub-customer is ignored', () => {
    const p = proposeLink(
      {
        studentNumber: 'H5',
        lastName: 'Nobody',
        firstName: 'Here',
        typedNumbers: ['HFSE061004'],
      },
      index
    );
    expect(p).toEqual({ kind: 'review', candidates: [] });
  });
  it('nothing found: review with no candidates', () => {
    expect(
      proposeLink(
        {
          studentNumber: 'H6',
          lastName: 'Wright',
          firstName: 'Dylan Connor',
          typedNumbers: ['HFSE099999'],
        },
        index
      )
    ).toEqual({ kind: 'review', candidates: [] });
  });
});
