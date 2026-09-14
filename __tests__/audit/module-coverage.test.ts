/**
 * Guards the "Audit activity by module" card against the drift that broke it.
 *
 * The card counted rows with a six-prefix list that covered 51 of 152 audit
 * actions — 51% of live rows were counted in no module at all — and the drill
 * behind it used a SECOND list, keyed differently, so every bar click returned
 * zero rows. Both now read `lib/audit/modules.ts`; this test is what stops the
 * list falling behind the vocabulary again.
 *
 * Adding an audit action with a new prefix fails here until it is filed under a
 * module. That is the point: a new prefix should be a decision, not a silent
 * hole in a chart that claims to show "where the system is most active".
 */
import { describe, expect, it } from 'vitest';

import { ALL_AUDIT_ACTIONS } from '@/lib/audit/log-action';
import {
  AUDIT_MODULES,
  auditModuleByKey,
  auditModuleForAction,
  auditModuleOrFilter,
} from '@/lib/audit/modules';

describe('audit module coverage', () => {
  it('files every audit action under exactly one module', () => {
    const unclaimed = ALL_AUDIT_ACTIONS.filter(
      (action) => auditModuleForAction(action) === null
    );
    expect(
      unclaimed,
      `These audit actions belong to no module, so they would be invisible on ` +
        `the "Audit activity by module" chart. Add their prefix to a module in ` +
        `lib/audit/modules.ts:\n  ${unclaimed.join('\n  ')}`
    ).toEqual([]);
  });

  it('never lets two modules claim the same action', () => {
    // Longest-prefix-wins makes `auditModuleForAction` deterministic, so the
    // risk is not an exception at runtime — it is a prefix pair where the
    // intended owner loses silently. Check every action against every module
    // rather than trusting the resolver we are testing.
    const contested: string[] = [];
    for (const action of ALL_AUDIT_ACTIONS) {
      const owners = AUDIT_MODULES.filter((m) =>
        m.prefixes.some((p) => action === p || action.startsWith(p))
      );
      // More than one owner is fine ONLY when longest-prefix picks the more
      // specific of them — that is how `sis.stage.` is split out of `sis.`.
      if (owners.length > 1) {
        const winner = auditModuleForAction(action);
        const longest = owners
          .flatMap((m) => m.prefixes.filter((p) => action.startsWith(p)))
          .sort((a, b) => b.length - a.length)[0];
        const shouldWin = AUDIT_MODULES.find((m) =>
          m.prefixes.includes(longest)
        );
        if (winner?.key !== shouldWin?.key) {
          contested.push(
            `${action} → ${winner?.key} (expected ${shouldWin?.key})`
          );
        }
      }
    }
    expect(contested).toEqual([]);
  });

  it('never lets two modules’ PREFIX SETS overlap', () => {
    // The test that was missing, and the bug it missed.
    //
    // `auditModuleForAction` resolves ties by longest-prefix, so the resolver
    // was correct while the data was not: prefixes are ALSO compiled into a
    // PostgREST `or=action.like.…` filter, and SQL has no longest-prefix rule.
    // A catch-all `sis.` in Records matched `sis.stage.update` as happily as
    // Admissions' `sis.stage.` did, so 67 admissions rows were counted in both
    // modules — the bars summed to 1721 over a range holding 1654 rows.
    //
    // Overlap must therefore be checked between prefix SETS, not through the
    // resolver that hides it.
    const overlaps: string[] = [];
    for (const a of AUDIT_MODULES) {
      for (const b of AUDIT_MODULES) {
        if (a.key >= b.key) continue;
        for (const pa of a.prefixes) {
          for (const pb of b.prefixes) {
            if (pa.startsWith(pb) || pb.startsWith(pa)) {
              overlaps.push(`${a.key}:"${pa}" overlaps ${b.key}:"${pb}"`);
            }
          }
        }
      }
    }
    expect(
      overlaps,
      'Overlapping prefixes double-count rows in the by-module chart, because ' +
        'each module is queried with its own or=LIKE filter:\n  ' +
        overlaps.join('\n  ')
    ).toEqual([]);
  });

  it('gives every module a unique key and label', () => {
    const keys = AUDIT_MODULES.map((m) => m.key);
    const labels = AUDIT_MODULES.map((m) => m.label);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('splits the historic sis. prefix between admissions and records', () => {
    // The specific regression this ordering exists for.
    expect(auditModuleForAction('sis.stage.update')?.key).toBe('admissions');
    expect(auditModuleForAction('sis.document.approve')?.key).toBe(
      'admissions'
    );
    expect(auditModuleForAction('sis.profile.update')?.key).toBe('records');
    expect(auditModuleForAction('sis.house.update')?.key).toBe('records');
    expect(auditModuleForAction('sis.level.create')?.key).toBe('classes');
  });

  it('keeps subject-adjacent prefixes apart', () => {
    expect(auditModuleForAction('subject.create')?.key).toBe('classes');
    expect(auditModuleForAction('subject_config.update')?.key).toBe('classes');
    expect(auditModuleForAction('subject_level_offering.toggle')?.key).toBe(
      'classes'
    );
    // …but the report map is a Markbook concern despite the shared stem.
    expect(auditModuleForAction('subject_report_map.update')?.key).toBe(
      'markbook'
    );
  });

  it('matches the dotless grade-change family', () => {
    for (const a of [
      'grade_change_requested',
      'grade_change_approved',
      'grade_change_applied',
      'grade_correction',
    ]) {
      expect(auditModuleForAction(a)?.key, a).toBe('markbook');
    }
  });

  it('builds a PostgREST or-filter for a known module', () => {
    const filter = auditModuleOrFilter('attendance');
    expect(filter).toBe('action.like.attendance.*');
    const markbook = auditModuleOrFilter('markbook');
    expect(markbook).toContain('action.like.sheet.*');
    expect(markbook).toContain('action.like.grade_change_*');
  });

  it('returns null for an unknown module rather than selecting everything', () => {
    // A bad segment must narrow to nothing, never widen to the whole log.
    expect(auditModuleOrFilter('not-a-module')).toBeNull();
    expect(auditModuleByKey('not-a-module')).toBeNull();
    // The old bug passed a LABEL where a key was expected — that must not
    // resolve either, or the drill would quietly work for some bars only.
    expect(auditModuleByKey('Markbook')).toBeNull();
  });
});
