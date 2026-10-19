// The QuickBooks Customer form fields Billing edits, and the pure mapping to
// and from QuickBooks' Customer object. Client-safe.

type QbAddress = {
  Line1?: string;
  Line2?: string;
  City?: string;
  CountrySubDivisionCode?: string;
  PostalCode?: string;
  Country?: string;
};

export type CustomerForm = {
  title: string;
  givenName: string;
  middleName: string;
  familyName: string;
  suffix: string;
  companyName: string;
  displayName: string;
  email: string;
  phone: string;
  mobile: string;
  fax: string;
  other: string;
  website: string;
  billLine1: string;
  billLine2: string;
  billCity: string;
  billState: string;
  billPostalCode: string;
  billCountry: string;
  notes: string;
};

export type QbCustomer = {
  Id: string;
  SyncToken: string;
  DisplayName: string;
  Title?: string;
  GivenName?: string;
  MiddleName?: string;
  FamilyName?: string;
  Suffix?: string;
  CompanyName?: string;
  PrimaryEmailAddr?: { Address?: string };
  PrimaryPhone?: { FreeFormNumber?: string };
  Mobile?: { FreeFormNumber?: string };
  Fax?: { FreeFormNumber?: string };
  AlternatePhone?: { FreeFormNumber?: string };
  WebAddr?: { URI?: string };
  BillAddr?: QbAddress & { Id?: string };
  Notes?: string;
};

const s = (v: string | undefined | null) => v?.trim() ?? '';

export function toForm(c: QbCustomer): CustomerForm {
  return {
    title: s(c.Title),
    givenName: s(c.GivenName),
    middleName: s(c.MiddleName),
    familyName: s(c.FamilyName),
    suffix: s(c.Suffix),
    companyName: s(c.CompanyName),
    displayName: s(c.DisplayName),
    email: s(c.PrimaryEmailAddr?.Address),
    phone: s(c.PrimaryPhone?.FreeFormNumber),
    mobile: s(c.Mobile?.FreeFormNumber),
    fax: s(c.Fax?.FreeFormNumber),
    other: s(c.AlternatePhone?.FreeFormNumber),
    website: s(c.WebAddr?.URI),
    billLine1: s(c.BillAddr?.Line1),
    billLine2: s(c.BillAddr?.Line2),
    billCity: s(c.BillAddr?.City),
    billState: s(c.BillAddr?.CountrySubDivisionCode),
    billPostalCode: s(c.BillAddr?.PostalCode),
    billCountry: s(c.BillAddr?.Country),
    notes: s(c.Notes),
  };
}

/** The labels of the fields that differ — for the audit row. */
export function changedFields(a: CustomerForm, b: CustomerForm): string[] {
  const label: Record<keyof CustomerForm, string> = {
    title: 'Title',
    givenName: 'First name',
    middleName: 'Middle name',
    familyName: 'Last name',
    suffix: 'Suffix',
    companyName: 'Company name',
    displayName: 'Customer display name',
    email: 'Email',
    phone: 'Phone number',
    mobile: 'Mobile number',
    fax: 'Fax',
    other: 'Other',
    website: 'Website',
    billLine1: 'Billing address',
    billLine2: 'Billing address',
    billCity: 'Billing address',
    billState: 'Billing address',
    billPostalCode: 'Billing address',
    billCountry: 'Billing address',
    notes: 'Notes',
  };
  return [
    ...new Set(
      (Object.keys(label) as Array<keyof CustomerForm>)
        .filter((k) => s(a[k]) !== s(b[k]))
        .map((k) => label[k])
    ),
  ];
}
