/**
 * The audit-log lines for the context the writers record since 2026-09-17:
 * who the row is about, what a partial write committed, and the per-action
 * keys each route now stamps. Every template that changed also has an OLD-shape
 * row here — `audit_log` is append-only, so the rows already written must keep
 * reading as they did.
 *
 * Contexts are copied from the writers (routes, triggers, migrations 165-168),
 * not invented, so a renamed key fails here rather than silently rendering
 * nothing.
 */
import { describe, expect, it } from 'vitest';

import { auditActionLabel, auditContextSummary } from '@/lib/audit/humanize';
import { ALL_AUDIT_ACTIONS } from '@/lib/audit/log-action';

const line = (action: string, ctx: Record<string, unknown>) =>
  auditContextSummary(action, ctx);

describe('every action has a plain label', () => {
  it('labels the actions added in phase 1', () => {
    expect(auditActionLabel('level.alias.remap')).toBe(
      'Level naming variant re-mapped'
    );
    expect(auditActionLabel('user.password.change')).toBe('Password changed');
    expect(auditActionLabel('sis.student.export_raw')).toBe(
      'Student data downloaded'
    );
    expect(auditActionLabel('declaration.file')).toBe(
      'Declaration filed by a parent'
    );
    expect(auditActionLabel('declaration.file.staff')).toBe(
      'Medical certificate recorded by the school'
    );
    expect(auditActionLabel('declaration.evidence.attach')).toBe(
      'Certificate added to a declaration'
    );
  });

  it('never falls back to a prettified code for a known action', () => {
    for (const action of ALL_AUDIT_ACTIONS) {
      expect(auditActionLabel(action), action).not.toContain('.');
    }
  });
});

describe('who the row is about', () => {
  it('leads with the student, the class, the subject and the term (snake_case)', () => {
    const out = line('entry.update', {
      grading_sheet_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      student_number: 'S2026001',
      student_name: 'Cruz, Ana',
      section_name: 'Diligence',
      level_label: 'Primary 4',
      subject_name: 'Mathematics',
      subject_code: 'MATH',
      term_label: 'Term 2',
      term_number: 2,
      field: 'ww_scores[2]',
      old: '8',
      new: '9',
      was_locked: false,
    });
    expect(out).toBe(
      'Cruz, Ana · Diligence (Primary 4) · Mathematics · Term 2 · Written Work 3: 8 → 9 · pre-lock edit'
    );
    expect(out).not.toContain('S2026001');
    expect(out).not.toContain('a0eebc99');
  });

  it('names the child from camelCase admissions keys', () => {
    const out = line('sis.stp.update', {
      ay_code: 'AY2026',
      enroleeNumber: 'E260117',
      studentNumber: 'S2026117',
      studentName: 'Ana Reyes',
      changes: [
        { field: 'stpApplicationStatus', from: 'Submitted', to: 'Approved' },
      ],
    });
    expect(out).toBe(
      'Ana Reyes · Student Pass application status: Submitted → Approved'
    );
  });

  it('falls back to the student number when no name was recorded', () => {
    const out = line('sis.profile.update', {
      ay_code: 'AY2026',
      enroleeNumber: 'E260117',
      studentNumber: 'S2026117',
      changes: [{ field: 'nickname', from: 'Ann', to: 'Annie' }],
    });
    expect(out).toContain('Student no. S2026117');
    expect(out).toContain('Nickname: Ann → Annie');
  });

  it('does not repeat what the template already says', () => {
    const out = line('attendance.daily.update', {
      section_name: 'Grit',
      student_name: 'Ana Reyes',
      student_number: 'S1',
      date: '2026-02-10',
      prior_status: 'A',
      status: 'P',
    });
    expect(out.match(/Grit/g)).toHaveLength(1);
    expect(out.startsWith('Ana Reyes · Grit')).toBe(true);
  });

  it('never reads a class name as a student (old section.create row)', () => {
    const out = line('section.create', {
      academic_year_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      ay_code: 'AY2026',
      name: 'Diligence',
      level_id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      class_type: null,
      track_bundle_inserted: 0,
      grading_sheets_created: 12,
    });
    expect(out).not.toContain('Student');
    expect(out).toContain('Diligence');
    expect(out).toContain('12 grading sheets created');
  });
});

describe('a write that stopped half-way', () => {
  it('says so first, with the step in words', () => {
    const out = line('attendance.daily.update', {
      section_name: 'Grit',
      student_name: 'Ana Reyes',
      date: '2026-02-10',
      status: 'A',
      partial: true,
      failed_step: 'rollup',
    });
    expect(
      out.startsWith(
        'Only partly saved — stopped at: updating the attendance totals'
      )
    ).toBe(true);
    expect(out).not.toContain('rollup');
  });

  it('reads the camelCase failedStep the upload route writes', () => {
    const out = line('pfile.upload', {
      slotKey: 'passport',
      label: 'Student Passport',
      partial: true,
      failedStep: 'storage_upload',
    });
    expect(out).toContain('Only partly saved — stopped at: uploading the file');
  });
});

describe('rich text never shows its markup', () => {
  it.each([
    [
      'pfile.mark.promised',
      {
        label: 'Passport',
        note: '<p>Parent <strong>will</strong> bring it</p>',
      },
    ],
    [
      'grade_entry.annual_letter.update',
      {
        before: 'B',
        after: 'A',
        correction_note: '<p>Typo in the <em>masterfile</em></p>',
      },
    ],
    [
      'grade_change_requested',
      {
        field: 'qa_score',
        current: '20',
        proposed: '25',
        justification: '<p>Script says <u>25</u></p>',
      },
    ],
    [
      'sis.stage.update',
      {
        stage: 'application',
        stage_label: 'Application',
        changes: [
          {
            field: 'applicationRemarks',
            from: null,
            to: '<p>Moving to <strong>KL</strong></p>',
          },
        ],
      },
    ],
    [
      'some.unknown_action',
      { applicationTerminalNotes: '<ul><li>Visa denied</li></ul>' },
    ],
  ])('%s', (action, ctx) => {
    const out = line(action, ctx as Record<string, unknown>);
    expect(out).not.toMatch(/<\/?[a-z]/i);
  });
});

describe('the generic fallback shows what matters first', () => {
  it('puts the reason and dates ahead of bookkeeping, and never ids', () => {
    const out = line('some.unknown_action', {
      ay_code: 'AY2026',
      module: 'p-files',
      trigger: 'nightly',
      section_student_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      bus_number: 'B12',
      classroom: 'Room 3',
      reason: 'Moved house',
      effective_date: '2026-03-01',
    });
    expect(out).toContain('Reason: Moved house');
    expect(out).toContain('Effective Date: 1 Mar 2026');
    expect(out).not.toContain('p-files');
    expect(out).not.toContain('nightly');
    expect(out).not.toContain('a0eebc99');
    expect(out.indexOf('Reason')).toBeLessThan(out.indexOf('Bus Number'));
  });

  it('renders a list compactly and says how many were left out', () => {
    const out = line('some.unknown_action', {
      classes: [
        'P1 Grit',
        'P2 Valor',
        'P3 Hope',
        'P4 Diligence',
        'P5 Tenacity',
      ],
    });
    expect(out).toBe('Classes: P1 Grit, P2 Valor, P3 Hope +2 more');
  });
});

describe('term configuration', () => {
  it('ay.term_dates.update reads the flat old/new keys', () => {
    const out = line('ay.term_dates.update', {
      academic_year_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      term_number: 3,
      label: 'Term 3',
      old_start_date: '2026-06-01',
      new_start_date: '2026-06-08',
      old_end_date: '2026-08-28',
      new_end_date: '2026-08-28',
      calendar_sync: { deleted: 5, inserted: 0 },
    });
    expect(out).toBe(
      'Term 3 · 1 Jun 2026 to 28 Aug 2026 → 8 Jun 2026 to 28 Aug 2026 · 5 school days removed'
    );
  });

  it('ay.term_dates.update still reads the nested before/after (old row)', () => {
    const out = line('ay.term_dates.update', {
      term_number: 3,
      label: 'Term 3',
      before: { start_date: '2026-06-01', end_date: '2026-08-28' },
      after: { start_date: '2026-06-08', end_date: '2026-08-28' },
      calendar_sync: null,
    });
    expect(out).toContain(
      '1 Jun 2026 to 28 Aug 2026 → 8 Jun 2026 to 28 Aug 2026'
    );
  });

  it('ay.term_virtue.update reads old_/new_virtue_theme and the nested shape', () => {
    expect(
      line('ay.term_virtue.update', {
        term_number: 2,
        label: 'Term 2',
        old_virtue_theme: 'Honesty',
        new_virtue_theme: 'Respect',
      })
    ).toBe('Term 2 · Virtue: Honesty → Respect');
    expect(
      line('ay.term_virtue.update', {
        term_number: 2,
        label: 'Term 2',
        before: { virtue_theme: 'Honesty' },
        after: { virtue_theme: 'Respect' },
      })
    ).toBe('Term 2 · Virtue: Honesty → Respect');
  });

  it('ay.term_grading_lock.update', () => {
    expect(
      line('ay.term_grading_lock.update', {
        term_number: 1,
        label: 'Term 1',
        old_grading_lock_date: '2026-03-20',
        new_grading_lock_date: '2026-03-27',
      })
    ).toBe('Term 1 · Grading lock date: 20 Mar 2026 → 27 Mar 2026');
  });
});

describe('school settings', () => {
  it('renders changes[] with the recorded labels', () => {
    const out = line('school_config.update', {
      changes: [
        {
          field: 'Principal name',
          column: 'principal_name',
          from: 'Ms A',
          to: 'Ms B',
        },
        {
          field: 'School logo',
          column: 'logo_url',
          from: 'https://x/a.png',
          to: 'https://x/b.png',
        },
      ],
      changed_fields: ['Principal name', 'School logo'],
      diff: {},
    });
    expect(out).toBe('Principal name: Ms A → Ms B · School logo changed');
  });

  it('still renders an old row that carries only diff', () => {
    const out = line('school_config.update', {
      diff: { principal_name: { before: 'Ms A', after: 'Ms B' } },
    });
    expect(out).toBe('Principal Name: Ms A → Ms B');
  });
});

describe('relief cover', () => {
  it('a whole-absence booking names both teachers, the classes and who it replaced', () => {
    const out = line('assignment.relief.start', {
      bulk: true,
      covered_teacher_user_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      covered_teacher_name: 'Ms Koh',
      relief_teacher_user_id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      relief_teacher_name: 'Ms Radhika',
      relief_started_on: '2026-10-02',
      relief_ended_on: '2026-10-06',
      relief_reason: 'Medical leave',
      class_labels: ['P4 Diligence · MATH', 'P5 Tenacity · MATH'],
      classes_covered: 2,
      previous_relief_teacher_name: 'Mr Lim',
      previous_covers: [{ class_label: 'P4 Diligence · MATH' }],
      classes_previously_covered: 1,
    });
    expect(out).toBe(
      'Ms Radhika covering Ms Koh · 2 classes: P4 Diligence (MATH), P5 Tenacity (MATH) · from 2 Oct 2026 to 6 Oct 2026 · Medical leave · replacing Mr Lim'
    );
  });

  it('an ended cover names the substitute that finished', () => {
    const out = line('assignment.relief.end', {
      role: 'subject_teacher',
      teacher_name: 'Ms Koh',
      covered_teacher_name: 'Ms Koh',
      relief_teacher_name: null,
      subject_name: 'Mathematics',
      section_name: 'P5 Tenacity',
      previous_relief_teacher_name: 'Ms Radhika',
    });
    expect(out).toContain('Cover for Ms Koh by Ms Radhika');
    expect(out).toContain('Subject teacher, Mathematics, P5 Tenacity');
  });
});

describe('approval steps and people', () => {
  it('approval_stage.update names the rename and the rule change', () => {
    const out = line('approval_stage.update', {
      flow: 'attendance.student_declaration',
      flow_label: 'Attendance · Absence and travel declarations',
      stage_label: 'Officer in charge',
      stage_order: 1,
      previous_label: 'Officer in charge',
      new_label: 'Level officer',
      approval_rule: 'all',
      previous_approval_rule: 'any',
      repointed_waiting: 2,
    });
    expect(out).toContain('Step 1: Officer in charge');
    expect(out).toContain('renamed from Officer in charge to Level officer');
    expect(out).toContain(
      'Rule: Any one of them approves → Everyone must approve'
    );
    expect(out).toContain('2 waiting requests brought in line');
  });

  it('an old approver revoke row (raw flow + level scope) still reads in words', () => {
    const out = line('approval_stage.approver.revoke', {
      stage_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      user_id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      applies_to_level_type: 'primary',
      repointed_waiting: 0,
    });
    expect(out).toBe('Primary only');
  });

  it('approval_stage.approver.assign names the person, step and scope', () => {
    const out = line('approval_stage.approver.assign', {
      stage_label: 'Officer in charge',
      stage_order: 1,
      flow_label: 'Attendance · Absence and travel declarations',
      email: 'lhen@hfse.test',
      display_name: 'Ms Lhen',
      applies_to_label: 'Primary only',
    });
    expect(out).toBe(
      'Attendance · Absence and travel declarations · Step 1: Officer in charge · Ms Lhen (lhen@hfse.test) · Primary only'
    );
  });
});

describe('user accounts', () => {
  it('user.role.update maps role keys to their names', () => {
    const out = line('user.role.update', {
      email: 't@hfse.test',
      display_name: 'Ms Tan',
      previous_roles: ['teacher'],
      new_roles: ['teacher', 'school_admin'],
      roles_added: ['school_admin'],
      roles_removed: [],
      before: { role: 'Teacher' },
      after: { role: 'Teacher, School Admin' },
    });
    expect(out).toBe(
      'Ms Tan (t@hfse.test) · Roles: Teacher → Teacher, School Admin'
    );
  });

  it('user.role.update old row with joined labels', () => {
    expect(
      line('user.role.update', {
        email: 't@hfse.test',
        before: { role: 'Teacher' },
        after: { role: 'School Admin' },
      })
    ).toBe('t@hfse.test · Teacher → School Admin');
  });

  it('user.info.update shows the name and email that changed', () => {
    const out = line('user.info.update', {
      email: 'old@hfse.test',
      before: { displayName: 'Ann' },
      after: { displayName: 'Anna' },
      previous_display_name: 'Ann',
      new_display_name: 'Anna',
      emailChanged: true,
      previous_email: 'old@hfse.test',
      new_email: 'new@hfse.test',
    });
    expect(out).toBe('Name: Ann → Anna · Email: old@hfse.test → new@hfse.test');
  });

  it('user.info.update old row still says the email changed', () => {
    expect(
      line('user.info.update', { email: 'a@hfse.test', emailChanged: true })
    ).toBe('a@hfse.test · email changed');
  });

  it('user.delete names what went with the account', () => {
    const out = line('user.delete', {
      email: 'x@hfse.test',
      display_name: 'Ms X',
      role: 'school_admin',
      roles: ['teacher', 'school_admin'],
      named_stages: [
        { stage_label: 'Officer in charge', flow_label: 'Declarations' },
      ],
      approver_assignments: [{ id: 'z', flow: 'markbook.change_request' }],
    });
    expect(out).toBe(
      'Ms X (x@hfse.test) · Teacher, School Admin · was on 1 approval step: Officer in charge (Declarations) · was a change-request approver'
    );
  });

  it('user.password.change', () => {
    expect(line('user.password.change', { self_service: true })).toBe(
      'Changed their own password on the Account page'
    );
  });
});

describe('sections and year setup', () => {
  it('section.rename reads the new keys and the old from/to', () => {
    expect(
      line('section.rename', {
        from: 'Grit',
        to: 'Valor',
        previous_section_name: 'Grit',
        section_name: 'Valor',
        level_label: 'Primary 1',
      })
    ).toBe('Grit → Valor · Primary 1');
    expect(line('section.rename', { from: 'Grit', to: 'Valor' })).toBe(
      'Grit → Valor'
    );
  });

  it('section.delete lists the teacher assignments that went with it', () => {
    const out = line('section.delete', {
      section_name: 'Diligence',
      sectionName: 'Diligence',
      level_label: 'Primary 4',
      grading_sheets_deleted: 12,
      removed_teacher_assignments: [
        {
          teacher_name: 'Ms Tan',
          role: 'subject_teacher',
          subject_code: 'MATH',
        },
        { teacher_name: 'Mr Koh', role: 'form_adviser', subject_code: null },
      ],
    });
    expect(out).toBe(
      'Diligence (Primary 4) · 12 grading sheets deleted · 2 teacher assignments removed: Ms Tan (MATH), Mr Koh (Form class adviser)'
    );
  });

  it('section.subjects.attach_many names the subjects and the level-wide offering', () => {
    const out = line('section.subjects.attach_many', {
      section_name: 'Diligence',
      level_label: 'Primary 4',
      requestedSubjectCodes: ['MATH', 'SCI'],
      level_offerings_created: ['SCI'],
      subjectCodes: ['MATH', 'SCI'],
      inserted: 2,
      sheetsInserted: 8,
    });
    expect(out).toContain('2 subjects attached: MATH, SCI');
    expect(out).toContain('8 grading sheets created');
    expect(out).toContain('now offered to every class in Primary 4: SCI');
  });

  it('section.track.assign shows the track change', () => {
    expect(
      line('section.track.assign', {
        sectionName: 'Einstein',
        classType: 'Global',
        previousClassType: 'Standard',
        inserted: 0,
      })
    ).toBe('Einstein · Track: Standard → Global');
  });

  it('ay.copy_teacher_assignments names what it created', () => {
    const out = line('ay.copy_teacher_assignments', {
      source_ay: 'AY2025',
      target_ay: 'AY2026',
      copied: 2,
      skipped_already_existed: 1,
      created_assignments: [
        {
          teacher_name: 'Ms Tan',
          class_label: 'P4 Diligence',
          subject_code: 'MATH',
        },
        { teacher_name: 'Mr Koh', class_label: 'P5 Valor', subject_code: null },
      ],
    });
    expect(out).toBe(
      'AY2025 → AY2026 · 2 copied · 1 already there · Ms Tan: P4 Diligence MATH, Mr Koh: P5 Valor'
    );
  });

  it('attendance.calendar.autoseed lists the terms', () => {
    expect(
      line('attendance.calendar.autoseed', {
        ayCode: 'AY2026',
        inserted: 85,
        terms: 2,
        terms_seeded: [
          { term_id: 'x', term_number: 1, inserted: 40 },
          { term_id: 'y', term_number: 2, inserted: 45 },
        ],
      })
    ).toBe('AY2026 · 85 school days added · Term 1: 40, Term 2: 45');
  });

  it('role.permissions.update says what could not be added', () => {
    expect(
      line('role.permissions.update', {
        role: 'academic_coordinator',
        added: [],
        removed: ['a'],
        not_added: ['b', 'c'],
        partial: true,
        failed_step: 'add_permissions',
      })
    ).toBe(
      'Only partly saved — stopped at: adding permissions · Academic Coordinator · −1 removed · 2 could not be added'
    );
  });
});

describe('markbook', () => {
  it('a mark cleared by removing a slot says so', () => {
    const out = line('entry.update', {
      student_name: 'Cruz, Ana',
      section_name: 'Diligence',
      field: 'ww_scores[3]',
      old: '8',
      new: null,
      cleared_by_slot_removal: true,
      was_locked: false,
    });
    expect(out).toContain('Written Work 4: 8 → blank (activity removed)');
  });

  it('a weights change reads as percentages', () => {
    const out = line('totals.update', {
      section_name: 'Diligence',
      field: 'weights',
      old: { ww: null, pt: null, qa: null },
      new: { ww: 40, pt: 60, qa: 0 },
      scope: 'this class only',
      was_locked: false,
    });
    expect(out).toContain(
      'Weights: the same as the subject → Written Work 40%, Performance Task 60%, Quarterly Assessment 0%'
    );
  });

  it('grade change decisions read the decision_note the routes write', () => {
    const out = line('grade_change_rejected', {
      field: 'ww_scores',
      slot_index: 1,
      current: '7',
      proposed: '9',
      decision_note: '<p>The script says 7.</p>',
    });
    expect(out).toBe('Written Work 2: 7 → 9 · The script says 7.');
  });

  it('an old rejection row with rejection_reason still renders', () => {
    const out = line('grade_change_rejected', {
      field: 'qa_score',
      proposed_value: '25',
      rejection_reason: 'Not supported',
    });
    expect(out).toContain('Not supported');
  });

  it('grade_correction shows the justification', () => {
    const out = line('grade_correction', {
      field: 'qa_total',
      old: '30',
      new: '40',
      was_locked: true,
      approval_reference: 'CR-1',
      correction_reason: 'other',
      correction_justification: '<p>Paper was out of 40</p>',
    });
    expect(out).toContain('Quarterly Assessment total: 30 → 40');
    expect(out).toContain('Paper was out of 40');
  });

  it('sheet.labels.update renders slot by slot', () => {
    expect(
      line('sheet.labels.update', {
        subject_name: 'Mathematics',
        section_name: 'Diligence',
        term_label: 'Term 1',
        changes: [
          {
            slot: 'WW3',
            old: { label: 'Quiz 1', date: null, page: null },
            new: { label: 'Quiz 2', date: null, page: null },
          },
          { slot: 'QA', old: null, new: 'Final exam' },
        ],
      })
    ).toBe(
      'Diligence · Mathematics · Term 1 · Written Work 3: “Quiz 1” → “Quiz 2” · Quarterly Assessment: “Final exam”'
    );
  });

  it('sheet.unlock says who had locked it', () => {
    const out = line('sheet.unlock_force_deadline_passed', {
      subject_name: 'Mathematics',
      section_name: 'Diligence',
      term_label: 'Term 1',
      previously_locked_at: '2026-03-28T22:00:00Z',
      previously_locked_by: 'system:grading-deadline',
      lockDate: '2026-03-27',
      pendingCount: 0,
    });
    expect(out).toContain(
      'had been locked automatically at the deadline (28 Mar 2026)'
    );
    expect(out).toContain('grading deadline was 27 Mar 2026');
  });

  it('sheet.lock_overdue_batch names the sheets', () => {
    expect(
      line('sheet.lock_overdue_batch', {
        locked_count: 2,
        run_date: '2026-03-28',
        sheet_ids: ['a', 'b'],
        sheets: [
          {
            section_name: 'Diligence',
            subject_name: 'Maths',
            term_label: 'Term 1',
          },
          {
            section_name: 'Valor',
            subject_name: 'Science',
            term_label: 'Term 1',
          },
        ],
      })
    ).toBe('2 sheets locked · Diligence Maths Term 1, Valor Science Term 1');
  });

  it('sheet.bulk_create lists what it created', () => {
    const out = line('sheet.bulk_create', {
      inserted: 4,
      sheets_created: 4,
      section_names: ['Diligence', 'Valor'],
      term_labels: ['Term 3'],
      subject_names: ['Maths', 'Science'],
    });
    expect(out).toBe('4 sheets · Maths, Science · Diligence, Valor · Term 3');
  });

  it('subject_config.term_weights reads the per-class before and the new after', () => {
    const out = line('subject_config.term_weights', {
      subject_code: 'FIL',
      subject_name: 'Filipino',
      term_number: 3,
      term_label: 'Term 3',
      before: [
        {
          section: 'S3 Consistency',
          follows_subject: true,
          ww: 30,
          pt: 50,
          qa: 20,
        },
        {
          section: 'S3 Integrity',
          follows_subject: false,
          ww: 40,
          pt: 40,
          qa: 20,
        },
      ],
      after: { follows_subject: false, ww: 37, pt: 63, qa: 0 },
      sheets_updated: 2,
      locked_classes_skipped: [],
    });
    expect(out).toBe(
      'Filipino · Term 3 · Weights now: Written Work 37%, Performance Task 63%, Quarterly Assessment 0% · was: S3 Consistency (same as the subject), S3 Integrity (40% / 40% / 20%) · 2 classes updated'
    );
  });

  it('subject_config.term_weights old row (fractions) still renders', () => {
    const out = line('subject_config.term_weights', {
      subject_code: 'FIL',
      term_number: 3,
      before: [
        {
          section: 'S3 Consistency',
          ww_weight: 0.3,
          pt_weight: 0.5,
          qa_weight: 0.2,
        },
      ],
      after: { ww_weight: 0.37, pt_weight: 0.63, qa_weight: 0 },
    });
    expect(out).toContain(
      'Written Work 37%, Performance Task 63%, Quarterly Assessment 0%'
    );
    expect(out).toContain('S3 Consistency (30% / 50% / 20%)');
  });

  it('subject_report_map.update names what it reported under before', () => {
    expect(
      line('subject_report_map.update', {
        subject_code: 'MUS',
        report_subject_code: 'MAPEH',
        previous: [{ report_subject_code: 'ARTS' }],
      })
    ).toBe('MUS now reports under MAPEH · was ARTS');
  });

  it('publication.create reads publish_from / publish_until and the window it replaced', () => {
    const out = line('publication.create', {
      section_name: 'Diamond',
      level_label: 'Primary 5',
      term_label: 'Term 2',
      term_number: 2,
      publish_from: '2026-06-01T00:00:00Z',
      publish_until: '2026-06-30T00:00:00Z',
      previous_publish_from: '2026-05-25T00:00:00Z',
      previous_publish_until: '2026-06-20T00:00:00Z',
      first_publish: false,
    });
    expect(out).toContain('visible to parents 1 Jun 2026 → 30 Jun 2026');
    expect(out).toContain('was 25 May 2026 → 20 Jun 2026');
  });

  it('grade_entry.annual_letter.update', () => {
    expect(
      line('grade_entry.annual_letter.update', {
        student_name: 'Cruz, Ana',
        subject_code: 'MAPEH',
        section_name: 'Diligence',
        before: 'B',
        after: 'A',
        was_locked: true,
      })
    ).toBe(
      'Cruz, Ana · Diligence · MAPEH · Final grade: B → A · sheet was locked'
    );
  });
});

describe('attendance', () => {
  it('a day excused by an approved declaration says where it came from', () => {
    const out = line('attendance.daily.correct', {
      section_name: 'Grit',
      student_name: 'Ana Reyes',
      date: '2026-10-02',
      status: 'EX',
      prior_status: 'A',
      ex_reason: 'mc',
      source: 'declaration_approval',
    });
    expect(out).toContain('Ana Reyes');
    expect(out).toContain('from an approved declaration');
    expect(out).not.toContain('declaration_approval');
  });

  it('calendar upsert reads before_/after_day_type and the label change', () => {
    const out = line('attendance.calendar.upsert', {
      action: 'upsert',
      audience: 'all',
      rows: 1,
      diffs: [
        {
          date: '2026-10-20',
          audience: 'all',
          before_day_type: 'school_day',
          after_day_type: 'public_holiday',
          before_hbl_overlay: false,
          after_hbl_overlay: false,
          label: 'Deepavali (observed)',
          before_label: 'Deepavali',
          after_label: 'Deepavali (observed)',
        },
      ],
    });
    expect(out).toContain('School day → Public holiday');
    expect(out).toContain('“Deepavali” → “Deepavali (observed)”');
    expect(out).not.toContain('upsert');
  });

  it('calendar autofill reads the range', () => {
    const out = line('attendance.calendar.upsert', {
      action: 'autofill_weekdays',
      audience: 'all',
      start: '2026-01-05',
      end: '2026-03-27',
      inserted: 60,
    });
    expect(out).toContain(
      'Weekdays filled in as school days, 5 Jan 2026 → 27 Mar 2026'
    );
    expect(out).toContain('60 days added');
    expect(out).not.toContain('autofill');
  });

  it('calendar delete says what the day was', () => {
    const out = line('attendance.calendar.delete', {
      date: '2026-10-20',
      audience: 'all',
      removed: true,
      before_day_type: 'public_holiday',
      before_label: 'Deepavali',
      before_hbl_overlay: false,
    });
    expect(out).toContain('was Public holiday “Deepavali”');
  });

  it('event update shows what moved', () => {
    const out = line('attendance.event.update', {
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      startDate: '2026-07-14',
      updated: true,
      before: {
        label: 'Leadership Camp',
        startDate: '2026-07-08',
        endDate: '2026-07-10',
        category: 'other',
        audience: 'all',
        levels: null,
        tentative: false,
      },
      after: {
        label: 'Leadership Camp',
        startDate: '2026-07-14',
        endDate: '2026-07-16',
        category: 'other',
        audience: 'primary',
        levels: ['P4', 'P5', 'P6'],
        tentative: false,
      },
    });
    expect(out).toContain('Leadership Camp');
    expect(out).toContain(
      '8 Jul 2026 to 10 Jul 2026 → 14 Jul 2026 to 16 Jul 2026'
    );
    expect(out).toContain('For: ');
    expect(out).toContain('P4, P5, P6');
  });

  it('copy from prior year lists the days it replaced', () => {
    const out = line('attendance.calendar.copy_from_prior_ay', {
      dayTypeRowsCopied: 62,
      eventsCopied: 8,
      markTentative: true,
      overwrittenDays: [
        {
          date: '2026-03-03',
          audience: 'all',
          before_day_type: 'school_day',
          before_label: null,
          after_day_type: 'public_holiday',
          after_label: 'Holiday',
        },
      ],
      copiedEvents: [],
    });
    expect(out).toContain('62 days and 8 events copied');
    expect(out).toContain(
      '1 day replaced: 3 Mar 2026: School day → Public holiday “Holiday”'
    );
  });

  it('a parent filing reads as a filing, not a decision', () => {
    const out = line('declaration.file', {
      filed_by: 'parent',
      status: 'pending',
      children_in_filing: 2,
      declaration_type: 'absence',
      student_name: 'Ana Reyes',
      section_name: 'P4 Diligence',
      start_date: '2026-10-02',
      end_date: '2026-10-03',
      with_medical: true,
      evidence_kind: 'file',
      parent_note_present: true,
      approval_steps_configured: true,
    });
    expect(out).toBe(
      'Ana Reyes · P4 Diligence · 2 Oct 2026 → 3 Oct 2026 · absence · with certificate · filed by a parent · certificate uploaded · parent added a note · filed for 2 children together'
    );
  });

  it('a certificate attached to a pending filing does not claim an approval', () => {
    const out = line('declaration.evidence.attach', {
      recorded_by_school: true,
      attached_to_existing: true,
      status: 'pending',
      replaced_existing: true,
      replaced_evidence_path: 'ay2026/x.pdf',
      replaced_evidence_kind: 'link',
      declaration_type: 'absence',
      with_medical: true,
      evidence_kind: 'file',
      student_name: 'Ana Reyes',
      section_name: 'P4 Diligence',
      start_date: '2026-10-02',
      end_date: '2026-10-02',
    });
    expect(out).toContain('certificate on the parent’s filing replaced');
    expect(out).toContain('a certificate link was replaced');
    expect(out).toContain('still waiting for approval');
    expect(out).not.toContain('x.pdf');
    expect(out).not.toMatch(/fully approved/);
  });

  it('declaration.file.staff reads as the office recording it', () => {
    const out = line('declaration.file.staff', {
      recorded_by_school: true,
      status: 'approved',
      declaration_type: 'absence',
      with_medical: true,
      evidence_kind: 'link',
      section_name: 'P4 Diligence',
      start_date: '2026-10-02',
      end_date: '2026-10-02',
    });
    expect(out).toContain('recorded by the school office');
    expect(out).toContain('certificate link');
  });

  it('a declaration approval says how many register days it marked', () => {
    const out = line('declaration.approve', {
      outcome: 'completed',
      stage_label: 'Officer in charge',
      section_name: 'P4 Diligence',
      student_name: 'Ana Reyes',
      register_days_written: 2,
      register_write_failed: false,
    });
    expect(out).toContain('2 days marked Excused on the register');
  });
});

describe('p-files and admissions documents', () => {
  it('pfile.upload names the document and what changed', () => {
    const out = line('pfile.upload', {
      ay_code: 'AY2026',
      enroleeNumber: 'E260117',
      studentNumber: 'S1',
      studentName: 'Ana Reyes',
      slotKey: 'passport',
      label: 'Student Passport',
      fileCount: 1,
      merged: false,
      replaced: true,
      archived: false,
      archiveFailed: true,
      archiveError: 'nope',
      oldUrl: 'https://storage/x',
      newUrl: 'https://storage/y',
      priorStatus: 'Expired',
      newStatus: 'Valid',
      priorExpiry: '2026-01-01',
      expiryDate: '2031-01-01',
      priorPassportNumber: 'P1',
      passportNumber: 'P2',
    });
    expect(out).toBe(
      'Ana Reyes · Student Passport · replaced the previous file · Status: Expired → Valid · Expires: 1 Jan 2026 → 1 Jan 2031 · passport number changed · the old file could not be kept as a past version'
    );
    expect(out).not.toContain('https');
  });

  it('pfile.upload old row still renders', () => {
    const out = line('pfile.upload', {
      slotKey: 'passport',
      label: 'Passport',
      fileCount: 2,
      merged: true,
      replaced: false,
      expiryDate: '2030-01-01',
      passportNumber: 'P1',
    });
    expect(out).toBe(
      'Passport · 2 files merged into one · Expires: 1 Jan 2030 · passport number recorded'
    );
  });

  it('mark.promised shows the status, the date and the note', () => {
    const out = line('admissions.mark.promised', {
      ay_code: 'AY2026',
      studentName: 'Ana Reyes',
      slot_key: 'birthCert',
      label: 'Birth Certificate',
      module: 'admissions',
      promised_until: '2026-10-30',
      prior_status: 'Missing',
      new_status: 'To follow',
      note: '<p>Mum will bring it</p>',
    });
    expect(out).toBe(
      'Ana Reyes · Birth Certificate · Missing → To follow · promised by 30 Oct 2026 · Mum will bring it'
    );
  });

  it('reminder.sent says who it went to; an old row uses the slot key', () => {
    expect(
      line('pfile.reminder.sent', {
        studentName: 'Ana Reyes',
        slot_key: 'passport',
        label: 'Student Passport',
        to: 'mum@x.test',
        cc: ['dad@x.test'],
        recipients: 1,
        sent: 1,
        failed: 0,
      })
    ).toBe(
      'Ana Reyes · Student Passport · emailed to mum@x.test (copy to dad@x.test)'
    );
    expect(
      line('pfile.reminder.sent', {
        slot_key: 'passport',
        recipients: 1,
        sent: 1,
        failed: 0,
      })
    ).toBe('Student Passport · 1 email sent');
  });

  it('reminder.bulk names who was and was not emailed', () => {
    const out = line('pfile.reminder.bulk', {
      sent: 2,
      emailed: [
        {
          studentName: 'Ana Reyes',
          slot_key: 'passport',
          label: 'Student Passport',
          to: 'a@x',
        },
        {
          studentName: 'Ben Cruz',
          slot_key: 'pass',
          label: 'Student Pass',
          to: 'b@x',
        },
      ],
      not_emailed: [
        { enroleeNumber: 'E1', slot_key: 'pass', reason: 'cooldown' },
        { enroleeNumber: 'E2', slot_key: 'pass', reason: 'no_recipients' },
      ],
    });
    expect(out).toBe(
      '2 reminders emailed: Ana Reyes (Student Passport), Ben Cruz (Student Pass) · 2 not emailed (reminded recently ×1, no parent email on file ×1)'
    );
  });

  it('auto-expire summarises by document, new and old shapes', () => {
    expect(
      line('sis.documents.auto-expire', {
        ayCode: 'AY2026',
        flippedCount: 3,
        truncated: 0,
        flips: [
          {
            enrolee_number: 'E1',
            slot_key: 'passport',
            from: 'Valid',
            to: 'Expired',
          },
          {
            enrolee_number: 'E2',
            slot_key: 'passport',
            from: 'Valid',
            to: 'Expired',
          },
          {
            enrolee_number: 'E2',
            slot_key: 'pass',
            from: 'Valid',
            to: 'Expired',
          },
        ],
      })
    ).toBe(
      '3 documents expired: Student Passport ×2, Student Pass ×1 · 2 students'
    );
    expect(
      line('sis.documents.auto-revive', {
        revivedCount: 5,
        revivedBySlot: { pass: 5 },
        enroleeNumbers: ['E1', 'E2'],
        truncated: 0,
      })
    ).toBe('5 documents valid again: Student Pass ×5 · 2 students');
  });

  it('sis.document.reject shows the label, status move and reason', () => {
    expect(
      line('sis.document.reject', {
        studentName: 'Ana Reyes',
        slot_key: 'passport',
        label: 'Student Passport',
        prior_status: 'Uploaded',
        new_status: 'Rejected',
        file_url: 'https://storage/x',
        rejection_reason: '<p>Blurry</p>',
        notified: true,
      })
    ).toBe(
      'Ana Reyes · Student Passport · Uploaded → Rejected · Blurry · parent emailed'
    );
  });
});

describe('admissions', () => {
  it('sis.stage.update names the stage, the status move, reason and remarks', () => {
    const out = line('sis.stage.update', {
      ay_code: 'AY2026',
      stage: 'application',
      stage_label: 'Application',
      changes: [
        { field: 'applicationStatus', from: 'Registered', to: 'Withdrawn' },
        { field: 'applicationRemarks', from: null, to: '<p>Relocating</p>' },
        {
          field: 'applicationTerminalReason',
          from: null,
          to: 'family_relocation',
        },
      ],
      terminalReason: 'family_relocation',
      terminalNotes: null,
    });
    expect(out).toBe(
      'Application: Registered → Withdrawn · Reason: Family relocating overseas · Remarks: Relocating'
    );
  });

  it('discount codes: new flat keys, old nested values', () => {
    expect(
      line('sis.discount_code.create', {
        ay_code: 'AY2026',
        discount_code: 'EARLY10',
        enrolee_type: 'New',
        start_date: '2026-01-01',
        end_date: '2026-03-31',
        details: null,
        values: {},
      })
    ).toBe('EARLY10 · New · 1 Jan 2026 to 31 Mar 2026');
    expect(
      line('sis.discount_code.create', {
        ay_code: 'AY2026',
        values: {
          discountCode: 'EARLY10',
          enroleeType: 'New',
          startDate: '2026-01-01',
          endDate: '2026-03-31',
        },
      })
    ).toBe('EARLY10 · New · 1 Jan 2026 to 31 Mar 2026');
    expect(
      line('sis.discount_code.update', {
        discount_code: 'EARLY15',
        previous_discount_code: 'EARLY10',
        changes: [
          { field: 'discountCode', from: 'EARLY10', to: 'EARLY15' },
          { field: 'endDate', from: '2026-03-31', to: '2026-04-30' },
        ],
      })
    ).toBe('EARLY10 → EARLY15 · End date: 31 Mar 2026 → 30 Apr 2026');
  });

  it('level aliases', () => {
    expect(
      line('level.alias.remap', {
        raw_label: 'P 4',
        mapped_to_code: 'P4',
        mapped_to_label: 'Primary 4',
        remapped_from_level_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        remapped_from_code: 'P5',
        remapped_from_label: 'Primary 5',
      })
    ).toBe('“P 4” now means Primary 4 · was Primary 5');
    expect(
      line('level.alias.create', {
        raw_label: 'P 4',
        mapped_to_label: 'Primary 4',
        remapped_from_level_id: null,
      })
    ).toBe('“P 4” now means Primary 4');
  });

  it('accepting applications, new and old shapes', () => {
    expect(
      line('ay.accepting_applications.toggle', {
        ay_code: 'AY2027',
        before: false,
        after: true,
        auto_closed_previous: ['AY2026'],
      })
    ).toBe('AY2027 opened for applications · closed AY2026');
    expect(
      line('ay.accepting_applications.toggle', {
        ay_code: 'AY2026',
        before: true,
        after: false,
        autoClosedBy: 'AY2027',
      })
    ).toBe('AY2026 closed for applications · because AY2027 was opened');
  });
});

describe('records', () => {
  it('a withdrawal shows the last day, approval date and reason', () => {
    const out = line('enrolment.metadata.update', {
      section_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      ay_code: 'AY2026',
      studentNumber: 'S1',
      studentName: 'Ashley Rae Cama',
      enroleeNumber: 'E1',
      section_name: 'Consistency',
      index_number: 5,
      before: {
        bus_no: null,
        enrollment_status: 'active',
        enrollment_date: '2026-01-05',
        withdrawal_date: null,
        withdrawal_approved_date: null,
        withdrawal_reason: null,
        withdrawal_notes: null,
      },
      after: {
        enrollment_status: 'withdrawn',
        withdrawal_date: '2026-04-26',
        withdrawal_approved_date: '2026-05-11',
        withdrawal_reason: 'family_relocation',
        withdrawal_notes: '<p>Moving to KL</p>',
      },
    });
    expect(out).toContain('Ashley Rae Cama · Consistency');
    expect(out).toContain('Active → Withdrawn');
    expect(out).toContain('Last day: 26 Apr 2026');
    expect(out).toContain('Withdrawal approved: 11 May 2026');
    expect(out).toContain('Withdrawal reason: ');
    expect(out).toContain('Moving to KL');
    expect(out).not.toContain('<p>');
  });

  it('an old withdrawal row does not call the click date a last day', () => {
    const out = line('enrolment.metadata.update', {
      before: { enrollment_status: 'active' },
      after: { enrollment_status: 'withdrawn', withdrawal_date: '2026-10-15' },
    });
    expect(out).toBe('Active → Withdrawn · Withdrawal date: 15 Oct 2026');
  });

  it('student.withdrawal.cascade names the classes and the dates', () => {
    const out = line('student.withdrawal.cascade', {
      trigger: 'stage.application.withdrawn',
      enroleeNumber: 'E1',
      studentNumber: 'S1',
      studentName: 'Ana Reyes',
      rowsAffected: 1,
      sections: [
        {
          section_name: 'Diligence',
          index_number: 7,
          previous_status: 'active',
        },
      ],
      withdrawal_date: '2026-04-26',
      withdrawal_approved_date: null,
      withdrawal_reason: 'financial',
      applicationStatus_after: 'Withdrawn',
    });
    expect(
      out.startsWith(
        'Ana Reyes · Withdrawn · taken off Diligence #7 · Last day: 26 Apr 2026 · '
      )
    ).toBe(true);
    expect(out).not.toContain('financial');
    expect(out).not.toContain('Withdrawal approved');
  });

  it('student.section.transfer shows index numbers and a return', () => {
    const out = line('student.section.transfer', {
      studentName: 'Ana Reyes',
      fromSection: 'Grit',
      toSection: 'Valor',
      termNumber: 2,
      from_index_number: 4,
      to_index_number: 31,
      returned_to_previous_section: true,
    });
    expect(out).toBe(
      'Ana Reyes · Grit #4 → Valor #31 · Term 2 · returned to a class they had left before'
    );
  });

  it('student.sync bulk counts and names', () => {
    const out = line('student.sync', {
      ay_code: 'AY2026',
      trigger: 'bulk',
      added: 1,
      updated: 0,
      enrolled: 1,
      withdrawn: 1,
      reactivated: 0,
      errors: 0,
      changes: [
        { student_number: 'S1', change: 'added', name: 'Ana Reyes' },
        {
          student_number: 'S1',
          change: 'enrolled',
          name: 'Ana Reyes',
          section: 'Grit',
          level: 'Primary 1',
          index_number: 30,
        },
        {
          student_number: 'S2',
          change: 'withdrawn',
          name: 'Ben Cruz',
          section: 'Valor',
          from: 'active',
          to: 'withdrawn',
        },
      ],
      skipped: [],
    });
    expect(out).toBe(
      '1 added, 1 placed in a class, 1 withdrawn · Withdrawn: Ben Cruz (Valor) · Placed: Ana Reyes (Grit) · Added: Ana Reyes'
    );
  });

  it('student.sync old count-only row still renders', () => {
    expect(
      line('student.sync', {
        ay_code: 'AY2026',
        added: 2,
        updated: 0,
        enrolled: 2,
        withdrawn: 0,
        reactivated: 0,
        errors: 0,
      })
    ).toBe('2 added, 2 placed in a class');
  });

  it('auto sync batch names students per outcome', () => {
    expect(
      line('sis.student.auto_sync_batch', {
        run_date: '2026-09-17',
        total_candidates: 3,
        by_outcome: { enrolled: 2, skipped: 1 },
        students_by_outcome: {
          enrolled: [{ name: 'Ana Reyes' }, { name: 'Ben Cruz' }],
          skipped: [{ name: 'Cara Lim' }],
        },
        failures: [{ name: 'Cara Lim', error: 'no class' }],
        errors: ['E3: no class'],
      })
    ).toBe(
      '3 students checked · 2 placed in a class (Ana Reyes, Ben Cruz), 1 skipped (Cara Lim) · could not sync: Cara Lim'
    );
  });

  it('assign_section shows the start date change', () => {
    const out = line('sis.student.assign_section', {
      enroleeFullName: 'Ana Reyes',
      sectionName: 'Grit',
      levelLabel: 'Primary 1',
      index_number: 30,
      enrollment_date_before: '2026-01-05',
      enrollment_date_after: '2026-10-17',
    });
    expect(out).toBe(
      'Ana Reyes · Grit (Primary 1) · index #30 · Start date: 5 Jan 2026 → 17 Oct 2026'
    );
  });

  it('residence history changes read as added/removed lines', () => {
    const out = line('sis.profile.update', {
      studentNumber: 'S1',
      changes: [
        {
          field: 'residenceHistory',
          from: ['2019–2023 · Manila, Philippines · Study'],
          to: [
            '2019–2023 · Manila, Philippines · Study',
            '2023–2026 · Singapore',
          ],
        },
      ],
    });
    expect(out).toBe(
      'Student no. S1 · Residence history: added 2023–2026, Singapore'
    );
  });

  it('an old residence-history row (raw entries) does not print JSON', () => {
    const out = line('sis.profile.update', {
      changes: [
        {
          field: 'residenceHistory',
          from: [{ country: 'PH' }],
          to: [{ country: 'SG' }],
        },
      ],
    });
    expect(out).toBe('Residence history changed');
  });

  it('sis.student.export_raw', () => {
    expect(
      line('sis.student.export_raw', {
        ay_code: 'AY2026',
        source: 'admissions',
        table: 'enrolment_applications',
        requested_count: 42,
        row_count: 42,
        columns: ['a', 'b', 'c'],
      })
    ).toBe('42 students downloaded · 3 columns · AY2026');
  });
});

describe('classroom', () => {
  it('discipline.record.file names the record, never the narrative', () => {
    const out = line('discipline.record.file', {
      studentNumber: 'S1',
      student_number: 'S1',
      student_name: 'Ana Reyes',
      section_name: 'Discipline 1',
      level_label: 'Sec 1',
      record_type: 'letter',
      record_type_label: 'Letter sent',
      occurred_on: '2026-10-01',
      nature: 'Late arrivals',
      document_url_present: true,
      details_length: 120,
      remarks_length: 0,
    });
    expect(out).toBe(
      'Ana Reyes · Discipline 1 (Sec 1) · Letter sent · 1 Oct 2026 · Late arrivals · document link attached'
    );
  });

  it('discipline.record.update lists what changed; old rows diff before/after', () => {
    const out = line('discipline.record.update', {
      student_name: 'Ana Reyes',
      section_name: 'Discipline 1',
      before: {
        record_type: 'incident',
        record_type_label: 'Incident',
        occurred_on: '2026-10-01',
        nature: 'Late',
        acknowledged_on: null,
      },
      after: {
        record_type: 'incident',
        record_type_label: 'Incident',
        occurred_on: '2026-10-02',
        nature: 'Late',
        acknowledged_on: null,
      },
      changed_fields: ['occurred_on', 'details'],
      edited_by_filer: true,
    });
    expect(out).toBe(
      'Ana Reyes · Discipline 1 · Incident · Date: 1 Oct 2026 → 2 Oct 2026 · changed: date, details'
    );
    const old = line('discipline.record.update', {
      studentNumber: 'S1',
      before: {
        record_type: 'incident',
        occurred_on: '2026-10-01',
        nature: 'Late',
        acknowledged_on: null,
      },
      after: {
        record_type: 'letter',
        occurred_on: '2026-10-01',
        nature: 'Late',
        acknowledged_on: '2026-10-03',
      },
      edited_by_filer: false,
    });
    expect(old).toContain('Incident → Letter sent');
    expect(old).toContain('Acknowledged: 3 Oct 2026');
    expect(old).toContain(
      'edited by someone other than the person who filed it'
    );
  });

  it('classroom.note.save names the class', () => {
    expect(
      line('classroom.note.save', {
        section_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        section_name: 'Diligence',
        level_code: 'P4',
        level_label: 'Primary 4',
        length: 42,
      })
    ).toBe('Diligence (Primary 4) · 42 characters');
  });

  it('evaluation write-ups name the child, class and term', () => {
    expect(
      line('evaluation.writeup.submit', {
        submitted: true,
        un_submitted: false,
        length: 240,
        ay_code: 'AY2026',
        term_number: 2,
        term_label: 'Term 2',
        section_name: 'Diligence',
        level_label: 'Primary 4',
        student_number: 'S1',
        student_name: 'Reyes, Ana',
      })
    ).toBe(
      'Reyes, Ana · Diligence (Primary 4) · Term 2 · Submitted · 240 characters'
    );
  });
});
