import { beforeEach, describe, expect, it, vi } from 'vitest';

import { auditActionLabel, auditContextSummary } from '@/lib/audit/humanize';
import { billingAuditRowLink } from '@/lib/billing/audit-links';
import {
  decideStageLink,
  linkStatusLabel,
  type StageLinkFacts,
} from '@/lib/billing/stage-link';

// Link an invoice on a Registration / Fees stage: every refusal, the
// link-the-customer-too path, and the tie + stage resync.

const facts = (more: Partial<StageLinkFacts> = {}): StageLinkFacts => ({
  docNumber: '1021',
  stage: 'registration',
  ayCode: 'AY2026',
  studentNumber: 'H260162',
  hasStageRow: true,
  found: [
    {
      id: '130',
      docNumber: '1021',
      customerId: '2',
      customerName: "Amy's Bird Sanctuary",
      state: 'open',
    },
  ],
  invoiceCustomerHolder: 'H260162',
  studentCustomer: { id: '2', name: "Amy's Bird Sanctuary" },
  storedTie: null,
  stageLiveDoc: undefined,
  ...more,
});

describe('decideStageLink', () => {
  it('allows an untied invoice of the student’s own customer', () => {
    expect(decideStageLink(facts())).toEqual({
      ok: true,
      linksCustomer: false,
      alreadyLinked: false,
    });
  });

  it('matches the number case-insensitively', () => {
    const f = facts({
      docNumber: 'hfse069012',
      found: [{ ...facts().found[0], docNumber: 'HFSE069012' }],
    });
    expect(decideStageLink(f).ok).toBe(true);
  });

  it('refuses a number QuickBooks does not have', () => {
    expect(decideStageLink(facts({ docNumber: 'HFSE1', found: [] }))).toEqual({
      ok: false,
      status: 404,
      error: 'No QuickBooks invoice has the number HFSE1.',
    });
  });

  it('refuses a number two invoices share', () => {
    const one = facts().found[0];
    const r = decideStageLink(facts({ found: [one, { ...one, id: '131' }] }));
    expect(r.ok).toBe(false);
  });

  it('refuses a voided invoice', () => {
    const r = decideStageLink(
      facts({
        docNumber: 'HFSE069010',
        found: [
          { ...facts().found[0], docNumber: 'HFSE069010', state: 'voided' },
        ],
      })
    );
    expect(r).toEqual({
      ok: false,
      status: 422,
      error: "HFSE069010 was voided in QuickBooks, so it can't be linked.",
    });
  });

  it('refuses when the student has no application that year', () => {
    const r = decideStageLink(facts({ hasStageRow: false }));
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.error).toBe(
        'This student has no AY2026 application, so there is no Registration stage to link it to.'
      );
  });

  it('refuses an invoice whose customer is another student’s', () => {
    const r = decideStageLink(
      facts({
        docNumber: 'HFSE069009',
        found: [
          {
            ...facts().found[0],
            docNumber: 'HFSE069009',
            customerId: '9',
            customerName: 'SANTOS, Maria',
          },
        ],
        invoiceCustomerHolder: 'H230021',
      })
    );
    expect(r).toEqual({
      ok: false,
      status: 409,
      error: 'HFSE069009 is billed to SANTOS, Maria (H230021).',
    });
  });

  it('refuses when the student is linked to a different customer', () => {
    const r = decideStageLink(
      facts({
        invoiceCustomerHolder: null,
        studentCustomer: { id: '7', name: 'Other Family' },
      })
    );
    expect(r).toEqual({
      ok: false,
      status: 409,
      error:
        "This student is linked to Other Family in QuickBooks; 1021 belongs to Amy's Bird Sanctuary.",
    });
  });

  it('refuses an invoice already tied to a stage, naming it', () => {
    const r = decideStageLink(
      facts({
        storedTie: {
          studentNumber: 'H260162',
          ayCode: 'AY2026',
          stageKeys: ['fees'],
        },
      })
    );
    expect(r).toEqual({
      ok: false,
      status: 409,
      error: "1021 is already on this student's Fees for AY2026.",
    });
    const other = decideStageLink(
      facts({
        storedTie: {
          studentNumber: 'H250001',
          ayCode: 'AY2025',
          stageKeys: ['registration'],
        },
      })
    );
    if (!other.ok)
      expect(other.error).toBe(
        "1021 is already on student H250001's Registration for AY2025."
      );
    else throw new Error('expected a refusal');
  });

  it('treats a tie to exactly this stage as already linked', () => {
    expect(
      decideStageLink(
        facts({
          storedTie: {
            studentNumber: 'H260162',
            ayCode: 'AY2026',
            stageKeys: ['registration'],
          },
        })
      )
    ).toEqual({ ok: true, linksCustomer: false, alreadyLinked: true });
  });

  it('refuses when the stage already has a live tied invoice', () => {
    const r = decideStageLink(facts({ stageLiveDoc: 'HFSE069012' }));
    expect(r).toEqual({
      ok: false,
      status: 409,
      error: 'Registration for AY2026 already has invoice HFSE069012.',
    });
  });

  it('links the customer too when neither is linked', () => {
    expect(
      decideStageLink(
        facts({ invoiceCustomerHolder: null, studentCustomer: null })
      )
    ).toEqual({ ok: true, linksCustomer: true, alreadyLinked: false });
  });
});

describe('linkStatusLabel', () => {
  const t = '2026-10-21';
  it.each([
    [{ state: 'paid', total: 100, balance: 0, dueDate: null }, 'Paid'],
    [{ state: 'open', total: 100, balance: 100, dueDate: null }, 'Unpaid'],
    [
      { state: 'open', total: 100, balance: 40, dueDate: null },
      'Partially paid',
    ],
    [
      { state: 'open', total: 100, balance: 100, dueDate: '2026-10-01' },
      'Overdue',
    ],
    [{ state: 'voided', total: 0, balance: 0, dueDate: null }, 'Voided'],
  ] as const)('%o → %s', (r, label) => {
    expect(linkStatusLabel(r, t)).toBe(label);
  });
});

// ── the server path ─────────────────────────────────────────────────────

const qbInvoices: Array<Record<string, unknown>> = [];
const calls = {
  link: [] as unknown[],
  upsert: [] as Array<Record<string, unknown>>,
  sync: [] as unknown[],
  audit: [] as Array<Record<string, unknown>>,
};
let placedAfter = { ayCode: 'AY2026', stageKeys: ['registration'] };

vi.mock('server-only', () => ({}));
vi.mock('@/lib/qbo/client', () => ({
  connectedRealmId: vi.fn(async () => 'realm-1'),
  qbEscape: (s: string) => s,
  qboErrorMessage: (e: unknown) => String(e),
  qboQuery: vi.fn(async () => qbInvoices),
  QboNotConnectedError: class extends Error {},
}));
vi.mock('@/lib/billing/link-student.server', () => ({
  linkStudentToCustomer: vi.fn(async (_s: unknown, args: unknown) => {
    calls.link.push(args);
    return { ok: true, displayName: "Amy's Bird Sanctuary", historyErrors: [] };
  }),
}));
vi.mock('@/lib/billing/maps.server', () => ({
  loadBillingMaps: vi.fn(async () => ({ typed: new Map() })),
}));
vi.mock('@/lib/billing/store.server', () => ({
  upsertInvoice: vi.fn(async (_s: unknown, args: Record<string, unknown>) => {
    calls.upsert.push(args);
    return {
      before: null,
      after: placedAfter,
      reason: 'created',
      previousStudent: null,
    };
  }),
}));
vi.mock('@/lib/billing/tiles.server', () => ({
  syncTilesForStudent: vi.fn(async (...args: unknown[]) => {
    calls.sync.push(args.slice(1, 3));
    return { changed: 1, errors: [] };
  }),
}));
vi.mock('@/lib/audit/log-action', () => ({
  logAction: vi.fn(async (a: Record<string, unknown>) => {
    calls.audit.push(a);
  }),
}));

import {
  linkInvoiceToStage,
  previewStageLink,
} from '@/lib/billing/stage-link.server';

type Row = Record<string, unknown>;

/** A Supabase stand-in: each table's rows, filtered by .eq() / .in(). */
function fakeService(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      const result = () => ({
        data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))),
        error: null,
      });
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => {
          filters.push((r) => r[k] === v);
          return q;
        },
        in: (k: string, vs: unknown[]) => {
          filters.push((r) => vs.includes(r[k]));
          return q;
        },
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({
          data: result().data[0] ?? null,
          error: null,
        }),
        then: (resolve: (v: unknown) => unknown) => resolve(result()),
      };
      return q;
    },
  } as never;
}

const amy = {
  Id: '130',
  DocNumber: '1021',
  TxnDate: '2026-09-20',
  DueDate: '2026-10-20',
  TotalAmt: 239,
  Balance: 239,
  SyncToken: '0',
  CustomerRef: { value: '2', name: "Amy's Bird Sanctuary" },
  Line: [
    {
      Amount: 239,
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: { ItemRef: { value: '5', name: 'Registration' } },
    },
  ],
};

const base = (more: Record<string, Row[]> = {}) =>
  fakeService({
    ay2026_enrolment_applications: [
      {
        studentNumber: 'H260162',
        enroleeNumber: 'E260162',
        lastName: 'Tan',
        firstName: 'Mei',
        middleName: null,
        enroleeFullName: null,
      },
    ],
    ay2026_enrolment_status: [{ enroleeNumber: 'E260162' }],
    qbo_customers: [],
    qbo_invoices: [],
    ...more,
  });

const actor = { id: 'u1', email: 'admin@local.test', role: 'superadmin' };
const input = {
  stage: 'registration' as const,
  ayCode: 'AY2026',
  docNumber: ' 1021 ',
};

beforeEach(() => {
  qbInvoices.length = 0;
  qbInvoices.push(amy);
  calls.link.length = 0;
  calls.upsert.length = 0;
  calls.sync.length = 0;
  calls.audit.length = 0;
  placedAfter = { ayCode: 'AY2026', stageKeys: ['registration'] };
});

const linked = [
  {
    student_number: 'H260162',
    qbo_customer_id: '2',
    display_name: "Amy's Bird Sanctuary",
    realm_id: 'realm-1',
  },
];

describe('previewStageLink', () => {
  it('shows the invoice: customer, dates, money, status, products', async () => {
    const r = await previewStageLink(base({ qbo_customers: linked }), {
      studentNumber: 'H260162',
      input,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preview).toMatchObject({
      qboInvoiceId: '130',
      docNumber: '1021',
      customer: "Amy's Bird Sanctuary",
      txnDate: '2026-09-20',
      total: 239,
      balance: 239,
      products: ['Registration'],
      linksCustomer: false,
      studentName: 'Tan, Mei',
    });
  });

  it('refuses when the stage already has a live tied invoice', async () => {
    const r = await previewStageLink(
      base({
        qbo_customers: linked,
        qbo_invoices: [
          {
            qbo_invoice_id: '140',
            doc_number: 'HFSE069012',
            state: 'open',
            stage_keys: ['registration'],
            qbo_customer_id: '2',
            student_number: 'H260162',
            realm_id: 'realm-1',
            ay_code: 'AY2026',
          },
        ],
      }),
      { studentNumber: 'H260162', input }
    );
    expect(r).toEqual({
      ok: false,
      status: 409,
      error: 'Registration for AY2026 already has invoice HFSE069012.',
    });
  });
});

describe('linkInvoiceToStage', () => {
  it('ties the invoice to the stage, resyncs that year and audits it', async () => {
    const r = await linkInvoiceToStage(base({ qbo_customers: linked }), {
      studentNumber: 'H260162',
      actor,
      input,
    });
    expect(r).toEqual({
      ok: true,
      qboInvoiceId: '130',
      docNumber: '1021',
      warnings: [],
    });
    expect(calls.link).toEqual([]);
    expect(calls.upsert[0]).toMatchObject({
      qboInvoiceId: '130',
      studentNumber: 'H260162',
      tie: { stage: 'registration', ayCode: 'AY2026' },
    });
    expect(calls.sync).toEqual([['H260162', ['AY2026']]]);
    expect(calls.audit[0]).toMatchObject({
      action: 'qbo.invoice.link_stage',
      entityType: 'qbo_invoice',
      entityId: '130',
      context: { studentNumber: 'H260162', stage: 'registration' },
    });
  });

  it('asks to confirm before linking the customer too', async () => {
    const r = await linkInvoiceToStage(base(), {
      studentNumber: 'H260162',
      actor,
      input,
    });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(calls.link).toEqual([]);
    expect(calls.upsert).toEqual([]);
  });

  it('links the customer first, then ties, once confirmed', async () => {
    const r = await linkInvoiceToStage(base(), {
      studentNumber: 'H260162',
      actor,
      input: { ...input, linkCustomer: true },
    });
    expect(r.ok).toBe(true);
    expect(calls.link).toEqual([
      { studentNumber: 'H260162', customerId: '2', actor },
    ]);
    expect(calls.upsert).toHaveLength(1);
    expect(calls.audit[0]).toMatchObject({
      context: { linked_customer: true },
    });
  });

  it('reports when the invoice landed on another stage', async () => {
    placedAfter = { ayCode: 'AY2026', stageKeys: ['fees'] };
    const r = await linkInvoiceToStage(base({ qbo_customers: linked }), {
      studentNumber: 'H260162',
      actor,
      input,
    });
    expect(r.ok).toBe(false);
    expect(calls.sync).toEqual([]);
    expect(calls.audit).toEqual([]);
  });

  it('refuses a voided invoice without writing anything', async () => {
    qbInvoices[0] = { ...amy, TotalAmt: 0, Balance: 0, PrivateNote: 'Voided' };
    const r = await linkInvoiceToStage(base({ qbo_customers: linked }), {
      studentNumber: 'H260162',
      actor,
      input,
    });
    expect(r).toMatchObject({ ok: false, status: 422 });
    expect(calls.upsert).toEqual([]);
  });
});

describe('the audit row', () => {
  it('reads plainly and opens the invoice', () => {
    expect(auditActionLabel('qbo.invoice.link_stage')).toBe(
      'QuickBooks invoice linked to a stage'
    );
    expect(
      auditContextSummary('qbo.invoice.link_stage', {
        stage: 'registration',
        doc_number: '1021',
      })
    ).toContain('Registration · invoice 1021');
    expect(
      billingAuditRowLink(
        {
          entity_type: 'qbo_invoice',
          action: 'qbo.invoice.link_stage',
          entity_id: '130',
          context: { studentNumber: 'H260162' },
        },
        'superadmin'
      )
    ).toEqual({ href: '/billing/H260162/invoices/130', label: 'Open invoice' });
  });
});
