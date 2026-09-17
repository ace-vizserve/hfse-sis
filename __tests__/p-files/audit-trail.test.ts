/**
 * The P-Files and Evaluation audit trail says who, which document, and what
 * committed — including when a later step failed (2026-09-17).
 *
 * Before this: no P-Files row named the student; the upload and promise routes
 * returned early on a failure AFTER a committed write and left no row; the
 * auto expire/revive sweep kept the first 50 enrolee numbers and a count; and
 * the write-up trigger recorded neither the student, the class nor the term.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildFreshenFlips } from '@/lib/p-files/audit';

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('buildFreshenFlips', () => {
  it('lists every flipped document, split by slot, with no cap', () => {
    const many = Array.from({ length: 120 }, (_, i) => `E26${1000 + i}`);
    const flips = buildFreshenFlips(
      'expire',
      [
        { slotKey: 'passport', enroleeNumbers: many },
        { slotKey: 'pass', enroleeNumbers: ['E261000'] },
      ],
      new Map([['E261000', 'S123']])
    );
    expect(flips).toHaveLength(121);
    expect(flips.filter((f) => f.slot_key === 'passport')).toHaveLength(120);
    expect(flips.find((f) => f.slot_key === 'pass')).toEqual({
      enrolee_number: 'E261000',
      student_number: 'S123',
      slot_key: 'pass',
      from: 'Valid',
      to: 'Expired',
    });
  });

  it('records the revive direction the other way round', () => {
    const [flip] = buildFreshenFlips(
      'revive',
      [{ slotKey: 'passport', enroleeNumbers: ['E1'] }],
      new Map()
    );
    expect(flip).toMatchObject({
      student_number: null,
      from: 'Expired',
      to: 'Valid',
    });
  });

  it('the sweep no longer slices its enrolee lists', () => {
    const text = source('lib/p-files/freshen-document-statuses.ts');
    expect(text).not.toMatch(/\.slice\(0,\s*50\)/);
    expect(text).toContain("flips: buildFreshenFlips('expire'");
    expect(text).toContain("flips: buildFreshenFlips('revive'");
  });
});

describe('failure paths still write the audit row', () => {
  it('upload logs a partial row from each exit after a committed step', () => {
    const text = source('app/api/p-files/[enroleeNumber]/upload/route.ts');
    for (const step of [
      'storage_upload',
      'document_update',
      'no_document_row',
      'application_metadata',
    ]) {
      expect(text, `no partial audit for ${step}`).toContain(`step: '${step}'`);
    }
    // The old early return for the metadata failure sat BEFORE the only log.
    const metaFail = text.indexOf("step: 'application_metadata'");
    const warning = text.indexOf('application metadata update failed');
    expect(metaFail).toBeGreaterThan(-1);
    expect(metaFail).toBeLessThan(warning);
    // `replaced` means a file was there, not "the archive move worked".
    expect(text).toContain('replaced: currentUrl !== null');
    expect(text).toContain('archiveFailed: true');
  });

  it('promise logs when the outreach insert fails after the status flip', () => {
    const text = source('app/api/p-files/[enroleeNumber]/promise/route.ts');
    const insertFail = text.indexOf("step: 'outreach_insert'");
    const fiveHundred = text.indexOf('tracking insert failed');
    expect(insertFail).toBeGreaterThan(-1);
    expect(insertFail).toBeLessThan(fiveHundred);
  });
});

describe('P-Files rows name the student', () => {
  it.each([
    'app/api/p-files/[enroleeNumber]/upload/route.ts',
    'app/api/p-files/[enroleeNumber]/promise/route.ts',
    'app/api/sis/students/[enroleeNumber]/document/[slotKey]/route.ts',
  ])('%s stamps the applicant identity', (file) => {
    expect(source(file)).toMatch(/loadApplicantIdentity\(/);
  });

  it('reminders carry the student and the addresses', () => {
    const single = source('app/api/p-files/[enroleeNumber]/notify/route.ts');
    expect(single).toContain('...result.student');
    expect(single).toContain('to: result.to');
    const bulk = source('app/api/p-files/notify/bulk/route.ts');
    expect(bulk).toContain('emailed:');
    expect(bulk).toContain('not_emailed:');
  });

  it('approve / reject records the file that was judged', () => {
    const text = source(
      'app/api/sis/students/[enroleeNumber]/document/[slotKey]/route.ts'
    );
    expect(text).toContain('file_url: fileUrl');
  });
});

describe('evaluation write-ups', () => {
  it('the retired PATCH route answers 410 and cannot double-log', () => {
    const text = source('app/api/evaluation/writeups/route.ts');
    expect(text).toContain("{ error: 'Gone' }, { status: 410 }");
    expect(text).not.toContain('logAction');
  });

  it('migration 167 names the student, class and term and counts prose', () => {
    const sql = source(
      'supabase/migrations/167_evaluation_writeup_audit_context.sql'
    );
    for (const key of [
      'term_number',
      'section_name',
      'student_number',
      'student_name',
    ]) {
      expect(sql).toContain(`'${key}'`);
    }
    expect(sql).toContain(
      "'length', public.rich_text_prose_length(new.writeup)"
    );
    // entity_id stays the write-up id — the Classroom timeline keys on it.
    expect(sql).toMatch(/'evaluation_writeup',\s*\n\s*new\.id,/);
  });

  it('virtue theme rows carry flat old/new keys', () => {
    const text = source('app/api/evaluation/virtue-theme/route.ts');
    expect(text).toContain('old_virtue_theme:');
    expect(text).toContain('new_virtue_theme: virtueTheme');
  });
});
