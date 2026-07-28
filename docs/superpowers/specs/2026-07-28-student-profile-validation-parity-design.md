# Student Profile — Validation Parity with the Admissions Portal

**Date:** 2026-07-28
**Status:** Draft — pending user review

## Context

The shared Student Profile (the `ay{YY}_enrolment_applications` identity row — name, NRIC, nationality, contact, parent details) is editable from two SIS surfaces: Admissions' applicant detail and Records' student detail (KD #97/#147, one record, two editors). Both surfaces submit through the same two schemas in `lib/schemas/sis.ts` — `ProfileUpdateSchema` for the student, and `FatherUpdateSchema` / `MotherUpdateSchema` / `GuardianUpdateSchema` for each parent slot.

Today those schemas validate almost nothing beyond length and blank-to-null coercion (`optionalText`). The external admissions portal — the original point of data entry for every one of these fields, parent-submitted — enforces real format rules on several of them. Once a record is inside the SIS, editing it through `EditProfileSheet` / `EditFamilySheet` can silently reintroduce exactly the kind of drift the SIS exists to eliminate (VLOOKUP-drift-style inconsistency is HFSE's #1 named pain point — see the project's value-proposition notes). This spec closes that gap for the fields where the portal's rule is known and unambiguous.

## Scope

**In scope — port the portal's format rule as-is:**

1. NRIC / FIN (`nric`, `fatherNric`, `motherNric`, `guardianNric`)
2. Phone numbers (`homePhone`, `contactPersonNumber`, `referrerMobile`, `fatherMobile`, `motherMobile`, `guardianMobile`)
3. Email (`fatherEmail`, `motherEmail`, `guardianEmail`) — student has no direct email field
4. Postal code (`postalCode`)
5. Nationality (`nationality`, `fatherNationality`, `motherNationality`, `guardianNationality`) — constrained to a real country-name list instead of free text

**Explicitly out of scope:**

- **Required-ness parity.** The portal enforces some fields as required at submission time (e.g. mother's NRIC/passport-pass). The SIS is an editing surface for records that already exist, frequently mid-repair by staff who may only have partial information at hand — porting required-ness would block legitimate partial saves. Not requested; not building it.
- **Passport / pass number format.** The portal's zod schema validates these too, but the exact rule isn't in hand for this spec (Singapore/Philippines/other-nationality passport formats vary enough that guessing would be worse than leaving them unvalidated). Tracked as an open item below — add a follow-up task once the exact portal regex is confirmed, don't block this spec on it.
- Any field the portal doesn't itself validate (most of the schema — addresses, religion, learning needs, etc.) stays exactly as-is.

## Design

### 1–4: NRIC, phone, email, postal code

Straightforward regex/format upgrades to existing helpers in `lib/schemas/sis.ts`, applied at the same call sites (no new fields, no new UI):

- **NRIC** — new `optionalNric` helper: `/^[STFGM]\d{7}[A-Z]$/`, adopted verbatim from the portal. Replaces the plain `optionalText(40)` on all 4 NRIC fields.
- **Phone** — new `optionalPhone` helper: `/^\+?\d+$/`, adopted verbatim. Replaces `optionalNumberOrText` on the 6 phone fields listed above. (`optionalNumberOrText` stays as-is for the fields that aren't phone numbers — it's a generically-named alias today; the phone call sites switch to the new helper, non-phone numeric-ish fields don't.)
- **Email** — `optionalEmail`'s loose custom regex (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) is replaced with zod's built-in `.email()` validator. Stricter, standard, no behavior surprises.
- **Postal code** — new `optionalPostalCode` helper: digits-only (`/^\d+$/`), no additional length constraint beyond the existing 60-char ceiling — matches exactly what was approved (tighten to digit-only; don't also hard-code a Singapore-specific 6-digit length, since a legacy or overseas address could be on file). Replaces `optionalNumberOrText` on `postalCode`.

All four keep the existing `optionalText`-style shape (trim → empty-to-null → `.refine()` for format), so they slot in as drop-in replacements. No UI changes — these stay plain `<Input>` text fields in both `edit-profile-sheet.tsx` and `edit-family-sheet.tsx`; only the schema's accepted pattern gets stricter. A bad value shows the refine's message via the existing `<FormMessage />` wiring — nothing new to build there either.

### 5: Nationality — constrained country picker

This is the one field that needs a UI change, not just a schema tweak, because the honest fix isn't "add a regex" (a country name isn't a pattern) — it's "stop accepting free text at all." Confirmed against the portal's own `LocationSelector` component (`field.onChange(value?.name)`): the portal stores the **country name** (e.g. `"Philippines"`), not a demonym, not an ISO code.

**Data source.** Rather than hand-copying the pasted country JSON (the well-known `dr5hn/countries-states-cities-database` dataset, and only received truncated mid-list), add a small, actively-maintained npm dependency that ships the same dataset — candidate: `country-state-city`, which mirrors this exact `dr5hn` data shape (`id`, `name`, `iso2`, `iso3`, `phone_code`, …). Only `name` is needed here; none of the portal's timezones/translations/lat-long/emoji payload gets pulled into the SIS. Exact package + version pinned during planning, not this spec.

**UI.** New `FieldConfig.kind: 'combobox'` variant, alongside the existing `text` / `textarea` / `date` / `tribool` / `select` kinds in both `edit-profile-sheet.tsx` and `edit-family-sheet.tsx`'s shared `SchemaField` renderer. Built from primitives already in the codebase — `components/ui/command.tsx` (already installed for the Cmd+K palette) + the existing `Popover` — matching the portal's own search-a-country UX, minus flags/states/anything not needed for a single-country pick.

**Legacy-value safety valve.** The existing `kind: 'select'` renderer already solves exactly this problem for `preferredPaymentScheme`/`preferredPaymentMethod`: when the stored value isn't in the known option list, it's shown as an extra "`{value}` (current)" item instead of rendering blank (see `edit-profile-sheet.tsx`'s `isKnown` check). The new combobox reuses the same idiom — a student whose `nationality` column already holds something off-list (a typo, an old free-text entry, an abbreviation) keeps displaying and keeps saving untouched until someone actually opens the picker and changes it. **The constraint only bites on new writes; nothing is validated retroactively, no backfill.**

**Schema.** `nationality` / `fatherNationality` / `motherNationality` / `guardianNationality` move from `optionalText(80)` to a `.refine()` against the canonical name list (a `Set<string>` built from the same country-data source, so the UI's option list and the schema's accepted-value list can never drift apart). Given the "current value" escape hatch above, the refine only ever rejects a genuinely new, off-list string typed in some other way (there is no other way once the UI is combobox-only, but the schema is the actual enforcement boundary per KD #23 — the UI constraining input is a UX nicety, not the security/data-integrity boundary).

## Files touched

- `lib/schemas/sis.ts` — new `optionalNric` / `optionalPhone` / `optionalPostalCode` helpers; `optionalEmail` swapped for `z.string().email()`-based; nationality fields on all 4 schemas gain the country-name `.refine()`; new exported `COUNTRY_NAMES` (or similar) constant + a `NATIONALITY_OPTIONS`-style list for the combobox to consume (mirrors the existing `PREFERRED_PAYMENT_SCHEME_OPTIONS` export pattern).
- New small data module (e.g. `lib/data/countries.ts`) — thin wrapper over the chosen npm package, exporting just `{ name }[]`, trimmed to what the app needs.
- `components/sis/edit-profile-sheet.tsx` — `FieldConfig.kind` gains `'combobox'`; `nationality`'s `SECTIONS` entry gets `kind: 'combobox'`; `SchemaField` gains the new render branch.
- `components/sis/edit-family-sheet.tsx` — same `kind: 'combobox'` addition, applied to `fatherNationality` / `motherNationality` / `guardianNationality`.
- No route changes (`app/api/sis/students/[enroleeNumber]/profile/route.ts`, `.../family/[parent]/route.ts`) — both already just `safeParse` the schema per KD #23; the added strictness flows through unchanged.
- No migration — every affected column already exists; this is write-path validation only.

## Error handling

Every new/changed rule uses the same `.refine()` pattern the schemas already use elsewhere (`optionalDate`, `optionalEmail` today), each with a plain-English `message` (per the project's plain-English UI copy rule) surfaced through the existing `<FormMessage />` slot RHF + zod already wire up — no new error-handling plumbing anywhere in this design.

## Testing

- Unit tests for each new/changed helper in `lib/schemas/sis.ts` (valid/invalid NRIC, phone, email, postal code, nationality — including the "known country name passes, arbitrary string fails" case and the "existing off-list value round-trips unchanged when not itself being edited" case, since PATCH payloads only include changed fields to begin with).
- Component test for the new `kind: 'combobox'` branch in `SchemaField` (renders current value, search filters the list, selecting an option calls `field.onChange` with the country name, the "(current)" fallback shows for an off-list stored value) — same style as the existing `__tests__/` component tests for this file's siblings.

## Open item (not blocking this spec)

Passport number and pass-number format rules exist on the portal's schema but weren't available verbatim for this design pass. Once the exact regex is confirmed, it's a same-shaped addition to this same file (new `optionalPassportNumber` / `optionalPassNumber` helpers, applied to `passportNumber`/`pass`, `fatherPassport`/`fatherPass`, `motherPassport`/`motherPass`, `guardianPassport`/`guardianPass`) — worth a short follow-up spec note rather than reopening this one.
