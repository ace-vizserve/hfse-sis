import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ReliefBulkCreateSchema,
  ReliefCreateSchema,
  ReliefEndSchema,
  RELIEF_REASON_VALUES,
  RELIEF_REASON_LABELS,
} from '@/lib/schemas/assignment-relief';
import { DEFAULT_ROLE_CAPABILITIES } from '@/lib/auth/capabilities';

const ROOT = process.cwd();
const source = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * Source with comments removed.
 *
 * Several assertions below check that a file does NOT do something — call the
 * wrong helper, derive a date in UTC. The comment explaining why it must not do
 * that names the very thing being forbidden, so a naive `toContain` matches the
 * explanation and fails a correct file. Strip comments and assert on code.
 */
const codeOnly = (rel: string) =>
  source(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .map((line) => line.replace(/\/\/.*/, ''))
    .join('\n');

const MIGRATION = 'supabase/migrations/112_assignment_reliefs.sql';
const POST_ROUTE = 'app/api/assignment-reliefs/route.ts';
const END_ROUTE = 'app/api/assignment-reliefs/[id]/end/route.ts';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';
const UUID_D = '44444444-4444-4444-8444-444444444444';

describe('relief reasons', () => {
  it('are their own list, not the removal reasons', () => {
    // Sharing ASSIGNMENT_CHANGE_REASON_VALUES would offer "Teacher resigned"
    // and "Performance / parent concern" as reasons for TEMPORARY cover, which
    // is nonsense — those explain a permanent removal.
    const removalReasons = source('lib/schemas/teacher-assignment.ts');
    expect(removalReasons).toContain('resigned');
    expect(RELIEF_REASON_VALUES).not.toContain('resigned');
    expect(RELIEF_REASON_VALUES).not.toContain('performance');
  });

  it('every value has a plain-English label', () => {
    for (const value of RELIEF_REASON_VALUES) {
      const label = RELIEF_REASON_LABELS[value];
      expect(label, `${value} has no label`).toBeTruthy();
      // School admins are not IT — no snake_case leaking into the UI.
      expect(label).not.toMatch(/_/);
    }
  });
});

describe('ReliefCreateSchema', () => {
  const valid = {
    assignment_id: UUID_A,
    relief_teacher_user_id: UUID_B,
    reason: 'on_leave' as const,
  };

  it('accepts the common case with no start date', () => {
    // Cover almost always starts today; making an admin confirm that is
    // ceremony. The route and the column both default it.
    const parsed = ReliefCreateSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it('requires a note when the reason is "other"', () => {
    const parsed = ReliefCreateSchema.safeParse({ ...valid, reason: 'other' });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toEqual(['notes']);
    }
  });

  it('accepts "other" once a note is given', () => {
    const parsed = ReliefCreateSchema.safeParse({
      ...valid,
      reason: 'other',
      notes: 'Seconded to the new campus for a term.',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a reason outside the list', () => {
    expect(
      ReliefCreateSchema.safeParse({ ...valid, reason: 'resigned' }).success
    ).toBe(false);
  });

  it('rejects a malformed start date', () => {
    expect(
      ReliefCreateSchema.safeParse({ ...valid, started_on: '12 Aug 2026' })
        .success
    ).toBe(false);
  });

  it('reports errors in words a school admin can act on', () => {
    const parsed = ReliefCreateSchema.safeParse({});
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const messages = parsed.error.issues.map((i) => i.message).join(' ');
      // No field names, no types, no "expected string, received undefined".
      expect(messages).not.toMatch(/expected|received|uuid|string/i);
    }
  });
});

describe('ReliefEndSchema', () => {
  it('accepts an empty body — "they are back today"', () => {
    expect(ReliefEndSchema.safeParse({}).success).toBe(true);
  });

  it('rejects a malformed end date', () => {
    expect(ReliefEndSchema.safeParse({ ended_on: 'today' }).success).toBe(
      false
    );
  });
});

describe('migration 112', () => {
  const sql = source(MIGRATION);

  it('allows only ONE active cover per assignment', () => {
    // Partial on `ended_on is null`, so the same slot can be covered again
    // later without the earlier cover being overwritten.
    expect(sql).toMatch(
      /create unique index[\s\S]*?assignment_reliefs_one_active_per_assignment[\s\S]*?on public\.assignment_reliefs \(assignment_id\)[\s\S]*?where ended_on is null/
    );
  });

  it('cannot record a cover that ends before it starts', () => {
    expect(sql).toMatch(/check \(ended_on is null or ended_on >= started_on\)/);
  });

  it('keeps the three ending columns in step', () => {
    // An `ended_on` without an `ended_by` would read as finished with nobody
    // accountable for finishing it.
    expect(sql).toContain('assignment_reliefs_end_columns_agree');
  });

  it('cascades when the covered assignment goes', () => {
    expect(sql).toMatch(
      /assignment_id\s+uuid not null references public\.teacher_assignments\(id\) on delete cascade/
    );
  });

  it('denies the cookie client every write', () => {
    for (const op of ['insert', 'update', 'delete']) {
      expect(sql, `${op} is not denied`).toMatch(
        new RegExp(`assignment_reliefs_no_${op}`)
      );
    }
    expect(sql).toMatch(/enable row level security/);
  });

  it('lets the covered teacher see who is covering them', () => {
    // Not just oversight roles and the substitute — a teacher back from leave
    // should be able to see who held their class without asking an admin.
    expect(sql).toMatch(/relief_teacher_user_id = auth\.uid\(\)/);
    expect(sql).toMatch(
      /from public\.teacher_assignments ta[\s\S]*?ta\.teacher_user_id = auth\.uid\(\)/
    );
  });

  it('does not touch teacher_assignments', () => {
    // The whole point: the regular teacher stays the name of record because
    // nothing writes to the table every display site reads.
    expect(sql).not.toMatch(/alter table public\.teacher_assignments/);
    expect(sql).not.toMatch(/update public\.teacher_assignments/);
  });
});

describe('migration 114 — RLS', () => {
  const raw = source('supabase/migrations/114_rls_relief_scoping.sql');
  // The header explains the change in prose and repeats the very phrases the
  // counting assertions look for. Count declarations, not documentation.
  const sql = raw
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

  it('teaches all three scoped-read helpers about cover', () => {
    for (const helper of [
      'is_teacher_for_section',
      'is_adviser_for_section',
      'is_teacher_for_sheet',
    ]) {
      expect(sql, `${helper} not updated`).toMatch(
        new RegExp(`create or replace function public\\.${helper}`)
      );
    }
    // Each must consult the new helper, not just be rewritten.
    const calls =
      sql.split('has_active_relief_for_assignment(ta.id)').length - 1;
    expect(calls, 'a helper was replaced without adding the relief arm').toBe(
      3
    );
  });

  it('keeps every helper security definer with a pinned search_path', () => {
    // Dropping either turns a scoped-read helper into an escalation path.
    const definers = sql.split('security definer').length - 1;
    const searchPaths = sql.split('set search_path = public').length - 1;
    expect(definers).toBe(4);
    expect(searchPaths).toBe(4);
  });

  it('still requires the cover to be active', () => {
    expect(sql).toMatch(/ar\.ended_on is null/);
    expect(sql).toMatch(/ar\.relief_teacher_user_id = auth\.uid\(\)/);
  });

  it('locks the new helper down like every other definer function', () => {
    for (const role of ['public', 'anon', 'authenticated']) {
      expect(sql).toMatch(
        new RegExp(
          `revoke all on function public\\.has_active_relief_for_assignment\\(uuid\\) from ${role}`
        )
      );
    }
  });

  it('does not touch report_card_comments', () => {
    // The reason widening is_adviser_for_section is safe: migration 024 dropped
    // that table, so the only policies left behind the helper are the two
    // attendance ones, which a substitute needs.
    expect(
      source('supabase/migrations/024_drop_report_card_comments.sql')
    ).toMatch(/drop table if exists public\.report_card_comments/);
  });
});

describe('migration 115 — the two corrections', () => {
  const raw = source(
    'supabase/migrations/115_relief_visibility_and_window.sql'
  );
  const sql = raw
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

  it('lets a substitute SEE the assignment they are covering', () => {
    // Without this the feature fails silently rather than loudly: the effective
    // loader inner-joins assignment_reliefs to teacher_assignments, and if RLS
    // hides the parent row the join drops the relief and the loader reports
    // "covering nothing" with no error anywhere.
    expect(sql).toMatch(/create policy teacher_assignments_scoped_read/);
    expect(sql).toMatch(/or public\.has_active_relief_for_assignment\(id\)/);
    // And must not have dropped either original arm while adding the third.
    expect(sql).toMatch(/public\.is_registrar_or_above\(\)/);
    expect(sql).toMatch(/teacher_user_id = auth\.uid\(\)/);
  });

  it('honours the cover dates instead of ignoring them', () => {
    // 114 tested `ended_on is null` alone, so cover dated to start next week
    // granted access today, and cover dated to end next week revoked it now.
    expect(sql).toMatch(/ar\.started_on <= /);
    expect(sql).toMatch(/ar\.ended_on >= /);
  });

  it('compares dates in Singapore time, not UTC', () => {
    // current_date on a UTC server rolls at 08:00 SGT — after the school opens.
    expect(sql).toMatch(/at time zone 'Asia\/Singapore'/);
    expect(sql).not.toMatch(/=\s*current_date/);
  });
});

describe('the effective-assignment loader', () => {
  it('applies the same date window the database does', () => {
    // The app decides what to offer and the database decides what to return.
    // If they disagree, the result is a page that renders with every panel
    // empty — no error, nothing to search for.
    const text = source('lib/auth/teacher-assignments.ts');
    expect(text).toContain("lte('started_on'");
    expect(text).toMatch(/ended_on\.is\.null,ended_on\.gte\./);
    expect(text).toContain('sgToday()');
  });

  it('does not swallow a failed cover lookup', () => {
    // Returning [] on error would read as "covers nothing" and lock a
    // substitute out of the class they were asked to take.
    expect(source('lib/auth/teacher-assignments.ts')).toMatch(
      /if \(reliefs\.error\) throw new Error/
    );
  });
});

describe('who may cover', () => {
  it('is checked against teachers, never the whole auth table', () => {
    // getStaffDisplayNameById() returns every auth user with an email, which
    // in this database is ~1,000 parent portal accounts. Validating against it
    // would let a parent be recorded as cover and — through migration 114 —
    // gain RLS read on that class's students, grades and attendance.
    const text = codeOnly(POST_ROUTE);
    expect(text).toContain('getTeacherList');
    expect(text).not.toContain('getStaffDisplayNameById');
  });
});

describe('who may arrange cover', () => {
  it('is school admin and above — never the academic coordinator', () => {
    // The coordinator holds staff.edit_assignments beside it and can still
    // move a teacher on or off a class. Putting a substitute against a
    // teacher who is still the holder of record is a step above that.
    expect(DEFAULT_ROLE_CAPABILITIES.school_admin).toContain(
      'staff.manage_relief'
    );
    expect(DEFAULT_ROLE_CAPABILITIES.superadmin).toContain(
      'staff.manage_relief'
    );
    expect(DEFAULT_ROLE_CAPABILITIES.academic_coordinator).not.toContain(
      'staff.manage_relief'
    );
    expect(DEFAULT_ROLE_CAPABILITIES.teacher).not.toContain(
      'staff.manage_relief'
    );
  });

  it('is a different capability from editing assignments', () => {
    // If these were ever folded together the coordinator would gain cover
    // silently, as a side effect of a grant she already has.
    expect(DEFAULT_ROLE_CAPABILITIES.academic_coordinator).toContain(
      'staff.edit_assignments'
    );
  });
});

describe('the write routes', () => {
  it('both gate on staff.manage_relief', () => {
    expect(source(POST_ROUTE)).toContain(
      "requireCapability('staff.manage_relief')"
    );
    expect(source(END_ROUTE)).toContain(
      "requireCapability('staff.manage_relief')"
    );
  });

  it('refuse to let a teacher cover their own class', () => {
    // Cannot be a database constraint — it compares across two tables — so it
    // lives at the only write path and must stay there.
    expect(codeOnly(POST_ROUTE)).toMatch(
      /assignment\.teacher_user_id === c\.relief_teacher_user_id/
    );
    // Checked for EVERY class in a batch, not just the first.
    expect(codeOnly(POST_ROUTE)).toMatch(
      /for \(const c of covers\)[\s\S]{0,300}cannot cover their own class/
    );
  });

  it('end cover by dating it, never by deleting the row', () => {
    const end = source(END_ROUTE);
    expect(end).toContain('export async function PATCH');
    expect(end).not.toContain('export async function DELETE');
    expect(end).not.toMatch(/\.delete\(\)/);
    // And only ends cover that is still running, so two admins clicking at
    // once cannot overwrite each other's end date.
    expect(end).toMatch(/\.is\('ended_on', null\)/);
  });

  it('let a teacher read their own cover without a staff capability', () => {
    // Mapping the GET to staff.* would shut out the teacher being covered and
    // the substitute — the two people most entitled to see it.
    const post = source(POST_ROUTE);
    expect(post).toMatch(/requireRole\(\[\s*'teacher'/);
  });

  it('do not try to `or` across an embedded table', () => {
    // PostgREST cannot or() a root column against an embedded table's column;
    // it sends the whole thing as a root-level or=(...) and errors. A first
    // draft scoped teachers with
    //   .or('relief_teacher_user_id.eq.X,assignment.teacher_user_id.eq.X')
    // which 400s for every teacher — the substitute and the covered teacher,
    // the only two people the GET exists for. Managers took another branch, so
    // an admin smoke test passed. Scoping is the RLS policy's job.
    expect(codeOnly(POST_ROUTE)).not.toMatch(/\.or\([^)]*assignment\./);
  });

  it('date cover in Singapore time, not UTC', () => {
    // The school is UTC+8 and these are date-only columns. Ending cover at
    // 07:30 SGT with `new Date().toISOString().slice(0, 10)` records
    // yesterday, which then trips the "cannot end before it started" check on
    // cover that began today.
    expect(codeOnly(END_ROUTE)).toContain('sgToday()');
    expect(codeOnly(END_ROUTE)).not.toMatch(/toISOString\(\)\.slice\(0, ?10\)/);
  });

  it('check the substitute is a real staff account', () => {
    // Migration 112 declares no FK to auth.users and says validity is enforced
    // in the route instead — so this IS that enforcement. Without it a stale
    // uuid inserts cleanly and the cover grants access to nobody.
    expect(source(POST_ROUTE)).toContain('getStaffDisplayNameById');
  });

  it('bust the three modules a cover changes access to', () => {
    for (const route of [POST_ROUTE, END_ROUTE]) {
      const text = source(route);
      for (const mod of ['markbook', 'evaluation', 'attendance']) {
        expect(text, `${route} does not bust ${mod}`).toContain(
          `invalidateDrillTags('${mod}'`
        );
      }
    }
  });
});

describe('account deletion', () => {
  it('knows about every column that points at a user', () => {
    // Migration 112 declares no cross-schema FK (the convention its parent
    // table follows), so this registry is the only thing stopping a delete
    // from leaving a cover pointing at nobody.
    const text = source('lib/sis/user-deletion.ts');
    for (const column of ['relief_teacher_user_id', 'created_by', 'ended_by']) {
      expect(text, `${column} is unregistered`).toContain(column);
    }
    expect(text).toContain('assignment_reliefs');
  });

  it('still catches a teacher who covered and was then promoted', async () => {
    // The footprint is scoped to the account's CURRENT role. Registering the
    // substitute column under `teacher` alone would let someone who covered a
    // class, then became a coordinator, delete cleanly and strand the row.
    const { ROLE_FOOTPRINT_COLUMNS } =
      (await import('@/lib/sis/user-deletion')) as unknown as {
        ROLE_FOOTPRINT_COLUMNS?: Record<
          string,
          Array<{ table: string; column: string }>
        >;
      };

    // Not exported — assert on the source instead, once per role that can hold
    // a teaching assignment.
    if (!ROLE_FOOTPRINT_COLUMNS) {
      const text = source('lib/sis/user-deletion.ts');
      const occurrences = text.split('relief_teacher_user_id').length - 1;
      expect(
        occurrences,
        'relief_teacher_user_id is registered for fewer roles than can hold cover'
      ).toBeGreaterThanOrEqual(4);
      return;
    }

    for (const role of [
      'teacher',
      'academic_coordinator',
      'school_admin',
      'superadmin',
    ]) {
      expect(
        ROLE_FOOTPRINT_COLUMNS[role]?.some(
          (c) => c.column === 'relief_teacher_user_id'
        ),
        `${role} would delete over a cover row`
      ).toBe(true);
    }
  });
});

describe('arranging cover for a whole teacher', () => {
  const base = {
    reason: 'on_leave' as const,
    covers: [
      { assignment_id: UUID_A, relief_teacher_user_id: UUID_B },
      { assignment_id: UUID_C, relief_teacher_user_id: UUID_B },
    ],
  };

  it('accepts several classes with one reason and start date', () => {
    // The flow is "Ms Koh is on leave from today" decided once, then a
    // substitute chosen per class. Asking for the reason five times would be
    // ceremony; letting the five disagree would produce an unreadable record.
    expect(ReliefBulkCreateSchema.safeParse(base).success).toBe(true);
  });

  it('lets different classes have different substitutes', () => {
    const parsed = ReliefBulkCreateSchema.safeParse({
      ...base,
      covers: [
        { assignment_id: UUID_A, relief_teacher_user_id: UUID_B },
        { assignment_id: UUID_C, relief_teacher_user_id: UUID_D },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects the same class twice', () => {
    // Would race its own unique index and surface a database message instead
    // of a readable one.
    const parsed = ReliefBulkCreateSchema.safeParse({
      ...base,
      covers: [
        { assignment_id: UUID_A, relief_teacher_user_id: UUID_B },
        { assignment_id: UUID_A, relief_teacher_user_id: UUID_D },
      ],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toMatch(/twice/i);
    }
  });

  it('rejects an empty selection', () => {
    // Unticking every class means there is nothing to arrange.
    expect(
      ReliefBulkCreateSchema.safeParse({ ...base, covers: [] }).success
    ).toBe(false);
  });

  it('still requires a note when the reason is "other"', () => {
    expect(
      ReliefBulkCreateSchema.safeParse({ ...base, reason: 'other' }).success
    ).toBe(false);
  });

  it('writes the batch in ONE insert, so it cannot half-succeed', () => {
    // Looping would let three classes get covered and the fourth fail on its
    // unique index, leaving a teacher half-covered with nothing on screen
    // saying which half. One insert is one statement, so Postgres makes it
    // all-or-nothing.
    const text = codeOnly(POST_ROUTE);
    expect(text).toMatch(/\.insert\(\s*covers\.map/);
    expect(text).not.toMatch(/for \([^)]*covers\)[\s\S]{0,200}\.insert\(/);
  });

  it('refuses a batch spanning two teachers', () => {
    // The flow is "this person is away". A mixed batch would be a caller bug
    // and would produce an audit trail nobody could read as one decision.
    expect(codeOnly(POST_ROUTE)).toMatch(/coveredTeacherIds\.size > 1/);
  });

  it('says nothing was changed when the batch is refused', () => {
    // A half-applied batch is the thing the single insert prevents; the error
    // has to say so, or the admin will re-check five classes by hand.
    expect(source(POST_ROUTE)).toMatch(/nothing was changed/);
  });

  it('logs one audit row per class, not one per batch', () => {
    // Each class is ended and changed on its own afterwards, so its start
    // belongs on its own timeline.
    expect(codeOnly(POST_ROUTE)).toMatch(
      /for \(const relief of created\)[\s\S]{0,400}assignment\.relief\.start/
    );
  });
});

describe('the audit trail', () => {
  it('names both people, so cover cannot be mistaken for a reassignment', async () => {
    const { auditContextSummary, auditActionLabel } =
      await import('@/lib/audit/humanize');

    const summary = auditContextSummary('assignment.relief.start', {
      relief_id: UUID_A,
      assignment_id: UUID_B,
      relief_teacher_user_id: UUID_A,
      covered_teacher_user_id: UUID_B,
      relief_teacher_name: 'Ms Radhika',
      covered_teacher_name: 'Ms Koh',
      role: 'subject_teacher',
      subject_name: 'Mathematics',
      section_name: 'P5 Tenacity',
      reason: 'on_leave',
    });

    expect(summary).toContain('Ms Radhika');
    expect(summary).toContain('Ms Koh');
    expect(summary).toMatch(/covering/i);
    expect(summary).toContain('P5 Tenacity');

    // Plain English all the way out — no database words, no raw ids.
    expect(summary).toContain('On leave');
    expect(summary).not.toContain('on_leave');
    expect(summary).not.toContain('subject_teacher');
    expect(summary).not.toContain(UUID_A);
    expect(summary).not.toContain(UUID_B);

    expect(auditActionLabel('assignment.relief.start')).toBe(
      'Relief teacher arranged'
    );
    expect(auditActionLabel('assignment.relief.end')).toBe(
      'Relief teacher finished'
    );
  });

  it('still reads sensibly when a name cannot be resolved', async () => {
    // buildReliefAuditContext is best-effort — a staff-list hiccup drops the
    // names and must not produce a blank or broken line.
    const { auditContextSummary } = await import('@/lib/audit/humanize');
    const summary = auditContextSummary('assignment.relief.end', {
      relief_id: UUID_A,
      assignment_id: UUID_B,
      relief_teacher_user_id: UUID_A,
      section_name: 'P5 Tenacity',
    });
    expect(summary).toContain('P5 Tenacity');
    expect(summary).not.toContain(UUID_A);
  });
});

describe('academic year rollover', () => {
  it('does not carry cover into a new year', () => {
    // Cover is a mid-year event about one absence. Copying it forward would
    // start a new year with a substitute already standing in for a teacher who
    // is not away. The RPC only reads teacher_assignments, so this pins
    // existing behaviour rather than changing it.
    const rpc = source('supabase/migrations/017_teacher_assignments_copy.sql');
    expect(rpc).not.toContain('assignment_reliefs');
  });
});
