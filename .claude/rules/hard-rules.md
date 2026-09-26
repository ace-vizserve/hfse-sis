---
name: hard-rules
description: Seven non-negotiable rules. Violating any of them blocks shipping. Must be in context for every write.
load: always
---

<!-- Stable rule. Auto-loaded every session via @-import in CLAUDE.md. Edit only with explicit user approval. -->

## Hard rules — never violate

These are non-negotiable. Code that breaks any of them does not ship.

1. **Formula returns 93 on the canonical test case** — `WW=[10,10]/max=[10,10]`, `PT=[6,10,10]/max=[10,10,10]`, `QA=22/30`, weights 40/40/20. Self-tested on module load in `lib/compute/quarterly.ts`.
2. **All grade computation is server-side.** Clients send raw scores, receive computed PS / Initial / Quarterly. Single source of truth: `lib/compute/quarterly.ts`.
3. **Blank ≠ Zero on the sheet; the grade divides by the FULL total.** `null` = not entered yet, `0` = took it and scored zero — kept distinct in storage and on screen. For the grade, a component's PS is Σ scores ÷ Σ ALL slot maxes, so a blank slot scores zero against its max, exactly as the grading workbooks compute it (migration 177). A component with no score at all is null.
4. **`studentNumber` is the only stable student ID.** Never use `enroleeNumber` — it resets each AY. Cross-year linking goes through `studentNumber`.
5. **Post-lock edits require `approval_reference`** via the structured change-request flow (KD #25). Server 400s if missing; each field change appends a `grade_audit_log` row.
6. **Grade entries and audit logs are append-only.** Deletion = set to `null` + audit row. Withdrawn students stay in `section_students` with `enrollment_status='withdrawn'`.
7. **Design system is binding; `app/globals.css` is the only source for tokens.** No hardcoded `#rrggbb` / `oklch(...)` / `slate-*` / `zinc-*` / `gray-*` in `app/` or `components/`. No `tailwind.config.*`. See `09-design-system.md`.
