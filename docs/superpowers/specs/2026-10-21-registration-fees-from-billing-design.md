# Registration and Fees filled from Billing — design

2026-10-21. Owner: Mr Ace. Mockup: https://claude.ai/artifact/3cbGkb7NHrou62Ph2dLEVu (boards: Enrolment tab, Edit Fees, Every status, Create invoice, Customer step, Every scenario step by step).

## Why

Admissions type the QuickBooks invoice number, payment date and status into the Registration and Fees stages by hand (production: Fees filled on 425 of 496 AY2026 applications, 269 of 359 AY2027; Registration sparse because returning students pay none). It is slow double entry. Billing (KD #232) already reads every invoice, but decides which invoice belongs to which stage with a rule on the QuickBooks income account plus a year rule — an inference Mr Ace rejected: "youre just assuming".

The stages also work as a go signal: someone marks that an applicant needs invoicing.

## What changes

1. **An invoice belongs to a stage only when it is tied to it.** A tie is made two ways:
   - **Created from the stage.** Registration or Fees → _Create invoice in Billing_ opens Billing's Create invoice for that student, stage and AY. The created invoice is tied to (AY, stage).
   - **Matched once by the typed number.** Every existing stage whose typed invoice number equals a QuickBooks invoice's number (`doc_number`) is tied to that invoice. One-time run on existing data.
     Invoices made anywhere else (QuickBooks directly, n8n, Billing's customer page) show in Billing only and never touch a stage.
     The income-account rule and the year rule (`stageForAccount`, `yearForInvoice`) stop deciding stages.

2. **The SIS writes the stage from the tied invoice**, as staff used to: invoice number, status, payment date. It follows QuickBooks as payments come in (webhook + hourly check), including turning Overdue after the due date.

3. **Statuses** (both stages):

   | Status                    | Set by                                        | Counts as done |
   | ------------------------- | --------------------------------------------- | -------------- |
   | (blank) — shown "Not set" | default                                       | no             |
   | Ready for invoicing       | staff tick                                    | no             |
   | Unpaid                    | QuickBooks                                    | no             |
   | Partially paid            | QuickBooks                                    | no             |
   | Overdue                   | QuickBooks (open past due date)               | no             |
   | Paid                      | QuickBooks                                    | **yes**        |
   | Voided                    | QuickBooks (tied invoice voided, no live one) | no             |
   | Not required              | staff                                         | **yes**        |
   | Cancelled                 | staff; never overwritten                      | closed         |

   With several tied invoices, the newest live one leads the number; status is Paid only when all live tied invoices are paid; Partially paid when any has a payment and a balance; Overdue when any open one is past due.
   Fees "Paid" keeps today's rule: it is written only once the student has a start date; until then the card says "Paid in QuickBooks — add the start date" (unchanged behaviour).

4. **Edit on Registration / Fees** keeps the Edit button but only offers: Ready for invoicing (only while no live tied invoice), Not required, Cancelled, and Remarks (internal notes, unchanged). Invoice number and payment date are read-only — never typed.

5. **Stage card** shows status chip, invoice number · amount owed or paid date, _Create invoice in Billing_ (when Ready for invoicing, or no live tied invoice), _Open invoice in Billing_, and the remarks.

6. **Create invoice from a stage:**
   - Not yet linked to a QuickBooks customer → step 1: switch _Already a customer in QuickBooks_. On: search QuickBooks customers, **Link** (a customer linked to another student is listed but can't be picked). Off: the add-customer form pre-filled from the application (`SURNAME, Given M.`, parents as Company name, email, phone, address); if QuickBooks already has that name, offer linking that one.
   - Then the normal Create invoice, with a banner naming the student, stage and AY.
   - **Same items as last time**: copies the product lines of the most recent invoice tied to the same stage (any student); staff adjust. Otherwise products are picked by hand, as in QuickBooks.

7. **Enrolment pipeline** adopts it: done = Paid or Not required everywhere the pipeline, drills, counts and the Enrolled check read these stages. Ready for invoicing reads as "waiting to be invoiced".

## Existing data (one-time, migration)

Per AY table, both stages:

- Finished / Paid → **Paid**; Unpaid / Invoiced / Re-invoiced → **Unpaid** (then corrected from QuickBooks once tied); Pending → **Ready for invoicing**; Cancelled stays; blank stays.
- Invoice field "Current student", "None", "No enrolment fee", "NIL" (and similar) → status **Not required**, field cleared.
- Junk in the invoice field (TEST…, "Done Invoicing", dates, a name pasted after the number) → cleared or trimmed to the number; status kept.
- Remarks untouched. Nothing deleted.

## Go-live order (production)

1. Before migration 195, run `scripts/probe-195-preview.ts` against production and read the distinct no-digit values in the invoice fields (e.g. "Waived", "FOC", "Scholarship") — any meaning "no fee" join the Not required list first.
2. Apply 195 together with 188–194, BEFORE the deploy and before any invoice is created from a stage (195 clears every `ay_code` / `stage_keys` on `qbo_invoices`, which would drop created-from-stage ties if any existed).
3. Then `billing-link.ts --apply`, then `--reclassify --apply` (now a re-tie by typed number).

## Not in scope

- Link an existing QuickBooks invoice to a stage by hand (open question; scenario "Invoiced directly in QuickBooks" leaves the stage Not set).
- Per-user access (parked by Mr Ace).
- Monthly / quarterly billing schemes.

## Constraints

- Local only; Billing stays unpushed. Migrations apply to the local stack only.
- SIS layout, outline buttons (never ghost), one primary per view, plain-English copy, tokens only.
- QuickBooks first: the SIS writes the stage only after QuickBooks accepts the invoice.
