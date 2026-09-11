import { describe, expect, it } from 'vitest';

import {
  findStageCompletionBlockers,
  isStageStatusMissing,
  STAGE_KEYS,
  STATUS_OPTIONAL_STAGES,
  stageStatusMissingMessage,
  type StageKey,
} from '@/lib/schemas/sis';

// A stage saved with no status used to sail through every gate: the field
// requirements key off the status, so a blank one matched no rule and returned
// nothing. The save then stamped `<stage>UpdatedDate` + `<stage>Updatedby`,
// leaving a record that read as worked while holding nothing at all. Mr Ace
// hit it on a real enrolee's supplies stage, 2026-09-12.

describe('a stage may not be saved with no status', () => {
  const editable = STAGE_KEYS.filter(
    (k) => !STATUS_OPTIONAL_STAGES.includes(k)
  );

  it('covers every stage that has an edit dialog', () => {
    // `class` is the only exemption, and it is exempt because it has no
    // dialog — its columns are written by the Enrolled flip and the
    // assign-section route. If that ever changes, this test should fail and
    // make somebody think.
    expect([...STATUS_OPTIONAL_STAGES]).toEqual(['class']);
    expect(editable.length).toBe(STAGE_KEYS.length - 1);
  });

  it.each(editable)('refuses a blank status on %s', (stageKey) => {
    expect(isStageStatusMissing(stageKey, null)).toBe(true);
    expect(isStageStatusMissing(stageKey, undefined)).toBe(true);
    expect(isStageStatusMissing(stageKey, '')).toBe(true);
    expect(isStageStatusMissing(stageKey, '   ')).toBe(true);
  });

  it.each(editable)('allows a real status on %s', (stageKey) => {
    expect(isStageStatusMissing(stageKey, 'Pending')).toBe(false);
    // free text is legal — the dialog has an "Other…" escape hatch
    expect(isStageStatusMissing(stageKey, 'Something bespoke')).toBe(false);
  });

  it('never blocks the class stage, which has no dialog', () => {
    expect(isStageStatusMissing('class', null)).toBe(false);
    expect(isStageStatusMissing('class', '')).toBe(false);
    expect(isStageStatusMissing('class', 'Finished')).toBe(false);
  });

  it('names the stage in plain words, and does not say "required"', () => {
    expect(stageStatusMissingMessage('supplies')).toBe(
      'Supplies needs a status before it can be saved.'
    );
    for (const k of editable) {
      const msg = stageStatusMissingMessage(k as StageKey);
      expect(msg).toMatch(/needs a status before it can be saved\.$/);
      expect(msg).not.toMatch(/null|undefined|field|required|invalid/i);
    }
  });

  it('is the gate a blank status needs, because the field rules are not', () => {
    // This is the hole being closed: with no status, the field-requirement
    // check has nothing to match and returns clean — on every stage.
    for (const k of STAGE_KEYS) {
      expect(findStageCompletionBlockers(k, '', {})).toEqual([]);
      expect(findStageCompletionBlockers(k, null, {})).toEqual([]);
    }
    // ...so without the status gate, supplies with neither status nor claimed
    // date would have been accepted, which is exactly what happened.
    expect(findStageCompletionBlockers('supplies', '', {})).toEqual([]);
    expect(isStageStatusMissing('supplies', '')).toBe(true);
  });

  it('still requires the fields a real status asks for', () => {
    // the new gate must not shadow the existing one
    expect(isStageStatusMissing('supplies', 'Claimed')).toBe(false);
    const blockers = findStageCompletionBlockers('supplies', 'Claimed', {
      claimedDate: null,
    });
    expect(blockers.map((b) => b.fieldKey)).toEqual(['claimedDate']);
  });
});
