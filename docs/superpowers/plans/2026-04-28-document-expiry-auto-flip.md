# Document expiry auto-flip + expiring-soon drill — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `<slot>Status` column auto-flip from `'Valid'` → `'Expired'` when the matching `<slot>Expiry` date passes (page-entry lazy write, parallelized, 60s `unstable_cache`), and add a complementary read-time "expiring soon" 30-day drill exposed as a 4th chase strip tile.

**Architecture:** Two complementary mechanisms over the same data. (1) Reactive auto-flip — a `freshenAyDocuments(ayCode)` helper called at the top of every page that displays document status; runs 8 parallel `UPDATE`s wrapped in 60s cache, audits one batched row per call when flips happen. (2) Proactive expiring-soon — read-time only, derives from `<slot>Status === 'Valid' && <slot>Expiry ∈ [today, today + 30d]`, surfaced as a new `LifecycleDrillTarget` and a 4th chase strip tile. The reactive flip naturally evicts rows from the proactive bucket once the date passes.

**Tech Stack:** Next.js 16 (App Router, RSC), Supabase service-role + admissions client, `unstable_cache` (KD #46), `lib/audit/log-action.ts` (KD #9), shadcn primitives, lucide icons.

**Spec:** `docs/superpowers/specs/2026-04-28-document-expiry-auto-flip-design.md`

---

## File structure

| Path | Action | Responsibility |
|------|--------|----------------|
| `lib/audit/log-action.ts` | Modify | Add `'sis.documents.auto-expire'` to `AuditAction`; widen `actor.id` to `string \| null` for system actions |
| `lib/sis/freshen-document-statuses.ts` | Create | `freshenAyDocuments(ayCode)` — parallel UPDATEs, 60s `unstable_cache`, audit on flip |
| `app/(admissions)/admissions/page.tsx` | Modify | One-line `await freshenAyDocuments(selectedAy)` |
| `app/(records)/records/page.tsx` | Modify | Same |
| `app/(p-files)/p-files/page.tsx` | Modify | Same |
| `app/(admissions)/admissions/applications/[enroleeNumber]/page.tsx` | Modify | Same |
| `app/(records)/records/students/[studentNumber]/page.tsx` | Modify | Same |
| `app/(records)/records/students/by-enrolee/[enroleeNumber]/page.tsx` | Modify | Same |
| `app/(p-files)/p-files/[enroleeNumber]/page.tsx` | Modify | Same |
| `lib/sis/process.ts` | Modify | Extend `scanDocStatusForActionFlags` with `hasExpiringSoon` |
| `lib/sis/document-chase-queue.ts` | Modify | Export `EXPIRING_SOON_THRESHOLD_DAYS = 30`; widen SELECT to include expiry columns; add `expiringSoon` count |
| `components/sis/document-chase-queue-strip.tsx` | Modify | 4th tile `awaiting-expiring-documents`; grid widens to 4 columns; total includes `expiringSoon` |
| `lib/sis/drill.ts` | Modify | New target `'awaiting-expiring-documents'`; row fields `expiringSlots[]` + `daysLeft`; switch case; column-key extensions; default-columns + header |
| `components/sis/drills/lifecycle-drill-sheet.tsx` | Modify | Column renderers for `expiringSlots` + `daysLeft` |
| `app/api/sis/drill/[target]/route.ts` | Modify | CSV-cell cases for `expiringSlots` + `daysLeft` |

15 files total. **No DB migration. No new dependency. No new env var. No new API route.**

**Verification:** the repo has no test framework (`package.json` has `dev`/`build`/`start`/`lint` only). Each task ends with `npx next build` clean and where applicable a manual reproduction step in the browser on AY9999 (test mode, KD #52).

---

## Task 1: Extend `lib/audit/log-action.ts`

**Goal:** Add the new audit action enum entry and widen `actor.id` to `string | null` so system actions can pass `null` (the audit_log schema already permits null actor_id per migration 006).

**Files:**
- Modify: `lib/audit/log-action.ts`

- [ ] **Step 1: Add `'sis.documents.auto-expire'` to the `AuditAction` enum**

In `lib/audit/log-action.ts` around lines 6-74, find the `AuditAction` union. Add the new literal at the end of the `sis.*` cluster (after `'sis.allowance.update'` on line 47, or wherever the SIS cluster ends — preserve the existing grouping). Insert:

```ts
  | 'sis.documents.auto-expire'
```

- [ ] **Step 2: Widen `actor.id` from `string` to `string | null`**

In `lib/audit/log-action.ts` find the `LogActionParams` type (around line 107):

```ts
type LogActionParams = {
  service: SupabaseClient;
  actor: Pick<User, 'id' | 'email'> | { id: string; email: string | null };
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | null;
  context?: Record<string, unknown>;
};
```

Change to:

```ts
type LogActionParams = {
  service: SupabaseClient;
  actor: Pick<User, 'id' | 'email'> | { id: string | null; email: string | null };
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | null;
  context?: Record<string, unknown>;
};
```

The function body (around line 122-130) inserts `actor.id` into the `actor_id` column directly; the column already accepts null per migration 006. No body changes needed — TypeScript widening is enough.

- [ ] **Step 3: Verify the build**

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 4: Commit**

```bash
git add lib/audit/log-action.ts
git commit -m "feat(audit): add sis.documents.auto-expire + allow null actor.id

Adds the action literal for the upcoming auto-expire freshen helper,
and widens LogActionParams.actor.id from string to string|null so
system-triggered audit rows can pass null. The audit_log schema
already permits null actor_id per migration 006 (system actions).
Existing call sites that pass a real user are unaffected.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Create `lib/sis/freshen-document-statuses.ts`

**Goal:** The auto-flip helper. Wraps `unstable_cache` (60s TTL, tag `sis:${ayCode}`) around an internal `freshenAyDocumentsUncached` that runs 8 parallel `UPDATE`s and audits one batched row when flips happened.

**Files:**
- Create: `lib/sis/freshen-document-statuses.ts`

- [ ] **Step 1: Write the file**

Create `lib/sis/freshen-document-statuses.ts` with the following content:

```ts
import 'server-only';

import { unstable_cache } from 'next/cache';

import { logAction } from '@/lib/audit/log-action';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';
import { DOCUMENT_SLOTS } from '@/lib/sis/queries';

// ──────────────────────────────────────────────────────────────────────────
// freshen-document-statuses — KD #60 reactive auto-flip.
//
// Implements the "auto-flip when expiry passes" half of KD #60's expiring-
// document contract. Called at the top of every page RSC that displays
// document status. Each call runs 8 parallel idempotent UPDATEs (one per
// expiring slot) and flips `<slot>Status = 'Valid'` rows whose `<slot>Expiry`
// is in the past to `'Expired'`. Cached for 60s per AY so rapid refreshes
// don't repeat work; tag-invalidated by `sis:${ayCode}` so manual edits via
// existing PATCH routes don't see stale freshen results.
//
// Spec: docs/superpowers/specs/2026-04-28-document-expiry-auto-flip-design.md
// ──────────────────────────────────────────────────────────────────────────

export type FreshenResult = {
  flippedCount: number;
  flippedBySlot: Record<string, number>;
  enroleeNumbers: string[]; // capped at 50 in the audit context
};

const EXPIRING_SLOTS = DOCUMENT_SLOTS.filter((s) => s.expiryCol);
const CACHE_TTL_SECONDS = 60;

function prefixFor(ayCode: string): string {
  return `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
}

async function freshenAyDocumentsUncached(ayCode: string): Promise<FreshenResult> {
  const result: FreshenResult = {
    flippedCount: 0,
    flippedBySlot: {},
    enroleeNumbers: [],
  };

  const admissions = createAdmissionsClient();
  const prefix = prefixFor(ayCode);
  const seen = new Set<string>();
  const today = new Date().toISOString().slice(0, 10);

  try {
    // 8 per-slot UPDATEs in parallel — single Supabase roundtrip latency
    // dominates instead of 8x sequential. Each UPDATE is independent and
    // idempotent; concurrent execution is safe.
    const slotResults = await Promise.all(
      EXPIRING_SLOTS.map(async (slot) => {
        const { data, error } = await admissions
          .from(`${prefix}_enrolment_documents`)
          .update({ [slot.statusCol]: 'Expired' })
          .eq(slot.statusCol, 'Valid')
          .lt(slot.expiryCol!, today)
          .not(slot.expiryCol!, 'is', null)
          .select(`enroleeNumber, ${slot.expiryCol!}`);

        if (error) {
          console.warn(
            `[sis/freshen-documents] flip failed for ${slot.key} in ${ayCode}:`,
            error.message,
          );
          return { slotKey: slot.key, flipped: [] as Array<{ enroleeNumber: string | null }> };
        }

        return { slotKey: slot.key, flipped: data ?? [] };
      }),
    );

    for (const { slotKey, flipped } of slotResults) {
      if (flipped.length > 0) {
        result.flippedCount += flipped.length;
        result.flippedBySlot[slotKey] = flipped.length;
        for (const row of flipped) {
          if (row.enroleeNumber) seen.add(row.enroleeNumber);
        }
      }
    }
  } catch (e) {
    // Catch-all: never break a page render because freshen failed.
    console.warn(
      `[sis/freshen-documents] unexpected failure for ${ayCode}:`,
      e instanceof Error ? e.message : String(e),
    );
    return result;
  }

  result.enroleeNumbers = Array.from(seen).slice(0, 50);

  if (result.flippedCount > 0) {
    try {
      await logAction({
        service: createServiceClient(),
        actor: { id: null, email: '(system:freshen)' },
        action: 'sis.documents.auto-expire',
        entityType: 'enrolment_document',
        entityId: null,
        context: {
          ayCode,
          flippedCount: result.flippedCount,
          flippedBySlot: result.flippedBySlot,
          enroleeNumbers: result.enroleeNumbers,
          truncated: seen.size > 50 ? seen.size - 50 : 0,
        },
      });
    } catch (e) {
      console.warn(
        `[sis/freshen-documents] audit log failed for ${ayCode}:`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  return result;
}

export function freshenAyDocuments(ayCode: string): Promise<FreshenResult> {
  return unstable_cache(
    () => freshenAyDocumentsUncached(ayCode),
    ['sis', 'freshen-documents', ayCode],
    {
      revalidate: CACHE_TTL_SECONDS,
      tags: ['sis', `sis:${ayCode}`],
    },
  )();
}
```

- [ ] **Step 2: Verify the build**

Run: `npx next build`
Expected: clean compile. The helper is unused so far — Tasks 3-9 wire it into pages.

- [ ] **Step 3: Commit**

```bash
git add lib/sis/freshen-document-statuses.ts
git commit -m "feat(sis): add freshenAyDocuments helper

KD #60's auto-flip half: when <slot>Expiry has passed and <slot>Status
is still 'Valid', flip to 'Expired'. 8 per-slot UPDATEs run in
parallel; helper is wrapped in unstable_cache (60s TTL,
sis:\${ayCode} tag) so rapid refreshes dedupe and existing PATCH
routes' revalidateTag calls naturally invalidate.

Audit row added only when flips actually happened (one batched
entry per call). System actor (actor.id = null per the audit_log
schema's documented convention).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Mount `freshenAyDocuments` on `/admissions`

**Goal:** Add a single `await freshenAyDocuments(selectedAy)` call at the top of the admissions dashboard RSC, after `selectedAy` is resolved and before the existing `Promise.all([...])` data fetches.

**Files:**
- Modify: `app/(admissions)/admissions/page.tsx`

- [ ] **Step 1: Add the import**

In `app/(admissions)/admissions/page.tsx`, find the existing `import { ... } from "@/lib/sis/...";` block. Add:

```ts
import { freshenAyDocuments } from "@/lib/sis/freshen-document-statuses";
```

Place it alphabetically alongside the other `lib/sis/...` imports.

- [ ] **Step 2: Insert the freshen call**

Find the line where `selectedAy` is resolved (around line 87 — the `const selectedAy = ...` assignment). Find the immediately-following `Promise.all([...])` invocation (around line 107 in the existing file, but locate by content — search for `await Promise.all`).

Insert this line BEFORE the `await Promise.all` (and after any sequential `await` calls that don't depend on doc statuses, e.g. `getDashboardWindows`):

```ts
  // Auto-flip any expired-but-still-Valid doc statuses for this AY before
  // the dashboard reads the column. Cached 60s; existing PATCH routes
  // invalidate via the sis:${ayCode} tag.
  await freshenAyDocuments(selectedAy);
```

The result is unused; the side effect (DB UPDATE if applicable) is what matters.

- [ ] **Step 3: Verify the build**

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 4: Commit**

```bash
git add 'app/(admissions)/admissions/page.tsx'
git commit -m "feat(admissions): freshen doc statuses before dashboard read

Adds a single await freshenAyDocuments(selectedAy) at the top of the
admissions dashboard RSC. Cached 60s per AY — rapid refreshes dedupe.
Tag-invalidated by manual PATCH routes (existing behavior).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Mount `freshenAyDocuments` on `/records`

**Goal:** Same one-line freshen at the top of the records dashboard RSC.

**Files:**
- Modify: `app/(records)/records/page.tsx`

- [ ] **Step 1: Add the import**

In `app/(records)/records/page.tsx`, alongside the other `@/lib/sis/...` imports, add:

```ts
import { freshenAyDocuments } from "@/lib/sis/freshen-document-statuses";
```

- [ ] **Step 2: Insert the freshen call**

Find the `const selectedAy = ...` assignment. Locate the `await Promise.all([...])` invocation that follows it. Insert before the `Promise.all`:

```ts
  // Auto-flip any expired-but-still-Valid doc statuses for this AY.
  await freshenAyDocuments(selectedAy);
```

- [ ] **Step 3: Verify the build**

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 4: Commit**

```bash
git add 'app/(records)/records/page.tsx'
git commit -m "feat(records): freshen doc statuses before dashboard read

Mirrors the admissions mount — one-line freshen call before the
records dashboard's data fetches read the doc status columns.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Mount `freshenAyDocuments` on `/p-files`

**Goal:** Same one-line freshen at the top of the P-Files dashboard RSC.

**Files:**
- Modify: `app/(p-files)/p-files/page.tsx`

- [ ] **Step 1: Add the import**

In `app/(p-files)/p-files/page.tsx`, alongside the other `@/lib/sis/...` imports, add:

```ts
import { freshenAyDocuments } from "@/lib/sis/freshen-document-statuses";
```

- [ ] **Step 2: Insert the freshen call**

Find the `const selectedAy = ...` assignment. Insert before the `Promise.all([...])`:

```ts
  // Auto-flip any expired-but-still-Valid doc statuses for this AY.
  await freshenAyDocuments(selectedAy);
```

- [ ] **Step 3: Verify the build**

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 4: Commit**

```bash
git add 'app/(p-files)/p-files/page.tsx'
git commit -m "feat(p-files): freshen doc statuses before dashboard read

Mirrors the admissions/records mount.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Mount `freshenAyDocuments` on `/admissions/applications/[enroleeNumber]`

**Goal:** Same call on the applicant detail RSC. Covers direct-link case (admin opens email link to a student profile without first opening any dashboard).

**Files:**
- Modify: `app/(admissions)/admissions/applications/[enroleeNumber]/page.tsx`

- [ ] **Step 1: Add the import**

In `app/(admissions)/admissions/applications/[enroleeNumber]/page.tsx`, add:

```ts
import { freshenAyDocuments } from "@/lib/sis/freshen-document-statuses";
```

alongside the other `@/lib/sis/...` imports.

- [ ] **Step 2: Insert the freshen call**

Find where the AY code is resolved on this page (the page must determine which AY's documents row to display — search for `ayCode` or similar). The applicant detail page resolves AY from the student's primary record; once you have the AY code in scope, insert before the data-fetch `Promise.all`:

```ts
  await freshenAyDocuments(ayCode);  // or whatever the local variable is named
```

If the variable is named differently (e.g. `selectedAy`, `studentAy`, or just `ay`), adjust to match the local scope. The function signature is `freshenAyDocuments(ayCode: string)` — pass whatever resolves to the AY string.

- [ ] **Step 3: Verify the build**

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 4: Commit**

```bash
git add 'app/(admissions)/admissions/applications/[enroleeNumber]/page.tsx'
git commit -m "feat(admissions): freshen doc statuses on applicant detail page

Covers the direct-link case (admin opens email link to a student
profile bypassing the dashboard). Without this, the timeline could
show 'Valid' for a passport that should have flipped to 'Expired'
days ago, and refresh would not pick it up.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Mount `freshenAyDocuments` on `/records/students/[studentNumber]`

**Goal:** Same call on the records student-by-studentNumber detail page.

**Files:**
- Modify: `app/(records)/records/students/[studentNumber]/page.tsx`

- [ ] **Step 1: Add the import**

In `app/(records)/records/students/[studentNumber]/page.tsx`, add:

```ts
import { freshenAyDocuments } from "@/lib/sis/freshen-document-statuses";
```

- [ ] **Step 2: Insert the freshen call**

Once the AY code is resolved in this page's scope, insert before the doc-reading data fetches:

```ts
  await freshenAyDocuments(ayCode);  // adjust local variable name
```

- [ ] **Step 3: Verify the build**

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 4: Commit**

```bash
git add 'app/(records)/records/students/[studentNumber]/page.tsx'
git commit -m "feat(records): freshen doc statuses on student detail (by studentNumber)

Same direct-link coverage as the admissions applicant detail page.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Mount `freshenAyDocuments` on `/records/students/by-enrolee/[enroleeNumber]`

**Goal:** Same call on the records student-by-enroleeNumber detail page.

**Files:**
- Modify: `app/(records)/records/students/by-enrolee/[enroleeNumber]/page.tsx`

- [ ] **Step 1: Add the import**

```ts
import { freshenAyDocuments } from "@/lib/sis/freshen-document-statuses";
```

- [ ] **Step 2: Insert the freshen call**

Once the AY code is resolved, insert:

```ts
  await freshenAyDocuments(ayCode);
```

- [ ] **Step 3: Verify the build**

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 4: Commit**

```bash
git add 'app/(records)/records/students/by-enrolee/[enroleeNumber]/page.tsx'
git commit -m "feat(records): freshen doc statuses on student detail (by enrolee)

Direct-link coverage parity with the by-studentNumber variant.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Mount `freshenAyDocuments` on `/p-files/[enroleeNumber]`

**Goal:** Same call on the P-Files student detail page.

**Files:**
- Modify: `app/(p-files)/p-files/[enroleeNumber]/page.tsx`

- [ ] **Step 1: Add the import**

```ts
import { freshenAyDocuments } from "@/lib/sis/freshen-document-statuses";
```

- [ ] **Step 2: Insert the freshen call**

Once the AY code is resolved, insert:

```ts
  await freshenAyDocuments(ayCode);
```

- [ ] **Step 3: Verify the build**

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 4: Commit**

```bash
git add 'app/(p-files)/p-files/[enroleeNumber]/page.tsx'
git commit -m "feat(p-files): freshen doc statuses on student detail page

Closes the seven-page coverage of doc-status surfaces. After this,
every read path that displays document status sees a freshly-flipped
column on first visit per 60-second window.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Extend `scanDocStatusForActionFlags` for `hasExpiringSoon`

**Goal:** The shared scan helper from the previous "To follow" sprint gets a 4th boolean flag — `hasExpiringSoon` — that is true when at least one slot has `<slot>Status === 'Valid'` AND `<slot>Expiry` is between today (inclusive) and today+30 days (inclusive).

**Files:**
- Modify: `lib/sis/process.ts`

- [ ] **Step 1: Export `EXPIRING_SOON_THRESHOLD_DAYS` constant**

In `lib/sis/process.ts`, near the top of the file (after the imports and before any existing exports), add:

```ts
// Threshold (in days) for the proactive "expiring soon" signal. A slot is
// "expiring soon" when its expiry date falls within [today, today + N days]
// and its status is still 'Valid'. Owned by this module because
// scanDocStatusForActionFlags is the canonical detection point;
// `lib/sis/document-chase-queue.ts` and `lib/sis/drill.ts` import from here
// to keep the threshold in one place. (Defined here, not in
// document-chase-queue.ts, to avoid a circular import — that module
// already imports scanDocStatusForActionFlags from process.ts.)
export const EXPIRING_SOON_THRESHOLD_DAYS = 30;
```

- [ ] **Step 2: Extend the `DocStatusActionFlags` type**

In `lib/sis/process.ts` find `DocStatusActionFlags` (search for the type literal — it was defined in the previous sprint). Replace:

```ts
export type DocStatusActionFlags = {
  hasRevalidation: boolean;
  hasValidation: boolean;
  hasPromised: boolean;
};
```

with:

```ts
export type DocStatusActionFlags = {
  hasRevalidation: boolean;
  hasValidation: boolean;
  hasPromised: boolean;
  hasExpiringSoon: boolean;
};
```

- [ ] **Step 3: Extend the helper to compute `hasExpiringSoon`**

In `lib/sis/process.ts`, find the `scanDocStatusForActionFlags` function. Replace its body with:

```ts
export function scanDocStatusForActionFlags(
  docs: Record<string, string | null> | undefined,
): DocStatusActionFlags {
  const out: DocStatusActionFlags = {
    hasRevalidation: false,
    hasValidation: false,
    hasPromised: false,
    hasExpiringSoon: false,
  };
  if (!docs) return out;

  const now = Date.now();
  const thresholdMs = EXPIRING_SOON_THRESHOLD_DAYS * 86_400_000;

  for (const slot of DOCUMENT_SLOTS) {
    const v = (docs[slot.statusCol] ?? '').toString().trim();
    if (v === 'Rejected' || v === 'Expired') out.hasRevalidation = true;
    else if (v === 'Uploaded') out.hasValidation = true;
    else if (v === 'To follow') out.hasPromised = true;

    // Expiring soon: only meaningful for slots that have an expiryCol.
    // A slot with status='Valid' and expiry within [today, today + N days]
    // is still in the chase queue — parent needs to act before it
    // flips to 'Expired'. The expiry data may be absent from `docs` if
    // the caller's SELECT didn't include the expiry columns; in that
    // case the flag stays false (safe default).
    if (slot.expiryCol && v === 'Valid' && !out.hasExpiringSoon) {
      const raw = docs[slot.expiryCol];
      if (raw) {
        const ms = Date.parse(raw.toString());
        if (!Number.isNaN(ms)) {
          const delta = ms - now;
          if (delta >= 0 && delta <= thresholdMs) {
            out.hasExpiringSoon = true;
          }
        }
      }
    }

    if (
      out.hasRevalidation &&
      out.hasValidation &&
      out.hasPromised &&
      out.hasExpiringSoon
    ) {
      break;
    }
  }
  return out;
}
```

- [ ] **Step 4: Verify the build**

Run: `npx next build`
Expected: clean compile. Existing call sites (in `lib/sis/process.ts::loadLifecycleAggregateUncached` and `lib/sis/document-chase-queue.ts::loadChaseQueueUncached`) consume `hasRevalidation` / `hasValidation` / `hasPromised`; the new flag is silently ignored by them. Task 11 wires the new flag into the chase queue counts.

- [ ] **Step 5: Commit**

```bash
git add lib/sis/process.ts
git commit -m "feat(sis): scanDocStatusForActionFlags computes hasExpiringSoon

Adds a 4th boolean flag to the shared scan helper: true when any slot
has status='Valid' and expiry within [today, today + N days], where
N = EXPIRING_SOON_THRESHOLD_DAYS (also exported from this module).
Existing call sites silently ignore the new flag; Task 11 wires the
chase-queue count, Task 13 wires the drill target.

Caller is responsible for passing the slot's expiry column in the
docs row argument; if absent, the flag stays false (safe default).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Extend `getDocumentChaseQueueCounts` with `expiringSoon`

**Goal:** The chase-queue loader gains a 4th counter — `expiringSoon` — that is incremented per row whose `hasExpiringSoon` flag is true. Also widens the SELECT to include the 8 expiring slots' `*Expiry` columns so the helper has the data it needs.

**Files:**
- Modify: `lib/sis/document-chase-queue.ts`

- [ ] **Step 1: Extend the return type**

Find `DocumentChaseQueueCounts`:

```ts
export type DocumentChaseQueueCounts = {
  promised: number;
  validation: number;
  revalidation: number;
};
```

Change to:

```ts
export type DocumentChaseQueueCounts = {
  promised: number;
  validation: number;
  revalidation: number;
  expiringSoon: number;
};
```

- [ ] **Step 2: Widen the SELECT to include expiry columns**

Find the `docColumns` list inside `loadChaseQueueUncached`:

```ts
const docColumns = ['enroleeNumber', ...DOCUMENT_SLOTS.map((s) => s.statusCol)];
```

Change to:

```ts
const docColumns = [
  'enroleeNumber',
  ...DOCUMENT_SLOTS.map((s) => s.statusCol),
  ...DOCUMENT_SLOTS.filter((s) => s.expiryCol).map((s) => s.expiryCol!),
];
```

- [ ] **Step 3: Initialize the new counter and increment it**

Find the counter declarations and the loop that increments them. The existing block looks like:

```ts
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
```

Change to:

```ts
let promised = 0;
let validation = 0;
let revalidation = 0;
let expiringSoon = 0;

type DocRow = Record<string, string | null>;
const rows = (docsRes.data ?? []) as unknown as DocRow[];

for (const row of rows) {
  const flags = scanDocStatusForActionFlags(row);
  if (flags.hasPromised) promised += 1;
  if (flags.hasValidation) validation += 1;
  if (flags.hasRevalidation) revalidation += 1;
  if (flags.hasExpiringSoon) expiringSoon += 1;
}

return { promised, validation, revalidation, expiringSoon };
```

Also update the early-error-return block (returns the all-zero shape):

```ts
return { promised: 0, validation: 0, revalidation: 0 };
```

→

```ts
return { promised: 0, validation: 0, revalidation: 0, expiringSoon: 0 };
```

- [ ] **Step 4: Verify the build**

Run: `npx next build`
Expected: clean compile. The chase strip component will get a TypeScript error in Task 12 if it's not updated to handle the new field — but since the component spreads the counts via a `valueByTarget` map, the new key won't break anything until Task 12 actively wires it. Build should still pass at this point.

- [ ] **Step 5: Commit**

```bash
git add lib/sis/document-chase-queue.ts
git commit -m "feat(sis): chase queue counts include expiringSoon

DocumentChaseQueueCounts gains a 4th field. SELECT widened to include
the 8 expiring slots' *Expiry columns so scanDocStatusForActionFlags
can compute the new flag. Threshold constant lives in lib/sis/process.ts
to avoid a circular import.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Add 4th tile to `<DocumentChaseQueueStrip>`

**Goal:** The chase strip gains an "Expiring soon" tile (severity warn, lucide icon `CalendarClock`). Grid widens from 3 columns to 4. The `valueByTarget` map maps the new target key to the new count.

**Files:**
- Modify: `components/sis/document-chase-queue-strip.tsx`

- [ ] **Step 1: Update the lucide imports**

At the top of `components/sis/document-chase-queue-strip.tsx` find:

```ts
import { AlertTriangle, FileWarning, MailQuestion } from 'lucide-react';
```

Change to:

```ts
import { AlertTriangle, CalendarClock, FileWarning, MailQuestion } from 'lucide-react';
```

- [ ] **Step 2: Add the 4th tile to the `TILES` array**

Find the `TILES: ChaseTile[]` array. After the existing 3rd tile (`'awaiting-promised-documents'`), insert:

```ts
  {
    target: 'awaiting-expiring-documents',
    label: 'Expiring soon',
    description: 'Valid now, expiry within 30 days — chase parent for renewal',
    icon: CalendarClock,
    severity: 'warn',
  },
```

The full `TILES` array is now 4 entries.

- [ ] **Step 3: Update the `total` and `valueByTarget` for the new key**

Find the lines:

```ts
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
```

Change to:

```ts
  const total =
    counts.promised + counts.validation + counts.revalidation + counts.expiringSoon;

  if (total === 0) return null;

  const valueByTarget: Record<LifecycleDrillTarget, number | undefined> = {
    'awaiting-fee-payment': undefined,
    'awaiting-document-revalidation': counts.revalidation,
    'awaiting-document-validation': counts.validation,
    'awaiting-promised-documents': counts.promised,
    'awaiting-expiring-documents': counts.expiringSoon,
    'awaiting-assessment-schedule': undefined,
    'awaiting-contract-signature': undefined,
    'missing-class-assignment': undefined,
    'ungated-to-enroll': undefined,
    'new-applications': undefined,
  };
```

(Note: the literal `'awaiting-expiring-documents'` in the type-key position will fail TS exhaustiveness until Task 13 extends the `LifecycleDrillTarget` union. Tasks 12 + 13 are tightly coupled — do them together if the build fails between them.)

- [ ] **Step 4: Widen the grid to 4 columns**

Find the section element near the bottom of the component:

```tsx
<section className="grid gap-4 md:grid-cols-3" aria-label="Documents needing action">
```

Change to:

```tsx
<section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4" aria-label="Documents needing action">
```

This collapses gracefully on tablet (2 columns) and lays out flat on desktop (4 columns).

- [ ] **Step 5: Verify the build**

Run: `npx next build`
Expected: TypeScript may complain about `'awaiting-expiring-documents'` not being a valid `LifecycleDrillTarget` literal. **That's expected — Task 13 extends the union.** Proceed to Task 13 immediately and re-build then. If the TS error blocks the strip build entirely, you can either:
  - (a) Continue to Task 13 first, then come back and finalize this task's commit when both are done.
  - (b) Use `as LifecycleDrillTarget` cast as a temporary bridge — but Task 13 will remove the need.

- [ ] **Step 6: Commit (after Task 13 if exhaustiveness blocked the build)**

```bash
git add components/sis/document-chase-queue-strip.tsx
git commit -m "feat(sis): 4th chase strip tile — Expiring soon

Adds 'awaiting-expiring-documents' tile to the chase queue. Grid
widens to 4 columns on desktop, 2 on tablet. Severity warn (amber);
lucide icon CalendarClock. valueByTarget extended with the new key.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Wire `awaiting-expiring-documents` drill target

**Goal:** Extend `lib/sis/drill.ts` end-to-end to register the new drill target. Mirrors the pattern of the 3 existing doc-chase drill targets (revalidation, validation, promised).

**Files:**
- Modify: `lib/sis/drill.ts`

- [ ] **Step 1: Add `EXPIRING_SOON_THRESHOLD_DAYS` import**

In `lib/sis/drill.ts`, add the import (alongside the existing `DOCUMENT_SLOTS` import from `@/lib/sis/queries` near the top of the file). The constant will be used inside the new switch case in Step 4:

```ts
import { EXPIRING_SOON_THRESHOLD_DAYS } from '@/lib/sis/process';
```

(`drill.ts` does not currently import from `process.ts`; this is a new edge in the import graph. There is no circular risk because `process.ts` does not import from `drill.ts`.)

- [ ] **Step 2: Extend `LifecycleDrillTarget` union**

Find:

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
```

Change to (insert after `awaiting-promised-documents`):

```ts
export type LifecycleDrillTarget =
  | 'awaiting-fee-payment'
  | 'awaiting-document-revalidation'
  | 'awaiting-document-validation'
  | 'awaiting-promised-documents'
  | 'awaiting-expiring-documents'
  | 'awaiting-assessment-schedule'
  | 'awaiting-contract-signature'
  | 'missing-class-assignment'
  | 'ungated-to-enroll'
  | 'new-applications';
```

- [ ] **Step 3: Extend `LIFECYCLE_DRILL_TARGETS` array**

Find:

```ts
export const LIFECYCLE_DRILL_TARGETS: LifecycleDrillTarget[] = [
  'awaiting-fee-payment',
  'awaiting-document-revalidation',
  'awaiting-document-validation',
  'awaiting-promised-documents',
  'awaiting-assessment-schedule',
  ...
];
```

Insert `'awaiting-expiring-documents'` after `'awaiting-promised-documents'`:

```ts
export const LIFECYCLE_DRILL_TARGETS: LifecycleDrillTarget[] = [
  'awaiting-fee-payment',
  'awaiting-document-revalidation',
  'awaiting-document-validation',
  'awaiting-promised-documents',
  'awaiting-expiring-documents',
  'awaiting-assessment-schedule',
  'awaiting-contract-signature',
  'missing-class-assignment',
  'ungated-to-enroll',
  'new-applications',
];
```

- [ ] **Step 4: Extend `LifecycleDrillRow` with `expiringSlots` and `daysLeft`**

Find:

```ts
export type LifecycleDrillRow = {
  // ...
  promisedSlots?: string[];
  // ...
};
```

Add after `promisedSlots?: string[];`:

```ts
  expiringSlots?: string[];
  daysLeft?: number | null;
```

The full type now ends with `... promisedSlots?: string[]; expiringSlots?: string[]; daysLeft?: number | null; ...`.

- [ ] **Step 5: Add the build switch case**

Find the `case 'awaiting-promised-documents':` block in `buildLifecycleDrillRows` (around line 920+). Directly after that case (before `case 'awaiting-assessment-schedule':`), insert:

```ts
      case 'awaiting-expiring-documents': {
        if (!docs) break;
        const expiringSlots: string[] = [];
        let soonestDays: number | null = null;
        const now = Date.now();
        const thresholdMs = EXPIRING_SOON_THRESHOLD_DAYS * 86_400_000;
        for (const slot of DOCUMENT_SLOTS) {
          if (!slot.expiryCol) continue;
          const slotStatus = (docs[slot.statusCol] ?? '').toString().trim();
          if (slotStatus !== 'Valid') continue;
          const raw = docs[slot.expiryCol];
          if (!raw) continue;
          const ms = Date.parse(raw.toString());
          if (Number.isNaN(ms)) continue;
          const delta = ms - now;
          if (delta < 0 || delta > thresholdMs) continue;
          const days = Math.floor(delta / 86_400_000);
          expiringSlots.push(slot.label);
          if (soonestDays === null || days < soonestDays) soonestDays = days;
        }
        if (expiringSlots.length > 0) {
          out.push({
            ...baseRow(enroleeNumber, app, status),
            documentStatus: status.documentStatus ?? null,
            expiringSlots,
            daysLeft: soonestDays,
          });
        }
        break;
      }
```

- [ ] **Step 6: Extend `LifecycleDrillColumnKey` union**

Find:

```ts
export type LifecycleDrillColumnKey =
  | 'enroleeNumber'
  // ...
  | 'promisedSlots'
  // ...
```

Insert `| 'expiringSlots'` and `| 'daysLeft'` directly after `| 'promisedSlots'`:

```ts
  | 'promisedSlots'
  | 'expiringSlots'
  | 'daysLeft'
```

- [ ] **Step 7: Extend `ALL_LIFECYCLE_DRILL_COLUMNS`**

Find the `ALL_LIFECYCLE_DRILL_COLUMNS` array. Insert `'expiringSlots'` and `'daysLeft'` after `'promisedSlots'`:

```ts
  'promisedSlots',
  'expiringSlots',
  'daysLeft',
```

- [ ] **Step 8: Extend `LIFECYCLE_DRILL_COLUMN_LABELS`**

Find the labels record. Insert after `promisedSlots: 'Promised slots',`:

```ts
  expiringSlots: 'Expiring slots',
  daysLeft: 'Days left',
```

- [ ] **Step 9: Add to `defaultColumnsForLifecycleTarget`**

Find the `case 'awaiting-promised-documents':` block in `defaultColumnsForLifecycleTarget`. After it, insert:

```ts
    case 'awaiting-expiring-documents':
      return [
        'enroleeFullName',
        'levelApplied',
        'expiringSlots',
        'daysLeft',
        'applicationStatus',
        'daysSinceUpdate',
      ];
```

- [ ] **Step 10: Add to `lifecycleDrillHeaderForTarget`**

Find the `case 'awaiting-promised-documents':` block in `lifecycleDrillHeaderForTarget`. After it, insert:

```ts
    case 'awaiting-expiring-documents':
      return { eyebrow: 'Drill · Lifecycle', title: 'Expiring within 30 days' };
```

- [ ] **Step 11: Verify the build**

Run: `npx next build`
Expected: clean compile (assuming Task 12's changes are also in place). The `case 'awaiting-expiring-documents':` matches the literal added to `LifecycleDrillTarget`, the row shape gains the new optional fields, and switch exhaustiveness is preserved.

- [ ] **Step 12: Commit**

```bash
git add lib/sis/drill.ts
git commit -m "feat(sis): wire awaiting-expiring-documents drill target

Mirrors the existing 3 doc-chase drill targets — same union/array
extensions, same row shape pattern, new switch case scanning for
'Valid' slots with expiry within today + 30 days, new column-key
entries for expiringSlots[] and daysLeft.

Drill UI is rendered by the existing <LifecycleDrillSheet> toolkit
(KD #56) — only the title, eyebrow, and slot-chip / days-left columns
differ. The chase strip's 4th tile (Task 12) is the entry point.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Add column renderers + CSV cell

**Goal:** The lifecycle drill sheet renders the new `expiringSlots` and `daysLeft` columns. The drill API route's CSV exporter handles them in its `csvCell` switch.

**Files:**
- Modify: `components/sis/drills/lifecycle-drill-sheet.tsx`
- Modify: `app/api/sis/drill/[target]/route.ts`

- [ ] **Step 1: Add column-renderer cases in the drill sheet**

In `components/sis/drills/lifecycle-drill-sheet.tsx`, find the column-build switch — search for `case 'promisedSlots':`. Directly after the `promisedSlots` case, insert two new cases:

```tsx
    case 'expiringSlots':
      return {
        id: 'expiringSlots',
        accessorKey: 'expiringSlots',
        header,
        cell: ({ row }) => (
          <SlotChips slots={row.original.expiringSlots} color="stale" />
        ),
      };
    case 'daysLeft':
      return {
        id: 'daysLeft',
        accessorKey: 'daysLeft',
        header,
        cell: ({ row }) => {
          const v = row.original.daysLeft;
          if (v === null || v === undefined) {
            return <span className="text-ink-4">—</span>;
          }
          return (
            <span className="font-mono tabular-nums text-[12px]">{v}d</span>
          );
        },
      };
```

`color="stale"` matches the amber gradient used by `expiredSlots` — semantically right since "expiring soon" is a warning state. `<SlotChips>` already accepts `string[] | undefined`.

- [ ] **Step 2: Add CSV cell cases in the API route**

In `app/api/sis/drill/[target]/route.ts`, find the `csvCell` switch. There are existing cases for `'promisedSlots'`, `'rejectedSlots'`, `'expiredSlots'`, `'uploadedSlots'` (each returning the joined slot labels). Add two new cases:

```ts
    case 'expiringSlots':
      return (row.expiringSlots ?? []).join('; ');
    case 'daysLeft':
      return row.daysLeft ?? '';
```

These keep CSV exhaustiveness (the switch return type doesn't allow `undefined`) and produce sensible column values.

- [ ] **Step 3: Verify the build**

Run: `npx next build`
Expected: clean compile.

- [ ] **Step 4: Manual reproduction**

Start the dev server: `npm run dev`. Switch into the AY9999 test environment if not already. Connect to Supabase studio (or via SQL) to ensure at least one seeded student has `passportStatus = 'Valid'` and `passportExpiry = today + 14 days` (use the actual seeder default if it already provides such rows). Then:

1. Open `http://localhost:3000/admissions?ay=AY9999` (or whichever AY URL form the project uses).
2. The chase strip should now show 4 tiles. The "Expiring soon" tile shows the count of students with at least one slot expiring in the next 30 days.
3. Click the "Expiring soon" tile. The drill sheet opens with title "Expiring within 30 days". The row table includes columns "Expiring slots" (chip list) and "Days left" (e.g. `14d`). CSV export captures both.
4. Click the "Awaiting revalidation" tile to confirm the existing 3 drills still work unchanged.

If the manual reproduction passes, proceed to commit.

- [ ] **Step 5: Commit**

```bash
git add components/sis/drills/lifecycle-drill-sheet.tsx 'app/api/sis/drill/[target]/route.ts'
git commit -m "feat(sis): render expiringSlots + daysLeft in drill sheet & CSV

Lifecycle drill sheet gets two new column renderers:
- expiringSlots: <SlotChips color='stale' /> (amber)
- daysLeft: mono tabular '<n>d' or em-dash for null

API route's csvCell switch gains the matching cases so CSV exports
serialize both fields. Closes the loop on Task 13's drill plumbing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Final verification + plan close-out

**Goal:** End-to-end happy-path on AY9999. Confirm reactive auto-flip and proactive expiring-soon drill agree across surfaces.

- [ ] **Step 1: Clean build**

Run: `npx next build`
Expected: zero TS errors.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: zero new errors. Pre-existing warnings on unrelated files OK.

- [ ] **Step 3: Manual end-to-end on AY9999**

In the seeded test environment (KD #52 — `/sis/admin/settings`):

**Auto-flip verification (sections 1-9 of spec):**

1. Connect to Supabase studio (or SQL CLI). For one seeded student, set `passportStatus = 'Valid'`, `passportExpiry = '2024-01-01'` (clearly past).
2. Open `/admissions?ay=AY9999`. The freshen helper should run on cache miss. Confirm:
   - The "Awaiting revalidation" chip on the chase strip increments by 1.
   - Click into the revalidation drill — that student appears with their passport flagged as Expired in `expiredSlots`.
   - The audit log surface (`/sis/admin/...` audit page or direct `audit_log` query) shows one new `sis.documents.auto-expire` entry with the student's enroleeNumber in `context.enroleeNumbers`.
3. Refresh the page within 60s. Cache hit — freshen does NOT re-run (no new audit entry). Chip count unchanged.
4. Wait >60s and refresh. Cache miss — freshen runs. SQL is a 0-row no-op (status already Expired); no new audit entry. Chip count unchanged.
5. Navigate directly to `/admissions/applications/<that-enrolee>` (without dashboard). The applicant detail page calls freshen for the same AY (cache hit). The Documents stage detail shows the passport as Expired.

**Expiring-soon verification (section 10 of spec):**

6. For a SECOND seeded student, set `passportStatus = 'Valid'`, `passportExpiry = today + 14 days` (well within the 30-day window).
7. Refresh `/admissions?ay=AY9999`. The chase strip's 4th tile "Expiring soon" should show count ≥ 1. Click into it — drill opens with title "Expiring within 30 days". The student's row shows `expiringSlots: [Passport (Student)]` and `daysLeft: 14`.
8. CSV export from the drill works; the CSV includes "Expiring slots" and "Days left" columns.
9. Bump the second student's `passportExpiry` to `today + 60 days` (past threshold). Refresh — count drops by 1, drill no longer lists this student.
10. Bump it to `today - 1 day` (already expired). Refresh — auto-flip catches it (status flips to Expired). Student now appears in "Awaiting revalidation" (NOT "Expiring soon"). Confirms the two signals are mutually exclusive in steady state.
11. Confirm the existing 3 doc-chase drills (revalidation / validation / promised) all still open from their tiles.

- [ ] **Step 4: If anything fails — diagnose, fix, re-commit**

For build / lint failures, fix inline. For UX bugs, repro on AY9999 and trace through `freshen-document-statuses.ts`, `process.ts::scanDocStatusForActionFlags`, `document-chase-queue.ts`, or `drill.ts` accordingly.

- [ ] **Step 5: Sync docs**

Run the project's `/sync-docs` skill (per `.claude/rules/workflow.md` step 4) to update the `CLAUDE.md` session-context bullet + `docs/sprints/development-plan.md` row entry for this work. Commit those edits separately.

---

## Out of scope (deferred)

- **Backfill migration.** Pre-existing `'Valid' + past-expiry` rows get caught naturally on first dashboard view per AY after deploy. No one-off SQL needed.
- **Composite index on `(<slot>Status, <slot>Expiry)`.** May become a perf optimization if AY tables grow; not needed for HFSE's current scale (~500 students per AY).
- **DB-level triggers or scheduled flips.** Read-time / page-entry approach was chosen specifically to avoid these (see spec § Non-goals).
- **Lifecycle aggregate widget bucket for "Awaiting expiring documents".** The chase strip is the canonical entry point per the spec; lifecycle widget remains 9 buckets unchanged.
