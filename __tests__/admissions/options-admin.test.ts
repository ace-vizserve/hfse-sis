/**
 * Phase 3 of the admission-options work: the admin page's grouping, the
 * level-name rule every create / edit applies, the write payloads, the audit
 * lines — and the one invariant nothing else enforces, that every write route
 * busts the `admission-options:<ay>` tag the public endpoint is cached under.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  describeNameReach,
  groupOptionsForAdmin,
  nameReachByLabel,
  levelAliasConflictMessage,
  planCountsAsChange,
  planLevelAlias,
  type AdminOptionInput,
} from '@/lib/admissions/options';
import { auditActionLabel, auditContextSummary } from '@/lib/audit/humanize';
import {
  AdmissionOptionCopySchema,
  AdmissionOptionCreateSchema,
  AdmissionOptionGroupEditSchema,
} from '@/lib/schemas/admission-options';
import { canonicalizeLevelLabel } from '@/lib/sis/levels';

describe('every write route busts the endpoint cache', () => {
  // `__tests__/cache/write-route-invalidation.test.ts` accepts ANY bust, so a
  // route that busted `sis:<ay>` would pass it while the public endpoint kept
  // serving a closed session for its whole TTL. This pins the right tag.
  const routes = execFileSync(
    'git',
    [
      'ls-files',
      '--others',
      '--cached',
      '--exclude-standard',
      'app/api/sis/admission-options',
    ],
    { encoding: 'utf8' }
  )
    .split('\n')
    .map((f) => f.trim())
    .filter((f) => f.endsWith('/route.ts'));

  it('finds the five write routes', () => {
    expect(routes.sort()).toEqual([
      'app/api/sis/admission-options/[id]/route.ts',
      'app/api/sis/admission-options/bulk/route.ts',
      'app/api/sis/admission-options/copy/route.ts',
      'app/api/sis/admission-options/group/route.ts',
      'app/api/sis/admission-options/route.ts',
    ]);
  });

  it.each(routes)('%s calls revalidateTag(admissionOptionsTag(…))', (file) => {
    expect(readFileSync(file, 'utf8')).toMatch(
      /revalidateTag\(admissionOptionsTag\(/
    );
  });

  it.each(routes)('%s gates on ENROLMENT_PLACEMENT_WRITERS', (file) => {
    expect(readFileSync(file, 'utf8')).toMatch(
      /requireRole\(\[\.\.\.ENROLMENT_PLACEMENT_WRITERS\]\)/
    );
  });
});

describe('planLevelAlias', () => {
  const P1 = { id: 'p1', label: 'Primary One' };
  const P2 = { id: 'p2', label: 'Primary Two' };
  const levels = [P1, P2];
  const iep =
    'HFSE International Education Programme – Year 2 (equivalent to Primary One)';

  it('writes nothing when the name is the level’s own label', () => {
    expect(planLevelAlias('Primary One', 'p1', levels, [])).toEqual({
      kind: 'none',
    });
  });

  it('refuses a level’s own label pointed at a different level', () => {
    expect(planLevelAlias('Primary One', 'p2', levels, [])).toEqual({
      kind: 'conflict',
      levelId: 'p1',
      levelLabel: 'Primary One',
    });
  });

  it('reads the legacy digit spelling the way the resolver does', () => {
    expect(
      planLevelAlias('Primary 1', 'p1', levels, [], canonicalizeLevelLabel)
    ).toEqual({ kind: 'none' });
    expect(
      planLevelAlias('Primary 1', 'p2', levels, [], canonicalizeLevelLabel).kind
    ).toBe('conflict');
  });

  it('inserts a new name', () => {
    expect(planLevelAlias(iep, 'p1', levels, [])).toEqual({ kind: 'insert' });
  });

  it('writes nothing when the name is already aliased to the same level', () => {
    expect(
      planLevelAlias(iep, 'p1', levels, [{ raw_label: iep, level_id: 'p1' }])
    ).toEqual({ kind: 'none' });
  });

  it('refuses a name already aliased to a different level, naming it', () => {
    expect(
      planLevelAlias(iep, 'p2', levels, [{ raw_label: iep, level_id: 'p1' }])
    ).toEqual({ kind: 'conflict', levelId: 'p1', levelLabel: 'Primary One' });
  });

  it('matches on the trimmed name', () => {
    expect(planLevelAlias('  Primary One ', 'p1', levels, [])).toEqual({
      kind: 'none',
    });
  });

  it('says which level the name already means, in plain English', () => {
    const msg = levelAliasConflictMessage(iep, 'Primary One', 'Primary Two');
    expect(msg).toContain('already counts as Primary One');
    expect(msg).toContain("can't also count as Primary Two");
    expect(msg).not.toMatch(/alias|uuid|level_id/i);
  });
});

describe('planCountsAsChange — same name, new "Counts as"', () => {
  const P1 = { id: 'p1', label: 'Primary One' };
  const P2 = { id: 'p2', label: 'Primary Two' };
  const levels = [P1, P2];
  const name = 'Year 2 (equivalent to Primary One)';
  const aliasedToP2 = [{ raw_label: name, level_id: 'p2' }];

  it("refuses a level's own name, saying that it IS the level's name", () => {
    const plan = planCountsAsChange({
      label: 'Primary Two',
      newLevelId: 'p1',
      levels,
      aliases: [],
      rows: [{ id: 'a', level_id: 'p2', ayCode: 'AY2027' }],
    });
    expect(plan.kind).toBe('refuse');
    if (plan.kind !== 'refuse') return;
    expect(plan.message).toContain("is the SIS's own name for Primary Two");
  });

  it('refuses the legacy digit spelling of a level name the same way', () => {
    expect(
      planCountsAsChange({
        label: 'Primary 2',
        newLevelId: 'p1',
        levels,
        aliases: [],
        rows: [],
        canonicalize: canonicalizeLevelLabel,
      }).kind
    ).toBe('refuse');
  });

  it('single use: moves the one option and re-points the alias', () => {
    expect(
      planCountsAsChange({
        label: name,
        newLevelId: 'p1',
        levels,
        aliases: aliasedToP2,
        rows: [{ id: 'a', level_id: 'p2', ayCode: 'AY2027' }],
      })
    ).toEqual({
      kind: 'recount',
      alias: { fromLevelId: 'p2', fromLevelLabel: 'Primary Two' },
      updateIds: ['a'],
      revert: [{ levelId: 'p2', ids: ['a'] }],
      touchedAyCodes: ['AY2027'],
    });
  });

  it('multi-year: moves every option with the name, in every year and class type', () => {
    const plan = planCountsAsChange({
      label: name,
      newLevelId: 'p1',
      levels,
      aliases: aliasedToP2,
      rows: [
        { id: 'a', level_id: 'p2', ayCode: 'AY2027' },
        { id: 'b', level_id: 'p2', ayCode: 'AY2027' },
        { id: 'c', level_id: 'p2', ayCode: 'AY2026' },
        // Already on the new level — nothing to move, nothing to revert.
        { id: 'd', level_id: 'p1', ayCode: 'AY2025' },
      ],
    });
    expect(plan.kind).toBe('recount');
    if (plan.kind !== 'recount') return;
    expect(plan.updateIds).toEqual(['a', 'b', 'c']);
    expect(plan.touchedAyCodes).toEqual(['AY2026', 'AY2027']);
  });

  it('revert puts each row back on the level IT held, not one shared level', () => {
    // A name whose rows disagree (a half-finished earlier edit) must not be
    // "reverted" onto a level some of them never had.
    const plan = planCountsAsChange({
      label: name,
      newLevelId: 'p1',
      levels: [...levels, { id: 'p3', label: 'Primary Three' }],
      aliases: aliasedToP2,
      rows: [
        { id: 'a', level_id: 'p2', ayCode: 'AY2027' },
        { id: 'b', level_id: 'p3', ayCode: 'AY2026' },
        { id: 'c', level_id: 'p2', ayCode: 'AY2026' },
      ],
    });
    if (plan.kind !== 'recount') throw new Error(plan.message);
    expect(plan.revert).toEqual([
      { levelId: 'p2', ids: ['a', 'c'] },
      { levelId: 'p3', ids: ['b'] },
    ]);
  });

  it('records a fresh alias when the name was never aliased', () => {
    const plan = planCountsAsChange({
      label: name,
      newLevelId: 'p1',
      levels,
      aliases: [],
      rows: [{ id: 'a', level_id: 'p2', ayCode: 'AY2027' }],
    });
    expect(plan.kind === 'recount' && plan.alias).toBe('insert');
  });

  it('says how far the change reaches, in plain English', () => {
    const reach = nameReachByLabel([
      { ayCode: 'AY2027', levelLabel: name, classTypeLabel: 'Standard Class' },
      { ayCode: 'AY2027', levelLabel: name, classTypeLabel: 'Standard Class' },
      { ayCode: 'AY2027', levelLabel: name, classTypeLabel: 'Global Class' },
      { ayCode: 'AY2026', levelLabel: name, classTypeLabel: 'Standard Class' },
      { ayCode: 'AY2026', levelLabel: name, classTypeLabel: 'Global Class' },
      {
        ayCode: 'AY2026',
        levelLabel: 'Primary One',
        classTypeLabel: 'Standard Class',
      },
    ]);
    expect(reach[name]).toEqual({ options: 4, ayCodes: ['AY2026', 'AY2027'] });
    expect(describeNameReach(reach[name], 'Primary One')).toContain(
      'This name is used by 4 options across AY2026 and AY2027. All of them will count as Primary One.'
    );
    expect(describeNameReach(reach['Primary One'], 'Primary Two')).toContain(
      'only used by this option'
    );
  });
});

describe('groupOptionsForAdmin', () => {
  const levels = [
    { id: 'p2', code: 'P2', label: 'Primary Two', sortOrder: 20 },
    { id: 'p1', code: 'P1', label: 'Primary One', sortOrder: 10 },
    { id: 'p3', code: 'P3', label: 'Primary Three', sortOrder: 30 },
  ];
  const row = (
    id: string,
    level_id: string,
    level_label: string,
    class_type_label: string,
    schedule: AdminOptionInput['schedule'],
    sort_order: number,
    is_open = true
  ): AdminOptionInput => ({
    id,
    level_id,
    level_label,
    class_type_label,
    track: class_type_label.includes('Global') ? 'Global' : 'Standard',
    schedule,
    is_open,
    sort_order,
  });

  const rows = [
    row('a', 'p2', 'Primary Two', 'Standard Class', 'afternoon', 40),
    row('b', 'p2', 'Primary Two', 'Standard Class', 'morning', 30, false),
    row(
      'c',
      'p1',
      'Year 2 (equivalent to Primary One)',
      'Global Class',
      'whole_day',
      20
    ),
    row('d', 'p1', 'Primary One', 'Standard Class', 'morning', 10),
  ];
  const groups = groupOptionsForAdmin(rows, levels);

  it('orders groups by level sort_order and skips levels with no rows', () => {
    expect(groups.map((g) => g.levelCode)).toEqual(['P1', 'P2']);
  });

  it('puts every parent-facing name under the level it counts as', () => {
    expect(groups[0].combos.map((c) => c.levelLabel)).toEqual([
      'Primary One',
      'Year 2 (equivalent to Primary One)',
    ]);
  });

  it('orders sessions Morning, Afternoon, Whole day whatever the row order', () => {
    expect(groups[1].combos).toHaveLength(1);
    expect(groups[1].combos[0].sessions).toEqual([
      { id: 'b', schedule: 'morning', isOpen: false },
      { id: 'a', schedule: 'afternoon', isOpen: true },
    ]);
  });
});

describe('write payloads', () => {
  const base = {
    ayCode: 'ay2027',
    levelLabel: '  Primary Three ',
    levelId: '6f1c1a8e-4b6e-4d8a-9a53-0d3c0c0c0c0c',
    classTypeLabel: 'Standard Class',
    track: 'Standard',
  };

  it('normalises the year and trims labels', () => {
    const parsed = AdmissionOptionCreateSchema.parse({
      ...base,
      schedules: ['afternoon', 'morning'],
    });
    expect(parsed.ayCode).toBe('AY2027');
    expect(parsed.levelLabel).toBe('Primary Three');
    // Stored in the canonical order, whatever order the boxes were ticked in.
    expect(parsed.schedules).toEqual(['morning', 'afternoon']);
  });

  it('needs at least one session to add an option', () => {
    expect(
      AdmissionOptionCreateSchema.safeParse({ ...base, schedules: [] }).success
    ).toBe(false);
  });

  it('refuses a third track', () => {
    expect(
      AdmissionOptionGroupEditSchema.safeParse({
        ...base,
        fromLevelLabel: 'Primary Three',
        fromClassTypeLabel: 'Standard Class',
        track: 'Cambridge',
      }).success
    ).toBe(false);
  });

  it('refuses copying a year onto itself', () => {
    expect(
      AdmissionOptionCopySchema.safeParse({ fromAy: 'AY2026', toAy: 'ay2026' })
        .success
    ).toBe(false);
  });
});

describe('audit lines', () => {
  it('labels every action in plain English', () => {
    expect(auditActionLabel('admission_option.close')).toBe(
      'Enrolment form session closed'
    );
    expect(auditActionLabel('admission_option.copy')).toBe(
      'Enrolment form options copied'
    );
  });

  it('reads a close the way the toast does', () => {
    expect(
      auditContextSummary('admission_option.close', {
        ay_code: 'AY2027',
        level_label: 'Primary Three',
        class_type_label: 'Standard Class',
        schedule: 'morning',
        schedule_label: 'Morning',
        before: true,
        after: false,
      })
    ).toContain('Morning closed for Primary Three — Standard Class');
  });

  it('names a rename and a re-pointed level on an edit', () => {
    const out = auditContextSummary('admission_option.update', {
      ay_code: 'AY2027',
      from_level_label: 'Year 8',
      from_class_type_label: 'Global Class',
      level_label: 'Year 8 (equivalent to Secondary One)',
      class_type_label: 'Global Class',
      counts_as_label: 'Secondary One',
      previous_counts_as_label: 'Secondary One',
      track: 'Global',
      previous_track: 'Global',
    });
    expect(out).toContain(
      'Year 8 — Global Class → Year 8 (equivalent to Secondary One) — Global Class'
    );
    expect(out).not.toContain('counts as');
  });

  it('counts a copy', () => {
    expect(
      auditContextSummary('admission_option.copy', {
        from_ay: 'AY2026',
        to_ay: 'AY2027',
        copied: 61,
        copied_open: 50,
      })
    ).toContain('AY2026 → AY2027');
  });
});
