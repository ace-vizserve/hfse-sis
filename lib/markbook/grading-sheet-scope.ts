// Pure scope-builder for grading-sheet generation (Phase 3/4 of the AY-Setup
// redesign — section_subjects, migration 079). Shared by
// app/api/grading-sheets/bulk-create/route.ts (the writer) and
// app/api/grading-sheets/bulk-create/preview/route.ts (the read-only
// preview) so the two can never diverge on "what would be created" (same
// count == drill discipline as KD #124/#128 elsewhere in the app).
//
// A (section, subject) pair is in scope only when a section_subjects row
// exists for it — that's the whole point of migration 079: subjects are no
// longer purely level-derived, a section can opt out of (or into) specific
// subjects its level offers.
//
// Post migration 080 (subject-weights collapse), `subject_configs` no
// longer carries a `level_id` — a config's identity is `subject_id` alone
// (one row per subject per AY). Level-applicability now lives on the
// separate `subject_level_offerings` table and is enforced upstream, at
// section_subjects-assignment time (app/api/sections/[id]/subjects/
// route.ts) — by the time an assignment row exists, it's already known to
// be level-valid. So the ONLY membership test this builder performs is
// "does a section_subjects row pair this section to this subject_config" —
// there is no level to cross-check here anymore.

export type ScopeSection = { id: string; level_id: string };
export type ScopeConfig = { id: string; subject_id: string };
export type ScopeAssignment = { section_id: string; subject_config_id: string };
export type ScopeTerm = { id: string };

export type GradingSheetScope = {
  section_id: string;
  subject_id: string;
  subject_config_id: string;
  term_id: string;
};

export function buildGradingSheetScopes(
  sections: ScopeSection[],
  configs: ScopeConfig[],
  assignments: ScopeAssignment[],
  terms: ScopeTerm[]
): GradingSheetScope[] {
  const assignedBySection = new Map<string, Set<string>>();
  for (const a of assignments) {
    const set = assignedBySection.get(a.section_id) ?? new Set<string>();
    set.add(a.subject_config_id);
    assignedBySection.set(a.section_id, set);
  }

  const scopes: GradingSheetScope[] = [];
  for (const sec of sections) {
    const assignedIds = assignedBySection.get(sec.id) ?? new Set<string>();
    // A config that no section_subjects row assigns to this section is
    // never in scope — even if it's present elsewhere in the (AY-wide)
    // `configs` list.
    const secConfigs = configs.filter((c) => assignedIds.has(c.id));
    for (const term of terms) {
      for (const cfg of secConfigs) {
        scopes.push({
          section_id: sec.id,
          subject_id: cfg.subject_id,
          subject_config_id: cfg.id,
          term_id: term.id,
        });
      }
    }
  }
  return scopes;
}

// True when at least one section in `sections` resolves to zero assigned
// subjects — distinguishes "nothing to create because nobody has assigned
// subjects yet" from "nothing to create because it's already all
// generated" in the caller's response `reason`.
export function anySectionMissingAssignedSubjects(
  sections: ScopeSection[],
  configs: ScopeConfig[],
  assignments: ScopeAssignment[]
): boolean {
  const assignedBySection = new Map<string, Set<string>>();
  for (const a of assignments) {
    const set = assignedBySection.get(a.section_id) ?? new Set<string>();
    set.add(a.subject_config_id);
    assignedBySection.set(a.section_id, set);
  }
  return sections.some((sec) => {
    const assignedIds = assignedBySection.get(sec.id) ?? new Set<string>();
    const secConfigs = configs.filter((c) => assignedIds.has(c.id));
    return secConfigs.length === 0;
  });
}
