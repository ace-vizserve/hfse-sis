/**
 * Which module an audit action belongs to.
 *
 * ONE LIST, TWO CONSUMERS. The "Audit activity by module" card counts rows per
 * module, and clicking a bar opens a drill that must list exactly the rows that
 * bar counted (KD #82/#124 — count equals drill). Before this module existed
 * those were two separate hand-kept lists that had silently diverged:
 *
 *   - the chart's list (`lib/sis/dashboard.ts`) held six prefixes covering
 *     51 of 152 audit actions, so 51% of rows were counted in NO module;
 *   - the drill's list (`MODULE_ACTION_PREFIXES` in `lib/sis/drill.ts`) was
 *     keyed by slugs (`markbook`, `sis`) while the chart emitted LABELS
 *     ("Markbook — sheet", "SIS"). `modulePrefixFor` fell back to returning the
 *     unknown key verbatim, which became the LIKE pattern — so every bar click
 *     ran `action LIKE 'Markbook — sheet%'` and returned zero rows. All six.
 *
 * Both now read this file. `__tests__/audit/module-coverage.test.ts` fails if
 * any action in `ALL_AUDIT_ACTIONS` maps to no module or to more than one, so
 * adding an action with a new prefix is a decision rather than a silent hole.
 *
 * MATCHING IS LONGEST-PREFIX-WINS, which is what lets `sis.` be split. That
 * prefix is historic and spans two modules: `sis.stage.*`, `sis.stp.*`,
 * `sis.discount_code.*` and `sis.document.*` are admissions work, while
 * `sis.profile.*`, `sis.family.*` and `sis.house.*` are records work. Filing
 * the whole prefix under one module would mislabel the other half.
 *
 * Prefixes ending in `.` match by segment. A few actions carry no dot at all
 * (`grade_correction`, `grade_change_applied`) and are matched as written.
 */

export type AuditModule = {
  /** Stable identifier. This is what a drill receives as its `segment`. */
  key: string;
  /** Shown on the chart axis. Never used as a lookup key by the drill. */
  label: string;
  /** Action prefixes owned by this module. */
  prefixes: readonly string[];
};

export const AUDIT_MODULES: readonly AuditModule[] = [
  {
    key: 'markbook',
    label: 'Markbook',
    prefixes: [
      'sheet.',
      'entry.',
      'totals.',
      'comment.',
      'publication.',
      'sow.',
      'grade_entry.',
      'subject_report_map.',
      // No dot in this family: `grade_change_applied`, `grade_change_rejected`…
      'grade_change_',
      'grade_correction',
    ],
  },
  { key: 'attendance', label: 'Attendance', prefixes: ['attendance.'] },
  { key: 'evaluation', label: 'Evaluation', prefixes: ['evaluation.'] },
  {
    key: 'pfiles',
    label: 'P-Files',
    prefixes: [
      'pfile.',
      // Emitted by `lib/p-files/freshen-document-statuses.ts` — the automatic
      // expiry/revival sweep. Note the PLURAL stem: `sis.documents.` is this
      // job, `sis.document.` (singular) is an admissions officer approving or
      // rejecting one. Two different things, one character apart.
      'sis.documents.',
    ],
  },
  {
    key: 'admissions',
    label: 'Admissions',
    prefixes: [
      'admissions.',
      'sis.stage.',
      'sis.stp.',
      'sis.precourse.',
      'sis.discount_code.',
      'sis.document.',
    ],
  },
  {
    key: 'records',
    label: 'Records',
    prefixes: [
      // The records half of the historic `sis.` prefix, spelled out one segment
      // at a time. A catch-all `sis.` would be simpler and WRONG: prefixes are
      // also compiled into a PostgREST `or=` filter, which has no notion of
      // longest-prefix-wins, so `sis.` would match `sis.stage.update` too and
      // every admissions row would be counted in both modules. That is not
      // hypothetical — it double-counted exactly 67 rows before this change.
      'sis.student.',
      'sis.profile.',
      'sis.family.',
      'sis.allowance.',
      'sis.vl_allowance.',
      'sis.house.',
      'student.',
      'enrolment.',
      'discipline.',
      'classroom.',
    ],
  },
  {
    key: 'classes',
    label: 'Classes & subjects',
    prefixes: [
      'section.',
      'assignment.',
      'subject.',
      'subject_config.',
      'subject_level_offering.',
      'level.',
      // Creating a level from the admissions reconciliation queue is still a
      // level operation. `level.` does not match it — the stem is `sis.`.
      'sis.level.',
    ],
  },
  {
    key: 'year-setup',
    label: 'Year setup',
    prefixes: ['ay.', 'template.', 'environment.'],
  },
  {
    key: 'access',
    label: 'People & access',
    prefixes: [
      'user.',
      'role.',
      'approver.',
      'approval_stage.',
      'declaration.',
      'parent.',
      'school_config.',
    ],
  },
];

/** Every prefix paired with its module, longest first — the match order. */
const PREFIX_INDEX: ReadonlyArray<{ prefix: string; module: AuditModule }> =
  AUDIT_MODULES.flatMap((module) =>
    module.prefixes.map((prefix) => ({ prefix, module }))
  ).sort((a, b) => b.prefix.length - a.prefix.length);

/**
 * The module that owns an action, or null when nothing claims it.
 *
 * Null is a real answer, not a bug to paper over: a brand-new action prefix
 * lands here until somebody files it, and the coverage test is what makes that
 * visible rather than letting it vanish from the chart.
 */
export function auditModuleForAction(action: string): AuditModule | null {
  for (const { prefix, module } of PREFIX_INDEX) {
    if (action === prefix || action.startsWith(prefix)) return module;
  }
  return null;
}

export function auditModuleByKey(key: string): AuditModule | null {
  return AUDIT_MODULES.find((m) => m.key === key) ?? null;
}

/**
 * The `or=` filter PostgREST needs to select every action in a module.
 *
 * A module owns several prefixes, so a single `.like()` cannot express it.
 * Returns null for an unknown key — callers must treat that as "select
 * nothing", never as "select everything", or a bad segment would silently
 * open the unfiltered log.
 */
export function auditModuleOrFilter(key: string): string | null {
  const module = auditModuleByKey(key);
  if (!module) return null;
  return module.prefixes.map((p) => `action.like.${p}*`).join(',');
}
