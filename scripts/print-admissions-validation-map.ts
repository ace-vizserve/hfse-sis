// scripts/print-admissions-validation-map.ts
// Prints every admissions stage, every status it can hold, and what each one
// demands before it will save. Read straight from the shared source of truth
// (lib/schemas/sis.ts) that both the stage PATCH route and the edit dialog
// use, so it cannot drift from what actually runs.
//
// Run: npx tsx scripts/print-admissions-validation-map.ts
import {
  STAGE_COLUMN_MAP,
  STAGE_KEYS,
  STAGE_LABELS,
  STAGE_STATUS_OPTIONS,
  STAGE_STATUS_REQUIRED_FIELDS,
  STATUS_OPTIONAL_STAGES,
  type StageKey,
} from '../lib/schemas/sis';

function labelFor(stageKey: StageKey, fieldKey: string): string {
  const extras = STAGE_COLUMN_MAP[stageKey]?.extras ?? [];
  return extras.find((e) => e.fieldKey === fieldKey)?.label ?? fieldKey;
}

function main() {
  console.log('ADMISSIONS STAGE VALIDATION MAP');
  console.log('What each status demands before the save is allowed.\n');

  for (const stageKey of STAGE_KEYS) {
    const cols = STAGE_COLUMN_MAP[stageKey];
    const extras = cols?.extras ?? [];
    const byStatus = STAGE_STATUS_REQUIRED_FIELDS[stageKey] ?? {};
    const statusOptional = STATUS_OPTIONAL_STAGES.includes(stageKey);

    console.log(`${'='.repeat(72)}`);
    console.log(`${STAGE_LABELS[stageKey]}  (${stageKey})`);
    console.log(`${'='.repeat(72)}`);
    console.log(
      `  a status is ${statusOptional ? 'OPTIONAL — no edit dialog; written by the enrolment flip' : 'REQUIRED on every save'}`
    );
    console.log(
      `  fields on this stage: ${extras.length ? extras.map((e) => e.label).join(', ') : '(none)'}`
    );
    console.log('');

    const statuses = STAGE_STATUS_OPTIONS[stageKey] ?? [];
    const width = Math.max(...statuses.map((s) => s.length), 12);
    for (const s of statuses) {
      const required = Object.hasOwn(byStatus, s) ? byStatus[s] : undefined;
      const demand =
        required && required.length
          ? required.map((f) => labelFor(stageKey, f)).join(' + ')
          : extras.length
            ? 'nothing'
            : 'nothing (stage has no fields)';
      console.log(`  ${s.padEnd(width)}  ->  ${demand}`);
    }

    // any status not on the canonical list
    const custom = Object.keys(byStatus).filter((k) => !statuses.includes(k));
    if (custom.length)
      console.log(
        `  (rules also exist for non-canonical statuses: ${custom.join(', ')})`
      );
    console.log(
      `  ${'Other… (free text)'.padEnd(width)}  ->  nothing — a custom status matches no rule`
    );
    console.log('');
  }

  console.log(`${'='.repeat(72)}`);
  console.log('WHERE THE GAPS ARE');
  console.log(`${'='.repeat(72)}`);
  const gaps: string[] = [];
  for (const stageKey of STAGE_KEYS) {
    const extras = STAGE_COLUMN_MAP[stageKey]?.extras ?? [];
    if (extras.length === 0) continue;
    const byStatus = STAGE_STATUS_REQUIRED_FIELDS[stageKey] ?? {};
    const covered = new Set(Object.values(byStatus).flat());
    const uncovered = extras.filter((e) => !covered.has(e.fieldKey));
    if (Object.keys(byStatus).length === 0) {
      gaps.push(
        `  ${STAGE_LABELS[stageKey]}: has ${extras.length} field(s) (${extras.map((e) => e.label).join(', ')}) but NO rule at any status`
      );
    } else if (uncovered.length) {
      gaps.push(
        `  ${STAGE_LABELS[stageKey]}: ${uncovered.map((e) => e.label).join(', ')} never required at any status`
      );
    }
  }
  if (gaps.length === 0) console.log('  none');
  gaps.forEach((g) => console.log(g));
  console.log(
    '\n  A custom "Other…" status bypasses every field rule on every stage,'
  );
  console.log(
    '  by design — the rules are keyed on the canonical status values.'
  );
}

main();
