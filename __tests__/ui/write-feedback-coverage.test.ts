/**
 * Every write says what it is doing, from click until the screen changes.
 *
 * WHY THIS EXISTS. An audit on 2026-08-16 found the three signals were not
 * equally covered: `toast.error` appeared in 78 of 78 write components and
 * `toast.success` in 76, but the IN-FLIGHT phase appeared in exactly ONE.
 * `lib/hooks/use-write-action.ts` had shipped two days earlier and 79 call
 * sites had not moved onto it. So the gap was never "nobody toasts" — it was
 * that a write reported success the moment the POST resolved, while an
 * unawaited `router.refresh()` was still in flight and the list underneath was
 * still the old list. The user was told the work was done while it visibly was
 * not.
 *
 * A sweep of ~79 near-identical edits is exactly the condition under which a
 * guard earns its keep, and the two failures it catches are both silent:
 * double-toasting (harmless but sloppy) and double-REFRESHING, which is
 * invisible and worse — `app/(markbook)/markbook/grading/[id]/page.tsx:156`
 * performs a DB write on every render, so a doubled refresh doubles that write.
 *
 * HOW IT RATCHETS. `CONVERTED_ROOTS` lists the directories the sweep has
 * finished. It starts small and grows one module per commit, so the guard is
 * live from the first module instead of standing as a wall in front of the
 * whole sweep. A root is only added once every write under it complies.
 *
 * AN ENTRY WITHOUT A REASON IS NOT ALLOWED. Same discipline as
 * `__tests__/data/no-unpaginated-high-volume-reads.test.ts`: every exemption
 * names who decided and why, and a stale entry fails the suite — an exemption
 * for a file that no longer needs one is a lie the next reader would trust.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..');

/**
 * Directories the sweep has completed. Add a module here in the same commit
 * that converts it — never ahead of it, or the guard passes on work that has
 * not happened.
 */
const CONVERTED_ROOTS = [
  'components/grading',
  'components/p-files',
  'components/attendance',
  'app/(markbook)',
  'components/admin',
  'components/admissions',
  'components/classroom',
  'components/evaluation',
  'components/home',
  'components/markbook',
  'components/change-requests',
  'components/sis',
];

type Exemption = { decided: string; why: string };

/**
 * Writes that deliberately do NOT route through `useWriteAction`.
 *
 * The bar is high: a toast per keystroke is a worse experience than no toast,
 * and a terminal screen has no list behind it to go stale. Everything else
 * converts.
 */
const NOT_CONVERTED: Record<string, Exemption> = {
  // components/grading/score-entry-grid.tsx was exempt here until 2026-08-30.
  // The exemption argued that a pending toast per cell would be a regression,
  // which was true only while the grid accepted a burst of cells. It no longer
  // does: a save now makes the whole grid inert until it lands, so there is at
  // most one save in flight and exactly one toast for it.
  'components/grading/annual-letter-input.tsx': {
    decided: '2026-08-16',
    why: 'Tier-3 autosave holding its own state — there is no server-rendered copy of the value to go stale, so it needs no refresh and reports failures only.',
  },
  'app/(markbook)/markbook/grading/new/new-sheet-form.tsx': {
    decided: '2026-08-16',
    why: 'Navigates away on success with router.push to the sheet it just created, so there is no surface left behind to refresh and nothing to hold a pending toast for — the new page arriving IS the feedback.',
  },
  'components/change-requests/act-confirm.tsx': {
    decided: '2026-08-16',
    why: 'The one-click email approve/reject page (KD #123). A terminal screen reached from a link in an email — there is no list behind it to go stale, and the person acting never sees the queue, so there is nothing for a refresh to correct.',
  },
  'components/sis/student-data-table.tsx': {
    decided: '2026-08-17',
    why: 'Matches the write scan on `method: POST` but performs no write — both POSTs are READS with a request body (a filtered student lookup and a column probe), so there is nothing to report or refresh.',
  },
};

/**
 * Files that use `useWriteAction` AND still call `router.refresh()` directly,
 * because a DIFFERENT write on the same surface needs it. Rare and suspicious:
 * the usual cause of a bare refresh beside the helper is a half-finished
 * conversion, which double-refreshes.
 */
const EXTRA_ROUTER_REFRESH: Record<string, Exemption> = {};

/**
 * Files that call `toast.success` themselves ALONGSIDE `useWriteAction`.
 *
 * Normally that is double-toasting and the rule below rejects it. The
 * exception is a success that needs a toast this helper cannot build — one
 * carrying an `action` button or a `description` — where the resolver raises
 * its own and returns `null` so exactly one lands. That is legitimate, but it
 * is indistinguishable from the defect by a source scan, so each case is named
 * here with the reason it is not a double toast.
 */
const EXTRA_SUCCESS_TOAST: Record<string, Exemption> = {
  'components/sis/edit-stage-dialog.tsx': {
    decided: '2026-08-17',
    why: 'Two of its six success branches need a `description` line the helper cannot carry (the awaiting-placement follow-up, and the skipped-roster-sync warning). Each raises its own toast and returns null, so exactly one appears.',
  },
  'components/sis/staff-accounts-client.tsx': {
    decided: '2026-08-17',
    why: 'Creating a TEACHER account raises a success toast carrying an action button ("Now assign their classes"), which a plain message cannot hold. That branch returns null; the non-teacher branch returns a string normally.',
  },
};

/** Surfaces that show the change themselves, so a pending toast would be noise. */
const PENDING_FALSE: Record<string, Exemption> = {
  'components/p-files/document-validation/awaiting-queue.tsx': {
    decided: '2026-08-16',
    why: 'Optimistic — the row is removed from the queue the instant it is clicked, so a pending toast would narrate a change already on screen. The refresh is still awaited underneath because it is what corrects the SSR badge count.',
  },
  'components/admissions/document-validation/validation-queue.tsx': {
    decided: '2026-08-16',
    why: 'Optimistic, same shape as the p-files awaiting queue — the row leaves the list on click, so a pending toast would narrate a change the user can already see. The awaited refresh still corrects the SSR badge count.',
  },
  'components/admin/bulk-publish-dialog.tsx': {
    decided: '2026-08-16',
    why: 'The dialog shows its own "Publishing 3 of 12…" progress against a real count while the batch runs, which is strictly more informative than a pending toast saying the same thing less precisely.',
  },
  'components/sis/house-tile.tsx': {
    decided: '2026-08-17',
    why: 'The tile repaints in the new house colour on click, before the round-trip — a pending toast would narrate a change the user is looking at. It reverts from the prop if the save fails.',
  },
  'components/sis/stp-status-editor.tsx': {
    decided: '2026-08-17',
    why: 'Optimistic Select — the new status is displayed immediately and rolled back by onError if the write fails, so a pending toast would describe something already on screen.',
  },
  'components/sis/cohorts/pre-course-date-cell.tsx': {
    decided: '2026-08-17',
    why: 'Optimistic inline date cell — the chosen date shows at once and reverts on failure, so the pending phase has nothing left to announce.',
  },
  'components/sis/school-config-form.tsx': {
    decided: '2026-08-17',
    why: 'Answers with its own inline "Saved" tick beside the Save button — a settings page saved in place, where a toast would be a second voice for the same event. Failures still toast, since the tick can only say the good outcome.',
  },
  'components/sis/subject-config-form.tsx': {
    decided: '2026-08-17',
    why: 'Its reports-to picker and the three catalog fields auto-save on change and already display the chosen value, reverting it if the write fails — so the pending phase has nothing left to announce. The weights Save button is a normal write and keeps its pending toast.',
  },
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

function relative(file: string): string {
  return file.slice(REPO_ROOT.length + 1).replace(/\\/g, '/');
}

/**
 * Source with comments blanked out, so the guard reads code and not prose.
 *
 * Not optional. Three of this codebase's converted files EXPLAIN in a comment
 * why they no longer call `router.refresh()` — and a plain substring scan read
 * those explanations as the offence they describe. A guard whose first run is
 * three false positives is a guard someone deletes.
 *
 * Strings and template literals are tracked so a `'https://…'` is not mistaken
 * for the start of a line comment, which would blank the rest of a real line.
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  type Mode = 'code' | 'line' | 'block' | 'single' | 'double' | 'template';
  let mode: Mode = 'code';

  while (i < source.length) {
    const two = source.slice(i, i + 2);
    const ch = source[i];

    if (mode === 'code') {
      if (two === '//') {
        mode = 'line';
        out += '  ';
        i += 2;
        continue;
      }
      if (two === '/*') {
        mode = 'block';
        out += '  ';
        i += 2;
        continue;
      }
      if (ch === "'") mode = 'single';
      else if (ch === '"') mode = 'double';
      else if (ch === '`') mode = 'template';
      out += ch;
      i += 1;
      continue;
    }

    if (mode === 'line') {
      if (ch === '\n') {
        mode = 'code';
        out += ch;
      } else out += ' ';
      i += 1;
      continue;
    }

    if (mode === 'block') {
      if (two === '*/') {
        mode = 'code';
        out += '  ';
        i += 2;
        continue;
      }
      out += ch === '\n' ? ch : ' ';
      i += 1;
      continue;
    }

    // Inside a string: copy through, honouring escapes, until it closes.
    out += ch;
    if (ch === '\\') {
      out += source[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (
      (mode === 'single' && ch === "'") ||
      (mode === 'double' && ch === '"') ||
      (mode === 'template' && ch === '`')
    ) {
      mode = 'code';
    }
    i += 1;
  }
  return out;
}

const SCANNED = CONVERTED_ROOTS.flatMap((root) =>
  walk(join(REPO_ROOT, root))
).map((file) => ({
  file: relative(file),
  source: stripComments(readFileSync(file, 'utf8')),
}));

/**
 * A write is `jsonInit(...)` — the helper that builds almost every mutating
 * request — OR a hand-rolled `method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'`.
 *
 * The second half is not hypothetical: `components/p-files/upload-dialog.tsx`
 * posts multipart FormData and so cannot use `jsonInit` (the browser has to set
 * the multipart boundary itself). A `jsonInit`-only detector called the app's
 * slowest write — a file upload — not a write at all, which is precisely the
 * surface most in need of a pending toast.
 */
const WRITE_MARKER = /jsonInit\(|method:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/;
const writes = SCANNED.filter((f) => WRITE_MARKER.test(f.source));
const converted = writes.filter((f) => f.source.includes('useWriteAction'));

describe('every write routes through useWriteAction', () => {
  it('has no unconverted write that is not exempt', () => {
    const unexplained = writes
      .filter(
        (f) => !f.source.includes('useWriteAction') && !NOT_CONVERTED[f.file]
      )
      .map((f) => `${f.file} writes but does not use useWriteAction`);
    expect(unexplained).toEqual([]);
  });

  it('every exemption names who decided and why', () => {
    const vague = [
      ...Object.entries(NOT_CONVERTED),
      ...Object.entries(EXTRA_ROUTER_REFRESH),
      ...Object.entries(EXTRA_SUCCESS_TOAST),
      ...Object.entries(PENDING_FALSE),
    ]
      .filter(
        ([, v]) =>
          !/^\d{4}-\d{2}-\d{2}$/.test(v.decided) || v.why.trim().length < 40
      )
      .map(([file]) => file);
    expect(vague).toEqual([]);
  });

  it('has no stale exemption', () => {
    // A file that has since converted, moved or stopped writing.
    const stale = Object.keys(NOT_CONVERTED).filter(
      (file) =>
        !writes.some(
          (f) => f.file === file && !f.source.includes('useWriteAction')
        )
    );
    expect(stale).toEqual([]);
  });
});

describe('a converted file does not also do it the old way', () => {
  it('never calls toast.success itself', () => {
    // `useWriteAction` owns the success toast. A leftover call double-toasts —
    // the likeliest defect across ~80 mechanical edits.
    const doubled = converted
      .filter(
        (f) =>
          f.source.includes('toast.success(') && !EXTRA_SUCCESS_TOAST[f.file]
      )
      .map((f) => `${f.file} calls toast.success alongside useWriteAction`);
    expect(doubled).toEqual([]);
  });

  it('never calls router.refresh() itself', () => {
    // Worse than a double toast and invisible: the grading page performs a DB
    // write on every render, so a doubled refresh doubles that write.
    //
    // `useDebouncedRefresh(() => router.refresh())` is not a second refresh —
    // it is the coalescing path a Tier-3 autosave grid uses, and a file may
    // hold both kinds of write (components/attendance/wide-grid.tsx does).
    const DEBOUNCED =
      /useDebouncedRefresh\(\s*\(\)\s*=>\s*router\.refresh\(\)\s*\)/g;
    const doubled = converted
      .filter((f) => {
        const bare = f.source.replace(DEBOUNCED, '');
        return (
          /router\.refresh\(\)/.test(bare) && !EXTRA_ROUTER_REFRESH[f.file]
        );
      })
      .map((f) => `${f.file} calls router.refresh() alongside useWriteAction`);
    expect(doubled).toEqual([]);
  });

  it('states a reason for every suppressed pending toast', () => {
    const unexplained = converted
      .filter(
        (f) => /pending:\s*false/.test(f.source) && !PENDING_FALSE[f.file]
      )
      .map((f) => `${f.file} passes pending: false without a recorded reason`);
    expect(unexplained).toEqual([]);
  });
});

describe('the exempt files still do the thing that exempts them', () => {
  // This is what stops the allowlist becoming a lie. It cannot be satisfied by
  // editing the allowlist alone — the file itself has to still be autosave.
  // score-entry-grid had a proof here — "still coalesces its refresh" — for as
  // long as it was exempt. It converted on 2026-08-30, so the proof went with
  // the exemption rather than being weakened to keep it green.
  it('annual-letter-input still holds its own state instead of refreshing', () => {
    const source = readFileSync(
      join(REPO_ROOT, 'components/grading/annual-letter-input.tsx'),
      'utf8'
    );
    expect(source.includes('router.refresh()')).toBe(false);
  });
});

describe('the scan is really looking at something', () => {
  it('found write components under every converted root', () => {
    for (const root of CONVERTED_ROOTS) {
      const found = writes.filter((f) => f.file.startsWith(`${root}/`));
      expect(
        found.length,
        `${root} is listed as converted but no writes were found under it`
      ).toBeGreaterThan(0);
    }
  });

  it('found at least one genuinely converted file', () => {
    // Guards against the whole scan silently matching nothing — a green test
    // over an empty set is the failure mode this suite is meant to prevent.
    expect(converted.length).toBeGreaterThan(0);
  });
});
