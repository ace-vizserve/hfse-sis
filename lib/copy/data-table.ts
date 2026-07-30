/**
 * Plain-English copy for data-table surfaces.
 * Per memory rule: school admins are not IT — every user-visible string
 * must read plain. Add entries here when discovered, not inline.
 */
export const TABLE_COPY = {
  // Document chase / renewal
  awaitingParentReply: 'Awaiting parent reply',
  sentBackToParent: 'Sent back to parent',
  lapsedReupload: 'Lapsed (re-upload needed)',
  awaitingValidation: 'Awaiting validation',

  // Markbook
  changeRequestNotApplied: 'Waiting to be applied',
  termSummary: 'Term summary',
  termSummaryTooltip: 'Older format, no longer written',

  // Roles
  schoolAdmin: 'School admin',
  teacher: 'Teacher',
  academicCoordinator: 'Academic Coordinator',
  superadmin: 'Superadmin',
  pFileOfficer: 'P-File Officer',
  admissions: 'Admissions',

  // Sync wizard
  rowsFromAdmissions: 'Rows from admissions',
  newSectionAssignments: 'New section assignments',
  markedAsWithdrawn: 'Marked as withdrawn',

  // Discount codes
  discountCodesFooter: (label: string) =>
    `These codes apply to the ${label} enrolment portal.`,

  // AY setup
  createGradingSheets: 'Create grading sheets for this AY',
  setAsCurrentAy: 'Set as current AY',
  copyTeacherAssignments: 'Copy teacher assignments from prior AY',
} as const;

export type TableCopyKey = keyof typeof TABLE_COPY;

/**
 * Role → the name a school admin should see. Canonical: this file's header
 * says role labels belong here rather than inline, and `schoolAdmin` was
 * already the one entry that followed it.
 *
 * KNOWN DUPLICATES, deliberately left alone: `components/sis/staff-visuals.tsx`,
 * `staff-accounts-client.tsx`, `hub-snapshot-card.tsx` and
 * `approvers-data-table.tsx` each carry their own copy of this map (one of them
 * says outright that no canonical one existed). Collapsing them is a small,
 * separate job — hub-snapshot-card deliberately pluralises for count cards, so
 * it is not a straight substitution, and repointing the others would change
 * live display text in surfaces this change has no business touching.
 */
export const ROLE_LABELS = {
  teacher: TABLE_COPY.teacher,
  academic_coordinator: TABLE_COPY.academicCoordinator,
  school_admin: TABLE_COPY.schoolAdmin,
  superadmin: TABLE_COPY.superadmin,
  p_file_officer: TABLE_COPY.pFileOfficer,
  admissions: TABLE_COPY.admissions,
} as const satisfies Record<string, string>;
