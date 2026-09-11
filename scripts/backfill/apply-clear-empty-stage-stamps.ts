// scripts/backfill/apply-clear-empty-stage-stamps.ts
// Clears the "last updated" stamp from any admissions stage that carries one
// while holding no status, no fields and no remarks.
//
// Those stamps came from saves the dialog used to allow before a status was
// required: nothing was written, but `<stage>UpdatedDate` and
// `<stage>Updatedby` were, so the record read as though somebody had worked
// the stage. Requested by Mr Ace after hitting it twice on the same enrolee.
//
// Only stages that are COMPLETELY empty are touched — a stamp sitting on real
// content is left alone, because clearing it would hide who set that content.
//
//   dry run (default):  npx tsx --env-file=.env.local scripts/backfill/apply-clear-empty-stage-stamps.ts
//   for real:           npx tsx --env-file=.env.local scripts/backfill/apply-clear-empty-stage-stamps.ts --apply
import { createServiceClient } from '../../lib/supabase/service';

const TABLE = 'ay2026_enrolment_status';
const APPLY = process.argv.includes('--apply');

// stage -> [statusCol, updatedDateCol, updatedByCol, contentCols]
const STAGES: Record<string, [string, string, string, string[]]> = {
  application: [
    'applicationStatus',
    'applicationUpdatedDate',
    'applicationUpdatedBy',
    ['applicationRemarks', 'applicationTerminalReason'],
  ],
  registration: [
    'registrationStatus',
    'registrationUpdateDate',
    'registrationUpdatedby',
    ['registrationInvoice', 'registrationPaymentDate', 'registrationRemarks'],
  ],
  documents: [
    'documentStatus',
    'documentUpdatedDate',
    'documentUpdatedby',
    ['documentRemarks'],
  ],
  assessment: [
    'assessmentStatus',
    'assessmentUpdatedDate',
    'assessmentUpdatedby',
    [
      'assessmentSchedule',
      'assessmentGradeMath',
      'assessmentGradeEnglish',
      'assessmentMedical',
      'assessmentRemarks',
    ],
  ],
  contract: [
    'contractStatus',
    'contractUpdatedDate',
    'contractUpdatedby',
    ['contractRemarks'],
  ],
  fees: [
    'feeStatus',
    'feeUpdatedDate',
    'feeUpdatedby',
    ['feeInvoice', 'feePaymentDate', 'feeStartDate', 'feeRemarks'],
  ],
  supplies: [
    'suppliesStatus',
    'suppliesUpdatedDate',
    'suppliesUpdatedby',
    ['suppliesClaimedDate', 'suppliesRemarks'],
  ],
  orientation: [
    'orientationStatus',
    'orientationUpdatedDate',
    'orientationUpdateby',
    ['orientationScheduleDate', 'orientationRemarks'],
  ],
};

async function main() {
  const svc = createServiceClient();

  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await svc
      .from(TABLE)
      .select('*')
      .range(from, from + 999);
    if (error) throw error;
    const page = (data ?? []) as any[];
    rows.push(...page);
    if (page.length < 1000) break;
  }

  const work: {
    enroleeNumber: string;
    name: string;
    stage: string;
    patch: Record<string, null>;
    stampedBy: string;
    stampedOn: string;
  }[] = [];
  for (const r of rows) {
    for (const [
      stage,
      [statusCol, dateCol, byCol, contentCols],
    ] of Object.entries(STAGES)) {
      if (!r[dateCol] && !r[byCol]) continue;
      if (r[statusCol]) continue;
      if (contentCols.some((c) => r[c])) continue;
      work.push({
        enroleeNumber: r.enroleeNumber,
        name: r.enroleeName,
        stage,
        patch: { [dateCol]: null, [byCol]: null },
        stampedBy: r[byCol] ?? '?',
        stampedOn: r[dateCol] ?? '?',
      });
    }
  }

  console.log(
    `${APPLY ? 'APPLYING' : 'DRY RUN'} — ${work.length} empty stage stamp(s)\n`
  );
  for (const w of work)
    console.log(
      `  ${w.stage.padEnd(13)} ${w.enroleeNumber}  "${w.name}"  stamped ${w.stampedOn} by ${w.stampedBy}`
    );
  if (work.length === 0) {
    console.log('  nothing to clear');
    return;
  }
  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to write.');
    return;
  }

  console.log('');
  for (const w of work) {
    const { error } = await svc
      .from(TABLE)
      .update(w.patch)
      .eq('enroleeNumber', w.enroleeNumber);
    if (error)
      throw new Error(
        `${w.enroleeNumber} ${w.stage}: ${error.message ?? JSON.stringify(error)}`
      );
    console.log(`  cleared ${w.stage} on ${w.enroleeNumber}`);
  }

  // verify
  const after: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await svc
      .from(TABLE)
      .select('*')
      .range(from, from + 999);
    const page = (data ?? []) as any[];
    after.push(...page);
    if (page.length < 1000) break;
  }
  let remaining = 0;
  for (const r of after)
    for (const [, [statusCol, dateCol, byCol, contentCols]] of Object.entries(
      STAGES
    ))
      if (
        (r[dateCol] || r[byCol]) &&
        !r[statusCol] &&
        contentCols.every((c) => !r[c])
      )
        remaining++;
  console.log(`\n  empty stage stamps remaining: ${remaining} (expect 0)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
