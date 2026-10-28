# Books & supplies tracker — plan (2026-10-28)

Mr Ace: "its basically a tracker for them which books is already given." Staff
tick, per student, which books and supplies were handed over (who + when), on
the Admissions **Supplies** stage. Approved mockup:
https://claude.ai/artifact/AroZunjNpBuVwycJZXuFTc. Keep it simple — no extra
gates, no question rounds.

## Decisions (fixed)

- **Item list** comes from `AY2027 Book List_v02.xlsx` (repo root, a draft).
  - Books: sheet `AY2027 Book list_Enhanced`, header row 4. Columns: B Course,
    C Module (subject), D Book Title, E Publisher, F ISBN, R (index 17) AY2027
    status. Skip rows whose status is `End of life / Cancel`. Course →
    level + class type: `Primary Three - Global` → P3 + Global,
    `Primary Three - Standard` → P3 + Standard, `Secondary One` → S1 + (both
    tracks, class_type null). `HFSE International Education Programme - Year N`
    rows are skipped (not mapped to SIS levels).
  - Supplies: sheet `Other Materials List`, column A Item. Every supply is for
    every level, except names starting `YS` (`YS Kit`, `YS Blue Booklet A5`, …)
    → Youngstarters (level code `YS`) only.
- **A student's list** = the books for their class's level + the class's
  `sections.class_type` (a book with class_type null fits both), plus the
  supplies for their level. The class is the student's current section in that
  AY (`currentSectionId` already on the application page). **No class yet** →
  the card says "Assign a class to see this student's books and supplies." and
  shows nothing else.
- **Stage status is untouched.** Ticking never changes `suppliesStatus`; the
  card's badge shows the stage's own status (Pending / Claimed / Cancelled).
- **Who can tick** = whoever can edit the student record
  (`canWriteStudentRecord`, same as the stage cards). Others see it read-only.
- Untick removes the handover row. Every tick / untick writes an `audit_log`
  row (new actions `sis.supplies.given`, `sis.supplies.ungiven`).
- Key: `student_number` (Hard Rule #4) — applicants have one on their
  application row.

## Phase 1 — data, import, API

1. Migration `supabase/migrations/199_books_supplies.sql` (posture exactly like
   198: RLS on, `authenticated` denied, service role only; idempotent):
   - `supply_items`: id uuid pk, academic_year_id → academic_years (restrict),
     kind text check in ('book','supply'), level_id → levels nullable (null =
     every level), class_type text nullable check in ('Global','Standard'),
     subject text nullable, title text not null, publisher text, isbn text,
     sort_order int not null default 0, is_active bool not null default true,
     created_at/updated_at. Unique (academic_year_id, kind, level_id,
     class_type, subject, title) — use a unique index with `coalesce` for the
     nullable columns.
   - `supply_handovers`: id uuid pk, item_id → supply_items (cascade),
     student_number text not null, given_by uuid (no FK, KD #196),
     given_by_name text, given_at timestamptz not null default now(); unique
     (item_id, student_number); index on student_number.
   - Apply to the LOCAL stack only.
2. `lib/sis/supplies/` — `parseBookList(filePath, ayCode)` (pure, tested) and
   `loadStudentSupplies(service, { ayCode, studentNumber, sectionId })` →
   `{ needsClass: true } | { groups: { name, kind, items: { id, title, meta,
given: { at, byName } | null }[] }[] }`. Books grouped by subject in the
   sheet's order; supplies one group "Supplies".
3. Importer `scripts/backfill/import-ay2027-book-list.ts` — dry run by default,
   `--apply` upserts (idempotent on the unique key; re-running changes
   nothing). Run `--apply` on LOCAL.
4. API `app/api/sis/students/[enroleeNumber]/supplies/route.ts`:
   - GET `?ay=` → the student's list (`loadStudentSupplies`).
   - POST `{ ay, itemIds: string[], given: boolean }` → insert/delete handover
     rows for that student (only items on their list), audit each, return the
     fresh list. `requireRole(STUDENT_RECORD_WRITERS)`. Add the two audit
     actions to `ALL_AUDIT_ACTIONS`.
5. Tests: parser (course mapping, End-of-life skipped, YS supplies, IEP
   skipped), list builder (Global vs Standard, null class_type, no class),
   route (role gate, rejects items not on the student's list).

Gate: `vitest --pool=threads` on the new tests, `tsc --noEmit` clean on touched
files, importer dry run + apply on local, then a reviewer pass.

## Phase 2 — the card on the Supplies stage

- `components/sis/books-supplies-card.tsx` (client), rendered in
  `EnrollmentTab` right after the placement stage cards. Props: ayCode,
  enroleeNumber, canEdit, suppliesStatus.
- Layout per the mockup, in the design system (09 / 09a, Hard Rule #7):
  shadcn `Card`; header = mono eyebrow "Placement · Supplies", serif title
  "Books & supplies", right side "N of M given" + thin mint progress bar +
  the stage status badge (§9.3 recipes: Claimed mint, Pending amber,
  Cancelled destructive). Body: two columns (books by subject left, Supplies
  right; stacks on narrow screens). Each group: header with name + "x of y" +
  outline "Tick all" (hidden when all given / read-only); rows = shadcn
  `Checkbox` + title + muted meta (publisher · ISBN); a given row shows
  "Given 12 Jan · Ms Wynne" in mint. Optimistic tick with rollback + toast on
  failure; React Query per KD #24 (useQuery GET, useMutation POST).
- No-class state: muted one-liner. Read-only: checkboxes disabled.
- Verify in the browser on local (Playwright screenshot) before reporting.

Gate: component test (renders groups, tick calls POST, read-only disables),
tsc, eslint, screenshot check, reviewer pass.

**Changed after review with Mr Ace (2026-10-28):** the checklist is NOT a card
of its own — it lives in the existing Supplies stage tile (count + "Books &
supplies" button opening a sheet) and the Supplies stage's Edit dialog shows a
brief summary + "Open books & supplies" (closes the dialog, then opens the
sheet). Empty year reads "No book list has been loaded for <AY> yet."

## Phase 3 — Admissions "Book list" page (per AY)

Mr Ace: a books list per level, per AY, in Admissions.

- Route `app/(admissions)/admissions/book-list/page.tsx` (server component),
  `?ay=` (AY switcher like the other Admissions pages; default = the AY the
  Applications page defaults to) and `?level=` (+ `&type=Global|Standard` for
  Primary levels that have both). Nav entry "Book list" in the Admissions
  sidebar near the other pipeline pages. Same read access as the application
  page (student-record writers or `documents_pre_enrolment.read`).
- Body: level picker (one level at a time — no "all levels" long scroll),
  then that level's books grouped by subject (title, publisher · ISBN) and the
  supplies for that level. Each item shows "N of M given", where M = students
  currently in that AY's sections of that level (and class type, null-type
  sections count as Standard — same rule as the checklist) and N = those with
  a handover row for the item.
- Read-only. The list itself still comes from the importer each year. A year
  with no list: "No book list has been loaded for <AY> yet."
- Reuse `lib/sis/supplies/*` (item fit rule, grouping) — no second copy of
  the matching logic.

Gate: unit test for the per-item counts, tsc, eslint, browser screenshot on
local, reviewer pass.

**Default year:** no `?ay=` → the newest AY that has a list loaded, else the
current AY.

## Phase 4 — each AY's list is editable on the Book list page

Mr Ace: "each AY can be modified" — the page is NOT read-only. The AY picker
picks which year's list is viewed and edited.

- Who: `STUDENT_RECORD_WRITERS` edit; read-only viewers (documents read
  capability) see no edit controls.
- On the page, for the chosen AY + level (+ track tab):
  - "Add book" (outline button) → Sheet form: subject (pick an existing
    subject on the list or type a new one), title (required), publisher,
    ISBN, track (Global / Standard / Both — Primary only; Secondary is always
    both). Level = the page's level.
  - "Add supply" → small form: title (required); for every level (default) or
    Youngstarters only.
  - Each row: Edit (same Sheet, prefilled) and Remove (confirm dialog).
    **Remove is refused when any student already has a handover for the
    item** — the confirm says "N students have been given this; edit it
    instead" and the API returns 409. Otherwise the row is deleted.
- Empty year: besides "No book list has been loaded for <AY> yet.", writers
  get "Copy from <AY>" (each other AY that has a list) → copies every active
  item into this AY (levels/tracks/subjects/sort order kept), then shows the
  list. Refused if the target AY already has items.
- API under `app/api/sis/supplies/items/` (POST create, PATCH `[id]`, DELETE
  `[id]`) and `app/api/sis/supplies/copy-year/` (POST `{ from, to }`). zod
  validation; the unique key (ay, kind, level, class_type, subject, title)
  conflict → 409 with a plain message. Every write audited (new actions
  `sis.supplies.item_create` / `item_update` / `item_delete` / `copy_year`).
  `revalidatePath`/router.refresh so the page shows the change.
- The importer stays as an optional first load.

Gate: route tests (role gate, 409 on given item, copy refuses non-empty
target), component test for the forms, tsc, eslint, browser check on local
(add → edit → remove an item; copy AY2027 → AY2026 on LOCAL then delete those
copied rows to leave local data as found), reviewer pass.
