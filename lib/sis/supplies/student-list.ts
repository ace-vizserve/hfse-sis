// A student's books & supplies list (migration 199).
//
// The list = the books for their class's level and track (a book with no
// track fits both), plus the supplies for their level (a supply with no level
// fits every level). The class is the student's current section in that AY;
// without one there is no list — the card asks for a class instead.
//
// `buildStudentSupplies` is the pure half (tested); `loadStudentSupplies`
// reads the rows and hands them to it.

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  StudentSupplies,
  StudentSupplyGroup,
  SupplyClassType,
  SupplyHandoverRow,
  SupplyItemRow,
  SupplyKind,
} from '@/lib/sis/supplies/types';

/**
 * A class with no `class_type` follows the Standard list — the same reading
 * the scheme of work makes of it (lib/sow/access.ts `trackOf`). Every Primary
 * book in the school's list names a track, so reading "no track" as "only the
 * books with no track" would leave those classes with no books at all.
 */
export function trackOfClass(
  classType: string | null | undefined
): SupplyClassType {
  return classType === 'Global' ? 'Global' : 'Standard';
}

/** Does this item belong on the list of a class at `levelId` / `classType`? */
export function itemFitsClass(
  item: Pick<SupplyItemRow, 'kind' | 'level_id' | 'class_type'>,
  levelId: string,
  classType: string | null
): boolean {
  if (item.kind === 'supply')
    return item.level_id === null || item.level_id === levelId;
  return (
    item.level_id === levelId &&
    (item.class_type === null || item.class_type === trackOfClass(classType))
  );
}

/** "Publisher · ISBN" for a book; null when there is nothing to show. */
export function metaOf(
  item: Pick<SupplyItemRow, 'publisher' | 'isbn'>
): string | null {
  const parts = [item.publisher, item.isbn].filter(
    (p): p is string => !!p?.trim()
  );
  return parts.length ? parts.join(' · ') : null;
}

/**
 * Puts items in the school's order and groups them: books by subject, in the
 * order the school's sheet first lists each one, then the supplies in one
 * group after them. Shared by a student's checklist and the Admissions Book
 * list page (lib/sis/supplies/level-counts.ts), so both read the same groups.
 */
export function groupSupplyItems<T>(
  items: SupplyItemRow[],
  toRow: (item: SupplyItemRow) => T
): { name: string; kind: SupplyKind; items: T[] }[] {
  const sorted = [...items].sort(
    (a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title)
  );
  const books = new Map<
    string,
    { name: string; kind: SupplyKind; items: T[] }
  >();
  const supplies = {
    name: 'Supplies',
    kind: 'supply' as SupplyKind,
    items: [] as T[],
  };
  for (const item of sorted) {
    if (item.kind === 'supply') {
      supplies.items.push(toRow(item));
      continue;
    }
    const name = item.subject?.trim() || 'Books';
    let group = books.get(name);
    if (!group) {
      group = { name, kind: 'book', items: [] };
      books.set(name, group);
    }
    group.items.push(toRow(item));
  }

  const groups = [...books.values()];
  if (supplies.items.length) groups.push(supplies);
  return groups;
}

export function buildStudentSupplies(input: {
  section: { levelId: string; classType: string | null } | null;
  items: SupplyItemRow[];
  handovers: SupplyHandoverRow[];
}): StudentSupplies {
  const { section } = input;
  if (!section) return { needsClass: true };

  const given = new Map(input.handovers.map((h) => [h.item_id, h]));
  const fits = input.items.filter((i) =>
    itemFitsClass(i, section.levelId, section.classType)
  );

  const groups: StudentSupplyGroup[] = groupSupplyItems(fits, (item) => {
    const h = given.get(item.id);
    return {
      id: item.id,
      title: item.title,
      meta: metaOf(item),
      given: h ? { at: h.given_at, byName: h.given_by_name } : null,
    };
  });
  return { groups };
}

/** Every item id on a built list — what a tick may name. */
export function itemIdsOf(list: StudentSupplies): Set<string> {
  if ('needsClass' in list) return new Set();
  return new Set(list.groups.flatMap((g) => g.items.map((i) => i.id)));
}

/**
 * Reads the student's list. `sectionId` null → `{ needsClass: true }`.
 * Throws on a failed read; the route turns that into a 500.
 */
export async function loadStudentSupplies(
  service: SupabaseClient,
  args: { ayCode: string; studentNumber: string; sectionId: string | null }
): Promise<StudentSupplies> {
  if (!args.sectionId) return { needsClass: true };

  const [ayRes, sectionRes] = await Promise.all([
    service
      .from('academic_years')
      .select('id')
      .eq('ay_code', args.ayCode)
      .maybeSingle(),
    service
      .from('sections')
      .select('level_id, class_type')
      .eq('id', args.sectionId)
      .maybeSingle(),
  ]);
  if (ayRes.error)
    throw new Error(`Academic year lookup failed: ${ayRes.error.message}`);
  if (sectionRes.error)
    throw new Error(`Class lookup failed: ${sectionRes.error.message}`);
  const ayId = (ayRes.data as { id: string } | null)?.id ?? null;
  const section = sectionRes.data as {
    level_id: string;
    class_type: string | null;
  } | null;
  if (!ayId || !section) return { needsClass: true };

  const { data: itemData, error: itemErr } = await service
    .from('supply_items')
    .select(
      'id, kind, level_id, class_type, subject, title, publisher, isbn, sort_order'
    )
    .eq('academic_year_id', ayId)
    .eq('is_active', true)
    .or(`level_id.eq.${section.level_id},level_id.is.null`);
  if (itemErr)
    throw new Error(`Supply items lookup failed: ${itemErr.message}`);
  const items = (itemData ?? []) as SupplyItemRow[];

  let handovers: SupplyHandoverRow[] = [];
  if (items.length) {
    const { data: hData, error: hErr } = await service
      .from('supply_handovers')
      .select('item_id, given_at, given_by_name')
      .eq('student_number', args.studentNumber)
      .in(
        'item_id',
        items.map((i) => i.id)
      );
    if (hErr) throw new Error(`Handovers lookup failed: ${hErr.message}`);
    handovers = (hData ?? []) as SupplyHandoverRow[];
  }

  return buildStudentSupplies({
    section: { levelId: section.level_id, classType: section.class_type },
    items,
    handovers,
  });
}
