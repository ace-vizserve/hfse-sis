# "To follow" document flag — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `'To follow'` document slots a visible action queue — adds an "Awaiting promised documents" bucket to the lifecycle aggregate, rebuckets the per-applicant timeline, wires a new drill target, and surfaces a 3-chip document chase queue strip top-of-fold on `/p-files`, `/admissions`, `/records`.

**Architecture:** The work is layered: (1) extract the per-row slot-scan loop in `lib/sis/process.ts` into a pure helper so the cohort aggregate and the new chase-queue loader share a single source of truth; (2) extend the lifecycle drill framework (KD #56) with one new target — same `<LifecycleDrillSheet>` UI, only the slot-list column differs; (3) ship a reusable `<DocumentChaseQueueStrip>` server component mounted on the three dashboards.

**Tech Stack:** Next.js 16 (App Router, RSC), Supabase service-role client wrapped in `unstable_cache` (KD #46), `@tanstack/react-table` for the drill, sonner for toasts, Tailwind v4 + shadcn primitives.

**Spec:** `docs/superpowers/specs/2026-04-28-to-follow-document-flag-design.md`

---

## File structure

| Path                                                     | Action  | Responsibility                                                          |
| -------------------------------------------------------- | ------- | ----------------------------------------------------------------------- |
| `lib/sis/process.ts`                                     | Modify  | Extract slot-scan helper · add new aggregate bucket · rebucket timeline |
| `lib/sis/drill.ts`                                       | Modify  | New `awaiting-promised-documents` target · `promisedSlots` row field   |
| `components/sis/drills/lifecycle-drill-sheet.tsx`        | Modify  | Render `promisedSlots` column with `SlotChips`                          |
| `lib/sis/document-chase-queue.ts`                        | Create  | `getDocumentChaseQueueCounts(ayCode)` loader (60s `unstable_cache`)     |
| `components/sis/document-chase-queue-strip.tsx`          | Create  | 3-chip strip server component, each chip opens a `<LifecycleDrillSheet>` |
| `app/(p-files)/p-files/page.tsx`                         | Modify  | Mount chase strip directly below the existing `<PriorityPanel>`         |
| `app/(admissions)/admissions/page.tsx`                   | Modify  | Mount chase strip top-of-fold (above the KPI grid)                      |
| `app/(records)/records/page.tsx`                         | Modify  | Mount chase strip top-of-fold (above InsightsPanel + KPI grid)          |

No DB migration. No new API route. No new dependency.

**Verification:** the repo has no test framework (`package.json` has `dev`/`build`/`start`/`lint` scripts only). Each task ends with `npx next build` (type-check + compile) and where applicable a manual reproduction step in the browser on the seeded AY9999 (test-mode, KD #52).

**Implementation refinement vs spec §4c:** the spec describes the P-Files chase strip as living *inside* `<PriorityPanel>` as a second section. In implementation we mount it as a sibling card directly below the existing `<PriorityPanel>` instead — same visual location and UX outcome, but keeps `PriorityPayload` shape unchanged and makes the strip component reusable across all 3 dashboards (DRY). The spec's intent — top-of-fold navigation to the document chase queues — is preserved.

---

## Task 1: Extract `scanDocStatusForActionFlags` helper

**Goal:** Pull the per-row slot scan from `process.ts:683-694` into a pure named helper. Subsequent tasks (cohort aggregate, chase-queue loader) call this single source of truth instead of re-implementing the loop.

**Files:**
- Modify: `lib/sis/process.ts:683-694`

- [ ] **Step 1: Read the existing scan**

Open `lib/sis/process.ts` and read lines 682–694. The current loop is:

```ts
const docs = docsByEnrolee.get(r.enroleeNumber!);
if (docs) {
  let rowHasRevalidation = false;
  let rowHasValidation = false;
  for (const slot of DOCUMENT_SLOTS) {
    const v = (docs[slot.statusCol] ?? '').toString().trim();
    if (v === 'Rejected' || v === 'Expired') rowHasRevalidation = true;
    else if (v === 'Uploaded') rowHasValidation = true;
    if (rowHasRevalidation && rowHasValidation) break;
  }
  if (rowHasRevalidation) awaitingDocRevalidation += 1;
  if (rowHasValidation) awaitingDocValidation += 1;
}
```

- [ ] **Step 2: Add the exported helper near the top of the file**

Insert this helper near the top of `lib/sis/process.ts`, after the `tag()` function and before the first `export async function`. Keep the export so `lib/sis/document-chase-queue.ts` (Task 5) can reuse it:

```ts
/**
 * Per-row scan over a documents row's slot status columns. Returns three
 * orthogonal action flags used by both the cohort aggregate
 * (loadLifecycleBlockerBucketsUncached) and the chase-queue loader
 * (lib/sis/document-chase-queue.ts). Overlap allowed — a row with both an
 * 'Uploaded' slot and a 'To follow' slot lights up multiple flags.
 */
export type DocStatusActionFlags = {
  hasRevalidation: boolean; // any slot at 'Rejected' or 'Expired'
  hasValidation: boolean;   // any slot at 'Uploaded'
  hasPromised: boolean;     // any slot at 'To follow'
};

export function scanDocStatusForActionFlags(
  docs: Record<string, string | null> | undefined,
): DocStatusActionFlags {
  const out: DocStatusActionFlags = {
    hasRevalidation: false,
    hasValidation: false,
    hasPromised: false,
  };
  if (!docs) return out;
  for (const slot of DOCUMENT_SLOTS) {
    const v = (docs[slot.statusCol] ?? '').toString().trim();
    if (v === 'Rejected' || v === 'Expired') out.hasRevalidation = true;
    else if (v === 'Uploaded') out.hasValidation = true;
    else if (v === 'To follow') out.hasPromised = true;
    if (out.hasRevalidation && out.hasValidation && out.hasPromised) break;
  }
  return out;
}
```

- [ ] **Step 3: Verify the build still compiles**

Run: `npx next build`
Expected: clean compile (no behavior change yet — helper is unused so far).

- [ ] **Step 4: Commit**

```bash
git add lib/sis/process.ts
git commit -m "refactor(sis): extract scanDocStatusForActionFlags helper

Pure helper hoisted from the inline loop in
loadLifecycleBlockerBucketsUncached. Returns three orthogonal action
flags so the cohort aggregate and the upcoming chase-queue loader share
one source of truth.

Behavior unchanged — caller still inlines the existing scan."
```

---

## Task 2: Cohort aggregate adds `awaiting-promised-documents` bucket

**Goal:** The lifecycle aggregate widget renders a 3rd document bucket. Use the helper from Task 1; insert the bucket between validation and STP completion in the `buckets` array.

**Files:**
- Modify: `lib/sis/process.ts:654-827`

- [ ] **Step 1: Add the new counter alongside the existing 9**

In `lib/sis/process.ts` around line 654-662, change:

```ts
let awaitingFeePayment = 0;
let awaitingDocRevalidation = 0;
let awaitingDocValidation = 0;
let awaitingStpCompletion = 0;
let awaitingAssessmentSchedule = 0;
let awaitingContractSignature = 0;
let missingClassAssignment = 0;
let ungatedToEnroll = 0;
let newApplications = 0;
```

to (one new line `awaitingPromisedDocs`):

```ts
let awaitingFeePayment = 0;
let awaitingDocRevalidation = 0;
let awaitingDocValidation = 0;
let awaitingPromisedDocs = 0;     // NEW: any slot at 'To follow'
let awaitingStpCompletion = 0;
let awaitingAssessmentSchedule = 0;
let awaitingContractSignature = 0;
let missingClassAssignment = 0;
let ungatedToEnroll = 0;
let newApplications = 0;
```

- [ ] **Step 2: Replace the inline doc scan with the helper call**

In `lib/sis/process.ts` around line 682-694, change:

```ts
const docs = docsByEnrolee.get(r.enroleeNumber!);
if (docs) {
  let rowHasRevalidation = false;
  let rowHasValidation = false;
  for (const slot of DOCUMENT_SLOTS) {
    const v = (docs[slot.statusCol] ?? '').toString().trim();
    if (v === 'Rejected' || v === 'Expired') rowHasRevalidation = true;
    else if (v === 'Uploaded') rowHasValidation = true;
    if (rowHasRevalidation && rowHasValidation) break;
  }
  if (rowHasRevalidation) awaitingDocRevalidation += 1;
  if (rowHasValidation) awaitingDocValidation += 1;
}
```

to:

```ts
const docs = docsByEnrolee.get(r.enroleeNumber!);
const docFlags = scanDocStatusForActionFlags(docs);
if (docFlags.hasRevalidation) awaitingDocRevalidation += 1;
if (docFlags.hasValidation) awaitingDocValidation += 1;
if (docFlags.hasPromised) awaitingPromisedDocs += 1;
```

The `const docs = ...` line stays — the STP block at line 706 still references `docs` directly.

- [ ] **Step 3: Insert the new bucket in the `buckets` array**

In `lib/sis/process.ts` around line 778-784, after the existing `'awaiting-document-validation'` entry, insert the new bucket:

```ts
{
  key: 'awaiting-document-validation',
  label: 'Awaiting document validation',
  count: awaitingDocValidation,
  severity: 'warn',
  drillTarget: 'awaiting-document-validation',
},
{
  key: 'awaiting-promised-documents',
  label: 'Awaiting promised documents',
  count: awaitingPromisedDocs,
  severity: 'warn',
  drillTarget: 'awaiting-promised-documents',
},
{
  key: 'awaiting-stp-completion',
  ...
```

(The `awaiting-stp-completion` entry that comes next is unchanged; just insert the new object between it and the validation entry.)

- [ ] **Step 4: Verify the build**

`LifecycleBlockerBucket.key` and `LifecycleBlockerBucket.drillTarget` are typed as plain `string` (`lib/sis/process.ts:86-95`), not union literals — no extra type extension is needed in this file. The drill-target string `'awaiting-promised-documents'` will type-check immediately; the matching `LifecycleDrillTarget` union extension lands in Task 4.

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 5: Commit**

```bash
git add lib/sis/process.ts
git commit -m "feat(sis): add awaiting-promised-documents bucket to lifecycle aggregate

Counts students with >=1 slot at 'To follow' (parent acknowledged but
file not yet sent — KD #60). Sits between validation and STP completion
in the bucket array. Severity: warn — open commitment, not a blocker.

Reuses scanDocStatusForActionFlags so cohort aggregate and the upcoming
chase-queue loader stay coherent."
```

---

## Task 3: Per-applicant timeline rebuckets `'To follow'` to `promised`

**Goal:** Single-student detail string surfaces "promised" separately from "settled", agreeing with the cohort flag from Task 2.

**Files:**
- Modify: `lib/sis/process.ts:236-264`

- [ ] **Step 1: Update the per-slot bucket logic**

In `lib/sis/process.ts` around line 236-256, change:

```ts
let needsAction = 0; // null + Pending + Rejected + Expired
let inFlight = 0;    // Uploaded (registrar needs to validate)
let settled = 0;     // Valid + To follow
let blank = 0;       // null specifically (subset of needsAction)
for (const slot of DOCUMENT_SLOTS) {
  const slotStatus = (docs?.[slot.statusCol] ?? null)?.toString().trim() ?? '';
  if (!slotStatus) {
    blank += 1;
    needsAction += 1;
  } else if (slotStatus === 'Pending') {
    needsAction += 1;
  } else if (slotStatus === 'Rejected' || slotStatus === 'Expired') {
    needsAction += 1;
  } else if (slotStatus === 'Uploaded') {
    inFlight += 1;
  } else if (slotStatus === 'Valid' || slotStatus === 'To follow') {
    settled += 1;
  } else {
    // Unknown legacy values stay in needs-action so admin notices.
    needsAction += 1;
  }
}
```

to (new `promised` counter, `settled` becomes `Valid`-only):

```ts
let needsAction = 0; // null + Pending + Rejected + Expired
let inFlight = 0;    // Uploaded (registrar needs to validate)
let promised = 0;    // To follow (parent acknowledged, file not sent)
let settled = 0;     // Valid (terminal)
let blank = 0;       // null specifically (subset of needsAction)
for (const slot of DOCUMENT_SLOTS) {
  const slotStatus = (docs?.[slot.statusCol] ?? null)?.toString().trim() ?? '';
  if (!slotStatus) {
    blank += 1;
    needsAction += 1;
  } else if (slotStatus === 'Pending') {
    needsAction += 1;
  } else if (slotStatus === 'Rejected' || slotStatus === 'Expired') {
    needsAction += 1;
  } else if (slotStatus === 'Uploaded') {
    inFlight += 1;
  } else if (slotStatus === 'To follow') {
    promised += 1;
  } else if (slotStatus === 'Valid') {
    settled += 1;
  } else {
    needsAction += 1;
  }
}
```

- [ ] **Step 2: Surface `promised` in the detail string**

In the same function, around line 258-264, change:

```ts
detail = formatDetail([
  stageStatus ? `Status: ${stageStatus}` : null,
  `${settled}/${DOCUMENT_SLOTS.length} settled`,
  inFlight > 0 ? `${inFlight} awaiting validation` : null,
  needsAction > settled ? `${needsAction} needs action` : null,
  blank > 0 ? `${blank} blank` : null,
]);
```

to (add `promised` segment between `inFlight` and `needsAction`):

```ts
detail = formatDetail([
  stageStatus ? `Status: ${stageStatus}` : null,
  `${settled}/${DOCUMENT_SLOTS.length} settled`,
  inFlight > 0 ? `${inFlight} awaiting validation` : null,
  promised > 0 ? `${promised} promised` : null,
  needsAction > settled ? `${needsAction} needs action` : null,
  blank > 0 ? `${blank} blank` : null,
]);
```

`formatDetail` already drops null entries, so when `promised === 0` the segment is suppressed.

- [ ] **Step 3: Verify the build**

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 4: Manual reproduction**

Start dev server: `npm run dev`. Navigate to `/admissions/applications/<some-enrolee-with-To-follow-slots>` (the AY9999 seeder writes 1-2 'To follow' slots per "Processing"-stage row, see `lib/sis/seeder/populated.ts:1517`). The Documents stage detail line should now read like *"Status: Processing · 6/16 settled · 2 awaiting validation · 3 promised · 4 needs action"* — the `promised` segment must appear, and `settled` should be lower than before.

- [ ] **Step 5: Commit**

```bash
git add lib/sis/process.ts
git commit -m "feat(sis): rebucket 'To follow' from settled to promised on timeline

Per-applicant lifecycle timeline detail string now surfaces 'promised'
separately from 'settled', so single-student detail agrees with the
cohort-level 'Awaiting promised documents' flag. Empty when no slots
are 'To follow' (formatDetail drops null segments)."
```

---

## Task 4: Drill plumbing for `awaiting-promised-documents`

**Goal:** Clicking the new bucket opens a `<LifecycleDrillSheet>` listing the affected students with a `promisedSlots` chips column. Same UX as the existing validation/revalidation drills.

**Files:**
- Modify: `lib/sis/drill.ts:672-1148`
- Modify: `components/sis/drills/lifecycle-drill-sheet.tsx:300-340`

- [ ] **Step 1: Extend `LifecycleDrillTarget` union and `LIFECYCLE_DRILL_TARGETS` array**

In `lib/sis/drill.ts` around line 672-691, change:

```ts
export type LifecycleDrillTarget =
  | 'awaiting-fee-payment'
  | 'awaiting-document-revalidation'
  | 'awaiting-document-validation'
  | 'awaiting-assessment-schedule'
  | 'awaiting-contract-signature'
  | 'missing-class-assignment'
  | 'ungated-to-enroll'
  | 'new-applications';

export const LIFECYCLE_DRILL_TARGETS: LifecycleDrillTarget[] = [
  'awaiting-fee-payment',
  'awaiting-document-revalidation',
  'awaiting-document-validation',
  'awaiting-assessment-schedule',
  'awaiting-contract-signature',
  'missing-class-assignment',
  'ungated-to-enroll',
  'new-applications',
];
```

to (one new entry inserted after `awaiting-document-validation` in both the union and the array):

```ts
export type LifecycleDrillTarget =
  | 'awaiting-fee-payment'
  | 'awaiting-document-revalidation'
  | 'awaiting-document-validation'
  | 'awaiting-promised-documents'
  | 'awaiting-assessment-schedule'
  | 'awaiting-contract-signature'
  | 'missing-class-assignment'
  | 'ungated-to-enroll'
  | 'new-applications';

export const LIFECYCLE_DRILL_TARGETS: LifecycleDrillTarget[] = [
  'awaiting-fee-payment',
  'awaiting-document-revalidation',
  'awaiting-document-validation',
  'awaiting-promised-documents',
  'awaiting-assessment-schedule',
  'awaiting-contract-signature',
  'missing-class-assignment',
  'ungated-to-enroll',
  'new-applications',
];
```

- [ ] **Step 2: Extend `LifecycleDrillRow` with `promisedSlots`**

In `lib/sis/drill.ts` around line 693-713, change:

```ts
export type LifecycleDrillRow = {
  enroleeNumber: string;
  studentNumber: string | null;
  enroleeFullName: string | null;
  levelApplied: string | null;
  applicationStatus: string | null;
  applicationUpdatedDate: string | null;
  daysSinceUpdate: number | null;
  // Per-bucket extras — only populated for the bucket that needs them.
  feeStatus?: string | null;
  feeInvoice?: string | null;
  feePaymentDate?: string | null;
  documentStatus?: string | null;
  rejectedSlots?: string[];
  expiredSlots?: string[];
  uploadedSlots?: string[];
  assessmentStatus?: string | null;
  assessmentSchedule?: string | null;
  contractStatus?: string | null;
  classSection?: string | null;
};
```

to (one new optional field):

```ts
export type LifecycleDrillRow = {
  enroleeNumber: string;
  studentNumber: string | null;
  enroleeFullName: string | null;
  levelApplied: string | null;
  applicationStatus: string | null;
  applicationUpdatedDate: string | null;
  daysSinceUpdate: number | null;
  // Per-bucket extras — only populated for the bucket that needs them.
  feeStatus?: string | null;
  feeInvoice?: string | null;
  feePaymentDate?: string | null;
  documentStatus?: string | null;
  rejectedSlots?: string[];
  expiredSlots?: string[];
  uploadedSlots?: string[];
  promisedSlots?: string[];
  assessmentStatus?: string | null;
  assessmentSchedule?: string | null;
  contractStatus?: string | null;
  classSection?: string | null;
};
```

- [ ] **Step 3: Add the new case to `buildLifecycleDrillRows`**

In `lib/sis/drill.ts` around line 905-920, after the `awaiting-document-validation` case, add the new case mirroring the validation pattern:

```ts
case 'awaiting-document-validation': {
  if (!docs) break;
  const uploadedSlots: string[] = [];
  for (const slot of DOCUMENT_SLOTS) {
    const v = (docs[slot.statusCol] ?? '').toString().trim();
    if (v === 'Uploaded') uploadedSlots.push(slot.label);
  }
  if (uploadedSlots.length > 0) {
    out.push({
      ...baseRow(enroleeNumber, app, status),
      documentStatus: status.documentStatus ?? null,
      uploadedSlots,
    });
  }
  break;
}
case 'awaiting-promised-documents': {
  if (!docs) break;
  const promisedSlots: string[] = [];
  for (const slot of DOCUMENT_SLOTS) {
    const v = (docs[slot.statusCol] ?? '').toString().trim();
    if (v === 'To follow') promisedSlots.push(slot.label);
  }
  if (promisedSlots.length > 0) {
    out.push({
      ...baseRow(enroleeNumber, app, status),
      documentStatus: status.documentStatus ?? null,
      promisedSlots,
    });
  }
  break;
}
case 'awaiting-assessment-schedule': {
  ...
```

(The `awaiting-assessment-schedule` case after this is unchanged.)

- [ ] **Step 4: Extend `LifecycleDrillColumnKey`, `ALL_LIFECYCLE_DRILL_COLUMNS`, and `LIFECYCLE_DRILL_COLUMN_LABELS`**

In `lib/sis/drill.ts` around line 994-1050, add `'promisedSlots'` to all three:

```ts
export type LifecycleDrillColumnKey =
  | 'enroleeNumber'
  | 'studentNumber'
  | 'enroleeFullName'
  | 'levelApplied'
  | 'applicationStatus'
  | 'applicationUpdatedDate'
  | 'daysSinceUpdate'
  | 'feeStatus'
  | 'feeInvoice'
  | 'feePaymentDate'
  | 'documentStatus'
  | 'rejectedSlots'
  | 'expiredSlots'
  | 'uploadedSlots'
  | 'promisedSlots'
  | 'assessmentStatus'
  | 'assessmentSchedule'
  | 'contractStatus'
  | 'classSection';

export const ALL_LIFECYCLE_DRILL_COLUMNS: LifecycleDrillColumnKey[] = [
  'enroleeFullName',
  'studentNumber',
  'enroleeNumber',
  'levelApplied',
  'applicationStatus',
  'applicationUpdatedDate',
  'daysSinceUpdate',
  'feeStatus',
  'feeInvoice',
  'feePaymentDate',
  'documentStatus',
  'rejectedSlots',
  'expiredSlots',
  'uploadedSlots',
  'promisedSlots',
  'assessmentStatus',
  'assessmentSchedule',
  'contractStatus',
  'classSection',
];

export const LIFECYCLE_DRILL_COLUMN_LABELS: Record<LifecycleDrillColumnKey, string> = {
  enroleeNumber: 'Enrolee #',
  studentNumber: 'Student #',
  enroleeFullName: 'Name',
  levelApplied: 'Level',
  applicationStatus: 'App status',
  applicationUpdatedDate: 'Updated',
  daysSinceUpdate: 'Stale',
  feeStatus: 'Fee status',
  feeInvoice: 'Invoice',
  feePaymentDate: 'Paid',
  documentStatus: 'Doc status',
  rejectedSlots: 'Rejected slots',
  expiredSlots: 'Expired slots',
  uploadedSlots: 'Uploaded slots',
  promisedSlots: 'Promised slots',
  assessmentStatus: 'Assessment',
  assessmentSchedule: 'Scheduled',
  contractStatus: 'Contract',
  classSection: 'Section',
};
```

(Match the existing label cadence — short, sentence-case. The exact key order in `ALL_LIFECYCLE_DRILL_COLUMNS` should match what's already there; this snippet shows the canonical order.)

- [ ] **Step 5: Add the new target to `defaultColumnsForLifecycleTarget`**

In `lib/sis/drill.ts` around line 1078-1085, after the `awaiting-document-validation` case, add:

```ts
case 'awaiting-document-validation':
  return [
    'enroleeFullName',
    'levelApplied',
    'uploadedSlots',
    'applicationStatus',
    'daysSinceUpdate',
  ];
case 'awaiting-promised-documents':
  return [
    'enroleeFullName',
    'levelApplied',
    'promisedSlots',
    'applicationStatus',
    'daysSinceUpdate',
  ];
case 'awaiting-assessment-schedule':
  ...
```

- [ ] **Step 6: Add the new target to `lifecycleDrillHeaderForTarget`**

In `lib/sis/drill.ts` around line 1138-1140, after the `awaiting-document-validation` case, add:

```ts
case 'awaiting-document-validation':
  return { eyebrow: 'Drill · Lifecycle', title: 'Awaiting document validation' };
case 'awaiting-promised-documents':
  return { eyebrow: 'Drill · Lifecycle', title: 'Awaiting promised documents' };
case 'awaiting-assessment-schedule':
  ...
```

- [ ] **Step 7: Render `promisedSlots` column in the lifecycle drill sheet**

In `components/sis/drills/lifecycle-drill-sheet.tsx` around line 331-340 (after the `case 'uploadedSlots':` block), insert a parallel case:

```tsx
case 'uploadedSlots':
  return {
    id: 'uploadedSlots',
    accessorKey: 'uploadedSlots',
    header,
    cell: ({ row }) => (
      <SlotChips slots={row.original.uploadedSlots} color="primary" />
    ),
  };
case 'promisedSlots':
  return {
    id: 'promisedSlots',
    accessorKey: 'promisedSlots',
    header,
    cell: ({ row }) => (
      <SlotChips slots={row.original.promisedSlots} color="stale" />
    ),
  };
```

`color="stale"` is the amber gradient (`from-brand-amber to-brand-amber/80`, see `components/dashboard/chart-legend-chip.tsx:28`) — semantically matches the bucket's `warn` severity. `expiredSlots` uses the same `"stale"`; visual collision is fine because the two surfaces appear in different drill sheets (revalidation vs promised), so the registrar is always in the right context to read the chip.

- [ ] **Step 8: Verify the build**

Run: `npx next build`
Expected: clean compile. Watch for switch-exhaustiveness errors — TS will flag any case still missing.

- [ ] **Step 9: Manual reproduction**

`npm run dev`. Navigate to `/records?ay=AY9999`. Find the lifecycle aggregate widget — *Awaiting promised documents* should appear as a chip with a non-zero count between *Awaiting document validation* and *Awaiting STP completion*. Click it. The drill sheet opens with title "Awaiting promised documents", row table with a "Promised slots" column showing chips per affected student. CSV export button works (UTF-8 BOM, KD #56). Close the sheet, click *Awaiting document validation* — that drill still works untouched.

- [ ] **Step 10: Commit**

```bash
git add lib/sis/drill.ts components/sis/drills/lifecycle-drill-sheet.tsx
git commit -m "feat(sis): wire awaiting-promised-documents drill target

New LifecycleDrillTarget + promisedSlots row field + lifecycle drill
sheet column. Same <LifecycleDrillSheet> UX as the existing 8 buckets —
only the title, eyebrow, and slot-chip column differ.

Closes the loop on the cohort flag added in the previous commit:
clicking the bucket now opens the affected-students drill.
"
```

---

## Task 5: Shared chase-queue counts loader

**Goal:** Single cached helper returning `{ promised, validation, revalidation }` counts for the chase-queue strip. Reuses the helper from Task 1; same scan, isolated cache key.

**Files:**
- Create: `lib/sis/document-chase-queue.ts`

- [ ] **Step 1: Write the loader file**

Create `lib/sis/document-chase-queue.ts`:

```ts
import { unstable_cache } from 'next/cache';

import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { DOCUMENT_SLOTS } from '@/lib/sis/queries';
import { scanDocStatusForActionFlags } from '@/lib/sis/process';

// ──────────────────────────────────────────────────────────────────────────
// Document chase queue — top-of-fold counts for /p-files, /admissions,
// /records dashboards. Counts students (not slots) with at least one slot
// in each of three orthogonal action states. Overlap allowed: a row with
// both an Uploaded slot and a 'To follow' slot counts in both validation
// and promised — same semantics as the cohort lifecycle aggregate widget.
//
// Cached per-AY with the existing `sis:${ayCode}` tag (KD #46), so any
// existing write that already invalidates that tag (PATCH on
// /api/sis/students/[enroleeNumber]/documents, residence-history editor,
// etc.) automatically refreshes these counts.
// ──────────────────────────────────────────────────────────────────────────

export type DocumentChaseQueueCounts = {
  promised: number;     // any slot at 'To follow'
  validation: number;   // any slot at 'Uploaded'
  revalidation: number; // any slot at 'Rejected' or 'Expired'
};

const CACHE_TTL_SECONDS = 60;

function prefixFor(ayCode: string): string {
  return `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
}

async function loadChaseQueueUncached(
  ayCode: string,
): Promise<DocumentChaseQueueCounts> {
  const prefix = prefixFor(ayCode);
  const supabase = createAdmissionsClient();

  const docColumns = ['enroleeNumber', ...DOCUMENT_SLOTS.map((s) => s.statusCol)];

  const docsRes = await supabase
    .from(`${prefix}_enrolment_documents`)
    .select(docColumns.join(', '));

  if (docsRes.error) {
    console.warn(
      '[sis/document-chase-queue] docs fetch failed:',
      docsRes.error.message,
    );
    return { promised: 0, validation: 0, revalidation: 0 };
  }

  let promised = 0;
  let validation = 0;
  let revalidation = 0;

  type DocRow = Record<string, string | null>;
  const rows = (docsRes.data ?? []) as unknown as DocRow[];

  for (const row of rows) {
    const flags = scanDocStatusForActionFlags(row);
    if (flags.hasPromised) promised += 1;
    if (flags.hasValidation) validation += 1;
    if (flags.hasRevalidation) revalidation += 1;
  }

  return { promised, validation, revalidation };
}

export async function getDocumentChaseQueueCounts(
  ayCode: string,
): Promise<DocumentChaseQueueCounts> {
  return unstable_cache(
    () => loadChaseQueueUncached(ayCode),
    ['sis', 'document-chase-queue', ayCode],
    {
      revalidate: CACHE_TTL_SECONDS,
      tags: ['sis', `sis:${ayCode}`],
    },
  )();
}
```

- [ ] **Step 2: Verify the build**

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 3: Commit**

```bash
git add lib/sis/document-chase-queue.ts
git commit -m "feat(sis): add getDocumentChaseQueueCounts loader

Returns { promised, validation, revalidation } counts for the
top-of-fold chase strip on /p-files, /admissions, /records. Reuses
scanDocStatusForActionFlags so behavior matches the cohort aggregate
widget exactly. 60s unstable_cache, sis:\${ayCode} tag (KD #46)."
```

---

## Task 6: Document chase queue strip component

**Goal:** Server component rendering 3 cards in a flex row. Each card opens a `<LifecycleDrillSheet>` for the matching target. Reused on all 3 dashboards.

**Files:**
- Create: `components/sis/document-chase-queue-strip.tsx`

- [ ] **Step 1: Write the component**

Create `components/sis/document-chase-queue-strip.tsx`:

```tsx
import { AlertTriangle, FileWarning, MailQuestion } from 'lucide-react';

import { LifecycleDrillSheet } from '@/components/sis/drills/lifecycle-drill-sheet';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getDocumentChaseQueueCounts } from '@/lib/sis/document-chase-queue';
import type { LifecycleDrillTarget } from '@/lib/sis/drill';

// ──────────────────────────────────────────────────────────────────────────
// DocumentChaseQueueStrip — top-of-fold "documents needing action" surface
// for the 3 dashboards that own document chase work: /p-files, /admissions,
// /records. Three cards in a flex row, each click-to-drill into the matching
// LifecycleDrillSheet target (KD #56).
//
// Spec: docs/superpowers/specs/2026-04-28-to-follow-document-flag-design.md
//       § 4 (Top-of-fold dashboard chase queue).
// ──────────────────────────────────────────────────────────────────────────

export type DocumentChaseQueueStripProps = {
  ayCode: string;
};

type ChaseTile = {
  target: LifecycleDrillTarget;
  label: string;
  description: string;
  icon: typeof AlertTriangle;
  severity: 'bad' | 'warn';
};

const TILES: ChaseTile[] = [
  {
    target: 'awaiting-document-revalidation',
    label: 'Awaiting revalidation',
    description: 'Rejected or expired — parent must re-upload',
    icon: AlertTriangle,
    severity: 'bad',
  },
  {
    target: 'awaiting-document-validation',
    label: 'Awaiting validation',
    description: 'Parent uploaded — registrar to validate',
    icon: FileWarning,
    severity: 'warn',
  },
  {
    target: 'awaiting-promised-documents',
    label: 'Awaiting promised',
    description: 'Parent committed — file not sent yet',
    icon: MailQuestion,
    severity: 'warn',
  },
];

const TILE_CRAFT: Record<ChaseTile['severity'], string> = {
  // Mirrors §7.4 craft + §10 chip palette in 09a-design-patterns.md.
  bad: 'bg-gradient-to-br from-destructive/15 via-destructive/8 to-transparent ring-1 ring-inset ring-destructive/30',
  warn: 'bg-gradient-to-br from-brand-amber/20 via-brand-amber/8 to-transparent ring-1 ring-inset ring-brand-amber/30',
};

const ICON_TILE_CRAFT: Record<ChaseTile['severity'], string> = {
  bad: 'shadow-brand-tile-destructive bg-gradient-to-br from-destructive to-destructive/70 text-destructive-foreground',
  warn: 'shadow-brand-tile-amber bg-gradient-to-br from-brand-amber to-brand-amber/70 text-ink',
};

export async function DocumentChaseQueueStrip({
  ayCode,
}: DocumentChaseQueueStripProps) {
  const counts = await getDocumentChaseQueueCounts(ayCode);
  const total = counts.promised + counts.validation + counts.revalidation;

  if (total === 0) return null;

  const valueByTarget: Record<LifecycleDrillTarget, number | undefined> = {
    'awaiting-fee-payment': undefined,
    'awaiting-document-revalidation': counts.revalidation,
    'awaiting-document-validation': counts.validation,
    'awaiting-promised-documents': counts.promised,
    'awaiting-assessment-schedule': undefined,
    'awaiting-contract-signature': undefined,
    'missing-class-assignment': undefined,
    'ungated-to-enroll': undefined,
    'new-applications': undefined,
  };

  return (
    <section className="grid gap-4 md:grid-cols-3" aria-label="Documents needing action">
      {TILES.map((tile) => {
        const value = valueByTarget[tile.target] ?? 0;
        const Icon = tile.icon;
        return (
          <Card key={tile.target} className={TILE_CRAFT[tile.severity]}>
            <CardHeader>
              <CardAction>
                <div className={`flex size-12 items-center justify-center rounded-xl ${ICON_TILE_CRAFT[tile.severity]}`}>
                  <Icon className="size-6" aria-hidden />
                </div>
              </CardAction>
              <CardTitle className="font-serif text-3xl tabular-nums">
                {value}
              </CardTitle>
              <CardDescription className="font-mono text-[11px] uppercase tracking-[0.12em]">
                {tile.label}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-ink-2">{tile.description}</p>
            </CardContent>
            <CardFooter>
              <LifecycleDrillSheet target={tile.target} ayCode={ayCode} />
            </CardFooter>
          </Card>
        );
      })}
    </section>
  );
}
```

- [ ] **Step 2: Verify the component imports resolve and type-check**

Run: `npx next build`
Expected: clean compile. If `LifecycleDrillSheet` requires extra props (eg `initialRows`), inspect the component signature and adjust — `initialRows` is `?optional` per its definition (`components/sis/drills/lifecycle-drill-sheet.tsx:36`), so omitting it triggers the in-sheet `useEffect` fetch. That's the lazy-load contract per KD #56 (Sprint 23 update) — fine.

- [ ] **Step 3: Commit**

```bash
git add components/sis/document-chase-queue-strip.tsx
git commit -m "feat(sis): add DocumentChaseQueueStrip server component

3-card top-of-fold strip showing document action queue counts
(revalidation / validation / promised). Each card opens a
LifecycleDrillSheet for the matching target. Reused across the 3
dashboards that own document chase work in the next 3 commits.

Returns null when total === 0 so dashboards stay quiet on empty AYs.
Severity craft pulled from 09a-design-patterns.md §7.4 + §10."
```

---

## Task 7: Mount on `/admissions` dashboard

**Goal:** Strip lands top-of-fold on the admissions dashboard, immediately above the existing KPI grid.

**Files:**
- Modify: `app/(admissions)/admissions/page.tsx`

- [ ] **Step 1: Add the import**

Open `app/(admissions)/admissions/page.tsx`. Find the existing per-module imports (around line 7–17). Add the new import:

```tsx
import { DocumentChaseQueueStrip } from "@/components/sis/document-chase-queue-strip";
```

Place it alphabetically — between `DocumentCompletionCard` and `NewApplicationsPriority` if you want strict alphabetical order, or just at the end of the per-module group.

- [ ] **Step 2: Mount the strip in the JSX**

Find the existing operational top-of-fold mount in the JSX, around line 187:

```tsx
{/* Operational top-of-fold (KD #57) — new applications waiting on triage. */}
<NewApplicationsPriority ayCode={selectedAy} />

<InsightsPanel insights={insights} />
```

Insert the strip directly after `<NewApplicationsPriority>`:

```tsx
{/* Operational top-of-fold (KD #57) — new applications waiting on triage. */}
<NewApplicationsPriority ayCode={selectedAy} />

{/* Document chase queue (spec 2026-04-28) — top-of-fold navigation
    to revalidation / validation / promised drill sheets. */}
<DocumentChaseQueueStrip ayCode={selectedAy} />

<InsightsPanel insights={insights} />
```

- [ ] **Step 3: Verify the build**

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 4: Manual reproduction**

`npm run dev`. Navigate to `/admissions?ay=AY9999`. The 3-card chase strip renders directly below the existing "New applications priority" panel and above the InsightsPanel. Click each card — drill sheet opens with the right title and rows.

- [ ] **Step 5: Commit**

```bash
git add app/(admissions)/admissions/page.tsx
git commit -m "feat(admissions): mount DocumentChaseQueueStrip top-of-fold

Adds a 3-card document action queue strip immediately below the
NewApplicationsPriority panel. Operational accent on an analytical
dashboard — see spec 2026-04-28-to-follow-document-flag-design § 4d
for the deliberate KD #57 deviation."
```

---

## Task 8: Mount on `/records` dashboard

**Goal:** Same strip, same position, on the Records dashboard.

**Files:**
- Modify: `app/(records)/records/page.tsx`

- [ ] **Step 1: Add the import**

In `app/(records)/records/page.tsx`, add the import alongside the other component imports (search for the existing `import { ... } from "@/components/...";` block):

```tsx
import { DocumentChaseQueueStrip } from "@/components/sis/document-chase-queue-strip";
```

- [ ] **Step 2: Mount the strip in the JSX**

In the JSX (around line 152-162), the current sequence after `<DashboardHero>` is:

```tsx
<ComparisonToolbar ... />

<InsightsPanel insights={insights} />

{/* Range-aware KPIs */}
<section className="grid gap-4 xl:grid-cols-4">
  ...
```

Insert the strip between `<ComparisonToolbar>` and `<InsightsPanel>`:

```tsx
<ComparisonToolbar ... />

{/* Document chase queue (spec 2026-04-28) — top-of-fold navigation
    to revalidation / validation / promised drill sheets. */}
<DocumentChaseQueueStrip ayCode={selectedAy} />

<InsightsPanel insights={insights} />
```

- [ ] **Step 3: Verify the build**

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 4: Manual reproduction**

`npm run dev`. Navigate to `/records?ay=AY9999`. Strip renders top-of-fold above the Insights panel. Counts match the lifecycle aggregate widget farther down.

- [ ] **Step 5: Commit**

```bash
git add app/(records)/records/page.tsx
git commit -m "feat(records): mount DocumentChaseQueueStrip top-of-fold

Mirrors the admissions dashboard placement — strip sits between the
ComparisonToolbar and InsightsPanel. Operational accent on an
analytical dashboard (KD #57 deviation, spec § 4d)."
```

---

## Task 9: Mount on `/p-files` dashboard (sibling to PriorityPanel)

**Goal:** Strip sits directly below the existing `<PriorityPanel>` (expiring docs). Implementation refinement vs spec — see header note. Keeps `PriorityPayload` unchanged.

**Files:**
- Modify: `app/(p-files)/p-files/page.tsx`

- [ ] **Step 1: Add the import**

In `app/(p-files)/p-files/page.tsx` (around line 9 where `PriorityPanel` is imported), add:

```tsx
import { DocumentChaseQueueStrip } from "@/components/sis/document-chase-queue-strip";
```

- [ ] **Step 2: Mount the strip directly below `<PriorityPanel>`**

Find the existing PriorityPanel mount (around line 144):

```tsx
<PriorityPanel payload={priority} />
```

Insert the strip directly after:

```tsx
<PriorityPanel payload={priority} />

{/* Document chase queue (spec 2026-04-28) — sibling to the expiring-docs
    PriorityPanel. Together they form "Documents needing attention". */}
<DocumentChaseQueueStrip ayCode={selectedAy} />
```

- [ ] **Step 3: Verify the build**

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 4: Manual reproduction**

`npm run dev`. Navigate to `/p-files?ay=AY9999`. The PriorityPanel (expiring docs) renders, immediately followed by the 3-card chase strip. Both surfaces share the "documents needing attention" framing — expiring docs above, action queues below. Click each chase card — drill sheets open.

- [ ] **Step 5: Commit**

```bash
git add app/(p-files)/p-files/page.tsx
git commit -m "feat(p-files): mount DocumentChaseQueueStrip below PriorityPanel

Sibling card to the expiring-docs PriorityPanel — together they form
the 'documents needing attention' top-of-fold for the operational
P-Files dashboard. KD #31 preserved (writes still happen in
/admissions/applications/[enroleeNumber], the strip is read-only
chase navigation)."
```

---

## Task 10: Final verification + plan close-out

**Goal:** End-to-end happy path on AY9999. Confirm cohort widget, drill sheet, per-applicant timeline, and all 3 dashboard mounts agree.

- [ ] **Step 1: Clean build**

Run: `npx next build`
Expected: zero TS errors, zero unused-import warnings on the files touched.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: zero errors. Warnings on unrelated files OK.

- [ ] **Step 3: Manual end-to-end on AY9999**

Confirm in this order, in a fresh browser session:

1. `/sis/admin/settings` → switch to test environment (AY9999) if not already.
2. `/admissions?ay=AY9999` → chase strip renders top-of-fold with non-zero "Awaiting promised" count. Click that card → drill sheet opens, "Promised slots" column shows chips. Close.
3. Click *Awaiting validation* card → drill opens with "Uploaded slots" column. Close.
4. `/records?ay=AY9999` → same chase strip, same counts. Lifecycle aggregate widget (farther down) shows the new *Awaiting promised documents* bucket between *Awaiting document validation* and *Awaiting STP completion*. Counts match the strip.
5. `/p-files?ay=AY9999` → existing PriorityPanel renders above, chase strip below.
6. Open any "promised" student's profile (`/admissions/applications/<enroleeNumber>` for one of the rows in the drill). The Documents stage detail line shows `… · N promised · …` segment.
7. In `/admissions/applications/<enroleeNumber>`, edit one of that student's `'To follow'` slots to `'Valid'` (manually, via the existing form). Save. Refresh `/admissions` — chase-strip "Awaiting promised" count should decrement; the drill sheet for that target should no longer list this student.

- [ ] **Step 4: If anything fails — diagnose, fix, re-commit**

For build / lint failures, fix inline. For UX bugs, repro on AY9999 and trace through `process.ts` / `drill.ts` / `document-chase-queue.ts` accordingly.

- [ ] **Step 5: Sync docs**

Run the project's `/sync-docs` skill (per `.claude/rules/workflow.md` step 4) to update `CLAUDE.md` session-context bullet + `docs/sprints/development-plan.md` row entry for this work. Commit those edits separately.

---

## Out of scope (deferred)

- **Auto-detection of expiry** (`*Status = 'Valid'` + `*Expiry < CURRENT_DATE` → flip to `'Expired'`). KD #60 documents this as the contract but the implementation half doesn't exist; surface today still says `'Valid'` past expiry until someone manually edits. Separate spec to follow.
- **STP-conditional bucket variants.** The lifecycle aggregate's "Awaiting STP completion" already covers the STP slot family broadly; finer-grained "promised STP slots" would be a follow-on if HFSE asks.
