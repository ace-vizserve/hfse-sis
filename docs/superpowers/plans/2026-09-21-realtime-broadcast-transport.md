# Realtime Badge Transport (Postgres Changes → Broadcast) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Supabase Realtime **Postgres Changes** with **Broadcast from
the database** for all four badge subscriptions, with no change to anything a
user sees.

**Architecture:** A trigger on each of four tables calls `realtime.send()` with
an empty payload on a fixed topic. Browser hooks swap `.on('postgres_changes',
…)` for `.on('broadcast', { event: 'badge' })` on a private channel. Every
handler body is unchanged, because none of them has ever read the payload —
they re-count against the server, and RLS on that re-count is what produces the
number.

**Tech Stack:** Supabase Realtime (Broadcast), Postgres triggers + RLS,
`@supabase/ssr` browser client, Next.js 16 App Router, React, Vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-09-21-realtime-broadcast-transport-design.md`

## Global Constraints

- **Migration number is 171.** Latest applied is 170. One migration file:
  `supabase/migrations/171_realtime_broadcast_badges.sql`.
- **The migration is additive only.** It must NOT remove anything from the
  `supabase_realtime` publication. Both transports stay live so that reverting
  the client commit is a complete rollback. Publication cleanup is Task 8 and
  is gated on Task 7.
- **Every trigger swallows its own exceptions.** A failed broadcast must never
  roll back the write beneath it. `audit_log` takes a row on every grade entry;
  grade entries and audit rows are append-only by Hard Rule #6.
- **`applyChangeRequestCountScope` in `lib/sidebar/use-change-request-count.ts`
  must NOT be touched.** Only the channel `filter` string is deleted. See
  Task 4.
- **No hardcoded colours or `title=` attributes** are introduced anywhere
  (hard-rules #7; KD #221). This plan touches no JSX, so this is a guard, not
  a task.
- **Run tests with `--pool=threads`.** The forks pool times out in this repo.
- **Commit with `git add <pathspec> && git commit` as ONE command.** Parallel
  agents share one git index.
- Topic names, verbatim: `sis:grade-change-requests`, `sis:approval-stages`,
  `sis:approval-decisions:<user_id>`, `sis:pfile-verification`. Event name on
  every topic: `badge`.

---

## Known risk, to be settled in Task 4

⚠ **Two channels in one browser client may not be able to share a topic
name.** Today each hook builds a per-instance channel name
(`…-${instanceId}`, via `useId`) precisely so the sidebar badge and the header
bell can each subscribe without a shared provider. A Broadcast topic is the
channel name, so both would now ask for `sis:approval-stages`, and
`realtime-js` keys channels by topic.

Task 4 proves this one way or the other with a real assertion before the
pattern is copied into two more hooks. **If they collide**, the answer is
already designed: a module-level bus owning one channel per topic that fans out
to N subscribers, in `lib/sidebar/badge-bus.ts`. Task 4 carries the full
implementation for that branch. Do not invent a third option.

---

## File Structure

| File                                                        | Responsibility                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| `supabase/migrations/171_realtime_broadcast_badges.sql`     | Two trigger functions, four triggers, one `realtime.messages` SELECT policy |
| `scripts/probe-realtime-publication.ts`                     | Prints the SQL that answers spec §3.1; read-only                            |
| `scripts/verify-broadcast-badge-migration.ts`               | Prints the SQL that proves 171 landed; read-only                            |
| `lib/sidebar/badge-bus.ts`                                  | **Conditional** — only if Task 4 proves a topic collision                   |
| `lib/sidebar/use-change-request-count.ts`                   | Channel swap; filter string deleted; scope function untouched               |
| `lib/sidebar/use-staged-approval-count.ts`                  | Channel swap ×3; two stale comments corrected                               |
| `lib/sidebar/use-realtime-badges.ts`                        | Channel swap; `action=in.()` filter moves to the trigger                    |
| `__tests__/sidebar/change-request-count-broadcast.test.tsx` | New — topic + recount behaviour                                             |
| `__tests__/sidebar/staged-count-skips-own-filings.test.tsx` | Existing — mock + assertion updated                                         |
| `__tests__/data/broadcast-trigger-guards.test.ts`           | New — source-reading guard over migration 171                               |

⚠ **`__tests__/ui/notification-bell.test.tsx` needs NO change.** The spec's
§6 and §8 say its mock swaps; that is wrong and this plan supersedes it. That
file mocks the three count _hooks_, not the Supabase client, so it never sees a
channel. Leave it alone.

⚠ **`lib/sidebar/use-declaration-count.ts` needs NO change.** It pins a flow
list onto the staged hook and opens no channel of its own.

---

## Task 1: Settle whether `audit_log` is in the publication

Blocking, and it needs Mr Ace — `pg_catalog` is not readable through PostgREST,
the same wall migration 140's verification hit.

**Files:**

- Create: `scripts/probe-realtime-publication.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: a recorded answer in the spec's §3.1. Task 8 reads it.

- [ ] **Step 1: Write the probe script**

```ts
// Read-only. Prints the SQL that answers spec §3.1 — is `audit_log` in the
// `supabase_realtime` publication? `pg_publication_tables` lives in
// pg_catalog, which PostgREST cannot read, so this prints rather than queries.
//
// Usage: npx tsx --env-file=.env.local scripts/probe-realtime-publication.ts

const SQL = `select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by tablename;`;

function main() {
  console.log('Run this in the Supabase SQL editor:\n');
  console.log(SQL);
  console.log('\nThe repo adds exactly three tables (migrations 010, 129, 145):');
  console.log('  grade_change_requests, approval_request_stages, approval_request_stage_decisions');
  console.log('\nWhat the answer means:');
  console.log('  audit_log ABSENT  -> the P-Files awaiting-verification badge has never');
  console.log('                       updated live. Migration 171 fixes it for free, because');
  console.log('                       a trigger does not need the publication at all.');
  console.log('  audit_log PRESENT -> it was added by hand in the dashboard. The publication');
  console.log('                       has drifted from the migrations, and Task 8 must drop');
  console.log('                       what is actually there, not the repo\\'s three statements.');
  console.log('\nRecord the answer in spec §3.1 before starting Task 8.');
}

main();
```

- [ ] **Step 2: Run it**

Run: `npx tsx --env-file=.env.local scripts/probe-realtime-publication.ts`
Expected: the SQL and both interpretations print. No database call is made.

- [ ] **Step 3: Hand the SQL to Mr Ace and STOP**

Ask him to run it and paste the table list back. Do not proceed to Task 8
without it. **Tasks 2–7 do not depend on the answer** and may continue.

- [ ] **Step 4: Commit**

```bash
git add scripts/probe-realtime-publication.ts && git commit -m "chore(realtime): probe whether audit_log is in the supabase_realtime publication"
```

---

## Task 2: Migration 171 — trigger functions, triggers, RLS policy

**Files:**

- Create: `supabase/migrations/171_realtime_broadcast_badges.sql`
- Test: `__tests__/data/broadcast-trigger-guards.test.ts`

**Interfaces:**

- Consumes: `public.current_user_role()` (migration 142).
- Produces: four topics that Tasks 4–6 subscribe to, named exactly as in
  Global Constraints.

- [ ] **Step 1: Write the failing guard test**

This is a source-reading test, following `__tests__/data/`'s existing pattern.
It asserts the three properties that are invisible once the migration is
applied and expensive to get wrong.

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/171_realtime_broadcast_badges.sql'),
  'utf8'
);

describe('migration 171 — broadcast badge triggers', () => {
  it('swallows exceptions in every trigger function', () => {
    // A failed broadcast must never roll back the write beneath it. audit_log
    // takes a row on every grade entry (Hard Rule #6, append-only).
    const handlers = SQL.match(/exception\s+when\s+others\s+then/gi) ?? [];
    expect(handlers.length).toBe(2);
  });

  it('gates the audit_log trigger on the six P-Files actions in a WHEN clause', () => {
    // The WHEN clause is what keeps a grade-entry audit row out of the
    // function entirely. Without it the filter would run per row in plpgsql.
    const when = SQL.match(/when\s*\(\s*new\.action\s+in\s*\(([^)]*)\)/i);
    expect(when).not.toBeNull();
    for (const action of [
      'pfile.upload',
      'pfile.reminder.sent',
      'sis.document.approve',
      'sis.document.reject',
      'sis.documents.auto-expire',
      'sis.documents.auto-revive',
    ]) {
      expect(when![1]).toContain(action);
    }
  });

  it('removes nothing from the supabase_realtime publication', () => {
    // Both transports stay live so reverting the client commit is a complete
    // rollback. Publication cleanup is its own migration, gated on a browser
    // verification.
    expect(SQL).not.toMatch(
      /drop\s+table|publication\s+supabase_realtime\s+drop/i
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/data/broadcast-trigger-guards.test.ts --pool=threads`
Expected: FAIL — `ENOENT`, the migration file does not exist yet.

- [ ] **Step 3: Write the migration**

```sql
-- 171_realtime_broadcast_badges.sql
--
-- Move the four live badge subscriptions off Postgres Changes and onto
-- Broadcast from the database.
--
-- WHY. Supabase recommends Broadcast over Postgres Changes at scale, but the
-- reason it is nearly free HERE is a property of this codebase: not one of the
-- four handlers reads the event payload. They all re-count against the server
-- and let RLS produce the number. The event has only ever meant "something
-- moved, go look again", which is exactly what a broadcast ping is.
--
-- ADDITIVE ONLY. Nothing is removed from the `supabase_realtime` publication,
-- so both transports are live at once and reverting the client commit is a
-- complete rollback with no second migration. Dropping the publication entries
-- is a later migration, gated on a browser verification.
--
-- Full reasoning: docs/superpowers/specs/2026-09-21-realtime-broadcast-transport-design.md

-- ---------------------------------------------------------------------------
-- 1. Trigger functions
-- ---------------------------------------------------------------------------

-- Fixed-topic ping. The topic is passed as a trigger argument so one function
-- serves three tables.
--
-- ⚠ THE EXCEPTION HANDLER IS LOAD-BEARING, NOT DEFENSIVE HABIT. This runs
-- inside the transaction of the write that fired it. `audit_log` takes a row on
-- every grade entry, and grade entries and audit rows are append-only by Hard
-- Rule #6 — a badge ping is not permitted to be the thing that breaks a write.
-- An AFTER trigger's return value is ignored, so returning null is correct.
create or replace function public.broadcast_badge_ping()
returns trigger
language plpgsql
security definer
set search_path = public, realtime
as $$
begin
  perform realtime.send('{}'::jsonb, 'badge', tg_argv[0], true);
  return null;
exception when others then
  return null;
end;
$$;

comment on function public.broadcast_badge_ping() is
  'Broadcasts an empty "badge" ping on the topic named in tg_argv[0]. Payload is deliberately empty: a badge count differs per viewer, so the client re-counts under RLS. Swallows all exceptions so a failed broadcast cannot roll back the write that fired it.';

-- Per-user ping, for the one topic that is addressed to an individual.
create or replace function public.broadcast_badge_ping_for_user()
returns trigger
language plpgsql
security definer
set search_path = public, realtime
as $$
begin
  perform realtime.send(
    '{}'::jsonb,
    'badge',
    'sis:approval-decisions:' || new.user_id::text,
    true
  );
  return null;
exception when others then
  return null;
end;
$$;

comment on function public.broadcast_badge_ping_for_user() is
  'As broadcast_badge_ping, but on the per-user topic sis:approval-decisions:<user_id>. Used by approval_request_stage_decisions, whose subscription was already per-user under Postgres Changes.';

-- ---------------------------------------------------------------------------
-- 2. Triggers
-- ---------------------------------------------------------------------------

drop trigger if exists broadcast_badge_grade_change_requests on public.grade_change_requests;
create trigger broadcast_badge_grade_change_requests
after insert or update on public.grade_change_requests
for each row
execute function public.broadcast_badge_ping('sis:grade-change-requests');

drop trigger if exists broadcast_badge_approval_stages on public.approval_request_stages;
create trigger broadcast_badge_approval_stages
after insert or update on public.approval_request_stages
for each row
execute function public.broadcast_badge_ping('sis:approval-stages');

drop trigger if exists broadcast_badge_approval_decisions on public.approval_request_stage_decisions;
create trigger broadcast_badge_approval_decisions
after insert on public.approval_request_stage_decisions
for each row
execute function public.broadcast_badge_ping_for_user();

-- ⚠ THE `when` CLAUSE IS THE PERFORMANCE GUARD. audit_log takes a row on every
-- grade entry; without this gate every one of them would enter plpgsql to
-- decide it had nothing to do. Under Postgres Changes this same filter was
-- `action=in.(...)` evaluated by Realtime; in Postgres it is strictly cheaper,
-- because a non-matching row never calls the function at all.
drop trigger if exists broadcast_badge_pfile_verification on public.audit_log;
create trigger broadcast_badge_pfile_verification
after insert on public.audit_log
for each row
when (
  new.action in (
    'pfile.upload',
    'pfile.reminder.sent',
    'sis.document.approve',
    'sis.document.reject',
    'sis.documents.auto-expire',
    'sis.documents.auto-revive'
  )
)
execute function public.broadcast_badge_ping('sis:pfile-verification');

-- ---------------------------------------------------------------------------
-- 3. Who may join which topic
-- ---------------------------------------------------------------------------

-- Private channels read `realtime.messages`, so joining a topic is a SELECT and
-- this policy is the whole authorization model.
--
-- ⚠ THE ROLE LISTS ARE RESTATED FROM TYPESCRIPT AND ARE NOW DUPLICATED IN TWO
-- LANGUAGES. `GATE_ROLES` is components/notifications/notification-bell.tsx:21
-- and `PFILE_BADGE_ROLES` is lib/sidebar/use-realtime-badges.ts:50. A role added
-- to one without the other gets a subscription this policy refuses, which
-- presents as a badge that is dead for that role only.
--
-- ⚠ `current_user_role()` (migration 142) returns the role IN FORCE, reading
-- app_metadata.active_role first. An account holding a role LIST with no
-- active_role set reads as a non-role — a parent — and is refused here. That is
-- the same array trap 142 documents, and it lands as a silently dead badge
-- rather than a visible error.
--
-- ⚠ `else false` makes this default-deny for every other topic. There are no
-- other private channels in the app today. Policies are OR'd, so a future
-- feature adds its own policy rather than widening this one.
drop policy if exists "sis badge topics" on realtime.messages;
create policy "sis badge topics"
on realtime.messages
for select
to authenticated
using (
  case
    when realtime.topic() in ('sis:grade-change-requests', 'sis:approval-stages')
      then public.current_user_role() in (
        'teacher', 'academic_coordinator', 'school_admin', 'superadmin'
      )
    when realtime.topic() = 'sis:pfile-verification'
      then public.current_user_role() in (
        'admissions', 'school_admin', 'superadmin'
      )
    when realtime.topic() like 'sis:approval-decisions:%'
      then realtime.topic() = 'sis:approval-decisions:' || auth.uid()::text
    else false
  end
);
```

- [ ] **Step 4: Run the guard test to verify it passes**

Run: `npx vitest run __tests__/data/broadcast-trigger-guards.test.ts --pool=threads`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/171_realtime_broadcast_badges.sql __tests__/data/broadcast-trigger-guards.test.ts && git commit -m "feat(realtime): broadcast badge pings from the database (migration 171)"
```

---

## Task 3: Apply 171 and prove it landed

**Files:**

- Create: `scripts/verify-broadcast-badge-migration.ts`

**Interfaces:**

- Consumes: migration 171 from Task 2.
- Produces: a confirmed-applied migration. Tasks 4–6 are pointless before it,
  because both transports are live but only Postgres Changes is wired.

- [ ] **Step 1: Write the verification script**

```ts
// Read-only. Prints the SQL that proves migration 171 landed. Triggers,
// functions and policies live in pg_catalog, which PostgREST cannot read — the
// same wall migration 140's verification hit.
//
// Usage: npx tsx --env-file=.env.local scripts/verify-broadcast-badge-migration.ts

const SQL = `-- expect 4 rows
select tgname, tgrelid::regclass as table_name
from pg_trigger
where tgname like 'broadcast_badge_%' and not tgisinternal
order by tgname;

-- expect 2 rows, both with an EXCEPTION block
select proname, prosrc ilike '%exception when others%' as swallows_exceptions
from pg_proc
where proname in ('broadcast_badge_ping', 'broadcast_badge_ping_for_user')
order by proname;

-- expect 1 row
select policyname, cmd
from pg_policies
where schemaname = 'realtime' and tablename = 'messages' and policyname = 'sis badge topics';`;

function main() {
  console.log('Run this in the Supabase SQL editor after applying 171:\n');
  console.log(SQL);
  console.log('\nPASS means: 4 triggers, 2 functions both reading true for');
  console.log('swallows_exceptions, and 1 policy. Anything less and Tasks 4-6');
  console.log('will produce badges that never move.');
}

main();
```

- [ ] **Step 2: Run the script and apply the migration**

Run: `npx tsx --env-file=.env.local scripts/verify-broadcast-badge-migration.ts`
Then apply `171_realtime_broadcast_badges.sql` in the Supabase SQL editor, and
run the printed verification SQL.
Expected: 4 triggers, 2 functions with `swallows_exceptions = true`, 1 policy.

- [ ] **Step 3: Confirm writes still commit**

In the SQL editor, insert and roll back a `grade_change_requests` row inside an
explicit transaction:

```sql
begin;
-- substitute any existing grading_sheet_id
insert into public.grade_change_requests (grading_sheet_id, requested_by, status, reason_category)
values ('<existing-sheet-uuid>', auth.uid(), 'pending', 'other')
returning id;
rollback;
```

Expected: the insert returns an id and the rollback succeeds. A trigger that
raised would fail the insert instead — this is the cheap proof that the
exception handler works before any real write depends on it.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-broadcast-badge-migration.ts && git commit -m "test(realtime): verify migration 171's triggers, functions and topic policy"
```

---

## Task 4: Swap `use-change-request-count.ts`, and settle the topic-collision risk

This task goes first among the client swaps because it answers the open
question for the other two.

**Files:**

- Modify: `lib/sidebar/use-change-request-count.ts:87-95` (delete filter),
  `:138-166` (channel)
- Create (conditional): `lib/sidebar/badge-bus.ts`
- Test: `__tests__/sidebar/change-request-count-broadcast.test.tsx`

**Interfaces:**

- Consumes: topic `sis:grade-change-requests` from Task 2.
- Produces: the channel-construction pattern Tasks 5 and 6 copy verbatim —
  `await supabase.realtime.setAuth()`, then
  `supabase.channel(topic, { config: { private: true } }).on('broadcast', { event: 'badge' }, handler).subscribe()`,
  with the cancelled-flag cleanup shown in Step 3.

🔴 **`applyChangeRequestCountScope` STAYS EXACTLY AS IT IS.** Two per-role
things live in this file and only one goes. The `filter` string at lines ~87–95
is the channel subscription filter and is deleted. The scope function is the
_re-count's_ role scoping — it is what produces the number the badge shows, and
`__tests__/change-requests/scope-parity.test.ts` asserts it agrees with two
other implementations. Deleting it leaves every role counting every row, and
the badge looks plausible while being wrong.

- [ ] **Step 1: Write the failing test**

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { channels, handlers, setAuthCalls, count } = vi.hoisted(() => ({
  channels: [] as Array<{ topic: string; opts: unknown }>,
  handlers: [] as Array<() => Promise<void>>,
  setAuthCalls: { n: 0 },
  count: { value: 7 },
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    const channel: Record<string, unknown> = {};
    channel.on = (_e: string, _cfg: unknown, cb: () => Promise<void>) => {
      handlers.push(cb);
      return channel;
    };
    channel.subscribe = () => channel;

    return {
      realtime: {
        setAuth: async () => {
          setAuthCalls.n += 1;
        },
      },
      channel: (topic: string, opts: unknown) => {
        channels.push({ topic, opts });
        return channel;
      },
      from: () => {
        const query: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'or', 'is', 'maybeSingle']) {
          query[m] = (..._a: unknown[]) => query;
        }
        // academic_years lookup resolves first, then the count query.
        query.then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve({
            data: { id: 'ay-1' },
            count: count.value,
            error: null,
          }).then(resolve);
        return query;
      },
      removeChannel: () => {},
    };
  },
}));

import { useChangeRequestCount } from '@/lib/sidebar/use-change-request-count';

beforeEach(() => {
  channels.length = 0;
  handlers.length = 0;
  setAuthCalls.n = 0;
  count.value = 7;
});

describe('useChangeRequestCount over Broadcast', () => {
  it('joins the fixed topic as a private channel', async () => {
    renderHook(() => useChangeRequestCount('school_admin', 'u-1', 0));
    await waitFor(() => expect(channels.length).toBe(1));
    expect(channels[0].topic).toBe('sis:grade-change-requests');
    expect(channels[0].opts).toEqual({ config: { private: true } });
  });

  it('authenticates the socket before subscribing', async () => {
    // A private channel is refused without setAuth, and the failure is a
    // silently dead badge rather than an error.
    renderHook(() => useChangeRequestCount('school_admin', 'u-1', 0));
    await waitFor(() => expect(setAuthCalls.n).toBe(1));
  });

  it('re-counts when a ping arrives', async () => {
    const { result } = renderHook(() =>
      useChangeRequestCount('school_admin', 'u-1', 0)
    );
    await waitFor(() => expect(handlers.length).toBeGreaterThan(0));
    count.value = 9;
    await act(async () => {
      await handlers[0]();
    });
    await waitFor(() => expect(result.current).toBe(9));
  });

  it('opens ONE channel per topic even when two hooks mount', async () => {
    // Both the sidebar badge and the header bell mount this hook. Under
    // Postgres Changes each had a per-instance channel name; a Broadcast topic
    // IS the channel name, so this is the collision risk the plan calls out.
    renderHook(() => useChangeRequestCount('school_admin', 'u-1', 0));
    renderHook(() => useChangeRequestCount('school_admin', 'u-1', 0));
    await waitFor(() => expect(channels.length).toBeGreaterThan(0));
    const topics = new Set(channels.map((c) => c.topic));
    expect(topics.size).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/sidebar/change-request-count-broadcast.test.tsx --pool=threads`
Expected: FAIL — the hook still calls `channel('change-request-count-…')` with
no options object, and never calls `setAuth`.

- [ ] **Step 3: Rewrite the subscription**

Delete the `filter` block at lines ~87–95 entirely — including the
`if (!filter) return;` early return, which must be replaced by the role check
below so a role outside the flow still subscribes to nothing.

```ts
// A role outside the change-request flow has no count to keep live.
if (
  applyChangeRequestCountScope(
    supabase.from(
      'grade_change_requests'
    ) as unknown as ChangeRequestScopeQuery,
    role,
    userId
  ) === null
) {
  return;
}

// ⚠ `setAuth` IS NOT OPTIONAL AND ITS FAILURE IS SILENT. A private channel
// is refused without it, and a refused join surfaces as a badge that simply
// never moves — not as an error. It is async, hence the cancelled flag: the
// effect can be torn down before the socket is authenticated, and
// subscribing after that would leak a channel with no cleanup.
let channel: ReturnType<typeof supabase.channel> | null = null;
let cancelled = false;

void (async () => {
  await supabase.realtime.setAuth();
  if (cancelled) return;
  channel = supabase
    .channel('sis:grade-change-requests', { config: { private: true } })
    .on('broadcast', { event: 'badge' }, async () => {
      const fresh = await recount();
      if (fresh != null) setCount(fresh);
    })
    .subscribe();
})();

return () => {
  cancelled = true;
  if (channel) supabase.removeChannel(channel);
};
```

Update the file's header comment: the old text explains the per-instance
channel name via `useId`. If `useId`/`instanceId` is now unused, remove the
import and the variable — `npm run lint` will flag it otherwise.

- [ ] **Step 4: Run the test**

Run: `npx vitest run __tests__/sidebar/change-request-count-broadcast.test.tsx --pool=threads`
Expected: PASS, 4 tests.

- [ ] **Step 5: Decide the collision branch**

The fourth test passes trivially against a mock, because the mock returns the
same channel object every time. **The real question is whether `realtime-js`
tolerates two live channels on one topic.** Check the installed version's
behaviour before copying this pattern into two more hooks:

Run: `node -e "console.log(require('@supabase/realtime-js/package.json').version)"`
Then read `node_modules/@supabase/realtime-js/dist/main/RealtimeClient.js` for
how `channel()` registers topics — specifically whether it pushes onto a list
or replaces by topic.

**If two channels on one topic are fine:** nothing more to do; go to Step 6.

**If they collide:** create `lib/sidebar/badge-bus.ts` and route all three
hooks through it. One channel per topic, refcounted, fanned out to N callers:

```ts
'use client';

// One Realtime channel per topic, however many hooks want it.
//
// ⚠ WHY THIS EXISTS. Under Postgres Changes each hook built a per-instance
// channel name via `useId`, so the sidebar badge and the header bell could each
// subscribe without a shared provider. A Broadcast topic IS the channel name,
// so that trick is gone — both want `sis:approval-stages`. This refcounts
// instead: the first subscriber opens the channel, the last one out closes it.
import { createClient } from '@/lib/supabase/client';

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();
const channels = new Map<string, unknown>();

export function subscribeToBadgeTopic(topic: string, fn: Listener): () => void {
  let set = listeners.get(topic);
  if (!set) {
    set = new Set();
    listeners.set(topic, set);
  }
  set.add(fn);

  if (!channels.has(topic)) {
    const supabase = createClient();
    // Placeholder reserves the topic before the async auth completes, so two
    // hooks mounting in the same tick cannot both open a channel.
    channels.set(topic, 'pending');
    void (async () => {
      await supabase.realtime.setAuth();
      const channel = supabase
        .channel(topic, { config: { private: true } })
        .on('broadcast', { event: 'badge' }, () => {
          for (const listener of listeners.get(topic) ?? []) listener();
        })
        .subscribe();
      channels.set(topic, channel);
    })();
  }

  return () => {
    const current = listeners.get(topic);
    if (!current) return;
    current.delete(fn);
    if (current.size > 0) return;
    listeners.delete(topic);
    const channel = channels.get(topic);
    channels.delete(topic);
    if (channel && channel !== 'pending') {
      createClient().removeChannel(channel as never);
    }
  };
}
```

Then each hook's effect becomes:

```ts
return subscribeToBadgeTopic('sis:grade-change-requests', () => {
  void (async () => {
    const fresh = await recount();
    if (fresh != null) setCount(fresh);
  })();
});
```

- [ ] **Step 6: Run the whole sidebar and change-request suites**

Run: `npx vitest run __tests__/sidebar __tests__/change-requests --pool=threads`
Expected: PASS. `scope-parity.test.ts` passing is the proof that
`applyChangeRequestCountScope` survived untouched.

- [ ] **Step 7: Commit**

```bash
git add lib/sidebar/ __tests__/sidebar/change-request-count-broadcast.test.tsx && git commit -m "feat(realtime): the change-request badge listens on a broadcast topic"
```

---

## Task 5: Swap `use-staged-approval-count.ts`

**Files:**

- Modify: `lib/sidebar/use-staged-approval-count.ts:136-176`
- Test: `__tests__/sidebar/staged-count-skips-own-filings.test.tsx:152`

**Interfaces:**

- Consumes: the channel pattern from Task 4 Step 3 (or `subscribeToBadgeTopic`
  if Task 4 Step 5 took the collision branch).
- Produces: nothing new.

This hook holds three subscriptions: two on `approval_request_stages` (INSERT
and UPDATE, unfiltered) and one on `approval_request_stage_decisions` filtered
to `user_id`. They collapse to **two topics** — `sis:approval-stages` and
`sis:approval-decisions:<userId>` — because a topic does not distinguish INSERT
from UPDATE, and both handlers ran the same re-count anyway.

- [ ] **Step 1: Update the existing test's mock and assertion**

The mock at `:26-61` returns a client with no `realtime` key; add it, or the
hook throws on `setAuth`. Replace the `channel.on` capture and the `:152`
assertion:

```tsx
    channel.on = (
      _e: string,
      config: Record<string, unknown>,
      cb: () => Promise<void>
    ) => {
      subscriptions.push(config);
      handlers.push(cb);
      return channel;
    };
    channel.subscribe = () => channel;

    return {
      realtime: { setAuth: async () => {} },
      from: (table: string) => {
```

and add `topics` alongside `subscriptions` in the `vi.hoisted` block:

```tsx
  topics: [] as string[],
```

capturing it in the client mock:

```tsx
      channel: (topic: string) => {
        topics.push(topic);
        return channel;
      },
```

Then the `:152` assertion becomes:

```tsx
it('joins the per-user decisions topic', async () => {
  renderHook(() =>
    useStagedApprovalCount('u-board', ['markbook.grade_change'], 0)
  );
  // A yes on a step that needs everyone changes no step row, so the stage
  // topic hears nothing — this one is how the reader's own decision lands.
  await waitFor(() =>
    expect(topics).toContain('sis:approval-decisions:u-board')
  );
  expect(topics).toContain('sis:approval-stages');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/sidebar/staged-count-skips-own-filings.test.tsx --pool=threads`
Expected: FAIL — `topics` is empty; the hook still names channels
`staged-approval-count-<id>`.

- [ ] **Step 3: Rewrite the subscription**

Replace the whole `.channel(...).on(...).on(...).on(...).subscribe()` chain
with two topic subscriptions, both running the existing `recount()`:

```ts
let stages: ReturnType<typeof supabase.channel> | null = null;
let decisions: ReturnType<typeof supabase.channel> | null = null;
let cancelled = false;

const onPing = async () => {
  const fresh = await recount();
  if (fresh != null) setCount(fresh);
};

void (async () => {
  await supabase.realtime.setAuth();
  if (cancelled) return;
  stages = supabase
    .channel('sis:approval-stages', { config: { private: true } })
    .on('broadcast', { event: 'badge' }, onPing)
    .subscribe();
  decisions = supabase
    .channel(`sis:approval-decisions:${userId}`, {
      config: { private: true },
    })
    .on('broadcast', { event: 'badge' }, onPing)
    .subscribe();
})();

return () => {
  cancelled = true;
  if (stages) supabase.removeChannel(stages);
  if (decisions) supabase.removeChannel(decisions);
};
```

- [ ] **Step 4: Correct two comments that this change makes false**

At `:23-29` the header says the subscription carries no filter because
"`postgres_changes` filters are single-column comparisons" and "RLS already
restricts what is delivered". Under Broadcast the first sentence is moot and
**the second is wrong** — table RLS no longer gates delivery; the topic policy
in migration 171 does, and the payload is empty so nothing is delivered to
gate. Replace with:

```ts
// ⚠ THE TOPIC IS SHARED AND CARRIES NOTHING, on purpose. Under Postgres
// Changes this subscription was unfiltered because the predicate that matters
// — "am I in this row's pool" — is an array membership test a single-column
// filter cannot express. Under Broadcast there is nothing to express: the ping
// is an empty payload on a topic, and WHO MAY JOIN IT is migration 171's
// policy on realtime.messages. What the reader may COUNT is still migration
// 129's policy, applied by the recount below. Delivery and scope are now two
// separate rules; do not conflate them again.
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run __tests__/sidebar/staged-count-skips-own-filings.test.tsx --pool=threads`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/sidebar/use-staged-approval-count.ts __tests__/sidebar/staged-count-skips-own-filings.test.tsx && git commit -m "feat(realtime): approval-step badges listen on broadcast topics"
```

---

## Task 6: Swap `use-realtime-badges.ts` (P-Files)

**Files:**

- Modify: `lib/sidebar/use-realtime-badges.ts:140-158`

**Interfaces:**

- Consumes: topic `sis:pfile-verification` from Task 2; the channel pattern
  from Task 4.
- Produces: nothing new.

This handler calls `router.refresh()` rather than re-counting — the badge is
SSR-rendered and the refresh makes the layout re-read it. That stays.

- [ ] **Step 1: Rewrite the subscription**

```ts
const supabase = createClient();
let channel: ReturnType<typeof supabase.channel> | null = null;
let cancelled = false;

void (async () => {
  await supabase.realtime.setAuth();
  if (cancelled) return;
  channel = supabase
    .channel('sis:pfile-verification', { config: { private: true } })
    .on('broadcast', { event: 'badge' }, () => {
      router.refresh();
    })
    .subscribe();
})();

return () => {
  cancelled = true;
  if (channel) supabase.removeChannel(channel);
};
```

- [ ] **Step 2: Move the action list's meaning into a comment**

`PFILE_VERIFICATION_ACTIONS` at `:39-47` is no longer used to build a filter —
migration 171's `WHEN` clause holds those six strings now. **Do not delete the
constant**; the guard test in Task 2 reads the same six names, and a reader
needs to see them here. Retitle it:

```ts
// The audit-log actions that mean the P-Files awaiting-verification count may
// have moved. ⚠ NOT USED TO BUILD A SUBSCRIPTION FILTER ANY MORE — the same six
// strings are the `when` clause of the broadcast_badge_pfile_verification
// trigger in migration 171, which is where they now take effect. Kept here
// because the list is the definition of what this badge watches, and
// __tests__/data/broadcast-trigger-guards.test.ts asserts the two copies agree.
```

- [ ] **Step 3: Extend the Task 2 guard test to compare the two copies**

Add to `__tests__/data/broadcast-trigger-guards.test.ts`:

```ts
it('the trigger WHEN clause matches the constant in use-realtime-badges.ts', () => {
  const hook = readFileSync(
    join(process.cwd(), 'lib/sidebar/use-realtime-badges.ts'),
    'utf8'
  );
  const block = hook.match(/PFILE_VERIFICATION_ACTIONS\s*=\s*\[([\s\S]*?)\]/);
  expect(block).not.toBeNull();
  const actions = [...block![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  expect(actions).toHaveLength(6);
  const when = SQL.match(/when\s*\(\s*new\.action\s+in\s*\(([^)]*)\)/i);
  for (const action of actions) expect(when![1]).toContain(action);
});
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run __tests__/data/broadcast-trigger-guards.test.ts __tests__/sidebar __tests__/ui --pool=threads`
Expected: PASS. `notification-bell.test.tsx`'s 17 tests pass untouched — it
mocks the hooks, not the client.

- [ ] **Step 5: Typecheck, lint and build**

```bash
npx tsc --noEmit && npm run lint
```

Expected: both clean. ⚠ **`next build` will NOT catch a mistake here** — nearly
every route is dynamic, so a client-component error only fires when a page is
opened (KD #221's lesson). Step 6 of Task 7 is the real check.

- [ ] **Step 6: Commit**

```bash
git add lib/sidebar/use-realtime-badges.ts __tests__/data/broadcast-trigger-guards.test.ts && git commit -m "feat(realtime): the P-Files verification badge listens on a broadcast topic"
```

---

## Task 7: Browser verification — the canonical check

Nothing above proves the pipe works. Mocks prove the client asks for the right
topic; only a browser proves the policy admits it and the trigger fires.

**Files:** none.

- [ ] **Step 1: Run the full suite**

Run: `npx vitest run --pool=threads`
Expected: PASS, no regressions against the ~1,592 baseline.

- [ ] **Step 2: Two sessions, grade-change badge**

Sign in as a `school_admin` in one browser and a teacher in another. File a
grade-change request as the teacher. **Expected: the admin's bell count
increments with no reload.** If it does not, check in this order: did
`setAuth()` run (network tab, the socket carries an `access_token`), does the
role hold `active_role`, and did the trigger fire (Task 3's SQL).

- [ ] **Step 3: Declarations**

File an absence declaration and confirm the approver's bell moves.

- [ ] **Step 4: P-Files**

Upload a document as a parent or staff member and confirm the P-Files
awaiting-verification badge moves. ⚠ **If Task 1 found `audit_log` absent from
the publication, this badge has never worked and this is the first time it
does.** Say so explicitly in the report rather than recording it as "verified".

- [ ] **Step 5: The role-list account**

Sign in as one of the seven accounts holding a role list and confirm the badges
move for them too. This is the migration-142 array trap: a list with no
`active_role` reads as a parent and the policy refuses the join, which looks
exactly like "nothing happened".

- [ ] **Step 6: Record the result**

Update the spec's §10 with both answers, and add a session-context entry to
`CLAUDE.md` naming what was verified in a browser and what was not.

---

## Task 8: Drop the publication entries

🔴 **GATED on Task 1's answer and Task 7 passing.** Until this runs, both
transports are doing work — this is where the saving actually lands.

**Files:**

- Create: `supabase/migrations/172_drop_badge_publication_entries.sql`

- [ ] **Step 1: Write the migration against Task 1's output**

Drop only the tables Task 1's query actually returned. The repo's three
statements are a starting list, not the answer.

```sql
-- 172_drop_badge_publication_entries.sql
--
-- Retire the Postgres Changes transport now that Broadcast (171) is verified
-- in a browser. Until this runs both transports are live, which is what made
-- 171 safely revertible.
--
-- ⚠ WRITTEN AGAINST THE PUBLICATION AS IT ACTUALLY IS, not against the repo's
-- three `add table` statements (010, 129, 145). See spec §3.1.
--
-- ⚠ REVERTING 171'S CLIENT COMMIT AFTER THIS POINT LEAVES NO LIVE TRANSPORT.
-- The rollback from here is to re-add these tables, not to revert code.

alter publication supabase_realtime drop table public.grade_change_requests;
alter publication supabase_realtime drop table public.approval_request_stages;
alter publication supabase_realtime drop table public.approval_request_stage_decisions;
-- + audit_log ONLY if Task 1 found it present.
```

- [ ] **Step 2: Apply it and re-run Task 7 Steps 2–4**

Expected: every badge still moves. They are now moving on Broadcast alone —
before this migration, a passing check could have been Postgres Changes
carrying a broken Broadcast path.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/172_drop_badge_publication_entries.sql && git commit -m "chore(realtime): retire the Postgres Changes transport (migration 172)"
```

---

## Self-review notes

- **Spec §3.1** → Task 1, and its answer gates Task 8.
- **Spec §4.1 topics** → Task 2 Step 3; subscribed in Tasks 4, 5, 6.
- **Spec §4.2 teacher coarsening** → Task 4 Step 3, where the filter is deleted.
- **Spec §4.3 authorization** → Task 2 Step 3's policy; verified Task 7 Step 5.
- **Spec §4.4 triggers + exception handler** → Task 2, guarded by its test and
  Task 3 Step 3.
- **Spec §4.5 client** → Tasks 4, 5, 6.
- **Spec §5 deploy ordering** → Global Constraints + Task 8's gate.
- **Spec §6 verification** → Task 7. ⚠ One correction: the spec says
  `notification-bell.test.tsx` needs a mock swap. It does not — it mocks the
  hooks, not the client. No task does that work.
- **Spec §7 publication cleanup** → Task 8.
- **Spec §9** is out of scope and has no task, by design.
