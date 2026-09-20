# Realtime badge transport — Postgres Changes → Broadcast

**Date:** 2026-09-21
**Status:** Spec. Transport swap approved for planning. The two follow-on
pieces in §9 are explicitly NOT approved and are not part of this work.
**Source:** Mr Ace, 2026-09-21 — _"lets apply this bruh"_, quoting Supabase's
own description of Broadcast: _"Send low-latency messages between clients.
Perfect for real-time messaging, database changes, cursor tracking, game
events, and custom notifications."_ Staging settled the same day:
_"go with 2, transport first"_.

---

## 1. What this is

Every live badge in the app is driven by Supabase Realtime's **Postgres
Changes**. This replaces that transport with **Broadcast from the database** —
a trigger calling `realtime.send()` — while leaving what the user sees exactly
as it is today.

**Scope is deliberately one thing.** Making the activity sheet itself live, and
styling newly-arrived rows distinctly, are real features with their own UI
decisions; they are described in §9 and are not being built here. The reason
for the split is deploy shape, not appetite: this half needs database triggers
and an RLS policy, and it is worth proving the pipe works while the visible
behaviour is still unchanged.

---

## 2. Why Broadcast, stated honestly

Supabase recommends Broadcast over Postgres Changes at scale, and that is the
background reason. But the specific reason it is cheap **here** is a property
of this codebase:

🔴 **Not one handler reads the event payload.** All four subscriptions ignore
what arrives and fire an authoritative re-count instead. The event is already
being used as nothing more than "something moved, go look again."

That matters because the usual cost of leaving Postgres Changes is losing
per-subscriber, server-side row filtering. Here that cost is close to zero —
see §4 for the one exception, which is named and accepted.

⚠ **A payload would not improve this, and §9.2 records why in full.** A badge
count differs per viewer, so no trigger can broadcast "the count is now 4"; and
the activity feed is server-merged, role-scoped, filtered and cursor-paginated,
so no trigger can know whether a given row belongs in a given viewer's current
view. The server is the authority in both cases. The ping is the signal.

---

## 3. Current state

Four subscriptions across three hooks. `use-declaration-count.ts` is a wrapper
over the staged hook with a flow list pinned, and opens no channel of its own.

| Hook                                       | Table                              | Event          | Filter today                                                                                                              |
| ------------------------------------------ | ---------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `lib/sidebar/use-change-request-count.ts`  | `grade_change_requests`            | INSERT, UPDATE | teacher `requested_by=eq.<uid>`; academic_coordinator `status=eq.approved`; school_admin + superadmin `status=eq.pending` |
| `lib/sidebar/use-staged-approval-count.ts` | `approval_request_stages`          | INSERT, UPDATE | **none**                                                                                                                  |
| `lib/sidebar/use-staged-approval-count.ts` | `approval_request_stage_decisions` | INSERT         | `user_id=eq.<uid>`                                                                                                        |
| `lib/sidebar/use-realtime-badges.ts`       | `audit_log`                        | INSERT         | `action=in.(6 P-Files actions)`                                                                                           |

Channel names are per-instance (`…-${instanceId}`) except the P-Files one,
which is a single shared name. Handlers either re-count and `setCount`, or —
for P-Files — call `router.refresh()` so the SSR-rendered badge re-reads from
the server.

### 3.1 🔴 `audit_log` may never have been in the publication

`grep -rn supabase_realtime supabase/migrations/` returns exactly three
statements — `grade_change_requests` (010), `approval_request_stages` (129) and
`approval_request_stage_decisions` (145). **`audit_log` is not among them.**

A `postgres_changes` subscription on a table outside the publication is
accepted by the client and simply never delivers. So either the table was added
to the publication by hand in the Supabase dashboard, or **the P-Files
awaiting-verification badge has never updated live since it shipped** — the
same shape as the three dead document gates in KD #219, where a condition that
cannot fire is indistinguishable from one that is merely quiet.

⚠ **This is not yet a finding, it is an unanswered question**, and it must not
be written up as a defect until the query below has been run. `pg_catalog` is
not readable through PostgREST — the same wall migration 140's verification
hit — so this needs the SQL editor:

```sql
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by tablename;
```

**Either answer is actionable.** If `audit_log` is absent, this migration fixes
a dead badge for free, because a trigger does not need the publication at all.
If it is present, the publication has drifted from the migrations and the
cleanup in §7 must be written against what is actually there rather than
against the three statements in the repo.

---

## 4. Target design

### 4.1 Topics

| Topic                              | Fired by                                  | Replaces                          |
| ---------------------------------- | ----------------------------------------- | --------------------------------- |
| `sis:grade-change-requests`        | `grade_change_requests` INSERT/UPDATE     | 2 subscriptions                   |
| `sis:approval-stages`              | `approval_request_stages` INSERT/UPDATE   | 2 subscriptions                   |
| `sis:approval-decisions:<user_id>` | `approval_request_stage_decisions` INSERT | 1 subscription, per-user as today |
| `sis:pfile-verification`           | `audit_log` INSERT, gated                 | 1 subscription                    |

Payload is an empty object. The event name is `badge` on every topic.

### 4.2 The one behaviour change, accepted deliberately

⚠ **A teacher will wake on every grade-change request in the school**, where
today her subscription is filtered to `requested_by=eq.<her id>`.

Her badge stays correct — the re-count is RLS-scoped, and that is what produces
the number — so the cost is one wasted count query, on a table that takes a
handful of rows a day. The alternative is per-user topics for teachers and
shared topics for everyone else, which is two topic schemes for one table.
Mr Ace was offered the per-teacher alternative on 2026-09-21 and did not ask
for it.

The other three are not coarsenings at all: `approval_request_stages` is
already unfiltered today, the decisions topic stays per-user, and `audit_log`'s
filter moves into the trigger (§4.4), where it is _more_ selective than it is
now.

### 4.3 Authorization

Private channels: `realtime.setAuth()` on the client, `private: true` on each
channel, and RLS on `realtime.messages` deciding who may join which topic.

| Topic                          | Who may join                                                           |
| ------------------------------ | ---------------------------------------------------------------------- |
| `sis:grade-change-requests`    | `GATE_ROLES` — teacher, academic_coordinator, school_admin, superadmin |
| `sis:approval-stages`          | `GATE_ROLES`, as above                                                 |
| `sis:approval-decisions:<uid>` | that user only                                                         |
| `sis:pfile-verification`       | `PFILE_BADGE_ROLES` — admissions, school_admin, superadmin             |

Both constants exist today (`notification-bell.tsx:21` and
`use-realtime-badges.ts:50`) and the policy restates them in SQL rather than
inventing a new list. ⚠ **They are now duplicated in two languages** — a role
added to the TypeScript constant without the migration gets a subscription the
policy refuses, which presents as a silently dead badge for that role only.

Gated with `public.current_user_role()` as rewritten by migration 142, so the
role model is reused rather than restated. Parents must not hold any of these
topics; `current_user_role()` returning null or a parent value is the check.

⚠ **`current_user_role()` reads `auth.jwt()`, and migration 142 is deliberate
about the array trap** — an account whose `app_metadata.role` is a list, with
no `active_role` set in the same statement, reads as a non-role and therefore
as a parent. That is a lockout in ordinary RLS and it would be a silently dead
badge here. The seven accounts holding a role list are the ones to check.

### 4.4 Triggers

One trigger per table, `AFTER`, each with a `WHEN` clause so the function is
not called for rows that cannot matter. `audit_log`'s gates on the six P-Files
actions in Postgres — so a grade-entry audit row, of which there are many,
never enters the function at all.

🔴 **Every trigger swallows its own exceptions.** A failed broadcast must never
roll back the write beneath it. `audit_log` takes a row on every grade entry,
and grade entries and audit rows are append-only by Hard Rule #6 — a badge ping
is not permitted to be the thing that breaks a write. The handler is
`exception when others then return new`, and the plan must include a test that
proves a broken broadcast still lets the underlying insert commit.

⚠ **Triggers widen a rule's blast radius** — the repo's own standing lesson.
Here the rule being ported is a notification, not a constraint, and the
exception handler is what keeps it that way.

### 4.5 Client

Mechanical, and every handler body is untouched:

- `.on('postgres_changes', { event, schema, table, filter }, fn)`
  → `.on('broadcast', { event: 'badge' }, fn)`
- channel constructed with `{ config: { private: true } }`
- `supabase.realtime.setAuth()` before `.subscribe()`
- channel names become the topics in §4.1

`use-declaration-count.ts` changes nothing — it pins a flow onto the staged
hook and opens no channel. `notification-bell.tsx` and `activity-panel.tsx`
change nothing.

---

## 5. Deploy ordering and rollback

**The migration is purely additive.** It creates triggers and an RLS policy and
removes **nothing** from the `supabase_realtime` publication. Both transports
are therefore live at once, and the order is:

1. Apply the migration (next number: **171**).
2. Deploy the client.
3. Verify in the browser (§6).
4. Only then, as a separate migration, drop the publication entries (§7).

If the broadcast path is dead on arrival, **reverting the client commit
restores Postgres Changes with no second migration** — the publication is still
intact. This deliberately avoids the trap that bit migrations 138 and 159,
where deployed code depended on a migration that had to land first.

---

## 6. Verification

**The canonical check is a browser one, and the spec says so rather than
implying tests cover it:** two sessions side by side, file a grade-change
request in one, and watch the bell move in the other with no reload. Repeat for
a declaration step and a P-Files document upload.

Automated coverage, which is necessary but not sufficient:

- `__tests__/ui/notification-bell.test.tsx` — 17 tests today, mocking the
  Supabase channel; the mock swaps from `postgres_changes` to `broadcast`.
- A test that the `audit_log` trigger's `WHEN` clause admits the six P-Files
  actions and rejects a grade-entry action.
- A test that an insert still commits when the broadcast call fails (§4.4).
- A script probing that each of the four topics is joinable by a role that
  should hold it and refused to one that should not, including a parent
  account and a role-list account (§4.3).

---

## 7. Follow-up inside this scope

Once §6 passes, a second migration drops the publication entries added by 010,
129 and 145 — **written against the output of the §3.1 query, not against the
repo's three statements.** That is where the cost saving actually lands; until
it runs, both transports are doing work.

---

## 8. Files

| File                                                    | Change                                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `supabase/migrations/171_realtime_broadcast_badges.sql` | new — triggers, function, `realtime.messages` policy                                  |
| `lib/sidebar/use-change-request-count.ts`               | channel + `.on()` swap; the per-role **channel filter string** is deleted (see below) |
| `lib/sidebar/use-staged-approval-count.ts`              | channel + 3 `.on()` swaps                                                             |
| `lib/sidebar/use-realtime-badges.ts`                    | channel + `.on()` swap; `action=in.()` filter moves to the trigger                    |
| `lib/sidebar/use-declaration-count.ts`                  | none — wrapper only                                                                   |
| `__tests__/ui/notification-bell.test.tsx`               | mock swap                                                                             |

🔴 **Two per-role things live in `use-change-request-count.ts` and only one of
them goes.** The `filter` string built at lines ~87–95 is the channel
subscription filter and is deleted. **`applyChangeRequestCountScope` STAYS
EXACTLY AS IT IS** — it is the re-count's role scoping, it is what produces the
number the badge shows, and `__tests__/change-requests/scope-parity.test.ts`
asserts it agrees with two other implementations. Deleting it would leave every
role counting every row.

---

## 9. Explicitly NOT in this work

### 9.1 The activity sheet is not live today

`activity-panel.tsx` mounts only while the sheet is open and reads
`/api/activity` through React Query at `staleTime: 0`. A fresh read on open,
then nothing: an item arriving while the sheet is open is not shown until it is
closed and reopened, a tab is switched, or a filter changes. **The live badge
and the list beside it can already disagree**, and that is true today, before
any of this.

The ping introduced here is what would fix it — invalidate the `activityFeed`
key and the open sheet refetches. Not being built now.

### 9.2 Distinct styling for newly-arrived rows

Mr Ace, 2026-09-21: _"passing in the payload will make the design for the new
data to have a distinct style like it gives better sign for the users that this
is the new data activity"_. **The goal is right; the payload is the wrong
mechanism**, and this is recorded so it is not re-derived.

To style a row as new you need to know what this person has already **seen**. A
broadcast payload only reports what arrived while the tab was connected and
listening, and Broadcast is fire-and-forget with no replay — a backgrounded
tab, a closed laptop or a dropped socket and those messages are gone. The rows
that would fail to be marked new are precisely the ones that landed while the
user was away, which are the ones most worth marking.

**A seen-watermark is the mechanism**: store the newest event id/timestamp at
the moment the panel was last read, and render anything above it as new. It
does not care how a row arrived, it survives reconnects and reloads, and it
makes an "N new" count trustworthy. `ActivityRow` takes `event` and
`onNavigate` today, so an `isNew` prop is a one-line addition when this is
built.

⚠ **This needs a `frontend-design` pass and something to look at before any
JSX** — a UI change of this kind is not a structural one, per the repo's
standing rule. Also open: whether an arrival auto-refetches under the reader's
scroll position or offers a "3 new — show" pill instead. The recommendation on
record is the pill when the sheet is open and scrolled, silent refetch when it
is open at the top.

---

## 10. Open questions

1. **Is `audit_log` in the `supabase_realtime` publication?** (§3.1) Settles
   whether the P-Files badge works today and what the §7 cleanup must drop.
   One query, SQL editor.
2. **Does `current_user_role()` resolve inside a `realtime.messages` policy?**
   (§4.3) It reads `auth.jwt()`, which Realtime evaluates the policy against,
   so it should — but this is the load-bearing assumption of the whole
   authorization model and the plan proves it first, before anything is built
   on top of it.
