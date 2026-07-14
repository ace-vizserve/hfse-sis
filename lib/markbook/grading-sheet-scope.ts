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

export type ScopeSection = { id: string; level_id: string };
export type ScopeConfig = { id: string; subject_id: string; level_id: string };
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
    const secConfigs = configs.filter(
      (c) => c.level_id === sec.level_id && assignedIds.has(c.id)
    );
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
// subjects at its level — distinguishes "nothing to create because nobody
// has assigned subjects yet" from "nothing to create because it's already
// all generated" in the caller's response `reason`.
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
    const secConfigs = configs.filter(
      (c) => c.level_id === sec.level_id && assignedIds.has(c.id)
    );
    return secConfigs.length === 0;
  });
}
