import { describe, expect, it } from 'vitest';
import {
  auditActionLabel,
  auditActionTone,
  auditContextSummary,
} from '@/lib/audit/humanize';

describe('auditActionLabel', () => {
  it('labels known actions in plain English', () => {
    expect(auditActionLabel('entry.update')).toBe('Grade updated');
    expect(auditActionLabel('sheet.lock')).toBe('Sheet locked');
    expect(auditActionLabel('attendance.calendar.upsert')).toBe(
      'School calendar updated'
    );
    expect(auditActionLabel('attendance.event.create')).toBe(
      'Calendar event added'
    );
    expect(auditActionLabel('sis.document.approve')).toBe('Document approved');
    expect(auditActionLabel('publication.create')).toBe(
      'Report card published'
    );
    expect(auditActionLabel('student.section.transfer')).toBe(
      'Section transfer'
    );
    expect(auditActionLabel('evaluation.writeup.submit')).toBe(
      'Write-up submitted'
    );
    expect(auditActionLabel('user.create')).toBe('User created');
    expect(auditActionLabel('ay.term_dates.update')).toBe('Term dates updated');
    expect(auditActionLabel('parent.session.issued')).toBe('Parent signed in');
  });

  it('prettifies unknown action codes so a raw code never leaks', () => {
    expect(auditActionLabel('some.brand_new.action')).toBe(
      'Some Brand New Action'
    );
    expect(auditActionLabel('widget_frobnicate')).toBe('Widget Frobnicate');
  });
});

describe('auditActionTone', () => {
  it('classifies destructive actions', () => {
    expect(auditActionTone('attendance.event.delete')).toBe('destructive');
    expect(auditActionTone('sis.document.reject')).toBe('destructive');
    expect(auditActionTone('student.withdrawal.cascade')).toBe('destructive');
    expect(auditActionTone('user.disable')).toBe('destructive');
    expect(auditActionTone('sis.documents.auto-expire')).toBe('destructive');
    expect(auditActionTone('ay.delete')).toBe('destructive');
  });

  it('classifies warning actions', () => {
    expect(auditActionTone('sheet.unlock')).toBe('warning');
    expect(auditActionTone('sheet.lock_overdue_batch')).toBe('warning');
    expect(auditActionTone('sheet.unlock_force_deadline_passed')).toBe(
      'warning'
    );
    expect(auditActionTone('approver.revoke')).toBe('warning');
  });

  it('classifies info actions', () => {
    expect(auditActionTone('user.login')).toBe('info');
    expect(auditActionTone('parent.session.issued')).toBe('info');
    expect(auditActionTone('environment.seed')).toBe('info');
    expect(auditActionTone('environment.topup')).toBe('info');
    expect(auditActionTone('student.sync')).toBe('info');
    expect(auditActionTone('pfile.reminder.sent')).toBe('info');
  });

  it('defaults everything else', () => {
    expect(auditActionTone('entry.update')).toBe('default');
    expect(auditActionTone('publication.create')).toBe('default');
    expect(auditActionTone('section.create')).toBe('default');
  });
});

describe('auditContextSummary — empty / missing', () => {
  it('returns dash for null / undefined / empty', () => {
    expect(auditContextSummary('entry.update', null)).toBe('—');
    expect(auditContextSummary('entry.update', undefined)).toBe('—');
    expect(auditContextSummary('entry.update', {})).toBe('—');
  });
});

describe('auditContextSummary — generic shapes', () => {
  it('renders changes[] {field, from, to}', () => {
    const out = auditContextSummary('some.action', {
      changes: [
        { field: 'first_name', from: 'Ann', to: 'Anna' },
        { field: 'last_name', from: 'Lee', to: 'Lim' },
      ],
    });
    expect(out).toContain('First Name: Ann → Anna');
    expect(out).toContain('Last Name: Lee → Lim');
  });

  it('caps long changes[] lists with +N more', () => {
    const changes = Array.from({ length: 7 }, (_, i) => ({
      field: `field_${i}`,
      from: 'a',
      to: 'b',
    }));
    const out = auditContextSummary('some.action', { changes });
    expect(out).toContain('+3 more');
  });

  it('renders before/after objects per key', () => {
    const out = auditContextSummary('some.action', {
      before: { grade: 85, remark: 'ok' },
      after: { grade: 90, remark: 'ok' },
    });
    expect(out).toContain('Grade: 85 → 90');
    // unchanged key (remark) omitted
    expect(out).not.toContain('Remark');
  });

  it('renders scalar field + old/new', () => {
    const out = auditContextSummary('some.action', {
      field: 'score',
      old: 7,
      new: 9,
    });
    expect(out).toBe('Score: 7 → 9');
  });

  it('prettifies remaining scalar entries', () => {
    const out = auditContextSummary('some.action', {
      bus_number: 'B12',
      classroom: 'Room 3',
    });
    expect(out).toContain('Bus Number: B12');
    expect(out).toContain('Classroom: Room 3');
  });
});

describe('auditContextSummary — id / UUID skipping', () => {
  it('skips id, *_id, *Id and UUID-valued keys', () => {
    const out = auditContextSummary('some.action', {
      id: '123',
      section_id: 'abc',
      sectionId: 'def',
      label: 'Sports Day',
    });
    expect(out).toBe('Label: Sports Day');
    expect(out).not.toContain('123');
    expect(out).not.toContain('abc');
    expect(out).not.toContain('def');
  });
});

describe('auditContextSummary — enum humanization', () => {
  it('labels day_type in calendar diffs', () => {
    const out = auditContextSummary('attendance.calendar.upsert', {
      audience: 'primary',
      old_day_type: 'school_day',
      new_day_type: 'public_holiday',
      date: '2026-03-15',
    });
    expect(out).toContain('Primary');
    expect(out).toContain('School day → Public holiday');
  });

  it('labels enrollment_status in enrolment metadata', () => {
    const out = auditContextSummary('enrolment.metadata.update', {
      before: { enrollment_status: 'active' },
      after: { enrollment_status: 'withdrawn' },
    });
    expect(out).toBe('Active → Withdrawn');
  });

  it('labels day_type via generic before/after path too', () => {
    const out = auditContextSummary('some.action', {
      before: { day_type: 'hbl' },
      after: { day_type: 'school_day' },
    });
    expect(out).toBe('Day Type: HBL → School day');
  });
});

describe('auditContextSummary — per-action templates', () => {
  it('entry.update reports field + post-lock + reference', () => {
    const out = auditContextSummary('entry.update', {
      field: 'qa_score',
      old: 20,
      new: 25,
      was_locked: true,
      approval_reference: 'CR-2026-001',
    });
    expect(out).toContain('Qa Score: 20 → 25');
    expect(out).toContain('post-lock edit');
    expect(out).toContain('ref CR-2026-001');
  });

  it('attendance.daily.update reports section/date/status', () => {
    const out = auditContextSummary('attendance.daily.update', {
      section_name: 'P1 Grit',
      date: '2026-02-10',
      prior_status: 'A',
      status: 'P',
    });
    expect(out).toContain('P1 Grit');
    expect(out).toContain('Feb');
    expect(out).toContain('Absent → Present');
  });

  it('evaluation.writeup.submit reports submitted + length', () => {
    const out = auditContextSummary('evaluation.writeup.submit', {
      submitted: true,
      length: 240,
    });
    expect(out).toContain('Submitted');
    expect(out).toContain('240 characters');
  });

  it('section.realphabetize reports rows renumbered', () => {
    const out = auditContextSummary('section.realphabetize', {
      rows_renumbered: 18,
    });
    expect(out).toBe('18 students renumbered');
  });
});

describe('auditContextSummary — never emits JSON', () => {
  const inputs: Array<[string, Record<string, unknown>]> = [
    ['entry.update', { field: 'x', old: 1, new: 2, nested: { a: 1 } }],
    ['some.action', { weird: { deep: { thing: true } }, label: 'ok' }],
    [
      'attendance.calendar.upsert',
      {
        diffs: [
          {
            date: '2026-01-01',
            old_day_type: 'school_day',
            new_day_type: 'hbl',
          },
        ],
      },
    ],
    [
      'enrolment.metadata.update',
      {
        before: { enrollment_status: 'active', meta: { x: 1 } },
        after: { enrollment_status: 'withdrawn' },
      },
    ],
    [
      'some.action',
      { changes: [{ field: 'a', from: { x: 1 }, to: { y: 2 } }] },
    ],
    [
      'publication.create',
      {
        term_number: 1,
        window_start: '2026-04-01T00:00:00Z',
        window_end: '2026-04-30T00:00:00Z',
      },
    ],
    ['user.role.update', { old_role: 'teacher', new_role: 'school_admin' }],
    ['some.action', { arbitrary: [1, 2, 3], blob: { nope: 'no' } }],
    // TEMPLATE path (sis.document.approve) with an object-valued context field
    [
      'sis.document.approve',
      { slot_label: { code: 'passport' }, status: 'Valid' },
    ],
  ];

  it.each(inputs)('output has no braces for %s', (action, ctx) => {
    const out = auditContextSummary(action, ctx);
    expect(out).not.toContain('{');
    expect(out).not.toContain('}');
  });
});
