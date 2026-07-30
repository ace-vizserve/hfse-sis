/**
 * Phase 1 of the capability layer: the ZERO-BEHAVIOUR-CHANGE proof.
 *
 * Three things have to agree or this layer silently changes who can do what on a
 * live system:
 *
 *   1. the capability vocabulary is internally consistent;
 *   2. migration 101's seed matches `DEFAULT_ROLE_CAPABILITIES`;
 *   3. `DEFAULT_ROLE_CAPABILITIES` matches the role sets ACTUALLY enforced at
 *      the sites those capabilities will replace — read out of the real route
 *      files, not restated here, so the test fails if either side moves.
 *
 * (3) is the one that matters. A hand-written expectation would just be the same
 * assumption twice.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ALL_CAPABILITIES,
  DEFAULT_ROLE_CAPABILITIES,
  RESOURCES,
  can,
  isCapability,
  type Capability,
} from '@/lib/auth/capabilities';
import { ROLES, type Role } from '@/lib/auth/roles';

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

/** Roles holding a capability, per the defaults. */
function holdersOf(capability: Capability): Role[] {
  return ROLES.filter((role) =>
    DEFAULT_ROLE_CAPABILITIES[role].includes(capability)
  ).sort();
}

/**
 * The role sets these capabilities replaced, frozen.
 *
 * At Phase 1 this test read each array straight out of its route file and
 * compared it to the defaults — the seed could not drift from the live gates
 * because the live gates were the expectation. Phase 2 then MIGRATED those
 * routes, so the arrays no longer exist to read: `requireRole([...])` became
 * `requireCapability(...)`.
 *
 * So the verified values are pinned here instead. This is the contract now:
 * change a holder set and this fails, which is what forces the change to be a
 * decision rather than a slip. The source-reading half lives on below as a
 * WIRING check — each migrated file must still ask for the capability we think
 * it asks for.
 */
/**
 * Grants that have deliberately MOVED since the capability layer landed.
 *
 * PRE_MIGRATION_GATES below is a historical record — what each gate enforced
 * before the layer existed — and editing it in place would destroy exactly the
 * evidence that makes it useful. So a real permission change is recorded here
 * instead, with the date, the instruction behind it, and the resulting holder
 * set. The parity test reads this first and falls back to the baseline.
 *
 * Adding an entry here is a permission change on a live system. It should be
 * traceable to an explicit decision, never a convenience during a refactor.
 */
const DELIBERATE_WIDENINGS: Partial<Record<Capability, Role[]>> = {
  // 2026-07-31, Mr Ace: the academic coordinator sets up the academic year,
  // the classes and the subject weights, so she gets those SIS Admin surfaces
  // rather than reaching them through Records cross-links with two of the
  // three shut. Her AY power is capped at school_admin's — no `delete`.
  // Migration 105.
  'academic_year.read': ['academic_coordinator', 'school_admin', 'superadmin'],
  'academic_year.create': [
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ],
  'academic_year.edit': ['academic_coordinator', 'school_admin', 'superadmin'],
  'subjects.read': ['academic_coordinator', 'school_admin', 'superadmin'],
  'subjects.create': ['academic_coordinator', 'school_admin', 'superadmin'],
  'subjects.edit': ['academic_coordinator', 'school_admin', 'superadmin'],

  // 2026-07-31, Mr Ace: document validation moved OFF the academic coordinator
  // and onto the P-Files officer and school_admin. Migration 106. Note these
  // are the first entries here that also NARROW — she loses all four of her
  // document capabilities — so the name is now half-accurate; it is the record
  // of deliberate moves, in either direction.
  'documents_pre_enrolment.read': [
    'admissions',
    'p_file_officer',
    'school_admin',
    'superadmin',
  ],
  'documents_pre_enrolment.chase': [
    'admissions',
    'p_file_officer',
    'school_admin',
    'superadmin',
  ],
  'documents_pre_enrolment.validate': [
    'admissions',
    'p_file_officer',
    'school_admin',
    'superadmin',
  ],
  'documents_post_enrolment.validate': [
    'p_file_officer',
    'school_admin',
    'superadmin',
  ],
  'documents_post_enrolment.chase': [
    'p_file_officer',
    'school_admin',
    'superadmin',
  ],
  'documents_post_enrolment.upload': [
    'p_file_officer',
    'school_admin',
    'superadmin',
  ],
};

const PRE_MIGRATION_GATES: Partial<Record<Capability, Role[]>> = {
  // requireRole(['academic_coordinator','superadmin','admissions','p_file_officer'])
  // then 403 p_file_officer when the student isn't enrolled.
  'documents_pre_enrolment.validate': [
    'academic_coordinator',
    'admissions',
    'superadmin',
  ],
  // Same array, then 403 admissions when the student IS enrolled.
  'documents_post_enrolment.validate': [
    'academic_coordinator',
    'p_file_officer',
    'superadmin',
  ],
  // The admissions branch of notify / bulk-notify / promise.
  'documents_pre_enrolment.chase': [
    'academic_coordinator',
    'admissions',
    'school_admin',
    'superadmin',
  ],
  // The p-files branch of the same three routes.
  'documents_post_enrolment.chase': ['p_file_officer', 'superadmin'],
  // requireRole(['p_file_officer','superadmin']) on the staff upload route.
  'documents_post_enrolment.upload': ['p_file_officer', 'superadmin'],
  // The three roles the P-Files validation page's own chain admitted.
  'documents_post_enrolment.read': [
    'p_file_officer',
    'school_admin',
    'superadmin',
  ],
  // The four the admissions validation page's chain admitted.
  'documents_pre_enrolment.read': [
    'academic_coordinator',
    'admissions',
    'school_admin',
    'superadmin',
  ],

  // ─── Phase 3: AY & structure, staff & access ───────────────────────────────
  // POST/PATCH/DELETE /api/sis/ay-setup were ['school_admin','superadmin'],
  // ['school_admin','superadmin'] and ['superadmin'] respectively.
  'academic_year.create': ['school_admin', 'superadmin'],
  'academic_year.edit': ['school_admin', 'superadmin'],
  'academic_year.delete': ['superadmin'],
  // PATCH /api/sis/ay-setup/terms/[termId] — the one AY route that admits her.
  'academic_year.edit_terms': [
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ],
  // /api/attendance/calendar/** (6 write sites).
  'school_calendar.edit': [
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ],
  // GET /api/sections admitted `teacher` too — reference data (migration 005
  // calls sections "read-only UI scaffolding").
  'sections.read': [
    'academic_coordinator',
    'school_admin',
    'superadmin',
    'teacher',
  ],
  'sections.create': ['academic_coordinator', 'school_admin', 'superadmin'],
  'sections.edit': ['academic_coordinator', 'school_admin', 'superadmin'],
  'sections.delete': ['academic_coordinator', 'school_admin', 'superadmin'],
  // /api/sis/admin/subjects/** — its own group rather than folded into
  // academic_year.edit, so unticking one never silently revokes the other.
  'subjects.create': ['school_admin', 'superadmin'],
  'subjects.edit': ['school_admin', 'superadmin'],
  // GET /api/teacher-assignments/by-teacher.
  'staff.read': ['academic_coordinator', 'school_admin', 'superadmin'],
  // POST /api/teacher-assignments + DELETE /api/teacher-assignments/[id].
  'staff.edit_assignments': [
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ],
  'approvers.manage': ['superadmin'],
};

/**
 * Routes deliberately LEFT on requireRole, each because its role set genuinely
 * differs from the nearest capability's — mapping them would silently widen or
 * narrow access. Asserted so a future sweep doesn't "finish the job" by
 * flattening a real distinction.
 */
const DELIBERATELY_NOT_MIGRATED: Array<{ file: string; why: string }> = [
  {
    file: 'app/api/sections/[id]/publish-readiness/route.ts',
    why: 'registrar+ only; sections.read also admits teacher, so it would widen',
  },
  {
    file: 'app/api/sections/[id]/students/[enrolmentId]/route.ts',
    why: 'edits a student enrolment, not a section, and carries its own per-field admin_notes gate',
  },
  {
    file: 'app/api/teacher-assignments/route.ts',
    why: 'its GET admits teacher so they can read their own assignments; staff.read is registrar+',
  },
];

/** Files migrated in Phase 2 → the capabilities each must reference. */
const MIGRATED_SITES: Array<{ file: string; capabilities: Capability[] }> = [
  {
    file: 'app/api/sis/students/[enroleeNumber]/document/[slotKey]/route.ts',
    capabilities: [
      'documents_pre_enrolment.validate',
      'documents_post_enrolment.validate',
    ],
  },
  {
    file: 'app/api/p-files/[enroleeNumber]/notify/route.ts',
    capabilities: [
      'documents_pre_enrolment.chase',
      'documents_post_enrolment.chase',
    ],
  },
  {
    file: 'app/api/p-files/notify/bulk/route.ts',
    capabilities: [
      'documents_pre_enrolment.chase',
      'documents_post_enrolment.chase',
    ],
  },
  {
    file: 'app/api/p-files/[enroleeNumber]/promise/route.ts',
    capabilities: [
      'documents_pre_enrolment.chase',
      'documents_post_enrolment.chase',
    ],
  },
  {
    file: 'app/api/p-files/[enroleeNumber]/upload/route.ts',
    capabilities: ['documents_post_enrolment.upload'],
  },
  {
    file: 'app/(admissions)/admissions/document-validation/page.tsx',
    capabilities: [
      'documents_pre_enrolment.read',
      'documents_pre_enrolment.validate',
    ],
  },
  {
    file: 'app/(p-files)/p-files/document-validation/page.tsx',
    capabilities: [
      'documents_pre_enrolment.read',
      'documents_post_enrolment.read',
      'documents_pre_enrolment.validate',
      'documents_post_enrolment.validate',
    ],
  },
  // Phase 3
  {
    file: 'app/api/sis/ay-setup/route.ts',
    capabilities: [
      'academic_year.create',
      'academic_year.edit',
      'academic_year.delete',
    ],
  },
  {
    file: 'app/api/sis/ay-setup/terms/[termId]/route.ts',
    capabilities: ['academic_year.edit_terms'],
  },
  {
    file: 'app/api/sis/ay-setup/accepting-applications/route.ts',
    capabilities: ['academic_year.edit'],
  },
  {
    file: 'app/api/sis/ay-setup/seed-calendar/route.ts',
    capabilities: ['academic_year.edit'],
  },
  {
    file: 'app/api/sis/ay-setup/copy-teacher-assignments/route.ts',
    capabilities: ['academic_year.edit'],
  },
  {
    file: 'app/api/sis/admin/school-config/route.ts',
    capabilities: ['academic_year.edit'],
  },
  {
    file: 'app/api/attendance/calendar/route.ts',
    capabilities: ['school_calendar.edit'],
  },
  {
    file: 'app/api/attendance/calendar/events/route.ts',
    capabilities: ['school_calendar.edit'],
  },
  {
    file: 'app/api/attendance/calendar/copy-from-prior-ay/route.ts',
    capabilities: ['school_calendar.edit'],
  },
  {
    file: 'app/api/sections/route.ts',
    capabilities: ['sections.read', 'sections.create'],
  },
  {
    file: 'app/api/sections/[id]/route.ts',
    capabilities: ['sections.edit', 'sections.delete'],
  },
  {
    file: 'app/api/sections/[id]/generate-index/route.ts',
    capabilities: ['sections.edit'],
  },
  {
    file: 'app/api/sections/[id]/schedule/route.ts',
    capabilities: ['sections.edit'],
  },
  {
    file: 'app/api/sections/[id]/track/route.ts',
    capabilities: ['sections.edit'],
  },
  {
    file: 'app/api/sections/[id]/subjects/route.ts',
    capabilities: ['sections.edit'],
  },
  {
    file: 'app/api/sections/[id]/subjects/[subjectConfigId]/route.ts',
    capabilities: ['sections.edit'],
  },
  {
    file: 'app/api/sections/[id]/subjects/attach-many/route.ts',
    capabilities: ['sections.edit'],
  },
  {
    file: 'app/api/sections/[id]/subjects/load-defaults/route.ts',
    capabilities: ['sections.edit'],
  },
  {
    file: 'app/api/sis/admin/subjects/route.ts',
    capabilities: ['subjects.create'],
  },
  {
    file: 'app/api/sis/admin/subjects/[configId]/route.ts',
    capabilities: ['subjects.edit'],
  },
  {
    file: 'app/api/sis/admin/subjects/[configId]/report-map/route.ts',
    capabilities: ['subjects.edit'],
  },
  {
    file: 'app/api/sis/admin/subjects/catalog/route.ts',
    capabilities: ['subjects.create'],
  },
  {
    file: 'app/api/sis/admin/subjects/catalog/[id]/route.ts',
    capabilities: ['subjects.edit'],
  },
  {
    file: 'app/api/sis/admin/subjects/level-offerings/route.ts',
    capabilities: ['subjects.edit'],
  },
  {
    file: 'app/api/sis/admin/users/route.ts',
    capabilities: ['staff.manage_accounts'],
  },
  {
    file: 'app/api/sis/admin/users/[id]/route.ts',
    capabilities: ['staff.manage_accounts'],
  },
  {
    file: 'app/api/sis/admin/approvers/route.ts',
    capabilities: ['approvers.manage'],
  },
  {
    file: 'app/api/sis/admin/approvers/[id]/route.ts',
    capabilities: ['approvers.manage'],
  },
  {
    file: 'app/api/teacher-assignments/[id]/route.ts',
    capabilities: ['staff.edit_assignments'],
  },
  {
    file: 'app/api/teacher-assignments/by-teacher/route.ts',
    capabilities: ['staff.read'],
  },
];

describe('capability vocabulary', () => {
  it('has unique resource keys and no empty action lists', () => {
    const keys = RESOURCES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const resource of RESOURCES) {
      expect(
        resource.actions.length,
        `${resource.key} has no actions`
      ).toBeGreaterThan(0);
      expect(new Set(resource.actions).size).toBe(resource.actions.length);
    }
  });

  it('every resource carries a plain-English label and description', () => {
    // These are rendered in the editor to a school admin, not a developer.
    for (const resource of RESOURCES) {
      expect(resource.label.trim().length).toBeGreaterThan(0);
      expect(resource.description.trim().length).toBeGreaterThan(0);
      expect(resource.label).not.toBe(resource.key);
    }
  });

  it('ALL_CAPABILITIES mirrors the resource table with no duplicates', () => {
    const expected = RESOURCES.flatMap((r) =>
      r.actions.map((a) => `${r.key}.${a}`)
    );
    expect(ALL_CAPABILITIES).toEqual(expected);
    expect(new Set(ALL_CAPABILITIES).size).toBe(ALL_CAPABILITIES.length);
  });

  it('isCapability accepts every real capability and rejects invented ones', () => {
    for (const capability of ALL_CAPABILITIES) {
      expect(isCapability(capability)).toBe(true);
    }
    // The exact failure this guards: a row in role_permissions naming something
    // no gate reads would look granted and enforce nothing.
    expect(isCapability('documents_pre_enrolment.destroy')).toBe(false);
    expect(isCapability('payroll.read')).toBe(false);
    expect(isCapability('')).toBe(false);
  });

  it('can() is a plain membership test and tolerates an absent list', () => {
    expect(can(['sections.read'], 'sections.read')).toBe(true);
    expect(can(['sections.read'], 'sections.delete')).toBe(false);
    expect(can(undefined, 'sections.read')).toBe(false);
    expect(can([], 'sections.read')).toBe(false);
  });
});

describe('DEFAULT_ROLE_CAPABILITIES', () => {
  it('covers every role exactly once and invents no capabilities', () => {
    expect(Object.keys(DEFAULT_ROLE_CAPABILITIES).sort()).toEqual(
      [...ROLES].sort()
    );
    for (const role of ROLES) {
      const caps = DEFAULT_ROLE_CAPABILITIES[role];
      expect(new Set(caps).size, `${role} lists a capability twice`).toBe(
        caps.length
      );
      for (const capability of caps) {
        expect(
          isCapability(capability),
          `${role} holds unknown ${capability}`
        ).toBe(true);
      }
    }
  });

  it('grants a parent (null role) nothing', () => {
    // Parents are deliberately role-less; `can` is reached through
    // getCapabilitiesForRole(null) => [].
    expect(can([], 'documents_pre_enrolment.read')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The real proof: defaults vs the live gates.
// ─────────────────────────────────────────────────────────────────────────────

describe('parity with the gates these capabilities replace', () => {
  const DOC_ROUTE =
    'app/api/sis/students/[enroleeNumber]/document/[slotKey]/route.ts';

  it('every migrated capability still has its original holder set', () => {
    for (const [capability, roles] of Object.entries(PRE_MIGRATION_GATES)) {
      const expected = DELIBERATE_WIDENINGS[capability as Capability];
      expect(
        holdersOf(capability as Capability),
        expected
          ? `holders of ${capability} no longer match its recorded widening`
          : `holders of ${capability} changed — if this was intentional, add it to DELIBERATE_WIDENINGS with a reason rather than editing PRE_MIGRATION_GATES`
      ).toEqual([...(expected ?? roles)].sort());
    }
  });

  it('document validation still turns on the enrolment line, not on a role', () => {
    const text = source(DOC_ROUTE);
    // The rule survived the migration: enrolment state picks the capability.
    expect(text).toMatch(/isStudentEnrolled\(ayCode, enroleeNumber\)/);
    expect(text).toMatch(
      /enrolled\s*\n?\s*\?\s*'documents_post_enrolment\.validate'/
    );
    expect(text).toMatch(/:\s*'documents_pre_enrolment\.validate'/);
    // And it no longer branches on who you are.
    expect(text).not.toMatch(/auth\.role === '/);

    // Who validates each side is now a data decision (migration 106 moved it
    // off the academic coordinator), so this no longer pins the holder sets —
    // DELIBERATE_WIDENINGS does that. What must remain true is the STRUCTURE:
    // both sides are held by somebody, and the pre/post split still exists
    // rather than having collapsed into one undifferentiated permission.
    const pre = holdersOf('documents_pre_enrolment.validate');
    const post = holdersOf('documents_post_enrolment.validate');
    expect(pre.length).toBeGreaterThan(0);
    expect(post.length).toBeGreaterThan(0);
    // `admissions` must never hold the post-enrolment side and `p_file_officer`
    // is the only role whose pre-enrolment grant was a deliberate crossing —
    // KD #147's module ownership, which this reassignment does not reverse.
    expect(post).not.toContain('admissions');
  });

  it('school_admin now validates documents on both sides', () => {
    // REVERSES the original assertion, deliberately. She was read-and-chase
    // only (KD #74 + KD #31) while the queue still rendered her Approve/Reject
    // buttons that 403'd on click — a real bug. Mr Ace granted her validation
    // directly in role_permissions and confirmed it was intended (2026-07-31,
    // migration 106), which fixes that bug by making the buttons work.
    for (const capability of [
      'documents_pre_enrolment.read',
      'documents_pre_enrolment.chase',
      'documents_pre_enrolment.validate',
      'documents_post_enrolment.read',
      'documents_post_enrolment.chase',
      'documents_post_enrolment.upload',
      'documents_post_enrolment.validate',
    ] as const) {
      expect(holdersOf(capability), capability).toContain('school_admin');
    }
  });

  it('the academic coordinator holds no document capability at all', () => {
    // The other half of the same reassignment — she is out of document work
    // entirely, not merely reduced. A capability creeping back here would mean
    // the swap had been partially undone without anyone deciding to.
    for (const capability of ALL_CAPABILITIES.filter((c) =>
      c.startsWith('documents_')
    )) {
      expect(
        holdersOf(capability),
        `academic_coordinator regained ${capability}`
      ).not.toContain('academic_coordinator');
    }
  });

  it('the migrated files ask for the capabilities we think they ask for', () => {
    for (const { file, capabilities } of MIGRATED_SITES) {
      const text = source(file);
      for (const capability of capabilities) {
        expect(text, `${file} no longer references ${capability}`).toContain(
          `'${capability}'`
        );
      }
      // No belt-and-braces role gate left beside the capability gate: two
      // sources of truth on one route is how they drift.
      expect(text, `${file} still calls requireRole`).not.toMatch(
        /requireRole\(/
      );
    }
  });

  it('the routes left on requireRole still are, and for a stated reason', () => {
    // Each of these has a role set that no capability matches. Pinning them
    // stops a future sweep from "finishing the job" by flattening a real
    // distinction — every one would either widen or narrow access.
    for (const { file, why } of DELIBERATELY_NOT_MIGRATED) {
      expect(
        source(file),
        `${file} no longer calls requireRole — ${why}`
      ).toMatch(/requireRole\(/);
    }
  });

  it('the read-only queue component defaults to no actions', () => {
    // A caller that forgets the prop must render a read-only table, not
    // buttons — the same fail-safe direction KD #163 chose for row actions.
    const text = source(
      'components/admissions/document-validation/validation-queue.tsx'
    );
    expect(text).toMatch(/canValidate = false/);
    expect(text).toMatch(/\.\.\.\(canValidate/);
  });

  it('decide.ts gates approval on the capability, and the pool is unchanged', () => {
    // Phase 5 replaced `actingUser.role !== 'school_admin'` here with a check on
    // grade_changes.approve. The holder set is deliberately identical, so no
    // behaviour moved — what moved is that the pool can now be changed from
    // /sis/admin/roles instead of by editing this file, the eligible-candidates
    // query and the approver-assignment route together.
    const text = source('lib/change-requests/decide.ts');
    expect(text).toContain("can(capabilities, 'grade_changes.approve')");
    expect(text, 'decide.ts still hardcodes a role for approval').not.toMatch(
      /actingUser\.role !== '[a-z_]+'/
    );

    expect(holdersOf('grade_changes.approve')).toEqual(['school_admin']);

    // Pinned deliberately: a superadmin decides WHO may approve
    // (/sis/admin/approvers) and does not approve. If a future change grants
    // this, it must be a decision, not a tidy-up.
    expect(holdersOf('grade_changes.approve')).not.toContain('superadmin');
  });

  it('the eligible-approver pool and the decision read the same capability', () => {
    // Three files used to hardcode 'school_admin' independently. If they ever
    // disagree, a superadmin can assign an approver whose every decision 403s.
    for (const file of [
      'lib/sis/approvers/queries.ts',
      'app/api/sis/admin/approvers/route.ts',
      'app/(markbook)/markbook/change-requests/page.tsx',
    ]) {
      expect(source(file), `${file} lost its capability check`).toContain(
        'grade_changes.approve'
      );
    }
  });

  it('the officer now validates both sides of enrolment', () => {
    // This test used to assert the OPPOSITE — that the seed must not grant it,
    // because at the time it had to stay a data edit so applying migration 101
    // changed no access. That constraint belonged to 101. The edit was since
    // made in production and confirmed intentional, so migration 106 writes it
    // into the seed and the code stops disagreeing with the database.
    //
    // This is the case the whole capability layer exists for: one person
    // validating documents on both sides of enrolment, which a single role
    // could never express (KD #166).
    for (const capability of [
      'documents_pre_enrolment.read',
      'documents_pre_enrolment.chase',
      'documents_pre_enrolment.validate',
      'documents_post_enrolment.validate',
    ] as const) {
      expect(DEFAULT_ROLE_CAPABILITIES.p_file_officer, capability).toContain(
        capability
      );
    }
  });
});

/**
 * Every migration that seeds role_permissions. A new group added later needs its
 * own migration (101 is already applied to production and must not be edited),
 * so this list grows — and the parity assertion below is over the UNION, which
 * is what the table actually ends up holding.
 */
const SEED_MIGRATIONS = [
  'supabase/migrations/101_role_permissions.sql',
  'supabase/migrations/102_role_permissions_subjects.sql',
  // Unlike 101 and 102, this one is a real widening rather than a
  // transcription — the academic coordinator gaining Subject Weights and AY
  // Setup (2026-07-31). The parity assertion below is over the union, so it
  // holds regardless.
  'supabase/migrations/105_role_permissions_coordinator_sis.sql',
  // The first to REVOKE — document validation moves off the academic
  // coordinator onto the P-Files officer and school_admin. Order matters from
  // here on: the replay below applies these in sequence, so a later file can
  // undo an earlier one.
  'supabase/migrations/106_role_permissions_document_reassignment.sql',
];

/** `('role', 'capability')` tuples inside one SQL statement block. */
function tuplesIn(block: string): string[] {
  return [...block.matchAll(/\(\s*'([a-z_]+)'\s*,\s*'([a-z_.]+)'\s*\)/g)].map(
    ([, role, capability]) => `${role}|${capability}`
  );
}

/**
 * Replays the seed migrations in order and returns the grant set a database
 * would actually end up holding.
 *
 * This models inserts AND deletes rather than unioning every insert, because
 * migration 106 is the first to REVOKE a grant (document validation moving off
 * the academic coordinator). A union would still contain the revoked rows and
 * report drift that doesn't exist — worse, it would go on passing if someone
 * later re-added a capability that was deliberately taken away.
 */
function replaySeedMigrations(): Set<string> {
  const held = new Set<string>();
  for (const file of SEED_MIGRATIONS) {
    const sql = source(file);
    for (const statement of sql.split(';')) {
      if (statement.includes('insert into public.role_permissions')) {
        for (const t of tuplesIn(statement)) held.add(t);
      } else if (statement.includes('delete from public.role_permissions')) {
        for (const t of tuplesIn(statement)) held.delete(t);
      }
    }
  }
  return held;
}

describe('the seed migrations', () => {
  it('together match DEFAULT_ROLE_CAPABILITIES exactly', () => {
    const seeded = replaySeedMigrations();

    expect(seeded.size, 'no seed rows found at all').toBeGreaterThan(0);

    const expected = ROLES.flatMap((role) =>
      DEFAULT_ROLE_CAPABILITIES[role].map((c) => `${role}|${c}`)
    );

    expect([...seeded].sort()).toEqual([...expected].sort());
  });

  it('actually revokes — a delete statement is honoured, not ignored', () => {
    // Guards the replay itself. If the delete parsing silently stopped
    // matching, the assertion above would still pass (the union and the replay
    // agree on every migration that only inserts), and a revoked capability
    // would quietly come back on the next database rebuild.
    const withDeletes = replaySeedMigrations();
    const insertsOnly = new Set(
      SEED_MIGRATIONS.flatMap((file) =>
        source(file)
          .split(';')
          .filter((s) => s.includes('insert into public.role_permissions'))
          .flatMap(tuplesIn)
      )
    );
    expect(
      insertsOnly.size,
      'no seed migration deletes anything — if that is now true, this test and the replay comment are stale'
    ).toBeGreaterThan(withDeletes.size);
  });

  it('is idempotent and denies the cookie client every operation', () => {
    const sql = source('supabase/migrations/101_role_permissions.sql');
    expect(sql).toMatch(/on conflict \(role, capability\) do nothing/);
    // This table decides authorization: a readable copy leaks the whole model,
    // a writable one is privilege escalation.
    for (const op of ['select', 'insert', 'update', 'delete']) {
      expect(sql).toMatch(new RegExp(`role_permissions_no_${op}`));
    }
    expect(sql).toMatch(/enable row level security/);
  });
});
