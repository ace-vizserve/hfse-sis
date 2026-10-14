# QuickBooks invoicing for the Registration and Fees stages — design

Date: 2026-10-14 · Status: approved in conversation, awaiting spec review · Requested by Miss Luz (admissions)

## Why

Admissions invoice in QuickBooks Online (QBO), then type the invoice number, status and payment date into the SIS Registration and Fees stages by hand. This removes the second entry: the invoice is made (or linked) from the stage, and payments recorded in QuickBooks update the stage by themselves.

## Scope

In:

- Create a QuickBooks invoice from the Registration or Fees stage tile.
- Link an invoice that already exists in QuickBooks to a stage.
- Payments and voids in QuickBooks update the stage (webhook + hourly check).
- Match the student to their QuickBooks customer, remembered by `studentNumber`.
- A superadmin page to connect QuickBooks.

Out (later pieces of the Billing module, each with its own spec): monthly / quarterly invoice runs, reminders and chasing, Billing customer list and customer pages, ad-hoc fee types, history import, QB customer active/inactive, recording payments from the SIS, GST handling beyond what QuickBooks applies by default.

## Users

admissions, school_admin and superadmin (decided 2026-10-14; no finance role for now). academic_coordinator keeps Edit stage but does not get the invoice buttons. Connecting QuickBooks is superadmin only.

## Status rules

Statuses are the existing ones (`lib/schemas/sis.ts`); none are added.

Registration — Pending · Unpaid · Finished · Cancelled

| QuickBooks event                    | Registration becomes                             |
| ----------------------------------- | ------------------------------------------------ |
| Invoice created or linked           | Unpaid + invoice number                          |
| A further invoice created or linked | Unpaid + the new invoice number                  |
| Part payment                        | unchanged                                        |
| Current invoice fully paid          | Finished + payment date                          |
| Current invoice voided              | Pending, invoice number and payment date cleared |

Fees — Pending · Invoiced · Re-invoiced · Paid · Cancelled

| QuickBooks event                           | Fees becomes                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| First invoice created or linked            | Invoiced + invoice number                                                       |
| A further invoice created or linked        | Re-invoiced + the new invoice number                                            |
| Part payment                               | unchanged                                                                       |
| Current invoice fully paid, start date set | Paid + payment date                                                             |
| Current invoice fully paid, no start date  | unchanged; payment date filled; tile says "Paid in QuickBooks — add start date" |
| Current invoice voided                     | Pending, invoice number and payment date cleared                                |

Rules:

- **Re-invoiced = a new invoice was sent for this stage** (Mr Ace, 2026-10-14). The old invoice is left as it is in QuickBooks; the SIS never voids it.
- **The latest invoice is the current one.** Only its balance and void state move the stage. Older invoices stay recorded but do not move the stage.
- **Cancelled is staff-only.** The sync never sets it and never changes a stage that is Cancelled.
- **The sync acts on QuickBooks changes only.** Staff can still edit the stage by hand; the sync writes again only when something changes on that invoice in QuickBooks.
- **Required fields stay enforced** (`STAGE_STATUS_REQUIRED_FIELDS`). The sync goes through the same check, which is why Fees waits for a start date before Paid.
- **Payment date** = the date of the payment that brought the balance to 0 (the latest linked QB Payment's `TxnDate`).
- **QuickBooks wins on money.** Total, balance, paid and voided always come from QuickBooks.

The mapping is one pure function, `nextStageState(stage, current, invoice)`, so it is unit-tested without QuickBooks.

## Data

Migration 188. All tables have RLS on with no policies — read and written only by the server with the service role. Tokens are NOT stored in `school_config`, which every signed-in role can read.

- `qbo_connection` — one row: `realm_id`, `company_name`, `refresh_token`, `access_token`, `access_token_expires_at`, `connected_by`, `connected_at`, `last_cdc_at`.
- `qbo_customers` — `student_number` (PK), `qbo_customer_id`, `display_name`, `matched_by` (`auto` | staff email), `matched_at`.
- `qbo_invoices` — one row per invoice: `id`, `ay_code`, `enrolee_number`, `student_number`, `stage_key` (`registration` | `fees`), `qbo_invoice_id` (unique), `doc_number`, `total`, `balance`, `state` (`open` | `paid` | `voided`), `is_current`, `payment_date`, `sync_token`, `source` (`created` | `linked`), `created_by`, `created_at`, `synced_at`. One `is_current` row per (ay, enrolee, stage), by partial unique index.
- `qbo_sync_runs` — `id`, `source` (`webhook` | `hourly` | `manual`), `started_at`, `finished_at`, `invoices_updated`, `error`. Feeds the admin page's "last sync" and "last errors".

The existing stage columns (`registrationInvoice`, `registrationPaymentDate`, `feeInvoice`, `feePaymentDate`, statuses) stay the source the rest of the SIS reads; the sync fills them.

## Sync

**SIS → QuickBooks (on click).** Create and Link call QuickBooks first. Only if QuickBooks accepts does the SIS write the `qbo_invoices` row and the stage. If QuickBooks refuses or is down, nothing is saved and the drawer shows "QuickBooks didn't accept this: {reason}".

**QuickBooks → SIS.**

- Webhook `POST /api/quickbooks/webhook` — verifies Intuit's signature (`QBO_WEBHOOK_VERIFIER`), takes Invoice and Payment events, and refreshes the invoices the SIS knows.
- Hourly cron `GET /api/quickbooks/cdc` (`CRON_SECRET` Bearer, in `vercel.json`) — Change Data Capture since `last_cdc_at` for Invoice and Payment; catches anything the webhook missed.
- "Refresh from QuickBooks" on the tile — the same refresh for one invoice.

All three call one function, `refreshInvoice(qboInvoiceId)`: read the invoice and its payments, update the `qbo_invoices` row, and if it is current, apply `nextStageState` and write the stage. Invoices the SIS does not know are ignored.

**Who did it.**

- QuickBooks' audit log shows only the connecting account, so each SIS-created invoice carries `Created from SIS by {staff name}` in its PrivateNote.
- Every stage change writes the existing `sis.stage.update` audit row. Staff changes carry the staff actor; sync changes carry `{ id: null, email: 'system:quickbooks-sync', role: null }` (same pattern as `system:auto-sync`), and `feeUpdatedby` / `registrationUpdatedby` = "QuickBooks sync".
- New audit actions: `qbo.invoice.create`, `qbo.invoice.link`, `qbo.connection.connect`, `qbo.connection.disconnect` — registered in `ALL_AUDIT_ACTIONS`, `lib/audit/modules.ts`, `humanize.ts`.

**Connection.** `intuit-oauth` for the OAuth flow plus a thin `fetch` wrapper (`lib/qbo/`) for API calls; no community SDK. Access tokens are refreshed when expired and the rotated refresh token is saved every time. Env: `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, `QBO_ENVIRONMENT`, `QBO_WEBHOOK_VERIFIER`.

**Customer match.** The first time a stage invoices, the SIS looks for a QuickBooks customer whose display name equals the student's full name exactly. One match → stored in `qbo_customers` (`matched_by = auto`). None or several → staff pick in the drawer and the choice is stored.

## Screens

**Registration and Fees tiles** (`components/sis/enrollment-tab.tsx`, existing tiles):

- A QuickBooks line under the status: `INV-1042 · S$3,200 · Balance S$1,200 · Synced 10:42`. The number opens the invoice in QuickBooks.
- Buttons at the bottom: **Create invoice** (primary) and **Link QB invoice** (outline). Once the stage has an invoice: **New invoice** and **Refresh from QuickBooks**.
- Notes: "Paid in QuickBooks — add start date" (amber), with a button that opens the existing Edit stage dialog; "QuickBooks not connected" (muted) instead of the buttons.
- The Edit stage pencil is unchanged.

**Create invoice drawer** (Sheet, pinned footer, KD #227):

- Customer — prefilled on a match, otherwise a picker of close QuickBooks names.
- Lines — QuickBooks item, quantity, price (prefilled from the item, editable); add / remove; total.
- Invoice date and due date (QuickBooks' default terms).
- Memo (shown to the parent).
- **Create in QuickBooks**; on success shows the new number.

**Link QB invoice drawer** — this customer's open QuickBooks invoices (number, date, total, balance); pick one, **Link invoice**.

**SIS Admin → QuickBooks** (`/sis/admin/quickbooks`, superadmin) — Connect / Disconnect, company name, last sync time, last errors from `qbo_sync_runs`.

## Routes

- `GET /api/quickbooks/connect`, `GET /api/quickbooks/callback`, `POST /api/quickbooks/disconnect` — superadmin.
- `GET /api/quickbooks/items`, `GET /api/quickbooks/customers?q=`, `GET /api/quickbooks/customers/[id]/invoices` — admissions, school_admin, superadmin.
- `POST /api/sis/students/[enroleeNumber]/stage/[stageKey]/invoice` — body `{ ayCode, mode: 'create' | 'link', ... }`.
- `POST /api/sis/students/[enroleeNumber]/stage/[stageKey]/invoice/refresh`.
- `POST /api/quickbooks/webhook`, `GET /api/quickbooks/cdc`.

`stageKey` other than `registration` / `fees` → 400.

## Testing

- Unit: `nextStageState` covering every row of both tables plus Cancelled, older-invoice and missing-start-date cases; webhook signature check; customer-match rules.
- Audit coverage tests updated for the new actions.
- Integration: the existing throwaway scripts in `scripts/qbo/` (sandbox 21/21, SIS round-trip 9/9) are the manual check against the QuickBooks sandbox and the local Supabase stack.

## Not decided here

- Production keys and the one-time approval by an HFSE QuickBooks admin — later.
- GST: the sandbox is a US company; an AU sandbox is needed to test tax codes before go-live.
