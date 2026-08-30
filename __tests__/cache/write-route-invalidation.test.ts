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

/**
 * Every file in this app that can hold an `unstable_cache()` call — `lib` AND
 * all of `app`, `.ts` and `.tsx`.
 *
 * ⚠ WHY `app` IS IN HERE, AND WHY ALL THREE TAG GUARDS BELOW SHARE ONE WALK.
 * All three were written walking `lib/**\/*.ts` only, on the assumption that
 * cached loaders live in `lib`. They do not: `app/(sis)/sis/page.tsx` holds two
 * `unstable_cache()` calls today. Both are correct — they carry
 * `` `sis:${ayCode}` `` — so nothing was broken, but a page-level loader with a
 * uuid tag, an unproducible sibling, or a lone bare tag would have walked past
 * all three guards untouched.
 *
 * This is the SAME too-narrow-walk gap the pagination guard had, widened in
 * a8cc7069 for the same reason and stated the same way there: a server
 * component is not an API route but reads the database exactly like one. It
 * found a live defect on its first pass.
 *
 * `app` subsumes `app/api`, so it is listed once — concatenating both would
 * double every hit and make the stale-entry checks meaningless. `producedBareTags()`
 * has always walked this exact set; the guards now agree with it, which they
 * must, or a tag counted as emitted by one scan is invisible to another.
 */
function cacheSourceFiles(): string[] {
  return execFileSync(
    'git',
    ['ls-files', 'app/**/*.ts', 'app/**/*.tsx', 'lib/**/*.ts', 'lib/**/*.tsx'],
    { encoding: 'utf8' }
  )
    .split('\n')
    .filter(Boolean);
}

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
    'writes subject_report_map. The table has exactly two readers app-wide and ' +
    'neither holds a tag: listSubjectReportMap (lib/sis/subjects/queries.ts) is ' +
    'uncached, and build-report-card.ts reads it through getSubjectReportMap, ' +
    'which is React cache() — request-scoped, so it is gone before the next ' +
    'request and revalidateTag has nothing to bust. A staff member who edits a ' +
    'mapping sees it on their next page load.',
  // The two `approvers` routes sat here reading "writes approver_assignments.
  // lib/sis/approvers/queries.ts is uncached." That reader is indeed uncached,
  // but naming it was not the same as checking every reader: `getSystemHealth`
  // (lib/sis/health.ts) counts the same table into the /sis readiness strip
  // from inside an `unstable_cache`. Both routes now emit 'sis-health', so
  // they invalidate and no longer belong on this list. A reason that names one
  // reader is only as good as the search behind it.
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
    // `lib` + all of `app` — see cacheSourceFiles(). The bug this pins lived in
    // lib/, but nothing about it is confined there: a page-level loader can
    // interpolate a uuid exactly as easily.
    const files = cacheSourceFiles();

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

// ── shared source scanners ────────────────────────────────────────────────
// These three lived inside the describe below until 2026-08-29, when a second
// guard (the lone-bare-tag one at the bottom of this file) needed the same
// walk over an `unstable_cache()` call. They are hoisted rather than copied:
// the two guards must agree on what counts as a tag, or a site can fall
// through the gap between two slightly-different parsers — which is the exact
// failure this file exists to prevent.

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

  it('every tag beside an AY-coded tag is producible, or is an allowed dead one', () => {
    const prefixes = producibleColonPrefixes();
    // `lib` + all of `app` — see cacheSourceFiles(). app/(sis)/sis/page.tsx's
    // two cached loaders land in THIS guard (both carry an AY-coded tag), which
    // is the concrete proof the old lib-only walk was short.
    const files = cacheSourceFiles();

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
      'These allowed bare tags were not found anywhere in app/ or lib/ — ' +
        'remove them.'
    ).toEqual([]);
  });
});

describe('a lone bare cache tag is one some write actually emits', () => {
  // ⚠ THE HOLE IN THE GUARD ABOVE, AND THE TEN LOADERS THAT FELL THROUGH IT.
  //
  // The sibling guard above is gated on `hasAyColonTag`: it only ever inspects
  // a `tags:` array that ALREADY contains an AY-coded tag. For those sites its
  // allowlist's stated reason — "the AY-coded sibling in the same array is
  // what actually keeps the cache fresh" — is TRUE. That guard is correct as
  // written and is deliberately left exactly as it is.
  //
  // The defect is what the gate never reaches. A LONE bare tag — one with no
  // AY-coded sibling in the same `unstable_cache()` call — was not examined at
  // all, by that guard or any other. That is precisely the shape of the ten
  // loaders found on 2026-08-29 that no write in this app had ever
  // invalidated: five SIS range charts tagged `['sis']`, `loadTerms` tagged
  // `['dashboard-windows']`, `getLevelRows` tagged `['levels']`, and three
  // `audit_log` activity feeds. Every one of them served stale data until its
  // TTL expired, and the only bare-literal emitter that existed app-wide was
  // `revalidateTag('teacher-emails')`. A guard written for this bug class did
  // not catch this bug class, because it only looked where the bug wasn't.
  //
  // So this one asks the complementary question, of every bare string tag on
  // an `unstable_cache()` call in app/ or lib/ that has no AY-coded sibling:
  // does any `revalidateTag('<tag>')` in app/ or lib/ actually emit it? If not,
  // the tag is inert — it must be named below with the reason that is
  // acceptable.
  //
  // ⚠ It shipped walking lib/ ONLY, which is the same too-narrow walk this
  // whole file keeps re-learning: it asked "does anything emit this tag" of a
  // strictly smaller set of tags than the set it had emitters for, since
  // `producedBareTags()` below has always read app/ as well. Widened
  // 2026-08-30 — see cacheSourceFiles() at the top for what app/ actually
  // holds and why the two sibling guards were widened with it.

  /**
   * Keyed on `file|loader|tag` — per CALL SITE, not per tag, and that is
   * load-bearing. Three of the five SIS charts fixed on 2026-08-29 live in
   * lib/sis/dashboard.ts, the same file as two exempt activity feeds, so a
   * `file|tag` key would let a regression on any of them (or a brand-new
   * lone-bare-`'sis'` loader in that file) match the feeds' exemption and
   * pass. Verified by reverting one of the five and watching this fail.
   * The loader is the first argument to `unstable_cache()`, unwrapped
   * through an arrow if there is one — a name that survives edits above it,
   * unlike a line number.
   */
  const INERT_BARE_TAGS: Record<string, string> = {
    // ── config with no write path, so nothing can emit the tag ────────────
    'lib/sis/levels.ts|getLevelRowsUncached|levels':
      'No application write path exists and there cannot be one: /sis/admin/' +
      'levels and its three API routes were removed wholesale by migration ' +
      '086 (KD #153, SUPERSEDED note), and the catalogue is a fixed 10 rows, ' +
      'P1–P6 and S1–S4, changed only by migration. The 60s TTL covers a ' +
      'deploy. The tag stays as the hook to hang an emitter on if a CRUD ' +
      'page ever returns. Same reason is written at the site.',

    // ── audit_log feeds: a working tag would fire on every request ────────
    'lib/sis/dashboard.ts|loadRecentSisActivityUncached|sis':
      'Reads audit_log, which has no AY column, so there is no AY to scope a ' +
      'real tag to — and because every write in the app appends an audit ' +
      'row, a working tag would bust this on essentially every request, ' +
      'turning a cache into pure overhead. The 120s TTL is the freshness ' +
      'contract. A decision taken 2026-08-29, not an oversight; the same ' +
      'reason is written at the site.',
    'lib/sis/dashboard.ts|loadStructuralChangeFeedUncached|sis':
      'The second of the same three audit_log feeds — same decision, same ' +
      'date, same 120s freshness contract.',
    'lib/markbook/dashboard.ts|loadRecentMarkbookActivityUncached|markbook':
      'loadRecentMarkbookActivity — the third of the same three feeds, same ' +
      'decision on the same date, same 120s freshness contract. audit_log ' +
      'has no AY column and every write appends to it.',

    // ── found by THIS guard on its first run, and named rather than hidden ─
    // The Phase 1 brief enumerated ten loaders. It missed these two, which
    // carried four lone bare tags between them — which is the point of writing
    // the check as a scanner rather than as a list. Both were triaged on
    // 2026-08-29: getSystemHealth was FIXED (see the note where its two
    // entries used to be, below), and getActivityByActor is exempt.
    'lib/sis/dashboard.ts|loadActorActivity|sis-dashboard':
      'getActivityByActor — a FOURTH audit_log feed, alongside the three ' +
      'above. Triaged 2026-08-29 and exempt for their reason exactly: it ' +
      'reads audit_log via loadActorActivity (lib/sis/drill.ts) and nothing ' +
      'else, that table has no AY column to scope a real tag to, and every ' +
      'write in the app appends a row to it — so a working tag would bust ' +
      'this on essentially every request. The 60s TTL is the freshness ' +
      'contract. A decision, not an oversight; same reason at the site.',
    'lib/sis/dashboard.ts|loadActorActivity|audit-log':
      'The second tag on that same getActivityByActor call, settled with it ' +
      'on 2026-08-29. This is the tag that most looks like it ought to ' +
      'exist for this table and most must not: emitting `audit-log` would ' +
      'name the busiest write path in the app. Left unemitted on purpose.',
    // `lib/sis/health.ts|loadSystemHealthUncached` held two OPEN entries here
    // and now holds none: getSystemHealth was the one of the four found by
    // this guard that could go MEANINGFULLY stale, so it was fixed rather than
    // exempted. It now carries a single dedicated 'sis-health' tag, emitted by
    // all five writes of the `academic_years` and `approver_assignments` data
    // it reads, so it is produced and this scan no longer reaches it. The bare
    // 'sis' and 'markbook' tags it used to carry were deleted — both were
    // inert, and 'sis' in particular must never start being emitted, because
    // the two activity feeds exempted above would be busted as collateral.
  };

  /** The loader an `unstable_cache()` call wraps — its first argument, seen
   * through an arrow wrapper if there is one (`() => getLevelRowsUncached(x)`
   * identifies as `getLevelRowsUncached`). This is the call site's identity
   * in INERT_BARE_TAGS. An inline anonymous body resolves to '', which
   * degrades the key to file+tag rather than throwing — no such site exists
   * in lib/ today. */
  function cachedLoaderName(callText: string): string {
    const inner = callText.slice(1);
    const arrow = /^\s*(?:async\s+)?(?:\([^)]*\)|\w+)\s*=>\s*/.exec(inner);
    const rest = arrow ? inner.slice(arrow[0].length) : inner;
    const ident = /^\s*(\w+)/.exec(rest);
    return ident ? ident[1] : '';
  }

  /** Comments quote `revalidateTag('levels')` in at least two files that emit
   * nothing. Counting those as emitters would mark the real gaps as covered —
   * which is the exact failure this test exists to catch — so comments come
   * out before the scan. The `[^:]` guard keeps `https://` intact. */
  function stripComments(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  }

  /** `PERMISSIONS_CACHE_TAG` is the only constant-form `revalidateTag`
   * argument in the app today. Resolved from source rather than hardcoded so
   * a rename fails here instead of silently shrinking the produced set. A
   * general identifier resolver would be more machinery than one call site
   * is worth — if a second constant appears, add it beside this one. */
  function permissionsCacheTag(): string {
    const src = readFileSync('lib/auth/permission-map.ts', 'utf8');
    const exported =
      /export\s+const\s+PERMISSIONS_CACHE_TAG\s*=\s*([^;]+);/.exec(src);
    const rhs = exported?.[1].trim() ?? '';
    if (/^['"`]/.test(rhs)) return rhs.slice(1, -1);
    if (!/^\w+$/.test(rhs)) return '';
    const alias = new RegExp(
      `const\\s+${rhs}\\s*=\\s*('[^']*'|"[^"]*"|\`[^\`]*\`)`
    ).exec(src);
    return alias ? alias[1].slice(1, -1) : '';
  }

  /** Every bare-string tag some write path can actually emit. */
  function producedBareTags(): Set<string> {
    // The same walk the tag guards use — this scan defined it first, and the
    // guards were widened to match rather than the other way round.
    const files = cacheSourceFiles();

    const produced = new Set<string>();
    const permissionsTag = permissionsCacheTag();
    for (const file of files) {
      const source = stripComments(readFileSync(file, 'utf8'));
      for (const m of source.matchAll(/revalidateTag\(\s*('[^']*'|"[^"]*")/g)) {
        produced.add(m[1].slice(1, -1));
      }
      if (
        permissionsTag &&
        /revalidateTag\(\s*PERMISSIONS_CACHE_TAG\b/.test(source)
      ) {
        produced.add(permissionsTag);
      }
    }
    return produced;
  }

  it('finds the emitters', () => {
    // If the scan ever returns nothing, every tag below looks unproduced and
    // the failure message points at the wrong thing entirely.
    const produced = producedBareTags();
    expect([...produced].sort()).toContain('teacher-emails');
    expect(produced.size).toBeGreaterThan(1);
  });

  it('every lone bare tag is emitted by a write, or is named as inert', () => {
    const produced = producedBareTags();
    // `lib` + all of `app` — see cacheSourceFiles(). This walk read `lib` only
    // while the emitter scan below it already read `app` too, so the guard was
    // asking "does anything emit this" of a strictly smaller set of tags than
    // it had answers for.
    const files = cacheSourceFiles();

    const offenders: string[] = [];
    const seenInert = new Set<string>();

    for (const file of files) {
      const path = file.replace(/\\/g, '/');
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

        // The guard above owns every call carrying an AY-coded tag. This one
        // owns the complement — the calls that guard never looks at. Between
        // the two, and now that both walk the same file set, every tag in app/
        // and lib/ is examined by exactly one of them.
        const hasAyColonTag = tags.some(
          (t) => t.startsWith('`') && /:\$\{/.test(t)
        );
        if (!hasAyColonTag) {
          for (const t of tags) {
            // An interpolated tag with no `:${}` cannot be resolved
            // statically; a plain backtick tag is just a bare tag in
            // different quotes.
            if (t.startsWith('`') && t.includes('${')) continue;
            const bare = t.slice(1, -1);
            if (produced.has(bare)) continue;
            const loader = cachedLoaderName(callText);
            const key = `${path}|${loader}|${bare}`;
            if (key in INERT_BARE_TAGS) {
              seenInert.add(key);
              continue;
            }
            offenders.push(
              `${path}: ${loader || '(anonymous)'} is tagged '${bare}', which ` +
                `nothing emits — there is no revalidateTag('${bare}') anywhere ` +
                'in app/ or lib/, and no AY-coded sibling in the same ' +
                'unstable_cache() call to keep the entry fresh'
            );
          }
        }

        at = source.indexOf(marker, at + marker.length);
      }
    }

    expect(
      offenders,
      'These cache entries can never be busted by a write — they will serve ' +
        'stale data until their TTL expires, which is how ten loaders sat ' +
        'uninvalidated until 2026-08-29. Either emit the tag from the write ' +
        'paths that change the data, scope the entry with an AY-coded tag ' +
        'the invalidators already produce, or add it to INERT_BARE_TAGS with ' +
        'the reason staleness is acceptable here. "Nobody has checked" is ' +
        'not a reason.'
    ).toEqual([]);

    // Same stale-entry rule the guard above carries: an exemption that no
    // longer matches a real site is a record of what used to be true.
    const stale = Object.keys(INERT_BARE_TAGS).filter((k) => !seenInert.has(k));
    expect(
      stale,
      'These are named as inert-on-purpose but no longer match a lone bare ' +
        'tag in app/ or lib/ — the loader was removed, its tag changed, or ' +
        'something now emits it. Remove them.'
    ).toEqual([]);
  });
});
