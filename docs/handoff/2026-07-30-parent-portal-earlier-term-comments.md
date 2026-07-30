# Parent portal — show Term 1 and Term 2 adviser comments (with each term's virtue theme)

**For:** the agent working in the **parent portal / admissions portal SPA** repo (the Vite + React app that calls `VITE_SIS_URL`). Not the SIS.

**Status of the SIS side:** done and deployed. No further backend work is needed for this task. Migration `100_school_config_parent_read.sql` is already applied — the letterhead now renders, so **do not touch `useSchoolConfig`**.

---

## The problem

A report card is cumulative on the form class adviser's comments. The Term 3 card is meant to carry **three** comment boxes — Term 1, Term 2 and Term 3 — each under its own heading naming that term's virtue theme.

The portal currently shows only the viewed term's comment, because that is all the API used to send. The SIS now also sends the earlier terms' comments in a **new, separate field**. Your job is to render it.

## What the API now returns

`GET {VITE_SIS_URL}/api/parent/v2/report-card?studentId=…&termNumber=N` → `{ payload }`.

`payload` gains one new field. **Everything else is unchanged.**

```ts
earlierComments: Array<{
  term_id: string;
  term_number: number; // 1 | 2 | 3, always < the term being viewed
  term_label: string; // e.g. "Term 1 — AY2026" — render verbatim
  virtue_theme: string | null; // THIS term's virtue theme, not the viewed term's
  comment: string; // already trimmed, never empty
}>;
```

Sorted ascending by `term_number`. Viewing Term 3 gives you Term 1 then Term 2.

Guarantees, so you don't need to defend against these:

- Never empty strings — a blank or whitespace-only write-up is omitted entirely.
- Never a draft — unsubmitted write-ups are filtered out server-side.
- Never the term being viewed (that one is still in `comments`), so the two lists never overlap and nothing renders twice.
- An earlier term does **not** need its own publication window. The viewed term's window authorises the card, and the card is designed to carry the earlier comments. (An earlier revision required one, which made this field arrive empty whenever the school had published only the current term — i.e. always.)
- **Empty array when `termNumber` is 4.** The final card has no adviser-comment section at all, by design. Do not render a comments block on the Term 4 card.

## Three traps — read before editing

**1. Do not merge `earlierComments` into `comments`.** `ReportCardViewer` reads `payload.comments[0]`, `payload.terms[0]` and `payload.attendance[0]` — the _first_ element — which works only because exactly one term arrives. Appending to `comments` would make it render an **earlier term's comment under the viewed term's heading**. Wrong data on a document parents keep. The field is separate on purpose; keep it separate.

**2. `payload.terms` still contains only the term being viewed.** So `terms.find(t => t.id === c.term_id)` will **not** resolve an earlier comment's term. That is exactly why each entry carries its own `term_label` and `virtue_theme` — use those, do not look anything up.

**3. Do not try to fetch the missing terms or write-ups from the database.** Parents are deliberately role-less users, and the `terms`, `academic_years` and `evaluation_writeups` tables all require a staff role to read. A direct query returns zero rows silently — which is exactly the bug that made the letterhead blank. The API is the only route. (`school_config` and `report_card_publications` are the only two tables a parent may read directly.)

## The virtue theme is per box, not per section

This is the part that needs a structural change, not just an extra loop.

`ReportCardViewer` currently puts a single virtue theme on the **section heading**:

```tsx
<SectionLabel>
  Form Class Adviser's Comments
  {term?.virtue_theme ? ` · HFSE Virtues: ${term.virtue_theme}` : ''}
</SectionLabel>
```

With three terms, each has a **different** virtue theme, so one heading can't carry them. Move it inside each box, matching how the school-side card renders it:

- Section heading: `Form Class Adviser's Comments` — nothing appended.
- Each box: `{term_label}` then, only when a virtue theme exists, ` (HFSE Virtues: {virtue_theme})`, then the comment text below.

So a Term 3 card reads:

```
Form Class Adviser's Comments

  Term 1 — AY2026 (HFSE Virtues: Obedience)
  <comment text>

  Term 2 — AY2026 (HFSE Virtues: Patience)
  <comment text>

  Term 3 — AY2026 (HFSE Virtues: Commitment, Discipline, Integrity)
  <comment text>
```

Order: earliest first, viewed term last. Omit a box with no comment rather than rendering an empty one — a student who joined mid-year legitimately has fewer.

## Files to change

1. **`src/hooks/use-report-card.ts`** — add `earlierComments` to `ReportCardPayload`, with the type above. Also add a matching `EarlierComment` type. (Its `CommentRecord` also now receives a `submitted: boolean` from the server; harmless, add it or ignore it.)

2. **The component that renders the full HFSE-style card** — the one with the letterhead, the two legend boxes, "Academic Grades", "School Attendance" and "Parent's Signature". Render `earlierComments` before the viewed term's comment, per the format above. _(This file wasn't available when the plan was written — find it by searching for "Parent's Signature" or "Academic Grades".)_

3. **`src/components/private/report-card-viewer.tsx`** — the simpler viewer. Same change: move the virtue theme off `SectionLabel` and into a per-box heading, then render `earlierComments` above the existing `comment` block. If this component is no longer reachable, say so rather than editing it speculatively.

## Acceptance criteria

- Opening a Term 3 card for a student with T1, T2 and T3 write-ups shows **three** comment boxes, earliest first, each with its own term name and its own virtue theme.
- Opening the Term 1 card shows exactly **one** box.
- The Term 4 card shows **no** comment section.
- A term whose virtue theme is unset shows the term name with no parenthetical — not the word "null", not an empty bracket.
- The letterhead still renders (name, address, phone, website, email, registration number). If it regressed, you changed something you shouldn't have.
- The marks table and the attendance figures are **unchanged** — still the viewed term only. That is current intended behaviour, not a bug to fix here.

## Out of scope

- **Showing earlier terms' marks and attendance.** Parents still see only the viewed term's. Widening that is a separate decision the school hasn't made; do not attempt it, and do not work around it by querying tables.
- Anything in `useSchoolConfig` — it works now.
- Any change to how the term buttons on the list screen are built.

## Notes for the school-side owner (not for the portal agent)

The AY2026 term labels are stored as `"Term 1 — AY2026"`, so headings read "Term 1 — AY2026 (HFSE Virtues: …)". The portal renders `term_label` verbatim by design — single source of truth. If you want cleaner headings, rename the terms in the SIS (Term 1 / Term 2 / Term 3) and both the school card and the portal follow automatically. AY2025's labels are already plain.
