// Filter rules for the advanced export sheet — the operator-based builder
// the old (KD #162) sheet never had; its "Filters" section only mirrored the
// screen's own facets.
//
// Everything here is pure so the operators can be tested directly. The sheet
// supplies values through the same `ExportField.accessor` the CSV writer
// uses, so a rule reads a field exactly as the file will render it — a rule
// can never match on a value the export wouldn't print.

export type FieldType = 'text' | 'number' | 'date' | 'boolean';

export type OperatorId =
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'equals'
  | 'notEquals'
  | 'gt'
  | 'lt'
  | 'before'
  | 'after'
  | 'isEmpty'
  | 'isNotEmpty';

export type Operator = {
  id: OperatorId;
  label: string;
  /** Operators that test presence take no value from the user. */
  needsValue: boolean;
};

// Plain words, and case-insensitive text matching throughout.
//
// Directus offers sensitive/insensitive variants of every text operator. That
// is deliberately NOT mirrored: nobody administering a school wants
// "singapore" to miss "Singapore", and doubling the operator list to express
// it would cost more than it buys. If a case-sensitive match is ever actually
// needed, add it as a distinct operator rather than a variant of each.
const TEXT_OPERATORS: Operator[] = [
  { id: 'contains', label: 'Contains', needsValue: true },
  { id: 'notContains', label: "Doesn't contain", needsValue: true },
  { id: 'startsWith', label: 'Starts with', needsValue: true },
  { id: 'endsWith', label: 'Ends with', needsValue: true },
  { id: 'equals', label: 'Is', needsValue: true },
  { id: 'notEquals', label: 'Is not', needsValue: true },
  { id: 'isEmpty', label: 'Is empty', needsValue: false },
  { id: 'isNotEmpty', label: 'Is not empty', needsValue: false },
];

const NUMBER_OPERATORS: Operator[] = [
  { id: 'equals', label: 'Is', needsValue: true },
  { id: 'notEquals', label: 'Is not', needsValue: true },
  { id: 'gt', label: 'More than', needsValue: true },
  { id: 'lt', label: 'Less than', needsValue: true },
  { id: 'isEmpty', label: 'Is empty', needsValue: false },
  { id: 'isNotEmpty', label: 'Is not empty', needsValue: false },
];

const DATE_OPERATORS: Operator[] = [
  { id: 'before', label: 'Before', needsValue: true },
  { id: 'after', label: 'After', needsValue: true },
  { id: 'equals', label: 'On', needsValue: true },
  { id: 'isEmpty', label: 'Is empty', needsValue: false },
  { id: 'isNotEmpty', label: 'Is not empty', needsValue: false },
];

const BOOLEAN_OPERATORS: Operator[] = [
  { id: 'equals', label: 'Is', needsValue: true },
  { id: 'isEmpty', label: 'Is empty', needsValue: false },
  { id: 'isNotEmpty', label: 'Is not empty', needsValue: false },
];

export function operatorsFor(type: FieldType): Operator[] {
  switch (type) {
    case 'number':
      return NUMBER_OPERATORS;
    case 'date':
      return DATE_OPERATORS;
    case 'boolean':
      return BOOLEAN_OPERATORS;
    default:
      return TEXT_OPERATORS;
  }
}

// A date only if it looks like one — `new Date('P1')` is Invalid Date, but
// `new Date('2026')` is not, so a bare number must never be read as a year.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]|$)/;

function looksLikeDate(v: string): boolean {
  return ISO_DATE.test(v) && !Number.isNaN(new Date(v).getTime());
}

/**
 * Infer a field's type from its values.
 *
 * SCANS EVERY VALUE, never the first non-null one. This is the same rule
 * KD #162 established for the object-column probe, for the same reason: a
 * column that is a number on most rows and a string on one would otherwise
 * get number operators or text operators depending on which row happened to
 * sort first, and the export would silently behave differently run to run.
 *
 * Mixed types fall back to `text`, which every value can be compared as.
 */
export function inferFieldType(values: unknown[]): FieldType {
  let sawAny = false;
  let allNumber = true;
  let allBoolean = true;
  let allDate = true;

  for (const v of values) {
    if (v == null || v === '') continue;
    sawAny = true;
    if (
      typeof v !== 'number' &&
      !(typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)))
    ) {
      allNumber = false;
    }
    if (typeof v !== 'boolean' && v !== 'Yes' && v !== 'No') allBoolean = false;
    if (!(typeof v === 'string' && looksLikeDate(v))) allDate = false;
    if (!allNumber && !allBoolean && !allDate) break;
  }

  if (!sawAny) return 'text';
  if (allBoolean) return 'boolean';
  if (allDate) return 'date';
  if (allNumber) return 'number';
  return 'text';
}

/**
 * Distinct values for a field, for offering a picker instead of a free-text
 * box. Returns null when the field is unsuitable for one — too many distinct
 * values to be a menu (a passport number is not a choice), or none at all.
 */
export function distinctValuesFor(
  values: unknown[],
  max = 25
): string[] | null {
  const seen = new Set<string>();
  for (const v of values) {
    if (v == null || v === '') continue;
    seen.add(String(v));
    if (seen.size > max) return null;
  }
  return seen.size > 0 ? Array.from(seen).sort() : null;
}

export type FilterRule = {
  kind: 'rule';
  id: string;
  fieldId: string;
  operator: OperatorId;
  value: string;
};

export type FilterGroup = {
  kind: 'group';
  id: string;
  /** How this group's own children combine. */
  conjunction: 'and' | 'or';
  children: FilterNode[];
};

export type FilterNode = FilterRule | FilterGroup;

function compare(op: OperatorId, cell: unknown, raw: string): boolean {
  const isBlank = cell == null || String(cell).trim() === '';

  if (op === 'isEmpty') return isBlank;
  if (op === 'isNotEmpty') return !isBlank;
  if (isBlank) return false;

  const text = String(cell).toLowerCase();
  const needle = raw.trim().toLowerCase();

  switch (op) {
    case 'contains':
      return text.includes(needle);
    case 'notContains':
      return !text.includes(needle);
    case 'startsWith':
      return text.startsWith(needle);
    case 'endsWith':
      return text.endsWith(needle);
    case 'equals':
      return text === needle;
    case 'notEquals':
      return text !== needle;
    case 'gt':
    case 'lt': {
      const a = Number(cell);
      const b = Number(raw);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      return op === 'gt' ? a > b : a < b;
    }
    case 'before':
    case 'after': {
      const a = new Date(String(cell)).getTime();
      const b = new Date(raw).getTime();
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      return op === 'before' ? a < b : a > b;
    }
    default:
      return true;
  }
}

/**
 * True when a rule is complete enough to apply.
 *
 * An unfinished rule is SKIPPED rather than treated as matching nothing —
 * otherwise the row count would collapse to zero the moment someone adds a
 * rule and before they have typed a value, which reads as "my filter broke
 * the export".
 */
export function isRuleReady(rule: FilterRule, type: FieldType): boolean {
  const op = operatorsFor(type).find((o) => o.id === rule.operator);
  if (!op) return false;
  return !op.needsValue || rule.value.trim() !== '';
}

export type RuleContext = {
  /** Resolve a field's value for a row, exactly as the CSV would print it. */
  valueOf: (fieldId: string, rowIndex: number) => unknown;
  /** The inferred type per field, used to pick comparison semantics. */
  typeOf: (fieldId: string) => FieldType;
};

function matchNode(
  node: FilterNode,
  rowIndex: number,
  ctx: RuleContext
): boolean | null {
  if (node.kind === 'rule') {
    const type = ctx.typeOf(node.fieldId);
    if (!isRuleReady(node, type)) return null; // incomplete → ignored
    return compare(
      node.operator,
      ctx.valueOf(node.fieldId, rowIndex),
      node.value
    );
  }
  const results = node.children
    .map((c) => matchNode(c, rowIndex, ctx))
    .filter((r): r is boolean => r !== null);
  if (results.length === 0) return null; // empty group → ignored
  return node.conjunction === 'and'
    ? results.every(Boolean)
    : results.some(Boolean);
}

/** Apply a rule tree to rows. An empty or wholly-incomplete tree returns the
 *  rows untouched. */
export function applyFilterRules<TRow>(
  rows: TRow[],
  root: FilterGroup,
  ctx: (row: TRow, index: number) => RuleContext
): TRow[] {
  if (root.children.length === 0) return rows;
  return rows.filter((row, i) => {
    const result = matchNode(root, i, ctx(row, i));
    return result === null ? true : result;
  });
}

/** Count the rules in a tree, complete or not — drives the "3 rules" caption. */
export function countRules(node: FilterNode): number {
  if (node.kind === 'rule') return 1;
  return node.children.reduce((n, c) => n + countRules(c), 0);
}

// ── immutable tree edits ──────────────────────────────────────────────────
// Kept pure and separate from the component so a mis-edit shows up as a
// failing unit test rather than as a filter that quietly stops matching.

/** Replace one node in the tree, by id. */
export function updateNode(
  root: FilterGroup,
  id: string,
  patch: (node: FilterNode) => FilterNode
): FilterGroup {
  const walk = (node: FilterNode): FilterNode => {
    if (node.id === id) return patch(node);
    if (node.kind === 'group') {
      return { ...node, children: node.children.map(walk) };
    }
    return node;
  };
  return walk(root) as FilterGroup;
}

/** Drop one node from the tree, by id. The root itself is never removed. */
export function removeNode(root: FilterGroup, id: string): FilterGroup {
  const walk = (group: FilterGroup): FilterGroup => ({
    ...group,
    children: group.children
      .filter((c) => c.id !== id)
      .map((c) => (c.kind === 'group' ? walk(c) : c)),
  });
  return walk(root);
}

/** Append a node to the group with the given id. */
export function addChild(
  root: FilterGroup,
  groupId: string,
  child: FilterNode
): FilterGroup {
  return updateNode(root, groupId, (node) =>
    node.kind === 'group'
      ? { ...node, children: [...node.children, child] }
      : node
  ) as FilterGroup;
}
