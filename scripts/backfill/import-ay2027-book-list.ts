// scripts/backfill/import-ay2027-book-list.ts
// Loads AY2027's books and supplies into the tracker (migration 199) from the
// school's book list workbook, `files/AY2027/AY2027 Book List_v02.xlsx`.
//
// Reading the workbook is lib/sis/supplies/parse-book-list.ts — which sheets,
// which columns, which rows are dropped. This script only resolves level codes
// to ids and writes `supply_items`.
//
// IDEMPOTENT. Each item is matched to a stored row on the table's unique key
// (year, kind, level, track, subject, title). A new item is inserted; a stored
// one whose publisher, ISBN, order or active flag differ is updated; anything
// else is left alone, so a second run changes nothing. A stored item the
// workbook no longer lists is reported, not touched — handover rows hang off
// it.
//
// Dry run by default — reads only, prints what it would do.
//
//   npx tsx --conditions=react-server --import ./scripts/local/seed/harness/register.mjs --env-file=.env.development.local scripts/backfill/import-ay2027-book-list.ts
//   ... scripts/backfill/import-ay2027-book-list.ts --apply

import path from 'node:path';

import { parseBookList } from '../../lib/sis/supplies/parse-book-list';
import type { ParsedSupplyItem } from '../../lib/sis/supplies/types';
import { createServiceClient } from '../../lib/supabase/service';

const WORKBOOK = 'files/AY2027/AY2027 Book List_v02.xlsx';
const AY = 'AY2027';
const APPLY = process.argv.slice(2).includes('--apply');

type StoredItem = {
  id: string;
  kind: string;
  level_id: string | null;
  class_type: string | null;
  subject: string | null;
  title: string;
  publisher: string | null;
  isbn: string | null;
  sort_order: number;
  is_active: boolean;
};

const keyOf = (
  kind: string,
  levelId: string | null,
  classType: string | null,
  subject: string | null,
  title: string
) => [kind, levelId ?? '*', classType ?? '*', subject ?? '*', title].join('|');

function courseLabel(i: ParsedSupplyItem): string {
  if (i.kind === 'supply')
    return i.levelCode
      ? `Supplies (${i.levelCode} only)`
      : 'Supplies (every level)';
  return `${i.levelCode} ${i.classType ?? 'both tracks'}`;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '(unset)';
  console.log(`Target: ${url}`);
  console.log(APPLY ? 'Mode: APPLY' : 'Mode: dry run (pass --apply to write)');

  const parsed = parseBookList(path.resolve(WORKBOOK), AY);

  const counts = new Map<string, number>();
  for (const i of parsed.items)
    counts.set(courseLabel(i), (counts.get(courseLabel(i)) ?? 0) + 1);
  console.log(`\nWorkbook: ${parsed.items.length} items`);
  for (const [k, n] of [...counts.entries()].sort())
    console.log(`  ${k.padEnd(28)} ${n}`);

  const skippedBy = new Map<string, number>();
  for (const s of parsed.skipped)
    skippedBy.set(s.reason, (skippedBy.get(s.reason) ?? 0) + 1);
  console.log(`Skipped rows: ${parsed.skipped.length}`);
  for (const [k, n] of skippedBy) console.log(`  ${k.padEnd(28)} ${n}`);
  for (const s of parsed.skipped.filter(
    (x) => x.reason === 'unknown_course' || x.reason === 'duplicate'
  )) {
    console.log(
      `    row ${s.row} [${s.reason}] ${s.course ?? '(no course)'} — ${s.title}`
    );
  }

  const service = createServiceClient();
  const [ayRes, levelRes] = await Promise.all([
    service.from('academic_years').select('id').eq('ay_code', AY).maybeSingle(),
    service.from('levels').select('id, code'),
  ]);
  if (ayRes.error) throw ayRes.error;
  if (levelRes.error) throw levelRes.error;
  const ayId = (ayRes.data as { id: string } | null)?.id;
  if (!ayId) throw new Error(`No academic_years row for ${AY}.`);
  const levelIdByCode = new Map(
    ((levelRes.data ?? []) as Array<{ id: string; code: string }>).map((l) => [
      l.code,
      l.id,
    ])
  );

  const { data: storedData, error: storedErr } = await service
    .from('supply_items')
    .select(
      'id, kind, level_id, class_type, subject, title, publisher, isbn, sort_order, is_active'
    )
    .eq('academic_year_id', ayId);
  if (storedErr) throw storedErr;
  const stored = new Map(
    ((storedData ?? []) as StoredItem[]).map((s) => [
      keyOf(s.kind, s.level_id, s.class_type, s.subject, s.title),
      s,
    ])
  );

  const inserts: Record<string, unknown>[] = [];
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const seen = new Set<string>();
  let unchanged = 0;
  for (const i of parsed.items) {
    const levelId = i.levelCode ? levelIdByCode.get(i.levelCode) : null;
    if (levelId === undefined)
      throw new Error(`No levels row for code ${i.levelCode}.`);
    const key = keyOf(i.kind, levelId, i.classType, i.subject, i.title);
    seen.add(key);
    const fields = {
      publisher: i.publisher,
      isbn: i.isbn,
      sort_order: i.sortOrder,
      is_active: true,
    };
    const s = stored.get(key);
    if (!s) {
      inserts.push({
        academic_year_id: ayId,
        kind: i.kind,
        level_id: levelId,
        class_type: i.classType,
        subject: i.subject,
        title: i.title,
        ...fields,
      });
      continue;
    }
    const patch: Record<string, unknown> = {};
    if (s.publisher !== fields.publisher) patch.publisher = fields.publisher;
    if (s.isbn !== fields.isbn) patch.isbn = fields.isbn;
    if (s.sort_order !== fields.sort_order)
      patch.sort_order = fields.sort_order;
    if (s.is_active !== true) patch.is_active = true;
    if (Object.keys(patch).length) updates.push({ id: s.id, patch });
    else unchanged++;
  }
  const notInWorkbook = [...stored.entries()].filter(([k]) => !seen.has(k));

  console.log(`\nAgainst ${AY} in the database (${stored.size} stored):`);
  console.log(`  insert       ${inserts.length}`);
  console.log(`  update       ${updates.length}`);
  console.log(`  unchanged    ${unchanged}`);
  console.log(`  stored, not in workbook (left alone) ${notInWorkbook.length}`);
  for (const [, s] of notInWorkbook) console.log(`    ${s.kind} ${s.title}`);

  if (!APPLY) return;

  if (inserts.length) {
    const { error } = await service.from('supply_items').insert(inserts);
    if (error) throw error;
  }
  for (const u of updates) {
    const { error } = await service
      .from('supply_items')
      .update({ ...u.patch, updated_at: new Date().toISOString() })
      .eq('id', u.id);
    if (error) throw error;
  }
  console.log(
    `\nApplied: ${inserts.length} inserted, ${updates.length} updated.`
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
