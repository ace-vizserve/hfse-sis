import { describe, expect, it } from 'vitest';

import {
  draftFromApplication,
  newCustomerBody,
  type ApplicationContact,
} from '@/lib/billing/new-customer';

const app: ApplicationContact = {
  firstName: 'Amara Rafael',
  middleName: 'Reyes',
  lastName: 'Espiritu',
  fatherFullName: 'Michael Espiritu',
  motherFullName: 'Lorna Espiritu',
  guardianFullName: null,
  fatherEmail: null,
  motherEmail: ' lorna@example.test ',
  guardianEmail: 'g@example.test',
  fatherMobile: 91234567,
  motherMobile: 98765432,
  guardianMobile: null,
  homePhone: 61234567,
  homeAddress: '21 Example Road, #03-12',
  postalCode: 11,
};

describe('draftFromApplication', () => {
  it('names the customer the HFSE way, parents as Company name', () => {
    const f = draftFromApplication(app);
    expect(f.displayName).toBe('ESPIRITU, Amara Rafael R.');
    expect(f.companyName).toBe('Michael Espiritu / Lorna Espiritu');
    expect(f.givenName).toBe('Amara Rafael');
    expect(f.familyName).toBe('Espiritu');
  });

  it('takes the first parent email and mobile on file, numbers as text', () => {
    const f = draftFromApplication(app);
    expect(f.email).toBe('lorna@example.test');
    expect(f.mobile).toBe('91234567');
    expect(f.phone).toBe('61234567');
  });

  it('fills Singapore only when there is an address', () => {
    expect(draftFromApplication(app).billCity).toBe('Singapore');
    const none = draftFromApplication({ ...app, homeAddress: null });
    expect(none.billLine1).toBe('');
    expect(none.billCountry).toBe('');
  });

  it('falls back to the guardian when no parent is named', () => {
    const f = draftFromApplication({
      ...app,
      fatherFullName: null,
      motherFullName: '  ',
      guardianFullName: 'Auntie Rose',
    });
    expect(f.companyName).toBe('Auntie Rose');
  });

  it('leaves the display name empty without a first and last name', () => {
    expect(draftFromApplication({ ...app, lastName: null }).displayName).toBe(
      ''
    );
  });
});

describe('newCustomerBody', () => {
  it('sends only the filled fields, in QuickBooks shapes', () => {
    const body = newCustomerBody(draftFromApplication(app));
    expect(body).toMatchObject({
      DisplayName: 'ESPIRITU, Amara Rafael R.',
      CompanyName: 'Michael Espiritu / Lorna Espiritu',
      PrimaryEmailAddr: { Address: 'lorna@example.test' },
      PrimaryPhone: { FreeFormNumber: '61234567' },
      Mobile: { FreeFormNumber: '91234567' },
      BillAddr: {
        Line1: '21 Example Road, #03-12',
        City: 'Singapore',
        PostalCode: '11',
        Country: 'Singapore',
      },
    });
    expect(body).not.toHaveProperty('Fax');
    expect(body).not.toHaveProperty('Title');
  });

  it('sends no address when every address field is blank', () => {
    const body = newCustomerBody(
      draftFromApplication({ ...app, homeAddress: null, postalCode: null })
    );
    expect(body).not.toHaveProperty('BillAddr');
  });
});
