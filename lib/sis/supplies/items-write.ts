// Writes to a year's book list (migration 199), shared by the routes under
// app/api/sis/supplies/ (plan 2026-10-28-books-supplies-tracker.md, Phase 4).
//
// The routes own the role gate and the audit row; this file turns a form's
// fields into `supply_items` columns the same way for a create and an edit.

import type { SupabaseClient } from '@supabase/supabase-js';

import type { SupplyClassType } from '@/lib/sis/supplies/types';

export type SupplyItemColumns = {
  subject: string | null;
  title: string;
  publisher: string | null;
  isbn: string | null;
  class_type: SupplyClassType | null;
  level_id?: string | null;
};

/** The year's id, or null when there is no such year. Throws on a failed read. */
export async function findAyId(
  service: SupabaseClient,
  ayCode: string
): Promise<string | null> {
  const { data, error } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  if (error) throw new Error(`Academic year lookup failed: ${error.message}`);
  return (data as { id: string } | null)?.id ?? null;
}

/** A level's type, or null when there is no such level. */
export async function findLevel(
  service: SupabaseClient,
  where: { id: string } | { code: string }
): Promise<{ id: string; label: string; levelType: string } | null> {
  const query = service.from('levels').select('id, label, level_type');
  const { data, error } = await (
    'id' in where ? query.eq('id', where.id) : query.eq('code', where.code)
  ).maybeSingle();
  if (error) throw new Error(`Level lookup failed: ${error.message}`);
  const row = data as { id: string; label: string; level_type: string } | null;
  return row
    ? { id: row.id, label: row.label, levelType: row.level_type }
    : null;
}

/**
 * A book's columns. A Secondary level is always both tracks — its classes are
 * not split into Global and Standard, so a track there would hide the book.
 */
export function bookColumns(
  fields: {
    subject: string | null;
    title: string;
    publisher: string | null;
    isbn: string | null;
    classType: SupplyClassType | null;
  },
  levelType: string
): SupplyItemColumns {
  return {
    subject: fields.subject,
    title: fields.title,
    publisher: fields.publisher,
    isbn: fields.isbn,
    class_type: levelType === 'secondary' ? null : fields.classType,
  };
}

/** A supply's columns: every level (null) or Youngstarters only. */
export function supplyColumns(
  fields: { title: string },
  levelId: string | null
): SupplyItemColumns {
  return {
    subject: null,
    title: fields.title,
    publisher: null,
    isbn: null,
    class_type: null,
    level_id: levelId,
  };
}

/** The list's unique key (year, kind, level, track, subject, title) refused it. */
export function isDuplicate(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

export const DUPLICATE_MESSAGE =
  'That item is already on the list for this level. Change the existing one instead.';
