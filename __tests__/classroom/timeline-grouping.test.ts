import { describe, expect, it } from 'vitest';

import {
  countByKind,
  groupTimeline,
  kindForAction,
  type TimelineEvent,
} from '@/lib/classroom/timeline';

let seq = 0;
const ev = (
  action: string,
  createdAt: string,
  actorEmail = 'ana@hfse.edu.sg'
): TimelineEvent => ({
  id: `e${(seq += 1)}`,
  action,
  actorEmail,
  context: {},
  createdAt,
});

describe('kindForAction', () => {
  it('files each family under the category the page names', () => {
    expect(kindForAction('sheet.lock')).toBe('sheets');
    expect(kindForAction('evaluation.writeup.submit')).toBe('writeups');
    expect(kindForAction('section.rename')).toBe('roster');
    expect(kindForAction('enrolment.metadata.update')).toBe('roster');
    expect(kindForAction('student.section.transfer')).toBe('roster');
    expect(kindForAction('entry.update')).toBe('grades');
    expect(kindForAction('totals.update')).toBe('grades');
  });

  // Prefix-matched on purpose: AuditAction grows, and a new sheet.* or
  // evaluation.* should land correctly without anyone editing the classifier.
  it('classifies actions that did not exist when it was written', () => {
    expect(kindForAction('sheet.something.new')).toBe('sheets');
    expect(kindForAction('evaluation.writeup.unsubmit')).toBe('writeups');
  });

  // Dropping an event would be far worse than filing it under a generic
  // heading, so anything unrecognised still appears.
  it('files an unknown action under other rather than discarding it', () => {
    expect(kindForAction('something.entirely.new')).toBe('other');
  });
});

describe('groupTimeline', () => {
  it('collapses consecutive events sharing an action and an actor', () => {
    const days = groupTimeline([
      ev('evaluation.writeup.submit', '2026-07-31T06:41:00Z'),
      ev('evaluation.writeup.submit', '2026-07-31T06:39:00Z'),
      ev('evaluation.writeup.submit', '2026-07-31T06:37:00Z'),
    ]);
    expect(days).toHaveLength(1);
    expect(days[0].runs).toHaveLength(1);
    expect(days[0].runs[0].events).toHaveLength(3);
    // The heading counts real events, so it must not report "1".
    expect(days[0].eventCount).toBe(3);
  });

  it('reports the run span oldest-to-newest', () => {
    const days = groupTimeline([
      ev('evaluation.writeup.submit', '2026-07-31T06:41:00Z'),
      ev('evaluation.writeup.submit', '2026-07-31T06:37:00Z'),
    ]);
    const run = days[0].runs[0];
    expect(run.startedAt).toBe('2026-07-31T06:37:00Z');
    expect(run.endedAt).toBe('2026-07-31T06:41:00Z');
  });

  it('gives a single event a run whose span is one instant', () => {
    const days = groupTimeline([ev('entry.update', '2026-07-31T03:20:00Z')]);
    const run = days[0].runs[0];
    expect(run.events).toHaveLength(1);
    expect(run.startedAt).toBe(run.endedAt);
  });

  // Merging A, B, A would claim two things happened together when something
  // else happened in between. The ordering IS the information here.
  it('does not merge same-action events that are not consecutive', () => {
    const days = groupTimeline([
      ev('entry.update', '2026-07-31T05:00:00Z'),
      ev('sheet.lock', '2026-07-31T04:00:00Z'),
      ev('entry.update', '2026-07-31T03:00:00Z'),
    ]);
    expect(days[0].runs.map((r) => r.action)).toEqual([
      'entry.update',
      'sheet.lock',
      'entry.update',
    ]);
  });

  it('does not merge the same action by different people', () => {
    const days = groupTimeline([
      ev('entry.update', '2026-07-31T05:00:00Z', 'ana@hfse.edu.sg'),
      ev('entry.update', '2026-07-31T04:00:00Z', 'joann@hfse.edu.sg'),
    ]);
    expect(days[0].runs).toHaveLength(2);
  });

  // Days are SINGAPORE days. Grouping on the raw UTC stamp would file
  // everything before 08:00 SGT under the previous day — most of a school
  // morning, and exactly when a register gets marked.
  it('groups by Singapore date, not UTC date', () => {
    // 2026-07-30T23:30:00Z is 07:30 on the 31st in Singapore.
    const days = groupTimeline([ev('entry.update', '2026-07-30T23:30:00Z')]);
    expect(days[0].date).toBe('2026-07-31');
  });

  it('splits a run that crosses midnight in Singapore', () => {
    // 16:10Z = 00:10 on the 31st SGT; 15:50Z = 23:50 on the 30th.
    const days = groupTimeline([
      ev('evaluation.writeup.submit', '2026-07-30T16:10:00Z'),
      ev('evaluation.writeup.submit', '2026-07-30T15:50:00Z'),
    ]);
    expect(days.map((d) => d.date)).toEqual(['2026-07-31', '2026-07-30']);
    expect(days[0].runs[0].events).toHaveLength(1);
    expect(days[1].runs[0].events).toHaveLength(1);
  });

  it('preserves the order it was given', () => {
    const days = groupTimeline([
      ev('entry.update', '2026-07-31T05:00:00Z'),
      ev('sheet.lock', '2026-07-30T05:00:00Z'),
    ]);
    expect(days.map((d) => d.date)).toEqual(['2026-07-31', '2026-07-30']);
  });

  it('returns nothing for no events', () => {
    expect(groupTimeline([])).toEqual([]);
  });
});

describe('countByKind', () => {
  // A chip reading "Write-ups 24" must match what the page shows when clicked,
  // so this counts EVENTS, never runs.
  it('counts events rather than collapsed runs', () => {
    const events = [
      ev('evaluation.writeup.submit', '2026-07-31T06:41:00Z'),
      ev('evaluation.writeup.submit', '2026-07-31T06:39:00Z'),
      ev('entry.update', '2026-07-31T03:00:00Z'),
    ];
    expect(groupTimeline(events)[0].runs).toHaveLength(2);
    expect(countByKind(events)).toMatchObject({ writeups: 2, grades: 1 });
  });

  it('is all zeroes for no events', () => {
    expect(countByKind([])).toEqual({
      grades: 0,
      writeups: 0,
      roster: 0,
      sheets: 0,
      other: 0,
    });
  });
});
