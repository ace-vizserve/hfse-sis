import type { CustomerForm } from '@/lib/billing/customer-form';
import { hfseCustomerName } from '@/lib/billing/review';

// Billing → New customer: the QuickBooks customer form filled from the
// student's newest application, the way HFSE names customers ("SURNAME,
// Given M.", the parents as Company name). Staff check it and can change any
// field before it is added.

/** A student who can be given a new customer (Billing → New customer). */
export type NewCustomerStudent = {
  studentNumber: string;
  name: string;
  level: string | null;
  ayCode: string | null;
};

/** The application fields the form is filled from. */
export type ApplicationContact = {
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  fatherFullName: string | null;
  motherFullName: string | null;
  guardianFullName?: string | null;
  fatherEmail: string | null;
  motherEmail: string | null;
  guardianEmail: string | null;
  fatherMobile: string | number | null;
  motherMobile: string | number | null;
  guardianMobile: string | number | null;
  homePhone: string | number | null;
  homeAddress: string | null;
  postalCode: string | number | null;
};

// A number column holds 0 where the parent typed nothing.
const t = (v: string | number | null | undefined) =>
  v == null || v === 0 ? '' : String(v).trim();
const first = (...vs: Array<string | number | null | undefined>) =>
  vs.map(t).find(Boolean) ?? '';

export function draftFromApplication(a: ApplicationContact): CustomerForm {
  const parents = [a.fatherFullName, a.motherFullName]
    .map(t)
    .filter(Boolean)
    .join(' / ');
  const address = t(a.homeAddress);
  return {
    title: '',
    givenName: t(a.firstName),
    middleName: t(a.middleName),
    familyName: t(a.lastName),
    suffix: '',
    companyName: (parents || t(a.guardianFullName)).slice(0, 100),
    displayName: hfseCustomerName(a) ?? '',
    email: first(a.fatherEmail, a.motherEmail, a.guardianEmail),
    phone: t(a.homePhone),
    mobile: first(a.fatherMobile, a.motherMobile, a.guardianMobile),
    fax: '',
    other: '',
    website: '',
    billLine1: address,
    billLine2: '',
    billCity: address ? 'Singapore' : '',
    billState: '',
    billPostalCode: t(a.postalCode),
    billCountry: address ? 'Singapore' : '',
    notes: '',
  };
}

/** QuickBooks' Customer body for a new customer from the form. */
export function newCustomerBody(f: CustomerForm): Record<string, unknown> {
  const s = (v: string) => v.trim();
  const opt = (key: string, v: string) => (s(v) ? { [key]: s(v) } : {});
  const addr = {
    ...opt('Line1', f.billLine1),
    ...opt('Line2', f.billLine2),
    ...opt('City', f.billCity),
    ...opt('CountrySubDivisionCode', f.billState),
    ...opt('PostalCode', f.billPostalCode),
    ...opt('Country', f.billCountry),
  };
  return {
    DisplayName: s(f.displayName),
    ...opt('Title', f.title),
    ...opt('GivenName', f.givenName),
    ...opt('MiddleName', f.middleName),
    ...opt('FamilyName', f.familyName),
    ...opt('Suffix', f.suffix),
    ...opt('CompanyName', f.companyName),
    ...(s(f.email) ? { PrimaryEmailAddr: { Address: s(f.email) } } : {}),
    ...(s(f.phone) ? { PrimaryPhone: { FreeFormNumber: s(f.phone) } } : {}),
    ...(s(f.mobile) ? { Mobile: { FreeFormNumber: s(f.mobile) } } : {}),
    ...(s(f.fax) ? { Fax: { FreeFormNumber: s(f.fax) } } : {}),
    ...(s(f.other) ? { AlternatePhone: { FreeFormNumber: s(f.other) } } : {}),
    ...(s(f.website) ? { WebAddr: { URI: s(f.website) } } : {}),
    ...(Object.keys(addr).length ? { BillAddr: addr } : {}),
    ...opt('Notes', f.notes),
  };
}
