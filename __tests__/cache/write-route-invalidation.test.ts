import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

// EVERY WRITE ROUTE EITHER BUSTS A CACHE TAG OR SAYS WHY IT DOES NOT.
//
// ── why this test, and not a list in a document ───────────────────────────
//
// A stale-surface audit was written by hand on 2026-08-14 ("14 write routes
// invalidate nothing, change-requests/act first"). By 2026-08-27 it was wrong
// in three separate ways, and every one of them was the kind of wrong a
// document cannot notice:
//
//   * `change-requests/act` had invalidated since 2026-06-05 — it DELEGATES to
//     `lib/change-requests/decide.ts`, which calls `invalidateDrillTags`, and
//     the audit had grepped route files only. It was the headline item and it
//     was never true.
//   * Six routes on the list are `410 Gone` tombstones that write nothing.
//     They were named as the highest-probability real hits.
//   * Eleven routes had been added since and nobody had looked at them.
//
// So the list lives here, where re-running it is free and drifting fails the
// build. Each entry carries a REASON, because "no invalidation needed" and
// "nobody has checked" look identical in a bare allowlist — which is exactly
// how the last one rotted.

/** A write route that legitimately busts nothing, and why. */
const NO_INVALIDATION_NEEDED: Record<string, string> = {
  // ── delegate: the bust happens one module down ──────────────────────────
  'app/api/change-requests/act/route.ts':
    'delegates to lib/change-requests/decide.ts, which calls invalidateDrillTags. ' +
    'A route-file grep cannot see this — it is why the 2026-08-14 audit named ' +
    'this route as its headline example of a gap that did not exist.',
  'app/api/change-requests/[id]/route.ts':
    'same delegation to lib/change-requests/decide.ts.',

  // ── not writes at all, despite exporting a write verb ───────────────────
  'app/api/compute/quarterly/route.ts':
    'POST computes and returns; it persists nothing (Hard Rule #2 — the client ' +
    'sends raw scores and receives a computed grade).',
  'app/api/grading-sheets/bulk-create/preview/route.ts':
    'POST previews what a bulk create WOULD do. Nothing is written.',
  'app/api/sis/students/raw-columns/route.ts':
    'POST is a read with a body — the column list is too long for a query string.',

  // ── tombstones: the feature was removed, the route answers 410 ──────────
  'app/api/evaluation/checklist-items/route.ts':
    '410 Gone — PTC checklist removed, tables dormant (KD #114).',
  'app/api/evaluation/checklist-items/[id]/route.ts':
    '410 Gone — PTC checklist removed (KD #114).',
  'app/api/evaluation/checklist-responses/route.ts':
    '410 Gone — PTC checklist removed (KD #114).',
  'app/api/evaluation/ptc-feedback/route.ts':
    '410 Gone — PTC feedback removed (KD #114).',
  'app/api/evaluation/subject-comments/route.ts':
    '410 Gone — evaluation subject comments dormant (KD #114).',
  'app/api/evaluation/terms/[termId]/config/route.ts':
    '410 Gone — per-term evaluation config removed (KD #110).',

  // ── writes whose data no cached loader reads ────────────────────────────
  'app/api/classroom/[sectionId]/notes/route.ts':
    'writes classroom_notes. No unstable_cache module reads that table — the ' +
    'Classroom page loads it per request.',
  'app/api/sis/admin/subjects/[configId]/report-map/route.ts':
    'writes subject_report_map. No cached reader; the report card resolves the ' +
    'mapping when it renders.',
  'app/api/sis/admin/approvers/route.ts':
    'writes approver_assignments. lib/sis/approvers/queries.ts is uncached.',
  'app/api/sis/admin/approvers/[id]/route.ts':
    'same — approver config is read uncached.',
  'app/api/sis/admin/approval-stages/route.ts':
    'writes approval_stages. lib/approvals/config.ts is uncached, deliberately: ' +
    'these are read by the queue and the readiness strip, both per request.',
  'app/api/sis/admin/approval-stages/[id]/route.ts': 'same — uncached config.',
  'app/api/sis/admin/approval-stage-approvers/route.ts':
    'same — uncached config.',
  'app/api/sis/admin/approval-stage-approvers/[id]/route.ts':
    'same — uncached config.',

  // ── writes whose surfaces are all per-request ───────────────────────────
  'app/api/parent/v2/declarations/route.ts':
    'creates a PENDING filing. Nothing cached reads pending filings — the staff ' +
    'queue is service-role per request, and the attendance sheet only reads ' +
    'APPROVED ones, which the decide route busts when it approves them.',
  'app/api/parent/v2/declarations/evidence/route.ts':
    'uploads a file to storage and returns its path. No table is read from a ' +
    'cache as a result.',

  // ── genuinely open, and named rather than hidden ────────────────────────
  'app/api/grading-sheets/[id]/labels/route.ts':
    'OPEN — writes grading_sheets.slot labels, which cached markbook modules do ' +
    'read. Left alone in this pass because the labels are slot METADATA (KD #99) ' +
    'and no dashboard is known to render them; confirm on a real sheet before ' +
    'adding a bust, rather than widening the blast radius on a guess.',
  'app/api/sections/[id]/schedule/route.ts':
    'OPEN — writes the schedule columns on sections, a table 18 cached modules ' +
    'read. Every one of them reads name/level, not the schedule, so this is ' +
    'very likely fine; it needs one look at the section index before anybody ' +
    'busts sis:${ay} on a timetable edit.',
  'app/api/sis/admin/users/[id]/route.ts':
    'OPEN — the sibling POST busts `teacher-emails`, and this PATCH/DELETE does ' +
    'not, which is a real asymmetry: renaming or removing a staff account leaves ' +
    'the cached teacher-email list stale. Deliberately not fixed blind — the ' +
    'account routes touch auth.users and deserve their own pass.',
};

function writeRoutes(): string[] {
  const out = execFileSync('git', ['ls-files', 'app/api/**/route.ts'], {
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .filter(Boolean)
    .filter((f) =>
      /export\s+(async\s+)?function\s+(POST|PATCH|PUT|DELETE)\b/.test(
        readFileSync(f, 'utf8')
      )
    );
}

const INVALIDATES =
  /revalidateTag|revalidatePath|invalidateDrillTags|invalidateAllOperationalDrills/;

describe('write routes keep their surfaces fresh', () => {
  const routes = writeRoutes();

  it('finds the write routes', () => {
    // A rename of the route convention would otherwise silently empty this.
    expect(routes.length).toBeGreaterThan(50);
  });

  it('every write route invalidates, or is on the list with a reason', () => {
    const unaccounted = routes.filter(
      (f) =>
        !INVALIDATES.test(readFileSync(f, 'utf8')) &&
        !(f.replace(/\\/g, '/') in NO_INVALIDATION_NEEDED)
    );
    expect(
      unaccounted,
      'These write but bust no cache tag. Either add the bust, or add the ' +
        'route to NO_INVALIDATION_NEEDED with the reason it is safe. "It ' +
        'probably does not matter" is not a reason — say which cached module ' +
        'reads the table, or that none does.'
    ).toEqual([]);
  });

  it('has no stale entries', () => {
    // A route that has since gained a bust, or been deleted, must leave the
    // list — otherwise the list slowly becomes a record of what used to be
    // true, which is what happened to the document this replaces.
    const paths = new Set(routes.map((f) => f.replace(/\\/g, '/')));
    const stale = Object.keys(NO_INVALIDATION_NEEDED).filter((f) => {
      if (!paths.has(f)) return true;
      return INVALIDATES.test(readFileSync(f, 'utf8'));
    });
    expect(
      stale,
      'These are on the exemption list but either no longer exist, are no ' +
        'longer write routes, or now invalidate. Remove them.'
    ).toEqual([]);
  });
});

describe('AY-scoped cache tags are keyed by ay_code', () => {
  // ⚠ THE BUG THIS PINS. `lib/markbook/overview-data.ts` tagged its entry
  // `markbook:${academicYearId}` — a uuid — while every invalidator passes an
  // ay_code (`invalidateDrillTags(module, ayCode)`). `markbook:AY2026` never
  // matched `markbook:<uuid>`, so that entry was NEVER busted by anything and
  // only ever expired on its TTL. One character of difference, invisible in
  // review, and no test could have caught it because both sides compile.
  it('no tag template interpolates an id', () => {
    const files = execFileSync('git', ['ls-files', 'lib/**/*.ts'], {
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);

    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const m of source.matchAll(/tags:\s*\[([^\]]*)\]/g)) {
        for (const tag of m[1].matchAll(/`[^`]*\$\{([^}]+)\}[^`]*`/g)) {
          const expr = tag[1].trim();
          // `ayCode`, `input.ayCode`, `currentAy` are all fine. Anything
          // ending in `Id`/`_id` is the uuid mistake.
          if (/(^|\.)\w*(Id|_id)$/.test(expr)) {
            offenders.push(`${file}: tags include \${${expr}}`);
          }
        }
      }
    }
    expect(
      offenders,
      'A cache tag built from a uuid can never be busted: every invalidator ' +
        'passes an ay_code. Key the tag on the code.'
    ).toEqual([]);
  });
});
