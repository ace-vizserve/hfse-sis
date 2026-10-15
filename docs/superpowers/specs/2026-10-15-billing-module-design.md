# Billing module — design

Date: 2026-10-15 · Status: agreed in conversation with Mr Ace · Builds on KD #231 (`2026-10-14-quickbooks-registration-fees-invoicing-design.md`) · **Local stack + QuickBooks sandbox only until Mr Ace says otherwise.**

## Why

Miss Luz expected all invoicing to happen in the SIS ("sa SIS na lahat kami gagalaw"). KD #231 put Create / Link invoice on the Registration and Fees tiles, which still leaves staff working in two places and typing numbers. Billing becomes its own module: "the SIS is using QuickBooks under the hood". Every invoice and payment of a student's QuickBooks customer is shown in the SIS and kept in step both ways; Registration and Fees read their state from those invoices instead of being typed.

## What HFSE's QuickBooks looks like (production exports, 2026-10-15)

- **One customer per student**, named `SURNAME, Given M.`; parents' names are in Company name. No family or sub-customer structure (the only sub-customers are 7 internal "Related Companies"). No student number anywhere on the customer.
- 15 duplicate customers carry an email in the name ("OBIAS, Eon Mach N. (potsie.obias@gmail.com)"); some lack the middle initial.
- 19,447 invoices since Jan 2025, all numbered `HFSE` + 6 digits. **8,313 have the memo "Auto-generated via n8n"** — an automation outside the SIS already creates invoices. The SIS reads them like any other invoice.
- Fee items are renamed every year ("AY2024 Registration Fee", "AY2026 Student Devt Fees"); their **income accounts are stable**: `Service/Fee Revenue:Admissions & Registration`, `Service/Fee Revenue:Enrolment Fees:*`. Student Devt Fees and Tuition Fees share "Advance customers payment".
- Deposit accounts (Miss Luz): **UOB, PayNow, Credit/Debit Card**.
- Matching the SIS's typed invoice numbers against the export: AY2027 308 of 325 students link automatically (295 by invoice number, 9 by name among a sibling's invoices, 4 by name), ~14 need a person.

## Scope

In: Billing module (customer list, customer page, review list, settings); one-time and ongoing customer linking; sync of **all** invoices and payments of linked customers; Create invoice and **Record payment** from the customer page; Registration / Fees tiles become read-only and open Billing; a sandbox that mirrors HFSE's setup.

Out: production go-live (keys, admin approval, GST check, migration to prod), monthly / quarterly invoice runs, reminders, editing or voiding an invoice from the SIS, customer active/inactive, non-student customers (vendors, related companies — never shown).

## Users

admissions, school_admin, superadmin use Billing. Settings is superadmin only. Same roles record payments (Mr Ace, 2026-10-15).

## Screens

Route group `app/(billing)/billing/`, a module in the switcher and sidebar like the others.

**Customers** `/billing` — DataTable: student, student number, QuickBooks customer, balance owed, last payment date, last invoice date. Search; facet "Has a balance". Row opens the customer page. A count chip links to To review.

**Customer page** `/billing/[studentNumber]` — header: student name, QuickBooks customer name, balance owed, **Create invoice** (primary), **Record payment** (outline), Refresh from QuickBooks (ghost). Below, one table of everything billed to the customer, **newest first, no year filter**: number, date, what it's for (item names, shortened), amount, balance, status (Open / Paid / Part paid / Overdue / Voided), and a Registration / Fees tag when the mapping puts it on a tile. A row opens a side sheet with the lines and the payments applied. A second table lists payments: date, amount, account (UOB / PayNow / Card), reference, invoices it paid. No charts or summary cards.

**To review** `/billing/review` — students with no linked customer: for each, the suggested customer(s) and why ("invoice HFSE061234", "same name"), **Link**, **Pick another customer**, **Add to QuickBooks** (the existing create-customer flow). Also lists students whose link was ambiguous.

**Settings** `/billing/settings` (superadmin) — the QuickBooks connection (moved from `/sis/admin/quickbooks`, which becomes a redirect stub); the tile mapping; the year ranges; which deposit accounts appear in Record payment.

**Registration and Fees tiles** (Admissions record) — one line: `Paid · HFSE062240 · 12 Oct`; clicking the tile opens `/billing/[studentNumber]`; no linked customer → opens the To review entry for that student. No invoice buttons. Status, invoice number and payment date are not editable for these two stages; remarks, Fees start date and setting **Cancelled** stay editable.

## Drawers

**Create invoice** — the existing KD #231 sheet moved to the customer page (customer fixed; lines, dates, optional Invoice no., memo). New: if the customer already has a non-voided invoice that the mapping puts on the same tile in the same year, an amber note says so ("HFSE061234 already bills Fees for AY2027") — a warning, not a block.

**Record payment** — amount, date (today), deposit account (the settings list: UOB / PayNow / Credit/Debit Card), reference no., and the open invoices it pays (all open invoices listed with balance, ticked oldest first up to the amount; editable). **Record in QuickBooks** creates a QuickBooks Payment applied to those invoices. QuickBooks first; the SIS saves only after QuickBooks accepts (same rule as KD #231).

## Tile mapping and years

- **Mapping**: each QuickBooks **income account** → Registration, Fees or neither; an **item** override for items on shared accounts (e.g. AY2026 Student Devt Fees → Fees, Tuition Fees → neither). An invoice belongs to a tile if any of its lines maps there (item override first, then account). Lines mapping to both → the invoice counts for both.
- **Year**: a superadmin sets one date range per academic year ("AY2027: 1 Jun 2026 – 31 Mar 2027"). A mapped invoice belongs to the year whose range holds its invoice date; outside every range → shown on the customer page, on no tile.
- The result (`ay_code`, `stage_key`) is stored on the invoice row and recomputed when the mapping or ranges change (one "Apply to all invoices" on save).

## Tile status from invoices

Pure function `stageFromInvoices(stage, invoices, current)` over the non-voided invoices on that tile:

| Invoices on the tile | Registration                           | Fees                                                                                |
| -------------------- | -------------------------------------- | ----------------------------------------------------------------------------------- |
| none                 | Pending, number + payment date cleared | Pending, cleared                                                                    |
| 1+, not all paid     | Unpaid                                 | Invoiced (1) / Re-invoiced (2+)                                                     |
| all fully paid       | Finished                               | Paid — needs start date, else stays and shows "Paid in QuickBooks — add start date" |

- Invoice number shown = the latest invoice's; payment date = the payment that cleared the last balance.
- Part payments change nothing. Cancelled is never changed by the sync. Voided invoices are ignored.
- Writes go through the existing `writeStageFromQbo` (same required-field check, same `sis.stage.update` audit row, actor `system:quickbooks-sync`).
- Replaces `stageOnNewInvoice` / `stageOnInvoiceChange`; `qbo_invoices.is_current` goes.

## Linking customers

`lib/billing/link.ts`, pure rules + a runner:

1. **Invoice number**: the student's typed `registrationInvoice` / `feeInvoice` (any year, whitespace stripped) found in QuickBooks → its customer. One customer → link.
2. **Sibling number**: the numbers point to several customers → the one whose name matches (surname + first given name, accents and punctuation ignored).
3. **Name**: exactly one customer with the same surname + first given name.
4. Anything else → To review.

Runs once from Settings ("Link students", dry-run count first), and for one student whenever To review or Create invoice links them. Non-student customers are never matched. Existing staff choices in `qbo_customers` are kept.

## Sync

- **First load** per linked customer: all its invoices and payments (paged queries).
- **Ongoing**: the existing webhook + hourly CDC + Refresh, widened from "invoices the SIS knows" to "any invoice or payment of a linked customer"; each change re-runs mapping and `stageFromInvoices` for the affected tiles.
- QuickBooks wins on money. Unlinked customers' changes are ignored until they are linked (linking triggers their first load).

## Data (migration 189, local only)

- `qbo_invoices` reshaped: `qbo_invoice_id` (unique), `qbo_customer_id`, `student_number`, `doc_number`, `txn_date`, `due_date`, `total`, `balance`, `state` (`open` | `paid` | `voided`), `lines` jsonb (item id/name, income account id, description, qty, amount), `memo`, `private_note`, `payment_date`, `ay_code` + `stage_key` (nullable, from the mapping), `sync_token`, `source` (`created` | `synced`), `created_by`, `created_by_email`, `synced_at`, `realm_id`. Drops `enrolee_number` requirement and `is_current`.
- `qbo_payments`: `qbo_payment_id` (unique), `qbo_customer_id`, `student_number`, `txn_date`, `total`, `deposit_account_id`, `deposit_account_name`, `reference`, `applied` jsonb (invoice id + amount), `created_by`, `synced_at`, `realm_id`.
- `billing_account_map` (`qbo_account_id` PK, `account_name`, `stage` registration | fees | none), `billing_item_map` (`qbo_item_id` PK, `item_name`, `stage`), `billing_year_ranges` (`ay_code` PK, `starts_on`, `ends_on`), `billing_deposit_accounts` (`qbo_account_id` PK, `label`, `sort`).
- All server-only: RLS on, no policies, anon/authenticated revoked (as 188).
- Audit actions: `qbo.payment.create`, `qbo.customer.link`, `billing.mapping.update`, `billing.years.update`, `billing.deposit_accounts.update` (registered in `ALL_AUDIT_ACTIONS`, `lib/audit/modules.ts`, humanize).

## Sandbox mirror (Phase 0)

`scripts/qbo/seed-sandbox-hfse.ts`, idempotent, refuses a non-sandbox connection:

- Accounts: the HFSE income accounts above + deposit accounts UOB, PayNow, Credit/Debit Card.
- Items: a dozen HFSE-shaped fee items across years (AY2026/AY2027 Registration, Enrolment fees, Student Devt Fees, Tuition Fees, Books, an event), on those accounts.
- Customers: one per local-stack student (the local stack holds fake people), named `SURNAME, Given M.`, parents in Company name; plus a duplicate-with-email customer, a sibling pair, a vendor.
- Invoices `HFSE0xxxxx` (numbered by the script) across both years, some memo "Auto-generated via n8n", partly paid, one voided; payments into the three accounts. A few local stages get the typed numbers so the link job has something to find.
- Names are made up; nothing real goes to Intuit.

## Phases

Each phase ends with its tests green, tsc clean, and a review pass before the next starts.

0. **Sandbox mirror** — seed script + local typed numbers. Check: a listing shows the shapes above.
1. **Data + linking** — migration 189, link rules + runner, To review page. Check: unit tests for every rule incl. siblings and duplicates; run against the sandbox.
2. **Mapping + years** — settings tables, Settings page sections, `classifyInvoice`. Check: unit tests on sample invoices.
3. **Full sync** — first load, widened webhook/CDC/Refresh, `stageFromInvoices` + stage write. Check: unit tests for every row of the status table; pay / void in the sandbox and see the tile follow.
4. **Billing pages** — Customers, Customer page, Create invoice (moved, with the duplicate note), Record payment. Check: sandbox round trip both ways.
5. **Tiles read-only** — tile one-liner + open Billing; stage edit refuses status / number / payment date on Registration and Fees; old tile routes and sheets removed; `/sis/admin/quickbooks` redirect. Check: tests + browser walk-through by Mr Ace.

## Not decided here

- Production: migrations 188 + 189, keys, HFSE admin approval, real account and item ids for the mapping, GST.
- Who runs the n8n flow and what it creates — affects only how often the duplicate note appears.
- Where GIRO payments land (sandbox assumes UOB).
