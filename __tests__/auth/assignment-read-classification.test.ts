import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Relief teachers (migrations 112/113) split one question into two that used to
// have the same answer:
//
//   ACT   — "who may work on this class?"   substantive teacher + active relief
//   NAME  — "whose name goes on this?"      substantive teacher only
//
// Every read of `teacher_assignments` answers one or the other. Get it backwards
// in the ACT direction and a substitute is locked out of the class they were
// asked to cover — annoying, and obvious the first time someone tries. Get it
// backwards in the NAME direction and a report card quietly prints the wrong
// teacher's name, which nobody notices until a parent asks.
//
// So the classification is not left to reviewers noticing. Every file that reads
// assignments must appear in CLASSIFIED below. A new unclassified read fails
// this test; so does a stale entry for a file that no longer reads them. The
// list is long, and that length is the point — it is what stops the next person
// from having to rediscover which of these fifty-nine files prints a name.
//
// Categories:
//   act        must see relief-derived assignments once Phase 2 lands
//   evaluation adviser-gated but substantive-ONLY — write-ups and report card
//              comments stay with the regular adviser even while covered
//              (Mr Ace, 2026-08-11). NOTE: evaluation_writeups has no adviser
//              predicate in RLS at all (migration 018), so these five are the
//              only thing keeping a relief out. There is no database backstop.
//   name       name of record — must NEVER see relief
//   coverage   "is the post filled at all?" — a relief must NOT satisfy these,
//              or an unstaffed section would look staffed and publish
//   crud       manages assignment/relief rows themselves; not an access answer
//   plumbing   shared helper whose own callers carry the classification

type Category =
  | 'act'
  | 'evaluation'
  | 'name'
  | 'coverage'
  | 'crud'
  | 'plumbing';

const CLASSIFIED: Record<string, Category[]> = {
  // ── plumbing ────────────────────────────────────────────────────────────
  'lib/auth/teacher-assignments.ts': ['plumbing'],
  'lib/classroom/queries.ts': ['plumbing'],
  'lib/classroom/scope.ts': ['plumbing'],
  'lib/audit/assignment-context.ts': ['plumbing'],

  // ── act ─────────────────────────────────────────────────────────────────
  'lib/sidebar/resolve-hidden-modules.ts': ['act'],
  'lib/sidebar/module-visibility.ts': ['act'],
  'lib/attendance/adviser-dashboard-queries.ts': ['act'],
  'lib/markbook/dashboard.ts': ['act'],
  'app/api/grading-sheets/route.ts': ['act'],
  'app/api/grading-sheets/[id]/entries/[entryId]/route.ts': ['act'],
  'app/api/grading-sheets/[id]/labels/route.ts': ['act'],
  'app/api/change-requests/route.ts': ['act'],
  'app/api/attendance/daily/route.ts': ['act'],
  'app/api/attendance/student-summary/route.ts': ['act'],
  'app/api/markbook/drill/[target]/route.ts': ['act'],
  'app/api/classroom/[sectionId]/notes/route.ts': ['act'],
  'app/api/classroom/[sectionId]/at-risk/route.ts': ['act'],
  'app/api/classroom/[sectionId]/students/[studentNumber]/route.ts': ['act'],
  'app/(classroom)/classroom/[sectionId]/layout.tsx': ['act'],
  'app/(classroom)/classroom/[sectionId]/attendance/page.tsx': ['act'],
  'app/(classroom)/classroom/[sectionId]/grades/page.tsx': ['act'],
  'app/(classroom)/classroom/[sectionId]/students/page.tsx': ['act'],
  'app/(classroom)/classroom/[sectionId]/timeline/page.tsx': ['act'],
  'app/(classroom)/classroom/[sectionId]/settings/page.tsx': ['act'],
  'app/(attendance)/attendance/[sectionId]/summary/page.tsx': ['act'],
  'app/(markbook)/markbook/sections/page.tsx': ['act', 'name'],

  // ── evaluation (substantive only, no DB backstop) ───────────────────────
  'app/api/evaluation/writeups/route.ts': ['evaluation'],
  'app/api/evaluation/drill/[target]/route.ts': ['evaluation'],
  'lib/evaluation/queries.ts': ['evaluation'],
  'lib/evaluation/dashboard.ts': ['evaluation'],
  'app/(evaluation)/evaluation/sections/[sectionId]/page.tsx': ['evaluation'],
  'app/(classroom)/classroom/[sectionId]/write-ups/page.tsx': ['evaluation'],
  'app/(markbook)/markbook/report-cards/[studentId]/page.tsx': ['evaluation'],
  'app/(evaluation)/evaluation/sections/page.tsx': ['evaluation', 'name'],

  // ── name of record ──────────────────────────────────────────────────────
  'lib/report-card/build-report-card.ts': ['name'],
  'lib/markbook/subject-teacher.ts': ['name'],
  'lib/markbook/masterfile.ts': ['name'],
  'lib/markbook/drill.ts': ['name'],
  'lib/evaluation/drill.ts': ['name'],
  'lib/sis/staff.ts': ['name'],
  // The teacher page. Shows whose classes these are — cover is drawn on as an
  // annotation beside each one, never used to move a class onto the
  // substitute's page, because a covered class is still the regular teacher's.
  'lib/sis/teacher-detail.ts': ['name'],
  'app/api/teacher-assignments/by-teacher/route.ts': ['name'],
  'app/(sis)/sis/sections/page.tsx': ['name'],
  'app/(sis)/sis/sections/[id]/page.tsx': ['name'],
  'app/(classroom)/classroom/page.tsx': ['act', 'name'],
  'app/(attendance)/attendance/sections/page.tsx': ['act', 'name'],
  'app/(attendance)/attendance/[sectionId]/page.tsx': ['act', 'name'],
  'app/api/attendance/[sectionId]/export/route.ts': ['act', 'name'],
  'app/(markbook)/markbook/grading/[id]/page.tsx': ['act', 'name'],
  'app/(classroom)/classroom/[sectionId]/page.tsx': ['act', 'evaluation'],

  // Two queries, two answers, in one file — see the dedicated test below.
  'app/(markbook)/markbook/grading/page.tsx': ['act', 'name'],
  'lib/home/quick-actions.ts': ['act', 'evaluation'],
  'lib/home/todos.ts': ['act', 'evaluation'],

  // ── coverage ("is the post filled at all?") ─────────────────────────────
  'lib/markbook/publish-readiness.ts': ['coverage'],
  'lib/sis/dashboard.ts': ['coverage'],
  'lib/sis/readiness.ts': ['coverage'],
  // NOT listed: lib/sis/hub-attention.ts. It renders the "sections have no
  // form adviser" line but is handed the count by app/(sis)/sis/page.tsx —
  // it reads nothing itself, so the coverage decision is made there.
  'app/(sis)/sis/page.tsx': ['coverage'],

  // ── crud ────────────────────────────────────────────────────────────────
  'app/api/teacher-assignments/route.ts': ['crud'],
  'app/api/teacher-assignments/[id]/route.ts': ['crud'],
  'app/api/assignment-reliefs/route.ts': ['crud'],
  'app/api/assignment-reliefs/[id]/end/route.ts': ['crud'],

  // ── self-profile ────────────────────────────────────────────────────────
  // "Your sections" on /account — the viewer's own list, not a gate and not a
  // name on any document. Grouped with act: a substitute should see the class
  // they are covering there, tagged as cover.
  'lib/account/sections.ts': ['act'],
};

// A file counts as reading assignments if it queries the table or calls one of
// the helpers that wrap it. Kept as source patterns rather than a compiler-API
// walk because the failure this guards is "a new file reads assignments and
// nobody classified it" — which is visible at file granularity.
const READ_PATTERNS = [
  /from\(['"]teacher_assignments['"]\)/,
  /\bloadAssignmentsForUser\b/,
  /\bloadEffectiveAssignmentsForUser\b/,
  /\bisSubjectTeacher\b/,
  /\bsubjectTeacherPairs\b/,
  /\bloadClassroomAccess\b/,
  /\bresolveClassroomScope\b/,
  /\blistFormAdviserSectionIds\b/,
  /\bloadFormAdvisersBySection\b/,
  /\bbuildSubjectTeacherNameMap\b/,
  /\bbuildFormAdviserNameMap\b/,
  // Indirect but still a real act/evaluation decision: these booleans are
  // derived from assignments upstream, and a file branching on them is
  // deciding what a teacher may do just as surely as one running the query.
  // lib/home/todos.ts reaches the table no other way.
  /\bteachingProfileFor\b/,
  /\bteachesSubject\b/,
];

// Comments mention the table constantly — lib/auth/staff-list.ts and
// lib/sis/hub-attention.ts both describe it in prose without reading it, and
// counting those as readers would force fake classifications for files that
// answer nothing. Strip comments before matching. A pattern sitting after a
// `//` on a live line is commented-out code and is correctly ignored too.
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const ROOT = process.cwd();
const SEARCH_DIRS = ['lib', 'app', 'components'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function discoverReaders(): string[] {
  const found: string[] = [];
  for (const dir of SEARCH_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const text = stripComments(readFileSync(file, 'utf8'));
      if (READ_PATTERNS.some((p) => p.test(text))) {
        found.push(relative(ROOT, file).split(sep).join('/'));
      }
    }
  }
  return found.sort();
}

const source = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('every read of teacher_assignments is classified', () => {
  const discovered = discoverReaders();

  it('finds a meaningful number of readers (sanity check on the scan)', () => {
    // If a refactor renamed the table or the helpers, the patterns above would
    // silently match nothing and every assertion below would pass vacuously.
    expect(discovered.length).toBeGreaterThan(40);
  });

  it('has no unclassified reader', () => {
    const unclassified = discovered.filter((f) => !CLASSIFIED[f]);
    expect(
      unclassified,
      'These files read teacher_assignments but are not in CLASSIFIED. ' +
        'Decide for each: does it answer WHO MAY ACT (add relief) or WHOSE ' +
        'NAME SHOWS (substantive only)? Getting the second one wrong prints ' +
        'the wrong teacher on a report card.'
    ).toEqual([]);
  });

  it('has no stale entry for a file that no longer reads assignments', () => {
    const seen = new Set(discovered);
    const stale = Object.keys(CLASSIFIED).filter((f) => !seen.has(f));
    expect(
      stale,
      'CLASSIFIED lists files that no longer read teacher_assignments — remove them'
    ).toEqual([]);
  });

  it('gives every file at least one category', () => {
    for (const [file, categories] of Object.entries(CLASSIFIED)) {
      expect(categories.length, `${file} has no category`).toBeGreaterThan(0);
    }
  });
});

describe('the name-of-record boundary', () => {
  const nameFiles = Object.entries(CLASSIFIED)
    .filter(([, c]) => c.includes('name') && !c.includes('act'))
    .map(([f]) => f);

  const coverageFiles = Object.entries(CLASSIFIED)
    .filter(([, c]) => c.includes('coverage'))
    .map(([f]) => f);

  it('no pure name-of-record file resolves effective assignments', () => {
    // The whole design rests on this: the regular teacher stays the name of
    // record because these files keep reading teacher_assignments directly.
    for (const file of nameFiles) {
      expect(
        source(file),
        `${file} prints a teacher's name and must not see relief`
      ).not.toMatch(/loadEffectiveAssignmentsForUser/);
    }
  });

  it('no coverage check counts a relief as the post being filled', () => {
    // A covered section still has an unfilled post if its adviser left. If a
    // relief satisfied publish-readiness, an unstaffed section would publish.
    for (const file of coverageFiles) {
      expect(
        source(file),
        `${file} answers "is the post filled" and must not see relief`
      ).not.toMatch(/loadEffectiveAssignmentsForUser|assignment_reliefs/);
    }
  });

  it('no evaluation surface lets a relief write in the adviser’s place', () => {
    // The substantive adviser writes the write-ups and report card comments
    // even while covered. evaluation_writeups has NO adviser predicate in RLS
    // (migration 018 admits any authenticated role), so these files are the
    // only thing enforcing it — there is no database backstop.
    const evaluationOnly = Object.entries(CLASSIFIED)
      .filter(([, c]) => c.includes('evaluation') && !c.includes('act'))
      .map(([f]) => f);

    expect(evaluationOnly.length).toBeGreaterThan(0);
    for (const file of evaluationOnly) {
      expect(
        source(file),
        `${file} gates write-ups or report card comments and must not see relief`
      ).not.toMatch(/loadEffectiveAssignmentsForUser/);
    }
  });
});
