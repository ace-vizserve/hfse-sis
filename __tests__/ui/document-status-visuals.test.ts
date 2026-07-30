import { describe, expect, it } from 'vitest';

import {
  ACTION_CHIP_CLASS,
  ACTION_FILL,
  ACTION_LEGEND,
  STATUS_ACTION,
  STATUS_CHIP,
  chipClassForStatus,
  fillForStatus,
  isOutstanding,
  type DocumentAction,
} from '@/components/shared/document-status-visuals';
import { completenessRatio } from '@/components/shared/document-completeness-strip';
import type { DocumentStatus } from '@/lib/p-files/document-config';

// Every status the resolver can produce (lib/p-files/document-config.ts).
// Listed literally rather than derived, so adding a status to the union
// without teaching this module how to paint it fails here.
const ALL_STATUSES: DocumentStatus[] = [
  'valid',
  'uploaded',
  'expired',
  'missing',
  'na',
  'rejected',
  'to-follow',
];

const slot = (key: string, status: DocumentStatus) => ({
  key,
  label: key,
  status,
  expiryDate: null,
});

describe('document status visuals — completeness', () => {
  it('paints, labels and legends every document status', () => {
    for (const status of ALL_STATUSES) {
      const action = STATUS_ACTION[status];
      expect(action, `no action for '${status}'`).toBeTruthy();
      expect(ACTION_FILL[action], `no fill for '${action}'`).toBeTruthy();
      expect(ACTION_CHIP_CLASS[action], `no chip for '${action}'`).toBeTruthy();
      expect(STATUS_CHIP[status]?.label).toBeTruthy();
      expect(STATUS_CHIP[status]?.icon).toBeTruthy();
      expect(
        ACTION_LEGEND.some((e) => e.action === action),
        `action '${action}' is reachable from status '${status}' but absent from the legend`
      ).toBe(true);
    }
  });

  it('gives the legend one entry per action, and no orphans', () => {
    const legendActions = ACTION_LEGEND.map((e) => e.action);
    expect(new Set(legendActions).size).toBe(legendActions.length);
    // An entry documenting an action nothing can produce is a lie in the key.
    const reachable = new Set(Object.values(STATUS_ACTION));
    for (const action of legendActions) {
      expect(
        reachable.has(action),
        `legend documents unreachable '${action}'`
      ).toBe(true);
    }
  });
});

describe('document status visuals — the rule the old dot matrix broke', () => {
  // The matrix painted 7 statuses in 5 colours: expired/rejected both
  // `bg-destructive`, missing/na both `bg-muted`. Two pairs were genuinely
  // indistinguishable, so the grid could not be decoded even with a legend
  // (design system §10.5 — no two distinct states share a swatch).
  it('never gives two actions the same fill', () => {
    const fills = Object.values(ACTION_FILL);
    expect(new Set(fills).size).toBe(fills.length);
  });

  it('keeps statuses that share a fill distinct by word and icon', () => {
    const byFill = new Map<string, DocumentStatus[]>();
    for (const status of ALL_STATUSES) {
      const fill = fillForStatus(status);
      byFill.set(fill, [...(byFill.get(fill) ?? []), status]);
    }
    for (const [fill, statuses] of byFill) {
      if (statuses.length < 2) continue;
      const labels = statuses.map((s) => STATUS_CHIP[s].label);
      const icons = statuses.map((s) => STATUS_CHIP[s].icon);
      expect(new Set(labels).size, `shared fill ${fill} reuses a word`).toBe(
        labels.length
      );
      expect(new Set(icons).size, `shared fill ${fill} reuses an icon`).toBe(
        icons.length
      );
    }
  });

  it('shares a fill only where the next action is genuinely the same', () => {
    // Lapsed and sent-back are the one deliberate merge: either way the
    // parent has to upload the document again.
    expect(fillForStatus('expired')).toBe(fillForStatus('rejected'));
    expect(chipClassForStatus('expired')).toBe(chipClassForStatus('rejected'));
    expect(STATUS_CHIP.expired.label).not.toBe(STATUS_CHIP.rejected.label);

    // Not-collected and not-applicable were the OTHER old collision, and
    // they are not the same thing — one is chase work, one is out of scope.
    expect(fillForStatus('missing')).not.toBe(fillForStatus('na'));
  });
});

describe('isOutstanding', () => {
  it('counts only what the officer must act on', () => {
    expect(isOutstanding('valid')).toBe(false);
    // Not applicable is not outstanding — there is no document to chase.
    expect(isOutstanding('na')).toBe(false);
    for (const status of [
      'uploaded',
      'expired',
      'missing',
      'rejected',
      'to-follow',
    ] as const) {
      expect(isOutstanding(status), `'${status}' should be outstanding`).toBe(
        true
      );
    }
  });
});

describe('completenessRatio', () => {
  it('excludes not-applicable slots from BOTH halves', () => {
    // Mirrors StudentCompleteness.total, which is built from the applicable
    // slots only — a student with no father on file must not read as
    // incomplete because of the two father slots.
    expect(
      completenessRatio([
        slot('a', 'valid'),
        slot('b', 'valid'),
        slot('c', 'na'),
        slot('d', 'na'),
      ])
    ).toEqual({ done: 2, total: 2 });
  });

  it('counts only valid as done', () => {
    expect(
      completenessRatio([
        slot('a', 'valid'),
        slot('b', 'uploaded'),
        slot('c', 'expired'),
        slot('d', 'missing'),
      ])
    ).toEqual({ done: 1, total: 4 });
  });

  it('reports 0/0 rather than dividing by zero when nothing applies', () => {
    expect(completenessRatio([slot('a', 'na')])).toEqual({ done: 0, total: 0 });
    expect(completenessRatio([])).toEqual({ done: 0, total: 0 });
  });
});
