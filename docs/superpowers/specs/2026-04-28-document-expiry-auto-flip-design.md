# Document expiry auto-flip — design spec

**Date:** 2026-04-28
**Branch:** `feat/swap-sonner-sileo`
**Author:** brainstorming session, Amier
**Related KDs:** KD #60 (document status workflow), KD #46 (cache wrapper pattern)
**Predecessor spec:** `2026-04-28-to-follow-document-flag-design.md` (same branch, deferred this work)

## Problem

KD #60 documents the expiring-document contract:

> Expiring (passport, pass, motherPassport, motherPass, fatherPassport, fatherPass, guardianPassport, guardianPass): `null → 'Valid' → 'Expired'` (auto-flip when expiry passes)…

The "auto-flip when expiry passes" half is **unimplemented**. Today, an expiring slot only ends up in the `'Expired'` state if (a) the seeder writes it that way for test data, or (b) someone manually edits the row. A passport whose `passportExpiry` date has passed but whose `passportStatus` was never touched stays `'Valid'` forever.

Consequence: the lifecycle aggregate widget, chase-queue strip, drill rows, per-applicant timeline, and student detail pages all miss these "silently expired" rows. They show the registrar's revalidation queue at lower-than-true count. The pass-expiry cohort view is the only surface that derives correctness from the date column directly — every other surface trusts the status column.

## Goal

Make the `<slot>Status` column flip from `'Valid'` to `'Expired'` automatically whenever `<slot>Expiry < today` (Singapore time), so every surface that reads the column directly sees truth.

The trigger is **page-entry**, not scheduled: each page that displays document status calls a freshen helper at the top of its render. The helper executes the flip SQL synchronously before any data fetches read the column. The next dashboard view after expiry sees the column already flipped.

## Non-goals

- **No nightly scheduler.** Vercel Cron, pg_cron, npm-cron all evaluated and ruled out. Reasons: observability (cron failures are silent unless someone checks the Vercel dashboard), serverless mismatch with npm-cron, and the user's preference for in-codebase logic over scheduled infra.
- ~~No "expiring soon" proactive signal.~~ **(Now in scope — see § 10.)** A 30-day proactive "expiring soon" drill is included alongside the reactive flip in this spec.
- **No backfill migration.** The first time a page calls `freshenAyDocuments` after this ships, any pre-existing `'Valid' + past-expiry` rows in that AY get caught and flipped naturally. No one-off SQL needed.
- **No DB-level triggers.** Postgres triggers fire on row INSERT/UPDATE, not on time passing — they don't solve this problem.
- **No re-validation flow change.** When a parent uploads a new passport with a future expiry, the existing PATCH route flips the status back to `'Valid'`. That path is untouched.

## Decisions that bend an existing convention

- **Adds a write to page render paths.** Pages today are read-only; this introduces an `UPDATE` statement at the top of 7 page RSCs. Justified because the alternative (cron) was rejected for observability, and lazy-write inside individual loaders sprawls to 5+ files with the same logic. Centralizing in one helper called by each page is the cleanest middle ground.

## Design

### 1. The freshen helper

New file: `lib/sis/freshen-document-statuses.ts`

```ts
import 'server-only';

import { unstable_cache } from 'next/cache';

import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';
import { logAction } from '@/lib/audit/log-action';
import { DOCUMENT_SLOTS } from '@/lib/sis/queries';

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
    // Run the 8 per-slot UPDATEs in parallel. Single Supabase roundtrip
    // latency dominates (~15ms total) instead of 8x sequential roundtrips
    // (~80ms). Each UPDATE is independent and idempotent — no transactional
    // dependency between them, so parallelism is safe.
    const slotResults = await Promise.all(
      EXPIRING_SLOTS.map(async (slot) => {
        const { data, error } = await admissions
          .from(`${prefix}_enrolment_documents`)
          .update({ [slot.statusCol!]: 'Expired' })
          .eq(slot.statusCol!, 'Valid')
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

  // Audit only when at least one row was actually flipped — most calls in
  // steady state are 0-row no-ops and should add zero audit noise.
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

// Public entry point — wraps the uncached body in `unstable_cache` with a
// 60-second TTL keyed on the AY code. Per-page-render cost is ~0ms on cache
// hit; cache miss runs the parallel UPDATE chain (~15ms). The bounded
// 60-second staleness is functionally invisible for calendar-date expiry
// (passports/passes flip at midnight; nobody perceives a 60-second lag the
// next morning). Tag `sis:${ayCode}` is invalidated by every existing PATCH
// route that already touches this AY's documents (e.g., manual status edits
// in /admissions/applications/[enroleeNumber]) so a fresh edit doesn't see
// a stale freshen result.
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

Properties:
- **Wrapped in `unstable_cache`** (KD #46 cache-wrapper pattern: hoist the `loadX_Uncached` body, compose `unstable_cache` per call).
- **60-second TTL.** First page render in any 60s window per AY runs the freshen; subsequent renders within that window cost ~0ms (cache hit). Steady-state DB load is bounded to one freshen-per-minute-per-AY at most.
- **Tag-invalidated by `sis:${ayCode}`.** Every existing PATCH route that touches an AY's documents (e.g., `/api/sis/students/[enroleeNumber]/documents` manual edits, the residence-history editor, etc.) already calls `revalidateTag('sis:${ayCode}')` — so an edit naturally invalidates the freshen cache, the next page render runs a fresh freshen.
- **Parallel UPDATEs via `Promise.all`.** 8 slot updates run concurrently; total wall-clock time = single Supabase roundtrip (~15ms), not 8 × 10ms sequential. Each UPDATE is independent and idempotent — concurrent execution is safe.
- **Admissions service-role client** for the documents table (matches `lib/sis/queries.ts` pattern, KD #1, KD #22).
- **Audit-log service client** is the standard service-role client used by every other `logAction` call site.
- **Per-slot error swallow** — if one slot's UPDATE fails (e.g., RLS, network), the others still complete. The page still renders.
- **Top-level `try`/`catch`** — never break the page render. Errors logged via `console.warn` (not `console.error`, to avoid Next 16's dev-overlay full-crash modal).
- **Audit only on flips.** Per-call when `flippedCount > 0`, one batched audit row in `context` listing the affected enrolees (capped at 50, with a `truncated` count if the cap was hit).

### 1a. Required extensions to `lib/audit/log-action.ts`

Two small changes alongside the new helper:

**(a) Add the new action to the `AuditAction` enum:**

```ts
export type AuditAction =
  | ...
  | 'sis.documents.auto-expire';   // NEW — system-triggered Valid → Expired flip
```

**(b) Allow a null actor for system actions.**

The `audit_log` schema (migration 006) already permits `actor_id` to be null with the inline comment *"null for system actions"*. The `logAction` TypeScript signature is currently `actor: { id: string; email: string | null }`, which forbids null. Widen it:

```ts
type LogActionParams = {
  service: SupabaseClient;
  actor: { id: string | null; email: string | null };  // CHANGED — id may be null for system actions
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | null;
  context?: Record<string, unknown>;
};
```

Inside the function, `actor.id` flows directly to the insert — Postgres accepts null for the nullable column. Existing call sites (which pass a real user's `id`) are unaffected. The change is purely additive widening.

The `actor_email` column is `not null`, so `'(system:freshen)'` is the chosen sentinel (parens to make it visually distinct from real email addresses in the audit-log UI).

### 2. Page entry points

Seven pages call `await freshenAyDocuments(selectedAy)` at the top of their RSC, before the existing `Promise.all([...])` data fetches:

| # | Page | RSC file | Why it needs freshen |
|---|------|----------|----------------------|
| 1 | `/admissions` | `app/(admissions)/admissions/page.tsx` | Chase strip + lifecycle widget |
| 2 | `/records` | `app/(records)/records/page.tsx` | Chase strip + lifecycle widget |
| 3 | `/p-files` | `app/(p-files)/p-files/page.tsx` | Chase strip + PriorityPanel |
| 4 | `/admissions/applications/[enroleeNumber]` | `app/(admissions)/admissions/applications/[enroleeNumber]/page.tsx` | Per-applicant timeline + docs tab |
| 5 | `/records/students/[studentNumber]` | `app/(records)/records/students/[studentNumber]/page.tsx` | Records detail by studentNumber |
| 6 | `/records/students/by-enrolee/[enroleeNumber]` | `app/(records)/records/students/by-enrolee/[enroleeNumber]/page.tsx` | Records detail by enroleeNumber |
| 7 | `/p-files/[enroleeNumber]` | `app/(p-files)/p-files/[enroleeNumber]/page.tsx` | P-File student detail |

Each page edit is one line:

```ts
const selectedAy = ...;  // existing AY resolution
await freshenAyDocuments(selectedAy);  // <-- new line
const [ ... ] = await Promise.all([ ... ]);  // existing data fetches
```

Cohort views (`/admissions/cohorts/{stp,medical,pass-expiry}`, `/records/cohorts/*`) **do not** call freshen. They derive expired status from the `<slot>Expiry` date column directly via `lib/sis/cohorts.ts`, so they're correct without needing the column flipped.

### 3. Scope: which AYs get freshened?

Each page call freshens **exactly the AY the page is displaying**, scoped via the `selectedAy` URL param. Implications:

- Current AY: freshened on every visit to any of the 7 pages.
- Historical AY: freshened only when someone explicitly navigates to it (via the AY switcher).
- Future AY (e.g., AY9999 test environment, or the next AY being seeded pre-rollover): freshened when visited.

This matches the user's "all AYs" intent in practice — every AY that anyone opens gets freshened. Historical AYs that nobody opens stay untouched, which is acceptable since stale data on an unviewed surface affects no one.

### 4. SQL semantics

Per slot, per AY, per call:

```sql
UPDATE ay{YY}_enrolment_documents
SET <slotStatus> = 'Expired'
WHERE <slotStatus> = 'Valid'
  AND <slotExpiry> IS NOT NULL
  AND <slotExpiry> < CURRENT_DATE
RETURNING enroleeNumber, <slotExpiry>;
```

(In the Supabase JS client, the equivalent chain uses `.update().eq().lt().not(...is null).select(...)`.)

**Idempotent.** Re-running on already-flipped rows is a no-op — they no longer match `<slotStatus> = 'Valid'`. Safe under concurrent calls (e.g., two registrars opening the same dashboard within seconds): the second UPDATE just affects 0 rows.

**Index expectations.** The query benefits from a composite index on `(<slotStatus>, <slotExpiry>)`. None exists today; first calls might do a sequential scan over an AY's documents table. At HFSE scale (~500 students per AY × 8 expiring slots = ~4,000 rows max per AY), seq scans are still <50ms. If this becomes a bottleneck, add the indexes in a follow-up migration; not required for ship.

### 5. Audit log shape

One batched row per flip event (per call when `flippedCount > 0`), not per row:

```
audit_log
  action:       'sis.documents.auto-expire'
  actor_id:     'system:freshen'    (no real user)
  target:       `${ayCode}:auto-expire-${YYYY-MM-DD}`
  metadata:     {
    ayCode:        'AY2026',
    flippedCount:  4,
    flippedBySlot: { passport: 3, motherPassport: 1 },
    enroleeNumbers: ['HFSE-2026-001', 'HFSE-2026-014', ...],
    truncated:     0   // count of additional enrolees beyond the 50-cap, 0 in normal cases
  }
  created_at:   <now>
```

This avoids the audit-table explosion of "one row per flip × N flips × M AYs" without losing trace data — anyone investigating a specific student's status flip can join via `metadata.enroleeNumbers`.

### 6. Error handling

- **Per-slot failure** → log warning, skip that slot, continue with the rest. Other slots in the same AY still get processed.
- **Top-level failure** (unexpected error, e.g., service-role client init) → log warning, return zero result, page render proceeds. The page shows whatever the column currently says — possibly stale, but never broken.
- **Audit log failure** → log warning, return result. The flip itself succeeded; the audit is best-effort (matches KD #16's "Email via Resend is best-effort" precedent for non-critical side effects).

### 7. Verification

Manual happy-path on AY9999 (test mode, KD #52):

1. Connect to Supabase studio (or run a SQL update locally) to set a seeded student's `passportStatus = 'Valid'`, `passportExpiry = '2024-01-01'` (clearly in the past).
2. Open `/admissions?ay=AY9999`. The freshen helper runs (cache miss on first call). Confirm:
   - The "Awaiting revalidation" chip on the chase strip increments.
   - Click into the drill — the student appears with their passport flagged as Expired.
   - The audit log surface shows one new `sis.documents.auto-expire` entry with the student's enroleeNumber in `context.enroleeNumbers`.
3. Refresh the page within 60s. Cache hit — freshen does NOT re-run (visible by the absence of a new audit entry). Chip count remains correct (column was already flipped). This is the intended behavior: the cache holds for 60s after a flip; refreshes within that window read the already-correct column.
4. Wait >60s and refresh. Cache miss — freshen runs again, but the SQL is a 0-row no-op (status is already `Expired`), so no new audit entry. Chip count unchanged.
5. Set up a second pre-existing stale student via SQL, then navigate directly to `/admissions/applications/<that-second-enrolee>` (without opening any dashboard first). The applicant detail page runs freshen for AY9999 — confirms the direct-link case is covered.
6. Manually edit the second student's `passportStatus` back to `'Valid'` and `passportExpiry` to a future date via the existing PATCH route. The PATCH calls `revalidateTag('sis:AY9999')` (existing behavior), invalidating the freshen cache. Next page load runs freshen — SQL is a 0-row no-op (the row no longer matches the WHERE clause), no audit entry, the chip stays correct.
7. `npx next build` clean.

### 8. Files touched

**Reactive auto-flip (sections 1-7):**
- **Create:** `lib/sis/freshen-document-statuses.ts`
- **Modify:** `lib/audit/log-action.ts` — add `'sis.documents.auto-expire'` to the `AuditAction` enum and widen `actor.id` to `string | null`.
- **Modify:** 7 page RSCs (one-line `await freshenAyDocuments(selectedAy)` each).

**Proactive expiring-soon drill (section 10):**
- **Modify:** `lib/sis/process.ts` — extend `scanDocStatusForActionFlags` to optionally compute `hasExpiringSoon` (looks for `slot.expiryCol` on the row, computes days-until-expiry, returns true when 0 ≤ daysLeft ≤ 30).
- **Modify:** `lib/sis/document-chase-queue.ts` — extend `DocumentChaseQueueCounts` with `expiringSoon: number`; widen the SELECT to include the 8 expiring slots' `*Expiry` columns.
- **Modify:** `components/sis/document-chase-queue-strip.tsx` — add a 4th tile `'awaiting-expiring-documents'` in the `TILES` array; severity `warn`; lucide icon `CalendarClock` (or similar). The chip rendering already uses `valueByTarget` keyed on the drill target — extend that map.
- **Modify:** `lib/sis/drill.ts` — extend `LifecycleDrillTarget` union with `'awaiting-expiring-documents'`; extend `LIFECYCLE_DRILL_TARGETS` array; extend `LifecycleDrillRow` with `expiringSlots?: string[]` and `daysLeft?: number | null`; add a new switch case to `buildLifecycleDrillRows`; extend `LifecycleDrillColumnKey` with `'expiringSlots'` and `'daysLeft'`; extend the labels record; add to `defaultColumnsForLifecycleTarget` and `lifecycleDrillHeaderForTarget`.
- **Modify:** `components/sis/drills/lifecycle-drill-sheet.tsx` — add column rendering cases for `'expiringSlots'` (uses `<SlotChips color="stale" />`) and `'daysLeft'` (small mono-tabular cell with the number + "d").
- **Modify:** `app/api/sis/drill/[target]/route.ts` — add CSV-cell case for `'expiringSlots'` and `'daysLeft'` (TypeScript exhaustiveness).

No DB migration. No new dependency. No new env var. No new API route.

### 9. KD update

KD #60 today reads:

> Expiring (passport, pass, ...): `null → 'Valid' → 'Expired'` (auto-flip when expiry passes); the expiry date IS the validation evidence, no `'Uploaded'` intermediate.

The auto-flip half is now implemented. KD #60 stays as-is — the contract is what it always was; the implementation now matches.

A new entry in `.claude/rules/key-decisions.md` is **not** required for this work — it's filling in a contract KD #60 already documented. The new file `lib/sis/freshen-document-statuses.ts` should reference KD #60 in its header comment so the next dev knows where the contract is documented.

### 10. Expiring-soon proactive drill

**Detection:** read-time only, no DB writes. A slot is "expiring soon" when `<slot>Status === 'Valid'` AND `<slot>Expiry > today` AND `<slot>Expiry <= today + 30 days`.

When the date passes, the reactive auto-flip from § 1 catches it and the row leaves "expiring soon" naturally — the column flips to `'Expired'` and the row joins the existing "Awaiting revalidation" queue. So the two signals are complementary, not overlapping.

**Threshold:** 30 days. Constant exported from `lib/sis/document-chase-queue.ts` so a future change is one place:

```ts
export const EXPIRING_SOON_THRESHOLD_DAYS = 30;
```

**Helper extension (in `lib/sis/process.ts`):**

```ts
export type DocStatusActionFlags = {
  hasRevalidation: boolean;
  hasValidation: boolean;
  hasPromised: boolean;
  hasExpiringSoon: boolean;   // NEW
};

export function scanDocStatusForActionFlags(
  docs: Record<string, string | null> | undefined,
  options?: { todayMs?: number; expiringSoonThresholdDays?: number },
): DocStatusActionFlags {
  // existing logic for revalidation/validation/promised flags …

  // NEW: walk slots that have an expiryCol; if status is 'Valid' and
  // expiry parses to a date in [todayMs, todayMs + thresholdDays * 86_400_000],
  // set hasExpiringSoon and break.
}
```

The existing call sites (`loadLifecycleAggregateUncached`, `getDocumentChaseQueueCounts`) need to pass the expiry columns in their `docs` row argument for the new flag to evaluate. The lifecycle aggregate doesn't add a new bucket, but extending its SELECT to include expiry columns is cheap and keeps the helper's contract uniform across call sites.

**Chase queue counts (in `lib/sis/document-chase-queue.ts`):**

```ts
export type DocumentChaseQueueCounts = {
  promised: number;
  validation: number;
  revalidation: number;
  expiringSoon: number;   // NEW — count of students with >=1 slot expiring within 30 days
};

// In loadChaseQueueUncached:
const docColumns = [
  'enroleeNumber',
  ...DOCUMENT_SLOTS.map((s) => s.statusCol),
  ...DOCUMENT_SLOTS.filter((s) => s.expiryCol).map((s) => s.expiryCol!),
];

// Counter increments alongside the existing 3:
if (flags.hasExpiringSoon) expiringSoon += 1;
```

**Chase queue strip (in `components/sis/document-chase-queue-strip.tsx`):**

Add a 4th tile to the `TILES` array, after the existing 3:

```ts
{
  target: 'awaiting-expiring-documents',
  label: 'Expiring soon',
  description: 'Valid now, expiry within 30 days — chase parent for renewal',
  icon: CalendarClock,    // from lucide-react
  severity: 'warn',
},
```

`valueByTarget` map in the same file gains the new key:
```ts
'awaiting-expiring-documents': counts.expiringSoon,
```

**Drill plumbing (in `lib/sis/drill.ts`):**

Mirror the pattern of the 3 existing doc-chase drill targets:

1. Extend `LifecycleDrillTarget` union: add `'awaiting-expiring-documents'`.
2. Extend `LIFECYCLE_DRILL_TARGETS` array similarly.
3. Extend `LifecycleDrillRow`:
   ```ts
   expiringSlots?: string[];     // labels of slots expiring within threshold
   daysLeft?: number | null;     // soonest expiring slot's days-until-expiry
   ```
4. New switch case in `buildLifecycleDrillRows`:
   ```ts
   case 'awaiting-expiring-documents': {
     if (!docs) break;
     const expiringSlots: string[] = [];
     let soonestDays: number | null = null;
     const now = Date.now();
     for (const slot of DOCUMENT_SLOTS) {
       if (!slot.expiryCol) continue;
       const status = (docs[slot.statusCol] ?? '').toString().trim();
       if (status !== 'Valid') continue;
       const raw = docs[slot.expiryCol];
       if (!raw) continue;
       const ms = Date.parse(raw.toString());
       if (Number.isNaN(ms)) continue;
       const days = Math.floor((ms - now) / 86_400_000);
       if (days >= 0 && days <= EXPIRING_SOON_THRESHOLD_DAYS) {
         expiringSlots.push(slot.label);
         if (soonestDays === null || days < soonestDays) soonestDays = days;
       }
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
5. Extend `LifecycleDrillColumnKey` with `'expiringSlots'` and `'daysLeft'`.
6. Extend `ALL_LIFECYCLE_DRILL_COLUMNS` and `LIFECYCLE_DRILL_COLUMN_LABELS`.
7. Add to `defaultColumnsForLifecycleTarget`:
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
8. Add to `lifecycleDrillHeaderForTarget`:
   ```ts
   case 'awaiting-expiring-documents':
     return { eyebrow: 'Drill · Lifecycle', title: 'Expiring within 30 days' };
   ```

**Drill sheet column renderers (in `components/sis/drills/lifecycle-drill-sheet.tsx`):**

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
      if (v === null || v === undefined) return <span className="text-ink-4">—</span>;
      return (
        <span className="font-mono tabular-nums text-[12px]">{v}d</span>
      );
    },
  };
```

**API route CSV (in `app/api/sis/drill/[target]/route.ts`):**

Add CSV-cell cases for `'expiringSlots'` (joins `';'` like the other slot fields) and `'daysLeft'` (returns the number or empty string).

**Requirements:**
- Drill works on the seeded AY9999 test environment — the seeder's `passportExpiry` rows include a few within-30-days dates already (per `lib/sis/seeder/populated.ts` — it generates a spread of expiry dates including some near-future ones for realistic chase data).
- Reactive auto-flip and proactive expiring-soon are visually distinct: the chase strip's 4 tiles read left-to-right as the doc lifecycle (revalidation = bad, validation = warn, promised = warn, expiring-soon = warn).
- The drill UI is identical to the 3 existing doc-chase drills (same `<LifecycleDrillSheet>` toolkit per KD #56) — only the title, columns, and chip color differ.

### 11. Verification (extending § 7)

In addition to the auto-flip checks in § 7:

8. Set up a seeded student in AY9999 with `passportStatus = 'Valid'` and `passportExpiry = today + 14 days`. Open `/admissions?ay=AY9999`. The chase strip's 4th tile "Expiring soon" shows count ≥ 1. Click into it — the drill opens with title "Expiring within 30 days", the student's row shows `expiringSlots: [Passport (Student)]` and `daysLeft: 14`. CSV export captures both columns.
9. Bump that student's `passportExpiry` to `today + 60 days` (past the threshold). Re-open the page — the count drops by 1, the drill no longer lists this student.
10. Bump it back to `today - 1 day` (already expired). Re-open the page — the auto-flip fires (column → `'Expired'`); the student now appears in "Awaiting revalidation" instead of "Expiring soon". The two signals are mutually exclusive in steady state.

## Open questions

None at design time.
