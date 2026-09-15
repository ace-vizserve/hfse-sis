/**
 * Nobody grades a sheet by its subject config's weights except the resolver.
 *
 * Migration 159 let a grading sheet state its own WW/PT/QA weights, because a
 * term can have no exam. Before it there was exactly one answer —
 * `subject_configs` — and every call site read it directly off a join. Those
 * reads are no longer correct: a sheet with no exam would be graded out of 80
 * while the screen beside it says the exam does not count, and both numbers
 * look plausible.
 *
 * This is the guard for that defect class rather than for the sites that
 * happened to exist when it was written. It greps the real pattern and
 * classifies every hit, so a NEW read added next year fails here instead of
 * silently grading somebody's Filipino term out of 80.
 *
 * Every exemption below carries its reason. An exemption with no reason is a
 * bug waiting to be re-introduced.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SEARCH_DIRS = ['app', 'lib', 'components'];

/**
 * Files allowed to read a weight off `subject_configs`, and why.
 *
 * ⚠ Adding a row here is a decision about a student's grade. Say why the
 * config is genuinely the right answer at that site, not merely that it works.
 */
const EXEMPT: Record<string, string> = {
  'lib/grading/resolve-sheet-weights.ts':
    'The resolver itself. This is the one place the precedence lives.',
  'app/api/grading-sheets/bulk-create/preview/route.ts':
    'Previews sheets that DO NOT EXIST YET, so there is no sheet to carry an override. The config is the only possible answer, and it is also what the sheets will be created with.',
  'components/sis/generate-sheets-dialog.tsx':
    'Renders the bulk-create preview payload above. Sheets that do not exist yet.',
  'components/sis/subject-config-form.tsx':
    'Edits the subject config itself. These weights are the thing being edited, not a grade being computed.',
  'components/sis/subject-catalog-card.tsx':
    'Displays the subject config being edited, beside the form above. Same reason.',
  'lib/sis/subjects/queries.ts':
    'Loads subject configs for the Subject Setup page — the editor above. Reads the default as a default.',
  'app/api/sis/admin/subjects/route.ts':
    'Creates a subject config. Writes the default, computes no grade.',
  'app/api/sis/admin/subjects/[configId]/route.ts':
    'Updates a subject config. Writes the default; the fan-out that follows resolves per sheet in lib/grading/sync-config-sheets.ts.',
  'app/api/sis/admin/subjects/[configId]/term-weights/route.ts':
    'The route that WRITES per-term weights. It reads the config as the base to redistribute FROM when a component is unticked, and passes it to resolveSheetWeights as the fallback on the GET — it never grades a sheet by the config alone.',
  'app/api/compute/quarterly/route.ts':
    'Takes weights as REQUEST INPUT and never reads a config at all. Listed because it names the field.',
  'app/api/grading-sheets/[id]/route.ts':
    'A read-only payload route that computes nothing. It carries BOTH the sheet weights and the config weights out to the client so a consumer can resolve; it must never start choosing between them here.',
  'lib/sis/backfill/grading/build-grading-import.ts':
    'Generates import SQL from a workbook masthead. No sheet exists at generation time, and the masthead IS the per-term weight — this file writing one set of weights per academic year is the origin of the defect migration 159 fixes.',
  'lib/sis/backfill/grading/build-primary-grading-import.ts':
    'Same as build-grading-import.ts — generated import SQL, workbook masthead weights.',
  'lib/sis/backfill/grading/build-secondary-grading-import.ts':
    'Same as build-grading-import.ts — generated import SQL, workbook masthead weights.',
  'lib/sis/backfill/grading/build-t1-primary-grading-import.ts':
    'Same as build-grading-import.ts — generated import SQL, workbook masthead weights.',
  'lib/sis/backfill/grading/build-t1-secondary-grading-import.ts':
    'Same as build-grading-import.ts — generated import SQL, workbook masthead weights.',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === '.git')
      continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

/** Repo-relative, forward-slashed, so the exemption keys read the same on every OS. */
function rel(file: string): string {
  return relative(ROOT, file).split(sep).join('/');
}

describe('weight read sites', () => {
  const files = SEARCH_DIRS.flatMap((d) => walk(join(ROOT, d)));

  it('finds the source tree, so a passing result means something', () => {
    // A guard that scans nothing passes loudly and protects nothing. This
    // codebase has already been bitten by exactly that: a shared comment
    // stripper deleted 538 lines across 29 files before the guards read them,
    // and every check asserting ABSENCE read that as a pass.
    expect(files.length).toBeGreaterThan(500);
  });

  it('a file that reads config weights resolves them against the sheet', () => {
    // NOT "nobody may select config weights" — every compute site must select
    // them, because the config is the fallback the resolver falls back TO. The
    // invariant is narrower and it is the one that matters: if you have read a
    // config weight, you may not decide with it yourself.
    //
    // The first version of this guard banned the select outright and flagged
    // six files that were already correct. A guard that cannot tell a right
    // answer from a wrong one gets weakened until it says nothing.
    const offenders: string[] = [];

    for (const file of files) {
      const path = rel(file);
      if (EXEMPT[path]) continue;

      const src = readFileSync(file, 'utf8');

      // `from('subject_configs').select(... ww_weight ...)`
      // or an embed: `subject_config:subject_configs(... ww_weight ...)`
      const readsConfigWeights =
        /subject_configs?\s*\([^)]*(?:ww|pt|qa)_weight/.test(src) ||
        /from\(\s*['"]subject_configs['"]\s*\)[\s\S]{0,400}?(?:ww|pt|qa)_weight/.test(
          src
        );
      if (!readsConfigWeights) continue;

      if (!src.includes('resolveSheetWeights')) offenders.push(path);
    }

    expect(offenders).toEqual([]);
  });

  it('no compute site passes a config weight straight into the formula', () => {
    // The specific shape the defect wore: reading `config.ww_weight` into a
    // `computeQuarterly` / `recomputeSheetEntries` call. Even in a file that
    // also imports the resolver, that is the line grading a no-exam term out
    // of 80.
    //
    // ⚠ NARROWED to files that actually compute. Reading a config weight is
    // legitimate and common for surfaces that only SHOW the subject's default —
    // the grading sheet page reads it to offer "follow the subject again" on a
    // class that differs. Flagging those taught the guard to cry wolf, and a
    // guard that cries wolf gets exemptions bolted on until it says nothing.
    const offenders: string[] = [];

    for (const file of files) {
      const path = rel(file);
      // Same exemptions as above — the config-editing screens genuinely do
      // render `config.ww_weight`, because the config is what they are for.
      if (EXEMPT[path]) continue;

      const src = readFileSync(file, 'utf8');
      const computes = /computeQuarterly|recomputeSheetEntries/.test(src);
      if (!computes) continue;

      if (/\bconfig(?:Weights)?[?]?\.(?:ww|pt|qa)_weight/.test(src)) {
        offenders.push(path);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('every exemption names a real file', () => {
    // An exemption for a file that has been moved or deleted silently widens
    // the guard, because the key stops matching anything and the real file is
    // no longer covered by the reason written here.
    const present = new Set(files.map(rel));
    const stale = Object.keys(EXEMPT).filter((p) => !present.has(p));
    expect(stale).toEqual([]);
  });

  it('every exemption carries a reason', () => {
    const empty = Object.entries(EXEMPT)
      .filter(([, reason]) => reason.trim().length < 20)
      .map(([path]) => path);
    expect(empty).toEqual([]);
  });
});
