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
      // ⚠ THE SHAPE THIS TEST ORIGINALLY MISSED. `tags: tag(academicYearId)`
      // is a CALL expression, not an array literal — the regex above never
      // sees it, which is exactly why lib/markbook/dashboard.ts's uuid bug
      // survived this test until 706c3904 fixed it by hand.
      // __tests__/cache/ay-tags-are-codes.test.ts is the runtime guard for
      // the general case; this is the cheap static half — flag a call-form
      // `tags: fn(arg, ...)` whenever an argument NAME looks like a raw id.
      for (const m of source.matchAll(/tags:\s*\w+\(([^)]*)\)/g)) {
        for (const rawArg of m[1].split(',')) {
          const arg = rawArg.trim();
          if (arg && /(^|\.)\w*(Id|_id)$/.test(arg)) {
            offenders.push(`${file}: tags call passes ${arg}`);
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

describe('every AY-scoped tag is one invalidateDrillTags() can actually produce', () => {
  // ⚠ A SECOND, SIBLING FAILURE MODE — same root cause (a tag that nothing
  // ever emits), opposite shape. The test above catches a tag built from a
  // uuid; this one catches a tag that is perfectly code-shaped but simply
  // isn't one of the strings `invalidateDrillTags()` (lib/cache/
  // invalidate-drill-tags.ts) ever produces — e.g. a bare `'markbook'`
  // riding alongside a correct `` `markbook:${ayCode}` `` in the same
  // `tags: [...]` array. lib/markbook/overview-data.ts carries a comment
  // naming exactly this case: "The bare 'markbook' tag saved it from being
  // unreachable, not from being wrong: nothing busts that either."
  //
  // A tag only enters this check when it appears BESIDE a genuine AY-coded
  // tag (a template literal containing `:${...}`) in the same
  // `unstable_cache()` call — that is what marks the whole tag set as
  // "this cache entry is meant to be busted per-AY", which is the only
  // context where "is this producible" is even a meaningful question.

  // Bare tags found riding alongside a correct AY-coded tag, that
  // `invalidateDrillTags()` itself never emits (MODULE_TAGS in
  // lib/cache/invalidate-drill-tags.ts only ever emits the colon-scoped
  // tag(s) per module — never a bare module name). NONE of these are
  // silently wrong the way the uuid bug was: `grep -rn "revalidateTag("
  // app lib` has zero bare-module-name call sites, so in every case here
  // the AY-coded sibling in the same array is what actually keeps the
  // cache fresh, and the bare tag is inert dead weight rather than a
  // load-bearing mistake. Found 2026-08-29 while building the runtime
  // guard for the uuid bug class; deliberately NOT fixed here — deciding
  // per-tag whether to delete the bare tag or start emitting it is a
  // separate task, and this allowlist exists so a NEW instance of the
  // pattern still fails the build instead of blending in with these.
  const ALLOWED_UNPRODUCED_BARE_TAGS = new Set<string>([
    'markbook',
    'markbook-drill',
    'attendance-dashboard',
    'attendance-drill',
    'evaluation-dashboard',
    'evaluation-drill',
    'admissions-dashboard',
    'admissions-drill',
    'p-files-dashboard',
    'p-files-drill',
    'records-drill',
    'sis',
  ]);

  function producibleColonPrefixes(): string[] {
    const source = readFileSync('lib/cache/invalidate-drill-tags.ts', 'utf8');
    const prefixes: string[] = [];
    for (const m of source.matchAll(/`([^`$]*)\$\{[^}]+\}([^`]*)`/g)) {
      if (m[1]) prefixes.push(m[1]);
    }
    return prefixes;
  }

  function findMatchingParen(s: string, openIdx: number): number {
    let depth = 0;
    for (let i = openIdx; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  function extractQuoted(text: string): string[] {
    return [...text.matchAll(/(`[^`]*`|'[^']*'|"[^"]*")/g)].map((m) => m[1]);
  }

  /** Resolves a same-file helper's returned tag array (e.g. `tag(ayCode)`)
   * by finding its declaration and taking the first array literal in its
   * body. Good enough for this codebase's small pure tag() formatters —
   * anything with branching logic simply resolves to no tags, which surfaces
   * as "0 sites found" rather than a wrong guess. */
  function resolveHelperTags(source: string, name: string): string[] {
    const funcMatch = new RegExp(`function\\s+${name}\\s*\\(`).exec(source);
    const arrowMatch = new RegExp(
      `const\\s+${name}\\s*=\\s*(?:async\\s*)?\\(`
    ).exec(source);
    let bodyStart = -1;
    if (funcMatch) {
      const po = funcMatch.index + funcMatch[0].length - 1;
      const pc = findMatchingParen(source, po);
      const brace = source.indexOf('{', pc + 1);
      if (brace !== -1) bodyStart = brace + 1;
    } else if (arrowMatch) {
      const po = arrowMatch.index + arrowMatch[0].length - 1;
      const pc = findMatchingParen(source, po);
      const arrow = source.indexOf('=>', pc + 1);
      if (arrow !== -1) {
        let i = arrow + 2;
        while (i < source.length && /\s/.test(source[i])) i++;
        bodyStart = source[i] === '{' ? i + 1 : i;
      }
    }
    if (bodyStart === -1) return [];
    const arrMatch = /\[([\s\S]*?)\]/.exec(
      source.slice(bodyStart, bodyStart + 800)
    );
    return arrMatch ? extractQuoted(arrMatch[1]) : [];
  }

  it('every tag beside an AY-coded tag is producible, or is an allowed dead one', () => {
    const prefixes = producibleColonPrefixes();
    const files = execFileSync('git', ['ls-files', 'lib/**/*.ts'], {
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);

    const offenders: string[] = [];
    const seenAllowed = new Set<string>();
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const marker = 'unstable_cache(';
      let at = source.indexOf(marker);
      while (at !== -1) {
        const openParen = at + 'unstable_cache'.length;
        const closeParen = findMatchingParen(source, openParen);
        if (closeParen === -1) break;
        const callText = source.slice(openParen, closeParen + 1);

        const direct = /tags\s*:\s*\[([\s\S]*?)\]/.exec(callText);
        let tags: string[] = [];
        if (direct) {
          tags = extractQuoted(direct[1]);
        } else {
          const helperCall = /tags\s*:\s*(\w+)\s*\(/.exec(callText);
          if (helperCall) tags = resolveHelperTags(source, helperCall[1]);
        }

        const hasAyColonTag = tags.some(
          (t) => t.startsWith('`') && /:\$\{/.test(t)
        );
        if (hasAyColonTag) {
          for (const t of tags) {
            if (t.startsWith('`')) {
              const body = t.slice(1, -1);
              const idx = body.indexOf('${');
              const prefix = idx > 0 ? body.slice(0, idx) : '';
              if (
                prefix.includes(':') &&
                !prefixes.some((p) => prefix.startsWith(p))
              ) {
                offenders.push(
                  `${file}: tag ${t} — prefix "${prefix}" is not produced by invalidateDrillTags()`
                );
              }
            } else {
              const bare = t.slice(1, -1);
              if (ALLOWED_UNPRODUCED_BARE_TAGS.has(bare)) {
                seenAllowed.add(bare);
              } else {
                offenders.push(
                  `${file}: tag ${t} — never emitted by invalidateDrillTags(), and not on the allowlist`
                );
              }
            }
          }
        }

        at = source.indexOf(marker, at + marker.length);
      }
    }

    expect(
      offenders,
      'Every tag riding alongside an AY-coded tag in the same ' +
        'unstable_cache() call must be one invalidateDrillTags() can ' +
        'actually emit, or be named in ALLOWED_UNPRODUCED_BARE_TAGS with a ' +
        'reason. A tag nothing ever emits will never be busted by a write.'
    ).toEqual([]);

    // If the allowlist grows stale (a bare tag was removed from lib/), catch
    // it here rather than let the list silently outlive what it describes.
    const stale = [...ALLOWED_UNPRODUCED_BARE_TAGS].filter(
      (t) => !seenAllowed.has(t)
    );
    expect(
      stale,
      'These allowed bare tags were not found anywhere in lib/ — remove them.'
    ).toEqual([]);
  });
});
