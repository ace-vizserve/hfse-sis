import 'server-only';

import { cache } from 'react';

import {
  loadEffectiveAssignmentsForUser,
  type EffectiveAssignmentRow,
} from '@/lib/auth/teacher-assignments';
import { createServiceClient } from '@/lib/supabase/service';

// One assignment read per request, shared by everything that asks.
//
// A single navigation asks "what does this user teach?" between two and four
// times — the root layout's palette mount, the module layout's
// `resolveHiddenModules`, `classroom/[sectionId]/layout.tsx` and
// `classroom/[sectionId]/page.tsx` — and each one issued its own identical
// `teacher_assignments` select. They are all in the same request, all asking
// the same question about the same user, so all but the first are waste.
//
// ⚠ WHY THIS IS A NEW WRAPPER AND NOT `cache()` WRAPPED ROUND THE LOADER.
// `loadEffectiveAssignmentsForUser` takes `(supabase, userId)`, and React's
// `cache()` keys on ARGUMENT IDENTITY. `createServiceClient()`
// (lib/supabase/service.ts) builds a brand-new client object every call, so a
// memo keyed on that pair would miss on every single call and dedupe nothing
// while looking like it worked. Keying on the userId STRING is the whole point
// of this file; the client is built inside, where its identity cannot leak
// into the cache key.
//
// ⚠ REACT `cache()`, NEVER `unstable_cache`. The loader calls `sgToday()` to
// decide whether a relief cover is live today, so its answer is only correct
// for the request that asked. `unstable_cache` persists across requests and
// would freeze a substitute's cover window — granting a class after the cover
// ended, or withholding one after it began. Request-scoped is the only safe
// scope for this value.
//
// This is the EFFECTIVE, relief-inclusive loader — "what may you act on",
// cover included. `__tests__/auth/assignment-read-classification.test.ts`
// classifies it as `act` for that reason. Anything that prints a teacher's
// NAME must keep calling the plain `loadAssignmentsForUser` instead; see the
// header of lib/auth/teacher-assignments.ts for why the two questions differ.
//
// ⚠ NO TEST CAN OBSERVE THE DEDUPE, and that is a property of React, not a gap
// in the tests. `cache()` memoizes per REQUEST, keyed off the request context
// Next.js installs; called outside one it simply passes through. Measured
// 2026-09-02: three calls to a `cache()`d function under vitest ran the body
// three times. So the saving is real only in the server runtime, and the way to
// see it is `QUERY_TRACE=1 npm run dev` (lib/supabase/service.ts) — count the
// `teacher_assignments` lines on one navigation. It also means this change
// cannot move any measured query budget in `__tests__/perf/query-budget.test.ts`.
//
// ⚠ A REJECTION IS MEMOIZED TOO, and that changes something worth stating.
// React `cache()` stores the PROMISE, so if the read fails, every consumer in
// that request gets the same rejection replayed rather than each one failing
// (or not failing) on its own attempt. Before this file, four call sites meant
// four independent chances; now one bad read is the whole request's answer.
// That is a narrowing of independence, not a bug: both consumers already had
// deliberate, opposite failure policies — resolve-hidden-modules hides nothing,
// view-context offers no extra lens — and each still does exactly the right
// thing when handed a rejection. What it rules out is the accidental
// half-behaviour where a retry happened to succeed and two surfaces in one page
// disagreed about what the viewer teaches.
//
// Errors are NOT swallowed here. Each caller already has its own failure
// policy — resolve-hidden-modules fails open on purpose, view-context fails
// closed on purpose — and a wrapper that returned `[]` on error would quietly
// overrule both.
export const loadEffectiveAssignmentsForUserMemo = cache(
  async (userId: string): Promise<EffectiveAssignmentRow[]> =>
    loadEffectiveAssignmentsForUser(createServiceClient(), userId)
);
