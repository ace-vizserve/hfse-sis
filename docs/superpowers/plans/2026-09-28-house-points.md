# House Points Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A House Points feature in the Records module. Staff create an event per academic year, and its setup (who is entered, how placements are decided, and a rubric of placement → points) shapes one score sheet. Placements, points and house standings are computed automatically.

**Architecture:**

- Six new tables (migration 181).
- One pure computation module (`lib/house-points/compute.ts`), used by both the server loaders and the client score sheet. Points are never stored.
- Service-role API routes that write audit rows.
- Two Records pages: standings plus events, and a per-event score sheet.

**Tech Stack:** Next.js 16 App Router, Supabase (service client for writes), zod, react-hook-form, shadcn primitives, `@tanstack/react-table` via `components/ui/data-table`, vitest.

**Spec:** `C:\Users\Ace\.claude\plans\squishy-forging-whisper.md` (approved 2026-09-28). Design mockups: https://claude.ai/artifact/KCwa6bvfoi8R65MXsuv3B5. Source workbook: `House Points Tracking AY2026.xlsx` at the repo root (real student PII: never commit it, never copy names into code or tests).

## Global Constraints

- Work on `main`. Commit with the pathspec in ONE command: `git add <paths> && git commit -m "..."`. Other sessions share the git index. **Never push.**
- Never edit files through PowerShell or ad-hoc scripts. Use the Edit/Write tools only. A heredoc piped into an interpreter (`node -`, `python -`) hangs: write a file and run it instead.
- Tests import vitest globals explicitly: `import { describe, it, expect } from 'vitest'`. Run them with `npx vitest run <path> --pool=threads`. The full suite gets killed for low memory here, so run only targeted paths.
- Hard Rule #7:
  - No raw `#rrggbb`, `oklch(...)`, `slate-*`, `zinc-*`, `gray-*`, `bg-white` or `bg-black` in `app/` or `components/`.
  - House colours come only from `houseChipClass`, `houseSwatchClass` and `houseTileClass` in `lib/sis/houses.ts`, and the house name is always printed beside the colour.
  - Medal colours come from the `medal-gold`, `medal-silver`, `medal-bronze` and `-deep` tokens.
- Before writing ANY JSX, invoke the `frontend-design:frontend-design` skill (the repo's always-do-first rule). Then read `docs/context/09-design-system.md` and `docs/context/09a-design-patterns.md`.
- UI copy is plain English for school admins: no dev jargon, sentence case.
- DataTable columns whose `header` is a render function MUST declare `meta: { label }` (enforced by `__tests__/ui/data-table-column-label-coverage.test.ts`).
- Blank ≠ zero: a `null` score means no score yet and gets no placement and no points; `0` is a real score.
- Ranking is **dense** (46, 46, 44 → 1st, 1st, 2nd), within the event's `rank_within` group.
- A team earns its place's points **once per distinct house** among its members.
- Writers are academic_coordinator, school_admin and superadmin (`HOUSE_POINTS_WRITERS`). The admissions role can view but not write.
- Migration number **181**. 172 is reserved. Nothing in this plan applies migrations to the database: Mr Ace applies 181 himself.

---

### Task 1: Migration 181 — house points tables

**Files:**

- Create: `supabase/migrations/181_house_points.sql`
- Create: `scripts/probe-migration-181.ts` (read-only check, modelled on `scripts/probe-migrations-173-175-176.ts`)

**Interfaces:**

- Produces the tables used by every later task, with these exact names and columns:

```sql
-- 181_house_points.sql  (write a full WHY header in the style of 110_houses.sql / 120_student_discipline_records.sql:
-- what the workbook did, why points are never stored, why a team counts once per house, safe to re-run)

create table if not exists public.house_point_scales (
  id          uuid primary key default gen_random_uuid(),
  event_type  text not null check (event_type in ('internal','external','major','attendance')),
  label       text not null,
  rank        smallint check (rank is null or rank >= 1),   -- null = "everyone else who joined" / unranked
  points      numeric(6,2) not null check (points >= 0),
  sort_order  smallint not null default 0,
  created_at  timestamptz not null default now(),
  unique (event_type, sort_order)
);

create table if not exists public.house_point_events (
  id                uuid primary key default gen_random_uuid(),
  academic_year_id  uuid not null references public.academic_years(id) on delete cascade,
  name              text not null check (length(btrim(name)) > 0),
  held_on           date,
  event_type        text not null check (event_type in ('internal','external','major','attendance')),
  entrant_kind      text not null check (entrant_kind in ('student','team','house')),
  placement_mode    text not null check (placement_mode in ('score','pick')),
  max_score         numeric(8,2) check (max_score is null or max_score > 0),
  rank_within       text not null default 'event' check (rank_within in ('section','level','event')),
  created_by        uuid not null,
  created_at        timestamptz not null default now(),
  updated_by        uuid,
  updated_at        timestamptz not null default now(),
  constraint house_point_events_score_needs_max check (placement_mode <> 'score' or max_score is not null),
  constraint house_point_events_house_is_pick  check (entrant_kind <> 'house' or placement_mode = 'pick')
);

create table if not exists public.house_point_places (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.house_point_events(id) on delete cascade,
  label       text not null check (length(btrim(label)) > 0),
  rank        smallint check (rank is null or rank >= 1),
  points      numeric(6,2) not null check (points >= 0),
  sort_order  smallint not null default 0
);

create table if not exists public.house_point_teams (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.house_point_events(id) on delete cascade,
  name        text not null check (length(btrim(name)) > 0),
  created_at  timestamptz not null default now()
);

create table if not exists public.house_point_team_members (
  team_id             uuid not null references public.house_point_teams(id) on delete cascade,
  section_student_id  uuid not null references public.section_students(id) on delete cascade,
  primary key (team_id, section_student_id)
);

create table if not exists public.house_point_entries (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references public.house_point_events(id) on delete cascade,
  section_student_id  uuid references public.section_students(id) on delete cascade,
  team_id             uuid references public.house_point_teams(id) on delete cascade,
  house_id            uuid references public.houses(id) on delete cascade,
  score               numeric(8,2) check (score is null or score >= 0),
  place_id            uuid references public.house_point_places(id) on delete set null,
  created_by          uuid not null,
  created_at          timestamptz not null default now(),
  updated_by          uuid,
  updated_at          timestamptz not null default now(),
  constraint house_point_entries_one_entrant check (num_nonnulls(section_student_id, team_id, house_id) = 1),
  unique (event_id, section_student_id),
  unique (event_id, house_id),
  unique (team_id)
);
```

- Indexes: `house_point_events (academic_year_id)`, `house_point_places (event_id, sort_order)`, `house_point_entries (event_id)`, `house_point_teams (event_id)`.
- Seed `house_point_scales` with `on conflict (event_type, sort_order) do nothing`. The rows are the workbook legend:
  - internal: Gold r1 5 · Silver r2 4 · Bronze r3 3 · Participation null 1
  - external: Gold r1 20 · Silver r2 15 · Bronze r3 10 · Participation null 5
  - major: Winner r1 20 · 1st Runner Up r2 15 · 2nd Runner Up r3 10 · Participation null 5
  - attendance: `100% attendance` null 1 · `No lates (on-time bonus)` null 2
  - sort_order runs 1..n within each type
- RLS on all six tables:
  - A read policy `<table>_read` `for select to authenticated using (public.is_registrar_or_above() or public.current_user_role() = 'admissions')`. Verify both function names exist by grepping `supabase/migrations`. If `current_user_role` has a different name, use the one that exists.
  - The explicit `_no_insert` / `_no_update` / `_no_delete` deny policies exactly as migration 120 writes them.
  - Every policy is written as `drop policy if exists` then `create policy`.
- `comment on table` for each table, one line of WHY each.

- [ ] **Step 1:** Read `supabase/migrations/110_houses.sql` and `120_student_discipline_records.sql` for conventions. Write `181_house_points.sql` as specified.
- [ ] **Step 2:** Write `scripts/probe-migration-181.ts`. It uses the service client, as the existing probe scripts do, selects `count` from each of the six tables, and prints the `house_point_scales` rows grouped by `event_type`. It is read-only and writes nothing.
- [ ] **Step 3:** Commit: `git add supabase/migrations/181_house_points.sql scripts/probe-migration-181.ts && git commit -m "feat(house-points): migration 181 — events, places, entries, teams, scales"`

### Task 2: Pure computation — `lib/house-points/compute.ts`

**Files:**

- Create: `lib/house-points/compute.ts` (NO `server-only` import: the client score sheet uses it too)
- Test: `__tests__/house-points/compute.test.ts`

**Interfaces:**

- Produces (exact names; later tasks import them):

```ts
export type EventType = 'internal' | 'external' | 'major' | 'attendance';
export type EntrantKind = 'student' | 'team' | 'house';
export type PlacementMode = 'score' | 'pick';
export type RankWithin = 'section' | 'level' | 'event';

export type Place = {
  id: string;
  label: string;
  rank: number | null;
  points: number;
  sortOrder: number;
};

/** One row of a score sheet, already resolved to the houses it credits. */
export type SheetEntry = {
  id: string;
  /** Ranking group key: section id, level id, or 'event'. Teams and houses always use 'event'. */
  group: string;
  score: number | null;
  placeId: string | null;
  /** Distinct house ids this entry credits: [] if a student has no house; a team's DISTINCT member houses. */
  houseIds: string[];
};

export type ResolvedEntry = SheetEntry & {
  place: Place | null;
  points: number;
};

/** Score mode: dense rank within `group` (desc; null never ranked) → place with that rank, else the rank-null place, else null.
 *  Pick mode: place = places.find(p => p.id === entry.placeId) ?? null. points = place?.points ?? 0. */
export function resolveEntries(
  entries: SheetEntry[],
  places: Place[],
  mode: PlacementMode
): ResolvedEntry[];

/** Sum each resolved entry's points once into every id in its houseIds. Returns an entry for every id in `houseIds` (0 if nothing). */
export function houseTotals(
  resolved: ResolvedEntry[],
  houseIds: string[]
): Record<string, number>;

/** Adds several event totals together (standings). */
export function sumTotals(
  totals: Record<string, number>[],
  houseIds: string[]
): Record<string, number>;

/** Group key helper for a student row. */
export function groupKey(
  rankWithin: RankWithin,
  sectionId: string,
  levelId: string
): string;
```

- [ ] **Step 1: Write the failing tests.** Use synthetic ids (`'blue'`, `'orange'`, `'yellow'`, `'green'`, `'e1'`…), never real names. The cases:
  1. **Dense ties, score mode:**
     - places: Gold r1 5, Silver r2 4, Bronze r3 3, Participation null 1
     - one group, scores `[46, 46, 44, 44, 39, 35, 31, null, 28]`
     - expected place labels `['Gold','Gold','Silver','Silver','Bronze','Participation','Participation',null,'Participation']`
     - expected points `[5,5,4,4,3,1,1,0,1]`
  2. **Blank ≠ zero:** scores `[0, null]` → the `0` entry gets Gold (the only ranked score) and the `null` entry gets `place: null, points: 0`.
  3. **Groups rank independently:** group `s1` scores `[10, 8]` and group `s2` scores `[5]` → the s2 entry is Gold.
  4. **No catch-all place:** places without a rank-null row, 5 distinct scores → ranks 4 and 5 get `place: null`, `points: 0`.
  5. **Got Talent (pick mode, teams once per house):**
     - places `1st` 5, `2nd` 4, `3rd` 3, `4th` 2, `5th` 1
     - entries (houseIds already de-duplicated per team):
       - Y→1st, O→2nd, O→3rd
       - B→1st, [B,G,O,Y]→2nd, Y→3rd, [O,G]→5th
       - G→1st, [O,G,Y]→2nd, G→3rd, [G,O]→4th, [B,Y]→5th
     - `houseTotals` = `{ blue: 10, orange: 18, yellow: 17, green: 19 }`
  6. **VANDA total (pick mode):**
     - places Gold 20, Silver 15, Bronze 10, Honourable Mention 17, Participation 5
     - 1 Gold, 5 Silver, 11 Bronze, 8 HM, 20 Participation, each a single-house entry spread over the four houses
     - the sum of all `houseTotals` values = **441**
  7. **Rank-null row at 0 points:** Participation set to 0 → unplaced scorers get 0 points.
  8. **Student with no house:** `houseIds: []` → its points are in `resolved[i].points` but in no house total.
  9. **`sumTotals`:** two events' totals are added per house, and a missing house counts as 0.
  10. **`groupKey`:** `'section'` → sectionId, `'level'` → levelId, `'event'` → `'event'`.
- [ ] **Step 2:** Run `npx vitest run __tests__/house-points/compute.test.ts --pool=threads`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement `compute.ts` minimally, with a short header comment giving the three rules: dense ranking, blank ≠ zero, a team counts once per house.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit: `git add lib/house-points/compute.ts __tests__/house-points/compute.test.ts && git commit -m "feat(house-points): pure placement and points computation"`

### Task 3: Schemas, writer roles, audit vocabulary

**Files:**

- Create: `lib/schemas/house-points.ts`
- Modify: `lib/auth/student-record.ts` (add `HOUSE_POINTS_WRITERS`)
- Modify: `lib/audit/log-action.ts` (actions + entity types), `lib/audit/modules.ts` (the `house_points.` prefix → records), `lib/audit/humanize.ts` (labels and summaries), `app/(records)/records/audit-log/page.tsx` (`RECORDS_AUDIT_ALLOWLIST`)
- Test: `__tests__/house-points/schemas.test.ts`. The existing `__tests__/audit/module-coverage.test.ts` and `allowlist-coverage.test.ts` must stay green.

**Interfaces:**

- Produces:

```ts
// lib/auth/student-record.ts
export const HOUSE_POINTS_WRITERS = [
  'academic_coordinator',
  'school_admin',
  'superadmin',
] as const;

// lib/schemas/house-points.ts
export const PlaceInputSchema; // { id?: uuid, label: string trimmed 1..60, rank: int>=1 | null, points: number 0..1000 }
export const EventInputSchema; // { ayCode: string, name: 1..120, heldOn: 'YYYY-MM-DD' | null,
//   eventType: 'internal'|'external'|'major', entrantKind, placementMode,
//   maxScore: number>0 | null, rankWithin, places: PlaceInput[] (1..20) }
export const EventPatchSchema; // EventInputSchema without ayCode, all optional (places replaces the list when present)
export const AddEntriesSchema; // { sectionStudentIds?: uuid[] (1..500), houseIds?: uuid[] (1..4) } — exactly one present
export const EntryPatchSchema; // { score?: number>=0 | null, placeId?: uuid | null } — at least one key
export const TeamInputSchema; // { name: 1..80, sectionStudentIds: uuid[] (1..30) }
export const TeamPatchSchema; // { name?: ..., sectionStudentIds?: ... } — at least one key
export const ScalesPutSchema; // { eventType: EventType incl 'attendance', rows: { label, rank, points }[] (1..20) }
export type EventInput = z.infer<typeof EventInputSchema>; // (+ matching types for each)
```

- `EventInputSchema` refinements, each with a plain-English message:
  - score mode needs `maxScore` ("Enter the highest possible score")
  - house entrants must use pick mode ("Houses are placed by hand, not by score")
  - ranks among places must be unique ("Two places can't share the same rank")
  - at most one place with `rank: null` ("Only one row can be 'everyone else'")
  - in score mode the ranked places must be exactly 1..n with no gaps ("Places must go 1st, 2nd, 3rd… without gaps")
- `eventType: 'attendance'` is rejected by `EventInputSchema` in this build (it arrives with the Attendance Challenge).
- Audit actions to add:
  - `house_points.event.create`, `house_points.event.update`, `house_points.event.delete`
  - `house_points.entry.add`, `house_points.entry.update`, `house_points.entry.remove`
  - `house_points.team.create`, `house_points.team.update`, `house_points.team.delete`
  - `house_points.scales.update`
- Entity types to add: `house_point_event`, `house_point_entry`, `house_point_team`, `house_point_scale`.

- [ ] **Step 1:** Write failing tests in `__tests__/house-points/schemas.test.ts`. Cover each refinement above (one valid and one invalid case each), the attendance rejection, `AddEntriesSchema` rejecting both-or-neither, and `EntryPatchSchema` rejecting `{}`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement the schemas and `HOUSE_POINTS_WRITERS`, then the audit vocabulary across the four files. Match how `sis.house.update` is threaded through each: read each file's existing entries first.
- [ ] **Step 4:** Run `npx vitest run __tests__/house-points/schemas.test.ts __tests__/audit --pool=threads`. Expected: PASS.
- [ ] **Step 5:** Commit all of the files listed above in one pathspec commit: `feat(house-points): input schemas, writer roles, audit actions`.

### Task 4: Server loaders — `lib/house-points/queries.ts`

**Files:**

- Create: `lib/house-points/queries.ts` (`import 'server-only'`)
- Test: `__tests__/house-points/queries-shape.test.ts`. This is a pure-mapper test: export the row → `SheetEntry` mapper as `toSheetEntries` and test that, not Supabase.

**Interfaces:**

- Consumes: `resolveEntries`, `houseTotals`, `sumTotals`, `groupKey` and the types from Task 2. `listHouses` / `HouseRow` from `lib/sis/houses.ts`. `fetchAllPages` from `lib/supabase/paginate.ts`. `ENROLLED_STATUSES` from `lib/schemas/enrolment.ts`. `createServiceClient` from `@/lib/supabase/service`.
- Produces:

```ts
export type RosterStudent = {
  sectionStudentId: string;
  studentId: string;
  studentNumber: string;
  name: string; // "LAST, First Middle"
  sectionId: string;
  sectionName: string;
  levelId: string;
  levelLabel: string;
  houseId: string | null;
};
export type EventSummary = {
  id: string;
  name: string;
  heldOn: string | null;
  eventType: EventType;
  entrantKind: EntrantKind;
  placementMode: PlacementMode;
  entrantCount: number;
  totals: Record<string, number>; // keyed by house id
};
export type EventDetail = EventSummary & {
  academicYearId: string;
  ayCode: string;
  maxScore: number | null;
  rankWithin: RankWithin;
  places: Place[];
  rows: EventRow[]; // one per entry, in display order
};
export type EventRow = {
  entryId: string;
  kind: EntrantKind;
  score: number | null;
  placeId: string | null;
  student: RosterStudent | null; // kind 'student'
  team: { id: string; name: string; members: RosterStudent[] } | null; // kind 'team'
  houseId: string | null; // kind 'house'
};
export type Scale = {
  eventType: EventType;
  rows: {
    label: string;
    rank: number | null;
    points: number;
    sortOrder: number;
  }[];
};

export function toSheetEntries(
  detail: Pick<EventDetail, 'rankWithin' | 'rows'>
): SheetEntry[]; // pure
export async function loadEnrolledRoster(
  ayId: string
): Promise<RosterStudent[]>; // ENROLLED only, for the picker
export async function loadAyEvents(
  ayId: string,
  houses: HouseRow[]
): Promise<EventSummary[]>; // totals computed
export async function loadEvent(
  eventId: string,
  houses: HouseRow[]
): Promise<EventDetail | null>;
export async function loadScales(): Promise<Scale[]>;
```

- Rules:
  - A student row's `houseIds` is `[houseId]` or `[]`, and its group is `groupKey(rankWithin, sectionId, levelId)`.
  - A team's `houseIds` is its members' DISTINCT non-null houses, and its group is `'event'`.
  - A house row is `[houseId]` with group `'event'`.
  - **Points stay with students who later withdrew:** when resolving entry and member students, join `section_students` by id WITHOUT the enrolled filter. Only `loadEnrolledRoster` filters.
  - `loadAyEvents` must not issue one query per event. Fetch places, entries, teams and members for all of the year's event ids in a handful of `.in('event_id', ids)` queries (use `fetchAllPages` where the row count can exceed 1000), then compute per event in memory.
  - The student join shape follows `lib/sis/records-insights.ts:364-373` and `app/(classroom)/classroom/[sectionId]/students/page.tsx:62-94`. Names are built as `[last_name, first_name, middle_name].filter(Boolean).join(', ')`, with the last name as stored.

- [ ] **Step 1:** Write a failing test for `toSheetEntries`: a student row in section mode takes its section as group; a team with members in houses [B, G, G] gets houseIds [B, G] and group 'event'; a house row; a student with no house gets [].
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement `queries.ts`.
- [ ] **Step 4:** Run the test plus `npx tsc --noEmit`. Expected: PASS and clean.
- [ ] **Step 5:** Commit: `feat(house-points): server loaders for events, sheets, roster, scales`.

### Task 5: API — events and scales

**Files:**

- Create: `app/api/house-points/events/route.ts` (POST), `app/api/house-points/events/[eventId]/route.ts` (PATCH, DELETE), `app/api/house-points/scales/route.ts` (PUT)
- Test: `__tests__/house-points/api-guards.test.ts` (source-reading: every route file under `app/api/house-points` calls `requireRole([...HOUSE_POINTS_WRITERS])` and `logAction(`. It must fail if a new route file skips either; glob the directory so tasks 5 and 6 are both covered.)

**Interfaces:**

- Consumes: schemas and `HOUSE_POINTS_WRITERS` (Task 3), `loadScales` (Task 4). Pattern file: `app/api/sis/students/[enroleeNumber]/house/route.ts` (gate `requireRole` → `if ('error' in auth) return auth.error;`, `safeParse` → 400 `{ error, details }`, `createServiceClient()`, `logAction`, `revalidateTag` / `invalidateDrillTags('records', ayCode)` from `lib/cache/invalidate-drill-tags.ts`).
- Behaviour:
  - **POST /events:**
    - Resolve `ayCode` → `academic_years.id` (404 "That academic year doesn't exist").
    - Insert the event, then its places (sort_order = array index).
    - Audit `house_points.event.create` with `{ name, event_type, entrant_kind, placement_mode, places: [{label,rank,points}] }`.
    - Return 201 `{ ok: true, id }`.
  - **PATCH /events/[eventId]:**
    - 404 if missing. Update the provided fields and stamp `updated_by` / `updated_at`.
    - When `places` is present: upsert the places carrying an `id` that belongs to this event, insert those without one, and delete the omitted ones. **If an omitted place is referenced by an entry's `place_id`, return 409** "A student already has that placement. Change their placement first."
    - Switching `placement_mode` or `entrant_kind` while the event has entries → 409 "This event already has participants, so its setup can't change."
    - Audit `house_points.event.update` with a before/after of the changed fields.
  - **DELETE /events/[eventId]:** 409 "Remove every participant first" if any entry exists. Otherwise delete it and audit `house_points.event.delete`.
  - **PUT /scales:**
    - Delete then insert that event_type's rows (sort_order = index), in two statements with a clear error step.
    - Audit `house_points.scales.update` with before/after rows.
    - Changing scales never touches existing events (their places are copies).
  - Errors: the 500 response has `{ error: 'Something went wrong', step }` and includes `detail` only when `process.env.NODE_ENV !== 'production'`, as in `app/api/classroom/[sectionId]/students/[studentNumber]/discipline/route.ts`.

- [ ] **Step 1:** Write the failing source-reading guard test.
- [ ] **Step 2:** Run it. Expected: FAIL (no route files yet), and the test must assert the directory holds more than 0 routes, so a vacuous pass is impossible.
- [ ] **Step 3:** Implement the three route files.
- [ ] **Step 4:** Run the test plus `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(house-points): event and scale write routes`.

### Task 6: API — entries and teams

**Files:**

- Create: `app/api/house-points/events/[eventId]/entries/route.ts` (POST), `app/api/house-points/entries/[entryId]/route.ts` (PATCH, DELETE), `app/api/house-points/events/[eventId]/teams/route.ts` (POST), `app/api/house-points/teams/[teamId]/route.ts` (PATCH, DELETE)
- Test: `__tests__/house-points/api-guards.test.ts` (from Task 5) must pass with the new files.

**Interfaces:**

- Consumes: Task 3 schemas, Task 5 patterns.
- Behaviour:
  - **POST entries:**
    - For a `student` event, `sectionStudentIds` must all be `section_students` in a section of the event's AY, with an enrolled status (`ENROLLED_STATUSES`); otherwise 400 "Some of those students aren't enrolled this year".
    - A `house` event requires `houseIds`; a `team` event rejects both (use the teams route).
    - Insert with `on conflict do nothing` (upsert, ignoreDuplicates); students already on the sheet are skipped.
    - Audit ONE `house_points.entry.add` row with `{ event_id, added: n, skipped: m }`.
    - Return 201 `{ ok, added, skipped }`.
  - **PATCH entry:**
    - `score` is only allowed in score mode and must be ≤ the event's `max_score` (400 "Score can't be more than {max}").
    - `placeId` is only allowed in pick mode and must be one of this event's places.
    - Audit `house_points.entry.update` with before/after.
    - Return `{ ok, entry: { id, score, placeId } }`.
  - **DELETE entry:** delete it and audit `house_points.entry.remove` with the student/house/team label.
  - **POST teams:**
    - Team events only. Members are validated as in POST entries.
    - Insert the team, its members and its single entry (`team_id`).
    - Audit `house_points.team.create`. Return 201 `{ ok, teamId, entryId }`.
  - **PATCH team:** rename, and/or replace the members (validated). Audit `house_points.team.update`.
  - **DELETE team:** delete the team (the entry and members cascade). Audit `house_points.team.delete`.
  - Every write stamps `created_by` / `updated_by` with `auth.user.id` and revalidates the Records tags.

- [ ] **Step 1:** Implement the four route files. The guard test from Task 5 is the failing-first check: run it before the files exist, then after.
- [ ] **Step 2:** Run `npx vitest run __tests__/house-points --pool=threads` and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 3:** Commit: `feat(house-points): participant, score and team routes`.

### Task 7: House Points page — standings and events table, nav

**Files:**

- Create: `app/(records)/records/house-points/page.tsx`, `app/(records)/records/house-points/loading.tsx`, `components/house-points/events-table.tsx`
- Modify: `lib/auth/roles.ts` (`RECORDS_NAV`: `{ href: '/records/house-points', label: 'House points' }` in the most fitting group; the Students/Operations area is suggested), `lib/sidebar/registry.ts` (`SIDEBAR_REGISTRY.records.iconByHref['/records/house-points'] = Shield`, or another lucide icon not already used in the Records sidebar)
- Optional: `lib/sis/command-palette-nav.ts` entry `Records — House points`.
- Tests that must stay green: `__tests__/ui/sidebar-icon-coverage.test.ts`, `__tests__/auth/nav-route-consistency-all-modules.test.ts`, `__tests__/auth/link-capability-consistency.test.ts`, `__tests__/auth/page-guard-coverage.test.ts`, `__tests__/ui/data-table-column-label-coverage.test.ts`.

**Interfaces:**

- Consumes: `loadAyEvents`, `listHouses`, `HOUSE_POINTS_WRITERS`, `getCurrentAcademicYear` / `listAyCodes` (`lib/academic-year.ts`), `getAyIdByCode` (`lib/dashboard/ay-id.ts`), `AySwitcher` (`components/admissions/ay-switcher.tsx`).
- Produces: `canEdit: boolean` passed down. It is used by Task 8 to show the "New event" / "Point scales" buttons in the header's action slot. Leave a clearly marked slot: an `actions` element rendered only when `canEdit`, filled by Task 8.
- Page:
  - Model it on `app/(records)/records/movements/page.tsx`: the same role guard, `PageShell`, a back link to `/records`, and the header eyebrow `Records · House points · {ayCode}`, h1 `House points.`, lede "Every point a student earns goes to their house. Enter scores under an event, and placements, points and standings follow on their own."
  - Use the `?ay=` handling and `AySwitcher` pattern from `app/(records)/records/students/page.tsx`.
  - **Four house stat cards**, sorted by total descending, using the movements `MovementStatCard` shape:
    - the CardDescription is the house name
    - the CardTitle is the total
    - the CardAction is a `houseTileClass` tile
    - the footer is "1st place" … "4th place" plus "N ahead of {2nd}" / "N behind {1st}"
    - ties share a place
- **Events table** (`components/house-points/events-table.tsx`, client) on `components/ui/data-table`:
  - columns: Event (a link to `/records/house-points/{id}`), Type (Badge: Internal / External / Major event), Participants (count), then one numeric column per house (header = swatch + house name)
  - each row's highest house value is bold in its house `-deep` ink, via a class from a literal map, never interpolation
  - a Type facet, CSV export `house-points-{ay}.csv`, and a totals footer row (use a DataTable footer if one exists; otherwise a Card below the table)
  - empty state (§7.6): "No events yet" plus a sentence of guidance, with the CTA for writers
- `loading.tsx` mirrors the page: 4 skeleton cards plus a skeleton table.

- [ ] **Step 1:** Invoke `frontend-design:frontend-design`, then read `docs/context/09-design-system.md` and `09a-design-patterns.md`.
- [ ] **Step 2:** Add the nav entry and icon. Run the four nav/guard tests. Expected: FAIL until the page exists, and they tell you exactly what is missing.
- [ ] **Step 3:** Build the page, the loading file and the events table.
- [ ] **Step 4:** Run the five tests listed above plus `npx tsc --noEmit` and `npm run lint`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(house-points): standings page and events table in Records`.

### Task 8: New event sheet and point scales sheet

**Files:**

- Create: `components/house-points/new-event-sheet.tsx`, `components/house-points/event-setup-fields.tsx` (fields shared with editing an event), `components/house-points/point-scales-sheet.tsx`
- Modify: `app/(records)/records/house-points/page.tsx` (fill the Task 7 actions slot; load `loadScales()` when `canEdit`)
- Test: `__tests__/house-points/event-setup-defaults.test.ts` for a pure helper `placesFromScale(scale) → PlaceInput[]` exported from `event-setup-fields.tsx`, or better from `lib/house-points/defaults.ts` if a non-React home is cleaner.

**Interfaces:**

- Consumes: `EventInputSchema`, `ScalesPutSchema` (Task 3), `Scale` (Task 4), and the routes POST `/api/house-points/events` and PUT `/api/house-points/scales` (Task 5). `useWriteAction` (`lib/hooks/use-write-action.ts`). The pattern files are `components/discipline/file-record-button.tsx` (Sheet shell) and `components/classroom/discipline-record-form.tsx` (RHF + RadioGroup cards + pinned footer + `Button loading loadingText`).
- Produces: `<EventSetupFields form={...} scales={...} />`, reused by Task 9's "Edit event".
- New event sheet fields, in this order:
  - Event name, and Date (`DatePicker`, optional)
  - **Type**: RadioGroup cards Internal competition / External competition / Major event
  - **Who is entered**: Students / Teams / Houses
  - **How placements are decided**: Ranked from scores / Picked by hand. Choosing Houses forces Picked by hand and disables the other card, with an explanation.
  - When scores are used: **Highest possible score** (number) and **Rank students within**: Each class / Each level / Whole event
  - **Rubric**: `useFieldArray` rows of Label, Rank (shown only in score mode as "1st, 2nd…"; hidden in pick mode) and Points, plus an "Add a place" button and a row remove button.
- Picking a Type refills the rubric from `placesFromScale`. If the user already edited the rubric, confirm with an AlertDialog "Replace the rubric with the {type} defaults?"; never `window.confirm`.
- Submit with `run(..., { pending: 'Creating event…', success: 'Event created' })`, then navigate to the new event's page.
- The Point scales sheet has one section per type (internal, external, major, attendance) with rows of label and points (rank shown read-only). Each section has its own Save, calling PUT per type. Helper text: "Changes apply to new events only. Events already created keep their own points."

- [ ] **Step 1:** Invoke `frontend-design:frontend-design` (a new pattern: a field-array rubric editor).
- [ ] **Step 2:** Write the failing test for `placesFromScale`: it maps rows in order, keeps `rank: null` rows, and returns new objects without ids.
- [ ] **Step 3:** Implement the helper, then the sheets.
- [ ] **Step 4:** Run the test plus `npx tsc --noEmit` and `npm run lint`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(house-points): new event and point scale sheets`.

### Task 9: Event page — score sheet (students and houses)

**Files:**

- Create: `app/(records)/records/house-points/[eventId]/page.tsx`, `.../[eventId]/loading.tsx`, `components/house-points/score-sheet.tsx`, `components/house-points/event-header-totals.tsx`, `components/house-points/add-participants-sheet.tsx`, `components/house-points/edit-event-sheet.tsx`
- Test: `__tests__/house-points/score-sheet-parse.test.ts` for exported pure helpers `parseScore(raw: string, max: number): { value: number | null; error: string | null }` (blank → null; '0' → 0; above max → an error message; not a number → an error).

**Interfaces:**

- Consumes: `loadEvent`, `loadEnrolledRoster`, `listHouses`, `toSheetEntries`, `resolveEntries`, `houseTotals`, `EventSetupFields`, and the routes POST entries, PATCH/DELETE entry, and PATCH/DELETE event.
- Page:
  - The same role guard. A back link to `/records/house-points`.
  - The eyebrow is `Records · House points · {type label}`, and the h1 is the event name.
  - For writers: "Edit event" (outline, opens `edit-event-sheet`, which reuses `EventSetupFields`, locks entrant/mode when there are participants, and has a Delete event button, destructive with an AlertDialog, only when there are no participants) and "Add students" / "Add houses".
  - 404 via `notFound()` when the event is missing.
- **Header totals:** four house stat cards (as on the standings page) for this event, plus a §9.4 accent info panel listing the rubric as badges, using the medal tokens for ranks 1–3. The panel reads "The top N scores in each class are placed" (wording follows rank_within) or "Placements are picked by hand".
- **Score sheet (student entrants):**
  - Tabs by section or level when `rank_within` is section or level (one group at a time, always set, no "All"), and a single table when it is 'event'.
  - Columns: # · Student · House (`HouseChip`) · Score (`/ {max}`) **or** Placement Select (pick mode) · Placement (automatic, a badge) · Points (automatic) · a remove button (writers).
  - Score inputs copy the `ScoreInput` behaviour of `components/grading/score-entry-grid.tsx`: a local draft, commit on blur or Enter, `parseScore`, blank ≠ zero, and `aria-invalid` over max.
  - Saving uses `useWriteAction` `run(() => fetch PATCH, { pending: 'Saving…', success: false-or-silent, refresh: false, onResolved: merge })` and reverts on failure.
  - Placement and points recompute **on the client with `resolveEntries`** across the whole group after every change, so ties update live. The header totals recompute from the same state.
  - A blank score shows "No score yet" and "—".
  - Read-only users see plain text instead of inputs.
- **Score sheet (house entrants):** four rows (every house is auto-added on first render for writers via POST entries `houseIds` if missing, or through a "Set up houses" button; pick whichever is simpler and state it in the report). The columns are House · Placement Select · Points.
- **Add participants sheet:** a cmdk multi-select over `loadEnrolledRoster`, searchable by name, class and student number, with a class filter. Students already on the sheet are shown checked and disabled. Submit calls POST entries `{ sectionStudentIds }` and toasts "Added N students".
- Pick mode for students: the Placement Select lists the event's places in sort order, plus "No placement".

- [ ] **Step 1:** Invoke `frontend-design:frontend-design`.
- [ ] **Step 2:** Write the failing `parseScore` tests. Run them. Expected: FAIL.
- [ ] **Step 3:** Implement the helpers, page, sheet components and loading file.
- [ ] **Step 4:** Run `npx vitest run __tests__/house-points __tests__/auth/page-guard-coverage.test.ts __tests__/ui/data-table-column-label-coverage.test.ts --pool=threads`, `npx tsc --noEmit` and `npm run lint`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(house-points): event score sheet for students and houses`.

### Task 10: Team events

**Files:**

- Create: `components/house-points/team-sheet.tsx` (create/edit a team: name plus a member multi-select, reusing the picker from `add-participants-sheet.tsx`, extracted into `components/house-points/student-multi-picker.tsx` if it isn't already)
- Modify: `components/house-points/score-sheet.tsx` (team rows), `app/(records)/records/house-points/[eventId]/page.tsx` ("Add team" instead of "Add students" for team events)

**Interfaces:**

- Consumes: POST teams, PATCH/DELETE team, PATCH entry (the team's entry), and `resolveEntries` / `houseTotals` (teams arrive as `EventRow.kind === 'team'`).
- Team rows show:
  - the team name, with members listed underneath (name and class)
  - Score or Placement (per mode), then Placement and Points
  - a **Points to houses** cell: one house chip per DISTINCT house with `+{points}`, and the note "Counted once per house" when two members share a house
  - edit and delete buttons for writers
- A team event ranks within the whole event (group 'event').

- [ ] **Step 1:** Invoke `frontend-design:frontend-design` for the team row layout.
- [ ] **Step 2:** Add a failing test in `__tests__/house-points/compute.test.ts` if any helper is added (e.g. `distinctHouses(members)`). Otherwise extend `queries-shape.test.ts` with a team whose members share houses.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run __tests__/house-points --pool=threads`, `npx tsc --noEmit`, `npm run lint` and `npx next build`. Expected: PASS and a clean build.
- [ ] **Step 5:** Commit: `feat(house-points): team events, counted once per house`.

### Task 11: Docs

**Files:**

- Modify: `docs/key-decisions/records.md` (append **KD #228 — House points**: event config drives the sheet; points computed never stored; dense ranking; team once per house; writers; per-AY; migration 181; the Attendance Challenge deferred with its EX-counts-as-present rule), `.claude/rules/key-decisions.md` (add 228 to the records row and the quick lookup, and update "1–227" to "1–228"; this file needs explicit approval, which Mr Ace gave by approving this plan's docs step), `docs/context/09-design-system.md` §6 (rows for `/records/house-points` and `/records/house-points/[eventId]`), `docs/sprints/development-plan.md` (the house-points line: built, and what is pending: applying migration 181, the browser pass, the Attendance Challenge)
- [ ] **Step 1:** Write the doc changes.
- [ ] **Step 2:** Commit: `docs: house points — KD #228, design matrix, dev plan`.

## Deferred (not in this plan)

- **Attendance Challenge** (event type `attendance`, computed monthly from `attendance_absence_marks` plus school days). It has its own plan after this ships.
- **A student's points on their permanent record.** Not asked for.
