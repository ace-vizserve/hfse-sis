// Books & supplies tracker — shared shapes (migration 199).
//
// Pure types only, so the Phase 2 client card can import them without pulling
// in the parser (xlsx) or the loader (service client).

import type { AnyLevelCode } from '@/lib/sis/levels';

export type SupplyKind = 'book' | 'supply';
export type SupplyClassType = 'Global' | 'Standard';

/** One item read from the book list workbook, before it has database ids. */
export type ParsedSupplyItem = {
  kind: SupplyKind;
  /** Null = every level. */
  levelCode: AnyLevelCode | null;
  /** Null = both tracks. */
  classType: SupplyClassType | null;
  subject: string | null;
  title: string;
  publisher: string | null;
  isbn: string | null;
  /** The sheet row the item came from — the order the school listed it in. */
  sortOrder: number;
  sheet: string;
};

export type SkippedBookRow = {
  sheet: string;
  row: number;
  reason: 'end_of_life' | 'iep_course' | 'unknown_course' | 'duplicate';
  course: string | null;
  title: string;
};

export type ParsedBookList = {
  ayCode: string;
  items: ParsedSupplyItem[];
  skipped: SkippedBookRow[];
};

/** A `supply_items` row as the loader reads it. */
export type SupplyItemRow = {
  id: string;
  kind: SupplyKind;
  level_id: string | null;
  class_type: SupplyClassType | null;
  subject: string | null;
  title: string;
  publisher: string | null;
  isbn: string | null;
  sort_order: number;
};

/** A `supply_handovers` row as the loader reads it. */
export type SupplyHandoverRow = {
  item_id: string;
  given_at: string;
  given_by_name: string | null;
};

export type StudentSupplyItem = {
  id: string;
  title: string;
  /** "Publisher · ISBN" for a book; null when there is nothing to show. */
  meta: string | null;
  given: { at: string; byName: string | null } | null;
};

export type StudentSupplyGroup = {
  name: string;
  kind: SupplyKind;
  items: StudentSupplyItem[];
};

export type StudentSupplies =
  | { needsClass: true }
  | { groups: StudentSupplyGroup[] };
