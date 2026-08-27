# Approval activity feed — design

**Date:** 2026-08-28
**Status:** design APPROVED 2026-08-28 (mockup reviewed and signed off). Not yet planned or built.
**Asked for by:** Mr Ace, 2026-08-27 and 2026-08-28

---

## 1. What this is

An **activity log for the approvals you are part of**, in Mr Ace's words. Two
surfaces:

1. **The panel.** The header bell becomes an activity icon opening a **side
   sheet**. Inside: what is waiting on you, pinned; then a tabbed, newest-first
   log of everything that has happened to any approval you are on.
2. **View history.** One approval end to end, on all three screens that show an
   approval as a row — a dialog on the two mark-change lists, and a section
   inside the existing decision sheet on the declarations page (§9.2).

The reference Mr Ace supplied is the shadcn "Activity" panel: an avatar circle,
the actor's name in bold, their action in muted text, a relative timestamp, and
an optional payload block beneath the row.

## 2. Why it exists

Today the only way to learn that an approval you are on has moved is to go and
look at its queue page. The bell says how many things await _your_ decision and
nothing else — a form class adviser who approved a filing yesterday has no way
to find out whether the Officer in Charge ever acted on it, short of opening
`/attendance/declarations` and hunting.

⚠ **`audit_log` cannot back this and was ruled out before design started.** It
is registrar-and-above only, so an adviser cannot read it; and it records who
**acted**, not who should be **told**. The approval engine records both.

## 3. What already exists, and what that saves

**The database already answers "who should be told."** Migration 131's policy on
`approval_requests` reads, in effect, _you may read this approval if you are on
any of its steps_ — named in a stage's `approver_pool`, or the adviser of its
`section_id` via `is_adviser_for_section` (which includes co-advisers and live
relief cover). That is a direct expression of Mr Ace's "once you are tagged in
an approval". Migration 129 says the same thing one level down, on
`approval_request_stages`.

**The history is already stored.** `approval_request_stages` materialises one
row per step carrying `status`, `decided_by_email`, `decided_at` and
`decision_note`. Nothing needs to be recorded that is not recorded.

**`loadLadderById` in `lib/approvals/inbox.ts` already loads one request's full
ladder.** The View history dialog is largely a rendering job over an existing
function.

**So this feature adds no migration and no table.** It is a read surface.

## 4. The two flows are guarded very differently — this drives the architecture

|            | Declarations (`student_declaration`)            | Grade changes                                          |
| ---------- | ----------------------------------------------- | ------------------------------------------------------ |
| Engine     | `approval_requests` + `approval_request_stages` | `grade_change_requests`, two approver columns          |
| RLS SELECT | only people on the ladder (129 / 131)           | **any authenticated user with a role** (migration 009) |
| Narrowing  | the database does it                            | the API does it, via `?mine=1`                         |

A browser-direct feed — the shape the badge count uses — would therefore show
**every teacher the whole school's grade changes**. That is why the feed is
served by the app rather than read from the browser.

⚠ **The badge is not touched.** `useChangeRequestCount` and
`useDeclarationCount` stay exactly as they are: live, realtime, RLS-scoped, and
counting _work waiting for you_. KD #196's property — that the declarations
badge carries no per-role scope SQL of its own, so it cannot drift from the
queue — is preserved by leaving it alone.

## 5. Decisions taken

| Decision              | Ruling                                                                                                                                                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What the number means | **Work waiting for you** — unchanged. Not unread-activity. Mr Ace considered unread and chose this.                                                                                                                                                                          |
| Read/unread state     | **None.** No new table, no seen-at column, no dots. Follows from the above.                                                                                                                                                                                                  |
| How far back          | **Everything, newest first, load more as you scroll.** No time cliff.                                                                                                                                                                                                        |
| Assembly              | **Derive events on read** (approach A). No events table, no backfill.                                                                                                                                                                                                        |
| Waiting-for-you items | **Pinned above the tab strip**, not inside General. What you owe someone does not change with the tab you are reading. Moved there during the mockup review and approved as drawn, 2026-08-28.                                                                               |
| Tabs                  | **General / Mark changes / Declarations.** General is everything; the rest filter it. Built from the flow list so a new flow gets a tab without new code. ⚠ The label is **Mark changes**, the teachers' phrase, not the page title's "change requests" — approved as drawn. |
| Row granularity       | **One row per step.** Every action on an approval you are on produces its own row, so one filing can yield four. The "one row per approval, updated in place" alternative was drawn as an option and not taken.                                                              |
| Panel header          | **Titled "Activity" and nothing else** — Mr Ace removed the subtitle. The scope disclosure survives once, in the mono bar at the foot of the sheet.                                                                                                                          |
| Grade-change audience | **You asked for it, or you are one of its approvers.** A teacher sees the answer to their own request without going to look.                                                                                                                                                 |
| Oversight             | **The feed is personal, not oversight.** A superadmin's feed shows only what they are personally on. The whole-school view stays on the queue pages.                                                                                                                         |
| Reply box             | **Not built.** The reference has one; we have decision notes. Deciding from a panel that is not the decision screen is how things get approved by accident.                                                                                                                  |
| Icon                  | Bell replaced by the activity/pulse icon from the reference.                                                                                                                                                                                                                 |

### Why approach A, and not an events table

**The feed is full on day one.** An events table starts empty: every filing and
decision already on record would be invisible until something new happened, and
backfilling means reconstructing exactly the history A derives anyway.

An events table also adds a rule every future flow must remember to obey. This
codebase has been bitten by that class of bug before — the cache-invalidation
audit (2026-08-27) found write routes that had quietly forgotten to bust their
tags, and the fix was a test enumerating them rather than trust.

The usual argument for an events table is paging performance over millions of
rows. This is hundreds. It does not apply.

The honest cost of A: two sources with different shapes, merged into one sorted
list, with a cursor that has to page across both. Contained in one module.

## 6. The event model

Six event kinds, two flows, one shape on screen.

**Declarations**

| Kind               | Source                                                                                        | Reads as                                                  |
| ------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `filed`            | `approval_requests.created_at` + `filed_by_email`                                             | "A parent filed travel for Grace Tan, 3 Sep."             |
| `stage_decided`    | each `approval_request_stages` row with status `approved`/`rejected`                          | "Ms Lim, form class adviser, approved." + note if present |
| `register_written` | `student_declarations.register_written_at` / `register_days_written` / `register_write_error` | "1 day marked as excused." Or the stored failure.         |

**Grade changes**

| Kind        | Source                                                        | Reads as                                               |
| ----------- | ------------------------------------------------------------- | ------------------------------------------------------ |
| `requested` | `requested_at` + `requested_by_email`                         | "Ms Tan asked to change Written Work 3 for Grace Tan." |
| `reviewed`  | `reviewed_at`, `reviewed_by_email`, `status`, `decision_note` | "Ms Cruz approved."                                    |
| `applied`   | `applied_at`, `applied_by`                                    | "The change was applied to the sheet."                 |

A stage moving from `waiting` to `pending` is deliberately **not** an event. Its
timestamp is the previous stage's `decided_at`, so it would double every
approval. The preceding row names where it went next instead.

### The unified row

```ts
type ActivityEvent = {
  id: string; // stable, derived: `${flow}:${requestId}:${kind}:${stageOrder ?? ''}`
  flow: 'grade_change' | 'student_declaration';
  requestId: string;
  at: string; // ISO — the sort key
  actorLabel: string; // "Ms Lim" / "A parent"
  actorInitials: string; // reuses deriveInitials
  verb: string; // "approved", "filed", "asked to change"
  subjectLabel: string; // "Grace Tan — travel 3 Sep"
  detail: string | null; // the note, or the outcome
  href: string; // where clicking goes
  waitingOnMe: boolean; // drives the pinned block
};
```

⚠ **`id` must be derived and stable**, not an index — React keys across a
load-more boundary otherwise reorder rows on append.

## 7. Scope resolution

**Declarations.** Re-express 131's predicate server-side, reusing the same
`is_adviser_for_section` definition the RPC authorises against. Do **not**
restate the rule in TypeScript from memory — `lib/approvals/inbox.ts` already
resolves this scope for the queue and is the place to extend.

⚠ KD #196's fourth carried point applies: there is one adviser definition and
it is load-bearing on live RLS. The feed adds a reader, not a second rule.

**Grade changes.** `requested_by = me or primary_approver_id = me or
secondary_approver_id = me`. Note this is **wider than the existing bell**,
which shows approvers only — adding the requester is a deliberate change so a
teacher sees their own outcome.

⚠ **Labels come from joins the engine cannot do.** `approval_requests` holds
`(subject_type, subject_id)` and no key back to its consumer (126, deliberate).
Student and sheet names are resolved by the route, exactly as
`/api/declarations/preview` already does.

## 8. Paging

Cursor is `(at, id)`, descending. Each request:

1. Fetch `limit + 1` events from each source with `at < cursor.at`.
2. Merge, sort by `at` desc with `id` breaking ties.
3. Take `limit`; the next cursor is the last item's `(at, id)`.

⚠ **A source must over-fetch.** Taking exactly `limit` from each source and
merging can drop events: if all of one source's rows are newer, the other
source's contribution to this page is silently truncated and never revisited.
Fetch `limit + 1` per source, merge, then cut.

⚠ **One source failing must not blank the other.** The existing bell already
uses `Promise.allSettled` for exactly this reason, and the comment there says
why: an empty panel reads as "nothing happened", which is worse than a short
list. Same rule here, and a partial result must say it is partial.

## 9. Surfaces

### 9.1 The panel

`components/notifications/` — the existing `NotificationBell` keeps its badge
logic and swaps its `Popover` for a `Sheet`.

- **Header** — "Activity" + the waiting count.
- **Waiting for you** — pinned; the items you owe a decision on.
- **Tabs** — General / Grade changes / Attendance declarations, from the flow list.
- **Log** — newest first, load-more on scroll.

⚠ **`SheetContent` is not a flex column.** Its variants are a plain block with
`h-full`, so a body styled `flex-1 min-h-0 overflow-y-auto` is inert and tall
content overflows with no scrollbar. This panel **must** pass `flex flex-col`
itself. Three components in `components/classroom/` shipped broken for exactly
this reason. Do not "fix" the base — its `gap-4` is currently inert and making
it real would shift spacing app-wide.

⚠ **Lazy mount is load-bearing.** The current bell mounts its preview panel only
while open, so a closed bell costs nothing (KD #56). Keep that: an infinite feed
mounted in every page header on every route is a real cost.

### 9.2 View history

One approval end to end, per request. Same six event kinds, same wording,
filtered to one request and read **oldest first** — there you are reading a
story, not checking what is new. A vertical spine connects the steps, which it
deliberately does **not** do in the panel: here the rows genuinely are one
ordered ladder, so the line carries information; in the panel, different
children's filings interleave and a line would claim a sequence that is not
there.

**Three placements**, one per screen that shows an approval as a row:

| Screen                       | Surface                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/attendance/declarations`   | **A section inside the existing decision sheet**, not a dialog. ⚠ Never stack a dialog over a sheet — nothing in this app does. Matters most on the **Decided** tab, which today says only approved or turned down. |
| `/markbook/change-requests`  | A dialog from the row. No sheet exists here to fold into.                                                                                                                                                           |
| `/markbook/grading/requests` | A dialog from the row. This is "My Requests" — a teacher who asked for a change has **no** screen today that says what happened to it.                                                                              |

These are also where the panel sends you: a row in the panel opens the owning
page, and this is how the whole story is read once there.

Backed by `loadLadderById` for declarations; the grade-change equivalent reads
the single row's three timestamps.

⚠ **A rejected filing is represented by the step that rejected it, not the last
step.** A rejection stops the ladder and later steps stay `waiting` forever. The
timeline must render those trailing steps as never-reached, not as pending.

## 10. Testing

| What                  | How                                                                                                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope — declarations  | A user on no stage of a request sees none of its events; a co-adviser and a live relief cover both do; a booked-but-not-live cover does not. Mirrors `__tests__/auth/relief-window-parity.test.ts`. |
| Scope — grade changes | The requesting teacher sees their own; an unrelated teacher sees nothing, despite the wide-open RLS. This is the test that would catch the leak.                                                    |
| Paging                | With one source's rows all newer than the other's, no event is skipped across a page boundary.                                                                                                      |
| Degradation           | One source erroring returns the other's rows and reports itself partial.                                                                                                                            |
| Event derivation      | A rejected ladder yields the rejecting step and no phantom pending ones.                                                                                                                            |
| Ordering              | Stable ids; appending a page does not reorder existing rows.                                                                                                                                        |

## 11. Explicitly out of scope

- Any migration. This is a read surface.
- Read/unread state, dots, "mark all read".
- Replying or deciding from the panel.
- Email or push. Nothing here notifies anyone outside the app.
- Parents. A parent has no SIS account and is not an audience for this.
- Multi-role. Designed separately; when it lands, the feed's scope should be
  computed across **assigned** roles while actions remain gated on the
  **active** one — Mr Ace's ruling, 2026-08-28. Nothing in this design blocks
  that, because scope here is per-user membership, not per-role.

## 12. Open questions

None blocking. The visual treatment goes through a `frontend-design` pass and a
mockup artifact before any JSX is written.
