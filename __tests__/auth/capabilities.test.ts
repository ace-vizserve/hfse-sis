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
      expect(
        holdersOf(capability as Capability),
        `holders of ${capability} changed`
      ).toEqual([...roles].sort());
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

    // The two sides still partition the same people, with nobody gained.
    const pre = holdersOf('documents_pre_enrolment.validate');
    const post = holdersOf('documents_post_enrolment.validate');
    expect([...new Set([...pre, ...post])].sort()).toEqual([
      'academic_coordinator',
      'admissions',
      'p_file_officer',
      'superadmin',
    ]);
  });

  it('school_admin may read and chase documents but never validate them', () => {
    // Read-only oversight (KD #74 + KD #31). The write route always excluded
    // them; before Phase 2 the queue rendered them Approve/Reject buttons that
    // 403'd on click, because the component took no viewer prop at all.
    expect(holdersOf('documents_pre_enrolment.read')).toContain('school_admin');
    expect(holdersOf('documents_pre_enrolment.chase')).toContain(
      'school_admin'
    );
    expect(holdersOf('documents_pre_enrolment.validate')).not.toContain(
      'school_admin'
    );
    expect(holdersOf('documents_post_enrolment.validate')).not.toContain(
      'school_admin'
    );
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

  it('grade-change approval matches decide.ts — one role, and not superadmin', () => {
    const text = source('lib/change-requests/decide.ts');
    const match = /actingUser\.role !== '([a-z_]+)'/.exec(text);
    expect(
      match,
      'decide.ts no longer gates approval on a single role'
    ).toBeTruthy();

    expect(holdersOf('grade_changes.approve')).toEqual([match![1] as Role]);

    // Pinned deliberately. decide.ts rejects superadmin too: a superadmin
    // decides WHO may approve (/sis/admin/approvers) and does not approve. If a
    // future change grants this, it must be a decision, not a tidy-up.
    expect(holdersOf('grade_changes.approve')).not.toContain('superadmin');
  });

  it('the seed does NOT yet grant the officer pre-enrolment validation', () => {
    // This is the change HFSE asked for, and it must be a data edit in the
    // editor — not baked into the seed, or applying migration 101 would itself
    // change access.
    expect(DEFAULT_ROLE_CAPABILITIES.p_file_officer).not.toContain(
      'documents_pre_enrolment.validate'
    );
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
];

describe('the seed migrations', () => {
  it('together match DEFAULT_ROLE_CAPABILITIES exactly', () => {
    const seeded = SEED_MIGRATIONS.flatMap((file) => {
      const sql = source(file);
      const insertBlock = sql.slice(
        sql.indexOf('insert into public.role_permissions')
      );
      return [
        ...insertBlock.matchAll(/\(\s*'([a-z_]+)'\s*,\s*'([a-z_.]+)'\s*\)/g),
      ].map(([, role, capability]) => `${role}|${capability}`);
    });

    expect(
      seeded.length,
      'no seed rows found in migration 101'
    ).toBeGreaterThan(0);
    expect(new Set(seeded).size, 'migration 101 seeds a row twice').toBe(
      seeded.length
    );

    const expected = ROLES.flatMap((role) =>
      DEFAULT_ROLE_CAPABILITIES[role].map((c) => `${role}|${c}`)
    );

    expect([...seeded].sort()).toEqual([...expected].sort());
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
